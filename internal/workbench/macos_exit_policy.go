package workbench

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/sylvinus/agent-vm/internal/cage"
)

// Only the measured address is presented to the local trusted view. The run
// and configuration remain attached to the observation inside the workbench.
type macOSExitCandidate struct {
	IP          string    `json:"ip"`
	Fingerprint string    `json:"-"`
	Run         string    `json:"-"`
	Observed    time.Time `json:"-"`
}

func macOSStaticCandidate(config cage.Config, run, host string, terminal, browser networkObservation) *macOSExitCandidate {
	if host == "" || run == "" || terminal.Status != 200 || browser.Status != 200 || host != terminal.IP || host != browser.IP {
		return nil
	}
	if config.ExitPolicy.Mode == "static" && config.ExitPolicy.IP == host {
		return nil
	}
	return &macOSExitCandidate{IP: host, Fingerprint: config.Fingerprint(), Run: run, Observed: time.Now()}
}

func (s *Server) bindMacOSExit(w http.ResponseWriter, r *http.Request) {
	var input struct {
		IP string `json:"ip"`
	}
	if !readJSON(w, r, &input) {
		return
	}
	s.mu.Lock()
	sample := s.safety.MacOSExitCandidate
	s.mu.Unlock()
	if sample == nil || input.IP != sample.IP {
		http.Error(w, "Run the network check first to get an exit that matches the terminal, browser, and current proxy.", http.StatusConflict)
		return
	}
	s.launch(w, "settings", func() error {
		return s.saveMacOSStaticExit(s.operationContext(), *sample)
	})
}

func (s *Server) saveMacOSStaticExit(ctx context.Context, sample macOSExitCandidate) error {
	cfg, err := loadConfig(s.configPath)
	if err != nil {
		return err
	}
	if s.macosGuest == nil || sample.IP == "" || cfg.Fingerprint() != sample.Fingerprint || time.Since(sample.Observed) > 10*time.Minute || sample.Observed.After(time.Now()) {
		return errors.New("The exit samples have expired or the node has changed. Run the network check again.")
	}
	if err := cfg.RequireManagedProxy(s.profile); err != nil {
		return err
	}
	client, err := s.gateClient()
	if err != nil {
		return err
	}
	state, err := client.Status(ctx)
	if err != nil {
		return err
	}
	if state.RunID != sample.Run || state.Configuration != sample.Fingerprint {
		return errors.New("The guest or network configuration has changed. Run the network check again.")
	}
	loc, err := probeLocation(ctx, cfg)
	if err != nil {
		return err
	}
	observed := loc.exitLocation()
	if observed.IP != sample.IP {
		return errors.New("The current exit does not match the three samples. Confirm the node again.")
	}
	next := (cage.ExitPolicy{Mode: "static"}).BindMissing(observed)
	if verdict, message := next.Evaluate(sample.IP, &observed); verdict != cage.CheckPassed {
		return errors.New(message)
	}
	cfg.ExitPolicy = next
	if err := cfg.Validate(); err != nil {
		return err
	}
	closed, err := client.Close(ctx, "Fixed exit confirmed. Check again after restarting the guest")
	if err != nil {
		return err
	}
	s.publishGate(closed)
	if closed.Mode != cage.GateClosed || closed.RunID != sample.Run || closed.Configuration != sample.Fingerprint {
		return errors.New("Could not confirm that internet access is off for the current guest.")
	}
	if err := s.saveExitPolicyConfig(cfg); err != nil {
		return err
	}
	s.mu.Lock()
	s.safety.MacOSExitCandidate = nil
	s.safety.Error = "Fixed exit saved. Restart the macOS guest, sign in, then run the checks again."
	s.mu.Unlock()
	return nil
}
