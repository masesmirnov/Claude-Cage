package workbench

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/sylvinus/agent-vm/internal/cage"
	"github.com/sylvinus/agent-vm/internal/guestos"
)

type initializationRecord struct {
	Version   int  `json:"version"`
	Completed bool `json:"completed"`
	Started   bool `json:"started,omitempty"`
}

type initializationView struct {
	Required bool `json:"required"`
	Started  bool `json:"started"`
	Tracked  bool `json:"tracked"`
	Prepared bool `json:"prepared"`
}

func (s *Server) initializationState() (initializationView, error) {
	if !s.localVMStorage() || s.storageRecoveryStatus().Required {
		return initializationView{}, nil
	}
	data, err := os.ReadFile(filepath.Join(s.profile, "initialization.json"))
	if err == nil {
		var record initializationRecord
		if json.Unmarshal(data, &record) != nil || record.Version != 1 {
			return initializationView{}, errors.New("The setup record could not be read. Keep the existing data and export a diagnostics bundle.")
		}
		return initializationView{Required: !record.Completed || s.macSetupPending(), Started: record.Started, Tracked: true, Prepared: s.environmentPrepared()}, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return initializationView{}, err
	}
	// Existing installations predate this screen. A directory or partial disk
	// alone is not proof of a completed Linux installation.
	pending, err := guestos.LoadInstallation(s.profile)
	if err != nil {
		return initializationView{}, err
	}
	if s.macosGuest != nil || s.windowsGuest != nil {
		return initializationView{Required: s.macSetupPending()}, nil
	}
	return initializationView{Required: pending != nil || !s.environmentPrepared(), Started: pending != nil}, nil
}

func (s *Server) finishInitialization() error {
	if s.macSetupPending() {
		return errors.New("Confirm the guest system permissions first.")
	}
	s.mu.Lock()
	ready, gate := s.ready, s.safety.Gate
	s.mu.Unlock()
	if !ready || !s.vmRunning() {
		return errors.New("The guest is not ready. Continue the installation and finish the startup checks.")
	}
	cfg, err := loadConfig(s.configPath)
	if err != nil {
		return err
	}
	if err := cfg.RequireManagedProxy(s.profile); err != nil {
		return err
	}
	if gate == nil || gate.Mode != cage.GateOpen || !gate.PolicyVerified || gate.Fault || gate.Report == nil || !gate.Until.After(time.Now()) || gate.Configuration != cfg.Fingerprint() || gate.Report.Authorizes(gate.RunID, cfg.Fingerprint(), time.Now()) != nil {
		return errors.New("The environment network check has not passed. Run it again on the setup screen.")
	}
	return writePrivate(filepath.Join(s.profile, "initialization.json"), initializationRecord{Version: 1, Completed: true})
}

func (s *Server) initialization(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		state, err := s.initializationState()
		if err != nil {
			requestError(w, err)
			return
		}
		jsonReply(w, state)
		return
	}
	if !s.hasTrustedView(r) || !s.localVMStorage() {
		http.Error(w, "Finish setup in the Cage window on this computer.", http.StatusForbidden)
		return
	}
	var input struct {
		Action string `json:"action"`
	}
	if !readJSON(w, r, &input) {
		return
	}
	if !s.op.TryLock() {
		http.Error(w, "An environment operation is still running. Wait for it to finish, then continue.", http.StatusConflict)
		return
	}
	defer s.op.Unlock()
	if s.busy() {
		http.Error(w, "An environment operation is still running. Wait for it to finish, then continue.", http.StatusConflict)
		return
	}
	state, err := s.initializationState()
	if err != nil {
		requestError(w, err)
		return
	}
	switch input.Action {
	case "begin":
		if state.Required {
			err = writePrivate(filepath.Join(s.profile, "initialization.json"), initializationRecord{Version: 1, Started: state.Started})
		}
	case "install":
		if state.Required {
			err = writePrivate(filepath.Join(s.profile, "initialization.json"), initializationRecord{Version: 1, Started: true})
		}
	case "complete":
		err = s.finishInitialization()
	default:
		err = errors.New("Unknown setup operation.")
	}
	if err != nil {
		requestError(w, err)
		return
	}
	jsonReply(w, map[string]bool{"completed": input.Action == "complete" || !state.Required})
}
