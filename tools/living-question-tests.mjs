/* 📝 Living questions, ☁ the library as where an app lives, and 📋 the AI
   prompt — the pure helpers, run in a vm, and the glue's wiring pinned
   against index.html.
     node --test tools/living-question-tests.mjs

   The browser half is tools/living-library-check.mjs (☁ Library first,
   📝 As a question, 📋 The AI prompt). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const SRC = fs.readFileSync(new URL('living-question.js', ROOT), 'utf8');
const LA_SRC = fs.readFileSync(new URL('living-apps.js', ROOT), 'utf8');
const LL_SRC = fs.readFileSync(new URL('living-library.js', ROOT), 'utf8');
const HTML = fs.readFileSync(new URL('index.html', ROOT), 'utf8');

function load() {
  const ctx = { console, Date, Math, JSON, encodeURIComponent, decodeURIComponent, Object, Array, String, Number, RegExp, Promise, isFinite };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(LA_SRC, ctx);
  vm.runInContext(LL_SRC, ctx);
  vm.runInContext(SRC, ctx);
  return { Q: ctx.LivingQuestion.pure, LA: ctx.LivingApps.pure, L: ctx.LivingLibrary.pure };
}
const { Q, LA, L } = load();
const plain = (v) => JSON.parse(JSON.stringify(v));
const section = (from, to) => {
  const a = HTML.indexOf(from);
  assert.ok(a >= 0, 'missing: ' + from);
  const b = HTML.indexOf(to, a + from.length);
  assert.ok(b > a, 'missing end after: ' + from);
  return HTML.slice(a, b + to.length);
};

const FIGURE = "<svg viewBox='0 0 400 200'><rect x='10' y='10' width='100' height='60' fill='none' stroke='#000'/></svg>";
const block = (obj, attrs = 'type="application/json" id="polymath-question"') =>
  '<!doctype html><title>Ballast</title><body><div id="stage"></div><script ' + attrs + '>' + JSON.stringify(obj) + '</script></body>';

/* ---------------- reading the question block ---------------- */
test('the question block is found, read and cleaned', () => {
  const r = Q.readSpec(block({
    title: '  Ballast <b>tanks</b> ', stem: 'The diagram shows a <i>submarine</i>.', figure: FIGURE,
    parts: [{ text: 'Why does it sink?', marks: 2, lines: 3, answer: 'Water fills the tanks.' }, { label: 'b', text: 'How?' }, 'A plain string part']
  }));
  assert.equal(r.ok, true);
  const s = plain(r.spec);
  assert.equal(s.title, 'Ballast tanks');
  assert.equal(s.stem, 'The diagram shows a submarine .');
  assert.deepEqual(s.parts.map(p => p.label), ['(a)', '(b)', '(c)']);
  assert.equal(s.parts[0].marks, 2);
  assert.equal(s.parts[0].lines, 3);
  assert.equal(s.parts[1].lines, Q.DEFAULT_PART_LINES, 'a part that does not say gets the default lines');
  assert.equal(s.parts[2].text, 'A plain string part');
  assert.equal(s.lines, 0, 'with parts, the stem has no lines of its own unless it says');
  assert.match(s.figure, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
});

test('the block may be named by data-polymath-question, and is found among other scripts', () => {
  const html = '<script>var x = 1;</script><script type="application/json" data-polymath-question>{"stem":"Hi"}</script>';
  assert.equal(Q.readSpec(html).spec.stem, 'Hi');
});

test('no block, a running block, bad JSON and an empty block are told apart', () => {
  assert.deepEqual(plain(Q.readSpec('<p>no block</p>')), { ok: false, reason: 'none' });
  const running = Q.readSpec('<script type="text/javascript" id="polymath-question">{"stem":"x"}</script>');
  assert.equal(running.reason, 'bad');
  assert.match(running.message, /never runs/);
  const broken = Q.readSpec('<script type="application/json" id="polymath-question">{stem: x}</script>');
  assert.equal(broken.reason, 'bad');
  assert.match(broken.message, /not valid JSON/);
  const empty = Q.readSpec(block({ title: 'only a title' }));
  assert.equal(empty.reason, 'bad');
  assert.equal(Q.readSpec(null).ok, false);
});

test('numbers are clamped and a part with nothing in it is dropped', () => {
  const s = Q.readSpec(block({ stem: 'x', lines: 999, marks: -3, parts: [{ text: '', lines: 0 }, { text: 'ok', lines: 'lots', marks: 4.6 }] })).spec;
  assert.equal(s.parts.length, 1);
  assert.equal(s.parts[0].lines, Q.DEFAULT_PART_LINES);
  assert.equal(s.parts[0].marks, 5);
  assert.equal(s.marks, 0);
  const many = Q.readSpec(block({ stem: 'x', parts: Array.from({ length: 20 }, (_, i) => ({ text: 'p' + i, lines: 40 })) })).spec;
  assert.equal(many.parts.length, Q.PARTS_MAX);
  assert.ok(many.parts.every(p => p.lines === Q.LINES_MAX));
});

test('an app with no block still makes a question: its title, and room to write', () => {
  const s = Q.specFor({ title: 'Magnet Lab', html: '<p>magnets</p>' });
  assert.equal(s.stem, 'Magnet Lab');
  assert.equal(s.lines, Q.DEFAULT_LINES);
  assert.equal(s.fallback, true);
  assert.equal(Q.specFor({ title: 'T', html: block({ stem: 'Real' }) }).stem, 'Real');
  assert.equal(Q.specFor({ title: 'From the app', html: block({ stem: 'Real' }) }).title, 'From the app', 'a block with no title takes the app’s');
});

test('the summary, the stem and each part read as they will on paper', () => {
  const s = Q.readSpec(block({ stem: 'Look.', figure: FIGURE, parts: [{ text: 'One', marks: 1, lines: 2, answer: 'a' }, { text: 'Two', marks: 2, lines: 4 }] })).spec;
  const sum = plain(Q.summary(s));
  assert.deepEqual(sum, { parts: 2, lines: 6, marks: 3, figure: true, answers: 1, text: '2 parts · 6 working lines · 3 marks · a diagram' });
  assert.equal(Q.partText(s.parts[0]), '(a) One  [1]');
  assert.equal(Q.stemText(s), 'Look.');
  assert.equal(Q.stemText(Q.readSpec(block({ stem: 'Only a stem', marks: 3 })).spec), 'Only a stem  [3]');
  assert.equal(Q.questionOf({ html: '<p>none</p>' }), null);
  assert.equal(Q.questionOf({ html: block({ stem: 'x' }) }).lines, Q.DEFAULT_LINES);
  assert.equal(Q.figureOf({ html: block({ stem: 'x', figure: FIGURE }) }).slice(0, 4), '<svg');
});

/* ---------------- the figure ---------------- */
test('a figure keeps its drawing and loses anything that runs', () => {
  const dirty = "<?xml version='1.0'?><!-- hi --><svg viewBox='0 0 10 10' onload='evil()'><script>evil()</script>" +
    "<foreignObject><div>x</div></foreignObject><a href='javascript:evil()'><rect onclick='x()' width='5' height='5'/></a><iframe src='x'></iframe></svg>";
  const s = Q.cleanSvg(dirty);
  assert.ok(s.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(!/script|foreignObject|onload|onclick|javascript:|iframe/i.test(s), s);
  assert.match(s, /<rect\s+width='5' height='5'\/>/);
  assert.equal(Q.cleanSvg('<div>not svg</div>'), '');
  assert.equal(Q.cleanSvg('<svg viewBox="0 0 1 1">unclosed'), '');
  assert.equal(Q.cleanSvg('<svg>' + 'x'.repeat(Q.FIGURE_MAX) + '</svg>'), '', 'too big');
});

test('a figure’s shape comes from its viewBox, else its size, else 5 : 3', () => {
  assert.deepEqual(plain(Q.svgSize("<svg viewBox='0 0 400 200'>")), { w: 400, h: 200, from: 'viewBox' });
  assert.deepEqual(plain(Q.svgSize('<svg width="300px" height="150">')), { w: 300, h: 150, from: 'size' });
  assert.deepEqual(plain(Q.svgSize('<svg>')), { w: 500, h: 300, from: 'guess' });
  const sized = Q.svgForImage('<svg width="30" height="10"><rect/></svg>', 600, 200);
  assert.match(sized, /^<svg width="600" height="200" viewBox="0 0 30 10"/, sized);
  assert.equal((sized.match(/width=/g) || []).length, 1, 'the old size is replaced, not doubled');
});

test('the layout never places a figure narrower than the strip assumes', () => {
  for (const ratio of [0.5, 1, 2, 3, 6]) {
    const r = Q.layout({ pageW: 595, pageH: 842, top: 40, stemH: 300, figRatio: ratio, parts: [{ h: 40, lines: 16 }, { h: 40, lines: 16 }] });
    const fig = r.items.find(i => i.kind === 'figure');
    assert.ok(fig.w >= Math.min(400, 150 * ratio) - 0.5, ratio + ': ' + fig.w);
  }
});

test('the gold strip holds the printed QR code — it never lands on the diagram', () => {
  const shapes = [[1400, 900], [1200, 600], [1400, 300], [1400, 240], [800, 900], [400, 900], [300, 900]];
  for (const [w, h] of shapes) {
    const sw = Q.stripWidth(w, h);
    const total = w + sw;
    assert.ok(sw <= total * Q.FIG_STRIP_SHARE + 1, `${w}×${h}: strip ${sw} of ${total}`);
    assert.ok(sw >= h * 0.2, 'room for the wand and its words on screen');
    // Every width the cover is really placed at on a page: layout() gives a
    // figure at least a fifth of the page's height, so a wide one is never
    // placed narrow.
    const ratio = total / h;
    for (const rw of [200, 260, 320, 400, 447, 520].filter(x => x >= Math.min(400, 150 * ratio) || x >= 400)) {
      const rh = rw * h / total;
      const pad = LA.qrOnCover(0, 0, rw, rh);
      const strip = rw * sw / total;
      assert.ok(pad.padX + pad.padW <= strip + 0.5, `${w}×${h} at ${rw}pt: code ends at ${(pad.padX + pad.padW).toFixed(1)}, strip ${strip.toFixed(1)}`);
    }
  }
});

/* ---------------- the layout ---------------- */
const items = (r, kind) => r.items.filter(i => i.kind === kind);
test('a question is laid out from where the teacher is looking, top to bottom, with even lines', () => {
  const r = Q.layout({ pageW: 600, pageH: 800, top: 120, stemH: 40, figRatio: 2, parts: [{ h: 20, lines: 2 }, { h: 30, lines: 3 }] });
  assert.equal(r.fits, true);
  assert.equal(r.trimmed, 0);
  assert.equal(r.startY, 120);
  const order = plain(r.items.map(i => i.kind + (i.i != null ? i.i : '')));
  assert.deepEqual(order, ['stem', 'figure', 'part0', 'lines0', 'part1', 'lines1']);
  let y = 0;
  r.items.forEach(i => { assert.ok(i.y >= y, 'never above the one before'); y = i.y; });
  const fig = items(r, 'figure')[0];
  assert.ok(Math.abs(fig.w / fig.h - 2) < 0.01, 'the figure keeps its shape');
  assert.ok(Math.abs(fig.x + fig.w / 2 - 300) < 0.01, 'the figure is centred');
  items(r, 'lines').forEach(l => {
    assert.ok(l.ys.every((y2, k) => k === 0 || Math.abs(y2 - l.ys[k - 1] - r.lineGap) < 0.02), 'evenly spaced');
    assert.ok(l.ys[0] > items(r, 'part').find(p => p.i === l.i).y, 'lines under their part');
  });
  assert.deepEqual(plain(items(r, 'lines').map(l => l.ys.length)), [2, 3]);
});

test('too low on the page, it starts at the top margin instead', () => {
  const r = Q.layout({ pageW: 600, pageH: 800, top: 600, stemH: 40, figRatio: 2, parts: [{ h: 20, lines: 4 }] });
  assert.equal(r.fits, true);
  assert.equal(r.startY, Q.MARGIN);
  assert.equal(r.lineGap, Q.LINE_GAP);
});

test('a long question tightens its lines, then shrinks its figure, and only then drops lines — never off the page', () => {
  const r = Q.layout({ pageW: 600, pageH: 800, top: 40, stemH: 200, figRatio: 1, parts: [{ h: 40, lines: 16 }, { h: 40, lines: 16 }, { h: 40, lines: 2 }] });
  assert.equal(r.lineGap, Q.LINE_GAP_MIN);
  assert.ok(r.trimmed > 0);
  assert.equal(r.fits, true);
  assert.ok(r.bottom <= 800);
  const counts = items(r, 'lines').map(l => l.ys.length);
  assert.ok(counts.every(n => n >= 1), 'every part keeps at least one line: ' + counts);
  assert.ok(Math.abs(counts[0] - counts[1]) <= 1, 'lines dropped evenly: ' + counts);
  r.items.forEach(i => (i.ys || [i.y + i.h]).forEach(y => assert.ok(y <= 800, i.kind + ' at ' + y)));
  const tight = Q.layout({ pageW: 600, pageH: 800, top: 40, stemH: 120, figRatio: 1.5, parts: [{ h: 20, lines: 14 }] });
  assert.equal(tight.trimmed, 0);
  assert.equal(tight.lineGap, Q.LINE_GAP_MIN, 'tighter lines before any are dropped');
});

test('a stem with its own lines, and a question with no figure', () => {
  const r = Q.layout({ pageW: 500, pageH: 700, top: 50, stemH: 30, figRatio: 0, stemLines: 3, parts: [] });
  assert.deepEqual(plain(r.items.map(i => i.kind)), ['stem', 'lines']);
  assert.equal(items(r, 'lines')[0].i, -1);
  assert.equal(items(r, 'lines')[0].ys.length, 3);
});

test('a working line is an ordinary line annotation: light, thin, level', () => {
  assert.deepEqual(plain(Q.lineAnn(40, 100.123, 520)), { type: 'line', x1: 40, y1: 100.12, x2: 560, y2: 100.12, color: Q.LINE_COLOR, width: Q.LINE_WIDTH });
});

/* ---------------- an AI's reply ---------------- */
test('the app is taken out of an AI’s reply, fences and prose and all', () => {
  const app = '<!doctype html>\n<html><body><p>x</p></body></html>';
  assert.equal(Q.extractHtml('Sure! Here it is:\n```html\n' + app + '\n```\nEnjoy.'), app + '\n');
  assert.equal(Q.extractHtml('```\n' + app + '\n```'), app + '\n');
  assert.equal(Q.extractHtml('```css\nbody{}\n```\n```html\n<div>frag</div>\n```'), '<div>frag</div>\n', 'an html fence beats a css one');
  assert.equal(Q.extractHtml('```js\nvar a = 1;\n```\n```html\n' + app + '\n```'), app + '\n');
  assert.equal(Q.extractHtml('Here you go: ' + app + ' Hope it helps!'), app);
  assert.equal(Q.extractHtml('```html\n' + app.slice(0, 30)), app.slice(0, 30), 'a reply cut off mid-file keeps its start');
  assert.equal(Q.extractHtml(app), app, 'a bare file is left alone');
  assert.equal(Q.extractHtml('just words'), 'just words');
});

/* ---------------- 📋 the prompt ---------------- */
test('the prompt asks for exactly what this app enforces', () => {
  const p = Q.buildPrompt({ level: 'P5', subject: 'science', topic: 'Ballast tanks' });
  assert.match(p, /Primary 5 Science students in Singapore/);
  assert.match(p, /## What the app is about\nBallast tanks/);
  // The wand — every way WAND_BRIDGE looks for one.
  assert.match(p, /class="btn-wand" data-polymath-wand data-wand-target="#stage"/);
  assert.match(p, /window\.polymathWand = function \(detail\)/);
  assert.match(p, /class="wand-target"/);
  assert.ok(/\.btn-wand/.test(LA_SRC) && /data-polymath-wand/.test(LA_SRC) && /polymathWand/.test(LA_SRC), 'the bridge looks for them');
  // The sandbox and its policy.
  assert.match(p, /no fetch \/ XMLHttpRequest/);
  assert.match(LA_SRC, /connect-src 'none'/, 'the policy really does shut the network');
  assert.match(p, /localStorage, sessionStorage, cookies/);
  assert.ok(/sandbox', 'allow-scripts'/.test(LA_SRC) && !/allow-same-origin/.test(LA_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/never allow-same-origin/g, '')));
  // Size within what a page can carry.
  const cap = Number((p.match(/Under (\d+) KB in total/) || [])[1]);
  assert.ok(cap && cap * 1024 <= 600000, 'under normalizeApp’s MAX_CHARS');
  // The question block, by the id readSpec looks for.
  assert.match(p, new RegExp('id="' + Q.SPEC_ID + '"'));
});

test('the prompt’s own example block is one readSpec reads', () => {
  const p = Q.buildPrompt({});
  const m = p.match(/(<script type="application\/json" id="polymath-question">[\s\S]*?<\/script>)/);
  assert.ok(m, 'the example is in the prompt');
  const r = Q.readSpec(m[1]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.spec.parts.length, 2);
  assert.match(r.spec.figure, /^<svg/);
  assert.match(r.spec.stem, /"the diagram below"/);
});

test('without a question on paper, the block is not asked for; with no topic, the teacher fills it in', () => {
  const p = Q.buildPrompt({ question: false });
  assert.ok(!/polymath-question/.test(p));
  assert.match(p, /\[Describe the question/);
  assert.match(Q.buildPrompt({ level: 'P9', subject: 'art' }), /primary school students in Singapore/, 'an unknown level or subject is left out');
});

test('an AI opens with the prompt typed in only while the link stays short', () => {
  assert.ok(Q.aiLink('chatgpt', 'hello').startsWith('https://chatgpt.com/?q=hello'));
  assert.ok(Q.aiLink('claude', 'hi there').startsWith('https://claude.ai/new?q=hi%20there'));
  assert.equal(Q.aiLink('gemini', 'x'), 'https://gemini.google.com/app');
  assert.equal(Q.aiLink('chatgpt', 'x'.repeat(Q.AI_URL_MAX)), 'https://chatgpt.com/');
  assert.equal(Q.aiLink('nope', 'x'), '');
  assert.ok(Q.aiLink('chatgpt', Q.buildPrompt({ topic: 'x' })).length <= Q.AI_URL_MAX, 'the full prompt fits a ChatGPT link');
});

/* ---------------- ☁ the library entry ---------------- */
const HASH = LA.contentHash('<!doctype html><p>Magnets</p>');
const TOKEN = '5d0c2c1e-7a4b-4f7e-9b1a-0c0000000001';
test('an app added to the library is a whole entry with no worksheet', () => {
  const w = plain(L.entryWrite({ title: 'Magnet Lab', wand: true }, { hash: HASH, token: TOKEN }, null, 1000,
    { library: true, level: 'p5', subject: 'Science', question: { parts: 2, lines: 6, marks: 3, figure: true, answers: 1, text: 'x' } }));
  assert.deepEqual(w, { v: 1, hash: HASH, token: TOKEN, title: 'Magnet Lab', wand: true, lastAt: 1000, inLibrary: true, addedAt: 1000, level: 'P5', subject: 'science', question: { parts: 2, lines: 6, marks: 3, figure: true } });
  assert.ok(!('sheets' in w));
  const e = plain(L.readEntry(HASH, w));
  assert.equal(e.inLibrary, true);
  assert.deepEqual(e.sheets, []);
  assert.deepEqual(e.levels, ['P5']);
  assert.deepEqual(e.subjects, ['science']);
  assert.equal(e.addedAt, 1000);
  assert.equal(L.questionText(e.question), '2 parts · 6 lines · 3 marks · diagram');
  assert.equal(L.whereText(e), 'Not on a worksheet yet — in your library only');
  // An extra with nothing usable writes nothing extra.
  const bare = plain(L.entryWrite({ title: 'x' }, { hash: HASH, token: TOKEN }, null, 5, { level: 'Sec 9', subject: 'art', question: { parts: 0 } }));
  assert.ok(!('level' in bare) && !('subject' in bare) && !('question' in bare) && !('inLibrary' in bare));
});

test('the library finds apps on no worksheet, and apps with a question', () => {
  const loose = L.readEntry(HASH, { hash: HASH, token: TOKEN, title: 'Magnet Lab', inLibrary: true, addedAt: 50, level: 'P4' });
  const onSheet = L.readEntry('la1-3-abc', { hash: 'la1-3-abc', token: TOKEN, title: 'Water', question: { parts: 1 }, sheets: { ws1: { name: 'W1', level: 'P5', at: 9 } } });
  const list = [loose, onSheet];
  assert.deepEqual(L.filterEntries(list, { where: 'loose' }).map(e => e.title), ['Magnet Lab']);
  assert.deepEqual(L.filterEntries(list, { where: 'question' }).map(e => e.title), ['Water']);
  assert.deepEqual(L.filterEntries(list, { level: 'P4' }).map(e => e.title), ['Magnet Lab'], 'a library app’s own level counts');
  assert.deepEqual(L.filterEntries(list, { q: 'library' }).map(e => e.title), ['Magnet Lab']);
  assert.equal(loose.lastAt, 50, 'an app added to the library sorts by when it was added');
});

/* ---------------- the wiring ---------------- */
test('adding an app saves it to the library FIRST, and the page waits a bounded time', () => {
  const commit = LA_SRC.slice(LA_SRC.indexOf('    function commitAdder(mode) {'), LA_SRC.indexOf('    function closeAdder() {'));
  assert.ok(commit.indexOf('saveToLibrary(res.app)') > 0);
  assert.ok(commit.indexOf('saveToLibrary(res.app)') < commit.indexOf('paintCover(res.app)'), 'the library before the page');
  assert.match(commit, /res\.app\.pub = \{ hash: pub\.hash, token: pub\.token \}/, 'the app goes on the page already carrying its code');
  assert.match(LA_SRC, /var LIBRARY_WAIT_MS = \d+;/);
  assert.match(LA_SRC, /setTimeout\(function \(\) \{ if \(!done\) \{ done = true; resolve\(\{ pub: null, slow: true \}\); \} \}, LIBRARY_WAIT_MS\)/);
});

test('the adder opens with no worksheet, and saves to the library alone', () => {
  assert.match(HTML, /canAdd: function \(\) \{ return true; \},\s*canPlace: lappCanPlace,\s*saveToLibrary: llibSaveApp,\s*addAsQuestion: lappAddQuestion,\s*openPrompt: lqOpenPrompt,/);
  assert.match(LA_SRC, /var canPlace = !!existing \|\| \(!opts\.libraryOnly && /);
  assert.match(LA_SRC, /commitAdder\(st\.canPlace \|\| st\.editId \? 'page' : 'library'\)/);
});

test('every new door is the teacher’s, asked again in the handler', () => {
  assert.match(section('async function llibSaveApp(app) {', '\n}\n'), /^async function llibSaveApp\(app\) \{\s*if \(!wheelTeacher\(\)\) throw/);
  assert.match(section('async function llibPlace(entry, opts) {', '\n}\n'), /opts = opts \|\| \{\};\s*if \(!wheelTeacher\(\)\) throw/);
  assert.match(section('async function lappAddQuestion(cover, app, opts) {', '\n}\n'), /opts = opts \|\| \{\};\s*if \(!wheelTeacher\(\)\)/);
  assert.match(section('function lqOpenPrompt(opts) {', '\n}\n'), /if \(!wheelTeacher\(\)\)/);
  assert.match(section('function lappCanPlace() {', '\n}\n'), /return wheelTeacher\(\) && !practiceMode && !!pdfDoc/);
  assert.match(LL_SRC, /function place\(e, asQuestion\) \{[\s\S]{0,120}if \(!isTeacher\(\)\)/);
});

test('a library app is fetched by its code, rebuilt from the bucket — never a URL from anywhere else', () => {
  const place = section('async function llibPlace(entry, opts) {', '\n}\n');
  assert.match(place, /P\.mediaUrl\(entry\.hash, entry\.token\)/);
  assert.match(place, /P\.readPublished\(await res\.text\(\), entry\.hash\)/, 'the file must be the app the code names');
  assert.match(place, /app\.pub = \{ hash: entry\.hash, token: entry\.token \}/);
  assert.ok(place.indexOf('lappCanPlace()', place.indexOf('paintCover')) > 0, 'the page is asked again after the awaits');
});

test('the library never holds the app, and the hosted copy belongs to no worksheet', () => {
  const save = section('async function llibSaveApp(app) {', '\n}\n');
  assert.match(save, /entryWrite\(app, pub, null, Date\.now\(\), extra\)/, 'no sheet');
  assert.ok(!/\.html\b/.test(save), 'the HTML is never written to Firestore');
  assert.match(LA_SRC, /return validHash\(hash\) \? PUBLISH_DIR \+ '\/' \+ PUBLISH_PREFIX \+ hash \+ '\.json' : '';/, 'content-addressed: no worksheet id in the path');
  // Deleting a worksheet removes its own PDF and annotations file — never a living-*.json.
  const del = HTML.slice(HTML.indexOf("try { await storage.ref(data.storagePath).delete(); }") - 600, HTML.indexOf("try { await storage.ref(data.storagePath).delete(); }") + 400);
  assert.ok(!/living-|publishPath|PUBLISH_PREFIX/.test(del), 'a worksheet delete leaves the hosted apps alone');
});

test('a living question’s pieces are the worksheet: practice and the questions print keep them, the style corpus skips them', () => {
  assert.match(HTML, /function annLivingQuestion\(a\) \{\s*return !!\(a && typeof a\.lq === 'string' && a\.lq\);/);
  assert.match(HTML, /function lappPracticeCopies\(list\) \{\s*return \(list \|\| \[\]\)\.filter\(function \(a\) \{ return \(annLivingApp\(a\) \|\| annLivingQuestion\(a\)\) && !annBankQ\(a\); \}\)/);
  assert.match(HTML, /annBankQ\(a\) \|\| annLivingApp\(a\) \|\| annLivingQuestion\(a\); \}\)/);
  assert.match(section('function styleHarvestTyped(anns, docId, meta) {', '\n}\n'), /annLivingQuestion\(a\)\) return;/);
  assert.match(HTML, /askedHere\.length\) lines\.push\('These questions are also on this page/);
});

test('the question goes on as ordinary annotations, never a new type, in one undo step', () => {
  const add = section('async function lappAddQuestion(cover, app, opts) {', '\n}\n');
  assert.equal((add.match(/pushUndo\(\);/g) || []).length, 1);
  assert.match(add, /type: 'ainote', kind: 'paste',[\s\S]{0,300}lapp: app, lq: qid/);
  assert.match(add, /type: 'text'/);
  assert.match(add, /LQ\.lineAnn\(it\.x, y, it\.w\)/);
  assert.ok(!/type: 'question'|kind: 'question'|kind: 'lq'/.test(add));
  // The model answers are the teacher's: no lq, no group.
  const ans = add.slice(add.indexOf('// ✍ The model answer'), add.indexOf('// A figure-less question'));
  assert.match(ans, /color: LQ\.ANSWER_COLOR/);
  assert.ok(!/lq:|grp:/.test(ans), 'an answer is not part of the question');
  assert.match(add, /if \(!wheelTeacher\(\) \|\| practiceMode \|\| !pdfDoc \|\| pages\.indexOf\(page\) === -1\) return 0;/, 'asked again after drawing the figure');
});

test('a window over the library or the adder takes its own Escape', () => {
  assert.match(LL_SRC, /e\.target\.closest\('\.lqBack'\)\) return;/);
  assert.match(LA_SRC, /e\.target\.closest\('\.laBack, \.lqBack'\)\) return;/);
  assert.match(SRC, /\['keydown', 'keyup', 'keypress', 'paste', 'copy', 'cut'\]\.forEach[\s\S]{0,200}e\.stopPropagation\(\);/);
});

test('the module loads before living apps, with its stylesheet, and is syntax-checked', () => {
  assert.ok(HTML.indexOf('<script src="living-question.js">') > 0);
  assert.ok(HTML.indexOf('<script src="living-question.js">') < HTML.indexOf('<script src="living-apps.js">'));
  assert.ok(HTML.includes('<link rel="stylesheet" href="living-question.css">'));
  assert.ok(fs.readFileSync(new URL('tools/check-syntax.mjs', ROOT), 'utf8').includes("'living-question.js'"));
  assert.match(fs.readFileSync(new URL('living-question.css', ROOT), 'utf8'), /\.lqBack \{[\s\S]{0,400}z-index: 4400;/);
});
