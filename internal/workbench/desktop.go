package workbench

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/sylvinus/agent-vm/internal/cage"
	"github.com/sylvinus/agent-vm/internal/host"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

type DesktopOptions struct{ CompleteUpdate, UseExisting bool }
type DesktopResult struct {
	Status     string             `json:"status"`
	URL        string             `json:"url,omitempty"`
	Message    string             `json:"message,omitempty"`
	Legacy     bool               `json:"legacy,omitempty"`
	Controller ControllerIdentity `json:"controller"`
}
type controllerClient struct {
	profile, origin string
	connectionID    string
	record          controlFile
	launch          launchResponse
	client          *http.Client
}

var errControllerUnavailable = errors.New("control service is unavailable")

func openController(profile string) (*controllerClient, error) {
	path := filepath.Join(profile, "control.json")
	if err := host.CheckPrivateFile(path); err != nil {
		if os.IsNotExist(err) {
			return nil, errControllerUnavailable
		}
		return nil, err
	}
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil, errControllerUnavailable
	}
	if err != nil {
		return nil, err
	}
	var record controlFile
	if json.Unmarshal(b, &record) != nil || record.Port < 1024 || record.Port > 65535 || len(record.Token) != 64 || record.PID < 1 {
		return nil, errors.New("The backend record is invalid. Keep the existing environment and check the private configuration.")
	}
	jar, _ := cookiejar.New(nil)
	c := &controllerClient{profile: profile, record: record, origin: fmt.Sprintf("http://localhost:%d", record.Port), client: &http.Client{Timeout: 5 * time.Second, Jar: jar, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirect refused") }}}
	return c, nil
}

func connectController(profile string) (*controllerClient, error) {
	if controllerLockFree(profile) {
		return nil, errControllerUnavailable
	}
	c, err := openController(profile)
	if err != nil {
		if controllerLockFree(profile) {
			return nil, errControllerUnavailable
		}
		return nil, err
	}
	record := c.record
	status, err := c.call("POST", "/api/launch", map[string]string{"token": record.Token}, &c.launch)
	if err != nil {
		c.close()
		var networkError *url.Error
		if errors.As(err, &networkError) {
			return nil, errControllerUnavailable
		}
		return nil, err
	}
	if status != http.StatusOK {
		c.close()
		if status == http.StatusServiceUnavailable {
			return nil, errControllerUnavailable
		}
		// A dead controller can leave a record whose port or PID is now reused.
		// Only a free profile lock permits a new controller to replace that
		// record. An occupied or inaccessible lock must preserve its owner.
		if controllerLockFree(profile) {
			return nil, errControllerUnavailable
		}
		return nil, errors.New("Could not authenticate the existing backend. No attempt was made to terminate or replace it.")
	}
	u, err := url.Parse(c.launch.URL)
	if err != nil || u.Scheme != "http" || u.Host != fmt.Sprintf("localhost:%d", record.Port) || u.User != nil || u.Fragment == "" {
		c.close()
		return nil, errors.New("The backend returned an invalid entry. The old workbench was not connected.")
	}
	if c.launch.Controller.Protocol != 0 && c.launch.Controller.PID != record.PID {
		c.close()
		return nil, errors.New("The backend identity has changed. Try connecting again.")
	}
	return c, nil
}
func (c *controllerClient) close() { c.client.CloseIdleConnections() }

// Shutdown removes the record before releasing the profile lock. A new window
// can arrive in that interval; wait for retirement or a ready service without
// spawning a replacement against an occupied lock.
func waitControllerReady(ctx context.Context, profile string) (*controllerClient, error) {
	for {
		c, err := connectController(profile)
		if !errors.Is(err, errControllerUnavailable) {
			return c, err
		}
		free, lockErr := controllerLockStatus(profile)
		if lockErr != nil {
			return nil, lockErr
		}
		if free {
			return nil, errControllerUnavailable
		}
		select {
		case <-ctx.Done():
			return nil, errors.New("The local backend has not exited or is still unresponsive. Try again later.")
		case <-time.After(100 * time.Millisecond):
		}
	}
}
func (c *controllerClient) call(method, path string, input, output any) (int, error) {
	return c.callContext(context.Background(), method, path, input, output)
}

func (c *controllerClient) callContext(ctx context.Context, method, path string, input, output any) (int, error) {
	var body []byte
	var err error
	if input != nil {
		body, err = json.Marshal(input)
		if err != nil {
			return 0, err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, c.origin+path, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Origin", c.origin)
	req.Header.Set("Content-Type", "application/json")
	if c.connectionID != "" {
		req.Header.Set(connectionHeader, c.connectionID)
	}
	res, err := c.client.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusOK && output != nil {
		if err = json.NewDecoder(io.LimitReader(res.Body, 256<<10)).Decode(output); err != nil {
			return res.StatusCode, errors.New("The backend response is invalid. The update was not continued.")
		}
	}
	return res.StatusCode, nil
}
func pendingUpdate(c *controllerClient) DesktopResult {
	return DesktopResult{Status: "upgrade_pending", Legacy: c.launch.Controller.Protocol == 0, Controller: c.launch.Controller, Message: "The new version is ready, but the current background is still running. Open the existing environment and save your files first, then choose \"Save, stop the environment, and finish the update\". Terminal tasks will end; projects and sign-in state are kept."}
}

// Desktop never silently loads a different build's UI. Completing an update is
// an explicit user action because it stops the existing environment's work.
func Desktop(configPath string, options DesktopOptions) (DesktopResult, error) {
	return desktopLaunch(filepath.Dir(configPath), false, options, func() error { return startController(configPath) })
}

func desktopLaunch(profile string, gateway bool, options DesktopOptions, start func() error) (DesktopResult, error) {
	want, err := currentController()
	if err != nil {
		return DesktopResult{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	current, err := waitControllerReady(ctx, profile)
	if err == nil {
		defer current.close()
		if current.launch.DesktopGateway != gateway {
			return DesktopResult{}, errors.New("This directory is used by a different Cage service. Check the configuration path.")
		}
		if options.CompleteUpdate {
			if current.launch.DesktopGateway {
				err = current.releaseDesktopEntry()
			} else {
				err = current.stopAndHandoff()
			}
			if err != nil {
				return DesktopResult{}, err
			}
		} else if want.matches(current.launch.Controller) || options.UseExisting {
			status := "ready"
			if !want.matches(current.launch.Controller) {
				status = "existing"
			}
			return DesktopResult{Status: status, URL: current.launch.URL, Controller: current.launch.Controller, Legacy: current.launch.Controller.Protocol == 0}, nil
		} else {
			if current.launch.Controller.Protocol != controlProtocol {
				return pendingUpdate(current), nil
			}
			status, handoffErr := current.call("POST", "/api/handoff", map[string]string{"token": current.record.Token}, nil)
			if handoffErr != nil {
				return DesktopResult{}, handoffErr
			}
			if status != http.StatusOK {
				return pendingUpdate(current), nil
			}
			if err = current.waitForExit(); err != nil {
				return DesktopResult{}, err
			}
		}
	} else if !errors.Is(err, errControllerUnavailable) {
		return DesktopResult{}, err
	}
	if err = start(); err != nil {
		return DesktopResult{}, err
	}
	for i := 0; i < 60; i++ {
		c, readErr := connectController(profile)
		if readErr == nil {
			c.close()
			if c.launch.DesktopGateway != gateway {
				return DesktopResult{}, errors.New("The control service identity changed while opening. Select again.")
			}
			if want.matches(c.launch.Controller) {
				return DesktopResult{Status: "ready", URL: c.launch.URL, Controller: c.launch.Controller}, nil
			}
			return pendingUpdate(c), nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	return DesktopResult{}, errors.New("The workbench could not start. Check control.log in the private configuration and try again.")
}

// PrepareUpdate is shared by the explicit migration button and the installer.
// It returns only after the old service has released its profile lock.
func PrepareUpdate(configPath string, stop bool) (DesktopResult, error) {
	// A closing controller stops accepting requests before releasing its lock.
	// Use the same bounded retirement wait as desktop startup; the lock and VM
	// checks below still decide whether replacing the application is safe.
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	c, err := waitControllerReady(ctx, filepath.Dir(configPath))
	if errors.Is(err, errControllerUnavailable) {
		lock, lockErr := openControllerLock(filepath.Dir(configPath), os.O_RDWR)
		if lockErr == nil {
			defer lock.Close()
			if lockController(lock) != nil {
				return DesktopResult{}, errors.New("The backend is temporarily unreachable and has not exited. Restore the connection and retry the update.")
			}
			defer unlockController(lock)
		} else if !os.IsNotExist(lockErr) {
			return DesktopResult{}, lockErr
		}
		if controllerHasVM(filepath.Dir(configPath)) {
			return DesktopResult{}, errors.New("The backend is unreachable, but environment processes are still running. Restore the workbench connection, save and stop, then update.")
		}
		return DesktopResult{Status: "prepared"}, nil
	}
	if err != nil {
		return DesktopResult{}, err
	}
	defer c.close()
	if stop {
		if err = c.stopAndHandoff(); err != nil {
			return DesktopResult{}, err
		}
		return DesktopResult{Status: "prepared"}, nil
	}
	if c.launch.Controller.Protocol == controlProtocol {
		// Routine status probes also hold the operation lock. Retry briefly.
		// every request still checks running jobs, terminals and VM ownership.
		handoffCtx, cancelHandoff := context.WithTimeout(ctx, 3*time.Second)
		defer cancelHandoff()
		conflicted := false
	handoff:
		for {
			status, err := c.callContext(handoffCtx, "POST", "/api/handoff", map[string]string{"token": c.record.Token}, nil)
			if err != nil {
				if conflicted && handoffCtx.Err() != nil {
					break
				}
				return DesktopResult{}, err
			}
			if status == http.StatusOK {
				if err = c.waitForExit(); err != nil {
					return DesktopResult{}, err
				}
				return DesktopResult{Status: "prepared"}, nil
			}
			if status != http.StatusConflict {
				break
			}
			conflicted = true
			select {
			case <-handoffCtx.Done():
				break handoff
			case <-time.After(50 * time.Millisecond):
			}
		}
	}
	return DesktopResult{Status: "stop_required", Message: "Save your files, then confirm stopping the environment and installing the update. Terminal tasks will end; projects and sign-in state are kept."}, nil
}
func (c *controllerClient) stopAndHandoff() error {
	legacy := c.launch.Controller.Protocol == 0
	var owner legacyProcessIdentity
	var err error
	if legacy {
		owner, err = identifyLegacyController(c.profile, c.record)
		if err != nil {
			return err
		}
	} else if c.launch.Controller.Protocol != controlProtocol {
		return errors.New("This version does not support the current background protocol. The running environment was kept. Use the matching Cage version to stop the environment.")
	}
	u, _ := url.Parse(c.launch.URL)
	status, err := c.call("POST", "/api/session", map[string]string{"token": u.Fragment}, nil)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return errors.New("Could not create a stop session. Try again.")
	}
	var clientContext ClientContext
	contextStatus, contextErr := c.call("GET", "/api/client/context", nil, &clientContext)
	if contextErr == nil && contextStatus == http.StatusOK && (clientContext.Mode == "remote" || clientContext.ClientOnly) {
		path := "/api/client/local"
		if clientContext.ClientOnly {
			path = "/api/client/disconnect"
		}
		status, err = c.call("POST", path, map[string]string{"connection_id": clientContext.ConnectionID}, nil)
		if err != nil || status != http.StatusOK {
			return errors.New("Could not disconnect the local remote connection. The update was not continued.")
		}
		if clientContext.ClientOnly {
			status, err = c.call("POST", "/api/handoff", map[string]string{"token": c.record.Token}, nil)
			if err != nil || status != http.StatusOK {
				return errors.New("The local connection service has not exited. Try again later.")
			}
			return c.waitForExit()
		}
	}
	var requested Job
	status, err = c.call("POST", "/api/stop", map[string]any{}, &requested)
	if err != nil {
		return err
	}
	if status != http.StatusOK || requested.ID == "" {
		return errors.New("The backend did not accept the stop request. This update was canceled.")
	}
	deadline := time.Now().Add(2 * time.Minute)
	for {
		var state struct {
			VMRunning *bool `json:"vm_running"`
			Job       Job   `json:"job"`
		}
		status, err = c.call("GET", "/api/status", nil, &state)
		if err != nil {
			return err
		}
		if status != http.StatusOK || state.VMRunning == nil || state.Job.ID != requested.ID {
			return errors.New("The stop state changed. The backend was not terminated. Check the existing tasks and try again.")
		}
		if !state.Job.Running {
			if state.Job.Error != "" || *state.VMRunning {
				return errors.New("The environment did not stop safely. The update was not continued. Check the stop result in the original workbench.")
			}
			break
		}
		if time.Now().After(deadline) {
			return errors.New("Stopping the environment timed out. The backend kept running. Try the update again later.")
		}
		time.Sleep(200 * time.Millisecond)
	}
	var terminals []struct {
		Closed bool `json:"closed"`
	}
	status, err = c.call("GET", "/api/terminals", nil, &terminals)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return errors.New("Could not confirm that terminals have stopped. The update was not continued.")
	}
	for _, terminal := range terminals {
		if !terminal.Closed {
			return errors.New("Terminals are still running. The update was not continued.")
		}
	}
	if legacy {
		verified, err := identifyLegacyController(c.profile, c.record)
		if err != nil || verified != owner {
			return errors.New("The old backend process identity has changed. No exit signal was sent. Retry the update.")
		}
		var final struct {
			VMRunning *bool `json:"vm_running"`
			Job       Job   `json:"job"`
		}
		status, err = c.call("GET", "/api/status", nil, &final)
		if err != nil || status != http.StatusOK || final.VMRunning == nil || *final.VMRunning || final.Job.ID != requested.ID || final.Job.Running || final.Job.Error != "" || controllerHasVM(c.profile) {
			return errors.New("The environment did more work after stopping. The old backend was not terminated. Save, stop, and try again.")
		}
		if err = terminateLegacy(owner.PID); err != nil {
			return errors.New("The old backend did not exit. The app was not replaced.")
		}
	} else {
		status, err = c.call("POST", "/api/handoff", map[string]string{"token": c.record.Token}, nil)
		if err != nil {
			return err
		}
		if status != http.StatusOK {
			return errors.New("The backend is still doing work. The update was not continued. Save, stop, and try again.")
		}
	}
	return c.waitForExit()
}
func (c *controllerClient) waitForExit() error {
	f, err := openControllerLock(c.profile, os.O_RDWR)
	if err != nil {
		return errors.New("Could not confirm that the backend has exited. The update was not continued.")
	}
	defer f.Close()
	for i := 0; i < 100; i++ {
		if lockController(f) == nil {
			_ = unlockController(f)
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return errors.New("The backend has not exited and the process was not force-killed. Try the update again later.")
}
func startController(configPath string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	return startControllerExecutable(configPath, exe)
}

func startControllerExecutable(configPath, exe string, extraEnv ...string) error {
	profile := filepath.Dir(configPath)
	if err := host.EnsurePrivateDir(profile); err != nil {
		return err
	}
	cmd := exec.Command(exe, "log-relay", "controller")
	cmd.Dir = profile
	cmd.Env = append(os.Environ(), cage.ConfigEnv+"="+configPath)
	cmd.Env = append(cmd.Env, extraEnv...)
	detachController(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}
