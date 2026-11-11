import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createWorkbench } from "./workbench-fixture.mjs";
import { startDisplay } from "./rfb-wire-fixture.mjs";

const engine = process.env.CAGE_TEST_BROWSER || "chromium";
const output = new URL(`../../docs/test-reports/2026-11-07-browser-vertical-tabs/${engine}/`, import.meta.url);
await fs.mkdir(output, { recursive: true });
const display = await startDisplay(process.env.CAGE_UI_URL || "http://127.0.0.1:5198", { frameInterval: 200 });
const { browser, page, state, errors } = await createWorkbench({ url: display.url, mockWebSockets: engine === "webkit" });
page.setDefaultTimeout(10000);
const checks = [];
const tabs = page.getByRole("tablist", { name: "Browser tabs", exact: true });
const settings = page.getByRole("region", { name: "Browser settings", exact: true });
const rail = page.getByRole("complementary", { name: "Vertical tab bar", exact: true });
const shot = name => page.screenshot({ path: fileURLToPath(new URL(name + ".png", output)) });
async function openSettings() {
  await page.getByRole("button", { name: "Browser menu", exact: true }).last().click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await settings.getByRole("navigation", { name: "Browser settings categories" }).getByRole("button", { name: "Appearance", exact: true }).click();
}
async function closeSettings() {
  await page.getByRole("button", { name: "Close Settings", exact: true }).click();
  await settings.waitFor({ state: "hidden" });
}
async function drag(from, to) {
  const a = await from.boundingBox(), b = await to.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}
try {
  state.status.ready = state.status.vm_running = true;
  state.tabs = Array.from({ length: 5 }, (_, i) => ({
    id: `tab-${i}`, kind: i === 4 ? "editor" : "web", title: `Test page ${i}`,
    workspace: i === 4 ? state.settings.workspace : undefined, url: `https://example.test/${i}`,
  }));
  state.active = "tab-0";
  await page.reload();
  await page.getByRole("button", { name: "Open browser", exact: true }).click();
  if (engine !== "webkit") await page.locator(".remote-canvas canvas").waitFor();
  assert.equal(await tabs.getAttribute("aria-orientation"), "horizontal");
  const surface = await page.locator(".remote-view").elementHandle();
  await openSettings();
  const picker = page.getByRole("combobox", { name: "Tab bar layout", exact: true });
  const help = settings.getByText("The browser settings page follows the current Cage font and palette.", { exact: true });
  await settings.locator('.browser-settings-section').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  const before = await help.boundingBox();
  await picker.click();
  const expanded = await help.boundingBox();
  assert.ok(Math.abs(expanded.y - before.y) < 1, "floating options must not move the following content");
  await page.keyboard.press("Escape");
  assert.ok(Math.abs((await help.boundingBox()).y - before.y) < 1, "closing options restores the layout");
  await picker.click();
  await page.getByRole("option", { name: "Vertical (left)", exact: true }).click();
  await shot("browser-settings");
  assert.equal(await picker.getAttribute("aria-expanded"), "false");
  await closeSettings();
  await rail.waitFor();
  assert.equal(await tabs.getAttribute("aria-orientation"), "vertical");
  assert.ok(await surface.evaluate(node => node === document.querySelector(".remote-view")), "changing layout must retain the remote-view component");
  const first = tabs.getByRole("tab", { name: "Test page 0", exact: true });
  const second = tabs.getByRole("tab", { name: "Test page 1", exact: true });
  assert.ok((await second.boundingBox()).y > (await first.boundingBox()).y);
  const railBox = await rail.boundingBox(), bodyBox = await page.locator(".browser-lane .pane-body").boundingBox();
  assert.ok(railBox.x + railBox.width <= bodyBox.x + 1);
  await shot("vertical-desktop");
  await first.focus();
  await page.keyboard.press("ArrowDown");
  await page.waitForFunction(() => document.querySelector('[data-tab-id="tab-1"] [role="tab"]').getAttribute("aria-selected") === "true");
  await page.keyboard.press("End");
  await page.waitForFunction(() => document.querySelector('[data-tab-id="tab-4"] [role="tab"]').getAttribute("aria-selected") === "true");
  await page.keyboard.press("Home");
  await drag(first, tabs.getByRole("tab", { name: "Test page 3", exact: true }));
  await page.waitForFunction(() => [...document.querySelectorAll('.browser-tabs [role="tab"]')].findIndex(t => t.textContent === "Test page 0") === 2);
  await first.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Pin tab", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".browser-tabs .browser-tab").dataset.tabId === "tab-0");
  const order = await tabs.getByRole("tab").allTextContents();
  await first.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename tab", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "Rename tab", exact: true });
  await rename.getByRole("textbox").fill("Renamed page");
  await rename.getByRole("button", { name: "Save name", exact: true }).click();
  order[0] = "Renamed page";
  await page.reload();
  await page.getByRole("button", { name: "Open browser", exact: true }).click();
  await rail.waitFor();
  assert.deepEqual(await tabs.getByRole("tab").allTextContents(), order);
  await page.getByRole("button", { name: "New web page", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.browser-tabs [role="tab"]').length === 6);
  await tabs.getByRole("tab", { name: "Test page 2", exact: true }).click();
  await page.getByRole("button", { name: "Close Test page 2", exact: true }).click();
  await tabs.getByRole("tab", { name: "Test page 2", exact: true }).waitFor({ state: "hidden" });
  checks.push("Horizontal by default; settings dropdown expands and collapses inline; vertical switch keeps display components; arrow keys and Home/End; drag reorder, pin, refresh persistence, create and close");

  // Drag from the rail into the page to exercise native dual-browser splitting.
  await drag(tabs.getByRole("tab", { name: "Test page 3", exact: true }), page.locator(".browser-lane .pane-body"));
  await page.waitForFunction(() => document.querySelectorAll(".browser-header-cell").length === 2);
  assert.equal(await rail.count(), 1);
  assert.equal(await tabs.count(), 1);
  assert.ok(state.split?.left && state.split?.right);
  await page.locator(".browser-header-cell").first().getByRole("button", { name: "Exit split view", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".browser-header-cell").length === 1);
  checks.push("Dragging a vertical tab into the page opens a two-page split view; one shared tab column; Exit split view");

  for (let i = 5; i < 35; i++) state.tabs.push({ id: `tab-${i}`, kind: "web", title: `More pages ${i}`, url: `https://example.test/${i}` });
  await page.waitForFunction(() => document.querySelectorAll('.browser-tabs [role="tab"]').length === 35);
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  for (const width of [1280, 820, 375]) {
    await page.setViewportSize({ width, height: 850 });
    await tabs.getByRole("tab").first().focus();
    await page.keyboard.press("End");
    await page.waitForFunction(() => {
      const list = document.querySelector(".browser-tabs"), selected = list.querySelector('[aria-selected="true"]');
      const a = list.getBoundingClientRect(), b = selected.getBoundingClientRect();
      return list.scrollHeight > list.clientHeight && list.scrollWidth <= list.clientWidth + 1 && b.y >= a.y && b.bottom <= a.bottom + 1;
    });
    assert.ok((await page.locator(".browser-lane .pane-body").boundingBox()).width > 100);
    await shot("many-tabs-" + width);
  }
  checks.push("35 tabs scroll vertically at 1280/820/375 widths, keyboard selection of the last item scrolls it into view, and the page keeps usable space");
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await openSettings();
  await picker.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  assert.equal(await picker.getAttribute("aria-expanded"), "false");
  await closeSettings();
  await rail.waitFor({ state: "hidden" });
  assert.equal(await tabs.getAttribute("aria-orientation"), "horizontal");
  await page.reload();
  await page.getByRole("button", { name: "Open browser", exact: true }).click();
  assert.equal(await tabs.getAttribute("aria-orientation"), "horizontal");
  assert.equal(state.saves.length, 0, "layout preferences must not save or restart the guest environment");
  assert.deepEqual(errors, []);
  checks.push("Keyboard switch back to horizontal persists after refresh; no environment settings written and no environment restart; no page errors");
  await fs.writeFile(new URL("result.json", output), JSON.stringify({ passed: true, checks, scope: `Real React DOM and storage; ${engine === "webkit" ? "display connection uses a stand-in" : "WebSocket/RFB uses an isolated display service"}; guest pages and the control API use isolated stand-ins; native apps on the three platforms were not tested.` }, null, 2));
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} catch (error) {
  await shot("failure");
  throw error;
} finally {
  await browser.close();
  await display.close();
}
