import test from 'node:test';
import assert from 'node:assert/strict';
import { addBattleRules, BATTLE_RULE } from './battle-rules.mjs';
import { addHeroRules, HERO_RULE, AUTHORITATIVE_BATTLE_RULE, heroRuleTests, publishHeroRules } from './hero-rules.mjs';
const original=addBattleRules(`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // BEGIN permanent-student-question-history-v1
    function isPermanentStudentHistoryPath() { return false; }
    function isLiveServerPath() { return false; }
    match /{document=**} {
      allow read, write: if !isPermanentStudentHistoryPath() && !isLiveServerPath();
    }
  }
}`);
test('hero migration changes only the battle block and its namespace exclusion',()=>{
  const next=addHeroRules(original);assert.equal(addHeroRules(next),next);
  assert.equal(next.replace(AUTHORITATIVE_BATTLE_RULE+HERO_RULE,BATTLE_RULE).replace(' && !isClassroomHeroPath()',''),original);
  assert.throws(()=>addHeroRules(original.replace('classroom-battles-v1','unrecognized')),/differ/);
  assert.throws(()=>addHeroRules(original.replace('match /{document=**}','match /{document=**} {} match /{other=**}')),/Ambiguous/);
});
test('rules permit only teacher battle reads and deny every direct hero access',()=>{
  const cases=heroRuleTests();assert.equal(cases.length,145);
  const heroCases=cases.filter(c=>c.request.path.includes('/classroomHeroData/'));
  assert.equal(heroCases.length,96);assert.ok(heroCases.every(c=>c.expectation==='DENY'));
  assert.ok(cases.filter(c=>c.request.method!=='get').every(c=>c.expectation==='DENY'));
  assert.equal(cases.filter(c=>c.expectation==='ALLOW').length,2);
});
function fakeAPI({fail=false,race=false}={}) {
  let reads=0,current='projects/mathgen--app/rulesets/original';const calls=[];
  const request=async(path,options={})=>{
    calls.push({path,options});
    if(path.endsWith('/releases/cloud.firestore')){
      if(options.method==='PATCH')current=options.body.release.rulesetName;
      return {rulesetName:race && ++reads>1?'projects/mathgen--app/rulesets/raced':current,updateTime:'same'};
    }
    if(path.endsWith('/rulesets/original'))return {source:{files:[{name:'firestore.rules',content:original}]}};
    if(path.endsWith(':test'))return {testResults:options.body.testSuite.testCases.map(()=>({state:fail?'FAILURE':'SUCCESS'}))};
    if(path.endsWith('/rulesets'))return {name:'projects/mathgen--app/rulesets/candidate'};
    throw Error('unexpected request');
  };
  return {request,calls};
}
test('shared rules publish only after validation and abort on concurrent edits',async()=>{
  const bad=fakeAPI({fail:true});await assert.rejects(publishHeroRules({request:bad.request,deploy:true}),/validation failed/);assert.ok(!bad.calls.some(c=>c.options.method==='PATCH'));
  const race=fakeAPI({race:true});await assert.rejects(publishHeroRules({request:race.request,deploy:true}),/changed while/);assert.ok(!race.calls.some(c=>c.options.method==='PATCH'));
  const good=fakeAPI();const result=await publishHeroRules({request:good.request,deploy:true});assert.equal(result.changed,true);assert.equal(good.calls.filter(c=>c.options.method==='PATCH').length,1);
});
