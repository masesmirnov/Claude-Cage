package workbench

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/sylvinus/agent-vm/internal/guestos"
)

var windowsCLIRelayStage = regexp.MustCompile(`Windows guest channel unavailable \((profile|pairing|connect|server_proof|client_proof|hello|transfer):[A-Za-z0-9_]+\)`)

type windowsCLIStderr struct{ buffer bytes.Buffer }

func (w *windowsCLIStderr) Write(data []byte) (int, error) {
	n := len(data)
	// Keep the stage marker and drain all remaining output without failing a
	// successful request because a helper wrote a long warning.
	_, _ = w.buffer.Write(data[:min(n, 4096-w.buffer.Len())])
	return n, nil
}

// The relay reports a fixed stage/type marker. Never expose arbitrary stderr,
// which can contain paths, credentials or untranslated runtime output.
func windowsCLIProcessError(ctx context.Context, stderr string) error {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return errors.New("Timed out waiting for the Windows session service to respond. Try again later. If it keeps failing, export a diagnostics bundle in Settings.")
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		return errors.New("The Windows session request was canceled.")
	}
	stage := windowsCLIRelayStage.FindStringSubmatch(stderr)
	if len(stage) == 2 {
		switch stage[1] {
		case "profile":
			return errors.New("The Windows environment configuration could not be read. Check the environment status in Settings.")
		case "pairing", "server_proof", "client_proof":
			return errors.New("The secure pairing verification of the Windows environment was not completed. Check the environment connection in Settings.")
		case "connect":
			return errors.New("Could not connect to the Windows session service. Make sure the Windows environment has started. If it keeps failing, export a diagnostics bundle in Settings.")
		case "hello", "transfer":
			return errors.New("Communication with the Windows session service was not completed. Make sure the Windows desktop is signed in, then try again. If it keeps failing, export a diagnostics bundle in Settings.")
		}
	}
	return errors.New("The response of the Windows session service could not be read. Try again later. If it keeps failing, export a diagnostics bundle in Settings.")
}

func windowsCLIProfileID(profile string) string {
	sum := sha256.Sum256([]byte(profile))
	return hex.EncodeToString(sum[:8])
}

// The paired GUI agent resolves binaries and private profiles. Paths and commands
// from a WebView never select executables in the native guest.
func (s *Server) windowsCLIRequest(ctx context.Context, request map[string]any, output any) error {
	request["profile"] = windowsCLIProfileID(s.profile)
	if request["action"] == "channel" {
		encoded, err := json.Marshal(request["input"])
		if err != nil {
			return err
		}
		var input map[string]any
		if err := json.Unmarshal(encoded, &input); err != nil {
			return err
		}
		if path, ok := input["workspace"].(string); ok && path != "" {
			binding, err := s.windowsProjectForGuest(path)
			if err != nil {
				return err
			}
			input["project_id"], input["grant"] = binding.ID, binding.Grant
		}
		request["input"] = input
	}
	data, err := json.Marshal(request)
	if err != nil || len(data) > 4<<20 {
		return errors.New("The Windows Claude request is invalid.")
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	cmd, err := guestos.WindowsRelayCommand(ctx, s.profile, "cli")
	if err != nil {
		return err
	}
	cmd.Stdin = bytes.NewReader(append(data, '\n'))
	var stderr windowsCLIStderr
	cmd.Stderr = &stderr
	cmd.WaitDelay = 2 * time.Second
	var result bytes.Buffer
	cmd.Stdout = &boundedWindowsStatusWriter{buffer: &result, remaining: 4 << 20}
	if err := cmd.Run(); err != nil {
		return windowsCLIProcessError(ctx, stderr.buffer.String())
	}
	raw := json.RawMessage(result.Bytes())
	var wrapper map[string]json.RawMessage
	if json.Unmarshal(raw, &wrapper) != nil {
		return errors.New("The Windows Claude Code response is invalid.")
	}
	if wrapper["error"] != nil {
		var reason string
		if json.Unmarshal(wrapper["error"], &reason) == nil && reason == "requires_gui_login" {
			return errors.New("The Windows desktop is not signed in or is locked. Sign in and unlock the Windows desktop, then try again.")
		}
		return errors.New("The Windows Claude Code operation was not completed. The original account and chat history were kept.")
	}
	if value, ok := wrapper["result"]; ok {
		raw = value
	}
	if json.Unmarshal(raw, output) != nil {
		return errors.New("The Windows Claude Code response is invalid.")
	}
	return nil
}
func (s *Server) readWindowsClaudeAccount(ctx context.Context, mode, id, subject string) (claudeGuestSnapshot, error) {
	var result claudeGuestSnapshot
	if !validClaudeGuestID(id) {
		return result, errors.New("The Claude account ID is invalid.")
	}
	err := s.windowsCLIRequest(ctx, map[string]any{"action": "account", "mode": mode, "account": id, "subject": subject}, &result)
	return result, err
}
func (s *Server) windowsProjectForGuest(path string) (*windowsProjectBinding, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, share := range s.projectShares {
		if share.windowsProject != nil && strings.EqualFold(share.windowsProject.Path, path) {
			select {
			case <-share.done:
				continue
			default:
			}
			binding := *share.windowsProject
			return &binding, nil
		}
	}
	return nil, errors.New("The Windows project authorization was disconnected. Reconnect the project.")
}
func cliWorkspaceWithin(path, root string, windows bool) bool {
	if windows {
		path, root = strings.ToLower(strings.ReplaceAll(path, "\\", "/")), strings.ToLower(strings.ReplaceAll(root, "\\", "/"))
	}
	return root != "" && (path == root || strings.HasPrefix(path, strings.TrimRight(root, "/")+"/"))
}
func (s *Server) createWindowsCLITerminal(input terminalRequest) (*terminalSession, error) {
	kind := input.Kind
	if kind == "" {
		kind = "shell"
	}
	if kind != "shell" && kind != "claude" && kind != "claude-login" {
		return nil, errors.New("The terminal type is invalid.")
	}
	if kind == "shell" && (input.ClaudeAccountID != "" || input.sharedID != "") {
		return nil, errors.New("A regular terminal cannot specify a Claude account or session.")
	}
	s.mu.Lock()
	ready, closing, command := s.ready, s.closing, claudeTerminalCommand(s.preferences)
	s.mu.Unlock()
	if closing {
		return nil, errTerminalsClosed
	}
	if !ready || s.busy() {
		return nil, errTerminalNotReady
	}
	var record *mobileRecord
	if input.sharedID != "" {
		s.mobileCLI.mu.Lock()
		found, err := s.mobileCLI.record(s.profile, input.sharedID)
		s.mobileCLI.mu.Unlock()
		if err != nil {
			return nil, err
		}
		record = found
		if record.Switch != nil && record.Switch.Phase == "preparing" {
			return nil, errors.New("The account handoff is not finished. Retry or cancel the handoff first.")
		}
		if record.Archived || record.Deleted {
			return nil, errors.New("This session was archived or deleted. Restore it from Archived sessions first.")
		}
		if existing := s.terminals.get(record.TerminalID); existing != nil {
			if existing.ownsConversation() {
				return existing, nil
			}
			if existing.summary()["closed"] == true {
				s.terminals.remove(record.TerminalID)
			}
		}
	}
	if kind != "claude-login" {
		if err := s.terminals.canStart(); err != nil {
			return nil, err
		}
	}
	if kind == "claude" && (!sharedCLILauncher(command) || record != nil && record.Launcher != "" && record.Launcher != command) {
		return nil, errors.New("Native shared sessions on Windows support the claude or ccs profile name start commands.")
	}
	workspace := s.workspace()
	var project *windowsProjectBinding
	var err error
	if kind != "claude-login" {
		workspace, err = s.connectProject(input.Workspace, false)
		if err != nil {
			return nil, err
		}
		project, err = s.windowsProjectForHost(workspace)
		if err != nil {
			return nil, err
		}
	}
	var selection claudeSelection
	var finished func()
	var conversation *mobileRecord
	if kind != "shell" {
		login := kind == "claude-login"
		if record != nil && record.Terminal {
			selection = record.Account
		} else {
			selection, err = s.selectTerminalClaudeAccount(command, input.ClaudeAccountID, login, workspace)
		}
		if err != nil {
			return nil, err
		}
		if selection.ID != "" {
			if !validClaudeID(selection.ID) || !validClaudeGuestID(selection.GuestID) || login && selection.GuestID == "default" {
				return nil, errors.New("The Claude account ID is invalid.")
			}
			if login && s.mobileCLI.activeAccounts()[selection.ID] > 0 {
				return nil, errors.New("End the mobile CLI turn this account is running first, then sign in again.")
			}
			if existing, conflict := s.terminals.existingClaudeLogin(selection.ID, login); existing != nil || conflict != nil {
				return existing, conflict
			}
			if !login && selection.Subject == "" {
				return nil, errors.New("The Claude account state has changed. Try again.")
			}
			if login {
				finished = func() {
					ctx, cancel := context.WithTimeout(s.lifetimeContext(), 12*time.Second)
					defer cancel()
					_ = s.confirmClaudeLogin(ctx, selection.ID)
				}
			}
		}
	}
	operation := "terminal"
	request := map[string]any{"action": "open", "cols": 100, "rows": 30, "workspace": "project", "shell": "powershell"}
	if kind != "shell" {
		operation = "cli"
		account := selection.GuestID
		if account == "" {
			account = "default"
		}
		request = map[string]any{"action": "terminal", "profile": windowsCLIProfileID(s.profile), "kind": kind, "cols": 100, "rows": 30, "account": account, "subject": selection.Subject}
		if kind == "claude" {
			parts, _ := mobileLaunchArgs(command, selection)
			if len(parts) == 2 && parts[0] == "ccs" {
				request["ccs_profile"] = parts[1]
			}
			payload, found, err := s.prepareTerminalConversation(workspace, selection, input.sharedID)
			if err != nil {
				return nil, err
			}
			conversation = found
			var value map[string]any
			if json.Unmarshal([]byte(payload), &value) != nil {
				return nil, errors.New("The Claude session request is invalid.")
			}
			request["conversation"] = value
		}
	}
	if project != nil {
		request["project_id"], request["grant"] = project.ID, project.Grant
	}
	cmd, err := guestos.WindowsRelayCommand(s.lifetimeContext(), s.profile, operation)
	if err != nil {
		return nil, err
	}
	if input.requestContext != nil {
		s.account.mu.Lock()
		if !s.mobileAuthorized(input.requestContext) {
			s.account.mu.Unlock()
			return nil, errMobileLocked
		}
	}
	session, err := s.terminals.startSessionWithPTY(cmd, workspace, input.Kind, selection, finished, func() (terminalPTY, error) { return startWindowsGuestTerminalRequest(cmd, request) })
	if input.requestContext != nil {
		s.account.mu.Unlock()
	}
	if err == nil && conversation != nil {
		session.mu.Lock()
		session.sharedID, session.connectionID = conversation.ID, conversation.Connection
		session.mu.Unlock()
		s.mobileCLI.mu.Lock()
		conversation.TerminalID = session.id
		err = writePrivate(mobileRecordPath(s.profile, conversation.ID), conversation)
		s.mobileCLI.mu.Unlock()
		if err != nil {
			s.terminals.remove(session.id)
			return nil, err
		}
		s.prepareCLIConnection(session, conversation.ID)
		s.monitorClaudeAccount(session, conversation.ID)
	}
	if err == nil && kind == "claude" && selection.ID != "" {
		s.noteClaudeSelection(selection.ID, workspace)
	}
	return session, err
}
