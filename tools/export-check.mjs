/* =====================================================================
   🎞 A LESSON EXPORTED AS A 1080p VIDEO — in a real browser, end to end
   ---------------------------------------------------------------------
   tools/export-tests.mjs pins the arithmetic: the layout, the framing, the
   easing, the size estimate. What no arithmetic can say is whether a browser
   really writes a 1920 × 1080 file with the page, the writing, the camera AND
   the sound in it — so this records a real lesson with Chromium's own fake
   camera and microphone, exports it through the real window, and then opens
   the file it made and looks at it: its size, its length, its sound, and the
   colours in its frames.

   It drives 🎬 the playlist too: three lessons in question order, the second
   starting by itself when the first ends, and Close replay ending the lot.

   Like tools/camera-check.mjs it needs a real Chromium, so it is a tool you
   reach for rather than a gate:

     node tools/export-check.mjs
     PW=/path/to/playwright/index.mjs node tools/export-check.mjs
     SHOTS=/some/dir node tools/export-check.mjs     # keep the screenshots
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) {
  console.log('export-check: no Playwright at ' + PW + ' — skipped.');
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

// A UTF-8 locale, or Chromium on a bare Linux box names every download
// "download" — the file names here carry an em dash and a middle dot.
const browser = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }, args: [
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['camera', 'microphone'], acceptDownloads: true });
const page = await ctx.newPage();
await page.addInitScript(() => {
  const chain = () => new Proxy(function () { return chain(); }, {
    get: (t, k) => (k === 'then' ? undefined : chain()),
    apply: () => chain(), construct: () => chain(), set: () => true
  });
  window.pdfjsLib = chain(); window.firebase = chain(); window.grecaptcha = chain();
});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const downloads = [];
page.on('download', d => downloads.push(d));
await page.goto(FILE);
await page.waitForTimeout(1200);
ok('the page loads with no uncaught error', errors.length === 0, errors.join('\n      '));

/* One printed page — drawn by a stand-in for pdf.js, with a question number in
   its text layer — and a signed-in teacher, the way the app has them. */
await page.evaluate(() => {
  const W = 600, H = 780;
  const pdfPage = {
    getViewport: ({ scale }) => ({ width: W * scale, height: H * scale,
      convertToViewportPoint: (x, y) => [x * scale, (H - y) * scale] }),
    render: ({ canvasContext: c, viewport }) => {
      const k = viewport.width / W;
      c.save(); c.scale(k, k);
      c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, W, H);
      c.fillStyle = '#111111'; c.font = '16px serif';
      c.fillText('4.  What is 12 x 3?', 40, 80);
      c.fillText('5.  A tank holds 24 litres. How much is in 3 tanks?', 40, 220);
      for (let y = 260; y < 700; y += 26) c.fillRect(40, y, 480, 1);
      c.restore();
      return { promise: Promise.resolve() };
    },
    getTextContent: async () => ({ items: [
      { str: '4.', transform: [1, 0, 0, 1, 40, H - 80] }, { str: 'What is 12 x 3?', transform: [1, 0, 0, 1, 64, H - 80] },
      { str: '5.', transform: [1, 0, 0, 1, 40, H - 220] }, { str: 'A tank holds 24 litres.', transform: [1, 0, 0, 1, 64, H - 220] },
      { str: '(1)', transform: [1, 0, 0, 1, 90, H - 250] }] })
  };
  const wrap = document.createElement('div');
  wrap.className = 'pageWrap';
  wrap.style.cssText = 'position:relative;flex:none;width:' + W + 'px;height:' + H + 'px;min-width:' + W + 'px;min-height:' + H + 'px;background:#fff';
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport: pdfPage.getViewport({ scale: 1 }) });
  const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' });
  svg.classList.add('overlay');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  wrap.appendChild(canvas); wrap.appendChild(svg);
  $('viewerArea').appendChild(wrap);
  const p = { num: 1, baseW: W, baseH: H, wrap, canvas, svg, page: pdfPage, viewport1: pdfPage.getViewport({ scale: 1 }) };
  pages = [p]; pdfDoc = {}; scale = 1; annotations = []; docName = 'P5 Maths — Tanks and Litres';
  attachOverlayHandlers(p);
  currentUser = { uid: 'teacher', email: ADMIN_EMAIL, getIdToken: async () => 'token' };
  currentDocId = 'doc1'; pdfBytes = new Uint8Array([37, 80, 68, 70]);
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
});

console.log('\n🏷 The Record window guesses which question is on screen');
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} lessonOpenModal(); });
await page.waitForFunction(() => $('lessonTitleInput').value !== '', null, { timeout: 5000 }).catch(() => {});
const guess = await page.evaluate(() => $('lessonTitleInput').value);
ok('it offers "Q4", the first question number down the margin of what is on screen', guess === 'Q4', JSON.stringify(guess));
await page.evaluate(() => { $('lessonTitleInput').value = 'Q5'; });

console.log('\n⏺ A short lesson with the camera, named for its question');
await page.selectOption('#lessonCamSelect', { index: 1 });
await page.waitForFunction(() => $('lessonCamPreview').videoWidth > 0, null, { timeout: 8000 }).catch(() => {});
await page.evaluate(() => lessonStart());
await page.waitForFunction(() => lessonCapture && lessonCapture.phase === 'recording', null, { timeout: 10000 }).catch(() => {});
await page.evaluate(() => { annotations.push({ id: 'ink1', page: 1, type: 'pen', color: '#1565C0', width: 4, points: [{ x: 80, y: 300 }, { x: 260, y: 330 }] }); renderAllOverlays(); setDirty(true); });
await page.waitForTimeout(1200);
await page.evaluate(() => { annotations[0].points.push({ x: 420, y: 380 }, { x: 480, y: 460 }); renderAllOverlays(); setDirty(true); });
await page.waitForTimeout(1500);
await page.evaluate(() => lessonStop());
await page.waitForFunction(() => !lessonCapture && !lessonPending && annotations.some(a => a.lessonRecording), null, { timeout: 15000 }).catch(() => {});
const pill = await page.evaluate(() => {
  const a = annotations.find(x => x.lessonRecording);
  const manifest = Object.keys(window.__uploaded).find(k => k.endsWith('.json'));
  return { a, manifest };
});
ok('it is saved as a lesson on the page', !!pill.a, JSON.stringify(pill));
ok('…whose button names its question', pill.a && /^Q5 · video lesson · 0:0[2-4]$/.test(pill.a.label) && pill.a.lessonRecording.title === 'Q5', pill.a && pill.a.label);
const vp = await page.evaluate(async () => {
  const k = Object.keys(window.__uploaded).find(x => x.endsWith('.json'));
  return JSON.parse(await window.__uploaded[k].text()).viewport;
});
ok('…and whose replay file remembers the size of the viewer it was taught in', vp && vp.w > 200 && vp.h > 200, JSON.stringify(vp));

console.log('\n⬇ The replay offers the export to the teacher');
await page.evaluate(() => lessonPlay(annotations.find(x => x.lessonRecording)));
await page.waitForFunction(() => lessonPlayback && !$('lessonExportBtn').hidden, null, { timeout: 8000 }).catch(() => {});
const offered = await page.evaluate(() => ({ shown: !$('lessonExportBtn').hidden, text: $('lessonExportBtn').textContent }));
ok('the replay bar has ⬇ 1080p video for the teacher', offered.shown && /1080p/.test(offered.text), JSON.stringify(offered));
await page.click('#lessonExportBtn');
await page.waitForFunction(() => lessonExportJob && lessonExportJob.phase === 'ready', null, { timeout: 15000 }).catch(() => {});
const ready = await page.evaluate(() => {
  const j = lessonExportJob, c = $('lessonExportCanvas'), x = c.getContext('2d');
  const at = (px, py) => Array.from(x.getImageData(px, py, 1, 1).data);
  const d = x.getImageData(0, 0, 1440, 1080).data;
  let white = 0;
  for (let i = 0; i < d.length; i += 16) if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) white++;
  return { phase: j && j.phase, replay: !!lessonPlayback, open: $('lessonExportModal').classList.contains('open'),
    w: c.width, h: c.height, layout: j && j.layoutKind, mode: j && j.mode, go: !$('lessonExportGo').disabled,
    info: $('lessonExportInfo').textContent, panel: at(1700, 900), white: white / (d.length / 16), cam: at(1680, 150),
    layoutRow: !$('lessonExportLayoutRow').hidden, raster: j && j.rasters[1] && j.rasters[1].width };
});
ok('the export window opens, and the replay underneath is closed', ready.open && !ready.replay && ready.phase === 'ready', JSON.stringify(ready));
ok('…on a 1920 × 1080 frame', ready.w === 1920 && ready.h === 1080);
ok('…with the camera beside the page and the page following the lesson, by default', ready.layout === 'side' && ready.mode === 'follow' && ready.layoutRow);
ok('…the page rasterised sharper than the screen showed it', ready.raster >= 600 * 1.2, String(ready.raster));
ok('the preview is painted: dark panel, a white page filling most of its area, camera picture',
   ready.panel[0] < 60 && ready.white > 0.25 && ready.cam.some(v => v > 20),
   JSON.stringify({ panel: ready.panel, white: ready.white, cam: ready.cam }));
ok('Share… waits until there is a file to share', await page.evaluate(() => getComputedStyle($('lessonExportShare')).display === 'none'));
ok('it says how big, how long, and to keep the tab open', /1920 × 1080/.test(ready.info) && /MB/.test(ready.info) && /keep this tab open/.test(ready.info), ready.info);
await shot(page, '1-export-window');

await page.click('[data-lx-layout="corner"]');
const corner = await page.evaluate(() => ({ layout: lessonExportJob.layoutKind, remembered: JSON.parse(localStorage.getItem('polymath.lessonExport') || 'null'),
  on: document.querySelector('[data-lx-layout="corner"]').classList.contains('on') }));
ok('a layout choice redraws the preview and is remembered', corner.layout === 'corner' && corner.on && corner.remembered && corner.remembered.layout === 'corner', JSON.stringify(corner));
await page.click('[data-lx-layout="side"]');

console.log('\n🎞 Export runs in real time and writes one file');
const t0 = Date.now();
await page.click('#lessonExportGo');
await page.waitForFunction(() => lessonExportJob && lessonExportJob.phase === 'exporting', null, { timeout: 8000 }).catch(() => {});
const running = await page.evaluate(() => ({ phase: lessonExportJob.phase, stop: $('lessonExportCancel').textContent,
  choices: Array.from(document.querySelectorAll('[data-lx-layout]')).every(b => b.disabled), rec: lessonExportJob.recorder && lessonExportJob.recorder.state,
  tracks: lessonExportJob.recorder && lessonExportJob.recorder.stream.getTracks().map(t => t.kind).sort().join(',') }));
ok('it is exporting, with Stop in place of Cancel and the choices locked', running.phase === 'exporting' && running.stop === 'Stop' && running.choices, JSON.stringify(running));
ok('…recording the frame AND the lesson sound', running.rec === 'recording' && running.tracks === 'audio,video', JSON.stringify(running));
await shot(page, '2-exporting');
await page.waitForFunction(() => lessonExportJob && (lessonExportJob.phase === 'done' || lessonExportJob.phase === 'failed'), null, { timeout: 40000 }).catch(() => {});
const took = (Date.now() - t0) / 1000;
const done = await page.evaluate(() => {
  const j = lessonExportJob;
  return { phase: j && j.phase, info: $('lessonExportInfo').textContent, size: j && j.blob && j.blob.size, type: j && j.blob && j.blob.type,
    name: j && j.name, go: $('lessonExportGo').textContent, close: $('lessonExportCancel').textContent, duration: j && j.duration,
    media: j && j.mediaDuration };
});
ok('it finishes', done.phase === 'done', JSON.stringify(done));
ok('…in about the time the lesson takes', took > done.duration / 1000 * 0.8 && took < done.duration / 1000 + 25, took.toFixed(1) + ' s for a ' + (done.duration / 1000).toFixed(1) + ' s lesson');
ok('…named for the worksheet and the question', /^P5 Maths — Tanks and Litres — Q5 · video lesson \(1080p\)\.(mp4|webm)$/.test(done.name || ''), done.name);
ok('…and it downloaded itself', downloads.length === 1 && downloads[0].suggestedFilename() === done.name, downloads.map(d => d.suggestedFilename()).join(', '));

const file = await page.evaluate(async () => {
  const blob = lessonExportJob.blob;
  const v = document.createElement('video');
  v.src = URL.createObjectURL(blob);
  v.muted = false;
  document.body.appendChild(v);
  await new Promise(r => { v.onloadedmetadata = r; v.onerror = r; setTimeout(r, 6000); });
  let duration = v.duration;
  if (!Number.isFinite(duration)) {
    v.currentTime = 1e6;
    await new Promise(r => { v.ondurationchange = r; setTimeout(r, 3000); });
    duration = v.duration;
  }
  const grab = async (t) => {
    v.currentTime = t;
    await new Promise(r => { v.onseeked = r; setTimeout(r, 3000); });
    const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
    const x = c.getContext('2d'); x.drawImage(v, 0, 0, 1920, 1080);
    const at = (px, py) => Array.from(x.getImageData(px, py, 1, 1).data).slice(0, 3);
    // Is the teacher's blue ink anywhere on the page area — and how much of
    // it is white paper?
    const d = x.getImageData(0, 0, 1440, 1080).data;
    let blue = 0, white = 0;
    for (let i = 0; i < d.length; i += 16) {
      if (d[i + 2] > 140 && d[i] < 90 && d[i + 1] < 140) blue++;
      if (d[i] > 225 && d[i + 1] > 225 && d[i + 2] > 225) white++;
    }
    return { panel: at(1700, 1000), cam: at(1680, 150), white: white / (d.length / 16), blue };
  };
  const early = await grab(0.2);
  const late = await grab(Math.max(0.3, duration - 0.3));
  // Sound: decode the file's audio and measure it.
  let peak = 0, audioSeconds = 0;
  try {
    const ac = new OfflineAudioContext(1, 48000, 48000);
    const buf = await ac.decodeAudioData(await blob.arrayBuffer());
    audioSeconds = buf.duration;
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i += 7) peak = Math.max(peak, Math.abs(ch[i]));
  } catch (e) { peak = -1; }
  v.remove();
  return { w: v.videoWidth, h: v.videoHeight, duration, early, late, peak, audioSeconds };
});
ok('the file is 1920 × 1080', file.w === 1920 && file.h === 1080, file.w + '×' + file.h);
const lessonSeconds = Math.max(done.duration, done.media || 0) / 1000;
ok('…as long as the lesson — no frozen second at the front, no tail', Math.abs(file.duration - lessonSeconds) < 0.8, file.duration + ' s vs ' + lessonSeconds + ' s');
ok('…with the lesson\'s sound in it', file.peak > 0.01 && file.audioSeconds > 1, JSON.stringify({ peak: file.peak, seconds: file.audioSeconds }));
ok('…the dark side panel and the camera beside the page', file.early.panel.every(v => v < 70) && file.early.cam.some(v => v > 20), JSON.stringify(file.early));
ok('…the white worksheet page', file.early.white > 0.25, JSON.stringify(file.early.white));
ok('…and the teacher\'s ink is written in by the end, not at the start', file.late.blue > file.early.blue + 20, 'blue pixels: ' + file.early.blue + ' → ' + file.late.blue);
await shot(page, '3-export-done');
ok('it says it is done and offers another copy', /ready/.test(done.info) && /Download again/.test(done.go) && done.close === 'Close', JSON.stringify(done));
await page.click('#lessonExportCancel');
const closed = await page.evaluate(() => ({ job: lessonExportJob, open: $('lessonExportModal').classList.contains('open'), media: !!$('lessonExportVideo') }));
ok('Close lets the whole job go — its media element too', !closed.job && !closed.open && !closed.media, JSON.stringify(closed));

console.log('\n🔒 Nobody but the teacher can export');
const refused = await page.evaluate(() => {
  const real = currentUser;
  currentUser = { uid: 'student', email: 'someone@school.sg' };
  const msgs = [];
  const t = toast; toast = m => msgs.push(m);
  lessonExportOpen(annotations.find(x => x.lessonRecording));
  toast = t;
  const out = { job: lessonExportJob, open: $('lessonExportModal').classList.contains('open'), msgs };
  currentUser = real;
  return out;
});
ok('a student account is refused in the handler, with the window never opening', !refused.job && !refused.open && /Only the teacher/.test(refused.msgs.join(' ')), JSON.stringify(refused));

console.log('\n🎬 The playlist plays the lessons in question order, one after another');
await page.evaluate(() => {
  const base = annotations.find(x => x.lessonRecording);
  // Three buttons for the same recording, deliberately out of order in the array.
  annotations.push(Object.assign(JSON.parse(JSON.stringify(base)), { id: 'lessonC', y: 600, label: 'Q7 · video lesson · 0:03' }));
  annotations.push(Object.assign(JSON.parse(JSON.stringify(base)), { id: 'lessonA', y: 60, label: 'Q4 · video lesson · 0:03' }));
  base.y = 250;
  renderAllOverlays();
  PLAYLIST_NEXT_MS = 600;
});
const list = await page.evaluate(() => ({ btn: $('playlistBtn').style.display !== 'none', count: $('playlistBtn').querySelector('.plCount').textContent,
  order: lessonPlaylistItems(annotations).map(i => i.label.split(' · ')[0]) }));
ok('the toolbar shows the playlist with the number of videos', list.btn && list.count === '3', JSON.stringify(list));
ok('…ordered by where each question is on the paper', list.order.join() === 'Q4,Q5,Q7', list.order.join());
await page.click('#playlistBtn');
const panel = await page.evaluate(() => ({ open: !$('playlistPanel').hidden, rows: Array.from(document.querySelectorAll('#playlistList .plItem b')).map(b => b.textContent),
  exports: document.querySelectorAll('#playlistList [data-pl-export]').length }));
ok('the list opens, with ⬇ 1080p beside each lesson for the teacher', panel.open && panel.rows.length === 3 && panel.exports === 3, JSON.stringify(panel));
await shot(page, '4-playlist');
await page.click('#playlistAll');
await page.waitForFunction(() => lessonPlaylist && lessonPlaylist.index === 0 && lessonPlayback && !lessonMedia().paused, null, { timeout: 10000 }).catch(() => {});
const first = await page.evaluate(() => ({ index: lessonPlaylist && lessonPlaylist.index, bar: !$('playlistBar').hidden, status: $('playlistStatus').textContent,
  playing: lessonPlayback && lessonPlayback.ann.id }));
ok('Play all starts with the first question', first.index === 0 && first.bar && first.playing === 'lessonA' && /^Video 1 of 3 · Q4/.test(first.status), JSON.stringify(first));
await page.waitForFunction(() => lessonPlaylist && lessonPlaylist.phase === 'next', null, { timeout: 12000 }).catch(() => {});
const upNext = await page.evaluate(() => ({ phase: lessonPlaylist && lessonPlaylist.phase, status: $('playlistStatus').textContent, now: !$('playlistNow').hidden }));
ok('when it ends, the bar says what is up next', upNext.phase === 'next' && /^Up next in \d — 2 of 3 · Q5/.test(upNext.status) && upNext.now, JSON.stringify(upNext));
await page.waitForFunction(() => lessonPlaylist && lessonPlaylist.index === 1 && lessonPlayback && lessonPlayback.ann.id !== 'lessonA' && !lessonMedia().paused, null, { timeout: 8000 }).catch(() => {});
const second = await page.evaluate(() => ({ index: lessonPlaylist && lessonPlaylist.index, playing: lessonPlayback && lessonPlayback.ann.id, status: $('playlistStatus').textContent }));
ok('…and moves on to the next question by itself', second.index === 1 && /^Video 2 of 3 · Q5/.test(second.status), JSON.stringify(second));
await page.click('#lessonPlayerClose');
const stopped = await page.evaluate(() => ({ pl: lessonPlaylist, bar: $('playlistBar').hidden, replay: !!lessonPlayback }));
ok('Close replay ends the playlist too', !stopped.pl && stopped.bar && !stopped.replay, JSON.stringify(stopped));

ok('no uncaught error anywhere along the way', errors.length === 0, errors.join('\n      '));
await browser.close();
console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ all ') + pass + ' passed');
process.exit(fail ? 1 : 0);
