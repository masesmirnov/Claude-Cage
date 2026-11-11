package workbench

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"al.essio.dev/pkg/shellescape"

	"github.com/sylvinus/agent-vm/internal/cage"
	"github.com/sylvinus/agent-vm/internal/guestos"
	"github.com/sylvinus/agent-vm/internal/host"
)

// Only the trusted local workbench can operate the native Mac. Each route
// must have a native guest implementation or run entirely on the host.
func macOSWorkbenchRoute(path string) bool {
	if nativeWorkbenchRoute(path) {
		return true
	}
	if id, ok := strings.CutPrefix(path, "/api/input/files/desktop/"); ok {
		return id == "requests" || id == "open" || browserFileID.MatchString(id)
	}
	switch path {
	case "/api/macos/first-setup", "/api/appearance/codex", "/api/macos/project-approval", "/api/macos/exit-policy", "/api/macos/login", "/api/macos/maintenance":
		return true
	}
	return strings.HasPrefix(path, "/api/macos/claude/") || strings.HasPrefix(path, "/api/macos-browser/")
}

func macOSInstanceRunning(instanceDir string) bool {
	data, err := os.ReadFile(filepath.Join(instanceDir, "cage-running.json"))
	var record struct {
		PID     int    `json:"pid"`
		Started string `json:"started"`
	}
	if err != nil || json.Unmarshal(data, &record) != nil || record.PID < 1 {
		return false
	}
	return processExists(record.PID) && cage.ProcessStartMatches(record.PID, record.Started)
}

func (s *Server) macOSSSHCommand(ctx context.Context, args ...string) *exec.Cmd {
	base, err := guestos.MacOSSSHArgs(s.profile, s.macosGuest.User)
	if err != nil {
		return &exec.Cmd{Err: err}
	}
	cmd := exec.CommandContext(ctx, sshExecutable(), append(base, args...)...)
	cmd.Env = sshEnvironment()
	host.HideCommandWindow(cmd)
	return cmd
}

func (s *Server) checkMacOSGuest(ctx context.Context) error {
	if !s.vmRunning() {
		return errors.New("The macOS guest has not started.")
	}
	client, err := s.gateClient()
	if err != nil {
		return errors.New("Could not verify the network isolation state of the macOS guest.")
	}
	state, err := client.Status(ctx)
	if err != nil {
		return errors.New("Could not verify the network gate of the macOS guest.")
	}
	if state.Mode != cage.GateClosed {
		s.mu.Lock()
		ready, paused := s.ready, s.networkPaused
		s.mu.Unlock()
		reason := ""
		switch {
		case s.macSetupPending():
			reason = "Internet access is off during first-time system setup"
		case paused:
			reason = "The network stays paused. Resume it manually before going online"
		case !ready:
			reason = "The guest reconnected. Internet access is waiting for a new check"
		default:
			cfg, cfgErr := loadConfig(s.configPath)
			if state.Mode != cage.GateOpen || cfgErr != nil || state.Report == nil || !time.Now().Before(state.Until) || state.Report.Authorizes(state.RunID, cfg.Fingerprint(), time.Now()) != nil {
				reason = "The network authorization did not pass the full check for the current configuration"
			}
		}
		if reason != "" {
			state, err = client.Close(ctx, reason)
			if err != nil || state.Mode != cage.GateClosed {
				return errors.New("The network state of the macOS guest cannot be confirmed.")
			}
		}
	}
	s.publishGate(state)
	probe := `test "$(uname -s)" = Darwin && [[ $(sysctl -n hw.model) == VirtualMac* ]] && test "$(id -un)" = ` +
		shellescape.Quote(s.macosGuest.User) + ` && [[ " $(id -Gn) " != *" admin "* ]]`
	if _, err := s.guest(ctx, probe); err != nil {
		return errors.New("Could not connect to this virtual Mac as the bound regular user. Check the guest identity and SSH sign-in.")
	}
	return nil
}

func (s *Server) attachMacOSGuest() error {
	ctx, cancel := s.controlContext()
	defer cancel()
	err := s.checkMacOSGuest(ctx)
	s.mu.Lock()
	newlyReady := !s.ready && err == nil
	checkAfterReconnect := newlyReady && !s.closing && !s.networkPaused && !s.jobs.snapshot().Running
	s.ready = err == nil
	s.guestUpdateError = ""
	if err != nil {
		s.guestUpdateError = err.Error()
	}
	s.mu.Unlock()
	if newlyReady && !s.macSetupPending() {
		s.restoreProjectShares()
		if checkAfterReconnect {
			_, _ = s.submitJob("network-recovery", s.checkNetworkIfWanted)
		}
	} else if err == nil && !s.macSetupPending() {
		s.retryMacOSProjectShares(ctx)
	}
	return err
}

func (s *Server) macOSLifecycleCommand(action string) error {
	ctx, cancel := context.WithTimeout(s.operationContext(), 5*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, s.exe, "guest-os", "macos", action)
	cmd.Env = append(os.Environ(), cage.ConfigEnv+"="+s.configPath)
	job := s.jobs.execution()
	cmd.Stdout, cmd.Stderr = job, job
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("The macOS guest operation failed (%s): %w", action, err)
	}
	return nil
}

func (s *Server) startMacOSGuest() error {
	if !s.vmRunning() {
		if err := s.macOSLifecycleCommand("start"); err != nil {
			return err
		}
	}
	if err := s.syncMacGuestPassword(s.operationContext()); err != nil {
		return err
	}
	if err := s.attachMacOSGuest(); err != nil {
		return err
	}
	return s.checkNetworkIfWanted()
}

//go:embed macos-locale.sh
var macOSLocaleScript string

func (s *Server) syncMacOSRegion(ctx context.Context, cfg cage.Config) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	s.setMessage("Applying the region and language of the macOS guest account…")
	locale := strings.TrimSuffix(cfg.Locale, ".UTF-8")
	cmd := shellescape.QuoteCommand([]string{"/bin/bash", "-c", macOSLocaleScript, "cage-locale", "NSGlobalDomain", locale})
	if _, err := s.guest(ctx, "exec "+cmd); err != nil {
		return fmt.Errorf("The macOS guest started, but the region and language could not be written to the guest account: %w", err)
	}
	s.setMessage("Waiting for the macOS guest to read back the saved time zone and language…")
	var last guestObservation
	for {
		got, err := s.macOSGuestObservation(ctx, map[string]any{"stage": "environment"})
		if err == nil {
			last = got
			if s.guestSettingsOK(got, cfg) {
				return nil
			}
		}
		select {
		case <-ctx.Done():
			if errors.Is(ctx.Err(), context.Canceled) {
				return ctx.Err()
			}
			return fmt.Errorf("The time zone and language of the macOS guest have not all taken effect. Expected %s and %s. The system reports time zone %q, region %q, and preferred language %q; the process reports %q and %q. Internet access stays off. Check again later. If the time zone keeps mismatching, stop and restart the guest.", cfg.Timezone, cfg.Locale, last.SystemTimezone, last.SystemLocale, last.SystemLanguage, last.TZ, last.ProcessLocale)
		case <-time.After(time.Second):
		}
	}
}

func (s *Server) stopMacOSGuest() error {
	s.mu.Lock()
	s.macSetupProjectsChecked = time.Time{}
	s.mu.Unlock()
	s.closeWindowsBrowser()
	s.mu.Lock()
	s.ready = false
	s.mu.Unlock()
	s.terminals.closeAll()
	s.closeProjectShares()
	return s.macOSLifecycleCommand("stop")
}
