#!/usr/bin/env bash
# Build, notarize, and package a Developer ID distribution. No installation.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
  echo 'The supported release target is Apple Silicon macOS 14+.' >&2; exit 1
fi
case "${1:-}" in ''|--from-notarized-app) ;; *) echo 'Usage: scripts/package-macos.sh [--from-notarized-app]' >&2; exit 2 ;; esac
: "${CAGE_SIGNING_IDENTITY:?Set CAGE_SIGNING_IDENTITY to your Developer ID Application identity.}"
: "${CAGE_NOTARY_PROFILE:?Set CAGE_NOTARY_PROFILE to a notarytool keychain profile.}"
notary_credentials=(--keychain-profile "$CAGE_NOTARY_PROFILE")
if [[ -n "${CAGE_NOTARY_KEYCHAIN:-}" ]]; then
  notary_credentials+=(--keychain "$CAGE_NOTARY_KEYCHAIN")
fi
if [[ "$CAGE_SIGNING_IDENTITY" == - ]]; then echo 'Release packages require a Developer ID identity.' >&2; exit 1; fi
version="$(tr -d '\n\r' < VERSION)"
release="$PWD/_output/releases/$version"
bundle="$PWD/_output/Cage.app"
mkdir -p "$release"
if [[ "${1:-}" != --from-notarized-app ]]; then
  bash scripts/build-app.sh
  ditto -c -k --keepParent "$bundle" "$release/Cage-notarization.zip"
  xcrun notarytool submit "$release/Cage-notarization.zip" \
    "${notary_credentials[@]}" --wait --timeout 20m \
    --output-format json > "$release/app-notarization.json"
  node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1])); if(r.status!=="Accepted") throw new Error(`Apple notarization: ${r.status}; submission ${r.id}`)' "$release/app-notarization.json"
  xcrun stapler staple "$bundle"
fi
actual_version="$(/usr/libexec/PlistBuddy -c 'Print :CageVersion' "$bundle/Contents/Info.plist")"
if [[ "$actual_version" != "$version" ]]; then echo 'App version differs from VERSION; rebuild before packaging.' >&2; exit 1; fi
codesign --verify --deep --strict --verbose=2 "$bundle"
xcrun stapler validate "$bundle"
spctl --assess --type execute --verbose=2 "$bundle"
guest_source="cage-macos-guest-$version-source.tar.gz"
guest_materials="$bundle/Contents/Resources/guest-os/sources/$guest_source"
node scripts/guest-os/collect-macos-sshfs-sources.mjs verify "$guest_materials" \
  "$bundle/Contents/Resources/guest-os/project/cage-sshfs" "$version"
# Copy only the source frozen by this App build, including the final signed
# helper hash. Packaging must not substitute newer Homebrew source material.
cp "$guest_materials" "$release/$guest_source"

stage="$(mktemp -d "$PWD/_output/dmg-stage.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
ditto "$bundle" "$stage/Cage.app"
ln -s /Applications "$stage/Applications"
cat > "$stage/Installation Notes - Read Me.txt" <<'EOF'
Cage: isolated local coding workspace

1. Drag Cage.app into Applications.
2. Open Cage from Applications, set up a local account, and follow the first-run guide to choose the guest system, storage location, and proxy.
3. Add your own Clash/Mihomo YAML subscription or configuration and choose a node, then create and start the environment. The first run downloads a system image and tools, so stay connected to the internet.
4. Open a project or a new terminal, type claude, and sign in to your own Claude account in the Cage browser.

Requires an Apple Silicon Mac and macOS 14 or later. You do not need to install Go, Node.js, or Clash.
You need to provide your own proxy service and Claude account. See the release notes for the exact version and release status.
Changes to files in shared projects are written directly back to the Mac; back up important projects.
Before upgrading, quit Cage and stop the environment, then replace the app; configuration and project files are kept.

Drag Cage.app into Applications, then open it from Applications.
Complete the local account and environment setup, add your own Clash/Mihomo
YAML subscription or configuration, select a node, and start the environment.
Initial setup downloads the selected guest system and developer tools.
Requires Apple Silicon and macOS 14+. Your own proxy and Claude account are required.

Getting started:
https://github.com/Lee-xeo/Claude-Cage/blob/main/docs/getting-started.md
Issues:
https://github.com/Lee-xeo/Claude-Cage/issues
EOF
artifact="Cage-$version-macos-arm64.dmg"
hdiutil create -volname Cage -srcfolder "$stage" -ov -format UDZO "$release/$artifact"
codesign --force --sign "$CAGE_SIGNING_IDENTITY" --timestamp "$release/$artifact"
xcrun notarytool submit "$release/$artifact" "${notary_credentials[@]}" \
  --wait --timeout 20m --output-format json > "$release/dmg-notarization.json"
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1])); if(r.status!=="Accepted") throw new Error(`Apple notarization: ${r.status}; submission ${r.id}`)' "$release/dmg-notarization.json"
xcrun stapler staple "$release/$artifact"
xcrun stapler validate "$release/$artifact"
spctl --assess --type open --context context:primary-signature --verbose=2 "$release/$artifact"

# Distribute the corresponding unmodified Mihomo source beside its executable.
core_version="$(sed -n 's/^version=//p' scripts/fetch-proxy-core.sh)"
core_source="mihomo-$core_version-source.tar.gz"
curl --fail --location --retry 2 --connect-timeout 15 --max-time 180 \
  "https://github.com/MetaCubeX/mihomo/archive/refs/tags/$core_version.tar.gz" \
  -o "$release/$core_source.part"
mv "$release/$core_source.part" "$release/$core_source"
tar -tzf "$release/$core_source" > /dev/null
(cd "$release" && shasum -a 256 "$artifact" "$core_source" "$guest_source" > SHA256SUMS)
node scripts/cleanup-apps.mjs --keep "$bundle" --root "$PWD/_output"
printf 'Verified release artifacts:\n%s/%s\n%s/%s\n%s/%s\n%s/SHA256SUMS\n' "$release" "$artifact" "$release" "$core_source" "$release" "$guest_source" "$release"
