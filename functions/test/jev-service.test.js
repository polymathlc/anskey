'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createJevService, createJevRepository, validateCommand, JevError, JEV_LIMITS } = require('../jev-service');
const { APP_ID, TEACHER_EMAIL } = require('../live-service');

const body = { worksheetId: 'worksheet-1', transcript: 'Move the selected circle right.', context: { page: 1, selectedId: 'circle-1', objects: [{ id: 'circle-1', type: 'ellipse', x: 10, y: 20, w: 40, h: 40 }] } };
const decision = { intent: 'move', targetId: 'circle-1', confidence: 0.9, needsClarification: false };
function harness(overrides = {}) {
  const calls = [];
  const deps = {
    auth: { async verifyIdToken(token, revoked) { calls.push(['auth', token, revoked]); return { uid: 'teacher', email: TEACHER_EMAIL, email_verified: true, firebase: { sign_in_provider: 'google.com' } }; } },
    appCheck: { async verifyToken(token) { calls.push(['appCheck', token]); return { appId: APP_ID }; } },
    repository: { async authorize(...args) { calls.push(['authorize', ...args]); } },
    provider: { async classify(...args) { calls.push(['classify', ...args]); return decision; } },
    now: () => 1000,
    report: code => calls.push(['report', code])
  };
  for (const [key, value] of Object.entries(overrides)) Object.assign(deps[key], value);
  const service = createJevService(deps);
  async function request(input = body, options = {}) {
    const headers = { origin: 'https://polymathlc.github.io', authorization: 'Bearer user-token', 'x-firebase-appcheck': 'app-token', 'content-type': 'application/json', ...options.headers };
    const req = { method: options.method || 'POST', body: input, rawBody: options.rawBody, get: name => headers[name.toLowerCase()] };
    const res = { headers: {}, statusCode: 200, set(k, v) { this.headers[k] = v; return this; }, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; } };
    await service.handler(req, res); return res;
  }
  return { calls, request };
}

test('command verifies teacher, App Check, ownership and allowance before calling Jev', async () => {
  const h = harness();
  const result = await h.request({ ...body, model: 'attacker', apiKey: 'must-not-forward' });
  assert.deepEqual(result.body, decision);
  assert.deepEqual(h.calls.map(call => call[0]), ['auth', 'appCheck', 'authorize', 'classify']);
  assert.deepEqual(h.calls[0], ['auth', 'user-token', true]);
  assert.deepEqual(h.calls[2], ['authorize', 'teacher', 'worksheet-1', 1000]);
  assert.deepEqual(h.calls[3], ['classify', body.transcript, body.context]);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.ok(!JSON.stringify(h.calls).includes('must-not-forward'));
});

test('origin, method, content type and body bounds are enforced before dependencies', async () => {
  const h = harness();
  for (const origin of ['https://evil.example', 'https://polymathlc.github.io.evil.example', 'null', undefined]) {
    assert.equal((await h.request(undefined, { headers: { origin } })).statusCode, 403);
  }
  assert.equal((await h.request(undefined, { method: 'GET' })).statusCode, 405);
  assert.equal((await h.request(undefined, { headers: { 'content-type': 'text/plain' } })).statusCode, 415);
  assert.equal((await h.request(undefined, { rawBody: Buffer.alloc(JEV_LIMITS.bodyBytes + 1) })).statusCode, 413);
  assert.deepEqual(h.calls, []);
});

test('preflight allows app authentication without sending a model request', async () => {
  const h = harness();
  const result = await h.request(undefined, { method: 'OPTIONS', headers: { origin: 'http://localhost:8080' } });
  assert.equal(result.statusCode, 204);
  assert.match(result.headers['Access-Control-Allow-Headers'], /X-Firebase-AppCheck/);
  assert.deepEqual(h.calls, []);
});

test('malformed, missing and revoked identity tokens fail before Jev', async () => {
  for (const authorization of ['', 'Bearer', 'Basic user-token']) {
    const h = harness();
    assert.equal((await h.request(undefined, { headers: { authorization } })).statusCode, 401);
    assert.equal(h.calls.length, 0);
  }
  const h = harness({ auth: { async verifyIdToken() { throw new Error('sensitive-token'); } } });
  const result = await h.request();
  assert.equal(result.statusCode, 401);
  assert.ok(!JSON.stringify(result).includes('sensitive-token'));
});

test('only the verified Google teacher with the correct app token may submit commands', async () => {
  for (const claims of [null, {}, { uid: 'student', email: 'student@example.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } },
    { uid: 'teacher', email: TEACHER_EMAIL, email_verified: false, firebase: { sign_in_provider: 'google.com' } },
    { uid: 'teacher', email: TEACHER_EMAIL, email_verified: true, firebase: { sign_in_provider: 'anonymous' } }]) {
    const h = harness({ auth: { async verifyIdToken() { return claims; } } });
    assert.equal((await h.request()).statusCode, 403);
    assert.ok(!h.calls.some(call => call[0] === 'classify'));
  }
  for (const appCheck of [{ async verifyToken() { return { appId: 'other' }; } }, { async verifyToken() { throw new Error('secret-app-token'); } }]) {
    const h = harness({ appCheck });
    assert.equal((await h.request()).statusCode, 403);
    assert.ok(!h.calls.some(call => call[0] === 'classify'));
  }
  assert.equal((await harness().request(undefined, { headers: { 'x-firebase-appcheck': '' } })).statusCode, 403);
});

test('invalid transcript and object context are rejected, including duplicate IDs and stale selection', () => {
  const invalidBodies = [null, [], {}, { ...body, worksheetId: '../secret' }, { ...body, transcript: '' }, { ...body, transcript: 'x'.repeat(4001) },
    { ...body, context: null }, { ...body, context: { ...body.context, objects: Array(101).fill(body.context.objects[0]) } },
    { ...body, context: { ...body.context, objects: [body.context.objects[0], body.context.objects[0]] } },
    { ...body, context: { ...body.context, selectedId: 'missing' } },
    { ...body, context: { ...body.context, page: 0 } }];
  for (const change of [{ id: '../secret' }, { type: {} }, { text: 'x'.repeat(1201) }, { title: 'x'.repeat(241) }, { x: Infinity }, { y: '23' }, { w: -1 }, { locked: 'true' }]) {
    invalidBodies.push({ ...body, context: { ...body.context, objects: [{ ...body.context.objects[0], ...change }] } });
  }
  for (const value of invalidBodies) assert.throws(() => validateCommand(value), error => error.code === 'invalid_command');
});

test('ownership and quota refusals prevent model calls; unexpected failures are sanitized', async () => {
  for (const status of [403, 429]) {
    const h = harness({ repository: { async authorize() { throw new JevError(status, 'blocked', 'Command unavailable.'); } } });
    assert.equal((await h.request()).statusCode, status);
    assert.ok(!h.calls.some(call => call[0] === 'classify'));
  }
  for (const key of ['repository', 'provider']) {
    const h = harness({ [key]: { async [key === 'repository' ? 'authorize' : 'classify']() { throw new Error('apikey-sensitive'); } } });
    const result = await h.request();
    assert.equal(result.statusCode, 503);
    assert.ok(!JSON.stringify(result).includes('apikey-sensitive'));
    assert.deepEqual(h.calls.at(-1), ['report', 'jev_request_failed']);
  }
});

function repositoryHarness({ ownerUid = 'teacher', exists = true, counter = {} } = {}) {
  const writes = [];
  const db = {
    collection(collection) { return { doc(id) { return { collection, id }; } }; },
    async runTransaction(callback) { return callback({
      async get(ref) { return ref.collection === 'pdfAnnotator' ? { exists, data: () => ({ ownerUid }) } : { exists: true, data: () => counter }; },
      set(ref, value) { writes.push({ ref, value }); }
    }); }
  };
  return { repository: createJevRepository(db), writes };
}

test('repository checks actual worksheet ownership and never persists request contents', async () => {
  for (const state of [{ exists: false }, { ownerUid: 'another-user' }]) {
    const h = repositoryHarness(state);
    await assert.rejects(h.repository.authorize('teacher', 'worksheet-1', 0), error => error.code === 'worksheet_not_owned');
    assert.deepEqual(h.writes, []);
  }
  const h = repositoryHarness();
  await h.repository.authorize('teacher', 'worksheet-1', 0);
  assert.deepEqual(h.writes[0].value, { minute: 0, minuteCount: 1, day: '1970-01-01', dayCount: 1 });
  assert.equal(h.writes[0].ref.collection, 'ansKeyJevLimits');
  assert.notEqual(h.writes[0].ref.id, 'teacher');
});

test('per-minute and per-day limits are transactional and reset in Singapore time', async () => {
  for (const counter of [{ minute: 0, minuteCount: JEV_LIMITS.perMinute }, { day: '1970-01-01', dayCount: JEV_LIMITS.perDay }]) {
    const h = repositoryHarness({ counter });
    await assert.rejects(h.repository.authorize('teacher', 'worksheet-1', 0), error => error.code === 'jev_limit');
    assert.deepEqual(h.writes, []);
  }
  const h = repositoryHarness({ counter: { minute: 0, minuteCount: 90, day: '1970-01-01', dayCount: 1800 } });
  await h.repository.authorize('teacher', 'worksheet-1', 16 * 3600000);
  assert.equal(h.writes[0].value.day, '1970-01-02');
  assert.equal(h.writes[0].value.dayCount, 1);
});
