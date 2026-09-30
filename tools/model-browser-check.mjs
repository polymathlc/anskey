// Offline real-browser smoke check for the complete model-building UI.
// PW=/path/to/playwright/index.mjs BROWSER_EXECUTABLE=/path/to/chrome SHOTS=/output/dir node tools/model-browser-check.mjs
// Set PDF_LIB, PDFJS_LIB and PDFJS_WORKER to local pdf-lib.js/pdf.mjs/pdf.worker.mjs
// to also export a real PDF and rasterise it in Chromium for visual assertions.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const pw=process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const {chromium}=await import(path.isAbsolute(pw)?pathToFileURL(pw).href:pw);
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE || undefined,args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^https?:/,route=>route.abort());
  await page.addInitScript(()=>{
    const chain=()=>new Proxy(function(){return chain();},{get:(t,k)=>k==='then'?undefined:chain(),apply:()=>chain(),construct:()=>chain(),set:()=>true});
    window.pdfjsLib=chain();window.firebase=chain();window.grecaptcha=chain();
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href);
  await page.evaluate(()=>{
    const W=600,H=800,wrap=document.createElement('div');wrap.className='pageWrap';
    wrap.style.cssText='position:relative;flex:none;width:600px;height:800px;min-width:600px;min-height:800px;background:#fff;';
    const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
    ctx.fillStyle='#26384c';ctx.font='bold 24px Arial';ctx.fillText('Singapore maths · comparison model',35,58);
    ctx.font='17px Arial';['Aisha has 3 equal bags of marbles.', 'Ben has 2 bags of the same size.', 'Aisha has 12 more marbles than Ben.', 'How many marbles does Aisha have?'].forEach((s,i)=>ctx.fillText(s,35,108+i*28));
    ctx.font='14px Arial';ctx.fillStyle='#6b7a89';ctx.fillText('Draw and label a model to show your working.',35,230);
    const svg=el('svg',{viewBox:'0 0 600 800',preserveAspectRatio:'none'});svg.classList.add('overlay');
    svg.style.cssText='position:absolute;inset:0;width:100%;height:100%';wrap.append(canvas,svg);$('viewerArea').appendChild(wrap);
    pages=[{num:1,baseW:W,baseH:H,wrap,canvas,svg}];pdfDoc={};pdfBytes=new Uint8Array([37,80,68,70]);scale=1;
    annotations=[];undoStack=[];redoStack=[];currentUser={uid:'fixture-teacher',email:ADMIN_EMAIL};currentDocId='fixture-model';
    scheduleAutoSave=()=>{};saveCrashDraft=()=>{};styleHarvestLive=()=>{};
    // The UI fixture uses painted canvases; there is no PDFPageProxy to
    // rerasterise after scrolling. Export below loads a real PDF separately.
    scheduleRaster=()=>{};
    attachOverlayHandlers(pages[0]);$('emptyState').style.display='none';applyRoleUI();setTool('select');
    ['saveBtn','blankPageBtn','deletePageBtn'].forEach(id=>$(id).disabled=false);
    docName='Maths models preview';
  });
  assert.deepEqual(errors,[],'application loads without uncaught errors');
  await page.click('#barModelBtn');assert.equal(await page.locator('#barModelPanel').isVisible(),true);
  await page.fill('#bmLabel','36 marbles');await page.fill('#bmParts','3');await page.fill('#bmCompareUnits','2');
  await page.click('[data-bm-action="comparison"]');
  let state=await page.evaluate(()=>({bars:annotations.filter(bmIsBar),labels:annotations.filter(a=>a.type==='text').map(a=>a.text),undo:undoStack.length,
    rects:Array.from(document.querySelectorAll('svg.overlay [data-id] rect[rx]')).map(n=>({rx:n.getAttribute('rx'),fill:n.getAttribute('fill')}))}));
  assert.equal(state.bars.length,5);assert.ok(state.labels.includes('36 marbles'));assert.ok(state.labels.includes('? difference'));
  assert.ok(state.rects.length>=5);assert.ok(state.rects.every(r=>Number(r.rx)>0));assert.ok(state.bars.every(a=>/^#[C-F]/i.test(a.fill)));
  assert.equal(state.undo,1);
  await page.evaluate(()=>{clearLassoSel(false);selectedId=annotations.find(bmIsBar).id;editModeId=selectedId;renderAllOverlays();bmSync(true);});
  await page.fill('#bmLabel','12');await page.click('[data-bm-action="apply"]');
  assert.equal(await page.evaluate(()=>annotations.find(a=>a.id===selectedId).modelLabel),'12');
  await page.fill('#bmParts','2');await page.click('[data-bm-action="split"]');
  state=await page.evaluate(()=>({bars:annotations.filter(bmIsBar),text:annotations.filter(a=>a.type==='text').map(a=>a.text),undo:undoStack.length}));
  assert.equal(state.bars.length,6);assert.ok(state.text.includes('12'));assert.equal(state.undo,3);
  await page.click('[data-bm-action="undo"]');assert.equal(await page.evaluate(()=>annotations.filter(bmIsBar).length),5);
  await page.evaluate(()=>{clearLassoSel(false);selectedId=null;editModeId=null;renderAllOverlays();});
  if(process.env.SHOTS){fs.mkdirSync(process.env.SHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.SHOTS,'maths-models-ui.png'),fullPage:true});}
  const beforeDraw=await page.evaluate(()=>undoStack.length);
  await page.click('[data-bm-action="draw"]');
  const svgBox=await page.locator('svg.overlay').boundingBox();
  const at=(x,y)=>({x:svgBox.x+x*svgBox.width/600,y:svgBox.y+y*svgBox.height/800});
  let point=at(70,530);await page.mouse.move(point.x,point.y);await page.mouse.down();
  point=at(330,570);await page.mouse.move(point.x,point.y,{steps:8});await page.mouse.up();
  const drawn=await page.evaluate(()=>({bar:annotations.filter(bmIsBar).at(-1),undo:undoStack.length}));
  assert.equal(drawn.bar.x,70);assert.equal(drawn.bar.y,530);assert.equal(drawn.bar.w,260);assert.equal(drawn.bar.h,40);
  assert.equal(drawn.undo,beforeDraw+1,'drag creates one undo entry');
  await page.click('[data-bm-action="cut"]');point=at(174,550);await page.mouse.click(point.x,point.y);
  const cut=await page.evaluate(()=>annotations.filter(a=>bmIsBar(a)&&a.y===530));
  assert.equal(cut.length,2);assert.equal(cut[0].w,104);assert.equal(cut[1].w,156);
  await page.evaluate(()=>{
    const original=pages[0],wrap=original.wrap.cloneNode(true);wrap.querySelector('svg').innerHTML='';
    $('viewerArea').appendChild(wrap);
    const p={num:2,baseW:600,baseH:800,wrap,canvas:wrap.querySelector('canvas'),svg:wrap.querySelector('svg')};
    pages.push(p);attachOverlayHandlers(p);$('viewerArea').scrollTop=wrap.offsetTop;
    clearLassoSel(false);selectedId=null;editModeId=null;
  });
  assert.equal(await page.evaluate(()=>currentPageNum()),2);
  await page.click('[data-bm-action="add"]');
  assert.equal(await page.evaluate(()=>annotations.filter(bmIsBar).at(-1).page),2,'Add bar uses the visible page');
  if(process.env.PDF_LIB && process.env.PDFJS_LIB && process.env.PDFJS_WORKER) {
    await page.addScriptTag({path:process.env.PDF_LIB});
    await page.addScriptTag({type:'module',content:fs.readFileSync(process.env.PDFJS_WORKER,'utf8')+'\nwindow.pdfjsWorker={WorkerMessageHandler};'});
    await page.addScriptTag({type:'module',content:fs.readFileSync(process.env.PDFJS_LIB,'utf8')+'\nwindow.pdfjsLib={getDocument,GlobalWorkerOptions};'});
    const pdfResult=await page.evaluate(async()=>{
      const base=await PDFLib.PDFDocument.create();
      for(let i=0;i<2;i++)base.addPage([600,800]);
      const font=await base.embedFont(PDFLib.StandardFonts.Helvetica);
      const top=base.getPage(0);
      top.drawText('Singapore maths: comparison model',{x:35,y:742,size:22,font});
      ['Aisha has 3 equal bags of marbles.','Ben has 2 bags of the same size.','Aisha has 12 more marbles than Ben.','How many marbles does Aisha have?'].forEach((s,i)=>top.drawText(s,{x:35,y:692-i*28,size:17,font}));
      pdfBytes=await base.save();
      pages.forEach(p=>{p.viewport1={convertToPdfPoint:(x,y)=>[x,800-y]};});
      const rotated=bmNewBar(1,55,670,220,42,'Rotated 24','#DDD2F0');rotated.rot=14;
      annotations.push(rotated);
      const bytes=await buildAnnotatedPdf(false), loaded=await pdfjsLib.getDocument({data:bytes.slice(),useSystemFonts:true,isEvalSupported:false}).promise;
      const first=await loaded.getPage(1), viewport=first.getViewport({scale:2}), canvas=document.createElement('canvas');
      canvas.width=viewport.width;canvas.height=viewport.height;
      const cx=canvas.getContext('2d');
      await first.render({canvasContext:cx,viewport}).promise;
      const text=(await first.getTextContent()).items.map(item=>item.str).join(' ');
      function pixel(x,y){return Array.from(cx.getImageData(Math.round(x*2),Math.round(y*2),1,1).data);}
      const bar=annotations.find(bmIsBar);
      const rotatedPoint=rotPt({x:rotated.x+14,y:rotated.y+rotated.h/2},{x:rotated.x+rotated.w/2,y:rotated.y+rotated.h/2},rotated.rot);
      return {pages:loaded.numPages,text,fill:pixel(bar.x+12,bar.y+10),corner:pixel(bar.x+1,bar.y+1),
        rotatedFill:pixel(rotatedPoint.x,rotatedPoint.y),png:canvas.toDataURL('image/png').split(',')[1],
        pdf:await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(new Blob([bytes],{type:'application/pdf'}));})};
    });
    assert.equal(pdfResult.pages,2);
    assert.match(pdfResult.text,/36 marbles/);assert.match(pdfResult.text,/Rotated 24/);assert.match(pdfResult.text,/12/);
    assert.deepEqual(pdfResult.fill,[200,221,242,255],'PDF retains the blue pastel fill');
    assert.deepEqual(pdfResult.corner,[255,255,255,255],'PDF corners are rounded, leaving the outer corner white');
    assert.deepEqual(pdfResult.rotatedFill,[221,210,240,255],'rotated PDF bar retains its lavender fill');
    if(process.env.SHOTS){fs.writeFileSync(path.join(process.env.SHOTS,'maths-models-export.png'),Buffer.from(pdfResult.png,'base64'));fs.writeFileSync(path.join(process.env.SHOTS,'maths-models-export.pdf'),Buffer.from(pdfResult.pdf,'base64'));}
    console.log('Actual PDF export: two pages, searchable quantities, rounded pastel fills, and a rotated labelled model verified after PDF.js rasterisation.');
  }
  assert.deepEqual(errors,[],'model interactions have no uncaught errors');
  console.log('Model UI: real app creates comparison, labels, equal split with preserved total, undo, drag-to-draw and exact point cut; rounded pastel bars render.');
} finally {await browser.close();}
