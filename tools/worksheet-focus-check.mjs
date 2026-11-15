/* =====================================================================
   📌 Current and next worksheet (v1.200.0) — in a real browser
   ---------------------------------------------------------------------
   `tools/worksheet-focus-tests.mjs` pins the rules. This asks the page:
   does the current worksheet really wear a THICK green border and the next
   a clear blue one (thicker than every other card), does a folded lesson
   time say it holds them, does the 📌 menu open from the card without
   opening the worksheet, do keys typed in it stay there, does Escape and a
   tap outside close it, does a choice change the class list and redraw the
   list, does a trial worksheet in no class list get marked, does the frame
   go round the open page, does a student see the borders but no 📌, and
   does a phone keep the card inside the drawer.

     node tools/worksheet-focus-check.mjs
     PW=/path/to/playwright/index.mjs node tools/worksheet-focus-check.mjs
     WF_SCREENSHOTS=/some/dir node tools/worksheet-focus-check.mjs
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) {
  console.log('worksheet-focus-check: no Playwright at ' + PW + ' — skipped.');
  process.exit(0);
}

const FILE = pathToFileURL(path.resolve(process.argv[2] || 'index.html')).href;
const SHOTS = process.env.WF_SCREENSHOTS || '';
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

/* An in-memory Firestore just big enough for the class list and the marks. */
function seed(role) {
  const DEL = { __del: true };
  window.__writes = [];
  window.__courses = {
    k1: { title: 'P5 Maths · Monday 5pm', worksheetIds: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], currentIndex: 1, releasedThrough: 6 }
  };
  const apply = (obj, upd) => { for (const k of Object.keys(upd)) { if (upd[k] === DEL) delete obj[k]; else obj[k] = upd[k]; } };
  const ref = (coll, id) => ({ coll, id, set: async (v) => { window.__writes.push({ coll, id, v }); if (coll === 'onlineCourses') apply(window.__courses[id], v); } });
  firebase = { firestore: { FieldValue: { serverTimestamp: () => 'now', delete: () => DEL } } };
  db = {
    collection: (coll) => ({ doc: (id) => ref(coll, id) }),
    runTransaction: async (fn) => fn({
      get: async (r) => ({ exists: !!window.__courses[r.id], data: () => JSON.parse(JSON.stringify(window.__courses[r.id])) }),
      set: (r, v) => { window.__writes.push({ coll: r.coll, id: r.id, v }); apply(window.__courses[r.id], v); }
    }),
    batch: () => {
      const ops = [];
      return { set: (r, v) => ops.push({ coll: r.coll, id: r.id, v }), commit: async () => { window.__writes.push(...ops); } };
    }
  };
  const mk = (id, name, slot, extra) => ({ id, data: Object.assign({
    name, wsDay: 'Monday', wsDate: '2026-11-16', wsSlot: slot, level: 'P5', subject: 'math', pageCount: 2
  }, extra || {}) });
  const docs = [
    mk('c1', 'Fractions — worksheet 1', 1, { onlineCourseId: 'k1', onlineSeq: 0 }),
    mk('c2', 'Fractions — worksheet 2', 1, { onlineCourseId: 'k1', onlineSeq: 1 }),
    mk('c3', 'Fractions — worksheet 3', 1, { onlineCourseId: 'k1', onlineSeq: 2 }),
    mk('c4', 'Fractions — worksheet 4', 1, { onlineCourseId: 'k1', onlineSeq: 3 }),
    mk('c5', 'Fractions — worksheet 5', 1, { onlineCourseId: 'k1', onlineSeq: 4 }),
    mk('t1', 'Trial lesson — heat', 0, { subject: 'science' }),
    mk('t2', 'Trial lesson — light', 0, { subject: 'science', wsFocus: 'current' }),
    mk('o1', 'Loose practice', 2)
  ];
  if (role === 'student') {
    currentUser = { uid: 'stu-1', email: 'kid@example.com' };
    studentProfile = { name: 'Kid', level: 'P5', subject: 'both', days: ['Monday'], slot: 1 };
  } else {
    currentUser = { uid: 'teacher', email: ADMIN_EMAIL };
    studentProfile = null;
  }
  actingStudent = null;
  try { applyRoleUI(); } catch (e) {}
  onlineCourses = {};
  Object.keys(window.__courses).forEach((id) => { onlineCourses[id] = Object.assign({ id }, JSON.parse(JSON.stringify(window.__courses[id]))); });
  onlineCoursesLoaded = true;
  qDocs = docs;
  qSubjectFilter = 'all';
  qDayFilter = 'Monday';
  $('qDrawer').classList.add('open');
  qQueuedOpen = true;   // the class list's later worksheets wait in Queued
  renderQuestionList();
  // Open every lesson time, so the cards can be measured.
  document.querySelectorAll('#qList .qSlotSection').forEach((s) => qSlotSetOpen(s, true, false));
}

const measure = () => {
  const card = (id) => {
    const b = document.querySelector('#qList .qItem[data-qid="' + id + '"]');
    if (!b) return null;
    const cs = getComputedStyle(b);
    const r = b.getBoundingClientRect();
    return {
      cls: b.className, shadow: cs.boxShadow, border: cs.borderTopColor, bw: parseFloat(cs.borderTopWidth),
      tag: (b.querySelector('.qClassTag') || {}).textContent || '', w: r.width, right: r.right,
      focusBtn: !!b.parentNode.querySelector('.qFocusBtn')
    };
  };
  const heads = Array.prototype.map.call(document.querySelectorAll('#qList .qSlotHead'), (h) => ({ slot: h.getAttribute('data-slot'), cls: h.className, text: h.textContent }));
  const list = document.getElementById('qList').getBoundingClientRect();
  return { c1: card('c1'), c2: card('c2'), c3: card('c3'), c4: card('c4'), c5: card('c5'), t1: card('t1'), t2: card('t2'), o1: card('o1'), heads, listRight: list.right };
};
// The widest inset ring in a computed box-shadow (the border it draws).
const ring = (shadow) => {
  let best = 0;
  String(shadow || '').split(/,(?![^(]*\))/).forEach((part) => {
    if (!/inset/.test(part)) return;
    const nums = part.replace(/rgba?\([^)]*\)/g, '').match(/-?\d+(\.\d+)?px/g) || [];
    if (nums.length >= 4) best = Math.max(best, parseFloat(nums[3]));
  });
  return best;
};

/* ---------- The teacher ---------- */
{
  const { ctx, page, errors } = await open({ width: 1280, height: 860 });
  ok('the page loads with no uncaught error', errors.length === 0, errors.join('\n      '));
  await page.evaluate(seed, 'teacher');
  let m = await page.evaluate(measure);
  ok('the class is on worksheet 2: it is the current one', /focusCurrent/.test(m.c2.cls) && /Current worksheet/.test(m.c2.tag), m.c2.cls);
  ok('worksheet 3 is the next one', /focusNext/.test(m.c3.cls) && /Next worksheet/.test(m.c3.tag), m.c3.cls);
  const cur = m.c2.bw + ring(m.c2.shadow), nxt = m.c3.bw + ring(m.c3.shadow), plainW = m.c1.bw + ring(m.c1.shadow);
  ok('the current border is thick (5px or more)', cur >= 5, cur + 'px');
  ok('the next border is clear, lighter than current and heavier than an ordinary card', nxt >= 3 && nxt < cur && nxt > plainW, nxt + 'px vs ' + cur + ' / ' + plainW);
  ok('current is green, next is blue', /rgb\(11, 122, 85\)/.test(m.c2.border) && /rgb\(53, 80, 200\)/.test(m.c3.border), m.c2.border + ' / ' + m.c3.border);
  ok('a trial worksheet marked by hand is current too', /focusCurrent/.test(m.t2.cls) && /set by you/.test(m.t2.tag), m.t2.tag);
  ok('every card the teacher can teach has a 📌 button', m.c1.focusBtn && m.c2.focusBtn && m.t1.focusBtn && m.o1.focusBtn);
  const overlap = await page.evaluate(() => {
    const row = document.querySelector('#qList .qItemRow[data-qid="c2"]');
    const a = row.querySelector('.qFocusBtn').getBoundingClientRect();
    const card = row.querySelector('.qItem').getBoundingClientRect();
    const fin = row.querySelector('.qFinishBtn');
    const f = fin ? fin.getBoundingClientRect() : null;
    return { inCard: a.top >= card.top && a.bottom <= card.bottom, clear: !f || a.bottom <= f.top || a.top >= f.bottom, hasFinish: !!fin };
  });
  ok('the 📌 sits on its card, clear of ✓ Finished', overlap.hasFinish && overlap.inCard && overlap.clear, JSON.stringify(overlap));
  const slot1 = m.heads.find((h) => h.slot === '1'), slot0 = m.heads.find((h) => h.slot === '0');
  ok('the lesson time says it holds the current and next worksheets', /holdsCurrent/.test(slot1.cls) && /▶ Current/.test(slot1.text) && /⏭ Next/.test(slot1.text), slot1.text);
  ok('the trial lesson time says it holds a current one', /holdsCurrent/.test(slot0.cls), slot0.cls);
  if (SHOTS) await page.waitForTimeout(450);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'list-borders.png'), clip: await page.evaluate(() => { const r = document.getElementById('qDrawer').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: Math.min(r.height, 860) }; }) });

  // The menu opens from the card and does not open the worksheet.
  await page.evaluate(() => { window.__opened = 0; window.__origOpen = openSavedDoc; openSavedDoc = async () => { window.__opened++; }; });
  await page.click('#qList .qItemRow[data-qid="c5"] .qFocusBtn');
  let menu = await page.evaluate(() => {
    const el = document.querySelector('.wsfMenu');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { rows: Array.prototype.map.call(el.querySelectorAll('.wsfRow'), (b) => b.textContent), r: { l: r.left, t: r.top, w: r.width, h: r.height }, active: document.activeElement && document.activeElement.className };
  });
  ok('📌 opens the menu', !!menu && menu.rows.length >= 3, JSON.stringify(menu));
  ok('…without opening the worksheet', await page.evaluate(() => window.__opened === 0));
  ok('the menu is on screen', menu && menu.r.l >= 0 && menu.r.t >= 0 && menu.r.l + menu.r.w <= 1280 && menu.r.t + menu.r.h <= 860, JSON.stringify(menu && menu.r));
  ok('the first choice has the focus', menu && /wsfRow/.test(menu.active || ''), menu && menu.active);
  if (SHOTS) await page.waitForTimeout(450);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'menu.png') });
  const toolBefore = await page.evaluate(() => typeof currentTool !== 'undefined' ? currentTool : (typeof tool !== 'undefined' ? tool : ''));
  await page.keyboard.press('l');
  await page.keyboard.press('h');
  const toolAfter = await page.evaluate(() => typeof currentTool !== 'undefined' ? currentTool : (typeof tool !== 'undefined' ? tool : ''));
  ok('letters typed in the menu never reach the tool shortcuts', toolBefore === toolAfter, toolBefore + ' → ' + toolAfter);
  await page.keyboard.press('ArrowDown');
  ok('arrow keys move between the choices', await page.evaluate(() => /wsfAct-next/.test(document.activeElement.className)));
  await page.keyboard.press('Escape');
  ok('Escape closes it', await page.evaluate(() => !document.querySelector('.wsfMenu')));

  // Make worksheet 5 the next one.
  await page.click('#qList .qItemRow[data-qid="c5"] .qFocusBtn');
  await page.click('.wsfMenu .wsfAct-next');
  await page.waitForTimeout(150);
  m = await page.evaluate(measure);
  const course = await page.evaluate(() => window.__courses.k1);
  ok('Make next writes the pointer to the class list', course.nextIndex === 4 && course.nextDocId === 'c5', JSON.stringify(course));
  ok('the list redraws: worksheet 5 is next, worksheet 3 is not', /focusNext/.test(m.c5.cls) && !/focusNext/.test((m.c3 || { cls: '' }).cls) && /set by you/.test(m.c5.tag), m.c5.cls + ' | ' + (m.c3 && m.c3.cls));
  ok('…and worksheet 3 waits in Queued now', await page.evaluate(() => !!document.querySelector('.qQueuedGroup .qItem[data-qid="c3"]')));
  await page.evaluate(() => document.querySelectorAll('#qList .qSlotSection').forEach((s) => qSlotSetOpen(s, true, false)));

  // Make worksheet 1 current (moving the class back).
  await page.evaluate(() => document.querySelectorAll('#qList .qSlotSection').forEach((s) => qSlotSetOpen(s, true, false)));
  await page.click('#qList .qItemRow[data-qid="c1"] .qFocusBtn');
  await page.click('.wsfMenu .wsfAct-current');
  await page.waitForTimeout(150);
  const back = await page.evaluate(() => window.__courses.k1);
  ok('Make current writes currentIndex — what Polymath Online reads — and may go back', back.currentIndex === 0 && back.currentDocId === 'c1', JSON.stringify(back));
  ok('…and never takes a release back', back.releasedThrough === 6);
  m = await page.evaluate(measure);
  ok('worksheet 1 wears the thick border now', /focusCurrent/.test(m.c1.cls) && !/focusCurrent/.test(m.c2.cls));

  // A trial worksheet in no class list.
  await page.evaluate(() => document.querySelectorAll('#qList .qSlotSection').forEach((s) => qSlotSetOpen(s, true, false)));
  await page.click('#qList .qItemRow[data-qid="t1"] .qFocusBtn');
  await page.click('.wsfMenu .wsfAct-current');
  await page.waitForTimeout(150);
  const writes = await page.evaluate(() => window.__writes.filter((w) => w.coll === 'pdfAnnotator'));
  ok('marking a trial worksheet writes its own document', writes.some((w) => w.id === 't1' && w.v.wsFocus === 'current'), JSON.stringify(writes));
  ok('…and takes the mark off the one that held it in that lesson time', writes.some((w) => w.id === 't2' && w.v.wsFocus && w.v.wsFocus.__del));
  m = await page.evaluate(measure);
  ok('the list shows the trial mark moved', /focusCurrent/.test(m.t1.cls) && !/focusCurrent/.test(m.t2.cls));

  // A tap outside closes the menu.
  await page.evaluate(() => document.querySelectorAll('#qList .qSlotSection').forEach((s) => qSlotSetOpen(s, true, false)));
  await page.click('#qList .qItemRow[data-qid="o1"] .qFocusBtn');
  await page.mouse.click(700, 400);
  ok('a tap outside closes the menu', await page.evaluate(() => !document.querySelector('.wsfMenu')));

  // The frame round the open page.
  const frame = await page.evaluate(() => {
    pdfDoc = {};
    currentDocId = 'c1';
    onlineDocCache.c1 = qDocs[0].data;
    renderSidebar();
    const f = document.querySelector('.wsfFrame');
    const pill = document.getElementById('wsFocusPill');
    const v = document.getElementById('viewerArea').getBoundingClientRect();
    if (!f) return null;
    const r = f.getBoundingClientRect();
    return { cls: f.className, bw: parseFloat(getComputedStyle(f).borderTopWidth), pe: getComputedStyle(f).pointerEvents,
      fit: Math.abs(r.left - v.left) < 2 && Math.abs(r.width - v.width) < 2, pill: pill.style.display !== 'none' && pill.textContent };
  });
  ok('the open current worksheet is framed thick and green', frame && /on current/.test(frame.cls) && frame.bw >= 6, JSON.stringify(frame));
  ok('the frame sits exactly over the page and takes no pointer', frame && frame.fit && frame.pe === 'none', JSON.stringify(frame));
  ok('the sidebar says it in words', frame && /Current worksheet/.test(frame.pill || ''), frame && frame.pill);
  const nextFrame = await page.evaluate(() => { currentDocId = 'c5'; onlineDocCache.c5 = qDocs[4].data; renderSidebar(); const f = document.querySelector('.wsfFrame'); return { cls: f.className, bw: parseFloat(getComputedStyle(f).borderTopWidth) }; });
  ok('the next worksheet is framed in clear blue, lighter', /on next/.test(nextFrame.cls) && nextFrame.bw >= 3 && nextFrame.bw < frame.bw, JSON.stringify(nextFrame));
  const hiddenInRec = await page.evaluate(() => { document.body.classList.add('lessonScreenRec'); const d = getComputedStyle(document.querySelector('.wsfFrame')).display; document.body.classList.remove('lessonScreenRec'); return d; });
  ok('never in a recording of the worksheet window', hiddenInRec === 'none');
  if (SHOTS) await page.waitForTimeout(450);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'frame-next.png') });
  const off = await page.evaluate(() => { wsFocusCtl.setFrame(false); const d = getComputedStyle(document.querySelector('.wsfFrame')).display; wsFocusCtl.setFrame(true); return d; });
  ok('the frame can be switched off', off === 'none');
  ok('no uncaught error through all of it', errors.length === 0, errors.join('\n      '));
  await ctx.close();
}

/* ---------- A student ---------- */
{
  const { ctx, page, errors } = await open({ width: 1280, height: 860 });
  await page.evaluate(seed, 'student');
  const m = await page.evaluate(measure);
  ok('a student sees where the class is', m.c2 && /focusCurrent/.test(m.c2.cls), m.c2 && m.c2.cls);
  ok('…but no 📌 anywhere', await page.evaluate(() => !document.querySelector('.qFocusBtn')));
  const refused = await page.evaluate(async () => { await wsFocusAct(qDocs[0], 'current'); return window.__writes.length; });
  ok('a press from a student writes nothing', refused === 0);
  ok('no uncaught error', errors.length === 0, errors.join('\n      '));
  await ctx.close();
}

/* ---------- A phone ---------- */
{
  const { ctx, page, errors } = await open({ width: 390, height: 780 });
  await page.evaluate(seed, 'teacher');
  const m = await page.evaluate(measure);
  ok('on a phone the bordered card stays inside the list', m.c2 && m.c2.right <= m.listRight + 1, m.c2 && (m.c2.right + ' vs ' + m.listRight));
  await page.click('#qList .qItemRow[data-qid="c4"] .qFocusBtn');
  const r = await page.evaluate(() => { const el = document.querySelector('.wsfMenu'); const b = el.getBoundingClientRect(); return { l: b.left, w: b.width, t: b.top, h: b.height }; });
  ok('the menu fits a phone', r.l >= 0 && r.l + r.w <= 390 && r.t >= 0 && r.t + r.h <= 780, JSON.stringify(r));
  if (SHOTS) await page.waitForTimeout(450);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-menu.png') });
  ok('no uncaught error', errors.length === 0, errors.join('\n      '));
  await ctx.close();
}

await browser.close();
console.log('\nworksheet-focus-check: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
