// Real Chromium pointer/layout and image-pixel verification. No cloud account is used.
// PW=/path/to/playwright/index.mjs BROWSER_EXECUTABLE=/path/to/chrome node tools/worksheet-view-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const modulePath = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(path.isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const models = fs.readFileSync(new URL('../bar-models.js', import.meta.url), 'utf8');
function cut(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start); return html.slice(a, b);
}
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
  await page.setContent(`<style>
    body { margin:0; font:16px Arial; } button { height:36px; }
    #viewerArea { position:fixed;left:80px;top:70px;width:860px;height:650px;overflow:auto;background:#eef2f5; }
    #page {position:relative;margin:30px;width:900px;height:1200px;background:white;}
    #page svg,#page canvas {position:absolute;inset:0;width:100%;height:100%;}
  </style><button id="aiQuestionFocusBtn">AI focus</button><button id="aiQuestionFocusClear" hidden>Clear focus</button>
    <div id="viewerArea"><div id="page"><canvas></canvas><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800"></svg></div></div>`);
  await page.addScriptTag({ content: `
    var $ = id => document.getElementById(id), round2 = n => Math.round(n*100)/100;
    var annotations = [{id:'preserved',page:1,type:'text',text:'Original work'}], undoStack=['before'],redoStack=['after'];
    var currentUser={uid:'teacher'},currentDocId='worksheet',wsEpoch=3,lessonPlayback=null,lessonOpening=null;
    var lessonCapture=null,dirtyWrites=0, undoWrites=0;
    function toast() {} function voiceActionBusy() { return false; }
    function setDirty() { dirtyWrites++; } function pushUndo() { undoWrites++; }
    var svg=document.querySelector('svg'), canvas=document.querySelector('canvas');
    canvas.width=1200;canvas.height=1600;
    var pages=[{num:1,baseW:600,baseH:800,svg,canvas,wrap:$('page')}];
  ` + cut('var aiQuestionFocus =', '/* ================= End shared question focus') +
    cut('function eventPoint(e, p, rect)', '/* Read layout once') });
  await page.evaluate(() => { $('viewerArea').scrollTop = 210; $('viewerArea').scrollLeft = 35; });
  await page.click('#aiQuestionFocusBtn');
  let bounds = await page.locator('svg').boundingBox();
  const screen = (x, y) => ({ x: bounds.x + x * bounds.width / 600, y: bounds.y + y * bounds.height / 800 });
  let start = screen(80, 180), end = screen(350, 320);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 }); await page.mouse.up();
  let state = await page.evaluate(() => ({ focus: aiQuestionFocusCurrent(), dirtyWrites, undoWrites,
    annotations,undoStack,redoStack,frame:$('aiQuestionFocusFrame').getBoundingClientRect().toJSON() }));
  assert.deepEqual(state.focus, { docId:'worksheet',epoch:3,uid:'teacher',page:1,x:80,y:180,w:270,h:140 });
  assert.equal(state.dirtyWrites,0); assert.equal(state.undoWrites,0);
  assert.deepEqual(state.undoStack,['before']); assert.deepEqual(state.redoStack,['after']);
  assert.deepEqual(state.annotations,[{id:'preserved',page:1,type:'text',text:'Original work'}]);
  assert.equal(state.frame.x,start.x); assert.equal(state.frame.y,start.y);
  await page.mouse.move(880,650);
  assert.deepEqual(await page.evaluate(() => aiQuestionFocusCurrent()),state.focus);

  await page.evaluate(() => { $('page').style.width='600px';$('page').style.height='800px';$('viewerArea').scrollTop=70; aiQuestionFocusSync(); });
  bounds = await page.locator('svg').boundingBox();
  state = await page.evaluate(() => ({ focus: aiQuestionFocusCurrent(),frame:$('aiQuestionFocusFrame').getBoundingClientRect().toJSON() }));
  assert.equal(state.frame.x,bounds.x+80); assert.equal(state.frame.y,bounds.y+180);
  assert.equal(state.frame.width,270); assert.equal(state.frame.height,140);
  await page.click('#aiQuestionFocusBtn');
  start = screen(110,210); await page.mouse.move(start.x,start.y); await page.mouse.down();
  await page.keyboard.press('Escape'); await page.mouse.up();
  assert.equal(await page.evaluate(() => aiQuestionFocusArmed),false);
  assert.deepEqual(await page.evaluate(() => aiQuestionFocusCurrent()),state.focus);
  await page.evaluate(() => { currentDocId='another';aiQuestionFocusSync(); });
  assert.equal(await page.evaluate(() => aiQuestionFocusCurrent()),null);
  assert.equal(await page.locator('#aiQuestionFocusFrame').isVisible(),false);
  console.log('Question focus: real zoomed/scrolled pointer drag, persistent question, frame layout, Escape and document invalidation passed.');

  await page.addScriptTag({ content: `
    var practiceMode=false, selectedId=null,editingId='draft', drawing=null;
    var LESSON_TYPES=['text','pen','rect','ellipse','line','arrow','highlight','brace'];
    var AI_NOTE_MIN_W=90,AI_NOTE_MIN_H=60,PASTE_MIN_PX=24,AI_NOTE_PILL_W=110,AI_NOTE_PILL_H=20,AI_NOTE_ALPHA=.15;
    var draft=document.createElement('div');draft.innerText='DRAFT: Mei has 3 more than Ali.';document.body.appendChild(draft);
    function annTextNode() { return draft; }
    function isStudent() {return false;} function isSharedVisitor() {return false;}
    function aiThrowIfAborted(signal) {if(signal && signal.aborted) throw new DOMException('Aborted','AbortError');}
    function currentPageNum() {return 1;}
    function voiceCursorPoint() {return {page:1,x:400,y:600};}
    function aiNoteShortName(a) {return a.title || 'Card';}
    var button=document.createElement('button');button.id='aiShareViewBtn';document.body.appendChild(button);
  ` + models.slice(0,models.indexOf('/* UI and worksheet operations.')) +
    cut('var aiScreenShare =', '/* ================= End live shared view for AI') +
    cut('function lessonSnapshot()', 'function lessonCaptureTick()') +
    cut('function annNoteMin(a)', '/* Corners of a possibly-rotated frame') +
    cut('function annBounds(a)', '/* Draw annotations straight') +
    cut('var ANN_DASH_STYLES =', 'function annNode(') +
    cut('function drawAnnsOnCtx(', '/* Full page (downscaled)') +
    cut('function lessonBackgroundAbort(', 'async function lessonCaptureBackgrounds(') +
    cut('function drawAiNotePillOnPdf(', 'async function buildAnnotatedPdf(') +
    cut('function winAnsiSafe(', '/* ================= Flattened PDF download ================= */') +
    cut('function aiViewRect(', '/* ---- Worksheet snapshots for Gemini ----') });
  const visual = await page.evaluate(async () => {
    currentDocId='worksheet';
    const base=canvas.getContext('2d');base.fillStyle='#fff';base.fillRect(0,0,canvas.width,canvas.height);
    base.fillStyle='#102030';base.fillRect(20,20,80,80);
    const picture=document.createElement('canvas');picture.width=100;picture.height=100;
    const pc=picture.getContext('2d');pc.fillStyle='#00aa66';pc.fillRect(0,0,100,100);
    annotations=[
      {id:'draft',page:1,type:'text',x:30,y:90,w:500,h:30,fontSize:20,text:'OLD WORDS',color:'#000000'},
      {id:'picture',page:1,type:'ainote',kind:'paste',x:100,y:180,w:150,h:150,src:picture.toDataURL()},
      {id:'cover',page:1,type:'pen',color:'#dd2222',width:20,points:[{x:125,y:205},{x:225,y:205}]},
      {id:'notes',page:1,type:'ainote',kind:'notes',x:310,y:180,w:230,h:150,title:'Units',text:'3 equal units make 18.'},
      {id:'model',page:1,type:'rect',modelBar:true,fill:'#C8DDF2',color:'#526B84',width:1.4,modelLabel:'12 marbles',x:100,y:400,w:300,h:50}
    ];
    aiQuestionFocus={docId:currentDocId,epoch:wsEpoch,uid:currentUser.uid,page:1,x:80,y:170,w:480,h:190};
    const view=aiViewSnapshot();
    // Request capture must be immutable across changes to content and viewport.
    annotations[1].src='data:image/png;base64,broken';draft.innerText='LATER WORDS';
    base.fillStyle='#ee00ee';base.fillRect(20,20,80,80);$('viewerArea').scrollTop=0;
    const out=await aiViewImages(view);
    async function decode(item) {
      const img=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src='data:'+item.mimeType+';base64,'+item.data;});
      const c=document.createElement('canvas');c.width=img.width;c.height=img.height;c.getContext('2d').drawImage(img,0,0);return c;
    }
    const full=await decode(out.images.find(x=>x.label.startsWith('full page'))),ctx=full.getContext('2d');
    const pixel=(x,y)=>Array.from(ctx.getImageData(Math.round(x*full.width/600),Math.round(y*full.height/800),1,1).data).slice(0,3);
    const focus=await decode(out.images[0]);
    window.__decode=decode;window.__visualBundle=out;
    return {prompt:out.prompt,labels:out.images.map(x=>x.label),focusRatio:focus.width/focus.height,
      pdf:pixel(25,25),picture:pixel(160,260),over:pixel(160,205),note:pixel(311,280),model:pixel(150,425),corner:pixel(101,401),
      typed:view.annotations.find(x=>x.id==='draft').text,
      viewport:view.crops.find(x=>x.kind==='visible').rect};
  });
  function near(actual, expected, tolerance=12) { assert.ok(actual.every((v,i)=>Math.abs(v-expected[i])<=tolerance),`${actual} != ${expected}`); }
  near(visual.pdf,[16,32,48]); near(visual.picture,[0,170,102]); near(visual.over,[221,34,34]);
  near(visual.model,[200,221,242]);assert.ok(visual.corner[0]>225 && visual.corner[1]>235,'rounded corner leaves the page visible');
  assert.equal(visual.typed,'DRAFT: Mei has 3 more than Ali.');
  assert.match(visual.prompt,/DRAFT: Mei has 3 more than Ali/);assert.doesNotMatch(visual.prompt,/LATER WORDS|OLD WORDS/);
  assert.match(visual.labels[0],/explicitly selected/); assert.ok(Math.abs(visual.focusRatio-496/206)<.01);
  assert.ok(visual.viewport.y>0);assert.ok(visual.labels.some(x=>/visible worksheet area/.test(x)));
  assert.ok(visual.note.some(x=>x<245),'notes card contributes visible pixels');
  console.log('Worksheet vision: frozen PDF pixels, pasted picture, ink stacking, notes, exact draft text, viewport and selected-question crop passed.');

  const screenResult = await page.evaluate(async () => {
    const source=document.createElement('canvas');source.width=640;source.height=360;
    const ctx=source.getContext('2d');ctx.fillStyle='#1a75cc';ctx.fillRect(0,0,640,360);
    ctx.fillStyle='#ffdd88';ctx.fillRect(200,100,100,100);
    const stream=source.captureStream(30),video=document.createElement('video');video.muted=true;video.srcObject=stream;
    const paintTimer=setInterval(()=>{ctx.fillRect(639,359,1,1);},25);
    const nextFrame=()=>Promise.race([new Promise(resolve=>video.requestVideoFrameCallback(resolve)),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('Video frame timed out.')),3000))]);
    await video.play();await nextFrame();
    aiScreenShare={uid:currentUser.uid,docId:currentDocId,epoch:wsEpoch,practice:false,student:false,shared:false,stream,video};
    const first=aiScreenFrame();
    ctx.fillStyle='#00bb22';ctx.fillRect(0,0,640,360);
    await nextFrame();
    const old=await __decode(first),fresh=await __decode(aiScreenFrame());
    const pixel=c=>Array.from(c.getContext('2d').getImageData(40,40,1,1).data).slice(0,3);
    const result={old:pixel(old),fresh:pixel(fresh),width:old.width,height:old.height};
    clearInterval(paintTimer);aiScreenStop();result.stopped=stream.getTracks().every(t=>t.readyState==='ended');return result;
  });
  near(screenResult.old,[26,117,204]);near(screenResult.fresh,[0,187,34]);
  assert.equal(screenResult.width,640);assert.equal(screenResult.height,360);assert.equal(screenResult.stopped,true);
  console.log('Shared view: real canvas video stream captured as independent immutable JPEG frames; stop releases every track.');
} finally { await browser.close(); }
