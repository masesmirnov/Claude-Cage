// Phone UI fixture. Native capture and AX input are verified separately.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const playwright = require(process.env.CAGE_PLAYWRIGHT_MODULE || "playwright");
const engine = process.env.CAGE_TEST_BROWSER || "chromium";
const browser = await playwright[engine].launch({ executablePath: process.env.CAGE_TEST_BROWSER_PATH });
const output = process.env.CAGE_PHONE_QA_OUTPUT || await mkdtemp(join(tmpdir(), "cage-macos-phone-"));
await mkdir(output, { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, userAgent: "CageMobile/1" });
  const page = await context.newPage();
  const errors = [], actions = [];
  page.on("pageerror", error => errors.push(error.message));
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 900; canvas.height = 600;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "#eeeae3"; ctx.fillRect(0, 0, 900, 600);
    ctx.fillStyle = "#30312e"; ctx.font = "28px sans-serif";
    ctx.fillText("Claude Desktop · isolated test image", 90, 100);
    ctx.fillStyle = "white"; ctx.fillRect(100, 260, 700, 80);
    ctx.fillStyle = "#555"; ctx.fillText("Tap the input to continue", 150, 310);
    return canvas.toDataURL("image/jpeg").split(",")[1];
  });
  let frame, locked = false;
  await page.route("**/api/**", route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const input = request.postDataJSON();
    if (path.endsWith("/projects")) return route.fulfill({ json: { host: "Isolated test virtual Mac", ready: true, projects: [] } });
    if (path.endsWith("/sessions")) return route.fulfill({ json: { sessions: [] } });
    if (!path.startsWith("/api/mobile/desktop/")) return route.fulfill({ status: 404 });
    const operation = path.split("/").at(-1);
    if (operation === "close") return route.fulfill({ json: { id: frame.id } });
    if (operation === "open") {
      locked = false;
      frame = { ...input, image, document: "mac-window-geometry", focus: "", shared: true, window: "desktop",
        content_width: 900, content_height: 600, login_supported: false, pixel_ratio_supported: true, requested_pixel_ratio: input.pixel_ratio || 1 };
    }
    if (locked) return route.fulfill({ status: 410, contentType: "text/plain; charset=utf-8", body: "The Claude Desktop session has ended. Reopen it." });
    if (operation === "action") {
      actions.push(input);
      if (input.type === "resize") Object.assign(frame, { width: input.width, height: input.height, requested_pixel_ratio: input.pixel_ratio });
      if (input.type === "tap") { assert.equal(input.document, frame.document); frame.focus = "current-ax-input"; }
      if (input.type === "text") { assert.equal(input.focus, frame.focus); assert.ok(new TextEncoder().encode(input.text).length <= 8192); }
    }
    return route.fulfill({ json: operation === "frame" ? frame : { id: frame.id } });
  });
  await page.goto((process.env.CAGE_UI_URL || "http://127.0.0.1:5298") + "/mobile.html");
  await page.getByRole("dialog", { name: "Workspace sidebar" }).getByRole("button", { name: "Claude Desktop", exact: true }).click();
  const screen = page.getByRole("img", { name: "Remote Desktop view", exact: true });
  await screen.waitFor();
  await page.getByText(/sign in to Claude Desktop in Cage on the computer/).waitFor();
  assert.equal(await page.getByRole("button", { name: "Sign-in window", exact: true }).count(), 0);
  const keyboard = page.getByRole("button", { name: "Enter text", exact: true });
  assert.ok(await keyboard.isDisabled());
  await screen.tap();
  await keyboard.click();
  const tap = actions.find(action => action.type === "tap");
  assert.ok(Math.abs(tap.x - 450) <= 2 && Math.abs(tap.y - 300) <= 2, JSON.stringify(tap));
  const field = page.getByLabel("Text to insert");
  await field.fill("€".repeat(2731));
  assert.ok(await page.getByRole("button", { name: "Insert text" }).isDisabled());
  await page.getByRole("alert").getByText(/A single input can be at most 8192 bytes/).waitFor();
  const text = "€".repeat(2730) + "ab";
  await field.fill(text);
  await page.getByRole("button", { name: "Insert text" }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Text to insert"]')?.value === "");
  assert.equal(actions.filter(action => action.type === "text").at(-1).text, text);
  await page.getByRole("button", { name: "Collapse the input box" }).click();
  await page.screenshot({ path: join(output, "macos-phone-desktop.png") });
  locked = true;
  await page.getByRole("button", { name: "Reopen", exact: true }).waitFor();
  assert.equal(await screen.count(), 0);
  await page.getByRole("button", { name: "Reopen", exact: true }).click();
  await screen.waitFor();
  assert.ok(await keyboard.isDisabled());
  assert.deepEqual(errors, []);
  const retryPage = await context.newPage();
  let opens = 0, frameReads = 0, opened;
  await retryPage.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/projects")) return route.fulfill({ json: { host: "Isolated test virtual Mac", ready: true, projects: [] } });
    if (path.endsWith("/sessions")) return route.fulfill({ json: { sessions: [] } });
    if (path.endsWith("/open")) { opened = route.request().postDataJSON(); opens++; return route.fulfill({ json: { id: opened.id } }); }
    if (path.endsWith("/frame")) {
      if (opens === 1) return route.fulfill({ status: ++frameReads === 1 ? 425 : 503, body: "The guest browser is not ready yet." });
      return route.fulfill({ json: { ...opened, image, document: "browser-page", url: "about:blank" } });
    }
    return route.fulfill({ status: 404 });
  });
  await retryPage.goto((process.env.CAGE_UI_URL || "http://127.0.0.1:5298") + "/mobile.html");
  await retryPage.getByRole("dialog", { name: "Workspace sidebar" }).getByRole("button", { name: "Browser", exact: true }).click();
  await retryPage.getByText("Starting the remote browser…", { exact: true }).waitFor();
  const reopen = retryPage.getByRole("button", { name: "Reopen", exact: true });
  await reopen.waitFor();
  assert.equal(await retryPage.getByRole("button", { name: "Read the view again", exact: true }).count(), 0);
  await reopen.click();
  await retryPage.getByRole("img", { name: "Remote browser view" }).waitFor();
  assert.equal(opens, 2);
  assert.equal(frameReads, 2);
  const result = { passed: true, engine, actions: actions.map(({ text, ...action }) => ({ ...action, ...(text ? { textBytes: new TextEncoder().encode(text).length } : {}) })),
    checks: ["native content geometry maps center", "focus required before typing", "8192-byte UTF-8 limit", "shared login instruction", "expired GUI session removes image and reopens", "browser waits after 425, reopens directly after frame 503"] };
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
