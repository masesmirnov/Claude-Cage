//go:build !windows

package guestos

import (
	"context"
	"errors"
	"os/exec"
)

func WindowsMaintenanceCommand(context.Context, string, string, string, bool) (*exec.Cmd, error) {
	return nil, errors.New("Windows guest maintenance needs its Windows Hyper-V host.")
}
