---
title: Claude Desktop
description: Install the official desktop app inside Cage as needed, adjust the display, pass projects and attachments, and work around common limits.
group: Daily use
order: 6
keywords: Desktop Chat Code Cowork image quality zoom install display size upload
---
## Install and sign in

Claude Desktop runs in the guest you choose, using the official app for that system: the Mac version in a macOS guest, the Windows version in a Windows guest, and the Linux version in a Debian environment. The workbench provides one set of install, open, show and close controls, and app data stays in the guest. For how systems map between the guest and the host, see [Choose a guest system](guest-systems.md).

In the sidebar, click "Claude Desktop" and choose "Download and install" the first time. Start the environment and confirm the proxy works first. Cage installs from Anthropic's official source. If the download fails, you can check progress and retry. Install and maintenance downloads can run before internet access is allowed, but network access from inside the app still requires the critical checks to pass.

The first sign-in is completed inside Cage, and Desktop accounts on the host are not imported. Sign-in and external web pages open in the Cage browser, and after the callback completes you return to Desktop. If it stays in the browser, go back to the app entry in the sidebar to check.

Chat and Code run in the same official app. Cowork, which needs an extra virtual machine, is not supported yet. A phone can pick up the same Desktop window on your computer, and both ends share the account and app data. See [Use Claude Desktop from your phone](mobile.md#use-claude-desktop-from-your-phone).

<figure class="guide-shot">
  <a href="../../www/public/docs/screenshots/cloud-desktop-welcome.png" target="_blank" rel="noopener" aria-label="View original: Claude Desktop welcome page in a cloud Linux environment"><img src="../../www/public/docs/screenshots/cloud-desktop-welcome.png" alt="Claude Desktop welcome page in a cloud Linux environment" width="1192" height="875" loading="lazy" decoding="async" /></a>
  <figcaption>Claude Desktop welcome page in a cloud Linux environment. Screenshot version: Claude Desktop 4.16336.0 · real Linux cloud environment · 2026-11-06 · Cage version not recorded; not signed in to Claude. <a href="../../www/public/docs/screenshots/cloud-desktop-welcome.png" target="_blank" rel="noopener">View original (1192 × 875) ↗</a></figcaption>
</figure>

## Adjust text and display

"Display size" in the upper-right corner defaults to 100%. Lower it to show more content, or raise it to enlarge text and controls. The picture adapts automatically when the window or sidebar changes, and the setting is saved on this computer. If you see "The view size could not be synced", click "Retry resizing".

On Linux environments, the Desktop picture automatically lowers its refresh rate when nobody is interacting, and returns to 120 Hz as soon as you act. Sharpness stays the same. The picture renders at the pixel density of the screen it is on. Adjusting "Display size" only changes the size of text and controls, not the number of picture pixels. For details, see [Browser notes](browser.md#open-web-pages-and-browser-settings).

滚动卡顿时到“设置 → 通用”开启“优先流畅”，保存并在下次启动环境后生效。它在高分屏上降低绘图像素密度，控件逻辑大小保留。Linux 环境同时让 Claude Desktop 减少动效：动画播放期间应用每一帧都会重绘整块消息区域，关掉后画面只在内容变化时更新。性能还受主机 CPU、内存以及远程网络影响。

## Copy and paste

When using a Linux guest, the Cage desktop app shares the clipboard between this computer, the Cage browser and Claude Desktop while the environment runs. Click the copy button on a Claude message, or select text and press the copy shortcut, and you can paste it directly into apps on this computer. Text, images, files and folders copied on this computer can also be pasted inside Cage. Syncing continues after you switch to another view or local window. Locking the account, switching environments or leaving the workbench ends the old connection.

Text is limited to 2 MB, and images to 20 MB and 40 million pixels. You can select up to 100 files or folders at once, and each regular file can be up to 2 GB. File transfer keeps original names and folder structure, and source files are kept. Cutting a file across environments is treated as copying. Receiving files or images still requires the target app to support that kind of paste. Regular web entries are limited by browser permissions. If automatic sharing is not possible, use the existing copy, paste and text transfer entries.

## Choose a project and transfer files

When Desktop Code asks to choose a directory, Cage shows "Choose a working project". Select an authorized project and click "Use this project", or use "Add a local project..." to add a directory explicitly. Project changes apply directly to the shared original files.

When you upload attachments in the web app or Desktop, click "Choose local file" to open the system window. You can also drag files into an area that accepts attachments, or paste after selecting the attachment input. For detailed limits on count, size and retention, see [Uploads and attachments](workbench.md#uploads-downloads-and-attachments).

In local mode, opening and locating files only accepts files in authorized projects or in saved download records. Linux guests use the existing host file entry. macOS and Windows already have native save transfer, the system picker and file opening wired up, but the full official Claude upload, save, open and locate flow still needs hands-on verification on real machines. Not every file link in the native app is guaranteed to open the host's default app. If there is no record of a successful save to the host, first check the file and operation details in the guest. Cloud files need to be saved to this computer through the remote download flow.

### Windows 客机：官方 Desktop 提示“Claude 无法打开该文件夹”

Windows 客机通过 WinFsp 与 SSHFS-Win，把已授权项目挂载到客机用户目录下的 `Cage\Projects\<项目编号>`。Cage 的终端和 Claude Code 使用这个挂载目录，可正常读写。

官方 Claude Desktop 的 Code 模式在“新建环境 → 本地”中选择该挂载目录时，可能弹出“Claude 无法打开该文件夹”，并提示可能涉及网络驱动器、虚拟驱动器或访问权限。该对话框出现在客机桌面中，Cage 窗口里的 Desktop 画面可能看起来没有反应，也没有错误提示。目前认为这是 Claude Desktop 对网络或虚拟驱动器目录的限制；Anthropic 的相似报告见 [anthropics/claude-code#91026](https://github.com/anthropics/claude-code/issues/91026)。具体判断规则不在 Cage 控制范围内，尚未确认所有 Desktop 版本均如此。

遇到时可以：

- 在 Cage 的 Claude Code 终端或普通终端中处理共享项目。它们直接使用挂载目录，是 Windows 客机上访问共享项目的受支持入口。
- 需要使用官方 Desktop 的 Code 模式时，在客机本地磁盘上选择文件夹，例如把项目复制到客机用户目录后再打开。这份副本与主机原文件相互独立，改动不会自动回到主机；需要带回时可用 Git 提交推送，或手动复制回主机项目。
- 如果对话框已经弹出而画面不动，先在客机桌面中关闭该对话框，再重新选择文件夹。

Cage 暂时不会把这个客机对话框转成主机提示。反馈问题时请附上 Claude Desktop 版本、选择的路径和诊断包。

## Close, update and recover

切换到终端或浏览器时 Desktop 保持运行。应用上方的“关闭应用”释放其运行资源，登录资料继续保留。

macOS 和 Windows 使用 Claude Desktop 应用内的更新入口，下载完成后可按应用提示重启。macOS 的应用目录由使用账户管理，无需管理员密码；已有环境请先在“设置 → 环境”更新组件，让安装权限与窗口连接组件生效。Windows 沿用官方 MSIX 的自动更新机制，更新后的窗口会重新连接。应用更新不清除登录资料、项目和历史。

Linux 版由 Anthropic 官方 apt 软件源更新，应用内的更新入口可能打开官方说明页。在 Cage 的 Desktop 顶部点击“更新应用”，保存工作后确认，Cage 会关闭应用、安装软件源中的可用版本并重新打开。关闭应用后也可选择“更新 / 修复安装”。需要通过终端操作时，先关闭 Desktop，再在 Cage 终端运行：

```sh
sudo apt update
sudo apt install --only-upgrade claude-desktop
```

安装完成后从侧栏重新打开 Desktop。使用相同软件源重复更新会保留当前已安装版本。Linux 更新方式见 [Anthropic 安装说明](https://support.claude.com/en/articles/10065433-install-claude-desktop)。

Cage creates and unlocks the credentials needed by its internal system keyring, so you do not need to set a separate keyring password. Changing the Cage password keeps Desktop sign-in data.

Desktop's Code authorization is encrypted and stored in the internal system keyring, and keeps working after you close and reopen the app. If an old authorization has expired, you still need to sign in to Desktop once more. When the official service requires reauthorization, the app also shows a sign-in prompt.

After you update Cage or the environment components, save your work, then close and reopen Desktop so that file selection, zoom and other components take effect. If the picture or uploads still misbehave, see [Troubleshooting](troubleshooting.md#browser-desktop-or-file-upload-problems).
