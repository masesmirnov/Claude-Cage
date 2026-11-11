import assert from "node:assert/strict";
import { createWorkbench } from "./workbench-fixture.mjs";

const epoch = new Date("2026-11-08T03:00:00Z");
for (const platform of ["darwin", "windows"]) {
  let proxyReady = false;
  const calls = [];
  const fixture = await createWorkbench({
    clientContext: { mode: "local", connection_id: "local", client_platform: platform, server_platform: platform, connection: { state: "disconnected" } },
    beforeNavigate: page => page.clock.install({ time: epoch }),
    nativeRequest: async body => {
      if (body.action !== "appUpdate") return null;
      calls.push(body.operation);
      return { phase: proxyReady ? "current" : "waiting", message: proxyReady ? "Already up to date" : "The selected proxy is not running. The update check will retry once the proxy is ready.", retryAt: "" };
    },
  });
  try {
    await fixture.page.waitForFunction(() => !document.querySelector(".loading-screen"));
    await fixture.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    assert.deepEqual(calls, ["status", "check"]);
    assert.equal(await fixture.page.locator(".app-update-error").count(), 0, "waiting is not an update-failure alert");
    await fixture.page.clock.fastForward(4 * 60 * 1000);
    assert.deepEqual(calls, ["status", "check"], "no tight retry loop while proxy is unavailable");
    proxyReady = true;
    await fixture.page.clock.fastForward(2 * 60 * 1000);
    await fixture.page.waitForFunction(() => !document.querySelector(".app-update-error"));
    assert.deepEqual(calls, ["status", "check", "check"], "waiting checks resume on the existing five-minute retry schedule");
    assert.deepEqual(fixture.errors, []);
    console.log(`PASS: ${platform} update waits and recovers without failure alerts`);
  } finally { await fixture.browser.close(); }
}

const fixture = await createWorkbench({ beforeNavigate: page => page.clock.install({ time: epoch }) });
try {
  const { page, state } = fixture;
  let broken = true;
  let polls = 0;
  await page.exposeFunction("filePollCountForTest", () => polls);
  const failure = "The Claude Desktop file service has exited. Reopen the app.";
  await page.route("**/api/input/files/desktop/requests", route => {
    polls++;
    return broken ? route.fulfill({ status: 503, contentType: "text/plain", body: failure })
      : route.fulfill({ json: { available: true, uploads: [], downloads: [], opens: [] } });
  });
  state.status.ready = state.status.vm_running = true;
  await page.reload();
  await page.getByText(failure, { exact: false }).waitFor();
  assert.equal(polls, 1, "real file-service failure is visible to the user");
  await page.clock.fastForward(2500);
  assert.equal(polls, 1, "failed poll backs off instead of retrying at 1.5 seconds");
  await page.clock.fastForward(1000);
  await page.waitForFunction(async () => await window.filePollCountForTest() >= 2);
  assert.equal(polls, 2);
  broken = false;
  await page.clock.fastForward(6500);
  await page.waitForFunction(async () => await window.filePollCountForTest() >= 3);
  const recovered = polls;
  await page.clock.fastForward(1600);
  await page.waitForFunction(async previous => await window.filePollCountForTest() > previous, recovered);
  assert.ok(polls > recovered, "normal polling cadence returns after recovery");

  await page.getByRole("button", { name: "Open browser", exact: true }).click();
  const trigger = page.getByRole("button", { name: "Browser downloads", exact: true });
  for (let round = 0; round < 4; round++) {
    await trigger.click();
    await page.getByRole("dialog", { name: "Downloaded files", exact: true }).waitFor();
    await page.getByRole("button", { name: "Workbench", exact: true }).click();
    await page.setViewportSize({ width: 950 + round * 25, height: 720 });
    await page.getByRole("button", { name: "Open browser", exact: true }).click();
  }
  assert.deepEqual(fixture.errors, [], "closing panels and resizing must not leave null-reference callbacks");
  console.log("PASS: file polling reports failures, backs off, recovers, and panel teardown remains safe");
} finally { await fixture.browser.close(); }
