/* =====================================================================
   📺 RECORDING THE WORKSHEET WINDOW — in a real browser, sharing its own tab
   ---------------------------------------------------------------------
   A lesson recording used to carry the voice, the camera and the INK, so a
   bank question's window and its 🧩 app — a sandboxed frame — never reached
   it. With "Record the worksheet window" ticked, the browser shares its own
   tab, the frames are cropped to the worksheet area on a canvas, and that is
   the lesson's video.

   Nothing that reads the source can say whether a browser really shares the
   tab, whether the crop really leaves the toolbar out, or whether the
   pixels drawn INSIDE a sandboxed app frame really land in the file. This
   does: Chromium is told to accept "share this tab" by itself
   (--auto-accept-this-tab-capture), the toolbar and the header are painted
   lime, an app frame paints itself magenta, and the saved file is decoded
   and its pixels counted.

     node tools/screen-record-check.mjs
     PW=/path/to/playwright/index.mjs node tools/screen-record-check.mjs
     SHOTS=/some/dir node tools/screen-record-check.mjs
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) {
  console.log('screen-record-check: no Playwright at ' + PW + ' — skipped.');
  process.exit(0);
}

const FILE = pathToFileURL(path.resolve(process.argv[2] || 'index.html')).href;
const SHOTS = process.env.SHOTS || process.env.QB_SCREENSHOTS || '';
// (A share of a whole screen or another window is recorded whole; that
// decision is pure and pinned in tools/lesson-screen-tests.mjs.)
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (note ? '\n      ' + note : '')); }
};
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'screen-' + name + '.png') }); };

/* The full Chromium (its new headless mode) can capture a tab; the stripped
   headless shell cannot. --use-fake-ui-for-media-stream must NOT be passed:
   it turns "share this tab" into a fake monitor. */
async function launch(extra) {
  const args = ['--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'].concat(extra);
  try { return await chromium.launch({ channel: 'chromium', args }); }
  catch (e) { return chromium.launch({ args }); }
}
/* The window's own size, not an emulated viewport: a tab capture is of the
   real surface, and an emulated viewport larger than the window would be a
   page shape no real tab ever has. */
const browser = await launch(['--auto-accept-this-tab-capture', '--window-size=1100,820']);
const ctx = await browser.newContext({ viewport: null, permissions: ['camera', 'microphone'] });
const page = await ctx.newPage();
// The real Firebase SDK, reached on a CI runner, would replace the stub below
// and throw on it; served empty, the stub stands (as in question-bank-check).
await page.route(/firebase-[a-z]+-compat\.js(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/javascript', body: '' }));
await page.addInitScript(() => {
  const chain = () => new Proxy(function () { return chain(); }, {
    get: (t, k) => (k === 'then' ? undefined : chain()),
    apply: () => chain(), construct: () => chain(), set: () => true
  });
  window.pdfjsLib = chain(); window.firebase = chain(); window.grecaptcha = chain();
  const shared = window.__shared = [];
  const real = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getDisplayMedia = async c => { const s = await real(c); shared.push(s); return s; };
  window.__sharing = () => shared.reduce((n, s) => n + s.getTracks().filter(t => t.readyState === 'live').length, 0);
});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(FILE);
await page.waitForTimeout(1200);
ok('the page loads with no uncaught error', errors.length === 0, errors.join('\n      '));

const supported = await page.evaluate(() => lessonScreenSupported());
if (!supported) {
  console.log('  (this Chromium cannot share a tab — skipped)');
  await browser.close();
  process.exit(0);
}

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
  const fakePage = { getViewport: o => ({ width: W * o.scale, height: H * o.scale }),
    render: () => ({ promise: Promise.resolve(), cancel() {} }), getTextContent: async () => ({ items: [] }) };
  const p = { num: 1, baseW: W, baseH: H, wrap, canvas, svg, page: fakePage };
  pages = [p]; pdfDoc = {}; scale = 1; annotations = [];
  attachOverlayHandlers(p);
  currentUser = { uid: 'teacher', email: ADMIN_EMAIL, getIdToken: async () => 'token' };
  currentDocId = 'doc1'; docName = 'Heat worksheet'; pdfBytes = new Uint8Array([37, 80, 68, 70]);
  ['saveBtn', 'blankPageBtn', 'deletePageBtn'].forEach(id => { $(id).disabled = false; });
  window.__uploaded = {};
  storage = { ref: p2 => ({ fullPath: p2,
    put: blob => { window.__uploaded[p2] = blob; return Promise.resolve(); },
    getDownloadURL: async () => URL.createObjectURL(window.__uploaded[p2]) }) };
  writeAnnotations = async () => {};
  scheduleAutoSave = () => {};
  lessonAssetUrl = u => u;
  lessonReadManifest = async url => JSON.parse(await (await fetch(url)).text());
  setTool('select');
  applyRoleUI();
  // Lime is the colour of everything that must NOT be in the video.
  const lime = document.createElement('style');
  lime.textContent = '.polymath-header, #toolbar { background: rgb(0,255,0) !important; }';
  document.head.appendChild(lime);
});

console.log('\n📺 The window offers to record the worksheet window');
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} lessonOpenModal(); });
await page.waitForFunction(() => lessonDev.micState === 'live', null, { timeout: 8000 }).catch(() => {});
const before = await page.evaluate(() => ({
  shown: !!$('lessonScreenSec') && $('lessonScreenSec').getBoundingClientRect().height > 40,
  checked: $('lessonScreen').checked, disabled: $('lessonScreen').disabled,
  size: $('lessonSizeHint').textContent, hint: $('lessonScreenHint').textContent
}));
ok('the switch is in the window, off until asked for', before.shown && !before.checked && !before.disabled, JSON.stringify(before));
await page.click('#lessonScreen');
const after = await page.evaluate(() => ({
  checked: $('lessonScreen').checked, on: $('lessonScreenSec').classList.contains('on'),
  size: $('lessonSizeHint').textContent, hint: $('lessonScreenHint').textContent,
  remembered: localStorage.getItem('polymath.lessonScreen'), choice: lessonDevChoice().screen
}));
ok('ticking it is remembered and read by Start', after.checked && after.on && after.remembered === 'true' && after.choice === true, JSON.stringify(after));
ok('the size line says what a minute of the window costs', /^Window recording on: about 18\.\d MB a minute/.test(after.size), after.size);
ok('the hint says to choose This tab', /This tab/.test(after.hint), after.hint);
await shot(page, '1-window');

console.log('\n⏺ Start shares this tab and records the cropped window');
await page.click('#lessonStartBtn');
await page.waitForFunction(() => lessonCapture && lessonCapture.phase === 'recording', null, { timeout: 15000 }).catch(() => {});
/* Opened mid-lesson: a question window with its app, the way question-bank.js draws one: a
   .qbBack overlay holding a sandboxed app frame. The app paints itself
   magenta from INSIDE the frame — exactly what the page can never read. */
await page.evaluate(() => {
  const back = document.createElement('div');
  back.className = 'qbBack qbWinBack in';
  back.id = 'testQbBack';
  back.innerHTML = '<div class="qbWin" tabindex="-1" style="padding:16px"><h2 style="margin:0 0 10px">Question</h2>' +
    QuestionApps.frame({ title: 'App', height: 260, html: '<div style="position:fixed;inset:0;background:#ff00ff"></div>' }) + '</div>';
  document.body.appendChild(back);
});

await page.waitForTimeout(400);
const rec = await page.evaluate(() => {
  const c = lessonCapture, s = c && c.recorder && c.recorder.stream;
  const area = $('viewerArea').getBoundingClientRect(), bar = $('barStack').getBoundingClientRect();
  const qb = $('testQbBack').getBoundingClientRect(), tb = $('toolbar').getBoundingClientRect();
  return {
    phase: c && c.phase, status: $('lessonStatus').textContent,
    video: s ? s.getVideoTracks().length : -1, audio: s ? s.getAudioTracks().length : -1,
    canvasTrack: !!(c && c.screenRec && s && s.getVideoTracks()[0] === c.screenRec.out.getVideoTracks()[0]),
    mixed: s ? s.getAudioTracks()[0] === c.destination.stream.getAudioTracks()[0] : false,
    self: c && c.screenRec && c.screenRec.self, size: c && c.screenRec && [c.screenRec.canvas.width, c.screenRec.canvas.height],
    areaSize: [Math.round(area.width), Math.round(area.height)],
    bodyClass: document.body.classList.contains('lessonScreenRec'),
    barBottom: bar.bottom, areaTop: area.top, toolbarBottom: tb.bottom,
    qb: { top: Math.round(qb.top), left: Math.round(qb.left), w: Math.round(qb.width), h: Math.round(qb.height) },
    area: { top: Math.round(area.top), left: Math.round(area.left), w: Math.round(area.width), h: Math.round(area.height) },
    mime: c && c.recorder && c.recorder.mimeType, sharing: window.__sharing(),
    floating: ['favBar', 'toolbarToggleBtn'].map(id => getComputedStyle($(id)).visibility)
  };
});
ok('it is recording, and says it is recording the window', rec.phase === 'recording' && /^Recording the window and your explanation/.test(rec.status), JSON.stringify(rec));
ok('ONE stream: the cropped window\'s canvas beside the mixed microphone', rec.video === 1 && rec.audio === 1 && rec.canvasTrack && rec.mixed, JSON.stringify(rec));
ok('…the share is this tab, so it is cropped', rec.self === true && rec.sharing >= 1);
ok('…to the worksheet area\'s own size', rec.size && Math.abs(rec.size[0] - rec.areaSize[0]) <= 2 && Math.abs(rec.size[1] - rec.areaSize[1]) <= 2, JSON.stringify([rec.size, rec.areaSize]));
ok('the worksheet area starts below the toolbar', rec.areaTop >= rec.toolbarBottom - 1, rec.areaTop + ' vs ' + rec.toolbarBottom);
ok('the recording bar moved up, out of the recorded area', rec.bodyClass && rec.barBottom <= rec.areaTop + 1, rec.barBottom + ' vs ' + rec.areaTop);
ok('an open question window fits inside the recorded area', JSON.stringify(rec.qb) === JSON.stringify(rec.area), JSON.stringify(rec.qb) + ' vs ' + JSON.stringify(rec.area));
ok('…recorded as video', /^video\//.test(rec.mime || ''), rec.mime);
ok('the floating tool bars inside the area are out of the video too', rec.floating.every(v => v === 'hidden'), JSON.stringify(rec.floating));
await page.waitForTimeout(2600);
await shot(page, '2-recording');
await page.evaluate(() => lessonStop());
const saved = await page.waitForFunction(() => !lessonCapture && !lessonPending && annotations.some(a => a.lessonRecording), null, { timeout: 20000 }).then(() => true).catch(() => false);
const pill = await page.evaluate(() => {
  const a = annotations.find(x => x.lessonRecording);
  const media = Object.keys(window.__uploaded).find(k => !k.endsWith('.json'));
  return { rec: a && a.lessonRecording, label: a && a.label, type: media && window.__uploaded[media].type, size: media && window.__uploaded[media].size,
    sharing: window.__sharing(), bodyClass: document.body.classList.contains('lessonScreenRec'),
    vars: document.body.style.getPropertyValue('--lsr-top') };
});
ok('Stop saves it as a video lesson flagged as the window', saved && pill.rec && pill.rec.video === true && pill.rec.screen === true, JSON.stringify(pill));
ok('…uploaded as a video file', /^video\//.test(pill.type || '') && pill.size > 5000, pill.type + ' ' + pill.size);
ok('the share is let go, and the page is back to normal', pill.sharing === 0 && !pill.bodyClass && !pill.vars, JSON.stringify(pill));

/* The file itself, decoded: magenta from inside the app frame is in it, the
   lime toolbar and header are not. */
const pixels = await page.evaluate(async () => {
  const media = Object.keys(window.__uploaded).find(k => !k.endsWith('.json'));
  const v = document.createElement('video'); v.muted = true;
  v.src = URL.createObjectURL(window.__uploaded[media]);
  await new Promise(r => { v.onloadedmetadata = r; v.onerror = r; setTimeout(r, 6000); });
  v.currentTime = 1.6;
  await new Promise(r => { v.onseeked = r; setTimeout(r, 4000); });
  const cnv = document.createElement('canvas'); cnv.width = v.videoWidth; cnv.height = v.videoHeight;
  const g = cnv.getContext('2d'); g.drawImage(v, 0, 0);
  const d = g.getImageData(0, 0, cnv.width, cnv.height).data;
  let magenta = 0, lime = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 200 && d[i + 1] < 80 && d[i + 2] > 200) magenta++;
    if (d[i] < 90 && d[i + 1] > 200 && d[i + 2] < 90) lime++;
  }
  return { w: v.videoWidth, h: v.videoHeight, duration: v.duration, magenta, lime, total: d.length / 4 };
});
ok('the saved file plays, with a FINITE duration', Number.isFinite(pixels.duration) && pixels.duration > 2, JSON.stringify(pixels));
ok('…at the worksheet area\'s shape', Math.abs(pixels.w / pixels.h - rec.areaSize[0] / rec.areaSize[1]) < 0.03, JSON.stringify(pixels));
ok('the question app — drawn inside its sandboxed frame — IS in the video', pixels.magenta > pixels.total * 0.03, JSON.stringify(pixels));
ok('the toolbar and the header are NOT', pixels.lime < pixels.total * 0.002, JSON.stringify(pixels));
await page.evaluate(() => $('testQbBack').remove());

console.log('\n▶ The replay plays the recorded window large');
await page.evaluate(() => lessonPlay(annotations.find(x => x.lessonRecording)));
await page.waitForFunction(() => lessonPlayback && $('lessonVideo').currentTime > 0.6, null, { timeout: 10000 }).catch(() => {});
const replay = await page.evaluate(() => {
  const win = $('lessonCamWin');
  return { playing: !!lessonPlayback && !$('lessonVideo').paused, screen: lessonPlayback && lessonPlayback.screen,
    width: win.getBoundingClientRect().width, title: win.querySelector('.lessonCamWinTitle').textContent,
    player: $('lessonPlayerTitle').textContent };
});
ok('the video plays, flagged as the window', replay.playing && replay.screen === true, JSON.stringify(replay));
ok('…in a window far bigger than a face', replay.width === 760 && /recorded window/.test(replay.title), JSON.stringify(replay));
ok('…and the player says what it is', /window as it was recorded/.test(replay.player), replay.player);
await shot(page, '3-replay');
await page.evaluate(() => lessonExitPlayback());
const back = await page.evaluate(() => ({ width: (lessonPlayback ? -1 : 0), title: document.querySelector('.lessonCamWinTitle').textContent }));
ok('a camera lesson after it gets its ordinary window back', back.width === 0);

console.log('\n⬇ The 1080p export uses the recorded window as the picture');
await page.evaluate(() => lessonExportOpen(annotations.find(x => x.lessonRecording)));
await page.waitForFunction(() => lessonExportJob && (lessonExportJob.phase === 'ready' || lessonExportJob.phase === 'failed'), null, { timeout: 20000 }).catch(() => {});
const exp = await page.evaluate(async () => {
  const job = lessonExportJob;
  job.media.currentTime = 1.6;
  await new Promise(r => { job.media.onseeked = r; setTimeout(r, 4000); });
  lessonExportDraw(job, 6000, 0);
  const d = job.ctx.getImageData(0, 0, 1920, 1080).data;
  let magenta = 0;
  for (let i = 0; i < d.length; i += 16) if (d[i] > 200 && d[i + 1] < 80 && d[i + 2] > 200) magenta++;
  return { phase: job.phase, screen: job.screen, rasters: Object.keys(job.rasters).length,
    layoutHidden: $('lessonExportLayoutRow').hidden, modeHidden: $('lessonExportModeRow').hidden, magenta };
});
ok('it is ready, with no page rasterised for it', exp.phase === 'ready' && exp.screen === true && exp.rasters === 0, JSON.stringify(exp));
ok('…the page-framing choices are hidden', exp.layoutHidden && exp.modeHidden, JSON.stringify(exp));
ok('…and the frame it paints is the recorded window', exp.magenta > 1000, JSON.stringify(exp));
await shot(page, '4-export');
await page.evaluate(() => lessonExportClose(true));

console.log('\n📱 Portrait 9:16 for Instagram: an outline on screen, never in the video');
await page.evaluate(() => { annotations = annotations.filter(a => !a.lessonRecording); window.__uploaded = {}; lessonOpenModal(); });
await page.waitForFunction(() => lessonDev.micState === 'live', null, { timeout: 8000 }).catch(() => {});
const frameRow = await page.evaluate(() => ({ shown: !$('lessonFrameRow').hidden,
  on: (document.querySelector('#lessonFrameRow .lxSegBtn.on') || {}).dataset }));
ok('with the window recorded, the Frame choice shows, on the whole area', frameRow.shown && frameRow.on && frameRow.on.lframe === 'area', JSON.stringify(frameRow));
await page.click('[data-lframe="portrait"]');
const picked = await page.evaluate(() => ({ pref: localStorage.getItem('polymath.lessonFrame'), choice: lessonDevChoice().frame, note: $('lessonFrameNote').textContent }));
ok('Portrait is remembered and read by Start', /portrait/.test(picked.pref || '') && picked.choice === 'portrait' && /9:16/.test(picked.note), JSON.stringify(picked));
await shot(page, '5-portrait-window');
await page.click('#lessonStartBtn');
await page.waitForFunction(() => lessonCapture && lessonCapture.phase === 'recording', null, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(400);
const pr = await page.evaluate(() => {
  const c = lessonCapture, rec = c && c.screenRec;
  const area = $('viewerArea').getBoundingClientRect(), g = $('lessonFrameGuide'), clip = $('lessonFrameClip');
  const gr = g && g.getBoundingClientRect(), cr = clip && clip.getBoundingClientRect();
  const f = lessonFrameRect(area, 9 / 16, LESSON_FRAME_GAP);
  return { phase: c && c.phase, ratio: rec && rec.frameRatio, size: rec && [rec.canvas.width, rec.canvas.height],
    frame: f, guide: gr && { left: gr.left, top: gr.top, w: gr.width, h: gr.height },
    clip: cr && { left: Math.round(cr.left), top: Math.round(cr.top), w: Math.round(cr.width), h: Math.round(cr.height) },
    area: { left: Math.round(area.left), top: Math.round(area.top), w: Math.round(area.width), h: Math.round(area.height) },
    pe: g && getComputedStyle(clip).pointerEvents, lsrW: document.body.style.getPropertyValue('--lsr-w') };
});
ok('it records a 9:16 picture', pr.phase === 'recording' && pr.ratio === 9 / 16 && pr.size && Math.abs(pr.size[0] / pr.size[1] - 9 / 16) < 0.01, JSON.stringify(pr));
ok('the outline sits just outside the frame, a gap away', pr.guide && pr.frame && Math.abs(pr.guide.left + 3 - pr.frame.left) < 1 && Math.abs(pr.guide.w - 6 - pr.frame.width) < 1 && Math.abs(pr.guide.h - 6 - pr.frame.height) < 1, JSON.stringify([pr.guide, pr.frame]));
ok('…clipped to the worksheet area, and it never takes a tap', JSON.stringify(pr.clip) === JSON.stringify(pr.area) && pr.pe === 'none', JSON.stringify([pr.clip, pr.area, pr.pe]));
ok('a question window would open inside the frame', pr.lsrW === pr.frame.width + 'px', pr.lsrW + ' vs ' + pr.frame.width);
await page.waitForTimeout(2600);
await shot(page, '6-portrait-recording');
await page.evaluate(() => lessonStop());
const psaved = await page.waitForFunction(() => !lessonCapture && !lessonPending && annotations.some(a => a.lessonRecording), null, { timeout: 20000 }).then(() => true).catch(() => false);
const ppill = await page.evaluate(() => ({ rec: (annotations.find(x => x.lessonRecording) || {}).lessonRecording, guide: !!$('lessonFrameClip') }));
ok('Stop saves it flagged as portrait, and the outline goes', psaved && ppill.rec && ppill.rec.screen === true && ppill.rec.frame === 'portrait' && !ppill.guide, JSON.stringify(ppill));
const ppx = await page.evaluate(async () => {
  const media = Object.keys(window.__uploaded).find(k => !k.endsWith('.json'));
  const v = document.createElement('video'); v.muted = true;
  v.src = URL.createObjectURL(window.__uploaded[media]);
  await new Promise(r => { v.onloadedmetadata = r; v.onerror = r; setTimeout(r, 6000); });
  v.currentTime = 1.6;
  await new Promise(r => { v.onseeked = r; setTimeout(r, 4000); });
  const cnv = document.createElement('canvas'); cnv.width = v.videoWidth; cnv.height = v.videoHeight;
  const g = cnv.getContext('2d'); g.drawImage(v, 0, 0);
  const d = g.getImageData(0, 0, cnv.width, cnv.height).data;
  let amber = 0, white = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 215 && d[i + 1] > 140 && d[i + 1] < 195 && d[i + 2] < 100) amber++;
    if (d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245) white++;
  }
  return { w: v.videoWidth, h: v.videoHeight, amber, white, total: d.length / 4 };
});
ok('the saved file is portrait 9:16', ppx.h > ppx.w && Math.abs(ppx.w / ppx.h - 9 / 16) < 0.02, JSON.stringify(ppx));
ok('…shows the page, and the orange outline is NOT in it', ppx.white > ppx.total * 0.2 && ppx.amber < ppx.total * 0.001, JSON.stringify(ppx));
await page.evaluate(() => lessonPlay(annotations.find(x => x.lessonRecording)));
await page.waitForFunction(() => lessonPlayback && $('lessonVideo').currentTime > 0.3, null, { timeout: 10000 }).catch(() => {});
const prep = await page.evaluate(() => ({ portrait: lessonPlayback && lessonPlayback.portrait, width: $('lessonCamWin').getBoundingClientRect().width }));
ok('the replay shows it in a tall, narrow window', prep.portrait === true && prep.width === 340, JSON.stringify(prep));
await page.evaluate(() => lessonExitPlayback());
await page.evaluate(() => lessonExportOpen(annotations.find(x => x.lessonRecording)));
await page.waitForFunction(() => lessonExportJob && (lessonExportJob.phase === 'ready' || lessonExportJob.phase === 'failed'), null, { timeout: 20000 }).catch(() => {});
const pexp = await page.evaluate(async () => {
  const job = lessonExportJob;
  job.media.currentTime = 1.6;
  await new Promise(r => { job.media.onseeked = r; setTimeout(r, 4000); });
  lessonExportDraw(job, 6000, 0);
  const d = job.ctx.getImageData(0, 0, job.canvas.width, job.canvas.height).data;
  let white = 0;
  for (let i = 0; i < d.length; i += 16) if (d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245) white++;
  return { phase: job.phase, portrait: job.portrait, w: job.canvas.width, h: job.canvas.height,
    stage: $('lessonExportStage').classList.contains('portrait'), about: $('lessonExportInfo') ? $('lessonExportInfo').textContent : '', white, total: d.length / 16 };
});
ok('the 1080p export is portrait, 1080 × 1920', pexp.phase === 'ready' && pexp.portrait === true && pexp.w === 1080 && pexp.h === 1920 && pexp.stage, JSON.stringify(pexp));
ok('…and the recording fills it', pexp.white > pexp.total * 0.2, JSON.stringify(pexp));
await shot(page, '7-portrait-export');
await page.evaluate(() => lessonExportClose(true));

ok('no uncaught error anywhere along the way', errors.length === 0, errors.join('\n      '));
await browser.close();

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ all ') + pass + ' passed');
process.exit(fail ? 1 : 0);
