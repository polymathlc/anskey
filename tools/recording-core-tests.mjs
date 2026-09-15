/* Execute the shipped recording timeline without browser/audio dependencies.
   Audio supplies milliseconds; these checks cover the workings at that instant. */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = '/* ================= Lesson replay core ================= */';
const end = '/* ================= End lesson replay core ================= */';
const source = html;
const from = source.indexOf(start), to = source.indexOf(end, from);
assert(from >= 0 && to > from, 'recording core must be present');
const core = new Function(source.slice(from, to) + '\nreturn LessonReplayCore;')();
const view = { page: 1, x: 10, y: 20, zoom: 1 };
const pen = (id = 'ink1', page = 1) => ({ id, page, type: 'pen', color: '#123456', width: 2, points: [{ x: 4, y: 5 }] });
const text = (id = 'words1', words = 'Work') => ({ id, page: 1, type: 'text', color: '#000', x: 4, y: 8, w: 100, h: 40, fontSize: 16, text: words, kw: [] });
const clone = value => JSON.parse(JSON.stringify(value));
let count = 0;
function check(name, run) {
  try { run(); count++; }
  catch (error) { console.error('FAIL: ' + name); throw error; }
}

check('baseline and every playback result are isolated from editable annotations', () => {
  const baseline = [pen(), text()];
  const recorder = core.createRecorder(baseline, view);
  baseline[0].points[0].x = 999;
  baseline[1].text = 'later';
  const timeline = recorder.finish(100);
  assert.equal(timeline.initial.annotations[0].points[0].x, 4);
  assert.equal(timeline.initial.annotations[1].text, 'Work');
  const player = core.createPlayer(timeline);
  timeline.initial.annotations[0].points[0].x = 800;
  const state = player.stateAt(0);
  assert.equal(state.annotations[0].points[0].x, 4);
  assert(Object.isFrozen(state.annotations[0].points[0]));
  assert.throws(() => { state.annotations[0].points[0].x = 7; }, TypeError);
  assert.strictEqual(player.stateAt(50).annotations, state.annotations, 'unchanged frames reuse an immutable annotation snapshot');
});

check('pencil grows as deltas and preserves a cancelled/transient stroke removal', () => {
  const recorder = core.createRecorder([], view), live = pen();
  recorder.capture(10, [live], view, { drawingId: live.id });
  live.points.push({ x: 5, y: 6 }, { x: 8, y: 9 });
  recorder.capture(20, [live], view, { drawingId: live.id });
  recorder.capture(30, [], view);
  const timeline = recorder.finish(40);
  assert.equal(timeline.events[0].type, 'upsert');
  assert.deepEqual(timeline.events[1], { t: 20, type: 'append', id: 'ink1', from: 1, points: [{ x: 5, y: 6 }, { x: 8, y: 9 }] });
  const player = core.createPlayer(timeline);
  assert.equal(player.stateAt(9).annotations.length, 0);
  assert.equal(player.stateAt(10).annotations[0].points.length, 1);
  assert.equal(player.stateAt(19).annotations[0].points.length, 1);
  assert.equal(player.stateAt(20).annotations[0].points.length, 3);
  assert.equal(player.stateAt(30).annotations.length, 0);
});

check('active pencil growth reads only a bounded prefix and the new points', () => {
  let reads = 0;
  const live = pen();
  const arr = live.points;
  live.points = new Proxy(arr, { get(target, key, receiver) {
    if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
    return Reflect.get(target, key, receiver);
  } });
  const recorder = core.createRecorder([live], view);
  reads = 0;
  for (let n = 1; n <= 800; n++) {
    arr.push({ x: n, y: n });
    recorder.capture(n, [live], view, { drawingId: live.id });
  }
  assert(reads < 800 * 8, 'append capture must not rescan the growing stroke: ' + reads);
  const timeline = recorder.finish(800);
  assert.equal(timeline.events.length, 800);
  assert(timeline.events.every(e => e.type === 'append' && e.points.length === 1));
  assert.equal(core.createPlayer(timeline).stateAt(800).annotations[0].points.length, 801);
});

check('ordinary stroke edits detect altered middle points and shorter undo strokes', () => {
  const live = pen();
  live.points = Array.from({ length: 8 }, (_, n) => ({ x: n, y: n }));
  const recorder = core.createRecorder([live], view);
  live.points[2].x = 100;
  recorder.capture(10, [live], view);
  live.points.splice(4);
  recorder.capture(20, [live], view, { drawingId: live.id });
  const timeline = recorder.finish(30), player = core.createPlayer(timeline);
  assert(timeline.events.every(e => e.type === 'upsert'));
  assert.equal(player.stateAt(10).annotations[0].points[2].x, 100);
  assert.equal(player.stateAt(20).annotations[0].points.length, 4);
  assert.equal(player.stateAt(0).annotations[0].points[2].x, 2);
});

check('text inputs, erasing, undo, and backward seeks are exact', () => {
  const ink = pen(), words = text(), recorder = core.createRecorder([ink, words], view);
  words.text = 'Work out'; recorder.capture(100, [ink, words], view);
  words.text = 'Work out 2 + 3'; recorder.capture(200, [ink, words], view);
  recorder.capture(300, [words], view);
  recorder.capture(400, [ink, words], view);
  const player = core.createPlayer(recorder.finish(500));
  assert.deepEqual(player.stateAt(300).annotations.map(a => a.id), ['words1']);
  assert.equal(player.stateAt(150).annotations[1].text, 'Work out');
  const endState = player.stateAt(500);
  assert.deepEqual(endState.annotations.map(a => a.id), ['ink1', 'words1']);
  assert.equal(player.stateAt(0).annotations[1].text, 'Work');
  assert.deepEqual(player.stateAt(500).annotations, endState.annotations);
});

check('view restores page, PDF position and relative zoom at audio timestamps', () => {
  const recorder = core.createRecorder([pen()], view);
  const changed = { page: 4, x: 87.5, y: 225.2, zoom: 1.75 };
  recorder.capture(150, null, changed, { annotationsChanged: false });
  const player = core.createPlayer(recorder.finish(300));
  const first = player.stateAt(149);
  assert.deepEqual(first.view, view);
  const moved = player.stateAt(150);
  assert.deepEqual(moved.view, changed);
  assert.strictEqual(first.annotations, moved.annotations, 'view-only event does not copy old ink');
  assert.deepEqual(player.stateAt(1).view, view);
  assert.deepEqual(player.stateAt(10000).view, changed);
});

check('reordering annotations preserves z-order and replays deterministically', () => {
  const a = pen('a'), b = pen('b'), c = pen('c');
  const recorder = core.createRecorder([a, b], view);
  recorder.capture(20, [b, a], view);
  recorder.capture(40, [c, b], view);
  const player = core.createPlayer(recorder.finish(80));
  assert.deepEqual(player.stateAt(20).annotations.map(a => a.id), ['b', 'a']);
  assert.deepEqual(player.stateAt(40).annotations.map(a => a.id), ['c', 'b']);
  assert.deepEqual(player.stateAt(0).annotations.map(a => a.id), ['a', 'b']);
});

check('caller and stored copies cannot alter a finished recorder', () => {
  const recorder = core.createRecorder([pen()], view);
  const first = recorder.finish(10);
  first.initial.annotations.length = 0;
  assert.equal(recorder.finish(200).initial.annotations.length, 1);
  assert.equal(recorder.finish(200).duration, 10);
  assert.throws(() => recorder.capture(11, [], view), /finished/);
});

check('duration, event count and byte limits leave the last valid recording intact', () => {
  const recorder = core.createRecorder([], view);
  recorder.capture(100, [], view);
  assert.throws(() => recorder.capture(99, [], view), /number|integer/);
  assert.throws(() => recorder.capture(600001, [], view), /number/);
  assert.equal(recorder.finish(600000).duration, 600000);
  const events = core.createRecorder([], view);
  for (let n = 1; n <= core.limits.events; n++) events.capture(n, null, { ...view, x: n }, { annotationsChanged: false });
  assert.throws(() => events.capture(core.limits.events + 1, null, view, { annotationsChanged: false }), /full/);
  assert.equal(events.stats().events, core.limits.events);
  assert.equal(core.parse(events.finish(core.limits.events)).events.length, core.limits.events);
  const words = text('words', 'x'.repeat(core.limits.text));
  const bytes = core.createRecorder([words], view);
  let accepted = 0;
  for (let n = 1; n < 200; n++) {
    words.text = String(n).padEnd(core.limits.text, 'x');
    try { bytes.capture(n, [words], view); accepted = n; }
    catch (error) { assert.match(error.message, /full/); break; }
  }
  assert(accepted > 0 && accepted < 199);
  assert(bytes.stats().bytes <= core.limits.bytes);
  const stored = bytes.finish(accepted);
  assert(new TextEncoder().encode(JSON.stringify(stored)).length <= core.limits.bytes);
  assert.equal(core.createPlayer(stored).stateAt(accepted).annotations[0].text, String(accepted).padEnd(core.limits.text, 'x'));
});

check('capture strips internal/active-content fields and stored data rejects them', () => {
  const a = { ...text(), html: '<script>unsafe()</script>', src: 'https://example.com', _ai: true };
  const stored = core.createRecorder([a], view).finish(1);
  assert(!('html' in stored.initial.annotations[0]));
  assert(!('src' in stored.initial.annotations[0]));
  assert(!('_ai' in stored.initial.annotations[0]));
  const unsafe = clone(stored); unsafe.initial.annotations[0].html = '<script>x</script>';
  assert.throws(() => core.parse(unsafe), /unexpected/);
});

check('loaded recording rejects malformed structures, coordinates, ids and events', () => {
  const valid = core.createRecorder([pen()], view).finish(100);
  const invalid = change => { const value = clone(valid); change(value); assert.throws(() => core.parse(value)); };
  invalid(v => { v.version = 2; });
  invalid(v => { v.duration = -1; });
  invalid(v => { v.duration = 600001; });
  invalid(v => { v.duration = 1.1; });
  invalid(v => { v.initial.view.zoom = 0; });
  invalid(v => { v.initial.view.page = '1'; });
  invalid(v => { v.initial.view.x = Infinity; });
  invalid(v => { v.initial.annotations[0].points[0].x = '3'; });
  invalid(v => { v.initial.annotations[0].points[0].y = 1000001; });
  invalid(v => { v.initial.annotations[0].points.push(null); });
  invalid(v => { v.initial.annotations[0].id = '__proto__'; });
  invalid(v => { v.initial.annotations[0].id = 'constructor'; });
  invalid(v => { v.initial.annotations[0].id = 'a\" onclick='; });
  invalid(v => { v.initial.annotations[0].type = 'iframe'; });
  invalid(v => { v.initial.annotations[0].color = 'url(https://evil.invalid)'; });
  invalid(v => { v.initial.annotations.push(v.initial.annotations[0]); });
  invalid(v => { v.events = [{ t: 101, type: 'remove', id: 'ink1' }]; });
  invalid(v => { v.events = [{ t: 90, type: 'view', view }, { t: 80, type: 'view', view }]; });
  invalid(v => { v.events = [{ t: 90, type: 'remove', id: 'absent' }]; });
  invalid(v => { v.events = [{ t: 90, type: 'append', id: 'ink1', from: 3, points: [{ x: 1, y: 1 }] }]; });
  invalid(v => { v.events = [{ t: 90, type: 'append', id: 'ink1', from: 1, points: [] }]; });
  invalid(v => { v.events = [{ t: 90, type: 'order', ids: ['ink1', 'ink1'] }]; });
  invalid(v => { v.events = [{ t: 90, type: 'execute', code: 'alert(1)' }]; });
  invalid(v => { v.events = Array.from({ length: core.limits.events + 1 }, () => ({ t: 0, type: 'view', view })); });
  const poison = JSON.stringify(valid).replace('"id":"ink1"', '"__proto__":{"polluted":true},"id":"ink1"');
  assert.throws(() => core.parse(poison), /unexpected/);
  assert.equal({}.polluted, undefined);
  assert.throws(() => core.parse('x'.repeat(core.limits.bytes + 1)), /oversized/);
  assert.throws(() => core.parse('{invalid'), /invalid/);
});

check('safe text is preserved verbatim without interpreting HTML', () => {
  const words = text('w', '<img src=x onerror=alert(1)>\nπ = 3.14 📝');
  const stored = core.createRecorder([words], view).finish(1);
  assert.equal(core.createPlayer(JSON.stringify(stored)).stateAt(0).annotations[0].text, words.text);
});

check('replacing one annotation at the count limit is atomic and valid', () => {
  const baseline = Array.from({ length: core.limits.annotations }, (_, n) => pen('p' + n));
  const recorder = core.createRecorder(baseline, view);
  baseline[0] = pen('replacement');
  recorder.capture(10, baseline, view);
  const timeline = recorder.finish(20);
  assert.equal(timeline.events[0].type, 'remove');
  const result = core.createPlayer(timeline).stateAt(20);
  assert.equal(result.annotations.length, core.limits.annotations);
  assert.equal(result.annotations[0].id, 'replacement');
});

console.log(`${count} recording core checks passed.`);
