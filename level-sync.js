/* =====================================================================
   level-sync.js — the student's level comes from polymathlc.com.sg/student
   (v1.201.0)
   ---------------------------------------------------------------------
   Before this, the Ans Key app kept its OWN copy of a student's level and
   subject: the student picked them on the "Welcome to Polymath!" chips the
   first time they signed in, in `studentProfiles/{uid}`, and then got one
   change. The /student dashboard (polymathlc.com.sg/student/#admin) — the
   page that approves every account and decides its subjects and /online
   classes — keeps the real answer in `studentAccess/{uid}`:

     { status: 'pending' | 'approved' | 'revoked',
       children: [{ name, level: 'P1'…'P6' | 'S1'…'S5' | 'Other',
                    subjects: 'math' | 'science' | 'both' }] }

   The two never talked, so a pupil the centre moved to P6 Science kept
   seeing the P4 list they chose months ago, and a worksheet the /online
   class had released told them "That worksheet has not been released to
   your class yet".

   Now the approval WINS. For an approved account this file works out the
   level and subject the Ans Key app should use, and the glue in index.html
   ("🎓 Level from /student") puts them on the profile on screen, writes
   them back to `studentProfiles/{uid}` (so the Study Buddy and the Scan app,
   which share that roster, agree), and listens to the record so an admin's
   Edit on /student reaches a student who is signed in right now.

   THE RULE (kept equal to ansKeyProfilePatch in polymathlc/cer
   student/student-account.js, which writes the same row from the admin side)
   • Only an APPROVED record counts. Waiting / paused / no record (staff, the
     teacher, a share-link guest): the profile is left exactly as it is.
   • Only children at a level the Ans Key app has worksheets for count
     (P3, P4, P5, P6, S1). A P1 sibling or an "Other" child adds nothing.
   • P3 is Science only at the centre: a P3 child on "both" means Science,
     and a P3 child on "math" only has no Ans Key worksheets at all.
   • Two children at the SAME level with different subjects → "both".
   • Several levels in one family (siblings sharing an account): the level
     the profile already has is kept when it is one of them, otherwise the
     youngest child's level is used. The student may switch between the
     family's levels on the profile window; nothing else is offered.
   • Nothing usable (every child is P1/P2/Other/S2+) → the profile is left
     alone, rather than wiping a level that works.

   Pure functions only: no Firebase, no DOM. tools/level-sync-tests.mjs runs
   them under node.
   ===================================================================== */
(function (root) {
  'use strict';

  var VERSION = '1.202.0';

  // The levels the Ans Key app has worksheets for, in teaching order.
  // Keep equal to LEVELS in index.html.
  var ANSKEY_LEVELS = ['P3', 'P4', 'P5', 'P6', 'S1'];
  var SUBJECTS = ['math', 'science', 'both'];

  function str(v) { return v == null ? '' : String(v).trim(); }

  /* "P4", "p4 ", "Primary 4" → "P4"; anything the app does not teach → "". */
  function normLevel(level) {
    var l = str(level).toUpperCase().replace(/\s+/g, '');
    var m = /^PRIMARY(\d)$/.exec(l);
    if (m) l = 'P' + m[1];
    m = /^(?:SECONDARY|SEC)(\d)$/.exec(l);
    if (m) l = 'S' + m[1];
    return ANSKEY_LEVELS.indexOf(l) !== -1 ? l : '';
  }

  /* A child's subject choice → one of math / science / both, or "". */
  function normSubject(subjects) {
    if (Array.isArray(subjects)) {
      var hasM = subjects.indexOf('math') !== -1 || subjects.indexOf('both') !== -1;
      var hasS = subjects.indexOf('science') !== -1 || subjects.indexOf('both') !== -1;
      return hasM && hasS ? 'both' : hasM ? 'math' : hasS ? 'science' : '';
    }
    var s = str(subjects).toLowerCase();
    if (s === 'maths' || s === 'mathematics') s = 'math';
    return SUBJECTS.indexOf(s) !== -1 ? s : '';
  }

  /* What a level may take at the centre — index.html's levelSubjects. */
  function subjectForLevel(level, subject) {
    if (!subject) return '';
    if (level === 'P3') return subject === 'math' ? '' : 'science';
    return subject;
  }

  function mergeSubjects(a, b) {
    if (!a) return b;
    if (!b || a === b) return a;
    return 'both';
  }

  function isApproved(record) {
    return !!record && str(record.status).toLowerCase() === 'approved';
  }

  /* Every Ans Key level the approved family has, with its subject:
     { P4: 'math', P6: 'science' }. Empty for anything not approved. */
  function familyLevels(record) {
    var out = {};
    if (!isApproved(record)) return out;
    var children = Array.isArray(record.children) ? record.children : [];
    children.forEach(function (child) {
      if (!child) return;
      var level = normLevel(child.level);
      if (!level) return;
      var subject = subjectForLevel(level, normSubject(child.subjects));
      if (!subject) return;
      out[level] = mergeSubjects(out[level], subject);
    });
    return out;
  }

  /* The family's levels in teaching order. */
  function levelList(levels) {
    return ANSKEY_LEVELS.filter(function (l) { return !!(levels && levels[l]); });
  }

  /**
   * The level and subject the Ans Key app should use for this account, or
   * null when /student has nothing to say (not approved, or no usable child).
   *   record   studentAccess/{uid} (or null)
   *   profile  the studentProfiles row now (or null)
   * → { level, subject, levels: { P4: 'math', … }, choices: ['P4', …] }
   */
  function pick(record, profile) {
    var levels = familyLevels(record);
    var choices = levelList(levels);
    if (!choices.length) return null;
    var mine = normLevel(profile && profile.level);
    var level = mine && levels[mine] ? mine : choices[0];
    return { level: level, subject: levels[level], levels: levels, choices: choices };
  }

  /**
   * What to merge into studentProfiles/{uid} so the profile agrees with
   * /student, or null when it already does (or /student has nothing to say).
   * Only level and subject are touched — never the name, class days, time
   * slot or the student's one change.
   */
  function profilePatch(record, profile) {
    var p = pick(record, profile);
    if (!p) return null;
    if (profile && profile.level === p.level && profile.subject === p.subject) return null;
    return { level: p.level, subject: p.subject, levelSource: 'student-access' };
  }

  /* May the student choose this level on the profile window? */
  function allowsLevel(sync, level) {
    return !sync || !!(sync.levels && sync.levels[level]);
  }

  /* A short line for the profile window. */
  function hint(sync) {
    if (!sync) return '';
    if (sync.choices.length > 1) {
      return 'Your levels come from your Polymath enrolment. Pick the child using this account. Ask Mr Chung if they need changing.';
    }
    return 'Your level and subject come from your Polymath enrolment. Ask Mr Chung if they need changing.';
  }

  /* Do two syncs say the same thing? (avoids redrawing on every snapshot) */
  function same(a, b) {
    if (!a || !b) return a === b;
    return a.level === b.level && a.subject === b.subject &&
      JSON.stringify(a.levels) === JSON.stringify(b.levels);
  }

  var api = {
    VERSION: VERSION,
    ANSKEY_LEVELS: ANSKEY_LEVELS,
    normLevel: normLevel,
    normSubject: normSubject,
    subjectForLevel: subjectForLevel,
    isApproved: isApproved,
    familyLevels: familyLevels,
    levelList: levelList,
    pick: pick,
    profilePatch: profilePatch,
    allowsLevel: allowsLevel,
    hint: hint,
    same: same
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PolymathLevelSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
