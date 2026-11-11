// Real authenticated workbench and bundled Mihomo, with a new private profile.
// Uses synthetic local YAML only; never reads the user's profile or subscription.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CAGE_PLAYWRIGHT_MODULE || "playwright");
const run = promisify(execFile);
const executable = process.env.CAGE_SUBSCRIPTION_QA_EXECUTABLE;
assert.ok(executable, "Set CAGE_SUBSCRIPTION_QA_EXECUTABLE to the newly built cage beside mihomo");
const output = path.resolve(process.env.CAGE_SUBSCRIPTION_QA_OUTPUT || "/tmp/cage-subscription-ui");
await fs.mkdir(output, { recursive: true });
const profile = await fs.mkdtemp("/private/tmp/cage-subscription-qa-");
const env = { ...process.env, CLAUDE_CAGE_CONFIG: path.join(profile, "config.json") };
await run(executable, ["init"], { env });
const log = await fs.open(path.join(profile, "server.log"), "w", 0o600);
const service = spawn(executable, ["serve"], { env, stdio: ["ignore", log.fd, log.fd] });
let browser;
const errors = [];
try {
  let control;
  for (let i = 0; i < 100; i++) {
    try {
      control = JSON.parse(await fs.readFile(path.join(profile, "control.json")));
      break;
    } catch {
      if (service.exitCode !== null) throw new Error("Private service exited before readiness");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.ok(control, "Private control service did not start");
  const origin = `http://localhost:${control.port}`;
  const launch = await fetch(`${origin}/api/launch`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ token: control.token }),
  }).then((response) => response.json());
  browser = await chromium.launch({ headless: true, executablePath: process.env.CAGE_TEST_BROWSER_PATH });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(launch.url);
  await page.getByLabel("Username", { exact: true }).fill("Subscription check");
  await page.getByLabel("Set password", { exact: true }).fill("isolated-subscription-qa-password");
  await page.getByLabel("Confirm password", { exact: true }).fill("isolated-subscription-qa-password");
  await page.getByRole("button", { name: "Create local account", exact: true }).click();
  const enter = async () => {
    await page.getByRole("button", { name: /^Settings/ }).click();
    await page.getByRole("button", { name: "Network and proxy", exact: true }).click();
    await page.getByRole("heading", { name: "Built-in proxy", exact: true }).waitFor();
    await page.getByRole("tab", { name: "Subscriptions", exact: true }).click();
  };
  const importYAML = async (name, content) => {
    await page.getByRole("button", { name: "Add source", exact: true }).click();
    await page.getByRole("button", { name: "Local YAML", exact: true }).click();
    await page.getByLabel("Source name", { exact: true }).fill(name);
    await page.getByLabel("Node YAML", { exact: true }).fill(content);
    await page.getByRole("button", { name: "Import and verify", exact: true }).click();
    await page.locator(".proxy-progress").waitFor({ state: "hidden" });
  };
  await enter();
  const pin = "ab".repeat(32);
  const mixed = `proxies:
 - {name: Plain node, type: socks5, server: 127.0.0.1, port: 1080}
 - {name: Port hopping node, type: hysteria2, server: example.com, port: 35000, password: private-password, mport: 35000-39000, pinSHA256: "${pin}"}
 - {name: VLESS extension options, type: vless, server: example.com, port: 443, uuid: 00000000-0000-4000-8000-000000000000, tls: true, udp: true, xudp: true, future-option: private-field-value, reality-opts: {public-key: CQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA, short-id: "0123456789abcdef", support-x25519mlkem768: true}}
 - {name: Incompatible node, type: socks5, server: example.com, port: 1080, INTERFACE_NAME: private-field-value}
 - {name: Dependent incompatible node, type: http, server: example.com, port: 8080, dialer-proxy: Incompatible node}
`;
  await importYAML("Compatibility check", mixed);
  await page.locator(".proxy-notice").filter({ hasText: "Imported 3 nodes, skipped 2" }).waitFor();
  const state = () => page.evaluate(() => fetch("/api/proxy").then((response) => response.json()));
  const imported = await state();
  assert.equal(imported.sources[0].nodes.length, 3);
  assert.equal(imported.sources[0].skipped.length, 2);
  const stored = JSON.parse(await fs.readFile(path.join(profile, "proxy/sources.json")));
  const hy2 = stored.sources[0].nodes.find((node) => node.type === "hysteria2").config;
  assert.equal(hy2.ports, "35000-39000");
  assert.equal(hy2.fingerprint, pin);
  const vless = stored.sources[0].nodes.find((node) => node.type === "vless").config;
  assert.equal(vless.xudp, true);
  assert.equal(vless["future-option"], "private-field-value");
  assert.equal(vless["reality-opts"]["support-x25519mlkem768"], true);
  assert.equal(vless.udp, false);
  for (const secret of [pin, "private-password", "private-field-value", stored.auth]) {
    assert.ok(!JSON.stringify(imported).includes(secret), "Public import status leaked a field value");
  }
  await importYAML("Second source", "proxies: [{name: Backup node, type: http, server: 127.0.0.1, port: 8080}]");
  await page.locator(".proxy-notice").filter({ hasText: "Imported 1 node, skipped 0" }).waitFor();
  const details = page.locator(".proxy-source-skipped").first();
  const summary = details.locator("summary");
  const secondSource = page.locator(".proxy-source").nth(1);
  // Measure relative positions so scrolling cannot hide a layout regression.
  const relativeY = async () => (await secondSource.boundingBox()).y - (await details.boundingBox()).y;
  await summary.scrollIntoViewIfNeeded();
  const before = await relativeY();
  await summary.click();
  await details.getByText(/the node cannot reference local files, network interfaces or extra routes/).waitFor();
  await details.getByText(/a proxy chain must reference a specific node imported successfully from the same source/).waitFor();
  assert.ok((await relativeY()) > before + 30, "Expanded reasons did not push the next source down");
  await page.locator(".settings-content").evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: path.join(output, "partial-import.png") });
  await summary.focus();
  await summary.press("Enter");
  assert.equal(await details.getAttribute("open"), null);
  assert.ok(Math.abs((await relativeY()) - before) < 2, "Collapsed reasons did not restore layout");
  await page.reload();
  await enter();
  await page.locator(".proxy-source-skipped summary").click();
  await page.locator(".proxy-source-skipped").getByText(/the node cannot reference local files, network interfaces or extra routes/).waitFor();
  assert.equal((await state()).sources[0].skipped.length, 2, "Reload lost the import report");
  await page.setViewportSize({ width: 760, height: 1000 });
  const bounds = await page.locator(".proxy-source").first().boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 760, "Import report overflowed the narrow viewport");
  await page.screenshot({ path: path.join(output, "narrow.png") });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await importYAML("All incompatible", "proxies: [{name: Invalid certificate options, type: hysteria2, server: example.com, port: 443, password: private-password, pinSHA256: private-pin}]");
  await page.getByRole("alert").filter({ hasText: "No nodes could be imported" }).waitFor();
  assert.equal((await state()).sources.length, 2, "Failed import changed existing sources");
  assert.ok(!(await page.getByRole("alert").innerText()).includes("private-pin"));
  await page.screenshot({ path: path.join(output, "all-skipped.png") });
  assert.deepEqual(errors, []);
  const result = { passed: true, imported: 3, skipped: 2, checks: ["real UI import", "bundled core validation", "VLESS xudp and nested REALITY options retained", "unknown protocol field retained", "interface key variant rejected", "guest UDP remains disabled", "port hopping and pin retained", "dependent chain skipped", "public status privacy", "success summary", "inline reasons and keyboard collapse", "reload persistence", "narrow viewport", "all-skipped rejection preserves sources"], browserErrors: errors };
  await fs.writeFile(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  const stopped = new Promise((resolve) => service.once("exit", resolve));
  if (service.exitCode === null) {
    service.kill("SIGTERM");
    const force = setTimeout(() => service.kill("SIGKILL"), 5000);
    await stopped;
    clearTimeout(force);
  }
  await log.close();
}
