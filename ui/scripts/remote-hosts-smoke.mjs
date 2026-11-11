// Real client service and browser interaction, using only a fresh temp profile.
// No cloud host or personal Cage configuration is accessed.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CAGE_PLAYWRIGHT_MODULE || "playwright");
const executable = process.env.CAGE_CLIENT_BINARY;
if (!executable) throw new Error("Set CAGE_CLIENT_BINARY to the newly built client binary");
const profile = await mkdtemp(join(tmpdir(), "cage-remote-host-ui-"));
const artifacts = resolve(process.env.CAGE_REMOTE_QA_DIR || join(profile, "artifacts"));
await mkdir(artifacts, { recursive: true });
const service = spawn(executable, ["serve"], { env: { ...process.env, CLAUDE_CAGE_CONFIG: join(profile, "config.json") }, stdio: "ignore" });
let browser;
let page;
try {
  let control;
  for (let i = 0; i < 200; i++) {
    try { control = JSON.parse(await readFile(join(profile, "control.json"), "utf8")); break; }
    catch { if (service.exitCode !== null) throw new Error("Client service exited before publishing its private control record"); await new Promise((r) => setTimeout(r, 50)); }
  }
  assert.ok(control, "client service did not start");
  const origin = `http://localhost:${control.port}`;
  const launched = await fetch(`${origin}/api/launch`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ token: control.token }) });
  assert.equal(launched.status, 200);
  const entry = await launched.json();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CAGE_TEST_BROWSER_PATH });
  page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(entry.url);
  await page.getByRole("complementary", { name: "SSH hosts", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Enter the local workbench" }).count(), 0, "thin client must not offer local workloads");
  assert.equal(await page.getByRole("button", { name: "Create local account" }).count(), 0, "local account must not block remote setup");
  await page.getByRole("button", { name: "Add remote host" }).click();
  await page.getByLabel("Host name", { exact: true }).fill("Isolated UI test host");
  await page.getByLabel("Server address", { exact: true }).fill("127.0.0.1");
  await page.getByLabel("SSH port", { exact: true }).fill("9");
  await page.getByLabel("SSH username", { exact: true }).fill("cage-test");
  const auth = page.getByRole("combobox", { name: "SSH sign-in method" });
  const keyField = page.getByLabel("Local private key file", { exact: true });
  // Opening the floating list keeps both the dialog and its fields in place.
  const gap = async () => (await keyField.boundingBox()).y - (await auth.boundingBox()).y;
  const before = await gap();
  await auth.click();
  await page.getByRole("option", { name: "Local SSH agent" }).waitFor();
  const expanded = await keyField.boundingBox();
  assert.ok(Math.abs(await gap() - before) < 1, "floating choices must not move subsequent fields");
  const list = await page.getByRole("listbox").boundingBox();
  assert.ok(list.height > 0 && Math.abs(expanded.y - (await keyField.boundingBox()).y) < 1);
  await auth.press("Escape");
  assert.equal(await auth.getAttribute("aria-expanded"), "false");
  await page.getByRole("listbox").waitFor({state:"hidden"});
  assert.ok(Math.abs(await gap() - before) < 1, "closing choices restores layout");
  await auth.press("ArrowDown");
  await auth.press("ArrowDown");
  await auth.press("Enter");
  assert.equal(await auth.getAttribute("aria-expanded"), "false");
  assert.equal(await keyField.count(), 0, "keyboard selection switches authentication method");
  await auth.click();
  await page.getByRole("option", { name: "Local key file" }).click();
  await page.screenshot({ path: join(artifacts, "remote-host-form-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "mobile form should not overflow horizontally");
  await page.screenshot({ path: join(artifacts, "remote-host-form-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.getByLabel("Local private key file", { exact: true }).fill(join(profile, "missing-test-key"));
  await page.getByRole("button", { name: "Save host", exact: true }).click();
  await page.getByText("Isolated UI test host", { exact: true }).waitFor();
  await page.reload();
  await page.getByText("Isolated UI test host", { exact: true }).waitFor();
  const saved = JSON.parse(await readFile(join(profile, "remote-hosts.json"), "utf8"));
  assert.equal(saved.hosts.length, 1); assert.equal(saved.hosts[0].port, 9);
  await page.getByRole("button", { name: "Connect to this host" }).click();
  await page.getByText("The SSH key does not exist or its file permissions are unsafe.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("complementary", { name: "SSH hosts", exact: true }).count(), 1, "failed remote connection must retain host management");
  assert.equal(await page.getByRole("button", { name: "Create local account" }).count(), 0, "failure must not fall back to a local account");
  await page.screenshot({ path: join(artifacts, "remote-host-error.png"), fullPage: true });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Host name", { exact: true }).fill("Renamed test host");
  await page.getByRole("button", { name: "Save host", exact: true }).click();
  await page.getByText("Renamed test host", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Remove connection", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.getByText("Renamed test host", { exact: true }).count(), 1);
  await page.getByRole("button", { name: "Remove connection", exact: true }).click();
  await page.getByRole("button", { name: "Confirm removal", exact: true }).click();
  await page.getByText("No remote hosts yet", { exact: true }).waitFor();
  assert.deepEqual(JSON.parse(await readFile(join(profile, "remote-hosts.json"), "utf8")).hosts, []);
  assert.deepEqual(errors, []);
  const result = { ok: true, scope: "Real local cage-client service and Chromium; isolated temporary profile; connection failure path", checks: ["thin-client-no-local-account", "host-crud-and-persistence", "inline-dropdown-layout", "keyboard-choice", "mobile-layout", "connection-error-no-local-fallback", "remove-cancel-and-confirm"], notTested: ["Real cloud server connection and container workloads", "Native window interaction on macOS, Windows and Linux"], pageErrors: errors };
  await writeFile(join(artifacts, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, artifacts }));
} catch (error) {
  if (page) await page.screenshot({ path: join(artifacts, "failure.png"), fullPage: true }).catch(() => {});
  console.error(`UI evidence: ${artifacts}`);
  throw error;
} finally {
  await browser?.close();
  service.kill("SIGTERM");
}
