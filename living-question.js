/* =====================================================================
   📝 LIVING QUESTIONS — a living app that is ALSO a question on the paper
   (v1.179.0)
   ---------------------------------------------------------------------
   A living app used to land on the page as one picture: its painted cover
   with a wand on it. That is a demonstration, not a question — the class
   still needed the question typed out, somewhere to write and the diagram
   drawn on the paper. This file turns one app into all of that:

     • the question's opening words, in a text box,
     • the app's own diagram (its "figure", an SVG) as the picture that
       carries the app — so a tap on the figure still brings it alive, and
       the printed sheet still has its QR code (on a gold strip down the
       left of the figure, never over the diagram),
     • each part — (a), (b) … with its marks — in its own text box,
     • ruled working lines under each part, as ordinary line annotations
       grouped with their part, so the block moves as one.

   THE APP SAYS WHAT ITS QUESTION IS, inside its own HTML:

     <script type="application/json" id="polymath-question">
       { "title": "…", "stem": "…", "figure": "<svg …>…</svg>",
         "parts": [ { "label": "(a)", "text": "…", "marks": 2, "lines": 3,
                      "answer": "…" } ] }
     </script>

   A non-JavaScript <script> never runs, so the block is inert inside the
   sandbox, and an app without one still works as a question: its title is
   the question and it gets DEFAULT_LINES of working space.

   📋 THE PROMPT (`buildPrompt`, the window `openPrompt`) is what makes an
   AI — ChatGPT, Claude, Gemini, any of them — write an app in exactly this
   shape: one self-contained file, the wand the stage's bridge looks for,
   nothing the sandbox's CSP would refuse, and the question block above.
   `extractHtml` takes the app back out of a pasted AI reply, prose, code
   fences and all.

   Everything that decides something is pure (window.LivingQuestion.pure)
   and runs in tools/living-question-tests.mjs. The painting and the prompt
   window need a DOM. index.html's glue (`lappAddQuestion`) puts the pieces
   on the page.
   ===================================================================== */
(function (root) {
  'use strict';

  var SPEC_ID = 'polymath-question';
  var VERSION = 1;
  var TITLE_MAX = 90;
  var STEM_MAX = 2400;
  var PARTS_MAX = 8;
  var PART_TEXT_MAX = 1400;
  var LABEL_MAX = 8;
  var LINES_MAX = 16;
  var MARKS_MAX = 50;
  var ANSWER_MAX = 3000;
  var FIGURE_MAX = 200000;          // characters of SVG
  var DEFAULT_LINES = 5;            // an app with no block still gets somewhere to write
  var DEFAULT_PART_LINES = 3;

  /* The page, in page units (a PDF point at 100%). */
  var MARGIN = 40;
  var ITEM_GAP = 12;
  var PART_GAP = 6;                 // a part's words to its first line
  var LINE_GAP = 24;                // ruled lines, the comfortable spacing
  var LINE_GAP_MIN = 17;            // …and the tightest a child can still write in
  var FIG_SHARE = 0.38;             // the figure's share of the page height, at most
  var FIG_SHARE_MIN = 0.2;
  var FIG_WIDTH_SHARE = 0.86;       // a figure never runs from margin to margin
  var LINE_COLOR = '#9AA3AD';
  var LINE_WIDTH = 0.75;
  var TEXT_SIZE = 14;
  var ANSWER_COLOR = '#1F5FBF';

  /* The figure's cover: a gold strip down the left (the wand on screen, the
     QR code on paper) beside the diagram on white. */
  var FIG_COVER_MAX_W = 1400;
  var FIG_COVER_MAX_H = 900;
  var FIG_STRIP_SHARE = 0.4;        // of the cover's width, the widest the strip need be
  var FIG_STRIP_PAD = 0.08;         // of the cover's width, the code's inset and pad
  var STRIP_RW_MIN = 400;           // the narrowest a wide figure is placed, in points
  var STRIP_RW_MAX = 560;           // the widest any figure is placed
  var STRIP_RW_PER_RATIO = 150;     // a figure is at least this × its shape wide

  var AI_LINKS = [
    { id: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com/', q: 'https://chatgpt.com/?q=' },
    { id: 'claude', label: 'Claude', url: 'https://claude.ai/new', q: 'https://claude.ai/new?q=' },
    { id: 'gemini', label: 'Gemini', url: 'https://gemini.google.com/app', q: '' }
  ];
  var AI_URL_MAX = 7000;            // past this a prefilled link is cut, so it opens empty and the prompt is pasted

  var LEVELS = ['P3', 'P4', 'P5', 'P6'];
  var SUBJECTS = [{ id: 'science', label: 'Science' }, { id: 'math', label: 'Maths' }];

  /* ---------------------------------------------------------------
     Pure helpers — no DOM.
     --------------------------------------------------------------- */
  function str(v) { return v == null ? '' : String(v); }
  function decodeEntities(s) {
    return str(s)
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
      .replace(/&#(\d+);/g, function (m, n) { var c = Number(n); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ''; })
      .replace(/&amp;/gi, '&');
  }
  /* One line of words: no markup, no control characters, one space. */
  function cleanLine(v, max) {
    var t = decodeEntities(str(v).replace(/<[^>]*>/g, ' ')).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (max && t.length > max) t = t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
    return t;
  }
  /* A paragraph or two: new lines kept (at most one blank line in a row),
     everything else as cleanLine. */
  function cleanBlock(v, max) {
    var t = decodeEntities(str(v).replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*/gi, '\n').replace(/<[^>]*>/g, ' '));
    t = t.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    t = t.split('\n').map(function (l) { return l.replace(/[ \t]+/g, ' ').trim(); }).join('\n');
    t = t.replace(/\n{3,}/g, '\n\n').trim();
    if (max && t.length > max) t = t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
    return t;
  }
  function clampInt(v, lo, hi, dflt) {
    var n = Number(v);
    if (v === '' || v == null || !isFinite(n)) return dflt;
    n = Math.round(n);
    return Math.max(lo, Math.min(hi, n));
  }
  function r2(n) { return Math.round(n * 100) / 100; }

  /* (a), (b) … for a part that did not say. */
  function autoLabel(i) { return '(' + String.fromCharCode(97 + (i % 26)) + ')'; }
  function cleanLabel(v, i) {
    var t = cleanLine(v, LABEL_MAX);
    if (!t) return autoLabel(i);
    // "a" → "(a)", "1" → "(1)"; anything already bracketed or dotted is kept.
    if (/^[a-z0-9]{1,3}$/i.test(t)) return '(' + t + ')';
    return t;
  }

  /* A figure the paper can carry: SVG markup only, nothing that runs, and
     a namespace so an <img> will draw it. '' when it is not usable. The
     figure is only ever DRAWN as a picture (an <img> from a data: URL, which
     runs no script and loads nothing), so this is tidiness and size, not the
     lock — but a figure stored on an annotation is read by every device the
     worksheet opens on, so it is kept clean anyway. */
  function cleanSvg(v) {
    var s = str(v).replace(/^﻿/, '').trim();
    if (!s) return '';
    s = s.replace(/<\?xml[\s\S]*?\?>/gi, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/gi, '').trim();
    if (!/^<svg[\s>]/i.test(s) || !/<\/svg>\s*$/i.test(s)) return '';
    if (s.length > FIGURE_MAX) return '';
    s = s.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
      .replace(/<script\b[^>]*\/>/gi, '')
      .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '')
      .replace(/<foreignObject\b[^>]*\/>/gi, '')
      .replace(/<(iframe|embed|object|audio|video|canvas|html|body)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\s(?:xlink:)?href\s*=\s*("|')\s*javascript:[^"']*\1/gi, '');
    if (!/^<svg[^>]*\sxmlns\s*=/i.test(s)) s = s.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    return s;
  }

  /* The figure's own shape, from its viewBox, else its width and height,
     else a sensible 5 : 3. */
  function svgSize(svg) {
    var s = str(svg);
    var head = (s.match(/^<svg\b[^>]*>/i) || [''])[0];
    var vb = head.match(/\sviewBox\s*=\s*["']\s*([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([\d.eE+]+)[\s,]+([\d.eE+]+)\s*["']/i);
    if (vb) {
      var w = Number(vb[3]), h = Number(vb[4]);
      if (w > 0 && h > 0 && isFinite(w) && isFinite(h)) return { w: w, h: h, from: 'viewBox' };
    }
    var wm = head.match(/\swidth\s*=\s*["']?\s*([\d.]+)\s*(?:px)?\s*["']?/i);
    var hm = head.match(/\sheight\s*=\s*["']?\s*([\d.]+)\s*(?:px)?\s*["']?/i);
    if (wm && hm && Number(wm[1]) > 0 && Number(hm[1]) > 0) return { w: Number(wm[1]), h: Number(hm[1]), from: 'size' };
    return { w: 500, h: 300, from: 'guess' };
  }

  /* An <svg> drawn as a picture needs an explicit size, or some browsers
     draw it at 300 × 150 whatever its viewBox says. */
  function svgForImage(svg, w, h) {
    var s = cleanSvg(svg);
    if (!s) return '';
    var size = svgSize(s);
    var W = Math.max(1, Math.round(w || size.w)), H = Math.max(1, Math.round(h || size.h));
    var head = s.match(/^<svg\b[^>]*>/i)[0];
    var bare = head.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    if (size.from !== 'viewBox') bare = bare.replace(/^<svg/i, '<svg viewBox="0 0 ' + size.w + ' ' + size.h + '"');
    bare = bare.replace(/^<svg/i, '<svg width="' + W + '" height="' + H + '"');
    return bare + s.slice(head.length);
  }

  /* The block inside the app, found and read. Never throws.
     { ok: true, spec } · { ok: false, reason: 'none' } · { ok: false, reason: 'bad', message } */
  function readSpec(html) {
    var s = str(html);
    var re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, m;
    while ((m = re.exec(s))) {
      var attrs = m[1] || '';
      var named = /\sid\s*=\s*["']?polymath-question["'\s>]?/i.test(' ' + attrs) || /\sdata-polymath-question\b/i.test(' ' + attrs);
      if (!named) continue;
      var type = (attrs.match(/\stype\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
      if (type && !/json/i.test(type)) {
        return { ok: false, reason: 'bad', message: 'The app’s question block must be <script type="application/json" id="polymath-question">, so it never runs.' };
      }
      var body = m[2].replace(/^\s*<!--/, '').replace(/-->\s*$/, '').trim();
      var raw;
      try { raw = JSON.parse(body); } catch (e) {
        return { ok: false, reason: 'bad', message: 'The app’s question block is not valid JSON (' + cleanLine(e && e.message, 80) + ').' };
      }
      var spec = cleanSpec(raw);
      if (!spec) return { ok: false, reason: 'bad', message: 'The app’s question block has no question in it.' };
      return { ok: true, spec: spec };
    }
    return { ok: false, reason: 'none' };
  }

  /* The ONE door into a question's shape. Null when there is nothing to
     ask (no stem, no parts and no figure). */
  function cleanSpec(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var stem = cleanBlock(raw.stem != null ? raw.stem : (raw.question != null ? raw.question : raw.text), STEM_MAX);
    var parts = [];
    (Array.isArray(raw.parts) ? raw.parts : []).slice(0, PARTS_MAX * 2).forEach(function (p) {
      if (parts.length >= PARTS_MAX) return;
      if (typeof p === 'string') p = { text: p };
      if (!p || typeof p !== 'object') return;
      var text = cleanBlock(p.text != null ? p.text : (p.question != null ? p.question : p.stem), PART_TEXT_MAX);
      var lines = clampInt(p.lines, 0, LINES_MAX, DEFAULT_PART_LINES);
      if (!text && !lines) return;
      parts.push({
        label: cleanLabel(p.label, parts.length),
        text: text,
        marks: clampInt(p.marks, 0, MARKS_MAX, 0),
        lines: lines,
        answer: cleanBlock(p.answer, ANSWER_MAX)
      });
    });
    var figure = cleanSvg(raw.figure != null ? raw.figure : raw.svg);
    if (!stem && !parts.length && !figure) return null;
    return {
      v: VERSION,
      title: cleanLine(raw.title, TITLE_MAX),
      stem: stem,
      figure: figure,
      parts: parts,
      lines: clampInt(raw.lines, 0, LINES_MAX, parts.length ? 0 : DEFAULT_LINES),
      marks: clampInt(raw.marks, 0, MARKS_MAX, 0),
      answer: cleanBlock(raw.answer, ANSWER_MAX)
    };
  }

  /* What goes on the paper for an app with no block: its title is the
     question, and there is room to write under it. */
  function fallbackSpec(app) {
    var title = cleanLine(app && app.title, TITLE_MAX) || 'Living app';
    return { v: VERSION, title: title, stem: title, figure: '', parts: [], lines: DEFAULT_LINES, marks: 0, answer: '', fallback: true };
  }

  /* The question the app carries, or the fallback. */
  function specFor(app) {
    var r = readSpec(app && app.html);
    if (r.ok) {
      if (!r.spec.title) r.spec.title = cleanLine(app && app.title, TITLE_MAX);
      return r.spec;
    }
    return fallbackSpec(app);
  }

  /* The question an app carries, summed up for the library — null when it
     carries no block. */
  function questionOf(app) {
    var r = readSpec(app && app.html);
    return r.ok ? summary(r.spec) : null;
  }
  /* The app's diagram, or ''. */
  function figureOf(app) {
    var r = readSpec(app && app.html);
    return r.ok ? r.spec.figure : '';
  }

  /* A few words about the question, for the adder and the library. */
  function summary(spec) {
    if (!spec) return { parts: 0, lines: 0, marks: 0, figure: false, answers: 0, text: '' };
    var lines = spec.lines || 0, marks = spec.marks || 0, answers = spec.answer ? 1 : 0;
    spec.parts.forEach(function (p) { lines += p.lines; marks += p.marks; if (p.answer) answers++; });
    var bits = [];
    if (spec.parts.length) bits.push(spec.parts.length + (spec.parts.length === 1 ? ' part' : ' parts'));
    if (lines) bits.push(lines + (lines === 1 ? ' working line' : ' working lines'));
    if (marks) bits.push(marks + (marks === 1 ? ' mark' : ' marks'));
    if (spec.figure) bits.push('a diagram');
    return { parts: spec.parts.length, lines: lines, marks: marks, figure: !!spec.figure, answers: answers, text: bits.join(' · ') };
  }

  /* What one text box says. */
  function stemText(spec) {
    var t = spec && spec.stem ? spec.stem : '';
    if (t && spec.marks && !spec.parts.length) t += '  [' + spec.marks + ']';
    return t;
  }
  function partText(part) {
    if (!part) return '';
    var t = (part.label ? part.label + ' ' : '') + (part.text || '');
    if (part.marks) t += '  [' + part.marks + ']';
    return t.trim();
  }

  /* Where everything goes. `o`:
       pageW, pageH      the page
       top               where the teacher is looking (page units)
       stemH             the stem box's measured height (0 = no stem)
       figRatio          the figure picture's width ÷ height (0 = no figure)
       stemLines         working lines under the stem
       parts             [{ h, lines }] — each part's measured height and lines
     Returns { items, bottom, fits, lineGap, startY, figH, trimmed }:
       items: { kind: 'stem'|'figure'|'part'|'lines', i?, x, y, w, h, ys? }
     The rule: start where the teacher is looking; if it does not fit, start
     at the top margin; then tighten the lines to LINE_GAP_MIN; then shrink
     the figure; and only then drop working lines — evenly, never a part's
     last one — and say how many (`trimmed`). It never puts anything off the
     page. */
  function layout(o) {
    o = o || {};
    var pw = Number(o.pageW) > 0 ? Number(o.pageW) : 600;
    var ph = Number(o.pageH) > 0 ? Number(o.pageH) : 800;
    var margin = Math.min(MARGIN, pw * 0.08);
    var contentW = Math.max(60, pw - margin * 2);
    var floorY = ph - margin * 0.75;
    var top = isFinite(o.top) ? Math.max(margin * 0.75, Math.min(ph * 0.7, Number(o.top))) : margin;
    var stemH = Math.max(0, Number(o.stemH) || 0);
    var ratio = Number(o.figRatio) > 0 ? Number(o.figRatio) : 0;
    var parts = (o.parts || []).map(function (p) { return { h: Math.max(0, Number(p && p.h) || 0), lines: clampInt(p && p.lines, 0, LINES_MAX, 0) }; });
    var stemLines = clampInt(o.stemLines, 0, LINES_MAX, 0);

    function attempt(startY, gap, figShare, counts) {
      var y = startY, items = [], figH = 0;
      if (stemH) { items.push({ kind: 'stem', x: r2(margin), y: r2(y), w: r2(contentW), h: r2(stemH) }); y += stemH + ITEM_GAP; }
      if (ratio) {
        var fw = Math.min(contentW * FIG_WIDTH_SHARE, ph * figShare * ratio);
        var fh = fw / ratio;
        figH = fh;
        items.push({ kind: 'figure', x: r2(margin + (contentW - fw) / 2), y: r2(y), w: r2(fw), h: r2(fh) });
        y += fh + ITEM_GAP;
      }
      if (counts.stem) {
        var ys0 = [];
        for (var k0 = 1; k0 <= counts.stem; k0++) ys0.push(r2(y + k0 * gap));
        items.push({ kind: 'lines', i: -1, x: r2(margin), y: r2(y), w: r2(contentW), h: r2(counts.stem * gap + 4), ys: ys0 });
        y += counts.stem * gap + 4 + ITEM_GAP;
      }
      parts.forEach(function (p, i) {
        items.push({ kind: 'part', i: i, x: r2(margin), y: r2(y), w: r2(contentW), h: r2(p.h) });
        y += p.h;
        var n = counts.parts[i];
        if (n) {
          y += PART_GAP;
          var ys = [];
          for (var k = 1; k <= n; k++) ys.push(r2(y + k * gap));
          items.push({ kind: 'lines', i: i, x: r2(margin), y: r2(y), w: r2(contentW), h: r2(n * gap + 4), ys: ys });
          y += n * gap + 4;
        }
        y += ITEM_GAP;
      });
      var bottom = y - ITEM_GAP;
      return { items: items, bottom: r2(bottom), fits: bottom <= floorY, lineGap: gap, startY: r2(startY), figH: r2(figH) };
    }

    var full = { stem: stemLines, parts: parts.map(function (p) { return p.lines; }) };
    var tries = [
      [top, LINE_GAP, FIG_SHARE],
      [margin, LINE_GAP, FIG_SHARE],
      [margin, LINE_GAP_MIN, FIG_SHARE],
      [margin, LINE_GAP_MIN, (FIG_SHARE + FIG_SHARE_MIN) / 2],
      [margin, LINE_GAP_MIN, FIG_SHARE_MIN]
    ];
    var res;
    for (var t = 0; t < tries.length; t++) {
      res = attempt(tries[t][0], tries[t][1], tries[t][2], full);
      if (res.fits) { res.trimmed = 0; return res; }
    }
    // Drop working lines one at a time from whichever block has the most,
    // never below one line where there was at least one.
    var counts = { stem: full.stem, parts: full.parts.slice() };
    var dropped = 0;
    for (var guard = 0; guard < 400; guard++) {
      var bestI = -2, bestN = 1;
      if (counts.stem > bestN) { bestI = -1; bestN = counts.stem; }
      counts.parts.forEach(function (n, i) { if (n > bestN) { bestI = i; bestN = n; } });
      if (bestI === -2) break;
      if (bestI === -1) counts.stem--; else counts.parts[bestI]--;
      dropped++;
      res = attempt(margin, LINE_GAP_MIN, FIG_SHARE_MIN, counts);
      if (res.fits) break;
    }
    res.trimmed = dropped;
    return res;
  }

  /* One working line, as the page stores a line. */
  function lineAnn(x, y, w) {
    return { type: 'line', x1: r2(x), y1: r2(y), x2: r2(x + w), y2: r2(y), color: LINE_COLOR, width: LINE_WIDTH };
  }

  /* The app taken back out of whatever was pasted: an AI's reply wraps it
     in prose and a ```html fence; a file is already bare. The longest
     fenced block that holds markup wins; otherwise everything from the
     first <!doctype / <html to the last </html>. Text with no markup comes
     back as it was, so the adder can say what is wrong with it. */
  function extractHtml(text) {
    var s = str(text);
    if (!/```/.test(s)) {
      var lower = s.toLowerCase();
      var at = lower.search(/<!doctype\s+html|<html[\s>]/);
      if (at > 0 && /\S/.test(s.slice(0, at))) {
        var end = lower.lastIndexOf('</html>');
        return end > at ? s.slice(at, end + 7) : s.slice(at);
      }
      return s;
    }
    var re = /```[ \t]*([A-Za-z0-9_-]*)[^\n]*\n([\s\S]*?)```/g, m, best = '', bestScore = -1;
    while ((m = re.exec(s))) {
      var body = m[2];
      if (!/<[a-z!]/i.test(body)) continue;
      var lang = (m[1] || '').toLowerCase();
      // An html fence beats any other; a whole document beats a fragment;
      // then the longest wins.
      var score = body.length + (lang === 'html' ? 1e7 : 0) + (/<!doctype|<html/i.test(body) ? 1e6 : 0);
      if (score > bestScore) { best = body; bestScore = score; }
    }
    if (best) return best.replace(/\s+$/, '') + '\n';
    // An unclosed fence: a reply cut off mid-file still has its start.
    var open = s.match(/```[ \t]*html[^\n]*\n([\s\S]*)$/i);
    return open ? open[1] : s;
  }

  function levelWord(l) { return LEVELS.indexOf(l) >= 0 ? 'Primary ' + l.slice(1) : ''; }
  function subjectWord(s) { return s === 'math' ? 'Mathematics' : s === 'science' ? 'Science' : ''; }

  /* 📋 The prompt. One text any capable AI can follow, and every rule in it
     is one this app enforces somewhere: the size cap is normalizeApp's, the
     no-network rule is the frame's CSP, the wand is WAND_BRIDGE's search
     order, and the question block is readSpec's. Change one of those and
     change the sentence here with it. */
  function buildPrompt(opts) {
    opts = opts || {};
    var topic = cleanBlock(opts.topic, 2400);
    var level = LEVELS.indexOf(opts.level) >= 0 ? opts.level : '';
    var subject = opts.subject === 'math' || opts.subject === 'science' ? opts.subject : '';
    var asQuestion = opts.question !== false;
    var who = [levelWord(level), subjectWord(subject)].filter(Boolean).join(' ');
    var audience = who ? who + ' students in Singapore (MOE syllabus)' : 'primary school students in Singapore (MOE syllabus)';
    var L = [];
    L.push('You are building a "living app" for Polymath Ans Key: ONE self-contained interactive HTML file that brings a worksheet question alive for ' + audience + '. A teacher puts it on a worksheet; a student taps it (or scans its QR code) and it opens in a sealed frame.');
    L.push('');
    L.push('## What the app is about');
    L.push(topic || '[Describe the question, the concept or the diagram here — e.g. "A submarine’s ballast tanks: how letting water in or pumping it out makes it sink or float."]');
    L.push('');
    L.push('## Output — follow exactly');
    L.push('1. Reply with ONE complete HTML document in a single ```html code block, and nothing after it. No explanation outside the block.');
    L.push('2. Self-contained: every style in <style>, every script inline in <script>. No external scripts or libraries (no CDN), no fetch / XMLHttpRequest / WebSocket / EventSource, no <iframe>, no <form> that submits, no window.open. Google Fonts may be linked; pictures must be inline SVG, <canvas> drawing or data: URIs.');
    L.push('3. It runs in a sandbox that allows scripts but has NO same-origin access: do not use localStorage, sessionStorage, cookies, IndexedDB, alert(), confirm() or prompt(). Keep state in variables.');
    L.push('4. Under 400 KB in total. Plain modern JavaScript (no build step, no modules, no import).');
    L.push('5. A <title> of at most 60 characters — it becomes the app’s name in the teacher’s library.');
    L.push('6. Works from a 360-pixel phone to a classroom projector: responsive layout, no sideways scrolling, tap targets at least 44 px, mouse and touch both work (use pointer events). Respect prefers-reduced-motion.');
    L.push('7. Clean and calm: white or very light background, generous spacing, rounded cards, one accent colour, readable 16 px+ text. Short captions that explain what is happening as the student explores.');
    L.push('');
    L.push('## The magic wand (required)');
    L.push('The teacher waves a 🪄 wand over the app to bring it alive. Support it in all three of these ways:');
    L.push('- A visible wand button: <button class="btn-wand" data-polymath-wand data-wand-target="#stage" aria-pressed="false">🪄 Bring alive</button>');
    L.push('- The main animated diagram is one element with id="stage" and class="wand-target".');
    L.push('- Define window.polymathWand = function (detail) { … } — each call moves the demonstration ONE step on (detail.cast is 1, 2, 3 …): first it starts the animation, then each later call shows the next stage, looping back to the start after the last one. Pressing the wand button must do exactly the same.');
    L.push('Also give the student their own controls (sliders, buttons, drag handles) to explore it after the wand has shown them.');
    L.push('');
    if (asQuestion) {
      L.push('## The question on paper (required)');
      L.push('The same app also prints as a question on the worksheet. Put this block inside <body>, exactly once. It is plain JSON (no comments, no trailing commas) and it never runs:');
      L.push('<script type="application/json" id="polymath-question">');
      L.push('{');
      L.push('  "title": "Short title",');
      L.push('  "stem": "The question’s opening words, exactly as printed on the worksheet. Refer to the diagram as \\"the diagram below\\".",');
      L.push('  "figure": "<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 480 280\'> … </svg>",');
      L.push('  "parts": [');
      L.push('    { "label": "(a)", "text": "First question about the diagram.", "marks": 1, "lines": 2, "answer": "The model answer." },');
      L.push('    { "label": "(b)", "text": "A harder, explain-why question.", "marks": 2, "lines": 4, "answer": "The model answer, in full." }');
      L.push('  ]');
      L.push('}');
      L.push('</script>');
      L.push('Rules for the block:');
      L.push('- "figure" is a STATIC diagram of what the app shows, drawn to print well in black and white on A4: an <svg> with an xmlns and a viewBox, lines at least 1.5 units thick, labels at least 13 units high, no colour that matters for meaning. Inside the JSON string use single quotes for every SVG attribute (or escape double quotes as \\"). No <script>, no <foreignObject>, no external images, no CSS animation. Under 60 KB.');
      L.push('- "parts": 1 to 6 questions in the style of a Singapore primary school ' + (subject ? subjectWord(subject).toLowerCase() + ' ' : '') + 'paper, from simple to harder, each answerable from the diagram. "marks" is a whole number. "lines" is how many ruled answer lines to leave (0 for a multiple-choice part — put its options (1) (2) (3) (4) in "text"; 1–2 for a word or a number; 3–6 for an explanation).');
      L.push('- "answer" is the teacher’s model answer for that part. It is only ever shown to the teacher.');
      L.push('- With no parts at all, give a top-level "lines" for the stem instead.');
      L.push('');
    }
    L.push('## Check before you answer');
    L.push('- The science and the numbers are correct for the level, and the words are ones a ' + (level ? levelWord(level) : 'primary school') + ' child understands.');
    L.push('- The page works with no network at all.');
    if (asQuestion) L.push('- The JSON block parses (try JSON.parse on it in your head: double quotes around every key and string, single quotes inside the SVG).');
    L.push('- The wand button, #stage and window.polymathWand all exist.');
    return L.join('\n');
  }

  /* A link that opens an AI with the prompt already typed, when the AI
     takes one and the link stays short enough; else its plain address (the
     prompt is on the clipboard by then). */
  function aiLink(id, prompt) {
    var a = AI_LINKS.filter(function (x) { return x.id === id; })[0];
    if (!a) return '';
    if (a.q) {
      var u = a.q + encodeURIComponent(str(prompt));
      if (u.length <= AI_URL_MAX) return u;
    }
    return a.url;
  }

  var pure = {
    VERSION: VERSION, SPEC_ID: SPEC_ID, DEFAULT_LINES: DEFAULT_LINES, DEFAULT_PART_LINES: DEFAULT_PART_LINES,
    LINES_MAX: LINES_MAX, PARTS_MAX: PARTS_MAX, FIGURE_MAX: FIGURE_MAX, MARGIN: MARGIN, LINE_GAP: LINE_GAP,
    LINE_GAP_MIN: LINE_GAP_MIN, LINE_COLOR: LINE_COLOR, LINE_WIDTH: LINE_WIDTH, TEXT_SIZE: TEXT_SIZE,
    ANSWER_COLOR: ANSWER_COLOR, AI_LINKS: AI_LINKS, AI_URL_MAX: AI_URL_MAX, LEVELS: LEVELS, SUBJECTS: SUBJECTS,
    FIG_STRIP_SHARE: FIG_STRIP_SHARE, FIG_STRIP_PAD: FIG_STRIP_PAD,
    cleanLine: cleanLine, cleanBlock: cleanBlock, cleanSvg: cleanSvg, svgSize: svgSize, svgForImage: svgForImage,
    readSpec: readSpec, cleanSpec: cleanSpec, questionOf: questionOf, figureOf: figureOf, fallbackSpec: fallbackSpec, specFor: specFor, summary: summary,
    stemText: stemText, partText: partText, layout: layout, lineAnn: lineAnn, extractHtml: extractHtml,
    buildPrompt: buildPrompt, aiLink: aiLink, autoLabel: autoLabel, stripWidth: stripWidth
  };

  /* How wide the gold strip is for a figure of fw × fh pixels. On paper the
     QR code is drawn on the cover's LEFT by LivingApps.pure.qrOnCover: up to
     the cover's height (less its label), up to a third of its width, and a
     few points in from the edge. The strip has to hold all of that, or the
     code lands on the diagram:
       • a code limited by the cover's height needs a strip a little wider
         than the cover is tall: fh plus FIG_STRIP_PAD of the whole width;
       • a code limited by a third of the width needs FIG_STRIP_SHARE of it.
     Whichever is smaller is enough, because the code takes the smaller of
     its two limits too. tools/living-question-tests.mjs measures the real
     qrOnCover against the strip across cover sizes and shapes. */
  function stripWidth(fw, fh) {
    var w = Math.max(1, fw), h = Math.max(1, fh);
    var byHeight = (h + FIG_STRIP_PAD * w) / (1 - FIG_STRIP_PAD);
    var byWidth = FIG_STRIP_SHARE / (1 - FIG_STRIP_SHARE) * w;
    var safe = Math.min(byHeight, byWidth);
    // With the real qrOnCover to hand, the strip is cut to exactly what the
    // code needs at every width the cover is placed at (a code capped at its
    // 86-point size needs far less than the rule above) — never more than
    // the rule, which is always enough.
    var qr = root.LivingApps && root.LivingApps.pure && root.LivingApps.pure.qrOnCover;
    if (typeof qr !== 'function') return Math.round(safe);
    function fits(sw) {
      var total = w + sw;
      // A wide cover is never placed narrow: the layout gives a figure at
      // least a fifth of the page's height, so its width is at least that
      // times its shape (capped at the column a page offers).
      var from = Math.max(120, Math.min(STRIP_RW_MIN, STRIP_RW_PER_RATIO * total / h));
      for (var rw = from; rw <= STRIP_RW_MAX; rw += 20) {
        var rh = rw * h / total;
        var pad = qr(0, 0, rw, rh);
        if (pad.padX + pad.padW + 2 > rw * sw / total) return false;
      }
      return true;
    }
    if (!fits(safe)) return Math.round(safe);
    var lo = 0, hi = safe;
    for (var k = 0; k < 24; k++) {
      var mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid; else lo = mid;
    }
    return Math.round(Math.max(hi, h * 0.2));
  }

  /* ---------------------------------------------------------------
     Painting — needs a DOM.
     --------------------------------------------------------------- */

  /* An SVG figure as a PNG data URL on white, at most maxW wide. */
  function svgToPng(svg, maxW, maxH) {
    return new Promise(function (resolve, reject) {
      var clean = cleanSvg(svg);
      if (!clean) { reject(new Error('That figure is not a usable SVG.')); return; }
      var size = svgSize(clean);
      var mw = maxW || FIG_COVER_MAX_W, mh = maxH || FIG_COVER_MAX_H;
      var k = Math.min(mw / size.w, mh / size.h);
      if (!isFinite(k) || k <= 0) k = 1;
      // Small diagrams are drawn up so the lines stay crisp on paper.
      var W = Math.max(1, Math.round(size.w * k)), H = Math.max(1, Math.round(size.h * k));
      var img = new Image();
      img.onload = function () {
        try {
          var c = document.createElement('canvas');
          c.width = W; c.height = H;
          var x = c.getContext('2d');
          x.fillStyle = '#FFFFFF';
          x.fillRect(0, 0, W, H);
          x.drawImage(img, 0, 0, W, H);
          resolve({ canvas: c, w: W, h: H, src: c.toDataURL('image/png') });
        } catch (e) { reject(e); }
      };
      img.onerror = function () { reject(new Error('That figure could not be drawn.')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgForImage(clean, W, H));
    });
  }

  function roundRect(x, X, Y, W, H, R) {
    x.beginPath();
    x.moveTo(X + R, Y);
    x.arcTo(X + W, Y, X + W, Y + H, R);
    x.arcTo(X + W, Y + H, X, Y + H, R);
    x.arcTo(X, Y + H, X, Y, R);
    x.arcTo(X, Y, X + W, Y, R);
    x.closePath();
  }
  function star(x, cx, cy, R, r, fill) {
    x.beginPath();
    for (var i = 0; i < 8; i++) {
      var ang = -Math.PI / 2 + i * Math.PI / 4;
      var rad = i % 2 ? r : R;
      var px = cx + Math.cos(ang) * rad, py = cy + Math.sin(ang) * rad;
      if (i) x.lineTo(px, py); else x.moveTo(px, py);
    }
    x.closePath();
    x.fillStyle = fill;
    x.fill();
  }

  /* The figure as the picture that carries the app: the gold strip with the
     wand on the left, the diagram on white beside it. { src, ratio, w, h }. */
  function paintFigureCover(svg) {
    return svgToPng(svg, FIG_COVER_MAX_W, FIG_COVER_MAX_H).then(function (fig) {
      var sw = stripWidth(fig.w, fig.h);
      var W = fig.w + sw, H = fig.h;
      var c = document.createElement('canvas');
      c.width = W; c.height = H;
      var x = c.getContext('2d');
      x.fillStyle = '#FFFFFF';
      x.fillRect(0, 0, W, H);
      x.drawImage(fig.canvas, sw, 0);
      // The strip: warm gold, rounded on the inside edge.
      var g = x.createLinearGradient(0, 0, sw, H);
      g.addColorStop(0, '#FFE7A3');
      g.addColorStop(1, '#F6C343');
      x.fillStyle = g;
      roundRect(x, 0, 0, sw, H, Math.min(18, sw * 0.12));
      x.fill();
      x.fillRect(0, 0, Math.min(18, sw * 0.12), H);
      // The wand, drawn (an emoji draws differently on every device).
      var s = Math.min(sw, H) / 120;
      var cx = sw / 2, cy = H / 2 - 10 * s;
      x.save();
      x.lineCap = 'round';
      x.strokeStyle = '#FFFFFF'; x.lineWidth = 11 * s;
      x.beginPath(); x.moveTo(cx - 16 * s, cy - 16 * s); x.lineTo(cx + 26 * s, cy + 26 * s); x.stroke();
      x.strokeStyle = '#2D1F14'; x.lineWidth = 6 * s;
      x.beginPath(); x.moveTo(cx - 16 * s, cy - 16 * s); x.lineTo(cx + 26 * s, cy + 26 * s); x.stroke();
      x.restore();
      star(x, cx - 22 * s, cy - 22 * s, 15 * s, 5 * s, '#FFFFFF');
      star(x, cx - 22 * s, cy - 22 * s, 12 * s, 4 * s, '#B07A00');
      star(x, cx + 20 * s, cy - 30 * s, 6 * s, 2 * s, '#FFFFFF');
      star(x, cx - 34 * s, cy + 14 * s, 5 * s, 1.8 * s, '#FFFFFF');
      x.fillStyle = '#5A3E00';
      x.textAlign = 'center';
      x.textBaseline = 'alphabetic';
      var fs = Math.max(11, Math.round(Math.min(sw / 7.5, H / 9)));
      x.font = '700 ' + fs + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
      x.fillText('Tap to bring', cx, cy + 46 * s + fs * 0.4);
      x.fillText('it alive', cx, cy + 46 * s + fs * 1.5);
      return { src: c.toDataURL('image/png'), ratio: W / H, w: W, h: H, strip: sw };
    });
  }

  /* ---------------------------------------------------------------
     📋 The prompt window.
     env = {
       copy(text)       Promise<bool>
       openUrl(url)
       toast(msg, ms)
       defaults()       { level, subject } of the open worksheet
     }
     --------------------------------------------------------------- */
  function create(env) {
    env = env || {};
    var win = null;
    function say(m, ms) { if (typeof env.toast === 'function') env.toast(m, ms || 3600); }
    function el(tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }
    function copy(text) {
      try { return Promise.resolve(typeof env.copy === 'function' ? env.copy(text) : false).then(function (ok) { return !!ok; }, function () { return false; }); }
      catch (e) { return Promise.resolve(false); }
    }

    function openPrompt(opts) {
      opts = opts || {};
      closePrompt();
      var d = (typeof env.defaults === 'function' && env.defaults()) || {};
      var st = {
        topic: cleanBlock(opts.topic || '', 2400),
        level: LEVELS.indexOf(opts.level || d.level) >= 0 ? (opts.level || d.level) : '',
        subject: (opts.subject || d.subject) === 'math' || (opts.subject || d.subject) === 'science' ? (opts.subject || d.subject) : '',
        question: opts.question !== false
      };
      var back = el('div', 'lqBack');
      back.setAttribute('role', 'dialog');
      back.setAttribute('aria-modal', 'true');
      back.setAttribute('aria-label', 'AI prompt for a living app');
      var card = el('div', 'lqCard');
      card.tabIndex = -1;
      back.appendChild(card);

      var head = el('div', 'lqHead');
      var tt = el('div', 'lqTitles');
      tt.appendChild(el('h2', 'lqTitle', '📋 A prompt for any AI'));
      tt.appendChild(el('p', 'lqSub', 'Paste it into ChatGPT, Claude or Gemini. What comes back is a living app in exactly the shape this app reads — the wand, the sandbox rules and the question on paper — ready to paste into ➕ New app.'));
      head.appendChild(tt);
      var x = el('button', 'lqClose', '✕');
      x.type = 'button'; x.title = 'Close (Esc)'; x.setAttribute('aria-label', 'Close');
      x.addEventListener('click', closePrompt);
      head.appendChild(x);
      card.appendChild(head);

      var body = el('div', 'lqBody');
      var topicLab = el('label', 'lqLabel', 'What should the app show? (optional — you can also type it into the AI)');
      var topic = el('textarea', 'lqTopic');
      topic.rows = 3;
      topic.maxLength = 2400;
      topic.placeholder = 'e.g. How a plant’s stomata open and close through the day, with a question on water loss';
      topic.value = st.topic;
      topicLab.appendChild(topic);
      body.appendChild(topicLab);

      var row = el('div', 'lqRow');
      var lvl = el('select', 'lqLevel');
      lvl.setAttribute('aria-label', 'Level');
      [['', 'Any level']].concat(LEVELS.map(function (l) { return [l, l]; })).forEach(function (o) {
        var op = el('option', null, o[1]); op.value = o[0]; lvl.appendChild(op);
      });
      lvl.value = st.level;
      var subj = el('select', 'lqSubject');
      subj.setAttribute('aria-label', 'Subject');
      [['', 'Any subject']].concat(SUBJECTS.map(function (s) { return [s.id, s.label]; })).forEach(function (o) {
        var op = el('option', null, o[1]); op.value = o[0]; subj.appendChild(op);
      });
      subj.value = st.subject;
      var qLab = el('label', 'lqCheck');
      var qBox = el('input');
      qBox.type = 'checkbox';
      qBox.checked = st.question;
      qLab.appendChild(qBox);
      qLab.appendChild(document.createTextNode(' 📝 Also a question on paper (text, working lines, diagram)'));
      row.appendChild(lvl); row.appendChild(subj); row.appendChild(qLab);
      body.appendChild(row);

      var outLab = el('div', 'lqLabel', 'The prompt');
      body.appendChild(outLab);
      var out = el('textarea', 'lqOut');
      out.readOnly = true;
      out.spellcheck = false;
      out.rows = 12;
      body.appendChild(out);
      var count = el('div', 'lqSmall');
      body.appendChild(count);
      card.appendChild(body);

      var foot = el('div', 'lqFoot');
      var copyBtn = el('button', 'lqBtn lqPrimary', '📋 Copy prompt');
      copyBtn.type = 'button';
      foot.appendChild(copyBtn);
      var opens = el('div', 'lqOpens');
      opens.appendChild(el('span', 'lqSmall', 'Copy and open:'));
      AI_LINKS.forEach(function (a) {
        var b = el('button', 'lqBtn lqGhost', a.label);
        b.type = 'button';
        b.setAttribute('data-ai', a.id);
        b.title = 'Copy the prompt and open ' + a.label + (a.q ? ' with it typed in' : ' — paste it there');
        b.addEventListener('click', function () {
          var p = out.value;
          copy(p).then(function (ok) {
            if (typeof env.openUrl === 'function') env.openUrl(aiLink(a.id, p));
            say(ok ? 'Prompt copied — ' + (a.q ? a.label + ' opens with it typed in. ' : 'paste it into ' + a.label + '. ') + 'Paste its reply into ➕ New app.' : 'Opening ' + a.label + ' — select the prompt here and copy it in.', 5200);
          });
        });
        opens.appendChild(b);
      });
      foot.appendChild(opens);
      card.appendChild(foot);

      function refresh() {
        st.topic = topic.value;
        st.level = lvl.value;
        st.subject = subj.value;
        st.question = qBox.checked;
        out.value = buildPrompt(st);
        count.textContent = out.value.length.toLocaleString() + ' characters · works with any AI that writes code';
      }
      topic.addEventListener('input', refresh);
      lvl.addEventListener('change', refresh);
      subj.addEventListener('change', refresh);
      qBox.addEventListener('change', refresh);
      copyBtn.addEventListener('click', function () {
        copy(out.value).then(function (ok) {
          if (ok) { say('Prompt copied — paste it into any AI, then paste its reply into ➕ New app.', 4600); copyBtn.textContent = '✓ Copied'; setTimeout(function () { if (win && win.back === back) copyBtn.textContent = '📋 Copy prompt'; }, 1800); }
          else { out.focus(); out.select(); say('This device would not let the app copy — the prompt is selected, so copy it yourself.', 5200); }
        });
      });

      // Every key typed here stays here: the worksheet's one-letter tool
      // shortcuts must not fire while a topic is being typed.
      ['keydown', 'keyup', 'keypress', 'paste', 'copy', 'cut'].forEach(function (t) {
        back.addEventListener(t, function (e) {
          if (t === 'keydown' && e.key === 'Escape') { e.preventDefault(); closePrompt(); }
          e.stopPropagation();
        });
      });
      back.addEventListener('pointerdown', function (e) { e.stopPropagation(); if (e.target === back) closePrompt(); });

      document.body.appendChild(back);
      requestAnimationFrame(function () { if (win && win.back === back) back.classList.add('in'); });
      win = { back: back, out: out, refresh: refresh };
      refresh();
      // Focus moves in AT ONCE: a key pressed before it would land on the
      // window underneath (the adder or the library) and close that instead.
      try { topic.focus({ preventScroll: true }); } catch (e) { topic.focus(); }
      return true;
    }
    function closePrompt() {
      if (!win) return;
      var w = win;
      win = null;
      w.back.remove();
    }
    /* Straight to the clipboard, no window — for a button that just wants
       the prompt. */
    function copyPrompt(opts) {
      var d = (typeof env.defaults === 'function' && env.defaults()) || {};
      var p = buildPrompt(Object.assign({ level: d.level, subject: d.subject }, opts || {}));
      return copy(p).then(function (ok) {
        say(ok ? 'Prompt copied — paste it into any AI, then paste its reply into ➕ New app.' : 'This device would not let the app copy.', 4600);
        return ok;
      });
    }
    return {
      openPrompt: openPrompt,
      closePrompt: closePrompt,
      copyPrompt: copyPrompt,
      isOpen: function () { return !!win; },
      prompt: function () { return win ? win.out.value : ''; }
    };
  }

  var api = { pure: pure, create: create, svgToPng: svgToPng, paintFigureCover: paintFigureCover };
  root.LivingQuestion = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
