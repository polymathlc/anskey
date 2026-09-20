/* Actual pointer and navigation handlers, with a deterministic DOM/frame
   scheduler. No synthetic benchmark claims to measure physical Pencil lag. */
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function cut(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert(a >= 0 && b > a, `Missing shipped section: ${start}`);
  return html.slice(a, b);
}
const actual = cut('/* Palm rejection / iPad state */', '/* ---- Laser pointer:') +
  cut('function eventPoint(e, p, rect)', 'function setTool(t)') +
  cut('function attachOverlayHandlers(p)', '/* Put an annotation into edit mode:') +
  cut('function enterEditMode(id, p)', 'function cancelTempRedraw(stroke)') +
  cut('function cancelTempRedraw(stroke)', '/* ================= Lasso multi-select') +
  cut('/* ================= Touch navigation & gestures', '/* Keyboard shortcuts */');

function harness() {
  const c = vm.createContext({ console, Set, Map, performance: { now: () => c.now } });
  vm.runInContext(`
var now = 0, nextId = 0, frames = new Map(), timers = new Map(), pathWrites = 0, rectReads = 0, renders = 0, undoCount = 0;
var rectW = 300, rectH = 400;   // the page's RENDERED size — a test changes it to simulate zoom
function requestAnimationFrame(fn) { var id = ++nextId; frames.set(id, fn); return id; }
function cancelAnimationFrame(id) { frames.delete(id); }
function setTimeout(fn) { var id = ++nextId; timers.set(id, fn); return id; }
function clearTimeout(id) { timers.delete(id); }
function frame() { var pending = Array.from(frames.values()); frames.clear(); pending.forEach(function(fn) { fn(now); }); }
class Node {
  constructor(tag) { this.tag = tag; this.listeners = {}; this.children = []; this.attrs = {}; this.style = {}; this.scrollLeft = 0; this.scrollTop = 0; this.classList = { toggle: function(){} }; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  emit(type, event) { (this.listeners[type] || []).forEach(function(fn) { fn(event); }); }
  appendChild(n) { this.children.push(n); n.parentNode = this; return n; }
  removeChild(n) { if (n.parentNode !== this) throw new Error('NotFoundError'); this.children = this.children.filter(x => x !== n); n.parentNode = null; }
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'd') pathWrites++; }
  getAttribute(k) { return this.attrs[k] || null; }
  removeAttribute(k) { delete this.attrs[k]; }
  querySelector(q) {
    if (q === 'path') return this.children.find(x => x.tag === 'path');
    const m = /^\[data-id="(.+)"\]$/.exec(q);
    if (m) return this.children.find(x => x.attrs['data-id'] === m[1]) || null;
    return null;
  }
  closest(q) { if (q === 'svg.overlay') return this.tag === 'svg' ? this : p.svg; if ((q === '[data-id]' || q === 'g[data-id]') && this.attrs['data-id']) return this; return null; }
  getBoundingClientRect() { rectReads++; return { left: 10, top: 20, width: rectW, height: rectH }; }
  setPointerCapture(id) { this.capture = id; }
  hasPointerCapture(id) { return this.capture === id; }
  releasePointerCapture(id) { if (this.capture === id) this.capture = null; }
}
var document = new Node('document'), window = new Node('window'), viewerArea = new Node('viewer');
var localStorage = { getItem: function() { return null; } };
var drawing = null, draggingSel = null, resizingSel = null, lassoing = null, lassoMoving = null, lassoResizing = null, lassoRotating = null, lasering = null;
var editingId = null, editModeId = null, selectedId = null, kwGuessActive = null, reviseMode = false, practiceMode = false, lassoSel = null;
var annotations = [], undoStack = [], redoStack = [], tool = 'pen', color = '#000', strokeW = 2, scale = 1, showTimestamps = false, SNAP_JITTER_PX = 8;
var p = { num: 1, baseW: 600, baseH: 800, svg: new Node('svg'), wrap: new Node('wrap') }, pages = [p];
function isStudent() { return false; } function isSharedVisitor() { return false; }
function round2(n) { return Math.round(n * 100) / 100; }
function newAnnId() { return 'a' + (++nextId); }
function annNode(a) { var g = new Node('g'); g.setAttribute('data-id', a.id); var path = new Node('path'); path.setAttribute('d', pathFromPoints(a.points || [])); g.appendChild(path); return g; }
function pathFromPoints(pts) { return pts.map((p, i) => (i ? 'L ' : 'M ') + p.x + ' ' + p.y).join(' '); }
function renderOverlay(pg) { renders++; pg.svg.children.slice().forEach(n => pg.svg.removeChild(n)); }
function renderAllOverlays() { pages.forEach(renderOverlay); }
function renderAfterTextCommit(pg) { renderOverlay(pg); }
function pushUndo() { undoCount++; } function snapshot() { return JSON.stringify(annotations); }
function setDirty() {} function refreshTsLabels() {} function toast() {}
function armSnapHold(e) { drawing.holdCX = e.clientX; drawing.holdCY = e.clientY; drawing.holdTimer = setTimeout(function(){}); }
function scheduleRaster() {} function applyScale() {} function undo() { undoCount++; } function redo() { undoCount++; }
function setStylusOnly(v) { stylusOnly = v; }
var toolChanges = [], lastTap = { id: null, t: 0 };
function setTool(t) { tool = t; toolChanges.push(t); }
function handleAiNoteAction() {} function openAiNoteModal() {} function mmEditAttached() {}
function translateAnn(a, dx, dy) { (a.points || []).forEach(function (q) { q.x += dx; q.y += dy; }); }
function focusTextAnn() {} function clearLassoSel() {} function showLassoBar() {}
function startLassoMove() {} function startLassoResize() {} function startLassoRotate() {}
function lassoGroupBBox() { return null; }
` + actual + `
attachOverlayHandlers(p);
function pointer(type, options) {
  var e = Object.assign({ type: type, pointerId: 1, pointerType: 'pen', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: 20, clientY: 30, width: 2, height: 2, timeStamp: now, target: p.svg, preventDefault: function() { this.prevented = true; } }, options || {});
  document.emit(type, e); viewerArea.emit(type, e); p.svg.emit(type, e); return e;
}
function raw(type, count, options) {
  var touches = Array.from({ length: count }, (_, i) => ({ identifier: i + 1, clientX: 20 + i * 10, clientY: 30, radiusX: 8, radiusY: 8 }));
  var e = Object.assign({ type: type, timeStamp: now, touches: touches, changedTouches: touches, preventDefault: function() { this.prevented = true; } }, options || {});
  viewerArea.emit(type, e); return e;
}
`, c);
  return { c, run: source => vm.runInContext(source, c) };
}

test('pen-first small touches cannot pan or steal a resize handle', () => {
  const { c, run } = harness();
  run(`pointer('pointerdown'); selectedId = 'existing'; var handle = new Node('handle'); handle.attrs['data-handle'] = 'se'; pointer('pointerdown', { pointerId: 2, pointerType: 'touch', target: handle }); pointer('pointermove', { pointerId: 2, pointerType: 'touch', clientY: 120 });`);
  assert.equal(c.activePointerId, 1);
  assert.equal(c.resizingSel, null);
  assert.equal(c.nav.mode, null);
  assert.equal(c.viewerArea.scrollTop, 0);
  assert.equal(c.p.svg.capture, 1);
});

test('pen stops a pre-existing pan and rejects its contact until lift', () => {
  const { c, run } = harness();
  run(`pointer('pointerdown', { pointerId: 2, pointerType: 'touch' }); pointer('pointermove', { pointerId: 2, pointerType: 'touch', clientY: 80 }); var beforePen = viewerArea.scrollTop; pointer('pointerdown'); pointer('pointerup'); now = 1000; pointer('pointermove', { pointerId: 2, pointerType: 'touch', clientY: 140 });`);
  assert.equal(c.viewerArea.scrollTop, c.beforePen);
  assert.equal(c.nav.mode, null);
  assert(c.rejectedTouchIds.has(2));
  run(`pointer('pointerup', { pointerId: 2, pointerType: 'touch' }); pointer('pointerdown', { pointerId: 2, pointerType: 'touch' });`);
  assert.equal(c.nav.mode, 'pan');
});

test('palm touchmove on the viewer margin cannot native-scroll during or after pen contact', () => {
  const { c, run } = harness();
  run(`pointer('pointerdown'); var duringPen = raw('touchmove', 1); pointer('pointerdown', { pointerId: 2, pointerType: 'touch' }); pointer('pointerup'); now = 1000; var heldPalm = raw('touchmove', 1); pointer('pointerup', { pointerId: 2, pointerType: 'touch' }); var afterLift = raw('touchmove', 1);`);
  assert.equal(c.duringPen.prevented, true);
  assert.equal(c.heldPalm.prevented, true);
  assert.equal(c.afterLift.prevented, undefined);
});

test('growing palm is removed without momentum and cannot re-enter while held', () => {
  const { c, run } = harness();
  run(`pointer('pointerdown', { pointerId: 2, pointerType: 'touch' }); pointer('pointermove', { pointerId: 2, pointerType: 'touch', clientY: 80 }); var beforePalm = viewerArea.scrollTop; pointer('pointermove', { pointerId: 2, pointerType: 'touch', width: 75, clientY: 140 }); pointer('pointermove', { pointerId: 2, pointerType: 'touch', width: 20, clientY: 190 });`);
  assert.equal(c.viewerArea.scrollTop, c.beforePalm);
  assert.equal(c.navMomentum, null);
  assert.equal(c.nav.mode, null);
  assert(c.rejectedTouchIds.has(2));
  run(`pointer('pointercancel', { pointerId: 2, pointerType: 'touch' });`);
  assert.equal(c.rejectedTouchIds.size, 0);
});

test('lost finger capture stops navigation without starting a flick', () => {
  const { c, run } = harness();
  run(`pointer('pointerdown', { pointerId: 2, pointerType: 'touch' }); pointer('pointermove', { pointerId: 2, pointerType: 'touch', clientY: 80 }); pointer('lostpointercapture', { pointerId: 2, pointerType: 'touch' }); var stoppedAt = viewerArea.scrollTop; frame();`);
  assert.equal(c.nav.mode, null);
  assert.equal(c.navMomentum, null);
  assert.equal(c.viewerArea.scrollTop, c.stoppedAt);
});

test('pen immediately takes over an accidental touch stroke when finger drawing was enabled', () => {
  const { c, run } = harness();
  run(`stylusOnly = false; pointer('pointerdown', { pointerId: 2, pointerType: 'touch' }); pointer('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 30 }); now = 100; pointer('pointerdown');`);
  assert.equal(c.activePointerType, 'pen');
  assert.equal(c.activePointerId, 1);
  assert.equal(c.annotations.length, 0);
  assert.equal(c.p.svg.children.length, 1);
  assert.equal(c.frames.size, 0);
});

test('coalesced samples keep small details with one layout read and one paint per frame', () => {
  const { c, run } = harness();
  run(`pointer('pointerdown'); var initialWrites = pathWrites; rectReads = 0; pointer('pointermove', { clientX: 24, getCoalescedEvents: function() { return [{ clientX: 20.2, clientY: 30 }, { clientX: 20.4, clientY: 30 }, { clientX: 22, clientY: 30 }]; } }); pointer('pointermove', { clientX: 26 });`);
  assert.equal(c.rectReads, 2);
  assert.equal(c.pathWrites, c.initialWrites);
  assert.equal(c.frames.size, 1);
  assert.equal(c.drawing.ann.points.length, 6);
  run('frame();');
  assert.equal(c.pathWrites, c.initialWrites + 1);
  assert.equal(c.renders, 0);
});

test('quick pointerup flushes the last position once and leaves no queued paint', () => {
  const { c, run } = harness();
  run(`pointer('pointerdown'); pointer('pointermove', { clientX: 24 }); pointer('pointerup', { clientX: 29 }); var writesAtUp = pathWrites; frame();`);
  assert.equal(c.annotations.length, 1);
  assert.equal(c.annotations[0].points.at(-1).x, 38);
  assert.equal(c.frames.size, 0);
  assert.equal(c.pathWrites, c.writesAtUp);
  assert.equal(c.undoCount, 1);
  assert.equal(c.activePointerId, null);
});

test('lost capture keeps sampled ink without adding invalid cancellation coordinates', () => {
  const { c, run } = harness();
  run(`pointer('pointerdown'); pointer('pointermove', { clientX: 24 }); pointer('lostpointercapture', { clientX: 0, clientY: 0 }); pointer('pointercancel', { clientX: 0, clientY: 0 }); frame();`);
  assert.equal(c.annotations.length, 1);
  assert.equal(c.annotations[0].points.at(-1).x, 28);
  assert.equal(c.undoCount, 1);
  assert.equal(c.drawing, null);
  assert.equal(c.navPenPointerId, null);
});

test('detached preview is recreated after an asynchronous overlay refresh', () => {
  const { c, run } = harness();
  run(`pointer('pointerdown'); pointer('pointermove', { clientX: 24 }); renderOverlay(p); frame(); pointer('pointerup', { clientX: 29 });`);
  assert.equal(c.p.svg.children.length, 1);
  assert.equal(c.annotations.length, 1);
  assert.match(c.p.svg.children[0].querySelector('path').attrs.d, /38 20/);
});

test('palm contacts cannot trigger multi-touch undo during or immediately after writing', () => {
  const { c, run } = harness();
  run(`undoStack = ['existing']; pointer('pointerdown'); raw('touchstart', 2); now = 100; raw('touchend', 0); now = 150; raw('touchstart', 2); now = 200; raw('touchend', 0); pointer('pointerup'); raw('touchstart', 2); now = 250; raw('touchend', 0);`);
  assert.equal(c.undoCount, 1); // only committing the pen stroke
  run(`now = 1000; raw('touchstart', 2); now = 1100; raw('touchend', 0); now = 1200; raw('touchstart', 2); now = 1300; raw('touchend', 0);`);
  assert.equal(c.undoCount, 2); // intentional two-finger double-tap still works
});

test('blur preserves ink, clears pending input and allows later gestures', () => {
  const { c, run } = harness();
  run(`pointer('pointerdown'); pointer('pointermove', { clientX: 24 }); window.emit('blur', {}); frame(); now = 1000; pointer('pointerdown', { pointerType: 'touch', pointerId: 2 });`);
  assert.equal(c.annotations.length, 1);
  assert.equal(c.drawing, null);
  assert.equal(c.navPenPointerId, null);
  assert.equal(c.frames.size, 0);
  assert.equal(c.nav.mode, 'pan');
});

/* ---- A tablet pen must not have the tool taken out of its hand ----
   Writing is short, rapid marks landing on top of ink that is already there,
   and a pen puts them down at very nearly the same spot — which is what the
   browser calls a double-click. Every one of these failures is silent: the
   page still draws, the tool button still looks like the pen, and the next
   stroke picks the ink up and moves it instead. */

function inked() {
  const { c, run } = harness();
  run(`annotations.push({ id: 'ink1', page: 1, type: 'pen', color: '#000', width: 2, points: [{x:10,y:10},{x:50,y:50}] });
       var inkNode = new Node('g'); inkNode.setAttribute('data-id', 'ink1');
       p.svg.appendChild(inkNode);
       function dbl(t) { p.svg.emit('dblclick', { type: 'dblclick', target: t, preventDefault: function(){} }); }`);
  return { c, run };
}

test('a stray double-tap while writing never switches the tool or opens edit mode', () => {
  const { c, run } = inked();
  run(`tool = 'pen'; dbl(inkNode);`);
  assert.equal(c.tool, 'pen');
  assert.equal(c.toolChanges.length, 0);
  assert.equal(c.editModeId, null);
  for (const t of ['highlight', 'line', 'arrow', 'rect', 'ellipse', 'brace', 'eraser', 'lasso', 'text']) {
    run(`tool = '${t}'; editModeId = null; toolChanges = []; dbl(inkNode);`);
    assert.equal(c.tool, t, `${t} lost the tool to a double-tap`);
    assert.equal(c.editModeId, null, `${t} opened edit mode from a double-tap`);
  }
});

test('the select tool still opens edit mode on a double-click', () => {
  const { c, run } = inked();
  run(`tool = 'select'; dbl(inkNode);`);
  assert.equal(c.editModeId, 'ink1');
  assert.equal(c.tool, 'select');
});

test('enterEditMode never takes a drawing tool away, even when reached directly', () => {
  const { c, run } = inked();
  run(`tool = 'pen'; enterEditMode('ink1', p);`);
  assert.equal(c.toolChanges.length, 0, 'a drawing tool was silently switched to select');
  assert.equal(c.tool, 'pen');
  // …and it still hands over the handles, which are grabbed before any tool
  // is consulted, so nothing is lost by leaving the pen in hand.
  assert.equal(c.editModeId, 'ink1');
});

test('a pen tremor selects without nudging the ink, and a real drag still moves it', () => {
  const { c, run } = inked();
  // A tap with the 2px wobble every stylus puts down: it must SELECT and
  // leave the writing exactly where it was.
  run(`tool = 'select';
       pointer('pointerdown', { target: inkNode, clientX: 100, clientY: 100 });
       var armed = !!draggingSel;
       pointer('pointermove', { target: inkNode, clientX: 102, clientY: 101 });
       var tremor = draggingSel.moved;
       pointer('pointerup', { target: inkNode, clientX: 102, clientY: 101 });
       var at = annotations[0].points[0];
       var restX = at.x, restY = at.y, undosAfterTap = undoCount;`);
  assert.equal(c.armed, true, 'the tap did not select');
  assert.equal(c.selectedId, 'ink1');
  assert.equal(c.tremor, false, 'a 2px pen tremor counted as a drag');
  assert.equal(c.restX, 10, 'the ink moved under a pen that only tapped it');
  assert.equal(c.restY, 10, 'the ink moved under a pen that only tapped it');
  assert.equal(c.undosAfterTap, 0, 'a tap cost an undo step that undoes nothing');
  // A deliberate drag still works, and is still one undo step. (The tap
  // above armed the double-tap detector; clear it, or this second press is
  // read as a double-tap and opens edit mode instead.)
  run(`lastTap = { id: null, t: 0 };
       pointer('pointerdown', { target: inkNode, clientX: 100, clientY: 100 });
       pointer('pointermove', { clientX: 160, clientY: 100 });
       var dragging = draggingSel.moved;
       pointer('pointerup', { clientX: 160, clientY: 100 });
       var movedX = annotations[0].points[0].x, undosAfterDrag = undoCount;`);
  assert.equal(c.dragging, true, 'a real drag was swallowed by the threshold');
  assert(c.movedX > 10, 'a real drag moved nothing');
  assert.equal(c.undosAfterDrag, 1, 'a drag is one undo step');
});

test('the threshold is screen pixels, so it means the same at every zoom', () => {
  /* The page is 600 units wide; how many SCREEN pixels that is depends on the
     zoom, so a threshold measured in page units is a different physical
     distance on every worksheet — a hair when zoomed in (so the tremor still
     moves the ink) and most of a centimetre when zoomed out (so a deliberate
     drag does nothing). Both directions are checked. */
  const { c, run } = inked();
  // Zoomed IN (600 units drawn across 2400px): a deliberate 10px drag moves it.
  run(`rectW = 2400; rectH = 3200; tool = 'select';
       pointer('pointerdown', { target: inkNode, clientX: 100, clientY: 100 });
       pointer('pointermove', { clientX: 110, clientY: 100 });
       var zoomedInDrag = draggingSel.moved;
       pointer('pointerup', { clientX: 110, clientY: 100 }); lastTap = { id: null, t: 0 };`);
  assert.equal(c.zoomedInDrag, true, 'zoomed in, a real 10px drag was swallowed');
  // Zoomed OUT (600 units drawn across 150px): the same 2px tremor is still a tap.
  run(`rectW = 150; rectH = 200;
       pointer('pointerdown', { target: inkNode, clientX: 100, clientY: 100 });
       pointer('pointermove', { clientX: 102, clientY: 101 });
       var zoomedOutTremor = draggingSel.moved;`);
  assert.equal(c.zoomedOutTremor, false, 'zoomed out, a 2px tremor moved the ink');
});

test('a barrel-button press mid-word cannot hijack the stroke in progress', () => {
  const { c, run } = harness();
  run(`tool = 'pen';
       pointer('pointerdown', { clientX: 60, clientY: 60 });
       var first = drawing && drawing.ann.id;
       // Same pointerId — the one-pointer-at-a-time guard cannot see this one.
       pointer('pointerdown', { clientX: 60, clientY: 60, button: 2, buttons: 3 });
       var after = drawing && drawing.ann.id;`);
  assert.equal(c.after, c.first, 'the barrel button started a second gesture over the stroke');
  assert.equal(c.activePointerId, 1);
});
