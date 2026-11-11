import assert from "node:assert/strict";
import { createWorkbench } from "./workbench-fixture.mjs";

const { browser, page, errors } = await createWorkbench();
const windowsRuntime = process.env.CAGE_RESOURCE_RUNTIME === "hyperv";
let allocation = { automatic: true, memory_gib: 12, cpus: 5 };
let rejectSave = false;
const saves = [];
await page.route("**/api/environment/resources", async (route) => {
  if (route.request().method() === "POST") {
    if (rejectSave) return route.fulfill({ status: 400, contentType: "text/plain; charset=utf-8", body: "Saving the resource settings failed" });
    const body = route.request().postDataJSON();
    saves.push(body);
    if (body.allocation) allocation = body.allocation.automatic ? { automatic: true, memory_gib: 12, cpus: 5 } : body.allocation;
    return route.fulfill({ json: { ok: true } });
  }
  return route.fulfill({ json: { ...allocation, ...(windowsRuntime ? { runtime: "hyperv", min_memory_gib: 4, min_cpus: 2 } : {}), running: false, recommended_memory_bytes: 12 * 2 ** 30, recommended_cpus: 5, max_memory_gib: 12, max_cpus: 5 } });
});
async function open() {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("navigation", { name: "Settings groups" }).getByRole("button", { name: "Environment and recovery", exact: true }).click();
  await page.getByLabel("Memory limit (GiB)", { exact: true }).waitFor();
}
try {
  await open();
  assert.equal(await page.getByRole("button", { name: "Save resource settings", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Restore default", exact: true }).isDisabled(), true);
  if (windowsRuntime) {
    assert.equal(await page.getByLabel("Memory limit (GiB)", { exact: true }).getAttribute("min"), "4");
    assert.equal(await page.getByLabel("Number of CPU logical cores", { exact: true }).getAttribute("min"), "2");
    await page.getByLabel("Memory limit (GiB)", { exact: true }).fill("3");
    await page.getByRole("button", { name: "Save resource settings", exact: true }).click();
    assert.equal(saves.length, 0);

  }
  await page.getByLabel("Memory limit (GiB)", { exact: true }).fill("4");
  await page.getByLabel("Number of CPU logical cores", { exact: true }).fill("2");
  assert.equal(await page.getByText("No unsaved changes", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Back to the workbench", exact: true }).click();
  const discard = page.getByRole("dialog", { name: "Discard unsaved changes?", exact: true });
  await discard.waitFor();
  await discard.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.getByLabel("Memory limit (GiB)", { exact: true }).inputValue(), "4");
  await page.screenshot({ path: "/tmp/cage-resource-settings.png", fullPage: true });
  await page.getByRole("button", { name: "Save resource settings", exact: true }).click();
  await page.getByText("Saved; it takes effect the next time the environment starts.", { exact: true }).waitFor();
  assert.deepEqual(allocation, { automatic: false, memory_gib: 4, cpus: 2 });
  await page.reload();
  await open();
  assert.equal(await page.getByLabel("Memory limit (GiB)", { exact: true }).inputValue(), "4");
  assert.equal(await page.getByLabel("Number of CPU logical cores", { exact: true }).inputValue(), "2");
  const count = saves.length;
  await page.getByLabel("Memory limit (GiB)", { exact: true }).fill("13");
  await page.getByRole("button", { name: "Save resource settings", exact: true }).click();
  assert.equal(saves.length, count);
  await page.getByLabel("Memory limit (GiB)", { exact: true }).fill("6");
  rejectSave = true;
  await page.getByRole("button", { name: "Save resource settings", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Saving the resource settings failed" }).waitFor();
  await page.waitForResponse(response => response.url().endsWith("/api/environment/resources") && response.request().method() === "GET" && response.ok());

  assert.equal(await page.getByRole("alert").filter({ hasText: "Saving the resource settings failed" }).isVisible(), true);
  assert.equal(await page.getByLabel("Memory limit (GiB)", { exact: true }).inputValue(), "6");
  rejectSave = false;
  await page.getByRole("button", { name: "Restore default", exact: true }).click();
  assert.equal(await page.getByLabel("Memory limit (GiB)", { exact: true }).inputValue(), "12");
  assert.equal(await page.getByLabel("Number of CPU logical cores", { exact: true }).inputValue(), "5");
  assert.equal(allocation.automatic, false, "reset stays a draft until saved");
  await page.getByRole("button", { name: "Save resource settings", exact: true }).click();
  await page.getByText("Saved; it takes effect the next time the environment starts.", { exact: true }).waitFor();
  assert.equal(allocation.automatic, true);
  await page.reload();
  await open();
  assert.equal(await page.getByRole("button", { name: "Restore default", exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel("Memory limit (GiB)", { exact: true }).inputValue(), "12");
  assert.equal(await page.getByRole("alert").filter({ hasText: "Saving the resource settings failed" }).count(), 0);
  assert.deepEqual(errors, []);
  console.log("Resource settings: manual save, reload, bounds, failure retention, defaults, editing, reset and persistence passed.");
} finally { await browser.close(); }
