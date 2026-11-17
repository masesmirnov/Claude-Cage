import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createWorkbench } from "./workbench-fixture.mjs";

const output = new URL("../../output/about-settings/", import.meta.url);
await fs.mkdir(output, { recursive: true });
for (const platform of ["darwin", "windows", "linux"]) {
  const build = { version: "0.1.7", commit: "a".repeat(40), modified: true };
  const remoteContext = { mode: "remote", connection_id: "remote-test", instance_id: "test-instance", client_platform: platform, server_platform: "linux", connection: { state: "connected" } };
  const nativeCalls = [];
  let checks = 0, pending, finish;
  let result = {
    build, source: { status: "available", commit: "b".repeat(40), aheadBy: 5 },
    release: { status: "available", version: "0.2.0-rc.1", prerelease: true }, checkedAt: new Date().toISOString(),
  };
  const fixture = await createWorkbench({
    clientContext: remoteContext,
    clientRequest: async (route, path) => {
      if (path === "/client/context") return route.fulfill({ json: remoteContext });
      if (path !== "/client/about") return route.fulfill({ json: {} });
      if (route.request().method() === "GET") return route.fulfill({ json: build });
      checks++;
      if (pending) await pending;
      return route.fulfill({ json: result });
    },
    nativeRequest: async body => { nativeCalls.push(body); return body.action === "appReference" ? true : null; },
  });
  const { page, browser, errors } = fixture;
  try {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("navigation", { name: "Settings groups" }).getByRole("button", { name: "About", exact: true }).click();
    const about = page.getByRole("region", { name: "About Cage", exact: true });
    await about.getByText("0.1.7", { exact: true }).waitFor();
    await about.getByText("aaaaaaaaaaaa", { exact: true }).waitFor();
    await about.getByText(/through the host network and system proxy first/).waitFor();
    assert.equal(checks, 0, "opening About must not trigger an online check");
    assert.ok(await about.getByText(/contains uncommitted changes/).isVisible());
    assert.equal(await page.getByRole("button", { name: "Save settings", exact: true }).count(), 0);
    pending = new Promise(resolve => { finish = resolve; });
    await about.getByRole("button", { name: "Check for updates", exact: true }).click();
    await about.getByRole("status").filter({ hasText: "Checking" }).waitFor();
    assert.ok(await about.getByRole("button", { name: "Checking…", exact: true }).isDisabled());
    finish(); pending = null;
    await about.getByText("The main branch has 5 new commits", { exact: true }).waitFor();
    await about.getByText("0.2.0-rc.1 · Prerelease", { exact: true }).waitFor();
    assert.equal(checks, 1);
    await about.getByRole("link", { name: "View source commits" }).click();
    await about.getByRole("link", { name: "View release notes and downloads" }).click();
    assert.deepEqual(nativeCalls.filter(call => call.action === "appReference").map(call => call.kind), ["source", "releases"]);
    await page.screenshot({ path: fileURLToPath(new URL(`${platform}-available.png`, output)), fullPage: true });

    result = { ...result, source: { status: "failed", error: "The source check connection was interrupted" }, release: { status: "current", version: "0.1.7" } };
    await about.getByRole("button", { name: "Check for updates", exact: true }).click();
    await about.getByText("The source check connection was interrupted", { exact: true }).waitFor();
    await about.getByText("Already the latest release (including prereleases)", { exact: true }).waitFor();
    assert.equal(await about.getByText("The main branch has 5 new commits", { exact: true }).count(), 0, "old results must clear on retry");

    result = { ...result, build: { version: "0.1.7", modified: false }, source: { status: "unknown", commit: "b".repeat(40) } };
    await about.getByRole("button", { name: "Check for updates", exact: true }).click();
    await about.getByText("This build has no commit information, so it cannot check whether it is up to date", { exact: true }).waitFor();
    await about.getByText("Not recorded", { exact: true }).waitFor();

    await page.clock.install();
    result = { ...result, source: { status: "current", commit: "a".repeat(40) }, release: { status: "failed", error: "The update source is rate limited. Try again later.", retryAt: new Date(Date.now()+120000).toISOString() } };
    await about.getByRole("button", { name: "Check for updates", exact: true }).click();
    await about.getByText("In sync with the main branch", { exact: true }).waitFor();
    await about.getByRole("button", { name: "Waiting to retry", exact: true }).waitFor();
    assert.ok(await about.getByRole("button", { name: "Waiting to retry", exact: true }).isDisabled());
    await page.clock.fastForward(121000);
    await about.getByRole("button", { name: "Check for updates", exact: true }).waitFor();
    assert.equal(checks, 4, "cooldown must not schedule automatic checks");
    result = { ...result, source: { status: "diverged", commit: "b".repeat(40) }, release: { status: "ahead", version: "0.1.6" } };
    await about.getByRole("button", { name: "Check for updates", exact: true }).click();
    await about.getByText("The current build has diverged from the main branch; check the differences", { exact: true }).waitFor();
    await about.getByText("The current version is newer than the latest release", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.querySelector(".settings-content").scrollWidth > document.querySelector(".settings-content").clientWidth), false);
    assert.deepEqual(errors, []);
    console.log(`PASS: ${platform} About version, manual source/release checks, prerelease, native links, partial failure, unknown commit, cooldown, retry`);
  } finally { await browser.close(); }
}
