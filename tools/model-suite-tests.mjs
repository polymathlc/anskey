// Run the manual suite against the shipped geometry, mutations and history.
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const models = fs.readFileSync(new URL('../bar-models.js', import.meta.url), 'utf8');
const suite = fs.readFileSync(new URL('../model-suite.js', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
function fn(name) {
  const at = html.indexOf('function ' + name + '(');
  assert(at >= 0, name + ' exists');
  return html.slice(at, html.indexOf('\n}', at) + 2);
}
function harness() {
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { value: '', hidden: true, attrs: {}, children: [], handlers: {},
      setAttribute(k, v) { this.attrs[k] = v; }, appendChild(child) { this.children.push(child); },
      addEventListener(type, handler) { this.handlers[type] = handler; }, querySelectorAll() { return []; },
      getBoundingClientRect() { return { top: 0, bottom: 800, height: 800, left: 0, width: 600 }; } });
    return nodes.get(id);
  }
  Object.entries({ bmLabel: '?', bmWidth: '300', bmHeight: '42', bmParts: '3', bmCompareUnits: '2',
    bmRatio: '2:3:1', bmCutPercent: '25', bmGap: '12', bmStep: '5' }).forEach(([id, value]) => { node(id).value = value; });
  const c = vm.createContext({ console, TextEncoder, Date,
    document: { activeElement: null, getElementById: node, createElement: () => ({ getContext: () => ({ measureText: t => ({ width: t.length * 8 }) }) }) } });
  const setup = `
    var nextId=0,annotations=[],undoStack=[],redoStack=[],selectedId=null,editingId=null,editModeId=null,lassoSel=null;
    var drawing=null,draggingSel=null,resizingSel=null,erasing=null,lassoing=null,lassoMoving=null,lassoResizing=null,lassoRotating=null;
    var lessonPlayback=null,lessonOpening=null,lessonCapture=null,reviseMode=false,practiceMode=false,student=false,tool='select',dirtyCount=0,notices=[];
    var pages=[{num:1,baseW:600,baseH:800,svg:document.getElementById('page1')}],visiblePage=1;
    function currentPageNum(){return visiblePage;}function newAnnId(){return 'bar'+(++nextId);}
    function isStudent(){return student;}function annLocked(a){return !!a.locked;}function annNoteMin(){return false;}
    function round2(n){return Math.round(n*100)/100;}function setDirty(){dirtyCount++;}
    function clearLassoSel(){lassoSel=null;}function showLassoBar(){}function commitActiveTextEdit(){}
    function renderAllOverlays(){}function toast(m){notices.push(m);}function setTool(t){tool=t;clearLassoSel();if(t!=='select')selectedId=null;}
    var BRACE_DEPTH_MIN=9,BRACE_DEPTH_MAX=34,BRACE_DEPTH_FRAC=.1;
    function selectIds(ids){lassoSel=ids.length>1?{page:pages.find(p=>p.num===annotations.find(a=>a.id===ids[0]).page),ids:ids}:null;selectedId=ids.length===1?ids[0]:null;}
  `;
  vm.runInContext(setup + '\n' + ['annFrame', 'annFrameCorners', 'rotPt', 'annBounds', 'braceDepth', '_qSample', 'bracePoints', 'translateAnn',
    'snapshot', 'pushUndo', 'undo', 'redo', 'afterHistoryChange'].map(fn).join('\n') + '\n' + models + '\n' + suite, c);
  return { c, node, run: s => vm.runInContext(s, c), read: s => clone(vm.runInContext(s, c)) };
}
function twoBars(h) {
  h.run(`annotations=[bmNewBar(1,40,120,120,40,'?'),bmNewBar(1,220,220,180,60,'?')];selectIds(annotations.map(a=>a.id));`);
}
test('manual ratio cuts preserve exact spans and keep a known whole separate from its parts', () => {
  const h = harness();
  h.run(`var a=bmNewBar(1,40,120,300,42,'60');annotations=[a];selectedId=a.id;bmSuiteRun('ratio-split');`);
  assert.deepEqual(h.read('annotations.filter(bmIsBar).map(a=>Math.round(a.w*1e8)/1e8)'), [100, 150, 50]);
  assert.equal(h.read('annotations.filter(bmIsBar).reduce((sum,a)=>sum+a.w,0)'), 300);
  assert.deepEqual(h.read('annotations.filter(bmIsBar).map(a=>a.modelLabel)'), ['?', '?', '?']);
  assert.equal(h.read('annotations.find(a=>a.type==="text").text'), '60');
  assert.equal(h.c.undoStack.length, 1);
  h.run('undo()'); assert.deepEqual(h.read('annotations'), h.read('[a]'));
  h.run(`bmSuiteRun('redo')`); assert.equal(h.read('annotations.filter(bmIsBar).length'), 3);
});
test('malformed, zero, excessively long and too-small ratio cuts leave annotations and history unchanged', () => {
  for (const ratio of ['', '2', '0:3', '-2:3', '2::3', 'NaN:3', '1e5:3', '1:100', Array(21).fill('1').join(':')]) {
    const h = harness(); h.node('bmRatio').value = ratio;
    h.run(`var a=bmNewBar(1,40,120,300,42,'?');annotations=[a];selectedId=a.id;var before=snapshot();bmSuiteRun('ratio-split');`);
    assert.equal(h.run('snapshot()'), h.c.before, ratio); assert.equal(h.c.undoStack.length, 0, ratio); assert(h.c.notices.length, ratio);
  }
});
test('percent cut validates the entire edit including any whole label before changing the page', () => {
  const h = harness(); h.run(`var a=bmNewBar(1,40,120,300,42,'?');annotations=[a];selectedId=a.id;bmSuiteRun('percent-cut');`);
  assert.deepEqual(h.read('annotations.filter(bmIsBar).map(a=>a.w)'), [75, 225]);
  for (const percent of ['0', '100', '', 'NaN', '1']) {
    const next = harness(); next.node('bmCutPercent').value = percent;
    next.run(`var a=bmNewBar(1,40,120,300,42,'?');annotations=[a];selectedId=a.id;var before=snapshot();bmSuiteRun('percent-cut');`);
    assert.equal(next.run('snapshot()'), next.c.before); assert.equal(next.c.undoStack.length, 0);
  }
});
test('selecting any grouped label includes the full model and never another page sharing its group ID', () => {
  const h = harness();
  h.run(`annotations=[bmNewBar(1,40,120,100,42,'?')].concat(bmBracket(1,40,112,100,'24',false));annotations.forEach(a=>a.grp='whole');
    annotations.push(Object.assign({},annotations[0],{id:'other-page',page:2}));selectedId=annotations[2].id;bmSuiteRun('select-model');`);
  assert.equal(h.read('bmSuiteSelection().length'), 3); assert.equal(h.c.lassoSel.ids.length, 3); assert.equal(h.c.undoStack.length, 0);
  assert(!h.read('lassoSel.ids').includes('other-page'));
});
test('locked labels protect the entire group from movement, split, delete, regroup, ungroup and duplicate', () => {
  for (const action of ['nudge-right', 'ratio-split', 'percent-cut', 'delete', 'group', 'ungroup', 'duplicate-model']) {
    const h = harness();
    h.run(`annotations=[bmNewBar(1,40,120,300,42,'?')].concat(bmBracket(1,40,112,300,'24',false));annotations.forEach(a=>a.grp='whole');
      annotations[2].locked=true;selectedId=annotations[0].id;var before=snapshot();bmSuiteRun('${action}');`);
    assert.equal(h.run('snapshot()'), h.c.before, action); assert.equal(h.c.undoStack.length, 0, action); assert.match(h.c.notices.at(-1), /Unlock/);
  }
});
test('core apply, equal split, join, palette and pointer cuts protect locked group members', () => {
  for (const action of ['apply', 'split', 'join', 'palette', 'pointer-cut']) {
    const h = harness();
    h.run(`var first=bmNewBar(1,40,120,150,42,'?'),second=bmNewBar(1,190,120,150,42,'?');
      annotations=[first,second].concat(bmBracket(1,40,112,300,'24',false));annotations.forEach(a=>a.grp='whole');
      annotations[3].locked=true;selectedId=first.id;var before=snapshot();redoStack=['[]'];`);
    if (action === 'join') h.run('selectIds([first.id,second.id])');
    if (action === 'palette') {
      h.node('barModelPanel').handlers.click({ target: { closest: selector => selector === '[data-bm-fill]' ? { getAttribute: () => '#CBE8D5' } : null } });
    } else if (action === 'pointer-cut') {
      h.c.cutEvent = { preventDefault() {}, target: { closest: () => ({ getAttribute: () => h.c.first.id }) } };
      h.run('bmCutAt(cutEvent,pages[0],{x:115,y:140})');
    } else h.run(`bmRun('${action}')`);
    assert.equal(h.run('snapshot()'), h.c.before, action);
    assert.equal(h.c.undoStack.length, 0, action); assert.deepEqual(h.read('redoStack'), ['[]'], action);
    assert.match(h.c.notices.at(-1), /Unlock/, action);
  }
});
test('cut and join preserve a grouped model and its layer without moving unrelated annotations', () => {
  const h = harness();
  h.run(`var original=bmNewBar(1,40,120,300,42,'?');original.grp='whole';
    var background={id:'background',page:1,type:'rect',x:0,y:0,w:600,h:800};
    var top={id:'top',page:1,type:'text',x:60,y:130,w:40,h:20,text:'over the bars'};
    var label=bmBracket(1,40,112,300,'24',false);label.forEach(a=>a.grp='whole');
    annotations=[background,original,top].concat(label);selectedId=original.id;var before=snapshot();bmRun('split');`);
  const cut = h.read('annotations');
  assert.equal(cut.length, 7); assert.equal(cut[0].id, 'background'); assert.equal(cut[4].id, 'top');
  assert(cut.slice(1, 4).every(a => a.modelBar && a.grp === 'whole'));
  assert.deepEqual(cut.slice(4), h.read('[top].concat(label)'));
  h.run(`selectIds(annotations.filter(bmIsBar).map(a=>a.id));bmRun('join');`);
  assert.deepEqual(h.read('annotations.map(a=>a.id===background.id?"background":a.modelBar?"joined":a.id)'), ['background', 'joined', 'top', ...h.read('label.map(a=>a.id)')]);
  assert.equal(h.read('annotations[1].grp'), 'whole'); assert.equal(h.read('annotations[1].w'), 300);
  assert.deepEqual(h.read('annotations.filter(a=>!bmIsBar(a))'), h.read('[background,top].concat(label)'));
  assert.equal(h.c.undoStack.length, 2); h.run('undo();undo()'); assert.equal(h.run('snapshot()'), h.c.before);
});
test('joining interleaved pieces retains the remaining objects in their original order', () => {
  const h = harness();
  h.run(`var a=bmNewBar(1,40,120,150,42,'3'),b=bmNewBar(1,190,120,150,42,'5');
    var note={id:'between',page:1,type:'text',x:70,y:130,w:80,h:20,text:'between'};
    var tail={id:'tail',page:1,type:'text',x:80,y:130,w:80,h:20,text:'above'};
    annotations=[a,note,b,tail];selectIds([a.id,b.id]);bmRun('join');`);
  assert.deepEqual(h.read('annotations.map(a=>a.modelBar?"joined":a.id)'), ['joined', 'between', 'tail']);
  assert.deepEqual(h.read('annotations.slice(1)'), h.read('[note,tail]'));
  assert.equal(h.read('annotations[0].modelLabel'), '3 + 5');
});
test('cut pieces from an ungrouped bar remain independently movable', () => {
  const h = harness();
  h.run(`annotations=[bmNewBar(1,40,120,300,42,'?')];selectedId=annotations[0].id;bmRun('split');
    var pieces=JSON.parse(snapshot());selectedId=annotations[0].id;bmSuiteRun('nudge-down');`);
  assert(h.read('annotations.every(a=>!a.grp)'));
  assert.equal(h.read('annotations[0].y'), 125);
  assert.deepEqual(h.read('annotations.slice(1)'), h.read('pieces.slice(1)'));
});
test('nudge moves bars, braces and outside labels together and preserves unrelated layer order', () => {
  const h = harness();
  h.run(`var bar=bmNewBar(1,40,120,300,42,'?'),label=bmBracket(1,40,112,300,'24',false);
    var background={id:'background',page:1,type:'rect',x:0,y:0,w:600,h:800};var top={id:'top',page:1,type:'text',x:40,y:120,w:40,h:20,text:'top'};
    annotations=[background,bar,label[0],top,label[1]];[bar,label[0],label[1]].forEach(a=>a.grp='whole');selectedId=label[1].id;
    var before=snapshot(),order=annotations.map(a=>a.id);bmSuiteRun('nudge-right');`);
  assert.deepEqual(h.read('annotations.map(a=>a.id)'), h.read('order'));
  assert.equal(h.read('annotations.find(a=>a.id===bar.id).x'), 45);
  assert.equal(h.read('annotations.find(a=>a.id===label[0].id).x1'), 45);
  assert.equal(h.read('annotations.find(a=>a.id===label[1].id).x'), 45);
  assert.deepEqual(h.read('annotations.filter(a=>a.id==="background"||a.id==="top")'), h.read('[background,top]'));
  assert.equal(h.c.undoStack.length, 1); h.run('undo()'); assert.equal(h.run('snapshot()'), h.c.before);
});
test('out-of-page nudges and non-finite steps fail atomically without consuming undo or redo', () => {
  for (const step of ['500', 'NaN', '', '0', '-5']) {
    const h = harness(); h.node('bmStep').value = step;
    h.run(`annotations=[bmNewBar(1,40,120,300,42,'?')];selectedId=annotations[0].id;redoStack=['[]'];var before=snapshot();bmSuiteRun('nudge-left');`);
    assert.equal(h.run('snapshot()'), h.c.before); assert.equal(h.c.undoStack.length, 0); assert.deepEqual(h.read('redoStack'), ['[]']);
  }
});
test('aligning and laying out independent models moves grouped labels without distorting them', () => {
  const h = harness();
  h.run(`annotations=[bmNewBar(1,40,120,100,42,'?')].concat(bmBracket(1,40,112,100,'24',false));annotations.forEach(a=>a.grp='whole');
    var second=bmNewBar(1,230,220,80,30,'?');annotations.push(second);selectIds([annotations[0].id,second.id]);bmSuiteRun('align-right');`);
  assert.equal(h.read('annotations[0].x'), 210);
  assert.equal(h.read('annotations[1].x1'), 210);
  assert.equal(h.read('annotations[2].x'), 210);
  assert.equal(h.read('annotations[0].w'), 100);
  assert.equal(h.c.undoStack.length, 1);
});
test('row and stack use the requested gap with deterministic spatial order', () => {
  const row = harness(); twoBars(row); row.node('bmGap').value = '17'; row.run(`bmSuiteRun('row')`);
  assert.deepEqual(row.read('annotations.map(a=>[a.x,a.y])'), [[40, 120], [177, 120]]);
  const stack = harness(); twoBars(stack); stack.node('bmGap').value = '17'; stack.run(`bmSuiteRun('stack')`);
  assert.deepEqual(stack.read('annotations.map(a=>[a.x,a.y])'), [[40, 120], [40, 177]]);
  assert.equal(stack.c.undoStack.length, 1);
});
test('equal dimensions use the largest selected size and reject overflow or grouped distortion', () => {
  const h = harness(); twoBars(h); h.run(`bmSuiteRun('equal-width')`); assert.deepEqual(h.read('annotations.map(a=>a.w)'), [180, 180]);
  h.run(`bmSuiteRun('equal-height')`); assert.deepEqual(h.read('annotations.map(a=>a.h)'), [60, 60]);
  for (const change of ["annotations[1].x=450", "annotations[0].grp='one'"]) {
    const no = harness(); twoBars(no); no.run(change + `;var before=snapshot();bmSuiteRun('equal-width');`);
    assert.equal(no.run('snapshot()'), no.c.before); assert.equal(no.c.undoStack.length, 0);
  }
});
test('whole-model duplication remaps groups and duplicates labels in one reversible edit', () => {
  const h = harness();
  h.run(`annotations=[bmNewBar(1,40,120,300,42,'?')].concat(bmBracket(1,40,112,300,'24',false));annotations.forEach(a=>a.grp='whole');
    selectedId=annotations[0].id;var before=snapshot();bmSuiteRun('duplicate-model');`);
  const items = h.read('annotations'); assert.equal(items.length, 6);
  assert.deepEqual(items.slice(0, 3), JSON.parse(h.c.before));
  assert.equal(new Set(items.map(a => a.id)).size, 6); assert.equal(new Set(items.slice(3).map(a => a.grp)).size, 1);
  assert.notEqual(items[3].grp, 'whole'); assert.equal(items[5].text, '24'); assert(items[3].y > items[0].y);
  assert.equal(h.c.undoStack.length, 1); h.run('undo()'); assert.equal(h.run('snapshot()'), h.c.before);
});
test('duplicate and row overflow never leave partial models', () => {
  for (const action of ['duplicate-model', 'row']) {
    const h = harness(); h.run(`annotations=[bmNewBar(1,40,710,300,42,'?'),bmNewBar(1,40,760,300,40,'?')];selectIds(annotations.map(a=>a.id));var before=snapshot();bmSuiteRun('${action}');`);
    assert.equal(h.run('snapshot()'), h.c.before); assert.equal(h.c.undoStack.length, 0);
  }
});
test('group, ungroup and delete affect expanded selection while undo and redo recover it', () => {
  const h = harness(); twoBars(h); h.run(`var original=snapshot();bmSuiteRun('group');var group=annotations[0].grp;`);
  assert.equal(h.c.annotations[1].grp, h.c.group); assert(h.c.group);
  h.run(`selectedId=annotations[0].id;lassoSel=null;bmSuiteRun('ungroup');`); assert(h.c.annotations.every(a => !a.grp));
  h.run(`bmSuiteRun('delete')`); assert.equal(h.c.annotations.length, 0); assert.equal(h.c.undoStack.length, 3);
  h.run(`undo();bmSuiteRun('redo')`); assert.equal(h.c.annotations.length, 0);
  h.run('undo();undo();undo()'); assert.equal(h.run('snapshot()'), h.c.original);
});
test('select all models is page-specific and includes model labels but not unrelated notes', () => {
  const h = harness();
  h.run(`annotations=[bmNewBar(1,40,120,300,42,'?')].concat(bmBracket(1,40,112,300,'24',false));annotations.forEach(a=>a.grp='whole');
    annotations.push({id:'note',page:1,type:'text',x:20,y:400,w:200,h:20,text:'Unrelated'},bmNewBar(2,40,120,300,42,'?'));bmSuiteRun('select-page-models');`);
  assert.equal(h.read('bmSuiteSelection().length'), 3); assert.equal(h.c.undoStack.length, 0); assert.equal(h.c.dirtyCount, 0);
});
test('select all models retains ungrouped braces and labels from older models', () => {
  const h = harness();
  h.run(`annotations=[bmNewBar(1,40,120,300,42,'?')].concat(bmBracket(1,40,112,300,'24',false));
    annotations.forEach(a=>{a.grp='legacy-whole';delete a.modelObject;});selectedId=annotations[0].id;bmSuiteRun('ungroup');
    selectIds([annotations[0].id]);bmSuiteRun('select-page-models');`);
  assert.equal(h.read('bmSuiteSelection().length'), 3);
  assert(h.read('annotations.filter(a=>a.type!=="rect").every(a=>a.modelObject===true&&!a.grp)'));
  h.run(`bmSuiteRun('delete')`); assert.equal(h.c.annotations.length, 0);
});
test('manual tools refuse read-only states, active gestures and mixed-page edits', () => {
  for (const state of ['student=true', 'reviseMode=true', 'lessonPlayback={}', 'lessonOpening={}', 'drawing={}', 'lassoMoving={}']) {
    const h = harness(); twoBars(h); h.run(state + `;var before=snapshot();bmSuiteRun('delete');`);
    assert.equal(h.run('snapshot()'), h.c.before); assert.equal(h.c.undoStack.length, 0);
  }
  const mixed = harness(); twoBars(mixed); mixed.run(`annotations[1].page=2;var before=snapshot();bmSuiteRun('delete');`);
  assert.equal(mixed.run('snapshot()'), mixed.c.before); assert.equal(mixed.c.undoStack.length, 0);
});
test('unknown commands are delegated to the core and unchanged operations create no history', () => {
  const h = harness(); assert.equal(h.run(`bmSuiteRun('add')`), false);
  twoBars(h); h.run(`annotations[1].w=annotations[0].w;bmSuiteRun('equal-width');bmSuiteRun('ungroup');`);
  assert.equal(h.c.undoStack.length, 0);
  assert.doesNotMatch(suite, /\b(?:fetch|askGemini|XMLHttpRequest|voiceJevDelegate)\s*\(/);
});
