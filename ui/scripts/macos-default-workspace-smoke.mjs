import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkbench } from "./workbench-fixture.mjs";

const output = process.env.CAGE_WORKSPACE_QA_OUTPUT || await mkdtemp(join(tmpdir(), "cage-default-workspace-ui-"));
await mkdir(output, { recursive: true });
const notice = "This earlier session still uses its original guest directory, and its files stay inside the virtual Mac. To use the default workspace shared with the host, create a new session from the default workspace.";
let allowed = false;
let screenAllowed = false, frameReads = 0, frameReadsAtClick = 0;
const actions = [];
const maintenance = [];
const fixture = await createWorkbench({
  beforeNavigate: async (page, state) => {
    const panelImage = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = 260;
      const context = canvas.getContext("2d");
      context.fillStyle = "#eee";
      context.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    state.account.guest_system = state.status.guest_system = "macos";
    state.status.vm_running = state.status.ready = true;
    state.status.project_error = "In the virtual Mac's project authorization window, select this project, then reopen it.";
    state.status.project_errors = [{ path: state.settings.workspace, message: state.status.project_error }];
    await page.route("**/api/projects/open", async route => {
      actions.push(route.request().postDataJSON());
      if (allowed) {
        state.status.project_error = "";
        state.status.project_errors = [];
      }
      return route.fulfill({ json: { workspace: state.settings.workspace, ...(allowed ? {} : { approval: "fixture-grant" }) } });
    });
    await page.route("**/api/macos/project-approval", route => {
      if (route.request().postDataJSON().action === "click") {
        frameReadsAtClick = frameReads;
        return route.fulfill({ json: { error: "accessibility_permission" } });
      }
      frameReads++;
      return route.fulfill({ json: screenAllowed
        ? { image: panelImage, window: 1, pid: 5, nonce: "fixture" }
        : { error: "project_screen_permission" } });
    });
    await page.route("**/api/macos/maintenance", route => {
      const request = route.request().postDataJSON();
      maintenance.push(request);
      if (request.action === "open") return route.fulfill({ json: { session: "permission-fixture", maintenance_version: 1 } });
      if (request.action === "frame") return route.fulfill({ json: {
        image: panelImage, mime: "image/png", geometry: "permission-window", region: [100, 80, 480, 260], maintenance_version: 1,
      } });
      return route.fulfill({ json: { maintenance_version: 1 } });
    });
    await page.route("**/api/cli/sessions/*/account", route => route.fulfill({ json: { supported: false, candidates: [], session: {} } }));
    await page.routeWebSocket("**/api/terminals/**", socket => socket.send(Buffer.from("Isolated test terminal\r\n/Users/cage/.local/share/cage/workspace $ ")));
  },
});
const { page, state, browser, errors } = fixture;
try {
  await page.getByRole("button", { name: "Reconnect project", exact: true }).click();
  const project = page.getByRole("dialog", { name: "Open project", exact: true });
  await project.waitFor();
  assert.equal(await project.getByRole("textbox", { name: "New project folder", exact: true }).inputValue(), state.settings.workspace);
  await project.getByRole("button", { name: "Open project", exact: true }).click();
  const permission = page.getByRole("dialog", { name: "Allow the guest to access the selected project", exact: true });
  await permission.waitFor();
  await permission.getByText(state.settings.workspace, { exact: true }).waitFor();
  await permission.getByRole("status").filter({ hasText: "Screen & System Audio Recording" }).waitFor();
  await page.screenshot({ path: join(output, "default-workspace-approval.png"), animations: "disabled" });
  await permission.getByRole("button", { name: "Open guest authorization settings", exact: true }).click();
  const recovery = page.getByRole("dialog", { name: "Restore guest system permissions", exact: true });
  await recovery.getByRole("img").waitFor();
  assert.equal(maintenance.find(request => request.action === "open").maintenance, "screen");
  await recovery.getByRole("button", { name: "Back to the workbench", exact: true }).click();
  await recovery.waitFor({ state: "detached" });
  screenAllowed = true;
  await permission.getByRole("img").click();
  const inputError = permission.getByRole("alert").filter({ hasText: "accessibility" });
  await inputError.waitFor();
  await permission.getByRole("img").waitFor();
  assert.ok(frameReads > frameReadsAtClick, "next guest frame was fetched");
  assert.ok(await inputError.isVisible(), "polling must retain the failed click");
  await permission.getByRole("button", { name: "Open guest authorization settings", exact: true }).click();
  await recovery.getByRole("img").waitFor();
  assert.equal(maintenance.filter(request => request.action === "open").at(-1).maintenance, "input");
  await recovery.getByRole("button", { name: "Back to the workbench", exact: true }).click();
  await recovery.waitFor({ state: "detached" });
  allowed = true;
  await permission.getByRole("button", { name: "Verify authorization", exact: true }).click();
  await permission.waitFor({ state: "hidden" });
  assert.equal(actions.length, 2);
  assert.ok(actions.every(item => item.workspace === state.settings.workspace));

  state.terminals = [{ id: "legacy-default", kind: "claude", title: "Earlier default session", workspace: state.settings.workspace,
    cli_session_id: "01234567-1234-4234-8234-0123456789ab", workspace_notice: notice, closed: true }];
  await page.reload();
  await page.getByRole("tab", { name: "Earlier default session", exact: true }).click();
  await page.getByRole("status").filter({ hasText: notice }).waitFor();
  await page.screenshot({ path: join(output, "default-workspace-legacy-notice.png"), animations: "disabled" });
  assert.deepEqual(errors, []);
  const result = { passed: true, browser: browser.browserType().name(), actions, checks: ["default workspace reconnect opens existing project authorization", "missing screen permission opens its restricted recovery view", "click permission error survives the next frame and opens input recovery", "permission retry keeps the same host directory", "legacy guest-private workspace notice is visible in the terminal"] };
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }

{
  let grant = "", generation = 0, approved = false;
  const f = await createWorkbench({
    initialization: { required: true, tracked: true, started: true, prepared: true },
    async beforeNavigate(page, state) {
      state.account.guest_system = "macos";
      Object.assign(state.status, {
        guest_system: "macos", ready: true, vm_running: true,
        job: { kind: "safety", running: true, message: "Checking the guest network" },
        safety: { gate: { mode: "open", until: new Date(Date.now() + 3600000).toISOString() } },
        project_errors: [{ path: state.status.environment_directory, recovery: "project-approval" }],
      });
      const image = await page.evaluate(() => document.createElement("canvas").toDataURL().split(",")[1]);
      await page.route("**/api/projects/open", route => {
        const request = route.request().postDataJSON();
        assert.deepEqual(request, { workspace: state.status.environment_directory, add: false, activate: false });
        if (approved) state.status.project_errors = [];
        else if (!grant) grant = "setup-grant-" + ++generation;
        return route.fulfill({ json: { workspace: request.workspace, approval: approved ? "" : grant } });
      });
      await page.route("**/api/macos/project-approval", route => {
        const q = route.request().postDataJSON();
        if (!grant || q.grant !== grant) return route.fulfill({
          status: 409, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Cage-Recovery": "project-approval-ended" }, body: "The project authorization request has expired. Request authorization again.",
        });
        if (q.action === "frame") return route.fulfill({ json: { image, window: 1, pid: 2, nonce: grant } });
        if (q.action === "click") { assert.equal(q.nonce, grant); approved = true; }
        if (q.action === "cancel") grant = "";
        return route.fulfill({ json: {} });
      });
    },
  });
  try {
    const region = f.page.getByRole("region", { name: "Default workspace access" });
    const open = region.getByRole("button", { name: "View and authorize" });
    const dialog = f.page.getByRole("dialog", { name: "Allow the guest to access the selected project" });
    const enter = f.page.getByRole("button", { name: "Enter the workbench", exact: true });
    await open.waitFor();
    await region.getByText(f.state.status.environment_directory, { exact: true }).waitFor();
    assert.equal(await dialog.count(), 0);
    assert.equal(generation, 0, "polling must not open the guest dialog");
    await open.click();
    await dialog.getByText("The project authorization window appears once the current guest operation ends.").waitFor();
    assert.equal(generation, 0);
    f.state.status.job.running = false;
    await dialog.getByRole("img").waitFor();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(grant, "");
    await enter.waitFor();
    assert.ok(await enter.isEnabled(), "optional project approval cannot gate workbench entry");
    await open.click();
    await dialog.getByRole("img").waitFor();
    grant = "";
    await dialog.getByRole("button", { name: "Request authorization again" }).click();
    await dialog.getByRole("img").waitFor();
    assert.equal(generation, 3);
    await dialog.getByRole("button", { name: "Verify authorization" }).click();
    assert.equal(approved, false, "verification must not approve a pending project");
    await dialog.getByRole("img").click();
    await dialog.waitFor({ state: "hidden" });
    await enter.click();
    await f.page.getByRole("complementary", { name: "Projects and terminals" }).waitFor();
    assert.deepEqual(f.errors, []);
    console.log("PASS macOS initialization: default project approval, cancellation, expiry, renewal, verification and workbench entry");
  } finally { await f.browser.close(); }
}
