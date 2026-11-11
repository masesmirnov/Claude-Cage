// Reads the one-time URL from stdin. Run by TestMobileTranscriptInBrowser.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
const parts = [];
for await (const chunk of process.stdin) parts.push(chunk);
const entry = Buffer.concat(parts).toString().trim();
const engine = process.env.CAGE_TEST_MOBILE_BROWSER;
const playwright = await import(
  process.env.CAGE_PLAYWRIGHT_MODULE || "playwright"
);
const browser = await playwright[engine].launch();
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    colorScheme: "dark",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(entry);
  await page.getByRole("button", { name: "Promo video production", exact: true }).click();
  await page.getByRole("heading", { name: "Deliverables" }).waitFor();
  assert.equal(
    await page.locator(".markdown strong").first().innerText(),
    "Maintenance later",
  );
  assert.equal(await page.getByRole("table").count(), 1);
  assert.equal(await page.getByRole("checkbox", { checked: true }).count(), 1);
  const transcript = page.getByRole("region", { name: "Session messages" });
  assert(await transcript.evaluate((el) => el.scrollWidth <= el.clientWidth));
  const call = page.locator("summary").filter({ hasText: "2 tool calls" });
  await call.click();
  await page.getByText("Check frame rate", { exact: true }).waitFor();
  await call.click();
  const task = page.locator("summary").filter({ hasText: "Background task" });
  assert.equal(await task.count(), 1);
  await task.focus();
  await page.keyboard.press("Enter");
  await page.getByText("fixture-id", { exact: true }).waitFor();
  await task.click();
  const capture = process.env.CAGE_TEST_MOBILE_CAPTURE;
  if (capture) {
    await mkdir(capture, { recursive: true });
    await page.screenshot({
      path: path.join(capture, engine + "-transcript.png"),
    });
  }
  await page.getByRole("button", { name: /Cover.*View image/ }).click();
  await page.waitForFunction(
    () => document.querySelector(".project-media img")?.naturalWidth > 0,
  );
  await page.getByRole("button", { name: /Final cut.*Load video/ }).click();
  await page.waitForFunction(
    () => document.querySelector("video")?.videoWidth > 0,
  );
  const video = page.locator("video");
  await video.evaluate(async (el) => {
    el.muted = true;
    await el.play();
  });
  await page.waitForFunction(
    () => document.querySelector("video")?.currentTime > 0,
  );
  await video.evaluate((el) => el.pause());
  if (capture)
    await page.screenshot({ path: path.join(capture, engine + "-media.png") });
  await page.getByRole("button", { name: /Final cut.*Collapse/ }).click();
  assert.equal(await video.count(), 0);
  await page.getByRole("button", { name: /Missing.*View image/ }).click();
  await page.getByText(/The media file was not found/).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Deliverables" }).waitFor();
  assert.equal(await page.locator("video").count(), 0);
  const opened = page.waitForRequest(
    (r) =>
      r.method() === "POST" &&
      new URL(r.url()).pathname === "/api/mobile/browser/open",
  );
  await page.getByRole("link", { name: "View page" }).click();
  assert.equal((await opened).postDataJSON().url, "https://example.org/demo");
  assert.deepEqual(errors, []);
  console.log(
    engine +
      " Markdown, tool history, task notice, image decode, video playback, retry affordance, reload and remote link passed",
  );
} catch (error) {
  throw Error(
    String(error).replace(
      /link-bootstrap#[\w-]+/g,
      "link-bootstrap#[redacted]",
    ),
  );
} finally {
  await browser.close();
}
