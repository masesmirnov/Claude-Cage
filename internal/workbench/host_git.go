package workbench

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/sylvinus/agent-vm/internal/gitguard"
	"github.com/sylvinus/agent-vm/internal/gitx"
)

type hostGitState struct {
	State     string `json:"state"`
	Ready     bool   `json:"ready"`
	CanEnable bool   `json:"can_enable"`
	Message   string `json:"message"`
}

func inspectHostGit(ctx context.Context) hostGitState {
	state := gitguard.BareState(ctx)
	view := hostGitState{State: state}
	switch state {
	case gitguard.BareOK:
		view.Ready = true
		view.Message = "Git safety protection is enabled on this computer."
	case gitguard.BareNoGit:
		view.Ready = true
		view.Message = "No usable Git is installed on this computer, so nothing needs to change. It will be checked again the next time the environment starts."
	case gitguard.BareUnset:
		view.CanEnable = true
		view.Message = "Git safety protection on this computer must be enabled before starting."
	case gitguard.BareOld:
		view.Message = "Git on this computer is too old. Upgrade to version 2.38 or later and check again."
	default:
		view.Message = "Git on this computer cannot be checked right now. Make sure Git is fully installed, then check again. Cage will not open the installer automatically."
	}
	return view
}

func (s *Server) hostGit(w http.ResponseWriter, r *http.Request) {
	jsonReply(w, inspectHostGit(r.Context()))
}

func (s *Server) enableHostGit(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Confirm bool `json:"confirm"`
	}
	if !readJSON(w, r, &input) {
		return
	}
	if !input.Confirm {
		http.Error(w, "Confirm enabling Git safety protection on this computer first.", http.StatusBadRequest)
		return
	}
	if !s.op.TryLock() {
		http.Error(w, "An environment operation is in progress. Try again after it finishes.", http.StatusConflict)
		return
	}
	defer s.op.Unlock()
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	before := inspectHostGit(ctx)
	if before.Ready {
		jsonReply(w, before)
		return
	}
	if !before.CanEnable {
		http.Error(w, before.Message, http.StatusConflict)
		return
	}
	cmd := gitx.Untrusted(ctx, "config", "--global", "--replace-all", "safe.bareRepository", "explicit")
	cmd.Dir = s.profile
	if err := cmd.Run(); err != nil {
		http.Error(w, "The Git safety settings could not be saved. Check the write permissions of the global Git configuration, close other Git settings operations, and try again.", http.StatusInternalServerError)
		return
	}
	after := inspectHostGit(ctx)
	if !after.Ready {
		http.Error(w, "The Git settings were written, but the check has not passed. Check the global Git configuration and run the check again.", http.StatusConflict)
		return
	}
	jsonReply(w, after)
}

func requireHostGit(ctx context.Context) error {
	state := inspectHostGit(ctx)
	if !state.Ready {
		return errors.New(state.Message + " Click Start in the workbench and follow the prompts to finish the check.")
	}
	return nil
}
