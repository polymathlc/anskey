import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function cut(start,end) { const a=html.indexOf(start),b=html.indexOf(end,a); assert.ok(a>=0&&b>a,start);return html.slice(a,b); }
function node(tag) { return { tag,style:{},attributes:{},childNodes:[],classList:{add(){}},setAttribute(k,v){this.attributes[k]=String(v);},getAttribute(k){return this.attributes[k];},appendChild(child){this.childNodes.push(child);} }; }
const text = {id:'a',page:1,type:'text',x:20,y:30,w:200,h:80,fontSize:24,text:'Voice formats text',color:'#E53935',fontFamily:'times new roman',bold:true,italic:true,underline:true,align:'center'};
function harness() {
  const calls=[];
  const canvas={save(){},restore(){},translate(){},rotate(){},setLineDash(pattern){calls.push({pattern});},measureText(t){return {width:t.length*8};},fillText(t,x,y){calls.push({text:t,x,y,font:this.font});},beginPath(){},moveTo(){},lineTo(){},stroke(){calls.push({underline:true});}};
  const c=vm.createContext({ console,Math,Number,JSON,Array,Object,Uint8Array,
    annNoteMin:()=>false,round2:n=>Math.round(n*100)/100,el:(tag,attrs)=>{const n=node(tag);Object.entries(attrs||{}).forEach(([k,v])=>n.setAttribute(k,v));return n;},
    editingId:null,reviseMode:false,document:{createElement:node,createTextNode:text=>({text})},
    hexToRgb01:()=>({r:1,g:0,b:0}),winAnsiSafe:t=>t,embedAiNoteImages:async()=>({}),
    pages:[{viewport1:{convertToPdfPoint:(x,y)=>[x,800-y]}}],annotations:[{...text}],pdfBytes:new Uint8Array(),
  });
  vm.runInContext(cut('function annFrame(a)','function normWord(')+cut('var ANN_DASH_STYLES =','function annNode(')+
    cut('function annNode(','/* ================= Keywords & revision')+cut('function drawAnnsOnCtx(','/* Full page (downscaled)')+
    cut('async function buildAnnotatedPdf(','async function downloadAnnotated('),c);
  return {c,canvas,calls};
}
test('SVG and canvas use persisted font styles, alignment and underline',()=>{
  const h=harness(),g=h.c.annNode(text),style=g.childNodes[0].childNodes[0].style;
  assert.equal(style.fontWeight,'bold');assert.equal(style.fontStyle,'italic');assert.equal(style.textDecoration,'underline');
  assert.equal(style.fontFamily,'times new roman');assert.equal(style.textAlign,'center');
  h.c.drawAnnsOnCtx(h.canvas,1,1,[text],1);
  assert.match(h.calls.find(c=>c.text).font,/italic bold 24px/);
  assert.ok(h.calls.some(c=>c.underline));assert.ok(h.calls.find(c=>c.text).x>text.x);
});
test('shape dash patterns reach SVG and canvas consistently',()=>{
  const h=harness(),a={id:'r',page:1,type:'rect',x:20,y:20,w:80,h:40,width:3,color:'#111111',dash:'dotted'};
  h.canvas.strokeRect=()=>{};
  const g=h.c.annNode(a);assert.ok(g.childNodes[0].attributes['stroke-dasharray']);
  h.c.drawAnnsOnCtx(h.canvas,1,1,[a],1);assert.ok(h.calls.some(c=>c.pattern?.length===2));
});
test('PDF selects the matching font family and emphasis, centres text and draws underline',async()=>{
  const h=harness(),pdfCalls=[];
  h.c.PDFLib={rgb:(r,g,b)=>[r,g,b],StandardFonts:new Proxy({}, {get:(_,k)=>k}),LineCapStyle:{Round:1},
    PDFDocument:{load:async()=>({embedFont:async name=>({name,widthOfTextAtSize:t=>t.length*8}),
      getPage:()=>({getHeight:()=>800,drawText:(text,o)=>pdfCalls.push({text,...o}),drawLine:o=>pdfCalls.push({underline:o})}),save:async()=>new Uint8Array([1])})}};
  await h.c.buildAnnotatedPdf(false);
  const drawn=pdfCalls.find(c=>c.text);
  assert.equal(drawn.font.name,'TimesRomanBoldItalic');assert.equal(drawn.size,24);assert.ok(drawn.x>text.x+5);
  assert.ok(pdfCalls.some(c=>c.underline));
});

// Optional real pdf-lib integration; the default suite keeps CI dependency-free.
test('real PDF library embeds and exports all supported styled font families', { skip: !process.env.PDF_LIB_MODULE }, async () => {
  const PDFLib = createRequire(import.meta.url)(process.env.PDF_LIB_MODULE), h = harness();
  const base = await PDFLib.PDFDocument.create(); base.addPage([600,800]);
  h.c.PDFLib = { ...PDFLib, PDFDocument: { load: async bytes => {
    const doc = await PDFLib.PDFDocument.load(bytes), getPage = doc.getPage.bind(doc);
    doc.getPage = index => {
      const page = getPage(index);
      return { getHeight: () => page.getHeight(),
        drawText: (line, opts) => page.drawText(line, { ...opts }),
        drawLine: opts => page.drawLine({ ...opts, start: { ...opts.start }, end: { ...opts.end } }) };
    };
    return doc;
  } } }; h.c.pdfBytes = await base.save();
  for (const fontFamily of ['arial','times new roman','courier new']) {
    h.c.annotations = [{ ...text, fontFamily }];
    const bytes = await h.c.buildAnnotatedPdf(false);
    assert.ok(bytes.length > 1000);
    assert.equal((await PDFLib.PDFDocument.load(bytes)).getPageCount(),1);
  }
});
