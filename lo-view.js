/* =====================================================================
   📐 THE OBJECTIVE TABLE — one student's maths marks by learning
   objective, worksheet by worksheet (Ans Key v1.186.0)

   Study Buddy (polymathlc/tutor v1.78.0) files every maths question it
   marks under ONE objective of the MOE Primary Mathematics Syllabus — the
   year printed on the paper first, then earlier years, never a later one —
   and keeps one small entry per marked worksheet on the student's roster
   row:

     studentProfiles/{uid}.tutorLos.{worksheetId}
       = { v, ws, sub: 'math', lvl, at, r: [{ l, k, p, q, x, g, a, s }] }

   This window reads that row and draws the dense table in lo-marks.js
   (byte for byte Study Buddy's file): objectives down the side, worksheets
   across the top in the order they were marked, every cell the marks got
   over the marks attempted, with subtotals per topic, the total, the rate
   and the trend — for intensive diagnostic tracking on one screen.

   - IT ONLY READS. Study Buddy is the one writer, from the student's own
     device. Nothing here writes the roster row.
   - THE TEACHER ONLY. Opened from the Students window (admin only), and
     `open` refuses again, because a handler is reachable from the console
     as well as from a button.
   - EVERYTHING IS textContent (lo-marks.js draws it so too): the rows were
     written on a child's device.
   - THE NUMBERS ARE PLAIN CODE. No model is asked anything to draw them.
   - ✏️ v1.187.0: every objective, topic and worksheet number is a door
     into lo-practice.js (byte for byte Study Buddy's file): the student's
     mistakes on it — read off the roster row's `tutorMistakes` mirror,
     maths only — each written again as a fresh practice question with its
     answer key and working (no algebra), sortable, printable as a sheet or
     a PDF. The model is the one Ans Key already uses, handed in by the
     Students window as `opts.ask`; this file never names it.
   ===================================================================== */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.LoView = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
  'use strict';

  function LP() {
    if (root && root.LoPractice) return root.LoPractice;
    if (typeof LoPractice !== 'undefined') return LoPractice; // eslint-disable-line no-undef
    return null;
  }

  /* ---- PURE: the student's maths mistakes, in lo-practice's shape ---- */
  function mistakesOf(profile) {
    var P = LP();
    if (!P || !profile) return [];
    var rows = Array.isArray(profile.tutorMistakes) ? profile.tutorMistakes : [];
    return P.norm(rows, 'math', 'mirror');
  }

  /* ✏️ The window over the mistakes behind some rows of the table. */
  function practise(groups, how) {
    var P = LP();
    var o = state.opts || {};
    if (!P || typeof o.ask !== 'function') {
      if (o.toast) o.toast('The practice window is not available here.');
      return;
    }
    var book = mistakesOf(state.profile);
    groups.forEach(function (g) {
      g.mistakes = book.filter(function (m) { return P.matches(m, g.sel); });
    });
    var name = (state.profile && state.profile.name) || 'This student';
    P.open({
      doc: document,
      title: how.title,
      printTitle: how.printTitle || '',
      subtitle: how.subtitle || ('Each of ' + name + '’s mistakes written again as a fresh question on the same skill, with the answer and the ' +
        'working in model drawing and units — never algebra. Print it, or choose “Save as PDF” in the print dialog.'),
      name: name,
      sub: 'math',
      level: how.level || '',
      groups: groups,
      sort: how.sort || 'weak',
      report: !!how.report,
      ask: o.ask,
      parse: o.parse,
      emptyText: how.emptyText || ''
    });
  }
  function hooks() {
    var L = LM();
    if (!L || !LP() || !state.opts || typeof state.opts.ask !== 'function') return {};
    return {
      onRow: function (r, kind) {
        var rows = kind === 'group' ? (r.rows || []) : [r];
        practise(rows.map(function (x) { return L.groupOf(x); }), {
          title: kind === 'group'
            ? '✏️ ' + (r.sub && r.sub !== r.topic ? r.sub + ' · ' : '') + r.topic + ' — practise the mistakes'
            : '✏️ ' + (r.id ? r.id + ' ' : '') + r.text,
          sort: kind === 'group' ? 'weak' : 'syllabus'
        });
      },
      onSheet: function (sheet) {
        if (!sheet) return;
        var groups = L.sheetGroups(sheet);
        groups.forEach(function (g) { g.sel = Object.assign({}, g.sel, { ws: sheet.ws }); });
        practise(groups, {
          report: true, sort: 'syllabus', level: sheet.lvl || '',
          title: '📐 ' + sheet.ws + ' — learning objective report',
          printTitle: sheet.ws + ' — learning objective report' + (state.profile && state.profile.name ? ' — ' + state.profile.name : ''),
          subtitle: 'Every objective this paper tested, with its marks. Tap a row to jump to its mistakes, each written again as a fresh ' +
            'practice question with the answer and working. ⬇ Export PDF prints it, or saves it as a PDF.'
        });
      },
      onPractice: function (model, how) {
        var sortMap = { weak: 'weak', weaktopic: 'weak', lost: 'lost', syllabus: 'syllabus' };
        practise(model.rows.map(function (x) { return L.groupOf(x); }), {
          sort: sortMap[how && how.sort] || 'weak',
          title: '✏️ Maths' + (how && how.level && how.level !== 'all' ? ' ' + how.level : '') + ' — every mistake as practice'
        });
      }
    };
  }

  function LM() {
    if (root && root.LoMarks) return root.LoMarks;
    if (typeof LoMarks !== 'undefined') return LoMarks; // eslint-disable-line no-undef
    return null;
  }

  var state = { el: null, open: false, uid: '', profile: null, opts: null, view: null };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---- PURE: what the roster row holds ---- */
  function sheetsOf(profile) {
    var L = LM();
    if (!L || !profile) return [];
    return L.sheetsOf(profile.tutorLos || {});
  }
  function count(profile) { return sheetsOf(profile).length; }

  function ensureShell() {
    if (state.el) return state.el;
    var back = el('div', 'loBack');
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    back.setAttribute('aria-labelledby', 'loViewTitle');
    var card = el('div', 'loCard');
    var head = el('div', 'loHead');
    var title = el('h2', 'loTitle', '📐 Objectives');
    title.id = 'loViewTitle';
    var print = el('button', 'loPrint', '🖨');
    print.type = 'button';
    print.title = 'Print the table';
    print.setAttribute('aria-label', 'Print the table');
    print.addEventListener('click', function () {
      document.body.classList.add('loPrinting');
      try { window.print(); } finally {
        setTimeout(function () { document.body.classList.remove('loPrinting'); }, 500);
      }
    });
    var close = el('button', 'loClose', '✕');
    close.type = 'button';
    close.title = 'Close';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', closeView);
    head.appendChild(title);
    head.appendChild(print);
    head.appendChild(close);
    var intro = el('div', 'loIntro');
    var body = el('div', 'loBody');
    card.appendChild(head);
    card.appendChild(intro);
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

  function render() {
    var back = ensureShell();
    var body = back.querySelector('.loBody');
    var title = back.querySelector('.loTitle');
    var intro = back.querySelector('.loIntro');
    var L = LM();
    var name = (state.profile && state.profile.name) || 'This student';
    title.textContent = '📐 ' + name + ' — maths marks by learning objective';
    intro.textContent = 'Every maths question Study Buddy marked, filed under the MOE syllabus objective it tests ' +
      '(the year printed on the paper first, earlier years only where none fits). Each column is one marked worksheet, ' +
      'oldest on the left.';
    if (!L) {
      body.innerHTML = '';
      body.appendChild(el('div', 'lmEmptyNote', 'The objective list (lo-marks.js) did not load.'));
      state.view = null;
      return;
    }
    if (!state.profile) {
      body.innerHTML = '';
      body.appendChild(el('div', 'lmEmptyNote', 'Loading…'));
      state.view = null;
      return;
    }
    var sheets = sheetsOf(state.profile);
    if (state.view) { state.view.update(sheets, name); return; }
    body.innerHTML = '';
    var h = hooks();
    state.view = L.mount(body, {
      sheets: sheets, name: name, doc: document,
      onRow: h.onRow, onSheet: h.onSheet, onPractice: h.onPractice,
      emptyText: 'No maths worksheet has been marked by objective yet. The table fills in after ' + name +
        '’s next maths worksheet is marked in Study Buddy, and papers marked earlier arrive the next time ' + name +
        ' opens Study Buddy.'
    });
  }

  /* opts: { db, uid, profile, isTeacher: fn, collection, toast }. The row
     the Students window already holds is drawn at once, then the LIVE row is
     read and drawn again — a list fetched minutes ago can be a paper behind. */
  function open(opts) {
    opts = opts || {};
    if (typeof opts.isTeacher === 'function' && !opts.isTeacher()) {
      if (opts.toast) opts.toast('Only the teacher can see a student’s objective marks.');
      return;
    }
    state.opts = opts;
    state.uid = String(opts.uid || '');
    state.profile = opts.profile || null;
    state.view = null;
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
        if (opts.toast) opts.toast('Could not load the latest objective marks: ' + ((e && e.message) || e));
      });
    }
  }

  return { open: open, close: closeView, count: count, pure: { sheetsOf: sheetsOf, mistakesOf: mistakesOf } };
});
