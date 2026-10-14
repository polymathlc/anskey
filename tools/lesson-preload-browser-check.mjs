// ⏬ Lesson preload in a real browser: the card on the real page, a real
// download into Cache Storage, and a preloaded video that seeks instantly.
// Served over http://localhost (Cache Storage needs a secure origin); the
// Storage URLs are answered by the test. A real video makes the seek check
// meaningful: pass LESSON_MEDIA=<a .webm file>, or have ffmpeg on the PATH.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const runtime = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(runtime.startsWith('file:') ? runtime : pathToFileURL(runtime).href);
const output = path.resolve(process.env.PRELOAD_SCREENSHOTS || '../preload-validation');
fs.mkdirSync(output, { recursive: true });

let media = null;
if (process.env.LESSON_MEDIA) media = fs.readFileSync(process.env.LESSON_MEDIA);
else {
  try {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'preload-')), 'lesson.webm');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440',
      '-t', '20', '-c:v', 'libvpx', '-b:v', '200k', '-c:a', 'libopus', '-shortest', file]);
    media = fs.readFileSync(file);
  } catch (e) { console.log('(no ffmpeg: the seek check is skipped)'); }
}
const mediaBytes = media || Buffer.alloc(300000, 7);

const html = fs.readFileSync(path.resolve('index.html'));
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/?')) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = 'http://localhost:' + server.address().port;

const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {});
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.route(/firebase-[a-z]+-compat\.js(?:\?.*)?$/, (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
const served = [];
await page.route(/^https:\/\/firebasestorage\.googleapis\.com\//, (route) => {
  const url = route.request().url();
  served.push(url);
  const manifest = url.includes('.json');
  const body = manifest ? Buffer.from('{"version":1}') : mediaBytes;
  route.fulfill({ status: 200, body, headers: { 'Content-Type': manifest ? 'application/json' : 'video/webm', 'Content-Length': String(body.length), 'Access-Control-Allow-Origin': '*' } });
});
await page.addInitScript(() => {
  const chain = () => new Proxy(function () { return chain(); }, { get: (_, key) => key === 'then' ? undefined : chain(), apply: () => chain(), construct: () => chain(), set: () => true });
  window.pdfjsLib = chain(); window.firebase = chain(); window.grecaptcha = chain();
});

let checks = 0;
function check(name, condition) { assert.ok(condition, name); checks++; console.log('✓ ' + name); }

await page.goto(origin + '/');
await page.waitForFunction(() => typeof window.lessonPreloadOffer === 'function');
const BASE = 'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/';
const lessonUrls = await page.evaluate((base) => {
  const asset = (name) => base + encodeURIComponent('pdf-annotator/' + name) + '?alt=media&token=t';
  window.isAdmin = () => false;
  window.currentUser = { uid: 'student', email: 'student@example.test' };
  window.storage = { ref: () => ({ getMetadata: async () => ({ size: 0 }) }) };
  window.currentDocId = 'w1';
  window.annotations = ['a', 'b'].map((id, i) => ({ id, type: 'video', ts: i, url: asset('lesson-w1-' + id + '.webm'), label: 'Lesson ' + id,
    lessonRecording: { version: 1, manifestUrl: asset('lesson-w1-' + id + '.json'), audioPath: 'pdf-annotator/lesson-w1-' + id + '.webm', duration: 20000, video: true } }));
  return window.annotations.map((a) => a.url);
}, BASE);

// The question.
await page.evaluate(() => window.lessonPreloadOffer('w1'));
await page.waitForSelector('#lessonPreload:not([hidden])');
check('a student opening a worksheet with lessons is asked to preload them', await page.textContent('#lessonPreloadTitle') === 'Preload these 2 lesson videos?');
check('the question offers Preload, Not now and "Always"', await page.isVisible('#lessonPreloadGo') && await page.isVisible('#lessonPreloadNo') && await page.isVisible('#lessonPreloadAlways'));
const card = await page.locator('#lessonPreload').boundingBox();
check('the card sits at the bottom of the screen, centred', card.y + card.height > 760 && Math.abs(card.x + card.width / 2 - 640) < 4);
await page.screenshot({ path: path.join(output, 'preload-ask.png') });

// Mid-way, as a student would see it.
await page.evaluate(() => {
  window.lessonPreloadState = Object.assign({}, window.lessonPreloadState, { phase: 'loading', pct: 37, loaded: 55 * 1048576, total: 148 * 1048576 });
  window.lessonPreloadRender();
});
check('the bar shows the percentage', await page.textContent('#lessonPreloadPct') === '37%' && await page.getAttribute('#lessonPreloadMeter', 'aria-valuenow') === '37');
check('the bar is filled to it', Math.abs((await page.evaluate(() => document.getElementById('lessonPreloadFill').getBoundingClientRect().width / document.getElementById('lessonPreloadMeter').getBoundingClientRect().width)) - 0.37) < 0.02);
check('and the line under the title says how much has arrived', await page.textContent('#lessonPreloadSub') === '55 MB of 148 MB');
await page.screenshot({ path: path.join(output, 'preload-loading.png') });

// The real download.
await page.evaluate(() => { window.lessonPreloadState.phase = 'ask'; window.lessonPreloadState.pct = 0; window.lessonPreloadRender(); });
await page.click('#lessonPreloadGo');
await page.waitForFunction(() => window.lessonPreloadState && window.lessonPreloadState.phase === 'done');
check('Preload ends at 100%', await page.textContent('#lessonPreloadPct') === '100%');
check('and says the lessons will play instantly', await page.textContent('#lessonPreloadTitle') === 'All 2 lessons ready to play instantly');
await page.waitForTimeout(500); // the bar's last step animates
await page.screenshot({ path: path.join(output, 'preload-done.png') });
check('each file was downloaded once', served.length === 4 && new Set(served).size === 4);
const cached = await page.evaluate(async (urls) => {
  const cache = await caches.open('polymath-lesson-media-v1');
  return Promise.all(urls.map(async (u) => { const r = await cache.match(u); return r ? (await r.arrayBuffer()).byteLength : 0; }));
}, lessonUrls);
check('the videos are kept in Cache Storage, whole', cached.every((n) => n === mediaBytes.length));
await page.waitForSelector('#lessonPreload[hidden]', { state: 'attached', timeout: 6000 });
check('the card goes away by itself', true);

// A later visit: nothing to ask, and the replay plays the local copy.
await page.reload();
await page.waitForFunction(() => typeof window.lessonPreloadOffer === 'function');
const again = await page.evaluate(async (urls) => {
  window.isAdmin = () => false;
  window.currentUser = { uid: 'student', email: 'student@example.test' };
  window.currentDocId = 'w1';
  window.annotations = urls.map((url, i) => ({ id: 'L' + i, type: 'video', ts: i, url, lessonRecording: { version: 1, manifestUrl: url.replace('.webm', '.json'), video: true } }));
  await window.lessonPreloadOffer('w1');
  return { asked: !!window.lessonPreloadState, src: await window.lessonPreloadSrc(urls[0]) };
}, lessonUrls);
served.length = 0;
check('on the next visit nothing is asked: the lessons are already here', again.asked === false);
check('the replay gets a local copy of the video', again.src.startsWith('blob:'));

if (media) {
  const seek = await page.evaluate(async (src) => {
    const video = document.getElementById('lessonVideo');
    video.muted = true; video.src = src;
    await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('media error')); });
    const started = performance.now();
    video.currentTime = 15;
    await new Promise((resolve) => { video.onseeked = resolve; });
    return { ms: performance.now() - started, at: video.currentTime, duration: video.duration, ready: video.readyState };
  }, again.src);
  check('the preloaded video jumps to 0:15 at once (' + Math.round(seek.ms) + ' ms)', seek.at >= 14.9 && seek.ms < 1500 && seek.ready >= 2);
  check('without asking the network', served.length === 0);
}

check('no page errors', errors.length === 0 || (console.log(errors), false));
console.log(checks + ' checks passed. Screenshots in ' + output);
await browser.close();
server.close();
