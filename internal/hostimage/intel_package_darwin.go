package hostimage

import (
	"context"
	"errors"
	"os/exec"
	"strings"
)

func verifyApplePackageSignature(ctx context.Context, path string) error {
	data, err := exec.CommandContext(ctx, "/usr/sbin/pkgutil", "--check-signature", path).Output()
	if err != nil {
		return errors.New("Apple installer signature verification failed")
	}
	text := string(data)
	for _, identity := range []string{"Status: signed Apple Software", "Software Update", "Apple Software Update Certification Authority", "Apple Root CA"} {
		if !strings.Contains(text, identity) {
			return errors.New("The install materials have no Apple system update signature chain")
		}
	}
	return nil
}
