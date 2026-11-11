package guestos

import (
	"bytes"
	"context"
	"runtime"
	"strings"

	"github.com/sylvinus/agent-vm/internal/host"
)

func Inspect(_ context.Context) Inspection {
	r := Inspection{Guest: Debian13, WorkbenchSupport: "supported"}
	if runtime.GOARCH != "amd64" {
		r.WorkbenchSupport = "unsupported-host"
		r.Detail = "The Linux desktop release package targets x86_64 hosts."
		return r
	}
	var details bytes.Buffer
	r.HostCheckPassed = host.LinuxPrereqs(&details)
	r.Detail = strings.TrimSpace(details.String())
	if r.HostCheckPassed {
		r.Detail = "The Linux virtualization components required by the Debian workbench were detected."
	}
	return r
}
