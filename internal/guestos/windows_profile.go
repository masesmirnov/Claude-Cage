package guestos

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/google/uuid"
)

// WindowsProfile binds one Hyper-V guest to its ordinary GUI user and the
// current host user's protected pairing. It contains no authentication secret.
type WindowsProfile struct {
	Version            int       `json:"version"`
	Mode               string    `json:"mode,omitempty"`
	SandboxPackage     string    `json:"sandbox_package,omitempty"`
	MachineID          string    `json:"machine_id,omitempty"`
	VMID               uuid.UUID `json:"vm_id"`
	GUIUserSID         string    `json:"gui_user_sid"`
	GUIUser            string    `json:"gui_user,omitempty"`
	InstanceDirectory  string    `json:"instance_directory"`
	RelayExecutable    string    `json:"relay_executable"`
	PairingFile        string    `json:"pairing_file"`
	NetworkPairingFile string    `json:"network_pairing_file,omitempty"`
}

var windowsGUISID = regexp.MustCompile(`^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$`)

// Remote binds a dedicated cloud Windows installation, not a nested Hyper-V VM.
func (p *WindowsProfile) Remote() bool { return p != nil && p.Mode == "remote" }

func WindowsProfilePath(root string) string { return filepath.Join(root, "windows-guest.json") }

func (p WindowsProfile) validate() error {
	if p.Mode != "" && p.Mode != "hyperv" && p.Mode != "remote" {
		return errors.New("The Windows work environment run mode is invalid")
	}
	if p.SandboxPackage != "" && (!p.Remote() || p.SandboxPackage != p.VMID.String()) {
		return errors.New("The Windows cloud sandbox ID does not match the bound instance")
	}
	if p.Remote() {
		machine, err := uuid.Parse(p.MachineID)
		if err != nil || machine == uuid.Nil || p.NetworkPairingFile != "" {
			return errors.New("Windows cloud mode needs a machine identity and cannot use Hyper-V network pairing")
		}
	}
	if p.Version != 1 || p.VMID == uuid.Nil || !windowsGUISID.MatchString(p.GUIUserSID) ||
		len(p.GUIUser) > 256 || strings.ContainsAny(p.GUIUser, "\x00\r\n") {
		return errors.New("Invalid Windows guest ID or graphical user.")
	}
	for _, path := range []string{p.InstanceDirectory, p.RelayExecutable, p.PairingFile} {
		if !filepath.IsAbs(path) || strings.ContainsAny(path, "\x00\r\n") {
			return errors.New("The Windows guest configuration needs an absolute local path.")
		}
	}
	if p.NetworkPairingFile != "" && (!filepath.IsAbs(p.NetworkPairingFile) || strings.ContainsAny(p.NetworkPairingFile, "\x00\r\n")) {
		return errors.New("The Windows guest network pairing needs an absolute local path.")
	}
	return nil
}

func LoadWindowsProfile(root string) (*WindowsProfile, error) {
	path := WindowsProfilePath(root)
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() == 0 || info.Size() > 16<<10 {
		return nil, errors.New("Invalid Windows guest configuration file.")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var binding WindowsProfile
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&binding) != nil || decoder.Decode(new(any)) != io.EOF {
		return nil, errors.New("Invalid Windows guest configuration format.")
	}
	if err := binding.validate(); err != nil {
		return nil, err
	}
	return &binding, nil
}

// BindWindowsProfile publishes an independently verified VM/SID binding.
// Windows provisioning owns verification and DPAPI pairing; this never discovers
// a user or VM by scanning the machine and never replaces an existing binding.
func BindWindowsProfile(root string, binding WindowsProfile) error {
	if err := binding.validate(); err != nil {
		return err
	}
	data, err := json.Marshal(binding)
	if err != nil {
		return err
	}
	if err := publishBinding(root, "windows-guest.json", append(data, '\n')); err != nil {
		return err
	}
	return protectWindowsProfile(WindowsProfilePath(root))
}

// WindowsRelayCommand carries only the protected profile path and operation.
// File bytes and UTF-8 path arrays travel in stdin, never a shell or command line.
func WindowsRelayCommand(ctx context.Context, root, operation string, args ...string) (*exec.Cmd, error) {
	p, err := LoadWindowsProfile(root)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, errors.New("This configuration is not bound to a Windows guest yet.")
	}
	switch operation {
	case "headless-status", "headless-terminal", "headless-browser", "headless-safety", "headless-cli":
		if !p.Remote() {
			return nil, errors.New("The background terminal is only for Windows cloud environments")
		}
	case "status", "diagnostics", "versions":
	case "stream", "import", "export", "terminal", "browser", "desktop", "attachments", "audio", "resources", "safety", "project-mount", "network-stream", "network-settings", "cli", "cache-maintenance":
		if p.Remote() {
			return nil, errors.New("Windows cloud only supports paired background sandbox operations")
		}
	default:
		return nil, errors.New("Invalid Windows guest clipboard operation.")
	}
	if len(args) != 0 && !(operation == "export" && len(args) == 1 && args[0] == "--paths-stdin") {
		return nil, errors.New("Windows guest file paths must be passed through standard input.")
	}
	argv := append([]string{"--relay-profile", WindowsProfilePath(root), operation}, args...)
	return exec.CommandContext(ctx, p.RelayExecutable, argv...), nil
}
