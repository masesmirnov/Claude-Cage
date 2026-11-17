# Development build of a native macOS guest on Intel Macs

This is an experimental native Intel route; the support scope of public releases is still defined by the release notes. For the macOS guest route, both host and guest need macOS 15.4 or newer; upgrading to 26.4 is not required. The separate package also offers Debian 13 and Ubuntu 22.04 x86_64 guests, which keep the existing Linux workbench; the minimum host version for the Linux route is macOS 14.

## How it runs

Intel uses QEMU's Hypervisor.framework hardware virtualization and Apple Paravirtualized Graphics. Apple Silicon keeps using Virtualization.framework. Both share Cage's account, first authorization, workbench, project sharing and network check flows.

The installer downloads the full Intel InstallAssistant and the signed recovery environment from Apple, verifies the package signature and per-chunk digests, and installs onto a new virtual disk. It matches the host version first; when Apple no longer offers that patch version, it shows and picks a compatible update of the same major version. Host accounts, app data and sign-in state are not copied.

The initial system disk capacity is capped at 64 GiB, and actual usage grows with installation and use. The first installation also needs to store install materials and app caches: reserve at least 64 GiB when the system materials are already cached, and add the download size shown in the interface when they are not downloaded yet. Installation restarts several times, and after an interruption the original disk and install identity are kept.

The system disk and installer disk use virtio-blk (the macOS 15 boot kernel collection already includes the AppleVirtIO block device driver), while OpenCore, the recovery environment and the configuration disk still use AHCI. To reduce host memory pressure during installation, the guest gets at most 8 GiB of memory and the system disk does not forward the guest's flush requests; after installation it starts normally with the user's resource settings and the flush policy returns to the default. The install image is read once inside the guest for both copying and digest verification.

Installation has no fixed total time: it is considered stalled only after 25 minutes without activity on the system disk or serial port, with a separate 3-hour limit. During installation it shows write progress, Apple installer preparation progress, the number of restarts and the elapsed time; port forwarding refusals before SSH is ready are only kept in `ha.stderr.log`.

The whole installation and runtime keep the instance's own controlled network, with no temporary NAT, host folder disk or other network adapters added. The first host public key is obtained separately over the virtual serial port and then used for SSH verification. The regular guest account is used for everyday work.

Project sharing uses Cage's restricted SFTP service and the macFUSE FSKit backend. FSKit on macOS 15.4 to 26.3 does not support volume-level read-only mounts, so the first check relies on the read-only SFTP service rejecting writes instead. File system extensions, screen recording and accessibility still need confirmation inside the guest as Cage guides you.

The file system step of the Intel first setup first opens the verified official macFUSE installer. After installing it, keep following Cage's prompts to open file system extensions and authorize. macFUSE is not installed in the background with the system add-ons, so the Apple install transaction does not fail on file system permission checks.

## Build a separate test package

You need Xcode, Go (the root module requires 1.26.10 and `tools/tailnet` requires 1.27.3, both as minimum versions), Node.js, Python 3.11+, Meson, Ninja, pkg-config, and gettext, pixman and libffi for source builds. GLib and PCRE2 are built by the build script from pinned source versions. The dependency tools must be in `PATH`; for downloading the Go toolchain online, offline preparation and pre-build checks, see the [macOS source build notes](../.github/CONTRIBUTING.md#building-macos-from-source).

```sh
bash scripts/build-app.sh --intel-macos-test
```

The output is `_output/Cage Intel.app`; you can set another absolute `.app` path with `CAGE_BUILD_OUTPUT`. The package contains a separate runtime, guest install tools, licenses and the required source materials, but no system disk, account or proxy configuration. The test package uses its own app identifier and the default configuration folder `~/.claude-cage-intel-test`; to update, use a new test package.

## GitHub Actions artifacts

The three-platform checks run the Intel build separately on `macos-15-intel`, with the artifact named `cage-macos-amd64-test` next to `cage-macos-arm64-test`. The Intel job builds a complete `Cage.app` with the standard `scripts/build-app.sh`, including QEMU/HVF, macOS install tools, Linux boot firmware and the matching source materials; the local separate test package is only an extra option for isolating the app identifier and configuration.

Before upload it runs the Go, workbench, native maintenance, update and account checks, checks the x86_64 architecture of the main program and runtime, and unpacks the result to verify signatures and executable permissions again. GitHub-hosted runners do not start nested guests; blank-disk system installation and guest desktop acceptance still need records from a real Intel Mac.

## Verification scope

A successful build and system startup do not mean the workbench acceptance is done. When contributing, record the following evidence and the platforms not verified separately:

- First installation on a blank disk, resuming after interruption, obtaining the trusted public key and switching to accelerated display.
- The regular account, first system authorization and wrapping up the temporary administrator.
- Workbench terminal, browser, editor, saving projects in both directions, running, Git writes and stopping sharing.
- Internet turned off, proxy failures, network checks and the authorization gate.
- Stopping, cold start, disk and permission persistence, and running the installer outside the source folder.
- Apple Silicon build regressions, and Linux and Windows checks of shared code.

This route has not yet passed hardware acceptance on all supported Intel Macs and macOS versions, so do not conclude from it that official Claude sign-in, work sessions or nested virtualization have been tested.
