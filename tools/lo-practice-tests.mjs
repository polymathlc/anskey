/* ✏️ lo-practice.js — the mistakes behind an objective, written again as
   practice questions with an answer key and working. This file is the SAME
   in Study Buddy (polymathlc/tutor) and Ans Key (polymathlc/anskey), and so
   is the module it tests: when both repositories are checked out side by
   side, the last test compares the two copies byte for byte.

   Run: node --test tools/lo-practice-tests.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const LP = require('../lo-practice.js');
const SRC = fs.readFileSync(new URL('../lo-practice.js', import.meta.url), 'utf8');
const CSS = fs.readFileSync(new URL('../lo-practice.css', import.meta.url), 'utf8');

/* A mistake as Study Buddy's book files it. */
function book(over) {
  return Object.assign({
    key: 'doc1_q3', docId: 'doc1', docName: 'WA2 Maths', subject: 'math', number: '3',
    question: 'Ali had 3/5 of his stickers left after giving away 24. How many had he at first?',
    answer: '60', studentAnswer: '40', verdict: 'wrong', marks: '0/2',
    lo: 'P5.FR.2.6', sylTopic: 'P5.FR Fractions: Four Operations', topic: 'Fractions',
    type: 'open', options: [], createdAt: 1700000000000
  }, over || {});
}

test('a mistake from either app comes out in one shape', () => {
  const a = LP.fromMistake(book());
  assert.equal(a.q.slice(0, 7), 'Ali had');
  assert.equal(a.n, '3');
  assert.equal(a.ws, 'WA2 Maths');
  assert.equal(a.lo, 'P5.FR.2.6');
  assert.equal(a.tkey, 'P5.FR Fractions: Four Operations');
  assert.equal(a.sub, 'math');
  assert.equal(a.at, 1700000000000);
  const b = LP.fromMirror({ q: 'What is 3/4 of 20?', n: '5', doc: 'Quiz', sub: 'math', lo: 'P4.FR.1.2', v: 'skipped', ans: '15', mine: '', id: 'm9', at: 5 });
  assert.equal(b.key, 'm9');
  assert.equal(b.v, 'skipped');
  assert.equal(b.ws, 'Quiz');
  assert.equal(LP.fromMistake(null), null);
  assert.equal(LP.fromMirror('nope'), null);
  const skipped = LP.fromMistake(book({ skipped: true, verdict: '' }));
  assert.equal(skipped.v, 'skipped', 'a blank gone past says so');
  const fromBlocks = LP.fromMistake(book({ question: '', blocks: [{ type: 'text', text: 'Find the area.' }, { type: 'image' }] }));
  assert.equal(fromBlocks.q, 'Find the area.', 'a rebuilt question with no read wording uses its text blocks');
});

test('one subject at a time: another subject never reaches the window', () => {
  const list = [book(), book({ key: 's1', subject: 'science', number: '9', question: 'Why does ice melt?' }), book({ key: 'k2', number: '4', question: 'Another' })];
  const maths = LP.norm(list, 'math');
  assert.deepEqual(maths.map(m => m.n), ['3', '4']);
  assert.deepEqual(LP.norm(list, 'science').map(m => m.n), ['9']);
  assert.equal(LP.norm(list, 'maths').length, 2, '"maths" and "math" are one subject');
});

test('the same question filed twice shows once', () => {
  const list = [book(), book({ key: 'again' })];
  assert.equal(LP.norm(list, 'math').length, 1);
});

test('a mistake belongs to its objective, and to its topic only when it has no objective', () => {
  const m = LP.fromMistake(book());
  assert.ok(LP.matches(m, { los: ['p5.fr.2.6'] }), 'ids match whatever their case');
  assert.ok(!LP.matches(m, { los: ['P5.FR.2.5'] }));
  assert.ok(!LP.matches(m, { tkeys: ['P5.FR Fractions: Four Operations'] }), 'an objective mistake is not ALSO a topic-only mistake');
  const t = LP.fromMistake(book({ lo: '' }));
  assert.ok(LP.matches(t, { tkeys: ['P5.FR Fractions: Four Operations'] }));
  const named = LP.fromMirror({ q: 'x', n: '1', top: 'Whole Numbers', sub: 'math' });
  assert.ok(LP.matches(named, { topics: ['whole numbers'] }), 'a topic name matches without its case');
  assert.ok(!LP.matches(m, { los: ['P5.FR.2.6'], sub: 'science' }), 'never across subjects');
  assert.ok(LP.matches(m, { los: ['P5.FR.2.6'], docId: 'doc1' }));
  assert.ok(!LP.matches(m, { los: ['P5.FR.2.6'], docId: 'doc2' }), 'a worksheet report keeps to its worksheet');
  assert.ok(LP.matches(LP.fromMirror({ q: 'x', n: '1', doc: 'WA2', lo: 'A', sub: 'math' }), { los: ['A'], docId: 'd', ws: 'WA2' }),
    'a row with no worksheet id is matched by the worksheet name');
});

test('the groups are put weakest first, most lost, most mistakes, newest or in syllabus order', () => {
  const m = (at) => ({ at });
  const groups = [
    { key: 'a', title: 'A', order: 1, got: 9, att: 10, tot: 10, pct: 90, mistakes: [m(1)] },
    { key: 'b', title: 'B', order: 2, got: 1, att: 4, tot: 4, pct: 25, mistakes: [m(5), m(2)] },
    { key: 'c', title: 'C', order: 3, got: 5, att: 10, tot: 20, pct: 50, mistakes: [m(9), m(1), m(1)] },
    { key: 'd', title: 'D', order: 0, got: 0, att: 0, tot: 0, pct: null, mistakes: [] }
  ];
  const ids = (how) => LP.sortGroups(groups, how).map(g => g.key).join('');
  assert.equal(ids('weak'), 'bcad', 'untried last');
  assert.equal(ids('lost'), 'cbad', 'a blank counts as marks lost');
  assert.equal(ids('count'), 'cbad');
  assert.equal(ids('recent'), 'cbad');
  assert.equal(ids('syllabus'), 'dabc');
  assert.equal(groups.map(g => g.key).join(''), 'abcd', 'the list handed in is not reordered');
  assert.deepEqual(LP.SORTS.map(s => s[0]), ['weak', 'lost', 'count', 'recent', 'syllabus']);
});

test('algebra is spotted, Singapore working is not', () => {
  for (const s of ['Let x be the number of sweets', 'Let n = the number', '3x = 12', 'x = 12 ÷ 3', 'n + 5 = 9',
                   'Solve for the unknown', 'by substitution', '2y + 4 = 10']) {
    assert.ok(LP.looksAlgebraic(s), s);
  }
  for (const s of ['5 units = 40', '1 unit = 40 ÷ 5 = 8', '1 u = 8', '3 x 4 = 12', '5 m = 500 cm',
                   'Ali had 3 units = 3 × 8 = 24 stickers', 'Working backwards: 60 − 24 = 36', '2 parts = 18 kg', '']) {
    assert.ok(!LP.looksAlgebraic(s), s);
  }
});

test('the ask names the skill, the original and the no-algebra rule', () => {
  const m = LP.fromMistake(book());
  const p = LP.practicePrompt(m, { sub: 'math', level: 'P5', objective: 'P5.FR.2.6 solving word problems', topic: 'Fractions' });
  assert.match(p, /ONE NEW practice question/);
  assert.match(p, /Level: P5/);
  assert.match(p, /P5\.FR\.2\.6 solving word problems/);
  assert.match(p, /Ali had 3\/5/);
  assert.match(p, /Correct answer: 60/);
  assert.match(p, /What the pupil wrote: 40/);
  assert.match(p, /NEVER use algebra/);
  assert.match(p, /model drawing/);
  assert.match(p, /NO picture/);
  assert.match(p, /"working":\[/);
  assert.doesNotMatch(p, /YOUR LAST REPLY USED ALGEBRA/);
  assert.match(LP.practicePrompt(m, { sub: 'math' }, true), /YOUR LAST REPLY USED ALGEBRA/);
  const sci = LP.practicePrompt(LP.fromMistake(book({ subject: 'science' })), { sub: 'science' });
  assert.doesNotMatch(sci, /NEVER use algebra/, 'science is not told about algebra');
  assert.match(sci, /key points/);
});

test('a reply becomes a clean practice question, or nothing', () => {
  const p = LP.cleanPractice({
    question: 'Mei had some beads. She gave away 18 and had 2/5 left. How many at first?',
    options: [], correctOption: -1, answer: '30',
    working: ['Step 1: 3 units = 18', '1 unit = 18 ÷ 3 = 6', '5 units = 30'], method: 'Model drawing'
  });
  assert.equal(p.answer, '30');
  assert.deepEqual(p.working, ['3 units = 18', '1 unit = 18 ÷ 3 = 6', '5 units = 30'], 'step labels are taken off');
  assert.equal(p.algebra, false);
  assert.equal(p.correct, -1);
  const mcq = LP.cleanPractice({ questionText: 'Which is largest?', options: ['1/2', '2/3', '3/4', '3/5'], correctOption: 2, expected: '' });
  assert.equal(mcq.answer, '3/4', 'a multiple-choice reply with no answer takes its correct option');
  assert.equal(mcq.correct, 2);
  assert.equal(LP.cleanPractice({ question: 'Q', answer: '' }), null);
  assert.equal(LP.cleanPractice({ answer: '5' }), null);
  assert.equal(LP.cleanPractice(null), null);
  assert.equal(LP.cleanPractice({ questions: [{ question: 'Q', answer: '1' }] }).question, 'Q', 'the Rapid add list shape is read too');
  assert.equal(LP.cleanPractice({ question: 'Q', answer: '4', working: 'Let x be it\nx = 4' }).algebra, true);
  const one = LP.cleanPractice({ question: 'Q', answer: '1', options: ['only one'], correctOption: 0 });
  assert.deepEqual(one.options, [], 'one option is not a choice');
});

test('an algebraic working is asked for again, once, with the rule said louder', async () => {
  const asks = [];
  const replies = [
    JSON.stringify({ question: 'Q', answer: '30', working: ['Let x be the beads', '3x = 18'] }),
    JSON.stringify({ question: 'Q', answer: '30', working: ['3 units = 18', '1 unit = 6', '5 units = 30'] })
  ];
  const ask = async (prompt, opts) => { asks.push({ prompt, opts }); return replies[asks.length - 1]; };
  const p = await LP.makePractice(LP.fromMistake(book()), { sub: 'math' }, ask, JSON.parse);
  assert.equal(asks.length, 2);
  assert.match(asks[1].prompt, /YOUR LAST REPLY USED ALGEBRA/);
  assert.equal(asks[0].opts.json, true);
  assert.equal(p.algebra, false);
  assert.equal(p.working[0], '3 units = 18');
});

test('a reply that never parses says so, and science is never re-asked for algebra', async () => {
  await assert.rejects(LP.makePractice(LP.fromMistake(book()), { sub: 'math' }, async () => 'not json', JSON.parse), /could not be read|did not come back/);
  let n = 0;
  const p = await LP.makePractice(LP.fromMistake(book({ subject: 'science' })), { sub: 'science' },
    async () => { n++; return JSON.stringify({ question: 'Q', answer: 'A', working: ['x = 2'] }); }, JSON.parse);
  assert.equal(n, 1);
  assert.equal(p.answer, 'A');
  await assert.rejects(LP.makePractice(LP.fromMistake(book()), {}, null), /No AI/);
});

test('the printed sheet: questions first, then the key and working on a page of its own, all escaped', () => {
  const m = LP.fromMistake(book({ question: 'Is 3 < 5? <script>' }));
  const p = LP.cleanPractice({ question: 'Tom had <b>40</b> marbles…', options: ['10', '20', '30', '40'], correctOption: 1,
                               answer: '20', working: ['4 units = 40', '1 unit = 10', '2 units = 20'], method: 'Model drawing' });
  const html = LP.sheetHtml({
    title: 'Practice', name: 'Ann', sub: 'math', when: '3 Nov', withKey: true, withMistakes: true,
    summary: [{ code: 'P5.FR.2.6', title: 'word problems', got: 1, att: 4, tot: 4, pct: 25, q: 2, mistakes: [m] }],
    groups: [{ title: 'word problems', code: 'P5.FR.2.6', pct: 25, items: [{ m, p }, { m, p: null }] }]
  });
  assert.ok(!/<b>40<\/b>|<script>/.test(html), 'model and student text is escaped');
  assert.match(html, /&lt;b&gt;40/);
  assert.match(html, /Practice questions/);
  assert.match(html, /\(B\) 20/);
  assert.match(html, /lpSheetH lpBreak">Answer key and working/);
  assert.match(html, /<li>4 units = 40<\/li>/);
  assert.match(html, /a fresh one was not written yet/, 'a question not written yet prints the original');
  assert.match(html, /My mistakes/);
  assert.match(html, /P5\.FR\.2\.6/);
  assert.ok(html.indexOf('Practice questions') < html.indexOf('Answer key and working'));
  const noKey = LP.sheetHtml({ title: 'P', groups: [{ title: 't', items: [{ m, p }] }], withKey: false });
  assert.doesNotMatch(noKey, /Answer key and working/);
  const empty = LP.sheetHtml({ title: 'P', groups: [{ title: 't', items: [] }], withKey: true });
  assert.match(empty, /nothing to practise/);
});

test('a practice question is remembered per mistake', () => {
  const a = LP.fromMistake(book());
  const b = LP.fromMistake(book({ question: 'Something else entirely' }));
  assert.notEqual(LP.cacheKey(a), LP.cacheKey(b));
  assert.equal(LP.cacheKey(a), LP.cacheKey(LP.fromMistake(book())));
  assert.match(LP.cacheKey(a), /^lp2:/, 'v2 keys: a question written for NO picture is never shown beside one');
  const withFig = LP.fromMistake(book({ blocks: [{ type: 'text', text: 'Look.' }, { type: 'image', path: 'tutor-mistakes/u/f0.png' }] }));
  assert.notEqual(LP.cacheKey(withFig), LP.cacheKey(a), 'a mistake that gains its figure is written again');
});

/* ---- 🖼 v2: the question as Rapid add stores it ---- */
const BAR = 'The bar graph shows the different ways the Primary 3 students travel to school daily. How many more students walk than take ' +
  'the train to school daily? [The bar graph is titled \'Number of students in Primary 3\'. The vertical axis is labelled \'Number of students\', ' +
  'from 0 to 120, with each small interval representing 4 students. The bars show Walk: 80, By car: 72, By bus: 100, By train: 48.]';

test('🖼 a mistake keeps its pictures: blocks in order, figures, the whole-question crop, the page', () => {
  const m = LP.fromMistake(book({
    question: BAR,
    blocks: [{ type: 'text', text: 'The bar graph shows how pupils travel.' }, { type: 'image', path: 'tutor-mistakes/u/a_f0.png' },
             { type: 'text', text: 'How many more walk than take the train?' }, { type: 'image', path: 'tutor-mistakes/u/a_f1.png', role: 'options' }],
    figUrls: ['https://firebasestorage.googleapis.com/f0', 'https://firebasestorage.googleapis.com/f1'],
    imagePath: 'tutor-mistakes/u/a.jpg', shot: 'question'
  }));
  assert.deepEqual(m.blocks.map(b => b.t), ['text', 'img', 'text', 'img']);
  assert.equal(m.blocks[1].pic.src, 'tutor-mistakes/u/a_f0.png');
  assert.equal(m.blocks[1].pic.alt, 'https://firebasestorage.googleapis.com/f0', 'the minted link is the second source, in order');
  assert.equal(m.figs.length, 1, 'a picture of the OPTIONS is not a figure to ask a new question about');
  assert.equal(m.popts, true);
  assert.equal(m.qimg.src, 'tutor-mistakes/u/a.jpg');
  assert.equal(m.pimg, null);
  assert.equal(LP.tierOf(m), 'blocks');
  const page = LP.fromMistake(book({ question: BAR, imagePath: 'tutor-mistakes/u/b.jpg', shot: 'page' }));
  assert.equal(LP.tierOf(page), 'page');
  assert.equal(LP.tierOf(LP.fromMistake(book())), 'text');
  const mir = LP.fromMirror({ q: BAR, n: '30', doc: 'P3 EOY', sub: 'math', figs: ['https://x.test/f.png', 'javascript:alert(1)'], img: 'https://x.test/q.jpg', sh: 'question' });
  assert.equal(mir.figs.length, 1, 'the mirror keeps only https links');
  assert.equal(mir.qimg.src, 'https://x.test/q.jpg');
  assert.equal(LP.tierOf(mir), 'question');
});

test('🖼 only safe picture sources are ever drawn', () => {
  assert.equal(LP.picSrc('javascript:alert(1)'), '');
  assert.equal(LP.picSrc('http://plain.test/x.png'), '', 'never plain http');
  assert.equal(LP.picSrc('data:text/html;base64,AAAA'), '');
  assert.equal(LP.picSrc('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
  assert.equal(LP.picSrc('https://ok.test/a.png'), 'https://ok.test/a.png');
  assert.equal(LP.picSrc('tutor-mistakes/u1/abc_f0.png'), 'tutor-mistakes/u1/abc_f0.png');
  assert.equal(LP.picSrc('../../etc/passwd'), '', 'a path never climbs');
  assert.equal(LP.picSrc('<img onerror=x>'), '');
});

test('🖼 a figure written out in square brackets comes off the wording once the figure is drawn', () => {
  const t = LP.stripFigureNotes(BAR);
  assert.doesNotMatch(t, /\[|Walk: 80/);
  assert.match(t, /How many more students walk than take the train to school daily\?$/);
  assert.equal(LP.stripFigureNotes('Find the total. [2 marks]'), 'Find the total. [2 marks]', 'the paper\'s own marks stay');
  assert.ok(LP.needsFigure(LP.fromMistake(book({ question: BAR }))));
  assert.ok(LP.needsFigure(LP.fromMistake(book({ question: 'The figure below is made of 4 squares. Find its perimeter.' }))));
  assert.ok(!LP.needsFigure(LP.fromMistake(book())), 'a word problem needs no picture');
  assert.ok(LP.wantsRebuild(LP.fromMistake(book({ question: BAR }))), 'text that leans on a figure is set out again');
  assert.ok(!LP.wantsRebuild(LP.fromMistake(book({ question: BAR, blocks: [{ type: 'text', text: 'x' }, { type: 'image', path: 'p/f.png' }] }))),
    'one with its figure cut already is not');
  assert.ok(!LP.wantsRebuild(LP.fromMistake(book({ question: BAR, imagePath: 'p/q.jpg', shot: 'question' }))));
});

test('🖼 the practice prompt keeps the figure and forbids describing it', () => {
  const m = LP.fromMistake(book({ question: BAR, blocks: [{ type: 'text', text: 'x' }, { type: 'image', path: 'p/f.png' }] }));
  const withFig = LP.practicePrompt(m, { sub: 'math', figs: 1, seen: true });
  assert.match(withFig, /\[\[FIG 1\]\]/);
  assert.match(withFig, /NEVER describe the figure/);
  assert.match(withFig, /attached/);
  assert.doesNotMatch(withFig, /make complete sense with NO picture/);
  const none = LP.practicePrompt(LP.fromMistake(book()), { sub: 'math' });
  assert.match(none, /NO picture/);
  assert.match(none, /Never put a description of a figure in square brackets/);
});

test('🖼 a reply comes back as blocks: text, the figure where it was marked, the ask', () => {
  const p = LP.cleanPractice({ question: 'The bar graph shows how pupils travel.\n[[FIG 1]]\nHow many more go by bus than by car?', answer: '28', working: ['100 − 72 = 28'] }, 1);
  assert.deepEqual(p.blocks.map(b => b.t), ['text', 'fig', 'text']);
  assert.equal(p.blocks[1].i, 0);
  assert.doesNotMatch(p.question, /FIG/);
  assert.equal(p.figs, 1);
  const unmarked = LP.cleanPractice({ question: 'The bar graph shows how pupils travel. How many go by bus or by car altogether? [The bars show Bus: 100, Car: 72.]', answer: '172', working: ['100 + 72 = 172'] }, 1);
  assert.deepEqual(unmarked.blocks.map(b => b.t), ['text', 'fig', 'text'], 'no marker: the figure goes before the ask');
  assert.doesNotMatch(unmarked.blocks.map(b => b.text || '').join(' '), /\[The bars/, 'and the bracketed description goes');
  const refused = LP.cleanPractice({ question: 'Ali has 5 apples. How many?', figure: false, answer: '5', working: ['5'] }, 1);
  assert.equal(refused.blocks.length, 0, 'a reply that said it needs no figure is printed without one');
  const noFigs = LP.cleanPractice({ question: 'A [[FIG 1]] B?', answer: '1', working: ['1'] }, 0);
  assert.equal(noFigs.blocks.length, 0);
  assert.equal(noFigs.question, 'A  B?'.replace('  ', '  '));
});

test('🖼 the figure rides along to the model as a picture', async () => {
  let seen = null;
  const m = LP.fromMistake(book({ question: BAR, blocks: [{ type: 'image', path: 'p/f.png' }, { type: 'text', text: 'How many more walk?' }] }));
  const p = await LP.makePractice(m, { sub: 'math', figs: 1, seen: true, images: [{ mimeType: 'image/jpeg', data: 'AAA' }] },
    async (prompt, opts) => { seen = opts; return JSON.stringify({ question: '[[FIG 1]]\nHow many more go by bus than by train?', answer: '52', working: ['100 − 48 = 52'] }); }, JSON.parse);
  assert.equal(seen.images.length, 1);
  assert.deepEqual(p.blocks.map(b => b.t), ['fig', 'text']);
});

test('🖼 the printed sheet prints the figures, and never a link it was not given', () => {
  const m = LP.fromMistake(book({ question: BAR, blocks: [{ type: 'text', text: 'The bar graph.' }, { type: 'image', path: 'p/f.png' }, { type: 'text', text: 'How many?' }] }));
  const p = LP.cleanPractice({ question: 'Graph:\n[[FIG 1]]\nHow many by bus?', answer: '100', working: ['Read the bar: 100'] }, 1);
  const pic = pc => (pc && pc.src === 'p/f.png' ? 'https://cdn.test/f.png?a=1&b="2"' : '');
  const html = LP.sheetHtml({ title: 'P', groups: [{ title: 't', items: [{ m, p }, { m, p: null }] }], withKey: true, withMistakes: true, pic });
  assert.equal((html.match(/<img src="https:\/\/cdn\.test\/f\.png\?a=1&amp;b=&quot;2&quot;"/g) || []).length, 4,
    'the practice question, the not-yet-written one and both entries under My mistakes each print the figure, escaped');
  assert.doesNotMatch(html, /Walk: 80/, 'with the figure printed the bracketed description is gone');
  const nolinks = LP.sheetHtml({ title: 'P', groups: [{ title: 't', items: [{ m, p }] }], withKey: false, pic: () => 'javascript:x' });
  assert.doesNotMatch(nolinks, /<img/);
  assert.match(nolinks, /How many by bus/, 'a figure that cannot be named leaves its wording standing');
  assert.match(LP.questionHtml(LP.fromMistake(book({ question: BAR })), pic), /Walk: 80/, 'text only: the description is all there is, so it stays');
});

test('✍️ an answer is checked the way a pupil writes it', () => {
  assert.equal(LP.answerMatches('32', '32'), true);
  assert.equal(LP.answerMatches('32 students', ' 32 '), true);
  assert.equal(LP.answerMatches('(1) 32', '32'), true, 'the key\'s last number is its answer');
  assert.equal(LP.answerMatches('1200', '1,200'), true);
  assert.equal(LP.answerMatches('3/4', '0.75'), true);
  assert.equal(LP.answerMatches('2 1/2', '2½'), true);
  assert.equal(LP.answerMatches('2 h 30 min', '2 h 30 min'), true);
  assert.equal(LP.answerMatches('32', '36'), false);
  assert.equal(LP.answerMatches('32', ''), false);
  assert.equal(LP.answerMatches('', '32'), null, 'no key: nothing to check against');
  assert.equal(LP.optionIsKey('(1) 32', { label: '1', text: '32' }, 0), true);
  assert.equal(LP.optionIsKey('(1) 32', { label: '2', text: '36' }, 1), false);
  assert.equal(LP.optionIsKey('2', { label: '2', text: '36' }, 1), true);
  assert.equal(LP.optionIsKey('B', { label: '', text: '36' }, 1), true);
  assert.equal(LP.optionIsKey('36', { label: '2', text: '36' }, 1), true, 'a key that names the option by its text');
});

test('the file never reaches a model or the network by itself', () => {
  assert.doesNotMatch(SRC, /fetch\(|XMLHttpRequest|askGemini|firebase/);
  const rhs = [...SRC.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)].map(x => x[1].trim());
  assert.ok(rhs.length > 0);
  for (const r of rhs) assert.ok(r === "''" || r === 'html', 'innerHTML only ever clears, or takes the escaped sheet: ' + r);
  assert.match(CSS, /\.lpBack\.open \{ display: flex; \}/);
  assert.match(CSS, /\.lpBreak \{ break-before: page;/);
});

test('lo-practice.js, its CSS and this test are the same files in Study Buddy and Ans Key, wherever both are checked out', () => {
  const parent = new URL('../../', import.meta.url);
  for (const f of ['lo-practice.js', 'lo-practice.css', 'tools/lo-practice-tests.mjs']) {
    const here = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    for (const repo of ['tutor', 'anskey']) {
      let other;
      try { other = fs.readFileSync(new URL(repo + '/' + f, parent), 'utf8'); } catch (e) { continue; }
      assert.equal(other, here, repo + '/' + f + ' differs');
    }
  }
});
