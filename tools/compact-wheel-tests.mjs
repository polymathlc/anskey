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
