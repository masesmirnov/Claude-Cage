//go:build !darwin

package hostimage

import (
	"context"
	"errors"
)

func verifyApplePackageSignature(context.Context, string) error {
	return errors.New("The Apple installer must be verified on macOS")
}
