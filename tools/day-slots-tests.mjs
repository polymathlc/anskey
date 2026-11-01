// 🕒 Lesson times fold (v1.169.0): the pure half, run out of index.html.
//   node --test tools/day-slots-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function cut(start, end) {
  const i = html.indexOf(start);
  assert.ok(i >= 0, 'missing ' + start);
  const j = html.indexOf(end, i);
  assert.ok(j > i, 'missing ' + end);
  return html.slice(i, j + end.length);
}
const START = '/* ================= 🕒 Lesson times fold (v1.169.0)';
const END = '/* ================= End lesson times fold ================= */';
const section = cut(START, END);

function load(over = {}) {
  const ctx = Object.assign({
    currentUser: { uid: 'teacher' }, actingStudent: null,
    LEVELS: ['P3', 'P4', 'P5', 'P6', 'S1'],
    levelLabel: (l) => (l === 'S1' ? 'Sec 1' : l),
    subjectLabel: (s) => ({ math: 'Mathematics', science: 'Science', both: 'Maths & Science' })[s] || '',
    SLOT_OTHER: 'other', DAY_UNDATED: '(no day)',
    $: () => null, document: {}, Date, Object, Array, String, Math
  }, over);
  vm.createContext(ctx);
  vm.runInContext(section, ctx);
  return ctx;
}
const plain = (v) => JSON.parse(JSON.stringify(v));

test('the summary lists levels in teaching order and subjects in a fixed order', () => {
  const c = load();
  const s = c.qSlotSummary([
    { data: { level: 'P6', subject: 'science' } },
    { data: { level: 'P4', subject: 'math', starred: true } },
    { data: { level: 'P6', subject: 'science' } },
    { data: { level: 'S1', subject: 'both' } }
  ], c.LEVELS);
  assert.deepEqual(plain(s), { levels: ['P4', 'P6', 'S1'], subjects: ['math', 'science', 'both'],
    count: 4, starred: 1, unassigned: 0, hidden: 0 });
});

test('a worksheet with no level or subject is counted, never dropped', () => {
  const c = load();
  const s = c.qSlotSummary([{ data: { level: 'P5' } }, { data: {} }, { data: { subject: 'math' } }]);
  assert.equal(s.count, 3);
  assert.equal(s.unassigned, 3);
  assert.deepEqual(plain(s.levels), ['P5']);
  assert.deepEqual(plain(s.subjects), ['math']);
});

test('an empty lesson summarises to nothing', () => {
  const c = load();
  assert.deepEqual(plain(c.qSlotSummary([])), { levels: [], subjects: [], count: 0, starred: 0, unassigned: 0, hidden: 0 });
  assert.equal(c.qSlotSummary(null).count, 0);
});

test('an unknown level sorts after the known ones rather than vanishing', () => {
  const c = load();
  const s = c.qSlotSummary([{ data: { level: 'K2', subject: 'math' } }, { data: { level: 'P3', subject: 'math' } }]);
  assert.deepEqual(plain(s.levels), ['P3', 'K2']);
});

test('the words say the day, time, level, subject and count', () => {
  const c = load();
  const s = c.qSlotSummary([{ data: { level: 'P5', subject: 'science', starred: true } },
    { data: { level: 'P5', subject: 'science' } }]);
  const t = c.qSlotSummaryText('Monday', '3:00 – 4:45pm', s, c.levelLabel, c.subjectLabel);
  assert.equal(t, 'Monday 3:00 – 4:45pm · P5 Science · 2 worksheets · ★ 1 to open');
  const one = c.qSlotSummaryText('', 'Other times', c.qSlotSummary([{ data: { level: 'S1' } }]), c.levelLabel, c.subjectLabel);
  assert.equal(one, 'Other times · Sec 1 · 1 worksheet · ⚠ 1 unassigned');
});

test('open/fold choices default as asked, then remember the choice', () => {
  const c = load();
  assert.equal(c.qSlotIsOpen('Monday', '0', false), false);
  assert.equal(c.qSlotIsOpen('Monday', '0', true), true);
  c.qSlotRemember('Monday', '0', true);
  assert.equal(c.qSlotIsOpen('Monday', '0', false), true);
  c.qSlotRemember('Monday', '0', false);
  assert.equal(c.qSlotIsOpen('Monday', '0', true), false, 'a fold beats the student default');
  assert.equal(c.qSlotIsOpen('Monday', '1', false), false, 'other lessons are untouched');
  assert.equal(c.qSlotIsOpen('Tuesday', '0', false), false, 'other days are untouched');
});

test('a choice belongs to the account, and to the student a device was handed to', () => {
  const c = load();
  c.qSlotRemember('Monday', '0', true);
  c.currentUser = { uid: 'someone-else' };
  assert.equal(c.qSlotIsOpen('Monday', '0', false), false);
  c.currentUser = { uid: 'teacher' };
  c.actingStudent = { uid: 'kid-1' };
  assert.equal(c.qSlotIsOpen('Monday', '0', false), false);
  c.actingStudent = null;
  assert.equal(c.qSlotIsOpen('Monday', '0', false), true);
  c.qSlotForgetAll();
  assert.equal(c.qSlotIsOpen('Monday', '0', false), false);
});

test('the memory is bounded, dropping the oldest choices first', () => {
  const c = load();
  for (let i = 0; i < c.QSLOT_OPEN_MAX + 25; i++) c.qSlotRemember('Day' + i, '0', true);
  assert.equal(Object.keys(c.qSlotOpenState).length, c.QSLOT_OPEN_MAX);
  assert.equal(c.qSlotIsOpen('Day0', '0', false), false, 'oldest forgotten');
  assert.equal(c.qSlotIsOpen('Day' + (c.QSLOT_OPEN_MAX + 24), '0', false), true, 'newest kept');
});

test('the list builds every lesson through the fold, and the drag opens it', () => {
  const groups = cut('function renderQuestionGroups(list, docs) {', '/* ================= Arranging the list by hand');
  assert.match(groups, /qSlotSection\(day, k, items, \{ mine: isMySlot \}\)/);
  assert.doesNotMatch(groups, /manySlots/, 'every lesson has its heading, even the only one');
  const place = cut('function placeQDrag(x, y) {', 'function firstRowIn(section)');
  assert.equal((place.match(/qSlotDragOpen\(/g) || []).length, 3, 'all three drop routes open a folded lesson');
  const up = cut('function onQDragUp() {', 'async function saveQArrangement');
  assert.match(up, /qSlotRemember\(day, slot, true\)/, 'the lesson a card lands in stays open');
});

test('folded rows hide their worksheets in CSS, and the heading keeps .qSlotLine for the drag', () => {
  assert.match(html, /\.qSlotSection\.collapsed > \.qItemRow \{ display: none; \}/);
  assert.match(section, /'qSlotLine qSlotHead'/);
  assert.doesNotMatch(section, /localStorage/, 'open lessons are remembered for the visit only');
});
