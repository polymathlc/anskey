import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),C=require('../battle-core.js');
const roles=Object.keys(C.ROLES);
function hero(role='warrior',level=15) {
  const h=C.heroFromStudent({id:'progression-'+role,name:role},null,roles.indexOf(role));
  h.xp=C.xpForLevel(level);h.level=level;h.skillPoints=100;
  return C.cleanHero(h,h);
}
function advanced(jobId,level=26) {return C.configureHero(hero(C.JOBS[jobId].role,level),{command:'advance',jobId});}
let sequence=0;
const id=()=>`progression-${String(++sequence).padStart(8,'0')}`;
function stateWith(h,bossId='mossback') {
  let s=C.reduce(null,{type:'start',id:id(),bossId,heroes:[h]});
  s.heroes=[structuredClone(h)];s.bossHp=s.bossMaxHp=100000;
  return s;
}
const act=(s,type,more={})=>C.reduce(s,{id:id(),type,encounterId:s.encounterId,expectedRevision:s.revision,...more});
function cast(s,skillId) {const selected=act(s,'select',{heroId:s.heroes[0].id});return act(selected,'answer',{turnId:selected.pending.id,outcome:'correct',command:'skill',skillId});}

test('eight advanced jobs each have three independent four-tier branches and unique animation IDs',()=>{
  assert.equal(Object.keys(C.JOBS).length,8);
  const all=[...Object.values(C.SKILLS).flat(),...Object.values(C.JOB_SKILLS).flat()];
  assert.equal(all.length,144);assert.equal(new Set(all.map(s=>s.animation)).size,144);
  roles.forEach(role=>assert.equal(C.jobsFor(hero(role)).length,2));
  for (const job of Object.values(C.JOBS)) {
    const skills=C.JOB_TREES[job.id];assert.equal(skills.length,12);assert.equal(new Set(skills.map(s=>s.branch)).size,3);
    for (const skill of skills) {
      assert.equal(skill.role,job.role);assert.equal(skill.job,job.id);assert.equal(skill.level,[15,18,22,26][skill.tier-1]);
      assert.equal(skill.cost,[2,2,3,3][skill.tier-1]);assert.ok(skill.description && skill.animation && Object.keys(skill.effect).length>1);
      assert.equal(skill.requires.length,skill.tier===1?0:1);
      if(skill.tier>1){const parent=C.skillById(skill.requires[0]);assert.equal(parent.job,job.id);assert.equal(parent.branch,skill.branch);assert.equal(parent.tier,skill.tier-1);}
    }
  }
});

test('advancement requires earned level 15 and the matching base class, preserving the profile',()=>{
  const low=hero('warrior',14);low.level=50;
  assert.equal(C.canAdvance(low,'paladin').ok,false);
  assert.throws(()=>C.configureHero(low,{command:'advance',jobId:'paladin'}),/level 15/);
  assert.throws(()=>C.configureHero(hero('mage'),{command:'advance',jobId:'paladin'}),/base class/);
  const before=hero();before.hp=23;before.mp=7;
  const next=C.configureHero(before,{command:'advance',jobId:'paladin'});
  assert.equal(next.role,'warrior');assert.equal(next.job,'paladin');assert.equal(next.xp,before.xp);assert.equal(next.skillPoints,before.skillPoints);
  assert.deepEqual(next.inventory,before.inventory);assert.equal(next.hp,23);assert.equal(next.mp,7);
  assert.ok(next.learnedSkills.includes('warrior-power-strike'));assert.ok(next.learnedSkills.includes('paladin-radiant-cut'));
  assert.equal(C.canAdvance(next,'paladin').ok,false);
  assert.equal(C.treeSkills(next).length,12);assert.equal(C.treeSkills(next,'base'),C.SKILLS.warrior);
  assert.equal(C.skillsFor(next).length,24);
});

test('switching jobs keeps learned skills dormant and job bonuses cannot leak across base classes',()=>{
  let h=advanced('paladin');h=C.configureHero(h,{command:'learn',skillId:'paladin-sun-forged'});
  const paladinDamage=h.stats.damage;
  h=C.configureHero(h,{command:'advance',jobId:'berserker'});
  assert.ok(h.learnedSkills.includes('paladin-sun-forged'));assert.ok(h.learnedSkills.includes('paladin-radiant-cut'));
  assert.ok(!C.availableSkills(h).some(s=>s.job==='paladin'));
  assert.equal(h.stats.damage,C.ROLES.warrior.power+25*3+C.JOBS.berserker.bonuses.damage);
  assert.throws(()=>cast(stateWith(h),'paladin-radiant-cut'),/Learn/);
  h=C.configureHero(h,{command:'advance',jobId:'paladin'});assert.equal(h.stats.damage,paladinDamage);
  h=C.configureHero(h,{command:'class',role:'mage'});assert.equal(h.job,undefined);assert.ok(h.learnedSkills.includes('paladin-sun-forged'));
  assert.equal(h.stats.damage,C.ROLES.mage.power+25*3);assert.ok(C.skillsFor(h).every(s=>s.role==='mage' && !s.job));
});

test('canonical cleanup removes invalid, wrong-role and under-level jobs',()=>{
  for(const [role,level,job] of [['warrior',14,'paladin'],['mage',15,'paladin'],['warrior',15,'unknown']]) {
    const h=hero(role,level);h.job=job;h.stats.damage=999999;
    const cleaned=C.cleanHero(h,h);assert.equal(cleaned.job,undefined);assert.ok(cleaned.stats.damage<999999);
  }
});

test('advanced skill prerequisites, levels and points are enforced without losing base skills',()=>{
  let h=advanced('archmage',15);
  assert.equal(C.canLearn(h,'chronomancer-quickening').ok,false);
  assert.equal(C.canLearn(h,'archmage-living-flame').ok,false);
  assert.throws(()=>C.configureHero(h,{command:'learn',skillId:'archmage-living-flame'}),/level 18/);
  h.xp=C.xpForLevel(26);h=C.cleanHero(h,h);
  assert.throws(()=>C.configureHero(h,{command:'learn',skillId:'archmage-sun-collapse'}),/preceding/);
  for(const skillId of ['archmage-living-flame','archmage-eruption','archmage-sun-collapse'])h=C.configureHero(h,{command:'learn',skillId});
  assert.equal(h.skillPoints,92);assert.ok(C.availableSkills(h).some(s=>s.id==='mage-firebolt'));
  assert.ok(C.availableSkills(h).some(s=>s.id==='archmage-sun-collapse'));
  assert.throws(()=>cast(stateWith(h),'archmage-living-flame'),/Learn/);
  h.skillPoints=0;assert.equal(C.canLearn(h,'archmage-frost-nova').ok,false);
});

test('every advanced active skill executes real effects and spends its configured mana',()=>{
  for(const job of Object.values(C.JOBS)) {
    let h=advanced(job.id);h.learnedSkills.push(...C.JOB_SKILLS[job.id].map(s=>s.id));h=C.cleanHero(h,h);
    for(const skill of C.JOB_SKILLS[job.id].filter(s=>!s.passive)) {
      const s=stateWith(h);s.heroes[0].hp=1;s.heroes[0].mp=s.heroes[0].stats.maxMp;s.heroes[0].weakened=true;
      s.heroes[0].cooldowns['dummy-skill']=5;
      const next=cast(s,skill.id),event=next.lastEvent,after=next.heroes[0];
      assert.equal(event.skillId,skill.id);assert.equal(after.mp,Math.min(after.stats.maxMp,s.heroes[0].mp-skill.mpCost+(skill.effect.manaAll || 0)));
      assert.equal(after.cooldowns[skill.id],skill.cooldown);
      if(skill.effect.power)assert.ok(event.damage>0,skill.id);
      if(skill.effect.healAll)assert.ok(event.healed.some(e=>e.amount>0),skill.id);
      if(skill.effect.shield || skill.effect.shieldSelf)assert.ok(after.shield>0,skill.id);
      if(skill.effect.weakenBoss)assert.equal(next.bossWeakness,skill.effect.weakenBoss);
      if(skill.effect.poison)assert.equal(next.poison.turns,skill.effect.poison);
      if(skill.effect.haste)assert.equal(after.cooldowns['dummy-skill'],Math.max(0,4-skill.effect.haste));
    }
  }
});

test('automatic commands consider learned active-job abilities but never dormant-job skills',()=>{
  let h=advanced('archmage');h.learnedSkills.push(...C.JOB_SKILLS.archmage.map(s=>s.id));h=C.cleanHero(h,h);
  let s=stateWith(h),command=C.chooseAutoCommand(s,h);assert.ok(command.skillId.startsWith('archmage-'));
  h=C.configureHero(h,{command:'advance',jobId:'chronomancer'});s=stateWith(h);command=C.chooseAutoCommand(s,h);
  assert.ok(!command.skillId.startsWith('archmage-'));assert.ok(C.availableSkills(h).some(s=>s.job==='chronomancer'));
});

function put(h,itemId) {h.inventory.push({id:'bag:'+itemId,itemId,quantity:1});}
test('automatic equipment selects the highest rarity equipment, preserves ties and ignores consumables',()=>{
  const h=hero();put(h,'iron-charm');put(h,'starbomb');put(h,'storm-quiver');put(h,'moon-codex');
  assert.equal(C.autoEquip(h),'storm-quiver');assert.equal(h.equipped,'bag:storm-quiver');
  const inventory=structuredClone(h.inventory);assert.equal(C.autoEquip(h),null);assert.deepEqual(h.inventory,inventory);
  h.equipped='bag:moon-codex';assert.equal(C.autoEquip(h),null);assert.equal(h.equipped,'bag:moon-codex');
  put(h,'void-edge');assert.equal(C.autoEquip(h),'void-edge');assert.equal(h.equipped,'bag:void-edge');
  put(h,'phoenix-crown');assert.equal(C.autoEquip(h),null);assert.equal(h.equipped,'bag:void-edge');
  const empty=hero();assert.equal(C.autoEquip(empty),null);assert.equal(empty.equipped,null);
});

test('auto-equipping HP or MP gear cannot heal, refill mana or revive fallen heroes',()=>{
  for(const hp of [0,17]) {
    const h=hero();h.hp=hp;h.mp=3;put(h,'worldroot');C.autoEquip(h);
    assert.equal(h.hp,hp);assert.equal(h.mp,3);assert.ok(h.stats.maxHp>hero().stats.maxHp);
    put(h,'chronicle');C.autoEquip(h);assert.equal(h.hp,hp);assert.equal(h.mp,3);
  }
});

test('victory equips each heroes highest-rarity collected gear and announces changes once',()=>{
  const h=hero();put(h,'void-edge');let s=stateWith(h,'goblin');s.bossHp=1;
  const selected=act(s,'select',{heroId:h.id});const next=act(selected,'answer',{turnId:selected.pending.id,outcome:'correct'});
  assert.equal(next.status,'victory');assert.equal(next.heroes[0].equipped,'bag:void-edge');
  assert.equal(next.rewards[0].autoEquipped,'void-edge');assert.equal(next.rewards[0].autoEquippedName,'Void Edge');
  assert.throws(()=>act(next,'answer',{turnId:selected.pending.id,outcome:'correct'}),/finished/);
});

test('assist XP is an immutable capped progression grant with normal level-up skill points',()=>{
  const h=hero('ranger',14);h.xp=C.xpForLevel(15)-4;h.hp=0;h.mp=2;
  const before=structuredClone(h),next=C.grantAssistXp(h,6);
  assert.deepEqual(h,before);assert.equal(next.level,15);assert.equal(next.xp,before.xp+6);assert.equal(next.skillPoints,before.skillPoints+2);
  assert.equal(next.hp,0);assert.equal(next.mp,2);assert.equal(C.canAdvance(next,'sharpshooter').ok,true);
  for(const amount of [0,-1,.5,1001,Infinity])assert.throws(()=>C.grantAssistXp(h,amount),/Invalid/);
});

test('legacy encounters receive real enemy mana and ultimate spend appears in combat events',()=>{
  const s=stateWith(hero());delete s.bossMp;delete s.bossMaxMp;
  const normalized=C.normalizeState(s);assert.equal(normalized.bossMp,60);assert.equal(normalized.bossMaxMp,60);
  normalized.charge=C.bossById(normalized.bossId).chargeMax;
  const next=act(normalized,'boss',{ultimate:true});assert.equal(next.bossMp,30);
  assert.equal(next.lastEvent.manaBefore,60);assert.equal(next.lastEvent.manaAfter,30);assert.equal(next.lastEvent.manaCost,30);
  const restored=act(next,'boss');assert.equal(restored.bossMp,45);assert.equal(restored.lastEvent.manaRestored,15);
});

test('a charged enemy without enough MP can recover using normal attacks and then cast',()=>{
  let s=stateWith(hero());s.charge=C.bossById(s.bossId).chargeMax;s.bossMp=0;
  assert.throws(()=>act(s,'boss',{ultimate:true}),/enemy MP/);
  s=act(s,'boss');assert.equal(s.bossMp,15);assert.equal(s.charge,C.bossById(s.bossId).chargeMax);
  s=act(s,'boss');assert.equal(s.bossMp,30);assert.throws(()=>act(s,'boss'),/Ultimate is ready/);
  s=act(s,'boss',{ultimate:true});assert.equal(s.bossMp,0);assert.equal(s.charge,0);
});

test('Quick fight uses a normal enemy response when a charged enemy has insufficient mana',()=>{
  let s=stateWith(hero());s.charge=C.bossById(s.bossId).chargeMax;s.bossMp=0;
  s=act(s,'auto',{spinId:'wheel-mana-test',points:1,heroId:s.heroes[0].id});
  assert.equal(s.lastEvent.enemy.ultimate,false);assert.equal(s.bossMp,15);assert.equal(s.lastEvent.enemy.manaRestored,15);
});


test('advanced job changes are blocked inside an active encounter even without a pending answer',()=>{
  const h=hero(),s=stateWith(h);
  assert.throws(()=>act(s,'sync',{command:'advance',heroId:h.id,jobId:'paladin'}),/End the active encounter/);
  const ended=act(s,'end');
  const upgraded=act(ended,'sync',{command:'advance',heroId:h.id,jobId:'paladin'});
  assert.equal(upgraded.heroes[0].job,'paladin');
});

test('advanced healing bonuses improve restorative skills for non-cleric jobs',()=>{
  const h=advanced('paladin'),s=stateWith(h);h.learnedSkills.push('paladin-mercy-bell');s.heroes[0]=h;s.heroes[0].hp=1;
  const next=cast(s,'paladin-mercy-bell');
  const heal=next.lastEvent.healed.reduce((sum,e)=>sum+e.amount,0);
  assert.ok(heal>Math.round(h.stats.maxHp*.24));
});


test('saved skill support reports only actual mana, shield, cleanse and cooldown recipients',()=>{
  let h=advanced('chronomancer');h.learnedSkills.push('chronomancer-borrowed-hours','chronomancer-time-surge');h.mp=h.stats.maxMp-40;
  h.cooldowns['mage-firebolt']=3;
  let s=stateWith(h),next=cast(s,'chronomancer-time-surge'),event=next.lastEvent;
  assert.ok(event.supported.some(e=>e.heroId===h.id&&e.effect==='mana'&&e.amount===15));
  assert.ok(event.supported.some(e=>e.effect==='haste'&&e.amount===2));
  h=advanced('paladin');h.learnedSkills.push('paladin-oath-shield');h.shield=h.stats.maxHp;
  next=cast(stateWith(h),'paladin-oath-shield');assert.ok(!(next.lastEvent.supported || []).some(e=>e.effect==='shield'));
  assert.ok(next.lastEvent.afflicted.some(e=>e.effect==='weaken'&&e.amount===.2));
  h=advanced('hierophant');h.learnedSkills.push('hierophant-hallowed-ground');h.weakened=true;h.hp-=5;
  next=cast(stateWith(h),'hierophant-hallowed-ground');event=next.lastEvent;
  assert.ok(event.supported.some(e=>e.effect==='cleanse'&&e.amount===1));
  assert.ok(event.supported.some(e=>e.effect==='shield'&&e.amount>0));
  assert.ok(event.healed.some(e=>e.amount>0));
});
