import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createWorkbench } from "./workbench-fixture.mjs";

const output = new URL("../../docs/test-reports/2026-11-04-desktop-memory/", import.meta.url);
await fs.mkdir(output, { recursive: true });
const { browser, page, state, errors } = await createWorkbench();
let unavailable = true;
const desktop = { installed: true, running: false, failed: true, failure_reason: "oom-kill", version: "4.4212.0" };
await page.route("**/api/claude-desktop**", async route => {
  if (route.request().method() === "POST") {
    return route.fulfill({ status: 502, body: "Test: open failed. Try again." });
  }
  if (unavailable) return route.fulfill({ status: 502, body: "Cannot read the Claude Desktop status. Try again." });
  return route.fulfill({ json: desktop });
});
try {
  state.status.vm_running = true;
  state.status.ready = true;
  await page.reload();
  await page.getByRole("button", { name: "Claude Desktop", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Cannot read the Claude Desktop status" }).waitFor();
  unavailable = false;
  await page.getByRole("button", { name: "Refresh Claude Desktop status", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "The environment ran out of memory" }).waitFor();
  assert.equal(await page.getByText("Cannot read the Claude Desktop status. Try again.", { exact: true }).count(), 0);
  await page.screenshot({ path: new URL("oom-message.png", output).pathname });
  desktop.failed = false;
  desktop.failure_reason = "";
  await page.getByRole("button", { name: "Refresh Claude Desktop status", exact: true }).click();
  await page.getByRole("alert").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Open Claude Desktop", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "open failed" }).waitFor();
  await page.getByRole("button", { name: "Refresh Claude Desktop status", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "open failed" }).waitFor();
  assert.deepEqual(errors, []);
  const checks = ["status recovery clears stale read error", "OOM reason displayed", "healthy status clears OOM message", "status polling preserves failed user operation"];
  await fs.writeFile(new URL("ui-checks.json", output), JSON.stringify({ complete: true, checks }, null, 2));
  console.log(JSON.stringify({ complete: true, checks }));
} finally { await browser.close(); }
