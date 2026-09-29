/* The reminder to record, run for real against stubs. It is driven only by
   setDirty, so every case here is a sequence of edits and a look at the bar. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function cut(from, to) {
  const a = html.indexOf(from), b = html.indexOf(to, a);
  assert(a >= 0 && b > a, 'shipped section must exist: ' + from);
  return html.slice(a, b);
}
const section = cut('/* ================= Reminder to record ================= */', '/* ================= End reminder to record ================= */');
const setDirtySrc = cut('function setDirty(v) {', '/* ================= Undo / redo ================= */');
const roleSrc = cut('function lessonRoleChanged() {', '/* ================= Reminder to record');
const barSrc = cut('function lessonBar(show) {', 'function lessonView() {');

function world() {
  const boot = `
var nodes = Object.create(null), toasts = [], opened = 0, prefs = {}, liveLastEditAt = 0, dirty = false;
function Node() { var self = this; this.hidden = true; this.checked = true; this.style = {}; this.listeners = {}; this.classes = new Set(); this.textContent = '';
  this.classList = { add: function (x) { self.classes.add(x); }, remove: function (x) { self.classes.delete(x); }, contains: function (x) { return self.classes.has(x); },
    toggle: function (x, on) { if (on) self.classes.add(x); else self.classes.delete(x); } };
  this.querySelector = function () { return null; };
  this.addEventListener = function (n, f) { (this.listeners[n] = this.listeners[n] || []).push(f); };
  this.emit = function (n) { (this.listeners[n] || []).forEach(function (f) { f({}); }); }; }
function $(id) { return nodes[id] || (nodes[id] = new Node()); }
function toast(m) { toasts.push(m); }
var LESSON_TYPES = ['pen', 'highlight', 'text', 'rect', 'ellipse', 'line', 'arrow', 'brace'];
var annotations = [], pages = [1], currentDocId = 'doc1', wsEpoch = 1, teacher = true, busy = false, lessonCapture = null, lessonPending = null;
function lessonTeacher() { return teacher; }
function lessonBusy() { return busy; }
function lessonPrefGet(k) { return Object.prototype.hasOwnProperty.call(prefs, k) ? prefs[k] : null; }
function lessonPrefSet(k, v) { prefs[k] = v; }
function lessonOpen() { opened++; }
function syncFavActive() {}
function scheduleAutoSave() {} function scheduleDraftSave() {} function updateKwPanel() {}
`;
  const ctx = vm.createContext({});
  vm.runInContext(boot + section + '\n' + setDirtySrc.replace(/\$\('saveBtn'\)/, "$('saveBtn')") + '\n' + roleSrc + '\n' + barSrc, ctx);
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);
const mark = (ctx, n, type = 'pen') => run(ctx, `for (var i = 0; i < ${n}; i++) { annotations.push({ id: 'a' + annotations.length, type: '${type}' }); setDirty(true); }`);
const shown = ctx => run(ctx, "!$('recRemindBar').hidden");

test('quiet until a run of working marks, then the bar and the button nudge', () => {
  const ctx = world();
  mark(ctx, 4);
  assert.equal(shown(ctx), false, 'four marks is not yet a run');
  mark(ctx, 2);
  assert.equal(shown(ctx), true);
  assert.equal(run(ctx, "$('lessonRecordBtn').classList.contains('nudge')"), true);
});

test('a worksheet that already carries a lesson is left alone', () => {
  const ctx = world();
  run(ctx, "annotations.push({ id: 'v', type: 'video', lessonRecording: { version: 1 } })");
  mark(ctx, 20);
  assert.equal(shown(ctx), false);
});

test('never while recording, for a student, or with the setting off', () => {
  let ctx = world(); run(ctx, 'busy = true'); mark(ctx, 20); assert.equal(shown(ctx), false);
  ctx = world(); run(ctx, 'teacher = false'); mark(ctx, 20); assert.equal(shown(ctx), false);
  ctx = world(); run(ctx, "prefs['polymath.lessonRemind'] = false"); mark(ctx, 20); assert.equal(shown(ctx), false);
  ctx = world(); run(ctx, 'currentDocId = null'); mark(ctx, 20); assert.equal(shown(ctx), false, 'an unsaved worksheet cannot be recorded');
});

test('Later asks again after more writing, not at once', () => {
  const ctx = world();
  mark(ctx, 6); assert.equal(shown(ctx), true);
  run(ctx, "$('recRemindLater').emit('click')");
  assert.equal(shown(ctx), false);
  mark(ctx, 5); assert.equal(shown(ctx), false, 'not straight back');
  mark(ctx, 12); assert.equal(shown(ctx), true);
});

test('Not this worksheet is for this open worksheet only', () => {
  const ctx = world();
  mark(ctx, 6);
  run(ctx, "$('recRemindSkip').emit('click')");
  mark(ctx, 30); assert.equal(shown(ctx), false);
  run(ctx, "wsEpoch = 2; currentDocId = 'doc2'; annotations = [];");
  mark(ctx, 6); assert.equal(shown(ctx), true, 'the next worksheet is reminded');
});

test('Stop reminding me is the device preference and says how to undo it', () => {
  const ctx = world();
  mark(ctx, 6);
  run(ctx, "$('recRemindOff').emit('click')");
  assert.equal(shown(ctx), false);
  assert.equal(run(ctx, "prefs['polymath.lessonRemind']"), false);
  assert.match(run(ctx, 'toasts[toasts.length - 1]'), /Record window/);
});

test('Record now hides the bar and opens the recorder', () => {
  const ctx = world();
  mark(ctx, 6);
  run(ctx, "$('recRemindGo').emit('click')");
  assert.equal(shown(ctx), false);
  assert.equal(run(ctx, 'opened'), 1);
  assert.equal(run(ctx, "$('lessonRecordBtn').classList.contains('nudge')"), false);
});

test('starting a recording, or a role change, answers the reminder', () => {
  let ctx = world(); mark(ctx, 6); run(ctx, 'lessonBar(true)'); assert.equal(shown(ctx), false);
  ctx = world(); mark(ctx, 6); run(ctx, 'lessonRoleChanged()'); assert.equal(shown(ctx), false);
});

test('a base is taken from what is already on the worksheet', () => {
  const ctx = world();
  run(ctx, "for (var i = 0; i < 40; i++) annotations.push({ id: 'old' + i, type: 'pen' })");
  mark(ctx, 3); assert.equal(shown(ctx), false, 'forty old marks are not a run of new ones');
  mark(ctx, 3); assert.equal(shown(ctx), true);
});

test('a reminder that throws never costs the edit', () => {
  const ctx = world();
  run(ctx, "recRemindNote = function () { throw new Error('boom'); }; annotations.push({ id: 'x', type: 'pen' }); setDirty(true);");
  assert.equal(run(ctx, 'dirty'), true);
});

test('the shipped hooks are all there', () => {
  assert.match(html, /function setDirty\(v\) \{[\s\S]*?recRemindNote\(\)/);
  assert.match(html, /function lessonOpenModal\(\) \{[\s\S]*?recRemindHide\(\)/);
  assert.match(html, /wsEpoch\+\+;[^\n]*\n\s*if \(typeof recRemindHide/);
  assert.match(html, /id="lessonRemind"/);
  assert.match(html, /id="recRemindBar"[^>]*hidden/);
});
