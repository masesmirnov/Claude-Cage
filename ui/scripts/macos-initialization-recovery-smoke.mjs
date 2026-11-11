import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createWorkbench } from "./workbench-fixture.mjs";
const evidence = process.env.CAGE_INITIALIZATION_EVIDENCE;
if (evidence) await fs.mkdir(evidence, { recursive: true });

for (const mode of ["project-approval", "legacy", "guest-login", "filesystem-permission", "network", "restart"]) {
  let connected = false, checks = 0, starts = 0, stopped = false, stopFinished = false;
  const workspace = "/preview/shared-workspace";
  const fixture = await createWorkbench({ initialization: { required: true, tracked: true, started: true, prepared: true }, beforeNavigate: async (page, state) => {
    Object.assign(state.account, { guest_system: "macos" });
    state.settings.workspace = workspace;
    Object.assign(state.status, { guest_system: "macos", ready: true, vm_running: true, workspace, environment_directory: "/preview/other-directory", safety: { gate: { mode: "closed" }, error: "Workspace access has not been allowed yet.", report: { checks: [{ id: "filesystem_boundary", title: "Shared files and host-private directory", state: "unknown", evidence: "Guest folder authorization was not completed", remedy: "Allow workspace access, then continue" }] } }, network_error: "The built-in proxy is not ready. Internet access stays off.", job: { id: "failed-check", kind: "safety", running: false, message: "Checking network conditions failed", error: "Allow this project in the guest authorization window shown by Cage, then verify the authorization.", ...(mode === "legacy" ? {} : { recovery: mode === "restart" ? "environment-restart" : mode, workspace }) }, project_errors: [] });
    if (mode === "project-approval") state.status.project_errors = [{ path: workspace, recovery: "project-approval", message: "Allow workspace access." }];
    await page.route("**/api/projects/open", route => {
      assert.equal(route.request().postDataJSON().workspace, workspace);
      assert.equal(route.request().postDataJSON().add, false);
      return route.fulfill({ json: connected ? { workspace } : { workspace, approval: "scoped-grant" } });
    });
    await page.route("**/api/macos/project-approval", route => route.fulfill({ json: { error: "waiting" } }));
    await page.route("**/api/safety/check", route => {
      checks++;
      state.status.job = { id: "checking", kind: "safety", running: false, message: "Completed" };
      state.status.safety = { gate: { mode: "open", until: new Date(Date.now() + 600000).toISOString() } };
      state.status.project_errors = [];
      return route.fulfill({ json: state.status.job });
    });
    await page.route("**/api/stop", route => {
      stopped = true; state.status.job = { id: "stop-once", kind: "stop", running: true, message: "Stopping" };
      setTimeout(() => { stopFinished = true; state.status.job.running = false; state.status.vm_running = false; }, 300);
      return route.fulfill({ json: state.status.job });
    });
    await page.route("**/api/start", route => {
      assert.ok(stopped && stopFinished, "start ran before stop completed"); starts++; state.status.vm_running = true;
      state.status.job = { id: "restarted", kind: "start", running: false, message: "Completed" };
      return route.fulfill({ json: state.status.job });
    });
  }});
  const { page, state, browser, errors } = fixture;
  try {
    await page.getByRole("heading", { name: "Environment started, waiting for network checks", exact: true }).waitFor();
    await page.getByRole("button", { name: "View operation details", exact: true }).click();
    const details = page.getByRole("dialog", { name: "Setup operation details" });
    await details.getByText("Allow this project in the guest authorization window shown by Cage, then verify the authorization.", { exact: true }).waitFor();
    await details.getByText("Guest folder authorization was not completed", { exact: true }).waitFor();
    await details.getByRole("button", { name: "Close panel" }).click();
    if (mode === "guest-login") await page.getByRole("button", { name: "Sign in to the guest account", exact: true }).waitFor();
    if (mode === "filesystem-permission") await page.getByRole("button", { name: "Open guest authorization settings", exact: true }).waitFor();
    if (["project-approval", "legacy"].includes(mode)) {
      const action = mode === "project-approval" ? "Open workspace authorization" : "Connect to the workspace and continue checks";
      if (evidence) await page.screenshot({ path: `${evidence}/${mode}.png`, fullPage: true });
      await page.reload();
      await page.getByRole("button", { name: action, exact: true }).click();
      const approval = page.getByRole("dialog", { name: "Allow the guest to access the selected project" });
      await approval.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal(checks, 0, "cancel must not start network verification");
      await page.getByRole("button", { name: action, exact: true }).click();
      await approval.getByRole("button", { name: "Verify authorization", exact: true }).waitFor();
      connected = true;
      await approval.getByRole("button", { name: "Verify authorization", exact: true }).click();
      await page.getByRole("button", { name: "Enter the workbench", exact: true }).waitFor();
      assert.equal(checks, 1);
    } else if (mode === "restart") {
      await page.getByRole("button", { name: "Save, restart and check", exact: true }).click();
      await page.getByRole("dialog", { name: "Restart the virtual Mac and check?" }).getByRole("button", { name: "Restart and check", exact: true }).click();
      await page.waitForFunction(() => ![...document.querySelectorAll('[role="dialog"]')].length);
      await page.getByRole("button", { name: "View operation details" }).waitFor();
      await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(b => b.textContent === 'Stop installation'));
      assert.equal(starts, 1);
    } else {
      await page.getByRole("button", { name: "Run network and isolation checks", exact: true }).click();
      await page.getByRole("button", { name: "Enter the workbench", exact: true }).waitFor();
    }
    await page.setViewportSize({ width: 390, height: 700 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`PASS macOS initialization: ${mode}, precise details and recovery without reinstalling`);
  } finally { await browser.close(); }
}
