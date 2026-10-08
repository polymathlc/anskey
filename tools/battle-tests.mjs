import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../battle-core.js'), Store = require('../battle-store.js');
const roles = Object.keys(C.ROLES);
const makeHero = (role, uid = role) => C.heroFromStudent({id:'register-'+uid,uid,name:uid},null,roles.indexOf(role));
const heroes = roles.map(role => makeHero(role));
let seq = 0;
const id = () => 'action-' + String(++seq).padStart(8, '0');
// Mechanical fixtures deliberately replace the randomly selected enemy after
// start. Production starts always enforce the saved no-repeat rotation.
const start = (bossId = 'mossback', party = heroes) => {
  const state=C.reduce(null,{type:'start',id:id(),heroes:party}),boss=C.bossById(bossId);
  state.bossId=boss.id;
  state.bossHp=state.bossMaxHp=Math.max(1,Math.ceil(Math.round(Math.max(200,state.heroes.reduce((sum,h)=>sum+h.stats.damage,0)*4)*boss.hpMultiplier)/2));
  return state;
};
const apply = (s,type,values={}) => C.reduce(s,{id:id(),encounterId:s.encounterId,expectedRevision:s.revision,type,...values});
function answer(s,role,outcome='correct',command={}) {
  const chosen=apply(s,'select',{heroId:'student:register-'+role});
  return apply(chosen,'answer',{turnId:chosen.pending.id,outcome,...command});
}
function unlock(s,role,skillId) {const h=s.heroes.find(h=>h.id==='student:register-'+role);h.learnedSkills.push(skillId);return s;}
function grant(s,role,itemId) {const h=s.heroes.find(h=>h.id==='student:register-'+role);h.inventory.push({id:'bag:'+itemId,itemId,quantity:1});return s;}
function equip(s,role,itemId) {return apply(grant(s,role,itemId),'sync',{command:'equip',heroId:'student:register-'+role,itemId:'bag:'+itemId});}

test('heroes ignore all CER profiles, including class, stats, avatar, gear and matching uid',()=>{
  const student={id:'one',uid:'one',name:'Alex'};
  const plain=C.heroFromStudent(student);
  const cer=C.heroFromStudent(student,{battleHero:{version:1,uid:'one',role:'mage',stats:{maxHp:100000,atk:10000},avatarDataUrl:'data:image/svg+xml;base64,QQ==',equipment:{weapon:'mythic'}}});
  assert.deepEqual(cer,plain);assert.equal(cer.avatarUrl,undefined);assert.equal(cer.equipment,undefined);
  assert.equal(cer.id,'student:one');assert.notEqual(C.heroFromStudent({id:'a',name:'Alex'}).id,C.heroFromStudent({id:'b',name:'Alex'}).id);
  assert.deepEqual(Array.from({length:8},(_,i)=>C.heroFromStudent({id:String(i)},null,i).role),[...roles,...roles]);
});

test('four independent classes have useful distinct baseline stats and one starter ability',()=>{
  assert.deepEqual(roles,['warrior','ranger','mage','cleric']);
  const [w,r,m,c]=heroes;
  assert.ok(w.stats.maxHp>r.stats.maxHp);assert.ok(w.stats.defence>m.stats.defence);
  assert.equal(r.stats.attacks,2);assert.ok(r.stats.critChance>w.stats.critChance);
  assert.ok(m.stats.damage>w.stats.damage);assert.ok(c.stats.healing>0);
  heroes.forEach(h=>{assert.equal(h.level,1);assert.equal(h.skillPoints,2);assert.equal(C.availableSkills(h).length,1);});
  const supplied=structuredClone(heroes);supplied[0].stats.damage=9999;supplied[0].xp=50000;supplied[0].inventory=[];
  const state=start('goblin',supplied);assert.equal(state.heroes[0].stats.damage,w.stats.damage);assert.equal(state.heroes[0].level,1);assert.equal(state.heroes[0].inventory.length,2);
});

test('48 skills form three four-tier branches per class and all loot rarities have effects',()=>{
  const ids=[];
  for(const role of roles){const tree=C.SKILLS[role];assert.equal(tree.length,12);assert.equal(new Set(tree.map(s=>s.branch)).size,3);
    for(const s of tree){ids.push(s.id);assert.equal(s.role,role);assert.ok(s.description);assert.ok(s.effect);assert.ok(s.level>=1 && s.level<=4);
      if(s.tier>1){assert.equal(s.requires.length,1);const parent=C.skillById(s.requires[0]);assert.equal(parent.branch,s.branch);assert.equal(parent.tier,s.tier-1);}
      assert.equal(s.effect.type,s.passive?'passive':'active');
    }
  }
  assert.equal(new Set(ids).size,48);assert.equal(Object.keys(C.RARITIES).length,6);
  for(const rarity of Object.keys(C.RARITIES))assert.ok(Object.values(C.ITEMS).some(i=>i.rarity===rarity && Object.keys(i.effect).length));
});

test('correct, incorrect and skip consume one turn; duplicate answers cannot damage',()=>{
  for(const outcome of ['correct','incorrect','skip']){
    const chosen=apply(start(),'select',{heroId:heroes[0].id});
    const action={type:'answer',id:id(),encounterId:chosen.encounterId,turnId:chosen.pending.id,outcome};
    const resolved=C.reduce(chosen,action);assert.equal(resolved.pending,null);
    assert.equal(resolved.bossHp<chosen.bossHp,outcome==='correct');
    assert.throws(()=>C.reduce(resolved,action),/already resolved/);
  }
});

test('active skills charge MP, enforce learning and cooldown, and attack restores MP',()=>{
  const s=start(),skill=C.SKILLS.warrior[0];
  const cast=answer(s,'warrior','correct',{command:'skill',skillId:skill.id});
  assert.equal(cast.heroes[0].mp,s.heroes[0].mp-skill.mpCost);assert.equal(cast.heroes[0].cooldowns[skill.id],skill.cooldown);
  assert.ok(cast.lastEvent.damage>=Math.round(s.heroes[0].stats.damage*1.2));
  assert.throws(()=>answer(cast,'warrior','correct',{command:'skill',skillId:skill.id}),/cooling/);
  const attack=answer(cast,'warrior');assert.equal(attack.heroes[0].mp,Math.min(attack.heroes[0].stats.maxMp,cast.heroes[0].mp+10));
  assert.equal(attack.heroes[0].cooldowns[skill.id],0);
  assert.ok(answer(attack,'warrior','correct',{command:'skill',skillId:skill.id}).lastEvent.damage>0);
  const empty=start();empty.heroes[0].mp=0;const before=JSON.stringify(empty);
  assert.throws(()=>answer(empty,'warrior','correct',{command:'skill',skillId:skill.id}),/Not enough MP/);assert.equal(JSON.stringify(empty),before);
  assert.throws(()=>answer(start(),'warrior','correct',{command:'skill',skillId:'mage-meteor'}),/Learn/);
});

test('skill learning enforces prerequisites, levels, points, passive effects and revision',()=>{
  let s=start();const h=s.heroes[0];
  assert.equal(C.canLearn(h,'warrior-earthshatter').ok,false);
  assert.throws(()=>apply(s,'sync',{command:'learn',heroId:h.id,skillId:'warrior-iron-will'}),/level 2/);
  h.xp=C.xpForLevel(4);h.level=4;h.skillPoints=8;
  assert.throws(()=>apply(s,'sync',{command:'learn',heroId:h.id,skillId:'warrior-earthshatter'}),/preceding/);
  s=apply(s,'sync',{command:'learn',heroId:h.id,skillId:'warrior-iron-will'});
  assert.equal(s.heroes[0].skillPoints,7);assert.equal(s.heroes[0].stats.defence,C.ROLES.warrior.defence+3+4);
  assert.throws(()=>answer(s,'warrior','correct',{command:'skill',skillId:'warrior-iron-will'}),/Learn/);
  assert.throws(()=>apply(s,'sync',{command:'learn',heroId:h.id,skillId:'warrior-iron-will'}),/Already learned/);
  assert.throws(()=>apply(s,'sync',{command:'learn',heroId:h.id,skillId:'warrior-cleave',expectedRevision:s.revision-1}),/another screen/);
  s.heroes[0].skillPoints=0;assert.throws(()=>apply(s,'sync',{command:'learn',heroId:h.id,skillId:'warrior-cleave'}),/skill points/);
});

test('class changes preserve learned branches and MP without allowing mid-answer mutation',()=>{
  let s=apply(start(),'sync',{command:'learn',heroId:'student:register-warrior',skillId:'warrior-cleave'});
  s.heroes[0].mp=9;s.heroes[0].cooldowns['warrior-cleave']=1;
  s=apply(s,'sync',{command:'class',heroId:'student:register-warrior',role:'mage'});
  assert.equal(s.heroes[0].role,'mage');assert.equal(s.heroes[0].mp,9);assert.ok(s.heroes[0].learnedSkills.includes('warrior-cleave'));
  assert.ok(C.availableSkills(s.heroes[0]).every(k=>k.role==='mage'));
  s=apply(s,'sync',{command:'class',heroId:'student:register-warrior',role:'warrior'});assert.equal(s.heroes[0].cooldowns['warrior-cleave'],1);
  const chosen=apply(s,'select',{heroId:'student:register-warrior'});
  assert.throws(()=>apply(chosen,'sync',{command:'class',heroId:'student:register-warrior',role:'cleric'}),/Resolve/);
  assert.equal(apply(s,'sync',{command:'class',heroId:'student:register-warrior',role:'healer'}).heroes[0].role,'cleric');
});

test('consumables are used once, target teammates, resurrect and never consume on incorrect answers',()=>{
  const s=start();s.heroes[1].hp=0;
  const used=answer(s,'warrior','correct',{command:'item',itemId:'bag:red-potion',targetId:'student:register-ranger'});
  assert.ok(used.heroes[1].hp>0);assert.equal(used.heroes[0].inventory.find(i=>i.itemId==='red-potion').quantity,1);assert.equal(used.bossHp,s.bossHp);
  assert.equal(answer(s,'warrior','incorrect',{command:'item',itemId:'bag:red-potion'}).heroes[0].inventory[0].quantity,2);
  assert.throws(()=>answer(s,'warrior','correct',{command:'item',itemId:'bag:fake'}),/consumable/);
  assert.throws(()=>answer(s,'warrior','correct',{command:'item',itemId:'bag:red-potion',targetId:'not-in-party'}),/teammate/);
  const damaged=answer(grant(start(),'warrior','fire-flask'),'warrior','correct',{command:'item',itemId:'bag:fire-flask'});
  assert.equal(damaged.lastEvent.damage,100);assert.ok(!damaged.heroes[0].inventory.some(i=>i.itemId==='fire-flask'));
});

test('cleric heals fallen allies, shields absorb, poison ticks and weaken reduces the next boss hit',()=>{
  const hurt=start();hurt.heroes.forEach(h=>h.hp=10);hurt.heroes[0].hp=0;
  const healed=answer(hurt,'cleric','correct',{command:'skill',skillId:'cleric-healing-light'});
  assert.ok(healed.heroes.every(h=>h.hp>10));assert.equal(healed.lastEvent.healed.length,4);
  const shielded=answer(unlock(start(),'cleric','cleric-sanctuary'),'cleric','correct',{command:'skill',skillId:'cleric-sanctuary'});
  assert.ok(shielded.heroes.every(h=>h.shield>0));assert.ok(apply(shielded,'boss',{timing:0}).lastEvent.targets[0].absorbed>0);
  const poisoned=answer(unlock(start(),'ranger','ranger-venom-arrow'),'ranger','correct',{command:'skill',skillId:'ranger-venom-arrow'});
  assert.equal(poisoned.poison.turns,3);assert.ok(apply(poisoned,'boss').bossHp<poisoned.bossHp);
  const weak=answer(unlock(start(),'ranger','ranger-smoke-arrow'),'ranger','correct',{command:'skill',skillId:'ranger-smoke-arrow'});
  assert.ok(apply(weak,'boss',{timing:.5}).lastEvent.targets[0].damage<apply(start(),'boss',{timing:.5}).lastEvent.targets[0].damage);
  assert.equal(apply(weak,'boss').bossWeakness,0);
});

test('boss black, orange, red timing is strictly monotonic and invalid positions are rejected',()=>{
  const s=start();const results=[0,.54,.55,.84,.85,1].map(timing=>apply(s,'boss',{timing}));
  assert.deepEqual(results.map(x=>x.lastEvent.zone),['black','black','orange','orange','red','red']);
  const damage=results.map(x=>x.lastEvent.targets[0].damage);assert.ok(damage.every((d,i)=>i===0 || d>=damage[i-1]));assert.ok(damage.at(-1)>damage[0]*2);
  assert.equal(C.timingMultiplier(0),.55);assert.equal(C.timingMultiplier(1),2);
  for(const timing of [-1,1.01,NaN,Infinity,'red'])assert.throws(()=>apply(s,'boss',{timing}),/meter/);
});

test('one hundred pixel encounters range from weak goblins to powerful bosses; old saves retain 20 originals',()=>{
  const pixel=C.BOSSES.filter(b=>!b.legacy);assert.equal(pixel.length,100);assert.equal(C.BOSSES.filter(b=>b.legacy).length,20);
  assert.ok(C.bossById('goblin').hpMultiplier<C.bossById('dragon').hpMultiplier);
  for(const b of C.BOSSES){assert.ok(b.image);assert.ok(b.attackName);assert.ok(b.ultimateName);
    let s=start(b.id);assert.throws(()=>apply(s,'boss',{ultimate:true}),/not charged/);
    for(let i=0;i<b.chargeMax;i++){s.heroes.forEach(h=>h.hp=h.stats.maxHp);s=apply(s,'boss',{timing:0});}
    assert.equal(s.charge,b.chargeMax);assert.throws(()=>apply(s,'boss'),/Ultimate is ready/);
    s.heroes.forEach(h=>h.hp=h.stats.maxHp);s=apply(s,'boss',{ultimate:true,timing:0});assert.equal(s.lastEvent.targets.length,4);assert.equal(s.charge,0);
  }
});

test('legacy special boss styles still apply reflect, swift, regeneration, guard and weakness',()=>{
  assert.equal(apply(start('bubblebeard'),'boss').lastEvent.targets.length,4);
  assert.equal(apply(start('stormwhisker'),'boss').lastEvent.targets[0].hits,2);
  const regen=start('jellycrown');regen.bossHp-=50;assert.ok(apply(regen,'boss').bossHp>regen.bossHp);
  assert.equal(answer(start('thistletuft'),'warrior').lastEvent.effect,'reflect');
  assert.ok(apply(start('inktip'),'boss').heroes[0].weakened);assert.ok(apply(start('honeyhelm'),'boss').guard);
});

test('all heroes including KO heroes receive deterministic independent loot exactly once on victory',()=>{
  const s=start('goblin');s.bossHp=1;s.heroes[1].hp=0;
  const selected=apply(s,'select',{heroId:'student:register-warrior'});
  const action={id:id(),encounterId:s.encounterId,type:'answer',turnId:selected.pending.id,outcome:'correct'};
  const won=C.reduce(selected,action);assert.equal(won.status,'victory');assert.equal(won.rewards.length,4);assert.ok(won.lootAwarded);
  assert.deepEqual(won,C.reduce(selected,action));assert.equal(new Set(won.rewards.map(r=>r.instanceId)).size,4);
  for(const h of won.heroes){const reward=won.rewards.find(r=>r.heroId===h.id);assert.ok(h.inventory.find(i=>i.itemId===reward.itemId));assert.ok(h.xp>=45);}
  assert.equal(won.heroes[1].hp,0);assert.throws(()=>C.reduce(won,action),/finished/);
  const synced=apply(won,'sync',{heroes});assert.equal(synced.rewards.length,4);assert.equal(synced.heroes.reduce((n,h)=>n+h.inventory.reduce((a,i)=>a+i.quantity,0),0),16);
  const rarities=new Set();for(let i=0;i<10000;i++)rarities.add(C.rollReward('loot-distribution','hero-'+i,C.bossById('goblin')).rarity);
  assert.equal(rarities.size,6);
});

test('XP, learned skills, class, gear and inventory persist across encounters and roster edits',()=>{
  let s=apply(start(),'sync',{command:'learn',heroId:'student:register-warrior',skillId:'warrior-cleave'});
  s=equip(s,'warrior','crimson-edge');s.heroes[0].xp=100;s.heroes[0].level=2;s.heroes[0].hp-=30;s.heroes[1].hp=0;
  const rosterFresh=structuredClone(heroes);rosterFresh[0].role='mage';rosterFresh[0].stats.damage=9999;rosterFresh[0].name='Renamed';
  const synced=apply(s,'sync',{heroes:rosterFresh});assert.equal(synced.heroes[0].role,'warrior');assert.equal(synced.heroes[0].name,'Renamed');assert.equal(synced.heroes[1].hp,0);
  assert.equal(synced.heroes[0].xp,100);assert.ok(synced.heroes[0].learnedSkills.includes('warrior-cleave'));assert.equal(synced.heroes[0].equipped,'bag:crimson-edge');
  const removed=apply(synced,'sync',{heroes:heroes.slice(1)});assert.ok(removed.heroArchive['student:register-warrior']);
  const restored=apply(removed,'sync',{heroes});assert.equal(restored.heroes[0].xp,100);assert.equal(restored.heroes[0].equipped,'bag:crimson-edge');
  const next=apply(restored,'start',{heroes,bossId:'dragon'});assert.equal(next.heroes[0].xp,100);assert.equal(next.heroes[0].equipped,'bag:crimson-edge');assert.equal(next.heroes[0].hp,next.heroes[0].stats.maxHp);assert.equal(next.rewards.length,0);
});

test('old saved CER heroes migrate once to independent stats, preserve KO and map healer to cleric',()=>{
  const legacy=start();legacy.heroes.forEach(h=>{delete h.progressionVersion;h.stats.damage=999;h.avatarUrl='cer-avatar';});legacy.heroes[3].role='healer';legacy.heroes[1].hp=0;
  const migrated=apply(legacy,'sync',{heroes});assert.equal(migrated.schemaVersion,1);assert.equal(migrated.heroes[3].role,'cleric');assert.equal(migrated.heroes[1].hp,0);
  assert.ok(migrated.heroes.every(h=>h.progressionVersion===1 && h.stats.damage<100 && !h.avatarUrl));
});

test('mythical equipment implements phoenix rescue, echo damage, armour bypass and team restoration',()=>{
  let phoenix=equip(start('bubblebeard'),'warrior','phoenix-crown');phoenix.heroes.forEach(h=>h.hp=1);
  phoenix=apply(phoenix,'boss',{timing:1});assert.equal(phoenix.status,'active');assert.ok(phoenix.lastEvent.revival);assert.ok(phoenix.heroes[0].mythicalUsed);
  phoenix.heroes.forEach(h=>h.hp=1);assert.equal(apply(phoenix,'boss',{timing:1}).status,'defeat');
  let echo=equip(start('lich'),'warrior','chronicle');echo.heroes[0].correctActions=2;
  echo=answer(echo,'warrior');assert.ok(echo.lastEvent.echo);
  let voided=equip(start('golem'),'warrior','void-edge');voided.guard=true;voided.heroes[0].stats.critChance=0;
  const pierced=answer(voided,'warrior');assert.equal(pierced.lastEvent.damage,voided.heroes[0].stats.damage);
  let star=equip(start('lich'),'warrior','sovereign-star');star.heroes.forEach(h=>{h.hp=10;h.mp=0;});
  star=answer(star,'warrior');assert.ok(star.heroes.every(h=>h.hp>10 && h.mp>0));
});

test('class and HP equipment toggles cannot heal wounded heroes or refill MP',()=>{
  let s=equip(start(),'warrior','worldroot');s.heroes[0].hp=1;s.heroes[0].mp=1;
  for(let i=0;i<5;i++){
    s=apply(s,'sync',{command:'class',heroId:'student:register-warrior',role:'mage'});
    s=apply(s,'sync',{command:'equip',heroId:'student:register-warrior',itemId:null});
    s=apply(s,'sync',{command:'class',heroId:'student:register-warrior',role:'warrior'});
    s=apply(s,'sync',{command:'equip',heroId:'student:register-warrior',itemId:'bag:worldroot'});
  }
  assert.equal(s.heroes[0].hp,1);assert.equal(s.heroes[0].mp,1);
});

test('Chronicle echoes consumables and Phoenix Crown rescues reflection damage once',()=>{
  let s=equip(start('lich'),'warrior','chronicle');s.heroes[0].correctActions=2;
  s=answer(grant(s,'warrior','fire-flask'),'warrior','correct',{command:'item',itemId:'bag:fire-flask'});
  assert.ok(s.lastEvent.echo);assert.equal(s.lastEvent.damage,200);assert.equal(s.lastEvent.critical,false);
  let reflect=equip(start('crystalhoof',[heroes[0]]),'warrior','phoenix-crown');reflect.heroes[0].hp=1;
  reflect=answer(reflect,'warrior');assert.equal(reflect.status,'active');assert.ok(reflect.lastEvent.revival);assert.equal(reflect.heroes[0].hp,reflect.heroes[0].stats.maxHp/2);
  reflect.heroes[0].hp=1;reflect=answer(reflect,'warrior');assert.equal(reflect.status,'defeat');
});

test('Time Warp speeds other cooldowns but cannot reduce its own newly started cooldown',()=>{
  const s=unlock(start('lich'),'mage','mage-time-warp');s.heroes[0].cooldowns['warrior-earthshatter']=3;s.heroes[2].cooldowns['mage-firebolt']=3;
  const next=answer(s,'mage','correct',{command:'skill',skillId:'mage-time-warp'});
  assert.equal(next.heroes[2].cooldowns['mage-time-warp'],3);assert.equal(next.heroes[0].cooldowns['warrior-earthshatter'],1);assert.equal(next.heroes[2].cooldowns['mage-firebolt'],0);
});

test('victory/defeat prevent attacks; KO heroes can still answer; stale turns cannot mutate',()=>{
  const s=start();s.bossHp=1;assert.throws(()=>apply(answer(s,'warrior'),'boss'),/finished/);
  const exhausted=start('bubblebeard');exhausted.heroes.forEach(h=>h.hp=1);const lost=apply(exhausted,'boss');assert.equal(lost.status,'defeat');assert.throws(()=>answer(lost,'cleric'),/finished/);
  const rested=start();rested.heroes[0].hp=0;assert.ok(answer(rested,'warrior').heroes[0].hp>0);
  const next=apply(start(),'boss');assert.throws(()=>apply(next,'boss',{expectedRevision:next.revision-1}),/already changed/);
  assert.throws(()=>apply(next,'select',{heroId:heroes[0].id,expectedRevision:next.revision-1}),/another screen/);
  assert.throws(()=>apply(next,'boss',{encounterId:'old-encounter'}),/encounter has changed/);
});

// Firestore-style optimistic retry harness: interleaved transactions only commit
// when every read version still matches, otherwise replay their callback.
function database() {
  const data = new Map(), versions = new Map(), listeners = new Map();
  function ref(path) { return { path, collection: name => ref(path + '/' + name), doc: id => ref(path + '/' + id),
    onSnapshot(fn) { (listeners.get(path) || listeners.set(path, new Set()).get(path)).add(fn); fn(snapshot(path)); return () => listeners.get(path).delete(fn); } }; }
  const snapshot = path => ({ exists: data.has(path), data: () => structuredClone(data.get(path)) });
  return { collection: name => ref(name), data,
    async runTransaction(callback) {
      for (let retry = 0; retry < 20; retry++) {
        const reads = new Map(), writes = new Map();
        const result = await callback({ get: async r => { reads.set(r.path, versions.get(r.path) || 0); await Promise.resolve(); return snapshot(r.path); },
          set: (r, value) => writes.set(r.path, structuredClone(value)) });
        if ([...reads].some(([path, version]) => version !== (versions.get(path) || 0))) continue;
        for (const [path, value] of writes) { data.set(path, value); versions.set(path, (versions.get(path) || 0) + 1); }
        for (const path of writes.keys()) for (const listener of listeners.get(path) || []) listener(snapshot(path));
        return result;
      }
      throw new Error('Transaction retry limit');
    }
  };
}
test('two sessions, duplicate IDs, simultaneous answers, reload and teacher/class isolation', async () => {
  const db = database(), config = { db, teacherId: 'teacher', classId: 'P5 / Science', canWrite: () => true };
  const a = Store.create(config), b = Store.create(config);
  let s = await a.act({ id: id(), type: 'start', bossId: 'mossback', heroes });
  s = await a.act({ id: id(), type: 'select', encounterId: s.encounterId, expectedRevision: s.revision, heroId: heroes[0].id });
  const action = { id: id(), type: 'answer', encounterId: s.encounterId, turnId: s.pending.id, outcome: 'correct' };
  const results = await Promise.all([a.act(action), b.act(action)]);
  assert.equal(results[0].bossHp, results[1].bossHp); assert.equal(results[0].correctCount, 1);
  let restored; Store.create(config).subscribe(value => { restored = value; });
  assert.equal(restored.correctCount, 1); assert.equal(restored.pending, null);
  s = await a.act({ id: id(), type: 'select', encounterId: restored.encounterId, expectedRevision: restored.revision, heroId: heroes[1].id });
  const simultaneous = await Promise.allSettled(['correct', 'incorrect'].map(outcome => b.act({ id: id(), type: 'answer', encounterId: s.encounterId, turnId: s.pending.id, outcome })));
  assert.equal(simultaneous.filter(r => r.status === 'fulfilled').length, 1);
  for (const override of [{ teacherId: 'other' }, { classId: 'P6 Science' }]) {
    let isolated = 'unset'; Store.create({ ...config, ...override }).subscribe(value => { isolated = value; }); assert.equal(isolated, null);
  }
  assert.notEqual(Store.classKey('P5/Science'), Store.classKey('P5%2fScience'));
  await assert.rejects(Store.create({ ...config, canWrite: () => false }).act(action), /Only the signed-in/);
  let gates = 0;
  const changedAccount = Store.create({ ...config, classId:'switch-during-read', canWrite:() => ++gates < 3 });
  await assert.rejects(changedAccount.act({id:id(),type:'start',bossId:'mossback',heroes}), /Only the signed-in/);
  assert.equal(db.data.has(changedAccount.ref.path), false);
});

test('concurrent transaction retries consume an item once, learn once and award one chest',async()=>{
  const db=database(),config={db,teacherId:'teacher',classId:'Pixel party',canWrite:()=>true};
  const a=Store.create(config),b=Store.create(config);
  let s=await a.act({id:id(),type:'start',bossId:'goblin',heroes});
  const learn={type:'sync',command:'learn',heroId:'student:register-warrior',skillId:'warrior-cleave',encounterId:s.encounterId,expectedRevision:s.revision};
  const results=await Promise.allSettled([a.act({...learn,id:id()}),b.act({...learn,id:id()})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  s=db.data.get(a.ref.path);assert.equal(s.heroes[0].skillPoints,1);assert.equal(s.heroes[0].learnedSkills.filter(x=>x==='warrior-cleave').length,1);
  s=await a.act({id:id(),type:'select',heroId:'student:register-warrior',encounterId:s.encounterId,expectedRevision:s.revision});
  const item={id:id(),type:'answer',outcome:'correct',command:'item',itemId:'bag:red-potion',turnId:s.pending.id,encounterId:s.encounterId};
  const consumed=await Promise.all([a.act(item),b.act(item)]);
  assert.deepEqual(consumed[0],consumed[1]);assert.equal(consumed[0].heroes[0].inventory.find(i=>i.itemId==='red-potion').quantity,1);
  s=structuredClone(consumed[0]);s.bossHp=1;s.heroes[1].hp=0;db.data.set(a.ref.path,s);
  s=await a.act({id:id(),type:'select',heroId:'student:register-warrior',encounterId:s.encounterId,expectedRevision:s.revision});
  const kill={id:id(),type:'answer',outcome:'correct',turnId:s.pending.id,encounterId:s.encounterId};
  const victories=await Promise.all([a.act(kill),b.act(kill)]);
  assert.deepEqual(victories[0],victories[1]);assert.equal(victories[0].rewards.length,4);
  assert.equal(victories[0].heroes.reduce((n,h)=>n+h.inventory.reduce((q,i)=>q+i.quantity,0),0),15);
  const xp=victories[0].heroes.map(h=>h.xp);
  assert.deepEqual((await a.act(kill)).heroes.map(h=>h.xp),xp);
  assert.equal([...db.data.keys()].filter(path=>path.endsWith('/actions/'+kill.id)).length,1);
});

const auto = (s, role = 'warrior', extra = {}) => {
  const spinId=id();
  return C.reduce(s,{type:'auto',id:spinId,spinId,points:1,encounterId:s?.encounterId,expectedRevision:s?.revision,heroId:'student:register-'+role,heroes,bossId:'goblin',...extra});
};
test('an awarded answer starts an encounter and resolves chosen skill and boss reply atomically',()=>{
  const spinId=id(), action={type:'auto',id:spinId,spinId,points:1,heroId:heroes[0].id,heroes,bossId:'goblin'};
  const s=C.reduce(null,action), repeat=C.reduce(null,action);
  assert.deepEqual(s,repeat);assert.equal(s.revision,1);assert.equal(s.pending,null);assert.equal(s.correctCount,1);
  assert.equal(s.lastEvent.type,'auto');assert.equal(s.lastEvent.skillId,'warrior-power-strike');assert.ok(s.lastEvent.damage>0);
  assert.equal(s.bossTurns,1);assert.ok(s.lastEvent.enemy.targets.length>0);assert.equal(s.heroes[0].xp,12);
  assert.equal(C.reduce(s,action),s);
  assert.ok(C.reduce(null,{...action,spinId:id()}).lastEvent.damage>0);
  assert.throws(()=>C.reduce(s,{...action,id:id(),spinId:'bad'}),/saved wheel spin/);
});
test('Quick fight rejects missing, fractional, zero, negative and excessive point awards without mutation',()=>{
  const state=start('goblin'), before=structuredClone(state);
  for (const points of [undefined,null,'1',0,-1,.5,10001,Infinity,NaN,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(()=>auto(state,'warrior',{points}),/Award between 1 and 10000 whole points/);
    assert.deepEqual(state,before);
  }
  assert.equal(auto(state,'warrior',{points:10000}).lastEvent.points,10000);
});
test('awarded points multiply the rounded hero hit while enemy power, MP cost and XP remain one turn',()=>{
  const state=start('goblin'), awardId=id(), spinId=id();state.bossHp=state.bossMaxHp=10000;
  const one=auto(state,'warrior',{id:awardId,spinId,points:1});
  const five=auto(state,'warrior',{id:awardId,spinId,points:5});
  assert.equal(five.lastEvent.damage,one.lastEvent.damage*5);
  assert.deepEqual(five.lastEvent.enemy,one.lastEvent.enemy);
  assert.equal(five.heroes[0].mp,one.heroes[0].mp);
  assert.equal(five.heroes[0].xp,12);assert.equal(one.heroes[0].xp,12);
  assert.equal(five.correctCount,state.correctCount+1);
  assert.equal(five.lastEvent.points,5);assert.equal(five.lastEvent.spinId,spinId);
  assert.equal(five.lastAutoAwardId,awardId);
});
test('distinct awards can reward the same spin, but retrying an award never repeats a turn',()=>{
  const spinId=id(), awardId=id();
  // A boss survives both awards so this isolates receipt/XP behavior from victory loot.
  const first=auto(null,'warrior',{id:awardId,spinId,bossId:'dragon'});
  assert.equal(auto(first,'warrior',{id:awardId,spinId}),first);
  const second=auto(first,'warrior',{id:id(),spinId,points:2});
  assert.equal(second.lastAutoSpinId,spinId);assert.notEqual(second.lastAutoAwardId,awardId);
  assert.equal(second.heroes[0].xp,24);assert.equal(second.correctCount,2);
  assert.equal(second.bossTurns,2);assert.equal(second.revision,first.revision+1);
  assert.equal(auto(second,'warrior',{id:second.lastAutoAwardId,spinId,points:2}),second);
});
test('point scaling cannot be injected into a manual answer payload or reducer arguments',()=>{
  const state=apply(start(),'select',{heroId:heroes[0].id});
  const action={id:id(),type:'answer',encounterId:state.encounterId,turnId:state.pending.id,outcome:'correct'};
  assert.deepEqual(C.reduce(state,{...action,points:10000,multiplier:10000,powerMultiplier:10000},10000),C.reduce(state,action));
});
test('awarded points scale healing and shields with health caps and poison damage without extra duration',()=>{
  const wounded=start('goblin');wounded.heroes.forEach(h=>h.hp=1);
  const spinId=id(), awardId=id(), options={id:awardId,spinId};
  const one=auto(wounded,'cleric',{...options,points:1}), two=auto(wounded,'cleric',{...options,points:2});
  assert.equal(one.lastEvent.skillId,'cleric-healing-light');
  for (const healed of one.lastEvent.healed) assert.equal(two.lastEvent.healed.find(h=>h.heroId===healed.heroId).amount,healed.amount*2);
  const full=auto(wounded,'cleric',{...options,points:10000});
  assert.ok(full.heroes.every(h=>h.hp<=h.stats.maxHp));
  const shieldState=unlock(start('goblin'),'cleric','cleric-sanctuary');
  const shieldOne=auto(shieldState,'cleric',{...options,points:1}),shieldFive=auto(shieldState,'cleric',{...options,points:5});
  assert.equal(shieldOne.lastEvent.skillId,'cleric-sanctuary');
  // The enemy targets the first hero, so inspect an untouched teammate's shield.
  assert.equal(shieldFive.heroes[1].shield,shieldOne.heroes[1].shield*5);
  const shieldCap=auto(shieldState,'cleric',{...options,points:10000});
  assert.equal(shieldCap.heroes[1].shield,shieldCap.heroes[1].stats.maxHp);
  const poisonState=unlock(start('lich'),'ranger','ranger-venom-arrow');poisonState.heroes[1].cooldowns['ranger-twin-arrow']=1;
  const poisonOne=auto(poisonState,'ranger',{...options,points:1}),poisonTwo=auto(poisonState,'ranger',{...options,points:2});
  assert.equal(poisonOne.lastEvent.skillId,'ranger-venom-arrow');
  assert.equal(poisonTwo.poison.damage,poisonOne.poison.damage*2);assert.equal(poisonTwo.poison.turns,poisonOne.poison.turns);
  assert.equal(poisonTwo.lastEvent.enemy.poisonDamage,poisonOne.lastEvent.enemy.poisonDamage*2);
});
test('automatic decisions heal injured allies, choose damage otherwise, honor MP and cooldowns',()=>{
  let s=start('goblin'); const cleric=s.heroes[3];
  assert.deepEqual(C.chooseAutoCommand(s,cleric),{command:'attack'});
  s.heroes[1].hp=1;
  assert.equal(C.chooseAutoCommand(s,cleric).skillId,'cleric-healing-light');
  let resolved=auto(s,'cleric');assert.ok(resolved.lastEvent.healed.some(h=>h.heroId===s.heroes[1].id));
  assert.equal(resolved.lastEvent.skillId,'cleric-healing-light');
  const w=s.heroes[0];w.learnedSkills.push('warrior-rampage','warrior-earthshatter');w.mp=45;
  assert.equal(C.chooseAutoCommand(s,w).skillId,'warrior-rampage');
  w.cooldowns['warrior-rampage']=1;assert.equal(C.chooseAutoCommand(s,w).skillId,'warrior-earthshatter');
  w.mp=0;assert.deepEqual(C.chooseAutoCommand(s,w),{command:'attack'});
  resolved=auto(s);assert.equal(resolved.lastEvent.command,'attack');assert.equal(resolved.heroes[0].mp,10);assert.equal(resolved.heroes[0].cooldowns['warrior-rampage'],0);
});
test('quick mode never overwrites a manual pending answer; end encounter clears it without loot',()=>{
  const s=apply(start(),'select',{heroId:heroes[0].id});
  assert.throws(()=>auto(s),/manual battle answer/);
  const finished=apply(s,'end');assert.equal(finished.status,'defeat');assert.equal(finished.pending,null);assert.equal(finished.rewards.length,0);
  const next=auto(finished);assert.equal(next.status,'active');assert.notEqual(next.encounterId,finished.encounterId);
  assert.equal(next.correctCount,1);assert.equal(next.revision,finished.revision+1);
});
test('quick victory rewards all heroes once, skips enemy reply, and carries progress to next awarded answer',async()=>{
  const db=database(), config={db,teacherId:'teacher',classId:'Quick fight',canWrite:()=>true}, a=Store.create(config), b=Store.create(config);
  let s=await a.act({id:id(),type:'start',bossId:'goblin',heroes});s.bossHp=1;s.heroes[1].hp=0;db.data.set(a.ref.path,s);
  const spinId=id(), action={type:'auto',id:spinId,spinId,points:1,encounterId:s.encounterId,expectedRevision:s.revision,heroId:heroes[0].id,heroes,bossId:'goblin'};
  const results=await Promise.all([a.act(action),b.act(action)]);
  assert.deepEqual(results[0],results[1]);s=results[0];assert.equal(s.status,'victory');assert.equal(s.lastEvent.enemy,null);
  assert.equal(s.rewards.length,4);assert.ok(s.heroes[1].xp>0);assert.equal(s.bossTurns,0);
  const total=s.heroes.reduce((n,h)=>n+h.inventory.reduce((sum,i)=>sum+i.quantity,0),0);
  assert.equal(total,16);const xp=s.heroes[0].xp;
  const next=auto(s);assert.equal(next.heroes[0].xp,xp+12);assert.equal(next.heroes.reduce((n,h)=>n+h.inventory.reduce((sum,i)=>sum+i.quantity,0),0),total);
  assert.deepEqual(await b.act(action),s);
});
test('UID claims and mistaken-claim corrections preserve roster hero progress, pending turns and rewards',()=>{
  let s=start();s.heroes[0].xp=225;s.heroes[0].level=3;s.heroes[0].skillPoints=5;
  s.heroes[0].learnedSkills.push('warrior-cleave');s.heroes[0].inventory.push({id:'bag:void-edge',itemId:'void-edge',quantity:1});s.heroes[0].equipped='bag:void-edge';
  s.heroes[0].id='uid:old-account';s.pending={id:'pending-claim',heroId:'uid:old-account'};s.lastEvent={id:id(),type:'select',heroId:'uid:old-account',healed:[],targets:[]};
  const roster=heroes.map(h=>({...h}));roster[0].uid='new-account';
  const synced=apply(s,'sync',{heroes:roster});const h=synced.heroes[0];
  assert.equal(h.id,'student:register-warrior');assert.equal(h.uid,'new-account');assert.equal(h.xp,225);assert.equal(h.level,3);assert.equal(h.equipped,'bag:void-edge');
  assert.ok(h.learnedSkills.includes('warrior-cleave'));assert.equal(synced.pending.heroId,h.id);
  const resolved=apply(synced,'answer',{turnId:'pending-claim',outcome:'correct'});assert.equal(resolved.heroes[0].xp,237);
  const afterClaim=C.heroFromStudent({id:'register-warrior',uid:'third-account',name:'warrior'});
  const corrected=apply(resolved,'sync',{heroes:[afterClaim,...heroes.slice(1)]});assert.equal(corrected.heroes[0].xp,237);
});
