/* =====================================================================
   📐 You in the 1080p video — the camera's size and position, chosen in
   the Record lesson window (v1.139.0).

   The choice is carried on the lesson as `lessonRecording.camLayout =
   {pos, size}`. A camera lesson's 1080p export starts on it
   (lessonExportStartLayout, pinned in export-tests); a WINDOW recording
   paints the camera there itself, because its video is the export's
   picture. These pin the pure arithmetic of the window recording's camera
   box and what the source must keep saying: only a lesson that really had a
   camera carries the layout, the window's choice is read with the other
   devices before Start, and the export asks for it.

     node --test tools/lesson-camlayout-tests.mjs
   ===================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function fn(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'missing function ' + name);
  let depth = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  return html.slice(start, i + 1);
}
function constant(name) {
  const m = new RegExp('var ' + name + ' = [^;]+;').exec(html);
  assert.ok(m, 'missing ' + name);
  return m[0];
}
const box = {};
vm.createContext(box);
vm.runInContext(
  ['LESSON_CAM_POSITIONS', 'LESSON_CAM_SIZES', 'LESSON_CAM_SIZE_SCALE', 'LESSON_CAM_SIDE_FRACTION', 'LESSON_EXPORT_SIZES', 'LESSON_EXPORT_SIZE_SCALE', 'LESSON_EXPORT_CORNERS']
    .map(constant).join('\n') + '\n' +
  ['lessonCamLayoutClean', 'lessonScreenCamBox'].map(fn).join('\n'),
  box);
const plain = (x) => JSON.parse(JSON.stringify(x));

test('the recording window offers the export\'s own three sizes and its corners plus the column', () => {
  assert.deepEqual(plain(box.LESSON_CAM_SIZES), plain(box.LESSON_EXPORT_SIZES));
  assert.deepEqual(plain(box.LESSON_CAM_SIZE_SCALE), plain(box.LESSON_EXPORT_SIZE_SCALE));
  assert.deepEqual(plain(box.LESSON_CAM_POSITIONS), plain(box.LESSON_EXPORT_CORNERS.concat(['side'])));
  for (const v of ['small', 'medium', 'large']) assert.match(html, new RegExp('data-lcl-size="' + v + '"'));
  for (const v of ['tl', 'tr', 'bl', 'br', 'side']) assert.match(html, new RegExp('data-lcl-pos="' + v + '"'));
  for (const v of ['tl', 'tr', 'bl', 'br']) assert.match(html, new RegExp('data-lx-pos="' + v + '"'));
});

test('a stored layout is kept only when both halves are ones this build knows', () => {
  const clean = box.lessonCamLayoutClean;
  assert.deepEqual(plain(clean({ pos: 'tl', size: 'large', extra: 1 })), { pos: 'tl', size: 'large' });
  assert.deepEqual(plain(clean({ pos: 'side', size: 'small' })), { pos: 'side', size: 'small' });
  for (const bad of [null, undefined, 'side', {}, { pos: 'tl' }, { size: 'large' }, { pos: 'middle', size: 'large' }, { pos: 'tl', size: 'huge' }]) {
    assert.equal(clean(bad), null, JSON.stringify(bad));
  }
});

test('a window recording\'s camera: medium in the bottom right is the corner it always was', () => {
  const W = 1600, H = 900, b = box.lessonScreenCamBox(W, H, 640, 360, null);
  const cw = Math.round(W * 0.22), ch = Math.round(cw * 360 / 640), m = Math.round(W * 0.018);
  assert.deepEqual(plain(b), { col: 0, x: W - cw - m, y: H - ch - m, w: cw, h: ch });
  assert.deepEqual(plain(box.lessonScreenCamBox(W, H, 640, 360, { pos: 'br', size: 'medium' })), plain(b));
});

test('…in each corner, at each size, inside the area and keeping its shape', () => {
  const W = 1600, H = 900, m = Math.round(W * 0.018);
  for (const size of ['small', 'medium', 'large']) {
    const at = pos => box.lessonScreenCamBox(W, H, 640, 360, { pos, size });
    const tl = at('tl'), tr = at('tr'), bl = at('bl'), br = at('br');
    assert.equal(tl.x, m); assert.equal(tl.y, m);
    assert.equal(tr.x + tr.w, W - m); assert.equal(tr.y, m);
    assert.equal(bl.x, m); assert.equal(bl.y + bl.h, H - m);
    assert.equal(br.x + br.w, W - m); assert.equal(br.y + br.h, H - m);
    for (const b of [tl, tr, bl, br]) {
      assert.equal(b.col, 0);
      assert.ok(Math.abs(b.w / b.h - 16 / 9) < 0.02, size + ' keeps 16:9');
    }
  }
  const s = box.lessonScreenCamBox(W, H, 640, 360, { pos: 'tl', size: 'small' }).w;
  const l = box.lessonScreenCamBox(W, H, 640, 360, { pos: 'tl', size: 'large' }).w;
  assert.ok(s < Math.round(W * 0.22) && Math.round(W * 0.22) < l, 'small < medium < large');
  const upright = box.lessonScreenCamBox(W, H, 360, 640, { pos: 'br', size: 'large' });
  assert.ok(upright.h <= Math.round(H * 0.6) && upright.y >= 0, 'an upright camera is never taller than the area allows');
});

test('…and in a column of its own, beside the area rather than over it', () => {
  const W = 1500, H = 900;
  for (const size of ['small', 'medium', 'large']) {
    const b = box.lessonScreenCamBox(W, H, 640, 360, { pos: 'side', size });
    assert.ok(b.col > 0 && b.col % 2 === 0, 'an even column (H.264 refuses odd sizes)');
    assert.ok(b.x >= W && b.x + b.w <= W + b.col, size + ': the camera is inside its column');
    assert.ok(b.y >= 0 && b.y + b.h <= H);
  }
  const small = box.lessonScreenCamBox(W, H, 640, 360, { pos: 'side', size: 'small' }).col;
  const large = box.lessonScreenCamBox(W, H, 640, 360, { pos: 'side', size: 'large' }).col;
  assert.ok(small < large, 'the column grows with the camera');
});

test('the choice is read with the devices, and only a lesson with a camera carries it', () => {
  assert.match(fn('lessonDevChoice'), /camLayout: cam \? lessonCamLayoutPref\(\) : null/);
  assert.match(html, /camLayout: choice\.camLayout \|\| null/);
  const finish = fn('lessonFinish');
  assert.match(finish, /if \(c\.camStream && c\.camLayout\) job\.camLayout = /);
  assert.match(html, /if \(job\.video && job\.camLayout && typeof lessonCamLayoutClean === 'function' && lessonCamLayoutClean\(job\.camLayout\)\) attachment\.lessonRecording\.camLayout = /);
});

test('a window recording paints the camera where it was chosen, with room made for a column', () => {
  const compose = fn('lessonScreenCompose');
  assert.match(compose, /rec\.layout = rec\.cam \? lessonCamLayoutClean\(c\.camLayout\) : null/);
  assert.match(compose, /canvas\.width = size\.w \+ rec\.col/);
  const paint = fn('lessonScreenPaint');
  assert.match(paint, /W = rec\.canvas\.width - \(rec\.col \|\| 0\)/);
  assert.match(paint, /lessonScreenCamBox\(W, H, cam\.videoWidth, cam\.videoHeight, rec\.layout\)/);
  // Still never mirrored: no negative scale anywhere in the painter.
  assert.doesNotMatch(paint, /scale\(-1/);
});

test('the export starts on the recorded layout and the window is the teacher\'s', () => {
  assert.match(fn('lessonExportOpen'), /lessonExportStartLayout\(a\.lessonRecording\.camLayout, prefs\)/);
  assert.match(fn('lessonExportRelayout'), /job\.camSize, job\.camPos\)/);
  assert.match(fn('lessonCamLayoutClick'), /lessonTeacher\(\)/);
  assert.match(fn('lessonDevRenderCam'), /lessonCamLayoutRender\(\)/);
});
