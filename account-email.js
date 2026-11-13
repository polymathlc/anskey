/* ✉ A STUDENT'S ACCOUNT EMAIL, CHANGED BY THE TEACHER AND VERIFIED BY THE
   STUDENT (v1.194.0) — window.AccountEmail.

   The teacher opens ✉ Email on a student's row in the Students window, types
   the new address and presses Send. The `ansKeyAccountEmail` function
   (functions/account-email.js) has FIREBASE AUTH'S OWN MAILER send a
   "verify your new email" message to that address. NOTHING CHANGES UNTIL THE
   STUDENT OPENS IT: the account keeps its old address, the roster row keeps
   it, and the window says it is waiting. Opening the link changes the
   account's email (Firebase's own handler), signs it out everywhere and tells
   the old address. The next time the Students window opens — or the student
   signs in — the change is finished and the roster row takes the new address.

   If Firebase will not send the email, the server hands back the SAME
   verified link and the window offers to send it from the teacher's own Gmail
   (the living library's way of sending: compose opens, the teacher presses
   Send). The change still waits for the link.

   A student whose new address is a Google account, and who signs in with it,
   lands the first time on a brand-new empty account. `checkSignIn` asks the
   server (`mine`), which — only for a verified change and only from an empty
   account — moves that Google sign-in onto the student's real account; the
   page then signs out and asks them to sign in again, and their worksheets,
   marks and hero are all there.

   Rules this file keeps:
   - Teacher only: `env.isTeacher()` in open, send, withdraw and refresh, and
     the server checks again. Hiding the button has never been the lock.
   - Everything a person typed or the server returned is written with
     textContent. The link the teacher may send is the server's, and is only
     ever put in a Gmail compose URL or on the clipboard.
   - Every key pressed inside the window stops there, so the worksheet's
     one-letter tool shortcuts never fire while an address is typed; Escape
     closes it.
   - A late answer for a window that has closed or moved to another student is
     dropped (`state.seq`). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AccountEmail = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ENDPOINT = 'https://us-central1-mathgen--app.cloudfunctions.net/ansKeyAccountEmail';
  var GMAIL_BASE = 'https://mail.google.com/mail/';
  var EMAIL_MAX = 254;
  var EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
  var CHECK_KEY = 'polymath.accountEmailChecked.v1';
  var PENDING = { sent: true, link: true };

  /* ---------- pure ---------- */
  function cleanEmail(v) {
    return String(v == null ? '' : v).trim().replace(/^mailto:/i, '').toLowerCase();
  }
  function validEmail(v) {
    var e = cleanEmail(v);
    return e.length > 3 && e.length <= EMAIL_MAX && EMAIL_RE.test(e);
  }
  function sameEmail(a, b) { return !!a && !!b && cleanEmail(a) === cleanEmail(b); }
  function pending(change) { return !!(change && PENDING[change.status]); }
  function when(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var h = d.getHours(), m = d.getMinutes();
    return d.getDate() + ' ' + months[d.getMonth()] + ', ' + ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? 'am' : 'pm');
  }
  /* One line about where a change stands, for the window and the row. */
  function statusText(change) {
    if (!change || !change.to) return '';
    var to = change.to;
    switch (change.status) {
      case 'sent': return 'Waiting for ' + to + ' to open the verification email (sent ' + when(change.requestedAt) + ').';
      case 'link': return 'Waiting for ' + to + ' to open the verification link you sent from Gmail (' + when(change.requestedAt) + ').';
      case 'done': return 'Changed to ' + to + ' on ' + when(change.doneAt) + '.';
      case 'moved': return 'Changed to ' + to + ' — they now sign in with that Google account (' + when(change.movedAt || change.doneAt) + ').';
      case 'cancelled': return 'The change to ' + to + ' was withdrawn. The old address stays.';
      case 'expired': return 'The link sent to ' + to + ' was never opened. Send it again if it is still wanted.';
      default: return '';
    }
  }
  function badgeText(change) {
    if (!change || !change.to) return '';
    if (pending(change)) return '✉ waiting for ' + change.to;
    if (change.status === 'done' || change.status === 'moved') return '✉ changed ' + when(change.doneAt || change.movedAt);
    return '';
  }
  function gmailUrl(m) {
    m = m || {};
    var enc = encodeURIComponent, q = ['view=cm', 'fs=1'];
    if (m.account) q.push('authuser=' + enc(m.account));
    if (m.to) q.push('to=' + enc(m.to));
    if (m.subject) q.push('su=' + enc(m.subject));
    if (m.body) q.push('body=' + enc(m.body));
    return GMAIL_BASE + '?' + q.join('&');
  }
  function mailSubject() { return 'Confirm your new email for Polymath Ans Key'; }
  function mailBody(name, to, link) {
    var who = String(name || '').trim();
    return 'Hi' + (who ? ' ' + who : '') + ',\n\n' +
      'Your Polymath Ans Key account is being moved to this email address (' + to + ').\n\n' +
      'Open this link to confirm it. Nothing changes until you do:\n' + link + '\n\n' +
      'Afterwards, sign in to Ans Key with Google using ' + to + '. Your worksheets, marks and hero come with you.\n\n' +
      'If you did not expect this, ignore this email and nothing will change.\n\nMr Chung';
  }
  /* Is it worth asking the server about this sign-in? Only when something
     could need finishing or moving: the link brought them here, the account
     is new (no level yet), or the account's email and the roster disagree. */
  function needsCheck(user, profile, search) {
    if (!user || user.isAnonymous || !user.email) return false;
    if (/[?&]emailChanged=1(?:&|$)/.test(String(search || ''))) return true;
    if (!profile || !profile.level) return true;
    return !!(profile.email && !sameEmail(profile.email, user.email));
  }
  function errorText(data, status) {
    var msg = data && data.error && data.error.message;
    if (msg) return String(msg);
    if (status === 0) return 'Ans Key could not reach the server. Check the connection and try again.';
    return 'The email change could not be made just now. Nothing was changed; try again.';
  }

  /* ---------- the window ---------- */
  function create(env) {
    env = env || {};
    var endpoint = env.endpoint || ENDPOINT;
    var state = { open: false, uid: '', profile: null, change: null, seq: 0, busy: false, ask: null, link: '', reason: '', note: '', noteKind: '' };
    var back = null, els = {};
    var badges = {};

    function toast(m, ms) { if (typeof env.toast === 'function') env.toast(m, ms); }
    function teacher() { try { return !!(env.isTeacher && env.isTeacher()); } catch (e) { return false; } }
    function el(tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }

    async function post(body, timeoutMs) {
      var user = env.user && env.user();
      if (!user) throw Object.assign(new Error('Sign in first.'), { code: 'sign_in_required' });
      var tokenFn = env.appCheckToken && env.appCheckToken();
      if (typeof tokenFn !== 'function') throw Object.assign(new Error('Ans Key is still loading. Try again in a moment.'), { code: 'app_check_loading' });
      var tokens = await Promise.all([user.getIdToken(), tokenFn()]);
      var res, data = null;
      try {
        var ctl = (timeoutMs && typeof AbortController === 'function') ? new AbortController() : null;
        var timer = ctl ? setTimeout(function () { ctl.abort(); }, timeoutMs) : null;
        res = await (env.fetch || fetch)(endpoint, {
          method: 'POST', signal: ctl ? ctl.signal : undefined,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokens[0], 'X-Firebase-AppCheck': tokens[1] },
          body: JSON.stringify(body)
        });
      } catch (e) {
        throw Object.assign(new Error(errorText(null, 0)), { code: 'network' });
      } finally { if (timer) clearTimeout(timer); }
      try { data = await res.json(); } catch (e) { data = null; }
      if (!res.ok) throw Object.assign(new Error(errorText(data, res.status)), { code: (data && data.error && data.error.code) || 'failed', status: res.status });
      return data || {};
    }

    function ensureShell() {
      if (back) return back;
      back = el('div', 'aeBack');
      back.id = 'accountEmailWin';
      back.setAttribute('role', 'dialog');
      back.setAttribute('aria-modal', 'true');
      back.setAttribute('aria-labelledby', 'aeTitle');
      var card = el('div', 'aeCard');
      var head = el('div', 'aeHead');
      var title = el('h2', 'aeTitle'); title.id = 'aeTitle';
      var close = el('button', 'aeClose', '✕'); close.type = 'button'; close.title = 'Close'; close.setAttribute('aria-label', 'Close');
      head.appendChild(title); head.appendChild(close);
      var body = el('div', 'aeBody');
      card.appendChild(head); card.appendChild(body);
      back.appendChild(card);
      els = { card: card, title: title, body: body, close: close };
      close.addEventListener('click', function () { closeView(); });
      back.addEventListener('pointerdown', function (e) { if (e.target === back) closeView(); });
      ['keydown', 'keyup', 'keypress'].forEach(function (type) {
        back.addEventListener(type, function (e) {
          e.stopPropagation();
          if (type === 'keydown' && e.key === 'Escape') { e.preventDefault(); closeView(); }
        });
      });
      card.tabIndex = -1;
      // A redraw removes the button that had the focus, which drops it to the
      // page; Escape must still close the window from there, and must not
      // reach the worksheet's own Escape.
      document.addEventListener('keydown', function (e) {
        if (!state.open || e.key !== 'Escape') return;
        var a = document.activeElement;
        if (a && a !== document.body && !back.contains(a)) return;
        e.preventDefault(); e.stopPropagation();
        closeView();
      }, true);
      document.body.appendChild(back);
      return back;
    }

    function setNote(text, kind) { state.note = text || ''; state.noteKind = kind || ''; }

    function render() {
      if (!back || !state.open) return;
      var p = state.profile || {}, name = p.name || 'this student';
      els.title.textContent = '✉ Change ' + (p.name ? p.name + '’s' : 'the student’s') + ' email';
      var body = els.body;
      // A redraw while the teacher is typing keeps the field focused and the
      // caret where it was (an answer from the server can land mid-word).
      var had = els.input && document.activeElement === els.input;
      var inside = !had && back.contains(document.activeElement);
      var caret = had ? [els.input.selectionStart, els.input.selectionEnd] : null;
      body.textContent = '';

      var cur = el('div', 'aeCurrent');
      cur.appendChild(el('div', 'aeLabel', 'Account email now'));
      cur.appendChild(el('div', 'aeEmail', p.email || '(none on the roster)'));
      body.appendChild(cur);

      var ch = state.change;
      if (ch && ch.to) {
        var st = el('div', 'aeStatus ' + (pending(ch) ? 'aeWaiting' : (ch.status === 'done' || ch.status === 'moved') ? 'aeDone' : 'aeOff'));
        st.appendChild(el('div', 'aeStatusText', statusText(ch)));
        if (pending(ch)) {
          var acts = el('div', 'aeRow');
          var refresh = el('button', 'btn aeRefresh', '↻ Check again'); refresh.type = 'button';
          refresh.addEventListener('click', function () { refreshOne(); });
          var withdraw = el('button', 'btn aeWithdraw', 'Withdraw'); withdraw.type = 'button';
          withdraw.title = 'Mark this change as withdrawn. The email already sent cannot be recalled, so only send to an address you trust.';
          withdraw.addEventListener('click', function () { withdrawChange(); });
          acts.appendChild(refresh); acts.appendChild(withdraw);
          st.appendChild(acts);
        }
        body.appendChild(st);
      }

      var form = el('div', 'aeForm');
      var lab = el('label', 'aeLabel', 'New email address');
      lab.setAttribute('for', 'aeNewEmail');
      var input = el('input', 'aeInput');
      input.id = 'aeNewEmail'; input.type = 'email'; input.autocomplete = 'off'; input.spellcheck = false;
      input.placeholder = 'new.address@gmail.com';
      input.value = state.draft || '';
      input.addEventListener('input', function () { state.draft = input.value; state.ask = null; sendBtn.disabled = state.busy || !validEmail(input.value); hint.textContent = hintFor(input.value); });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !sendBtn.disabled) { e.preventDefault(); send(false); } });
      var hint = el('div', 'aeHint', hintFor(input.value));
      var row = el('div', 'aeRow');
      var sendBtn = el('button', 'btn btnPrimary aeSend', state.busy ? 'Sending…' : 'Send verification email');
      sendBtn.type = 'button';
      sendBtn.disabled = state.busy || !validEmail(input.value);
      sendBtn.addEventListener('click', function () { send(false); });
      row.appendChild(sendBtn);
      form.appendChild(lab); form.appendChild(input); form.appendChild(hint); form.appendChild(row);
      body.appendChild(form);
      els.input = input;
      if (had) { try { input.focus(); if (caret) input.setSelectionRange(caret[0], caret[1]); } catch (e) {} }
      else if (inside && !back.contains(document.activeElement)) { try { els.card.focus({ preventScroll: true }); } catch (e) {} }

      if (state.ask) {
        var ask = el('div', 'aeAsk');
        ask.appendChild(el('div', 'aeAskText', state.ask.message));
        var askRow = el('div', 'aeRow');
        var yes = el('button', 'btn aeAskYes', 'Remove it and send'); yes.type = 'button';
        yes.addEventListener('click', function () { send(true); });
        var no = el('button', 'btn aeAskNo', 'Cancel'); no.type = 'button';
        no.addEventListener('click', function () { state.ask = null; render(); });
        askRow.appendChild(yes); askRow.appendChild(no);
        ask.appendChild(askRow);
        body.appendChild(ask);
      }

      if (state.link) {
        var box = el('div', 'aeLinkBox');
        box.appendChild(el('div', 'aeLinkText', (state.reason || 'Firebase did not send the email.') +
          ' Send the verification link from your own Gmail instead. The change still waits until ' + (state.change && state.change.to) + ' opens it.'));
        var lrow = el('div', 'aeRow');
        var gm = el('a', 'btn btnPrimary aeGmail', '✉ Send from my Gmail');
        gm.href = gmailUrl({ account: env.teacherEmail ? env.teacherEmail() : '', to: state.change && state.change.to, subject: mailSubject(), body: mailBody(p.name, state.change && state.change.to, state.link) });
        gm.target = '_blank'; gm.rel = 'noopener';
        var cp = el('button', 'btn aeCopy', 'Copy link'); cp.type = 'button';
        cp.addEventListener('click', function () {
          var done = function () { toast('Verification link copied.'); };
          try { navigator.clipboard.writeText(state.link).then(done, function () { toast('Could not copy — use Send from my Gmail.'); }); } catch (e) { toast('Could not copy — use Send from my Gmail.'); }
        });
        lrow.appendChild(gm); lrow.appendChild(cp);
        box.appendChild(lrow);
        body.appendChild(box);
      }

      if (state.note) body.appendChild(el('div', 'aeNote' + (state.noteKind ? ' ae' + state.noteKind : ''), state.note));

      var how = el('details', 'aeHow');
      how.appendChild(el('summary', null, 'How it works'));
      var ol = el('ol');
      ['A verification email goes to the NEW address. Nothing changes until ' + name + ' opens it — their account and sign-in stay exactly as they are.',
       'Opening the link switches the account to the new address and signs it out everywhere. The old address gets a notice, with a way to undo it.',
       'If the new address is a Google account, they sign in to Ans Key with it. The first time, their new sign-in is moved onto their own account, so their worksheets, marks and hero come with them, and the old Google account no longer opens it.',
       'Up to 5 verification emails a day per student. A link that is never opened expires after a week.'].forEach(function (t) { ol.appendChild(el('li', null, t)); });
      how.appendChild(ol);
      body.appendChild(how);
    }
    function hintFor(v) {
      var e = cleanEmail(v);
      if (!e) return 'They must be able to open this inbox.';
      if (!validEmail(e)) return 'That does not look like a full email address yet.';
      if (state.profile && sameEmail(state.profile.email, e)) return 'That is already their email.';
      return 'The verification email goes to ' + e + '.';
    }

    async function send(replaceEmpty) {
      if (!teacher()) { toast('Only the teacher can change a student’s email.'); return; }
      if (state.busy) return;
      var email = cleanEmail(els.input ? els.input.value : state.draft);
      if (!validEmail(email)) { setNote('Type the full new email address first.', 'Bad'); render(); return; }
      if (state.profile && sameEmail(state.profile.email, email)) { setNote('That is already their email.', 'Bad'); render(); return; }
      var seq = state.seq, uid = state.uid;
      state.busy = true; state.ask = null; state.link = ''; state.reason = ''; setNote('', '');
      render();
      try {
        var data = await post({ type: 'request', uid: uid, email: email, replaceEmpty: !!replaceEmpty });
        if (seq !== state.seq) return;
        state.change = data.change || null;
        state.draft = '';
        remember(uid, state.change);
        if (data.link) {
          state.link = String(data.link);
          state.reason = data.reason || '';
          setNote('', '');
        } else {
          setNote('Sent. ' + email + ' has a verification email from Firebase (check spam too). The account changes once it is opened.', 'Ok');
          toast('Verification email sent to ' + email + '.');
        }
      } catch (e) {
        if (seq !== state.seq) return;
        if (e.code === 'email_in_use_empty') { state.ask = { message: e.message }; setNote('', ''); }
        else setNote(e.message || String(e), 'Bad');
      } finally {
        if (seq === state.seq) { state.busy = false; render(); }
      }
    }
    async function withdrawChange() {
      if (!teacher()) return;
      var seq = state.seq, uid = state.uid;
      try {
        var data = await post({ type: 'cancel', uid: uid });
        if (seq !== state.seq) return;
        state.change = data.change || null; state.link = '';
        remember(uid, state.change);
        setNote('Withdrawn. The email already sent cannot be recalled; if it is opened anyway, this window will say so.', '');
      } catch (e) {
        if (seq !== state.seq) return;
        setNote(e.message || String(e), 'Bad');
      }
      render();
    }
    async function refreshOne() {
      if (!teacher() || !state.uid) return;
      var seq = state.seq, uid = state.uid;
      try {
        var data = await post({ type: 'status', uids: [uid] });
        if (seq !== state.seq) return;
        var ch = (data.changes && data.changes[uid]) || null;
        state.change = ch;
        remember(uid, ch);
        if (ch && (ch.status === 'done' || ch.status === 'moved') && state.profile) state.profile.email = ch.to;
        if (pending(ch)) setNote('Not opened yet.', '');
        else setNote('', '');
      } catch (e) {
        if (seq !== state.seq) return;
        setNote(e.message || String(e), 'Bad');
      }
      render();
    }

    /* The roster row's badge and its email line follow a finished change. */
    function remember(uid, change) {
      var b = badges[uid];
      if (!b) return;
      if (change && (change.status === 'done' || change.status === 'moved') && b.profile) {
        b.profile.email = change.to;
        if (typeof b.onEmail === 'function') b.onEmail(change.to);
      }
      b.node.textContent = badgeText(change);
      b.node.hidden = !b.node.textContent;
      b.node.title = statusText(change);
    }
    /* A badge for a roster row: empty until `refreshAll` hears about it. */
    function badge(uid, profile, onEmail) {
      var node = el('span', 'aeBadge');
      node.hidden = true;
      badges[uid] = { node: node, profile: profile, onEmail: onEmail };
      return node;
    }
    /* Asks about every student on the roster at once. This is also what
       FINISHES a change whose link has been opened. */
    async function refreshAll(uids) {
      if (!teacher()) return {};
      var list = (uids || []).filter(function (u) { return u && !/^managed_/.test(u); });
      var out = {};
      for (var i = 0; i < list.length; i += 300) {
        try {
          var data = await post({ type: 'status', uids: list.slice(i, i + 300) });
          Object.keys(data.changes || {}).forEach(function (uid) { out[uid] = data.changes[uid]; remember(uid, data.changes[uid]); });
        } catch (e) { /* the roster still works without it; the window asks again */ return out; }
      }
      return out;
    }

    function open(opts) {
      opts = opts || {};
      if (!teacher()) { toast('Only the teacher can change a student’s email.'); return false; }
      var uid = String(opts.uid || '');
      if (!uid) return false;
      if (/^managed_/.test(uid) || (opts.profile && opts.profile.managed)) { toast('This student has no Google account — they practise from your device, so there is no email to change.'); return false; }
      state.seq++;
      state.open = true; state.uid = uid; state.profile = opts.profile || {}; state.change = null;
      state.busy = false; state.ask = null; state.link = ''; state.reason = ''; state.draft = '';
      setNote('', '');
      ensureShell().classList.add('open');
      render();
      if (els.input) { try { els.input.focus(); } catch (e) {} }
      refreshOne();
      return true;
    }
    function closeView() {
      state.seq++;
      state.open = false; state.busy = false;
      if (back) {
        back.classList.remove('open');
        if (back.contains(document.activeElement)) { try { document.activeElement.blur(); } catch (e) {} }
      }
    }
    /* The device changed hands (a sign-out, Practise as): the window goes. */
    function roleChanged() { if (state.open && !teacher()) closeView(); }

    /* ---------- the student's side ---------- */
    /* Called once a student's profile has loaded. Resolves to
       { moved, message } — moved means this page must sign out and the
       student sign in again. Never throws: sign-in carries on regardless. */
    async function checkSignIn(user, profile) {
      var search = (typeof location !== 'undefined' && location.search) || '';
      var fromLink = /[?&]emailChanged=1(?:&|$)/.test(search);
      if (!needsCheck(user, profile, search)) return { moved: false };
      var key = CHECK_KEY + ':' + user.uid + ':' + cleanEmail(user.email);
      try { if (!fromLink && sessionStorage.getItem(key)) return { moved: false }; } catch (e) {}
      // App Check comes from the module script at the end of the page, which
      // can still be loading when the first auth state arrives.
      for (var tries = 0; tries < 8 && !(env.appCheckToken && typeof env.appCheckToken() === 'function'); tries++) {
        await new Promise(function (r) { setTimeout(r, 250); });
      }
      try {
        // A sign-in never waits long on this: the profile prompt is behind it.
        var data = await post({ type: 'mine' }, 8000);
        try { sessionStorage.setItem(key, '1'); } catch (e) {}
        return { moved: !!data.moved, message: data.message || '', change: data.change || null, waiting: !!data.waiting, conflict: !!data.conflict };
      } catch (e) {
        return { moved: false, message: '', error: e.message || String(e) };
      }
    }

    return {
      open: open, close: closeView, isOpen: function () { return state.open; },
      badge: badge, refreshAll: refreshAll, roleChanged: roleChanged, checkSignIn: checkSignIn
    };
  }

  /* After the link: strip ?emailChanged=1 so a reload does not ask again. */
  function stripLinkFlag(loc, hist) {
    try {
      if (!/[?&]emailChanged=1(?:&|$)/.test(loc.search)) return false;
      var q = loc.search.replace(/^\?/, '').split('&').filter(function (kv) { return kv && kv !== 'emailChanged=1'; });
      hist.replaceState(hist.state, '', loc.pathname + (q.length ? '?' + q.join('&') : '') + loc.hash);
      return true;
    } catch (e) { return false; }
  }

  return {
    ENDPOINT: ENDPOINT,
    create: create,
    stripLinkFlag: stripLinkFlag,
    pure: { cleanEmail: cleanEmail, validEmail: validEmail, sameEmail: sameEmail, pending: pending, when: when,
            statusText: statusText, badgeText: badgeText, gmailUrl: gmailUrl, mailSubject: mailSubject,
            mailBody: mailBody, needsCheck: needsCheck, errorText: errorText }
  };
});
