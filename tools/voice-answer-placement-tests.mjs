import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function section(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing shipped code: ${start}`);
  return html.slice(a, b);
}
const code = section('function voiceActionNumber(', 'async function voicePlanAndApply(') +
  section('function voiceDelegate(', '// The provider key stays on Firebase.');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  return { promise: new Promise(done => { resolve = done; }), resolve: value => resolve(value) };
}

function harness(options = {}) {
  const controller = new AbortController(), v = {}, requests = [], images = [], groundings = [], generated = [];
  const page = { num: 2, baseW: 600, baseH: 800 };
  const saved = { id: 'draft', type: 'text', page: 2, x: 10, y: 10, w: 100, h: 40, fontSize: 16,
    text: 'Old saved text', _ai: 'stale request' };
  const context = { page: 2, pageRef: page, width: 600, height: 800,
    cursor: { page: 2, x: 100, y: 200 }, annotations: [{ ...saved, text: 'Current unsaved text' }] };
  const counters = { renders: 0, dirty: 0, probes: 0 };
  const box = {
    AbortController, clearTimeout, console,
    voiceLive: v, voiceContextOK: () => true, current: true, busy: false,
    voiceActionCurrent: (live, request, ctx, signal) => box.current && box.voiceLive === live &&
      !signal?.aborted && !request.signal?.aborted && (!request.isCurrent || request.isCurrent()),
    voiceActionBusy: () => box.busy,
    annotations: [saved], editingId: 'draft', editModeId: 'draft', textFocusTimer: null,
    selectedId: 'draft', undoStack: [], redoStack: [], lessonCapture: { annotationsChanged: false },
    pages: [page], currentPageNum: () => 1,
    lessonSnapshot: () => assert.fail('A captured answer must use the captured annotations.'),
    voiceTypedContext: (p, snapshot) => '\nTyped page ' + p.num + ': ' + JSON.stringify(snapshot),
    answerKeyPageContext: p => '\nAnswer key page ' + p.num + ': (a) 42.',
    loadTeachingNotes: async () => { if (options.notes) await options.notes.promise; },
    voicePageBackground: async (live, p, signal) => [{ page: p.num, cards: true }],
    lessonTeachingPageJpeg: async (p, snapshot, bg) => {
      images.push({ page: p.num, snapshot: plain(snapshot), bg: plain(bg) });
      if (options.image) await options.image.promise;
      return options.noImage ? '' : 'page-two-image';
    },
    aiWithDeadline: (run, ms, signal) => run(signal),
    aiGrounding: (kind, opts) => { groundings.push({ kind, opts }); return "THE TEACHER'S OWN STYLE and teacher notes."; },
    tutorMethodRule: () => 'Use appropriate working.', voiceStatus: () => {},
    window: { askGemini: async (prompt, opts) => {
      requests.push({ prompt, opts });
      if (options.answer) await options.answer.promise;
      return options.raw === undefined ? '{"answer":"42"}' : options.raw;
    } },
    round2: n => Math.round(n * 100) / 100,
    annBounds: a => ({ x: a.x, y: a.y, x2: a.x + a.w, y2: a.y + a.h }),
    newAnnId: () => 'voice-answer',
    pushUndo: snap => { box.undoStack.push(snap); box.redoStack = []; },
    clearLassoSel: () => {},
    styleNoteGenerated: (...args) => generated.push(args),
    renderAllOverlays: () => counters.renders++,
    setDirty: value => { if (value) { counters.dirty++; box.lessonCapture.annotationsChanged = true; } },
    document: {
      createElement: () => {
        const probe = { style: {}, textContent: '', remove: () => counters.probes-- };
        Object.defineProperty(probe, 'scrollHeight', { get: () => typeof options.height === 'function'
          ? options.height(probe) : options.height || 30 });
        Object.defineProperty(probe, 'scrollWidth', { get: () => parseFloat(probe.style.width) });
        return probe;
      },
      body: { appendChild: () => counters.probes++ }
    }
  };
  vm.createContext(box); vm.runInContext(code, box);
  const request = { command: 'Answer question a.', transcript: [{ role: 'user', text: 'An older request.' }],
    signal: controller.signal, isCurrent: () => !controller.signal.aborted };
  return { box, v, page, context, controller, request, requests, images, groundings, generated, counters,
    run: () => box.voiceAnswerAtCursor(v, request, context, controller.signal) };
}

test('writes a grounded answer on the captured page at the exact pointer with one undo and recording update', async () => {
  const h = harness();
  assert.match(await h.run(), /Wrote the answer at your pointer/);
  assert.equal(h.box.annotations.length, 2);
  const answer = h.box.annotations[1];
  assert.deepEqual(plain({ page: answer.page, x: answer.x, y: answer.y, text: answer.text }),
    { page: 2, x: 100, y: 200, text: '42' });
  assert.equal(h.box.undoStack.length, 1);
  assert.equal(JSON.parse(h.box.undoStack[0])[0].text, 'Current unsaved text');
  assert.equal(h.box.annotations[0].text, 'Current unsaved text');
  assert.equal(h.box.annotations[0]._ai, undefined);
  assert.equal(h.box.editingId, null);
  assert.equal(h.counters.renders, 1); assert.equal(h.counters.dirty, 1);
  assert.equal(h.box.lessonCapture.annotationsChanged, true);
  assert.equal(h.counters.probes, 0);
  assert.deepEqual(plain(h.generated), [['voice-answer', 'Answer question a.', '42', true]]);
  assert.equal(h.groundings[0].kind, 'answer');
  assert.equal(h.groundings[0].opts.q, 'Answer question a.');
  assert.match(h.requests[0].prompt, /Current unsaved text/);
  assert.match(h.requests[0].prompt, /Answer key page 2/);
  assert.match(h.requests[0].prompt, /"x":100,"y":200/);
  assert.match(h.requests[0].opts.system, /ONLY the question or subpart/);
  assert.match(h.requests[0].opts.system, /several plausible matches/);
  assert.equal(h.requests[0].opts.json, true);
  assert.deepEqual(plain(h.requests[0].opts.images), [{ mimeType: 'image/jpeg', data: 'page-two-image' }]);
  assert.equal(h.images[0].page, 2);
});

test('an ambiguous or unavailable question asks for clarification without creating an annotation', async () => {
  for (const options of [{ raw: '{"clarification":"Which question has part a?"}' }, { noImage: true }]) {
    const h = harness(options), before = JSON.stringify(h.box.annotations);
    assert.match(await h.run(), /Which question|could not read this worksheet/);
    assert.equal(JSON.stringify(h.box.annotations), before);
    assert.equal(h.box.undoStack.length, 0); assert.equal(h.counters.dirty, 0);
    if (options.noImage) assert.equal(h.requests.length, 0);
  }
});

test('malformed, empty, oversized or mixed answer replies cannot write anything', async () => {
  for (const raw of ['unstructured answer', '{"answer":""}', '{"answer":"42","clarification":"Maybe?"}',
    '{"answer":"42","html":"<script>"}', JSON.stringify({ answer: 'x'.repeat(4001) })]) {
    const h = harness({ raw });
    assert.match(await h.run(), /could not prepare that answer/);
    assert.equal(h.box.annotations.length, 1); assert.equal(h.box.undoStack.length, 0);
  }
});

test('a missing or invalid pointer requests a worksheet location before any answer generation', async () => {
  for (const cursor of [null, { page: 1, x: 100, y: 100 }, { page: 2, x: NaN, y: 20 },
    { page: 2, x: -1, y: 20 }, { page: 2, x: 601, y: 20 }]) {
    const h = harness(); h.context.cursor = cursor;
    assert.match(await h.run(), /Point to a place on the worksheet/);
    assert.equal(h.requests.length, 0); assert.equal(h.box.annotations.length, 1);
  }
});

test('near-edge placement refuses rather than silently moving the pointer anchor', async () => {
  const h = harness(); h.context.cursor = { page: 2, x: 585, y: 790 };
  assert.match(await h.run(), /not enough room at the pointer/);
  assert.equal(h.requests.length, 0); assert.equal(h.box.undoStack.length, 0);
});

test('a long answer is fitted to page space without moving the anchor or clipping text', async () => {
  const h = harness({ height: probe => parseFloat(probe.style.width) < 500 ? 700 :
    parseFloat(probe.style.fontSize) > 14 ? 650 : 550 });
  assert.match(await h.run(), /Wrote the answer/);
  const answer = h.box.annotations[1];
  assert.equal(answer.x, 100); assert.equal(answer.y, 200);
  assert.equal(answer.w, 500); assert.equal(answer.fontSize, 14); assert.equal(answer.h, 550);
  assert.ok(answer.x + answer.w <= 600 && answer.y + answer.h <= 800);
  const noRoom = harness({ height: 900 });
  assert.match(await noRoom.run(), /will not fit at the pointer/);
  assert.equal(noRoom.box.annotations.length, 1); assert.equal(noRoom.counters.probes, 0);
});

test('worksheet edits, cancellation and a stopped session prevent a delayed answer from committing', async () => {
  for (const change of [h => { h.box.current = false; }, h => h.controller.abort(), h => { h.box.voiceLive = null; }]) {
    const answer = deferred(), h = harness({ answer });
    const pending = h.run(); await tick();
    assert.equal(h.requests.length, 1);
    change(h); answer.resolve();
    assert.match(await pending, /worksheet changed/);
    assert.equal(h.box.annotations.length, 1); assert.equal(h.box.undoStack.length, 0);
  }
});

test('a stale capture during rendering never reaches the answer generator', async () => {
  const image = deferred(), h = harness({ image });
  const pending = h.run(); await tick();
  h.box.current = false; image.resolve();
  assert.match(await pending, /worksheet changed/);
  assert.equal(h.requests.length, 0); assert.equal(h.box.annotations.length, 1);
});

test('drawing or replay blocks answer placement before generation and again before commit', async () => {
  const h = harness(); h.box.busy = true;
  assert.match(await h.run(), /Finish the current drawing/);
  assert.equal(h.requests.length, 0);
  const answer = deferred(), late = harness({ answer });
  const pending = late.run(); await tick(); late.box.busy = true; answer.resolve();
  assert.match(await pending, /Finish the current drawing/);
  assert.equal(late.box.annotations.length, 1); assert.equal(late.box.undoStack.length, 0);
});

test('spoken explanations retain their original response behavior while using the captured page', async () => {
  const h = harness({ raw: 'A short explanation.' });
  assert.equal(await h.box.voiceDelegate(h.v)(h.request, h.context), 'A short explanation.');
  assert.equal(h.groundings[0].kind, 'teach'); assert.equal(h.requests[0].opts.json, false);
  assert.equal(h.images[0].page, 2); assert.equal(h.box.annotations.length, 1);
});
