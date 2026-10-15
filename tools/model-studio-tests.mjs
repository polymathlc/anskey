// ✏️ The model suite is polymathlc/model's drawing board (v1.141.0).
// These pin what the source must keep saying; tools/model-studio-check.mjs
// drives the real board in Chromium.
//
// When polymathlc/model is checked out beside this repo (../model or
// ../polymathlc/model), the drawing engine is compared with that app's own,
// line for line, after the few documented port changes — so a fix made in
// one and not the other fails here rather than drifting silently.
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const studio = fs.readFileSync(path.join(ROOT, 'model-studio.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'model-studio.css'), 'utf8');
// What the files DO, without the comments that explain what they do not.
const code = studio.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');

function fn(src, name) {
  const at = src.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name + ' exists');
  return src.slice(at, src.indexOf('\n}\n', at) + 2);
}
const GLUE_START = '/* ================= ✏️ Model suite — the model studio\'s glue';
const glue = html.slice(html.indexOf(GLUE_START), html.indexOf('/* ================= Practice mode'));

test('the suite is for drawing only: no question, scenario, model answer or AI marking came across', () => {
  for (const word of ['scenario', 'Scenario', 'askGemini', 'gemini', 'openai', 'fetch(', 'runAiCheck', 'referenceSvg', 'expectedModel', 'CONCEPTS'])
    assert.ok(!code.includes(word), word + ' must not be in model-studio.js');
  const card = html.slice(html.indexOf('<div class="modalBack floatWin" id="msModal">'), html.indexOf('<div class="modalBack" id="videoModal">'));
  assert.ok(card.length > 1000, 'the window markup is there');
  for (const word of ['textarea', 'AI Check', 'Model Answer', 'New Scenario', 'concept'])
    assert.ok(!card.includes(word), word + ' must not be in the window');
  for (const toolName of ['select', 'bar', 'split', 'razor', 'shade', 'label', 'brace', 'arrow', 'divider', 'dotted', 'align', 'pen', 'eraser'])
    assert.ok(card.includes('data-tool="' + toolName + '"'), 'the ' + toolName + ' tool is on the toolbar');
});

test('the engine keeps to its window: closure, scoped lookups and scoped CSS', () => {
  assert.ok(/^\(function \(\) \{$/m.test(studio) && studio.trimEnd().endsWith('})();'), 'one closure, so its plain names never meet the worksheet\'s');
  assert.ok(!studio.includes('document.getElementById(\'drawingCanvas\')'), 'no bare document ids from the model app');
  assert.equal((studio.match(/document\.getElementById\(/g) || []).length, 1, 'only #msCard itself is found by id');
  // The document hears only the Shift key for the razor preview; every other
  // key is read on the window and stopped there.
  const docKeys = studio.match(/document\.addEventListener\('key(down|up)'/g) || [];
  assert.equal(docKeys.length, 2);
  assert.ok(/msRoot\.addEventListener\('keydown', function \(event\) \{[\s\S]*?event\.stopPropagation\(\);\n\}\);/.test(studio), 'every key stops at the window');
  for (const rule of cssCode.split('}').map(r => r.trim()).filter(r => r && !r.startsWith('@') && !/^(from|to)\b/.test(r) && !r.startsWith('/*'))) {
    const selector = rule.split('{')[0].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!selector || /^@|^(from|to)$|font-family|unicode-range|src:/.test(selector)) continue;
    for (const part of selector.split(',')) assert.ok(part.trim().startsWith('#msCard'), 'scoped: ' + part.trim());
  }
  assert.ok(!/:root/.test(cssCode), 'tokens live on #msCard, not :root');
});

test('a pinned model is a frameless picture that carries its model — never a new annotation type', () => {
  const pin = fn(html, 'msPinToPage');
  assert.ok(/type: 'ainote', kind: 'paste'/.test(pin), 'an ordinary pasted picture');
  assert.ok(/ms: \{ v: MS_DATA_VERSION, el: elements \}/.test(pin), 'the model rides along on a.ms');
  assert.ok(/ratio: round2\(ratio\)/.test(pin), 'its own shape, so a corner drag keeps it');
  assert.ok(pin.indexOf('msFlush();') < pin.indexOf('msAttachedId = a.id'), 'the scratch board is saved before the picture takes it over');
  assert.ok(pin.indexOf('if (!msCanPin())') >= 0 && pin.lastIndexOf('if (!msCanPin())') > pin.indexOf('api.picture()'), 'refused in the handler, and again after the picture is drawn');
  assert.ok(/annPastePic\(a\) && !!a\.ms/.test(fn(html, 'annModelStudio')));
  assert.ok(!/TYPES = \[[^\]]*'model/.test(html), 'no model annotation type');
  const bar = fn(html, 'renderPictureBar');
  assert.ok(/annModelStudio\(a\)[\s\S]*Edit model[\s\S]*msEditAttached\(a\.id\)/.test(bar), '✎ Edit model on the picture\'s own bar');
});

test('a model opened from a picture is written to that picture, never to the scratch board', () => {
  const flush = fn(html, 'msFlush');
  const attachedBranch = flush.slice(flush.indexOf('if (msAttachedId)'), flush.indexOf('try {'));
  assert.ok(/att\.ms = \{ v: MS_DATA_VERSION, el: api\.elements\(\) \}/.test(attachedBranch));
  assert.ok(/return;\n  \}\n  try \{/.test(flush), 'the attached branch returns before the scratch write');
  assert.ok(/msAttachedId = null;/.test(attachedBranch), 'a deleted picture releases its model');
  const refresh = fn(html, 'msRefreshAttachedPicture');
  assert.ok(refresh.indexOf('elements = api.elements()') < refresh.indexOf('api.picture()'), 'the elements are taken with the picture, not after the board moved on');
  assert.ok(/msAttachedId = null;\n  return refresh;/.test(fn(html, 'closeModelStudio')), 'closing lets go of the picture at once');
});

test('the old manual suite is gone, and its bars still render', () => {
  for (const gone of ['barModelPanel', 'model-suite.js', 'model-templates.js', 'bar-models.css', "tool === 'modelbar'", "tool === 'modelcut'", 'bmSync('])
    assert.ok(!html.includes(gone), gone + ' should be gone');
  for (const file of ['model-suite.js', 'model-templates.js', 'bar-models.css'])
    assert.ok(!fs.existsSync(path.join(ROOT, file)), file + ' should be deleted');
  for (const kept of ['bmSvgContents(g, a)', 'bmDrawOnCtx(ctx, a, kx, ky)', 'bmDrawOnPdf(a, page, cv, rgb, font, H)'])
    assert.ok(html.includes(kept), kept + ' still draws an old bar');
  assert.ok(html.indexOf('id="msModal"') < html.indexOf('<script src="model-studio.js"></script>'), 'the window exists before its script runs');
  assert.ok(/<link rel="stylesheet" href="model-studio.css">/.test(html));
});

test('the version moved with the change', () => {
  const v = (html.match(/var APP_VERSION = 'v(\d+)\.(\d+)\.(\d+)'/) || []).slice(1).map(Number);
  assert.ok(v[0] > 1 || (v[0] === 1 && v[1] >= 141), 'v1.141.0 or later');
});

const MODEL_CANDIDATES = [path.join(ROOT, '..', 'model', 'index.html'), path.join(ROOT, '..', 'polymathlc', 'model', 'index.html')];
const modelPath = MODEL_CANDIDATES.find(p => fs.existsSync(p));
test('the drawing engine is polymathlc/model\'s own, line for line', { skip: modelPath ? false : 'polymathlc/model is not checked out beside this repo' }, () => {
  const model = fs.readFileSync(modelPath, 'utf8');
  const from = model.indexOf('var GRID_SNAP = 8;');
  const to = model.lastIndexOf('</script>', model.indexOf('REFERENCE MODEL RENDERER'));
  assert.ok(from > 0 && to > from, 'the engine is found in the model app');
  let theirs = model.slice(from, to);
  const PORT = [
    ["document.getElementById('drawingCanvas')", "msQ('#msCanvas')"],
    ["document.getElementById('elementsLayer')", "msQ('#msElements')"],
    ["document.getElementById('previewLayer')", "msQ('#msPreview')"],
    ["document.getElementById('selectionLayer')", "msQ('#msSelection')"],
    ["document.getElementById('canvasHint')", "msQ('#msHint')"],
    ["document.getElementById('selectionCount')", "msQ('#msSelCount')"],
    ["document.getElementById('selectionActions')", "msQ('#msSelActions')"],
    ["document.querySelector('.tool-btn[data-tool=\"select\"]')", "msQ('.tool-btn[data-tool=\"select\"]')"],
    ["'Draw freely — sketch your whole model by hand if you like; the AI marks whatever you draw'", "'Draw freely — sketch any part of the model by hand'"],
    ["currentConceptId: 'comparison',\n  currentScenario: null,\n  ", '']
  ];
  for (const [a, b] of PORT) theirs = theirs.split(a).join(b);
  const ours = studio.slice(studio.indexOf('var GRID_SNAP = 8;'), studio.indexOf('/* ════════════════════════ THE WINDOW\'S OWN WIRING'));
  const norm = s => s.split('\n').map(l => l.trimEnd()).join('\n').trim();
  const a = norm(ours).split('\n'), b = norm(theirs).split('\n');
  const first = a.findIndex((line, i) => line !== b[i]);
  assert.equal(first, -1, 'the engines differ from line ' + (first + 1) + ':\n  ours:   ' + a[first] + '\n  theirs: ' + b[first]);
  assert.equal(a.length, b.length);
});
