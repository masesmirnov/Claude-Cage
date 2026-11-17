package guestos

import (
	"context"
	"errors"
	"golang.org/x/mod/semver"
	"os/exec"
	"strings"
)

func probeMacHost(ctx context.Context) (MacRestore, error) {
	version, err := exec.CommandContext(ctx, "/usr/bin/sw_vers", "-productVersion").Output()
	if err != nil || !semver.IsValid("v"+strings.TrimSpace(string(version))) || semver.Compare("v"+strings.TrimSpace(string(version)), "v15.4") < 0 {
		return MacRestore{}, errors.New("A native guest on an Intel Mac needs macOS 15.4 or newer to support workbench project sharing")
	}
	data, err := exec.CommandContext(ctx, "/usr/sbin/sysctl", "-n", "kern.hv_support").Output()
	if err != nil || strings.TrimSpace(string(data)) != "1" {
		return MacRestore{}, errors.New("Hypervisor.framework is not available on this Intel Mac")
	}
	return MacRestore{MinimumCPUs: 2, MinimumMemoryBytes: 4 << 30}, nil
}
