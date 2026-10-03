// The name wheel's round logic, run against the REAL section of index.html.
// Source-level pins cover the guards; the browser check (wheel-check.mjs)
// covers the window itself.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function cut(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, start);
  return html.slice(a, b);
}
const ctx = vm.createContext({ Math, Date, Array, Object, Number, String });
vm.runInContext(cut('/* ===== NAME WHEEL — rounds (pure) =====', '/* ===== NAME WHEEL — window ====='), ctx);
const W = (code) => vm.runInContext(code, ctx);
const plain = (x) => JSON.parse(JSON.stringify(x));
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
const roster = (...names) => { const s = W('wheelClean(null, "2026-10-07")'); names.forEach(n => W('wheelAddName')(s, n)); return s; };

test('reload preserves the newest same-day question identity but never carries it into the next lesson day', () => {
  const saved = {names:[{id:'ann',n:'Ann',done:true}],round:2,day:'2026-10-07',seeded:true,lastSpinId:'wheel-manual-newer-question'};
  assert.equal(W('wheelClean')(saved,'2026-10-07').lastSpinId,'wheel-manual-newer-question');
  assert.equal(W('wheelClean')(saved,'2026-10-08').lastSpinId,undefined);
  assert.equal(W('wheelClean')({...saved,lastSpinId:'bad/id'},'2026-10-07').lastSpinId,undefined);
});

test('same-name registered students retain separate stable identities across save and reload', () => {
  const state = W('wheelClean(null, "2026-10-07")');
  W('wheelAddName')(state, 'Alex', 'account-a');
  W('wheelAddName')(state, 'Alex', 'account-b');
  assert.equal(W('wheelAddName')(state, 'Alex renamed', 'account-a'), null);
  const restored = W('wheelClean')(JSON.parse(JSON.stringify(state)), '2026-10-07');
  assert.deepEqual(plain(restored.names.map(n => n.id)), ['account-a', 'account-b']);
  const called = [W('wheelPick')(restored, () => 0), W('wheelPick')(restored, () => 0)];
  assert.deepEqual(called, [0, 1]);
});

test('every name is called exactly once before anyone is called again', () => {
  const state = roster('Ann', 'Ben', 'Cai', 'Dee', 'Eli', 'Fay', 'Gus');
  const pick = W('wheelPick');
  for (let round = 1; round <= 4; round++) {
    const seen = [];
    for (let i = 0; i < 7; i++) {
      seen.push(pick(state, Math.random));
      assert.equal(state.round, round, 'the round only advances when a spin opens the next');
    }
    assert.equal(new Set(seen).size, 7, 'round ' + round + ' called someone twice');
  }
});

test('the spin after the last name opens a new round with everyone back on', () => {
  const state = roster('Ann', 'Ben');
  const pick = W('wheelPick');
  pick(state, () => 0); pick(state, () => 0);
  assert.equal(W('wheelRemaining')(state).length, 0);
  assert.equal(state.round, 1);
  pick(state, () => 0);
  assert.equal(state.round, 2);
  assert.equal(W('wheelRemaining')(state).length, 1);
});

test('a name added mid-round is on the wheel now; a removed one is gone', () => {
  const state = roster('Ann', 'Ben', 'Cai');
  const pick = W('wheelPick');
  const first = pick(state, () => 0);
  assert.equal(state.names[first].n, 'Ann');
  W('wheelAddName')(state, 'Dee');
  assert.equal(W('wheelRemaining')(state).length, 3);
  state.names.splice(1, 1);
  const left = W('wheelRemaining')(state).map(i => state.names[i].n);
  assert.deepEqual(plain(left), ['Cai', 'Dee']);
});

test('blank and repeated names are refused, spacing and case are forgiven', () => {
  const state = roster('Ann');
  const add = W('wheelAddName');
  assert.equal(add(state, '   '), null);
  assert.equal(add(state, 'ann'), null);
  assert.equal(add(state, '  Mary   Jane '), state.names[1]);
  assert.equal(state.names[1].n, 'Mary Jane');
  assert.equal(add(state, 'x'.repeat(100)).n.length, 40);
});

test('an empty wheel picks nobody', () => {
  assert.equal(W('wheelPick')(roster(), Math.random), -1);
});

test('a random number of 1 or more cannot run off the end', () => {
  const state = roster('Ann', 'Ben');
  assert.equal(W('wheelPick')(state, () => 0.9999999), 1);
  assert.equal(W('wheelPick')(state, () => 1), 0);
});

test('names stay on a new lesson day, the calls do not', () => {
  const clean = W('wheelClean');
  const saved = { names: [{ n: 'Ann', id: 'a1', done: true }, { n: 'Ben', id: '', done: true }], round: 3, day: '2026-10-07', seeded: true };
  const same = clean(JSON.parse(JSON.stringify(saved)), '2026-10-07');
  assert.deepEqual(plain(same.names.map(n => n.done)), [true, true]);
  assert.equal(same.round, 3);
  const next = clean(JSON.parse(JSON.stringify(saved)), '2026-10-14');
  assert.deepEqual(plain(next.names.map(n => n.n)), ['Ann', 'Ben']);
  assert.deepEqual(plain(next.names.map(n => n.done)), [false, false]);
  assert.equal(next.round, 1);
  assert.equal(next.seeded, true, 'a removed name must not be re-seeded next week');
  assert.equal(next.names[0].id, 'a1');
});

test('damaged storage becomes an empty, usable wheel', () => {
  const clean = W('wheelClean');
  for (const bad of [null, 5, 'x', [], { names: 'no' }, { names: [null, 3, { n: 5 }, { n: '' }] }]) {
    const s = clean(bad, '2026-10-07');
    assert.deepEqual(plain(s.names), []);
    assert.equal(s.round, 1);
  }
});

test('the landing angle leaves the pointer inside the chosen segment', () => {
  const land = W('wheelLandingAngle'), at = W('wheelSegmentAt');
  for (const n of [1, 2, 3, 7, 12, 30]) {
    for (const start of [0, 1.7, -4.2, 123.4]) {
      for (let i = 0; i < n; i++) {
        for (const off of [0.12, 0.5, 0.88]) {
          const a = land(start, i, n, off, 4);
          assert(a >= start + 4 * Math.PI * 2 - 1e-9, 'it must turn at least the whole turns');
          assert.equal(at(a, n), i, `n=${n} i=${i} off=${off} start=${start}`);
        }
      }
    }
  }
});

test('the wheel is the teacher\'s own and every handler asks', () => {
  for (const fn of ['openWheel', 'wheelSpin', 'wheelGive', 'wheelAddFromBox', 'wheelNewRound', 'wheelReseed']) {
    const m = html.match(new RegExp('(?:async )?function ' + fn + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n'));
    assert(m, fn);
    assert(/wheelTeacher\(\)/.test(m[0]), fn + ' must refuse a student itself');
  }
  assert(/wbtn\.style\.display = show/.test(html), 'the button is hidden by applyRewardVisibility');
  assert(/closeWheel\(\);\s*\n\s*rwStudents = \[\]/.test(html), 'an account change closes the wheel');
});

test('marks go through the reward window\'s own transaction', () => {
  assert(/await rwAwardMarks\(student, delta, reason\)/.test(html));
  assert(/reasonOverride \|\| rwReason\(\)/.test(html));
});
