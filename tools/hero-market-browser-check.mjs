// Real studio, saved retry outbox, avatar rendering and responsive scenery.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PW||'/opt/node22/lib/node_modules/playwright/index.mjs').href);
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1100,height:1000},reducedMotion:'reduce'}),errors=[];
page.on('pageerror',e=>errors.push(e.message));const out=path.resolve(process.env.BATTLE_SCREENSHOTS||'../battle-validation');fs.mkdirSync(out,{recursive:true});
let checks=0;const check=(s,v)=>{assert.ok(v,s);checks++;console.log('✓ '+s);};
const scripts=['battle-bosses','battle-content','battle-core','hero-avatar','hero-studio','battle-animation','battle-display','battle-adventure'];
await page.route('https://market.test/**',route=>{const name=new URL(route.request().url()).pathname.slice(1);return name?route.fulfill({path:path.resolve(name)}):route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+['classroom-battle','battle-animation','battle-adventure','hero-studio'].map(n=>'<link rel="stylesheet" href="/'+n+'.css">').join('')+'<style>body{margin:16px;background:#111c2b}main{max-width:950px;margin:auto}</style></head><body><main><div id="scene"></div><div id="studioHost"></div></main>'+scripts.map(n=>'<script src="/'+n+'.js"></script>').join('')+'</body></html>'});});
async function mount(){await page.evaluate(()=>{
 const C=ClassroomBattleCore;window.h=JSON.parse(localStorage.getItem('hero')||'null')||{...C.heroFromStudent({id:'ari',name:'Ari'}),questPoints:200};window.revision=0;window.locked=false;window.calls=[];
 window.show=()=>{if(window.studio)studio.destroy();window.studio=HeroStudio.mount(document.getElementById('studioHost'),{getHero:()=>h,getRevision:()=>revision,key:'student:ari',locked:()=>locked,canAct:()=>true,dispatch:async a=>{
 calls.push(a);const receipts=JSON.parse(localStorage.getItem('receipts')||'{}');if(!receipts[a.id]){h=C.configureHero(h,a);revision++;localStorage.setItem('hero',JSON.stringify(h));receipts[a.id]=true;localStorage.setItem('receipts',JSON.stringify(receipts));}
 if(window.loseReply){loseReply=false;throw Error('Connection lost after saving');}return {hero:h};},onChange:r=>{h=r.hero;show();}});};show();
 });}
try{
 await page.goto('https://market.test/');await mount();
 check('all requested avatar controls and affordable shop choices are present',await page.locator('[data-avatar-field]').count()===6&&await page.locator('[data-shop-sku]:enabled').count()===13);
 await page.selectOption('[data-avatar-field="skin"]','deep');await page.selectOption('[data-avatar-field="hair"]','pink');await page.selectOption('[data-avatar-field="eyes"]','green');await page.selectOption('[data-avatar-field="clothing"]','gold');await page.selectOption('[data-avatar-field="hairStyle"]','braids');
 check('live preview changes independent skin, hair, eye and clothing colours',await page.locator('.hsPreview svg').evaluate(n=>['#56372c','#d476a0','#4d9869','#c29b42'].every(c=>n.innerHTML.includes(c))));
 await page.click('[data-studio-save]');await page.waitForFunction(()=>h.avatar?.skin==='deep'&&!studio.blocked());
 check('saved avatar is used by the battle animation renderer',await page.evaluate(()=>ClassroomBattleAnimation.heroMarkup(h.role,{avatar:h.avatar}).includes('cbaCustom')));
 await page.click('[data-shop-sku="outfit-ranger"]');await page.waitForFunction(()=>h.outfits.includes('ranger')&&!studio.blocked());
 check('outfit purchase deducts its price once and unlocks clothing selection',await page.evaluate(()=>h.questPoints===170)&&await page.locator('[data-avatar-field="outfit"] option[value="ranger"]').count()===1&&await page.locator('[data-shop-sku="outfit-ranger"]').isDisabled());
 await page.evaluate(()=>window.loseReply=true);await page.click('[data-shop-sku="item-crimson-edge"]');await page.waitForSelector('[data-studio-retry]');
 check('lost replies keep the original request and prevent another purchase',await page.evaluate(()=>studio.blocked()&&h.questPoints===100)&&await page.locator('[data-shop-sku]:enabled').count()===0);
 const saved=await page.evaluate(()=>calls.at(-1).id);await page.reload();await mount();await page.click('[data-studio-retry]');await page.waitForFunction(()=>!studio.blocked());
 check('reload retries the saved action ID without charging again',await page.evaluate(id=>calls.at(-1).id===id&&h.questPoints===100,saved));
 await page.evaluate(()=>{locked=true;show();});
 check('active encounter blocks shopping while allowing cosmetic saves',await page.locator('[data-shop-sku]:enabled').count()===0&&await page.locator('[data-studio-save]').isEnabled());
 await page.selectOption('[data-avatar-field="outfit"]','ranger');await page.click('[data-studio-save]');await page.waitForFunction(()=>h.avatar.outfit==='ranger'&&!studio.blocked());
 await page.evaluate(()=>{const C=ClassroomBattleCore;window.s=C.reduce(null,{type:'start',id:'studio-scenery-start',heroes:[h],formation:'raid'});s.heroes=[h];s.adventure={version:1,step:1,biome:'forest',kind:'enemy'};ClassroomAdventure.render(document.getElementById('scene'),s,s.heroes);ClassroomBattleAnimation.mount(document.body);});
 check('customised hero walks in the saved Emerald Trail scene and background is dimmed',await page.locator('.advWalk.cbaCustom').count()===1&&await page.locator('.advBackdrop').evaluate(n=>getComputedStyle(n).filter.includes('brightness(0.48)')));
 check('trail boss is substantially larger than the walking hero',await page.evaluate(()=>{const boss=document.querySelector('.advRoadObject').getBoundingClientRect(),hero=document.querySelector('.advWalk').getBoundingClientRect();return boss.height>hero.height*1.5&&boss.width>140;}));
 await page.locator('#scene').screenshot({path:path.join(out,'market-emerald-trail-desktop.png')});await page.locator('#studioHost').screenshot({path:path.join(out,'market-avatar-shop-desktop.png')});
 for(const width of [820,390]){await page.setViewportSize({width,height:1000});check(width+'px studio fits the viewport and keeps controls visible',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('[data-studio-save]').getBoundingClientRect().width>80));}
 await page.screenshot({path:path.join(out,'market-avatar-shop-phone.png'),fullPage:true});
 check('reduced motion stops custom avatar animation',await page.locator('.haFigure').first().evaluate(n=>getComputedStyle(n).animationName==='none'));
 assert.deepEqual(errors,[]);console.log(checks+' market browser checks passed.');
}finally{await browser.close();}
