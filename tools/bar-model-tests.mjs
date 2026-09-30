// Exercise the shipped model operations, geometry, history and renderers.
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const model = fs.readFileSync(new URL('../bar-models.js', import.meta.url), 'utf8');
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
      setAttribute(k,v) { this.attrs[k]=v; }, appendChild(child) { this.children.push(child); },
      addEventListener() {}, querySelectorAll() { return []; },
      getBoundingClientRect() { return { top:0, bottom:800, height:800, left:0, width:600 }; } });
    return nodes.get(id);
  }
  ['bmLabel','bmWidth','bmHeight','bmParts','bmCompareUnits'].forEach((id,i)=>{node(id).value=['?','300','42','3','2'][i];});
  const c = vm.createContext({ console, TextEncoder, Date,
    document: {activeElement:null, getElementById:node, createElement:()=>({getContext:()=>({measureText:t=>({width:t.length*8})})})} });
  const setup = [
    'var nextId=0,annotations=[],undoStack=[],redoStack=[],selectedId=null,editingId=null,editModeId=null,lassoSel=null;',
    'var drawing=null,draggingSel=null,resizingSel=null,erasing=null,lassoing=null,lassoMoving=null,lassoResizing=null,lassoRotating=null;',
    'var lessonPlayback=null,lessonOpening=null,reviseMode=false,practiceMode=false,student=false,tool="select",dirtyCount=0,notices=[];',
    'var pages=[{num:1,baseW:600,baseH:800,svg:document.getElementById("page1")}],visiblePage=1;',
    'function currentPageNum(){return visiblePage;}function newAnnId(){return "bar"+(++nextId);}',
    'function isStudent(){return student;}function annLocked(a){return !!a.locked;}function annNoteMin(){return false;}',
    'function round2(n){return Math.round(n*100)/100;}function setDirty(){dirtyCount++;}',
    'function clearLassoSel(){lassoSel=null;}function showLassoBar(){}function commitActiveTextEdit(){}',
    'function renderAllOverlays(){}function toast(m){notices.push(m);}function setTool(t){tool=t;clearLassoSel();if(t!=="select")selectedId=null;}',
    'function el(tag,attrs){return {tag,attrs:attrs||{},children:[],appendChild(c){this.children.push(c);},setAttribute(k,v){this.attrs[k]=v;}};}',
    'function annDashPattern(){return null;}function winAnsiSafe(s){return s;}var PDFLib={degrees:n=>n};',
    'var BRACE_DEPTH_MIN=9,BRACE_DEPTH_MAX=34,BRACE_DEPTH_FRAC=.1;'
  ].join('\n');
  vm.runInContext(setup + '\n' + ['annFrame','annFrameCorners','rotPt','annBounds','braceDepth','_qSample','bracePoints','translateAnn','scaleAnnFrom','snapshot','pushUndo','undo','redo','afterHistoryChange','hexToRgb01','drawAnnsOnCtx'].map(fn).join('\n') + '\n' + model, c);
  return {c,node,run:s=>vm.runInContext(s,c),read:s=>clone(vm.runInContext(s,c))};
}
test('cuts preserve exact width and reject zero, tiny, reversed or rotated pieces',()=>{
  const {run,read}=harness();
  run('var a=bmNewBar(1,30,100,317,42,"24","#C8DDF2");');
  const parts=read('bmSplitGeometry(a,[.2,.6])');
  assert(Math.abs(parts.reduce((n,p)=>n+p.w,0)-317)<1e-8);
  assert.equal(parts[1].x,parts[0].x+parts[0].w);assert.equal(parts[2].x+parts[2].w,347);
  for(const stops of ['[0]','[1]','[.5,.4]','[NaN]','[.01]'])assert.throws(()=>run('bmSplitGeometry(a,'+stops+')'));
  assert.throws(()=>run('bmSplitGeometry(Object.assign({},a,{rot:20}),[.5])'));
});
test('labelled cut is one undo operation and retains whole quantity separately from unknown parts',()=>{
  const {c,run,read}=harness();
  run('var original=bmNewBar(1,30,100,300,42,"24","#C8DDF2");annotations=[original];selectedId=original.id;bmSplit(original,[1/3,2/3]);');
  const current=read('annotations');
  assert.equal(current.filter(a=>a.modelBar).length,3);assert(current.filter(a=>a.modelBar).every(a=>a.modelLabel==='?'));
  assert.equal(current.find(a=>a.type==='text').text,'24');assert.equal(c.undoStack.length,1);
  run('undo()');assert.deepEqual(read('annotations'),read('[original]'));
  run('redo()');assert.deepEqual(read('annotations'),current);
});
test('top-edge cuts place the whole below, and unknown cuts create no redundant brace',()=>{
  const {run,read}=harness();
  run('var a=bmNewBar(1,30,8,300,42,"24");annotations=[a];bmSplit(a,[.5]);');
  assert(read('annotations.find(a=>a.type==="text").y')>50);
  run('annotations=[bmNewBar(1,30,8,300,42,"?")];bmSplit(annotations[0],[.5]);');
  assert.equal(read('annotations.length'),2);
});
test('joining retains span and labels; incompatible rows are rejected without history changes',()=>{
  const {c,run}=harness();
  run('annotations=[bmNewBar(1,30,100,100,42,"8"),bmNewBar(1,130,100,200,42,"16")];lassoSel={page:pages[0],ids:annotations.map(a=>a.id)};bmRun("join");');
  assert.equal(c.annotations.length,1);assert.equal(c.annotations[0].w,300);assert.equal(c.annotations[0].modelLabel,'8 + 16');
  run('undo();annotations[1].y+=2;lassoSel={page:pages[0],ids:annotations.map(a=>a.id)};var before=snapshot();bmRun("join");');
  assert.equal(run('snapshot()'),c.before);assert.equal(c.undoStack.length,0);assert.match(c.notices.at(-1),/same row/);
});
test('ordinary move/resize and saved JSON keep model metadata; replay preserves quantity edits',()=>{
  const {c,run,read}=harness();
  run('var a=bmNewBar(1,30,100,300,42,"24","#DDD2F0");translateAnn(a,20,40);var copy=JSON.parse(JSON.stringify(a));scaleAnnFrom(copy,a,2,{x:0,y:0});');
  assert.deepEqual(read('[a.x,a.y,a.w,a.h,a.fill,a.modelLabel,a.modelBar]'),[100,280,600,84,'#DDD2F0','24',true]);
  const src=html.slice(html.indexOf('/* ================= Lesson replay core'),html.indexOf('/* ================= End lesson replay core'));
  const core=new Function(src+';return LessonReplayCore;')(),a=clone(c.a),view={page:1,x:0,y:0,zoom:1};
  const recorder=core.createRecorder([a],view);a.modelLabel='48';a.fill='#CBE8D5';recorder.capture(100,[a],view);
  const timeline=recorder.finish(200),player=core.createPlayer(JSON.stringify(timeline));
  assert.equal(player.stateAt(0).annotations[0].modelLabel,'24');assert.equal(player.stateAt(100).annotations[0].modelLabel,'48');
  assert.equal(player.stateAt(100).annotations[0].fill,'#CBE8D5');
  const bad=clone(timeline);bad.initial.annotations[0].fill='url(javascript:bad)';assert.throws(()=>core.createPlayer(bad),/invalid model fill/);
});
test('comparison creates equal units on the visible page and rejects fractional unit counts',()=>{
  const {c,node,run,read}=harness();
  run('pages.push({num:2,baseW:600,baseH:800,svg:document.getElementById("page2")});visiblePage=2;bmTemplate("comparison");');
  const bars=read('annotations.filter(bmIsBar)');assert.equal(bars.length,5);assert(bars.every(a=>a.page===2&&a.w===100));assert.equal(c.undoStack.length,1);
  run('undo()');node('bmCompareUnits').value='2.5';run('bmRun("comparison")');
  assert.equal(c.annotations.length,0);assert.equal(c.undoStack.length,0);assert.match(c.notices.at(-1),/whole number/);
});
test('fraction template has equal pieces labelled as fractions of one whole',()=>{
  const {node,run,read}=harness();node('bmParts').value='5';run('bmTemplate("fraction")');
  const bars=read('annotations.filter(bmIsBar)');assert.equal(bars.length,5);assert(bars.every(a=>a.w===60&&a.modelLabel==='1/5'));
  assert.equal(read('annotations.find(a=>a.type==="text").text'),'1 whole');
});
test('read-only, playback and active gestures block mutations; student practice permits drawing',()=>{
  for(const state of ['student=true','reviseMode=true','lessonPlayback={}','lessonOpening={}','drawing={}','erasing={}','lassoing={}']){
    const {c,run}=harness();run(state+';bmRun("add")');assert.equal(c.annotations.length,0,state);assert.equal(c.undoStack.length,0,state);
  }
  const {c,run}=harness();run('student=true;practiceMode=true;bmRun("add")');assert.equal(c.annotations.length,1);
});
test('invalid placement and locked cuts do not change annotations or history',()=>{
  const {c,node,run}=harness();run('var a=bmNewBar(1,420,100,150,42,"24");annotations=[a];selectedId=a.id;');
  node('bmWidth').value='300';run('bmRun("apply")');assert.equal(c.annotations[0].w,150);assert.equal(c.undoStack.length,0);
  run('a.locked=true;bmRun("split")');assert.equal(c.annotations.length,1);assert.equal(c.undoStack.length,0);
});
test('small pieces produced by a 20-way cut remain editable',()=>{
  const {c,node,run}=harness();
  run('annotations=[bmNewBar(1,30,100,300,42,"?")];var stops=[];for(var i=1;i<20;i++)stops.push(i/20);bmSplit(annotations[0],stops);');
  node('bmWidth').value='15';node('bmHeight').value='42';node('bmLabel').value='3';
  run('bmRun("apply")');assert.equal(c.annotations.find(a=>a.id===c.selectedId).modelLabel,'3');assert.equal(c.undoStack.length,2);
});
test('bracket labels clear the full curve above and below for different widths',()=>{
  const {read}=harness();
  for(const width of [30,300,500]){
    const upper=read('bmBracket(1,20,100,'+width+',"24",false)'),lower=read('bmBracket(1,20,100,'+width+',"24",true)');
    const depth=Math.max(9,Math.min(34,width*.1));assert(upper[1].y+upper[1].h<=100-depth-5);assert(lower[1].y>=100+depth+5);
  }
});
test('SVG, AI canvas and PDF render rounded pastel blocks with the saved quantity',()=>{
  const {c,run}=harness();run('var a=bmNewBar(1,30,100,200,42,"24","#DDD2F0");var g=el("g");bmSvgContents(g,a);');
  assert.equal(c.g.children[0].attrs.fill,'#DDD2F0');assert(c.g.children[0].attrs.rx>0);assert.equal(c.g.children[1].textContent,'24');
  const calls=[],ctx={measureText:t=>({width:t.length*8})};
  for(const method of ['save','restore','beginPath','moveTo','lineTo','quadraticCurveTo','closePath','fill','stroke','fillText','setLineDash'])ctx[method]=(...args)=>calls.push([method,...args]);
  c.ctx=ctx;run('drawAnnsOnCtx(ctx,2,2,[a],1)');
  assert.equal(calls.filter(x=>x[0]==='quadraticCurveTo').length,4);assert(calls.some(x=>x[0]==='fillText'&&x[1]==='24'));
  const pdf=[];c.pdf={drawSvgPath:(...args)=>pdf.push(['path',...args]),drawText:(...args)=>pdf.push(['text',...args])};c.font={widthOfTextAtSize:(t,s)=>t.length*s*.5};
  run('bmDrawOnPdf(a,pdf,(x,y)=>({x,y:800-y}),(r,g,b)=>({r,g,b}),font,800)');
  assert.equal(pdf[0][0],'path');assert(pdf[0][1].endsWith(' Z'));assert(pdf[0][1].split('L ').length>=32);
  assert.deepEqual(clone(pdf[0][2].color),{r:221/255,g:210/255,b:240/255});assert.equal(pdf[1][1],'24');assert(pdf[1][2].size>0);
});
test('long quantity labels fit inside a narrow bar',()=>{
  const {read}=harness();
  const lab=read('bmLabelLayout(bmNewBar(1,20,30,40,24,"1234567890 marbles"),(text,size)=>text.length*size*.6)');
  assert(lab.text.length*lab.size*.6<=28.000001);assert(lab.size>0);
});
