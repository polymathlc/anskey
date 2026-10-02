// Generated art + real QuickBattle controller. The store fixture delivers a
// snapshot before each command reply, reproducing Firestore's normal race.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const runtime=process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const {chromium}=await import(runtime.startsWith('file:')?runtime:pathToFileURL(runtime).href);
const browser=await chromium.launch(process.env.PLAYWRIGHT_BROWSER_CHANNEL?{channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL}:{});
const context=await browser.newContext({viewport:{width:760,height:800},reducedMotion:'no-preference'});
const page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const repo=path.resolve('.'), output=path.resolve(process.env.BATTLE_SCREENSHOTS || '../battle-validation');
fs.mkdirSync(output,{recursive:true});
const fixture=path.join(output,'animation-fixture.html');
fs.writeFileSync(fixture,`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${pathToFileURL(repo+path.sep).href}"><link rel="stylesheet" href="classroom-battle.css"><link rel="stylesheet" href="battle-animation.css"><style>body{background:#102037;color:white;margin:24px;font-family:system-ui}#wheelModal{display:block;position:static;width:auto}#wheelQuickFight{max-width:620px}#samples{display:flex;gap:24px;height:140px;align-items:center}#samples .cbaHero{width:100px;height:100px}</style></head><body><div id="samples"></div><div id="wheelModal" class="open"><select id="wheelClassSelect"><option>Science</option></select><div class="whSpinRow"><button id="wheelSpinBtn">Spin</button></div><div id="wheelHeroPreview"></div></div><script src="battle-bosses.js"></script><script src="battle-content.js"></script><script src="battle-core.js"></script><script>window.ClassroomBattleStore={};</script><script src="battle-animation.js"></script><script src="quick-battle.js"></script></body></html>`);
let checks=0, spin=0;
function check(name,condition){assert.ok(condition,name);checks++;console.log('✓ '+name);}
async function reset(role='warrior',options={}){
  await page.evaluate(({role,options})=>{
    QuickBattle.close(); window.__fail=false;window.__delay=25;
    window.__state=ClassroomBattleCore.reduce(null,{type:'start',id:'animation-start-'+Math.random().toString(36).slice(2),heroes:rwStudents.map((student,index)=>ClassroomBattleCore.configureHero(ClassroomBattleCore.heroFromStudent(student,null,index),{command:'class',role:index===0?role:'warrior'})),bossId:ClassroomBattleCore.BOSSES.find(b=>!b.legacy).id});
    if(options.wounded)__state.heroes.forEach(h=>h.hp=15);
    if(options.knockout)__state.heroes[0].hp=1;
    if(options.victory)__state.bossHp=1;
    if(options.skill){__state.heroes[0].learnedSkills.push(options.skill);__state.heroes[0].cooldowns['mage-firebolt']=99;}
    document.getElementById('wheelModal').classList.add('open');QuickBattle.open('Science');
  },{role,options});
  await page.waitForFunction(()=>!document.getElementById('wheelSpinBtn').disabled);
}
async function land(){const id='animation-spin-'+(++spin);await page.evaluate(id=>{window.__spinPromise=QuickBattle.landed({id:'one',n:'Ari'},id);},id);return id;}
async function phase(value){await page.waitForFunction(value=>document.getElementById('wheelQuickDuel').dataset.cbaPhase===value,value);}
async function settle(){await page.evaluate(()=>__spinPromise);}
try{
  await page.goto(pathToFileURL(fixture).href);
  await page.evaluate(()=>{
    window.currentUser={uid:'teacher'};window.wheelTeacher=()=>!!currentUser;window.ClassroomBattle={isOpen:()=>false};
    window.wheelClass='Science';window.wheelSpinning=false;
    window.rwStudents=[{id:'one',name:'Ari',slots:['Science']},{id:'two',name:'Bo',slots:['Science']}];
    window.rwStudentClasses=s=>s.slots;window.rwStudentsInClass=()=>rwStudents;
    window.wheelState={names:rwStudents.map(s=>({id:s.id,n:s.name}))};window.__calls=0;window.__listener=null;
    ClassroomBattleStore.create=()=>({subscribe(fn){__listener=fn;setTimeout(()=>{if(__listener===fn)fn(structuredClone(__state));},0);return()=>{if(__listener===fn)__listener=null;};},async act(action){__calls++;await new Promise(r=>setTimeout(r,__delay));if(__fail)throw new Error('Save failed for test');__state=ClassroomBattleCore.reduce(__state,action);if(__listener)__listener(structuredClone(__state));await new Promise(r=>setTimeout(r,25));return structuredClone(__state);}});
    document.getElementById('samples').innerHTML=['warrior','ranger','mage','cleric'].map(role=>ClassroomBattleAnimation.heroMarkup(role)).join('');ClassroomBattleAnimation.mount(document.getElementById('samples'));
  });
  await page.waitForFunction(()=>document.querySelectorAll('#samples .cbaReady').length===4,{},{timeout:20000});
  check('all four generated hero sheets load while original images remain accessible fallbacks',await page.evaluate(()=>Array.from(document.querySelectorAll('#samples .cbaHero')).every(node=>node.getAttribute('role')==='img'&&node.getAttribute('aria-label')&&node.querySelector('img').naturalWidth>0)));
  check('all six generated attack and healing sheets load as square four-frame atlases',await page.evaluate(async()=>{const loaded=await Promise.all(['slash','fire','ice','lightning','arrow','heal'].map(name=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(image.naturalWidth>0&&image.naturalWidth===image.naturalHeight);image.onerror=()=>resolve(false);image.src='assets/battle-pixel/animations/'+name+'-sheet.png';})));return loaded.every(Boolean);}));
  const frame=await page.locator('#samples .cbaFrames').first().evaluate(node=>getComputedStyle(node).backgroundPosition);
  await page.waitForTimeout(340);
  check('idling changes the actual sprite-sheet frame',frame!==await page.locator('#samples .cbaFrames').first().evaluate(node=>getComputedStyle(node).backgroundPosition));
  await page.emulateMedia({reducedMotion:'reduce'});
  const still=await page.locator('#samples .cbaFrames').first().evaluate(node=>getComputedStyle(node).backgroundPosition);
  await page.waitForTimeout(340);
  check('reduced motion freezes idle frames',still===await page.locator('#samples .cbaFrames').first().evaluate(node=>getComputedStyle(node).backgroundPosition));
  await page.emulateMedia({reducedMotion:'no-preference'});
  await reset();
  const prior=await page.evaluate(()=>({hp:__state.bossHp,calls:__calls}));
  const firstId=await land();await phase('windup');
  check('saved turn starts one action pose and gates another spin',await page.evaluate(()=>document.querySelector('.cbQuickHero .cbaActing')&&document.getElementById('wheelSpinBtn').disabled&&!QuickBattle.beforeSpin()));
  check('HP remains at the prior saved snapshot during windup',await page.locator('.cbQuickEnemy').textContent().then(text=>text.includes('HP '+prior.hp+'/')));
  await phase('hero-impact');
  check('warrior slash is generated over the enemy',await page.locator('.cbQuickEnemy .cbaFx-slash').count()===1);
  await page.screenshot({path:path.join(output,'animated-warrior-slash.png')});
  const saved=await page.evaluate(()=>structuredClone(__state));
  await page.evaluate(()=>{__listener(structuredClone(__state));QuickBattle.render();});
  check('listener and wheel renders cannot replace an active animation',await page.locator('.cbQuickEnemy .cbaFx-slash').count()===1);
  await phase('enemy-impact');
  check('enemy retaliation targets saved recipients',await page.evaluate(()=>{const targets=__state.lastEvent.enemy.targets.filter(t=>t.damage>0);return targets.every(target=>Array.from(document.querySelectorAll('[data-cba-hero-id]')).some(node=>node.dataset.cbaHeroId===target.heroId&&node.querySelector('.cbaFx-slash')));}));
  await settle();
  check('animation leaves authoritative damage and progression untouched',await page.evaluate(saved=>JSON.stringify(__state)===JSON.stringify(saved),saved));
  check('settled fight exposes final HP and re-enables the wheel',await page.evaluate(()=>!document.getElementById('wheelSpinBtn').disabled&&document.querySelector('.cbQuickEnemy').textContent.includes('HP '+__state.bossHp+'/')&&!document.querySelector('.cbaEffect')));
  await page.evaluate(id=>QuickBattle.landed({id:'one',n:'Ari'},id),firstId);
  check('duplicate landing does not send another command or replay',await page.evaluate(calls=>__calls===calls+1&&!document.querySelector('.cbaPlaying'),prior.calls));
  await reset('warrior',{knockout:true});await land();await phase('windup');
  check('a hero knocked out by the saved enemy reply still performs its earlier attack pose',await page.evaluate(()=>__state.heroes[0].hp===0&&getComputedStyle(document.querySelector('.cbQuickHero .cbaFrames')).animationName==='cbaActionFrames'));
  await settle();
  check('the knocked-out hero becomes still only when that turn settles',await page.evaluate(()=>!!document.querySelector('.cbQuickHero .cbaDormant')&&getComputedStyle(document.querySelector('.cbQuickHero .cbaFrames')).animationName==='none'));
  for(const [role,fx] of [['ranger','arrow'],['mage','fire']]){
    await reset(role);await land();await phase('hero-impact');
    check(role+' uses its generated attack effect',await page.locator('.cbQuickEnemy .cbaFx-'+fx).count()===1);await settle();
  }
  for(const [skill,fx] of [['mage-ice-lance','ice'],['mage-arcane-pulse','lightning']]){
    await reset('mage',{skill});await land();await phase('hero-impact');
    check('automatically chosen '+skill+' plays generated '+fx,await page.evaluate(({skill,fx})=>__state.lastEvent.skillId===skill&&!!document.querySelector('.cbQuickEnemy .cbaFx-'+fx),{skill,fx}));await settle();
  }
  await reset('cleric',{wounded:true});await land();await phase('hero-impact');
  check('cleric healing plays only on the recorded healed teammates',await page.evaluate(()=>{const expected=__state.lastEvent.healed.filter(e=>e.amount>0).map(e=>e.heroId);return __state.lastEvent.damage===0&&expected.length===2&&document.querySelectorAll('.cbaFx-heal').length===expected.length&&expected.every(id=>Array.from(document.querySelectorAll('[data-cba-hero-id]')).some(node=>node.dataset.cbaHeroId===id&&node.querySelector('.cbaFx-heal')))&&!document.querySelector('.cbQuickEnemy .cbaEffect');}));
  await page.screenshot({path:path.join(output,'animated-cleric-heal.png')});await settle();
  await reset('warrior',{victory:true});await land();await phase('hero-impact');
  check('victory chest waits for the final hit presentation',await page.locator('.cbQuickTreasure').count()===0);await settle();
  check('settled victory reveals the saved chest and rewards once',await page.evaluate(()=>document.querySelectorAll('.cbQuickTreasure').length===1&&document.querySelectorAll('.cbQuickTreasure details p').length===__state.rewards.length));
  await reset();await land();await phase('hero-impact');
  const beforeClose=await page.evaluate(()=>JSON.stringify(__state));
  await page.evaluate(()=>{QuickBattle.close();document.getElementById('wheelModal').classList.remove('open');});await settle();await page.waitForTimeout(850);
  check('closing cancels pending visuals without changing the saved fight',await page.evaluate(old=>JSON.stringify(__state)===old&&!document.querySelector('.cbaPlaying')&&!document.querySelector('.cbaEffect'),beforeClose));
  await page.evaluate(()=>{document.getElementById('wheelModal').classList.add('open');QuickBattle.open('Science');});await page.waitForTimeout(100);
  check('reopening shows saved results without historical playback',await page.locator('.cbaPlaying').count()===0);
  await reset();await page.evaluate(()=>__fail=true);await land();await settle();
  check('failed save shows an error and no invented attack',await page.evaluate(()=>document.getElementById('wheelQuickStatus').textContent.includes('Save failed')&&!document.querySelector('.cbaPlaying')&&!document.querySelector('.cbaEffect')));
  await reset();await land();await phase('windup');
  await page.evaluate(()=>{__state.revision++;__state.bossHp--;__listener(structuredClone(__state));});await settle();
  check('newer snapshots queue through playback and win on completion',await page.evaluate(()=>document.querySelector('.cbQuickEnemy').textContent.includes('HP '+__state.bossHp+'/')));
  await reset();await land();await phase('windup');await page.emulateMedia({reducedMotion:'reduce'});await settle();
  check('enabling reduced motion cancels visuals and settles saved health immediately',await page.evaluate(()=>!document.querySelector('.cbaPlaying')&&!document.getElementById('wheelSpinBtn').disabled));
  await reset('mage');const started=Date.now();await land();await settle();
  check('reduced-motion turns bypass the animation timeline',Date.now()-started<1000);
  await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>document.getElementById('samples').style.display='none');await page.setViewportSize({width:375,height:760});await reset('ranger');await land();await phase('hero-impact');
  check('mobile fight remains within the viewport',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(output,'animated-mobile-arrow.png')});await settle();
  const fallback=await context.newPage();await fallback.goto(pathToFileURL(fixture).href);
  await fallback.evaluate(()=>{const NativeImage=Image;window.Image=class extends NativeImage{set src(value){if(value.endsWith('warrior-sheet.png'))queueMicrotask(()=>this.onerror());else super.src=value;}};const samples=document.getElementById('samples');samples.innerHTML=ClassroomBattleAnimation.heroMarkup('warrior');ClassroomBattleAnimation.mount(samples);});
  await fallback.waitForFunction(()=>document.querySelector('#samples img').naturalWidth>0);
  check('failed generated sheet leaves the original avatar visibly available',await fallback.evaluate(()=>!document.querySelector('#samples .cbaReady')&&getComputedStyle(document.querySelector('#samples img')).visibility==='visible'));await fallback.close();
  check('animation browser run has no application errors',errors.length===0);
  console.log('\n'+checks+' animation browser checks passed.');
}finally{await browser.close();fs.unlinkSync(fixture);}
