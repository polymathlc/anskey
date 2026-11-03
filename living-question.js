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
  var HARVEST_SVG_MAX = 400000;     // an SVG read off a running app carries its computed styles, so more
  var HARVEST_BLOCKS_MAX = 80;
  var HARVEST_GRAPHICS_MAX = 8;
  var HARVEST_TEXT_MAX = 1600;      // one block of words
  var HARVEST_PNG_MAX = 3000000;    // characters of a data: URL
  var TABLE_ROWS_MAX = 30;
  var TABLE_COLS_MAX = 10;
  var TABLE_CELL_MAX = 200;
  var DEFAULT_LINES = 5;            // an app with no block still gets somewhere to write
  var DEFAULT_PART_LINES = 3;

  /* The page, in page units (a PDF point at 100%). */
  var MARGIN = 40;
  var TEXT_SIZE = 14;
  var ANSWER_COLOR = '#1F5FBF';

  /* The figure: every picture the app draws, set side by side as one. */
  var FIG_COVER_MAX_W = 1400;
  var FIG_COVER_MAX_H = 900;

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
  function cleanSvg(v, max) {
    var s = str(v).replace(/^﻿/, '').trim();
    if (!s) return '';
    s = s.replace(/<\?xml[\s\S]*?\?>/gi, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/gi, '').trim();
    if (!/^<svg[\s>]/i.test(s) || !/<\/svg>\s*$/i.test(s)) return '';
    if (s.length > (max || FIGURE_MAX)) return '';
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
  function svgForImage(svg, w, h, max) {
    var s = cleanSvg(svg, max);
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
    else if (spec.graphics && spec.graphics.length) bits.push(spec.graphics.length === 1 ? 'a picture' : spec.graphics.length + ' pictures');
    return { parts: spec.parts.length, lines: lines, marks: marks, figure: !!spec.figure || !!(spec.graphics && spec.graphics.length), answers: answers, text: bits.join(' · ') };
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


  /* ---------------------------------------------------------------
     📝 An app with no question block (v1.180.0). Most apps a teacher
     already has were written before the block existed, and an AI does
     not always add it — so "as a question" put the bare title on the page
     and the generic cover beside it, and the question, its diagram and
     its tables were nowhere. Now the app is RUN once in its sandbox and
     read as it is drawn (LivingApps.harvest, HARVEST_BRIDGE): its words,
     tables, SVG diagrams, canvases and pictures. cleanHarvest is the ONE
     door those come through — everything else here reads only what it
     returns.
     --------------------------------------------------------------- */
  var PNG_RE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+\/=]+$/;
  var URL_RE = /^https:\/\/[^\s"'<>\\]+$/;
  function dim(v) { var n = Number(v); return isFinite(n) && n > 0 ? Math.min(4000, Math.round(n)) : 0; }
  function cleanHarvest(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.blocks)) return null;
    var blocks = [], graphics = 0;
    raw.blocks.slice(0, HARVEST_BLOCKS_MAX * 2).forEach(function (b) {
      if (blocks.length >= HARVEST_BLOCKS_MAX || !b || typeof b !== 'object') return;
      if (b.kind === 'text') {
        var t = cleanBlock(b.text, HARVEST_TEXT_MAX);
        if (t) {
          var tb = { kind: 'text', text: t };
          // A heading's level (1–6) rides along: the app's own title is
          // its name, not the question (v1.183.0).
          var hd = clampInt(b.head, 0, 6, 0);
          if (hd) tb.head = hd;
          blocks.push(tb);
        }
        return;
      }
      if (graphics >= HARVEST_GRAPHICS_MAX) return;
      var w = dim(b.w), h = dim(b.h), g = null;
      if (b.kind === 'svg') {
        var svg = cleanSvg(b.svg, HARVEST_SVG_MAX);
        if (svg) g = { kind: 'svg', svg: svg, w: w, h: h };
      } else if (b.kind === 'png') {
        var src = str(b.src);
        if (src.length <= HARVEST_PNG_MAX && PNG_RE.test(src)) g = { kind: 'png', src: src, w: w, h: h };
      } else if (b.kind === 'url') {
        var u = str(b.src);
        if (u.length <= 2000 && URL_RE.test(u)) g = { kind: 'url', src: u, w: w, h: h };
      } else if (b.kind === 'table') {
        var rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, TABLE_ROWS_MAX).map(function (r) {
          var cells = (r && Array.isArray(r.cells) ? r.cells : []).slice(0, TABLE_COLS_MAX).map(function (c) { return cleanLine(c, TABLE_CELL_MAX); });
          return { head: !!(r && r.head), cells: cells };
        }).filter(function (r) { return r.cells.length && r.cells.some(Boolean); });
        if (rows.length) g = { kind: 'table', rows: rows, caption: cleanLine(b.caption, TABLE_CELL_MAX) };
      }
      if (g) { graphics++; blocks.push(g); }
    });
    if (!blocks.length) return null;
    return { title: cleanLine(raw.title, TITLE_MAX), blocks: blocks };
  }

  /* Words that are the app's own controls, not the question: a line
     telling you to press the wand or a button, a keyboard shortcut, a hint
     or a model answer's heading, a checker's summary. (v1.181.0: an app's
     own furniture had been read as the question — "Ctrl + Enter checks",
     "Stuck on (b)? Four small questions", "Model working", "6 lines".) */
  var CHROME_LINE_RE = new RegExp([
    '🪄', '\\bmagic wand\\b',
    '\\b(?:tap|press|click|use|drag|hold|slide) (?:the |a |on )?(?:wand|button|slider|picture|diagram|play|start|reset|here)\\b',
    '\\b(?:ctrl|cmd|⌘|shift|alt)\\s*\\+', '\\b(?:enter|return)\\b[^.?!]{0,24}\\bcheck',
    '\\bpress (?:enter|return|space)\\b', '\\bstuck\\b', '\\bhints?\\b', '\\bmodel (?:working|answers?|solutions?)\\b',
    '\\bblurred\\b', '\\btry again\\b', '\\bshow (?:me|the answer|answers?|working)\\b', '\\breveal\\b',
    '\\bcheck (?:my|your|the) (?:answer|working)s?\\b', '\\bwell done\\b', '\\bcorrect!', '\\bnot quite\\b',
    '\\bsmall questions?\\b', '\\banswer them in order\\b',
    // The centre's own name off a logo or a header strap (v1.182.0).
    '^\\s*polymath(?:\\s+learning(?:\\s+cent(?:re|er))?)?\\s*$', '^\\s*learning\\s+cent(?:re|er)\\s*$'
  ].join('|'), 'i');
  /* A line that is a label, not words: "Question", "6 lines", "1.",
     "Answers: (a) ? (b) ?", a bare bullet. */
  var LABEL_LINE_RE = /^(?:(?:the )?(?:question|questions|q\d*|task|activity|problem|working|answers?|answer key|hints?|notes?|instructions?|your answer|explanation|solution|the experiment|experiment|results?|marks?|score|level|topic)\s*:?|\d+\s*(?:lines?|marks?|m)|\d+\s*[.)]|[•·▪◦\-–—*]|answers?\s*:.*|(?:\(\s*[a-h]\s*\)\s*[?_…]+\s*)+)\s*$/i;
  /* A line that ENDS a part: after it, until the next part, everything is
     the app's help, not the question. */
  var STOP_LINE_RE = /\bstuck\b|\bhints?\b|\bmodel (?:working|answers?|solutions?)\b|\bsmall questions?\b|\bstep by step\b|\bscaffold/i;
  /* "(a) …", "(ii) …", "a) …", "b. …" — a part. Two letters at most, or a
     roman numeral, so "(1)" "(2)" options of a multiple choice stay words. */
  var PART_RE = /^\s*\(\s*([a-h]|i{1,3}|iv|vi{0,3}|ix|x)\s*\)\s*(.*)$/i;
  var PART_RE_BARE = /^\s*([a-h])[).]\s+(\S.*)$/;
  /* "[2]", "(2 marks)", "[1m]" at the end of a line. */
  var MARKS_RE = /\s*[\[(]\s*(\d{1,2})\s*(?:m|marks?)?\s*[\])]\s*$/i;
  function wordCount(t) { return (str(t).match(/[A-Za-z0-9À-￿]+/g) || []).length; }
  function sameWords(a, b) {
    var x = str(a).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), y = str(b).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return !!x && x === y;
  }
  function takeMarks(t) {
    var m = str(t).match(MARKS_RE);
    return m ? { text: str(t).slice(0, m.index).trim(), marks: clampInt(m[1], 0, MARKS_MAX, 0) } : { text: str(t), marks: 0 };
  }
  function partLines(marks) { return marks ? Math.max(2, Math.min(8, marks * 2)) : DEFAULT_PART_LINES; }

  /* The question an app shows, as a spec — the same shape cleanSpec gives,
     plus `graphics` (the diagrams and tables, in order), `flow` (the
     question in READING ORDER) and `harvested: true`. Null when the
     harvest holds nothing.

     📝 v1.183.0 — EVERYTHING THE QUESTION SAYS, WHERE IT SAYS IT. A real
     question is a story told between its parts: "Alisha took a slab of
     frozen meat…" before the first diagram, "(a) …", then "After the meat
     was thawed, Alisha cut the slab…" and a second diagram before "(b)".
     Two faults lost that story:
       • a STOP line ("…acts out the model answer…") seen BEFORE any part
         closed the stem, so every word up to (a) was thrown away — the
         opening paragraph never reached the paper;
       • a lead-in after a finished part was glued onto that part's words,
         and every picture was squeezed into ONE figure under the stem, so
         the second diagram sat above the paragraph that introduces it.
     Now the flow keeps the order the app draws it in: words, a picture,
     a part and its working lines, the next lead-in, the next picture, the
     next part. A part is FINISHED once its marks are read ("[1]") or a
     picture / a new part follows it; words after a finished part are the
     next lead-in, never more of the part.

     flow items:
       { t: 'text', text }   words that are not a part (stem or lead-in)
       { t: 'fig', g }       graphics[g] (a table, a diagram, a picture)
       { t: 'part', p }      parts[p]'s words
       { t: 'answer', p }    parts[p]'s working lines
       { t: 'lines' }        the stem's own working lines (no parts) */
  var STOP_LINE_LEN = 120;
  var CHROME_LINE_LEN = 320;
  function isChromeLine(l) {
    if (!CHROME_LINE_RE.test(l)) return false;
    // A long line is the question's own words that happen to say "tap" —
    // unless it is plainly talking about the app's wand or its buttons.
    if (l.length < 160) return true;
    return l.length < CHROME_LINE_LEN && /\b(?:magic wand|wand|tap (?:a|the) picture|button|one line per tap|submit)\b/i.test(l);
  }
  function specFromHarvest(app, raw) {
    var h = cleanHarvest(raw);
    if (!h) return null;
    var title = cleanLine(app && app.title, TITLE_MAX) || h.title || 'Living app';
    // 1. The harvest as one stream: lines of words and graphics, in order.
    var items = [], graphics = [];
    h.blocks.forEach(function (b) {
      if (b.kind !== 'text') { graphics.push(b); items.push({ g: graphics.length - 1 }); return; }
      b.text.split('\n').forEach(function (l) {
        l = l.replace(/\s+/g, ' ').trim();
        if (!l) return;
        // A stop line is kept as a marker: it closes the part it follows.
        if (STOP_LINE_RE.test(l) && l.length < STOP_LINE_LEN && !PART_RE.test(l)) { items.push({ stop: true }); return; }
        if (isChromeLine(l)) return;
        if (LABEL_LINE_RE.test(l)) return;
        // "Question" run into the words after it ("QuestionMr Murthu…").
        l = l.replace(/^(?:question|task)\s*:?\s*(?=[A-Z(])/i, '');
        if (l) items.push({ text: l, head: b.head || 0 });
      });
    });
    // 2. The app's own heading is its name, not the question: drop the
    //    leading headings (and stop markers) before the first real words.
    while (items.length) {
      var f = items[0];
      if (f.stop) { items.shift(); continue; }
      if (f.text && (f.head || sameWords(f.text, title) || sameWords(f.text, h.title))) { items.shift(); continue; }
      break;
    }
    // A bare "(a)" on its own line, followed by its words: one line.
    var joined = [];
    items.forEach(function (it) {
      var prev = joined[joined.length - 1];
      if (it.text && prev && prev.text && !prev.joinedPart) {
        var pm = prev.text.match(PART_RE) || prev.text.match(/^\s*\(?([a-h])\)\s*$/i);
        if (pm && !str(pm[2]).trim() && !PART_RE.test(it.text)) {
          prev.text = prev.text.trim() + ' ' + it.text;
          prev.joinedPart = true;
          return;
        }
      }
      joined.push({ text: it.text, head: it.head, g: it.g, stop: it.stop });
    });
    items = joined;
    // 3. Walk it.
    var flow = [], parts = [], stemLines = [], cur = null, done = false, closed = false, curFig = false;
    function pushText(t) {
      var last = flow[flow.length - 1];
      if (last && last.t === 'text') last.text += '\n' + t;
      else flow.push({ t: 'text', text: t });
      if (!parts.length) stemLines.push(t);
    }
    function finish() {
      if (cur) { flow.push({ t: 'answer', p: parts.indexOf(cur) }); cur = null; done = false; curFig = false; }
    }
    items.forEach(function (it) {
      if (it.stop) {
        // Help that follows a part: everything until the next part is the
        // app's scaffold. Before any part it is only a line of help.
        if (cur || parts.length) { finish(); closed = true; }
        return;
      }
      if (it.g != null) {
        if (closed) return;
        if (cur && done) finish();
        // A picture inside an open part (its marks not read yet) belongs to
        // that part: its working lines go under the picture, and words
        // after it are still the part's ("…the graph below. <graph> What
        // does it show? [2]").
        flow.push({ t: 'fig', g: it.g });
        if (cur) curFig = true;
        return;
      }
      var l = it.text;
      var m = l.match(PART_RE) || l.match(PART_RE_BARE);
      if (m && parts.length < PARTS_MAX) {
        var mk = takeMarks(m[2]);
        var label = '(' + m[1].toLowerCase() + ')';
        // The same part read twice (a checker's echo of it) is one part.
        if (parts.some(function (p) { return p.label === label; })) { finish(); closed = true; return; }
        finish();
        cur = { label: label, text: mk.text, marks: mk.marks };
        parts.push(cur);
        flow.push({ t: 'part', p: parts.length - 1 });
        done = !!mk.marks;
        curFig = false;
        closed = false;
        return;
      }
      if (closed) return;
      if (cur && !done) {
        var more = takeMarks(l);
        if (curFig) { if (more.text) pushText(more.text); }
        else cur.text = (cur.text ? cur.text + '\n' : '') + more.text;
        if (more.marks) { cur.marks = more.marks; done = true; }
        return;
      }
      if (cur && done) finish();
      pushText(l);
    });
    finish();
    // The words before the first part, and the stem's own marks / lines.
    var stemText = cleanBlock(stemLines.join('\n'), STEM_MAX);
    var stemMarks = 0;
    if (!parts.length) {
      var sm = takeMarks(stemText); stemText = sm.text; stemMarks = sm.marks;
      // The flow's words lose the marks too.
      for (var fi = flow.length - 1; fi >= 0; fi--) {
        if (flow[fi].t === 'text') { flow[fi].text = takeMarks(flow[fi].text).text; break; }
      }
    }
    var said = wordCount(stemText) + parts.reduce(function (n, p) { return n + wordCount(p.text); }, 0);
    // Too few words to stand on their own (a readout, a label): the title
    // goes first so the question still says what it is about.
    if (said < 4) {
      stemText = cleanBlock(title + (stemText ? '\n' + stemText : ''), STEM_MAX);
      if (flow.length && flow[0].t === 'text') flow[0].text = title + '\n' + flow[0].text;
      else flow.unshift({ t: 'text', text: title });
    }
    flow.forEach(function (it) { if (it.t === 'text') it.text = cleanBlock(it.text, STEM_MAX); });
    flow = flow.filter(function (it) { return it.t !== 'text' || it.text; });
    var lines = parts.length ? 0 : (stemMarks ? partLines(stemMarks) : DEFAULT_LINES);
    if (!parts.length) flow.push({ t: 'lines' });
    return {
      v: VERSION,
      title: title,
      stem: stemText,
      figure: '',
      graphics: graphics,
      flow: flow,
      parts: parts.map(function (p, i) {
        return { label: cleanLabel(p.label, i), text: cleanBlock(p.text, PART_TEXT_MAX), marks: p.marks, lines: partLines(p.marks), answer: '' };
      }),
      lines: lines,
      marks: stemMarks,
      answer: '',
      harvested: true
    };
  }

  /* The flow, made safe: only the item kinds questionBlocks knows, each
     pointing at a real part / graphic, every part placed once. Null when
     the flow cannot be trusted — the caller then lays the question out
     the old way (stem, one figure, the parts). */
  function cleanFlow(spec) {
    var flow = spec && spec.flow;
    if (!Array.isArray(flow) || !flow.length) return null;
    var parts = (spec.parts || []).length, graphics = (spec.graphics || []).length;
    var seenPart = {}, seenAnswer = {}, out = [];
    for (var i = 0; i < flow.length && out.length < 200; i++) {
      var it = flow[i];
      if (!it || typeof it !== 'object') continue;
      if (it.t === 'text') { var t = cleanBlock(it.text, STEM_MAX); if (t) out.push({ t: 'text', text: t }); }
      else if (it.t === 'fig') { var g = clampInt(it.g, -1, 999, -1); if (g >= 0 && g < graphics) out.push({ t: 'fig', g: g }); }
      else if (it.t === 'part' || it.t === 'answer') {
        var p = clampInt(it.p, -1, 99, -1);
        if (p < 0 || p >= parts) continue;
        var seen = it.t === 'part' ? seenPart : seenAnswer;
        if (seen[p]) continue;
        seen[p] = true;
        out.push({ t: it.t, p: p });
      } else if (it.t === 'lines') out.push({ t: 'lines' });
    }
    for (var k = 0; k < parts; k++) if (!seenPart[k]) return null;
    return out;
  }

  /* An app WITH a block keeps its block — the teacher's (or the AI's) own
     words win — but a block with no figure borrows the pictures the app
     draws, so the diagram is still on the paper. */
  function mergeHarvest(spec, app, raw) {
    if (!spec || spec.fallback) return specFromHarvest(app, raw) || spec;
    if (spec.figure) return spec;
    var h = cleanHarvest(raw);
    var graphics = h ? h.blocks.filter(function (b) { return b.kind !== 'text'; }) : [];
    if (!graphics.length) return spec;
    var out = {};
    Object.keys(spec).forEach(function (k) { out[k] = spec[k]; });
    out.graphics = graphics;
    return out;
  }

  /* 📝 THE QUESTION IN THE QUESTION BANK'S OWN SHAPE (v1.181.0). The
     portal's questions go on paper through QuestionBank.paintQuestion —
     words, the diagram, the table, each part with its marks on the right,
     ruled lines under it — and a living question is now painted by the
     very same painter, so the two look the same on a worksheet. This turns
     a spec into the blocks that painter reads. `figure` is the picture
     (a data: URL) of everything the app draws that is not a table; each
     table goes in as a real table. The working lines carry a `tag`
     ('q' for the stem, 'p0', 'p1'… for the parts) so the page can find
     them again for the model answers. */
  function escHtml(v) {
    return str(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function parasHtml(t) {
    return str(t).split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean)
      .map(function (l) { return '<p>' + escHtml(l) + '</p>'; }).join('');
  }
  var ROMANS = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii'];
  /* "(a)" → { part: 'a' }, "(ii)" → { subPart: 'ii' }, "(a)(i)" → both;
     anything else is written in front of the part's words. */
  function partKey(label) {
    var t = str(label).toLowerCase().replace(/\s+/g, '');
    var m = t.match(/^\(([a-h])\)(?:\((i{1,3}|iv|vi{0,3})\))?$/);
    if (m) return { part: m[1], subPart: m[2] || '', prefix: '' };
    var r = t.match(/^\((i{1,3}|iv|vi{0,3})\)$/);
    if (r && ROMANS.indexOf(r[1]) >= 0) return { part: '', subPart: r[1], prefix: '' };
    return { part: '', subPart: '', prefix: str(label).trim() };
  }
  function tableBlock(g) {
    var rows = (g.rows || []).map(function (r) {
      return (r.cells || []).map(function (c) { return r.head ? '<b>' + escHtml(c) + '</b>' : escHtml(c); });
    });
    return { type: 'table', data: rows };
  }
  /* The pictures of a flow, grouped: pictures with no words between them
     sit together in ONE image (side by side, as the app drew them); a
     table is its own real table. Returns [[g, g…], …] in order. Pure. */
  function flowGroups(spec, flow) {
    flow = flow || cleanFlow(spec);
    var graphics = (spec && spec.graphics) || [], groups = [], cur = null;
    (flow || []).forEach(function (it) {
      var g = it.t === 'fig' ? graphics[it.g] : null;
      if (g && g.kind !== 'table') {
        if (!cur) { cur = []; groups.push(cur); }
        cur.push(it.g);
      } else cur = null;
    });
    return groups;
  }
  function partBlock(p) {
    var k = partKey(p.label);
    var words = str(p.text).trim();
    var b = { type: 'text', content: parasHtml(k.prefix ? k.prefix + ' ' + words : words), marks: p.marks || 0 };
    if (k.part) b.part = k.part;
    if (k.subPart) b.subPart = k.subPart;
    return b;
  }
  function answerBlock(p, i) {
    return p.lines ? { type: 'plainanswer', lines: clampInt(p.lines, 1, LINES_MAX, DEFAULT_PART_LINES), tag: 'p' + i } : null;
  }
  /* figure: ONE picture of every non-table graphic (the old layout, and
     an app with a block). figs: the flow's picture groups, painted, in
     flowGroups order — when the spec carries a trusted flow, the question
     is laid out in READING ORDER (v1.183.0). */
  function questionBlocks(spec, figure, figs) {
    spec = spec || { parts: [] };
    var parts = spec.parts || [];
    var blocks = [];
    var flow = cleanFlow(spec);
    if (flow) {
      var graphics = spec.graphics || [], gi = -1, inGroup = false, placed = {};
      flow.forEach(function (it) {
        if (it.t === 'fig') {
          var g = graphics[it.g];
          if (g && g.kind === 'table') { inGroup = false; if (g.rows && g.rows.length) blocks.push(tableBlock(g)); return; }
          if (!inGroup) { gi++; inGroup = true; var src = figs && figs[gi]; if (src) blocks.push({ type: 'image', url: src }); }
          return;
        }
        inGroup = false;
        if (it.t === 'text') blocks.push({ type: 'text', content: parasHtml(it.text), marks: 0 });
        else if (it.t === 'part') blocks.push(partBlock(parts[it.p]));
        else if (it.t === 'answer') { placed[it.p] = true; var ab = answerBlock(parts[it.p], it.p); if (ab) blocks.push(ab); }
        else if (it.t === 'lines' && !parts.length && spec.lines) blocks.push({ type: 'plainanswer', lines: clampInt(spec.lines, 1, LINES_MAX, DEFAULT_LINES), tag: 'q' });
      });
      // A part whose working lines the flow never placed still gets them.
      parts.forEach(function (p, i) { if (!placed[i]) { var ab = answerBlock(p, i); if (ab) blocks.push(ab); } });
      // The stem's marks (a question with no parts) go on its last words.
      if (!parts.length && spec.marks) {
        for (var k = blocks.length - 1; k >= 0; k--) if (blocks[k].type === 'text') { blocks[k].marks = spec.marks; break; }
      }
      return { blocks: blocks };
    }
    var stem = str(spec.stem).trim();
    if (stem) blocks.push({ type: 'text', content: parasHtml(stem), marks: parts.length ? 0 : (spec.marks || 0) });
    if (figure) blocks.push({ type: 'image', url: figure });
    (spec.graphics || []).forEach(function (g) { if (g && g.kind === 'table' && g.rows && g.rows.length) blocks.push(tableBlock(g)); });
    if (!parts.length && spec.lines) blocks.push({ type: 'plainanswer', lines: clampInt(spec.lines, 1, LINES_MAX, DEFAULT_LINES), tag: 'q' });
    parts.forEach(function (p, i) {
      blocks.push(partBlock(p));
      var ab = answerBlock(p, i);
      if (ab) blocks.push(ab);
    });
    return { blocks: blocks };
  }
  /* The plain picture of an app put on the page as itself (➕ Add to page):
     its title in bold, then what it draws. */
  function appBlocks(app, graphics, figure) {
    var blocks = [{ type: 'text', content: '<p><b>' + escHtml(cleanLine(app && app.title, TITLE_MAX) || 'Living app') + '</b></p>' }];
    if (figure) blocks.push({ type: 'image', url: figure });
    (graphics || []).forEach(function (g) { if (g && g.kind === 'table' && g.rows && g.rows.length) blocks.push(tableBlock(g)); });
    return { blocks: blocks };
  }

  /* Does putting this app on paper need it run first? */
  function needsHarvest(spec) { return !spec || !!spec.fallback || !spec.figure; }

  /* How the pictures sit together: greedy rows, each picture at its own
     size (capped), rows no wider than maxW. Pure, so the test can pin it.
     items: [{ w, h }] → { w, h, boxes: [{ x, y, w, h }] } */
  var COMPOSE_MAX_W = 1400;
  var COMPOSE_ITEM_MAX_H = 820;
  var COMPOSE_GAP = 32;
  function composeBoxes(items, maxW, gap) {
    maxW = maxW || COMPOSE_MAX_W;
    gap = gap == null ? COMPOSE_GAP : gap;
    var boxes = [], rows = [], row = null;
    (items || []).forEach(function (it, i) {
      var w = Math.max(1, Number(it && it.w) || 1), h = Math.max(1, Number(it && it.h) || 1);
      var k = Math.min(1, maxW / w, COMPOSE_ITEM_MAX_H / h);
      w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
      if (!row || row.w + gap + w > maxW) { row = { items: [], w: 0, h: 0 }; rows.push(row); }
      row.items.push({ i: i, w: w, h: h });
      row.w += (row.items.length > 1 ? gap : 0) + w;
      row.h = Math.max(row.h, h);
    });
    var W = 0, y = 0;
    rows.forEach(function (r) { W = Math.max(W, r.w); });
    rows.forEach(function (r, ri) {
      var x = Math.round((W - r.w) / 2);
      r.items.forEach(function (it) {
        boxes[it.i] = { x: x, y: y + Math.round((r.h - it.h) / 2), w: it.w, h: it.h };
        x += it.w + gap;
      });
      y += r.h + (ri < rows.length - 1 ? gap : 0);
    });
    return { w: Math.max(1, W), h: Math.max(1, y), boxes: boxes };
  }

  /* A table's columns, sized from the longest word run in each, capped,
     so a long cell wraps rather than stretching the table off the paper.
     measure(text) → width. Pure. */
  var TABLE_COL_MAX = 380;
  var TABLE_COL_MIN = 70;
  var TABLE_PAD = 16;
  function tableColumns(rows, measure) {
    var n = 0;
    rows.forEach(function (r) { n = Math.max(n, r.cells.length); });
    var cols = [];
    for (var c = 0; c < n; c++) {
      var w = TABLE_COL_MIN;
      rows.forEach(function (r) { w = Math.max(w, measure(r.cells[c] || '') + TABLE_PAD * 2); });
      cols.push(Math.min(TABLE_COL_MAX, Math.ceil(w)));
    }
    return cols;
  }
  function wrapCell(text, width, measure) {
    var words = str(text).split(/\s+/).filter(Boolean), out = [], line = '';
    words.forEach(function (wd) {
      var t = line ? line + ' ' + wd : wd;
      if (!line || measure(t) <= width) line = t;
      else { out.push(line); line = wd; }
    });
    if (line) out.push(line);
    return out.length ? out : [''];
  }

  var pure = {
    VERSION: VERSION, SPEC_ID: SPEC_ID, DEFAULT_LINES: DEFAULT_LINES, DEFAULT_PART_LINES: DEFAULT_PART_LINES,
    LINES_MAX: LINES_MAX, PARTS_MAX: PARTS_MAX, FIGURE_MAX: FIGURE_MAX, MARGIN: MARGIN, TEXT_SIZE: TEXT_SIZE,
    ANSWER_COLOR: ANSWER_COLOR, AI_LINKS: AI_LINKS, AI_URL_MAX: AI_URL_MAX, LEVELS: LEVELS, SUBJECTS: SUBJECTS,
    cleanLine: cleanLine, cleanBlock: cleanBlock, cleanSvg: cleanSvg, svgSize: svgSize, svgForImage: svgForImage,
    readSpec: readSpec, cleanSpec: cleanSpec, questionOf: questionOf, figureOf: figureOf, fallbackSpec: fallbackSpec, specFor: specFor, summary: summary,
    stemText: stemText, partText: partText, extractHtml: extractHtml,
    buildPrompt: buildPrompt, aiLink: aiLink, autoLabel: autoLabel,
    cleanHarvest: cleanHarvest, specFromHarvest: specFromHarvest, mergeHarvest: mergeHarvest, needsHarvest: needsHarvest,
    composeBoxes: composeBoxes, tableColumns: tableColumns, wrapCell: wrapCell, HARVEST_GRAPHICS_MAX: HARVEST_GRAPHICS_MAX,
    questionBlocks: questionBlocks, appBlocks: appBlocks, cleanFlow: cleanFlow, flowGroups: flowGroups, isChromeLine: isChromeLine, partKey: partKey, CHROME_LINE_RE: CHROME_LINE_RE, LABEL_LINE_RE: LABEL_LINE_RE, STOP_LINE_RE: STOP_LINE_RE
  };

  /* ---------------------------------------------------------------
     Painting — needs a DOM.
     --------------------------------------------------------------- */

  /* An SVG figure as a PNG data URL on white, at most maxW wide. */
  function svgToPng(svg, maxW, maxH, svgMax) {
    return new Promise(function (resolve, reject) {
      var clean = cleanSvg(svg, svgMax);
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
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgForImage(clean, W, H, svgMax));
    });
  }

  /* 📝 The pictures an app draws (v1.180.0), each drawn on its own canvas
     and set side by side in rows (composeBoxes), as ONE figure — so the
     layout, the gold strip and the printed QR code are exactly a block
     figure's. A picture that cannot be drawn (a cross-site photograph the
     browser will not let a canvas read) is left out, never the rest. */
  var GRAPHIC_SCALE = 2;            // CSS pixels → canvas pixels, for crisp lines on paper
  function blankCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    var x = c.getContext('2d');
    x.fillStyle = '#FFFFFF';
    x.fillRect(0, 0, c.width, c.height);
    return c;
  }
  function loadImage(src, cross) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      if (cross) img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('That picture could not be loaded.')); };
      img.src = src;
    });
  }
  function imageCanvas(g) {
    return loadImage(g.src, g.kind === 'url').then(function (img) {
      var nw = img.naturalWidth || g.w || 1, nh = img.naturalHeight || g.h || 1;
      var w = g.w ? g.w * GRAPHIC_SCALE : nw, h = g.w ? w * nh / nw : nh;
      var k = Math.min(1, FIG_COVER_MAX_W / w, FIG_COVER_MAX_H / h);
      var c = blankCanvas(w * k, h * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      if (g.kind === 'url') c.toDataURL('image/png');   // throws now if the picture tainted it
      return c;
    });
  }
  var TABLE_FONT = 30;
  var TABLE_LINE = 40;
  function tableCanvas(g) {
    var probe = document.createElement('canvas').getContext('2d');
    var font = TABLE_FONT + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
    var bold = '700 ' + font;
    function measure(t) { probe.font = bold; return probe.measureText(t).width; }
    var cols = tableColumns(g.rows, measure);
    var heights = g.rows.map(function (r) {
      var most = 1;
      cols.forEach(function (cw, i) { most = Math.max(most, wrapCell(r.cells[i] || '', cw - TABLE_PAD * 2, measure).length); });
      return most * TABLE_LINE + TABLE_PAD * 1.2;
    });
    var capH = g.caption ? TABLE_LINE + 10 : 0;
    var W = cols.reduce(function (a, b) { return a + b; }, 0) + 4;
    var H = heights.reduce(function (a, b) { return a + b; }, 0) + capH + 4;
    var c = blankCanvas(W, H);
    var x = c.getContext('2d');
    x.textBaseline = 'top';
    x.fillStyle = '#1A1A1A';
    if (g.caption) { x.font = bold; x.fillText(g.caption, 2, 4); }
    var y = capH + 2;
    g.rows.forEach(function (r, ri) {
      var cx = 2;
      if (r.head) { x.fillStyle = '#F1F3F5'; x.fillRect(2, y, W - 4, heights[ri]); }
      cols.forEach(function (cw, ci) {
        x.font = r.head ? bold : font;
        x.fillStyle = '#1A1A1A';
        wrapCell(r.cells[ci] || '', cw - TABLE_PAD * 2, function (t) { x.font = r.head ? bold : font; return x.measureText(t).width; }).forEach(function (ln, li) {
          x.fillText(ln, cx + TABLE_PAD, y + TABLE_PAD * 0.6 + li * TABLE_LINE);
        });
        x.strokeStyle = '#7C8792'; x.lineWidth = 2;
        x.strokeRect(cx, y, cw, heights[ri]);
        cx += cw;
      });
      y += heights[ri];
    });
    return Promise.resolve(c);
  }
  function graphicCanvas(g) {
    if (g.kind === 'svg') {
      var w = (g.w || 500) * GRAPHIC_SCALE, h = (g.h || 300) * GRAPHIC_SCALE;
      var k = Math.min(1, FIG_COVER_MAX_W / w, FIG_COVER_MAX_H / h);
      return svgToPng(g.svg, w * k, h * k, HARVEST_SVG_MAX).then(function (r) { return r.canvas; });
    }
    if (g.kind === 'png' || g.kind === 'url') return imageCanvas(g);
    if (g.kind === 'table') return tableCanvas(g);
    return Promise.reject(new Error('unknown picture'));
  }
  function paintGraphics(graphics) {
    var list = (graphics || []).slice(0, HARVEST_GRAPHICS_MAX);
    return Promise.all(list.map(function (g) {
      return graphicCanvas(g).then(function (c) { return c; }, function (e) { try { console.warn('A picture in the app could not be drawn', e); } catch (x) {} return null; });
    })).then(function (canvases) {
      var got = canvases.filter(Boolean);
      if (!got.length) return null;
      var plan = composeBoxes(got.map(function (c) { return { w: c.width, h: c.height }; }));
      var out = blankCanvas(plan.w, plan.h);
      var x = out.getContext('2d');
      got.forEach(function (c, i) { var b = plan.boxes[i]; x.drawImage(c, b.x, b.y, b.w, b.h); });
      // The whole figure is kept to the cover's own size.
      var k = Math.min(1, FIG_COVER_MAX_W / plan.w, (FIG_COVER_MAX_H * 1.6) / plan.h);
      if (k < 1) {
        var small = blankCanvas(plan.w * k, plan.h * k);
        small.getContext('2d').drawImage(out, 0, 0, small.width, small.height);
        out = small;
      }
      return { canvas: out, w: out.width, h: out.height, count: got.length };
    });
  }
  /* 📝 The pictures that are not tables, as one figure (a data: URL), or ''. */
  function figureSrc(spec) {
    if (spec && spec.figure) {
      return svgToPng(spec.figure, FIG_COVER_MAX_W, FIG_COVER_MAX_H).then(function (r) { return { src: r.src, count: 1 }; },
        function (e) { try { console.warn('The question’s diagram could not be drawn', e); } catch (x) {} return { src: '', count: 0 }; });
    }
    var pics = ((spec && spec.graphics) || []).filter(function (g) { return g && g.kind !== 'table'; });
    if (!pics.length) return Promise.resolve({ src: '', count: 0 });
    return paintGraphics(pics).then(function (fig) {
      if (!fig) return { src: '', count: 0 };
      try { return { src: fig.canvas.toDataURL('image/png'), count: fig.count }; } catch (e) { return { src: '', count: 0 }; }
    }, function () { return { src: '', count: 0 }; });
  }
  /* Paints blocks through the question bank's own painter, with the white
     gutter on the right and the corner at its top right (v1.182.0): the
     app's QR code in a small square, "living app" in small type under it
     and the premium wand beside the words. Resolves
     { src, ratio, w, h, corner, tags, qr }. */
  function paintBlocks(q, app) {
    var QB = root.QuestionBank, LA = root.LivingApps;
    if (!QB || typeof QB.paintQuestion !== 'function') return Promise.reject(new Error('The question painter is not loaded.'));
    var gutter = (LA && LA.pure && LA.pure.CORNER_GUTTER) || 84;
    var corner = null;
    var matrix = LA && LA.pure && typeof LA.pure.qrMatrixFor === 'function' ? LA.pure.qrMatrixFor(app) : null;
    return QB.paintQuestion(q, {
      gutter: gutter,
      decorate: function (ctx, info) {
        if (!LA || !LA.pure) return;
        corner = LA.pure.cornerFor(info.w, info.h, info.gutter);
        if (typeof LA.drawCornerBadge === 'function') LA.drawCornerBadge(ctx, info.w, info.h, corner, matrix);
        else if (typeof LA.drawCornerWand === 'function') LA.drawCornerWand(ctx, info.w, info.h, corner);
      }
    }).then(function (pic) {
      pic.corner = corner;
      pic.qr = !!matrix;
      return pic;
    });
  }
  function withCounts(q, fig, app) {
    return paintBlocks(q, app).then(function (pic) {
      pic.count = fig.count;
      pic.tables = q.blocks.filter(function (b) { return b.type === 'table'; }).length;
      return pic;
    });
  }
  /* 📝 As a question: the whole question as ONE picture in the bank's
     format. Resolves the painted picture plus `count` (pictures in the
     figure) and `tables`. */
  function paintQuestionPicture(spec, app) {
    var flow = spec && !spec.figure ? cleanFlow(spec) : null;
    if (flow) {
      // In reading order: each run of pictures painted on its own.
      var groups = flowGroups(spec, flow);
      return Promise.all(groups.map(function (ids) {
        var list = ids.map(function (i) { return spec.graphics[i]; });
        return paintGraphics(list).then(function (fig) {
          if (!fig) return { src: '', count: 0 };
          try { return { src: fig.canvas.toDataURL('image/png'), count: fig.count }; } catch (e) { return { src: '', count: 0 }; }
        }, function () { return { src: '', count: 0 }; });
      })).then(function (figs) {
        var count = figs.reduce(function (n, f) { return n + (f.count || 0); }, 0);
        return withCounts(questionBlocks(spec, '', figs.map(function (f) { return f.src; })), { count: count }, app);
      });
    }
    return figureSrc(spec).then(function (fig) { return withCounts(questionBlocks(spec, fig.src), fig, app); });
  }
  /* ➕ Add to page: the app as itself — its title and what it draws. */
  function paintAppPicture(app, spec) {
    return figureSrc(spec).then(function (fig) { return withCounts(appBlocks(app, spec && spec.graphics, fig.src), fig, app); });
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

  var api = { pure: pure, create: create, svgToPng: svgToPng, paintGraphics: paintGraphics, paintQuestionPicture: paintQuestionPicture, paintAppPicture: paintAppPicture };
  root.LivingQuestion = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
