// node --test tools/reward-roster-tests.mjs
//
// The Reward window adds names to the reward system's roster. In the rewards
// app (polymathlc/rewards) a student finds their record by level → class →
// name, so the level written here is the level the student will choose. These
// run the SHIPPED helpers cut out of index.html, and — when the rewards repo is
// checked out beside this one — check its `normLevel` agrees with ours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function cut(start, end, src = html) {
  const a = src.indexOf(start);
  assert.ok(a !== -1, 'missing: ' + start);
  const b = src.indexOf(end, a + start.length);
  assert.ok(b !== -1, 'missing: ' + end);
  return src.slice(a, b);
}

const helpers = cut('function rwNormLevel(v) {', 'var RW_DAY_KEYS');
const suggest = cut('function rwSuggestedLevel() {', 'function renderRewardList() {');
const add = cut('async function rwAddStudentToClass() {', '// Drops just this class from the student.');

function load(state) {
  const ctx = { wsMeta: state.wsMeta || {}, rwClass: state.rwClass || '', rwStudentsInClass: () => state.students || [] };
  vm.createContext(ctx);
  vm.runInContext(helpers + suggest + ';this.rwNormLevel = rwNormLevel; this.rwClassLevel = rwClassLevel; this.rwSuggestedLevel = rwSuggestedLevel;', ctx);
  return ctx;
}

const SPELLINGS = [
  ['P5', 'P5'], ['p5', 'P5'], ['P 5', 'P5'], ['p.5', 'P5'], ['Pri 5', 'P5'], ['primary 5', 'P5'], ['  Primary   5 ', 'P5'],
  ['S1', 'S1'], ['s1', 'S1'], ['Sec 1', 'S1'], ['secondary 1', 'S1'],
  ['', ''], [null, ''], [undefined, ''], ['  Sec 1 Express ', 'Sec 1 Express'], ['Kindergarten', 'Kindergarten']
];

test('a level is written the way the rewards app groups it', () => {
  const { rwNormLevel } = load({});
  for (const [v, want] of SPELLINGS) assert.equal(rwNormLevel(v), want, JSON.stringify(v));
});

test('the class’s own level wins over the worksheet’s', () => {
  const p6 = [{ level: 'P6' }, { level: 'p6' }, { level: 'P5' }, { level: '' }];
  // A P5 worksheet taught to a P6 class: this is the case that hid a pupil.
  assert.equal(load({ wsMeta: { level: 'P5' }, rwClass: 'P6 Sci', students: p6 }).rwSuggestedLevel(), 'P6');
  // A class nobody has a level for falls back to the worksheet's, normalised.
  assert.equal(load({ wsMeta: { level: 'primary 4' }, rwClass: 'New', students: [{ level: '' }] }).rwSuggestedLevel(), 'P4');
  // Neither: nothing is guessed, and the add then asks for one.
  assert.equal(load({ wsMeta: {}, rwClass: 'New', students: [] }).rwSuggestedLevel(), '');
});

test('the majority is counted on the normalised level, ties settled the same way every time', () => {
  const { rwClassLevel } = load({});
  assert.equal(rwClassLevel([{ level: 'p5' }, { level: 'Primary 5' }, { level: 'P6' }]), 'P5');
  assert.equal(rwClassLevel([{ level: 'P6' }, { level: 'P5' }]), 'P5');
  assert.equal(rwClassLevel([{ level: '' }, {}, null]), '');
  assert.equal(rwClassLevel(undefined), '');
});

test('a name cannot be added without a level, and the level is normalised before it is saved', () => {
  assert.match(add, /var level = rwNormLevel\(levelEl\.value\);/);
  const guard = add.indexOf('if (!level)');
  const write = add.indexOf("db.collection('students').add(");
  assert.ok(guard !== -1 && write !== -1 && guard < write, 'the empty-level refusal must come before the write');
  // The record still carries the fields the rewards app's claim rule reads.
  assert.match(add, /uid: null,/);
  assert.match(add, /slots: \[rwClass\],/);
});

test('rwNormLevel agrees with the rewards app’s normLevel', (t) => {
  const candidates = ['../../rewards/index.html', '../../polymathlc/rewards/index.html'].map(p => new URL(p, import.meta.url));
  const file = candidates.find(u => existsSync(u));
  if (!file) { t.skip('polymathlc/rewards is not checked out beside this repo'); return; }
  const theirs = readFileSync(file, 'utf8');
  const src = cut('function normLevel(v) {', 'function setupChoices(all) {', theirs);
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src + ';this.normLevel = normLevel;', ctx);
  const { rwNormLevel } = load({});
  for (const [v] of SPELLINGS.concat([['P10'], ['P 6 '], ['sec.2'], ['Primary'], ['5']])) {
    assert.equal(rwNormLevel(v), ctx.normLevel(v), JSON.stringify(v));
  }
});
