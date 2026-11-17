---
title: Choose a guest system
description: Use macOS on a Mac, Windows on Windows, or choose Debian or Ubuntu 22.04, all in the same Cage workbench.
group: Getting started
order: 1.5
keywords: guest client clone host system choice macOS Windows Debian Ubuntu Linux Hyper-V Apple Silicon IPSW ISO ESD native development PowerShell
---
## Develop in a system you know

Developing a Mac app requires the macOS toolchain, and working on a Windows project means you want PowerShell and Windows programs. Cage runs these tools in an isolated virtual machine, while the terminal, browser, editor and official Claude Desktop stay in the same workbench. You can keep using the system you know, share files with projects as needed, and manage the network of the working environment separately.

The computer that runs Cage is called the host, and the system inside the virtual machine is called the guest. They can be the same kind of system, though the versions can differ. For example, a Mac host can run a compatible macOS guest that Apple provides for this device, without needing to match the host version exactly.

## What this computer can choose

| Your computer | Guest options | Suitable work |
| --- | --- | --- |
| Apple Silicon Mac, macOS 14+ | macOS, Debian 13 or Ubuntu 22.04, all ARM64 | Native macOS development, Mac Claude Desktop, or Linux tools and services. The macOS guest version must be compatible with the hardware and host. |
| Intel Mac, macOS 14+, separate experimental build | Debian 13, Ubuntu 22.04 or macOS, all x86_64 | Linux keeps the existing workbench; a macOS guest needs both host and guest on 15.4+ and uses local hardware virtualization and accelerated graphics. For requirements and verification scope, see the [Intel development notes](../intel-macos-development.md). |
| Windows 11 x64 Pro, Enterprise or Education, with full Hyper-V | Windows 11, Debian 13 or Ubuntu 22.04, all x86_64 | PowerShell, native Windows build and debugging, Windows Claude Desktop, or Linux development. |
| Other supported Windows 10 22H2 / 11 x64 hosts | Debian 13 or Ubuntu 22.04 x86_64 | Use Claude Code, the browser and development tools in a separate Linux environment. Requires the Windows hypervisor platform. |
| Debian 12/13, Ubuntu 22.04/24.04 x86_64 hosts | Debian 13, Ubuntu 22.04, or Linux from the same distribution as this computer | Linux development and services. Requires KVM and access for the current user. |

Choosing the same kind of system as the host lets you keep using that platform's apps, path conventions and toolchains. Debian suits users who want less system installation work and mainly use the command line and Linux services; all three supported desktop platforms can choose it. The macOS route on Intel Macs is currently only available in experimental builds; Windows ARM64 and Linux ARM64 are not supported yet.

Note that a Windows 11 guest needs the Hyper-V platform and management tools, and Windows Home (which many people have) does not include them. You then have two options: 1. Keep using Windows Home (if your main work is Python, Git, bash or Node). In "Turn Windows features on or off", check "Windows Hypervisor Platform", restart when prompted, then go back to Cage and choose Debian 13 or Ubuntu 22.04. Note that "Virtual Machine Platform" and "Windows Subsystem for Linux" are features used by WSL 2, and Cage does not need them. 2. Upgrade to Windows Pro. If your work really needs a Windows environment and you need a Windows guest, you can upgrade in place to Windows Pro (it is not hard; search online if you don't know how), or to Education if you have the license. After upgrading, enable the Hyper-V platform and management tools in "Turn Windows features on or off", restart when prompted, then go back to Cage and create a Windows 11 guest.

The guest system determines where the program in your project actually runs. Some app features that need an extra virtual machine also depend on conditions such as nested virtualization. Claude Desktop's Cowork is not supported yet.

## Verification scope of the current development build

Choosing a system and platform wiring do not mean that all operations have been verified on real machines. For what the public installer includes, refer to the matching release notes. The table below is for checking the current development build.

| Route | Verified | Still to verify |
| --- | --- | --- |
| Mac local version match | Real first creation, system recovery, permission confirmation, bidirectional project read and write, editor, and cold-start persistence | Official Claude online sign-in and the full workflow. This round of creation checks kept the guest's internet access off. |
| Windows local version match | Official material download and verification, automatic machine creation, first launch, cold start and test file retention | Final workbench registration after the fix, and complete first use |
| Linux same-distribution match | Image identity, install source and template; native window, reinstall and uninstall data retention in an Ubuntu 22.04 container; and real browser startup | Full KVM first install, project sharing, physical desktop input and official Claude sign-in |
| Standalone Ubuntu 22.04 | Real installation on Mac ARM64, cold start, project sharing, terminal, browser, editor, Chinese input, audio, clipboard, Desktop installation and welcome page, network pause and proxy interruption, original disk persistence | First install on real Windows WHPX / Linux KVM machines, official Claude sign-in and business sessions |

Multiple accounts, phone and native Desktop file operations still need their own app-level checks. See [Multiple accounts and usage limits](accounts.md), [Phone connection](mobile.md) and [Claude Desktop](desktop.md) respectively.

## First creation of the environment

1. Install Cage for your host following [Installation and first launch](installation.md), then create or unlock your Cage account.
2. On the separate initialization screen, choose the guest system and storage location under "System and storage".
3. Set up your own proxy. When you choose "Match this computer's system version automatically", Cage detects the host version and reuses an existing image or downloads the matching official image. When you choose macOS manually, you can use an existing official IPSW or download an Apple-compatible recovery image. Windows uses the official Microsoft ISO, and for Debian, Cage downloads a base image for the matching architecture.
4. Cage prepares the guest account and development components automatically. macOS sign-in is configured automatically, and you confirm the permission prompts that the system requires. For first-time system authorization on Windows, see below.
5. After installation, required authorization and the network checks are complete, click "Enter the workbench". Then open a project, start a new terminal, and complete Claude authorization inside Cage. From then on, startup reuses the original system, tools, files and sign-in data. If initialization is interrupted, reopening it still returns to the original flow.

The same host platform uses one Cage installer, so you do not need a separate Cage installation for each guest. The system media for macOS and Windows come from the vendors and are used under their own licenses. Cage does not include operating system licenses, and it does not automatically import the host's system account, Claude sign-in, browser data or SSH keys.

The install card shows the current stage. During image download, you can see the downloaded size, total, percentage and sampled speed in real time, and image verification shows its progress separately. During system recovery and tool installation, the card shows the step in progress. Steps without a measurable total do not show a percentage. After an interruption, click "Continue installation" to reuse the original install record and saved downloads.

### Install Ubuntu 22.04 directly

On first creation, select **Ubuntu 22.04** from "Guest system". This option is independent of the host distribution: a Mac downloads the ARM64 image, and Windows and Linux x86_64 hosts download the amd64 image. You do not need to provide an ISO or enter an image digest. Cage uses a fixed-version official Canonical cloud image and verifies its SHA-256.

The image is about 669–697 MiB; reserve at least 17 GiB before creating. The virtual disk grows with actual writes, and later projects and tools need extra space. After installation, the workbench offers a terminal, the Chromium browser and an editor, and you can install Claude Desktop when needed.

If installation is interrupted, continue with the original image, install identity and disk. After completion, normal startup is still Ubuntu. If the source material is missing or inconsistent, Cage asks you to restore the original material and does not switch to Debian automatically. Existing environments cannot be overwritten or converted to another system directly through this option. For the real-machine scope of the current development build, see the verification table above on this page. Older installers are still governed by their release notes.

<a id="clone-this-computers-system"></a>

### Match this computer's OS version automatically

On first creation, you can choose "Match this computer's system version automatically". Cage detects the host's system version, prefers reusing a matching image from the cache or download folder, downloads it from the system vendor if it is missing, and then installs it into an independent, long-lived guest. The host's apps, personal files and sign-in state are not copied into the guest. Automatic detection covers matching IPSW files, official ESD files of the same name, and Linux images. An existing Windows ISO can be selected under the "Windows 11" option.

After you choose, the page shows the target system, the host and guest build numbers, the expected system download size and the space requirement. macOS matches the same version and build number. Windows matches the release version, edition and language. The patch number of official media can differ from the host, and both build numbers are shown. Windows uses compressed system files, Linux uses the minimal cloud image of the matching distribution, and the virtual disk grows with what is actually written.

<figure class="guide-shot">
  <a href="../../www/public/docs/screenshots/host-system-clone.png" target="_blank" rel="noopener"><img src="../../www/public/docs/screenshots/host-system-clone.png" alt="Preview of the matching version, existing materials and space for the host system" width="1280" height="720" loading="lazy" decoding="async" /></a>
  <figcaption>Preview of the host version, installation materials and space. Screenshot version: 0.1.6-alpha-preview (development build) · macOS native app · 2026-11-09 · standalone first-install verification. The build shown uses the name "Clone host system", while the current entry is "Match this computer's system version automatically". <a href="../../www/public/docs/screenshots/host-system-clone.png" target="_blank" rel="noopener">View original (1280 × 720) ↗</a></figcaption>
</figure>

Using this option on macOS requires Apple Silicon and macOS 26.4 or later, because the workbench's file system extension depends on the read-only mount capability provided in that version. Windows requires Windows 11 x64 and full Hyper-V. Linux supports Debian 12/13 and Ubuntu 22.04/24.04 x86_64.

When an Ubuntu 22.04 host chooses "Match this computer's system version automatically", a brand-new Ubuntu 22.04 guest is created from an officially verified cloud image; the host's accounts, files and sign-ins are not copied. Ubuntu guests install Chromium from Canonical's stable channel. When an existing environment is upgraded, the browser keeps using its existing profile folder, keeping bookmarks and site sign-in sessions that are still valid. If the stable version is older than the browser version that last used this folder, Cage pauses the switch, and you can retry after the stable channel updates.

Windows automatically creates the disk, installs the system and sets up the guest account after you confirm the system elevation prompt. After macOS recovery completes, it continues into Cage's first-time permission guide. Workbench components are fetched on demand. A full offline install requires the system materials and development components to be prepared on this computer in advance.

If a download is interrupted, click "Continue installation", and the program reuses the original install identity and the part already downloaded. If no matching version is found, it explains which materials are missing, and you can choose an existing official image. The creation process and the cache of recovery materials are located in the selected environment storage location.

### First system authorization on Mac

Register a Cage username and password first, then choose the macOS guest. Cage uses the same credentials to create a regular guest account, and stores the install credentials encrypted. The username must start with a lowercase English letter and use 1–31 lowercase letters, digits or underscores. It cannot use a reserved system name. The password uses 8–256 characters that can be typed on an English keyboard. If installation is interrupted, click "Continue installation" to reuse the original install identity and credentials, while the original disk and files are kept.

The macFUSE component of a macOS 27 guest needs one administrator authorization from you inside the guest, which a background installation cannot do for you; the component installation stopping and moving to the recovery flow below is an expected step, not a damaged environment. If the macOS component installation stops and a recovery entry appears, first start the recovery guest and open the recovery screen, then sign in to the guest's regular account with your Cage account. Click "Open Apple Installer" and follow the installer; when administrator authentication is needed, use `cagesetup` and your Cage account password, and choose Allow when the system asks about configuration file access. Keep the recovery screen open during installation; closing it cancels the current installation, while the existing disk and installation progress are kept and you can enter the recovery flow again.

If it still fails, open "Operation details" on the initialization page to see the install record, and export a diagnostics bundle through "Logs and diagnostics"; check the redacted content before sharing, and include the failed stage, the time and the steps. Do not delete the original guest disk or recreate the environment to troubleshoot.

When you change the shared password under "Settings → Account", the guest account, login keychain, first-authorization password and auto sign-in record are synced together. If the guest is shut down or the sync is interrupted, Cage keeps the pending sync record and continues at the next launch. Until it completes, the guest may still need the original password, so you cannot change the password again yet. An existing guest keeps its username and home directory, and when a shared credential is set, Cage uses that username. The username is fixed once it is used for the guest.

After installation, Cage starts and signs in to the virtual Mac automatically, skips the optional first-time setup page, and shows the system permissions that need confirmation:

1. In the guest's "Screen & System Audio Recording" and "Accessibility" settings, allow Cage Guest Window. If the system asks you to "Quit and Reopen", follow the prompt. The guide shows "Verified", "Waiting for confirmation" and "Confirm later" item by item, and the current step provides a button to open the settings page. If the page is closed, you can reopen it. If reading permissions is interrupted, the last result is kept and a recheck entry is shown.
2. Cage opens the "File System Extensions" panel automatically; turn on both `macFUSE` and `macFUSE (local)`. If the page was closed, click Cage's "Open File System Extensions" button to open it again. Cage automatically checks that a read-only test volume can be mounted and unmounted; turning on only one of them does not pass verification.
3. The first installation turns on the Screen Sharing service while the guest is offline. The guide opens the guest's "System Settings → General → Sharing"; turn on "Screen Sharing", allow the current regular guest user, then click "Turned on, check again". Cage checks the service, port 5900 and the Screen Sharing protocol (RFB) handshake. If macOS 26 says "Screen Sharing is not allowed on localhost", turn the switch on once by hand on this settings page. After the four checks pass, Cage continues with the workspace authorization and network checks.

If the "Install and check" page says an added project needs authorization, click "Open workspace authorization", check the folder, then click `Use Project` in the guest dialog so the terminal and editor use this folder. You can cancel, or request it again after the request expires.

If the system does not expand the panel automatically, go to "General → Login Items & Extensions → By Category → File System Extensions" manually. If the switches do not respond after you open "macFUSE Extensions", click Done to return and use the entry above instead. The "By Application" entry in macOS has a problem where the switches cannot be turned on. See the [macFUSE maintainer note](https://github.com/macfuse/macfuse/issues/1194).

All these permissions are confirmed inside the virtual Mac, and the guest is offline during first-time setup. When Apple asks for administrator identity, enter `cagesetup` as the username and use the same password as the Cage account. You can also click the password field and use "Fill in authorization password". Once Accessibility is allowed, this button stays available for later system authorization pop-ups. After the password is filled in, you click the button in the pop-up to confirm authorization. The prompts and action buttons on the settings screen stay outside the guest screen, so you can return to the guide at any time. When startup, password sync, reading permissions or finishing fails, the guide shows the specific reason and the matching retry entry.

When finishing the system settings, Cage revokes the temporary administrator and closes the first-time setup entry for this guest. The initialization page then offers "Connect to the workspace and continue checks". If folder authorization is needed, click "Open workspace authorization", verify the directory in the authorization window that Cage shows, click Use Project, and after verification passes, continue the network check. Operation details show the reasons for failure and the evidence for each check. Only when all critical checks pass can you click "Enter the workbench".

Later launches sign in automatically. When you lock the screen or log out manually, sign in from "Sign in to the guest account", and click "Show guest password" if needed. If FileVault or other system settings block automatic sign-in, keep the manual entry. Accounts, permissions and files are kept on the guest disk. Automatic sign-in on the guest means the account is ready as soon as the system starts. The host account and Cage's unlock protect the access entry.

<figure class="guide-shot">
  <a href="../../www/public/docs/screenshots/macos-first-permissions.png" target="_blank" rel="noopener"><img src="../../www/public/docs/screenshots/macos-first-permissions.png" alt="Mac guest first-permission guide and file system extension settings, with authorization passed" width="1280" height="720" loading="lazy" decoding="async" /></a>
  <figcaption>Mac guest first-permission guide and file system extension settings, showing authorization passed. Screenshot version: 0.1.6-alpha-preview (development build) · macOS native app · macOS 26.5 guest · 2026-11-09 · standalone first-install verification, not signed in to Claude. <a href="../../www/public/docs/screenshots/macos-first-permissions.png" target="_blank" rel="noopener">View original (1280 × 720) ↗</a></figcaption>
</figure>

### First system authorization on Windows

When installing a Windows guest, the system asks whether to allow Cage to complete the virtual machine setup and install the management helper. After you confirm this system elevation prompt, daily use of Cage continues with regular permissions. The helper only manages the Cage guest registered to the current user, and does not add you to the host group that has full virtual machine management rights. Cancelling the authorization keeps existing install progress and the disk, so you can continue later.

The Windows guest's system account and app sign-ins are stored separately. If the management helper is not connected or the original guest configuration has changed, Cage asks you to verify the original environment. Restoring the helper or updating Cage should not rebuild the account, replace the original system disk or initialize the personal directory.

### Use a local Windows ISO

After you select the official Microsoft Windows 11 x64 ISO, set the guest's initial local administrator in the installation window that opens after system authorization. The default name is `CageAdmin`, and you can change it. Save this account's password, because you need it later to sign in to the guest and to continue installation.

Cage writes the account information to an install answer disk with private permissions, and Windows first setup uses it to create a local administrator and skip the online account setup. The guest keeps zero regular Hyper-V network adapters and uses the Cage network channel after component provisioning. The answer disk is cleaned up after the guest is confirmed to have finished first setup and the administrator account can connect. Windows Setup only accepts an `Autounattend.xml` with windowsPE settings, so the answer file has one network setting left at its default; language, edition, license and disk are still chosen by you in the installer. On Windows 11 25H2 (build 26200), Windows Setup may no longer show the final "Ready to install" confirmation page once the answer file takes effect.

1. In the "Virtual Machine Connection" (VMConnect) window, select the Windows version and target disk, accept the license, and complete the region setup. The PowerShell creation window closes automatically in this round.
2. Sign in to the guest desktop with the local administrator set before installation, then return to Cage and click "At the desktop, continue installation".
3. Confirm the system authorization, then enter the guest administrator account again in the PowerShell installation window. Keep that window open and wait for the components to finish downloading, installing and configuring. Cage creates a dedicated regular account for the workbench and restarts the guest to complete the first sign-in.
4. Return to Cage to complete the network check, then enter the workbench.

Existing guests keep their original account and system disk. If the installation was created by an older version, continue with the guest administrator created back then. If it is still stuck on the forced online page of Windows first setup, press `Shift+F10` in VMConnect and first check whether `%WINDIR%\System32\OOBE\BypassNRO.cmd` exists. Run it only if the script exists, then restart, choose to continue offline and create a local account. Windows builds offer different entries; if the script is missing, set the registry value `reg add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\OOBE /v BypassNRO /t REG_DWORD /d 1 /f` in the same command prompt, then run `shutdown /r /t 0`; after the restart the online page shows an "I don't have internet" entry (verified on build 26200), and you can create a local account. If you still cannot continue, keep the virtual disk and note the Windows build number.

The install card distinguishes waiting for Windows first-time setup, component download and component configuration. When the original user registration helper fails, the operation details keep `enrollment_pipe_listen_failed` or `enrollment_pipe_accept_failed` and the Win32 error code, to help locate the problem when continuing the installation.

## Download size and disk space

The download size of a system image and the capacity of the virtual disk are two different things. The Debian base image is about 320–325 MiB, and the initial virtual disk is capped at 24 GiB. macOS and Windows installation media and system footprints are larger, so check the selected version for specifics. Before creating, reserve enough space for the image, system disk, development tools, project outputs and update backups.

The environment can be placed on a separate data disk. The app's install directory, the Cage configuration directory and environment storage are managed separately, and shared projects remain in the original folders you choose. For steps on choosing and changing disks, see [Environment storage](maintenance.md#move-the-environment-to-another-disk).

## Open guest Screen Sharing

On a Mac host, click "Open guest Screen Sharing" in "Settings → Environment and recovery" to control the virtual Mac with macOS's built-in "Screen Sharing". Sign in with the regular guest account and its password. To avoid bringing host clipboard content into the guest, keep the client's "Shared clipboard" off.

Everyday connections work whether the guest's internet is on or off. Cage only listens on a temporary port on the host's `127.0.0.1` and forwards it over the existing SSH connection to the guest's `127.0.0.1:5900`. The forwarding closes when the guest stops or Cage's background service quits. The guest's internet access is still controlled by the workbench.

If the connection fails, first click "Check Screen Sharing status" to see the results for the service, port and RFB handshake. If the service is not running, pause the internet in the workbench, then click "Turn on Screen Sharing again". If it says "not allowed", click "Open Screen Sharing settings" while the internet is paused, and confirm that the switch is on and the current regular guest user is allowed. Updating environment components only updates the enabling script and keeps the service's current state.

## Open projects and use native tools

After you select a project, use the terminal and tools that match the guest in the workbench. macOS programs are compiled and run inside the virtual Mac, Windows programs are compiled and run inside the Windows guest, and Debian and Ubuntu use Linux toolchains. The Windows guest provides PowerShell 7 and keeps the built-in Windows PowerShell 5.1 for older scripts.

The browser, editor and Claude Desktop are still opened from the Cage workbench. Claude Desktop uses the official app for the guest, and its install and sign-in data are stored inside the guest. After the first system sign-in and the necessary authorization are complete, daily use does not require switching to another full desktop.

Changes and deletions in shared folders act directly on the original files on the host; use version control or backups for important projects. Project sharing is limited to explicitly authorized folders, downloads use a separate staging folder, and Git metadata in projects is readable and writable; switching projects keeps using the same environment and does not create another virtual machine. See [Projects, terminals and files](workbench.md) for how to do it.

macOS projects use system folder authorization. Without added projects, the network check can finish directly, without requiring a default folder to be authorized. When the main screen says a project is not connected yet, click "Connect project" under it, confirm in the guest authorization window that Cage shows, then click "Verify authorization". After connecting, regular terminals, Claude Code and the editor use the same shared folder.

If the authorization window cannot be shown, allow Cage Guest Window in the virtual Mac's "System Settings → Privacy & Security → Screen & System Audio Recording", then reopen the helper as the system prompts. If you can see the window but cannot click it, allow Cage Guest Window under "Accessibility" on the same settings page, then click again.

To reduce background load, macOS guests turn off Spotlight file indexing, and Windows guests disable Windows Search indexing and the SysMain preloading service; existing environments get this on the next guest component update. File search inside the guest can therefore only look up files by name one by one. To restore them, run `sudo mdutil -a -i on` in the virtual Mac's terminal, or re-enable both services in "Services" in the Windows guest; a later guest component update turns them off again.

macOS sessions created earlier may still be bound to a private guest folder. When restoring such a session, Cage shows a note about the original folder and keeps the history and files in it. To share files with the host, add a project folder and start a new session.

## Existing environments and changing the system

Updating Cage, reinstalling the app or restarting does not change the guest system or erase the original disk. Environments already using Debian keep their original tools, files and sign-in data.

Changing the guest system requires a separate install, and the new system has its own account, apps and sign-in state. Keep a full backup of the original environment and prepare storage space for the new system. Do not treat choosing a system as an in-place conversion of the original disk. When backing up macOS, keep the virtual hardware identity and auxiliary storage too. For Windows, keep the VM configuration, system disk and associated virtual TPM state. For full steps, see [Back up, reinstall and uninstall](maintenance.md#back-up-reinstall-and-uninstall).

## How cloud and phone work together

Cloud mode runs on your own Linux server, using containers, without requiring KVM on the server. It is separate from the choice of local guest system. After you enter the remote host through the sidebar SSH, projects, programs and network exit all belong to the chosen server, and the local virtual machine can stay off. See [Cloud deployment and SSH](cloud.md).

The phone is used to connect to Cage on the computer, resume Claude Code sessions, approve tools and operate remote windows, while tasks still run on the computer. The phone does not install the desktop guest systems above. For connection methods, see [Phone connection and remote sessions](mobile.md).

The phone Desktop for a macOS guest shares the same Claude window and sign-in state as Cage on the computer. When you need to sign in to Claude through an external browser, complete the sign-in in Cage on the computer, and the phone then continues using that sign-in state. When the virtual Mac locks the screen or switches system accounts, the original phone graphics session ends, and you need to sign in to the original guest account and reopen it.

## Environment storage and project recovery

When the disk holding environment storage is not connected, or migration has not finished, the workbench shows "Environment storage needs recovery". After you connect the original disk, click "Retry recovery" on the projects and environment page in settings. On Windows, if it says the system helper needs repair, use "Repair system management helper and recover", and continue after completing system authorization. Before recovery completes, do not create another environment or delete the original virtual disk.

When a macOS project connection hits a permission problem, follow the prompt to open the corresponding file sharing, screen recording or accessibility authorization entry. After completing authorization and closing the maintenance window, Cage rechecks the project connection. If guest sign-in is needed, sign in and unlock the regular account first, then retry the project.

If an old default project is in the Cage configuration directory, the files and environment identity in that directory are kept after the upgrade. Find the project in the old directory shown on the settings page, move it to a dedicated project folder outside the configuration directory, then open it from the workbench.
## Name and device settings at creation

In "System and storage" of first setup you can enter or randomly generate the host name; Linux also supports separate accounts, home folders, display size and the control extension name. Use names that are natural, easy to remember and different from your previous environment identities. The Linux audio output name is chosen automatically from a library of real product models, and the browser keeps the identity of its actual version.

Graphics settings offer ANGLE backend choices by guest system; QEMU guests on Linux hosts can also try VirGL acceleration. They depend on the guest's actual devices and drivers; choosing a model alone cannot give you the matching physical graphics card. The browser can also turn off WebGL or block Canvas image reading by hand, which may affect some sites.

After startup you can check the browser and Claude Desktop in the safety check panel; the Desktop toolbar also has "Check environment". The checks list the actual evidence, software fallback and items not observed; the internal renderer of Claude Desktop has no supported self-check interface yet. The settings are saved with the environment; see [guest creation settings](../guest-profile.md).
