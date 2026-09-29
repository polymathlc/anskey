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
  section('function translateAnn(a, dx, dy)', '/* The .annText padding') +
  section('function scaleAnnFrom(orig, a, f, o)', 'function startLassoResize(') +
  section('function annFrame(a)', 'function normWord(') +
  section('function annBounds(a)', '/* Draw annotations straight') +
  section('function lessonSnapshot()', 'function lessonCaptureTick()') +
  section('function snapshot()', '/* ================= PDF loading');
const plain = value => JSON.parse(JSON.stringify(value));
const rect = (id = 'box', more = {}) => ({ id, page: 1, type: 'rect', x: 20, y: 30, w: 80, h: 60, width: 2, color: '#111111', ...more });

function harness(list = [rect()]) {
  const calls = { requests: [], renders: 0, dirty: 0, scroll: 0 };
  const editor = { innerText: 'Current unblurred answer\n', scrollHeight: 50 };
  const area = { scrollTop: 0 };
  const controller = new AbortController();
  const v = { uid: 'teacher' };
  let plan = { dx: 15, dy: 10 }, current = true;
  const c = {
    document: { createElement: () => ({ style: {}, scrollHeight: 45, scrollWidth: 0, remove() {} }), body: { appendChild() {} } },
    annotations: plain(list), pages: [
      { num: 1, baseW: 600, baseH: 800, wrap: { offsetTop: 10 } },
      { num: 2, baseW: 600, baseH: 800, wrap: { offsetTop: 900 } }
    ],
    currentDocId: 'paper', currentUser: { uid: 'teacher' }, wsEpoch: 7, pageNum: 1,
    voiceLive: v, voiceContextOK: () => true, currentPageNum: () => c.pageNum,
    undoStack: [], redoStack: [], selectedId: 'box', editingId: null, editModeId: null, lassoSel: null,
    LESSON_TYPES: ['pen', 'highlight', 'text', 'rect', 'ellipse', 'line', 'arrow', 'brace'],
    drawing: null, erasing: null, draggingSel: null, resizingSel: null, lassoing: null,
    lassoMoving: null, lassoResizing: null, lassoRotating: null, activePointerId: null,
    lessonCapture: null, lessonPlayback: null, lessonOpening: null, reviseMode: false, textFocusTimer: null,
    round2: n => Math.round(n * 100) / 100, annLocked: a => !!a.locked, annNoteMin: () => false,
    rotPt: (p, center, angle) => {
      const r = angle * Math.PI / 180, dx = p.x - center.x, dy = p.y - center.y;
      return { x: center.x + dx * Math.cos(r) - dy * Math.sin(r), y: center.y + dx * Math.sin(r) + dy * Math.cos(r) };
    },
    annTextNode: () => editor, newAnnId: (() => { let n = 0; return () => `voice-${++n}`; })(),
    clearTimeout, clearLassoSel: () => { c.lassoSel = null; },
    renderAllOverlays: () => { calls.renders++; },
    setDirty: value => { if (value) { calls.dirty++; if (c.lessonCapture) c.lessonCapture.annotationsChanged = true; } },
    $: id => { assert.equal(id, 'viewerArea'); return area; },
    window: { askGemini: async (prompt, opts) => { calls.requests.push({ prompt, opts }); return typeof plan === 'function' ? plan() : JSON.stringify(plan); } }
  };
  vm.createContext(c); vm.runInContext(shipped, c);
  const request = { transcript: [{ role: 'user', text: 'Move the selected box right and down.' }], signal: controller.signal, isCurrent: () => current };
  const route = (intent, extra = {}) => ({ intent, targetId: ['move', 'resize', 'delete'].includes(intent) ? 'box' : null, confidence: 0.99, needsClarification: false, ...extra });
  return { c, v, editor, area, calls, request, controller, route, setPlan: value => { plan = value; },
    supersede: () => { current = false; }, run: (intent = 'move', extra = {}, context = c.voiceActionContext()) => c.voicePlanAndApply(v, request, route(intent, extra), context, controller.signal) };
}

test('move uses the exact Jev target, changes page units and creates one undo entry', async () => {
  const h = harness([rect(), rect('other', { x: 200 })]);
  const before = plain(h.c.annotations);
  assert.equal(await h.run(), 'Moved the object.');
  assert.equal(h.c.annotations[0].x, 35); assert.equal(h.c.annotations[0].y, 40);
  assert.deepEqual(plain(h.c.annotations[1]), before[1]);
  assert.equal(h.c.undoStack.length, 1); assert.equal(h.calls.dirty, 1); assert.equal(h.calls.renders, 1);
  h.c.undo(); assert.deepEqual(plain(h.c.annotations), before);
  h.c.redo(); assert.equal(h.c.annotations[0].x, 35);
});

test('current typed words are preserved when moving, undoing and redoing an active text box', async () => {
  const h = harness([rect('box', { type: 'text', text: 'Saved old answer', fontSize: 16, _ai: true })]);
  h.c.editingId = 'box';
  assert.match(await h.run(), /Moved/);
  assert.equal(h.c.annotations[0].text, 'Current unblurred answer');
  assert.equal(h.c.annotations[0]._ai, undefined); assert.equal(h.c.editingId, null);
  h.c.undo(); assert.equal(h.c.annotations[0].text, 'Current unblurred answer'); assert.equal(h.c.annotations[0].x, 20);
  h.c.redo(); assert.equal(h.c.annotations[0].text, 'Current unblurred answer'); assert.equal(h.c.annotations[0].x, 35);
});

test('added primitives use only validated fields and share one undo step', async () => {
  const h = harness([]); h.c.selectedId = null;
  h.setPlan({ objects: [
    { type: 'text', x: 40, y: 40, w: 140, h: 32, text: 'Answer: 42', fontSize: 16, color: '#006600' },
    { type: 'ellipse', x: 100, y: 120, w: 60, h: 60, width: 3 },
    { type: 'arrow', x1: 20, y1: 20, x2: 70, y2: 70 }
  ] });
  assert.equal(await h.run('add'), 'Added 3 objects.');
  assert.deepEqual(plain(h.c.annotations.map(a => a.type)), ['text', 'ellipse', 'arrow']);
  assert.equal(new Set(h.c.annotations.map(a => a.id)).size, 3);
  assert.equal(h.c.undoStack.length, 1); assert.equal(h.calls.dirty, 1);
  h.c.undo(); assert.equal(h.c.annotations.length, 0);
});

test('a small blue triangle keeps its geometry and color through save, replay, move, resize and undo', async () => {
  const h = harness([]); h.c.selectedId = null;
  h.request.command = 'Add a small blue triangle.';
  h.setPlan({ objects: [{ type: 'triangle', x: 120, y: 180, w: 48, h: 48, color: '#0000FF', width: 2 }] });
  assert.equal(await h.run('add'), 'Added 1 object.');
  const triangle = plain(h.c.annotations[0]);
  assert.equal(triangle.type, 'pen'); assert.equal(triangle.title, 'Triangle');
  assert.equal(triangle.color, '#0000FF'); assert.equal(triangle.width, 2);
  assert.equal(new Set(triangle.points.slice(0, -1).map(p => `${p.x},${p.y}`)).size, 3);
  assert.deepEqual(triangle.points[0], triangle.points.at(-1));
  assert.deepEqual(plain(h.c.annBounds(triangle)), { x: 120, y: 180, x2: 168, y2: 228 });
  assert.equal(triangle.x, undefined); assert.equal(triangle.w, undefined);
  assert.deepEqual(JSON.parse(h.c.snapshot()), [triangle]);
  assert.deepEqual(plain(h.c.lessonSnapshot()), [triangle]);
  assert.match(h.calls.requests[0].prompt, /triangle/);
  assert.match(h.calls.requests[0].prompt, /small shape is about 48 by 48/);
  h.c.undo(); assert.equal(h.c.annotations.length, 0);
  h.c.redo(); assert.deepEqual(plain(h.c.annotations), [triangle]);

  h.c.selectedId = triangle.id; h.setPlan({ dx: 15, dy: -10 });
  assert.equal(await h.run('move', { targetId: triangle.id }), 'Moved the object.');
  assert.deepEqual(plain(h.c.annBounds(h.c.annotations[0])), { x: 135, y: 170, x2: 183, y2: 218 });
  h.c.undo(); assert.deepEqual(plain(h.c.annotations), [triangle]);
  h.setPlan({ scale: 0.5 });
  assert.equal(await h.run('resize', { targetId: triangle.id }), 'Resized the object.');
  assert.deepEqual(plain(h.c.annBounds(h.c.annotations[0])), { x: 120, y: 180, x2: 144, y2: 204 });
  assert.equal(h.c.annotations[0].color, '#0000FF');
  h.c.undo(); assert.deepEqual(plain(h.c.annotations), [triangle]);
});

test('a malformed object anywhere in a batch leaves every annotation and history untouched', async () => {
  for (const bad of [
    { type: 'text', x: 10, y: 10, w: 80, h: 30, text: 'safe', html: '<script>bad()</script>' },
    { type: 'iframe', x: 10, y: 10, w: 80, h: 30 },
    { type: 'rect', x: 590, y: 10, w: 80, h: 30 },
    { type: 'rect', x: '10', y: 10, w: 80, h: 30 },
    { type: 'rect', x: 10, y: 10, w: 80, h: 30, color: 'url(https://example.invalid)' },
    { type: 'triangle', x: 580, y: 10, w: 48, h: 48 },
    { type: 'triangle', x: 10, y: 10, w: 48, h: 48, text: 'injected' },
    { type: 'triangle', x: 10, y: 10, w: 2, h: 48 },
    { type: 'triangle', x: 10, y: 10, w: 48, h: 48, points: [{ x: -100, y: -100 }] }
  ]) {
    const h = harness(), before = plain(h.c.annotations);
    h.setPlan({ objects: [{ type: 'rect', x: 100, y: 100, w: 50, h: 50 }, bad] });
    assert.match(await h.run('add'), /could not make/);
    assert.deepEqual(plain(h.c.annotations), before); assert.equal(h.c.undoStack.length, 0); assert.equal(h.calls.dirty, 0);
  }
});

test('out of page movement, arbitrary keys and target substitution cannot mutate', async () => {
  for (const plan of [{ dx: 9999, dy: 0 }, { dx: -30, dy: 0 }, { dx: 10, dy: 0, targetId: 'other' }, { dx: null, dy: 0 }]) {
    const h = harness(), before = plain(h.c.annotations); h.setPlan(plan);
    assert.match(await h.run(), /could not make/); assert.deepEqual(plain(h.c.annotations), before); assert.equal(h.calls.dirty, 0);
  }
});

test('unknown, other-page, unconfident, unresolved and locked targets are refused before planning', async () => {
  for (const extra of [{ targetId: 'missing' }, { targetId: 'other-page' }, { confidence: 0.59 }, { confidence: NaN }, { confidence: Infinity }, { needsClarification: true }]) {
    const h = harness([rect(), rect('other-page', { page: 2 })]);
    await h.run('move', extra); assert.equal(h.calls.requests.length, 0); assert.equal(h.calls.dirty, 0);
  }
  const h = harness([rect('box', { locked: true })]);
  assert.match(await h.run('delete'), /locked/); assert.equal(h.c.annotations.length, 1);
});

test('every stale or cancelled async plan is discarded without writes', async () => {
  for (const change of [
    h => { h.c.currentDocId = 'another'; }, h => { h.c.wsEpoch++; }, h => { h.c.currentUser = { uid: 'other' }; },
    h => { h.c.pageNum = 2; }, h => { h.c.annotations[0].x++; }, h => { h.c.selectedId = null; },
    h => h.controller.abort(), h => h.supersede(), h => { h.c.voiceLive = null; },
    h => { h.c.pages[0] = { ...h.c.pages[0] }; }
  ]) {
    const h = harness(); h.setPlan(() => { change(h); return JSON.stringify({ dx: 15, dy: 10 }); });
    assert.match(await h.run(), /changed/); assert.equal(h.calls.dirty, 0); assert.equal(h.c.undoStack.length, 0);
  }
});

test('unblurred typing changed while planning is never overwritten', async () => {
  const h = harness([rect('box', { type: 'text', text: 'Old', fontSize: 16 })]); h.c.editingId = 'box';
  h.setPlan(() => { h.editor.innerText = 'Newer typing'; return JSON.stringify({ dx: 10, dy: 0 }); });
  assert.match(await h.run(), /changed/); assert.equal(h.editor.innerText, 'Newer typing'); assert.equal(h.calls.dirty, 0);
});

test('resize preserves ink structure and image aspect ratio with bounded uniform scaling', async () => {
  const ink = { id: 'box', page: 1, type: 'pen', points: [{ x: 20, y: 30 }, { x: 50, y: 70 }], width: 2 };
  const h = harness([ink]); h.setPlan({ scale: 2 });
  assert.equal(await h.run('resize'), 'Resized the object.');
  assert.deepEqual(plain(h.c.annotations[0].points), [{ x: 20, y: 30 }, { x: 80, y: 110 }]);
  assert.equal(h.c.annotations[0].width, 4);
  const image = harness([rect('box', { type: 'ainote', kind: 'paste', w: 160, h: 80, ratio: 2, src: 'private-image' })]);
  image.setPlan({ scale: 0.5 }); await image.run('resize');
  assert.equal(image.c.annotations[0].w / image.c.annotations[0].h, 2);
  assert.doesNotMatch(image.calls.requests[0].prompt, /private-image/);
});

test('active gestures and replay cannot be changed by a voice command', async () => {
  for (const [key, value] of [['drawing', {}], ['activePointerId', 1], ['lessonPlayback', {}], ['reviseMode', true]]) {
    const h = harness(); h.c[key] = value;
    assert.match(await h.run(), /Finish/); assert.equal(h.calls.requests.length, 0); assert.equal(h.calls.dirty, 0);
  }
  const h = harness(); h.setPlan(() => { h.c.draggingSel = {}; return JSON.stringify({ dx: 10, dy: 0 }); });
  assert.match(await h.run(), /Finish/); assert.equal(h.calls.dirty, 0);
});

test('ordinary edits notify the lesson recorder while cards stay fixed during recording', async () => {
  const h = harness(); h.c.lessonCapture = { annotationsChanged: false };
  await h.run(); assert.equal(h.c.lessonCapture.annotationsChanged, true);
  const card = harness([rect('box', { type: 'ainote', kind: 'paste' })]); card.c.lessonCapture = {};
  assert.match(await card.run(), /Finish the lesson recording/); assert.equal(card.calls.dirty, 0);
  const started = harness([rect('box', { type: 'ainote', kind: 'paste' })]);
  started.setPlan(() => { started.c.lessonCapture = {}; return JSON.stringify({ dx: 10, dy: 0 }); });
  assert.match(await started.run(), /Finish the lesson recording/); assert.equal(started.calls.dirty, 0);
});

test('delete, undo and redo use real history and do not call the planner', async () => {
  const h = harness();
  assert.match(await h.run('delete'), /Deleted/); assert.equal(h.c.annotations.length, 0);
  assert.equal(await h.run('undo'), 'Undid the last edit.'); assert.equal(h.c.annotations.length, 1);
  assert.equal(await h.run('redo'), 'Redid the last edit.'); assert.equal(h.c.annotations.length, 0);
  assert.equal(h.calls.requests.length, 0); assert.equal(h.calls.dirty, 3);
});

test('navigation changes the page view without editing annotations or history', async () => {
  const h = harness(); h.setPlan({ page: 2 });
  assert.equal(await h.run('navigate'), 'Opened page 2.'); assert.equal(h.area.scrollTop, 880);
  assert.equal(h.calls.dirty, 0); assert.equal(h.c.undoStack.length, 0);
  h.setPlan({ page: 3 }); assert.match(await h.run('navigate'), /could not make/); assert.equal(h.area.scrollTop, 880);
});

test('inventory is bounded, includes selected objects first and reads the live editor', () => {
  const h = harness(Array.from({ length: 130 }, (_, i) => rect('r' + i, { title: 't'.repeat(500) })));
  h.c.annotations.push(rect('chosen', { type: 'text', text: 'Old', fontSize: 16 })); h.c.selectedId = h.c.editingId = 'chosen';
  const context = h.c.voiceActionContext();
  assert.equal(context.objects.length, 100); assert.equal(context.objects[0].id, 'chosen');
  assert.equal(context.objects[0].text, 'Current unblurred answer');
  assert.equal(context.objects[1].title.length, 240); assert.equal(context.wire.selectedId, 'chosen');
});

test('clarification or malformed JSON produces no edit or success claim', async () => {
  const h = harness(); h.setPlan({ clarification: 'How far should I move it?' });
  assert.equal(await h.run(), 'How far should I move it?'); assert.equal(h.calls.dirty, 0);
  h.setPlan(() => 'not json'); assert.match(await h.run(), /could not prepare/); assert.equal(h.calls.dirty, 0);
});

test('only the fresh command is sent to the planner, and an empty fresh command cannot repeat an edit', async () => {
  const h = harness();
  h.request.transcript = [{ role: 'user', text: 'Move the box right. Add a red circle.' }];
  h.request.command = 'Move the box down ten points.';
  await h.run();
  assert.match(h.calls.requests[0].prompt, /Move the box down ten points/);
  assert.doesNotMatch(h.calls.requests[0].prompt, /Add a red circle/);
  const empty = harness(); empty.request.command = '';
  assert.match(await empty.run(), /tell me the change/); assert.equal(empty.calls.requests.length, 0); assert.equal(empty.calls.dirty, 0);
});

test('precise move skips model planning and retains validation and undo', async () => {
  const h = harness(); h.request.command = 'Jev, move this right by 20 units.';
  assert.match(await h.run(), /Moved/);
  assert.equal(h.calls.requests.length, 0);
  assert.equal(h.c.annotations[0].x, 40);
  assert.equal(h.c.undoStack.length, 1);
  h.c.undo(); assert.equal(h.c.annotations[0].x, 20);
});

test('precise navigation and resize skip planning, but invalid bounds never commit', async () => {
  const h = harness(); h.request.command = 'Jev, next page';
  assert.equal(await h.run('navigate'), 'Opened page 2.');
  assert.equal(h.calls.requests.length, 0);
  h.request.command = 'resize this to 150 percent';
  await h.run('resize'); assert.equal(h.c.annotations[0].w, 120);
  assert.equal(h.calls.requests.length, 0);
  const before = plain(h.c.annotations);
  h.request.command = 'move this left by 9999';
  await h.run(); assert.deepEqual(plain(h.c.annotations), before);
});

test('questions, compound commands and vague directions never use the exact grammar', () => {
  const h = harness(), context = h.c.voiceActionContext();
  for (const command of ['What does move this right by 20 mean?', 'move this right by 20 and delete it',
    'move this a little to the right', '"move this right by 20"']) {
    assert.equal(h.c.voiceFastPlan(command, 'move', context), null);
  }
  assert.equal(h.c.voiceFastPlan('next page', 'answer', context), null);
});

async function localRun(h, command) {
  h.request.command = command;
  const context = h.c.voiceActionContext();
  const route = h.c.voiceLocalCommand(command, context);
  assert.ok(route, command);
  return h.c.voicePlanAndApply(h.v, h.request, route, context, h.controller.signal);
}

test('voice formats text with size, font, colour, emphasis and alignment in one undo step', async () => {
  const h = harness([rect('box', { type: 'text', text: 'Example text', fontSize: 16 })]);
  assert.match(await localRun(h, 'Jev, make this font size 24 and font Times New Roman and blue and bold and italic and underlined and centre aligned.'), /formatting/);
  const a = h.c.annotations[0];
  assert.equal(a.fontSize, 24); assert.equal(a.fontFamily, 'times new roman'); assert.equal(a.color, '#1E88E5');
  assert.equal(a.bold, true); assert.equal(a.italic, true); assert.equal(a.underline, true); assert.equal(a.align, 'center');
  assert.equal(h.calls.requests.length, 0); assert.equal(h.c.undoStack.length, 1);
  h.c.undo(); assert.equal(h.c.annotations[0].fontSize, 16);
  await localRun(h, 'Set font size to 32'); assert.equal(h.c.annotations[0].fontSize, 32);
});

test('bulk text formatting affects only current page and fails atomically on locked objects', async () => {
  const h = harness([rect('box', { type: 'text', text: 'A', fontSize: 16 }),
    rect('b', { type: 'text', text: 'B', fontSize: 16 }), rect('c', { type: 'text', page: 2, text: 'C', fontSize: 16 }), rect('shape')]);
  await localRun(h, 'Make all text on this page bold and font size 24');
  assert.equal(h.c.annotations[0].bold, true); assert.equal(h.c.annotations[1].fontSize, 24);
  assert.equal(h.c.annotations[2].fontSize, 16); assert.equal(h.c.annotations[3].bold, undefined);
  h.c.annotations[1].locked = true;
  const before = plain(h.c.annotations);
  assert.match(await localRun(h, 'Make all text red'), /locked/);
  assert.deepEqual(plain(h.c.annotations), before);
});

test('voice changes stroke styles, arrowheads, dimensions and rotation without a planner', async () => {
  const h = harness();
  await localRun(h, 'Make this dotted and line width 4 and red and width 100 and height 70 and rotation 90');
  const a = h.c.annotations[0];
  assert.equal(a.dash, 'dotted'); assert.equal(a.width, 4); assert.equal(a.w, 100); assert.equal(a.h, 70); assert.equal(a.rot, 90);
  const arrow = harness([{ id:'box', type:'arrow', page:1, x1:20,y1:20,x2:80,y2:80,width:2,color:'#111111' }]);
  await localRun(arrow, 'Make this arrowheads both and dashed');
  assert.equal(arrow.c.annotations[0].heads, 'both'); assert.equal(arrow.calls.requests.length, 0);
});

test('duplicate copies live text and styles with unique ids, normal history and bounded offsets', async () => {
  const h = harness([rect('box', { type:'text', text:'Hello', fontSize:16, bold:true })]);
  await localRun(h, 'Duplicate this 3 times');
  assert.equal(h.c.annotations.length, 4); assert.equal(new Set(h.c.annotations.map(a => a.id)).size, 4);
  assert.equal(h.c.annotations[3].x, 68); assert.equal(h.c.annotations[3].bold, true);
  assert.equal(h.c.undoStack.length, 1); assert.equal(h.calls.requests.length, 0);
  h.c.undo(); assert.equal(h.c.annotations.length, 1);
  const before = plain(h.c.annotations);
  await localRun(h, 'Duplicate this 99 times'); assert.deepEqual(plain(h.c.annotations), before);
});

test('layer ordering and literal text replacement are reversible and retain existing text until requested', async () => {
  const h = harness([rect('box', { type:'text', text:'Old answer', fontSize:16 }), rect('other')]);
  await localRun(h, 'Bring this to the front'); assert.equal(h.c.annotations[1].id, 'box');
  await localRun(h, 'Send this to the back'); assert.equal(h.c.annotations[0].id, 'box');
  await localRun(h, 'Change the text in this to "New answer"'); assert.equal(h.c.annotations[0].text, 'New answer');
  h.c.undo(); assert.equal(h.c.annotations[0].text, 'Old answer');
});

test('invalid or incompatible formatting never partially commits; unrelated commands never route locally', async () => {
  const h = harness(), before = plain(h.c.annotations);
  await localRun(h, 'Make this red and bold'); assert.deepEqual(plain(h.c.annotations), before);
  assert.equal(h.c.undoStack.length, 0);
  for (const command of ['Why would I duplicate this?', 'duplicate this and delete it', 'make this red and run code', 'make this evilfont']) {
    assert.equal(h.c.voiceLocalCommand(command, h.c.voiceActionContext()), null);
  }
  h.c.selectedId = null;
  assert.match(await localRun(h, 'Make this red'), /select/i);
});
