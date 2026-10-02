// Real student UI + skill graph, with an in-memory verified-service boundary.
// Ownership, transactions and authentication are covered separately by server tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const runtime=process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const {chromium}=await import(runtime.startsWith('file:')?runtime:pathToFileURL(runtime).href);
const browser=await chromium.launch(process.env.PLAYWRIGHT_BROWSER_CHANNEL?{channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL}:{});
const page=await browser.newPage({viewport:{width:1360,height:980},reducedMotion:'reduce'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const output=path.resolve(process.env.BATTLE_SCREENSHOTS || '../battle-validation');fs.mkdirSync(output,{recursive:true});
let checks=0;
function check(label,result){assert.ok(result,label);checks++;console.log('✓ '+label);}
async function idle(){await page.waitForFunction(()=>document.getElementById('shDialog').getAttribute('aria-busy')!=='true');}
try{
  await page.route('https://hero.test/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/') return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif}button,select{font:inherit}</style><base href="https://hero.test/"><link rel="stylesheet" href="student-heroes.css"><link rel="stylesheet" href="hero-skill-tree.css"></head><body><button id="myHeroBtn">My Hero</button><button id="heroClaimsBtn">Hero claims</button><div id="profileModal"></div></body></html>'});
    const local=path.resolve('.'+url.pathname);
    if(!local.startsWith(process.cwd()+path.sep)||!fs.existsSync(local))return route.abort();
    return route.fulfill({path:local});
  });
  await page.goto('https://hero.test/');
  for(const script of ['battle-bosses.js','battle-content.js','battle-core.js','hero-skill-tree.js'])await page.addScriptTag({url:'/'+script});
  await page.evaluate(()=>{
    window.currentUser={uid:'student-a',email:'ari@example.test'};
    window.isAdmin=u=>u?.uid==='teacher';window.isSharedVisitor=()=>false;window.profileComplete=()=>true;window.studentProfile={level:'P5'};
    const Core=ClassroomBattleCore;
    let hero=Core.heroFromStudent({id:'ari',name:'Ari'});hero={...hero,level:4,xp:450,skillPoints:8,classChosen:false};
    hero.inventory.push({id:'bag:iron-band',itemId:Object.values(Core.ITEMS).find(i=>i.type==='equipment').id,quantity:1});
    hero.inventory[2].id='bag:'+hero.inventory[2].itemId;
    const data=window.__heroFixture={claim:null,hero,slot:'Science Saturday 11am',active:null,delay:false,calls:[],release:null};
    window.ClassroomHeroAPI={request:async action=>{
      data.calls.push(structuredClone(action));
      const uid=currentUser.uid;
      if(data.delay&&action.type==='me')await new Promise(resolve=>data.release=resolve);
      if(action.type==='me')return !data.claim||data.claim.uid!==uid?{status:'unclaimed'}:{status:data.claim.status,claim:data.claim,...(data.claim.status==='approved'?{hero:structuredClone(data.hero),activeEncounter:data.active}:{})};
      if(action.type==='catalog')return {slots:[{id:data.slot,name:data.slot}],students:[{id:'ari',name:'Ari',lessonSlots:[data.slot],status:data.claim?'claimed':'available'},{id:'bo',name:'Bo',lessonSlots:[data.slot],status:'claimed'}]};
      if(action.type==='claim'){data.claim={uid,name:'Ari',email:currentUser.email,lessonSlot:data.slot,lessonSlots:[data.slot],studentId:'ari',status:'pending'};return {};}
      if(action.type==='cancelClaim'){data.claim=null;return {};}
      if(action.type==='claims')return {claims:data.claim?[data.claim]:[],activeEncounters:data.active?[{...data.active,studentId:'ari',name:'Ari'}]:[]};
      if(action.type==='endEncounter'){data.active=null;return {status:'ended'};}
      if(action.type==='approve'){data.claim.status='approved';return {};}
      if(action.type==='unlink'||action.type==='reject'){data.claim=null;return {};}
      if(action.type==='configure'){
        if(data.active)throw new Error('Finish the encounter first.');
        data.hero=Core.configureHero(data.hero,action);if(action.command==='class')data.hero.classChosen=true;
        return {hero:data.hero};
      }
      throw new Error('Unknown fixture request');
    }};
    window.__account=uid=>{currentUser={uid,email:uid+'@example.test'};StudentHeroes.roleChanged();StudentHeroes.profileReady(uid);};
  });
  await page.addScriptTag({url:'/student-heroes.js'});
  await page.waitForSelector('#shSlot');
  check('My Hero opens automatically after student profile readiness',await page.locator('#shDialog').evaluate(d=>d.open));
  await page.selectOption('#shSlot','Science Saturday 11am');
  check('claimed names are unavailable and Lesson slot has its own label',await page.locator('[data-sh-claim="bo"]').isDisabled()&&await page.locator('label[for="shSlot"]').textContent().then(t=>t.includes('Lesson slot')));
  await page.click('[data-sh-claim="ari"]');await idle();
  check('claim requests wait for teacher approval before class selection',await page.locator('.shPending').isVisible()&&await page.locator('[data-sh-role]').count()===0);
  await page.evaluate(()=>__account('teacher'));
  check('teacher role closes the student view',!(await page.locator('#shDialog').evaluate(d=>d.open)));
  await page.click('#heroClaimsBtn');await page.waitForSelector('[data-sh-manage="approve"]');
  check('teacher sees the account email with its pending roster name',await page.locator('.shClaimRow').textContent().then(t=>t.includes('ari@example.test')&&t.includes('Ari')));
  await page.click('[data-sh-manage="approve"]');await idle();await page.evaluate(()=>__account('student-a'));
  await page.waitForSelector('[data-sh-role="mage"]');
  check('approved first-time hero gets all four pixel classes',await page.locator('.shClass').count()===4&&await page.locator('.shClass img').evaluateAll(imgs=>imgs.every(img=>img.complete&&img.naturalWidth>0)));
  await page.screenshot({path:path.join(output,'student-class-picker.png'),fullPage:true});
  await page.click('[data-sh-role="mage"]');await idle();await page.waitForSelector('#shTree');
  check('choosing a class preserves XP, inventory and roster identity',await page.evaluate(()=>__heroFixture.hero.role==='mage'&&__heroFixture.hero.xp===450&&__heroFixture.hero.inventory.length===3&&__heroFixture.hero.studentId==='ari'));
  check('approved hero renders the connected twelve-node skill tree',await page.locator('#shTree [data-hst-node]').count()===12);
  await page.click('[data-hst-node="mage-ice-lance"]');
  await page.locator('[data-hst-learn]').click();await idle();
  check('learning through the graph persists progression at the API boundary',await page.evaluate(()=>__heroFixture.hero.learnedSkills.includes('mage-ice-lance')&&__heroFixture.hero.skillPoints===7));
  await page.locator('[data-sh-equip]').first().click();await idle();
  check('equipment uses the inventory instance identifier',await page.evaluate(()=>__heroFixture.hero.equipped?.startsWith('bag:')));
  await page.screenshot({path:path.join(output,'student-my-hero.png'),fullPage:true});
  await page.evaluate(()=>{__heroFixture.active={classId:'Science Saturday 11am',encounterId:'battle-one'};});
  await page.click('#shRefresh');await page.waitForSelector('.shLock');
  check('live encounter blocks student build changes',await page.locator('[data-sh-role]').evaluateAll(nodes=>nodes.every(n=>n.disabled))&&await page.locator('[data-sh-equip]').evaluateAll(nodes=>nodes.every(n=>n.disabled)));
  await page.evaluate(()=>__account('teacher'));await page.click('#heroClaimsBtn');await page.waitForSelector('[data-sh-manage="endEncounter"]');
  await page.click('[data-sh-manage="endEncounter"]');await idle();
  check('teacher can release an encounter without changing character progress',await page.evaluate(()=>!__heroFixture.active&&__heroFixture.hero.xp===450));
  await page.evaluate(()=>__account('student-a'));await page.waitForSelector('#shTree');
  check('released hero can manage skills again',await page.locator('.shLock').count()===0&&await page.locator('[data-sh-role="mage"]').isEnabled());
  await page.evaluate(()=>{__heroFixture.active=null;__heroFixture.claim.lessonSlots=['Science Sunday 1pm'];});
  await page.click('#shRefresh');await page.waitForFunction(()=>document.querySelector('.shHeroTop').textContent.includes('Sunday'));
  check('a changed lesson slot keeps the existing character',await page.evaluate(()=>__heroFixture.hero.xp===450&&__heroFixture.hero.role==='mage'));
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'student-my-hero-mobile.png'),fullPage:true});
  check('mobile dialog fits its viewport',await page.locator('#shDialog').evaluate(d=>d.getBoundingClientRect().width<=window.innerWidth&&d.scrollWidth<=d.clientWidth+2));
  await page.click('#shClose');await page.evaluate(()=>{__heroFixture.delay=true;StudentHeroes.open('student');});
  await page.waitForFunction(()=>!!__heroFixture.release);await page.evaluate(()=>{__account('student-b');__heroFixture.delay=false;__heroFixture.release();});
  await page.waitForSelector('#shSlot');
  check('late account responses cannot expose the previous student hero',await page.locator('#shTree').count()===0);
  await page.evaluate(()=>__account('teacher'));await page.click('#heroClaimsBtn');await page.waitForSelector('[data-sh-manage="unlink"]');await page.click('[data-sh-manage="unlink"]');await idle();
  check('correcting ownership preserves the character progress',await page.evaluate(()=>!__heroFixture.claim&&__heroFixture.hero.xp===450&&__heroFixture.hero.learnedSkills.includes('mage-ice-lance')));
  check('student flows have no unhandled browser errors',errors.length===0);
  console.log(`${checks} student hero browser checks passed.`);
}finally{await browser.close();}
