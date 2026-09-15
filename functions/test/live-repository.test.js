'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRepository, dayKey, userKey, SESSION_COLLECTION, LIMIT_COLLECTION } = require('../live-repository');
const { LIMITS } = require('../live-service');

function database() {
  const data = new Map();
  let tail = Promise.resolve();
  const snapshot = ref => ({ exists: data.has(ref.path), data: () => structuredClone(data.get(ref.path)) });
  function doc(path) {
    return {
      path, async get() { return snapshot(this); },
      async set(value) { data.set(path, structuredClone(value)); }
    };
  }
  const db = {
    data,
    collection(name) {
      return {
        doc: id => doc(`${name}/${id}`),
        where(field, op, bound) {
          assert.equal(op, '<=');
          return { limit: n => ({ async get() { return { docs: [...data.entries()].filter(([path, value]) => path.startsWith(`${name}/`) && value[field] <= bound).slice(0, n).map(([, value]) => ({ data: () => structuredClone(value) })) }; } }) };
        }
      };
    },
    runTransaction(callback) {
      // Serialized atomic transactions model Firestore's retry-on-conflict
      // behavior; concurrent starts see the committed reservation.
      const promise = tail.then(async () => {
        const pending = [];
        const result = await callback({
          async get(ref) { return snapshot(ref); },
          set(ref, value) { pending.push(() => data.set(ref.path, structuredClone(value))); },
          update(ref, value) { pending.push(() => data.set(ref.path, { ...data.get(ref.path), ...structuredClone(value) })); },
          delete(ref) { pending.push(() => data.delete(ref.path)); }
        });
        for (const write of pending) write();
        return result;
      });
      tail = promise.catch(() => {});
      return promise;
    }
  };
  return db;
}
function setup() {
  const db = database();
  db.data.set('pdfAnnotator/sheet', { ownerUid: 'child' });
  return { db, repo: createRepository(db), now: Date.parse('2026-09-16T01:00:00Z') };
}

test('worksheet ownership is checked inside the reservation transaction', async () => {
  const { db, repo, now } = setup();
  await assert.rejects(repo.reserve('other-child', 'sheet', now, LIMITS), error => error.status === 403);
  await assert.rejects(repo.reserve('child', 'missing', now, LIMITS), error => error.status === 403);
  assert.equal(db.data.size, 1);
});

test('two concurrent starts for the same account cannot allocate two paid calls', async () => {
  const { db, repo, now } = setup();
  const results = await Promise.allSettled([repo.reserve('child', 'sheet', now, LIMITS), repo.reserve('child', 'sheet', now, LIMITS)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.status, 409);
  assert.equal([...db.data.keys()].filter(path => path.startsWith(`${SESSION_COLLECTION}/`)).length, 1);
});

test('activation stores the opaque provider ID and changes cleanup from reservation to lesson expiry', async () => {
  const { db, repo, now } = setup();
  const lease = await repo.reserve('child', 'sheet', now, LIMITS);
  assert.equal(lease.cleanupAt, now + 60000);
  assert.equal(lease.expiresAt, now + 600000);
  await repo.activate(lease, 'live-opaque-provider-id');
  const saved = db.data.get(`${SESSION_COLLECTION}/${lease.id}`);
  assert.equal(saved.sessionId, 'live-opaque-provider-id');
  assert.equal(saved.cleanupAt, lease.expiresAt);
  assert.equal(await repo.find('other-child', 'live-opaque-provider-id'), null);
  assert.equal(await repo.find('child', 'wrong-id'), null);
  assert.equal((await repo.find('child', 'live-opaque-provider-id')).id, lease.id);
  assert.ok(!('sdp' in saved));
});

test('a delayed release cannot unlock or delete a newer lesson', async () => {
  const { db, repo, now } = setup();
  const first = await repo.reserve('child', 'sheet', now, LIMITS);
  await repo.release(first);
  const second = await repo.reserve('child', 'sheet', now + 1000, LIMITS);
  await repo.release(first);
  assert.equal(db.data.get(`${LIMIT_COLLECTION}/${userKey('child')}`).currentLease, second.id);
  assert.deepEqual(Object.keys(db.data.get(`${LIMIT_COLLECTION}/_global`).active), [second.id]);
  assert.ok(db.data.has(`${SESSION_COLLECTION}/${second.id}`));
});

test('a stale pending cleanup snapshot cannot delete a session activated since its read', async () => {
  const { db, repo, now } = setup();
  const lease = await repo.reserve('child', 'sheet', now, LIMITS);
  const stale = (await repo.expired(now + 61000))[0];
  await repo.activate(lease, 'newly-active-call');
  await repo.release(stale);
  assert.equal(db.data.get(`${SESSION_COLLECTION}/${lease.id}`).sessionId, 'newly-active-call');
  assert.equal(db.data.get(`${LIMIT_COLLECTION}/${userKey('child')}`).currentLease, lease.id);
});

test('per-user starts stay counted after stops and reset at Singapore midnight', async () => {
  const { db, repo, now } = setup();
  for (let i = 0; i < LIMITS.startsPerDay; i++) await repo.release(await repo.reserve('child', 'sheet', now + i, LIMITS));
  await assert.rejects(repo.reserve('child', 'sheet', now, LIMITS), error => error.code === 'daily_limit');
  const next = await repo.reserve('child', 'sheet', now + 86400000, LIMITS);
  assert.ok(next.id);
  assert.equal(db.data.get(`${LIMIT_COLLECTION}/${userKey('child')}`).starts, 1);
  assert.equal(dayKey(Date.parse('2026-09-15T15:59:59Z')), '2026-09-15');
  assert.equal(dayKey(Date.parse('2026-09-15T16:00:00Z')), '2026-09-16');
});

test('global concurrency and daily ceilings are independently enforced', async () => {
  for (const globalState of [{ active: { other: true }, day: '2026-09-16', starts: 1 }, { active: {}, day: '2026-09-16', starts: 100 }]) {
    const { db, repo, now } = setup();
    db.data.set(`${LIMIT_COLLECTION}/_global`, globalState);
    await assert.rejects(repo.reserve('child', 'sheet', now, { ...LIMITS, concurrent: 1 }), error => error.code === 'live_busy');
    assert.ok(!db.data.has(`${LIMIT_COLLECTION}/${userKey('child')}`));
  }
});

test('expired query includes abandoned reservations and excludes active lessons', async () => {
  const { repo, now } = setup();
  const pending = await repo.reserve('child', 'sheet', now, LIMITS);
  assert.deepEqual((await repo.expired(now + 61000)).map(lease => lease.id), [pending.id]);
  await repo.activate(pending, 'live-active');
  assert.deepEqual(await repo.expired(now + 61000), []);
  assert.deepEqual((await repo.expired(now + 600000)).map(lease => lease.id), [pending.id]);
});

test('user IDs cannot escape bookkeeping document paths', () => {
  assert.match(userKey('../other/user'), /^[a-f0-9]{64}$/);
});
