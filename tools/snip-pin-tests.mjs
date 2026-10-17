/* 📸 SNIP AND PIN — the geometry, run, and the rules, read off the file.

   Every failure here is quiet. A corner whose drag is measured on the wrong
   axis does nothing; a snip cropped from the wrong part of a page pins the
   question above the answer; a pin left on screen for a student is the
   answer key handed over. The pure block is cut out of index.html and RUN;
   the role rules are checked against the file itself. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function cut(from, to) {
  const a = html.indexOf(from), b = html.indexOf(to, a);
  assert.ok(a >= 0 && b > a, 'section not found: ' + from);
  return html.slice(a, b);
}
const consts = cut('var SNIP_STORE', '/* ---- 📸 Snip pure (start) ---- */');
const pure = cut('/* ---- 📸 Snip pure (start) ---- */', '/* ---- 📸 Snip pure (end) ---- */');
const ctx = vm.createContext({ Math, Date, String, isFinite });
vm.runInContext(consts.replace(/^var snipPins[^\n]*\n|^var snipLayerOn[^\n]*\n/gm, '') + pure, ctx);
const S = (name) => ctx[name];

test('a drag in any direction is the same rectangle', () => {
  assert.deepEqual({ ...S('snipNormRect')(50, 80, 10, 20) }, { x: 10, y: 20, w: 40, h: 60 });
  assert.deepEqual({ ...S('snipNormRect')(10, 20, 50, 80) }, { x: 10, y: 20, w: 40, h: 60 });
});

test('a snip is cropped from exactly the part of the page under it', () => {
  // A 600 × 800 page drawn at half size, 100 px from the left of the screen.
  const page = { x: 100, y: 50, w: 300, h: 400 };
  const part = S('snipPagePart')({ x: 150, y: 100, w: 100, h: 50 }, page, 600, 800);
  assert.deepEqual({ ...part.src }, { x: 100, y: 100, w: 200, h: 100 });
  assert.deepEqual({ ...part.dst }, { x: 0, y: 0, w: 100, h: 50 });
});

test('a snip hanging over the edge of a page takes only the page', () => {
  const page = { x: 100, y: 50, w: 300, h: 400 };
  const part = S('snipPagePart')({ x: 80, y: 420, w: 100, h: 80 }, page, 300, 400);
  assert.deepEqual({ ...part.dst }, { x: 20, y: 0, w: 80, h: 30 });
  assert.deepEqual({ ...part.src }, { x: 0, y: 370, w: 80, h: 30 });
  assert.equal(S('snipPagePart')({ x: 0, y: 0, w: 50, h: 40 }, page, 300, 400), null);
});

test('the picture is sharp enough to enlarge, and capped', () => {
  assert.equal(S('snipOutScale')(300, 200, 1), 2);
  assert.equal(S('snipOutScale')(300, 200, 3), 3);
  const k = S('snipOutScale')(1800, 900, 2);
  assert.ok(1800 * k <= S('SNIP_OUT_MAX_PX') + 1e-9);
});

test('a corner drag scales along the diagonal and no corner is dead', () => {
  const resize = S('snipResizeW');
  // A wide 4 : 1 snip pulled straight left along its long edge must shrink.
  assert.ok(resize(400, 4, -80, 0) < 400 - 50);
  // …and pulled straight down, it must grow.
  assert.ok(resize(400, 4, 0, 40) > 400);
  // Exact on a true diagonal drag.
  assert.ok(Math.abs(resize(400, 2, 40, 20) - 440) < 1e-9);
});

test('the window keeps its shape and stays on screen', () => {
  const clamp = S('snipClampBox'), H = S('SNIP_HEAD_H'), MIN = S('SNIP_MIN_W');
  const b = clamp({ x: 5000, y: -40, w: 5000 }, 2, 1200, 800);
  assert.ok(b.x + b.w <= 1200 - 8 && b.y >= 8);
  assert.ok(H + b.w / 2 <= 800 - 16 + 1, 'body height fits: ' + b.w);
  assert.equal(clamp({ x: 20, y: 20, w: 10 }, 2, 1200, 800).w, MIN);
});

test('a new pin opens at the right of the worksheet, stepped for each pin', () => {
  const area = { x: 0, y: 100, w: 1200, h: 700 };
  const a = S('snipDefaultBox')(300, 150, area, 0), b = S('snipDefaultBox')(300, 150, area, 1);
  assert.equal(a.ratio, 2);
  assert.ok(a.x + a.w <= 1200 && a.x > 600);
  assert.ok(b.y > a.y && b.x < a.x);
});

test('only a real picture comes back out of storage', () => {
  const clean = S('snipCleanPin');
  assert.equal(clean({ src: 'javascript:alert(1)', ratio: 2 }), null);
  assert.equal(clean({ src: 'data:image/jpeg;base64,AAA', ratio: 0 }), null);
  const pin = clean({ src: 'data:image/jpeg;base64,AAA', ratio: 2, hidden: 1, min: 0, label: 'x' });
  assert.equal(pin.hidden, true);
  assert.equal(pin.min, false);
});

test('it is the teacher’s, asked in every handler and on every role change', () => {
  assert.match(html, /var TEACHER_TOOLBAR_IDS = \[[^\]]*'snipBtn'/);
  assert.match(html, /\$\('snipBtn'\)\.addEventListener\('click', function \(\) \{\s*if \(!snipTeacher\(\)\) return;/);
  assert.match(html, /function snipStart\(\) \{\s*if \(!snipTeacher\(\)\) return;/);
  assert.match(html, /function snipToggle\(id, field\) \{[\s\S]*?!snipTeacher\(\)/);
  const role = cut('function applyRoleUI() {', 'var student = isStudent();');
  assert.match(role, /snipRoleChanged\(\)/);
  assert.match(cut('function snipRoleChanged() {', '/* ---- 📸 Snip wiring ---- */'), /snipHideAll\(\)/);
});

test('a pin is never an annotation and never printed', () => {
  const section = cut('var SNIP_STORE', '/* ---- 📸 Snip wiring ---- */');
  assert.doesNotMatch(section, /annotations\.push|pushUndo\(|setDirty\(/);
  assert.match(html, /@media print \{ #snipPins, #snipLayer \{ display:none !important; \} \}/);
  // The picture is painted from the page, never grabbed from the screen.
  assert.match(section, /aiViewPaintPage\(record, annotations/);
  assert.doesNotMatch(section, /getDisplayMedia/);
});

test('the head height in the code is the head height in the CSS', () => {
  const h = +S('SNIP_HEAD_H');
  assert.match(html, new RegExp('\\.snipHead \\{[^}]*height:' + h + 'px'));
});
