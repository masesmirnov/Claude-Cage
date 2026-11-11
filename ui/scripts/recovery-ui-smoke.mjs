import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { smokeCaptureDirectory } from "./smoke-captures.mjs";
import { createWorkbench } from "./workbench-fixture.mjs";

const output = await smokeCaptureDirectory("recovery-ui");
const calls = [];
let update = { phase: "available", currentVersion: "0.2.0-alpha.1", latestVersion: "0.2.0-alpha.2", message: "New version found. Update ready to download", retryable: true };
const fixture = await createWorkbench({ nativeRequest: async (body) => {
  calls.push(body);
  if (body.action === "workbenchReady") return true;
  if (body.action !== "appUpdate") return null;
  if (body.operation === "install") update = { ...update, phase: "downloading", receivedBytes: 50, totalBytes: 100, message: "Downloading update" };
  if (body.operation === "cancel") update = { ...update, phase: "available", message: "Update paused. Resume later" };
  return update;
} });
const { browser, page, state, errors } = fixture;
const checks = [];
try {
  await page.getByRole("button", { name: "Download update", exact: true }).waitFor();
  const button = page.getByRole("button", { name: "Download update", exact: true });
  assert.match(await button.getAttribute("title"), /clicking stops the environment, installs and restarts automatically/);
  const bounds = await button.boundingBox();
  assert.ok(bounds.x < 248 && bounds.y > 700, "update action is not in the bottom-left sidebar");
  await page.screenshot({ path: join(output, "update-available.png") });
  await button.click();
  assert.equal(calls.filter((call) => call.operation === "install").length, 1);
  await page.getByRole("progressbar", { name: "Update download progress" }).waitFor();
  assert.equal(await page.getByRole("progressbar").getAttribute("aria-valuenow"), "50");
  assert.equal(await page.getByRole("dialog", { name: "Cage update" }).count(), 0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("cage-app-update", { detail: { phase: "failed", latestVersion: "0.2.0-alpha.2", message: "The update source is temporarily unreachable. The repository is not public yet", retryable: true } })));
  await page.getByRole("button", { name: "Retry update", exact: true }).waitFor();
  await page.getByRole("alert").filter({ hasText: "The update source is temporarily unreachable. The repository is not public yet" }).waitFor();
  checks.push("bottom-left update affordance", "single install request without a dialog", "inline ring progress", "private source failure visible");

  const downloads = [{ id: "qa-download", name: "report.txt", state: "failed", error: "The target directory is temporarily not writable", retryable: true }];
  let retries = 0, editorRestarts = 0, componentUpdates = 0;
  await page.route("**/api/browser/tabs", (route) => route.fulfill({ json: { tabs: state.tabs, active: state.active, downloads } }));
  await page.route("**/api/browser/download-retry", (route) => {
    assert.deepEqual(route.request().postDataJSON(), { id: "qa-download" });
    retries++;
    Object.assign(downloads[0], { state: "saved", retryable: false, error: "", path: "/Users/you/Cage/Downloads/report.txt" });
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/browser/editor-restart", (route) => {
    assert.equal(route.request().postDataJSON().workspace, state.settings.workspace);
    editorRestarts++;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/environment/versions", (route) => route.fulfill({ json: {
    vm_running: true, controller: { version: "0.2.0-alpha.2" }, components: { status: "update_required", update_required: true },
    tools: { chromium: { current: "156", required: "System security update" }, code_server: { current: "4.100", required: "4.144.0" } }, tools_update_allowed: false,
  } }));
  await page.route("**/api/environment/update", (route) => { componentUpdates++; return route.fulfill({ json: { id: "qa-components" } }); });
  await page.getByRole("button", { name: "Start Cage environment", exact: true }).click();
  await page.getByRole("heading", { name: "The Cage environment is ready", exact: true }).waitFor();
  await page.getByRole("button", { name: "Open browser", exact: true }).click();
  await page.getByRole("button", { name: "Browser downloads", exact: true }).click();
  await page.getByRole("dialog", { name: "Downloaded files" }).getByText("The target directory is temporarily not writable", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await page.getByText("Saved to this computer", { exact: true }).waitFor();
  assert.equal(retries, 1);
  await page.screenshot({ path: join(output, "download-recovery.png") });
  await page.getByRole("dialog", { name: "Downloaded files" }).getByRole("button", { name: "Close panel" }).click();
  await page.getByRole("button", { name: "Open the editor for Default workspace", exact: true }).click();
  await page.getByRole("button", { name: "Browser menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Restore editor", exact: true }).click();
  await page.getByRole("dialog", { name: "Restart the editor?" }).getByRole("button", { name: "Restart editor", exact: true }).click();
  await page.getByText("Editor restored", { exact: true }).waitFor();
  assert.equal(editorRestarts, 1);
  assert.equal(state.status.vm_running, true);
  checks.push("download retry reports durable save", "editor recovery leaves VM running");
  await page.getByRole("button", { name: "Settings", exact: false }).first().click();
  await page.getByRole("button", { name: "Environment and recovery", exact: true }).click();
  await page.getByRole("region", { name: "Environment versions" }).getByText("Update required", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Update environment tools", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Update environment tools", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, "environment-versions.png") });
  await page.getByRole("button", { name: "Update environment components", exact: true }).click();
  await page.getByRole("dialog", { name: "Update environment components?" }).getByRole("button", { name: "Update components", exact: true }).click();
  await page.waitForTimeout(50);
  assert.equal(componentUpdates, 1);
  assert.ok(calls.some((call) => call.action === "workbenchReady"), "successful initialized workbench did not acknowledge launch");
  assert.deepEqual(errors, []);
  checks.push("environment versions and guarded tool update", "explicit component update", "initialized workbench launch acknowledgement");
} finally { await browser.close(); }

let prematureReady = false;
const broken = await createWorkbench({ startupFailure: true, nativeRequest: async (body) => {
  if (body.action === "workbenchReady") prematureReady = true;
  return { phase: "current", currentVersion: "0.2.0-alpha.2" };
} });
try {
  await broken.page.waitForResponse((response) => response.url().endsWith("/api/status") && response.status() === 503);
  await broken.page.waitForTimeout(100);
  assert.equal(prematureReady, false, "failed API initialization acknowledged update success");
  checks.push("startup failure never acknowledges upgrade");
} finally { await broken.browser.close(); }
await fs.writeFile(join(output, "ui-checks.json"), JSON.stringify({ checks }, null, 2));
console.log(JSON.stringify({ checks }));
