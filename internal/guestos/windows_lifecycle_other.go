//go:build !windows

package guestos

import (
	"context"
	"errors"
)

func WindowsVMAction(context.Context, string, string) error {
	return errors.New("Windows guest lifecycle needs a Windows Hyper-V host.")
}
