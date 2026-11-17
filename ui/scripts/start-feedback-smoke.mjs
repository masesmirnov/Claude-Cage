import assert from "node:assert/strict";
import { createWorkbench } from "./workbench-fixture.mjs";

const { browser, page, state, errors } = await createWorkbench();
let releaseStart;
const startGate = new Promise(resolve => { releaseStart = resolve; });
let starts = 0;
const loading = page.getByRole("button", { name: "Working…", exact: true });
const assertLoading = async () => {
  await loading.waitFor({ timeout: 500 });
  assert.equal(await loading.isDisabled(), true);
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.getByRole("heading", { name: "Preparing the Cage environment", exact: true }).waitFor({ timeout: 500 });
};
try {
  await page.route("**/api/start", async route => {
    starts++;
    await startGate;
    await route.fulfill({ json: { id: "delayed-start" } });
  });
  const startRequested = page.waitForRequest("**/api/start");
  await page.getByRole("button", { name: "启动 Cage 环境", exact: true }).click();
  await startRequested;
  await assertLoading();
  const startResponse = page.waitForResponse("**/api/start");
  releaseStart();
  await startResponse;
  // An older idle status must not re-enable the button after acceptance.
  await page.waitForResponse("**/api/status");
  await assertLoading();
  assert.equal(starts, 1);
  state.status.job = { id: "delayed-start", kind: "start", running: true, message: "Preparing the test environment…" };
  await page.locator(".welcome-subtitle").getByText("Preparing the test environment…", { exact: true }).waitFor();
  await assertLoading();
  state.status.job = { ...state.status.job, running: false, error: "Test start failed" };
  await page.getByRole("button", { name: "Start Cage environment", exact: true }).waitFor();

  await page.route("**/api/start", route => route.fulfill({ status: 503, contentType: "text/plain; charset=utf-8", body: "Test request failed" }));
  await page.getByRole("button", { name: "Start Cage environment", exact: true }).click();
  await page.getByText("Test request failed", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Start Cage environment", exact: true }).isEnabled(), true);

  assert.equal(state.requests.some(request => request.path === "/host/git"), false);
  assert.deepEqual(errors, []);
  console.log("PASS: immediate feedback; direct start without Git checks; continuous loading across delayed requests and stale polling; job handoff; failure allows retry.");
} finally {
  releaseStart();
  await browser.close();
}
