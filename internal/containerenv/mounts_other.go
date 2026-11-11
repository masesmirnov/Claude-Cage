//go:build !linux

package containerenv

import (
	"context"
	"errors"
)

func (r *Runtime) inspectMounts(*engineContainer) (MountPropagation, error) {
	return MountPropagation{}, errors.New("The container mount check is only supported on Linux.")
}
func (r *Runtime) initializeMounts(context.Context, string) error {
	return errors.New("The container mount initialization is only supported on Linux.")
}
