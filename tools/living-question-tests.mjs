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

/* ---------------- 🪄 the corner and the bank's format (v1.181.0) ---------------- */
test('🪄 the corner is a small square at the top right, inside the gutter, and cleanCorner is its one door', () => {
  for (const [w, h] of [[664, 90], [664, 600], [664, 2400], [664, 64]]) {
    const c = LA.cornerFor(w, h, LA.CORNER_GUTTER);
    const left = c.x * w, size = c.s * w, top = c.y * h;
    assert.ok(left >= 600 - 0.5, `${w}×${h}: the square starts in the gutter (${left})`);
    assert.ok(left + size <= w + 0.01, 'never off the right edge');
    assert.ok(top + size <= h + 0.01, 'never off the bottom');
    assert.ok(size <= LA.CORNER_GUTTER, 'small: never wider than the gutter');
    assert.deepEqual(plain(LA.cleanCorner(c)), plain(c));
  }
  assert.equal(LA.cleanCorner(null), null);
  assert.equal(LA.cleanCorner({ x: 0.9, y: 0, s: 0.2 }), null, 'a square past the edge');
  assert.equal(LA.cleanCorner({ x: 'a', y: 0, s: 0.1 }), null);
  assert.equal(LA.cleanCorner({ x: 0.5, y: 0, s: 0.9 }), null, 'no big rectangle');
});

test('🪄 on paper the code takes the corner: a plain square inside the picture, top right, sized with it', () => {
  const c = LA.cornerFor(664, 500, LA.CORNER_GUTTER);
  const rect = { x: 36, y: 100, w: 523, h: 523 * 500 / 664 };
  const q = LA.qrInCorner(rect, c);
  assert.ok(q.x >= rect.x + rect.w * 600 / 664 - 0.5, 'in the gutter, off the question');
  assert.ok(q.x + q.size <= rect.x + rect.w + 0.01);
  assert.ok(q.y + q.size <= rect.y + rect.h + 0.01, 'at the top');
  assert.ok(q.y + q.size >= rect.y + rect.h - 12, 'right at the top');
  assert.ok(q.size > 30 && q.size < 60, 'a small code a phone still reads: ' + q.size);
  const big = LA.qrInCorner({ x: 0, y: 0, w: 1046, h: 1046 * 500 / 664 }, c);
  assert.ok(Math.abs(big.size - q.size * 2) < 0.1, 'it grows with the picture');
  assert.equal(LA.qrInCorner(rect, null), null, 'no corner, no square: the old cover keeps its old place');
});

test('🪄 drawQrOnPdf draws a plain square with no pad, no border and no label in a corner', () => {
  const rects = [], texts = [];
  const page = { drawRectangle: (o) => rects.push(o), drawText: (t) => texts.push(t), node: { lookup: () => null, set() {} } };
  const lib = { rgb: (r, g, b) => ({ r, g, b }), PDFName: { of: (x) => x }, PDFString: { of: (x) => x } };
  const doc = { context: { register: (x) => x, obj: (x) => x } };
  const font = { widthOfTextAtSize: () => 10 };
  const matrix = [[true, false], [false, true]];
  const runs = (m) => [{ r: 0, c: 0, len: 1 }, { r: 1, c: 1, len: 1 }];
  const corner = LA.cornerFor(664, 500, LA.CORNER_GUTTER);
  const LAfull = (0, eval)('null') || null;   // keep the lint quiet
  const ctx = { console, Math, JSON, Object, Array, String, Number, RegExp, Promise, isFinite, encodeURIComponent, decodeURIComponent };
  ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(LA_SRC, ctx);
  const ok = ctx.LivingApps.drawQrOnPdf(doc, page, 'https://x.test/living.html?a', lib, font, { x: 0, y: 0, w: 523, h: 394 }, () => matrix, runs, corner);
  assert.equal(ok, true);
  assert.ok(!rects[0].borderColor && !rects[0].borderWidth, 'no border round it');
  assert.equal(rects[0].width, rects[0].height, 'a square');
  assert.equal(texts.length, 0, 'no label under it');
  // An older cover with no corner keeps its pad and its label.
  rects.length = 0;
  ctx.LivingApps.drawQrOnPdf(doc, page, 'https://x.test/living.html?a', lib, font, { x: 0, y: 0, w: 523, h: 226 }, () => matrix, runs);
  assert.ok(rects[0].borderColor, 'the old place is unchanged');
  void LAfull;
});

test('📝 a question goes on paper in the question bank’s own shape: words, picture, table, parts with marks and ruled lines', () => {
  const spec = {
    stem: 'Mr Murthu pours tea.\nThe results are below.', marks: 0, lines: 0, answer: '',
    graphics: [{ kind: 'svg', svg: '<svg/>' }, { kind: 'table', rows: [{ head: true, cells: ['d', '50'] }, { head: false, cells: ['T <b>', ''] }] }],
    parts: [
      { label: '(a)', text: 'State the relationship.', marks: 1, lines: 2, answer: 'It falls.' },
      { label: '(ii)', text: 'Explain.', marks: 2, lines: 4, answer: '' },
      { label: 'Q3', text: 'Why?', marks: 0, lines: 0, answer: '' }
    ]
  };
  const q = plain(Q.questionBlocks(spec, 'data:image/png;base64,AAAA'));
  assert.deepEqual(q.blocks.map(b => b.type), ['text', 'image', 'table', 'text', 'plainanswer', 'text', 'plainanswer', 'text']);
  assert.equal(q.blocks[0].content, '<p>Mr Murthu pours tea.</p><p>The results are below.</p>');
  assert.equal(q.blocks[1].url, 'data:image/png;base64,AAAA');
  assert.deepEqual(q.blocks[2].data, [['<b>d</b>', '<b>50</b>'], ['T &lt;b&gt;', '']], 'escaped; the head row bold');
  assert.equal(q.blocks[3].part, 'a');
  assert.equal(q.blocks[3].marks, 1, 'the marks go to the painter, which writes [1] at the right');
  assert.deepEqual({ lines: q.blocks[4].lines, tag: q.blocks[4].tag }, { lines: 2, tag: 'p0' });
  assert.equal(q.blocks[5].subPart, 'ii');
  assert.equal(q.blocks[7].content, '<p>Q3 Why?</p>', 'a label the painter cannot number is written in front');
  // A question with no parts gets its lines under the words, tagged for its answer.
  const one = plain(Q.questionBlocks({ stem: 'Explain.', marks: 3, lines: 6, parts: [] }, ''));
  assert.deepEqual(one.blocks.map(b => b.type), ['text', 'plainanswer']);
  assert.equal(one.blocks[0].marks, 3);
  assert.deepEqual({ lines: one.blocks[1].lines, tag: one.blocks[1].tag }, { lines: 6, tag: 'q' });
  // ➕ Add to page: the title in bold and what the app draws.
  const app = plain(Q.appBlocks({ title: 'Ballast & tank' }, spec.graphics, 'data:image/png;base64,AAAA'));
  assert.deepEqual(app.blocks.map(b => b.type), ['text', 'image', 'table']);
  assert.equal(app.blocks[0].content, '<p><b>Ballast &amp; tank</b></p>');
});

test('📝 part labels: letters, roman numerals, both, and anything else', () => {
  assert.deepEqual(plain(Q.partKey('(a)')), { part: 'a', subPart: '', prefix: '' });
  assert.deepEqual(plain(Q.partKey('(b)(iii)')), { part: 'b', subPart: 'iii', prefix: '' });
  assert.deepEqual(plain(Q.partKey('(iv)')), { part: '', subPart: 'iv', prefix: '' });
  assert.deepEqual(plain(Q.partKey('Q2')), { part: '', subPart: '', prefix: 'Q2' });
});

test('📝 an app’s own furniture is not the question: shortcuts, hints, model working, checkers and scaffolds are left out', () => {
  // What the teh tarik app read as in v1.180.0 (Zhi Kai's screenshot).
  const text = ['Teh tarik: the pulled tea',
    'QuestionMr Murthu is famous for making ‘teh tarik’. He transferred hot tea from one container into another. The results are as shown in the table below.',
    'Model working', '6 lines', 'Answers: (a) ? (b) ?',
    '(a) Based on the results, state the relationship between distance d and the final temperature.',
    'Ctrl + Enter checks',
    '(b) Explain your answer in (a).', 'Ctrl + Enter checks',
    'Stuck on (b)? Four small questions', 'Answer them in order. Together they make the explanation.',
    '1.', '1. Which is hotter: the tea or the surrounding air?', '2.', '2. Which way does heat move?',
    'Model working', 'Blurred lines appear as the picture acts them out', '1.', 'The experiment', '1.', '2.'];
  const spec = Q.specFromHarvest({ title: 'Teh tarik: the pulled tea' }, { title: '', blocks: text.map(t => ({ kind: 'text', text: t })) });
  assert.equal(spec.stem, 'Mr Murthu is famous for making ‘teh tarik’. He transferred hot tea from one container into another. The results are as shown in the table below.');
  assert.deepEqual(plain(spec.parts.map(p => [p.label, p.text])), [
    ['(a)', 'Based on the results, state the relationship between distance d and the final temperature.'],
    ['(b)', 'Explain your answer in (a).']
  ]);
  for (const t of ['Question', '6 lines', '1.', 'Answers: (a) ? (b) ?', '(a) ? (b) ?', 'The experiment']) assert.ok(Q.LABEL_LINE_RE.test(t), t);
  for (const t of ['Ctrl + Enter checks', 'Press Enter to check', 'Show me the answer']) assert.ok(Q.CHROME_LINE_RE.test(t), t);
  for (const t of ['Model working', 'Stuck on (b)? Four small questions', 'Hint: think about heat']) assert.ok(Q.STOP_LINE_RE.test(t), t);
  // A real question line is never furniture.
  for (const t of ['(a) State one way to make the tea cooler. [1]', 'Which material is the best conductor of heat?', 'The table shows the results.']) {
    assert.ok(!Q.LABEL_LINE_RE.test(t) && !Q.CHROME_LINE_RE.test(t) && !Q.STOP_LINE_RE.test(t), t);
  }
});

test('🪄 the harvest bridge leaves the app’s help out: details, hint and model-working boxes, live regions', () => {
  const b = LA.HARVEST_BRIDGE;
  assert.match(b, /DETAILS\|SUMMARY\|KBD/);
  assert.match(b, /CHROME_WORDS = \/\^\(btn\|/, 'not "wand": the wand’s TARGET (#stage.wand-target) is the diagram');
  assert.ok(!/\|wand\|/.test(b.slice(b.indexOf('CHROME_WORDS'), b.indexOf('CHROME_WORDS') + 400)));
  assert.match(b, /hints\?\|tips\?\|help\|stuck\|scaffolds\?/);
  assert.ok(b.includes('model[\\s_-]*(working|answer|solution)'), 'a model-working box');
  assert.match(b, /aria-live/);
  assert.match(b, /if \(boxy\) buf \+= " ";/, 'an inline box is a word of its own ("Question" + "Mr Murthu")');
});

test('🪄 the bank’s painter keeps a gutter, a decorate hook and the working lines’ places — and paints a bank question as before', () => {
  const QB = fs.readFileSync(new URL('question-bank.js', ROOT), 'utf8');
  assert.match(QB, /function paintQuestion\(q, opts\) \{/);
  assert.match(QB, /var gutter = Math\.max\(0, Math\.min\(240, Number\(opts\.gutter\) \|\| 0\)\);/, 'no opts = no gutter = the bank question unchanged');
  assert.match(QB, /opts\.decorate\(ctx, \{ w: CW, h: h, contentW: PIC_W, pad: PIC_PAD, gutter: gutter \}\)/);
  assert.match(QB, /ruledOp\(b\.lines > 0 \? Math\.min\(OPEN_LINES_MAX \+ 4, b\.lines \| 0\) : 3, '', 0, b\.tag \? String\(b\.tag\) : ''\);/, 'a portal block keeps its three lines');
  assert.match(QB, /paintQuestion\(snap\)\.then/, 'the bank still calls it with no options');
});

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

test('the question goes on as ONE ordinary living app picture, never a new type, in one undo step', () => {
  const add = section('async function lappAddQuestion(cover, app, opts) {', '\n}\n');
  assert.equal((add.match(/pushUndo\(\);/g) || []).length, 1);
  assert.match(add, /type: 'ainote', kind: 'paste',[\s\S]{0,300}lapp: app, lq: qid/);
  assert.match(add, /lappSetCorner\(appAnn, pic\.corner\);/, 'the tiny wand’s corner, where the QR code goes on paper');
  assert.ok(!/type: 'line'|lineAnn|type: 'question'|kind: 'question'|kind: 'lq'/.test(add), 'no loose lines or boxes: the bank’s format, painted');
  // The model answers are the teacher's: no lq, no group, on the painted lines.
  const ans = add.slice(add.indexOf('// ✍ The model answers'), add.indexOf('selectedId = appAnn.id;'));
  assert.match(ans, /color: LQ\.ANSWER_COLOR/);
  assert.match(ans, /pic\.tags/);
  assert.ok(!/lq:|grp:/.test(ans), 'an answer is not part of the question');
  assert.match(add, /if \(!wheelTeacher\(\) \|\| practiceMode \|\| !pdfDoc \|\| pages\.indexOf\(page\) === -1\) return 0;/, 'asked again after painting');
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

/* ---- 📝 An app with no question block is READ as it is drawn (v1.180.0) ---- */
const SVG_DRAWN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 160" width="300" height="160"><rect x="10" y="10" width="120" height="80" style="fill:rgb(220,40,40);stroke:rgb(0,0,0)"/><text x="20" y="130" style="font-size:18px">Tank</text></svg>';
const HARVEST = {
  title: 'Ice Lab',
  blocks: [
    { kind: 'text', text: 'Ice Lab' },
    { kind: 'text', text: 'Tap the 🪄 magic wand to watch the ice melt.' },
    { kind: 'text', text: 'Ali left a beaker of ice in the sun.\nHe recorded its temperature every minute.' },
    { kind: 'svg', svg: SVG_DRAWN, w: 300, h: 160 },
    { kind: 'table', caption: 'Results', rows: [{ head: true, cells: ['Time / min', 'Temperature / °C'] }, { head: false, cells: ['0', '0'] }, { head: false, cells: ['5', '12'] }] },
    { kind: 'text', text: '(a) What state is the water in at 0 minutes? [1]' },
    { kind: 'text', text: '(b) Explain why the temperature rises after 4 minutes. (2 marks)' },
    { kind: 'png', src: 'data:image/png;base64,iVBORw0KGgo=', w: 200, h: 100 }
  ]
};

test('📝 specFromHarvest: the app’s words become the question and its parts, its pictures the figure', () => {
  const spec = Q.specFromHarvest({ title: 'Ice Lab', html: '<p>x</p>' }, HARVEST);
  assert.equal(spec.harvested, true);
  assert.equal(spec.stem, 'Ali left a beaker of ice in the sun.\nHe recorded its temperature every minute.', 'the heading and the wand line are not the question');
  assert.deepEqual(plain(spec.parts.map(p => [p.label, p.text, p.marks, p.lines])), [
    ['(a)', 'What state is the water in at 0 minutes?', 1, 2],
    ['(b)', 'Explain why the temperature rises after 4 minutes.', 2, 4]
  ]);
  assert.equal(spec.lines, 0, 'the working lines go under the parts');
  assert.deepEqual(plain(spec.graphics.map(g => g.kind)), ['svg', 'table', 'png'], 'every picture and table, in order');
  assert.equal(spec.figure, '');
  assert.match(Q.summary(spec).text, /2 parts · 6 working lines · 3 marks · 3 pictures/);
});

test('📝 a question with no parts gets working space by its marks, and a bare readout gets its title', () => {
  const one = Q.specFromHarvest({ title: 'Pulley' }, { blocks: [{ kind: 'text', text: 'How much force lifts the 40 kg load? [3]' }] });
  assert.equal(one.stem, 'How much force lifts the 40 kg load?');
  assert.equal(one.marks, 3);
  assert.equal(one.lines, 6);
  const bare = Q.specFromHarvest({ title: 'Magnet Lab' }, { blocks: [{ kind: 'text', text: 'N S' }] });
  assert.equal(bare.stem, 'Magnet Lab\nN S', 'too few words to stand alone: the title says what it is about');
  assert.equal(bare.lines, Q.DEFAULT_LINES);
  const pics = Q.specFromHarvest({ title: 'Circuit' }, { blocks: [{ kind: 'svg', svg: SVG_DRAWN, w: 300, h: 160 }] });
  assert.equal(pics.stem, 'Circuit');
  assert.equal(pics.graphics.length, 1);
  assert.equal(Q.specFromHarvest({ title: 'x' }, { blocks: [] }), null);
  assert.equal(Q.specFromHarvest({ title: 'x' }, null), null);
  // (1) (2) (3) (4) of a multiple choice are words, not parts.
  const mcq = Q.specFromHarvest({ title: 'MCQ' }, { blocks: [{ kind: 'text', text: 'Which is a conductor?\n(1) wood\n(2) copper' }] });
  assert.equal(mcq.parts.length, 0);
  assert.match(mcq.stem, /\(2\) copper/);
});

test('📝 cleanHarvest is the one door: scripts, handlers, http and odd data are dropped', () => {
  const h = Q.cleanHarvest({
    title: '<b>Lab</b>',
    blocks: [
      { kind: 'text', text: '<img src=x onerror=alert(1)>Hello' },
      { kind: 'svg', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect onclick="x()" width="5" height="5"/></svg>', w: 10, h: 10 },
      { kind: 'svg', svg: '<div>not svg</div>' },
      { kind: 'png', src: 'data:text/html;base64,PHA+', w: 1, h: 1 },
      { kind: 'png', src: 'data:image/png;base64,AAAA"onload="x', w: 1, h: 1 },
      { kind: 'url', src: 'http://example.com/a.png' },
      { kind: 'url', src: 'javascript:alert(1)' },
      { kind: 'url', src: 'https://example.com/a.png', w: 50, h: 40 },
      { kind: 'table', rows: [{ cells: ['<i>a</i>', 'x'.repeat(500)] }, { cells: [] }] },
      { kind: 'frame', src: 'x' },
      null
    ]
  });
  assert.equal(h.title, 'Lab');
  assert.equal(h.blocks[0].text, 'Hello');
  const svg = h.blocks.find(b => b.kind === 'svg').svg;
  assert.ok(!/script|onclick/i.test(svg), svg);
  assert.equal(h.blocks.filter(b => b.kind === 'svg').length, 1);
  assert.equal(h.blocks.filter(b => b.kind === 'png').length, 0);
  assert.deepEqual(plain(h.blocks.filter(b => b.kind === 'url').map(b => b.src)), ['https://example.com/a.png']);
  const t = h.blocks.find(b => b.kind === 'table');
  assert.equal(t.rows.length, 1);
  assert.equal(t.rows[0].cells[0], 'a');
  assert.ok(t.rows[0].cells[1].length <= 200);
  // At most HARVEST_GRAPHICS_MAX pictures, however many the app draws.
  const many = Q.cleanHarvest({ blocks: Array.from({ length: 20 }, () => ({ kind: 'svg', svg: SVG_DRAWN, w: 30, h: 30 })) });
  assert.equal(many.blocks.length, Q.HARVEST_GRAPHICS_MAX);
});

test('📝 mergeHarvest: a block keeps its words; one with no figure borrows the app’s pictures', () => {
  const withFig = Q.cleanSpec({ stem: 'Look at the diagram.', figure: FIGURE });
  assert.equal(Q.needsHarvest(withFig), false, 'a block with a figure never runs the app');
  assert.equal(Q.mergeHarvest(withFig, { title: 'x' }, HARVEST), withFig);
  const noFig = Q.cleanSpec({ stem: 'Use the table in the app.', parts: [{ text: 'Name it.', lines: 2 }] });
  assert.equal(Q.needsHarvest(noFig), true);
  const m = Q.mergeHarvest(noFig, { title: 'x' }, HARVEST);
  assert.equal(m.stem, 'Use the table in the app.', 'the block’s own words win');
  assert.equal(m.parts.length, 1);
  assert.deepEqual(plain(m.graphics.map(g => g.kind)), ['svg', 'table', 'png']);
  assert.equal(noFig.graphics, undefined, 'never edits its input');
  const fb = Q.fallbackSpec({ title: 'Ice Lab' });
  assert.equal(Q.needsHarvest(fb), true);
  assert.equal(Q.mergeHarvest(fb, { title: 'Ice Lab' }, HARVEST).harvested, true);
  assert.equal(Q.mergeHarvest(fb, { title: 'Ice Lab' }, null), fb, 'nothing read: the title as before');
});

test('📝 composeBoxes sets pictures side by side in rows, never overlapping, never wider than the row', () => {
  const p = Q.composeBoxes([{ w: 600, h: 300 }, { w: 500, h: 400 }, { w: 900, h: 200 }, { w: 3000, h: 1500 }], 1400, 32);
  assert.ok(p.w <= 1400);
  p.boxes.forEach((b, i) => {
    assert.ok(b.x >= 0 && b.x + b.w <= p.w && b.y >= 0 && b.y + b.h <= p.h, 'inside: ' + i);
    p.boxes.forEach((c, j) => {
      if (i >= j) return;
      const apart = b.x + b.w <= c.x || c.x + c.w <= b.x || b.y + b.h <= c.y || c.y + c.h <= b.y;
      assert.ok(apart, 'boxes ' + i + ' and ' + j + ' overlap');
    });
  });
  assert.ok(p.boxes[1].x > p.boxes[0].x && p.boxes[1].y < p.boxes[0].y + p.boxes[0].h, 'two that fit share a row');
  assert.ok(p.boxes[2].y > p.boxes[0].y, 'one that does not starts the next');
  assert.ok(Math.abs(p.boxes[3].w / p.boxes[3].h - 2) < 0.02, 'a big picture is shrunk in proportion');
  const cols = Q.tableColumns([{ cells: ['a', 'x'.repeat(100)] }], t => t.length * 10);
  assert.ok(cols[0] >= 70 && cols[1] <= 380);
  assert.deepEqual(plain(Q.wrapCell('one two three four', 100, t => t.length * 10)), ['one two', 'three four']);
});

test('📝 the harvest bridge: inside the sandbox, after the wand, before the author, answering only its parent', () => {
  const doc = LA.sandboxDocument('<p>app</p>');
  const csp = doc.indexOf('Content-Security-Policy'), wand = doc.indexOf('polymath:wand'), harvest = doc.indexOf('harvest-result'), author = doc.indexOf('<p>app</p>');
  assert.ok(csp > 0 && csp < wand && wand < harvest && harvest < author, 'trusted head first');
  const B = LA.HARVEST_BRIDGE;
  assert.ok(!/<\/script/i.test(B), 'cannot close its own script tag');
  assert.match(B, /if \(e\.source !== parent\) return;/);
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|innerHTML\s*=/.test(B), 'reads and replies, nothing else');
  assert.match(B, /data-polymath-skip/);
  assert.match(B, /BUTTON\|INPUT\|SELECT\|TEXTAREA/, 'controls are not the question');
  new Function(B);   // it parses
  // The frame it runs in: the stage's own sandbox, never same-origin, on screen but invisible.
  const h = LA_SRC.slice(LA_SRC.indexOf('function harvest(html, opts)'), LA_SRC.indexOf('var api = {'));
  assert.match(h, /f\.setAttribute\('sandbox', 'allow-scripts'\);/);
  assert.ok(!/allow-same-origin/.test(h));
  assert.match(h, /f\.srcdoc = sandboxDocument\(html\);/);
  assert.match(h, /e\.source !== f\.contentWindow/);
  assert.ok(/position:fixed;left:0;top:0;/.test(h) && /opacity:0;pointer-events:none/.test(h), 'on the screen, or the browser throttles its drawing');
  assert.match(h, /if \(f\.parentNode\) f\.parentNode\.removeChild\(f\);/, 'always taken down');
});

test('📝 the glue reads the app before it falls back to the cover, for a question and for a plain app', () => {
  const qf = section('async function lappPictureFor(app, cover, asQuestion, say) {', '\n}\n');
  assert.match(qf, /LQ\.needsHarvest\(spec\)[\s\S]{0,200}window\.LivingApps\.harvest\(app\.html\)/);
  assert.match(qf, /spec = LQ\.mergeHarvest\(spec, app, raw\);/);
  assert.match(qf, /asQuestion \? await window\.LivingQuestion\.paintQuestionPicture\(spec\) : await window\.LivingQuestion\.paintAppPicture\(app, spec\)/);
  assert.match(qf, /pic: painted \? pic : cover/, 'the plain cover only when nothing could be painted');
  const add = section('async function lappAddQuestion(cover, app, opts) {', '\n}\n');
  assert.match(add, /var got = await lappPictureFor\(app, cover, true, true\);/);
  assert.ok(add.indexOf('lappPictureFor') < add.indexOf('if (!wheelTeacher() || practiceMode || !pdfDoc || pages.indexOf(page) === -1) return 0;'), 'asked again after the app was read');
  const page = section('function lappAddToPage(cover, app) {', '\n}\n');
  assert.match(page, /lappSetCorner\(a, cover\.corner\);/);
  assert.match(page, /lappRepaintLater\(a\.id, app, cover, false\);/, '➕ Add to page swaps in what the app draws');
  const later = section('function lappRepaintLater(id, app, cover, asQuestion) {', '\n}\n');
  assert.match(later, /if \(!cur \|\| cur\.lapp !== app \|\| !wheelTeacher\(\) \|\| practiceMode\) return;/, 'a late picture never lands on another app or another person’s page');
  const upd = section('function lappUpdateOnPage(id, cover, app) {', '\n}\n');
  assert.match(upd, /lappRepaintLater\(a\.id, app, cover, annLivingQuestion\(a\)\);/, 'a changed app repaints what it draws');
  assert.match(HTML, /window\.QuestionBank\.pure\.qrMatrix, window\.QuestionBank\.pure\.qrRuns, a\.lqr\);/, 'the corner reaches the PDF');
});
