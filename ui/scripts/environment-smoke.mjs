import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createWorkbench } from "./workbench-fixture.mjs";

const output = new URL(
  "../../docs/test-reports/2026-10-31-environment/",
  import.meta.url,
);
await fs.mkdir(output, { recursive: true });
const { browser, page, state, errors } = await createWorkbench();
const shot = (name) =>
  page.screenshot({
    path: fileURLToPath(new URL(name + ".png", output)),
    animations: "disabled",
  });
try {
  assert.equal(
    await page.getByRole("button", { name: "Add project", exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await page.getByRole("button", { name: /^Open browser/ }).isDisabled(),
    true,
  );
  assert.equal(await page.locator(".environment-shield.healthy").count(), 0);
  assert.equal(await page.locator(".recent-projects").count(), 0);
  await shot("stopped");
  await page
    .getByRole("button", { name: "Start Cage environment", exact: true })
    .click();
  await page.getByRole("heading", { name: "The Cage environment is ready" }).waitFor();
  await page.getByText("Environment running normally", { exact: true }).waitFor();
  assert.ok(
    (await page
      .getByRole("img", { name: "Environment running normally, network checks passed" })
      .count()) >= 2,
  );
  assert.equal(state.saves.length, 0);
  const links = await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button")
    .allTextContents();
  assert.match(links[0], /Workbench/);
  assert.match(links[1], /Browser/);
  await shot("running");
  await page.getByRole("button", { name: /^Open browser/ }).click();
  await page.getByLabel("Web address or search").waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Web address or search"]')?.value ===
      "https://www.bing.com/",
  );
  assert.equal(state.tabs[0].url, "https://www.bing.com/");
  await page.getByRole("button", { name: "Browser menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await page.getByLabel("New tab address", { exact: true }).fill("https://example.com/start");
  assert.equal(
    await page.getByRole("button", { name: "Save and restart", exact: true }).count(),
    0,
  );
  const starts = state.requests.filter((r) => r.path === "/start").length;
  await shot("settings");
  await page.getByRole("button", { name: "Save address", exact: true }).click();
  await page.getByText("Saved", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close Settings", exact: true }).click();
  assert.equal(state.settings.browser_home_url, "https://example.com/start");
  assert.equal(
    state.requests.filter((r) => r.path === "/start").length,
    starts,
  );
  await page.reload();
  await page.getByRole("heading", { name: "The Cage environment is ready" }).waitFor();
  await page.getByRole("button", { name: /^Open browser/ }).click();
  await page.getByRole("button", { name: "New web page", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Web address or search"]')?.value ===
      "https://example.com/start",
  );
  state.status.safety.gate.until = new Date(Date.now() - 1000).toISOString();
  await page.getByText("Available offline", { exact: true }).waitFor();
  assert.equal(await page.locator(".environment-shield.healthy").count(), 0);
  await page.getByRole("button", { name: "Workbench", exact: true }).click();
  await shot("offline");
  state.status.ready = false;
  state.status.vm_running = false;
  await page.getByRole("heading", { name: "Start the Cage environment first" }).waitFor();
  assert.equal(await page.locator(".environment-shield.healthy").count(), 0);
  await page.setViewportSize({ width: 820, height: 558 });
  await shot("minimum");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  await shot("compact");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    checks: [
      "Environment starts first, no project required",
      "Browser entry follows the workbench",
      "Green checked shield while internet access is allowed, removed on expiry and stop",
      "Default Bing, custom site saved and read back after refresh, applies on next open",
      "Saving the default site needs no restart",
      "820×558 and 375px layouts",
    ],
    scope: "Playwright + mock API; VM behavior is verified separately.",
  };
  await fs.writeFile(
    new URL("smoke-result.json", output),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
