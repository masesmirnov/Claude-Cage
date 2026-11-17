import assert from "node:assert/strict";
import { createWorkbench } from "./workbench-fixture.mjs";

for (const platform of ["darwin", "windows", "linux"]) {
  for (const install of [false, true]) {
    let gitRequests = 0;
    const f = await createWorkbench({
      initialization: { required: install, tracked: install },
      waitForReady: !install,
      clientContext: { mode: "local", connection_id: "local", client_platform: platform, server_platform: platform },
      beforeNavigate: async page => {
        if (install) await page.route("**/api/environment/storage", route => route.fulfill({ json: { directory: "/preview/cage-state", has_environment: false } }));
        await page.route("**/api/host/git", route => { gitRequests++; return route.fulfill({ status: 503, body: "Git is unavailable" }); });
      },
    });
    try {
      const { page, state, errors } = f;
      if (install) {
        await page.getByRole("button", { name: "Next: configure proxy" }).click();
        await page.getByRole("button", { name: "Start installation", exact: true }).click();
      } else {
        await page.getByRole("button", { name: "Start Cage environment", exact: true }).click();
      }
      await page.getByRole(install ? "button" : "heading", { name: install ? "Enter the workbench" : "The Cage environment is ready", exact: true }).waitFor();
      assert.equal(state.requests.filter(request => request.path === "/start").length, 1);
      assert.equal(state.requests.some(request => request.path === "/host/git"), false);
      assert.equal(await page.getByText(/enable.*Git.*protection|protect local Git/i).count(), 0);
      await page.reload();
      assert.equal(state.requests.some(request => request.path === "/host/git"), false);
      assert.equal(gitRequests, 0);
      assert.deepEqual(errors, []);
      console.log(`PASS: ${platform} ${install ? "installation" : "startup"} without host Git checks or writes`);
    } finally { await f.browser.close(); }
  }
}
