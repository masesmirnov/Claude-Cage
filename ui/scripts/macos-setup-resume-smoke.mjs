import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createWorkbench } from "./workbench-fixture.mjs";
const evidence = process.env.CAGE_INITIALIZATION_EVIDENCE;
if (evidence) await fs.mkdir(evidence, { recursive: true });
for (const scenario of ["permission-read", "start-failure", "open-failure"]) {
  const permissions = { screen: true, input: false, projects: false, managed_credential: false };
  let failRead = true, failAction = true, starts = 0, finishes = 0, permissionReads = 0;
  const f = await createWorkbench({ waitForReady: false, beforeNavigate: async (page, state) => {
    Object.assign(state.account, { initial_mac_setup: true, guest_system: "macos", macos_credentials_ready: true });
    Object.assign(state.status, { ready: scenario !== "start-failure", vm_running: scenario !== "start-failure" });
    await page.route("**/api/start", route => {
      starts++;
      if (failAction) return route.fulfill({ status: 409, contentType: "text/plain", body: "Startup failed. The existing disk was kept." });
      Object.assign(state.status, { ready: true, vm_running: true });
      return route.fulfill({ json: { id: "resumed", running: false } });
    });
    await page.route("**/api/macos/first-setup", route => {
      const { action } = route.request().postDataJSON();
      if (action === "permissions") {
        permissionReads++;
        if (scenario === "permission-read" && failRead && permissionReads > 1) return route.fulfill({ status: 409, contentType: "text/plain", body: "The guest connection was briefly interrupted" });
        return route.fulfill({ json: permissions });
      }
      if (action === "finish") { finishes++; state.account.initial_mac_setup = false; }
      if (action === "input" && scenario === "open-failure" && failAction) return route.fulfill({ status: 409, contentType: "text/plain", body: "The authorization page cannot be opened right now. Try again." });
      return route.fulfill({ json: {} });
    });
  }});
  const { page, browser, errors, state } = f;
  try {
    await page.getByRole("heading", { name: "Finish the virtual Mac's system authorizations" }).waitFor();
    if (scenario === "start-failure") {
      await page.getByRole("alert").filter({ hasText: "Startup failed" }).waitFor();
      assert.equal(starts, 1);
      failAction = false;
      await page.getByRole("button", { name: "Continue starting and connecting", exact: true }).click();
      await page.getByRole("button", { name: "Open Accessibility settings", exact: true }).waitFor();
      assert.equal(starts, 2);
    } else if (scenario === "permission-read") {
      await page.getByRole("list", { name: "System authorization progress" }).getByText("Verified", { exact: true }).waitFor();
      await page.getByRole("alert").filter({ hasText: "The guest connection was briefly interrupted" }).waitFor();
      assert.equal(await page.getByRole("list", { name: "System authorization progress" }).getByText("Verified", { exact: true }).count(), 1, "read failure erased measured permissions");
      permissions.input = true; permissions.projects = true;
      assert.equal(finishes, 0, "read failure advanced setup");
      if (evidence) await page.screenshot({ path: `${evidence}/permission-read-failure.png`, fullPage: true });
      failRead = false;
      await page.getByRole("button", { name: "Check status again", exact: true }).click();
      await page.getByRole("heading", { name: "Finish the virtual Mac's system authorizations" }).waitFor({ state: "hidden" });
      assert.equal(finishes, 1);
    } else {
      await page.getByRole("button", { name: "Open Accessibility settings", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "The authorization page cannot be opened right now" }).waitFor();
      failAction = false;
      await page.getByRole("button", { name: "Open Accessibility settings", exact: true }).click();
      await page.getByRole("alert").waitFor({ state: "hidden" });
      permissions.input = true;
      await page.getByRole("list", { name: "System authorization progress" }).getByText("Verified", { exact: true }).nth(1).waitFor();
      await page.getByRole("region", { name: "Current setup step" }).getByText(/Turn on both the macFUSE and macFUSE \(local\) switches/).waitFor();
      await page.reload();
      await page.getByRole("list", { name: "System authorization progress" }).getByText("Verified", { exact: true }).nth(1).waitFor();
      assert.equal(starts, 0, "refresh restarted installed VM");
      if (evidence) await page.screenshot({ path: `${evidence}/permissions-resumed.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 700 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    assert.ok(state.status.vm_running);
    console.log(`PASS macOS setup ${scenario}: actionable retry, measured state retention and resume`);
  } finally { await browser.close(); }
}
