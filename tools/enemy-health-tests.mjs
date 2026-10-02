import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),C=require('../battle-core.js');
let sequence=0;
const id=()=>`health-test-${++sequence}`;
const party=count=>Array.from({length:count},(_,i)=>C.heroFromStudent({id:'student-'+i,name:'Student '+i},null,i));
const start=(bossId='goblin',count=4)=>C.reduce(null,{type:'start',id:id(),bossId,heroes:party(count)});
function legacy(hp=701,max=1001){const state=start();delete state.enemyHealthVersion;state.bossHp=hp;state.bossMaxHp=max;return state;}

test('all 26 enemies start at half their former HP for small and large classes',()=>{
  assert.equal(C.BOSSES.length,26);
  for(const count of [1,4,15])for(const enemy of C.BOSSES){
    const state=start(enemy.id,count);
    const former=Math.round(Math.max(200,state.heroes.reduce((sum,h)=>sum+h.stats.damage,0)*4)*enemy.hpMultiplier);
    assert.equal(state.bossMaxHp,Math.ceil(former/2),`${enemy.id}, ${count} heroes`);
    assert.equal(state.bossHp,state.bossMaxHp);
    assert.equal(state.enemyHealthVersion,1);
  }
});

test('legacy active health halves once without changing pending answers or earned progress',()=>{
  const previous=legacy();previous.pending={id:id(),heroId:previous.heroes[0].id};
  previous.heroes[0].hp=17;previous.heroes[0].mp=9;previous.heroes[0].xp=42;
  previous.combatLog=[{id:id(),damage:300,move:'Earlier attack'}];
  const original=structuredClone(previous),next=C.rebalanceEnemyHealth(previous);
  assert.equal(next.bossMaxHp,501);assert.equal(next.bossHp,351);
  const expected={...original,bossMaxHp:501,bossHp:351,enemyHealthVersion:1};
  assert.deepEqual(next,expected);assert.deepEqual(previous,original);
  assert.equal(C.rebalanceEnemyHealth(next),next);
  assert.deepEqual(C.normalizeState(C.normalizeState(previous)),C.normalizeState(previous));
});

test('rounding cannot defeat a living enemy or revive a zero-HP enemy',()=>{
  assert.equal(C.rebalanceEnemyHealth(legacy(1,91)).bossHp,1);
  assert.equal(C.rebalanceEnemyHealth(legacy(0,91)).bossHp,0);
  assert.equal(C.rebalanceEnemyHealth(legacy(91,91)).bossHp,46);
  for(const status of ['victory','defeat']){
    const state=legacy();state.status=status;state.lootAwarded=true;
    assert.equal(C.rebalanceEnemyHealth(state),state);
  }
  assert.equal(C.rebalanceEnemyHealth(null),null);
});

test('a roster sync persists the health balance even when every hero is unchanged',()=>{
  const state=legacy(600,1000);
  const action={type:'sync',id:id(),encounterId:state.encounterId,expectedRevision:state.revision,heroes:state.heroes};
  const next=C.reduce(state,action);
  assert.equal(next.bossHp,300);assert.equal(next.bossMaxHp,500);assert.equal(next.revision,state.revision+1);
  assert.deepEqual(next.heroes,state.heroes);assert.deepEqual(next.rewards,state.rewards);
  assert.equal(C.reduce(next,{...action,id:id(),expectedRevision:next.revision}),next);
});

test('a pending manual answer consumes the reduced enemy HP without altering attack damage or rewards',()=>{
  const state=legacy(600,1000);state.pending={id:id(),heroId:state.heroes[0].id};
  const next=C.reduce(state,{type:'answer',id:id(),encounterId:state.encounterId,turnId:state.pending.id,outcome:'correct'});
  assert.equal(next.bossMaxHp,500);assert.equal(next.bossHp,300-next.lastEvent.damage);
  assert.equal(next.heroes[0].xp,state.heroes[0].xp+12);assert.equal(next.rewards.length,0);
});

test('automatic hero and enemy phases cannot apply the HP reduction twice',()=>{
  const state=legacy(600,1000),action={type:'auto',id:id(),spinId:id(),encounterId:state.encounterId,expectedRevision:state.revision,heroId:state.heroes[0].id,points:1};
  const next=C.reduce(state,action),alreadyBalanced=C.reduce(C.rebalanceEnemyHealth(state),action);
  assert.deepEqual(next,alreadyBalanced);assert.equal(next.bossMaxHp,500);
  assert.equal(next.bossHp,300-next.lastEvent.damage);assert.equal(next.rewards.length,0);
  assert.equal(C.reduce(next,action),next);
});
