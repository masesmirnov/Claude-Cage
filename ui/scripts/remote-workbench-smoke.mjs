// UI contract fixture: remote paths, generation binding and client-only quit.
// SSH, cookies and streaming use the real protocol tests in internal/remotehost.
import assert from "node:assert/strict";
import { createWorkbench } from "./workbench-fixture.mjs";

const connection = "test-remote-connection";
const instance = "a".repeat(64);
const nativeCalls = [];
const { browser, page, state, errors } = await createWorkbench({
  clientContext: { mode: "remote", client_only: true, connection_id: connection, instance_id: instance, host_id: "test-host", name: "Cloud test environment", client_platform: "darwin", server_platform: "linux", connection: { state: "connected", connection_id: connection, instance_id: instance } },
  nativeRequest: async (body) => { nativeCalls.push(body); return body.action === "accountDevice" ? { supported: false } : true; },
});
const requests = [];
page.on("request", (request) => { if (request.url().includes("/api/")) requests.push(request); });
let directoryRequests = 0;
await page.route("**/api/projects/directories?*", async (route) => {
  const request = route.request();
  assert.equal(request.headers()["x-cage-connection"], connection);
  directoryRequests++;
  const path = new URL(request.url()).searchParams.get("path");
  await route.fulfill({ json: path === "/srv/projects/research" ? { path, parent: "/srv/projects", directories: [], selectable: true } : { path: "/srv/projects", parent: "/srv", directories: [{ name: "research", path: "/srv/projects/research" }], selectable: false } });
});
let resourceData = {
  runtime: "container", automatic: false, running: true,
  configured_memory_bytes: 8 * 1073741824, configured_cpus: 2,
  recommended_memory_bytes: 8 * 1073741824, recommended_cpus: 2,
  restart_required: false, observation: null, resources_verified: true, pids_limit: 512, resource_error: "",
};
await page.route("**/api/environment/resources", (route) => route.fulfill({ json: resourceData }));
try {
  state.settings.workspace = "/srv/cage/workspace";
  state.settings.keyboard = "native";
  Object.assign(state.status, { keyboard: "native", projects: [state.settings.workspace], environment_directory: state.settings.workspace });
  await page.reload();
  await page.getByRole("heading", { name: "Start the Cage environment first" }).waitFor();
  await page.getByRole("button", { name: "Start Cage environment", exact: true }).click();
  await page.getByRole("heading", { name: "The Cage environment is ready", exact: true }).waitFor();
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await page.getByRole("button", { name: "Add cloud project…", exact: true }).click();
  const chooser = page.getByRole("region", { name: "Cloud folders" });
  await chooser.getByRole("button", { name: "research", exact: true }).click();
  await chooser.getByRole("button", { name: "Choose this cloud folder", exact: true }).click();
  assert.equal(await page.getByLabel("New project folder", { exact: true }).inputValue(), "/srv/projects/research");
  await page.getByRole("dialog").getByRole("button", { name: "Open project", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(state.settings.workspace, "/srv/projects/research");
  assert.equal(directoryRequests, 2);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("navigation", { name: "Settings groups" }).getByRole("button", { name: "General", exact: true }).click();
  const macKeyboard = page.getByRole("radio", { name: /Mac shortcuts/ });
  assert.equal(await macKeyboard.isChecked(), true, "Mac client defaults must not follow Linux server keyboard mode");
  const savesBefore = state.requests.filter((item) => item.path === "/settings" && item.method === "POST").length;
  await page.getByRole("radio", { name: /Guest-native shortcuts/ }).check();
  assert.equal(await page.evaluate((instance) => localStorage.getItem(`cage-keyboard:remote:${instance}`), instance), "native");
  assert.equal(state.requests.filter((item) => item.path === "/settings" && item.method === "POST").length, savesBefore, "client keyboard changes must not write cloud settings");
  await macKeyboard.check();
  await page.getByRole("navigation", { name: "Settings groups" }).getByRole("button", { name: "Environment and recovery", exact: true }).click();
  await page.getByRole("heading", { name: "Server container resource limits", exact: true }).waitFor();
  const resources = page.getByRole("region", { name: "Compute resources" });
  await resources.getByText("8.0 GiB", { exact: true }).waitFor();
  await resources.getByText("Verified", { exact: true }).waitFor();
  await resources.getByText("512", { exact: true }).waitFor();
  assert.equal(await resources.getByText("Waiting for a sample", { exact: true }).count(), 0);
  assert.equal(await resources.getByRole("button", { name: "Restart and apply automatic resource settings", exact: true }).count(), 0);
  resourceData = { ...resourceData, configured_memory_bytes: 0, configured_cpus: 0, pids_limit: 0, resources_verified: false, resource_error: "Test: could not verify the server resource group limits" };
  await resources.getByRole("alert").getByText("Test: could not verify the server resource group limits", { exact: true }).waitFor();
  assert.equal(await resources.getByText("0.0 GiB", { exact: true }).count(), 0, "failed verification must not render zero as a real resource limit");
  assert.equal(await resources.getByText("8.0 GiB", { exact: true }).count(), 0, "failed verification must not retain a previously verified value");
  assert.equal(await resources.getByText("Not verified", { exact: true }).count(), 3);
  await page.locator("#settings-back").click();
  assert.ok(nativeCalls.some((item) => item.action === "accountDevice"), "remote account must query native device capability");
  assert.ok(nativeCalls.filter((item) => item.action === "accountDevice").every((item) => item.connection_id === connection), "device operations must bind to the remote generation");
  assert.ok(requests.some((request) => request.url().includes("/api/browser/events?connection=" + connection)), "SSE must bind to the remote generation");
  for (const request of requests.filter((request) => new URL(request.url()).pathname === "/api/projects/open")) assert.equal(request.headers()["x-cage-connection"], connection);
  await page.evaluate(() => window.cageNativeAction("quit"));
  assert.ok(nativeCalls.some((item) => item.action === "quitNow" && item.connection_id === connection));
  assert.equal(state.requests.some((item) => item.path === "/account/suspend"), false);
  assert.equal(state.requests.some((item) => item.path === "/stop"), false);
  const downloadID = "de30b5c6-5460-4ebe-bdc6-343cd850ce47";
  let saved = [];
  await page.route("**/api/input/files/desktop/requests", (route) => route.fulfill({ json: { uploads: [], downloads: [{ id: downloadID, name: "report.pdf", path: "/srv/cage/Downloads/report.pdf", state: "saved", target: "desktop" }] } }));
  await page.route("**/api/browser/files/saved", (route) => route.fulfill({ json: saved }));
  await page.reload();
  await page.getByRole("button", { name: "Downloaded files", exact: true }).click();
  const downloads = page.getByRole("dialog", { name: "Downloaded files" });
  await downloads.getByText("Saved to the cloud", { exact: true }).waitFor();
  assert.equal(await downloads.getByRole("button", { name: "Open file", exact: true }).count(), 0, "cloud path must not offer a local open action");
  saved = [{ id: downloadID, name: "report.pdf", path: "/tmp/cage-ui/report.pdf", instance_id: instance }];
  await page.evaluate(() => window.dispatchEvent(new Event("cage-download-saved")));
  await downloads.getByText("Saved to this computer", { exact: true }).waitFor();
  await downloads.getByRole("button", { name: "Open file", exact: true }).click();
  assert.ok(nativeCalls.some((item) => item.action === "browserDownloadAction" && item.connection_id === connection));
  state.account.unlocked = false;
  await page.reload();
  await page.getByText("Account data is stored on this cloud host", { exact: true }).waitFor();
  assert.ok(nativeCalls.filter((item) => item.action === "accountDevice").every((item) => item.connection_id === connection));
  assert.deepEqual(errors, []);
  console.log("PASS: remote directories, client-scoped keyboard, container resource limits, HTTP/SSE/native-account generation binding, local/cloud download distinction, password fallback and quit preserving cloud tasks");
} finally { await browser.close(); }
