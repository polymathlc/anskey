/* ⬚ Box select (v1.209.0), through the REAL pointer handlers and the REAL
   lasso section (tools/pointer-harness.mjs). Box select is the lasso with a
   rectangle for its loop, so every case here is a way it could quietly stop
   being that:

     · it must select EXACTLY what a lasso drawn along the same rectangle does
       (the one inclusion rule: centre inside, locked pictures out, groups whole)
     · a tap is not a box: no "nothing inside" notice, no selection
     · dragging up and to the left is the same box as down and to the right
     · the box drawn on the page is straight-edged and never an annotation  */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build, html } from './pointer-harness.mjs';
import { rng } from './shape-snap-fixtures.mjs';

function rig() {
  const h = build({ pen: true });
  h.run(`function addStroke(id, pts, extra) { annotations.push(Object.assign({ id: id, page: 1, type: 'pen', color: '#000', width: 2, points: pts }, extra || {})); }
    function box(id, cx, cy, half) { addStroke(id, [{ x: cx - half, y: cy - half }, { x: cx + half, y: cy + half }]); }
    function boxDrag(x0, y0, x1, y1) { now += 1000; down(x0, y0); move((x0 + x1) / 2, (y0 + y1) / 2); move(x1, y1); up(x1, y1); }`);
  return h;
}
const ids = (c) => (c.lassoSel ? [...c.lassoSel.ids].sort() : null);

test('the corners are the rectangle, whichever way it was dragged', () => {
  const { c } = rig();
  const a = c.boxSelectCorners({ x: 10, y: 20 }, { x: 110, y: 220 });
  const b = c.boxSelectCorners({ x: 110, y: 220 }, { x: 10, y: 20 });
  assert.deepEqual(JSON.parse(JSON.stringify(a)), [{ x: 10, y: 20 }, { x: 110, y: 20 }, { x: 110, y: 220 }, { x: 10, y: 220 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
});

test('a box selects by the lasso’s own rule', () => {
  const { c, run } = rig();
  run(`tool = 'rectselect';
       box('in', 150, 150, 60);              // sticks out of the box, centre inside
       box('out', 150, 40, 60);              // overlaps the box, centre outside
       addStroke('locked', [{ x: 140, y: 140 }, { x: 160, y: 160 }], { locked: true });
       box('mate', 700, 700, 5); annotations.find(a => a.id === 'mate').grp = 'g1';
       box('member', 180, 180, 5); annotations.find(a => a.id === 'member').grp = 'g1';
       boxDrag(100, 100, 260, 260);`);
  assert.deepEqual(ids(c), ['in', 'mate', 'member'], 'centre in, locked out, a group comes whole');
  assert.equal(c.$('lassoBar').style.display, 'flex', 'the lasso bar is up: move, resize, duplicate, delete');
});

test('box select and a lasso along the same rectangle never disagree', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const r = rng(seed * 37);
    const x0 = Math.round(60 + r() * 200), y0 = Math.round(60 + r() * 300);
    const x1 = Math.round(x0 + 80 + r() * 260), y1 = Math.round(y0 + 80 + r() * 300);
    const strokes = Array.from({ length: 40 }, (_, i) => {
      const x = 20 + r() * 560, y = 20 + r() * 760, w = 4 + r() * 60, h = 4 + r() * 60;
      return { id: 's' + i, pts: [{ x, y }, { x: x + w, y: y + h }] };
    });
    const setup = `annotations.length = 0; lassoSel = null; ${strokes.map((s) => `addStroke('${s.id}', ${JSON.stringify(s.pts)});`).join(' ')}`;
    const a = rig(), b = rig();
    a.run(setup + ` tool = 'lasso'; now += 1000; down(${x0}, ${y0}); move(${x1}, ${y0}); move(${x1}, ${y1}); move(${x0}, ${y1}); up(${x0}, ${y1});`);
    b.run(setup + ` tool = 'rectselect'; boxDrag(${x1}, ${y1}, ${x0}, ${y0});`);
    if (!ids(a.c)) { assert.equal(ids(b.c), null, `seed ${seed}`); continue; }
    assert.deepEqual(ids(b.c), ids(a.c), `seed ${seed}: box and lasso disagree`);
  }
});

test('a tap is not a box: nothing selected and nothing said', () => {
  const { c, run } = rig();
  run(`tool = 'rectselect'; box('x', 150, 150, 20); now += 1000; down(150, 150); up(150, 150);`);
  assert.equal(c.lassoSel, null);
  assert.equal(c.lassoing, null, 'the gesture is finished');
  assert.equal(c.annotations.length, 1, 'the box never became an annotation');
});

test('the box on the page is straight-edged while it is dragged', () => {
  const { c, run } = rig();
  run(`tool = 'rectselect'; now += 1000; down(100, 100); move(200, 150); move(300, 260);`);
  assert(c.lassoing && c.lassoing.box, 'a box gesture is under way');
  const d = c.lassoing.node.attrs.d;
  assert.match(d, /^M100\.00 100\.00 L300\.00 100\.00 L300\.00 260\.00 L100\.00 260\.00 Z$/);
  run('up(300, 260);');
});

test('the tool is wired in everywhere the lasso is', () => {
  assert.match(html, /data-tool="rectselect" data-key="Shift\+M"/);
  assert.match(html, /t === 'lasso' \|\| t === 'penselect' \|\| t === 'rectselect';/, 'a drawing tool for palm and pencil-only rules');
  assert.match(html, /if \(t !== 'lasso' && t !== 'penselect' && t !== 'rectselect'\) clearLassoSel\(true\);/, 'switching between the selecting tools keeps the selection');
  assert.match(html, /else if \(e\.shiftKey && k === 'm'\) setTool\('rectselect'\);/);
  const kd = html.slice(html.indexOf("if (e.shiftKey && k === 's') setTool('penselect');"));
  assert(kd.indexOf("setTool('rectselect')") < kd.indexOf('else if (toolKeys[k])'), 'Shift+M is tried before M is read as My PDFs');
  assert.match(html, /selectAnnotationsInPolygon\(p, poly, 'box'\)/, 'the ONE inclusion rule, never a copy');
});
