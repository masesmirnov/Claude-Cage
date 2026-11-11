package workbench

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"

	"github.com/sylvinus/agent-vm/internal/host"
	"github.com/sylvinus/agent-vm/internal/version"
)

const remoteAPIProtocol = 1

var remoteInstanceID = regexp.MustCompile(`^[a-f0-9]{64}$`)

type remoteInstance struct {
	ID string `json:"id"`
}

// The instance identity belongs to persistent server data, not its address,
// filesystem spelling, current process or the client's operating system.
func ensureRemoteInstance(profile string) (string, error) {
	path := filepath.Join(profile, "remote-instance.json")
	if err := host.CheckPrivateFile(path); err == nil {
		data, err := os.ReadFile(path)
		var instance remoteInstance
		if err != nil || json.Unmarshal(data, &instance) != nil || !remoteInstanceID.MatchString(instance.ID) {
			return "", errors.New("The remote instance identity record is invalid. Keep the data and check the configuration.")
		}
		return instance.ID, nil
	} else if !os.IsNotExist(err) {
		return "", err
	}
	instance := remoteInstance{ID: randomToken()}
	if err := writePrivate(path, instance); err != nil {
		return "", err
	}
	return instance.ID, nil
}

type RemoteEntry struct {
	APIProtocol  int             `json:"api_protocol"`
	InstanceID   string          `json:"instance_id"`
	Version      string          `json:"version"`
	Platform     string          `json:"platform"`
	Runtime      string          `json:"runtime"`
	Origin       string          `json:"origin"`
	Ticket       string          `json:"ticket,omitempty"`
	Capabilities map[string]bool `json:"capabilities"`
}

func (s *Server) remoteManifest(w http.ResponseWriter, r *http.Request) {
	if s.macosGuest != nil {
		jsonReply(w, RemoteEntry{APIProtocol: remoteAPIProtocol, InstanceID: s.instanceID, Version: version.Version, Platform: runtime.GOOS,
			Runtime: "lima", Origin: s.origin, Capabilities: map[string]bool{"terminal": true, "projects_browse": true}})
		return
	}
	kind := "lima"
	if _, err := os.Stat(filepath.Join(s.profile, "container.json")); err == nil {
		kind = "container"
	}
	jsonReply(w, RemoteEntry{APIProtocol: remoteAPIProtocol, InstanceID: s.instanceID,
		Version: version.Version, Platform: runtime.GOOS, Runtime: kind, Origin: s.origin,
		Capabilities: map[string]bool{"projects_browse": true, "client_project_share": runtime.GOOS == "linux" && kind == "container", "terminal": true,
			"browser": true, "desktop": true, "audio": true}})
}

// ServerEntry is used only over an authenticated SSH command channel. It
// attaches to the existing server without triggering desktop build takeover.
// The returned ticket must travel on that private pipe, never a shared log.
func ServerEntry(configPath string) (RemoteEntry, error) {
	var result RemoteEntry
	c, err := connectController(filepath.Dir(configPath))
	if err != nil {
		return result, errors.New("The cloud Cage service is not running or cannot be authenticated. Check the service status.")
	}
	defer c.close()
	entry, err := url.Parse(c.launch.URL)
	if err != nil {
		return result, err
	}
	status, err := c.call("POST", "/api/session", map[string]string{"token": entry.Fragment}, nil)
	if err != nil || status != http.StatusOK {
		return result, errors.New("Could not create a cloud entry session.")
	}
	status, err = c.call("GET", "/api/remote/manifest", nil, &result)
	if err != nil || status != http.StatusOK || !remoteInstanceID.MatchString(result.InstanceID) {
		return RemoteEntry{}, errors.New("The cloud service does not support the current remote connection protocol.")
	}
	// The manifest lookup consumed the first ticket; issue another for the
	// connecting client's private transport.
	var launch launchResponse
	status, err = c.call("POST", "/api/launch", map[string]string{"token": c.record.Token}, &launch)
	if err != nil || status != http.StatusOK {
		return RemoteEntry{}, errors.New("Could not get the one-time cloud entry.")
	}
	u, err := url.Parse(launch.URL)
	if err != nil || u.Scheme+"://"+u.Host != c.origin || u.Fragment == "" {
		return RemoteEntry{}, errors.New("The cloud entry is invalid.")
	}
	result.Ticket = u.Fragment
	return result, nil
}
