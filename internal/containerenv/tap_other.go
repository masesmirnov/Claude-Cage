//go:build !linux

package containerenv

import (
	"context"
	"errors"
	"io"
)

func RunTAP(context.Context, io.Reader, io.Writer, ...string) error {
	return errors.New("The Cage container runtime environment is only supported on Linux servers.")
}
