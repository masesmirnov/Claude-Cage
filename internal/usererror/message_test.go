package usererror

import (
	"context"
	"crypto/x509"
	"errors"
	"io/fs"
	"net"
	"net/url"
	"strings"
	"syscall"
	"testing"
)

func TestKnownFailureIsReadableAndPreservesCause(t *testing.T) {
	for _, tc := range []struct {
		cause  error
		reason string
	}{
		{context.DeadlineExceeded, "timed out"},
		{&url.Error{Op: "GET", URL: "https://user:private@example.com/secret", Err: &net.DNSError{Err: "no such host", Name: "secret.example"}}, "domain name"},
		{&fs.PathError{Op: "open", Path: "/private-secret/file", Err: fs.ErrPermission}, "denied access"},
		{syscall.ENOSPC, "out of free space"},
		{syscall.ECONNREFUSED, "refused the connection"},
		{x509.UnknownAuthorityError{}, "certificate"},
	} {
		err := Wrap("Connecting to the update source", tc.cause, "Check the selected proxy.")
		if !strings.Contains(err.Error(), tc.reason) || !strings.Contains(err.Error(), "Connecting to the update source") || strings.Contains(err.Error(), "private") {
			t.Fatalf("unsafe or vague error: %v", err)
		}
		if !errors.Is(err, tc.cause) {
			t.Fatal("original error identity lost")
		}
	}
	precise := errors.New("The upload window was closed. Select the files again.")
	if Display("Uploading", precise, "") != precise {
		t.Fatal("specific application message was replaced")
	}
	localized := &fs.PathError{Op: "open", Path: "/Users/Пользователь/private-secret", Err: fs.ErrPermission}
	if message := Display("Saving the configuration", localized, "Check the write permissions.").Error(); !strings.Contains(message, "denied access") || strings.Contains(message, "private-secret") {
		t.Fatalf("localized system error bypassed safe explanation: %s", message)
	}
}
