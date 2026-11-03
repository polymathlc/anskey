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
   ===================================================================== */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.LoPractice = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
  'use strict';

  var VERSION = 1;
  var AUTO_MAX = 12;          // written by themselves on open; the rest wait for "Make the rest"
  var WORKERS = 2;            // asked side by side — the host's gate spaces them further
  var CACHE_PREFIX = 'lp1:';
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

  /* ---- A MISTAKE, from either app, in ONE shape ----
     Study Buddy's mistake book entry (`fileMistakes`) and Ans Key's roster
     mirror row (`mistakeMirrorRow`) carry the same facts under different
     names. Both become:
       { key, q, n, ws, ans, mine, v, mk, lo, topic, tkey, sub, at, mcq, opts, expl, done } */
  function fromMistake(m) {
    if (!m || typeof m !== 'object') return null;
    var q = str(m.question, Q_MAX);
    if (!q && Array.isArray(m.blocks)) {
      q = m.blocks.filter(function (b) { return b && b.type === 'text'; })
        .map(function (b) { return str(b.text, 600); }).join('\n').slice(0, Q_MAX);
    }
    var opts = Array.isArray(m.options) ? m.options.slice(0, 8).map(function (o) {
      return { label: str(o && o.label, 4), text: str(o && o.text, 240) };
    }).filter(function (o) { return o.text || o.label; }) : [];
    return {
      key: str(m.key || m.id, 120) || hash(q + '|' + m.number + '|' + m.docName),
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
      done: !!m.cleared
    };
  }
  function fromMirror(r) {
    if (!r || typeof r !== 'object') return null;
    var q = str(r.q, Q_MAX);
    return {
      key: str(r.id, 120) || hash(q + '|' + r.n + '|' + r.doc),
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
      done: !!r.done
    };
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
    lines.push('- It must make complete sense with NO picture. If the original relies on a figure, give every length, angle, scale or shaded part it needs in words, or pick a version of the skill that needs no figure.');
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
    lines.push('{"question":"<the full new question>","options":["<option 1>","<option 2>","<option 3>","<option 4>"] or [],' +
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

  function cleanPractice(o) {
    if (!o || typeof o !== 'object') return null;
    if (Array.isArray(o)) o = o[0];
    if (o && o.questions && Array.isArray(o.questions)) o = o.questions[0];
    if (!o || typeof o !== 'object') return null;
    var question = str(o.question || o.questionText, Q_MAX);
    if (!question) return null;
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
      options: options,
      correct: correct,
      answer: answer,
      working: working,
      method: str(o.method, 60),
      algebra: looksAlgebraic(working.join('\n') + '\n' + answer)
    };
  }

  function cacheKey(m) {
    return CACHE_PREFIX + hash([m.sub, m.ws, m.n, m.q.slice(0, 400), m.ans].join('|'));
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
      var raw = await ask(practicePrompt(m, ctx, strict), {
        system: SYSTEM, json: true, maxOutputTokens: 1800, thinkingLevel: 'low',
        timeoutMs: 70000, routeTimeoutMs: 35000, keepOnTimeout: true, lane: 'bg'
      });
      var obj = null;
      try { obj = typeof parse === 'function' ? parse(raw) : JSON.parse(String(raw || '')); } catch (e) { obj = null; }
      var p = cleanPractice(obj);
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
            h.push('<div>' + nl(p.question) + '</div>');
            if (p.options.length) {
              h.push('<ol class="lpSheetOpts">' + p.options.map(function (o, i) {
                return '<li>(' + LETTERS[i] + ') ' + esc(o) + '</li>';
              }).join('') + '</ol>');
            }
          } else {
            h.push('<div>' + nl(it.m.q || ('Q' + it.m.n)) + '</div><div class="lpSheetNote">The question from your paper' +
              (it.m.ws ? ', ' + esc(it.m.ws) + (it.m.n ? ' Q' + esc(it.m.n) : '') : '') + ' — a fresh one was not written yet.</div>');
            if (it.m.opts && it.m.opts.length) {
              h.push('<ol class="lpSheetOpts">' + it.m.opts.map(function (o, i) {
                return '<li>(' + esc(o.label || (i + 1)) + ') ' + esc(o.text) + '</li>';
              }).join('') + '</ol>');
            }
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
            (m.mk ? ' · ' + esc(m.mk) : '') + '<div>' + nl(m.q) + '</div>' +
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
    try { if (win && win.print) win.print(); } finally {
      setTimeout(finish, 1500);
    }
  }

  /* ---------------------------------------------------------------- */
  /* THE WINDOW                                                         */
  /* ---------------------------------------------------------------- */
  var S = {
    doc: null, back: null, open: false, epoch: 0, opts: null, sort: 'weak',
    cards: {}, queue: [], running: 0, made: {}, failed: {}, focus: ''
  };

  function mk(tag, cls, text) {
    var n = S.doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
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
        makePractice(job.m, ctxFor(job.g), o.ask, o.parse).then(function (p) {
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
    orig.appendChild(mk('div', 'lpOrigQ', m.q || '(only the question number was kept — open it in the mistake book)'));
    if (m.opts && m.opts.length) {
      orig.appendChild(mk('div', 'lpOrigOpts', m.opts.map(function (x, i) { return '(' + (x.label || (i + 1)) + ') ' + x.text; }).join('   ')));
    }
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
      box.appendChild(mk('div', 'lpPracQ', p.question));
      if (p.options.length) {
        var ol = mk('ol', 'lpOpts');
        p.options.forEach(function (x, i) { ol.appendChild(mk('li', null, '(' + LETTERS[i] + ') ' + x)); });
        box.appendChild(ol);
      }
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
      box.appendChild(mk('div', 'lpWait', '✨ Writing a fresh question on the same skill…'));
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
    printHtml(S.doc, '<div class="lpSheet">' + sheetHtml(sheet) + '</div>', sheet.title + (sheet.name ? ' — ' + sheet.name : ''));
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

  return {
    VERSION: VERSION,
    AUTO_MAX: AUTO_MAX,
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
    pure: { pct: pct, band: band, fmt: fmt, hash: hash, esc: esc, lostOf: lostOf, subjectWord: subjectWord, isMath: isMath }
  };
});
