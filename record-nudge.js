/* =====================================================================
   ⏺ Writing without recording — the "Not recording" nudge (v1.173.0, v1.174.0, v1.183.0)
   ---------------------------------------------------------------------
   Zhi Kai explains while writing, and a lesson that was never recorded is
   only found out about afterwards, when there is nothing left to record.
   So when the TEACHER writes on a saved worksheet and no lesson is going
   down, a small warning comes up over the top of the page:

       ● Not recording — your writing is not going into a lesson.
         [● Record now]  [Hide]
         ☐ Ignore for this session                       Don't warn me

   ● Record now presses the app's own record button (the glue's `record`,
   which is `lessonOpen`): the Record lesson window opens on the camera and
   microphone the teacher last chose, with Start lit up. Nothing here opens
   a microphone, a camera or a share, and nothing here starts a recorder:
   every one of those has rules (the iPad gives a device to one capture at a
   time, a window share must be asked for inside the tap, a remembered camera
   that is not plugged in must be named) and they all live in the recorder.

   THE RULES THIS FILE KEEPS
   - It is the TEACHER's (`env.teacher()`, which is `lessonTeacher()`):
     never a student, a share-link visitor, a handed-over device or practice
     mode — in practice the ink on the page is a CHILD's attempt.
   - It never interrupts. It does not take the focus, it does not stop a
     stroke, it does not swallow a key the page needs, and it never covers
     the toolbar. It sits at the top of the worksheet's own area.
   - v1.183.0: IT NEVER GIVES UP BY ITSELF. Zhi Kai forgot to record again
     after the card had quietly gone away. Now ANY mark — one stroke, one
     typed word (`STROKES` is 1) — brings it up, and it stays up until a
     recording starts. Nothing times it out (`SHOW_MS` is 0, `IDLE_SNOOZE_MS`
     0) and nothing snoozes it (`LATER_SNOOZE_MS`, `RECORD_SNOOZE_MS` 0):
     "Hide" (and Escape) put it away only until the next mark, and so does
     Record now when the Record window is closed without starting.
   - It steps aside, never away: while the Record window is open, while
     another dialog is in front of the page, during playback, and when the
     person or the worksheet changes. The next mark after that brings it back.
   - It STOPS only when the teacher says so: ☐ Ignore for this session (this
     tab) or "Don't warn me" (this device; the Record lesson window has the
     switch to turn it back on). Those two switches are the only things
     written to storage (`SESSION_KEY`, `PREF_KEY`), and a blocked storage
     keeps them for the visit instead.

   The decisions are PURE (`pure.gate`, `pure.step`) so
   `tools/record-nudge-tests.mjs` can walk every rule without a page, and the
   DOM half only draws what `step` says.
   ===================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------------
     Numbers. Each one is a judgement about a teacher mid-lesson.
     --------------------------------------------------------------------- */
  // v1.174.0: two marks in a minute (was three in 45 s).
  // v1.183.0: ONE mark — any stroke or any typing — and no time-out or
  // snooze at all. Zhi Kai forgot to record again after the card had gone
  // away by itself; the only things that stop it now are a recording and the
  // two switches the teacher ticks.
  var STROKES = 1;                       // marks before it is "writing"
  var WINDOW_MS = 60 * 1000;             // …within this long
  var SHOW_MS = 0;                       // 0 = it never goes away by itself
  var IDLE_SNOOZE_MS = 0;                // …so there is no idle snooze
  var LATER_SNOOZE_MS = 0;               // "Hide": only until the next mark
  var RECORD_SNOOZE_MS = 0;              // Record now, window closed: next mark
  var MARKS_MAX = 32;                    // the mark list never grows without end
  var SNOOZE_MAX = 64;                   // nor does the snooze map
  var PREF_KEY = 'polymath.recordNudge.v1';
  // "Ignore for this session": this tab only (sessionStorage survives a
  // reload of the same tab and ends when the tab or the app is closed).
  var SESSION_KEY = 'polymath.recordNudge.session.v1';
  var UNSAVED_DOC = 'unsaved';           // the snooze key for a sheet with no id yet
  var GAP_PX = 12;                       // from the top of the worksheet area

  // What counts as WRITING: the lesson recorder's own list (LESSON_TYPES).
  // A picture, a card, a lasso or an eraser pass is arranging, not writing.
  var INK_TYPES = ['pen', 'highlight', 'text', 'rect', 'ellipse', 'line', 'arrow', 'brace'];

  // Why it is NOT asking, in the order they are checked. The browser check and
  // the harness read these words, so they are part of the contract.
  //
  // v1.174.0 took three gates OUT, because each one could keep the warning
  // away for a whole lesson with nothing on screen saying why:
  //   - 'pending'  a lesson from earlier waiting to be saved (or a device
  //                backup of one) is not a recording — the teacher writing
  //                now is still not being recorded;
  //   - 'unsaved'  a worksheet that has not been saved yet is exactly where a
  //                lesson is most easily lost — the card says to save first;
  //   - any open dialog — a stroke that reached the page proves nothing was
  //                in front of it. Only the Record window itself (and the
  //                export window) stop a mark counting; any other dialog only
  //                takes a card that is already up off the screen.
  var WHY = {
    off: 'off',                  // the teacher said "Don't warn me"
    session: 'session-off',      // "Ignore for this session" is ticked
    teacher: 'not-teacher',      // a student, a visitor, practice, a handover
    recording: 'recording',      // a lesson is going down — the whole point
    playback: 'playback',        // a lesson is being watched
    window: 'window-open',       // the Record window (or the export) is up
    dialog: 'dialog-open',       // another dialog came up over a card already shown
    pages: 'no-pages',           // no worksheet open at all
    ink: 'not-ink'               // what was made is not writing
  };

  /* ---------------------------------------------------------------------
     Pure helpers
     --------------------------------------------------------------------- */
  function isInk(ann) {
    return !!ann && typeof ann === 'object' && INK_TYPES.indexOf(ann.type) !== -1;
  }

  // One worksheet for one person: a snooze given on one sheet, or by one
  // account, is never read on another. A sheet not saved yet is keyed
  // UNSAVED_DOC, so a snooze works on it too (it used to have no key at all,
  // and a snooze with no key was never kept).
  function docKey(uid, docId) {
    if (!uid) return '';
    return String(uid) + '/' + String(docId || UNSAVED_DOC);
  }

  // Only marks inside the window count, oldest first, never more than MARKS_MAX.
  function trimMarks(marks, now, windowMs) {
    var w = typeof windowMs === 'number' ? windowMs : WINDOW_MS;
    var out = [];
    (Array.isArray(marks) ? marks : []).forEach(function (t) {
      if (typeof t === 'number' && isFinite(t) && t <= now && now - t <= w) out.push(t);
    });
    out.sort(function (a, b) { return a - b; });
    return out.slice(-MARKS_MAX);
  }

  // A snooze map with the expired entries dropped and the size bounded
  // (the latest-ending kept), so a long day of worksheets costs nothing.
  function pruneSnooze(map, now) {
    var keys = Object.keys(map || {}).filter(function (k) {
      var t = map[k];
      return typeof t === 'number' && isFinite(t) && t > now;
    });
    keys.sort(function (a, b) { return map[b] - map[a]; });
    var out = {};
    keys.slice(0, SNOOZE_MAX).forEach(function (k) { out[k] = map[k]; });
    return out;
  }

  function snoozedUntil(state, key, now) {
    var t = state && state.snooze && state.snooze[key];
    return typeof t === 'number' && t > now ? t : 0;
  }

  // The off switch as it is stored: '0' is off, anything else (or nothing) on.
  function cleanPref(raw) {
    if (raw === '0' || raw === 0 || raw === false || raw === 'off') return { on: false };
    return { on: true };
  }

  // The session switch as it is stored: '1' is "ignored for this session".
  function cleanSession(raw) {
    return raw === '1' || raw === 1 || raw === true;
  }

  // What the card's second line says. A sheet with no id cannot carry a
  // lesson yet, so the card says what to do about that rather than nothing.
  function subText(saved) {
    return saved ? 'Your writing is not going into a lesson.'
      : 'Your writing is not going into a lesson — save this worksheet to record one.';
  }

  /* gate(ctx) → '' when a mark may count, otherwise WHY it may not.
     ctx: { on, session, teacher, recording, playback, windowOpen, pages, ann }
     — every field read as a plain truthy flag. `pending`, `docId` and
     `dialog` are deliberately NOT read here (see WHY above). */
  function gate(ctx) {
    var c = ctx || {};
    if (c.on === false) return WHY.off;
    if (c.session) return WHY.session;
    if (!c.teacher) return WHY.teacher;
    if (c.recording) return WHY.recording;
    if (c.playback) return WHY.playback;
    if (c.windowOpen) return WHY.window;
    if (!c.pages) return WHY.pages;
    if ('ann' in c && !isInk(c.ann)) return WHY.ink;
    return '';
  }

  /* standWhy(ctx) → why a card ALREADY UP must go: everything gate() says,
     plus any other dialog coming up over the page. */
  function standWhy(ctx) {
    var w = gate(ctx);
    if (w) return w;
    return ctx && ctx.dialog ? WHY.dialog : '';
  }

  function initialState() {
    return { key: '', marks: [], shown: false, shownAt: 0, snooze: {}, shows: 0, last: '' };
  }

  function copy(state) {
    var s = state || initialState();
    return {
      key: s.key || '', marks: (s.marks || []).slice(), shown: !!s.shown, shownAt: s.shownAt || 0,
      snooze: Object.assign({}, s.snooze || {}), shows: s.shows || 0, last: s.last || ''
    };
  }

  /* step(state, event) → { state, effect }
     The ONE place the nudge decides anything. effect is 'show', 'hide' or ''.

     events:
       { type:'ink', now, key, why }      a mark was made ('' why = it counts)
       { type:'context', now, key, why }  something changed around it
       { type:'tick', now }               the clock (SHOW_MS 0 = never hides)
       { type:'later', now }              "Hide" (until the next mark)
       { type:'record', now }             "Record now"
       { type:'off' } / { type:'on' }     the device switch
  */
  function step(state, ev) {
    var s = copy(state), e = ev || {}, now = typeof e.now === 'number' ? e.now : 0;
    var hide = function (snoozeMs) {
      if (snoozeMs && s.key) s.snooze[s.key] = Math.max(s.snooze[s.key] || 0, now + snoozeMs);
      s.snooze = pruneSnooze(s.snooze, now);
      s.marks = [];
      var was = s.shown;
      s.shown = false; s.shownAt = 0;
      return { state: s, effect: was ? 'hide' : '' };
    };

    switch (e.type) {
      case 'ink': {
        // Another worksheet or another person: start counting again.
        if (e.key !== s.key) { s.key = e.key || ''; s.marks = []; }
        if (e.why) {
          s.last = e.why;
          // A recording starting (or anything else that makes asking wrong)
          // takes a warning that is up off the screen.
          return s.shown ? hide(0) : { state: s, effect: '' };
        }
        s.last = '';
        if (s.shown) {
          // Still writing with it up: it stays, and the clock starts again so
          // it is not taken away from under a teacher who is reading it.
          s.shownAt = now;
          return { state: s, effect: '' };
        }
        if (snoozedUntil(s, s.key, now)) { s.last = 'snoozed'; return { state: s, effect: '' }; }
        s.marks = trimMarks(s.marks.concat([now]), now, WINDOW_MS);
        if (s.marks.length >= STROKES) {
          s.shown = true; s.shownAt = now; s.shows++; s.marks = [];
          return { state: s, effect: 'show' };
        }
        return { state: s, effect: '' };
      }
      case 'context': {
        if (e.key !== s.key) {
          // The worksheet or the person changed: a warning about the old one
          // must not stand over the new one.
          var r = hide(0); r.state.key = e.key || ''; return r;
        }
        if (e.why) { s.last = e.why; return s.shown ? hide(0) : { state: s, effect: '' }; }
        return { state: s, effect: '' };
      }
      case 'tick':
        if (SHOW_MS > 0 && s.shown && now - s.shownAt >= SHOW_MS) return hide(IDLE_SNOOZE_MS);
        return { state: s, effect: '' };
      case 'later':
        return hide(LATER_SNOOZE_MS);
      case 'record':
        return hide(RECORD_SNOOZE_MS);
      case 'off':
        s.last = WHY.off;
        return hide(0);
      case 'session':
        s.last = WHY.session;
        return hide(0);
      case 'on':
        s.last = ''; s.marks = [];
        return { state: s, effect: '' };
      default:
        return { state: s, effect: '' };
    }
  }

  // Where the box goes: centred over the worksheet's own area, GAP_PX under
  // its top edge, and never off the screen at either side.
  function place(area, box, vw) {
    var a = area || { left: 0, top: 0, width: vw || 0 };
    var w = Math.max(0, (box && box.width) || 0);
    var view = typeof vw === 'number' && vw > 0 ? vw : (a.left + a.width);
    var left = a.left + (a.width - w) / 2;
    left = Math.max(8, Math.min(left, view - w - 8));
    return { left: Math.round(left), top: Math.round((a.top || 0) + GAP_PX) };
  }

  var pure = {
    STROKES: STROKES, WINDOW_MS: WINDOW_MS, SHOW_MS: SHOW_MS, IDLE_SNOOZE_MS: IDLE_SNOOZE_MS,
    LATER_SNOOZE_MS: LATER_SNOOZE_MS, RECORD_SNOOZE_MS: RECORD_SNOOZE_MS, MARKS_MAX: MARKS_MAX,
    SNOOZE_MAX: SNOOZE_MAX, PREF_KEY: PREF_KEY, SESSION_KEY: SESSION_KEY, UNSAVED_DOC: UNSAVED_DOC,
    GAP_PX: GAP_PX, INK_TYPES: INK_TYPES.slice(), WHY: WHY,
    isInk: isInk, docKey: docKey, trimMarks: trimMarks, pruneSnooze: pruneSnooze,
    snoozedUntil: snoozedUntil, cleanPref: cleanPref, cleanSession: cleanSession, subText: subText,
    gate: gate, standWhy: standWhy, initialState: initialState, step: step, place: place
  };

  /* ---------------------------------------------------------------------
     The box
     --------------------------------------------------------------------- */
  var memoryPref = null;   // where storage is blocked, the switch lives here
  var memorySession = null; // and the session switch here

  function readPref() {
    try {
      var raw = window.localStorage.getItem(PREF_KEY);
      if (raw !== null) return cleanPref(raw);
    } catch (e) {}
    return memoryPref || { on: true };
  }
  function readSession() {
    try {
      var raw = window.sessionStorage.getItem(SESSION_KEY);
      if (raw !== null) return cleanSession(raw);
    } catch (e) {}
    return !!memorySession;
  }
  function writeSession(ignored) {
    memorySession = !!ignored;
    try {
      if (ignored) window.sessionStorage.setItem(SESSION_KEY, '1');
      else window.sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }
  function writePref(on) {
    memoryPref = { on: !!on };
    try {
      if (on) window.localStorage.removeItem(PREF_KEY);   // on is the default: nothing to store
      else window.localStorage.setItem(PREF_KEY, '0');
    } catch (e) {}
  }

  /* create(env)
     env.teacher()      → may this person be warned at all (lessonTeacher)
     env.recording()    → a lesson is going down
     env.playback()     → a lesson is being watched
     env.windowOpen()   → the Record window (or the export window) is up
     env.dialog()       → any other dialog is up (only takes a card down)
     env.docId() / env.uid() / env.pages()
     env.area()         → the worksheet area's DOMRect (or null)
     env.record()       → press the record button (lessonOpen)
     env.now()          → Date.now by default
  */
  function create(env) {
    env = env || {};
    var call = function (name, fallback) {
      try { return typeof env[name] === 'function' ? env[name]() : fallback; } catch (e) { return fallback; }
    };
    var now = function () { return typeof env.now === 'function' ? env.now() : Date.now(); };
    var state = initialState();
    var root = null, timer = 0, placing = 0, destroyed = false;

    function ctx(ann) {
      var c = {
        on: readPref().on,
        session: readSession(),
        teacher: !!call('teacher', false),
        recording: !!call('recording', false),
        playback: !!call('playback', false),
        windowOpen: !!call('windowOpen', false),
        dialog: !!call('dialog', false),
        docId: call('docId', ''),
        pages: !!call('pages', false)
      };
      if (arguments.length) c.ann = ann;
      return c;
    }
    function key() { return docKey(call('uid', ''), call('docId', '')); }

    function build() {
      if (root || destroyed || typeof document === 'undefined') return root;
      root = document.createElement('div');
      root.id = 'recNudge';
      root.className = 'rnBox';
      root.setAttribute('role', 'status');
      root.setAttribute('aria-live', 'polite');
      root.hidden = true;

      var dot = document.createElement('span');
      dot.className = 'rnDot';
      dot.setAttribute('aria-hidden', 'true');

      var text = document.createElement('div');
      text.className = 'rnText';
      var strong = document.createElement('strong');
      strong.className = 'rnTitle';
      strong.textContent = 'Not recording';
      var sub = document.createElement('span');
      sub.className = 'rnSub';
      sub.textContent = 'Your writing is not going into a lesson.';
      text.appendChild(strong); text.appendChild(sub);

      var actions = document.createElement('div');
      actions.className = 'rnActions';
      var rec = document.createElement('button');
      rec.type = 'button';
      rec.className = 'rnRec';
      rec.setAttribute('data-rn', 'record');
      rec.title = 'Open Record lesson (Shift+R)';
      rec.innerHTML = '<span class="rnRecDot" aria-hidden="true"></span>Record now';
      var later = document.createElement('button');
      later.type = 'button';
      later.className = 'rnLater';
      later.setAttribute('data-rn', 'later');
      later.title = 'Hide it until you write or type again — tick the box below to stop it';
      later.textContent = 'Hide';
      actions.appendChild(rec); actions.appendChild(later);

      var off = document.createElement('button');
      off.type = 'button';
      off.className = 'rnOff';
      off.setAttribute('data-rn', 'off');
      off.title = 'Turn this warning off on this device — the Record lesson window can turn it back on';
      off.textContent = 'Don’t warn me';

      // ☐ Ignore for this session: quiet until this tab (or the installed
      // app) is closed, then back by itself — unlike "Don't warn me".
      var sess = document.createElement('label');
      sess.className = 'rnSession';
      sess.title = 'No more recording warnings until you close this tab';
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'rnSessionBox';
      box.setAttribute('data-rn-session', '1');
      var word = document.createElement('span');
      word.textContent = 'Ignore for this session';
      sess.appendChild(box); sess.appendChild(word);

      var foot = document.createElement('div');
      foot.className = 'rnFoot';
      foot.appendChild(sess); foot.appendChild(off);

      root.appendChild(dot); root.appendChild(text); root.appendChild(actions); root.appendChild(foot);

      box.addEventListener('change', function (e) {
        e.stopPropagation();
        if (box.checked) ignoreSession();
      });

      root.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('[data-rn]') : null;
        if (!b) return;
        e.preventDefault(); e.stopPropagation();
        var what = b.getAttribute('data-rn');
        if (what === 'record') recordNow();
        else if (what === 'later') later_();
        else if (what === 'off') turnOff();
      });
      // A press on the box is a press on the box: never the start of a stroke
      // on the page under it, and never the two-finger navigation behind it.
      ['pointerdown', 'pointerup', 'touchstart', 'mousedown', 'dblclick'].forEach(function (t) {
        root.addEventListener(t, function (e) { e.stopPropagation(); }, { passive: t === 'touchstart' });
      });
      // Every key pressed inside stays inside, or a letter fires a one-letter
      // tool shortcut; Escape is "Hide" (until the next mark).
      root.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); later_(); }
      });
      document.body.appendChild(root);
      window.addEventListener('resize', schedulePlace);
      if (window.visualViewport && typeof window.visualViewport.addEventListener === 'function') {
        window.visualViewport.addEventListener('resize', schedulePlace);
      }
      return root;
    }

    function schedulePlace() {
      if (!root || root.hidden || placing) return;
      var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
      placing = raf(function () { placing = 0; placeNow(); });
    }
    function placeNow() {
      if (!root || root.hidden) return;
      var area = call('area', null);
      // Measured at the left edge: a card measured where it last stood (or at
      // the stylesheet's 50%) is squeezed by the screen's edge and comes out
      // too narrow, and is then placed by that wrong width.
      root.style.left = '0px';
      var r = root.getBoundingClientRect();
      var vw = window.innerWidth || document.documentElement.clientWidth || 0;
      var at = place(area ? { left: area.left, top: area.top, width: area.width } : { left: 0, top: 64, width: vw },
        { width: r.width }, vw);
      root.style.left = at.left + 'px';
      root.style.top = at.top + 'px';
    }

    function apply(result) {
      state = result.state;
      if (result.effect === 'show') show();
      else if (result.effect === 'hide') hideBox();
    }

    function show() {
      if (!build()) return;
      root.hidden = false;
      var sub = root.querySelector('.rnSub');
      if (sub) sub.textContent = subText(!!call('docId', ''));
      var sb = root.querySelector('.rnSessionBox');
      if (sb) sb.checked = false;
      root.classList.remove('rnIn');
      // Measured once visible, then slid in (CSS honours reduced motion).
      placeNow();
      void root.offsetWidth;
      root.classList.add('rnIn');
      startClock();
    }
    function hideBox() {
      stopClock();
      if (!root) return;
      root.classList.remove('rnIn');
      root.hidden = true;
      // The focus never stays inside a hidden box.
      if (root.contains(document.activeElement) && document.activeElement.blur) document.activeElement.blur();
    }

    function startClock() {
      stopClock();
      timer = setInterval(function () {
        // Something around it changed while it was up (a recording started
        // by Shift+R, a dialog opened, the role changed): it goes.
        apply(step(state, { type: 'context', now: now(), key: key(), why: standWhy(ctx()) }));
        apply(step(state, { type: 'tick', now: now() }));
      }, 1000);
    }
    function stopClock() { if (timer) { clearInterval(timer); timer = 0; } }

    /* ---- what the page tells it ---- */
    function ink(ann) {
      if (destroyed) return;
      apply(step(state, { type: 'ink', now: now(), key: key(), why: gate(ctx(ann)) }));
    }
    function changed() {
      if (destroyed) return;
      apply(step(state, { type: 'context', now: now(), key: key(), why: standWhy(ctx()) }));
    }

    /* ---- what the teacher tells it ---- */
    function recordNow() {
      // Asked again here: hiding a button has never been the lock.
      if (!call('teacher', false)) { apply(step(state, { type: 'context', now: now(), key: key(), why: WHY.teacher })); return; }
      apply(step(state, { type: 'record', now: now() }));
      if (typeof env.record === 'function') {
        try { env.record(); } catch (e) {}
      }
    }
    function later_() { apply(step(state, { type: 'later', now: now() })); }
    function turnOff() {
      writePref(false);
      apply(step(state, { type: 'off', now: now() }));
      if (typeof env.toast === 'function') {
        try { env.toast('Recording warning off. Turn it back on in the Record lesson window.'); } catch (e) {}
      }
    }
    function ignoreSession() {
      writeSession(true);
      apply(step(state, { type: 'session', now: now() }));
      if (typeof env.toast === 'function') {
        try { env.toast('No more recording warnings until you close this tab.'); } catch (e) {}
      }
      if (typeof env.onSwitch === 'function') { try { env.onSwitch(); } catch (e) {} }
    }
    // The Record window's switch: on means on for good AND not ignored for
    // this session; off is "Don't warn me".
    function setEnabled(on) {
      writePref(!!on);
      if (on) writeSession(false);
      apply(step(state, { type: on ? 'on' : 'off', now: now() }));
    }
    // Why the next mark would not count right now ('' = it would): the
    // glue puts this on window.recNudgeWhy() so "it did not come up" can be
    // answered from the console instead of guessed at.
    function why() {
      var c = ctx(null);
      delete c.ann;
      var w = gate(c);
      if (w) return w;
      if (snoozedUntil(state, key(), now())) return 'snoozed';
      return '';
    }

    function destroy() {
      destroyed = true;
      stopClock();
      window.removeEventListener('resize', schedulePlace);
      if (root && root.parentNode) root.parentNode.removeChild(root);
      root = null;
    }

    return {
      ink: ink,
      changed: changed,
      recordNow: recordNow,
      later: later_,
      turnOff: turnOff,
      ignoreSession: ignoreSession,
      setEnabled: setEnabled,
      enabled: function () { return readPref().on && !readSession(); },
      sessionIgnored: function () { return readSession(); },
      why: why,
      isShown: function () { return !!(root && !root.hidden); },
      state: function () { return copy(state); },
      tick: function () { apply(step(state, { type: 'tick', now: now() })); },
      element: function () { return root; },
      destroy: destroy
    };
  }

  window.RecordNudge = { create: create, pure: pure };
})();
