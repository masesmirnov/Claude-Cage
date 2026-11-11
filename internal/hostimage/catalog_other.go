//go:build !windows

package hostimage

import (
	"context"
	"errors"
)

func expandWindowsCatalog(context.Context, []byte) ([]byte, error) {
	return nil, errors.New("The Windows installation catalog needs the system extraction component of Windows.")
}
