/* =====================================================================
   🎬 VIDEOS ON PAPER — the real page and the real player, in Chromium
   ---------------------------------------------------------------------
   tools/video-playlist-tests.mjs pins the arithmetic and the wiring. What
   no reading of the source can say is whether a real export really leaves
   the pills off and really puts ONE working link on page 1, whether a
   student's export reuses the teacher's code without uploading anything,
   and whether videos.html really downloads the list, refuses a changed
   one, plays one video after another and fits on a phone.

     node tools/video-playlist-check.mjs
     PW=/path/to/playwright/index.mjs PDF_LIB=/path/to/pdf-lib.min.js node tools/video-playlist-check.mjs
     VP_SCREENSHOTS=/some/dir node tools/video-playlist-check.mjs        # keep screenshots and the PDF
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) {
  console.log('video-playlist-check: no Playwright at ' + PW + ' — skipped.');
  process.exit(0);
}

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FILE = pathToFileURL(path.join(ROOT, 'index.html')).href;
const SHOTS = process.env.VP_SCREENSHOTS || process.env.SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const VP = require(path.join(ROOT, 'video-playlist.js'));
let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (note ? '\n      ' + note : '')); }
};

const LESSON_URL = 'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/' +
  encodeURIComponent('pdf-annotator/lesson-doc1-l1.webm') + '?alt=media&token=5d0c2c1e-7a4b-4f7e-9b1a-0c0000000001';
const VOICE_URL = 'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/' +
  encodeURIComponent('pdf-annotator/lesson-doc1-l2.webm') + '?alt=media&token=5d0c2c1e-7a4b-4f7e-9b1a-0c0000000003';
const CAPTIONS_URL = 'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/' +
  encodeURIComponent('pdf-annotator/lesson-doc1-l1.captions.json') + '?alt=media&token=5d0c2c1e-7a4b-4f7e-9b1a-0c0000000002';
const ANNS = [
  { id: 'v2', type: 'video', page: 1, x: 40, y: 100, w: 150, h: 30, url: 'https://media.example.org/clips/q1.mp4', label: 'Q1 worked solution' },
  { id: 'l1', type: 'video', page: 1, x: 40, y: 400, w: 190, h: 30, url: LESSON_URL, label: 'Q5 · video lesson · 0:01',
    lessonRecording: { version: 1, video: true, duration: 1000, title: 'Q5', captionsUrl: CAPTIONS_URL, captionsLang: 'en', audioPath: 'x' } },
  { id: 'l2', type: 'video', page: 1, x: 40, y: 600, w: 190, h: 30, url: VOICE_URL, label: 'Q6 · lesson · 0:01',
    lessonRecording: { version: 1, duration: 1000, audioPath: 'y' } },
  { id: 'v3', type: 'video', page: 1, x: 300, y: 700, w: 150, h: 30, url: 'https://youtu.be/abcDEF12345', label: 'Q8 on YouTube' },
  { id: 'v5', type: 'video', page: 1, x: 300, y: 740, w: 150, h: 30, url: 'https://vimeo.com/123456', label: 'Q9 on Vimeo' },
  { id: 'p1', type: 'pen', page: 1, color: '#d33', width: 2, points: [{ x: 420, y: 30 }, { x: 560, y: 60 }, { x: 570, y: 140 }] }
];

/* A short WebM (VP8 + nothing) is hard to make by hand, so the media is a
   one-second silent WAV: it plays, it ends, and that is what the player is
   asked to do. */
function silentWav(seconds) {
  const rate = 8000, n = Math.round(rate * seconds), data = n * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(data, 40);
  return b;
}
const WAV = silentWav(0.8);

const browser = await chromium.launch();

/* ------------------------------------------------------------------ */
console.log('\n📄 The export');
const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
const page = await ctx.newPage();
if (process.env.PDF_LIB) {
  const body = fs.readFileSync(process.env.PDF_LIB);
  await page.route('**/pdf-lib.min.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body }));
}
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
ok('the video playlist module is loaded', await page.evaluate(() => !!(window.VideoPlaylist && typeof vplLinkFor === 'function')));

await page.evaluate((anns) => {
  const W = 600, H = 780;
  const el = (tag, attrs) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(k => n.setAttribute(k, attrs[k]));
    return n;
  };
  const wrap = document.createElement('div');
  wrap.className = 'pageWrap';
  wrap.style.cssText = 'position:relative;flex:none;width:' + W + 'px;height:' + H + 'px;background:#fff';
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' });
  svg.classList.add('overlay');
  wrap.appendChild(canvas); wrap.appendChild(svg);
  document.body.appendChild(wrap);
  const p = { num: 1, baseW: W, baseH: H, wrap, canvas, svg, viewport1: { convertToPdfPoint: (x, y) => [x, H - y] } };
  pages = [p]; pdfDoc = {}; scale = 1; annotations = JSON.parse(JSON.stringify(anns));
  currentUser = { uid: 'teacher-1', email: ADMIN_EMAIL, displayName: 'Teacher' };
  currentDocId = 'doc1'; docName = 'P5 Heat — Worksheet 3';
  applyRoleUI();
  // Firebase stand-ins: Storage keeps what is put, the worksheet document
  // remembers what is merged into it.
  const objects = {}; let puts = 0; const docWrites = [];
  window.__vp = { objects, docWrites, puts: () => puts };
  storage = {
    ref(pth) {
      return {
        getDownloadURL: async () => {
          if (!objects[pth]) { const e = new Error('object-not-found'); e.code = 'storage/object-not-found'; throw e; }
          return 'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/' + encodeURIComponent(pth) + '?alt=media&token=' + objects[pth].token;
        },
        putString: async (body, fmt, meta) => { puts++; objects[pth] = { body, meta, token: '7e1d0a3c-1b2c-4d5e-8f90-' + String(puts).padStart(12, '0') }; }
      };
    }
  };
  db = { collection: () => ({ doc: (id) => ({ set: async (data, o) => { docWrites.push({ id, data, merge: !!(o && o.merge) }); } }) }) };
}, ANNS);

const exported = await page.evaluate(async () => {
  const link = await vplLinkFor(annotations, true);
  const again = await vplLinkFor(annotations, true);
  const paths = Object.keys(window.__vp.objects);
  const body = paths.length ? JSON.parse(window.__vp.objects[paths[0]].body) : null;
  return { link, again, paths, puts: window.__vp.puts(), keys: body ? Object.keys(body).sort().join(',') : '',
    count: body ? body.items.length : 0, docWrites: window.__vp.docWrites, pub: vplDocPub };
});
// From file:// there is no web address to point a code at.
ok('a page with no web address makes no code (file://)', exported.link === null, JSON.stringify(exported.link));

// The rest builds the link for the site's own address, as served.
const exported2 = await page.evaluate(async () => {
  const P = VideoPlaylist.pure;
  const pl = vplPlaylistFor(annotations);
  const pub = await vplPublish(pl);
  const url = P.viewerUrl('https://polymathlc.com.sg/anskey/', pub.hash, pub.token);
  await vplRemember(pub, pl.items.length, currentDocId);
  const paths = Object.keys(window.__vp.objects);
  const body = JSON.parse(window.__vp.objects[paths[0]].body);
  const pub2 = await vplPublish(pl);
  return { url, pub, pub2, paths, puts: window.__vp.puts(), keys: Object.keys(body).sort().join(','), count: body.items.length,
    type: window.__vp.objects[paths[0]].meta.contentType, docWrites: window.__vp.docWrites, docPub: vplDocPub, hash: pl.hash };
});
ok('the list goes up once, under its own content hash', exported2.puts === 1 && exported2.paths.length === 1 &&
  exported2.paths[0] === 'pdf-annotator/videos-' + exported2.hash + '.json' && /json/.test(exported2.type), JSON.stringify(exported2.paths));
ok('…holding the worksheet’s name, its id and its five videos — nothing else', exported2.keys === 'hash,items,name,v,ws' && exported2.count === 5, exported2.keys + ' / ' + exported2.count);
ok('…the token is remembered on the worksheet document, merged', exported2.docWrites.length === 1 && exported2.docWrites[0].merge &&
  exported2.docWrites[0].data.videoPlaylist.hash === exported2.hash && exported2.docPub && exported2.docPub.token === exported2.pub.token, JSON.stringify(exported2.docWrites));
ok('…a second export reuses it: no second upload', exported2.puts === 1 && exported2.pub2.token === exported2.pub.token);
ok('…the link is videos.html with a 31-character code', /^https:\/\/polymathlc\.com\.sg\/anskey\/videos\.html\?[A-Za-z0-9_-]{31}$/.test(exported2.url), exported2.url);

const pdfOk = await page.evaluate(() => typeof PDFLib !== 'undefined' && !!PDFLib.PDFDocument);
let pdfB64 = '';
if (!pdfOk) {
  console.log('  – pdf-lib is not reachable here (set PDF_LIB=…) — the PDF half was skipped.');
} else {
  const pdf = await page.evaluate(async (url) => {
    const d = await PDFLib.PDFDocument.create();
    d.addPage([600, 780]);
    pdfBytes = await d.save();
    const uris = async (bytes) => {
      const back = await PDFLib.PDFDocument.load(bytes);
      const pg = back.getPage(0);
      const annots = pg.node.lookup(PDFLib.PDFName.of('Annots'));
      const out = [];
      if (annots) for (let i = 0; i < annots.size(); i++) {
        const an = annots.lookup(i); const act = an.lookup(PDFLib.PDFName.of('A'));
        const uri = act && act.lookup(PDFLib.PDFName.of('URI'));
        const rect = an.lookup(PDFLib.PDFName.of('Rect'));
        if (uri) out.push({ uri: uri.decodeText ? uri.decodeText() : String(uri), rect: rect ? rect.asArray().map(n => n.asNumber()) : [] });
      }
      return out;
    };
    const withLink = await buildAnnotatedPdf(false, { videos: { url, count: 5 } });
    const plain = await buildAnnotatedPdf(false, {});
    const withShare = await buildAnnotatedPdf(false, { videos: { url, count: 5 }, qr: 'https://polymathlc.com.sg/anskey/?share=doc1' });
    let b64 = ''; const u8 = new Uint8Array(withLink);
    for (let i = 0; i < u8.length; i += 0x8000) b64 += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    // pdf-lib writes each line of text as a hex string of its bytes.
    const hex = (s) => Array.from(s, ch => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase();
    const pageText = async (bytes) => {
      const back = await PDFLib.PDFDocument.load(bytes);
      const node = back.getPage(0).node;
      const c = node.lookup(PDFLib.PDFName.of('Contents'));
      const streams = c instanceof PDFLib.PDFArray ? c.asArray().map(r => back.context.lookup(r)) : [c];
      let out = '';
      streams.forEach(st => {
        const raw = st instanceof PDFLib.PDFRawStream ? PDFLib.decodePDFRawStream(st).decode() : st.getContents();
        out += new TextDecoder('latin1').decode(raw);
      });
      return out.toUpperCase();
    };
    const text = await pageText(withLink);
    const plainText = await pageText(plain);
    return { linked: await uris(withLink), plain: await uris(plain), share: await uris(withShare), b64: btoa(b64),
      pillWordsGone: !text.includes(hex('Q1 worked solution')), pillWordsBefore: plainText.includes(hex('Q1 worked solution')),
      headline: text.includes(hex('Watch all 5 videos')) };
  }, exported2.url);
  pdfB64 = pdf.b64;
  if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'videos-export.pdf'), Buffer.from(pdf.b64, 'base64'));
  ok('without the link the pills are on the paper, one link each (as before)', pdf.plain.length === 5 && pdf.pillWordsBefore, JSON.stringify(pdf.plain.map(u => u.uri)));
  ok('with it, page 1 carries exactly ONE link — to the player', pdf.linked.length === 1 && pdf.linked[0].uri === exported2.url, JSON.stringify(pdf.linked));
  ok('…the pills are gone from the paper', pdf.pillWordsGone);
  ok('…and the box says what it is', pdf.headline);
  const r = pdf.linked[0] ? pdf.linked[0].rect : [];
  // The pen stroke sits top right (x 420–570, y 30–140 from the top): the box goes elsewhere.
  const penPdf = { x: 418, y: 780 - 142, w: 154, h: 114 };
  const overlaps = r.length === 4 && !(r[2] <= penPdf.x || r[0] >= penPdf.x + penPdf.w || r[3] <= penPdf.y || r[1] >= penPdf.y + penPdf.h);
  ok('…in a spot that covers none of the teacher’s writing', r.length === 4 && !overlaps, JSON.stringify(r));
  const shareRect = (pdf.share.find(u => /share=/.test(u.uri)) || {}).rect || [];
  const vidRect = (pdf.share.find(u => /videos\.html/.test(u.uri)) || {}).rect || [];
  const clash = shareRect.length === 4 && vidRect.length === 4 &&
    !(vidRect[2] <= shareRect[0] || vidRect[0] >= shareRect[2] || vidRect[3] <= shareRect[1] || vidRect[1] >= shareRect[3]);
  ok('…and never on the worksheet’s own share code', shareRect.length === 4 && vidRect.length === 4 && !clash, JSON.stringify({ shareRect, vidRect }));
}

const student = await page.evaluate(async (url) => {
  currentUser = { uid: 'kid-1', email: 'kid@example.com', displayName: 'Kid' };
  applyRoleUI();
  const before = window.__vp.puts();
  const pl = vplPlaylistFor(annotations);
  const pub = await vplPublish(pl);
  const same = pub ? VideoPlaylist.pure.viewerUrl('https://polymathlc.com.sg/anskey/', pub.hash, pub.token) : '';
  // A list the teacher has not filed (a video added since) has no code.
  const extra = annotations.concat([{ id: 'v9', type: 'video', page: 1, x: 10, y: 10, url: 'https://youtu.be/zzzZZZ12345', label: 'new' }]);
  const stale = await vplPublish(vplPlaylistFor(extra));
  const kept = await vplLinkFor(extra, true);
  const writes = window.__vp.docWrites.length;
  await vplAfterSave();
  return { same, url, uploads: window.__vp.puts() - before, stale, kept, writesAfter: window.__vp.docWrites.length - writes };
}, exported2.url);
ok('a student exporting later gets the same code and uploads nothing', student.same === student.url && student.uploads === 0, JSON.stringify(student));
ok('…a list the teacher has not filed gets no code, so that PDF keeps its pills', student.stale === null && student.kept === null);
ok('…and a student’s save files nothing', student.writesAfter === 0);

const teacherSave = await page.evaluate(async () => {
  currentUser = { uid: 'teacher-1', email: ADMIN_EMAIL, displayName: 'Teacher' };
  applyRoleUI();
  annotations.push({ id: 'v9', type: 'video', page: 1, x: 10, y: 10, url: 'https://youtu.be/zzzZZZ12345', label: 'new' });
  const before = window.__vp.puts();
  const filed = await vplAfterSave();
  const again = await vplAfterSave();
  practiceMode = true;
  const inPractice = await vplAfterSave();
  practiceMode = false;
  return { filed, again, inPractice, uploads: window.__vp.puts() - before, pubHash: vplDocPub && vplDocPub.hash, want: vplPlaylistFor(annotations).hash };
});
ok('a teacher’s save files a changed list once, and remembers it', teacherSave.filed === true && teacherSave.uploads === 1 && teacherSave.pubHash === teacherSave.want, JSON.stringify(teacherSave));
ok('…a second save with nothing new does nothing, and practice never files', teacherSave.again === false && teacherSave.inPractice === false);
await ctx.close();

/* ------------------------------------------------------------------ */
console.log('\n🎬 The player');
// Served over http, as the site is.
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const f = path.join(ROOT, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  const type = f.endsWith('.html') ? 'text/html' : f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : f.endsWith('.png') ? 'image/png' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port + '/';

const pl = VP.pure.buildPlaylist(ANNS, { name: 'P5 Heat — Worksheet 3', ws: 'doc1' });
const TOKEN = '7e1d0a3c-1b2c-4d5e-8f90-000000000001';
const body = VP.pure.publishPayload(pl);
const viewer = VP.pure.viewerUrl(BASE, pl.hash, TOKEN);
ok('the viewer link is built for this server', viewer.startsWith(BASE + 'videos.html?'), viewer);

async function playerPage(viewport, opts = {}) {
  const c = await browser.newContext({ viewport, ...(opts.ctx || {}) });
  const pg = await c.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  const seen = [];
  await pg.route('https://firebasestorage.googleapis.com/**', route => {
    const u = route.request().url();
    seen.push(u);
    const h = { 'Access-Control-Allow-Origin': '*' };
    if (u.includes(encodeURIComponent('videos-' + pl.hash + '.json'))) {
      return route.fulfill({ status: 200, headers: h, contentType: 'application/json', body: opts.body || body });
    }
    if (u.includes('captions.json')) {
      return route.fulfill({ status: 200, headers: h, contentType: 'application/json', body: JSON.stringify({ version: 1, cues: [{ s: 0, e: 700, t: 'Hello class' }] }) });
    }
    if (u.includes('lesson-')) return route.fulfill({ status: 200, headers: h, contentType: 'audio/wav', body: WAV });
    return route.fulfill({ status: 404, headers: h, body: '' });
  });
  await pg.route('https://media.example.org/**', route => route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'audio/wav', body: WAV }));
  await pg.route(/youtube-nocookie\.com|youtube\.com|drive\.google\.com/, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>player</title><body style="background:#000"></body>' }));
  await pg.goto(opts.url || viewer);
  return { c, pg, errs, seen };
}

{
  const { c, pg, errs } = await playerPage({ width: 1280, height: 860 });
  await pg.waitForSelector('.vpShell.ready', { timeout: 5000 }).catch(() => {});
  const first = await pg.evaluate(() => ({
    title: document.getElementById('vpTitle').textContent,
    sub: document.getElementById('vpSub').textContent,
    items: Array.from(document.querySelectorAll('.vpItem b')).map(b => b.textContent),
    on: document.querySelector('.vpItem.on b') && document.querySelector('.vpItem.on b').textContent,
    media: document.querySelector('#vpStageInner video, #vpStageInner audio') ? document.querySelector('#vpStageInner video, #vpStageInner audio').tagName : '',
    now: document.getElementById('vpNowTitle').textContent,
    prevDisabled: document.getElementById('vpPrev').disabled
  }));
  ok('the player opens on the worksheet’s name', first.title === 'P5 Heat — Worksheet 3' && /All 5 videos/.test(first.sub), JSON.stringify(first));
  ok('…with every video listed in question order', JSON.stringify(first.items) === JSON.stringify(pl.items.map(i => i.label)), JSON.stringify(first.items));
  ok('…the first one on the stage, in a <video>', first.on === pl.items[0].label && first.media === 'VIDEO' && first.now === pl.items[0].label && first.prevDisabled);
  if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, 'videos-desktop.png') });

  // Let the first one play to its end: "Up next" counts down and moves on.
  await pg.evaluate(() => { const m = document.querySelector('#vpStageInner video'); m.muted = true; return m.play().catch(() => {}); });
  await pg.waitForFunction(() => !document.getElementById('vpNext').hidden, null, { timeout: 6000 }).catch(() => {});
  const upNext = await pg.evaluate(() => ({ shown: !document.getElementById('vpNext').hidden, title: document.getElementById('vpNextTitle').textContent }));
  ok('when a video ends, Up next names the next one', upNext.shown && upNext.title === pl.items[1].label, JSON.stringify(upNext));
  if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, 'videos-up-next.png') });
  await pg.waitForFunction((want) => document.getElementById('vpNowTitle').textContent === want, pl.items[1].label, { timeout: 6000 }).catch(() => {});
  const second = await pg.evaluate(() => ({
    now: document.getElementById('vpNowTitle').textContent,
    hash: location.hash,
    track: !!document.querySelector('#vpStageInner track'),
    writing: document.getElementById('vpWriting').hidden ? '' : document.getElementById('vpWriting').getAttribute('href')
  }));
  ok('…and then plays it by itself', second.now === pl.items[1].label && second.hash === '#2', JSON.stringify(second));
  await pg.waitForFunction(() => !!document.querySelector('#vpStageInner track'), null, { timeout: 3000 }).catch(() => {});
  ok('a lesson with captions gets an English captions track', await pg.evaluate(() => {
    const t = document.querySelector('#vpStageInner track');
    return !!t && t.srclang === 'en' && /^blob:/.test(t.src);
  }));
  ok('…and a link to watch it with the writing in Ans Key', second.writing === './?ws=doc1&do=play&rec=l1', second.writing);

  // Stay here cancels the countdown.
  await pg.evaluate(() => { const m = document.querySelector('#vpStageInner video'); m.muted = true; return m.play().catch(() => {}); });
  await pg.waitForFunction(() => !document.getElementById('vpNext').hidden, null, { timeout: 6000 }).catch(() => {});
  await pg.click('#vpNextCancel');
  await pg.waitForTimeout(3600);
  ok('Stay here keeps the video that just finished', await pg.evaluate((want) => document.getElementById('vpNowTitle').textContent === want && document.getElementById('vpNext').hidden, pl.items[1].label));

  // A voice lesson, then YouTube, then a link that opens in a new tab.
  await pg.click('.vpItem[data-i="2"]');
  ok('a voice lesson plays as sound, with a card saying so', await pg.evaluate(() => !!document.querySelector('#vpStageInner audio') && !!document.querySelector('.vpAudioCard')));
  await pg.click('#vpNextBtn');
  const yt = await pg.evaluate(() => {
    const f = document.querySelector('#vpStageInner iframe');
    return { src: f ? f.src : '', hint: document.getElementById('vpHint').hidden ? '' : document.getElementById('vpHint').textContent };
  });
  ok('a YouTube clip plays in the privacy-enhanced embed, rebuilt from its id', /^https:\/\/www\.youtube-nocookie\.com\/embed\/abcDEF12345\?/.test(yt.src), yt.src);
  ok('…and the page says to press Next when it finishes', /Next/.test(yt.hint), yt.hint);
  await pg.keyboard.press('n');
  const link = await pg.evaluate(() => {
    const a = document.querySelector('.vpLinkCard a');
    return { href: a ? a.href : '', target: a ? a.target : '', nextDisabled: document.getElementById('vpNextBtn').disabled };
  });
  ok('a link that cannot be embedded opens in a new tab', link.href === 'https://vimeo.com/123456' && link.target === '_blank' && link.nextDisabled, JSON.stringify(link));

  // Reload: this device remembers where it was.
  await pg.goto(viewer);
  await pg.waitForSelector('.vpShell.ready', { timeout: 5000 }).catch(() => {});
  ok('a reload comes back to the video it was on', await pg.evaluate((want) => document.getElementById('vpNowTitle').textContent === want, pl.items[4].label));
  await pg.goto(viewer + '#2');
  await pg.waitForSelector('.vpShell.ready', { timeout: 5000 }).catch(() => {});
  ok('#2 in the address starts at the second video', await pg.evaluate((want) => document.getElementById('vpNowTitle').textContent === want, pl.items[1].label));
  ok('the player ran with no uncaught error', errs.length === 0, errs.join('\n      '));
  await c.close();
}

{
  const { c, pg } = await playerPage({ width: 1280, height: 860 }, { body: body.replace('Q1 worked solution', 'Something else') });
  await pg.waitForSelector('.vpShell.failed', { timeout: 5000 }).catch(() => {});
  ok('a changed list is refused in words', await pg.evaluate(() => /not the one this code was printed for/.test(document.getElementById('vpFailText').textContent) && document.getElementById('vpBody').hidden));
  await c.close();
}
{
  const { c, pg } = await playerPage({ width: 1280, height: 860 }, { url: BASE + 'videos.html?nonsense' });
  await pg.waitForSelector('.vpShell.failed', { timeout: 5000 }).catch(() => {});
  ok('a link that is not a code is refused in words', await pg.evaluate(() => /not a complete video code/.test(document.getElementById('vpFailText').textContent)));
  await c.close();
}
{
  const { c, pg, errs } = await playerPage({ width: 390, height: 844 }, { ctx: { isMobile: true, hasTouch: true, deviceScaleFactor: 1 } });
  await pg.waitForSelector('.vpShell.ready', { timeout: 5000 }).catch(() => {});
  const phone = await pg.evaluate(() => ({
    scroll: document.documentElement.scrollWidth, vw: window.innerWidth,
    stageW: document.getElementById('vpStage').getBoundingClientRect().width,
    listBelow: document.querySelector('.vpListCol').getBoundingClientRect().top > document.getElementById('vpStage').getBoundingClientRect().bottom
  }));
  ok('on a phone: no sideways scroll, the player full width, the list under it', phone.scroll <= phone.vw && phone.stageW > 330 && phone.listBelow, JSON.stringify(phone));
  if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, 'videos-phone.png'), fullPage: true });
  ok('…with no uncaught error', errs.length === 0, errs.join('\n      '));
  await c.close();
}
{
  const { c, pg } = await playerPage({ width: 1280, height: 860 }, { ctx: { colorScheme: 'dark' } });
  await pg.waitForSelector('.vpShell.ready', { timeout: 5000 }).catch(() => {});
  ok('dark mode has a dark page', await pg.evaluate(() => getComputedStyle(document.body).backgroundColor === 'rgb(20, 20, 20)'));
  if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, 'videos-dark.png') });
  await c.close();
}

server.close();
await browser.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
