import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createWorkbench } from "./workbench-fixture.mjs";

const evidence = process.env.CAGE_INITIALIZATION_EVIDENCE;
if (evidence) await fs.mkdir(evidence, { recursive: true });

{
  const ip = "203.0.113.10";
  let bindings = 0, stops = 0, starts = 0;
  let rejectBinding = true, disconnectOnStop = false, disconnected = false;
  const savedMessage = "Fixed exit saved. Restart the macOS guest, sign in, then run the checks again.";
  const f = await createWorkbench({
    initialization: { required: true, tracked: true, started: true },
    beforeNavigate: async (page, state) => {
      state.account.guest_system = "macos";
      Object.assign(state.status, { guest_system: "macos", ready: true, vm_running: true, safety: { gate: { mode: "closed" } } });
      await page.route("**/api/status", route => disconnected
        ? route.fulfill({ status: 503, contentType: "text/plain; charset=utf-8", body: "Test: connection lost after stopping" })
        : route.fulfill({ json: { ...state.status, workspace: state.settings.workspace } }));
      await page.route("**/api/macos/exit-policy", route => {
        assert.equal(route.request().method(), "POST");
        assert.deepEqual(route.request().postDataJSON(), { ip });
        bindings++;
        if (rejectBinding) return route.fulfill({ status: 409, contentType: "text/plain; charset=utf-8", body: "Exit sample expired. Run the network check again." });
        state.status.job = { id: `bind-${bindings}`, kind: "settings", running: true, message: "Saving the fixed exit" };
        return route.fulfill({ json: state.status.job });
      });
      await page.route("**/api/stop", route => {
        stops++;
        state.status.job = { id: `stop-${stops}`, kind: "stop", running: true, message: "Stopping the guest" };
        if (disconnectOnStop) disconnected = true;
        return route.fulfill({ json: state.status.job });
      });
      await page.route("**/api/start", route => {
        assert.equal(state.status.vm_running, false, "start must wait for the accepted stop to finish");
        assert.equal(state.status.job.kind, "stop");
        assert.equal(state.status.job.running, false);
        assert.ok(!state.status.job.error);
        starts++;
        Object.assign(state.status, { ready: true, vm_running: true, job: { id: `start-${starts}`, kind: "start", running: true, message: "Starting and checking the guest" } });
        // The backend accepted the start, but its response did not reach the UI.
        return route.fulfill({ status: 502, contentType: "text/plain; charset=utf-8", body: "The response to the start request was interrupted in transit" });
      });
    },
  });
  const { page, state } = f;
  page.setDefaultTimeout(5000);
  const bind = page.getByRole("button", { name: `Bind the detected fixed exit ${ip}`, exact: true });
  const restart = () => page.getByRole("button", { name: /^(Restart|Start) the guest and check again$/ });
  const confirm = async (name) => {
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name, exact: true }).click();
  };
  try {
    await page.getByRole("heading", { name: "Environment started, waiting for network checks", exact: true }).waitFor();
    assert.equal(await bind.count(), 0, "no candidate must offer no binding");
    state.status.safety.macos_exit_candidate = { ip };
    await bind.waitFor(); // Red against the original initialization screen: the entry is missing.
    if (evidence) await page.screenshot({ path: `${evidence}/macos-exit-candidate.png`, fullPage: true });
    await bind.click();
    await page.getByRole("dialog").getByText(/After saving, restart the guest and check again/).waitFor();
    await confirm("Cancel");
    assert.equal(bindings, 0, "cancel must not bind an exit");
    await bind.click(); await confirm("Bind fixed exit");
    await page.getByRole("alert").filter({ hasText: "Exit sample expired" }).first().waitFor();
    assert.equal(bindings, 1);
    assert.equal(stops + starts, 0);

    rejectBinding = false;
    await bind.click(); await confirm("Bind fixed exit");
    await page.getByText("Saving the fixed exit", { exact: true }).waitFor();
    assert.ok(await bind.isDisabled());
    assert.equal(await restart().count(), 0, "an accepted settings job is not a saved exit");
    state.status.job = { ...state.status.job, running: false, error: "Fixed exit not saved: the location service is temporarily unavailable" };
    await page.getByRole("alert").filter({ hasText: "Fixed exit not saved" }).first().waitFor();
    assert.equal(stops + starts, 0, "save failure must not restart");

    await bind.evaluate(button => { button.click(); button.click(); });
    await confirm("Bind fixed exit");
    await page.getByText("Saving the fixed exit", { exact: true }).waitFor();
    await bind.evaluate(button => { button.click(); button.click(); });
    assert.equal(bindings, 3, "duplicate clicks must not submit another binding");
    state.status.job = { ...state.status.job, running: false, message: "Completed" };
    delete state.status.safety.macos_exit_candidate;
    state.status.safety.error = savedMessage;
    await restart().waitFor();
    assert.equal(await page.getByRole("button", { name: "Enter the workbench", exact: true }).count(), 0);
    await page.setViewportSize({ width: 600, height: 650 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (evidence) await page.screenshot({ path: `${evidence}/macos-exit-saved-compact.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 850 });
    await restart().click(); await confirm("Cancel");
    assert.equal(stops, 0, "cancel must preserve the running guest");
    await restart().click(); await confirm("Restart and check");
    await page.getByText("Stopping the guest", { exact: true }).waitFor();
    assert.equal(starts, 0, "a running stop job must not start the guest");
    state.status.job = { ...state.status.job, running: false, error: "Stopping the guest failed" };
    await page.getByRole("alert").filter({ hasText: "Stopping the guest failed" }).first().waitFor();
    assert.equal(starts, 0, "stop failure must not start the guest");

    disconnectOnStop = true;
    await restart().click(); await confirm("Restart and check");
    await page.getByRole("alert").filter({ hasText: "connection lost after stopping" }).first().waitFor();
    assert.equal(starts, 0, "lost status must not authorize a start");
    disconnected = false;
    disconnectOnStop = false;
    state.status.job = { id: "stop-2", kind: "stop", running: false, error: "The stop request was interrupted. The guest is still running." };
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent === "Restart the guest and check again" && !button.disabled));
    await restart().click(); await confirm("Restart and check");
    await page.getByText("Stopping the guest", { exact: true }).waitFor();
    assert.equal(starts, 0);
    Object.assign(state.status, { ready: false, vm_running: false, job: { id: "stop-3", kind: "stop", running: false } });
    await page.getByText("Starting and checking the guest", { exact: true }).waitFor();
    assert.equal(starts, 1);
    assert.equal(stops, 3);
    await page.getByRole("alert").filter({ hasText: "was interrupted in transit" }).first().waitFor();
    assert.equal(await page.getByRole("button", { name: "Enter the workbench", exact: true }).count(), 0);
    state.status.job = { ...state.status.job, running: false };
    state.status.safety = { gate: { mode: "open", until: new Date(Date.now() + 3600000).toISOString() } };
    await page.getByRole("button", { name: "Enter the workbench", exact: true }).waitFor();
    assert.equal(await restart().count(), 0, "a lost start response must not hide a later verified open gate");
    await page.reload();
    await page.getByRole("button", { name: "Enter the workbench", exact: true }).click();
    await page.getByRole("complementary", { name: "Projects and terminals" }).waitFor();
    assert.deepEqual(f.errors, []);
    console.log("PASS macOS exit: explicit binding, cancellation, save failures, stop-before-start, disconnect recovery, lost start response and network completion gate");
  } finally { await f.browser.close(); }
}

for (const [platform, system] of [["darwin", "macos"], ["windows", "windows-11"], ["linux", "ubuntu-22.04"]]) {
  let starts = 0, rejectComplete = true;
  let directory = "/preview/cage-state";
  const initialDirectory = platform === "windows" ? "/preview/Cage/CageData" : directory;
  const fixture = await createWorkbench({
    initialization: { required: true, tracked: true, started: false },
    clientContext: { mode: "local", connection_id: "local", client_platform: platform, server_platform: platform },
    beforeNavigate: async (page, state) => {
      // Audio is outside this initialization flow; avoid unrelated in-flight audio requests during reload.
      await page.addInitScript(() => localStorage.setItem("cage.audio", JSON.stringify({ muted: true })));
      state.status.local_vm_storage = true;
      await page.route("**/api/environment/storage", route => {
        if (route.request().method() === "POST") {
          assert.equal(route.request().postDataJSON().previous, directory);
          directory = route.request().postDataJSON().directory;
          state.status.job = { id: "storage-default", kind: "storage", running: false };
          return route.fulfill({ json: state.status.job });
        }
        return route.fulfill({ json: { directory, has_environment: false, suggested_directory: directory === "/preview/cage-state" ? initialDirectory : undefined } });
      });
      await page.route("**/api/environment/guest-systems", route => route.fulfill({ json: { fresh: true, available: true, system, linux_systems: ["ubuntu-22.04"] } }));
      await page.route("**/api/environment/guest-systems/clone", route => route.fulfill({ json: { key: "matched-image", enough_space: true, minimum_free_gib: 51, free_gib: 120, download_bytes: 19769944180, plan: { host: { system, version: system === "windows-11" ? "25H2" : "26.5", build: "123", edition: "Professional", language: "zh-CN" }, version: "26.5", build: "456", bytes: 19769944180 } } }));
      await page.route("**/api/start", route => {
        starts++;
        const submitted = route.request().postDataJSON();
        assert.equal(submitted.guest_system, system);
        if (starts === 1) assert.equal(submitted.clone_key, "matched-image");
        state.status.job = { id: "install-" + starts, running: true, kind: "guest-install", setup_progress: { system, phase: "image", operation: "download", label: "Downloading the system image", received: 25 * 1048576, total: 100 * 1048576, bytes_per_second: 1048576 }, log: "Image download started" };
        return route.fulfill({ json: state.status.job });
      });
      await page.route("**/api/environment/initialization", route => {
        const action = route.request().method() === "POST" ? route.request().postDataJSON()?.action : "";
        if (action === "complete" && rejectComplete) return route.fulfill({ status: 400, contentType: "text/plain; charset=utf-8", body: "The environment network check has not passed yet. Check again." });
        if (action === "install") state.initialization.started = true;
        if (action === "complete") state.initialization.required = false;
        return route.fulfill({ json: state.initialization });
      });
    },
  });
  const { page, state, errors, browser } = fixture;
  try {
    assert.equal(await page.getByRole("complementary", { name: "Projects and terminals" }).count(), 0);
    const picker = page.getByRole("combobox", { name: "Guest system" });
    const storage = page.getByRole("region", { name: "Environment storage directory" });
    await storage.getByLabel("Storage directory", { exact: true }).waitFor();
    assert.equal(await storage.getByLabel("Storage directory", { exact: true }).inputValue(), initialDirectory);
    await storage.getByText("This is Cage's environment data directory. Updating, reinstalling or uninstalling the app keeps the data here; do not delete it manually.").waitFor();
    assert.equal(await storage.getByText("Current environment directory", { exact: true }).count(), 0);
    assert.equal(await storage.getByText("New storage location", { exact: true }).count(), 0);
    await page.locator(".initialization-content").evaluate(async element => {
      await Promise.all(element.getAnimations({ subtree: true })
        .filter(animation => animation.animationName === "initialization-enter")
        .map(animation => animation.finished));
    });
    const before = await storage.boundingBox();
    await picker.click();
    const option = page.getByRole("option", { name: "Match this computer's system version automatically", exact: true });
    await option.waitFor();
    for (const name of [/^Debian/, /^Ubuntu/, /^macOS/, /^Windows/]) assert.equal(await page.getByRole("option", { name }).count(), 1);
    const expanded = await storage.boundingBox();
    assert.ok(Math.abs(expanded.y - before.y) < 1, "floating system choices must not move storage");
    const menu = await page.getByRole("listbox").boundingBox();
    assert.ok(menu.x >= 0 && menu.y >= 0 && menu.x + menu.width <= 1280 && menu.y + menu.height <= 850, "floating menu must stay inside the viewport");
    if (evidence) await page.screenshot({ path: `${evidence}/${platform}-systems-floating.png`, fullPage: true });
    await picker.press("Home"); await picker.press("Enter");
    await page.getByText("Cage will detect this computer's system version and show the matching official image, download size and space requirements in the next step.").waitFor();
    await page.getByText(/The system image downloads over the host network.*system proxy or TUN/).waitFor();
    if (system === "windows-11") await page.getByRole("checkbox").check();
    if (evidence) await page.screenshot({ path: `${evidence}/${platform}-system.png`, fullPage: true });
    await page.getByRole("button", { name: "Next: configure proxy" }).click();
    await page.getByRole("heading", { name: "Connect your network proxy" }).waitFor();
    await page.getByText("Matches an official image to this computer's system version and installs it in a separate guest.").waitFor();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("combobox", { name: "Guest system" }).getByText("Match this computer's system version automatically").waitFor();
    await page.getByRole("button", { name: "Next: configure proxy" }).click();
    await page.getByRole("button", { name: "Start installation", exact: true }).click();
    const progress = page.getByRole("region", { name: "Environment installation progress" });
    await progress.getByText("25 MiB / 100 MiB", { exact: true }).waitFor();
    assert.equal(await progress.getByRole("progressbar").getAttribute("aria-valuenow"), "25");
    assert.equal(await page.getByRole("complementary", { name: "Projects and terminals" }).count(), 0);
    await page.reload();
    await progress.getByText("25 MiB / 100 MiB", { exact: true }).waitFor();
    assert.equal(starts, 1, "refresh must not restart the accepted installation");
    state.status.job = { ...state.status.job, running: false, error: "Download interrupted. Partial files were saved." };
    await progress.getByRole("alert").waitFor();
    if (evidence) await page.screenshot({ path: `${evidence}/${platform}-failed.png`, fullPage: true });
    await progress.getByRole("button", { name: "Continue installation", exact: true }).click();
    await progress.getByRole("progressbar").waitFor();
    assert.equal(starts, 2);
    await page.setViewportSize({ width: 600, height: 650 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (evidence) await page.screenshot({ path: `${evidence}/${platform}-progress-compact.png`, fullPage: true });
    state.status.job = { id: "install-2", kind: "start", running: false, message: "Environment started, network checks did not pass", error: "Network check did not pass: the browser check channel returned HTTP 503. Internet access stays off." };
    Object.assign(state.status, { ready: true, vm_running: true, safety: { gate: { mode: "closed" } } });
    await page.getByRole("heading", { name: "Environment started, waiting for network checks", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Continue installation", exact: true }).count(), 0);
    let networkChecks = 0;
    await page.route("**/api/safety/check", route => {
      networkChecks++;
      state.status.job = { id: "retry-network", kind: "safety", running: true, message: "Checking network conditions" };
      return route.fulfill({ json: state.status.job });
    });
    await page.getByRole("button", { name: "Run network and isolation checks", exact: true }).click();
    await page.getByText("Checking network conditions", { exact: true }).waitFor();
    assert.equal(networkChecks, 1);
    assert.equal(starts, 2, "network recovery must not restart installation");
    state.status.job = { id: "install-2", kind: "start", running: false };
    Object.assign(state.status, { ready: true, vm_running: true, safety: { gate: { mode: "open", until: new Date(Date.now() + 3600000).toISOString() } } });
    await page.getByRole("button", { name: "Enter the workbench", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "network checks" }).waitFor();
    assert.equal(await page.getByRole("complementary", { name: "Projects and terminals" }).count(), 0, "server completion rejection must keep initialization visible");
    rejectComplete = false;
    await page.getByRole("button", { name: "Enter the workbench", exact: true }).click();
    await page.getByRole("complementary", { name: "Projects and terminals" }).waitFor();
    await page.evaluate(() => window.cageNativeAction("settings"));
    await page.getByRole("region", { name: "Settings", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("complementary", { name: "Projects and terminals" }).waitFor();
    await page.evaluate(() => window.cageNativeAction("quit"));
    const quitDialog = page.getByRole("dialog", { name: "Quit Cage", exact: true });
    await quitDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await page.getByRole("heading", { name: "Prepare a separate environment for Cage" }).count(), 0);
    assert.deepEqual(errors, []);
    console.log(`PASS ${platform}: independent initialization, inline keyboard selection, back navigation, progress, refresh, retry, completion gate and reopen`);
  } finally { await browser.close(); }
}

{
  let location = { directory: "/preview/default-state", has_environment: false }, writes = 0, fail = true;
  const f = await createWorkbench({ initialization: { required: true, tracked: true }, beforeNavigate: async (page, state) => {
    state.status.local_vm_storage = true;
    await page.route("**/api/environment/guest-systems", route => route.fulfill({ json: { fresh: true, available: true, system: "macos", linux_systems: ["ubuntu-22.04"] } }));
    await page.route("**/api/environment/storage", route => {
      if (route.request().method() === "GET") return route.fulfill({ json: location });
      const body = route.request().postDataJSON();
      writes++;
      assert.equal(body.previous, "/preview/default-state");
      assert.equal(body.migrate, false);
      if (fail) return route.fulfill({ status: 400, contentType: "text/plain; charset=utf-8", body: "Choose a dedicated empty folder." });
      location = { ...location, directory: body.directory };
      state.status.job = { id: "save-storage", kind: "storage", running: false };
      return route.fulfill({ json: state.status.job });
    });
  } });
  try {
    const input = f.page.getByLabel("Storage directory", { exact: true });
    assert.equal(await input.inputValue(), "/preview/default-state");
    await input.fill("/preview/chosen-state");
    assert.equal(writes, 0, "editing must not save before Next");
    await f.page.getByRole("button", { name: "Next: configure proxy" }).click();
    await f.page.getByRole("alert").filter({ hasText: "Choose a dedicated empty folder." }).waitFor();
    assert.equal(await input.inputValue(), "/preview/chosen-state");
    assert.equal(await f.page.getByRole("heading", { name: "Connect your network proxy" }).count(), 0);
    fail = false;
    await f.page.getByRole("button", { name: "Next: configure proxy" }).click();
    await f.page.getByRole("heading", { name: "Connect your network proxy" }).waitFor();
    assert.equal(location.directory, "/preview/chosen-state");
    assert.equal(writes, 2);
    await f.page.getByRole("button", { name: "Back", exact: true }).click();
    assert.equal(await input.inputValue(), "/preview/chosen-state");
    assert.deepEqual(f.errors, []);
    console.log("PASS storage: one default-filled directory, save on Next, rejected path preserved, retry and back navigation");
  } finally { await f.browser.close(); }
}

{
  let imported = false, applied = false;
  const f = await createWorkbench({ initialization: { required: true, tracked: true }, beforeNavigate: async (page, state) => {
    state.status.local_vm_storage = true;
    await page.route("**/api/environment/storage", route => route.fulfill({ json: { directory: "/preview/cage-state", has_environment: false } }));
    await page.route("**/api/environment/guest-systems", route => route.fulfill({ json: { fresh: true, available: true, system: "macos" } }));
    await page.route("**/api/proxy", route => route.fulfill({ json: { active: applied, selected: applied ? "node" : "", sources: imported ? [{ id: "source", name: "Own node", nodes: [{ id: "node", name: "Local test proxy", type: "socks5" }] }] : [], port: 17896, core_available: true } }));
    for (const action of ["import", "route"]) await page.route(`**/api/proxy/${action}`, route => {
      if (action === "import") imported = true;
      else applied = true;
      state.status.job = { id: action, kind: "proxy", running: false, message: "Completed" };
      return route.fulfill({ json: state.status.job });
    });
  } });
  try {
    const { page } = f;
    await page.getByRole("button", { name: "Next: configure proxy" }).click();
    const start = page.getByRole("button", { name: "Start installation", exact: true });
    assert.ok(await start.isDisabled());
    await page.getByRole("button", { name: "Add source", exact: true }).click();
    await page.getByRole("button", { name: "Manual node", exact: true }).click();
    await page.getByLabel("Source name", { exact: true }).fill("Own node");
    await page.getByLabel("Node name", { exact: true }).fill("Local test proxy");
    await page.getByLabel("Server", { exact: true }).fill("127.0.0.1");
    await page.getByRole("button", { name: "Import and verify", exact: true }).click();
    await page.getByRole("tab", { name: "Nodes", exact: true }).click();
    await page.getByRole("button", { name: "Select node Local test proxy", exact: true }).click();
    await page.getByRole("button", { name: "Apply proxy", exact: true }).click();
    await page.getByText("Completed", { exact: true }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Start installation' && !button.disabled));
    assert.deepEqual(f.errors, []);
    console.log("PASS first proxy: manual import, node selection and explicit apply unlock installation inside initialization");
  } finally { await f.browser.close(); }
}
