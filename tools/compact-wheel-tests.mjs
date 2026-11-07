import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const { reelPlan, offset, pointAmount } = createRequire(import.meta.url)('../compact-wheel.js');

test('name reel preserves the supplied winner and does not change eligibility', () => {
  const eligible = Object.freeze(['Ari', 'Bo', 'Cy']);
  const plan = reelPlan(eligible, 'Bo');
  assert.equal(plan.faces[plan.target], 'Bo');
  assert.ok(plan.faces.length > 40);
  assert.ok(plan.faces.every(name => eligible.includes(name)));
  assert.deepEqual(eligible, ['Ari', 'Bo', 'Cy']);
});
test('reel slows forward to centre the selected name exactly', () => {
  const { target } = reelPlan(['Ari', 'Bo'], 'Bo');
  assert.equal(offset(1, target) + target * 42 + 21, 38);
  const positions = [0, .25, .5, .75, 1].map(k => offset(k, target));
  for (let i = 1; i < positions.length; i++) assert.ok(positions[i] < positions[i - 1]);
  assert.ok(positions[0] - positions[1] > positions[3] - positions[4]);
  assert.equal(offset(2, target), offset(1, target));
  assert.equal(offset(-1, target), offset(0, target));
});

test('compact points accept only supported whole-number awards', () => {
  for (const value of [1, '1', '7', '10000']) assert.equal(pointAmount(value), Number(value));
  for (const value of ['', '0', '-1', '1.5', '10001', 'abc', null, undefined, true, Infinity]) assert.equal(pointAmount(value), null);
});

// v1.189.0 / v1.190.0 — the compact window scales with its own size.
const { scaleFor, defaultBox, reelTransform, BASE, MIN_W, MIN_H, K_MIN, K_MAX } = createRequire(import.meta.url)('../compact-wheel.js');

test('the base window is exactly scale 1 in each layout', () => {
  assert.deepEqual(scaleFor(BASE.wide.w, BASE.wide.h), { layout: 'wide', k: 1 });
  assert.deepEqual(scaleFor(BASE.tall.w, BASE.tall.h), { layout: 'tall', k: 1 });
});
test('the scale is the tighter of the two ratios, so nothing outgrows the window', () => {
  assert.equal(scaleFor(1240, 280).k, 1);            // wider only: type stays, pictures fill the width
  assert.equal(scaleFor(1240, 560).k, 2);
  assert.equal(scaleFor(930, 700).k, 1.5);           // width is the tighter here
  for (const [w, h] of [[300, 200], [700, 300], [1000, 450], [2000, 1200], [380, 900]]) {
    const { layout, k } = scaleFor(w, h), base = BASE[layout];
    assert.ok(k <= Math.max(K_MIN, Math.min(w / base.w, h / base.h)) + 1e-3, w + '×' + h);
  }
});
test('a window taller than it is wide stacks, and the switch is at one ratio', () => {
  assert.equal(scaleFor(400, 800).layout, 'tall');
  assert.equal(scaleFor(500, 440).layout, 'tall');
  assert.equal(scaleFor(520, 440).layout, 'wide');
  assert.equal(scaleFor(1000, 300).layout, 'wide');
});
test('the scale is bounded and grows with the window', () => {
  assert.equal(scaleFor(10, 10).k, K_MIN);
  assert.equal(scaleFor(100000, 50000).k, K_MAX);
  let last = 0;
  for (let w = MIN_W; w <= 3000; w += 40) { const k = scaleFor(w, w * 280 / 620).k; assert.ok(k >= last); last = k; }
});
test('nonsense sizes fall back to the base scale rather than NaN', () => {
  for (const [w, h] of [[0, 0], [-5, 100], [NaN, 3], ['x', 2], [Infinity, 4]]) assert.deepEqual(scaleFor(w, h), { layout: 'wide', k: 1 });
});
test('a fresh compact window is the base size on a computer and a stacked one on a phone', () => {
  const desk = defaultBox(1440, 1000, { x: 200, y: 90 });
  assert.deepEqual([desk.w, desk.h, desk.x, desk.y], [620, 280, 200, 90]);
  const phone = defaultBox(390, 760, null);
  assert.equal(scaleFor(phone.w, phone.h).layout, 'tall');
  assert.ok(phone.x + phone.w <= 390 - 8 + 1e-9 && phone.y + phone.h <= 760 - 8);
  const corner = defaultBox(1024, 700, { x: 900, y: 650 });
  assert.ok(corner.x + corner.w <= 1024 - 8 && corner.y + corner.h <= 700 - 8);
  assert.ok(desk.w >= MIN_W && desk.h >= MIN_H);
});
test('the reel transform is the pure base offset times the window scale', () => {
  assert.equal(reelTransform(17), 'translateY(calc(17px * var(--cw-k, 1)))');
  assert.equal(reelTransform(-1912.344), 'translateY(calc(-1912.34px * var(--cw-k, 1)))');
});
test('the compact stylesheet scales every size it sets inside the panel', async () => {
  const css = (await import('node:fs')).readFileSync(new URL('../compact-wheel.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // Bare pixel sizes are allowed only as floors inside max(…) (tap targets), as
  // borders, and as the fixed grip floor; every other length must carry --k / --kh / a cq unit.
  const offenders = [];
  for (const rule of css.split('}')) {
    const [, body = ''] = rule.split('{');
    for (const decl of body.split(';')) {
      const [prop, value = ''] = decl.split(':').map(x => x && x.trim());
      if (!prop || !/^(font-size|font|height|width|min-height|min-width|max-width|padding|gap|top|left|right|border-radius|line-height)$/.test(prop)) continue;
      const stripped = value.replace(/max\([^()]*(\([^()]*\)[^()]*)*\)/g, '').replace(/1px solid/g, '');
      if (/(^|[^.\w])\d+(\.\d+)?px/.test(stripped) && !/var\(--k|var\(--kh|cq[wh]/.test(stripped)) offenders.push(prop + ': ' + value);
    }
  }
  // The window's own height, the points field's finger floor and the screen-reader-only box are fixed on purpose.
  const allowed = ['height: var(--cw-height,280px)!important', 'min-width: 44px', 'width: 1px', 'height: 1px'];
  assert.deepEqual(offenders.filter(o => !allowed.includes(o)), []);
});
test('the minimised wheel shows its resize corner and opens compact by default', async () => {
  const fs = await import('node:fs');
  const css = fs.readFileSync(new URL('../compact-wheel.css', import.meta.url), 'utf8');
  assert.match(css, /#wheelModal\.winMin #wheelGrip\{\s*display:block/);
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const open = html.slice(html.indexOf('async function openWheel()'), html.indexOf('function closeWheel()'));
  assert.match(open, /setWheelMin\(!embedded\)/);
  assert.doesNotMatch(open, /setWheelMin\(false\)/);
  const apply = html.slice(html.indexOf('function applyWheelWin()'), html.indexOf('function setWheelMin('));
  assert.match(apply, /CompactWheel\.fit\(box\)/);
});
