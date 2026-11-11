// Package usererror describes known system failures without exposing raw
// command arguments, network responses or credentials in the user interface.
package usererror

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"syscall"
	"unicode"
)

type failure struct {
	message string
	cause   error
}

func (e *failure) Error() string { return e.message }
func (e *failure) Unwrap() error { return e.cause }

func New(action, reason, next string, cause error) error {
	return &failure{message: action + " failed: " + strings.TrimRight(reason, ".;") + ". " + next, cause: cause}
}

func Wrap(action string, cause error, next string) error {
	if cause == nil {
		return nil
	}
	reason := Reason(cause)
	if reason == "" {
		reason = "no recognizable error cause was obtained"
	}
	return New(action, reason, next, cause)
}

// Existing validation messages that start with an uppercase letter describe product rules and must survive
// unchanged. Unknown system exceptions receive an operation and a next step.
func Display(action string, cause error, next string) error {
	if cause == nil {
		return nil
	}
	switch cause.(type) {
	case *fs.PathError, *os.SyscallError, syscall.Errno, *exec.ExitError, net.Error:
		return Wrap(action, cause, next)
	}
	for _, r := range cause.Error() {
		if unicode.IsUpper(r) {
			return cause
		}
		break
	}
	return Wrap(action, cause, next)
}

func Reason(err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, context.Canceled) {
		return "the operation was canceled"
	}
	var timeout net.Error
	if errors.Is(err, context.DeadlineExceeded) || errors.As(err, &timeout) && timeout.Timeout() {
		return "timed out waiting for a response"
	}
	var dns *net.DNSError
	if errors.As(err, &dns) {
		return "could not resolve the server domain name"
	}
	var authority x509.UnknownAuthorityError
	var hostname x509.HostnameError
	var certificate x509.CertificateInvalidError
	var record tls.RecordHeaderError
	if errors.As(err, &authority) || errors.As(err, &hostname) || errors.As(err, &certificate) {
		return "server certificate verification failed"
	}
	if errors.As(err, &record) {
		return "the server did not return a valid encrypted connection response"
	}
	switch {
	case errors.Is(err, fs.ErrPermission):
		return "the system denied access to a required file or directory"
	case errors.Is(err, fs.ErrNotExist), errors.Is(err, exec.ErrNotFound):
		return "a required file or program does not exist"
	case errors.Is(err, syscall.ENOSPC) || runtime.GOOS == "windows" && (errors.Is(err, syscall.Errno(112)) || errors.Is(err, syscall.Errno(39))):
		return "the disk is out of free space"
	case errors.Is(err, syscall.EROFS):
		return "the target disk is read-only and cannot be written"
	case errors.Is(err, syscall.ECONNREFUSED):
		return "the target service refused the connection"
	case errors.Is(err, syscall.ECONNRESET), errors.Is(err, syscall.EPIPE), errors.Is(err, io.EOF), errors.Is(err, io.ErrUnexpectedEOF):
		return "the connection was interrupted before a complete result was returned"
	case errors.Is(err, syscall.ENETUNREACH), errors.Is(err, syscall.EHOSTUNREACH):
		return "the current network cannot reach the target service"
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return fmt.Sprintf("the program exited early (exit code %d) without a recognizable reason", exit.ExitCode())
	}
	return ""
}
