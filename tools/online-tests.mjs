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
