/* =====================================================================
   ✏️ PRACTISE THE MISTAKES BEHIND AN OBJECTIVE (lo-practice.js)

   Byte for byte the same file in Study Buddy (polymathlc/tutor) and Ans
   Key (polymathlc/anskey). It is the window that opens when a learning
   objective, a topic or a worksheet is tapped in a diagnostic table:

     · every mistake filed under that row, from the student's mistake book
       (Study Buddy) or its roster mirror (Ans Key);
     · each one turned into a FRESH practice question on the same skill —
       new numbers, new story, the same steps — with its answer key and a
       full worked solution, in the shape the maths app's ⚡ Rapid add
       produces (question · options · answer · working);
     · NO ALGEBRA in any working. Primary-school methods only (model
       drawing, units and parts, the unitary method, before-and-after,
       working backwards, listing). A reply that slips into "let x be" is
       asked again once (`looksAlgebraic`);
     · the groups ordered weakest first, most marks lost, most mistakes,
       newest or in syllabus order;
     · printed — or saved as a PDF from the print dialog — as a practice
       sheet with the answer key and working on pages of their own.

   - THIS FILE NEVER TALKS TO A MODEL ITSELF. The host hands it `ask`
     (Study Buddy's and Ans Key's own model door, which already routes and
     rations), so the engines, the gate and the limits stay each app's.
   - ONE SUBJECT AT A TIME. A window is opened for one subject and every
     mistake of another subject is dropped at the door (`norm`), so a
     science slip can never turn up under a maths objective.
   - A practice question is kept on the device (localStorage, `lp1:` +
     a hash of the mistake) so opening the same row again costs nothing;
     🔄 asks for another one.
   - EVERYTHING IS textContent, and the print sheet is escaped: a mistake
     row was written on a child's device and a reply came from a model.

   🖼 v2 — THE QUESTION IS SHOWN THE WAY ⚡ RAPID ADD STORES IT
   ---------------------------------------------------------------------
   The Science portal's ⚡ Rapid add (polymathlc/cer) files a question as
   ORDERED BLOCKS — the wording as text, with an image block wherever a
   figure was printed, each figure cut out of the page — and the maths app
   (polymathlc/math) finds that figure, cuts it out, tidies the crop and
   redraws it as clean black line work (`autoDiagramIntoBlock`). Study
   Buddy's mistake book already keeps every mistake that way (`blocks`,
   tiers ① blocks ② whole-question crop ③ page), and v1 of this window threw
   all of it away and printed the transcription: a bar graph became a
   paragraph in square brackets. So now:

     · A mistake keeps its pictures (`blocks`, `figs`, `qimg`, `pimg`) and
       is drawn in its best tier (`tierOf`): the blocks in order, else the
       whole-question crop, else the wording with its figures, else the
       wording with the page it came from one tap away. A bracketed
       description of a figure is taken out of the wording whenever the
       figure itself is on screen (`stripFigureNotes`) — the question asked
       twice, once in a picture and once in words, is the thing this fixes.
     · A FRESH PRACTICE QUESTION KEEPS THE FIGURE. The figures are handed to
       the model (`images`, downscaled through a canvas — never a network
       call of this file's own) and it writes a NEW question asked of the
       SAME figure, putting [[FIG 1]] where the figure goes. The reply comes
       back as blocks too (`cleanPractice` → `blocks`), the shape Rapid add
       saves: text, figure, text, options.
     · A MISTAKE FILED AS TEXT ONLY IS SET OUT AGAIN FIRST (`opts.rebuild`),
       when its wording plainly leans on a figure (`needsFigure`): the host
       re-reads it off its own clean page, cuts each figure out, tidies and
       redraws it — Study Buddy's `mbRedoOne`, the maths app's ladder — and
       the practice question is then written around the cut figure. At
       most `REBUILD_MAX` a window, one at a time; Ans Key passes no
       rebuild (a teacher's device never writes a student's pictures).
     · 👆 `preview()` is the hover card the objective table opens over a
       coloured cell: the question(s) behind that cell, drawn the same way,
       with somewhere to TRY it — the options to tap, or a box to type in —
       checked against the key (`answerMatches`), and the answer one tap
       away.
     · Pictures are resolved by the host (`opts.picUrl`: a Storage path →
       a link) and only https:, data:image/ and blob: links, or a plain
       storage path, are ever put into an <img> (`picSrc`).
   ===================================================================== */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.LoPractice = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
  'use strict';

  var VERSION = 2;
  var AUTO_MAX = 12;          // written by themselves on open; the rest wait for "Make the rest"
  var WORKERS = 2;            // asked side by side — the host's gate spaces them further
  /* lp2: (v2) — a practice question now carries the figure it is asked about
     (`blocks`), so every lp1: question, written to be read with NO picture,
     is written again rather than shown beside a figure it describes in
     brackets. The old keys are simply never read again and age out. */
  var CACHE_PREFIX = 'lp2:';
  var REBUILD_MAX = 6;        // ✂️ text-only mistakes set out again (figure cut + cleaned) per window
  var FIG_MAX = 4;            // figures handed to the model with one mistake
  var FIG_SIDE = 1100;        // …downscaled to this, the way the host's own page reads are
  var BLOCKS_MAX = 16;        // blocks kept from one question
  var CACHE_MAX = 400;        // practice questions kept on one device
  var Q_MAX = 1600, A_MAX = 300, STEP_MAX = 320, STEPS_MAX = 14, OPT_MAX = 6;

  var SORTS = [
    ['weak', 'Weakest first'],
    ['lost', 'Most marks lost'],
    ['count', 'Most mistakes'],
    ['recent', 'Newest mistakes'],
    ['syllabus', 'Syllabus order']
  ];

  /* ---------------------------------------------------------------- */
  /* PURE HELPERS                                                       */
  /* ---------------------------------------------------------------- */
  function str(v, cap) {
    var s = v == null ? '' : String(v);
    s = s.replace(/\s+$/g, '').replace(/^\s+/g, '');
    return cap && s.length > cap ? s.slice(0, cap) : s;
  }
  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }
  function fmt(n) {
    var x = Math.round(num(n) * 100) / 100;
    var whole = Math.floor(x);
    if (Math.abs(x - whole - 0.5) < 1e-9) return (whole ? String(whole) : '') + '½';
    return String(x);
  }
  function pct(got, att) {
    return att > 0 ? Math.round((got / att) * 100) : null;
  }
  function band(p) {
    if (p === null || p === undefined) return 'none';
    if (p >= 80) return 'hi';
    if (p >= 50) return 'mid';
    return 'lo';
  }
  function hash(s) {
    var h = 5381;
    s = String(s || '');
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function lowerId(v) { return str(v, 60).toLowerCase(); }
  function topicWord(v) {
    return str(v, 120).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function stamp(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch (e) { return 0; } }
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    var t = Date.parse(v);
    return isFinite(t) ? t : 0;
  }
  function subjectWord(sub) {
    var s = String(sub || '').toLowerCase();
    if (s === 'math' || s === 'maths' || s === 'mathematics') return 'Maths';
    if (s === 'science') return 'Science';
    if (s === 'english') return 'English';
    if (s === 'chinese') return 'Chinese';
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }
  function isMath(sub) {
    var s = String(sub || '').toLowerCase();
    return s === 'math' || s === 'maths' || s === 'mathematics';
  }

  /* ---- 🖼 A PICTURE'S SOURCE, and the only kinds ever drawn ----
     A link this family minted (https:), a picture made on this device
     (data:image/, blob:) or a Storage PATH for the host to resolve. Every
     other scheme — javascript:, http:, anything — is dropped: a mistake row
     is a place another app's later version could write to, and what comes
     out of here goes into an <img src>. */
  function picSrc(v) {
    var s = v == null ? '' : String(v).trim();
    if (!s || s.length > 2000000) return '';
    if (/^https:\/\//i.test(s)) return s.slice(0, 1200);
    if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(s)) return s;
    if (/^blob:/i.test(s)) return s.slice(0, 300);
    if (/^[a-z][a-z0-9+.\-]*:/i.test(s)) return '';
    return /^[\w\-.\/ ]{1,300}$/.test(s) && s.indexOf('..') < 0 ? s : '';
  }
  /* One picture as { src, alt }: `alt` is the second source to try when the
     first will not load (the path's link that was minted when it was filed). */
  function pic(src, alt) {
    var a = picSrc(src), b = picSrc(alt);
    if (!a && !b) return null;
    return { src: a || b, alt: a && b && a !== b ? b : '' };
  }

  /* ---- A FIGURE WRITTEN OUT IN WORDS ----
     The marking transcribes a figure it cannot type as a description in
     square brackets — "[The bar graph is titled … Walk: 80, By car: 72 …]".
     Useful to the model, which cannot always see the page; wrong on screen
     the moment the figure itself is drawn, because the question is then
     asked twice. Only a bracket that is long and names a figure goes; a
     short "[2 marks]" or "[3]" is the paper's own and stays. */
  var FIG_WORDS = /\b(?:graph|chart|diagram|figure|picture|illustration|drawing|image|table|axis|axes|labell?ed|shaded|shown|grid|scale|number line|pictogram|tally|clock|ruler|protractor|bars?|line plot|pie|shape|net|tiles?|squares? (?:grid|paper)|dot(?:ted)? paper|unshaded|vertical|horizontal)\b/i;
  function stripFigureNotes(text) {
    var t = String(text == null ? '' : text);
    var out = t.replace(/\s*\[([^\[\]]{12,})\]\s*/g, function (all, inner) {
      return FIG_WORDS.test(inner) ? ' ' : all;
    });
    out = out.replace(/\s*\(\s*(?:see|refer to) (?:the )?(?:figure|diagram|graph|picture|table)[^)]{0,40}\)\s*/gi, ' ');
    return out.replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  /* Does the wording lean on a picture it does not have? A bracketed
     description is the sure sign; "the graph", "shown below" and the like
     are the other. A question that is only words needs no rebuild. */
  function needsFigure(m) {
    var q = String((m && m.q) || '');
    if (!q) return false;
    var br = q.match(/\[([^\[\]]{12,})\]/g) || [];
    if (br.some(function (b) { return FIG_WORDS.test(b); })) return true;
    return /\b(?:the|this|each|following) (?:bar |line |pie )?(?:graph|chart|diagram|figure|picture|table|pictogram|grid|number line|shapes?|net|clock|ruler|protractor)\b|\bshown (?:below|above|here)\b|\bin the (?:figure|diagram|picture)\b/i.test(q);
  }

  /* ---- A MISTAKE, from either app, in ONE shape ----
     Study Buddy's mistake book entry (`fileMistakes`) and Ans Key's roster
     mirror row (`mistakeMirrorRow`) carry the same facts under different
     names. Both become:
       { key, id, q, n, ws, ans, mine, v, mk, lo, topic, tkey, sub, at, mcq, opts, expl, done,
         blocks: [{ t: 'text', text } | { t: 'img', pic, role }],   ① the question set out again
         figs:   [pic],                                              its figures, in order
         qimg:   pic | null,                                         ② the whole question, cropped
         pimg:   pic | null,                                         ③ the page it was on
         popts:  true when the options ARE a picture }
     A `pic` is { src, alt } (see `pic`). */
  function fromMistake(m) {
    if (!m || typeof m !== 'object') return null;
    var q = str(m.question, Q_MAX);
    var blocks = [], figs = [], popts = false;
    var urls = Array.isArray(m.figUrls) ? m.figUrls : [];
    var fi = 0;
    (Array.isArray(m.blocks) ? m.blocks : []).slice(0, BLOCKS_MAX).forEach(function (b) {
      if (!b || typeof b !== 'object') return;
      if (b.type === 'text') {
        var tx = str(b.text, 900);
        if (tx) blocks.push({ t: 'text', text: tx });
      } else if (b.type === 'image') {
        /* `figUrls` is minted over the image blocks IN ORDER, so the n-th
           link is the n-th picture's — the second source to try. */
        var pc = pic(b.path || b.url || b.src, urls[fi]);
        fi++;
        if (!pc) return;
        var role = b.role === 'options' ? 'options' : '';
        if (role) popts = true;
        blocks.push({ t: 'img', pic: pc, role: role });
        if (!role) figs.push(pc);
      }
    });
    if (!blocks.some(function (b) { return b.t === 'img'; }) && !blocks.some(function (b) { return b.t === 'text'; })) blocks = [];
    if (!q && blocks.length) {
      q = blocks.filter(function (b) { return b.t === 'text'; })
        .map(function (b) { return b.text; }).join('\n').slice(0, Q_MAX);
    }
    if (!figs.length && !blocks.length) {
      urls.slice(0, FIG_MAX).forEach(function (u) { var pc = pic(u); if (pc) figs.push(pc); });
    }
    var whole = pic(m.imagePath, m.imageUrl);
    var shot = str(m.shot, 10);
    var opts = Array.isArray(m.options) ? m.options.slice(0, 8).map(function (o) {
      return { label: str(o && o.label, 4), text: str(o && o.text, 240) };
    }).filter(function (o) { return o.text || o.label; }) : [];
    return {
      key: str(m.key || m.id, 120) || hash(q + '|' + m.number + '|' + m.docName),
      id: str(m.id, 80),
      docId: str(m.docId, 80),
      q: q,
      n: str(m.number, 16),
      ws: str(m.docName, 80),
      ans: str(m.answer, A_MAX),
      mine: str(m.studentAnswer, A_MAX),
      v: m.skipped ? 'skipped' : str(m.verdict, 12),
      mk: str(m.marks, 12),
      lo: str(m.lo, 40),
      topic: str(m.topic, 80),
      tkey: str(m.sylTopic, 80),
      sub: str(m.subject, 16).toLowerCase(),
      at: stamp(m.createdAt) || num(m.at),
      mcq: m.type === 'mcq' || opts.length > 1,
      opts: opts,
      expl: str(m.explanation, 600),
      done: !!m.cleared,
      blocks: blocks,
      figs: figs,
      qimg: whole && shot === 'question' ? whole : null,
      pimg: whole && shot !== 'question' ? whole : null,
      popts: popts
    };
  }
  /* The roster mirror carries LINKS, never paths (`img`, `figs`) and `sh`,
     which of the three tiers `img` is. It has no block order, so its
     figures are drawn after the wording. */
  function fromMirror(r) {
    if (!r || typeof r !== 'object') return null;
    var q = str(r.q, Q_MAX);
    var figs = (Array.isArray(r.figs) ? r.figs : []).slice(0, FIG_MAX)
      .map(function (u) { return /^https:\/\//i.test(String(u || '')) ? pic(u) : null; }).filter(Boolean);
    var img = /^https:\/\//i.test(String(r.img || '')) ? pic(r.img) : null;
    var sh = str(r.sh, 10);
    return {
      key: str(r.id, 120) || hash(q + '|' + r.n + '|' + r.doc),
      id: str(r.id, 80),
      docId: '',
      q: q,
      n: str(r.n, 16),
      ws: str(r.doc, 80),
      ans: str(r.ans, A_MAX),
      mine: str(r.mine, A_MAX),
      v: str(r.v, 12),
      mk: str(r.mk, 12),
      lo: str(r.lo, 40),
      topic: str(r.top, 80),
      tkey: '',
      sub: str(r.sub, 16).toLowerCase(),
      at: num(r.at),
      mcq: false,
      opts: [],
      expl: '',
      done: !!r.done,
      blocks: [],
      figs: figs,
      qimg: img && sh === 'question' ? img : null,
      pimg: img && sh !== 'question' ? img : null,
      popts: false
    };
  }

  /* ---- WHICH PICTURE TIER a mistake is drawn in, best first ----
     'blocks' ① · 'question' ② · 'figs' (the mirror's figures under the
     wording) · 'page' ③ · 'text'. */
  function tierOf(m) {
    if (!m) return 'text';
    if (m.blocks && m.blocks.some(function (b) { return b.t === 'img'; })) return 'blocks';
    if (m.qimg) return 'question';
    if (m.blocks && m.blocks.length && !m.pimg) return 'blocks';
    if (m.figs && m.figs.length) return 'figs';
    if (m.pimg) return 'page';
    return 'text';
  }
  /* A text-only (or whole-page) mistake whose wording leans on a figure is
     worth setting out again; one with its figures already cut is not. */
  function wantsRebuild(m) {
    if (!m || (m.figs && m.figs.length) || m.qimg) return false;
    if (m.blocks && m.blocks.some(function (b) { return b.t === 'img'; })) return false;
    return needsFigure(m);
  }

  /* ---- WHICH MISTAKES BELONG TO A ROW ----
     sel: { sub, los: [objective ids], tkeys: [topic keys], topics: [topic names], docId, ws: worksheet name }
     An objective id wins: a mistake filed under P5.FR.2.6 belongs to that
     objective's row and to its topic's row. A topic key or a topic NAME is
     only asked when the mistake carries no objective — the marking could
     only place it as far as a topic — so a mistake is never counted under
     two different objectives. */
  function matches(m, sel) {
    if (!m || !sel) return false;
    if (sel.sub && m.sub && !sameSubject(m.sub, sel.sub)) return false;
    if (sel.docId && m.docId) { if (m.docId !== sel.docId) return false; }
    else if (sel.ws && m.ws !== sel.ws) return false;
    var los = (sel.los || []).map(lowerId);
    var tkeys = (sel.tkeys || []).map(function (t) { return str(t, 80); });
    var topics = (sel.topics || []).map(topicWord).filter(Boolean);
    if (!los.length && !tkeys.length && !topics.length) return true;
    if (m.lo) return los.indexOf(lowerId(m.lo)) >= 0;
    if (m.tkey && tkeys.indexOf(m.tkey) >= 0) return true;
    return !!m.topic && topics.indexOf(topicWord(m.topic)) >= 0;
  }
  function sameSubject(a, b) {
    if (isMath(a) && isMath(b)) return true;
    return String(a || '').toLowerCase() === String(b || '').toLowerCase();
  }
  /* The list of mistakes a window may show: normalised, of ONE subject,
     not yet sorted by the student, and one per question (a re-mark that
     filed the same question twice shows it once). */
  function norm(list, sub, from) {
    var out = [], seen = {};
    (list || []).forEach(function (raw) {
      var m = from === 'mirror' ? fromMirror(raw) : (raw && raw.key && 'q' in raw && 'tkey' in raw ? raw : fromMistake(raw));
      if (!m) return;
      if (sub && m.sub && !sameSubject(m.sub, sub)) return;
      if (!m.q && !m.n) return;
      var k = (m.ws + '|' + m.n + '|' + m.q.slice(0, 80)).toLowerCase();
      if (seen[k]) return;
      seen[k] = 1;
      out.push(m);
    });
    return out;
  }

  /* ---- ORDERING THE GROUPS ---- */
  function lostOf(g) {
    var tot = num(g.tot), att = num(g.att), got = num(g.got);
    return Math.max(0, (tot > att ? tot : att) - got);
  }
  function newestOf(g) {
    return (g.mistakes || []).reduce(function (t, m) { return Math.max(t, m.at || 0); }, 0);
  }
  function sortGroups(groups, how) {
    var list = (groups || []).slice();
    var byOrder = function (a, b) { return (num(a.order) - num(b.order)) || String(a.title || '').localeCompare(String(b.title || '')); };
    var p = function (g) { var x = g.pct; return x === null || x === undefined ? 1e9 : x; };
    if (how === 'syllabus') return list.sort(byOrder);
    if (how === 'lost') return list.sort(function (a, b) { return (lostOf(b) - lostOf(a)) || (p(a) - p(b)) || byOrder(a, b); });
    if (how === 'count') return list.sort(function (a, b) { return ((b.mistakes || []).length - (a.mistakes || []).length) || (p(a) - p(b)) || byOrder(a, b); });
    if (how === 'recent') return list.sort(function (a, b) { return (newestOf(b) - newestOf(a)) || byOrder(a, b); });
    return list.sort(function (a, b) { return (p(a) - p(b)) || (lostOf(b) - lostOf(a)) || byOrder(a, b); });
  }

  /* ---- THE ASK ----
     The same fields ⚡ Rapid add files a question under (question text,
     options, the correct one, the answer, the worked solution), asked for
     a NEW question on the skill the mistake tested. */
  var SYSTEM = 'You write practice questions for Singapore primary-school pupils, following the MOE syllabus. ' +
    'You reply with ONE JSON object and nothing else — no markdown fences, no notes.';

  function practicePrompt(m, ctx, strict) {
    ctx = ctx || {};
    var math = isMath(ctx.sub || m.sub);
    var lines = [];
    lines.push('A pupil got this ' + (subjectWord(ctx.sub || m.sub) || '') + ' question wrong. Write ONE NEW practice question ' +
      'that tests exactly the same skill, so they can practise it again.');
    if (ctx.level) lines.push('Level: ' + ctx.level + '. Keep to what a ' + ctx.level + ' pupil has been taught.');
    if (ctx.objective) lines.push('Learning objective: ' + ctx.objective + (ctx.topic ? ' (topic: ' + ctx.topic + ')' : '') + '.');
    else if (ctx.topic || m.topic) lines.push('Topic: ' + (ctx.topic || m.topic) + '.');
    lines.push('');
    lines.push('THE ORIGINAL QUESTION' + (m.n ? ' (Q' + m.n + (m.ws ? ' of "' + m.ws + '"' : '') + ')' : '') + ':');
    lines.push(m.q || '(only the question number was kept)');
    if (m.opts && m.opts.length) {
      lines.push('Its options: ' + m.opts.map(function (o, i) { return '(' + (o.label || (i + 1)) + ') ' + o.text; }).join('  '));
    }
    if (m.ans) lines.push('Correct answer: ' + m.ans);
    if (m.mine) lines.push('What the pupil wrote: ' + m.mine);
    else if (m.v === 'skipped') lines.push('The pupil left it blank.');
    if (m.expl) lines.push('How it was marked: ' + m.expl);
    lines.push('');
    lines.push('RULES:');
    lines.push('- Same skill, same difficulty and the same number of steps as the original. Change the numbers, names, objects and story so it is not a copy.');
    var nf = Math.min(num(ctx.figs), FIG_MAX);
    if (nf > 0) {
      var marks = [];
      for (var f = 1; f <= nf; f++) marks.push('[[FIG ' + f + ']]');
      lines.push('- THE FIGURE: ' + (nf === 1 ? 'the original question\'s figure' : 'the original question\'s ' + nf + ' figures') +
        ' will be printed with YOUR question exactly as ' + (nf === 1 ? 'it is' : 'they are') +
        (ctx.seen ? ' (' + (nf === 1 ? 'it is' : 'they are') + ' attached, in order)' : ' (the original wording above describes ' + (nf === 1 ? 'it' : 'them') + ')') +
        ' — cut from the paper and redrawn clean, and it cannot be changed. Write ' + marks.join(', ') +
        ' on a line of ' + (nf === 1 ? 'its' : 'their') + ' own where ' + (nf === 1 ? 'it belongs' : 'each belongs') +
        ' in your question, the way a printed paper sets a figure between the opening sentence and the ask.');
      lines.push('- Ask something DIFFERENT that is answered from the SAME figure with the same skill — another pair of bars, another part of the shape, ' +
        'another reading off the scale, a different step of the same method. Every number you use must really be in the figure.');
      lines.push('- NEVER describe the figure in words, and never put a description of it in square brackets: the pupil is looking at it.');
    } else {
      lines.push('- It must make complete sense with NO picture. If the original relies on a figure, give every length, angle, scale or shaded part it needs in plain sentences of the question, or pick a version of the skill that needs no figure. Never put a description of a figure in square brackets.');
    }
    lines.push('- If the original is multiple-choice, give exactly 4 options and say which one is correct. Otherwise give an empty options list.');
    if (math) {
      lines.push('- Choose numbers that work out cleanly at this level, and work the answer out twice before you reply.');
      lines.push('- WORKING: primary-school methods ONLY — model drawing with units and parts, the unitary method, before-and-after, working backwards, ' +
        'listing or a table, guess and check, ratio as units, "fraction of the remainder". ' +
        'NEVER use algebra: no letters standing for unknowns (no x, y, n, a), no "let … be", no equation with an unknown to solve, no simultaneous equations.');
      lines.push('- Write each working step as ONE short line of words and arithmetic, the way a Singapore teacher writes it on the board, e.g. ' +
        '"5 units = 40", "1 unit = 40 ÷ 5 = 8", "Ali had 3 units = 3 × 8 = 24 stickers". Use × and ÷, never * or /.');
      if (strict) {
        lines.push('- YOUR LAST REPLY USED ALGEBRA. Do it again with units and parts or the unitary method — not one letter may stand for a number.');
      }
    } else {
      lines.push('- WORKING: the 2 to 5 key points a full-mark answer must make, each one short line, in the words a pupil would write.');
    }
    lines.push('');
    lines.push('Return ONLY this JSON:');
    lines.push('{"question":"<the full new question' + (nf > 0 ? ', with [[FIG 1]] where the figure goes' : '') + '>","options":["<option 1>","<option 2>","<option 3>","<option 4>"] or [],' +
      '"correctOption":<0-based index of the correct option, or -1>,"answer":"<the final answer, with units>",' +
      '"working":["<step 1>","<step 2>","…"],"method":"<' + (math ? 'the method, e.g. Model drawing, Unitary method, Working backwards' : 'the idea it tests') + '>"}');
    return lines.join('\n');
  }

  /* ---- IS THIS WORKING ALGEBRA? ----
     Not "does a letter appear": a Singapore working is full of letters —
     "1 u = 8", "5 m = 500 cm", "3 x 4" for times. What gives algebra away
     is a letter STANDING FOR A NUMBER: "let x be", "3x", "x = 12",
     "2n + 5", or the words that go with it. */
  function looksAlgebraic(text) {
    var t = String(text || '');
    if (!t) return false;
    if (/\blet\s+[a-z]\s*(?:be|=|represent|stand)/i.test(t)) return true;
    if (/\b(?:simultaneous|solve for|substitut\w*|unknown variable|the variable)\b/i.test(t)) return true;
    if (/\b\d+\s?[xyzn]\b(?!\s*\d)/.test(t)) return true;          // 3x, 5n — but not "3 x 4"
    if (/(?:^|[\s(=+\-])[xyzn]\s*(?:=|\+|-|−)\s*[\dxyzn(]/.test(t)) return true;  // x = 12, n + 5
    if (/[=+\-−]\s*[xyzn]\b(?!\s*\d)(?![a-z])/.test(t) && /[xyzn]\s*=/.test(t)) return true;
    if (/\b[a-z]\s*\^\s*2\b|\b[a-z]²/.test(t)) return true;
    return false;
  }

  /* ---- A PRACTICE QUESTION AS BLOCKS, the shape ⚡ Rapid add saves ----
     The wording is cut at every [[FIG n]] the model put in, and the figure
     goes there: [{ t: 'text', text }, { t: 'fig', i }, …], `i` the index
     into the mistake's own `figs`. A reply that was handed a figure and
     placed none still gets it — between the opening and the ask, the way a
     paper prints one — unless it said `"figure": false`. Square-bracket
     descriptions come out of every text block whenever a figure is in. */
  var FIG_MARK = /\[\[\s*(?:FIG(?:URE)?)\s*(\d{1,2})\s*\]\]/gi;
  function practiceBlocks(question, nFigs, wantFig) {
    var q = String(question || '');
    var out = [], used = {}, last = 0, mm;
    FIG_MARK.lastIndex = 0;
    while ((mm = FIG_MARK.exec(q))) {
      var before = q.slice(last, mm.index);
      if (before.trim()) out.push({ t: 'text', text: before.trim() });
      var i = Math.round(num(mm[1])) - 1;
      if (i >= 0 && i < nFigs && !used[i]) { out.push({ t: 'fig', i: i }); used[i] = 1; }
      last = mm.index + mm[0].length;
    }
    var tail = q.slice(last);
    if (tail.trim()) out.push({ t: 'text', text: tail.trim() });
    var anyFig = out.some(function (b) { return b.t === 'fig'; });
    if (!anyFig && nFigs > 0 && wantFig !== false && out.length) {
      /* No marker: the figure goes before the ASK — the last sentence that
         ends in "?" — or, failing that, after the opening paragraph. */
      var t = stripFigureNotes(out.map(function (b) { return b.text; }).join('\n'));
      var ask = /^([\s\S]*?[.!:])\s+([^.!?:\n][^\n]*\?)\s*$/.exec(t);
      var paras = t.split(/\n\s*\n|\n/);
      out = [];
      if (ask && ask[1].trim()) { out.push({ t: 'text', text: ask[1].trim() }); }
      else if (paras.length > 1) { out.push({ t: 'text', text: paras[0].trim() }); }
      for (var f = 0; f < nFigs; f++) out.push({ t: 'fig', i: f });
      if (ask && ask[1].trim()) out.push({ t: 'text', text: ask[2].trim() });
      else if (paras.length > 1) out.push({ t: 'text', text: paras.slice(1).join('\n').trim() });
      else out.push({ t: 'text', text: t.trim() });
      anyFig = true;
    }
    if (anyFig) {
      out = out.map(function (b) { return b.t === 'text' ? { t: 'text', text: stripFigureNotes(b.text) } : b; })
        .filter(function (b) { return b.t !== 'text' || b.text; });
    }
    return out;
  }
  function cleanPractice(o, nFigs) {
    nFigs = Math.max(0, Math.min(Math.round(num(nFigs)), FIG_MAX));
    if (!o || typeof o !== 'object') return null;
    if (Array.isArray(o)) o = o[0];
    if (o && o.questions && Array.isArray(o.questions)) o = o.questions[0];
    if (!o || typeof o !== 'object') return null;
    var question = str(o.question || o.questionText, Q_MAX);
    if (!question && Array.isArray(o.blocks)) {
      question = o.blocks.map(function (b) {
        if (!b) return '';
        if (b.type === 'image') return '[[FIG ' + (Math.round(num(b.fig || b.index)) || 1) + ']]';
        return str(b.text || b.content, 900);
      }).filter(Boolean).join('\n').slice(0, Q_MAX);
    }
    if (!question) return null;
    var blocks = practiceBlocks(question, nFigs, o.figure);
    var figCount = blocks.filter(function (b) { return b.t === 'fig'; }).length;
    var plain = blocks.filter(function (b) { return b.t === 'text'; }).map(function (b) { return b.text; }).join('\n');
    if (!plain) return null;
    question = figCount ? plain : question.replace(FIG_MARK, '').trim();
    var options = Array.isArray(o.options) ? o.options.map(function (x) {
      return str(x && typeof x === 'object' ? (x.text || x.label) : x, 240);
    }).filter(Boolean).slice(0, OPT_MAX) : [];
    var correct = Math.round(num(o.correctOption));
    if (!options.length || correct < 0 || correct >= options.length) correct = -1;
    if (options.length < 2) { options = []; correct = -1; }
    var working = o.working;
    if (typeof working === 'string') working = working.split(/\n+/);
    if (!Array.isArray(working)) working = [];
    working = working.map(function (s) {
      return str(s, STEP_MAX).replace(/^\s*(?:step\s*\d+\s*[:.)-]|\d+\s*[.)])\s*/i, '');
    }).filter(Boolean).slice(0, STEPS_MAX);
    if (!working.length && o.markingGuide) {
      working = String(o.markingGuide).split(/\n+/).map(function (s) { return str(s, STEP_MAX); }).filter(Boolean).slice(0, STEPS_MAX);
    }
    var answer = str(o.answer || o.expected, A_MAX);
    if (!answer && correct >= 0) answer = options[correct];
    if (!answer) return null;
    return {
      v: VERSION,
      question: question,
      blocks: figCount ? blocks : [],
      figs: figCount,
      options: options,
      correct: correct,
      answer: answer,
      working: working,
      method: str(o.method, 60),
      algebra: looksAlgebraic(working.join('\n') + '\n' + answer)
    };
  }

  function cacheKey(m) {
    return CACHE_PREFIX + hash([m.sub, m.ws, m.n, m.q.slice(0, 400), m.ans, (m.figs || []).length].join('|'));
  }
  function store(opts) {
    if (opts && opts.storage !== undefined) return opts.storage;
    try { return root && root.localStorage ? root.localStorage : null; } catch (e) { return null; }
  }
  function cacheGet(st, m) {
    if (!st) return null;
    try {
      var raw = st.getItem(cacheKey(m));
      if (!raw) return null;
      var o = JSON.parse(raw);
      return o && o.p && o.p.question ? o.p : null;
    } catch (e) { return null; }
  }
  function cachePut(st, m, p) {
    if (!st) return;
    try {
      st.setItem(cacheKey(m), JSON.stringify({ at: Date.now(), p: p }));
      cachePrune(st);
    } catch (e) { /* full or blocked — the question still shows */ }
  }
  function cachePrune(st) {
    try {
      var keys = [];
      for (var i = 0; i < st.length; i++) {
        var k = st.key(i);
        if (k && k.indexOf(CACHE_PREFIX) === 0) keys.push(k);
      }
      if (keys.length <= CACHE_MAX) return;
      var aged = keys.map(function (k) {
        var at = 0;
        try { at = (JSON.parse(st.getItem(k)) || {}).at || 0; } catch (e) { at = 0; }
        return { k: k, at: at };
      }).sort(function (a, b) { return a.at - b.at; });
      aged.slice(0, keys.length - CACHE_MAX).forEach(function (x) { st.removeItem(x.k); });
    } catch (e) { /* nothing to tidy */ }
  }

  /* Asks the host's model for one practice question, and once more if the
     working came back as algebra or did not parse. Resolves to a clean
     practice question, or throws with a sentence a student can read. */
  async function makePractice(m, ctx, ask, parse) {
    if (typeof ask !== 'function') throw new Error('No AI is set up on this device.');
    var tries = 0, last = null, strict = false;
    while (tries < 2) {
      tries++;
      var askOpts = {
        system: SYSTEM, json: true, maxOutputTokens: 1800, thinkingLevel: 'low',
        timeoutMs: 70000, routeTimeoutMs: 35000, keepOnTimeout: true, lane: 'bg'
      };
      /* 🖼 The figures ride along as pictures when the host could read
         them; the model then writes around what is really printed. */
      if (ctx.images && ctx.images.length) askOpts.images = ctx.images.slice(0, FIG_MAX);
      var raw = await ask(practicePrompt(m, ctx, strict), askOpts);
      var obj = null;
      try { obj = typeof parse === 'function' ? parse(raw) : JSON.parse(String(raw || '')); } catch (e) { obj = null; }
      var p = cleanPractice(obj, ctx.figs);
      if (p && !(isMath(ctx.sub || m.sub) && p.algebra)) return p;
      if (p) { last = p; strict = true; }
    }
    if (last) return last;
    throw new Error('The question did not come back in a shape that could be read. Tap 🔄 to try again.');
  }

  /* ---------------------------------------------------------------- */
  /* THE PRINTED SHEET                                                  */
  /* ---------------------------------------------------------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nl(s) { return esc(s).replace(/\n/g, '<br>'); }
  var LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

  /* A picture on the printed sheet. `picFn(pic)` is the sheet's resolver —
     the links the window has already fetched — and a picture it cannot
     name is left off rather than printed as a broken frame. The link is
     re-checked here because this is markup, not a DOM attribute. */
  function imgHtml(pc, picFn, cls) {
    var u = pc && typeof picFn === 'function' ? picFn(pc) : '';
    if (!u || !/^(?:https:\/\/|data:image\/|blob:)/i.test(u)) return '';
    return '<div class="' + (cls || 'lpSheetFig') + '"><img src="' + esc(u) + '" alt=""></div>';
  }
  /* The ORIGINAL question as printed: its best tier (see `tierOf`). */
  function questionHtml(m, picFn) {
    var h = [], tier = tierOf(m), drew = false;
    if (tier === 'blocks') {
      var hasImg = m.blocks.some(function (b) { return b.t === 'img'; });
      m.blocks.forEach(function (b) {
        if (b.t === 'text') h.push('<div>' + nl(hasImg ? stripFigureNotes(b.text) : b.text) + '</div>');
        else { var x = imgHtml(b.pic, picFn); if (x) { h.push(x); drew = true; } }
      });
      if (!drew && hasImg) { h = []; tier = 'text'; }
    }
    if (tier === 'question') {
      var qx = imgHtml(m.qimg, picFn, 'lpSheetFig lpSheetWhole');
      if (qx) { h.push(qx); drew = true; } else tier = 'text';
    }
    if (tier === 'figs') {
      var figsH = m.figs.map(function (f) { return imgHtml(f, picFn); }).filter(Boolean);
      h.push('<div>' + nl(figsH.length ? stripFigureNotes(m.q) : m.q) + '</div>');
      h = h.concat(figsH);
      drew = figsH.length > 0;
    }
    if (tier === 'page' || tier === 'text') {
      h.push('<div>' + nl(m.q || ('Q' + m.n)) + '</div>');
    }
    var showOpts = m.opts && m.opts.length && tier !== 'question' && !m.popts;
    if (showOpts) {
      h.push('<ol class="lpSheetOpts">' + m.opts.map(function (o, i) {
        return '<li>(' + esc(o.label || (i + 1)) + ') ' + esc(o.text) + '</li>';
      }).join('') + '</ol>');
    }
    return h.join('');
  }
  /* A PRACTICE question: its blocks (text and the mistake's own figures). */
  function practiceHtml(p, m, picFn) {
    var h = [];
    if (p.blocks && p.blocks.length) {
      var drew = 0;
      p.blocks.forEach(function (b) {
        if (b.t === 'text') h.push('<div>' + nl(b.text) + '</div>');
        else { var x = imgHtml((m.figs || [])[b.i], picFn); if (x) { h.push(x); drew++; } }
      });
      if (!drew) h = ['<div>' + nl(p.question) + '</div>'];
    } else {
      h.push('<div>' + nl(p.question) + '</div>');
    }
    if (p.options.length) {
      h.push('<ol class="lpSheetOpts">' + p.options.map(function (o, i) {
        return '<li>(' + LETTERS[i] + ') ' + esc(o) + '</li>';
      }).join('') + '</ol>');
    }
    return h.join('');
  }

  /* sheet: { title, name, sub, when, summary: [groups], groups: [{ title, code, pct, items: [{ m, p }] }],
              withKey, withMistakes }. Returns the inner HTML of the print root. */
  function sheetHtml(sheet) {
    var h = [];
    var n = 0;
    h.push('<div class="lpSheetHead"><div class="lpSheetTitle">' + esc(sheet.title || 'Practice') + '</div>' +
      '<div class="lpSheetSub">' + esc([sheet.name, subjectWord(sheet.sub), sheet.when].filter(Boolean).join(' · ')) + '</div></div>');
    if (sheet.summary && sheet.summary.length) {
      h.push('<table class="lpSumTable"><thead><tr><th>Learning objective</th><th>Questions</th><th>Marks</th><th>%</th><th>Mistakes</th></tr></thead><tbody>');
      sheet.summary.forEach(function (g) {
        h.push('<tr class="lpB-' + band(g.pct) + '"><td>' + (g.code ? '<b>' + esc(g.code) + '</b> ' : '') + esc(g.title) +
          (g.topic && g.topic !== g.title ? '<div class="lpSumTopic">' + esc(g.topic) + '</div>' : '') +
          (g.qs ? '<div class="lpSumTopic">' + esc(g.qs) + '</div>' : '') + '</td>' +
          '<td>' + esc(g.q || '') + '</td>' +
          '<td>' + (num(g.att) > 0 ? esc(fmt(g.got) + '/' + fmt(g.att)) : (num(g.tot) > 0 ? 'blank/' + esc(fmt(g.tot)) : '–')) + '</td>' +
          '<td>' + (g.pct === null || g.pct === undefined ? '–' : esc(g.pct + '%')) + '</td>' +
          '<td>' + esc(String((g.mistakes || []).length)) + '</td></tr>');
      });
      h.push('</tbody></table>');
    }
    var any = sheet.groups.some(function (g) { return g.items.length; });
    if (any) {
      h.push('<div class="lpSheetH">Practice questions</div>');
      sheet.groups.forEach(function (g) {
        if (!g.items.length) return;
        h.push('<div class="lpSheetGroup">' + (g.code ? esc(g.code) + ' · ' : '') + esc(g.title) +
          (g.pct === null || g.pct === undefined ? '' : ' <span>(' + esc(g.pct) + '%)</span>') + '</div>');
        g.items.forEach(function (it) {
          n++;
          it.no = n;
          var p = it.p;
          h.push('<div class="lpSheetQ"><div class="lpSheetQn">' + n + '.</div><div class="lpSheetQb">');
          if (p) {
            h.push(practiceHtml(p, it.m, sheet.pic));
          } else {
            h.push(questionHtml(it.m, sheet.pic) + '<div class="lpSheetNote">The question from your paper' +
              (it.m.ws ? ', ' + esc(it.m.ws) + (it.m.n ? ' Q' + esc(it.m.n) : '') : '') + ' — a fresh one was not written yet.</div>');
          }
          h.push('<div class="lpSheetWork"></div><div class="lpSheetAns">Answer: ______________________</div></div></div>');
        });
      });
    } else {
      h.push('<p class="lpSheetNote">No mistakes are filed under these objectives — nothing to practise.</p>');
    }
    if (sheet.withMistakes && any) {
      h.push('<div class="lpSheetH lpBreak">My mistakes</div>');
      sheet.groups.forEach(function (g) {
        g.items.forEach(function (it) {
          var m = it.m;
          h.push('<div class="lpSheetMis"><b>' + esc(it.no) + '.</b> ' + esc(m.ws || '') + (m.n ? ' Q' + esc(m.n) : '') +
            (m.mk ? ' · ' + esc(m.mk) : '') + '<div class="lpSheetMisQ">' + questionHtml(m, sheet.pic) + '</div>' +
            '<div>My answer: ' + esc(m.mine || (m.v === 'skipped' ? '(left blank)' : '—')) + '</div>' +
            (m.ans ? '<div>Correct answer: ' + esc(m.ans) + '</div>' : '') + '</div>');
        });
      });
    }
    if (sheet.withKey && any) {
      h.push('<div class="lpSheetH lpBreak">Answer key and working</div>');
      sheet.groups.forEach(function (g) {
        g.items.forEach(function (it) {
          var p = it.p;
          h.push('<div class="lpSheetKey"><div class="lpSheetQn">' + esc(it.no) + '.</div><div class="lpSheetQb">');
          if (p) {
            h.push('<div class="lpSheetKeyAns">' + (p.correct >= 0 ? '(' + LETTERS[p.correct] + ') ' : '') + esc(p.answer) +
              (p.method ? ' <span>· ' + esc(p.method) + '</span>' : '') + '</div>');
            if (p.working.length) h.push('<ol class="lpSheetSteps">' + p.working.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>');
          } else {
            h.push('<div class="lpSheetKeyAns">' + esc(it.m.ans || '—') + '</div>');
          }
          h.push('</div></div>');
        });
      });
    }
    return h.join('');
  }

  var PRINT_CSS =
    '.lpPrintRoot{display:none}' +
    '@media print{' +
    'body.lpPrinting>*:not(.lpPrintRoot){display:none!important}' +
    'body.lpPrinting .lpPrintRoot{display:block!important;position:static}' +
    'html,body{background:#fff}' +
    '}';
  function ensurePrintCss(doc) {
    if (doc.getElementById('lpPrintCss')) return;
    var st = doc.createElement('style');
    st.id = 'lpPrintCss';
    st.textContent = PRINT_CSS;
    (doc.head || doc.body).appendChild(st);
  }
  /* Prints `html` and nothing else on the page. The page TITLE is the
     sheet's name for the length of the dialog, because that is the file
     name "Save as PDF" offers. */
  function printHtml(doc, html, fileTitle) {
    doc = doc || (root && root.document);
    if (!doc || !doc.body) return;
    ensurePrintCss(doc);
    var old = doc.querySelector('.lpPrintRoot');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var box = doc.createElement('div');
    box.className = 'lpPrintRoot printMe';
    box.innerHTML = html;
    doc.body.appendChild(box);
    var oldTitle = doc.title;
    if (fileTitle) doc.title = String(fileTitle).replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 120);
    doc.body.classList.add('lpPrinting');
    var done = false;
    var win = doc.defaultView || root;
    function finish() {
      if (done) return;
      done = true;
      doc.body.classList.remove('lpPrinting');
      doc.title = oldTitle;
      if (box.parentNode) box.parentNode.removeChild(box);
      if (win && win.removeEventListener) win.removeEventListener('afterprint', finish);
    }
    if (win && win.addEventListener) win.addEventListener('afterprint', finish);
    function go() {
      try { if (win && win.print) win.print(); } finally {
        setTimeout(finish, 1500);
      }
    }
    /* 🖼 THE FIGURES MUST BE THERE BEFORE THE DIALOG. A print started while
       a picture is still loading prints its empty frame, and a practice
       sheet whose bar graph is a blank box cannot be answered. Each picture
       gets a few seconds; one that will not load is taken off the page. */
    var imgs = box.querySelectorAll ? Array.prototype.slice.call(box.querySelectorAll('img')) : [];
    var pending = imgs.filter(function (im) { return !im.complete; });
    if (!pending.length) { go(); return; }
    var left = pending.length, fired = false;
    var one = function () { left--; if (left <= 0 && !fired) { fired = true; go(); } };
    pending.forEach(function (im) {
      im.addEventListener('load', one);
      im.addEventListener('error', function () {
        var f = im.parentNode;
        if (f && f.parentNode) f.parentNode.removeChild(f);
        one();
      });
    });
    setTimeout(function () { if (!fired) { fired = true; go(); } }, 6000);
  }

  /* ---------------------------------------------------------------- */
  /* THE WINDOW                                                         */
  /* ---------------------------------------------------------------- */
  var S = {
    doc: null, back: null, open: false, epoch: 0, opts: null, sort: 'weak',
    cards: {}, queue: [], running: 0, made: {}, failed: {}, focus: '',
    rebuilding: {}, rebuilt: {}, rebuildsLeft: REBUILD_MAX, rebuildChain: null
  };

  function mkIn(doc, tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function mk(tag, cls, text) { return mkIn(S.doc, tag, cls, text); }

  /* ---------------------------------------------------------------- */
  /* 🖼 PICTURES                                                        */
  /* ---------------------------------------------------------------- */
  /* Resolved links, kept for the life of the page: one Storage lookup per
     picture however many times a card is repainted, and what the print
     sheet reads synchronously (`picNow`). */
  var URLS = {};
  function direct(src) { return /^(?:https:\/\/|data:image\/|blob:)/i.test(String(src || '')); }
  function resolveSrc(src, picUrl) {
    if (!src) return Promise.resolve('');
    if (direct(src)) return Promise.resolve(src);
    if (URLS[src] && typeof URLS[src] === 'string') return Promise.resolve(URLS[src]);
    if (URLS[src] && URLS[src].then) return URLS[src];
    if (typeof picUrl !== 'function') return Promise.resolve('');
    var pr = Promise.resolve().then(function () { return picUrl(src); }).then(function (u) {
      u = direct(u) ? String(u) : '';
      URLS[src] = u;
      return u;
    }, function () { URLS[src] = ''; return ''; });
    URLS[src] = pr;
    return pr;
  }
  function picNow(pc) {
    if (!pc) return '';
    if (direct(pc.src)) return pc.src;
    var u = URLS[pc.src];
    if (typeof u === 'string' && u) return u;
    return pc.alt && direct(pc.alt) ? pc.alt : '';
  }
  /* Every picture a list of mistakes might print, resolved before the
     sheet is built — with a ceiling, so a slow bucket cannot hold the
     print dialog back for ever. */
  function resolveAll(list, picUrl, ms) {
    var all = [];
    (list || []).forEach(function (m) {
      if (!m) return;
      (m.blocks || []).forEach(function (b) { if (b.t === 'img') all.push(b.pic); });
      (m.figs || []).forEach(function (f) { all.push(f); });
      if (m.qimg) all.push(m.qimg);
    });
    var jobs = all.filter(Boolean).map(function (pc) { return resolveSrc(pc.src, picUrl); });
    return Promise.race([
      Promise.all(jobs),
      new Promise(function (r) { setTimeout(r, ms || 5000); })
    ]);
  }
  /* One picture on screen. It takes ITSELF off the card when neither source
     will load, so the wording around it still reads — a broken frame in
     the middle of a question is worse than no frame. */
  function picNode(doc, pc, picUrl, cls) {
    var box = mkIn(doc, 'div', cls || 'lpFig');
    if (!pc) return box;
    var img = mkIn(doc, 'img');
    img.alt = 'The figure from the paper';
    img.loading = 'lazy';
    img.decoding = 'async';
    var tried = 0;
    var gone = function () { if (box.parentNode) box.parentNode.removeChild(box); };
    var next = function () {
      var src = tried === 0 ? pc.src : pc.alt;
      tried++;
      if (!src) { gone(); return; }
      resolveSrc(src, picUrl).then(function (u) {
        if (!u) { if (tried < 2 && pc.alt) next(); else gone(); return; }
        img.src = u;
      });
    };
    if (img.addEventListener) img.addEventListener('error', function () { if (tried < 2 && pc.alt) next(); else gone(); });
    box.appendChild(img);
    next();
    return box;
  }
  /* A figure as base64 JPEG for the model — read through a canvas, the way
     the hosts already read a page. Null whenever it cannot be (no canvas,
     a tainted picture, a timeout): the question is then written from the
     wording, never not at all. */
  function imageData(doc, pc, picUrl) {
    return new Promise(function (resolve) {
      if (!pc || !doc || !doc.createElement) { resolve(null); return; }
      var settled = false;
      var done = function (v) { if (!settled) { settled = true; resolve(v); } };
      setTimeout(function () { done(null); }, 9000);
      resolveSrc(pc.src, picUrl).then(function (u) {
        u = u || (direct(pc.alt) ? pc.alt : '');
        if (!u) { done(null); return; }
        var Img = (doc.defaultView && doc.defaultView.Image) || (root && root.Image);
        if (!Img) { done(null); return; }
        var im = new Img();
        im.crossOrigin = 'anonymous';
        im.onload = function () {
          try {
            var w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
            if (!w || !h) { done(null); return; }
            var k = Math.min(1, FIG_SIDE / Math.max(w, h));
            var c = doc.createElement('canvas');
            c.width = Math.max(1, Math.round(w * k));
            c.height = Math.max(1, Math.round(h * k));
            var g = c.getContext('2d');
            if (!g) { done(null); return; }
            g.fillStyle = '#fff';            // a PNG's transparency would flatten to BLACK in a JPEG
            g.fillRect(0, 0, c.width, c.height);
            g.drawImage(im, 0, 0, c.width, c.height);
            var d = c.toDataURL('image/jpeg', 0.86);
            var at = d.indexOf(',');
            done(at > 0 ? { mimeType: 'image/jpeg', data: d.slice(at + 1) } : null);
          } catch (e) { done(null); }
        };
        im.onerror = function () { done(null); };
        im.src = u;
      }, function () { done(null); });
    });
  }

  /* ---- THE ORIGINAL QUESTION, drawn in its best tier ---- */
  function questionNode(doc, m, picUrl, noOpts) {
    var wrap = mkIn(doc, 'div', 'lpQ');
    var tier = tierOf(m);
    var text = function (t) { var d = mkIn(doc, 'div', 'lpQText', t); wrap.appendChild(d); };
    if (tier === 'blocks') {
      var hasImg = m.blocks.some(function (b) { return b.t === 'img'; });
      m.blocks.forEach(function (b) {
        if (b.t === 'text') text(hasImg ? stripFigureNotes(b.text) : b.text);
        else wrap.appendChild(picNode(doc, b.pic, picUrl, b.role === 'options' ? 'lpFig lpFigOpts' : 'lpFig'));
      });
    } else if (tier === 'question') {
      wrap.appendChild(picNode(doc, m.qimg, picUrl, 'lpFig lpFigWhole'));
      if (m.q) {
        var w = mkIn(doc, 'details', 'lpWords');
        w.appendChild(mkIn(doc, 'summary', null, 'The wording as it was read'));
        w.appendChild(mkIn(doc, 'div', 'lpQText', m.q));
        wrap.appendChild(w);
      }
    } else if (tier === 'figs') {
      text(stripFigureNotes(m.q));
      m.figs.forEach(function (f) { wrap.appendChild(picNode(doc, f, picUrl)); });
    } else {
      text(m.q || '(only the question number was kept — open it in the mistake book)');
      if (tier === 'page') {
        var pg = mkIn(doc, 'details', 'lpWords');
        pg.appendChild(mkIn(doc, 'summary', null, '📄 The page it was on'));
        pg.appendChild(picNode(doc, m.pimg, picUrl, 'lpFig lpFigWhole'));
        wrap.appendChild(pg);
      }
    }
    if (!noOpts && m.opts && m.opts.length && tier !== 'question' && !m.popts) {
      wrap.appendChild(mkIn(doc, 'div', 'lpOrigOpts', m.opts.map(function (x, i) { return '(' + (x.label || (i + 1)) + ') ' + x.text; }).join('   ')));
    }
    return wrap;
  }
  /* ---- A PRACTICE QUESTION, blocks and all ---- */
  function practiceNode(doc, p, m, picUrl) {
    var wrap = mkIn(doc, 'div', 'lpPracQ');
    if (p.blocks && p.blocks.length) {
      p.blocks.forEach(function (b) {
        if (b.t === 'text') wrap.appendChild(mkIn(doc, 'div', 'lpQText', b.text));
        else if ((m.figs || [])[b.i]) wrap.appendChild(picNode(doc, m.figs[b.i], picUrl));
      });
    } else {
      wrap.appendChild(mkIn(doc, 'div', 'lpQText', p.question));
    }
    return wrap;
  }

  /* ---------------------------------------------------------------- */
  /* ✍️ TRYING IT                                                       */
  /* ---------------------------------------------------------------- */
  /* IS THIS ANSWER THE KEY'S? Generous where a pupil writes the same thing
     another way — "36", "36 students", "= 36", "1,200" for "1200", "3/4"
     for "0.75" — and never generous about the number itself. Returns
     true, false, or null when there is no key to check against. */
  function numsOf(s) {
    var t = String(s == null ? '' : s).replace(/(\d),(?=\d{3}\b)/g, '$1');
    var out = [];
    var re = /(\d+)\s+(\d+)\s*\/\s*(\d+)|(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)(½)?|½/g, mm;
    while ((mm = re.exec(t))) {
      if (mm[1]) out.push(+mm[1] + (+mm[3] ? +mm[2] / +mm[3] : 0));
      else if (mm[4]) out.push(+mm[5] ? +mm[4] / +mm[5] : NaN);
      else if (mm[6]) out.push(+mm[6] + (mm[7] ? 0.5 : 0));
      else out.push(0.5);
    }
    return out.filter(function (n) { return isFinite(n); });
  }
  function wordsOf(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[’']/g, '')
      .replace(/[^a-z0-9.½\/]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function answerMatches(key, given) {
    var k = String(key == null ? '' : key).trim(), g = String(given == null ? '' : given).trim();
    if (!k) return null;
    if (!g) return false;
    if (wordsOf(k) === wordsOf(g)) return true;
    var kn = numsOf(k), gn = numsOf(g);
    if (kn.length && gn.length) {
      /* The key's LAST number is the answer ("(2) 36", "Q5: 36 students"):
         a pupil who wrote just that number has it. All of them, in order,
         is the other way to be right ("2 h 30 min"). */
      var near = function (a, b) { return Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(a)); };
      if (gn.length === kn.length && gn.every(function (n, i) { return near(n, kn[i]); })) return true;
      if (gn.length === 1 && near(gn[0], kn[kn.length - 1])) return true;
      return false;
    }
    var kw = wordsOf(k), gw = wordsOf(g);
    return kw.length > 2 && gw.length > 2 && (kw.indexOf(gw) >= 0 || gw.indexOf(kw) >= 0);
  }
  /* Which option the key names: "(2) 36", "2", "B", or the option's own text. */
  function optionIsKey(key, opt, i) {
    var k = String(key == null ? '' : key).trim();
    if (!k) return null;
    var lab = String((opt && opt.label) || (i + 1)).replace(/[()\s.]/g, '').toLowerCase();
    var head = /^\(?\s*([a-f]|[1-6])\s*[).:]?(?:\s|$)/i.exec(k);
    if (head) {
      var h = head[1].toLowerCase();
      if (h === lab || h === String(i + 1) || h === 'abcdef'.charAt(i)) return true;
      if (k.replace(head[0], '').trim() === '') return false;
    }
    var txt = (opt && opt.text) || '';
    return txt ? answerMatches(k.replace(/^\(?\s*(?:[a-f]|[1-6])\s*[).:]\s*/i, ''), txt) === true : false;
  }
  /* spec: { opts: [{ label, text }], correct: index or -1, ans, why: [lines], pictureOpts: n }
     The options to tap, or a box to type in, and a Check. The answer is
     one more tap — after a try, or for a pupil who is stuck. */
  function tryNode(doc, spec) {
    var wrap = mkIn(doc, 'div', 'lpTry');
    var res = mkIn(doc, 'div', 'lpTryRes');
    res.setAttribute('aria-live', 'polite');
    var reveal = mkIn(doc, 'div', 'lpTryKey');
    reveal.hidden = true;
    var showKey = function () {
      reveal.innerHTML = '';
      var a = mkIn(doc, 'div', 'lpKeyAns');
      a.appendChild(mkIn(doc, 'b', null, 'Answer: '));
      a.appendChild(doc.createTextNode(spec.ans || '—'));
      reveal.appendChild(a);
      if (spec.why && spec.why.length) {
        var ol = mkIn(doc, 'ol', 'lpSteps');
        spec.why.forEach(function (w) { ol.appendChild(mkIn(doc, 'li', null, w)); });
        reveal.appendChild(ol);
      }
      reveal.hidden = false;
    };
    var say = function (ok) {
      res.className = 'lpTryRes ' + (ok === true ? 'lpTryOk' : ok === false ? 'lpTryNo' : 'lpTryUn');
      res.textContent = ok === true ? '✓ That’s right!' : ok === false ? '✗ Not quite — have another go, or show the answer.'
        : 'There is no answer key on this one — show the answer to compare.';
      if (ok === true) showKey();
    };
    var opts = spec.opts || [];
    var count = opts.length || num(spec.pictureOpts);
    if (count > 1) {
      var row = mkIn(doc, 'div', 'lpTryOpts');
      for (var i = 0; i < count; i++) {
        (function (i) {
          var o = opts[i] || { label: String(i + 1), text: '' };
          var b = mkIn(doc, 'button', 'lpTryOpt', '(' + (o.label || (spec.letters ? LETTERS[i] : i + 1)) + ')' + (o.text ? ' ' + o.text : ''));
          b.type = 'button';
          b.addEventListener('click', function () {
            Array.prototype.forEach.call(row.childNodes || row.children || [], function (x) { if (x.classList) x.classList.remove('on'); });
            b.classList.add('on');
            var ok = spec.correct >= 0 ? i === spec.correct : optionIsKey(spec.ans, o, i);
            say(ok);
          });
          row.appendChild(b);
        })(i);
      }
      wrap.appendChild(row);
    } else {
      var line = mkIn(doc, 'div', 'lpTryLine');
      var inp = mkIn(doc, 'input', 'lpTryIn');
      inp.type = 'text';
      inp.setAttribute('aria-label', 'Your answer');
      inp.placeholder = 'Your answer';
      inp.autocomplete = 'off';
      var check = function () { say(answerMatches(spec.ans, inp.value)); };
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); check(); } });
      var cb = mkIn(doc, 'button', 'lpMini lpTryCheck', 'Check');
      cb.type = 'button';
      cb.addEventListener('click', check);
      line.appendChild(inp);
      line.appendChild(cb);
      wrap.appendChild(line);
    }
    wrap.appendChild(res);
    var sk = mkIn(doc, 'button', 'lpMini lpTryShow', 'Show the answer');
    sk.type = 'button';
    sk.addEventListener('click', showKey);
    wrap.appendChild(sk);
    wrap.appendChild(reveal);
    return wrap;
  }
  function trySpecOfMistake(m) {
    return { opts: m.popts ? [] : (m.opts || []), correct: -1, ans: m.ans,
             why: m.expl ? [m.expl] : [], pictureOpts: m.popts ? 4 : 0 };
  }
  function trySpecOfPractice(p) {
    return { opts: (p.options || []).map(function (t, i) { return { label: LETTERS[i], text: t }; }),
             correct: p.correct, ans: (p.correct >= 0 ? '(' + LETTERS[p.correct] + ') ' : '') + p.answer,
             why: p.working || [], letters: true };
  }
  function btn(cls, text, title, on) {
    var b = mk('button', cls, text);
    b.type = 'button';
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
    if (on) b.addEventListener('click', on);
    return b;
  }

  function shell() {
    if (S.back && S.back.ownerDocument === S.doc && S.back.parentNode) return S.back;
    var back = mk('div', 'lpBack');
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    back.setAttribute('aria-labelledby', 'lpTitle');
    var card = mk('div', 'lpCard');
    var head = mk('div', 'lpHead');
    var title = mk('h2', 'lpTitle');
    title.id = 'lpTitle';
    head.appendChild(title);
    head.appendChild(btn('lpX', '✕', 'Close', close));
    var sub = mk('div', 'lpSub');
    var bar = mk('div', 'lpBar');
    var body = mk('div', 'lpBody');
    var foot = mk('div', 'lpFoot');
    card.appendChild(head);
    card.appendChild(sub);
    card.appendChild(bar);
    card.appendChild(body);
    card.appendChild(foot);
    back.appendChild(card);
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    S.doc.addEventListener('keydown', function (e) { if (S.open && e.key === 'Escape') close(); });
    S.doc.body.appendChild(back);
    S.back = back;
    return back;
  }

  function close() {
    S.epoch++;
    S.queue = [];
    S.open = false;
    if (S.back) S.back.classList.remove('open');
  }

  function ctxFor(g) {
    var o = S.opts || {};
    return {
      sub: o.sub,
      level: g.level || o.level || '',
      objective: g.code ? g.code + ' ' + g.title : (g.kind === 'lo' ? g.title : ''),
      topic: g.topic || (g.kind !== 'lo' ? g.title : '')
    };
  }

  function allItems() {
    var out = [];
    (S.opts.groups || []).forEach(function (g) {
      (g.mistakes || []).forEach(function (m) { out.push({ g: g, m: m }); });
    });
    return out;
  }

  /* ---- the queue: one practice question per mistake ---- */
  function want(m, g, force) {
    if (!force && (S.made[m.key] || S.failed[m.key])) return;
    if (S.queue.some(function (x) { return x.m.key === m.key; })) return;
    if (force) { delete S.made[m.key]; delete S.failed[m.key]; }
    S.queue.push({ m: m, g: g, force: !!force });
    paintCard(m.key);
    pump();
  }
  function pump() {
    var epoch = S.epoch;
    while (S.running < WORKERS && S.queue.length) {
      var job = S.queue.shift();
      S.running++;
      _running[job.m.key] = 1;
      (function (job) {
        var st = store(S.opts);
        var o = S.opts;
        prepare(job.m, epoch).then(function () {
          if (epoch !== S.epoch) throw new Error('closed');
          var ctx = ctxFor(job.g);
          var figs = (job.m.figs || []).slice(0, FIG_MAX);
          ctx.figs = figs.length;
          if (!figs.length) return makePractice(job.m, ctx, o.ask, o.parse);
          return Promise.all(figs.map(function (f) { return imageData(S.doc, f, o.picUrl); })).then(function (imgs) {
            ctx.images = imgs.filter(Boolean);
            ctx.seen = ctx.images.length === figs.length;
            if (!ctx.seen) ctx.images = [];
            return makePractice(job.m, ctx, o.ask, o.parse);
          });
        }).then(function (p) {
          cachePut(st, job.m, p);
          if (epoch !== S.epoch) return;
          S.made[job.m.key] = p;
        }, function (e) {
          if (epoch !== S.epoch) return;
          S.failed[job.m.key] = String((e && e.message) || e || 'Could not write a question.');
        }).then(function () {
          if (epoch !== S.epoch) return;
          S.running--;
          delete _running[job.m.key];
          paintCard(job.m.key);
          paintFoot();
          pump();
        });
      })(job);
      paintCard(job.m.key);
    }
  }
  /* ✂️ SET IT OUT AGAIN FIRST, when it is text that leans on a figure.
     One at a time (`S.rebuildChain`) — the host's own pipeline reads the
     page, cuts each figure and redraws it, and two of those at once is
     two image calls racing for the same ration. The host hands back the
     mistake as its book now holds it; this window re-reads it in place, so
     every group that holds it sees the figure. */
  function prepare(m, epoch) {
    var o = S.opts || {};
    if (typeof o.rebuild !== 'function' || S.rebuildsLeft <= 0 || S.rebuilt[m.key] || !wantsRebuild(m)) return Promise.resolve();
    S.rebuildsLeft--;
    S.rebuilt[m.key] = 1;
    var run = function () {
      if (epoch !== S.epoch) return null;
      S.rebuilding[m.key] = 1;
      paintCard(m.key);
      return Promise.resolve().then(function () { return o.rebuild(m); }).then(function (raw) {
        var nm = raw ? (raw.key && 'tkey' in raw && 'figs' in raw ? raw : fromMistake(raw)) : null;
        if (nm && (nm.figs.length || nm.qimg || tierOf(nm) === 'blocks')) {
          var key = m.key;
          Object.keys(nm).forEach(function (k) { if (k !== 'key') m[k] = nm[k]; });
          m.key = key;
        }
      }, function (e) { /* the figure could not be cut — the wording still makes a question */ })
        .then(function () { delete S.rebuilding[m.key]; if (epoch === S.epoch) paintCard(m.key); });
    };
    S.rebuildChain = (S.rebuildChain || Promise.resolve()).then(run, run);
    return S.rebuildChain;
  }
  function waiting(key) {
    return S.queue.some(function (x) { return x.m.key === key; });
  }

  /* ---- drawing ---- */
  function render() {
    var back = shell();
    var o = S.opts;
    back.querySelector('.lpTitle').textContent = o.title || '✏️ Practise these mistakes';
    var sub = back.querySelector('.lpSub');
    sub.textContent = o.subtitle || '';
    var bar = back.querySelector('.lpBar');
    bar.innerHTML = '';
    var groups = sortGroups(o.groups || [], S.sort);
    if ((o.groups || []).length > 1) {
      var sel = mk('select', 'lpSelect');
      sel.setAttribute('aria-label', 'Order the objectives');
      SORTS.forEach(function (s) {
        var op = mk('option', null, s[1]);
        op.value = s[0];
        if (S.sort === s[0]) op.selected = true;
        sel.appendChild(op);
      });
      sel.addEventListener('change', function () { S.sort = sel.value; render(); });
      bar.appendChild(sel);
    }
    var items = allItems();
    var keyLab = mk('label', 'lpCheck');
    var keyCb = mk('input');
    keyCb.type = 'checkbox';
    keyCb.checked = S.withKey !== false;
    keyCb.addEventListener('change', function () { S.withKey = keyCb.checked; });
    keyLab.appendChild(keyCb);
    keyLab.appendChild(mk('span', null, 'Answer key + working'));
    bar.appendChild(keyLab);
    var misLab = mk('label', 'lpCheck');
    var misCb = mk('input');
    misCb.type = 'checkbox';
    misCb.checked = !!S.withMistakes;
    misCb.addEventListener('change', function () { S.withMistakes = misCb.checked; });
    misLab.appendChild(misCb);
    misLab.appendChild(mk('span', null, 'My original mistakes'));
    bar.appendChild(misLab);
    bar.appendChild(btn('lpPrintBtn', o.report ? '⬇ Export PDF' : '🖨 Print / PDF',
      'Print the practice sheet, or choose "Save as PDF" in the print dialog', printNow));

    var body = back.querySelector('.lpBody');
    body.innerHTML = '';
    S.cards = {};
    if (o.report && groups.length) body.appendChild(summaryNode(groups));
    if (!items.length) {
      body.appendChild(mk('div', 'lpEmpty', o.emptyText ||
        'No mistakes are filed under ' + (groups.length === 1 ? 'this objective' : 'these objectives') +
        ' yet — every question on it was right, or the mistakes were filed before objectives were kept. 🎉'));
    }
    groups.forEach(function (g) {
      if (!(g.mistakes || []).length && !o.report) return;
      var sec = mk('section', 'lpGroup');
      sec.setAttribute('data-key', g.key || '');
      var gh = mk('div', 'lpGroupHead lpB-' + band(g.pct));
      if (g.code) gh.appendChild(mk('span', 'lpCode', g.code));
      gh.appendChild(mk('span', 'lpGroupTitle', g.title || 'Objective'));
      var stats = [];
      if (num(g.att) > 0) stats.push(fmt(g.got) + '/' + fmt(g.att) + (g.pct === null || g.pct === undefined ? '' : ' (' + g.pct + '%)'));
      stats.push((g.mistakes || []).length + ' mistake' + ((g.mistakes || []).length === 1 ? '' : 's'));
      gh.appendChild(mk('span', 'lpGroupStats', stats.join(' · ')));
      if (g.topic && g.topic !== g.title) gh.appendChild(mk('span', 'lpGroupTopic', (g.level ? g.level + ' · ' : '') + g.topic));
      sec.appendChild(gh);
      if (o.report && g.qs) sec.appendChild(mk('div', 'lpQs', g.qs));
      (g.mistakes || []).forEach(function (m) {
        var c = mk('div', 'lpItem');
        S.cards[m.key] = { el: c, m: m, g: g, open: false };
        sec.appendChild(c);
        paintCard(m.key);
      });
      body.appendChild(sec);
    });
    paintFoot();
    if (S.focus) {
      var target = body.querySelector('[data-key="' + String(S.focus).replace(/"/g, '') + '"]');
      if (target && target.scrollIntoView) setTimeout(function () { try { target.scrollIntoView({ block: 'start' }); } catch (e) { /* old browser */ } }, 30);
    }
  }

  function summaryNode(groups) {
    var wrap = mk('div', 'lpSumWrap');
    var t = mk('table', 'lpSum');
    var hr = mk('tr');
    ['Learning objective', 'Qs', 'Marks', '%', 'Mistakes'].forEach(function (h) { hr.appendChild(mk('th', null, h)); });
    var th = mk('thead');
    th.appendChild(hr);
    t.appendChild(th);
    var tb = mk('tbody');
    groups.forEach(function (g) {
      var tr = mk('tr', 'lpB-' + band(g.pct));
      var c0 = mk('td', 'lpSumObj');
      if (g.code) c0.appendChild(mk('b', null, g.code + ' '));
      c0.appendChild(S.doc.createTextNode(g.title || ''));
      if (g.qs) c0.appendChild(mk('span', 'lpSumQs', g.qs));
      tr.appendChild(c0);
      tr.appendChild(mk('td', null, g.q ? String(g.q) : ''));
      tr.appendChild(mk('td', null, num(g.att) > 0 ? fmt(g.got) + '/' + fmt(g.att) : (num(g.tot) > 0 ? 'blank/' + fmt(g.tot) : '–')));
      tr.appendChild(mk('td', null, g.pct === null || g.pct === undefined ? '–' : g.pct + '%'));
      tr.appendChild(mk('td', null, String((g.mistakes || []).length)));
      if ((g.mistakes || []).length) {
        tr.classList.add('lpSumGo');
        tr.tabIndex = 0;
        tr.title = 'Go to the practice questions for this objective';
        var go = function () {
          var target = S.back.querySelector('.lpGroup[data-key="' + String(g.key || '').replace(/"/g, '') + '"]');
          if (target && target.scrollIntoView) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        };
        tr.addEventListener('click', go);
        tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      }
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    return wrap;
  }

  function paintCard(key) {
    var c = S.cards[key];
    if (!c) return;
    var m = c.m, el = c.el;
    el.innerHTML = '';
    var top = mk('div', 'lpItemTop');
    top.appendChild(mk('span', 'lpFrom', [m.ws, m.n ? 'Q' + m.n : '', m.mk].filter(Boolean).join(' · ') || 'A mistake'));
    top.appendChild(mk('span', 'lpVerdict lpV-' + (m.v || 'wrong'),
      m.v === 'skipped' ? '– left blank' : (m.v === 'partial' ? '~ partly right' : '✗ wrong')));
    el.appendChild(top);

    var orig = mk('details', 'lpOrig');
    orig.appendChild(mk('summary', null, 'The question I got wrong'));
    var oq = questionNode(S.doc, m, S.opts.picUrl);
    oq.classList.add('lpOrigQ');
    orig.appendChild(oq);
    if (S.rebuilding[key]) orig.appendChild(mk('div', 'lpWait', '✂️ Cutting the figure out of the page and redrawing it clean…'));
    var mine = mk('div', 'lpOrigLine');
    mine.appendChild(mk('b', null, 'My answer: '));
    mine.appendChild(S.doc.createTextNode(m.mine || (m.v === 'skipped' ? '(left blank)' : '—')));
    orig.appendChild(mine);
    if (m.ans) {
      var right = mk('div', 'lpOrigLine');
      right.appendChild(mk('b', null, 'Correct answer: '));
      right.appendChild(S.doc.createTextNode(m.ans));
      orig.appendChild(right);
    }
    el.appendChild(orig);

    var p = S.made[key];
    var box = mk('div', 'lpPrac');
    if (p) {
      box.appendChild(mk('div', 'lpPracLabel', '✏️ Practice question' + (p.method ? ' · ' + p.method : '')));
      box.appendChild(practiceNode(S.doc, p, m, S.opts.picUrl));
      if (p.options.length) {
        var ol = mk('ol', 'lpOpts');
        p.options.forEach(function (x, i) { ol.appendChild(mk('li', null, '(' + LETTERS[i] + ') ' + x)); });
        box.appendChild(ol);
      }
      /* ✍️ Somewhere to answer it before the key is opened. */
      var tryBox = mk('details', 'lpTryWrap');
      tryBox.appendChild(mk('summary', null, '✍️ Try it'));
      tryBox.appendChild(tryNode(S.doc, trySpecOfPractice(p)));
      box.appendChild(tryBox);
      var reveal = mk('details', 'lpKey');
      reveal.open = !!c.open;
      reveal.addEventListener('toggle', function () { c.open = reveal.open; });
      reveal.appendChild(mk('summary', null, 'Show the answer and working'));
      var ans = mk('div', 'lpKeyAns');
      ans.appendChild(mk('b', null, 'Answer: '));
      ans.appendChild(S.doc.createTextNode((p.correct >= 0 ? '(' + LETTERS[p.correct] + ') ' : '') + p.answer));
      reveal.appendChild(ans);
      if (p.working.length) {
        var steps = mk('ol', 'lpSteps');
        p.working.forEach(function (s) { steps.appendChild(mk('li', null, s)); });
        reveal.appendChild(steps);
      }
      if (p.algebra && isMath(S.opts.sub || m.sub)) {
        reveal.appendChild(mk('div', 'lpWarn', 'This working may still use a letter for a number — tap 🔄 for one done with units and parts.'));
      }
      box.appendChild(reveal);
      var tools = mk('div', 'lpTools');
      tools.appendChild(btn('lpMini', '🔄 Another one', 'Write a different practice question on the same skill', function () { want(m, c.g, true); }));
      box.appendChild(tools);
    } else if (waiting(key) || isRunning(key)) {
      box.appendChild(mk('div', 'lpWait', S.rebuilding[key] ? '✂️ Setting the question out with its figure first…'
        : '✨ Writing a fresh question on the same skill…'));
    } else if (S.failed[key]) {
      box.appendChild(mk('div', 'lpWarn', S.failed[key]));
      box.appendChild(btn('lpMini', '🔄 Try again', 'Ask again', function () { want(m, c.g, true); }));
    } else {
      box.appendChild(btn('lpMake', '✨ Make a practice question', 'Write a fresh question on the same skill, with answer and working',
        function () { want(m, c.g, false); }));
    }
    el.appendChild(box);
  }
  var _running = {};
  function isRunning(key) { return !!_running[key]; }

  function paintFoot() {
    if (!S.back) return;
    var foot = S.back.querySelector('.lpFoot');
    foot.innerHTML = '';
    var items = allItems();
    var made = items.filter(function (x) { return S.made[x.m.key]; }).length;
    var busy = items.filter(function (x) { return waiting(x.m.key); }).length + S.running;
    var note = mk('span', 'lpFootNote', items.length
      ? made + ' of ' + items.length + ' practice question' + (items.length === 1 ? '' : 's') + ' ready' + (busy ? ' · writing ' + busy + '…' : '')
      : '');
    foot.appendChild(note);
    var rest = items.filter(function (x) { return !S.made[x.m.key] && !waiting(x.m.key) && !S.failed[x.m.key]; });
    if (rest.length) {
      foot.appendChild(btn('lpMake', '✨ Make the rest (' + rest.length + ')', 'Write a practice question for every mistake still without one', function () {
        rest.forEach(function (x) { want(x.m, x.g, false); });
        paintFoot();
      }));
    }
    foot.appendChild(btn('lpDone', 'Done', 'Close', close));
  }

  function printNow() {
    var o = S.opts;
    var groups = sortGroups(o.groups || [], S.sort);
    var sheet = {
      title: o.printTitle || o.title || 'Practice',
      name: o.name || '',
      sub: o.sub,
      when: new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }),
      summary: o.report ? groups : null,
      withKey: S.withKey !== false,
      withMistakes: !!S.withMistakes,
      groups: groups.map(function (g) {
        return {
          title: g.title, code: g.code, pct: g.pct,
          items: (g.mistakes || []).map(function (m) { return { m: m, p: S.made[m.key] || null }; })
        };
      })
    };
    /* 🖼 Every picture's link first, so the sheet prints its figures. */
    var list = [];
    sheet.groups.forEach(function (g) { g.items.forEach(function (it) { list.push(it.m); }); });
    sheet.pic = picNow;
    var doc = S.doc;
    resolveAll(list, o.picUrl, 5000).then(function () {
      printHtml(doc, '<div class="lpSheet">' + sheetHtml(sheet) + '</div>', sheet.title + (sheet.name ? ' — ' + sheet.name : ''));
    });
  }

  /* open({ doc, title, subtitle, name, sub, level, groups, sort, focus, ask, parse, storage, auto, report, printTitle, emptyText })
     groups: [{ key, kind: 'lo'|'topic'|'sheet', code, title, topic, level, order, got, att, tot, pct, q, qs, mistakes: [norm] }] */
  function open(opts) {
    opts = opts || {};
    S.doc = opts.doc || (root && root.document);
    if (!S.doc || !S.doc.body) return null;
    S.epoch++;
    S.queue = [];
    S.running = 0;
    _running = {};
    S.made = {};
    S.failed = {};
    S.rebuilding = {};
    S.rebuilt = {};
    S.rebuildsLeft = REBUILD_MAX;
    S.rebuildChain = null;
    S.opts = opts;
    S.sort = opts.sort || (opts.report ? 'syllabus' : 'weak');
    S.focus = opts.focus || '';
    S.withKey = true;
    S.withMistakes = false;
    var st = store(opts);
    var items = allItems();
    items.forEach(function (x) {
      var p = cacheGet(st, x.m);
      if (p) S.made[x.m.key] = p;
    });
    var back = shell();
    back.classList.add('open');
    S.open = true;
    render();
    if (opts.auto !== false) {
      var ordered = [];
      sortGroups(opts.groups || [], S.sort).forEach(function (g) {
        (g.mistakes || []).forEach(function (m) { ordered.push({ g: g, m: m }); });
      });
      ordered.filter(function (x) { return !S.made[x.m.key]; }).slice(0, AUTO_MAX)
        .forEach(function (x) { want(x.m, x.g, false); });
    }
    return { close: close };
  }

  /* ---------------------------------------------------------------- */
  /* 👆 THE HOVER CARD over a cell of the objective table               */
  /* ---------------------------------------------------------------- */
  /* preview({ doc, anchor, title, sub, items: [norm mistakes], qs: [{ n, got, tot, blank }],
               picUrl, onOpen, sticky })
     The questions behind ONE coloured cell — that paper, that objective —
     drawn the way the practice window draws them, with the try box under
     each. It stays while the pointer is on the cell or on the card, and for
     as long as the pupil is TYPING in it (a card that vanished mid-answer
     is the one way this goes wrong and feels broken). `sticky` (a tap, or
     the keyboard) keeps it until ✕, Escape or a tap outside. */
  var PV = { el: null, doc: null, anchor: null, hideT: 0, opts: null, idx: 0, sticky: false, bound: false };
  function pvBusy() {
    if (!PV.el || !PV.doc) return false;
    var a = PV.doc.activeElement;
    return !!(a && PV.el.contains && PV.el.contains(a) && /^(?:INPUT|TEXTAREA)$/i.test(a.tagName || ''));
  }
  function hidePreview(soon) {
    if (PV.hideT) { clearTimeout(PV.hideT); PV.hideT = 0; }
    if (!PV.el) return;
    if (soon) {
      PV.hideT = setTimeout(function () {
        PV.hideT = 0;
        if (PV.sticky || pvBusy() || PV.hover) return;
        hidePreview(false);
      }, 260);
      return;
    }
    PV.el.classList.remove('open');
    PV.el.hidden = true;
    PV.anchor = null;
    PV.sticky = false;
  }
  function pvShell(doc) {
    if (PV.el && PV.doc === doc && PV.el.parentNode) return PV.el;
    var el = mkIn(doc, 'div', 'lpPv');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'The question behind this mark');
    el.hidden = true;
    el.addEventListener('mouseenter', function () { PV.hover = true; if (PV.hideT) { clearTimeout(PV.hideT); PV.hideT = 0; } });
    el.addEventListener('mouseleave', function () { PV.hover = false; hidePreview(true); });
    el.addEventListener('focusin', function () { PV.sticky = PV.sticky || false; if (PV.hideT) { clearTimeout(PV.hideT); PV.hideT = 0; } });
    doc.body.appendChild(el);
    PV.el = el;
    PV.doc = doc;
    if (!PV.bound) {
      PV.bound = true;
      doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && PV.el && !PV.el.hidden) hidePreview(false); });
      doc.addEventListener('mousedown', function (e) {
        if (!PV.el || PV.el.hidden) return;
        var t = e.target;
        if (PV.el.contains && PV.el.contains(t)) return;
        if (PV.anchor && PV.anchor.contains && PV.anchor.contains(t)) return;
        hidePreview(false);
      }, true);
    }
    return el;
  }
  function pvPlace() {
    var el = PV.el, a = PV.anchor, doc = PV.doc;
    if (!el || !a || !a.getBoundingClientRect) return;
    var win = doc.defaultView || root;
    var vw = (win && win.innerWidth) || 1024, vh = (win && win.innerHeight) || 768;
    var r = a.getBoundingClientRect();
    var w = Math.min(440, vw - 24);
    el.style.width = w + 'px';
    var h = el.offsetHeight || 320;
    var left = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), vw - w - 12);
    var below = vh - r.bottom, above = r.top;
    var top = below >= h + 12 || below >= above ? r.bottom + 8 : r.top - h - 8;
    top = Math.max(8, Math.min(top, vh - Math.min(h, vh - 16) - 8));
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
  }
  function pvPaint() {
    var o = PV.opts, doc = PV.doc, el = PV.el;
    el.innerHTML = '';
    var head = mkIn(doc, 'div', 'lpPvHead');
    var tt = mkIn(doc, 'div', 'lpPvTitle', o.title || 'This mark');
    head.appendChild(tt);
    var x = mkIn(doc, 'button', 'lpX lpPvX', '✕');
    x.type = 'button';
    x.title = 'Close';
    x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', function () { hidePreview(false); });
    head.appendChild(x);
    el.appendChild(head);
    if (o.sub) el.appendChild(mkIn(doc, 'div', 'lpPvSub', o.sub));
    var qs = o.qs || [];
    if (qs.length) {
      var chips = mkIn(doc, 'div', 'lpPvQs');
      qs.forEach(function (q) {
        var full = !q.blank && q.tot > 0 && q.got >= q.tot;
        var c = mkIn(doc, 'span', 'lpPvQ ' + (q.blank ? 'lpPvQb' : full ? 'lpPvQy' : q.got > 0 ? 'lpPvQp' : 'lpPvQn'),
          'Q' + q.n + ' ' + (q.blank ? '– blank' : (full ? '✓ ' : q.got > 0 ? '~ ' : '✗ ') + fmt(q.got) + '/' + fmt(q.tot)));
        chips.appendChild(c);
      });
      el.appendChild(chips);
    }
    var items = o.items || [];
    if (!items.length) {
      el.appendChild(mkIn(doc, 'div', 'lpPvEmpty', o.empty ||
        (qs.length && qs.every(function (q) { return !q.blank && q.tot > 0 && q.got >= q.tot; })
          ? 'Every question here was right — nothing to try again. 🎉'
          : 'This question is not in the mistake book (it may have been removed, or filed before pictures were kept).')));
    } else {
      if (PV.idx >= items.length) PV.idx = 0;
      if (items.length > 1) {
        var tabs = mkIn(doc, 'div', 'lpPvTabs');
        items.forEach(function (m, i) {
          var t = mkIn(doc, 'button', 'lpPvTab' + (i === PV.idx ? ' on' : ''), m.n ? 'Q' + m.n : 'Question ' + (i + 1));
          t.type = 'button';
          t.addEventListener('click', function () { PV.idx = i; pvPaint(); pvPlace(); });
          tabs.appendChild(t);
        });
        el.appendChild(tabs);
      }
      var m = items[PV.idx];
      var card = mkIn(doc, 'div', 'lpPvCard');
      var from = mkIn(doc, 'div', 'lpFrom', [m.ws, m.n ? 'Q' + m.n : '', m.mk].filter(Boolean).join(' · '));
      card.appendChild(from);
      /* The options are the try buttons below, so they are not printed twice. */
      var qn = questionNode(doc, m, o.picUrl, true);
      card.appendChild(qn);
      pvRebuild(m);
      if (PV.cutting[m.key]) card.appendChild(mkIn(doc, 'div', 'lpWait', '✂️ Cutting the figure out of the page and redrawing it clean…'));
      if (m.mine || m.v === 'skipped') {
        var mine = mkIn(doc, 'div', 'lpOrigLine');
        mine.appendChild(mkIn(doc, 'b', null, 'Last time: '));
        mine.appendChild(doc.createTextNode(m.mine || '(left blank)'));
        card.appendChild(mine);
      }
      card.appendChild(mkIn(doc, 'div', 'lpPvAsk', '✍️ Try it again:'));
      card.appendChild(tryNode(doc, trySpecOfMistake(m)));
      el.appendChild(card);
      /* Pictures change the card's height as they arrive; keep it on screen. */
      Array.prototype.forEach.call(card.querySelectorAll ? card.querySelectorAll('img') : [], function (im) {
        im.addEventListener('load', pvPlace);
      });
    }
    if (typeof o.onOpen === 'function') {
      var foot = mkIn(doc, 'div', 'lpPvFoot');
      var go = mkIn(doc, 'button', 'lpMake', items.length ? '✏️ Practise ' + (items.length === 1 ? 'it' : 'these') + ' — fresh questions' : '✏️ Open');
      go.type = 'button';
      go.addEventListener('click', function () { hidePreview(false); o.onOpen(); });
      foot.appendChild(go);
      el.appendChild(foot);
    }
  }
  /* ✂️ The card sets a text-only question out again too — once per
     question per page, and within the same ceiling the window keeps, so
     sweeping the pointer across a table cannot start a run of image calls. */
  PV.cutting = {};
  PV.cut = {};
  PV.cutsLeft = REBUILD_MAX;
  function pvRebuild(m) {
    var o = PV.opts;
    if (!o || typeof o.rebuild !== 'function' || PV.cut[m.key] || PV.cutsLeft <= 0 || !wantsRebuild(m)) return;
    PV.cut[m.key] = 1;
    PV.cutsLeft--;
    PV.cutting[m.key] = 1;
    var anchor = PV.anchor;
    Promise.resolve().then(function () { return o.rebuild(m); }).then(function (raw) {
      var nm = raw ? (raw.key && 'tkey' in raw && 'figs' in raw ? raw : fromMistake(raw)) : null;
      if (nm && (nm.figs.length || nm.qimg || tierOf(nm) === 'blocks')) {
        var key = m.key;
        Object.keys(nm).forEach(function (k) { if (k !== 'key') m[k] = nm[k]; });
        m.key = key;
      }
    }, function () { /* the wording still asks the question */ }).then(function () {
      delete PV.cutting[m.key];
      if (PV.el && !PV.el.hidden && PV.anchor === anchor && !pvBusy()) { pvPaint(); pvPlace(); }
    });
  }
  function preview(opts) {
    opts = opts || {};
    var doc = opts.doc || (root && root.document);
    if (!doc || !doc.body || !opts.anchor) return null;
    var el = pvShell(doc);
    if (PV.hideT) { clearTimeout(PV.hideT); PV.hideT = 0; }
    /* The same cell again keeps the card as it is — the answer typed into
       it included. */
    if (PV.anchor === opts.anchor && !el.hidden) {
      if (opts.sticky) PV.sticky = true;
      return { close: function () { hidePreview(false); } };
    }
    if (pvBusy() && !opts.sticky) return null;   // typing in one card: the next cell must not steal it
    PV.anchor = opts.anchor;
    PV.opts = opts;
    PV.idx = 0;
    PV.sticky = !!opts.sticky;
    PV.hover = false;
    pvPaint();
    el.hidden = false;
    el.classList.add('open');
    pvPlace();
    return { close: function () { hidePreview(false); } };
  }

  return {
    VERSION: VERSION,
    AUTO_MAX: AUTO_MAX,
    REBUILD_MAX: REBUILD_MAX,
    preview: preview,
    hidePreview: hidePreview,
    SORTS: SORTS,
    open: open,
    close: close,
    isOpen: function () { return !!S.open; },
    fromMistake: fromMistake,
    fromMirror: fromMirror,
    norm: norm,
    matches: matches,
    sortGroups: sortGroups,
    practicePrompt: practicePrompt,
    looksAlgebraic: looksAlgebraic,
    cleanPractice: cleanPractice,
    makePractice: makePractice,
    sheetHtml: sheetHtml,
    printHtml: printHtml,
    cacheKey: cacheKey,
    picSrc: picSrc,
    stripFigureNotes: stripFigureNotes,
    needsFigure: needsFigure,
    wantsRebuild: wantsRebuild,
    tierOf: tierOf,
    practiceBlocks: practiceBlocks,
    questionHtml: questionHtml,
    answerMatches: answerMatches,
    optionIsKey: optionIsKey,
    pure: { pct: pct, band: band, fmt: fmt, hash: hash, esc: esc, lostOf: lostOf, subjectWord: subjectWord, isMath: isMath }
  };
});
