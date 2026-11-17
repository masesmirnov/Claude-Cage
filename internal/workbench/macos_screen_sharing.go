package workbench

import (
	"bufio"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"al.essio.dev/pkg/shellescape"
	"github.com/sylvinus/agent-vm/internal/cage"
	"github.com/sylvinus/agent-vm/internal/guestos"
	"github.com/sylvinus/agent-vm/internal/host"
)

var (
	errScreenSharingNotMacOS    = errors.New("Only macOS guests can open system Screen Sharing")
	errScreenSharingNotReady    = errors.New("The macOS guest is not ready yet")
	errScreenSharingNeedMacHost = errors.New("Opening guest Screen Sharing must be done in the Cage app on this Mac")
	errScreenSharingNotIsolated = errors.New("The guest internet is currently allowed or being checked, so reconfiguring Screen Sharing was refused. First pause the internet in the workbench, confirm that the network gate is closed, then try again.")
	errScreenSharingGateUnknown = errors.New("Cannot confirm the guest network isolation state, so reconfiguring Screen Sharing was refused. Make sure the environment is started, then try again while the internet is off.")
	errScreenSharingUnreachable = errors.New("Cannot connect to guest Screen Sharing. In the guest's \"System Settings → General → Sharing\", turn on \"Screen Sharing\" and allow the current regular guest user. When macOS 26 enables it only from the command line, connecting may say \"Screen Sharing is not allowed on localhost\", and you need to turn it on once by hand in System Settings.")
	errScreenSharingBadAction   = errors.New("Invalid Screen Sharing operation")
	errScreenSharingEnable      = errors.New("Cannot re-enable the guest Screen Sharing service. First pause the internet in the workbench, confirm that the guest has the enabling script installed, then try again.")
)

// macOSScreenSharing is the cage-serve-owned SSH local forward to guest 5900.
// Hooks are for tests; nil uses production gate, ssh, inspect and open(1) behavior.
type macOSScreenSharing struct {
	mu      sync.Mutex
	done    <-chan struct{}
	cancel  context.CancelFunc
	port    int
	gate    func(context.Context) (cage.GateStatus, error)
	open    func(string) error
	inspect func(context.Context) (macOSScreenSharingStatus, error)
	enable  func(context.Context) error
}

type macOSScreenSharingRequest struct {
	Action string `json:"action"`
}

// screenSharingCheck mirrors the initialization / safety check item shape
// already used in the setup UI: id, title, state, evidence, remedy.
type screenSharingCheck struct {
	ID       string          `json:"id"`
	Title    string          `json:"title"`
	State    cage.CheckState `json:"state"`
	Evidence string          `json:"evidence"`
	Remedy   string          `json:"remedy,omitempty"`
}

// macOSScreenSharingStatus is the result of a Screen Sharing usability check.
type macOSScreenSharingStatus struct {
	Usable     bool                 `json:"usable"`
	Satisfied  bool                 `json:"satisfied,omitempty"`
	State      cage.CheckState      `json:"state"`
	Summary    string               `json:"summary"`
	Authorized cage.CheckState      `json:"authorized,omitempty"`
	Checks     []screenSharingCheck `json:"checks"`
}

func screenSharingIsolationError(state cage.GateStatus, err error) error {
	if err != nil {
		return errScreenSharingGateUnknown
	}
	if state.Mode != cage.GateClosed {
		return errScreenSharingNotIsolated
	}
	return nil
}

func (s *Server) requireMacOSNetworkIsolated(ctx context.Context) error {
	if s.screenSharing.gate != nil {
		state, err := s.screenSharing.gate(ctx)
		return screenSharingIsolationError(state, err)
	}
	client, err := s.gateClient()
	if err != nil {
		return screenSharingIsolationError(cage.GateStatus{}, err)
	}
	state, err := client.Status(ctx)
	if err == nil {
		s.publishGate(state)
	}
	return screenSharingIsolationError(state, err)
}

func (s *Server) openMacOSScreenSharing(w http.ResponseWriter, r *http.Request) {
	if !s.hasTrustedView(r) {
		http.Error(w, errScreenSharingNeedMacHost.Error(), http.StatusForbidden)
		return
	}
	if s.macosGuest == nil {
		requestError(w, errScreenSharingNotMacOS)
		return
	}
	var input macOSScreenSharingRequest
	if !readJSON(w, r, &input) {
		return
	}
	if input.Action == "" {
		input.Action = "open"
	}
	s.mu.Lock()
	ready, closing := s.ready, s.closing
	s.mu.Unlock()
	if !ready || closing {
		requestError(w, errScreenSharingNotReady)
		return
	}
	switch input.Action {
	case "check":
		status, err := s.inspectMacOSScreenSharing(r.Context())
		if err != nil {
			requestError(w, err)
			return
		}
		jsonReply(w, status)
	case "enable":
		if err := s.enableIsolatedMacOSScreenSharing(r.Context()); err != nil {
			requestError(w, err)
			return
		}
		status, err := s.inspectMacOSScreenSharing(r.Context())
		if err != nil {
			requestError(w, err)
			return
		}
		status.Summary = "Re-enabled the guest Screen Sharing service." + status.Summary
		jsonReply(w, status)
	case "open":
		// Daily connect only creates a host-local SSH forward to guest
		// loopback. It adds no guest egress, so it is allowed regardless of
		// the current gate. Setup, repair and the System Settings pane still
		// require isolation.
		port, err := s.ensureMacOSScreenSharingTunnel(r.Context())
		if err != nil {
			requestError(w, err)
			return
		}
		url := fmt.Sprintf("vnc://127.0.0.1:%d", port)
		if err := s.openMacOSScreenSharingURL(url); err != nil {
			requestError(w, err)
			return
		}
		jsonReply(w, map[string]any{"ok": true, "address": "127.0.0.1:" + strconv.Itoa(port)})
	default:
		requestError(w, errScreenSharingBadAction)
	}
}

func (s *Server) openMacOSScreenSharingURL(url string) error {
	if s.screenSharing.open != nil {
		return s.screenSharing.open(url)
	}
	if runtime.GOOS != "darwin" {
		return errScreenSharingNeedMacHost
	}
	cmd := exec.Command("/usr/bin/open", url)
	host.HideCommandWindow(cmd)
	if err := cmd.Run(); err != nil {
		return errors.New("Cannot open the local \"Screen Sharing\"; make sure the app is installed on the system and try again.")
	}
	return nil
}

func (s *Server) enableIsolatedMacOSScreenSharing(ctx context.Context) error {
	// BeginCheck and Grant take this same lock. Keep the service change
	// inside the verified closed-gate interval.
	s.safetyOp.Lock()
	defer s.safetyOp.Unlock()
	if err := s.requireMacOSNetworkIsolated(ctx); err != nil {
		return err
	}
	if s.screenSharing.enable != nil {
		return s.screenSharing.enable(ctx)
	}
	if s.macosGuest == nil {
		return errScreenSharingNotMacOS
	}
	provision, err := guestos.MacOSProvisionUser(s.profile)
	if err != nil {
		return err
	}
	args, err := guestos.MacOSSSHArgs(s.profile, provision)
	if err != nil {
		return err
	}
	script := "sudo -S -p '' /usr/local/libexec/cage-enable-screensharing " + shellescape.Quote(s.macosGuest.User) + " < /Users/" + provision + "/password"
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, sshExecutable(), append(append([]string{}, args...), "-T", "cage-macos", "--", "exec /bin/sh -ec "+shellescape.Quote(script))...)
	cmd.Env = sshEnvironment()
	host.HideCommandWindow(cmd)
	if err := cmd.Run(); err != nil {
		return errScreenSharingEnable
	}
	return nil
}

func setupSharingSatisfied(status macOSScreenSharingStatus, confirmed bool) bool {
	return status.Usable && (status.Authorized == cage.CheckPassed || confirmed)
}

func (s *Server) evaluateMacOSSetupSharing(ctx context.Context, force bool) macOSScreenSharingStatus {
	s.mu.Lock()
	if !force && time.Since(s.macSetupSharingAttempt) < 15*time.Second && s.macSetupSharingStatus.State != "" {
		cached := s.macSetupSharingStatus
		cached.Satisfied = setupSharingSatisfied(cached, s.macSetupSharingConfirmed)
		s.mu.Unlock()
		return cached
	}
	attempt := time.Now()
	s.macSetupSharingAttempt = attempt
	s.mu.Unlock()
	status, err := s.inspectMacOSScreenSharing(ctx)
	if err != nil {
		status = macOSScreenSharingStatus{
			State:   cage.CheckUnknown,
			Summary: "Cannot check guest Screen Sharing right now: " + err.Error(),
			Checks: []screenSharingCheck{{
				ID:       "availability",
				Title:    "Screen Sharing reachability",
				State:    cage.CheckUnknown,
				Evidence: err.Error(),
				Remedy:   "Make sure the virtual Mac is signed in and try again. If it still fails, pause the internet first, then re-enable the Screen Sharing service.",
			}},
		}
	}
	s.mu.Lock()
	status.Satisfied = setupSharingSatisfied(status, s.macSetupSharingConfirmed)
	if s.macSetupSharingAttempt == attempt {
		s.macSetupSharingStatus = status
	}
	s.mu.Unlock()
	return status
}

func (s *Server) inspectMacOSScreenSharing(ctx context.Context) (macOSScreenSharingStatus, error) {
	if s.macosGuest == nil {
		return macOSScreenSharingStatus{}, errScreenSharingNotMacOS
	}
	if s.screenSharing.inspect != nil {
		return s.screenSharing.inspect(ctx)
	}
	service, portOpen, serviceErr := s.inspectMacOSScreenSharingService(ctx)
	rfb, err := s.inspectMacOSScreenSharingRFB(ctx)
	return assembleScreenSharingStatus(service, portOpen, serviceErr, rfb, err), nil
}

type screenSharingRFBResult struct {
	Greeting    string
	Types       int
	Reason      string
	Denied      bool
	Handshake   bool
	Unreachable bool
}

func assembleScreenSharingStatus(serviceLoaded, portOpen bool, serviceErr error, rfb screenSharingRFBResult, rfbErr error) macOSScreenSharingStatus {
	service := screenSharingCheck{ID: "service", Title: "Screen Sharing service", State: cage.CheckUnknown, Evidence: "The service state was not obtained yet"}
	if serviceErr != nil {
		service.Evidence = "Cannot confirm whether com.apple.screensharing is loaded: " + serviceErr.Error()
		service.Remedy = "First pause the internet in the workbench, then re-enable the Screen Sharing service."
		if portOpen {
			service.State = cage.CheckPassed
			service.Evidence = "The service state could not be read directly, but guest port 5900 is listening, so the service is considered started."
			service.Remedy = ""
		}
	} else if serviceLoaded {
		service.State = cage.CheckPassed
		service.Evidence = "The com.apple.screensharing service is loaded."
	} else {
		service.State = cage.CheckFailed
		service.Evidence = "The com.apple.screensharing service is not loaded."
		service.Remedy = "First pause the internet in the workbench, then click \"Re-enable Screen Sharing service\". The first installation enables it automatically during provisioning."
	}

	port := screenSharingCheck{ID: "port", Title: "Port 5900 listening", State: cage.CheckFailed, Evidence: "Guest 127.0.0.1:5900 is not listening yet.", Remedy: "First pause the internet in the workbench, then re-enable the Screen Sharing service."}
	if portOpen {
		port.State = cage.CheckPassed
		port.Evidence = "Guest 127.0.0.1:5900 is listening."
		port.Remedy = ""
	}

	handshake := screenSharingCheck{ID: "rfb", Title: "RFB handshake", State: cage.CheckUnknown, Evidence: "The RFB handshake has not completed yet."}
	authorization := screenSharingCheck{ID: "authorization", Title: "System Settings authorization", State: cage.CheckUnknown, Evidence: "The Screen Sharing switch in System Settings cannot be confirmed automatically yet. When macOS 26 enables it only from the command line, connecting may say \"Screen Sharing is not allowed on localhost\".", Remedy: "In the guest's \"System Settings → General → Sharing\", turn on \"Screen Sharing\" and allow the current regular guest user."}
	authorized := cage.CheckUnknown
	usable := false

	if rfbErr != nil && !rfb.Handshake {
		handshake.State = cage.CheckFailed
		handshake.Evidence = "Cannot complete the RFB handshake: " + rfbErr.Error()
		handshake.Remedy = "In the guest's \"System Settings → General → Sharing\", turn on \"Screen Sharing\". If the service is not started, pause the internet first, then re-enable it."
		if rfb.Unreachable || !portOpen {
			handshake.Evidence = "Not connected to the guest Screen Sharing port yet."
		}
	} else if rfb.Denied {
		handshake.State = cage.CheckFailed
		reason := rfb.Reason
		if reason == "" {
			reason = "the connection was refused after the handshake"
		}
		handshake.Evidence = "RFB handshake refused: " + reason
		handshake.Remedy = "This usually means it is not authorized in System Settings yet. Open \"System Settings → General → Sharing\", turn on \"Screen Sharing\" and allow the current regular guest user."
		authorization.State = cage.CheckFailed
		authorization.Evidence = "Screen Sharing detected as not allowed: " + reason
		authorization.Remedy = handshake.Remedy
		authorized = cage.CheckFailed
	} else if rfb.Handshake {
		handshake.State = cage.CheckPassed
		evidence := "RFB handshake received"
		if rfb.Greeting != "" {
			evidence += " (" + strings.TrimSpace(rfb.Greeting) + ")"
		}
		if rfb.Types > 0 {
			evidence += fmt.Sprintf(", the server offers %d authentication methods.", rfb.Types)
		} else {
			evidence += "."
		}
		handshake.Evidence = evidence
		usable = true
		if rfb.Reason == "" && rfb.Types > 0 {
			authorization.State = cage.CheckUnknown
			authorization.Evidence = "The RFB handshake succeeded, but the Screen Sharing switch cannot be read directly under System Integrity Protection. If the local client still says \"Screen Sharing is not allowed on localhost\", turn it on once more by hand in the guest's System Settings."
		}
	}

	if !portOpen && !rfb.Handshake {
		usable = false
	}
	if authorized == cage.CheckFailed {
		usable = false
	}

	checks := []screenSharingCheck{service, port, handshake, authorization}
	state := cage.CheckFailed
	summary := "Guest Screen Sharing is not available yet."
	if usable {
		state = cage.CheckPassed
		summary = "The guest Screen Sharing service is enabled and the RFB handshake succeeded."
		if authorized == cage.CheckUnknown {
			summary += "Still confirm in \"System Settings → General → Sharing\" that \"Screen Sharing\" is on, so the local client does not say \"not allowed\"."
		}
	} else if authorized == cage.CheckFailed {
		summary = "The Screen Sharing service responded, but the system does not allow connections yet. In \"System Settings → General → Sharing\", turn on \"Screen Sharing\"."
		state = cage.CheckFailed
	} else if service.State == cage.CheckUnknown && port.State != cage.CheckPassed && handshake.State != cage.CheckPassed {
		state = cage.CheckUnknown
		summary = "Cannot confirm the guest Screen Sharing state right now."
	}
	return macOSScreenSharingStatus{Usable: usable, State: state, Summary: summary, Authorized: authorized, Checks: checks}
}

func (s *Server) inspectMacOSScreenSharingService(ctx context.Context) (bool, bool, error) {
	if s.macosGuest == nil {
		return false, false, errScreenSharingNotMacOS
	}
	script := `service=no
if launchctl print system/com.apple.screensharing >/dev/null 2>&1 || launchctl list com.apple.screensharing >/dev/null 2>&1; then
	service=yes
fi
port=no
if nc -z 127.0.0.1 5900 >/dev/null 2>&1 || nc -z ::1 5900 >/dev/null 2>&1; then
	port=yes
fi
printf 'service=%s port=%s\n' "$service" "$port"`
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	cmd := s.macOSSSHCommand(ctx, "-T", "cage-macos", "--", "exec /bin/sh -c "+shellescape.Quote(script))
	out, err := cmd.Output()
	line := strings.TrimSpace(string(out))
	service := strings.Contains(line, "service=yes")
	port := strings.Contains(line, "port=yes")
	if err != nil && !service && !port {
		return false, false, err
	}
	return service, port, nil
}

func (s *Server) inspectMacOSScreenSharingRFB(ctx context.Context) (screenSharingRFBResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	cmd := s.macOSSSHCommand(ctx, "-W", "127.0.0.1:5900", "cage-macos")
	if cmd.Err != nil {
		return screenSharingRFBResult{Unreachable: true}, cmd.Err
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return screenSharingRFBResult{}, err
	}
	defer stdin.Close()
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return screenSharingRFBResult{}, err
	}
	defer stdout.Close()
	if err := cmd.Start(); err != nil {
		return screenSharingRFBResult{Unreachable: true}, err
	}
	defer func() { cancel(); _ = cmd.Wait() }()
	return readScreenSharingRFB(ctx, struct {
		io.Reader
		io.Writer
	}{stdout, stdin})
}

func probeScreenSharingRFB(ctx context.Context, addr string) error {
	var d net.Dialer
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return errScreenSharingUnreachable
	}
	defer conn.Close()
	result, err := readScreenSharingRFB(ctx, conn)
	if err != nil || result.Denied || !result.Handshake {
		return errScreenSharingUnreachable
	}
	return nil
}

func readScreenSharingRFB(ctx context.Context, conn io.ReadWriter) (screenSharingRFBResult, error) {
	var result screenSharingRFBResult
	if deadline, ok := ctx.Deadline(); ok {
		if c, ok := conn.(interface{ SetDeadline(time.Time) error }); ok {
			_ = c.SetDeadline(deadline)
		}
	} else if c, ok := conn.(interface{ SetDeadline(time.Time) error }); ok {
		_ = c.SetDeadline(time.Now().Add(3 * time.Second))
	}
	var buf [12]byte
	if _, err := io.ReadFull(conn, buf[:]); err != nil || !strings.HasPrefix(string(buf[:]), "RFB 003.") {
		return result, errScreenSharingUnreachable
	}
	result.Greeting = strings.TrimRight(string(buf[:]), "\n")
	version := string(buf[:])
	switch version {
	case "RFB 003.003\n", "RFB 003.007\n", "RFB 003.008\n":
	case "RFB 003.889\n": // Apple Remote Desktop also supports RFB 3.8.
		version = "RFB 003.008\n"
	default:
		return result, errScreenSharingUnreachable
	}
	if _, err := io.WriteString(conn, version); err != nil {
		return result, errScreenSharingUnreachable
	}
	reader := bufio.NewReader(conn)
	var count byte
	if version == "RFB 003.003\n" {
		var securityType uint32
		if err := binary.Read(reader, binary.BigEndian, &securityType); err != nil {
			return result, errScreenSharingUnreachable
		}
		if securityType != 0 {
			result.Handshake = true
			result.Types = 1
			return result, nil
		}
	} else {
		var err error
		count, err = reader.ReadByte()
		if err != nil {
			result.Handshake = true
			result.Denied = true
			result.Reason = "the connection closed after the version exchange; it may not be authorized in System Settings yet"
			return result, nil
		}
	}
	if count == 0 {
		var length uint32
		if err := binary.Read(reader, binary.BigEndian, &length); err != nil {
			result.Handshake = true
			result.Denied = true
			result.Reason = "the server refused the connection without giving a reason"
			return result, nil
		}
		if length > 2048 {
			length = 2048
		}
		reason := make([]byte, length)
		_, _ = io.ReadFull(reader, reason)
		result.Handshake = true
		result.Reason = strings.TrimSpace(string(reason))
		// A zero security-type count is always a refusal in RFB 3.8.
		result.Denied = true
		return result, nil
	}
	if _, err := io.CopyN(io.Discard, reader, int64(count)); err != nil {
		return result, errScreenSharingUnreachable
	}
	result.Handshake = true
	result.Types = int(count)
	return result, nil
}

func (s *Server) ensureMacOSScreenSharingTunnel(ctx context.Context) (int, error) {
	session := &s.screenSharing
	session.mu.Lock()
	defer session.mu.Unlock()
	s.mu.Lock()
	ready := s.ready && !s.closing
	life := s.lifetimeContextLocked()
	s.mu.Unlock()
	if !ready {
		return 0, errScreenSharingNotReady
	}
	deadline, cancelWait := context.WithTimeout(ctx, 8*time.Second)
	defer cancelWait()
	if session.aliveLocked() {
		if err := probeScreenSharingRFB(deadline, net.JoinHostPort("127.0.0.1", strconv.Itoa(session.port))); err == nil && session.aliveLocked() {
			return session.port, nil
		}
	}
	session.stopLocked()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, errors.New("cannot allocate a Screen Sharing port on the local loopback address")
	}
	port := ln.Addr().(*net.TCPAddr).Port
	if err := ln.Close(); err != nil {
		return 0, err
	}
	args, err := guestos.MacOSScreenSharingSSHArgs(s.profile, s.macosGuest.User, port)
	if err != nil {
		return 0, err
	}
	args = append(args, "cage-macos")
	cmdCtx, cancel := context.WithCancel(life)
	cmd := exec.CommandContext(cmdCtx, sshExecutable(), args...)
	cmd.Env = sshEnvironment()
	host.HideCommandWindow(cmd)
	if cmd.Err != nil {
		cancel()
		return 0, errors.New("cannot prepare the guest SSH forwarding")
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return 0, err
	}
	if err := cmd.Start(); err != nil {
		cancel()
		return 0, errors.New("cannot start the guest SSH forwarding")
	}
	// OpenSSH emits the marker from its fixed LocalCommand only after it
	// authenticates the guest and binds the requested port. A different
	// listener can otherwise win the port allocation race and imitate RFB.
	bound := make(chan bool, 1)
	done := make(chan struct{})
	go func() {
		var marker [1]byte
		_, err := io.ReadFull(stdout, marker[:])
		bound <- err == nil && marker[0] == '1'
		_ = cmd.Wait()
		close(done)
	}()
	session.cancel, session.done, session.port = cancel, done, port
	select {
	case ok := <-bound:
		if ok && probeScreenSharingRFB(deadline, net.JoinHostPort("127.0.0.1", strconv.Itoa(port))) == nil && session.aliveLocked() {
			return port, nil
		}
	case <-deadline.Done():
	case <-life.Done():
	}
	session.stopLocked()
	return 0, errScreenSharingUnreachable
}

func (ss *macOSScreenSharing) aliveLocked() bool {
	if ss.done == nil {
		return false
	}
	select {
	case <-ss.done:
		return false
	default:
		return true
	}
}

func (s *Server) closeMacOSScreenSharing() {
	s.screenSharing.mu.Lock()
	defer s.screenSharing.mu.Unlock()
	s.screenSharing.stopLocked()
}

func (ss *macOSScreenSharing) stopLocked() {
	if ss.cancel != nil {
		ss.cancel()
		<-ss.done
		ss.cancel = nil
		ss.done = nil
		ss.port = 0
	}
}
