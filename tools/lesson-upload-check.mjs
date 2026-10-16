/* =====================================================================
   ☁ A LESSON THAT UPLOADS WHILE IT RECORDS — in a real browser
   ---------------------------------------------------------------------
   tools/lesson-upload-tests.mjs drives the shipped stream with ffmpeg's
   files. What it cannot say is what Chromium's OWN recorder writes, chunk by
   chunk, and whether the pieces cut from it really join into the file the
   whole upload would have sent. This records a real lesson with Chromium's
   fake camera and microphone, lets the pieces go up to an in-memory Storage
   while it records, joins them the way the cloud does, and compares the join
   with the finished file byte for byte. Then it plays the lesson back and
   watches the loading bar, checks the recording pill is small and in its
   corner, and makes the cloud refuse a join to see the whole upload take over.

     node tools/lesson-upload-check.mjs
     PW=/path/to/playwright/index.mjs node tools/lesson-upload-check.mjs
     SHOTS=/some/dir node tools/lesson-upload-check.mjs
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) {
  console.log('lesson-upload-check: no Playwright at ' + PW + ' — skipped.');
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
// The real Firebase scripts would replace the stand-in below (the network on CI
// reaches the CDN), so they are answered empty here, as the caption check does.
await page.route(/firebase-[a-z]+-compat\.js(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/javascript', body: '' }));
await page.addInitScript(() => {
  const chain = () => new Proxy(function () { return chain(); }, {
    get: (t, k) => (k === 'then' ? undefined : chain()),
    apply: () => chain(), construct: () => chain(), set: () => true
  });
  window.pdfjsLib = chain(); window.firebase = chain(); window.grecaptcha = chain();
});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(FILE);
await page.waitForTimeout(1200);
ok('the page loads with no uncaught error', errors.length === 0, errors.join('\n      '));

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
  currentUser = { uid: 'teacher', email: ADMIN_EMAIL, getIdToken: async () => 'id-token' };
  window.liveAppCheckToken = async () => 'app-token';
  currentDocId = 'doc1'; pdfBytes = new Uint8Array([37, 80, 68, 70]);
  ['saveBtn', 'blankPageBtn', 'deletePageBtn'].forEach(id => { $(id).disabled = false; });
  // Storage in memory. Every put is logged with the moment it happened, so
  // "the pieces went up WHILE it recorded" can be read off the log.
  window.__objects = {}; window.__puts = []; window.__deletes = [];
  storage = { ref: p2 => ({ fullPath: p2,
    put: blob => { window.__objects[p2] = blob; window.__puts.push({ path: p2, size: blob.size, recording: !!lessonCapture }); return Promise.resolve(); },
    delete: () => { window.__deletes.push(p2); delete window.__objects[p2]; return Promise.resolve(); },
    getDownloadURL: async () => URL.createObjectURL(window.__objects[p2]) }) };
  // The cloud join, as ansKeyLessonCompose does it: the pieces end to end.
  window.__composes = []; window.__composeFails = false;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, init) => {
    if (url !== LESSON_UP_ENDPOINT) return realFetch(url, init);
    const body = JSON.parse(init.body);
    window.__composes.push({ body, auth: init.headers.Authorization, appCheck: init.headers['X-Firebase-AppCheck'] });
    if (window.__composeFails) return new Response(JSON.stringify({ error: { message: 'down for the test' } }), { status: 503 });
    const prefix = 'pdf-annotator/lesson-' + body.docId + '-' + body.id, parts = [];
    for (let i = 0; i < body.parts; i++) {
      const piece = window.__objects[prefix + '.part-' + String(i).padStart(4, '0')];
      if (!piece) return new Response(JSON.stringify({ error: { message: 'missing piece ' + i } }), { status: 409 });
      parts.push(piece);
    }
    const joined = new Blob(parts, { type: body.contentType });
    if (joined.size !== body.bytes) return new Response(JSON.stringify({ error: { message: 'size' } }), { status: 409 });
    const dest = prefix + '.' + body.ext;
    window.__objects[dest] = joined;
    for (let i = 0; i < body.parts; i++) delete window.__objects[prefix + '.part-' + String(i).padStart(4, '0')];
    return new Response(JSON.stringify({ path: dest, url: URL.createObjectURL(joined), bytes: joined.size }), { status: 200 });
  };
  writeAnnotations = async () => {};
  scheduleAutoSave = () => {};
  lessonAssetUrl = u => u;
  // Small pieces, so a short test lesson sends several while it records.
  LESSON_UP_PART = 96 * 1024; LESSON_UP_HEAD = 48 * 1024;
  // The raw recording, kept for the comparison below.
  const finish = lessonFinish;
  lessonFinish = function (c) { window.__raw = new Blob(c.chunks, { type: c.recorder.mimeType || '' }); return finish(c); };
  setTool('select');
});

async function recordLesson(seconds, label) {
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} lessonOpenModal(); });
  await page.waitForFunction(() => lessonDev.micState === 'live', null, { timeout: 8000 }).catch(() => {});
  await page.selectOption('#lessonCamSelect', { index: 1 });
  await page.waitForFunction(() => lessonDev.camState === 'live', null, { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => { window.__puts = []; lessonStart(); });
  await page.waitForFunction(() => lessonCapture && lessonCapture.phase === 'recording', null, { timeout: 10000 }).catch(() => {});
  await page.evaluate(() => { annotations.push({ id: 'ink' + Date.now(), page: 1, type: 'pen', color: '#1565C0', width: 3, points: [{ x: 80, y: 90 }, { x: 260, y: 150 }] }); renderAllOverlays(); setDirty(true); });
  await page.waitForTimeout(seconds * 1000);
}

console.log('\n⏺ While it records, the bar is a small pill in the corner');
await recordLesson(9);
const pill = await page.evaluate(() => {
  const bar = $('lessonBar'), r = bar.getBoundingClientRect();
  return { mini: bar.classList.contains('mini'), w: r.width, h: r.height, left: r.left, bottom: innerHeight - r.bottom,
    dot: getComputedStyle($('lessonRecDot')).display, info: getComputedStyle($('lessonStatus')).display,
    stop: !$('lessonStopBtn').hidden, up: $('lessonUpLive').textContent, title: bar.title, mime: lessonCapture.recorder.mimeType,
    parts: lessonCapture.up ? lessonCapture.up.parts.filter(p => p.done).length : -1 };
});
ok('the recording bar is the small pill', pill.mini && pill.w < 320 && pill.h < 48, JSON.stringify(pill));
ok('…tucked in the bottom-left corner', pill.left <= 16 && pill.bottom <= 16, JSON.stringify(pill));
ok('…a red dot, the clock and Stop — the sentence is a hover away', pill.dot !== 'none' && pill.info === 'none' && pill.stop && /^Recording/.test(pill.title), JSON.stringify(pill));
ok('…and how much is already in the cloud', /^☁ \d{1,3}%$/.test(pill.up), pill.up);
ok('pieces went up WHILE it was still recording', pill.parts >= 2, 'pieces: ' + pill.parts + ' (' + pill.mime + ')');
await shot(page, '1-pill');

console.log('\n☁ Stop sends only the rest, and the cloud joins it');
const beforeStop = await page.evaluate(() => window.__puts.length);
await page.evaluate(() => lessonStop());
const savingSeen = await page.waitForFunction(() => $('lessonBar').classList.contains('saving') || (!lessonPending && annotations.some(a => a.lessonRecording)), null, { timeout: 5000 }).then(() => true).catch(() => false);
const saved = await page.waitForFunction(() => !lessonCapture && !lessonPending && annotations.some(a => a.lessonRecording), null, { timeout: 20000 }).then(() => true).catch(() => false);
const result = await page.evaluate(async () => {
  const a = annotations.find(x => x.lessonRecording);
  const media = Object.keys(window.__objects).find(k => /lesson-doc1-[^.]+\.(mp4|webm|m4a)$/.test(k));
  return { a, media, composes: window.__composes, puts: window.__puts,
    leftover: Object.keys(window.__objects).filter(k => /\.part-\d{4}$/.test(k)) };
}).catch(async () => null);
// The byte comparison is done in Node, from base64, to keep the page simple.
const bytes = await page.evaluate(async () => {
  const a = annotations.find(x => x.lessonRecording);
  const finished = await lessonFinalizeMedia(window.__raw, a.lessonRecording.duration);
  const media = Object.keys(window.__objects).find(k => /lesson-doc1-[^.]+\.(mp4|webm|m4a)$/.test(k));
  const b64 = async blob => { const u = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); };
  return { joined: media ? await b64(window.__objects[media]) : '', finished: await b64(finished), type: finished.type };
});
const joinedBuf = Buffer.from(bytes.joined, 'base64'), finishedBuf = Buffer.from(bytes.finished, 'base64');
ok('Stop saves the lesson on the page', saved && savingSeen, JSON.stringify(result && result.a));
ok('…through ONE cloud join, signed as the teacher', result && result.composes.length === 1 && result.composes[0].auth === 'Bearer id-token' && result.composes[0].appCheck === 'app-token', JSON.stringify(result && result.composes));
const afterStop = result ? result.puts.slice(beforeStop).filter(p => /\.part-\d{4}$/.test(p.path)) : [];
const duringBytes = result ? result.puts.filter(p => p.recording && /\.part-/.test(p.path)).reduce((n, p) => n + p.size, 0) : 0;
const afterBytes = afterStop.reduce((n, p) => n + p.size, 0);
ok('after Stop only the head and the last seconds went up', afterStop.length <= 2 && afterBytes < joinedBuf.length / 2,
  'during: ' + duringBytes + ', after: ' + afterBytes + ' of ' + joinedBuf.length);
ok('the joined file is BYTE FOR BYTE the file the whole upload would have sent', joinedBuf.length > 10000 && joinedBuf.equals(finishedBuf),
  'joined ' + joinedBuf.length + ', finished ' + finishedBuf.length + ' (' + bytes.type + ')');
ok('the pieces are gone once joined', result && result.leftover.length === 0, JSON.stringify(result && result.leftover));

const ffprobe = spawnSync('ffprobe', ['-version']).status === 0;
if (ffprobe && joinedBuf.length) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upcheck-'));
  const ext = /mp4/.test(bytes.type) ? 'mp4' : 'webm';
  const f = path.join(dir, 'joined.' + ext);
  fs.writeFileSync(f, joinedBuf);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' });
  const duration = parseFloat(probe.stdout);
  ok('ffprobe reads the joined file and its length', probe.status === 0 && duration > 7 && duration < 14, probe.stdout + probe.stderr);
  if (ext === 'mp4') {
    const top = []; for (let at = 0; at + 8 <= joinedBuf.length && top.length < 6;) { const len = joinedBuf.readUInt32BE(at); top.push(joinedBuf.toString('latin1', at + 4, at + 8)); if (len < 8) break; at += len; }
    ok('…the index comes FIRST, so a student can start and jump at once', top[0] === 'ftyp' && top[1] === 'moov' && !top.includes('moof'), top.join(' '));
  }
  const decode = spawnSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-'], { encoding: 'utf8' });
  ok('…and every frame of it decodes', decode.status === 0 && !decode.stderr.trim(), decode.stderr.slice(0, 400));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n⏩ A student\'s replay says how much has loaded');
await page.evaluate(() => { window.__loadTexts = []; const node = $('lessonLoadPct');
  new MutationObserver(() => window.__loadTexts.push(node.textContent)).observe(node, { childList: true, characterData: true, subtree: true });
  lessonPlay(annotations.find(x => x.lessonRecording)); });
await page.waitForFunction(() => window.__loadTexts.some(t => t === 'Loaded 100%'), null, { timeout: 12000 }).catch(() => {});
const load = await page.evaluate(() => ({ texts: window.__loadTexts.slice(0, 40), shown: !$('lessonLoad').hidden,
  aria: $('lessonLoadMeter').getAttribute('aria-valuenow'), playing: !!lessonPlayback && !$('lessonVideo').paused }));
ok('the bar counts up while it opens, as a percentage', load.texts.some(t => /^Loading lesson · \d{1,3}%$/.test(t)), JSON.stringify(load.texts));
ok('…and says when the whole lesson is here', load.texts.includes('Loaded 100%') && load.aria === '100', JSON.stringify(load));
ok('the lesson plays', load.playing, JSON.stringify(load));
await shot(page, '2-loading');
await page.waitForTimeout(2200);
ok('…and the bar steps out of the way once it is all here', await page.evaluate(() => $('lessonLoad').hidden));
await page.evaluate(() => lessonExitPlayback());

console.log('\n↩ A join the cloud refuses falls back to the whole upload');
await page.evaluate(() => { window.__composeFails = true; window.__composes = []; window.__deletes = []; annotations = []; });
await recordLesson(6);
await page.evaluate(() => lessonStop());
const fellBack = await page.waitForFunction(() => !lessonCapture && !lessonPending && annotations.some(a => a.lessonRecording), null, { timeout: 20000 }).then(() => true).catch(() => false);
const fb = await page.evaluate(async () => {
  const a = annotations.find(x => x.lessonRecording);
  const finished = await lessonFinalizeMedia(window.__raw, a.lessonRecording.duration);
  const media = a && a.lessonRecording.audioPath, file = window.__objects[media];
  const eq = file && file.size === finished.size && (await (async () => { const x = new Uint8Array(await file.arrayBuffer()), y = new Uint8Array(await finished.arrayBuffer()); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; })());
  return { media, eq, composes: window.__composes.length, deletes: window.__deletes.filter(d => /\.part-/.test(d)).length };
});
ok('the lesson is still saved', fellBack, JSON.stringify(fb));
ok('…the cloud was asked once and refused', fb.composes === 1, JSON.stringify(fb));
ok('…the whole file went up instead, exactly the finished file', fb.eq, JSON.stringify(fb));
ok('…and the pieces were cleared away', fb.deletes >= 2, JSON.stringify(fb));

console.log('\n📺 In a window recording the pill sits in the toolbar corner, out of the video');
const corner = await page.evaluate(() => {
  document.body.classList.add('lessonScreenRec');
  const bar = $('lessonBar'); bar.hidden = false; bar.classList.add('mini');
  const r = bar.getBoundingClientRect(), area = $('viewerArea').getBoundingClientRect();
  const out = { top: r.top, right: innerWidth - r.right, bottom: r.bottom, areaTop: area.top };
  bar.classList.remove('mini'); bar.hidden = true; document.body.classList.remove('lessonScreenRec');
  return out;
});
ok('top right, above the worksheet area', corner.top <= 12 && corner.right <= 16, JSON.stringify(corner));

ok('no uncaught error anywhere along the way', errors.length === 0, errors.join('\n      '));
await browser.close();
console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ all ') + pass + ' passed');
process.exit(fail ? 1 : 0);
