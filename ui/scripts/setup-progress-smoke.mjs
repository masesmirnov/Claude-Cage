import assert from "node:assert/strict";
import { createWorkbench } from "./workbench-fixture.mjs";

const { browser, page, state, errors } = await createWorkbench();
try {
  let starts = 0;
  await page.route("**/api/start", (route) => {
    starts++;
    state.status.job = { id: "setup-" + starts, kind: "start", running: true, message: "Preparing the base environment",
      setup_progress: { phase: "image", label: "Downloading the Debian 13 base image", received: 25 * 1048576, total: 100 * 1048576 } };
    return route.fulfill({ json: state.status.job });
  });
  await page.getByRole("button", { name: "Start Cage environment", exact: true }).click();
  const panel = page.getByRole("region", { name: "Environment installation progress" });
  const bar = panel.getByRole("progressbar");
  await panel.getByText("25 MiB / 100 MiB").waitFor();
  assert.equal(await bar.getAttribute("aria-valuenow"), "25");
  assert.equal(await panel.locator('[aria-current="step"]').textContent(), "System image");
  await panel.getByRole("button", { name: "Operation details" }).click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  if (process.env.CAGE_SETUP_SCREENSHOT) await page.screenshot({ path: process.env.CAGE_SETUP_SCREENSHOT, animations: "disabled" });
  state.status.job.setup_progress = { phase: "tools", label: "Downloading code-server", received: 8 * 1048576 };
  await panel.getByText("Received 8 MiB").waitFor();
  assert.equal(await bar.getAttribute("aria-valuenow"), null);
  state.status.job.setup_progress = { phase: "services", label: "Configuring the browser and terminal" };
  await panel.getByRole("heading", { name: "Configuring the browser and terminal" }).waitFor();
  assert.equal(await bar.getAttribute("aria-valuenow"), null);
  assert.equal(await panel.locator(".setup-transfer-bytes").count(), 0);
  await panel.getByRole("button", { name: "Stop installation" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  assert.equal(state.requests.filter(r => r.path === "/stop").length, 0);
  await page.setViewportSize({ width: 600, height: 600 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  state.status.job = { ...state.status.job, running: false, error: "Download retries exhausted. The partial file was saved" };
  await panel.getByRole("alert").waitFor();
  assert.equal(await bar.count(), 0);
  await panel.getByText("You can continue the installation manually; saved downloads will try to resume.").waitFor();
  assert.equal(starts, 1);
  await panel.getByRole("button", { name: "Continue installation" }).click();
  await panel.getByText("25 MiB / 100 MiB").waitFor();
  assert.equal(starts, 2);
  state.status.job = { ...state.status.job, running: false, error: "The download was interrupted again. The partial file was saved" };
  await panel.getByRole("alert").waitFor();
  await panel.getByRole("button", { name: "Continue installation" }).click();
  await panel.getByText("25 MiB / 100 MiB").waitFor();
  assert.equal(starts, 3);
  await panel.getByRole("button", { name: "Stop installation" }).click();
  const stopped = page.waitForRequest("**/api/stop");
  await page.getByRole("dialog").getByRole("button", { name: "Stop installation" }).click();
  await stopped;
  assert.deepEqual(errors, []);
  console.log("PASS: measured bytes and percent, unknown size, phase only, details, compact layout, cancel and retry.");
} finally { await browser.close(); }

{
  const {browser,page,state,errors} = await createWorkbench();
  try {
    state.status.job = {id:"mac-install",kind:"guest-install",running:true,message:"Installing the selected guest system…",setup_progress:{system:"macos",operation:"download",phase:"image",label:"Downloading the macOS system image",received:8*1024**3,total:20*1024**3,bytes_per_second:26*1024**2}};
    const panel = page.getByRole("region",{name:"Environment installation progress"});
    const bar = panel.getByRole("progressbar");
    await panel.getByText("8 GiB / 20 GiB",{exact:true}).waitFor();
    await panel.getByText("· 26 MiB/s",{exact:true}).waitFor();
    assert.equal(await bar.getAttribute("aria-valuenow"),"40");
    if (process.env.CAGE_SETUP_NATIVE_SCREENSHOT) await page.screenshot({path:process.env.CAGE_SETUP_NATIVE_SCREENSHOT,animations:"disabled"});
    await page.reload();
    await panel.getByText("8 GiB / 20 GiB",{exact:true}).waitFor();
    assert.equal(await bar.getAttribute("aria-valuenow"),"40");
    state.status.job.setup_progress = {...state.status.job.setup_progress,operation:"verify",label:"Verifying the macOS system image",received:0};
    await panel.getByRole("heading",{name:"Verifying the macOS system image"}).waitFor();
    assert.equal(await bar.getAttribute("aria-valuenow"),"0");
    assert.equal(await panel.getByText(/MiB\/s/).count(),0);
    state.status.job.setup_progress = {system:"macos",phase:"packages",label:"Installing the macOS system"};
    await panel.getByRole("heading",{name:"Installing the macOS system"}).waitFor();
    assert.equal(await panel.locator('[aria-current="step"]').textContent(),"System installation");
    assert.equal(await bar.getAttribute("aria-valuenow"),null);
    await page.setViewportSize({width:375,height:812});
    await page.getByRole("button",{name:"Collapse sidebar",exact:true}).click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if (process.env.CAGE_SETUP_MOBILE_SCREENSHOT) await page.screenshot({path:process.env.CAGE_SETUP_MOBILE_SCREENSHOT,animations:"disabled"});
    state.status.job = {...state.status.job,running:false,error:"Installation interrupted. The original files and disk were kept"};
    await panel.getByRole("alert").waitFor();
    let submitted;
    await page.route("**/api/start",route=>{
      submitted = route.request().postDataJSON();
      state.status.job = {...state.status.job,running:true,error:""};
      return route.fulfill({json:state.status.job});
    });
    const response = page.waitForResponse("**/api/start");
    await panel.getByRole("button",{name:"Continue installation"}).click();
    await response;
    assert.equal(submitted.guest_system,"macos");
    assert.deepEqual(errors,[]);
    console.log("PASS: native image bytes, percent, measured rate, refresh, separate verification, install stage, 375px layout and native retry.");
  } finally {await browser.close();}
}

{
  const { browser, page, state, errors } = await createWorkbench({
    initialization: { required: true, tracked: true, started: true },
    clientContext: { mode: "local", connection_id: "local", client_platform: "windows", server_platform: "windows" },
    beforeNavigate: async (page, state) => {
      state.status.job = { id: "windows-install", kind: "guest-install", running: false,
        setup_progress: { system: "windows-11", phase: "packages", operation: "oobe", label: "Finish the Windows first-time setup in the virtual machine connection window" } };
    },
  });
  try {
    const panel = page.getByRole("region", { name: "Environment installation progress" });
    await panel.getByText(/virtual machine connection \(VMConnect\) window/).waitFor();
    assert.equal(await panel.getByRole("progressbar").count(), 0);
    assert.equal(await panel.getByRole("button", { name: "Stop installation" }).count(), 0);
    await page.reload();
    const resume = panel.getByRole("button", { name: "At the desktop, continue installation" });
    await resume.waitFor();
    let submitted;
    await page.route("**/api/start", route => {
      submitted = route.request().postDataJSON();
      state.status.job = { ...state.status.job, running: true,
        setup_progress: { system: "windows-11", phase: "packages", operation: "credentials", label: "Enter the guest administrator account in the installation window" } };
      return route.fulfill({ json: state.status.job });
    });
    await resume.click();
    await panel.getByText(/Keep that window open/).waitFor();
    assert.equal(submitted.guest_system, "windows-11");
    assert.equal(await resume.count(), 0);
    for (const [operation, phase, label] of [["media", "image", "Downloading and verifying the guest development components"], ["tools", "tools", "Installing guest apps and developer tools"], ["services", "services", "Finishing the guest configuration"]]) {
      state.status.job.setup_progress = { system: "windows-11", phase, operation, label };
      await panel.getByRole("heading", { name: label }).waitFor();
      await panel.getByText(/Keep the PowerShell installation window open/).waitFor();
    }
    await page.setViewportSize({ width: 600, height: 650 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (process.env.CAGE_SETUP_WINDOWS_SCREENSHOT) await page.screenshot({ path: process.env.CAGE_SETUP_WINDOWS_SCREENSHOT, animations: "disabled" });
    state.status.job.setup_progress = { system: "macos", phase: "tools", label: "Installing guest apps and developer tools" };
    await panel.getByText(/Keep the PowerShell installation window open/).waitFor({ state: "hidden" });
    assert.deepEqual(errors, []);
    console.log("PASS: Windows OOBE resume, refresh, guest credentials, component phases and platform-specific guidance.");
  } finally { await browser.close(); }
}
