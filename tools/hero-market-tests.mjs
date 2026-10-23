import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),C=require('../battle-core.js'),A=require('../hero-avatar.js');
const fresh=()=>C.heroFromStudent({id:'shop-student',name:'Ari'});
const buy=(h,skuId,extra={})=>C.configureHero(h,{command:'purchase',skuId,...extra});
test('legacy heroes start with no currency and retain their original artwork',()=>{
 const h=fresh();delete h.questPoints;delete h.avatar;delete h.outfits;
 const clean=C.cleanHero(h,h);assert.equal(clean.questPoints,0);assert.equal(clean.avatar,null);assert.deepEqual(clean.outfits,['traveller']);
});
test('all illustrated items are purchasable at canonical prices across every rarity and gear slot',()=>{
 const h={...fresh(),questPoints:10000},items=C.MARKET.filter(row=>row.itemId);
 assert.equal(items.length,Object.keys(C.ITEMS).length);assert.ok(items.length>=270);
 assert.equal(new Set(C.MARKET.map(row=>row.id)).size,C.MARKET.length);
 assert.deepEqual(new Set(items.map(row=>C.itemById(row.itemId).rarity)),new Set(Object.keys(C.RARITIES)));
 for(const slot of Object.keys(C.EQUIPMENT_SLOTS))assert.ok(items.some(row=>C.equipmentSlot(C.itemById(row.itemId))===slot),slot);
 for(const row of C.MARKET){const result=buy(h,row.id,{price:0,questPoints:999999,itemId:'forged'});assert.equal(result.questPoints,10000-row.price);assert.equal(h.questPoints,10000);assert.ok(Number.isInteger(row.price)&&row.price>0);
 if(row.itemId){const item=C.itemById(row.itemId);assert.ok(item.art);const entry=result.inventory.find(e=>e.itemId===row.itemId);assert.ok(entry);assert.ok(!(entry.sockets||[]).length);assert.deepEqual(C.cleanHero(JSON.parse(JSON.stringify(result)),result),result);}
 else{assert.ok(result.outfits.includes(row.outfitId));assert.deepEqual(result.stats,h.stats);assert.throws(()=>buy(result,row.id),/already own/);}}
 assert.throws(()=>buy(fresh(),'item-red-potion'),/quest points/);assert.throws(()=>buy(h,'item-forged-unique'),/quest shop/);
});

test('rarity savings prices rise to twenty weekly five-victory chapters and preserve starter prices',()=>{
 const amounts=Object.keys(C.RARITIES).map(r=>C.MARKET_PRICES[r]);
 assert.ok(amounts.every((price,i)=>!i || price>amounts[i-1]));
 const ordinary=C.victoryPoints({adventure:{kind:'enemy'}}),guardian=C.victoryPoints({adventure:{chapterGuardian:true}}),model=C.MARKET_SAVINGS;
 assert.equal(model.victoriesPerWeek,5);assert.equal(model.weeks,20);
 assert.equal(model.weeklyPoints,(model.victoriesPerWeek-1)*ordinary+guardian);
 assert.equal(model.targetPoints,model.weeklyPoints*model.weeks);assert.equal(C.MARKET_PRICES.unique,model.targetPoints);
 for(const row of C.MARKET.filter(row=>row.itemId)){
  const item=C.itemById(row.itemId);assert.ok(row.price<=C.MARKET_PRICES[item.rarity]);
  if(['epic','legendary','mythical','unique'].includes(item.rarity))assert.equal(row.price,C.MARKET_PRICES[item.rarity]);
 }
 for(const [itemId,price]of [['red-potion',8],['crimson-edge',70],['silver-aegis',70]])assert.equal(C.MARKET.find(row=>row.itemId===itemId).price,price);
});

test('expensive purchases reject insufficient funds and bag overflow without changing the hero',()=>{
 for(const rarity of Object.keys(C.RARITIES)){
  const offer=C.MARKET.find(row=>row.itemId&&C.itemById(row.itemId).rarity===rarity),h={...fresh(),questPoints:offer.price-1},before=structuredClone(h);
  assert.throws(()=>buy(h,offer.id,{price:0}),/quest points/);assert.deepEqual(h,before);
  const rich={...h,questPoints:offer.price},result=buy(rich,offer.id);assert.equal(result.questPoints,0);
 }
 const full={...fresh(),questPoints:3000};C.addInventory(full,'unique-wyrmflame',999,[]);
 const before=structuredClone(full);assert.throws(()=>buy(full,'item-unique-wyrmflame'),/bag already/);assert.deepEqual(full,before);
});

test('shop relic powers require equipping and purchased runes work in existing sockets',()=>{
 let h={...fresh(),questPoints:10000};h=buy(h,'item-unique-wyrmflame');
 assert.ok(!C.availableSkills(h).some(s=>s.id==='relic-dragon-breath'));
 const weapon=h.inventory.find(e=>e.itemId==='unique-wyrmflame');assert.deepEqual(C.socketsFor(weapon),[]);
 h=C.configureHero(h,{command:'equip',itemId:weapon.id,slot:'mainHand'});assert.ok(C.availableSkills(h).some(s=>s.id==='relic-dragon-breath'));
 h=buy(h,'item-unique-dawnfox');const pet=h.inventory.find(e=>e.itemId==='unique-dawnfox');
 h=C.configureHero(h,{command:'equip',itemId:pet.id,slot:'pet'});assert.equal(C.loadoutFor(h).pet,pet.id);
 const found=C.addInventory(h,'bronze-blade',1,[null]);h=buy(h,'item-rune-worldspark');
 const rune=h.inventory.find(e=>e.itemId==='rune-worldspark');h=C.configureHero(h,{command:'socket',id:'shop-socket-0001',itemId:found.id,runeId:rune.id,socketIndex:0});
 const socketed=h.inventory.find(e=>C.socketsFor(e).includes('rune-worldspark'));assert.ok(socketed);assert.ok(!h.inventory.some(e=>e.itemId==='rune-worldspark'));
});

test('permanent gifts cannot consume savings twice for an owned or already learned skill',()=>{
 for(const item of Object.values(C.ITEMS).filter(item=>item.giftSkill)){
  let h={...fresh(),questPoints:6000};h=buy(h,'item-'+item.id);const before=structuredClone(h);
  assert.throws(()=>buy(h,'item-'+item.id),/already have/);assert.deepEqual(h,before);
  h.inventory=h.inventory.filter(entry=>entry.itemId!==item.id);h.giftSkills=[item.giftSkill];const learned=structuredClone(h);
  assert.throws(()=>buy(h,'item-'+item.id),/already knows/);assert.deepEqual(h,learned);
 }
});
test('owned avatar choices validate every palette, preserve stats, and render independent colours',()=>{
 const h=fresh(),a={...A.DEFAULT,skin:'deep',hair:'pink',eyes:'green',clothing:'gold',hairStyle:'braids'};
 const changed=C.configureHero(h,{command:'customise',avatar:a});assert.deepEqual(changed.stats,h.stats);assert.equal(changed.hp,h.hp);assert.deepEqual(changed.avatar,a);
 for(const key of ['skin','hair','eyes','clothing','hairStyle','outfit'])assert.throws(()=>C.configureHero(h,{command:'customise',avatar:{...a,[key]:'forged'}}));
 assert.throws(()=>C.configureHero(h,{command:'customise',avatar:{...a,outfit:'royal'}}),/Unlock/);
 const html=A.markup('mage',{avatar:a});for(const [key,value]of [['skin','deep'],['hair','pink'],['eyes','green'],['clothing','gold']])assert.ok(html.includes(C.AVATAR_PALETTES[key][value]));
 assert.equal(C.configureHero(changed,{command:'customise',avatar:null}).avatar,null);
});
test('victory points pay once per present hero, including chest bonuses and guardians',()=>{
 for(const [adventure,amount]of [[{kind:'enemy'},25],[{kind:'chest'},25],[{kind:'uber'},35],[{kind:'uber',chapterGuardian:true},50]]){
 let s=C.reduce(null,{type:'start',id:'market-start-'+amount,heroes:[fresh()],formation:'raid'});s.adventure=adventure;
 const action={type:'summon',source:'teacher',id:'market-win-'+amount,encounterId:s.encounterId,expectedRevision:s.revision};const won=C.reduce(s,action);
 assert.equal(won.heroes[0].questPoints,amount);assert.equal(won.rewards.filter(r=>r.questPoints).length,1);assert.equal(won.rewards[0].questPoints,amount);
 assert.throws(()=>C.reduce(won,action),/finished/);assert.equal(won.heroes[0].questPoints,amount);assert.equal(C.normalizeState(JSON.parse(JSON.stringify(won))).heroes[0].questPoints,amount);
 }
});
