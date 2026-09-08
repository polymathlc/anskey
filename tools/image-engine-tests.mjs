// 🖼 THE IMAGE ENGINE — ChatGPT Images 2.5 for every picture (v1.90.0)
//
// Loads the REAL image-engine block and the real `window.askOpenAiImage` out
// of index.html against stubs and pins what fails silently — a picture comes
// out whichever model drew it:
//  • the default model is gpt-image-2.5-flare, the dropdown leads with it, an
//    id the dropdown no longer offers falls back to it;
//  • the one-shot LIFT on the device AND the record's copy;
//  • the ORDER: ChatGPT Images by the admin's key first, Gemini behind it,
//    regardless of the TEXT engine; Gemini alone with no key;
//  • a refusal is remembered, a refusal about ONE picture is not;
//  • the request shape: max passes through on a 2.5 model and is clamped on a
//    legacy one, edits carry input_fidelity, several references go up as
//    image[], an "unknown parameter" 400 is retried bare;
//  • the bridge walks the order and throws on a route that returned nothing;
//  • the dialog, the record and the version.
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function section(from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('section not found: ' + from.slice(0, 40));
  return src.slice(a, b);
}
const block = section("var OPENAI_IMAGE_DEFAULT_MODEL = ", '/* A REASONING MODEL IS A FAMILY');
const asker = section("window.askOpenAiImage = async function askOpenAiImage", '/* ---------- Remembering the key across devices');

function build(storeInit) {
  return new Function(`
var _store = ${JSON.stringify(storeInit || {})};
var localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null; },
  setItem: function (k, v) { _store[k] = String(v); },
  removeItem: function (k) { delete _store[k]; }
};
var AI_ENGINE_STORE = { engine: 'x_ai_engine', key: 'x_openai_key', model: 'x_openai_model', imageModel: 'x_openai_image_model', kimiKey: 'x_kimi_key', kimiModel: 'x_kimi_model', modelGen: 'x_openai_model_gen', imageEngine: 'x_ai_image_engine', imageGen: 'x_openai_image_gen' };
var _key = '';
function getOpenAiKey() { return _key; }
function escHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
var window = {};
var fetchMode = 'ok', fetchCalls = [];
async function fetch(url, init) {
  fetchCalls.push({ url: url, init: init });
  if (fetchMode === 'unauth') return { ok: false, status: 401, json: async () => ({ error: { message: 'Incorrect API key provided' } }) };
  if (fetchMode === 'unsupported' && fetchCalls.length % 2 === 1) return { ok: false, status: 400, json: async () => ({ error: { message: 'Unknown parameter: input_fidelity' } }) };
  return { ok: true, json: async () => ({ data: [{ b64_json: 'S0VZ' }] }) };
}
var atob = globalThis.atob, Blob = globalThis.Blob, FormData = globalThis.FormData;
var console = { warn: function () {} };
` + block + asker + `
return {
  store: _store, window: window,
  set key(v) { _key = v; },
  set fetchMode(v) { fetchMode = v; },
  get fetchCalls() { return fetchCalls; },
  get down() { return _imgDown; },
  OPENAI_IMAGE_DEFAULT_MODEL, OPENAI_IMAGE_MODELS, OPENAI_IMAGE_25_RE, OPENAI_IMAGE_SUPERSEDED, OPENAI_IMAGE_GEN,
  openAiLiftImageModel, getOpenAiImageModel, openAiImageModelOptionsHtml, _imgQualityFor, aiImageEngineSetting,
  imageEngineOrder, imageEngineLabel, imageRouteNote, _imgRouteFault, _imgMarkDown, _imgMarkUp
};
`)();
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fail++;
  console.log('  FAIL ' + name + (extra ? '\n       ' + extra : ''));
}
const run = (name, fn) => Promise.resolve().then(fn).catch(e => { fail++; console.log('  FAIL ' + name + ' threw: ' + (e && e.stack || e)); });

await run('model', () => {
  const api = build();
  ok('the default image model is ChatGPT Images 2.5 Flare', api.OPENAI_IMAGE_DEFAULT_MODEL === 'gpt-image-2.5-flare');
  ok('the dropdown leads with Flare and offers Sunburst second', api.OPENAI_IMAGE_MODELS[0].id === 'gpt-image-2.5-flare' && api.OPENAI_IMAGE_MODELS[1].id === 'gpt-image-2.5-sunburst');
  ok('the family regex takes both 2.5 models and their snapshots and nothing else',
     ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare-2026-09-08'].every(id => api.OPENAI_IMAGE_25_RE.test(id)) && !api.OPENAI_IMAGE_25_RE.test('gpt-image-2'));
  api.store.x_openai_image_model = 'gpt-image-9';
  ok('an id the dropdown no longer offers is the DEFAULT', api.getOpenAiImageModel() === 'gpt-image-2.5-flare');
  api.store.x_openai_image_model = 'gpt-image-2.5-sunburst';
  ok('a deliberate Sunburst pick is honoured', api.getOpenAiImageModel() === 'gpt-image-2.5-sunburst');
  ok('the <select> is BUILT from the list with the stored model selected', /value="gpt-image-2.5-sunburst" selected/.test(api.openAiImageModelOptionsHtml()) && (api.openAiImageModelOptionsHtml().match(/<option/g) || []).length === api.OPENAI_IMAGE_MODELS.length);
  ok('max passes through on a 2.5 model and is clamped to high on a legacy one', api._imgQualityFor('gpt-image-2.5-flare', 'max') === 'max' && api._imgQualityFor('gpt-image-1', 'max') === 'high' && api._imgQualityFor('gpt-image-2.5-flare', 'ultra') === 'high');
});

await run('lift', () => {
  let api = build({ x_openai_image_model: 'gpt-image-1' });
  ok('a device carrying yesterday\'s default is lifted to Flare', api.store.x_openai_image_model === 'gpt-image-2.5-flare' && api.store.x_openai_image_gen === api.OPENAI_IMAGE_GEN);
  ok('…and the RECORD\'s copy is lifted in the same window', api.openAiLiftImageModel('gpt-image-1') === 'gpt-image-2.5-flare' && api.openAiLiftImageModel('gpt-image-2.5-sunburst') === 'gpt-image-2.5-sunburst');
  api = build({ x_openai_image_model: 'gpt-image-1', x_openai_image_gen: 'images25' });
  ok('a deliberate re-pick of a legacy model AFTER the lift sticks, on the device and in the record', api.store.x_openai_image_model === 'gpt-image-1' && api.openAiLiftImageModel('gpt-image-1') === 'gpt-image-1');
});

await run('order', () => {
  const api = build();
  api.key = '';
  ok('with no key the order is Gemini alone, and the note says the key is needed', api.imageEngineOrder().join() === 'imgGemini' && /needs your OpenAI key/.test(api.imageRouteNote()));
  api.key = 'sk-test';
  ok('with a key ChatGPT Images leads and Gemini follows', api.imageEngineOrder().join() === 'imgKey,imgGemini', api.imageEngineOrder().join());
  api.store.x_ai_engine = 'gemini';
  ok('the TEXT engine has no say', api.imageEngineOrder()[0] === 'imgKey');
  api.store.x_ai_engine = 'kimi';
  ok('…not even Kimi', api.imageEngineOrder()[0] === 'imgKey');
  api.store.x_ai_image_engine = 'gemini';
  ok('choosing the Gemini image model puts it first and keeps ChatGPT Images behind it', api.imageEngineOrder().join() === 'imgGemini,imgKey');
  api.store.x_ai_image_engine = 'nonsense';
  ok('an unreadable stored value is the default', api.aiImageEngineSetting() === 'openai');
  api.store.x_ai_image_engine = 'openai';
  ok('skipOpenAi is Gemini and nothing else', api.imageEngineOrder({ skipOpenAi: true }).join() === 'imgGemini');
  ok('the label names ChatGPT Images and the model', /ChatGPT Images · gpt-image-2\.5-flare/.test(api.imageEngineLabel()));
  api._imgMarkDown('imgKey', { status: 401, message: 'Incorrect API key' });
  ok('a refused key goes to the BACK of the order, never off it', api.imageEngineOrder().join() === 'imgGemini,imgKey' && /refused for pictures/.test(api.imageRouteNote()));
  api._imgMarkUp('imgKey');
  api._imgMarkDown('imgKey', { status: 400, message: 'Your request was rejected by the safety system' });
  ok('a refusal about ONE picture does not close the route', api.imageEngineOrder()[0] === 'imgKey');
  ok('the bridge is handed the order and the marks', typeof api.window.imageEngineOrder === 'function' && typeof api.window._imgMarkDown === 'function' && typeof api.window._imgMarkUp === 'function');
});

await run('request shape', async () => {
  const api = build();
  api.key = 'sk-test';
  let out = await api.window.askOpenAiImage('a diagram', { quality: 'max' });
  ok('a generation returns the { mimeType, data } shape', out && out.mimeType === 'image/png' && out.data === 'S0VZ');
  let body = JSON.parse(api.fetchCalls[0].init.body);
  ok('…on /generations, square, Flare, with max passed through', /\/images\/generations$/.test(api.fetchCalls[0].url) && body.model === 'gpt-image-2.5-flare' && body.size === '1024x1024' && body.quality === 'max' && body.output_format === 'png');
  api.fetchCalls.length = 0;
  await api.window.askOpenAiImage('redraw', { refs: ['data:image/png;base64,QUJD', 'data:image/jpeg;base64,REVG'], transparent: true });
  const fd = api.fetchCalls[0].init.body;
  ok('references make it an EDIT, as multipart, with image[] and input_fidelity high', /\/images\/edits$/.test(api.fetchCalls[0].url) && fd.getAll('image[]').length === 2 && fd.get('input_fidelity') === 'high' && fd.get('size') === 'auto');
  ok('transparent asks for a transparent background on png', fd.get('background') === 'transparent' && fd.get('output_format') === 'png');
  api.fetchCalls.length = 0; api.fetchMode = 'unsupported';
  await api.window.askOpenAiImage('draw', { refs: ['data:image/png;base64,QUJD'] });
  ok('an "unknown parameter" 400 is retried once with the bare minimum', api.fetchCalls.length === 2 && api.fetchCalls[1].init.body.getAll('image').length === 1 && !api.fetchCalls[1].init.body.get('input_fidelity'));
  api.fetchMode = 'unauth'; api.fetchCalls.length = 0;
  let err = null;
  try { await api.window.askOpenAiImage('draw', {}); } catch (e) { err = e; }
  ok('a refused key throws with the status on it', err && err.status === 401 && api._imgRouteFault(err) === true);
  api.key = '';
  err = null;
  try { await api.window.askOpenAiImage('draw', {}); } catch (e) { err = e; }
  ok('no key is a refusal by name', err && /No OpenAI API key/.test(err.message));
});

/* ---------- the wiring ---------- */
{
  const bi = src.indexOf('window.askGeminiImage = async function askGeminiImage');
  const bridge = src.slice(bi, src.indexOf('\n};\n', bi));
  ok('the bridge walks window.imageEngineOrder, not openAiOn()', /window\.imageEngineOrder\(opts\)/.test(bridge) && !/openAiOn\(\)/.test(bridge));
  ok('a route that returned no picture is a refusal, so the SVG fallback is reached', /throw new Error\("the image model returned no picture"\)/.test(bridge));
  ok('the bridge marks routes down and up', /window\._imgMarkDown\(route, e\)/.test(bridge) && /window\._imgMarkUp\(route\)/.test(bridge));
  ok('the dialog offers the picture engine, ChatGPT Images checked', /name="aiImageEngineChoice" value="openai" checked/.test(src) && /name="aiImageEngineChoice" value="gemini"/.test(src));
  ok('the dropdown in the markup leads with Flare, selected', /<option value="gpt-image-2\.5-flare" selected>/.test(src) && /<option value="gpt-image-2\.5-sunburst">/.test(src));
  ok('the dropdown is rebuilt from the list when the dialog opens', /imgSel\.innerHTML = openAiImageModelOptionsHtml\(getOpenAiImageModel\(\)\);/.test(src));
  ok('the dialog saves the picture engine', /localStorage\.setItem\(AI_ENGINE_STORE\.imageEngine, imgEng\);/.test(src));
  ok('the record carries the picture engine and lifts the image model', /imageEngine: aiImageEngineSetting\(\),/.test(src) && /var imageModel = openAiLiftImageModel\(d\.imageModel\);/.test(src) && /if \(d && d\.imageEngine && AI_IMAGE_ENGINES\.indexOf\(d\.imageEngine\) >= 0\)/.test(src));
  ok('the store carries the two new slots', /imageEngine: 'ak_ai_image_engine', imageGen: 'ak_openai_image_gen'/.test(src));
  ok('the old default is gone from the code', !/OPENAI_IMAGE_DEFAULT_MODEL = 'gpt-image-1'/.test(src));
  ok('no API key is committed', !/sk-[A-Za-z0-9]{20,}/.test(src));
  ok('the version was bumped', /var APP_VERSION = 'v1\.90\./.test(src));
}

console.log(`image-engine tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
