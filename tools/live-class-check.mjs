// 🎥 Live class — a REAL class in real Chromium against a REAL LiveKit server.
//
// A teacher page and three student pages (one on a phone-sized screen) join
// one room on a local livekit-server, with Chromium's fake camera and
// microphone. The server half is the real functions/live-class.js service,
// with a fake Firestore holding an /office roster and a fake sign-in, so the
// "Who are you?" list, the tokens and the room are exactly what production
// does. Then: keys → start → My class / Make-up / Trial joins → video tiles →
// MCQ, fill-in-the-blank and open-ended questions pushed, popped up,
// answered, auto-marked, marked by hand, points → reveal → hands → an answer
// sent while the wifi is down arrives once it is back → End class →
// parent reports → Send behind a confirm.
//
//   node tools/live-class-check.mjs
//   LIVEKIT_SERVER=/path/to/livekit-server PW=/path/to/playwright/index.mjs SHOTS=/dir node tools/live-class-check.mjs
//
// With no livekit-server on this machine it says so and is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(path.join(ROOT, 'functions', 'package.json'));
const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) { console.log('live-class-check: no Playwright at ' + PW + ' — skipped.'); process.exit(0); }

function findServer() {
  const c = [process.env.LIVEKIT_SERVER, path.join(ROOT, '.livekit', 'livekit-server')].filter(Boolean);
  for (const p of c) if (fs.existsSync(p)) return p;
  try { return execFileSync('which', ['livekit-server'], { encoding: 'utf8' }).trim() || ''; } catch (e) { return ''; }
}
const LK_BIN = findServer();
if (!LK_BIN) { console.log('live-class-check: no livekit-server (set LIVEKIT_SERVER) — skipped.'); process.exit(0); }

const SHOTS = (process.env.LC_SHOTS || process.env.SHOTS) || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (note ? '\n      ' + note : '')); }
};
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

/* ---------------- LiveKit ---------------- */
const API_KEY = 'APIpolymathcheck';
const API_SECRET = 'polymath-check-secret-0123456789abcdefghijklmnop';
const lkPort = await freePort();
const rtcTcp = await freePort();
const udpStart = 52000 + Math.floor(Math.random() * 2000);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'live-class-'));
const lkConfig = path.join(tmp, 'livekit.yaml');
fs.writeFileSync(lkConfig, [
  'port: ' + lkPort,
  'bind_addresses: ["127.0.0.1"]',
  'rtc:',
  '  tcp_port: ' + rtcTcp,
  '  port_range_start: ' + udpStart,
  '  port_range_end: ' + (udpStart + 60),
  '  use_external_ip: false',
  '  node_ip: 127.0.0.1',
  'keys:',
  '  ' + API_KEY + ': ' + API_SECRET,
  'logging:',
  '  level: warn',
  'room:',
  '  empty_timeout: 300',
  ''
].join('\n'));
const lk = spawn(LK_BIN, ['--config', lkConfig], { stdio: ['ignore', 'pipe', 'pipe'] });
let lkLog = '';
lk.stdout.on('data', d => { lkLog += d; });
lk.stderr.on('data', d => { lkLog += d; });
async function waitForLiveKit() {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch('http://127.0.0.1:' + lkPort + '/'); if (r.ok || r.status) return true; } catch (e) {}
    await sleep(150);
  }
  return false;
}
if (!(await waitForLiveKit())) { console.log(lkLog); lk.kill(); throw new Error('livekit-server did not start'); }

/* ---------------- the server half: the real service, fake Firestore and sign-in ---------------- */
const lcServer = require('./live-class');
const { APP_ID, TEACHER_EMAIL } = require('./live-service');
const ROSTER = {
  'officeFamilies/famA': { status: 'active', email: 'tan@example.com', students: [
    { id: 'sA1', name: 'Amy Tan', level: 'P5', status: 'active', classes: [{ slotId: 'WED-2', mode: 'Online' }] }
  ] },
  'officeFamilies/famB': { status: 'active', email: 'lim@example.com', students: [
    { id: 'sB1', name: 'Ethan Lim', level: 'P5', status: 'active', classes: [{ slotId: 'WED-2' }] }
  ] },
  'officeFamilies/famC': { status: 'active', email: 'ng@example.com', students: [
    { id: 'sC1', name: 'Ethan Lim', level: 'P6', status: 'active', classes: [{ slotId: 'FRI-2' }] },
    { id: 'sC2', name: 'Zoe Ng', level: 'P6', status: 'active', classes: [{ slotId: 'FRI-2' }] }
  ] },
  'schedule_config/main': { slots: { 'WED-2': { level: 'P5', subject: 'Science' }, 'FRI-2': { level: 'P6', subject: 'Science' } } }
};
const store = new Map(Object.entries(JSON.parse(JSON.stringify(ROSTER))));
function ref(p) {
  return {
    path: p,
    async get() { const d = store.get(p); return { exists: d !== undefined, data: () => (d === undefined ? undefined : JSON.parse(JSON.stringify(d))) }; },
    async set(v, opts) { const prev = opts && opts.merge ? store.get(p) || {} : {}; store.set(p, JSON.parse(JSON.stringify(Object.assign({}, prev, v)))); },
    async delete() { store.delete(p); },
    collection(name) { return coll(p + '/' + name); }
  };
}
function coll(p) {
  return {
    doc: id => ref(p + '/' + id),
    async get() {
      const docs = [...store.entries()].filter(([k]) => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/'))
        .map(([k, v]) => ({ id: k.slice(p.length + 1), exists: true, data: () => JSON.parse(JSON.stringify(v)) }));
      return { forEach: fn => docs.forEach(fn), size: docs.length, docs, empty: !docs.length };
    }
  };
}
const fakeDb = { collection: coll, runTransaction: async fn => fn({ get: r => r.get(), set: (r, v, o) => r.set(v, o), update: (r, v) => r.set(v, { merge: true }) }) };
const USERS = {
  teacher: { uid: 'teacher', email: TEACHER_EMAIL, email_verified: true, firebase: { sign_in_provider: 'google.com' } },
  s1: { uid: 'anon-s1', firebase: { sign_in_provider: 'anonymous' } },
  s2: { uid: 'anon-s2', firebase: { sign_in_provider: 'anonymous' } },
  s3: { uid: 'anon-s3', firebase: { sign_in_provider: 'anonymous' } },
  s4: { uid: 'anon-s4', firebase: { sign_in_provider: 'anonymous' } },
  s5: { uid: 'anon-s5', firebase: { sign_in_provider: 'anonymous' } },
  s6: { uid: 'anon-s6', firebase: { sign_in_provider: 'anonymous' } }
};
const reports = [];
// The class is Wednesday 5pm (WED-2). The server's clock starts at 4:30pm
// Singapore time, so the door is shut until the teacher lets them in.
const CLOCK_BASE = Date.UTC(2027, 0, 13, 8, 30), CLOCK_T0 = Date.now();
const clock = () => CLOCK_BASE + (Date.now() - CLOCK_T0);
const service = lcServer.createLiveClassService({
  auth: { async verifyIdToken(tok) { const u = USERS[tok]; if (!u) throw new Error('bad token'); return u; },
    async getUserByEmail() { return { uid: 'teacher', emailVerified: true }; } },
  appCheck: { async verifyToken() { return { appId: APP_ID }; } },
  db: fakeDb, master: () => 'master-secret-from-secret-manager-0123456789', fetchImpl: fetch, now: () => Date.now(), lessonClock: clock,
  report: (code, err) => { reports.push(code + ': ' + (err && err.message)); }
});

/* ---------------- the recording's cloud: a bucket in memory + the real compose ---------------- */
const objects = new Map();
const bucket = {
  name: 'mathgen--app.firebasestorage.app',
  file(name) {
    return {
      name,
      async exists() { return [objects.has(name)]; },
      async getMetadata() { const o = objects.get(name); if (!o) throw new Error('No such object'); return [{ size: String(o.data.length), metadata: o.meta.metadata }]; },
      async setMetadata(meta) { const o = objects.get(name); Object.assign(o.meta, meta); return [o.meta]; },
      async delete() { objects.delete(name); return []; }
    };
  },
  async combine(sources, dest) {
    const data = Buffer.concat(sources.map(x => objects.get(x.name).data));
    objects.set(dest.name, { data, meta: (objects.get(dest.name) || {}).meta || {} });
    return [dest];
  }
};
const composer = require('./lesson-compose').createLessonComposeService({
  auth: { async verifyIdToken() { return { uid: 'teacher', email: TEACHER_EMAIL, email_verified: true }; },
    async getUserByEmail() { return { uid: 'teacher', emailVerified: true }; } },
  appCheck: { async verifyToken() { return { appId: APP_ID }; } },
  bucket, makeToken: () => 'tok-check'
});
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const fStart = html.indexOf('var LessonAudioFinalize = (function () {');
const FINALIZER = html.slice(fStart, html.indexOf('\n})();', fStart) + 6) + '\nwindow.LessonAudioFinalize = LessonAudioFinalize;\n';

/* ---------------- the pages ---------------- */
const HARNESS = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Live class check</title>
<style>
:root { --bg:#fff; --bg-viewer:#f3f2f0; --ink:#1a1a1a; --ink-soft:#55554f; --ink-faint:#8a8a84; --accent:#ffe0b2; --accent-strong:#ffcc80; --accent-deep:#e8a54b; --line:#ececea; --danger:#e53935; --ok:#43a047; --radius:14px; --font:'Segoe UI',sans-serif; }
body { margin:0; font-family: var(--font); background:#eceae6; height:100vh; }
#viewerArea { position:absolute; inset:60px 0 0 0; background:#fff; }
#liveClassBtn { position:fixed; left:12px; top:12px; }
</style>
<link rel="stylesheet" href="/live-class.css">
</head><body>
<button id="liveClassBtn">🎥 Live class</button>
<div id="viewerArea"><h1 style="padding:40px">Worksheet page</h1></div>
<script src="/vendor/livekit-client.umd.js"></script>
<script src="/vendor/qrcode-generator.js"></script>
<script src="/lessonfinal.js"></script>
<script src="/live-class-record.js"></script>
<script src="/live-class.js"></script>
<script>
var who = new URLSearchParams(location.search).get('who');
window.toasts = []; window.sentMail = []; window.awards = []; window.saved = {}; window.photos = {};
function call(action, body) {
  return fetch('/api', { method: 'POST', headers: { 'content-type': 'application/json', 'x-who': who }, body: JSON.stringify(Object.assign({}, body || {}, { action: action })) })
    .then(function (r) { return r.json().then(function (d) {
      if (!r.ok) { var e = new Error((d.error && d.error.message) || 'HTTP ' + r.status); e.code = d.error && d.error.code; throw e; }
      return d;
    }); });
}
window.recSaved = [];
var recorder = who === 'teacher' ? LiveClassRecord.create({
  toast: function (m) { window.toasts.push(m); },
  put: function (p, blob, type) { return fetch('/put?path=' + encodeURIComponent(p), { method: 'PUT', body: blob }).then(function (r) { if (!r.ok) throw new Error('put'); }); },
  compose: function (req) { return fetch('/compose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) }).then(function (r) { return r.json(); }); },
  plan: function (b, ms) { return LessonAudioFinalize.plan(b, ms); },
  finishWhole: function (b) { return b; },
  saved: function (job, res) { window.recSaved.push({ id: job.id, path: res.path, durationMs: job.durationMs, docs: job.docs }); return Promise.resolve(); },
  canUpload: function () { return true; },
  currentDoc: function () { return { id: 'ws1', name: 'Worksheet 1' }; }
}) : null;
window.lc = LiveClass.create({
  shareTarget: function () { return document.getElementById('viewerArea'); },
  recorder: recorder,
  teacherUid: function () { return 'teacher'; },
  currentDoc: function () { return { id: 'ws1', name: 'Worksheet 1' }; },
  recordings: function () { return Promise.resolve([]); },
  role: function () { return who === 'teacher' ? 'teacher' : 'student'; },
  call: call,
  toast: function (m) { window.toasts.push(m); },
  button: function () { return document.getElementById('liveClassBtn'); },
  onMirror: function (cb) {
    var stop = false;
    (function poll() { if (stop) return; fetch('/mirror').then(function (r) { return r.json(); }).then(cb, function () {}).then(function () { setTimeout(poll, 800); }); })();
    return function () { stop = true; };
  },
  slots: function () { return call('slots').then(function (r) { return r.slots || []; }); },
  guessSlot: function () { return 'WED-2'; },
  classLink: function () { return location.origin + '/?live'; },
  qrMatrix: function (text) {
    var qr = window.qrcode(0, 'L'); qr.addData(String(text), 'Byte'); qr.make();
    var n = qr.getModuleCount(), rows = [];
    for (var r = 0; r < n; r++) { var row = []; for (var c = 0; c < n; c++) row.push(!!qr.isDark(r, c)); rows.push(row); }
    return rows;
  },
  loadSession: function (e) { return Promise.resolve(window.saved[e] || null); },
  saveSession: function (e, s) { window.saved[e] = s; return Promise.resolve(); },
  savePhoto: function (e, ref, d) { window.photos[ref] = d; return Promise.resolve(); },
  loadPhoto: function (e, ref) { return Promise.resolve(window.photos[ref] || ''); },
  award: function (p, n) { window.awards.push([p.name, n]); return Promise.resolve({ saved: true }); },
  parentEmails: function (p) { return Promise.resolve(p.kind === 'trial' ? [] : ['parent-' + (p.rosterId || 'x') + '@example.com']); },
  sendEmail: function (m) { window.sentMail.push(m); return Promise.resolve({ from: 'centre' }); },
  // ✨ AI send and Chung GPT's pre-marks, with a stand-in model that answers
  // the way the real prompts ask (DATA, never markup).
  aiName: function () { return 'Chung GPT'; },
  cropQuestion: function () {
    window.cropAsked = (window.cropAsked || 0) + 1;
    var c = document.createElement('canvas'); c.width = 300; c.height = 120;
    var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 300, 120); x.fillStyle = '#1565c0'; x.fillRect(20, 20, 200, 60);
    return new Promise(function (r) { setTimeout(function () { r(c.toDataURL('image/jpeg', 0.8)); }, 300); });
  },
  readQuestion: function (ask) {
    window.readAsked = ask && ask.img ? ask.img.slice(0, 22) : '';
    return new Promise(function (r) { setTimeout(function () { r({ kind: 'mcq', text: 'Which planet is the largest?', options: ['(1) Mars', '(2) Jupiter', '(3) Venus'], answer: 1 }); }, 400); });
  },
  aiMark: function (ask) {
    window.aiAsks = (window.aiAsks || []).concat([ask]);
    return new Promise(function (r) { setTimeout(function () {
      r({ by: 'openai', results: ask.answers.map(function (a) {
        var t = String(a.text || '').toLowerCase();
        return /hundred|100/.test(t) ? { id: a.id, verdict: 'correct', why: 'One hundred is the same as 100.' }
          : /heat/.test(t) ? { id: a.id, verdict: 'partial', why: 'Says heat moves in but not that metal is a good conductor.' }
          : { id: a.id, verdict: 'wrong', why: 'Does not answer the question.' };
      }) });
    }, 500); });
  },
  snapWorksheet: function () {
    var c = document.createElement('canvas'); c.width = 400; c.height = 200;
    var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 200); x.fillStyle = '#c60085'; x.fillRect(40, 40, 120, 80);
    return Promise.resolve(c.toDataURL('image/jpeg', 0.8));
  }
});
document.getElementById('liveClassBtn').addEventListener('click', function () { window.lc.open(); });
window.lc.roleChanged();
</script></body></html>`;

const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png' };
const web = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/' || url.pathname === '/harness.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(HARNESS); }
    if (url.pathname === '/lessonfinal.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(FINALIZER); }
    if (url.pathname === '/put') {
      const chunks = []; for await (const c of req) chunks.push(c);
      objects.set(url.searchParams.get('path'), { data: Buffer.concat(chunks), meta: {} });
      res.writeHead(200); return res.end('{}');
    }
    if (url.pathname === '/compose') {
      let raw = ''; for await (const c of req) raw += c;
      const headers = { origin: 'https://polymathlc.github.io', authorization: 'Bearer t', 'x-firebase-appcheck': 'ac', 'content-type': 'application/json' };
      const fakeReq = { body: JSON.parse(raw), method: 'POST', rawBody: Buffer.from(raw), get: n => headers[n.toLowerCase()] };
      const fakeRes = { statusCode: 200, set() { return this; }, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; }, send(v) { this.body = v; return this; } };
      await composer.handler(fakeReq, fakeRes);
      res.writeHead(fakeRes.statusCode, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(fakeRes.body || {}));
    }
    if (url.pathname === '/mirror') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(store.get('liveClassRooms/main') || null)); }
    if (url.pathname === '/api') {
      let raw = ''; for await (const c of req) raw += c;
      const body = JSON.parse(raw || '{}');
      const headers = { origin: 'https://polymathlc.github.io', authorization: 'Bearer ' + (req.headers['x-who'] || ''), 'x-firebase-appcheck': 'ac', 'content-type': 'application/json' };
      const fakeReq = { body, method: 'POST', rawBody: Buffer.from(raw), get: n => headers[n.toLowerCase()] };
      const fakeRes = { statusCode: 200, set() { return this; }, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; }, send(v) { this.body = v; return this; } };
      await service.handler(fakeReq, fakeRes);
      res.writeHead(fakeRes.statusCode, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(fakeRes.body || {}));
    }
    const file = path.join(ROOT, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
const webPort = await freePort();
await new Promise(r => web.listen(webPort, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + webPort;

// The full Chromium (new headless) so the teacher can share "this tab";
// --use-fake-ui-for-media-stream must NOT be passed (it turns a tab share
// into a fake monitor). Cameras are allowed through the context permissions.
const LAUNCH_ARGS = ['--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
  '--disable-features=WebRtcHideLocalIpsWithMdns', '--auto-accept-this-tab-capture'];
let browser;
try { browser = await chromium.launch({ channel: 'chromium', args: LAUNCH_ARGS }); }
catch (e) { browser = await chromium.launch({ args: LAUNCH_ARGS }); }
const errors = [];
async function openPage(who, opts = {}) {
  const query = opts.query || '';
  opts = Object.assign({}, opts); delete opts.query;
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 860 }, permissions: ['camera', 'microphone'] }, opts));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(who + ': ' + e));
  page.on('dialog', d => { page.__dialogs = (page.__dialogs || []).concat(d.message()); d.accept(); });
  await page.goto(BASE + '/harness.html?who=' + who + (query ? '&' + query : ''));
  page.ctx = ctx;
  return page;
}
const win = page => page.locator('#vcWin');
const mode = page => page.evaluate(() => { var w = document.getElementById('vcWin'); return w ? w.dataset.mode : ''; });
async function until(fn, ms = 15000, step = 150) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await fn()) return true; } catch (e) {} await sleep(step); }
  return false;
}

let exitCode = 0;
try {
  /* ---------- 1. the teacher sets up LiveKit and starts the class ---------- */
  console.log('Teacher: keys and start');
  const T = await openPage('teacher');
  await T.click('#liveClassBtn');
  await until(() => T.locator('.vcSetup').isVisible());
  ok('no keys yet → the setup card with the three steps', await T.locator('.vcSetup .vcSteps li').count() === 3);
  const inputs = T.locator('.vcSetup input');
  await inputs.nth(0).fill('ws://127.0.0.1:' + lkPort);
  await inputs.nth(1).fill(API_KEY);
  await inputs.nth(2).fill(API_SECRET);
  ok('the secret box is a password field', await inputs.nth(2).getAttribute('type') === 'password');
  await T.click('.vcSetup .vcPrimary');
  await until(() => T.locator('.vcStart').isVisible());
  ok('the keys are tested with LiveKit and saved', await T.locator('.vcStart').isVisible());
  const cfgDoc = JSON.stringify(store.get('ansKeyLiveClassConfig/main') || [...store.entries()].filter(([k]) => /Config/.test(k)));
  ok('the secret is never stored in the clear', !cfgDoc.includes(API_SECRET) && cfgDoc.length > 10, cfgDoc.slice(0, 200));
  await until(async () => (await T.locator('.vcStart select option').count()) >= 2);
  const optionTexts = await T.locator('.vcStart select option').allTextContents();
  ok('the slot list is the /office timetable, named in words', optionTexts.some(t => /Wed 5:00pm · P5 Science · 2 students/.test(t)), optionTexts.join(' | '));
  ok('this lesson\'s slot is chosen', await T.locator('.vcStart select').inputValue() === 'WED-2');
  ok('the class link is shown with a Copy button', /\?live$/.test(await T.locator('.vcLink').textContent()));
  await shot(T, '01-teacher-start');
  await T.click('.vcGo');
  ok('the teacher is live', await until(async () => (await mode(T)) === 'live', 20000), lkLog.slice(-800));
  await until(() => T.evaluate(() => !!document.querySelector('.vcSelf video')), 10000);
  ok('the teacher\'s own camera shows', await T.evaluate(() => !!document.querySelector('.vcSelf video')));
  ok('the side panel opens on Ask', await T.locator('.vcSide .vcTab.on').textContent().then(t => /Ask/.test(t)));
  ok('the mirror says a class is on', !!(store.get('liveClassRooms/main') || {}).open);
  ok('before 4:50pm the teacher is offered 🚪 Let students in now', await until(() => T.locator('.vcCtl.vcDoor').isVisible(), 5000));
  ok('the teacher\'s camera is ONE small tile', await T.evaluate(() => { var s = document.querySelector('.vcSelf'); var w = document.getElementById('vcWin'); return !!s && s.getBoundingClientRect().width <= 170 && document.querySelectorAll('#vcWin video').length <= 2 && w.getBoundingClientRect().width > 0; }));
  ok('the class is being recorded from the start', await until(() => T.evaluate(() => window.lc.state().recording), 10000));
  ok('…and the bar says so', await until(() => T.locator('.vcCtl.vcRecOn').isVisible(), 5000));

  /* ---------- 1b. 🖥 the worksheet, and only the worksheet ---------- */
  await T.locator('.vcCtl.vcShare').click();
  ok('the worksheet share starts', await until(() => T.evaluate(() => window.lc.state().sharing), 15000), JSON.stringify(await T.evaluate(() => window.toasts)));
  const how = await T.evaluate(() => window.lc.state().shareHow);
  ok('the share is narrowed to the worksheet (Element Capture or Region Capture), not the whole tab', how === 'element' || how === 'crop', how);

  /* ---------- 1c. 🚪 the door: students wait for their lesson time ---------- */
  const SG = await openPage('s1');
  await SG.click('#liveClassBtn');
  await until(() => SG.locator('.vcGateCard').isVisible(), 10000);
  ok('a student at 4:30pm is told the lesson starts at 5:00pm', /starts at 5:00pm/.test(await SG.locator('.vcGateCard').textContent()), await SG.evaluate(() => (document.getElementById('vcWin') || document.body).innerText.slice(0, 300)));
  ok('…with no list of names to pick from yet', !(await SG.locator('.vcPick').isVisible()));
  await shot(SG, '01b-student-door');
  await T.locator('.vcCtl.vcDoor').click();
  ok('🚪 lets them in: the waiting student is taken to "Who are you?"', await until(() => SG.locator('.vcPick').isVisible(), 15000));
  ok('the teacher\'s door button goes away', await until(async () => !(await T.locator('.vcCtl.vcDoor').isVisible()), 5000));
  await SG.ctx.close();

  /* ---------- 2. students join: My class, Make-up, Trial ---------- */
  console.log('Students: "Who are you?"');
  const S1 = await openPage('s1');
  await until(() => S1.evaluate(() => document.getElementById('liveClassBtn').classList.contains('vcLiveNow')), 5000);
  ok('the 🎥 button glows for a student while a class is on', await S1.evaluate(() => document.getElementById('liveClassBtn').classList.contains('vcLiveNow')));
  await S1.click('#liveClassBtn');
  await until(() => S1.locator('.vcPick').isVisible());
  const names = await S1.locator('.vcName').allTextContents();
  ok('My class lists the slot\'s enrolled students with their level', names.length === 2 && names.some(n => /Amy Tan/.test(n)) && names.some(n => /Ethan Lim/.test(n)), names.join(' | '));
  ok('the picker names the lesson in words', /Wed 5:00pm/.test(await S1.locator('.vcPick .vcMuted').first().textContent()));
  ok('Confirm waits for a name', await S1.locator('.vcConfirm').isDisabled());
  await S1.fill('.vcSearch', 'amy');
  ok('typing filters the list', (await S1.locator('.vcName').count()) === 1);
  await S1.locator('.vcName').first().click();
  const confirmText = await S1.locator('.vcConfirm').textContent();
  ok('Confirm names the child: "I am Amy Tan … — Confirm"', /^I am Amy Tan.* — Confirm$/.test(confirmText), confirmText);
  await shot(S1, '02-student-who-are-you');
  await S1.click('.vcConfirm');
  ok('Amy is in the class', await until(async () => (await mode(S1)) === 'live', 20000));
  ok('Amy sees the teacher\'s video', await until(() => S1.evaluate(() => { var v = document.querySelector('.vcMain video'); return !!(v && v.videoWidth > 0); }), 20000));
  const dimsOf = () => S1.evaluate(() => { var v = document.querySelector('.vcMain video'); return v && v.videoWidth ? v.videoWidth + 'x' + v.videoHeight : ''; });
  await until(dimsOf, 20000);
  const dims = await dimsOf();
  const [vw, vh] = String(dims || '0x0').split('x').map(Number);
  const area = await T.evaluate(() => { var r = document.getElementById('viewerArea').getBoundingClientRect(); return r.width / r.height; });
  ok('what Amy sees is the worksheet area\'s shape (' + dims + '), not the whole tab', vh > 0 && Math.abs(vw / vh - area) < 0.06, 'area ' + area.toFixed(3));
  ok('the teacher sees Amy\'s tile', await until(() => T.evaluate(() => [...document.querySelectorAll('.vcTileName')].some(e => e.textContent === 'Amy Tan'))));
  ok('Amy\'s video reaches the teacher', await until(() => T.evaluate(() => { var t = [...document.querySelectorAll('.vcTile')].find(x => x.querySelector('.vcTileName').textContent === 'Amy Tan'); var v = t && t.querySelector('video'); return !!(v && v.videoWidth > 0); }), 20000));

  await S1.locator('.vcCtl', { hasText: '🙂' }).click();
  ok('a student can hide their own video from their screen', await until(() => S1.evaluate(() => document.querySelector('.vcSelf').hidden), 5000));
  await S1.locator('.vcCtl', { hasText: '🙈' }).click();
  ok('…and show it again', await until(() => S1.evaluate(() => !document.querySelector('.vcSelf').hidden), 5000));

  const S2 = await openPage('s2');
  await S2.click('#liveClassBtn');
  await until(() => S2.locator('.vcPick').isVisible());
  await S2.locator('.vcTab', { hasText: 'Make-up' }).click();
  const groups = await S2.locator('.vcGroup').allTextContents();
  ok('Make-up shows students from the other slots, grouped by slot in words', groups.some(g => /Fri 5:00pm/.test(g)), groups.join(' | '));
  const same = await S2.locator('.vcName', { hasText: 'Ethan Lim' }).allTextContents();
  ok('two children with the same name are told apart', same.length === 1 && /P6|Fri/.test(same[0]), same.join(' | '));
  await S2.locator('.vcName', { hasText: 'Zoe Ng' }).click();
  await S2.click('.vcConfirm');
  ok('Zoe joins as a make-up student', await until(async () => (await mode(S2)) === 'live', 20000));

  const S3 = await openPage('s3', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await S3.click('#liveClassBtn');
  await until(() => S3.locator('.vcPick').isVisible());
  await S3.locator('.vcTab', { hasText: 'Trial' }).click();
  ok('Trial asks for a name and waits for one', await S3.locator('.vcConfirm').isDisabled());
  await S3.fill('.vcPickPane input', 'Bella Koh');
  ok('Trial confirms the typed name', /I am Bella Koh — Confirm/.test(await S3.locator('.vcConfirm').textContent()));
  await S3.click('.vcConfirm');
  ok('Bella joins as a trial student on a phone', await until(async () => (await mode(S3)) === 'live', 20000));
  ok('the window fills a phone screen', await S3.evaluate(() => document.getElementById('vcWin').dataset.view === 'full'));
  await until(() => T.evaluate(() => document.querySelectorAll('.vcTile').length === 3), 15000);
  ok('the teacher\'s grid has three students', await T.evaluate(() => document.querySelectorAll('.vcTile').length) === 3);
  await shot(T, '03-teacher-grid');

  // A second device claiming Amy is asked before it takes over.
  const S1b = await openPage('s4');
  await S1b.click('#liveClassBtn');
  await until(() => S1b.locator('.vcPick').isVisible());
  await S1b.locator('.vcName', { hasText: 'Amy Tan' }).click();
  await S1b.click('.vcConfirm');
  const asked = await until(() => S1b.getByText('Yes, it\'s me', { exact: false }).first().isVisible(), 10000);
  if (!asked) console.log('    (second device shows: ' + JSON.stringify(await S1b.evaluate(() => (document.getElementById('vcWin') || document.body).innerText.slice(0, 400))) + ')');
  ok('choosing a name already in the class asks "is it really you?"', asked);
  await S1b.locator('text=No, choose again').click();
  ok('"No" goes back to the list', await S1b.locator('.vcPick').isVisible());
  await S1b.ctx.close();

  /* ---------- 2b. 🔗 personal links, QR codes and PINs (v1.210.0) ---------- */
  console.log('Personal links and PINs');
  const T2 = await openPage('teacher');
  await T2.click('#liveClassBtn');
  await until(() => T2.locator('.vcStart').isVisible(), 10000);
  await T2.locator('.vcStart button', { hasText: 'Links & PINs' }).click();
  ok('🔗 Links & PINs opens on this lesson\'s students', await until(async () => (await T2.locator('.vcPassRow').count()) === 2, 10000));
  await T2.locator('.vcPassSlot').selectOption('');
  ok('…and lists every enrolled student with a PIN', await until(async () => (await T2.locator('.vcPassRow').count()) === 4, 5000));
  const pinsShown = await T2.locator('.vcPassRow .vcPin').allTextContents();
  ok('…each PIN is four digits, none shared', pinsShown.every(p => /^\d{4}$/.test(p)) && new Set(pinsShown).size === pinsShown.length, pinsShown.join(' '));
  await T2.locator('.vcPassSlot').selectOption('WED-2');
  ok('…one lesson at a time', await until(async () => (await T2.locator('.vcPassRow').count()) === 2, 5000));
  await T2.locator('.vcPassRow').first().locator('button', { hasText: 'QR' }).click();
  ok('▦ QR shows the student\'s code', await until(() => T2.evaluate(() => { var s = document.querySelector('.vcPassQr svg path'); return !!(s && s.getAttribute('d').length > 200); }), 5000));
  await shot(T2, '02b-links-and-pins');
  const passList = await T2.evaluate(() => call('passes'));
  const ethan = passList.students.find(r => r.name === 'Ethan Lim' && r.level === 'P5');
  ok('the teacher has Ethan\'s link code and PIN', !!(ethan && ethan.code && /^\d{4}$/.test(ethan.pin)));
  await T2.ctx.close();

  const S5 = await openPage('s5', { query: 'live=' + encodeURIComponent(ethan.code) });
  await S5.click('#liveClassBtn');
  ok('a personal link goes straight to "You are Ethan Lim"', await until(() => S5.locator('.vcMe').isVisible(), 10000) && /Ethan Lim/.test(await S5.locator('.vcMe').textContent()));
  ok('…with no list of names', !(await S5.locator('.vcPick').isVisible()));
  await shot(S5, '02c-you-are');
  await S5.locator('.vcMe .vcGo').click();
  ok('one tap and Ethan is in the class', await until(async () => (await mode(S5)) === 'live', 20000));
  ok('the teacher sees Ethan\'s tile', await until(() => T.evaluate(() => [...document.querySelectorAll('.vcTileName')].some(e => e.textContent === 'Ethan Lim')), 15000));
  await S5.evaluate(() => window.lc.close());
  await S5.goto(BASE + '/harness.html?who=s5');
  await S5.click('#liveClassBtn');
  ok('the device remembers Ethan: the plain class link says "You are Ethan Lim" too', await until(() => S5.locator('.vcMe').isVisible(), 10000));
  await S5.locator('.vcMe .vcLinkBtn').click();
  ok('"Not me" goes to the list and forgets the link', await until(() => S5.locator('.vcPick').isVisible(), 10000) && await S5.evaluate(() => !localStorage.getItem('polymath.liveClass.pass.v1')));
  await S5.ctx.close();
  ok('Ethan\'s tile goes when he leaves', await until(() => T.evaluate(() => ![...document.querySelectorAll('.vcTileName')].some(e => e.textContent === 'Ethan Lim')), 20000));

  const S6 = await openPage('s6', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await S6.click('#liveClassBtn');
  await until(() => S6.locator('.vcPick').isVisible(), 10000);
  await S6.locator('.vcTab', { hasText: 'PIN' }).click();
  ok('🔢 the PIN tab waits for four numbers', await S6.locator('.vcPinRow .vcPrimary').isDisabled());
  await S6.fill('.vcPinIn', '0000');
  await S6.press('.vcPinIn', 'Enter');
  ok('a wrong PIN is refused in words', await until(() => S6.locator('.vcPinMsg', { hasText: 'not right' }).isVisible(), 10000));
  await S6.fill('.vcPinIn', ethan.pin);
  await S6.press('.vcPinIn', 'Enter');
  ok('the right PIN says "You are Ethan Lim"', await until(() => S6.locator('.vcMe').isVisible(), 10000) && /Ethan Lim/.test(await S6.locator('.vcMe').textContent()));
  ok('…and the device keeps his link for next time', await S6.evaluate(() => /\./.test((JSON.parse(localStorage.getItem('polymath.liveClass.pass.v1') || '{}').code) || '')));
  await shot(S6, '02d-pin');
  await S6.ctx.close();

  /* ---------- 3. questions ---------- */
  console.log('Questions: MCQ, fill in the blank, open-ended');
  await T.fill('.vcAsk .vcQText', 'Which of these conducts heat best?');
  const optInputs = T.locator('.vcAsk .vcOptRow input[type="text"]');
  await optInputs.nth(0).fill('Iron');
  await optInputs.nth(1).fill('Wood');
  await optInputs.nth(2).fill('Plastic');
  await T.locator('.vcAsk .vcOptRow').nth(3).locator('.vcIcon').click();
  await T.locator('.vcAsk .vcOptRow input[type="radio"]').nth(0).check();
  await T.locator('.vcAsk button', { hasText: 'Add what’s on my page' }).click();
  await until(() => T.locator('.vcAsk .vcThumb').isVisible());
  ok('📸 puts the worksheet in the question', await T.locator('.vcAsk .vcThumb').isVisible());
  await shot(T, '04-teacher-ask');
  await T.click('.vcAskFoot .vcPrimary');
  ok('the teacher moves to Answers', await until(() => T.locator('.vcSide .vcTab.on', { hasText: 'Answers' }).isVisible()));
  for (const [S, who] of [[S1, 'Amy'], [S2, 'Zoe'], [S3, 'Bella']]) {
    ok('the question pops up over the video for ' + who, await until(() => S.locator('.vcQ .vcOpt').first().isVisible(), 15000));
  }
  ok('the picture arrives with the question', await until(() => S1.evaluate(() => { var i = document.querySelector('.vcQ .vcQImg'); return !!(i && i.naturalWidth > 0); }), 15000));
  ok('a student\'s device never holds the answer', await S1.evaluate(() => !JSON.stringify(window.lc.state()).includes('"answer":0')));
  await shot(S3, '05-phone-question');
  await S1.locator('.vcQ .vcOpt').nth(0).click();   // Iron — right
  await S2.locator('.vcQ .vcOpt').nth(1).click();   // Wood — wrong
  ok('Amy is told her answer arrived', await until(() => S1.locator('.vcQStatus', { hasText: 'Your teacher has your answer' }).isVisible()));
  await until(() => T.evaluate(() => document.querySelectorAll('.vcAns').length === 2));
  ok('both answers land on the teacher\'s board', await T.evaluate(() => document.querySelectorAll('.vcAns').length) === 2);
  ok('the key marks Iron right and Wood wrong', await T.evaluate(() => document.querySelectorAll('.vcAns.ok').length === 1 && document.querySelectorAll('.vcAns.no').length === 1));
  ok('the board says who is still owed an answer', /Bella Koh/.test(await T.locator('.vcWaiting').textContent()));
  ok('the class split is drawn', await T.evaluate(() => document.querySelectorAll('.vcBarRow').length === 3));
  ok('the tiles show ✓ and ✗', await until(() => T.evaluate(() => document.querySelectorAll('.vcTileBadge.ok').length === 1 && document.querySelectorAll('.vcTileBadge.no').length === 1)));
  // ✓ ◐ ✗ — the key's marks are PROVISIONAL until the teacher confirms them.
  ok('the key\'s marks are provisional: ✓ Confirm all (2) is offered', await T.locator('.vcConfirmAll', { hasText: 'Confirm all (2)' }).isVisible());
  ok('…drawn dashed on the board and the tiles', await T.evaluate(() => document.querySelectorAll('.vcAns.prov').length === 2 && document.querySelectorAll('.vcTileBadge.prov').length === 2));
  ok('…and a student is not told a provisional mark', await S1.locator('.vcQStatus', { hasText: 'Your teacher has your answer' }).isVisible());
  ok('the live tally counts ✓ 1 and ✗ 1', (await T.locator('.vcTallyChip.ok').textContent()).trim() === '✓ 1' && (await T.locator('.vcTallyChip.no').textContent()).trim() === '✗ 1');
  await T.locator('.vcTallyChip.ok').click();
  ok('tapping ✓ shows who: Amy, and only her answer', /Amy Tan/.test(await T.locator('.vcTallyWho').textContent()) && await T.locator('.vcAns').count() === 1);
  await T.locator('.vcTallyChip.ok').click();
  ok('tapping it again shows everyone', await T.locator('.vcAns').count() === 2);
  await T.locator('.vcBarRow').nth(1).click();
  ok('tapping an option\'s bar shows who chose it', /Chose B:.*Zoe Ng/.test(await T.locator('.vcTallyWho').textContent()));
  await T.locator('.vcTallyWho .vcIcon').click();
  await T.locator('.vcConfirmAll').click();
  ok('✓ Confirm all makes them the teacher\'s', await until(() => T.evaluate(() => !document.querySelector('.vcAns.prov') && document.querySelectorAll('.vcMine').length === 2)));
  ok('…and Amy is told she is right', await until(() => S1.locator('.vcQStatus', { hasText: 'Correct!' }).isVisible(), 10000));
  await shot(T, '06-teacher-answers');
  await T.locator('.vcAnsHead button', { hasText: 'Show the answer' }).click();
  ok('Bella (who did not answer) is shown the answer', await until(() => S3.locator('.vcQStatus', { hasText: 'Answer: A. Iron' }).isVisible()));
  ok('Zoe sees her choice marked wrong', await until(() => S2.locator('.vcOpt.wrong').isVisible()));

  // Fill in the blank, with Zoe's wifi down when she answers.
  await T.locator('.vcSide .vcTab', { hasText: 'Ask' }).click();
  await T.locator('.vcSeg .vcSegBtn', { hasText: 'Fill in the blank' }).click();
  await T.fill('.vcAsk .vcQText', 'Water boils at ___ °C.');
  await T.fill('.vcAsk textarea >> nth=1', '100');
  await T.click('.vcAskFoot .vcPrimary');
  ok('the blank pops up for Zoe', await until(() => S2.locator('.vcQ .vcBlank').isVisible(), 15000));
  await S1.locator('.vcQ .vcBlank').waitFor({ timeout: 15000 });
  await S1.fill('.vcQ .vcBlank', '100.0');
  await S1.press('.vcQ .vcBlank', 'Enter');
  await S2.ctx.setOffline(true);
  await S2.fill('.vcQ .vcBlank', 'one hundred');
  await S2.press('.vcQ .vcBlank', 'Enter');
  ok('offline: Zoe sees it is still sending', await until(() => S2.locator('.vcQStatus', { hasText: /Sending|Still sending/ }).isVisible(), 6000));
  await sleep(2500);
  await S2.ctx.setOffline(false);
  ok('back online: Zoe\'s answer reaches the teacher', await until(() => T.evaluate(() => [...document.querySelectorAll('.vcAnsName')].some(e => e.textContent === 'Zoe Ng')), 45000));
  ok('…and is acknowledged on her screen', await until(() => S2.locator('.vcQStatus', { hasText: 'Your teacher has your answer' }).isVisible(), 20000));
  ok('"100.0" is marked right against "100"', await T.evaluate(() => { var a = [...document.querySelectorAll('.vcAns')].find(x => x.querySelector('.vcAnsName').textContent === 'Amy Tan'); return !!(a && a.classList.contains('ok')); }));
  // "one hundred" is not in the key: Chung GPT pre-marks it, with its reason.
  ok('✨ Chung GPT pre-marks the answer the key could not settle', await until(() => T.evaluate(() => { var a = [...document.querySelectorAll('.vcAns')].find(x => x.querySelector('.vcAnsName').textContent === 'Zoe Ng'); return !!(a && a.classList.contains('ok') && a.classList.contains('prov') && /One hundred is the same as 100/.test((a.querySelector('.vcAiWhy') || {}).textContent || '')); }), 15000));
  ok('…asked only about Zoe, numbered and never named', await T.evaluate(() => (window.aiAsks || []).length === 1 && window.aiAsks[0].answers.length === 1 && window.aiAsks[0].answers[0].id === 's1' && !JSON.stringify(window.aiAsks).includes('Zoe')));
  ok('…and Zoe still sees only that her answer arrived', await S2.locator('.vcQStatus', { hasText: 'Your teacher has your answer' }).isVisible());
  const zoeRow = T.locator('.vcAns', { hasText: 'Zoe Ng' });
  await zoeRow.locator('.vcMark.part').click();
  ok('one tap overrides it: ◐ partly right', await until(() => S2.locator('.vcQStatus', { hasText: 'Partly right' }).isVisible(), 10000));
  await zoeRow.locator('.vcMark.part').click();
  ok('the same tap takes the override off again', await until(() => T.locator('.vcAns', { hasText: 'Zoe Ng' }).locator('.vcConfirm').isVisible()));
  await T.locator('.vcConfirmAll').click();
  ok('Confirm all: Zoe is told she is right', await until(() => S2.locator('.vcQStatus', { hasText: 'Correct!' }).isVisible(), 10000));

  // Open-ended, for Bella only; she types and adds nothing else; the teacher marks it and gives points.
  await T.locator('.vcSide .vcTab', { hasText: 'Ask' }).click();
  await T.locator('.vcSeg .vcSegBtn', { hasText: 'Open-ended' }).click();
  await T.fill('.vcAsk .vcQText', 'Why did the ice on the metal tray melt first?');
  await T.locator('.vcTo .vcSegBtn', { hasText: 'Chosen students' }).click();
  await T.locator('.vcPickChips .vcChip', { hasText: 'Bella Koh' }).click();
  await T.click('.vcAskFoot .vcPrimary');
  ok('the open question reaches Bella', await until(() => S3.locator('.vcQ textarea').isVisible(), 15000));
  await sleep(1500);
  ok('…and nobody else', !(await S1.locator('.vcQ textarea').isVisible()));
  await S3.fill('.vcQ textarea', 'Metal conducts heat from the room into the ice faster.');
  await S3.locator('.vcQ .vcPrimary', { hasText: 'Send' }).click();
  await until(() => T.evaluate(() => document.querySelectorAll('.vcAns').length === 1));
  ok('✨ an open answer is pre-marked ◐ with a one-line reason', await until(() => T.evaluate(() => { var a = document.querySelector('.vcAns'); return !!(a && a.classList.contains('part') && /not that metal/.test((a.querySelector('.vcAiWhy') || {}).textContent || '')); }), 15000));
  await T.locator('.vcAns .vcMark').first().click();
  await T.locator('.vcAns .vcPts', { hasText: '+2' }).click();
  ok('Bella is told she is right and earned points', await until(() => S3.locator('.vcQStatus', { hasText: /Correct!.*\+2/ }).isVisible(), 10000));
  ok('the points go through the reward register door', await T.evaluate(() => JSON.stringify(window.awards) === JSON.stringify([['Bella Koh', 2]])));

  // ✨ AI send: drag round a question, Chung GPT reads it and pushes it.
  await T.locator('.vcSide .vcTab', { hasText: 'Ask' }).click();
  await T.locator('.vcAiSendBtn').click();
  ok('✨ AI send asks for the box, then reads it', await until(() => T.evaluate(() => window.cropAsked === 1 && window.readAsked === 'data:image/jpeg;base64')));
  ok('…and the question it read pops up for Amy as multiple choice', await until(() => S1.locator('.vcQ .vcOpt', { hasText: 'Jupiter' }).isVisible(), 15000));
  ok('…with the printed (1) (2) labels off and no answer on her device', await S1.evaluate(() => { var t = [...document.querySelectorAll('.vcQ .vcOpt')].map(x => x.textContent).join('|'); return /Mars/.test(t) && !/\(1\)/.test(t) && !JSON.stringify(window.lc.state()).includes('"answer":1'); }));
  ok('the board says it was read by Chung GPT', await until(() => T.locator('.vcAnsHead', { hasText: 'Read off the worksheet by Chung GPT' }).isVisible()));
  await S1.locator('.vcQ .vcOpt', { hasText: 'Jupiter' }).click();
  await until(() => T.evaluate(() => document.querySelectorAll('.vcAns.ok').length === 1));
  ok('the key it read marks Amy right, provisionally', await T.locator('.vcConfirmAll', { hasText: 'Confirm all (1)' }).isVisible());
  await T.locator('.vcConfirmAll').click();
  await until(() => S1.locator('.vcQStatus', { hasText: 'Correct!' }).isVisible(), 10000);

  /* ---------- 4. hands ---------- */
  await S1.locator('.vcCtl', { hasText: '✋' }).first().click();
  ok('a raised hand reaches the teacher\'s bar', await until(() => T.locator('.vcCtl.vcHands', { hasText: '✋ 1' }).isVisible(), 10000));
  await T.locator('.vcCtl.vcHands').click();
  await T.locator('.vcHandRow button', { hasText: 'Hand down' }).click();
  ok('the teacher puts it down on Amy\'s screen too', await until(() => S1.evaluate(() => window.toasts.some(t => /put your hand down/.test(t))), 10000));
  await shot(T, '07-teacher-people');

  /* ---------- 5. end the class, reports ---------- */
  console.log('End and reports');
  await T.locator('.vcCtl.vcEnd').click();
  ok('the teacher sees the reports', await until(() => T.locator('.vcEndedTop').isVisible(), 15000));
  ok('every student who came has a report (Ethan too, who came by his link and left)', await T.locator('.vcRep').count() === 4);
  ok('students are told the class ended', await until(() => S1.locator('.vcEnded').isVisible(), 15000));
  ok('Amy\'s summary line is factual', /Amy Tan answered every question asked in class \(3\), getting 3 of 3 marked answers right/.test(await T.locator('.vcRep', { hasText: 'Amy Tan' }).locator('.vcRepLine').textContent()));
  await T.locator('.vcRep', { hasText: 'Amy Tan' }).locator('.vcRepHead').click();
  const reportText = await T.locator('.vcRepText').inputValue();
  ok('the report lists her answers and time', /Questions answered: 3 of 3/.test(reportText) && /“A\. Iron” ✓/.test(reportText) && /Time in class: \d+ minute/.test(reportText), reportText.slice(0, 400));
  await until(async () => (await T.locator('.vcRepBody input').nth(1).inputValue()) !== '');
  ok('the family\'s email is filled in', /^parent-famA_sA1@example\.com$/.test(await T.locator('.vcRepBody input').nth(1).inputValue()));
  await T.fill('.vcRepBody input >> nth=0', 'Great focus today.');
  ok('the note goes into the report', /Teacher's note: Great focus today\./.test(await T.locator('.vcRepText').inputValue()));
  await T.locator('.vcRepBody .vcPrimary', { hasText: 'Send' }).click();
  ok('Send asks first, naming the address', await until(() => T.evaluate(() => window.sentMail.length === 1)) && (T.__dialogs || []).some(d => /Amy Tan’s report to parent-famA_sA1@example\.com/.test(d)));
  const mail = await T.evaluate(() => window.sentMail[0]);
  ok('the email has a subject, text and escaped HTML', /Live lesson report — Amy Tan/.test(mail.subject) && /Dear Parent/.test(mail.text) && /<div style=/.test(mail.html));
  ok('the report row says it was sent', await T.locator('.vcRep', { hasText: 'Amy Tan' }).locator('.vcTag.ok').isVisible());
  ok('the lesson record was saved with every answer', await T.evaluate(() => { var s = Object.values(window.saved)[0]; return !!(s && s.questions.length === 4 && Object.keys(s.answers).length === 4 && s.sent); }));
  await shot(T, '08-teacher-reports');
  ok('the mirror says the class is over', await until(() => !(store.get('liveClassRooms/main') || {}).open, 5000));
  await until(() => T.evaluate(() => window.recSaved[0]), 60000);
  const rec = await T.evaluate(() => window.recSaved[0]);
  ok('📼 the class recording is joined in the cloud after End', !!rec, JSON.stringify(await T.evaluate(() => window.toasts)));
  if (rec) {
    const obj = objects.get(rec.path);
    ok('one file, with the worksheet it was on', !!obj && obj.data.length > 10000 && rec.docs.some(d => d.id === 'ws1'), JSON.stringify(rec) + ' ' + [...objects.keys()].join(','));
    try {
      const f = path.join(tmp, 'class.webm'); fs.writeFileSync(f, obj.data);
      const pr = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', f], { encoding: 'utf8' }));
      const dur = Number(pr.format.duration);
      ok('it says how long it is (' + dur.toFixed(1) + ' s ≈ ' + (rec.durationMs / 1000).toFixed(1) + ' s) and has picture and sound',
        Math.abs(dur - rec.durationMs / 1000) < 4 && pr.streams.some(x => x.codec_type === 'video') && pr.streams.some(x => x.codec_type === 'audio'));
    } catch (e) { console.log('    (no ffprobe: the file is not inspected)'); }
  }

  ok('no page errors', errors.length === 0, errors.join('\n'));
  ok('the server reported nothing unexpected', reports.length === 0, reports.join('\n'));
} catch (e) {
  fail++;
  console.log('  ✗ the check stopped: ' + (e && e.stack || e));
} finally {
  await browser.close().catch(() => {});
  web.close();
  lk.kill('SIGTERM');
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('\nlive-class-check: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
