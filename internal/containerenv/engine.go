package containerenv

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type State struct {
	Exists            bool   `json:"exists"`
	Running           bool   `json:"running"`
	Ready             bool   `json:"ready"`
	ContainerID       string `json:"container_id,omitempty"`
	PID               int    `json:"pid,omitempty"`
	MemoryBytes       int64  `json:"memory_bytes"`
	CPUs              int    `json:"cpus"`
	BrowserAddress    string `json:"browser_address,omitempty"`
	VNCAddress        string `json:"vnc_address,omitempty"`
	StoragePath       string `json:"storage_path,omitempty"`
	ResourcesVerified bool   `json:"resources_verified"`
	ResourceError     string `json:"resource_error,omitempty"`
	PIDs              int64  `json:"pids"`
	MountsReady       bool   `json:"mounts_ready"`
	MountError        string `json:"mount_error,omitempty"`
}

type Inspection struct {
	State              State            `json:"state"`
	Rootless           bool             `json:"rootless"`
	NetworkConfined    bool             `json:"network_confined"`
	FilesystemConfined bool             `json:"filesystem_confined"`
	Evidence           string           `json:"evidence"`
	MountPropagation   MountPropagation `json:"mount_propagation"`
}

type engineContainer struct {
	ID    string `json:"Id"`
	Image string `json:"Image"`
	State struct {
		Running bool
		Pid     int
	}
	Config struct {
		Labels map[string]string
		Image  string
	}
	HostConfig struct {
		Privileged   bool
		NetworkMode  string
		PidMode      string
		IpcMode      string
		CgroupnsMode string
		CgroupParent string
		UsernsMode   string
		Binds        []string
		ExtraHosts   []string
		CapAdd       []string
		Memory       int64
		NanoCpus     int64
		Devices      []struct {
			PathOnHost      string
			PathInContainer string
		}
	}
	Mounts []struct {
		Type        string
		Source      string
		Destination string
	}
}

func (r *Runtime) command(ctx context.Context, args ...string) *exec.Cmd {
	if r.config.Engine == "docker" {
		// Docker's normal client config can inject the user's proxy URLs and
		// credentials into new containers. Use a profile-private empty config.
		args = append([]string{"--config", filepath.Join(r.InstanceDir(), "client-config"), "--host", r.config.Socket}, args...)
	}
	command := exec.CommandContext(ctx, r.config.Executable, args...)
	for _, entry := range os.Environ() {
		name, _, _ := strings.Cut(entry, "=")
		switch name {
		case "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "CONTAINER_HOST", "CONTAINER_CONNECTION":
			continue
		}
		command.Env = append(command.Env, entry)
	}
	return command
}

func (r *Runtime) output(ctx context.Context, args ...string) ([]byte, error) {
	command := r.command(ctx, args...)
	var output, diagnostic bytes.Buffer
	command.Stdout = &limitedWriter{writer: &output, left: 1 << 20}
	command.Stderr = &limitedWriter{writer: &diagnostic, left: 4096}
	if err := command.Run(); err != nil {
		return nil, fmt.Errorf("Container engine operation failed: %w: %s", err, strings.TrimSpace(diagnostic.String()))
	}
	return output.Bytes(), nil
}

type limitedWriter struct {
	writer *bytes.Buffer
	left   int
}

func (w *limitedWriter) Write(data []byte) (int, error) {
	if len(data) > w.left {
		return 0, errors.New("container engine output limit exceeded")
	}
	n, err := w.writer.Write(data)
	w.left -= n
	return n, err
}

func (r *Runtime) inspectContainer(ctx context.Context) (*engineContainer, error) {
	// Query only this exact managed name. An empty result is absence, while
	// engine/permission failures remain errors rather than triggering creation.
	data, err := r.output(ctx, "container", "ls", "--all", "--filter", "label="+profileLabel+"="+r.identity, "--format", "{{.ID}}")
	if err != nil {
		return nil, err
	}
	id := strings.TrimSpace(string(data))
	if id == "" {
		return nil, nil
	}
	if strings.ContainsAny(id, " \r\n\t") {
		return nil, errors.New("The container ID is not unique.")
	}
	data, err = r.output(ctx, "container", "inspect", id)
	if err != nil {
		return nil, err
	}
	var found []engineContainer
	if json.Unmarshal(data, &found) != nil || len(found) != 1 || found[0].Config.Labels[profileLabel] != r.identity {
		return nil, errors.New("The container identity does not match the current Cage configuration.")
	}
	return &found[0], nil
}

func (r *Runtime) State(ctx context.Context) (State, error) {
	container, err := r.inspectContainer(ctx)
	if err != nil {
		return State{}, err
	}
	if container == nil {
		storage, err := r.StoragePath(ctx)
		return State{CPUs: r.config.CPUs, MemoryBytes: r.config.MemoryBytes, StoragePath: storage}, err
	}
	state := State{Exists: true, Running: container.State.Running, ContainerID: container.ID, PID: container.State.Pid, MemoryBytes: container.HostConfig.Memory, CPUs: int(container.HostConfig.NanoCpus / 1e9)}
	state.StoragePath, err = r.StoragePath(ctx)
	if err != nil {
		return State{}, err
	}
	if state.Running {
		mounts, mountErr := r.inspectMounts(container)
		if mountErr != nil {
			state.MountError = mountErr.Error()
		} else {
			state.MountsReady = mounts.Ready()
		}
		resources, resourceErr := r.verifyResources(ctx, container.ID)
		if resourceErr != nil {
			state.MemoryBytes = 0
			state.CPUs = 0
			state.ResourceError = resourceErr.Error()
		} else {
			state.MemoryBytes = resources.MemoryBytes
			state.CPUs = resources.CPUs
			state.PIDs = resources.PIDs
			state.ResourcesVerified = true
		}
		if record, err := r.networkState(ctx, container.ID); err == nil {
			state.Ready = state.ResourcesVerified && state.MountsReady
			state.BrowserAddress = record.BrowserAddress
			state.VNCAddress = record.VNCAddress
		}
	}
	return state, nil
}

// StoragePath reports the engine's actual persistent storage location. An
// explicitly supplied rootless engine may already store data outside the
// profile; this path is never treated as disposable or removed by Cage.
func (r *Runtime) StoragePath(ctx context.Context) (string, error) {
	format := "{{.DockerRootDir}}"
	if r.config.Engine == "podman" {
		format = "{{.Store.GraphRoot}}"
	}
	data, err := r.output(ctx, "info", "--format", format)
	if err != nil {
		return "", err
	}
	path := strings.TrimSpace(string(data))
	if !filepath.IsAbs(path) || strings.ContainsAny(path, "\x00\r\n") {
		return "", errors.New("Invalid container persistent storage location.")
	}
	return path, nil
}

func (r *Runtime) rootlessEngine(ctx context.Context) (bool, error) {
	rootless, limited, err := r.engineSecurity(ctx)
	if err != nil {
		return false, err
	}
	if !limited {
		return false, errors.New("The container engine must use systemd and cgroup v2 to enforce CPU, memory and process limits.")
	}
	return rootless, nil
}

// Shutdown still works if an engine loses its resource-controller support.
// Starting and inspecting enforce the stronger rootlessEngine precondition.
func (r *Runtime) engineSecurity(ctx context.Context) (rootless, limited bool, err error) {
	if r.config.Engine == "docker" {
		data, err := r.output(ctx, "info", "--format", "{{json .SecurityOptions}}\n{{.CgroupDriver}}\n{{.CgroupVersion}}")
		if err != nil {
			return false, false, err
		}
		var options []string
		lines := strings.Split(strings.TrimSpace(string(data)), "\n")
		if len(lines) != 3 || json.Unmarshal([]byte(lines[0]), &options) != nil {
			return false, false, errors.New("Could not confirm the Docker security configuration.")
		}
		limited = lines[1] == "systemd" && lines[2] == "2"
		for _, option := range options {
			if option == "name=rootless" || strings.HasPrefix(option, "name=rootless,") {
				return true, limited, nil
			}
		}
		return false, limited, nil
	}
	data, err := r.output(ctx, "info", "--format", "{{.Host.Security.Rootless}}\n{{.Host.CgroupManager}}\n{{.Host.CgroupVersion}}")
	if err != nil {
		return false, false, err
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 3 {
		return false, false, errors.New("Could not confirm the Podman security configuration.")
	}
	return lines[0] == "true", lines[1] == "systemd" && (lines[2] == "v2" || lines[2] == "2"), nil
}

func checkContainerConfiguration(container *engineContainer) error {
	config := container.HostConfig
	if config.Privileged || config.NetworkMode != "none" || (config.PidMode != "" && config.PidMode != "private") || config.IpcMode != "private" || config.CgroupnsMode != "private" {
		return errors.New("The container must use its own namespaces and have the default network disabled; privileged mode cannot be enabled.")
	}
	if len(config.Binds) > 0 {
		return errors.New("The container cannot mount host directories directly.")
	}
	for _, entry := range config.ExtraHosts {
		if entry != "cage:127.0.1.1" {
			return errors.New("The container only allows the fixed loopback address for the Cage host name.")
		}
	}
	for _, mount := range container.Mounts {
		if mount.Type == "bind" || mount.Type == "volume" {
			return errors.New("The container has mounts not authorized by Cage file sharing.")
		}
	}
	for _, device := range config.Devices {
		if (device.PathOnHost != "/dev/fuse" && device.PathOnHost != "/dev/net/tun") || device.PathOnHost != device.PathInContainer {
			return errors.New("The container has extra host devices.")
		}
	}
	for _, capability := range config.CapAdd {
		capability = strings.TrimPrefix(capability, "CAP_")
		if capability != "NET_ADMIN" && capability != "SYS_ADMIN" {
			return errors.New("The container has extra system privileges.")
		}
	}
	return nil
}

func (r *Runtime) Inspect(ctx context.Context) (Inspection, error) {
	rootless, err := r.rootlessEngine(ctx)
	if err != nil {
		return Inspection{}, err
	}
	if !rootless {
		return Inspection{}, errors.New("The Cage container must run on a separate rootless engine.")
	}
	container, err := r.inspectContainer(ctx)
	if err != nil {
		return Inspection{}, err
	}
	if container == nil {
		return Inspection{Rootless: true}, nil
	}
	if err := checkContainerConfiguration(container); err != nil {
		return Inspection{}, err
	}
	if container.HostConfig.CgroupParent != r.resourceSlice() {
		return Inspection{}, errors.New("The existing container is missing the host resource boundary of the current configuration. The original data was kept and an unconstrained start was refused.")
	}
	state := State{Exists: true, Running: container.State.Running, ContainerID: container.ID, PID: container.State.Pid, MemoryBytes: container.HostConfig.Memory, CPUs: int(container.HostConfig.NanoCpus / 1e9)}
	state.StoragePath, err = r.StoragePath(ctx)
	if err != nil {
		return Inspection{}, err
	}
	result := Inspection{State: state, Rootless: true, Evidence: "rootless engine; no default network or host directory mounts; waiting for the network and file sharing checks while running"}
	if state.Running {
		mounts, err := r.inspectMounts(container)
		if err != nil {
			return Inspection{}, err
		}
		result.MountPropagation = mounts
		result.State.MountsReady = mounts.Ready()
		resources, err := r.verifyResources(ctx, container.ID)
		if err != nil {
			return Inspection{}, err
		}
		result.State.MemoryBytes = resources.MemoryBytes
		result.State.CPUs = resources.CPUs
		result.State.PIDs = resources.PIDs
		result.State.ResourcesVerified = true
		if record, err := r.networkState(ctx, container.ID); err == nil {
			result.State.Ready = mounts.Ready()
			result.State.BrowserAddress = record.BrowserAddress
			result.State.VNCAddress = record.VNCAddress
			result.NetworkConfined = true
			result.FilesystemConfined = mounts.Ready()
			result.Evidence = "The actual rootless container has no default network or host directory mounts; the current external network gate identity is verified, the host receives the only TAP channel; the default project is shared over restricted SFTP and read/write was verified on both ends"
		}
	}
	return result, nil
}
