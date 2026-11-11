import assert from "node:assert/strict";
import { createWorkbench } from "./workbench-fixture.mjs";

for (const system of ["macos", "windows-11", "debian"]) {
  const calls = [];
  const native = system !== "debian";
  const fixture = await createWorkbench({ beforeNavigate: async (page, state) => {
    state.account.guest_system = state.status.guest_system = system;
    state.status.vm_running = state.status.ready = true;
    await page.route("**/api/environment/versions", route => route.fulfill({ json: {
      vm_running: true, tools_update_allowed: true,
      components: { status: "update_required", update_required: true },
      controller: { version: "fixture-controller" },
      tools: { claude: { current: "2.1.300", required: "2.1.311" }, node: { current: "v24.22.2", required: "24.22.2" } },
      maintenance: native ? { native: true, guest_system: system, requires_closed_terminals: true } : undefined,
    } }));
    for (const operation of ["update", "tools"]) {
      await page.route(`**/api/environment/${operation}`, route => {
        calls.push(operation);
        return route.fulfill({ status: 409, contentType: "text/plain; charset=utf-8", body: "Save your work, end any running terminals and Claude Code turns, then retry the update." });
      });
    }
  } });
  const { page, browser, errors } = fixture;
  try {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("navigation", { name: "Settings groups" }).getByRole("button", { name: "Environment and recovery", exact: true }).click();
    const panel = page.getByRole("region", { name: "Environment versions", exact: true });
    await panel.getByText("2.1.300", { exact: true }).waitFor();
    await panel.getByText("2.1.311", { exact: true }).waitFor();
    for (const operation of ["components", "tools"]) {
      await panel.getByRole("button", { name: `Update environment ${operation}`, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: `Update environment ${operation}?`, exact: true });
      const text = await dialog.innerText();
      if (native) {
        assert.ok(text.includes("end any running terminals and Claude Code turns"));
        assert.ok(text.includes("chat history, project files and sign-in data are kept"));
        assert.equal(text.includes("verify the administrator account bound to the guest"), system === "windows-11");
      } else {
        assert.ok(text.includes("workbench terminals, project files and sign-in state are kept"));
      }
      await dialog.getByRole("button", { name: `Update ${operation}`, exact: true }).click();
      await panel.getByRole("alert").filter({ hasText: "end any running terminals" }).waitFor();
    }
    assert.deepEqual(calls, ["update", "tools"]);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ system, passed: true, calls }));
  } finally {
    await browser.close();
  }
}
