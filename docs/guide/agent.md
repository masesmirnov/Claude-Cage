---
title: Let an agent configure Cage
description: "The complete entry point for external agents: download and verify, install, configure the proxy and guest, track jobs, locate faults and recover."
group: Getting started
order: 5
keywords: Agent CLI JSON automation configuration interface install diagnostics repair capabilities doctor llms
---

You can give the paragraph below to your own agent, and it will prepare Cage for your goal. You only need to provide your own proxy source, choose the working environment, and complete authorization when the operating system requires it. You decide the Cage account password, the Claude sign-in, license confirmations and the project sharing scope.

> Read https://lee-xeo.github.io/Claude-Cage/agent.md and help me install, configure and verify Cage. First check the local installation and interface capabilities, then act based on the actual state. When done, tell me whether the environment is ready, whether the network check passed, and what I still need to do. Keep all existing accounts, projects and virtual machine data.

This page describes the interfaces of the current source code and development build. The public release may not include `cage agent` yet. After installation, you must run a capability probe first. If you hit an unknown command, use that version's interface and release notes, or install a newer build the user has authorized. Do not infer that an interface exists from the version string alone.

## Where the agent starts

In the text below, `cage` stands for the backend CLI inside the Cage installer. Find the actual file first. Do not treat the desktop launcher, or a same-named Wayland program on Linux, as the CLI.

| Platform | Default CLI location | Example call |
| --- | --- | --- |
| macOS | `/Applications/Cage.app/Contents/Resources/cage` | `"/Applications/Cage.app/Contents/Resources/cage" agent capabilities` |
| Windows | `%LOCALAPPDATA%\Programs\Cage\resources\cage.exe`; for a custom install directory, use the actual location | `& "$env:LOCALAPPDATA\Programs\Cage\resources\cage.exe" agent capabilities` |
| Linux | `/usr/bin/claude-cage` | `claude-cage agent capabilities` |

`agent capabilities` prints this build's protocol version, operation list, input fields and exit codes. It does not start the backend service or create configuration. Read it once before the first setup and after every upgrade. The machine-readable entry points are `/agent.md`, `/llms.txt` and `/llms-full.txt`. External agents using Cage should start from this page.

All `agent` commands output JSON automatically, so `--json` can be omitted. The examples use `cage` as a placeholder command. Replace it with the path from the table above when you run them. `--config /absolute/path/config.json` selects the configuration explicitly. When it is omitted, `CLAUDE_CAGE_CONFIG` is used, and if that is also omitted, `.claude-cage/config.json` in the user's home directory. The `config_path` in each output is the actual target. A remote selection in the desktop configuration does not change this target. When managing a server, you can also manage desktop connections through the desktop / selected scopes described below, or run the server interfaces inside an authorized SSH channel.

## Download, verify and install

The download helper is `/agent-bootstrap.mjs` on the website. It needs Node.js 20 or later and has no other dependencies. You can download and inspect the script before running it. It only finds the Release, downloads and verifies the installer. It outputs the follow-up installation steps and an argument array. The agent runs the installation for each platform, and the user handles system permission prompts.

On macOS and Linux, you can also fetch `/cage-install.sh` and run it. Its arguments are the same as the download helper's, and it needs Node and curl. `/install.sh` is kept for the upstream agent-vm compatibility flow. To install Cage, use the dedicated entry listed in this section.

```sh
curl --proto '=https' --proto-redir '=https' -fL \
  https://lee-xeo.github.io/Claude-Cage/agent-bootstrap.mjs -o agent-bootstrap.mjs
node agent-bootstrap.mjs plan --platform darwin-arm64
node agent-bootstrap.mjs download --platform darwin-arm64 \
  --version v0.1.6-alpha-preview --destination /absolute/path/downloads
```

On Windows, download the script with PowerShell and run `node .\agent-bootstrap.mjs plan --platform win32-amd64`. On Linux, the platform argument is `linux-amd64`. When the platform is omitted, the platform and architecture of the current Node process are detected automatically. Specifying `--version` pins the release tag. When it is omitted, the helper queries GitHub's latest Release, which may not include a pre-release, or may be missing an attachment for some platform.

The helper reads the installer and `SHA256SUMS` from the same tag, and rejects incomplete attachments, duplicate checksum entries, HTTP downgrades and checksum mismatches. Downloads use a separate temporary file and create the target file only on success. If the target already exists, it is kept and an error is reported. After a failure, you can download again into a new target directory. When only an unsigned preview package exists for Windows, it returns `unsigned_package_requires_consent`. Add `--allow-unsigned` only after the user explicitly chooses that preview.

Downloads use the host network and need access to the GitHub API and Release attachments. Node 24 supports `node --use-env-proxy agent-bootstrap.mjs ...` to use the `HTTPS_PROXY` / `HTTP_PROXY` that the user explicitly configured, and the user's existing host TUN can also be used. Do not echo proxy credentials. The fetch in older Node versions does not adopt these environment proxies automatically. If the connection fails, check the host download network first, and avoid rebuilding the Cage configuration repeatedly.

| Platform | Installation and verification |
| --- | --- |
| macOS | Mount the DMG read-only, check the app signature and the Gatekeeper result, then place the app in the Applications folder following the [installation guide](installation.md). Before updating, save tasks and stop the old environment. Keep the old app so it can be restored, and roll back the app files if the installation fails. Do not remove quarantine attributes or turn off system checks to continue the installation. |
| Windows | Check the signature status of the downloaded package. Run the installer in an installation context the user has authorized. `/S` supports silent installation. For an existing custom install directory, the installation record is authoritative. System security prompts, enabling Hyper-V and restarts may require user action. |
| Linux | Run `sudo apt-get install -- /absolute/path/Cage-version-linux-amd64.deb` in a permission context the user has authorized, and let the package manager check dependencies. The public command name is `claude-cage`. |

Installing, updating and uninstalling only handle app files. Keep `.claude-cage`, the data directory the user specified, shared projects and the persistent VM disk. When an existing account shows the create screen again, first check `config_path` against the original data location. Do not create a replacement account or initialize the old data directory. A successful download and an installed app are two different states. After installation, verify the real CLI file and `agent capabilities` before you start configuring.

## Full order of the first setup

First clarify which kind of guest the user wants and which directories can be shared. The agent can probe host conditions and propose choices based on the report. It cannot accept licenses for the user, lower exit rules, or authorize host directories that were not specified.

```sh
cage agent capabilities
cage agent doctor
cage agent init
cage agent service.start
cage agent call account.status
cage agent host.inspect
```

`init` only creates missing default configuration. An existing valid configuration is kept, and a damaged configuration causes an error. `service.start` only starts a missing local backend service, reuses an existing backend of the same build, and refuses to replace a mismatched build. It does not start the virtual machine. `doctor` only reads the current state. It does not start services, change the network or apply repairs.

If the account exists and is unlocked, continue to the next step. Otherwise, have the user create or unlock it in Cage. If the user chooses to provide the password through the agent, call `account.create` or `account.unlock` with the private input format below. Command-line arguments do not accept passwords. Account creation only applies to a truly blank profile.

```json
{"username":"the name the user chose","password":"the password the user provided","confirm_password":"the same password"}
```

```sh
cage agent call account.create --input /private/path/account.json
cage agent call account.unlock --input -
```

`--input -` reads one complete JSON object and then waits for EOF. The agent should pass credentials through the child process's standard input, or use a temporary file with restricted access and delete it promptly. Do not write example passwords, subscription links or node secrets into shared logs, commit records, chat echoes or the shell history. This interface is for agents that the user has authorized and that run under the same operating system account on the host. Their permissions match the local workbench. It is not a restricted remote interface for untrusted plugins.

### Import a proxy and confirm the exit

First read `proxy.status`. If a usable source already exists, reuse it to avoid importing twice. For the first import, you can use a subscription link the user provides, or a Clash/Mihomo configuration or share link from a private file.

```json
{"name":"My proxy","url":"https://the-user-subscription-url","interval_hours":0,"host_download":true}
```

```sh
cage agent call proxy.import --input /private/path/subscription.json --wait 2m
cage agent call proxy.status
```

`host_download:true` explicitly allows the host to download this subscription over the network, only to fetch the subscription. The guest does not get a direct-connection fallback because of it. If a Cage proxy already exists, you can omit it so that the subscription goes through the existing proxy. Do not automatically extract subscriptions from the local browser, proxy software or another agent's credential files.

Choose the exit the user asked for from the returned sources and node list. Do not treat the first node in the subscription as an exit the user has agreed to.

```json
{"node_id":"node ID returned by proxy.status"}
```

```sh
cage agent call proxy.select --input /private/path/selection.json --wait 2m
cage agent call proxy.status
```

For chained proxies, use `proxy.route` with the input `{"node_ids":["entry ID","final exit ID"]}`, in order from entry to exit. To update a subscription, use `proxy.refresh` and the existing source `id`. `proxy.import` creates a new source each time, so do not retry it blindly. A successful proxy apply only means the proxy is ready. The guest's safety checks after startup still need to be verified separately.

### Prepare the environment and open a project

```sh
cage agent call guest.options
cage agent call guest.match
cage agent call storage.get
cage agent call resources.get
cage agent call settings.get
```

Choose the system based on actual availability. `guest.match` gives a clean image plan that matches the host version. Pass the returned `key` as `clone_key`, and pass `plan.host.system` as `guest_system` to `environment.start`. For image download size, disk, host permission and system authorization requirements, see the [guest system guide](guest-systems.md). It does not copy host accounts or personal files. Existing guests should keep their original installation and preserve the original system and media information.

When you first need a different storage location, use `storage.set` before installation, with the inputs `directory`, `previous` and `migrate`. The last two come from the `directory` and `has_environment` returned by `storage.get`. Migrating an existing environment stops tasks and keeps a backup, so save your work first. Use the `allocation` object of `resources.set` for resource settings. After saving changes, call apply resources with `{}`, which restarts the environment. Container resources are managed by the server deployment.

Send only the settings to change, and run a preflight check before applying. `browser_home_url` is saved separately through `browser.preferences.set`, and environment settings are submitted separately. Fields that are not specified are kept, including unspecified IP, country and city baselines in the exit rule object. `null` is not used to clear fields.

```json
{"patch":{"auto_timezone":true,"auto_language":true},"dry_run":true}
```

```sh
cage agent call settings.patch --input /private/path/settings-check.json
# When applying, change dry_run to false, then submit the same patch.
cage agent call settings.patch --input /private/path/settings-apply.json --wait 2m
cage agent call environment.start --input /private/path/guest-choice.json --wait 30m
```

`environment.start` for an existing environment can be called without input. The JSON fields for the first selection are `guest_system`, `clone_key`, or `media` and `sha256` when needed. Pass `editor_terms:true` only when the user explicitly accepts the corresponding terms. Available systems follow `guest.options`. When installation succeeds and `guest.options.activate:true`, call `guest.activate`, then call `service.start` again and read the status. Activation makes the old backend exit. If the request is interrupted, check the installation status before deciding the next step.

When first-time system setup, macOS permissions, Windows sign-in or a restart need the user to finish, report what exactly must be done and the recovery query command. Do not hide the wait for user action with endless retries. Installation progress is in the job's `setup_progress`. Check `prepared`, installation completion, running and networking separately.

```sh
cage agent call status
cage agent call initialization.status
cage agent call network.check --wait 5m
```

Judge availability together from `status.ready`, `vm_running`, and the network check and authorization for the current configuration in `safety`. `proxy.status.network_open` can help check whether internet access has been allowed. When networking is paused, keep the user's intent to pause, and run `network.check` only when the user asks to restore networking. To finish first-time setup, use `{"action":"complete"}` with `initialization.set`. The backend then checks the environment and network state again.

Open a project with `project.open`: `{"workspace":"user-authorized absolute path","add":true,"activate":true}`. It lets the guest access this directory, and changes affect the host files. A returned `approval` means it is waiting for system authorization. The agent can call the same `/api/macos/project-approval` to view and act on that window. Claude's service sign-in is still completed in the official tools inside Cage. This interface does not import host Claude credentials.

To remove an added project, use `project.remove` with `{"workspace":"path from the project list"}`. After you close this directory's terminals, running sessions and editor, sharing is removed, and the original files and session history are kept. The default workspace is kept, and after removing the current project, it switches back to the default workspace.

## JSON results and asynchronous jobs

Except for the streaming `socket`, each command's stdout is a single JSON object. The NDJSON format of `socket` is described below. Format example:

```json
{"protocol":1,"version":"build version","config_path":"absolute config path","status":"accepted","data":{"id":"012345abcdef","kind":"start","running":true,"message":"Preparing…"}}
```

| Field or exit code | Meaning |
| --- | --- |
| `status: completed`, exit 0 | This read or sync operation completed, and the asynchronous job is confirmed successful. You still need to check the data to confirm that the environment and network reached the target. |
| `status: accepted`, exit 0 | The job was accepted and is still running. Save `data.id` and query it. |
| `status: error`, exit 1 | The operation failed. Check the stable `error.code`, `message`, `next_action` and `retryable`. |
| Exit 2 | Command or input error. Correct it before submitting again. |
| Exit 3 | The user must unlock or complete authorization. |
| Exit 4, `wait_timeout` | This wait ended, and the background job may still be running. Query the original job to avoid submitting it again. |

```sh
cage agent job 012345abcdef
cage agent job 012345abcdef --wait 30m
```

`--wait` is a bounded wait, from 0 to 24 hours. Without it, the command returns immediately. Waiting or a client disconnect does not cancel the job automatically. The backend keeps only the most recent job, so a later job replaces the query record, and a restart may also lose it. After `job_not_found`, `outcome_unknown` or a broken connection, first read `status` and the relevant configuration, and check the side effects. Do not treat another task's success as the success of the original task. `job_canceled` on its own means cancellation and must not be treated as completion.

The input of a named call must be a single JSON object, up to 12 MiB. `request` supports raw binary file streams. Unknown commands and fields are rejected. The `input_schema` in the capability list describes the allowed fields. The backend still validates the current platform, system state and field combinations. Error descriptions are sanitized, and normal business results keep the original interface values. Passwords, cookies, pairing codes and similar items that the user can view may also be read by the agent after the same re-verification and permission checks pass. They should be handled through a private pipe to avoid default logging or echoing.

## Locate problems and recover

First run `doctor` to check the configuration path, account and background. Then use `status`, `proxy.status` and `environment.versions` to find the failed stage. After a fix, repeat the matching query, and report recovery as successful only when the real state reaches the target.

| Stable error code or visible state | The agent's next step |
| --- | --- |
| `config_missing` | Check the user data location. Run `init` only on true first use. |
| `config_invalid`, `private_file_permissions` | Keep the configuration and disk, export diagnostics, and check the original files and permissions. Do not overwrite the whole profile. |
| `service_unavailable` | Check the actual CLI and path, then run `service.start`. If that fails, export offline diagnostics. |
| `controller_mismatch` | Use the CLI from the same app as the running backend. Updates require saving and stopping existing tasks. The agent does not take over automatically. |
| `config_path_mismatch` | The backend in the same directory uses a different configuration file name. Switch to the absolute configuration path of the original backend, and keep all existing files. |
| `account_locked` | The user unlocks in Cage, or calls `account.unlock` through private input. |
| `request_rejected`, `invalid_input` | Read this build's capabilities and error descriptions, then correct the field or the node/source ID. Do not repeat the original request. |
| `state_conflict`, `service_busy` | Read the current job and system state. If a job is in progress, wait for it to finish. |
| `unsupported_operation` | Check the capabilities of the current platform and guest, and use the guide for the matching version. |
| `job_failed` | Keep `data.error` and the sanitized job log, and check the current configuration, source availability, space and host conditions. |
| `outcome_unknown`, `job_not_found` | Read the actual side effects. Proxy import, installation and migration must not be submitted again blindly. |
| Internet access not allowed, or a check failed | Check the selected proxy, the path, exit rules, time and location. If it keeps failing, keep internet access off. After the user authorizes it, you can switch nodes or recheck, but do not automatically switch to a direct connection or lower the rules. |
| `user_action_required`, project `approval`, first-time system setup not finished | Continue through the same native bridge or the guest authorization window interface. When the system requires biometric authentication or administrator confirmation, query the original state after verification is complete. |

```sh
cage agent diagnostics --output /absolute/path/new-cage-diagnostics.zip
```

Diagnostics export can still collect host logs when the backend is unavailable. When it can connect, it tries to add guest information. Use a new output file name, since existing files are kept. The diagnostics bundle goes through the existing sanitization process, and the user still decides before sharing. Do not automatically upload raw configuration, subscription URLs, keys, account files or VM disks as diagnostic attachments.

Use `environment.update` to update components and `environment.tools` to update tools. Both can be tracked through the job interface. `environment.stop` ends active tasks in the environment, and keeps the disk and sign-in data. App upgrades, cross-version rollbacks and uninstalls still follow the [maintenance and data guide](maintenance.md), using the installer and system package manager as the entry points.

When `status.can_restore:true`, `settings.restore` can restore the last saved settings and restart the environment. This interrupts existing tasks, so save your work first. When the configuration file itself is damaged, the path is wrong, or the account cannot be read, keep the original file and check the backup first. A restore command cannot replace locating the data.

## Results to deliver to the user

When done, explain in a few sentences: the installed version and path, the configuration and guest used, whether the proxy was applied, whether the environment is running, whether the network check passed, and whether the project is connected. List the authorizations and sign-ins the user still has to complete, and the scope that has not been verified. If you only completed a download, a simulated request or a single-platform build, report each separately, and do not describe it as a full installation or a verified success on all three platforms.

## What users and agents can operate

Named operations are shortcuts for common configuration. The general `request` accesses the same HTTP API as the interface, `socket` connects to the same WebSocket, and native operations are run by the existing bridge of the actual desktop window. Both entry points use the same account permissions, password re-authentication, project authorization, network thresholds and platform capabilities. After the user authorizes an agent to complete setup, Cage does not add another product confirmation round just because the caller is an agent. Touch ID, administrator authentication and similar system requirements still apply.

### Choose a target first

| Scope | Target |
| --- | --- |
| `local`, default for the full app | The local workload for the explicit config_path. It is fixed to this computer and does not follow SSH switching. |
| `desktop` | The desktop connection configuration, SSH hosts, local trust and native window queue of the full app. Requires the desktop connection service to be running. |
| `selected` | The environment currently selected in the full app's desktop. Must include `--connection`, with the value taken from client.context.connection_id. Old generations are rejected after switching. |
| `client`, default for the lightweight client | The connection service of the lightweight client. Business requests must include the current `--connection`. Connection management requests can omit it. |

For the full app, `--config` still refers to the original main configuration, and the desktop scope locates the corresponding desktop-entry service. The lightweight client uses the CLI from its own installer package, and its default configuration is `~/.claude-cage/client/config.json`. When a desktop window is needed, the agent can open Cage the normal system way and then continue with interface operations. The user is not required to open the window by hand.

```sh
cage agent call client.context --scope desktop
cage agent routes --scope desktop
cage agent call settings.get --scope selected --connection current-connection-generation
```

`capabilities` returns named operations and the actual input types offline. `routes` reads online the routes that the current listener actually registers, and newly added interface APIs enter the list automatically. The platform and environment state still decide whether a route is currently available. Patterns with `{id}` / `{action}` must be replaced with actual values.

### Configuration capability reference

| What users can do | The agent's equivalent entry |
| --- | --- |
| Name, avatar, password, lock, sign out | account.profile: username/avatar; account.password: old_password/password/confirm_password; account.lock/logout/suspend. |
| Local trust, remember sign-in, set password protection | desktop scope client.trusted-login: action is create/resume/enable/disable/protect. Provide password and connection_id under the same rules. |
| Touch ID and quick sign-in | native.submit with accountDevice, where operation is status/enable/disable/unlock and kind is automatic/biometric. Device keys are managed by native secure storage. Operations that Windows/Linux do not support return the same limits as the user interface. |
| Git protection on first launch | Read with host.git. Enable with host.git.enable and input confirm:true. This changes the host's global Git protection configuration, the same as the interface action. |
| Appearance, fonts, color schemes, custom themes | appearance.get/set reads and writes the full object. appearance.codex reads the local Codex appearance for import. Unchanged fields are kept after reading. |
| Exit location detection, speed test, connections and logs | settings.probe takes the complete settings draft as input. proxy.delay takes node_id as input. proxy.connections/logs. dry_run only performs static validation. |
| Reselect the system before installation starts | guest.reselect takes guest.options.pending.id as input, and is still constrained by the original installation state. |
| Claude accounts, usage limits, groups, enable and disable, scheduling and ordering | claude-accounts.get/change. Actions and field types come from capabilities. Business actions are the same as in the interface. |
| Password vault | vault.get lists metadata. The action of vault.change is save/delete/unblock/reveal. reveal still needs account_password, and returns the real password after re-verification. vault.browser provides page filling and saving. |
| Phone pairing | mobile.get/pair/remove. For a self-hosted relay, input admin/relay. The pairing result is a private invitation code. |
| Tailscale and SSH public keys | tailscale.get, plus install/connect/login/disconnect/logout/add-key/remove-key. The public key field is key. |
| Browser home page | browser.preferences.get/set. set updates the browser immediately, keeps the old value on failure, and the length limit matches the interface. When settings.patch changes only the home page, it reuses the same save flow. |
| Cookies, permissions, extensions, bookmarks | browser.cookies/settings/extensions; favorites.get/change. The mode, scope, id and cookieKey of cookies are the same as in the interface. |
| Guest first-time setup, sign-in and authorization windows | request accesses /api/macos/first-setup, /api/macos/login, /api/macos/maintenance as provided by the current build, and /api/macos/project-approval. Sessions, screenshots and keyboard and mouse actions match the interface. |
| SSH hosts and deployment, fingerprint checks, connection and switching | desktop scope client.hosts, client.hosts.create, client.candidate/commit/cancel/disconnect/local-stop. To update or delete a host, use PUT/DELETE /api/client/hosts/host-ID. The same connection generation, candidate, fingerprint and rules for keeping or removing local tasks are preserved. |
| Archived sessions, names, pinning, account switching | request accesses /api/cli/sessions and /api/cli/sessions/session-ID/{metadata,account,archive,restore,purge,open}. |
| File selection, theme import and export, app updates | native.submit calls existing native actions such as chooseFolder, chooseGuestMedia, importTheme, exportTheme and appUpdate. System pickers and signature checks still run as usual. |

### General requests and files

```sh
cage agent request GET /api/settings
cage agent request POST /api/browser/extensions/upload \
  --input /private/path/extension.zip --content-type application/octet-stream
cage agent request GET /api/diagnostics/export --output /absolute/path/new-report.zip
cage agent request DELETE /api/client/hosts/host-ID --scope desktop
```

JSON requests are passed through a private file or `--input -`. Binary requests use file streams and the correct Content-Type. Input size is constrained by the same production handler. The output gives http_status, content_type, the necessary recovery, and either the body or the path of the saved file. A valid 202 is kept. The output file is created exclusively, and an existing file is kept. Synchronous requests have a two-minute limit, and long installations are tracked through asynchronous jobs.

request returns the actual business response. The agent must still check error fields, job status and visible side effects. Collection paths in the interface list can carry the same query parameters. When a new feature has no named shortcut, use request directly. This difference does not limit the operating permissions of the user or the agent.

For WebSocket, use `cage agent socket /api/terminals/terminal-ID/stream`. Input and output are NDJSON. Each input line is `{"type":"text","data":"original protocol JSON string"}` or `{"type":"binary","data":"base64"}`. Output first sends `{"protocol":1,"status":"connected"}`, then the same frame objects, and at the end it outputs the standard command result. The handshake uses the same account, Origin and connection generation, and can carry existing messages such as terminal input, resizing and screen updates. Ctrl+C ends local viewing, and disconnecting does not stop the original terminal. Session credentials are held by the CLI.

### Native windows and client preferences

First get the actual connection generation from client.context, then submit a native action for the same window:

```json
{"connection_id":"current-generation","request":{"action":"accountDevice","operation":"status"}}
```

```sh
cage agent call native.submit --scope desktop --input /private/path/native.json
cage agent request GET /api/agent/native/returned-ID --scope desktop
```

The native queue belongs to the listener of the window where the current request is. Claiming and receipts need the window proof exchanged by the native startup bridge, and ordinary web sessions cannot take it over. The proof stays within the window and is not returned to the agent. A window claims only once. pending/running requires continuing to query the original ID. completed means a real receipt was received, and failed returns the native failure. After a connection switch, window closing or a lost receipt, the action is not replayed automatically. A request not claimed by a window within two minutes fails. After a record expires or is replaced by a later record, check the side effects first. Only operations that depend on a native window need the window to be open. Ordinary configuration can be called directly on the background.

The client's layout, volume and zoom use the WebView's existing storage. Submit `request.action:"clientPreferences"`, with operation get/set. For set, the values use the raw strings in the table below, and null restores the default. After a successful write receipt, refresh the current window so that the interface applies the change. Remote preferences are isolated by the same instance suffix.

| Logical key | Raw string encoding |
| --- | --- |
| cage-sidebar-collapsed | `true` or `false` |
| cage-browser-tab-layout | JSON string, for example `"vertical"`. In the outer JSON, the quotes must be escaped |
| cage-keyboard | `mac` / `native`, remote clients only. This computer uses settings.keyboard |
| cage.audio | JSON object, for example `{"muted":false,"volume":0.5}` |
| cage-desktop-zoom | 0.75, 0.9, 1, 1.1, 1.25, 1.5 |
| cage-active | Current tab ID |
| cage-tab-layout | JSON object returned by get that stores names, pinning and order per project |
| cage-recent-environment | `local` or the host ID |

Appearance goes through the persistent appearance interface, and the appearance in the WebView is only a cache. After saving, you can refresh through the native reconnect. Native actions continue to go to the existing receivers on the three platforms. When a platform does not support one, it returns the same unavailable result. An authorized agent can operate the authorization windows in the product. Biometric or administrator verification required by the system is still performed by the system.

Native device credentials and startup tickets are internal transport. The general request does not directly export wrapped keys such as device-enroll/device-unlock. These operations call the existing secure storage and biometric authentication through native.submit's accountDevice, keeping the same operating capability for the user.
