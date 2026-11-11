package workbench

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/lima-vm/sshocker/pkg/reversesshfs"
	"github.com/sylvinus/agent-vm/internal/cage"
	"github.com/sylvinus/agent-vm/internal/paths"
	"github.com/sylvinus/agent-vm/internal/remotehost"
)

// ClientProjectShare is a desktop-local grant. Only ID crosses the tunnel.
type ClientProjectShare struct {
	ID        string `json:"id"`
	Path      string `json:"path"`
	GuestPath string `json:"guest_path"`
	Readonly  bool   `json:"readonly"`
}

type clientShareRequest struct {
	Token    string `json:"token"`
	Path     string `json:"path"`
	Readonly *bool  `json:"readonly"`
}

type clientProjectGrant struct {
	ClientProjectShare
	session *remotehost.Session
	cancel  context.CancelFunc
	done    chan struct{}
	ready   bool // protected by remoteGateway.mu
}

// Only a native picker helper holding the private controller credential may
// create a grant. A browser session can enumerate or revoke its own grants.
func ShareNativeCloudProject(configPath, connection, path string, readonly bool) (ClientProjectShare, error) {
	var result ClientProjectShare
	client, err := connectController(filepath.Dir(configPath))
	if err != nil {
		return result, err
	}
	defer client.close()
	entry, _ := url.Parse(client.launch.URL)
	code, err := client.call("POST", "/api/session", map[string]string{"token": entry.Fragment}, nil)
	if err != nil || code != http.StatusOK {
		return result, errors.New("Could not connect to Cage on this computer.")
	}
	current, err := client.bindConnection(connection)
	if err != nil {
		return result, err
	}
	if current.Mode != "remote" {
		return result, errors.New("Select a remote Cage first.")
	}
	client.client.Timeout = 35 * time.Second
	body, err := json.Marshal(clientShareRequest{Token: client.record.Token, Path: path, Readonly: &readonly})
	if err != nil {
		return result, err
	}
	req, err := http.NewRequest("POST", client.origin+"/api/client/project-shares", bytes.NewReader(body))
	if err != nil {
		return result, err
	}
	req.Header.Set("Origin", client.origin)
	req.Header.Set("Content-Type", "application/json")
	response, err := client.client.Do(req)
	if err != nil {
		return result, errors.New("Sharing the local project failed. Check the connection.")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		data, _ := io.ReadAll(io.LimitReader(response.Body, 1024))
		return result, errors.New("Could not share the local project: " + strings.TrimSpace(string(data)))
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 32<<10)).Decode(&result); err != nil {
		return result, errors.New("Cage on this computer returned an invalid sharing result. Check the sharing list again.")
	}
	return result, nil
}

func (g *remoteGateway) clientShareSession(id string) (*remotehost.Session, error) {
	if g.desktop != nil {
		session, remote, err := g.desktop.acquire(id)
		if err != nil || !remote {
			return nil, errViewChanged
		}
		return session, nil
	}
	if !g.isRemote() {
		return nil, errViewChanged
	}
	return g.manager.Acquire(id)
}

// A completed disconnect or view switch must not leave SFTP requests from
// the old view running against a descriptor on this machine.
func (g *remoteGateway) drainClosedClientShares() {
	var draining []*clientProjectGrant
	g.mu.Lock()
	for _, grant := range g.clientShares {
		if grant.session.Context.Err() != nil {
			draining = append(draining, grant)
		}
	}
	g.mu.Unlock()
	for _, grant := range draining {
		grant.cancel()
		<-grant.done
	}
}

func (s *Server) clientProjectShareRequest(w http.ResponseWriter, r *http.Request, path string) {
	g := s.remote
	session, err := g.clientShareSession(r.Header.Get(connectionHeader))
	if err != nil {
		http.Error(w, "The work environment has changed. Select the project again.", http.StatusConflict)
		return
	}
	if !session.Manifest.Capabilities["client_project_share"] {
		http.Error(w, "This cloud Cage does not support sharing local projects yet.", http.StatusConflict)
		return
	}
	switch {
	case path == "project-shares" && r.Method == http.MethodGet:
		shares := []ClientProjectShare{}
		g.mu.Lock()
		for _, entry := range g.clientShares {
			if entry.session == session && entry.ready {
				shares = append(shares, entry.ClientProjectShare)
			}
		}
		g.mu.Unlock()
		sort.Slice(shares, func(i, j int) bool { return shares[i].Path < shares[j].Path })
		jsonReply(w, map[string]any{"shares": shares})
	case path == "project-shares" && r.Method == http.MethodPost:
		var in clientShareRequest
		if !readJSON(w, r, &in, 16<<10) {
			return
		}
		if !equalSecret(in.Token, s.token) {
			http.Error(w, "Authorize with the folder picker in Cage on this computer.", http.StatusForbidden)
			return
		}
		if in.Readonly == nil {
			http.Error(w, "Choose the sharing permission.", http.StatusBadRequest)
			return
		}
		item, err := s.createClientProjectShare(r.Context(), session, in.Path, *in.Readonly)
		if err != nil {
			requestError(w, err)
			return
		}
		jsonReply(w, item)
	case strings.HasPrefix(path, "project-shares/") && r.Method == http.MethodDelete:
		id := strings.TrimPrefix(path, "project-shares/")
		g.mu.Lock()
		grant := g.clientShares[id]
		g.mu.Unlock()
		if grant == nil || grant.session != session {
			http.NotFound(w, r)
			return
		}
		grant.cancel()
		<-grant.done
		jsonReply(w, map[string]bool{"ok": true})
	default:
		http.NotFound(w, r)
	}
}

func (s *Server) clientProjectRoot(path string) (string, error) {
	if !filepath.IsAbs(path) {
		return "", errors.New("Select the absolute path of a local project.")
	}
	profile := s.profile
	if s.desktopEntry {
		profile = filepath.Dir(profile)
	}
	root, err := validateWorkspace(path, profile)
	if err != nil {
		return "", err
	}
	if err := validateHostProjectData(root, profile); err != nil {
		return "", err
	}
	var private []string
	if runtime.GOOS == "windows" {
		if strings.HasPrefix(root, `\\`) {
			return "", errors.New("Select a project directory on a local disk.")
		}
		for _, key := range []string{"SystemRoot", "ProgramData", "ProgramFiles", "ProgramFiles(x86)"} {
			if p := os.Getenv(key); p != "" {
				private = append(private, p)
			}
		}
	} else {
		private = []string{"/proc", "/sys", "/dev", "/etc", "/boot", "/run", "/bin", "/sbin", "/usr/bin", "/usr/sbin", "/System", "/Library", "/Applications"}
	}
	hosts, err := s.remote.store.List()
	if err != nil {
		return "", errors.New("Could not verify the local SSH credentials location.")
	}
	for _, host := range hosts {
		if host.Auth.IdentityFile != "" {
			private = append(private, host.Auth.IdentityFile)
		}
	}
	for _, p := range private {
		if cage.StoragePathsOverlap(root, p) {
			return "", errors.New("System directories and directories containing SSH keys cannot be shared.")
		}
		real, err := paths.Resolve(p)
		if err == nil && cage.StoragePathsOverlap(root, real) {
			return "", errors.New("System directories and directories containing SSH keys cannot be shared.")
		}
	}
	return root, nil
}

func (s *Server) createClientProjectShare(request context.Context, session *remotehost.Session, path string, readonly bool) (ClientProjectShare, error) {
	var empty ClientProjectShare
	// On Windows SameFile may lazily resolve an identity returned by os.Stat.
	// Keep a directory handle until the restricted service has pinned it too.
	picked, err := os.OpenRoot(path)
	if err != nil {
		return empty, errors.New("The local project directory cannot be accessed.")
	}
	defer picked.Close()
	dir, err := picked.Open(".")
	if err != nil {
		return empty, errors.New("Could not verify the local directory identity.")
	}
	defer dir.Close()
	identity, err := dir.Stat()
	if err != nil || !identity.IsDir() {
		return empty, errors.New("The local project directory cannot be accessed.")
	}
	root, err := s.clientProjectRoot(path)
	if err != nil {
		return empty, err
	}
	files, err := reversesshfs.OpenCloudShare(root, readonly)
	if err != nil {
		return empty, err
	}
	if !files.MatchesRoot(identity) {
		files.Close()
		return empty, errors.New("The selected directory has changed. Select it again.")
	}
	ctx, cancel := context.WithCancel(session.Context)
	id := randomToken()[:32]
	view := ClientProjectShare{ID: id, Path: root, GuestPath: clientMountRoot + "/" + id, Readonly: readonly}
	entry := &clientProjectGrant{ClientProjectShare: view, session: session, cancel: cancel, done: make(chan struct{})}
	g := s.remote
	g.mu.Lock()
	if ctx.Err() != nil || request.Err() != nil {
		g.mu.Unlock()
		cancel()
		files.Close()
		return empty, errViewChanged
	}
	for _, active := range g.clientShares {
		if (!readonly || !active.Readonly) && cage.StoragePathsOverlap(active.Path, root) {
			g.mu.Unlock()
			cancel()
			files.Close()
			return empty, errors.New("This directory overlaps an existing share. Stop the original share before granting read-write access.")
		}
		if active.session == session && paths.Equal(active.Path, root) {
			g.mu.Unlock()
			cancel()
			files.Close()
			return empty, errors.New("This directory is already shared. Stop the original share before changing permissions.")
		}
	}
	if len(g.clientShares) >= 16 {
		g.mu.Unlock()
		cancel()
		files.Close()
		return empty, errors.New("The limit of simultaneously shared projects has been reached.")
	}
	if g.clientShares == nil {
		g.clientShares = make(map[string]*clientProjectGrant)
	}
	g.clientShares[id] = entry
	g.mu.Unlock()
	endpoint := session.Origin + "/api/projects/client-share?id=" + id
	upgraded := make(chan struct{})
	var checkErr error // read after entry.done closes
	go func() {
		defer func() {
			cancel()
			files.Close()
			g.mu.Lock()
			delete(g.clientShares, id)
			close(entry.done)
			g.mu.Unlock()
		}()
		if !readonly {
			if checkErr = requireHostGit(ctx); checkErr != nil {
				return
			}
		}
		req, err := http.NewRequestWithContext(ctx, "POST", endpoint, nil)
		if err != nil {
			return
		}
		req.Header.Set("Connection", "Upgrade")
		req.Header.Set("Upgrade", "cage-sftp-v1")
		res, err := session.Transport.RoundTrip(req)
		if err != nil {
			return
		}
		defer res.Body.Close()
		stream, ok := res.Body.(io.ReadWriteCloser)
		if res.StatusCode != http.StatusSwitchingProtocols || !ok || !strings.EqualFold(res.Header.Get("Upgrade"), "cage-sftp-v1") {
			return
		}
		stop := context.AfterFunc(ctx, func() { stream.Close() })
		defer stop()
		close(upgraded)
		_ = files.Serve(stream)
	}()
	// The grant follows the session once creation is acknowledged. Until
	// then the picker closing, disconnect or deadline rolls it back.
	startup, finish := context.WithTimeout(request, 25*time.Second)
	defer finish()
	stop := context.AfterFunc(startup, cancel)
	defer stop()
	failed := func() (ClientProjectShare, error) {
		cancel()
		<-entry.done
		if checkErr != nil {
			return empty, checkErr
		}
		return empty, errors.New("The cloud did not confirm the project mount. Check that Cage is unlocked and the environment has started.")
	}
	select {
	case <-upgraded:
	case <-ctx.Done():
		return failed()
	case <-startup.Done():
		return failed()
	}
	for {
		if ctx.Err() != nil {
			return failed()
		}
		req, _ := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
		res, err := session.Transport.RoundTrip(req)
		if err != nil {
			return failed()
		}
		ready := false
		if res.StatusCode == http.StatusOK {
			var state struct {
				Workspace string `json:"workspace"`
			}
			ready = json.NewDecoder(io.LimitReader(res.Body, 4096)).Decode(&state) == nil && state.Workspace == view.GuestPath
		}
		res.Body.Close()
		if ready {
			if !stop() || startup.Err() != nil {
				return failed()
			}
			g.mu.Lock()
			if g.clientShares[id] != entry || ctx.Err() != nil {
				g.mu.Unlock()
				return failed()
			}
			entry.ready = true
			g.mu.Unlock()
			return view, nil
		}
		if res.StatusCode != http.StatusConflict {
			return failed()
		}
		select {
		case <-ctx.Done():
			return failed()
		case <-time.After(180 * time.Millisecond):
		}
	}
}
