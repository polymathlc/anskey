/* =====================================================================
   🧩 THE GAP VIEW — one student's weak concepts, and whether they are
   getting better (Ans Key v1.185.0)

   Study Buddy (polymathlc/tutor v1.76.0) tags every wrong or partly right
   answer it marks with ONE concept tag from a fixed list (concept-tags.js,
   byte for byte the same file in both repos) and keeps one entry per
   marked worksheet on the student's roster row:

     studentProfiles/{uid}.tutorGaps.{worksheetId}
       = { ws, sub, lvl, at, n, w, tags: [{ t, q, why, v, top, p, mid }] }

   and its mistake mirror (`tutorMistakes`) now carries each mistake's id,
   tag and reason. This window reads both and shows the teacher, for ONE
   student: the top weak concepts, ranked by a recency-weighted count; the
   trend of each (by RATE per attempted question, older half of the papers
   against the newer half — never by raw count, so a busy month is not
   "getting worse"); and every actual mistake behind it, with the question
   picture where the mirror has one.

   - IT ONLY READS. Nothing here writes the roster row: Study Buddy is the
     one writer, from the student's own device.
   - THE TEACHER ONLY. It is opened from the Students window (admin only)
     and refuses in `open` again, because a handler is reachable from the
     console as well as from a button.
   - EVERYTHING IS textContent. The rows were written on a child's device,
     and a worksheet name or a reason is text, never markup. Pictures are
     drawn only from an https link.
   - THE NUMBERS ARE PLAIN CODE (`ConceptTags.summarize`). No model is asked
     to describe a student; the same rows give the same page every time.
   ===================================================================== */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.GapView = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
  'use strict';

  var TOP_N = 5;
  var MISTAKES_SHOWN = 12;

  function CT() {
    if (root && root.ConceptTags) return root.ConceptTags;
    if (typeof ConceptTags !== 'undefined') return ConceptTags; // eslint-disable-line no-undef
    return null;
  }
  function str(v, cap) {
    var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return cap && s.length > cap ? s.slice(0, cap) + '…' : s;
  }
  function httpsUrl(v) {
    var u = String(v == null ? '' : v).trim();
    return /^https:\/\//i.test(u) ? u : '';
  }

  /* ---- PURE: the words on the page ---- */

  /* "1 in 8 questions" — a rate a teacher reads at a glance. */
  function rateText(rate) {
    var r = Number(rate) || 0;
    if (!(r > 0)) return 'none';
    var one = Math.round(1 / r);
    if (one <= 1) return 'almost every question';
    return '1 in ' + one + ' questions';
  }
  function dateText(at) {
    var t = Number(at) || 0;
    if (!t) return '';
    var d = new Date(t);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    return d.toLocaleDateString(undefined, d.getFullYear() === now.getFullYear()
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' });
  }
  var SUBJECT_WORDS = { math: 'Maths', science: 'Science', english: 'English', chinese: 'Chinese' };
  function subjectWord(k) { return SUBJECT_WORDS[k] || 'Other'; }

  /* The mirror rows by mistake id, so a tagged slip can show its picture,
     what the student wrote and the answer. A row without an id is from
     before v1.76.0 and simply links nothing. */
  function mirrorIndex(profile) {
    var by = {};
    var rows = profile && Array.isArray(profile.tutorMistakes) ? profile.tutorMistakes : [];
    rows.forEach(function (r) {
      if (r && typeof r === 'object' && r.id) by[String(r.id)] = r;
    });
    return by;
  }

  /* EVERYTHING THE WINDOW DRAWS, as data — so the harness can hold the page
     to the rows without a browser. `subject` is a subject key or 'all'. */
  function viewModel(profile, subject, now) {
    var C = CT();
    if (!C) return { ok: false, reason: 'The concept list (concept-tags.js) did not load.' };
    var map = profile && profile.tutorGaps;
    var sum = C.summarize(map || {}, { subject: subject || 'all', now: now || Date.now() });
    var all = C.summarize(map || {}, { now: now || Date.now() });
    var mirror = mirrorIndex(profile);
    var gaps = sum.gaps.map(function (g, i) {
      var tw = C.trendWord(g.trend);
      return {
        rank: i + 1,
        tag: g.tag,
        label: g.label,
        fix: g.fix,
        n: g.n,
        sheets: g.sheetCount,
        trend: g.trend,
        trendWord: tw.word,
        trendIco: tw.ico,
        trendCls: tw.cls,
        before: g.trend === 'new' ? '' : rateText(g.rateBefore),
        after: g.trend === 'new' ? '' : rateText(g.rateAfter),
        last: g.last,
        cleanSince: g.cleanSince,
        subjects: g.subjects,
        // A gap's bars are the papers of ITS subject: a science paper drawn
        // as "not made" under a maths slip would read as progress it is not.
        bars: sum.timeline.filter(function (s) {
          return !g.subjects.length || !s.sub || g.subjects.indexOf(s.sub) >= 0;
        }).map(function (s) {
          var hits = 0;
          g.mistakes.forEach(function (m) { if (m.sheet === s.id) hits++; });
          return { ws: s.ws, at: s.at, hits: hits, n: s.n };
        }),
        mistakes: g.mistakes.map(function (m) {
          var row = m.mid ? mirror[m.mid] : null;
          return {
            ws: m.ws, at: m.at, q: m.q, why: m.why, v: m.v, top: m.top, p: m.p,
            mine: row ? str(row.mine, 400) : '',
            ans: row ? str(row.ans, 400) : '',
            img: row ? httpsUrl(row.img) : '',
            done: row ? !!row.done : false,
            linked: !!row
          };
        })
      };
    });
    return {
      ok: true,
      name: str(profile && profile.name, 80) || 'This student',
      sheets: sum.sheets,
      attempted: sum.attempted,
      wrong: sum.wrong,
      first: sum.first,
      latest: sum.latest,
      subjects: all.subjects,
      top: gaps.slice(0, TOP_N),
      rest: gaps.slice(TOP_N),
      empty: !sum.sheets
    };
  }

  /* ---- THE WINDOW ---- */
  var state = { el: null, uid: '', profile: null, subject: 'all', opts: null, open: false };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function ensureShell() {
    if (state.el) return state.el;
    var back = el('div', 'gapBack');
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    back.setAttribute('aria-labelledby', 'gapViewTitle');
    var card = el('div', 'gapCard');
    var head = el('div', 'gapHead');
    var title = el('h2', 'gapTitle', '🧩 Gaps');
    title.id = 'gapViewTitle';
    var close = el('button', 'gapClose', '✕');
    close.type = 'button';
    close.title = 'Close';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', closeView);
    head.appendChild(title);
    head.appendChild(close);
    var body = el('div', 'gapBody');
    card.appendChild(head);
    card.appendChild(body);
    back.appendChild(card);
    back.addEventListener('click', function (e) { if (e.target === back) closeView(); });
    document.addEventListener('keydown', function (e) {
      if (state.open && e.key === 'Escape') closeView();
    });
    document.body.appendChild(back);
    state.el = back;
    return back;
  }

  function closeView() {
    if (!state.el) return;
    state.el.classList.remove('open');
    state.open = false;
  }

  function trendBadge(g) {
    var b = el('span', 'gapTrend ' + g.trendCls, g.trendIco + ' ' + g.trendWord);
    if (g.trend !== 'new') b.title = 'Earlier papers: ' + g.before + ' · recent papers: ' + g.after;
    else b.title = 'Too few papers yet to say whether it is improving';
    return b;
  }

  /* One small bar per marked paper, oldest on the left: the height is how
     many times this gap turned up on it. Drawn with divs, labelled for a
     screen reader, so it needs no chart library. */
  function sparkNode(g) {
    var wrap = el('div', 'gapSpark');
    var max = 1;
    g.bars.forEach(function (b) { if (b.hits > max) max = b.hits; });
    var said = [];
    g.bars.forEach(function (b) {
      var bar = el('span', 'gapBar' + (b.hits ? '' : ' none'));
      bar.style.height = (b.hits ? Math.max(18, Math.round(100 * b.hits / max)) : 8) + '%';
      bar.title = (dateText(b.at) ? dateText(b.at) + ' · ' : '') + b.ws + ': ' +
        (b.hits ? b.hits + ' time' + (b.hits === 1 ? '' : 's') : 'not made');
      wrap.appendChild(bar);
      said.push(b.hits);
    });
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', 'Times per paper, oldest first: ' + said.join(', '));
    return wrap;
  }

  function mistakeRow(m) {
    var row = el('div', 'gapMist' + (m.done ? ' done' : ''));
    var top = el('div', 'gapMistTop');
    top.appendChild(el('span', 'gapMistQ', m.q ? 'Q' + m.q : 'Question'));
    top.appendChild(el('span', 'gapMistWs', m.ws));
    if (m.at) top.appendChild(el('span', 'gapMistAt', dateText(m.at)));
    if (m.v === 'partial') top.appendChild(el('span', 'gapMistV partial', 'Almost'));
    else top.appendChild(el('span', 'gapMistV wrong', 'Not quite'));
    if (m.done) top.appendChild(el('span', 'gapMistV done', 'Since got right'));
    row.appendChild(top);
    if (m.why) row.appendChild(el('div', 'gapMistWhy', m.why));
    if (m.mine || m.ans) {
      var pair = el('div', 'gapMistPair');
      if (m.mine) {
        var a = el('div', 'gapMistBox');
        a.appendChild(el('b', null, 'They wrote'));
        a.appendChild(el('span', null, m.mine));
        pair.appendChild(a);
      }
      if (m.ans) {
        var b = el('div', 'gapMistBox');
        b.appendChild(el('b', null, 'The answer'));
        b.appendChild(el('span', null, m.ans));
        pair.appendChild(b);
      }
      row.appendChild(pair);
    }
    if (m.img) {
      var link = el('a', 'gapMistPic');
      link.href = m.img;
      link.target = '_blank';
      link.rel = 'noopener';
      link.title = 'Open the question picture';
      var img = el('img');
      img.src = m.img;
      img.alt = 'The question' + (m.q ? ' Q' + m.q : '') + ' from ' + m.ws;
      img.loading = 'lazy';
      link.appendChild(img);
      row.appendChild(link);
    }
    return row;
  }

  function gapCardNode(g, open) {
    var card = el('div', 'gapItem');
    var head = el('div', 'gapItemHead');
    head.appendChild(el('span', 'gapRank', String(g.rank)));
    var words = el('div', 'gapItemWords');
    words.appendChild(el('b', 'gapItemLabel', g.label));
    var meta = g.n + ' time' + (g.n === 1 ? '' : 's') + ' in ' + g.sheets + ' paper' + (g.sheets === 1 ? '' : 's');
    if (g.last) meta += ' · last ' + dateText(g.last);
    if (g.cleanSince > 0) meta += ' · not made on the last ' + (g.cleanSince === 1 ? 'paper' : g.cleanSince + ' papers');
    words.appendChild(el('span', 'gapItemMeta', meta));
    head.appendChild(words);
    head.appendChild(trendBadge(g));
    card.appendChild(head);
    if (g.trend !== 'new') {
      card.appendChild(el('div', 'gapRate', 'Earlier papers: ' + g.before + ' → recent papers: ' + g.after));
    }
    card.appendChild(sparkNode(g));
    card.appendChild(el('div', 'gapItemFix', 'What Study Buddy tells them: ' + g.fix));
    var det = el('details', 'gapItemList');
    if (open) det.open = true;
    var sumN = el('summary', null, 'The ' + g.mistakes.length + ' mistake' + (g.mistakes.length === 1 ? '' : 's') + ' behind it');
    det.appendChild(sumN);
    var shown = g.mistakes.slice(0, MISTAKES_SHOWN);
    shown.forEach(function (m) { det.appendChild(mistakeRow(m)); });
    /* Said ONCE under the list rather than on every row: a slip whose card
       has since been deleted from the book (or was mirrored before its id
       travelled) still counts, it just has no picture to show. */
    var loose = shown.filter(function (m) { return !m.linked; }).length;
    if (loose) {
      det.appendChild(el('div', 'gapMistNote', loose === shown.length
        ? 'No pictures for these: their cards are no longer in the mistake book’s latest copy.'
        : loose + ' of these ' + (loose === 1 ? 'has' : 'have') + ' no picture: ' + (loose === 1 ? 'its card is' : 'their cards are') +
          ' no longer in the mistake book’s latest copy.'));
    }
    if (g.mistakes.length > MISTAKES_SHOWN) {
      det.appendChild(el('div', 'gapMistNote', '…and ' + (g.mistakes.length - MISTAKES_SHOWN) + ' older ones.'));
    }
    card.appendChild(det);
    return card;
  }

  function render() {
    var back = ensureShell();
    var body = back.querySelector('.gapBody');
    var title = back.querySelector('.gapTitle');
    body.innerHTML = '';
    if (!state.profile) {
      title.textContent = '🧩 Gaps';
      body.appendChild(el('div', 'gapEmpty', 'Loading…'));
      return;
    }
    var vm = viewModel(state.profile, state.subject, Date.now());
    if (!vm.ok) { body.appendChild(el('div', 'gapEmpty', vm.reason)); return; }
    title.textContent = '🧩 ' + vm.name + ' — weak concepts';
    if (vm.subjects.length > 1) {
      var chips = el('div', 'gapChips');
      ['all'].concat(vm.subjects).forEach(function (k) {
        var c = el('button', 'gapChip' + (state.subject === k ? ' on' : ''), k === 'all' ? 'All subjects' : subjectWord(k));
        c.type = 'button';
        c.setAttribute('aria-pressed', state.subject === k ? 'true' : 'false');
        c.addEventListener('click', function () { state.subject = k; render(); });
        chips.appendChild(c);
      });
      body.appendChild(chips);
    }
    if (vm.empty) {
      body.appendChild(el('div', 'gapEmpty',
        'No tagged mistakes yet. The gaps appear here after ' + vm.name + '’s next worksheet is marked in Study Buddy.'));
      return;
    }
    var intro = el('div', 'gapIntro');
    intro.textContent = 'From ' + vm.sheets + ' marked worksheet' + (vm.sheets === 1 ? '' : 's') +
      (vm.first ? ', ' + dateText(vm.first) + (vm.latest && vm.latest !== vm.first ? ' to ' + dateText(vm.latest) : '') : '') +
      ' · ' + vm.wrong + ' of ' + vm.attempted + ' attempted questions not fully right. ' +
      'Trends compare how often each gap turns up per question on the earlier papers against the recent ones.';
    body.appendChild(intro);
    if (!vm.top.length) {
      body.appendChild(el('div', 'gapEmpty', 'Every answer on these worksheets was right — no gaps to show.'));
      return;
    }
    body.appendChild(el('h3', 'gapH', 'Top weak concepts'));
    vm.top.forEach(function (g, i) { body.appendChild(gapCardNode(g, i === 0)); });
    if (vm.rest.length) {
      var more = el('details', 'gapMore');
      more.appendChild(el('summary', null, vm.rest.length + ' more gap' + (vm.rest.length === 1 ? '' : 's')));
      vm.rest.forEach(function (g) { more.appendChild(gapCardNode(g, false)); });
      body.appendChild(more);
    }
  }

  /* opts: { db, uid, profile, isTeacher: fn, collection, toast }. The row
     the Students window already holds is drawn at once, then the LIVE row is
     read and drawn again — a list fetched minutes ago can be a paper behind. */
  function open(opts) {
    opts = opts || {};
    if (typeof opts.isTeacher === 'function' && !opts.isTeacher()) {
      if (opts.toast) opts.toast('Only the teacher can see a student’s gaps.');
      return;
    }
    state.opts = opts;
    state.uid = String(opts.uid || '');
    state.profile = opts.profile || null;
    state.subject = 'all';
    var back = ensureShell();
    back.classList.add('open');
    state.open = true;
    render();
    var uid = state.uid;
    if (opts.db && uid) {
      opts.db.collection(opts.collection || 'studentProfiles').doc(uid).get().then(function (snap) {
        if (state.uid !== uid || !state.open) return;
        if (snap && snap.exists) { state.profile = snap.data() || {}; render(); }
      }).catch(function (e) {
        if (opts.toast) opts.toast('Could not load the latest gaps: ' + ((e && e.message) || e));
      });
    }
  }

  /* How many gaps a roster row holds, for the button's label — cheap, no
     summary, and a row from before v1.76.0 says 0. */
  function count(profile) {
    var C = CT();
    if (!C || !profile || !profile.tutorGaps) return 0;
    var n = 0;
    C.sheetsOf(profile.tutorGaps).forEach(function (s) { n += s.tags.length; });
    return n;
  }

  return {
    open: open,
    close: closeView,
    count: count,
    pure: { viewModel: viewModel, rateText: rateText, mirrorIndex: mirrorIndex, dateText: dateText, subjectWord: subjectWord }
  };
});
