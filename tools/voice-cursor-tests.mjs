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
const shipped = section('var voicePointer = null;', '/* ================= End validated voice worksheet actions') +
  section('function eventPoint(e, p, rect)', '/* Read layout once') +
  section('function translateAnn(a, dx, dy)', '/* The .annText padding') +
  section('function annFrame(a)', 'function normWord(') +
  section('function annBounds(a)', '/* Draw annotations straight') +
  section('function snapshot()', '/* ================= PDF loading') +
  section('function voiceDelegate(v)', '// The provider key stays on Firebase.') +
  section("document.addEventListener('pointermove', voicePointerRecord", '/* ================= End Chung GPT Voice AI');
const plain = value => JSON.parse(JSON.stringify(value));

function harness() {
  const documentEvents = new Map(), windowEvents = new Map();
  const calls = { plans: [], images: [], renders: 0, dirty: 0, style: [], probes: [] };
  const rects = [
    { left: 100, top: 60, width: 300, height: 400 },
    { left: 100, top: 480, width: 300, height: 400 }
  ];
  let hit = { page: 1, tagName: 'path', closest: () => null };
  let plan = { objects: [{ type: 'triangle', x: 10, y: 10, w: 48, h: 48, color: '#0000FF' }] };
  let answer = { answer: 'a) 6 × 7 = 42.' };
  let shot = 'page-jpeg';
  const area = { scrollTop: 0, contains: node => !!node?.page,
    getBoundingClientRect: () => ({ left: 50, top: 50, right: 900, bottom: 900 }) };
  const v = { uid: 'teacher' }, controller = new AbortController();
  const c = {
    annotations: [], currentDocId: 'worksheet', currentUser: { uid: 'teacher' }, wsEpoch: 3,
    pageNum: 2, currentPageNum: () => c.pageNum,
    pages: rects.map((rect, index) => ({ num: index + 1, baseW: 600, baseH: 800,
      wrap: { contains: node => node?.page === index + 1, offsetTop: index * 820 },
      svg: { getBoundingClientRect: () => rect } })),
    voiceLive: v, voiceContextOK: () => c.currentUser?.uid === v.uid,
    undoStack: [], redoStack: [], selectedId: null, editingId: null, editModeId: null, lassoSel: null,
    lessonSnapshot: () => plain(c.annotations), lastAnswerKey: { items: [] },
    drawing: null, erasing: null, draggingSel: null, resizingSel: null, lassoing: null,
    lassoMoving: null, lassoResizing: null, lassoRotating: null, activePointerId: null,
    lessonCapture: null, lessonPlayback: null, lessonOpening: null, reviseMode: false, textFocusTimer: null,
    round2: n => Math.round(n * 100) / 100, annLocked: a => !!a.locked, annNoteMin: () => false,
    newAnnId: (() => { let n = 0; return () => `voice-${++n}`; })(),
    clearTimeout, clearLassoSel: () => { c.lassoSel = null; },
    renderAllOverlays: () => { calls.renders++; },
    setDirty: value => { if (value) calls.dirty++; },
    $: id => { assert.equal(id, 'viewerArea'); return area; },
    document: {
      hidden: false,
      elementFromPoint: () => hit,
      addEventListener: (type, listener, capture) => documentEvents.set(type, { listener, capture }),
      createElement: tag => {
        assert.equal(tag, 'div');
        const probe = { style: {}, textContent: '', scrollHeight: 48, scrollWidth: 100,
          remove() { this.removed = true; } };
        calls.probes.push(probe); return probe;
      },
      body: { appendChild: () => {} }
    },
    window: {
      addEventListener: (type, listener) => windowEvents.set(type, listener),
      askGemini: async (prompt, options) => {
        calls.plans.push({ prompt, options });
        const value = options.images ? answer : plan;
        return typeof value === 'function' ? value() : JSON.stringify(value);
      }
    },
    aiWithDeadline: (run, timeout, signal) => run(signal),
    loadTeachingNotes: async () => {}, voiceTypedContext: () => 'Current typed text.',
    answerKeyPageContext: p => `Key for page ${p.num}.`, voicePageBackground: async () => [],
    lessonTeachingPageJpeg: async (p, snapshot) => { calls.images.push({ page: p.num, snapshot: plain(snapshot) }); return shot; },
    aiGrounding: () => "THE TEACHER'S OWN STYLE: explain arithmetic.", tutorMethodRule: () => '',
    voiceStatus: () => {}, styleNoteGenerated: (...args) => calls.style.push(args)
  };
  vm.createContext(c); vm.runInContext(shipped, c);
  const request = { command: 'Add a small blue triangle there.', transcript: [], signal: controller.signal, isCurrent: () => !controller.signal.aborted };
  const record = (x = 250, y = 260, extra = {}) => c.voicePointerRecord({ clientX: x, clientY: y, pointerType: 'mouse', isPrimary: true, ...extra });
  const capture = () => c.voiceActionContext();
  return { c, v, request, controller, rects, calls, record, capture, documentEvents, windowEvents,
    setHit: node => { hit = node; }, hit: () => hit,
    setPlan: value => { plan = value; }, setAnswer: value => { answer = value; }, setShot: value => { shot = value; },
    add: (context = capture()) => c.voicePlanAndApply(v, request, { intent: 'add', targetId: null, confidence: 0.98, needsClarification: false }, context, controller.signal),
    write: (context = capture()) => c.voiceAnswerAtCursor(v, request, context, controller.signal)
  };
}

test('the hovered page and actual SVG scale win over the page at the viewer midpoint', () => {
  const h = harness(); h.record();
  assert.deepEqual(plain(h.c.voiceCursorPoint()), { page: 1, x: 300, y: 400 });
  const context = h.capture();
  assert.equal(context.page, 1); assert.equal(context.viewPageNum, 2);
  assert.equal(h.c.voiceActionCurrent(h.v, h.request, context, h.controller.signal), true);
  assert.deepEqual(plain(context.wire.cursor), { page: 1, x: 300, y: 400 });
});

test('stationary pointer is mapped from fresh layout after zooming, scrolling or switching the page below it', () => {
  const h = harness(); h.record();
  Object.assign(h.rects[0], { left: 50, top: -140, width: 600, height: 800 });
  assert.deepEqual(plain(h.c.voiceCursorPoint()), { page: 1, x: 200, y: 400 });
  h.setHit({ page: 2, tagName: 'DIV', closest: () => null });
  Object.assign(h.rects[1], { left: 100, top: 60, width: 300, height: 400 });
  assert.deepEqual(plain(h.c.voiceCursorPoint()), { page: 2, x: 300, y: 400 });
});

test('cards remain valid worksheet targets while controls, modals, iframes and off-page points do not', () => {
  const h = harness(); h.record();
  h.setHit({ page: 1, tagName: 'DIV', closest: () => null });
  assert.ok(h.c.voiceCursorPoint(), 'an ordinary HTML card is part of the page');
  for (const node of [
    null, { tagName: 'DIV', closest: () => null },
    { page: 1, tagName: 'IFRAME', closest: () => null },
    { page: 1, tagName: 'SPAN', closest: () => ({ tagName: 'BUTTON' }) }
  ]) { h.setHit(node); assert.equal(h.c.voiceCursorPoint(), null); }
  h.setHit({ page: 1, tagName: 'path', closest: () => null });
  h.record(25, 260); assert.equal(h.c.voiceCursorPoint(), null, 'clipped by viewer');
  h.record(450, 260); assert.equal(h.c.voiceCursorPoint(), null, 'beyond page edge');
  h.record(); h.rects[0].width = 0; assert.equal(h.c.voiceCursorPoint(), null, 'hidden or detached SVG');
});

test('pointer tracking observes capture phase without stealing focus and clears on touch, exit, blur or hidden tab', () => {
  const h = harness();
  assert.equal(h.documentEvents.get('pointermove').capture, true);
  assert.equal(h.documentEvents.get('pointerdown').capture, true);
  h.record(); h.record(200, 200, { isPrimary: false });
  assert.deepEqual(plain(h.c.voiceCursorPoint()), { page: 1, x: 300, y: 400 });
  h.record(200, 200, { pointerType: 'touch' }); assert.equal(h.c.voiceCursorPoint(), null);
  h.record(); h.documentEvents.get('pointerout').listener({ relatedTarget: {} }); assert.ok(h.c.voiceCursorPoint());
  h.documentEvents.get('pointerout').listener({ relatedTarget: null }); assert.equal(h.c.voiceCursorPoint(), null);
  h.record(); h.windowEvents.get('blur')(); assert.equal(h.c.voiceCursorPoint(), null);
  h.record(); h.c.document.hidden = true; h.documentEvents.get('visibilitychange').listener();
  h.c.document.hidden = false; assert.equal(h.c.voiceCursorPoint(), null);
  h.record(250, 260, { pointerType: 'pen' }); assert.ok(h.c.voiceCursorPoint());
  h.record(NaN, 260); assert.equal(h.c.voiceCursorPoint(), null);
});

test('a pointer from another worksheet, account or rebuild cannot become the next command target', () => {
  for (const change of [c => { c.currentDocId = 'other'; }, c => { c.currentUser = { uid: 'other' }; }, c => { c.wsEpoch++; }]) {
    const h = harness(); h.record(); change(h.c);
    assert.equal(h.c.voiceCursorPoint(), null);
    assert.equal(h.capture().cursor, null);
  }
});

test('small blue triangle is anchored exactly at the captured cursor even when the mouse moves during planning', async () => {
  const h = harness(); h.record(); const captured = h.capture();
  h.setPlan(() => {
    h.record(350, 360);
    return JSON.stringify({ objects: [{ type: 'triangle', x: 20, y: 30, w: 48, h: 48, color: '#0000FF' }] });
  });
  assert.equal(await h.add(captured), 'Added 1 object.');
  const added = h.c.annotations[0];
  assert.equal(added.page, 1); assert.equal(added.color, '#0000FF');
  assert.equal(added.type, 'pen'); assert.equal(added.title, 'Triangle');
  assert.deepEqual(plain(added.points), [{ x: 300, y: 376 }, { x: 324, y: 424 }, { x: 276, y: 424 }, { x: 300, y: 376 }]);
  assert.equal(h.c.undoStack.length, 1); assert.equal(h.calls.dirty, 1);
  assert.match(h.calls.plans[0].prompt, /"cursor":\{"page":1,"x":300,"y":400\}/);
  h.c.undo(); assert.equal(h.c.annotations.length, 0);
  h.c.redo(); assert.deepEqual(plain(h.c.annotations[0].points), plain(added.points));
});

test('cursor placement keeps a group together and starts single text at the requested point', () => {
  const h = harness(); h.record(); const context = h.capture();
  const group = [
    h.c.voiceActionNewObject({ type: 'rect', x: 0, y: 0, w: 40, h: 40 }, context),
    h.c.voiceActionNewObject({ type: 'ellipse', x: 60, y: 20, w: 20, h: 20 }, context)
  ];
  h.c.voiceActionPlaceAtCursor(group, context);
  assert.deepEqual(group.map(a => [a.x, a.y]), [[260, 380], [320, 400]]);
  const text = [h.c.voiceActionNewObject({ type: 'text', x: 10, y: 10, w: 80, h: 30, text: 'Answer' }, context)];
  h.c.voiceActionPlaceAtCursor(text, context);
  assert.equal(text[0].x, 300); assert.equal(text[0].y, 400);
});

test('missing cursor and shapes crossing a page edge leave no partial objects or undo entries', async () => {
  const h = harness();
  assert.match(await h.add(), /Move your cursor/);
  assert.equal(h.calls.plans.length, 0);
  h.record(105, 65);
  assert.match(await h.add(), /could not make/);
  assert.equal(h.c.annotations.length, 0); assert.equal(h.c.undoStack.length, 0); assert.equal(h.calls.dirty, 0);
});

test('viewport page turns and page replacement invalidate a captured command without retargeting it', async () => {
  for (const change of [h => { h.c.pageNum = 1; }, h => { h.c.pages[0] = { ...h.c.pages[0] }; }]) {
    const h = harness(); h.record();
    h.setPlan(() => { change(h); return JSON.stringify({ objects: [{ type: 'triangle', x: 20, y: 30, w: 48, h: 48 }] }); });
    assert.match(await h.add(), /changed/);
    assert.equal(h.c.annotations.length, 0); assert.equal(h.c.undoStack.length, 0);
  }
});

test('answering part a reads the captured page and writes only its grounded answer at the captured cursor', async () => {
  const h = harness(); h.record(); h.request.command = 'Answer question a.';
  const captured = h.capture();
  h.setAnswer(() => { h.record(350, 360); return JSON.stringify({ answer: 'a) 6 × 7 = 42.' }); });
  assert.match(await h.write(captured), /Wrote the answer at your pointer/);
  assert.equal(h.calls.images[0].page, 1);
  assert.match(h.calls.plans[0].prompt, /Current page: 1/);
  assert.match(h.calls.plans[0].options.system, /ONLY the question or subpart explicitly requested/);
  const added = h.c.annotations[0];
  assert.equal(added.type, 'text'); assert.equal(added.page, 1);
  assert.equal(added.x, 300); assert.equal(added.y, 400); assert.equal(added.text, 'a) 6 × 7 = 42.');
  assert.equal(h.c.undoStack.length, 1); assert.equal(h.calls.dirty, 1);
  assert.equal(h.calls.probes[0].removed, true);
  assert.equal(h.calls.style[0][1], 'Answer question a.');
  h.c.undo(); assert.equal(h.c.annotations.length, 0);
});

test('unclear, unreadable and stale questions never create an answer annotation', async () => {
  const unclear = harness(); unclear.record(); unclear.setAnswer({ clarification: 'Which part (a) do you mean?' });
  assert.equal(await unclear.write(), 'Which part (a) do you mean?');
  assert.equal(unclear.c.annotations.length, 0); assert.equal(unclear.c.undoStack.length, 0);
  const unreadable = harness(); unreadable.record(); unreadable.setShot(null);
  assert.match(await unreadable.write(), /could not read/); assert.equal(unreadable.calls.plans.length, 0);
  const stale = harness(); stale.record();
  stale.setAnswer(() => { stale.c.wsEpoch++; return JSON.stringify({ answer: '42' }); });
  assert.match(await stale.write(), /changed/); assert.equal(stale.c.annotations.length, 0); assert.equal(stale.c.undoStack.length, 0);
});

test('answers that cannot fit at the exact cursor do not shift elsewhere or clip', async () => {
  const narrow = harness(); narrow.record(390, 260);
  assert.match(await narrow.write(), /not enough room/); assert.equal(narrow.calls.plans.length, 0);
  const tall = harness(); tall.record(250, 440);
  const createProbe = tall.c.document.createElement;
  tall.c.document.createElement = tag => { const probe = createProbe(tag); probe.scrollHeight = 500; return probe; };
  assert.match(await tall.write(), /will not fit/);
  assert.equal(tall.c.annotations.length, 0); assert.equal(tall.c.undoStack.length, 0); assert.equal(tall.calls.probes[0].removed, true);
});

test('written and spoken answers receive frozen shared question focus and visual images', async () => {
  const h = harness(); h.record();
  const focus = { page: 2, x: 20, y: 30, w: 200, h: 100 };
  const frozen = { focus, questionPage: 2, screen: 'frozen-screen', annotations: [] };
  h.c.answerKeyPageContext = p => '\nKey for page ' + p.num;
  h.c.aiViewSnapshot = options => { assert.equal(options.cursor.page, 1); return frozen; };
  h.c.aiViewImages = async view => {
    assert.equal(view, frozen);
    return { images: [{ mimeType: 'image/jpeg', data: 'focused-question', label: 'AI focus page 2' },
      { mimeType: 'image/jpeg', data: 'frozen-screen', label: 'Actual view' }], prompt: 'Explicit question focus on page 2.' };
  };
  const captured = h.capture();
  assert.match(await h.write(captured), /Wrote the answer at your pointer/);
  assert.equal(h.calls.images.length, 0, 'does not also re-capture the legacy full page');
  assert.deepEqual(h.calls.plans[0].options.images.map(im => im.data), ['focused-question', 'frozen-screen']);
  assert.match(h.calls.plans[0].prompt, /Explicit question focus on page 2/);
  assert.match(h.calls.plans[0].prompt, /Image 1: AI focus page 2/);
  assert.match(h.calls.plans[0].prompt, /Key for page 2/); assert.doesNotMatch(h.calls.plans[0].prompt, /Key for page 1/);
  assert.equal(h.c.annotations[0].page, 1, 'question focus does not move the answer destination');
  assert.equal(h.c.annotations[0].x, 300);
  h.setAnswer(() => 'Question 2a: 42.');
  const spoken = await h.c.voiceDelegate(h.v)(h.request, h.capture());
  assert.equal(spoken, 'Question 2a: 42.');
  assert.match(h.calls.plans.at(-1).prompt, /Resolve references/);
});

test('changing the question focus cancels an in-flight voice answer before insertion', async () => {
  const h = harness(); h.record(); let focus = { page: 1, x: 10, y: 20, w: 100, h: 100 };
  h.c.aiQuestionFocusCurrent = () => focus;
  const context = h.capture();
  h.setAnswer(() => { focus = { ...focus, y: 200 }; return JSON.stringify({ answer: '42' }); });
  assert.match(await h.write(context), /changed/);
  assert.equal(h.c.annotations.length, 0); assert.equal(h.c.undoStack.length, 0);
});

test('Jev can distinguish model bars by their visible pastel fill and quantity label', () => {
  const h = harness(); h.record();
  h.c.annotations = [{ id: 'bar', type: 'rect', modelBar: true, page: 1, x: 50, y: 50, w: 200, h: 40,
    color: '#526B84', fill: '#CBE8D5', modelLabel: '12 marbles' }];
  const object = h.capture().wire.objects[0];
  assert.equal(object.text, '12 marbles'); assert.equal(object.color, '#CBE8D5'); assert.equal(object.title, 'Maths model bar');
  h.c.selectedId = 'bar';
  const context = h.capture(), bar = h.c.annotations[0];
  const recolour = h.c.voiceLocalCommand('Jev, make this bar blue', context);
  h.c.voiceFormatObject(bar, recolour.plan, context);
  assert.equal(bar.fill, '#C8DDF2'); assert.equal(bar.color, '#526B84');
  const relabel = h.c.voiceLocalCommand('Jev, label this bar as 24 marbles', context);
  h.c.voiceFormatObject(bar, relabel.plan, context);
  assert.equal(bar.modelLabel, '24 marbles'); assert.equal(bar.text, undefined);
  assert.throws(() => h.c.voiceFormatObject(bar, { text: 'x'.repeat(81) }, context), /at most 80/);
});
