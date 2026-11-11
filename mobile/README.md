# Using Cage on your phone

Cage on your phone is a remote client. Tap "Connect computer" in the middle of the home screen, then connect to your host with a QR code or pairing code. You can view projects, continue Claude Code sessions and handle tool approvals. After pairing, you can also operate the browser and Claude Desktop on your host from the phone. Proxy, time zone and language are set in Cage on the remote host. The settings at the top right offer themes and computer connection options.

The Android arm64 APK is available from the [website download page](https://lee-xeo.github.io/Claude-Cage/#download). It supports Android 8.0 and later. For iOS 17+ devices, you build and sign the app locally with Xcode and install it yourself.

## Build for iOS locally

On a Mac, install full Xcode and the iOS SDK, and finish Xcode's first-launch setup. After installing Node.js 24 and a Go version that matches `bindings/go.mod`, run the following in the repository root.

```sh
npm ci --prefix ui
bash mobile/build.sh ios
open mobile/ios/CageMobile.xcodeproj
```

The command produces `mobile/.build/ios/Cagemobile.xcframework` and an unsigned device build. In Xcode, select the `CageMobile` scheme and your own development team, connect your iPhone, enable Developer Mode when the system asks, then sign and install with Run. To export a development IPA, run the following command and replace `TEAM_ID` with your own 10-character Apple Team ID.

```sh
bash mobile/build.sh ios-ipa TEAM_ID
```

The archive and IPA are saved in `mobile/.build/ios/device-*/`. After export, the device provisioning profile and app signature are verified.

## Build and sign for Android

Prepare JDK 21, Android SDK Platform 35, Build Tools 35.0.0 and NDK 27.2.12479018, and point `JAVA_HOME` and `ANDROID_HOME` to their install folders. After installing the UI dependencies, you can build a local development APK in the repository root.

```sh
npm ci --prefix ui
bash mobile/build.sh android
```

Public releases use a persistently stored signing key and a separate password file. The builder sets the paths below. Signing material is kept outside the source and temporary build folders, and only you can read it. Later APK updates keep the same signing identity and use an Android versionCode higher than the previous one. [Android signing guide](https://developer.android.com/studio/publish/app-signing)

```sh
export CAGE_ANDROID_KEYSTORE=/private/signing/release.p12
export CAGE_ANDROID_KEY_ALIAS=release
export CAGE_ANDROID_PASSWORD_FILE=/private/signing/keystore-password
export CAGE_ANDROID_VERSION_CODE=2
bash mobile/build.sh android-release
```

The release APK's versionName is read from the root `VERSION` file, and the output is `mobile/.build/android/Cage-<version>-android-arm64.apk`. The final file is written only after the signing and 16 KiB alignment checks pass. Publish the SHA-256 with it, and verify the signing certificate fingerprint, app version, and install and update-over-existing behavior.

## Connect a computer by scanning a QR code

1. On the computer, open and unlock Cage, select the local workbench, then click "Generate pairing QR code" under "Settings → Remote connection → Phone connection". When the computer shows the QR code, scan it with your phone.
2. On the phone, tap "Connect computer" in the middle of the Cage home screen, choose scan in the card that appears, allow camera access, and place the whole QR code from the computer inside the frame. The QR code is valid for about two minutes. If it expires, refresh it on the computer.
3. After a successful scan, the phone saves this computer and opens the workbench. The workbench opens the left sidebar by default. Tap "Browser", "Claude.ai" or "Claude Desktop" to open that view. The "Claude Code" section lists each project. Tap a project name to expand or collapse its sessions, and tap a session to open the conversation. The Cage logo at the top left reopens the sidebar, and the icon at the top right shows the current tool. The next time you open the phone, reconnect to a paired computer from the "Connect computer" card. After the computer restarts, open Cage to restore the QR-paired connection.

Only give the QR code to a phone you want to authorize. To replace the phone paired by QR code, first remove the old phone in the computer's "Settings → Remote connection", then generate a QR code for the new phone. The phone can forget the saved connection in fingerprint pairing or in the host settings.

If you don't want to connect now, tap outside the card to close it. On Android, you can also use the system back button. On iPhone, you can use the system swipe-down gesture. Wait for the current pairing step to finish.

## Use the remote browser on your phone

1. Update Cage on both the computer and the phone, start the environment on the computer, and wait for the network check to pass. If the interface says the guest version is old, stop and restart the environment on the computer so the new browser components take effect.
2. Connect with the QR code or pairing code generated on the computer. A phone that is already paired can reconnect directly.
3. Tap "Browser" in the phone's left sidebar. It opens the "New tab address" from the Cage browser settings on the computer. After the computer saves a new address, it takes effect the next time you open the browser from the phone. The "Claude.ai" entry always goes straight to Claude.ai.
4. After you tap an input box on the web page, open "Enter text" to use the phone keyboard. Tap the check mark first to insert the text into the page. When you need to submit, tap "Send Enter". If the connection drops, read the latest screen before deciding whether to type again.

Tap "Favorites" at the bottom of the phone browser to browse bookmarks by the folders on the computer, open addresses, or save the current page to a folder you choose. Both ends share the bookmarks of the paired host. If the other end makes changes, reopen Favorites, or tap refresh on the phone to see them.

The phone and the computer each have their own browser window. On first use, you need to sign in within the phone's remote window. When the same pairing is reopened, saved sign-in data can be reused. Internet exit, time zone and preferred language come from Cage on the host. Closing the browser ends the phone's browsing process. Unpairing or locking Cage stops access.

The phone browser requests mobile web pages sized to the phone's width. While dragging, scroll offsets are sent continuously. When the page is still, it only checks for changes. Images and input travel over the paired channel, so responsiveness depends on network round-trip latency. Public IPv4 HTTP and HTTPS are supported. Web scenarios that need a separate popup sign-in, file uploads or downloads, or sound playback are not connected yet. The emulator QR-code example is for previewing the sidebar and conversations. To test a real window, connect to the computer with a pairing code.

## Use Claude Desktop on your phone

Install Claude Desktop in the Cage environment on the computer and pass the network check. After a paired phone connects to the computer, open the left sidebar, tap "Claude Desktop", and wait for the app screen to appear.

The phone accesses the same Claude Desktop on the computer directly, sharing the account, app data and the current window. If the computer is signed in, the phone can continue right away. Taps, typing and page switches on the phone also show up on the computer, and both ends share the mouse and input focus. If the app isn't running yet, Cage on the computer starts it.

The newer phone app reads the screen pixel density automatically, so the remote view matches the current display resolution. After you enter on the phone, the shared window is laid out again to the phone's width. It follows screen rotation or the keyboard appearing, and the computer shows this layout too. Tap "Zoom to read" to view a section. When you leave Desktop on the phone, the computer's size is restored, and apps and tasks on the computer keep running. If you need to sign in again or choose a local file, do it on the computer.

## Pair with a fingerprint and a file

If the camera isn't available, click "Copy pairing code" on the computer, then tap "Connect computer" on the phone's home screen, choose the pairing code entry, and paste this one-time pairing code. When you use the command-line connection helper, open the fingerprint and connection file options from the settings at the top right of the phone, then exchange the fingerprint and file with the steps below.

On the computer, run a Cage build that includes the mobile session interface, unlock your account and start the workbench environment. You can build the connection helper on the computer from the repository root.

```sh
go build -o ./cage-mobile-link ./cmd/cage-mobile-link
```

1. On the computer, run `cage-mobile-link init --state <new private folder>` to create the host identity, and record the public fingerprint it shows. Later, you can view it again with `fingerprint --state <original folder>`.
2. Open Cage on the phone, and copy the public fingerprint under "This phone's fingerprint". Compare it with the phone screen, then run `cage-mobile-link trust --state <original folder> --peer-pin <verified phone fingerprint>` on the computer.
3. On the computer, generate a connection file for this phone, and keep the connection helper running. The official relay allows creating the connection directly. Enter the host identity folder, the new connection file path, and the absolute paths of the Cage background program and config file.

```sh
./cage-mobile-link host --state "$host_state" --connection-out "$new_connection_json" \
  --cage-bin "$cage_binary" --config "$cage_config"
```

4. Send the JSON to the phone through your own private file transfer method. In the app, tap "Import connection file", and compare it with **the public fingerprint shown separately on the computer** to confirm it matches the fingerprint entered on the phone. Tick the check box, tap "Save checked host", then tap "Reconnect". If you switch to another computer or change the computer's key, verify again.

After you enter the workbench, choose a project under "Claude Code" in the left sidebar, then start a new session or continue one. When a tool needs approval, the phone shows the specific parameters of this call, and you can choose "Allow once" or "Deny". This entry lists conversations created through the Cage session interface. CLI tools you start by hand in a regular terminal are still used in that terminal.

Before you continue a conversation, Cage checks the account and model service address the original session used, so history isn't sent to a different service. If the host can't confirm the identity of the config in use, the phone says only one round is supported this time. You can start a new session and send your message there.

## Use your own VPS

After you deploy a [self-hosted relay](../deploy/relay/README.md), on the computer select "Self-hosted relay" in "Settings → Remote connection", enter the VPS HTTPS address and save. On the phone, open Settings, expand "Relay settings", turn on the self-hosted relay, then enter the same address and save. For a self-hosted relay that needs an admin token, enter the token only on the computer. Choose the official relay and save to restore the default. New pairings use the saved address, and when the phone imports a connection file, it fills in the same address automatically. If the self-hosted relay requires an admin token, specify both `--relay` and `--admin-token-file` in the host command above, so the private token goes only to the intended recipient.

Paired phones keep using the original address and credentials. To move to another relay, remove the QR-paired device in the computer's settings, then scan again. For a device paired from the command line, revoke it with `revoke` below, then register it again.

## Next time

Tap the Cage logo at the top left to open the sidebar, then tap "Exit" at the bottom of the sidebar to return to the home screen. To switch computers, tap "Connect computer" on the home screen, then choose another computer under "Connected devices" in the card. Long-press a device to cancel the current connection. The pairing record is kept.

Each Claude Code project can be expanded on its own, so you can switch between sessions in different projects. Session progress refreshes automatically. If reading fails, tap "Read again" in the notice. Chat bubbles show where each message came from. The input box has large rounded corners, the arrow on the right sends, and a stop button appears while it's running.

On a paired phone, you can stay in the current session during a brief network drop. After the network recovers, the next time the workbench reads progress, it verifies the computer's identity again and restores the connection. Your draft in the input box is kept. If the connection drops while you're sending a message or approving, check the latest record the computer returns first. Messages already received appear in the history. If the computer is still waiting on the same approval, the phone shows "Allow once" and "Deny" again.

After you disconnect on purpose or reopen the app, choose the paired computer in the "Connect computer" card, then open the original session to continue. If you use the command-line connection helper, start Cage after the computer restarts, then run the following command to restore that helper's pairing:

```sh
./cage-mobile-link host --state "$host_state" --serve-saved
```

A connection file contains the relay address, the computer's public fingerprint and a persistent lookup credential. Give it only to the paired phone. On Android, a separate Android Keystore AES-GCM key encrypts the lookup credential, and the ciphertext is bound to the verified relay address and fingerprint. On iPhone, the record is stored in a Keychain item that is available only on this device and only when unlocked. The device signing private key is kept in Android Keystore or the iPhone Secure Enclave. Only Debug builds on the iPhone simulator use a separate software test key, and the device fingerprint in settings is labeled accordingly. The web page only accesses the restricted local session interface.

Tapping "Forget host" on the phone clears the saved host address, fingerprint and reconnect credentials. The phone still uses its own device signing identity. To revoke access on the computer as well, run `cage-mobile-link revoke --state <host identity folder>`. For the older one-time invitation, use `--invitation-out <new invitation file>` on the computer instead of `--connection-out`. The phone verifies and saves the relay address and computer fingerprint by hand, then opens the invitation through the same import entry. After a one-time invitation disconnects, you need a new invitation.
