package workbench

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

type networkIntent struct {
	Version      int    `json:"version"`
	Paused       bool   `json:"paused"`
	PauseVersion uint64 `json:"pause_version"`
}

// An absent record can belong to an older profile whose pause was memory-only.
// Keep it offline until an explicit user operation establishes a durable intent.
func (s *Server) restoreNetworkIntent() error {
	paused, generation := true, uint64(0)
	data, err := os.ReadFile(filepath.Join(s.profile, "network-intent.json"))
	if err == nil {
		var record struct {
			Version      int     `json:"version"`
			Paused       *bool   `json:"paused"`
			PauseVersion *uint64 `json:"pause_version"`
		}
		if json.Unmarshal(data, &record) != nil || record.Version != 1 || record.Paused == nil || record.PauseVersion == nil {
			err = errors.New("The saved network pause state is invalid.")
		} else {
			paused, generation = *record.Paused, *record.PauseVersion
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.networkPaused, s.safety.pauseVersion = paused, generation
	if err != nil && !os.IsNotExist(err) {
		s.networkIntentError = "The network pause state could not be read. Internet access stays off. Confirm, then resume manually."
		return errors.New(s.networkIntentError)
	}
	s.networkIntentError = ""
	return nil
}

// Caller holds mu so a later pause cannot be overwritten by a pending resume.
func (s *Server) saveNetworkIntentLocked(paused bool) error {
	if err := writePrivate(filepath.Join(s.profile, "network-intent.json"), networkIntent{Version: 1, Paused: paused, PauseVersion: s.safety.pauseVersion}); err != nil {
		s.networkPaused = true
		s.networkIntentError = "The network pause state could not be saved. Internet access stays off. Fix the configuration write problem and try again."
		return fmt.Errorf("The network pause state could not be saved. Internet access stays off for now. Fix the configuration write problem and try again: %w", err)
	}
	s.networkPaused = paused
	s.networkIntentError = ""
	return nil
}

func (s *Server) resumeNetworkIntentAt(generation uint64) error {
	s.mu.Lock()
	if generation != s.safety.pauseVersion {
		s.mu.Unlock()
		return nil
	}
	err := s.saveNetworkIntentLocked(false)
	s.mu.Unlock()
	if err != nil {
		_ = s.closeProxyGate("The network recovery intent could not be saved. Internet access stays off")
	}
	return err
}
