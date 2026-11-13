/* =====================================================================
   🎬 VIDEOS ON PAPER — the arithmetic and the wiring, without a browser
   ---------------------------------------------------------------------
   Runs video-playlist.js's pure half in Node and pins the glue in
   index.html: the playlist is in the SAME order as the app's own, a link
   is read the SAME way as the app reads it, only what `cleanItem` lets
   through ever reaches the player, the hosted file is content-addressed
   and checked on the way back, the box on page 1 lands in the cleanest
   spot, and the PDF leaves the pills off ONLY when the link goes on.
   tools/video-playlist-check.mjs does the rest in a real Chromium.

     node --test tools/video-playlist-tests.mjs
   ===================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const VP = require('../video-playlist.js');
const P = VP.pure;
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../videos.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../video-playlist.css', import.meta.url), 'utf8');
const src = fs.readFileSync(new URL('../video-playlist.js', import.meta.url), 'utf8');

const LESSON_URL = 'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/' +
  encodeURIComponent('pdf-annotator/lesson-doc1-l1.mp4') + '?alt=media&token=5d0c2c1e-7a4b-4f7e-9b1a-0c0000000001';
const CAPTIONS_URL = 'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/' +
  encodeURIComponent('pdf-annotator/lesson-doc1-l1.captions.json') + '?alt=media&token=5d0c2c1e-7a4b-4f7e-9b1a-0c0000000002';
const TOKEN = '5d0c2c1e-7a4b-4f7e-9b1a-0c1234567890';

/* Cuts one function out of index.html by its name, to the next top-level
   `function ` / `var ` / `/*` at column 0. */
function cutFunction(name) {
  const start = html.indexOf('\nfunction ' + name + '(');
  assert.ok(start >= 0, 'index.html has ' + name);
  const rest = html.slice(start + 1);
  const end = rest.slice(1).search(/\n(?:function |var |\/\*|async function )/);
  return rest.slice(0, end < 0 ? rest.length : end + 1);
}

function appSandbox() {
  const sb = { PLAYLIST_ROW: 24, Number, Math, String, Array, Object, JSON, isFinite };
  vm.createContext(sb);
  vm.runInContext(cutFunction('videoEmbedInfo'), sb);
  vm.runInContext(cutFunction('videoPillLabel'), sb);
  vm.runInContext(cutFunction('lessonPlaylistItems'), sb);
  return sb;
}

const sampleAnns = () => [
  { id: 'v3', type: 'video', page: 2, x: 300, y: 100, url: 'https://youtu.be/abcDEF12345', label: 'Q7 video' },
  { id: 'l1', type: 'video', page: 1, x: 40, y: 400, url: LESSON_URL, label: 'Q5 · video lesson · 3:12',
    lessonRecording: { version: 1, video: true, duration: 192000, title: 'Q5', captionsUrl: CAPTIONS_URL, captionsLang: 'en' } },
  { id: 'v1', type: 'video', page: 1, x: 300, y: 112, url: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQ/view?usp=sharing' },
  { id: 'v2', type: 'video', page: 1, x: 40, y: 100, url: 'https://example.com/clips/q1.mp4', label: 'Q1' },
  { id: 'v4', type: 'video', page: 1, x: 500, y: 700, url: 'https://www.dropbox.com/s/abc/q9.mov?dl=0', label: 'Q9' },
  { id: 'v5', type: 'video', page: 3, x: 10, y: 10, url: 'https://vimeo.com/123456', label: 'Q12 on Vimeo' },
  { id: 'gone', type: 'video', page: 3, x: 10, y: 50, url: '', label: 'never uploaded' },
  { id: 'p1', type: 'pen', page: 1, points: [{ x: 1, y: 1 }, { x: 5, y: 5 }] }
];

test('a link is read exactly as the app reads it (videoEmbedInfo)', () => {
  const sb = appSandbox();
  const urls = [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ?t=30', 'https://youtube.com/shorts/abcDEF123',
    'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQ/view', 'https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQ',
    'https://www.dropbox.com/s/abc/q9.mov?dl=0', 'https://example.com/a.mp4', 'https://example.com/a.webm?x=1',
    LESSON_URL, 'https://vimeo.com/1234', 'https://example.com/page'
  ];
  const map = { iframe: ['youtube', 'drive'], video: ['file'], link: ['link'] };
  for (const u of urls) {
    const app = sb.videoEmbedInfo(u);
    const ours = P.classify(u);
    assert.ok(map[app.kind].includes(ours.kind), u + ': app ' + app.kind + ' / here ' + ours.kind);
    if (app.kind === 'video') assert.equal(ours.url, app.src, u);
    if (ours.kind === 'youtube') assert.ok(app.src.includes(ours.id), u);
    if (ours.kind === 'drive') assert.ok(app.src.includes(ours.id), u);
  }
});

test('the playlist is in the SAME order as the app’s own playlist', () => {
  const sb = appSandbox();
  const anns = sampleAnns();
  const app = Array.from(sb.lessonPlaylistItems(anns), r => r.id);
  const pl = P.buildPlaylist(anns, { name: 'Heat', ws: 'doc1', label: sb.videoPillLabel });
  // The app leaves bare links out of ITS playlist (they cannot follow one
  // another); the paper keeps them, so every video is reachable from it.
  const ours = pl.items.filter(i => i.kind !== 'link');
  assert.deepEqual(ours.map(i => i.label), app.map(id => sb.videoPillLabel(anns.find(a => a.id === id))));
  assert.deepEqual(pl.items.map(i => i.page), [1, 1, 1, 1, 2, 3]);
  assert.equal(pl.items.length, 6, 'a pill with no upload is not a video');
  assert.equal(pl.items[5].kind, 'link');
});

test('an item says what it is, and only a lesson carries a writing link', () => {
  const pl = P.buildPlaylist(sampleAnns(), { name: 'Heat', ws: 'doc1' });
  const lesson = pl.items.find(i => i.kind === 'lesson');
  assert.equal(lesson.camera, true);
  assert.equal(lesson.ms, 192000);
  assert.equal(lesson.captions, CAPTIONS_URL);
  assert.equal(lesson.rec, 'l1');
  assert.equal(P.writingLink(pl, lesson), './?ws=doc1&do=play&rec=l1');
  assert.equal(P.writingLink(pl, pl.items.find(i => i.kind === 'youtube')), '');
  assert.equal(P.itemDetail(lesson), 'Page 1 · video lesson · 3:12');
  const yt = pl.items.find(i => i.kind === 'youtube');
  assert.equal(P.playerFor(yt).tag, 'iframe');
  assert.match(P.playerFor(yt).src, /^https:\/\/www\.youtube-nocookie\.com\/embed\/abcDEF12345\?/);
  assert.equal(P.playerFor(lesson).tag, 'video');
  assert.equal(P.playerFor({ ...lesson, camera: false }).tag, 'audio');
  assert.equal(P.playerFor(pl.items.find(i => i.kind === 'drive')).src, 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQ/preview');
  assert.equal(P.playerFor(pl.items.find(i => i.kind === 'link')).tag, 'link');
  const dropbox = pl.items.find(i => i.label === 'Q9');
  assert.equal(dropbox.url, 'https://dl.dropboxusercontent.com/s/abc/q9.mov');
});

test('cleanItem is the one door: schemes, buckets, ids and words', () => {
  assert.equal(P.cleanItem({ kind: 'file', page: 1, url: 'javascript:alert(1)' }), null);
  assert.equal(P.cleanItem({ kind: 'file', page: 1, url: 'data:video/mp4;base64,AAAA' }), null);
  assert.equal(P.cleanItem({ kind: 'file', page: 1, url: 'http://example.com/a.mp4' }), null, 'a played file must be https');
  assert.ok(P.cleanItem({ kind: 'link', page: 1, url: 'http://example.com/a' }), 'a link that only opens may be http');
  assert.equal(P.cleanItem({ kind: 'link', page: 1, url: 'https://user:pw@example.com/a' }), null);
  assert.equal(P.cleanItem({ kind: 'lesson', page: 1, url: 'https://example.com/lesson.mp4' }), null, 'a lesson only from our bucket');
  const other = LESSON_URL.replace('mathgen--app.firebasestorage.app', 'evil.appspot.com');
  assert.equal(P.cleanItem({ kind: 'lesson', page: 1, url: other }), null);
  const notLesson = LESSON_URL.replace(encodeURIComponent('pdf-annotator/lesson-'), encodeURIComponent('pdf-annotator/x-'));
  assert.equal(P.cleanItem({ kind: 'lesson', page: 1, url: notLesson }), null);
  assert.equal(P.cleanItem({ kind: 'youtube', page: 1, id: 'abc"><script>' }), null);
  assert.equal(P.cleanItem({ kind: 'drive', page: 1, id: '../../x' }), null);
  assert.equal(P.cleanItem({ kind: 'nope', page: 1, url: 'https://a.b/c' }), null);
  assert.equal(P.cleanItem({ kind: 'file', page: 0, url: 'https://a.b/c.mp4' }), null);
  const bad = P.cleanItem({ kind: 'lesson', page: 1, url: LESSON_URL, captions: 'https://example.com/c.json', rec: 'a b' });
  assert.ok(bad && !bad.captions && !bad.rec, 'captions only from our bucket, a rec id only of word characters');
  const long = P.cleanItem({ kind: 'file', page: 2, url: 'https://a.b/c.mp4', label: 'word '.repeat(80) + '\u0000' });
  assert.ok(long.label.length <= 120 && long.label.endsWith('…'));
  // Idempotent: the hash is taken over what the player will show.
  const pl = P.buildPlaylist(sampleAnns(), { name: 'Heat', ws: 'doc1' });
  pl.items.forEach(it => assert.deepEqual(P.cleanItem(P.cleanItem(it)), it));
});

test('the hash is over the cleaned playlist, and changes when the videos do', () => {
  const a = P.buildPlaylist(sampleAnns(), { name: 'Heat', ws: 'doc1' });
  const b = P.buildPlaylist(sampleAnns(), { name: 'Heat', ws: 'doc1' });
  assert.equal(a.hash, b.hash);
  assert.ok(P.validHash(a.hash), a.hash);
  const moved = sampleAnns(); moved[0].label = 'Q7 video (new)';
  assert.notEqual(P.buildPlaylist(moved, { name: 'Heat', ws: 'doc1' }).hash, a.hash);
  assert.notEqual(P.buildPlaylist(sampleAnns(), { name: 'Heat 2', ws: 'doc1' }).hash, a.hash);
  // Things that are not videos never change it.
  const plus = sampleAnns().concat([{ id: 'p9', type: 'pen', page: 1, points: [{ x: 9, y: 9 }] }]);
  assert.equal(P.buildPlaylist(plus, { name: 'Heat', ws: 'doc1' }).hash, a.hash);
  assert.equal(P.buildPlaylist([{ id: 'p', type: 'pen', page: 1 }], { name: 'x' }), null, 'no videos, no playlist');
});

test('what is stored is the videos and nothing else, and it is checked on the way back', () => {
  const pl = P.buildPlaylist(sampleAnns(), { name: 'Heat', ws: 'doc1' });
  assert.equal(P.publishPath(pl.hash), 'pdf-annotator/videos-' + pl.hash + '.json');
  assert.equal(P.publishPath('../x'), '');
  const body = P.publishPayload(pl);
  assert.deepEqual(Object.keys(JSON.parse(body)).sort(), ['hash', 'items', 'name', 'v', 'ws']);
  const back = P.readPublished(body, pl.hash);
  assert.ok(back.ok, back.message);
  assert.deepEqual(back.playlist.items, pl.items);
  const tampered = JSON.parse(body); tampered.items[0].label = 'Something else';
  assert.equal(P.readPublished(JSON.stringify(tampered), pl.hash).ok, false, 'a changed file is not the one the code was printed for');
  assert.equal(P.readPublished('not json', pl.hash).ok, false);
  assert.equal(P.readPublished('{"items":[]}', pl.hash).ok, false);
  // A planted item the door refuses is dropped, and then the hash no longer matches.
  const planted = JSON.parse(body); planted.items.push({ kind: 'file', page: 9, url: 'javascript:1' });
  const pr = P.readPublished(JSON.stringify(planted), pl.hash);
  assert.ok(pr.ok, 'a refused item is simply dropped');
  assert.ok(pr.playlist.items.every(i => !/javascript/.test(JSON.stringify(i))));
  assert.equal(P.publishPayload({ ...pl, hash: 'vp1-1-1' }), '', 'a payload whose hash is not its own is refused');
});

test('the link is videos.html with the hash and token packed into 31 characters', () => {
  const pl = P.buildPlaylist(sampleAnns(), { name: 'Heat', ws: 'doc1' });
  const url = P.viewerUrl('https://polymathlc.com.sg/anskey/?ws=doc1#x', pl.hash, TOKEN);
  assert.match(url, /^https:\/\/polymathlc\.com\.sg\/anskey\/videos\.html\?[A-Za-z0-9_-]{31}$/);
  assert.ok(url.length < 100, url.length + ' characters');
  const back = P.parseViewerQuery(url.slice(url.indexOf('?')));
  assert.deepEqual(back, { hash: pl.hash, token: TOKEN });
  const longForm = P.viewerUrl('https://x.org/a/index.html', pl.hash, 'abcdefghijklmnopqrstuvwxyz');
  assert.match(longForm, /videos\.html\?p=vp1-/);
  assert.deepEqual(P.parseViewerQuery(longForm.slice(longForm.indexOf('?'))), { hash: pl.hash, token: 'abcdefghijklmnopqrstuvwxyz' });
  assert.equal(P.parseViewerQuery('?p=../../x&t=' + TOKEN), null);
  assert.equal(P.parseViewerQuery('?nothing'), null);
  assert.equal(P.viewerUrl('file:///home/x/index.html', pl.hash, TOKEN), '', 'only a web address gets a code');
  const media = P.mediaUrl(pl.hash, TOKEN);
  assert.equal(media, 'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/' +
    encodeURIComponent('pdf-annotator/videos-' + pl.hash + '.json') + '?alt=media&token=' + TOKEN);
  assert.equal(P.tokenFromDownloadUrl(media), TOKEN);
  assert.deepEqual(P.publishedFor(pl, { hash: pl.hash, token: TOKEN }), { hash: pl.hash, token: TOKEN });
  assert.equal(P.publishedFor(pl, { hash: 'vp1-1-1', token: TOKEN }), null, 'a remembered copy of another list is not this one');
});

test('the box goes in the cleanest spot of page 1', () => {
  const pg = { x: 0, y: 0, width: 595, height: 842 };
  const blank = P.choosePlacement(pg, [], () => 0);
  assert.equal(blank.name, 'top-right');
  assert.equal(blank.variant, 'wide');
  const size = P.boxSize('wide');
  assert.equal(blank.x, 595 - 16 - size.w);
  assert.equal(blank.y, 842 - 16 - size.h);
  // The share code sits top right: the box goes elsewhere.
  const shareQr = { x: 595 - 18 - 72 - 3, y: 842 - 18 - 72 - 12, w: 78, h: 87 };
  assert.notEqual(P.choosePlacement(pg, [shareQr], () => 0).name, 'top-right');
  // Printed ink everywhere but the bottom-left corner.
  const ink = r => (r.x < 100 && r.y < 100 ? 0 : 0.3);
  const bl = P.choosePlacement(pg, [], ink);
  assert.equal(bl.name, 'bottom-left');
  // Only a narrow clean strip: the compact box fits where the wide one cannot.
  const strip = r => (r.x > 595 - 100 && r.y < 120 && r.x + r.w <= 595 ? 0 : 0.25);
  const c = P.choosePlacement(pg, [], strip);
  assert.equal(c.variant, 'compact');
  assert.equal(c.name, 'bottom-right');
  // A meter that throws counts as nothing measured, never as a failure.
  assert.equal(P.choosePlacement(pg, [], () => { throw new Error('x'); }).name, 'top-right');
  // A mediabox that does not start at 0 is honoured.
  const off = P.choosePlacement({ x: 20, y: 30, width: 595, height: 842 }, [], null);
  assert.equal(off.x, 20 + 595 - 16 - size.w);
  // A page too small for any box gets none.
  assert.equal(P.choosePlacement({ x: 0, y: 0, width: 60, height: 60 }, [], null), null);
  // Writing counts more than printed ink.
  assert.ok(P.spotScore({ x: 0, y: 0, w: 10, h: 10 }, [{ x: 0, y: 0, w: 10, h: 10 }], () => 0) >
    P.spotScore({ x: 0, y: 0, w: 10, h: 10 }, [], () => 1));
});

test('drawOnPdf draws the code, the words and one link over the whole box', () => {
  const calls = { rects: 0, texts: [], paths: 0, ellipses: 0, annots: [] };
  const fakePage = {
    drawSvgPath: () => { calls.paths++; }, drawRectangle: () => { calls.rects++; },
    drawText: (t) => { calls.texts.push(t); }, drawEllipse: () => { calls.ellipses++; },
    node: { lookup: () => null, set: (k, v) => { calls.annots.push(v); } }
  };
  const fakeDoc = { context: { register: (o) => o, obj: (o) => o } };
  const lib = { rgb: (r, g, b) => ({ r, g, b }), PDFString: { of: s => 'S:' + s }, PDFName: { of: s => s } };
  const font = { widthOfTextAtSize: (s, z) => s.length * z * 0.5 };
  const matrix = Array.from({ length: 25 }, (_, r) => Array.from({ length: 25 }, (_, c) => (r + c) % 3 === 0));
  const spot = P.choosePlacement({ x: 0, y: 0, width: 595, height: 842 }, [], () => 0);
  const url = 'https://polymathlc.com.sg/anskey/videos.html?ABCDEFGHIJKLMNOPQRSTUVWXYZabcde';
  const ok = VP.drawOnPdf(fakeDoc, fakePage, { url, count: 4, spot, lib, font, fontBold: font, qrMatrix: () => matrix });
  assert.equal(ok, true);
  assert.ok(calls.rects > 20, 'the code is drawn as squares');
  assert.ok(calls.texts.includes('Watch all 4 videos'), calls.texts.join(' | '));
  assert.ok(calls.texts.some(t => /polymathlc\.com\.sg/.test(t)), 'the link is written out too');
  assert.ok(calls.texts.every(t => /^[\x20-\x7e]*$/.test(t)), 'only characters the standard PDF font can draw');
  const link = calls.annots[0][0];
  assert.equal(link.Subtype, 'Link');
  assert.equal(link.A.URI, 'S:' + url);
  assert.deepEqual(link.Rect, [spot.x, spot.y, spot.x + spot.w, spot.y + spot.h]);
  // One video says so.
  calls.texts = [];
  VP.drawOnPdf(fakeDoc, fakePage, { url, count: 1, spot, lib, font, fontBold: font, qrMatrix: () => matrix });
  assert.ok(calls.texts.includes('Watch the video'));
  // Compact.
  calls.texts = [];
  VP.drawOnPdf(fakeDoc, fakePage, { url, count: 3, spot: { ...spot, variant: 'compact' }, lib, font, fontBold: font, qrMatrix: () => matrix });
  assert.ok(calls.texts.includes('All 3 videos'));
  assert.equal(VP.drawOnPdf(fakeDoc, fakePage, { url: '', spot, lib, qrMatrix: () => matrix }), false);
});

test('captions become WebVTT, bad cues dropped', () => {
  const vtt = P.captionsVtt({ cues: [{ s: 0, e: 1500, t: 'Hello class' }, { s: 2000, e: 1000, t: 'bad' }, { s: 3661000, e: 3662500, t: 'a --> b' }] });
  assert.equal(vtt, 'WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nHello class\n\n01:01:01.000 --> 01:01:02.500\na → b\n');
  assert.equal(P.captionsVtt({ cues: [] }), '');
  assert.equal(P.captionsVtt(null), '');
});

test('the player starts where it is asked, and moves on in order', () => {
  assert.equal(P.startIndex('#3', 5), 2);
  assert.equal(P.startIndex('#99', 5), 4);
  assert.equal(P.startIndex('', 5), 0);
  assert.equal(P.startIndex('#x', 5), 0);
  assert.equal(P.nextIndex([1, 2, 3], 1), 2);
  assert.equal(P.nextIndex([1, 2, 3], 2), -1);
  assert.equal(P.fmtTime(3725000), '1:02:05');
  assert.equal(P.headline(1), 'Watch the video');
  assert.equal(P.countWords(3), 'all 3 videos');
  assert.deepEqual(P.stripVideos(sampleAnns()).map(a => a.id), ['p1']);
});

/* ---- The glue, read off index.html ---- */
function section(startMarker, endMarker) {
  const a = html.indexOf(startMarker), b = html.indexOf(endMarker, a);
  assert.ok(a >= 0 && b > a, startMarker);
  return html.slice(a, b);
}

test('the PDF leaves the pills off only when the link goes on', () => {
  const build = section('async function buildAnnotatedPdf(', 'async function downloadAnnotated(');
  assert.match(build, /a\.type === 'video'\) \{[\s\S]{0,200}if \(opts\.videos\) return;/);
  assert.match(build, /opts\.videos && opts\.videos\.url[\s\S]*VideoPlaylist\.drawOnPdf\(outDoc, vplPage/);
  assert.match(build, /vplPlacement\(vplPage, anns, !!opts\.qr, vplInk\)/, 'the share code is an obstacle');
  assert.ok(build.indexOf('await vplInkMeter()') < build.indexOf('anns.forEach'), 'measured before the synchronous pass');
  const dl = section('async function downloadAnnotated(', 'function isIOS(');
  assert.match(dl, /await vplLinkFor\(annotations\)/);
  assert.match(dl, /videos: videos/);
  const pr = section('async function runPrint(', 'function printPdfBytes(');
  assert.match(pr, /await vplLinkFor\(printAnns\)/);
  assert.match(pr, /videos: videos/);
});

test('only the teacher uploads, every save files it, and a worksheet change forgets it', () => {
  const glue = section('🎬 Videos on paper — glue', 'End videos on paper glue');
  assert.match(glue, /async function vplPublish[\s\S]*?if \(!wheelTeacher\(\)/);
  assert.match(glue, /async function vplRemember[\s\S]*?!wheelTeacher\(\) \|\| practiceMode/);
  assert.match(glue, /async function vplAfterSave\(\) \{\s*if \(!wheelTeacher\(\) \|\| practiceMode/);
  assert.match(glue, /\{ merge: true \}/, 'the worksheet document is merged into, never replaced');
  assert.ok(!/innerHTML/.test(glue));
  const saves = html.match(/if \(typeof vplAfterSave === 'function'\) vplAfterSave\(\);/g) || [];
  assert.equal(saves.length, 2, 'both the manual save and the auto-save file the list');
  assert.equal((html.match(/vplReadDoc\((d|data)\);/g) || []).length, 2, 'both ways a worksheet arrives read its hosted list');
  assert.match(html, /vplDocPub = null;\s+\/\/ 🎬 a new worksheet/);
  assert.match(html, /<script src="living-apps\.js"><\/script>\n<script src="video-playlist\.js\?v=1\.196\.0"><\/script>/);
});

test('the player page writes nothing from the file as markup', () => {
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(page), 'videos.html uses textContent only');
  assert.ok(!/innerHTML/.test(src));
  assert.match(page, /P\.readPublished\(text, want\.hash\)/, 'the file is checked against the code');
  assert.match(page, /P\.mediaUrl\(want\.hash, want\.token\)/, 'the address is rebuilt, never read from the link');
  assert.match(page, /<script src="video-playlist\.js\?v=1\.196\.0"><\/script>/);
  assert.ok(!/firebase/i.test(page.replace(/Firebase Storage|Firebase\s+SDK/g, '')), 'no Firebase SDK on the page');
  // Dark mode follows the design rules: tokens on :root, redefined twice.
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\)/);
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /body \{[\s\S]*?background: var\(--vp-bg\)/);
});

test('the version moved and the file is syntax-checked', () => {
  assert.match(html, /var APP_VERSION = 'v1\.(19[6-9]|[2-9]\d\d)\.\d+'/);
  const syntax = fs.readFileSync(new URL('./check-syntax.mjs', import.meta.url), 'utf8');
  assert.match(syntax, /'video-playlist\.js'/);
});

/* ---------------------------------------------------------------------
   📅 v1.196.0 — the same page is Polymath Online's video recordings,
   grouped by the day each lesson was taught, with the answer key.
   --------------------------------------------------------------------- */
const DAY = (y, m, d, h) => new Date(y, m - 1, d, h || 17, 30).getTime();

test('a lesson carries the day it was recorded, and an old list keeps its hash', () => {
  const lesson = { id: 'l1', type: 'video', page: 2, x: 10, y: 10, url: LESSON_URL, ts: DAY(2026, 11, 12),
    lessonRecording: { duration: 61000, video: true } };
  const it = P.itemFromAnnotation(lesson);
  assert.equal(it.at, DAY(2026, 11, 12));
  assert.equal(P.cleanItem(it).at, DAY(2026, 11, 12));
  // Absurd times are left off rather than trusted.
  assert.equal(P.cleanItem(Object.assign({}, it, { at: 5 })).at, undefined);
  assert.equal(P.cleanItem(Object.assign({}, it, { at: Date.UTC(2200, 0, 1) })).at, undefined);
  assert.equal(P.cleanItem(Object.assign({}, it, { at: 'soon' })).at, undefined);
  // cleanItem is still idempotent.
  assert.deepEqual(P.cleanItem(P.cleanItem(it)), P.cleanItem(it));
  // A list hosted before lessons carried a date reads back with its own hash.
  const old = { v: 1, name: 'WS', ws: 'doc1', items: [{ kind: 'lesson', label: 'Play lesson', page: 2, url: LESSON_URL, camera: false }] };
  const hash = P.contentHash(P.canonical(P.cleanPlaylist(old)));
  const back = P.readPublished(JSON.stringify(Object.assign({}, old, { hash })), hash);
  assert.ok(back.ok);
  assert.equal(back.playlist.items[0].at, undefined);
});

test('lessonDays groups by the lesson day, oldest first, undated last', () => {
  const items = [
    { kind: 'lesson', page: 1, at: DAY(2026, 11, 12, 18) },
    { kind: 'youtube', page: 1 },
    { kind: 'lesson', page: 2, at: DAY(2026, 11, 5) },
    { kind: 'lesson', page: 3, at: DAY(2026, 11, 12, 17) },
    { kind: 'file', page: 4, at: DAY(2026, 11, 1) }   // only a lesson has a day
  ];
  const now = DAY(2026, 11, 13);
  const days = P.lessonDays(items, now);
  assert.deepEqual(days.map((d) => d.key), ['2026-11-05', '2026-11-12', '']);
  assert.deepEqual(days.map((d) => d.idx), [[2], [0, 3], [1, 4]]);
  assert.equal(days[0].label, 'Thu 5 Nov');
  assert.equal(days[1].heading, 'Thursday’s lesson');
  assert.equal(days[1].at, DAY(2026, 11, 12, 17), 'a day starts at its first lesson');
  assert.equal(days[2].label, P.UNDATED_LABEL);
  assert.deepEqual(P.playOrder(items, now), [2, 0, 3, 1, 4]);
  // Another year says so.
  assert.equal(P.dayLabel(DAY(2025, 3, 4), now), 'Tue 4 Mar 2025');
  // Nothing dated: one group for the whole worksheet, in question order.
  const plain = P.lessonDays([{ kind: 'youtube' }, { kind: 'file' }]);
  assert.equal(plain.length, 1);
  assert.equal(plain[0].label, 'Videos');
  assert.deepEqual(plain[0].idx, [0, 1]);
  assert.deepEqual(P.lessonDays([]), []);
});

test('the player steps through the day order and opens on a #day- link', () => {
  const items = [
    { kind: 'lesson', at: DAY(2026, 11, 12) },
    { kind: 'youtube' },
    { kind: 'lesson', at: DAY(2026, 11, 5) }
  ];
  const order = P.playOrder(items);
  assert.deepEqual(order, [2, 0, 1]);
  assert.equal(P.orderNext(order, 2), 0);
  assert.equal(P.orderNext(order, 1), -1);
  assert.equal(P.orderPrev(order, 2), -1);
  assert.equal(P.orderPrev(order, 1), 0);
  assert.equal(P.orderNext(order, 9), -1);
  assert.equal(P.dayStart('#day-2026-11-12', items), 0);
  assert.equal(P.dayStart('day-2026-11-05', items), 2);
  assert.equal(P.dayStart('#day-2026-11-06', items), -1);
  assert.equal(P.dayStart('#3', items), -1);
  assert.equal(P.dayStart('#day-2026-11-12<x>', items), -1);
  // The player uses the order, never i ± 1.
  assert.match(page, /P\.orderNext\(order, index\)/);
  assert.match(page, /P\.orderPrev\(order, index\)/);
  assert.match(page, /P\.dayStart\(location\.hash, playlist\.items\)/);
  assert.ok(!/play\(index \+ 1/.test(page) && !/play\(index - 1/.test(page));
});

test('the answer key is one tap away, and always the live one', () => {
  assert.equal(P.answerKeyLink({ ws: 'doc_1' }), './?ws=doc_1');
  assert.equal(P.answerKeyLink({ ws: 'doc_1' }, true), './?ws=doc_1&do=print-answers');
  assert.equal(P.answerKeyLink({ ws: '' }), '');
  assert.equal(P.answerKeyLink({ ws: 'a/b' }), '');
  assert.match(page, /id="vpKeyLinks" hidden/);
  assert.match(page, /P\.answerKeyLink\(playlist, true\)/);
});

test('every lesson saved files the list at once, and a sheet with no videos takes it off', () => {
  const glue = section('🎬 Videos on paper — glue', 'End videos on paper glue');
  assert.match(glue, /videoPlaylist: \{ hash: pub\.hash, token: pub\.token, n: n \|\| 0, at: Date\.now\(\) \}/);
  assert.match(glue, /if \(!pl\) \{ if \(vplDocPub && await vplForget\(docAtStart\)\) filed = true; break; \}/);
  assert.match(glue, /async function vplForget\(docId\) \{\s*if \(!docId \|\| !wheelTeacher\(\) \|\| practiceMode \|\| !vplDocPub\) return false;/);
  assert.match(glue, /videoPlaylist: firebase\.firestore\.FieldValue\.delete\(\)/);
  // The lesson recorder writes the annotations itself and never reaches auto-save.
  const rec = section('async function lessonSavePending()', 'function lessonDownloadPending()');
  assert.match(rec, /if \(lessonContextOK\(job\) && typeof vplAfterSave === 'function'\) \{\s*[\s\S]{0,120}Promise\.resolve\(vplAfterSave\(\)\)/);
  assert.ok(rec.indexOf('vplAfterSave') > rec.indexOf('await writeAnnotations(job.docId'), 'filed only after the lesson is written');
});
