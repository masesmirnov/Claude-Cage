# Windows installation, updates and releases

The Windows version of Cage supports x64 PCs running Windows 10 22H2 (build 19045) and Windows 11. After installing, open Cage from the Start menu, choose a guest system, import your own proxy, then go to the workbench. Windows 11 Pro, Enterprise or Education with full Hyper-V can run a Windows 11 guest, with PowerShell, native Windows tools and the official Claude Desktop. Other supported Windows hosts can use Debian 13. For specific combinations, see [Choose a guest system](guide/guest-systems.md).

## Before you install

The table below and the WHPX settings apply to Debian guests. A Windows 11 guest needs the full Hyper-V platform and management tools, and a host that supports Generation 2 VMs, Secure Boot and vTPM. The first creation installs a dedicated management helper with system elevation. Daily Cage use still runs as a regular user, and the helper only manages registered guests. Windows Home uses the Debian path. The clone option matches Microsoft's official ESD, and manual install can use an official ISO. Both are used under the applicable licenses.

"Match this computer's system version automatically" matches the Windows release, edition and language, and shows patch build differences between the host and the guest. If installation is interrupted, it continues from the original record and system disk. Guest creation, first boot and cold start have been tested so far. The final workbench registration after the fix still needs to be retested. For full requirements and steps, see the [Guest system guide](guide/guest-systems.md#match-this-computers-os-version-automatically).

When you use a local ISO, the install window first collects a local administrator account for the guest, then creates the account offline with an answer file. After you reach the guest desktop, return to Cage to continue installing. Keep the PowerShell install window open while components are being set up. For detailed steps and how to continue older installs, see [Use a local Windows ISO](guide/guest-systems.md#use-a-local-windows-iso).

| Item | Requirement |
|---|---|
| System | x64 Windows 10 22H2 or Windows 11. Windows ARM64 and 32-bit systems are not included |
| Virtualization | Processor virtualization enabled in BIOS/UEFI, and "Windows Hypervisor Platform" enabled in Windows |
| Storage | A local disk with enough space for the installer, Linux image, virtual disk and update backups. The initial virtual disk limit is 24 GiB |
| Proxy | Your own Clash/Mihomo YAML source or HTTP/SOCKS5 node. Cage does not provide a proxy service |

In "Turn Windows features on or off", turn on "Windows Hypervisor Platform", then restart as the system requires. You can also run this in an administrator terminal:

```powershell
DISM /Online /Enable-Feature /FeatureName:HypervisorPlatform /All
```

This Windows feature needs one-time administrator approval. Daily Cage use and app installs run with regular user permissions. On company PCs that block virtualization, a device administrator needs to enable it. The Debian path uses a separate QEMU virtual machine, and Windows guests use Hyper-V. Neither depends on WSL or Docker.

## Install and get started

1. On the [project homepage](https://lee-xeo.github.io/Claude-Cage/#download), click "Download the app" and choose Windows. Check the `SHA256SUMS` for the matching release entry. The signed installer is named `Cage-<version>-windows-amd64-setup.exe`. Development preview builds marked as unsigned are named `Cage-<version>-windows-amd64-setup-unsigned.exe`. Unsigned builds may show an unknown publisher warning, and you need to install and update them manually.
2. Run the installer and choose an install location. On the first install, `D:\Cage` on a local D drive is selected by default. If there is no local D drive, the current user's `%LOCALAPPDATA%\Programs\Cage` is used. An existing install keeps its original folder, but you can choose another location manually. The installer includes the .NET desktop runtime, the WebView2 installer, QEMU, the OpenSSH client and the proxy core. You don't need to install Go, Node.js or Clash separately.
3. On the "Shortcuts" page, choose "Add a desktop shortcut" and "Add to the Start menu". Both are checked by default on the first install. An overwrite install keeps your last choice, and an older install restores its choice from its existing shortcuts. Uninstalling removes the shortcuts Cage created.
4. Start Cage from the shortcut you chose, then choose a guest system. If drive C has limited space, click "Choose environment storage location" in the workbench, choose an empty folder on another drive, then import your proxy and start the environment. The image, tools and virtual disk are prepared for the system you chose. Existing environments can also be migrated from Settings. See [Choose a disk and migrate](getting-started.md#choose-the-environment-storage-location) and the [Guest system guide](guide/guest-systems.md).

The installer does not set the system proxy, does not install an SSH service, and does not add the bundled tools to the system PATH. WebView2 is the system browser runtime provided by Microsoft, and its installation and maintenance are handled by the Microsoft installer.

The installer extracts files one by one into a staging folder on the drive of the install location, then replaces the app after success. This avoids creating a full extracted copy in the system temp folder. The Windows temp folder may still hold a few installer helper files. If WebView2 is missing, the Microsoft installer manages where its shared runtime components go.

"Open project" accepts Windows folders. With a Debian guest, for example `C:\Users\Name\Projects\demo` corresponds to `/c/Users/Name/Projects/demo` inside Linux. With a Windows guest, the terminal and tools use Windows paths. Project files stay in their original folder on the host, so edits and deletions affect the original files directly. The `.git` folder in a project is readable and writable, and you can stage, commit and switch branches in Cage. Only the default workspace and folders you open explicitly are shared.

Windows shortcuts mainly use `Ctrl`: `Ctrl+O` opens a project, `Ctrl+T` opens a new web page, `Ctrl+L` focuses the address bar, `Ctrl+W` closes a tab, and `Ctrl+Shift+Enter` opens a new terminal. Terminals use `Ctrl+Shift+C/V` to copy and paste, and `Ctrl+C` interrupts commands. Web pages and editors follow the key behavior of the guest system.

The window keeps only the system title bar, and the workbench fills the area below it. Use the workbench entries and shortcuts for file, project and settings actions. You can check for app updates and view version info from the right-click menu on the tray icon. When the window first opens, it is centered in the usable area of the current screen and adapts to Windows display scaling. Manually adjusted window size and maximized state are saved. When you switch screens or lower the resolution, the window stays on the current screen. Background startup and version checks don't show a command-line window.

When you open Cage from the Start menu, the backend services of both the full version and the lightweight client start silently. Closing the workbench window keeps the environment and background tasks running, and you can reopen it from the tray icon. To quit the desktop program, choose "Quit Cage" from the tray menu. If the local environment is still running, you can choose to keep tasks running or stop the environment. Stopping the environment ends its terminals.

Browser uploads use the local file selection window to pick files. After a download finishes, you can use the Windows "Save as" window to choose a location. The "Downloads" entry in the sidebar offers opening files, showing them in File Explorer and saving them again. If you cancel the save window, the file stays in the default Downloads folder. For actions and limits, see [Browser uploads and downloads](getting-started.md#browser-uploads-and-downloads).

## Updates and uninstalling

In-app updates select the Windows x64 installer from the fixed public GitHub Releases source, and follow the pre-release and stable channel rules. Checks and downloads go through the Cage proxy that is already applied and running, and do not fall back to a direct host connection. After downloading the installer, Cage verifies the SHA-256, version, product name and Authenticode signature. The current app and the new installer must have the same publisher public key. Unsigned development packages cannot install updates automatically.

The update button is hidden when there is no new version. When there is one, a gold round button appears. Save your files and end running tasks first, then click it once. The button shows circular download progress and a percentage. After verification passes, the update installs automatically without a second confirmation. The updater first backs up the app, then stops the environment, proxy and control service through the workbench's single entry point. After the current window exits, it runs a silent install. The update counts as successful only after the new app confirms the workbench starts. If installation or startup fails, it tries to restore the old program and keeps the failure reason and necessary backups. Low disk space, or files in use by other software, may prevent automatic recovery. Handle these according to the error message.

Before a manual update, also save your files, stop the environment and quit Cage, then run the new installer. If the old backend is still running, the installer refuses to overwrite it. Guest tools are updated separately in "Settings → Environment and recovery". Replacing the app keeps the original system and data.

Before uninstalling, stop the environment and quit. Then uninstall Cage from Windows "Settings → Apps". Uninstalling keeps user data. The default config, proxy and environment data root is `%USERPROFILE%\.claude-cage`, and any other environment storage location you chose is kept. The default workspace is usually in `%USERPROFILE%\.claude-cage-workspace`, and projects you opened yourself remain in their original folders. WebView2 may be shared with other programs, so it is not uninstalled automatically with Cage. If you want to delete data separately, back it up first. Deleting the virtual disk removes files and sign-in state that exist only in the guest.

## Common startup problems

Even with Windows Hypervisor Platform turned on, QEMU can still exit because nested virtualization initialization fails, with error code `80370302`. The current development build uses `kernel-irqchip=off` in the default WHPX parameters on Windows x64. QEMU then implements the interrupt controller itself, and WHPX CPU acceleration is kept. The normal desktop entry uses this parameter directly, so no external PowerShell compatibility script is needed. A QEMU machine parameter you set explicitly still takes priority. This setting changes the interrupt controller implementation, and performance depends on the hardware and virtualization support. If startup fails, "Operation details" shows a redacted QEMU stderr summary. A full redacted diagnostics bundle can be exported from Settings.

After an upgrade or a forced quit, the current development build automatically checks old connection records and control locks. If an old lock is idle, it fixes the lock's owner and private permissions, then the new backend rebuilds the connection record. A lock held by a real running backend keeps blocking takeover. If permissions can't be migrated, the specific reason is shown. Keep your personal config folder. Don't fix connection problems by deleting the account or the virtual disk. Click the × in the top right to hide the window and keep the tray icon. To quit the app, use "Quit Cage". For a running environment, you can choose to keep it running or stop it before quitting.

Cage supports install folders with Chinese characters in their path. At startup, it reads the UEFI firmware bundled with QEMU first, so no copy is needed in the user folder. With the default virtual CPU configuration, Cage queries Windows Hypervisor Platform for the supported instructions. Claude Code needs SSE4.2 from the guest. Environments with a manually specified virtual CPU model keep that setting.

- If the message says virtualization is unavailable, check the virtualization switch in BIOS/UEFI and Windows Hypervisor Platform, then restart and try again. Remote or nested VMs also need the outer host to allow nested virtualization.
- If the message says WebView2 is missing, run the full installer again. Don't download a DLL with the same name from a third-party site.
- The workbench opens, but the environment can't reach the internet: check whether a node is selected in Cage and the network check results. A working browser on Windows does not mean the Cage node is set up.
- If the message says permissions or the path are unavailable, use a local folder the current user can access. Don't use the Cage install folder, private config or a disk root as a shared project. The updater refuses install paths that contain symbolic links or directory junctions.

When you report a problem, include the Cage version, Windows version and build number, CPU architecture, the steps that failed, and the exact error text. Don't attach proxy passwords, subscription links, session addresses or unredacted config files.

## PowerShell in the Windows guest

The Hyper-V setup flow preinstalls PowerShell 7.6.9 LTS on new Windows 11 x64 guests. After your first sign-in, run `pwsh --version` in the guest terminal to check the version. Older scripts can still call the system's 5.1 with `powershell.exe`.

The Windows development package puts the creation script at `resources\guest-os\new-windows-guest.ps1` in the install folder. When you create a guest, the host downloads an x64 ZIP of about 110 MB from Microsoft, checks its SHA-256, and writes it to a read-only install disk. The guest does not need internet access, and all users share `%ProgramFiles%\PowerShell\7`. The host can also use `-PowerShellZip` to point to a file you downloaded for the same version. This step runs during the first Windows install. Existing guests are not reinstalled when Cage updates. [Guest creation script](../scripts/guest-os/new-windows-test-vm.ps1) · [Microsoft release checksums](https://github.com/PowerShell/PowerShell/releases/download/v7.6.9/hashes.sha256)

## Silent install options

Silent install accepts `/DESKTOPSHORTCUT=0|1` and `/STARTMENUSHORTCUT=0|1`. Put these options before the final `/D=` install folder. Silent updates without these options keep the saved shortcut choices.
