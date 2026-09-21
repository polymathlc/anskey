/* =====================================================================
   📎 A PASTED PICTURE HAS NO WINDOW ROUND IT — in a real browser
   ---------------------------------------------------------------------
   Every other check in this repo reads the source and asks what it SAYS.
   That is enough for the arithmetic and for the guards, and it is not
   enough for the thing that was actually asked for: that the page shows
   the PICTURE and nothing else, that it really picks up, that a corner
   really scales it, and that a locked one really will not move.

   Like `tools/text-caret-check.mjs` this needs a real Chromium, so it is a
   tool you reach for rather than a gate:

     node tools/picture-check.mjs
     PW=/path/to/playwright/index.mjs node tools/picture-check.mjs
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) {
  console.log('picture-check: no Playwright at ' + PW + ' — skipped.');
  console.log('  set PW=/path/to/playwright/index.mjs to run it.');
  process.exit(0);
}

const FILE = pathToFileURL(path.resolve(process.argv[2] || 'index.html')).href;
let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (note ? '\n      ' + note : '')); }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1000, height: 860 } });
const page = await ctx.newPage();
/* pdf.js and the Firebase SDK come off a CDN, which a sandbox (and a school
   wifi) may not reach — and an unguarded reference stops the script at that
   line, so nothing below it is defined. A chain proxy lets it run to the end;
   nothing under these names is exercised here. */
await page.addInitScript(() => {
  const chain = () => new Proxy(function () { return chain(); }, {
    get: (t, k) => (k === 'then' ? undefined : chain()),
    apply: () => chain(), construct: () => chain(), set: () => true
  });
  window.pdfjsLib = chain(); window.firebase = chain(); window.grecaptcha = chain();
});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(FILE);
await page.waitForTimeout(1200);
ok('the page loads with no uncaught error', errors.length === 0, errors.join('\n      '));

/* One page, built the way loadPdf builds one — the real overlay and the real
   handlers, with no PDF behind it. */
await page.evaluate(() => {
  const W = 600, H = 780;
  const wrap = document.createElement('div');
  wrap.className = 'pageWrap';
  /* `flex: none` and the explicit min-height are load-bearing: body is a flex
     column in this app, so a bare width/height is SHRUNK — the svg then came
     out 600 x 398 and every client pixel was two page units down the page,
     which is exactly what made the first cut of this file report a working
     drag as a failure. */
  wrap.style.cssText = 'position:relative;flex:none;width:' + W + 'px;height:' + H +
    'px;min-width:' + W + 'px;min-height:' + H + 'px;background:#fff';
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' });
  svg.classList.add('overlay');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  wrap.appendChild(canvas); wrap.appendChild(svg);
  document.body.appendChild(wrap);
  const p = { num: 1, baseW: W, baseH: H, wrap, canvas, svg };
  pages = [p]; pdfDoc = {}; scale = 1; annotations = [];
  attachOverlayHandlers(p);
  setTool('select');
  /* A 2 : 1 picture, so a corner drag that kept the ratio shows in the numbers
     rather than being a guess. */
  const cv = document.createElement('canvas'); cv.width = 320; cv.height = 160;
  const c = cv.getContext('2d');
  c.fillStyle = '#f4f2ea'; c.fillRect(0, 0, 320, 160);
  c.strokeStyle = '#1b1b18'; c.lineWidth = 3; c.strokeRect(40, 30, 240, 90);
  const url = cv.toDataURL('image/png');
  const bin = atob(url.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  window.__pic = new File([bytes], 'p.png', { type: 'image/png' });
});

console.log('\n📎 The picture lands, and it is the picture');
const landed = await page.evaluate(async () => {
  await pasteImageOntoPage(window.__pic);
  const a = annotations[0];
  if (a) { a.x = 110; a.y = 130; }
  selectedId = a && a.id; editModeId = a && a.id;
  renderAllOverlays();
  const g = pages[0].svg.querySelector('g[data-id="' + (a && a.id) + '"]');
  const box = g && g.querySelector('.pastePic');
  const img = box && box.querySelector('img');
  const cs = box && getComputedStyle(box);
  return {
    made: !!a, type: a && a.type, kind: a && a.kind, ratio: a && a.ratio,
    shape: a ? +(a.w / a.h).toFixed(3) : 0,
    drawn: !!img, children: box ? box.children.length : -1, tag: img && img.tagName,
    bg: cs && cs.backgroundColor, border: cs && cs.borderTopWidth,
    fit: img && getComputedStyle(img).objectFit, draggable: img && img.draggable,
    chrome: g ? g.querySelectorAll('.aiNoteHead, .aiNoteBtn, .aiNoteTitle, button').length : -1,
    handles: pages[0].svg.querySelectorAll('[data-handle]').length,
    bar: (pages[0].wrap.querySelector('.aiBar') || {}).innerText || ''
  };
});
ok('Ctrl+V puts a picture on the page',
   landed.made && landed.type === 'ainote' && landed.kind === 'paste');
ok('…and the box IS the picture’s own shape, with no heading band added',
   Math.abs(landed.shape - 2) < 0.02 && Math.abs((landed.ratio || 0) - 2) < 0.02,
   'w/h = ' + landed.shape + ', stored ratio = ' + landed.ratio);
ok('what is drawn is ONE <img> and nothing else',
   landed.drawn && landed.children === 1 && landed.tag === 'IMG' && landed.chrome === 0,
   JSON.stringify(landed));
ok('…with no background and no border round it',
   /rgba\(0, 0, 0, 0\)|transparent/.test(landed.bg || '') && landed.border === '0px',
   'bg=' + landed.bg + ' border=' + landed.border);
ok('…fitted rather than stretched', landed.fit === 'contain', landed.fit);
ok('…and the browser’s own image drag switched off', landed.draggable === false);
ok('a selected picture grows four corner handles', landed.handles === 8,
   'saw ' + landed.handles + ' (4 visible + 4 finger-sized twins)');
ok('…and its own bar, which is where the controls went',
   /Lock/.test(landed.bar) && /Remove/.test(landed.bar), JSON.stringify(landed.bar));

const atRest = await page.evaluate(() => {
  selectedId = null; editModeId = null;
  renderAllOverlays();
  return {
    handles: pages[0].svg.querySelectorAll('[data-handle]').length,
    bar: !!pages[0].wrap.querySelector('.aiBar'),
    badge: !!pages[0].wrap.querySelector('.editBadge')
  };
});
ok('tapping away leaves NOTHING on the page but the picture',
   atRest.handles === 0 && !atRest.bar && !atRest.badge, JSON.stringify(atRest));

console.log('\nIt moves, and a corner scales it');
/* The pointerdown has to land on the REAL element — anskey's select tool reads
   `e.target` to decide what was tapped, and a down on the bare SVG deselects
   everything. The move and the up go to the svg, which has the listeners. */
async function drag(from, to, sel) {
  const missing = await page.evaluate(({ from, to, sel }) => {
    const svg = pages[0].svg;
    const a = annotations[0];
    const target = svg.querySelector(sel || ('g[data-id="' + a.id + '"] img'));
    if (!target) return sel || 'the picture';
    const o = n => ({ bubbles: true, cancelable: true, clientX: n.x, clientY: n.y,
                      pointerId: 31, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 });
    target.dispatchEvent(new PointerEvent('pointerdown', o(from)));
    svg.dispatchEvent(new PointerEvent('pointermove', o(to)));
    svg.dispatchEvent(new PointerEvent('pointerup', Object.assign(o(to), { buttons: 0 })));
    return '';
  }, { from, to, sel });
  if (missing) ok('the drag had something to grab (' + missing + ')', false);
  await page.waitForTimeout(90);
}
/* A page unit is a CLIENT pixel only when the svg is drawn at its own
   viewBox size. It is here, and the check says so rather than assuming it —
   the two coordinate systems are the trap this repo documents at length under
   the text caret, and a harness that mixes them reports a working drag as a
   failure. Every client point below is built with `geom()`. */
async function geom() {
  return page.evaluate(() => {
    const p = pages[0], r = p.svg.getBoundingClientRect(), a = annotations[0];
    const kx = r.width / p.baseW, ky = r.height / p.baseH;
    return { x: a.x, y: a.y, w: a.w, h: a.h, kx, ky,
             cx: r.x + (a.x + a.w / 2) * kx, cy: r.y + (a.y + a.h / 2) * ky,
             sx: r.x + (a.x + a.w) * kx, sy: r.y + (a.y + a.h) * ky };
  });
}
await page.evaluate(() => setTool('select'));
const before = await geom();
/* What has to hold is that the conversion is measurable and UNIFORM — a skewed
   overlay would put every client point below somewhere else on the page, in a
   way nothing else here would catch. Its VALUE is not the harness's business:
   `polymathlc/tutor`'s own page is fitted to the viewer and comes out at about
   1.09, and every drag there would be that much out if it assumed 1. */
ok('the page-to-client scale is measurable and the same on both axes',
   before.kx > 0.05 && before.kx < 20 && Math.abs(before.kx - before.ky) < 0.01,
   'kx ' + before.kx.toFixed(3) + ' · ky ' + before.ky.toFixed(3));

await drag({ x: before.cx, y: before.cy }, { x: before.cx + 40, y: before.cy + 25 });
const moved = await page.evaluate(() => ({ x: annotations[0].x, y: annotations[0].y }));
/* The client delta converted back into page units — what has to be true is
   that the picture followed the pointer, in both directions, by the distance
   the pointer really travelled. */
const dx = moved.x - before.x, dy = moved.y - before.y;
ok('dragging the picture moves it',
   Math.abs(dx - 40 / before.kx) < 2 && Math.abs(dy - 25 / before.ky) < 2,
   JSON.stringify({ from: [before.x, before.y], to: moved, by: [dx, dy] }));

/* Diagonally in, on the corner: the plain case, and the one that has to come
   out exact. */
const anchor = await geom();
await drag({ x: anchor.sx, y: anchor.sy },
           { x: anchor.sx - 100 * anchor.kx, y: anchor.sy - 50 * anchor.ky },
           '[data-handle="se"]');
const sized = await page.evaluate(() => {
  const a = annotations[0];
  return { x: a.x, y: a.y, w: a.w, h: a.h };
});
ok('dragging a corner resizes it', sized.w < anchor.w - 40, anchor.w + ' → ' + sized.w);
ok('…keeping the picture’s own shape', Math.abs(sized.w / sized.h - 2) < 0.05,
   sized.w + ' x ' + sized.h + ' = ' + (sized.w / sized.h).toFixed(3));
ok('…anchored to the opposite corner, so it does not creep away',
   Math.abs(sized.x - anchor.x) < 0.02 && Math.abs(sized.y - anchor.y) < 0.02,
   JSON.stringify({ was: [anchor.x, anchor.y], now: [sized.x, sized.y] }));

/* And the two single-axis drags, which is the whole reason the scale is a
   PROJECTION: whichever way the corner is pulled, the picture has to answer.
   A "larger axis wins" rule leaves the first of these dead and a "smaller
   axis wins" rule the second, and a handle that does nothing reads as a
   feature that does not work. */
const wideFrom = await geom();
await drag({ x: wideFrom.sx, y: wideFrom.sy },
           { x: wideFrom.sx - 60 * wideFrom.kx, y: wideFrom.sy },
           '[data-handle="se"]');
const wide = await page.evaluate(() => ({ w: annotations[0].w, h: annotations[0].h }));
ok('…and a corner pulled straight IN along the long edge still shrinks it',
   wide.w < wideFrom.w - 8 && Math.abs(wide.w / wide.h - 2) < 0.05,
   wideFrom.w + ' → ' + wide.w);

const outFrom = await geom();
await drag({ x: outFrom.sx, y: outFrom.sy },
           { x: outFrom.sx + 60 * outFrom.kx, y: outFrom.sy },
           '[data-handle="se"]');
const grown = await page.evaluate(() => ({ w: annotations[0].w, h: annotations[0].h }));
ok('…and one pulled straight OUT along it still grows it',
   grown.w > outFrom.w + 8 && Math.abs(grown.w / grown.h - 2) < 0.05,
   outFrom.w + ' → ' + grown.w);

console.log('\n🔒 Locked in position');
const locked = await page.evaluate(() => {
  const btn = Array.from(pages[0].wrap.querySelectorAll('.aiBar button'))
    .find(b => /Lock/.test(b.textContent));
  if (!btn) return { pressed: false };
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  const a = annotations[0];
  return { pressed: true, locked: !!a.locked, selected: selectedId === a.id,
           handles: pages[0].svg.querySelectorAll('[data-handle]').length,
           bar: (pages[0].wrap.querySelector('.aiBar') || {}).innerText || '',
           box: { x: a.x, y: a.y, w: a.w, h: a.h } };
});
ok('the 🔒 button is there and locks it', locked.pressed && locked.locked === true);
ok('…and a locked picture has no handles to drag', locked.handles === 0, 'saw ' + locked.handles);
ok('…but is still SELECTED, or the 🔓 could never be reached', locked.selected === true);
ok('…and its bar now offers 🔓', /Unlock/.test(locked.bar), JSON.stringify(locked.bar));

const mid = await geom();
await drag({ x: mid.cx, y: mid.cy }, { x: mid.cx + 60, y: mid.cy + 60 });
const stayed = await page.evaluate(() => {
  const a = annotations[0];
  return { x: a.x, y: a.y, w: a.w, h: a.h };
});
ok('a locked picture does not move when it is dragged',
   JSON.stringify(stayed) === JSON.stringify(locked.box),
   JSON.stringify(locked.box) + ' → ' + JSON.stringify(stayed));

/* The eraser is the reason locking is worth having: rubbing a stroke off a
   picture must not take the picture with it. */
const erased = await page.evaluate(() => {
  const p = pages[0], r = p.svg.getBoundingClientRect(), a = annotations[0];
  erasing = { page: p, snap: snapshot(), removed: false, lastX: 0, lastY: 0 };
  const x = r.x + (a.x + a.w / 2) * (r.width / p.baseW);
  const y = r.y + (a.y + a.h / 2) * (r.height / p.baseH);
  eraseAlong(x, y, x, y);
  erasing = null;
  return { left: annotations.filter(q => q.kind === 'paste').length };
});
ok('…and the eraser steps over it', erased.left === 1, 'pictures left: ' + erased.left);

/* A lock nothing can undo is a picture nobody can take off the page. */
const removed = await page.evaluate(() => {
  selectedId = annotations[0].id; editModeId = selectedId;
  renderAllOverlays();
  const btn = Array.from(pages[0].wrap.querySelectorAll('.aiBar button'))
    .find(b => /Remove/.test(b.textContent));
  if (!btn) return { pressed: false };
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  return { pressed: true, left: annotations.filter(q => q.kind === 'paste').length };
});
ok('a locked picture can still be removed from its own bar',
   removed.pressed && removed.left === 0, JSON.stringify(removed));

await browser.close();
console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' + pass + ' passed' : '✓ all ' + pass + ' passed'));
process.exit(fail ? 1 : 0);
