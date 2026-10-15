/* =====================================================================
   ✏️ MODEL SUITE — polymathlc/model's drawing board, in a real browser
   ---------------------------------------------------------------------
   tools/model-studio-tests.mjs pins what the source says. What no reading
   of the source can say is whether the board really draws a bar under the
   pointer, splits it, labels it and braces it; whether a key pressed while
   drawing stays in the window; whether 📌 really puts a frameless picture
   of the model on the page that carries the model with it; whether ✎ Edit
   model opens THAT model and 📌 updates the same picture; whether undo,
   the student gate and the printed PDF behave; and whether a bar made by
   the OLD manual suite still draws on an old worksheet.

   The real index.html is loaded (the CDN libraries it cannot reach are
   stood in for, as in tools/question-bank-check.mjs), with a page built
   the way loadPdf builds one.

     node tools/model-studio-check.mjs
     PW=/path/to/playwright/index.mjs node tools/model-studio-check.mjs
     PDF_LIB=/path/to/pdf-lib.min.js node tools/model-studio-check.mjs   # offline
     SHOTS=/some/dir node tools/model-studio-check.mjs                   # keep screenshots
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) {
  console.log('model-studio-check: no Playwright at ' + PW + ' — skipped.');
  process.exit(0);
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FILE = pathToFileURL(path.join(ROOT, 'index.html')).href;
const SHOTS = process.env.MS_SCREENSHOTS || process.env.SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (note ? '\n      ' + note : '')); }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'model-studio-' + name + '.png') }); };

if (process.env.PDF_LIB) {
  const body = fs.readFileSync(process.env.PDF_LIB);
  await page.route('**/pdf-lib.min.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body }));
}
await page.route(/firebase-[a-z]+-compat\.js(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/javascript', body: '' }));
// Nothing here needs the network; fonts and the rest simply fail fast.
await page.route(/^https?:\/\/(?!cdnjs\.cloudflare\.com\/ajax\/libs\/pdf-lib)/, route => route.abort());
await page.addInitScript(() => {
  const chain = () => new Proxy(function () { return chain(); }, {
    get: (t, k) => (k === 'then' ? undefined : chain()),
    apply: () => chain(), construct: () => chain(), set: () => true
  });
  window.pdfjsLib = chain(); window.firebase = chain(); window.grecaptcha = chain();
  try { localStorage.clear(); } catch (e) {}
});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(FILE);
await page.waitForTimeout(1000);
ok('the page loads with no uncaught error', errors.length === 0, errors.join('\n      '));
ok('the model studio is loaded', await page.evaluate(() => !!(window.ModelStudio && typeof msPinToPage === 'function')));
ok('the old manual suite panel is gone', await page.evaluate(() => !document.getElementById('barModelPanel') && typeof bmCommit === 'undefined'));
const hasPdfLib = await page.evaluate(() => !!(window.PDFLib && PDFLib.PDFDocument));

/* ---------------- a page, the way loadPdf builds one ---------------- */
await page.evaluate(() => {
  const W = 600, H = 780;
  const el = (tag, attrs) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(k => n.setAttribute(k, attrs[k]));
    return n;
  };
  const wrap = document.createElement('div');
  wrap.className = 'pageWrap';
  wrap.style.cssText = 'position:relative;flex:none;width:' + W + 'px;height:' + H +
    'px;min-width:' + W + 'px;min-height:' + H + 'px;background:#fff';
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const c2 = canvas.getContext('2d');
  c2.fillStyle = '#fff'; c2.fillRect(0, 0, W, H);
  c2.fillStyle = '#26384c'; c2.font = '18px Arial';
  c2.fillText('1. Aisha has 3 times as many marbles as Ben.', 30, 50);
  c2.fillText('   Draw a model to show this.', 30, 76);
  const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' });
  svg.classList.add('overlay');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  wrap.appendChild(canvas); wrap.appendChild(svg);
  $('viewerArea').appendChild(wrap);
  const p = { num: 1, baseW: W, baseH: H, wrap, canvas, svg,
    viewport1: { convertToPdfPoint: (x, y) => [x, H - y] } };
  pages = [p]; pdfDoc = {}; scale = 1; annotations = []; undoStack = []; redoStack = [];
  attachOverlayHandlers(p);
  currentUser = { uid: 'teacher-1', email: ADMIN_EMAIL, displayName: 'Teacher' };
  currentDocId = 'fixture-models';
  scheduleAutoSave = () => {}; saveCrashDraft = () => {};
  if (typeof styleHarvestLive === 'function') styleHarvestLive = () => {};
  scheduleRaster = () => {};
  $('emptyState').style.display = 'none';
  applyRoleUI();
  setTool('pen');
});

/* ---------------- opening it ---------------- */
await page.click('#barModelBtn');
await page.waitForTimeout(150);
ok('Model suite opens the drawing window', await page.locator('#msModal.open #msCard').isVisible());
const inside = await page.evaluate(() => {
  const card = $('msCard');
  return {
    tools: Array.from(card.querySelectorAll('.tool-btn[data-tool]')).map(b => b.getAttribute('data-tool')),
    text: card.textContent,
    areas: card.querySelectorAll('textarea').length,
    expanded: $('barModelBtn').getAttribute('aria-expanded')
  };
});
ok('it carries the model app\'s whole drawing toolbar',
  ['select', 'bar', 'split', 'razor', 'shade', 'label', 'brace', 'arrow', 'divider', 'dotted', 'align', 'pen', 'eraser']
    .every(t => inside.tools.includes(t)), inside.tools.join(','));
ok('…and no question, scenario or AI marking', !/scenario|AI Check|Model Answer|New Scenario/i.test(inside.text) && inside.areas === 0);
ok('the toolbar button says it is open', inside.expanded === 'true');

/* Board coordinates (the 900 × 460 viewBox) to the screen. */
async function at(x, y) {
  return page.evaluate(([x, y]) => {
    const r = document.getElementById('msCanvas').getBoundingClientRect();
    return { x: r.left + x * r.width / 900, y: r.top + y * r.height / 460 };
  }, [x, y]);
}
async function drag(x1, y1, x2, y2) {
  const a = await at(x1, y1), b = await at(x2, y2);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8);
  await page.mouse.up();
  await page.waitForTimeout(60);
}
async function click(x, y) {
  const a = await at(x, y);
  await page.mouse.click(a.x, a.y);
  await page.waitForTimeout(80);
}
const els = () => page.evaluate(() => ModelStudio.elements());

/* ---------------- drawing ---------------- */
await drag(120, 120, 600, 168);
let list = await els();
const bar = list.find(e => e.type === 'bar');
ok('dragging with Bar draws a bar', !!bar && bar.w > 300 && bar.h > 20, JSON.stringify(list));

await page.click('#msCard .tool-btn[data-tool="split"]');
await click(300, 140);
const splitInput = page.locator('#msCard .split-popover input');
ok('Split asks how many units', await splitInput.isVisible());
await splitInput.fill('3');
await splitInput.press('Enter');
await page.waitForTimeout(80);
list = await els();
ok('…and splits the bar into 3 equal units', list.find(e => e.type === 'bar').units === 3, JSON.stringify(list));

await page.click('#msCard .tool-btn[data-tool="shade"]');
await click(150, 140);
list = await els();
ok('Shade shades the unit that was clicked', (list.find(e => e.type === 'bar').shaded || []).length === 1, JSON.stringify(list));

await page.click('#msCard .tool-btn[data-tool="label"]');
await click(60, 150);
const labelInput = page.locator('#msCard .floating-input');
ok('Label opens a box to type in', await labelInput.isVisible());
await labelInput.fill('Aisha');
await labelInput.press('Enter');
await page.waitForTimeout(80);
await page.click('#msCard .tool-btn[data-tool="brace"]');
await drag(120, 110, 600, 100);
const braceInput = page.locator('#msCard .floating-input');
if (await braceInput.isVisible()) { await braceInput.fill('?'); await braceInput.press('Enter'); }
await page.waitForTimeout(80);
list = await els();
ok('a label and a brace are on the board', list.some(e => e.type === 'label' && e.text === 'Aisha') && list.some(e => e.type === 'brace'), JSON.stringify(list.map(e => e.type)));

/* Keys pressed in the window are the board's, never the worksheet's. */
const toolBefore = await page.evaluate(() => tool);
await page.focus('#msCard');
await page.keyboard.press('b');
await page.keyboard.press('e');
await page.keyboard.press('v');
const keyed = await page.evaluate(() => ({ worksheet: tool, board: document.querySelector('#msCard .tool-btn.active').getAttribute('data-tool') }));
ok('a letter pressed while drawing picks the board\'s tool, not the worksheet\'s', keyed.worksheet === toolBefore && keyed.board === 'select', JSON.stringify(keyed));
await shot('drawn');

/* ---------------- 📌 put on page ---------------- */
const undoBefore = await page.evaluate(() => undoStack.length);
await page.click('#msPinBtn');
await page.waitForTimeout(400);
const pinned = await page.evaluate(() => {
  const a = annotations.find(x => x.ms);
  return a && { id: a.id, type: a.type, kind: a.kind, n: a.ms.el.length, png: /^data:image\/png;base64,/.test(a.src), ratio: a.ratio, w: a.w, h: a.h,
    x: a.x, y: a.y, img: !!pages[0].svg.querySelector('[data-id="' + a.id + '"] img, [data-id="' + a.id + '"] image'),
    undo: undoStack.length, count: annotations.length, label: $('msPinBtn').textContent };
});
ok('📌 puts one picture on the page', pinned && pinned.count === 1 && pinned.type === 'ainote' && pinned.kind === 'paste', JSON.stringify(pinned));
ok('…a PNG of the model, carrying the model itself', pinned && pinned.png && pinned.n === list.length, JSON.stringify(pinned));
ok('…sized to the model\'s own shape, on the page', pinned && Math.abs(pinned.w / pinned.h - pinned.ratio) < 0.05 && pinned.x >= 0 && pinned.x + pinned.w <= 600 && pinned.y + pinned.h <= 780, JSON.stringify(pinned));
ok('…drawn on the page as a picture', pinned && pinned.img);
ok('…as one undo step', pinned && pinned.undo === undoBefore + 1);
ok('…and the button now updates that picture', pinned && /Update on page/.test(pinned.label), pinned && pinned.label);

/* The picture is see-through round the model, so the printed page shows. */
const transparent = await page.evaluate(() => new Promise(res => {
  const a = annotations.find(x => x.ms);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    res({ corner: g.getImageData(1, 1, 1, 1).data[3], w: img.width, h: img.height });
  };
  img.onerror = () => res(null);
  img.src = a.src;
}));
ok('the picture is transparent round the model and drawn sharp', transparent && transparent.corner === 0 && transparent.w >= 800, JSON.stringify(transparent));

await page.click('#msCloseBtn');
await page.waitForTimeout(250);
ok('closing lets go of the picture', await page.evaluate(() => !msOpen() && msAttachedId === null));

/* ---------------- ✎ Edit model ---------------- */
await page.evaluate(() => { const a = annotations.find(x => x.ms); selectedId = a.id; editModeId = a.id; setTool('select'); renderAllOverlays(); });
await page.waitForTimeout(100);
const editBtn = page.locator('.aiBar button', { hasText: 'Edit model' });
ok('the selected picture offers ✎ Edit model', await editBtn.count() === 1);
await shot('on-page');
const srcBefore = await page.evaluate(() => annotations.find(x => x.ms).src);
await editBtn.click();
await page.waitForTimeout(200);
list = await els();
ok('✎ Edit model opens THAT model, every bar still a bar', await page.evaluate(() => msOpen()) && list.some(e => e.type === 'bar' && e.units === 3), JSON.stringify(list.map(e => e.type)));
await page.click('#msCard .tool-btn[data-tool="bar"]');
await drag(120, 240, 440, 288);
await page.waitForTimeout(700);    // the model is written back as it is drawn
const live = await page.evaluate(() => annotations.find(x => x.ms).ms.el.filter(e => e.type === 'bar').length);
ok('a change is written back onto the picture\'s model as it is drawn', live === 2, String(live));
await page.click('#msPinBtn');
await page.waitForTimeout(400);
const updated = await page.evaluate(() => ({ count: annotations.length, pics: annotations.filter(x => x.ms).length,
  bars: annotations.find(x => x.ms).ms.el.filter(e => e.type === 'bar').length, src: annotations.find(x => x.ms).src,
  ratio: annotations.find(x => x.ms).ratio }));
ok('📌 updates the same picture rather than stacking a second', updated.count === 1 && updated.pics === 1 && updated.bars === 2, JSON.stringify({ count: updated.count, bars: updated.bars }));
ok('…with a new picture of the bigger model', updated.src !== srcBefore && updated.ratio < pinned.ratio, updated.ratio + ' vs ' + pinned.ratio);

/* New model leaves the picture alone and starts a board of its own. */
await page.click('#msNewBtn');
await page.waitForTimeout(150);
ok('New model empties the board and lets go of the picture',
  await page.evaluate(() => ModelStudio.isEmpty() && msAttachedId === null && annotations.filter(x => x.ms).length === 1 && /Put on page/.test($('msPinBtn').textContent)));
await page.keyboard.press('Control+z');
ok('…and Ctrl+Z on the board brings the drawing back', await page.evaluate(() => !ModelStudio.isEmpty()));

/* Escape with nothing selected closes the window, and only the window. */
await page.focus('#msCard');
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
ok('Escape closes the window', await page.evaluate(() => !msOpen()));

/* ---------------- undo on the worksheet ---------------- */
await page.evaluate(() => { undo(); undo(); });
ok('worksheet undo takes the picture back off the page', await page.evaluate(() => annotations.filter(x => x.ms).length === 0));
await page.evaluate(() => { redo(); redo(); });
ok('…and redo puts it back with its model', await page.evaluate(() => annotations.filter(x => x.ms).length === 1 && annotations.find(x => x.ms).ms.el.length > 3));

/* ---------------- the old suite's bars still draw ---------------- */
await page.evaluate(() => {
  annotations.push({ id: 'oldbar', page: 1, type: 'rect', modelBar: true, x: 40, y: 600, w: 240, h: 44,
    color: '#526B84', width: 1.4, fill: '#CBE8D5', modelLabel: '12 marbles', ts: 1 });
  renderAllOverlays();
});
const old = await page.evaluate(() => {
  const g = pages[0].svg.querySelector('[data-id="oldbar"]');
  return g && { fill: (g.querySelector('rect[rx]') || {}).getAttribute && g.querySelector('rect[rx]').getAttribute('fill'), text: g.textContent };
});
ok('a bar from an old worksheet still draws with its colour and label', old && old.fill === '#CBE8D5' && /12 marbles/.test(old.text), JSON.stringify(old));

/* ---------------- printing ---------------- */
if (hasPdfLib) {
  const pdf = await page.evaluate(async () => {
    const doc = await PDFLib.PDFDocument.create();
    doc.addPage([600, 780]);
    pdfBytes = await doc.save();
    const bytes = await buildAnnotatedPdf(false, { anns: annotations });
    const out = await PDFLib.PDFDocument.load(bytes);
    const xobj = out.getPage(0).node.Resources().lookup(PDFLib.PDFName.of('XObject'));
    return { images: xobj ? xobj.keys().length : 0, size: bytes.length };
  });
  ok('the printed PDF carries the model picture', pdf.images >= 1, JSON.stringify(pdf));
} else {
  console.log('  · pdf-lib not reachable — the print check is skipped (set PDF_LIB to run it offline)');
}

/* ---------------- the student gate ---------------- */
await page.evaluate(() => {
  currentUser = { uid: 'student-1', email: 'kid@example.com', displayName: 'Kid' };
  applyRoleUI();
});
await page.evaluate(() => openModelStudio());
await page.waitForTimeout(100);
const gate = await page.evaluate(async () => {
  const before = annotations.length;
  const disabled = $('msPinBtn').disabled;
  await msPinToPage();
  return { disabled, same: annotations.length === before, note: $('msPinNote').textContent };
});
ok('a student outside practice can draw but cannot put a model on the teacher\'s page', gate.disabled && gate.same, JSON.stringify(gate));
await page.evaluate(() => closeModelStudio());

/* A narrow screen keeps the whole toolbar reachable. */
await page.setViewportSize({ width: 820, height: 900 });
await page.evaluate(() => { currentUser = { uid: 'teacher-1', email: ADMIN_EMAIL }; applyRoleUI(); openModelStudio(); });
await page.waitForTimeout(150);
const narrow = await page.evaluate(() => {
  const card = $('msCard').getBoundingClientRect();
  const btns = Array.from(document.querySelectorAll('#msCard .tool-btn'));
  return { fits: card.right <= window.innerWidth + 1, visible: btns.every(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.right <= card.right + 1; }) };
});
ok('on a narrow screen the window and every tool stay on screen', narrow.fits && narrow.visible, JSON.stringify(narrow));
await shot('narrow');

ok('no uncaught error along the way', errors.length === 0, errors.join('\n      '));
await browser.close();
console.log('\nmodel-studio-check: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
