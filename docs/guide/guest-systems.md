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
| Intel Mac，macOS 14+，独立实验构建 | Debian 13、Ubuntu 22.04 或 macOS，均为 x86_64 | Linux 沿用现有工作台；macOS 客机要求主机与客机均为 15.4+，使用本机硬件虚拟化与加速图形。条件与验证范围见 [Intel 开发说明](../intel-macos-development.md)。 |
| Windows 11 x64 Pro, Enterprise or Education, with full Hyper-V | Windows 11, Debian 13 or Ubuntu 22.04, all x86_64 | PowerShell, native Windows build and debugging, Windows Claude Desktop, or Linux development. |
| Other supported Windows 10 22H2 / 11 x64 hosts | Debian 13 or Ubuntu 22.04 x86_64 | Use Claude Code, the browser and development tools in a separate Linux environment. Requires the Windows hypervisor platform. |
| Debian 12/13, Ubuntu 22.04/24.04 x86_64 hosts | Debian 13, Ubuntu 22.04, or Linux from the same distribution as this computer | Linux development and services. Requires KVM and access for the current user. |

选择与主机同类的系统，可以继续使用对应平台的应用、路径习惯和工具链。Debian 适合希望减少系统安装负担、主要使用命令行与 Linux 服务的用户；三个受支持的桌面平台都可以选择它。Intel Mac 的 macOS 路线目前仅在实验构建中提供；Windows ARM64 和 Linux ARM64 暂不支持。

有一点需要注意，Windows 11 客机需要 Hyper-V 平台和管理工具，而 Windows 家庭版（大部分同学可能都是家庭版）并没有这个功能，此时你有两个选择：1、继续使用 Windows 家庭版（如果你平时的主要工作是 Python、Git、bash、Node）。在「启用或关闭 Windows 功能」中勾选「Windows 虚拟机监控程序平台」，按提示重启之后，回到 Cage 选择 Debian 13 或 Ubuntu 22.04 即可。注意，「虚拟机平台」和「适用于 Linux 的 Windows 子系统」是 WSL 2 使用的功能，Cage 不需要。2、升级到 Windows 专业版。如果你的工作的确需要 Windows 环境，你需要 Windows 客机，那么你可以原地升级到 Windows 专业版（这并不难，不知道怎么升级的，多上网搜搜），或在有相应许可时升级到教育版。升级后，在「启用或关闭 Windows 功能」中启用 Hyper-V 平台和管理工具，按提示重启后，回到 Cage 创建 Windows 11 客机即可。

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

镜像约 669–697 MiB，创建前至少预留 17 GiB；虚拟磁盘按实际写入增长，后续项目和工具仍需额外空间。安装后，工作台提供终端、Chromium 浏览器和编辑器，也可以按需安装 Claude Desktop。

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

Ubuntu 22.04 主机选择“自动匹配本机系统版本”时，从官方校验过的云镜像创建全新的 Ubuntu 22.04 客机；不会复制主机的账户、文件或登录状态。Ubuntu 客机从 Canonical 的稳定渠道安装 Chromium。已有环境升级时，浏览器继续使用原有资料目录，保留收藏和仍然有效的网站登录会话。若稳定版低于上次使用该目录的浏览器版本，Cage 会暂停切换，等稳定渠道更新后即可重试。

Windows automatically creates the disk, installs the system and sets up the guest account after you confirm the system elevation prompt. After macOS recovery completes, it continues into Cage's first-time permission guide. Workbench components are fetched on demand. A full offline install requires the system materials and development components to be prepared on this computer in advance.

If a download is interrupted, click "Continue installation", and the program reuses the original install identity and the part already downloaded. If no matching version is found, it explains which materials are missing, and you can choose an existing official image. The creation process and the cache of recovery materials are located in the selected environment storage location.

### First system authorization on Mac

Register a Cage username and password first, then choose the macOS guest. Cage uses the same credentials to create a regular guest account, and stores the install credentials encrypted. The username must start with a lowercase English letter and use 1–31 lowercase letters, digits or underscores. It cannot use a reserved system name. The password uses 8–256 characters that can be typed on an English keyboard. If installation is interrupted, click "Continue installation" to reuse the original install identity and credentials, while the original disk and files are kept.

macOS 27 客机的 macFUSE 组件需要你在客机中完成一次管理员授权，后台安装无法代为完成；组件安装中断并转入下面的恢复流程属预期步骤，不是环境损坏。若 macOS 组件安装中断并出现恢复入口，先启动恢复客机并打开恢复画面，使用 Cage 账户登录客机普通账户。点击「打开 Apple Installer」后，按安装器提示继续；需要管理员认证时使用 `cagesetup` 和 Cage 账户密码，并在系统询问配置文件访问权限时选择允许。安装期间保持恢复画面打开；关闭画面会取消当前安装，已有磁盘和安装进度会保留，可重新进入恢复流程。

仍然失败时，在初始化页面打开「操作详情」查看安装记录，并通过「日志与诊断」导出诊断包；分享前检查脱敏内容，附上失败阶段、发生时间和操作步骤。不要删除原客机磁盘或重新创建环境来排查。

When you change the shared password under "Settings → Account", the guest account, login keychain, first-authorization password and auto sign-in record are synced together. If the guest is shut down or the sync is interrupted, Cage keeps the pending sync record and continues at the next launch. Until it completes, the guest may still need the original password, so you cannot change the password again yet. An existing guest keeps its username and home directory, and when a shared credential is set, Cage uses that username. The username is fixed once it is used for the guest.

After installation, Cage starts and signs in to the virtual Mac automatically, skips the optional first-time setup page, and shows the system permissions that need confirmation:

1. In the guest's "Screen & System Audio Recording" and "Accessibility" settings, allow Cage Guest Window. If the system asks you to "Quit and Reopen", follow the prompt. The guide shows "Verified", "Waiting for confirmation" and "Confirm later" item by item, and the current step provides a button to open the settings page. If the page is closed, you can reopen it. If reading permissions is interrupted, the last result is kept and a recheck entry is shown.
2. Cage 自动打开「文件系统扩展」面板，打开 `macFUSE` 和 `macFUSE (local)` 两个开关即可。若页面被关闭，点击 Cage 的「打开文件系统扩展」按钮直接重新打开。Cage 自动检查只读测试卷能否挂载和卸载；只打开其中一项不能完成验证。
3. 首次安装会在客机断网时启用屏幕共享服务。引导会打开客机的「系统设置 → 通用 → 共享」，请打开「屏幕共享」，允许当前普通客机用户访问，再点击「已开启，重新检查」。Cage 会检查服务、5900 端口和屏幕共享协议（RFB）握手。若 macOS 26 提示「屏幕共享在 localhost 上不被允许」，请在这个设置页手动打开一次开关。四项检查通过后，Cage 会继续工作区授权和联网检查。

如果「安装与检查」页提示已添加的项目需要授权，点击「打开工作区授权」，核对文件夹后，在客机对话框中点击 `Use Project`，让终端和编辑器使用这个目录。可以取消，也可以在请求过期后重新申请。

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

Cage 将账户信息写入具有私有权限的安装应答盘，Windows 首次设置据此创建本地管理员并跳过联网账户引导。客机保持零常规 Hyper-V 网卡，完成组件置备后使用 Cage 网络通道。应答盘在确认客机已完成首次设置、可以通过管理员账户连接后清理。Windows 安装程序只接受含有 windowsPE 设置的 `Autounattend.xml`，因此应答文件带有一项保持默认值的网络设置；语言、版本、许可和磁盘仍由你在安装界面选择。Windows 11 25H2（内部版本 26200）上，应答文件生效后 Windows 安装程序可能不再显示最后的“准备安装”确认页。

1. In the "Virtual Machine Connection" (VMConnect) window, select the Windows version and target disk, accept the license, and complete the region setup. The PowerShell creation window closes automatically in this round.
2. Sign in to the guest desktop with the local administrator set before installation, then return to Cage and click "At the desktop, continue installation".
3. Confirm the system authorization, then enter the guest administrator account again in the PowerShell installation window. Keep that window open and wait for the components to finish downloading, installing and configuring. Cage creates a dedicated regular account for the workbench and restarts the guest to complete the first sign-in.
4. Return to Cage to complete the network check, then enter the workbench.

已有客机继续使用原账户和系统盘。若安装由旧版本创建，使用当时创建的客机管理员继续。若仍停在 Windows 首次设置的强制联网页面，可以在 VMConnect 中按 `Shift+F10`，先检查 `%WINDIR%\System32\OOBE\BypassNRO.cmd` 是否存在。仅在该脚本存在时运行它，重启后选择离线继续并创建本地账户。各 Windows 构建提供的入口不同，缺少该脚本时，可在同一命令提示符中设置注册表值 `reg add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\OOBE /v BypassNRO /t REG_DWORD /d 1 /f`，再运行 `shutdown /r /t 0`；重启后联网页会出现“我没有网络”入口（已在内部版本 26200 上验证），随后创建本地账户。仍无法继续时应保留虚拟磁盘并记录 Windows 构建号。

The install card distinguishes waiting for Windows first-time setup, component download and component configuration. When the original user registration helper fails, the operation details keep `enrollment_pipe_listen_failed` or `enrollment_pipe_accept_failed` and the Win32 error code, to help locate the problem when continuing the installation.

## Download size and disk space

The download size of a system image and the capacity of the virtual disk are two different things. The Debian base image is about 320–325 MiB, and the initial virtual disk is capped at 24 GiB. macOS and Windows installation media and system footprints are larger, so check the selected version for specifics. Before creating, reserve enough space for the image, system disk, development tools, project outputs and update backups.

The environment can be placed on a separate data disk. The app's install directory, the Cage configuration directory and environment storage are managed separately, and shared projects remain in the original folders you choose. For steps on choosing and changing disks, see [Environment storage](maintenance.md#move-the-environment-to-another-disk).

## 打开客机屏幕共享

在 Mac 主机的「设置 → 环境与恢复」中点击「打开客机屏幕共享」，即可用 macOS 自带的「屏幕共享」操作虚拟 Mac。登录时使用普通客机账户及其密码。为避免把主机剪贴板内容带入客机，请保持客户端的「共享剪贴板」关闭。

日常连接可以在客机外网开启或关闭时使用。Cage 只在主机的 `127.0.0.1` 上监听临时端口，通过已有的 SSH 连接转发到客机的 `127.0.0.1:5900`。转发随客机停止或 Cage 后台退出而关闭。客机的外网权限仍由工作台控制。

连接失败时，先点「检查屏幕共享状态」查看服务、端口和 RFB 握手的结果。若服务未启动，请在工作台暂停外网，再点「重新启用屏幕共享服务」。若提示「不被允许」，请在外网暂停时点「打开屏幕共享设置」，确认已打开开关并允许当前普通客机用户访问。更新环境组件时只更新启用脚本，保留服务当前的启用状态。

## Open projects and use native tools

After you select a project, use the terminal and tools that match the guest in the workbench. macOS programs are compiled and run inside the virtual Mac, Windows programs are compiled and run inside the Windows guest, and Debian and Ubuntu use Linux toolchains. The Windows guest provides PowerShell 7 and keeps the built-in Windows PowerShell 5.1 for older scripts.

The browser, editor and Claude Desktop are still opened from the Cage workbench. Claude Desktop uses the official app for the guest, and its install and sign-in data are stored inside the guest. After the first system sign-in and the necessary authorization are complete, daily use does not require switching to another full desktop.

共享目录中的修改和删除直接作用于主机原文件，重要项目应使用版本控制或备份。项目共享只限明确授权的目录，下载使用独立的暂存目录，项目内的 Git 元数据可读写；切换项目继续使用同一环境，不会创建另一台虚拟机。操作方法见[项目、终端与文件](workbench.md)。

macOS 项目使用系统文件夹授权。未添加项目时可直接完成联网检查，不要求授权一个默认文件夹。主界面提示项目尚未连接时，点击该项目下的“连接项目”，在 Cage 显示的客机授权窗口中确认，再点“验证授权”。连接完成后，普通终端、Claude Code 和编辑器使用同一共享目录。

If the authorization window cannot be shown, allow Cage Guest Window in the virtual Mac's "System Settings → Privacy & Security → Screen & System Audio Recording", then reopen the helper as the system prompts. If you can see the window but cannot click it, allow Cage Guest Window under "Accessibility" on the same settings page, then click again.

为减少后台占用，macOS 客机关闭了聚焦（Spotlight）文件索引，Windows 客机停用了 Windows Search 索引和 SysMain 预加载服务；已有环境在下一次更新客机组件时生效。客机内的文件搜索因此只能按文件名逐个查找。需要恢复时，在虚拟 Mac 的终端执行 `sudo mdutil -a -i on`，或在 Windows 客机的“服务”中重新启用这两项服务；之后再次更新客机组件会重新关闭。

较早创建的 macOS 会话可能仍绑定客机私有目录。恢复此类会话时，Cage 会显示原目录提示，保留其中的历史和文件。需要与主机共享文件时，添加项目文件夹后新建会话。

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
## 创建时的名称与设备配置

首次设置的“系统与存储”中可以填写或随机生成主机名；Linux 还支持独立账户、主目录、显示尺寸和控制扩展名称。建议使用自然、易记、与你以往环境身份不同的名称。Linux 音频输出从真实产品型号库中自动选择名称，浏览器保持实际版本的身份信息。

图形设置按客机系统提供 ANGLE 后端选择；Linux 主机的 QEMU 客机还可尝试 VirGL 加速。依赖客机实际设备与驱动，不能仅靠选择一个型号就获得对应的实体显卡。浏览器也可手动关闭 WebGL 或阻止 Canvas 图像读取，可能影响部分网站。

启动后可在安全检查面板检测浏览器和 Claude Desktop；Desktop 工具栏也有“检测环境”。检测会列出实际证据、软件回退及未观测项，Claude Desktop 内部渲染器尚无受支持的自检接口。设置随环境保存，详见[客机创建配置](../guest-profile.md)。
