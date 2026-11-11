//go:build darwin && arm64 && cgo && !no_vz

package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"al.essio.dev/pkg/shellescape"
	"github.com/sylvinus/agent-vm/internal/guestos"
	"github.com/sylvinus/agent-vm/internal/hostproxy"
	"github.com/sylvinus/agent-vm/internal/vm"
)

const appleImageURL = "https://updates.cdn-apple.com/2026SpringFCS/fullrestores/140-24263/B95838F0-6815-4F0B-A039-156526C081AD/UniversalMac_26.5.2_25F84_Restore.ipsw"
const appleImageDigest = "065abd295a1a456a46c1155217eab92ee95816520ec9aeed83f249f074f68a04"
const appleImageBytes int64 = 19769902281

func installMacWorkbench(ctx context.Context, profile, state string, l *vm.Lima) error {
	i, err := guestos.LoadInstallation(profile)
	if err != nil || i == nil || i.System != guestos.MacOS {
		return errors.New("The first-install record for this virtual Mac is missing.")
	}
	pw, err := io.ReadAll(io.LimitReader(os.Stdin, 257))
	if err != nil || !guestos.ValidMacOSInstallPassword(string(pw)) {
		return errors.New("The guest initial password must be 8 to 256 letters, digits, spaces or symbols that can be typed on an English keyboard.")
	}
	defer clear(pw)
	ordinaryUser := os.Getenv("CAGE_MACOS_ACCOUNT")
	if !guestos.ValidMacOSAccountName(ordinaryUser) {
		return errors.New("Register the shared credentials from Cage before continuing the macOS guest installation.")
	}
	if !macGuestLoginAvailable() {
		return errors.New("This Cage build is missing the virtual Mac sign-in component.")
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	kit := filepath.Join(filepath.Dir(exe), "guest-os")
	components, err := guestos.RequiredNativeComponents(kit, guestos.MacOS)
	if err != nil {
		return err
	}
	componentStage, err := os.MkdirTemp("", "cage-install-components-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(componentStage)
	if err = guestos.WriteNativeComponentManifest(filepath.Join(componentStage, "native-components.json"), components); err != nil {
		return err
	}
	cache := filepath.Join(state, "guest-media", i.System)
	if err := os.MkdirAll(cache, 0700); err != nil {
		return err
	}
	local := func(name string, args ...string) error {
		cmd := exec.CommandContext(ctx, name, args...)
		cmd.Env = append(append(os.Environ(), hostproxy.DownloadEnvironment()...), "CAGE_HOST_DOWNLOADER="+exe)
		cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
		return cmd.Run()
	}
	media := i.Media
	if media == "" {
		media = filepath.Join(cache, "MacOS.ipsw")
		fmt.Fprintln(os.Stdout, "Downloading and verifying macOS 26.5.2 (19.77 GB) from Apple…")
		err = prepareMacRestoreMedia(ctx, media, appleImageURL, appleImageDigest, appleImageBytes, os.Stdout)
		if err != nil {
			return fmt.Errorf("The Apple recovery image download failed: %w", err)
		}
	}
	fmt.Fprintln(os.Stdout, "Preparing guest apps and developer tools…")
	fmt.Fprintln(os.Stdout, "CAGE_GUEST_STAGE macos media")
	if err := local("/bin/bash", filepath.Join(kit, "prepare-macos-media.sh"), cache); err != nil {
		return fmt.Errorf("Preparing guest apps failed: %w", err)
	}
	fmt.Fprintln(os.Stdout, "Restoring the virtual Mac…")
	fmt.Fprintln(os.Stdout, "CAGE_GUEST_STAGE macos restore")
	if err := runMacGuest(ctx, profile, state, []string{"create", media}); err != nil {
		return err
	}
	if err := l.CheckMacOSGuest(ctx, "mac"); err != nil {
		return err
	}
	if err := guestos.PinMacOSInstallHostKey(profile); err != nil {
		return err
	}
	provision, err := guestos.MacOSProvisionUser(profile)
	if err != nil {
		return err
	}
	if provision != "cageprovision" {
		return errors.New("The provisioning identity of this development guest does not match.")
	}
	adminPassword := " < /Users/" + provision + "/password"
	args, err := guestos.MacOSSSHArgs(profile, provision)
	if err != nil {
		return err
	}
	guestCommand := func(opctx context.Context, script string) *exec.Cmd {
		argv := append(append([]string{}, args...), "-T", "cage-macos", "--", "exec /bin/sh -ec "+shellescape.Quote(script))
		cmd := exec.CommandContext(opctx, "/usr/bin/ssh", argv...)
		cmd.Stderr = os.Stderr
		return cmd
	}
	out, err := guestCommand(ctx, `umask 077; test "$(uname -s)" = Darwin; test "$(id -un)" = `+provision+`; mktemp -d /private/var/tmp/cage-install.XXXXXXXX`).Output()
	remote := strings.TrimSpace(string(out))
	if err != nil || !regexp.MustCompile(`^/private/var/tmp/cage-install\.[A-Za-z0-9]{8}$`).MatchString(remote) {
		return errors.New("Could not prepare the install directory in the verified virtual Mac.")
	}
	defer func() {
		clean, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = guestCommand(clean, `sudo -S -p '' /bin/rm -rf `+remote+adminPassword).Run()
	}()
	fmt.Fprintln(os.Stdout, "Sending developer components into the verified offline virtual Mac…")
	fmt.Fprintln(os.Stdout, "CAGE_GUEST_STAGE macos tools")
	// Only the fixed subset of media is transferred. The IPSW stays on the host.
	tar := exec.CommandContext(ctx, "/usr/bin/tar", "--no-mac-metadata", "-cf", "-", "-C", kit, ".", "-C", cache, "node.tgz", "editor.tgz", "playwright.tgz", "chrome.dmg", "claude.dmg", "cli", "macfuse.pkg", "-C", componentStage, "native-components.json")
	tar.Env = append(os.Environ(), "COPYFILE_DISABLE=1")
	tar.Stderr = os.Stderr
	pipe, err := tar.StdoutPipe()
	if err != nil {
		return err
	}
	receiver := guestCommand(ctx, `umask 077; cd `+remote+`; /usr/bin/tar -xf -; mv macfuse.pkg project/macfuse.pkg`)
	receiver.Stdin = pipe
	if err = tar.Start(); err != nil {
		return err
	}
	recvErr := receiver.Run()
	_ = pipe.Close()
	if err := errors.Join(recvErr, tar.Wait()); err != nil {
		return fmt.Errorf("Guest component transfer failed: %w", err)
	}
	// The staging directory belongs exclusively to the provisioning account.
	// Before invoking the installer, root takes ownership and restricts access.
	auth := guestCommand(ctx, `umask 077; cat > `+remote+`/login-input; sudo -S -p '' /usr/sbin/chown -R root:wheel `+remote+adminPassword)
	auth.Stdin = io.MultiReader(bytes.NewReader(pw), strings.NewReader("\n"))
	if err := auth.Run(); err != nil {
		return errors.New("Could not prepare the virtual Mac account.")
	}
	cmd := guestCommand(ctx, `sudo -S -p '' /bin/sh -ec `+shellescape.Quote(`cd `+remote+`; exec 4<login-input; rm login-input; /usr/bin/perl ./native-component-manifest.pl source ./native-components.json .; /bin/bash ./provision-macos-workbench.sh `+remote+` `+i.ID.String()+` `+provision+` `+ordinaryUser+` <&4; /usr/bin/perl ./native-component-manifest.pl publish ./native-components.json .`)+adminPassword)
	cmd.Stdout = os.Stdout
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("Installing the virtual Mac apps failed. You can continue the installation in the workbench: %w", err)
	}
	ordinary, err := guestos.MacOSSSHArgs(profile, ordinaryUser)
	if err != nil {
		return err
	}
	verify := exec.CommandContext(ctx, "/usr/bin/ssh", append(ordinary, "-T", "cage-macos", "--",
		`test "$(id -un)" = `+ordinaryUser+` && test "$(uname -s)" = Darwin && ! id -Gn | /usr/bin/grep -qw admin`)...)
	if err := verify.Run(); err != nil {
		return errors.New("The standard guest account cannot connect over the verified SSH channel. Installation progress was kept.")
	}
	key, err := guestos.MacOSInstallHostKey(profile)
	if err != nil {
		return err
	}
	// Remove the root-owned media before stopping. No user data is in this dir.
	if err := guestCommand(ctx, `sudo -S -p '' /bin/rm -rf `+remote+adminPassword).Run(); err != nil {
		return err
	}
	fmt.Fprintln(os.Stdout, "CAGE_GUEST_STAGE macos services")
	if err := l.Stop(ctx, "mac"); err != nil {
		return err
	}
	if err := guestos.BindNewMacOSProfile(profile, ordinaryUser, key, i.ID); err != nil {
		return err
	}
	fmt.Fprintln(os.Stdout, "macOS guest apps are installed and automatic sign-in is ready. Cage will continue with the first authorization.")
	return nil
}
