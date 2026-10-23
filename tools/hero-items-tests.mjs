// 🎁 Item desk (v1.158.0): the request the gift form sends is the one the server reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Items = require('../hero-items.js'), Core = require('../battle-core.js');
const P = Items.pure;

test('every rarity is offered and each item list holds only that rarity and type', () => {
  assert.deepEqual(P.rarityKeys(), Object.keys(Core.RARITIES));
  for (const rarity of P.rarityKeys()) for (const [type] of P.TYPES) {
    const pool = P.poolFor(rarity, type);
    assert.ok(pool.every(i => i.rarity === rarity && (type === 'any' || i.type === type)));
  }
  assert.deepEqual(P.poolFor('random', 'any'), []);
});

test('the gift request uses itemType (never the request type) and clamps copies', () => {
  const random = P.giftRequest({ rarity: 'random', itemType: 'rune', itemId: '', quantity: 99 }, 'alex', 'P5', 'gift-12345678');
  assert.deepEqual(random, { type: 'items', command: 'gift', studentId: 'alex', id: 'gift-12345678', quantity: 20, itemType: 'rune', classId: 'P5', rarity: 'random' });
  const chosen = P.giftRequest({ rarity: 'epic', itemType: 'any', itemId: 'red-potion', quantity: '2' }, 'alex', '', 'gift-12345678');
  assert.equal(chosen.itemId, 'red-potion'); assert.equal(chosen.rarity, undefined); assert.equal(chosen.classId, undefined); assert.equal(chosen.quantity, 2);
});

test('wheel names that are not register students are recognised as unlinked', () => {
  assert.equal(P.isGuestHero({ studentId: 'wheel-abc' }), true);
  assert.equal(P.isGuestHero({ studentId: '' }), true);
  assert.equal(P.isGuestHero({ studentId: 'alex' }), false);
  assert.equal(P.sourceLabel('victory'), 'Victory treasure');
});
