import assert from 'node:assert/strict';
import {createWorkbench} from './workbench-fixture.mjs';
let fixture;
const calls=[];
let cancelBiometric=false;
let unavailable=false, supported=true, legacyLauncher=false, failEnrollment=false, sequence=0;
const keychain=new Map();
fixture=await createWorkbench({nativeRequest:async(body)=>{
 if(body.action!=='accountDevice')return null;
 const {operation,kind}=body;
 const a=fixture?.state.account || {};a.devices ||= {};
 const binding=a.device_binding || 'original-directory';
 calls.push({operation,kind,binding});
 if(operation==='status'&&legacyLauncher)return {supported:true,biometric_available:true};
 if(operation==='status')return {supported,biometric_available:true,device_status:Object.fromEntries(['automatic','biometric'].map(k=>[
   k,!a.devices[k]?'disabled':unavailable?'unavailable':keychain.get(binding+'.'+k)===a.devices[k]?(k==='biometric'?'authentication_required':'available'):'missing',
 ]))};
 if(operation==='enable'){
   a.devices[kind]='fixture-'+kind+'-'+(++sequence);
   if(failEnrollment){delete a.devices[kind];throw Error('Keychain save failed');}
   keychain.set(binding+'.'+kind,a.devices[kind]);
 }
 if(operation==='disable'){delete a.devices[kind];keychain.delete(binding+'.'+kind);}
 if(operation==='unlock'){
   assert.equal(keychain.get(binding+'.'+kind),a.devices[kind],'attempted unlock with missing credentials');
   if(kind==='biometric'&&cancelBiometric)throw Error('Fingerprint verification canceled. You can keep using your password.');
   if(kind==='automatic'&&a.require_authentication)throw Error('Manual lock');
   a.unlocked=true;a.require_authentication=false;
 }
 return {ok:true};
}});
const {page,state,browser,errors}=fixture;
const menu=()=>page.getByRole('button',{name:/^Account menu, /});
try {
 Object.assign(state.account,{exists:false,unlocked:false,username:'',devices:{}});
 await page.reload();
 const defaultRemember=page.getByRole('checkbox',{name:/Remember sign-in/});
 await defaultRemember.waitFor();assert.equal(await defaultRemember.isChecked(),true);
 await page.getByLabel('Username',{exact:true}).fill('Forest Studio');
 await page.getByLabel('Set password',{exact:true}).fill('fixture-password');
 await page.getByLabel('Confirm password',{exact:true}).fill('fixture-password');
 await page.getByRole('button',{name:'Create local account',exact:true}).click();await menu().waitFor();
 await menu().click();await page.getByRole('menuitem',{name:'Settings',exact:true}).click();
 const automatic=page.getByRole('checkbox',{name:/Remember sign-in/});
 const biometric=page.getByRole('checkbox',{name:/Unlock with Touch ID/});
 await page.waitForFunction(()=>document.querySelector('.account-device-settings input')?.checked);
 assert.equal(await automatic.isChecked(),true);
 await biometric.click();await page.getByRole('status').filter({hasText:'Turned on'}).waitFor();
 assert.ok(state.account.devices.automatic&&state.account.devices.biometric);
 await page.screenshot({path:'.oil-ui/local-account/shots/device-settings.png'});
 // A genuine reopen keeps enrollment but starts with a locked server.
 state.account.unlocked=false;await page.reload();await menu().waitFor();
 assert.equal(calls.filter(x=>x.operation==='unlock'&&x.kind==='automatic').length,1);
 await menu().click();await page.getByRole('menuitem',{name:'Settings',exact:true}).click();
 await automatic.click();await page.getByRole('status').filter({hasText:'turned off'}).waitFor();
 await page.reload();await menu().click();await page.getByRole('menuitem',{name:'Settings',exact:true}).click();
 assert.equal(await automatic.isChecked(),false,'explicit opt-out was overridden');
 await automatic.click();await page.getByRole('status').filter({hasText:'Turned on'}).waitFor();
 await page.getByRole('button',{name:'Back to the workbench',exact:true}).click();
 await menu().click();await page.getByRole('menuitem',{name:/Lock Cage/}).click();
 await page.getByRole('region',{name:'Unlock Cage',exact:true}).waitFor();
 await page.reload();await page.getByRole('button',{name:'Unlock with Touch ID',exact:true}).waitFor();
 assert.equal(calls.filter(x=>x.operation==='unlock'&&x.kind==='automatic').length,1);
 cancelBiometric=true;await page.getByRole('button',{name:'Unlock with Touch ID',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'Fingerprint verification canceled'}).waitFor();
 assert.equal(state.account.unlocked,false);
 await page.screenshot({path:'.oil-ui/local-account/shots/touch-id-fallback.png'});
 cancelBiometric=false;await page.getByRole('button',{name:'Unlock with Touch ID',exact:true}).click();await menu().waitFor();

 // Copying the account directory preserves server IDs but not native bindings.
 // Stop the old page first, just as directory migration requires stopping Cage.
 const workbenchURL=page.url();
 await page.goto('about:blank');
 const oldDevices=structuredClone(state.account.devices);
 const unlocksBeforeMigration=calls.filter(x=>x.operation==='unlock').length;
 Object.assign(state.account,{device_binding:'migrated-directory',unlocked:false,require_authentication:false});
 await page.goto(workbenchURL);
 await page.getByRole('status').filter({hasText:'The quick sign-in credentials for this directory are missing'}).waitFor();
 assert.equal(calls.filter(x=>x.operation==='unlock').length,unlocksBeforeMigration,JSON.stringify(calls));
 assert.equal(await page.getByRole('button',{name:'Unlock with Touch ID',exact:true}).count(),0);
 await page.reload();await page.getByRole('status').filter({hasText:'The quick sign-in credentials for this directory are missing'}).waitFor();
 assert.equal(calls.filter(x=>x.operation==='unlock').length,unlocksBeforeMigration,'reopen retried invalid enrollment');
 await page.getByLabel('Account password',{exact:true}).fill('fixture-password');
 await page.getByRole('button',{name:'Unlock Cage',exact:true}).click();await menu().waitFor();
 await menu().click();await page.getByRole('menuitem',{name:'Settings',exact:true}).click();
 await page.getByText('The credentials for this directory are missing or no longer valid. Turn it on again.',{exact:true}).first().waitFor();
 assert.equal(await automatic.isChecked(),false);assert.equal(await biometric.isChecked(),false);
 assert.deepEqual(state.account.devices,oldDevices,'checking status mutated authorization');
 await page.locator('.account-device-settings').screenshot({path:'.oil-ui/local-account/shots/device-migrated.png'});
 failEnrollment=true;await automatic.click();await page.getByRole('alert').filter({hasText:'Keychain save failed'}).waitFor();
 await automatic.waitFor();assert.equal(await automatic.isChecked(),false);assert.equal(state.account.devices.automatic,undefined);
 failEnrollment=false;await automatic.click();await page.getByRole('status').filter({hasText:'Turned on'}).waitFor();
 await page.waitForFunction(()=>document.querySelector('.account-device-settings input')?.checked);
 await biometric.click();await page.getByRole('status').filter({hasText:'Turned on'}).waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('.account-device-settings input')].every(e=>e.checked));
 assert.equal(keychain.get('original-directory.automatic'),oldDevices.automatic,'repair touched original binding');
 state.account.unlocked=false;await page.reload();await menu().waitFor();
 assert.equal(calls.filter(x=>x.operation==='unlock').length,unlocksBeforeMigration+1,'repaired enrollment did not unlock');

 // A temporarily inaccessible Keychain is not missing enrollment.
 unavailable=true;await page.reload();await menu().click();await page.getByRole('menuitem',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Check quick sign-in again'}).waitFor();
 assert.equal(await automatic.isChecked(),false);assert.equal(await automatic.isDisabled(),true);
 const savedDevices=structuredClone(state.account.devices);
 unavailable=false;await page.getByRole('button',{name:'Check quick sign-in again'}).click();
 await page.waitForFunction(()=>document.querySelector('.account-device-settings input')?.checked);
 assert.deepEqual(state.account.devices,savedDevices);
 // An older launcher can save credentials but cannot report their availability.
 // Do not present unchecked toggles that repeatedly re-enroll successfully.
 legacyLauncher=true;await page.reload();await menu().click();await page.getByRole('menuitem',{name:'Settings',exact:true}).click();
 await page.getByRole('status').filter({hasText:'The app launcher needs an update'}).waitFor();
 assert.equal(await automatic.count(),0);assert.equal(await biometric.count(),0);
 assert.deepEqual(state.account.devices,savedDevices);
 legacyLauncher=false;
 // Linux/Windows expose no native quick-login capability even with copied records.
 supported=false;state.account.unlocked=false;await page.reload();
 await page.getByLabel('Account password',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Unlock with Touch ID',exact:true}).count(),0);
 assert.equal(calls.filter(x=>x.operation==='unlock').length,unlocksBeforeMigration+1);
 await page.getByLabel('Account password',{exact:true}).fill('fixture-password');
 await page.getByRole('button',{name:'Unlock Cage',exact:true}).click();await menu().waitFor();
 await menu().click();await page.getByRole('menuitem',{name:'Settings',exact:true}).click();
 assert.equal(await automatic.count(),0);
 supported=true;await page.reload();await menu().waitFor();
 // A locked response from a restarted controller invalidates cached availability
 // before the refreshed account (with a different binding) reaches the page.
 const beforeRestart=calls.filter(x=>x.operation==='unlock').length;
 Object.assign(state.account,{device_binding:'restarted-directory',unlocked:false,require_authentication:false});
 await page.evaluate(()=>window.dispatchEvent(new Event('cage-account-locked')));
 await page.getByRole('status').filter({hasText:'The quick sign-in credentials for this directory are missing'}).waitFor();
 assert.equal(calls.filter(x=>x.operation==='unlock').length,beforeRestart,'locked response reused old availability');
 await page.getByLabel('Account password',{exact:true}).fill('fixture-password');
 await page.getByRole('button',{name:'Unlock Cage',exact:true}).click();await menu().waitFor();
 await menu().click();await page.getByRole('menuitem',{name:'Sign out',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Stop environment and sign out',exact:true}).click();
 await page.getByRole('region',{name:'Unlock Cage',exact:true}).waitFor();await page.reload();
 await page.getByLabel('Account password',{exact:true}).waitFor();assert.deepEqual(state.account.devices,{});
 assert.equal(await page.getByRole('button',{name:'Unlock with Touch ID',exact:true}).count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS: enrollment, reopen, manual lock, cancellation, migration, repair, failed save, temporary Keychain failure, unsupported platforms and logout');
}finally{await browser.close();}
