package workbench

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func claudeAuthorizationURL(raw string) bool {
	if len(raw) > 8192 || strings.ContainsAny(raw, "\r\n\t \\") {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.RawQuery == "" ||
		(u.EscapedPath() != "/oauth/authorize" && u.EscapedPath() != "/oauth/authorize/") {
		return false
	}
	switch strings.ToLower(u.Host) {
	case "claude.ai", "claude.com", "console.anthropic.com", "platform.claude.com", "platform.anthropic.com":
		return true
	}
	return false
}

func (s *Server) terminalLoginLink(w http.ResponseWriter, r *http.Request) {
	var input struct {
		URL string `json:"url"`
	}
	if !readJSON(w, r, &input) {
		return
	}
	if !claudeAuthorizationURL(input.URL) {
		http.Error(w, "Select the official Claude authorization link.", 400)
		return
	}
	terminal := s.terminals.get(r.PathValue("id"))
	if terminal == nil {
		http.NotFound(w, r)
		return
	}
	terminal.loginLinkMu.Lock()
	defer terminal.loginLinkMu.Unlock()
	if !terminal.ownsConversation() {
		http.Error(w, "The sign-in terminal was closed. Start the sign-in again.", 409)
		return
	}
	s.mu.Lock()
	ready, token := s.ready, s.credentials.Token
	s.mu.Unlock()
	if !ready {
		http.Error(w, "Start the work environment first.", 409)
		return
	}

	login := terminal.id
	if terminal.loginGuestID != "" {
		// Match the official CLI helper's private browser and cleanup key.
		login = terminal.loginGuestID
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	payload, _ := json.Marshal(map[string]string{"login": login, "url": input.URL})
	data, err := s.guestAPI(ctx, token, "POST", "/login-open", payload)
	if terminal.loginGuestID == "" {
		terminal.loginLinkCleanup.Do(func() {
			go func() {
				lifetime := s.lifetimeContext()
				select {
				case <-lifetime.Done():
					return
				case <-terminal.done:
				}
				terminal.loginLinkMu.Lock()
				defer terminal.loginLinkMu.Unlock()
				ctx, cancel := context.WithTimeout(lifetime, 8*time.Second)
				defer cancel()
				body, _ := json.Marshal(map[string]string{"login": login})
				_, _ = s.guestAPI(ctx, token, "POST", "/login-finish", body)
			}()
		})
	}
	var tab struct {
		ID string `json:"id"`
	}
	if err != nil || json.Unmarshal(data, &tab) != nil || tab.ID == "" {
		http.Error(w, "The Cage browser could not open the authorization page. Check the browser connection and try again.", 502)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	jsonReply(w, tab)
}
