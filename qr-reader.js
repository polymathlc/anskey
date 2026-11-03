/* =====================================================================
   🔳 READ QR — drag over a QR code, open what it points to in a window
   ---------------------------------------------------------------------
   The 🔳 Read QR button (Shift+Q) puts a drag layer over the whole screen.
   Drag a box round a QR code — on the worksheet, on a pinned snip, on a
   living app's own code card, anywhere a picture is showing — and the code
   is read and opened in a window INSIDE the app: moved by its title bar,
   resized from any edge or corner, maximised, minimised, reloaded, opened
   in a new tab, its link copied, and closed. Several can be open at once.

   - THE PICTURE IS PAINTED, NOT SCREEN-GRABBED. The worksheet under the box
     is painted afresh by the app (`env.paintWorksheet`, the same painter
     📸 Snip & pin uses: the PDF page plus every annotation, note card and
     pasted picture on it), sharper than the screen, so a small code printed
     in a corner still reads. Every other picture under the box — an <img>,
     a <canvas>, an inline <svg> (the living app window's 📲 code is one) —
     is drawn on top at its place on screen. No screen-share prompt, ever.
   - A TIGHT BOX STILL READS. A QR code needs a white "quiet zone" round it,
     and a box dragged snugly round the code cuts it off. Every attempt is
     made on the picture padded with white (`pure.QUIET_PAD`), at several
     sizes (`pure.decodePlan`), both ways round (a light code on a dark
     card), with the browser's own BarcodeDetector first where there is one
     and the vendored jsQR (Apache-2.0, `vendor/jsQR.js`, loaded the first
     time the layer goes up) everywhere else.
   - ONLY A WEB LINK GOES IN A FRAME. `pure.classify` is the one door: an
     http(s) link (or a bare `www.` address) opens in the window; anything
     else — plain text, a mailto:, a phone number, a Wi-Fi code, a
     javascript: or data: link — is shown as TEXT with a Copy button, and
     never navigated to. The text is set with textContent, never as markup.
   - A SITE MAY REFUSE TO BE SHOWN INSIDE ANOTHER APP (X-Frame-Options /
     frame-ancestors). Nothing in the page can see that refusal, so the
     window always carries ↗ Open in a new tab, and says so under the frame.
   - THE FRAME IS SANDBOXED, and the window is shielded while it is moved or
     resized (a frame under the pointer swallows every move event, and the
     drag stops dead the moment it crosses the page inside).
   - WINDOWS ARE THE PERSON'S, NOT THE WORKSHEET'S. A window survives a
     change of worksheet (a link read off last week's sheet is still a link),
     but every window closes when the PERSON changes (`roleChanged`, from
     applyRoleUI): a handover must not leave the teacher's open page on the
     next person's screen. Nothing read is ever stored; only where the last
     window stood (`WIN_STORE`) is remembered on this device.
   - Every key pressed inside a window, and every key while the layer is up,
     stops there: the worksheet's one-letter tool shortcuts never see it.
   ===================================================================== */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------
     Constants
     --------------------------------------------------------------- */
  var WIN_STORE = 'polymath.qrReaderWin.v1';
  var MAX_WINDOWS = 4;
  var MIN_DRAG_PX = 14;          // a smaller drag is a tap, not a box
  var WIN_MIN_W = 300;
  var WIN_MIN_H = 220;
  var WIN_HEAD_H = 40;           // = .qrwHead height
  var WIN_PAD = 8;               // never closer to the screen's edge than this
  var QUIET_PAD = 0.18;          // white margin added round the box, as a share of its longer side
  var QUIET_MIN_PX = 24;
  var OUT_MAX_PX = 1600;         // the longest side of the painted box
  var DECODE_MIN_PX = 120;       // never try a size smaller than this
  var DECODE_MAX_PX = 1400;      // …or larger than this
  var TEXT_MAX = 4000;           // a QR code holds at most ~4,300 characters
  var DECODER_SRC = 'vendor/jsQR.js';
  var LOAD_HINT_MS = 9000;       // a frame silent this long gets the "open in a new tab" nudge

  /* ===============================================================
     PURE — no DOM, no window. tools/qr-reader-tests.mjs runs these.
     =============================================================== */

  function normRect(x0, y0, x1, y1) {
    return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
  }

  function intersect(a, b) {
    var x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    var r = Math.min(a.x + a.w, b.x + b.w), btm = Math.min(a.y + a.h, b.y + b.h);
    if (r - x <= 0 || btm - y <= 0) return null;
    return { x: x, y: y, w: r - x, h: btm - y };
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* A drag point kept inside the screen. */
  function clampPoint(x, y, vw, vh) {
    return { x: clamp(x, 0, Math.max(0, vw)), y: clamp(y, 0, Math.max(0, vh)) };
  }

  /* Output pixels per screen pixel for the painted box: at least 2 (and the
     screen's own density, up to 3) so a small code keeps crisp modules, never
     past OUT_MAX_PX on the longer side. */
  function outScale(w, h, dpr) {
    var want = Math.max(2, Math.min(3, dpr || 1));
    return Math.max(0.25, Math.min(want, OUT_MAX_PX / Math.max(1, w, h)));
  }

  /* The white margin round the painted box, in output pixels. */
  function quietPad(w, h) {
    return Math.max(QUIET_MIN_PX, Math.round(Math.max(w, h) * QUIET_PAD));
  }

  /* The sizes to try, longest side in pixels, best first. The painted size
     itself first (sharpest), then a size near 800 (jsQR's sweet spot: big
     enough that a module is several pixels, small enough that the binariser's
     blocks see the whole finder pattern), then smaller ones — a large blurred
     code often reads only once it is scaled down. Never a duplicate, never
     outside [DECODE_MIN_PX, DECODE_MAX_PX]. */
  function decodePlan(longSide) {
    var L = Math.max(1, Math.round(longSide || 0));
    var want = [Math.min(L, DECODE_MAX_PX), 800, 560, 400, 280, DECODE_MIN_PX];
    var seen = {}, out = [];
    want.forEach(function (s) {
      var v = Math.round(clamp(Math.min(s, Math.max(L, DECODE_MIN_PX)), DECODE_MIN_PX, DECODE_MAX_PX));
      if (seen[v]) return;
      seen[v] = true;
      out.push(v);
    });
    return out;
  }

  /* What a decoded text IS. The one door between a QR code and the window:
     only http(s) is ever put in a frame or opened. */
  var URL_RE = /^https?:\/\/[^\s<>"'`]+$/i;
  var WWW_RE = /^www\.[a-z0-9-]+(\.[a-z0-9-]+)+([/?#][^\s<>"'`]*)?$/i;
  var BARE_DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|edu|gov|io|sg|co|app|dev|me|info|uk|au|my|ai)(?:[/?#][^\s<>"'`]*)?$/i;
  function cleanText(text) {
    var s = String(text == null ? '' : text);
    // Strip the control characters a code sometimes carries (a trailing NUL,
    // a BOM) but keep newlines and tabs, which are real text.
    s = s.replace(/^﻿/, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    return s.trim().slice(0, TEXT_MAX);
  }
  function classify(text) {
    var s = cleanText(text);
    if (!s) return { kind: 'empty', text: '' };
    var candidate = null;
    if (URL_RE.test(s)) candidate = s;
    else if (WWW_RE.test(s) || BARE_DOMAIN_RE.test(s)) candidate = 'https://' + s;
    if (candidate) {
      try {
        var u = new URL(candidate);
        if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname && !u.username && !u.password) {
          return { kind: 'url', url: u.href, host: u.hostname.replace(/^www\./i, ''), text: s };
        }
      } catch (e) { /* fall through to text */ }
    }
    var m = /^([a-z][a-z0-9+.-]{1,20}):/i.exec(s);
    var scheme = m ? m[1].toLowerCase() : '';
    var sub = 'text';
    if (scheme === 'mailto') sub = 'email';
    else if (scheme === 'tel' || scheme === 'sms' || scheme === 'smsto') sub = 'phone';
    else if (scheme === 'wifi') sub = 'wifi';
    else if (scheme === 'geo') sub = 'place';
    else if (/^begin:vcard/i.test(s) || scheme === 'mecard') sub = 'contact';
    else if (scheme === 'javascript' || scheme === 'data' || scheme === 'vbscript' || scheme === 'file' || scheme === 'blob') sub = 'blocked';
    else if (scheme && scheme !== 'http' && scheme !== 'https') sub = 'link';
    return { kind: 'text', sub: sub, text: s };
  }

  /* The window's title for a read. */
  var TEXT_TITLES = {
    text: '🔳 Text in the QR code', email: '✉️ An email address', phone: '📞 A phone number',
    wifi: '📶 A Wi-Fi network', place: '📍 A place', contact: '👤 A contact card',
    blocked: '⛔ A link that cannot be opened here', link: '🔗 A link for another app'
  };
  function titleFor(read, livingTest) {
    if (!read) return '🔳 QR code';
    if (read.kind === 'url') {
      if (typeof livingTest === 'function' && livingTest(read.url)) return '🪄 Living app';
      return '🌐 ' + read.host;
    }
    return TEXT_TITLES[read.sub] || TEXT_TITLES.text;
  }

  /* A Wi-Fi code's parts, shown in words (WIFI:T:WPA;S:name;P:pass;;). */
  function wifiParts(text) {
    var s = String(text || '');
    if (!/^wifi:/i.test(s)) return null;
    var out = { ssid: '', password: '', security: '', hidden: false };
    var body = s.slice(5), re = /([A-Z]):((?:\\.|[^;])*);/gi, m;
    while ((m = re.exec(body))) {
      var v = m[2].replace(/\\(.)/g, '$1');
      var k = m[1].toUpperCase();
      if (k === 'S') out.ssid = v;
      else if (k === 'P') out.password = v;
      else if (k === 'T') out.security = v;
      else if (k === 'H') out.hidden = /^true$/i.test(v);
    }
    return out;
  }

  /* A new window's box: the last one remembered, else most of the space to
     the right of the worksheet's middle; stepped for each window already up
     so none lands exactly on another. */
  function defaultBox(vw, vh, n, saved) {
    var w, h, x, y;
    if (saved && isFinite(saved.w) && isFinite(saved.h)) {
      w = saved.w; h = saved.h; x = saved.x; y = saved.y;
    } else {
      w = Math.min(820, Math.max(WIN_MIN_W, vw * 0.52));
      h = Math.min(760, Math.max(WIN_MIN_H, vh * 0.72));
      x = vw - w - 24; y = Math.max(WIN_PAD, (vh - h) / 2);
    }
    var step = (n % 5) * 30;
    return clampBox({ x: x - step, y: y + step, w: w, h: h }, vw, vh);
  }

  /* Keep a window's box on screen: never smaller than its minimum, never
     bigger than the screen, never off any edge. */
  function clampBox(b, vw, vh) {
    var maxW = Math.max(WIN_MIN_W, vw - WIN_PAD * 2);
    var maxH = Math.max(WIN_MIN_H, vh - WIN_PAD * 2);
    var w = clamp(isFinite(b.w) ? b.w : 600, Math.min(WIN_MIN_W, maxW), maxW);
    var h = clamp(isFinite(b.h) ? b.h : 480, Math.min(WIN_MIN_H, maxH), maxH);
    var x = clamp(isFinite(b.x) ? b.x : WIN_PAD, WIN_PAD, Math.max(WIN_PAD, vw - w - WIN_PAD));
    var y = clamp(isFinite(b.y) ? b.y : WIN_PAD, WIN_PAD, Math.max(WIN_PAD, vh - h - WIN_PAD));
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  }

  /* A drag on an edge or corner. `edge` is any of n, s, e, w, ne, nw, se, sw.
     The opposite edge stays exactly where it was, and the minimum size is
     honoured by moving the dragged edge back — never by moving the anchored
     one (a window that creeps away under the pointer). */
  function resizeBox(start, edge, dx, dy, vw, vh) {
    var L = start.x, T = start.y, R = start.x + start.w, B = start.y + start.h;
    var e = String(edge || '');
    if (e.indexOf('w') !== -1) L = Math.min(L + dx, R - WIN_MIN_W);
    if (e.indexOf('e') !== -1) R = Math.max(R + dx, L + WIN_MIN_W);
    if (e.indexOf('n') !== -1) T = Math.min(T + dy, B - WIN_MIN_H);
    if (e.indexOf('s') !== -1) B = Math.max(B + dy, T + WIN_MIN_H);
    L = Math.max(WIN_PAD, L); T = Math.max(WIN_PAD, T);
    if (isFinite(vw)) R = Math.min(vw - WIN_PAD, R);
    if (isFinite(vh)) B = Math.min(vh - WIN_PAD, B);
    return { x: Math.round(L), y: Math.round(T), w: Math.round(R - L), h: Math.round(B - T) };
  }

  /* A move keeps at least the title bar's grab on screen. */
  function moveBox(start, dx, dy, vw, vh) {
    var x = start.x + dx, y = start.y + dy;
    x = clamp(x, -start.w + 120, Math.max(0, vw - 120));
    y = clamp(y, 0, Math.max(0, vh - WIN_HEAD_H));
    return { x: Math.round(x), y: Math.round(y), w: start.w, h: start.h };
  }

  function cleanSaved(v) {
    if (!v || typeof v !== 'object') return null;
    var out = {};
    ['x', 'y', 'w', 'h'].forEach(function (k) { out[k] = +v[k]; });
    if (!['x', 'y', 'w', 'h'].every(function (k) { return isFinite(out[k]); })) return null;
    if (out.w < 100 || out.h < 100 || out.w > 10000 || out.h > 10000) return null;
    return out;
  }

  /* Is the same link already open? The window is raised rather than opened
     twice (a teacher dragging over the same code twice wants the one window). */
  function sameRead(a, b) {
    if (!a || !b || a.kind !== b.kind) return false;
    return a.kind === 'url' ? a.url === b.url : a.text === b.text;
  }

  /* Turn RGBA pixels the other way round (for a light code on a dark card).
     Pure over a Uint8ClampedArray, so the tests can run it. */
  function invertRgba(data) {
    var out = new Uint8ClampedArray(data.length);
    for (var i = 0; i < data.length; i += 4) {
      out[i] = 255 - data[i]; out[i + 1] = 255 - data[i + 1]; out[i + 2] = 255 - data[i + 2]; out[i + 3] = data[i + 3];
    }
    return out;
  }

  /* Flatten transparency onto white (an SVG code has transparent light
     modules, which read as BLACK to a decoder looking at raw RGB). */
  function flattenOnWhite(data) {
    for (var i = 0; i < data.length; i += 4) {
      var a = data[i + 3] / 255;
      if (a >= 1) continue;
      data[i] = Math.round(data[i] * a + 255 * (1 - a));
      data[i + 1] = Math.round(data[i + 1] * a + 255 * (1 - a));
      data[i + 2] = Math.round(data[i + 2] * a + 255 * (1 - a));
      data[i + 3] = 255;
    }
    return data;
  }

  var pure = {
    WIN_STORE: WIN_STORE, MAX_WINDOWS: MAX_WINDOWS, MIN_DRAG_PX: MIN_DRAG_PX,
    WIN_MIN_W: WIN_MIN_W, WIN_MIN_H: WIN_MIN_H, WIN_HEAD_H: WIN_HEAD_H, WIN_PAD: WIN_PAD,
    QUIET_PAD: QUIET_PAD, QUIET_MIN_PX: QUIET_MIN_PX, OUT_MAX_PX: OUT_MAX_PX,
    DECODE_MIN_PX: DECODE_MIN_PX, DECODE_MAX_PX: DECODE_MAX_PX, TEXT_MAX: TEXT_MAX,
    DECODER_SRC: DECODER_SRC, LOAD_HINT_MS: LOAD_HINT_MS,
    normRect: normRect, intersect: intersect, clampPoint: clampPoint, outScale: outScale,
    quietPad: quietPad, decodePlan: decodePlan, cleanText: cleanText, classify: classify,
    titleFor: titleFor, wifiParts: wifiParts, defaultBox: defaultBox, clampBox: clampBox,
    resizeBox: resizeBox, moveBox: moveBox, cleanSaved: cleanSaved, sameRead: sameRead,
    invertRgba: invertRgba, flattenOnWhite: flattenOnWhite
  };

  /* ===============================================================
     DECODING — the browser's own detector first, jsQR everywhere.
     =============================================================== */

  var decoderLoading = null;
  function loadDecoder(src) {
    if (root.jsQR) return Promise.resolve(root.jsQR);
    if (decoderLoading) return decoderLoading;
    decoderLoading = new Promise(function (resolve, reject) {
      var doc = root.document;
      if (!doc) { reject(new Error('no document')); return; }
      var s = doc.createElement('script');
      s.src = src || DECODER_SRC;
      s.async = true;
      s.onload = function () {
        if (root.jsQR) resolve(root.jsQR);
        else { decoderLoading = null; reject(new Error('The QR reader did not load')); }
      };
      s.onerror = function () { decoderLoading = null; reject(new Error('The QR reader could not be loaded — check the connection and try again')); };
      doc.head.appendChild(s);
    });
    return decoderLoading;
  }

  var nativeDetector;   // undefined = not asked yet, null = none
  async function getNativeDetector() {
    if (nativeDetector !== undefined) return nativeDetector;
    nativeDetector = null;
    try {
      if (typeof root.BarcodeDetector === 'function') {
        var formats = typeof root.BarcodeDetector.getSupportedFormats === 'function'
          ? await root.BarcodeDetector.getSupportedFormats() : ['qr_code'];
        if (formats.indexOf('qr_code') !== -1) nativeDetector = new root.BarcodeDetector({ formats: ['qr_code'] });
      }
    } catch (e) { nativeDetector = null; }
    return nativeDetector;
  }

  /* A canvas of `src` scaled so its longer side is `longSide`, with the white
     quiet zone round it, flattened onto white. */
  function paddedCanvas(src, longSide) {
    var doc = root.document;
    var k = longSide / Math.max(src.width, src.height);
    var w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
    var pad = quietPad(w, h);
    var c = doc.createElement('canvas');
    c.width = w + pad * 2; c.height = h + pad * 2;
    var g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = k < 1;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, src.width, src.height, pad, pad, w, h);
    return c;
  }

  /* Read a canvas. Resolves to the decoded text or null. */
  async function decodeCanvas(canvas, opts) {
    opts = opts || {};
    var plan = decodePlan(Math.max(canvas.width, canvas.height));
    var detector = opts.native === false ? null : await getNativeDetector();
    if (detector) {
      try {
        var found = await detector.detect(paddedCanvas(canvas, plan[0]));
        var best = pickLargest(found);
        if (best && best.rawValue) return { text: best.rawValue, by: 'native' };
      } catch (e) { /* fall back to jsQR */ }
    }
    var jsQR = await loadDecoder(opts.decoderSrc);
    for (var i = 0; i < plan.length; i++) {
      var c = paddedCanvas(canvas, plan[i]);
      try {
        var g = c.getContext('2d', { willReadFrequently: true });
        var img = g.getImageData(0, 0, c.width, c.height);
        flattenOnWhite(img.data);
        var hit = jsQR(img.data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
        if (hit && typeof hit.data === 'string' && hit.data.length) return { text: hit.data, by: 'jsqr', size: plan[i] };
        if (hit && hit.binaryData && hit.binaryData.length) {
          return { text: bytesToText(hit.binaryData), by: 'jsqr', size: plan[i] };
        }
      } catch (e) {
        if (e && e.name === 'SecurityError') throw new Error('That picture comes from another site, so it cannot be read here');
      } finally { c.width = c.height = 0; }
      if (opts.yield) await opts.yield();
    }
    return null;
  }

  function pickLargest(list) {
    if (!list || !list.length) return null;
    var best = null, area = -1;
    list.forEach(function (b) {
      var r = b.boundingBox || { width: 0, height: 0 };
      var a = (r.width || 0) * (r.height || 0);
      if (a > area) { area = a; best = b; }
    });
    return best;
  }

  function bytesToText(bytes) {
    try { return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes)); }
    catch (e) { return String.fromCharCode.apply(null, bytes.slice(0, TEXT_MAX)); }
  }

  /* ===============================================================
     THE FEATURE — the drag layer, the capture and the windows.
     =============================================================== */

  function create(env) {
    env = env || {};
    var doc = root.document;
    var allowed = env.allowed || function () { return true; };
    var toast = env.toast || function () {};
    var identity = env.identity || function () { return ''; };
    var livingTest = env.isLivingLink || null;

    var layer = null, box = null, hint = null, hintText = null;
    var host = null;
    var on = false, drag = null, busy = false, seq = 0;
    var wins = [];          // [{id, el, read, box, max, min, prev, frame, loadTimer}]
    var lastIdentity = identity();
    var btn = env.button ? env.button() : null;

    /* ---------- the layer ---------- */
    function buildLayer() {
      if (layer) return;
      layer = doc.createElement('div');
      layer.id = 'qrLayer';
      layer.hidden = true;
      layer.setAttribute('role', 'dialog');
      layer.setAttribute('aria-label', 'Read a QR code: drag a box round it');
      layer.innerHTML =
        '<div class="qrHint"><span class="qrHintIcon" aria-hidden="true">🔳</span>' +
          '<span class="qrHintText">Drag a box round the QR code. It opens in a window here.</span>' +
          '<button type="button" class="qrHintCancel">Cancel</button></div>' +
        '<div class="qrBox"><span class="qrBoxScan" aria-hidden="true"></span></div>';
      doc.body.appendChild(layer);
      box = layer.querySelector('.qrBox');
      hint = layer.querySelector('.qrHint');
      hintText = layer.querySelector('.qrHintText');
      var cancel = layer.querySelector('.qrHintCancel');
      cancel.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      cancel.addEventListener('click', function (e) { e.stopPropagation(); stop(); });

      layer.addEventListener('pointerdown', function (e) {
        if (!on || drag || busy || e.button > 0 || e.target.closest('.qrHint')) return;
        e.preventDefault();
        drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
        try { layer.setPointerCapture(e.pointerId); } catch (_) {}
        layer.classList.add('drawing');
        drawBox();
      });
      layer.addEventListener('pointermove', function (e) {
        if (!drag || e.pointerId !== drag.id) return;
        var p = clampPoint(e.clientX, e.clientY, root.innerWidth, viewportH());
        drag.x1 = p.x; drag.y1 = p.y;
        drawBox();
        e.preventDefault();
      });
      function end(e, keep) {
        if (!drag || e.pointerId !== drag.id) return;
        var r = normRect(drag.x0, drag.y0, drag.x1, drag.y1);
        drag = null;
        if (keep) finish(r);
        else { layer.classList.remove('drawing'); }
      }
      layer.addEventListener('pointerup', function (e) { end(e, true); });
      layer.addEventListener('pointercancel', function (e) { end(e, false); });
      layer.addEventListener('lostpointercapture', function (e) { if (drag && e.pointerId === drag.id) end(e, false); });
      // The worksheet can still be scrolled to the code while the layer is up.
      layer.addEventListener('wheel', function (e) {
        var area = env.scroller ? env.scroller() : null;
        if (area) area.scrollBy({ left: e.deltaX, top: e.deltaY });
        e.preventDefault();
      }, { passive: false });
    }

    function drawBox() {
      if (!drag || !box) return;
      var r = normRect(drag.x0, drag.y0, drag.x1, drag.y1);
      box.style.left = r.x + 'px'; box.style.top = r.y + 'px';
      box.style.width = r.w + 'px'; box.style.height = r.h + 'px';
    }

    function setHint(text, mode) {
      if (!hintText) return;
      hintText.textContent = text;
      hint.classList.toggle('busy', mode === 'busy');
      hint.classList.toggle('miss', mode === 'miss');
    }

    function start() {
      if (!allowed()) { toast('Sign in to read a QR code'); return false; }
      if (busy) return false;
      if (on) { stop(); return false; }
      buildLayer();
      if (env.beforeStart) { try { env.beforeStart(); } catch (e) {} }
      on = true;
      layer.hidden = false;
      layer.classList.remove('drawing', 'reading');
      setHint('Drag a box round the QR code. It opens in a window here.');
      if (btn) btn.classList.add('active');
      // Fetch the reader now, so it is ready by the time the drag ends.
      loadDecoder(env.decoderSrc).catch(function () {});
      return true;
    }

    function stop() {
      on = false; drag = null;
      if (layer) { layer.hidden = true; layer.classList.remove('drawing', 'reading'); }
      if (btn) btn.classList.remove('active');
    }

    /* ---------- capture ---------- */
    function viewportH() {
      return (root.visualViewport && root.visualViewport.height) || root.innerHeight;
    }

    /* Every picture on screen under the box that is not the worksheet: an
       <img>, a <canvas> or an inline <svg>, visible and not inside the layer
       or a QR window's own frame. */
    function picturesUnder(rect) {
      var out = [];
      var nodes = doc.querySelectorAll('img, canvas, svg');
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (layer && layer.contains(n)) continue;
        if (env.isWorksheetNode && env.isWorksheetNode(n)) continue;
        if (n.tagName.toLowerCase() === 'svg' && n.parentNode && n.parentNode.closest && n.parentNode.closest('svg')) continue;
        if (n.closest && n.closest('.qrwFrameWrap, #tooltip, .toolBtn, .btn, button')) continue;
        var r = n.getBoundingClientRect();
        if (r.width < 24 || r.height < 24) continue;
        var hit = intersect(rect, { x: r.left, y: r.top, w: r.width, h: r.height });
        if (!hit) continue;
        var cs = root.getComputedStyle(n);
        if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
        out.push({ node: n, rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
      }
      return out;
    }

    function svgImage(svg, w, h) {
      return new Promise(function (resolve, reject) {
        var clone = svg.cloneNode(true);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        if (!clone.getAttribute('width')) clone.setAttribute('width', String(Math.round(w)));
        if (!clone.getAttribute('height')) clone.setAttribute('height', String(Math.round(h)));
        // Inline the colours CSS gave it (a QR card's modules are coloured by class).
        var paths = svg.querySelectorAll('path, rect, circle, polygon');
        var cpaths = clone.querySelectorAll('path, rect, circle, polygon');
        for (var i = 0; i < paths.length && i < cpaths.length; i++) {
          var cs = root.getComputedStyle(paths[i]);
          if (cs.fill && !cpaths[i].getAttribute('fill')) cpaths[i].setAttribute('fill', cs.fill);
          if (cs.stroke && cs.stroke !== 'none' && !cpaths[i].getAttribute('stroke')) cpaths[i].setAttribute('stroke', cs.stroke);
        }
        var xml = new XMLSerializer().serializeToString(clone);
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error('svg')); };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      });
    }

    async function paintOthers(ctx, rect, k) {
      var list = picturesUnder(rect), drew = 0;
      for (var i = 0; i < list.length; i++) {
        var it = list[i], n = it.node, tag = n.tagName.toLowerCase();
        var dx = (it.rect.x - rect.x) * k, dy = (it.rect.y - rect.y) * k;
        var dw = it.rect.w * k, dh = it.rect.h * k;
        try {
          if (tag === 'img' && !sameOriginImage(n)) continue;
          if (tag === 'canvas' && !readable(n)) continue;
          if (tag === 'img') {
            if (!n.complete || !n.naturalWidth) continue;
            drawContained(ctx, n, n.naturalWidth, n.naturalHeight, dx, dy, dw, dh, root.getComputedStyle(n).objectFit);
          } else if (tag === 'canvas') {
            if (!n.width || !n.height) continue;
            ctx.drawImage(n, dx, dy, dw, dh);
          } else {
            var im = await svgImage(n, it.rect.w, it.rect.h);
            if (!readable(im)) continue;
            ctx.drawImage(im, dx, dy, dw, dh);
          }
          drew++;
        } catch (e) { /* a picture that cannot be drawn is skipped */ }
      }
      return drew;
    }

    /* A picture from another site would TAINT the whole capture (and with it
       the worksheet's own pixels, so a code that was right there could not be
       read). Only pictures the page owns are drawn. */
    function sameOriginImage(img) {
      var src = img.currentSrc || img.src || '';
      if (/^(data|blob):/i.test(src)) return true;
      try {
        var u = new URL(src, root.location.href);
        if (u.origin === root.location.origin && u.origin !== 'null') return true;
        if (root.location.protocol === 'file:' && u.protocol === 'file:') return true;
      } catch (e) { return false; }
      return img.crossOrigin === 'anonymous' && readable(img);
    }
    function readable(src) {
      var t = doc.createElement('canvas');
      t.width = t.height = 1;
      try {
        var g = t.getContext('2d');
        g.drawImage(src, 0, 0, 1, 1);
        g.getImageData(0, 0, 1, 1);
        return true;
      } catch (e) { return false; }
      finally { t.width = t.height = 0; }
    }

    /* An <img> drawn the way the page shows it (object-fit: contain keeps it
       letterboxed inside its box). */
    function drawContained(ctx, img, iw, ih, dx, dy, dw, dh, fit) {
      if (fit === 'contain' || fit === 'scale-down') {
        var s = Math.min(dw / iw, dh / ih);
        var w = iw * s, h = ih * s;
        ctx.drawImage(img, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h);
      } else ctx.drawImage(img, dx, dy, dw, dh);
    }

    async function capture(rect) {
      var k = outScale(rect.w, rect.h, root.devicePixelRatio);
      var c = doc.createElement('canvas');
      c.width = Math.max(1, Math.round(rect.w * k));
      c.height = Math.max(1, Math.round(rect.h * k));
      var ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      var drew = 0;
      if (env.paintWorksheet) {
        try { drew += (await env.paintWorksheet(rect, k, ctx)) ? 1 : 0; }
        catch (e) { /* the worksheet could not be painted; other pictures may still hold the code */ }
      }
      drew += await paintOthers(ctx, rect, k);
      return { canvas: c, drew: drew };
    }

    async function finish(rect) {
      if (!on) return;
      if (rect.w < MIN_DRAG_PX || rect.h < MIN_DRAG_PX) {
        layer.classList.remove('drawing');
        setHint('That was a tap — drag a box round the whole QR code.', 'miss');
        return;
      }
      busy = true;
      layer.classList.add('reading');
      setHint('Reading the QR code…', 'busy');
      var who = identity();
      var shot = null;
      try {
        shot = await capture(rect);
        if (!shot.drew) throw new Error('There is no picture under that box — drag round the QR code itself');
        var res = await decodeCanvas(shot.canvas, { decoderSrc: env.decoderSrc, native: env.native,
          yield: function () { return new Promise(function (r) { setTimeout(r, 0); }); } });
        if (who !== identity()) { stop(); return; }   // the person changed while it read
        if (!res) {
          layer.classList.remove('drawing', 'reading');
          setHint('No QR code found there. Drag a box round the whole code, corners and all.', 'miss');
          return;
        }
        stop();
        openRead(classify(res.text));
      } catch (e) {
        layer.classList.remove('drawing', 'reading');
        setHint(e && e.message ? e.message : 'That QR code could not be read', 'miss');
      } finally {
        busy = false;
        if (shot && shot.canvas) shot.canvas.width = shot.canvas.height = 0;
      }
    }

    /* ---------- windows ---------- */
    function buildHost() {
      if (host) return host;
      host = doc.createElement('div');
      host.id = 'qrWins';
      host.setAttribute('aria-live', 'polite');
      doc.body.appendChild(host);
      return host;
    }

    function readSaved() {
      try { return cleanSaved(JSON.parse(root.localStorage.getItem(WIN_STORE) || 'null')); }
      catch (e) { return null; }
    }
    function writeSaved(b) {
      try { root.localStorage.setItem(WIN_STORE, JSON.stringify({ x: b.x, y: b.y, w: b.w, h: b.h })); }
      catch (e) { /* storage blocked: the window still works, it just is not remembered */ }
    }

    function find(id) { for (var i = 0; i < wins.length; i++) if (wins[i].id === id) return wins[i]; return null; }

    function openRead(read) {
      if (!read || read.kind === 'empty') { toast('That QR code is empty'); return null; }
      for (var i = 0; i < wins.length; i++) {
        if (sameRead(wins[i].read, read)) {
          var w0 = wins[i];
          w0.min = false;
          apply(w0);
          raise(w0);
          flash(w0);
          toast('🔳 That one is already open');
          return w0.id;
        }
      }
      while (wins.length >= MAX_WINDOWS) close(wins[0].id, true);
      buildHost();
      var id = 'qrw' + (++seq) + Date.now().toString(36);
      var vw = root.innerWidth, vh = viewportH();
      var b = defaultBox(vw, vh, wins.length, readSaved());
      var w = { id: id, el: null, read: read, box: b, max: false, min: false, prev: null, frame: null, loadTimer: 0 };
      w.el = render(w);
      host.appendChild(w.el);
      wins.push(w);
      apply(w);
      if (env.onOpen) { try { env.onOpen(read); } catch (e) {} }
      return id;
    }

    function btnHtml(act, label, title) {
      return '<button type="button" class="qrwBtn" data-qrw="' + act + '" title="' + title + '" aria-label="' + title + '">' + label + '</button>';
    }

    function render(w) {
      var el = doc.createElement('div');
      el.className = 'qrWin';
      el.dataset.id = w.id;
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', 'QR code window');
      var isUrl = w.read.kind === 'url';
      el.innerHTML =
        '<div class="qrwHead" title="Drag to move · double-tap to fill the screen">' +
          '<span class="qrwTitle"></span>' +
          '<span class="qrwTools">' +
            (isUrl ? btnHtml('back', '←', 'Back to where the code pointed') + btnHtml('reload', '⟳', 'Reload') +
              btnHtml('open', '↗', 'Open in a new tab') : '') +
            btnHtml('copy', '📋', isUrl ? 'Copy the link' : 'Copy the text') +
            btnHtml('min', '–', 'Minimise to its title bar') +
            btnHtml('max', '▢', 'Fill the screen') +
            btnHtml('close', '✕', 'Close') +
          '</span>' +
        '</div>' +
        '<div class="qrwBody"></div>' +
        '<div class="qrwShield"></div>' +
        ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map(function (e) {
          return '<div class="qrwEdge qrwEdge-' + e + '" data-edge="' + e + '"></div>';
        }).join('') +
        '<div class="qrwGrip" data-edge="se" title="Drag to resize"></div>';
      el.querySelector('.qrwTitle').textContent = titleFor(w.read, livingTest);
      var body = el.querySelector('.qrwBody');
      if (isUrl) body.appendChild(frameBody(w));
      else body.appendChild(textBody(w));
      wire(el, w);
      return el;
    }

    function frameBody(w) {
      var wrap = doc.createElement('div');
      wrap.className = 'qrwFrameWrap';
      var bar = doc.createElement('div');
      bar.className = 'qrwUrl';
      var lock = doc.createElement('span');
      lock.className = 'qrwLock';
      lock.textContent = /^https:/i.test(w.read.url) ? '🔒' : '⚠️';
      lock.title = /^https:/i.test(w.read.url) ? 'A secure (https) link' : 'Not a secure link';
      var addr = doc.createElement('span');
      addr.className = 'qrwAddr';
      addr.textContent = w.read.url;
      addr.title = w.read.url;
      bar.appendChild(lock); bar.appendChild(addr);
      var stage = doc.createElement('div');
      stage.className = 'qrwStage loading';
      var spin = doc.createElement('div');
      spin.className = 'qrwSpin';
      spin.innerHTML = '<span class="qrwDot"></span><span class="qrwSpinText">Opening…</span>';
      var frame = doc.createElement('iframe');
      frame.className = 'qrwFrame';
      frame.title = w.read.url;
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads');
      frame.setAttribute('allow', 'fullscreen; clipboard-write; autoplay; encrypted-media; picture-in-picture');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.setAttribute('loading', 'eager');
      frame.addEventListener('load', function () {
        // The blank page a reload passes through is not the site arriving.
        if ((frame.getAttribute('src') || '') === 'about:blank') return;
        stage.classList.remove('loading');
        if (w.loadTimer) { clearTimeout(w.loadTimer); w.loadTimer = 0; }
      });
      stage.appendChild(frame);
      stage.appendChild(spin);
      var foot = doc.createElement('div');
      foot.className = 'qrwFoot';
      var note = doc.createElement('span');
      note.className = 'qrwNote';
      note.textContent = 'Blank? Some sites refuse to open inside another app.';
      var openBtn = doc.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'qrwLink';
      openBtn.setAttribute('data-qrw', 'open');
      openBtn.textContent = '↗ Open in a new tab';
      foot.appendChild(note); foot.appendChild(openBtn);
      wrap.appendChild(bar); wrap.appendChild(stage); wrap.appendChild(foot);
      w.frame = frame;
      w.stage = stage;
      navigate(w);
      return wrap;
    }

    function navigate(w) {
      if (!w.frame) return;
      w.stage.classList.add('loading');
      w.el && w.el.classList.remove('slow');
      if (w.loadTimer) clearTimeout(w.loadTimer);
      w.loadTimer = setTimeout(function () {
        w.loadTimer = 0;
        if (w.el) w.el.classList.add('slow');
      }, LOAD_HINT_MS);
      var url = w.read.url;
      if (!w.frame.getAttribute('src')) { w.frame.src = url; return; }
      // A fresh load even when it is the same link (⟳ means reload, ← means
      // back to where the code pointed after the site was clicked through).
      w.frame.src = 'about:blank';
      setTimeout(function () { if (w.frame) w.frame.src = url; }, 30);
    }

    function textBody(w) {
      var wrap = doc.createElement('div');
      wrap.className = 'qrwTextWrap';
      var read = w.read;
      var lead = doc.createElement('p');
      lead.className = 'qrwLead';
      if (read.sub === 'blocked') lead.textContent = 'This code holds a link of a kind that is never opened from here, for safety. Its text is below.';
      else if (read.sub === 'link') lead.textContent = 'This code is a link for another app. Copy it to use it there.';
      else if (read.sub === 'email') lead.textContent = 'This code holds an email address.';
      else if (read.sub === 'phone') lead.textContent = 'This code holds a phone number.';
      else if (read.sub === 'contact') lead.textContent = 'This code holds a contact card.';
      else if (read.sub === 'place') lead.textContent = 'This code holds a map position.';
      else if (read.sub === 'wifi') lead.textContent = 'This code joins a Wi-Fi network.';
      else lead.textContent = 'This code holds text, not a web link.';
      wrap.appendChild(lead);
      var wifi = read.sub === 'wifi' ? wifiParts(read.text) : null;
      if (wifi) {
        var dl = doc.createElement('dl');
        dl.className = 'qrwWifi';
        [['Network', wifi.ssid || '—'], ['Password', wifi.password || '(none)'], ['Security', wifi.security || 'Open']].forEach(function (row) {
          var dt = doc.createElement('dt'); dt.textContent = row[0];
          var dd = doc.createElement('dd'); dd.textContent = row[1];
          dl.appendChild(dt); dl.appendChild(dd);
        });
        wrap.appendChild(dl);
      }
      var pre = doc.createElement('pre');
      pre.className = 'qrwText';
      pre.textContent = read.text;
      wrap.appendChild(pre);
      var row = doc.createElement('div');
      row.className = 'qrwTextRow';
      var copy = doc.createElement('button');
      copy.type = 'button';
      copy.className = 'qrwLink';
      copy.setAttribute('data-qrw', 'copy');
      copy.textContent = '📋 Copy';
      row.appendChild(copy);
      wrap.appendChild(row);
      return wrap;
    }

    function apply(w) {
      if (!w || !w.el) return;
      var vw = root.innerWidth, vh = viewportH();
      var b;
      if (w.max) b = { x: WIN_PAD, y: WIN_PAD, w: Math.max(200, vw - WIN_PAD * 2), h: Math.max(160, vh - WIN_PAD * 2) };
      else { w.box = clampBox(w.box, vw, vh); b = w.box; }
      var el = w.el;
      el.style.left = b.x + 'px';
      el.style.top = b.y + 'px';
      el.style.width = (w.min ? Math.min(b.w, 320) : b.w) + 'px';
      el.style.height = w.min ? WIN_HEAD_H + 'px' : b.h + 'px';
      el.classList.toggle('maximised', !!w.max);
      el.classList.toggle('minimised', !!w.min);
      var mb = el.querySelector('[data-qrw="max"]'), nb = el.querySelector('[data-qrw="min"]');
      if (mb) { mb.textContent = w.max ? '❐' : '▢'; mb.title = w.max ? 'Back to its own size' : 'Fill the screen'; mb.setAttribute('aria-label', mb.title); }
      if (nb) { nb.textContent = w.min ? '▴' : '–'; nb.title = w.min ? 'Open it back up' : 'Minimise to its title bar'; nb.setAttribute('aria-label', nb.title); }
    }

    function raise(w) {
      if (w && w.el && w.el.parentNode && w.el.nextSibling) w.el.parentNode.appendChild(w.el);
    }

    function flash(w) {
      if (!w || !w.el) return;
      w.el.classList.remove('flash');
      void w.el.offsetWidth;
      w.el.classList.add('flash');
    }

    function close(id, quiet) {
      var w = find(id);
      if (!w) return;
      if (w.loadTimer) clearTimeout(w.loadTimer);
      if (w.frame) { try { w.frame.src = 'about:blank'; } catch (e) {} }
      w.frame = null;
      if (w.el && w.el.parentNode) w.el.parentNode.removeChild(w.el);
      wins = wins.filter(function (x) { return x.id !== id; });
      if (!quiet && env.onClose) { try { env.onClose(); } catch (e) {} }
    }

    function closeAll() { wins.slice().forEach(function (w) { close(w.id, true); }); }

    async function copyOf(w) {
      var text = w.read.kind === 'url' ? w.read.url : w.read.text;
      var done = false;
      try {
        if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
          await root.navigator.clipboard.writeText(text);
          done = true;
        }
      } catch (e) { done = false; }
      if (!done) {
        try {
          var ta = doc.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
          doc.body.appendChild(ta);
          ta.select();
          done = doc.execCommand && doc.execCommand('copy');
          doc.body.removeChild(ta);
        } catch (e) { done = false; }
      }
      toast(done ? (w.read.kind === 'url' ? '📋 Link copied' : '📋 Copied') : 'Could not copy — select the text and copy it yourself');
      return done;
    }

    function openOut(w) {
      if (w.read.kind !== 'url') return;
      var win = null;
      try { win = root.open(w.read.url, '_blank', 'noopener,noreferrer'); } catch (e) { win = null; }
      if (!win && env.onBlockedPopup) env.onBlockedPopup(w.read.url);
    }

    function wire(el, w) {
      var head = el.querySelector('.qrwHead');
      var mode = null, edge = null, ptr = null, sx = 0, sy = 0, start = null, lastTap = 0, target = null;

      el.addEventListener('pointerdown', function () { raise(w); }, true);
      el.addEventListener('click', function (e) {
        var b = e.target.closest('[data-qrw]');
        if (!b) return;
        var act = b.getAttribute('data-qrw');
        if (act === 'close') close(w.id);
        else if (act === 'min') { w.min = !w.min; if (w.min) w.max = false; apply(w); }
        else if (act === 'max') { w.max = !w.max; w.min = false; apply(w); }
        else if (act === 'reload' || act === 'back') navigate(w);
        else if (act === 'open') openOut(w);
        else if (act === 'copy') copyOf(w);
      });
      // Every key pressed in the window stops here: the worksheet's one-letter
      // shortcuts must never fire while somebody types into the page inside.
      ['keydown', 'keyup', 'keypress'].forEach(function (t) {
        el.addEventListener(t, function (e) {
          if (t === 'keydown' && e.key === 'Escape' && !e.target.closest('input, textarea, [contenteditable]')) {
            e.preventDefault();
            if (w.max) { w.max = false; apply(w); } else close(w.id);
          }
          e.stopPropagation();
        });
      });

      function begin(e, m, ed) {
        if (e.button > 0) return;
        if (m === 'move' && e.target.closest('button')) return;
        if (m === 'size' && (w.min || w.max)) return;
        mode = m; edge = ed || null; ptr = e.pointerId; sx = e.clientX; sy = e.clientY;
        start = { x: w.box.x, y: w.box.y, w: w.box.w, h: w.box.h };
        target = e.currentTarget;
        e.preventDefault(); e.stopPropagation();
        try { target.setPointerCapture(ptr); } catch (_) {}
        el.classList.add('dragging');
        if (m === 'move') {
          var now = Date.now();
          if (now - lastTap < 320) {
            mode = null; lastTap = 0; el.classList.remove('dragging');
            w.max = !w.max; w.min = false; apply(w);
            return;
          }
          lastTap = now;
          if (w.max) {
            // Pulling a full-screen window by its bar puts it back to its own
            // size under the pointer, as every desktop does.
            var frac = (e.clientX - WIN_PAD) / Math.max(1, root.innerWidth - WIN_PAD * 2);
            w.max = false;
            w.box = clampBox({ x: e.clientX - w.box.w * frac, y: e.clientY - WIN_HEAD_H / 2, w: w.box.w, h: w.box.h }, root.innerWidth, viewportH());
            start = { x: w.box.x, y: w.box.y, w: w.box.w, h: w.box.h };
            apply(w);
          }
        }
      }
      function move(e) {
        if (!mode || e.pointerId !== ptr) return;
        var dx = e.clientX - sx, dy = e.clientY - sy;
        if (mode === 'move') w.box = moveBox(start, dx, dy, root.innerWidth, viewportH());
        else w.box = resizeBox(start, edge, dx, dy, root.innerWidth, viewportH());
        apply(w);
        e.preventDefault();
      }
      function done(e) {
        if (!mode || (e && e.pointerId != null && e.pointerId !== ptr)) return;
        mode = null; ptr = null; edge = null;
        el.classList.remove('dragging');
        if (!w.max && !w.min) writeSaved(w.box);
      }
      head.addEventListener('pointerdown', function (e) { begin(e, 'move'); });
      var grabs = el.querySelectorAll('[data-edge]');
      for (var i = 0; i < grabs.length; i++) {
        (function (g) {
          g.addEventListener('pointerdown', function (e) { begin(e, 'size', g.getAttribute('data-edge')); });
        })(grabs[i]);
      }
      [head].concat(Array.prototype.slice.call(grabs)).forEach(function (n) {
        n.addEventListener('pointermove', move);
        n.addEventListener('pointerup', done);
        n.addEventListener('pointercancel', done);
        n.addEventListener('lostpointercapture', done);
      });
    }

    /* ---------- the outside world ---------- */
    function reflow() {
      wins.forEach(apply);
      if (on && drag) { drag = null; if (layer) layer.classList.remove('drawing'); }
    }
    root.addEventListener('resize', reflow);
    if (root.visualViewport) root.visualViewport.addEventListener('resize', reflow);

    // While the layer is up, every key stops before the worksheet sees it;
    // Escape leaves.
    root.addEventListener('keydown', function (e) {
      if (!on) return;
      e.stopImmediatePropagation();
      if (e.key === 'Escape') { e.preventDefault(); stop(); }
    }, true);

    /* The PERSON changed (a handover, a sign-out, a share link): every window
       closes and the layer comes down. A role re-check for the same person
       changes nothing. */
    function roleChanged() {
      var now = identity();
      if (now === lastIdentity && allowed()) return;
      lastIdentity = now;
      stop();
      closeAll();
    }

    function snapshot() {
      return {
        on: on, busy: busy,
        windows: wins.map(function (w) {
          return { id: w.id, kind: w.read.kind, url: w.read.url || '', text: w.read.text || '',
            box: { x: w.box.x, y: w.box.y, w: w.box.w, h: w.box.h }, max: w.max, min: w.min };
        })
      };
    }

    return {
      start: start, stop: stop, isOn: function () { return on; }, busy: function () { return busy; },
      open: openRead,
      openText: function (text) { return openRead(classify(text)); },
      close: close, closeAll: closeAll, roleChanged: roleChanged, snapshot: snapshot,
      readCanvas: function (canvas) { return decodeCanvas(canvas, { decoderSrc: env.decoderSrc, native: env.native }); },
      readRect: async function (rect) {
        var shot = await capture(rect);
        try { return shot.drew ? await decodeCanvas(shot.canvas, { decoderSrc: env.decoderSrc, native: env.native }) : null; }
        finally { shot.canvas.width = shot.canvas.height = 0; }
      }
    };
  }

  root.QrReader = { create: create, pure: pure, decodeCanvas: decodeCanvas, loadDecoder: loadDecoder };
  if (typeof module === 'object' && module.exports) module.exports = root.QrReader;
})(typeof window !== 'undefined' ? window : globalThis);
