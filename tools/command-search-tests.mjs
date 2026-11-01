// 🔎 Command search (v1.170.0): the matching, run without a page.
//   node --test tools/command-search-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../command-search.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const P = ctx.window.CommandSearch.pure;

/* A toolbar much like the real one, described the way collect() would. */
const S = P.SYNONYMS;
const raw = [
  ['tool:select', 'Select / move', 'Select / move — double-click an element to edit it', 'V'],
  ['tool:lasso', 'Lasso', 'Lasso — circle several things, then duplicate or resize them', 'S'],
  ['tool:penselect', 'Pen select', 'Pen select — click to place points', 'Shift+S'],
  ['tool:highlight', 'Highlighter', 'Highlighter', 'H'],
  ['tool:pen', 'Pencil', 'Pencil', 'P'],
  ['tool:text', 'Text box', 'Text box', 'T'],
  ['tool:ellipse', 'Ellipse', 'Ellipse', 'O'],
  ['tool:rect', 'Rectangle', 'Rectangle', 'R'],
  ['tool:eraser', 'Eraser', 'Eraser — drag across ink to erase it', 'E'],
  ['tool:keyword', 'Mark keywords', 'Mark keywords — click words in a text box', 'K'],
  ['#undoBtn', 'Undo', 'Undo', 'Ctrl+Z'],
  ['#redoBtn', 'Redo', 'Redo', 'Ctrl+Y'],
  ['color:#e53935', 'Colour: Red', 'Red', ''],
  ['#zoomInBtn', 'Zoom in', 'Zoom in', '+'],
  ['#zoomOutBtn', 'Zoom out', 'Zoom out', '−'],
  ['#printQBtn', 'Print questions', 'Print questions — the worksheet on its own', 'Ctrl+P'],
  ['#printABtn', 'Print answers', 'Print answers — the worksheet with all the workings', 'Ctrl+Shift+P'],
  ['#keyPdfBtn', 'Answer key PDF', 'Answer key — AI reads the blank worksheet', ''],
  ['#rewardBtn', 'Award marks', 'Award marks — hand marks to this class', 'B'],
  ['#wheelBtn', 'Name wheel', 'Name wheel — call on every student once per round', 'Z'],
  ['#mmBtn', 'Mindmap', 'Mindmap — a board you can drag anywhere', 'Y'],
  ['#calcBtn', 'Calculator', 'Calculator — fractions, powers and roots', 'K'],
  ['#fsBtn', 'Full screen', 'Full screen — hide the banner and toolbar', 'Shift+F'],
  ['#blankPageBtn', 'Blank page', 'Add a blank page after the current page', ''],
  ['#snipBtn', 'Snip and pin', 'Snip and pin — drag over part of the page', 'Shift+A'],
  ['#shareBtn', 'Share', 'Share — copy a link students can open', ''],
  ['#saveBtn', 'Save', 'Save PDF + annotations to the cloud', 'Ctrl+S']
];
const cmds = raw.map(([key, label, description, shortcut]) => ({ key, label, description, shortcut, where: '', synonyms: S[key] || '' }));
const prepared = cmds.map(P.prepare);
const top = (q, recent) => { const r = P.rank(prepared, q, recent || [], 8); return r.length ? r[0].p.cmd.key : ''; };
const keys = (q) => JSON.parse(JSON.stringify(P.rank(prepared, q, [], 8).map((r) => r.p.cmd.key)));

test('the obvious name finds its button first', () => {
  assert.equal(top('lasso'), 'tool:lasso');
  assert.equal(top('eraser'), 'tool:eraser');
  assert.equal(top('calculator'), 'tool:calc' === 'x' ? '' : '#calcBtn');
  assert.equal(top('undo'), '#undoBtn');
  assert.equal(top('mindmap'), '#mmBtn');
});

test('the words a teacher says, not the words on the button', () => {
  assert.equal(top('rubber'), 'tool:eraser');
  assert.equal(top('pen'), 'tool:pen', 'pen is the pencil, ahead of Pen select');
  assert.equal(top('circle'), 'tool:ellipse');
  assert.equal(top('spin names'), '#wheelBtn');
  assert.equal(top('random student'), '#wheelBtn');
  assert.equal(top('mind map'), '#mmBtn');
  assert.equal(top('select many'), 'tool:lasso');
  assert.equal(top('screenshot'), '#snipBtn');
  assert.equal(top('new page'), '#blankPageBtn');
  assert.equal(top('marks'), '#rewardBtn');
  assert.equal(top('answer key'), '#keyPdfBtn');
  assert.equal(top('print worksheet'), '#printQBtn');
  assert.equal(top('fullscreen'), '#fsBtn');
});

test('phrases: every word must match, and the closest phrase wins', () => {
  assert.equal(top('print answers'), '#printABtn');
  assert.equal(top('print questions'), '#printQBtn');
  assert.deepEqual(keys('print banana'), [], 'a word that matches nothing rules the button out');
  assert.equal(top('zoom in'), '#zoomInBtn');
  assert.equal(top('zoom out'), '#zoomOutBtn');
});

test('typos and half-typed words still find it', () => {
  assert.equal(top('lasoo'), 'tool:lasso');
  assert.equal(top('las'), 'tool:lasso');
  assert.equal(top('erasr'), 'tool:eraser');
  assert.equal(top('calcu'), '#calcBtn');
  assert.equal(top('highlihgt'), 'tool:highlight');
  assert.equal(top('mindmpa'), '#mmBtn');
});

test('British and American spellings and plurals fold together', () => {
  assert.equal(top('red color'), 'color:#e53935');
  assert.equal(top('red colour'), 'color:#e53935');
  assert.equal(top('red'), 'color:#e53935', 'red is the colour, not the start of Redo');
  assert.equal(P.stem('keywords'), 'keyword');
  assert.equal(P.stem('colours'), 'color');
  assert.equal(P.stem('glass'), 'glass');
});

test('initials and shortcuts', () => {
  assert.equal(top('pa'), '#printABtn');
  assert.equal(top('fs'), '#fsBtn');
  assert.equal(top('shift+s'), 'tool:penselect');
  assert.equal(top('ctrl+shift+p'), '#printABtn');
});

test('filler words are ignored', () => {
  assert.equal(top('where is the lasso'), 'tool:lasso');
  assert.equal(top('open the calculator please'), '#calcBtn');
});

test('nothing typed: the recently used, newest first', () => {
  const r = JSON.parse(JSON.stringify(P.rank(prepared, '', ['#mmBtn', 'tool:lasso', 'gone:button'], 8).map((x) => x.p.cmd.key)));
  assert.deepEqual(r, ['#mmBtn', 'tool:lasso']);
  assert.deepEqual(P.rank(prepared, '   ', [], 8).length, 0);
});

test('recent use lifts a tie, never a better match', () => {
  assert.equal(top('zoom'), '#zoomInBtn');
  assert.equal(top('zoom', ['#zoomOutBtn']), '#zoomOutBtn', 'a tie goes to the one used lately');
  assert.equal(top('lasso', ['tool:penselect']), 'tool:lasso', 'recency cannot beat a better match');
});

test('one button is offered once, and the list is capped', () => {
  const dup = prepared.concat([P.prepare(cmds[1])]);
  const r = P.rank(dup, 'lasso', [], 8).map((x) => x.p.cmd.key);
  assert.equal(r.filter((k) => k === 'tool:lasso').length, 1);
  assert.ok(P.rank(prepared, 'e', [], 3).length <= 3);
});

test('edit distance and subsequence are the textbook ones', () => {
  assert.equal(P.editDistance('lasso', 'lasso', 2), 0);
  assert.equal(P.editDistance('lasoo', 'lasso', 2), 1);
  assert.equal(P.editDistance('mindmpa', 'mindmap', 2), 1, 'a swap is one edit');
  assert.equal(P.editDistance('abc', 'xyzxyz', 1), 2, 'stops early past the limit');
  assert.ok(P.subsequence('hlt', 'highlight'));
  assert.ok(!P.subsequence('tlh', 'highlight'));
});

test('marks fall on whole-word starts, merged', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(P.markRanges('Print answers', 'print ans'))), [[0, 5], [6, 9]]);
  assert.deepEqual(JSON.parse(JSON.stringify(P.markRanges('Lasso', 'ass'))), []);
});

test('recent list is bounded and deduplicated', () => {
  let r = [];
  for (let i = 0; i < 20; i++) r = P.pushRecent(r, 'k' + i);
  assert.equal(r.length, P.RECENT_MAX);
  assert.equal(r[0], 'k19');
  r = P.pushRecent(r, 'k15');
  assert.equal(r[0], 'k15');
  assert.equal(r.filter((k) => k === 'k15').length, 1);
});

test('a button is named by its painted label, or a short tooltip that says more', () => {
  assert.equal(P.labelFrom({ btnLabel: 'Answers', tip: 'Print answers — the worksheet with all the workings' }), 'Print answers');
  assert.equal(P.labelFrom({ btnLabel: 'Blank page', tip: 'Add a blank page after the current page — somewhere to paste' }), 'Blank page');
  assert.equal(P.labelFrom({ tip: 'Lasso — circle several things' }), 'Lasso');
  assert.equal(P.labelFrom({ tip: 'Text, vision and thinking: ChatGPT gpt-6.1-sol by default, then Gemini', text: 'AI Engine' }), 'AI Engine');
  assert.equal(P.labelFrom({ text: '📚 Syllabus' }), 'Syllabus');
  assert.equal(P.labelFrom({ btnLabel: 'Reward', tip: 'Award marks — hand marks to this class' }), 'Award marks');
  assert.equal(P.labelFrom({ dataLabel: 'Pages', tip: 'Show / hide page thumbnails — drag the panel edge' }), 'Show / hide page thumbnails');
});

test('the page wires it: a toolbar button with no id, Ctrl+K and /, a role change closes it', () => {
  assert.match(html, /<button class="toolBtn cmdSearchBtn" type="button" data-key="Ctrl\+K"/);
  assert.doesNotMatch(html, /cmdSearchBtn" id=/, 'no id: the favourites bar must not offer it');
  assert.match(html, /e\.key\.toLowerCase\(\) === 'k'\) \{\s*e\.preventDefault\(\);\s*if \(typeof cmdSearchOpen/);
  assert.match(html, /e\.key === '\/' && !e\.ctrlKey/);
  assert.match(html, /cmdSearchRoleChanged\(\);/);
  assert.match(html, /<script src="command-search\.js"><\/script>\s*<script>cmdSearchInit\(\);<\/script>/);
  // The Ctrl+K check must come before the "typing in a box" return, and "/" after it.
  const k = html.indexOf("e.key.toLowerCase() === 'k') {\n    e.preventDefault();\n    if (typeof cmdSearchOpen");
  const editing = html.indexOf('  if (editingText) {\n    if (e.key === \'Escape\') ae.blur();');
  const slash = html.indexOf("if (e.key === '/' && !e.ctrlKey");
  assert.ok(k > 0 && editing > k && slash > editing);
});

test('a press is the button\'s own click, and every key stops in the box', () => {
  assert.match(src, /el\.click\(\);/);
  assert.match(src, /root\.addEventListener\('keydown', function \(e\) \{\s*if \(root\.hidden\) return;[^\n]*\n\s*e\.stopPropagation\(\);/);
  assert.doesNotMatch(src, /setTool\(|innerHTML\s*=\s*c\./, 'never a second way to press, never a label as markup');
});
