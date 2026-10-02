import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),C=require('../battle-core.js');
let sequence=0;
const id=()=>`appearance-${String(++sequence).padStart(8,'0')}`;
const fresh=()=>C.heroFromStudent({id:'appearance',name:'Appearance'},null,0);
const act=(s,type,more={})=>C.reduce(s,{id:id(),type,encounterId:s.encounterId,expectedRevision:s.revision,...more});

test('legacy heroes default to male and roster input cannot overwrite canonical appearance',()=>{
  const original=fresh();assert.equal(original.gender,'male');
  delete original.gender;
  assert.equal(C.cleanHero({...original,gender:'female'},original).gender,'male');
  original.gender='female';
  assert.equal(C.cleanHero({...original,gender:'male'},original).gender,'female');
  original.gender='invalid';assert.equal(C.cleanHero(original,original).gender,'male');
  const s=C.reduce(null,{id:id(),type:'start',heroes:[fresh()],bossId:'goblin'});
  delete s.heroes[0].gender;s.heroArchive.old={...fresh(),id:'old',studentId:'old',gender:'female'};
  const normalized=C.normalizeState(s);assert.equal(normalized.heroes[0].gender,'male');assert.equal(normalized.heroArchive['student:old'].gender,'female');
});

test('appearance switches preserve advanced class, progression and every combat resource',()=>{
  let hero=fresh();hero.xp=C.xpForLevel(26);hero=C.cleanHero(hero,hero);
  hero=C.configureHero(hero,{command:'advance',jobId:'paladin'});
  hero.hp=0;hero.mp=3;hero.cooldowns={'paladin-radiant-cut':3};hero.shield=17;hero.weakened=true;hero.mythicalUsed=true;hero.correctActions=9;
  const before=structuredClone(hero),next=C.configureHero(hero,{command:'appearance',gender:'female',xp:999999,jobId:'archmage',hp:999999});
  assert.deepEqual(hero,before);assert.deepEqual(next,{...before,gender:'female'});
  assert.deepEqual(C.configureHero(next,{command:'appearance',gender:'male'}),before);
  for(const gender of [undefined,null,'Female','other','',0,{},['female']])assert.throws(()=>C.configureHero(hero,{command:'appearance',gender}),/male or female/);
});

test('battle cosmetics preserve the pending question and last animation event without combat',()=>{
  let s=C.reduce(null,{id:id(),type:'start',heroes:[fresh()],bossId:'goblin'});
  s=act(s,'select',{heroId:s.heroes[0].id});s.heroes[0].hp=11;s.heroes[0].mp=2;s.heroes[0].shield=5;
  const before=structuredClone(s),next=act(s,'sync',{heroId:s.heroes[0].id,command:'appearance',gender:'female'});
  const expected=structuredClone(before);expected.revision++;expected.heroes[0].gender='female';
  assert.deepEqual(s,before);assert.deepEqual(next,expected);
  const answered=act(next,'answer',{turnId:next.pending.id,outcome:'correct',command:'attack'});
  assert.equal(answered.heroes[0].gender,'female');assert.equal(answered.pending,null);assert.ok(answered.lastEvent.damage>0);
  assert.throws(()=>act(s,'sync',{heroId:s.heroes[0].id,command:'class',role:'mage'}),/Resolve/);
});
