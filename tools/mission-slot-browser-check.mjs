// The mission machine's slot reels: they spin while the roll saves and stop on the SAVED mission.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const runtime=process.env.PW||'/opt/node22/lib/node_modules/playwright/index.mjs';
const {chromium}=await import(runtime.startsWith('file:')?runtime:pathToFileURL(runtime).href);
const browser=await chromium.launch(process.env.PLAYWRIGHT_BROWSER_CHANNEL?{channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL}:{});
const page=await browser.newPage({viewport:{width:960,height:900},reducedMotion:'no-preference'}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const output=path.resolve(process.env.BATTLE_SCREENSHOTS||'../battle-validation');fs.mkdirSync(output,{recursive:true});
const fixture=path.join(output,'mission-slot-fixture.html');
fs.writeFileSync(fixture,`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${pathToFileURL(path.resolve('.')+path.sep).href}"><link rel="stylesheet" href="mission-machine.css"><style>body{background:#0d1727;margin:18px;font-family:system-ui}#mission{max-width:620px;margin:auto}</style></head><body><div id="mission"></div><script src="mission-content.js"></script><script src="mission-machine.js"></script></body></html>`);
let checks=0;function check(name,condition){assert.ok(condition,name);checks++;console.log('✓ '+name);}
const idle=()=>page.waitForFunction(()=>!document.querySelector('.mmSpinning')&&!__panel.blocked()&&!document.querySelector('.mmStatus').textContent.includes('Loading'),null,{timeout:15000});
// Which face sits on the payline of each reel right now.
const payline=()=>page.evaluate(()=>[...document.querySelectorAll('.mmSlot')].map(slot=>{const box=slot.getBoundingClientRect(),mid=box.top+box.height/2;let best=null,gap=Infinity;slot.querySelectorAll('.mmFace').forEach(face=>{const r=face.getBoundingClientRect(),d=Math.abs(r.top+r.height/2-mid);if(d<gap){gap=d;best=face.textContent;}});return {text:best,gap};}));
try {
  await page.goto(pathToFileURL(fixture).href);
  await page.evaluate(()=>{
    const M=ClassroomMissionContent;
    window.__mission=M.empty();window.__requests=[];window.__hold=false;window.__release=null;window.__rejection=null;window.__lose=false;window.__objective=.3;window.__prize=.1;
    const store={act:async()=>{throw Error('unused');},mission:async request=>{
      if(request.command==='get')return {mission:structuredClone(__mission)};
      __requests.push(structuredClone(request));if(__hold)await new Promise(resolve=>{__release=resolve;});
      if(__rejection)throw Object.assign(Error('The saved mission changed.'),{code:__rejection});
      if(request.command==='turn'&&!(__mission.current&&__mission.current.id===request.id))__mission=M.start(__mission,{id:request.id,now:Date.now(),objectiveRoll:__objective,prizeRoll:__prize});
      else if(request.command==='cancel'){__mission.current.status='cancelled';__mission.revision++;}
      if(__lose){__lose=false;throw Error('Reply lost after save');}
      return {mission:structuredClone(__mission)};
    }};
    window.__mount=()=>{if(window.__panel)__panel.destroy();window.__panel=ClassroomMissionMachine.mount(document.getElementById('mission'),{store,teacherId:'slot-teacher',classId:'Science',canAct:()=>true,getState:()=>null,getSpinId:()=>null});};
    __mount();
  });
  await idle();
  await page.evaluate(()=>{__hold=true;});await page.click('[data-mm=turn]');await page.waitForFunction(()=>!!__release);
  check('turning shows two spinning reels while the roll saves',await page.locator('.mmSpinning .mmStrip').count()===2&&await page.locator('.mmRolling').count()===1);
  const faces=await page.evaluate(()=>[...document.querySelectorAll('.mmStrip')].map(s=>[...s.querySelectorAll('.mmFace')].map(f=>f.textContent)));
  const content=await page.evaluate(()=>[ClassroomMissionContent.OBJECTIVES.map(o=>o.name),ClassroomMissionContent.PRIZES.map(p=>p.name)]);
  check('the reels carry every real objective and every real class prize',content.every((names,i)=>names.every(n=>faces[i].includes(n))));
  const first=await page.evaluate(()=>[...document.querySelectorAll('.mmStrip')].map(s=>s.style.transform));
  await page.waitForTimeout(250);
  const later=await page.evaluate(()=>[...document.querySelectorAll('.mmStrip')].map(s=>s.style.transform));
  check('the reels really move',first.every((t,i)=>t&&t!==later[i]));
  await page.waitForTimeout(1200);
  check('the reels keep spinning for as long as the save is unanswered',await page.locator('.mmSpinning').count()===1);
  check('every mission button waits while the machine spins',await page.locator('.mmPanel button:not([disabled])').count()===0);
  await page.screenshot({path:path.join(output,'mission-slot-spinning.png')});
  const released=Date.now();
  await page.evaluate(()=>{__hold=false;__release();});
  await page.waitForSelector('.mmJackpot',{timeout:6000});
  const lines=await payline(),saved=await page.evaluate(()=>[__mission.current.objectiveName,__mission.current.prize.name]);
  check('both reels stop on the objective and prize the server saved',lines[0].text===saved[0]&&lines[1].text===saved[1]&&lines.every(l=>l.gap<1));
  await page.screenshot({path:path.join(output,'mission-slot-landed.png')});
  await idle();
  const total=Date.now()-released;
  check('the reveal finishes within a few seconds of the save ('+total+' ms)',total<5000);
  check('the saved mission is shown with its buttons after the reels stop',await page.locator('.mmReels').textContent().then(t=>t.includes(saved[0])&&t.includes(saved[1]))&&await page.locator('[data-mm=cancel]').isEnabled());
  check('one roll was sent',await page.evaluate(()=>__requests.filter(r=>r.command==='turn').length===1));
  await page.click('[data-mm=cancel]');await idle();
  await page.evaluate(()=>{__objective=.99;__prize=.97;});await page.click('[data-mm=turn]');
  await page.waitForSelector('.mmJackpot',{timeout:6000});
  const rare=await payline();
  check('a rare prize lands highlighted as rare',rare[1].text==='+5 bonus points for all students'&&await page.locator('.mmSpinning .mmReel.mmRare').count()===1);
  await idle();await page.click('[data-mm=cancel]');await idle();
  await page.evaluate(()=>{__rejection='mission_changed';});await page.click('[data-mm=turn]');
  await page.waitForFunction(()=>!document.querySelector('.mmSpinning'));
  check('a refused roll stops the reels at once and says why',await page.locator('.mmStatus').textContent().then(t=>t.includes('saved mission changed')));
  await page.evaluate(()=>{__rejection=null;__lose=true;});await idle();await page.click('[data-mm=turn]');
  await page.waitForSelector('[data-mm=retry]');
  check('an unconfirmed save stops the reels and offers Retry',await page.locator('.mmSpinning').count()===0);
  await page.click('[data-mm=retry]');await page.waitForSelector('.mmJackpot',{timeout:8000});await idle();
  check('retrying spins again and lands on the same saved roll',await page.evaluate(()=>__requests.filter(r=>r.command==='turn').slice(-2).every((r,i,a)=>r.id===a[0].id))&&await page.locator('[data-mm=cancel]').isEnabled());
  await page.click('[data-mm=cancel]');await idle();
  await page.evaluate(()=>{__hold=true;});await page.click('[data-mm=turn]');await page.waitForFunction(()=>!!__release);
  await page.evaluate(()=>{__panel.destroy();__hold=false;__release();});await page.waitForTimeout(400);
  check('closing mid-spin leaves nothing behind',await page.evaluate(()=>!document.getElementById('mission').children.length));
  await page.evaluate(()=>{sessionStorage.clear();__mount();});await idle();await page.click('[data-mm=cancel]');await idle();
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.click('[data-mm=turn]');await page.waitForTimeout(30);
  check('reduced motion skips the spin and shows the saved mission straight away',await page.locator('.mmSpinning').count()===0);
  await idle();
  check('reduced motion still reveals the saved mission',await page.locator('[data-mm=cancel]').isEnabled());
  await page.emulateMedia({reducedMotion:'no-preference'});await page.click('[data-mm=cancel]');await idle();
  await page.setViewportSize({width:340,height:800});await page.evaluate(()=>{__hold=true;});await page.click('[data-mm=turn]');await page.waitForFunction(()=>!!__release);
  check('the reels fit a phone without horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(output,'mission-slot-phone.png')});
  await page.evaluate(()=>{__hold=false;__release();});await idle();
  check('no page errors',errors.length===0);
  console.log(checks+' mission slot checks passed');
} catch(error) {console.error(errors);throw error;}
finally {await browser.close();}
