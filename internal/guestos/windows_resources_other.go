//go:build !windows

package guestos

import (
	"context"
	"errors"
)

func windowsVMResources(context.Context, string, int, int) (WindowsVMResourceState, error) {
	return WindowsVMResourceState{}, errors.New("Windows guest resource management needs a Windows Hyper-V host.")
}
