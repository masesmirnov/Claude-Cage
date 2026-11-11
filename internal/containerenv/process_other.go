//go:build !linux

package containerenv

import (
	"context"
	"errors"
	"os/exec"
)

func detachWorker(*exec.Cmd) {}
func tryLockRuntime(string) (func(), error) {
	return nil, errors.New("The container runtime environment is only supported on Linux servers.")
}
func lockRuntime(context.Context, string) (func(), error) {
	return nil, errors.New("The container runtime environment is only supported on Linux servers.")
}
