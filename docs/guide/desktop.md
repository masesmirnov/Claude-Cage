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

On Linux environments, the Desktop picture automatically lowers its refresh rate when nobody is interacting, and returns to 60 Hz as soon as you act. Sharpness stays the same. The picture renders at the pixel density of the screen it is on. Adjusting "Display size" only changes the size of text and controls, not the number of picture pixels. For details, see [Browser notes](browser.md#open-web-pages-and-browser-settings).

If scrolling feels choppy, go to "Settings → General" and turn on "Prefer smoothness". It takes effect after you save and start the environment next time. It lowers the drawing pixel density on high-DPI screens, and the logical size of controls stays the same. Performance also depends on the host CPU, memory and remote network.

## Copy and paste

When using a Linux guest, the Cage desktop app shares the clipboard between this computer, the Cage browser and Claude Desktop while the environment runs. Click the copy button on a Claude message, or select text and press the copy shortcut, and you can paste it directly into apps on this computer. Text, images, files and folders copied on this computer can also be pasted inside Cage. Syncing continues after you switch to another view or local window. Locking the account, switching environments or leaving the workbench ends the old connection.

Text is limited to 2 MB, and images to 20 MB and 40 million pixels. You can select up to 100 files or folders at once, and each regular file can be up to 2 GB. File transfer keeps original names and folder structure, and source files are kept. Cutting a file across environments is treated as copying. Receiving files or images still requires the target app to support that kind of paste. Regular web entries are limited by browser permissions. If automatic sharing is not possible, use the existing copy, paste and text transfer entries.

## Choose a project and transfer files

When Desktop Code asks to choose a directory, Cage shows "Choose a working project". Select an authorized project and click "Use this project", or use "Add a local project..." to add a directory explicitly. Project changes apply directly to the shared original files.

When you upload attachments in the web app or Desktop, click "Choose local file" to open the system window. You can also drag files into an area that accepts attachments, or paste after selecting the attachment input. For detailed limits on count, size and retention, see [Uploads and attachments](workbench.md#uploads-downloads-and-attachments).

In local mode, opening and locating files only accepts files in authorized projects or in saved download records. Linux guests use the existing host file entry. macOS and Windows already have native save transfer, the system picker and file opening wired up, but the full official Claude upload, save, open and locate flow still needs hands-on verification on real machines. Not every file link in the native app is guaranteed to open the host's default app. If there is no record of a successful save to the host, first check the file and operation details in the guest. Cloud files need to be saved to this computer through the remote download flow.

## Close, update and recover

Desktop keeps running when you switch to the terminal or browser. "Close app" at the top of the app frees its runtime resources and keeps sign-in data. After closing, you can choose "Update / repair install".

Cage creates and unlocks the credentials needed by its internal system keyring, so you do not need to set a separate keyring password. Changing the Cage password keeps Desktop sign-in data.

Desktop's Code authorization is encrypted and stored in the internal system keyring, and keeps working after you close and reopen the app. If an old authorization has expired, you still need to sign in to Desktop once more. When the official service requires reauthorization, the app also shows a sign-in prompt.

After you update Cage or the environment components, save your work, then close and reopen Desktop so that file selection, zoom and other components take effect. If the picture or uploads still misbehave, see [Troubleshooting](troubleshooting.md#browser-desktop-or-file-upload-problems).
