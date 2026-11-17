import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createWorkbench } from "./workbench-fixture.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({root, configFile:`${root}/vite.config.js`, server:{host:"127.0.0.1",port:0}});
await vite.listen();
const url = `http://127.0.0.1:${vite.httpServer.address().port}`;
const screenshots = fileURLToPath(new URL("../../output/project-folders/", import.meta.url));
await mkdir(screenshots, {recursive:true});
try {
  for (const platform of ["darwin","windows","linux"]) {
    const a = platform === "windows" ? "C:/Projects/frontend" : "/projects/frontend";
    const b = platform === "windows" ? "C:/Projects/backend" : "/projects/backend";
    const fixture = await createWorkbench({url,
      clientContext:{mode:"local",connection_id:"local",client_platform:platform,server_platform:platform,connection:{state:"disconnected"}},
      beforeNavigate:async (_page,state) => {
        Object.assign(state.status,{ready:true,vm_running:true,projects:[]});
        state.settings.workspace="";
        state.chosenFolder=a;
      },
    });
    const {browser,page,state,errors} = fixture;
    try {
      await page.getByRole("button",{name:"Open project",exact:true}).click();
      let dialog = page.getByRole("dialog",{name:"Create project",exact:true});
      await dialog.getByLabel("Project name",{exact:true}).fill("Course system");
      await dialog.getByRole("button",{name:"Choose a folder…",exact:true}).click();
      await dialog.getByText(a,{exact:true}).waitFor();
      state.chosenFolder=b;
      await dialog.getByRole("button",{name:"Choose a folder…",exact:true}).click();
      await dialog.getByText(b,{exact:true}).waitFor();
      const folders = dialog.getByRole("list",{name:"Bound folders"});
      assert.equal(await folders.getByRole("listitem").count(),2);
      assert.equal(await folders.getByText("Default",{exact:true}).count(),1);
      await page.screenshot({path:`${screenshots}/${platform}-create.png`});
      state.failJob=true;
      await dialog.getByRole("button",{name:"Create project",exact:true}).click();
      await dialog.getByRole("alert").waitFor();
      assert.deepEqual(state.status.projects,[]);
      state.failJob=false;
      await dialog.getByRole("button",{name:"Create project",exact:true}).click();
      await page.getByRole("region",{name:"Project Course system",exact:true}).waitFor();
      assert.equal(state.settings.workspace,a);
      assert.deepEqual(state.status.projects,[a,b]);
      await page.reload();
      const project = page.getByRole("region",{name:"Project Course system",exact:true});
      await project.waitFor();
      assert.equal(await page.locator(".sidebar-project").count(),1);
      await project.getByRole("button",{name:"Open the editor for folder backend",exact:true}).click();
      await page.getByRole("tab",{name:"File · backend",exact:true}).waitFor();
      assert.equal(state.tabs.find(tab=>tab.kind==="editor").workspace,b);
      await page.getByRole("button",{name:"Close File · backend",exact:true}).click();
      await page.getByRole("dialog").getByRole("button",{name:"Close editor",exact:true}).click();
      await project.getByRole("button",{name:"New terminal in Course system",exact:true}).click();
      await page.getByRole("menuitem",{name:"Regular terminal",exact:true}).click();
      await page.getByRole("tab",{name:"Terminal 1",exact:true}).waitFor();
      assert.equal(state.terminals[0].workspace,a);
      await page.getByRole("button",{name:"Add project",exact:true}).click();
      dialog=page.getByRole("dialog",{name:"Open project",exact:true});
      await dialog.getByRole("button",{name:"Edit name and folders…",exact:true}).click();
      dialog=page.getByRole("dialog",{name:"Edit project",exact:true});
      assert.equal(await dialog.getByRole("button",{name:"Remove folder frontend",exact:true}).isDisabled(),true);
      await dialog.getByRole("button",{name:"Remove folder backend",exact:true}).click();
      await dialog.getByRole("button",{name:"Save project",exact:true}).click();
      await dialog.getByRole("alert").waitFor();
      assert.deepEqual(state.status.projects,[a,b]);
      await dialog.getByRole("button",{name:"Cancel",exact:true}).click();
      await project.getByRole("tab",{name:"Terminal 1",exact:true}).hover();
      await project.getByRole("button",{name:"Close terminal",exact:true}).click();
      await page.getByRole("dialog").getByRole("button",{name:"Close terminal",exact:true}).click();
      await page.getByRole("button",{name:"Add project",exact:true}).click();
      await page.getByRole("dialog").getByRole("button",{name:"Edit name and folders…",exact:true}).click();
      dialog=page.getByRole("dialog",{name:"Edit project",exact:true});
      await dialog.getByLabel("Project name",{exact:true}).fill("Course workspace");
      await dialog.getByRole("button",{name:"Remove folder backend",exact:true}).click();
      await dialog.getByRole("button",{name:"Save project",exact:true}).click();
      await page.getByRole("region",{name:"Project Course workspace",exact:true}).waitFor();
      assert.deepEqual(state.status.projects,[a]);
      await page.reload();
      await page.getByRole("region",{name:"Project Course workspace",exact:true}).waitFor();
      assert.deepEqual(errors,[]);
      console.log(`PASS ${platform}: create, retry, refresh, member editor, default terminal, active-session unbind guard, rename and unbind`);
    } finally {await browser.close();}
  }
} finally {await vite.close();}
