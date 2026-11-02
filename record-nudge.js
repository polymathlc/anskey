/* =====================================================================
   ⏺ Writing without recording — the "Not recording" nudge (v1.173.0)
   ---------------------------------------------------------------------
   Zhi Kai explains while writing, and a lesson that was never recorded is
   only found out about afterwards, when there is nothing left to record.
   So when the TEACHER writes on a saved worksheet and no lesson is going
   down, a small warning comes up over the top of the page:

       ● Not recording — your writing is not going into a lesson.
         [● Record now]  [Not now]                       Don't warn me

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
   - It asks only once the teacher is REALLY writing: `STROKES` marks inside
     `WINDOW_MS`. A single correction, a tick or a dot is not a lesson.
   - It goes away by itself: when a recording starts, when the Record window
     opens, when the person or the worksheet changes, and after `SHOW_MS`
     untouched (a short snooze, `IDLE_SNOOZE_MS`, so it does not bounce
     straight back on the next stroke). "Not now" snoozes THIS worksheet for
     `LATER_SNOOZE_MS`. "Don't warn me" turns it off on this device; the
     Record lesson window has the switch to turn it back on.
   - Snoozes live for the visit only (memory). The off switch is the only
     thing written to storage (`PREF_KEY`), and a blocked storage keeps it
     for the visit instead.

   The decisions are PURE (`pure.gate`, `pure.step`) so
   `tools/record-nudge-tests.mjs` can walk every rule without a page, and the
   DOM half only draws what `step` says.
   ===================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------------
     Numbers. Each one is a judgement about a teacher mid-lesson.
     --------------------------------------------------------------------- */
  var STROKES = 3;                       // marks before it is "writing"
  var WINDOW_MS = 45 * 1000;             // …within this long
  var SHOW_MS = 15 * 1000;               // untouched, it goes away after this
  var IDLE_SNOOZE_MS = 3 * 60 * 1000;    // …and keeps away this long
  var LATER_SNOOZE_MS = 10 * 60 * 1000;  // "Not now" on this worksheet
  var RECORD_SNOOZE_MS = 60 * 1000;      // Record now pressed, window closed again
  var MARKS_MAX = 32;                    // the mark list never grows without end
  var SNOOZE_MAX = 64;                   // nor does the snooze map
  var PREF_KEY = 'polymath.recordNudge.v1';
  var GAP_PX = 12;                       // from the top of the worksheet area

  // What counts as WRITING: the lesson recorder's own list (LESSON_TYPES).
  // A picture, a card, a lasso or an eraser pass is arranging, not writing.
  var INK_TYPES = ['pen', 'highlight', 'text', 'rect', 'ellipse', 'line', 'arrow', 'brace'];

  // Why it is NOT asking, in the order they are checked. The browser check and
  // the harness read these words, so they are part of the contract.
  var WHY = {
    off: 'off',                  // the teacher said "Don't warn me"
    teacher: 'not-teacher',      // a student, a visitor, practice, a handover
    recording: 'recording',      // a lesson is going down — the whole point
    pending: 'pending',          // a finished lesson is waiting to be saved
    playback: 'playback',        // a lesson is being watched
    window: 'window-open',       // the Record window (or any dialog) is up
    unsaved: 'unsaved',          // nothing to attach a lesson to yet
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
  // account, is never read on another.
  function docKey(uid, docId) {
    if (!uid || !docId) return '';
    return String(uid) + '/' + String(docId);
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

  /* gate(ctx) → '' when a mark may count, otherwise WHY it may not.
     ctx: { on, teacher, recording, pending, playback, windowOpen, docId,
            pages, ann } — every field read as a plain truthy flag. */
  function gate(ctx) {
    var c = ctx || {};
    if (c.on === false) return WHY.off;
    if (!c.teacher) return WHY.teacher;
    if (c.recording) return WHY.recording;
    if (c.pending) return WHY.pending;
    if (c.playback) return WHY.playback;
    if (c.windowOpen) return WHY.window;
    if (!c.pages) return WHY.pages;
    if (!c.docId) return WHY.unsaved;
    if ('ann' in c && !isInk(c.ann)) return WHY.ink;
    return '';
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
       { type:'tick', now }               the clock, for SHOW_MS
       { type:'later', now }              "Not now"
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
        if (s.shown && now - s.shownAt >= SHOW_MS) return hide(IDLE_SNOOZE_MS);
        return { state: s, effect: '' };
      case 'later':
        return hide(LATER_SNOOZE_MS);
      case 'record':
        return hide(RECORD_SNOOZE_MS);
      case 'off':
        s.last = WHY.off;
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
    SNOOZE_MAX: SNOOZE_MAX, PREF_KEY: PREF_KEY, GAP_PX: GAP_PX, INK_TYPES: INK_TYPES.slice(), WHY: WHY,
    isInk: isInk, docKey: docKey, trimMarks: trimMarks, pruneSnooze: pruneSnooze,
    snoozedUntil: snoozedUntil, cleanPref: cleanPref, gate: gate, initialState: initialState,
    step: step, place: place
  };

  /* ---------------------------------------------------------------------
     The box
     --------------------------------------------------------------------- */
  var memoryPref = null;   // where storage is blocked, the switch lives here

  function readPref() {
    try {
      var raw = window.localStorage.getItem(PREF_KEY);
      if (raw !== null) return cleanPref(raw);
    } catch (e) {}
    return memoryPref || { on: true };
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
     env.pending()      → a finished lesson waits to be saved
     env.playback()     → a lesson is being watched
     env.windowOpen()   → a dialog (the Record window included) is up
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
        teacher: !!call('teacher', false),
        recording: !!call('recording', false),
        pending: !!call('pending', false),
        playback: !!call('playback', false),
        windowOpen: !!call('windowOpen', false),
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
      later.title = 'Do not ask again on this worksheet for ten minutes';
      later.textContent = 'Not now';
      actions.appendChild(rec); actions.appendChild(later);

      var off = document.createElement('button');
      off.type = 'button';
      off.className = 'rnOff';
      off.setAttribute('data-rn', 'off');
      off.title = 'Turn this warning off on this device — the Record lesson window can turn it back on';
      off.textContent = 'Don’t warn me';

      root.appendChild(dot); root.appendChild(text); root.appendChild(actions); root.appendChild(off);

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
      // tool shortcut; Escape is "Not now".
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
        apply(step(state, { type: 'context', now: now(), key: key(), why: gate(ctx()) }));
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
      apply(step(state, { type: 'context', now: now(), key: key(), why: gate(ctx()) }));
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
    function setEnabled(on) {
      writePref(!!on);
      apply(step(state, { type: on ? 'on' : 'off', now: now() }));
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
      setEnabled: setEnabled,
      enabled: function () { return readPref().on; },
      isShown: function () { return !!(root && !root.hidden); },
      state: function () { return copy(state); },
      tick: function () { apply(step(state, { type: 'tick', now: now() })); },
      element: function () { return root; },
      destroy: destroy
    };
  }

  window.RecordNudge = { create: create, pure: pure };
})();
