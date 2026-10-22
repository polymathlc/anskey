import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),C=require('../battle-core.js');
let sequence=0;
const id=()=>`scaling-test-${String(++sequence).padStart(6,'0')}`;
const roles=Object.keys(C.ROLES);
function heroAt(level,i=0,role=roles[i%4]) {
  const h=C.heroFromStudent({id:'scale-'+i,name:'Student '+i},null,roles.indexOf(role));
  h.xp=C.xpForLevel(level);h.level=level;h.skillPoints=150;
  return C.cleanHero(h,h);
}
const party=(level,count=4)=>Array.from({length:count},(_,i)=>heroAt(level,i));
// The server seeds a start with each student's canonical profile, exactly as here.
const begin=(heroes,encounter=id())=>C.reduce({revision:0,heroes,heroArchive:{}},{type:'start',id:encounter,expectedRevision:0,heroes});
const start=(heroes,bossId)=>{const s=begin(heroes);if(bossId)s.bossId=bossId;return s;};
const act=(s,type,more={})=>C.reduce(s,{id:id(),type,encounterId:s.encounterId,expectedRevision:s.revision,...more});
function answer(s,more={}) {const selected=act(s,'select',{heroId:s.heroes[0].id});return act(selected,'answer',{turnId:selected.pending.id,outcome:'correct',...more});}

test('the enemy level follows the party, leaning towards its strongest hero',()=>{
  assert.equal(C.enemyLevelFor([]),1);
  assert.equal(C.enemyLevelFor(party(1)),1);
  assert.equal(C.enemyLevelFor(party(20)),20);
  assert.equal(C.enemyLevelFor([heroAt(1,0),heroAt(1,1),heroAt(1,2),heroAt(30,3)]),Math.ceil((8.25+60)/3));
  assert.equal(C.enemyLevelFor([{level:99}]),50);
  const s=start(party(12));assert.equal(s.enemyLevel,12);assert.equal(s.enemyScalingVersion,C.ENEMY_SCALING_VERSION);
});

test('enemy health grows with level while a level-one class meets the same enemy as before',()=>{
  const low=start(party(1)),boss=C.bossById(low.bossId);
  const base=Math.ceil(Math.round(Math.max(200,low.heroes.reduce((n,h)=>n+h.stats.damage,0)*4)*boss.hpMultiplier)/2);
  assert.equal(low.bossMaxHp,base);
  const heroes=party(30),high=begin(heroes,low.encounterId+'x');
  const highBoss=C.bossById(high.bossId),plain=Math.round(Math.max(200,high.heroes.reduce((n,h)=>n+h.stats.damage,0)*4)*highBoss.hpMultiplier);
  assert.equal(high.bossMaxHp,Math.ceil(Math.round(plain*(1+C.ENEMY_SCALING.hpPerLevel*29))/2));
  assert.ok(high.bossMaxHp>plain*2,'a level-30 enemy is far tougher than the old formula');
});

test('no single correct answer can defeat a scaled enemy, whatever the points or skill',()=>{
  const heroes=[C.configureHero(heroAt(35,0,'mage'),{command:'advance',jobId:'archmage'})];
  heroes[0].learnedSkills.push(...C.JOB_SKILLS.archmage.map(s=>s.id));
  let s=start([C.cleanHero(heroes[0],heroes[0])],'goblin');
  const cap=Math.round(s.bossMaxHp*C.ENEMY_SCALING.hitShare);
  const hit=answer(s,{command:'skill',skillId:'archmage-primordial-inferno'});
  assert.equal(hit.status,'active');assert.equal(hit.lastEvent.damage,cap);assert.ok(hit.lastEvent.capped);
  assert.ok(hit.poison.damage<=Math.round(s.bossMaxHp*C.ENEMY_SCALING.poisonShare));
  const auto=act(s,'auto',{spinId:id(),heroId:s.heroes[0].id,points:10000});
  assert.equal(auto.status,'active');assert.ok(auto.bossMaxHp-auto.bossHp<=cap+Math.round(s.bossMaxHp*C.ENEMY_SCALING.poisonShare));
  let fights=s,answers=0;
  while(fights.status==='active' && answers<20){fights=answer(fights,{command:'attack'});answers++;fights.heroes[0].hp=fights.heroes[0].stats.maxHp;}
  assert.equal(fights.status,'victory');assert.ok(answers>=4,'an enemy needs at least four answers, took '+answers);
});

test('a summon still ends the fight at once',()=>{
  const s=start(party(40));const won=act(s,'summon',{source:'teacher'});
  assert.equal(won.status,'victory');assert.equal(won.bossHp,0);
});

test('scaled enemies hit harder, wear more armour and give more experience',()=>{
  const low=start(party(1),'goblin'),high=start(party(1),'goblin');
  high.enemyLevel=30;
  high.heroes=structuredClone(low.heroes);high.bossHp=high.bossMaxHp=low.bossMaxHp;high.bossId=low.bossId;
  const a=act(low,'boss',{timing:.5}),b=act(high,'boss',{timing:.5});
  assert.ok(b.lastEvent.targets[0].damage>a.lastEvent.targets[0].damage);
  assert.ok(C.enemyScale(high).armour>0 && C.enemyScale(high).armour<=C.ENEMY_SCALING.armourMax);
  const boss=C.bossById(low.bossId);
  assert.equal(C.rollReward('e','h',boss).xp,boss.rewardXp || 65);
  assert.equal(C.rollReward('e','h',boss,C.enemyScale(high).xp).xp,Math.round((boss.rewardXp || 65)*(1+C.ENEMY_SCALING.xpPerLevel*29)));
});

test('an encounter started before scaling plays exactly as it always did',()=>{
  const s=start(party(30),'goblin');delete s.enemyScalingVersion;delete s.enemyLevel;delete s.enemies;delete s.teamSize;delete s.teamVersion;delete s.teamHeroIds;s.bossHp=s.bossMaxHp=50;
  const scale=C.enemyScale(s);
  assert.equal(scale.scaled,false);assert.equal(scale.hp,1);assert.equal(scale.attack,1);assert.equal(scale.armour,0);assert.equal(scale.hitCap,Infinity);
  const won=answer(s);assert.equal(won.status,'victory');assert.equal(won.lastEvent.capped,undefined);
});

test('the browser and server copies of the rules are identical',async()=>{
  const fs=await import('node:fs');
  for(const name of ['battle-core.js','battle-content.js'])assert.ok(fs.readFileSync(new URL('../'+name,import.meta.url)).equals(fs.readFileSync(new URL('../functions/hero-game/'+name,import.meta.url))),name);
});
