/* =====================================================================
   🪄 LIVING APPS — an interactive HTML app on the page, and a magic wand
   that brings the question alive
   ---------------------------------------------------------------------
   The teacher uploads (or pastes) a self-contained HTML app — a "living
   diagram" like the ballast-tank one, a simulator, a slider lab — and it
   lands on the page as a PICTURE: a painted cover card with a wand on it.
   Tapping it (a student, a share visitor) or pressing 🪄 Bring alive on its
   bar (the teacher) opens the STAGE: the wand sweeps across, the sparkles
   burst, and the app fades in, running.

   THE APP NEVER RUNS IN THE PAGE. It runs only inside an iframe with
   `sandbox="allow-scripts"` (no allow-same-origin, so an opaque origin with
   no cookies, no storage, no parent DOM) and a Content-Security-Policy in
   a trusted <head> written BEFORE the author's markup — a later CSP in the
   app can tighten it and never relax it. connect-src is 'none', so an app
   cannot phone home with fetch or XHR.

   THE WAND IS A MESSAGE, NOT A REACH-IN. The page posts
   {polymath:'wand', action:'cast'} into the frame. A small trusted bridge
   (WAND_BRIDGE, also written before the author's markup) answers it, in
   this order:
     1. a `polymath:wand` CustomEvent on window — an app that calls
        preventDefault() on it has handled the spell itself;
     2. `window.polymathWand(detail)` if the app defines one;
     3. the app's OWN wand: `[data-polymath-wand]`, `.btn-wand`, `button.wand`,
        `[data-wand]` — the one nearest the middle of the screen is picked up
        (clicked, unless aria-pressed already says it is held) and then its
        target (`data-wand-target`, else `.wand-target` / `.figure-stage` /
        `[data-wand-stage]` in the same article/section) is tapped in its
        centre. Pressed again, the same part steps on;
     4. a play button: `[data-polymath-play]`, `.btn-play`, `button.play`.
   It replies {polymath:'wand-result', how} so the stage can say "this app
   has no wand of its own — it's ready to play" instead of looking broken.

   This file owns the picker (📎 add / paste), the cover painting and the
   stage. index.html holds only the glue: who is using the device, where the
   picture goes and which buttons are its own (search `🪄 Living apps — glue`).
   ===================================================================== */
(function (root) {
  'use strict';

  var MAX_CHARS = 600000;              // an app bigger than this does not go on a page
  var TITLE_MAX = 90;
  var COVER_W = 1200;
  var COVER_H = 520;
  var COVER_QUALITY = 0.9;
  var SPELL_MS = 1150;                 // the wand's sweep before the app shows
  var CAST_DELAY_MS = 520;             // after the frame loads, before the first cast
  var HINT_MS = 3600;

  /* The frame's policy. Wider than the question bank's in exactly two ways,
     both for how teachers' apps are really written: pictures may come from
     https (a logo sticker, a photograph), and Google Fonts may load. Nothing
     can be SENT anywhere — connect-src, form-action and frame-src are shut. */
  var CSP = "default-src 'none'; script-src 'unsafe-inline'; " +
    "style-src 'unsafe-inline' https://fonts.googleapis.com; " +
    "img-src data: blob: https:; font-src data: https://fonts.gstatic.com; media-src data: blob:; " +
    "connect-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; " +
    "base-uri 'none'; form-action 'none'";

  /* The trusted half of the wand, inside the sandbox. It is plain ES5 so the
     oldest iPad Safari a classroom still has runs it. */
  var WAND_BRIDGE = [
    '(function(){',
    '  "use strict";',
    '  var casts = 0, lastWand = null;',
    '  function shown(el){',
    '    if (!el || !el.getBoundingClientRect) return false;',
    '    var r = el.getBoundingClientRect();',
    '    if (r.width <= 0 || r.height <= 0) return false;',
    '    var s = window.getComputedStyle(el);',
    '    return s.visibility !== "hidden" && s.display !== "none" && !el.disabled;',
    '  }',
    '  function all(sel){ try { return Array.prototype.slice.call(document.querySelectorAll(sel)); } catch (e) { return []; } }',
    '  function wands(){',
    '    return all("[data-polymath-wand],.btn-wand,button.wand,[data-wand]").filter(shown);',
    '  }',
    '  function nearestMiddle(list){',
    '    var mid = window.innerHeight / 2, best = null, bestD = Infinity;',
    '    list.forEach(function(el){',
    '      var host = el.closest ? (el.closest("article,section,[data-part],.question,.question-paper") || el) : el;',
    '      var r = host.getBoundingClientRect();',
    '      var d = (r.bottom < 0 || r.top > window.innerHeight) ? 1e6 + Math.abs(r.top) : Math.abs((r.top + r.bottom) / 2 - mid);',
    '      if (d < bestD) { bestD = d; best = el; }',
    '    });',
    '    return best;',
    '  }',
    '  function targetFor(w){',
    '    var sel = w.getAttribute("data-wand-target");',
    '    if (sel) { try { var n = document.querySelector(sel); if (n) return n; } catch (e) {} }',
    '    var host = (w.closest && w.closest("article,section,[data-part],.question,.question-paper")) || document;',
    '    return host.querySelector(".wand-target,.figure-stage,[data-wand-stage]");',
    '  }',
    '  function tap(el){',
    '    var r = el.getBoundingClientRect();',
    '    var x = r.left + r.width / 2, y = r.top + r.height / 2;',
    '    var o = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, isPrimary: true, pointerType: "mouse", view: window };',
    '    var P = window.PointerEvent || window.MouseEvent;',
    '    try { el.dispatchEvent(new P("pointerdown", o)); } catch (e) {}',
    '    try { el.dispatchEvent(new P("pointerup", o)); } catch (e) {}',
    '    el.dispatchEvent(new MouseEvent("click", o));',
    '  }',
    '  function reply(how){',
    '    try { parent.postMessage({ polymath: "wand-result", how: how, casts: casts }, "*"); } catch (e) {}',
    '  }',
    '  function cast(){',
    '    casts++;',
    '    var detail = { cast: casts };',
    '    var ev; try { ev = new CustomEvent("polymath:wand", { cancelable: true, detail: detail }); } catch (e) { ev = null; }',
    '    if (ev && !window.dispatchEvent(ev)) { reply("event"); return; }',
    '    if (typeof window.polymathWand === "function") {',
    '      try { window.polymathWand(detail); reply("function"); } catch (e) { reply("error"); }',
    '      return;',
    '    }',
    '    var list = wands();',
    '    if (list.length) {',
    '      var w = (lastWand && list.indexOf(lastWand) >= 0 && shown(lastWand) && nearestMiddle(list) === lastWand) ? lastWand : nearestMiddle(list);',
    '      lastWand = w;',
    '      try { w.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) { try { w.scrollIntoView(); } catch (e2) {} }',
    '      if (w.getAttribute("aria-pressed") !== "true") w.click();',
    '      var t = targetFor(w);',
    '      setTimeout(function(){',
    '        if (!t) return;',
    '        try { t.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) {}',
    '        setTimeout(function(){ tap(t); }, 380);',
    '      }, 260);',
    '      reply(t ? "wand" : "wand-only");',
    '      return;',
    '    }',
    '    var play = all("[data-polymath-play],.btn-play,button.play").filter(shown)[0];',
    '    if (play) { play.click(); reply("play"); return; }',
    '    reply("none");',
    '  }',
    '  window.addEventListener("message", function(e){',
    '    if (e.source !== parent) return;',
    '    var d = e.data;',
    '    if (d && d.polymath === "wand" && d.action === "cast") cast();',
    '  });',
    '  window.addEventListener("load", function(){',
    '    try { parent.postMessage({ polymath: "wand-ready", wands: wands().length }, "*"); } catch (e) {}',
    '  });',
    '})();'
  ].join('\n');

  /* ---------------------------------------------------------------
     Pure helpers — no DOM, so tools/living-apps-tests.mjs runs them.
     --------------------------------------------------------------- */
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function decodeEntities(s) {
    return String(s || '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
      .replace(/&#(\d+);/g, function (m, n) { var c = Number(n); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ''; });
  }
  function cleanTitle(value) {
    var t = decodeEntities(String(value == null ? '' : value)).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.length > TITLE_MAX) t = t.slice(0, TITLE_MAX - 1).replace(/\s+\S*$/, '') + '…';
    return t;
  }
  /* The app's own <title>, else its first heading, else ''. */
  function titleFromHtml(html) {
    var s = String(html || '');
    var m = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (m && cleanTitle(m[1].replace(/<[^>]*>/g, ' '))) return cleanTitle(m[1].replace(/<[^>]*>/g, ' '));
    m = s.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i);
    if (m) return cleanTitle(m[1].replace(/<[^>]*>/g, ' '));
    return '';
  }
  function titleFromFileName(name) {
    var base = String(name || '').replace(/^.*[\\/]/, '').replace(/\.(html?|xhtml)$/i, '');
    return cleanTitle(base.replace(/[_-]+/g, ' '));
  }
  /* Is this plausibly an HTML app at all? Plain text pasted by mistake is
     refused rather than put on the page as an "app" that shows a paragraph. */
  function looksLikeHtml(html) {
    return /<\s*(?:!doctype|html|head|body|div|section|article|main|svg|canvas|script|style|button|p|h[1-6]|span|input|table|figure)\b/i.test(String(html || ''));
  }
  function hasScript(html) { return /<script\b/i.test(String(html || '')); }
  /* Does the app carry a wand of its own (for the cover's line and the
     stage's first hint)? A guess from the markup — the bridge decides. */
  function hasWand(html) {
    return /data-polymath-wand|class\s*=\s*["'][^"']*\b(?:btn-wand|wand)\b|data-wand\b|polymathWand|polymath:wand/i.test(String(html || ''));
  }
  /* Byte length as UTF-8, which is what Firestore and Storage count. */
  function utf8Bytes(s) {
    s = String(s || '');
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }
  function sizeText(chars) {
    var b = Math.max(0, Number(chars) || 0);
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return Math.round(b / 102.4) / 10 + ' KB';
    return Math.round(b / 104857.6) / 10 + ' MB';
  }
  /* A tiny stable fingerprint, to tell whether an edit changed the app. */
  function contentHash(html) {
    var s = String(html || ''), h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return 'la1-' + s.length + '-' + (h >>> 0).toString(16);
  }
  /* The ONE door into what is stored on an annotation. Returns
     { ok, app, reason } and never throws. */
  function normalizeApp(raw) {
    raw = raw || {};
    var html = String(raw.html == null ? '' : raw.html).replace(/^﻿/, '');
    if (!html.trim()) return { ok: false, reason: 'empty', message: 'There is no app here yet — choose an HTML file or paste one.' };
    if (html.length > MAX_CHARS) return { ok: false, reason: 'tooBig', message: 'That app is ' + sizeText(html.length) + ' — the most a page can carry is ' + sizeText(MAX_CHARS) + '. Shrink its pictures, or link to them instead.' };
    if (!looksLikeHtml(html)) return { ok: false, reason: 'notHtml', message: 'That does not look like an HTML app — it should start with something like <!doctype html> or <div>.' };
    var title = cleanTitle(raw.title) || titleFromHtml(html) || 'Living app';
    return {
      ok: true,
      app: { v: 1, title: title, html: html, hash: contentHash(html), wand: hasWand(html), at: Number(raw.at) || 0 }
    };
  }
  /* Is a stored value a usable app? Used by the page's predicate. */
  function validApp(app) {
    return !!(app && typeof app === 'object' && typeof app.html === 'string' && app.html.trim().length > 0 && app.html.length <= MAX_CHARS);
  }
  /* The document the sandbox loads: trusted head (CSP, viewport, bridge)
     first, then the author's markup. A full <!doctype html><html>… pasted
     inside body is tolerated by every browser's parser: the extra html/head/
     body tags are dropped and their styles and scripts still run. */
  function sandboxDocument(html) {
    return '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta http-equiv="Content-Security-Policy" content="' + escapeHtml(CSP) + '">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<script>' + WAND_BRIDGE + '<\/script>' +
      '</head><body>' + String(html || '') + '</body></html>';
  }
  /* Word-wrap a title into at most `maxLines` lines with a measuring
     function, so the cover and the tests share one rule. */
  function wrapLines(text, maxWidth, measure, maxLines) {
    var words = String(text || '').split(/\s+/).filter(Boolean);
    var lines = [], line = '';
    maxLines = maxLines || 2;
    for (var i = 0; i < words.length; i++) {
      var tryLine = line ? line + ' ' + words[i] : words[i];
      if (measure(tryLine) <= maxWidth || !line) { line = tryLine; continue; }
      lines.push(line);
      line = words[i];
      if (lines.length === maxLines - 1) {
        line = words.slice(i).join(' ');
        break;
      }
    }
    if (line) lines.push(line);
    var last = lines.length - 1;
    if (last >= 0 && measure(lines[last]) > maxWidth) {
      var s = lines[last];
      while (s.length > 1 && measure(s + '…') > maxWidth) s = s.slice(0, -1);
      lines[last] = s.replace(/\s+$/, '') + '…';
    }
    return lines;
  }
  /* Where a picture of width ÷ height `ratio` goes on a page: the page in
     view, centred, a little below the top of what is on screen, and stepped
     for each living app already on that page. Same rule as the bank's. */
  function placeOnPage(pageW, pageH, ratio, index, anchorY) {
    var pw = pageW || 600, ph = pageH || 800;
    var r = Math.max(0.2, ratio || COVER_W / COVER_H);
    var w = Math.min(pw - 48, Math.max(240, pw * 0.7));
    var h = w / r;
    if (h > ph * 0.6) { h = ph * 0.6; w = h * r; }
    w = Math.max(80, Math.min(w, pw - 8));
    h = Math.max(40, Math.min(h, ph - 8));
    var step = (index || 0) % 6;
    var x = (pw - w) / 2 + step * 14;
    var y = (isFinite(anchorY) ? anchorY : ph * 0.1) + step * 14;
    x = Math.max(4, Math.min(pw - w - 4, x));
    y = Math.max(4, Math.min(ph - h - 4, y));
    return { x: r2(x), y: r2(y), w: r2(w), h: r2(h) };
  }
  function r2(n) { return Math.round(n * 100) / 100; }
  /* What the stage says after a cast, from the bridge's answer. */
  function castMessage(how) {
    switch (how) {
      case 'event':
      case 'function': return '🪄 The spell is cast — the app has taken it from here.';
      case 'wand': return '🪄 The wand touched the picture — watch it come alive. Wave again for the next step.';
      case 'wand-only': return '🪄 The wand is in hand — tap the picture to cast it.';
      case 'play': return '▶ Playing — the app has no wand, so its play button was pressed.';
      case 'error': return 'The app stumbled over the spell. Try ↺ Start again.';
      default: return 'This app has no wand of its own — it is alive and ready to play with.';
    }
  }

  var pure = {
    MAX_CHARS: MAX_CHARS, TITLE_MAX: TITLE_MAX, COVER_W: COVER_W, COVER_H: COVER_H, CSP: CSP, WAND_BRIDGE: WAND_BRIDGE,
    escapeHtml: escapeHtml, cleanTitle: cleanTitle, titleFromHtml: titleFromHtml, titleFromFileName: titleFromFileName,
    looksLikeHtml: looksLikeHtml, hasScript: hasScript, hasWand: hasWand, utf8Bytes: utf8Bytes, sizeText: sizeText,
    contentHash: contentHash, normalizeApp: normalizeApp, validApp: validApp, sandboxDocument: sandboxDocument,
    wrapLines: wrapLines, placeOnPage: placeOnPage, castMessage: castMessage
  };

  /* ---------------------------------------------------------------
     The cover — the picture that sits on the page.
     --------------------------------------------------------------- */
  function roundRect(x, X, Y, W, H, R) {
    x.beginPath();
    x.moveTo(X + R, Y);
    x.arcTo(X + W, Y, X + W, Y + H, R);
    x.arcTo(X + W, Y + H, X, Y + H, R);
    x.arcTo(X, Y + H, X, Y, R);
    x.arcTo(X, Y, X + W, Y, R);
    x.closePath();
  }
  function star(x, cx, cy, R, r, fill, stroke) {
    x.beginPath();
    for (var i = 0; i < 8; i++) {
      var ang = -Math.PI / 2 + i * Math.PI / 4;
      var rad = i % 2 === 0 ? R : r;
      var px = cx + Math.cos(ang) * rad, py = cy + Math.sin(ang) * rad;
      if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.closePath();
    x.fillStyle = fill;
    x.fill();
    if (stroke) { x.lineWidth = Math.max(1.5, R * 0.08); x.strokeStyle = stroke; x.stroke(); }
  }
  /* A seeded scatter so the same title paints the same sparkles. */
  function seeded(seed) {
    var s = 0;
    for (var i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function paintCover(app) {
    return new Promise(function (resolve, reject) {
      try {
        var c = document.createElement('canvas');
        c.width = COVER_W; c.height = COVER_H;
        var x = c.getContext('2d');
        if (!x) throw new Error('No canvas');
        // The paper and its soft science-blue to gold wash.
        x.fillStyle = '#FFFFFF';
        x.fillRect(0, 0, COVER_W, COVER_H);
        var g = x.createLinearGradient(0, 0, COVER_W, COVER_H);
        g.addColorStop(0, '#EEF6FD');
        g.addColorStop(0.55, '#FFFDF6');
        g.addColorStop(1, '#FFF3D6');
        roundRect(x, 10, 10, COVER_W - 20, COVER_H - 20, 44);
        x.fillStyle = g;
        x.fill();
        x.lineWidth = 6;
        x.strokeStyle = '#F2B705';
        x.stroke();
        roundRect(x, 26, 26, COVER_W - 52, COVER_H - 52, 32);
        x.lineWidth = 2;
        x.setLineDash([10, 12]);
        x.strokeStyle = 'rgba(31, 111, 178, 0.35)';
        x.stroke();
        x.setLineDash([]);
        // Sparkles scattered over the right half.
        var rnd = seeded(String(app && app.title || 'Living app'));
        for (var i = 0; i < 26; i++) {
          var sx = 560 + rnd() * 600, sy = 50 + rnd() * 420, sr = 5 + rnd() * 14;
          star(x, sx, sy, sr, sr * 0.36, 'rgba(242, 183, 5, ' + (0.25 + rnd() * 0.55).toFixed(2) + ')');
        }
        // The wand: a dark stick with a cream tip, and a big gold star.
        var wx = 150, wy = 150;
        x.save();
        x.lineCap = 'round';
        x.lineWidth = 34; x.strokeStyle = '#FFFFFF';
        x.beginPath(); x.moveTo(wx + 40, wy + 40); x.lineTo(wx + 230, wy + 230); x.stroke();
        x.lineWidth = 22; x.strokeStyle = '#2D1F14';
        x.beginPath(); x.moveTo(wx + 40, wy + 40); x.lineTo(wx + 230, wy + 230); x.stroke();
        x.lineWidth = 22; x.strokeStyle = '#F6E7C8';
        x.beginPath(); x.moveTo(wx + 40, wy + 40); x.lineTo(wx + 82, wy + 82); x.stroke();
        x.restore();
        x.save();
        x.shadowColor = 'rgba(255, 210, 90, 0.9)';
        x.shadowBlur = 40;
        star(x, wx + 18, wy + 18, 74, 27, '#F6C343', '#8A5E00');
        x.restore();
        x.beginPath(); x.arc(wx + 18, wy + 18, 12, 0, Math.PI * 2); x.fillStyle = '#FFFFFF'; x.fill();
        star(x, wx + 130, wy - 40, 18, 6, '#F6C343');
        star(x, wx - 60, wy + 120, 13, 5, '#F6C343');
        star(x, wx + 70, wy + 300, 10, 4, '#64B5F6');
        // The chip.
        var font = '"Sora", "Century Gothic", "Didact Gothic", -apple-system, "Segoe UI", sans-serif';
        x.font = '600 26px ' + font;
        var chip = '🪄 LIVING APP';
        var cw = x.measureText(chip).width + 44;
        roundRect(x, 460, 96, cw, 52, 26);
        x.fillStyle = '#1F6FB2';
        x.fill();
        x.fillStyle = '#FFFFFF';
        x.textBaseline = 'middle';
        x.fillText(chip, 482, 123);
        // The title.
        x.fillStyle = '#1A1A1A';
        x.font = '700 58px ' + font;
        var lines = wrapLines(app && app.title || 'Living app', 650, function (s) { return x.measureText(s).width; }, 2);
        var ty = lines.length > 1 ? 218 : 240;
        lines.forEach(function (ln, k) { x.fillText(ln, 460, ty + k * 70); });
        // The instruction.
        x.font = '400 30px ' + font;
        x.fillStyle = '#55585A';
        x.fillText('Tap to bring this question alive', 460, lines.length > 1 ? 384 : 340);
        x.font = '600 24px ' + font;
        x.fillStyle = '#8A5E00';
        x.fillText(app && app.wand ? '✨ It has its own magic wand' : '✨ Interactive — try it yourself', 460, lines.length > 1 ? 432 : 392);
        resolve({ src: c.toDataURL('image/jpeg', COVER_QUALITY), ratio: COVER_W / COVER_H });
      } catch (e) { reject(e); }
    });
  }

  /* ---------------------------------------------------------------
     The feature.
     env: { role(): 'teacher'|'student'|'none', toast(msg, ms),
            canAdd(): boolean, addToPage(cover, app) -> page number,
            updateOnPage(id, cover, app) -> boolean,
            findAnnotation(id) -> annotation or null }
     --------------------------------------------------------------- */
  function create(env) {
    env = env || {};
    var toast = typeof env.toast === 'function' ? env.toast : function () {};
    var adder = null;      // { back, card, state }
    var stage = null;      // { back, frame, id, timers, onMessage }
    var docListener = false;

    function teacher() { return typeof env.role === 'function' && env.role() === 'teacher'; }

    function overlay(cls, label) {
      var back = document.createElement('div');
      back.className = 'laBack ' + cls;
      back.setAttribute('role', 'dialog');
      back.setAttribute('aria-modal', 'true');
      back.setAttribute('aria-label', label);
      // Every keystroke typed in here stays here, or a letter typed into the
      // paste box fires one of the page's one-letter tool shortcuts.
      ['keydown', 'keyup', 'keypress', 'paste', 'copy', 'cut'].forEach(function (t) {
        back.addEventListener(t, function (e) {
          if (t === 'keydown' && e.key === 'Escape') { e.preventDefault(); closeTop(); }
          e.stopPropagation();
        });
      });
      back.addEventListener('pointerdown', function (e) {
        e.stopPropagation();
        if (e.target === back) closeTop();
      });
      document.body.appendChild(back);
      requestAnimationFrame(function () { back.classList.add('in'); });
      if (!docListener) {
        docListener = true;
        document.addEventListener('keydown', function (e) {
          if (e.key !== 'Escape' || !(adder || stage)) return;
          if (e.target && e.target.closest && e.target.closest('.laBack')) return;
          e.preventDefault();
          e.stopPropagation();
          closeTop();
        }, true);
      }
      return back;
    }
    function closeTop() {
      if (stage) closeStage();
      else if (adder) closeAdder();
    }
    function focusIn(node) {
      if (!node) return;
      try { node.focus({ preventScroll: true }); } catch (e) { try { node.focus(); } catch (e2) {} }
    }

    /* ---------------- 📎 Adding (or replacing) an app ---------------- */
    function openAdder(opts) {
      opts = opts || {};
      if (!teacher()) { toast('Adding a living app is the teacher’s own.'); return false; }
      if (!opts.editId && typeof env.canAdd === 'function' && !env.canAdd()) return false;
      closeAdder();
      var existing = opts.editId && typeof env.findAnnotation === 'function' ? env.findAnnotation(opts.editId) : null;
      var start = existing && existing.lapp ? existing.lapp : null;
      var st = { html: start ? start.html : '', title: start ? start.title : '', titleTyped: !!start, file: '', editId: existing ? existing.id : '', previewTimer: 0, busy: false };
      var back = overlay('laAdderBack', st.editId ? 'Change the living app' : 'Add a living app');
      var card = document.createElement('div');
      card.className = 'laCard laAdder';
      card.tabIndex = -1;
      card.innerHTML =
        '<div class="laHead">' +
          '<div class="laHeadTitle"><span class="laWandGlyph" aria-hidden="true">🪄</span>' +
            '<div><h2>' + (st.editId ? 'Change the living app' : 'Add a living app') + '</h2>' +
            '<p class="laSub">An interactive HTML app — a living diagram, a simulator, a slider lab. It goes on the page as a picture with a magic wand; a tap brings the question alive.</p></div></div>' +
          '<button type="button" class="laIconBtn" data-la="close" title="Close (Esc)" aria-label="Close">✕</button>' +
        '</div>' +
        '<div class="laAdderBody">' +
          '<div class="laAdderLeft">' +
            '<label class="laDrop" data-la="drop">' +
              '<input type="file" accept=".html,.htm,text/html" data-la="file" hidden>' +
              '<span class="laDropIcon" aria-hidden="true">📄</span>' +
              '<span class="laDropMain">Choose an HTML file</span>' +
              '<span class="laDropSub">…or drop it here</span>' +
            '</label>' +
            '<div class="laOr"><span>or paste its code</span></div>' +
            '<textarea class="laPaste" data-la="paste" spellcheck="false" placeholder="<!doctype html> …"></textarea>' +
            '<label class="laField"><span>Title on the page</span>' +
              '<input type="text" class="laTitle" data-la="title" maxlength="' + TITLE_MAX + '" placeholder="Taken from the app’s own title"></label>' +
            '<div class="laInfo" data-la="info" aria-live="polite"></div>' +
          '</div>' +
          '<div class="laAdderRight">' +
            '<div class="laPreviewHead"><span>Preview</span><span class="laPreviewNote">running in its sandbox</span></div>' +
            '<div class="laPreview" data-la="preview"><div class="laPreviewEmpty">Choose or paste an app and it runs here.</div></div>' +
          '</div>' +
        '</div>' +
        '<div class="laFoot">' +
          '<span class="laSafe">🔒 The app runs in a sealed frame: it cannot read the worksheet, sign anyone in or send anything anywhere.</span>' +
          '<div class="laFootBtns">' +
            '<button type="button" class="laBtn" data-la="cancel">Cancel</button>' +
            '<button type="button" class="laBtn laPrimary" data-la="add" disabled>' + (st.editId ? '✓ Update the app' : '➕ Put on the page') + '</button>' +
          '</div>' +
        '</div>';
      back.appendChild(card);
      adder = { back: back, card: card, st: st };

      var q = function (k) { return card.querySelector('[data-la="' + k + '"]'); };
      var paste = q('paste'), titleBox = q('title'), file = q('file'), drop = q('drop'), info = q('info'), addBtn = q('add');
      if (st.html) paste.value = st.html;
      if (st.title) titleBox.value = st.title;

      function refresh(immediate) {
        var res = normalizeApp({ html: st.html, title: st.title });
        if (!st.titleTyped) {
          var guess = titleFromHtml(st.html) || (st.file ? titleFromFileName(st.file) : '');
          if (guess && titleBox.value !== guess) { titleBox.value = guess; st.title = guess; }
        }
        if (!st.html.trim()) {
          info.className = 'laInfo';
          info.textContent = '';
        } else if (!res.ok) {
          info.className = 'laInfo bad';
          info.textContent = res.message;
        } else {
          info.className = 'laInfo good';
          info.textContent = '✓ ' + sizeText(st.html.length) + (st.file ? ' · ' + st.file : '') +
            (hasScript(st.html) ? ' · runs its own script' : ' · no script') +
            (res.app.wand ? ' · 🪄 has a magic wand' : '');
        }
        addBtn.disabled = !res.ok || st.busy;
        clearTimeout(st.previewTimer);
        st.previewTimer = setTimeout(function () { drawPreview(res); }, immediate ? 0 : 450);
      }
      function drawPreview(res) {
        if (!adder || adder.st !== st) return;
        var host = q('preview');
        host.innerHTML = '';
        if (!res || !res.ok) {
          var empty = document.createElement('div');
          empty.className = 'laPreviewEmpty';
          empty.textContent = st.html.trim() ? 'Nothing to preview until the app is fixed.' : 'Choose or paste an app and it runs here.';
          host.appendChild(empty);
          return;
        }
        host.appendChild(makeFrame(res.app, 'Preview of ' + res.app.title));
      }
      function takeFile(f) {
        if (!f) return;
        if (!/\.(html?|xhtml)$/i.test(f.name || '') && !/html/i.test(f.type || '')) {
          info.className = 'laInfo bad';
          info.textContent = '“' + (f.name || 'That file') + '” is not an HTML file — choose a .html file.';
          return;
        }
        if (f.size > MAX_CHARS * 4) {
          info.className = 'laInfo bad';
          info.textContent = 'That file is ' + sizeText(f.size) + ' — far more than a page can carry (' + sizeText(MAX_CHARS) + ').';
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          if (!adder || adder.st !== st) return;
          st.html = String(reader.result || '');
          st.file = f.name || '';
          paste.value = st.html.length > 200000 ? st.html.slice(0, 200000) + '\n…' : st.html;
          paste.dataset.fromFile = st.html.length > 200000 ? '1' : '';
          refresh(true);
        };
        reader.onerror = function () {
          info.className = 'laInfo bad';
          info.textContent = 'That file could not be read.';
        };
        reader.readAsText(f);
      }

      file.addEventListener('change', function () { takeFile(file.files && file.files[0]); file.value = ''; });
      ['dragenter', 'dragover'].forEach(function (t) {
        card.addEventListener(t, function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.add('over'); });
      });
      ['dragleave', 'drop'].forEach(function (t) {
        card.addEventListener(t, function (e) {
          e.preventDefault(); e.stopPropagation();
          if (t === 'dragleave' && card.contains(e.relatedTarget)) return;
          drop.classList.remove('over');
          if (t === 'drop') takeFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
        });
      });
      paste.addEventListener('input', function () {
        if (paste.dataset.fromFile === '1') paste.dataset.fromFile = '';
        st.html = paste.value;
        st.file = '';
        refresh(false);
      });
      titleBox.addEventListener('input', function () {
        st.title = titleBox.value;
        st.titleTyped = !!titleBox.value.trim();
        if (!st.titleTyped) refresh(true);
      });
      q('close').addEventListener('click', closeAdder);
      q('cancel').addEventListener('click', closeAdder);
      addBtn.addEventListener('click', function () { commitAdder(); });
      refresh(true);
      setTimeout(function () { focusIn(st.editId ? titleBox : drop); }, 30);
      return true;
    }
    function commitAdder() {
      if (!adder) return;
      var st = adder.st;
      if (st.busy) return;
      if (!teacher()) { toast('Adding a living app is the teacher’s own.'); closeAdder(); return; }
      var res = normalizeApp({ html: st.html, title: st.title, at: Date.now() });
      if (!res.ok) { toast(res.message, 4500); return; }
      st.busy = true;
      var addBtn = adder.card.querySelector('[data-la="add"]');
      addBtn.disabled = true;
      addBtn.textContent = '✨ Painting the cover…';
      paintCover(res.app).then(function (cover) {
        if (!adder || adder.st !== st) return;
        var done;
        if (st.editId) done = typeof env.updateOnPage === 'function' && env.updateOnPage(st.editId, cover, res.app);
        else done = typeof env.addToPage === 'function' && env.addToPage(cover, res.app);
        st.busy = false;
        if (done) {
          closeAdder();
          toast(st.editId
            ? '🪄 Living app updated — tap it to see it alive.'
            : '🪄 “' + res.app.title + '” is on the page — select it and press 🪄 Bring alive, or a student just taps it.', 4800);
        } else {
          addBtn.disabled = false;
          addBtn.textContent = st.editId ? '✓ Update the app' : '➕ Put on the page';
        }
      }).catch(function () {
        st.busy = false;
        if (adder && adder.st === st) {
          addBtn.disabled = false;
          addBtn.textContent = st.editId ? '✓ Update the app' : '➕ Put on the page';
        }
        toast('The cover could not be painted on this device.', 4000);
      });
    }
    function closeAdder() {
      if (!adder) return;
      clearTimeout(adder.st.previewTimer);
      var back = adder.back;
      adder = null;
      back.remove();
    }

    /* ---------------- the sandboxed frame ---------------- */
    function makeFrame(app, title) {
      var f = document.createElement('iframe');
      f.className = 'laFrame';
      f.title = title || (app && app.title) || 'Living app';
      f.setAttribute('sandbox', 'allow-scripts');
      f.setAttribute('referrerpolicy', 'no-referrer');
      f.setAttribute('allow', '');
      f.srcdoc = sandboxDocument(app && app.html);
      return f;
    }

    /* ---------------- 🪄 The stage ---------------- */
    function open(id, opts) {
      opts = opts || {};
      var a = typeof env.findAnnotation === 'function' ? env.findAnnotation(id) : null;
      if (!a || !validApp(a.lapp)) { toast('This living app has nothing in it to open.'); return false; }
      closeStage();
      var app = a.lapp;
      var reduce = false;
      try { reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
      var back = overlay('laStageBack', app.title || 'Living app');
      var card = document.createElement('div');
      card.className = 'laCard laStage' + (reduce ? ' laCalm' : '');
      card.tabIndex = -1;
      card.innerHTML =
        '<div class="laHead laStageHead">' +
          '<div class="laHeadTitle"><span class="laWandGlyph" aria-hidden="true">🪄</span><h2></h2></div>' +
          '<div class="laStageBtns">' +
            '<button type="button" class="laBtn laWandBtn" data-la="cast" title="Wave the magic wand — it picks up the app’s wand and touches the picture (W)">' +
              '<span class="laWandBtnIcon" aria-hidden="true">🪄</span><span>Wave the wand</span></button>' +
            '<button type="button" class="laBtn" data-la="restart" title="Start the app again from the beginning">↺ Start again</button>' +
            '<button type="button" class="laIconBtn" data-la="close" title="Close (Esc)" aria-label="Close">✕</button>' +
          '</div>' +
        '</div>' +
        '<div class="laStageBody">' +
          '<div class="laFrameHost"></div>' +
          '<div class="laSpell" aria-hidden="true"></div>' +
          '<div class="laHint" role="status" aria-live="polite"></div>' +
        '</div>';
      card.querySelector('.laStageHead h2').textContent = app.title || 'Living app';
      back.appendChild(card);
      var s = { back: back, card: card, id: id, app: app, timers: [], frame: null, casts: 0, ready: false, pendingCast: false, reduce: reduce, onMessage: null };
      stage = s;

      s.onMessage = function (e) {
        if (!stage || stage !== s || !s.frame || e.source !== s.frame.contentWindow) return;
        var d = e.data;
        if (!d || typeof d !== 'object') return;
        if (d.polymath === 'wand-ready') {
          s.ready = true;
          if (s.pendingCast) { s.pendingCast = false; later(s, function () { sendCast(s); }, CAST_DELAY_MS); }
        } else if (d.polymath === 'wand-result') {
          hint(s, castMessage(String(d.how || 'none')));
        }
      };
      root.addEventListener('message', s.onMessage);

      card.querySelector('[data-la="close"]').addEventListener('click', closeStage);
      card.querySelector('[data-la="cast"]').addEventListener('click', function () { cast(s); });
      card.querySelector('[data-la="restart"]').addEventListener('click', function () { restart(s, false); });
      card.addEventListener('keydown', function (e) {
        if ((e.key === 'w' || e.key === 'W') && !e.metaKey && !e.ctrlKey && !e.altKey &&
            !(e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) {
          e.preventDefault();
          cast(s);
        }
      });
      restart(s, opts.cast !== false);
      setTimeout(function () { focusIn(card.querySelector('[data-la="cast"]')); }, 40);
      return true;
    }
    function later(s, fn, ms) {
      var t = setTimeout(function () {
        s.timers = s.timers.filter(function (x) { return x !== t; });
        if (stage === s) fn();
      }, ms);
      s.timers.push(t);
      return t;
    }
    function restart(s, withSpell) {
      if (stage !== s) return;
      s.timers.forEach(clearTimeout);
      s.timers = [];
      s.ready = false;
      s.pendingCast = false;
      var host = s.card.querySelector('.laFrameHost');
      host.innerHTML = '';
      var f = makeFrame(s.app);
      s.frame = f;
      host.appendChild(f);
      if (withSpell !== false) {
        f.classList.add('laHidden');
        spell(s, function () {
          f.classList.remove('laHidden');
          f.classList.add('laWake');
          later(s, function () { f.classList.remove('laWake'); }, 900);
          // The wand touches the app as it appears: the first cast waits for
          // the bridge to say the app has loaded.
          if (s.ready) later(s, function () { sendCast(s); }, CAST_DELAY_MS);
          else s.pendingCast = true;
        });
      } else {
        hint(s, '↺ Started again. Press 🪄 Wave the wand when you are ready.');
      }
    }
    function cast(s) {
      if (stage !== s) return;
      sparkleAt(s, null, null, 16);
      var btn = s.card.querySelector('[data-la="cast"]');
      btn.classList.remove('laFlick');
      void btn.offsetWidth;
      btn.classList.add('laFlick');
      if (!s.ready) { s.pendingCast = true; hint(s, '✨ Waiting for the app to wake up…'); return; }
      sendCast(s);
    }
    function sendCast(s) {
      if (stage !== s || !s.frame || !s.frame.contentWindow) return;
      s.casts++;
      try { s.frame.contentWindow.postMessage({ polymath: 'wand', action: 'cast', n: s.casts }, '*'); } catch (e) {}
    }
    function hint(s, text) {
      var h = s.card.querySelector('.laHint');
      if (!h) return;
      h.textContent = text;
      h.classList.add('show');
      clearTimeout(s.hintTimer);
      s.hintTimer = setTimeout(function () { if (h) h.classList.remove('show'); }, HINT_MS);
    }
    /* The wand sweeps across the stage in an arc, trailing gold, and the
       spell bursts in the middle. Reduced motion: a soft glow and done. */
    function spell(s, done) {
      var layer = s.card.querySelector('.laSpell');
      layer.innerHTML = '';
      if (s.reduce) {
        layer.classList.add('laGlow');
        later(s, function () { layer.classList.remove('laGlow'); done(); }, 260);
        return;
      }
      var wand = document.createElement('div');
      wand.className = 'laFlyWand';
      wand.innerHTML = WAND_SVG;
      layer.appendChild(wand);
      var r = layer.getBoundingClientRect();
      var W = r.width || 800, H = r.height || 500;
      var t0 = (root.performance && performance.now) ? performance.now() : Date.now();
      var lastTrail = 0;
      function frame(now) {
        if (stage !== s) return;
        var t = Math.min(1, (now - t0) / SPELL_MS);
        var e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        var px = W * (0.08 + 0.42 * e);
        var py = H * (0.78 - 0.5 * Math.sin(e * Math.PI * 0.95)) + (t > 0.8 ? (t - 0.8) * H * 0.4 : 0);
        var rot = -38 + 70 * e;
        wand.style.transform = 'translate(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px) rotate(' + rot.toFixed(1) + 'deg)';
        if (now - lastTrail > 34) { lastTrail = now; sparkleAt(s, px + 6, py + 6, 2, true); }
        if (t < 1) requestAnimationFrame(frame);
        else {
          burst(s, W * 0.5, H * 0.46);
          wand.classList.add('laGone');
          later(s, function () { wand.remove(); }, 400);
          done();
        }
      }
      requestAnimationFrame(frame);
    }
    function sparkleAt(s, x, y, n, small) {
      var layer = s.card.querySelector('.laSpell');
      if (!layer || s.reduce) return;
      var r = layer.getBoundingClientRect();
      if (x == null) { x = r.width * 0.5; y = r.height * 0.5; }
      for (var i = 0; i < n; i++) {
        var p = document.createElement('span');
        p.className = 'laSpark' + (small ? ' sm' : '');
        var ang = Math.random() * Math.PI * 2, dist = (small ? 12 : 60) + Math.random() * (small ? 30 : 140);
        p.style.left = x + 'px';
        p.style.top = y + 'px';
        p.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
        p.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
        p.style.setProperty('--d', (small ? 520 : 760 + Math.random() * 500).toFixed(0) + 'ms');
        p.innerHTML = SPARK_SVG;
        layer.appendChild(p);
        (function (node) { setTimeout(function () { node.remove(); }, 1400); })(p);
      }
    }
    function burst(s, x, y) {
      var layer = s.card.querySelector('.laSpell');
      if (!layer) return;
      var ring = document.createElement('span');
      ring.className = 'laRing';
      ring.style.left = x + 'px';
      ring.style.top = y + 'px';
      layer.appendChild(ring);
      setTimeout(function () { ring.remove(); }, 1000);
      sparkleAt(s, x, y, 28);
    }
    function closeStage() {
      if (!stage) return;
      var s = stage;
      stage = null;
      s.timers.forEach(clearTimeout);
      clearTimeout(s.hintTimer);
      if (s.onMessage) root.removeEventListener('message', s.onMessage);
      // Drop the frame first: an app's audio and timers end with its document.
      if (s.frame) { try { s.frame.srcdoc = ''; } catch (e) {} s.frame.remove(); }
      s.back.remove();
    }

    return {
      openAdder: openAdder,
      open: open,
      cast: function () { if (stage) cast(stage); },
      close: function () { closeStage(); closeAdder(); },
      isOpen: function () { return !!(stage || adder); },
      stageOpen: function () { return !!stage; },
      /* The person changed: the teacher's adder never stays in a student's
         hands, and a stage opened by one person is not left for the next. */
      roleChanged: function () { closeStage(); closeAdder(); },
      worksheetChanged: function () { closeStage(); closeAdder(); },
      /* An annotation was removed: a stage showing it goes with it. */
      annotationGone: function (id) { if (stage && stage.id === id) closeStage(); },
      paintCover: paintCover
    };
  }

  var WAND_SVG = '<svg viewBox="0 0 32 32" width="84" height="84" aria-hidden="true">' +
    '<path d="M11.5 11.5L29 29" stroke="#FFFFFF" stroke-width="6.2" stroke-linecap="round"/>' +
    '<path d="M11.5 11.5L29 29" stroke="#2D1F14" stroke-width="3.4" stroke-linecap="round"/>' +
    '<path d="M11.5 11.5L15.4 15.4" stroke="#F6E7C8" stroke-width="3.4" stroke-linecap="round"/>' +
    '<path d="M7 0.6L8.7 5.3L13.4 7L8.7 8.7L7 13.4L5.3 8.7L0.6 7L5.3 5.3Z" fill="#F6C343" stroke="#8A5E00" stroke-width="0.9" stroke-linejoin="round"/>' +
    '<circle cx="7" cy="7" r="1.5" fill="#FFFFFF"/></svg>';
  var SPARK_SVG = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 0.6L8.7 5.3L13.4 7L8.7 8.7L7 13.4L5.3 8.7L0.6 7L5.3 5.3Z" fill="#F6C343"/><circle cx="7" cy="7" r="1.4" fill="#FFFFFF"/></svg>';

  var api = { create: create, pure: pure, paintCover: paintCover };
  root.LivingApps = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
