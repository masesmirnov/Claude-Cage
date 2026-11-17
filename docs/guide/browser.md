---
title: Browser and site data
description: Manage web pages, bookmarks, incognito sessions, cookies and extensions, and sign in to websites and preview development sites inside Cage.
group: Daily use
order: 5
keywords: Chromium browser settings incognito cookies extensions plugins ZIP bookmarks new tab vertical tabs privacy
---
## Open web pages and browser settings

Click "Browser" in the sidebar, enter a site in the address bar, and use the plus button at the top to open a new page. The `claude.ai` entry opens the Claude website directly. `localhost` refers to the current Cage guest, so start preview servers from the Cage terminal.

**macOS 客机**会在工作台内显示 Google Chrome 的完整窗口。用 Chrome 自带的地址栏、标签页和菜单浏览、收藏或登录网站。更新环境组件后，Chrome 继续使用客机内原有的浏览器资料。以前保存在 Cage 的网页可从窗口上方的“收藏夹”打开。要使用 Cage 保险箱里已有的密码，在设置里打开密码保险箱，验证后复制到 Chrome。通过 Claude Code 发起账号授权时，会另外打开临时窗口，授权完成或取消后关闭。Claude Desktop 如果调用系统打开外部登录链接，使用的是虚拟 Mac 设置的默认浏览器。

macOS 客机进行完整联网检测时，Chrome 会临时打开检测页，实际读取页面的语言、时区和网络出口。日常使用可以关闭检测页。后台核对浏览器进程和资料设置。如果 Chrome 重启或设置变化，请按提示重新检测。

以下操作适用于使用 Cage 地址栏的客机。地址栏右侧的浏览器菜单提供设置、无痕和网站数据等操作。浏览器设置页可搜索“新标签页、外观、隐私与网站数据、扩展、关于浏览器”。新标签默认地址影响之后的新建标签；横排或竖排标签布局立即生效，保存在当前客户端。

Closing the browser view only returns you to the previous workspace, and pages and sign-ins stay open. To end an incognito session, close all incognito tabs or stop the environment.

网页复制同步保留网站原有的剪贴板接口，不向网页主执行环境添加产品标记，也不会为此授予网站额外的剪贴板读取权限。自动同步需要 Chromium 144 或更新版本；旧浏览器仍可正常浏览，需要自动同步时请更新环境工具中的浏览器。

On Linux environments, after the last browser view window leaves, the browser window is minimized so that background pages use Chromium's throttling. When you return to the browser, the original window and unsaved input are restored. When several workbenches view it at once, windows still being viewed keep displaying. Mobile browsers have their own sessions.

On Linux environments, the refresh rate of the browser and Claude Desktop adjusts to how you use them. It stays at 60 Hz in the browser and 120 Hz in Claude Desktop while you use them, and drops to 20 Hz after about 3 minutes of inactivity. It returns to full rate as soon as you act again. Resolution, font size and sharpness stay the same. Web animations and videos play at a lower frame rate when nobody is interacting. This feature is enabled by environment component updates and requires `python3-xlib` in the environment. Environments with Claude Desktop installed get it immediately. Environments that only use the browser get it after the next environment tools update.

On Linux environments, the browser and Claude Desktop render at the density of the screen that shows them. On a 2x high-DPI screen, each pixel of the picture maps to one screen pixel. On a regular screen at 100% scaling, only a quarter of the pixels are rendered, and text is equally pixel-sharp. When you move the window to another screen or change system scaling, the picture redraws at the new density, while font size and visible content stay the same. Screens above 2x render at 2x.

New setups turn on "Settings → General → Prefer smoothness" by default. On high-DPI screens it renders at three quarters of the screen pixels, which cuts the pixel count on a 2x screen by about 44%. Regular screens already use the fewest pixels, so they do not change. Turn it off if you need finer detail. The setting takes effect the next time you start the environment. Existing setups keep their original quality.

Rendering at the screen's density is enabled by environment component updates and requires `xsettingsd` in the environment. Environments with Claude Desktop installed get it immediately. Environments that only use the browser get it after the next environment tools update. Until then, and on Windows guests, the picture keeps rendering at a fixed 1.5x or 2x.

Linux 环境的浏览器按触控板滑动的实际距离滚动：网页跟随手指移动，停手即停，不再按固定步长追赶和滑过头。带刻度的鼠标滚轮保留逐格滚动和网页自带的平滑动画；macOS 已经把滚轮刻度换算成距离，因此同样按距离滚动。指针位于下拉列表或菜单上、使用分屏或打开了开发者工具时，以及按住 Ctrl、Shift 等修饰键滚动时，继续使用原有的逐格方式。此行为随环境组件更新启用，旧组件保持逐格滚动。

In macOS and Windows guests, the browser scrolls by the actual distance of the wheel or trackpad. While you scroll, the picture updates at up to 60 Hz. About 1 second after you stop, it returns to 30 Hz, and when still, it slows frame updates further. This behavior takes effect after the guest components are updated. Older components keep scrolling in fixed steps.

地址栏右侧的下载按钮在右上角展开文件列表，可查看下载进度、另存为、打开文件或在文件夹中显示；保存失败时可重试。长列表在面板内滚动，点击外部或按 Esc 收起。

Under "Privacy and site data" in the browser settings, you can also find "Site permissions" and "Clear browsing data", which open the matching Chromium pages. Decide on permissions such as camera and microphone based on the devices the environment actually has. "Search engine" and "Download settings" under "About browser" open more native browser options. Seeing these options does not mean Cage has connected every device capability.

## Bookmarks and tabs

Click the star in the address bar, or press `⌘D` on a Mac, to bookmark the current page. Edit its name and choose or create a folder. The bookmarks button or `⌘⇧O` opens management, where you can search, open, rename and move bookmarks. On Windows and Linux, use Ctrl instead.

Deleting a folder moves its pages to "Uncategorized". Bookmarks belong to the current Cage configuration and are shared by all projects, so switching projects does not remove them.

Right-click a tab or press Shift+F10 to open its action menu, and drag tabs to change their order. When the list is long, you can search open pages. Pinned tabs are sorted within their own group.

## Use incognito sessions

Choose "New incognito tab" from the menu, or press `⌘⇧N` on a Mac or `Ctrl+Shift+N` on Windows and Linux. Incognito tabs and the address bar are clearly marked. The plus button on an incognito page keeps opening incognito tabs. To open a regular page, choose it from the menu.

Cookies, sign-ins and site storage for regular and incognito sessions are kept separate. All incognito tabs from the same batch share one temporary session. Closing the last incognito page clears that session, and restarting does not restore those tabs. Incognito never offers to save passwords, but bookmarks and downloads you save on purpose are kept.

Incognito sessions still use the same proxy exit, so websites and the proxy service can still see requests. Hiding a window does not end a background incognito process.

## View and clear cookies

Open "Manage cookies" from the browser menu to view cookies for the current site or all sites. Search by site or name. You can view values, delete a single cookie, or clear all cookies for the current site or the current session.

Clearing only affects the regular or incognito session that the current tab belongs to. **A search filter does not narrow what gets cleared.** Check the site and session before you confirm. You may need to sign in again after clearing. Clearing cookies does not also delete the site's localStorage.

Clearing all cookies in the regular session also clears the file editor's authentication. Use "Restore editor" in the editor menu to get back in.

## Install or import extensions

In the browser settings under "Extensions", import a Manifest V3 ZIP. Each package is limited to 32 MB. Read the permissions the interface lists before you confirm the install. Install only from trusted sources, since an extension can read the web page content it is allowed to access.

The desktop app can copy extensions and their on/off state from Edge, Chrome, Brave or Chromium on this computer. Importing does not copy browser accounts, cookies or an extension's own sign-in data. Some extensions whose IDs change need to be set up again. Extensions run in the Cage browser, so your local browser's environment and network do not move with them.

If an older environment lacks the entry point or shows an error about installation components, update the app and environment components first, then reopen the browser.

<figure class="guide-shot">
  <a href="../../www/public/docs/screenshots/password-vault.jpg" target="_blank" rel="noopener" aria-label="View original: password vault management entry"><img src="../../www/public/docs/screenshots/password-vault.jpg" alt="Password vault management entry" width="2560" height="1764" loading="lazy" decoding="async" /></a>
  <figcaption>Password vault management entry. Screenshot version: 0.1.7-rc.1 (development build) · UI test stand on Windows 11 x64 · 2026-11-11. <a href="../../www/public/docs/screenshots/password-vault.jpg" target="_blank" rel="noopener">View original (2560 × 1764) ↗</a></figcaption>
</figure>

## Save website passwords

After you finish signing in to a website, choose "Save password" or "Update password" in the tools area. On your next visit, expand "Password", pick an account to fill in, and then submit the sign-in yourself.

"Settings → Password vault" lets you search, add manually, edit, delete and restore website prompts. To view or copy a password, you must enter your Cage password again. For supported scopes and backup requirements, see [Settings reference](settings.md#password-vault).
