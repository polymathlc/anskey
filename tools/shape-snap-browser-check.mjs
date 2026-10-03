/* =====================================================================
   ✏️ HOLD-TO-SNAP SHAPES AND THE PEN SELECT TOOL — in a real browser
   ---------------------------------------------------------------------
   hold-snap-tests.mjs and pen-select-tests.mjs run the shipped handlers in a
   vm against a fake DOM, which is enough for the logic and not enough for the
   things only a browser can say: that real pointer events from a real mouse
   reach the overlay, that a real 550 ms timer snaps a real stroke, that the
   path preview is actually drawn on the SVG at a fixed SCREEN size, that the
   Tools menu button and the Shift+S shortcut really select the tool, and that
   what Pen select selects is what the lasso machinery then moves.

   Like the other *-check.mjs files it needs Chromium, so it is a tool you reach
   for (and a CI step), not part of `node --test`:

     node tools/shape-snap-browser-check.mjs
     PW=/path/to/playwright/index.mjs node tools/shape-snap-browser-check.mjs
     SNAP_SCREENSHOTS=/tmp/shots node tools/shape-snap-browser-check.mjs

   What it cannot say: how an Apple Pencil or a graphics tablet behaves — palm
   rejection and pen pressure are hardware.
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { rng, make } from './shape-snap-fixtures.mjs';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) {
  console.log('shape-snap-browser-check: no Playwright at ' + PW + ' — skipped.');
  console.log('  set PW=/path/to/playwright/index.mjs to run it.');
  process.exit(0);
}

const FILE = pathToFileURL(path.resolve(process.argv[2] || 'index.html')).href;
const SHOTS = process.env.SNAP_SCREENSHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (note ? '\n      ' + note : '')); }
};

const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {});
const ctx = await browser.newContext({ viewport: { width: 1100, height: 1180 } });
const page = await ctx.newPage();
/* pdf.js, the Firebase SDK and the fonts come off a CDN that a sandbox cannot
   reach. Fail those requests at once instead of waiting for them, and let a
   chain proxy stand in for the libraries — nothing under those names is
   exercised here. */
await page.route(/^https?:/, (route) => route.abort());
await page.addInitScript(() => {
  const chain = () => new Proxy(function () { return chain(); }, {
    get: (t, k) => (k === 'then' ? undefined : chain()),
    apply: () => chain(), construct: () => chain(), set: () => true
  });
  window.pdfjsLib = chain(); window.firebase = chain(); window.grecaptcha = chain();
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack || e.message));
await page.goto(FILE);
await page.waitForTimeout(800);
ok('the page loads with no uncaught error', errors.length === 0, errors.join('\n      '));
ok('shape-snap.js is loaded beside the application', await page.evaluate(() => typeof ShapeSnap === 'object' && typeof ShapeSnap.recognize === 'function'));
ok('the hold timing is the shared module’s own', await page.evaluate(() => SNAP_HOLD_MS === ShapeSnap.T.HOLD_MS && SNAP_JITTER_PX === ShapeSnap.T.HOLD_JITTER_PX));

/* One page, built the way loadPdf builds one — the real overlay and the real
   handlers, with no PDF behind it (the pattern tools/picture-check.mjs uses). */
await page.evaluate(() => {
  const W = 600, H = 780;
  const wrap = document.createElement('div');
  wrap.id = 'testWrap';
  wrap.className = 'pageWrap';
  wrap.style.cssText = 'position:relative;flex:none;width:' + W + 'px;height:' + H +
    'px;min-width:' + W + 'px;min-height:' + H + 'px;background:#fff';
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' });
  svg.classList.add('overlay');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  wrap.appendChild(canvas); wrap.appendChild(svg);
  document.body.appendChild(wrap);
  const p = { num: 1, baseW: W, baseH: H, wrap, canvas, svg };
  pages = [p]; pdfDoc = {}; scale = 1; annotations = []; undoStack = []; redoStack = [];
  attachOverlayHandlers(p);
  setTool('pen');
  window.__toasts = [];
  const real = window.toast;
  window.toast = function (m) { window.__toasts.push(m); return real.apply(this, arguments); };
});

/* Where page unit (x, y) is on the screen RIGHT NOW (the zoom changes). */
async function geo() {
  return page.evaluate(() => {
    document.getElementById('testWrap').scrollIntoView({ block: 'start' });
    const r = pages[0].svg.getBoundingClientRect();
    return { left: r.left, top: r.top, w: r.width, h: r.height, bw: pages[0].baseW, bh: pages[0].baseH };
  });
}
const px = (g, x, y) => ({ x: g.left + x * g.w / g.bw, y: g.top + y * g.h / g.bh });
async function moveTo(g, x, y, opts) { const c = px(g, x, y); await page.mouse.move(c.x, c.y, opts); }
async function stroke(g, pts, { hold = 0, lift = true } = {}) {
  await moveTo(g, pts[0].x, pts[0].y);
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) await moveTo(g, pts[i].x, pts[i].y);
  if (hold) await page.waitForTimeout(hold);
  const state = await page.evaluate(() => ({ snap: drawing && drawing.snap ? drawing.snap.kind : null, n: drawing ? drawing.ann.points.length : -1 }));
  if (lift) await page.mouse.up();
  return state;
}
const lastAnn = () => page.evaluate(() => { const a = annotations[annotations.length - 1]; return a ? JSON.parse(JSON.stringify(a)) : null; });
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

/* The overlay really is what a mouse at that spot lands on. */
let g = await geo();
const probe = px(g, 300, 400);
ok('a real mouse at the page centre lands on the page overlay',
   await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return !!e && (e === pages[0].svg || pages[0].svg.contains(e)); }, [probe.x, probe.y]));

/* ================= hold-to-snap ================= */
console.log('\n✏️ Hold-to-snap shapes, at two zooms');
for (const zoom of [1, 1.6]) {
  await page.evaluate((z) => {
    const w = document.getElementById('testWrap');
    w.style.width = w.style.minWidth = 600 * z + 'px';
    w.style.height = w.style.minHeight = 780 * z + 'px';
    annotations = []; undoStack = []; renderAllOverlays();
  }, zoom);
  g = await geo();
  const tag = ' at ' + Math.round(zoom * 100) + '%';

  /* A straight line, drawn a little crooked, held. */
  let s = await stroke(g, make.line(rng(11), 240, 20), { hold: 750 });
  let a = await lastAnn();
  ok('a held crooked line becomes a straight line' + tag, s.snap === 'line' && a && a.points.length === 2, JSON.stringify(s));
  ok('…still an ordinary pen stroke, one undo step' + tag, a && a.type === 'pen' && (await page.evaluate(() => undoStack.length)) === 1);
  const ang = Math.atan2(a.points[1].y - a.points[0].y, a.points[1].x - a.points[0].x) * 180 / Math.PI;
  ok('…at the angle it was drawn at' + tag, Math.abs(ang - 20) < 6, 'angle ' + ang.toFixed(1));
  await page.evaluate(() => { annotations = []; undoStack = []; renderAllOverlays(); });

  /* A nearly level line is levelled exactly. */
  s = await stroke(g, make.line(rng(4), 260, 2), { hold: 750 });
  a = await lastAnn();
  ok('a nearly level line is levelled exactly' + tag, s.snap === 'line' && a.points[0].y === a.points[1].y, JSON.stringify(a && a.points));
  await page.evaluate(() => { annotations = []; undoStack = []; renderAllOverlays(); });

  /* A circle. */
  s = await stroke(g, make.circle(rng(5), 180), { hold: 750 });
  a = await lastAnn();
  const ring = a.points.slice(0, -1);      // a closed stroke repeats its first point
  const cx = ring.reduce((t, q) => t + q.x, 0) / ring.length, cy = ring.reduce((t, q) => t + q.y, 0) / ring.length;
  const radii = ring.map((q) => Math.hypot(q.x - cx, q.y - cy));
  ok('a held circle becomes a true circle' + tag, s.snap === 'circle' && Math.max(...radii) - Math.min(...radii) < 1.5, JSON.stringify(s));
  ok('…closed, with about ninety segments' + tag, a.points.length >= 85 && a.points[0].x === a.points.at(-1).x && a.points[0].y === a.points.at(-1).y, 'n=' + a.points.length);
  await page.evaluate(() => { annotations = []; undoStack = []; renderAllOverlays(); });

  /* A rectangle and a triangle. */
  s = await stroke(g, make.rect(rng(6), 240, 150, 0), { hold: 750 });
  a = await lastAnn();
  ok('a held rectangle becomes five points' + tag, s.snap === 'rect' && a.points.length === 5, JSON.stringify(s));
  await page.evaluate(() => { annotations = []; undoStack = []; renderAllOverlays(); });
  s = await stroke(g, make.regular(rng(3), 3, 240, 12), { hold: 750 });
  a = await lastAnn();
  ok('a held triangle becomes a closed triangle' + tag, s.snap === 'poly' && a.points.length === 4, JSON.stringify(s));
  await page.evaluate(() => { annotations = []; undoStack = []; renderAllOverlays(); });

  /* The shapes the old recogniser never knew. */
  s = await stroke(g, make.arc(rng(7), 260, 120), { hold: 750 });
  ok('a held arc stays an arc' + tag, s.snap === 'arc', JSON.stringify(s));
  await page.evaluate(() => { annotations = []; undoStack = []; renderAllOverlays(); });
  s = await stroke(g, make.rect(rng(2), 220, 160, 25), { hold: 750 });
  a = await lastAnn();
  ok('a TILTED rectangle is a rectangle, and keeps its tilt' + tag, s.snap === 'rect' && a.points.length === 5);
  await page.evaluate(() => { annotations = []; undoStack = []; renderAllOverlays(); });

  /* Keep dragging after the snap: the shape follows the pen. */
  const circle = make.circle(rng(5), 180);
  await moveTo(g, circle[0].x, circle[0].y); await page.mouse.down();
  for (const q of circle.slice(1)) await moveTo(g, q.x, q.y);
  await page.waitForTimeout(750);
  const snapped = await page.evaluate(() => ({ kind: drawing.snap && drawing.snap.kind, c: drawing.snap && drawing.snap.c }));
  await moveTo(g, snapped.c.x + 140, snapped.c.y);
  await page.waitForTimeout(80);
  await page.mouse.up();
  a = await lastAnn();
  const radii2 = a.points.map((q) => Math.hypot(q.x - snapped.c.x, q.y - snapped.c.y));
  ok('dragging on after the snap resizes the circle to follow the pen' + tag, snapped.kind === 'circle' && Math.abs(Math.max(...radii2) - 140) < 1.5, 'r=' + Math.max(...radii2).toFixed(1));
  ok('…and lifting commits ONE undo step' + tag, (await page.evaluate(() => [undoStack.length, annotations.length])).join() === '1,1');
  await page.evaluate(() => { annotations = []; undoStack = []; renderAllOverlays(); });

  /* Not held: freehand, byte for byte. A circle drawn and lifted at once. */
  const raw = make.circle(rng(5), 180);
  s = await stroke(g, raw, { hold: 0 });
  a = await lastAnn();
  ok('a stroke that is not held stays freehand ink' + tag, s.snap === null && a.points.length > 40, JSON.stringify(s) + ' n=' + (a && a.points.length));
  await page.evaluate(() => { annotations = []; undoStack = []; renderAllOverlays(); });

  /* A scribble held still is left as it was. */
  s = await stroke(g, make.scribble(rng(9), 300), { hold: 750 });
  ok('a held scribble is not turned into something it is not' + tag, s.snap === null, JSON.stringify(s));
  await page.evaluate(() => { annotations = []; undoStack = []; renderAllOverlays(); });
}
await shot('hold-to-snap');

/* Undo takes a snapped shape off in one step. */
await page.evaluate(() => { annotations = []; undoStack = []; renderAllOverlays(); });
g = await geo();
await stroke(g, make.circle(rng(5), 180), { hold: 750 });
await page.evaluate(() => undo());
ok('undo removes a snapped shape in one step', (await page.evaluate(() => annotations.length)) === 0);
await page.evaluate(() => { annotations = []; undoStack = []; renderAllOverlays(); });

/* ================= Pen select ================= */
console.log('\n✒ Pen select');
await page.evaluate(() => {
  const w = document.getElementById('testWrap');
  w.style.width = w.style.minWidth = '600px'; w.style.height = w.style.minHeight = '780px';
  annotations = []; undoStack = []; redoStack = [];
  const ink = (id, cx, cy) => annotations.push({ id, page: 1, type: 'pen', color: '#1A1A1A', width: 3, points: [{ x: cx - 12, y: cy - 8 }, { x: cx, y: cy + 10 }, { x: cx + 12, y: cy - 6 }], ts: 1 });
  ink('in1', 200, 220); ink('in2', 260, 280); ink('out', 500, 560);
  renderAllOverlays();
  setTool('pen');
});
g = await geo();

/* The toolbar: the Tools menu carries the button, the button picks the tool. */
await page.click('#selectionMenuBtn');
ok('the Tools menu offers Pen select beside the lasso', await page.evaluate(() => !!document.querySelector('#selectionMenu [data-tool="penselect"]') && !!document.querySelector('#selectionMenu [data-tool="lasso"]')));
await page.click('#selectionMenu [data-tool="penselect"]');
ok('choosing it makes it the tool in hand', await page.evaluate(() => tool === 'penselect' && document.querySelector('[data-tool="penselect"]').classList.contains('active')));
ok('…and the Tools button shows it is active', await page.evaluate(() => document.getElementById('selectionMenuBtn').getAttribute('aria-label') === 'Tools: Pen select'));
ok('the shortcut is Shift+S and says so', await page.evaluate(() => document.querySelector('[data-tool="penselect"]').getAttribute('data-key') === 'Shift+S'));

await page.evaluate(() => setTool('pen'));
await page.keyboard.press('Shift+S');
ok('Shift+S picks Pen select from any tool', await page.evaluate(() => tool === 'penselect'));
await page.keyboard.press('s');
ok('plain S is still the lasso', await page.evaluate(() => tool === 'lasso'));
await page.keyboard.press('Shift+S');

/* Place a path: a corner, a dragged (curved) point, two more corners. */
const A = { x: 100, y: 130 }, B = { x: 400, y: 130 }, C = { x: 400, y: 430 }, D = { x: 100, y: 430 };
await moveTo(g, A.x, A.y); await page.mouse.down(); await page.mouse.up();
ok('a click places a corner point and draws the path', await page.evaluate(() => penPath && penPath.anchors.length === 1 && !!document.querySelector('[data-pen-anchor]')));
await moveTo(g, B.x, B.y); await page.mouse.down(); await moveTo(g, B.x + 50, B.y - 40); await moveTo(g, B.x + 60, B.y - 50); await page.mouse.up();
const pulled = await page.evaluate(() => { const a = penPath.anchors[1]; return { hout: a.hout, hin: a.hin, handles: document.querySelectorAll('[data-pen-handle]').length }; });
ok('click-and-drag pulls symmetric handles out of the point',
   pulled.hout && pulled.hin && Math.abs(pulled.hout.x - 460) < 1 && Math.abs(pulled.hin.x - 340) < 1 && pulled.handles === 2, JSON.stringify(pulled));
await moveTo(g, C.x, C.y); await page.mouse.down(); await page.mouse.up();
await moveTo(g, D.x, D.y); await page.mouse.down(); await page.mouse.up();
ok('four points are on the path', await page.evaluate(() => penPath.anchors.length === 4));
await moveTo(g, 260, 300);
ok('a rubber band follows the pointer between clicks', await page.evaluate(() => document.querySelectorAll('[data-pen-rubber]').length === 1));
ok('…but no close cue yet', await page.evaluate(() => document.querySelectorAll('[data-pen-close]').length === 0));
await moveTo(g, A.x + 4, A.y + 3);
ok('near the first point the close cue appears', await page.evaluate(() => document.querySelectorAll('[data-pen-close]').length === 1));
await shot('pen-select-path');

/* Everything the pen draws is a fixed SCREEN size. */
const sizeAt = async () => page.evaluate(() => document.querySelector('[data-pen-anchor]').getBoundingClientRect().width);
const w100 = await sizeAt();
await page.evaluate(() => { const w = document.getElementById('testWrap'); w.style.width = w.style.minWidth = '1200px'; w.style.height = w.style.minHeight = '1560px'; penSelectRedraw(); });
const w200 = await sizeAt();
await page.evaluate(() => { const w = document.getElementById('testWrap'); w.style.width = w.style.minWidth = '600px'; w.style.height = w.style.minHeight = '780px'; penSelectRedraw(); });
ok('a point is the same size on screen at 100% and at 200%', Math.abs(w100 - w200) < 0.6 && w100 > 5 && w100 < 10, w100.toFixed(2) + ' vs ' + w200.toFixed(2));

/* Backspace takes a point back; a re-render keeps the path. */
await page.keyboard.press('Backspace');
ok('Backspace removes the last point', await page.evaluate(() => penPath.anchors.length === 3 && document.querySelectorAll('[data-pen-anchor]').length === 3));
await page.evaluate(() => renderAllOverlays());
ok('a re-render of the page does not lose the path', await page.evaluate(() => document.querySelectorAll('[data-pen-anchor]').length === 3));
// Two presses on the same spot inside ~380 ms are a double-click, which closes
// the path — so put the point back after the double-click window has passed.
await page.waitForTimeout(450);
await moveTo(g, D.x, D.y); await page.mouse.down(); await page.mouse.up();
ok('the point goes back where it was', await page.evaluate(() => penPath && penPath.anchors.length === 4));

/* Close by clicking the first point. */
await moveTo(g, A.x + 2, A.y + 2); await page.mouse.down(); await page.mouse.up();
const closed = await page.evaluate(() => ({ path: penPath, ids: lassoSel ? lassoSel.ids.slice().sort() : null, bar: document.getElementById('lassoBar').style.display, tool, undo: undoStack.length, annotations: annotations.length, preview: document.querySelectorAll('[data-pen-select]').length }));
ok('clicking the first point closes the path and selects what is inside it', closed.ids && closed.ids.join() === 'in1,in2', JSON.stringify(closed));
ok('…the lasso bar is up, the path is off the page, the tool stays in hand', closed.bar === 'flex' && closed.path === null && closed.preview === 0 && closed.tool === 'penselect');
ok('…and nothing was saved or made undoable by selecting', closed.undo === 0 && closed.annotations === 3);
await shot('pen-select-selected');

/* The selection is the lasso's own: drag inside it to move it. */
await moveTo(g, 230, 250); await page.mouse.down(); await moveTo(g, 260, 270); await moveTo(g, 300, 300); await page.mouse.up();
const moved = await page.evaluate(() => ({ in1: annotations.find((a) => a.id === 'in1').points[0], out: annotations.find((a) => a.id === 'out').points[0], undo: undoStack.length }));
ok('dragging inside the selection moves it (the lasso’s own move)', moved.in1.x > 188 + 40 && moved.out.x === 488, JSON.stringify(moved));
ok('…as one undo step', moved.undo === 1);
await page.keyboard.press('Escape');
ok('Esc lets the selection go', await page.evaluate(() => lassoSel === null && document.getElementById('lassoBar').style.display === 'none'));

/* Enter closes. */
await page.evaluate(() => { annotations = []; undoStack = []; redoStack = [];
  const ink = (id, cx, cy) => annotations.push({ id, page: 1, type: 'pen', color: '#1A1A1A', width: 3, points: [{ x: cx - 12, y: cy - 8 }, { x: cx + 12, y: cy + 6 }], ts: 1 });
  ink('in1', 200, 220); ink('in2', 260, 280); ink('out', 500, 560); renderAllOverlays(); });
for (const q of [A, B, C]) { await moveTo(g, q.x, q.y); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(420); }
await page.keyboard.press('Enter');
ok('Enter closes the path and selects too', await page.evaluate(() => penPath === null && lassoSel && lassoSel.ids.slice().sort().join() === 'in1,in2'));
await page.keyboard.press('Escape');

/* Esc cancels an unfinished path. */
for (const q of [A, B]) { await moveTo(g, q.x, q.y); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(420); }
await page.keyboard.press('Escape');
ok('Esc cancels the path: nothing selected and nothing left on the page', await page.evaluate(() => penPath === null && lassoSel === null && document.querySelectorAll('[data-pen-select]').length === 0));

/* Two points are not a selection. */
for (const q of [A, B]) { await moveTo(g, q.x, q.y); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(420); }
await page.keyboard.press('Enter');
ok('fewer than three points is refused in words and the path is kept',
   await page.evaluate(() => penPath && penPath.anchors.length === 2 && /at least three points/.test(window.__toasts.at(-1))));
await page.keyboard.press('Escape');

/* Double-click closes. */
for (const q of [A, B]) { await moveTo(g, q.x, q.y); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(420); }
await moveTo(g, C.x, C.y);
await page.mouse.dblclick(C.x * g.w / g.bw + g.left, C.y * g.h / g.bh + g.top);
ok('a double-click closes and selects, adding no duplicate point', await page.evaluate(() => penPath === null && lassoSel && lassoSel.ids.slice().sort().join() === 'in1,in2'));
await page.keyboard.press('Escape');

/* Curved: two dragged points make a lens that selects by its curve. */
await page.evaluate(() => {
  annotations = []; undoStack = [];
  const ink = (id, cx, cy) => annotations.push({ id, page: 1, type: 'pen', color: '#1A1A1A', width: 3, points: [{ x: cx - 6, y: cy - 4 }, { x: cx + 6, y: cy + 4 }], ts: 1 });
  ink('top', 300, 340); ink('above', 300, 300); ink('mid', 300, 400);
  renderAllOverlays();
});
await moveTo(g, 200, 400); await page.mouse.down(); await moveTo(g, 200, 300); await page.mouse.up(); await page.waitForTimeout(420);
await moveTo(g, 400, 400); await page.mouse.down(); await moveTo(g, 400, 500); await page.mouse.up();
await page.keyboard.press('Enter');
ok('two curved points close into a lens and select by the curve',
   await page.evaluate(() => penPath === null && lassoSel && lassoSel.ids.slice().sort().join() === 'mid,top'), await page.evaluate(() => JSON.stringify(lassoSel && lassoSel.ids)));
await shot('pen-select-curve');
await page.keyboard.press('Escape');

/* Switching tools cancels an unfinished path. */
for (const q of [A, B]) { await moveTo(g, q.x, q.y); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(420); }
await page.evaluate(() => setTool('pen'));
ok('switching tools cancels an unfinished path', await page.evaluate(() => penPath === null && document.querySelectorAll('[data-pen-select]').length === 0));

/* A lost window cancels it too. */
await page.evaluate(() => setTool('penselect'));
await moveTo(g, A.x, A.y); await page.mouse.down(); await page.mouse.up();
await page.evaluate(() => window.dispatchEvent(new Event('blur')));
ok('a lost window cancels an unfinished path', await page.evaluate(() => penPath === null));

ok('no uncaught error from any of it', errors.length === 0, errors.join('\n      '));
await browser.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
