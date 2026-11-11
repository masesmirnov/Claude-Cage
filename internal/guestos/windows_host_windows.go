//go:build windows

package guestos

import (
	"context"
	"debug/pe"
	"errors"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
)

// probeWindowsHost checks the local platform without requiring VM-wide privileges.
// It doesn't create a VM or test whether a guest image can be installed.
func probeWindowsHost(ctx context.Context) (bool, string) {
	version := windows.RtlGetVersion()
	const workstation = 1 // VER_NT_WORKSTATION
	if version.ProductType != workstation || version.MajorVersion < 10 || version.BuildNumber < 22000 {
		return false, "A native Windows guest needs a Windows 11 desktop host."
	}
	var processMachine, nativeMachine uint16
	if err := windows.IsWow64Process2(windows.CurrentProcess(), &processMachine, &nativeMachine); err != nil {
		return false, "Could not read the native processor architecture of the Windows host."
	}
	if runtime.GOARCH != "amd64" || nativeMachine != pe.IMAGE_FILE_MACHINE_AMD64 {
		return false, "A native Windows guest needs an Intel or AMD x64 host and the x64 build of Cage."
	}
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	cmd, err := systemPowerShellQuery(ctx, hyperVHostProbe)
	if err != nil {
		return false, "Could not locate the Windows PowerShell that ships with the system."
	}
	output, err := cmd.Output()
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return false, "Querying Hyper-V timed out. Check the local virtual machine management service and try again."
	}
	if ctx.Err() != nil {
		return false, "The Windows host preflight was canceled."
	}
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) && exit.ExitCode() == 2 {
			if reason := strings.TrimSpace(string(output)); reason != "" {
				return false, reason
			}
		}
		return false, "Could not query Hyper-V through the system PowerShell. Check PowerShell and the Windows management service."
	}
	if strings.TrimSpace(string(output)) != "ready" {
		return false, "The Hyper-V preflight returned a result that could not be recognized."
	}
	return true, "The Hyper-V platform is ready. After you confirm the system authorization during the first installation, the Cage management helper only operates the bound guest."
}

func systemPowerShellQuery(ctx context.Context, script string) (*exec.Cmd, error) {
	systemDir, err := windows.GetSystemDirectory()
	if err != nil {
		return nil, err
	}
	shell := filepath.Join(systemDir, "WindowsPowerShell", "v1.0", "powershell.exe")
	cmd := exec.CommandContext(ctx, shell, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd, nil
}

const hyperVHostProbe = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
function Unavailable([string]$reason) { Write-Output $reason; exit 2 }

$edition = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -Name EditionID).EditionID
if ($edition -like 'Core*') {
    Unavailable 'Windows Home does not provide the full Hyper-V role. This prototype supports Pro, Enterprise and Education.'
}
$service = Get-Service -Name vmms -ErrorAction SilentlyContinue
if (!$service) {
    Unavailable 'The Hyper-V virtual machine management service (vmms) was not detected. Check the Hyper-V platform in Windows Features.'
}
if ($service.Status -ne 'Running') {
    Unavailable 'The Hyper-V virtual machine management service (vmms) is not running.'
}
if ((Get-CimInstance Win32_ComputerSystem).HypervisorPresent -ne $true) {
    Unavailable 'Windows did not detect a running hypervisor. Check the firmware virtualization settings and the Hyper-V boot state.'
}
if (!(Get-Command 'Hyper-V\Get-VMHost' -ErrorAction SilentlyContinue)) {
    Unavailable 'The Hyper-V PowerShell management module is missing. Check the Hyper-V management tools in Windows Features.'
}
Write-Output 'ready'
`
