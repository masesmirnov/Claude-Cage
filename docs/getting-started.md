# Getting started with Cage

This guide walks you through installing the app, choosing a guest system, setting up a proxy, starting the environment and doing your first project task. Cage runs a separate, persistent environment on your computer. You can use macOS on a Mac, Windows on Windows, or a lightweight Debian. The terminal, browser, editor and official Claude Desktop are all opened from the same workbench.

Features are described for the current development build. For the entry points and verified scope in a public installer, see its release notes. Detailed day-to-day tasks are in the [user manual](guide/index.md). This page covers the path from installation to your first session of work, plus common reference details.

Opening Cage goes to your local home page by default. To use a server, click "SSH host" in the sidebar, use the plus button to save the address, SSH user and key, then click "Connect to this host". Verify the host fingerprint on first connection. If the server is ready, you go straight to the remote workbench. Stopped deployed services start automatically. The first install shows "Deploy and connect". When you click it, Cage uploads the deployment package over SSH and prepares the container. Your local VM can stay off the whole time. If the local environment is running, you can choose to keep or stop it before switching. [Supported servers and deployment requirements](../deploy/cloud/README.md)

## Before you use the local environment

| What you need | Details |
|---|---|
| Supported platforms and virtualization | Apple Silicon Macs need macOS 14+. Windows 10 22H2 / 11 x64 running Debian needs the Windows Hypervisor Platform, and a Windows 11 guest needs a supported version of full Hyper-V. Debian 12 / Ubuntu 22.04 / 24.04 x86_64 hosts need KVM. For supported combinations, see [Choose a guest system](guide/guest-systems.md). Intel Macs, Windows ARM64 and Linux ARM64 are not supported yet. |
| A working proxy | A Clash/Mihomo YAML subscription, a local YAML file, or your own HTTP/SOCKS5 node. Cage includes its own proxy core but does not provide a proxy service. |
| Your own Claude access | To use Claude Code, authorize your own account inside Cage. Sign-ins on the host are not imported automatically. |

The first setup needs the official installation media and developer tools for the system you chose, so keep your network connected and leave enough disk space. Download and install time depends on the system and your network speed. Later starts reuse the existing environment. For host and guest combinations, see [Choose a guest system](guide/guest-systems.md).

## 1. Install the app

在[项目主页](https://claude-cage.com/#download)点击“下载应用”，选择 macOS、Windows 或 Linux。也可直接查看 [GitHub Releases](https://github.com/Lee-xeo/Claude-Cage/releases)，无需获得仓库访问授权。各平台的可下载版本可能不同；没有公开安装包的平台会提供安装与构建说明。

| Platform | How to install |
|---|---|
| macOS | Download the Apple Silicon `.dmg`, open it, drag Cage into Applications, then launch it from the Applications folder. |
| Windows | Download the x64 `.exe` installer, run it, then open Cage from the Start menu. Trusted signed packages let you verify the publisher. Older builds, or preview builds marked "Preview · unsigned", are only for manual install testing and cannot install updates automatically. See the [Windows guide](windows.md). |
| Linux | Download the x86_64 `.deb` and install it with `sudo apt install ./Cage-<version>-linux-amd64.deb`. If host dependencies such as QEMU, GTK, WebKitGTK or OpenSSH are missing, APT installs them from your system's configured sources. Then open Cage from the application menu. See the [Linux guide](linux.md). |

You don't need to install developer tools or Clash first. For signing, notarization and platform verification, see the release notes for that installer. If your system refuses to open the app, first check the version and source under [Installation problems](troubleshooting.md#download-or-installation-problems). The proxy, environment and project steps below apply to all platforms.

When you first open Cage, register a username and a password of at least 8 characters, then choose the guest system, storage location and network proxy. On a Mac, the username starts with a lowercase letter and is 1–31 lowercase letters, digits or underscores. The password is 8–256 characters you can type on an English keyboard. A new macOS guest uses the same username and password. The full desktop version on all three platforms has "Remember me" checked by default, and you can uncheck it. If you already have a password account, you can also check it when signing in, or turn it on in "Settings → Account → Remember me". Your choice is kept after you close the app.

账户保存在当前主机。注册后请保存恢复密钥；已有账户可在“设置 → 账户”验证密码后补设，忘记密码时在登录页使用密钥重置，详见[账户恢复](guide/settings.md#保存恢复密钥)。左下角头像菜单的“设置 → 账户”可以更换头像和密码；用户名用于 macOS 客机后会固定，以保留用户目录和文件。修改共用密码时，客机关闭或暂时无法连接，会在下次启动时继续同步；完成前客机可能仍需原密码。Cage 账户不替代 Claude 账号，也不会加密项目文件或整个虚拟磁盘。

### Choose a guest system

When you create the local environment for the first time, you can choose a guest system of the same type as your host. On Apple Silicon Macs, use a compatible macOS. On Windows 11 Pro, Enterprise or Education with full Hyper-V, use Windows 11. All three supported desktop platforms can choose Debian 13. Windows Home and supported Windows 10 hosts use Debian.

The guest system decides which platform your terminal, compilers and apps actually run on. When developing Mac or Windows apps, choose the matching system. If you mainly use the Linux command line and services, choose Debian. For macOS and Windows, follow the prompts to set up the guest account, first sign-in and permissions. For system image sources, space requirements and licenses, see the [Guest system guide](guide/guest-systems.md). Updating Cage does not change existing systems. To switch systems, install the new one separately and keep the original environment.

When creating the environment for the first time, you can also match official materials to your local version. This creates a clean, separate guest. Your personal host files and sign-in data are not used as a source. On a Mac, local system matching requires macOS 26.4+. Windows matching covers the release, edition and language. Patch builds can differ. Linux supports Debian 12/13 and Ubuntu 22.04/24.04. For exact versions, download sizes, space and resume rules, see [Local system matching](guide/guest-systems.md#clone-this-computers-system).

### Choose the environment storage location

The Windows installer lets you choose the program folder. To keep both image downloads and the virtual disk on drive D, change the pre-filled "Storage directory" under "System and storage" on the separate setup screen after your first sign-in, or choose an empty folder such as `D:\CageData`. Save it when you click "Next: configure proxy". macOS and Linux use the same steps. You only reach the workbench after installation, required authorization and network checks finish. If you close the app midway, reopening it lets you continue. With the default Debian settings, the virtual disk is at `.claude-cage/state/lima` in your home folder, and image download cache is in the `lima` folder under the system user cache directory (on Windows, `%LOCALAPPDATA%\lima`).

Choose a local disk that supports private file permissions and sparse files. On Windows, use NTFS. On Linux, use ext4, XFS or Btrfs. On a Mac, use an APFS volume with ownership enabled. If you use an external disk on a Mac, open its "Get Info" window in Finder and uncheck "Ignore ownership on this volume".

For an existing environment, you can change the disk in "Settings → Environment and recovery → Local environment storage". First save your work in the terminal and editor, then choose an empty folder and confirm the move. Cage stops the environment, copies and verifies the data, then switches the directory. Start the environment manually and check your old files and sign-in state. After that, you can clear the old backup shown in the panel to free up space. The target disk needs enough free space. If you use an external disk, reconnect the original disk before every start. Account settings stay in the original user folder, and shared projects still open from their own project folders. The old system user cache may still be used by other Lima instances, so the move leaves it where it is.

### What is downloaded on first start

macOS uses the compatible recovery image from Apple, or an official IPSW you already have. Windows uses the official Microsoft ISO and prepares the developer tools for that system. Download size and system disk needs for both are shown for the version you choose. The download list below and the 24 GiB initial disk limit apply to Debian 13. For macOS and Windows requirements, see [Download size and disk space](guide/guest-systems.md#download-size-and-disk-space).

| Item | Source and purpose |
|---|---|
| Debian 13 base image | One image per processor architecture, about 320–325 MiB. Tries the Nanjing University and USTC mirrors first, then the official Debian source. Verified with the SHA-512 checksum pinned by Cage. |
| Linux packages | Debian provides Chromium, Python, Git, build tools, remote desktop, fonts and system dependencies. Before installing dependencies, Cage checks the APT version in Debian 13. If it is older than 3.0.4, it upgrades from the official security source and keeps Debian signature and digest checks. By default, packages use the Nanjing University and USTC mirrors first, but only if a connectivity test passes, then fall back to the official source. Unreachable mirrors are skipped for this run. Custom software sources keep their original settings. |
| Node.js, editor and tool manager | Node.js 24 is installed through NodeSource. mise first downloads the upstream executable for your architecture from npmmirror. code-server first downloads a pinned Debian package from USTC. Both are verified with the SHA-256 checksums pinned by Cage. If public mirrors are unavailable, they fall back to their GitHub Releases. The editor also pre-fetches JSON validation rules from sources such as SchemaStore for offline use. A missing rule only affects validation of the matching files. |
| Claude Code | The official npm registry provides version and integrity information. Larger Linux executables are downloaded from npmmirror first and verified with the official npm digest. |

The first install and tool upgrades choose download sources automatically, so you don't need to fill the cache by hand. The USTC code-server mirror keeps only recent versions. If the version Cage pins is missing there, Cage downloads that version directly from GitHub. Downloads still go through the Cage proxy you selected. The initial virtual disk is capped at 24 GiB. Download traffic and actual disk use depend on the architecture, package versions and existing cache. Later starts reuse the installed environment. If you need Claude Desktop, install it separately from the workbench. Only then does Cage contact Anthropic's software source.

To pin the official Debian source, write `official` to `/etc/claude-cage/debian-mirror` in the guest. Write `auto`, or remove the file, to restore automatic selection. The change takes effect at the next install or maintenance. The preference is kept with the virtual disk, and work environments cloned from the base environment inherit it too. Mirror probing waits up to 8 seconds for each address. Install downloads wait 15 seconds for a response and retry once. If an APT upgrade fails, later dependency installs stop. After you fix the network, you can retry. You don't need to delete personal data or the virtual disk.

### Trusted local sign-in

When you register an account, check "Remember me" and the same system user can open Cage automatically later. For an existing password account, you can turn it on after verifying the password on the sign-in page, or turn it on or off in "Settings → Account → Remember me". All three platforms use the same local trust mechanism. Manual locking still requires verification, and signing out of the account revokes this trust. Remote connections cannot use local trusted sign-in. Claude services still need your own authorization.

Trusted mode relies on your operating system's user sign-in. Lock your system when you leave your computer. Existing account-free workspaces can still be used. When you prepare a macOS guest, setup first asks you to set a shared username and password. The workspace's internal keys and existing data are kept. To back up an account-free workspace, also back up the private trust credentials in `Cage/trusted-local` under the system user configuration directory (on Windows, `%LOCALAPPDATA%`), and keep them with private permissions.

## 2. Import and choose a proxy

In the workbench, click "Set up network and proxy". You can also open it later from "Settings → Network and proxy" at the bottom left. If there are no nodes, click "Add source" and choose an import method:

- **Subscription link**: Enter a source name and an HTTPS subscription URL. If you don't have any usable nodes yet, check "Download this subscription over the host network". If you leave it unchecked, the subscription downloads through the proxy you configured. If that fails, the path doesn't switch automatically.
- **Local YAML**: Choose a file or paste the config content. Good if you have already exported your node config.
- **Manual node**: Enter your HTTP or SOCKS5 node settings. Fill in the username and password in their fields.

Click "Import and verify", then go to "Nodes", choose the final exit and click "Apply proxy". The top bar shows the current exit and its exact status. When the core is running but the environment isn't started, it shows "Waiting to start environment". After checks pass, it shows "Connected". If the core is stopped or no node is applied, internet access is not allowed.

If a residential proxy cannot be reached directly from mainland China, switch to "Chained proxy" on the "Nodes" page, choose a relay node that can be reached from China, and then set the residential proxy as the "Final exit". Nodes can come from different subscriptions. They connect in the order shown on the page, from top to bottom. The preview should show "Cage → relay node → residential proxy → target site". The chain takes effect after you click "Apply proxy", and websites see the IP of the final exit. For more relays, click "Add relay".

Proxy combinations are saved separately, so subscription updates don't overwrite them. If an update removes a node that is in use, the original config is kept and an error is shown. Choices you haven't applied yet are drafts. If you leave the page, you are asked whether to discard them. "Save settings" is for DNS, IP change rules and other settings. For the proxy, use "Apply proxy" in the configuration area.

A subscription must include `proxies` or `payload` node content. Base64 lists, single share links, and configs that only contain remote providers are not supported yet. Get a Clash/Mihomo YAML node subscription from your provider, or export a local YAML file. Import only takes nodes and explicit proxy chains. System proxy, TUN, port and direct-connection rules in the config are not applied to Cage.

Cage uses its own ports and config. It does not set the system proxy, does not turn on the host TUN, and does not change the node choice in your local Clash. Downloading a subscription through the host and resolving node domains at startup are proxy preparation traffic. Business DNS inside the Cage environment still goes through the selected node.

HTTP/SOCKS5 services can be added through "Subscription → Add source → Manual node", including the server, port and authentication. All nodes are handled by Cage's built-in core. Encrypted DNS on the network page is forwarded through the current node. If no valid node is applied, Cage does not connect to the internet.

## 3. Start and wait for checks to finish

返回工作台，首次创建时确认客机系统与存储位置，再点击“启动 Cage 环境”。无需先选择项目。系统安装和必要授权完成后，后续启动继续使用原环境。

安装、启动和项目共享不检查主机的裸仓库保护设置，也不会改写主机全局 Git 配置。已有的 Git 设置保持原样；需要调整时见[主机 Git 设置](troubleshooting.md#主机-git-设置与裸仓库)。

第一次启动时，工作台会显示当前正在下载或安装的组件。下载 Debian 镜像时可以看到已接收的数据量，服务器提供文件总大小时也会显示百分比。下载 mise、Claude Code 和网页编辑器时，可以看到当前文件已接收的数据量。安装软件包时显示组件名称，点击“操作详情”可查看安装日志。下载中断后，可以点击“继续安装”，Cage 会尝试从已保存的位置续传。环境启动后会连接浏览器并执行网络检查。

After the environment starts, business internet access is turned off first. Then it runs 11 critical checks covering exit, DNS, system and browser settings, file sharing, the host management interface, proxy fail-closed behavior, UDP, IPv6 and exit rules. The first base image build has no project mounts and has to download tools through the proxy you chose.

When the environment is ready, critical checks pass, and network authorization is valid, the interface shows a green shield with a check mark. If a check fails or evidence is missing, internet access stays off. The terminal, shared files and local web pages inside the environment still work. Click the network status at the bottom to see which checks failed. After you fix the issue, check again. You can cancel a check that is running, or stop the environment.

On first use on macOS, Windows and Linux, "Follow the time zone of the exit IP" is on by default. It syncs the Cage environment's time zone when you start it or apply settings. To choose one manually, go to "Settings → Time zone and language". Saved manual choices are kept. Language can be set to follow automatically or chosen manually, separately. Network and system settings need the environment restarted after you apply them. The interface warns you to save files, since terminals will be interrupted. Running tasks are not silently restarted just because a background check found a location change.

## 4. Open a project and start working

点击左侧“项目”标题旁的加号，选择已有项目，或点击“添加本机项目…”选择主机上的项目文件夹。新终端和文件编辑器将从这个目录开始工作；没有项目时请先添加一个文件夹。终端使用所选客机的系统工具，Windows 客机提供 PowerShell 7，并保留 Windows PowerShell 5.1。

Click the terminal icon on the right of a project and choose "New Claude terminal". Cage automatically runs `claude` in that project. You can also choose a regular terminal and type commands yourself. "Settings → General → Claude terminal startup command" lets you add options, such as `claude --continue`. Saving only affects new Claude terminals. After you quit Claude, you can still use the shell.

Open "Settings → Claude account". If you have already signed in to your subscription with Claude Code in a regular Cage terminal, the page shows the email detected by the default terminal once the environment is ready. Click "Add to scheduling" to reuse that sign-in. Claude Desktop, the web and the macOS Terminal on your device each have their own sign-in. The panel only checks Claude Code in the Cage guest.

To add another Claude subscription, click "Sign in to a new account" and complete the official authorization in a temporary browser window. Cage gives this sign-in its own folder. After success, it's registered by email and included in scheduling. You can also edit the note afterwards. Canceling sign-in does not add a schedulable account. Later, click the terminal icon on the right of a project to create a new Claude terminal. Its tab shows the account it was assigned.

If a regular terminal was first signed in as A and later signed in as B, Cage stops assigning the default folder to A. B needs its own click on "Add to scheduling". To keep A and B both online over time, keep one default sign-in, then use "Sign in to a new account" to create a separate sign-in for the other account.

Turning off "Include in automatic assignment" for an account only affects terminals created later. Sessions already using that account can continue. When you open the account panel, Cage asks the official Claude Code in the guest for the five-hour and seven-day usage limits. Click "Check status" on the card to recheck that account right away, without sending a model message first. If a window returns no reading, the panel explains this and keeps that window's last percentage and read time. [Account scheduling and usage limits](guide/accounts.md)

New sessions can be assigned evenly or chosen in list order. An existing session can switch accounts to resume its history only when you explicitly allow it, the session is in the same continuation group, and the original task can be stopped safely. You can also allow automatic continuation in advance, after a usage limit is confirmed to be used up. For how skills, instructions and project memory are shared, and the conditions for verifying native guests, see [Multiple accounts and usage limits](guide/accounts.md). The Agent number on a Claude Code tab shows the account it is currently bound to.

You can first ask Claude to read the project and explain a file, to confirm model requests work. Then ask it to make a small change to a test file. Use "Browse files" to view the content, and check the same file's changes on your host. Back up important projects before first use.

File changes apply directly to the shared folder. The `.git` folder in a project is readable and writable, so Claude can change code, and you can review, stage and commit it in Cage.

Click "Browser" on the left to return to the browser page you were using. Use the plus button at the top to open a new web page. `localhost` in the address bar points to the current Cage guest, so you can preview dev servers you started in a Cage terminal.

## Daily use

### Claude website and desktop app

The `claude.ai` entry below the browser opens the website directly in the Cage browser. The `Claude Desktop` entry gives you the official desktop app. The first time, click "Download and install". Cage installs it from Anthropic's official source, then opens the app. Chat and Code switch within the same app. Before installing, start the environment and make sure the proxy you chose works. You don't need to wait for business internet access to be allowed. Internet access inside the app still has to pass the network check. If installation fails, you can check progress and retry.

If the browser and Claude Desktop stutter while scrolling, turn on "Settings → General → Prefer smoothness" and save. The next time you start the environment, both draw at 1.5× pixel density, while text and controls keep their original size. Turn it off to switch back to the default 2× high-definition graphics.

The Desktop view adjusts automatically with the Cage window and sidebar. "Display size" in the top right defaults to 100%. A smaller value shows more content. A larger value enlarges text and controls. No app restart is needed. Your setting is saved on this computer. If a notice says the display size couldn't sync, click "Retry resizing".

The app is downloaded and started only when you use it. It keeps running when you switch to the browser or terminal. Click "Close app" above the app to free its resources. Your sign-in data stays in Cage. After closing the app, you can click "Update / repair install". Your first Claude account sign-in happens inside Cage and does not import a host account. Cage creates and unlocks the system keyring internally, so you don't need to set a separate keyring password. Changing your Cage password keeps the app's sign-in data. Cowork, which needs an extra virtual machine, is not supported yet.

When the app page or the Cage host window is not visible, Cage pauses its scheduled checks of app status. It reads the status again right away when you return. Tasks inside the app keep running, and your graphics setting stays as it was.

On a Linux guest, the Desktop app managed by Cage hides its window automatically after the last computer or phone viewer disconnects, to reduce background drawing. The window comes back when you open the view again. The app process and running tasks keep going. On native Windows and macOS guests, the windows keep their native behavior. Screen capture stops along with the viewing connection.

### Lock and sign out of account

"Lock Cage" in the avatar menu at the bottom left hides the workbench and asks for your password again. Running Claude, terminal and environment tasks keep running. "Sign out" first reminds you to save files, then stops the environment and locks credentials. If you only quit the app, background tasks keep running. "Settings → Account → Remember me" turns on local automatic sign-in. Next time you open the app as the current system user, you go straight in. After a manual lock, a password or Touch ID is still required, and reopening the app doesn't skip verification. If Touch ID is set up on your Mac, you can turn on fingerprint unlock in "Sign-in and unlock". Signing out of account revokes the local quick sign-in authorization.

### Save website passwords

After you submit a sign-in form for a site such as your email in the Cage browser, the browser tools area asks whether to save the password. First make sure the sign-in worked, then click "Save password". If the password changes, you can choose "Update password". "Never for this site" only turns off save prompts for that site.

When you open the same site again, expand "Passwords" in the browser tools area, choose an account to fill into the sign-in form, then submit it yourself. Common forms on HTTPS top-level pages are supported for now. Embedded frames, CAPTCHAs and passkeys are not handled automatically. If an older environment says the password feature is unavailable, update the environment components under "Settings → Environment and recovery" first.

In "Settings → Password vault", you can search, add, edit and delete entries, or restore save prompts for a site. Viewing or copying a password requires you to enter your Cage account password again. The vault unlocks and locks along with Cage. If Remember me is on, it also unlocks along with Cage. Passwords are stored only on this computer. When you back up, keep both the account file and the password vault in the config folder. For the exact limits, see [Password vault settings](guide/settings.md).

### Projects, tabs and files

左侧“项目”列出明确打开的文件夹，列表由 Cage 保存，重新打开应用后仍可看到。每个项目右侧有两个图标。点击打开图标（↗）可在 code-server 中编辑该目录的文件。点击终端图标（>_）可选择终端类型，在该目录新建终端。已有终端始终留在创建它的目录下。所有项目共用一个持久环境，所选客机系统、工具、账户和文件系统也相互共享。已打开的目录在环境启动时恢复连接。

The browser is separate from projects. Web pages and file editors use tabs at the top. Switching projects does not close or move web pages. Hover over a terminal row, or focus it with the keyboard, to pin, rename or delete the terminal from the right side. Browser tabs open their action menu with right-click or Shift+F10. Drag to change the order within the same list. The order is kept after a refresh. ⌘1–9 switches between pages in the current browser or terminals in the current folder.

Click the × in the top right of the browser workspace to leave the browser view and return to the home page, terminal or Claude Desktop you were on before. If that terminal has already ended, you return to the home page. Both horizontal and vertical tab layouts have this button, and a split view of two web pages shares one close button. Web tabs, sign-ins and background incognito sessions are kept. Click "Browser" in the sidebar again to continue. To end an incognito session, close all incognito tabs or stop the environment.

When there are many tabs, they shrink automatically, and the current page's tab keeps more room for its title. While you drag, other tabs move aside right away. Release to save the order, or press Esc to cancel. Pinned tabs are sorted within the pinned group. The down arrow on the right lets you search open pages.

Click the star on the right of the address bar, or press ⌘D, to bookmark the current web page. You can edit its name and choose or create a bookmark folder. Click the bookmarks button next to it, or press ⌘⇧O, to search, open and edit bookmarks. When editing, you can move a bookmark to another folder. Deleting a folder moves its pages to "Uncategorized". Bookmarks are saved in the current Cage config on this computer. They are shared by all projects and kept after a restart.

### Browser settings and extensions

Click "Settings" in the "…" menu at the top right of the browser to open a separate settings tab. Clicking it again returns you to the same tab. In "New tab", you can save a default address. In "Appearance", you can choose horizontal or vertical tabs. In "Privacy and site data", you can manage cookies and site permissions. The browser manages these browser-specific settings itself.

Go to "Extensions" to add a Manifest V3 ZIP extension. After you choose a file, check its name, version and permissions, then click "Install extension". The installed list lets you enable, disable, remove and open extension options. You can also open Chromium's native extension management or the extension store. Install and enable or disable state is saved with the current Cage environment, and it stays after a restart.

Click "Import from this computer", choose the user profile of Edge, Chrome, Brave or Chromium, check the list, then import the extensions you pick. If the original enabled state can be read, it is imported as is. If not, a note is shown and the extension stays disabled. Incompatible or already imported extensions are marked separately. Failed items show the reason, without affecting the results of the others. When done, click "Done and close" to return to the installed list.

After importing, the two are managed separately. Accounts, cookies, extension sign-in data and native companion programs from your local browser are not included in the package, so some extensions may need you to sign in again or set them up. Some extensions depend on browser-specific features or permissions, so compatibility is judged by how the extension actually runs in Cage. For details, see [Browser settings and extensions](guide/browser.md).

### Incognito browsing and cookies

Click "Browser menu" on the right of the address bar and choose "New incognito tab". You can also press ⌘⇧N on macOS, or Ctrl+Shift+N on Windows and Linux. Incognito tabs show "Incognito" in the title and address bar. Clicking the plus button on the tab bar, or pressing the new web page shortcut on an incognito page, creates another incognito tab. To go back to normal browsing, choose "New regular tab" from the menu.

Cookies, sign-in state and site storage for regular and incognito web pages are kept separate. Incognito tabs share a temporary session. The session is cleared after you close the last incognito tab. Restarting the environment does not restore incognito pages. Incognito pages do not prompt you to save passwords, and tab renames and order are not written to local persistent storage. Downloaded files and bookmarks you saved are kept. Closing or hiding the Cage window only keeps the background browser running. To end an incognito session, close all incognito tabs or stop the environment. Incognito browsing still uses Cage's network exit, so websites and proxy services can still recognize the requests. Incognito pages can be split with a terminal, but split view of two web pages currently supports regular tabs only.

Choose "Manage cookies" in the browser menu to see cookies for the current site, or switch to "All sites". The list lets you search by site or name, view values, delete single cookies, and clear cookies for the current site or for all sites in the current session. Each action only affects the regular or incognito session of the current tab. Clearing applies to all results, regardless of the search filter, and you must confirm it. Afterward, a site may ask you to sign in again. Clearing all cookies in a regular session also clears file editor sign-in, which you can restore with "Restore editor" in the editor menu. Clearing cookies keeps other site storage, such as localStorage.

### Browser uploads and downloads

When you click upload on a web page, the workbench shows "Upload local file". Click "Choose local file" to pick images, videos or documents in the system file window. Transfer status appears in the panel. Only the files you choose are sent, and no folder is shared. If the web page allows multiple selection, you can choose up to 100 files, each up to 2 GB. The target site's own format and size limits still apply. You can cancel an upload. If you refresh or close the original web page, you need to choose the files again. Claude Desktop file uploads also use this local picker. If a guest file window still appears, save and close Claude Desktop, then open it again. When you pick a working folder on the Code page of Claude Desktop, Cage shows "Choose a working project". The list matches the project list on the left. Select an existing project and click "Use this project". For a new folder, "Add a local project…" opens the system window. After you confirm, it is added to the Cage project list and handed to Claude. Choosing a project in Claude does not switch Cage's current project or existing terminals. Changes in that folder sync to this computer.

网页下载仍在 Cage 内完成。本机先收到下载暂存目录中的完整文件，同名文件自动换名。工作台连接期间观察到下载完成后，会弹出系统“另存为”窗口；取消时保留默认位置的文件。共享目录暂时不可写而客机文件已完整下载时，也可以从下载列表直接另存为。

左侧“下载”入口和地址栏旁的下载按钮都可查看进度、文件名和保存位置，并提供“打开文件”“在文件夹中显示”“另存为”。已记录的本机文件在停止环境后仍能查看；再次打开 Cage 也保留保存位置。下载暂存目录通常为 `~/.claude-cage-downloads/Downloads/`，无需添加项目即可下载。使用普通浏览器打开工作台时，导出由该浏览器的下载功能处理。

Desktop file operations on the host only accept files in authorized projects or in saved download records. A generated document must be saved first. Linux guests keep using the existing file entry point. Native saving and file opening on macOS and Windows are connected, but uploads, saves, opening and locating files in the full official app still need hands-on testing. For other folders, first grant access explicitly with "Add a local project…". After an update, close and reopen Desktop. For the current conditions and recovery steps, see [Claude Desktop](guide/desktop.md#choose-a-project-and-transfer-files).

### Closing, quitting and reopening

| Action | What happens |
|---|---|
| Close the window | The environment and background terminals keep running. |
| Quit and keep the environment | Background tasks keep running. The app reconnects the next time you open it. |
| Stop the environment, or stop it and quit | Terminal processes end. Project files, the virtual disk and sign-in state are kept. |
| Refresh the workbench | Reconnects to terminals that are still running in the control service. |
| Restart the control service or VM | Old terminal sessions can't be restored. Create new terminals. |

Save changes in the editor before you stop the environment. When you open Cage again, it uses the same environment, so you don't need to import projects again or recreate the virtual disk.

When you switch to a terminal or the settings page, or hide or minimize the window, Cage pauses the browser view's display connection. Web pages, downloads and background tasks are kept. The view reconnects automatically when it is visible again. This display-saving behavior does not mean the browser is paused or the environment is stopped.

### Keys and clipboard

"Settings → General" lets you choose a keyboard style. Mac mode maps shortcuts such as `⌘F`, `⌘Z` and `⌘⇧Z` in web pages and the editor to the matching Ctrl combinations on Linux. The address bar and settings inputs on this computer keep Mac shortcuts. In the terminal, `Ctrl+C` interrupts a command, and `⌘C` copies selected text.

Windows and Linux use the Ctrl keyboard style by default. `⌘` in workbench shortcuts maps to `Ctrl`. Terminal copy and paste use `Ctrl+Shift+C/V`, and `Ctrl+C` still interrupts commands.

In multi-line input in Claude Desktop, Claude Code and regular terminals, press `Shift+Enter` to start a new line within the current input, and press `Enter` to submit a message or run a command. The target input box in web pages and Desktop must support multiple lines. Terminal programs must support multi-line paste or recognize Shift+Enter. When multi-line paste is on in Bash or zsh, line breaks don't run commands that are already written. If you turn this mode off yourself, or use another terminal program, the behavior depends on that program's key support. While a Chinese input method is still choosing candidates, Enter is handled by the input method first.

Copy and paste support plain text, Chinese, multiple lines and emoji. Click the target input box first, then use the shortcut or toolbar button. If a regular browser limits clipboard access, use the "Text transfer" panel. Cage only accesses the clipboard on this computer when you copy or paste, and does not keep polling it.

The copy button on web pages in the Cage browser can also sync plain text to this computer. After you click it, keep the current web page and Cage window in front. When "Copied to this computer" appears, you can paste into other apps. If the web page uses an unsupported old copy method, or you switch tabs, input position or windows during copying, copy again, or use the copy shortcut and the "Text transfer" panel.

Screenshots from this computer can be pasted into Cage. You can drag video, document and image files directly into the work area, or copy them in the file manager on this computer and paste them into Cage. Files keep their original names and contents, including GIF animations. Each file can be up to 2 GB, and you can send up to 100 at a time. Dragging into a web page goes to the drop target, and pasting files goes to the current input position. The target web page must support attachment drag-and-drop. In Claude Desktop, first click an input that accepts attachments. In the terminal, files are saved to the guest attachments folder and inserted as quoted paths, so Claude Code and other tools can read them. No command runs automatically.

Screenshot pastes are limited to 20 MB and 40 megapixels. Cage passes attachments through the control channel between this computer and the guest, without any external storage service. The target web page or app can upload them however it normally does. Terminal attachments stay until you delete them. Desktop upload copies stay until the graphics session is rebuilt. If you switch targets or disconnect, unsent input is canceled. If you use an older environment, first update its components as the app prompts.

### Appearance and browser home page

"Settings → Appearance" lets you follow the system theme or use a fixed light or dark theme. Basic colors let you adjust the accent, background and text. Expand "Customize" for each theme to adjust the sidebar, toolbar, titles, secondary text, borders, inputs, buttons, links, focus, hover, selection and status colors separately. The terminal's background, text, cursor, selection and ANSI palette can also be set separately. Web pages and editors inside the VM keep their own appearance settings.

The preset dropdown for each theme is grouped into "Classic", "Editor", "Reading" and "Accessibility". It has 14 families and 22 light and dark pairings. Options include Codex, Solarized, Ayu, VS Code Modern / Classic, GitHub, Nord, Dracula, Monokai, and paper white, warm paper and night styles inspired by Typora. Some themes come only in a light or dark version, and the dropdown shows only the versions available for the current mode. Choosing a preset applies both interface and terminal colors. It replaces earlier element color overrides and keeps your font settings. Saved custom themes are not changed.

"Accessibility → Color-blind friendly · Blue and orange" uses blue and orange to tell success and error apart, which reduces reliance on red and green. "High contrast" offers black-on-white and white-on-black pairings, with stronger borders and focus outlines. Both presets turn off the translucent sidebar to keep contrast stable. Success, warning and error previews on cards, which have icons and text, help you compare status colors. Suitable palettes vary between people with different color vision. You can keep customizing and save a theme separately. These colors affect the Cage interface and the built-in terminal. Web pages and editors in the VM keep their own appearance.

Colors support a color picker and six-digit HEX input. HEX input takes effect when you press Enter or leave the input box. Next to a color you set separately, you can restore automatic coloring. Font, text size, contrast, pointer and motion effects are also adjusted here. Changes apply immediately and save automatically. If saving fails, your current input is kept, and you can click "Retry save".

In "My themes", enter a name and click "Save as theme". This saves the light and dark color sets, font and sidebar transparency as one theme. The dropdown switches themes. After you change a theme, you can click "Update this theme", save it under a new name, or click "Restore saved palette" to discard these color changes. Deleting a theme keeps the current colors. You can save up to 50 custom themes.

"Export theme" saves the current light and dark settings as a `.cage-theme.json` file. "Import theme" checks the file, then adds and applies it. If a theme with the same name already exists, the imported one is saved as a new theme, and existing themes are not overwritten. The desktop version reads and writes files through the system file window. The browser version uses file selection and downloads. Theme files do not include accounts, proxies, projects or local paths. The light/dark switching mode, text size and interaction preferences are not moved with the theme file. A file must be a Cage JSON theme of up to 256 KB. If the format version is unsupported or the content is invalid, the current settings are kept.

"Sync from local Codex" copies Codex's current appearance preferences. The copy is saved separately after import, and your saved custom themes in Cage are kept.

"Settings → New tab" in the browser's "…" menu controls the default address for new web pages. It starts as Bing. It takes effect the next time you open a web page after saving. No environment restart is needed.

### Compute resource limits

“设置 → 环境与恢复 → 计算资源”默认自动设置上限：取主机份额与 8 GiB 中较小者（主机份额默认为主机内存的一半）；手动指定时仍可调至完整主机份额。关闭“自动分配资源上限”后，可分别指定内存 GiB 和 CPU 逻辑核心数，可填范围显示在输入框下方。点击“保存资源配置”后，下次启动环境时生效；运行中可点击“重启并应用已保存配置”，请先保存工作，重启会结束正在运行的命令。内存仍会在指定上限内按需增长和回收。macOS、Windows 和 Linux 操作一致；服务器容器资源由服务器部署配置管理。

### Time zone, language and exit changes

New users have time zone and language following the exit IP turned on by default. Automatic time zone checks the exit location through the proxy and uses the IANA time zone it returns. It syncs when you save and at the next start after stopping. If the location service is unavailable, an error is shown, and the host's location is not used instead. IP geolocation depends on an external database, so it cannot guarantee a node's physical location.

Language can follow the exit region separately, or be chosen manually. Automatic mode uses built-in regional defaults. For regions with several languages, you can adjust the choice yourself. For unknown regions, the current language is kept.

"Settings → IP change rules" supports a static IP, or a dynamic IP within the same city, the same state or province, the same country or region, or any region. A city rule checks the country, state or province, and city together. For how rules are tied to the final exit node, the first binding and what happens on switching, see [Time zone, language and exit rules](guide/network.md#time-zone-language-and-exit-rules). An existing baseline for the same node only changes when you explicitly edit it. A recheck does not accept a new exit automatically.

### Check, pause and restore network access

Click the network status at the bottom to view evidence, recheck, or pause internet access. Pausing cuts existing external connections, while the terminal and files still work offline. Third-party IP reputation is only a hint and does not decide connectivity on its own. Community check websites open only when you open them yourself.

A manual pause is saved. It stays paused after you close and reopen the backend service, and regular subscription refreshes do not restore it. If an older config has no pause record, or the record is damaged, Cage keeps internet access off by default. After you confirm, you can restore access by starting the environment, rechecking, or applying the network config manually. If a notice says the state couldn't be saved, internet access is still turned off. Fix the config write problem, then try again.

In the background, Cage checks the exit and environment config about every 30 seconds, and pauses internet access if a rule is broken. Each internet access allowance lasts up to 90 seconds. If the control service loses contact, it expires and turns off. A full report is valid for up to 24 hours and must be rechecked after that. HTTP/SOCKS5 proxies may assign different exits per connection, so sample checks cannot prove that every connection uses the same IP. A fixed exit still depends on the proxy service itself.

## Network and data boundaries

Cage uses a lightweight Linux VM without a full desktop. Browser and editor pages run inside the VM. The workbench on this computer shows the display and terminal. Chromium runs as a regular user and keeps its own sandbox.

- Outbound TCP from the host-side virtual network interface always goes to the proxy you chose, with no direct fallback. DNS goes through the same proxy as DoH. If the proxy fails, DNS does not fall back to the host's DNS.
- Guest public IPv6, regular UDP, ICMP, and direct connections to the host and LAN are restricted. Public outbound currently supports IPv4 TCP only. SSH management, shared files and local display use explicit internal channels. After you turn on a [Tailscale private network](guide/tailscale.md), connections can run both ways, based on device and SSH permissions. The outer traffic is still subject to the proxy and pause controls.
- Proxy credentials are stored in the host's private config and are not passed to the guest. Terminal SSH disables local escape sequences, local commands, proxy forwarding and interactive passwords, and does not inherit host environment variables.
- The workbench only listens on local loopback. The app exchanges for a session automatically. The interface checks Host, Origin and the session, so external web pages cannot call management actions directly.
- 明确打开的项目目录及下载暂存目录会共享到同一环境，彼此可以访问。修改、删除共享文件会影响主机，请保留备份。不要把 Cage 私有配置目录或正在运行的控制程序作为共享项目。

Network limits are enforced outside the VM, so sudo in the guest cannot turn them off directly. This boundary cannot stop VM or browser vulnerabilities, changes to the configuration by a host administrator, or running scripts from a shared project on the host. Cage does not predict account bans or promise to avoid restrictions. Image-based sharing and system clock spoofing are not available yet.

### Play sound from the environment

When you play video or audio in the Cage browser, sound comes out of the speakers or headphones currently used by this computer. Click the speaker button at the bottom to open the volume slider, which controls the volume for the whole Cage environment. While it's open, click the speaker again to mute or unmute. When the mouse leaves the control, the slider closes automatically. Claude Desktop and terminal programs share this control. If playback is blocked, click the page to continue playing.

Switching tabs or projects does not stop sound. Muting, stopping the environment, locking the Cage account or quitting the app disconnects playback. When you unmute, the current content plays, and sound missed during the interruption is not replayed. Older environments need their components updated the first time you use this. This feature provides sound output only, not microphone input on this computer.

## Upgrading and uninstalling

The installer replacement and uninstall steps in this section apply to macOS. Windows users, see [Windows update and uninstall](windows.md#updates-and-uninstalling). Linux users, see [Linux update and uninstall](linux.md#updates-and-uninstalling). Linux updates are done manually with the system installer package. Environment components and tools are still updated in the workbench settings shared by all platforms.

For a first install, download the DMG from the public release. In-app updates are used for later version upgrades.

Installing, reinstalling, updating and uninstalling all keep personal data. On macOS, Windows and Linux, the default location is `~/.claude-cage/` in your home folder. Local accounts, bookmarks and settings are stored there. Browser history, website sign-in state and files inside the environment are stored on the persistent virtual disk in that folder. Moving the app to a different install location does not change the default data folder. If you set another config with `CLAUDE_CAGE_CONFIG`, always use the same config. Temporary terminal window output and running processes are not part of the disk backup.

If you created an account before but see the create-account page again, first check the folder under [Account and data folder check](troubleshooting.md#existing-account-shows-the-create-account-page-again). Do not create a new account or delete the old config.

The app checks for updates automatically after it starts, and rechecks every six hours while it runs. After a normal check fails, it retries every five minutes. If the update source asks for a wait, it retries at the time it specifies. Checks pause while the window is hidden. If there is no new version, no update entry is shown. When a new version is available, a gold round download button appears at the bottom left. Save your files and end running tasks first, then click it once. The button shows circular download progress and a percentage. After the download is verified, the environment stops automatically, the update is installed, and the app restarts. No confirmation dialog appears. Updating ends the workbench terminals, but keeps projects, config, the virtual disk and sign-in state. If it fails, the reason is shown. Click the same button to retry. While rate-limit waiting is in progress, the button is disabled, and hovering shows the earliest retry time.

Public macOS versions `0.1.3-alpha.1` and earlier have a local update verification bug. If you see "Local update verification did not complete", save your files, stop the environment and quit Cage. Then download the DMG for `0.1.3-alpha.2` or later from the official Release and replace the app once. Your existing projects and data are kept. After the fixed version, you can use in-app updates.

Checks and downloads use the proxy you selected, which must already be applied and running. If it fails, Cage does not fall back to a direct host connection. Automatic installation requires the current app and the new app to use a Developer ID signature from the same publisher, and the new package must pass Apple verification. Ad-hoc development builds cannot be installed automatically. The updater uses the public GitHub Releases API. It does not need a GitHub sign-in and does not read browser sessions. If the update source is unreachable, first confirm the selected proxy works, then check that the Release is still public and has complete attachments. For a manual download, use the same public Release. For the scope of actual installation, restart and recovery testing, see the release notes for that version.

Before you replace the app manually, save your files and choose "Stop environment and quit". The new app checks the backend version. If you see "update pending", first open the existing environment and save your files, then choose "Save, stop environment, and update". For compatibility and special migration requirements between pre-release versions, see the release notes for that version.

"Settings → Environment and recovery" provides separate updates for environment components and tools, and shows the actual versions. Updating components restarts the browser and editor, and keeps the VM, the disk and the workbench's own terminals. Integrated terminals in the editor may end, so save content before you start. Dependency installs and tool updates use the proxy you selected, and don't need business internet access to be allowed first. Tool updates use the minimum version the current app specifies. A manual internet pause is not lifted by an update. Replacing the app does not mean all Linux tools have been upgraded.

卸载应用前也应先停止环境并退出，再将 Cage.app 移到废纸篓。删除 App 不会自动删除共享项目、下载暂存、代理配置或虚拟磁盘。需要清理这些数据时，先备份：私有状态默认在 `~/.claude-cage/`，下载暂存通常在 `~/.claude-cage-downloads/Downloads/`；原 `~/.claude-cage-workspace/` 中的个人文件也保留，自行打开的项目仍在原目录。删除虚拟磁盘会丢失只存在于客机中的文件和登录状态。

Next: [Troubleshooting and recovery](troubleshooting.md)
