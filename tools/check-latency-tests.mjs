import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tutor = html.includes('async function aiAskRoutes(');
function cut(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  return html.slice(a, b);
}
const helper = cut('/* ================= AI request deadlines ================= */', '/* ================= End AI request deadlines ================= */');
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function harness(overrides = {}) {
  let id = 0;
  const timers = new Map(), calls = [], down = [], progress = [];
  const run = (engine, prompt, opts) => {
    calls.push({ engine, prompt, opts });
    return overrides.run ? overrides.run(engine, prompt, opts) : Promise.resolve('Checked');
  };
  const c = vm.createContext({
    console: { warn() {} }, AbortController, Error, Promise,
    setTimeout(fn, ms) { timers.set(++id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    openAiOn: () => true, kimiOn: () => false,
    askGeminiDirect: (p, o) => run('gemini', p, o),
    _aiRun: run, _aiMarkUp() {}, _aiLast: {}, _aiWhy: {},
    _aiMarkDown(e, why) { down.push(e); c._aiWhy[e] = why; },
    AI_ROUTE_LABEL: { openai: 'ChatGPT', kimi: 'Kimi', gemini: 'Gemini' },
    window: { askOpenAI: (p, o) => run('openai', p, o), askKimi: (p, o) => run('kimi', p, o) }
  });
  vm.runInContext(helper, c);
  if (tutor) vm.runInContext(cut('function aiAskWith(', '/* What the admin'), c);
  else vm.runInContext(cut('window.askGemini = async function askGemini(', '// Gemini\'s ceiling'), c);
  return { c, calls, timers, down, progress,
    ask(opts = {}) {
      const options = { timeoutMs: 60000, routeTimeoutMs: 25000, system: 'TEACHER RULE', images: [{ data: 'PAGE' }], onProgress: m => progress.push(m), ...opts };
      return tutor ? c.aiAskWith('QUESTION', options, ['openai', 'gemini', 'kimi']) : c.window.askGemini('QUESTION', options);
    },
    fire(ms) { for (const [key, t] of [...timers]) if (t.ms === ms) { timers.delete(key); t.fn(); } }
  };
}

test('stalled provider is bounded, falls back, and preserves grounding and images', async () => {
  const first = deferred();
  const h = harness({ run: engine => engine === 'openai' ? first.promise : Promise.resolve('Backup answer') });
  const result = h.ask(); await flush();
  assert.equal(h.calls.length, 1);
  h.fire(25000); await flush();
  assert.equal(await result, 'Backup answer');
  assert.deepEqual(h.calls.map(c => c.engine), ['openai', 'gemini']);
  assert.equal(h.calls[0].opts.signal.aborted, true);
  assert.equal(h.calls[1].opts.system, 'TEACHER RULE');
  assert.equal(h.calls[1].opts.images[0].data, 'PAGE');
  assert.equal(h.progress.length, 1);
  first.resolve('Late answer'); await flush();
  assert.equal(h.calls.length, 2);
  assert.equal(h.timers.size, 0);
});

test('the overall deadline ends the wait without launching another fallback', async () => {
  const h = harness({ run: () => new Promise(() => {}) });
  const result = h.ask({ timeoutMs: 35000, routeTimeoutMs: 12000 });
  const rejected = assert.rejects(result, /took too long/);
  await flush(); h.fire(35000); await rejected; await flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].opts.signal.aborted, true);
  assert.equal(h.timers.size, 0);
});

test('ending a session aborts the check, with no fallback or late side effects', async () => {
  const reply = deferred(), parent = new AbortController();
  const h = harness({ run: () => reply.promise });
  const pending = h.ask({ signal: parent.signal });
  const rejected = assert.rejects(pending);
  await flush(); parent.abort(); await rejected;
  reply.reject(new Error('late network failure')); await flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].opts.signal.aborted, true);
  assert.equal(h.down.length, 0);
  assert.equal(h.timers.size, 0);
});

test('an already cancelled check makes no provider call', async () => {
  const parent = new AbortController(); parent.abort();
  const h = harness();
  await assert.rejects(h.ask({ signal: parent.signal }));
  assert.equal(h.calls.length, 0);
  assert.equal(h.timers.size, 0);
});

test('a success clears every timer and parent cancellation listener', async () => {
  const parent = new AbortController(), h = harness();
  assert.equal(await h.ask({ signal: parent.signal }), 'Checked');
  assert.equal(h.timers.size, 0);
  parent.abort(); await flush();
  assert.equal(h.calls[0].opts.signal.aborted, false);
});

test('Gemini timeout is passed to the SDK and network faults do not repeat high-thinking calls', async () => {
  const h = harness(), seen = [];
  Object.assign(h.c, {
    geminiModel: {}, AI_THINK_MIN: 'low', AI_MODEL: 'existing-model', GEMINI_MAX_OUTPUT: 32000,
    app: {}, GoogleAIBackend: class {}, getAI: () => ({}),
    getGenerativeModel: (_ai, _model, options) => ({ generateContent: async request => {
      seen.push({ options, request }); throw new Error('503 unavailable');
    } })
  });
  const start = html.indexOf('async function askGeminiDirect(');
  const end = tutor ? html.indexOf('</script>', start) : html.indexOf('// Picture generation for AI note cards.', start);
  vm.runInContext(html.slice(start, end), h.c);
  await assert.rejects(h.c.askGeminiDirect('Question', { thinkingLevel: 'high', routeTimeoutMs: 12000 }), /503/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].options.timeout, 12000);
  assert.equal(seen[0].request.generationConfig.thinkingConfig.thinkingLevel, 'high');
});

test('only a rejected thinking setting retries at the supported floor', async () => {
  const h = harness(), levels = [];
  Object.assign(h.c, {
    AI_THINK_MIN: 'low', GEMINI_MAX_OUTPUT: 32000,
    geminiModel: { generateContent: async request => {
      levels.push(request.generationConfig.thinkingConfig.thinkingLevel);
      if (levels.length === 1) throw new Error('400 INVALID_ARGUMENT: thinkingLevel unsupported');
      return { response: { text: () => 'Answer' } };
    } }
  });
  const start = html.indexOf('async function askGeminiDirect(');
  const end = tutor ? html.indexOf('</script>', start) : html.indexOf('// Picture generation for AI note cards.', start);
  vm.runInContext(html.slice(start, end), h.c);
  assert.equal(await h.c.askGeminiDirect('Question', { thinkingLevel: 'high' }), 'Answer');
  assert.deepEqual(levels, ['high', 'low']);
});

test('teaching explicitly uses arithmetic, unitary steps, restricted units-and-parts and the key first', () => {
  const h = harness(), rule = h.c.tutorMethodRule();
  for (const phrase of ['step-by-step arithmetic', 'unitary method', 'Do not introduce algebraic unknowns',
    'ONLY when this is very obviously', 'working FIRST', 'ONE short arithmetic step', 'wait for their reply',
    'do not mark a mathematically valid student solution wrong']) assert.ok(rule.includes(phrase), phrase);
});

if (!tutor) {
  test('whole-paper checks run two at a time and keep out-of-order results in worksheet order', async () => {
    const h = harness(), pending = [deferred(), deferred(), deferred()], began = [];
    const el = { classList: { add() {} } };
    Object.assign(h.c, { wsEpoch: 1, docName: 'Paper', wsMeta: { level: 'P6', subject: 'math' },
      studentProfile: null, currentUser: null, pages: [{ num: 1 }], $: () => el,
      markCluster: (p, anns) => { began.push(anns[0]); return pending[anns[0]].promise; }, renderReport() {}
    });
    vm.runInContext(cut('async function markClustersToReport(', 'async function checkAllAnswers'), h.c);
    const result = h.c.markClustersToReport([0, 1, 2].map(n => ({ page: 1, anns: [n] })), 'Checking');
    await flush(); assert.deepEqual(began, [0, 1]);
    pending[1].resolve({ res: { id: 1 }, band: 'B' }); await flush();
    assert.deepEqual(began, [0, 1, 2]);
    pending[2].resolve({ res: { id: 2 }, band: 'C' });
    pending[0].resolve({ res: { id: 0 }, band: 'A' }); await result;
    assert.equal(JSON.stringify(h.c.lastReport.results.map(r => r.res.id)), '[0,1,2]');
    assert.equal(h.c.aiBusy, false);
  });
  test('live Ans Key reads the current page’s key and does not borrow a different page’s answer', () => {
    const h = harness();
    vm.runInContext(cut('function lessonAnswerKeyContext(', 'async function lessonConnectLive'), h.c);
    h.c.lastAnswerKey = { items: [{ page: 1, number: '3', answer: '48', explanation: 'Find one item, then multiply.' }, { page: 2, number: '8', answer: '999' }] };
    const context = h.c.lessonAnswerKeyContext({ num: 1 });
    assert.match(context, /48/); assert.match(context, /Find one item/); assert.doesNotMatch(context, /999/);
    assert.match(h.c.lessonAnswerKeyContext({ num: 3 }), /No separate generated answer-key entry/);
  });
  test('practice marking includes the existing answer key and its working before checking', async () => {
    const h = harness(), page = { num: 1 }, answer = { page: 1, type: 'text', text: '48' };
    let request;
    Object.assign(h.c, { annotations: [answer], teacherAnswers: [], pages: [page], wsMeta: {},
      lastAnswerKey: { items: [{ page: 1, number: '3', answer: '48', explanation: 'Find one item, then multiply.' }] },
      annBounds: () => ({ y: 300, y2: 330 }), bandJpeg: () => '', compositeJpeg: () => '', pageJpeg: () => '',
      AI_MARK_SYS: 'Mark the answer.', aiGrounding: () => '', _parseAIJson: JSON.parse });
    h.c.window.askGemini = async (prompt, opts) => { request = { prompt, opts }; return '{"verdict":"correct"}'; };
    vm.runInContext(cut('function lessonAnswerKeyContext(', 'async function lessonConnectLive'), h.c);
    vm.runInContext(cut('async function markCluster(', 'function verdictHead('), h.c);
    assert.equal((await h.c.markCluster(page, [answer])).res.verdict, 'correct');
    assert.match(request.prompt, /Question 3: 48 Working: Find one item/);
    assert.match(request.opts.system, /working FIRST/);
    assert.match(request.opts.system, /unitary method/);
  });
}

if (tutor) {
  test('the default route deadline reaches the provider transport', async () => {
    const h = harness();
    await h.ask({ routeTimeoutMs: undefined });
    assert.equal(h.calls[0].opts.routeTimeoutMs, 45000);
  });
  function keyHarness(read) {
    const h = harness();
    const key = { pages: [3], rows: [], path: '', reading: false };
    Object.assign(h.c, { wsKey: key, wsEpoch: 1, pdfDoc: {}, aiAvailable: () => true,
      renderKeyChip() {}, toast() {}, setDirty() {}, keyReadOwnPages: read, keyReadPdfAt: async () => [] });
    vm.runInContext(cut('var keyReadJob = null;', '/* ---- A key that came as its own PDF'), h.c);
    return { ...h, key };
  }
  test('simultaneous teaching requests wait for one shared key read', async () => {
    const read = deferred(); let reads = 0;
    const h = keyHarness(() => { reads++; return read.promise; });
    const opening = h.c.keyRefreshRows(), help = h.c.keyEnsureReady();
    let ready = false; help.then(() => { ready = true; });
    await flush(); assert.equal(reads, 1); assert.equal(ready, false);
    read.resolve([{ number: '7', answer: '48', working: 'Find one item first' }]);
    await Promise.all([opening, help]);
    assert.equal(ready, true); assert.equal(h.key.rows[0].answer, '48');
    await h.c.keyEnsureReady(); assert.equal(reads, 1);
    assert.equal(h.timers.size, 0);
  });
  test('unreadable attached key blocks teaching instead of silently ignoring it', async () => {
    const h = keyHarness(async () => []);
    await assert.rejects(h.c.keyEnsureReady(), e => e.code === 'ANSWER_KEY_NOT_READY' && /could not read/.test(e.message));
    assert.equal(h.key.reading, false);
  });
  test('changing key pages invalidates cached answers before the next teaching request', async () => {
    let reads = 0;
    const h = keyHarness(async () => { reads++; return [{ answer: 'New selection' }]; });
    h.key.rows = [{ answer: 'Old selection' }];
    Object.assign(h.c, { keyLocked: () => false, pageIsKey: n => h.key.pages.includes(n),
      applyKeyVisibility() {}, renderKeyModal() {}, assignmentFor: () => ({ keyPages: [5] }) });
    vm.runInContext(cut('function toggleKeyPage(', '/* ====================================================================='), h.c);
    vm.runInContext(cut('function keyPagesFromAssignment(', 'function guidanceRule('), h.c);
    h.c.toggleKeyPage(4, true);
    assert.equal(h.key.rows.length, 0);
    await h.c.keyEnsureReady();
    assert.equal(h.key.rows[0].answer, 'New selection');
    assert.equal(reads, 1);
    h.c.keyPagesFromAssignment({});
    assert.equal(h.key.rows.length, 0);
  });
  test('replacing a PDF at the same path cannot reuse or publish its older read', async () => {
    const old = deferred(), next = deferred(); let reads = 0;
    const h = keyHarness(() => ++reads === 1 ? old.promise : next.promise);
    const previous = h.c.keyEnsureReady(), rejected = assert.rejects(previous, /answer key changed/);
    await flush(); h.key.revision = 1;
    const current = h.c.keyEnsureReady(); await flush();
    assert.equal(reads, 2);
    next.resolve([{ answer: 'Replacement' }]); await current;
    old.resolve([{ answer: 'Old key' }]); await rejected;
    assert.equal(h.key.rows[0].answer, 'Replacement');
  });
  test('a slow key gives a bounded wait while its shared read can finish for the next question', async () => {
    const read = deferred(), h = keyHarness(() => read.promise);
    const help = h.c.keyEnsureReady(), rejected = assert.rejects(help, /still being read/);
    await flush(); h.fire(20000); await rejected;
    assert.equal(h.key.reading, true);
    read.resolve([{ number: '7', answer: '48' }]); await flush();
    await h.c.keyEnsureReady(); assert.equal(h.key.rows[0].answer, '48');
    assert.equal(h.timers.size, 0);
  });
  test('late key results cannot overwrite another worksheet’s key', async () => {
    const read = deferred(), h = keyHarness(() => read.promise);
    const pending = h.c.keyRefreshRows(); await flush();
    const next = { pages: [2], rows: [{ answer: 'New key' }], path: '', reading: false };
    h.c.wsEpoch++; h.c.wsKey = next;
    read.resolve([{ answer: 'Old key' }]); await pending;
    assert.equal(next.rows[0].answer, 'New key');
  });
  test('a named question near the end of a long key retains its own answer and working', () => {
    const h = harness();
    h.c.wsKey = { rows: Array.from({ length: 60 }, (_, i) => ({ number: String(i + 1), answer: String(i), working: 'Explain this step. '.repeat(30) })), path: '' };
    vm.runInContext(cut('var KEY_CTX_MAX =', '/* ---- The 🔑 window'), h.c);
    assert.match(h.c.keyContext('Help with question 60'), /60 — 59/);
    assert.match(h.c.keyContext('Help with question 60'), /working: Explain/);
    assert.doesNotMatch(h.c.keyContext('Help with question 60'), /1 — 0/);
  });
}
