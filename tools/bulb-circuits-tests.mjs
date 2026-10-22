/* =====================================================================
   ⚡ WHERE IS BULB P BRIGHTEST? — the circuits, solved
   ---------------------------------------------------------------------
   apps/bulb-p-circuits.html reproduces a worksheet question (Jason's four
   circuits) and animates the current through each one. Every number the
   page shows — the answer key, the current through each bulb, the width
   of each lane, the value badges, the worked-answer table — comes from
   the nodal solver between the CIRCUIT PURE markers. This cuts that
   section out of the page and runs it, so a wrong wire or a sign error
   fails here instead of teaching a class the wrong physics.

   Run: node --test tools/bulb-circuits-tests.mjs
   ===================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const PAGE = new URL('../apps/bulb-p-circuits.html', import.meta.url);
const html = fs.readFileSync(PAGE, 'utf8');

const START = '/* ===== CIRCUIT PURE (start) =====';
const END = '/* ===== CIRCUIT PURE (end) ===== */';
const from = html.indexOf(START);
const to = html.indexOf(END);
assert.ok(from > 0 && to > from, 'the CIRCUIT PURE markers are in the page');
const section = html.slice(from, to);

const pure = vm.runInNewContext(section + `
;({ APP_VERSION, ANSWER_KEY, CIRCUITS, QUESTION_KEYS, MAX_CELLS, MIN_CELLS, batteryGeometry, buildModel, solveModel,
    laneCurrents, segmentKey, segmentTotals, offsetPolyline, layoutLanes, subjectBulbIds, formatAmount,
    unitWord, amountText, glowLevel, brightnessWord, questionSummary, brightestChoice, clampCells })`, {});

// Arrays made inside the vm have that realm's prototype; compare them as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: expected ${expected}, got ${actual}`);
const solved = (key, cells, removed) => {
  const model = pure.buildModel(key, cells, removed);
  return { model, solution: pure.solveModel(model) };
};

test('the section touches no DOM', () => {
  assert.doesNotMatch(section, /\bdocument\b|\bwindow\b|querySelector|createElement/);
});

test('bulb P gets 2, ½, 1 and 1 units in circuits (1) to (4)', () => {
  const expected = { 1: 2, 2: 0.5, 3: 1, 4: 1 };
  for (const key of pure.QUESTION_KEYS) {
    const { solution } = solved(key);
    near(Math.abs(solution.bulbCurrent.P), expected[key], `circuit (${key})`);
  }
  const { solution } = solved('ref');
  near(Math.abs(solution.bulbCurrent.P), 1, 'one battery and one bulb is the 1-unit measuring stick');
});

test('the answer key is (1), and the solver agrees', () => {
  assert.equal(pure.ANSWER_KEY, 1);
  assert.equal(pure.brightestChoice(), 1);
  const rows = pure.questionSummary();
  assert.deepEqual(plain(rows.map((row) => row.cells)), [2, 1, 2, 3], 'battery counts read off the worksheet');
  assert.deepEqual(plain(rows.map((row) => row.pathBulbs)), [1, 2, 2, 3], 'bulbs on P\'s path');
  rows.forEach((row) => near(row.current, row.cells / row.pathBulbs, `circuit (${row.key}) batteries ÷ bulbs`));
});

test('every bulb and the battery carry what the circuit says', () => {
  const cases = {
    1: { A: 2, B: 2, P: 2, total: 6 },
    2: { A: 1, B: 0.5, P: 0.5, total: 1.5 },
    3: { A: 2, B: 1, P: 1, total: 3 },
    4: { A: 1, B: 1, P: 1, total: 1 }
  };
  for (const [key, values] of Object.entries(cases)) {
    const { solution } = solved(key);
    for (const id of ['A', 'B', 'P']) near(Math.abs(solution.bulbCurrent[id]), values[id], `circuit (${key}) bulb ${id}`);
    near(solution.totalCurrent, values.total, `circuit (${key}) total from the batteries`);
  }
});

test('every route is a real path along wires, bulbs and the battery, clockwise from +', () => {
  for (const key of ['ref', ...pure.QUESTION_KEYS]) {
    const model = pure.buildModel(key);
    const edges = new Set(model.wires.map(([a, b]) => pure.segmentKey(a, b)));
    model.bulbs.forEach((bulb) => edges.add(pure.segmentKey(bulb.from, bulb.to)));
    edges.add(pure.segmentKey('BP', 'BN'));
    for (const branch of model.branches) {
      assert.equal(branch.route[0], 'BP', `${key}/${branch.id} starts at the + terminal`);
      assert.equal(branch.route.at(-1), 'BP', `${key}/${branch.id} closes through the battery`);
      for (let i = 0; i < branch.route.length - 1; i++) {
        assert.ok(edges.has(pure.segmentKey(branch.route[i], branch.route[i + 1])), `${key}/${branch.id}: ${branch.route[i]}→${branch.route[i + 1]} is in the circuit`);
      }
      const onRoute = new Set();
      for (let i = 0; i < branch.route.length - 1; i++) onRoute.add(pure.segmentKey(branch.route[i], branch.route[i + 1]));
      for (const id of branch.bulbs) {
        const bulb = model.bulbs.find((candidate) => candidate.id === id);
        assert.ok(onRoute.has(pure.segmentKey(bulb.from, bulb.to)), `${key}/${branch.id} passes through bulb ${id}`);
      }
      // clockwise: the signed area of the route (y down) is positive
      const pts = branch.route.map((name) => model.points[name]);
      let area = 0;
      for (let i = 0; i < pts.length - 1; i++) area += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
      assert.ok(area > 0, `${key}/${branch.id} runs clockwise`);
    }
    // every bulb belongs to exactly one branch
    for (const bulb of model.bulbs) {
      assert.equal(model.branches.filter((branch) => branch.bulbs.includes(bulb.id)).length, 1, `${key}: bulb ${bulb.id} is on one branch`);
    }
  }
});

test('the lanes add up to the solver on every wire and bulb (current is conserved)', () => {
  const variants = [];
  for (const key of pure.QUESTION_KEYS) {
    for (let cells = pure.MIN_CELLS; cells <= pure.MAX_CELLS; cells++) {
      variants.push([key, cells, []]);
      for (const id of ['A', 'B', 'P']) variants.push([key, cells, [id]]);
    }
  }
  for (const [key, cells, removed] of variants) {
    const { model, solution } = solved(key, cells, removed);
    const totals = pure.segmentTotals(model, pure.laneCurrents(model, solution));
    model.wires.forEach(([a, b], index) => {
      const lane = totals.get(pure.segmentKey(a, b)) || 0;
      near(lane, Math.abs(solution.wireCurrent[index]), `(${key}) ${cells} cells, removed ${removed.join() || 'none'}: wire ${a}-${b}`);
    });
    model.bulbs.forEach((bulb) => {
      const lane = totals.get(pure.segmentKey(bulb.from, bulb.to)) || 0;
      near(lane, Math.abs(solution.bulbCurrent[bulb.id]), `(${key}) ${cells} cells, removed ${removed.join() || 'none'}: bulb ${bulb.id}`);
    });
    near(totals.get(pure.segmentKey('BP', 'BN')) || 0, solution.totalCurrent, `(${key}) battery carries the total`);
  }
});

test('the circuit lab: unscrewing and adding batteries does what a P5 class is taught', () => {
  // A bulb on another branch: P is unchanged, the batteries push less in total.
  let r = solved('1', 2, ['A']);
  near(r.solution.bulbCurrent.P, 2, 'circuit (1) without bulb A: P keeps 2 units');
  near(r.solution.totalCurrent, 4, 'circuit (1) without bulb A: total falls to 4');
  r = solved('3', 2, ['A']);
  near(Math.abs(r.solution.bulbCurrent.P), 1, 'circuit (3) without bulb A: P keeps 1 unit');
  // A bulb in series with P: P goes out.
  for (const [key, id] of [['2', 'B'], ['3', 'B'], ['4', 'A'], ['4', 'B']]) {
    r = solved(key, undefined, [id]);
    near(r.solution.bulbCurrent.P, 0, `circuit (${key}) without bulb ${id}: P is off`);
  }
  // P itself unscrewed
  r = solved('2', 1, ['P']);
  near(r.solution.bulbCurrent.B, 0, 'circuit (2) without P: B, in series with it, is off too');
  near(Math.abs(r.solution.bulbCurrent.A), 1, 'circuit (2) without P: A is untouched');
  // more batteries, more current
  near(solved('1', 4).solution.bulbCurrent.P, 4, 'circuit (1) with 4 batteries');
  near(Math.abs(solved('2', 3).solution.bulbCurrent.P), 1.5, 'circuit (2) with 3 batteries');
  near(Math.abs(solved('4', 4).solution.bulbCurrent.P), 4 / 3, 'circuit (4) with 4 batteries');
  assert.equal(pure.clampCells(9), pure.MAX_CELLS);
  assert.equal(pure.clampCells(0), pure.MIN_CELLS);
});

test('the battery symbol grows with the cells and stays centred', () => {
  for (let cells = 1; cells <= 4; cells++) {
    const battery = pure.batteryGeometry(cells);
    assert.equal(battery.plates.length, cells);
    near((battery.plusY + battery.minusY) / 2, 91, `${cells} cells centred on the side`);
    assert.ok(battery.plusY > 36 && battery.minusY < 146, `${cells} cells fit between the corners`);
    battery.plates.forEach((plate) => assert.ok(plate.shortY > plate.longY, 'the long (+) plate is on top of each cell'));
  }
});

test('lanes on a shared wire sit side by side, inside branch innermost, and never overlap', () => {
  const { model, solution } = solved('1');
  const currents = pure.laneCurrents(model, solution);
  const lanes = pure.layoutLanes(model, currents, 2.4, 1.4);
  // TL→JA is the second segment of every route (BP→TL, TL→JA)
  const offsets = lanes.map((lane) => lane.offsets[1]);
  assert.ok(offsets[0] < offsets[1] && offsets[1] < offsets[2], 'A inside, then B, then P outside');
  for (let i = 0; i < lanes.length - 1; i++) {
    near(offsets[i + 1] - offsets[i], (lanes[i].width + lanes[i + 1].width) / 2, 'neighbouring lanes touch without overlapping');
  }
  near(offsets.reduce((sum, offset, i) => sum + offset * lanes[i].width, 0), 0, 'the bundle is centred on the wire');
  // On its own vertical, bulb P's lane runs down the wire itself.
  const pLane = lanes[2];
  assert.ok(pLane.points.some((point) => Math.abs(point[0] - 262) < 1e-9), 'P\'s lane runs down x = 262');
  // A lane with no current has no width.
  const off = pure.layoutLanes(model, [0, 2, 2], 2.4, 1.4);
  assert.equal(off[0].width, 0);
});

test('offsetPolyline turns corners and jogs between collinear offsets', () => {
  const square = [[0, 0], [10, 0], [10, 10]];
  assert.deepEqual(plain(pure.offsetPolyline(square, [1, 1], 4)), [[0, -1], [11, -1], [11, 10]]);
  const straight = plain(pure.offsetPolyline([[0, 0], [10, 0], [20, 0]], [2, 0], 4));
  assert.equal(straight.length, 4, 'a change of offset on a straight wire adds a short jog');
  assert.deepEqual(straight[0], [0, -2]);
  assert.deepEqual(straight.at(-1), [20, 0]);
});

test('amounts read the way a P5 pupil writes them', () => {
  assert.equal(pure.formatAmount(2), '2');
  assert.equal(pure.formatAmount(0.5), '½');
  assert.equal(pure.formatAmount(1.5), '1½');
  assert.equal(pure.formatAmount(4 / 3), '1⅓');
  assert.equal(pure.formatAmount(0.75), '¾');
  assert.equal(pure.formatAmount(0), '0');
  assert.equal(pure.formatAmount(0.9999999), '1');
  assert.equal(pure.amountText(0.5), '½ unit');
  assert.equal(pure.amountText(1), '1 unit');
  assert.equal(pure.amountText(2), '2 units');
  assert.equal(pure.amountText(0), '0 units');
  assert.equal(pure.brightnessWord(0), 'Off');
  assert.equal(pure.brightnessWord(0.5), 'Dim');
  assert.equal(pure.brightnessWord(1), 'Normal brightness');
  assert.equal(pure.brightnessWord(2), 'Very bright');
  assert.ok(pure.glowLevel(2) > pure.glowLevel(1) && pure.glowLevel(1) > pure.glowLevel(0.5) && pure.glowLevel(0) === 0, 'glow rises with current');
});

test('the page carries the question word for word, its four options and its version', () => {
  assert.ok(html.includes('<p>Jason set up four different circuits using identical bulbs and batteries as shown.</p>'));
  assert.ok(html.includes('<p>In which circuit would bulb P be the brightest?</p>'));
  for (const n of [1, 2, 3, 4]) {
    assert.ok(html.includes(`data-choice="${n}"><span class="q-option-text"><b>${n}.</b>(${n})</span>`), `option ${n}. (${n})`);
    assert.ok(html.includes(`id="questionDiagram${n}"`), `diagram (${n})`);
  }
  assert.ok(html.includes('<label class="q-answer-label" for="answerInput">Answer:</label>'));
  assert.match(pure.APP_VERSION, /^v\d+\.\d+\.\d+$/);
  assert.ok(html.includes(`id="versionTag">${pure.APP_VERSION}<`), 'the header shows the same version the script reports');
});

test('the page is self-contained: no script from anywhere, only the font stylesheet', () => {
  assert.doesNotMatch(html, /<script[^>]*\bsrc=/, 'no external scripts');
  const links = [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]);
  links.forEach((href) => assert.match(href, /^https:\/\/fonts\.(googleapis|gstatic)\.com/, `only Google Fonts: ${href}`));
});

test('the whole page script parses (not only the solver)', () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 1, 'one inline script');
  assert.doesNotThrow(() => new vm.Script(scripts[0], { filename: 'apps/bulb-p-circuits.html' }));
});
