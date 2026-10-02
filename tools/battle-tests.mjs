import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../battle-core.js'), Store = require('../battle-store.js');
const makeHero = (role, uid = role) => C.heroFromStudent({ id: 'register-' + uid, uid, name: uid }, { battleHero: {
  version: 1, uid, role, stats: { atk: 36, def: 16, maxHp: 200, crit: 5, critMult: 2, spellPct: .15 },
  avatarDataUrl: 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E', equipment: { weapon: 'sword' }
} });
const heroes = Object.keys(C.ROLES).map(role => makeHero(role));
let seq = 0;
const id = () => 'action-' + String(++seq).padStart(8, '0');
const start = (bossId = 'mossback', party = heroes) => C.reduce(null, { type: 'start', id: id(), bossId, heroes: party });
const apply = (s, type, values = {}) => C.reduce(s, { id: id(), encounterId: s.encounterId, expectedRevision: s.revision, type, ...values });
function answer(s, role, outcome = 'correct') {
  const chosen = apply(s, 'select', { heroId: 'uid:' + role });
  return apply(chosen, 'answer', { turnId: chosen.pending.id, outcome });
}
test('stable account identity, unavailable and unlinked avatars never use name matching', () => {
  assert.equal(makeHero('warrior').id, 'uid:warrior');
  const a = C.heroFromStudent({ id: 'a', name: 'Alex' }, {}), b = C.heroFromStudent({ id: 'b', name: 'Alex' }, {});
  assert.notEqual(a.id, b.id); assert.match(a.fallbackReason, /No CER account/);
  const mismatch = C.heroFromStudent({ id: 'a', uid: 'a' }, { battleHero: { version: 1, uid: 'b', avatarDataUrl: 'javascript:alert(1)' } });
  assert.equal(mismatch.avatarUrl, ''); assert.equal(mismatch.role, 'warrior');
});
test('all four roles use bounded canonical CER stats, percent crit and role abilities', () => {
  const [w, r, m, h] = heroes;
  assert.ok(w.stats.maxHp > r.stats.maxHp); assert.ok(w.stats.defence > m.stats.defence);
  assert.equal(r.stats.attacks, 2); assert.equal(r.stats.critChance, .2);
  assert.ok(m.stats.damage > w.stats.damage); assert.ok(h.stats.damage < w.stats.damage);
  for (const role of Object.keys(C.ROLES)) assert.ok(answer(start(), role).bossHp < start().bossHp);
  const injured = start(); injured.heroes.forEach(x => { x.hp = 10; }); injured.heroes[0].hp = 0;
  const healed = answer(injured, 'healer');
  assert.ok(healed.heroes.every(x => x.hp > 10)); assert.equal(healed.lastEvent.healed.length, 4);
});
test('correct, incorrect and skip each consume one turn and duplicate answers cannot damage', () => {
  for (const outcome of ['correct', 'incorrect', 'skip']) {
    const chosen = apply(start(), 'select', { heroId: heroes[0].id });
    const action = { type: 'answer', id: id(), encounterId: chosen.encounterId, turnId: chosen.pending.id, outcome };
    const resolved = C.reduce(chosen, action);
    assert.equal(resolved.pending, null);
    assert.equal(resolved.bossHp < chosen.bossHp, outcome === 'correct');
    assert.throws(() => C.reduce(resolved, action), /already resolved/);
  }
});
test('every boss has distinct artwork, moves and gameplay parameters', () => {
  assert.equal(C.BOSSES.length, 20);
  for (const field of ['id', 'name', 'image', 'attackName', 'ultimateName']) assert.equal(new Set(C.BOSSES.map(b => b[field])).size, 20);
  assert.equal(new Set(C.BOSSES.map(b => JSON.stringify([b.playstyle, b.hpMultiplier, b.attackMultiplier, b.chargeMax, b.defence]))).size, 20);
  for (const b of C.BOSSES) {
    let s = start(b.id), hp = s.bossHp;
    assert.equal(s.bossId, b.id);
    assert.throws(() => apply(s, 'boss', { ultimate: true }), /not charged/);
    for (let i = 0; i < b.chargeMax; i++) {
      s.heroes.forEach(h => { h.hp = h.stats.maxHp; });
      s = apply(s, 'boss'); assert.ok(s.lastEvent.targets.length >= 1);
    }
    assert.equal(s.charge, b.chargeMax);
    assert.throws(() => apply(s, 'boss'), /Ultimate is ready/);
    s.heroes.forEach(h => { h.hp = h.stats.maxHp; });
    s = apply(s, 'boss', { ultimate: true });
    assert.equal(s.lastEvent.targets.length, 4); assert.equal(s.charge, 0); assert.equal(s.bossId, b.id); assert.equal(s.bossHp, hp);
  }
});
test('playstyle effects change outcomes: splash, swift, regen, reflect, weaken, guard, pierce', () => {
  assert.equal(apply(start('bubblebeard'), 'boss').lastEvent.targets.length, 4);
  assert.equal(apply(start('stormwhisker'), 'boss').lastEvent.targets[0].hits, 2);
  const regen = start('jellycrown'); regen.bossHp -= 50;
  assert.ok(apply(regen, 'boss').bossHp > regen.bossHp);
  assert.equal(answer(start('thistletuft'), 'warrior').lastEvent.effect, 'reflect');
  const ink = apply(start('inktip'), 'boss'); assert.ok(ink.heroes[0].weakened);
  assert.ok(answer(ink, 'warrior').lastEvent.damage < answer(start('inktip'), 'warrior').lastEvent.damage);
  const guard = apply(start('honeyhelm'), 'boss'); assert.ok(guard.guard);
  assert.ok(answer(guard, 'warrior').lastEvent.damage < answer(start('honeyhelm'), 'warrior').lastEvent.damage);
  const magic = start('moonmoth'); magic.heroes[0].stats.defence = 100;
  assert.ok(apply(magic, 'boss').lastEvent.targets[0].damage > 3);
});
test('profile sync preserves absolute damage, zero HP, active boss and pending turn after reload', () => {
  const s = apply(start(), 'select', { heroId: heroes[0].id });
  s.heroes[0].hp -= 30; s.heroes[1].hp = 0;
  const fresh = structuredClone(heroes); fresh[0].stats.maxHp += 50; fresh[0].role = 'mage';
  const next = apply(JSON.parse(JSON.stringify(s)), 'sync', { heroes: fresh });
  assert.equal(next.heroes[0].hp, fresh[0].stats.maxHp - 30); assert.equal(next.heroes[1].hp, 0);
  assert.equal(next.heroes[0].role, 'mage'); assert.equal(next.bossId, s.bossId); assert.deepEqual(next.pending, s.pending);
  assert.equal(next.heroes[0].avatarUrl, undefined); // keep 100 SVGs out of the state document
  assert.ok(JSON.stringify(next).length < 10000);
});
test('victory and defeat stop further attacks; resting hero still contributes before defeat', () => {
  const s = start(); s.bossHp = 1;
  const won = answer(s, 'warrior'); assert.equal(won.status, 'victory'); assert.equal(won.bossHp, 0);
  assert.throws(() => apply(won, 'boss'), /finished/);
  const exhausted = start('bubblebeard'); exhausted.heroes.forEach(h => { h.hp = 1; });
  const lost = apply(exhausted, 'boss'); assert.equal(lost.status, 'defeat'); assert.throws(() => answer(lost, 'healer'), /finished/);
  const rested = start(); rested.heroes[0].hp = 0; assert.ok(answer(rested, 'warrior').heroes[0].hp > 0);
  const rosterChanged = start(); rosterChanged.heroes[0].hp = 0;
  const onlyResting = apply(rosterChanged, 'sync', { heroes:[heroes[0]] });
  assert.equal(onlyResting.status, 'defeat'); assert.throws(() => apply(onlyResting, 'boss'), /finished/);
});
test('boss and selection stale revisions are refused; prior encounters cannot replay', () => {
  const s = start(), next = apply(s, 'boss');
  assert.throws(() => apply(next, 'boss', { expectedRevision: s.revision }), /already changed/);
  assert.throws(() => apply(next, 'select', { heroId: heroes[0].id, expectedRevision: s.revision }), /another screen/);
  assert.throws(() => apply(next, 'boss', { encounterId: 'old-encounter' }), /encounter has changed/);
});

// Firestore-style optimistic retry harness: interleaved transactions only commit
// when every read version still matches, otherwise replay their callback.
function database() {
  const data = new Map(), versions = new Map(), listeners = new Map();
  function ref(path) { return { path, collection: name => ref(path + '/' + name), doc: id => ref(path + '/' + id),
    onSnapshot(fn) { (listeners.get(path) || listeners.set(path, new Set()).get(path)).add(fn); fn(snapshot(path)); return () => listeners.get(path).delete(fn); } }; }
  const snapshot = path => ({ exists: data.has(path), data: () => structuredClone(data.get(path)) });
  return { collection: name => ref(name), data,
    async runTransaction(callback) {
      for (let retry = 0; retry < 20; retry++) {
        const reads = new Map(), writes = new Map();
        const result = await callback({ get: async r => { reads.set(r.path, versions.get(r.path) || 0); await Promise.resolve(); return snapshot(r.path); },
          set: (r, value) => writes.set(r.path, structuredClone(value)) });
        if ([...reads].some(([path, version]) => version !== (versions.get(path) || 0))) continue;
        for (const [path, value] of writes) { data.set(path, value); versions.set(path, (versions.get(path) || 0) + 1); }
        for (const path of writes.keys()) for (const listener of listeners.get(path) || []) listener(snapshot(path));
        return result;
      }
      throw new Error('Transaction retry limit');
    }
  };
}
test('two sessions, duplicate IDs, simultaneous answers, reload and teacher/class isolation', async () => {
  const db = database(), config = { db, teacherId: 'teacher', classId: 'P5 / Science', canWrite: () => true };
  const a = Store.create(config), b = Store.create(config);
  let s = await a.act({ id: id(), type: 'start', bossId: 'mossback', heroes });
  s = await a.act({ id: id(), type: 'select', encounterId: s.encounterId, expectedRevision: s.revision, heroId: heroes[0].id });
  const action = { id: id(), type: 'answer', encounterId: s.encounterId, turnId: s.pending.id, outcome: 'correct' };
  const results = await Promise.all([a.act(action), b.act(action)]);
  assert.equal(results[0].bossHp, results[1].bossHp); assert.equal(results[0].correctCount, 1);
  let restored; Store.create(config).subscribe(value => { restored = value; });
  assert.equal(restored.correctCount, 1); assert.equal(restored.pending, null);
  s = await a.act({ id: id(), type: 'select', encounterId: restored.encounterId, expectedRevision: restored.revision, heroId: heroes[1].id });
  const simultaneous = await Promise.allSettled(['correct', 'incorrect'].map(outcome => b.act({ id: id(), type: 'answer', encounterId: s.encounterId, turnId: s.pending.id, outcome })));
  assert.equal(simultaneous.filter(r => r.status === 'fulfilled').length, 1);
  for (const override of [{ teacherId: 'other' }, { classId: 'P6 Science' }]) {
    let isolated = 'unset'; Store.create({ ...config, ...override }).subscribe(value => { isolated = value; }); assert.equal(isolated, null);
  }
  assert.notEqual(Store.classKey('P5/Science'), Store.classKey('P5%2fScience'));
  await assert.rejects(Store.create({ ...config, canWrite: () => false }).act(action), /Only the signed-in/);
  let gates = 0;
  const changedAccount = Store.create({ ...config, classId:'switch-during-read', canWrite:() => ++gates < 3 });
  await assert.rejects(changedAccount.act({id:id(),type:'start',bossId:'mossback',heroes}), /Only the signed-in/);
  assert.equal(db.data.has(changedAccount.ref.path), false);
});
