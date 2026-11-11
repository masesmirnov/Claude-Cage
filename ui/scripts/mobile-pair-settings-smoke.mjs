import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createWorkbench } from "./workbench-fixture.mjs";

const output = fileURLToPath(new URL("../../docs/test-reports/2026-11-07-paired-phone-model/", import.meta.url));
await fs.mkdir(output, { recursive: true });
let paired = true, device = null, rejectRemove = false, removals = 0;
let power = {active:true};
let holdNextStatus = false, releaseStatus;
let signalStatus, signalDelivered;
const statusHeld = new Promise(resolve => { signalStatus = resolve; });
const statusDelivered = new Promise(resolve => { signalDelivered = resolve; });
const { browser, page, errors } = await createWorkbench({
  beforeNavigate: async page => page.route("**/api/mobile-pair", async route => {
    if (route.request().method() === "GET" && holdNextStatus) {
      holdNextStatus = false;
      const snapshot = { paired, status: "", device };
      await new Promise(resolve => { releaseStatus = resolve; signalStatus(); });
      await route.fulfill({ json: snapshot });
      signalDelivered();
      return;
    }
    if (route.request().method() === "DELETE") {
      if (rejectRemove) return route.fulfill({ status: 500, contentType:"text/plain; charset=utf-8", body: "Removal failed. Try again." });
      paired = false; device = null; removals++;
    }
    return route.fulfill({ json: { paired, status: "", device, keep_awake:power } });
  }),
});
async function open() {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("navigation", { name: "Settings groups" }).getByRole("button", { name: "Remote connection", exact: true }).click();
  await page.getByRole("heading", { name: "Phone paired", exact: true }).waitFor();
}
async function confirmRemoval() {
  await page.getByRole("button", { name: "Remove paired phone", exact: true }).click();
  await page.getByRole("heading", { name: "Remove the paired phone?", exact: true }).waitFor();
}
try {
  await open();
  await page.getByText("Remote standby has asked the host to stay awake; the screen can still turn off. The original system sleep policy is restored after you remove the pairing or stop the backend service.",{exact:true}).waitFor();
  power = {active:false,error:"Test: sleep prevention not allowed by the system"};
  await page.getByRole("alert").filter({hasText:"Preventing host sleep did not take effect: Test: sleep prevention not allowed by the system"}).waitFor();
  power = {active:true};
  await page.getByRole("alert").filter({hasText:"Preventing host sleep did not take effect"}).waitFor({state:"hidden"});
  await page.getByText("Model not available yet. Update Cage on the phone and reconnect.", { exact: true }).waitFor();
  device = { platform: "android", model: "Google Pixel 9 Pro" };
  await page.getByLabel("Paired phone", { exact: true }).getByText(device.model, { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Paired phone", { exact: true }).innerText(), "Google Pixel 9 Pro\nAndroid");
  await page.screenshot({ path: output + "android-model.png", fullPage: true });
  await page.reload(); await open();
  await page.getByLabel("Paired phone", { exact: true }).getByText(device.model, { exact: true }).waitFor();
  await confirmRemoval();
  await page.getByText("After removing Google Pixel 9 Pro, this phone must scan the QR code again to reach the workbench.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(removals, 0);

  device = { platform: "ios", model: "iPhone 16 Pro" };
  await page.getByLabel("Paired phone", { exact: true }).getByText(device.model, { exact: true }).waitFor();
  await page.getByLabel("Paired phone", { exact: true }).getByText("iOS", { exact: true }).waitFor();
  await page.screenshot({ path: output + "iphone-model.png", fullPage: true });
  rejectRemove = true;
  await confirmRemoval();
  await page.getByRole("button", { name: "Remove phone", exact: true }).click();
  await page.getByText("Removal failed. Try again.", { exact: true }).waitFor();
  await page.getByLabel("Paired phone", { exact: true }).getByText(device.model, { exact: true }).waitFor();
  rejectRemove = false;
  holdNextStatus = true;
  await statusHeld;
  await confirmRemoval();
  await page.getByRole("button", { name: "Remove phone", exact: true }).click();
  await page.getByRole("heading", { name: "Connect to Cage with your phone", exact: true }).waitFor();
  releaseStatus();
  await statusDelivered;
  await page.getByRole("heading", { name: "Connect to Cage with your phone", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Paired phone", { exact: true }).count(), 0);
  assert.equal(removals, 1);
  assert.deepEqual(errors, []);
  console.log("Paired phone model: legacy fallback, live Android/iOS metadata, reload, cancel, failed removal, successful removal and stale polling response passed.");
} finally { await browser.close(); }
