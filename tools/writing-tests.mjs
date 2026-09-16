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
  cut('function cancelTempRedraw(stroke)', '/* ================= Lasso multi-select') +
  cut('/* ================= Touch navigation & gestures', '/* Keyboard shortcuts */');

function harness() {
  const c = vm.createContext({ console, Set, Map, performance: { now: () => c.now } });
  vm.runInContext(`
var now = 0, nextId = 0, frames = new Map(), timers = new Map(), pathWrites = 0, rectReads = 0, renders = 0, undoCount = 0;
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
  querySelector(q) { return q === 'path' ? this.children.find(x => x.tag === 'path') : null; }
  closest(q) { if (q === 'svg.overlay') return this.tag === 'svg' ? this : p.svg; return null; }
  getBoundingClientRect() { rectReads++; return { left: 10, top: 20, width: 300, height: 400 }; }
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
