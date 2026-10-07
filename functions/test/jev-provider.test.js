'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createJevProvider, requestBody, ENDPOINT } = require('../jev-provider');
const { JevError } = require('../jev-service');

const context = { page: 1, selectedId: 'circle-1', objects: [{ id: 'circle-1', type: 'ellipse', x: 20, y: 30, w: 50, h: 50 }] };
function answer(criteria, choice, confidence = 0.95) {
  return { type: 'choice', choice, confidence, probabilities: Object.fromEntries(Object.keys(criteria).map(key => [key, key === choice ? 1 : 0])) };
}
function response(body, intent = 'move', target = 'object_0', confidence = 0.95) {
  if (Array.isArray(body.questions)) body = { questions: Object.fromEntries(body.questions.map(q => [q.name, { criteria: Object.fromEntries(q.choices.map(c => [c.value, c.description])) }])) };
  return { model: 'gpt-6-luna', answers: {
    intent: answer(body.questions.intent.criteria, intent, confidence),
    ...(body.questions.target ? { target: answer(body.questions.target.criteria, target, confidence) } : {})
  } };
}
function wire(value) {
  if (!value.answers) return value;
  return { ...value, answers: Object.entries(value.answers).map(([name, a]) => ({ ...a, name, probabilities: a.probabilities && Object.entries(a.probabilities).map(([value, probability]) => ({ value, probability })) })) };
}
function providerFor(transform = value => value, options = {}) {
  const calls = [];
  const provider = createJevProvider({ apiKey: () => 'test-secret', async fetchImpl(url, options) {
    calls.push({ url, options });
    const body = JSON.parse(options.body);
    return { ok: true, json: async () => wire(transform(response(body), body)) };
  }, ...options });
  return { provider, calls };
}

test('uses only the official fixed OpenAI Decisions endpoint and typed choice schema', async () => {
  const h = providerFor();
  const result = await h.provider.classify('Move this circle right.', context);
  assert.deepEqual(result, { intent: 'move', targetId: 'circle-1', confidence: 0.95, needsClarification: false });
  assert.equal(h.calls[0].url, ENDPOINT);
  assert.equal(h.calls[0].url, 'https://api.openai.com/v1/decisions');
  assert.equal(h.calls[0].options.headers.Authorization, 'Bearer test-secret');
  assert.ok(h.calls[0].options.signal instanceof AbortSignal);
  const body = JSON.parse(h.calls[0].options.body);
  assert.equal(body.model, 'gpt-6-luna');
  assert.deepEqual(JSON.parse(body.input), { transcript: 'Move this circle right.', context });
  assert.equal(body.questions[0].type, 'choice');
  assert.equal(body.questions[0].name, 'intent');
  assert.equal(body.state, undefined);
  assert.equal(JSON.parse(body.questions[1].choices.find(c => c.value === 'object_0').description).selected, true);
  assert.ok(!JSON.stringify(result).includes('test-secret'));
});

test('open ended questions route to the answering system without pretending Jev generates text', async () => {
  const h = providerFor((_, body) => response(body, 'answer'));
  assert.deepEqual(await h.provider.classify('Why is the answer 4?', context), { intent: 'answer', targetId: null, confidence: 0.95, needsClarification: false });
});

test('missing objects, ambiguous targets, locked objects, and low confidence cannot authorize an edit', async () => {
  for (const [scene, transform] of [
    [{ page: 1, selectedId: null, objects: [] }, (_, body) => response(body)],
    [context, (_, body) => response(body, 'move', 'none')],
    [{ ...context, objects: [{ ...context.objects[0], locked: true }] }, (_, body) => response(body)],
    [context, (_, body) => response(body, 'move', 'object_0', 0.59)]
  ]) {
    const h = providerFor(transform);
    assert.equal((await h.provider.classify('Move it.', scene)).needsClarification, true);
  }
});

test('a malformed target answer fails closed even for non-target operations', async () => {
  for (const intent of ['add', 'undo', 'redo', 'navigate', 'unsupported']) {
    const h = providerFor((_, body) => {
      const result = response(body, intent); result.answers.target = { malicious: true }; return result;
    });
    await assert.rejects(h.provider.classify('A request', context), error => error.code === 'jev_invalid_response');
  }
});

test('malformed decision values and unknown targets fail closed', async () => {
  for (const mutate of [
    value => { delete value.answers; },
    value => { value.answers.intent.choice = 'run_code'; },
    value => { value.answers.intent.type = 'noul'; },
    value => { value.answers.intent.confidence = NaN; },
    value => { value.answers.intent.confidence = 2; },
    value => { value.answers.target.choice = 'other-object'; },
    value => { value.answers.target.probabilities = { object_0: 1 }; },
    value => { value.answers.target.probabilities.none = 0.5; },
    value => { value.answers.target.probabilities.object_0 = -1; },
    value => { value.answers.target.probabilities = { object_0: 0, none: 1 }; }
  ]) {
    const h = providerFor(value => { mutate(value); return value; });
    await assert.rejects(h.provider.classify('Move this.', context), error => error instanceof JevError && error.code === 'jev_invalid_response');
  }
});

test('provider errors never return upstream payloads or secret text', async () => {
  for (const status of [401, 403, 429, 500, 529]) {
    let read = false;
    const h = providerFor(null, { fetchImpl: async () => ({ ok: false, status, json: async () => { read = true; throw new Error('test-secret'); } }) });
    await assert.rejects(h.provider.classify('Move.', context), error => !error.message.includes('test-secret') && error.status === ([429, 529].includes(status) ? 429 : 503));
    assert.equal(read, false);
  }
  for (const fetchImpl of [async () => { throw new Error('test-secret'); }, async () => ({ ok: true, json: async () => { throw new Error('test-secret'); } })]) {
    await assert.rejects(providerFor(null, { fetchImpl }).provider.classify('Move.', context), error => ['jev_unavailable', 'jev_invalid_response'].includes(error.code) && !error.message.includes('test-secret'));
  }
});

test('missing key makes no network call', async () => {
  const h = providerFor(null, { apiKey: () => '' });
  await assert.rejects(h.provider.classify('Move.', context), error => error.code === 'jev_not_configured');
  assert.equal(h.calls.length, 0);
});

test('timeout aborts a stalled upstream request with a sanitized error', async () => {
  let signal;
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const h = providerFor(null, { timeoutMs: 5, fetchImpl: (_url, options) => {
      signal = options.signal;
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('secret upstream timeout')), { once: true }));
    } });
    await assert.rejects(h.provider.classify('Move.', context), error => error.code === 'jev_unavailable' && !error.message.includes('secret'));
    assert.equal(signal.aborted, true);
  } finally { clearTimeout(keepAlive); }
});

test('target candidates remain bounded to the existing 100-object inventory', () => {
  const body = requestBody('Move last object.', { page: 1, selectedId: null, objects: Array.from({ length: 100 }, (_, i) => ({ id: String(i), type: 'text' })) });
  assert.equal(Object.keys(body.questions.target.criteria).length, 101);
});
