import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createWorkbench } from "./workbench-fixture.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({root, configFile:`${root}/vite.config.js`, server:{host:"127.0.0.1",port:0}});
await vite.listen();
const url = `http://127.0.0.1:${vite.httpServer.address().port}`;
const screenshots = fileURLToPath(new URL("../../output/project-file-cache/", import.meta.url));
await mkdir(screenshots, {recursive:true});
const open = (platform, change) => createWorkbench({url,
  clientContext:{mode:"local",connection_id:"local",client_platform:platform,server_platform:platform,connection:{state:"disconnected"}},
  beforeNavigate:async (_page,state) => {
    Object.assign(state.status,{ready:true,vm_running:true});
    state.settings.project_file_cache = true;
    change?.(state);
  },
});
try {
  for (const platform of ["darwin","windows","linux"]) {
    // A Linux environment with the cache on: the button sits beside "Add project".
    let {browser,page,state,errors} = await open(platform);
    try {
      const refresh = page.getByRole("button",{name:"Refresh project files",exact:true});
      await refresh.waitFor();
      const add = page.getByRole("button",{name:"Add project",exact:true});
      const [left,right] = [await refresh.boundingBox(), await add.boundingBox()];
      assert.ok(left.x + left.width <= right.x + 1 && Math.abs(left.y - right.y) < 2, "the refresh button is not directly left of the add button");
      await page.screenshot({path:`${screenshots}/${platform}-sidebar.png`});
      await refresh.click();
      await page.getByText("Project files refreshed",{exact:true}).waitFor();
      assert.equal(state.projectRefreshes,1);
      state.failRefresh = true;
      await refresh.click();
      await page.getByText("Project files could not be refreshed; please try again later",{exact:true}).waitFor();
      assert.equal(state.projectRefreshes,1);
      assert.equal(await refresh.isEnabled(),true,"the button stays usable after a failure");
      // The setting is with the other general options and can be turned off.
      await page.getByRole("button",{name:"Settings",exact:true}).click();
      const toggle = page.getByRole("switch",{name:/Project file cache/});
      assert.equal(await toggle.isChecked(),true);
      await page.screenshot({path:`${screenshots}/${platform}-setting.png`});
      await toggle.uncheck();
      await page.getByRole("button",{name:"Save settings",exact:true}).click();
      await page.getByRole("region",{name:"Settings",exact:true}).waitFor({state:"hidden"});
      assert.equal(state.settings.project_file_cache,false);
      await refresh.waitFor({state:"hidden"});
      assert.deepEqual(errors,[]);
    } finally { await browser.close(); }

    // The other guest systems read project files directly: no button, no setting.
    for (const system of ["macos","windows-11"]) {
      ({browser,page,state,errors} = await open(platform, state => { state.status.guest_system = system; }));
      try {
        await page.getByRole("button",{name:"Add project",exact:true}).waitFor();
        assert.equal(await page.getByRole("button",{name:"Refresh project files",exact:true}).count(),0,`${system} shows the refresh button`);
        await page.getByRole("button",{name:"Settings",exact:true}).click();
        await page.getByRole("region",{name:"Settings",exact:true}).waitFor();
        assert.equal(await page.getByRole("switch",{name:/Project file cache/}).count(),0,`${system} shows the cache setting`);
        assert.deepEqual(errors,[]);
      } finally { await browser.close(); }
    }
  }
  console.log("project file cache smoke passed");
} finally {
  await vite.close();
}
