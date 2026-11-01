/* =====================================================================
   🔎 Command search — find any button by name (v1.170.0)
   ---------------------------------------------------------------------
   The toolbar has grown past sixty buttons, half of them inside dropdowns
   (Tools, Shapes, Colour, Print & PDF, Notes & practice), so "where is the
   lasso?" was a hunt. Ctrl+K (⌘K on a Mac) or "/" opens a search box: type
   what you want — "lasso", "rubber", "print answers", "spin names", "mind
   map" — and the matching buttons come out, each with its icon, what it
   does, its shortcut and where it lives. Click one (or Enter) and it is
   pressed for you, exactly as if you had found it yourself.

   THE BUTTONS ARE READ OFF THE PAGE, NEVER LISTED HERE. `collect()` walks
   the toolbar, the header, the student bar and the account area each time
   the box opens, so a button added next month is searchable the day it
   ships, and a button hidden from this person (a teacher-only tool for a
   student, say) is simply not offered. What this file adds is the words a
   teacher might type that the button's own title never uses: SYNONYMS.

   PRESSING IS CLICKING. A result is activated with `el.click()` — the very
   handler the button has always had — so every role check, every guard and
   every side effect is the button's own. Nothing here can do something the
   button would refuse. A button inside a closed dropdown can be clicked
   without the menu being open; afterwards the real button is flashed where
   it sits, so the teacher learns where it lives.

   THE MATCHING IS PURE (`CommandSearch.pure`), so tools/command-search-tests
   can run it without a page: words are normalised (British/American,
   plurals), every query word must match something, and a match is scored by
   how good it is — the whole name, a word, the start of a word, inside a
   word, a typo, letters in order, initials — and by WHERE it matched (the
   button's name beats a synonym beats its description). Recently used
   commands get a small lift, never enough to beat a better match.

   Every keystroke inside the box stops there, so typing "lasso" can never
   fire the L, A and S tool shortcuts behind it.
   ===================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------
     Words a teacher types that a button's own title may never say.
     Keyed by the command's key: 'tool:<data-tool>', '#<id>',
     'color:<hex>', 'dash:<name>', 'heads:<name>', 'text:<label>'.

     Before a '|' are NAMES — whole phrases this button is called by, which
     count as much as its own label ("pen" IS the pencil, "rubber" IS the
     eraser). After it are loose words that help it be found.
     ------------------------------------------------------------------ */
  var SYNONYMS = {
    'tool:select': 'select, move, pointer | select move pointer arrow cursor pick drag edit grab choose',
    'tool:lasso': 'lasso, select many, multi select | lasso loop circle several select many multi multiple group gather rope marquee duplicate copy resize selection',
    'tool:penselect': 'pen select, path select | pen select path polygon bezier curve selection shape select precise outline',
    'tool:highlight': 'highlighter, highlight, hl, marker | highlight highlighter marker yellow emphasise emphasize fluorescent',
    'tool:pen': 'pen, pencil, draw, write | pen pencil draw write ink handwriting scribble freehand stylus annotate',
    'tool:text': 'text, text box, type | text textbox type typing words label write type answer font',
    'tool:ai': 'ai answer, answer box | ai answer box solve chatgpt gpt chung gemini auto answer worked solution generate answer',
    'tool:ainote': 'ai notes, notes card | ai notes note card table picture diagram widget generate explanation summary interactive',
    'tool:line': 'line straight ruler segment',
    'tool:arrow': 'arrow pointer direction point',
    'tool:brace': 'brace, curly bracket, bracket | brace curly bracket bracket span group label',
    'tool:rect': 'rectangle, box, square | rectangle rect box square frame border',
    'tool:ellipse': 'circle, oval, ellipse | ellipse circle oval round ring',
    'tool:keyword': 'keywords, mark keywords | keyword keywords mark words underline important vocabulary key terms',
    'tool:video': 'video solution link youtube clip watch play button',
    'tool:eraser': 'eraser, rubber, erase | eraser rubber erase remove clear wipe delete ink',
    'tool:laser': 'laser, laser pointer | laser pointer point show fade presenter',
    '#uploadBtn': 'open pdf, upload, open file, upload pdf | open upload pdf file import load worksheet browse',
    '#blankPageBtn': 'new page, blank page, add page | blank page new page add page insert page empty page extra page',
    '#deletePageBtn': 'delete page remove page drop page',
    '#bankQBtn': 'question bank questions bank insert question science portal library',
    '#livingAppBtn': 'living app interactive simulation simulator html app wand magic diagram',
    '#livingLibBtn': 'living app library apps qr codes email revision list',
    '#snipBtn': 'snip, screenshot | snip snipping screenshot crop capture pin clip cut out',
    '#dayMenuBtn': 'day class day weekday monday tuesday wednesday thursday friday saturday schedule',
    '#selectionMenuBtn': 'tools menu selection select lasso highlighter',
    '#expandToolsBtn': 'expand tools show all tools toolbar layout',
    '#barModelBtn': 'bar model model suite model drawing units parts maths diagram',
    '#shapeMenuBtn': 'shapes shape menu line arrow rectangle circle',
    '#colorMenuBtn': 'colour color colours colors palette ink colour',
    '#undoBtn': 'undo | undo back revert oops undo last',
    '#redoBtn': 'redo again forward',
    '#deleteBtn': 'delete remove trash bin selected',
    '#aiQuestionFocusBtn': 'ai focus question focus focus box exact question',
    '#aiQuestionFocusClear': 'clear focus remove focus',
    '#aiShareViewBtn': 'share view screen share ai see screen live widgets',
    '#askPageBtn': 'ask ai chat question help explain conversation tutor',
    '#zoomOutBtn': 'zoom out smaller shrink minus reduce',
    '#zoomInBtn': 'zoom in bigger enlarge magnify plus larger',
    '#fitBtn': 'fit width fit page reset zoom whole page',
    '#focusBtn': 'hide banner header more space screenshare',
    '#stylusBtn': 'pencil only stylus apple pencil palm rejection fingers scroll',
    '#nextTwoBtn': 'up next next worksheets next two online class sequence',
    '#lessonRecordBtn': 'record, record lesson | record lesson recording camera video voice capture screencast',
    '#playlistBtn': 'videos playlist play all watch lessons',
    '#codeWinBtn': 'code window html run code embed',
    '#calcBtn': 'calculator | calculator calc maths math sum compute fraction',
    '#thumbToggleBtn': 'pages thumbnails page list previews',
    '#sideToggleBtn': 'side panel sidebar worksheet panel details',
    '#fsBtn': 'full screen, fullscreen | full screen fullscreen maximise maximize present presentation',
    '#printMenuBtn': 'print pdf menu printing',
    '#printQBtn': 'print questions, print worksheet | print questions print worksheet blank worksheet printout without answers',
    '#printABtn': 'print answers, print answer key | print answers print answer key printout with answers workings',
    '#downloadBtn': 'download pdf export save as file annotated',
    '#keyPdfBtn': 'answer key | answer key answers solutions marking scheme key pdf generate answers',
    '#printQrBtn': 'qr code qr scan link print qr',
    '#saveBtn': 'save | save cloud store upload keep',
    '#shareBtn': 'share link send students url copy link',
    '#rewardBtn': 'marks, award marks, rewards, points | reward rewards marks points award give marks prize class',
    '#wheelBtn': 'wheel, name wheel, spin names, random name | wheel name wheel spin random pick student spinner call on',
    '#runeDoorBtn': 'rune door, door | rune portal welcome students open lesson medieval gate',
    '#lessonSplashBtn': 'lesson start quest rules castle gate splash intro',
    '#consultLogBtn': 'consults consult questions calls archive help requests',
    '#liveCamBtn': 'live cams cameras webcam see students camera',
    '#classroomBattleBtn': 'battle boss game heroes classroom battle fight quest',
    '#myHeroBtn': 'my hero hero character skills treasure avatar',
    '#heroClaimsBtn': 'hero claims approve students characters',
    '#lessonMenuBtn': 'notes practice menu',
    '#notesBtn': 'teaching notes notes notebook style training upload notes learn',
    '#quickNoteBtn': 'add note house rule rule quick note instruction',
    '#mmBtn': 'mind map, mindmap | mindmap mind map concept map brainstorm boxes arrows map',
    '#practiceMenuBtn': 'practice practise try yourself hide answers test quiz',
    '#docsBtn': 'my pdfs, saved pdfs, open saved | my pdfs saved pdfs open saved files documents worksheets',
    '#burgerBtn': 'worksheets list all worksheets questions files menu browse',
    '#voiceAiBtn': 'voice ai voice talk speak microphone helper live',
    '#sbWorksheetsBtn': 'worksheets list my worksheets',
    '#sbPracticeBtn': 'practice practise try',
    '#sbMarkAllBtn': 'mark all check all answers report',
    '#sbCheckBtn': 'check answer mark last',
    '#sbStopBtn': 'stop practising show answers',
    '#sbVideosBtn': 'videos watch explanation',
    '#sbRecordingBtn': 'recording watch lesson',
    '#sbGuideBtn': 'guide tour help how to',
    '#appsBtn': 'apps other apps polymath science maths study buddy switch app',
    'dash:solid': 'solid line plain',
    'dash:dashed': 'dashed line dashes',
    'dash:dotted': 'dotted line dots',
    'heads:none': 'no arrowhead plain line',
    'heads:end': 'arrowhead end single arrow',
    'heads:both': 'arrowheads both double arrow two way',
    'text:students': 'students manage students levels subjects roster',
    'text:picture': 'picture image generate picture diagram drawing illustration',
    'text:ai engine': 'ai engine model chatgpt gemini kimi settings key',
    'text:syllabus': 'syllabus moe topics learning outcomes science syllabus',
    'text:sign out': 'sign out log out logout',
    'text:sign in with google': 'sign in log in login google',
    'text:teacher': 'teacher hand back return teacher mode'
  };

  /* Where a button lives, said in words on its result. */
  var MENU_NAMES = {
    dayMenu: 'Day menu',
    selectionMenu: 'Tools menu',
    shapeMenu: 'Shapes menu',
    colorMenu: 'Colour menu',
    printMenu: 'Print & PDF menu',
    lessonMenu: 'Notes & practice menu'
  };

  /* Words that carry no meaning in a search ("open THE lasso"). */
  var STOP = { the: 1, a: 1, an: 1, to: 1, for: 1, of: 1, my: 1, please: 1, me: 1, i: 1, want: 1, how: 1, do: 1, can: 1, where: 1, is: 1, button: 1, tool: 1 };

  /* Verbs a request often starts with. They count when they match ("open
     PDF" is the Open button) and are forgiven when they do not ("open the
     calculator" still finds the Calculator). */
  var SOFT = { open: 1, show: 1, use: 1, start: 1, turn: 1, on: 1, off: 1, get: 1, find: 1, go: 1, make: 1, add: 1, put: 1, give: 1, let: 1, see: 1 };

  /* British and American spellings, and a few shorthands, fold to one. */
  var FOLD = {
    colour: 'color', colours: 'color', colors: 'color',
    practise: 'practice', practising: 'practice', practicing: 'practice',
    maximise: 'maximize', emphasise: 'emphasize',
    centre: 'center', grey: 'gray',
    maths: 'math', mathematics: 'math',
    pdfs: 'pdf', qr: 'qr',
    calc: 'calculator', pic: 'picture', pics: 'picture', img: 'image',
    del: 'delete', rm: 'remove', vid: 'video', vids: 'video',
    fullscreen: 'fullscreen', mindmap: 'mindmap'
  };

  var MAX_RESULTS = 8;
  var RECENT_KEY = 'polymath.cmdSearchRecent.v1';
  var RECENT_MAX = 12;

  /* ------------------------------------------------------------------
     Pure text helpers
     ------------------------------------------------------------------ */
  function norm(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9+]+/g, ' ')
      .trim();
  }

  /* One word to its search form: folded spelling, simple plural off. */
  function stem(w) {
    if (!w) return w;
    if (FOLD[w]) return FOLD[w];
    if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (w.length > 3 && /[^s]s$/.test(w) && !/(us|is|ss)$/.test(w)) return w.slice(0, -1);
    return w;
  }

  function words(s) {
    var n = norm(s);
    if (!n) return [];
    return n.split(' ').filter(Boolean).map(stem);
  }

  /* The query's words, without the ones that mean nothing — unless that
     would leave nothing at all, when the words are kept as typed. */
  function queryWords(q) {
    var all = words(q);
    var kept = all.filter(function (w) { return !STOP[w]; });
    return kept.length ? kept : all;
  }

  /* Damerau–Levenshtein (optimal string alignment), stopping early once the
     distance is past `max` — a typo in "lasoo" is one, not a full table. */
  function editDistance(a, b, max) {
    if (a === b) return 0;
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    var prev2 = null, prev = [], cur;
    for (var j = 0; j <= lb; j++) prev[j] = j;
    for (var i = 1; i <= la; i++) {
      cur = [i];
      var rowMin = i;
      for (var k = 1; k <= lb; k++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(k - 1) ? 0 : 1;
        var v = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + cost);
        if (i > 1 && k > 1 && prev2 && a.charCodeAt(i - 1) === b.charCodeAt(k - 2) &&
            a.charCodeAt(i - 2) === b.charCodeAt(k - 1)) {
          v = Math.min(v, prev2[k - 2] + 1);
        }
        cur[k] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev;
      prev = cur;
    }
    return prev[lb];
  }

  /* Are the letters of `q` in `w`, in order? ("hlt" in "highlight") */
  function subsequence(q, w) {
    var i = 0;
    for (var j = 0; j < w.length && i < q.length; j++) if (w.charAt(j) === q.charAt(i)) i++;
    return i === q.length;
  }

  /* How well one query word matches one candidate word, 0 … 1. */
  function wordScore(q, w) {
    if (!q || !w) return 0;
    if (q === w) return 1;
    if (w.indexOf(q) === 0) return 0.72 + 0.2 * (q.length / w.length);
    if (q.length >= 4 && q.indexOf(w) === 0 && w.length >= 3) return 0.6;   // "highlights" vs "highlight"
    if (q.length >= 3 && w.indexOf(q) > 0) return 0.5;
    // A typo keeps its first letter: "lasoo" is the lasso, but "lasso" is not
    // a misspelt "lesson".
    if (q.length >= 4 && q.charAt(0) === w.charAt(0)) {
      var allow = q.length >= 7 ? 2 : 1;
      var d = editDistance(q, w, allow);
      if (d <= allow) return d === 1 ? 0.62 : 0.5;
      // A typo in the part typed so far: "lasoo" → "lasso", "calcu" typed as "clacu".
      if (w.length > q.length && q.charAt(1) === w.charAt(1)) {
        var head = w.slice(0, q.length);
        var dh = editDistance(q, head, 1);
        if (dh <= 1) return 0.52;
      }
    }
    if (q.length >= 3 && subsequence(q, w) && q.charAt(0) === w.charAt(0)) return 0.3;
    return 0;
  }

  /* The best match of one query word against a list of words. */
  function bestIn(q, list) {
    var best = 0;
    for (var i = 0; i < list.length; i++) {
      var s = wordScore(q, list[i]);
      if (s > best) { best = s; if (best === 1) break; }
    }
    return best;
  }

  /* Initials: "pa" for "print answers", "fs" for "full screen". */
  function initials(list) {
    return list.map(function (w) { return w.charAt(0); }).join('');
  }

  /* Field weights: the name the button goes by beats a synonym beats the
     long description. */
  var W_LABEL = 1, W_SYN = 0.86, W_DESC = 0.55, W_WHERE = 0.4;

  /* Prepare a command for matching once, not on every keystroke. */
  function splitSynonyms(str) {
    var s = String(str || '');
    var bar = s.indexOf('|');
    var names = bar === -1 ? [] : s.slice(0, bar).split(',').map(function (n) { return words(n).join(' '); }).filter(Boolean);
    var loose = bar === -1 ? s : s.slice(bar + 1);
    return { names: names, loose: words(s.replace('|', ' ').replace(/,/g, ' ')), looseOnly: words(loose) };
  }

  function prepare(cmd) {
    var label = words(cmd.label);
    var parts = splitSynonyms(cmd.synonyms);
    var syn = parts.loose;
    var desc = words(cmd.description || '');
    var where = words(cmd.where || '');
    return {
      cmd: cmd,
      labelText: norm(cmd.label),
      label: label,
      syn: syn,
      synText: ' ' + syn.join(' ') + ' ',
      names: parts.names,
      desc: desc,
      where: where,
      initials: initials(label),
      key: norm(cmd.shortcut || '').replace(/ /g, '')
    };
  }

  /* Score one prepared command against a query. 0 means "not a match". */
  function score(p, q, recentRank) {
    var qn = norm(q);
    if (!qn) return 0;
    var qw = queryWords(q);
    if (!qw.length) return 0;
    // Its keyboard shortcut, typed out ("shift+s", "ctrl+p").
    var compactKey = qn.replace(/ /g, '');
    if (p.key && compactKey.length >= 2 && compactKey === p.key) return 1.6;
    // Initials: "pa" for "print answers", "fs" for "full screen".
    if (qw.length === 1 && qw[0].length >= 2 && p.label.length >= 2 && p.initials === qw[0]) {
      return 1.05 + (typeof recentRank === 'number' && recentRank >= 0 ? 0.06 * (1 - recentRank / RECENT_MAX) : 0);
    }
    var total = 0, counted = 0;
    for (var i = 0; i < qw.length; i++) {
      var w = qw[i];
      var s = Math.max(
        bestIn(w, p.label) * W_LABEL,
        bestIn(w, p.syn) * W_SYN,
        bestIn(w, p.desc) * W_DESC,
        bestIn(w, p.where) * W_WHERE
      );
      if (s <= 0) {
        if (SOFT[w] && qw.length > 1) continue;   // "open the calculator"
        return 0;                                // every other word must match something
      }
      total += s;
      counted++;
    }
    if (!counted) return 0;
    var sc = total / counted;
    // Drop forgiven verbs from the phrase too, so "open calculator" still
    // earns the whole-name bonus.
    var phrase = qw.filter(function (w) {
      return !(SOFT[w] && qw.length > 1 && bestIn(w, p.label) <= 0 && bestIn(w, p.syn) <= 0);
    });
    if (phrase.length) qw = phrase;

    // The whole phrase, as typed, in the name or a synonym.
    var qj = qw.join(' ');
    var lj = p.label.filter(function (w) { return !STOP[w]; }).join(' ');
    if (p.labelText === qn || lj === qj || p.names.indexOf(qj) !== -1) sc += 0.8;
    else if (lj.indexOf(qj + ' ') === 0) sc += 0.45;                 // the label's first word(s)
    else if ((' ' + lj + ' ').indexOf(' ' + qj + ' ') !== -1) sc += 0.3;   // whole word(s) inside it
    else if (lj.indexOf(qj) === 0) sc += 0.12;                       // only the start of a word
    else if (p.names.some(function (n) { return n.indexOf(qj + ' ') === 0 || n.indexOf(qj) === 0; })) sc += 0.2;
    if (qw.length > 1 && p.synText.indexOf(' ' + qj + ' ') !== -1) sc += 0.35;
    else if (qw.length === 1 && p.synText.indexOf(' ' + qj + ' ') !== -1) sc += 0.12;



    // A small lift for what this person used lately — never enough to lift a
    // weak match over a strong one.
    if (typeof recentRank === 'number' && recentRank >= 0) sc += 0.06 * (1 - recentRank / RECENT_MAX);
    return sc;
  }

  /* Rank commands for a query. With no query, the recent ones first. */
  function rank(prepared, q, recent, max) {
    var limit = max || MAX_RESULTS;
    var rec = recent || [];
    if (!norm(q)) {
      var byKey = {};
      prepared.forEach(function (p) { byKey[p.cmd.key] = p; });
      var out = [];
      rec.forEach(function (k) { if (byKey[k] && out.length < limit) out.push({ p: byKey[k], score: 1 }); });
      return out;
    }
    var hits = [];
    prepared.forEach(function (p, i) {
      var s = score(p, q, rec.indexOf(p.cmd.key));
      if (s > 0.28) hits.push({ p: p, score: s, i: i });
    });
    hits.sort(function (a, b) { return b.score - a.score || a.i - b.i; });
    // When something matches well, the stragglers far below it are noise.
    if (hits.length && hits[0].score >= 1.2) {
      var floor = hits[0].score * 0.4;
      hits = hits.filter(function (h) { return h.score >= floor; });
    }
    // The same button reachable two ways (a menu item and its copy when the
    // tools are expanded) is offered once.
    var seen = {}, res = [];
    for (var j = 0; j < hits.length && res.length < limit; j++) {
      var k = hits[j].p.cmd.key;
      if (seen[k]) continue;
      seen[k] = 1;
      res.push(hits[j]);
    }
    return res;
  }

  /* Which parts of a label to mark for a query (pure; ranges into label). */
  function markRanges(label, q) {
    var text = String(label || '');
    var low = text.toLowerCase();
    var ranges = [];
    queryWords(q).forEach(function (w) {
      if (w.length < 1) return;
      var re = new RegExp('(^|[^a-z0-9])(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'g');
      var m;
      while ((m = re.exec(low))) {
        var start = m.index + m[1].length;
        ranges.push([start, start + m[2].length]);
        if (re.lastIndex === m.index) re.lastIndex++;
      }
    });
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    ranges.forEach(function (r) {
      var last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([r[0], r[1]]);
    });
    return merged;
  }

  /* Recent commands, newest first, bounded (pure). */
  function pushRecent(list, key) {
    var out = (list || []).filter(function (k) { return k !== key; });
    out.unshift(key);
    return out.slice(0, RECENT_MAX);
  }

  /* A button's name, from what it already says about itself (pure).
     In order: the words painted on it (`.btnLabel`, `data-label`), unless
     its tooltip's first clause is short and says the same thing more fully
     ("Print answers" over a label that reads "Answers"); then a short
     tooltip; then its own text with any shortcut badge left out; then the
     tooltip cut to length. */
  function labelFrom(attrs) {
    var painted = String(attrs.btnLabel || attrs.dataLabel || '').replace(/\s+/g, ' ').trim();
    var tip = String(attrs.tip || attrs.aria || '').replace(/\s+/g, ' ').trim();
    var text = String(attrs.text || '').replace(/\s+/g, ' ').trim();
    var head = tip.split(/\s+[—–]\s+|\s-\s|\.\s/)[0].trim();
    var textWords = text.replace(/[^A-Za-z0-9 &·:'’]+/g, ' ').replace(/\s+/g, ' ').trim();
    function within(small, big) {
      var b = words(big);
      var sm = words(small);
      return sm.length > 0 && sm.every(function (w) { return b.indexOf(w) !== -1; });
    }
    if (painted) {
      // The tooltip's first clause, when it is short and says more: "Print
      // answers" over "Answers", "Award marks" over "Reward".
      if (head && head.length <= 28 &&
          (within(painted, head) || words(head).length > words(painted).length)) return head;
      return painted;
    }
    if (head && head.length <= 40) return head;
    if (textWords.length >= 2 && textWords.length <= 32 && !/^\d+$/.test(textWords)) return textWords;
    if (head) return head.length > 48 ? head.slice(0, 46).replace(/\s+\S*$/, '') + '…' : head;
    return textWords;
  }

  var pure = {
    norm: norm, stem: stem, words: words, queryWords: queryWords,
    editDistance: editDistance, subsequence: subsequence, wordScore: wordScore,
    prepare: prepare, splitSynonyms: splitSynonyms, score: score, rank: rank, markRanges: markRanges,
    pushRecent: pushRecent, labelFrom: labelFrom,
    SYNONYMS: SYNONYMS, MENU_NAMES: MENU_NAMES, MAX_RESULTS: MAX_RESULTS,
    RECENT_KEY: RECENT_KEY, RECENT_MAX: RECENT_MAX
  };

  /* ------------------------------------------------------------------
     The page half
     ------------------------------------------------------------------ */
  function create(env) {
    env = env || {};
    var doc = env.document || document;
    var root = null, input = null, listEl = null, emptyEl = null, hintEl = null;
    var commands = [], prepared = [], results = [], active = 0;
    var lastFocus = null;
    var memRecent = [];

    function readRecent() {
      try {
        var v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
        return Array.isArray(v) ? v.filter(function (k) { return typeof k === 'string'; }).slice(0, RECENT_MAX) : memRecent;
      } catch (e) { return memRecent; }
    }
    function writeRecent(list) {
      memRecent = list;
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) { /* memory only */ }
    }

    /* Is this button there for this person? Hidden by its role (display:none
       on itself or a container) means no. Hidden only because its dropdown is
       closed, or the toolbar is folded away, still means yes. */
    function available(el) {
      if (!el || el.disabled) return false;
      if (el.closest('#cmdSearch, #favBar, #tooltip')) return false;
      var n = el;
      while (n && n !== doc.body) {
        if (n.classList && (n.classList.contains('toolbarMenuPanel') || n.id === 'toolbar' || n.id === 'appsPanel')) {
          n = n.parentElement;
          continue;
        }
        if (n.hidden) return false;
        var cs = (doc.defaultView || window).getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        n = n.parentElement;
      }
      return true;
    }

    function keyOf(el) {
      var t = el.getAttribute('data-tool');
      if (t) return 'tool:' + t;
      if (el.id) return '#' + el.id;
      var c = el.getAttribute('data-color');
      if (c) return 'color:' + c.toLowerCase();
      var d = el.getAttribute('data-dash');
      if (d) return 'dash:' + d;
      var h = el.getAttribute('data-heads');
      if (h) return 'heads:' + h;
      if (el.hasAttribute('data-pwa-install')) return 'pwa:install';
      var txt = norm(el.textContent).replace(/\s+/g, ' ');
      return txt ? 'text:' + txt : '';
    }

    function whereOf(el) {
      var panel = el.closest('.toolbarMenuPanel');
      if (panel && MENU_NAMES[panel.id]) return 'in the ' + MENU_NAMES[panel.id];
      if (el.closest('#studentBar')) return 'in the start-here bar';
      if (el.closest('.polymath-header')) return 'at the top';
      if (el.closest('#toolbar')) return 'on the toolbar';
      return '';
    }

    /* The icon a result shows: the button's own picture, copied. */
    function iconOf(el) {
      var svg = el.querySelector('svg');
      if (svg) return { svg: svg.cloneNode(true) };
      var c = el.getAttribute('data-color');
      if (c) return { swatch: c };
      var t = String(el.textContent || '').trim();
      var m = t.match(/^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)/u);
      if (m) return { emoji: m[1] };
      return { emoji: '•' };
    }

    function collect() {
      var seen = {};
      var out = [];
      var sel = '#toolbar button, .polymath-header button, #studentBar button, #authArea button';
      doc.querySelectorAll(sel).forEach(function (el) {
        if (el.classList.contains('cmdSearchBtn')) return;
        if (el.classList.contains('toolbarMenuBtn') && el.getAttribute('data-toolbar-menu') === 'colorMenu') {
          // The colour trigger is fine to find; its chips are offered too.
        }
        if (!available(el)) return;
        var key = keyOf(el);
        if (!key || seen[key]) return;
        var tip = el.getAttribute('data-tip') || el.getAttribute('title') || '';
        var bl = el.querySelector('.btnLabel');
        var plain = el.cloneNode(true);
        plain.querySelectorAll('kbd, svg').forEach(function (k) { k.remove(); });
        var label = labelFrom({
          btnLabel: bl ? bl.textContent : '',
          dataLabel: el.getAttribute('data-label'),
          tip: tip,
          aria: el.getAttribute('aria-label'),
          text: plain.textContent
        });
        if (!label) return;
        if (key.indexOf('color:') === 0) label = 'Colour: ' + label;
        seen[key] = 1;
        out.push({
          key: key,
          el: el,
          label: label,
          description: tip && tip !== label ? tip : '',
          shortcut: el.getAttribute('data-key') || '',
          where: whereOf(el),
          synonyms: SYNONYMS[key] || '',
          icon: iconOf(el)
        });
      });
      return out;
    }

    function build() {
      if (root) return;
      root = doc.createElement('div');
      root.id = 'cmdSearch';
      root.className = 'cmdBack';
      root.hidden = true;
      root.innerHTML =
        '<div class="cmdCard" role="dialog" aria-modal="true" aria-label="Search every button">' +
          '<div class="cmdField">' +
            '<span class="cmdGlass" aria-hidden="true">🔎</span>' +
            '<input type="text" class="cmdInput" id="cmdInput" autocomplete="off" spellcheck="false"' +
              ' placeholder="Search for a button — try lasso, rubber, print answers…"' +
              ' role="combobox" aria-expanded="true" aria-controls="cmdList" aria-autocomplete="list">' +
            '<kbd class="cmdEsc">Esc</kbd>' +
          '</div>' +
          '<div class="cmdList" id="cmdList" role="listbox"></div>' +
          '<div class="cmdEmpty" id="cmdEmpty" hidden></div>' +
          '<div class="cmdHint" id="cmdHint">↑ ↓ to move · Enter to press · Esc to close</div>' +
        '</div>';
      doc.body.appendChild(root);
      input = root.querySelector('#cmdInput');
      listEl = root.querySelector('#cmdList');
      emptyEl = root.querySelector('#cmdEmpty');
      hintEl = root.querySelector('#cmdHint');

      input.addEventListener('input', function () { active = 0; refresh(); });
      // Every key typed here stops here: "lasso" must never reach the L, A
      // and S tool shortcuts behind the box.
      root.addEventListener('keydown', function (e) {
        if (root.hidden) return;          // a closed box keeps nothing
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); move(1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); return; }
        if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); active = 0; paintActive(); return; }
        if (e.key === 'Tab') { e.preventDefault(); move(e.shiftKey ? -1 : 1); return; }
        if (e.key === 'Enter') { e.preventDefault(); choose(active); return; }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); close(); }
      });
      root.addEventListener('keyup', function (e) { e.stopPropagation(); });
      root.addEventListener('keypress', function (e) { e.stopPropagation(); });
      root.addEventListener('pointerdown', function (e) {
        if (e.target === root) { e.preventDefault(); close(); }
      });
    }

    function move(d) {
      if (!results.length) return;
      active = (active + d + results.length) % results.length;
      paintActive();
    }

    function paintActive() {
      var rows = listEl.querySelectorAll('.cmdRow');
      rows.forEach(function (r, i) {
        var on = i === active;
        r.classList.toggle('active', on);
        r.setAttribute('aria-selected', String(on));
        if (on) {
          input.setAttribute('aria-activedescendant', r.id);
          if (r.scrollIntoView) r.scrollIntoView({ block: 'nearest' });
        }
      });
    }

    function appendMarked(parent, text, q) {
      var ranges = markRanges(text, q);
      var at = 0;
      ranges.forEach(function (r) {
        if (r[0] > at) parent.appendChild(doc.createTextNode(text.slice(at, r[0])));
        var m = doc.createElement('mark');
        m.textContent = text.slice(r[0], r[1]);
        parent.appendChild(m);
        at = r[1];
      });
      if (at < text.length) parent.appendChild(doc.createTextNode(text.slice(at)));
    }

    function iconNode(icon) {
      var span = doc.createElement('span');
      span.className = 'cmdIcon';
      span.setAttribute('aria-hidden', 'true');
      if (icon.svg) span.appendChild(icon.svg.cloneNode(true));
      else if (icon.swatch) {
        var sw = doc.createElement('span');
        sw.className = 'cmdSwatch';
        sw.style.background = icon.swatch;
        span.appendChild(sw);
      } else span.textContent = icon.emoji || '•';
      return span;
    }

    function refresh() {
      var q = input.value;
      var recent = readRecent();
      results = rank(prepared, q, recent, MAX_RESULTS);
      listEl.innerHTML = '';
      results.forEach(function (r, i) {
        var c = r.p.cmd;
        var row = doc.createElement('button');
        row.type = 'button';
        row.className = 'cmdRow';
        row.id = 'cmdRow' + i;
        row.setAttribute('role', 'option');
        row.setAttribute('data-cmd', c.key);
        row.appendChild(iconNode(c.icon));
        var body = doc.createElement('span');
        body.className = 'cmdText';
        var name = doc.createElement('span');
        name.className = 'cmdName';
        appendMarked(name, c.label, q);
        body.appendChild(name);
        var sub = doc.createElement('span');
        sub.className = 'cmdSub';
        var bits = [];
        if (c.where) bits.push(c.where);
        if (c.description) bits.push(c.description);
        sub.textContent = bits.join(' · ');
        if (bits.length) body.appendChild(sub);
        row.appendChild(body);
        if (c.shortcut) {
          var k = doc.createElement('kbd');
          k.className = 'cmdKey';
          k.textContent = c.shortcut;
          row.appendChild(k);
        }
        // A real movement of the pointer picks a row — not the list being
        // redrawn under a pointer that happens to be resting there.
        row.addEventListener('pointermove', function () {
          if (active !== i) { active = i; paintActive(); }
        });
        // The field keeps the focus while a row is pressed, so the arrow keys
        // and typing carry on working.
        row.addEventListener('pointerdown', function (e) { e.preventDefault(); });
        row.addEventListener('click', function (e) { e.preventDefault(); choose(i); });
        listEl.appendChild(row);
      });
      var hasQ = !!norm(q);
      emptyEl.hidden = results.length > 0;
      if (!results.length) {
        emptyEl.textContent = hasQ
          ? 'No button matches “' + q.trim() + '”. Try another word — “draw”, “print”, “zoom”, “marks”…'
          : 'Type what you want to do — “lasso”, “rubber”, “print answers”, “spin names”, “mind map”…';
      }
      listEl.hidden = !results.length;
      hintEl.textContent = hasQ || results.length
        ? '↑ ↓ to move · Enter to press · Esc to close'
        : 'Ctrl+K or / opens this from anywhere';
      if (!hasQ && results.length) {
        var head = doc.createElement('div');
        head.className = 'cmdSection';
        head.textContent = 'Recently used';
        listEl.insertBefore(head, listEl.firstChild);
      }
      if (active >= results.length) active = 0;
      paintActive();
    }

    function flash(el) {
      if (!el || !el.getBoundingClientRect) return;
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;      // inside a closed menu: nothing to point at
      el.classList.remove('cmdFlash');
      void el.offsetWidth;
      el.classList.add('cmdFlash');
      setTimeout(function () { el.classList.remove('cmdFlash'); }, 1600);
    }

    function choose(i) {
      var r = results[i];
      if (!r) return;
      var c = r.p.cmd;
      writeRecent(pushRecent(readRecent(), c.key));
      close(true);
      var el = c.el;
      // The page may have changed under the box (a role change, a redraw):
      // press the button only if it is still there for this person.
      if (!el || !doc.contains(el) || !available(el)) {
        if (env.toast) env.toast('That button is not available right now.');
        return;
      }
      if (env.beforePress) { try { env.beforePress(c); } catch (e) { /* never block the press */ } }
      el.click();
      flash(el);
      if (env.onPress) { try { env.onPress(c); } catch (e) { /* presentation only */ } }
    }

    function open(seed) {
      build();
      lastFocus = root.contains(doc.activeElement) ? null : doc.activeElement;
      commands = collect();
      prepared = commands.map(prepare);
      root.hidden = false;
      doc.body.classList.add('cmdOpen');
      input.value = typeof seed === 'string' ? seed : '';
      active = 0;
      refresh();
      // Focus NOW, inside the key press that opened it: a quick typist's next
      // letter must land in the box, not on the tool shortcuts behind it.
      try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
      input.select();
    }

    function close(pressing) {
      if (!root || root.hidden) return;
      root.hidden = true;
      doc.body.classList.remove('cmdOpen');
      results = [];
      if (!pressing && lastFocus && lastFocus.focus && doc.contains(lastFocus) && !root.contains(lastFocus) &&
          lastFocus !== doc.body) {
        try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* gone */ }
      }
      if (doc.activeElement && root.contains(doc.activeElement)) {
        // Never leave the focus inside a hidden box: the next key would be
        // swallowed there instead of reaching the page.
        doc.activeElement.blur();
      }
    }

    function isOpen() { return !!root && !root.hidden; }
    function toggle() { if (isOpen()) close(); else open(); }

    /* For the browser check: what the box would offer for a query. */
    function query(q) {
      var cmds = collect().map(prepare);
      return rank(cmds, q, readRecent(), MAX_RESULTS).map(function (r) {
        return { key: r.p.cmd.key, label: r.p.cmd.label, score: Math.round(r.score * 1000) / 1000 };
      });
    }

    return { open: open, close: close, toggle: toggle, isOpen: isOpen, query: query, collect: collect };
  }

  window.CommandSearch = { create: create, pure: pure };
})();
