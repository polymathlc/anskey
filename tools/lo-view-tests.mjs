/* 📐 The objective table window: one student's maths marks by learning
   objective, read from the entries Study Buddy writes on their roster row
   (`tutorLos`). The table itself is lo-marks.js (tested in
   lo-marks-tests.mjs, the same file in both repos); this checks the window
   reads the row, refuses a non-teacher, writes nothing, and is wired into
   the Students window.

   Run: node --test tools/lo-view-tests.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.LoMarks = require('../lo-marks.js');
const LV = require('../lo-view.js');
const SRC = fs.readFileSync(new URL('../lo-view.js', import.meta.url), 'utf8');
const CSS = fs.readFileSync(new URL('../lo-view.css', import.meta.url), 'utf8');
const HTML = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const T0 = Date.UTC(2026, 8, 1);

const profile = {
  name: 'Aisha Tan',
  tutorLos: {
    b: { v: 1, ws: 'SA1', sub: 'math', lvl: 'P5', at: T0 + 86400000, r: [{ l: 'P5.FR.2.6', q: 1, x: 2, g: 2, a: 2, s: '4=2/2' }] },
    a: { v: 1, ws: 'WA1', sub: 'math', lvl: 'P5', at: T0, r: [{ l: 'P5.FR.2.6', q: 2, x: 4, g: 1, a: 4, s: '1=0/2 2=1/2' }] },
    junk: 'not an entry',
    sci: { sub: 'science', r: [] }
  }
};

test('the roster row is read into worksheets, oldest first, junk dropped', () => {
  const s = LV.pure.sheetsOf(profile);
  assert.deepEqual(s.map(x => x.ws), ['WA1', 'SA1']);
  assert.equal(LV.count(profile), 2);
  assert.equal(LV.count({}), 0);
  assert.equal(LV.count(null), 0);
  const m = LoMarks.matrix(s);
  assert.deepEqual(m.rows[0].cells.map(c => c.got + '/' + c.att), ['1/4', '2/2']);
  assert.equal(m.rows[0].trend, 'up');
});

test('a non-teacher is refused before anything is drawn', () => {
  let said = '';
  LV.open({ isTeacher: () => false, toast: t => { said = t; } });
  assert.match(said, /Only the teacher/);
});

test('it only reads: no write anywhere, and nothing drawn as markup', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/\.(set|add|update)\(\{|\.delete\(\)|FieldValue|\.doc\([^)]*\)\.(set|update)/.test(code));
  assert.ok(!/innerHTML\s*=\s*'[^']/.test(code), 'innerHTML is only ever cleared');
  assert.ok(!/askGemini|fetch\(/.test(code), 'no model, no network beyond the roster read');
});

test('the Students window opens it for the teacher, and the files are loaded', () => {
  assert.match(HTML, /<link rel="stylesheet" href="lo-marks\.css\?v=1\.188\.0">/);
  assert.match(HTML, /<link rel="stylesheet" href="lo-view\.css">/);
  assert.match(HTML, /<script src="lo-marks\.js\?v=1\.188\.0"><\/script>\n<script src="lo-practice\.js\?v=1\.188\.0"><\/script>\n<script src="lo-view\.js\?v=1\.188\.0"><\/script>/);
  assert.match(HTML, /<link rel="stylesheet" href="lo-practice\.css\?v=1\.188\.0">/);
  assert.ok(HTML.indexOf('src="lo-marks.js?') < HTML.indexOf('src="lo-view.js?'), 'the table is loaded before the window');
  assert.match(HTML, /LoView\.open\(\{ db: db, uid: uid, profile: p, collection: PROFILES_COLLECTION, toast: toast,\s*isTeacher: function \(\) \{ return !!\(currentUser && isAdmin\(currentUser\) && !actingStudent\); \},/);
  assert.match(HTML, /ask: loPracticeAsk,\s*parse: function \(raw\) \{ return _parseAIJson\(raw\); \} \}\);/);
  assert.match(HTML, /function loPracticeAsk\(prompt, opts\) \{[\s\S]{0,200}aiGrounding\('teach'/);
  assert.match(HTML, /'📐 Objectives \(' \+ loN \+ '\)'/);
  assert.match(CSS, /\.loBack\.open/);
});

test('✏️ the practice window reads the roster row\'s maths mistakes, and nothing of another subject', () => {
  globalThis.LoPractice = require('../lo-practice.js');
  const rows = LV.pure.mistakesOf({ tutorMistakes: [
    { q: 'What is 3/4 of 20?', n: '5', doc: 'WA1', sub: 'math', lo: 'P4.FR.1.2', v: 'wrong', ans: '15', mine: '12', id: 'a' },
    { q: 'Why does ice melt?', n: '2', doc: 'Sci 1', sub: 'science', lo: '', v: 'wrong', id: 'b' },
    'junk', null
  ] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lo, 'P4.FR.1.2');
  assert.equal(rows[0].ws, 'WA1');
  assert.deepEqual(LV.pure.mistakesOf(null), []);
  assert.deepEqual(LV.pure.mistakesOf({}), []);
});

test('✏️ the model is handed in by the Students window — lo-view.js never names one', () => {
  assert.match(SRC, /ask: o\.ask/);
  assert.match(SRC, /onRow: h\.onRow, onSheet: h\.onSheet, onPractice: h\.onPractice/);
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/askGemini|fetch\(/.test(code));
});

test('👆 a coloured cell finds the student\'s mistakes on that paper and objective, with their pictures', () => {
  globalThis.LoPractice = require('../lo-practice.js');
  assert.match(SRC, /onCell: cellOpen,/);
  assert.match(SRC, /P\.preview\(\{/);
  assert.match(SRC, /onCell: h\.onCell, onCellHover: h\.onCellHover, onCellLeave: h\.onCellLeave/);
  const rows = LoPractice.norm([
    { q: 'The bar graph… [The bars show Walk: 80]', n: '30', doc: 'WA1', sub: 'math', lo: 'P3.WN.2.1', v: 'wrong', id: 'a',
      figs: ['https://firebasestorage.googleapis.com/f0'] },
    { q: 'Other', n: '2', doc: 'SA1', sub: 'math', lo: 'P3.WN.2.1', v: 'wrong', id: 'b' }
  ], 'math', 'mirror');
  const pick = { sel: { los: ['P3.WN.2.1'], tkeys: [], topics: [], docId: 'x', ws: 'WA1' } };
  const hit = rows.filter(m => LoPractice.matches(m, pick.sel));
  assert.deepEqual(hit.map(m => m.n), ['30'], 'only that paper');
  assert.equal(LoPractice.tierOf(hit[0]), 'figs', 'the mirror\'s figures are drawn under the wording');
});
