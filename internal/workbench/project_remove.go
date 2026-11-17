package workbench

import (
	"context"
	"encoding/json"
	"errors"
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
	if path == "" || isClientMountPath(path) {
		http.Error(w, "Choose an added project; for client shares, use Stop sharing.", http.StatusBadRequest)
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
	folders, err := s.projectFolders(path)
	if err != nil {
		requestError(w, err)
		return
	}
	if err := s.checkProjectFoldersIdle(r.Context(), folders, ready); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
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
	if slices.Contains(folders, preferences.Workspace) {
		// Preserve a legacy current grant before changing the selection. If a
		// later write fails, a retry can still find and remove this project.
		if !slices.Contains(saved.Paths, preferences.Workspace) {
			saved.Paths = append(saved.Paths, preferences.Workspace)
			if err = writePrivate(filename, saved); err != nil {
				requestError(w, err)
				return
			}
		}
		preferences.Workspace = ""
		for _, project := range projects {
			if !slices.Contains(folders, project) && !isClientMountPath(project) {
				preferences.Workspace = project
				break
			}
		}
		if err = writePrivate(filepath.Join(s.profile, "workbench.json"), preferences); err != nil {
			requestError(w, err)
			return
		}
		s.mu.Lock()
		s.preferences.Workspace = preferences.Workspace
		s.mu.Unlock()
	}
	deleteProject := func(value string) bool { return slices.Contains(folders, value) }
	saved.Paths = slices.DeleteFunc(saved.Paths, deleteProject)
	saved.Groups = slices.DeleteFunc(saved.Groups, func(g projectGroup) bool { return slices.Contains(folders, g.Workspace) })
	if err = writePrivate(filename, saved); err != nil {
		requestError(w, err)
		return
	}
	s.detachProjectFolders(folders)
	jsonReply(w, map[string]string{"workspace": s.workspace()})
}

func (s *Server) checkProjectFoldersIdle(ctx context.Context, folders []string, ready bool) error {
	if len(folders) == 0 {
		return nil
	}
	s.mu.Lock()
	preferences := s.preferences
	s.mu.Unlock()
	projects, err := s.projectPaths()
	if err != nil {
		return err
	}
	for _, terminal := range s.terminals.snapshot() {
		if slices.Contains(folders, terminal["workspace"].(string)) && terminal["closed"] != true {
			return errors.New("Close this project's terminals before removing the project. Session history is kept.")
		}
	}
	if ready && sharedCLILauncher(claudeTerminalCommand(preferences)) {
		granted := make(map[string]bool, len(projects))
		for _, project := range projects {
			granted[project] = true
		}
		_, err = s.mobileCLI.summaries(s.profile, granted, false)
		if err == nil {
			err = s.discoverTerminalConversations(ctx, projects)
		}
		if err != nil {
			return errors.New("Running sessions cannot be checked right now. Restore the session connection, or save your work and stop the environment before removing the project.")
		}
	}
	s.mobileCLI.mu.Lock()
	active := false
	for _, run := range s.mobileCLI.active {
		active = active || slices.Contains(folders, run.record.Workspace)
	}
	for id, running := range s.mobileCLI.running {
		active = active || ready && running && slices.Contains(folders, s.mobileCLI.catalog[id].Workspace)
	}
	s.mobileCLI.mu.Unlock()
	if active {
		return errors.New("End this project's running sessions before removing the project. Session history is kept.")
	}
	if ready {
		body, err := s.browserAction(ctx, "tabs", nil)
		var browser struct {
			Tabs []struct {
				Kind      string `json:"kind"`
				Workspace string `json:"workspace"`
			} `json:"tabs"`
		}
		if err != nil || json.Unmarshal(body, &browser) != nil || browser.Tabs == nil {
			return errors.New("The file editor cannot be checked right now. Restore the browser connection, or save your work and stop the environment before removing the project.")
		}
		for _, tab := range browser.Tabs {
			if tab.Kind == "editor" && slices.Contains(folders, tab.Workspace) {
				return errors.New("Save your files and close this project's editor before removing the project.")
			}
		}
	}
	return nil
}

func (s *Server) detachProjectFolders(folders []string) {
	for _, folder := range folders {
		s.mu.Lock()
		share := s.projectShares[folder]
		delete(s.projectShares, folder)
		s.mu.Unlock()
		if share != nil {
			share.close()
		}
		s.setProjectError(folder, nil)
	}
}

func (s *Server) replaceRemovedWorkspace(removed []string, replacement string) error {
	s.mu.Lock()
	preferences := s.preferences
	s.mu.Unlock()
	if !slices.Contains(removed, preferences.Workspace) {
		return nil
	}
	preferences.Workspace = replacement
	if err := writePrivate(filepath.Join(s.profile, "workbench.json"), preferences); err != nil {
		return err
	}
	s.mu.Lock()
	s.preferences.Workspace = replacement
	s.mu.Unlock()
	return nil
}
