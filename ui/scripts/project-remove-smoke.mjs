import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createWorkbench } from "./workbench-fixture.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ root, configFile: `${root}/vite.config.js`, server: { host: "127.0.0.1", port: 0 } });
await vite.listen();
const url = `http://127.0.0.1:${vite.httpServer.address().port}`;
try {
  for (const platform of ["darwin", "windows", "linux"]) {
    const { browser, page, state, errors } = await createWorkbench({ url, clientContext: { mode: "local", connection_id: "local", client_platform: platform, server_platform: platform, connection: { state: "disconnected" } } });
    try {
      const defaultProject = state.status.environment_directory;
      const project = "/projects/alpha";
      const other = "/projects/beta";
      Object.assign(state.status, { ready: true, vm_running: true, projects: [defaultProject, project, other], workspace: project });
      state.settings.workspace = project;
      await page.reload();
      await page.getByRole("button", { name: "Add project", exact: true }).click();
      let dialog = page.getByRole("dialog", { name: "Open project", exact: true });
      await dialog.getByRole("radio", { name: /alpha/ }).check();
      await dialog.getByRole("button", { name: "Remove this project from Cage" }).click();
      await dialog.getByRole("button", { name: "Cancel removal" }).click();
      assert.ok(state.status.projects.includes(project));
      state.failRemove = true;
      await dialog.getByRole("button", { name: "Remove this project from Cage" }).click();
      await dialog.getByRole("button", { name: "Confirm project removal" }).click();
      await dialog.getByRole("alert").waitFor();
      assert.ok(state.status.projects.includes(project));
      state.failRemove = false;
      await dialog.getByRole("button", { name: "Confirm project removal" }).click();
      await dialog.getByRole("radio", { name: /alpha/ }).waitFor({ state: "detached" });
      assert.deepEqual(state.status.projects, [defaultProject, other]);
      assert.equal(state.settings.workspace, defaultProject);
      assert.equal(await dialog.getByRole("button", { name: "Remove this project from Cage" }).count(), 0);
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("region", { name: "Project alpha", exact: true }).waitFor({ state: "detached" });
      Object.assign(state.status, { ready: false, vm_running: false });
      await page.reload();
      await page.getByRole("button", { name: "Add project", exact: true }).click();
      dialog = page.getByRole("dialog", { name: "Open project", exact: true });
      await dialog.getByRole("radio", { name: /beta/ }).check();
      assert.equal(await dialog.getByRole("button", { name: "Open project", exact: true }).isDisabled(), true);
      await dialog.getByRole("button", { name: "Remove this project from Cage" }).click();
      await dialog.getByRole("button", { name: "Confirm project removal" }).click();
      await dialog.getByRole("radio", { name: /beta/ }).waitFor({ state: "detached" });
      assert.deepEqual(state.status.projects, [defaultProject]);
      assert.deepEqual(errors, []);
      console.log(`PASS ${platform} project removal, cancellation, retry, default selection, stopped environment`);
    } finally { await browser.close(); }
  }
} finally { await vite.close(); }
