/* =====================================================================
   🎞 THE 1080p EXPORT, 🎬 THE PLAYLIST AND 🏷 THE QUESTION TITLE
   ---------------------------------------------------------------------
   Loads the REAL sections out of index.html and runs their pure parts —
   the layout, the page stack, the framing, the easing, the raster budget,
   the size estimate, the file name, the playlist's order and the question
   guess — against stubs. Then it reads the shipped source for the rules
   no pure function can carry: who may export, what the recorder is and is
   not allowed to touch, and where the playlist hooks in.

   tools/export-check.mjs is the other half: a real browser, a real
   recording and a real file. This one runs in CI.
   ===================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function cut(from, to) {
  const a = html.indexOf(from), b = html.indexOf(to, a);
  assert.ok(a >= 0 && b > a, 'section must exist: ' + from);
  return html.slice(a, b);
}
const EXPORT = cut('/* ================= 🎞 Lesson export — the replay as a 1080p video ================= */',
  '/* ================= End lesson export ================= */');
const PLAYLIST = cut('/* ================= 🎬 The worksheet\'s videos, one after another ================= */',
  '/* ================= End worksheet playlist ================= */');
const TITLE = cut('/* ================= 🏷 Which question a lesson is for ================= */',
  '/* ================= End which question a lesson is for ================= */');
const HELPERS = cut('/* ================= Recording helpers =================', '/* ================= Lesson replay core ================= */');
const RECORDING = cut('/* ================= Synchronized lesson recording ================= */',
  '/* ================= End synchronized lesson recording ================= */');
const EMBED = cut('function videoEmbedInfo(url, startSec) {', '/* The share link with a time position baked in');

// Objects made inside the vm carry the vm's own prototypes, which strict deep
// equality counts as a difference; compare their plain shape instead.
const plain = v => JSON.parse(JSON.stringify(v));
function box(extra) {
  const node = () => ({ addEventListener() {}, removeEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    style: {}, setAttribute() {}, getAttribute() { return null; }, querySelector() { return null; }, appendChild() {}, hidden: true });
  const nodes = {};
  const ctx = vm.createContext({
    console, Math, Number, String, Array, Object, JSON, Date, Set, Map, isFinite, Promise, setTimeout, clearTimeout,
    $: id => nodes[id] || (nodes[id] = node()),
    document: { addEventListener() {}, removeEventListener() {}, querySelectorAll() { return []; }, createElement: node, body: node() },
    window: { addEventListener() {}, MediaRecorder: null },
    navigator: {},
    HTMLCanvasElement: { prototype: {} },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    ...(extra || {})
  });
  vm.runInContext(HELPERS, ctx);
  vm.runInContext(`
    var lessonPrefMemory = {};
    function lessonPrefGet(k) { return Object.prototype.hasOwnProperty.call(lessonPrefMemory, k) ? lessonPrefMemory[k] : null; }
    function lessonPrefSet(k, v) { lessonPrefMemory[k] = v; }
    var pages = [], annotations = [], wsEpoch = 1, currentDocId = 'doc', currentUser = { uid: 'teacher' };
    var teacher = true; function lessonTeacher() { return teacher; }
    function toast(m) { (globalThis.__toasts = globalThis.__toasts || []).push(m); }
  ` + EMBED + EXPORT + TITLE + PLAYLIST, ctx);
  return ctx;
}

test('the three layouts put everything on a 1920 × 1080 frame, and the camera keeps its shape', () => {
  const c = box();
  const side = c.lessonExportLayout('side', 640, 360);
  assert.deepEqual(plain(side.page), { x: 0, y: 0, w: 1440, h: 1080 }, 'beside the page: the page has the left 1440 pixels');
  assert.equal(side.panel.x, 1440);
  assert.equal(side.cam.x + side.cam.w <= 1920 && side.cam.x >= 1440, true, 'the camera is inside its own column');
  assert.ok(Math.abs(side.cam.w / side.cam.h - 16 / 9) < 0.01, 'a 16:9 camera stays 16:9');
  const upright = c.lessonExportLayout('side', 360, 640);
  assert.ok(upright.cam.h <= Math.round(1080 * 0.56), 'an iPad held upright is not a camera taller than the frame');
  assert.ok(Math.abs(upright.cam.w / upright.cam.h - 9 / 16) < 0.02, '…and it keeps its portrait shape');
  const corner = c.lessonExportLayout('corner', 640, 360);
  assert.deepEqual(plain(corner.page), { x: 0, y: 0, w: 1920, h: 1080 });
  assert.ok(corner.cam.x + corner.cam.w < 1920 && corner.cam.y + corner.cam.h < 1080, 'the corner camera sits inside the frame');
  const page = c.lessonExportLayout('page', 640, 360);
  assert.equal(page.cam, null, 'page only has no camera');
  assert.equal(page.panel, null);
  assert.equal(c.lessonExportLayout('side', 0, 0).cam.w > 0, true, 'no camera size yet still lays out');
});

test('pages stack one under another, centred on one axis, with a gap', () => {
  const c = box();
  const stack = c.lessonExportStack([{ num: 1, baseW: 600, baseH: 800 }, { num: 2, baseW: 800, baseH: 600 }]);
  assert.equal(stack.w, 800);
  assert.deepEqual(plain(stack.rows[1]), { x: 100, y: 0, w: 600, h: 800 }, 'a narrower page is centred');
  assert.equal(stack.rows[2].y, 800 + c.LESSON_EXPORT_GAP);
  assert.equal(stack.h, 800 + c.LESSON_EXPORT_GAP + 600);
});

test('the frame shows at least what the teacher saw — never tighter — and follows the page they were on', () => {
  const c = box();
  const stack = c.lessonExportStack([{ num: 1, baseW: 600, baseH: 800 }, { num: 2, baseW: 600, baseH: 800 }]);
  const area = { x: 0, y: 0, w: 1440, h: 1080 };
  // A viewer 1000 × 700 at zoom 2: the teacher saw 500 × 350 page units.
  const t = c.lessonExportTarget({ page: 2, x: 300, y: 200, zoom: 2 }, stack, area, 'follow', { w: 1000, h: 700 });
  assert.equal(t.x, 300);
  assert.equal(t.y, 800 + c.LESSON_EXPORT_GAP + 200, 'page 2 is measured from its own top in the stack');
  assert.ok(1440 / t.s >= 500 - 1e-6 && 1080 / t.s >= 350 - 1e-6, 'every unit the teacher saw is on the frame');
  assert.ok(Math.abs(t.s - Math.min(1440 / 500, 1080 / 350)) < 1e-9, '…and no more than has to be');
  // A viewer far wider than the page: the empty desk either side is dropped.
  const wide = c.lessonExportTarget({ page: 1, x: 300, y: 400, zoom: 1 }, stack, area, 'follow', { w: 1800, h: 700 });
  assert.ok(Math.abs(wide.s - Math.min(1440 / 648, 1080 / 700)) < 1e-9, 'framed at the page\'s own width, the height the teacher saw');
  // No viewer size (a recording from before v1.105.0): the page at its width.
  const old = c.lessonExportTarget({ page: 1, x: 300, y: 400, zoom: 1.5 }, stack, area, 'follow', null);
  assert.ok(Math.abs(old.s - 1440 / (600 + 48 / 1.5)) < 1e-9, 'an old lesson is framed at the page width');
  // The whole page, whatever the zoom.
  const whole = c.lessonExportTarget({ page: 1, x: 10, y: 10, zoom: 4 }, stack, area, 'page', { w: 1000, h: 700 });
  assert.equal(whole.x, 300);
  assert.equal(whole.y, 400);
  assert.ok(whole.s * 848 <= 1080 && whole.s * 648 <= 1440, 'the whole page fits');
  // Absurd zooms are bounded.
  const far = c.lessonExportTarget({ page: 1, x: 300, y: 400, zoom: 0.25 }, stack, area, 'follow', { w: 3000, h: 3000 });
  assert.ok(far.s >= Math.min(1440 / 648, 1080 / 848) * 0.8 - 1e-9, 'never so far out the page is a stamp');
  const near = c.lessonExportTarget({ page: 1, x: 300, y: 400, zoom: 4 }, stack, area, 'follow', { w: 200, h: 150 });
  assert.ok(near.s <= 6, 'never so far in one word fills the frame');
  // A page the stack does not have falls back to the first, never throws.
  assert.ok(c.lessonExportTarget({ page: 9, x: 1, y: 1, zoom: 1 }, stack, area, 'follow', null).s > 0);
});

test('the viewer size is read only when it is a sensible pair of numbers', () => {
  const c = box();
  assert.deepEqual(plain(c.lessonExportViewport({ w: 1200, h: 700 })), { w: 1200, h: 700 });
  for (const bad of [null, 'x', { w: '1200', h: 700 }, { w: NaN, h: 700 }, { w: 50, h: 700 }, { w: 1e9, h: 700 }, { w: 1200 }]) {
    assert.equal(c.lessonExportViewport(bad), null, JSON.stringify(bad));
  }
});

test('the frame is kept on the paper, and a narrow stack is simply centred', () => {
  const c = box();
  const stack = c.lessonExportStack([{ num: 1, baseW: 600, baseH: 800 }, { num: 2, baseW: 600, baseH: 800 }]);
  const area = { w: 1440, h: 1080 };
  const top = c.lessonExportClamp({ x: 300, y: -500, s: 2 }, stack, area);
  assert.equal(top.y, 1080 / 4 - 36, 'no more than a margin of desk above the first page');
  const bottom = c.lessonExportClamp({ x: 300, y: 99999, s: 2 }, stack, area);
  assert.equal(bottom.y, stack.h + 36 - 1080 / 4);
  const narrow = c.lessonExportClamp({ x: -900, y: 400, s: 1 }, stack, area);
  assert.equal(narrow.x, 300, 'a page narrower than the frame is centred');
});

test('a scroll becomes a pan: eased in media time, the scale in log space, a seek snaps', () => {
  const c = box();
  const a = { x: 0, y: 0, s: 1 }, b = { x: 100, y: 200, s: 4 };
  assert.deepEqual(plain(c.lessonExportEase(null, b, 33)), b, 'the first frame snaps');
  assert.deepEqual(plain(c.lessonExportEase(a, b, 5000)), b, 'a jump of seconds (a seek) snaps');
  const half = c.lessonExportEase(a, b, c.LESSON_EXPORT_TAU * Math.LN2);
  assert.ok(Math.abs(half.x - 50) < 1e-9 && Math.abs(half.y - 100) < 1e-9, 'one half-life is half way');
  assert.ok(Math.abs(half.s - 2) < 1e-9, 'the scale meets in the middle geometrically: 1 → 4 is 2, not 2.5');
  const still = c.lessonExportEase(b, b, 33);
  assert.deepEqual(plain(still), b, 'nothing moves when nothing changed');
  // The same frames give the same result — the export is deterministic.
  let x = null, y = null;
  for (let i = 0; i < 30; i++) { x = c.lessonExportEase(x, b, 33); y = c.lessonExportEase(y, b, 33); }
  assert.deepEqual(plain(x), plain(y));
});

test('pages are rasterised as sharp as needed, and no sharper than the budget', () => {
  const c = box();
  assert.equal(c.lessonExportRasterScale(1.5, 600 * 800), 1.5);
  assert.equal(c.lessonExportRasterScale(9, 600 * 800), c.LESSON_EXPORT_RASTER_MAX, 'capped');
  const many = c.lessonExportRasterScale(3, 40 * 600 * 800);
  assert.ok(many * many * 40 * 600 * 800 <= c.LESSON_EXPORT_PX_BUDGET * 1.0001, 'a long worksheet shares the budget');
  assert.ok(c.lessonExportRasterScale(0, 1) >= 0.5);
});

test('it says how big the file will be, and names it for the worksheet and the question', () => {
  const c = box();
  assert.equal(c.lessonExportBytes(60000), Math.round((c.LESSON_EXPORT_VBPS + c.LESSON_EXPORT_ABPS) / 8 * 60));
  assert.equal(c.lessonExportSizeText(0.5 * 1048576), '0.5 MB');
  assert.equal(c.lessonExportSizeText(23.4 * 1048576), '23 MB');
  assert.equal(c.lessonExportSizeText(2.5 * 1073741824), '2.5 GB');
  assert.equal(c.lessonExportFileName('P5 Maths: Fractions', 'Q5 · video lesson', 'video/mp4;codecs=avc1'), 'P5 Maths Fractions — Q5 · video lesson (1080p).mp4');
  assert.equal(c.lessonExportFileName('a/b\\c*?"<>|', 'x', 'video/webm'), 'a b c — x (1080p).webm', 'nothing a file system refuses');
  assert.ok(c.lessonExportFileName('x'.repeat(400), 'y', 'video/mp4').length < 140, 'a long title is cut');
});

test('the choices are remembered, and a stored value this build does not know falls back', () => {
  const c = box();
  assert.deepEqual(JSON.parse(JSON.stringify(c.lessonExportPrefs())), { layout: 'side', mode: 'follow' });
  c.lessonPrefSet(c.LESSON_EXPORT_PREF, { layout: 'corner', mode: 'page' });
  assert.deepEqual(JSON.parse(JSON.stringify(c.lessonExportPrefs())), { layout: 'corner', mode: 'page' });
  c.lessonPrefSet(c.LESSON_EXPORT_PREF, { layout: 'hologram', mode: 7 });
  assert.deepEqual(JSON.parse(JSON.stringify(c.lessonExportPrefs())), { layout: 'side', mode: 'follow' });
});

test('MP4 is chosen when the browser writes it, WebM otherwise', () => {
  const pick = supported => box({ window: { addEventListener() {}, MediaRecorder: {} }, MediaRecorder: { isTypeSupported: t => supported.includes(t) } }).lessonExportMime();
  assert.equal(pick(['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/webm']), 'video/mp4;codecs=avc1.640028,mp4a.40.2');
  assert.equal(pick(['video/mp4', 'video/webm;codecs=vp9,opus']), 'video/mp4', 'Safari: plain MP4, before any WebM');
  assert.equal(pick(['video/webm;codecs=vp9,opus', 'video/webm']), 'video/webm;codecs=vp9,opus');
  assert.equal(pick([]), '');
});

test('the playlist is in question order: page, then row, then left to right', () => {
  const c = box();
  const pill = (id, page, x, y, extra) => Object.assign({ id, type: 'video', page, x, y, w: 150, h: 30,
    url: 'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/pdf-annotator%2Flesson-x.webm?alt=media',
    lessonRecording: { version: 1 }, label: id }, extra || {});
  const items = c.lessonPlaylistItems([
    pill('p2-top', 2, 50, 40),
    pill('p1-low', 1, 50, 600),
    pill('p1-right', 1, 400, 105),
    pill('p1-left', 1, 60, 95),
    { id: 'ink', type: 'pen', page: 1, points: [] },
    pill('youtube', 1, 50, 300, { lessonRecording: undefined, url: 'https://youtu.be/abcdefg' }),
    pill('bare-link', 1, 50, 310, { lessonRecording: undefined, url: 'https://example.com/lesson' }),
    pill('no-url', 1, 50, 320, { url: '' })
  ]);
  assert.deepEqual(plain(items.map(i => i.id)), ['p1-left', 'p1-right', 'youtube', 'p1-low', 'p2-top'],
    'two pills on one line go left to right; a link that only opens a tab, and a pill with no link, are left out');
  assert.equal(items.find(i => i.id === 'youtube').kind, 'iframe', 'an embedded player is in the list, and waits for ⏭');
  assert.equal(items[0].kind, 'lesson');
  // The comparator is a real order: shuffled input, same output.
  const shuffled = c.lessonPlaylistItems([pill('c', 1, 10, 500), pill('a', 1, 10, 10), pill('b', 1, 10, 250)].reverse());
  assert.deepEqual(plain(shuffled.map(i => i.id)), ['a', 'b', 'c']);
});

test('the question guess reads the margin of what is on screen, and never an option or a quantity', () => {
  const c = box();
  const items = [
    { str: '3.', x: 40, y: 50 }, { str: '4.', x: 40, y: 400 }, { str: '5', x: 42, y: 700 },
    { str: '(1)', x: 90, y: 430 }, { str: '(2)', x: 30, y: 460 }, { str: '1.5 kg', x: 40, y: 480 },
    { str: '2021', x: 40, y: 500 }, { str: '12.', x: 400, y: 420 }, { str: 'Q9', x: 44, y: 1000 }
  ];
  assert.equal(c.lessonQuestionGuess(items, 300, 800, 600), 'Q4', 'the first question number on screen');
  assert.equal(c.lessonQuestionGuess(items, 100, 350, 600), 'Q3', 'none on screen: the nearest above');
  assert.equal(c.lessonQuestionGuess(items, 900, 1100, 600), 'Q9', '"Q9" is a question number too');
  assert.equal(c.lessonQuestionGuess([{ str: '(3)', x: 20, y: 10 }, { str: '0.5', x: 20, y: 20 }], 0, 100, 600), '', 'nothing that is a question number');
  assert.equal(c.lessonQuestionGuess(null, 0, 100, 600), '');
  assert.equal(c.lessonTitleClean('  Q5   part  (a)  '), 'Q5 part (a)');
  assert.equal(c.lessonTitleClean('x'.repeat(99)).length, c.LESSON_TITLE_MAX);
});

test('🔒 exporting is the teacher\'s alone — asked again in every handler, not only on the button', () => {
  for (const fn of ['lessonExportOpen', 'lessonExportGo', 'lessonExportChoose', 'lessonExportDownload', 'lessonExportShare']) {
    const at = EXPORT.indexOf('function ' + fn + '(');
    assert.ok(at >= 0, fn + ' exists');
    const body = EXPORT.slice(at, EXPORT.indexOf('\n}', at));
    assert.match(body, /lessonTeacher\(\)/, fn + ' asks lessonTeacher() itself');
  }
  assert.match(EXPORT, /\$\('lessonExportBtn'\)\.addEventListener\('click', function \(\) \{\n\s*var pb = lessonPlayback;\n\s*if \(!lessonTeacher\(\)\) return;/,
    'the replay bar\'s button refuses too');
  assert.match(RECORDING, /\$\('lessonExportBtn'\)\.hidden = !lessonTeacher\(\);/, 'the button is drawn for the teacher only');
  assert.match(PLAYLIST, /if \(it\.kind === 'lesson' && lessonTeacher\(\)\)/, 'the playlist offers ⬇ 1080p to the teacher only');
  assert.match(RECORDING, /if \(typeof lessonExportDrop === 'function'\) lessonExportDrop\(\);/, 'an account change drops a running export');
  const c = box();
  c.teacher = false;
  c.lessonExportOpen({ lessonRecording: { manifestUrl: 'x' } });
  assert.equal(c.lessonExportJob, null, 'a student never gets a job');
});

test('the export is its own copy: a fresh media element, the sound never in the speakers, the camera never mirrored', () => {
  assert.match(EXPORT, /function lessonExportMediaNode\(\) \{[\s\S]*?document\.createElement\('video'\)/, 'a new <video> for every export');
  assert.match(EXPORT, /media: lessonExportMediaNode\(\)/);
  assert.doesNotMatch(EXPORT, /audioCtx\.destination/, 'the lesson sound goes into the file, not the room');
  const code = EXPORT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /scale\(\s*-1|mirror/i, 'the recording was never mirrored, and neither is the export');
  assert.match(EXPORT, /job\.recorder\.start\(1000\);\n\s*if \(job\.recorder\.state === 'recording'\) job\.recorder\.pause\(\);/,
    'the recorder waits, paused, for the lesson to really play');
  assert.match(EXPORT, /job\.onHalt = function \(\) \{ if \(!media\.ended/, 'the pause just before the end does not pause the recorder under the last frame');
  assert.match(EXPORT, /lessonExportDraw\(job, 0, 0\);\n\s*var tracks = /, 'a frame is painted before the recorder asks for one');
  assert.match(EXPORT, /if \(document\.hidden\) \{\n\s*job\.paused = true;\n\s*try \{ job\.media\.pause\(\); \}/, 'a hidden tab pauses the export');
  assert.match(EXPORT, /navigator\.wakeLock\.request\('screen'\)/, 'a screen wake lock is held');
  // The RECORDER may not grow a second sound source because of any of this.
  assert.doesNotMatch(RECORDING, /createMediaElementSource/, 'the lesson recorder still mixes the microphone and nothing else');
});

test('🎬 the playlist hooks in where the replay lets go, and its bar stays live during a replay', () => {
  assert.match(RECORDING, /e\.target\.closest\('#lessonPlayer, #lessonCamWin, #playlistBar'\)/, 'the playback blocker lets the playlist bar through');
  assert.match(RECORDING, /if \(typeof lessonPlaylistExited === 'function'\) lessonPlaylistExited\(\);\n\s*if \(!pb\) return;/,
    'closing a replay — or Escape, or a worksheet change — ends the playlist');
  assert.match(html, /if \(had && typeof lessonPlaylistExited === 'function'\) lessonPlaylistExited\(\);/, 'closing a video pop-up ends it too');
  assert.match(html, /function renderAllOverlays\(\) \{[\s\S]{0,400}lessonPlaylistSync\(\);/, 'the button is re-counted on every change to the page');
  assert.match(PLAYLIST, /function lessonPlaylistExited\(\) \{\n\s*var pl = lessonPlaylist;\n\s*if \(!pl \|\| pl\.switching\) return;/,
    'except while the playlist itself is changing videos');
  assert.match(PLAYLIST, /function lessonBlessMedia\(\)/, 'every media element is played inside the tap that starts the playlist');
});

test('🏷 a titled lesson says so; an untitled one is byte for byte what it was', () => {
  assert.match(RECORDING, /var label = \(job\.title \? job\.title \+ \(job\.video \? ' · video lesson · ' : ' · lesson · '\)\n\s*: \(job\.video \? 'Play video lesson · ' : 'Play lesson · '\)\) \+ recFmtTime\(job\.duration\);/);
  assert.match(RECORDING, /if \(job\.title\) attachment\.lessonRecording\.title = job\.title;/);
  assert.match(RECORDING, /if \(c\.title\) job\.title = c\.title;\n\s*if \(c\.viewport\) job\.manifest\.viewport = c\.viewport;/,
    'the title and the viewer size are added only when there is one');
  assert.match(html, /id="lessonTitleInput" maxlength="40"/);
});

test('🐛 a share-link visitor\'s role setup no longer throws on the old recorder\'s button', () => {
  const role = cut('function applyRoleUI() {', 'async function signIn() {');
  assert.doesNotMatch(role, /recBtn/, '`recBtn` was declared nowhere after v1.104.0, so this line threw a ReferenceError');
});
