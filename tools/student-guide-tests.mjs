/* =====================================================================
   tools/student-guide-tests.mjs — 🧭 the student's start-here bar and tour
   ---------------------------------------------------------------------
   A student signed in to a toolbar of bare icons, with Practice two menus
   deep and the lesson videos a small glyph. v1.148.0 gives them a bar
   (worksheets · practise · watch), a name on every icon and a tour.

   Every way this goes wrong is quiet: the bar showing the teacher's own
   controls to nobody, a practice button that skips the lesson guard, a
   video button offered while practising (when the videos are parked with
   the answers), or a tour card that lands off the screen. This cuts the
   PURE parts out of index.html and runs them, then pins the wiring.

   Run: node --test tools/student-guide-tests.mjs
   ===================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');

function cut(startMarker, endMarker) {
  const a = html.indexOf(startMarker);
  assert.ok(a >= 0, 'missing ' + startMarker);
  const b = html.indexOf(endMarker, a);
  assert.ok(b > a, 'missing ' + endMarker);
  return html.slice(a, b);
}

const ctx = vm.createContext({});
vm.runInContext(cut('function studentBarModel(st)', 'function studentBarState()'), ctx);
vm.runInContext(cut('function studentGuidePlace(r, card, view)', 'function studentGuideShown(el)'), ctx);
vm.runInContext(cut('var STUDENT_GUIDE_STEPS = [', 'function studentGuidePlace('), ctx);
const model = (st) => JSON.parse(JSON.stringify(ctx.studentBarModel(st)));

test('the teacher never gets the bar', () => {
  assert.equal(model({ student: false, worksheet: true, hasAnswers: true, videos: 3 }).show, false);
  assert.equal(model(null).show, false);
});

test('with nothing open a student is told where to start', () => {
  const m = model({ student: true, worksheet: false });
  assert.equal(m.show, true);
  assert.equal(m.worksheets, true);
  assert.equal(m.practice, false);
  assert.equal(m.videos, 0);
  assert.equal(m.noVideo, false, 'no worksheet is not "no video"');
  assert.match(m.hello, /Start here/);
  assert.equal(m.guide, true);
});

test('a share-link visitor has no worksheet list to open', () => {
  assert.equal(model({ student: true, shared: true, worksheet: false }).worksheets, false);
  assert.equal(model({ student: true, shared: true, worksheet: true, hasAnswers: true }).worksheets, false);
});

test('an open worksheet with answers offers practice, and says when there is no video', () => {
  const m = model({ student: true, worksheet: true, hasAnswers: true, videos: 0 });
  assert.equal(m.practice, true);
  assert.equal(m.noVideo, true);
  assert.equal(m.videos, 0);
});

test('a worksheet with no answers has nothing to practise', () => {
  assert.equal(model({ student: true, worksheet: true, hasAnswers: false }).practice, false);
});

test('videos are counted and worded', () => {
  const one = model({ student: true, worksheet: true, hasAnswers: true, videos: 1 });
  assert.equal(one.videos, 1);
  assert.equal(one.videoWords, 'Watch the lesson video');
  assert.equal(one.noVideo, false);
  const many = model({ student: true, worksheet: true, videos: 4 });
  assert.equal(many.videos, 4);
  assert.equal(many.videoWords, 'Watch lesson videos');
  assert.equal(model({ student: true, worksheet: true, videos: -2 }).videos, 0);
  assert.equal(model({ student: true, worksheet: true, videos: 'x' }).videos, 0);
});

test('an attached lesson recording counts as a video', () => {
  const m = model({ student: true, worksheet: true, recording: true, videos: 0 });
  assert.equal(m.recording, true);
  assert.equal(m.noVideo, false);
});

test('while practising: the practice controls, and no video button', () => {
  const m = model({ student: true, worksheet: true, practising: true, hasAnswers: true, videos: 3, recording: true });
  assert.equal(m.practising, true);
  assert.equal(m.practice, false, 'no second "start practice" while practising');
  assert.equal(m.videos, 0, 'the video pills are parked with the answers');
  assert.equal(m.recording, false);
  assert.equal(m.noVideo, false);
});

test('▴ the bar folds to a strip, and the tour opens it again', () => {
  assert.equal(model({ student: true, worksheet: true, hasAnswers: true }).min, false, 'open by default');
  assert.equal(model({ student: true, worksheet: true, min: true }).min, true);
  assert.equal(model({ student: true, worksheet: true, min: true, touring: true }).min, false,
    'the tour points at the bar\'s buttons, so they must be on screen');
  assert.equal(model({ student: false, min: true }).min, false, 'never for the teacher');
  assert.match(model({ student: true, worksheet: true, practising: true, min: true }).tabNow, /Practising/,
    'a folded bar still says practice is on');
  assert.equal(model({ student: true, worksheet: true, min: true }).tabNow, '');
});

test('folding is remembered per device and only hides buttons', () => {
  const fold = cut('/* ---- ▴ THE BAR FOLDS AWAY', 'function studentBarSync()');
  assert.match(fold, /STUDENT_BAR_MIN_KEY = 'polymath\.studentBarMin\.v1'/);
  assert.match(fold, /try \{ studentBarMinMem = localStorage\.getItem\(STUDENT_BAR_MIN_KEY\)/, 'a blocked storage read cannot throw');
  assert.match(fold, /function studentBarSetMin\(on\) \{\n  if \(!isStudent\(\)\) return;/);
  assert.match(cut('function studentGuideOpen()', 'function studentGuideGo('), /studentBarTourHold = true;\s*studentBarSync\(\);/);
  assert.match(cut('function studentGuideClose()', 'var studentGuideAutoTimer'), /studentBarTourHold = false; studentBarSync\(\);/);
  assert.match(html, /#studentBar\.sbMin \.sbRow \{ display:none; \}/);
  assert.match(html, /id="sbHideBtn"/);
  assert.match(html, /id="sbShowBtn"/);
});

test('the tour card is always on screen', () => {
  const view = { w: 1000, h: 800 }, card = { w: 360, h: 220 };
  const below = ctx.studentGuidePlace({ left: 20, top: 60, width: 40, height: 30, right: 60, bottom: 90 }, card, view);
  assert.equal(below.side, 'below');
  assert.equal(below.left, 16, 'clamped to the left gutter');
  assert.equal(below.top, 104);
  const above = ctx.studentGuidePlace({ left: 900, top: 700, width: 80, height: 40, right: 980, bottom: 740 }, card, view);
  assert.equal(above.side, 'above');
  assert.equal(above.left, 1000 - 360 - 16, 'clamped to the right gutter');
  assert.ok(above.top + 220 <= 700);
  const centre = ctx.studentGuidePlace(null, card, view);
  assert.equal(centre.side, 'centre');
  assert.equal(centre.left, 320);
  const tall = ctx.studentGuidePlace({ left: 400, top: 300, width: 100, height: 200, right: 500, bottom: 500 }, { w: 360, h: 400 }, view);
  assert.equal(tall.side, 'centre');
  const phone = ctx.studentGuidePlace(null, { w: 360, h: 200 }, { w: 320, h: 600 });
  assert.equal(phone.left, 16, 'a card wider than a phone is shrunk to its gutters');
});

test('practice and the videos are always in the tour', () => {
  const steps = vm.runInContext('STUDENT_GUIDE_STEPS', ctx);
  const practice = steps.find(s => /Practise/.test(s.title));
  const videos = steps.find(s => /video/i.test(s.title));
  assert.ok(practice && practice.always && practice.away, 'practice says where it will appear');
  assert.ok(videos && videos.always && videos.away, 'videos say where they will appear');
  assert.ok(steps.indexOf(practice) < 4 && steps.indexOf(videos) < 4, 'both come early');
});

test('every bar button goes through the existing door, and asks the role', () => {
  const wiring = cut("$('sbWorksheetsBtn').addEventListener", '/* ================= ❓ THE BUTTON TOUR');
  assert.match(wiring, /sbPracticeBtn'\)\.addEventListener\('click', function \(\) \{ if \(isStudent\(\) && !practiceMode\) startPractice\(\); \}\)/);
  assert.match(wiring, /sbMarkAllBtn[^\n]*isStudent\(\)[^\n]*checkAllAnswers\(\)/);
  assert.match(wiring, /sbCheckBtn[^\n]*isStudent\(\)[^\n]*checkAnswer\(\)/);
  assert.match(wiring, /sbStopBtn[^\n]*isStudent\(\)[^\n]*endPractice\(\)/);
  assert.match(wiring, /sbRecordingBtn[^\n]*isStudent\(\)[^\n]*openVideoModal\(\)/);
  const vids = cut('function studentBarVideos()', "$('sbWorksheetsBtn')");
  assert.match(vids, /if \(!isStudent\(\)\) return;/);
  assert.match(vids, /lessonPlaylistStart\(0\)/);
  assert.match(vids, /lessonPlaylistTogglePanel\(\)/);
});

test('the bar follows the role, practice, the playlist and the recording', () => {
  const role = cut('function applyRoleUI() {', 'async function signIn()');
  assert.match(role, /studentBarSync\(\);\s*studentGuideMaybeAuto\(\);/);
  assert.match(cut('function updatePracticeCard()', 'function startPractice()'), /studentBarSync\(\)/);
  assert.match(cut('function lessonPlaylistSync()', '/* ---- The list ---- */'), /studentBarSync\(\)/);
  assert.match(cut('function renderVideoCard()', 'function formatOffset('), /studentBarSync\(\)/);
  assert.match(html, /closest\('#playlistBtn, #sbVideosBtn'\)/, 'the bar button does not close the panel it opens');
});

test('the tour opens by itself only for a real signed-in student, once', () => {
  const auto = cut('function studentGuideMaybeAuto()', '/* ================= ');
  assert.match(auto, /!isAdmin\(currentUser\) && !actingStudent && !isSharedVisitor\(\)/);
  assert.match(auto, /localStorage\.getItem\(studentGuideSeenKey\(\)\)/);
  assert.match(auto, /\.modalBack\.open:not\(\.floatWin\)/, 'it waits for the level/subject form');
  const close = cut('function studentGuideClose()', 'var studentGuideAutoTimer');
  assert.match(close, /localStorage\.setItem\(studentGuideSeenKey\(\), '1'\)/);
  assert.match(cut('function studentGuideBuild()', 'function studentGuideOpen()'), /e\.stopPropagation\(\)/,
    'a key pressed in the tour never reaches a one-letter tool shortcut');
});

test('every icon a student can reach carries a name', () => {
  for (const id of ['burgerBtn', 'playlistBtn', 'calcBtn', 'thumbToggleBtn', 'sideToggleBtn', 'fsBtn', 'askPageBtn', 'fitBtn']) {
    assert.match(html, new RegExp('id="' + id + '" data-label="[^"]+"'), id);
  }
  for (const tool of ['pen', 'text', 'eraser', 'keyword', 'laser']) {
    assert.match(html, new RegExp('data-tool="' + tool + '" data-key="[^"]+" data-label="[^"]+"'), tool);
  }
  assert.match(html, /body\.studentView \.toolBtn\[data-label\]::after \{ content:attr\(data-label\)/);
});
