// Explicit preview publication only. Signed release/update policies are unchanged.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = 'Lee-xeo/Claude-Cage';
const gh = args => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const api = (path, args = []) => JSON.parse(gh(['api', `repos/${repo}/${path}`, ...args]));
const digest = data => createHash('sha256').update(data).digest('hex');

export function stagePreview(windows, linux, destination, version, dependencies) {
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  const expected = [
    [windows, [`Cage-${version}-windows-amd64-setup-unsigned.exe`, dependencies.mihomoSource.file, `${dependencies.qemuSource.file}.gz`]],
    [linux, [`Cage-${version}-linux-amd64.deb`, dependencies.mihomoSource.file]],
  ];
  const verified = new Map();
  for (const [directory, names] of expected) {
    const manifest = readFileSync(join(directory, 'SHA256SUMS'), 'utf8').replace(/^\uFEFF/, '');
    assert.ok(Buffer.byteLength(manifest) < 65536);
    const entries = new Map();
    for (const line of manifest.split(/\r?\n/).filter(Boolean)) {
      const match = /^([a-f0-9]{64}) [ *]([A-Za-z0-9][A-Za-z0-9._-]*)$/i.exec(line);
      assert.ok(match && !entries.has(match[2]), 'Invalid or duplicate platform checksum');
      entries.set(match[2], match[1].toLowerCase());
    }
    assert.deepEqual([...entries.keys()].sort(), [...names].sort(), 'Unexpected platform assets');
    for (const name of names) {
      const path = join(directory, name), stat = lstatSync(path);
      assert.ok(stat.isFile() && stat.size > 0 && stat.size <= 512 * 1024 * 1024);
      const actual = digest(readFileSync(path));
      assert.equal(actual, entries.get(name), `Corrupt artifact: ${name}`);
      if (verified.has(name)) assert.equal(verified.get(name).digest, actual, 'Conflicting source archives');
      else verified.set(name, { path, digest: actual, size: stat.size });
    }
  }
  // Do not copy reports or other artifact leftovers into a public release.
  mkdirSync(destination);
  for (const [name, file] of verified) copyFileSync(file.path, join(destination, name));
  const sums = [...verified].map(([name, file]) => `${file.digest}  ${name}\n`).join('');
  writeFileSync(join(destination, 'SHA256SUMS'), sums);
  verified.set('SHA256SUMS', { digest: digest(sums), size: Buffer.byteLength(sums) });
  return verified;
}

export function mergeReleaseChecksums(release, text, files, version) {
  assert.equal(release.tag_name, `v${version}`);
  assert.equal(release.draft, false);
  assert.equal(release.prerelease, true, 'Unsigned packages require a prerelease');
  const entries = new Map();
  for (const line of text.trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64}) [ *]([A-Za-z0-9][A-Za-z0-9._-]*)$/i.exec(line);
    assert.ok(match && !entries.has(match[2]), 'Invalid or duplicate existing checksum');
    entries.set(match[2], match[1].toLowerCase());
  }
  const assets = release.assets.filter(asset => asset.name !== 'SHA256SUMS');
  for (const name of entries.keys()) assert.ok(assets.some(asset => asset.name === name), 'Existing release is incomplete');
  assert.ok(entries.has(`Cage-${version}-macos-arm64.dmg`));
  for (const asset of assets) {
    assert.equal(asset.state, 'uploaded');
    // A retry may find uploaded platform files whose merged manifest is still pending.
    const expected = entries.get(asset.name) || files.get(asset.name)?.digest;
    assert.ok(expected, `Unlisted existing asset: ${asset.name}`);
    assert.equal(asset.digest, `sha256:${expected}`, `Existing checksum differs: ${asset.name}`);
  }
  for (const [name, file] of files) {
    if (name === 'SHA256SUMS') continue;
    if (entries.has(name)) assert.equal(entries.get(name), file.digest, `Conflicting release asset: ${name}`);
    entries.set(name, file.digest);
  }
  return [...entries].map(([name, hash]) => `${hash}  ${name}\n`).join('');
}

async function main() {
  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(process.env.GITHUB_REPOSITORY, repo);
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
  const runID = process.env.CAGE_PREVIEW_RUN;
  assert.match(runID || '', /^\d+$/);
  const run = api(`actions/runs/${runID}`);
  assert.equal(run.conclusion, 'success');
  assert.equal(run.path, '.github/workflows/ci.yml');
  assert.equal(run.head_repository.full_name, repo);
  assert.match(run.head_sha, /^[a-f0-9]{40}$/);
  const sourceFile = path => Buffer.from(api(`contents/${path}?ref=${run.head_sha}`).content, 'base64').toString('utf8');
  const version = sourceFile('VERSION').trim();
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  const dependencies = JSON.parse(sourceFile('packaging/windows/dependencies.json'));
  const root = '_output/platform-publication';
  const destination = join(root, 'public');
  const files = stagePreview(join(root, 'windows', version, 'windows'), join(root, 'linux', version, 'linux'), destination, version, dependencies);
  const tag = `v${version}`;
  let release = api(`releases/tags/${tag}`);
  const originalChecksums = release.assets.find(asset => asset.name === 'SHA256SUMS');
  assert.ok(originalChecksums && originalChecksums.size <= 65536);
  const response = await fetch(originalChecksums.browser_download_url);
  assert.ok(response.ok, 'Cannot read public checksum manifest');
  const originalText = await response.text();
  assert.equal(digest(originalText), originalChecksums.digest.replace('sha256:', ''));
  const merged = mergeReleaseChecksums(release, originalText, files, version);
  writeFileSync(join(destination, 'SHA256SUMS'), merged);
  files.set('SHA256SUMS', { digest: digest(merged), size: Buffer.byteLength(merged) });
  for (const [name, file] of files) {
    if (name === 'SHA256SUMS') continue;
    const existing = release.assets.find(asset => asset.name === name);
    if (existing) {
      assert.equal(existing.digest, `sha256:${file.digest}`, `Existing asset differs: ${name}`);
      assert.equal(existing.size, file.size);
    } else gh(['release', 'upload', tag, join(destination, name), '--repo', repo]);
  }
  // Upload the merged manifest last. Existing installation archives are never replaced.
  const uploaded = api(`releases/${release.id}`);
  for (const [name, file] of files) {
    if (name === 'SHA256SUMS') continue;
    const asset = uploaded.assets.find(asset => asset.name === name);
    assert.ok(asset && asset.state === 'uploaded');
    assert.equal(asset.digest, `sha256:${file.digest}`);
    assert.equal(asset.size, file.size);
  }
  assert.equal(uploaded.assets.find(asset => asset.name === 'SHA256SUMS').digest, originalChecksums.digest, 'Checksum manifest changed concurrently');
  if (originalChecksums.digest !== `sha256:${digest(merged)}`) {
    gh(['release', 'upload', tag, join(destination, 'SHA256SUMS'), '--repo', repo, '--clobber']);
  }
  release = api(`releases/${release.id}`);
  assert.equal(release.assets.find(asset => asset.name === 'SHA256SUMS').digest, `sha256:${digest(merged)}`);
  mergeReleaseChecksums(release, merged, files, version);
  const marker = `<!-- cage-platform-packages source=${run.head_sha} ci=${runID} -->`;
  if (!release.body.includes(marker)) {
    const notes = release.body + `\n\n## Windows and Linux downloads\n\n${marker}\n\nThis release also ships installers for all three platforms, sharing one SHA256SUMS. The macOS installer is unchanged; the Windows and Linux packages are built from the source at commit[${run.head_sha.slice(0, 7)}](https://github.com/${repo}/commit/${run.head_sha}), which contains the platform build fixes and differs from the build commit of the macOS tag.\n\n- **Windows: unsigned x64 preview**, file name contains -setup-unsigned.exe. Install and update it manually; the system may warn about an unknown publisher. It is not part of the signed automatic update channel.\n- **Linux: Debian 12 / Ubuntu 24.04 x86_64**. Download the .deb and install and update it through the system package manager.\n- [Three-platform CI](https://github.com/${repo}/actions/runs/${runID}) passed the Windows 2022/2025 installer and Debian 12 container acceptance. Hosted CI does not replace acceptance on every real device or with hardware virtualization.\n- Source code for the bundled Mihomo and QEMU binaries is included. Before upgrading, save your files, stop the environment and quit Cage.\n\n[Download for all three platforms on the website](https://lee-xeo.github.io/Claude-Cage/#download)\n`;
    const notesPath = join(root, 'notes.md'); writeFileSync(notesPath, notes);
    gh(['release', 'edit', tag, '--repo', repo, '--notes-file', notesPath]);
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\nurl=${release.html_url}\n`);
  console.log(`Verified platform packages in version release: ${release.html_url}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
