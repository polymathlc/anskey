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
  var SPELL_MS = 1150;                 // the wand's sweep before the app shows
  var CAST_DELAY_MS = 520;             // after the frame loads, before the first cast
  var HINT_MS = 3600;
  var LIBRARY_WAIT_MS = 9000;          // ☁ how long a page waits on the library save

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


  /* 📝 The trusted half of "as a question" (v1.180.0), inside the sandbox
     beside the wand. Asked {polymath:'harvest'} by the page that owns the
     frame — and nobody else — it reads the app AS IT IS DRAWN: its words in
     reading order (headings, paragraphs, list items; never a button, a
     slider, a label, a wand or anything hidden), every table as rows of
     cells, every inline SVG with its computed colours written onto it (an
     SVG drawn as a picture never sees the app's stylesheet), every canvas
     and every picture as a PNG. It replies {polymath:'harvest-result'}.
     It sends nothing anywhere else, and the page cleans everything it gets
     (LivingQuestion.pure.cleanHarvest) before any of it reaches paper. */
  var HARVEST_BRIDGE = [
    '(function(){',
    '  "use strict";',
    '  var SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|BUTTON|INPUT|SELECT|TEXTAREA|OPTION|LABEL|NAV|IFRAME|AUDIO|VIDEO|OBJECT|EMBED|DIALOG|HEAD|META|LINK|TITLE|DETAILS|SUMMARY|KBD|FORM|MENU|ASIDE|FOOTER)$/;',
    '  var CHROME_WORDS = /^(btn|button|buttons|controls?|toolbar|toolbars|hints?|tips?|help|stuck|scaffolds?|scaffolding|feedback|solutions?|reveal|reveals|answers|answerkey|working|workings|status|toast|toasts|badge|badges|chip|chips|pill|pills|kicker|eyebrow|tag|tags|kbd|shortcut|shortcuts|instructions?|nav|tabs?|steps|stepper|checks?|checker|marking|score|scores|progress|meta|stats|logo|logos|logotype|brand|branding|wordmark|masthead|emblem)$/i;',
    '  var SKIP_ROLE = /^(button|slider|toolbar|menu|menubar|tablist|tab|switch|checkbox|radio|spinbutton|navigation|dialog|status|alert|progressbar)$/;',
    '  var MAX_NODES = 8000, MAX_TEXT = 6000, MAX_GRAPHICS = 8, MAX_SVG = 400000, MAX_PNG = 2500000, MIN_W = 36, MIN_H = 28;',
    '  var SVG_PROPS = ["fill","fill-opacity","fill-rule","stroke","stroke-width","stroke-opacity","stroke-dasharray","stroke-linecap","stroke-linejoin","opacity","font-size","font-family","font-weight","font-style","text-anchor","dominant-baseline","letter-spacing","visibility","display","marker-start","marker-mid","marker-end","stop-color","stop-opacity"];',
    '  function css(el){ try { return window.getComputedStyle(el); } catch (e) { return null; } }',
    '  function hidden(el, s){',
    '    if (!s) return false;',
    '    if (s.display === "none" || s.visibility === "hidden" || s.visibility === "collapse") return true;',
    '    if (Number(s.opacity) === 0) return true;',
    '    if (el.getAttribute && (el.getAttribute("aria-hidden") === "true" || el.hasAttribute("hidden") || el.hasAttribute("data-polymath-skip"))) return true;',
    '    return false;',
    '  }',
    '  function chrome(el){',
    '    var role = el.getAttribute && el.getAttribute("role");',
    '    if (role && SKIP_ROLE.test(role)) return true;',
    '    if (el.getAttribute && (el.hasAttribute("data-polymath-wand") || el.hasAttribute("data-wand") || el.hasAttribute("data-polymath-play"))) return true;',
    '    var c = typeof el.className === "string" ? el.className : (el.className && el.className.baseVal) || "";',
    '    if (/(^|\\s)(btn-wand|btn-play|polymath-skip)(\\s|$)/.test(c)) return true;',
    '    if (/model[\\s_-]*(working|answer|solution)/i.test(c + " " + (el.id || ""))) return true;',
    '    var bits = (c + " " + (el.id || "")).split(/[\\s_-]+/);',
    '    for (var i = 0; i < bits.length; i++) if (bits[i] && CHROME_WORDS.test(bits[i])) return true;',
    '    var live = el.getAttribute && el.getAttribute("aria-live");',
    '    return live === "polite" || live === "assertive";',
    '  }',
    '  var LOGO_WORDS = /(^|[^a-z])(logo|logos|logotype|brand|branding|wordmark|emblem|masthead|crest|polymath)([^a-z]|$)/i;',
    '  function logo(el){',
    '    if (!el.getAttribute) return false;',
    '    var c = typeof el.className === "string" ? el.className : (el.className && el.className.baseVal) || "";',
    '    var src = el.getAttribute("src") || "";',
    '    if (/^data:/i.test(src)) src = "";',
    '    var words = [c, el.id || "", el.getAttribute("alt") || "", el.getAttribute("aria-label") || "", el.getAttribute("title") || "", src.split(/[?#]/)[0].split("/").pop()].join(" ");',
    '    if (LOGO_WORDS.test(words)) return true;',
    '    var t = el.querySelector && el.querySelector("title");',
    '    if (t && LOGO_WORDS.test(t.textContent || "")) return true;',
    '    return !!(el.closest && el.closest("header,[role=banner]"));',
    '  }',
    '  function clean(t){ return String(t || "").replace(/[ \\t ]+/g, " ").replace(/ *\\n */g, "\\n").replace(/\\n{3,}/g, "\\n\\n").trim(); }',
    '  function numberSvg(clone, orig){',
    '    var s = css(orig);',
    '    if (s) {',
    '      var bits = [];',
    '      for (var i = 0; i < SVG_PROPS.length; i++) {',
    '        var v = s.getPropertyValue(SVG_PROPS[i]);',
    '        if (v && v !== "normal" && v !== "auto") bits.push(SVG_PROPS[i] + ":" + v);',
    '      }',
    '      var own = clone.getAttribute("style");',
    '      clone.setAttribute("style", bits.join(";") + (own ? ";" + own : ""));',
    '    }',
    '    var a = orig.children || [], b = clone.children || [];',
    '    for (var k = 0; k < a.length && k < b.length; k++) numberSvg(b[k], a[k]);',
    '  }',
    '  function svgOf(el, r){',
    '    var c = el.cloneNode(true);',
    '    try { numberSvg(c, el); } catch (e) {}',
    '    var w = Math.round(r.width), h = Math.round(r.height);',
    '    if (!c.getAttribute("viewBox")) c.setAttribute("viewBox", "0 0 " + w + " " + h);',
    '    c.setAttribute("width", w); c.setAttribute("height", h);',
    '    c.setAttribute("xmlns", "http://www.w3.org/2000/svg");',
    '    var out = "";',
    '    try { out = new XMLSerializer().serializeToString(c); } catch (e) { out = c.outerHTML || ""; }',
    '    if (!out || out.length > MAX_SVG) return null;',
    '    return { kind: "svg", svg: out, w: w, h: h };',
    '  }',
    '  function pngOf(src, w, h){ return src && src.length <= MAX_PNG && /^data:image\\//.test(src) ? { kind: "png", src: src, w: w, h: h } : null; }',
    '  function canvasOf(el, r){',
    '    try { return pngOf(el.toDataURL("image/png"), Math.round(r.width), Math.round(r.height)); } catch (e) { return null; }',
    '  }',
    '  function imgOf(el, r){',
    '    var src = el.currentSrc || el.src || "";',
    '    if (/^data:image\\//.test(src)) return pngOf(src, Math.round(r.width), Math.round(r.height));',
    '    try {',
    '      if (!el.complete || !el.naturalWidth) return null;',
    '      var c = document.createElement("canvas");',
    '      c.width = Math.min(1600, el.naturalWidth); c.height = Math.round(c.width * el.naturalHeight / el.naturalWidth);',
    '      c.getContext("2d").drawImage(el, 0, 0, c.width, c.height);',
    '      return pngOf(c.toDataURL("image/png"), Math.round(r.width), Math.round(r.height));',
    '    } catch (e) {}',
    '    return /^https:\\/\\//.test(src) ? { kind: "url", src: src, w: Math.round(r.width), h: Math.round(r.height) } : null;',
    '  }',
    '  function cellText(td){ return clean(td.innerText != null ? td.innerText : td.textContent).replace(/\\n+/g, " "); }',
    '  function tableOf(el){',
    '    var rows = [], trs = el.querySelectorAll("tr");',
    '    for (var i = 0; i < trs.length && rows.length < 30; i++) {',
    '      var tr = trs[i], s = css(tr);',
    '      if (hidden(tr, s)) continue;',
    '      var cells = [], head = false, tds = tr.children;',
    '      for (var j = 0; j < tds.length && cells.length < 10; j++) {',
    '        if (!/^(TD|TH)$/.test(tds[j].tagName)) continue;',
    '        if (tds[j].tagName === "TH") head = true;',
    '        var inp = tds[j].querySelector("input,select,textarea");',
    '        cells.push(inp && !cellText(tds[j]) ? "" : cellText(tds[j]));',
    '      }',
    '      if (cells.length) rows.push({ head: head || tr.parentNode.tagName === "THEAD", cells: cells });',
    '    }',
    '    var cap = el.querySelector("caption");',
    '    return rows.length ? { kind: "table", rows: rows, caption: cap ? cellText(cap) : "" } : null;',
    '  }',
    '  function harvest(){',
    '    var blocks = [], buf = "", nodes = 0, graphics = 0, textLen = 0, head = 0;',
    '    function flush(){',
    '      var t = clean(buf); buf = "";',
    '      if (!t || textLen > MAX_TEXT) return;',
    '      textLen += t.length;',
    '      var b = { kind: "text", text: t };',
    '      if (head) b.head = head;',
    '      blocks.push(b);',
    '    }',
    '    function graphic(g){ if (g && graphics < MAX_GRAPHICS) { graphics++; flush(); blocks.push(g); } }',
    '    function walk(node, depth, li){',
    '      if (nodes++ > MAX_NODES || depth > 60) return;',
    '      if (node.nodeType === 3) { buf += node.nodeValue; return; }',
    '      if (node.nodeType !== 1) return;',
    '      var el = node, tag = String(el.tagName || "").toUpperCase();',
    '      if (SKIP.test(tag) || el.id === "polymath-question") return;',
    '      var s = css(el);',
    '      if (hidden(el, s) || chrome(el)) return;',
    '      var disp = s ? s.display : "block";',
    '      var block = !/^inline/.test(disp) && disp !== "contents";',
    '      var boxy = /^inline-/.test(disp);',
    '      var r = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };',
    '      if (/^(SVG|CANVAS|IMG|PICTURE)$/.test(tag) && logo(el)) return;',
    '      if (tag === "SVG") { if (r.width >= MIN_W && r.height >= MIN_H) graphic(svgOf(el, r)); return; }',
    '      if (tag === "CANVAS") { if (r.width >= MIN_W && r.height >= MIN_H) graphic(canvasOf(el, r)); return; }',
    '      if (tag === "IMG") { if (r.width >= MIN_W && r.height >= MIN_H) graphic(imgOf(el, r)); return; }',
    '      if (tag === "TABLE") { var t = tableOf(el); if (t && graphics < MAX_GRAPHICS) { graphics++; flush(); blocks.push(t); } return; }',
    '      if (tag === "BR") { buf += "\\n"; return; }',
    '      if (block) flush();',
    '      var wasHead = head, hm = /^H([1-6])$/.exec(tag);',
    '      if (hm) head = Number(hm[1]);',
    '      else if (block && !head && /(^|[\\s_-])(title|heading|headline)([\\s_-]|$)/i.test((typeof el.className === "string" ? el.className : "") + " " + (el.id || ""))) head = 1;',
    '      if (boxy) buf += " ";',
    '      if (tag === "LI") {',
    '        var p = el.parentNode, ord = p && p.tagName === "OL";',
    '        if (ord) { var n = 1, sib = el; while ((sib = sib.previousElementSibling)) if (sib.tagName === "LI") n++; buf += n + ". "; }',
    '        else buf += "• ";',
    '      }',
    '      var kids = el.childNodes;',
    '      for (var i = 0; i < kids.length; i++) walk(kids[i], depth + 1);',
    '      if (boxy) buf += " ";',
    '      if (block) flush();',
    '      head = wasHead;',
    '    }',
    '    if (document.body) walk(document.body, 0);',
    '    flush();',
    '    return { blocks: blocks, title: clean(document.title), w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight };',
    '  }',
    '  window.addEventListener("message", function(e){',
    '    if (e.source !== parent) return;',
    '    var d = e.data;',
    '    if (!d || d.polymath !== "harvest") return;',
    '    var out;',
    '    try { out = harvest(); } catch (err) { out = { blocks: [], error: String(err && err.message || err) }; }',
    '    out.polymath = "harvest-result"; out.id = d.id;',
    '    try { parent.postMessage(out, "*"); } catch (e2) {}',
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
      '<script>' + HARVEST_BRIDGE + '<\/script>' +
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

  /* ---------------------------------------------------------------
     📲 Hosted for a QR code (v1.163.0)
     An exported worksheet carries a QR code beside every living app. The
     app is put in Firebase Storage under its own content hash
     (`pdf-annotator/living-<hash>.json`), and the code opens living.html,
     which downloads it by its download token and runs it in the very same
     sandbox and stage. Content-addressed: the same app is one file however
     many worksheets carry it, and a changed app is a new file — so a printed
     code never starts showing a different app.
     --------------------------------------------------------------- */
  var PUBLISH_DIR = 'pdf-annotator';
  var PUBLISH_PREFIX = 'living-';
  var VIEWER_PAGE = 'living.html';
  var BUCKET = 'mathgen--app.firebasestorage.app';
  var HASH_RE = /^la1-\d{1,7}-[0-9a-f]{1,8}$/;
  var TOKEN_RE = /^[0-9A-Za-z-]{16,80}$/;
  var QR_LABEL = 'Scan to open the app';

  function validHash(h) { return typeof h === 'string' && HASH_RE.test(h); }
  function validToken(t) { return typeof t === 'string' && TOKEN_RE.test(t); }
  function publishPath(hash) {
    return validHash(hash) ? PUBLISH_DIR + '/' + PUBLISH_PREFIX + hash + '.json' : '';
  }
  /* What is stored: the app and nothing else — never the worksheet, the
     teacher or the page. */
  function publishPayload(app) {
    if (!validApp(app)) return '';
    var hash = contentHash(app.html);
    return JSON.stringify({ v: 1, title: cleanTitle(app.title) || 'Living app', html: app.html, hash: hash });
  }
  /* The download token Firebase put on the object, read off its download
     URL. Only the token is kept: the rest of the URL is rebuilt from the
     bucket and the hash, so a QR code can never be pointed elsewhere. */
  function tokenFromDownloadUrl(url) {
    var m = /[?&]token=([^&#]+)/.exec(String(url || ''));
    var t = m ? decodeURIComponent(m[1]) : '';
    return validToken(t) ? t : '';
  }
  function mediaUrl(hash, token, bucket) {
    var p = publishPath(hash);
    if (!p || !validToken(token)) return '';
    return 'https://firebasestorage.googleapis.com/v0/b/' + (bucket || BUCKET) + '/o/' +
      encodeURIComponent(p) + '?alt=media&token=' + encodeURIComponent(token);
  }
  /* 📲 A simpler code (v1.165.0). The link used to spell out the hash and
     the Storage token (`?a=la1-1588-46b240d4&t=<36-character token>`), about
     105 characters, which made a dense 45 × 45 code that phones struggled to
     read off paper. The same facts packed as bytes are 23 bytes: the app's
     length (3), its FNV hash (4) and the token's 16 bytes, written as 31
     base64url characters after a bare `?`. The whole link is then about 76
     characters, a 33 × 33 code at low error correction. A token that is not
     a UUID (Storage has only ever issued UUIDs) keeps the long form, and the
     viewer still reads every long link already printed. */
  var CODE_RE = /^[A-Za-z0-9_-]{31}$/;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function bytesToB64u(bytes) {
    var out = '', i;
    for (i = 0; i < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      var left = bytes.length - i;
      out += B64U[(n >> 18) & 63] + B64U[(n >> 12) & 63];
      if (left > 1) out += B64U[(n >> 6) & 63];
      if (left > 2) out += B64U[n & 63];
    }
    return out;
  }
  function b64uToBytes(str) {
    var bytes = [], bits = 0, acc = 0;
    for (var i = 0; i < str.length; i++) {
      var v = B64U.indexOf(str[i]);
      if (v < 0) return null;
      acc = (acc << 6) | v;
      bits += 6;
      if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); }
    }
    return bytes;
  }
  function packCode(hash, token) {
    if (!validHash(hash) || typeof token !== 'string' || !UUID_RE.test(token)) return '';
    var parts = hash.split('-');
    var len = Number(parts[1]), h = parseInt(parts[2], 16);
    if (!(len >= 0 && len < 16777216) || !(h >= 0 && h <= 4294967295)) return '';
    var bytes = [(len >>> 16) & 255, (len >>> 8) & 255, len & 255,
      (h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255];
    var hex = token.replace(/-/g, '');
    for (var i = 0; i < 32; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
    return bytesToB64u(bytes);
  }
  function unpackCode(code) {
    if (typeof code !== 'string' || !CODE_RE.test(code)) return null;
    var b = b64uToBytes(code);
    if (!b || b.length !== 23) return null;
    var len = (b[0] << 16) | (b[1] << 8) | b[2];
    var h = ((b[3] << 24) | (b[4] << 16) | (b[5] << 8) | b[6]) >>> 0;
    var hex = '';
    for (var i = 7; i < 23; i++) hex += ('0' + b[i].toString(16)).slice(-2);
    var token = hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
    var hash = 'la1-' + len + '-' + h.toString(16);
    return validHash(hash) && validToken(token) ? { hash: hash, token: token } : null;
  }
  /* The link the QR code carries: living.html beside the page, then the
     packed code (or, for a token that cannot be packed, the hash and token
     spelled out). */
  function viewerUrl(pageHref, hash, token) {
    if (!validHash(hash) || !validToken(token)) return '';
    var base = String(pageHref || '').split('#')[0].split('?')[0];
    base = base.replace(/[^/]*$/, '');
    var code = packCode(hash, token);
    return base + VIEWER_PAGE + '?' + (code || 'a=' + hash + '&t=' + token);
  }
  function parseViewerQuery(search) {
    var bare = String(search || '').replace(/^\?/, '').split('&')[0];
    if (CODE_RE.test(bare)) return unpackCode(bare);
    var q = {};
    String(search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      var k = i < 0 ? kv : kv.slice(0, i);
      var v = i < 0 ? '' : kv.slice(i + 1);
      try { q[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) {}
    });
    var hash = q.a || '', token = q.t || '';
    return validHash(hash) && validToken(token) ? { hash: hash, token: token } : null;
  }
  /* The downloaded file, checked: it must be an app, and the app must be the
     one the code was printed for. */
  function readPublished(text, hash) {
    var d = null;
    try { d = JSON.parse(String(text || '')); } catch (e) { return { ok: false, message: 'That app file could not be read.' }; }
    if (!d || typeof d !== 'object' || !validApp(d)) return { ok: false, message: 'That app file is empty or damaged.' };
    if (contentHash(d.html) !== hash) return { ok: false, message: 'That app file is not the one this code was printed for.' };
    return { ok: true, app: { v: 1, title: cleanTitle(d.title) || titleFromHtml(d.html) || 'Living app', html: d.html, hash: hash, wand: hasWand(d.html), at: 0 } };
  }
  /* The hosted copy an annotation already has, when it is still this app. */
  function publishedFor(app) {
    var p = app && app.pub;
    if (!validApp(app) || !p || !validToken(p.token) || p.hash !== contentHash(app.html)) return null;
    return { hash: p.hash, token: p.token };
  }
  /* Where the QR code sits on the cover, in PDF points (origin bottom-left):
     on a white pad over the wand's corner at the LEFT of the cover, centred
     top to bottom, so the app's title stays readable. A small cover gets a
     smaller code; it never spills off the cover. */
  function qrOnCover(rx, ry, rw, rh) {
    var pad = 4, label = 9;
    var size = Math.min(86, rh - pad * 2 - label - 6, rw * 0.32);
    size = Math.max(24, size);
    var padW = size + pad * 2, padH = size + pad + label;
    var padX = rx + Math.max(4, Math.min(rw * 0.035, 14));
    var padY = ry + Math.max(2, (rh - padH) / 2);
    return { x: r2(padX + pad), y: r2(padY + label), size: r2(size), padX: r2(padX), padY: r2(padY), padW: r2(padW), padH: r2(padH) };
  }
  /* 🪄 THE CORNER (v1.181.0, v1.182.0). A living app's picture keeps a
     small square at its TOP RIGHT, in a white gutter beside the question,
     so it never covers a word: the QR code that opens the app, drawn into
     the picture itself whenever the app already has its hosted copy, with
     "living app" in small type under it and the premium wand beside those
     words. On paper the QR is drawn again, as vector squares, on exactly
     the same square. Kept on the annotation as `lqr` — the SQUARE, as
     fractions of the picture's own width and height, so it follows every
     resize. The label sits under it, inside the picture. */
  var CORNER_GUTTER = 84;          // CSS px of gutter beside a 600 px question
  var CORNER_INSET = 6;
  var CORNER_LABEL_H = 14;         // the "🪄 living app" line under the square
  var CORNER_LABEL = 'living app';
  /* The height a picture needs so its corner gets the full square and its
     label: what paintCover makes a short card at least. */
  function cornerMinHeight(gutter) {
    var g = Math.max(24, Number(gutter) || CORNER_GUTTER);
    return CORNER_INSET * 2 + (g - CORNER_INSET * 2) + CORNER_LABEL_H;
  }
  function cornerFor(w, h, gutter) {
    var W = Math.max(1, Number(w) || 0), H = Math.max(1, Number(h) || 0);
    var g = Math.max(24, Math.min(W * 0.4, Number(gutter) || CORNER_GUTTER));
    var size = Math.max(12, Math.min(g - CORNER_INSET * 2, H - CORNER_INSET * 2 - CORNER_LABEL_H));
    return {
      x: Math.round((W - CORNER_INSET - size) / W * 10000) / 10000,
      y: Math.round(CORNER_INSET / H * 10000) / 10000,
      s: Math.round(size / W * 10000) / 10000
    };
  }
  /* Where the label goes, in the picture's own pixels: the line under the
     square, as wide as the gutter allows, centred on the square. */
  function cornerLabelBox(w, h, corner) {
    var c = cleanCorner(corner);
    if (!c) return null;
    var W = Math.max(1, Number(w) || 0), H = Math.max(1, Number(h) || 0);
    var size = c.s * W, top = c.y * H + size + 2;
    var room = H - top - 1;
    if (room < 7) return null;
    var lh = Math.min(CORNER_LABEL_H - 2, room);
    var cx = c.x * W + size / 2;
    var half = Math.min(W - cx - 1, size / 2 + CORNER_INSET);
    return { x: r2(cx - half), y: r2(top), w: r2(half * 2), h: r2(lh), cx: r2(cx) };
  }
  /* The one door into `lqr`: three fractions, the square inside the box. */
  function cleanCorner(c) {
    if (!c || typeof c !== 'object') return null;
    var x = Number(c.x), y = Number(c.y), sz = Number(c.s);
    if (![x, y, sz].every(function (n) { return isFinite(n); })) return null;
    // Up to BADGE_SQUARE_MAX (v1.192.0): the folded badge IS a square
    // with a label under it, so its corner covers most of its width.
    if (sz <= 0 || sz > BADGE_SQUARE_MAX || x < 0 || y < 0 || x + sz > 1.0001 || y > 1) return null;
    return { x: x, y: y, s: sz };
  }
  /* Where the code goes on paper, in PDF points (origin bottom-left), for a
     picture whose box is rect and whose corner is c: a plain square, no
     pad, no label — the gutter round it is white already. */
  function qrInCorner(rect, c) {
    c = cleanCorner(c);
    if (!c || !rect) return null;
    var size = c.s * rect.w;
    var x = rect.x + c.x * rect.w;
    var top = rect.y + rect.h - c.y * rect.h;
    size = Math.min(size, top - rect.y);
    if (!(size > 4)) return null;
    return { x: r2(x), y: r2(top - size), size: r2(size) };
  }

  /* Draws the code on a pdf-lib page with a link over the whole cover.
     `matrixOf(url)` is the QR maker (QuestionBank.pure.qrMatrix on the page),
     `runsOf(matrix)` its run-length helper. Returns false and draws nothing
     without them. */
  function drawQrOnPdf(pdfDoc, page, url, lib, font, rect, matrixOf, runsOf, corner) {
    var matrix = typeof matrixOf === 'function' ? matrixOf(url) : null;
    if (!matrix || !page || !lib || !rect || typeof runsOf !== 'function') return false;
    var rgb = lib.rgb, n = matrix.length;
    // 🪄 A picture with a corner (v1.181.0) gets a small plain square there.
    var sq = qrInCorner(rect, corner);
    var at = sq || qrOnCover(rect.x, rect.y, rect.w, rect.h);
    var quiet = sq ? 1 : 2;
    var cell = at.size / (n + quiet * 2);
    page.drawRectangle(sq
      ? { x: at.x, y: at.y, width: at.size, height: at.size, color: rgb(1, 1, 1) }
      : { x: at.padX, y: at.padY, width: at.padW, height: at.padH, color: rgb(1, 1, 1), borderColor: rgb(0.85, 0.72, 0.3), borderWidth: 0.8 });
    runsOf(matrix).forEach(function (run) {
      page.drawRectangle({
        x: at.x + (quiet + run.c) * cell,
        y: at.y + at.size - (quiet + run.r + 1) * cell,
        width: run.len * cell + 0.01, height: cell + 0.01, color: rgb(0, 0, 0)
      });
    });
    if (font && !sq) {
      var fs = Math.max(4.6, Math.min(6.2, at.size / 13));
      var tw = font.widthOfTextAtSize(QR_LABEL, fs);
      page.drawText(QR_LABEL, { x: at.x + (at.size - tw) / 2, y: at.padY + 3, size: fs, font: font, color: rgb(0.3, 0.3, 0.28) });
    }
    try {
      var ref = pdfDoc.context.register(pdfDoc.context.obj({
        Type: 'Annot', Subtype: 'Link', Rect: [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h],
        Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: lib.PDFString.of(url) }
      }));
      var annots = page.node.lookup(lib.PDFName.of('Annots'));
      if (annots) annots.push(ref);
      else page.node.set(lib.PDFName.of('Annots'), pdfDoc.context.obj([ref]));
    } catch (e) { /* the code still scans without the link */ }
    return true;
  }

  /* 📲 The stage's own QR code (v1.164.0): a QR matrix as one SVG path,
     with the four-module quiet zone a phone camera needs. Dark modules are
     merged into runs, so a 41 × 41 code is a few hundred path commands. */
  function qrSvg(matrix) {
    if (!matrix || !matrix.length) return '';
    var n = matrix.length, q = 4, size = n + q * 2, d = '';
    for (var r = 0; r < n; r++) {
      var row = matrix[r] || [], c = 0;
      while (c < n) {
        if (!row[c]) { c++; continue; }
        var start = c;
        while (c < n && row[c]) c++;
        d += 'M' + (start + q) + ' ' + (r + q) + 'h' + (c - start) + 'v1h-' + (c - start) + 'z';
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges" role="img" aria-label="QR code">' +
      '<rect width="' + size + '" height="' + size + '" fill="#fff"/><path fill="#111" d="' + d + '"/></svg>';
  }

  /* 📲 The QR matrix a living app's corner shows, or null: only an app
     that already has its hosted copy (publishedFor — the hash must match the
     html, so a changed app never shows the old code), for the SAME viewer
     link the printed code and the stage's code use. `matrixOf` defaults to
     the question bank's QR maker. */
  function qrMatrixFor(app, pageHref, matrixOf) {
    var pub = publishedFor(app);
    if (!pub) return null;
    var href = pageHref != null ? pageHref : (root.location ? root.location.href : '');
    var url = viewerUrl(href, pub.hash, pub.token);
    if (!url) return null;
    var make = typeof matrixOf === 'function' ? matrixOf
      : (root.QuestionBank && root.QuestionBank.pure && root.QuestionBank.pure.qrMatrix);
    if (typeof make !== 'function') return null;
    try { var m = make(url); return m && m.length ? m : null; } catch (e) { return null; }
  }

  /* ---------------------------------------------------------------
     📲 FOLDED: A LIVING APP IS A QR CODE UNTIL IT IS SHOWN (v1.192.0)
     ---------------------------------------------------------------
     Zhi Kai: "The living app should only show the diagram and question and
     title when I click show. If not the living app should only be a QR code
     with the words living app below it."

     So a living app on the page is FOLDED by default: its picture is a small
     BADGE — the QR code that opens the app, in a square, with "Living app"
     under it — and nothing else. 👁 Show on its bar unfolds it to the full
     picture (the title, the diagram, the question); 🙈 Hide folds it back.

     The trick is the same one every living app already plays: the folded
     badge is still the ANNOTATION'S OWN PICTURE (`src`, `w`, `h`, `ratio`,
     `lqr`), so the hit test, the handles, move, resize, lock, erase-around,
     lasso, undo, save, thumbnails, the student's tap and both PDF paths
     need nothing new. While folded, the full picture waits on `lfold`
     ({src, w, h, ratio, lqr}); unfolded, `lfold` is deleted, `lview` is
     'open' (so a worksheet saved before folding existed is not folded again
     once somebody chose to show it) and `lmini` remembers how wide the badge
     was, so Hide gives back the badge the teacher sized.
       • `lqr` on the badge is its QR SQUARE, so paper draws the vector code
         exactly over the painted one — a printed badge scans.
       • The badge is anchored at the full picture's TOP-LEFT: Show grows it
         right and down from where the badge sat, and Hide shrinks it back
         to the same corner. Neither ever leaves the paper (`keepOnPage`).
     Everything here is pure and works on plain objects, so the harness
     checks it without a browser. */
  var BADGE_W = 132;                  // CSS px of the painted badge
  var BADGE_INSET = 8;
  var BADGE_LABEL_H = 24;             // the "🪄 Living app" line under the square
  var BADGE_LABEL = 'Living app';
  var BADGE_PAGE_W = 92;              // page units a fresh badge is wide on the page
  var BADGE_PAGE_MIN = 44;            // never narrower than this on the page
  var BADGE_SQUARE_MAX = 0.95;        // cleanCorner's largest square (fraction of width)
  var VIEW_OPEN = 'open';
  /* The badge's own shape, in its painted pixels: the square, the label
     line under it, and the corner (fractions) that becomes `lqr`. */
  function badgeLayout() {
    var W = BADGE_W, size = W - BADGE_INSET * 2;
    var H = BADGE_INSET + size + 4 + BADGE_LABEL_H + BADGE_INSET - 2;
    return {
      w: W, h: H, ratio: W / H, size: size,
      square: { x: BADGE_INSET, y: BADGE_INSET, size: size },
      label: { x: BADGE_INSET, y: BADGE_INSET + size + 4, w: size, h: BADGE_LABEL_H },
      corner: {
        x: Math.round(BADGE_INSET / W * 10000) / 10000,
        y: Math.round(BADGE_INSET / H * 10000) / 10000,
        s: Math.round(size / W * 10000) / 10000
      }
    };
  }
  /* Is this annotation folded to its badge? */
  function isFolded(a) {
    return !!(a && a.lfold && typeof a.lfold === 'object' && typeof a.lfold.src === 'string' && a.lfold.src);
  }
  /* Has someone chosen to show it? (Kept so a worksheet saved before
     folding existed is folded once, and then left as the teacher left it.) */
  function isShownOnPurpose(a) { return !!(a && a.lview === VIEW_OPEN); }
  /* A box kept on a page of pw × ph: moved, never shrunk, unless it is
     bigger than the page itself. */
  function keepOnPage(box, pw, ph) {
    var PW = Number(pw) > 0 ? Number(pw) : 600, PH = Number(ph) > 0 ? Number(ph) : 800;
    var w = Math.max(1, Number(box.w) || 1), h = Math.max(1, Number(box.h) || 1);
    var ratio = w / h;
    if (w > PW - 4) { w = PW - 4; h = w / ratio; }
    if (h > PH - 4) { h = PH - 4; w = h * ratio; }
    var x = Number(box.x) || 0, y = Number(box.y) || 0;
    x = Math.max(2, Math.min(PW - w - 2, x));
    y = Math.max(2, Math.min(PH - h - 2, y));
    return { x: r2(x), y: r2(y), w: r2(w), h: r2(h) };
  }
  /* How wide the badge goes on the page: what the teacher last sized it to
     (`lmini`), else BADGE_PAGE_W — never wider than the full picture was,
     never narrower than BADGE_PAGE_MIN. */
  function badgeWidthFor(a, fullW) {
    var want = Number(a && a.lmini) > 0 ? Number(a.lmini) : BADGE_PAGE_W;
    var cap = Number(fullW) > 0 ? Math.max(BADGE_PAGE_MIN, Number(fullW)) : want;
    return r2(Math.max(BADGE_PAGE_MIN, Math.min(want, cap)));
  }
  /* The full picture an annotation holds right now — on `lfold` while it is
     folded, on the annotation itself when it is shown. */
  function fullPictureOf(a) {
    if (!a) return null;
    if (isFolded(a)) {
      var f = a.lfold;
      return { src: f.src, w: Number(f.w) || a.w, h: Number(f.h) || a.h, ratio: Number(f.ratio) || ((Number(f.w) || 1) / (Number(f.h) || 1)), lqr: cleanCorner(f.lqr) };
    }
    return { src: a.src, w: a.w, h: a.h, ratio: Number(a.ratio) || ((Number(a.w) || 1) / (Number(a.h) || 1)), lqr: cleanCorner(a.lqr) };
  }
  /* FOLD: the full picture goes onto `lfold`, the badge becomes the
     picture. `badge` is paintBadge's answer ({src, ratio, corner}). A
     picture already folded only has its badge repainted. Returns true when
     anything changed. Never touches `lapp`, `lq`, `locked` or the id. */
  function foldAnnotation(a, badge, pw, ph) {
    if (!a || !badge || typeof badge.src !== 'string' || !badge.src) return false;
    var full = fullPictureOf(a);
    if (!full || !full.src) return false;
    var ratio = Number(badge.ratio) > 0 ? Number(badge.ratio) : badgeLayout().ratio;
    if (!isFolded(a)) {
      var keep = { src: full.src, w: r2(full.w), h: r2(full.h), ratio: r2(full.ratio) };
      if (full.lqr) keep.lqr = full.lqr;
      a.lfold = keep;
      var bw = badgeWidthFor(a, full.w);
      var box = keepOnPage({ x: a.x, y: a.y, w: bw, h: bw / ratio }, pw, ph);
      a.x = box.x; a.y = box.y; a.w = box.w; a.h = box.h;
    } else {
      // Repainted in place: the badge keeps the size the teacher gave it.
      a.h = r2(a.w / ratio);
    }
    a.src = badge.src;
    a.ratio = r2(ratio);
    var c = cleanCorner(badge.corner);
    if (c) a.lqr = c; else delete a.lqr;
    a.lfoldQr = !!badge.qr;
    delete a.lview;
    return true;
  }
  /* UNFOLD: the full picture comes back from `lfold`, from the badge's
     top-left corner, kept on the page. The badge's width is remembered on
     `lmini`. Returns true when anything changed. */
  function unfoldAnnotation(a, pw, ph) {
    if (!isFolded(a)) return false;
    var f = a.lfold;
    a.lmini = r2(a.w);
    var w = Number(f.w) > 0 ? Number(f.w) : a.w * 3;
    var ratio = Number(f.ratio) > 0 ? Number(f.ratio) : w / (Number(f.h) || a.h || 1);
    var box = keepOnPage({ x: a.x, y: a.y, w: w, h: w / ratio }, pw, ph);
    a.x = box.x; a.y = box.y; a.w = box.w; a.h = box.h;
    a.src = f.src;
    a.ratio = r2(ratio);
    var c = cleanCorner(f.lqr);
    if (c) a.lqr = c; else delete a.lqr;
    delete a.lfold;
    delete a.lfoldQr;
    a.lview = VIEW_OPEN;
    return true;
  }
  /* A NEW picture for an annotation (✎ Change app, or the picture the page
     swaps in once the app has been read). Folded, it waits on `lfold` and
     the badge stays where it is; shown, it is the picture — the width is
     kept and the height follows the shape, made narrower rather than run
     off the bottom of the page. */
  function setFullPicture(a, pic, pw, ph) {
    if (!a || !pic || typeof pic.src !== 'string' || !pic.src) return false;
    var PH = Number(ph) > 0 ? Number(ph) : 800;
    var ratio = Math.max(0.05, Number(pic.ratio) || 2.3);
    var c = cleanCorner(pic.corner);
    if (isFolded(a)) {
      var fw = Number(a.lfold.w) > 0 ? Number(a.lfold.w) : a.w * 3, fh = fw / ratio;
      var room = Math.max(40, PH - a.y - 8);
      if (fh > room) { fh = room; fw = fh * ratio; }
      var keep = { src: pic.src, w: r2(fw), h: r2(fh), ratio: r2(ratio) };
      if (c) keep.lqr = c;
      a.lfold = keep;
      return true;
    }
    var w = a.w, h = w / ratio;
    var room2 = Math.max(40, PH - a.y - 8);
    if (h > room2) { h = room2; w = h * ratio; }
    a.src = pic.src;
    a.ratio = r2(ratio);
    a.w = r2(w);
    a.h = r2(h);
    if (c) a.lqr = c; else delete a.lqr;
    return true;
  }
  /* Should a picture found on a page be folded now? A worksheet saved
     before folding existed holds its living apps open, with no `lview`:
     those are folded once — unless `answersOn` says model answers were
     written on its working lines (folding would leave them floating over
     nothing). One already folded, or shown on purpose, is left alone. */
  function wantsFold(a, answersOn) {
    if (!a || isFolded(a) || isShownOnPurpose(a)) return false;
    if (typeof a.src !== 'string' || !a.src) return false;
    return !answersOn;
  }

  var pure = {
    MAX_CHARS: MAX_CHARS, TITLE_MAX: TITLE_MAX, COVER_W: COVER_W, COVER_H: COVER_H, CSP: CSP, WAND_BRIDGE: WAND_BRIDGE, HARVEST_BRIDGE: HARVEST_BRIDGE,
    escapeHtml: escapeHtml, cleanTitle: cleanTitle, titleFromHtml: titleFromHtml, titleFromFileName: titleFromFileName,
    looksLikeHtml: looksLikeHtml, hasScript: hasScript, hasWand: hasWand, utf8Bytes: utf8Bytes, sizeText: sizeText,
    contentHash: contentHash, normalizeApp: normalizeApp, validApp: validApp, sandboxDocument: sandboxDocument,
    wrapLines: wrapLines, placeOnPage: placeOnPage, castMessage: castMessage,
    BUCKET: BUCKET, VIEWER_PAGE: VIEWER_PAGE, QR_LABEL: QR_LABEL,
    validHash: validHash, validToken: validToken, publishPath: publishPath, publishPayload: publishPayload,
    tokenFromDownloadUrl: tokenFromDownloadUrl, mediaUrl: mediaUrl, viewerUrl: viewerUrl,
    parseViewerQuery: parseViewerQuery, packCode: packCode, unpackCode: unpackCode, readPublished: readPublished, publishedFor: publishedFor, qrOnCover: qrOnCover, qrSvg: qrSvg,
    CORNER_GUTTER: CORNER_GUTTER, CORNER_LABEL: CORNER_LABEL, CORNER_LABEL_H: CORNER_LABEL_H, cornerFor: cornerFor, cornerMinHeight: cornerMinHeight,
    cornerLabelBox: cornerLabelBox, cleanCorner: cleanCorner, qrInCorner: qrInCorner, qrMatrixFor: qrMatrixFor,
    BADGE_W: BADGE_W, BADGE_LABEL: BADGE_LABEL, BADGE_PAGE_W: BADGE_PAGE_W, BADGE_PAGE_MIN: BADGE_PAGE_MIN,
    BADGE_SQUARE_MAX: BADGE_SQUARE_MAX, VIEW_OPEN: VIEW_OPEN,
    badgeLayout: badgeLayout, isFolded: isFolded, isShownOnPurpose: isShownOnPurpose, keepOnPage: keepOnPage,
    badgeWidthFor: badgeWidthFor, fullPictureOf: fullPictureOf, foldAnnotation: foldAnnotation,
    unfoldAnnotation: unfoldAnnotation, setFullPicture: setFullPicture, wantsFold: wantsFold
  };

  /* ---------------------------------------------------------------
     The cover — the picture that sits on the page.
     --------------------------------------------------------------- */
  function star(x, cx, cy, R, r, fill, stroke, points) {
    var n = (points || 4) * 2;
    x.beginPath();
    for (var i = 0; i < n; i++) {
      var ang = -Math.PI / 2 + i * Math.PI * 2 / n;
      var rad = i % 2 === 0 ? R : r;
      var px = cx + Math.cos(ang) * rad, py = cy + Math.sin(ang) * rad;
      if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.closePath();
    x.fillStyle = fill;
    x.fill();
    if (stroke) { x.lineWidth = Math.max(0.6, R * 0.07); x.strokeStyle = stroke; x.stroke(); }
  }
  function grad(x, x0, y0, x1, y1, stops) {
    var g = x.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(function (st) { g.addColorStop(st[0], st[1]); });
    return g;
  }
  /* 🪄 THE PREMIUM WAND (v1.182.0): a black lacquer stick with a soft
     highlight down its length, two gold ferrules and a gold grip cap, and a
     faceted four-point gold star with a warm halo and two small glints —
     drawn, never an emoji (an emoji draws differently on every device), into
     a square of side `size` whose top-left is (X, Y). No box round it. */
  function drawWand(x, X, Y, size) {
    var u = size / 100;
    function P(px, py) { return [X + px * u, Y + py * u]; }
    x.save();
    x.lineCap = 'round';
    // The stick: from just under the star to the bottom-right.
    var a = P(40, 40), b = P(90, 90);
    x.lineWidth = 13 * u; x.strokeStyle = 'rgba(0,0,0,0.12)';
    x.beginPath(); x.moveTo(a[0] + 1.6 * u, a[1] + 2.4 * u); x.lineTo(b[0] + 1.6 * u, b[1] + 2.4 * u); x.stroke();
    x.lineWidth = 10 * u;
    x.strokeStyle = grad(x, a[0] - 5 * u, a[1] + 5 * u, a[0] + 5 * u, a[1] - 5 * u, [[0, '#050505'], [0.55, '#2b2b30'], [1, '#0c0c0e']]);
    x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke();
    x.lineWidth = 2.2 * u; x.strokeStyle = 'rgba(255,255,255,0.38)';
    x.beginPath(); x.moveTo(a[0] + 6 * u, a[1] + 3.2 * u); x.lineTo(b[0] - 3 * u, b[1] - 5.8 * u); x.stroke();
    // Gold ferrules and the grip cap.
    var gold = grad(x, X, Y, X + size, Y + size, [[0, '#FFF3C4'], [0.35, '#F4C542'], [0.7, '#B7861C'], [1, '#FCE7A0']]);
    [[47, 47], [74, 74]].forEach(function (f) {
      var c = P(f[0], f[1]);
      x.lineCap = 'butt';
      x.lineWidth = 12 * u; x.strokeStyle = gold;
      x.beginPath(); x.moveTo(c[0] - 2.2 * u, c[1] - 2.2 * u); x.lineTo(c[0] + 2.2 * u, c[1] + 2.2 * u); x.stroke();
    });
    x.lineCap = 'round';
    var cap = P(91, 91);
    x.fillStyle = gold;
    x.beginPath(); x.arc(cap[0], cap[1], 6 * u, 0, Math.PI * 2); x.fill();
    x.restore();
    // The halo, the star and its facets.
    var sc = P(30, 30);
    x.save();
    var halo = x.createRadialGradient(sc[0], sc[1], 0, sc[0], sc[1], 34 * u);
    halo.addColorStop(0, 'rgba(255,214,102,0.55)');
    halo.addColorStop(0.45, 'rgba(255,200,64,0.18)');
    halo.addColorStop(1, 'rgba(255,200,64,0)');
    x.fillStyle = halo;
    x.beginPath(); x.arc(sc[0], sc[1], 34 * u, 0, Math.PI * 2); x.fill();
    x.restore();
    star(x, sc[0], sc[1], 27 * u, 7.5 * u,
      grad(x, sc[0] - 27 * u, sc[1] - 27 * u, sc[0] + 27 * u, sc[1] + 27 * u, [[0, '#FFF6CF'], [0.4, '#F7C948'], [0.75, '#C8901A'], [1, '#F9DA7A']]),
      '#7A5200', 4);
    // Facets: the lit upper-left halves of the star's points.
    x.save();
    x.fillStyle = 'rgba(255,255,255,0.45)';
    x.beginPath();
    x.moveTo(sc[0], sc[1] - 27 * u); x.lineTo(sc[0], sc[1]); x.lineTo(sc[0] - 27 * u, sc[1]);
    x.lineTo(sc[0] - 5.3 * u, sc[1] - 5.3 * u); x.closePath(); x.fill();
    x.restore();
    star(x, sc[0], sc[1], 5 * u, 1.8 * u, '#FFFFFF', null, 4);
    var g1 = P(70, 14), g2 = P(12, 70), g3 = P(60, 34);
    star(x, g1[0], g1[1], 8 * u, 1.9 * u, '#F7C948', null, 4);
    star(x, g2[0], g2[1], 6 * u, 1.5 * u, '#E9B43A', null, 4);
    star(x, g3[0], g3[1], 3.6 * u, 1 * u, '#FFE7A3', null, 4);
  }
  /* Draws a QR matrix as squares in a square (X, Y, size) on a canvas, with
     a one-module quiet zone — exactly the code drawQrOnPdf puts on paper. */
  function drawQrSquare(x, matrix, X, Y, size) {
    var n = matrix.length, quiet = 1, cell = size / (n + quiet * 2);
    x.save();
    x.fillStyle = '#FFFFFF';
    x.fillRect(X, Y, size, size);
    // ONE path, filled once: separate fills leave anti-aliased hairline
    // seams between touching rows, which a phone camera can misread.
    x.fillStyle = '#111111';
    x.beginPath();
    for (var r = 0; r < n; r++) {
      var row = matrix[r] || [], c = 0;
      while (c < n) {
        if (!row[c]) { c++; continue; }
        var st = c;
        while (c < n && row[c]) c++;
        x.rect(X + (quiet + st) * cell, Y + (quiet + r) * cell, (c - st) * cell, cell);
      }
    }
    x.fill('nonzero');
    x.restore();
  }
  function roundRectPath(x, X, Y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    x.beginPath();
    x.moveTo(X + r, Y);
    x.arcTo(X + w, Y, X + w, Y + h, r);
    x.arcTo(X + w, Y + h, X, Y + h, r);
    x.arcTo(X, Y + h, X, Y, r);
    x.arcTo(X, Y, X + w, Y, r);
    x.closePath();
  }
  /* 🪄 THE CORNER (v1.182.0): the QR code in its small square — or, for an
     app with no hosted copy yet, a soft gold-edged square with the wand in
     it, which paper still covers with the code — and under it "living app"
     in small type with the premium wand beside the words. From cornerFor's
     fractions, in the picture's own pixels. */
  var LABEL_FONT = '600 9px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
  function drawCornerBadge(x, W, H, corner, matrix) {
    var c = cleanCorner(corner);
    if (!c) return;
    var size = c.s * W, X = c.x * W, Y = c.y * H;
    if (matrix && matrix.length) drawQrSquare(x, matrix, X, Y, size);
    else {
      x.save();
      roundRectPath(x, X + 0.5, Y + 0.5, size - 1, size - 1, Math.max(3, size * 0.12));
      x.fillStyle = '#FFFBEF'; x.fill();
      x.lineWidth = 1; x.strokeStyle = '#E8C766'; x.stroke();
      x.restore();
      drawWand(x, X + size * 0.16, Y + size * 0.16, size * 0.68);
    }
    var lb = cornerLabelBox(W, H, c);
    if (!lb) return;
    x.save();
    var px = Math.max(6, Math.min(9, lb.h * 0.82));
    x.font = LABEL_FONT.replace('9px', px.toFixed(2) + 'px');
    x.textBaseline = 'middle';
    var icon = px * 1.25, gap = px * 0.3;
    var tw = x.measureText(CORNER_LABEL).width;
    var total = icon + gap + tw;
    if (total > lb.w) { px = Math.max(5, px * lb.w / total); x.font = LABEL_FONT.replace('9px', px.toFixed(2) + 'px'); icon = px * 1.25; gap = px * 0.3; tw = x.measureText(CORNER_LABEL).width; total = icon + gap + tw; }
    var left = lb.cx - total / 2, mid = lb.y + lb.h / 2;
    drawWand(x, left, mid - icon / 2, icon);
    x.fillStyle = '#5b5446';
    x.fillText(CORNER_LABEL, left + icon + gap, mid + 0.5);
    x.restore();
  }
  /* Kept for callers from v1.181.0: the corner, with no code. */
  function drawCornerWand(x, W, H, corner, matrix) { drawCornerBadge(x, W, H, corner, matrix); }
  /* The plain picture (v1.181.0): the app's title, in the question bank's
     own type, on white, with the corner at its top right. It is what goes
     on the page the moment an app is added; the page then swaps in the
     picture of what the app really draws (index.html, lappPictureFor). */
  var PLAIN_W = 600, PLAIN_SCALE = 2, PLAIN_PAD = 14, PLAIN_PX = 17;
  var PLAIN_FONT = '-apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
  function paintCover(app) {
    return new Promise(function (resolve, reject) {
      try {
        var probe = document.createElement('canvas').getContext('2d');
        if (!probe) throw new Error('No canvas');
        probe.font = '700 ' + PLAIN_PX + 'px ' + PLAIN_FONT;
        var title = String(app && app.title || 'Living app');
        var lines = wrapLines(title, PLAIN_W - PLAIN_PAD * 2, function (t) { return probe.measureText(t).width; }, 3);
        var lh = PLAIN_PX * 1.42;
        var W = PLAIN_W + CORNER_GUTTER;
        var H = Math.max(cornerMinHeight(CORNER_GUTTER), Math.ceil(PLAIN_PAD * 2 + lines.length * lh));
        var c = document.createElement('canvas');
        c.width = W * PLAIN_SCALE; c.height = H * PLAIN_SCALE;
        var x = c.getContext('2d');
        x.scale(PLAIN_SCALE, PLAIN_SCALE);
        x.fillStyle = '#FFFFFF';
        x.fillRect(0, 0, W, H);
        x.fillStyle = '#1d1d1f';
        x.font = '700 ' + PLAIN_PX + 'px ' + PLAIN_FONT;
        x.textBaseline = 'alphabetic';
        lines.forEach(function (ln, k) { x.fillText(ln, PLAIN_PAD, PLAIN_PAD + k * lh + PLAIN_PX * 1.02); });
        var corner = cornerFor(W, H, CORNER_GUTTER);
        var matrix = qrMatrixFor(app);
        drawCornerBadge(x, W, H, corner, matrix);
        resolve({ src: c.toDataURL('image/png'), ratio: W / H, w: W, h: H, corner: corner, qr: !!matrix });
      } catch (e) { reject(e); }
    });
  }

  /* 📲 THE BADGE (v1.192.0): what a FOLDED living app shows on the page —
     the QR code that opens the app, in its square, and "Living app" under
     it with the premium wand beside the words. Nothing else: no title, no
     diagram, no question (👁 Show brings those). An app with no hosted copy
     yet gets the soft gold-edged square with the wand in it, which paper
     still covers with the real code (its `lqr` is the square), and the page
     repaints it with the code the moment the copy exists. Painted
     synchronously — folding a worksheet saved before folding existed
     happens inside a redraw — and returned as {src, ratio, w, h, corner,
     qr}. paintBadge is the Promise form for callers that await. */
  var BADGE_SCALE = 3;
  var BADGE_FONT = '700 14px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
  function paintBadgeNow(app, matrixOverride) {
    var L = badgeLayout();
    var c = document.createElement('canvas');
    c.width = Math.round(L.w * BADGE_SCALE); c.height = Math.round(L.h * BADGE_SCALE);
    var x = c.getContext('2d');
    if (!x) throw new Error('No canvas');
    x.scale(BADGE_SCALE, BADGE_SCALE);
    // A white card with a thin warm edge, so the badge reads as one thing
    // on a busy page and a white page alike.
    x.fillStyle = '#FFFFFF';
    roundRectPath(x, 0.5, 0.5, L.w - 1, L.h - 1, 10);
    x.fill();
    x.lineWidth = 1; x.strokeStyle = '#EAD9A6'; x.stroke();
    var matrix = matrixOverride !== undefined ? matrixOverride : qrMatrixFor(app);
    var sq = L.square;
    if (matrix && matrix.length) drawQrSquare(x, matrix, sq.x, sq.y, sq.size);
    else {
      x.save();
      roundRectPath(x, sq.x + 0.5, sq.y + 0.5, sq.size - 1, sq.size - 1, Math.max(4, sq.size * 0.1));
      x.fillStyle = '#FFFBEF'; x.fill();
      x.lineWidth = 1.2; x.strokeStyle = '#E8C766'; x.stroke();
      x.restore();
      drawWand(x, sq.x + sq.size * 0.2, sq.y + sq.size * 0.2, sq.size * 0.6);
    }
    var lb = L.label;
    x.save();
    var px = 14;
    x.font = BADGE_FONT;
    x.textBaseline = 'middle';
    var icon = px * 1.3, gap = px * 0.35;
    var tw = x.measureText(BADGE_LABEL).width, total = icon + gap + tw;
    if (total > lb.w) {
      px = Math.max(8, px * lb.w / total);
      x.font = BADGE_FONT.replace('14px', px.toFixed(2) + 'px');
      icon = px * 1.3; gap = px * 0.35; tw = x.measureText(BADGE_LABEL).width; total = icon + gap + tw;
    }
    var left = lb.x + (lb.w - total) / 2, mid = lb.y + lb.h / 2;
    drawWand(x, left, mid - icon / 2, icon);
    x.fillStyle = '#3d372c';
    x.fillText(BADGE_LABEL, left + icon + gap, mid + 0.5);
    x.restore();
    return { src: c.toDataURL('image/png'), ratio: L.ratio, w: L.w, h: L.h, corner: L.corner, qr: !!(matrix && matrix.length) };
  }
  function paintBadge(app, matrixOverride) {
    return new Promise(function (resolve, reject) {
      try { resolve(paintBadgeNow(app, matrixOverride)); } catch (e) { reject(e); }
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
          if (e.target && e.target.closest && e.target.closest('.laBack, .lqBack')) return;
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
      /* ☁ Library first (v1.179.0): every app added goes into the teacher's
         cloud library before anything else, so a worksheet is no longer
         where an app LIVES. With no page to put it on (no worksheet open,
         practice, or opened from the library's ➕ New app) the adder saves
         to the library alone. */
      var canPlace = !!existing || (!opts.libraryOnly && (typeof env.canPlace === 'function' ? !!env.canPlace() : true));
      var hasLibrary = typeof env.saveToLibrary === 'function';
      var st = { html: start ? start.html : '', title: start ? start.title : '', titleTyped: !!start, file: '', editId: existing ? existing.id : '', previewTimer: 0, busy: false,
        canPlace: canPlace, hasLibrary: hasLibrary, asq: false, asqTouched: false, spec: null };
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
            '<textarea class="laPaste" data-la="paste" spellcheck="false" placeholder="<!doctype html> … — or an AI’s whole reply; the app is taken out of it"></textarea>' +
            (typeof env.openPrompt === 'function'
              ? '<div class="laPromptRow"><button type="button" class="laBtn laGhost" data-la="prompt" title="A prompt for ChatGPT, Claude or Gemini that makes them write a living app in exactly this shape — with its wand and its question on paper">📋 AI prompt</button>' +
                '<span class="laPromptNote">Ask any AI to write one, then paste its reply here.</span></div>'
              : '') +
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
          '<div class="laFootLeft">' +
            (st.canPlace && !st.editId && typeof env.addAsQuestion === 'function'
              ? '<label class="laAsQ" title="Puts the question’s words in a text box, the app’s diagram as the picture a tap brings alive, and ruled working lines under each part — the app becomes a question on the paper"><input type="checkbox" data-la="asq"> 📝 As a question — text, working lines and the app’s diagram</label>' +
                '<label class="laAsQ laAsQSub" data-la="answersRow" hidden><input type="checkbox" data-la="answers"> ✍ Write its model answers in the working space (hidden while students practise)</label>'
              : '') +
            '<span class="laSafe">' + (st.hasLibrary ? '☁ Saved to your library in the cloud first — its link and QR code never depend on a worksheet. ' : '') +
              '🔒 The app runs in a sealed frame: it cannot read the worksheet, sign anyone in or send anything anywhere.</span>' +
          '</div>' +
          '<div class="laFootBtns">' +
            '<button type="button" class="laBtn" data-la="cancel">Cancel</button>' +
            (st.canPlace && !st.editId && st.hasLibrary ? '<button type="button" class="laBtn" data-la="lib" disabled title="Save it to your library without putting it on this page">☁ Library only</button>' : '') +
            '<button type="button" class="laBtn laPrimary" data-la="add" disabled>' + addLabel(st) + '</button>' +
          '</div>' +
        '</div>';
      back.appendChild(card);
      adder = { back: back, card: card, st: st };

      var q = function (k) { return card.querySelector('[data-la="' + k + '"]'); };
      var paste = q('paste'), titleBox = q('title'), file = q('file'), drop = q('drop'), info = q('info'), addBtn = q('add');
      var libBtn = q('lib'), asqBox = q('asq'), answersBox = q('answers'), answersRow = q('answersRow');
      if (st.html) paste.value = st.html;
      if (st.title) titleBox.value = st.title;

      function refresh(immediate) {
        var res = normalizeApp({ html: unwrapHtml(st.html), title: st.title });
        st.spec = null;
        var LQ = root.LivingQuestion;
        if (res.ok && LQ) {
          var sr = LQ.pure.readSpec(res.app.html);
          st.spec = sr.ok ? sr.spec : null;
          st.specError = sr.ok || sr.reason === 'none' ? '' : sr.message;
          // An app that carries a question goes on as one, unless the
          // teacher has said otherwise.
          if (asqBox && !st.asqTouched) asqBox.checked = !!st.spec;
        }
        if (asqBox) {
          st.asq = !!asqBox.checked;
          var sum = st.spec && LQ ? LQ.pure.summary(st.spec) : null;
          if (answersRow) answersRow.hidden = !(st.asq && sum && sum.answers);
        }
        if (!st.titleTyped) {
          var guess = titleFromHtml(unwrapHtml(st.html)) || (st.file ? titleFromFileName(st.file) : '');
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
          info.textContent = '✓ ' + sizeText(res.app.html.length) + (st.file ? ' · ' + st.file : '') +
            (hasScript(res.app.html) ? ' · runs its own script' : ' · no script') +
            (res.app.wand ? ' · 🪄 has a magic wand' : '') +
            (st.spec ? ' · 📝 a question: ' + (root.LivingQuestion.pure.summary(st.spec).text || 'its words') : '') +
            (st.specError ? ' · ⚠ ' + st.specError : '') +
            (res.app.html.length !== st.html.length ? ' · taken out of the pasted reply' : '');
        }
        addBtn.disabled = !res.ok || st.busy;
        if (libBtn) libBtn.disabled = !res.ok || st.busy;
        if (!st.busy) addBtn.textContent = addLabel(st);
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
      addBtn.addEventListener('click', function () { commitAdder(st.canPlace || st.editId ? 'page' : 'library'); });
      if (libBtn) libBtn.addEventListener('click', function () { commitAdder('library'); });
      if (asqBox) asqBox.addEventListener('change', function () { st.asqTouched = true; refresh(true); });
      var promptBtn = q('prompt');
      if (promptBtn) promptBtn.addEventListener('click', function () {
        try { env.openPrompt({ topic: st.title || '' }); } catch (e) {}
      });
      refresh(true);
      setTimeout(function () { focusIn(st.editId ? titleBox : drop); }, 30);
      return true;
    }
    function addLabel(st) {
      if (st.editId) return '✓ Update the app';
      if (!st.canPlace) return st.hasLibrary ? '☁ Save to library' : '➕ Put on the page';
      if (st.asq) return st.hasLibrary ? '📝 Save and add the question' : '📝 Add the question';
      return st.hasLibrary ? '➕ Save and put on the page' : '➕ Put on the page';
    }
    /* An AI's reply pasted whole: the app is taken out of it. */
    function unwrapHtml(html) {
      var LQ = root.LivingQuestion;
      try { return LQ ? LQ.pure.extractHtml(html) : String(html || ''); } catch (e) { return String(html || ''); }
    }
    /* ☁ The library save, bounded: a slow connection must never hold a page
       up for ever. A save still running when the time is up carries on in
       the background (the next worksheet save files it anyway). */
    function saveToLibrary(app) {
      if (typeof env.saveToLibrary !== 'function') return Promise.resolve({ pub: null, skipped: true });
      var p;
      try { p = Promise.resolve(env.saveToLibrary(app)); } catch (e) { p = Promise.reject(e); }
      return new Promise(function (resolve) {
        var done = false;
        var t = setTimeout(function () { if (!done) { done = true; resolve({ pub: null, slow: true }); } }, LIBRARY_WAIT_MS);
        p.then(function (pub) { if (done) return; done = true; clearTimeout(t); resolve({ pub: pub || null }); },
          function (err) { if (done) return; done = true; clearTimeout(t); resolve({ pub: null, error: err }); });
      });
    }
    function commitAdder(mode) {
      if (!adder) return;
      var st = adder.st;
      if (st.busy) return;
      if (!teacher()) { toast('Adding a living app is the teacher’s own.'); closeAdder(); return; }
      var res = normalizeApp({ html: unwrapHtml(st.html), title: st.title, at: Date.now() });
      if (!res.ok) { toast(res.message, 4500); return; }
      mode = mode === 'library' ? 'library' : 'page';
      var asQuestion = mode === 'page' && !st.editId && !!st.asq && typeof env.addAsQuestion === 'function';
      var withAnswers = asQuestion && !!(adder.card.querySelector('[data-la="answers"]') || {}).checked;
      st.busy = true;
      var addBtn = adder.card.querySelector('[data-la="add"]');
      var libBtn = adder.card.querySelector('[data-la="lib"]');
      var busyBtn = mode === 'library' && libBtn ? libBtn : addBtn;
      addBtn.disabled = true;
      if (libBtn) libBtn.disabled = true;
      busyBtn.textContent = st.hasLibrary ? '☁ Saving to your library…' : '✨ Painting the cover…';
      function reset() {
        st.busy = false;
        if (!adder || adder.st !== st) return;
        addBtn.disabled = false;
        if (libBtn) { libBtn.disabled = false; libBtn.textContent = '☁ Library only'; }
        addBtn.textContent = addLabel(st);
      }
      saveToLibrary(res.app).then(function (saved) {
        if (!adder || adder.st !== st) { st.busy = false; return null; }
        if (!teacher()) { st.busy = false; closeAdder(); return null; }
        var pub = saved && saved.pub;
        if (pub && pub.hash === res.app.hash && pub.token) res.app.pub = { hash: pub.hash, token: pub.token };
        if (mode === 'library') {
          if (!pub) {
            reset();
            toast(saved && saved.slow
              ? 'The library is taking a while to answer — check the connection, then press ☁ again.'
              : 'Could not save it to your library just now' + (saved && saved.error && saved.error.message ? ': ' + String(saved.error.message).slice(0, 120) : '') + '.', 5600);
            return null;
          }
          st.busy = false;
          closeAdder();
          toast('☁ “' + res.app.title + '” is in your library — its link and QR code work from anywhere. 📚 App library puts it on any worksheet.', 5600);
          if (typeof env.librarySaved === 'function') { try { env.librarySaved(res.app, pub); } catch (e) {} }
          return null;
        }
        if (st.hasLibrary && !pub && !saved.skipped) {
          toast(saved && saved.slow
            ? 'The library is slow to answer — the app goes on the page now and into the library when the worksheet saves.'
            : 'It could not reach your library just now — it goes on the page now and into the library when the worksheet saves.', 5200);
        }
        busyBtn.textContent = '✨ Painting the cover…';
        return paintCover(res.app).then(function (cover) {
          if (!adder || adder.st !== st) { st.busy = false; return; }
          var done;
          if (st.editId) done = typeof env.updateOnPage === 'function' && env.updateOnPage(st.editId, cover, res.app);
          else if (asQuestion) done = env.addAsQuestion(cover, res.app, { answers: withAnswers });
          else done = typeof env.addToPage === 'function' && env.addToPage(cover, res.app);
          return Promise.resolve(done).then(function (ok) {
            st.busy = false;
            if (ok) {
              closeAdder();
              toast(st.editId
                ? '🪄 Living app updated — tap it to see it alive.'
                : asQuestion
                  ? '📝 “' + res.app.title + '” is on the page as a question — tap it, or its 🪄, to bring it alive.'
                  : '🪄 “' + res.app.title + '” is on the page — select it and press 🪄 Bring alive, or a student just taps it.', 4800);
            } else reset();
          });
        });
      }).catch(function (err) {
        reset();
        toast(err && err.message && /figure|SVG/i.test(err.message) ? err.message : 'The cover could not be painted on this device.', 4000);
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
            '<button type="button" class="laBtn laQrBtn" data-la="qr" title="Show the QR code that opens this app on a phone" aria-pressed="true" hidden>📲 QR</button>' +
            '<button type="button" class="laIconBtn" data-la="close" title="Close (Esc)" aria-label="Close">✕</button>' +
          '</div>' +
        '</div>' +
        '<div class="laStageBody">' +
          '<div class="laFrameHost"></div>' +
          '<div class="laSpell" aria-hidden="true"></div>' +
          '<div class="laHint" role="status" aria-live="polite"></div>' +
          '<div class="laQr" data-la="qrcard" hidden>' +
            '<div class="laQrHead"><span>📲 Scan to open this app</span>' +
              '<button type="button" class="laQrHide" data-la="qrhide" title="Hide the QR code" aria-label="Hide the QR code">✕</button></div>' +
            '<button type="button" class="laQrCode" data-la="qrcode" title="Make the QR code bigger"></button>' +
            '<div class="laQrNote"></div>' +
          '</div>' +
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
      card.querySelector('[data-la="qr"]').addEventListener('click', function () { qrShow(s, !s.qrShown); });
      card.querySelector('[data-la="qrhide"]').addEventListener('click', function () { qrShow(s, false); });
      card.querySelector('[data-la="qrcode"]').addEventListener('click', function () {
        var box = s.card.querySelector('[data-la="qrcard"]');
        var big = !box.classList.contains('laQrBig');
        box.classList.toggle('laQrBig', big);
        this.title = big ? 'Make the QR code smaller' : 'Make the QR code bigger';
      });
      qrLoad(s);
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
    /* 📲 The QR code on the stage opens THIS app alone (living.html), never
       Ans Key. The link comes from the glue (env.qrLink, which hosts the app
       the first time the teacher needs it); a person with no hosted copy to
       offer simply gets no code. A late answer for a stage that has closed or
       moved on to another app is dropped. */
    function qrLoad(s) {
      if (typeof env.qrLink !== 'function' || typeof env.qrMatrix !== 'function') return;
      var box = s.card.querySelector('[data-la="qrcard"]');
      var note = box.querySelector('.laQrNote');
      var code = box.querySelector('[data-la="qrcode"]');
      code.innerHTML = '<span class="laQrWait" aria-hidden="true">✨</span>';
      note.textContent = 'Putting the app online…';
      s.qrShown = true;
      box.hidden = false;
      var p;
      try { p = Promise.resolve(env.qrLink(s.id)); } catch (e) { p = Promise.reject(e); }
      p.then(function (url) {
        if (stage !== s) return;
        var svg = url ? qrSvg(env.qrMatrix(url)) : '';
        if (!svg) { box.hidden = true; s.qrShown = false; return; }
        s.qrUrl = url;
        code.innerHTML = svg;
        code.setAttribute('aria-label', 'QR code for ' + (s.app.title || 'this living app') + ' — tap to make it bigger');
        note.textContent = 'Opens only this app, on any phone.';
        var btn = s.card.querySelector('[data-la="qr"]');
        btn.hidden = false;
        qrShow(s, s.qrShown);
      }, function () {
        if (stage !== s) return;
        box.hidden = true;
        s.qrShown = false;
        hint(s, 'The QR code could not be made — check the connection and open the app again.');
      });
    }
    function qrShow(s, on) {
      if (stage !== s || !s.qrUrl) return;
      s.qrShown = !!on;
      var box = s.card.querySelector('[data-la="qrcard"]');
      box.hidden = !on;
      if (!on) box.classList.remove('laQrBig');
      s.card.querySelector('[data-la="qr"]').setAttribute('aria-pressed', on ? 'true' : 'false');
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

  /* 📝 Read an app as it is drawn (v1.180.0). The app runs ONCE more, in
     a sandboxed frame of its own (the same document, CSP and bridge as the
     stage — never allow-same-origin), laid out at a worksheet-ish size and
     kept invisible but ON the screen: a frame scrolled off the screen is
     throttled by the browser, so an app that draws in requestAnimationFrame
     would hand back an empty canvas. When the app says it is ready (the
     wand bridge's wand-ready, else its load plus a little) it is given
     HARVEST_SETTLE_MS to draw, then asked. Resolves the raw reply, or null
     on a timeout or with no DOM; the frame is always taken down. */
  var HARVEST_SETTLE_MS = 900;
  var HARVEST_LOAD_GRACE_MS = 1800;
  var HARVEST_WAIT_MS = 9000;
  var HARVEST_W = 900;
  var HARVEST_H = 1200;
  function harvest(html, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      if (typeof document === 'undefined' || !document.body || !html) { resolve(null); return; }
      var settle = opts.settleMs != null ? opts.settleMs : HARVEST_SETTLE_MS;
      var f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-scripts');
      f.setAttribute('aria-hidden', 'true');
      f.setAttribute('title', 'Reading the app');
      f.tabIndex = -1;
      f.className = 'laHarvest';
      f.style.cssText = 'position:fixed;left:0;top:0;width:' + (opts.width || HARVEST_W) + 'px;height:' + (opts.height || HARVEST_H) +
        'px;border:0;opacity:0;pointer-events:none;z-index:-1;background:#fff;';
      var id = 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      var done = false, asked = false, timers = [];
      function finish(v) {
        if (done) return;
        done = true;
        timers.forEach(clearTimeout);
        window.removeEventListener('message', onMsg);
        if (f.parentNode) f.parentNode.removeChild(f);
        resolve(v);
      }
      function ask() {
        if (asked || done) return;
        asked = true;
        timers.push(setTimeout(function () {
          try { f.contentWindow.postMessage({ polymath: 'harvest', id: id }, '*'); } catch (e) { finish(null); }
        }, settle));
      }
      function onMsg(e) {
        if (!f.contentWindow || e.source !== f.contentWindow) return;
        var d = e.data;
        if (!d || typeof d !== 'object') return;
        if (d.polymath === 'wand-ready') ask();
        else if (d.polymath === 'harvest-result' && d.id === id) finish(d);
      }
      window.addEventListener('message', onMsg);
      f.addEventListener('load', function () { timers.push(setTimeout(ask, HARVEST_LOAD_GRACE_MS)); });
      timers.push(setTimeout(function () { finish(null); }, opts.waitMs || HARVEST_WAIT_MS));
      f.srcdoc = sandboxDocument(html);
      document.body.appendChild(f);
    });
  }

  var api = { create: create, pure: pure, paintCover: paintCover, paintBadge: paintBadge, paintBadgeNow: paintBadgeNow, drawQrOnPdf: drawQrOnPdf, harvest: harvest, drawWand: drawWand, drawCornerWand: drawCornerWand, drawCornerBadge: drawCornerBadge, drawQrSquare: drawQrSquare };
  root.LivingApps = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
