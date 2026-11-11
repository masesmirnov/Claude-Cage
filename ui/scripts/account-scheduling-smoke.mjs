import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {createWorkbench} from "./workbench-fixture.mjs";

const out=new URL("../../docs/test-reports/2026-11-08-account-scheduling/",import.meta.url);
await mkdir(out,{recursive:true});
const scheduling={mode:"balanced",switch_policy:"ask"};
let profiles=[{id:"a",label:"Account A",email:"a@example.invalid",status:"ready",enabled:true},{id:"b",label:"Account B",email:"b@example.invalid",status:"ready",enabled:true}];
const sid="12345678-1234-4321-aaaa-123456789abc";
const session={id:sid,workspace:"/Users/shihao/.claude-cage-workspace",title:"Scheduling check",terminal_available:true,desktop_terminal_id:"first",can_send:true,revision:1,account_id:"a",account_label:"Account A",switch_policy:"ask",turns:[]};
let switchCalls=[];
const account=(route,body)=>{
  if(body.action==="policy")session.switch_policy=body.policy;
  if(body.action==="switch"){
    switchCalls.push(body);session.account_id="b";session.account_label="Account B";session.desktop_terminal_id="second";
    session.account_switch={id:body.request_id,phase:"completed",target_label:"Account B"};
  }
  return route.fulfill({json:{session,source_id:"12345678-1234-4321-aaaa-123456789abd",switch_policy:session.switch_policy,supported:true,candidates:[{id:"b",label:"Account B"}]}});
};
const fixture=await createWorkbench();
const {browser,page,state,errors}=fixture;
try{
  await page.route("**/api/claude-accounts*",async route=>{
    const body=route.request().postDataJSON();
    if(body?.action==="scheduling"){
      Object.assign(scheduling,body.scheduling);
      if(body.order)profiles=body.order.map(id=>profiles.find(a=>a.id===id));
    }
    if(body?.action==="update")Object.assign(profiles.find(a=>a.id===body.id),body);
    return route.fulfill({json:{accounts:profiles,scheduling,detection_status:"offline"}});
  });
  await page.getByRole("button",{name:"Settings",exact:true}).click();
  await page.getByRole("button",{name:"Claude accounts",exact:true}).click();
  await page.getByText("Scheduling settings · Balanced",{exact:true}).click();
  const select=page.getByRole("combobox",{name:"New session assignment",exact:true});
  const policy=page.getByRole("combobox",{name:"New session switch authorization",exact:true});
  const before=(await policy.boundingBox()).y;
  await select.click();
  assert.ok((await policy.boundingBox()).y>before+20,"options must occupy layout space");
  await select.press("End");await select.press("Enter");
  await page.getByRole("region",{name:"Account priority order"}).count();
  assert.equal(scheduling.mode,"sequential");
  await page.getByRole("button",{name:"Raise the priority of Account B"}).click();
  await page.waitForFunction(()=>document.querySelector('.claude-account-order')?.textContent.startsWith('1. Account B'));
  assert.equal(profiles[0].id,"b");
  await policy.click();await page.getByRole("option",{name:"Continue automatically when the usage limit runs out",exact:true}).click();
  assert.equal(scheduling.switch_policy,"allow");
  await page.getByRole("textbox",{name:"Handoff group for Account A"}).fill("Personal accounts");
  await page.getByRole("article",{name:"Account A",exact:true}).getByRole("button",{name:"Save group"}).click();
  assert.equal(profiles.find(a=>a.id==="a").handoff_group,"Personal accounts");
  await page.screenshot({path:fileURLToPath(new URL("scheduling-desktop.png",out))});
  await page.reload();
  await page.getByRole("button",{name:"Settings",exact:true}).click();await page.getByRole("button",{name:"Claude accounts",exact:true}).click();
  await page.getByText("Scheduling settings · Sequential first",{exact:true}).waitFor();

  const phoneContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:"CageMobile/1"});
  const phone=await phoneContext.newPage();
  const phoneErrors=[];phone.on("pageerror",e=>phoneErrors.push(e.message));
  await phone.route("**/api/**",async route=>{
    const path=new URL(route.request().url()).pathname;const body=route.request().postDataJSON();
    if(path.endsWith("/account"))return account(route,body);
    if(path.endsWith("/projects"))return route.fulfill({json:{host:"Test computer",ready:true,shared_sessions:true,projects:[{path:session.workspace,name:"Default workspace"}]}});
    if(path.endsWith("/sessions"))return route.fulfill({json:{sessions:[session]}});
    return route.fulfill({json:session});
  });
  await phone.goto((process.env.CAGE_UI_URL || "http://127.0.0.1:5198")+"/mobile.html");
  const drawer=phone.getByRole("dialog",{name:"Workspace sidebar"});
  await drawer.waitFor();
  const folder=drawer.getByRole("button",{name:"Project Default workspace",exact:true});
  if(await folder.getAttribute("aria-expanded")==="false")await folder.click();
  await phone.getByRole("button",{name:"Scheduling check",exact:true}).click();
  await phone.getByRole("button",{name:"Account A · Bound to session",exact:true}).click();
  const switchButton=phone.getByRole("button",{name:"Switch and restore history",exact:true});
  assert.equal(await switchButton.isDisabled(),true);
  await phone.getByRole("combobox",{name:"Switch authorization for this session"}).click();
  await phone.getByRole("option",{name:"Always wait for the original account",exact:true}).click();
  assert.equal(session.switch_policy,"wait");
  await phone.getByRole("checkbox",{name:"Allow handing this session's history to the selected account"}).check();
  await switchButton.click();
  await phone.getByRole("button",{name:"Account B · Bound to session",exact:true}).waitFor();
  assert.equal(switchCalls.length,1);assert.equal(switchCalls[0].confirm,true);assert.equal(switchCalls[0].target,"b");
  assert.equal(switchCalls[0].continue,false,"switching must not imply task continuation");
  assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await phone.screenshot({path:fileURLToPath(new URL("session-account-phone.png",out))});
  assert.deepEqual(errors,[]);assert.deepEqual(phoneErrors,[]);
  console.log("Scheduling: inline mouse/keyboard selection, ordering, group persistence, session authorization and explicit mobile switch passed.");
}finally{await browser.close();}
