/* =====================================================================
   📐 THE OBJECTIVE TABLE — one student's maths marks by learning
   objective, worksheet by worksheet (Ans Key v1.186.0)

   Study Buddy (polymathlc/tutor v1.77.0) files every maths question it
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
   - THE NUMBERS ARE PLAIN CODE. No model is asked anything.
   ===================================================================== */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.LoView = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
  'use strict';

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
    state.view = L.mount(body, {
      sheets: sheets, name: name, doc: document,
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

  return { open: open, close: closeView, count: count, pure: { sheetsOf: sheetsOf } };
});
