/* =====================================================================
   📱 Portrait for Instagram (v1.140.0) — a window recording can take only a
   9:16 box in the middle of the worksheet area, with an outline round it on
   screen that is never in the video, and its 1080p export is 1080 × 1920.

     node --test tools/lesson-frame-tests.mjs
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
  ['LESSON_FRAMES', 'LESSON_FRAME_RATIO', 'LESSON_FRAME_GAP', 'LESSON_FRAME_MAX_W', 'LESSON_FRAME_MAX_H',
   'LESSON_CAM_POSITIONS', 'LESSON_CAM_SIZES', 'LESSON_CAM_SIZE_SCALE', 'LESSON_CAM_SIDE_FRACTION', 'LESSON_CAM_TALL_SHARE',
   'LESSON_EXPORT_W', 'LESSON_EXPORT_H'].map(constant).join('\n') + '\n' +
  ['lessonFrameClean', 'lessonFrameRect', 'lessonFrameLayout', 'lessonScreenRegion', 'lessonCamLayoutClean',
   'lessonScreenCamBox', 'lessonExportDims', 'lessonScreenCrop'].map(fn).join('\n'),
  box);
const plain = (x) => JSON.parse(JSON.stringify(x));

test('the frame is one of two names, and anything else is the whole area', () => {
  assert.deepEqual(plain(box.LESSON_FRAMES), ['area', 'portrait']);
  assert.equal(box.lessonFrameClean('portrait'), 'portrait');
  for (const bad of [undefined, null, '', 'landscape', 'PORTRAIT', 1, {}]) assert.equal(box.lessonFrameClean(bad), 'area');
  assert.equal(box.LESSON_FRAME_RATIO, 9 / 16);
  // The outline's gap is the guide's transparent border, in the CSS.
  assert.match(html, new RegExp('\\.lessonFrameGuide \\{[^}]*border:' + box.LESSON_FRAME_GAP + 'px solid transparent'));
});

test('the frame is the largest 9:16 box, centred, in whole pixels, inside the outline\'s gap', () => {
  const area = { left: 0, top: 120, width: 1400, height: 760, right: 1400, bottom: 880 };
  const f = box.lessonFrameRect(area, 9 / 16, 3);
  assert.equal(f.height, 760 - 6);
  assert.equal(f.width, Math.floor((760 - 6) * 9 / 16));
  assert.ok(Math.abs((f.left + f.width / 2) - 700) <= 1, 'centred across');
  assert.ok(f.top >= area.top + 3 && f.bottom <= area.bottom - 3, 'room for the outline above and below');
  for (const k of ['left', 'top', 'width', 'height', 'right', 'bottom']) assert.ok(Number.isInteger(f[k]), k + ' is whole');
  assert.equal(f.right, f.left + f.width); assert.equal(f.bottom, f.top + f.height);
  // A tall, narrow area: the width decides.
  const tall = box.lessonFrameRect({ left: 10, top: 0, width: 300, height: 1000, right: 310, bottom: 1000 }, 9 / 16, 3);
  assert.equal(tall.width, 294);
  assert.ok(tall.left >= 13 && tall.right <= 307);
  // Nothing to frame.
  for (const bad of [null, { width: 0, height: 100 }, { left: 0, top: 0, width: 20, height: 20 }]) assert.equal(box.lessonFrameRect(bad, 9 / 16, 3), null);
});

test('a recording without the frame crops the area exactly as before', () => {
  const r = { left: 0, top: 100, width: 1200, height: 700, right: 1200, bottom: 800 };
  assert.equal(box.lessonScreenRegion({ frameRatio: 0 }, r), r);
  assert.equal(box.lessonScreenRegion(null, r), r);
  const f = box.lessonScreenRegion({ frameRatio: 9 / 16 }, r);
  assert.ok(f.width < r.width && Math.abs(f.width / f.height - 9 / 16) < 0.01);
  // The crop of a 2× frame keeps the shape.
  const c = box.lessonScreenCrop(2400, 1600, 1200, 800, f);
  assert.ok(c.self && Math.abs(c.sw / c.sh - 9 / 16) < 0.01, JSON.stringify(c));
});

test('a portrait video has its camera in a corner, and a larger share of its width', () => {
  assert.deepEqual(plain(box.lessonFrameLayout({ pos: 'side', size: 'large' })), { pos: 'br', size: 'large' });
  assert.deepEqual(plain(box.lessonFrameLayout({ pos: 'tl', size: 'small' })), { pos: 'tl', size: 'small' });
  assert.equal(box.lessonFrameLayout(null), null);
  const W = 1080, H = 1920;
  const b = box.lessonScreenCamBox(W, H, 640, 360, { pos: 'br', size: 'medium' });
  assert.equal(b.w, Math.round(W * box.LESSON_CAM_TALL_SHARE));
  assert.equal(b.col, 0);
  assert.ok(b.x + b.w <= W && b.y + b.h <= H && b.x > W / 2 && b.y > H / 2);
  // A wide picture is unchanged.
  assert.equal(box.lessonScreenCamBox(1600, 900, 640, 360, { pos: 'br', size: 'medium' }).w, Math.round(1600 * 0.22));
});

test('the export is 1080 × 1920 for a portrait lesson and 1920 × 1080 for every other', () => {
  assert.deepEqual(plain(box.lessonExportDims({ portrait: true })), { w: 1080, h: 1920 });
  assert.deepEqual(plain(box.lessonExportDims({ portrait: false })), { w: 1920, h: 1080 });
  assert.deepEqual(plain(box.lessonExportDims(null)), { w: 1920, h: 1080 });
});

test('the source keeps the frame, the outline and the export in step', () => {
  assert.match(fn('lessonDevChoice'), /frame: lessonFrameOn\(\) \? 'portrait' : 'area'/);
  assert.match(html, /frame: choice\.screen && choice\.frame === 'portrait' \? 'portrait' : 'area'/);
  const compose = fn('lessonScreenCompose');
  assert.match(compose, /rec\.frameRatio = !rec\.other && lessonFrameClean\(c\.frame\) === 'portrait'/);
  assert.match(compose, /if \(!first\.self\) rec\.frameRatio = 0/);
  assert.match(compose, /rec\.guide = lessonFrameGuideMake\(\)/);
  assert.match(compose, /LESSON_FRAME_MAX_W, LESSON_FRAME_MAX_H/);
  const paint = fn('lessonScreenPaint');
  assert.match(paint, /lessonScreenRegion\(rec, ar\)/);
  assert.match(paint, /lessonScreenVars\(r\); lessonFrameGuidePlace\(rec, ar, r\)/);
  assert.match(fn('lessonScreenRelease'), /rec\.guide\.remove\(\)/);
  assert.match(fn('lessonFinish'), /if \(shot && c\.frame === 'portrait' && c\.frameShot\) job\.frame = 'portrait'/);
  assert.match(html, /if \(job\.screen && job\.frame === 'portrait'\) attachment\.lessonRecording\.frame = 'portrait'/);
  assert.match(html, /portrait: video && !!a\.lessonRecording\.screen && a\.lessonRecording\.frame === 'portrait'/);
  assert.match(fn('lessonExportScreen'), /D = lessonExportDims\(job\)/);
  assert.match(fn('lessonExportOpen'), /job\.canvas\.width = dims\.w/);
  assert.match(fn('lessonFrameClick'), /lessonTeacher\(\)/);
  // The outline never takes a tap and is clipped to the worksheet area.
  assert.match(html, /\.lessonFrameClip \{[^}]*overflow:hidden; pointer-events:none;/);
  for (const v of ['area', 'portrait']) assert.match(html, new RegExp('data-lframe="' + v + '"'));
});
