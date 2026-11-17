package guestos

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/google/uuid"
	"go.yaml.in/yaml/v3"
)

const MacOSQEMU = "qemu-hvf"
const IntelMacOSIdentityFile = "cage-macos-identity.json"

// IntelMacOSIdentity is generated for one installation, independently of the
// ordinary guest user. OpenCore and QEMU receive the same fresh hardware UUID.
type IntelMacOSIdentity struct {
	Version      int       `json:"version"`
	Backend      string    `json:"backend"`
	UUID         string    `json:"uuid"`
	Installation uuid.UUID `json:"installation"`
	BootSHA256   string    `json:"boot_sha256"`
}

func (i IntelMacOSIdentity) Validate() error {
	id, err := uuid.Parse(i.UUID)
	digest, hashErr := hex.DecodeString(i.BootSHA256)
	if i.Version != 1 || i.Backend != MacOSQEMU || err != nil || id == uuid.Nil || id.String() != i.UUID ||
		i.Installation == uuid.Nil || hashErr != nil || len(digest) != 32 {
		return errors.New("The Intel macOS guest identity record is invalid")
	}
	return nil
}

func ReadIntelMacOSIdentity(dir string) (*IntelMacOSIdentity, error) {
	path := filepath.Join(dir, IntelMacOSIdentityFile)
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > 4096 || info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("The Intel macOS guest identity record has invalid permissions")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var identity IntelMacOSIdentity
	if json.Unmarshal(data, &identity) != nil {
		return nil, errors.New("The Intel macOS guest identity record cannot be parsed")
	}
	if err := identity.Validate(); err != nil {
		return nil, err
	}
	return &identity, nil
}

func WriteIntelMacOSIdentity(dir string, identity IntelMacOSIdentity) error {
	if err := identity.Validate(); err != nil {
		return err
	}
	data, err := json.Marshal(identity)
	if err != nil {
		return err
	}
	return publishBinding(dir, IntelMacOSIdentityFile, append(data, '\n'))
}

func intelMacMachineID(profile string, identity IntelMacOSIdentity) (string, error) {
	dir := filepath.Join(profile, "state", "lima", "mac")
	if _, err := os.Lstat(filepath.Join(dir, "vz-identifier")); !errors.Is(err, os.ErrNotExist) {
		return "", errors.New("The macOS guest has conflicting backend identities")
	}
	var config struct {
		OS     string `yaml:"os"`
		Arch   string `yaml:"arch"`
		VMType string `yaml:"vmType"`
		VMOpts struct {
			QEMU struct {
				MacOS struct {
					UUID string `yaml:"uuid"`
				} `yaml:"macOS"`
			} `yaml:"qemu"`
		} `yaml:"vmOpts"`
	}
	data, err := os.ReadFile(filepath.Join(dir, "lima.yaml"))
	if err != nil {
		return "", err
	}
	if yaml.Unmarshal(data, &config) != nil || config.OS != "Darwin" || config.Arch != "x86_64" || config.VMType != "qemu" || config.VMOpts.QEMU.MacOS.UUID != identity.UUID {
		return "", errors.New("The Intel macOS configuration does not match the bound hardware identity")
	}
	data, _ = json.Marshal(identity)
	hash := sha256.Sum256(append([]byte("cage-intel-macos-1\x00"), data...))
	return hex.EncodeToString(hash[:]), nil
}
