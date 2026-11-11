# Building and operating the cloud runtime environment

This directory is for maintainers who deploy Cage. The cloud side runs the control service and persistent containers, and the local client uses the workbench over SSH. The container file system, browser data, developer tools and network exit stay on the server. The control port stays bound to loopback. For runtime boundaries, see the [Cloud usage guide](../../docs/guide/cloud.md).

This provides development build materials. No cloud image or installer has been published yet. `Dockerfile.guest` builds the Debian 13 base layer. The full tools and Cage service still use the shared install script in the repository. The base layer alone can't be delivered as a complete working environment. This round of image and hands-on testing used Linux amd64. The terminal, browser, editor, and the Claude Desktop Chat/Code install path can run in a container without KVM. Cowork, which depends on nested VMs, is not covered by the support commitment. Desktop has been verified to install, start and show the welcome page. Chat has not been tested with a real third-party account.

## Deploy from the Cage sidebar

Connect to a Linux amd64 host listed below with a regular SSH user. For the first deployment, use an empty config folder. After you verify the fingerprint and click "Deploy and connect", the desktop app uploads a Linux server build, proxy core and install script that match the client version. The server downloads and verifies the container engine and the Debian base image with its pinned digest, then runs the same tool install script used for the local environment. The server keeps programs and its private engine under `cloud-host/` in the config folder, and registers a service in the systemd user folder, distinguished by config path. Once the workbench is ready, you can create or unlock the Cage account on the server. Connecting again reuses the same instance, and the service starts automatically if it has stopped. If deployment is interrupted, you can retry with the same installer package.

The desktop build generates the materials needed for on-site installation. To make an optional private offline package, first prepare the Linux amd64 Cage backend, the full image folder built below, and two verified Docker archives. Set `CAGE_SERVER_BINARY`, `CAGE_GUEST_BUILD` and `CAGE_DOCKER_DOWNLOADS`, then run `bash deploy/cloud/pack-kit.sh`. Use `CAGE_CLOUD_KIT` to set the absolute path of the archive. The desktop app streams it from disk when needed.

## Server requirements

The current build baseline is Linux x86_64, cgroup v2, systemd user services and rootless Docker 29.9.1. The server does not need KVM. The runtime user needs working multi-UID/GID user namespaces, at least 65,536 subordinate UIDs/GIDs, and accessible `/dev/fuse` and `/dev/net/tun`. `newuidmap` and `newgidmap` can provide the mapping through setuid or file capabilities from the distribution.

The host needs OpenSSH, curl, tar, sha256sum, iproute2 and iptables. The Cage server does not depend on GTK or WebKit. At runtime, it also checks user cgroup delegation and parent resource limits. If a requirement is missing, fix the server configuration. Don't start the working environment with `--privileged`, host networking, host PID, a Docker socket mount, or a writable bind of the whole host cgroup.

Each user's data root is `~/.claude-cage` by default. The container engine data is fixed at `~/.claude-cage/container-engine/data`, separate from the version number and executable folder. If you explicitly use a different `CLAUDE_CAGE_CONFIG`, you must also change the absolute config paths and engine data root in both user services. Later upgrades keep using the same set of paths.

## Prepare a separate rootless engine

[runtime-artifacts.json](runtime-artifacts.json) pins the official static release artifacts and their SHA-256 values. The Docker main program and rootless extras must use the same version. The steps below are the first install. Run them as a regular user, install into your own config folder, and don't change the system Docker that is already running. For an existing Cage engine, first follow the stop and update steps at the end. Don't unpack and overwrite the program while it is running.

```sh
cage_engine_root="$HOME/.claude-cage/container-engine"
install -d -m 700 "$cage_engine_root/tools" "$cage_engine_root/downloads" \
  "$cage_engine_root/data" "$cage_engine_root/client"
curl --fail --location --proto '=https' --tlsv1.2 \
  https://download.docker.com/linux/static/stable/x86_64/docker-29.9.1.tgz \
  -o "$cage_engine_root/downloads/docker-29.9.1.tgz"
curl --fail --location --proto '=https' --tlsv1.2 \
  https://download.docker.com/linux/static/stable/x86_64/docker-rootless-extras-29.9.1.tgz \
  -o "$cage_engine_root/downloads/docker-rootless-extras-29.9.1.tgz"
printf '%s  %s\n' \
  c158ecc55adb3afb01bbd3539ed3b997d20c26dbdc418080506cc1bf5243ff57 \
  "$cage_engine_root/downloads/docker-29.9.1.tgz" \
  c87668896a3fced2e715324e9fb6a0634aba3e5d8408a471f6bc23dc476662af \
  "$cage_engine_root/downloads/docker-rootless-extras-29.9.1.tgz" | sha256sum -c -
tar -xzf "$cage_engine_root/downloads/docker-29.9.1.tgz" --strip-components=1 -C "$cage_engine_root/tools"
tar -xzf "$cage_engine_root/downloads/docker-rootless-extras-29.9.1.tgz" --strip-components=1 -C "$cage_engine_root/tools"
if [ ! -e "$cage_engine_root/daemon.json" ]; then
  (umask 077; printf '{}\n' > "$cage_engine_root/daemon.json")
fi
install -d -m 700 "$HOME/.config/systemd/user"
if [ ! -e "$HOME/.config/systemd/user/cage-container-engine.service" ]; then
  install -m 644 deploy/cloud/cage-container-engine.service "$HOME/.config/systemd/user/"
else
  printf 'Keeping the existing cage-container-engine.service. Check the paths in it.\n'
fi
systemctl --user daemon-reload
systemctl --user enable --now cage-container-engine.service
```

When connecting to this engine, explicitly specify the private socket and a separate client config, so you don't touch the operating system's Docker:

```sh
export DOCKER_HOST="unix:///run/user/$(id -u)/cage-container-engine/docker.sock"
export DOCKER_CONFIG="$HOME/.claude-cage/container-engine/client"
cage_engine="$HOME/.claude-cage/container-engine/tools/docker"
"$cage_engine" info --format '{{json .SecurityOptions}} {{.CgroupDriver}} {{.CgroupVersion}}'
```

The output must include `name=rootless`, with the cgroup driver `systemd` and version `2`. If linger isn't enabled for the user, the user service may stop after the last login session ends. To keep it running with nobody logged in, the server administrator must enable linger for that user. The test environment doesn't change this setting automatically. [Docker rootless prerequisites and user service notes](https://docs.docker.com/engine/security/rootless/)

## Build the full guest image

First build the Linux Cage backend from the same source: `make cage GOOS=linux GOARCH=amd64 CGO_ENABLED=0`. The build generates the workbench assets and `_output/bin/cage`. It does not run the release or version-change process.

Build the base layer with `Dockerfile.guest`, then create a separate image build container. The build container doesn't mount projects, your home folder, proxy config or accounts. Installation downloads use a separate build network. The default Debian image already has a pinned digest, and APT still verifies the distribution signatures. If your deployment network needs a mirror, change only the Debian software sources in the build stage and keep signature verification. Before committing the base layer and the full image, restore the official `deb.debian.org` sources, to match the runtime environment's maintenance download source limits.

Before the bulk install, the base layer checks APT with the shared `internal/cage/apt-bootstrap.sh`. If Debian 13 is older than 3.0.4, it first upgrades from the official security source, with retries disabled for the upgrade download. `build-guest.sh` copies this script and the Dockerfile into the temporary context of this build, and the deployment kit includes the same script. If the upgrade fails, the build keeps its evidence and stops later installs.

Use the [full image build script](build-guest.sh) to create a parent slice, network and container that this build owns. The script checks the actual rootless engine and the parent slice limits, then runs the shared install script. Names carry a unique suffix, so existing environments aren't overwritten.

```sh
CAGE_SERVER_BINARY="$PWD/_output/bin/cage" \
CAGE_CONTAINER_ENGINE="$cage_engine" \
  bash deploy/cloud/build-guest.sh
```

The full image installs in the same order as the local Cage:

```sh
# CAGE_BUILD_CONTAINER is the image build container created for this build. The operator must specify it explicitly.
_output/bin/cage container-install-script tools |
  "$cage_engine" exec --interactive --user cage --workdir /home/cage "$CAGE_BUILD_CONTAINER" bash -l
_output/bin/cage container-install-script services |
  "$cage_engine" exec --interactive --user cage --workdir /home/cage "$CAGE_BUILD_CONTAINER" zsh -l
```

Step 1 selects only Python, Node, Chromium, Claude Code and code-server, reusing `ToolInstallPrelude` and `agent-vm.setup.sh`. Step 2 reuses `GuestSetup`. Installing the services needs systemd running inside the container, so you can't put step 2 directly into a plain `Dockerfile RUN`. Container mode skips zram. The Chromium sandbox stays on. The base layer sets `DefaultTasksMax` for the in-container systemd to `infinity`, so a single service is no longer limited by a small percentage-based default. The host's parent slice enforces a hard limit of 1024 processes and threads on the running working environment. The standalone image build still uses a budget of 2 CPUs, 4 GiB of memory and 512 processes and threads. `StartScript`, which initializes browser data, runs on the first start of the working environment. Browser passwords or control credentials can't be pre-built into the base image.

In rootless Docker, the systemd start entry is:

```sh
umount /sys/fs/cgroup
mount -t cgroup2 none /sys/fs/cgroup
exec /sbin/init
```

These commands can only run in a container already configured with private user, PID, IPC, network and cgroup namespaces. The container uses `/run` and `/tmp` as temporary file systems, and additionally provides only `/dev/fuse` and `/dev/net/tun`, plus `SYS_ADMIN` and `NET_ADMIN` inside the user namespace. Cage creates the working environment with `network=none` and limits from a dedicated host parent slice. The networking and lifecycle of the image build container are managed separately by the build steps. The engine fixes the container hostname to `cage` and adds a `cage:127.0.1.1` alias, so the hostname resolves even without a default network. The container can manage its own cgroup sublevels, but hard CPU, memory and PID limits must sit in the host parent layer, which the container can't see.

Before you commit the full image, clean up only the build container created in this build. Stop the SSH and Cage services, remove the generated SSH host keys, `cage_authorized_keys`, the journal, the APT cache and temporary downloads, and empty `/etc/machine-id`. Confirm there are no account files, browser control credentials, browser passwords, Claude sign-in state, proxy credentials or user projects in it. Then stop and commit the image, and record the SHA-256 image ID. Never run this cleanup on an existing working environment. In an existing container, the whole writable file system is persistent data.

By default, the script builds a local `cage-guest:development` image, and saves the image ID, the exported `cage-guest.tar`, `SHA256SUMS`, the install scripts and logs under `_output/cloud-images/build.*`. On success, it removes only the build container and network created in this run. On failure, it keeps them for inspection. There is no step that pushes the image, creates a Git tag or publishes a release.

If you prepared the same Debian base offline, you can use `CAGE_GUEST_BASE_IMAGE` to set a verified local image ID. It must be pinned to a SHA-256. For another Debian mirror, `CAGE_DEBIAN_MIRROR` accepts an HTTP(S) source address, such as `http://mirrors.aliyun.com`. APT signature verification stays on. [Source restore script](restore-apt-sources.sh) verifies and restores the official URIs of the Debian main and security repositories before the image is committed. It keeps the distribution, components and signing key settings, and doesn't change other sources such as NodeSource.

## Install and connect the control service

Put the Cage backend from the same build and the verified Linux Mihomo into `~/.local/lib/cage/`, named `cage` and `mihomo`. Mihomo uses the pinned download source and verification from `scripts/fetch-linux-proxy-core.sh`.

The example below reads `image-id` from the `Artifacts` folder printed by `build-guest.sh`. If you build on another machine, first copy `image-id`, `cage-guest.tar` and `SHA256SUMS` from that folder to the server. The example verifies the archive and loads it into the private engine.

It uses `~/.claude-cage/config.json` by default. A `CLAUDE_CAGE_CONFIG` you have already set explicitly is kept. `init` runs only when the config doesn't exist, and it creates the file in exclusive mode. Existing configs are not overwritten. `container-configure` receives JSON on standard input. An existing container config accepts only identical parameters. Changing the image or resource config requires the migration steps. A config folder that already has VM data is rejected, so this process can't overwrite the local environment.

```sh
(
  set -eu
  printf 'Paste the absolute Artifacts folder printed by build-guest.sh: '
  IFS= read -r cage_build_output
  case "$cage_build_output" in /*) ;; *) echo 'An absolute folder is required.' >&2; exit 1 ;; esac

  cage_binary="$HOME/.local/lib/cage/cage"
  cage_engine="$HOME/.claude-cage/container-engine/tools/docker"
  cage_socket="unix:///run/user/$(id -u)/cage-container-engine/docker.sock"
  export DOCKER_HOST="$cage_socket"
  export DOCKER_CONFIG="$HOME/.claude-cage/container-engine/client"
  unset DOCKER_CONTEXT
  export CLAUDE_CAGE_CONFIG="${CLAUDE_CAGE_CONFIG:-$HOME/.claude-cage/config.json}"
  case "$CLAUDE_CAGE_CONFIG" in /*) ;; *) echo 'The config path must be an absolute path.' >&2; exit 1 ;; esac

  (cd "$cage_build_output" && sha256sum -c SHA256SUMS)
  cage_image_id=$(cat "$cage_build_output/image-id")
  printf '%s\n' "$cage_image_id" | grep -Eq '^sha256:[a-f0-9]{64}$'
  "$cage_engine" load --input "$cage_build_output/cage-guest.tar"
  "$cage_engine" image inspect "$cage_image_id" >/dev/null
  if [ ! -e "$CLAUDE_CAGE_CONFIG" ]; then
    "$cage_binary" init
  else
    printf 'Keeping the existing config: %s\n' "$CLAUDE_CAGE_CONFIG"
  fi

  "$cage_binary" container-configure --json <<JSON
{
  "engine": "docker",
  "executable": "$cage_engine",
  "socket": "$cage_socket",
  "image": "$cage_image_id",
  "cpus": 2,
  "memory_bytes": 4294967296
}
JSON
  "$cage_binary" setup
)
```

The last step prepares the offline persistent container without allowing business internet access. If you used a custom config or engine folder, first update the paths in the user services below so they match the same set of absolute paths, then start the control service.

```sh
if [ ! -e "$HOME/.config/systemd/user/cage-server.service" ]; then
  install -m 644 deploy/cloud/cage-server.service "$HOME/.config/systemd/user/"
else
  printf 'Keeping the existing cage-server.service. Check the config paths in it.\n'
fi
systemctl --user daemon-reload
systemctl --user enable --now cage-server.service
```

Open the same Cage app, click the plus button in the "SSH" sidebar, and save the server address, SSH user and authentication method. Select the host, connect, and verify the server host key. If the local environment is still running, the confirmation card shows options to stop it or keep it running. The workbench keeps using the server's own accounts, and a remote project selects a folder on the server. You don't need to publish the control service, VNC, editor or container ports to the public internet.

## Stop, update and recover

Closing the local window or disconnecting SSH keeps the remote environment. To stop tasks, first stop the environment in Cage, then stop `cage-server.service`. Stop `cage-container-engine.service` only after you confirm the containers are no longer needed.

Before an update, save your tasks and stop the environment. Keep the config folder, the engine `data` folder and the server projects. After replacing the app files, restore the service using the same config paths. An image upgrade needs an explicit migration of the existing full file system. You can't finish the upgrade by deleting containers, replacing the data root or recreating the account. Never run `docker system prune` or bulk `docker rm` on the engine that holds the saved working environment.

For diagnosis, check the user service status, the container network logs under the current config, and the actual rootless and cgroup state first. Running with no one logged in, recovery after a host restart, and each client's native interaction must be tested separately. A single container start result can't replace them.

## Hands-on testing scope

Rootless Docker on an ordinary VPS without KVM has been verified for systemd, FUSE/SSHFS, controlled networking, parent slice resources, persistence and real workbench operation. Podman has not been tested. Other distributions and ARM64 are outside this round's conclusions.

The build script's shell syntax has been checked, and it has actually run through the separate parent slice, network, pinned Debian base build, and the systemd and shared tool install entry point. Full tool installation, identity cleanup, image checks and export were each verified for real. The whole automatic script has not been run end to end again. The test user did not have linger enabled, and the server was not restarted, so running with no one logged in and recovery after restart still need separate testing.
