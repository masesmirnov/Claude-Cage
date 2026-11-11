package guestos

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
)

//go:embed hyperv_instance.ps1
var hyperVInstanceQuery string

// InspectHyperV reads Hyper-V configuration without starting the VM, opening a
// guest session, enumerating unrelated VMs, or binding this VM to Cage.
func InspectHyperV(ctx context.Context, id uuid.UUID) (HyperVInspection, error) {
	if id == uuid.Nil {
		return HyperVInspection{}, errors.New("expected a non-empty Hyper-V VM GUID")
	}
	report := HyperVInspection{Inspection: Inspect(ctx), VMID: id.String(), Lookup: "unavailable"}
	if !report.HostCheckPassed {
		return report, nil
	}
	var actual HyperVInspection
	if err := windowsHostManagerCall(ctx, id, "inspect", 0, 0, &actual); err != nil {
		if ctx.Err() != nil {
			return report, ctx.Err()
		}
		report.LookupDetail = err.Error()
		return report, nil
	}
	if actual.VMID != id.String() || actual.Lookup != "found" || actual.VM == nil {
		return report, errors.New("The virtual machine identity returned by the Windows system management helper is invalid.")
	}
	actual.Inspection = report.Inspection
	return actual, nil
}

func inspectHyperVNative(ctx context.Context, id uuid.UUID) (HyperVInspection, error) {
	if id == uuid.Nil {
		return HyperVInspection{}, errors.New("expected a non-empty Hyper-V VM GUID")
	}
	report := HyperVInspection{Inspection: Inspection{Guest: Windows11, HostCheckPassed: true, WorkbenchSupport: nativeWorkbenchSupport(Windows11, true)}, VMID: id.String(), Lookup: "unavailable"}
	// UUID.String supplies only hexadecimal digits and dashes.
	query := fmt.Sprintf("$targetId = [guid]'%s'\n", id.String()) + hyperVInstanceQuery
	cmd, err := systemPowerShellQuery(ctx, query)
	if err != nil {
		return report, err
	}
	output, err := cmd.Output()
	if ctx.Err() != nil {
		return report, ctx.Err()
	}
	if err != nil {
		report.LookupDetail = "Could not read the Hyper-V configuration of this virtual machine. Check the current user permissions and the virtual machine state."
		return report, nil
	}
	if err := json.Unmarshal(output, &report.VM); err != nil {
		return report, errors.New("Hyper-V returned a virtual machine configuration that could not be recognized.")
	}
	if report.VM == nil {
		report.Lookup = "not-found"
		report.LookupDetail = "The current user found no local Hyper-V virtual machine with this ID."
	} else {
		report.Lookup = "found"
	}
	return report, nil
}
