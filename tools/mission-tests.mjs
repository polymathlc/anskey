import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),M=require('../mission-content.js'),C=require('../battle-core.js');
const hero=C.heroFromStudent({id:'alex',name:'Alex'});
let sequence=0;const id=()=>`mission-test-${++sequence}`;
const start=(previous=null,bossId='goblin')=>C.reduce(previous,{type:'start',id:id(),bossId,heroes:[hero],expectedRevision:previous?.revision});

test('mission machine has four objectives and exact 5/15 percent prize boundaries',()=>{
  assert.equal(M.OBJECTIVES.length,4);assert.equal(M.PRIZES.length,8);assert.equal(M.PRIZES.reduce((n,p)=>n+p.weight,0),100);
  assert.equal(M.roll(0,0).prize.id,'summon-chung');assert.equal(M.roll(0,.049999).prize.kind,'summon');
  assert.equal(M.roll(.25,.05).prize.id,'blooket-1');assert.equal(M.roll(.5,.94999).prize.id,'gimkit-3');assert.equal(M.roll(.99,.95).prize.id,'class-points');
  assert.equal(M.PRIZES.filter(p=>p.rare).length,2);
});
test('mission state remains separate, focus needs elapsed server time, and payouts complete once',()=>{
  const initial=M.empty(),started=M.start(initial,{id:id(),now:1000,objectiveRoll:.6,prizeRoll:.1});
  assert.equal(initial.current,null);assert.throws(()=>M.progress(started,{kind:'focus',now:1800999}),/timer/);
  const complete=M.progress(started,{kind:'focus',now:1801000});assert.equal(complete.current.status,'complete');assert.equal(complete.bank.length,1);
  assert.deepEqual(M.progress(complete,{kind:'focus',now:9999999}),complete);assert.throws(()=>M.start(started,{id:id(),now:2000,objectiveRoll:0,prizeRoll:0}),/cancel/);
});
test('correct streak resets on incorrect, assists do not count and next enemy binds a future encounter',()=>{
  let mission=M.start(null,{id:id(),now:1,objectiveRoll:.3,prizeRoll:0});
  for(let i=0;i<6;i++)mission=M.progress(mission,{kind:'correct',now:2});
  assert.equal(M.progress(mission,{kind:'assist',now:2}).current.progress,6);
  mission=M.progress(mission,{kind:'incorrect',now:3});assert.equal(mission.current.progress,0);
  for(let i=0;i<7;i++)mission=M.progress(mission,{kind:'correct',now:4});
  assert.equal(mission.summonTokens,1);assert.equal(mission.current.status,'complete');
  mission=M.start(mission,{id:id(),now:5,objectiveRoll:0,prizeRoll:.9});
  mission=M.progress(mission,{kind:'encounter',encounterId:'new-encounter',now:6});
  assert.equal(M.progress(mission,{kind:'victory',encounterId:'old-encounter',now:7}).current.status,'active');
  assert.equal(M.progress(mission,{kind:'victory',encounterId:'new-encounter',now:8}).current.status,'complete');
});
test('Chung defeats every enemy, ignores guard, clears pending and awards ordinary loot exactly once',()=>{
  for(const boss of C.BOSSES){
    const before=start(null,boss.id);before.guard=true;before.pending={id:id(),heroId:hero.id};const snapshot=structuredClone(before);
    const state=C.reduce(before,{type:'summon',id:id(),encounterId:before.encounterId,expectedRevision:before.revision,source:'teacher'});
    assert.equal(state.status,'victory');assert.equal(state.bossHp,0);assert.equal(state.lastEvent.damage,before.bossHp);assert.equal(state.pending,null);
    assert.equal(state.rewards.length,1);assert.equal(state.heroes[0].xp,boss.rewardXp||65);assert.deepEqual(before,snapshot);
    assert.throws(()=>C.reduce(state,{type:'summon',id:id(),encounterId:state.encounterId,expectedRevision:state.revision,source:'teacher'}),/finished/);
  }
});
test('combat history saves one combined automatic turn and survives later encounters',()=>{
  let state=start();state.bossHp=state.bossMaxHp=999999;
  const before=structuredClone(state);
  state=C.reduce(state,{type:'auto',id:id(),spinId:id(),heroId:hero.id,points:1,encounterId:state.encounterId,expectedRevision:state.revision});
  assert.equal(state.combatLog.length,1);const row=state.combatLog[0];assert.equal(row.actorName,'Alex');assert.equal(row.enemyName,C.bossById('goblin').name);
  assert.equal(row.damage,state.lastEvent.damage);assert.equal(row.enemy.move,state.lastEvent.enemy.move);assert.equal(row.enemy.targets[0].name,'Alex');assert.equal(row.targets.length,0);
  assert.deepEqual(before.combatLog,[]);
  const next=start(state);assert.deepEqual(next.combatLog,state.combatLog);
});
test('combat history retains named actual support and only the latest 40 rows',()=>{
  let state=start();
  for(let i=0;i<45;i++){
    state=C.reduce(state,{type:'select',id:id(),heroId:hero.id,encounterId:state.encounterId,expectedRevision:state.revision});
    state=C.reduce(state,{type:'answer',id:id(),turnId:state.pending.id,encounterId:state.encounterId,outcome:'incorrect'});
  }
  assert.equal(state.combatLog.length,40);assert.ok(state.combatLog.every(row=>row.move==='Incorrect answer'&&row.damage===0));
  const cleric=C.configureHero(state.heroes[0],{command:'class',role:'cleric'});state.heroes=[cleric];cleric.hp=5;
  state=C.reduce(state,{type:'select',id:id(),heroId:hero.id,encounterId:state.encounterId,expectedRevision:state.revision});
  state=C.reduce(state,{type:'answer',id:id(),turnId:state.pending.id,encounterId:state.encounterId,outcome:'correct',command:'skill',skillId:cleric.learnedSkills.find(s=>s.startsWith('cleric-'))});
  const row=state.combatLog.at(-1);assert.ok(row.healed[0].amount>0);assert.equal(row.healed[0].name,'Alex');assert.equal(row.healed[0].amount,state.lastEvent.healed[0].amount);
});
test('combat history records actual MP from equipment and basic attacks without overflowing maxima',()=>{
  let state=start();state.heroes.push(C.heroFromStudent({id:'sam',name:'Sam'}));
  let actor=state.heroes[0];actor.inventory.push({id:'bag:sovereign-star',itemId:'sovereign-star',quantity:1});actor.equipped='bag:sovereign-star';
  actor.mp=actor.stats.maxMp-3;state.heroes[1].mp=state.heroes[1].stats.maxMp-2;
  state=C.reduce(state,{type:'select',id:id(),heroId:hero.id,encounterId:state.encounterId,expectedRevision:state.revision});
  state=C.reduce(state,{type:'answer',id:id(),turnId:state.pending.id,encounterId:state.encounterId,outcome:'correct',command:'attack'});
  assert.deepEqual(state.combatLog.at(-1).supported.filter(s=>s.effect==='mana').map(s=>[s.name,s.amount]),[['Alex',3],['Sam',2]]);
  actor=state.heroes[0];actor.inventory.push({id:'bag:worldroot',itemId:'worldroot',quantity:1});actor.equipped='bag:worldroot';actor.mp=0;
  state=C.reduce(state,{type:'select',id:id(),heroId:hero.id,encounterId:state.encounterId,expectedRevision:state.revision});
  state=C.reduce(state,{type:'answer',id:id(),turnId:state.pending.id,encounterId:state.encounterId,outcome:'correct',command:'attack'});
  assert.deepEqual(state.combatLog.at(-1).supported.filter(s=>s.effect==='mana').map(s=>s.amount),[10,8]);
});
