/* =====================================================================
   📚 QUESTION BANK — the arithmetic and the rules, without a browser.
   tools/question-bank-check.mjs drives the real page; this pins what can
   be pinned from the module and the page's source alone.
     node --test tools/question-bank-tests.mjs
   ===================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const html = read('index.html');
const ctx = { console, URL };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(read('vendor/qrcode-generator.js'), ctx);
vm.runInContext(read('question-apps.js'), ctx);
vm.runInContext(read('question-bank.js'), ctx);
const QB = ctx.QuestionBank;
const P = QB.pure;
const plain = v => JSON.parse(JSON.stringify(v));

test('the module loads on its own and exposes its parts', () => {
  assert.equal(typeof QB.create, 'function');
  assert.equal(typeof QB.paintQuestion, 'function');
  assert.equal(typeof QB.drawQrOnPdf, 'function');
  assert.ok(Object.isFrozen(QB) && Object.isFrozen(P));
});

test('question-apps.js is the portal’s own file, byte for byte', () => {
  const ours = read('question-apps.js');
  let theirs = null;
  try { theirs = fs.readFileSync(new URL('../../polymathlc/cer/question-apps.js', import.meta.url), 'utf8'); } catch (e) {}
  if (theirs == null) { try { theirs = fs.readFileSync(new URL('../../cer/question-apps.js', import.meta.url), 'utf8'); } catch (e) {} }
  if (theirs != null) assert.equal(ours, theirs, 'question-apps.js has drifted from polymathlc/cer');
  // The sandbox the apps run in must be the portal's: scripts and nothing else.
  assert.match(ours, /sandbox="allow-scripts"/);
  assert.match(ours, /connect-src 'none'/);
});

test('stripHtml reads what a person would read', () => {
  assert.equal(P.stripHtml('<p>Water <b>boils</b> at 100&deg;C</p><p>Next</p>'), 'Water boils at 100°C\nNext');
  assert.equal(P.stripHtml('a<br>b&nbsp;&nbsp;c'), 'a\nb c');
  assert.equal(P.stripHtml('<script>alert(1)</script>Safe'), 'Safe');
  assert.equal(P.stripHtml(null), '');
  assert.equal(P.decodeEntities('&#65;&#x42;&amp;&unknown;'), 'AB&&unknown;');
});

test('parts are drawn from the block, letter then roman, and nothing else', () => {
  assert.equal(P.partOpens({ type: 'text', part: 'a' }), '(a)');
  assert.equal(P.partOpens({ type: 'text', part: 'b', subPart: 'ii' }), '(b)(ii)');
  assert.equal(P.partOpens({ type: 'text', subPart: 'iii' }), '(iii)');
  assert.equal(P.partOpens({ type: 'part', label: '(c)' }), '(c)');
  assert.equal(P.partOpens({ type: 'text', part: 'Part 1' }), '');
  assert.equal(P.partOpens({ type: 'text', part: 'z' }), '');
  assert.equal(P.marksOf({ marks: '2' }), 2);
  assert.equal(P.marksOf({ marks: 0 }), 0);
  assert.equal(P.marksOf({ marks: 99 }), 0);
});

test('a run of blanks is one blank, and a blank is marked fairly', () => {
  const segs = plain(P.fbSegments('Plants make [[glucose]] from [[carbon]] [[dioxide]] and water.'));
  assert.deepEqual(segs.map(s => s.type), ['text', 'blank', 'text', 'blank', 'text']);
  assert.equal(segs[3].answer, 'carbon dioxide');
  assert.equal(P.fbHasBlanks({ type: 'fillblank', text: 'no blanks' }), false);
  assert.equal(P.fbHasBlanks({ type: 'fillblank', text: 'a [[b]]' }), true);
  assert.ok(P.blankCorrect(' Evaporates. ', 'evaporates'));
  assert.ok(P.blankCorrect('evaporation', 'evaporate / evaporation'));
  assert.ok(!P.blankCorrect('', 'x'));
  assert.ok(!P.blankCorrect('melts', 'condenses'));
});

test('options are numbered for primary and lettered for secondary', () => {
  assert.equal(P.mcqStyle({}), 'numbers');
  assert.equal(P.mcqStyle({ level: 'Sec 1' }), 'letters');
  assert.equal(P.mcqStyle({ level: 'P5', mcqLabels: 'letters' }), 'letters');
  assert.equal(P.mcqLabel(2, 'numbers'), '3');
  assert.equal(P.mcqLabel(2, 'letters'), 'C');
  assert.equal(P.mcqOptionText('(3)', 2, 'letters'), '(C)');
  assert.equal(P.mcqOptionText('(3)', 1, 'letters'), '(3)', 'a marker naming another option is the author’s words');
  assert.equal(P.mcqOptionText('Iron', 0, 'numbers'), 'Iron');
});

test('a table reads the same however the portal saved it', () => {
  const fromFirestore = P.tableGrid({ cols: 2, data: { 0: { 0: 'A', 1: 'B' }, 1: { 0: 'C', 1: 'D' } }, colWidths: { 0: 100 } });
  assert.deepEqual(plain(fromFirestore.rows), [['A', 'B'], ['C', 'D']]);
  assert.equal(fromFirestore.cols, 2);
  const legacy = P.tableGrid({ cols: 2, headers: ['H1', 'H2'], data: [['x', 'y']], merges: [{ sr: 0, sc: 0, er: 0, ec: 1 }] });
  assert.deepEqual(plain(legacy.rows), [['H1', 'H2'], ['x', 'y']]);
  assert.deepEqual(plain(legacy.merges), [{ sr: 1, sc: 0, er: 1, ec: 1 }], 'the merge moves down with the folded header');
  const cells = P.tableCells(legacy);
  assert.equal(cells[1][0].cs, 2);
  assert.equal(cells[1][1], null);
  const w = P.columnWidths({ cols: 3, widths: [100, 0, 300] }, 600);
  assert.equal(Math.round(w.reduce((a, b) => a + b, 0)), 600);
  assert.ok(w[2] > w[0] && Math.abs(w[1] - 200) < 1, 'a column with no width takes the average');
});

const BANK = [
  { id: 'a', title: 'Magnets', topic: 'Magnets', updatedAt: 1, blocks: [{ type: 'text', content: 'Which is magnetic?' }, { type: 'mcq', options: [{ id: '1', text: 'Iron' }], correctId: '1' }] },
  { id: 'b', title: '', topic: 'Water', topic2: 'Heat', updatedAt: 5, blocks: [{ type: 'fillblank', text: 'Water [[evaporates]] in the sun.' }, { type: 'widget', html: '<p>app</p>' }] },
  { id: 'c', title: 'States of matter', topic: 'Matter', createdAt: { seconds: 9 }, blocks: [{ type: 'text', content: 'Describe a gas.' }, { type: 'plainanswer', content: 'No fixed shape.' }] },
  { id: 'd', title: 'Empty', topic: 'Matter', blocks: [] }
];

test('search needs every word, reads the question itself, and finds by the missing word', () => {
  const ids = q => plain(P.filterQuestions(BANK, q)).map(x => x.id);
  assert.deepEqual(ids({}), ['c', 'b', 'a'], 'newest first, and an empty question is never offered');
  assert.deepEqual(ids({ query: 'magnetic' }), ['a']);
  assert.deepEqual(ids({ query: 'states gas' }), ['c']);
  assert.deepEqual(ids({ query: 'states liquid' }), [], 'every word must match — an OR returns half the bank');
  assert.deepEqual(ids({ query: 'evaporates' }), ['b']);
  assert.deepEqual(ids({ topic: 'Heat' }), ['b'], 'the second topic counts');
  assert.deepEqual(ids({ only: 'app' }), ['b']);
  assert.deepEqual(ids({ only: 'mcq' }), ['a']);
  assert.deepEqual(ids({ only: 'open' }), ['c']);
  assert.deepEqual(plain(P.allTopics(BANK)), ['Heat', 'Magnets', 'Matter', 'Water']);
  assert.equal(P.questionTitle(BANK[1]), 'Water ____ in the sun.', 'an untitled question is named by its words, blank hidden');
});

test('the snapshot is a copy, slim, and keeps an app that fits', () => {
  const big = { id: 'w', title: 'Big app', topic: 'X', mcqLabels: 'letters', blocks: [
    { type: 'text', content: 'Q' },
    { type: 'widget', html: 'x'.repeat(P.WIDGET_MAX_CHARS + 1), appUrl: 'https://example.com', prompt: 'build me' },
    { type: 'widget', html: '<b>small</b>', history: [1, 2] },
    { type: 'table', cols: 1, data: { 0: { 0: 'cell' } } },
    null
  ] };
  const s = P.snapshotQuestion(big, 'owner-1');
  assert.equal(s.owner, 'owner-1');
  assert.equal(s.mcqLabels, 'letters');
  assert.equal(s.blocks.length, 4, 'a null block is dropped');
  assert.equal(s.blocks[1].html, '', 'an app too large to ride along travels as its link');
  assert.equal(s.blocks[1].tooBig, true);
  assert.equal(s.blocks[1].prompt, undefined, 'the build prompt is the editor’s, not the worksheet’s');
  assert.equal(s.blocks[2].html, '<b>small</b>');
  assert.equal(s.blocks[2].history, undefined);
  assert.deepEqual(plain(s.blocks[3].data), [['cell']]);
  s.blocks[0].content = 'changed';
  assert.equal(big.blocks[0].content, 'Q', 'editing the copy never edits the bank');
  assert.ok(P.validSnapshot(s));
  assert.ok(!P.validSnapshot({ blocks: [] }));
  assert.ok(!P.validSnapshot(null));
  assert.ok(P.hasApp(s));
});

test('only http(s) and inline pictures are ever loaded or linked', () => {
  assert.equal(P.safeUrl('javascript:alert(1)'), '');
  assert.equal(P.safeUrl('data:text/html,<b>'), '');
  assert.equal(P.safeUrl('data:image/png;base64,AAA', true), 'data:image/png;base64,AAA');
  assert.equal(P.safeUrl('data:image/png;base64,AAA', false), '');
  assert.equal(P.safeUrl(' https://x.y/a.png '), 'https://x.y/a.png');
  assert.equal(P.imageUrl('https://drive.google.com/file/d/ABC/view'), 'https://drive.google.com/uc?export=view&id=ABC');
  assert.equal(P.imageUrl('https://www.dropbox.com/s/x/a.png?dl=0'), 'https://dl.dropboxusercontent.com/s/x/a.png');
  assert.equal(P.cleanStyle('color:red;background:url(javascript:x)'), '');
  assert.equal(P.cleanStyle('color:red;position:fixed;font-weight:bold'), 'color:red;font-weight:bold');
});

test('without a DOM the sanitiser still refuses to pass markup through', () => {
  // The module's sanitiser parses in a document; with none it falls back to
  // escaped text, never to the raw string.
  const out = QB.questionHtml({ blocks: [{ type: 'text', content: '<img src=x onerror=alert(1)>Hi' }] }, null, { readOnly: true });
  assert.ok(!/<img/i.test(out) && !/onerror=alert/.test(out.replace(/&[a-z]+;/g, '')), out);
});

test('a question lands on the paper, in its own shape, stepped off the last', () => {
  const box = P.placeOnPage(600, 800, 1.5, 0, 50);
  assert.ok(Math.abs(box.w / box.h - 1.5) < 0.01);
  assert.ok(box.x >= 4 && box.x + box.w <= 596 && box.y >= 4 && box.y + box.h <= 796);
  assert.equal(box.y, 50);
  const tall = P.placeOnPage(600, 800, 0.2, 0, 0);
  assert.ok(tall.h <= 800 * 0.9 + 0.01, 'never taller than the paper');
  assert.ok(Math.abs(tall.w / tall.h - 0.2) < 0.01, 'and still its own shape');
  const second = P.placeOnPage(600, 800, 1.5, 1, 50);
  assert.ok(second.y > box.y, 'a second question does not land on the first');
  const low = P.placeOnPage(600, 800, 1.5, 0, 790);
  assert.ok(low.y + low.h <= 796, 'scrolled to the bottom, it is pulled back onto the page');
});

test('the QR code is real, in the top-right corner, and refuses a link too long to scan', () => {
  const url = 'https://polymathlc.github.io/anskey/?share=abcDEF123';
  const m = P.qrMatrix(url, ctx.qrcode);
  assert.ok(m && m.length >= 21 && m.length % 4 === 1, 'a QR code is 21, 25, 29… modules square');
  assert.ok(m[0][0] && m[0][6] && m[6][0], 'the finder pattern is in the corner');
  const runs = plain(P.qrRuns(m));
  const dark = m.flat().filter(Boolean).length;
  assert.equal(runs.reduce((a, r) => a + r.len, 0), dark, 'the runs cover every dark module exactly once');
  assert.equal(P.qrMatrix('x'.repeat(700), ctx.qrcode), null);
  assert.equal(P.qrMatrix('', ctx.qrcode), null);
  const at = P.qrPlacement(595, 842, 64);
  assert.ok(at.x + at.size <= 595 - 10 && at.y + at.size <= 842 - 10 && at.x > 400 && at.y > 700);
  assert.ok(at.labelY < at.y, 'the label sits under the code');
});

test('the QR code is drawn as squares with a link over it', () => {
  const rects = [], texts = [];
  let annots = null;
  const pageStub = {
    getWidth: () => 595, getHeight: () => 842,
    drawRectangle: r => rects.push(r), drawText: (t, o) => texts.push(t),
    node: { lookup: () => annots, set: (k, v) => { annots = v; } }
  };
  const lib = { rgb: (r, g, b) => ({ r, g, b }), PDFString: { of: s => ({ s }) }, PDFName: { of: s => s } };
  const docStub = { context: { obj: o => o, register: o => ({ ref: o }) } };
  const font = { widthOfTextAtSize: t => t.length * 3 };
  const url = 'https://example.com/?share=1';
  // drawQrOnPdf reads the global qrcode, which is the vendor copy loaded above.
  const drew = QB.drawQrOnPdf(docStub, pageStub, url, lib, font);
  assert.equal(drew, true);
  assert.ok(rects.length > 40, rects.length + ' rectangles');
  assert.deepEqual(texts, [P.QR_LABEL]);
  assert.ok(Array.isArray(annots) && annots[0].ref.A.URI.s === url);
  assert.equal(QB.drawQrOnPdf(docStub, pageStub, '', lib, font), false);
});

test('✓ Check marks options and blanks, and ✨ Mark is asked about the written answers only', () => {
  const q = { blocks: [
    { id: 'm', type: 'mcq', correctId: 'o2', options: [{ id: 'o1' }, { id: 'o2' }] },
    { id: 'f', type: 'fillblank', text: 'A [[b]] c [[d]]' },
    { id: 'c', type: 'answer', part: 'a', marks: 3, claim: 'C', evidence: 'E', reasoning: 'R' },
    { id: 'p', type: 'plainanswer', content: '<p>Roots</p>' }
  ] };
  const st = { mcq: { m: 'o2' }, blanks: { f: ['B', 'x'] }, text: { 'c:claim': 'my claim', 'p:a': 'roots' } };
  assert.deepEqual(plain(P.markState(q, st)), { right: 2, total: 3 });
  const items = plain(P.openItems(q, st));
  assert.equal(items.length, 2);
  assert.equal(items[0].part, '(a)');
  assert.equal(items[0].cer[0].student, 'my claim');
  assert.equal(items[1].model, 'Roots');
  const prompt = P.markPrompt(q, items);
  assert.match(prompt, /model: Roots/);
  assert.match(prompt, /Return ONLY JSON/);
  assert.equal(P.scoreLine(2, 3), '2 of 3 correct');
  assert.equal(P.scoreLine(1, 1), 'Correct!');
  assert.equal(P.scoreLine(4, 4), 'All 4 correct!');
  assert.equal(P.scoreLine(0, 0), '');
  assert.deepEqual(plain(P.parseJsonLoose('```json\n{"items":[]}\n```')), { items: [] });
  assert.deepEqual(plain(P.parseJsonLoose('Sure! {"a":1} thanks')), { a: 1 });
  assert.equal(P.parseJsonLoose('nope'), null);
});

test('every picture the question names is fetched for its picture, and only those', () => {
  const urls = plain(P.questionImageUrls({ blocks: [
    { type: 'image', url: 'https://a/1.png' },
    { type: 'text', content: '<p><img src="https://a/2.png"> and <img src="javascript:x"></p>' },
    { type: 'mcq', options: [{ text: '<img src="https://a/1.png">' }, { image: 'https://a/3.png' }] },
    { type: 'answerKey', url: 'https://a/answer.png' }
  ] }));
  assert.deepEqual(urls, ['https://a/1.png', 'https://a/2.png', 'https://a/3.png'], 'the answer diagram is never on the page');
});

/* ---------------- the page's half ---------------- */
test('a bank question is a pasted picture, and nothing new for the nine places to learn', () => {
  assert.match(html, /function annBankQ\(a\) \{\s*return annPastePic\(a\) && !!a\.bq/);
  assert.match(html, /kind: 'paste',[\s\S]{0,400}bq: snap/);
  assert.ok(!/kind:\s*'bankq'/.test(html), 'no new annotation kind');
});

test('the teacher’s controls are the teacher’s, and asked again in the handlers', () => {
  assert.match(html, /var TEACHER_TOOLBAR_IDS = \[[^\]]*'bankQBtn', (?:'livingAppBtn', )?'printQrBtn'/);
  assert.match(html, /\$\('bankQBtn'\)\.addEventListener\('click', function \(\) \{\s*if \(!wheelTeacher\(\)\) return;/);
  assert.match(html, /\$\('printQrBtn'\)\.addEventListener\('click', function \(\) \{\s*if \(!wheelTeacher\(\)\) return;/);
  assert.match(html, /function bankQAddToPage\(pic, snap\) \{\s*if \(!wheelTeacher\(\)\)/);
  assert.match(html, /function printQrUrl\(\) \{\s*if \(!printQrOn \|\| !wheelTeacher\(\)\) return '';/);
});

test('a tap opens the question for a student, but a pen in a writer’s hand still writes', () => {
  const at = html.indexOf("var bqHost = e.target.closest ? e.target.closest('[data-bq]')");
  const ro = html.indexOf('if (isStudent() && !reviseMode && !practiceMode) return;');
  assert.ok(at > 0 && ro > at, 'the tap is handled before a read-only student is turned away');
  const seg = html.slice(at, ro);
  assert.match(seg, /bqCanDraw && isDrawTool\(tool\)/);
  assert.match(seg, /bankQOpen\(bqAnn\.id, false\)/);
});

test('the questions print keeps the bank questions, practice keeps them locked, and the QR code is opt-in', () => {
  assert.match(html, /(?:anns|printAnns)\s*[:=] answers \? answerAnnotations\(\) : answerAnnotations\(\)\.filter\(function \(a\) \{ return annBankQ\(a\) \|\| annLivingApp\(a\); \}\)[,;][\s\S]{0,120}qr: printQrUrl\(\)/);
  assert.match(html, /buildAnnotatedPdf\(false, \{ qr: printQrUrl\(\)(?:, lappQr: await lappQrLinks\(annotations\))? \}\)/);
  assert.match(html, /if \(opts\.qr && window\.QuestionBank && outDoc\.getPageCount\(\)\)/);
  assert.match(html, /annotations = bankQPracticeCopies\(teacherAnswers\)(?:\.concat\(lappPracticeCopies\(teacherAnswers\)\))?;/);
  assert.match(html, /function bankQPracticeCopies\(list\) \{[\s\S]{0,200}c\.locked = true;/);
  assert.match(html, /printQrOn = localStorage\.getItem\(BANKQ_QR_PREF\) === '1'/);
});

test('a question window does not outlive its worksheet or its person', () => {
  assert.match(html, /autoLearnFlushCurrent\(\); \} catch \(e\) \{\}\s*bankQWorksheetChanged\(\);/);
  assert.match(html, /voiceRoleChanged\(\);\s*bankQRoleChanged\(\);/);
});

test('the scripts load in order, after the app, and the syntax check covers them', () => {
  const order = ['vendor/qrcode-generator.js', 'question-apps.js', 'question-bank.js'].map(f => html.indexOf('<script src="' + f + '"></script>'));
  assert.ok(order.every(i => i > 0) && order[0] < order[1] && order[1] < order[2]);
  assert.ok(html.indexOf('<script>bankQInit();</script>') > order[2]);
  assert.match(html, /<link rel="stylesheet" href="question-bank\.css">/);
  const syntax = read('tools/check-syntax.mjs');
  ['question-apps.js', 'question-bank.js', 'vendor/qrcode-generator.js'].forEach(f => assert.ok(syntax.includes("'" + f + "'"), f));
});

test('the version is bumped', () => {
  const v = html.match(/var APP_VERSION = 'v(\d+)\.(\d+)\.(\d+)'/);
  assert.ok(v && (+v[1] > 1 || +v[2] >= 136), v && v[0]);
});

test('🔢 the portal’s question number travels, shows and is searched exactly', () => {
  const bank = [
    { id: 'a', qno: 12, title: 'Heat flow', blocks: [{ type: 'text', content: 'A cup at 123 degrees' }] },
    { id: 'b', qno: 123, title: 'Magnets', blocks: [{ type: 'text', content: 'Two magnets' }] },
    { id: 'c', title: 'No number yet', blocks: [{ type: 'text', content: 'Plants' }] },
  ];
  assert.equal(P.qnoLabel(bank[1]), '#123');
  assert.equal(P.qnoLabel(bank[2]), '');
  assert.equal(P.qnoOf({ qno: '5' }), 0, 'only a real number counts');
  assert.deepEqual(plain(P.qnoQuery('#123')), { n: 123, only: true });
  assert.deepEqual(plain(P.qnoQuery('Q#7')), { n: 7, only: true });
  assert.deepEqual(plain(P.qnoQuery(' 123 ')), { n: 123, only: false });
  assert.equal(P.qnoQuery('heat 12'), null);
  const ids = query => P.filterQuestions(bank, { query }).map(q => q.id);
  assert.deepEqual(ids('#12'), ['a'], '#12 never finds #123');
  assert.deepEqual(ids('#123'), ['b']);
  assert.deepEqual(ids('#999'), []);
  assert.deepEqual(ids('123'), ['b', 'a'], 'a bare number puts that question first, then the words');
  assert.equal(P.snapshotQuestion(bank[1]).qno, 123, 'the number rides on the annotation');
  assert.match(html, /function bankQNoText\(a\)/);
  assert.match(html, /'📚 Question' \+ bankQNoText\(a\)/);
});
