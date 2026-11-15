/* =====================================================================
   🎓 Level from /student (v1.201.0) — in a real browser
   ---------------------------------------------------------------------
   `tools/level-sync-tests.mjs` pins the rules. This asks the page itself:
   a signed-in student whose own profile says "P4 · Maths & Science" but
   whose approval on polymathlc.com.sg/student says P6 Science — does the
   header switch to P6 Science, is the shared roster row written with only
   the level and subject, is the profile window locked to P6 Science, and
   does an admin's later Edit (a sibling added at P4) reach the open app
   live? And for a paused account nothing may change at all.
   Firebase is stubbed: what is checked is what the page shows and writes.

     node tools/level-sync-check.mjs
     PW=/path/to/playwright/index.mjs node tools/level-sync-check.mjs
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) {
  try { ({ chromium } = await import('playwright')); }
  catch (e2) { console.log('level-sync-check: no Playwright — skipped.'); process.exit(0); }
}

const FILE = pathToFileURL(path.resolve(process.argv[2] || 'index.html')).href;
const SHOTS = process.env.LV_SCREENSHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (note ? '\n      ' + note : '')); }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
await page.addInitScript(() => {
  const chain = () => new Proxy(function () { return chain(); }, {
    get: (t, k) => (k === 'then' ? undefined : chain()),
    apply: () => chain(), construct: () => chain(), set: () => true
  });
  window.pdfjsLib = chain(); window.firebase = chain(); window.grecaptcha = chain();
});
await page.route(/firebase-[a-z]+-compat\.js(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/javascript', body: '' }));
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.dismiss().catch(() => {}));
await page.goto(FILE);
await page.waitForTimeout(900);

// A fake Firestore: studentAccess/{uid} snapshots are pushed by the test,
// studentProfiles writes are recorded.
await page.evaluate(() => {
  window.__lv = { writes: [], listeners: {} };
  const FieldValue = { serverTimestamp: () => '__ts__', delete: () => '__del__' };
  window.firebase = window.firebase || {};
  try { window.firebase.firestore.FieldValue = FieldValue; } catch (e) {}
  window.__lvFieldValue = FieldValue;
  db = {
    collection: (name) => ({
      doc: (id) => ({
        onSnapshot: (cb) => { window.__lv.listeners[name + '/' + id] = cb; return () => { delete window.__lv.listeners[name + '/' + id]; }; },
        set: (data, opts) => { window.__lv.writes.push({ path: name + '/' + id, data, opts }); return Promise.resolve(); },
        get: () => Promise.resolve({ exists: false, data: () => null })
      })
    })
  };
  window.__lvPush = (uid, data) => {
    const cb = window.__lv.listeners['studentAccess/' + uid];
    if (cb) cb({ exists: !!data, data: () => data });
    return !!cb;
  };
});

const state = () => page.evaluate(() => ({
  role: (document.querySelector('.authRole') || {}).textContent || '',
  level: studentProfile && studentProfile.level,
  subject: studentProfile && studentProfile.subject,
  writes: window.__lv.writes.map(w => ({ path: w.path, keys: Object.keys(w.data).sort().join(','), level: w.data.level, subject: w.data.subject })),
  listening: Object.keys(window.__lv.listeners)
}));

// 1. The reported case.
const started = await page.evaluate(() => {
  if (!window.firebase.firestore || !window.firebase.firestore.FieldValue || !window.firebase.firestore.FieldValue.serverTimestamp) {
    window.firebase = { firestore: { FieldValue: window.__lvFieldValue } };
  }
  currentUser = { uid: 'kid1', email: 'kid@example.com', displayName: 'Kid', isAnonymous: false };
  studentProfile = { name: 'Kid', level: 'P4', subject: 'both', lsChangesUsed: 1, days: ['Monday'], slot: 1 };
  studentProfileLoadedFor = 'kid1';
  startLevelSync(currentUser);
  renderAuthArea();
  return Object.keys(window.__lv.listeners);
});
ok('a student sign-in listens to their own studentAccess record', started.indexOf('studentAccess/kid1') !== -1, JSON.stringify(started));
let s = await state();
ok('before the approval arrives the header shows their old P4 profile', /P4/.test(s.role), s.role);

await page.evaluate(() => __lvPush('kid1', { status: 'approved', children: [{ name: 'Kid', level: 'P6', subjects: 'science' }] }));
await page.waitForTimeout(150);
s = await state();
ok('the profile becomes P6 Science', s.level === 'P6' && s.subject === 'science', JSON.stringify(s));
ok('the header reads "P6 · Science"', /P6\s*·\s*Science/.test(s.role), s.role);
ok('the shared roster row is written once, level and subject only',
  s.writes.length === 1 && s.writes[0].path === 'studentProfiles/kid1' && s.writes[0].level === 'P6' && s.writes[0].subject === 'science' &&
  s.writes[0].keys === 'level,levelSource,levelSyncedAt,subject', JSON.stringify(s.writes));
const kept = await page.evaluate(() => studentProfile.name + '|' + studentProfile.days.join() + '|' + studentProfile.slot + '|' + studentProfile.lsChangesUsed);
ok('name, class days, slot and the one change are untouched', kept === 'Kid|Monday|1|1', kept);

// A repeated snapshot changes nothing.
await page.evaluate(() => __lvPush('kid1', { status: 'approved', children: [{ name: 'Kid', level: 'P6', subjects: 'science' }] }));
await page.waitForTimeout(100);
s = await state();
ok('the same approval again writes nothing more', s.writes.length === 1, JSON.stringify(s.writes));

// 2. The profile window obeys the approval.
const modal = await page.evaluate(() => {
  openProfileModal(false);
  return {
    levels: [...document.querySelectorAll('#profileLevelRow .pickChip')].map(b => b.getAttribute('data-level') + (b.classList.contains('active') ? '*' : '')),
    subjects: [...document.querySelectorAll('#profileSubjectRow .pickChip')].map(b => b.getAttribute('data-subject') + (b.classList.contains('active') ? '*' : '')),
    locked: profileLocked,
    hint: document.getElementById('profileLockHint').textContent
  };
});
ok('the profile window offers only P6, picked', JSON.stringify(modal.levels) === '["P6*"]', JSON.stringify(modal));
ok('…and only Science, picked', JSON.stringify(modal.subjects) === '["science*"]', JSON.stringify(modal));
ok('…locked, saying it comes from the enrolment', modal.locked && /Polymath enrolment/.test(modal.hint), JSON.stringify(modal));
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'profile-locked-p6.png') });

// 3. An admin adds a sibling at P4 Math while the app is open.
await page.evaluate(() => __lvPush('kid1', { status: 'approved', children: [{ name: 'Kid', level: 'P6', subjects: 'science' }, { name: 'Small', level: 'P4', subjects: 'math' }] }));
await page.waitForTimeout(150);
const sib = await page.evaluate(() => ({
  levels: [...document.querySelectorAll('#profileLevelRow .pickChip')].map(b => b.getAttribute('data-level') + (b.classList.contains('active') ? '*' : '')),
  locked: profileLocked, level: studentProfile.level
}));
ok('a sibling added live: the window offers P4 and P6, P6 still picked, unlocked', JSON.stringify(sib.levels) === '["P4","P6*"]' && !sib.locked && sib.level === 'P6', JSON.stringify(sib));
await page.evaluate(() => document.querySelector('#profileLevelRow .pickChip[data-level="P4"]').click());
const sw = await page.evaluate(() => ({
  subjects: [...document.querySelectorAll('#profileSubjectRow .pickChip')].map(b => b.getAttribute('data-subject') + (b.classList.contains('active') ? '*' : ''))
}));
ok('picking P4 offers only that child\'s Math', JSON.stringify(sw.subjects) === '["math*"]', JSON.stringify(sw));
await page.evaluate(() => { document.getElementById('profileModal').classList.remove('open'); });

// 4. The admin moves Kid down to P5: the profile (not one of the levels now) follows.
await page.evaluate(() => __lvPush('kid1', { status: 'approved', children: [{ name: 'Kid', level: 'P5', subjects: 'both' }] }));
await page.waitForTimeout(150);
s = await state();
ok('an admin Edit to P5 Maths & Science reaches the open app', s.level === 'P5' && s.subject === 'both' && /P5/.test(s.role), JSON.stringify(s));
ok('…and is written to the roster', s.writes.length === 2 && s.writes[1].level === 'P5' && s.writes[1].subject === 'both', JSON.stringify(s.writes));

// 5. Paused: nothing changes.
await page.evaluate(() => __lvPush('kid1', { status: 'revoked', children: [{ name: 'Kid', level: 'P3', subjects: 'science' }] }));
await page.waitForTimeout(150);
s = await state();
ok('a paused account changes nothing', s.level === 'P5' && s.writes.length === 2, JSON.stringify(s));
const free = await page.evaluate(() => { openProfileModal(false); const n = document.querySelectorAll('#profileLevelRow .pickChip').length; document.getElementById('profileModal').classList.remove('open'); return n; });
ok('…and the profile window offers every level again', free >= 4, String(free));

// 6. The teacher is never synced.
const teacher = await page.evaluate(() => {
  stopLevelSync();
  window.__lv.listeners = {};
  currentUser = { uid: 'teach', email: 'chungzhikai@gmail.com', displayName: 'T', isAnonymous: false };
  startLevelSync(currentUser);
  return Object.keys(window.__lv.listeners).length + '|' + (profileLevelSync() === null);
});
ok('the teacher never listens or gets locked', teacher === '0|true', teacher);

const mine = errors.filter(m => /levelSync|LevelSync|level-sync/.test(m));
ok('no page errors from the level sync', mine.length === 0, mine.join('\n'));

await browser.close();
console.log('\nlevel-sync-check: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
