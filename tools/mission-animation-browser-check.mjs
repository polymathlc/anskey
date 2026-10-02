// Generated mission art and the saved-event-only, nonblocking teacher cameo.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const runtime=process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const {chromium}=await import(runtime.startsWith('file:')?runtime:pathToFileURL(runtime).href);
const browser=await chromium.launch(process.env.PLAYWRIGHT_BROWSER_CHANNEL?{channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL}:{});
const page=await browser.newPage({viewport:{width:760,height:680},reducedMotion:'no-preference'}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const repo=path.resolve('.'),output=path.resolve(process.env.BATTLE_SCREENSHOTS || '../battle-validation');
fs.mkdirSync(output,{recursive:true});
const fixture=path.join(output,'mission-animation-fixture.html');
fs.writeFileSync(fixture,`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${pathToFileURL(repo+path.sep).href}"><link rel="stylesheet" href="classroom-battle.css"><link rel="stylesheet" href="battle-animation.css"><link rel="stylesheet" href="mission-machine.css"><style>body{margin:24px;background:#101b2f;color:#e6efff;font-family:system-ui}#duel{padding:35px 15px;min-height:200px;border:2px solid #7387a2;border-radius:8px}#enemy{width:120px;text-align:center}#enemy img{width:100px;height:100px;object-fit:contain;image-rendering:pixelated}button{padding:12px;margin-top:20px}.mmMachine{width:160px;height:160px}.mmPanel{max-width:420px}</style></head><body><div id="duel" class="cbQuickDuel"><div class="cbQuickHero"><img style="width:100px;height:100px;object-fit:contain;image-rendering:pixelated" src="assets/battle-pixel/warrior.png" alt="Student hero"><p>Ari · Warrior</p></div><strong>VS</strong><div id="enemy" class="cbQuickEnemy" data-cba-actor="enemy"><img src="assets/battle-pixel/goblin.png" alt="Mossfang Goblin"><strong>Mossfang Goblin</strong><p>HP 0 / 783 · Victory</p></div></div><button id="next" onclick="window.clicks++">Next question</button><section class="mmPanel"><div class="mmHeading"><span id="machine" class="mmMachine" role="img" aria-label="Mission machine"></span><div><h3>Mission machine</h3><p>Class quests and prizes</p></div></div></section><script src="battle-bosses.js"></script><script src="battle-content.js"></script><script src="battle-core.js"></script><script src="battle-animation.js"></script><script>window.clicks=0;window.saved={type:'summon',actorName:'One-Punch Chung',move:'One Huge Punch',damage:783};window.start=()=>window.playback=ClassroomBattleAnimation.playChung(document.getElementById('duel'),{event:saved});</script></body></html>`);
let checks=0;
function check(name,value){assert.ok(value,name);checks++;console.log('✓ '+name);}
async function impact(){await page.waitForFunction(()=>document.querySelector('.cbaFx-chung-punch'));}
async function settle(){await page.evaluate(()=>playback.finished);await page.waitForFunction(()=>!document.querySelector('.cbaChungActor'));}
try{
  await page.goto(pathToFileURL(fixture).href);
  check('all three generated mission atlases load',await page.evaluate(async()=>{return (await Promise.all(['mission-machine','chung','chung-punch'].map(name=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(image.naturalWidth>0);image.onerror=()=>resolve(false);image.src='assets/battle-pixel/animations/'+name+'-sheet.png';})))).every(Boolean);}));
  await page.evaluate(()=>ClassroomBattleAnimation.playChung(document.getElementById('duel'),{event:{type:'auto',damage:999}}).finished);
  check('ordinary actions cannot trigger a teacher summon',await page.locator('.cbaChungActor').count()===0);
  const saved=await page.evaluate(()=>JSON.stringify(saved));
  await page.evaluate(()=>{start();});await impact();
  check('Chung uses his own generated attack row',await page.locator('[data-cba-special="chung"] .cbaFrames').evaluate(node=>getComputedStyle(node).backgroundPositionY==='100%'&&node.style.backgroundImage.includes('chung-sheet.png')));
  check('huge punch lands on the saved enemy',await page.locator('#enemy .cbaFx-chung-punch').count()===1);
  check('damage label displays the saved amount',await page.locator('#enemy .cbaNumber').textContent()==='−783');
  await page.locator('#next').click();
  check('next-question controls remain usable during the punch',await page.evaluate(()=>clicks===1&&!!document.querySelector('.cbaPlaying')));
  await page.screenshot({path:path.join(output,'one-punch-chung.png')});await settle();
  check('completion removes every temporary actor and effect',await page.locator('.cbaChungActor,.cbaEffect,.cbaNumber,.cbaPlaying').count()===0);
  check('presentation never changes saved combat data',await page.evaluate(before=>JSON.stringify(saved)===before,saved));
  await page.evaluate(()=>{start();window.firstPlayback=playback;start();});await impact();
  check('a new playback cancels the old cameo',await page.evaluate(async()=>(await firstPlayback.finished).cancelled&&document.querySelectorAll('.cbaChungActor').length===1));
  await page.evaluate(()=>ClassroomBattleAnimation.unmount(document.getElementById('duel')));await settle();await page.waitForTimeout(450);
  check('unmount cancels delayed visual effects',await page.locator('.cbaChungActor,.cbaEffect,.cbaPlaying').count()===0);
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>{start();});await settle();
  check('reduced motion skips teacher playback',await page.locator('.cbaChungActor,.cbaEffect,.cbaPlaying').count()===0);
  const still=await page.locator('#machine').evaluate(node=>getComputedStyle(node).backgroundPosition);
  await page.waitForTimeout(400);
  check('reduced motion freezes the machine',still===await page.locator('#machine').evaluate(node=>getComputedStyle(node).backgroundPosition));
  await page.emulateMedia({reducedMotion:'no-preference'});
  const frame=await page.locator('#machine').evaluate(node=>getComputedStyle(node).backgroundPosition);
  await page.waitForTimeout(650);
  check('idle machine advances through generated frames',frame!==await page.locator('#machine').evaluate(node=>getComputedStyle(node).backgroundPosition));
  await page.locator('#machine').evaluate(node=>node.classList.add('mmRolling'));
  const rolling=await page.locator('#machine').evaluate(node=>getComputedStyle(node).backgroundPosition);
  await page.waitForTimeout(190);
  check('rolling uses its own moving second row',await page.locator('#machine').evaluate((node,before)=>getComputedStyle(node).backgroundPositionY==='100%'&&getComputedStyle(node).backgroundPosition!==before,rolling));
  await page.screenshot({path:path.join(output,'mission-machine-animation.png')});
  await page.setViewportSize({width:375,height:680});await page.evaluate(()=>{start();});await impact();
  check('mobile cameo and machine stay within the viewport',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(output,'one-punch-chung-mobile.png')});await settle();
  check('no browser errors',errors.length===0);
  console.log(`${checks} mission animation browser checks passed.`);
}finally{await browser.close();}
