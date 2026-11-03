/* 🎯 concept-tags.js — the fixed list of what went wrong, and the plain-code
   trend the gap view reads. This file is the SAME in Study Buddy
   (polymathlc/tutor) and Ans Key (polymathlc/anskey), and so is the module
   it tests: when both repositories are checked out side by side, the last
   test compares the two copies byte for byte.

   Run: node --test tools/concept-tags-tests.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CT = require('../concept-tags.js');
const SRC = fs.readFileSync(new URL('../concept-tags.js', import.meta.url), 'utf8');
const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 3, 10, 0, 0);

test('every id a subject or topic offers is in the catalogue, once, as a kebab-case id', () => {
  const all = [].concat(CT.COMMON_IDS, ...Object.values(CT.SUBJECT_IDS), ...CT.TOPIC_IDS.map(r => r.ids));
  for (const id of all) {
    assert.ok(CT.isTag(id), id + ' is offered but not defined');
    assert.match(id, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, id);
  }
  for (const [id, d] of Object.entries(CT.DEFS)) {
    assert.ok(d.label && d.use && d.fix, id + ' needs a label, a use and a fix');
    assert.ok(all.includes(id), id + ' is defined but offered nowhere');
  }
  const labels = Object.values(CT.DEFS).map(d => d.label.toLowerCase());
  assert.equal(new Set(labels).size, labels.length, 'two tags share a label');
});

test('the tag of last resort is always offered, and always last', () => {
  for (const sub of ['math', 'science', 'english', 'chinese', '', 'both']) {
    const ids = CT.idsFor(sub, '');
    assert.equal(ids.at(-1), 'concept-gap', sub);
  }
});

test('the subjects are read one way, whatever the app wrote', () => {
  assert.equal(CT.subjectKey('math'), 'math');
  assert.equal(CT.subjectKey('Mathematics'), 'math');
  assert.equal(CT.subjectKey('Science'), 'science');
  assert.equal(CT.subjectKey('english'), 'english');
  assert.equal(CT.subjectKey('chinese'), 'chinese');
  assert.equal(CT.subjectKey('both'), '');
  assert.equal(CT.subjectKey(undefined), '');
});

test('topic extras turn up on their own topic and nowhere else', () => {
  assert.ok(CT.idsFor('math', 'Fractions: addition and subtraction').includes('unlike-denominators'));
  assert.ok(!CT.idsFor('math', 'Angles').includes('unlike-denominators'));
  assert.ok(CT.idsFor('math', 'Angles').includes('angle-property'));
  assert.ok(CT.idsFor('science', 'Heat').includes('heat-vs-temperature'));
  assert.ok(!CT.idsFor('math', 'Heat').includes('heat-vs-temperature'), 'a science extra on a maths question');
  // …but a reply is checked against the WHOLE subject, extras included.
  assert.ok(CT.allIdsFor('science').includes('heat-vs-temperature'));
  assert.ok(!CT.allIdsFor('science').includes('unlike-denominators'));
});

test('a tag is kept only on a wrong or partly right answer', () => {
  assert.deepEqual(CT.clean('math', 'correct', 'sign-error', 'x'), { tag: '', why: '' });
  assert.deepEqual(CT.clean('math', '', 'sign-error', 'x'), { tag: '', why: '' });
  assert.deepEqual(CT.clean('math', 'wrong', 'sign-error', 'took 20 from 8'), { tag: 'sign-error', why: 'took 20 from 8' });
  assert.equal(CT.clean('math', 'partial', 'sign error', '').tag, 'sign-error', 'a spaced id');
  assert.equal(CT.clean('math', 'partial', 'Sign or direction error', '').tag, 'sign-error', 'the label');
  assert.equal(CT.clean('math', 'WRONG', ' SIGN-ERROR ', '').tag, 'sign-error', 'case and spaces');
  assert.equal(CT.clean('math', 'wrong', 'heat-vs-temperature', '').tag, 'concept-gap', 'another subject\'s tag');
  assert.equal(CT.clean('math', 'wrong', 'silly mistake', '').tag, 'concept-gap', 'an invented tag');
  assert.equal(CT.clean('math', 'wrong', '', '').tag, 'concept-gap', 'no tag at all on a wrong answer');
  const long = CT.clean('math', 'wrong', 'calc-slip', 'word '.repeat(80)).why;
  assert.ok(long.length <= CT.WHY_MAX + 1, 'the reason is one short line');
  assert.ok(!/\n/.test(CT.clean('math', 'wrong', 'calc-slip', 'a\nb').why));
});

test('an unknown subject is offered every subject, so the tag can follow the page', () => {
  assert.equal(CT.clean('', 'wrong', 'heat-vs-temperature', '').tag, 'heat-vs-temperature');
  assert.equal(CT.clean('both', 'wrong', 'tense', '').tag, 'tense');
});

test('the prompt block lists the subject\'s ids and says how to choose', () => {
  const b = CT.promptBlock('math');
  for (const id of CT.idsFor('math', '')) assert.ok(b.includes('• ' + id + ' — '), id);
  assert.ok(b.includes('unlike-denominators') && b.includes('(only on Fractions questions)'));
  assert.ok(!b.includes('heat-vs-temperature'));
  assert.match(b, /"tag" and "tagWhy" are empty strings/);
  assert.match(b, /never invent one/);
  const sci = CT.promptBlock('science');
  assert.equal((sci.match(/• conductor-insulator — /g) || []).length, 1, 'an extra on two topics is listed once');
});

test('a worksheet entry counts what was attempted and keeps every tagged slip with its link', () => {
  const items = [
    { number: '1', marked: true, verdict: 'correct' },
    { number: '2', marked: true, verdict: 'wrong', tag: 'sign-error', tagWhy: 'took 8 from 20 the wrong way', topic: 'Whole numbers', page: 1 },
    { number: '3', marked: true, verdict: 'partial', tag: 'forgot-units', tagWhy: 'no cm²', page: 2 },
    { number: '4', marked: false },
    { number: '5', marked: true, verdict: 'wrong', tag: 'not-a-tag' }
  ];
  const e = CT.sheetEntry({ ws: 'P5 Maths WA1', subject: 'math', level: 'P5', at: NOW, items,
                            mids: it => (it.number === '2' ? 'mist-2' : '') });
  assert.equal(e.n, 4);
  assert.equal(e.w, 3);
  assert.deepEqual(e.tags.map(t => t.t), ['sign-error', 'forgot-units']);
  assert.equal(e.tags[0].mid, 'mist-2');
  assert.equal(e.tags[0].top, 'Whole numbers');
  assert.equal(e.tags[1].mid, '');
  assert.equal(e.at, NOW);
});

function sheet(daysAgo, n, tags, sub = 'math') {
  return { ws: 'Paper ' + daysAgo, sub, lvl: 'P5', at: NOW - daysAgo * DAY, n, w: tags.length,
           tags: tags.map((t, i) => ({ t, q: String(i + 1), why: 'because ' + t, v: 'wrong', mid: 'm' + daysAgo + i })) };
}

test('a gap that stopped showing up reads as improving', () => {
  const map = {
    a: sheet(60, 10, ['sign-error', 'sign-error', 'calc-slip']),
    b: sheet(45, 10, ['sign-error', 'sign-error']),
    c: sheet(20, 10, ['calc-slip']),
    d: sheet(5, 10, [])
  };
  const s = CT.summarize(map, { now: NOW });
  const sign = s.gaps.find(g => g.tag === 'sign-error');
  assert.equal(sign.n, 4);
  assert.equal(sign.trend, 'improving');
  assert.equal(sign.cleanSince, 2, 'two papers since it was last made');
  assert.equal(sign.mistakes.length, 4);
  assert.equal(sign.mistakes[0].at, NOW - 45 * DAY, 'newest first');
  assert.equal(s.sheets, 4);
  assert.equal(s.attempted, 40);
});

test('a gap made more often lately reads as getting worse — by RATE, not by count', () => {
  const worse = CT.summarize({
    a: sheet(60, 10, ['forgot-units']),
    b: sheet(40, 10, []),
    c: sheet(10, 10, ['forgot-units', 'forgot-units']),
    d: sheet(2, 10, ['forgot-units', 'forgot-units'])
  }, { now: NOW }).gaps[0];
  assert.equal(worse.tag, 'forgot-units');
  assert.equal(worse.trend, 'worse');
  // Twice the papers, twice the questions, the same rate: not worse.
  const steady = CT.summarize({
    a: sheet(60, 10, ['forgot-units']),
    b: sheet(40, 10, ['forgot-units']),
    c: sheet(10, 20, ['forgot-units', 'forgot-units']),
    d: sheet(2, 20, ['forgot-units', 'forgot-units'])
  }, { now: NOW }).gaps[0];
  assert.equal(steady.trend, 'steady');
});

test('two papers are too few for a trend, and say so', () => {
  const s = CT.summarize({ a: sheet(10, 10, ['calc-slip']), b: sheet(2, 10, ['calc-slip']) }, { now: NOW });
  assert.equal(s.gaps[0].trend, 'new');
  assert.equal(CT.trendWord('new').word, 'New');
  assert.equal(CT.trendWord('improving').word, 'Improving');
  assert.equal(CT.trendWord('nonsense').word, 'Still there');
});

test('a recent slip outranks an old one made as often', () => {
  const s = CT.summarize({
    a: sheet(120, 10, ['calc-slip', 'calc-slip']),
    b: sheet(3, 10, ['sign-error', 'sign-error'])
  }, { now: NOW });
  assert.deepEqual(s.gaps.map(g => g.tag), ['sign-error', 'calc-slip']);
});

test('the subject filter narrows the sheets, and a broken row is skipped rather than read', () => {
  const map = {
    a: sheet(10, 10, ['calc-slip']),
    b: sheet(9, 10, ['missing-keyword'], 'science'),
    c: null,
    d: { ws: 'half written' },
    e: { at: NOW, tags: [{ t: 'unknown-id' }, { t: 'calc-slip' }], n: 3 }
  };
  const sci = CT.summarize(map, { now: NOW, subject: 'science' });
  assert.deepEqual(sci.gaps.map(g => g.tag), ['missing-keyword']);
  const all = CT.summarize(map, { now: NOW });
  assert.equal(all.sheets, 3);
  assert.deepEqual(all.subjects.sort(), ['math', 'science']);
  assert.equal(all.gaps.find(g => g.tag === 'calc-slip').n, 2, 'the unknown id is dropped, its neighbour kept');
});

test('pruning keeps the newest sheets and drops the rest and anything unreadable', () => {
  const map = {};
  for (let i = 0; i < 5; i++) map['s' + i] = sheet(50 - i * 10, 10, []);
  map.broken = { nope: true };
  const drop = CT.pruneIds(map, 3).sort();
  assert.deepEqual(drop, ['broken', 's0', 's1']);
  assert.deepEqual(CT.pruneIds({}, 3), []);
  assert.deepEqual(CT.pruneIds(null, 3), []);
});

test('the student\'s own gaps come from their book: open counts in full, sorted counts a little, old fades', () => {
  const rows = [
    { id: '1', tag: 'calc-slip', subject: 'math', at: NOW - 2 * DAY },
    { id: '2', tag: 'calc-slip', subject: 'math', at: NOW - 3 * DAY, cleared: true },
    { id: '3', tag: 'sign-error', subject: 'math', at: NOW - 1 * DAY },
    { id: '4', tag: 'sign-error', subject: 'math', at: NOW - 1 * DAY },
    { id: '5', tag: 'missing-keyword', subject: 'science', at: NOW },
    { id: '6', tag: '', subject: 'math', at: NOW },
    { id: '7', tag: 'tense', subject: 'math', at: NOW - 400 * DAY }
  ];
  const g = CT.fromMistakes(rows, { subject: 'math', now: NOW });
  assert.deepEqual(g.map(x => x.tag), ['sign-error', 'calc-slip', 'tense']);
  assert.deepEqual(g[0].ids, ['3', '4']);
  assert.deepEqual(g[1].ids, ['1'], 'only the open ones are practised');
  assert.equal(g[1].open, 1);
  assert.equal(CT.fromMistakes(rows, { subject: 'math', now: NOW, limit: 1 }).length, 1);
});

test('the hint line names the gaps and never lifts the help level', () => {
  assert.equal(CT.hintBlock([]), '');
  const b = CT.hintBlock([{ tag: 'sign-error', label: 'Sign or direction error', n: 3, whys: ['took 20 from 8'] }]);
  assert.match(b, /Sign or direction error \(3 times\) — for example: took 20 from 8/);
  assert.match(b, /never give more of the answer than their help level allows/);
  assert.match(b, /Never mention a gap that does not fit this question/);
});

test('the module is pure: no DOM, no network, no model call', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/document\.|fetch\(|XMLHttpRequest|askGemini|firebase|localStorage/.test(code));
});

test('concept-tags.js is the same file in Study Buddy and Ans Key, wherever both are checked out', () => {
  const here = new URL('../concept-tags.js', import.meta.url);
  const parent = new URL('../../', import.meta.url);
  for (const repo of ['tutor', 'anskey']) {
    let other;
    try { other = fs.readFileSync(new URL(repo + '/concept-tags.js', parent), 'utf8'); } catch (e) { continue; }
    assert.equal(other, fs.readFileSync(here, 'utf8'), repo + '/concept-tags.js differs');
  }
});
