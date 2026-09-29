// Real Chromium layout, SVG/canvas rendering and PDF export for voice formatting.
// PW=/path/to/playwright/index.mjs PDF_LIB=/path/to/pdf-lib/dist/pdf-lib.min.js node tools/voice-format-check.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function cut(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start); return html.slice(a, b);
}
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setContent('<style>' + html.match(/<style>([\s\S]*?)<\/style>/)[1] + '</style><svg id="sample" width="600" height="800"></svg>');
  await page.addScriptTag({ path: process.env.PDF_LIB || '/opt/node22/lib/node_modules/pdf-lib/dist/pdf-lib.min.js' });
  await page.addScriptTag({ content: `
    var round2 = n => Math.round(n * 100) / 100;
    var editingId = null, reviseMode = false;
    function el(tag, attrs) { var node = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.keys(attrs || {}).forEach(key => node.setAttribute(key, attrs[key])); return node; }
    function hexToRgb01(hex) { return { r:parseInt(hex.slice(1,3),16)/255, g:parseInt(hex.slice(3,5),16)/255, b:parseInt(hex.slice(5,7),16)/255 }; }
    function winAnsiSafe(text) { return text; }
    async function embedAiNoteImages() { return {}; }
  ` + cut('function annFrame(a)', 'function normWord(') + cut('function annBounds(a)', '/* Draw annotations straight') +
    cut('function voiceActionNumber(', 'function voiceActionNewObject(') + cut('function voiceFormatObject(', 'async function voicePlanAndApply(') +
    cut('var ANN_DASH_STYLES =', 'function annNode(') + cut('function annNode(', '/* ================= Keywords & revision') +
    cut('function drawAnnsOnCtx(', '/* Full page (downscaled)') + cut('async function buildAnnotatedPdf(', 'async function downloadAnnotated(') });
  const result = await page.evaluate(async () => {
    const context = { width:600, height:800 };
    const a = { id:'text', page:1, type:'text', x:30,y:30,w:260,h:40,fontSize:16,text:'Formatting stays visible in every output.',color:'#111111' };
    voiceFormatObject(a, { fontSize:24, bold:true, italic:true, underline:true, fontFamily:'times new roman', align:'center' }, context);
    document.getElementById('sample').appendChild(annNode(a));
    const style = getComputedStyle(document.querySelector('.annText'));
    const canvas = document.createElement('canvas'); canvas.width=600; canvas.height=800;
    const ctx = canvas.getContext('2d'), textCalls = [];
    const draw = ctx.fillText.bind(ctx); ctx.fillText = (text,x,y) => { textCalls.push({ text,x,y,font:ctx.font }); draw(text,x,y); };
    drawAnnsOnCtx(ctx,1,1,[a],1);
    const shape = {id:'box',page:1,type:'rect',x:30,y:170,w:100,h:80,width:3,color:'#E53935',dash:'dotted'};
    const node = annNode(shape); document.getElementById('sample').appendChild(node);
    const dashed = node.querySelector('[stroke-dasharray]').getAttribute('stroke-dasharray');
    drawAnnsOnCtx(ctx,1,1,[shape],1);
    window.annotations = [a,shape];
    const base = await PDFLib.PDFDocument.create(); base.addPage([600,800]); window.pdfBytes=await base.save();
    window.pages=[{viewport1:{convertToPdfPoint:(x,y)=>[x,800-y]}}];
    const load = PDFLib.PDFDocument.load, pdfText = [], underlines = [];
    PDFLib.PDFDocument.load = async (...args) => {
      const doc = await load.apply(PDFLib.PDFDocument,args), getPage=doc.getPage.bind(doc);
      doc.getPage = i => { const p=getPage(i), text=p.drawText.bind(p), line=p.drawLine.bind(p);
        p.drawText=(str,opts)=>{pdfText.push({text:str,font:opts.font.name,size:opts.size});text(str,opts);};
        p.drawLine=opts=>{underlines.push(opts);line(opts);};return p; }; return doc;
    };
    const pdf = await buildAnnotatedPdf(false);
    return { height:a.h, weight:style.fontWeight, fontStyle:style.fontStyle, underline:style.textDecorationLine, align:style.textAlign,
      family:style.fontFamily, textCalls,pdfText,underlines:underlines.length,pdfBytes:pdf.length,dashed };
  });
  assert.ok(result.height >= 43.2);
  assert.equal(result.weight,'700'); assert.equal(result.fontStyle,'italic'); assert.equal(result.underline,'underline'); assert.equal(result.align,'center');
  assert.match(result.family,/times new roman/i); assert.match(result.textCalls[0].font,/italic bold 24px/i);
  assert.ok(result.pdfText.length > 0); assert.equal(result.pdfText[0].font,'Times-BoldItalic'); assert.equal(result.pdfText[0].size,24);
  assert.ok(result.underlines > 0); assert.ok(result.pdfBytes > 1000); assert.ok(result.dashed);
  console.log('Voice formatting: real text layout, SVG styles/dashes, canvas styles and styled PDF export passed.');
} finally { await browser.close(); }
