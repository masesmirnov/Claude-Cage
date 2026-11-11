package workbench

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"time"
)

type vaultBrowserInput struct {
	Action    string   `json:"action"`
	Tab       string   `json:"tab"`
	ID        string   `json:"id"`
	Candidate string   `json:"candidate"`
	Document  string   `json:"document"`
	Origin    string   `json:"origin"`
	Lease     string   `json:"lease,omitempty"`
	Username  string   `json:"username,omitempty"`
	Password  string   `json:"password,omitempty"`
	Blocked   []string `json:"blocked,omitempty"`
}
type vaultCandidate struct {
	ID       string `json:"id"`
	Tab      string `json:"tab"`
	Origin   string `json:"origin"`
	Username string `json:"username"`
	Password string `json:"password,omitempty"`
	Update   bool   `json:"update"`
}
type vaultBrowserState struct {
	Available  bool             `json:"available"`
	Origin     string           `json:"origin"`
	Document   string           `json:"document"`
	Candidates []vaultCandidate `json:"candidates"`
	Entries    []vaultEntry     `json:"entries"`
}

func (s *Server) vaultList(w http.ResponseWriter, r *http.Request) {
	var out vaultData
	err := s.account.withVault(r.Context(), false, func(db *vaultData) error {
		out = *db
		out.GuestPasswords = nil
		for i := range out.Entries {
			out.Entries[i].Password = ""
		}
		return nil
	})
	if err != nil {
		requestError(w, err)
		return
	}
	jsonReply(w, out)
}
func (s *Server) vaultMutation(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Action          string     `json:"action"`
		Entry           vaultEntry `json:"entry"`
		ID              string     `json:"id"`
		Origin          string     `json:"origin"`
		AccountPassword string     `json:"account_password"`
	}
	if !readJSON(w, r, &input, 32<<10) {
		return
	}
	if input.Action == "reveal" {
		if err := s.account.verifyVaultPassword(input.AccountPassword); err != nil {
			requestError(w, err)
			return
		}
	}
	result := map[string]any{"ok": true}
	err := s.account.withVault(r.Context(), input.Action != "reveal", func(db *vaultData) error {
		switch input.Action {
		case "save":
			return db.save(input.Entry)
		case "delete":
			db.Entries = slices.DeleteFunc(db.Entries, func(e vaultEntry) bool { return e.ID == input.ID })
		case "unblock":
			db.Blocked = slices.DeleteFunc(db.Blocked, func(origin string) bool { return origin == input.Origin })
		case "reveal":
			for _, entry := range db.Entries {
				if entry.ID == input.ID {
					result["password"] = entry.Password
					return nil
				}
			}
			return errors.New("The password record does not exist.")
		default:
			return errors.New("The password vault operation is invalid.")
		}
		return nil
	})
	if err != nil {
		requestError(w, err)
		return
	}
	jsonReply(w, result)
}

func (s *Server) guestVault(ctx context.Context, input vaultBrowserInput, out any) error {
	s.mu.Lock()
	ready, token := s.ready, s.credentials.Token
	s.mu.Unlock()
	if !ready {
		return errBrowserNotReady
	}
	body, _ := json.Marshal(input)
	defer clear(body)
	data, err := s.guestAPI(ctx, token, http.MethodPost, "/vault", body)
	defer clear(data)
	if err != nil {
		return errors.New("The browser password feature is unavailable right now. Update the environment components and try again.")
	}
	var failure struct {
		Error string `json:"vaultError"`
	}
	if json.Unmarshal(data, &failure) == nil && failure.Error != "" {
		switch failure.Error {
		case "Sign-in record expired. Sign in again.", "The current page has changed", "No sign-in form to fill was found, or the page has changed", "The vault is locked. Try again.", "The sign-in page has changed. Try again later.":
			return errors.New(failure.Error)
		default:
			return errors.New("The web page could not handle the password operation. Refresh and try again.")
		}
	}
	if json.Unmarshal(data, out) != nil {
		return errors.New("The browser password response is invalid.")
	}
	return nil
}

func (s *Server) vaultBrowser(w http.ResponseWriter, r *http.Request) {
	var input vaultBrowserInput
	if !readJSON(w, r, &input, 16<<10) {
		return
	}
	// Passwords and origins used for fill always come from the host database.
	input.Password, input.Username, input.Origin, input.Lease, input.Blocked = "", "", "", "", nil
	s.account.mu.Lock()
	lease := s.account.vaultLease
	s.account.mu.Unlock()
	input.Lease = lease
	var result any = map[string]bool{"ok": true}
	err := s.account.withVault(r.Context(), input.Action == "save" || input.Action == "never", func(db *vaultData) error {
		if lease == "" || lease != s.account.vaultLease {
			return errors.New("Unlock again and try again.")
		}
		switch input.Action {
		case "status":
			input.Blocked = db.Blocked
			state := vaultBrowserState{Candidates: []vaultCandidate{}, Entries: []vaultEntry{}}
			if err := s.guestVault(r.Context(), input, &state); err != nil {
				result = map[string]any{"available": false, "message": err.Error(), "candidates": []vaultCandidate{}, "entries": []vaultEntry{}}
				return nil
			}
			pending := []vaultCandidate{}
			for _, candidate := range state.Candidates {
				if slices.Contains(db.Blocked, candidate.Origin) {
					continue
				}
				same := false
				for _, entry := range db.Entries {
					if entry.Origin == candidate.Origin && entry.Username == candidate.Username {
						candidate.Update = true
						same = entry.Password == candidate.Password
					}
				}
				candidate.Password = ""
				if !same {
					pending = append(pending, candidate)
				}
			}
			state.Candidates = pending
			state.Entries = []vaultEntry{}
			for _, entry := range db.Entries {
				if entry.Origin == state.Origin {
					entry.Password = ""
					state.Entries = append(state.Entries, entry)
				}
			}
			result = state
		case "fill":
			for _, entry := range db.Entries {
				if entry.ID == input.ID {
					input.Origin, input.Username, input.Password = entry.Origin, entry.Username, entry.Password
					var reply map[string]any
					return s.guestVault(r.Context(), input, &reply)
				}
			}
			return errors.New("The password record does not exist.")
		case "save", "never":
			request := input
			request.Action = "candidate"
			var candidate vaultCandidate
			if err := s.guestVault(r.Context(), request, &candidate); err != nil {
				return err
			}
			origin, err := vaultOrigin(candidate.Origin)
			if err != nil || origin != candidate.Origin || candidate.ID != input.Candidate {
				return errors.New("The sign-in record is no longer valid. Sign in again.")
			}
			if input.Action == "never" {
				if !slices.Contains(db.Blocked, origin) {
					db.Blocked = append(db.Blocked, origin)
				}
				return nil
			}
			entry := vaultEntry{Origin: origin, Username: candidate.Username, Password: candidate.Password}
			for _, old := range db.Entries {
				if old.Origin == origin && old.Username == entry.Username {
					entry.ID = old.ID
				}
			}
			return db.save(entry)
		case "dismiss":
			var reply map[string]any
			return s.guestVault(r.Context(), input, &reply)
		default:
			return errors.New("The password vault operation is invalid.")
		}
		return nil
	})
	if err != nil {
		requestError(w, err)
		return
	}
	if input.Action == "save" || input.Action == "never" {
		input.Action = "dismiss"
		var ignored map[string]any
		_ = s.guestVault(r.Context(), input, &ignored)
	}
	jsonReply(w, result)
}

func (s *Server) clearBrowserVault(lease string) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	var out map[string]any
	_ = s.guestVault(ctx, vaultBrowserInput{Action: "lock", Lease: lease}, &out)
}
