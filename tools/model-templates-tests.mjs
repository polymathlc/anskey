// Exercise manual templates with the annotation/history operations used by the app.
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const models = fs.readFileSync(new URL('../bar-models.js', import.meta.url), 'utf8');
const templates = fs.readFileSync(new URL('../model-templates.js', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
function fn(name) {
  const at = html.indexOf('function ' + name + '(');
  assert(at >= 0, name + ' exists');
  return html.slice(at, html.indexOf('\n}', at) + 2);
}
function harness() {
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { value: '', hidden: true, attrs: {}, children: [],
      setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); },
      addEventListener() {}, querySelectorAll() { return []; },
      getBoundingClientRect() { return { top: 0, bottom: 800, height: 800, left: 0, width: 600 }; } });
    return nodes.get(id);
  }
  const values = { bmLabel: '?', bmWidth: '300', bmHeight: '42', bmParts: '5', bmCompareUnits: '2',
    bmRatioTemplateA: '2', bmRatioTemplateB: '3', bmBeforeParts: '3', bmAfterParts: '5',
    bmRowNameA: '', bmRowNameB: '', bmRowTotalA: '?', bmRowTotalB: '?',
    bmGroupCount: '3', bmGroupQuantity: '?', bmNumerator: '3' };
  Object.entries(values).forEach(([id, value]) => { node(id).value = value; });
  const c = vm.createContext({ console, Date, document: { activeElement: null, getElementById: node,
    createElement: () => ({ getContext: () => ({ font: '14px Arial', measureText(text) { return { width: text.length * parseFloat(this.font) * .6 }; } }) }) } });
  const setup = [
    'var nextId=0,annotations=[],undoStack=[],redoStack=[],selectedId=null,editingId=null,editModeId=null,lassoSel=null;',
    'var drawing=null,draggingSel=null,resizingSel=null,erasing=null,lassoing=null,lassoMoving=null,lassoResizing=null,lassoRotating=null;',
    'var lessonPlayback=null,lessonOpening=null,reviseMode=false,practiceMode=false,student=false,tool="select",dirtyCount=0,notices=[];',
    'var pages=[{num:1,baseW:600,baseH:800,svg:document.getElementById("page1")}],visiblePage=1;',
    'function currentPageNum(){return visiblePage;}function newAnnId(){return "template"+(++nextId);}',
    'function isStudent(){return student;}function annLocked(a){return !!a.locked;}function annNoteMin(){return false;}',
    'function round2(n){return Math.round(n*100)/100;}function setDirty(){dirtyCount++;}',
    'function clearLassoSel(){lassoSel=null;}function showLassoBar(){}function commitActiveTextEdit(){}',
    'function renderAllOverlays(){}function toast(m){notices.push(m);}function setTool(t){tool=t;clearLassoSel();}',
    'var BRACE_DEPTH_MIN=9,BRACE_DEPTH_MAX=34,BRACE_DEPTH_FRAC=.1;'
  ].join('\n');
  vm.runInContext(setup + '\n' + ['annFrame', 'annFrameCorners', 'rotPt', 'annBounds', 'braceDepth', '_qSample', 'bracePoints',
    'translateAnn', 'snapshot', 'pushUndo', 'undo', 'redo', 'afterHistoryChange'].map(fn).join('\n') + '\n' + models + '\n' + templates, c);
  return { c, node, run: text => vm.runInContext(text, c), read: text => clone(vm.runInContext(text, c)) };
}

test('ratio lengths preserve both supplied counts, whichever row is longer', () => {
  const { read } = harness();
  for (const [a, b] of [[2, 3], [5, 2], [1, 12], [7, 7]]) {
    const spec = read(`bmManualTemplateSpec('ratio',{w:360,h:42,a:${a},b:${b}})`);
    const ys = [...new Set(spec.bars.map(bar => bar.y))];
    const rows = ys.map(y => spec.bars.filter(bar => bar.y === y));
    assert.equal(rows[0].length, a); assert.equal(rows[1].length, b);
    const span = row => row.reduce((total, bar) => total + bar.w, 0);
    assert(Math.abs(span(rows[0]) / span(rows[1]) - a / b) < 1e-12);
    assert(spec.bars.every(bar => bar.w === 360 / Math.max(a, b) && bar.label === '?'));
    assert.equal(spec.brackets[0].label, 'A: ?'); assert.equal(spec.brackets[1].label, 'B: ?');
  }
});

test('row names and separate supplied totals stay separate; no missing answer is invented', () => {
  const { node, run, read } = harness();
  node('bmRowNameA').value = '  Ali   ';
  node('bmRowNameB').value = 'Mei';
  node('bmRowTotalA').value = '24 marbles';
  node('bmLabel').value = '999';
  run('bmManualTemplate("ratio")');
  assert.deepEqual(read('annotations.filter(a=>a.type==="text").map(a=>a.text)'), ['Ali: 24 marbles', 'Mei: ?']);
  assert(read('annotations.filter(bmIsBar)').every(bar => bar.modelLabel === '?'));
});

test('narrow ratio labels expand within the model width and remain readable without changing unit geometry', () => {
  const { node, run, read } = harness();
  node('bmRatioTemplateA').value = '1'; node('bmRatioTemplateB').value = '12';
  node('bmRowNameA').value = 'Ali'; node('bmRowTotalA').value = '24 marbles';
  run('bmManualTemplate("ratio")');
  const bar = read('annotations.find(bmIsBar)'), label = read('annotations.find(a=>a.type==="text")');
  assert.equal(bar.w, 25); assert(label.w > bar.w); assert(label.x >= bar.x);
  assert(label.x + label.w <= bar.x + 300); assert(label.fontSize >= 8);
  assert(label.text.length * label.fontSize * .6 <= label.w - 11.999);
  assert(label.y + label.h < bar.y);
});

test('before and after models use a common unit and preserve the requested state labels', () => {
  const { run, read } = harness();
  run('bmManualTemplate("beforeafter")');
  const bars = read('annotations.filter(bmIsBar)');
  assert.equal(bars.length, 8); assert(bars.every(bar => bar.w === 60));
  assert.deepEqual(read('annotations.filter(a=>a.type==="text").map(a=>a.text)'), ['Before: ?', 'After: ?']);
  assert.equal(new Set(bars.slice(0, 3).map(bar => bar.fill)).size, 1);
  assert.notEqual(bars[0].fill, bars.at(-1).fill);
});

test('equal groups leave equal gaps, fit the total width, and retain quantity and unknown total', () => {
  const { node, run, read } = harness();
  node('bmGroupCount').value = '4'; node('bmGroupQuantity').value = '6 apples';
  run('bmManualTemplate("equalgroups")');
  const bars = read('annotations.filter(bmIsBar)');
  assert.equal(bars.length, 4); assert(bars.every(bar => bar.w === 69 && bar.modelLabel === '6 apples'));
  assert.equal(bars[1].x - bars[0].x - bars[0].w, 8);
  assert.equal(bars.at(-1).x + bars.at(-1).w - bars[0].x, 300);
  assert.equal(read('annotations.find(a=>a.type==="text").text'), '?');
});

test('fraction numerator determines shading and the labelled span, including zero and one whole', () => {
  for (const numerator of [0, 1, 3, 5]) {
    const { node, run, read } = harness(); node('bmNumerator').value = String(numerator);
    run('bmManualTemplate("fraction")');
    const bars = read('annotations.filter(bmIsBar)');
    assert.equal(bars.length, 5); assert(bars.every(bar => bar.w === 60 && bar.modelLabel === '1/5'));
    assert.equal(bars.filter(bar => bar.fill !== '#F3F4F6').length, numerator);
    const labels = read('annotations.filter(a=>a.type==="text").map(a=>a.text)');
    assert.deepEqual(labels, ['1 whole', numerator ? numerator + '/5' : '0/5 shaded']);
    if (!numerator) assert.equal(read('annotations.find(a=>a.type==="text" && a.text==="0/5 shaded").modelObject'), true);
    const brackets = read('annotations.filter(a=>a.type==="brace")');
    assert.equal(brackets.length, numerator ? 2 : 1);
    if (numerator) assert.equal(Math.abs(brackets[1].x2 - brackets[1].x1), 60 * numerator);
  }
});

test('all template pieces are one persistent group, selected together, and restored by undo/redo', () => {
  for (const kind of ['ratio', 'beforeafter', 'equalgroups', 'fraction']) {
    const { c, run, read } = harness(); run(`bmManualTemplate('${kind}')`);
    const additions = read('annotations');
    assert.equal(new Set(additions.map(a => a.grp)).size, 1); assert(additions.every(a => a.grp));
    assert.deepEqual(read('lassoSel.ids'), additions.map(a => a.id));
    assert.equal(c.undoStack.length, 1); assert.equal(c.dirtyCount, 1);
    run('undo()'); assert.equal(c.annotations.length, 0);
    run('redo()'); assert.deepEqual(read('annotations'), additions);
  }
});

test('cutting a grouped template retains its labels and group; a locked label protects the cut', () => {
  const { c, run, read } = harness();
  run('bmManualTemplate("ratio");var originalBar=annotations.find(bmIsBar),group=originalBar.grp;var beforeCut=snapshot();bmSplit(originalBar,[.5]);');
  const items = read('annotations');
  assert.equal(items.filter(a => a.modelBar).length, 6); assert(items.every(a => a.grp === c.group));
  assert.deepEqual(items.filter(a => a.type === 'text').map(a => a.text), ['A: ?', 'B: ?']);
  run('undo()'); assert.equal(run('snapshot()'), c.beforeCut);
  run('annotations.find(a=>a.type==="text").locked=true;var beforeLocked=snapshot(),historyBefore=undoStack.length;');
  assert.throws(() => run('bmSplit(annotations.find(bmIsBar),[.5])'), /Unlock/);
  assert.equal(run('snapshot()'), c.beforeLocked); assert.equal(c.undoStack.length, c.historyBefore);
});

test('templates use the current page and contain every bar and brace inside its page', () => {
  for (const kind of ['ratio', 'beforeafter', 'equalgroups', 'fraction']) {
    const { run, read } = harness();
    run(`pages.push({num:2,baseW:600,baseH:800,svg:document.getElementById('page2')});visiblePage=2;bmManualTemplate('${kind}');bmValidatePlacement(annotations)`);
    assert(read('annotations').every(a => a.page === 2));
  }
});

test('invalid counts, too-small units, long labels, and models larger than the page fail before any undo or write', () => {
  for (const [kind, field, value] of [
    ['ratio', 'bmRatioTemplateA', '0'], ['ratio', 'bmRatioTemplateB', '2.5'],
    ['beforeafter', 'bmBeforeParts', '13'], ['beforeafter', 'bmAfterParts', '-1'],
    ['equalgroups', 'bmGroupCount', '0'], ['equalgroups', 'bmWidth', '30'],
    ['fraction', 'bmNumerator', '6'], ['fraction', 'bmNumerator', '-1'],
    ['fraction', 'bmParts', '1'], ['ratio', 'bmRowNameA', 'A'.repeat(41)],
    ['ratio', 'bmWidth', '601'], ['beforeafter', 'bmHeight', '400']
  ]) {
    const { c, node, run } = harness(); node(field).value = value;
    assert.throws(() => run(`bmManualTemplate('${kind}')`), undefined, `${kind} ${field}=${value}`);
    assert.equal(c.annotations.length, 0); assert.equal(c.undoStack.length, 0); assert.equal(c.dirtyCount, 0);
  }
});
