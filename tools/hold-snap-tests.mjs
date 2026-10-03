/* Hold-to-snap through the REAL pointer handlers and the REAL shape-snap.js.
   The recogniser itself is tested in shape-snap-tests.mjs; this is the glue:
   that a stroke held still becomes the neat shape, that the shape stays
   adjustable while the pen is down, that lifting commits ONE undo step, and that
   a stroke that is not held — or a page where shape-snap.js never loaded — is
   plain ink exactly as before. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build, html } from './pointer-harness.mjs';
import { rng, make } from './shape-snap-fixtures.mjs';

/* Draw `pts` (page units) with the pen: down on the first point, a move to each
   of the rest. Does NOT lift — the caller decides whether the pen is held. */
function draw(run, pts) {
  run(`var __pts = ${JSON.stringify(pts)};
       tool = 'pen';
       down(__pts[0].x, __pts[0].y);
       for (var i = 1; i < __pts.length; i++) move(__pts[i].x, __pts[i].y);`);
}
const rounded = (pts) => {
  const out = [];
  for (const p of pts) {
    const q = { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 };
    const l = out[out.length - 1];
    if (!l || l.x !== q.x || l.y !== q.y) out.push(q);
  }
  return out;
};

test('the hold timing is the shared module’s own', () => {
  const { c } = build({ snap: true });
  assert.equal(c.SNAP_HOLD_MS, c.ShapeSnap.T.HOLD_MS);
  assert.equal(c.SNAP_JITTER_PX, c.ShapeSnap.T.HOLD_JITTER_PX);
});

test('putting the pen down arms the hold timer, and it runs for SNAP_HOLD_MS', () => {
  const { c, run } = build({ snap: true });
  run(`down(100, 100);`);
  assert.equal(c.timers.size, 1);
  assert.equal([...c.timers.values()][0].ms, 550);
});

test('a held straight line becomes exactly two points', () => {
  const { c, run } = build({ snap: true });
  const pts = make.line(rng(11), 220, 20);
  draw(run, pts);
  assert(c.drawing.ann.points.length > 20, 'freehand before the hold');
  run('holdElapsed();');
  assert.equal(c.drawing.snap.kind, 'line');
  assert.equal(c.drawing.ann.points.length, 2);
  assert.match(c.toasts.at(-1), /Straight line/);
  run('up(__pts.at(-1).x, __pts.at(-1).y);');
  assert.equal(c.annotations.length, 1);
  assert.equal(c.annotations[0].type, 'pen', 'still an ordinary pen stroke');
  assert.equal(c.annotations[0].points.length, 2);
  assert.equal(c.undoCount, 1);
});

test('a held circle becomes a closed ninety-segment stroke', () => {
  const { c, run } = build({ snap: true });
  draw(run, make.circle(rng(5), 180));
  run('holdElapsed();');
  assert.equal(c.drawing.snap.kind, 'circle');
  const pts = c.drawing.ann.points;
  assert.equal(pts.length, 91);
  assert.deepEqual(pts[0], pts[90], 'closed: the first point is repeated');
  run('up(0, 0);');   // the up position is only used when the stroke is NOT snapped
  assert.equal(c.annotations.length, 1);
  assert.equal(c.annotations[0].points.length, 91);
  assert.equal(c.undoCount, 1);
});

test('a held rectangle becomes five points', () => {
  const { c, run } = build({ snap: true });
  draw(run, make.rect(rng(6), 240, 150, 0));
  run('holdElapsed();');
  assert.equal(c.drawing.snap.kind, 'rect');
  assert.equal(c.drawing.ann.points.length, 5);
  assert.deepEqual(c.drawing.ann.points[0], c.drawing.ann.points[4]);
  assert.match(c.toasts.at(-1), /Rectangle|Square/);
});

test('a held triangle and a held arc snap too — the cases the old recogniser could not do', () => {
  let t = build({ snap: true });
  draw(t.run, make.regular(rng(3), 3, 240, 12));
  t.run('holdElapsed();');
  assert.equal(t.c.drawing.snap.kind, 'poly');
  assert.equal(t.c.drawing.ann.points.length, 4);
  t = build({ snap: true });
  draw(t.run, make.arc(rng(7), 260, 120));
  t.run('holdElapsed();');
  assert.equal(t.c.drawing.snap.kind, 'arc');
  assert(t.c.drawing.ann.points.length > 8);
});

test('only the first snap says so — and it names the shape', () => {
  const { c, run } = build({ snap: true });
  draw(run, make.circle(rng(5), 180));
  run('holdElapsed();');
  assert.equal(c.toasts.filter((m) => /Circle/.test(m)).length, 1);
  run('up(0,0);');
  draw(run, make.line(rng(8), 200, 10));
  const before = c.toasts.length;
  run('holdElapsed();');
  assert.equal(c.drawing.snap.kind, 'line');
  assert.equal(c.toasts.length, before, 'the hint is shown once per session');
});

test('keep dragging after the snap and the shape follows the pen', () => {
  const { c, run } = build({ snap: true });
  const pts = make.line(rng(11), 220, 20);
  draw(run, pts);
  run('holdElapsed();');
  const a = c.drawing.snap.a;
  run(`move(${a.x + 300}, ${a.y + 77});`);
  const [start, end] = c.drawing.ann.points;
  assert(Math.hypot(start.x - a.x, start.y - a.y) < 0.01, 'the start stays where it snapped');
  assert(Math.abs(Math.hypot(end.x - start.x, end.y - start.y) - Math.hypot(300, 77)) < 0.05);
  run('frame();');
  run(`up(${a.x + 300}, ${a.y + 77});`);
  assert.equal(c.annotations.length, 1);
  assert.equal(c.annotations[0].points.length, 2);
  assert.equal(c.undoCount, 1, 'adjusting and lifting is ONE undo step');
});

test('a circle’s radius follows the pen; an ellipse scales; a rectangle resizes about the opposite corner', () => {
  let t = build({ snap: true });
  draw(t.run, make.circle(rng(5), 180));
  t.run('holdElapsed();');
  const d = t.c.drawing.snap;
  t.run(`move(${d.c.x + 150}, ${d.c.y});`);
  const pts = t.c.drawing.ann.points;
  const r = Math.max(...pts.map((p) => Math.hypot(p.x - d.c.x, p.y - d.c.y)));
  assert(Math.abs(r - 150) < 0.5, `radius ${r}`);

  t = build({ snap: true });
  draw(t.run, make.rect(rng(6), 240, 150, 0));
  t.run('holdElapsed();');
  const rect = t.c.drawing.snap;
  const corners = t.c.ShapeSnap.rectCorners(rect);
  const opp = corners[(rect.handle + 2) % 4];
  t.run(`move(${opp.x + (rect.handle === 0 || rect.handle === 3 ? -400 : 400)}, ${opp.y + (rect.handle < 2 ? -300 : 300)});`);
  const np = t.c.drawing.ann.points;
  const xs = np.map((p) => p.x), ys = np.map((p) => p.y);
  assert(Math.abs(Math.max(...xs) - Math.min(...xs) - 400) < 0.1);
  assert(Math.abs(Math.max(...ys) - Math.min(...ys) - 300) < 0.1);
});

test('an arc keeps growing past half a turn — it is extended from where it is, not from where it snapped', () => {
  const { c, run } = build({ snap: true });
  draw(run, make.arc(rng(7), 260, 100));
  run('holdElapsed();');
  const d = c.drawing.snap;
  assert.equal(d.kind, 'arc');
  const start = d.a0 + d.sweep;
  let angle = start;
  for (let k = 1; k <= 20; k++) {
    angle = start + k * 0.2;      // sweeps another 4 radians round the same centre
    run(`move(${d.c.x + d.r * Math.cos(angle)}, ${d.c.y + d.r * Math.sin(angle)});`);
  }
  assert(Math.abs(c.drawing.snapCur.sweep - (d.sweep + 4)) < 0.05, `sweep ${c.drawing.snapCur.sweep} vs ${d.sweep + 4}`);
});

test('a stroke that is not held is freehand byte for byte — no timer ever ran', () => {
  const { c, run } = build({ snap: true });
  const pts = make.circle(rng(5), 180);
  draw(run, pts);
  const last = pts.at(-1);
  run(`up(${last.x}, ${last.y});`);
  assert.equal(c.annotations.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(c.annotations[0].points)), rounded(pts));
  assert.equal(c.timers.size, 0, 'the hold timer is cleared on lift');
  assert.equal(c.toasts.length, 0);
});

test('a hold on handwriting changes nothing: a held scribble stays ink', () => {
  const { c, run } = build({ snap: true });
  const pts = make.scribble(rng(9), 300);
  draw(run, pts);
  const before = JSON.stringify(c.drawing.ann.points);
  run('holdElapsed();');
  assert.equal(c.drawing.snap, undefined);
  assert.equal(JSON.stringify(c.drawing.ann.points), before);
  assert.equal(c.toasts.length, 0);
});

test('moving more than the jitter radius re-arms the timer; wobbling inside it does not', () => {
  const { c, run } = build({ snap: true });
  run(`down(100, 100);`);
  const first = [...c.timers.keys()][0];
  run(`move(103, 101);`);          // 3 px of wobble
  assert.deepEqual([...c.timers.keys()], [first], 'the timer was left to run out');
  run(`move(140, 101);`);          // a real move
  const second = [...c.timers.keys()][0];
  assert.notEqual(second, first, 'a real move re-armed it');
  assert.equal(c.timers.size, 1);
});

test('the jitter radius is in SCREEN pixels, so it means the same at every zoom', () => {
  // Zoomed in, 7 screen pixels is a small stretch of page; zoomed out it is a lot.
  const { c, run } = build({ snap: true });
  run(`rectW = 2400; rectH = 3200; down(100, 100);`);
  const first = [...c.timers.keys()][0];
  // 1 page unit is 4 screen pixels here, so 1.5 units = 6 px: still holding still.
  run(`move(101.5, 100);`);
  assert.deepEqual([...c.timers.keys()], [first]);
  run(`move(104, 100);`);          // 16 px: moved
  assert.notEqual([...c.timers.keys()][0], first);
});

test('the recogniser is told the zoom — the same dot is a shape zoomed in and a speck zoomed out', () => {
  // A 14-unit stroke is 14 screen px at 100%, but only 3.5 px at 25%.
  const small = Array.from({ length: 40 }, (_, i) => ({ x: 200 + i * 0.35, y: 200 }));
  let t = build({ snap: true });
  t.run(`rectW = 600; rectH = 800;`);
  draw(t.run, small);
  t.run('holdElapsed();');
  assert.equal(t.c.drawing.snap, undefined, 'a 14 px stroke at 100% is too short to be a line');
  t = build({ snap: true });
  t.run(`rectW = 2400; rectH = 3200;`);   // zoomed in 4×: the same 14 units is 56 px
  draw(t.run, small);
  t.run('holdElapsed();');
  assert.equal(t.c.drawing.snap && t.c.drawing.snap.kind, 'line', 'zoomed in, the same stroke is a real line');
});

test('highlighter strokes snap and stay highlighter strokes', () => {
  const { c, run } = build({ snap: true });
  run(`tool = 'highlight';`);
  const pts = make.line(rng(2), 240, 5);
  run(`var __pts = ${JSON.stringify(pts)}; down(__pts[0].x, __pts[0].y); for (var i = 1; i < __pts.length; i++) move(__pts[i].x, __pts[i].y);`);
  run('holdElapsed(); up(0, 0);');
  assert.equal(c.annotations[0].type, 'highlight');
  assert.equal(c.annotations[0].points.length, 2);
});

test('a pointercancel after the snap keeps the snapped shape, and no timer is left', () => {
  const { c, run } = build({ snap: true });
  draw(run, make.circle(rng(5), 180));
  run('holdElapsed();');
  run(`pointer('pointercancel', { clientX: 0, clientY: 0 });`);
  assert.equal(c.annotations.length, 1);
  assert.equal(c.annotations[0].points.length, 91);
  assert.equal(c.drawing, null);
  assert.equal(c.timers.size, 0);
  assert.equal(c.undoCount, 1);
});

test('a palm that grows onto the page ends the stroke and its hold timer with it', () => {
  const { c, run } = build({ snap: true });
  run(`stylusOnly = false; pointerCancelCount = 0;
       pointer('pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 100, clientY: 100 });
       pointer('pointermove', { pointerType: 'touch', pointerId: 2, clientX: 130, clientY: 100 });`);
  assert(c.drawing, 'a finger stroke is under way');
  run(`pointer('pointermove', { pointerType: 'touch', pointerId: 2, clientX: 160, clientY: 100, width: 80 });`);
  assert.equal(c.drawing, null, 'the palm abandoned the stroke');
  assert.equal(c.timers.size, 0);
  run('holdElapsed();');     // nothing left to fire
  assert.equal(c.annotations.length, 0);
});

test('a second pen-down in the same stroke does not start another timer', () => {
  const { c, run } = build({ snap: true });
  run(`down(100, 100); pointer('pointerdown', { clientX: 100, clientY: 100, button: 2, buttons: 3 });`);
  assert.equal(c.timers.size, 1);
});

/* ---- if shape-snap.js never loaded, the page must carry on writing ---- */
test('with shape-snap.js missing, a stroke is plain ink and nothing throws', () => {
  const { c, run } = build({ snap: true, lib: false });
  assert.equal(c.ShapeSnap, undefined);
  const pts = make.circle(rng(5), 180);
  draw(run, pts);
  assert.equal(c.timers.size, 0, 'no timer is armed for a recogniser that is not there');
  run('holdElapsed();');
  assert.equal(c.drawing.snap, undefined);
  const last = pts.at(-1);
  run(`up(${last.x}, ${last.y});`);
  assert.equal(c.annotations.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(c.annotations[0].points)), rounded(pts));
});

test('a recogniser that throws leaves the stroke as ink', () => {
  const { c, run } = build({ snap: true });
  run(`ShapeSnap.recognize = function () { throw new Error('boom'); };`);
  draw(run, make.circle(rng(5), 180));
  const before = JSON.stringify(c.drawing.ann.points);
  run('holdElapsed();');
  assert.equal(c.drawing.snap, undefined);
  assert.equal(JSON.stringify(c.drawing.ann.points), before);
});

test('a drag that cannot be turned into points leaves the snapped shape where it was', () => {
  const { c, run } = build({ snap: true });
  draw(run, make.line(rng(11), 220, 20));
  run('holdElapsed();');
  const snapped = JSON.stringify(c.drawing.ann.points);
  run(`ShapeSnap.drag = function () { throw new Error('boom'); }; move(500, 500);`);
  assert.equal(JSON.stringify(c.drawing.ann.points), snapped);
});

test('the old hand-written recogniser is gone — the page asks ShapeSnap and nothing else', () => {
  for (const name of ['recognizeStroke', 'snapShapePoints', 'closedCorners', 'dpSimplify', 'sampleQuadCurve', 'sampleEllipsePts', 'axisSnapEnd']) {
    assert.equal(new RegExp('\\b' + name + '\\b').test(html), false, `${name} is still in index.html`);
  }
  assert.match(html, /<script src="shape-snap\.js"><\/script>/);
  assert(html.indexOf('<script src="shape-snap.js">') < html.indexOf('\n<script>\n'), 'shape-snap.js loads before the application script');
});
