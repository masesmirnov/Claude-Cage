package workbench

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/sylvinus/agent-vm/internal/cage"
	"github.com/sylvinus/agent-vm/internal/diagnostics"
	"github.com/sylvinus/agent-vm/internal/guestos"
)

func macOSInstallRecoveryRoute(method, path string) bool {
	if path == "/api/diagnostics" || path == "/api/diagnostics/export" ||
		strings.HasPrefix(path, "/api/diagnostics/events") {
		return true
	}
	if method == http.MethodGet {
		switch path {
		case "/api/account", "/api/status", "/api/proxy", "/api/proxy/connections", "/api/proxy/logs",
			"/api/environment/initialization", "/api/environment/guest-systems", "/api/host/git",
			"/api/macos/install-recovery", "/api/remote/manifest":
			return true
		}
		return strings.HasPrefix(path, "/api/agent/jobs/")
	}
	if method == http.MethodPost {
		switch path {
		case "/api/account/unlock", "/api/account/lock", "/api/account/recovery-generate", "/api/account/recovery-reset", "/api/environment/initialization",
			"/api/environment/guest-systems/activate", "/api/host/git", "/api/stop", "/api/start",
			"/api/macos/install-recovery", "/api/session", "/api/launch", "/api/handoff":
			return true
		}
	}
	// Re-selection of the guest system is the one destructive call the recovery
	// mode needs: an unstarted installation has no disk to protect yet, and the
	// DELETE handler still refuses once any partial VM exists.
	if method == http.MethodDelete {
		return path == "/api/environment/guest-systems"
	}
	return false
}

// recordInstallRecovery keeps the precise, sanitized cause of a refused
// recovery operation in the local diagnostics log. Client messages stay
// generic on purpose: they never reveal the guest account or machine
// identity that the recovery record protects.
func (s *Server) recordInstallRecovery(detail string) {
	_ = diagnostics.New(s.profile).Record("warn", "macos-install-recovery", detail)
}

// macOSInstallRecovery exposes only the pending VM's setup screen and fixed
// lifecycle operations. It never creates or substitutes a MacOSProfile.
func (s *Server) macOSInstallRecovery(w http.ResponseWriter, r *http.Request) {
	if !s.hasTrustedView(r) || !s.localVMStorage() {
		http.Error(w, "Continue the installation in the local Cage window", http.StatusForbidden)
		return
	}
	recovery, err := guestos.LoadMacOSInstallRecovery(s.profile)
	if err != nil {
		s.recordInstallRecovery("The recovery entry identity verification failed: " + err.Error())
		http.Error(w, "The install recovery entry identity verification failed; the original disk and install record were kept. Please try again later; if it still fails, export a diagnostics bundle in \"Logs and diagnostics\"", http.StatusConflict)
		return
	}
	if s.macosGuest != nil {
		s.recordInstallRecovery("A bound macOS guest already exists, so the install recovery entry is disabled")
		http.Error(w, "A bound macOS guest already exists, so the installation does not need to be restored; the original disk and install record were kept", http.StatusConflict)
		return
	}
	if recovery == nil {
		if r.Method == http.MethodGet {
			install, loadErr := guestos.LoadInstallation(s.profile)
			canPrepare := false
			if loadErr == nil && install != nil && install.System == guestos.MacOS {
				canPrepare, loadErr = guestos.CanRecoverMacOSInstall(s.profile, install.ID)
			}
			if loadErr != nil {
				s.recordInstallRecovery("failed to confirm that the original install record can be restored: " + loadErr.Error())
				http.Error(w, "Cannot confirm right now whether the original install record can be restored; please try again later. Existing data was kept, and you can export a diagnostics bundle in \"Logs and diagnostics\"", http.StatusConflict)
				return
			}
			jsonReply(w, map[string]bool{"available": false, "can_prepare": canPrepare})
			return
		}
		var input guestos.MacLoginRequest
		if !readJSON(w, r, &input) || input.Action != "prepare" {
			http.Error(w, "Confirm the original install record first", http.StatusConflict)
			return
		}
		install, loadErr := guestos.LoadInstallation(s.profile)
		if loadErr != nil {
			s.recordInstallRecovery("failed to read the original install record: " + loadErr.Error())
			http.Error(w, "The original install record cannot be read right now; please try again later. Existing data was kept, and you can export a diagnostics bundle in \"Logs and diagnostics\"", http.StatusConflict)
			return
		}
		if install == nil || install.System != guestos.MacOS {
			s.recordInstallRecovery("preparing the recovery entry was refused: there is no matching macOS install record")
			http.Error(w, "There is no macOS install record to restore; go back to the initialization page and confirm again", http.StatusConflict)
			return
		}
		credential, loadErr := s.account.macGuestCredentials(r.Context(), install.ID)
		if loadErr != nil {
			s.recordInstallRecovery("Failed to read the original guest credentials: " + loadErr.Error())
			http.Error(w, "The original guest credentials cannot be read right now; confirm the Cage credentials and try again. The original account and disk were kept", http.StatusConflict)
			return
		}
		if !guestos.ValidMacOSAccountName(credential.Username) || credential.Password == "" {
			s.recordInstallRecovery("preparing the recovery entry was refused: the original guest credentials are incomplete")
			http.Error(w, "The original guest credentials are incomplete; confirm the Cage credentials in Settings and try again. The original account and disk were kept", http.StatusConflict)
			return
		}
		canRecover, loadErr := guestos.CanRecoverMacOSInstall(s.profile, install.ID)
		if loadErr != nil {
			s.recordInstallRecovery("Failed to check the original guest disk identity: " + loadErr.Error())
			http.Error(w, "The original guest disk identity cannot be checked right now; please try again later. The disk and install record were kept", http.StatusConflict)
			return
		}
		if !canRecover {
			s.recordInstallRecovery("preparing the recovery entry was refused: the original guest disk or machine ID is not ready yet")
			http.Error(w, "The original guest disk or machine ID is not ready yet, so the recovery entry cannot be prepared for now; the disk and install record were kept", http.StatusConflict)
			return
		}
		s.launch(w, "macos-install-recovery", func() error {
			if err := guestos.CreateMacOSInstallRecovery(s.profile, credential.Username, install.ID); err != nil {
				return err
			}
			cmd := exec.CommandContext(s.operationContext(), s.exe, "guest-os", "macos", "stop")
			cmd.Env = append(os.Environ(), cage.ConfigEnv+"="+s.configPath)
			cmd.Stdout, cmd.Stderr = s.jobs.execution(), s.jobs.execution()
			return cmd.Run()
		})
		return
	}
	if r.Method == http.MethodGet {
		identity, err := guestos.LoadMacOSProfileOrRecovery(s.profile)
		if err != nil || identity == nil {
			http.Error(w, "Cannot check the recovery guest identity", http.StatusConflict)
			return
		}
		jsonReply(w, map[string]any{"available": true, "phase": recovery.Phase, "running": macOSInstanceRunning(filepath.Join(s.profile, "state", "lima", "mac"), identity.Backend)})
		return
	}
	var input guestos.MacLoginRequest
	if !readJSON(w, r, &input) {
		return
	}
	switch input.Action {
	case "start":
		s.launch(w, "macos-install-recovery", func() error {
			cmd := exec.CommandContext(s.operationContext(), s.exe, "guest-os", "macos", "start")
			cmd.Env = append(os.Environ(), cage.ConfigEnv+"="+s.configPath)
			cmd.Stdout, cmd.Stderr = s.jobs.execution(), s.jobs.execution()
			return cmd.Run()
		})
		return
	case "resume":
		s.beginGuestInstallMode(w, r, guestInstallRequest{System: guestos.MacOS}, true, recovery.User)
		return
	case "open", "close", "frame", "click", "key", "scroll":
	default:
		http.Error(w, "The recovery screen operation is invalid", http.StatusBadRequest)
		return
	}
	input.Setup = true
	input.Maintenance = ""
	input.Password = ""
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	var dial net.Dialer
	conn, err := dial.DialContext(ctx, "unix", filepath.Join(s.profile, "state", "lima", "mac", "cage-login.sock"))
	if err != nil {
		s.recordInstallRecovery("Failed to connect to the recovery screen: " + err.Error())
		http.Error(w, "Start the recovery guest first", http.StatusConflict)
		return
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(8 * time.Second))
	if err := json.NewEncoder(conn).Encode(input); err != nil {
		s.recordInstallRecovery(fmt.Sprintf("Failed to send the recovery screen request: %v", err))
		http.Error(w, "The recovery screen is not responding", http.StatusServiceUnavailable)
		return
	}
	var result guestos.MacLoginReply
	if err := json.NewDecoder(io.LimitReader(conn, 6<<20)).Decode(&result); err != nil {
		s.recordInstallRecovery(fmt.Sprintf("Failed to read the recovery screen response: %v", err))
		http.Error(w, "The recovery screen is not responding", http.StatusServiceUnavailable)
		return
	}
	if input.Action == "close" || result.Closed {
		s.mu.Lock()
		lease := s.macLoginLease
		matching := lease != nil && lease.request.Session == input.Session
		s.mu.Unlock()
		if matching && s.jobs.snapshot().Kind == "guest-install" {
			s.jobs.cancelRunning()
		}
	}
	epoch, _ := s.account.access()
	// lifetimeContext takes s.mu; resolve it before the lease critical section
	// below takes the same lock.
	lifetime := s.lifetimeContext()
	if input.Action == "open" && result.Session != "" {
		lease := &macLoginLease{request: guestos.MacLoginRequest{Action: "close", Session: result.Session, Setup: true}, socket: filepath.Join(s.profile, "state", "lima", "mac", "cage-login.sock")}
		s.mu.Lock()
		previous := s.macLoginLease
		s.macLoginLease = lease
		lease.stopAccount = context.AfterFunc(epoch, func() { s.revokeMacLogin(result.Session) })
		lease.stopService = context.AfterFunc(lifetime, func() { s.revokeMacLogin(result.Session) })
		s.mu.Unlock()
		previous.stop()
	} else if input.Action == "close" || result.Closed {
		s.trackMacLogin(epoch, input, result)
	}
	w.Header().Set("Cache-Control", "no-store")
	jsonReply(w, result)
}
