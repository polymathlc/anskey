/* =====================================================================
   📸 SNIP AND PIN — in a real browser
   ---------------------------------------------------------------------
   The unit tests prove the arithmetic. What they cannot prove is what was
   asked for: that a drag over the page really pins THAT part of it, that
   the pin stays put while the worksheet scrolls under it, that a corner
   really resizes it in proportion, that hide / minimise / close work, that
   it survives a reload, and that it leaves the screen for a student.

     node tools/snip-pin-check.mjs
     PW=/path/to/playwright/index.mjs node tools/snip-pin-check.mjs
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) {
  console.log('snip-pin-check: no Playwright at ' + PW + ' — skipped.');
  process.exit(0);
}

const FILE = pathToFileURL(path.resolve(process.argv[2] || 'index.html')).href;
const SHOTS = process.env.SNIP_SCREENSHOTS || '';
let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (note ? '\n      ' + note : '')); }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 860 } });
const page = await ctx.newPage();
await page.addInitScript(() => {
  const chain = () => new Proxy(function () { return chain(); }, {
    get: (t, k) => (k === 'then' ? undefined : chain()),
    apply: () => chain(), construct: () => chain(), set: () => true
  });
  window.pdfjsLib = chain(); window.firebase = chain(); window.grecaptcha = chain();
});
const errors = [];
page.on('pageerror', e => errors.push(e.message));

/* Two pages built the way loadPdf builds them, with no PDF behind them: the
   top half of page 1 is RED (the "question"), the bottom half GREEN (the
   "answer"), and page 2 is BLUE, so where a snip came from can be read off
   the pinned picture's own pixels. */
async function setup() {
  await page.goto(FILE);
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    /* No PDF is behind these stand-in pages, so the app's own lazy page
       renderer (which scrolling wakes) has nothing to rasterise. */
    renderPageCanvas = function () {};
    const host = $('pagesContainer');
    const W = 600, H = 780;
    pages = [];
    ['red-green', 'blue'].forEach((kind, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'pageWrap';
      wrap.style.cssText = 'position:relative;flex:none;margin:0 auto 24px;width:' + W + 'px;height:' + H +
        'px;min-width:' + W + 'px;min-height:' + H + 'px;background:#fff';
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const c = canvas.getContext('2d');
      if (kind === 'blue') { c.fillStyle = '#0000ff'; c.fillRect(0, 0, W, H); }
      else { c.fillStyle = '#ff0000'; c.fillRect(0, 0, W, H / 2); c.fillStyle = '#00ff00'; c.fillRect(0, H / 2, W, H / 2); }
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
      const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' });
      svg.classList.add('overlay');
      svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
      wrap.appendChild(canvas); wrap.appendChild(svg);
      host.appendChild(wrap);
      pages.push({ num: i + 1, baseW: W, baseH: H, wrap, canvas, svg });
    });
    $('emptyState') && ($('emptyState').style.display = 'none');
    annotations = [];
    currentUser = { email: ADMIN_EMAIL, uid: 'teacher' };
    actingStudent = null;
    snipRoleChanged();
  });
}
await setup();
ok('the page loads with no uncaught error', errors.length === 0, errors.join('\n      '));

async function pageBox(n) {
  return page.evaluate((n) => { const r = pages[n].svg.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, n);
}
/* What colour the pinned picture mostly is. */
async function pinColour(i) {
  return page.evaluate(async (i) => {
    const img = document.querySelectorAll('#snipPins .snipPin img')[i];
    if (!img) return null;
    if (!img.complete) await new Promise(r => img.onload = r);
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let r = 0, gr = 0, b = 0;
    for (let k = 0; k < d.length; k += 4) { r += d[k]; gr += d[k + 1]; b += d[k + 2]; }
    const n = d.length / 4;
    return { r: r / n, g: gr / n, b: b / n, w: c.width, h: c.height };
  }, i);
}

console.log('\n📸 A drag over the answer pins the answer');
await page.evaluate(() => $('snipBtn').click());
const layerOn = await page.evaluate(() => !$('snipLayer').hidden);
ok('the Snip & pin button puts up the snip layer', layerOn);
let p1 = await pageBox(0);
// Inside the GREEN half of page 1: x 150–450, y 450–600 page units.
const from = { x: p1.x + 150, y: p1.y + 450 }, to = { x: p1.x + 450, y: p1.y + 600 };
await page.mouse.move(from.x, from.y);
await page.mouse.down();
await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
await page.mouse.move(to.x, to.y, { steps: 4 });
await page.mouse.up();
await page.waitForFunction(() => document.querySelectorAll('#snipPins .snipPin').length === 1, null, { timeout: 4000 }).catch(() => {});
const after = await page.evaluate(() => ({ pins: document.querySelectorAll('#snipPins .snipPin').length, layer: !$('snipLayer').hidden,
  stored: JSON.parse(localStorage.getItem(SNIP_STORE) || '[]').length }));
ok('one pin appears and the snip layer goes away', after.pins === 1 && !after.layer, JSON.stringify(after));
const col = await pinColour(0);
ok('the pinned picture is the part that was dragged over (green, not the red question)',
   col && col.g > 200 && col.r < 40 && col.b < 40, JSON.stringify(col));
ok('…kept at the snip’s own shape (2 : 1) and sharper than the screen',
   col && Math.abs(col.w / col.h - 2) < 0.03 && col.w >= 600, JSON.stringify(col));
ok('it is remembered on this device', after.stored === 1);

const geo = () => page.evaluate(() => {
  const el = document.querySelector('#snipPins .snipPin');
  const r = el.getBoundingClientRect();
  const body = el.querySelector('.snipBody').getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height, bw: body.width, bh: body.height,
    cover: getComputedStyle(el.querySelector('.snipCover')).display,
    img: getComputedStyle(el.querySelector('img')).visibility,
    bodyShown: getComputedStyle(el.querySelector('.snipBody')).display };
});
let g0 = await geo();
ok('the window’s picture keeps the snip’s shape', Math.abs(g0.bw / g0.bh - 2) < 0.03, JSON.stringify(g0));

console.log('\nIt stays on screen while the page scrolls');
await page.evaluate(() => { $('viewerArea').scrollTop += 700; });
await page.waitForTimeout(120);
const p1b = await pageBox(0), g1 = await geo();
ok('the worksheet really scrolled', p1b.y < p1.y - 300, p1.y + ' → ' + p1b.y);
ok('…and the pin did not move with it', Math.abs(g1.x - g0.x) < 1 && Math.abs(g1.y - g0.y) < 1, JSON.stringify([g0, g1]));
if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'snip-pinned.png') }); }

console.log('\nIt resizes in proportion, moves, hides, minimises');
const grip = await page.evaluate(() => { const r = document.querySelector('#snipPins .snipGrip').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
await page.mouse.move(grip.x, grip.y); await page.mouse.down();
await page.mouse.move(grip.x - 120, grip.y, { steps: 6 }); await page.mouse.up();
const g2 = await geo();
ok('pulling the corner straight in shrinks it', g2.w < g1.w - 60, g1.w + ' → ' + g2.w);
ok('…and keeps its shape', Math.abs(g2.bw / g2.bh - 2) < 0.03, JSON.stringify(g2));
const grip2 = await page.evaluate(() => { const r = document.querySelector('#snipPins .snipGrip').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
await page.mouse.move(grip2.x, grip2.y); await page.mouse.down();
await page.mouse.move(grip2.x, grip2.y + 100, { steps: 6 }); await page.mouse.up();
const g3 = await geo();
ok('pulling it straight down grows it', g3.w > g2.w + 30 && Math.abs(g3.bw / g3.bh - 2) < 0.03, JSON.stringify(g3));

const head = { x: g3.x + 40, y: g3.y + 18 };
await page.mouse.move(head.x, head.y); await page.mouse.down();
await page.mouse.move(head.x - 300, head.y + 120, { steps: 6 }); await page.mouse.up();
const g4 = await geo();
ok('dragging the title bar moves it', Math.abs(g4.x - (g3.x - 300)) < 2 && Math.abs(g4.y - (g3.y + 120)) < 2, JSON.stringify(g4));

await page.click('#snipPins [data-snip="hide"]');
const g5 = await geo();
ok('🙈 hides the answer behind a cover, and the window stays', g5.cover === 'flex' && g5.img === 'hidden' && Math.abs(g5.w - g4.w) < 1);
await page.click('#snipPins .snipCover');
const g6 = await geo();
ok('a tap on the cover reveals it again', g6.cover === 'none' && g6.img === 'visible');
await page.waitForTimeout(400);
await page.click('#snipPins [data-snip="min"]');
const g7 = await geo();
ok('– minimises it to its title bar', g7.bodyShown === 'none' && g7.h < 45, JSON.stringify(g7));
await page.click('#snipPins [data-snip="min"]');
const g8 = await geo();
ok('▢ opens it back up at the same size', g8.bodyShown !== 'none' && Math.abs(g8.w - g4.w) < 1);

console.log('\nIt survives a reload, and is the teacher’s alone');
await page.click('#snipPins [data-snip="hide"]');
await setup();
const back = await geo().catch(() => null);
ok('after a reload the pin comes back where it was, still hidden',
   back && Math.abs(back.x - g4.x) < 2 && Math.abs(back.w - g4.w) < 2 && back.cover === 'flex', JSON.stringify(back));
await page.evaluate(() => { currentUser = { email: 'student@example.com', uid: 's' }; snipRoleChanged(); });
const forStudent = await page.evaluate(() => ({ pins: document.querySelectorAll('#snipPins .snipPin').length,
  btn: (() => { $('snipBtn').click(); return !$('snipLayer').hidden; })() }));
ok('a student sees no pin and cannot open the snip layer', forStudent.pins === 0 && !forStudent.btn, JSON.stringify(forStudent));
await page.evaluate(() => { currentUser = { email: ADMIN_EMAIL, uid: 't' }; snipRoleChanged(); });
ok('…and the teacher’s pin returns with the teacher',
   await page.evaluate(() => document.querySelectorAll('#snipPins .snipPin').length === 1));

console.log('\nEscape, a second pin, and close');
await page.keyboard.press('Shift+A');
ok('Shift+A starts a snip', await page.evaluate(() => !$('snipLayer').hidden));
await page.keyboard.press('Escape');
ok('Escape cancels it', await page.evaluate(() => $('snipLayer').hidden));
await page.evaluate(() => { const v = $('viewerArea'); v.scrollTop += pages[1].svg.getBoundingClientRect().top - v.getBoundingClientRect().top - 40; });
await page.waitForTimeout(80);
await page.evaluate(() => $('snipBtn').click());
const p2 = await pageBox(1);
await page.mouse.move(p2.x + 100, p2.y + 60); await page.mouse.down();
await page.mouse.move(p2.x + 300, p2.y + 180, { steps: 5 }); await page.mouse.up();
await page.waitForFunction(() => document.querySelectorAll('#snipPins .snipPin').length === 2, null, { timeout: 4000 }).catch(() => {});
const blue = await pinColour(1);
ok('a second pin from page 2 sits beside the first (blue)', blue && blue.b > 200 && blue.r < 40, JSON.stringify(blue));
await page.click('#snipPins .snipPin:last-child [data-snip="close"]');
await page.click('#snipPins .snipPin [data-snip="close"]');
const gone = await page.evaluate(() => ({ pins: document.querySelectorAll('#snipPins .snipPin').length, stored: JSON.parse(localStorage.getItem(SNIP_STORE) || '[]').length }));
ok('✕ closes each pin and forgets it', gone.pins === 0 && gone.stored === 0, JSON.stringify(gone));

console.log('\nOn a phone-sized screen');
ok('no uncaught error on the desktop run', errors.length === 0, errors.join('\n      '));
/* The app's own resize handler re-fits the pages, and these stand-in pages
   have no PDF behind them; the reload below starts the phone run clean. */
await page.setViewportSize({ width: 390, height: 740 });
await setup();
errors.length = 0;
await page.evaluate(() => $('snipBtn').click());
const p3 = await pageBox(0);
await page.mouse.move(Math.max(p3.x + 20, 10), p3.y + 60); await page.mouse.down();
await page.mouse.move(Math.max(p3.x + 20, 10) + 300, p3.y + 160, { steps: 5 }); await page.mouse.up();
await page.waitForFunction(() => document.querySelectorAll('#snipPins .snipPin').length === 1, null, { timeout: 4000 }).catch(() => {});
const ph = await geo().catch(() => null);
if (!ph) console.log('      debug', JSON.stringify(p3), await page.evaluate(() => JSON.stringify({ layer: !$('snipLayer').hidden, v: $('viewerArea').getBoundingClientRect() })));
ok('the pin fits on a phone screen', ph && ph.x >= 0 && ph.x + ph.w <= 390 && ph.y + ph.h <= 740, JSON.stringify(ph));
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'snip-phone.png') });

ok('no uncaught error along the way', errors.length === 0, errors.join('\n      '));
await browser.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
