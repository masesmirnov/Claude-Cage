import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createWorkbench } from "./workbench-fixture.mjs";

for (const system of ["macos", "windows-11", "debian"]) {
  const calls = [];
  let moved = false;
  let failInventory = false;
  const fixture = await createWorkbench({ beforeNavigate: async (page, state) => {
    state.account.guest_system = state.status.guest_system = system;
    state.status.ready = state.status.vm_running = true;
    await page.route("**/api/environment/cache/**", async route => {
      const action = new URL(route.request().url()).pathname.split("/").at(-1);
      const input = route.request().postDataJSON();
      calls.push({ action, input });
      if (action === "inventory") {
        if (failInventory) return route.fulfill({ status: 409, contentType: "text/plain; charset=utf-8", body: "Test: take the inventory again; existing data is kept." });
        return route.fulfill({ json: {
          version: 1, plan_id: "fixture-preview", scope: "fixture-scope", platform: system,
          items: [
            { id: "cli-default", title: "Claude Code · Default account cache", location: "~/.claude/cache", bytes: 1024, files: 1, state: moved ? "absent" : "ready", reason: "Regenerable cache; a recovery copy is kept." },
            { id: "browser-0", title: "Browser · Cache", location: "Browser profile/Cache", bytes: 2048, files: 2, state: "blocked", reason: "A related client is running, so the cache was kept." },
          ],
          protected: [{ title: "Accounts, sessions and custom settings", present: 4, unknown: 0 }],
          batches: moved ? [{ id: "a".repeat(32), created_at: 1794600000, count: 1 }] : [],
          notice: "Only metadata is checked; credentials and session contents are not read.",
        } });
      }
      if (action === "clean") {
        assert.deepEqual(input, { plan_id: "fixture-preview", items: ["cli-default"] });
        moved = true;
        return route.fulfill({ json: { version: 1, status: "complete", outcomes: [{ id: "cli-default", state: "moved", reason: "Moved into a recovery batch." }] } });
      }
      assert.equal(action, "restore");
      assert.equal(input.batch, "a".repeat(32));
      return route.fulfill({ json: { version: 1, status: "partial", outcomes: [{ id: "cli-default", state: "failed", reason: "New data was created in the original location; restoring will not overwrite it." }] } });
    });
  } });
  const { page, browser, errors } = fixture;
  try {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("navigation", { name: "Settings groups" }).getByRole("button", { name: "Environment and recovery", exact: true }).click();
    const panel = page.getByRole("region", { name: "Environment cleanup" });
    await panel.getByRole("button", { name: "Read-only inventory", exact: true }).waitFor();
    assert.equal(calls.length, 0, "Opening settings must not inspect or clean");
    await panel.getByRole("button", { name: "Read-only inventory", exact: true }).click();
    const cli = panel.getByRole("checkbox", { name: "Claude Code · Default account cache", exact: true });
    await cli.waitFor();
    assert.equal(await cli.isChecked(), false);
    assert.equal(await panel.getByRole("checkbox", { name: "Browser · Cache", exact: true }).isDisabled(), true);
    await mkdir("output/cache-maintenance", { recursive: true });
    await panel.screenshot({ path: `output/cache-maintenance/${system}.png` });
    await cli.check();
    await panel.getByRole("button", { name: "Clean selected caches (1)", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Clean the selected caches?", exact: true });
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /Accounts, sign-ins, sessions, projects and persistent disks are kept/);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.deepEqual(calls.map(call => call.action), ["inventory"]);
    await panel.getByRole("button", { name: "Clean selected caches (1)", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Clean the selected caches?", exact: true });
    await dialog.getByRole("button", { name: "Clean caches", exact: true }).click();
    await panel.getByRole("status").getByText("Cache cleanup finished; recovery copies were kept", { exact: true }).waitFor();
    await panel.getByRole("button", { name: "Restore this cache batch", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Restore this cache batch?", exact: true });
    await dialog.getByRole("button", { name: "Restore caches", exact: true }).click();
    await panel.getByText("Some items did not finish; see the reasons", { exact: true }).waitFor();
    await panel.getByText(/New data was created in the original location/).first().waitFor();
    failInventory = true;
    await panel.getByRole("button", { name: "Take inventory again", exact: true }).click();
    await panel.getByRole("alert").filter({ hasText: "Take the inventory again" }).waitFor();
    assert.equal(await panel.getByRole("checkbox").count(), 0, "Failed inventory must not retain stale selections");
    assert.deepEqual(calls.map(call => call.action), ["inventory", "clean", "inventory", "restore", "inventory", "inventory"]);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ system, passed: true, actions: calls.map(call => call.action) }));
  } finally { await browser.close(); }
}
