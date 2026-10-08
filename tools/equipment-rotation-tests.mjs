import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),C=require('../battle-core.js');
const slots=Object.keys(C.EQUIPMENT_SLOTS),playable=C.BOSSES.filter(b=>!b.legacy);
const hero=()=>C.heroFromStudent({id:'loadout-proof',name:'Alex'},null,0);
const own=(h,item)=>h.inventory.push({id:'bag:'+item.id,itemId:item.id,quantity:1});
let sequence=0;
const id=()=>`rotation-test-${++sequence}`;
const start=(previous=null,extra={})=>C.reduce(previous,{type:'start',id:id(),expectedRevision:previous?.revision,heroes:[hero()],...extra});

test('legacy single equipment migrates to its proper slot without healing or duplicating inventory',()=>{
  const h=hero();delete h.loadout;delete h.loadoutVersion;
  h.inventory.push({id:'old-inventory-id',itemId:'phoenix-crown',quantity:1},{id:'other-copy',itemId:'phoenix-crown',quantity:2});
  h.equipped='old-inventory-id';h.hp=17;h.mp=3;
  const before=structuredClone(h),clean=C.cleanHero(h,h);
  assert.deepEqual(h,before);assert.deepEqual(clean.loadout,{helm:'bag:phoenix-crown'});
  assert.equal(clean.inventory.find(i=>i.itemId==='phoenix-crown').quantity,3);
  assert.equal(clean.hp,17);assert.equal(clean.mp,3);assert.deepEqual(C.cleanHero(clean,clean),clean);
  const state=start();state.heroes=[h];state.heroArchive={archived:{...h,id:'archived',studentId:''}};
  const migrated=C.normalizeState(state);assert.deepEqual(migrated.heroes[0].loadout,clean.loadout);
  assert.deepEqual(migrated.heroArchive.archived.loadout,clean.loadout);assert.equal(migrated.heroes[0].hp,17);
  assert.deepEqual(C.normalizeState(migrated),migrated);
});

test('all eleven slots equip independently and owned items cannot enter a wrong slot or a duplicate ring slot',()=>{
  let h=hero();
  for(const slot of slots){const item=Object.values(C.ITEMS).find(i=>C.equipmentSlot(i)===slot);assert.ok(item,slot);own(h,item);h=C.configureHero(h,{command:'equip',itemId:'bag:'+item.id,slot});}
  assert.equal(Object.keys(h.loadout).length,11);assert.equal(C.equippedEntries(h).length,11);
  const before=structuredClone(h),ring=h.loadout.ring1;
  assert.throws(()=>C.configureHero(h,{command:'equip',itemId:ring,slot:'ring2'}),/must be owned/);
  assert.throws(()=>C.configureHero(h,{command:'equip',itemId:h.loadout.pet,slot:'helm'}),/does not fit/);
  assert.throws(()=>C.configureHero(h,{command:'equip',itemId:'bag:unowned'}),/inventory/);
  assert.throws(()=>C.configureHero(h,{command:'equip',itemId:null,slot:'made-up'}),/valid equipment slot/);
  assert.deepEqual(h,before);
  const unequipped=C.configureHero(h,{command:'equip',itemId:null,slot:'ring1'});
  assert.equal(unequipped.loadout.ring1,undefined);assert.equal(unequipped.loadout.ring2,h.loadout.ring2);assert.equal(unequipped.loadout.pet,h.loadout.pet);
  const malformed={...h,equipped:null,loadout:{helm:'bag:unowned',ring2:ring,pet:h.loadout.pet}};
  assert.deepEqual(C.loadoutFor(malformed),{ring2:ring,pet:h.loadout.pet});
});

test('rings fit either slot while shared quantities enforce ownership and both copies apply their bonuses',()=>{
  const item=Object.values(C.ITEMS).find(i=>i.slot==='ring1'),other=Object.values(C.ITEMS).find(i=>i.slot==='ring2');
  let h=hero();own(h,item);own(h,other);
  h=C.configureHero(h,{command:'equip',itemId:'bag:'+item.id,slot:'ring2'});
  h=C.configureHero(h,{command:'equip',itemId:'bag:'+other.id,slot:'ring1'});
  assert.deepEqual(h.loadout,{ring1:'bag:'+other.id,ring2:'bag:'+item.id});
  assert.throws(()=>C.configureHero(h,{command:'equip',itemId:'bag:'+item.id,slot:'ring1'}),/must be owned/);
  h.inventory.find(e=>e.itemId===item.id).quantity=2;
  h=C.configureHero(h,{command:'equip',itemId:'bag:'+item.id,slot:'ring1'});
  assert.equal(C.equippedEntries(h).length,2);
  for(const [key,value] of Object.entries(item.effect))if(Number.isFinite(value)&&!['pierce','leech','teamLeech','critChance'].includes(key))assert.equal(C.equipmentEffect(h)[key],value*2);
  const once=C.configureHero(h,{command:'equip',itemId:null,slot:'ring2'});assert.equal(once.loadout.ring1,'bag:'+item.id);assert.equal(once.loadout.ring2,undefined);
  h.inventory.find(e=>e.itemId===item.id).quantity=1;assert.deepEqual(C.loadoutFor(h),{ring1:'bag:'+item.id});
  C.autoEquip(h);assert.equal(new Set(Object.values(h.loadout)).size,Object.values(h.loadout).length,'auto-equipping does not duplicate single copies');
});

test('automatic ring upgrades reserve the other worn copy and retain manually swapped equal-rarity rings',()=>{
  const rings=Object.values(C.ITEMS).filter(i=>['ring1','ring2'].includes(i.slot)),rare=rings.filter(i=>i.rarity==='rare'),best=rings.find(i=>i.rarity==='mythical');
  let h=hero();own(h,rare[0]);own(h,rare[1]);
  h=C.configureHero(h,{command:'equip',itemId:'bag:'+rare[0].id,slot:'ring2'});
  h=C.configureHero(h,{command:'equip',itemId:'bag:'+rare[1].id,slot:'ring1'});
  const before=structuredClone(h.loadout);assert.equal(C.autoEquip(h),null);assert.deepEqual(h.loadout,before);
  own(h,best);C.autoEquip(h);assert.equal(h.loadout.ring1,'bag:'+best.id);assert.equal(h.loadout.ring2,before.ring2);
  h.inventory.find(e=>e.itemId===best.id).quantity=2;C.autoEquip(h);assert.deepEqual(h.loadout,{ring1:'bag:'+best.id,ring2:'bag:'+best.id});
});

test('equipment and pets stack numeric passives, OR boolean passives and cap fractional combat mechanics',()=>{
  const h=hero(),baseline=C.statsFor(h),fixtureIds=[];
  try {
    for(const [index,slot] of slots.entries()){
      const key='loadout-fixture-'+slot;fixtureIds.push(key);
      C.ITEMS[key]={id:key,type:slot==='pet'?'pet':'equipment',slot,rarity:'common',effect:{damage:2,maxHp:3,maxMp:1,leech:.4,pierce:.3,teamLeech:.1,critChance:.2,echo:index===0,revive:index===1,ignoreGuard:index===2}};
      own(h,C.ITEMS[key]);h.loadout[slot]='bag:'+key;
    }
    const effect=C.equipmentEffect(h),stats=C.statsFor(h);
    assert.equal(effect.damage,22);assert.equal(effect.leech,.75);assert.equal(effect.pierce,1);assert.equal(effect.teamLeech,.3);
    assert.equal(effect.echo,true);assert.equal(effect.revive,true);assert.equal(effect.ignoreGuard,true);
    assert.equal(stats.damage,baseline.damage+22);assert.equal(stats.maxHp,baseline.maxHp+33);assert.equal(stats.maxMp,baseline.maxMp+11);assert.equal(stats.critChance,.85);
    const s=start();s.heroes=[C.cleanHero(h,h)];s.bossHp=s.bossMaxHp=100000;s.heroes[0].hp=1;s.guard=true;
    const selected=C.reduce(s,{type:'select',id:id(),encounterId:s.encounterId,expectedRevision:s.revision,heroId:h.id});
    const attacked=C.reduce(selected,{type:'answer',id:id(),encounterId:s.encounterId,turnId:selected.pending.id,outcome:'correct'});
    assert.ok(attacked.lastEvent.damage>baseline.damage);assert.ok(attacked.heroes[0].hp>1);
    assert.ok(attacked.heroes[0].hp<=attacked.heroes[0].stats.maxHp);
  } finally {for(const key of fixtureIds)delete C.ITEMS[key];}
});

test('auto-equipment improves every slot, retains same-rarity selections and preserves absolute HP and MP',()=>{
  let h=hero();h.hp=7;h.mp=2;
  for(const slot of slots){const item=Object.values(C.ITEMS).find(i=>C.equipmentSlot(i)===slot&&i.rarity==='common');own(h,item);}
  C.autoEquip(h);assert.equal(Object.keys(h.loadout).length,11);assert.equal(h.hp,7);assert.equal(h.mp,2);
  const prior=structuredClone(h.loadout);
  for(const slot of slots){const tie=Object.values(C.ITEMS).find(i=>C.equipmentSlot(i)===slot&&i.rarity==='common'&&'bag:'+i.id!==prior[slot]);if(tie)own(h,tie);}
  assert.equal(C.autoEquip(h),null);assert.deepEqual(h.loadout,prior);
  for(const slot of slots){const best=Object.values(C.ITEMS).find(i=>C.equipmentSlot(i)===slot&&i.rarity==='mythical');own(h,best);}
  C.autoEquip(h);assert.equal(h.hp,7);assert.equal(h.mp,2);
  assert.ok(C.equippedEntries(h).every(e=>C.itemById(e.itemId).rarity==='mythical'));
  h.hp=0;C.autoEquip(h);assert.equal(h.hp,0);
});

test('every playable boss appears once per persisted round and explicit client choices cannot bypass the rotation',()=>{
  assert.equal(playable.length,100);
  let state=null;const first=[],second=[];
  for(let i=0;i<200;i++){
    const actionId=id(),seed='rotation-spin-'+i,predicted=C.nextBoss(state,seed);
    const action={type:'start',id:actionId,spinId:seed,expectedRevision:state?.revision,heroes:[hero()],bossId:'goblin'};
    const previous=state,before=structuredClone(state);state=C.reduce(state,action);
    assert.equal(state.bossId,predicted.id);assert.deepEqual(previous,before);
    assert.equal(C.reduce(state,action),state,'start retry does not consume another enemy');
    assert.equal(state.bossRotation.round,i<100?1:2);assert.equal(state.bossRotation.seen.length,i%100+1);
    (i<100?first:second).push(state.bossId);
    state=JSON.parse(JSON.stringify(state));
  }
  assert.equal(new Set(first).size,100);assert.equal(new Set(second).size,100);
  assert.deepEqual([...first].sort(),playable.map(b=>b.id).sort());
});

test('old snapshots reconcile current enemies and malformed rotation history without losing progress',()=>{
  const old=start();delete old.bossRotation;old.bossId='goblin';old.bossHp=17;old.heroes[0].hp=3;
  const normalized=C.normalizeState(old);assert.deepEqual(normalized.bossRotation,{version:1,round:1,seen:['goblin']});
  assert.equal(normalized.bossHp,17);assert.equal(normalized.heroes[0].hp,3);
  normalized.bossRotation.seen.push('goblin','no-longer-playable','mossback');
  assert.deepEqual(C.bossRotationFor(normalized).seen,['goblin']);
  assert.notEqual(C.nextBoss(normalized,'next-old-round').id,'goblin');
  assert.deepEqual(C.normalizeState(C.normalizeState(old)),C.normalizeState(old));
});

test('manual and Quick fights share one persisted rotation and failed or repeated awards consume no extra bosses',()=>{
  let state=start();const firstBoss=state.bossId;
  state=C.reduce(state,{type:'end',id:id(),encounterId:state.encounterId,expectedRevision:state.revision});
  const action={type:'auto',id:id(),spinId:'shared-quick-spin',heroId:hero().id,heroes:[hero()],points:1,encounterId:state.encounterId,expectedRevision:state.revision,bossId:firstBoss};
  const predicted=C.nextBoss(state,action.spinId),before=structuredClone(state);
  assert.throws(()=>C.reduce(state,{...action,points:0}),/whole points/);assert.deepEqual(state,before);
  const quick=C.reduce(state,action);assert.equal(quick.bossId,predicted.id);assert.notEqual(quick.bossId,firstBoss);
  assert.equal(quick.bossRotation.seen.length,2);assert.equal(C.reduce(quick,action),quick);
  assert.deepEqual(C.reduce(state,action),quick,'transaction replay uses the same next boss');
});
