/* =====================================================================
   🔳 READ QR — in a real browser
   ---------------------------------------------------------------------
   The unit tests prove the geometry and that the shipped decoder reads a
   code. What they cannot prove is what was asked for: that pressing the
   button and dragging a box round a code ON THE WORKSHEET opens that link in
   a window inside the app, that the window really moves, resizes from its
   edges and corners, fills the screen and folds to its bar, that a box with
   no code in it says so, that a text code and a javascript: code never reach
   a frame, that a code on a picture outside the worksheet reads too, that a
   change of person closes every window, and that it fits a phone.

     node tools/qr-reader-check.mjs
     PW=/path/to/playwright/index.mjs node tools/qr-reader-check.mjs
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) {
  console.log('qr-reader-check: no Playwright at ' + PW + ' — skipped.');
  process.exit(0);
}

const FILE = pathToFileURL(path.resolve(process.argv[2] || 'index.html')).href;
const SHOTS = process.env.QR_SCREENSHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (note ? '\n      ' + note : '')); }
};
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

const LINK = 'https://qr.example.test/lesson/sheet-7?from=qr';
const OTHER = 'https://qr.example.test/picture-card';
const TEXT = 'The answer to question 3 is 42 g';
const BAD = 'javascript:alert(document.cookie)';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 880 } });
let page = await ctx.newPage();

async function prepare(p) {
  await p.addInitScript(() => {
    const chain = () => new Proxy(function () { return chain(); }, {
      get: (t, k) => (k === 'then' ? undefined : chain()),
      apply: () => chain(), construct: () => chain(), set: () => true
    });
    window.pdfjsLib = chain(); window.firebase = chain(); window.grecaptcha = chain();
    // No BarcodeDetector: the vendored jsQR is what every browser can count on.
    try { delete window.BarcodeDetector; } catch (e) {}
    window.BarcodeDetector = undefined;
  });
  await p.route(/firebase-[a-z]+-compat\.js(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  // The sites the codes point to, answered here so the check needs no network.
  await p.route(/^https:\/\/qr\.example\.test\//, route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>Opened</title><body style="font:24px sans-serif;background:#eef8f3"><h1 id="here">Opened ' +
      new URL(route.request().url()).pathname + '</h1></body>'
  }));
}
await prepare(page);
const errors = [];
page.on('pageerror', e => errors.push(e.message));

/* Two pages built the way loadPdf builds them, with no PDF behind them. Page 1
   carries a QR code for LINK in its lower half, page 2 a text code and a
   javascript: code. The codes are drawn by the app's own encoder. */
async function setup() {
  await page.goto(FILE);
  await page.waitForTimeout(900);
  await page.evaluate(({ LINK, TEXT, BAD }) => {
    renderPageCanvas = function () {};
    const host = $('pagesContainer');
    const W = 600, H = 780;
    function drawCode(c, text, x, y, size) {
      const q = qrcode(0, 'M'); q.addData(text); q.make();
      const n = q.getModuleCount(), m = size / n;
      c.fillStyle = '#000';
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) c.fillRect(Math.floor(x + k * m), Math.floor(y + r * m), Math.ceil(m), Math.ceil(m));
    }
    pages = [];
    [0, 1].forEach((i) => {
      const wrap = document.createElement('div');
      wrap.className = 'pageWrap';
      wrap.style.cssText = 'position:relative;flex:none;margin:0 auto 24px;width:' + W + 'px;height:' + H +
        'px;min-width:' + W + 'px;min-height:' + H + 'px;background:#fff';
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const c = canvas.getContext('2d');
      c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
      c.fillStyle = '#17324d'; c.font = '20px sans-serif';
      c.fillText(i === 0 ? 'Question 1 — scan the code to watch the lesson' : 'Question 2', 40, 60);
      for (let l = 0; l < 6; l++) { c.fillRect(40, 100 + l * 30, 520, 2); }
      if (i === 0) drawCode(c, LINK, 360, 420, 160);
      else { drawCode(c, TEXT, 60, 420, 150); drawCode(c, BAD, 360, 420, 150); }
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
    applyRoleUI();
  }, { LINK, TEXT, BAD });
}
await setup();
ok('the page loads with no uncaught error', errors.length === 0, errors.join('\n      '));

const pageBox = (n) => page.evaluate((n) => { const r = pages[n].svg.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, n);
const wins = () => page.evaluate(() => [...document.querySelectorAll('#qrWins .qrWin')].map((w) => {
  const r = w.getBoundingClientRect();
  const f = w.querySelector('iframe');
  return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
    title: w.querySelector('.qrwTitle').textContent, src: f ? f.src : null,
    text: (w.querySelector('.qrwText') || {}).textContent || null,
    max: w.classList.contains('maximised'), min: w.classList.contains('minimised') };
}));
const layerUp = () => page.evaluate(() => { const l = $('qrLayer'); return !!l && !l.hidden; });
const hintText = () => page.evaluate(() => (document.querySelector('#qrLayer .qrHintText') || {}).textContent || '');

async function dragBox(x0, y0, x1, y1) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
  await page.mouse.move(x1, y1, { steps: 4 });
  await page.mouse.up();
}
async function readAt(n, x0, y0, x1, y1) {
  const b = await pageBox(n);
  await page.evaluate(() => $('qrReadBtn').click());
  await dragBox(b.x + x0, b.y + y0, b.x + x1, b.y + y1);
}

console.log('\n🔳 The button and the layer');
const btn = await page.evaluate(() => {
  const b = $('qrReadBtn'); const r = b.getBoundingClientRect();
  return { shown: r.width > 0 && getComputedStyle(b).display !== 'none', key: b.getAttribute('data-key'), icon: !!b.querySelector('svg') };
});
ok('a Read QR button with a QR icon is on the toolbar (Shift+Q)', btn.shown && btn.key === 'Shift+Q' && btn.icon, JSON.stringify(btn));
await page.evaluate(() => $('qrReadBtn').click());
ok('pressing it puts up the drag layer', await layerUp());
ok('…and the button shows it is on', await page.evaluate(() => $('qrReadBtn').classList.contains('active')));
const toolBefore = await page.evaluate(() => tool);
await page.keyboard.press('r');
ok('a letter pressed while the layer is up never reaches the tool shortcuts', (await page.evaluate(() => tool)) === toolBefore);
await page.keyboard.press('Escape');
ok('Escape takes the layer down', !(await layerUp()));
await page.keyboard.press('Shift+Q');
ok('Shift+Q puts it up again', await layerUp());
await page.keyboard.press('Escape');

console.log('\n🌐 A drag round a code on the worksheet opens its link in a window here');
// Tight round the code on page 1 (drawn at 360,420 size 160): no quiet zone left in the box.
await readAt(0, 362, 422, 518, 578);
await page.waitForFunction(() => document.querySelectorAll('#qrWins .qrWin').length === 1, null, { timeout: 8000 }).catch(() => {});
let w = await wins();
ok('one window opens and the layer goes away', w.length === 1 && !(await layerUp()), JSON.stringify(w) + ' hint: ' + await hintText());
ok('the window holds the link the code points to', w[0] && w[0].src === LINK, w[0] && w[0].src);
ok('…titled with the site', w[0] && w[0].title === '🌐 qr.example.test', w[0] && w[0].title);
await page.waitForFunction(() => { const f = document.querySelector('#qrWins iframe'); return f && !f.closest('.qrwStage').classList.contains('loading'); }, null, { timeout: 8000 }).catch(() => {});
const frame = page.frames().find((f) => f.url() === LINK);
let opened = '';
if (frame) { await frame.waitForSelector('#here', { timeout: 5000 }).catch(() => {}); opened = await frame.evaluate(() => (document.getElementById('here') || {}).textContent || '').catch(() => ''); }
ok('the site really opens inside the window', /Opened \/lesson\/sheet-7/.test(opened), opened + ' frames: ' + page.frames().map((f) => f.url()).join(' , '));
ok('the frame is sandboxed', await page.evaluate(() => (document.querySelector('#qrWins iframe').getAttribute('sandbox') || '').includes('allow-scripts')));
await page.waitForTimeout(300);
await shot('01-window');

console.log('\n↔ It moves, resizes from its edges and corners, fills the screen and folds');
const before = (await wins())[0];
// Move by the title bar.
await page.mouse.move(before.x + 60, before.y + 20);
await page.mouse.down();
await page.mouse.move(before.x - 140, before.y + 60, { steps: 6 });
await page.mouse.up();
let after = (await wins())[0];
ok('dragging the title bar moves it', Math.abs(after.x - (before.x - 200)) <= 2 && Math.abs(after.y - (before.y + 40)) <= 2, JSON.stringify({ before, after }));
ok('…without changing its size', after.w === before.w && after.h === before.h);
// Bottom-right grip.
const g0 = after;
await page.mouse.move(g0.x + g0.w - 6, g0.y + g0.h - 6);
await page.mouse.down();
await page.mouse.move(g0.x + g0.w + 74, g0.y + g0.h - 66, { steps: 6 });
await page.mouse.up();
let g1 = (await wins())[0];
ok('the corner grip resizes it (wider by 80, shorter by 60)', Math.abs(g1.w - (g0.w + 80)) <= 2 && Math.abs(g1.h - (g0.h - 60)) <= 2, JSON.stringify({ g0, g1 }));
ok('…while the top-left stays where it was', g1.x === g0.x && g1.y === g0.y);
// Left edge.
await page.mouse.move(g1.x + 1, g1.y + g1.h / 2);
await page.mouse.down();
await page.mouse.move(g1.x + 51, g1.y + g1.h / 2 + 30, { steps: 5 });
await page.mouse.up();
let g2 = (await wins())[0];
ok('the left edge resizes it, keeping the right edge put', Math.abs(g2.x - (g1.x + 50)) <= 2 && Math.abs((g2.x + g2.w) - (g1.x + g1.w)) <= 2 && g2.h === g1.h, JSON.stringify({ g1, g2 }));
// Top-left corner, pushed far past the minimum.
await page.mouse.move(g2.x + 1, g2.y + 1);   // the very corner, where a rounded clip would not be hit
await page.mouse.down();
await page.mouse.move(g2.x + 2000, g2.y + 2000, { steps: 6 });
await page.mouse.up();
let g3 = (await wins())[0];
const mins = await page.evaluate(() => ({ w: QrReader.pure.WIN_MIN_W, h: QrReader.pure.WIN_MIN_H }));
ok('shrunk past its minimum it stops at the minimum, its far corner still put',
   g3.w === mins.w && g3.h === mins.h && Math.abs(g3.x + g3.w - (g2.x + g2.w)) <= 2 && Math.abs(g3.y + g3.h - (g2.y + g2.h)) <= 2, JSON.stringify({ g2, g3 }));
// Grow it back so the rest reads well.
await page.mouse.move(g3.x + g3.w - 6, g3.y + g3.h - 6);
await page.mouse.down();
await page.mouse.move(g3.x + g3.w + 300, g3.y + g3.h + 260, { steps: 6 });
await page.mouse.up();
// The frame never swallowed a drag: the moves above all landed.
ok('the window remembers where it stood on this device', await page.evaluate(() => !!JSON.parse(localStorage.getItem(QrReader.pure.WIN_STORE) || 'null')));
await page.evaluate(() => document.querySelector('#qrWins [data-qrw="max"]').click());
let m = (await wins())[0];
ok('▢ fills the screen', m.max && m.w >= 1280 - 20 && m.h >= 880 - 20, JSON.stringify(m));
await page.evaluate(() => document.querySelector('#qrWins [data-qrw="max"]').click());
m = (await wins())[0];
ok('…and ❐ puts it back to its own size', !m.max && m.w < 1200, JSON.stringify(m));
const hb = (await wins())[0];
await page.mouse.dblclick(hb.x + 80, hb.y + 20);
m = (await wins())[0];
ok('a double-tap on the bar fills the screen too', m.max, JSON.stringify(m));
await page.mouse.dblclick(m.x + 80, m.y + 20);
await page.evaluate(() => document.querySelector('#qrWins [data-qrw="min"]').click());
m = (await wins())[0];
ok('– folds it to its title bar', m.min && m.h <= 42, JSON.stringify(m));
await page.evaluate(() => document.querySelector('#qrWins [data-qrw="min"]').click());
m = (await wins())[0];
ok('…and opens it back up', !m.min && m.h > 200, JSON.stringify(m));
await shot('02-resized');

console.log('\n🔁 The same code twice is one window; a box with no code says so');
await readAt(0, 350, 410, 530, 590);
await page.waitForTimeout(900);
ok('reading the same code again raises the open window rather than opening a second', (await wins()).length === 1);
await readAt(0, 40, 90, 300, 260);
await page.waitForFunction(() => /No QR code found/.test((document.querySelector('#qrLayer .qrHintText') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
ok('a box over ruled lines finds nothing, and says so in words', /No QR code found/.test(await hintText()), await hintText());
ok('…leaving the layer up to try again, with no new window', (await layerUp()) && (await wins()).length === 1);
await shot('03-miss');
await page.mouse.click(640, 440);   // a tap is not a box
ok('a tap is a tap, not a box', /tap/.test(await hintText()), await hintText());
await page.keyboard.press('Escape');

console.log('\n🔤 A text code is shown as text; a javascript: code is never a link');
await page.evaluate(() => { $('viewerArea').scrollTop = pages[1].wrap.offsetTop - 40; });
await page.waitForTimeout(200);
await readAt(1, 55, 415, 215, 575);
await page.waitForFunction(() => document.querySelectorAll('#qrWins .qrWin').length === 2, null, { timeout: 8000 }).catch(() => {});
w = await wins();
const tw = w.find((x) => x.text);
ok('a text code opens a text window', tw && tw.text === TEXT && tw.src === null, JSON.stringify(w));
await readAt(1, 355, 415, 515, 575);
await page.waitForFunction(() => document.querySelectorAll('#qrWins .qrWin').length === 3, null, { timeout: 8000 }).catch(() => {});
w = await wins();
const bw = w.find((x) => x.text === BAD);
ok('a javascript: code is shown as words, never put in a frame', bw && bw.src === null && /cannot be opened/.test(bw.title), JSON.stringify(w));
ok('…and no frame anywhere points at it', await page.evaluate(() => [...document.querySelectorAll('iframe')].every((f) => !/^javascript:/i.test(f.getAttribute('src') || ''))));
await shot('04-text');

console.log('\n🖼 A code on a picture outside the worksheet reads too');
await page.evaluate((OTHER) => {
  const q = qrcode(0, 'M'); q.addData(OTHER); q.make();
  const img = document.createElement('img');
  img.id = 'qrCheckCard';
  img.src = q.createDataURL(6, 4);
  img.style.cssText = 'position:fixed;left:24px;bottom:24px;width:180px;height:180px;z-index:50;border:6px solid #fff;box-shadow:0 4px 20px #0003';
  document.body.appendChild(img);
}, OTHER);
await page.waitForTimeout(200);
const card = await page.evaluate(() => { const r = $('qrCheckCard').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
await page.evaluate(() => $('qrReadBtn').click());
await dragBox(card.x - 4, card.y - 4, card.x + card.w + 4, card.y + card.h + 4);
await page.waitForFunction((u) => [...document.querySelectorAll('#qrWins iframe')].some((f) => f.src === u), OTHER, { timeout: 8000 }).catch(() => {});
ok('a QR picture floating over the page opens its link', (await wins()).some((x) => x.src === OTHER), JSON.stringify(await wins()));
ok('no more than four windows are ever open at once', (await wins()).length <= 4);

console.log('\n✕ Closing, and a change of person');
const n0 = (await wins()).length;
await page.evaluate(() => document.querySelector('#qrWins .qrWin:last-child [data-qrw="close"]').click());
ok('✕ closes that window alone', (await wins()).length === n0 - 1);
await page.evaluate(() => { applyRoleUI(); });
ok('a role re-check for the same person keeps every window', (await wins()).length === n0 - 1);
await page.evaluate(() => { currentUser = { email: 'pupil@example.com', uid: 'student-1' }; applyRoleUI(); });
ok('a different person closes every window', (await wins()).length === 0);
ok('…and the button is still there for a student', await page.evaluate(() => getComputedStyle($('qrReadBtn')).display !== 'none'));
ok('no uncaught error along the way', errors.length === 0, errors.join('\n      '));

console.log('\n📱 On a phone');
await page.close();
const phone = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
page = await phone.newPage();
await prepare(page);
page.on('pageerror', e => errors.push(e.message));
await setup();
await page.evaluate((LINK) => { qrRead.openText(LINK); }, LINK);
await page.waitForTimeout(300);
w = await wins();
ok('a window opened on a phone fits inside the screen', w.length === 1 && w[0].x >= 0 && w[0].x + w[0].w <= 390 && w[0].y + w[0].h <= 780, JSON.stringify(w));
await page.evaluate(() => $('qrReadBtn').click());
const hintBox = await page.evaluate(() => { const r = document.querySelector('#qrLayer .qrHint').getBoundingClientRect(); return { l: r.left, r: r.right }; });
ok('the layer\'s hint fits the phone\'s width', hintBox.l >= 0 && hintBox.r <= 390, JSON.stringify(hintBox));
await shot('05-phone');
ok('no uncaught error on the phone', errors.length === 0, errors.join('\n      '));

await browser.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
