// The manual model suite was replaced by the model studio (v1.141.0); its
// bars live on in saved worksheets. These pin the renderers that still draw,
// print and replay them — bar-models.js is nothing else now.
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
    'var BRACE_DEPTH_MIN=9,BRACE_DEPTH_MAX=34,BRACE_DEPTH_FRAC=.1;',
    // A saved manual-suite bar, exactly as the old suite wrote it.
    'function bmNewBar(page,x,y,w,h,label,fill){return {id:newAnnId(),page:page,type:"rect",modelBar:true,x:x,y:y,w:w,h:h,color:"#526B84",width:1.4,fill:fill||"#C8DDF2",modelLabel:String(label||"").slice(0,80),ts:Date.now()};}'
  ].join('\n');
  vm.runInContext(setup + '\n' + ['annFrame','annFrameCorners','rotPt','annBounds','braceDepth','_qSample','bracePoints','translateAnn','scaleAnnFrom','snapshot','pushUndo','undo','redo','afterHistoryChange','hexToRgb01','drawAnnsOnCtx'].map(fn).join('\n') + '\n' + model, c);
  return {c,node,run:s=>vm.runInContext(s,c),read:s=>clone(vm.runInContext(s,c))};
}
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

test('the manual suite is gone: no panel, no draw or cut tool, no operations left behind',()=>{
  for(const gone of ['barModelPanel','bmCommit','bmSplit','bmTemplate','bmSync','bmRun','modelcut',"'modelbar'",'model-suite.js','model-templates.js','bar-models.css'])
    assert.ok(!html.includes(gone),gone+' should be gone from index.html');
  for(const gone of ['bmCommit','bmSplit','bmTemplate','addEventListener','getElementById'])assert.ok(!model.includes(gone),gone+' should be gone from bar-models.js');
  assert.ok(html.includes('<script src="bar-models.js"></script>'),'the renderer still loads');
});
