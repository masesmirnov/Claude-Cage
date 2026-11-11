package guestos

import "context"

func Inspect(ctx context.Context) Inspection {
	r := Inspection{Guest: MacOS, WorkbenchSupport: nativeWorkbenchSupport(MacOS, false)}
	image, err := probeMacHost(ctx)
	if err != nil {
		r.Detail = "Could not look up an Apple recovery image compatible with this computer: " + err.Error()
		return r
	}
	r.HostCheckPassed = true
	r.WorkbenchSupport = nativeWorkbenchSupport(MacOS, true)
	r.Restore = &image
	r.Detail = "Apple provides a macOS recovery image compatible with this host."
	return r
}
