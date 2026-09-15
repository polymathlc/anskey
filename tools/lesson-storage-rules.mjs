// Add one narrowly scoped recording-write rule to the CURRENT deployed rules.
// Never deploy an app-local copy of this shared project's complete rules.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LESSON_RULE = `    function isLessonRecording() {
      return request.path[3] == 'pdf-annotator'
        && request.path != /b/$(bucket)/o/pdf-annotator
        && request.path[4].matches('^lesson-.*$');
    }
    function isVerifiedTeacher() {
      return request.auth != null
        && request.auth.token.email == 'chungzhikai@gmail.com'
        && request.auth.token.email_verified == true
        && request.auth.token.firebase.sign_in_provider == 'google.com';
    }
`;
const OLD_ALLOW = 'allow read, write: if true;';
const NEW_ALLOW = 'allow read: if true;\n      allow write: if !isLessonRecording() || isVerifiedTeacher();';

export function addLessonStorageRules(source) {
  if (typeof source !== 'string' || !source.includes('service firebase.storage {')) throw new Error('Unexpected Storage rules source.');
  const scope = '  match /b/{bucket}/o {\n';
  if (source.split(scope).length !== 2 || source.split('match /{allPaths=**}').length !== 2) throw new Error('Unrecognized shared Storage scope.');
  const hasRule = source.includes(LESSON_RULE), hasAllow = source.includes(NEW_ALLOW);
  if (!hasRule && /isLessonRecording|isVerifiedTeacher/.test(source)) throw new Error('Existing recording protection differs; review it first.');
  if (hasRule !== hasAllow) throw new Error('Incomplete recording protection; refusing to guess a repair.');
  // A second allow can bypass a restrictive rule: matching Firebase allows OR
  // together. Reject unfamiliar policies so this tool never claims a false fix.
  const allowCount = (source.match(/\ballow\s/g) || []).length;
  if (allowCount !== (hasRule ? 2 : 1)) throw new Error('Additional shared permissions require review.');
  if (hasRule) return source;
  if (source.split(OLD_ALLOW).length !== 2) throw new Error('Expected the known shared catch-all.');
  // Callback replacement preserves the literal $ in the anchored filename regex.
  const updated = source.replace(scope, () => scope + LESSON_RULE).replace(OLD_ALLOW, NEW_ALLOW);
  if (updated.replace(LESSON_RULE, '').replace(NEW_ALLOW, OLD_ALLOW) !== source) throw new Error('Unrelated rules changed.');
  return updated;
}

const ROLES = [null,
  { uid: 'student', token: { email: 'student@example.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } } },
  { uid: 'teacher', token: { email: 'chungzhikai@gmail.com', email_verified: false, firebase: { sign_in_provider: 'google.com' } } },
  { uid: 'teacher', token: { email: 'chungzhikai@gmail.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } } },
  { uid: 'teacher', token: { email: 'chungzhikai@gmail.com', email_verified: true, firebase: { sign_in_provider: 'password' } } },
  { uid: 'teacher', token: { email: 'chungzhikai@gmail.com', email_verified: true, firebase: { sign_in_provider: 'custom' } } }
];
function casesFor(names, protect) {
  return names.flatMap(name => ['get', 'list', 'create', 'update', 'delete'].flatMap(method => ROLES.map((auth, role) => {
    const request = { path: '/b/mathgen--app.firebasestorage.app/o/' + name, method, auth };
    const resource = { name, size: 1024, contentType: name.endsWith('.json') ? 'application/json' : 'audio/webm', metadata: {} };
    if (method === 'create' || method === 'update') request.resource = resource;
    const allowed = !protect || ['get', 'list'].includes(method) || role === 3;
    return { expectation: allowed ? 'ALLOW' : 'DENY', request, ...(method !== 'create' ? { resource } : {}) };
  })));
}
export function lessonRuleTests() {
  return casesFor(['pdf-annotator/lesson-sheet-ann.json', 'pdf-annotator/lesson-sheet-ann.webm',
    'pdf-annotator/lesson-sheet-ann.m4a', 'pdf-annotator/lesson-nested/file.bin'], true);
}
export function preservedStorageTests() {
  return casesFor(['pdf-annotator/sheet.pdf', 'pdf-annotator/sheet.annotations.json',
    'pdf-annotator/rec-sheet.webm', 'other/lesson-ann.json', 'pdf-annotator', 'lesson-alone.json', 'pdf-annotator/lesson'], false);
}
async function validate(request, source, cases) {
  for (let at = 0; at < cases.length; at += 50) {
    const batch = cases.slice(at, at + 50);
    const result = await request('projects/mathgen--app:test', { method: 'POST', body: { source, testSuite: { testCases: batch } } });
    if ((result.issues || []).some(issue => issue.severity === 'ERROR') || result.testResults?.length !== batch.length
      || result.testResults.some(item => item.state !== 'SUCCESS')) throw new Error('Storage permission tests failed; active rules were not changed.');
  }
}
export async function publishLessonStorageRules({ request, project = 'mathgen--app', deploy = false, readOnly = false }) {
  if (project !== 'mathgen--app') throw new Error('Unexpected shared Firebase project.');
  if (deploy && readOnly) throw new Error('Read-only and apply modes cannot be combined.');
  const releasePath = 'projects/mathgen--app/releases/firebase.storage/mathgen--app.firebasestorage.app';
  const validRuleset = name => typeof name === 'string' && /^projects\/mathgen--app\/rulesets\/[^/]+$/.test(name);
  const previous = await request(releasePath);
  if (!validRuleset(previous.rulesetName)) throw new Error('Unexpected current ruleset path.');
  const production = await request(previous.rulesetName), files = production.source?.files;
  if (!Array.isArray(files) || files.length !== 1 || typeof files[0].name !== 'string') throw new Error('Unexpected shared rules source bundle.');
  const original = files[0].content, content = addLessonStorageRules(original);
  const hash = createHash('sha256').update(content).digest('hex'), changed = content !== original;
  if (readOnly) return { mode: 'read', ruleset: previous.rulesetName, changeNeeded: changed, sourceSha256: hash };
  const source = { files: [{ ...files[0], content }] };
  const preserved = preservedStorageTests(), tests = [...preserved, ...lessonRuleTests()];
  await validate(request, production.source, preserved);
  await validate(request, source, tests);
  if (!deploy || !changed) return { mode: deploy ? 'apply' : 'test', changed: false, changeNeeded: changed,
    validated: tests.length, ruleset: previous.rulesetName, sourceSha256: hash };
  const candidate = await request('projects/mathgen--app/rulesets', { method: 'POST', body: { source } });
  if (!validRuleset(candidate.name)) throw new Error('Unexpected candidate ruleset path.');
  const latest = await request(releasePath);
  if (latest.rulesetName !== previous.rulesetName || latest.updateTime !== previous.updateTime) throw new Error('Active rules changed during validation. Retry against the latest rules.');
  await request(releasePath, { method: 'PATCH', body: { release: { name: releasePath, rulesetName: candidate.name }, updateMask: 'rulesetName' } });
  const live = await request(releasePath);
  if (live.rulesetName !== candidate.name) throw new Error('Could not verify published lesson protection.');
  return { mode: 'apply', changed: true, validated: tests.length, previousRuleset: previous.rulesetName, ruleset: live.rulesetName, sourceSha256: hash };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = process.argv.slice(2), cliIndex = flags.indexOf('--firebase-tools');
  const cliRoot = cliIndex >= 0 ? flags.splice(cliIndex, 2)[1] : null;
  if (!cliRoot || cliRoot.startsWith('--') || flags.length > 1 || flags.some(flag => !['--read', '--apply'].includes(flag)))
    throw new Error('Pass --firebase-tools <installed-package-directory>, plus --read, --apply, or no mode flag to test.');
  const require = createRequire(import.meta.url), cli = name => require(resolve(cliRoot, 'lib', name));
  const { Command } = cli('command'), { requireAuth } = cli('requireAuth'), { logger } = cli('logger'), { Client } = cli('apiv2');
  logger.silent = true;
  const command = new Command('lesson:storage-rules').before(requireAuth).action(async options => {
    if (options.projectId !== 'mathgen--app') throw new Error('Unexpected shared Firebase project.');
    const client = new Client({ urlPrefix: 'https://firebaserules.googleapis.com', apiVersion: 'v1' });
    const request = async (path, options = {}) => {
      try {
        const response = await client.request({ method: options.method || 'GET', path,
          ...(options.body ? { body: options.body } : {}), skipLog: { reqHeaders: true, reqBody: true, resHeaders: true, resBody: true } });
        return response.body;
      } catch (error) { throw new Error('Firebase rules request failed (HTTP ' + (error.status || error.statusCode || 'unknown') + ').'); }
    };
    console.log(JSON.stringify(await publishLessonStorageRules({ request, deploy: flags.includes('--apply'), readOnly: flags.includes('--read') }), null, 2));
  });
  await command.runner()({ project: 'mathgen--app', projectId: 'mathgen--app', projectNumber: '165654161198', nonInteractive: true, cwd: process.cwd() });
}
