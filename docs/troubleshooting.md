# Troubleshooting and recovery

Start by finding the symptom you are seeing. After a fix, use the retry, recheck or recovery options on the page first. Deleting the config loses diagnostic clues and may affect the virtual disk, so it is not a routine troubleshooting step.

## Task exits with 137, or internal network drops after heavy tasks

137 usually means the process was forcibly killed. The exit code alone can't show whether memory ran out. Go to "Settings → Environment and recovery → Compute resources" to check the OOM count, memory limit and usage since this environment started. Then export a diagnostic log. If the OOM count went up, the guest killed a process for lack of memory. If it didn't, check for timeouts, task cancellation or other sources of forced termination.

Automatic resource management grows and reclaims memory within the startup capacity. If a running older environment still uses a smaller limit, save your content first, then click "Restart and apply automatic resource settings". The restart stops running commands. When you hit the limit, reduce parallel rendering or build jobs. Automatic management cannot make limited memory handle unlimited work.

Heavy tasks can stop the guest or browser from responding to network checks in time. That makes Cage revoke internal internet access authorization. When the task recovers, a full recheck runs automatically, and access is restored only if all checks pass. A manual pause is not lifted automatically. If the network still does not recover, check the failed items, the selected proxy and the exit rules. Don't assume a host network failure just from the disconnection. For resource metrics and platform scope, see [Maintenance and resources](guide/maintenance.md).

## Download or installation problems

**GitHub shows a 404, or the installer is missing.** The repository and public release attachments don't require repository access. On the [project homepage](https://lee-xeo.github.io/Claude-Cage/#download), click "Download the app" and choose your platform. Check that your network and the link are complete. macOS uses `.dmg`, Windows uses the `.exe` installer, and Debian/Ubuntu Linux uses `.deb`. Source archives in a Release are for development and can't be used as installers. Platforms without a public installer have install and build instructions instead.

**The Mac says the app is damaged, can't be verified, or isn't supported.** Confirm you have Apple Silicon and macOS 14+. Download the complete installer for the matching Release again, and check that Release's signing and notarization notes and checksum files. When you report the problem, keep the system message exactly as shown. Don't hide a release problem by turning off Gatekeeper or removing the quarantine attribute.

**Windows shows an unknown publisher, or Linux won't install.** For the publisher limits and tested scope of unsigned Windows preview builds, see the [Windows guide](windows.md) and the matching release notes. Don't treat it as a signed version. On Linux, first confirm you're using Debian 12 / Ubuntu 24.04 x86_64. Install the `.deb` dependencies through APT, then check KVM permissions as described in the [Linux guide](linux.md).

**The proxy core is missing.** The full app includes Mihomo. Reinstall the full installer for your platform, and don't copy only the command-line files from it. Use the full installer for your platform.

## Existing account shows the create-account page again

The create-account page means the current config folder has no account file. First check whether you started with a different config. On macOS, Windows and Linux, the default is `.claude-cage/config.json` in your home folder. `CLAUDE_CAGE_CONFIG` can point to a different, separate config. If a development start and the installed app use different folders, your original account and data may still be in the original folder.

Keep the current folder and the original folder. Check whether the original folder contains `account.json`, `favorites.json` and `state/`. Don't create a new account, clear the config, or copy only the account file. Browser history, website sign-in state and other environment files also depend on the same virtual disk. Before migrating, save your work, stop both environments and background processes, and make a full backup. The quick sign-in binding in the account file is tied to the original path, so after migration you may need to unlock with the original password and turn quick sign-in on again. If you can't find the original files, restore from a backup and check what deleted them.

## Quick sign-in needs to be turned on again after migration

Quick sign-in credentials are bound to the account's folder. After the folder is moved, if the new path has no matching system keychain record, the sign-in page says the credentials are missing and keeps the password option. The matching switch in "Settings → Account → Sign-in and unlock" shows as off. You can turn it on directly without turning it off first. Credentials and personal data in the original folder stay unchanged.

If you see "The system keychain cannot be checked right now", unlock with your password first. When the system keychain is available again, click "Check quick sign-in again". Failed checks like this keep the authorization record and don't require you to rebuild the account.

## Git check before startup failed

After you click "Start Cage environment", Cage first checks Git on this computer. If Git is not installed, it continues. You don't need to install developer tools to use Cage. If Git is installed, bare repository protection needs to be turned on.

If a dialog shows "Protect Git on this computer before installing", read the impact, then click "Enable protection and continue". The app only sets `git config --global safe.bareRepository explicit` after you confirm, and it starts only after the re-check passes. Commits and pulls in regular projects are not affected. Other Git tools on this computer also use this setting, so bare repositories need to be specified explicitly with `--git-dir`.

| Message | What to do |
|---|---|
| Git version is too old | Upgrade Git on this computer to 2.38 or later, then click "Recheck". |
| Can't check Git right now | Make sure Git is fully installed on this computer. On macOS, you can also check Xcode Command Line Tools, then click "Recheck". Cage doesn't open the installer automatically. |
| Couldn't save the Git safety setting | Check write permissions for the current user's global Git config, close other operations that are changing Git settings, then try again. |
| Setting saved, but the check hasn't passed yet | Check the global Git config for conflicts or overrides, then click "Recheck". |

If you don't want to deal with it now, choose "Not now". Your proxy config is kept.

## First start shows a proxy connection failure

Cage needs its own proxy selected first. On the first home page, click "Set up network and proxy", or go to "Settings → Network and proxy" and confirm that a source is imported, a node is selected and it shows "Applied". Then go back and start. If your browser on this computer can reach the internet, that doesn't mean Cage's proxy is set up. Cage does not automatically use the node your local Clash has selected.

If you haven't imported a source yet, use a local YAML file, or check "Download this subscription over the host network" when you add an HTTPS subscription. Automatic updates always use the current proxy config. If a subscription download fails, it does not silently switch to a direct host connection.

## Browser time zone and language check failed

Click "View checklist" next to the notice, then expand the failed items to see expected and actual values. If the language doesn't match, save your work in the browser and editor, then go to "Settings → Environment and recovery" and update the environment components. The update adds missing Chromium language packs and syncs the browser's preferred language with the saved config. Dependency installs use the restricted channel provided by the selected proxy. Business internet access stays off until critical checks pass, and you don't need to remove network restrictions manually.

If a language pack download fails, check the proxy and operation details, then try again. If it still fails after the update, export a diagnostics bundle and keep the expected and actual values for the failing fields. Don't clear browser data, rebuild the account or keep restarting the environment to get around the check.

## Subscription import fails, or no nodes appear after import

Clash/Mihomo YAML that contains `proxies` or `payload` is supported. Base64 lists, node share links, and configs with only remote providers are not supported formats. Check that you have the node subscription URL. Don't use a website login page as the subscription URL, and don't submit a private subscription to an online converter or to an Issue.

A proxy chain must reference specific nodes from the same source. Selecting groups and DIRECT links is rejected. Protocol-specific fields must also pass validation by the bundled Mihomo core. The error details can help you find missing fields.

## Startup stuck at preparing the environment

The first start downloads the Linux image and installs developer tools. Speed depends on your network. Click "Operation details" to see the current stage and errors. If it's still downloading or installing, keep the window open and wait. After a failure, check the proxy node and disk space first, then start again.

Linux images with pinned digests, plus the code-server, mise and Claude Code native packages, keep unfinished downloads and retry a limited number of times. On the next start, Cage tries to resume. If the server doesn't support resume, the file is downloaded again. A file is used only after full verification passes. APT uses its own package cache and download retry mechanism. Don't clear the personal data folder or rebuild the account to fix a download failure.

APT 3.0.3 on Debian 13 can pile up many `Tried to start delayed item` warnings during download retries and run out of memory. Before installing dependencies, Cage upgrades older APT to at least 3.0.4. If the official security source is temporarily unreachable, later installs stop, so check the proxy and try again. Repeated log lines are shown as the first line plus a repeat count. A task is complete when the install process exits. If mirrors keep failing, unreachable sources are skipped. To pin the official source, set the guest mirror preference as described under [What is downloaded on first start](getting-started.md#what-is-downloaded-on-first-start).

For images and developer tools, the timeout starts from the last time file data was received. It only counts as a timeout after 60 seconds with no new data. While data keeps arriving, the download keeps waiting. There is no minimum download speed or total download time limit. Connection setup still has its own timeout. After automatic retries run out, the install page keeps the error. Click "Continue installation" to try again and reuse the saved download. You can keep continuing manually after repeated failures.

| Error in operation details | What to do |
| --- | --- |
| `Guest DNS could not resolve the Debian download sources` | The Linux environment could not resolve the Debian download sources. Check the nodes and DNS settings under "Network and proxy", apply them, then try again. |
| `Download interrupted; partial data is saved` or `partial data retained` | The unfinished file is kept. Try again after the network recovers. Operation details show the retry count or the number of bytes saved. |
| `checksum mismatch` | The file failed the integrity check, so the install was rejected, and the damaged unfinished file is removed. A retry downloads it again. Don't skip the check. |
| NodeSource public key download failed | The download retries a limited number of times, and any existing public key is kept until it succeeds. If it keeps failing, check the connection from the node to `deb.nodesource.com`, then try again. |
| `APT failed`, followed by `oom_kill before` / `after` | The installer records the OOM counts before and after the failure, a memory summary at that point, and the kernel OOM log. Export a diagnostics bundle for maintainers to review. An increased count means the guest hit an OOM during that period. The killed process is shown in the kernel log. |

You can stop the environment while it is starting or checking. If a network setting needs a restart, save your files first. Don't run several installer copies at once, or edit the private config while it is running.

## Node is applied, but internet access is still offline

"Applied" means the proxy core selected the node successfully. The workbench's network checks still need to pass. Click the network status at the bottom to see failed or unknown critical checks:

| What you see | Next step |
|---|---|
| Exit IP or region doesn't match the rule | Choose a node that matches the original rule. If you really want to change the exit, explicitly edit the baseline under "IP change rules". A recheck does not accept the new IP automatically. |
| Matches a mainland China network range, or is located in mainland China | Switch to a non-mainland exit. Static IP and any-region settings can't bypass this. If you think the location is wrong, keep the check report and exit details for review. |
| Proxy unavailable, or core not ready | Apply the node again on the proxy page, or go to "Diagnostics" to check the core status and restart the Cage core. |
| Port already in use | In the proxy's "Diagnostics", choose an unused, separate port for Cage. You don't need to stop other proxies on this computer. Changing the port requires restarting the environment. |
| Exit IP detected, but location lookup failed | Cage tries ipwho.is and then IP.SB. Try again or switch nodes. Every mode must confirm a non-mainland exit. Manual time zone, language, static IP and any-region settings can't skip the country or region check. |
| Proxy infrastructure DNS unavailable | Make sure the host can reach Cloudflare or Alibaba DoH. Cage tries both in parallel. Business DNS settings don't change how node domains are resolved at startup. |
| Paused, or the check report has expired | Confirm the config, then recheck. Internet access is restored only after critical checks pass. |
| Temporarily offline after the host network changed | Wait for Cage to rebind to the current physical network adapter and finish its checks. If you paused it manually before, you still need to recheck it yourself. |

While offline, you can still use the terminal, shared files and local services in the Linux environment. The green shield means the current state and checks have passed. It does not show account eligibility or platform risk.

If "Check or monitoring authorization expired" keeps appearing, record when it goes offline, when the full recheck starts, and when access is restored. A node can still reach the internet and still hit a renewal wait or slow checks. The current diagnostic patch records how long each stage takes to help find the cause. It does not yet mean the scheduling problem is fixed. For steps, see [Network authorization keeps expiring](guide/troubleshooting.md#network-permission-keeps-expiring).

## Blank browser, or a pending recovery message

Click "Restore browser". This tries to restore the display connection, and existing terminals keep running. If the whole workbench says the connection was interrupted, reopen the app first. If it still fails, check "Operation details".

Visiting `localhost` in the Cage browser connects to the currently selected guest. Dev servers must be started in a Cage terminal. A port with the same number running on the host is in a different address space. When public UDP, IPv6 or direct LAN connections are restricted, related tools may also fail to connect. For private network connections you turn on yourself, see [Tailscale troubleshooting](guide/troubleshooting.md#tailscale-sign-in-or-ssh-failure).

## Upload window still shows Cage's internal folder

First update Cage's environment components. For Claude Desktop, also save your work, close the app and reopen it so the file picker service takes effect. After you click upload, you should see "Upload local file". Then click "Choose local file" to open the system window on this computer. To drag or paste files, the target must accept attachments. On the Code page of Claude Desktop, when you choose a working folder, Cage should show "Choose a working project". You can use a project from the list directly, or call the local window with "Add a local project…". For a project in the list with a connection error, choose it again to retry sharing. If you see "The file picker didn’t open", update Cage, then save and close Claude Desktop and reopen it so the folder picker service takes effect. The website's own format and size limits still apply.

## Desktop text is too large, or the display ratio is off

First set "Display size" in the top right to 100%. The display adjusts automatically when the window or sidebar changes. If you need more space for content, choose 90% or 75%. If you see "The view size could not be synced", click "Retry resizing". If it still doesn't recover, save your work, close Claude Desktop and reopen it so the current environment's app scaling settings take effect.

Older builds' size control scripts can be affected by mise initialization in the guest's zsh and keep returning a resize failure. In that case, use a Cage build that includes the fix to the control script. The fix works with existing guest configs and explicitly chooses the script interpreter at the control entry point.

Google sign-in and external links in Desktop open in the Cage browser, and the interface should switch to the matching tab automatically. After the sign-in callback completes, you return to Desktop. In older versions that open the page only in the background, first click "Browser" in the sidebar to continue.

## Claude sign-in or request failed

Cage does not read the Claude sign-in on the host automatically. Run `claude` in a Cage terminal, then complete authorization in the Cage browser as prompted. If you need to open the link manually, copy the full authorization link into the Cage address bar.

Confirm that the workbench's critical checks pass, then check the account's own eligibility and the error Claude returns. Being able to open the sign-in page only proves the page is reachable. This usage path succeeds only after authorization completes and one real model request works. When you report it, keep the error type, and hide the email, authorization link, tokens and session information.

If the history list fails to load, the sessions already loaded are kept, and old active markers are cleared. First press the retry button to read the latest status. Then deal with the specific cause: config, pairing, connection, communication or desktop status. Avoid signing in again right away. If an account handoff is blocked, check the original task, approvals, group and usage limit. For detailed steps, see [Session and account problems](guide/troubleshooting.md#claude-sign-in-and-account-problems).

## Files change on this computer too; Git commit fails

This is expected for shared projects. Cage reads and writes the local folder you opened directly. The `.git` folder in a project is readable and writable, so after you change code, you can review the diff and commit it in Cage.

All projects share tools and accounts in the same environment. Switching projects does not revoke sharing for folders opened earlier, and it does not stop existing terminals.

## Terminal, clipboard or quit behavior differs from what you expect

| Symptom | What to do |
|---|---|
| `Ctrl+C` doesn't copy | In the terminal, it interrupts the command. After you select text, copy with `⌘C` on macOS, or `Ctrl+Shift+C` on Windows and Linux. |
| Copy after selecting in the terminal, but this computer still pastes old content | Some terminal programs take over the mouse. On macOS, hold `Option` while selecting, release it, then press `⌘C`. On Windows and Linux, hold `Shift` while selecting, release it, then press `Ctrl+Shift+C`. |
| You've visited several pages, but back or forward is still grey | Update Cage and sync the environment components. Older versions' live updates didn't include navigation history. Newer versions update it with navigation and tab switches. On a new tab with no history, grey arrows are normal. |
| Paste doesn't work | Click the target input box first, then paste. In a regular browser, you can use the "Text transfer" panel. Only plain text is supported. |
| The web page copy button shows success, but this computer still pastes old content | Try again with the web page and Cage window in front. If an existing page has changed the copy API, refresh it and try again. For complex DOM selections, images, rich text or very long text, use the copy shortcut and the "Text transfer" panel. |
| Old terminals are gone after stopping | Stopping the VM ends its processes. The disk and sign-in state are kept, but you need to create new terminals. |
| Tasks keep running after closing the window | Closing the window keeps the environment running. To end it, choose "Stop environment and quit". |
| Cage's backend was stopped from the command line, but the desktop window is still open | Choose "Quit Cage" from the app menu (on Windows, you can also use the tray menu). If it says the environment state can't be confirmed, choose "Quit the desktop app only". After reconnecting, you can check the environment and task status. |
| Something doesn't work after changing settings | "Settings → Environment and recovery" can restore the previous config. This needs the environment to be stopped and restarted, and ended terminals can't be restored. |

## Page and exit status

The node list, the current selection and the actual exit are all maintained by Cage's proxy manager. If the config isn't set, isn't applied, or the core is stopped, internet access stays off. If the list doesn't match the actual connection status, reapply the current node on the diagnostics page and check the report. Don't change the generated local exit address, or start another proxy program that takes Cage's port.

## Export a diagnostics bundle

Open "Settings → Environment and recovery → Logs and diagnostics", click "Export diagnostics bundle", and choose a save location on this computer. macOS, Windows and Linux use the same entry point. You can export local logs even when the environment is stopped. The bundle is not uploaded automatically.

Logs automatically mask common passwords, tokens, auth headers, URLs, emails, IPs and local paths before they are written. Host logs are capped at 40 MiB. The guest Cage service log budget is 10 MiB, and logs are kept for up to 14 days. The bundle includes redacted logs, versions and collection status. It does not collect terminal content, project files or the full config. For existing environments, the guest log settings take effect with the environment component update.

If the app window won't open, run `cage diagnostics --json /absolute/path/cage-diagnostics.zip`. Inside the macOS app, the command is at `Cage.app/Contents/Resources/cage`. On Windows, it's at `resources\cage.exe` in the install folder. On Linux, it's `cage` in the app folder. You can still export local logs when the control service can't be reached. The file must be saved to an absolute path on this computer. For technical details, see [Troubleshooting and diagnostics](guide/troubleshooting.md).

## What to include when you report a problem

In [GitHub Issues](https://github.com/Lee-xeo/Claude-Cage/issues), include the Cage version, OS version, processor architecture, steps, expected result, actual error and the stage where it happened. You can attach a cropped status screenshot or a diagnostics bundle you have checked.

Don't upload the whole `~/.claude-cage/` folder, full proxy config, subscription links, account tokens, authorization URLs, project content, or unchecked diagnostic output. Network reports may include exit IPs, and screenshots may include project paths. Hide what's needed before sharing. For issues involving credential leaks or isolation bypass, use the private security report entry provided by the repository first.
