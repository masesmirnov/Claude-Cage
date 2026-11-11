//go:build !linux

package containerenv

import (
	"context"
	"errors"
)

func (r *Runtime) ensureResourceSlice(context.Context) error {
	return errors.New("The container resource boundary is only supported on Linux.")
}
func (r *Runtime) verifyHostResources(context.Context, string) (resourceEvidence, error) {
	return resourceEvidence{}, errors.New("The container resource boundary is only supported on Linux.")
}
