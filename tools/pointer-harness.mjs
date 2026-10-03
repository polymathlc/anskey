/* The shipped pointer handlers, cut straight out of index.html and run in a vm
   against a deterministic DOM, timer and frame scheduler. Shared by the
   hold-to-snap and Pen-select suites: it is the same cut-the-real-section
   approach as tools/writing-tests.mjs, with the two sections those suites are
   about swapped in for real instead of stubbed.

     build({ snap: true })  the real hold-to-snap section (+ ShapeSnap loaded)
     build({ pen: true })   the real lasso + Pen-select sections (+ ShapeSnap)
     build({ lib: false })  …but leave ShapeSnap out, as if the script failed

   It simulates event ORDER and the page's geometry. It cannot say how a real
   Pencil or a real browser behaves — tools/shape-snap-browser-check.mjs does. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

export const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
export const shapeSnapSource = fs.readFileSync(new URL('../shape-snap.js', import.meta.url), 'utf8');

export function cut(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert(a >= 0 && b > a, `Missing shipped section: ${start}`);
  return html.slice(a, b);
}

const LASSO_START = '/* ================= Lasso multi-select';
const SNAP_START = '/* ================= Hold-to-snap shape recognition';
const SNAP_END = '/* Resize an annotation by dragging one of its edit handles */';

export function build({ snap = false, pen = false, lib = true } = {}) {
  const realSnap = snap || pen;
  const parts = [
    cut('function annNoteMin(a) {', '/* Unrotated frame of an'),
    cut('/* Palm rejection / iPad state */', '/* ---- Laser pointer:'),
    cut('function eventPoint(e, p, rect)', 'function setTool(t)'),
    cut('function attachOverlayHandlers(p)', '/* Put an annotation into edit mode:'),
    cut('function enterEditMode(id, p)', 'function cancelTempRedraw(stroke)'),
    cut('function cancelTempRedraw(stroke)', LASSO_START),
    cut('/* ================= Touch navigation & gestures', '/* Keyboard shortcuts */')
  ];
  if (pen) {
    parts.push(cut(LASSO_START, SNAP_START));
    parts.push(cut('function rotPt(q, c, deg) {', 'function normDeg(d) {'));
    parts.push(cut('function annBBox(a) {', '/* Bake the annotations'));
  }
  if (realSnap) parts.push(cut(SNAP_START, SNAP_END));
  const actual = parts.join('\n');

  const c = vm.createContext({ console, Set, Map, Math, JSON, Date, performance: { now: () => c.now } });
  if (realSnap && lib) vm.runInContext(shapeSnapSource, c);
  const lassoStubs = pen ? '' : `
function clearLassoSel() {} function showLassoBar() {}
function startLassoMove() {} function startLassoResize() {} function startLassoRotate() {}
function lassoGroupBBox() { return null; }
function selectionGrab() { return false; } function penSelectDown() {} function penSelectMove() {} function penSelectUp() {} function penSelectEndDrag() {}
`;
  const snapStubs = realSnap ? '' : `
var SNAP_JITTER_PX = 8;
function armSnapHold(e) { drawing.holdCX = e.clientX; drawing.holdCY = e.clientY; drawing.holdTimer = setTimeout(function(){}); }
function snapAdjustPoints() { return null; }
`;
  vm.runInContext(`
var now = 0, nextId = 0, frames = new Map(), timers = new Map(), pathWrites = 0, rectReads = 0, renders = 0, undoCount = 0, toasts = [];
var rectW = 600, rectH = 800;   // the page's RENDERED size — a test changes it to simulate zoom
function requestAnimationFrame(fn) { var id = ++nextId; frames.set(id, fn); return id; }
function cancelAnimationFrame(id) { frames.delete(id); }
function setTimeout(fn, ms) { var id = ++nextId; timers.set(id, { fn: fn, ms: ms }); return id; }
function clearTimeout(id) { timers.delete(id); }
function frame() { var pending = Array.from(frames.values()); frames.clear(); pending.forEach(function(fn) { fn(now); }); }
/* Let the hold timer run out: every pending timer fires once. */
function holdElapsed() { var all = Array.from(timers.values()); timers.clear(); all.forEach(function(t) { t.fn(); }); }
class Node {
  constructor(tag) { this.tag = tag; this.listeners = {}; this.children = []; this.attrs = {}; this.style = {}; this.scrollLeft = 0; this.scrollTop = 0; this.classList = { toggle: function(){}, add: function(){}, remove: function(){} }; this.textContent = ''; this.offsetWidth = 120; this.offsetHeight = 30; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  emit(type, event) { (this.listeners[type] || []).forEach(function(fn) { fn(event); }); }
  appendChild(n) { this.children.push(n); n.parentNode = this; return n; }
  removeChild(n) { if (n.parentNode !== this) throw new Error('NotFoundError'); this.children = this.children.filter(x => x !== n); n.parentNode = null; }
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'd') pathWrites++; }
  getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; }
  removeAttribute(k) { delete this.attrs[k]; }
  querySelector(q) {
    if (q === 'path') return this.children.find(x => x.tag === 'path');
    const m = /^\\[data-id="(.+)"\\]$/.exec(q);
    if (m) return this.children.find(x => x.attrs['data-id'] === m[1]) || null;
    return null;
  }
  closest(q) { if (q === 'svg.overlay') return this.tag === 'svg' ? this : p.svg; if ((q === '[data-id]' || q === 'g[data-id]') && this.attrs['data-id']) return this; return null; }
  getBoundingClientRect() { rectReads++; return { left: 10, top: 20, width: rectW, height: rectH }; }
  setPointerCapture(id) { this.capture = id; }
  hasPointerCapture(id) { return this.capture === id; }
  releasePointerCapture(id) { if (this.capture === id) this.capture = null; }
}
var byId = {};
function $(id) { return byId[id] || (byId[id] = new Node('el:' + id)); }
function el(name, attrs) { var n = new Node(name); if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]); return n; }
var document = new Node('document'), window = new Node('window'), viewerArea = new Node('viewer');
var localStorage = { getItem: function() { return null; } };
var drawing = null, draggingSel = null, resizingSel = null, lassoing = null, lassoMoving = null, lassoResizing = null, lassoRotating = null, lasering = null;
var editingId = null, editModeId = null, selectedId = null, kwGuessActive = null, reviseMode = false, practiceMode = false, lassoSel = null, penPath = null;
var annotations = [], undoStack = [], redoStack = [], tool = 'pen', color = '#000', strokeW = 2, scale = 1, showTimestamps = false;
var lassoResizeMode = false, lassoRotateMode = false, lassoMoveHintShown = true;
var p = { num: 1, baseW: 600, baseH: 800, svg: new Node('svg'), wrap: new Node('wrap') }, pages = [p];
function isStudent() { return false; } function isSharedVisitor() { return false; }
function round2(n) { return Math.round(n * 100) / 100; }
function newAnnId() { return 'a' + (++nextId); }
function annNode(a) { var g = new Node('g'); g.setAttribute('data-id', a.id); var path = new Node('path'); path.setAttribute('d', pathFromPoints(a.points || [])); g.appendChild(path); return g; }
function pathFromPoints(pts) { return pts.map((q, i) => (i ? 'L ' : 'M ') + q.x + ' ' + q.y).join(' '); }
function renderOverlay(pg) {
  renders++;
  pg.svg.children.slice().forEach(n => pg.svg.removeChild(n));
  annotations.forEach(a => { if (a.page === pg.num) pg.svg.appendChild(annNode(a)); });
  if (typeof penSelectRender === 'function') penSelectRender(pg);
}
function renderAllOverlays() { pages.forEach(renderOverlay); }
function renderAfterTextCommit(pg) { renderOverlay(pg); }
function pushUndo() { undoCount++; } function snapshot() { return JSON.stringify(annotations); }
function setDirty() {} function refreshTsLabels() {} function toast(m) { toasts.push(m); }
function scheduleRaster() {} function applyScale() {} function undo() { undoCount++; } function redo() { undoCount++; }
function setStylusOnly(v) { stylusOnly = v; }
var toolChanges = [], lastTap = { id: null, t: 0 };
function setTool(t) { tool = t; toolChanges.push(t); }
function handleAiNoteAction() {} function openAiNoteModal() {} function mmEditAttached() {}
function translateAnn(a, dx, dy) { (a.points || []).forEach(function (q) { q.x += dx; q.y += dy; }); }
function focusTextAnn() {}
function renderLassoChrome() {}
function annFrameCorners() { return [{ x: 0, y: 0 }]; }
` + lassoStubs + snapStubs + actual + `
attachOverlayHandlers(p);
/* One synthetic pointer event, delivered the way the browser orders them:
   the document's capture handlers, the viewer's, then the page overlay's
   (pass { page: p2 } to deliver it to another page's overlay). */
function pointer(type, options) {
  var page = (options && options.page) || p;
  var e = Object.assign({ type: type, pointerId: 1, pointerType: 'pen', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: 20, clientY: 30, width: 2, height: 2, timeStamp: now, target: page.svg, shiftKey: false, altKey: false, preventDefault: function() { this.prevented = true; } }, options || {});
  document.emit(type, e); viewerArea.emit(type, e); page.svg.emit(type, e); return e;
}
/* Page units → client pixels at the current zoom, so a test can think in the
   page's own coordinates whatever rectW is. */
function at(x, y) { return { clientX: 10 + x * rectW / p.baseW, clientY: 20 + y * rectH / p.baseH }; }
function down(x, y, o) { return pointer('pointerdown', Object.assign(at(x, y), o || {})); }
function move(x, y, o) { return pointer('pointermove', Object.assign(at(x, y), o || {})); }
function up(x, y, o) { return pointer('pointerup', Object.assign(at(x, y), o || {})); }
function key(k, o) {
  var e = Object.assign({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault: function() { this.prevented = true; } }, o || {});
  return penSelectKey(e) ? e : null;
}
`, c);
  return { c, run: (source) => vm.runInContext(source, c) };
}
