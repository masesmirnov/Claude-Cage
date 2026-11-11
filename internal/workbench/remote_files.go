package workbench

import (
	"errors"
	"net/http"
	"path/filepath"
)

type connectionTransport struct {
	base http.RoundTripper
	id   string
}

func (t connectionTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	copy := r.Clone(r.Context())
	copy.Header.Set(connectionHeader, t.id)
	return t.base.RoundTrip(copy)
}

func (t connectionTransport) CloseIdleConnections() {
	if closer, ok := t.base.(interface{ CloseIdleConnections() }); ok {
		closer.CloseIdleConnections()
	}
}

// A native picker captures the connection before the user selects a file.
// Matching it here prevents a slow picker from sending that file to a newly
// selected server. Native calls from old local builds may omit it only locally.
func (c *controllerClient) bindConnection(expected string) (ClientContext, error) {
	var current ClientContext
	status, err := c.call("GET", "/api/client/context", nil, &current)
	if err == nil && status == http.StatusNotFound && expected == "" {
		return ClientContext{Mode: "local", ConnectionID: "local"}, nil
	}
	if err != nil || status != http.StatusOK {
		return current, errors.New("Could not verify the current file transfer connection.")
	}
	if current.DesktopGateway && (expected == "" || current.Mode == "none") {
		return current, errors.New("Select a work environment first, then try the file operation again.")
	}
	if current.Mode == "remote" && (expected == "" || current.State.State != "connected") {
		return current, errors.New("The remote connection is unavailable. Reconnect, then select the file.")
	}
	if expected != "" && expected != current.ConnectionID {
		return current, errors.New("The connection has switched. Select the file again on the current host.")
	}
	c.connectionID = current.ConnectionID
	c.client.Transport = connectionTransport{base: c.client.Transport, id: current.ConnectionID}
	return current, nil
}

func clientDownloadProfile(profile string, current ClientContext) (string, error) {
	if current.Mode != "remote" {
		return profile, nil
	}
	if !remoteInstanceID.MatchString(current.InstanceID) {
		return "", errors.New("The remote instance identity is invalid.")
	}
	return filepath.Join(profile, "remote-downloads", current.InstanceID), nil
}
