/* 🧩 The gap view: one student's weak concepts, read from the concept tags
   Study Buddy writes on their roster row. The page is drawn from
   `GapView.pure.viewModel`, so the numbers are checked here without a
   browser; the wiring into the Students window is checked against
   index.html.

   Run: node --test tools/gap-view-tests.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.ConceptTags = require('../concept-tags.js');
const GV = require('../gap-view.js');
const SRC = fs.readFileSync(new URL('../gap-view.js', import.meta.url), 'utf8');
const CSS = fs.readFileSync(new URL('../gap-view.css', import.meta.url), 'utf8');
const HTML = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 3, 10, 0, 0);

function sheet(daysAgo, n, tags, sub = 'math', name) {
  return { ws: name || ('Paper ' + daysAgo), sub, lvl: 'P5', at: NOW - daysAgo * DAY, n, w: tags.length,
           tags: tags.map((t, i) => ({ t, q: String(i + 1), why: 'reason ' + t + ' ' + daysAgo, v: 'wrong', mid: 'm' + daysAgo + '_' + i })) };
}
const profile = {
  name: 'Aisha Tan',
  tutorGaps: {
    a: sheet(60, 10, ['sign-error', 'sign-error', 'forgot-units']),
    b: sheet(40, 10, ['sign-error', 'forgot-units']),
    c: sheet(12, 10, ['forgot-units', 'forgot-units']),
    d: sheet(3, 10, ['forgot-units', 'forgot-units', 'calc-slip']),
    e: sheet(5, 8, ['missing-keyword'], 'science', 'P5 Science WA2')
  },
  tutorMistakes: [
    { id: 'm3_0', q: 'Find the area', mine: '24 cm', ans: '24 cm²', img: 'https://firebasestorage.googleapis.com/x.jpg', done: false },
    { id: 'm3_1', q: 'x', mine: 'm', ans: 'a', img: 'javascript:alert(1)' },
    { q: 'an old row with no id' }
  ]
};

test('the top weak concepts are ranked, with a trend each', () => {
  const vm = GV.pure.viewModel(profile, 'math', NOW);
  assert.equal(vm.ok, true);
  assert.equal(vm.name, 'Aisha Tan');
  assert.equal(vm.sheets, 4);
  assert.deepEqual(vm.top.map(g => g.tag), ['forgot-units', 'sign-error', 'calc-slip']);
  const units = vm.top[0];
  assert.equal(units.trend, 'worse');
  assert.equal(units.trendWord, 'Getting worse');
  const sign = vm.top[1];
  assert.equal(sign.trend, 'improving');
  assert.equal(sign.cleanSince, 2);
  assert.equal(sign.before, '1 in 7 questions');
  assert.equal(sign.after, 'none');
  assert.equal(units.bars.length, 4, 'one bar per paper of the subject');
  assert.deepEqual(units.bars.map(b => b.hits), [1, 1, 2, 2]);
});

test('every mistake behind a gap is listed newest first, linked to its mirror row where there is one', () => {
  const vm = GV.pure.viewModel(profile, 'math', NOW);
  const units = vm.top[0];
  assert.equal(units.mistakes.length, 6);
  const newest = units.mistakes[0];
  assert.equal(newest.at, NOW - 3 * DAY);
  assert.equal(newest.linked, true);
  assert.equal(newest.mine, '24 cm');
  assert.equal(newest.ans, '24 cm²');
  assert.match(newest.img, /^https:\/\//);
  const bad = units.mistakes.find(m => m.mine === 'm');
  assert.equal(bad.img, '', 'only an https picture is ever drawn');
  assert.ok(units.mistakes.some(m => !m.linked), 'a slip whose mistake is gone still shows, unlinked');
});

test('the subject chips narrow the page, and "all" holds every subject', () => {
  const sci = GV.pure.viewModel(profile, 'science', NOW);
  assert.deepEqual(sci.top.map(g => g.tag), ['missing-keyword']);
  assert.equal(sci.top[0].trend, 'new', 'one science paper is too few for a trend');
  const all = GV.pure.viewModel(profile, 'all', NOW);
  assert.equal(all.sheets, 5);
  assert.deepEqual(all.subjects.sort(), ['math', 'science']);
});

test('a student with nothing tagged gets an honest empty page, and the count says 0', () => {
  const vm = GV.pure.viewModel({ name: 'New Kid' }, 'all', NOW);
  assert.equal(vm.empty, true);
  assert.equal(GV.count({ name: 'New Kid' }), 0);
  assert.equal(GV.count(profile), 11);
});

test('rates read as a teacher would say them', () => {
  assert.equal(GV.pure.rateText(0), 'none');
  assert.equal(GV.pure.rateText(0.125), '1 in 8 questions');
  assert.equal(GV.pure.rateText(0.9), 'almost every question');
});

test('it only reads: no write anywhere, and nothing drawn as markup', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/(?<!classList)\.(set|update|add|delete)\(/.test(code), 'the gap view writes nothing');
  assert.deepEqual((code.match(/innerHTML\s*=\s*[^;]*;/g) || []).filter(s => !/=\s*'';$/.test(s)), [],
                   'innerHTML is only ever cleared, never filled');
  assert.ok(!/askGemini|fetch\(/.test(code), 'and asks no model');
  assert.match(code, /isTeacher\(\)/, 'it refuses anyone but the teacher in its own handler');
});

test('the Students window opens it for the teacher, and the files are loaded', () => {
  assert.ok(HTML.includes('<link rel="stylesheet" href="gap-view.css">'));
  const ct = HTML.indexOf('<script src="concept-tags.js"></script>');
  const gv = HTML.indexOf('<script src="gap-view.js"></script>');
  assert.ok(ct > 0 && gv > ct, 'concept-tags.js loads before gap-view.js');
  const row = HTML.slice(HTML.indexOf('function studentAdminRow(uid, p) {'), HTML.indexOf('/* ---- Which worksheets can this signed-in user see? ---- */'));
  assert.match(row, /GapView\.open\(\{ db: db, uid: uid, profile: p, collection: PROFILES_COLLECTION/);
  assert.match(row, /isAdmin\(currentUser\) && !actingStudent/);
  assert.ok(fs.readFileSync(new URL('check-syntax.mjs', import.meta.url), 'utf8').includes("'gap-view.js'"));
  assert.match(CSS, /@media \(max-width: 640px\)/, 'it fits a phone');
});
