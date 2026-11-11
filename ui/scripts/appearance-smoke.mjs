import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chooseInline, createWorkbench } from "./workbench-fixture.mjs";
const output = fileURLToPath(
  new URL("../../docs/test-reports/2026-10-31-appearance/", import.meta.url),
);
await fs.mkdir(output, { recursive: true });
const { browser, page, state, errors } = await createWorkbench();
const checks = [];
const showAppearance = async () => {
  await page.getByRole("button", { name: /^Settings/ }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("heading", { name: "Appearance", exact: true }).waitFor();
};
const saved = () =>
  page
    .getByRole("status")
    .filter({ hasText: /Changes are saved automatically|Codex appearance synced/ })
    .waitFor();
const shot = async (name) => {
  await page.locator(".settings-content").evaluate((el) => el.scrollTo(0, 0));
  await page.screenshot({
    path: output + name + ".png",
    animations: "disabled",
  });
};
try {
  await page.emulateMedia({ colorScheme: "light" });
  await showAppearance();
  await page
    .getByRole("button", { name: "Sync from local Codex", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Codex appearance synced" })
    .waitFor();
  assert.equal(state.appearance.lightTheme.preset, "solarized");
  assert.equal(state.appearance.darkTheme.preset, "ayu");
  assert.equal(
    await page.getByLabel("Interface font size", { exact: true }).inputValue(),
    "16",
  );
  assert.equal(
    await page.getByLabel("Code font size", { exact: true }).inputValue(),
    "13",
  );
  await shot("appearance-light");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await saved();
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "dark",
  );
  assert.equal(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--paper"),
    ),
    "#10141c",
  );
  await shot("appearance-dark");
  await page.getByRole("button", { name: "Follow system", exact: true }).click();
  await saved();
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  checks.push("import local settings, independent light/dark theme saving, live follow-system switching, 16/13 font sizes");
  await page
    .getByRole("region", { name: "Dark theme", exact: true })
    .getByRole("button", { name: "Custom", exact: true })
    .click();
  await page.getByLabel("Dark theme code font", { exact: true }).fill("Menlo");
  await saved();
  await page.getByLabel("Dark theme translucent sidebar", { exact: true }).uncheck();
  await saved();
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.translucent),
    "false",
  );
  await page.getByRole("switch", { name: "Use pointer cursor", exact: true }).check();
  await saved();
  assert.equal(
    await page
      .getByRole("button", { name: "Dark", exact: true })
      .evaluate((el) => getComputedStyle(el).cursor),
    "pointer",
  );
  await chooseInline(page.getByLabel("Reduce motion", { exact: true }), "on");
  await saved();
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.reducedMotion),
    "true",
  );
  state.failAppearance = true;
  await page.getByLabel("Code font size", { exact: true }).fill("15");
  await page
    .getByRole("alert")
    .filter({ hasText: "Appearance settings could not be saved" })
    .waitFor();
  assert.equal(
    await page.getByLabel("Code font size", { exact: true }).inputValue(),
    "15",
  );
  assert.equal(state.appearance.codeFontSize, 13);
  state.failAppearance = false;
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await saved();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.getByRole("button", { name: "Follow system", exact: true }).click();
  await saved();
  await page.reload();
  await showAppearance();
  assert.equal(
    await page.getByLabel("Code font size", { exact: true }).inputValue(),
    "15",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Follow system", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(state.appearance.darkTheme.fonts.code, "Menlo");
  checks.push(
    "custom font/translucency/pointer/motion, keeping input and retrying after a failure, last write wins on rapid switching, read back after reload",
  );
  await page.setViewportSize({ width: 820, height: 558 });
  await shot("appearance-minimum");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.getByRole("button", { name: "Back to the workbench", exact: true }).click();
  await page.getByRole("button", { name: "Start Cage environment", exact: true }).click();
  await page
    .getByRole("button", { name: "New terminal", exact: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Regular terminal", exact: true }).click();
  await page.getByRole("tab", { name: "Terminal 1", exact: true }).waitFor();
  const count = state.terminalConnections;
  await showAppearance();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await saved();
  await page.getByRole("button", { name: "Back to the workbench", exact: true }).click();
  assert.equal(state.terminalConnections, count);
  assert.equal(
    await page
      .locator(".xterm-char-measure-element")
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize),
    "15px",
  );
  assert.ok(
    !state.requests.some(
      (request) => request.path === "/settings" && request.method === "POST",
    ),
  );
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.screenshot({
    path: output + "terminal-solarized.png",
    animations: "disabled",
  });
  checks.push(
    "820px settings scroll with no horizontal overflow, switching appearance keeps the terminal connection, the environment settings API is not called",
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    output + "smoke-result.json",
    JSON.stringify(
      {
        passed: true,
        checks,
        scope: "Isolated control API; source config import and disk writes are verified separately with the real service",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, checks }));
} finally {
  await browser.close();
}
