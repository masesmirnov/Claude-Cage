//go:build !darwin || !arm64 || !cgo || no_vz

package vm

import "errors"

func macOSRestoreResourceRequirements(string) (MacOSResourceRequirements, error) {
	return MacOSResourceRequirements{}, errors.New("Apple recovery image requirements can only be read on an Apple Silicon Mac.")
}
