import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const C=createRequire(import.meta.url)('../battle-core.js');
let n=0;const id=()=>`quest-action-${++n}`;
const heroes=()=>['Anika','Kai','Ravi','Mei'].map((name,i)=>C.heroFromStudent({id:'quest-'+i,name},null,i));
function act(s,type,extra={}){return C.reduce(s,{id:id(),type,encounterId:s?.encounterId,expectedRevision:s?.revision,...extra});}
function start(s=null){return act(s,'start',{heroes:s?.heroes || heroes(),formation:'raid'});}
function win(s){return act(s,'summon',{source:'teacher'});}
function quest(s,command,extra={}){return act(s,'quest',{command,...extra});}
function answer(s,index,outcome='correct',turnId){s=act(s,'select',{heroId:s.heroes[index].id,turnId});return act(s,'answer',{turnId:s.pending.id,outcome});}
function sturdy(){const s=start();s.adventure={kind:'enemy',resolved:true};s.bossMaxHp=s.bossHp=100000;return s;}

test('chapter checkpoints require victory, persist across encounters and culminate in an empowered guardian',()=>{
 let s=start();assert.equal(s.journey.node,0);s=start(s);assert.equal(s.journey.node,0);
 for(let i=0;i<5;i++){if(i===4){assert.equal(s.adventure.chapterGuardian,true);assert.equal(s.adventure.kind,'uber');}s=win(s);assert.equal(s.journey.totalWins,i+1);if(i<4)s=start(s);}
 assert.equal(s.journey.chapter,2);assert.equal(s.journey.node,0);assert.equal(s.journey.history.length,5);
 assert.deepEqual(C.normalizeState(JSON.parse(JSON.stringify(s))).journey,s.journey);
 const before=structuredClone(s);assert.throws(()=>quest(s,'route',{routeId:'forged'}),/available routes/);assert.deepEqual(s,before);
});
test('each student has one changeable route vote; majority and eligible voters decide the saved next biome and benefit',()=>{
 let s=win(start()),options=C.routeOptions(s),a=s.heroes[0].id,b=s.heroes[1].id;
 s=quest(s,'vote',{heroId:a,routeId:options[0]});s=quest(s,'vote',{heroId:a,routeId:options[1]});assert.equal(Object.keys(s.journey.votes).length,1);
 s=quest(s,'vote',{heroId:b,routeId:options[1]});assert.throws(()=>quest(s,'route',{routeId:options[0]}),/most student votes/);
 // Attendance can remove a vote before the teacher confirms the route.
 s=quest(s,'route',{routeId:options[0],eligibleHeroIds:[]});const route=C.QUEST_ROUTES[options[0]],next=start(s);
 assert.equal(next.adventure.biome,route.biome);assert.equal(next.adventure.kind,route.kind);assert.throws(()=>quest(next,'vote',{heroId:a,routeId:options[1]}),/Finish this encounter/);
});
test('all three surprise events have meaningful saved choices that apply exactly once next encounter',()=>{
 for(const [kind,definition] of Object.entries(C.QUEST_EVENTS))for(const choice of definition.choices){
  let s=win(start());s.journey.event={id:s.encounterId,kind,choice:null};s=quest(s,'event',{choiceId:choice.id});assert.throws(()=>quest(s,'event',{choiceId:choice.id}),/available surprise/);
  s=start(s);assert.equal(s.journey.blessing,choice.id);s.heroes.forEach(h=>{h.mp=0;h.hp=20;});const before=s.bossHp;
  s=answer(s,0);assert.equal(s.journey.blessingUsed,true);
  if(choice.id==='shield')assert.ok(s.heroes.every(h=>h.shield>0));if(choice.id==='mana')assert.ok(s.heroes.every(h=>h.mp>=18));if(choice.id==='expose')assert.ok(s.exposures.physical.turns>0);if(choice.id==='companion'){assert.equal(s.lastEvent.companion,true);assert.ok(s.bossHp<before);}
  if(choice.id==='treasure'){s=win(s);assert.equal(s.rewards.filter(r=>r.source==='road-chest').length,s.heroes.length);}
 }
});
test('alternating answers build 3/5 combos, repeat awards on a question cannot charge it, wrong answers pause without losing progress',()=>{
 let s=sturdy();s=answer(s,0);s=answer(s,0);assert.equal(s.combo.count,1);s=answer(s,1);assert.equal(s.combo.count,2);
 s=answer(s,2,'incorrect');assert.equal(s.combo.count,2);assert.equal(s.combo.paused,true);s=answer(s,3);assert.equal(s.combo.count,2);
 s=quest(s,'recover',{heroId:s.heroes[2].id});s=answer(s,2);assert.equal(s.combo.count,3);assert.equal(s.lastEvent.comboBurst.level,3);assert.ok(s.lastEvent.comboBurst.enemyTargets[0].damage>0);
 s=answer(s,3);s.heroes.forEach(h=>{h.hp=10;});s=answer(s,0);assert.equal(s.lastEvent.comboBurst.level,5);assert.equal(s.combo.count,0);assert.equal(s.combo.cycles,1);assert.ok(s.heroes.every(h=>h.hp>10));
 let auto=sturdy();const spin=id();auto=act(auto,'auto',{heroId:auto.heroes[0].id,heroes:auto.heroes,spinId:spin,points:1});auto=act(auto,'auto',{heroId:auto.heroes[1].id,heroes:auto.heroes,spinId:spin,points:1});assert.equal(auto.combo.count,1);
});
test('boss warnings predict saved single/AoE targets, preparations cannot be farmed and apply once',()=>{
 for(const choiceId of ['heal','shield','attack']){
  let s=sturdy();s.heroes.forEach(h=>{h.hp=10;});const hp=s.bossHp;s=quest(s,'prepare',{choiceId});assert.throws(()=>quest(s,'prepare',{choiceId}),/already prepared/);
  s=answer(s,0);assert.equal(s.preparation.applied,true);if(choiceId==='heal')assert.ok(s.heroes.every(h=>h.hp>10));if(choiceId==='shield')assert.ok(s.heroes.every(h=>h.shield>0));if(choiceId==='attack'){assert.ok(hp-s.bossHp>=3000);assert.ok(s.lastEvent.preparationTargets.length);}
  assert.throws(()=>quest(s,'prepare',{choiceId}),/already prepared/);
 }
 let s=sturdy();s.charge=C.bossById(s.bossId).chargeMax;const intent=C.bossIntentFor(s);assert.equal(intent.ultimate,true);assert.ok(intent.attacks.every(a=>a.aoe));
 const next=act(s,'boss',{ultimate:true,timing:0});assert.deepEqual(next.lastEvent.targets.map(t=>s.heroes.find(h=>h.id===t.heroId).name),intent.attacks[0].targets);
});
test('personal choices persist on heroes across lessons, choose once and cannot replace the saved option payload',()=>{
 let s=win(start());const hero=s.heroes[0],prize=hero.treasureInbox[0];assert.equal(prize.options.length,3);
 const before=structuredClone(s);s=quest(s,'treasure',{heroId:hero.id,treasureId:prize.id,choiceId:'materials',shards:999});assert.equal(s.heroes[0].upgradeShards,3);assert.equal(s.heroes[0].treasureInbox.length,0);assert.equal(before.heroes[0].treasureInbox.length,1);
 assert.throws(()=>quest(s,'treasure',{heroId:hero.id,treasureId:prize.id,choiceId:'rune'}),/already chosen/);
 const carried=start(s);assert.equal(carried.heroes[0].upgradeShards,3);assert.ok(carried.heroes[1].treasureInbox.length);
 for(const category of ['equipment','rune']){let q=structuredClone(before);const option=prize.options.find(o=>o.id===category),count=h=>h.inventory.filter(e=>e.itemId===option.itemId).reduce((n,e)=>n+e.quantity,0);const n=count(q.heroes[0]);q=quest(q,'treasure',{heroId:hero.id,treasureId:prize.id,choiceId:category,itemId:'unique-forged'});assert.equal(count(q.heroes[0]),n+1);}
});
test('star shard forge consumes owned materials and one item, retains other inventory and rejects socketed or top-tier equipment',()=>{
 let s=win(start());const h=s.heroes[0],item=Object.values(C.ITEMS).find(i=>i.rarity==='common'&&i.type==='equipment');C.addInventory(h,item.id);h.upgradeShards=3;const entry=h.inventory.find(e=>e.itemId===item.id),n=entry.quantity;
 s=quest(s,'forge',{heroId:h.id,itemId:entry.id});assert.equal(s.heroes[0].upgradeShards,0);assert.equal(s.heroes[0].inventory.find(e=>e.itemId===item.id)?.quantity||0,n-1);assert.ok(s.heroes[0].inventory.some(e=>C.itemById(e.itemId).rarity==='uncommon'&&C.equipmentSlot(C.itemById(e.itemId))===C.equipmentSlot(item)));
 assert.throws(()=>quest(s,'forge',{heroId:h.id,itemId:entry.id}),/equipment|shards/);
});
test('quest choices enforce encounter/revision/pending-answer guards and never mutate prior snapshots',()=>{
 let s=sturdy(),copy=structuredClone(s);assert.throws(()=>act(s,'quest',{command:'prepare',choiceId:'heal',expectedRevision:s.revision-1}),/changed/);assert.deepEqual(s,copy);
 s=act(s,'select',{heroId:s.heroes[0].id});assert.throws(()=>quest(s,'prepare',{choiceId:'heal'}),/Resolve/);
});
