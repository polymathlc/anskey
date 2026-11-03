// 🎓 Polymath Online (class lists, releases, the next two, ?ws=) and
// ⏱ lesson steps (a timestamp for every question), run out of index.html.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const plain = (v) => JSON.parse(JSON.stringify(v));

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function cut(start, end) {
  const i = html.indexOf(start);
  assert.ok(i >= 0, 'missing ' + start);
  const j = html.indexOf(end, i);
  assert.ok(j > i, 'missing ' + end);
  return html.slice(i, j + end.length);
}
const online = cut('/* ================= 🎓 Polymath Online', '/* ================= End Polymath Online ================= */');
const steps = cut('/* ================= ⏱ Lesson steps', '/* ================= End lesson steps ================= */');
const guess = cut('var LESSON_TITLE_MAX = 40;', '// What is on screen of the page in view, in page units.');

function fakeNode() {
  const listeners = {};
  return {
    hidden: false, textContent: '', title: '', checked: true, dataset: {}, style: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); }, toggle(c, on) { if (on === undefined) on = !this._s.has(c); on ? this._s.add(c) : this._s.delete(c); return on; } },
    children: [],
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type) { (listeners[type] || []).forEach((fn) => fn({})); },
    replaceChildren(...kids) { this.children = kids; },
    appendChild(k) { this.children.push(k); return k; },
    append(...kids) { this.children.push(...kids); },
    querySelectorAll() { return this.children.filter((k) => k.className === 'lessonStepChip'); },
    remove() {}
  };
}

function makeContext(overrides = {}) {
  const nodes = {};
  const ctx = {
    console, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, Promise, Math, Number, Array, Object, JSON, String, URL, Blob: class {}, Response: class {},
    location: { search: overrides.search || '' },
    URLSearchParams,
    localStorage: { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); } },
    document: { hidden: false, createElement: () => fakeNode(), querySelector: () => null, addEventListener() {}, body: fakeNode() },
    $: (id) => (nodes[id] = nodes[id] || fakeNode()),
    toast: (msg) => { ctx.toasts.push(msg); },
    toasts: [],
    auth: { onAuthStateChanged() {} },
    db: { collection: () => ({ doc: () => ({}), onSnapshot: () => () => {} }), runTransaction: async () => null },
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'now' } } },
    storage: { ref: () => ({ getDownloadURL: async () => 'x' }) },
    isAdmin: (u) => !!u && u.email === 'teacher@example.test',
    isSharedVisitor: () => false,
    actingStudent: null, practiceMode: false, currentUser: null, currentDocId: null,
    COLLECTION: 'pdfAnnotator', SHARE_OPEN_ID: '',
    lessonTeacher: () => true, lessonBusy: () => false, lessonPlayback: null, lessonOpen() {},
    loadQuestionsList() {}, openSavedDoc: async () => {}, canSeeDoc: () => true,
    recFmtTime: (ms) => Math.floor(ms / 60000) + ':' + String(Math.floor(ms / 1000) % 60).padStart(2, '0'),
    LESSON_TYPES: ['pen', 'highlight', 'text', 'rect', 'ellipse', 'line', 'arrow', 'brace'],
    wsEpoch: 1, pages: [], drawing: null, lessonCapture: null,
    lessonMedia: () => ({ currentTime: 0, play: () => Promise.resolve() }),
    ...overrides
  };
  ctx.nodes = nodes;
  vm.createContext(ctx);
  vm.runInContext(guess + '\n' + steps + '\n' + online, ctx);
  return ctx;
}

test('a class worksheet is released only up to releasedThrough, and unknown classes stay closed', () => {
  const c = makeContext();
  c.onlineCourses = { k1: { id: 'k1', worksheetIds: ['a', 'b', 'c', 'd'], releasedThrough: 1 } };
  assert.equal(c.onlineReleased({ name: 'not in a class' }), true);
  assert.equal(c.onlineReleased({ onlineCourseId: 'k1', onlineSeq: 0 }), true);
  assert.equal(c.onlineReleased({ onlineCourseId: 'k1', onlineSeq: 1 }), true);
  assert.equal(c.onlineReleased({ onlineCourseId: 'k1', onlineSeq: 2 }), false);
  assert.equal(c.onlineReleased({ onlineCourseId: 'gone', onlineSeq: 0 }), false);
  assert.equal(c.onlineReleased({ onlineCourseId: 'k1' }), false, 'no place in the list = not released');
});

test('on worksheet 3 the teacher releases up to 8, and progress never goes backwards', async () => {
  let written = null;
  const course = { worksheetIds: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9', 'w10'], currentIndex: -1, releasedThrough: -1, title: 'P5 Maths · Monday' };
  const c = makeContext({
    currentUser: { email: 'teacher@example.test' },
    db: {
      collection: () => ({ doc: () => ({}) }),
      runTransaction: async (fn) => fn({ get: async () => ({ exists: true, data: () => course }), set: (_ref, upd) => { written = upd; Object.assign(course, upd); } })
    }
  });
  c.currentDocId = 'w3';
  await c.onlineWorksheetOpened('w3', { onlineCourseId: 'k1' });
  assert.equal(written.currentIndex, 2);
  assert.equal(written.releasedThrough, 7, 'index 7 is worksheet 8');
  assert.match(c.toasts.at(-1), /Worksheet 3 of 10.*up to worksheet 8/);
  written = null;
  await c.onlineWorksheetOpened('w1', { onlineCourseId: 'k1' });
  assert.equal(written.currentIndex, undefined, 'reopening an old sheet does not move the class back');
  assert.equal(written.releasedThrough, undefined);
  await c.onlineWorksheetOpened('w9', { onlineCourseId: 'k1' });
  assert.equal(course.releasedThrough, 9, 'capped at the last worksheet');
});

test('a student never sees the progress move', async () => {
  let ran = false;
  const c = makeContext({ currentUser: { email: 'kid@example.test' }, db: { collection: () => ({ doc: () => ({}) }), runTransaction: async () => { ran = true; } } });
  await c.onlineWorksheetOpened('w3', { onlineCourseId: 'k1' });
  assert.equal(ran, false);
});

test('the next two: from the open sheet for the teacher, from the class for a student, released only', () => {
  const c = makeContext({ currentUser: { email: 'teacher@example.test' } });
  c.onlineCourses = { k1: { id: 'k1', worksheetIds: ['w1', 'w2', 'w3', 'w4', 'w5'], currentIndex: 1, releasedThrough: 2 } };
  let info = c.onlineNextFor('w1', { onlineCourseId: 'k1' });
  assert.deepEqual(plain(info.next.map((n) => n.id)), ['w2', 'w3']);
  info = c.onlineNextFor('w4', { onlineCourseId: 'k1' });
  assert.deepEqual(plain(info.next.map((n) => n.id)), ['w5'], 'the end of the list');
  c.currentUser = { email: 'kid@example.test' };
  info = c.onlineNextFor('w1', { onlineCourseId: 'k1' });
  assert.equal(info.from, 1, 'a student follows the class');
  assert.deepEqual(plain(info.next.map((n) => n.id)), ['w3'], 'w4 is not released yet');
  assert.equal(c.onlineNextFor('w1', { name: 'loose' }), null);
});

test('?ws= is read from the address', () => {
  const c = makeContext({ search: '?ws=abc123' });
  assert.equal(c.WS_OPEN_ID, 'abc123');
});

test('steps: one per question change, in time order, repeats of a neighbour dropped', () => {
  const c = makeContext();
  const cap = { phase: 'recording' };
  c.lessonStepAdd(cap, { t: 0, label: 'Q1', page: 1, y: 10 });
  c.lessonStepAdd(cap, { t: 5000, label: 'Q1', page: 1, y: 40 });
  c.lessonStepAdd(cap, { t: 9000, label: 'Q2', page: 1, y: 300 });
  c.lessonStepAdd(cap, { t: 7000, label: 'Q2', page: 1, y: 280 }); // resolved late
  c.lessonStepAdd(cap, { t: 12000, label: 'Q1', page: 1, y: 50 });
  assert.deepEqual(plain(cap.steps.map((s) => [s.t, s.label])), [[0, 'Q1'], [7000, 'Q2'], [12000, 'Q1']]);
  assert.match(c.nodes.lessonStepNow.textContent, /Q1 · 3 steps/);
});

test('steps: a stroke is labelled by the question number at or above it', async () => {
  const items = [{ str: '1.', x: 30, y: 100 }, { str: 'A car travels…', x: 60, y: 100 }, { str: '2', x: 30, y: 400 }, { str: '(a) 12 kg', x: 80, y: 450 }];
  const page = { num: 1, baseW: 600, viewport1: { convertToViewportPoint: (x, y) => [x, y] }, page: { getTextContent: async () => ({ items: items.map((it) => ({ str: it.str, transform: [1, 0, 0, 1, it.x, it.y] })) }) } };
  const c = makeContext({ pages: [page] });
  assert.equal(await c.lessonStepLabelFor(1, 250), 'Q1');
  assert.equal(await c.lessonStepLabelFor(1, 392), 'Q2', 'ink just above the number belongs to it');
  assert.equal(await c.lessonStepLabelFor(1, 600), 'Q2');
  assert.equal(await c.lessonStepLabelFor(2, 10), 'Page 2');
});

test('steps: the replay chips are cleaned, and fewer than two show nothing', () => {
  const c = makeContext();
  c.lessonStepsShow([{ t: 0, label: 'Q1' }], 10000);
  assert.equal(c.nodes.lessonSteps.hidden, true);
  c.lessonPlayback = {};
  c.lessonStepsShow([{ t: 0, label: 'Q1' }, { t: 4000, label: 'Q2' }, { t: 99999, label: 'past the end' }, { label: 'no time' }], 10000);
  assert.equal(c.nodes.lessonSteps.hidden, false);
  assert.equal(c.lessonStepsShown.length, 2);
});

test('the old timestamp feature is gone for good', () => {
  for (const name of ['tsToggleBtn', 'showTimestamps', 'refreshTsLabels', 'maybeAutoShowTimestamps', 'jumpRecordingToTs', 'videoStartRow', 'tsHint']) {
    assert.equal(html.includes(name), false, name + ' is still in index.html');
  }
});

test('the hooks are guarded, so the recorder runs without these sections', () => {
  assert.match(html, /if \(typeof lessonStepsTick === 'function'\) \{ try \{ lessonStepsTick\(c, ms\);/);
  assert.match(html, /if \(d\.onlineCourseId && \(typeof onlineReleased !== 'function' \|\| !onlineReleased\(d\)\)\) return false;/);
  assert.match(html, /if \(typeof onlineWorksheetOpened === 'function'\) onlineWorksheetOpened\(id, data\);/);
});

test('?ws= links can ask to replay a lesson or print, and nothing else', () => {
  const c = makeContext({ search: '?ws=abc&do=play&rec=ann-7' });
  assert.deepEqual(plain(c.WS_OPEN_DO), { action: 'play', rec: 'ann-7' });
  assert.deepEqual(plain(c.onlineLinkAction('?ws=a&do=PRINT-ANSWERS')), { action: 'print-answers', rec: '' });
  assert.deepEqual(plain(c.onlineLinkAction('?ws=a&do=print-worksheet')), { action: 'print-worksheet', rec: '' });
  assert.deepEqual(plain(c.onlineLinkAction('?ws=a&do=delete')), { action: '', rec: '' });
  assert.deepEqual(plain(c.onlineLinkAction('?ws=a&do=play&rec=<script>')), { action: 'play', rec: '' });
  assert.deepEqual(plain(c.onlineLinkAction('')), { action: '', rec: '' });
});

test('the lesson to replay: the one asked for, else the newest recorded lesson', () => {
  const c = makeContext();
  const list = [
    { id: 'pen1', type: 'pen' },
    { id: 'yt', type: 'video', url: 'https://youtube.com/x' },
    { id: 'old', type: 'video', url: 'https://a/old.m4a', ts: 100, lessonRecording: { version: 1 } },
    { id: 'new', type: 'video', url: 'https://a/new.m4a', ts: 300, lessonRecording: { version: 1 } },
    { id: 'mid', type: 'video', url: 'https://a/mid.m4a', ts: 200, lessonRecording: { version: 1 } }
  ];
  assert.equal(c.onlineLessonPick(list, '').id, 'new');
  assert.equal(c.onlineLessonPick(list, 'old').id, 'old');
  assert.equal(c.onlineLessonPick(list, 'missing').id, 'new');
  assert.equal(c.onlineLessonPick([{ id: 'yt', type: 'video', url: 'u' }], ''), null);
});

test('after opening, the link replays or prints as asked', async () => {
  const calls = [];
  const lesson = { id: 'L', type: 'video', url: 'u', ts: 5, lessonRecording: { version: 1 } };
  const c = makeContext({ currentDocId: 'w1', pdfDoc: {}, pages: [{}], annotations: [lesson],
    lessonPlay: async (a) => calls.push(['play', a.id]), runPrint: async (k) => calls.push(['print', k]) });
  await c.onlineRunLinkAction('w1', { action: 'play', rec: '' });
  await c.onlineRunLinkAction('w1', { action: 'print-answers', rec: '' });
  await c.onlineRunLinkAction('w1', { action: 'print-worksheet', rec: '' });
  await c.onlineRunLinkAction('w1', { action: '', rec: '' });
  assert.deepEqual(calls, [['play', 'L'], ['print', 'answers'], ['print', 'questions']]);
  c.annotations = [];
  await c.onlineRunLinkAction('w1', { action: 'play', rec: '' });
  assert.match(c.toasts.pop(), /no recorded lesson/);
});

/* ---- 📌 Current worksheet and Next worksheet (v1.176.0) ---- */
const tenSheets = () => ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9', 'w10'];

test('the class position for the labels: worksheet 1 before the class starts, clamped to the list', () => {
  const c = makeContext();
  assert.equal(c.onlineClassAt({ worksheetIds: [] }), -1, 'an empty list has no current worksheet');
  assert.equal(c.onlineClassAt({ worksheetIds: tenSheets(), currentIndex: -1 }), 0, 'not started = worksheet 1 is current');
  assert.equal(c.onlineClassAt({ worksheetIds: tenSheets() }), 0, 'no number at all is not started too');
  assert.equal(c.onlineClassAt({ worksheetIds: tenSheets(), currentIndex: 4 }), 4);
  assert.equal(c.onlineClassAt({ worksheetIds: ['a', 'b'], currentIndex: 7 }), 1, 'a list made shorter keeps a real place');
  assert.equal(c.onlineClassAt(null), -1);
});

test('done, current, next and queued, in teaching order', () => {
  const c = makeContext();
  const course = { worksheetIds: tenSheets(), currentIndex: 2, releasedThrough: 7 };
  assert.deepEqual(plain(tenSheets().map((_, i) => c.onlineQueueState(course, i))),
    ['done', 'done', 'current', 'next', 'queued', 'queued', 'queued', 'queued', 'queued', 'queued']);
  const fresh = { worksheetIds: tenSheets(), currentIndex: -1, releasedThrough: -1 };
  assert.equal(c.onlineQueueState(fresh, 0), 'current', 'before the first lesson, worksheet 1 is current');
  assert.equal(c.onlineQueueState(fresh, 1), 'next', 'and worksheet 2 is already loaded as next');
  const last = { worksheetIds: ['a', 'b', 'c'], currentIndex: 2 };
  assert.equal(c.onlineQueueState(last, 2), 'current');
  assert.equal(c.onlineQueueState(last, 3), '', 'nothing past the end');
  assert.equal(c.onlineQueueState(last, -1), '');
});

test('a worksheet finds its place from the class list itself, so a reorder moves the tags', () => {
  const c = makeContext({ currentUser: { email: 'teacher@example.test' } });
  c.onlineCourses = { k1: { id: 'k1', title: 'P5 Maths · Monday 5pm', worksheetIds: ['w1', 'w2', 'w3', 'w4'], currentIndex: 0 } };
  let place = c.onlineDocPlace('w2', { onlineCourseId: 'k1', onlineSeq: 3 });
  assert.equal(place.seq, 1, 'the list wins over a stale onlineSeq');
  assert.equal(place.state, 'next');
  assert.equal(place.total, 4);
  assert.equal(c.onlineTagText(place), '⏭ Next worksheet');
  assert.equal(c.onlinePlaceText(place), 'Worksheet 2 of 4 in P5 Maths · Monday 5pm');
  assert.equal(c.onlineTagText(c.onlineDocPlace('w1', { onlineCourseId: 'k1' })), '▶ Current worksheet');
  assert.equal(c.onlineTagText(c.onlineDocPlace('w4', { onlineCourseId: 'k1' })), '📥 Queued');
  c.onlineCourses.k1.worksheetIds = ['w2', 'w1', 'w3', 'w4'];
  place = c.onlineDocPlace('w2', { onlineCourseId: 'k1' });
  assert.equal(place.state, 'current', 'moved to the top in the portal = now current');
  assert.equal(c.onlineDocPlace('gone', { onlineCourseId: 'k1' }), null, 'taken out of the list');
  assert.equal(c.onlineDocPlace('w1', { name: 'loose' }), null, 'not a class worksheet');
  assert.equal(c.onlineDocPlace('w1', { onlineCourseId: 'unknown' }), null, 'class not loaded');
});

test('only the teacher\'s own list keeps queued worksheets out of the lessons', () => {
  const c = makeContext({ currentUser: { email: 'teacher@example.test' } });
  c.onlineCourses = { k1: { id: 'k1', worksheetIds: tenSheets(), currentIndex: 3, releasedThrough: 8 } };
  const item = (id) => ({ id, data: { onlineCourseId: 'k1' } });
  assert.equal(c.onlineIsQueued(item('w4')), false, 'current');
  assert.equal(c.onlineIsQueued(item('w5')), false, 'next');
  assert.equal(c.onlineIsQueued(item('w6')), true, 'past the next one');
  assert.equal(c.onlineIsQueued(item('w1')), false, 'already taught');
  assert.equal(c.onlineIsQueued({ id: 'x', data: { name: 'loose' } }), false);
  c.actingStudent = { uid: 's1' };
  assert.equal(c.onlineIsQueued(item('w6')), false, 'a student on the teacher\'s device sees releases, not the queue');
  c.actingStudent = null;
  c.currentUser = { email: 'kid@example.test' };
  assert.equal(c.onlineIsQueued(item('w6')), false, 'a student\'s list is cut by releases alone');
  assert.equal(c.onlineCardTag(item('w6')), null, 'and a student is never shown a Queued tag');
  const tag = c.onlineCardTag(item('w4'));
  assert.equal(tag.className, 'qClassTag current', 'but does see where the class is');
});

test('current, then next, lead their lesson time', () => {
  const c = makeContext({ currentUser: { email: 'teacher@example.test' } });
  c.onlineCourses = { k1: { id: 'k1', worksheetIds: tenSheets(), currentIndex: 4 } };
  const rank = (id) => c.onlinePinRank({ id, data: { onlineCourseId: 'k1' } });
  assert.equal(rank('w5'), 0);
  assert.equal(rank('w6'), 1);
  assert.equal(rank('w4'), 2);
  assert.equal(c.onlinePinRank({ id: 'z', data: {} }), 2, 'a loose worksheet keeps the lesson order');
});

test('Finished moves the class to the next worksheet, and only from the current one', () => {
  const c = makeContext();
  const course = { worksheetIds: tenSheets(), currentIndex: 2, releasedThrough: 7 };
  assert.deepEqual(plain(c.onlineFinishUpdate(course, 'w3')),
    { currentIndex: 3, currentDocId: 'w4', releasedThrough: 8, lastFinishedIndex: 2, lastFinishedDocId: 'w3' });
  assert.equal(c.onlineFinishUpdate(course, 'w2'), null, 'an old worksheet is already finished');
  assert.equal(c.onlineFinishUpdate(course, 'w5'), null, 'a later one is not the one being taught');
  assert.equal(c.onlineFinishUpdate(course, 'nope'), null);
  const fresh = { worksheetIds: tenSheets(), currentIndex: -1, releasedThrough: -1 };
  assert.deepEqual(plain(c.onlineFinishUpdate(fresh, 'w1')),
    { currentIndex: 1, currentDocId: 'w2', releasedThrough: 6, lastFinishedIndex: 0, lastFinishedDocId: 'w1' },
    'finishing worksheet 1 before the class ever opened it still releases as opening worksheet 2 would');
  assert.equal(c.onlineFinishUpdate({ worksheetIds: ['a', 'b'], currentIndex: 1 }, 'b'), null, 'nothing after the last one');
  const capped = { worksheetIds: tenSheets(), currentIndex: 7, releasedThrough: 9 };
  assert.equal(c.onlineFinishUpdate(capped, 'w8').releasedThrough, 9, 'released stays released, capped at the end');
});

test('the Finished button writes the move and tells the teacher what loaded next', async () => {
  let written = null;
  const course = { title: 'P6 Science · Saturday', worksheetIds: tenSheets(), currentIndex: 4, releasedThrough: 9 };
  const c = makeContext({
    currentUser: { email: 'teacher@example.test' },
    db: {
      collection: () => ({ doc: () => ({}) }),
      runTransaction: async (fn) => fn({ get: async () => ({ exists: true, data: () => course }), set: (_ref, upd) => { written = upd; Object.assign(course, upd); } })
    }
  });
  c.onlineCourses = { k1: Object.assign({ id: 'k1' }, course) };
  const fields = await c.onlineFinishCurrent('w5', { onlineCourseId: 'k1' }, null);
  assert.equal(written.currentIndex, 5);
  assert.equal(written.currentDocId, 'w6');
  assert.equal(written.lastFinishedDocId, 'w5');
  assert.equal(written.progressAt, 'now');
  assert.equal(written.finishedAt, 'now');
  assert.equal(fields.currentIndex, 5);
  assert.equal(c.onlineCourses.k1.currentIndex, 5, 'the list changes at once, before the live watch catches up');
  assert.match(c.toasts.at(-1), /Worksheet 5 finished.*Worksheet 6 is now the current worksheet, and worksheet 7 is loaded as the next one/);
  written = null;
  const again = await c.onlineFinishCurrent('w5', { onlineCourseId: 'k1' }, null);
  assert.equal(again, null, 'pressed twice (or on two devices): the second press changes nothing');
  assert.equal(written, null);
  assert.match(c.toasts.at(-1), /already moved on/);
});

test('a student can never press Finished', async () => {
  let ran = false;
  const c = makeContext({ currentUser: { email: 'kid@example.test' }, db: { collection: () => ({ doc: () => ({}) }), runTransaction: async () => { ran = true; } } });
  c.onlineCourses = { k1: { id: 'k1', worksheetIds: tenSheets(), currentIndex: 0 } };
  assert.equal(c.onlineFinishBtn({ id: 'w1', data: { onlineCourseId: 'k1' } }), null);
  assert.equal(await c.onlineFinishCurrent('w1', { onlineCourseId: 'k1' }, null), null);
  assert.equal(ran, false);
});

test('the Finished button sits under the current worksheet only, and not on the last one', () => {
  const c = makeContext({ currentUser: { email: 'teacher@example.test' } });
  c.onlineCourses = { k1: { id: 'k1', worksheetIds: ['a', 'b', 'c'], currentIndex: 1 } };
  assert.ok(c.onlineFinishBtn({ id: 'b', data: { onlineCourseId: 'k1' } }), 'current');
  assert.equal(c.onlineFinishBtn({ id: 'c', data: { onlineCourseId: 'k1' } }), null, 'next');
  c.onlineCourses.k1.currentIndex = 2;
  assert.equal(c.onlineFinishBtn({ id: 'c', data: { onlineCourseId: 'k1' } }), null, 'the last one has nothing to load');
});

test('a worksheet opened from Queued to prepare does not move the class', async () => {
  let ran = false;
  const c = makeContext({ currentUser: { email: 'teacher@example.test' }, db: { collection: () => ({ doc: () => ({}) }), runTransaction: async () => { ran = true; return null; } } });
  c.onlineCourses = { k1: { id: 'k1', title: 'P5 Maths', worksheetIds: tenSheets(), currentIndex: 1 } };
  c.currentDocId = 'w8';
  c.onlinePrepareOnly = 'w8';
  await c.onlineWorksheetOpened('w8', { onlineCourseId: 'k1' });
  assert.equal(ran, false, 'no progress written');
  assert.equal(c.onlinePrepareOnly, '', 'used once');
  assert.match(c.toasts.at(-1), /Opened to prepare · P5 Maths stays on worksheet 2/);
  await c.onlineWorksheetOpened('w8', { onlineCourseId: 'k1' });
  assert.equal(ran, true, 'opened any other way, the old rule applies');
});

test('on a class\'s own day its current and next PDFs are fetched ahead, once each', () => {
  const fetched = [];
  const c = makeContext({ currentUser: { email: 'teacher@example.test' } });
  c.onlineDocData = async (id) => ({ storagePath: 'pdf/' + id + '.pdf' });
  c.onlinePdfBytes = async (p) => { fetched.push(p); return new ArrayBuffer(1); };
  c.onlineCourses = {
    mon: { id: 'mon', day: 'Monday', worksheetIds: tenSheets(), currentIndex: 3 },
    tue: { id: 'tue', day: 'Tuesday', worksheetIds: ['t1', 't2'], currentIndex: 0 },
    old: { id: 'old', day: 'Monday', archived: true, worksheetIds: ['o1', 'o2'] }
  };
  const monday = new Date(2026, 10, 2); // 2 November 2026 is a Monday
  assert.deepEqual(plain(c.onlinePreloadNext(monday)), ['w4', 'w5']);
  assert.deepEqual(plain(c.onlinePreloadNext(monday)), [], 'not fetched twice');
  c.onlineCourses.mon.currentIndex = 4;
  assert.deepEqual(plain(c.onlinePreloadNext(monday)), ['w6'], 'the class moved on: only the newly loaded next one');
  c.currentUser = { email: 'kid@example.test' };
  c.onlineCourses.mon.currentIndex = 6;
  assert.deepEqual(plain(c.onlinePreloadNext(monday)), [], 'never on a student\'s device');
});

test('the worksheet list is wired to the queue and the tags', () => {
  assert.match(html, /return !docIsHidden\(item\.data\) && !docIsQueued\(item\) &&/);
  assert.match(html, /renderQueuedGroup\(list, queued\);\n  renderHiddenGroup\(list, hidden\);/);
  assert.match(html, /var classTag = typeof onlineCardTag === 'function' \? onlineCardTag\(item\) : null;/);
  assert.match(html, /var finishBtn = typeof onlineFinishBtn === 'function' \? onlineFinishBtn\(item\) : null;/);
  assert.match(html, /onlinePrepareOnly = opts\.prepare \? item\.id : '';/);
  assert.match(html, /var pin = typeof onlinePinRank === 'function' \? onlinePinRank\(a\) - onlinePinRank\(b\) : 0;/);
  assert.match(html, /body\.appendChild\(questionCard\(entry\.item, \{ prepare: true \}\)\);/);
});

test('🔁 a replaced worksheet PDF (new pdfVersion) is fetched again and the old copy is dropped', async () => {
  const kept = new Map();
  const store = {
    async match(key) { return kept.has(key) ? { arrayBuffer: async () => kept.get(key) } : undefined; },
    async put(key, resp) { kept.set(key, resp.body); },
    async keys() { return [...kept.keys()].map((url) => ({ url })); },
    async delete(req) { kept.delete(req.url); }
  };
  const downloads = [];
  let content = 'old';
  const c = makeContext({
    caches: { open: async () => store },
    fetch: async (url, opts) => { downloads.push(opts || null); const body = content; return { ok: true, arrayBuffer: async () => body }; },
    Response: class { constructor(body) { this.body = body; } }
  });
  c.window = c;
  c.ONLINE_PDF_CACHE = 'test-cache';
  const path = 'pdf-annotator/w1.pdf';
  assert.equal(await c.onlinePdfBytes(path), 'old');
  assert.equal(await c.onlinePdfBytes(path), 'old', 'kept for the session');
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0], null, 'a never-replaced file downloads as before');
  // Replaced in Polymath Online: same path, a new version.
  content = 'new';
  assert.equal(await c.onlinePdfBytes(path, 1762150000000), 'new', 'the new version is downloaded, not the kept old copy');
  assert.equal(downloads.length, 2);
  assert.equal(downloads[1].cache, 'no-cache', 'and checked with the server, past the HTTP cache');
  assert.deepEqual([...kept.keys()], ['https://polymath-online.invalid/' + encodeURIComponent(path) + '?v=1762150000000'], 'only the new copy stays on the device');
  assert.equal(await c.onlineCachedPdf(path, 1762150000000), 'new', 'opening it hands over the new version fetched ahead');
  assert.equal(await c.onlineCachedPdf(path, 1762150000001), null, 'never a copy of another version');
  // A fresh session on the same device opens the new version from the device.
  const again = makeContext({ caches: { open: async () => store }, fetch: async () => { throw new Error('no network needed'); }, Response: class { constructor(b) { this.body = b; } } });
  again.window = again;
  again.ONLINE_PDF_CACHE = 'test-cache';
  assert.equal(await again.onlinePdfBytes(path, 1762150000000), 'new');
});

test('🔁 every place that fetches a class PDF passes its pdfVersion', () => {
  const calls = html.match(/onlinePdfBytes\([^)]*\)/g).filter((s) => !/function onlinePdfBytes/.test(s) && !/storagePath, version\)$/.test(s));
  assert.ok(calls.length >= 4);
  calls.forEach((s) => assert.match(s, /\.pdfVersion\)$/, s));
  assert.match(html, /onlineCachedPdf\(data\.storagePath, data\.pdfVersion\)/);
  assert.match(html, /resp = await fetch\(url, data\.pdfVersion \? \{ cache: 'no-cache' \} : undefined\);/);
});
