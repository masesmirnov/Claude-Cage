# Linux installation, use and testing

Cage's Linux desktop version targets x86_64 computers running Debian 12 or Ubuntu 22.04/24.04. It uses GTK 3 and WebKitGTK to show the workbench. Projects, terminals, the browser, the editor and the built-in proxy work the same way as on other platforms. For a local environment, it creates a persistent Debian 13 VM by default. You can also download official images through "Match this computer's system version automatically" to create a Linux guest with the same distribution as your host, including Ubuntu 22.04. All local projects share the chosen persistent environment and Linux toolchain. When you first create the environment, you can select Ubuntu 22.04 directly, without running that version on the host. The host and guest can be different Linux distributions. For combinations of macOS, Windows, Debian and Ubuntu, see [Choose a guest system](guide/guest-systems.md).

The same desktop app can also connect over SSH from the sidebar to a server where Cage is deployed. The remote workbench only needs local graphics dependencies. Local mode also needs KVM and VM tools. For container deployment without KVM on a cloud server, see the [Cloud guide](guide/cloud.md) and the [deployment notes](../deploy/cloud/README.md).

The Ubuntu 22.04 desktop package uses a build baseline compatible with that system. In an isolated container, we verified the real window, browser startup, reinstall and uninstall data retention. A full KVM guest install, physical desktop input methods and Claude sign-in have not been tested yet, so the container results should not be taken as passing those steps. For system matching, resume behavior and the scope of each route, see the [Guest system guide](guide/guest-systems.md).

## Before you install

Ubuntu 22.04 needs `universe`, `jammy-updates` and `jammy-security` enabled, and an updated WebKitGTK 4.1 (at least 2.40). The old WebKit in the initial system image can't run the current workbench.

Your computer needs a graphical desktop, working KVM hardware virtualization, enough disk space and your own proxy node. The default virtual disk limit is 24 GiB. A cloud host must have nested virtualization enabled by the provider. A server without `/dev/kvm` can't start the Cage environment with the normal desktop flow.

Check that the current user can read and write `/dev/kvm`:

```sh
test -r /dev/kvm && test -w /dev/kvm
```

If the device doesn't exist, check virtualization in BIOS/UEFI and the kernel KVM module. If the device exists but permissions are insufficient, an administrator can add the user to the `kvm` group, then sign out of the desktop and sign back in:

```sh
sudo usermod -aG kvm "$USER"
```

Cage normally runs as a regular user. Don't start the workbench with `sudo cage-desktop`.

## Install and get started

On the [project homepage](https://lee-xeo.github.io/Claude-Cage/#download), click "Download the app" and choose Linux. Download `Cage-<version>-linux-amd64.deb` and `SHA256SUMS` from the matching Release, and check the file's SHA-256 before you install it. Run the install command below only if the matching Release provides the installer:

```sh
sudo apt install ./Cage-<version>-linux-amd64.deb
```

The installer includes the Cage background service, the workbench and the Mihomo proxy core. APT installs graphics dependencies such as WebKitGTK. If you only connect to SSH hosts, you can open the app directly. To use a local environment, also run `sudo apt install qemu-system-x86 qemu-utils ovmf openssh-client iproute2 git` and confirm KVM is available. The first local environment start downloads the Linux image and guest tools.

Local Git must be **version 2.38 or later**. When Cage first starts a local environment or you authorize a shared project, it asks you to explicitly turn on Git safety protection. If your Git version is too old, Cage blocks this step and asks you to upgrade, so the host doesn't accidentally run bare repository config from a project. You can check with `git --version`. Git in the default Ubuntu 22.04 repositories is too old. You can use the Ubuntu PPA provided by the maintainers, as described in the [official Git Linux install guide](https://git-scm.com/install/linux):

```sh
sudo apt install software-properties-common
sudo add-apt-repository -y ppa:git-core/ppa
sudo apt update
sudo apt install git
git --version
```

After upgrading, return to the workbench, run the check again, and explicitly authorize Git safety protection as prompted. This requirement doesn't block installing the app or opening the workbench. Just opening the window doesn't prove that the local environment meets the startup requirements.

When used as a remote host for the phone, Cage asks the system to keep running through `systemd-inhibit` and logind. The screen can still turn off. The full installer depends on systemd. If the service or user permissions aren't enough, "Settings → Remote connection" shows why sleep prevention failed. It does not change the system power policy automatically.

Open **Cage** from the application menu, or run `cage-desktop`. The system package name and background command are `claude-cage`, which avoids a conflict with a same-named Wayland program that ships with the distribution. Import your proxy, choose a node, then open a project as described in [Getting started](getting-started.md#2-import-and-choose-a-proxy). For example, a project path might be `/home/alice/Projects/demo`. Only the default workspace and folders you explicitly choose are shared. Changes and deletions in a project sync to the host. Git metadata in an authorized project is readable and writable, and commits made in the guest update the host repository directly. Sharing is still limited to authorized folders.

Linux uses Ctrl shortcuts: `Ctrl+O` opens a project, `Ctrl+T` opens a new web page, `Ctrl+L` focuses the address bar, `Ctrl+W` closes a tab, and `Ctrl+Shift+Enter` opens a new terminal. Terminals use `Ctrl+Shift+C/V` to copy and paste, and `Ctrl+C` interrupts commands.

Closing the window keeps the background environment and tasks running, and reopening Cage reconnects them. To end background tasks, stop the environment in the app and then quit. Local Linux accounts unlock with a password. Quick unlock with a device is not available yet.

Browser uploads use the local file picker. Downloads can use the GTK "Save as" window to choose a save location. The "Downloads" entry in the sidebar offers opening files, opening the containing folder and saving again as. Files open in the app associated with the current desktop. For actions and limits, see [Browser uploads and downloads](getting-started.md#browser-uploads-and-downloads).

## Updates and uninstalling

The Linux version is updated manually with the system installer package. The in-app update entry shows the update method and does not replace system files automatically. Save your files, stop the environment and quit Cage first, then install the new `.deb`. If the installer finds that Cage, the control service or a proxy process is still running, it refuses to overwrite and asks you to quit.

Updating and uninstalling keep the config, proxy and virtual disk in `~/.claude-cage`. The default workspace `~/.claude-cage-workspace` and project folders you opened yourself are also kept. The uninstall command is:

```sh
sudo apt remove claude-cage
```

Back up user data yourself before you delete it. Files and sign-in state that exist only in the virtual disk are lost when the virtual disk is deleted.

## Common problems

- The workbench doesn't show: make sure you start it in a regular user's graphical desktop session, and that the system WebKitGTK is fully installed. Don't turn off the WebKit sandbox to work around desktop configuration issues.
- KVM is unavailable: check the device and permissions as described under "Before you install". A regular Alibaba Cloud instance may not provide nested virtualization.
- No physical network interface found: the built-in proxy needs a recognizable host network interface. Docker container veth interfaces, VPN tunnels and bridge interfaces are not used as physical exits. Desktop hosts and container tests have different network conditions.
- The workbench opens but there's no internet access: in Cage, make sure a proxy node is selected and check the network results. A browser on the host being online doesn't prove that the Cage proxy works.

When you report a problem, include the distribution, CPU architecture, Cage version, desktop environment, the steps that failed, and the exact error text. Avoid attaching proxy passwords, subscription links, account files, and addresses that contain session information.
