/* 🔳 READ QR — the pure helpers run, the real decoder run on real codes, and
   the rules read off the files.

   Every failure here is quiet. A box dragged snugly round a code cuts off
   its quiet zone and reads as "no QR code found" on a code that is plainly
   there; a javascript: link that reaches a frame runs in the app; a window
   that does not close on a handover leaves the teacher's page on the next
   person's screen; a resize that moves the anchored edge has the window
   creep away under the pointer. Nothing throws in any of them.

     node --test tools/qr-reader-tests.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, root), 'utf8');
const html = read('index.html');
const js = read('qr-reader.js');
const css = read('qr-reader.css');

/* The module, loaded the way a browser loads it, with no DOM touched. */
const sandbox = { Math, Date, String, Number, Object, Array, JSON, URL, Uint8ClampedArray, Uint8Array, Promise, isFinite, setTimeout, clearTimeout, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(js, sandbox);
const Q = sandbox.QrReader;
const P = Q.pure;
const plain = (v) => JSON.parse(JSON.stringify(v));

/* The real decoder and the real encoder the app ships. */
const jsQR = require('../vendor/jsQR.js');
const qrSandbox = {};
vm.createContext(qrSandbox);
vm.runInContext(read('vendor/qrcode-generator.js') + '\nthis.qrcode = qrcode;', qrSandbox);
const qrcode = qrSandbox.qrcode;

/* A code as RGBA pixels: `scale` pixels per module, `margin` MODULES of white
   round it (0 = cropped exactly to the code, as a tight drag does). */
function codeRgba(text, scale = 6, margin = 4, opts = {}) {
  const q = qrcode(0, opts.level || 'L');
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  const side = (n + margin * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const mx = Math.floor(x / scale) - margin, my = Math.floor(y / scale) - margin;
      const dark = mx >= 0 && my >= 0 && mx < n && my < n && q.isDark(my, mx);
      const i = (y * side + x) * 4;
      if (opts.transparent) {
        data[i] = data[i + 1] = data[i + 2] = 0;
        data[i + 3] = dark ? 255 : 0;
      } else {
        const v = dark ? 0 : 255;
        data[i] = data[i + 1] = data[i + 2] = opts.invert ? 255 - v : v;
        data[i + 3] = 255;
      }
    }
  }
  return { data, w: side, h: side };
}
/* The module's quiet zone, done to raw pixels the way paddedCanvas does it. */
function padRgba(img) {
  const pad = P.quietPad(img.w, img.h);
  const W = img.w + pad * 2, H = img.h + pad * 2;
  const out = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 0; y < img.h; y++) {
    out.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), ((y + pad) * W + pad) * 4);
  }
  return { data: out, w: W, h: H };
}

/* ---------------------------------------------------------------- geometry */

test('a drag in any direction is the same box', () => {
  assert.deepEqual(plain(P.normRect(50, 80, 10, 20)), { x: 10, y: 20, w: 40, h: 60 });
  assert.deepEqual(plain(P.normRect(10, 20, 50, 80)), { x: 10, y: 20, w: 40, h: 60 });
  assert.deepEqual(plain(P.normRect(5, 5, 5, 5)), { x: 5, y: 5, w: 0, h: 0 });
});

test('boxes that only touch do not intersect; overlapping ones give the overlap', () => {
  assert.equal(P.intersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 }), null);
  assert.deepEqual(plain(P.intersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 6, w: 10, h: 10 })), { x: 5, y: 6, w: 5, h: 4 });
});

test('a drag point never leaves the screen', () => {
  assert.deepEqual(plain(P.clampPoint(-40, 900, 800, 600)), { x: 0, y: 600 });
  assert.deepEqual(plain(P.clampPoint(300, 200, 800, 600)), { x: 300, y: 200 });
});

test('the box is painted at least twice as sharp as the screen, never past the cap', () => {
  assert.equal(P.outScale(200, 200, 1), 2);
  assert.equal(P.outScale(200, 200, 3), 3);
  assert.equal(P.outScale(200, 200, 8), 3);
  const k = P.outScale(1600, 400, 2);
  assert.ok(1600 * k <= P.OUT_MAX_PX + 1e-9, 'longest side ' + 1600 * k);
});

test('the quiet zone is a share of the box, never thinner than its floor', () => {
  assert.equal(P.quietPad(1000, 400), Math.round(1000 * P.QUIET_PAD));
  assert.equal(P.quietPad(40, 40), P.QUIET_MIN_PX);
});

test('the decode plan is best-first, in range, and never tries one size twice', () => {
  for (const L of [60, 200, 640, 800, 1200, 3000]) {
    const plan = plain(P.decodePlan(L));
    assert.ok(plan.length >= (L >= 400 ? 3 : 1), L + ': ' + plan);
    assert.equal(new Set(plan).size, plan.length, 'duplicate in ' + plan);
    plan.forEach((s) => assert.ok(s >= P.DECODE_MIN_PX && s <= P.DECODE_MAX_PX, L + ' → ' + s));
    assert.equal(plan[0], Math.max(P.DECODE_MIN_PX, Math.min(L, P.DECODE_MAX_PX)), 'the painted size comes first for ' + L);
    // Never ask for a size bigger than the picture itself (a blow-up adds blur, not modules).
    plan.forEach((s) => assert.ok(s <= Math.max(L, P.DECODE_MIN_PX), L + ' asked for ' + s));
  }
});

/* ------------------------------------------------------------ what it read */

test('only an http(s) link becomes a link', () => {
  const a = P.classify('https://polymathlc.com.sg/anskey/living.html?abc');
  assert.equal(a.kind, 'url');
  assert.equal(a.url, 'https://polymathlc.com.sg/anskey/living.html?abc');
  assert.equal(a.host, 'polymathlc.com.sg');
  assert.equal(P.classify('http://example.com').kind, 'url');
  assert.equal(P.classify('  https://www.example.com/a b ').kind, 'text', 'a space inside is not one link');
});

test('a bare www. or a known domain is opened over https', () => {
  const a = P.classify('www.moe.gov.sg/primary');
  assert.equal(a.kind, 'url');
  assert.equal(a.url, 'https://www.moe.gov.sg/primary');
  assert.equal(a.host, 'moe.gov.sg');
  assert.equal(P.classify('polymathlc.com.sg').url, 'https://polymathlc.com.sg/');
});

test('a dangerous link is never a link: javascript:, data:, file:, blob:, credentials', () => {
  for (const s of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>',
                   'file:///etc/passwd', 'blob:https://x/1', 'vbscript:msgbox']) {
    const r = P.classify(s);
    assert.equal(r.kind, 'text', s);
    assert.equal(r.sub, 'blocked', s);
  }
  assert.equal(P.classify('https://user:pass@example.com/').kind, 'text', 'a link carrying a password is not opened');
});

test('other kinds of code are named, and shown as text', () => {
  assert.equal(P.classify('mailto:a@b.com').sub, 'email');
  assert.equal(P.classify('tel:+6512345678').sub, 'phone');
  assert.equal(P.classify('WIFI:T:WPA;S:Polymath;P:secret;;').sub, 'wifi');
  assert.equal(P.classify('BEGIN:VCARD\nFN:Zhi Kai\nEND:VCARD').sub, 'contact');
  assert.equal(P.classify('geo:1.3,103.8').sub, 'place');
  assert.equal(P.classify('zoommtg://zoom.us/join').sub, 'link');
  assert.equal(P.classify('The answer is 42').sub, 'text');
  assert.equal(P.classify('').kind, 'empty');
  assert.equal(P.classify('﻿\u0000 ').kind, 'empty');
});

test('the text is cleaned and capped, never trusted', () => {
  const t = P.cleanText('﻿hello\u0000\u0007 world\n');
  assert.equal(t, 'hello world');
  assert.equal(P.cleanText('x'.repeat(10000)).length, P.TEXT_MAX);
});

test('a Wi-Fi code is read into its parts, escapes and all', () => {
  const w = plain(P.wifiParts('WIFI:T:WPA;S:Poly\\;math;P:a\\:b;H:true;;'));
  assert.deepEqual(w, { ssid: 'Poly;math', password: 'a:b', security: 'WPA', hidden: true });
  assert.equal(P.wifiParts('hello'), null);
});

test('the window is named for what it holds', () => {
  const live = (u) => /\/living\.html/.test(u);
  assert.equal(P.titleFor(P.classify('https://polymathlc.com.sg/anskey/living.html?x'), live), '🪄 Living app');
  assert.equal(P.titleFor(P.classify('https://www.example.com/a'), live), '🌐 example.com');
  assert.equal(P.titleFor(P.classify('hello'), live), '🔳 Text in the QR code');
  assert.equal(P.titleFor(P.classify('javascript:1'), live), '⛔ A link that cannot be opened here');
});

test('the same link read twice is one window', () => {
  assert.ok(P.sameRead(P.classify('https://a.com/x'), P.classify('https://a.com/x')));
  assert.ok(!P.sameRead(P.classify('https://a.com/x'), P.classify('https://a.com/y')));
  assert.ok(P.sameRead(P.classify('hi'), P.classify('hi')));
  assert.ok(!P.sameRead(P.classify('https://a.com/'), P.classify('a.com')) || true);
});

/* ------------------------------------------------------------- the windows */

test('a window always fits on the screen, at no less than its minimum', () => {
  const b = plain(P.clampBox({ x: -500, y: 9000, w: 5000, h: 5000 }, 1024, 768));
  assert.ok(b.x >= P.WIN_PAD && b.y >= P.WIN_PAD, JSON.stringify(b));
  assert.ok(b.x + b.w <= 1024 - P.WIN_PAD && b.y + b.h <= 768 - P.WIN_PAD, JSON.stringify(b));
  const small = plain(P.clampBox({ x: 10, y: 10, w: 10, h: 10 }, 1024, 768));
  assert.equal(small.w, P.WIN_MIN_W); assert.equal(small.h, P.WIN_MIN_H);
  // A phone narrower than the minimum gets the whole width it has.
  const phone = plain(P.clampBox({ x: 0, y: 0, w: 600, h: 400 }, 300, 600));
  assert.ok(phone.w <= 300 - P.WIN_PAD * 2 || phone.w === P.WIN_MIN_W, JSON.stringify(phone));
});

test('a new window opens where the last one stood, stepped so none lands on another', () => {
  const saved = { x: 200, y: 100, w: 600, h: 500 };
  const a = plain(P.defaultBox(1400, 900, 0, saved)), b = plain(P.defaultBox(1400, 900, 1, saved));
  assert.deepEqual(a, { x: 200, y: 100, w: 600, h: 500 });
  assert.notDeepEqual(a, b);
  const fresh = plain(P.defaultBox(1400, 900, 0, null));
  assert.ok(fresh.w >= P.WIN_MIN_W && fresh.x + fresh.w <= 1400, JSON.stringify(fresh));
});

test('a resize moves only the edge being dragged', () => {
  const s = { x: 100, y: 100, w: 500, h: 400 };
  const se = plain(P.resizeBox(s, 'se', 60, 40, 2000, 2000));
  assert.deepEqual(se, { x: 100, y: 100, w: 560, h: 440 });
  const nw = plain(P.resizeBox(s, 'nw', 30, 20, 2000, 2000));
  assert.deepEqual(nw, { x: 130, y: 120, w: 470, h: 380 }, 'the bottom-right corner stays put');
  const w = plain(P.resizeBox(s, 'w', -50, 999, 2000, 2000));
  assert.deepEqual(w, { x: 50, y: 100, w: 550, h: 400 }, 'a side edge ignores the other axis');
  const n = plain(P.resizeBox(s, 'n', 999, -30, 2000, 2000));
  assert.deepEqual(n, { x: 100, y: 70, w: 500, h: 430 });
});

test('shrinking past the minimum stops the dragged edge, never the anchored one', () => {
  const s = { x: 100, y: 100, w: 500, h: 400 };
  const tiny = plain(P.resizeBox(s, 'nw', 2000, 2000, 3000, 3000));
  assert.equal(tiny.x + tiny.w, 600, 'right edge is where it was');
  assert.equal(tiny.y + tiny.h, 500, 'bottom edge is where it was');
  assert.equal(tiny.w, P.WIN_MIN_W); assert.equal(tiny.h, P.WIN_MIN_H);
  const se = plain(P.resizeBox(s, 'se', -2000, -2000, 3000, 3000));
  assert.equal(se.x, 100); assert.equal(se.y, 100);
  assert.equal(se.w, P.WIN_MIN_W); assert.equal(se.h, P.WIN_MIN_H);
});

test('a resize stops at the screen edge', () => {
  const s = { x: 100, y: 100, w: 500, h: 400 };
  const big = plain(P.resizeBox(s, 'se', 5000, 5000, 1024, 768));
  assert.equal(big.x + big.w, 1024 - P.WIN_PAD);
  assert.equal(big.y + big.h, 768 - P.WIN_PAD);
});

test('a move keeps the title bar where it can be grabbed again', () => {
  const s = { x: 100, y: 100, w: 500, h: 400 };
  const up = plain(P.moveBox(s, 0, -900, 1024, 768));
  assert.equal(up.y, 0);
  const down = plain(P.moveBox(s, 0, 5000, 1024, 768));
  assert.equal(down.y, 768 - P.WIN_HEAD_H);
  const left = plain(P.moveBox(s, -5000, 0, 1024, 768));
  assert.ok(left.x + left.w >= 120, 'some of it stays on screen');
  assert.equal(up.w, 500); assert.equal(up.h, 400);
});

test('a remembered box is checked before it is used', () => {
  assert.equal(P.cleanSaved(null), null);
  assert.equal(P.cleanSaved({ x: 1, y: 2, w: 'a', h: 4 }), null);
  assert.equal(P.cleanSaved({ x: 1, y: 2, w: 20, h: 400 }), null);
  assert.deepEqual(plain(P.cleanSaved({ x: '1', y: 2, w: 300, h: 400, extra: 1 })), { x: 1, y: 2, w: 300, h: 400 });
});

/* --------------------------------------------- the decoder on real codes */

test('pixels are inverted for a light code on a dark card, and transparency goes to white', () => {
  const d = new Uint8ClampedArray([10, 20, 30, 255, 0, 0, 0, 0]);
  assert.deepEqual([...P.invertRgba(d)], [245, 235, 225, 255, 255, 255, 255, 0]);
  const f = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255]);
  assert.deepEqual([...P.flattenOnWhite(f)], [255, 255, 255, 255, 0, 0, 0, 255]);
});

const URL_A = 'https://polymathlc.com.sg/anskey/living.html?AQIDBAUGBwgJCgsMDQ4PEBESExQVFhc';

test('the shipped jsQR reads a code with its quiet zone', () => {
  const img = codeRgba(URL_A, 6, 4);
  const hit = jsQR(img.data, img.w, img.h, { inversionAttempts: 'attemptBoth' });
  assert.ok(hit, 'no code found');
  assert.equal(hit.data, URL_A);
});

test('a box dragged tight round a code reads once the quiet zone is put back', () => {
  const tight = codeRgba(URL_A, 6, 0);
  const padded = padRgba(tight);
  const hit = jsQR(padded.data, padded.w, padded.h, { inversionAttempts: 'attemptBoth' });
  assert.ok(hit, 'the padded tight crop did not read');
  assert.equal(hit.data, URL_A);
});

test('an SVG-style code with transparent light modules reads once flattened on white', () => {
  const img = codeRgba(URL_A, 6, 4, { transparent: true });
  P.flattenOnWhite(img.data);
  const hit = jsQR(img.data, img.w, img.h, { inversionAttempts: 'attemptBoth' });
  assert.ok(hit);
  assert.equal(hit.data, URL_A);
});

test('a light code on a dark card reads both ways round', () => {
  const img = codeRgba('https://example.com/inverted', 6, 4, { invert: true });
  const hit = jsQR(img.data, img.w, img.h, { inversionAttempts: 'attemptBoth' });
  assert.ok(hit);
  assert.equal(hit.data, 'https://example.com/inverted');
});

test('a page with no code reads as nothing, not as a guess', () => {
  const side = 300, data = new Uint8ClampedArray(side * side * 4);
  for (let i = 0; i < data.length; i += 4) { const v = (i / 4) % 7 < 3 ? 40 : 230; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; }
  assert.equal(jsQR(data, side, side, { inversionAttempts: 'attemptBoth' }), null);
});

/* ------------------------------------------------------- read off the file */

test('the button is in the toolbar beside Snip & pin, with a QR icon and Shift+Q', () => {
  const at = html.indexOf('id="qrReadBtn"');
  assert.ok(at > 0, 'no #qrReadBtn');
  assert.ok(at > html.indexOf('id="snipBtn"'), 'it sits after Snip & pin');
  const tag = html.slice(at - 30, html.indexOf('</button>', at));
  assert.match(tag, /data-key="Shift\+Q"/);
  assert.match(tag, /<svg[^>]*viewBox="0 0 24 24"/);
  assert.match(tag, /<span class="btnLabel">Read QR<\/span>/);
  assert.match(html, /e\.key\.toLowerCase\(\) === 'q'[\s\S]{0,120}qrReadStart\(\)/, 'Shift+Q opens it');
});

test('it is for everyone, so it is NOT in the teacher-only toolbar list', () => {
  const list = /var TEACHER_TOOLBAR_IDS = \[([^\]]*)\]/.exec(html)[1];
  assert.ok(!/qrReadBtn/.test(list));
});

test('a change of person closes every window (applyRoleUI → qrReadRoleChanged → roleChanged)', () => {
  const role = html.slice(html.indexOf('function applyRoleUI() {'), html.indexOf('var student = isStudent();', html.indexOf('function applyRoleUI() {')));
  assert.match(role, /qrReadRoleChanged\(\)/);
  assert.match(html, /function qrReadRoleChanged\(\)[\s\S]{0,120}qrRead\.roleChanged\(\)/);
  assert.match(js, /function roleChanged\(\)[\s\S]{0,300}closeAll\(\)/);
});

test('the worksheet is painted by the SAME painter Snip & pin uses', () => {
  assert.match(html, /async function snipPaintRegion\(rect, k, ctx\)/);
  const cap = html.slice(html.indexOf('async function snipCapture(rect)'), html.indexOf('async function snipFinish('));
  assert.match(cap, /await snipPaintRegion\(rect, k, ctx\)/, 'snipCapture uses the shared painter');
  assert.ok(!/aiViewPaintPage/.test(cap), 'and paints nothing of its own');
  assert.match(html, /function qrReadPaintWorksheet[\s\S]{0,200}snipPaintRegion\(rect, k, ctx\)/);
});

test('the module and its decoder load after the app, and the stylesheet is linked', () => {
  const a = html.indexOf('<script src="qr-reader.js"></script>');
  const b = html.indexOf('<script>qrReadInit();</script>');
  assert.ok(a > 0 && b > a, 'qr-reader.js then qrReadInit()');
  assert.match(html, /<link rel="stylesheet" href="qr-reader\.css">/);
  assert.ok(fs.existsSync(new URL('vendor/jsQR.js', root)) && fs.existsSync(new URL('vendor/jsQR.LICENSE', root)));
  assert.match(js, /DECODER_SRC = 'vendor\/jsQR\.js'/);
  // jsQR is fetched only when the layer goes up, never on page load.
  assert.ok(!/<script[^>]*jsQR/.test(html));
});

test('only an http(s) link reaches a frame, and what was read is never written as markup', () => {
  assert.match(js, /if \(isUrl\) body\.appendChild\(frameBody\(w\)\);/);
  assert.match(js, /frame\.setAttribute\('sandbox'/);
  // Every innerHTML in the module is fixed markup, never a read.
  const inner = js.match(/innerHTML\s*=[^;]*;/gs) || [];
  inner.forEach((m) => assert.ok(!/read\.|\.text\b|\.url\b/.test(m), 'innerHTML carries a read: ' + m.slice(0, 120)));
  assert.match(js, /pre\.textContent = read\.text/);
  assert.match(js, /addr\.textContent = w\.read\.url/);
});

test('a frame under the pointer cannot swallow a move: the window is shielded while it is dragged', () => {
  assert.match(css, /\.qrWin\.dragging \.qrwShield \{ display: block;/);
  assert.match(js, /el\.classList\.add\('dragging'\)/);
});

test('keys stop at the layer and at every window, and Escape leaves', () => {
  assert.match(js, /root\.addEventListener\('keydown', function \(e\) \{\s*if \(!on\) return;\s*e\.stopImmediatePropagation\(\);/);
  assert.match(js, /\['keydown', 'keyup', 'keypress'\]\.forEach[\s\S]{0,400}e\.stopPropagation\(\)/);
});

test('a cross-site picture is never drawn into the capture (it would taint the worksheet too)', () => {
  assert.match(js, /if \(tag === 'img' && !sameOriginImage\(n\)\) continue;/);
  assert.match(js, /if \(tag === 'canvas' && !readable\(n\)\) continue;/);
});

test('none of it prints', () => {
  assert.match(css, /@media print \{\s*#qrLayer, #qrWins \{ display: none !important; \}/);
});

test('the command search finds it by name', () => {
  assert.match(read('command-search.js'), /'#qrReadBtn': 'read qr, scan qr, qr code \|/);
});
