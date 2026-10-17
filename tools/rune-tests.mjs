import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import crypto from 'node:crypto';
const C=createRequire(import.meta.url)('../battle-core.js');
let serial=0;const id=()=> 'rune-action-'+(++serial);
function hero(){return C.heroFromStudent({id:'runes',name:'Rune hero'},null,0);}
function own(h,itemId,sockets,quantity=1){return C.addInventory(h,itemId,quantity,sockets).id;}
function equip(h,itemId,slot){return C.configureHero(h,{command:'equip',itemId,slot});}
function insert(h,itemId,runeId,socketIndex=0,slot){return C.configureHero(h,{id:id(),command:'socket',itemId,runeId,socketIndex,...(slot?{slot}:{})});}
function encounter(h){let s=C.reduce(null,{type:'start',id:id(),bossId:'goblin',heroes:[h]});s.heroes=[C.cleanHero(h,h)];s.adventure={kind:'enemy',resolved:true};return s;}
function answer(s,extra={}){const turn=id();s=C.reduce(s,{type:'select',id:id(),encounterId:s.encounterId,expectedRevision:s.revision,heroId:s.heroes[0].id,turnId:turn});return C.reduce(s,{type:'answer',id:id(),encounterId:s.encounterId,turnId:turn,outcome:'correct',...extra});}
function boss(s){return C.reduce(s,{type:'boss',id:id(),encounterId:s.encounterId,expectedRevision:s.revision,timing:0});}

test('catalogue adds sixteen distinct runes and uniques for every item and gear type',()=>{
 const all=Object.values(C.ITEMS),runes=all.filter(i=>i.type==='rune'),unique=all.filter(i=>i.rarity==='unique');
 assert.equal(all.length,270);assert.equal(runes.length,16);assert.equal(unique.length,20);
 assert.equal(runes.filter(i=>i.rarity==='unique').length,4);
 for(const slot of Object.keys(C.EQUIPMENT_SLOTS))assert.ok(unique.some(i=>C.equipmentSlot(i)===slot),slot);
 for(const type of ['equipment','pet','consumable','rune'])assert.ok(unique.some(i=>i.type===type),type);
 for(const item of unique)assert.ok(item.grantSkill || item.giftSkill || item.passiveName,item.id);
 assert.equal(Object.values(C.RARITIES).reduce((n,r)=>n+r.weight,0),100);
 assert.ok(C.RARITIES.unique.weight<C.RARITIES.mythical.weight);
});
test('new socket counts are deterministic, include unsocketed drops and follow their saved roll',()=>{
 const item=C.ITEMS['unique-wyrmflame'],counts=[0,0,0,0];
 for(let i=0;i<16000;i++){const a=C.socketRoll('drop-'+i,item);counts[a.length]++;assert.deepEqual(a,C.socketRoll('drop-'+i,item));assert.ok(a.every(x=>x===null));}
 for(const [i,rate] of [0.5,.35,.12,.03].entries())assert.ok(Math.abs(counts[i]/16000-rate)<.015);
 assert.equal(C.socketRoll('x',C.ITEMS['rune-ember']),undefined);assert.equal(C.socketRoll('x',C.ITEMS['unique-dawnfox']),undefined);
 const gear=Array.from({length:100},(_,i)=>C.rollReward('saved-'+i,'hero',{rewardXp:40})).find(r=>C.socketable(C.itemById(r.itemId)));
 assert.ok(Array.isArray(gear.sockets));assert.deepEqual(gear,C.rollReward(gear.instanceId.split(':hero')[0],'hero',{rewardXp:40}));
});
test('legacy equipment never rerolls sockets and new empty variants survive canonicalisation',()=>{
 let h=hero();h.inventory.push({id:'old-sword',itemId:'bronze-blade',quantity:2});h.loadout.mainHand='old-sword';
 own(h,'bronze-blade',[null],2);own(h,'bronze-blade',[],1);
 h=C.cleanHero(h,h);assert.equal(h.loadout.mainHand,'bag:bronze-blade');assert.equal(h.inventory.find(i=>i.id==='bag:bronze-blade').socketVersion,undefined);
 assert.equal(h.inventory.filter(i=>i.itemId==='bronze-blade').length,3);assert.deepEqual(C.cleanHero(h,h),h);
});
test('socketing isolates one copy, including two worn rings, without losing other equipment',()=>{
 let h=hero();const gear=own(h,'unique-nightfall-band',[null],2),rune=own(h,'rune-ember');
 h=equip(equip(h,gear,'ring1'),gear,'ring2');h=insert(h,gear,rune,0,'ring2');
 assert.equal(h.loadout.ring1,gear);assert.notEqual(h.loadout.ring2,gear);assert.equal(h.inventory.find(i=>i.id===gear).quantity,1);
 assert.equal(C.equipmentEffect(h).burn,.18);assert.equal(h.inventory.filter(i=>i.itemId==='rune-ember').length,0);
 assert.equal(C.socketsFor(h.inventory.find(i=>i.id===h.loadout.ring1))[0],null);
 assert.equal(C.socketsFor(h.inventory.find(i=>i.id===h.loadout.ring2))[0],'rune-ember');assert.deepEqual(C.cleanHero(h,h),h);
});
test('a newly dropped copy cannot merge into a socketed copy or duplicate its rune',()=>{
 let h=hero();const gear=own(h,'unique-wyrmflame',[null]),rune=own(h,'rune-frost');h=equip(h,gear,'mainHand');h=insert(h,gear,rune,0,'mainHand');
 const runed=h.loadout.mainHand;assert.match(runed,/^runed:/);own(h,'unique-wyrmflame',[null],3);
 assert.equal(h.inventory.find(i=>i.id===runed).quantity,1);assert.equal(h.inventory.find(i=>i.id===gear).quantity,3);
 assert.deepEqual(C.socketsFor(h.inventory.find(i=>i.id===gear)),[null]);
});
test('removal returns exactly one owned rune and preserves empty runed instance identity',()=>{
 let h=hero();const gear=own(h,'unique-wyrmflame',[null]),rune=own(h,'rune-worldspark');h=equip(h,gear,'mainHand');h=insert(h,gear,rune,0,'mainHand');const runed=h.loadout.mainHand;
 h=C.configureHero(h,{id:id(),command:'unsocket',itemId:runed,socketIndex:0});
 assert.equal(h.inventory.find(i=>i.itemId==='rune-worldspark').quantity,1);assert.equal(h.loadout.mainHand,runed);assert.deepEqual(C.socketsFor(h.inventory.find(i=>i.id===runed)),[null]);
 assert.throws(()=>C.configureHero(h,{id:id(),command:'unsocket',itemId:runed,socketIndex:0}),/empty/);assert.deepEqual(C.cleanHero(h,h),h);
});
test('socket validation rejects unowned runes, bad sockets, pets and stale equipment slots',()=>{
 let h=hero();const gear=own(h,'unique-wyrmflame',[null]),rune=own(h,'rune-ember');
 for(const patch of [{runeId:'not-owned'},{socketIndex:-1},{socketIndex:1},{socketIndex:'0'},{slot:'helm'},{id:'bad'},{itemId:'bag:red-potion'}])assert.throws(()=>C.configureHero(h,{id:id(),command:'socket',itemId:gear,runeId:rune,socketIndex:0,...patch}));
 h=insert(h,gear,rune);const filled=h.inventory.find(i=>C.socketsFor(i).some(Boolean));own(h,'rune-frost');assert.throws(()=>insert(h,filled.id,'bag:rune-frost'),/Remove/);
});
test('socket changes do not heal HP, refill MP or move saved class progression',()=>{
 let h=hero();const gear=own(h,'unique-wyrmflame',[null]),rune=own(h,'rune-arcane');h=equip(h,gear,'mainHand');h.hp=31;h.mp=3;
 const before={xp:h.xp,role:h.role,skills:h.learnedSkills};h=insert(h,gear,rune,0,'mainHand');assert.equal(h.hp,31);assert.equal(h.mp,3);assert.equal(h.stats.maxMp,78);
 h=C.configureHero(h,{id:id(),command:'unsocket',itemId:h.loadout.mainHand,socketIndex:0});assert.equal(h.hp,31);assert.equal(h.mp,3);assert.deepEqual({xp:h.xp,role:h.role,skills:h.learnedSkills},before);
});
test('only worn runes contribute and main-hand first socket takes elemental priority',()=>{
 let h=hero();const weapon=own(h,'bronze-blade',[null,null]),off=own(h,'unique-winter-aegis',[null]),armour=own(h,'unique-phoenix-heart',[null]);
 h=insert(h,weapon,own(h,'rune-ember'));h=insert(h,off,own(h,'rune-frost'));h=insert(h,armour,own(h,'rune-storm'));
 assert.equal(C.equipmentEffect(h).burn,undefined);assert.equal(C.weaponElement(h),null);
 const find=x=>h.inventory.find(i=>i.itemId===x && C.socketsFor(i).some(Boolean)).id;
 h=equip(h,find('unique-phoenix-heart'),'torso');assert.equal(C.weaponElement(h),null);
 h=equip(h,find('unique-winter-aegis'),'offHand');assert.equal(C.buildFor(h).basicType,'ice');
 h=equip(h,find('bronze-blade'),'mainHand');assert.equal(C.buildFor(h).basicType,'fire');assert.equal(C.damageTypeFor(h,C.skillById('warrior-power-strike')),'physical');
});
test('unique skills require their actual equipped or socketed source and cannot be learned with SP',()=>{
 let h=hero();const weapon=own(h,'unique-wyrmflame',[null]),rune=own(h,'rune-worldspark');
 assert.ok(!C.availableSkills(h).some(s=>s.itemSkill));h=equip(h,weapon,'mainHand');assert.ok(C.availableSkills(h).some(s=>s.id==='relic-dragon-breath'));
 h=insert(h,weapon,rune,0,'mainHand');assert.ok(C.availableSkills(h).some(s=>s.id==='relic-worldspark'));assert.equal(C.canLearn(h,'relic-worldspark').ok,false);
 h=equip(h,null,'mainHand');h.learnedSkills.push('relic-worldspark');assert.ok(!C.availableSkills(h).some(s=>s.itemSkill));
 const state=encounter(h);assert.throws(()=>answer(state,{command:'skill',skillId:'relic-worldspark'}),/Learn/);
});
test('rune-infused attacks record the real element, burn and venom tick within one combined DOT cap',()=>{
 let h=hero();const gear=own(h,'bronze-blade',[null,null]);h=equip(h,gear,'mainHand');h=insert(h,gear,own(h,'rune-ember'),0,'mainHand');h=insert(h,h.loadout.mainHand,own(h,'rune-venom'),1,'mainHand');
 let state=answer(encounter(h),{command:'attack'});assert.equal(state.lastEvent.damageType,'fire');assert.equal(state.lastEvent.infused,true);assert.ok(state.ailments.burn && state.ailments.venom);
 state.poison={damage:C.enemyScale(state).poisonCap,turns:3,heroId:h.id};state=boss(state);
 assert.ok((state.lastEvent.poisonDamage||0)+(state.lastEvent.ailmentTicks||[]).reduce((n,t)=>n+t.amount,0)<=C.enemyScale(state).poisonCap);
 assert.equal(state.ailments.burn.turns,2);state.poison=null;state=boss(state);assert.ok(state.lastEvent.ailmentTicks.some(t=>t.effect==='burn' && t.amount>0));
 assert.deepEqual(C.normalizeState(JSON.parse(JSON.stringify(state))).ailments,state.ailments);
});
test('rune support applies saved wards, weakness and defence breaks without point scaling',()=>{
 let h=hero();const gear=own(h,'unique-worldroot-greaves',[null,null]);h=equip(h,gear,'legs');h=insert(h,gear,own(h,'rune-frost'),0,'legs');h=insert(h,h.loadout.legs,own(h,'rune-storm'),1,'legs');
 let state=answer(encounter(h),{command:'attack'});assert.ok(state.heroes[0].shield>0);assert.equal(state.bossWeakness,.12);assert.equal(state.exposures.elemental.amount,.08);
 assert.ok(state.lastEvent.supported.some(e=>e.effect==='shield'));assert.ok(state.lastEvent.afflicted.some(e=>e.effect==='elemental defence break'));
 state=boss(state);assert.equal(state.bossWeakness,0);
});
test('unique consumables permanently grant one gift to the drinker and reject duplicate consumption',()=>{
 let h=hero();const potion=own(h,'unique-elixir-of-dawn',undefined,2);let state=answer(encounter(h),{command:'item',itemId:potion});
 h=state.heroes[0];assert.ok(h.giftSkills.includes('relic-dawn-aura'));assert.equal(C.equipmentEffect(h).teamMana,2);assert.equal(h.stats.maxHp,180);
 assert.equal(h.inventory.find(i=>i.itemId==='unique-elixir-of-dawn').quantity,1);assert.equal(state.combatLog.at(-1).giftSkill,'relic-dawn-aura');
 assert.throws(()=>answer(state,{command:'item',itemId:potion}),/already knows/);assert.ok(C.cleanHero(h,h).giftSkills.includes('relic-dawn-aura'));
 let other=hero();const bottle=own(other,'unique-bottled-star');other=answer(encounter(other),{command:'item',itemId:bottle}).heroes[0];assert.ok(C.availableSkills(other).some(s=>s.id==='relic-starfall'));
});
test('unique skills respect MP and cooldowns; removing their source blocks a queued cast',()=>{
 let h=hero();const gear=own(h,'unique-wyrmflame',[]);h=equip(h,gear,'mainHand');let state=answer(encounter(h),{command:'skill',skillId:'relic-dragon-breath'});
 assert.equal(state.lastEvent.skillId,'relic-dragon-breath');assert.equal(state.heroes[0].cooldowns['relic-dragon-breath'],4);
 assert.throws(()=>answer(state,{command:'skill',skillId:'relic-dragon-breath'}),/cooling/);h=state.heroes[0];h.mp=0;h.cooldowns={};state.heroes=[h];assert.throws(()=>answer(state,{command:'skill',skillId:'relic-dragon-breath'}),/MP/);
});
test('new sprite sheets preserve their generated PNG hashes and have all sixteen catalogue tiles',()=>{
 const expected={'runes-1':'cef9e8fd77db195037131435c76233c58d52a3d51a7c55a859b962e5b353a574','uniques-1':'78a4bbe94de4169e162e9b12e9c1cc082b6215798fd3df31f6df46788cf30518'};
 for(const [sheet,hash] of Object.entries(expected)){
  const bytes=fs.readFileSync(new URL('../assets/battle-pixel/items/'+sheet+'.png',import.meta.url));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),hash);assert.equal(bytes.readUInt32BE(16),1254);assert.equal(bytes.readUInt32BE(20),1254);
  const entries=Object.values(C.ITEMS).filter(i=>i.art.sheet===sheet);assert.equal(entries.length,16);assert.equal(new Set(entries.map(i=>i.art.col+','+i.art.row)).size,16);
 }
});

test('Quick fight selects an owned unique move and keeps points-scaled hits and rune DOT within caps',()=>{
 let h=hero();const gear=own(h,'unique-wyrmflame',[null]);h=equip(h,gear,'mainHand');h=insert(h,gear,own(h,'rune-worldspark'),0,'mainHand');
 const s=encounter(h),chosen=C.chooseAutoCommand(s,s.heroes[0]);assert.ok(C.availableSkills(h).some(skill=>skill.id===chosen.skillId && skill.itemSkill));
 const next=C.reduce(s,{type:'auto',id:id(),spinId:'quick-rune-spin',heroId:h.id,encounterId:s.encounterId,expectedRevision:s.revision,points:10000});
 assert.equal(next.lastEvent.skillId,chosen.skillId);assert.ok(next.lastEvent.damage<=C.enemyScale(next).hitCap);assert.ok(next.lastEvent.enemy);assert.ok(next.heroes[0].mp<h.mp);
 assert.ok((next.lastEvent.enemy.poisonDamage || 0)+(next.lastEvent.enemy.ailmentTicks || []).reduce((n,t)=>n+t.amount,0)<=C.enemyScale(next).poisonCap);
});
