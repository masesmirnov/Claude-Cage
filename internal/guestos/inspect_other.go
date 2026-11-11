//go:build !darwin && !linux && !windows

package guestos

import "context"

func Inspect(_ context.Context) Inspection {
	return Inspection{WorkbenchSupport: "unsupported-host", Detail: "This platform has no local Cage workbench."}
}
