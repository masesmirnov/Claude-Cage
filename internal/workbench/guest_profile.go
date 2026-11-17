package workbench

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"runtime"
	"strings"

	"github.com/sylvinus/agent-vm/internal/cage"
	"github.com/sylvinus/agent-vm/internal/containerenv"
	"github.com/sylvinus/agent-vm/internal/guestos"
	"github.com/sylvinus/agent-vm/internal/guestprofile"
	"github.com/sylvinus/agent-vm/internal/vm"
)

func (s *Server) linuxTemplate(script string) (string, error) {
	if s.macosGuest != nil || s.windowsGuest != nil {
		return script, nil
	}
	p, err := guestprofile.Load(s.profile)
	if err != nil {
		return "", err
	}
	return p.Linux(script), nil
}

func (s *Server) linuxPathHasPrefix(path, prefix string) bool {
	rendered, err := s.linuxTemplate(prefix)
	return err == nil && strings.HasPrefix(path, rendered)
}

func (s *Server) guestProfileOptions(w http.ResponseWriter, r *http.Request) {
	if !s.hasTrustedView(r) {
		http.Error(w, "Configure the guest in a trusted Cage window", http.StatusForbidden)
		return
	}
	if r.Method == http.MethodPost {
		var options guestprofile.Options
		if !readJSON(w, r, &options) {
			return
		}
		p, err := guestprofile.New(options)
		if err != nil {
			requestError(w, err)
			return
		}
		jsonReply(w, p.Options)
		return
	}
	p, err := guestprofile.Load(s.profile)
	if err != nil {
		requestError(w, err)
		return
	}
	exists, err := s.hasGuestEnvironment(r.Context())
	if err != nil {
		requestError(w, err)
		return
	}
	jsonReply(w, struct {
		Profile     *guestprofile.Profile     `json:"profile"`
		Editable    bool                      `json:"editable"`
		HostOS      string                    `json:"host_os"`
		Container   bool                      `json:"container"`
		AudioModels []guestprofile.AudioModel `json:"audio_models"`
	}{p, p == nil && !exists && !s.busy(), runtime.GOOS, containerenv.Configured(s.profile), guestprofile.AudioModels()})
}

func (s *Server) hasGuestEnvironment(ctx context.Context) (bool, error) {
	if s.macosGuest != nil || s.windowsGuest != nil {
		return true, nil
	}
	if containerenv.Configured(s.profile) {
		environment, err := containerenv.Load(s.profile)
		if err != nil {
			return false, err
		}
		state, err := environment.State(ctx)
		return state.Exists, err
	}
	location, err := cage.GetStorageLocation(s.profile)
	return location.HasEnvironment, err
}

// Called inside the installation operation lock, before any disk is created.
// Legacy environments retain their accounts and settings on ordinary upgrades.
func (s *Server) prepareGuestProfile(options *guestprofile.Options, system string) error {
	platform := "linux"
	switch system {
	case guestos.MacOS:
		platform = "darwin"
	case guestos.Windows11:
		platform = "windows"
	}
	if options != nil {
		if err := options.Validate(); err != nil {
			return err
		}
		if err := options.ValidatePlatform(platform); err != nil {
			return err
		}
		if options.GPUBackend == "virgl" && (runtime.GOOS != "linux" || containerenv.Configured(s.profile)) {
			return errors.New("VirGL currently only supports QEMU guests on Linux hosts")
		}
	}
	p, err := guestprofile.Load(s.profile)
	if err != nil {
		return err
	}
	if p != nil {
		if err := p.Options.ValidatePlatform(platform); err != nil {
			return fmt.Errorf("The saved settings are not compatible with the selected system; continue installing the original system or create a separate environment: %w", err)
		}
		if options != nil && !options.Matches(p.Options) {
			return errors.New("The creation settings were saved; please continue the original installation. Existing accounts and disks will not be renamed")
		}
		return nil
	}
	exists, err := s.hasGuestEnvironment(s.operationContext())
	if err != nil {
		return err
	}
	if exists {
		if options != nil {
			return errors.New("An existing environment cannot change its creation settings directly; create a separate environment")
		}
		return nil
	}
	o := guestprofile.Options{}
	if options != nil {
		o = *options
		if o.GPUBackend == "virgl" {
			if err := vm.CheckVirGLHost(); err != nil {
				return err
			}
		}
	}
	_, err = guestprofile.Create(s.profile, o)
	return err
}
