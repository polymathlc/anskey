/* Loads the REAL mindmap section out of anskey's index.html and runs it against
   stubs. The board is geometry and serialisation, and both fail quietly: a
   connection dropped on the way through JSON just means an arrow that is not
   there any more, and a picture squashed by a resize handle is only noticed by
   eye. Everything below is checked without a browser, up to the wiring — the
   part that needs real DOM and real pointers. */
import fs from 'fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('/* ================= Mindmap =================');
const end = html.indexOf('/* ---- Wiring ---- */', start);
if (start < 0 || end < 0) { console.error('mindmap section not found'); process.exit(1); }
const src = html.slice(start, end);

/* Just enough of the app and of a browser for the section to load. Anything
   that draws is a no-op; anything measured is measured with a fake canvas
   whose glyphs are a flat 0.6 em wide, which is close enough to wrap on. */
const stubEl = () => ({
  style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  addEventListener() {}, appendChild() {}, querySelector: () => null,
  querySelectorAll: () => [], getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  getContext: () => fakeCtx, focus() {}, select() {}, setSelectionRange() {},
  innerHTML: '', value: '', textContent: '', disabled: false,
  setAttribute() {}, getAttribute: () => null, remove() {}, click() {}, files: null
});

/* A canvas that draws nothing and measures every glyph at 0.6 em — close
   enough to the real thing to check that words break and shrink. */
const fakeCtx = {
  _size: 10,
  set font(v) { const m = /(\d+(?:\.\d+)?)px/.exec(String(v)); this._size = m ? parseFloat(m[1]) : 10; },
  get font() { return this._size + 'px'; },
  measureText(s) { return { width: String(s).length * 0.6 * this._size }; }
};
['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'rect',
 'roundRect', 'ellipse', 'arc', 'fillRect', 'strokeRect', 'clearRect', 'clip', 'drawImage',
 'fillText', 'translate', 'scale', 'setTransform', 'setLineDash', 'bezierCurveTo', 'toBlob']
  .forEach((k) => { fakeCtx[k] = () => {}; });

/* A localStorage that really stores, so "the worksheet's own board is not
   clobbered by a board opened from a card" can be checked rather than assumed
   — it was a bare {} before, so every setItem threw into mmFlushBoard's own
   catch and nothing was ever written. */
const storeData = {};
const store = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(storeData, k) ? storeData[k] : null),
  setItem: (k, v) => { storeData[k] = String(v); },
  removeItem: (k) => { delete storeData[k]; }
};
const prelude = `
var currentDocId = 'doc1';
var docName = 'Heat worksheet.pdf';
// Pinning a mindmap to the page and the AI bar are the teacher's own, so the
// section now asks who is here. Nothing below draws a card or calls the model.
function isStudent() { return false; }
function isSharedVisitor() { return false; }
function aiGrounding() { return ''; }
function aiEngineName() { return 'Gemini'; }
var pdfDoc = null, pages = [], annotations = [];
function newAnnId() { return 'a' + (annotations.length + 1); }
function round2(v) { return Math.round(v * 100) / 100; }
function pushUndo() {}
function setDirty() {}
function renderAllOverlays() {}
function _parseAIJson(s) { return JSON.parse(s); }
function $(id) { return STUB_EL(id); }
function toast() {}
function clampWinBox(b) { return b; }
function floatWinViewportH() { return 900; }
function raiseFloatWin() {}
function attachFloatWin() {}
var localStorage = STORE;
var confirm = () => true;
var setTimeout = (fn) => 0;
var clearTimeout = () => {};
var Image = class { set src(v) { this._src = v; this.naturalWidth = 400; this.naturalHeight = 200;
  if (this.onload) this.onload(); } get src() { return this._src; } };
var FileReader = class {};
var document = { createElement: () => STUB_EL(), body: { appendChild() {} }, addEventListener() {},
  querySelectorAll: () => [] };
var window = { devicePixelRatio: 2, innerWidth: 1200, addEventListener() {}, prompt: () => WINDOW_PROMPT,
  open() {}, ResizeObserver: null };
`;

let promptAnswer = '';
const mod = new Function('STUB_EL', 'STORE', 'WINDOW_PROMPT_GET', `
  var WINDOW_PROMPT;
  ${prelude.replace('WINDOW_PROMPT', 'WINDOW_PROMPT_GET()')}
  ${src}
  return { mmBoard, mmDarken, mmBounds, mmCentre, mmCombinedBounds, mmIsShape, mmPointIn,
           mmElementAt, mmHandles, mmHandleAt, mmLinkRect, mmLinkAt, mmConnect, mmPath,
           mmDistToSegment, mmConnectionAt, mmSnap, mmSnapEnd, mmWrap, mmFitText,
           mmSerialise, mmDeserialise, mmPush, mmUndo, mmRedo, mmNewShape, mmResize,
           mmDeleteSelected, mmDuplicate, mmFreeSpot, mmAddChild, mmAddSibling,
           mmApplyToSelection, mmHexOrDefault, mmBoardKey, mmFlushBoard, mmLoadBoard,
           mmAiLayout, mmAiPlace, mmAttachX, mmAttachY, mmRenderToDataUrl,
           attachedId: function () { return mmAttachedId; },
           annotations: function () { return annotations; },
           setAttachedId: function (v) { mmAttachedId = v; },
           reset: function () { mmBoard.el = []; mmBoard.con = []; mmBoard.sel = []; mmBoard.selCon = null;
             mmBoard.zoom = 1; mmBoard.pan = { x: 0, y: 0 }; mmBoard.history = []; mmBoard.hIndex = -1; },
           ctx: function () { return CTX; } };
`.replace('CTX', 'null'))(stubEl, store, () => promptAnswer);

let fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); fails++; }
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 0.001 : tol);

const M = mod;
const box = (x, y, w, h, extra) => Object.assign({
  type: 'rect', x, y, width: w, height: h, fill: '#BAE1FF', stroke: '#5DADE2',
  strokeW: 2, text: '', textColor: '#1A1A1A', fontSize: 15, fontFamily: 'Century Gothic'
}, extra || {});

console.log('\nColours');
ok('a pastel darkens into its own outline', M.mmDarken('#BAE1FF') === '#8dd4ff' || /^#[0-9a-f]{6}$/.test(M.mmDarken('#BAE1FF')));
ok('a colour that is not a hex triple is not mangled', M.mmDarken('transparent') === '#8A8A84');
ok('darkening never goes below black', M.mmDarken('#000000') === '#000000');
ok('a bad colour falls back', M.mmHexOrDefault('transparent', '#1A1A1A') === '#1A1A1A');
ok('a good colour is kept', M.mmHexOrDefault('#FF0000', '#1A1A1A') === '#FF0000');

console.log('\nGeometry');
M.reset();
const a = box(10, 20, 100, 50);
ok('a box knows its own bounds', M.mmBounds(a).width === 100 && M.mmBounds(a).y === 20);
ok('a box knows its middle', M.mmCentre(a).x === 60 && M.mmCentre(a).y === 45);
const line = { type: 'line', x: 100, y: 10, x2: 20, y2: 60 };
ok('a line drawn backwards still has positive bounds',
  M.mmBounds(line).x === 20 && M.mmBounds(line).width === 80);
ok('a line is not a shape', !M.mmIsShape(line) && M.mmIsShape(a));
const combined = M.mmCombinedBounds([a, box(200, 0, 40, 40)]);
ok('several boxes share one outline', combined.left === 10 && combined.right === 240 && combined.top === 0);
ok('nothing selected has no outline', M.mmCombinedBounds([]) === null);

console.log('\nHandles stay the same size on screen, not on the board');
M.reset();
M.mmBoard.el = [a];
M.mmBoard.sel = [a];
M.mmBoard.zoom = 1;
ok('a corner is caught at zoom 1', !!M.mmHandleAt({ x: 10, y: 20 }));
ok('the middle of the box is not a handle', !M.mmHandleAt({ x: 60, y: 45 }));
const grabAt1 = M.mmHandleAt({ x: 10 + 20, y: 20 }); // 20 board px from the corner
M.mmBoard.zoom = 0.25;                                    // zoomed right out: 20 board px is 5 on screen
const grabAtQuarter = M.mmHandleAt({ x: 10 + 20, y: 20 });
ok('zoomed out, the same handle is caught further away on the board',
  !grabAt1 && !!grabAtQuarter, 'grab radius must scale with 1/zoom');
M.mmBoard.zoom = 1;
ok('all eight handles are offered on a box', M.mmHandles(a).length === 8);
ok('a line offers only its two ends', M.mmHandles(line).length === 2);

console.log('\nResizing');
M.reset();
const pic = box(0, 0, 400, 200, { type: 'image', src: 'data:,x', ratio: 2 });
M.mmBoard.el = [pic];
M.mmBoard.sel = [pic];
M.mmResize({ el: pic, handle: { type: 'se' }, start: Object.assign({}, pic) }, { x: 300, y: 300 }, false);
ok('a picture keeps its proportions with no Shift held', near(pic.width / pic.height, 2, 0.01),
  pic.width + '×' + pic.height);
const b2 = box(0, 0, 100, 100);
M.mmBoard.el = [b2]; M.mmBoard.sel = [b2];
M.mmResize({ el: b2, handle: { type: 'se' }, start: Object.assign({}, b2) }, { x: 300, y: 140 }, false);
ok('a box is free to be stretched', b2.width === 300 && b2.height === 140);
const b3 = box(0, 0, 100, 100);
M.mmBoard.el = [b3]; M.mmBoard.sel = [b3];
M.mmResize({ el: b3, handle: { type: 'se' }, start: Object.assign({}, b3) }, { x: 300, y: 140 }, true);
ok('Shift holds a box square', near(b3.width, b3.height, 0.01), b3.width + '×' + b3.height);
const b4 = box(0, 0, 100, 100);
M.mmBoard.el = [b4]; M.mmBoard.sel = [b4];
M.mmResize({ el: b4, handle: { type: 'nw' }, start: Object.assign({}, b4) }, { x: 999, y: 999 }, false);
ok('a box cannot be turned inside out', b4.width >= 24 && b4.height >= 24 && b4.x <= 100);
const b5 = box(0, 0, 100, 100);
M.mmBoard.el = [b5]; M.mmBoard.sel = [b5];
M.mmResize({ el: b5, handle: { type: 'nw' }, start: Object.assign({}, b5) }, { x: -50, y: -50 }, false);
ok('dragging the top-left corner moves the corner, not the box',
  b5.x === -50 && b5.y === -50 && b5.width === 150 && b5.height === 150);

console.log('\nJoining boxes');
M.reset();
const p = box(0, 0, 100, 60), q = box(300, 0, 100, 60);
M.mmBoard.el = [p, q];
M.mmConnect(p, q);
ok('two boxes are joined', M.mmBoard.con.length === 1);
M.mmConnect(p, q);
ok('the same pair is not joined twice', M.mmBoard.con.length === 1);
M.mmConnect(q, p);
ok('nor the other way round', M.mmBoard.con.length === 1);
M.mmConnect(p, p);
ok('a box cannot be joined to itself', M.mmBoard.con.length === 1);
const path = M.mmPath(M.mmBoard.con[0]);
ok('the route leaves the right-hand side and arrives on the left',
  path[0].x === 100 && path[3].x === 300, JSON.stringify([path[0], path[3]]));
ok('the route bends halfway', near(path[1].x, 200) && near(path[2].x, 200));
const below = box(0, 300, 100, 60);
M.mmBoard.el.push(below);
M.mmConnect(p, below);
const vpath = M.mmPath(M.mmBoard.con[1]);
ok('a box underneath is joined top to bottom', vpath[0].y === 60 && vpath[3].y === 300);
M.mmBoard.con[0]._path = path;
ok('the line can be picked up by clicking near it', M.mmConnectionAt({ x: 200, y: 30 }) === M.mmBoard.con[0]);
ok('clicking well away from it picks up nothing', M.mmConnectionAt({ x: 200, y: 250 }) === null);

console.log('\nSnapping');
M.reset();
const still = box(0, 0, 100, 100);
const moving = box(0, 300, 100, 100);
M.mmBoard.el = [still, moving];
let snap = M.mmSnap([moving], 0, -297);   // dropped 3px shy of lining up
ok('a box lines up with the one already there', near(moving.y + snap.dy, 0, 0.01),
  'dy came back ' + snap.dy);
ok('the dashed guide is drawn for it', M.mmBoard.guides.length > 0);
snap = M.mmSnap([moving], 0, -200);       // nowhere near
ok('a box well clear of the others is left alone', snap.dy === -200);
M.reset();
const anchor = box(0, 0, 100, 100);
const joined = box(300, 6, 100, 100);
M.mmBoard.el = [anchor, joined];
M.mmConnect(anchor, joined);
snap = M.mmSnap([joined], 0, 0);
ok('a joined box is pulled square so the arrow comes out straight',
  near(joined.y + snap.dy, 0, 0.01), 'dy came back ' + snap.dy);
ok('that guide is marked as the joining one', M.mmBoard.guides.some(g => g.joined));

console.log('\nStraightening a line');
ok('a nearly level line is levelled', M.mmSnapEnd(0, 0, 100, 5).y === 0);
ok('a nearly upright line is stood up', M.mmSnapEnd(0, 0, 4, 100).x === 0);
ok('a proper diagonal is left as drawn',
  M.mmSnapEnd(0, 0, 100, 100).x === 100 && M.mmSnapEnd(0, 0, 100, 100).y === 100);

console.log('\nWords in a box');
const wrapCtx = fakeCtx;
const lines = M.mmWrap(wrapCtx, 'one two three four five six', 60, 10, 'Arial');
ok('long text is broken over several lines', lines.length > 1, JSON.stringify(lines));
ok('a blank line is kept', M.mmWrap(wrapCtx, 'a\n\nb', 500, 10, 'Arial').length === 3);
const fit = M.mmFitText(wrapCtx, 'a very long sentence that will not fit at all', 100, 30, 20, 10, 'Arial');
ok('the words shrink until they fit', fit.size < 20 && fit.size >= 8, 'landed on ' + fit.size);
ok('the words never shrink past legible', fit.size >= 8);

console.log('\nThe link badge');
M.reset();
const linked = box(0, 0, 200, 100, { link: 'https://example.com' });
const plain = box(0, 200, 200, 100);
M.mmBoard.el = [linked, plain];
const r = M.mmLinkRect(linked);
ok('a box with a link gets a badge', !!r);
ok('the badge sits in the top-right corner', r.x + r.w <= 200 && r.y >= 0 && r.y < 30);
ok('a box with no link gets none', M.mmLinkRect(plain) === null);
ok('the badge can be tapped', M.mmLinkAt({ x: r.x + r.w / 2, y: r.y + r.h / 2 }) === linked);
ok('the middle of the box is not the badge', M.mmLinkAt({ x: 100, y: 50 }) === null);

console.log('\nSaving the board and reading it back');
M.reset();
const s1 = box(0, 0, 100, 60, { text: 'Heat', textColor: '#C62828', link: 'https://a.test' });
const s2 = box(300, 0, 100, 60, { text: 'Expands', fontFamily: 'Patrick Hand' });
M.mmBoard.el = [s1, s2];
M.mmConnect(s1, s2);
M.mmBoard.zoom = 1.4;
M.mmBoard.pan = { x: 12, y: -8 };
const json = JSON.stringify(M.mmSerialise());
ok('the loaded picture objects are left out of the save', !/"img"/.test(json));
M.reset();
M.mmDeserialise(JSON.parse(json));
ok('both boxes come back', M.mmBoard.el.length === 2);
ok('the arrow between them comes back', M.mmBoard.con.length === 1);
ok('the arrow points at the real boxes, not copies',
  M.mmBoard.con[0].from === M.mmBoard.el[0] && M.mmBoard.con[0].to === M.mmBoard.el[1]);
ok('the text colour survives', M.mmBoard.el[0].textColor === '#C62828');
ok('the link survives', M.mmBoard.el[0].link === 'https://a.test');
ok('the font survives', M.mmBoard.el[1].fontFamily === 'Patrick Hand');
ok('the view comes back too', near(M.mmBoard.zoom, 1.4) && M.mmBoard.pan.x === 12);

console.log('\nAn arrow whose box has gone is dropped, never left dangling');
const broken = JSON.parse(json);
broken.el = [broken.el[0]];              // the second box deleted from under it
M.reset();
M.mmDeserialise(broken);
ok('the orphaned arrow is dropped', M.mmBoard.con.length === 0);
ok('the box that is left is kept', M.mmBoard.el.length === 1);

console.log('\nA picture is reloaded from what was saved');
M.reset();
M.mmDeserialise({ el: [box(0, 0, 100, 50, { type: 'image', src: 'data:image/png;base64,AA' })], con: [] });
ok('the picture gets its Image back', !!M.mmBoard.el[0].img);
ok('and it points at what was saved', M.mmBoard.el[0].img.src === 'data:image/png;base64,AA');

console.log('\nUndo and redo');
M.reset();
M.mmBoard.el = [box(0, 0, 100, 50)];
M.mmPush();
M.mmBoard.el.push(box(200, 0, 100, 50));
M.mmPush();
ok('two boxes are on the board', M.mmBoard.el.length === 2);
M.mmUndo();
ok('undo takes the second one off', M.mmBoard.el.length === 1);
M.mmRedo();
ok('redo puts it back', M.mmBoard.el.length === 2);
M.mmUndo();
M.mmBoard.pan = { x: 500, y: 500 };
M.mmUndo();
ok('undo leaves the view where the user put it', M.mmBoard.pan.x === 500);
M.mmUndo();
ok('undo past the beginning does nothing bad', M.mmBoard.el.length >= 0);
M.mmRedo(); M.mmRedo(); M.mmRedo(); M.mmRedo();
ok('redo past the end does nothing bad', M.mmBoard.el.length === 2);

console.log('\nDeleting');
M.reset();
const d1 = box(0, 0, 100, 50), d2 = box(300, 0, 100, 50);
M.mmBoard.el = [d1, d2];
M.mmConnect(d1, d2);
M.mmBoard.sel = [d1];
M.mmDeleteSelected();
ok('the box goes', M.mmBoard.el.length === 1 && M.mmBoard.el[0] === d2);
ok('so does the arrow that hung off it', M.mmBoard.con.length === 0);

console.log('\nDuplicating');
M.reset();
const src1 = box(0, 0, 100, 50, { text: 'copy me', src: 'data:,x' });
M.mmBoard.el = [src1];
M.mmBoard.sel = [src1];
M.mmDuplicate();
ok('there are two of it now', M.mmBoard.el.length === 2);
ok('the copy is offset so it can be seen', M.mmBoard.el[1].x === 22 && M.mmBoard.el[1].y === 22);
ok('the copy carries the words', M.mmBoard.el[1].text === 'copy me');
ok('the copy has its own Image, not the original one', M.mmBoard.el[1].img !== src1.img);

console.log('\nTab and Enter build the map out');
M.reset();
const root = box(0, 0, 120, 60, { text: 'Heat' });
M.mmBoard.el = [root];
M.mmBoard.sel = [root];
M.mmAddChild();
ok('Tab adds a box', M.mmBoard.el.length === 2);
ok('and joins it to the one it came from', M.mmBoard.con.length === 1 && M.mmBoard.con[0].from === root);
ok('the new box sits to the right', M.mmBoard.el[1].x > root.x + root.width);
M.mmBoard.sel = [root];
M.mmAddChild();
ok('a second child stacks under the first', M.mmBoard.el.length === 3 && M.mmBoard.el[2].y > M.mmBoard.el[1].y);
M.mmBoard.sel = [M.mmBoard.el[1]];
M.mmAddSibling();
ok('Enter adds one below', M.mmBoard.el.length === 4);
ok('and hangs it off the same parent',
  M.mmBoard.con.filter(c => c.from === root).length === 3);

console.log('\nA box that is free is found, never dropped on top of another');
M.reset();
M.mmBoard.el = [box(0, 0, 100, 50), box(0, 70, 100, 50)];
const spot = M.mmFreeSpot(0, 0, 100, 50);
ok('the spot found is clear of both', spot.y >= 120, 'landed at y=' + spot.y);

console.log('\nColour changes reach the selection and stick for the next box');
M.reset();
const c1 = box(0, 0, 100, 50), c2 = box(0, 100, 100, 50);
const cpic = box(0, 200, 100, 50, { type: 'image', src: 'data:,x' });
const cline = { type: 'line', x: 0, y: 0, x2: 10, y2: 10, stroke: '#000000' };
M.mmBoard.el = [c1, c2, cpic, cline];
M.mmBoard.sel = [c1, c2, cpic, cline];
M.mmApplyToSelection('textColor', '#C62828', true);
ok('every box takes the new text colour', c1.textColor === '#C62828' && c2.textColor === '#C62828');
ok('a picture has no words to colour', cpic.textColor !== '#C62828');
ok('nor does a line', cline.textColor === undefined);
ok('the next new box is made in that colour', M.mmBoard.textColor === '#C62828');
M.mmApplyToSelection('fill', '#BAFFC9', true);
ok('the box fill changes', c1.fill === '#BAFFC9');
ok('a picture is not filled over', cpic.fill !== '#BAFFC9');
M.mmApplyToSelection('fontSize', 28, true);
ok('the text size changes', c1.fontSize === 28 && M.mmBoard.fontSize === 28);
M.mmApplyToSelection('strokeColor', '#123456', true);
ok('the border colour reaches a line too', cline.stroke === '#123456');

console.log('\nA new box picks up the settings last chosen');
M.reset();
M.mmBoard.textColor = '#2E7D32';
M.mmBoard.fontFamily = 'Patrick Hand';
const fresh = M.mmNewShape('rect', 0, 0, 100, 50);
ok('the text colour carries over', fresh.textColor === '#2E7D32');
ok('the font carries over', fresh.fontFamily === 'Patrick Hand');
const freshText = M.mmNewShape('text', 0, 0, 100, 50);
ok('words on their own come with no box round them',
  freshText.fill === 'transparent' && freshText.strokeW === 0);

console.log('\nThe board is filed under the worksheet it belongs to');
ok('the key names the worksheet', M.mmBoardKey() === 'polymath.mmBoard:doc1');


/* ================= The AI bar's layout =================
   The model returns nodes and links; where they GO is worked out here, in
   code, so the same reply always comes out readable. A model asked for
   coordinates puts boxes on top of each other, and a board nobody can read is
   a board the teacher redraws by hand. */
console.log('\nThe AI lays a map out so it can be read');
{
  const nodes = [{ id: 'c', text: 'Water cycle' }];
  for (let i = 0; i < 8; i++) nodes.push({ id: 'n' + i, text: 'stage ' + i });
  const links = nodes.slice(1).map(n => ({ from: 'c', to: n.id }));
  const lay = mod.mmAiLayout(nodes, links);
  ok('every node is given a place', nodes.every(n => lay.pos[n.id]));
  ok('the centre really is at the centre', Math.abs(lay.pos.c.x + lay.W / 2) < 1 && Math.abs(lay.pos.c.y + lay.H / 2) < 1);
  ok('the centre is ring 0 and its children are ring 1',
     lay.depth.c === 0 && nodes.slice(1).every(n => lay.depth[n.id] === 1));
  /* Two boxes in the same place is the one failure that makes the whole
     feature useless, and it is the one a bigger map causes. */
  const boxes = nodes.map(n => ({ x: lay.pos[n.id].x, y: lay.pos[n.id].y, w: lay.W, h: lay.H }));
  let overlap = 0;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) overlap++;
  }
  ok('no two boxes sit on top of each other', overlap === 0, overlap + ' overlapping pairs');
}
{
  /* Twenty on one ring is where a fixed radius stops working. */
  const nodes = [{ id: 'c', text: 'Centre' }];
  for (let i = 0; i < 20; i++) nodes.push({ id: 'n' + i, text: 'idea ' + i });
  const lay = mod.mmAiLayout(nodes, nodes.slice(1).map(n => ({ from: 'c', to: n.id })));
  const ring = nodes.slice(1).map(n => lay.pos[n.id]);
  let overlap = 0;
  for (let i = 0; i < ring.length; i++) for (let j = i + 1; j < ring.length; j++) {
    if (ring[i].x < ring[j].x + lay.W && ring[i].x + lay.W > ring[j].x &&
        ring[i].y < ring[j].y + lay.H && ring[i].y + lay.H > ring[j].y) overlap++;
  }
  ok('a crowded ring grows rather than piling up', overlap === 0, overlap + ' overlapping pairs');
}
{
  /* A node the model forgot to link is still an idea the teacher asked for. */
  const nodes = [{ id: 'c', text: 'Centre' }, { id: 'a', text: 'linked' }, { id: 'orphan', text: 'forgotten' }];
  const lay = mod.mmAiLayout(nodes, [{ from: 'c', to: 'a' }]);
  ok('an unlinked node is still placed', !!lay.pos.orphan);
  ok('...on a real ring, not on top of the centre', lay.depth.orphan >= 1);
}

console.log('\nThe map becomes real boxes and real arrows');
{
  mod.reset();
  const nodes = [{ id: 'c', text: 'Centre' }, { id: 'a', text: 'One' }, { id: 'b', text: 'Two' }];
  mod.mmAiPlace(nodes, [{ from: 'c', to: 'a' }, { from: 'c', to: 'b' }, { from: 'a', to: 'a' }], false);
  ok('one box per node', mod.mmBoard.el.length === 3);
  ok('the words are in the boxes', mod.mmBoard.el.map(e => e.text).sort().join('|') === 'Centre|One|Two');
  ok('one arrow per link', mod.mmBoard.con.length === 2);
  ok('a node joined to itself is refused', !mod.mmBoard.con.some(c => c.from === c.to));
  ok('the centre is drawn differently from its branches',
     mod.mmBoard.el.filter(e => e.type === 'circle').length === 1);
}
{
  /* "Add to it" must not draw through the teacher's own work. */
  mod.reset();
  mod.mmBoard.el.push(mod.mmNewShape('rect', 0, 0, 120, 60));
  mod.mmBoard.el[0].text = 'mine';
  const before = mod.mmBoard.el[0];
  /* A WIDE map: its ring reaches far to the left of its own centre, which is
     what catches an offset measured from the centre instead of from the
     map's own left edge — half the new map drawn through the teacher's work. */
  const wideNodes = [{ id: 'c', text: 'New' }];
  for (let i = 0; i < 9; i++) wideNodes.push({ id: 'w' + i, text: 'branch ' + i });
  mod.mmAiPlace(wideNodes, wideNodes.slice(1).map(n => ({ from: 'c', to: n.id })), true);
  ok('what was already there is kept', mod.mmBoard.el.indexOf(before) >= 0);
  ok('the new map is added beside it', mod.mmBoard.el.length === 1 + wideNodes.length);
  const added = mod.mmBoard.el.filter(e => e !== before);
  ok('and clear of it, not through it', added.every(e => e.x >= 120),
     'leftmost new box at ' + Math.min.apply(null, added.map(e => e.x)));
  /* ...and building fresh REPLACES, or a second Build stacks two maps. */
  mod.mmAiPlace([{ id: 'c', text: 'Fresh' }], [], false);
  ok('building fresh clears the board first', mod.mmBoard.el.length === 1 && mod.mmBoard.el[0].text === 'Fresh');
}

console.log('\nA pinned card is not silently overwritten by the next one');
{
  mod.setAttachedId('ann-7');
  ok('the card being edited is remembered', mod.attachedId() === 'ann-7');
  /* Loading the worksheet's own board must FORGET it, or the next pin writes
     this board over a card holding a completely different mindmap. */
  mod.mmLoadBoard();
  ok('loading the worksheet board forgets it', mod.attachedId() === null);
}

console.log('\nA board opened from a card is written back to THAT card');
{
  mod.reset();
  mod.setAttachedId(null);
  mod.mmLoadBoard();                       // the worksheet's own board
  mod.mmBoard.el.push(mod.mmNewShape('rect', 0, 0, 100, 50));
  mod.mmBoard.el[0].text = 'the worksheet board';
  mod.mmFlushBoard();
  const worksheetSlot = storeData[mod.mmBoardKey()];
  ok('the worksheet board is remembered on the device', /the worksheet board/.test(worksheetSlot || ''));

  /* Now edit a PINNED card's board. Writing it to the worksheet's own slot
     would quietly destroy the board above — the one silent data loss this
     feature can cause. */
  const card = { id: 'ann-9', type: 'ainote', kind: 'mindmap', mm: null };
  mod.annotations().push(card);
  mod.setAttachedId('ann-9');
  mod.reset();
  mod.mmBoard.el.push(mod.mmNewShape('rect', 0, 0, 100, 50));
  mod.mmBoard.el[0].text = 'the card board';
  mod.mmFlushBoard();
  ok('the card keeps the board it was given', !!card.mm && /the card board/.test(JSON.stringify(card.mm)));
  ok('and the worksheet board is left exactly as it was', storeData[mod.mmBoardKey()] === worksheetSlot);

  /* A card deleted while its board is open must not leave writes with nowhere
     to go — the board becomes an ordinary one again. */
  mod.annotations().length = 0;
  mod.mmFlushBoard();
  ok('a deleted card releases the board', mod.attachedId() === null);
}

console.log('\nA card lands somewhere on the paper, never off the edge');
{
  const page = { num: 1, baseW: 600, baseH: 800, wrap: null };
  const x = mod.mmAttachX(page, 340), y = mod.mmAttachY(page, 240);
  ok('inside the page across', x >= 8 && x + 340 <= 600);
  ok('inside the page down', y >= 8 && y + 240 <= 800);
  const wide = mod.mmAttachX({ baseW: 200, baseH: 800 }, 340);
  ok('a card wider than the page still starts on it', wide >= 8, String(wide));
}

console.log(fails ? '\n' + fails + ' failed\n' : '\nAll passed\n');
process.exit(fails ? 1 : 0);
