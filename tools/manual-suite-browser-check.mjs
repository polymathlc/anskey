// Real offline UI acceptance check for the manual model suite.
// Required: PW, BROWSER_EXECUTABLE, PDF_LIB, PDFJS_LIB, PDFJS_WORKER. Optional: SHOTS.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
for(const key of ['PW','PDF_LIB','PDFJS_LIB','PDFJS_WORKER']) assert.ok(process.env[key],key+' must name a local runtime file');
const pw=process.env.PW;
const {chromium}=await import(path.isAbsolute(pw)?pathToFileURL(pw).href:pw);
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE || undefined,args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1080}}), errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^https?:/,route=>{requests.push(route.request().url());return route.abort();});
  await page.addInitScript(()=>{
    const chain=()=>new Proxy(function(){return chain();},{get:(t,k)=>k==='then'?undefined:chain(),apply:()=>chain(),construct:()=>chain(),set:()=>true});
    window.pdfjsLib=chain();window.firebase=chain();window.grecaptcha=chain();
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href);
  await page.addScriptTag({path:process.env.PDF_LIB});
  await page.addScriptTag({type:'module',content:fs.readFileSync(process.env.PDFJS_WORKER,'utf8')+'\nwindow.pdfjsWorker={WorkerMessageHandler};'});
  await page.addScriptTag({type:'module',content:fs.readFileSync(process.env.PDFJS_LIB,'utf8')+'\nwindow.pdfjsLib={getDocument,GlobalWorkerOptions};'});
  await page.evaluate(()=>{
    currentUser={uid:'offline-model-tester',email:ADMIN_EMAIL};currentDocId=null;annotations=[];undoStack=[];redoStack=[];
    scheduleAutoSave=()=>{};saveCrashDraft=()=>{};styleHarvestLive=()=>{};autoLearnSchedule=()=>{};
    window.__aiCalls=0;
    for(const name of ['askGemini','askOpenAi','askKimi','askGeminiImage','askOpenAiImage'])window[name]=()=>{window.__aiCalls++;throw new Error('Manual modelling must not call AI: '+name);};
    window.aiReady=()=>false;applyRoleUI();
  });
  requests.length=0;
  const action=async name=>{await page.locator('[data-bm-action="'+name+'"]').click();};
  const widths=items=>items.map(a=>Math.round(a.w*1000)/1000);
  const field=async(id,value)=>page.locator('#'+id).fill(String(value));
  const state=()=>page.evaluate(()=>({annotations:JSON.parse(JSON.stringify(annotations)),bars:annotations.filter(bmIsBar),
    selected:bmSuiteSelection().map(a=>a.id),undo:undoStack.length,redo:redoStack.length,toast:$('toast').textContent}));
  const clear=async()=>{await action('select-page-models');await action('delete');assert.equal((await state()).annotations.length,0,'Delete page models removes their bars, quantities and braces');};
  await page.click('#barModelBtn');
  assert.equal(await page.locator('#barModelPanel').isVisible(),true,'the suite opens without a PDF');
  await action('blank');await page.waitForFunction(()=>pages.length===1 && !blankPageBusy && !document.body.inert);
  assert.equal(await page.evaluate(()=>pdfDoc.numPages),1,'Start blank creates a real PDF');
  assert.equal(await page.evaluate(()=>annotations.length),0);
  while(await page.evaluate(()=>scale>1.2)) await page.click('#zoomOutBtn');
  await field('bmLabel','24 marbles');await field('bmWidth',300);await field('bmHeight',42);await action('add');
  let s=await state();assert.equal(s.bars.length,1);assert.equal(s.bars[0].modelLabel,'24 marbles');
  await field('bmLabel','30 marbles');await action('apply');
  assert.equal((await state()).bars[0].modelLabel,'30 marbles');
  await field('bmRatio','2:3:1');await action('ratio-split');
  s=await state();assert.deepEqual(widths(s.bars),[100,150,50]);assert.ok(s.annotations.some(a=>a.type==='text'&&a.text==='30 marbles'));
  const ratioHistory=s.undo;
  await action('undo');assert.equal((await state()).bars.length,1);
  await action('redo');assert.deepEqual(widths((await state()).bars),[100,150,50]);
  await field('bmRatio','0:2');await action('ratio-split');assert.equal((await state()).undo,ratioHistory,'invalid ratio leaves history intact');
  await clear();
  await field('bmWidth',400);await field('bmHeight',40);await field('bmLabel','40');await action('add');
  await field('bmCutPercent',25);await action('percent-cut');s=await state();assert.deepEqual(s.bars.map(a=>a.w),[100,300]);
  await action('select-page-models');await action('group');s=await state();assert.equal(new Set(s.annotations.map(a=>a.grp)).size,1);
  const firstIds=s.annotations.map(a=>a.id),firstGroup=s.annotations[0].grp;
  await field('bmGap',12);await action('duplicate-model');s=await state();assert.equal(s.bars.length,4);
  const copies=s.annotations.filter(a=>!firstIds.includes(a.id));assert.equal(copies.length,firstIds.length);
  assert.ok(copies.every(a=>a.grp&&a.grp!==firstGroup));assert.equal(new Set(s.annotations.map(a=>a.id)).size,s.annotations.length);
  const previousX=copies[0].x;await field('bmStep',5);await action('nudge-right');
  s=await state();assert.equal(s.annotations.find(a=>a.id===copies[0].id).x,previousX+5);
  await action('select-page-models');await action('align-left');await action('stack');
  s=await state();const rows=s.bars.slice().sort((a,b)=>a.y-b.y);assert.equal(Math.min(...rows.slice(0,2).map(a=>a.x)),Math.min(...rows.slice(2).map(a=>a.x)));
  await action('ungroup');s=await state();assert.ok(s.annotations.every(a=>!a.grp));
  await action('select-page-models');assert.equal((await state()).selected.length,s.annotations.length,'ungrouped model labels remain selectable as page models');
  await clear();

  for(const [label,w,h] of [['A',80,30],['B',100,50]]){await field('bmLabel',label);await field('bmWidth',w);await field('bmHeight',h);await action('add');}
  await action('select-page-models');await field('bmGap',16);await action('row');
  s=await state();let bars=s.bars.slice().sort((a,b)=>a.x-b.x);assert.equal(bars[1].x-bars[0].x,bars[0].w+16);assert.equal(bars[0].y,bars[1].y);
  await action('equal-height');assert.ok((await state()).bars.every(a=>a.h===50));
  await action('equal-width');assert.ok((await state()).bars.every(a=>a.w===100));
  await action('stack');s=await state();bars=s.bars.slice().sort((a,b)=>a.y-b.y);assert.equal(bars[1].y-bars[0].y,66);
  await action('align-right');assert.equal((await state()).bars[0].x,(await state()).bars[1].x);
  await clear();
  await field('bmWidth',240);await field('bmHeight',40);await field('bmLabel','18');await action('add');await action('above');
  s=await state();assert.equal(s.annotations.length,3);assert.equal(new Set(s.annotations.map(a=>a.grp)).size,1,'Brace above groups the quantity with its bar');
  await action('duplicate-model');s=await state();assert.equal(s.annotations.length,6);assert.equal(new Set(s.annotations.map(a=>a.grp)).size,2,'Duplicate model keeps both labelled bar groups independent');
  assert.equal(s.annotations.filter(a=>a.type==='text'&&a.text==='18').length,2);await clear();
  console.log('Manual operations: blank PDF, add/edit, ratio/percentage cuts, undo/redo, groups, duplication, nudge, alignment, spacing and page cleanup passed without AI.');

  await field('bmWidth',360);await field('bmHeight',40);
  await field('bmRowNameA','Ali');await field('bmRowNameB','Mei');await field('bmRowTotalA','24');await field('bmRowTotalB','36');
  await field('bmRatioTemplateA',2);await field('bmRatioTemplateB',3);await action('ratio');
  s=await state();assert.equal(s.bars.length,5);assert.ok(s.bars.every(a=>a.w===120));
  assert.ok(s.annotations.some(a=>a.text==='Ali: 24'));assert.ok(s.annotations.some(a=>a.text==='Mei: 36'));
  assert.equal(new Set(s.annotations.map(a=>a.grp)).size,1);await clear();
  await field('bmRowNameA','Before');await field('bmRowNameB','After');await field('bmBeforeParts',3);await field('bmAfterParts',5);await action('beforeafter');
  s=await state();assert.equal(s.bars.length,8);assert.ok(s.bars.every(a=>a.w===72));await clear();
  await field('bmGroupCount',4);await field('bmGroupQuantity','6');await field('bmLabel','24');await action('equalgroups');
  s=await state();assert.equal(s.bars.length,4);assert.ok(s.bars.every(a=>a.modelLabel==='6'));assert.ok(s.annotations.some(a=>a.text==='24'));await clear();
  await field('bmParts',5);await field('bmNumerator',3);await action('fraction');
  s=await state();assert.equal(s.bars.length,5);assert.equal(s.bars.filter(a=>a.fill!=='#F3F4F6').length,3);assert.ok(s.annotations.some(a=>a.text==='3/5'));
  await action('select');
  const emptySpot=await page.evaluate(()=>{const r=pages[0].svg.getBoundingClientRect();return {x:r.x+28,y:r.y+28};});
  await page.mouse.click(emptySpot.x,emptySpot.y);
  await page.locator('[data-bm-section="bmTemplates"]').click();
  if(process.env.SHOTS){fs.mkdirSync(process.env.SHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.SHOTS,'manual-suite-fraction.png'),fullPage:true});}
  const beforeInvalid=s.undo;await field('bmNumerator',6);await action('fraction');assert.equal((await state()).undo,beforeInvalid);
  await field('bmNumerator',3);
  const exportResult=await page.evaluate(async()=>{
    const bytes=await buildAnnotatedPdf(false),doc=await pdfjsLib.getDocument({data:bytes.slice(),useSystemFonts:true,isEvalSupported:false}).promise;
    const pdfPage=await doc.getPage(1),viewport=pdfPage.getViewport({scale:2}),canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;
    const ctx=canvas.getContext('2d');await pdfPage.render({canvasContext:ctx,viewport}).promise;
    const bar=annotations.find(bmIsBar),pixel=(x,y)=>Array.from(ctx.getImageData(Math.round(x*2),Math.round(y*2),1,1).data);
    return {text:(await pdfPage.getTextContent()).items.map(a=>a.str).join(' '),fill:pixel(bar.x+12,bar.y+10),corner:pixel(bar.x+1,bar.y+1),
      png:canvas.toDataURL('image/png').split(',')[1],size:bytes.length};
  });
  assert.match(exportResult.text,/3\/5/);assert.match(exportResult.text,/1 whole/);assert.match(exportResult.text,/1\/5/);
  assert.deepEqual(exportResult.fill,[200,221,242,255]);assert.deepEqual(exportResult.corner,[255,255,255,255]);assert.ok(exportResult.size>1500);
  if(process.env.SHOTS)fs.writeFileSync(path.join(process.env.SHOTS,'manual-suite-export.png'),Buffer.from(exportResult.png,'base64'));
  await clear();
  console.log('Templates: ratio, before/after, equal groups and 3/5 fraction have correct geometry, quantities and grouping; actual PDF text and pastel rounded fills passed.');

  await field('bmLabel','Hand drawn');await action('draw');
  await page.evaluate(()=>{const p=pages[0];$('viewerArea').scrollTop=p.wrap.offsetTop+100;});
  let svg=await page.locator('svg.overlay').boundingBox(),p=await page.evaluate(()=>({w:pages[0].baseW,h:pages[0].baseH}));
  const point=(x,y)=>({x:svg.x+x*svg.width/p.w,y:svg.y+y*svg.height/p.h});
  let from=point(70,250),to=point(330,290);await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:8});await page.mouse.up();
  s=await state();assert.equal(s.bars.length,1);assert.ok(Math.abs(s.bars[0].w-260)<1);assert.ok(Math.abs(s.bars[0].h-40)<1);
  await action('cut');const cutPoint=point(174,270);await page.mouse.click(cutPoint.x,cutPoint.y);
  s=await state();assert.equal(s.bars.length,2);assert.ok(Math.abs(s.bars[0].w-104)<1);assert.ok(Math.abs(s.bars[1].w-156)<1);
  await page.setViewportSize({width:768,height:1024});
  for(const section of ['bmBuild','bmCut','bmArrange','bmTemplates']){
    await page.locator('[data-bm-section="'+section+'"]').click();
    const visible=await page.evaluate(id=>{const panel=$('barModelPanel'),section=$(id),top=panel.querySelector('.bmPanelTop').getBoundingClientRect();
      const field=section.querySelector('input,button'),r=field.getBoundingClientRect(),p=panel.getBoundingClientRect();
      return {hidden:section.hidden,panelWidth:p.width,right:p.right,viewport:innerWidth,fieldTop:r.top,headerBottom:top.bottom,legendTop:section.querySelector('legend').getBoundingClientRect().top};},section);
    assert.equal(visible.hidden,false);assert.ok(visible.right<=visible.viewport+1);assert.ok(visible.fieldTop>=visible.headerBottom-2,'section navigation leaves first control below the sticky header: '+section);
    assert.ok(visible.legendTop>=visible.headerBottom-2,'section heading remains readable below the sticky header: '+section);
  }
  if(process.env.SHOTS)await page.screenshot({path:path.join(process.env.SHOTS,'manual-suite-tablet.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>window.__aiCalls),0);assert.deepEqual(requests,[],'manual work must make no remote request');assert.deepEqual(errors,[]);
  console.log('Actual pointer drawing and point cutting passed. All workflows used zero AI calls and zero network requests.');
} finally {await browser.close();}
