// 📌 Current and next worksheet (v1.200.0): the thick / clear borders and the
// manual override. Runs the REAL Polymath Online section out of index.html
// (where every decision lives) and the real worksheet-focus.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WF = require('../worksheet-focus.js');
const plain = (v) => JSON.parse(JSON.stringify(v));

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../worksheet-focus.css', import.meta.url), 'utf8');
const src = fs.readFileSync(new URL('../worksheet-focus.js', import.meta.url), 'utf8');
function cut(start, end) {
  const i = html.indexOf(start);
  assert.ok(i >= 0, 'missing ' + start);
  const j = html.indexOf(end, i);
  assert.ok(j > i, 'missing ' + end);
  return html.slice(i, j + end.length);
}
const online = cut('/* ================= 🎓 Polymath Online', '/* ================= End Polymath Online ================= */');
const glue = cut('/* ================= 📌 Current and next worksheet — glue', '/* ================= End current and next worksheet glue ================= */');
const DEL = '__delete__';
const TEACHER = { email: 'teacher@example.test' };
const KID = { email: 'kid@example.test' };
const tenSheets = () => ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9', 'w10'];

function fakeNode() {
  const listeners = {};
  const attrs = {};
  return {
    hidden: false, textContent: '', title: '', className: '', dataset: {}, style: {}, disabled: false,
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); }, toggle(c, on) { if (on === undefined) on = !this._s.has(c); on ? this._s.add(c) : this._s.delete(c); return on; } },
    children: [],
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return attrs[k] ?? null; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type, ev) { (listeners[type] || []).forEach((fn) => fn(ev || { stopPropagation() {}, preventDefault() {} })); },
    replaceChildren(...kids) { this.children = kids; },
    appendChild(k) { this.children.push(k); return k; },
    append(...kids) { this.children.push(...kids); },
    querySelectorAll() { return []; },
    remove() {}
  };
}

function makeContext(overrides = {}) {
  const nodes = {};
  const writes = [];
  const ctx = {
    console, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, Promise, Math, Number, Array, Object, JSON, String, URL, Blob: class {}, Response: class {},
    location: { search: '' }, URLSearchParams,
    localStorage: { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); } },
    document: { hidden: false, createElement: () => fakeNode(), querySelector: () => null, addEventListener() {}, body: fakeNode() },
    $: (id) => (nodes[id] = nodes[id] || fakeNode()),
    toast: (msg) => { ctx.toasts.push(msg); }, toasts: [],
    auth: { onAuthStateChanged() {} },
    db: {
      collection: (name) => ({ doc: (id) => ({ name, id, set: async (v, o) => { writes.push({ name, id, v, o }); } }) }),
      runTransaction: async () => null,
      batch: () => {
        const ops = [];
        return { set: (ref, v, o) => ops.push({ name: ref.name, id: ref.id, v, o }), commit: async () => { writes.push(...ops); } };
      }
    },
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'now', delete: () => DEL } } },
    storage: { ref: () => ({ getDownloadURL: async () => 'x' }) },
    isAdmin: (u) => !!u && u.email === TEACHER.email,
    isSharedVisitor: () => false,
    actingStudent: null, practiceMode: false, currentUser: null, currentDocId: null, pdfDoc: null,
    COLLECTION: 'pdfAnnotator', DAY_UNDATED: 'Undated',
    lessonTeacher: () => true, lessonBusy: () => false, lessonPlayback: null,
    loadQuestionsList() {}, openSavedDoc: async () => {}, canSeeDoc: () => true,
    ...overrides
  };
  ctx.nodes = nodes;
  ctx.writes = writes;
  vm.createContext(ctx);
  vm.runInContext(online + '\n' + glue, ctx);
  return ctx;
}
// A transaction against one in-memory course; deletes are applied as deletes.
function courseTx(course, log) {
  return async (fn) => fn({
    get: async () => ({ exists: true, data: () => course }),
    set: (_ref, upd) => {
      log.push(upd);
      for (const [k, v] of Object.entries(upd)) { if (v === DEL) delete course[k]; else course[k] = v; }
    }
  });
}

/* ---------------- the class list: a manual Next ---------------- */

test('a manual Next moves the Next tag, and a bad pointer is no override at all', () => {
  const c = makeContext();
  const course = { worksheetIds: tenSheets(), currentIndex: 2, nextIndex: 6 };
  assert.deepEqual(plain(tenSheets().map((_, i) => c.onlineQueueState(course, i))),
    ['done', 'done', 'current', 'queued', 'queued', 'queued', 'next', 'queued', 'queued', 'queued']);
  assert.equal(c.onlineNextAt(course), 6);
  assert.equal(c.onlineManualNext(course), 6);
  // A worksheet earlier in the list can be the next one (a lesson taught again).
  assert.equal(c.onlineQueueState({ worksheetIds: tenSheets(), currentIndex: 4, nextIndex: 1 }, 1), 'next');
  assert.equal(c.onlineQueueState({ worksheetIds: tenSheets(), currentIndex: 4, nextIndex: 1 }, 5), 'queued');
  for (const bad of [4, -1, 99, 'x', NaN, null, undefined]) {
    const cc = { worksheetIds: tenSheets(), currentIndex: 4, nextIndex: bad };
    assert.equal(c.onlineManualNext(cc), -1, 'not an override: ' + bad);
    assert.equal(c.onlineNextAt(cc), 5, 'follows on: ' + bad);
  }
  assert.equal(c.onlineNextAt({ worksheetIds: ['a', 'b'], currentIndex: 1 }), -1, 'the last one has no next');
  assert.equal(c.onlineNextAt({ worksheetIds: ['a', 'b', 'c'], currentIndex: 2, nextIndex: 0 }), 0, 'but a manual next still works there');
  assert.equal(c.onlineNextAt({ worksheetIds: [] }), -1);
});

test('the tag says when the teacher set the next one', () => {
  const c = makeContext({ currentUser: TEACHER });
  c.onlineCourses = { k1: { id: 'k1', title: 'P5 Maths', worksheetIds: tenSheets(), currentIndex: 2, nextIndex: 6 } };
  const place = c.onlineDocPlace('w7', { onlineCourseId: 'k1' });
  assert.equal(place.state, 'next');
  assert.equal(place.manual, true);
  assert.equal(c.onlineTagText(place), '⏭ Next worksheet · set by you');
  assert.equal(c.onlineTagText(c.onlineDocPlace('w3', { onlineCourseId: 'k1' })), '▶ Current worksheet', 'current is never "set by you" here');
  assert.equal(c.onlineDocPlace('w4', { onlineCourseId: 'k1' }).state, 'queued', 'the one after current waits now');
  c.onlineCourses.k1.nextIndex = 3;
  assert.equal(c.onlineDocPlace('w4', { onlineCourseId: 'k1' }).manual, true);
});

test('Finished loads the manual Next, releasing as opening it would', () => {
  const c = makeContext();
  const course = { worksheetIds: tenSheets(), currentIndex: 2, releasedThrough: 7, nextIndex: 6 };
  assert.deepEqual(plain(c.onlineFinishUpdate(course, 'w3')),
    { currentIndex: 6, currentDocId: 'w7', releasedThrough: 9, lastFinishedIndex: 2, lastFinishedDocId: 'w3' });
  const back = { worksheetIds: tenSheets(), currentIndex: 5, releasedThrough: 9, nextIndex: 1 };
  assert.equal(c.onlineFinishUpdate(back, 'w6').currentIndex, 1, 'back to a worksheet taught before');
  assert.equal(c.onlineFinishUpdate(back, 'w6').releasedThrough, 9, 'nothing released is taken away');
  assert.equal(c.onlineFinishUpdate({ worksheetIds: ['a', 'b'], currentIndex: 1, nextIndex: 0 }, 'b').currentIndex, 0,
    'the last worksheet can still be finished onto a manual next');
});

test('the Finished button uses the pointer up, and names the right worksheets', async () => {
  const log = [];
  const course = { title: 'P6 Science', worksheetIds: tenSheets(), currentIndex: 2, releasedThrough: 7, nextIndex: 6, nextDocId: 'w7' };
  const c = makeContext({ currentUser: TEACHER });
  c.db.runTransaction = courseTx(course, log);
  c.onlineCourses = { k1: Object.assign({ id: 'k1' }, course) };
  const btn = c.onlineFinishBtn({ id: 'w3', data: { onlineCourseId: 'k1' } });
  assert.match(btn.title, /Worksheet 7 becomes the current worksheet, and worksheet 8 loads/);
  await c.onlineFinishCurrent('w3', { onlineCourseId: 'k1' }, null);
  assert.equal(course.currentIndex, 6);
  assert.equal('nextIndex' in course, false, 'the pointer is used up');
  assert.equal('nextIndex' in c.onlineCourses.k1, false, 'and on this device at once');
  assert.match(c.toasts.at(-1), /Worksheet 3 finished.*Worksheet 7 is now the current worksheet, and worksheet 8 is loaded as the next one/);
});

test('opening the manual Next makes it current, even an earlier one; any move uses the pointer up', async () => {
  const log = [];
  const course = { worksheetIds: tenSheets(), currentIndex: 5, releasedThrough: 9, nextIndex: 1 };
  const c = makeContext({ currentUser: TEACHER });
  c.db.runTransaction = courseTx(course, log);
  await c.onlineWorksheetOpened('w2', { onlineCourseId: 'k1' });
  assert.equal(course.currentIndex, 1, 'opened the worksheet set as next: the class is on it');
  assert.equal('nextIndex' in course, false);
  // A plain reopen of an old one still never moves the class back.
  await c.onlineWorksheetOpened('w1', { onlineCourseId: 'k1' });
  assert.equal(course.currentIndex, 1);
  // Moving on past a pointer clears it.
  course.nextIndex = 8;
  await c.onlineWorksheetOpened('w4', { onlineCourseId: 'k1' });
  assert.equal(course.currentIndex, 3);
  assert.equal('nextIndex' in course, false);
});

test('Up next and the fetch-ahead follow the manual Next', () => {
  const c = makeContext({ currentUser: TEACHER });
  c.onlineCourses = { k1: { id: 'k1', worksheetIds: tenSheets(), currentIndex: 2, releasedThrough: 9, nextIndex: 6 } };
  const info = c.onlineNextFor('w3', { onlineCourseId: 'k1' });
  assert.deepEqual(plain(info.next.map((n) => n.id)), ['w7', 'w8'], 'from the current one, next is the one set by hand');
  const away = c.onlineNextFor('w5', { onlineCourseId: 'k1' });
  assert.deepEqual(plain(away.next.map((n) => n.id)), ['w6', 'w7'], 'planning from another sheet counts on from it');
  c.currentUser = KID;
  const kid = c.onlineNextFor('w1', { onlineCourseId: 'k1' });
  assert.deepEqual(plain(kid.next.map((n) => n.id)), ['w7', 'w8'], 'a student sees the class\'s next one');
  c.currentUser = TEACHER;
  const day = c.ONLINE_DAY_NAMES[new Date(2026, 10, 16).getDay()];
  c.onlineCourses.k1.day = day;
  c.onlineDocData = async () => null;
  assert.deepEqual(plain(c.onlinePreloadNext(new Date(2026, 10, 16))), ['w3', 'w7']);
});

/* ---------------- the class list: Make current / Make next ---------------- */

test('Make current writes what Polymath Online reads, may go back, never un-releases', () => {
  const c = makeContext();
  const course = { worksheetIds: tenSheets(), currentIndex: 4, releasedThrough: 6 };
  assert.deepEqual(plain(c.onlineSetCurrentUpdate(course, 'w9')),
    { currentIndex: 8, currentDocId: 'w9', releasedThrough: 9, lastManualIndex: 8, lastManualFrom: 4 });
  assert.deepEqual(plain(c.onlineSetCurrentUpdate(course, 'w2')),
    { currentIndex: 1, currentDocId: 'w2', releasedThrough: 6, lastManualIndex: 1, lastManualFrom: 4 }, 'back, release kept');
  assert.equal(c.onlineSetCurrentUpdate(course, 'w5'), null, 'already there');
  assert.equal(c.onlineSetCurrentUpdate(course, 'nope'), null);
  assert.equal(c.onlineSetCurrentUpdate({ worksheetIds: tenSheets(), currentIndex: -1, releasedThrough: -1 }, 'w1').releasedThrough, 3,
    'starting a class on worksheet 1 by hand releases as opening it would');
});

test('Make next: a pointer, nothing for the one that follows anyway, refused on the current one', () => {
  const c = makeContext();
  const course = { worksheetIds: tenSheets(), currentIndex: 4 };
  assert.deepEqual(plain(c.onlineSetNextUpdate(course, 'w8')), { nextIndex: 7, nextDocId: 'w8' });
  assert.deepEqual(plain(c.onlineSetNextUpdate(course, 'w1')), { nextIndex: 0, nextDocId: 'w1' });
  assert.deepEqual(plain(c.onlineSetNextUpdate(course, 'w6')), { auto: true });
  assert.equal(c.onlineSetNextUpdate(course, 'w5'), null);
  assert.equal(c.onlineSetNextUpdate(course, 'gone'), null);
  assert.equal(c.onlineNextSurvives({ worksheetIds: tenSheets(), nextIndex: 7 }, 3), true);
  assert.equal(c.onlineNextSurvives({ worksheetIds: tenSheets(), nextIndex: 7 }, 7), false, 'a pointer at the new current is used up');
  assert.equal(c.onlineNextSurvives({ worksheetIds: tenSheets() }, 3), false);
});

test('the override writes go through the class list, and only for the teacher', async () => {
  const log = [];
  const course = { title: 'P5 Maths', worksheetIds: tenSheets(), currentIndex: 4, releasedThrough: 6, nextIndex: 2 };
  const c = makeContext({ currentUser: TEACHER });
  c.db.runTransaction = courseTx(course, log);
  c.onlineCourses = { k1: Object.assign({ id: 'k1' }, course) };
  await c.onlineSetCurrent('w2', { onlineCourseId: 'k1' });
  assert.equal(course.currentIndex, 1);
  assert.equal(course.releasedThrough, 6);
  assert.equal(log.at(-1).manualAt, 'now');
  assert.equal(course.nextIndex, 2, 'a manual next elsewhere survives');
  assert.match(c.toasts.at(-1), /Worksheet 2 of 10 is now the current worksheet of P5 Maths \(moved back from worksheet 5\)/);
  await c.onlineSetCurrent('w3', { onlineCourseId: 'k1' });
  assert.equal('nextIndex' in course, false, 'made current: its pointer goes');
  await c.onlineSetNext('w9', { onlineCourseId: 'k1' });
  assert.equal(course.nextIndex, 8);
  assert.equal(c.onlineCourses.k1.nextIndex, 8, 'this device knows at once');
  await c.onlineSetNext('w4', { onlineCourseId: 'k1' });
  assert.equal('nextIndex' in course, false, 'the one that follows on: pointer off');
  await c.onlineSetNext('w3', { onlineCourseId: 'k1' });
  assert.match(c.toasts.at(-1), /choose another one as next/);
  course.nextIndex = 7;
  c.onlineCourses.k1.nextIndex = 7;
  assert.equal(await c.onlineClearNext('w8', { onlineCourseId: 'k1' }), true);
  assert.equal(c.writes.at(-1).v.nextIndex, DEL);
  assert.equal('nextIndex' in c.onlineCourses.k1, false);

  let ran = false;
  const kid = makeContext({ currentUser: KID });
  kid.db.runTransaction = async () => { ran = true; };
  assert.equal(await kid.onlineSetCurrent('w2', { onlineCourseId: 'k1' }), null);
  assert.equal(await kid.onlineSetNext('w2', { onlineCourseId: 'k1' }), null);
  assert.equal(await kid.onlineClearNext('w2', { onlineCourseId: 'k1' }), false);
  const handed = makeContext({ currentUser: TEACHER, actingStudent: { uid: 's1' } });
  handed.db.runTransaction = async () => { ran = true; };
  assert.equal(await handed.onlineSetCurrent('w2', { onlineCourseId: 'k1' }), null, 'handed over: not the teacher here');
  assert.equal(ran, false);
});

/* ---------------- worksheets in no class list: the mark ---------------- */

test('a loose worksheet is marked by wsFocus; a class worksheet ignores it', () => {
  const c = makeContext();
  assert.equal(c.onlineLooseMark({ wsFocus: 'current' }), 'current');
  assert.equal(c.onlineLooseMark({ wsFocus: 'next' }), 'next');
  assert.equal(c.onlineLooseMark({ wsFocus: 'boss' }), '');
  assert.equal(c.onlineLooseMark({ wsFocus: 'current', onlineCourseId: 'k1' }), '', 'the class list is the truth');
  assert.equal(c.onlineLooseMark(null), '');
  c.onlineCourses = { k1: { id: 'k1', worksheetIds: ['a', 'b'], currentIndex: 0 } };
  assert.deepEqual(plain(c.onlineFocusOf({ id: 'a', data: { onlineCourseId: 'k1', wsFocus: 'next' } })).state, 'current');
  assert.deepEqual(plain(c.onlineFocusOf({ id: 'x', data: { wsFocus: 'next' } })), { state: 'next', source: 'mark', manual: true, place: null });
  assert.deepEqual(plain(c.onlineFocusOf({ id: 'x', data: {} })), { state: '', source: '', manual: false, place: null });
  assert.equal(c.onlinePinRank({ id: 'x', data: { wsFocus: 'current' } }), 0, 'a marked one leads its lesson time');
  assert.equal(c.onlinePinRank({ id: 'x', data: { wsFocus: 'next' } }), 1);
  assert.equal(c.onlinePinRank({ id: 'x', data: {} }), 2);
});

test('one mark per lesson time: the same day and slot lose it, others keep theirs', () => {
  const c = makeContext();
  const items = [
    { id: 'a', data: { wsDay: 'Monday', wsSlot: 1, wsFocus: 'current' } },
    { id: 'b', data: { wsDay: 'Monday', wsSlot: 1 } },
    { id: 'c', data: { wsDay: 'Monday', wsSlot: 2, wsFocus: 'current' } },
    { id: 'd', data: { wsDay: 'Tuesday', wsSlot: 1, wsFocus: 'current' } },
    { id: 'e', data: { wsDay: 'Monday', wsSlot: 1, wsFocus: 'next' } },
    { id: 'f', data: { wsDay: 'Monday', wsSlot: 1, wsFocus: 'current', onlineCourseId: 'k1' } }
  ];
  assert.deepEqual(plain(c.onlineLooseClears(items, 'b', 'current')), ['a']);
  assert.deepEqual(plain(c.onlineLooseClears(items, 'b', 'next')), ['e']);
  assert.deepEqual(plain(c.onlineLooseClears(items, 'a', 'current')), [], 'it already holds it');
  assert.deepEqual(plain(c.onlineLooseClears(items, 'b', 'bogus')), []);
  assert.deepEqual(plain(c.onlineLooseClears(items, 'zz', 'current')), []);
});

test('marking writes one batch: the mark on, the old holder off, and the list follows', async () => {
  const c = makeContext({ currentUser: TEACHER });
  const a = { id: 'a', data: { name: 'Trial A', wsDay: 'Monday', wsSlot: 1, wsFocus: 'current' } };
  const b = { id: 'b', data: { name: 'Trial B', wsDay: 'Monday', wsSlot: 1 } };
  vm.runInContext('var qDocs = [];', c);
  c.qDocs.push(a, b);
  assert.equal(await c.onlineMarkLoose(b, 'current'), true);
  const byId = Object.fromEntries(c.writes.map((w) => [w.id, w.v]));
  assert.equal(byId.b.wsFocus, 'current');
  assert.equal(byId.a.wsFocus, DEL);
  assert.equal(c.writes.every((w) => w.o && w.o.merge === true), true, 'merge writes: a save never clears it');
  assert.equal(b.data.wsFocus, 'current');
  assert.equal('wsFocus' in a.data, false);
  assert.match(c.toasts.at(-1), /Trial B.*current worksheet of its lesson time/);
  assert.equal(await c.onlineMarkLoose(b, ''), true);
  assert.equal('wsFocus' in b.data, false);
  assert.equal(await c.onlineMarkLoose({ id: 'k', data: { onlineCourseId: 'k1' } }, 'current'), false, 'class worksheets go through their list');
  assert.equal(await c.onlineMarkLoose(b, 'bogus'), false);
  const kid = makeContext({ currentUser: KID });
  assert.equal(await kid.onlineMarkLoose(b, 'current'), false);
  assert.equal(kid.writes.length, 0);
});

/* ---------------- the glue ---------------- */

test('the 📌 button is the teacher\'s, and the menu\'s choice is asked again', async () => {
  const c = makeContext({ currentUser: TEACHER });
  c.onlineCourses = { k1: { id: 'k1', worksheetIds: tenSheets(), currentIndex: 2 } };
  const btn = c.wsFocusButton({ id: 'w3', data: { onlineCourseId: 'k1', name: 'W3' } });
  assert.ok(btn);
  assert.equal(btn.className, 'qFocusBtn current');
  assert.equal(c.wsFocusButton({ id: 'h', data: { hidden: true } }), null, 'a hidden worksheet is not taught');
  const calls = [];
  c.onlineSetCurrent = async (id) => calls.push(['current', id]);
  c.onlineSetNext = async (id) => calls.push(['next', id]);
  c.onlineClearNext = async (id) => calls.push(['auto', id]);
  c.onlineMarkLoose = async (it, st) => calls.push(['mark', it.id, st]);
  await c.wsFocusAct({ id: 'w5', data: { onlineCourseId: 'k1' } }, 'current');
  await c.wsFocusAct({ id: 'w5', data: { onlineCourseId: 'k1' } }, 'next');
  await c.wsFocusAct({ id: 'w5', data: { onlineCourseId: 'k1' } }, 'auto');
  await c.wsFocusAct({ id: 'x', data: {} }, 'next');
  await c.wsFocusAct({ id: 'x', data: {} }, 'auto');
  await c.wsFocusAct({ id: 'y', data: { onlineCourseId: 'unloaded' } }, 'current');
  assert.deepEqual(calls, [['current', 'w5'], ['next', 'w5'], ['auto', 'w5'], ['mark', 'x', 'next'], ['mark', 'x', '']]);
  assert.match(c.toasts.at(-1), /class list has not loaded/);
  c.currentUser = KID;
  assert.equal(c.wsFocusButton({ id: 'w3', data: { onlineCourseId: 'k1' } }), null);
  await c.wsFocusAct({ id: 'w5', data: { onlineCourseId: 'k1' } }, 'current');
  assert.equal(calls.length, 5, 'a student\'s press does nothing');
});

test('a lesson time counts the current and next worksheets it holds', () => {
  const c = makeContext({ currentUser: TEACHER });
  c.onlineCourses = { k1: { id: 'k1', worksheetIds: tenSheets(), currentIndex: 2 } };
  const items = [
    { id: 'w3', data: { onlineCourseId: 'k1' } },
    { id: 'w4', data: { onlineCourseId: 'k1' } },
    { id: 't', data: { wsFocus: 'current' } },
    { id: 'u', data: {} }
  ];
  assert.deepEqual(plain(c.wsFocusHolds(items)), { current: 2, next: 1 });
  assert.deepEqual(plain(c.wsFocusHolds([])), { current: 0, next: 0 });
});

/* ---------------- worksheet-focus.js ---------------- */

test('the frame and the pill say current / next and where', () => {
  const P = WF.pure;
  assert.deepEqual(plain(P.frameFor(null)), { state: '', label: '', detail: '' });
  assert.deepEqual(plain(P.frameFor({ state: 'done' })), { state: '', label: '', detail: '' });
  const cur = P.frameFor({ state: 'current', source: 'class', manual: false, place: { seq: 2, total: 10, course: { title: 'P5 Maths' } } });
  assert.deepEqual(plain(cur), { state: 'current', label: '▶ Current worksheet', detail: 'Worksheet 3 of 10 · P5 Maths' });
  const nxt = P.frameFor({ state: 'next', source: 'class', manual: true, place: { seq: 6, total: 10, course: {} } });
  assert.equal(nxt.label, '⏭ Next worksheet · set by you');
  assert.equal(P.frameFor({ state: 'next', source: 'mark', manual: true }).detail, 'Marked by you · not in a class list');
});

test('the menu: what each choice does, and none for a student', () => {
  const P = WF.pure;
  assert.deepEqual(plain(P.menuModel({ teacher: false, name: 'X' }).rows), []);
  const place = (seq, state, manual) => ({ state, source: 'class', manual: !!manual, place: { seq, total: 10, course: { title: 'P5' } } });
  let m = P.menuModel({ teacher: true, focus: place(2, 'current'), manualNext: -1, followsOn: 3, name: 'W3', frameOn: true });
  assert.deepEqual(m.rows.map((r) => r.act), ['current', 'next', 'frame']);
  assert.equal(m.rows[0].disabled, true, 'already current');
  assert.equal(m.rows[1].disabled, true, 'the current one cannot be next');
  assert.match(m.sub, /Worksheet 3 of 10 · P5/);
  m = P.menuModel({ teacher: true, focus: place(0, 'done'), manualNext: 6, followsOn: 3, name: 'W1', frameOn: false });
  assert.deepEqual(m.rows.map((r) => r.act), ['current', 'next', 'auto', 'frame']);
  assert.match(m.rows[0].hint, /BACK/);
  assert.match(m.rows[2].hint, /Worksheet 4 becomes the next worksheet/);
  assert.match(m.rows[3].label, /^☐/);
  m = P.menuModel({ teacher: true, focus: place(3, 'next', false), manualNext: -1, followsOn: 3 });
  assert.equal(m.rows[1].disabled, true, 'it already follows on');
  m = P.menuModel({ teacher: true, focus: place(6, 'next', true), manualNext: 6, followsOn: 3 });
  assert.equal(m.rows[1].disabled, false);
  m = P.menuModel({ teacher: true, focus: { state: '', source: '', place: null }, name: 'Trial' });
  assert.deepEqual(m.rows.map((r) => r.act), ['current', 'next', 'frame']);
  assert.match(m.note, /stays in Ans Key/);
  m = P.menuModel({ teacher: true, focus: { state: 'next', source: 'mark', manual: true, place: null } });
  assert.deepEqual(m.rows.map((r) => r.act), ['current', 'next', 'auto', 'frame']);
  assert.equal(m.rows[1].disabled, true);
});

test('the menu stays on screen', () => {
  const P = WF.pure;
  const r = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h });
  assert.deepEqual(plain(P.placeMenu(r(500, 100, 40, 28), 300, 260, 1024, 768)), { left: 240, top: 134, width: 300 });
  assert.deepEqual(plain(P.placeMenu(r(20, 100, 40, 28), 300, 260, 1024, 768)), { left: 12, top: 134, width: 300 }, 'slid in from the left edge');
  assert.equal(P.placeMenu(r(500, 700, 40, 28), 300, 260, 1024, 768).top, 434, 'above when there is no room below');
  assert.deepEqual(plain(P.placeMenu(r(300, 100, 40, 28), 300, 260, 320, 568)), { left: 12, top: 134, width: 296 }, 'a phone');
  assert.equal(P.placeMenu(r(300, 200, 40, 28), 300, 900, 1024, 768).top, 12, 'taller than the screen: pinned to the top, it scrolls');
});

test('the frame preference is remembered, and blocked storage still works', () => {
  const P = WF.pure;
  const store = { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = v; } };
  assert.equal(P.readPref(store), true, 'on by default');
  P.writePref(false, store);
  assert.equal(store.m[P.PREF_KEY], '0');
  assert.equal(P.readPref(store), false);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  P.writePref(true, broken);
  assert.equal(P.readPref(broken), true, 'kept in memory for the visit');
});

/* ---------------- the file itself ---------------- */

test('wired in: tags, version, the hooks, and the borders in CSS', () => {
  { const m = html.match(/var APP_VERSION = 'v1\.(\d+)\.\d+'/); assert.ok(m && +m[1] >= 200, 'APP_VERSION is v1.200.0 or later'); }
  assert.match(html, /<link rel="stylesheet" href="worksheet-focus\.css\?v=1\.200\.0">/);
  assert.match(html, /<script src="worksheet-focus\.js\?v=1\.200\.0"><\/script>\n<script>wsFocusInit\(\);<\/script>/);
  assert.match(html, /\(focus\.state === 'current' \? ' focusCurrent' : ''\)/);
  assert.match(html, /\(focus\.state === 'next' \? ' focusNext' : ''\)/);
  assert.match(html, /var focusBtn = typeof wsFocusButton === 'function' \? wsFocusButton\(item, focus\) : null;/);
  assert.match(html, /var holds = typeof wsFocusHolds === 'function' \? wsFocusHolds\(items\)/);
  assert.match(html, /if \(typeof wsFocusRoleChanged === 'function'\) wsFocusRoleChanged\(\);/);
  assert.match(html, /if \(typeof wsFocusSync === 'function'\) wsFocusSync\(\);   \/\/ 📌 current \/ next pill and frame/);
  assert.match(html, /id="wsFocusPill"/);
  // The current border is the thick one, the next border the clear one.
  const thick = /\.qItem\.focusCurrent \{[^}]*inset 0 0 0 4px var\(--wsf-cur\)/.exec(css);
  const clear = /\.qItem\.focusNext \{[^}]*inset 0 0 0 2px var\(--wsf-next\)/.exec(css);
  assert.ok(thick && clear, 'a 4px inset ring for current, 2px for next');
  assert.match(css, /\.wsfFrame\.current \{ border: 7px solid/);
  assert.match(css, /\.wsfFrame\.next \{ border: 4px solid/);
  assert.match(css, /body\.lessonScreenRec \.wsfFrame/, 'never in a recording of the worksheet window');
  assert.match(css, /@media print \{\s*\.wsfFrame/);
  assert.match(css, /\.wsfFrame \{[^}]*pointer-events: none/, 'the page under the frame is still written on');
  assert.ok(!/innerHTML/.test(src), 'textContent only');
  assert.match(src, /\['keydown', 'keyup', 'keypress'\]\.forEach\(function \(k\) \{ root\.addEventListener\(k, onMenuKey\); \}\)/, 'keys stop at the menu');
  assert.match(src, /if \(!teacher\(\)\) \{ close\(false\); return; \}/, 'asked again on the press');
});

/* ---------------- one current and one next per lesson time (v1.201.0) ---------------- */

test('a lesson time shows ONE current: a mark and a class list there, the newest wins', () => {
  const c = makeContext({ currentUser: TEACHER });
  c.onlineCourses = { k6: { id: 'k6', title: 'P6 Science', worksheetIds: ['p6a', 'p6b'], currentIndex: 1, progressAt: 1000 } };
  const classCur = { id: 'p6b', data: { name: 'P6 WS 2', onlineCourseId: 'k6', wsDay: 'Monday', wsSlot: 2 } };
  const marked = { id: 'p5x', data: { name: 'P5 WS 1', wsDay: 'Monday', wsSlot: 2, wsFocus: 'current', wsFocusAt: 5000 } };
  const elsewhere = { id: 'tue', data: { wsDay: 'Tuesday', wsSlot: 2, wsFocus: 'current', wsFocusAt: 1 } };
  vm.runInContext('var qDocs = [];', c);
  c.qDocs.push(classCur, marked, elsewhere);
  assert.equal(c.onlineFocusOf(marked).state, 'current', 'marked later: it holds the lesson time');
  const lost = plain(c.onlineFocusOf(classCur));
  assert.equal(lost.state, '');
  assert.equal(lost.heldBy, 'p5x');
  assert.equal(c.onlineCardTag(classCur), null, 'no tag on the one that lost');
  assert.equal(c.onlineFocusOf(elsewhere).state, 'current', 'another lesson time keeps its own');
  assert.deepEqual(plain(c.wsFocusHolds(c.qDocs.slice(0, 2))), { current: 1, next: 0 }, 'the heading says Current, never Current ×2');
  // The class moves on later: now the class list is the newest.
  c.onlineCourses = { k6: Object.assign({}, c.onlineCourses.k6, { progressAt: 9000 }) };
  assert.equal(c.onlineFocusOf(classCur).state, 'current');
  assert.equal(c.onlineFocusOf(marked).heldBy, 'p6b');
});

test('two classes sharing a lesson time show one current and one next', () => {
  const c = makeContext({ currentUser: TEACHER });
  c.onlineCourses = {
    k5: { id: 'k5', worksheetIds: ['a1', 'a2', 'a3'], currentIndex: 0, progressAt: { toMillis: () => 2000 } },
    k6: { id: 'k6', worksheetIds: ['b1', 'b2', 'b3'], currentIndex: 1, progressAt: { seconds: 3 } }
  };
  const slot = { wsDay: 'Monday', wsSlot: 2 };
  const items = ['a1', 'a2', 'a3'].map((id) => ({ id, data: { ...slot, onlineCourseId: 'k5' } }))
    .concat(['b1', 'b2', 'b3'].map((id) => ({ id, data: { ...slot, onlineCourseId: 'k6' } })));
  vm.runInContext('var qDocs = [];', c);
  c.qDocs.push(...items);
  const states = Object.fromEntries(items.map((it) => [it.id, c.onlineFocusOf(it).state]));
  assert.equal(states.b2, 'current', 'P6 moved most recently');
  assert.equal(states.b3, 'next');
  assert.equal(states.a1, '');
  assert.equal(states.a2, '');
  assert.deepEqual(plain(c.wsFocusHolds(items)), { current: 1, next: 1 });
  assert.equal(c.onlineFinishBtn(items[0]), null, 'no Finished under a current that another holds');
  assert.ok(c.onlineFinishBtn(items[4]), 'Finished under the one that holds it');
});

test('ties are settled the same way on every device', () => {
  const c = makeContext();
  assert.equal(c.onlineFocusBeats({ id: 'b', source: 'class', stamp: 0 }, { id: 'a', source: 'mark', stamp: 0 }), true);
  assert.equal(c.onlineFocusBeats({ id: 'a', source: 'mark', stamp: 0 }, { id: 'b', source: 'class', stamp: 0 }), false);
  assert.equal(c.onlineFocusBeats({ id: 'a', source: 'mark', stamp: 0 }, { id: 'b', source: 'mark', stamp: 0 }), true);
  assert.equal(c.onlineFocusBeats({ id: 'z', source: 'mark', stamp: 2 }, { id: 'a', source: 'class', stamp: 1 }), true);
  assert.equal(c.onlineStampMs({ seconds: 2, nanoseconds: 5e6 }), 2005);
  assert.equal(c.onlineStampMs('nonsense'), 0);
  assert.equal(c.onlineStampMs(null), 0);
});

test('a mark that lost its lesson time is taken off by the teacher, never a class list', async () => {
  const c = makeContext({ currentUser: TEACHER });
  c.onlineCourses = { k6: { id: 'k6', worksheetIds: ['p6a'], currentIndex: 0, progressAt: 9000 } };
  const classCur = { id: 'p6a', data: { onlineCourseId: 'k6', wsDay: 'Monday', wsSlot: 2 } };
  const old = { id: 'm1', data: { wsDay: 'Monday', wsSlot: 2, wsFocus: 'current', wsFocusAt: 100 } };
  const older = { id: 'm2', data: { wsDay: 'Monday', wsSlot: 2, wsFocus: 'current', wsFocusAt: 50 } };
  vm.runInContext('var qDocs = [];', c);
  c.qDocs.push(classCur, old, older);
  const table = c.onlineFocusTable();
  assert.deepEqual(plain(c.onlineFocusTidyIds(table)).sort(), ['m1', 'm2']);
  assert.equal(await c.onlineFocusTidy(c.onlineFocusTidyIds(table)), 2);
  assert.deepEqual(c.writes.map((w) => [w.id, w.v.wsFocus]).sort(), [['m1', DEL], ['m2', DEL]]);
  assert.equal('wsFocus' in old.data, false);
  assert.equal(await c.onlineFocusTidy(['m1']), 0, 'once per worksheet');
  const kid = makeContext({ currentUser: KID });
  assert.equal(await kid.onlineFocusTidy(['m1']), 0, 'a student never writes');
  assert.equal(kid.writes.length, 0);
});

test('Make current on a class worksheet takes the lesson time back from a mark', async () => {
  const log = [];
  const course = { title: 'P6 Science', worksheetIds: ['p6a', 'p6b'], currentIndex: 1, releasedThrough: 1, progressAt: 10 };
  const c = makeContext({ currentUser: TEACHER });
  c.db.runTransaction = courseTx(course, log);
  c.onlineCourses = { k6: Object.assign({ id: 'k6' }, course) };
  const classCur = { id: 'p6b', data: { onlineCourseId: 'k6', wsDay: 'Monday', wsSlot: 2 } };
  const marked = { id: 'p5x', data: { wsDay: 'Monday', wsSlot: 2, wsFocus: 'current', wsFocusAt: 500 } };
  vm.runInContext('var qDocs = [];', c);
  c.qDocs.push(classCur, marked);
  assert.equal(c.onlineFocusOf(classCur).heldBy, 'p5x');
  await c.onlineSetCurrent('p6b', classCur.data);
  assert.equal(log.at(-1).focusAt, 'now', 'already current: asking again stamps it');
  assert.equal(c.writes.some((w) => w.id === 'p5x' && w.v.wsFocus === DEL), true, 'the mark comes off');
  assert.equal('wsFocus' in marked.data, false);
  assert.equal(c.onlineFocusOf(classCur).state, 'current');
  assert.match(c.toasts.at(-1), /the only one/);
  assert.deepEqual(plain(c.onlineMarksReplacedBy([classCur, marked, { id: 'q', data: { wsDay: 'Monday', wsSlot: 1, wsFocus: 'current' } }], classCur, 'current')), []);
});
