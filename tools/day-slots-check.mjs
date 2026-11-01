/* =====================================================================
   🕒 Lesson times fold (v1.169.0) — in a real browser
   ---------------------------------------------------------------------
   `tools/day-slots-tests.mjs` pins the pure summary and the memory. This
   asks the page: does the day view really show every lesson time folded,
   with its level and subject on the row, does a tap open that lesson and
   only that one, does a re-render keep it open, do Open all / Fold all
   work, does a student's own class open by itself, and does the row fit a
   phone without scrolling sideways.

     node tools/day-slots-check.mjs
     PW=/path/to/playwright/index.mjs node tools/day-slots-check.mjs
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) {
  console.log('day-slots-check: no Playwright at ' + PW + ' — skipped.');
  process.exit(0);
}

const FILE = pathToFileURL(path.resolve(process.argv[2] || 'index.html')).href;
const SHOTS = process.env.DS_SCREENSHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (note ? '\n      ' + note : '')); }
};

const browser = await chromium.launch();

async function open(viewport) {
  const ctx = await browser.newContext({ viewport });
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
  await page.goto(FILE);
  await page.waitForTimeout(900);
  return { ctx, page, errors };
}

/* A week of worksheets: Monday has all three lessons, Saturday one. */
function seed(role) {
  return (role) => {
    const mk = (id, name, day, slot, level, subject, extra) => ({ id, data: Object.assign({
      name, wsDay: day, wsDate: '2026-11-02', wsSlot: slot, level, subject, pageCount: 2
    }, extra || {}) });
    const docs = [
      mk('m0a', 'Heat — gains and losses', 'Monday', 0, 'P5', 'science'),
      mk('m0b', 'Heat — conductors', 'Monday', 0, 'P5', 'science', { starred: true }),
      mk('m1a', 'Fractions of a set', 'Monday', 1, 'P4', 'math'),
      mk('m1b', 'Ratio warm-up', 'Monday', 1, 'P6', 'math'),
      mk('m2a', 'Cells and systems', 'Monday', 2, 'P6', 'science'),
      mk('s0a', 'Saturday review', 'Saturday', 0, 'P3', 'science')
    ];
    for (let i = 0; i < 8; i++) docs.push(mk('m1x' + i, 'Extra practice ' + (i + 1), 'Monday', 1, 'P4', 'math'));
    if (role === 'student') {
      currentUser = { uid: 'stu-1', email: 'kid@example.com' };
      studentProfile = { name: 'Kid', level: 'P4', subject: 'math', days: ['Monday'], slot: 1 };
    } else {
      currentUser = { uid: 'teacher', email: ADMIN_EMAIL };
      studentProfile = null;
    }
    actingStudent = null;
    try { applyRoleUI(); } catch (e) {}
    qDocs = docs;
    qSubjectFilter = 'all';
    $('qDrawer').classList.add('open');
  };
}

const state = () => {
  const out = [];
  document.querySelectorAll('#qList .qDayGroup').forEach(g => {
    g.querySelectorAll('.qSlotSection').forEach(s => {
      const head = s.querySelector('.qSlotHead');
      const rows = Array.prototype.filter.call(s.querySelectorAll('.qItemRow'), r => r.offsetHeight > 0).length;
      out.push({ day: g.getAttribute('data-day'), slot: s.getAttribute('data-slot'),
        open: !s.classList.contains('collapsed'), rows,
        text: head ? head.textContent : '', expanded: head ? head.getAttribute('aria-expanded') : null,
        label: head ? head.getAttribute('aria-label') : '' });
    });
  });
  return out;
};

/* ---------- The teacher's day view ---------- */
{
  const { ctx, page, errors } = await open({ width: 1280, height: 860 });
  ok('the page loads with no uncaught error', errors.length === 0, errors.join('\n      '));
  await page.evaluate(seed(), 'teacher');
  await page.evaluate(() => { qDayFilter = 'Monday'; renderQuestionList(); });
  let s = await page.evaluate(state);
  ok('Monday shows its three lesson times', s.length === 3 && s.every(x => x.day === 'Monday'), JSON.stringify(s));
  ok('every lesson time starts folded, no worksheet showing', s.every(x => !x.open && x.rows === 0 && x.expanded === 'false'));
  ok('each row names its time', /3:00 – 4:45pm/.test(s[0].text) && /5:00 – 6:45pm/.test(s[1].text) && /7:00 – 8:45pm/.test(s[2].text));
  ok('each row names its level and subject', /P5/.test(s[0].text) && /Science/.test(s[0].text) &&
    /P4/.test(s[1].text) && /P6/.test(s[1].text) && /Mathematics/.test(s[1].text), s.map(x => x.text).join(' | '));
  ok('each row counts its worksheets', /2$/.test(s[0].text) && /10$/.test(s[1].text) && /1$/.test(s[2].text), s.map(x => x.text).join(' | '));
  ok('a starred worksheet shows a ★ on its folded row', /★ 1/.test(s[0].text) && !/★/.test(s[1].text));
  ok('the row says it all in words for a screen reader', /Monday 3:00 – 4:45pm · P5 Science · 2 worksheets · ★ 1 to open/.test(s[0].label), s[0].label);
  const folded = await page.evaluate(() => $('qList').scrollHeight);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'day-folded.png') });

  await page.click('#qList .qSlotSection[data-slot="1"] .qSlotHead');
  s = await page.evaluate(state);
  ok('a tap opens that lesson and shows its worksheets', s[1].open && s[1].rows === 10 && s[1].expanded === 'true');
  ok('the other lessons stay folded', !s[0].open && !s[2].open && s[0].rows === 0);
  const opened = await page.evaluate(() => $('qList').scrollHeight);
  ok('folded, the day is far shorter than with a lesson open', folded < opened, folded + ' vs ' + opened);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'day-one-open.png') });

  await page.evaluate(() => renderQuestionList());
  s = await page.evaluate(state);
  ok('the list redrawing keeps the opened lesson open', s[1].open && !s[0].open);

  await page.click('#qList .qSlotSection[data-slot="1"] .qSlotHead');
  s = await page.evaluate(state);
  ok('a second tap folds it again', !s[1].open && s[1].rows === 0);

  const allBtn = await page.evaluate(() => { const b = $('qSlotAllBtn'); return b && b.offsetHeight > 0 ? b.textContent : ''; });
  ok('the day bar offers Open all', /Open all/.test(allBtn), allBtn);
  await page.click('#qSlotAllBtn');
  s = await page.evaluate(state);
  ok('Open all opens every lesson', s.every(x => x.open && x.rows > 0));
  ok('and then offers Fold all', /Fold all/.test(await page.textContent('#qSlotAllBtn')));
  await page.click('#qSlotAllBtn');
  s = await page.evaluate(state);
  ok('Fold all folds every lesson', s.every(x => !x.open && x.rows === 0));

  // Opening a worksheet from an opened lesson still works like a card.
  await page.click('#qList .qSlotSection[data-slot="0"] .qSlotHead');
  const card = await page.evaluate(() => {
    const b = document.querySelector('#qList .qSlotSection[data-slot="0"] .qItem');
    return b ? { name: b.querySelector('.qItemName').textContent, h: b.offsetHeight } : null;
  });
  ok('the worksheets in an opened lesson are ordinary cards', !!card && card.h > 0 && /Heat/.test(card.name), JSON.stringify(card));

  // The whole week folds the same way.
  await page.evaluate(() => { qDayFilter = 'all'; renderQuestionList(); });
  s = await page.evaluate(state);
  ok('the whole week shows every lesson of every day as a row', s.length === 4 && s.some(x => x.day === 'Saturday'));
  ok('a single lesson on a day still gets its row', s.filter(x => x.day === 'Saturday').length === 1 && /P3/.test(s.find(x => x.day === 'Saturday').text));
  ok('the lesson opened in the day view is still open in the week', s.find(x => x.day === 'Monday' && x.slot === '0').open);

  // A drag onto a folded lesson opens it and the card lands inside.
  const drag = await page.evaluate(() => {
    const target = document.querySelector('#qList .qDayGroup[data-day="Monday"] .qSlotSection[data-slot="2"]');
    const row = document.querySelector('#qList .qDayGroup[data-day="Monday"] .qSlotSection[data-slot="0"] .qItemRow');
    qDrag = { row, placeY: 0 };
    const head = target.querySelector('.qSlotHead');
    const r = head.getBoundingClientRect();
    placeQDrag(r.left + 20, r.top + r.height / 2);
    const res = { open: !target.classList.contains('collapsed'), inside: target.contains(row) };
    qDrag = null;
    renderQuestionList();
    return res;
  });
  ok('dragging a card over a folded lesson opens it and drops it in', drag.open && drag.inside, JSON.stringify(drag));

  ok('no uncaught error along the way', errors.length === 0, errors.join('\n      '));
  await ctx.close();
}

/* ---------- A student: their own class opens by itself ---------- */
{
  const { ctx, page } = await open({ width: 1280, height: 860 });
  await page.evaluate(seed(), 'student');
  await page.evaluate(() => { qDayFilter = 'Monday'; renderQuestionList(); });
  const s = await page.evaluate(state);
  const mine = s.find(x => x.slot === '1');
  ok('a student\'s own class is open on their class day', !!mine && mine.open && mine.rows > 0 && /your class/.test(mine.text), JSON.stringify(mine));
  ok('their other lessons are folded', s.filter(x => x.slot !== '1').every(x => !x.open));
  await ctx.close();
}

/* ---------- A phone ---------- */
{
  const { ctx, page } = await open({ width: 390, height: 780 });
  await page.evaluate(seed(), 'teacher');
  await page.evaluate(() => { qDayFilter = 'Monday'; renderQuestionList(); });
  const fit = await page.evaluate(() => {
    const heads = Array.from(document.querySelectorAll('#qList .qSlotHead'));
    const list = $('qList');
    const lr = list.getBoundingClientRect();
    return {
      inside: heads.every(h => { const r = h.getBoundingClientRect(); return r.left >= lr.left - 1 && r.right <= lr.right + 1; }),
      tall: heads.every(h => h.offsetHeight >= 44),
      sideways: list.scrollWidth <= list.clientWidth + 1
    };
  });
  ok('phone: every row fits the list width', fit.inside && fit.sideways, JSON.stringify(fit));
  ok('phone: every row is a comfortable tap target', fit.tall);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'day-phone.png') });
  await ctx.close();
}

await browser.close();
console.log('\nday-slots-check: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
