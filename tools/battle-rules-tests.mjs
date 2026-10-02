import test from 'node:test';
import assert from 'node:assert/strict';
import { addBattleRules, BATTLE_RULE, battleRuleTests, publishBattleRules } from './battle-rules.mjs';
const original = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // BEGIN permanent-student-question-history-v1
    function isPermanentStudentHistoryPath() { return false; }
    function isLiveServerPath() { return false; }
    match /{document=**} {
      allow read, write: if !isPermanentStudentHistoryPath() && !isLiveServerPath();
    }
  }
}`;
test('narrow battle migration is reversible, idempotent and refuses ambiguous source', () => {
  const updated = addBattleRules(original);
  assert.equal(updated.replace(BATTLE_RULE, '').replace(' && !isClassroomBattlePath()', ''), original);
  assert.equal(addBattleRules(updated), updated);
  assert.throws(() => addBattleRules('allow read, write: if true;'), /Unrecognized/);
  assert.throws(() => addBattleRules(original.replace('match /{document=**}', 'match /{document=**} {} match /{other=**}')), /Ambiguous/);
});
test('rules cover unauthorized access, ownership, stale revisions and immutable receipts', () => {
  const tests = battleRuleTests();
  assert.ok(tests.length >= 40);
  assert.ok(tests.some(t => t.request.method === 'update' && t.expectation === 'ALLOW'));
  assert.ok(tests.filter(t => t.request.path.includes('/actions/') && t.expectation === 'DENY').length >= 12);
  assert.match(BATTLE_RULE, /email_verified == true/); assert.match(BATTLE_RULE, /sign_in_provider == 'google.com'/);
});
function api({ fail = false, race = false } = {}) {
  let reads = 0, current = 'projects/mathgen--app/rulesets/original'; const calls = [];
  const request = async (path, opts = {}) => {
    calls.push({ path, opts });
    if (path.endsWith('/releases/cloud.firestore')) {
      if (opts.method === 'PATCH') current = opts.body.release.rulesetName;
      return { rulesetName: race && ++reads > 1 ? 'projects/mathgen--app/rulesets/raced' : current, updateTime:'same' };
    }
    if (path.endsWith('/rulesets/original')) return { source:{ files:[{ name:'firestore.rules', content:original }] } };
    if (path.endsWith(':test')) return { testResults:opts.body.testSuite.testCases.map(() => ({state:fail ? 'FAILURE' : 'SUCCESS'})) };
    if (path.endsWith('/rulesets')) return { name:'projects/mathgen--app/rulesets/candidate' };
    throw new Error('Unexpected API request');
  };
  return { request, calls };
}
test('publication validates first and refuses failures or a concurrent rules deployment', async () => {
  const bad = api({fail:true}); await assert.rejects(publishBattleRules({request:bad.request,deploy:true}), /validation failed/);
  assert.ok(!bad.calls.some(c => c.opts.method === 'PATCH' || c.path.endsWith('/rulesets')));
  const race = api({race:true}); await assert.rejects(publishBattleRules({request:race.request,deploy:true}), /changed during/);
  assert.ok(!race.calls.some(c => c.opts.method === 'PATCH'));
  const good = api(); const result = await publishBattleRules({request:good.request,deploy:true});
  assert.equal(result.changed,true); assert.equal(good.calls.filter(c => c.opts.method === 'PATCH').length,1);
});
