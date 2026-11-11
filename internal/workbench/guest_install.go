package workbench

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/google/uuid"
	"github.com/sylvinus/agent-vm/internal/cage"
	"github.com/sylvinus/agent-vm/internal/guestos"
	"github.com/sylvinus/agent-vm/internal/host"
	"github.com/sylvinus/agent-vm/internal/hostimage"
	"github.com/sylvinus/agent-vm/internal/hostproxy"
)

type guestInstallRequest struct {
	EditorTerms bool   `json:"editor_terms"`
	System      string `json:"guest_system"`
	Media       string `json:"media"`
	SHA256      string `json:"sha256"`
	CloneKey    string `json:"clone_key,omitempty"`
}

type guestInstallView struct {
	LinuxSystems []string              `json:"linux_systems,omitempty"`
	Reselect     bool                  `json:"reselect,omitempty"`
	System       string                `json:"system,omitempty"`
	Available    bool                  `json:"available"`
	Reason       string                `json:"reason,omitempty"`
	Fresh        bool                  `json:"fresh"`
	Pending      *guestos.Installation `json:"pending,omitempty"`
	Activate     bool                  `json:"activate,omitempty"`
}

func (s *Server) guestInstallView() (guestInstallView, error) {
	v := guestInstallView{}
	if !s.localVMStorage() || s.macosGuest != nil || s.windowsGuest != nil {
		return v, nil
	}
	pending, err := guestos.LoadInstallation(s.profile)
	if err != nil {
		return v, err
	}
	loc, err := cage.GetStorageLocation(s.profile)
	if err != nil {
		return v, err
	}
	v.Fresh = !loc.HasEnvironment
	v.Pending = pending
	if !v.Fresh && pending == nil {
		return v, nil
	}
	v.LinuxSystems = linuxGuestSystems(runtime.GOOS, runtime.GOARCH)
	switch {
	case runtime.GOOS == "darwin" && runtime.GOARCH == "arm64":
		v.System = guestos.MacOS
	case runtime.GOOS == "windows" && runtime.GOARCH == "amd64":
		v.System = guestos.Windows11
	case runtime.GOOS == "linux" && runtime.GOARCH == "amd64":
		identity, hostErr := hostimage.Host(context.Background())
		if hostErr != nil {
			v.Reason = hostErr.Error()
		} else {
			v.System = identity.System
		}
	default:
		return v, nil
	}
	if pending != nil {
		v.Reselect, err = guestos.UnstartedInstallation(s.profile, *pending)
		if err != nil {
			return v, err
		}
		catalog := pending.SourceKind == guestos.LinuxImageSource && canInstallCatalogLinux(pending.System) && pending.Source.Host.Arch == runtime.GOARCH
		if !catalog && pending.System != v.System {
			return v, errors.New("The guest installation record does not match this host.")
		}
		if pending.SourceKind == guestos.LinuxImageSource && !catalog {
			return v, errors.New("The guest image architecture does not match this host. Restore the original host environment.")
		}
		mac, err := guestos.LoadMacOSProfile(s.profile)
		if err != nil {
			return v, err
		}
		win, err := guestos.LoadWindowsProfile(s.profile)
		if err != nil {
			return v, err
		}
		v.Activate = (pending.System == guestos.MacOS && mac != nil) || (pending.System == guestos.Windows11 && win != nil)
		if pending.System == guestos.Windows11 && win != nil {
			cleanup, err := guestos.WindowsCloneCleanupPending(s.profile)
			if err != nil {
				return v, err
			}
			v.Activate = !cleanup
		}
	}
	if v.System == "" {
		return v, nil
	}
	if !hostimage.IsLinux(v.System) && !guestos.HasNativeWorkbenchKit(s.exe, v.System) {
		v.Reason = "This build is missing the native guest installation components."
		return v, nil
	}
	v.Available = true
	return v, nil
}

func (s *Server) guestInstallation(w http.ResponseWriter, r *http.Request) {
	if !s.hasTrustedView(r) || !s.localVMStorage() {
		http.Error(w, "Choose the guest system in the Cage window on this computer.", http.StatusForbidden)
		return
	}
	v, err := s.guestInstallView()
	if err != nil {
		requestError(w, err)
		return
	}
	if r.Method == http.MethodGet {
		if v.System == guestos.Windows11 && v.Available && v.Pending == nil {
			check := guestos.Inspect(r.Context())
			if !check.HostCheckPassed {
				v.Available = false
				v.Reason = check.Detail
			}
		}
		jsonReply(w, v)
		return
	}
	if r.Method == http.MethodDelete {
		var body struct {
			ID uuid.UUID `json:"id"`
		}
		if !readJSON(w, r, &body) {
			return
		}
		if !v.Reselect || s.busy() || !s.op.TryLock() {
			http.Error(w, "An installation task or disk already exists. Continue the original installation.", http.StatusConflict)
			return
		}
		defer s.op.Unlock()
		if err := guestos.ClearUnstartedInstallation(s.profile, body.ID); err != nil {
			requestError(w, err)
			return
		}
		jsonReply(w, map[string]bool{"cleared": true})
		return
	}
	if !v.Activate || !s.op.TryLock() {
		http.Error(w, "The guest has not finished installing.", http.StatusConflict)
		return
	}
	if v.Pending != nil && v.Pending.System == guestos.Windows11 {
		owner, err := s.installedWindowsVMOwner(*v.Pending)
		if err != nil {
			s.op.Unlock()
			requestError(w, err)
			return
		}
		s.handoffWithVMOwnerLocked(w, owner)
		return
	}
	s.handoffLocked(w)
}

func (s *Server) installedWindowsVMOwner(install guestos.Installation) (string, error) {
	binding, err := guestos.LoadWindowsProfile(s.profile)
	if err != nil || binding == nil || install.System != guestos.Windows11 || install.ID == uuid.Nil {
		return "", errors.New("The Windows installation binding is not confirmed. Continue the original installation. The original disk and account were kept.")
	}
	state, err := cage.StoragePhysicalPath(filepath.Join(s.profile, "state"))
	if err != nil {
		return "", err
	}
	expected := filepath.Join(state, "windows-"+strings.ReplaceAll(install.ID.String(), "-", ""))
	receipt, err := os.ReadFile(filepath.Join(s.profile, "windows-install-vm.txt"))
	id, parseErr := uuid.Parse(strings.TrimSpace(string(receipt)))
	if err != nil || parseErr != nil || id != binding.VMID || !strings.EqualFold(filepath.Clean(binding.InstanceDirectory), filepath.Clean(expected)) {
		return "", errors.New("The Windows installation record does not match the original guest. Check the original environment. Existing data was kept.")
	}
	return "windows/" + binding.VMID.String() + "/Running", nil
}

func (s *Server) beginGuestInstall(w http.ResponseWriter, r *http.Request, in guestInstallRequest) {
	if in.System == guestos.MacOS && !s.account.view().MacOSCredentialsReady {
		http.Error(w, "Register or confirm the Cage credentials before installing the macOS guest.", http.StatusConflict)
		return
	}
	v, err := s.guestInstallView()
	if err != nil {
		requestError(w, err)
		return
	}
	catalog := canInstallCatalogLinux(in.System) && in.CloneKey == ""
	if v.Pending != nil {
		catalog = v.Pending.SourceKind == guestos.LinuxImageSource
	}
	if (!catalog && (!v.Available || v.System != in.System)) || !s.hasTrustedView(r) || (!v.Fresh && v.Pending == nil) || v.Activate {
		http.Error(w, "The current environment cannot install the selected guest system.", http.StatusConflict)
		return
	}
	install := guestos.Installation{Version: 1, System: in.System, Media: in.Media, SHA256: strings.ToLower(in.SHA256), ID: uuid.New(), EditorTerms: in.EditorTerms}
	if v.Pending != nil {
		if v.Pending.System != in.System || (in.Media != "" && in.Media != v.Pending.Media) || (in.SHA256 != "" && !strings.EqualFold(in.SHA256, v.Pending.SHA256)) {
			http.Error(w, "Continue the installation with the system and installation media chosen originally.", http.StatusConflict)
			return
		}
		install = *v.Pending
	} else if in.CloneKey != "" {
		plan, planErr := s.hostClonePlan(r.Context())
		if planErr != nil {
			requestError(w, planErr)
			return
		}
		if plan.Key() != in.CloneKey || plan.Host.System != in.System {
			requestError(w, errors.New("The version of this computer or the system image information has changed. Check and match again."))
			return
		}
		install.Source = plan
	} else if catalog {
		if in.Media != "" || in.SHA256 != "" || in.EditorTerms {
			requestError(w, errors.New("Ubuntu uses the official image verified by Cage. You do not need to choose installation media."))
			return
		}
		plan, err := linuxGuestImagePlan(r.Context(), s.profile, in.System, runtime.GOARCH)
		if err != nil {
			requestError(w, err)
			return
		}
		install.Source, install.SourceKind = plan, guestos.LinuxImageSource
	}
	if err := install.Validate(); err != nil {
		requestError(w, err)
		return
	}
	s.launch(w, "guest-install", func() error {
		s.jobs.execution().setSetupProgress(&SetupProgress{Phase: "image", System: install.System, Label: "Preparing " + guestProgressName(install.System) + " installation files"})
		if err := requireHostGit(s.operationContext()); err != nil {
			return err
		}
		cfg, err := loadConfig(s.configPath)
		if err != nil {
			return err
		}
		if err := cfg.RequireManagedProxy(s.profile); err != nil {
			return err
		}
		lease, loc, err := cage.AcquireStorageUse(s.profile)
		if err != nil {
			return err
		}
		defer lease.Close()
		current, err := guestos.LoadInstallation(s.profile)
		if err != nil {
			return err
		}
		if current == nil && loc.HasEnvironment || current != nil && *current != install {
			return errors.New("Another environment or installation task already exists. Reopen the installation page.")
		}
		if install.Media != "" {
			f, err := os.Stat(install.Media)
			if err != nil || !f.Mode().IsRegular() {
				return errors.New("The original installation image cannot be read. Restore it to its original path and try again.")
			}
		}
		if install.System == guestos.Windows11 {
			check := guestos.Inspect(s.operationContext())
			if !check.HostCheckPassed {
				return errors.New(check.Detail)
			}
		}
		if err := guestos.SaveInstallation(s.profile, install); err != nil {
			return err
		}
		if install.Source.Host.System != "" {
			cache := filepath.Join(s.profile, "state", "guest-media", install.System)
			unstarted, err := guestos.UnstartedInstallation(s.profile, install)
			if err != nil {
				return err
			}
			minimumGiB := 32
			if hostimage.IsLinux(install.System) {
				minimumGiB = 16
			}
			if !unstarted {
				minimumGiB = 0
			}
			minimumGiB += int((install.Source.RemainingBytes(cache) + (1 << 30) - 1) / (1 << 30))
			if available, ok := host.FreeGiB(cache); ok && available < minimumGiB {
				return fmt.Errorf("Creating the selected system needs at least %d GiB of free space, but only %d GiB is available. Choose a location with enough space in the storage settings.", minimumGiB, available)
			}
			s.setMessage("Preparing the official " + guestProgressName(install.System) + " system image…")
			transport := hostproxy.NewTransport()
			defer transport.CloseIdleConnections()
			prepared, prepareErr := hostimage.Prepare(s.operationContext(), cache, install.Source, s.jobs.execution(), transport)
			if prepareErr != nil {
				return prepareErr
			}
			install.Source, install.Media = prepared, prepared.Path
			install.SHA256 = strings.TrimPrefix(prepared.Digest, "sha256:")
			if err := guestos.RecordPreparedMedia(s.profile, install.ID, prepared); err != nil {
				return err
			}
		}
		var credential macGuestCredential
		if install.System == guestos.MacOS {
			saved, err := s.account.savedMacGuestPassword(s.operationContext(), install.ID)
			if err != nil {
				return err
			}
			unstarted, err := guestos.UnstartedInstallation(s.profile, install)
			if err != nil {
				return err
			}
			if saved == "" && !unstarted {
				return errors.New("The guest installation credentials are missing. Restore the encrypted vault. The existing account and disk were kept.")
			}
			credential, err = s.account.macGuestCredentials(s.operationContext(), install.ID)
			if err != nil {
				return err
			}
		}
		if err := s.prepareEnvironment(); err != nil {
			return err
		}
		if hostimage.IsLinux(install.System) {
			if err := hostimage.WriteLinuxTemplate(filepath.Join(s.profile, "state"), install.Source); err != nil {
				return err
			}
			if err := s.startEnvironment(true); err != nil {
				return err
			}
			return guestos.FinishLinuxInstallation(s.profile, install.ID)
		}
		s.setMessage("Installing the selected guest system…")
		s.jobs.execution().setSetupProgress(&SetupProgress{Phase: "packages", System: install.System, Label: "Installing " + guestProgressName(install.System)})
		var cmd *exec.Cmd
		if install.System == guestos.MacOS {
			cmd = exec.CommandContext(s.operationContext(), s.exe, "guest-os", "macos", "install")
			cmd.Env = append(os.Environ(), cage.ConfigEnv+"="+s.configPath, "CAGE_MACOS_ACCOUNT="+credential.Username)
			cmd.Stdin = strings.NewReader(credential.Password)
		} else {
			cmd, err = guestos.WindowsInstallCommand(s.operationContext(), s.profile, filepath.Join(filepath.Dir(s.exe), "guest-os"), install)
			if err != nil {
				return err
			}
		}
		cmd.Stdout = s.jobs.execution()
		cmd.Stderr = s.jobs.execution()
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("Guest installation was not completed. Installation progress and files were kept. Click \"Continue installation\". If it still fails, export a diagnostics bundle in Settings: %w", err)
		}
		return nil
	})
}
