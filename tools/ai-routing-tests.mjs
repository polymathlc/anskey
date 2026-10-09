import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function cut(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  return html.slice(a, b);
}
function harness(initial = {}) {
  const values = new Map(Object.entries(initial)), calls = [], bodies = [];
  const c = vm.createContext({
    window: {}, console: { warn() {} }, AbortController, Error, Promise,
    setTimeout, clearTimeout,
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) },
    fetch: async (url, request) => { bodies.push({ url, body: JSON.parse(request.body) }); return { ok: true, json: async () => ({ choices: [{ message: { content: 'Answer' }, finish_reason: 'stop' }] }) }; },
    openAiOn: () => c.openAiActive(), kimiOn: () => c.kimiActive(),
    askGeminiDirect: async (prompt, opts) => { calls.push({ engine: 'gemini', prompt, opts }); return 'Gemini answer'; }
  });
  vm.runInContext(cut('var AI_ENGINE_STORE =', '/* ====================================================================='), c);
  vm.runInContext(cut('var OPENAI_REASONING_RE =', '/* Hard ceiling'), c);
  c.OPENAI_MAX_OUTPUT = 120000;
  vm.runInContext(cut('function getAiEngine()', '/* ── 🌙 KIMI'), c);
  vm.runInContext(cut('var KIMI_API_BASE =', 'window.askKimi ='), c);
  vm.runInContext(cut('window.askKimi = async function askKimi(', '/* What the account itself says'), c);
  vm.runInContext(cut('/* ================= AI request deadlines ================= */', '/* ================= End AI request deadlines ================= */'), c);
  vm.runInContext(cut('window.askOpenAI = async function askOpenAI(', '/* Picture generation for AI note cards, by the key'), c);
  vm.runInContext(cut('window.askGemini = async function askGemini(', "// Gemini's ceiling"), c);
  return { c, values, calls, bodies };
}
const bothKeys = { ak_openai_key: 'test-openai', ak_kimi_key: 'test-kimi' };
const plain = value => JSON.parse(JSON.stringify(value));

test('new and legacy automatic settings use Sol 6.1, while explicit or unrelated picks survive', () => {
  assert.equal(harness().c.getOpenAiModel(), 'gpt-6.1-sol');
  for (const model of ['gpt-6-astra', 'gpt-5.6-sol']) {
    const h = harness({ ak_openai_model: model, ak_openai_model_gen: 'astra' });
    assert.equal(h.c.getOpenAiModel(), 'gpt-6.1-sol');
    assert.equal(h.values.get('ak_openai_model_gen'), 'sol-6.1');
    assert.equal(h.c.openAiLiftModel(model, false, 'astra'), 'gpt-6.1-sol');
    assert.equal(h.c.openAiLiftModel(model, true, 'astra'), model);
  }
  assert.equal(harness({ ak_openai_model: 'gpt-6-astra', ak_openai_model_explicit: '1' }).c.getOpenAiModel(), 'gpt-6-astra');
  assert.equal(harness({ ak_openai_model: 'gpt-4.1' }).c.getOpenAiModel(), 'gpt-4.1');
  const migrated = harness({ ak_openai_model_gen: 'sol-6.1' });
  assert.equal(migrated.c.openAiLiftModel('gpt-6-astra', false, 'astra'), 'gpt-6.1-sol');
  assert.equal(migrated.c.openAiLiftModel('gpt-6-astra', true, 'sol-6.1'), 'gpt-6-astra');
});

test('text and worksheet vision use the same Sol model with supported reasoning and no sampling parameters', async () => {
  const h = harness(bothKeys);
  for (const effort of [undefined, 'none', 'minimal', 'medium', 'high']) {
    await h.c.window.askOpenAI('Check this worksheet', { effort, temperature: 0.2, top_p: 0.5, logprobs: true, json: true, images: [{ mimeType: 'image/png', data: 'PAGE' }], system: 'Teacher instructions', maxOutputTokens: 4096 });
    const { url, body } = h.bodies.at(-1);
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(body.model, 'gpt-6.1-sol');
    assert.equal(body.reasoning_effort, !effort || ['none', 'minimal'].includes(effort) ? 'low' : effort);
    assert.equal(body.messages[1].content[1].image_url.url, 'data:image/png;base64,PAGE');
    assert.match(body.messages[0].content, /Teacher instructions/);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    for (const key of ['temperature', 'top_p', 'logprobs', 'tools']) assert.equal(Object.hasOwn(body, key), false);
  }
});

test('default order is OpenAI, Gemini, Kimi; keys are independent of preferred provider', () => {
  const h = harness(bothKeys);
  assert.deepEqual(plain(h.c.window.aiTextEngineOrder()), ['openai', 'gemini', 'kimi']);
  h.values.delete('ak_openai_key');
  assert.deepEqual(plain(h.c.window.aiTextEngineOrder()), ['gemini', 'kimi']);
  h.values.set('ak_ai_engine', 'kimi');
  assert.deepEqual(plain(h.c.window.aiTextEngineOrder()), ['kimi', 'gemini']);
  h.values.delete('ak_kimi_key');
  assert.deepEqual(plain(h.c.window.aiTextEngineOrder()), ['gemini']);
});

test('Kimi K3 backup uses its supported reasoning schema for text and vision', async () => {
  const h = harness(bothKeys);
  for (const [effort, expected] of [[undefined, 'low'], ['none', 'low'], ['minimal', 'low'], ['low', 'low'], ['medium', 'high'], ['high', 'high'], ['xhigh', 'max'], ['max', 'max']]) {
    await h.c.window.askKimi('Read this worksheet', { effort, thinking: false, temperature: 0.2, top_p: 0.5, json: true, images: [{ mimeType: 'image/png', data: 'PAGE' }], maxOutputTokens: 4096 });
    const { url, body } = h.bodies.at(-1);
    assert.equal(url, 'https://api.moonshot.ai/v1/chat/completions');
    assert.equal(body.model, 'kimi-k3');
    assert.equal(body.reasoning_effort, expected);
    assert.equal(body.max_completion_tokens, 4096);
    assert.equal(body.messages[1].content[1].image_url.url, 'data:image/png;base64,PAGE');
    assert.deepEqual(body.response_format, { type: 'json_object' });
    for (const key of ['temperature', 'top_p', 'thinking', 'max_tokens']) assert.equal(Object.hasOwn(body, key), false);
  }
});

test('explicit legacy Kimi model retains its existing request schema', async () => {
  const h = harness({ ...bothKeys, ak_kimi_model: 'kimi-k2.5' });
  await h.c.window.askKimi('Question', { temperature: 0.2, maxOutputTokens: 4096 });
  const { body } = h.bodies.at(-1);
  assert.equal(body.model, 'kimi-k2.5');
  assert.equal(body.max_tokens, 4096);
  assert.equal(body.temperature, 0.2);
  assert.equal(Object.hasOwn(body, 'reasoning_effort'), false);
  assert.equal(Object.hasOwn(body, 'max_completion_tokens'), false);
});

test('two provider failures reach Kimi with identical grounding, images, thinking and output options', async () => {
  const h = harness(bothKeys);
  for (const engine of ['openai', 'gemini', 'kimi']) {
    const run = async (prompt, opts) => { h.calls.push({ engine, prompt, opts }); if (engine !== 'kimi') throw new Error(engine + ' unavailable'); return 'Kimi answer'; };
    if (engine === 'gemini') h.c.askGeminiDirect = run;
    else h.c.window[engine === 'openai' ? 'askOpenAI' : 'askKimi'] = run;
  }
  const opts = { system: 'Follow the answer key first', json: true, images: [{ mimeType: 'image/png', data: 'FROZEN PAGE' }], effort: 'high', maxOutputTokens: 4096 };
  assert.equal(await h.c.window.askGemini('Explain question 3', opts), 'Kimi answer');
  assert.deepEqual(h.calls.map(call => call.engine), ['openai', 'gemini', 'kimi']);
  for (const call of h.calls) {
    assert.equal(call.prompt, 'Explain question 3');
    for (const key of Object.keys(opts)) assert.deepEqual(plain(call.opts[key]), plain(opts[key]));
  }
  assert.equal(h.c.window.aiLastCall.engine, 'kimi');
  assert.equal(h.c.window.aiLastCall.fellBack, true);
});

test('successful OpenAI short-circuits backup providers; empty replies fall through', async () => {
  const h = harness(bothKeys);
  h.c.window.askOpenAI = async () => 'Sol answer';
  h.c.window.askKimi = async () => { throw new Error('Must not call Kimi'); };
  assert.equal(await h.c.window.askGemini('Question'), 'Sol answer');
  assert.equal(h.calls.length, 0);
  h.c.window.askOpenAI = async () => ' ';
  assert.equal(await h.c.window.askGemini('Question'), 'Gemini answer');
  assert.equal(h.c.window.aiLastCall.engine, 'gemini');
});

test('cancellation never starts another provider', async () => {
  const h = harness(bothKeys), controller = new AbortController();
  let requests = 0;
  h.c.window.askOpenAI = async () => { requests++; controller.abort(); throw new Error('Cancelled'); };
  h.c.window.askKimi = async () => { requests++; return 'Wrong'; };
  await assert.rejects(h.c.window.askGemini('Question', { signal: controller.signal }));
  assert.equal(requests, 1);
  assert.equal(h.calls.length, 0);
});

test('all exhausted providers throw and record no successful engine', async () => {
  const h = harness(bothKeys), attempted = [];
  h.c.window.askOpenAI = async () => { attempted.push('openai'); throw new Error('Primary unavailable'); };
  h.c.askGeminiDirect = async () => { attempted.push('gemini'); throw new Error('Backup unavailable'); };
  h.c.window.askKimi = async () => { attempted.push('kimi'); throw new Error('Last backup unavailable'); };
  await assert.rejects(h.c.window.askGemini('Question'), /Primary unavailable/);
  assert.deepEqual(attempted, ['openai', 'gemini', 'kimi']);
  assert.equal(h.c.window.aiLastCall.engine, '');
});

test('cloud migration cannot restore an old automatic default after a reload', async () => {
  const h = harness({ ...bothKeys, ak_openai_model_gen: 'sol-6.1' }), writes = [];
  h.c.currentUser = { uid: 'teacher' }; h.c.isAdmin = () => true;
  h.c.firebase = { firestore: { FieldValue: { delete: () => 'delete', serverTimestamp: () => 'timestamp' } } };
  h.c.db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ engine: 'openai', openAiKey: 'test-openai', model: 'gpt-6-astra', modelGen: 'astra' }) }), set: async (payload) => { writes.push(payload); } }) }) };
  h.c.getOpenAiImageModel = () => 'gpt-image-2.5-flare'; h.c.aiImageEngineSetting = () => 'openai';
  h.c.AI_IMAGE_ENGINES = ['openai', 'gemini']; h.c.renderAuthArea = () => {}; h.c.refreshAiEngineNames = () => {}; h.c.promptForOpenAiKey = () => {};
  vm.runInContext(cut('function aiEngineDocRef(', '/* ---- The one thing that cannot be shipped'), h.c);
  await h.c.loadAiEngineFromCloud(h.c.currentUser);
  assert.equal(h.c.getOpenAiModel(), 'gpt-6.1-sol');
  assert.equal(writes[0].model, 'gpt-6.1-sol');
  assert.equal(writes[0].modelGen, 'sol-6.1');
  assert.equal(writes[0].modelExplicit, false);
});

test('cloud sync preserves a deliberate prior model selection and saving unrelated fields keeps it explicit', async () => {
  const h = harness(bothKeys), writes = [];
  h.c.currentUser = { uid: 'teacher' }; h.c.isAdmin = () => true;
  h.c.firebase = { firestore: { FieldValue: { delete: () => 'delete', serverTimestamp: () => 'timestamp' } } };
  h.c.db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ openAiKey: 'test-openai', model: 'gpt-6-astra', modelExplicit: true, modelGen: 'astra' }) }), set: async payload => writes.push(payload) }) }) };
  h.c.getOpenAiImageModel = () => 'gpt-image-2.5-flare'; h.c.aiImageEngineSetting = () => 'openai';
  h.c.AI_IMAGE_ENGINES = ['openai', 'gemini']; h.c.renderAuthArea = () => {}; h.c.refreshAiEngineNames = () => {}; h.c.promptForOpenAiKey = () => {};
  vm.runInContext(cut('function aiEngineDocRef(', '/* ---- The one thing that cannot be shipped'), h.c);
  await h.c.loadAiEngineFromCloud(h.c.currentUser);
  assert.equal(h.c.getOpenAiModel(), 'gpt-6-astra');
  assert.equal(h.c.openAiModelExplicit(), true);
  await h.c.saveAiEngineToCloud(h.c.currentUser);
  assert.equal(writes[0].model, 'gpt-6-astra');
  assert.equal(writes[0].modelExplicit, true);
});

test('only an actual model-picker change marks a new deliberate model preference', async () => {
  const h = harness(bothKeys), fields = {
    aiEngineKeyInput: { value: 'test-openai' }, aiEngineModelSel: { value: 'gpt-6.1-sol', _aiModelChanged: false },
    aiEngineImageModelSel: { value: 'gpt-image-2.5-flare' }, aiEngineKimiModelInput: { value: 'kimi-k3' }, aiEngineKimiKeyInput: { value: 'test-kimi' }
  };
  h.c.$ = id => fields[id]; h.c.document = { querySelector: selector => ({ value: selector.includes('aiImageEngineChoice') ? 'openai' : 'openai' }) };
  h.c.AI_IMAGE_ENGINES = ['openai', 'gemini']; h.c.AI_IMAGE_ENGINE_DEFAULT = 'openai';
  h.c.OPENAI_IMAGE_DEFAULT_MODEL = 'gpt-image-2.5-flare'; h.c.currentUser = { uid: 'teacher' };
  h.c.toast = () => {}; h.c.closeAiEngineModal = () => {}; h.c.renderAuthArea = () => {}; h.c.refreshAiEngineNames = () => {}; h.c.saveAiEngineToCloud = async () => true;
  vm.runInContext(cut('function saveAiEngineSettings()', "$('aiEngineCloseBtn')"), h.c);
  h.c.saveAiEngineSettings();
  assert.equal(h.c.openAiModelExplicit(), false);
  fields.aiEngineModelSel.value = 'gpt-6-astra'; fields.aiEngineModelSel._aiModelChanged = true;
  h.c.saveAiEngineSettings();
  assert.equal(h.c.openAiModelExplicit(), true);
  assert.equal(h.c.getOpenAiModel(), 'gpt-6-astra');
});

/* ⚡ THE LIGHT JOB — ✒️ Fix grammar on the cheapest GPT-6 tier (v1.128.0). */
test('a light call leads with ChatGPT on the light model, keeping the teacher\'s choice behind it', async () => {
  const h = harness({ ...bothKeys, ak_ai_engine: 'gemini' });
  assert.equal(h.c.OPENAI_LIGHT_MODEL, 'gpt-6-luna');
  assert.deepEqual(plain(h.c.window.aiTextEngineOrder('light')), ['openai', 'gemini', 'kimi']);
  h.values.set('ak_ai_engine', 'kimi');
  assert.deepEqual(plain(h.c.window.aiTextEngineOrder('light')), ['openai', 'kimi', 'gemini']);
  assert.deepEqual(plain(h.c.window.aiTextEngineOrder()), ['kimi', 'openai', 'gemini']);
  h.values.delete('ak_openai_key');
  assert.deepEqual(plain(h.c.window.aiTextEngineOrder('light')), ['kimi', 'gemini']);

  const g = harness({ ...bothKeys, ak_ai_engine: 'gemini' });
  assert.equal(await g.c.window.askGemini('He have 2 spring.', { light: true, temperature: 0.4, maxOutputTokens: 1200 }), 'Answer');
  assert.equal(g.calls.length, 0, 'a light call must not start on Gemini');
  const { body } = g.bodies.at(-1);
  assert.equal(body.model, 'gpt-6-luna');
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(Object.hasOwn(body, 'temperature'), false);
  assert.equal(g.c.window.aiLastCall.light, true);
});

test('an ordinary call keeps the dialog model and the teacher\'s order', async () => {
  const h = harness({ ...bothKeys, ak_openai_model: 'gpt-6-astra', ak_openai_model_explicit: '1' });
  await h.c.window.askOpenAI('Explain question 3', { maxOutputTokens: 1200 });
  assert.equal(h.bodies.at(-1).body.model, 'gpt-6-astra');
  await h.c.window.askOpenAI('Fix this', { light: true });
  assert.equal(h.bodies.at(-1).body.model, 'gpt-6-luna');
  h.values.set('ak_ai_engine', 'gemini');
  assert.equal(await h.c.window.askGemini('Explain question 3', {}), 'Gemini answer');
  assert.equal(h.calls.length, 1);
});

test('a refused light model falls through to the backups with the same request', async () => {
  const h = harness(bothKeys);
  h.c.window.askOpenAI = async () => { const e = new Error('OpenAI API error 404: model not found'); e.status = 404; throw e; };
  assert.equal(await h.c.window.askGemini('He have 2 spring.', { light: true, system: 'GRAMMAR-ONLY TASK' }), 'Gemini answer');
  assert.equal(h.calls[0].opts.system, 'GRAMMAR-ONLY TASK');
  assert.equal(h.c.window.aiLastCall.engine, 'gemini');
  assert.equal(h.c.window.aiLastCall.fellBack, true);
});

/* THE CENSUS: the light flag belongs to ✒️ Fix grammar and nothing else. A
   light call that loses it goes quietly back to the full model; the flag
   spreading to ✨ Fill, 🐾 Mistake, marking or the key is a silent downgrade on
   exactly the text a class reads. */
test('census: only Fix grammar asks for the light model', () => {
  const body = name => {
    const a = html.indexOf('function ' + name + '(');
    assert.ok(a >= 0, name);
    const b = html.indexOf('\n}\n', a);
    return html.slice(a, b);
  };
  assert.match(body('aiImprove'), /\{ light: true \}/);
  for (const name of ['aiAnswer', 'aiMistakeGenerate']) assert.doesNotMatch(body(name), /light/);
  const flags = html.match(/\blight: true\b/g) || [];
  assert.equal(flags.length, 2, 'one in aiImprove and one in the comment above OPENAI_LIGHT_MODEL');
  assert.match(body('aiRequest'), /light: !!\(extra && extra\.light\)/);
});
