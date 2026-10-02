// Narrow migration of current shared rules. Never deploy an app-local replacement.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
export const BATTLE_RULE = `    // BEGIN classroom-battles-v1
    function isClassroomBattlePath() {
      return request.path[3] == 'classroomBattles';
    }
    function isClassroomTeacher(teacherUid) {
      return request.auth != null && request.auth.uid == teacherUid
        && request.auth.token.email == 'chungzhikai@gmail.com'
        && request.auth.token.email_verified == true
        && request.auth.token.firebase.sign_in_provider == 'google.com';
    }
    match /classroomBattles/{teacherUid}/classes/{classKey} {
      allow read: if isClassroomTeacher(teacherUid);
      function validBattle() {
        return request.resource.data.teacherId == teacherUid
        && request.resource.data.schemaVersion == 1
        && request.resource.data.classId is string
        && request.resource.data.classId.size() > 0
        && request.resource.data.heroes is list
        && request.resource.data.heroes.size() > 0
        && request.resource.data.heroes.size() <= 100
        && request.resource.data.bossHp >= 0
        && request.resource.data.bossHp <= request.resource.data.bossMaxHp
        && request.resource.data.status in ['active', 'victory', 'defeat'];
      }
      allow create: if isClassroomTeacher(teacherUid) && validBattle()
        && request.resource.data.revision == 1;
      allow update: if isClassroomTeacher(teacherUid) && validBattle()
        && request.resource.data.revision == resource.data.revision + 1
        && request.resource.data.classId == resource.data.classId;
      match /actions/{actionId} {
        allow read: if isClassroomTeacher(teacherUid);
        allow create: if isClassroomTeacher(teacherUid)
          && request.resource.data.keys().hasOnly(['encounterId', 'revision', 'type'])
          && request.resource.data.encounterId is string
          && request.resource.data.revision is int
          && request.resource.data.type in ['start', 'select', 'answer', 'boss', 'sync'];
        allow update, delete: if false;
      }
    }
    // END classroom-battles-v1

`;
const ANCHOR = '    // BEGIN permanent-student-question-history-v1';
export function addBattleRules(source) {
  if (typeof source !== 'string' || !source.includes('service cloud.firestore {') || !source.includes(ANCHOR)) throw new Error('Unrecognized shared rules; nothing changed.');
  const catchalls = [...source.matchAll(/(allow read, write: if !isPermanentStudentHistoryPath\(\)[^;]*)(;)/g)];
  if (catchalls.length !== 1 || (source.match(/match\s+\/\{\w+=\*\*\}/g) || []).length !== 1) throw new Error('Ambiguous shared catch-all; nothing changed.');
  if (source.includes(BATTLE_RULE) && catchalls[0][1].endsWith(' && !isClassroomBattlePath()')) return source;
  if (source.includes('isClassroomBattlePath') || source.includes('classroom-battles-v1')) throw new Error('Existing battle rules differ; review them first.');
  const before = catchalls[0][0], after = catchalls[0][1] + ' && !isClassroomBattlePath();';
  const next = source.replace(ANCHOR, BATTLE_RULE + ANCHOR).replace(before, after);
  if (next.replace(BATTLE_RULE, '').replace(after, before) !== source) throw new Error('Unrelated rules would change.');
  return next;
}
const stateData = { schemaVersion: 1, teacherId: 'battle-teacher', classId: 'P5 Science', revision: 1, heroes: [{ id: 'student-1' }], bossHp: 100, bossMaxHp: 100, status: 'active' };
function permission(path, method, expectation, identity = 'teacher', data = stateData) {
  const uid = identity === 'teacher' ? 'battle-teacher' : identity === 'other-teacher' ? 'another-teacher' : 'battle-student';
  const token = { email: identity === 'student' ? 'student@example.com' : 'chungzhikai@gmail.com', email_verified: identity !== 'unverified', firebase: { sign_in_provider: identity === 'password' ? 'password' : 'google.com' } };
  return { expectation, request: { path: '/databases/(default)/documents/' + path, method,
    auth: identity === 'anonymous' ? null : { uid, token },
    ...(['create', 'update'].includes(method) ? { resource: { data } } : {}) },
    ...(method !== 'create' ? { resource: { data: method === 'update' ? { ...stateData, revision: 1 } : data } } : {}) };
}
export function battleRuleTests() {
  const path = 'classroomBattles/battle-teacher/classes/class1';
  const tests = [];
  for (const identity of ['anonymous', 'student', 'other-teacher', 'unverified', 'password']) {
    for (const method of ['get', 'create', 'update', 'delete']) tests.push(permission(path, method, 'DENY', identity));
    tests.push(permission(path + '/actions/abc12345', 'get', 'DENY', identity));
    tests.push(permission(path + '/actions/abc12345', 'create', 'DENY', identity, { encounterId:'encounter1', revision:1, type:'answer' }));
  }
  tests.push(permission(path, 'get', 'ALLOW'), permission(path, 'create', 'ALLOW'),
    permission(path, 'update', 'ALLOW', 'teacher', { ...stateData, revision: 2 }),
    permission(path, 'update', 'DENY'), permission(path, 'delete', 'DENY'),
    permission(path, 'update', 'DENY', 'teacher', { ...stateData, teacherId:'another-teacher', revision:2 }),
    permission(path, 'update', 'DENY', 'teacher', { ...stateData, classId:'Other class', revision:2 }),
    permission(path + '/actions/abc12345', 'create', 'ALLOW', 'teacher', { encounterId:'encounter1', revision:1, type:'answer' }),
    permission(path + '/actions/abc12345', 'update', 'DENY'), permission(path + '/actions/abc12345', 'delete', 'DENY'),
    permission('classroomBattles/battle-teacher/other/path', 'create', 'DENY'));
  return tests;
}
export function preservedRuleTests() {
  return [
    ...['users/probe', 'users/probe/settings/scienceRpg', 'scienceGameLeaderboard/probe', 'students/probe', 'awards/probe', 'pdfAnnotator/probe']
      .flatMap(path => ['get','create','update'].map(method => permission(path, method, 'ALLOW', 'anonymous'))),
    ...['tutorCentreAdmin/probe', 'tutorGameProfiles/probe', 'studyBuddyLiveSessions/probe', 'ansKeyLiveSessions/probe', 'cerAinsteinLiveSessions/probe', 'polymathEnquiryRequests/probe', 'mail/polymath-enquiry-probe']
      .flatMap(path => ['get','create','update'].map(method => permission(path, method, 'DENY', 'anonymous')))
  ];
}
async function validate(request, source, tests) {
  const result = await request('projects/mathgen--app:test', { method: 'POST', body: { source, testSuite: { testCases: tests } } });
  const failed = (result.testResults || []).flatMap((r, i) => r.state === 'SUCCESS' ? [] : [{ i, result:r }]);
  if (result.testResults?.length !== tests.length || failed.length || result.issues?.some(i => i.severity === 'ERROR')) throw new Error('Rules validation failed: ' + JSON.stringify({ failed, issues:result.issues }));
}
export async function publishBattleRules({ request, deploy = false }) {
  const releasePath = 'projects/mathgen--app/releases/cloud.firestore';
  const previous = await request(releasePath), valid = n => /^projects\/mathgen--app\/rulesets\/[^/]+$/.test(n);
  if (!valid(previous.rulesetName)) throw new Error('Unexpected ruleset.');
  const current = await request(previous.rulesetName), files = current.source?.files;
  if (!Array.isArray(files) || files.length !== 1) throw new Error('Unexpected rules bundle.');
  const content = addBattleRules(files[0].content), source = { files:[{ ...files[0], content }] };
  await validate(request, current.source, preservedRuleTests());
  const tests = [...preservedRuleTests(), ...battleRuleTests()];
  await validate(request, source, tests);
  const result = { validated: tests.length, changed:false, sourceSha256:createHash('sha256').update(content).digest('hex'), ruleset:previous.rulesetName };
  if (!deploy || content === files[0].content) return result;
  const candidate = await request('projects/mathgen--app/rulesets', { method:'POST', body:{source} });
  if (!valid(candidate.name)) throw new Error('Unexpected candidate ruleset.');
  const latest = await request(releasePath);
  if (latest.rulesetName !== previous.rulesetName || latest.updateTime !== previous.updateTime) throw new Error('Shared rules changed during validation. Retry.');
  await request(releasePath, { method:'PATCH', body:{ release:{ name:releasePath, rulesetName:candidate.name }, updateMask:'rulesetName' } });
  if ((await request(releasePath)).rulesetName !== candidate.name) throw new Error('Could not verify battle rules deployment.');
  return { ...result, changed:true, ruleset:candidate.name, previousRuleset:previous.rulesetName };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), index = args.indexOf('--firebase-tools'), root = index >= 0 ? args.splice(index,2)[1] : null;
  if (!root || args.some(a => a !== '--apply')) throw new Error('Use --firebase-tools <installed-package-directory> [--apply].');
  const require = createRequire(import.meta.url), cli = name => require(resolve(root,'lib',name));
  const { Command } = cli('command'), { requireAuth } = cli('requireAuth'), { Client } = cli('apiv2'), { logger } = cli('logger');
  logger.silent = true;
  await new Command('battle:rules').before(requireAuth).action(async () => {
    const client = new Client({ urlPrefix:'https://firebaserules.googleapis.com', apiVersion:'v1' });
    const request = async (path, opts = {}) => (await client.request({ method:opts.method || 'GET', path, ...(opts.body ? {body:opts.body} : {}), skipLog:{reqHeaders:true,reqBody:true,resHeaders:true,resBody:true} })).body;
    console.log(JSON.stringify(await publishBattleRules({ request, deploy:args.includes('--apply') }),null,2));
  }).runner()({project:'mathgen--app',projectId:'mathgen--app',projectNumber:'165654161198',nonInteractive:true,cwd:process.cwd()});
}
