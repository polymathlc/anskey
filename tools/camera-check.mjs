/* =====================================================================
   🎥 A LESSON WITH THE CAMERA — in a real browser, with a real camera
   ---------------------------------------------------------------------
   tools/recording-camera-tests.mjs runs the shipped code against fakes and
   asks what it DOES with them. What no fake can say is whether a browser
   really lists its cameras, really shows one in the preview, really moves
   the level bar when a microphone hears something, really records a file a
   <video> will play and seek — and whether the page, laid out, looks like
   the thing that was asked for.

   Chromium's own fake camera and microphone stand in for the hardware:
   a moving test pattern and a beeping tone, granted without a prompt. Like
   tools/picture-check.mjs this needs a real Chromium, so it is a tool you
   reach for rather than a gate:

     node tools/camera-check.mjs
     PW=/path/to/playwright/index.mjs node tools/camera-check.mjs
     SHOTS=/some/dir node tools/camera-check.mjs     # keep the screenshots
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) {
  console.log('camera-check: no Playwright at ' + PW + ' — skipped.');
  console.log('  set PW=/path/to/playwright/index.mjs to run it.');
  process.exit(0);
}

const FILE = pathToFileURL(path.resolve(process.argv[2] || 'index.html')).href;
const SHOTS = process.env.SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (note ? '\n      ' + note : '')); }
};
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

const browser = await chromium.launch({ args: [
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, permissions: ['camera', 'microphone'] });
const page = await ctx.newPage();
/* pdf.js and the Firebase SDK come off a CDN a sandbox may not reach; a chain
   proxy lets the script run to its end. Nothing under these names is used. */
await page.addInitScript(() => {
  const chain = () => new Proxy(function () { return chain(); }, {
    get: (t, k) => (k === 'then' ? undefined : chain()),
    apply: () => chain(), construct: () => chain(), set: () => true
  });
  window.pdfjsLib = chain(); window.firebase = chain(); window.grecaptcha = chain();
  // Every stream the page ever opens, so "all of it was let go" can be counted.
  const opened = window.__opened = [];
  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async c => { const s = await real(c); opened.push({ c: JSON.parse(JSON.stringify(c)), s }); return s; };
  window.__live = () => opened.reduce((n, o) => n + o.s.getTracks().filter(t => t.readyState === 'live').length, 0);
});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(FILE);
await page.waitForTimeout(1200);
ok('the page loads with no uncaught error', errors.length === 0, errors.join('\n      '));

/* One page and a signed-in teacher, the way the app has them once a worksheet
   is open — the real overlay and the real recorder behind it. */
await page.evaluate(() => {
  const W = 600, H = 780;
  const wrap = document.createElement('div');
  wrap.className = 'pageWrap';
  wrap.style.cssText = 'position:relative;flex:none;width:' + W + 'px;height:' + H + 'px;min-width:' + W + 'px;min-height:' + H + 'px;background:#fff';
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' });
  svg.classList.add('overlay');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  wrap.appendChild(canvas); wrap.appendChild(svg);
  $('viewerArea').appendChild(wrap);
  const p = { num: 1, baseW: W, baseH: H, wrap, canvas, svg };
  pages = [p]; pdfDoc = {}; scale = 1; annotations = [];
  attachOverlayHandlers(p);
  currentUser = { uid: 'teacher', email: ADMIN_EMAIL, getIdToken: async () => 'token' };
  currentDocId = 'doc1'; pdfBytes = new Uint8Array([37, 80, 68, 70]);
  ['saveBtn', 'blankPageBtn', 'deletePageBtn'].forEach(id => { $(id).disabled = false; });
  // The cloud is out of reach here: the upload and the worksheet write land in
  // memory, where the replay below picks them up again.
  window.__uploaded = {};
  storage = { ref: p2 => ({ fullPath: p2,
    put: blob => { window.__uploaded[p2] = blob; return Promise.resolve(); },
    getDownloadURL: async () => URL.createObjectURL(window.__uploaded[p2]) }) };
  writeAnnotations = async () => {};
  scheduleAutoSave = () => {};
  lessonAssetUrl = u => u;
  lessonReadManifest = async url => JSON.parse(await (await fetch(url)).text());
  setTool('select');
});

console.log('\n🎥 The window lists the real devices and opens only what is asked for');
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} lessonOpenModal(); });
await page.waitForFunction(() => lessonDev.micState === 'live', null, { timeout: 8000 }).catch(() => {});
const opened = await page.evaluate(() => ({
  open: $('lessonModal').classList.contains('open'),
  cams: Array.from($('lessonCamSelect').options).map(o => o.textContent),
  mics: Array.from($('lessonMicSelect').options).map(o => o.textContent),
  camValue: $('lessonCamSelect').value,
  asked: window.__opened.map(o => Object.keys(o.c)[0]),
  mic: lessonDev.micState, cam: lessonDev.camState,
  off: $('lessonCamOffText').textContent, size: $('lessonSizeHint').textContent,
  testReady: !$('lessonTestBtn').disabled
}));
ok('the window opens', opened.open);
ok('the camera list names the real camera, after "No camera"',
   opened.cams[0].startsWith('No camera') && opened.cams.some(c => /fake_device/.test(c)), JSON.stringify(opened.cams));
ok('the microphone list names the default and every input',
   /^Default — /.test(opened.mics[0]) && opened.mics.length >= 3, JSON.stringify(opened.mics));
ok('with nothing chosen only the MICROPHONE was opened — no camera light',
   opened.asked.join() === 'audio' && opened.cam === 'off' && opened.camValue === '', JSON.stringify(opened.asked));
ok('the stage says the camera is off, and the size line says what voice-only costs',
   /Camera off/.test(opened.off) && /^Voice and writing only/.test(opened.size), opened.off + ' | ' + opened.size);
ok('Test sound is ready', opened.testReady && opened.mic === 'live');

const heard = await page.waitForFunction(() => lessonDev.painted > 20 || lessonDev.heard, null, { timeout: 6000 }).then(() => true).catch(() => false);
const meter = await page.evaluate(() => ({ painted: lessonDev.painted, width: $('lessonMeterFill').style.width, hint: $('lessonMicHint').textContent }));
ok('the level bar MOVES with what the microphone hears', heard, JSON.stringify(meter));

console.log('\n📷 Choosing the camera shows it, mirrored');
await page.selectOption('#lessonCamSelect', { index: 1 });
await page.waitForFunction(() => $('lessonCamPreview').videoWidth > 0, null, { timeout: 8000 }).catch(() => {});
const preview = await page.evaluate(() => {
  const v = $('lessonCamPreview'), r = v.getBoundingClientRect(), stage = $('lessonCamStage').getBoundingClientRect();
  return { w: v.videoWidth, h: v.videoHeight, shown: !v.hidden && r.width > 100, mirror: getComputedStyle(v).transform,
    offHidden: $('lessonCamOff').hidden, mirrorRow: !$('lessonMirrorRow').hidden, ratio: +(stage.width / stage.height).toFixed(2),
    size: $('lessonSizeHint').textContent, remembered: localStorage.getItem('polymath.lessonCamera') };
});
ok('the preview shows the camera', preview.shown && preview.w > 0, JSON.stringify(preview));
ok('…at the framing the recording will use', preview.w === 640 && preview.h === 360, preview.w + '×' + preview.h);
ok('…mirrored, like every video call', /matrix\(-1/.test(preview.mirror), preview.mirror);
ok('…in a 16 : 9 stage, with its mirror switch shown', preview.ratio > 1.7 && preview.ratio < 1.8 && preview.offHidden && preview.mirrorRow);
ok('the choice is remembered on this device', /fake_device/.test(preview.remembered || ''), preview.remembered);
ok('the size line now says what a minute with the camera costs', /^Camera on: about 4\.3 MB a minute/.test(preview.size), preview.size);
await shot(page, '1-lesson-window');

console.log('\n🔊 Test sound records a few seconds and plays them back');
await page.click('#lessonTestBtn');
const listening = await page.evaluate(() => $('lessonTestBtn').textContent);
ok('the button counts down while it listens', /^Listening… 4/.test(listening), listening);
const played = await page.waitForFunction(() => lessonDev.test && lessonDev.test.phase === 'playing', null, { timeout: 9000 }).then(() => true).catch(() => false);
const playing = await page.evaluate(() => ({ src: $('lessonTestAudio').src, paused: $('lessonTestAudio').paused, hint: $('lessonMicHint').textContent }));
ok('…then plays it back from memory', played && /^blob:/.test(playing.src) && !playing.paused, JSON.stringify(playing));
const ended = await page.waitForFunction(() => !lessonDev.test, null, { timeout: 12000 }).then(() => true).catch(() => false);
const after = await page.evaluate(() => ({ hint: $('lessonMicHint').textContent, src: $('lessonTestAudio').getAttribute('src') }));
ok('…and says so when it has finished, letting the file go', ended && /how you will sound/.test(after.hint) && !after.src, JSON.stringify(after));

console.log('\n⌨ Nothing typed in the window reaches the worksheet');
await page.focus('#lessonTestBtn');
await page.keyboard.press('p');
ok('a letter pressed in the window does not change the tool behind it', await page.evaluate(() => tool) === 'select');

console.log('\n⏺ Start records the camera and the microphone into one file');
const liveBefore = await page.evaluate(() => window.__live());
await page.evaluate(() => { window.__startedAt = window.__opened.length; lessonStart(); });
await page.waitForFunction(() => lessonCapture && lessonCapture.phase === 'recording', null, { timeout: 10000 }).catch(() => {});
const rec = await page.evaluate(() => {
  const c = lessonCapture, s = c && c.recorder && c.recorder.stream;
  const since = window.__opened.slice(window.__startedAt);
  return {
    phase: c && c.phase, window: $('lessonModal').classList.contains('open'),
    video: s ? s.getVideoTracks().length : -1, audio: s ? s.getAudioTracks().length : -1,
    mime: c && c.recorder && c.recorder.mimeType,
    mixed: s ? s.getAudioTracks()[0] === c.destination.stream.getAudioTracks()[0] : false,
    exactCam: since.some(o => o.c.video && o.c.video.deviceId && o.c.video.deviceId.exact),
    thumb: !$('lessonLiveCam').hidden && $('lessonLiveCam').srcObject === c.camStream,
    status: $('lessonStatus').textContent, live: window.__live()
  };
});
ok('the preview let go before the recording opened its own devices', liveBefore === 2 && !rec.window, 'live before: ' + liveBefore);
ok('it is recording', rec.phase === 'recording', rec.phase);
ok('ONE stream: the camera track beside the mixed microphone', rec.video === 1 && rec.audio === 1 && rec.mixed, JSON.stringify(rec));
ok('…recorded as video', /^video\//.test(rec.mime || ''), rec.mime);
ok('…from the camera that was previewed, exactly', rec.exactCam);
ok('the teacher sees the camera live in the recording bar', rec.thumb);
ok('the bar says they are being recorded', /^Recording you and your explanation/.test(rec.status), rec.status);
ok('exactly the recording\'s own camera and microphone are live', rec.live === 2, 'live tracks: ' + rec.live);
await page.evaluate(() => { annotations.push({ id: 'ink1', page: 1, type: 'pen', color: '#1565C0', width: 3, points: [{ x: 80, y: 90 }, { x: 260, y: 150 }] }); renderAllOverlays(); setDirty(true); });
await page.waitForTimeout(1500);
await page.evaluate(() => { annotations[0].points.push({ x: 400, y: 260 }); renderAllOverlays(); setDirty(true); });
await page.waitForTimeout(1500);
await shot(page, '2-recording-bar');
await page.evaluate(() => lessonStop());
const saved = await page.waitForFunction(() => !lessonCapture && !lessonPending && annotations.some(a => a.lessonRecording), null, { timeout: 15000 }).then(() => true).catch(() => false);
const pill = await page.evaluate(() => {
  const a = annotations.find(x => x.lessonRecording);
  const media = Object.keys(window.__uploaded).find(k => !k.endsWith('.json'));
  return { a, media, type: media && window.__uploaded[media].type, size: media && window.__uploaded[media].size, live: window.__live() };
});
ok('Stop saves it as a lesson on the page', saved && !!pill.a, JSON.stringify(pill.a || null));
ok('…flagged and labelled as a video lesson', pill.a && pill.a.lessonRecording.video === true && /^Play video lesson · 0:0[2-4]$/.test(pill.a.label), pill.a && pill.a.label);
ok('…uploaded as a video file', /^video\//.test(pill.type || '') && pill.size > 5000, pill.media + ' ' + pill.type + ' ' + pill.size);
ok('the camera and the microphone are both let go', pill.live === 0, 'live tracks: ' + pill.live);

const file = await page.evaluate(async () => {
  const media = Object.keys(window.__uploaded).find(k => !k.endsWith('.json'));
  const v = document.createElement('video'); v.muted = true;
  v.src = URL.createObjectURL(window.__uploaded[media]);
  await new Promise(r => { v.onloadedmetadata = r; v.onerror = r; setTimeout(r, 5000); });
  const duration = v.duration;
  v.currentTime = 1.5;
  await new Promise(r => { v.onseeked = r; setTimeout(r, 3000); });
  return { duration, w: v.videoWidth, h: v.videoHeight, seeked: v.currentTime };
});
ok('the saved file plays as video, with a FINITE duration', Number.isFinite(file.duration) && file.duration > 2 && file.w === 640, JSON.stringify(file));
ok('…and it seeks', Math.abs(file.seeked - 1.5) < 0.3, String(file.seeked));

console.log('\n▶ The replay plays the video in its own window, and the writing follows it');
await page.evaluate(() => lessonPlay(annotations.find(x => x.lessonRecording)));
await page.waitForFunction(() => lessonPlayback && $('lessonVideo').currentTime > 0.8, null, { timeout: 10000 }).catch(() => {});
const replay = await page.evaluate(() => {
  const win = $('lessonCamWin'), r = win.getBoundingClientRect(), v = $('lessonVideo');
  return {
    playing: !!lessonPlayback && !v.paused, t: v.currentTime, w: v.videoWidth,
    audioHidden: $('lessonAudio').hidden, audioSrc: $('lessonAudio').getAttribute('src'),
    win: { shown: !win.hidden, left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width },
    title: $('lessonPlayerTitle').textContent,
    strokes: pages[0].wrap.querySelectorAll('.lessonReplayOverlay > *').length,
    pillIcon: !!document.querySelector('.videoAnnBtn svg rect')
  };
});
ok('the video plays, and IT is the clock', replay.playing && replay.t > 0.8 && replay.w === 640, JSON.stringify(replay));
ok('the audio bar is hidden rather than playing a second copy', replay.audioHidden && !replay.audioSrc);
ok('the window sits inside the screen, in the corner', replay.win.shown && replay.win.left > 0 && replay.win.right <= 1100 && replay.win.bottom <= 900 && replay.win.width === 320, JSON.stringify(replay.win));
ok('the writing is drawn back over the page', replay.strokes > 0, 'nodes: ' + replay.strokes);
ok('the page pill wears a camera', replay.pillIcon);
await shot(page, '3-replay');
const bar = await page.$('#lessonCamWinBar');
const box = await bar.boundingBox();
await page.mouse.move(box.x + 40, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x - 500, box.y - 400, { steps: 6 });
await page.mouse.up();
const moved = await page.evaluate(() => { const r = $('lessonCamWin').getBoundingClientRect(); return { left: r.left, top: r.top }; });
ok('the window is dragged by its bar', Math.abs(moved.left - (box.x - 500 - 40 + 10)) < 30 || moved.left < box.x - 300, JSON.stringify(moved));
await page.mouse.move(box.x - 500, 200); await page.mouse.down(); await page.mouse.move(-4000, -4000, { steps: 4 }); await page.mouse.up();
const edge = await page.evaluate(() => { const r = $('lessonCamWin').getBoundingClientRect(); return { left: r.left, top: r.top }; });
ok('…and cannot be dragged off the screen', edge.left >= 8 && edge.top >= 8, JSON.stringify(edge));
await page.click('#lessonCamWinSize');
const bigger = await page.evaluate(() => $('lessonCamWin').getBoundingClientRect().width);
ok('the size button makes it bigger', bigger === 480, String(bigger));
await page.evaluate(() => lessonExitPlayback());
const closed = await page.evaluate(() => ({ hidden: $('lessonCamWin').hidden, src: $('lessonVideo').getAttribute('src'), audio: !$('lessonAudio').hidden }));
ok('closing the replay closes the window and unloads the video', closed.hidden && !closed.src && closed.audio, JSON.stringify(closed));

console.log('\n🚪 Every way out of the window lets go of the camera');
for (const [name, act] of [['Escape', 'key'], ['Cancel', '#lessonCancelBtn'], ['✕', '#lessonCloseBtn']]) {
  await page.evaluate(() => lessonOpenModal());
  await page.waitForFunction(() => lessonDev.camState === 'live' && lessonDev.micState === 'live', null, { timeout: 8000 }).catch(() => {});
  const was = await page.evaluate(() => window.__live());
  if (act === 'key') await page.keyboard.press('Escape'); else await page.click(act);
  const now = await page.evaluate(() => ({ live: window.__live(), open: $('lessonModal').classList.contains('open') }));
  ok(name + ' closes the window with nothing left capturing', was === 2 && now.live === 0 && !now.open, 'before ' + was + ', after ' + JSON.stringify(now));
}

ok('no uncaught error anywhere along the way', errors.length === 0, errors.join('\n      '));
await browser.close();
console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ all ') + pass + ' passed');
process.exit(fail ? 1 : 0);
