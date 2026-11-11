import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createWorkbench } from "./workbench-fixture.mjs";

const output = process.env.CAGE_TEST_CAPTURE || "/tmp/cage-sidebar-session-layout";
const engine = process.env.CAGE_TEST_BROWSER || "chromium";
const { page, state, browser, errors } = await createWorkbench({
  url: process.env.CAGE_UI_URL || "http://127.0.0.1:5217",
});
const workspace = state.settings.workspace;
const titles = ["Hello", "Software promo video production", "This is a very long session title used to check ellipsis in a narrow sidebar"];
const sessions = titles.map((title, index) => ({
  id: `layout-session-${index}`, workspace, title, pinned: index === 2,
  updated_at: "2026-11-07T08:00:00Z",
}));
const evidence = [];
try {
  await page.route("**/api/cli/sessions", route => route.fulfill({ json: { sessions } }));
  state.status.ready = state.status.vm_running = true;
  state.terminals = [{ id: "layout-live", workspace, title: "Opened session" }];
  const project = page.getByRole("region", { name: "Project Default workspace", exact: true });
  const history = project.locator(".sidebar-session");
  await history.last().waitFor();
  await project.getByRole("tab", { name: "Opened session", exact: true }).waitFor();
  await mkdir(output, { recursive: true });
  for (const width of [1280, 820]) {
    await page.setViewportSize({ width, height: 850 });
    await page.mouse.move(width - 10, 10);
    const layout = await project.evaluate(section => {
      const rows = [...section.querySelectorAll('.sidebar-tab > button[role="tab"], .sidebar-session')];
      return rows.map(button => {
        const box = button.getBoundingClientRect();
        const icon = button.querySelector("svg")?.getBoundingClientRect();
        const title = button.querySelector("span").getBoundingClientRect();
        return { title: button.textContent, x: box.x, iconX: icon?.x, textX: title.x, height: box.height,
          right: box.right, titleRight: title.right, clipped: button.querySelector("span").scrollWidth > title.width };
      });
    });
    await page.screenshot({ path: `${output}/${engine}-${width}.png` });
    assert.equal(layout.length, 4);
    for (const row of layout) {
      assert.ok(row.iconX !== undefined, `missing session icon: ${row.title}`);
      assert.ok(Math.abs(row.iconX - layout[0].iconX) < 1, `session icons misaligned: ${JSON.stringify(layout)}`);
      assert.ok(Math.abs(row.textX - layout[0].textX) < 1, `session titles misaligned: ${JSON.stringify(layout)}`);
      assert.ok(row.height >= 40, `session row too short: ${row.title}`);
      assert.ok(row.titleRight <= row.right, `title overflow: ${row.title}`);
    }
    assert.ok(layout.find(row => row.title.startsWith("This is a very")).clipped, "long session title was not truncated");
    const short = project.getByRole("button", { name: "Hello", exact: true });
    const before = await short.locator("svg").first().boundingBox();
    await short.hover();
    await project.getByRole("group", { name: "Actions for Hello", exact: true }).getByRole("button", { name: "Rename", exact: true }).waitFor();
    const after = await short.locator("svg").first().boundingBox();
    assert.ok(Math.abs(before.x - after.x) < 1, "hover shifted the session icon");
    await short.focus();
    if (engine !== "webkit") {
      await page.keyboard.press("Tab");
      assert.equal(await page.locator(":focus").getAttribute("aria-label"), "Pin");
    }
    const rename = project.getByRole("group", { name: "Actions for Hello", exact: true }).getByRole("button", { name: "Rename", exact: true });
    await rename.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Tab name" }).waitFor();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    evidence.push({ width, layout });
  }
  const folder = project.locator(".project-disclosure");
  await folder.click();
  await history.first().waitFor({ state: "hidden" });
  assert.equal(await folder.getAttribute("aria-expanded"), "false");
  await folder.press("Enter");
  await history.first().waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Hello", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await writeFile(`${output}/${engine}-result.json`, JSON.stringify(evidence, null, 2));
  console.log(`${engine}: live/history alignment, short/long/pinned titles, hover, keyboard, collapse and reload passed`);
} finally {
  await browser.close();
}
