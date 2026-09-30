import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function cut(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start); return html.slice(a, b);
}
const shipped = cut('var aiQuestionFocus =', '/* ================= End shared question focus') +
  cut('function eventPoint(e, p, rect)', '/* Read layout once');
const plain = value => JSON.parse(JSON.stringify(value));

function harness() {
  const events = new Map(), winEvents = new Map(), nodes = new Map();
  const rect = { left: 100, top: -100, width: 300, height: 400 };
  const areaRect = { left: 50, top: 50, right: 550, bottom: 450 };
  function node() { return { style: {}, hidden: false, textContent: '', handlers: new Map(), attrs: {},
    classList: { toggle() {} }, setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(k, fn) { this.handlers.set(k, fn); } }; }
  for (const id of ['aiQuestionFocusBtn', 'aiQuestionFocusClear']) nodes.set(id, node());
  nodes.set('viewerArea', { getBoundingClientRect: () => areaRect });
  const svg = { contains: target => target?.page === 1, getBoundingClientRect: () => rect,
    setPointerCapture() {}, releasePointerCapture() {} };
  const target = { page: 1, closest: () => null };
  const annotations = [{ id: 'original', text: 'unchanged' }], undoStack = ['before'], redoStack = ['after'];
  const c = { pages: [{ num: 1, baseW: 600, baseH: 800, svg }], currentDocId: 'worksheet',
    currentUser: { uid: 'teacher' }, wsEpoch: 4, lessonPlayback: null, lessonOpening: null,
    annotations, undoStack, redoStack, voiceActionBusy: () => false, round2: n => Math.round(n * 100) / 100,
    toast() {}, setDirty() { assert.fail('Focus must not save worksheet content.'); },
    pushUndo() { assert.fail('Focus must not enter annotation history.'); },
    $: id => nodes.get(id), document: {
      createElement: () => node(), body: { appendChild: el => nodes.set(el.id, el) },
      addEventListener: (name, fn, capture) => events.set(name, { fn, capture }) },
    window: { addEventListener: (name, fn) => winEvents.set(name, fn) } };
  vm.createContext(c); vm.runInContext(shipped, c);
  function event(name, extra = {}) {
    const e = { target, pointerId: 1, button: 0, isPrimary: true, clientX: 160, clientY: 80,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra };
    events.get(name).fn(e); return e;
  }
  const arm = () => nodes.get('aiQuestionFocusBtn').handlers.get('click')();
  function focus() { arm(); event('pointerdown'); event('pointerup', { clientX: 310, clientY: 160 }); return c.aiQuestionFocusCurrent(); }
  return { c, events, winEvents, nodes, rect, areaRect, event, arm, focus, annotations, undoStack, redoStack };
}

test('question focus follows actual SVG coordinates after zoom and scroll', () => {
  const h = harness();
  assert.deepEqual(plain(h.focus()), { docId: 'worksheet', epoch: 4, uid: 'teacher', page: 1, x: 120, y: 360, w: 300, h: 160 });
  assert.equal(h.nodes.get('aiQuestionFocusFrame').style.left, '160px');
  assert.equal(h.nodes.get('aiQuestionFocusFrame').style.top, '80px');
  Object.assign(h.rect, { left: 70, top: -280, width: 600, height: 800 });
  h.events.get('scroll').fn();
  assert.equal(h.nodes.get('aiQuestionFocusFrame').style.left, '190px');
  assert.equal(h.nodes.get('aiQuestionFocusFrame').style.top, '80px');
  assert.equal(h.nodes.get('aiQuestionFocusFrame').style.width, '300px');
});

test('focus stays on the question when the cursor moves to the answer space', () => {
  const h = harness(); const f = plain(h.focus());
  h.event('pointermove', { clientX: 200, clientY: 250 });
  assert.deepEqual(plain(h.c.aiQuestionFocusCurrent()), f);
  assert.deepEqual(h.annotations, [{ id: 'original', text: 'unchanged' }]);
  assert.deepEqual(h.undoStack, ['before']); assert.deepEqual(h.redoStack, ['after']);
  assert.equal(h.nodes.get('aiQuestionFocusBtn').attrs['aria-pressed'], 'true');
});

test('reverse drags clamp to the page and clipped focus frame stays inside viewer', () => {
  const h = harness(); h.arm(); h.event('pointerdown', { clientX: 450, clientY: 330 });
  h.event('pointerup', { clientX: 80, clientY: 20 });
  assert.deepEqual(plain(h.c.aiQuestionFocusCurrent()), { docId: 'worksheet', epoch: 4, uid: 'teacher', page: 1, x: 0, y: 240, w: 600, h: 560 });
  const frame = h.nodes.get('aiQuestionFocusFrame');
  assert.equal(frame.style.left, '100px'); assert.equal(frame.style.top, '50px');
  assert.equal(frame.style.height, '250px');
});

test('focus invalidates when document, worksheet epoch, user or page changes', () => {
  for (const mutate of [c => c.currentDocId = 'other', c => c.wsEpoch++, c => c.currentUser = { uid: 'other' }, c => c.pages = []]) {
    const h = harness(); h.focus(); mutate(h.c);
    assert.equal(h.c.aiQuestionFocusCurrent(), null);
    h.c.aiQuestionFocusSync();
    assert.equal(h.c.aiQuestionFocus, null); assert.equal(h.nodes.get('aiQuestionFocusClear').hidden, true);
    assert.equal(h.nodes.get('aiQuestionFocusFrame').hidden, true);
  }
});

test('a pending drag cannot publish a focus after document changes', () => {
  const h = harness(); h.arm(); h.event('pointerdown'); h.c.wsEpoch++;
  h.event('pointerup', { clientX: 310, clientY: 160 });
  assert.equal(h.c.aiQuestionFocusCurrent(), null); assert.equal(h.c.aiQuestionFocusArmed, false);
});

test('Escape, cancellation and window blur leave an existing question focus intact', () => {
  for (const cancel of [h => h.event('keydown', { key: 'Escape' }), h => h.event('pointercancel'), h => h.winEvents.get('blur')()]) {
    const h = harness(); const before = plain(h.focus()); h.arm(); h.event('pointerdown'); cancel(h);
    assert.equal(h.c.aiQuestionFocusArmed, false); assert.equal(h.c.aiQuestionFocusDrag, null);
    assert.deepEqual(plain(h.c.aiQuestionFocusCurrent()), before);
  }
  const h = harness(); h.focus(); h.nodes.get('aiQuestionFocusClear').handlers.get('click')();
  assert.equal(h.c.aiQuestionFocusCurrent(), null);
});

test('focus capture consumes drawing events but ignores controls and unrelated pointers', () => {
  const h = harness(); h.arm();
  const ignored = h.event('pointerdown', { target: { page: 1, closest: () => ({}) } });
  assert.equal(ignored.prevented, undefined); assert.equal(h.c.aiQuestionFocusDrag, null);
  const down = h.event('pointerdown'); assert.equal(down.stopped, true);
  h.event('pointerup', { pointerId: 2, clientX: 310, clientY: 160 });
  assert.ok(h.c.aiQuestionFocusDrag);
  const up = h.event('pointerup', { clientX: 310, clientY: 160 }); assert.equal(up.stopped, true);
  assert.equal(h.events.get('pointerdown').capture, true);
});

test('a tiny click keeps the previous focus and replay cannot start a focus drag', () => {
  const h = harness(); const before = plain(h.focus()); h.arm(); h.event('pointerdown'); h.event('pointerup');
  assert.deepEqual(plain(h.c.aiQuestionFocusCurrent()), before);
  h.c.lessonPlayback = {}; h.arm(); assert.equal(h.c.aiQuestionFocusArmed, false);
});
