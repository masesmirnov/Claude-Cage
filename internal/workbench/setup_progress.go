package workbench

import (
	"strconv"
	"strings"
	"time"
)

type SetupProgress struct {
	Phase          string  `json:"phase"`
	Label          string  `json:"label"`
	Received       *int64  `json:"received,omitempty"`
	Total          int64   `json:"total,omitempty"`
	System         string  `json:"system,omitempty"`
	Operation      string  `json:"operation,omitempty"`
	BytesPerSecond float64 `json:"bytes_per_second,omitempty"`
}

// Only fixed component names from the installer are displayed. Other output
// continues through the existing redacted operation log.
func parseSetupProgress(line string) *SetupProgress {
	line = strings.TrimSpace(line)
	if strings.HasPrefix(line, "CAGE_HOST_RETRY ") {
		fields := strings.Fields(line)
		if len(fields) != 3 || (fields[2] != "2" && fields[2] != "3") {
			return nil
		}
		label := macOSDownloadLabel(fields[1])
		if label == "" {
			return nil
		}
		return &SetupProgress{Phase: "image", Label: label + " (preparing attempt " + fields[2] + "/3)", System: "macos", Operation: "download"}
	}
	if strings.HasPrefix(line, "CAGE_HOST_BYTES ") {
		fields := strings.Fields(line)
		if len(fields) != 4 {
			return nil
		}
		label := macOSDownloadLabel(fields[1])
		received, err := strconv.ParseInt(fields[2], 10, 64)
		total, te := strconv.ParseInt(fields[3], 10, 64)
		if label == "" || err != nil || te != nil || received < 0 || total < 0 || total > 0 && received > total {
			return nil
		}
		return &SetupProgress{Phase: "image", Label: label, System: "macos", Operation: "download", Received: &received, Total: total}
	}
	if strings.HasPrefix(line, "Downloading ") {
		if label := macOSDownloadLabel(strings.TrimPrefix(line, "Downloading ")); label != "" {
			return &SetupProgress{Phase: "image", Label: label, System: "macos"}
		}
	}
	if strings.HasPrefix(line, "CAGE_GUEST_BYTES ") {
		fields := strings.Fields(line)
		if len(fields) != 5 {
			return nil
		}
		name := guestProgressName(fields[1])
		received, err := strconv.ParseInt(fields[3], 10, 64)
		total, te := strconv.ParseInt(fields[4], 10, 64)
		if name == "" || err != nil || te != nil || received < 0 || total < 0 || (total > 0 && received > total) {
			return nil
		}
		label := "Downloading the " + name + " system image"
		switch fields[2] {
		case "download":
		case "verify":
			label = "Verifying the " + name + " system image"
		default:
			return nil
		}
		return &SetupProgress{Phase: "image", Label: label, Received: &received, Total: total, System: fields[1], Operation: fields[2]}
	}
	if strings.HasPrefix(line, "CAGE_GUEST_STAGE ") {
		fields := strings.Fields(line)
		if len(fields) != 3 || guestProgressName(fields[1]) == "" {
			return nil
		}
		p := &SetupProgress{System: fields[1]}
		if fields[1] == "windows-11" {
			p.Operation = fields[2]
		}
		switch fields[2] {
		case "restore":
			p.Phase, p.Label = "packages", "Installing "+guestProgressName(fields[1])
		case "account", "oobe", "credentials":
			if fields[1] != "windows-11" {
				return nil
			}
			p.Phase = "packages"
			p.Label = map[string]string{
				"account":     "Set up the guest local administrator in the installer window",
				"oobe":        "Finish Windows first-time setup in the virtual machine connection window",
				"credentials": "Enter the guest administrator account in the installer window",
			}[fields[2]]
		case "media":
			p.Phase, p.Label = "image", "Downloading and verifying the guest developer components"
		case "tools":
			p.Phase, p.Label = "tools", "Installing the guest apps and developer tools"
		case "services":
			p.Phase, p.Label = "services", "Finishing the guest configuration"
		default:
			return nil
		}
		return p
	}
	if strings.HasPrefix(line, "CAGE_IMAGE_BYTES ") {
		fields := strings.Fields(line)
		if len(fields) != 3 {
			return nil
		}
		received, err := strconv.ParseInt(fields[1], 10, 64)
		total, te := strconv.ParseInt(fields[2], 10, 64)
		if err != nil || te != nil || received < 0 || total < -1 || (total > 0 && received > total) {
			return nil
		}
		return &SetupProgress{Phase: "image", Label: "Downloading the Debian 13 image", Received: &received, Total: max(total, 0)}
	}
	if strings.HasPrefix(line, "CAGE_TOOL_BYTES ") {
		fields := strings.Fields(line)
		if len(fields) != 3 && len(fields) != 4 {
			return nil
		}
		received, err := strconv.ParseInt(fields[2], 10, 64)
		if err != nil || received < 0 {
			return nil
		}
		p := &SetupProgress{Phase: "tools", Received: &received}
		if len(fields) == 4 {
			total, err := strconv.ParseInt(fields[3], 10, 64)
			if err != nil || total <= 0 || received > total {
				return nil
			}
			p.Total = total
		}
		switch fields[1] {
		case "mise.tar.gz":
			p.Phase, p.Label = "packages", "Downloading mise"
		case "code-server.deb":
			p.Label = "Downloading the web editor code-server"
		case "chromium.deb":
			p.Phase, p.Label = "packages", "Downloading the Chromium browser"
		case "chromium-common.deb":
			p.Phase, p.Label = "packages", "Downloading Chromium shared resources"
		case "claude-code-linux-x64.tgz", "claude-code-linux-arm64.tgz":
			p.Label = "Downloading Claude Code"
		default:
			return nil
		}
		return p
	}
	switch line {
	case "CAGE_IMAGE_READY":
		return &SetupProgress{Phase: "image", Label: "Starting the Linux base environment"}
	case "CAGE_IMAGE_VERIFY":
		return &SetupProgress{Phase: "image", Label: "Verifying the Debian image"}
	case "Installing packages inside VM...", "Installing base packages...":
		return &SetupProgress{Phase: "packages", Label: "Installing the Linux base packages"}
	case "Installing Python 3...":
		return &SetupProgress{Phase: "packages", Label: "Installing Python"}
	case "Installing Chromium...":
		return &SetupProgress{Phase: "packages", Label: "Installing the Chromium browser"}
	case "Installing Node.js 24...":
		return &SetupProgress{Phase: "packages", Label: "Installing Node.js 24"}
	case "Installing mise...":
		return &SetupProgress{Phase: "packages", Label: "Installing mise"}
	case "Installing Claude Code...":
		return &SetupProgress{Phase: "tools", Label: "Installing Claude Code"}
	case "Installing code-server...":
		return &SetupProgress{Phase: "tools", Label: "Installing the web editor code-server"}
	}
	if strings.HasPrefix(line, "Running custom setup from ") {
		return &SetupProgress{Phase: "services", Label: "Configuring the desktop services"}
	}
	return nil
}

func macOSDownloadLabel(name string) string {
	component := map[string]string{
		"editor.tgz": "macOS web editor", "playwright.tgz": "Browser control component", "node.tgz": "Node.js",
		"macfuse.dmg": "macFUSE file sharing component", "claude.dmg": "Claude Desktop", "chrome.dmg": "Chrome browser",
		"macos-cli-claude": "Claude Code", "macos-cli-uv.tar.gz": "uv developer tool",
		"macos-cli-python.tar.gz": "Python", "macos-cli-git.tar.gz": "Git", "macos-cli-gh.zip": "GitHub CLI",
	}[name]
	if component == "" {
		return ""
	}
	return "Downloading " + component
}

func guestProgressName(system string) string {
	return map[string]string{"macos": "macOS", "windows-11": "Windows 11", "debian-12": "Debian 12", "debian-13": "Debian 13", "ubuntu-22.04": "Ubuntu 22.04", "ubuntu-24.04": "Ubuntu 24.04"}[system]
}

func (e *jobExecution) setSetupProgress(p *SetupProgress) {
	e.owner.mu.Lock()
	defer e.owner.mu.Unlock()
	if e.id != "" && e.id == e.owner.state.ID && e.owner.state.Running {
		e.owner.state.SetupProgress = p
		e.progressUpdated = time.Now()
	}
}
