//go:build !windows && !linux && !darwin

package cage

import "errors"

func localStorageVolume(string) error {
	return errors.New("Custom environment storage is not supported on this platform.")
}
