package workbench

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

// Workspace is the stable default directory and preserves transcript identity.
// Paths remain the individual host grants; groups only associate those grants.
type projectGroup struct {
	Workspace string   `json:"workspace"`
	Name      string   `json:"name"`
	Folders   []string `json:"folders"`
}

func (s *Server) readSharedProjects() (sharedProjects, error) {
	var saved sharedProjects
	data, err := os.ReadFile(filepath.Join(s.profile, "projects.json"))
	if os.IsNotExist(err) {
		return saved, nil
	}
	if err == nil {
		err = json.Unmarshal(data, &saved)
	}
	return saved, err
}

func (s *Server) projectGroups() ([]projectGroup, error) {
	saved, err := s.readSharedProjects()
	if err != nil {
		return nil, err
	}
	paths, err := s.projectPaths()
	if err != nil {
		return nil, err
	}
	groups := []projectGroup{}
	covered := map[string]bool{}
	for _, group := range saved.Groups {
		if !slices.Contains(paths, group.Workspace) {
			continue
		}
		folders := []string{group.Workspace}
		for _, folder := range group.Folders {
			if slices.Contains(paths, folder) && !slices.Contains(folders, folder) {
				folders = append(folders, folder)
			}
		}
		group.Folders = folders
		groups = append(groups, group)
		for _, folder := range folders {
			covered[folder] = true
		}
	}
	for _, path := range paths {
		if !covered[path] {
			groups = append(groups, projectGroup{Workspace: path, Name: filepath.Base(path), Folders: []string{path}})
		}
	}
	return groups, nil
}

func (s *Server) projectFolders(workspace string) ([]string, error) {
	groups, err := s.projectGroups()
	if err != nil {
		return nil, err
	}
	for _, group := range groups {
		if slices.Contains(group.Folders, workspace) {
			return group.Folders, nil
		}
	}
	return []string{workspace}, nil
}

func (s *Server) projectAdditionalDirectories(workspace string) ([]string, error) {
	folders, err := s.projectFolders(workspace)
	if err != nil {
		return nil, err
	}
	var directories []string
	for _, folder := range folders {
		if folder == workspace {
			continue
		}
		if _, err := s.projectWorkspace(folder); err != nil {
			return nil, err
		}
		directory := s.cliWorkspace(folder)
		if s.windowsGuest != nil {
			binding, err := s.windowsProjectForHost(folder)
			if err != nil {
				return nil, err
			}
			directory = binding.Path
		}
		directories = append(directories, directory)
	}
	return directories, nil
}

// Saving and opening share the macOS approval flow. Approval never persists a
// partial group; the caller retries the complete request after GUI approval.
func (s *Server) projectConnectionError(w http.ResponseWriter, err error, folder string) {
	if errors.Is(err, errMacOSProjectApproval) {
		if canonical, pathErr := validateWorkspace(folder, s.profile); pathErr == nil {
			folder = canonical
		}
		folders, _ := s.projectFolders(folder)
		s.mu.Lock()
		for _, member := range folders {
			if share := s.projectShares[member]; share != nil && share.approval != "" {
				folder = member
				break
			}
		}
		share := s.projectShares[folder]
		grant := ""
		if share != nil {
			grant = share.approval
		}
		s.mu.Unlock()
		if grant != "" {
			ctx, cancel := context.WithTimeout(s.operationContext(), 5*time.Second)
			_, openErr := s.guestControl(ctx, "/usr/bin/open -a /Applications/CageProjectAccess.app", "macos-project-approval")
			cancel()
			if openErr == nil {
				jsonReply(w, map[string]string{"workspace": folder, "approval": grant})
				return
			}
			err = &projectShareError{Recovery: "project-approval", Message: "Could not show the project authorization window; please try again"}
		}
	}
	var failure *projectShareError
	if errors.As(err, &failure) && failure.Recovery != "" {
		w.Header().Set("X-Cage-Recovery", failure.Recovery)
	}
	requestError(w, err)
}

func (s *Server) saveProject(w http.ResponseWriter, r *http.Request) {
	var input projectGroup
	if !readJSON(w, r, &input) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || utf8.RuneCountInString(input.Name) > 100 || strings.ContainsAny(input.Name, "\x00\r\n") || len(input.Folders) == 0 || len(input.Folders) > 32 {
		http.Error(w, "Enter a project name and add 1–32 folders", http.StatusBadRequest)
		return
	}
	if !s.op.TryLock() {
		http.Error(w, "Another operation is still running; please wait", http.StatusConflict)
		return
	}
	defer s.op.Unlock()
	s.mu.Lock()
	ready, closing := s.ready, s.closing
	s.mu.Unlock()
	if closing || !ready || s.busy() {
		http.Error(w, "The environment is not ready yet or is handling another operation; please try again later", http.StatusConflict)
		return
	}
	saved, err := s.readSharedProjects()
	if err != nil {
		requestError(w, err)
		return
	}
	groups, err := s.projectGroups()
	if err != nil {
		requestError(w, err)
		return
	}
	// Validate every directory before opening any transport, including aliases.
	folders := []string{}
	for _, folder := range input.Folders {
		if isClientMountPath(folder) {
			http.Error(w, "Manage temporary client shares separately", http.StatusBadRequest)
			return
		}
		path, err := validateWorkspace(folder, s.profile)
		if err != nil {
			requestError(w, err)
			return
		}
		if !slices.Contains(folders, path) {
			folders = append(folders, path)
		}
	}
	var previous *projectGroup
	if input.Workspace != "" {
		for _, group := range groups {
			if group.Workspace == input.Workspace {
				value := group
				previous = &value
				break
			}
		}
		if previous == nil || !slices.Contains(folders, input.Workspace) {
			http.Error(w, "Keep the project's default folder to continue using the existing session history", http.StatusBadRequest)
			return
		}
	} else {
		input.Workspace = folders[0]
		if slices.ContainsFunc(saved.Groups, func(g projectGroup) bool { return g.Workspace == input.Workspace }) {
			http.Error(w, "The default folder already belongs to an existing project; edit that project instead", http.StatusBadRequest)
			return
		}
	}
	for _, group := range groups {
		if group.Workspace == input.Workspace {
			continue
		}
		for _, folder := range folders {
			// An existing single-folder project can join this group. Named or
			// multi-folder groups must be edited explicitly to avoid stealing them.
			if slices.Contains(group.Folders, folder) && slices.ContainsFunc(saved.Groups, func(g projectGroup) bool { return g.Workspace == group.Workspace }) {
				http.Error(w, "The folder is already bound to the project \""+group.Name+"\"; unbind it from that project first", http.StatusBadRequest)
				return
			}
		}
	}
	removed := []string{}
	if previous != nil {
		for _, folder := range previous.Folders {
			if !slices.Contains(folders, folder) {
				removed = append(removed, folder)
			}
		}
	}
	var affected []string
	if len(removed) > 0 {
		affected = previous.Folders
	}
	if err := s.checkProjectFoldersIdle(r.Context(), affected, true); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	// Failed creation must not leave new, invisible directory transports alive.
	// Keep a pending macOS approval until the same save request is retried.
	s.mu.Lock()
	initialShares := make(map[string]*projectShare, len(folders))
	for _, folder := range folders {
		initialShares[folder] = s.projectShares[folder]
	}
	s.mu.Unlock()
	committed, approving := false, false
	defer func() {
		if committed || approving {
			return
		}
		var created []string
		s.mu.Lock()
		for _, folder := range folders {
			if initialShares[folder] == nil && s.projectShares[folder] != nil {
				created = append(created, folder)
			}
		}
		s.mu.Unlock()
		s.detachProjectFolders(created)
	}()
	for _, folder := range folders {
		if err := s.ensureProjectShare(folder); err != nil {
			approving = errors.Is(err, errMacOSProjectApproval)
			s.projectConnectionError(w, err, folder)
			return
		}
	}
	input.Folders = append([]string{input.Workspace}, slices.DeleteFunc(slices.Clone(folders), func(p string) bool { return p == input.Workspace })...)
	// Preserve the legacy current grant even when it was never in paths.
	paths, err := s.projectPaths()
	if err != nil {
		requestError(w, err)
		return
	}
	saved.Paths = slices.DeleteFunc(paths, func(p string) bool { return isClientMountPath(p) || slices.Contains(removed, p) })
	for _, folder := range folders {
		if !slices.Contains(saved.Paths, folder) {
			saved.Paths = append(saved.Paths, folder)
		}
	}
	index := slices.IndexFunc(saved.Groups, func(g projectGroup) bool { return g.Workspace == input.Workspace })
	if index >= 0 {
		saved.Groups[index] = input
	} else {
		saved.Groups = append(saved.Groups, input)
	}
	// A removed member may be the legacy current selection. Change it before
	// dropping its grant so projectPaths cannot resurrect it.
	if err := s.replaceRemovedWorkspace(removed, input.Workspace); err != nil {
		requestError(w, err)
		return
	}
	if err := writePrivate(filepath.Join(s.profile, "projects.json"), saved); err != nil {
		requestError(w, err)
		return
	}
	committed = true
	s.detachProjectFolders(removed)
	jsonReply(w, input)
}
