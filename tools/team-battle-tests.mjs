import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const C=createRequire(import.meta.url)('../battle-core.js');
let n=0;const id=()=>`formation-action-${++n}`;
const roster=()=>['warrior','mage','cleric','ranger'].map((role,i)=>C.heroFromStudent({id:role,name:role},null,i===1?2:i===2?3:i===3?1:0));
function start(formation='3v3'){return C.reduce(null,{type:'start',id:id(),formation,heroes:roster()});}
function cast(state,skillId,targetId,enemyTargetId){state=C.reduce(state,{type:'select',id:id(),encounterId:state.encounterId,expectedRevision:state.revision,heroId:state.heroes[0].id});return C.reduce(state,{type:'answer',id:id(),encounterId:state.encounterId,turnId:state.pending.id,outcome:'correct',command:skillId?'skill':'attack',skillId,targetId,enemyTargetId});}
function boss(state){return C.reduce(state,{type:'boss',id:id(),encounterId:state.encounterId,expectedRevision:state.revision,ultimate:state.charge>=C.bossById(state.bossId).chargeMax,timing:.5});}
function quiet(state){state.adventure={kind:'enemy',resolved:true};state.heroes.slice(1).forEach(h=>{h.hp=0;});return state;}
test('random encounters save 25% 2v2 and 15% 3v3, respect roster sizes and preserve old raids',()=>{
 const counts={1:0,2:0,3:0};for(let i=0;i<2000;i++){const s=start('auto');counts[s.teamSize || 1]++;assert.equal(s.bossHp,s.bossMaxHp);if(s.enemies){assert.equal(s.enemies.length,s.teamSize);assert.equal(new Set(s.enemies.map(e=>e.id)).size,s.teamSize);assert.equal(s.enemies.reduce((n,e)=>n+e.maxHp,0),s.bossMaxHp);}}
 assert.ok(Math.abs(counts[2]/2000-.25)<.04);assert.ok(Math.abs(counts[3]/2000-.15)<.04);
 const raid=start('raid');assert.equal(raid.enemies,undefined);assert.equal(C.normalizeState(raid).enemies,undefined);
 assert.throws(()=>C.reduce(null,{type:'start',id:id(),heroes:roster().slice(0,1),formation:'2v2'}),/enough/);
});
test('all active learnable and relic skills declare targeting, including hybrid and focused healing',()=>{
 const all=[...Object.values(C.SKILLS).flat(),...Object.values(C.JOB_SKILLS).flat(),...C.ITEM_SKILLS];
 for(const s of all){assert.ok(['passive','single','aoe'].includes(s.targeting),s.id);if(s.effect.power || s.effect.damage)assert.ok(s.damageTarget);if(s.effect.heal || s.effect.healAll)assert.ok(s.healTarget);}
 assert.equal(C.skillById('warrior-cleave').damageTarget,'aoe');assert.equal(C.skillById('warrior-power-strike').damageTarget,'single');assert.equal(C.skillById('cleric-healing-light').healTarget,'single');assert.equal(C.skillById('cleric-renewal').healTarget,'aoe');assert.match(C.targetingLabel(C.skillById('mage-supernova')),/AoE damage.*AoE healing/);
});
test('single-target and AoE attacks damage separate saved enemy HP, spend MP once and obey each enemy cap',()=>{
 for(const skill of ['warrior-power-strike','warrior-cleave']){
  let s=quiet(start());s.heroes[0].learnedSkills.push(skill);const mp=s.heroes[0].mp,before=structuredClone(s);
  const next=cast(s,skill,undefined,s.enemies[1].id),action=next.lastEvent.actions[0];assert.deepEqual(s,before);
  assert.equal(action.enemyTargets.length,skill==='warrior-cleave'?3:1);if(skill==='warrior-power-strike')assert.equal(action.enemyTargets[0].enemyId,s.enemies[1].id);
  assert.equal(next.heroes[0].mp,mp-C.skillById(skill).mpCost);assert.equal(next.heroes[0].cooldowns[skill],C.skillById(skill).cooldown);
  for(const t of action.enemyTargets)assert.ok(t.damage<=Math.round(s.enemies.find(e=>e.id===t.enemyId).maxHp*.25));
  assert.equal(next.bossHp,next.enemies.reduce((n,e)=>n+e.hp,0));assert.deepEqual(C.normalizeState(JSON.parse(JSON.stringify(next))).enemies,next.enemies);
 }
});
test('one correct answer runs teammates together once; incorrect and skipped answers launch none',()=>{
 const s=start(),next=cast(s);assert.equal(next.lastEvent.actions.length,3);assert.equal(next.correctCount,1);assert.equal(new Set(next.lastEvent.actions.map(a=>a.heroId)).size,3);
 for(const outcome of ['incorrect','skip']){const p=C.reduce(s,{type:'select',id:id(),encounterId:s.encounterId,expectedRevision:s.revision,heroId:s.heroes[0].id});const a={type:'answer',id:id(),turnId:p.pending.id,encounterId:s.encounterId,outcome};const x=C.reduce(p,a);assert.equal(x.bossHp,s.bossHp);assert.equal(x.lastEvent.actions,undefined);assert.throws(()=>C.reduce(x,a),/already resolved/);}
});
test('boss squads attack together, AoE targets active students, and defeated enemies cannot act',()=>{
 let s=start();const reserve=s.heroes.find(h=>!s.teamHeroIds.includes(h.id)),hp=reserve.hp;
 s.enemies[1].hp=0;s.bossHp=s.enemies.reduce((n,e)=>n+e.hp,0);const next=boss(s);
 assert.equal(next.lastEvent.actions.length,2);assert.ok(next.lastEvent.actions.some(a=>a.targeting==='aoe'));assert.equal(next.heroes.find(h=>h.id===reserve.id).hp,hp);
 assert.ok(next.lastEvent.targets.every(t=>s.teamHeroIds.includes(t.heroId)));assert.ok(!next.lastEvent.actions.some(a=>a.enemyId===s.enemies[1].id));
});
test('focused healing restores one chosen ally, AoE heals the whole active team and leaves reserves unchanged',()=>{
 for(const skill of ['cleric-healing-light','cleric-renewal']){
  let s=start();s.heroes.unshift(s.heroes.splice(2,1)[0]);s.heroes.forEach(h=>{h.hp=1;h.mp=0;});s.heroes[0].mp=100;s.heroes[0].learnedSkills.push(skill);
  const next=cast(s,skill,s.heroes[1].id),a=next.lastEvent.actions[0];assert.equal(a.healed.length,skill==='cleric-healing-light'?1:3);if(skill==='cleric-healing-light')assert.equal(a.healed[0].heroId,s.heroes[1].id);
  const reserve=next.heroes.find(h=>!next.teamHeroIds.includes(h.id));assert.equal(reserve.hp,1);
 }
});
test('auto skill selection favours AoE against groups and AoE healing for several injured allies',()=>{
 const s=start(),h=s.heroes[0];h.learnedSkills.push('warrior-cleave');assert.equal(C.chooseAutoCommand(s,h).skillId,'warrior-cleave');
 const c=s.heroes[2];c.learnedSkills.push('cleric-renewal');C.combatHeroes(s).forEach(h=>{h.hp=1;});assert.equal(C.chooseAutoCommand(s,c).skillId,'cleric-renewal');
});
test('rune bonus roll is 50%, deterministic, additional to ordinary loot and never grants duplicate XP',()=>{
 let bonuses=0;const seen=new Set();for(let i=0;i<600;i++){
  let s=start('raid');s.adventure={kind:'enemy',resolved:true};const before=structuredClone(s),a={type:'summon',id:id(),source:'teacher',encounterId:s.encounterId,expectedRevision:s.revision};const win=C.reduce(s,a);
  const runes=win.rewards.filter(r=>r.source==='bonus-rune');bonuses+=runes.length;
  assert.equal(win.rewards.filter(r=>!r.source).length,s.heroes.length);for(const r of runes){assert.equal(C.itemById(r.itemId).type,'rune');assert.equal(r.xp,0);seen.add(r.rarity);assert.ok(win.heroes.find(h=>h.id===r.heroId).inventory.some(e=>e.itemId===r.itemId));}
  assert.deepEqual(win,C.reduce(s,a));assert.deepEqual(s,before);assert.throws(()=>C.reduce(win,a),/finished/);
 }
 assert.ok(Math.abs(bonuses/2400-.5)<.04);assert.ok(seen.has('common') && seen.has('rare'));
});
test('summon ends every enemy, awards exactly once and preserves team state on reload',()=>{
 const s=start(),a={type:'summon',id:id(),source:'teacher',encounterId:s.encounterId,expectedRevision:s.revision},win=C.reduce(s,a);assert.equal(win.status,'victory');assert.ok(win.enemies.every(e=>e.hp===0));assert.equal(win.bossHp,0);assert.deepEqual(C.normalizeState(JSON.parse(JSON.stringify(win))).enemies,win.enemies);
});
test('team enemy rotation rolls across rounds without duplicate squad members or losing saved progress',()=>{
 let s=null;const observed=new Set();for(let i=0;i<80;i++){
  const before=s; s=C.reduce(s,{type:'start',id:id(),expectedRevision:s?.revision,formation:'3v3',heroes:roster()});
  assert.equal(new Set(s.enemies.map(e=>e.id)).size,3);
  s.enemies.forEach(e=>observed.add(e.id));
  assert.deepEqual(C.normalizeState(s).bossRotation,s.bossRotation);
  if(before && before.bossRotation.round===s.bossRotation.round)assert.equal(s.bossRotation.seen.length,before.bossRotation.seen.length+3);
 }
 assert.equal(observed.size,100);
});
