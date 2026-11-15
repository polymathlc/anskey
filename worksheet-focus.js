/* 📌 Current and next worksheet — the borders and the manual override (v1.200.0)
   ---------------------------------------------------------------------------
   Ans Key is where the lessons happen; Polymath Online (the LMS) and the trial
   lessons are where the class's place is kept. So the teacher has to be able
   to see, at a glance and without reading a word, which worksheet the class is
   ON and which one comes NEXT — and to put it right by hand when the two
   systems disagree.

   This file owns the presentation and the menu. The DECISIONS stay in
   index.html's Polymath Online section (onlineFocusOf, onlineNextAt,
   onlineSetCurrent, onlineSetNext, onlineClearNext, onlineMarkLoose), so the
   worksheet list, the class list and this menu can never disagree:

   · `frameFor(focus)` — what the page frame and the sidebar pill show.
   · `menuModel(input)` — the rows of the 📌 menu for one worksheet card.
   · `placeMenu(rect, w, h, vw, vh)` — where the menu goes, kept on screen.
   · `create(env)` → { openMenu, close, isOpen, sync, roleChanged, setFrame,
     frameOn } — the popover and the frame round the open worksheet.

   Everything is written with textContent. Every key pressed in the menu stops
   there (worksheet one-letter shortcuts must not fire behind it), Escape
   closes it, a tap outside closes it, and a role change closes it. The frame
   is presentation only, hidden in print and while the worksheet window itself
   is being recorded. */
(function () {
  'use strict';

  var PREF_KEY = 'polymath.wsFocusFrame.v1';
  var STATES = ['current', 'next'];
  var MENU_W = 300;
  var MENU_GAP = 6;
  var EDGE = 12;

  function clean(v) { return STATES.indexOf(v) >= 0 ? v : ''; }

  /* What the open worksheet's frame and pill say. `focus` is
     onlineFocusOf's answer for the open worksheet (or null). */
  function frameFor(focus) {
    var state = focus ? clean(focus.state) : '';
    if (!state) return { state: '', label: '', detail: '' };
    var where = '';
    if (focus.place) {
      where = 'Worksheet ' + (focus.place.seq + 1) + ' of ' + focus.place.total +
        (focus.place.course && focus.place.course.title ? ' · ' + focus.place.course.title : '');
    } else if (focus.source === 'mark') {
      where = 'Marked by you · not in a class list';
    }
    var label = state === 'current' ? '▶ Current worksheet' : '⏭ Next worksheet';
    if (focus.manual && focus.source === 'class' && state === 'next') label += ' · set by you';
    return { state: state, label: label, detail: where };
  }

  /* The rows of the 📌 menu for one worksheet.
     input = { focus, teacher, manualNext (number|-1), followsOn (number|-1),
               name, frameOn } */
  function menuModel(input) {
    input = input || {};
    var focus = input.focus || { state: '', source: '', manual: false, place: null };
    var state = focus.state || '';
    var inClass = focus.source === 'class' && !!focus.place;
    var out = { title: input.name || 'Untitled', sub: '', rows: [], note: '', teacher: !!input.teacher };
    if (!input.teacher) return out;
    if (inClass) {
      var p = focus.place;
      out.sub = 'Worksheet ' + (p.seq + 1) + ' of ' + p.total + (p.course && p.course.title ? ' · ' + p.course.title : '');
      out.rows.push({
        act: 'current',
        label: state === 'current' ? '▶ This is the current worksheet' : '▶ Make this the current worksheet',
        hint: state === 'current'
          ? 'Polymath Online has the class on it.'
          : (state === 'done'
            ? 'Moves the class BACK to it. Polymath Online follows; nothing released is taken away.'
            : 'Polymath Online moves the class to it and releases as opening it would.'),
        on: state === 'current',
        disabled: state === 'current'
      });
      out.rows.push({
        act: 'next',
        label: state === 'next' ? '⏭ This is the next worksheet' : '⏭ Make this the next worksheet',
        hint: state === 'current'
          ? 'It is the current one — pick another worksheet as next.'
          : (state === 'next'
            ? (focus.manual ? 'Set by you. ✓ Finished, or opening it, makes it current.' : 'It follows on from the current one.')
            : 'Finished then loads this one instead of the worksheet after the current one.'),
        on: state === 'next',
        disabled: state === 'current' || (state === 'next' && !focus.manual)
      });
      if (typeof input.manualNext === 'number' && input.manualNext >= 0) {
        out.rows.push({
          act: 'auto',
          label: '↺ Next follows on again',
          hint: input.followsOn >= 0
            ? 'Worksheet ' + (input.followsOn + 1) + ' becomes the next worksheet, as it follows on.'
            : 'The current worksheet is the last; there will be no next one.',
          on: false,
          disabled: false
        });
      }
      out.note = 'In a Polymath Online class list: the current worksheet is the one the LMS shows.';
    } else {
      out.sub = 'Not in a class list · marked for its lesson time';
      out.rows.push({
        act: 'current',
        label: state === 'current' ? '▶ Marked as the current worksheet' : '▶ Mark as the current worksheet',
        hint: 'One per lesson time: it takes the mark off any other worksheet there.',
        on: state === 'current',
        disabled: state === 'current'
      });
      out.rows.push({
        act: 'next',
        label: state === 'next' ? '⏭ Marked as the next worksheet' : '⏭ Mark as the next worksheet',
        hint: 'For a trial lesson, or a class not on Polymath Online yet.',
        on: state === 'next',
        disabled: state === 'next'
      });
      if (state === 'current' || state === 'next') {
        out.rows.push({ act: 'auto', label: '↺ Clear the mark', hint: 'Neither current nor next.', on: false, disabled: false });
      }
      out.note = 'A mark here stays in Ans Key: Polymath Online only knows class lists.';
    }
    out.rows.push({
      act: 'frame',
      label: (input.frameOn ? '☑' : '☐') + ' Frame the open page when it is current or next',
      hint: 'A thick green frame for the current worksheet, a blue one for the next.',
      on: !!input.frameOn,
      disabled: false,
      toggle: true
    });
    return out;
  }

  /* Under the anchor, or above it when there is no room below; slid in from
     either edge; never wider than the screen. Pure. */
  function placeMenu(rect, w, h, vw, vh) {
    rect = rect || { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    var width = Math.max(200, Math.min(w || MENU_W, (vw || 0) - 2 * EDGE));
    var left = (rect.right || 0) - width;
    if (left < EDGE) left = EDGE;
    if (left + width > (vw || 0) - EDGE) left = Math.max(EDGE, (vw || 0) - EDGE - width);
    var below = (rect.bottom || 0) + MENU_GAP;
    var top = below;
    if (below + h > (vh || 0) - EDGE) {
      var above = (rect.top || 0) - MENU_GAP - h;
      top = above >= EDGE ? above : Math.max(EDGE, (vh || 0) - EDGE - h);
    }
    return { left: Math.round(left), top: Math.round(top), width: Math.round(width) };
  }

  function readPref(store) {
    try { var v = (store || window.localStorage).getItem(PREF_KEY); return v === null ? memoryPref : v !== '0'; } catch (e) { return memoryPref; }
  }
  var memoryPref = true;
  function writePref(on, store) {
    memoryPref = !!on;
    try { (store || window.localStorage).setItem(PREF_KEY, on ? '1' : '0'); } catch (e) {}
  }

  function create(env) {
    env = env || {};
    var menu = null;          // { root, item, anchor }
    var frameEl = null, pillEl = null;
    var frameOn = readPref();
    var lastState = '';

    function teacher() { try { return !!(env.teacher && env.teacher()); } catch (e) { return false; } }

    function close(refocus) {
      if (!menu) return;
      var m = menu; menu = null;
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onDocKey, true);
      window.removeEventListener('resize', onResize);
      try { m.root.remove(); } catch (e) {}
      if (m.anchor) {
        m.anchor.setAttribute('aria-expanded', 'false');
        if (refocus && m.anchor.isConnected) { try { m.anchor.focus({ preventScroll: true }); } catch (e) {} }
      }
    }
    function onOutside(e) {
      if (!menu) return;
      if (menu.root.contains(e.target) || (menu.anchor && menu.anchor.contains(e.target))) return;
      close(false);
    }
    // A redraw can drop focus out of the menu; Escape still closes it.
    function onDocKey(e) {
      if (menu && e.key === 'Escape' && !menu.root.contains(document.activeElement)) {
        e.preventDefault(); e.stopPropagation(); close(true);
      }
    }
    function onResize() { close(false); }

    function rowsOf(root) { return Array.prototype.slice.call(root.querySelectorAll('.wsfRow:not([disabled])')); }

    function onMenuKey(e) {
      e.stopPropagation();
      if (!menu) return;
      if (e.type !== 'keydown') return;
      if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        var rows = rowsOf(menu.root);
        if (!rows.length) return;
        var i = rows.indexOf(document.activeElement);
        if (e.key === 'Home') i = 0;
        else if (e.key === 'End') i = rows.length - 1;
        else if (e.key === 'ArrowDown') i = i < 0 ? 0 : (i + 1) % rows.length;
        else i = i <= 0 ? rows.length - 1 : i - 1;
        rows[i].focus();
      }
      if (e.key === 'Tab') {
        var all = rowsOf(menu.root);
        if (!all.length) return;
        var at = all.indexOf(document.activeElement);
        if (e.shiftKey && at <= 0) { e.preventDefault(); all[all.length - 1].focus(); }
        else if (!e.shiftKey && at === all.length - 1) { e.preventDefault(); all[0].focus(); }
      }
    }

    async function choose(act, item, btn) {
      if (act === 'frame') {
        setFrame(!frameOn);
        close(true);
        return;
      }
      // Asked again here: hiding the button has never been the lock.
      if (!teacher()) { close(false); return; }
      if (btn) btn.disabled = true;
      try { if (env.act) await env.act(item, act); }
      catch (e) { if (env.toast) env.toast('Could not change that: ' + ((e && e.message) || e), 5000); }
      close(false);
    }

    function openMenu(anchor, item) {
      if (menu && menu.item && item && menu.item.id === item.id) { close(true); return; }
      close(false);
      if (!teacher() || !item) return;
      var focus = env.focusOf ? env.focusOf(item) : null;
      var model = menuModel({
        focus: focus,
        teacher: true,
        manualNext: env.manualNextOf ? env.manualNextOf(item) : -1,
        followsOn: env.followsOnOf ? env.followsOnOf(item) : -1,
        name: item.data && item.data.name,
        frameOn: frameOn
      });
      var root = document.createElement('div');
      root.className = 'wsfMenu';
      root.setAttribute('role', 'menu');
      root.setAttribute('aria-label', 'Current and next worksheet');
      var head = document.createElement('div');
      head.className = 'wsfHead';
      var t = document.createElement('div');
      t.className = 'wsfTitle';
      t.textContent = '📌 ' + model.title;
      var sub = document.createElement('div');
      sub.className = 'wsfSub';
      sub.textContent = model.sub;
      head.append(t, sub);
      root.appendChild(head);
      model.rows.forEach(function (r) {
        if (r.toggle) {
          var sep = document.createElement('div');
          sep.className = 'wsfSep';
          root.appendChild(sep);
        }
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'wsfRow' + (r.on ? ' on' : '') + ' wsfAct-' + r.act;
        b.setAttribute('role', r.toggle ? 'menuitemcheckbox' : 'menuitem');
        if (r.toggle) b.setAttribute('aria-checked', r.on ? 'true' : 'false');
        b.disabled = !!r.disabled;
        var l = document.createElement('span');
        l.className = 'wsfLabel';
        l.textContent = r.label;
        var h = document.createElement('span');
        h.className = 'wsfHint';
        h.textContent = r.hint;
        b.append(l, h);
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          choose(r.act, item, b);
        });
        root.appendChild(b);
      });
      if (model.note) {
        var note = document.createElement('div');
        note.className = 'wsfNote';
        note.textContent = model.note;
        root.appendChild(note);
      }
      ['keydown', 'keyup', 'keypress'].forEach(function (k) { root.addEventListener(k, onMenuKey); });
      root.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      root.addEventListener('click', function (e) { e.stopPropagation(); });
      root.style.visibility = 'hidden';
      document.body.appendChild(root);
      var rect = anchor.getBoundingClientRect();
      var pos = placeMenu(rect, MENU_W, root.offsetHeight || 260, window.innerWidth, window.innerHeight);
      root.style.left = pos.left + 'px';
      root.style.top = pos.top + 'px';
      root.style.width = pos.width + 'px';
      root.style.visibility = '';
      menu = { root: root, item: item, anchor: anchor };
      anchor.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', onOutside, true);
      document.addEventListener('keydown', onDocKey, true);
      window.addEventListener('resize', onResize);
      var first = rowsOf(root)[0];
      if (first) { try { first.focus({ preventScroll: true }); } catch (e) {} }
    }

    /* The frame round the open worksheet and the sidebar pill. */
    function ensureFrame() {
      if (frameEl && frameEl.isConnected) return frameEl;
      var host = env.viewer ? env.viewer() : null;
      if (!host) return null;
      frameEl = document.createElement('div');
      frameEl.className = 'wsfFrame';
      frameEl.setAttribute('aria-hidden', 'true');
      var badge = document.createElement('div');
      badge.className = 'wsfFrameBadge';
      frameEl.appendChild(badge);
      (host.parentNode || document.body).insertBefore(frameEl, host.nextSibling);
      return frameEl;
    }
    function place() {
      if (!frameEl || !frameEl.isConnected) return;
      var host = env.viewer ? env.viewer() : null;
      if (!host) return;
      var r = host.getBoundingClientRect();
      frameEl.style.left = r.left + 'px';
      frameEl.style.top = r.top + 'px';
      frameEl.style.width = r.width + 'px';
      frameEl.style.height = r.height + 'px';
    }
    var placeTimer = 0;
    function placeSoon() {
      if (placeTimer) return;
      placeTimer = requestAnimationFrame(function () { placeTimer = 0; place(); });
    }
    window.addEventListener('resize', placeSoon);
    window.addEventListener('scroll', placeSoon, true);
    if (window.ResizeObserver) {
      try {
        var ro = new ResizeObserver(placeSoon);
        var watch = function () { var h = env.viewer ? env.viewer() : null; if (h) ro.observe(h); };
        watch();
      } catch (e) {}
    }

    function sync() {
      var focus = env.openFocus ? env.openFocus() : null;
      var f = frameFor(focus);
      lastState = f.state;
      // The sidebar pill: always, for everybody who can see the worksheet.
      pillEl = env.pill ? env.pill() : null;
      if (pillEl) {
        pillEl.className = 'wsfPill' + (f.state ? ' ' + f.state : '');
        pillEl.style.display = f.state ? '' : 'none';
        pillEl.replaceChildren();
        if (f.state) {
          var b = document.createElement('b');
          b.textContent = f.label;
          pillEl.appendChild(b);
          if (f.detail) {
            var s = document.createElement('span');
            s.textContent = f.detail;
            pillEl.appendChild(s);
          }
        }
      }
      var show = !!f.state && frameOn;
      var el = show ? ensureFrame() : frameEl;
      if (el) {
        el.className = 'wsfFrame' + (show ? ' on ' + f.state : '');
        var badge = el.firstChild;
        if (badge) badge.textContent = show ? f.label : '';
        if (show) place();
      }
      if (document.body) {
        document.body.classList.toggle('wsfOpenCurrent', f.state === 'current');
        document.body.classList.toggle('wsfOpenNext', f.state === 'next');
      }
      return f;
    }

    function setFrame(on) {
      frameOn = !!on;
      writePref(frameOn);
      sync();
      if (env.toast) env.toast(frameOn ? '📌 The open page is framed when it is the current or the next worksheet.' : 'The frame round the page is off. The cards in the list keep their borders.', 4000);
    }

    function roleChanged() {
      if (menu && !teacher()) close(false);
      sync();
    }

    return {
      openMenu: openMenu,
      close: close,
      isOpen: function () { return !!menu; },
      sync: sync,
      roleChanged: roleChanged,
      setFrame: setFrame,
      frameOn: function () { return frameOn; },
      state: function () { return lastState; },
      place: place
    };
  }

  var api = {
    create: create,
    pure: {
      PREF_KEY: PREF_KEY,
      STATES: STATES,
      clean: clean,
      frameFor: frameFor,
      menuModel: menuModel,
      placeMenu: placeMenu,
      readPref: readPref,
      writePref: writePref
    }
  };
  if (typeof window !== 'undefined') window.WorksheetFocus = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
