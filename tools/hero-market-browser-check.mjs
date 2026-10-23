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
 check('all avatar controls and the expanded illustrated catalogue are present',await page.locator('[data-avatar-field]').count()===6&&await page.locator('.hsSupplies article').count()===24&&await page.evaluate(()=>ClassroomBattleCore.MARKET.filter(row=>row.itemId).length===Object.keys(ClassroomBattleCore.ITEMS).length));
 check('all seven rarities and four item types are available to browse',await page.locator('[data-shop-filter="rarity"] option').count()===8&&await page.locator('[data-shop-filter="type"] option').count()===5);
 check('highest-tier savings goal explains its five-month earning assumption',await page.locator('.hsSavings').innerText().then(text=>text.includes('3,000')&&text.includes('5 months')&&text.includes('5 victories')));
 await page.click('[data-shop-page="2"]');
 check('catalogue pagination exposes the next 24 items without rendering the whole shop',await page.locator('.hsSupplies article').count()===24&&await page.locator('.hsResults').innerText().then(text=>text.includes('25–48')));
 await page.click('[data-shop-page="1"]');
 for(const rarity of ['common','uncommon','rare','epic','legendary','mythical','unique']){
  await page.selectOption('[data-shop-filter="rarity"]',rarity);
  check(rarity+' filter shows only matching items',await page.locator('.hsSupplies article').count()>0&&await page.locator('.hsSupplies article').evaluateAll((cards,rarity)=>cards.every(card=>card.dataset.shopRarity===rarity),rarity));
 }
 check('unique treasures show formatted prices, saving shortfalls and blocked purchases',await page.locator('.hsSupplies [data-shop-sku]:enabled').count()===0&&await page.locator('.hsPrice').first().innerText().then(text=>text.includes('3,000'))&&await page.locator('.hsShortfall').first().innerText().then(text=>text.includes('2,800')));
 await page.check('[data-shop-filter="affordable"]');
 check('balance filter has a clear empty state when no unique item is affordable',await page.locator('.hsSupplies article').count()===0&&await page.locator('[data-shop-clear]').count()===1);
 await page.click('[data-shop-clear]');await page.selectOption('[data-shop-filter="type"]','pet');
 check('pet filter exposes purchasable companions',await page.locator('.hsSupplies article').count()>0&&await page.locator('.hsSupplies article').evaluateAll(cards=>cards.every(card=>card.dataset.shopType==='pet')));
 await page.selectOption('[data-shop-filter="type"]','all');await page.locator('[data-shop-search]').pressSequentially('Crimson Edge');
 check('live search keeps focus while narrowing the catalogue',await page.locator('.hsSupplies article').count()===1&&await page.locator('[data-shop-search]').evaluate(n=>document.activeElement===n&&n.value==='Crimson Edge'&&n.selectionStart===12));
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
 await page.evaluate(()=>{locked=false;h.questPoints=3000;show();});await page.locator('[data-shop-search]').fill('');await page.selectOption('[data-shop-filter="rarity"]','unique');await page.selectOption('[data-shop-filter="type"]','equipment');
 const uniqueSku=await page.locator('.hsSupplies [data-shop-sku]').first().getAttribute('data-shop-sku');
 await page.locator('.hsSupplies [data-shop-sku]').first().click();await page.waitForFunction(()=>!studio.blocked());
 check('a saved 3,000-point balance buys unique equipment and deducts the full price once',await page.evaluate(sku=>h.questPoints===0&&h.inventory.some(entry=>entry.itemId===sku.slice(5)&&entry.quantity>0&&Array.isArray(entry.sockets)&&entry.sockets.length===0),uniqueSku));
 check('purchase keeps the chosen rarity and type filters and shows the owned copy',await page.locator('[data-shop-filter="rarity"]').inputValue()==='unique'&&await page.locator('[data-shop-filter="type"]').inputValue()==='equipment'&&await page.locator('.hsOwned').allTextContents().then(texts=>texts.some(text=>text==='In your bag: 1'))&&await page.locator('.hsSupplies [data-shop-sku]:enabled').count()===0);
 await page.evaluate(()=>{h.questPoints=3000;h.giftSkills=[ClassroomBattleCore.itemById('unique-elixir-of-dawn').giftSkill];show();});await page.selectOption('[data-shop-filter="type"]','consumable');
 check('a learned permanent gift cannot be bought again despite a sufficient balance',await page.locator('[data-shop-sku="item-unique-elixir-of-dawn"]').isDisabled()&&await page.locator('[data-shop-sku="item-unique-elixir-of-dawn"]').innerText()==='Skill learned'&&await page.locator('[data-shop-sku="item-unique-bottled-star"]').isEnabled());
 await page.evaluate(()=>{delete h.giftSkills;ClassroomBattleCore.addInventory(h,'unique-elixir-of-dawn',1);show();});
 check('an unused permanent gift already in the bag cannot be bought again',await page.locator('[data-shop-sku="item-unique-elixir-of-dawn"]').isDisabled()&&await page.locator('[data-shop-sku="item-unique-elixir-of-dawn"]').innerText()==='Already in bag'&&await page.locator('[data-shop-sku="item-unique-bottled-star"]').isEnabled());
 await page.locator('[data-shop-search]').fill('a treasure that does not exist');
 check('search with no matches offers a working clear action',await page.locator('.hsSupplies article').count()===0&&await page.locator('[data-shop-clear]').count()===1);
 await page.click('[data-shop-clear]');await page.selectOption('[data-shop-filter="rarity"]','unique');
 await page.evaluate(()=>{const C=ClassroomBattleCore;window.s=C.reduce(null,{type:'start',id:'studio-scenery-start',heroes:[h],formation:'raid'});s.heroes=[h];s.adventure={version:1,step:1,biome:'forest',kind:'enemy'};ClassroomAdventure.render(document.getElementById('scene'),s,s.heroes);ClassroomBattleAnimation.mount(document.body);});
 check('customised hero walks in the saved Emerald Trail scene and background is dimmed',await page.locator('.advWalk.cbaCustom').count()===1&&await page.locator('.advBackdrop').evaluate(n=>getComputedStyle(n).filter.includes('brightness(0.48)')));
 check('trail boss is substantially larger than the walking hero',await page.evaluate(()=>{const boss=document.querySelector('.advRoadObject').getBoundingClientRect(),hero=document.querySelector('.advWalk').getBoundingClientRect();return boss.height>hero.height*1.5&&boss.width>140;}));
 await page.locator('#scene').screenshot({path:path.join(out,'market-emerald-trail-desktop.png')});await page.locator('#studioHost').screenshot({path:path.join(out,'market-avatar-shop-desktop.png')});
 for(const width of [820,390]){await page.setViewportSize({width,height:1000});check(width+'px studio keeps filters, item cards and controls within the viewport',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('[data-studio-save]').getBoundingClientRect().width>80&&Array.from(document.querySelectorAll('.hsFilters select,.hsSupplies article')).every(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})));}
 await page.screenshot({path:path.join(out,'market-avatar-shop-phone.png'),fullPage:true});
 check('reduced motion stops custom avatar animation',await page.locator('.haFigure').first().evaluate(n=>getComputedStyle(n).animationName==='none'));
 assert.deepEqual(errors,[]);console.log(checks+' market browser checks passed.');
}finally{await browser.close();}
