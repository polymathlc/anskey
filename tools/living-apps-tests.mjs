/* =====================================================================
   🪄 LIVING APPS — the arithmetic and the wiring, without a browser
   ---------------------------------------------------------------------
   Runs living-apps.js's pure half in Node, runs its wand bridge in a vm
   against a tiny fake DOM, and pins the glue in index.html: the predicate,
   the teacher gate, the student tap, practice, the print and the load
   order. tools/living-apps-check.mjs does the rest in a real Chromium.

     node --test tools/living-apps-tests.mjs
   ===================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const LA = require('../living-apps.js');
const P = LA.pure;
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../living-apps.css', import.meta.url), 'utf8');
const src = fs.readFileSync(new URL('../living-apps.js', import.meta.url), 'utf8');

test('a title comes from the app’s own <title>, else its first heading, else the file name', () => {
  assert.equal(P.titleFromHtml('<html><head><title> Ballast Tank &amp; Living Diagrams </title></head></html>'), 'Ballast Tank & Living Diagrams');
  assert.equal(P.titleFromHtml('<div><h1>Magnet <b>lab</b></h1></div>'), 'Magnet lab');
  assert.equal(P.titleFromHtml('<div>no title</div>'), '');
  assert.equal(P.titleFromFileName('C:\\fakepath\\Ballast_Tank_Living-Diagrams.html'), 'Ballast Tank Living Diagrams');
  const long = P.cleanTitle('word '.repeat(60));
  assert.ok(long.length <= P.TITLE_MAX && long.endsWith('…'), long);
  assert.equal(P.cleanTitle('a\u0000b\n\tc'), 'a b c');
});

test('normalizeApp is the one door: empty, too big and not-HTML are refused in words', () => {
  assert.equal(P.normalizeApp({ html: '   ' }).reason, 'empty');
  assert.equal(P.normalizeApp({ html: 'just a sentence about magnets' }).reason, 'notHtml');
  const big = P.normalizeApp({ html: '<div>' + 'x'.repeat(P.MAX_CHARS) + '</div>' });
  assert.equal(big.reason, 'tooBig');
  assert.match(big.message, /KB/);
  const ok = P.normalizeApp({ html: '\uFEFF<!doctype html><title>Tank</title><button class="btn btn-wand">W</button>' });
  assert.ok(ok.ok);
  assert.equal(ok.app.v, 1);
  assert.equal(ok.app.title, 'Tank');
  assert.equal(ok.app.wand, true);
  assert.ok(!ok.app.html.startsWith('\uFEFF'), 'the byte-order mark is dropped');
  assert.match(ok.app.hash, /^la1-\d+-[0-9a-f]+$/);
  assert.equal(P.normalizeApp({ html: '<div>x</div>', title: '  My   app ' }).app.title, 'My app');
  assert.equal(P.normalizeApp({ html: '<div>x</div>' }).app.title, 'Living app');
});

test('validApp accepts only a stored app with HTML in it', () => {
  assert.ok(P.validApp({ html: '<div>x</div>' }));
  assert.ok(!P.validApp(null));
  assert.ok(!P.validApp({ html: '' }));
  assert.ok(!P.validApp({ html: 42 }));
  assert.ok(!P.validApp({ html: 'x'.repeat(P.MAX_CHARS + 1) }));
});

test('the sandbox document puts the CSP and the bridge BEFORE the author’s markup', () => {
  const doc = P.sandboxDocument('<meta http-equiv="Content-Security-Policy" content="default-src *"><p>app</p>');
  const csp = doc.indexOf('Content-Security-Policy');
  const bridge = doc.indexOf('polymath:wand');
  const author = doc.indexOf('<p>app</p>');
  assert.ok(csp > 0 && csp < bridge && bridge < author, 'trusted head first');
  assert.match(P.CSP, /connect-src 'none'/);
  assert.match(P.CSP, /form-action 'none'/);
  assert.match(P.CSP, /frame-src 'none'/);
  assert.ok(!/setAttribute\('sandbox'[^)]*same-origin/.test(src) && !/'allow-scripts allow-same-origin'/.test(src), 'the frame never shares the page’s origin');
  assert.match(src, /setAttribute\('sandbox', 'allow-scripts'\)/);
  assert.ok(!/<\/script/i.test(P.WAND_BRIDGE), 'the bridge cannot close its own script tag');
});

test('wrapLines keeps a title to two lines and ellipsises the rest', () => {
  const m = s => s.length * 10;
  assert.deepEqual(P.wrapLines('Short', 300, m, 2), ['Short']);
  const two = P.wrapLines('Ballast tanks make a submarine sink and float again', 200, m, 2);
  assert.equal(two.length, 2);
  assert.ok(two[1].endsWith('…') && m(two[1]) <= 200, JSON.stringify(two));
  assert.deepEqual(P.wrapLines('', 200, m, 2), []);
});

test('placeOnPage keeps the cover on the paper and steps a second one off the first', () => {
  const a = P.placeOnPage(600, 780, P.COVER_W / P.COVER_H, 0, 100);
  const b = P.placeOnPage(600, 780, P.COVER_W / P.COVER_H, 1, 100);
  for (const r of [a, b]) {
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 600 && r.y + r.h <= 780, JSON.stringify(r));
    assert.ok(Math.abs(r.w / r.h - P.COVER_W / P.COVER_H) < 0.02);
  }
  assert.ok(b.x > a.x && b.y > a.y);
  const tiny = P.placeOnPage(200, 120, 2.3, 0);
  assert.ok(tiny.x + tiny.w <= 200 && tiny.y + tiny.h <= 120, JSON.stringify(tiny));
});

test('the stage says what the spell did, and never stays silent', () => {
  for (const how of ['event', 'function', 'wand', 'wand-only', 'play', 'error', 'none', 'nonsense']) {
    assert.ok(P.castMessage(how).length > 10, how);
  }
  assert.match(P.castMessage('none'), /no wand of its own/);
});

/* ---- the bridge, run for real in a vm over a fake DOM ---- */
function fakeWorld({ withWand = true, held = false, polymathWand = false, prevent = false, play = false } = {}) {
  const log = [];
  const listeners = {};
  const mk = (name, rect, extra = {}) => ({
    name, disabled: false, rect, attrs: {}, children: [],
    getBoundingClientRect() { return this.rect; },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    closest() { return this.host || null; },
    querySelector(sel) { return (this.find && this.find(sel)) || null; },
    scrollIntoView() { log.push('scroll:' + name); },
    click() { log.push('click:' + name); if (name === 'wand') this.attrs['aria-pressed'] = 'true'; },
    dispatchEvent(e) { log.push(e.type + ':' + name + '@' + Math.round(e.clientX) + ',' + Math.round(e.clientY)); return true; },
    ...extra
  });
  const article = mk('article', { top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600 });
  const stage = mk('stage', { top: 100, bottom: 300, left: 100, right: 500, width: 400, height: 200 });
  const wand = mk('wand', { top: 400, bottom: 440, left: 50, right: 250, width: 200, height: 40 });
  const playBtn = mk('play', { top: 10, bottom: 40, left: 10, right: 80, width: 70, height: 30 });
  if (held) wand.attrs['aria-pressed'] = 'true';
  wand.host = article;
  article.find = sel => (/figure-stage/.test(sel) ? stage : null);
  const document = {
    querySelectorAll(sel) {
      if (/btn-wand/.test(sel)) return withWand ? [wand] : [];
      if (/btn-play/.test(sel)) return play ? [playBtn] : [];
      return [];
    },
    querySelector() { return null; }
  };
  const posted = [];
  const parent = { postMessage(d) { posted.push(d); } };
  const timers = [];
  const win = {
    document, parent, innerHeight: 600,
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    dispatchEvent(ev) { log.push('event:' + ev.type); return !prevent; },
    setTimeout(fn) { timers.push(fn); return timers.length; },
    CustomEvent: function (type, o) { this.type = type; this.detail = o && o.detail; },
    MouseEvent: function (type, o) { this.type = type; Object.assign(this, o); },
    PointerEvent: function (type, o) { this.type = type; Object.assign(this, o); }
  };
  if (polymathWand) win.polymathWand = d => log.push('fn:' + d.cast);
  win.window = win;
  vm.createContext(win);
  vm.runInContext(P.WAND_BRIDGE, win);
  const cast = () => {
    listeners.message.forEach(fn => fn({ source: parent, data: { polymath: 'wand', action: 'cast' } }));
    while (timers.length) timers.shift()();
  };
  const forge = () => listeners.message.forEach(fn => fn({ source: {}, data: { polymath: 'wand', action: 'cast' } }));
  return { log, posted, cast, forge };
}

test('the bridge picks up the app’s own wand and taps its picture in the middle', () => {
  const w = fakeWorld();
  w.cast();
  assert.ok(w.log.includes('click:wand'), w.log.join(' '));
  assert.ok(w.log.includes('click:stage@300,200'), w.log.join(' '));
  assert.ok(w.log.indexOf('click:wand') < w.log.indexOf('click:stage@300,200'));
  assert.deepEqual(w.posted.map(p => p.how), ['wand']);
  w.cast();
  assert.equal(w.log.filter(x => x === 'click:wand').length, 1, 'a wand already in hand is not put down again');
  assert.equal(w.log.filter(x => x.startsWith('click:stage')).length, 2, 'a second wave steps the picture on');
});

test('an app that handles the spell itself is left to it', () => {
  const ev = fakeWorld({ prevent: true });
  ev.cast();
  assert.deepEqual(ev.posted.map(p => p.how), ['event']);
  assert.ok(!ev.log.includes('click:wand'));
  const fn = fakeWorld({ polymathWand: true });
  fn.cast();
  assert.ok(fn.log.includes('fn:1'));
  assert.deepEqual(fn.posted.map(p => p.how), ['function']);
});

test('no wand: a play button is pressed, else the stage is told there is none', () => {
  const p = fakeWorld({ withWand: false, play: true });
  p.cast();
  assert.ok(p.log.includes('click:play'));
  assert.deepEqual(p.posted.map(x => x.how), ['play']);
  const n = fakeWorld({ withWand: false });
  n.cast();
  assert.deepEqual(n.posted.map(x => x.how), ['none']);
});

test('only the page that owns the frame can cast', () => {
  const w = fakeWorld();
  w.forge();
  assert.equal(w.posted.length, 0);
  assert.ok(!w.log.includes('click:wand'));
});

/* ---- the glue in index.html ---- */
test('a living app is a pasted picture carrying `lapp`, never a new annotation kind', () => {
  assert.match(html, /function annLivingApp\(a\) \{\s*return annPastePic\(a\) && !!a\.lapp/);
  assert.match(html, /kind: 'paste',[\s\S]{0,400}lapp: app/);
  assert.ok(!/kind:\s*'lapp'|kind:\s*'living/.test(html), 'no new annotation kind');
  assert.match(html, /if \(annLivingApp\(a\)\) box\.setAttribute\('data-lapp', '1'\);/);
});

test('adding and changing an app is the teacher’s, asked again in every handler', () => {
  assert.match(html, /var TEACHER_TOOLBAR_IDS = \[[^\]]*'livingAppBtn'/);
  assert.match(html, /\$\('livingAppBtn'\);\s*if \(btn\) btn\.addEventListener\('click', function \(\) \{\s*if \(!wheelTeacher\(\)\) return;/);
  assert.match(html, /function lappAddToPage\(cover, app\) \{\s*if \(!wheelTeacher\(\)\)/);
  assert.match(html, /function lappUpdateOnPage\(id, cover, app\) \{\s*if \(!wheelTeacher\(\)\)/);
  assert.match(html, /function lappEdit\(id\) \{\s*if \(!lapp \|\| !wheelTeacher\(\)\) return false;/);
  assert.match(src, /function openAdder\(opts\) \{[\s\S]{0,80}if \(!teacher\(\)\)/);
  assert.match(src, /function commitAdder\(\) \{[\s\S]{0,200}if \(!teacher\(\)\)/);
});

test('a tap brings it alive for a student, but a pen in a writer’s hand still writes', () => {
  const at = html.indexOf("var laHost = e.target.closest ? e.target.closest('[data-lapp]')");
  const ro = html.indexOf('if (isStudent() && !reviseMode && !practiceMode) return;');
  assert.ok(at > 0 && ro > at, 'the tap is handled before a read-only student is turned away');
  const seg = html.slice(at, ro);
  assert.match(seg, /laCanDraw && isDrawTool\(tool\)/);
  assert.match(seg, /lappOpen\(laAnn\.id\)/);
});

test('its bar offers 🪄 Bring alive and ✎ Change app beside Lock and Remove', () => {
  const at = html.indexOf('function renderPictureBar(p, a, box) {');
  const seg = html.slice(at, at + 2500);
  assert.match(seg, /if \(annLivingApp\(a\)\) \{[\s\S]{0,200}'🪄 Bring alive'[\s\S]{0,200}lappOpen\(a\.id\)/);
  assert.match(seg, /'✎ Change app'[\s\S]{0,200}lappEdit\(a\.id\)/);
});

test('practice keeps living apps as locked copies, and the questions print keeps them', () => {
  assert.match(html, /annotations = bankQPracticeCopies\(teacherAnswers\)\.concat\(lappPracticeCopies\(teacherAnswers\)\);/);
  assert.match(html, /function lappPracticeCopies\(list\) \{[\s\S]{0,300}c\.locked = true;/);
  assert.match(html, /answerAnnotations\(\)\.filter\(function \(a\) \{ return annBankQ\(a\) \|\| annLivingApp\(a\); \}\)/);
});

test('a stage does not outlive its worksheet or its person', () => {
  assert.match(html, /bankQWorksheetChanged\(\);[^\n]*\n\s*lappWorksheetChanged\(\);/);
  assert.match(html, /bankQRoleChanged\(\);\s*lappRoleChanged\(\);/);
  assert.match(src, /roleChanged: function \(\) \{ closeStage\(\); closeAdder\(\); \}/);
  assert.match(src, /worksheetChanged: function \(\) \{ closeStage\(\); closeAdder\(\); \}/);
  assert.match(src, /root\.removeEventListener\('message', s\.onMessage\)/);
});

test('the stage only listens to its own frame', () => {
  assert.match(src, /e\.source !== s\.frame\.contentWindow\) return;/);
});

test('the scripts load in order and the syntax check covers them', () => {
  const qb = html.indexOf('<script src="question-bank.js"></script>');
  const la = html.indexOf('<script src="living-apps.js"></script>');
  const init = html.indexOf('<script>lappInit();</script>');
  assert.ok(qb > 0 && la > qb && init > la);
  assert.match(html, /<link rel="stylesheet" href="living-apps\.css">/);
  assert.match(fs.readFileSync(new URL('./check-syntax.mjs', import.meta.url), 'utf8'), /'living-apps\.js'/);
});

test('reduced motion is honoured on the stage', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(src, /prefers-reduced-motion: reduce/);
});

/* ---------------------------------------------------------------
   📲 Hosted for a QR code (v1.163.0)
   --------------------------------------------------------------- */
const viewer = fs.readFileSync(new URL('../living.html', import.meta.url), 'utf8');
const TOKEN = '0b4c1f9e-3c1d-4f0a-9a5b-1234567890ab';

test('an app is hosted under its own content hash, and only the app is stored', () => {
  const app = P.normalizeApp({ html: '<div>tank</div>', title: 'Tank' }).app;
  assert.equal(P.publishPath(app.hash), 'pdf-annotator/living-' + app.hash + '.json');
  assert.equal(P.publishPath('../../etc'), '');
  const body = JSON.parse(P.publishPayload(Object.assign({ pub: { token: TOKEN }, secret: 'x' }, app)));
  assert.deepEqual(Object.keys(body).sort(), ['hash', 'html', 'title', 'v']);
  assert.equal(body.hash, P.contentHash('<div>tank</div>'));
  assert.equal(P.publishPayload({ html: '' }), '');
});

test('the QR link is short, built from the hash and token alone, and parses back', () => {
  const h = P.contentHash('<div>tank</div>');
  const link = P.viewerUrl('https://polymathlc.com.sg/anskey/?share=abc#x', h, TOKEN);
  assert.equal(link, 'https://polymathlc.com.sg/anskey/living.html?a=' + h + '&t=' + TOKEN);
  assert.ok(link.length < 120, link);
  assert.deepEqual(P.parseViewerQuery(link.slice(link.indexOf('?'))), { hash: h, token: TOKEN });
  assert.equal(P.viewerUrl('https://x/anskey/', 'nope', TOKEN), '');
  assert.equal(P.parseViewerQuery('?a=' + h + '&t=<script>'), null);
  assert.equal(P.parseViewerQuery('?a=evil&t=' + TOKEN), null);
  const media = P.mediaUrl(h, TOKEN);
  assert.ok(media.startsWith('https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/pdf-annotator%2Fliving-'), media);
  assert.equal(P.tokenFromDownloadUrl(media), TOKEN);
  assert.equal(P.tokenFromDownloadUrl('https://x/?alt=media'), '');
});

test('a downloaded app must be the one the code was printed for', () => {
  const app = P.normalizeApp({ html: '<div>tank</div>', title: 'Tank' }).app;
  const text = P.publishPayload(app);
  const good = P.readPublished(text, app.hash);
  assert.ok(good.ok && good.app.html === '<div>tank</div>' && good.app.title === 'Tank');
  assert.equal(P.readPublished(text, P.contentHash('<div>other</div>')).ok, false);
  assert.equal(P.readPublished('not json', app.hash).ok, false);
  assert.equal(P.readPublished('{"html":""}', app.hash).ok, false);
});

test('a hosted copy is reused only while it is still this app', () => {
  const app = P.normalizeApp({ html: '<div>tank</div>' }).app;
  assert.equal(P.publishedFor(app), null);
  app.pub = { hash: app.hash, token: TOKEN };
  assert.deepEqual(P.publishedFor(app), { hash: app.hash, token: TOKEN });
  app.html += '<p>changed</p>';
  assert.equal(P.publishedFor(app), null);
});

test('the code sits inside the cover, never off it, and shrinks with a small cover', () => {
  [[50, 300, 433, 188], [20, 20, 160, 70], [0, 0, 600, 260]].forEach(([x, y, w, h]) => {
    const q = P.qrOnCover(x, y, w, h);
    assert.ok(q.padX >= x && q.padY >= y && q.padX + q.padW <= x + w + 0.01 && q.padY + q.padH <= y + h + 0.01, JSON.stringify([x, y, w, h, q]));
    assert.ok(q.size >= 24 && q.size <= 86);
  });
  assert.ok(P.qrOnCover(0, 0, 160, 70).size < P.qrOnCover(0, 0, 433, 188).size);
});

test('the export hosts the apps and draws their codes on both PDF paths', () => {
  assert.match(html, /buildAnnotatedPdf\(false, \{ qr: printQrUrl\(\), lappQr: await lappQrLinks\(annotations\) \}\)/);
  assert.match(html, /lappQr: await lappQrLinks\(printAnns\)/);
  assert.match(html, /window\.LivingApps\.drawQrOnPdf\(outDoc, outDoc\.getPage\(a\.page - 1\), link, PDFLib, font, rect,\s*window\.QuestionBank\.pure\.qrMatrix, window\.QuestionBank\.pure\.qrRuns\)/);
  // Only the teacher uploads; a student reuses the stored token.
  assert.match(html, /async function lappPublish\(a\) \{[\s\S]{0,200}if \(have\) return have;\s*if \(!wheelTeacher\(\)/);
  // An export never fails because an app could not be hosted.
  assert.match(html, /try \{ pub = await lappPublish\(a\); \} catch \(e\) \{/);
});

test('the viewer runs the app in the same sandbox and stage, as a student, with no sign-in', () => {
  assert.match(viewer, /<script src="living-apps\.js"><\/script>/);
  assert.match(viewer, /<link rel="stylesheet" href="living-apps\.css">/);
  assert.match(viewer, /role: function \(\) \{ return 'student'; \}/);
  assert.match(viewer, /P\.readPublished\(text, want\.hash\)/);
  assert.doesNotMatch(viewer, /<script[^>]*src="[^"]*(firebase|gstatic)/i);
  assert.doesNotMatch(viewer, /innerHTML/);
});

test('📲 the stage’s own QR code is one SVG path with a quiet zone, and nothing for no matrix', () => {
  const m = [[true, true, false], [false, true, false], [true, false, true]];
  const svg = P.qrSvg(m);
  assert.match(svg, /viewBox="0 0 11 11"/);              // 3 modules + 4 quiet each side
  assert.match(svg, /<rect width="11" height="11" fill="#fff"\/>/);
  // Runs merged: row 0 is one run of two, starting after the quiet zone.
  assert.match(svg, /M4 4h2v1h-2z/);
  assert.equal((svg.match(/z/g) || []).length, 4);
  assert.doesNotMatch(svg, /<script|on\w+=/i);
  assert.equal(P.qrSvg(null), '');
  assert.equal(P.qrSvg([]), '');
});

test('📲 the living app window shows a code that opens that app alone, never Ans Key', () => {
  // The stage asks the glue for the link and draws the code in its own corner.
  assert.match(src, /data-la="qrcard"/);
  assert.match(src, /env\.qrLink\(s\.id\)/);
  assert.match(src, /if \(stage !== s\) return;\s*var svg = url \? qrSvg\(env\.qrMatrix\(url\)\) : ''/);
  // The glue hands it living.html's link for THIS app — the same hosting as the export.
  assert.match(html, /qrLink: lappQrLink,/);
  assert.match(html, /async function lappQrLink\(id\) \{[\s\S]{0,260}await lappPublish\(a\)[\s\S]{0,200}viewerUrl\(location\.href, pub\.hash, pub\.token\)/);
  assert.doesNotMatch(html.slice(html.indexOf('async function lappQrLink'), html.indexOf('async function lappQrLinks')), /shareUrl|printQrUrl/);
  // The page the code opens offers no code of its own.
  assert.doesNotMatch(viewer, /qrLink/);
  assert.match(css, /\.laQr \{[\s\S]{0,120}position: absolute;/);
});
