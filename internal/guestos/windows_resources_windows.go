//go:build windows

package guestos

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
)

func windowsVMResources(ctx context.Context, root string, memoryGiB, cpus int) (WindowsVMResourceState, error) {
	if (memoryGiB == 0) != (cpus == 0) || memoryGiB < 0 || memoryGiB > 1024 || cpus < 0 || cpus > 1024 {
		return WindowsVMResourceState{}, errors.New("Invalid Windows guest resource parameters.")
	}
	binding, err := LoadWindowsProfile(root)
	if err != nil {
		return WindowsVMResourceState{}, err
	}
	if binding == nil {
		return WindowsVMResourceState{}, errors.New("This configuration is not bound to a Windows guest yet.")
	}
	var result WindowsVMResourceState
	if err := windowsHostManagerCall(ctx, binding.VMID, "resources", memoryGiB, cpus, &result); err != nil {
		return result, err
	}
	if result.CPUs < 1 || result.MemoryStartup < 2<<30 || result.State == "" {
		return result, errors.New("Invalid Windows guest resource state.")
	}
	if memoryGiB != 0 && !result.MatchesAllocation(memoryGiB, cpus) {
		return result, errors.New("The Windows guest resources did not reach the requested values.")
	}
	return result, nil
}

func windowsVMResourcesNative(ctx context.Context, id uuid.UUID, memoryGiB, cpus int) (WindowsVMResourceState, error) {
	if id == uuid.Nil || (memoryGiB == 0) != (cpus == 0) || memoryGiB < 0 || memoryGiB > 1024 || cpus < 0 || cpus > 1024 {
		return WindowsVMResourceState{}, errors.New("Invalid Windows guest resource parameters.")
	}
	script := fmt.Sprintf("$targetId=[guid]'%s'\n$memoryGiB=%d\n$cpus=%d\n", id.String(), memoryGiB, cpus) + windowsVMResourcesScript
	cmd, err := systemPowerShellQuery(ctx, script)
	if err != nil {
		return WindowsVMResourceState{}, err
	}
	data, err := cmd.Output()
	if ctx.Err() != nil {
		return WindowsVMResourceState{}, ctx.Err()
	}
	if err != nil {
		return WindowsVMResourceState{}, errors.New("The Windows guest resource operation was not completed. Check the virtual machine state and management permissions.")
	}
	var result WindowsVMResourceState
	if json.Unmarshal(data, &result) != nil || result.CPUs < 1 || result.MemoryStartup < 2<<30 {
		return result, errors.New("Invalid Windows guest resource state.")
	}
	if memoryGiB != 0 && !result.MatchesAllocation(memoryGiB, cpus) {
		return result, errors.New("The Windows guest resources did not reach the requested values.")
	}
	return result, nil
}
