package workbench

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"time"
)

var errClaudeAccessLost = errors.New("Cage is locked. Unlock it first.")

type claudeAccountInput struct {
	Action       string            `json:"action"`
	Identity     string            `json:"identity"`
	ID           string            `json:"id"`
	Label        string            `json:"label"`
	Enabled      *bool             `json:"enabled"`
	HandoffGroup *string           `json:"handoff_group"`
	Scheduling   *claudeScheduling `json:"scheduling"`
	Order        []string          `json:"order"`
}

func (s *Server) listClaudeAccounts(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("panel") == "visible" {
		m := &s.claudeAccounts
		m.mu.Lock()
		if m.panelRunning {
			m.panelUntil = time.Now().Add(claudePanelLease)
		}
		m.mu.Unlock()
	}
	view, list, err := s.claudePanelView(r.Context())
	if err != nil {
		requestError(w, err)
		return
	}
	jsonReply(w, view)
	s.pollClaudeAccounts(list)
}

func (s *Server) mutateClaudeAccounts(w http.ResponseWriter, r *http.Request) {
	var input claudeAccountInput
	if !readJSON(w, r, &input) {
		return
	}
	var err error
	switch input.Action {
	case "join":
		err = s.joinClaudeDefault(r.Context(), input.Identity)
	case "cancel":
		_, err = s.cancelClaudeDraft(input.ID)
	case "usage_panel":
		view, list, viewErr := s.claudePanelView(r.Context())
		if viewErr != nil {
			requestError(w, viewErr)
			return
		}
		s.startClaudePanelUsage(list, view.Detected)
		m := &s.claudeAccounts
		m.mu.Lock()
		view.UsagePanelRunning = m.panelRunning
		m.mu.Unlock()
		jsonReply(w, view)
		return
	case "refresh", "refresh_default":
		err = s.refreshClaudeUsage(r.Context(), input)
	case "update", "scheduling":
		s.op.Lock()
		defer s.op.Unlock()
		m := &s.claudeAccounts
		m.mu.Lock()
		list, loadErr := s.loadClaudeAccounts()
		err = loadErr
		if err == nil && input.Action == "scheduling" {
			if input.Scheduling == nil || !input.Scheduling.valid() {
				err = errors.New("Choose a valid scheduling mode and switch authorization.")
			} else {
				list.Scheduling = *input.Scheduling
			}
			if err == nil && input.Order != nil {
				if len(input.Order) != len(list.Accounts) {
					err = errors.New("The account list has changed. Refresh before reordering.")
				} else {
					ordered := make([]claudeAccount, 0, len(input.Order))
					seen := map[string]bool{}
					for _, id := range input.Order {
						a := list.find(id)
						if a == nil || seen[id] {
							err = errors.New("The account order is invalid.")
							break
						}
						seen[id] = true
						ordered = append(ordered, *a)
					}
					if err == nil {
						list.Accounts = ordered
					}
				}
			}
		} else if err == nil {
			err = list.change(input)
		}
		if err == nil {
			err = s.saveClaudeAccounts(list)
		}
		m.mu.Unlock()
	default:
		err = errors.New("Unknown Claude account operation.")
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	s.listClaudeAccounts(w, r)
}

// Terminal admission holds op through publication. Cancellation must not
// remove a draft between selecting the login profile and publishing its PTY.
func (s *Server) cancelClaudeDraft(id string) (claudeAccountList, error) {
	if !validClaudeID(id) {
		return claudeAccountList{}, errors.New("No account to undo was found.")
	}
	if !s.op.TryLock() {
		return claudeAccountList{}, errors.New("The environment is handling another operation. Try again later.")
	}
	defer s.op.Unlock()
	m := &s.claudeAccounts
	m.mu.Lock()
	defer m.mu.Unlock()
	list, err := s.loadClaudeAccounts()
	if err != nil {
		return list, err
	}
	a := list.find(id)
	if a == nil {
		return list, nil
	}
	if a.Email != "" {
		return list, errors.New("A linked account can be paused from assignment, but adding it cannot be undone.")
	}
	if m.refreshing[id] != nil {
		return list, errors.New("The account status check has not finished. Try again later.")
	}
	for _, session := range s.terminals.snapshot() {
		if session["claude_account_id"] == id && session["closed"] == false {
			return list, errors.New("End this account's sign-in or work terminals first, then undo the addition.")
		}
	}
	list.Accounts = slices.DeleteFunc(list.Accounts, func(a claudeAccount) bool { return a.ID == id })
	err = s.saveClaudeAccounts(list)
	if err == nil {
		delete(m.attempted, id)
	}
	return list, err
}

func (s *Server) claudeLoginActive(id string) bool {
	for _, session := range s.terminals.snapshot() {
		if session["kind"] == "claude-login" && session["claude_account_id"] == id && session["closed"] == false {
			return true
		}
	}
	return false
}

func (s *Server) recoverClaudePending(ctx context.Context, id string, force bool) error {
	m := &s.claudeAccounts
	m.mu.Lock()
	recent := time.Since(m.attempted[id]) < time.Minute
	m.mu.Unlock()
	if !force && recent {
		return nil
	}
	return s.refreshClaudeAccount(ctx, id)
}

func (s *Server) pollClaudeAccounts(list claudeAccountList) {
	s.mu.Lock()
	ready := s.ready && !s.closing
	s.mu.Unlock()
	epoch, unlocked := s.account.access()
	if !unlocked || !ready || (len(list.Accounts) == 0 && list.PendingLogin == "") {
		return
	}
	now := time.Now()
	m := &s.claudeAccounts
	m.mu.Lock()
	if m.panelRunning || len(m.usageActive) > 0 || len(m.refreshing) > 0 {
		m.mu.Unlock()
		return
	}
	id := ""
	var oldest time.Time
	for _, a := range list.Accounts {
		attempt := m.attempted[a.ID]
		if m.usageActive[claudeIdentityHash(a.Email, a.Organization)] == nil && a.Source != "default" && a.Enabled && now.Sub(attempt) >= time.Minute && (id == "" || attempt.Before(oldest)) {
			id, oldest = a.ID, attempt
		}
	}
	if pending := list.PendingLogin; pending != "" && !s.claudeLoginActive(pending) {
		at := m.attempted[pending]
		if now.Sub(at) >= time.Minute && (id == "" || at.Before(oldest)) {
			id = pending
		}
	}
	if id == "" {
		m.mu.Unlock()
		return
	}
	guestID := id
	if a := list.find(id); a != nil {
		guestID = a.guestID()
	}
	call := m.claim(id)
	m.mu.Unlock()
	ctx, finish, err := s.beginActivity(epoch)
	if err != nil {
		m.finish(id, call, err)
		return
	}
	go func() {
		defer finish()
		s.runClaudeRefresh(ctx, id, guestID, call, false)
	}()
}

func (m *claudeAccountManager) claim(id string) *claudeRefresh {
	if m.refreshing == nil {
		m.refreshing = make(map[string]*claudeRefresh)
		m.attempted = make(map[string]time.Time)
	}
	m.attempted[id] = time.Now()
	call := &claudeRefresh{done: make(chan struct{})}
	m.refreshing[id] = call
	return call
}

func (m *claudeAccountManager) finish(id string, call *claudeRefresh, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if errors.Is(err, errClaudeAccessLost) {
		delete(m.attempted, id)
	}
	delete(m.refreshing, id)
	call.err = err
	close(call.done)
}

// A poll begun before login completed might have observed the previous
// identity. Wait for it before requesting a post-login observation.
func (s *Server) confirmClaudeLogin(ctx context.Context, id string) error {
	m := &s.claudeAccounts
	m.mu.Lock()
	list, err := s.loadClaudeAccounts()
	if err != nil {
		m.mu.Unlock()
		return err
	}
	for _, a := range list.Accounts {
		if a.ProfileID == id && id != "" {
			id = a.ID
			break
		}
	}
	prior := m.refreshing[id]
	m.mu.Unlock()
	if prior != nil {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-prior.done:
		}
	}
	return s.refreshClaude(ctx, id, true)
}

// Login completion, panel polls, and manual refreshes share one probe per
// account. A cancelled waiter does not cancel another request's probe.
func (s *Server) refreshClaudeAccount(ctx context.Context, id string) error {
	return s.refreshClaude(ctx, id, false)
}

func (s *Server) refreshClaude(ctx context.Context, id string, finished bool) error {
	m := &s.claudeAccounts
	m.mu.Lock()
	if call := m.refreshing[id]; call != nil {
		m.mu.Unlock()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-call.done:
			return call.err
		}
	}
	list, err := s.loadClaudeAccounts()
	if err == nil {
		if a := list.find(id); a != nil && a.Source == "default" {
			m.mu.Unlock()
			_, _, err := s.inspectClaudeDefault(ctx, true)
			return err
		}
	}
	if err == nil && list.find(id) == nil && (id == "" || list.PendingLogin != id) {
		err = errors.New("The Claude account was not found.")
	}
	if err != nil {
		m.mu.Unlock()
		return err
	}
	guestID := id
	if a := list.find(id); a != nil {
		guestID = a.guestID()
	}
	call := m.claim(id)
	m.mu.Unlock()
	s.runClaudeRefresh(ctx, id, guestID, call, finished)
	return call.err
}

func (s *Server) runClaudeRefresh(parent context.Context, id, guestID string, call *claudeRefresh, finished bool) {
	m := &s.claudeAccounts
	var err error
	var notice string
	defer func() { m.finish(id, call, err) }()
	epoch, unlocked := s.account.access()
	if !unlocked {
		err = errClaudeAccessLost
		return
	}
	ctx, cancel := context.WithTimeout(parent, 20*time.Second)
	stop := context.AfterFunc(epoch, cancel)
	defer func() { stop(); cancel() }()
	reading, probeErr := s.probeClaude(ctx, guestID)
	if epoch.Err() != nil {
		err = errClaudeAccessLost
		return
	}
	if probeErr != nil {
		err = errors.New("The account status could not be read. Make sure the environment is running and check Claude Code.")
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if epoch.Err() != nil {
		err = errClaudeAccessLost
		return
	}
	if ctx.Err() != nil {
		err = errors.New("The account status check was canceled.")
		return
	}
	list, err := s.loadClaudeAccounts()
	if err == nil {
		if id != "" && id == list.PendingLogin {
			switch {
			case reading.subject() != "":
				if existing := list.bySubject(reading.subject()); existing != nil {
					if existing.Source == "default" {
						// Keep the identity and terminal labels stable while future
						// sessions use this independently authenticated directory.
						existing.Source, existing.ProfileID = "managed", id
						err = list.observe(existing.ID, reading, time.Now())
						notice = "Linked a separate sign-in to the existing account. The original note and participation settings were kept."
					} else {
						notice = "This sign-in identity is already in the account list."
					}
				} else {
					list.Accounts = append(list.Accounts, claudeAccount{ID: id, Source: "managed", Label: reading.email(), Enabled: true})
					err = list.observe(id, reading, time.Now())
					notice = "The Claude account that signed in was added to automatic assignment."
				}
				list.PendingLogin = ""
			case finished:
				notice = "This sign-in was not completed. No account was added."
				// A new attempt may already be entering this guest profile.
				// Keep its ID unless terminal admission is certainly idle.
				if s.op.TryLock() {
					if !s.claudeLoginActive(id) {
						list.PendingLogin = ""
					}
					s.op.Unlock()
				}
			}
		} else {
			err = list.observe(id, reading, time.Now())
		}
	}
	if err == nil {
		err = s.saveClaudeAccounts(list)
		if err == nil && notice != "" {
			m.loginNotice = notice
		}
	}
}
