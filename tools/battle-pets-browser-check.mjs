import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const runtime=process.env.PW||'/opt/node22/lib/node_modules/playwright/index.mjs';
const {chromium}=await import(runtime.startsWith('file:')?runtime:pathToFileURL(runtime).href);
const browser=await chromium.launch(process.env.PLAYWRIGHT_BROWSER_CHANNEL?{channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL}:{});
const page=await browser.newPage({viewport:{width:1000,height:750}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const output=path.resolve(process.env.BATTLE_SCREENSHOTS||'../battle-validation');fs.mkdirSync(output,{recursive:true});
const fixture=path.join(output,'pets-fixture.html');
fs.writeFileSync(fixture,'<!doctype html><html><head><meta charset="utf-8"><base href="'+pathToFileURL(path.resolve('.')+path.sep).href+'"><link rel="stylesheet" href="classroom-battle.css"><link rel="stylesheet" href="battle-animation.css"><link rel="stylesheet" href="hero-studio.css"><link rel="stylesheet" href="battle-pets.css"><style>body{background:#142138;color:#f5e6bd;font:16px system-ui;margin:35px}#portraits{display:flex;gap:80px;align-items:center;padding:60px}.cbaHero{width:180px;height:180px}.sample{display:grid;justify-items:center;gap:25px}</style></head><body><h1>Equipped companions</h1><div id="portraits"></div><script src="battle-bosses.js"></script><script src="battle-content.js"></script><script src="battle-core.js"></script><script src="hero-avatar.js"></script><script src="battle-display.js"></script><script src="battle-pets.js"></script><script src="battle-animation.js"></script></body></html>');
let checks=0;function check(name,result){assert.ok(result,name);checks++;console.log('✓ '+name);}
try{
 await page.goto(pathToFileURL(fixture).href);
 await page.evaluate(()=>{
  window.__petHeroes=['pet-cloud-sparrow','pet-frost-kitten','pet-moss-bunny'].map((itemId,i)=>({id:'hero-'+i,name:'Hero '+i,hp:50,role:'mage',inventory:[{id:'pet',itemId,quantity:1}],loadout:{pet:'pet'}}));
  window.__renderPets=()=>{document.getElementById('portraits').innerHTML=__petHeroes.map((hero,i)=>'<div class="sample">'+ClassroomBattleAnimation.heroMarkup(hero.role,{hero,gender:'female',avatar:i===1?HeroAvatar.DEFAULT:null})+'<strong>'+(ClassroomBattlePets.equipped(hero)||{name:'No pet equipped'}).name+'</strong>'+ClassroomBattlePets.control(hero)+'</div>').join('');ClassroomBattleAnimation.mount(document.getElementById('portraits'));};__renderPets();
 });
 await page.waitForFunction(()=>document.querySelectorAll('.cbaReady').length===3);
 check('bird, custom-avatar cat and rabbit have equipped art',await page.locator('.cbPet').count()===3&&await page.locator('.cbaCustom .cbPet-walk').count()===1);
 check('pet icon has visible dimensions',await page.locator('.cbPetBody .cbItemIcon').evaluateAll(nodes=>nodes.every(n=>{const r=n.getBoundingClientRect();return r.width>15&&r.height>15;})));
 check('bird follows flight path with wing motion',await page.locator('.cbPet-bird').evaluate(n=>getComputedStyle(n.querySelector('.cbPetMover')).animationName==='cbPetFly'&&getComputedStyle(n.querySelector('.cbPetBody')).animationName==='cbPetWings'));
 await page.locator('[data-pet-rest-key="hero-0:pet-cloud-sparrow"]').click();
 check('rest perches bird and stops flight',await page.locator('.cbPet-bird').evaluate(n=>n.classList.contains('cbPetResting')&&getComputedStyle(n.querySelector('.cbPetMover')).animationName==='none'));
 check('rest exposes accessible pressed state',await page.locator('[data-pet-rest-key="hero-0:pet-cloud-sparrow"]').getAttribute('aria-pressed')==='true');
 await page.evaluate(()=>__renderPets());check('redraw preserves rest',await page.locator('.cbPet-bird.cbPetResting').count()===1);
 await page.locator('[data-pet-rest-key="hero-0:pet-cloud-sparrow"]').click();
 check('roam resumes flight',await page.locator('.cbPet-bird').evaluate(n=>!n.classList.contains('cbPetResting')&&getComputedStyle(n.querySelector('.cbPetMover')).animationName==='cbPetFly'));
 await page.locator('[data-pet-rest-key="hero-1:pet-frost-kitten"]').click();
 check('cat rests beside hero and breathes',await page.locator('.cbPet-walk').evaluate(n=>n.classList.contains('cbPetResting')&&getComputedStyle(n.querySelector('.cbPetBody')).animationName==='cbPetBreathe'));
 await page.screenshot({path:path.join(output,'equipped-companions.png')});
 await page.emulateMedia({reducedMotion:'reduce'});
 check('reduced motion stops all pet movement',await page.locator('.cbPetMover,.cbPetBody').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).animationName==='none')));
 await page.evaluate(()=>{__petHeroes[0].loadout={};__renderPets();});
 check('unequip removes pet and control',await page.locator('.cbPet-bird').count()===0&&await page.locator('[data-pet-rest-key="hero-0:pet-cloud-sparrow"]').count()===0);
 assert.deepEqual(errors,[]);console.log(checks+' pet browser checks passed');
}finally{await browser.close();}
