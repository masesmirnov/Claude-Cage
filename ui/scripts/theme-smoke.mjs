import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chooseInline, createWorkbench } from "./workbench-fixture.mjs";
import {
  themeDocument,
  parseThemeDocument,
  sameTheme,
} from "../src/appearance-state.mjs";
const output = fileURLToPath(
  new URL("../../docs/test-reports/2026-11-02-themes/", import.meta.url),
);
await fs.mkdir(output, { recursive: true });
let imported = "",
  exported,
  cancelExport = false;
const { browser, page, state, errors } = await createWorkbench({
  nativeRequest: (body) => {
    if (body.action === "importTheme") return imported;
    if (body.action === "exportTheme") {
      exported = body;
      return !cancelExport;
    }
    return true;
  },
});
const checks = [];
const open = async () => {
  await page.getByRole("button", { name: /^Settings/ }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("heading", { name: "Appearance", exact: true }).waitFor();
  await page.locator(".appearance-fields").evaluate((el) => {
    if (el.disabled) throw new Error("appearance still loading");
  });
};
const saved = async () => {
  await page
    .locator(".appearance-save-state")
    .filter({ hasText: /Changes are saved automatically|Codex appearance synced/ })
    .waitFor();
};
const edit = async (label, value) => {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(value);
  await input.press("Enter");
  await saved();
};
const light = () => page.getByRole("region", { name: "Light theme", exact: true });
const color = (key) =>
  page.evaluate(
    (key) => getComputedStyle(document.documentElement).getPropertyValue(key),
    key,
  );
const shot = async (name) => {
  await page.screenshot({
    path: output + name + ".png",
    animations: "disabled",
  });
};
try {
  await page.emulateMedia({ colorScheme: "light" });
  await open();
  await shot("themes-light");
  await edit("Light theme Background", "#fdf6e3");
  await light().getByRole("button", { name: "Custom", exact: true }).click();
  await light().getByText("Interface and layers", { exact: true }).click();
  await edit("Light theme Panel background", "#e8dec3");
  assert.equal(await color("--chrome"), "#e8dec3");
  await light().getByText("Buttons and interaction", { exact: true }).click();
  await edit("Light theme Primary button background", "#426b52");
  await edit("Light theme Primary button text", "#ffffff");
  assert.equal(await color("--button"), "#426b52");
  await light().getByText("Terminal", { exact: true }).click();
  await edit("Light theme terminal Background", "#101820");
  await light().getByText("Terminal ANSI colors", { exact: true }).click();
  await edit("Light theme terminal Red", "#f08080");
  await shot("themes-colors");
  const originalChrome = state.appearance.lightTheme.colors.chrome;
  await page.getByLabel("Light theme Panel background", { exact: true }).fill("#oops");
  await page.getByLabel("Light theme Panel background", { exact: true }).press("Tab");
  assert.equal(state.appearance.lightTheme.colors.chrome, originalChrome);
  await page.getByLabel("Light theme Panel background", { exact: true }).press("Escape");
  checks.push("base and element colors apply instantly, terminal and ANSI override independently, invalid HEX is not committed");
  await page.getByLabel("Theme name", { exact: true }).fill("Forest Daylight");
  await page.getByRole("button", { name: "Save as theme", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Theme saved" }).waitFor();
  assert.equal(state.appearance.customThemes.length, 1);
  const savedTheme = structuredClone(state.appearance.customThemes[0]);
  await edit("Light theme Background", "#eeeeee");
  await page
    .getByRole("button", { name: "Restore saved palette", exact: true })
    .click();
  await saved();
  assert.equal(state.appearance.lightTheme.surface, "#fdf6e3");
  await page.getByRole("button", { name: "Export theme", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Theme exported" }).waitFor();
  assert.ok(sameTheme(parseThemeDocument(exported.text), savedTheme));
  assert.equal(exported.filename, "Forest Daylight.cage-theme.json");
  cancelExport = true;
  await page.getByRole("button", { name: "Export theme", exact: true }).click();
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent === "Export theme",
      )?.disabled,
  );
  assert.equal(
    await page.getByRole("status").filter({ hasText: "Theme exported" }).count(),
    0,
  );
  cancelExport = false;
  const original = JSON.stringify(state.appearance);
  imported = "";
  await page.getByRole("button", { name: "Import theme", exact: true }).click();
  assert.equal(JSON.stringify(state.appearance), original);
  imported = '{"format":"cage-theme","version":2}';
  await page.getByRole("button", { name: "Import theme", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Unsupported theme format or version" })
    .waitFor();
  assert.equal(JSON.stringify(state.appearance), original);
  imported = exported.text;
  await page.getByRole("button", { name: "Import theme", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Theme imported and applied" })
    .waitFor();
  assert.equal(state.appearance.customThemes.length, 2);
  assert.ok(sameTheme(state.appearance, savedTheme));
  checks.push(
    "named save, switch and restore, native export content, same-name import does not overwrite, cancel and invalid file keep settings",
  );
  const second = state.appearance.customThemes[1];
  await edit("Light theme Background", "#f5efdd");
  await page.getByLabel("Theme name", { exact: true }).fill("Forest Daylight II");
  await page.getByRole("button", { name: "Update this theme", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Theme saved" }).waitFor();
  assert.equal(state.appearance.customThemes[1].id, second.id);
  assert.equal(state.appearance.customThemes[1].name, "Forest Daylight II");
  assert.equal(state.appearance.customThemes[0].name, "Forest Daylight");
  state.failAppearance = true;
  await page.getByLabel("Light theme Background", { exact: true }).fill("#fafafa");
  await page.getByLabel("Light theme Background", { exact: true }).press("Enter");
  await page
    .getByRole("alert")
    .filter({ hasText: "Appearance settings could not be saved" })
    .waitFor();
  assert.equal(await color("--paper"), "#fafafa");
  assert.equal(state.appearance.lightTheme.surface, "#f5efdd");
  state.failAppearance = false;
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await saved();
  await page.reload();
  await open();
  assert.equal(state.appearance.customThemes.length, 2);
  assert.equal(
    await page.getByLabel("Light theme Background", { exact: true }).inputValue(),
    "#fafafa",
  );
  await chooseInline(page
    .getByLabel("Saved themes", { exact: true }), second.id);
  await saved();
  assert.equal(
    await page.getByLabel("Light theme Background", { exact: true }).inputValue(),
    "#f5efdd",
  );
  // Codex sync must preserve the user's library.
  await page
    .getByRole("button", { name: "Sync from local Codex", exact: true })
    .click();
  await saved();
  assert.equal(state.appearance.customThemes.length, 2);
  await chooseInline(page
    .getByLabel("Saved themes", { exact: true }), second.id);
  await saved();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  assert.equal(state.appearance.customThemes.length, 2);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await saved();
  assert.equal(state.appearance.customThemes.length, 1);
  assert.equal(state.appearance.lightTheme.surface, "#f5efdd");
  checks.push(
    "update theme, failure keeps preview and retries, reload reads back, Codex sync keeps the theme library, delete confirmation and keeping the current palette",
  );
  // Exercise the actual browser file input and download fallback as well.
  await page.evaluate(() => {
    delete window.webkit;
  });
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export theme", exact: true }).click();
  const download = await downloadEvent;
  const path = output + "browser-export.cage-theme.json";
  await download.saveAs(path);
  const data = parseThemeDocument(await fs.readFile(path, "utf8"));
  assert.ok(sameTheme(data, state.appearance));
  await page.getByLabel("Choose theme file", { exact: true }).setInputFiles(path);
  await page
    .getByRole("status")
    .filter({ hasText: "Theme imported and applied" })
    .waitFor();
  assert.equal(state.appearance.customThemes.length, 2);
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await saved();
  await page.locator(".settings-content").evaluate((el) => el.scrollTo(0, 0));
  await shot("themes-dark");
  await page.setViewportSize({ width: 820, height: 558 });
  await shot("themes-minimum");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await light().getByRole("button", { name: "Custom", exact: true }).click();
  await light().getByText("Interface and layers", { exact: true }).click();
  const row = page.getByLabel("Light theme Panel background", { exact: true });
  await row.scrollIntoViewIfNeeded();
  await shot("themes-minimum-colors");
  const bounds = await row.boundingBox();
  assert.ok(bounds.x + bounds.width <= 820);
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await saved();
  await page.getByRole("button", { name: "Back to the workbench", exact: true }).click();
  await page
    .getByRole("button", { name: "Start Cage environment", exact: true })
    .click();
  await page
    .getByRole("button", { name: "New terminal", exact: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Regular terminal", exact: true }).click();
  await page.getByRole("tab", { name: "Terminal 1", exact: true }).waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".xterm-scrollable-element")].some(
      (el) => getComputedStyle(el).backgroundColor === "rgb(16, 24, 32)",
    ),
  );
  await shot("themes-terminal");
  const connections = state.terminalConnections;
  await open();
  await light().getByRole("button", { name: "Custom", exact: true }).click();
  await light().getByText("Terminal", { exact: true }).click();
  await edit("Light theme terminal Background", "#202830");
  await page.getByRole("button", { name: "Back to the workbench", exact: true }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".xterm-scrollable-element")].some(
      (el) => getComputedStyle(el).backgroundColor === "rgb(32, 40, 48)",
    ),
  );
  assert.equal(state.terminalConnections, connections);
  checks.push(
    "browser file upload and download round trip, light and dark with no overflow at 820px, existing terminals recolor live without reconnecting",
  );
  assert.deepEqual(errors, []);
  assert.ok(
    !state.requests.some(
      (request) => request.path === "/settings" && request.method === "POST",
    ),
  );
  await fs.writeFile(
    output + "result.json",
    JSON.stringify(
      {
        passed: true,
        checks,
        scope: "Real frontend and xterm, isolated control interface; Go disk writes and native compilation are verified separately",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, checks }));
} finally {
  await browser.close();
}
