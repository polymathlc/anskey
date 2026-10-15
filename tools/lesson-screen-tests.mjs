/* =====================================================================
   📺 Record the worksheet window — the pure crop, and what the source must
   keep saying.

   tools/screen-record-check.mjs shares a real tab in Chromium and counts the
   pixels of the saved file. These pin what that check cannot reach on every
   machine: the crop's arithmetic for every kind of share, and the order of
   things in lessonStart that a refactor would quietly break — the share is
   asked for INSIDE the tap, the sound is still only the mix, every way out
   lets the share go, and the lesson is filed as the window.

     node --test tools/lesson-screen-tests.mjs
   ===================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function between(from, to) {
  const a = html.indexOf(from);
  assert.ok(a >= 0, 'missing: ' + from);
  const b = html.indexOf(to, a + from.length);
  assert.ok(b > a, 'missing after ' + from + ': ' + to);
  return html.slice(a, b);
}
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

const box = {};
vm.createContext(box);
vm.runInContext(fn('lessonScreenCrop') + '\n' + fn('lessonScreenFit'), box);
const { lessonScreenCrop: crop, lessonScreenFit: fit } = box;

test('a share of this tab is cropped to the worksheet area', () => {
  // A 1280 × 800 tab captured at twice its size; the area starts under a
  // 150-pixel header and toolbar.
  const c = crop(2560, 1600, 1280, 800, { left: 0, top: 150, right: 1280, bottom: 800 });
  assert.deepEqual({ ...c }, { sx: 0, sy: 300, sw: 2560, sh: 1300, self: true });
});

test('the crop follows a frame handed over SMALLER than the tab', () => {
  const c = crop(800, 500, 1280, 800, { left: 0, top: 160, right: 1280, bottom: 800 });
  assert.equal(c.self, true);
  assert.equal(c.sy, 100);
  assert.equal(c.sh, 400);
  assert.equal(c.sw, 800);
});

test('an area with a side panel is cropped on that side too', () => {
  const c = crop(1200, 800, 1200, 800, { left: 220.4, top: 140.6, right: 1200, bottom: 800 });
  assert.equal(c.sx, 220);
  assert.equal(c.sy, 140);
  assert.equal(c.sx + c.sw, 1200);
  assert.equal(c.sy + c.sh, 800);
});

test('a frame of another shape is not this tab, and is used whole', () => {
  // A 16 : 9 monitor shared from a 4 : 3 window.
  const c = crop(1920, 1080, 1024, 768, { left: 0, top: 150, right: 1024, bottom: 768 });
  assert.deepEqual({ ...c }, { sx: 0, sy: 0, sw: 1920, sh: 1080, self: false });
});

test('with no area (a screen or window was shared) the frame is used whole', () => {
  assert.equal(crop(1280, 800, 1280, 800, null).self, false);
});

test('an area pushed off the frame, or no frame yet, never draws garbage', () => {
  assert.equal(crop(1280, 800, 1280, 800, { left: 0, top: 795, right: 1280, bottom: 900 }).self, false);
  assert.equal(crop(0, 0, 1280, 800, { left: 0, top: 0, right: 10, bottom: 10 }), null);
  const c = crop(1280, 800, 1280, 800, { left: -50, top: -20, right: 1400, bottom: 900 });
  assert.deepEqual([c.sx, c.sy, c.sw, c.sh], [0, 0, 1280, 800]);
});

test('the video is the area\'s size, never upscaled, never past 1080p, even on both sides', () => {
  assert.deepEqual({ ...fit(1100, 531, 1920, 1080) }, { w: 1100, h: 532 });
  assert.deepEqual({ ...fit(2560, 1300, 1920, 1080) }, { w: 1920, h: 976 });
  assert.deepEqual({ ...fit(1800, 1600, 1920, 1080) }, { w: 1216, h: 1080 });
  assert.deepEqual({ ...fit(0, 0, 1920, 1080) }, { w: 2, h: 2 });
});

const START = fn('lessonStart');
test('the share is asked for INSIDE the Start tap, before anything is awaited', () => {
  const ask = START.indexOf('lessonScreenAsk()');
  const firstAwait = START.indexOf('await ');
  assert.ok(ask > 0 && ask < firstAwait, 'getDisplayMedia needs the click: it must be called before the first await');
});

test('the recorded picture is the cropped canvas, and the sound is still only the mix', () => {
  assert.match(START, /c\.screenRec \? c\.screenRec\.out\.getVideoTracks\(\)/);
  assert.match(START, /pictures\.concat\(c\.destination\.stream\.getAudioTracks\(\)\)/);
  // The share's own audio is never asked for, and never mixed in.
  assert.match(fn('lessonScreenAsk'), /audio: false/);
  const section = between('/* ---- 📺 Record the worksheet window (v1.137.0) ----', '// A remembered device is { id, label }.');
  assert.doesNotMatch(section, /createMediaStreamSource|createMediaElementSource|AnsKeyLive/);
});

test('every way out lets the share go and puts the page back', () => {
  assert.match(fn('lessonRelease'), /lessonScreenRelease\(c\)/);
  const rel = fn('lessonScreenRelease');
  assert.match(rel, /getTracks\(\)\.forEach\(function \(t\) \{ t\.onended = null; t\.stop\(\); \}\)/);
  assert.match(rel, /classList\.remove\('lessonScreenRec'\)/);
  assert.match(rel, /cancelAnimationFrame/);
  // Stop sharing from the browser's own bar ends AND saves the lesson.
  assert.match(START, /t\.onended = function \(\) \{ if \(lessonCapture === c\) lessonStop\('You stopped sharing the window/);
});

test('a window lesson is filed as a video AND as the window', () => {
  const finish = fn('lessonFinish');
  assert.match(finish, /if \(c\.camStream \|\| shot\) job\.video = true;/);
  assert.match(finish, /if \(shot\) job\.screen = true;/);
  // screenShot outlives the release lessonFinish starts with.
  assert.ok(finish.indexOf('lessonRelease(c)') < finish.indexOf('c.screenShot'));
  assert.match(fn('lessonSavePending'), /if \(job\.screen\) attachment\.lessonRecording\.screen = true;/);
});

test('an audio or camera lesson is byte for byte what it was', () => {
  // Only a window lesson carries `screen`; the ordinary bitrates are untouched.
  assert.match(START, /if \(c\.screenRec\) options\.videoBitsPerSecond = LESSON_SCREEN_BPS;\s*else if \(c\.camera\) options\.videoBitsPerSecond = LESSON_VIDEO_BPS;/);
  assert.match(html, /var LESSON_VIDEO_BPS = 500000;/);
});

test('an hour of the window fits the video file ceiling', () => {
  const bps = Number(/var LESSON_SCREEN_BPS = (\d+);/.exec(html)[1]);
  const audio = Number(/var LESSON_AUDIO_BPS = (\d+);/.exec(html)[1]);
  const limit = 1536 * 1024 * 1024;
  assert.match(html, /var LESSON_VIDEO_LIMIT = 1536 \* 1024 \* 1024;/);
  assert.ok((bps + audio) * 3600 / 8 < limit, 'an hour must fit');
});

test('the replay and the export treat the window as the picture', () => {
  assert.match(fn('lessonPlay'), /var screen = video && !!a\.lessonRecording\.screen;/);
  assert.match(fn('lessonExportDraw'), /if \(job\.screen\) \{ lessonExportScreen\(job, t\); return; \}/);
  assert.match(fn('lessonExportPrepare'), /if \(job\.screen\) \{/);
});

test('while it records, the toolbar side holds the bar and a question window stays in the area', () => {
  assert.match(html, /body\.lessonScreenRec \.barStack \{ top:10px; bottom:auto; \}/);
  assert.match(html, /body\.lessonScreenRec \.qbBack \{ inset:auto; top:var\(--lsr-top/);
  assert.match(html, /body\.lessonScreenRec #favBar, body\.lessonScreenRec #toolbarToggleBtn \{ visibility:hidden !important; \}/);
});
