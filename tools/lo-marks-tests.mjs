/* 📐 lo-marks.js — marks by learning objective, paper by paper. This file
   is the SAME in Study Buddy (polymathlc/tutor) and Ans Key
   (polymathlc/anskey), and so is the module it tests: when both
   repositories are checked out side by side, the last tests compare the
   two copies byte for byte, and the catalogue against the maths app's own
   MOE_SYLLABUS when polymathlc/math is beside them.

   Run: node --test tools/lo-marks-tests.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const LM = require('../lo-marks.js');
const SRC = fs.readFileSync(new URL('../lo-marks.js', import.meta.url), 'utf8');
const CSS = fs.readFileSync(new URL('../lo-marks.css', import.meta.url), 'utf8');
const DAY = 86400000;
const T0 = Date.UTC(2026, 8, 1, 2, 0, 0);

/* A worksheet as Study Buddy keeps it: `diagnostic` is diagSummary(). */
function ws(name, at, rows, level) {
  return { name, subject: 'math', level: level || 'P5', diagnostic: { v: 1, subject: 'math', level: level || 'P5', at, rows } };
}
function row(lo, got, att, tot, qs, extra) {
  return Object.assign({ t: '', n: '', lo, q: (qs || '').split(' ').filter(Boolean).length || 1,
                         tot: tot == null ? att : tot, got, att, qs: qs || '' }, extra || {});
}
function sheets(list) {
  const map = {};
  list.forEach((w, i) => { map['ws' + i] = LM.sheetEntry(w); });
  return LM.sheetsOf(map);
}

test('the catalogue is the MOE Primary Mathematics syllabus, P1 to P6, 240 objectives with unique ids', () => {
  const c = LM.catalogue();
  assert.equal(c.list.length, 240);
  assert.deepEqual(c.levels, ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
  assert.equal(new Set(c.list.map(e => e.id)).size, 240);
  for (const e of c.list) assert.match(e.id, /^P[1-6]\.[A-Z]+\.\d+\.\d+$/, e.id);
  assert.equal(LM.objective('P5.FR.2.6').text, 'solving word problems involving addition, subtraction and multiplication');
  assert.equal(LM.objective('p5.fr.2.6').id, 'P5.FR.2.6', 'an id is matched whatever its case');
  assert.equal(LM.objective('P9.XX.1.1'), null);
  assert.equal(LM.entries('science').length, 0, 'only maths has a ladder here');
  /* The topic key is Study Buddy's `tkey`: code, then "sub: topic". */
  assert.equal(LM.objective('P5.FR.2.6').tkey, 'P5.FR Fractions: Four Operations');
  assert.ok(LM.topicOf('P5.FR Fractions: Four Operations'));
});

test('a half mark reads as ½, and a whole mark as a whole number', () => {
  assert.equal(LM.fmt(1.5), '1½');
  assert.equal(LM.fmt(0.5), '½');
  assert.equal(LM.fmt(3), '3');
  assert.equal(LM.fmt(0), '0');
  assert.equal(LM.fmt(0.25), '0.25');
});

test('the questions in a cell travel as one short string and come back the same', () => {
  const s = LM.encodeQs([{ n: '3a', got: 1.5, tot: 2, marked: true }, { n: 7, got: 0, tot: 2, marked: false }, { n: '1 = 2/3', got: 1, tot: 1 }]);
  assert.equal(s, '3a=1½/2 7=-/2 1=2/3=1/1'.replace('1=2/3=1/1', '123=1/1'));
  const back = LM.decodeQs(s);
  assert.deepEqual(back[0], { n: '3a', got: 1.5, tot: 2, blank: false });
  assert.deepEqual(back[1], { n: '7', got: 0, tot: 2, blank: true });
  assert.equal(LM.qsText(back.slice(0, 2)), 'Q3a 1½/2 · Q7 blank (2)');
  const many = Array.from({ length: 90 }, (_, i) => ({ n: i + 1, got: 1, tot: 1 }));
  assert.equal(LM.decodeQs(LM.encodeQs(many)).length, LM.QS_MAX, 'bounded');
  assert.deepEqual(LM.decodeQs('junk == / x'), [], 'garbage reads as nothing');
});

test('a maths worksheet summary becomes one small entry; anything else becomes nothing', () => {
  const e = LM.sheetEntry(ws('P5 WA1', T0, [
    row('P5.FR.2.6', 3, 4, 4, '1=2/2 2=1/2'),
    row('', 1, 2, 2, '5=1/2', { t: 'P5.FR Fractions: Four Operations', n: 'Fractions: Four Operations' }),
    row('', 0, 1, 1, '9=0/1', { n: 'Something odd' })
  ]));
  assert.equal(e.v, 1);
  assert.equal(e.sub, 'math');
  assert.equal(e.lvl, 'P5');
  assert.equal(e.at, T0);
  assert.equal(e.r.length, 3);
  assert.deepEqual(e.r[0], { l: 'P5.FR.2.6', k: '', p: '', q: 2, x: 4, g: 3, a: 4, s: '1=2/2 2=1/2' });
  assert.equal(e.r[1].k, 'P5.FR Fractions: Four Operations', 'a topic-only row keeps its topic key');
  assert.equal(e.r[2].p, 'Something odd', 'an unplaced row keeps the marking\'s words');
  /* Firestore refuses an array inside an array: nothing here is one. */
  const nested = (v) => Array.isArray(v) ? v.some(x => Array.isArray(x) || nested(x)) : (v && typeof v === 'object' ? Object.values(v).some(nested) : false);
  assert.equal(nested(e), false);
  assert.ok(JSON.stringify(e).length < 2000);
  assert.equal(LM.sheetEntry({ name: 'Sci', diagnostic: { subject: 'science', rows: [row('heat-flow', 1, 1)] } }), null);
  assert.equal(LM.sheetEntry(ws('Nothing placed', T0, [row('', 1, 1, 1, '', { n: 'free words' })])), null,
    'a paper that filed nothing on the list is a column of dashes, so it is not kept');
  assert.equal(LM.sheetEntry({ name: 'x' }), null);
  assert.equal(LM.sheetEntry(null), null);
});

test('a row is never more right than it was attempted, nor attempted beyond the paper', () => {
  const e = LM.sheetEntry(ws('Odd', T0, [row('P5.FR.2.6', 9, 4, 2)]));
  assert.equal(e.r[0].g, 4);
  assert.equal(e.r[0].x, 4);
  const c = LM.cleanEntry('id', { sub: 'math', ws: 'x', at: 1, r: [{ l: 'P5.FR.2.6', g: 7, a: 2, x: -1 }] });
  assert.equal(c.rows[0].got, 2);
  assert.equal(c.rows[0].tot, 2);
});

test('whatever is on the roster row is read safely', () => {
  assert.deepEqual(LM.sheetsOf(null), []);
  assert.deepEqual(LM.sheetsOf({ a: 'x', b: null, c: { sub: 'science', r: [] }, d: { sub: 'math', r: 'no' } }), []);
  const got = LM.sheetsOf({
    late: { sub: 'math', ws: '<b>Late</b>', at: T0 + DAY, r: [{ l: 'P5.FR.2.6', g: 1, a: 1, x: 1 }] },
    early: { sub: 'math', ws: 'Early', at: T0, r: [{ l: 'NOT.AN.ID', p: 'free', g: 0, a: 1, x: 1 }] }
  });
  assert.deepEqual(got.map(s => s.id), ['early', 'late'], 'oldest first');
  assert.equal(got[1].ws, '<b>Late</b>', 'a name is kept as text — the table draws it with textContent');
  assert.equal(got[0].rows[0].lo, '', 'an id that is not on the list is never believed');
  assert.equal(got[0].rows[0].tp, 'free');
});

test('the oldest entries beyond the cap are the ones pruned', () => {
  const map = {};
  for (let i = 0; i < LM.SHEETS_MAX + 3; i++) map['w' + i] = { at: T0 + i * DAY };
  assert.deepEqual(LM.pruneIds(map), ['w0', 'w1', 'w2']);
  assert.deepEqual(LM.pruneIds({ a: { at: 1 } }), []);
});

test('the table: one row per objective, one column per paper, got over attempted in every cell', () => {
  const S = sheets([
    ws('WA1', T0, [row('P5.FR.2.6', 1, 4, 4, '1=0/2 2=1/2'), row('P5.WN.1.1', 2, 2, 2, '3=2/2')]),
    ws('WA2', T0 + 7 * DAY, [row('P5.FR.2.6', 4, 4, 4, '1=2/2 2=2/2'), row('P5.WN.1.1', 0, 0, 2, '4=-/2')]),
    ws('WA3', T0 + 14 * DAY, [row('P5.FR.2.6', 2, 2, 2, '6=2/2')])
  ]);
  const m = LM.matrix(S, { level: 'all' });
  assert.deepEqual(m.cols.map(c => c.ws), ['WA1', 'WA2', 'WA3']);
  const fr = m.rows.find(r => r.id === 'P5.FR.2.6');
  assert.deepEqual(fr.cells.map(c => c && [c.got, c.att]), [[1, 4], [4, 4], [2, 2]]);
  assert.equal(fr.got, 7);
  assert.equal(fr.att, 10);
  assert.equal(fr.pct, 70);
  assert.equal(fr.trend, 'up', '25% on the older half, 100% on the newer');
  const wn = m.rows.find(r => r.id === 'P5.WN.1.1');
  assert.equal(wn.cells[1].att, 0, 'a blank is not attempted…');
  assert.equal(wn.cells[1].tot, 2, '…but its marks are kept');
  assert.equal(wn.cells[2], null, 'a paper that never tested it has no cell');
  assert.equal(wn.pct, 100, 'the blank does not pull the rate down');
  assert.equal(wn.trend, 'new', 'only one paper attempted it');
  assert.equal(m.cols[1].got, 4);
  assert.equal(m.cols[1].att, 4);
  assert.equal(m.total.pct, Math.round(9 / 12 * 100));
  /* Grouped under level · sub-strand · topic, with subtotals. */
  assert.ok(m.groups.length >= 2);
  const g = m.groups.find(x => x.rows.includes(fr));
  assert.equal(g.level, 'P5');
  assert.equal(g.topic, 'Four Operations');
  assert.equal(g.got, 7);
  /* Syllabus order: Whole Numbers comes before Fractions in P5. */
  assert.ok(m.rows.indexOf(wn) < m.rows.indexOf(fr));
  assert.deepEqual(m.weak.map(r => r.id), ['P5.FR.2.6'], 'the only objective under 80%');
});

test('trends go both ways, and need two papers', () => {
  const down = sheets([
    ws('A', T0, [row('P5.FR.2.6', 4, 4)]),
    ws('B', T0 + DAY, [row('P5.FR.2.6', 4, 4)]),
    ws('C', T0 + 2 * DAY, [row('P5.FR.2.6', 1, 4)]),
    ws('D', T0 + 3 * DAY, [row('P5.FR.2.6', 1, 4)])
  ]);
  assert.equal(LM.matrix(down).rows[0].trend, 'down');
  const same = sheets([ws('A', T0, [row('P5.FR.2.6', 3, 4)]), ws('B', T0 + DAY, [row('P5.FR.2.6', 3, 4)])]);
  assert.equal(LM.matrix(same).rows[0].trend, 'steady');
});

test('a level filter keeps that level\'s rows and only the papers that tested it', () => {
  const S = sheets([
    ws('P4 paper', T0, [row('P4.WN.1.1', 1, 2)], 'P4'),
    ws('P5 paper', T0 + DAY, [row('P5.FR.2.6', 2, 2), row('P4.WN.1.1', 1, 1)])
  ]);
  const all = LM.matrix(S, { level: 'all' });
  assert.deepEqual(all.levels, ['P4', 'P5']);
  assert.equal(all.cols.length, 2);
  const p5 = LM.matrix(S, { level: 'P5' });
  assert.deepEqual(p5.rows.map(r => r.id), ['P5.FR.2.6']);
  assert.deepEqual(p5.cols.map(c => c.ws), ['P5 paper']);
  const p4 = LM.matrix(S, { level: 'P4' });
  assert.deepEqual(p4.cols.map(c => c.ws), ['P4 paper', 'P5 paper'], 'a P5 paper that fell back to a P4 objective shows under P4');
});

test('"objectives not tested yet" lists the rest of the level, as coverage', () => {
  const S = sheets([ws('A', T0, [row('P5.FR.2.6', 2, 2)])]);
  const m = LM.matrix(S, { level: 'P5', untested: true });
  const n5 = LM.catalogue().list.filter(e => e.level === 'P5').length;
  assert.equal(m.rows.filter(r => r.kind === 'lo').length, n5);
  assert.equal(m.tested, 1);
  assert.equal(m.syllabusCount, n5);
  assert.ok(m.rows.filter(r => !r.papers).every(r => r.cells.every(c => c === null)));
});

test('topic-only and unplaced rows sit after the objectives, never mixed into one', () => {
  const S = sheets([ws('A', T0, [
    row('P5.FR.2.6', 1, 1),
    row('', 1, 2, 2, '', { t: 'P5.FR Fractions: Four Operations', n: 'Fractions' }),
    row('', 0, 1, 1, '', { n: 'Puzzle' })
  ])]);
  const m = LM.matrix(S);
  const kinds = m.rows.map(r => r.kind);
  assert.deepEqual(kinds, ['lo', 'topic', 'unlisted']);
  assert.equal(m.groups.at(-1).topic, LM.UNLISTED);
  const fr = m.groups.find(g => g.topic === 'Four Operations');
  assert.equal(fr.rows.length, 2, 'the topic-only row is under its topic');
});

test('weakest first puts the lowest rate at the top', () => {
  const S = sheets([ws('A', T0, [row('P5.FR.2.6', 2, 2), row('P5.WN.1.1', 0, 2), row('P5.WN.2.1', 1, 2)])]);
  const m = LM.matrix(S, { sort: 'weak' });
  assert.deepEqual(m.flat.map(r => r.id), ['P5.WN.1.1', 'P5.WN.2.1', 'P5.FR.2.6']);
});

test('the copy is tab-separated and one line per row', () => {
  const S = sheets([ws('WA\t1', T0, [row('P5.FR.2.6', 1, 2, 3, '1=1/2 2=-/1')])]);
  const text = LM.tsv(LM.matrix(S), 'Ali');
  const lines = text.split('\n');
  assert.match(lines[0], /^Ali — maths marks by learning objective$/);
  assert.equal(lines[1].split('\t').length, 3 + 1 + 3);
  assert.ok(!/WA\t1/.test(text), 'a tab in a name never splits a column');
  assert.ok(lines.some(l => l.startsWith('P5\tP5.FR.2.6\t') && l.includes('\t1/2\t')));
  assert.match(lines.at(-1), /^\t\tPaper/);
});

/* ---- drawing, against a tiny DOM ---- */
function fakeDoc() {
  class Node {
    constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this.listeners = {}; this._text = ''; this.className = '';
      const self = this;
      this.classList = { add(c) { self.className = (self.className + ' ' + c).trim(); }, contains(c) { return self.className.split(' ').includes(c); } };
      this.style = {}; }
    appendChild(c) { this.children.push(c); return c; }
    set textContent(v) { this._text = String(v); this.children = []; }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
    set innerHTML(v) { if (v !== '') throw new Error('markup is never written'); this.children = []; this._text = ''; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    addEventListener(k, fn) { (this.listeners[k] = this.listeners[k] || []).push(fn); }
    fire(k, ev) { (this.listeners[k] || []).forEach(fn => fn(ev || { key: '', preventDefault() {} })); }
    all(pred, out = []) { if (pred(this)) out.push(this); this.children.forEach(c => c.all && c.all(pred, out)); return out; }
  }
  return { createElement: t => new Node(t), createTextNode: t => { const n = new Node('#text'); n._text = t; return n; }, Node };
}

test('mount draws the table, the chips filter it, a tapped cell names its questions', async () => {
  const doc = fakeDoc();
  const host = doc.createElement('div');
  const S = sheets([
    ws('WA1', T0, [row('P5.FR.2.6', 1, 2, 2, '1=1/2')]),
    ws('WA2', T0 + DAY, [row('P4.WN.1.1', 2, 2, 2, '2=2/2')], 'P4')
  ]);
  let copied = '';
  const v = LM.mount(host, { sheets: S, doc, name: 'Ali', copy: t => { copied = t; return null; } });
  const table = host.all(n => n.tagName === 'table')[0];
  assert.ok(table, 'a table is drawn');
  const cells = host.all(n => n.tagName === 'td' && /lmCell/.test(n.className) && !/lmEmpty/.test(n.className) && !/lmGrpCell/.test(n.className) && !/lmFootCell/.test(n.className));
  assert.equal(cells.length, 2);
  assert.ok(cells.some(c => c.textContent === '1/2' && /lm-mid/.test(c.className)));
  const detail = host.all(n => /lmDetail/.test(n.className))[0];
  cells.find(c => c.textContent === '1/2').fire('click');
  assert.match(detail.textContent, /Q1 1\/2/);
  const chips = host.all(n => n.tagName === 'button' && /lmChip/.test(n.className));
  assert.deepEqual(chips.map(c => c.textContent), ['All levels', 'P4', 'P5']);
  chips.find(c => c.textContent === 'P5').fire('click');
  assert.equal(v.state.level, 'P5');
  const after = host.all(n => n.tagName === 'td' && /lmCell/.test(n.className) && !/lmEmpty|lmGrpCell|lmFootCell/.test(n.className));
  assert.equal(after.length, 1);
  host.all(n => n.tagName === 'button' && /lmCopy/.test(n.className))[0].fire('click');
  assert.match(copied, /^Ali — /);
  v.update([]);
  assert.match(host.textContent, /No maths worksheet has been marked by objective yet/);
});

test('one paper\'s level is picked for you', () => {
  const doc = fakeDoc();
  const host = doc.createElement('div');
  const v = LM.mount(host, { sheets: sheets([ws('A', T0, [row('P5.FR.2.6', 1, 1)])]), doc });
  assert.equal(v.state.level, 'P5');
});

test('the module is pure apart from drawing: no network, no model call, no storage', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/fetch\(|XMLHttpRequest|askGemini|firebase|localStorage/.test(code));
  assert.ok(!/\.innerHTML\s*=\s*'[^']/.test(code), 'innerHTML is only ever cleared');
  /* It loads in a browser-like sandbox and names itself on window. */
  const sandbox = { window: {} };
  vm.runInNewContext(SRC, sandbox);
  assert.ok(sandbox.window.LoMarks && sandbox.window.LoMarks.matrix);
  assert.match(CSS, /\.lmTable/);
});

test('the catalogue is the maths app\'s MOE_SYLLABUS, wherever polymathlc/math is checked out beside', () => {
  const parent = new URL('../../', import.meta.url);
  for (const path of ['math/index.html', 'polymathlc/math/index.html']) {
    let html;
    try { html = fs.readFileSync(new URL(path, parent), 'utf8'); } catch (e) { continue; }
    const m = /const MOE_SYLLABUS = (\[[\s\S]*?\n\]);/.exec(html);
    if (!m) continue;
    const tree = vm.runInNewContext('(' + m[1] + ')');
    const theirs = {};
    tree.forEach(L => L.strands.forEach(s => s.subs.forEach(sb => sb.topics.forEach(t => t.los.forEach(r => {
      theirs[L.lv + '.' + sb.k + '.' + r[0]] = r[1];
    })))));
    const ours = {};
    LM.catalogue().list.forEach(e => { ours[e.id] = e.text; });
    for (const id of Object.keys(ours)) assert.equal(ours[id], theirs[id], id + ' differs from the maths app');
    for (const id of Object.keys(theirs)) assert.ok(ours[id], id + ' is in the maths app but not here — append it');
  }
});

test('✏️ the table reads weakest topic first and most marks lost too', () => {
  const s = sheets([
    ws('A', T0, [row('P5.FR.2.6', 1, 4, 4), row('P5.FR.2.5', 4, 4, 4), row('P5.WN.1.1', 3, 4, 6)])
  ]);
  assert.deepEqual(LM.SORT_KEYS, ['syllabus', 'weak', 'weaktopic', 'lost']);
  const wt = LM.matrix(s, { sort: 'weaktopic' });
  assert.equal(wt.sort, 'weaktopic');
  assert.ok(!wt.flat, 'the topics keep their objectives under them');
  assert.ok(wt.groups[0].pct <= wt.groups[wt.groups.length - 1].pct, 'the weakest topic is first');
  assert.equal(wt.groups.find(g => g.rows.some(r => r.id === 'P5.FR.2.6')).rows[0].id, 'P5.FR.2.6', 'and its weakest objective first');
  const lost = LM.matrix(s, { sort: 'lost' });
  assert.equal(lost.flat[0].id, 'P5.FR.2.6', '3 marks lost');
  assert.equal(lost.flat[1].id, 'P5.WN.1.1', '1 lost attempted and 2 left blank');
  assert.equal(LM.lostOf({ tot: 6, att: 4, got: 3 }), 3);
  assert.equal(LM.matrix(s, { sort: 'nonsense' }).sort, 'syllabus');
});

test('✏️ a row says which mistakes it stands for, and becomes a practice group', () => {
  const s = sheets([ws('A', T0, [row('P5.FR.2.6', 1, 4, 4, '3=1/2 4=0/2'), row('P5.FR.2.5', 4, 4, 4)])]);
  const m = LM.matrix(s, {});
  const r = m.rows.find(x => x.id === 'P5.FR.2.6');
  assert.deepEqual(LM.selOf(r).los, ['P5.FR.2.6']);
  assert.equal(r.tkey, 'P5.FR Fractions: Four Operations');
  const g = LM.groupOf(r);
  assert.equal(g.code, 'P5.FR.2.6');
  assert.equal(g.pct, 25);
  assert.match(g.qs, /Q3 1\/2/);
  const grp = m.groups[0];
  const gsel = LM.selOf(Object.assign({}, grp, { kind: 'group' }));
  assert.ok(gsel.los.length >= 2, 'a topic stands for every objective of it in the syllabus');
  assert.ok(gsel.los.indexOf('P5.FR.2.6') >= 0);
  assert.deepEqual(gsel.tkeys, ['P5.FR Fractions: Four Operations']);
  const gg = LM.groupOf(grp, 'group');
  assert.equal(gg.kind, 'topic');
  assert.match(gg.key, /^g:/);
  const per = LM.sheetGroups(s[0]);
  assert.equal(per.length, 2, 'one worksheet\'s report has a group per objective it tested');
  assert.ok(per.every(x => /^w:/.test(x.key)));
  assert.deepEqual(LM.sheetGroups(null), []);
});

test('lo-marks.js, its CSS and this test are the same files in Study Buddy and Ans Key, wherever both are checked out', () => {
  const parent = new URL('../../', import.meta.url);
  for (const f of ['lo-marks.js', 'lo-marks.css', 'tools/lo-marks-tests.mjs']) {
    const here = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    for (const repo of ['tutor', 'anskey']) {
      let other;
      try { other = fs.readFileSync(new URL(repo + '/' + f, parent), 'utf8'); } catch (e) { continue; }
      assert.equal(other, here, repo + '/' + f + ' differs');
    }
  }
});
