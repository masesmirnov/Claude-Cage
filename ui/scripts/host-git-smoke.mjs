import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createWorkbench } from "./workbench-fixture.mjs";

const { browser, page, state, errors } = await createWorkbench();
const missing = {
  state: "unset",
  ready: false,
  can_enable: true,
  message: "Git protection must be enabled on this computer before starting.",
};
const starts = () => state.requests.filter((r) => r.path === "/start").length;
const writes = () =>
  state.requests.filter((r) => r.path === "/host/git" && r.method === "POST")
    .length;
try {
  state.hostGit = { ...missing };
  await page
    .getByRole("button", { name: "Start Cage environment", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Enable protection and continue", exact: true })
    .waitFor();
  assert.equal(starts(), 0);
  assert.equal(writes(), 0);
  await page.getByRole("button", { name: "Not now", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(starts(), 0);
  await page
    .getByRole("button", { name: "Start Cage environment", exact: true })
    .click();
  state.failHostGit = true;
  await page
    .getByRole("button", { name: "Enable protection and continue", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Could not save the Git safety setting" })
    .waitFor();
  assert.equal(starts(), 0);
  assert.equal(writes(), 1);
  state.failHostGit = false;
  await page
    .getByRole("button", { name: "Enable protection and continue", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "The Cage environment is ready", exact: true })
    .waitFor();
  assert.equal(starts(), 1);
  assert.equal(writes(), 2);
  state.status.ready = false;
  state.status.vm_running = false;
  await page.reload();
  await page
    .getByRole("button", { name: "Start Cage environment", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "The Cage environment is ready", exact: true })
    .waitFor();
  assert.equal(starts(), 2);
  assert.equal(writes(), 2);
  state.status.ready = false;
  state.status.vm_running = false;
  state.hostGit = {
    state: "unavailable",
    ready: false,
    can_enable: false,
    message: "Check the Git installation and try again. The installer is not opened automatically.",
  };
  await page.reload();
  await page
    .getByRole("button", { name: "Start Cage environment", exact: true })
    .click();
  await page.getByText(state.hostGit.message, { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Enable protection and continue", exact: true })
      .count(),
    0,
  );
  state.hostGit = { ...missing };
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await page
    .getByRole("button", { name: "Enable protection and continue", exact: true })
    .waitFor();
  await fs.mkdir("_output/onboarding-qa", { recursive: true });
  await page.screenshot({
    path: "_output/onboarding-qa/git-protection.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 820, height: 580 });
  await page.screenshot({
    path: "_output/onboarding-qa/git-protection-small.png",
    animations: "disabled",
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: no write/start before consent; cancellation; failed write stays blocked; explicit enable starts once; reload rechecks without rewriting; unavailable Git retries safely.",
  );
} finally {
  await browser.close();
}
