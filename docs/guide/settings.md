---
title: Settings reference
description: Find each feature in the settings menu, and understand the difference between saving, restarting, account ownership and settings that apply only to the current client.
group: Settings and maintenance
order: 9
keywords: settings account vault remember sign-in Touch ID theme appearance font accessibility smooth image quality time zone language
---
## Open settings and save

Click "Settings" in the avatar menu in the lower-left corner. Network and system configuration changes are applied with "Save settings" on the page. When a restart is needed, you are reminded to save your files first, because restarting ends terminal commands. Proxy nodes are applied separately with "Apply proxy".

Appearance changes take effect immediately and are saved automatically. If saving fails, click "Retry save". Keyboard and layout preferences on a remote client are saved on the current computer and do not change the server's runtime environment.

## Settings menu overview

| Entry | What you can set | When it takes effect |
| --- | --- | --- |
| Account | Avatar, username, password, remember sign-in and Touch ID where supported | Saved on the account page; verification is still needed after locking |
| Password vault | Website accounts, password records and save prompts | Takes effect after a record is changed; viewing or copying requires verification |
| General | Time format, keyboard conventions, Claude terminal start command, browser default site, smooth picture, project file cache | The time format takes effect after saving; other items as described |
| Appearance | Light and dark theme, colors, font, font size, terminal and interaction preferences | Previewed immediately and saved automatically |
| Remote connection | Phone pairing for this computer, remote browser authorization, official or self-hosted relay | Takes effect after saving; relay migration requires pairing again |
| Network and proxy | Sources, nodes, proxy chains, DNS, exit rules and core diagnostics | Apply proxy or save; some changes need a restart |
| Time zone and language | Automatically follow the exit, or set the system and browser language manually | Apply, then restart as prompted |
| Environment and recovery | Storage, resources, component tool versions, read-only inventory, cache cleanup and restore, configuration recovery, diagnostics | See the [maintenance notes](maintenance.md) for the exact effects |
| About | Software version, build commit, manual check for source and release updates | Results appear after clicking "Check for updates", including prereleases |

Multi-account sign-in, notes, quota checks and scheduling for Claude Code are in "Claude accounts" in the sidebar; see [Multiple accounts and quotas](accounts.md). Assignment options affect new Claude terminals.

<figure class="guide-shot">
  <a href="../../www/public/docs/screenshots/account-settings.jpg" target="_blank" rel="noopener" aria-label="View original: account profile, password and sign-in unlock settings"><img src="../../www/public/docs/screenshots/account-settings.jpg" alt="Account profile, password and sign-in unlock settings" width="2560" height="1764" loading="lazy" decoding="async" /></a>
  <figcaption>Account profile, password and sign-in unlock settings. Screenshot version: 0.1.7-rc.1 (development build) · UI test stand on Windows 11 x64 · 2026-11-11. <a href="../../www/public/docs/screenshots/account-settings.jpg" target="_blank" rel="noopener">View original (2560 × 1764) ↗</a></figcaption>
</figure>

## About and manual update checks

Open "Settings → About" to see the current software version and build commit. After clicking "Check for updates", the page shows the latest commit on the main branch and the latest public release separately; the release check includes prereleases and offers release notes and download links. The check prefers the host network, following the system proxy and host proxy environment variables; if the host connection fails or times out waiting for a response, it tries Cage's selected proxy if it is applied and running. It can also check through the host network while the Cage environment is stopped. If both routes fail, check again once the network is back.

The source check tells apart up to date, new commits, current build ahead and diverged. If the build did not record a commit, the page says it cannot check; builds with uncommitted changes get an extra note. When the source has new commits, there may not be a matching new installer yet. The manual check only reads update information; to install, go to the releases page and choose the installer for your platform.

When connected to a remote host, "About" shows the local software information. Environment components and tool versions are still shown in "Environment and recovery".

## Account and sign-in

The Cage account unlocks the current environment. In a cloud workbench you change the server account. Remember me and Touch ID, supported on macOS, are bound to the system keychain; after migrating the config folder you may need to authorize again with the original password.

### Save the recovery key

After registering a password account, the recovery key is shown. Copy it to a password manager or download the key file, and continue only after confirming it was saved completely. Anyone with the key can reset the password and access the account data, so keep it safe.

An existing account can set one later in "Settings → Account → Recovery key" by entering the account password and clicking "Generate recovery key". The full key is shown only right after it is generated and is not written to browser storage or diagnostic logs. If you lose the key but still know the password, you can generate a new one in the same place; the old key stops working at once. A regular password change does not change the recovery key.

### Forgot password

1. On the sign-in page, click "Forgot password?" and enter the saved recovery key and a new password.
2. After the reset succeeds, save the newly generated recovery key; the old password and the old recovery key stop working.
3. Go back to the sign-in page and enter with the new password. Cage's "Remember me" and quick unlock authorizations are turned off; turn them on again if needed.

Recovery keeps the account, bookmarks, projects, history, password vault, persistent disks and existing Claude sign-ins. The shared macOS password keeps syncing after you sign in and start the environment; if an earlier password change has not finished, the last update is confirmed first, then the new password is synced. The recovery key contains no personal data and does not replace backups of the config folder and persistent disks.

This feature does not rely on an online recovery service. If no recovery key was set before, and the password and all quick unlock methods are unavailable, the encrypted data cannot be recovered for now. Keep the original folder and a full backup, and do not delete account files or rebuild the environment.

"Lock Cage" keeps background tasks running, while "Sign out" stops the environment. The account password is not the password that encrypts the project disk. Do not recreate the account to deal with updates or directory problems.

<figure class="guide-shot">
  <a href="../../www/public/docs/screenshots/password-add.jpg" target="_blank" rel="noopener" aria-label="View original: form for manually adding a website password"><img src="../../www/public/docs/screenshots/password-add.jpg" alt="Form for manually adding a website password" width="2560" height="1764" loading="lazy" decoding="async" /></a>
  <figcaption>Form for manually adding a website password. Screenshot version: 0.1.7-rc.1 (development build) · UI test stand on Windows 11 x64 · 2026-11-11. <a href="../../www/public/docs/screenshots/password-add.jpg" target="_blank" rel="noopener">View original (2560 × 1764) ↗</a></figcaption>
</figure>

## Password vault

After a website sign-in succeeds, choose to save or update. You can also add, search, edit and delete entries manually in the vault, and restore the save prompt for a website. After filling in, you submit the web form yourself. Viewing and copying passwords requires entering your Cage password again.

It currently supports common sign-in forms on top-level HTTPS pages. Embedded frames, CAPTCHAs, passkeys and the like are not handled automatically. Incognito pages do not show save prompts. If an older environment reports that it is unavailable, update the environment components first.

Password records are saved in the current host's Cage configuration and do not sync automatically across devices. The vault for a cloud instance is on the server. When backing up, keep the account file and the password vault together. When Cage is locked, the vault is locked too, and it can also be unlocked along with the sign-in when remember-sign-in unlock is used.

<figure class="guide-shot">
  <a href="../../www/public/docs/screenshots/general-settings.jpg" target="_blank" rel="noopener" aria-label="View original: terminal startup command, image quality and shortcut settings"><img src="../../www/public/docs/screenshots/general-settings.jpg" alt="Terminal startup command, image quality and shortcut settings" width="2560" height="1764" loading="lazy" decoding="async" /></a>
  <figcaption>Terminal startup command, image quality and shortcut settings. Screenshot version: 0.1.7-rc.1 (development build) · UI test stand on Windows 11 x64 · 2026-11-11. <a href="../../www/public/docs/screenshots/general-settings.jpg" target="_blank" rel="noopener">View original (2560 × 1764) ↗</a></figcaption>
</figure>

## General and keyboard

"Time format" controls the clock at the bottom of the workbench and uses the 24-hour format by default; with the 12-hour format, AM/PM tells morning and afternoon apart. It takes effect after clicking "Save settings" and keeps your choice, with no environment restart.

"Claude terminal startup command" applies to newly created Claude terminals, for example `claude --continue`. Saving does not change existing terminals. A custom command must be compatible with the CLI you installed.

"Keyboard habits" decide how the workbench and guest input are mapped. With a Debian guest, Mac mode maps common Command combinations in web pages and the editor to Linux controls. macOS and Windows guests use the keyboard behavior of their own systems. Terminal Ctrl+C still interrupts, and on Windows/Linux terminals, copy and paste use Ctrl+Shift+C/V.

"Browser default site" applies to web pages opened afterwards. "Smooth picture" lowers the drawing density to improve scrolling and takes effect on the next environment start after saving. "Project file cache" only appears in Linux environments and is on by default; see [Open projects and edit files](workbench.md#open-projects-and-edit-files). Changes take effect on the next environment start. The browser's own tab layout and site data are managed in the separate browser settings.

<figure class="guide-shot">
  <a href="../../www/public/docs/screenshots/appearance.jpg" target="_blank" rel="noopener" aria-label="View original: light, dark and custom themes"><img src="../../www/public/docs/screenshots/appearance.jpg" alt="Light, dark and custom themes" width="2560" height="1764" loading="lazy" decoding="async" /></a>
  <figcaption>Light, dark and custom themes. Screenshot version: 0.1.7-rc.1 (development build) · UI test stand on Windows 11 x64 · 2026-11-11. <a href="../../www/public/docs/screenshots/appearance.jpg" target="_blank" rel="noopener">View original (2560 × 1764) ↗</a></figcaption>
</figure>

## Appearance, themes and accessibility

It can follow the system, or be fixed to light or dark. Presets include series for editors, reading and accessibility. Selecting a preset applies interface and terminal colors, keeps the font, and replaces current element color overrides.

Custom settings can adjust the accent color, background, text, sidebar, borders, buttons, focus, status, and the terminal ANSI palette. Fonts, font size, contrast, pointer and motion effects are also adjusted here. The colorblind-friendly blue-orange and high-contrast presets reduce reliance on telling red from green. Check the result together with status icons and text.

"My themes" can save as new, update or restore saved color schemes, up to 50. Import and export use `.cage-theme.json`, which does not include accounts, nodes, projects or local paths. Light/dark switching mode, font size and interaction preferences do not migrate with the theme file. The file limit is 256 KB. If the format is invalid, the current settings are kept.

When supported, you can "Sync from local Codex" to import appearance preferences, and Cage saves them independently after import. Web pages and editors in the virtual environment keep their own themes.

## Time zone, language and remote connection

Automatic time zone and language use the proxy exit for location lookup, and a manual choice is not replaced by the host location. Applying may restart the environment. For details, see [Time zone and exit rules](network.md#time-zone-language-and-exit-rules). On Linux guests, the "System time zone and locale" network check verifies, in addition to variables and configuration files, the actual UTC offset of the process and of the system time zone file. When `/etc/localtime` is a link, its target is verified too. If a file is missing or cannot be read, or the results are inconsistent, internet access stays off, and the check details explain the cause and the differences that were read.

Phone pairing in "Remote connection" applies to this computer's Cage. Switch back to this computer first, then generate a pairing code or remove a paired phone. SSH hosts are managed in the workbench sidebar. The phone relay and the cloud runtime environment are separate services. See [Phone connection](mobile.md) and [Cloud deployment](cloud.md) respectively.
