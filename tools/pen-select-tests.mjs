/* The Pen select tool, through the REAL pointer handlers, the REAL lasso
   machinery and the REAL shape-snap.js (see tools/pointer-harness.mjs). Every
   failure here is silent in the app — the page still draws and the tool still
   looks selected — so each case is a way the tool could quietly stop being the
   Photoshop pen, or quietly stop being the lasso's own selection:

     · the path is never an annotation (it must not save, undo or print)
     · what it selects is decided by the lasso's ONE rule, not a copy of it
     · an unfinished path never outlives its tool, page, worksheet or account  */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build, cut, html } from './pointer-harness.mjs';
import { rng } from './shape-snap-fixtures.mjs';

function pen() {
  const h = build({ pen: true });
  h.run(`tool = 'penselect';
    function click(x, y, o) { now += 1000; down(x, y, o); return up(x, y, o); }
    function groupNode() { return p.svg.children.find(function (n) { return n.attrs['data-pen-select']; }) || null; }
    function drawn(attr) { var g = groupNode(); return g ? g.children.filter(function (n) { return n.attrs[attr] !== undefined; }) : []; }
    function addStroke(id, pts, extra) { annotations.push(Object.assign({ id: id, page: 1, type: 'pen', color: '#000', width: 2, points: pts }, extra || {})); }
    function box(id, cx, cy, half) { addStroke(id, [{ x: cx - half, y: cy - half }, { x: cx + half, y: cy + half }]); }`);
  return h;
}
const anchors = (c) => (c.penPath ? JSON.parse(JSON.stringify(c.penPath.anchors.map((a) => ({ x: a.x, y: a.y })))) : null);
const plain = (v) => JSON.parse(JSON.stringify(v));
const ids = (c) => (c.lassoSel ? [...c.lassoSel.ids].sort() : null);

/* ---------- placing points ---------- */
test('a click places a corner point, and the path is drawn on the page overlay', () => {
  const { c, run } = pen();
  run('click(100, 100);');
  assert.deepEqual(anchors(c), [{ x: 100, y: 100 }]);
  assert.equal(c.penPath.anchors[0].hin, undefined, 'a plain click is a corner: no handles');
  assert.equal(c.p.svg.capture, 1, 'the page holds the pointer for the press');
  const g = run('groupNode()');
  assert(g, 'a preview group is on the overlay');
  assert.equal(run("drawn('data-pen-anchor').length"), 1);
  assert.equal(g.attrs['pointer-events'], 'none', 'the preview never takes a press itself');
  assert.equal(g.attrs['data-id'], undefined, 'no data-id: nothing else mistakes it for an annotation');
});

test('click and drag pulls a smooth point out with symmetric handles', () => {
  const { c, run } = pen();
  run('now += 1000; down(200, 200); move(240, 170); move(260, 150); up(260, 150);');
  const a = c.penPath.anchors[0];
  assert.deepEqual({ x: a.hout.x, y: a.hout.y }, { x: 260, y: 150 }, 'the outgoing handle follows the pen');
  assert.deepEqual({ x: a.hin.x, y: a.hin.y }, { x: 140, y: 250 }, 'the incoming handle is its mirror image');
  assert.equal(run("drawn('data-pen-handle').length"), 2);
});

test('a press that only wobbles does not turn into a curve', () => {
  const { c, run } = pen();
  run('now += 1000; down(200, 200); move(202, 201); up(202, 201);');
  assert.equal(c.penPath.anchors[0].hout, undefined, 'a 2px tremor is a click, not a drag');
});

test('Shift keeps each new point level, upright or at 45 degrees from the last', () => {
  const { c, run } = pen();
  run('click(100, 100); click(300, 110, { shiftKey: true });');
  assert.deepEqual(plain(c.penPath.anchors[1]), { x: 300, y: 100 }, 'nearly level → level');
  run('click(308, 330, { shiftKey: true });');
  assert.deepEqual(plain(c.penPath.anchors[2]), { x: 300, y: 330 }, 'nearly upright → upright');
  run('click(420, 400, { shiftKey: true });');
  const a = c.penPath.anchors[3];
  assert.equal(Math.round((a.x - 300) * 100) / 100, Math.round((a.y - 330) * 100) / 100, '≈45° → exactly 45°');
  run('click(500, 500);');
  assert.deepEqual(plain(c.penPath.anchors[4]), { x: 500, y: 500 }, 'without Shift the point goes exactly where it was clicked');
});

test('Shift while dragging a handle constrains it to 45 degree steps', () => {
  const { c, run } = pen();
  run('now += 1000; down(200, 200); move(300, 215, { shiftKey: true }); up(300, 215, { shiftKey: true });');
  const h = c.penPath.anchors[0].hout;
  assert.deepEqual({ x: h.x, y: h.y }, { x: 300, y: 200 });
});

/* ---------- the preview ---------- */
test('between clicks a rubber band follows the pointer from the last point', () => {
  const { c, run } = pen();
  run('click(100, 100); click(300, 100);');
  assert.equal(run("drawn('data-pen-rubber').length"), 0, 'nothing to stretch until the pointer moves');
  run('move(320, 260);');
  const rb = run("drawn('data-pen-rubber')");
  assert.equal(rb.length, 1);
  assert.match(rb[0].attrs.d, /^M 300 100 L 320 260/, 'from the last point to the pointer');
  assert.equal(c.penPath.drag, null);
});

test('the pointer near the first point shows the close cue, and only then', () => {
  const { c, run } = pen();
  run('click(100, 100); click(300, 100); click(300, 300);');
  run('move(160, 160);');
  assert.equal(run("drawn('data-pen-close').length"), 0);
  run('move(104, 103);');
  assert.equal(run("drawn('data-pen-close').length"), 1, 'within ~8 screen pixels of the first point');
  run('move(130, 100);');
  assert.equal(run("drawn('data-pen-close').length"), 0);
});

test('a finger has no hover: moving one over the path does not drag a rubber band', () => {
  const { c, run } = pen();
  run('click(100, 100);');
  run(`stylusOnly = false; pointer('pointermove', Object.assign(at(300, 300), { pointerType: 'touch', pointerId: 7 }));`);
  assert.equal(c.penPath.cursor.x, 100, 'the cursor stayed on the last point');
});

test('everything the pen draws is sized in screen pixels, so zoom does not change how it feels', () => {
  const { c, run } = pen();
  run('rectW = 1200; rectH = 1600; click(100, 100);');      // zoomed in 2×: one screen pixel is half a unit
  const sq = run("drawn('data-pen-anchor')[0]");
  assert(Math.abs(sq.attrs.width - 7.2 * 0.5) < 1e-9, `anchor square ${sq.attrs.width}`);
  run('rectW = 300; rectH = 400; penSelectRedraw();');       // zoomed out
  const sq2 = run("drawn('data-pen-anchor')[0]");
  assert(Math.abs(sq2.attrs.width - 7.2 * 2) < 1e-9);
});

test('a re-render of the overlay does not lose the path', () => {
  const { c, run } = pen();
  run('click(100, 100); click(300, 100);');
  run('renderAllOverlays();');
  assert.equal(run("drawn('data-pen-anchor').length"), 2);
  assert.equal(c.penPath.anchors.length, 2);
});

/* ---------- closing ---------- */
const TRIANGLE = 'click(100, 100); click(300, 100); click(300, 300);';
function strokes(run) {
  run(`box('in', 255, 155, 5); box('out', 150, 250, 5);`);
}

test('clicking the first point closes the path and selects what is inside', () => {
  const { c, run } = pen();
  strokes(run);
  run(TRIANGLE + ' now += 1000; down(101, 101); up(101, 101);');
  assert.equal(c.penPath, null, 'the path is finished');
  assert.deepEqual(ids(c), ['in']);
  assert.equal(c.tool, 'penselect', 'the tool stays in hand');
  assert.equal(c.$('lassoBar').style.display, 'flex', 'the lasso bar is up');
  assert.equal(run("groupNode()"), null, 'the preview came off the page');
  assert.equal(c.p.svg.children.filter((n) => n.attrs['data-id']).length, 2);
});

test('Enter closes and selects too', () => {
  const { c, run } = pen();
  strokes(run);
  run(TRIANGLE);
  const e = run("key('Enter')");
  assert(e && e.prevented, 'Enter was taken and kept from the browser');
  assert.equal(c.penPath, null);
  assert.deepEqual(ids(c), ['in']);
});

test('a double-click closes and selects, and does not add a duplicate point', () => {
  const { c, run } = pen();
  strokes(run);
  run('click(100, 100); click(300, 100); now += 1000; down(300, 300); up(300, 300); now += 100; down(300, 300); up(300, 300);');
  assert.equal(c.penPath, null);
  assert.deepEqual(ids(c), ['in']);
});

test('two presses that are too far apart, or too slow, are not a double-click', () => {
  const { c, run } = pen();
  run('click(100, 100); now += 100; down(130, 100); up(130, 100);');
  assert.equal(c.penPath.anchors.length, 2, 'a quick second press elsewhere is just another point');
  run('now += 1000; down(300, 300); up(300, 300); now += 900; down(300, 300); up(300, 300);');
  assert.notEqual(c.penPath, null);
});

test('closing selects exactly what the freehand lasso would, by the lasso’s own rule', () => {
  // Same polygon, same pile of ink, two tools. If the pen ever grows a rule of
  // its own, one of these seeds will tell them apart.
  for (let seed = 1; seed <= 12; seed++) {
    const r = rng(seed * 101);
    const poly = Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * Math.PI * 2, rad = 120 + r() * 120;
      return { x: Math.round(300 + Math.cos(a) * rad), y: Math.round(400 + Math.sin(a) * rad) };
    });
    const strokes = Array.from({ length: 40 }, (_, i) => {
      const x = 30 + r() * 540, y = 30 + r() * 740, w = 4 + r() * 60, h = 4 + r() * 60;
      return { id: 's' + i, pts: [{ x, y }, { x: x + w, y: y + h }] };
    });
    const setup = `annotations.length = 0; lassoSel = null; ${strokes.map((s) => `addStroke('${s.id}', ${JSON.stringify(s.pts)});`).join(' ')}`;
    const a = pen(), b = pen();
    a.run(setup + ' tool = "lasso"; now += 1000; down(' + poly[0].x + ',' + poly[0].y + ');'
      + poly.slice(1).map((q) => `move(${q.x},${q.y});`).join('') + 'up(' + poly[5].x + ',' + poly[5].y + ');');
    b.run(setup + ' tool = "penselect";' + poly.map((q) => `click(${q.x},${q.y});`).join('') + ' key("Enter");');
    assert.deepEqual(ids(b.c), ids(a.c), `seed ${seed}: pen and lasso disagree`);
    assert(ids(a.c) && ids(a.c).length > 0, `seed ${seed}: the fixture selected nothing, which proves nothing`);
  }
});

test('the rule is the lasso’s: a box is in when its CENTRE is, a locked picture is never in, a group comes whole', () => {
  const { c, run } = pen();
  run(`box('centreIn', 200, 160, 70);                       // sticks out of the path but its centre is inside
       box('centreOut', 200, 50, 80);                       // overlaps the path but its centre is outside
       addStroke('locked', [{ x: 190, y: 190 }, { x: 210, y: 210 }], { locked: true });
       box('mate', 700, 700, 5); annotations.find(a => a.id === 'mate').grp = 'g1';
       box('member', 220, 220, 5); annotations.find(a => a.id === 'member').grp = 'g1';
       addStroke('otherPage', [{ x: 200, y: 200 }, { x: 210, y: 210 }]); annotations.find(a => a.id === 'otherPage').page = 2;`);
  run('click(100, 100); click(400, 100); click(400, 400); click(100, 400); key("Enter");');
  assert.deepEqual(ids(c), ['centreIn', 'member', 'mate'].sort());
});

test('a curved path selects by its CURVE: two dragged points make a lens', () => {
  const { c, run } = pen();
  run(`box('top', 200, 140, 4); box('above', 200, 100, 4); box('mid', 200, 200, 4); box('below', 200, 300, 4);`);
  run('now += 1000; down(100, 200); move(100, 100); up(100, 100); now += 1000; down(300, 200); move(300, 300); up(300, 300);');
  assert.equal(c.penPath.anchors.length, 2);
  run('key("Enter");');
  assert.equal(c.penPath, null, 'two curved points enclose an area, so they close');
  assert.deepEqual(ids(c), ['mid', 'top']);
});

test('the path is never an annotation: nothing is saved, undone or printed because of it', () => {
  const { c, run } = pen();
  strokes(run);
  const before = JSON.stringify(c.annotations);
  run(TRIANGLE + ' key("Enter");');
  assert.equal(JSON.stringify(c.annotations), before, 'the annotations are exactly what they were');
  assert.equal(c.undoCount, 0, 'selecting is not an edit');
  assert.equal(c.undoStack.length, 0);
});

test('fewer than three points is refused in words, and the path is kept', () => {
  const { c, run } = pen();
  run('click(100, 100); click(300, 300);');
  const e = run('key("Enter")');
  assert(e, 'Enter is still taken');
  assert.notEqual(c.penPath, null);
  assert.equal(c.penPath.anchors.length, 2);
  assert.match(c.toasts.at(-1), /at least three points/);
  assert.equal(c.lassoSel, null);
});

test('three points that enclose no area are refused too', () => {
  const { c, run } = pen();
  run('click(100, 100); click(200, 100); click(300, 100); key("Enter");');
  assert.notEqual(c.penPath, null);
  assert.match(c.toasts.at(-1), /enclose no area/);
});

test('a path that selects nothing is kept so it can be mended, and says so', () => {
  const { c, run } = pen();
  run(TRIANGLE + ' key("Enter");');
  assert.notEqual(c.penPath, null, 'eight careful points are not thrown away for a near miss');
  assert.equal(c.penPath.anchors.length, 3);
  assert.match(c.toasts.at(-1), /Nothing inside the path/);
  assert(run("groupNode()"), 'and it is drawn again');
  run(`box('now', 250, 150, 4); key("Enter");`);
  assert.deepEqual(ids(c), ['now']);
});

/* ---------- Esc, Backspace, undo ---------- */
test('Esc cancels: the preview goes and nothing is selected', () => {
  const { c, run } = pen();
  strokes(run);
  run('click(100, 100); click(300, 100); click(300, 300);');
  const e = run('key("Escape")');
  assert(e && e.prevented);
  assert.equal(c.penPath, null);
  assert.equal(run('groupNode()'), null);
  assert.equal(c.lassoSel, null);
});

test('Backspace and Delete take the last point back, and the last one of all cancels the path', () => {
  const { c, run } = pen();
  run('click(100, 100); click(300, 100); click(300, 300);');
  run('key("Backspace");');
  assert.deepEqual(anchors(c), [{ x: 100, y: 100 }, { x: 300, y: 100 }]);
  run('key("Delete");');
  assert.deepEqual(anchors(c), [{ x: 100, y: 100 }]);
  assert.equal(run("drawn('data-pen-anchor').length"), 1);
  run('key("Backspace");');
  assert.equal(c.penPath, null);
  assert.equal(run('groupNode()'), null);
});

test('Ctrl+Z steps the path back rather than undoing the worksheet underneath it', () => {
  const { c, run } = pen();
  run('click(100, 100); click(300, 100);');
  const e = run('key("z", { ctrlKey: true })');
  assert(e && e.prevented);
  assert.equal(c.penPath.anchors.length, 1);
  assert.equal(c.undoCount, 0, 'the document’s own undo did not run');
  assert.equal(run('key("z", { ctrlKey: true, shiftKey: true })'), null, 'redo is left to the page');
});

test('with no path open the pen takes no keys at all', () => {
  const { c, run } = pen();
  for (const k of ['Enter', 'Escape', 'Backspace', 'Delete']) assert.equal(run(`key(${JSON.stringify(k)})`), null, k);
  run('click(100, 100);');
  assert.equal(run('key("a")'), null, 'letters belong to the tool shortcuts');
  assert.equal(run('key("Enter", { altKey: true })'), null, 'Alt+Enter is not ours');
});

/* ---------- grabbing a point or a handle while the path is open ---------- */
test('pressing an existing point drags THAT point — it never adds one', () => {
  const { c, run } = pen();
  run('click(100, 100); click(300, 100); click(300, 300);');
  run('now += 1000; down(301, 101); move(350, 120); up(350, 120);');
  assert.equal(c.penPath.anchors.length, 3);
  assert.deepEqual(anchors(c)[1], { x: 349, y: 119 });
});

test('a point is grabbed from nine SCREEN pixels away, at any zoom', () => {
  let t = pen();
  t.run('click(100, 100); click(300, 100); now += 1000; down(300, 108); up(300, 108);');   // 8 px below B at 100%
  assert.equal(t.c.penPath.anchors.length, 2, 'inside the radius: grabbed, no new point');
  t = pen();
  t.run('click(100, 100); click(300, 100); now += 1000; down(300, 112); up(300, 112);');   // 12 px
  assert.equal(t.c.penPath.anchors.length, 3, 'outside the radius: a new point');
  t = pen();
  t.run('rectW = 1200; rectH = 1600; click(100, 100); click(300, 100); now += 1000; down(300, 108); up(300, 108);');   // 8 units = 16 px at 200%
  assert.equal(t.c.penPath.anchors.length, 3, 'zoomed in, the same page distance is further than the radius');
});

test('dragging a handle moves it and mirrors the other; Alt breaks the pair for good', () => {
  const { c, run } = pen();
  run('now += 1000; down(200, 200); move(260, 200); up(260, 200); click(400, 400);');
  const a = () => c.penPath.anchors[0];
  run('now += 1000; down(260, 200); move(260, 140); up(260, 140);');
  assert.deepEqual({ x: a().hout.x, y: a().hout.y }, { x: 260, y: 140 });
  assert.deepEqual({ x: a().hin.x, y: a().hin.y }, { x: 140, y: 260 }, 'the other handle mirrors it');
  run('now += 1000; down(260, 140, { altKey: true }); move(330, 150, { altKey: true }); up(330, 150, { altKey: true });');
  assert.deepEqual({ x: a().hout.x, y: a().hout.y }, { x: 330, y: 150 });
  assert.deepEqual({ x: a().hin.x, y: a().hin.y }, { x: 140, y: 260 }, 'Alt moved this handle alone');
  assert.equal(a().sym, false);
  run('now += 1000; down(140, 260); move(150, 300); up(150, 300);');
  assert.deepEqual({ x: a().hout.x, y: a().hout.y }, { x: 330, y: 150 }, 'and it stays independent afterwards');
});

test('moving a point carries its handles with it', () => {
  const { c, run } = pen();
  run('now += 1000; down(200, 200); move(260, 200); up(260, 200); click(400, 400);');
  run('now += 1000; down(200, 200); move(250, 260); up(250, 260);');
  const a = c.penPath.anchors[0];
  assert.deepEqual({ x: a.x, y: a.y }, { x: 250, y: 260 });
  assert.deepEqual({ x: a.hout.x, y: a.hout.y }, { x: 310, y: 260 });
  assert.deepEqual({ x: a.hin.x, y: a.hin.y }, { x: 190, y: 260 });
});

test('a press on the first point is a click that closes — or, if it travels, a drag that moves it', () => {
  const { c, run } = pen();
  strokes(run);
  run(TRIANGLE + ' now += 1000; down(100, 100); move(110, 110); move(120, 120); up(120, 120);');
  assert.notEqual(c.penPath, null, 'dragging the first point does not close the path');
  assert.deepEqual(anchors(c)[0], { x: 120, y: 120 });
  run('now += 1000; down(121, 121); up(121, 121);');
  assert.equal(c.penPath, null, 'a plain press on it does');
  assert(c.lassoSel);
});

test('an interrupted press ends the drag and keeps the points already placed', () => {
  const { c, run } = pen();
  run('click(100, 100); now += 1000; down(300, 100); move(340, 60);');
  run(`pointer('pointercancel', { clientX: 0, clientY: 0 });`);
  assert.equal(c.penPath.anchors.length, 2);
  assert.equal(c.penPath.drag, null);
  assert.equal(c.activePointerId, null);
  run('now += 1000; down(300, 300); move(330, 300); pointer("lostpointercapture"); ');
  assert.equal(c.penPath.drag, null, 'lost capture ends the drag too');
  assert.equal(c.penPath.anchors.length, 3);
});

/* ---------- after the selection it is the lasso's ---------- */
test('once selected, the lasso’s own move works from the pen tool, as one undo step', () => {
  const { c, run } = pen();
  strokes(run);
  run(TRIANGLE + ' key("Enter");');
  assert.deepEqual(ids(c), ['in']);
  const start = JSON.parse(JSON.stringify(c.annotations[0].points));
  run('now += 1000; down(255, 155); move(275, 175); move(305, 205); up(305, 205);');
  assert.equal(c.penPath, null, 'a press inside the selection moves it; it does not start a path');
  const moved = c.annotations.find((a) => a.id === 'in').points;
  const dx = moved[0].x - start[0].x, dy = moved[0].y - start[0].y;
  assert(dx > 40 && dy > 40, 'it moved');
  assert(moved.every((q, i) => q.x - start[i].x === dx && q.y - start[i].y === dy), 'every point moved by the same amount');
  assert.equal(c.undoCount, 1, 'one undo step for the whole move');
});

test('a press outside the selection starts a fresh path and lets the old selection go', () => {
  const { c, run } = pen();
  strokes(run);
  run(TRIANGLE + ' key("Enter");');
  assert(c.lassoSel);
  run('now += 1000; down(500, 600); up(500, 600);');
  assert.equal(c.lassoSel, null);
  assert.deepEqual(anchors(c), [{ x: 500, y: 600 }]);
});

test('moving from the lasso to the pen keeps the selection; any other tool lets it go', () => {
  // setTool is the real one; only what it reaches for is stubbed.
  const { c, run } = pen();
  run(`var toolStyles = {}; function saveToolStyles() {} function syncStyleControls() {} function commitActiveTextEdit() {} function updateToolCursor() {}
       function laserHintShownStub() {} var laserHintShown = true; document.querySelectorAll = function () { return []; };`);
  vm.runInContext(cut('function setTool(t) {', 'function updateToolCursor() {'), c);
  strokes(run);
  run(TRIANGLE + ' key("Enter");');
  assert(c.lassoSel);
  run(`setTool('lasso');`);
  assert(c.lassoSel, 'pen → lasso keeps what was selected');
  run(`setTool('penselect');`);
  assert(c.lassoSel, 'lasso → pen too');
  run(`setTool('pen');`);
  assert.equal(c.lassoSel, null, 'any other tool lets it go');
});

/* ---------- an unfinished path never outlives what it belongs to ---------- */
test('switching tools cancels an unfinished path', () => {
  const { c, run } = pen();
  run(`var toolStyles = {}; function saveToolStyles() {} function syncStyleControls() {} function commitActiveTextEdit() {} function updateToolCursor() {}
       var laserHintShown = true; document.querySelectorAll = function () { return []; };`);
  vm.runInContext(cut('function setTool(t) {', 'function updateToolCursor() {'), c);
  run('click(100, 100); click(300, 100); setTool("pen");');
  assert.equal(c.penPath, null);
  assert.equal(run('groupNode()'), null, 'and the preview is gone from the page');
  run('setTool("penselect"); click(100, 100); setTool("penselect");');
  assert.notEqual(c.penPath, null, 'choosing the pen again while it is in hand leaves the path alone');
});

test('a press on another page starts a new path there and drops the old one', () => {
  const { c, run } = pen();
  run(`var p2 = { num: 2, baseW: 600, baseH: 800, svg: new Node('svg'), wrap: new Node('wrap') }; pages.push(p2); attachOverlayHandlers(p2);`);
  run('click(100, 100); click(300, 100);');
  const first = c.penPath.page;
  run(`now += 1000; pointer('pointerdown', Object.assign(at(50, 50), { page: p2 })); pointer('pointerup', Object.assign(at(50, 50), { page: p2 }));`);
  assert.notEqual(c.penPath.page, first);
  assert.equal(c.penPath.page.num, 2);
  assert.deepEqual(anchors(c), [{ x: 50, y: 50 }]);
  assert.equal(run('groupNode()'), null, 'page 1 no longer carries the old preview');
  assert(c.p2.svg.children.some((n) => n.attrs['data-pen-select']));
});

test('suspendPointerInput — a lost window, a new worksheet, a role change — cancels the path', () => {
  let t = pen();
  t.run('click(100, 100); click(300, 100); suspendPointerInput();');
  assert.equal(t.c.penPath, null);
  assert.equal(t.run('groupNode()'), null);
  t = pen();
  t.run('click(100, 100); window.emit("blur", {});');
  assert.equal(t.c.penPath, null, 'the window losing focus is the same thing');
  // Every route that changes the worksheet or the account goes through one of
  // these four, so each must let the path go. The harness cannot run them whole.
  const src = html;
  assert.match(cut('async function loadPdf(', '/* ================= ONE page builder'), /suspendPointerInput\(\);/, 'opening a worksheet suspends input');
  assert.match(cut('async function buildPagesFromBytes(', '/* ================= ➕ A BLANK PAGE'), /penSelectCancel\(\)/, 'every page object is replaced, so the path goes');
  assert.match(cut('function applyRoleUI() {', 'async function signIn() {'), /penSelectCancel\(\)/, 'a role or account change drops it');
  assert.match(cut('function suspendPointerInput() {', 'window.addEventListener(\'blur\', suspendPointerInput)'), /penSelectCancel\(\)/);
});

test('an unfinished press that never ended is swept away without losing the placed points', () => {
  const { c, run } = pen();
  run('click(100, 100); now += 1000; down(300, 100); move(340, 60);');
  assert(c.penPath.drag);
  run('cancelStaleGesture();');
  assert.equal(c.penPath.drag, null);
  assert.equal(c.penPath.anchors.length, 2);
});

/* ---------- who can use it, and how a hand is treated ---------- */
test('gated exactly like the lasso: a student who is only reading gets nothing, a practising one gets the tool', () => {
  let t = pen();
  t.run('isStudent = function () { return true; }; click(100, 100);');
  assert.equal(t.c.penPath, null, 'a reading-only student never starts a path');
  t = pen();
  t.run('isStudent = function () { return true; }; practiceMode = true; click(100, 100);');
  assert.notEqual(t.c.penPath, null, 'a practising student has the lasso, so the pen as well');
});

test('in pencil-only mode a finger pans the page instead of placing a point', () => {
  const { c, run } = pen();
  run(`pointer('pointerdown', Object.assign(at(100, 100), { pointerType: 'touch', pointerId: 5 }));`);
  assert.equal(c.penPath, null);
  run(`stylusOnly = false; pointer('pointerup', Object.assign(at(100, 100), { pointerType: 'touch', pointerId: 5 })); now += 1000;
       pointer('pointerdown', Object.assign(at(100, 100), { pointerType: 'touch', pointerId: 6 }));`);
  assert.notEqual(c.penPath, null, 'with finger drawing switched on it is a pen like any other');
});

test('a resting palm cannot place a point', () => {
  const { c, run } = pen();
  run(`stylusOnly = false; pointer('pointerdown', Object.assign(at(100, 100), { pointerType: 'touch', pointerId: 5, width: 90 }));`);
  assert.equal(c.penPath, null);
});

test('a second pointer cannot hijack the press in progress', () => {
  const { c, run } = pen();
  run('click(100, 100); now += 1000; down(300, 100);');
  run(`pointer('pointerdown', Object.assign(at(400, 400), { pointerId: 9, pointerType: 'touch' }));`);
  assert.equal(c.penPath.anchors.length, 2);
  assert.equal(c.activePointerId, 1);
});

test('a barrel-button press mid-path places nothing', () => {
  const { c, run } = pen();
  run('click(100, 100);');
  run(`pointer('pointerdown', Object.assign(at(300, 300), { button: 2, buttons: 3 }));`);
  assert.equal(c.penPath.anchors.length, 1);
});

test('a card’s grip, a video pill and the double-click handler leave the pen alone', () => {
  const src = html;
  assert.match(src, /tool !== 'eraser' && tool !== 'lasso' && tool !== 'penselect'\) \{/, 'a card heading is not grabbed while placing a point');
  assert.match(src, /tool === 'select' \|\| tool === 'lasso' \|\| tool === 'penselect' \|\| tool === 'eraser'/, 'a video pill does not eat the click');
  const { c, run } = pen();
  run(`annotations.push({ id: 'ink', page: 1, type: 'pen', points: [{x:1,y:1},{x:2,y:2}] }); var inkNode = new Node('g'); inkNode.setAttribute('data-id', 'ink');
       p.svg.emit('dblclick', { type: 'dblclick', target: inkNode, preventDefault: function(){} });`);
  assert.equal(c.editModeId, null, 'a double-click never opens edit mode while a drawing tool is in hand');
});

test('without shape-snap.js the tool says so instead of silently doing nothing', () => {
  const h = build({ pen: true, lib: false });
  h.run(`tool = 'penselect'; now += 1000; down(100, 100); up(100, 100);`);
  assert.equal(h.c.penPath, null);
  assert.match(h.c.toasts.at(-1), /shape-snap\.js/);
});

/* ---------- wiring: every place a tool is enumerated ---------- */
test('the tool is wired in everywhere the lasso is', () => {
  assert.match(html, /function isDrawTool\(t\) \{[\s\S]{0,400}t === 'lasso' \|\| t === 'penselect';/);
  assert.match(html, /data-tool="penselect" data-key="Shift\+S"/);
  const menu = cut('<div id="selectionToolItems">', '<button class="toolbarMenuItem" type="button" id="expandToolsBtn"');
  assert(menu.includes('data-tool="penselect"'), 'it is in the Tools menu beside the lasso, so it travels with the expanded toolbar');
  assert.match(html, /selectionLabels = \{[^}]*penselect: 'Pen select'/);
  assert.match(html, /if \(t !== 'lasso' && t !== 'penselect'\) clearLassoSel\(true\);/);
  assert.match(html, /if \(t !== 'penselect' && typeof penSelectCancel === 'function'\) penSelectCancel\(\);/);
  assert.match(html, /if \(e\.shiftKey && k === 's'\) setTool\('penselect'\);/);
  assert(/'penselect'/.test(html) && !/TOOL_STYLE_DEFAULTS = \{[^}]*penselect/.test(html), 'it selects, it does not draw: no ink style of its own');
});

test('the pen path owns Enter, Esc, Backspace and undo BEFORE the lasso selection and the page shortcuts see them', () => {
  const kd = cut("document.addEventListener('keydown', function (e) {\n  var ae = document.activeElement;", '/* ================= Toolbar tooltips');
  const pen = kd.indexOf('penSelectKey(e)) return;');
  assert(pen > 0, 'the keyboard handler asks the pen first');
  assert(pen < kd.indexOf('if (isStudent() && !practiceMode) {'), '…ahead of the student branch, so a practising student can finish a path');
  assert(pen < kd.indexOf("if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')"), '…and ahead of undo');
  assert(pen < kd.indexOf("if (e.key === 'Delete' || e.key === 'Backspace')"), '…and ahead of Delete, which would delete the SELECTION');
  assert(pen < kd.indexOf("if (e.key === 'Escape') { drawing = null;"), '…and ahead of the general Escape');
});

test('Shift+S is the shortcut, because every letter is taken', () => {
  const kd = cut("document.addEventListener('keydown', function (e) {\n  var ae = document.activeElement;", '/* ================= Toolbar tooltips');
  const toolKeys = /var toolKeys = \{([^}]*)\}/.exec(kd)[1];
  const uiKeys = /var uiKeys = \{([^}]*)\}/.exec(kd)[1];
  const used = new Set([...toolKeys.matchAll(/(\w): '/g)].map((m) => m[1]).concat([...uiKeys.matchAll(/(\w): '/g)].map((m) => m[1])));
  const free = 'abcdefghijklmnopqrstuvwxyz'.split('').filter((l) => !used.has(l));
  assert.deepEqual(free, [], `a free letter appeared (${free.join('')}) — Pen select could have a plain key now`);
  assert(kd.indexOf("if (e.shiftKey && k === 's') setTool('penselect');") < kd.indexOf('else if (toolKeys[k])'), 'Shift+S is tried before S is read as the lasso');
});
