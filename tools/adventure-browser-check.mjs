// Real generated art, scene animation, responsive layout and saved-state presentation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const runtime=process.env.PW||'/opt/node22/lib/node_modules/playwright/index.mjs';
const {chromium}=await import(pathToFileURL(runtime).href),browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[],out=path.resolve(process.env.BATTLE_SCREENSHOTS||'../battle-validation');
fs.mkdirSync(out,{recursive:true});page.on('pageerror',e=>errors.push(e.message));
const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/classroom-battle.css"><link rel="stylesheet" href="/battle-adventure.css"><link rel="stylesheet" href="/hero-skill-tree.css"><link rel="stylesheet" href="/battle-animation.css"><style>body{margin:0;padding:24px;background:#0b1523;color:#fff;font-family:system-ui}main{max-width:1000px;margin:auto}h1{font-size:22px}#tree{margin-top:24px}@media(max-width:500px){body{padding:8px}}</style></head><body><main><h1>Classroom Chronicles · Adventure</h1><div id="scene"></div><div id="tree"></div></main><script src="/battle-bosses.js"></script><script src="/battle-content.js"></script><script src="/battle-core.js"></script><script src="/battle-animation.js"></script><script src="/battle-display.js"></script><script src="/battle-adventure.js"></script><script src="/hero-skill-tree.js"></script></body></html>';
await page.route('http://adventure.test/**',route=>{const name=new URL(route.request().url()).pathname.slice(1);return !name?route.fulfill({contentType:'text/html',body:html}):/^(battle-|classroom-battle|hero-skill-tree|assets\/battle-pixel\/)/.test(name)?route.fulfill({path:path.resolve(name)}):route.fulfill({status:404});});
let checks=0;const check=(message,value)=>{assert.ok(value,message);checks++;console.log('✓ '+message);};
async function scene(kind='enemy',biome='forest',travelling=false,compact=false){await page.evaluate(({kind,biome,travelling,compact})=>{
  const C=ClassroomBattleCore;
  if(!window.s){const party=['warrior','ranger','mage','cleric','paladin','sharpshooter','archmage','oracle'].map((form,i)=>{const role=C.JOBS[form]?.role||form;let h=C.heroFromStudent({id:form,name:['Arun','Mei','Kai','Aisha','Ryan','Ava','Ravi','Ling'][i]},null,Object.keys(C.ROLES).indexOf(role));h.level=50;h.xp=C.xpForLevel(50);h.job=C.JOBS[form]?form:null;h.gender=i%2?'female':'male';return C.cleanHero(h,h);});window.s=C.reduce(null,{type:'start',id:'browser-adventure-0001',heroes:party});s.heroes=party;}
  s.status='active';s.adventure={version:1,step:8,biome,kind,eventId:kind==='event'?'guardian-shrine':null,resolved:false};
  ClassroomAdventure.render(document.getElementById('scene'),s,s.heroes,{travelling,compact});
},{kind,biome,travelling,compact});}
try{
  await page.goto('http://adventure.test/');await scene('enemy','forest',true);
  await page.waitForFunction(()=>document.querySelector('.advWalk')&&getComputedStyle(document.querySelector('.advWalk')).animationPlayState==='running');
  const p1=await page.locator('.advBackdrop').evaluate(n=>getComputedStyle(n).backgroundPosition);
  await page.waitForTimeout(250);const p2=await page.locator('.advBackdrop').evaluate(n=>getComputedStyle(n).backgroundPosition);
  check('the party walks and the background scrolls while travelling',p1!==p2&&await page.locator('.advTraveller').count()===8);
  check('male/female base and advanced forms retain individual walking artwork',await page.evaluate(()=>[...document.querySelectorAll('.advWalk')].every(n=>n.style.backgroundImage.includes('walk-')&&n.getAttribute('aria-label').includes('walking'))));
  const saved=await page.evaluate(()=>JSON.stringify(s));await page.click('[data-adventure-pause]');
  check('motion pause is accessible and changes no saved combat data',await page.evaluate(before=>document.querySelector('[data-adventure-pause]').getAttribute('aria-pressed')==='true'&&getComputedStyle(document.querySelector('.advBackdrop')).animationPlayState==='paused'&&JSON.stringify(s)===before,saved));
  await page.click('[data-adventure-pause]');
  await page.locator('#scene').screenshot({path:path.join(out,'adventure-forest-walking.png')});
  for(const biome of ['forest','ruins','cavern','volcano']){
    await scene('enemy',biome,false);check(biome+' loads its generated scene and stops at an enemy',await page.evaluate(name=>getComputedStyle(document.querySelector('.advBackdrop')).backgroundImage.includes(name+'.png')&&getComputedStyle(document.querySelector('.advWalk')).animationPlayState==='paused'&&!!document.querySelector('.advRoadObject .cbEnemySprite,.advRoadObject img'),biome));
  }
  await scene('chest','ruins');check('a rare chest explains the saved victory bonus',await page.locator('.advCaption').textContent().then(t=>t.includes('6%')&&t.includes('rare-or-better')));
  await page.locator('#scene').screenshot({path:path.join(out,'adventure-rare-chest.png')});
  await scene('uber','volcano');check('rare uber bosses visibly announce their actual empowerment',await page.locator('.advScene.advUber').count()===1&&await page.locator('.advCaption').textContent().then(t=>t.includes('2%')&&t.includes('1.8×')));
  await page.locator('#scene').screenshot({path:path.join(out,'adventure-uber-boss.png')});
  await scene('event','cavern');check('roadside events identify the blessing and its trigger',await page.locator('.advCaption').textContent().then(t=>t.includes('Guardian shrine')&&t.includes('first correct answer')));
  await page.evaluate(()=>{s.exposures={physical:{amount:.3,turns:4,heroId:s.heroes[3].id},elemental:{amount:.25,turns:3,heroId:s.heroes[3].id}};ClassroomAdventure.render(document.getElementById('scene'),s,s.heroes);});
  check('physical and elemental debuffs show their source and remaining duration',await page.locator('.advBreak').count()===2&&await page.locator('.advBreaks').textContent().then(t=>t.includes('Aisha')&&t.includes('30%')&&t.includes('4 damaging actions')));
  await page.evaluate(()=>{const h=s.heroes[3];window.tree=ClassroomSkillTree.render(document.getElementById('tree'),{hero:h});});
  await page.click('[data-hst-node="cleric-convergence-apex"]');
  check('ultimate inspection highlights all three dependencies and explains team synergy',await page.locator('.hstNode-required').count()===3&&await page.locator('.hstLink-required').count()===3&&await page.locator('.hstDetail').textContent().then(t=>t.includes('adaptive damage')&&t.includes('Team setup')));
  await page.screenshot({path:path.join(out,'adventure-and-branching-builds-desktop.png'),fullPage:true});
  for(const viewport of [{width:820,height:1180},{width:390,height:844}]){
    await page.setViewportSize(viewport);await scene('event','cavern',false,true);
    check(viewport.width+'px layout keeps scenery, controls and skill details within the page',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.advScene').getBoundingClientRect().right<=innerWidth&&document.querySelector('[data-adventure-pause]').getBoundingClientRect().left>=0));
  }
  await page.screenshot({path:path.join(out,'adventure-and-builds-mobile.png'),fullPage:true});
  await page.emulateMedia({reducedMotion:'reduce'});await scene('enemy','forest',true);
  check('reduced motion suppresses scrolling, walking and approach effects',await page.evaluate(()=>['.advBackdrop','.advWalk','.advRoadObject'].every(q=>getComputedStyle(document.querySelector(q)).animationName==='none')));
  check('saved encounter presentation never mutates its source',await page.evaluate(()=>s.bossHp>0&&s.adventure.step===8));
  assert.deepEqual(errors,[]);console.log(checks+' adventure browser checks passed.');
}finally{await browser.close();}
