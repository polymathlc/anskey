import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { validateCommand } = require('../functions/jev-service');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function section(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing shipped code: ${start}`);
  return html.slice(a, b);
}
const contextCode = section('function voiceActionFingerprint()', 'function voiceActionBusy()');
const routingCode = section('async function voiceRouteCommand(', 'async function voiceStart()');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness(options = {}) {
  const controller = new AbortController();
  const v = { uid: 'teacher', user: { getIdToken: async () => options.token ? await options.token.promise : 'id-token' } };
  const page = { num: 2, baseW: 600, baseH: 800 };
  const calls = [], plans = [], answers = [], statuses = [], written = [];
  const box = {
    AbortController, clearTimeout,
    annotations: [{ id: 'box_1', type: 'text', page: 2, x: 20, y: 30, w: 160, h: 40,
      text: 'Saved answer', title: 'A'.repeat(400), color: '#1A1A1A' }],
    selectedId: 'box_1', editingId: 'box_1', lassoSel: null, undoStack: [], redoStack: [],
    currentDocId: 'worksheet_1', currentUser: { uid: 'teacher' }, wsEpoch: 3,
    pages: [page], currentPageNum: () => page.num,
    lessonSnapshot: () => box.annotations.map(a => ({ ...a, text: 'Current unsaved answer' })),
    annBounds: a => ({ x: a.x, y: a.y, x2: a.x + a.w, y2: a.y + a.h }),
    annLocked: a => !!a.locked,
    voiceLive: v, voiceContextOK: () => box.currentUser?.uid === v.uid,
    voiceCursorPoint: () => options.cursor || null,
    voiceStatus: message => statuses.push(message),
    aiWithDeadline: (run, timeout, signal) => run(signal),
    voiceDelegate: () => async request => {
      answers.push(request);
      if (options.answer) await options.answer.promise;
      return 'Grounded worksheet answer.';
    },
    voicePlanAndApply: async (...args) => { plans.push(args); return 'Moved the object.'; },
    voiceAnswerAtCursor: async (...args) => { written.push(args); return 'Wrote the answer at your pointer. You can undo that.'; },
    window: { liveAppCheckToken: async () => 'app-check-token' },
    fetch: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      if (options.fetch) await options.fetch.promise;
      if (options.error) throw options.error;
      return { ok: !options.status, status: options.status || 200,
        json: async () => options.route || { intent: 'move', targetId: 'box_1', confidence: 0.9, needsClarification: false } };
    }
  };
  vm.createContext(box);
  vm.runInContext(contextCode + routingCode, box);
  const request = { id: 'command_1', signal: controller.signal, isCurrent: () => !controller.signal.aborted,
    transcript: [{ role: 'user', text: 'An older question.' }, { role: 'assistant', text: 'An earlier reply.' },
      { role: 'user', text: ' Move this box to the right. ' }] };
  return { box, v, page, controller, request, calls, plans, answers, written, statuses, delegate: box.voiceJevDelegate(v) };
}

test('answer-question intent reaches written answers with the captured cursor and fresh command', async () => {
  const cursor = { page: 2, x: 150, y: 220 };
  const h = harness({ cursor, route: { intent: 'write_answer', targetId: null, confidence: 0.99, needsClarification: false } });
  h.request.command = 'Jev, answer question a.';
  assert.match(await h.delegate(h.request), /Wrote the answer/);
  assert.equal(h.written.length, 1);
  assert.deepEqual(plain(h.written[0][2].cursor), cursor);
  assert.equal(h.written[0][1].command, h.request.command);
  assert.equal(h.written[0][3], h.controller.signal);
  assert.equal(h.plans.length, 0); assert.equal(h.answers.length, 0);
  assert.deepEqual(plain(validateCommand(h.calls[0].body).context.cursor), cursor);
});

test('the actual context sent by the browser passes server validation and carries current text and selection', async () => {
  const h = harness();
  assert.equal(await h.delegate(h.request), 'Moved the object.');
  assert.equal(h.calls.length, 1);
  const { url, init, body } = h.calls[0];
  assert.equal(url, 'https://us-central1-mathgen--app.cloudfunctions.net/ansKeyJevCommand');
  assert.equal(init.headers.Authorization, 'Bearer id-token');
  assert.equal(init.headers['X-Firebase-AppCheck'], 'app-check-token');
  assert.equal(init.signal, h.controller.signal);
  const checked = validateCommand(body);
  assert.equal(checked.worksheetId, 'worksheet_1');
  assert.equal(checked.transcript, 'Move this box to the right.');
  assert.equal(checked.context.page, 2);
  assert.equal(checked.context.selectedId, 'box_1');
  assert.equal(checked.context.objects[0].text, 'Current unsaved answer');
  assert.ok(checked.context.objects[0].title.length <= 240);
  assert.equal(h.plans.length, 1);
  assert.equal(h.answers.length, 0);
  assert.deepEqual(plain(h.plans[0][2]), { intent: 'move', targetId: 'box_1', confidence: 0.9, needsClarification: false });
});

test('a question uses the grounded tutor with its full conversation and no action planner', async () => {
  const h = harness({ route: { intent: 'answer', targetId: null, confidence: 0.95, needsClarification: false } });
  assert.equal(await h.delegate(h.request), 'Grounded worksheet answer.');
  assert.equal(h.answers.length, 1);
  assert.equal(h.answers[0].signal, h.controller.signal);
  assert.deepEqual(plain(h.answers[0].transcript), plain(h.request.transcript));
  assert.equal(h.plans.length, 0);
});

test('fresh speech is routed separately from a merged earlier user transcript', async () => {
  const h = harness();
  h.request.transcript = [{ role: 'user', text: 'Add a box. Move this box to the right.' }];
  h.request.command = ' Move this box to the right. ';
  await h.delegate(h.request);
  assert.equal(h.calls[0].body.transcript, 'Move this box to the right.');
  assert.equal(h.plans[0][1].command, ' Move this box to the right. ');
});

test('a delegation without fresh speech cannot replay the previous command', async () => {
  const h = harness(); h.request.command = '  ';
  await h.delegate(h.request);
  assert.equal(h.calls.length, 0);
  assert.equal(h.answers.length, 0);
  assert.equal(h.plans.length, 1);
  assert.equal(h.plans[0][2].needsClarification, true);
});

test('an ambiguous classifier decision reaches clarification without academic answers', async () => {
  const h = harness({ route: { intent: 'answer', targetId: null, confidence: 0.2, needsClarification: true } });
  await h.delegate(h.request);
  assert.equal(h.answers.length, 0);
  assert.equal(h.plans.length, 1);
  assert.equal(h.plans[0][2].needsClarification, true);
});

test('request failures speak a local message without exposing upstream diagnostics', async () => {
  for (const options of [{ status: 403 }, { status: 429 }, { status: 503 }, { error: new Error('PRIVATE PROVIDER DIAGNOSTIC') }]) {
    const h = harness(options);
    assert.equal(await h.delegate(h.request), 'I could not complete that request. Please try again, or use the worksheet controls.');
    assert.equal(h.answers.length, 0);
    assert.equal(h.plans.length, 0);
  }
});

test('canceling while authentication is pending never sends a classifier request', async () => {
  const token = deferred(), h = harness({ token });
  const result = h.delegate(h.request);
  h.controller.abort(); token.resolve('id-token');
  await assert.rejects(result, /cancelled|ended/i);
  assert.equal(h.calls.length, 0);
  assert.equal(h.plans.length, 0);
});

test('canceling during classification prevents both the tutor and action planner', async () => {
  const fetch = deferred(), h = harness({ fetch });
  const result = h.delegate(h.request);
  await tick(); h.controller.abort(); fetch.resolve();
  await assert.rejects(result, /cancelled|ended/i);
  assert.equal(h.answers.length, 0);
  assert.equal(h.plans.length, 0);
});

test('a worksheet changed during classification never sends the old request to a new worksheet tutor', async () => {
  const fetch = deferred(), h = harness({ fetch,
    route: { intent: 'answer', targetId: null, confidence: 0.95, needsClarification: false } });
  const result = h.delegate(h.request);
  await tick(); h.box.currentDocId = 'worksheet_2'; h.box.wsEpoch++; fetch.resolve();
  assert.match(await result, /changed|again/i);
  assert.equal(h.answers.length, 0);
  assert.equal(h.plans.length, 0);
});

test('a worksheet changed while its answer is generated discards the stale explanation', async () => {
  const answer = deferred(), h = harness({ answer,
    route: { intent: 'answer', targetId: null, confidence: 0.95, needsClarification: false } });
  const result = h.delegate(h.request);
  await tick(); h.box.annotations[0].text = 'Teacher changed the answer'; answer.resolve();
  assert.match(await result, /changed|again/i);
  assert.equal(h.answers.length, 1);
  assert.equal(h.plans.length, 0);
});

test('a stopped voice session cannot dispatch another request', async () => {
  const h = harness(); h.box.voiceLive = null;
  await assert.rejects(h.delegate(h.request), /ended/i);
  assert.equal(h.calls.length, 0);
});

test('a request too large for the server produces no paid classifier call', async () => {
  const h = harness(); h.request.transcript = [{ role: 'user', text: 'x'.repeat(4001) }];
  assert.match(await h.delegate(h.request), /try again/i);
  assert.equal(h.calls.length, 0);
});
