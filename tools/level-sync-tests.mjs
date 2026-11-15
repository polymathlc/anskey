#!/usr/bin/env node
/* =====================================================================
   tools/level-sync-tests.mjs — the level comes from /student (v1.201.0)
   ---------------------------------------------------------------------
   level-sync.js decides which level and subject the Ans Key app uses for
   a student, from their approval on polymathlc.com.sg/student. These are
   the cases that went wrong before (a P6 Science pupil stuck on the P4
   list they picked months ago) and the ones that must NOT change anything
   (waiting / paused accounts, staff with no record, a P1 sibling).

   The glue in index.html is checked too: it must load the file, start
   the listener on sign-in, re-apply after every profile load, and keep
   the profile window to the family's levels.

   Run: node --test tools/level-sync-tests.mjs
   ===================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const LS = require(join(here, '..', 'level-sync.js'));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');

const approved = (children) => ({ status: 'approved', children });

test('the version matches the app', () => {
  const m = /var APP_VERSION = 'v([\d.]+)'/.exec(html);
  assert.ok(m, 'APP_VERSION not found');
  assert.equal(LS.VERSION, m[1]);
  assert.ok(html.includes('level-sync.js?v=' + LS.VERSION), 'index.html must load level-sync.js at this version');
});

test('the Ans Key levels are the app\'s own LEVELS', () => {
  const m = /var LEVELS = (\[[^\]]*\]);/.exec(html);
  assert.ok(m, 'LEVELS not found in index.html');
  assert.deepEqual(LS.ANSKEY_LEVELS, JSON.parse(m[1].replace(/'/g, '"')));
});

test('levels and subjects are read the way /student writes them', () => {
  assert.equal(LS.normLevel('P6'), 'P6');
  assert.equal(LS.normLevel(' p4 '), 'P4');
  assert.equal(LS.normLevel('Primary 5'), 'P5');
  assert.equal(LS.normLevel('S1'), 'S1');
  assert.equal(LS.normLevel('Sec 1'), 'S1');
  assert.equal(LS.normLevel('P1'), '');
  assert.equal(LS.normLevel('S2'), '');
  assert.equal(LS.normLevel('Other'), '');
  assert.equal(LS.normLevel(''), '');
  assert.equal(LS.normLevel(null), '');
  assert.equal(LS.normSubject('math'), 'math');
  assert.equal(LS.normSubject('Maths'), 'math');
  assert.equal(LS.normSubject('science'), 'science');
  assert.equal(LS.normSubject('both'), 'both');
  assert.equal(LS.normSubject(['math', 'science']), 'both');
  assert.equal(LS.normSubject(['science']), 'science');
  assert.equal(LS.normSubject('english'), '');
});

test('the reported case: P4 Maths & Science on Ans Key, P6 Science on /student', () => {
  const record = approved([{ name: 'Ryan', level: 'P6', subjects: 'science' }]);
  const profile = { name: 'Ryan', level: 'P4', subject: 'both', lsChangesUsed: 1 };
  const p = LS.pick(record, profile);
  assert.equal(p.level, 'P6');
  assert.equal(p.subject, 'science');
  assert.deepEqual(p.choices, ['P6']);
  assert.deepEqual(LS.profilePatch(record, profile), { level: 'P6', subject: 'science', levelSource: 'student-access' });
});

test('a profile that already agrees needs no write', () => {
  const record = approved([{ name: 'A', level: 'P5', subjects: 'both' }]);
  assert.equal(LS.profilePatch(record, { level: 'P5', subject: 'both' }), null);
});

test('only an APPROVED record counts', () => {
  const children = [{ name: 'A', level: 'P6', subjects: 'science' }];
  const profile = { level: 'P4', subject: 'math' };
  for (const status of ['pending', 'revoked', '', undefined]) {
    assert.equal(LS.pick({ status, children }, profile), null, 'status ' + status);
    assert.equal(LS.profilePatch({ status, children }, profile), null, 'status ' + status);
  }
  assert.equal(LS.pick(null, profile), null);
  assert.equal(LS.profilePatch(undefined, profile), null);
  assert.equal(LS.pick({ status: 'Approved', children }, profile).level, 'P6', 'status case does not matter');
});

test('children at levels with no Ans Key worksheets change nothing', () => {
  const record = approved([{ name: 'Baby', level: 'P1', subjects: 'both' }, { name: 'Teen', level: 'S3', subjects: 'math' }, { name: 'X', level: 'Other', subjects: 'science' }]);
  assert.equal(LS.pick(record, { level: 'P4', subject: 'math' }), null);
  assert.equal(LS.profilePatch(record, { level: 'P4', subject: 'math' }), null);
  assert.equal(LS.pick(approved([]), null), null);
  assert.equal(LS.pick({ status: 'approved' }, null), null);
});

test('P3 is Science only at the centre', () => {
  assert.deepEqual(LS.familyLevels(approved([{ level: 'P3', subjects: 'both' }])), { P3: 'science' });
  assert.deepEqual(LS.familyLevels(approved([{ level: 'P3', subjects: 'science' }])), { P3: 'science' });
  assert.deepEqual(LS.familyLevels(approved([{ level: 'P3', subjects: 'math' }])), {}, 'no P3 maths worksheets exist');
});

test('two children at the same level with different subjects → both', () => {
  const record = approved([{ name: 'A', level: 'P5', subjects: 'math' }, { name: 'B', level: 'P5', subjects: 'science' }]);
  assert.deepEqual(LS.familyLevels(record), { P5: 'both' });
});

test('siblings at different levels: keep the profile\'s level when it is one of them', () => {
  const record = approved([{ name: 'Big', level: 'P6', subjects: 'science' }, { name: 'Small', level: 'P4', subjects: 'math' }]);
  const keep = LS.pick(record, { level: 'P6', subject: 'both' });
  assert.equal(keep.level, 'P6');
  assert.equal(keep.subject, 'science');
  assert.deepEqual(keep.choices, ['P4', 'P6']);
  assert.deepEqual(LS.profilePatch(record, { level: 'P6', subject: 'both' }), { level: 'P6', subject: 'science', levelSource: 'student-access' });
  const other = LS.pick(record, { level: 'P5', subject: 'math' });
  assert.equal(other.level, 'P4', 'not one of the family\'s levels → the youngest child');
  assert.equal(other.subject, 'math');
  assert.equal(LS.pick(record, null).level, 'P4');
});

test('the profile window offers only the family\'s levels', () => {
  const sync = LS.pick(approved([{ level: 'P6', subjects: 'science' }, { level: 'P4', subjects: 'math' }]), null);
  assert.ok(LS.allowsLevel(sync, 'P4'));
  assert.ok(LS.allowsLevel(sync, 'P6'));
  assert.ok(!LS.allowsLevel(sync, 'P5'));
  assert.ok(LS.allowsLevel(null, 'P5'), 'no approval → every level, as before');
  assert.match(LS.hint(sync), /Pick the child/);
  assert.match(LS.hint(LS.pick(approved([{ level: 'P6', subjects: 'science' }]), null)), /come from your Polymath enrolment/);
  assert.equal(LS.hint(null), '');
});

test('same() tells a real change from a repeated snapshot', () => {
  const a = LS.pick(approved([{ level: 'P6', subjects: 'science' }]), null);
  const b = LS.pick(approved([{ level: 'P6', subjects: 'science' }]), null);
  const c = LS.pick(approved([{ level: 'P6', subjects: 'both' }]), null);
  assert.ok(LS.same(a, b));
  assert.ok(!LS.same(a, c));
  assert.ok(LS.same(null, null));
  assert.ok(!LS.same(a, null));
});

test('only level and subject are ever written', () => {
  const patch = LS.profilePatch(approved([{ level: 'P6', subjects: 'science' }]), { name: 'Kid', level: 'P4', subject: 'math', days: ['Monday'], slot: 1, lsChangesUsed: 1 });
  assert.deepEqual(Object.keys(patch).sort(), ['level', 'levelSource', 'subject']);
});

test('the glue in index.html is wired up', () => {
  assert.match(html, /startLevelSync\(user\)/, 'sign-in starts the listener');
  assert.match(html, /db\.collection\('studentAccess'\)\.doc\(user\.uid\)\.onSnapshot/, 'listens to the approval live');
  assert.match(html, /applyLevelSync\(\{ quiet: true \}\)/, 'every profile load re-applies the approval');
  assert.match(html, /if \(sync\) levels = sync\.choices\.slice\(\);/, 'profile chips offer only the family\'s levels');
  assert.match(html, /var changedLS = !!studentProfile && !sync &&/, 'switching between the family\'s levels is not the one change');
  assert.match(html, /function profileLevelSync\(\)[\s\S]{0,200}actingStudent/, 'never while the teacher\'s device is handed over');
});
