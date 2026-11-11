import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chooseInline, createWorkbench } from "./workbench-fixture.mjs";

const output = new URL("../../docs/test-reports/2026-11-07-user-feedback/", import.meta.url);
await fs.mkdir(output, { recursive: true });
const { browser, page, state, errors } = await createWorkbench();
try {
  state.settings.exit_policy = { mode: "dynamic", scope: "city", country_code: "JP", region: "Kanagawa", city: "Yokohama" };
  await page.reload();
  await page.route("**/api/settings/probe", route => route.fulfill({ json: {
    ip: "192.0.2.10", country: "Japan", country_code: "JP", region: "Kanagawa", city: "Kawasaki",
    timezone: "Asia/Tokyo", checked_at: new Date().toISOString(),
  } }));
  const openSettings = async () => {
    await page.getByRole("button", { name: /^Settings/ }).click();
    await page.getByRole("button", { name: "Network and proxy", exact: true }).click();
  };
  await openSettings();
  await page.getByText("Exits in mainland China are never allowed; static IPs and any-region also require confirming the exit country.", { exact: true }).waitFor();
  const picker = page.getByRole("combobox", { name: "Allowed range for dynamic IPs", exact: true });
  const layoutTop = locator => locator.evaluate(element => {
    let top = element.getBoundingClientRect().top;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) top += parent.scrollTop;
    return top;
  });
  const country = page.getByLabel("Allowed country/region code", { exact: true });
  await country.click();
  assert.equal(await page.getByRole("option", { name: "China", exact: true }).count(), 0, "mainland must not be offered as an allowed exit country");
  await country.press("Escape");
  const before = await layoutTop(country);
  await picker.click();
  const options = page.getByRole("listbox");
  await options.waitFor();
  const expanded = await layoutTop(country);
  const list = await options.boundingBox();
  assert.ok(Math.abs(expanded - before) < 1, "floating options must not move the following fields");
  assert.ok(list.height > 0, "options must remain visible");
  await picker.press("ArrowDown");
  await picker.press("Enter");
  await page.getByLabel("Allowed city", { exact: true }).waitFor({ state: "hidden" });
  assert.equal(await picker.getAttribute("value"), "region");
  assert.equal(await page.getByLabel("State/province", { exact: true }).inputValue(), "Kanagawa");
  await page.getByRole("button", { name: "Check current exit", exact: true }).click();
  await page.getByText("Japan · Kanagawa · Kawasaki", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Fill in from check result", exact: true }).click();
  await page.screenshot({ path: fileURLToPath(new URL("region-settings.png", output)), fullPage: true });
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await page.getByRole("heading", { name: "Network and proxy", exact: true }).waitFor({ state: "hidden" });
  assert.equal(state.settings.exit_policy.scope, "region");
  assert.equal(state.settings.exit_policy.region, "Kanagawa");
  assert.equal(state.settings.exit_policy.country_code, "JP");
  assert.equal(state.settings.exit_policy.city, "Yokohama", "relaxing the scope must preserve the previously saved city");
  await page.reload();
  await openSettings();
  assert.equal(await picker.getAttribute("value"), "region");
  assert.equal(await page.getByLabel("State/province", { exact: true }).inputValue(), "Kanagawa");
  await chooseInline(picker, "city");
  assert.equal(await page.getByLabel("Allowed city", { exact: true }).inputValue(), "Yokohama");
  await picker.click();
  await picker.press("Escape");
  assert.equal(await picker.getAttribute("aria-expanded"), "false");
  await chooseInline(picker, "any");
  assert.match(await picker.textContent(), /except mainland China/);
  await page.getByText(/hits a mainland China range, is located in mainland China, its region cannot be confirmed/).waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS: inline mouse/keyboard expansion, region binding, city preservation, save and reload");
} finally { await browser.close(); }
