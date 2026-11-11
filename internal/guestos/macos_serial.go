package guestos

import (
	"bufio"
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/crypto/ssh"
)

// MacOSInstallHostKey reads the key written by the fresh guest's root-owned
// first-boot script to its VZ serial attachment, independent of loopback SSH.
func MacOSInstallHostKey(profile string) ([]byte, error) {
	path := filepath.Join(profile, "state", "lima", "mac", "serialv.log")
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > 8<<20 {
		return nil, errors.New("Invalid macOS guest first-boot serial record.")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return parseInstallHostKey(io.LimitReader(file, info.Size()))
}

func parseInstallHostKey(input io.Reader) ([]byte, error) {
	const prefix = "CAGE-GUEST-HOST-KEY "
	scanner := bufio.NewScanner(input)
	var found []byte
	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		keyLine, ok := strings.CutPrefix(line, prefix)
		if !ok {
			continue
		}
		key, _, opts, rest, err := ssh.ParseAuthorizedKey([]byte(keyLine))
		if err != nil || key.Type() != ssh.KeyAlgoED25519 || len(opts) != 0 || len(rest) != 0 {
			return nil, errors.New("The first boot of the virtual Mac returned an invalid host public key.")
		}
		candidate := ssh.MarshalAuthorizedKey(key)
		if found != nil && !bytes.Equal(found, candidate) {
			return nil, errors.New("The first boot of the virtual Mac returned a different host public key.")
		}
		found = candidate
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if found == nil {
		return nil, errors.New("The host public key has not been obtained from the serial port of this virtual Mac yet.")
	}
	return found, nil
}
