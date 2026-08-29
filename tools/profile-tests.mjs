#!/usr/bin/env node
/* =====================================================================
   tools/profile-tests.mjs — the student roster rules
   ---------------------------------------------------------------------
   A student's level and subject decide which worksheets they ever see, and
   EVERY way this goes wrong is silent and looks identical to a teacher who
   has not uploaded anything yet:

   • A P3 pupil tagged "Mathematics" matches no worksheet for the rest of
     their time here. `canSeeDoc` simply never returns true, and an empty
     list explains nothing.
   • A pair is chosen in FIVE places — the student's chips, their save, the
     admin's add-a-student form, the admin's per-student row, and canSeeDoc
     on the read side. A rule enforced in four of them is not a rule, and
     the one that gets missed is always the teacher's dropdown, because
     that is the one used to FIX a profile that went in wrong.
   • Reading a stored subject raw rather than through `profileSubject`
     hands a P3 pupil the maths worksheets the centre does not teach them.
   • Gating on "is there a profile row" rather than on a COMPLETE one lets
     a student with no level past the setup screen for good.

   Run: node tools/profile-tests.mjs
   ===================================================================== */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');

let failures = 0, checks = 0;
function ok(name, cond, detail) {
  checks++;
  if (cond) { console.log('  ✓ ' + name); return; }
  failures++;
  console.log('  ✗ ' + name + (detail ? '\n      ' + detail : ''));
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
     'got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
}
function section(t) { console.log('\n' + t); }

/* ---- The real rule, out of the real file ---- */
function between(a, b, what) {
  const i = html.indexOf(a);
  if (i === -1) throw new Error('could not find the start of ' + what);
  const j = html.indexOf(b, i + a.length);
  if (j === -1) throw new Error('could not find the end of ' + what);
  return html.slice(i, j);
}
const SRC = between('var STUDENT_LEVELS =', 'async function loadStudentProfile', 'the roster rules');

const sandbox = { console, JSON, String, Array, Object };
vm.createContext(sandbox);
vm.runInContext(
  'function levelLabel(l) { return l === "S1" ? "Sec 1" : (l || ""); }\n' +
  'function subjectLabel(s) { return s === "both" ? "Maths & Science" : s === "math" ? "Mathematics" : s === "science" ? "Science" : ""; }\n' +
  SRC, sandbox);
const S = sandbox;

/* =====================================================================
   The levels, and what each one may take
   ===================================================================== */
section('The levels a student can be');
eq('the centre takes P3 to P5', S.STUDENT_LEVELS, ['P3', 'P4', 'P5']);
ok('and no further', S.STUDENT_LEVELS.indexOf('P6') === -1 && S.STUDENT_LEVELS.indexOf('S1') === -1);
eq('three subjects are offered', S.STUDENT_SUBJECTS.map(s => s.value), ['science', 'math', 'both']);

section('P3 is Science only');
eq('P3 offers Science and nothing else', S.levelSubjects('P3'), ['science']);
eq('P4 offers all three', S.levelSubjects('P4'), ['science', 'math', 'both']);
eq('P5 offers all three', S.levelSubjects('P5'), ['science', 'math', 'both']);
ok('P3 + Mathematics is refused', !S.subjectOkForLevel('P3', 'math'));
ok('P3 + Both is refused', !S.subjectOkForLevel('P3', 'both'));
ok('P3 + Science is allowed', S.subjectOkForLevel('P3', 'science'));
ok('P5 + Mathematics is allowed', S.subjectOkForLevel('P5', 'math'));

/* A level from before the range narrowed keeps every subject rather than
   being silently re-tagged — narrowing a student nobody asked us to narrow
   is its own bug. */
eq('a P6 profile from before the range narrowed keeps all three',
   S.levelSubjects('P6'), ['science', 'math', 'both']);

/* =====================================================================
   Reading a profile — the direction that is safe to be wrong in
   ===================================================================== */
section('What a stored profile really means');
eq('a P3 profile saved as "both" MEANS Science',
   S.profileSubject({ level: 'P3', subject: 'both' }), 'science');
eq('a P3 profile saved as "math" MEANS Science',
   S.profileSubject({ level: 'P3', subject: 'math' }), 'science');
eq('a P5 profile saved as "math" is left alone',
   S.profileSubject({ level: 'P5', subject: 'math' }), 'math');
eq('a profile with no subject stays empty rather than being guessed at',
   S.profileSubject({ level: 'P5', subject: '' }), '');
eq('…and so does no profile at all', S.profileSubject(null), '');

section('Every student must have a level AND a usable subject');
ok('a complete P5 profile passes', S.profileComplete({ level: 'P5', subject: 'math' }));
ok('a P3 + maths profile still passes — it reads as Science, it is not broken',
   S.profileComplete({ level: 'P3', subject: 'math' }));
ok('no level is not complete', !S.profileComplete({ subject: 'math' }));
ok('no subject is not complete', !S.profileComplete({ level: 'P5' }));
ok('no profile at all is not complete', !S.profileComplete(null));

/* =====================================================================
   Against index.html itself — the four other places the rule lives
   ===================================================================== */
section('Against index.html itself');

/* The chip rows are BUILT, never hand-written: a typed-out row is a fourth
   copy of "P3 is Science only" that nobody remembers to change. */
ok('the level chips are built from STUDENT_LEVELS',
   /function renderProfileLevelChips\(\)[\s\S]{0,700}STUDENT_LEVELS\.slice\(\)/.test(html));
ok('the subject chips are built from levelSubjects()',
   /function renderProfileSubjectChips\(\)[\s\S]{0,900}levelSubjects\(profilePick\.level\)/.test(html));
ok('neither row is hand-written in the markup',
   !/<button[^>]*data-level="P6"/.test(html) && !/<button[^>]*data-subject="math"/.test(html),
   'a chip typed into the markup is a copy of the rule that cannot be kept in step');

/* Switching from P5 Mathematics to P3 must not leave "Mathematics" picked
   on a row that no longer contains it — it would be saved on the next tap. */
ok('a subject the new level does not offer is dropped from the pick',
   /allowed\.indexOf\(profilePick\.subject\) === -1\) profilePick\.subject = ''/.test(html));
ok('…and a level with one subject picks it outright',
   /if \(allowed\.length === 1\) profilePick\.subject = allowed\[0\]/.test(html));

/* The chips are rebuilt on every level change, so a listener bound to one
   is a chip that does nothing when tapped. */
ok('the chip rows are wired by delegation, not per chip',
   /\$\('profileLevelRow'\)\.addEventListener\('click'/.test(html) &&
   /\$\('profileSubjectRow'\)\.addEventListener\('click'/.test(html));

/* The save is the last gate: the pick survives a level change. */
ok('the save refuses a pair the level does not offer',
   /if \(!subjectOkForLevel\(profilePick\.level, profilePick\.subject\)\)/.test(html));

/* Both ADMIN surfaces — the one that matters most, because the teacher is
   who fixes a profile that went in wrong. */
const fillUses = (html.match(/fillStudentSubjects\(/g) || []).length;
ok('both admin subject dropdowns are filled by the one helper', fillUses >= 4,
   'found ' + fillUses + ' references');
ok('the admin add-form offers STUDENT_LEVELS, not every worksheet level',
   /STUDENT_LEVELS\.forEach\(function \(l\) \{[\s\S]{0,200}lvlSel\.appendChild/.test(html));
/* Moving a student to P3 has to take their subject with it, or the save
   leaves the exact pair that matches nothing. */
ok('moving a student to P3 saves the new subject too',
   /adminSave\(\{ level: lvlSel\.value, subject: sub \}/.test(html));

/* The read side. */
ok('canSeeDoc reads the subject through profileSubject',
   /var mySub = profileSubject\(studentProfile\);/.test(html));
ok('…and never raw off the profile again',
   !/studentProfile\.subject !== 'both'/.test(html),
   'a raw read hands a P3 pupil the maths worksheets the centre does not teach them');
ok('canSeeDoc requires a COMPLETE profile',
   /if \(!profileComplete\(studentProfile\)\) return false;/.test(html));

/* A student with a row but no level must be asked again, or they are stuck
   looking at an empty app with nothing to explain it. */
ok('the first-run prompt fires on an incomplete profile, not just a missing one',
   /if \(!profileComplete\(studentProfile\) && !sharedLink/.test(html));
ok('…and nothing gates on a bare "is there a row" any more',
   !/!isAdmin\(currentUser\) && !studentProfile\b/.test(html));

/* One roster, shared with the other apps. */
ok('the roster is the shared studentProfiles collection',
   /var PROFILES_COLLECTION = 'studentProfiles';/.test(html));

console.log('\n' + (failures
  ? '✗ ' + failures + ' of ' + checks + ' checks failed'
  : '✓ all ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
