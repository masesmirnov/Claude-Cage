package cage

import (
	"errors"

	"golang.org/x/sys/unix"
)

func localStorageVolume(path string) error {
	var info unix.Statfs_t
	if err := unix.Statfs(path, &info); err != nil {
		return err
	}
	if info.Flags&unix.MNT_LOCAL == 0 {
		return errors.New("Environment storage needs a local disk.")
	}
	if unix.ByteSliceToString(info.Fstypename[:]) != "apfs" {
		return errors.New("Choose a local APFS volume. The environment needs private file permissions and sparse disk support.")
	}
	if info.Flags&unix.MNT_IGNORE_OWNERSHIP != 0 {
		return errors.New("In Finder, clear \"Ignore ownership on this volume\" in the disk's Get Info, or choose another APFS disk.")
	}
	return nil
}
