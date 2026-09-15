import test from 'node:test';
import assert from 'node:assert/strict';
import { LESSON_RULE, addLessonStorageRules, lessonRuleTests, preservedStorageTests, publishLessonStorageRules } from './lesson-storage-rules.mjs';
const original = "rules_version = '2';\nservice firebase.storage {\n  match /b/{bucket}/o {\n    match /{allPaths=**} {\n      allow read, write: if true;\n    }\n  }\n}\n";
const releasePath = 'projects/mathgen--app/releases/firebase.storage/mathgen--app.firebasestorage.app';
const initialName = 'projects/mathgen--app/rulesets/original', candidateName = 'projects/mathgen--app/rulesets/candidate';
function api({ content = original, failTests = false, missingResult = false, concurrent = false, changedTime = false, unverified = false, badCandidate = false, sourceFiles } = {}) {
  let reads = 0, published = false; const calls = [];
  const request = async (path, options = {}) => {
    calls.push({ path, ...options });
    if (path === releasePath && !options.method) {
      reads++; return { rulesetName: published && !unverified ? candidateName : concurrent && reads > 1 ? 'projects/mathgen--app/rulesets/other' : initialName,
        updateTime: changedTime && reads > 1 ? 'later' : 'initial' };
    }
    if (path === initialName) return { source: { files: sourceFiles || [{ name: 'storage.rules', content }] } };
    if (path.endsWith(':test')) return { issues: failTests ? [{ severity: 'ERROR' }] : [],
      testResults: options.body.testSuite.testCases.slice(missingResult ? 1 : 0).map(() => ({ state: 'SUCCESS' })) };
    if (path.endsWith('/rulesets')) return { name: badCandidate ? 'projects/other/rulesets/candidate' : candidateName };
    if (path === releasePath && options.method === 'PATCH') { published = true; return {}; }
    throw new Error('Unexpected request.');
  }; return { request, calls };
}
test('changes only the recording prefix write rule, preserves public reads, and is idempotent', () => {
  const updated = addLessonStorageRules(original);
  assert.equal(updated.replace(LESSON_RULE, '').replace('allow read: if true;\n      allow write: if !isLessonRecording() || isVerifiedTeacher();', 'allow read, write: if true;'), original);
  assert.equal(addLessonStorageRules(updated), updated);
  assert.match(updated, /firebase\.sign_in_provider == 'google\.com'/);
  assert.match(updated, /request\.path != \/b\/\$\(bucket\)\/o\/pdf-annotator/);
  assert.equal(updated.split('match /{allPaths=**}').length, 2, 'Literal regex anchor cannot expand replacement text.');
});
test('unfamiliar and partial policies fail closed, including another allow that could bypass protection', () => {
  for (const source of ['', null, original + original, original.replace('if true;', 'if request.auth != null;'),
    original + '\n// isLessonRecording', original.replace('allow read, write: if true;', 'allow read: if true;'),
    original.replace('  }\n}', '    match /else/{name} { allow write: if true; }\n  }\n}')]) assert.throws(() => addLessonStorageRules(source));
});
test('remote cases require the verified Google teacher for lesson writes and preserve playback', () => {
  const cases = lessonRuleTests(); assert.equal(cases.length, 120);
  for (const item of cases) {
    const read = ['get', 'list'].includes(item.request.method), token = item.request.auth?.token;
    const teacher = token?.email === 'chungzhikai@gmail.com' && token.email_verified === true && token.firebase.sign_in_provider === 'google.com';
    assert.equal(item.expectation, read || teacher ? 'ALLOW' : 'DENY');
  }
  const preserved = preservedStorageTests(); assert.equal(preserved.length, 210);
  assert.ok(preserved.every(item => item.expectation === 'ALLOW'));
  assert.ok(preserved.some(item => item.request.path.endsWith('/o/pdf-annotator')));
});
test('read mode fetches only the live release and source', async () => {
  const server = api(), result = await publishLessonStorageRules({ ...server, readOnly: true });
  assert.equal(result.changeNeeded, true); assert.equal(server.calls.length, 2);
  assert.ok(server.calls.every(call => !call.method));
});
test('default mode tests old and proposed permissions without creating or publishing rules', async () => {
  const server = api(), result = await publishLessonStorageRules(server);
  assert.equal(result.validated, 330); assert.equal(result.changed, false);
  assert.deepEqual(server.calls.map(call => call.method || 'GET'), ['GET', 'GET', ...Array(12).fill('POST')]);
  assert.equal(server.calls[2].body.source.files[0].content, original);
});
test('apply validates, checks the live version immediately before publishing, then verifies', async () => {
  const server = api(), result = await publishLessonStorageRules({ ...server, deploy: true });
  assert.equal(result.changed, true); assert.equal(result.ruleset, candidateName);
  assert.deepEqual(server.calls.map(call => call.method || 'GET'), ['GET', 'GET', ...Array(13).fill('POST'), 'GET', 'PATCH', 'GET']);
});
test('permission requests use bounded batches without dropping any current or proposed cases', async () => {
  const server = api(); await publishLessonStorageRules(server);
  const batches = server.calls.filter(call => call.path.endsWith(':test'));
  assert.equal(batches.length, 12);
  assert.ok(batches.every(call => call.body.testSuite.testCases.length <= 50));
  assert.equal(batches.reduce((n, call) => n + call.body.testSuite.testCases.length, 0), 540);
  assert.equal(batches.filter(call => call.body.source.files[0].content === original)
    .reduce((n, call) => n + call.body.testSuite.testCases.length, 0), 210);
});
test('already protected rules are checked but are not republished', async () => {
  const server = api({ content: addLessonStorageRules(original) });
  const result = await publishLessonStorageRules({ ...server, deploy: true }); assert.equal(result.changeNeeded, false);
  assert.ok(!server.calls.some(call => call.method === 'PATCH'));
});
test('missing or failed permission results prevent rule creation and publishing', async () => {
  for (const options of [{ failTests: true }, { missingResult: true }]) {
    const server = api(options); await assert.rejects(publishLessonStorageRules({ ...server, deploy: true }), /permission tests failed/);
    assert.ok(!server.calls.some(call => call.path.endsWith('/rulesets') || call.method === 'PATCH'));
  }
});
test('a changed live source or release timestamp prevents overwriting another deployment', async () => {
  for (const options of [{ concurrent: true }, { changedTime: true }]) {
    const server = api(options); await assert.rejects(publishLessonStorageRules({ ...server, deploy: true }), /changed during validation/);
    assert.ok(!server.calls.some(call => call.method === 'PATCH'));
  }
});
test('unexpected candidates, failed verification, source bundles and project changes are rejected', async () => {
  await assert.rejects(publishLessonStorageRules({ ...api({ unverified: true }), deploy: true }), /Could not verify/);
  const server = api({ badCandidate: true }); await assert.rejects(publishLessonStorageRules({ ...server, deploy: true }), /candidate ruleset/);
  assert.ok(!server.calls.some(call => call.method === 'PATCH'));
  await assert.rejects(publishLessonStorageRules(api({ sourceFiles: [] })), /source bundle/);
  await assert.rejects(publishLessonStorageRules({ ...api(), project: 'other' }), /Unexpected shared Firebase project/);
  await assert.rejects(publishLessonStorageRules({ ...api(), deploy: true, readOnly: true }), /cannot be combined/);
});
