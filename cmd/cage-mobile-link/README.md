# Connect mobile CLI sessions through a relay

`cage-mobile-link` connects a trusted device to a running Cage host. The client can browse projects the host authorizes, create Claude Code sessions, send messages, view progress, answer tool approvals and stop the current run. When the host account is locked, these operations return HTTP 423, and you need to unlock on the computer. The server side still handles project authorization, message deduplication and run results.

With the official relay, create the pairing directly by following the [phone guide](../../mobile/README.md). The host helper reads the computer's relay settings by default. The examples below show a [self-hosted relay](../../deploy/relay/README.md) that uses an admin token. On the computer, start Cage with the mobile CLI interface, and build the host connection helper. Android and iPhone connect through the [Cage phone client](../../mobile/README.md). If you use another computer's browser instead of a phone for debugging, that computer also needs to build this tool, and you need a mobile page folder containing `mobile.html` and `assets/`.

```sh
go build -o /tmp/cage-mobile-link ./cmd/cage-mobile-link
```

## First-time registration of the peer's public key

Run the initialization command once on the computer. Choose a brand-new dedicated folder for `--state`. Its parent folder must already exist. The `sha256:…` printed in the terminal is the computer's public key fingerprint. The phone's public key fingerprint is on the app's home screen. If both ends use the command line, initialize each one separately.

```sh
/tmp/cage-mobile-link init --state /path/to/new-device-state
/tmp/cage-mobile-link fingerprint --state /path/to/new-device-state
```

Verify the fingerprints side by side on both devices, or use a separate channel whose identity has already been verified. After verifying, write the other side's full public fingerprint into your own device's trust record.

```sh
/tmp/cage-mobile-link trust \
  --state /path/to/new-device-state \
  --peer-pin 'sha256:<full public fingerprint of the other device>'
```

Each CLI state folder registers only one peer. The first registration relies on the operator verifying the fingerprint, and the trust record refuses to be overwritten. The room identity provided by the relay is used only for this connection. The CLI device identity is stored in a private file. It uses user permissions on macOS and Linux, and user ACLs on Windows. Each connection uses the same device key to issue a short-lived certificate, so the public key fingerprint stays stable.

## Save the host on the phone

After the host has registered the phone's fingerprint, run the following command on the computer. The admin token, the Cage program and the target host config all use absolute paths, so you can start it later from a different working folder.

```sh
/tmp/cage-mobile-link host \
  --state /path/to/host-device-state \
  --relay https://relay.example.com \
  --admin-token-file /private/path/relay-admin-token \
  --cage-bin /absolute/path/to/cage \
  --config /absolute/path/to/config.json \
  --connection-out /private/path/new-phone-connection.json
```

Send the exported connection file to the phone privately and import it. On the phone, compare the fingerprint shown separately on the computer character by character, then save the host. The connection file contains the relay address, the version number, the host's public fingerprint and a lookup token dedicated to this phone. Anyone holding the token can ask the relay for client access to the current room, so protect the connection file. Entering the workbench also requires the phone's own device private key, and the host also proves its identity to the phone.

While it runs, this host command keeps a joinable room open. After the phone disconnects, the room expires, or the relay restarts, the host registers a new room with the same lookup credential. The phone reconnects by choosing the saved host, then reads the original session from the host. Sending messages, approvals and stopping a run each keep their own request semantics. Connection recovery only rebuilds the communication. When the host process restarts, it can read the device's private config directly.

```sh
/tmp/cage-mobile-link host --state /path/to/host-device-state --serve-saved
```

To revoke this phone, run the following command on the computer against its dedicated state folder. The command removes the peer fingerprint and the saved lookup token, and the running bridge process closes existing connections within about one second. The host device key is kept. To authorize again, first register the verified phone fingerprint, then generate a new connection file. The new file uses a new random lookup token.

```sh
/tmp/cage-mobile-link revoke --state /path/to/host-device-state
```

Each state folder corresponds to one authorized phone. `--connection-out` selects a new output file name. Repeated exports of the same config reuse the existing pairing. Before replacing the saved relay, host config or phone identity, revoke and register again.

## One-time connection invitation

The host needs the relay admin token file, the absolute path of a trusted Cage program, and the absolute path of the target host config. Run the following command on the host and keep the process running.

```sh
/tmp/cage-mobile-link host \
  --state /path/to/host-device-state \
  --relay https://relay.example.com \
  --admin-token-file /private/path/relay-admin-token \
  --cage-bin /absolute/path/to/cage \
  --config /absolute/path/to/config.json \
  --invitation-out /private/path/new-client-invitation.json
```

Send the newly generated invitation file to the client through a private channel, and keep it readable only by you. The file contains a short-lived room ID, the client's one-time access token and an expiry time. The relay domain and the host public key fingerprint come from the device's local config. The host gets a ticket through the local `server-entry --json` and exchanges it in place for a session cookie. These two credentials are used only on the host side.

## Open the page on the client

Start the local bridge service on the client device. Point `--web-dir` to a trusted mobile page build folder, and choose a new private HTML file name for `--launch-file`.

```sh
/tmp/cage-mobile-link client \
  --state /path/to/client-device-state \
  --relay https://relay.example.com \
  --invitation-file /private/path/client-invitation.json \
  --web-dir /absolute/path/to/mobile-build \
  --launch-file /private/path/new-cage-entry.html
```

Open the launch file in a browser on the same device. The entry can be used once within two minutes, then it's exchanged for a local HttpOnly session cookie. The page loads from the local loopback address. The device private key, room token and host cookie are all managed by the bridge process. The CLI output only shows the next step, so sensitive entries aren't printed to the terminal.

With a one-time invitation, after a disconnect, run `host` again to create a new short-lived invitation, then run `client`. With a saved host, replace `--invitation-file` with `--connection-file` and pass the saved connection file. The relay address and the verified host fingerprint must match the file. Both commands refuse to overwrite their private output files, so use new file names.

## Native app integration

[nativeclient](../../internal/mobilelink/nativeclient/client.go) provides an interface that can be bound to Swift and Android. The platform stores the P-256 key and gives the Go layer the public key and SHA-256 digest signing capability. Signatures use X9.62 DER encoding. The native layer can show `Fingerprint` for the host to verify, and saves the independently verified host fingerprint in the device's trust record.

After getting a short-lived invitation, call `Open` with the separately configured relay address, room ID, client token, trusted host fingerprint and device signer. After the connection succeeds, `StartUI` accepts an absolute folder of the app's bundled resources and returns a one-time local startup URL. The native WebView should allow only the exact origin of this entry and load that URL directly. The native interface can also call `Request` to receive the HTTP status, content type and response body. When you leave this host, call `Close` to release the local page service, the connection and running reads.

When saving a host, the native layer stores the lookup token in the system secure storage and separately saves the verified host identity and relay address. Later, calling `OpenSaved` finds the new room and connects. Its parameters are, in order, the relay address, lookup token, verified host fingerprint and device signer. This call retries briefly only while the directory is read and a room handover is still in progress. The first authorization still needs a separate fingerprint check. For phone steps, see the [mobile client guide](../../mobile/README.md).

## Verify a real workbench connection

The test below creates a temporary Cage config, a local account and the identities of both devices. It uses a real relay, end-to-end TLS, host ticket exchange and the mobile API to verify project reading, session creation, restore by version, locking and rejection of unauthorized access. It also verifies room rebuilding after a saved host, relay restart, host bridge restart and device revocation. The test does not start a VM or call a model.

```sh
go build -o /tmp/cage-mobile-e2e-backend ./cmd/cage
CAGE_MOBILE_E2E_BINARY=/tmp/cage-mobile-e2e-backend \
  go test -race -run TestIsolatedWorkbench ./cmd/cage-mobile-link
```

To verify the wait time for a manually delivered invitation, also set `CAGE_MOBILE_E2E_DELAY_JOIN=1`. The test makes the client join the room 16 seconds late, which covers the case where the user takes longer to join than a single TLS handshake deadline.
