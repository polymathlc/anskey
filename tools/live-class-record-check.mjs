// 📼 The live class recording, end to end, in real Chromium (v1.208.0).
//
// A page records a "class" (an animated worksheet canvas as the screen, a
// second canvas as the teacher's camera, two tones as voices) with the REAL
// live-class-record.js. Pieces go up during the recording to a fake bucket
// on disk; when it stops, the head is rewritten by the REAL
// LessonAudioFinalize.plan (cut out of index.html) and the REAL
// ansKeyLessonCompose service (functions/lesson-compose.js) joins them. Then
// ffprobe reads the joined file: its length must be the recording's, and a
// frame near the end must decode (it can be scrubbed).
//
// Then a second recording is cut off mid-lesson (the page closes with no
// stop) and a NEW page on the same device finishes it from IndexedDB.
//
//   node tools/live-class-record-check.mjs                 (~75 s recording)
//   LCR_SECONDS=3600 node tools/live-class-record-check.mjs   (the hour-long run)
//   PW=/path/to/playwright/index.mjs SHOTS=/dir node tools/live-class-record-check.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(path.join(ROOT, 'functions', 'package.json'));
const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) { console.log('live-class-record-check: no Playwright at ' + PW + ' — skipped.'); process.exit(0); }
let haveFfprobe = true;
try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); } catch (e) { haveFfprobe = false; }

const SECONDS = Math.max(20, Number(process.env.LCR_SECONDS) || 75);
const SHOTS = process.env.SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (note ? '\n      ' + note : '')); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[' + new Date().toISOString().slice(11, 19) + ']', ...a);

/* ---------------- the cloud: a bucket on disk + the real compose ---------------- */
const BUCKET_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lcr-bucket-'));
const fileOf = name => path.join(BUCKET_DIR, encodeURIComponent(name));
const metaOf = new Map();
const bucketLog = [];
const bucket = {
  name: 'mathgen--app.firebasestorage.app',
  file(name) {
    return {
      name,
      async exists() { return [fs.existsSync(fileOf(name))]; },
      async getMetadata() {
        if (!fs.existsSync(fileOf(name))) throw new Error('No such object ' + name);
        const m = metaOf.get(name) || {};
        return [{ size: String(fs.statSync(fileOf(name)).size), contentType: m.contentType, cacheControl: m.cacheControl, metadata: m.metadata }];
      },
      async setMetadata(meta) {
        const m = metaOf.get(name) || {};
        Object.assign(m, meta, { metadata: Object.assign({}, m.metadata || {}, meta.metadata || {}) });
        metaOf.set(name, m);
        return [m];
      },
      async delete() { bucketLog.push(['delete', name]); fs.rmSync(fileOf(name), { force: true }); return []; }
    };
  },
  async combine(sources, dest) {
    if (sources.length > 32) throw new Error('Compose takes at most 32 sources');
    bucketLog.push(['combine', sources.length, dest.name]);
    const tmp = fileOf(dest.name) + '.tmp';
    const fd = fs.openSync(tmp, 'w');
    for (const s of sources) {
      const src = fileOf(s.name);
      if (!fs.existsSync(src)) { fs.closeSync(fd); throw new Error('missing ' + s.name); }
      const r = fs.openSync(src, 'r');
      const buf = Buffer.alloc(4 * 1024 * 1024);
      let n;
      while ((n = fs.readSync(r, buf, 0, buf.length, null)) > 0) fs.writeSync(fd, buf, 0, n);
      fs.closeSync(r);
    }
    fs.closeSync(fd);
    fs.renameSync(tmp, fileOf(dest.name));
    return [dest];
  }
};
const { createLessonComposeService } = require('./lesson-compose');
const { APP_ID, TEACHER_EMAIL } = require('./live-service');
const compose = createLessonComposeService({
  auth: { async verifyIdToken() { return { uid: 'teacher', email: TEACHER_EMAIL, email_verified: true }; },
    async getUserByEmail() { return { uid: 'teacher', emailVerified: true }; } },
  appCheck: { async verifyToken() { return { appId: APP_ID }; } },
  bucket, makeToken: () => 'tok-' + Math.random().toString(36).slice(2, 8)
});

/* The REAL finalizer, cut out of index.html. */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const fStart = html.indexOf('var LessonAudioFinalize = (function () {');
const fEnd = html.indexOf('\n})();', fStart);
if (fStart < 0 || fEnd < 0) { console.log('LessonAudioFinalize not found in index.html'); process.exit(1); }
const FINALIZER = html.slice(fStart, fEnd + 6) + '\nwindow.LessonAudioFinalize = LessonAudioFinalize;\n';

const HARNESS = `<!doctype html><html><head><meta charset="utf-8"><title>Record check</title>
<style>:root{--ink:#1a1a1a;--accent:#ffe0b2;--line:#ececea;--ok:#43a047;--radius:14px;--font:sans-serif}</style>
<link rel="stylesheet" href="/live-class.css"></head><body>
<canvas id="screen" width="1280" height="800"></canvas><canvas id="cam" width="320" height="180"></canvas>
<script src="/lessonfinal.js"></script><script src="/live-class-record.js"></script>
<script>
var q = new URLSearchParams(location.search);
var skew = Number(q.get('skew')) || 0;
window.toasts = []; window.savedJobs = []; window.puts = 0;
window.rec = LiveClassRecord.create({
  toast: function (m) { window.toasts.push(m); },
  now: function () { return Date.now() + skew; },
  put: function (p, blob, type) {
    return fetch('/put?path=' + encodeURIComponent(p), { method: 'PUT', headers: { 'content-type': type }, body: blob })
      .then(function (r) { if (!r.ok) throw new Error('put ' + r.status); window.puts++; });
  },
  compose: function (req) {
    return fetch('/compose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error((d.error && d.error.message) || 'compose ' + r.status); return d; }); });
  },
  plan: function (b, ms) { return LessonAudioFinalize.plan(b, ms); },
  finishWhole: function (b) { return b; },
  saved: function (job, result) { window.savedJobs.push({ id: job.id, url: result.url, path: result.path, bytes: result.bytes, durationMs: job.durationMs, pieces: job.pieces.length, docs: job.docs }); return Promise.resolve(); },
  canUpload: function () { return true; },
  currentDoc: function () { return { id: 'ws1', name: 'Worksheet 1' }; }
});
// The "worksheet": a page with a moving pen and a frame counter.
var sc = document.getElementById('screen').getContext('2d'), cc = document.getElementById('cam').getContext('2d'), n = 0;
setInterval(function () {
  n++;
  sc.fillStyle = '#fff'; sc.fillRect(0, 0, 1280, 800);
  sc.fillStyle = '#222'; sc.font = '48px sans-serif'; sc.fillText('Q3. Frame ' + n, 60, 100);
  sc.fillStyle = '#c60085'; sc.fillRect(60 + (n * 7) % 1100, 300, 80, 80);
  cc.fillStyle = '#7ebfca'; cc.fillRect(0, 0, 320, 180); cc.fillStyle = '#000'; cc.fillText('cam ' + n, 20, 90);
}, 100);
function tone(f) {
  var ctx = new AudioContext(), o = ctx.createOscillator(), d = ctx.createMediaStreamDestination();
  o.frequency.value = f; o.connect(d); o.start();
  return d.stream.getAudioTracks()[0];
}
window.begin = function (epoch) {
  return rec.start({ uid: 'teacher', epoch: epoch, slot: 'WED-2', slotLabel: 'Wed 5:00pm · P5 Science' }).then(function (h) {
    window.h = h;
    h.setVideo('screen', document.getElementById('screen').captureStream(5).getVideoTracks()[0]);
    h.setVideo('camera', document.getElementById('cam').captureStream(10).getVideoTracks()[0]);
    h.setAudio('teacher', tone(440));
    h.setAudio('s1', tone(660));
    return h.id;
  });
};
</script></body></html>`;

const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };
const web = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/' ) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(HARNESS); }
    if (url.pathname === '/lessonfinal.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(FINALIZER); }
    if (url.pathname === '/put') {
      const name = url.searchParams.get('path');
      if (!/^pdf-annotator\/lesson-liveclass-[A-Za-z0-9_-]+\.part-\d{4}$/.test(name)) { res.writeHead(400); return res.end('bad path'); }
      const out = fs.createWriteStream(fileOf(name));
      for await (const c of req) out.write(c);
      await new Promise(r => out.end(r));
      bucketLog.push(['put', name, fs.statSync(fileOf(name)).size]);
      res.writeHead(200); return res.end('{}');
    }
    if (url.pathname === '/compose') {
      let raw = ''; for await (const c of req) raw += c;
      const headers = { origin: 'https://polymathlc.github.io', authorization: 'Bearer t', 'x-firebase-appcheck': 'ac', 'content-type': 'application/json' };
      const fakeReq = { body: JSON.parse(raw), method: 'POST', rawBody: Buffer.from(raw), get: n => headers[n.toLowerCase()] };
      const fakeRes = { statusCode: 200, set() { return this; }, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; }, send(v) { this.body = v; return this; } };
      await compose.handler(fakeReq, fakeRes);
      res.writeHead(fakeRes.statusCode, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(fakeRes.body || {}));
    }
    const file = path.join(ROOT, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
await new Promise(r => web.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + web.address().port;

function probe(file) {
  if (!haveFfprobe) return null;
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file], { encoding: 'utf8' });
  return JSON.parse(out);
}
function decodesAt(file, sec) {
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-ss', String(sec), '-i', file, '-frames:v', '1', '-f', 'null', '-'], { stdio: 'pipe' });
    return true;
  } catch (e) { return false; }
}
async function until(fn, ms, step = 500) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch (e) {} await sleep(step); }
  return null;
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
let exitCode = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE + '/');

  /* ---------- 1. a whole class, recorded and joined ---------- */
  console.log('A ' + SECONDS + ' s class, recorded while it goes on');
  const t0 = Date.now();
  const id = await page.evaluate(() => window.begin(1768000000000));
  ok('the recording starts with a valid job id', /^e\d+p[0-9a-z]+$/.test(id), id);
  let lastLog = 0, maxBytes = 0;
  while (Date.now() - t0 < SECONDS * 1000) {
    await sleep(5000);
    const info = await page.evaluate(() => window.h.info());
    maxBytes = Math.max(maxBytes, info.bytes);
    if (Date.now() - lastLog > 60000) { lastLog = Date.now(); log('recorded', Math.round(info.elapsed / 1000) + 's', (info.bytes / 1e6).toFixed(1) + ' MB', 'pieces', info.sent + '/' + info.pieces); }
  }
  const mid = await page.evaluate(() => window.h.info());
  const parts = bucketLog.filter(x => x[0] === 'put').length;
  ok('pieces went up DURING the recording', mid.sent >= Math.floor(SECONDS / 30) - 1 && parts === mid.sent, 'sent ' + mid.sent + ' puts ' + parts);
  const stored = await page.evaluate(() => new Promise(res => {
    var r = indexedDB.open('polymath-live-class-rec'); r.onsuccess = () => { var t = r.result.transaction('chunks').objectStore('chunks').count(); t.onsuccess = () => res(t.result); };
  }));
  ok('every second is on the device first (IndexedDB)', stored >= SECONDS - 5, 'chunks ' + stored);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'record-1-during.png') });

  const tStop = Date.now();
  await page.evaluate(() => window.h.stop());
  const saved = await until(() => page.evaluate(() => window.savedJobs[0]), 10 * 60 * 1000);
  const joinMs = Date.now() - tStop;
  ok('the rest goes up and the cloud joins it', !!saved, JSON.stringify(await page.evaluate(() => window.toasts)));
  ok('…quickly, since most was already up (' + Math.round(joinMs / 1000) + ' s)', joinMs < Math.max(30000, SECONDS * 20), 'took ' + joinMs + ' ms');
  ok('the worksheet open during the class is noted', saved && saved.docs.some(d => d.id === 'ws1'));
  const finalName = 'pdf-annotator/lesson-liveclass-' + id + '.webm';
  const finalFile = fileOf(finalName);
  ok('ONE joined file in the bucket', fs.existsSync(finalFile));
  ok('the pieces are deleted after the join', !fs.readdirSync(BUCKET_DIR).some(f => /\.part-/.test(decodeURIComponent(f))));
  ok('the joined size is what was recorded', saved && Math.abs(fs.statSync(finalFile).size - maxBytes) < 3 * 1024 * 1024, fs.existsSync(finalFile) ? fs.statSync(finalFile).size + ' vs ' + maxBytes : '');
  if (haveFfprobe && fs.existsSync(finalFile)) {
    const pr = probe(finalFile);
    const dur = Number(pr.format.duration);
    const want = (tStop - t0) / 1000;
    ok('the file says how long it is: ' + dur.toFixed(1) + ' s (recorded ~' + want.toFixed(0) + ' s)', Number.isFinite(dur) && Math.abs(dur - want) < Math.max(4, want * 0.02), JSON.stringify(pr.format));
    ok('it has the picture (1600×900) and the sound', pr.streams.some(s => s.codec_type === 'video' && s.width === 1600 && s.height === 900) && pr.streams.some(s => s.codec_type === 'audio'));
    ok('it can be scrubbed: a frame near the end decodes', decodesAt(finalFile, Math.max(1, dur * 0.9)));
    ok('…and one in the middle', decodesAt(finalFile, dur / 2));
  } else console.log('  (no ffprobe — the file is not inspected)');
  const left = await page.evaluate(() => new Promise(res => {
    var r = indexedDB.open('polymath-live-class-rec'); r.onsuccess = () => { var t = r.result.transaction('chunks').objectStore('chunks').count(); t.onsuccess = () => res(t.result); };
  }));
  ok('the device copy is cleared once it is safe in the cloud', left === 0, 'chunks left ' + left);
  ok('the badge says it was saved', await page.evaluate(() => { var b = document.getElementById('vcUpBadge'); return !b || b.hidden || /saved/i.test(b.textContent); }));

  /* ---------- 2. cut off mid-lesson, finished next time ---------- */
  console.log('A class cut off mid-lesson, finished the next time Ans Key opens');
  const p2 = await ctx.newPage();
  p2.on('pageerror', e => errors.push(String(e)));
  await p2.goto(BASE + '/');
  const id2 = await p2.evaluate(() => window.begin(1768000999000));
  await sleep(12000);
  const bytes2 = await p2.evaluate(() => window.h.info().bytes);
  await p2.close({ runBeforeUnload: false });
  ok('the page closed with the recording still going', bytes2 > 0);
  const p3 = await ctx.newPage();
  p3.on('pageerror', e => errors.push(String(e)));
  // A minute later on the device clock: the old page's heartbeat is stale.
  await p3.goto(BASE + '/?skew=60000');
  await p3.evaluate(() => window.rec.boot());
  const badge = await until(() => p3.evaluate(() => { var b = document.getElementById('vcUpBadge'); return b && !b.hidden ? b.textContent : ''; }), 15000, 100);
  ok('the badge says a recording is going up', !!badge && /Uploading 1 class recording|saved/i.test(badge), badge || '');
  const saved2 = await until(() => p3.evaluate(() => window.savedJobs[0]), 60000);
  ok('the new page finishes and joins it', !!saved2 && saved2.id === id2);
  const f2 = fileOf('pdf-annotator/lesson-liveclass-' + id2 + '.webm');
  if (haveFfprobe && fs.existsSync(f2)) {
    const pr2 = probe(f2); const d2 = Number(pr2.format.duration);
    if (!(d2 > 0)) console.log('      ' + JSON.stringify(saved2) + ' ' + JSON.stringify(pr2));
    ok('the resumed file is the ~12 s that was recorded (' + d2.toFixed(1) + ' s)', d2 > 8 && d2 < 16);
    ok('…and can be scrubbed', decodesAt(f2, d2 * 0.8));
  }
  ok('no page errors', !errors.length, errors.join('\n'));
} catch (e) {
  console.log('  ✗ the check threw: ' + (e && e.stack || e));
  fail++;
} finally {
  await browser.close();
  web.close();
  if (process.env.KEEP) console.log('bucket kept at ' + BUCKET_DIR); else fs.rmSync(BUCKET_DIR, { recursive: true, force: true });
}
console.log('\nlive-class-record-check: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
