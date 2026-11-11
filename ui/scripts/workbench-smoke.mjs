import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { smokeCaptureDirectory } from "./smoke-captures.mjs";
import { createWorkbench } from "./workbench-fixture.mjs";

const output = await smokeCaptureDirectory("workbench");
const { browser, page, state, errors } = await createWorkbench();
const checks = [];
const shot = (name) =>
  page.screenshot({ path: join(output, name + ".png"), animations: "disabled" });
const settings = async () => {
  await page.getByRole("button", { name: /^Settings/ }).click();
  await page.getByRole("navigation", { name: "Settings groups" }).getByRole("button", { name: "General", exact: true }).click();
};
const tabs = () => page.getByRole("tablist", { name: "Browser tabs" });
try {
  await shot("main");
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  assert.equal(await navigation.getByRole("button", { name: /Open project|Project files/ }).count(), 0);
  await page
    .getByRole("button", { name: "Start Cage environment", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "The Cage environment is ready", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Add project", exact: true })
    .click();
  await page.getByRole("button", { name: "Add a local project…", exact: true }).click();
  await page.waitForFunction(
    (path) => document.getElementById("project-path")?.value === path,
    state.chosenFolder,
  );
  assert.equal(
    await page.getByLabel("New project folder", { exact: true }).inputValue(),
    state.chosenFolder,
  );
  state.failJob = true;
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Open project", exact: true })
    .click();

  await page
    .getByRole("dialog")
    .getByRole("alert")
    .filter({ hasText: "Failed to connect to the project folder" })
    .waitFor();
  assert.equal(
    await page.getByLabel("New project folder", { exact: true }).inputValue(),
    state.chosenFolder,
  );
  assert.ok(state.settings.workspace.endsWith(".claude-cage-workspace"));
  state.failJob = false;
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Open project", exact: true })
    .click();

  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(state.settings.workspace, state.chosenFolder);
  await page.reload();
  await page
    .getByRole("heading", { name: "The Cage environment is ready", exact: true })
    .waitFor();
  await page
    .getByRole("region", { name: "Project design-lab", exact: true })
    .waitFor();
  assert.ok(state.status.projects.includes(state.chosenFolder));
  await page.evaluate(() =>
    localStorage.setItem(
      "cage-projects",
      JSON.stringify(["/fake/local-history"]),
    ),
  );
  await page.reload();
  await page
    .getByRole("region", { name: "Project design-lab", exact: true })
    .waitFor();
  assert.equal(
    await page.getByText("local-history", { exact: true }).count(),
    0,
  );
  assert.equal(await page.getByText("Environment tabs", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Recent projects", { exact: true }).count(), 0);
  checks.push("real directory list reloads and reads back, no local history is used, a failed project open keeps the path");
  await page
    .getByRole("heading", { name: "The Cage environment is ready", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "New terminal in design-lab", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Regular terminal", exact: true }).click();
  await page.getByRole("tab", { name: "Terminal 1", exact: true }).waitFor();
  const terminalHeader = page.locator("header.chrome");
  assert.equal(await terminalHeader.locator(".navigation-row").count(), 0);
  assert.equal(await terminalHeader.getByRole("button", { name: "New terminal", exact: true }).count(), 0);
  assert.equal(await terminalHeader.getByRole("button", { name: "Open file", exact: true }).count(), 0);
  assert.equal(await terminalHeader.getByRole("button", { name: "design-lab", exact: true }).getAttribute("title"), state.chosenFolder);
  const terminalTab = page.getByRole("tab", { name: "Terminal 1", exact: true });
  const actions = page.getByRole("group", { name: "Actions for Terminal 1", exact: true });
  await terminalTab.hover();
  await actions.waitFor();
  await page.getByRole("button", { name: "Workbench", exact: true }).hover();
  await actions.waitFor({ state: "hidden" });
  await terminalTab.focus();
  // WebKit's default keyboard mode skips buttons when tabbing. The tab's
  // context-menu shortcut reaches its actions in that mode too.
  await terminalTab.press(process.env.CAGE_TEST_BROWSER === "webkit" ? "Shift+F10" : "Tab");
  assert.equal(await page.locator(":focus").getAttribute("aria-label"), "Pin");
  await page.keyboard.press("Enter");
  await actions.getByRole("button", { name: "Unpin", exact: true }).click();
  const renameButton = actions.getByRole("button", { name: "Rename", exact: true });
  await renameButton.hover();
  await actions.getByText("Rename", { exact: true }).waitFor();
  await renameButton.click();
  await page.getByLabel("Tab name").fill("Dev terminal");
  await page.getByRole("button", { name: "Save name" }).click();
  await page.getByRole("tab", { name: "Dev terminal" }).waitFor();
  await page.getByRole("button", { name: "Open browser", exact: true }).click();
  await page.getByRole("tab", { name: "New tab", exact: true }).waitFor();
  await page.getByLabel("Web address or search").fill("localhost:3000");
  await page.getByRole("button", { name: "Open address", exact: true }).click();
  await page.getByRole("tab", { name: "Local preview", exact: true }).waitFor();
  assert.equal(state.tabs[0].url, "http://localhost:3000/");
  await tabs()
    .getByRole("tab", { name: "Local preview", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Pin tab", exact: true }).click();
  assert.equal(await tabs().getByRole("tab").first().innerText(), "Local preview");
  await page.getByRole("button", { name: "Open the editor for design-lab", exact: true }).click();
  await page
    .getByRole("tab", { name: "File · design-lab", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Close File · design-lab", exact: true })
    .click();
  await page.getByRole("dialog", { name: "Close the file editor?" }).waitFor();
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  assert.equal(state.tabs.length, 2);
  assert.equal(
    await page.locator(".workspace-sidebar").getByRole("tab").count(),
    1,
  );
  assert.equal(await tabs().getByRole("tab").count(), 2);
  assert.equal(await page.locator(".content-breadcrumb").count(), 0);
  await page.getByRole("button", { name: "New web page", exact: true }).click();
  await tabs().getByRole("tab", { name: "New tab", exact: true }).waitFor();
  const newTab = tabs().getByRole("tab", { name: "New tab", exact: true });
  const editorTab = tabs().getByRole("tab", { name: "File · design-lab", exact: true });
  // Drop past the editor tab's midpoint to put the new tab before it.
  await newTab.dragTo(editorTab, { targetPosition: { x: 5, y: 10 } });
  await tabs().getByRole("tab").nth(1).and(newTab).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Open browser", exact: true }).click();
  assert.deepEqual(await tabs().getByRole("tab").allTextContents(), [
    "Local preview",
    "New tab",
    "File · design-lab",
  ]);
  await page.keyboard.press("Meta+2");
  await page.waitForFunction(
    () =>
      document.querySelector('.browser-tabs [aria-selected="true"]')
        ?.textContent === "New tab",
  );
  await page
    .getByRole("button", { name: "Close New tab", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('.browser-tabs [aria-selected="true"]')
        ?.textContent === "File · design-lab",
  );
  assert.equal(
    state.active,
    state.tabs.find((tab) => tab.kind === "editor").id,
  );
  await page.getByRole("tab", { name: "Dev terminal", exact: true }).click();
  await page.keyboard.press("Meta+1");
  await page.waitForFunction(
    () =>
      document.querySelector('.sidebar-tabs [aria-selected="true"]')
        ?.textContent === "Dev terminal",
  );
  const pageCount = state.tabs.length;
  await page.getByRole("button", { name: "Open browser", exact: true }).click();
  assert.equal(state.tabs.length, pageCount);
  assert.equal(
    await tabs()
      .getByRole("tab", { name: "File · design-lab", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await shot("workspace-browser");
  await page.getByRole("tab", { name: "Dev terminal", exact: true }).click();
  await shot("workspace-terminal");
  checks.push(
    "top browser tabs, only terminals under the project, browser restores its page, rename/pin/order survive refresh, group shortcuts, adjacent page activates after closing",
  );
  const connections = state.terminalConnections;
  await settings();
  await page.getByRole("heading", { name: "General", exact: true }).waitFor();
  await shot("settings");
  await page.getByRole("radio", { name: /^Guest-native shortcuts/ }).check();
  await page
    .getByRole("button", { name: "Back to the workbench", exact: true })
    .first()
    .click();
  await page.getByRole("dialog", { name: "Discard unsaved changes?" }).waitFor();
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  assert.equal(
    await page.getByRole("radio", { name: /^Guest-native shortcuts/ }).isChecked(),
    true,
  );
  state.failSave = true;
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Save failed" }).waitFor();
  assert.equal(
    await page.getByRole("radio", { name: /^Guest-native shortcuts/ }).isChecked(),
    true,
  );
  state.failSave = false;
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await page
    .getByRole("region", { name: "Settings", exact: true })
    .waitFor({ state: "hidden" });
  assert.equal(state.settings.keyboard, "native");
  assert.equal(state.terminalConnections, connections);
  await settings();
  assert.equal(
    await page.getByRole("radio", { name: /^Guest-native shortcuts/ }).isChecked(),
    true,
  );
  await page.getByRole("button", { name: "Time zone and language", exact: true }).click();
  await page.getByRole("switch", { name: /Follow the time zone of the exit IP/ }).uncheck();
  await page.getByLabel("System time zone", { exact: true }).fill("Etc/UTC");
  await page.getByRole("button", { name: "Save and restart", exact: true }).click();
  await page.getByRole("dialog", { name: "Apply settings and restart the environment?" }).waitFor();
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  assert.equal("proxy_url" in state.settings, false);
  checks.push(
    "settings draft leave confirmation, failed save keeps input, successful save reads back, background terminal connection kept, restart cancel",
  );
  await page.setViewportSize({ width: 820, height: 558 });
  await shot("settings-minimum");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.getByRole("button", { name: "Time zone and language", exact: true }).click();
  await shot("settings-region-minimum");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await page
    .getByRole("button", { name: "Add project", exact: true })
    .click();
  await page.getByRole("button", { name: "Add a local project…", exact: true }).click();
  await page
    .getByLabel("New project folder", { exact: true })
    .fill("/Users/shihao/Projects/another-project");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Open project", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(
    state.settings.workspace,
    "/Users/shihao/Projects/another-project",
  );
  assert.ok(state.terminals.length > 0);
  assert.ok(state.tabs.length > 0);
  assert.equal(
    await page.getByRole("tab", { name: "Dev terminal", exact: true }).count(),
    1,
  );
  await page
    .getByRole("button", { name: "New terminal in another-project", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Regular terminal", exact: true }).click();
  await page
    .getByRole("region", { name: "Project another-project", exact: true })
    .getByRole("tab", { name: "Terminal 2", exact: true })
    .waitFor();
  assert.equal(
    state.terminals[1].workspace,
    "/Users/shihao/Projects/another-project",
  );
  await page
    .getByRole("button", { name: "New terminal in design-lab", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Regular terminal", exact: true }).click();
  await page
    .getByRole("region", { name: "Project design-lab", exact: true })
    .getByRole("tab", { name: "Terminal 3", exact: true })
    .waitFor();
  assert.equal(state.terminals[2].workspace, state.chosenFolder);
  assert.equal(
    state.settings.workspace,
    "/Users/shihao/Projects/another-project",
  );
  await page.getByRole("button", { name: "Open browser", exact: true }).click();
  await shot("browser-minimum");
  assert.equal(
    await page.locator(".workspace-sidebar").getByRole("tab").count(),
    3,
  );
  assert.equal(await tabs().getByRole("tab").count(), 2);
  await page.getByRole("button", { name: "Open the editor for another-project", exact: true }).click();
  await tabs().getByRole("tab", { name: "File · another-project", exact: true }).waitFor();
  await page.getByRole("button", { name: "Open the editor for design-lab", exact: true }).click();
  await tabs()
    .getByRole("tab", { name: "File · design-lab", exact: true })
    .waitFor();
  assert.equal(state.tabs.filter((tab) => tab.kind === "editor").length, 2);
  assert.equal(state.tabs.find((tab) => tab.id === state.active)?.workspace, state.chosenFolder);
  checks.push(
    "terminals of two projects stay in their own groups, creating in a chosen directory is unaffected by the last opened project, browser and terminals keep running",
  );
  const deleteTab = page.getByRole("tab", { name: "Terminal 3", exact: true });
  const remove = page.getByRole("group", { name: "Actions for Terminal 3" }).getByRole("button", { name: "Close terminal", exact: true });
  await deleteTab.hover();
  await remove.click();
  const confirmClose = page.getByRole("dialog", { name: "Close this terminal session?" });
  await confirmClose.getByRole("button", { name: "Cancel" }).click();
  assert.equal(state.terminals.length, 3);
  await deleteTab.hover();
  await remove.click();
  await confirmClose.getByRole("button", { name: "Close terminal" }).click();
  await deleteTab.waitFor({ state: "detached" });
  assert.equal(state.terminals.length, 2);
  checks.push("terminal row expands on hover, keyboard pin, rename, cancel and confirm closing a specific regular terminal");
  await page.getByRole("button", { name: "Workbench", exact: true }).click();
  await shot("main-minimum");
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).waitFor();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.keyboard.press("Meta+t");
  await tabs().waitFor();
  await shot("compact-workspace");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  checks.push(
    "switching projects while running keeps terminals and web pages, 820px minimum window, sidebar collapse survives refresh, 375px collapsed sidebar has no horizontal overflow",
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    join(output, "smoke-result.json"),
    JSON.stringify(
      {
        passed: true,
        checks,
        pageErrors: errors,
        scope:
          "Mock API/native picker/terminal socket; no real VM, network or file edit verification.",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally {
  await browser.close();
}
