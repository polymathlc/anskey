/* =====================================================================
   ⏺ Writing without recording (v1.173.0, v1.174.0) — the rules, without a page
   ---------------------------------------------------------------------
   `record-nudge.js` decides everything in two pure functions, `gate` (may
   this mark count at all?) and `step` (what does the warning do now?). This
   walks every rule through them, then reads index.html to pin the glue:
   both commit points in finishPointer tell it, a recording starting takes it
   away, Record now is the toolbar's own door (lessonOpen) and never a second
   recorder, and nothing in the module ever opens a device.

     node --test tools/record-nudge-tests.mjs
   ===================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'record-nudge.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'record-nudge.css'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// Run in THIS realm (not a vm context), so its arrays and objects compare
// with deepEqual like any other — the module only needs `window` to load.
function load() {
  const win = {};
  new Function('window', SRC + '\n//# sourceURL=record-nudge.js')(win);
  return win.RecordNudge;
}
const RN = load();
const P = RN.pure;

const OK = { on: true, session: false, teacher: true, recording: false, playback: false, windowOpen: false, docId: 'doc1', pages: true };
const ink = (now, key = 'u/doc1', why = '') => ({ type: 'ink', now, key, why });
// STROKES marks a second apart from `t`, on `key` — the count that shows it.
const burst = (t, key = 'u/doc1', n = P.STROKES) => Array.from({ length: n }, (_, i) => ink(t + i * 1000, key));
const SHOW_AT = P.STROKES - 1;   // the index of the effect that shows it
function run(events, state) {
  let s = state || P.initialState();
  const effects = [];
  for (const e of events) { const r = P.step(s, e); s = r.state; effects.push(r.effect); }
  return { state: s, effects };
}

/* ---------------- gate ---------------- */
test('gate: a teacher writing on a saved worksheet with nothing recording may be warned', () => {
  assert.equal(P.gate(OK), '');
  assert.equal(P.gate(Object.assign({}, OK, { ann: { type: 'pen' } })), '');
});

test('gate: every reason not to ask, in its own words', () => {
  assert.equal(P.gate(Object.assign({}, OK, { on: false })), 'off');
  assert.equal(P.gate(Object.assign({}, OK, { session: true })), 'session-off');
  assert.equal(P.gate(Object.assign({}, OK, { teacher: false })), 'not-teacher');
  assert.equal(P.gate(Object.assign({}, OK, { recording: true })), 'recording');
  assert.equal(P.gate(Object.assign({}, OK, { playback: true })), 'playback');
  assert.equal(P.gate(Object.assign({}, OK, { windowOpen: true })), 'window-open');
  assert.equal(P.gate(Object.assign({}, OK, { pages: false })), 'no-pages');
  assert.equal(P.gate(Object.assign({}, OK, { ann: { type: 'ainote' } })), 'not-ink');
  assert.equal(P.gate(Object.assign({}, OK, { ann: null })), 'not-ink');
});

// v1.174.0: Zhi Kai wrote without recording and nothing came up. Each of
// these kept it away silently, so none of them may refuse a mark any more.
test('gate: an unsaved sheet, an older lesson waiting to save and an unrelated dialog never refuse a mark', () => {
  assert.equal(P.gate(Object.assign({}, OK, { docId: '' })), '');
  assert.equal(P.gate(Object.assign({}, OK, { pending: true })), '');
  assert.equal(P.gate(Object.assign({}, OK, { dialog: true })), '');
  assert.equal(P.gate(Object.assign({}, OK, { docId: '', pending: true, dialog: true, ann: { type: 'pen' } })), '');
  assert.ok(!('pending' in P.WHY) && !('unsaved' in P.WHY));
});

test('standWhy: another dialog only takes a card that is already up away', () => {
  assert.equal(P.standWhy(OK), '');
  assert.equal(P.standWhy(Object.assign({}, OK, { dialog: true })), 'dialog-open');
  assert.equal(P.standWhy(Object.assign({}, OK, { recording: true, dialog: true })), 'recording');
  assert.equal(P.standWhy(Object.assign({}, OK, { session: true })), 'session-off');
});

test('cleanSession and subText', () => {
  assert.equal(P.cleanSession('1'), true);
  assert.equal(P.cleanSession(null), false);
  assert.equal(P.cleanSession('0'), false);
  assert.equal(P.SESSION_KEY, 'polymath.recordNudge.session.v1');
  assert.ok(/save this worksheet/i.test(P.subText(false)));
  assert.ok(!/save/i.test(P.subText(true)));
});

test('"session" hides it like "off" and is remembered as the reason', () => {
  let r = run(burst(1000).concat([{ type: 'session', now: 9000 }]));
  assert.equal(r.effects[SHOW_AT], 'show');
  assert.equal(r.effects[SHOW_AT + 1], 'hide');
  assert.equal(r.state.last, 'session-off');
  assert.equal(r.state.shown, false);
});

test('gate: the person comes before everything — a student is never told about recording', () => {
  // A student who is ALSO "not recording" must be refused as a student.
  assert.equal(P.gate(Object.assign({}, OK, { teacher: false, docId: '', pages: false })), 'not-teacher');
  // The off switch is the teacher's own word and outranks the rest.
  assert.equal(P.gate(Object.assign({}, OK, { on: false, teacher: false })), 'off');
});

test('gate: an empty context refuses rather than asks', () => {
  assert.notEqual(P.gate({}), '');
  assert.notEqual(P.gate(undefined), '');
});

/* ---------------- what counts as writing ---------------- */
test('isInk: the lesson recorder\'s own list and nothing else', () => {
  for (const t of ['pen', 'highlight', 'text', 'rect', 'ellipse', 'line', 'arrow', 'brace']) {
    assert.equal(P.isInk({ type: t }), true, t);
  }
  for (const t of ['ainote', 'video', 'image', 'modelBar', 'lasso', '', undefined]) {
    assert.equal(P.isInk({ type: t }), false, String(t));
  }
  assert.equal(P.isInk(null), false);
  assert.equal(P.isInk('pen'), false);
});

test('isInk matches the recorder\'s LESSON_TYPES in index.html exactly', () => {
  const m = HTML.match(/var LESSON_TYPES = (\[[^\]]*\]);/);
  assert.ok(m, 'LESSON_TYPES is in index.html');
  const lesson = JSON.parse(m[1].replace(/'/g, '"'));
  assert.deepEqual([...P.INK_TYPES].sort(), [...lesson].sort());
});

/* ---------------- keys, marks, snoozes, the switch ---------------- */
test('docKey: one worksheet for one person, nothing for half a key', () => {
  assert.equal(P.docKey('u1', 'd1'), 'u1/d1');
  assert.notEqual(P.docKey('u1', 'd1'), P.docKey('u2', 'd1'));
  assert.notEqual(P.docKey('u1', 'd1'), P.docKey('u1', 'd2'));
  assert.equal(P.docKey('', 'd1'), '');
  // An unsaved sheet has a key of its own, so "Not now" sticks there too.
  assert.equal(P.docKey('u1', ''), 'u1/' + P.UNSAVED_DOC);
  assert.notEqual(P.docKey('u1', ''), P.docKey('u1', 'd1'));
});

test('trimMarks keeps only the window, oldest first, bounded', () => {
  const now = 100000;
  assert.deepEqual(P.trimMarks([now - 50000, now - 10, now - 30000, now], now, 45000), [now - 30000, now - 10, now]);
  assert.deepEqual(P.trimMarks([now + 5, NaN, 'x', null], now, 45000), []);
  const many = Array.from({ length: 100 }, (_, i) => now - i);
  const out = P.trimMarks(many, now, 45000);
  assert.equal(out.length, P.MARKS_MAX);
  assert.equal(out[out.length - 1], now);
  assert.deepEqual(P.trimMarks(undefined, now), []);
});

test('pruneSnooze drops what has ended and keeps the latest-ending when full', () => {
  const now = 1000;
  assert.deepEqual(P.pruneSnooze({ a: 999, b: 1000, c: 2000 }, now), { c: 2000 });
  const big = {};
  for (let i = 0; i < 200; i++) big['k' + i] = now + 1 + i;
  const out = P.pruneSnooze(big, now);
  assert.equal(Object.keys(out).length, P.SNOOZE_MAX);
  assert.ok('k199' in out && !('k0' in out));
});

test('cleanPref: "0" is off, anything else is on', () => {
  assert.deepEqual(P.cleanPref('0'), { on: false });
  assert.deepEqual(P.cleanPref('off'), { on: false });
  assert.deepEqual(P.cleanPref(null), { on: true });
  assert.deepEqual(P.cleanPref('1'), { on: true });
  assert.deepEqual(P.cleanPref('garbage'), { on: true });
});

/* ---------------- step: when it comes up ---------------- */
test('one mark is not writing; STROKES marks inside the window are', () => {
  const marks = Array.from({ length: P.STROKES }, (_, i) => ink(1000 + i * 1000));
  const r = run(marks);
  assert.deepEqual(r.effects, Array(P.STROKES - 1).fill('').concat(['show']));
  assert.equal(r.state.shown, true);
  assert.equal(r.state.shows, 1);
});

test('one mark is enough: a single stroke or one typed word brings it up (v1.183.0)', () => {
  assert.equal(P.STROKES, 1);
  const r = run([ink(1000)]);
  assert.deepEqual(r.effects, ['show']);
  assert.equal(r.state.shown, true);
});

test('a mark that may not count is not counted', () => {
  const evs = [];
  for (let i = 0; i < P.STROKES - 1; i++) {
    evs.push(ink(1000 + i * 2000));
    evs.push(ink(2000 + i * 2000, 'u/doc1', i % 2 ? 'not-ink' : 'recording'));
  }
  const r = run(evs);
  assert.ok(r.effects.every(e => e === ''));
  assert.equal(r.state.marks.length, P.STROKES - 1);
});

test('another worksheet: the first mark there brings it up again', () => {
  let r = run([ink(1000, 'u/a')]);
  assert.deepEqual(r.effects, ['show']);
  r = run([{ type: 'context', now: 2000, key: 'u/b', why: '' }], r.state);
  assert.deepEqual(r.effects, ['hide']);
  r = run([ink(3000, 'u/b')], r.state);
  assert.deepEqual(r.effects, ['show']);
  assert.equal(r.state.key, 'u/b');
});

test('writing on with the warning up keeps it up and restarts its clock', () => {
  let r = run(burst(1000));
  const at = 1000 + SHOW_AT * 1000;
  assert.equal(r.state.shownAt, at);
  r = run([ink(10000)], r.state);
  assert.deepEqual(r.effects, ['']);
  assert.equal(r.state.shown, true);
  assert.equal(r.state.shownAt, 10000);
  assert.equal(r.state.shows, 1, 'not shown a second time');
});

/* ---------------- step: when it goes ---------------- */
test('untouched, it NEVER goes by itself — hours of the clock do not hide it (v1.183.0)', () => {
  let r = run([ink(1000)]);
  for (const t of [2000, 15000, 60000, 10 * 60000, 3 * 3600000]) {
    r = run([{ type: 'tick', now: t }], r.state);
    assert.deepEqual(r.effects, [''], 'tick at ' + t);
    assert.equal(r.state.shown, true);
  }
  assert.equal(P.SHOW_MS, 0);
  assert.equal(P.IDLE_SNOOZE_MS, 0);
});

test('"Hide" puts it away only until the next mark — no snooze', () => {
  let r = run([ink(1000), { type: 'later', now: 2000 }]);
  assert.deepEqual(r.effects, ['show', 'hide']);
  assert.equal(r.state.shown, false);
  assert.deepEqual(r.state.snooze, {}, 'nothing snoozed');
  r = run([ink(2500)], r.state);
  assert.deepEqual(r.effects, ['show'], 'the very next mark brings it back');
  assert.equal(P.LATER_SNOOZE_MS, 0);
});

test('"Record now" hides it; if the window is closed without recording, the next mark brings it back', () => {
  let r = run([ink(1000), { type: 'record', now: 2000 }]);
  assert.deepEqual(r.effects, ['show', 'hide']);
  // While the Record window is open a mark does not count…
  r = run([ink(3000, 'u/doc1', 'window-open')], r.state);
  assert.deepEqual(r.effects, ['']);
  // …and once it is closed without starting, the next mark does.
  r = run([ink(4000)], r.state);
  assert.deepEqual(r.effects, ['show']);
  assert.equal(P.RECORD_SNOOZE_MS, 0);
});

test('a recording starting (or any reason not to ask) takes a warning that is up away', () => {
  for (const why of ['recording', 'pending', 'playback', 'window-open', 'not-teacher', 'off']) {
    let r = run([ink(1000), ink(2000), ink(3000)]);
    r = run([{ type: 'context', now: 4000, key: 'u/doc1', why }], r.state);
    assert.deepEqual(r.effects, ['hide'], why);
    assert.equal(r.state.shown, false, why);
  }
});

test('a context with nothing wrong leaves it where it is', () => {
  let r = run([ink(1000), ink(2000), ink(3000)]);
  r = run([{ type: 'context', now: 4000, key: 'u/doc1', why: '' }], r.state);
  assert.deepEqual(r.effects, ['']);
  assert.equal(r.state.shown, true);
});

test('a new worksheet or person takes the old warning away and the count with it', () => {
  let r = run([ink(1000), ink(2000), ink(3000)]);
  r = run([{ type: 'context', now: 4000, key: 'u/doc2', why: '' }], r.state);
  assert.deepEqual(r.effects, ['hide']);
  assert.equal(r.state.key, 'u/doc2');
  assert.deepEqual(r.state.marks, []);
  r = run([{ type: 'context', now: 4000, key: 'other/doc2', why: '' }], r.state);
  assert.equal(r.state.key, 'other/doc2');
});

test('a hidden ink with a reason is not "hide" when nothing was up', () => {
  const r = run([ink(1000, 'u/doc1', 'recording')]);
  assert.deepEqual(r.effects, ['']);
});

test('"off" hides it; "on" starts counting from nothing', () => {
  let r = run([ink(1000), ink(2000), ink(3000), { type: 'off', now: 3500 }]);
  assert.equal(r.effects[3], 'hide');
  assert.equal(r.state.last, 'off');
  r = run([ink(4000), { type: 'on', now: 4100 }], r.state);
  assert.deepEqual(r.state.marks, []);
  assert.equal(r.state.last, '');
});

test('step never mutates the state it was given', () => {
  const s0 = P.initialState();
  const frozen = JSON.stringify(s0);
  P.step(s0, ink(1000));
  P.step(s0, { type: 'later', now: 1000 });
  assert.equal(JSON.stringify(s0), frozen);
  const r = run([ink(1), ink(2), ink(3)]);
  const before = JSON.stringify(r.state);
  P.step(r.state, { type: 'tick', now: 99999999 });
  assert.equal(JSON.stringify(r.state), before);
});

test('step survives nonsense', () => {
  assert.equal(P.step(undefined, undefined).effect, '');
  assert.equal(P.step(P.initialState(), { type: 'nope' }).effect, '');
  assert.equal(P.step(null, { type: 'tick' }).effect, '');
});

/* ---------------- place ---------------- */
test('place: centred over the worksheet area, under its top edge, never off screen', () => {
  assert.deepEqual(P.place({ left: 0, top: 100, width: 1000 }, { width: 400 }, 1000), { left: 300, top: 100 + P.GAP_PX });
  assert.deepEqual(P.place({ left: 200, top: 50, width: 800 }, { width: 400 }, 1000), { left: 400, top: 62 });
  // Wider than the area: pinned 8px in from the screen's edge.
  assert.deepEqual(P.place({ left: 0, top: 0, width: 300 }, { width: 380 }, 390), { left: 8, top: 12 });
  const right = P.place({ left: 700, top: 0, width: 300 }, { width: 400 }, 1000);
  assert.ok(right.left + 400 <= 1000 - 8);
});

/* ---------------- the numbers ---------------- */
test('the numbers make sense together', () => {
  assert.equal(P.STROKES, 1, 'any writing or typing is enough');
  assert.ok(P.WINDOW_MS >= 15000 && P.WINDOW_MS <= 120000);
  assert.equal(P.SHOW_MS, 0, 'it never goes away by itself');
  assert.equal(P.IDLE_SNOOZE_MS + P.LATER_SNOOZE_MS + P.RECORD_SNOOZE_MS, 0, 'nothing snoozes it');
  assert.equal(P.PREF_KEY, 'polymath.recordNudge.v1');
});

test('only a recording or a switch the teacher ticks stops it for good', () => {
  let r = run([ink(1000), { type: 'session', now: 2000 }]);
  assert.deepEqual(r.effects, ['show', 'hide']);
  r = run([ink(3000, 'u/doc1', 'session-off')], r.state);
  assert.deepEqual(r.effects, ['']);
  r = run([ink(4000), { type: 'off', now: 5000 }]);
  assert.deepEqual(r.effects, ['show', 'hide']);
  r = run([ink(6000, 'u/doc1', 'off')], r.state);
  assert.deepEqual(r.effects, ['']);
  r = run([ink(7000), ink(8000, 'u/doc1', 'recording')]);
  assert.deepEqual(r.effects, ['show', 'hide']);
});

test('typing in a text box on the page counts, fields elsewhere never do', () => {
  const t = between('function recNudgeTyping(e) {', '\n}\n');
  assert.ok(/\.annText\[contenteditable="true"\]/.test(t) && /#viewerArea/.test(t) && /recNudgeInk\(\{ type: 'text' \}\)/.test(t));
  const init = between('function recNudgeInit() {', '\nfunction recNudgeTyping');
  assert.ok(/addEventListener\('input', recNudgeTyping, true\)/.test(init));
});

/* ---------------- the module never touches a device ---------------- */
test('record-nudge.js opens no device, starts no recorder and writes nothing but its switch', () => {
  for (const banned of ['getUserMedia', 'getDisplayMedia', 'MediaRecorder', 'lessonStart', 'firebase', 'firestore', 'fetch(']) {
    assert.ok(!SRC.includes(banned), banned);
  }
  const writes = SRC.match(/localStorage\.(setItem|removeItem)\(([^,)]*)/g) || [];
  assert.ok(writes.length > 0);
  assert.ok(writes.every(w => /PREF_KEY/.test(w)), writes.join(' | '));
  // The session switch is the ONLY thing in sessionStorage.
  const sess = SRC.match(/sessionStorage\.(setItem|removeItem)\(([^,)]*)/g) || [];
  assert.ok(sess.length > 0);
  assert.ok(sess.every(w => /SESSION_KEY/.test(w)), sess.join(' | '));
  assert.ok(!/indexedDB/.test(SRC));
});

test('the box never takes the focus and keeps its keys', () => {
  assert.ok(!/\.focus\(/.test(SRC), 'show() must never focus the box');
  assert.ok(/addEventListener\('keydown', function \(e\) \{\s*e\.stopPropagation\(\)/.test(SRC));
  assert.ok(/role', 'status'/.test(SRC) && /aria-live', 'polite'/.test(SRC));
});

test('the CSS: hidden means hidden, motion is optional, print leaves it out, never in a window recording', () => {
  assert.ok(/#recNudge\[hidden\]\s*\{\s*display:\s*none/.test(CSS));
  assert.ok(/prefers-reduced-motion: reduce/.test(CSS));
  assert.ok(/@media print\s*\{\s*#recNudge\s*\{\s*display:\s*none !important/.test(CSS));
  assert.ok(/body\.lessonScreenRec #recNudge\s*\{\s*display:\s*none/.test(CSS));
  assert.ok(!/body\.immersive #recNudge/.test(CSS), 'a lesson written in full screen is worth warning about');
});

/* ---------------- the glue in index.html ---------------- */
const between = (a, b) => {
  const i = HTML.indexOf(a), j = HTML.indexOf(b, i + 1);
  assert.ok(i >= 0 && j > i, 'markers ' + a + ' … ' + b);
  return HTML.slice(i, j);
};

test('the module is loaded after its glue is defined, and its CSS is linked', () => {
  const tag = HTML.indexOf('<script src="record-nudge.js"></script>');
  const init = HTML.indexOf('<script>recNudgeInit();</script>');
  const glue = HTML.indexOf('function recNudgeInit()');
  assert.ok(tag > 0 && init > tag && glue > 0 && glue < tag);
  assert.ok(HTML.includes('<link rel="stylesheet" href="record-nudge.css">'));
  const syntax = fs.readFileSync(path.join(ROOT, 'tools/check-syntax.mjs'), 'utf8');
  assert.ok(syntax.includes("'record-nudge.js'"), 'check-syntax lists it');
});

test('finishPointer tells it at BOTH commit points, after the mark is really kept', () => {
  const fp = between('function finishPointer(e) {', "svg.addEventListener('pointerup', finishPointer);");
  const calls = fp.match(/if \(typeof recNudgeInk === 'function'\) recNudgeInk\(a2\);/g) || [];
  assert.equal(calls.length, 2, 'the text box and the stroke');
  // The stroke's call is inside the !tooSmall branch, after it was pushed.
  const kept = fp.slice(fp.indexOf('if (!tooSmall) {'));
  assert.ok(kept.indexOf('annotations.push(a2)') < kept.indexOf('recNudgeInk(a2)'));
  assert.ok(kept.indexOf('recNudgeInk(a2)') < kept.indexOf('} else if (tempNode'), 'a stroke too small to keep is not writing');
  // The text box's call comes after it is pushed and focused.
  const tb = fp.slice(fp.indexOf("if (a2.type === 'text') {"), fp.indexOf('delete a2._sx'));
  assert.ok(tb.indexOf('annotations.push(a2)') < tb.indexOf('recNudgeInk(a2)'));
  assert.ok(tb.indexOf('focusTextAnn(a2.id)') < tb.indexOf('recNudgeInk(a2)'), 'never between the capture release and the focus');
});

test('a recording starting, a role change, a new worksheet and the Record window all tell it', () => {
  const bar = between('function lessonBar(show) {', '\nfunction lessonView()');
  assert.ok(/recNudgeChanged\(\)/.test(bar), 'lessonBar');
  const role = between('function applyRoleUI() {', 'var student = isStudent();');
  assert.ok(/recNudgeChanged\(\)/.test(role), 'applyRoleUI');
  const load = between('async function loadPdf(bytes, name, contextCheck) {', 'currentDocId = null;');
  assert.ok(/recNudgeChanged/.test(load), 'loadPdf');
  const modal = between('function lessonOpenModal() {', 'function lessonCloseModal()');
  assert.ok(/recNudgeChanged\(\)/.test(modal) && /recNudgeSyncSwitch\(\)/.test(modal), 'lessonOpenModal');
});

test('Record now is the toolbar\'s own door — lessonOpen — and asks for the teacher again', () => {
  const glue = between('function recNudgeRecord() {', '/* ================= End writing without recording glue');
  assert.ok(/if \(!recNudgeTeacher\(\)\) return;/.test(glue));
  assert.ok(/lessonOpen\(\)/.test(glue));
  assert.ok(!/lessonStart\(/.test(glue), 'never a second way to start a recorder');
  assert.ok(!/\.focus\(/.test(glue), 'Start is lit, never focused — Enter must not start a recording');
  const teacher = between('function recNudgeTeacher() {', '\n}');
  assert.ok(/lessonTeacher\(\)/.test(teacher));
  // The toolbar button really is lessonOpen.
  assert.ok(HTML.includes("$('lessonRecordBtn').addEventListener('click', lessonOpen);"));
});

test('only the Record (and export) window refuses a mark; other dialogs only take a card down, float windows never', () => {
  const w = between('function recNudgeWindowOpen() {', '\n}');
  assert.ok(w.includes('#lessonModal.open') && w.includes('#lessonExportModal.open'));
  assert.ok(!w.includes('.modalBack.open'), 'an unrelated dialog must never stop a mark counting');
  const d = between('function recNudgeDialogOpen() {', '\n}');
  assert.ok(d.includes('.modalBack.open:not(.floatWin)'));
  const init = between('function recNudgeInit() {', '\nfunction recNudgeTyping');
  assert.ok(/dialog: recNudgeDialogOpen/.test(init) && /windowOpen: recNudgeWindowOpen/.test(init));
  assert.ok(!/pending:/.test(init), 'a lesson waiting to save is not a recording');
});

test('the card carries "Ignore for this session" beside "Don\'t warn me"', () => {
  assert.ok(/Ignore for this session/.test(SRC));
  assert.ok(/rnSessionBox/.test(SRC) && /ignoreSession\(\)/.test(SRC));
  assert.ok(/\.rnFoot/.test(CSS) && /\.rnSession\b/.test(CSS));
});

test('Record now on an unsaved sheet goes to Save first, and recNudgeWhy says why it stays away', () => {
  const r = between('function recNudgeRecord() {', '\n}\n');
  assert.ok(/!currentDocId/.test(r) && /saveBtn/.test(r) && /\.click\(\)/.test(r));
  assert.ok(/window\.recNudgeWhy = recNudgeWhy/.test(HTML));
});

test('the Record window carries the switch that brings it back', () => {
  assert.ok(/<input type="checkbox" id="lessonNudgeAgain" checked> Warn me when I write without recording/.test(HTML));
  const init = between('function recNudgeInit() {', '\nfunction recNudgeTyping');
  assert.ok(/lessonNudgeAgain/.test(init) && /setEnabled\(/.test(init));
});

test('every call from outside the glue is behind a typeof guard, so the vm harnesses that cut sections still run', () => {
  const glueAt = HTML.indexOf('/* ================= ⏺ Writing without recording — glue');
  const glueEnd = HTML.indexOf('/* ================= End writing without recording glue');
  assert.ok(glueAt > 0 && glueEnd > glueAt);
  const outside = (HTML.slice(0, glueAt) + HTML.slice(glueEnd)).split('\n')
    .filter(l => /recNudge(Ink|Changed|SyncSwitch|Init)\b/.test(l) && !/<script>recNudgeInit\(\);<\/script>/.test(l));
  assert.ok(outside.length >= 7, 'found the hooks: ' + outside.length);
  for (const l of outside) {
    assert.ok(/typeof recNudge(Ink|Changed|SyncSwitch) === 'function'/.test(l), l.trim());
  }
});

test('the version and the notes say so', () => {
  const v = (HTML.match(/var APP_VERSION = '(v[\d.]+)'/) || [])[1];
  assert.ok(v, 'APP_VERSION');
  const [maj, min] = v.slice(1).split('.').map(Number);
  assert.ok(maj > 1 || (maj === 1 && min >= 183), v);
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.ok(/Not recording/.test(readme));
  const claude = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  assert.ok(/record-nudge\.js/.test(claude));
});
