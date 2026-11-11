package workbench

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"slices"
)

func (s *Server) removeProject(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Workspace string `json:"workspace"`
	}
	if !readJSON(w, r, &input) {
		return
	}
	if !s.op.TryLock() {
		http.Error(w, "Another operation is still running. Wait a moment.", http.StatusConflict)
		return
	}
	defer s.op.Unlock()
	s.mu.Lock()
	closing, ready, preferences := s.closing, s.ready, s.preferences
	s.mu.Unlock()
	if closing || s.busy() {
		http.Error(w, "The environment is handling another operation. Try again later.", http.StatusConflict)
		return
	}
	path := input.Workspace
	if path == "" || path == s.environmentDir() || isClientMountPath(path) {
		http.Error(w, "Select a project that was added. The default workspace is kept. To stop a client share, use Stop sharing.", http.StatusBadRequest)
		return
	}
	projects, err := s.projectPaths()
	if err != nil {
		requestError(w, err)
		return
	}
	if !slices.Contains(projects, path) {
		jsonReply(w, map[string]string{"workspace": s.workspace()})
		return
	}
	if !ready {
		running, err := controllerVMState(s.profile)
		if err != nil || running {
			http.Error(w, "The environment is still running or its running state cannot be confirmed. Restore the connection, or save your work and stop the environment before removing the project.", http.StatusConflict)
			return
		}
	}
	for _, terminal := range s.terminals.snapshot() {
		if terminal["workspace"] == path && terminal["closed"] != true {
			http.Error(w, "Close this project's terminals first, then remove the project. Session history is kept.", http.StatusConflict)
			return
		}
	}
	if ready && sharedCLILauncher(claudeTerminalCommand(preferences)) {
		granted := make(map[string]bool, len(projects))
		for _, project := range projects {
			granted[project] = true
		}
		_, err = s.mobileCLI.summaries(s.profile, granted, false)
		if err == nil {
			err = s.discoverTerminalConversations(r.Context(), projects)
		}
		if err != nil {
			http.Error(w, "Running sessions cannot be verified right now. Restore the session connection, or save your work and stop the environment before removing the project.", http.StatusConflict)
			return
		}
	}
	s.mobileCLI.mu.Lock()
	active := false
	for _, run := range s.mobileCLI.active {
		active = active || run.record.Workspace == path
	}
	for id, running := range s.mobileCLI.running {
		active = active || ready && running && s.mobileCLI.catalog[id].Workspace == path
	}
	s.mobileCLI.mu.Unlock()
	if active {
		http.Error(w, "End this project's running sessions first, then remove the project. Session history is kept.", http.StatusConflict)
		return
	}
	if ready {
		body, err := s.browserAction(r.Context(), "tabs", nil)
		var browser struct {
			Tabs []struct {
				Kind      string `json:"kind"`
				Workspace string `json:"workspace"`
			} `json:"tabs"`
		}
		if err != nil || json.Unmarshal(body, &browser) != nil || browser.Tabs == nil {
			http.Error(w, "The file editor cannot be verified right now. Restore the browser connection, or save your work and stop the environment before removing the project.", http.StatusConflict)
			return
		}
		for _, tab := range browser.Tabs {
			if tab.Kind == "editor" && tab.Workspace == path {
				http.Error(w, "Save your files and close this project's editor first, then remove the project.", http.StatusConflict)
				return
			}
		}
	}
	var saved sharedProjects
	filename := filepath.Join(s.profile, "projects.json")
	data, err := os.ReadFile(filename)
	if err == nil {
		err = json.Unmarshal(data, &saved)
	}
	if err != nil && !os.IsNotExist(err) {
		requestError(w, err)
		return
	}
	if preferences.Workspace == path {
		// Preserve a legacy current grant before changing the selection. If a
		// later write fails, a retry can still find and remove this project.
		if !slices.Contains(saved.Paths, path) {
			saved.Paths = append(saved.Paths, path)
			if err = writePrivate(filename, saved); err != nil {
				requestError(w, err)
				return
			}
		}
		preferences.Workspace = s.environmentDir()
		if err = writePrivate(filepath.Join(s.profile, "workbench.json"), preferences); err != nil {
			requestError(w, err)
			return
		}
		s.mu.Lock()
		s.preferences.Workspace = preferences.Workspace
		s.mu.Unlock()
	}
	deleteProject := func(value string) bool { return value == path }
	saved.Paths = slices.DeleteFunc(saved.Paths, deleteProject)
	if err = writePrivate(filename, saved); err != nil {
		requestError(w, err)
		return
	}
	s.mu.Lock()
	share := s.projectShares[path]
	delete(s.projectShares, path)
	s.mu.Unlock()
	if share != nil {
		share.close()
	}
	s.setProjectError(path, nil)
	jsonReply(w, map[string]string{"workspace": s.workspace()})
}
