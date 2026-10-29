/* =====================================================================
   📚 LIVING APP LIBRARY — every living app's code, remembered, and sent
   to students' email for revision (v1.167.0)
   ---------------------------------------------------------------------
   A living app gets its own link (living.html?<code>) the first time the
   teacher hosts it — an export, a print, the stage's 📲 QR, or now simply a
   save. Until now that link lived only on the worksheet's annotation, so
   finding "the floating-and-sinking one from three weeks ago" meant opening
   worksheets one by one. The library keeps EVERY code in one place:

     users/{teacherUid}/livingApps/{contentHash}
       = { v, hash, token, title, wand, sheets: { docId: {name, level,
           subject, at} }, levels[], subjects[], lastAt, sentCount,
           lastSentAt }

   Keyed by the app's CONTENT hash, so an app on five worksheets is one
   entry naming five sheets, and a changed app is a new entry with a new
   code (a printed code can never drift onto a different app). Only the
   link's parts are kept — never the app's HTML (that is the hosted file's)
   and never anything about a student.

   📨 Sending: the teacher ticks apps and students (from studentProfiles,
   the roster every app shares) and the message opens in THEIR OWN Gmail,
   already addressed (students in Bcc so no child sees another's address),
   with a subject and one link per app. Nothing is sent by the app itself:
   the email goes from the teacher's account, so it is theirs to read over,
   and there is no mail server or key to keep.

   This file owns the window and the pure helpers (window.LivingLibrary:
   create(env), pure). index.html's glue owns Firestore, Storage and who is
   using the device; see `📚 Living app library — glue`.
   ===================================================================== */
(function (global) {
  'use strict';

  var VERSION = 1;
  var COLL = 'livingApps';
  var TITLE_MAX = 80;
  var NAME_MAX = 60;
  var NOTE_MAX = 1200;
  var SUBJECT_MAX = 120;
  var EMAIL_MAX = 254;
  var EXTRA_MAX = 60;            // typed-in addresses kept from the box
  var RECIPIENTS_MAX = 150;      // Gmail's own Bcc ceiling is far above a class
  var SHEETS_SHOWN = 3;          // sheets listed under an app before "+N more"
  var GMAIL_URL_MAX = 7600;      // past this, browsers and Gmail start to cut the link
  var MAILTO_URL_MAX = 1900;     // mail apps are far stricter than Gmail
  var GMAIL_BASE = 'https://mail.google.com/mail/';
  var LEVELS = ['P3', 'P4', 'P5', 'P6'];
  var SUBJECTS = [{ id: 'science', label: 'Science' }, { id: 'math', label: 'Maths' }];
  var DEFAULT_NOTE = 'Please revise these questions with their living apps. Open each link on a phone or computer and tap the 🪄 magic wand to bring the question alive.';
  var EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
  var HASH_RE = /^la1-\d{1,7}-[0-9a-f]{1,8}$/;     // LivingApps' contentHash, and a Firestore-safe doc id
  var TOKEN_RE = /^[0-9A-Za-z-]{16,80}$/;

  /* ---------------------------------------------------------------
     Pure helpers — no DOM, no Firebase. tools/living-library-tests.mjs
     runs every one of them in a vm.
     --------------------------------------------------------------- */

  function cleanText(s, max) {
    var t = String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
    if (max && t.length > max) t = t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
    return t;
  }
  function cleanNote(s) {
    var t = String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    t = t.split('\n').map(function (l) { return l.replace(/[ \t]+/g, ' ').replace(/\s+$/, ''); }).join('\n');
    t = t.replace(/\n{3,}/g, '\n\n').trim();
    return t.length > NOTE_MAX ? t.slice(0, NOTE_MAX) : t;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* One address, lower-cased and checked, or ''. */
  function normEmail(s) {
    var t = String(s == null ? '' : s).trim().replace(/^mailto:/i, '').replace(/^<|>$/g, '').trim().toLowerCase();
    if (!t || t.length > EMAIL_MAX || !EMAIL_RE.test(t)) return '';
    return t;
  }
  /* Whatever was typed or pasted — commas, semicolons, new lines, a pasted
     "Name <a@b.com>" — into unique, valid addresses, in the order given.
     What could not be read comes back in `bad`, so the box can say which. */
  function parseEmails(text) {
    var out = [], bad = [], seen = Object.create(null);
    String(text == null ? '' : text).split(/[\s,;]+/).forEach(function (raw) {
      if (!raw) return;
      var m = raw.match(/<([^>]+)>/);
      var e = normEmail(m ? m[1] : raw);
      if (!e) { if (/@/.test(raw) || raw.length > 2) bad.push(raw.slice(0, 80)); return; }
      if (seen[e]) return;
      seen[e] = true;
      if (out.length < EXTRA_MAX) out.push(e);
    });
    return { emails: out, bad: bad };
  }

  function validHash(h) { return typeof h === 'string' && HASH_RE.test(h); }
  function validToken(t) { return typeof t === 'string' && TOKEN_RE.test(t); }
  function validDocId(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(id); }
  function stampMs(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch (e) { return 0; } }
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    var n = Date.parse(v);
    return isFinite(n) ? n : 0;
  }
  function subjectWord(s) {
    if (s === 'math') return 'Maths';
    if (s === 'science') return 'Science';
    if (s === 'both') return 'Maths & Science';
    return '';
  }

  /* The worksheet a living app was found on, as the library keeps it. */
  function cleanSheet(sheet, now) {
    if (!sheet || !validDocId(sheet.id)) return null;
    return {
      name: cleanText(sheet.name, NAME_MAX) || 'Untitled worksheet',
      level: cleanText(sheet.level, 8),
      subject: cleanText(sheet.subject, 12),
      at: typeof now === 'number' ? now : Date.now()
    };
  }

  /* The fields one remember writes: merged into the entry with
     { merge: true }, so a second worksheet ADDS a sheet rather than
     replacing the first, and the token is always the newest. Null when
     the app has no hosted copy — there is no code to remember yet. */
  function entryWrite(app, pub, sheet, now) {
    if (!app || !pub || !validHash(pub.hash) || !validToken(pub.token)) return null;
    var t = typeof now === 'number' ? now : Date.now();
    var out = {
      v: VERSION,
      hash: pub.hash,
      token: pub.token,
      title: cleanText(app.title, TITLE_MAX) || 'Living app',
      wand: !!app.wand,
      lastAt: t
    };
    var s = cleanSheet(sheet, t);
    if (s) {
      out.sheets = {};
      out.sheets[sheet.id] = s;
    }
    return out;
  }

  /* A stored entry read back, whatever shape it arrives in — a field
     written by an older build, or by hand, cannot break the window. */
  function readEntry(id, d) {
    if (!d || typeof d !== 'object') return null;
    var hash = validHash(d.hash) ? d.hash : (validHash(id) ? id : '');
    if (!hash || !validToken(d.token)) return null;
    var sheets = [];
    var raw = d.sheets && typeof d.sheets === 'object' ? d.sheets : {};
    Object.keys(raw).forEach(function (sid) {
      if (!validDocId(sid)) return;
      var s = raw[sid] || {};
      sheets.push({ id: sid, name: cleanText(s.name, NAME_MAX) || 'Untitled worksheet', level: cleanText(s.level, 8), subject: cleanText(s.subject, 12), at: stampMs(s.at) });
    });
    sheets.sort(function (a, b) { return b.at - a.at || a.name.localeCompare(b.name); });
    var levels = [], subjects = [];
    sheets.forEach(function (s) {
      if (s.level && levels.indexOf(s.level) === -1) levels.push(s.level);
      if (s.subject && subjects.indexOf(s.subject) === -1) subjects.push(s.subject);
    });
    var lastAt = stampMs(d.lastAt);
    sheets.forEach(function (s) { if (s.at > lastAt) lastAt = s.at; });
    return {
      hash: hash,
      token: d.token,
      title: cleanText(d.title, TITLE_MAX) || 'Living app',
      wand: !!d.wand,
      sheets: sheets,
      levels: levels.sort(),
      subjects: subjects.sort(),
      lastAt: lastAt,
      sentCount: Math.max(0, Math.floor(Number(d.sentCount) || 0)),
      lastSentAt: stampMs(d.lastSentAt)
    };
  }

  /* Newest first: the app from the last lesson is the one being looked for. */
  function sortEntries(list) {
    return (list || []).slice().sort(function (a, b) {
      return (b.lastAt - a.lastAt) || a.title.localeCompare(b.title) || (a.hash < b.hash ? -1 : 1);
    });
  }

  function wordsOf(s) {
    return String(s || '').toLowerCase().split(/[^a-z0-9À-￿]+/).filter(Boolean);
  }
  /* Every word typed must match — the title or a worksheet's name — and a
     level / subject keeps only apps found on a worksheet of that kind.
     An app on a "both" worksheet counts for either subject. */
  function filterEntries(list, f) {
    f = f || {};
    var words = wordsOf(f.q);
    return (list || []).filter(function (e) {
      if (f.level && e.levels.indexOf(f.level) === -1) return false;
      if (f.subject && e.subjects.indexOf(f.subject) === -1 && e.subjects.indexOf('both') === -1) return false;
      if (!words.length) return true;
      var hay = wordsOf(e.title + ' ' + e.sheets.map(function (s) { return s.name + ' ' + s.level; }).join(' ')).join(' ');
      return words.every(function (w) { return hay.indexOf(w) !== -1; });
    });
  }

  /* Who can be emailed: students with an address (a "No Google" student
     practising on a shared device has none), narrowed by level and by
     subject the way a worksheet reaches them — "both" takes either. */
  function studentRecipients(profiles, f) {
    f = f || {};
    var seen = Object.create(null), out = [];
    (profiles || []).forEach(function (p) {
      if (!p || p.managed) return;
      var email = normEmail(p.email);
      if (!email || seen[email]) return;
      var level = cleanText(p.level, 8);
      var subject = cleanText(p.subject, 12);
      if (f.level && level !== f.level) return;
      if (f.subject && subject !== f.subject && subject !== 'both') return;
      seen[email] = true;
      out.push({ uid: cleanText(p.uid, 128), name: cleanText(p.name, NAME_MAX) || email.split('@')[0], email: email, level: level, subject: subject });
    });
    out.sort(function (a, b) {
      return (a.level || 'ZZ').localeCompare(b.level || 'ZZ') || a.name.localeCompare(b.name) || a.email.localeCompare(b.email);
    });
    return out;
  }

  /* The ticked students plus whatever was typed, one address once, and
     never the teacher's own (it is the To). */
  function mergeRecipients(students, extra, self) {
    var seen = Object.create(null), out = [];
    var me = normEmail(self);
    if (me) seen[me] = true;
    (students || []).concat(extra || []).forEach(function (e) {
      var n = normEmail(e && e.email !== undefined ? e.email : e);
      if (!n || seen[n]) return;
      seen[n] = true;
      out.push(n);
    });
    return out.slice(0, RECIPIENTS_MAX);
  }

  /* Most recent worksheet an app was on, said in words for the email. */
  function sheetLine(e) {
    var s = e && e.sheets && e.sheets[0];
    if (!s) return '';
    var bits = [s.level, subjectWord(s.subject)].filter(Boolean).join(' ');
    return (bits ? bits + ' — ' : '') + s.name;
  }

  /* The email itself: a subject naming what to revise, the teacher's note,
     then one numbered block per app — its title, where it came from and
     its link on a line of its own (a link sharing a line with words is the
     one a phone's mail app fails to make tappable). */
  function composeMessage(apps, opts) {
    opts = opts || {};
    var list = (apps || []).filter(function (a) { return a && a.url; });
    var titles = list.map(function (a) { return a.title; });
    var subject = cleanText(opts.subject, SUBJECT_MAX);
    if (!subject) {
      subject = list.length === 1 ? 'Revise: ' + titles[0]
        : list.length ? 'Revise: ' + titles[0] + ' and ' + (list.length - 1) + ' more'
        : 'Revision';
      subject = cleanText(subject, SUBJECT_MAX);
    }
    var note = cleanNote(opts.note == null ? DEFAULT_NOTE : opts.note);
    var lines = [];
    if (opts.greeting !== false) lines.push('Hi,', '');
    if (note) lines.push(note, '');
    list.forEach(function (a, i) {
      lines.push((i + 1) + '. ' + a.title);
      var from = a.from || '';
      if (from) lines.push('   From: ' + from);
      lines.push('   ' + a.url, '');
    });
    var sign = cleanText(opts.signOff, NAME_MAX);
    if (sign) lines.push(sign);
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return { subject: subject, body: lines.join('\n') };
  }

  function enc(s) { return encodeURIComponent(String(s == null ? '' : s)); }

  /* Gmail's own compose window, opened in the teacher's signed-in Gmail
     (authuser picks the right account when several are signed in). */
  function gmailUrl(m) {
    m = m || {};
    var q = ['view=cm', 'fs=1'];
    if (m.account) q.push('authuser=' + enc(m.account));
    if (m.to && m.to.length) q.push('to=' + enc([].concat(m.to).join(',')));
    if (m.bcc && m.bcc.length) q.push('bcc=' + enc([].concat(m.bcc).join(',')));
    if (m.subject) q.push('su=' + enc(m.subject));
    if (m.body) q.push('body=' + enc(m.body));
    return GMAIL_BASE + '?' + q.join('&');
  }
  /* The device's own mail app. */
  function mailtoUrl(m) {
    m = m || {};
    var q = [];
    if (m.bcc && m.bcc.length) q.push('bcc=' + enc([].concat(m.bcc).join(',')));
    if (m.subject) q.push('subject=' + enc(m.subject));
    if (m.body) q.push('body=' + enc(m.body));
    var to = m.to && m.to.length ? [].concat(m.to).map(enc).join(',') : '';
    return 'mailto:' + to + (q.length ? '?' + q.join('&') : '');
  }

  /* What a press of ✉ really opens. A link too long for Gmail is opened
     WITHOUT its body and the body goes on the clipboard instead, so the
     addresses (the part that cannot be retyped) always arrive. */
  function sendPlan(m, how) {
    var build = how === 'mailto' ? mailtoUrl : gmailUrl;
    var max = how === 'mailto' ? MAILTO_URL_MAX : GMAIL_URL_MAX;
    var full = build(m);
    if (full.length <= max) return { url: full, copyBody: false };
    var bare = build(Object.assign({}, m, { body: '' }));
    if (bare.length <= max) return { url: bare, copyBody: true };
    return { url: '', copyBody: true, tooMany: true };
  }

  /* Living apps on one worksheet's annotations, one per content hash —
     an app pasted twice is one app. `hashOf` is LivingApps' own. */
  function scanAnnotations(list, hashOf) {
    var seen = Object.create(null), out = [];
    (Array.isArray(list) ? list : []).forEach(function (a) {
      if (!a || a.type !== 'ainote' || a.kind !== 'paste' || !a.lapp || typeof a.lapp !== 'object') return;
      var html = a.lapp.html;
      if (typeof html !== 'string' || !html.trim()) return;
      var h = '';
      try { h = typeof hashOf === 'function' ? hashOf(html) : a.lapp.hash; } catch (e) { h = ''; }
      if (!validHash(h) || seen[h]) return;
      seen[h] = true;
      out.push({ hash: h, lapp: a.lapp });
    });
    return out;
  }

  /* "3 days ago" — short, for a row. */
  function agoText(ms, now) {
    if (!ms) return '';
    var d = Math.max(0, (typeof now === 'number' ? now : Date.now()) - ms);
    var m = Math.round(d / 60000);
    if (m < 2) return 'just now';
    if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + ' h ago';
    var days = Math.round(h / 24);
    if (days < 14) return days + (days === 1 ? ' day ago' : ' days ago');
    var w = Math.round(days / 7);
    if (w < 9) return w + ' weeks ago';
    var mo = Math.round(days / 30);
    return mo + (mo === 1 ? ' month ago' : ' months ago');
  }

  function countText(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  var pure = {
    VERSION: VERSION, COLL: COLL, TITLE_MAX: TITLE_MAX, RECIPIENTS_MAX: RECIPIENTS_MAX, EXTRA_MAX: EXTRA_MAX,
    GMAIL_URL_MAX: GMAIL_URL_MAX, MAILTO_URL_MAX: MAILTO_URL_MAX, LEVELS: LEVELS, SUBJECTS: SUBJECTS, DEFAULT_NOTE: DEFAULT_NOTE,
    cleanText: cleanText, cleanNote: cleanNote, escapeHtml: escapeHtml, normEmail: normEmail, parseEmails: parseEmails,
    validHash: validHash, validToken: validToken, validDocId: validDocId, stampMs: stampMs, subjectWord: subjectWord,
    cleanSheet: cleanSheet, entryWrite: entryWrite, readEntry: readEntry, sortEntries: sortEntries, filterEntries: filterEntries,
    studentRecipients: studentRecipients, mergeRecipients: mergeRecipients, sheetLine: sheetLine, composeMessage: composeMessage,
    gmailUrl: gmailUrl, mailtoUrl: mailtoUrl, sendPlan: sendPlan, scanAnnotations: scanAnnotations, agoText: agoText, countText: countText
  };

  /* ---------------------------------------------------------------
     The window.
     env = {
       teacher()            true while the teacher is the one here
       listen(cb)           live entries [{id, data}] → returns unsubscribe
       students()           Promise<[profile]> (studentProfiles rows + uid)
       scan(progress)       Promise<{sheets, apps, added, failed}> — every worksheet
       viewerUrl(hash, tok) the link a code opens
       qrSvg(url)           an <svg> string, or ''
       forget(hash)         Promise
       recordSent(hashes, n) Promise
       self()               {email, name} of the teacher
       openUrl(url)         opens a link in a new tab
       copy(text)           Promise<bool>
       toast(msg, ms)
     }
     --------------------------------------------------------------- */
  function create(env) {
    env = env || {};
    var S = null;   // the open window's state, null while closed

    function call(name) {
      var f = env[name];
      if (typeof f !== 'function') return undefined;
      return f.apply(null, Array.prototype.slice.call(arguments, 1));
    }
    function say(msg, ms) { if (typeof env.toast === 'function') env.toast(msg, ms || 3600); }
    function isTeacher() { return !!call('teacher'); }

    function el(tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }
    function button(label, cls, title, onClick) {
      var b = el('button', cls || 'llBtn', label);
      b.type = 'button';
      if (title) b.title = title;
      if (onClick) b.addEventListener('click', onClick);
      return b;
    }
    function option(sel, value, label) {
      var o = el('option', null, label);
      o.value = value;
      sel.appendChild(o);
      return o;
    }

    function open() {
      if (!isTeacher()) { say('The living app library is the teacher’s own.'); return false; }
      if (S) { S.back.querySelector('.llSearch').focus(); return true; }
      build();
      return true;
    }

    function build() {
      var back = el('div', 'llBack');
      back.setAttribute('role', 'dialog');
      back.setAttribute('aria-modal', 'true');
      back.setAttribute('aria-label', 'Living app library');
      var card = el('div', 'llCard');
      card.tabIndex = -1;
      back.appendChild(card);

      var head = el('div', 'llHead');
      var titles = el('div', 'llTitles');
      titles.appendChild(el('h2', 'llTitle', '📚 Living app library'));
      var sub = el('p', 'llSub', 'Every living app’s own link and QR code, kept as you save. Tick apps and students and they get an email to revise them.');
      titles.appendChild(sub);
      head.appendChild(titles);
      var x = button('✕', 'llClose', 'Close (Esc)', function () { close(); });
      x.setAttribute('aria-label', 'Close');
      head.appendChild(x);
      card.appendChild(head);

      var body = el('div', 'llBody');
      card.appendChild(body);

      /* ---- the apps ---- */
      var appsCol = el('section', 'llApps');
      var bar = el('div', 'llBar');
      var search = el('input', 'llSearch');
      search.type = 'search';
      search.placeholder = 'Search apps or worksheets…';
      search.setAttribute('aria-label', 'Search living apps');
      bar.appendChild(search);
      var lvl = el('select', 'llLevel');
      lvl.setAttribute('aria-label', 'Level');
      option(lvl, '', 'All levels');
      LEVELS.forEach(function (l) { option(lvl, l, l); });
      bar.appendChild(lvl);
      var subj = el('select', 'llSubject');
      subj.setAttribute('aria-label', 'Subject');
      option(subj, '', 'All subjects');
      SUBJECTS.forEach(function (s) { option(subj, s.id, s.label); });
      bar.appendChild(subj);
      appsCol.appendChild(bar);

      var tools = el('div', 'llTools');
      var allBtn = button('Select shown', 'llBtn llGhost', 'Tick every app in the list below', function () {
        S.shown.forEach(function (e) { S.picked[e.hash] = true; });
        renderApps(); renderSend();
      });
      var noneBtn = button('Clear', 'llBtn llGhost', 'Untick every app', function () {
        S.picked = Object.create(null);
        renderApps(); renderSend();
      });
      var scanBtn = button('🔎 Find on all worksheets', 'llBtn llGhost llScan', 'Look through every saved worksheet for living apps that are not in the library yet, and give each one its code', function () { runScan(); });
      tools.appendChild(allBtn);
      tools.appendChild(noneBtn);
      tools.appendChild(el('span', 'llGrow'));
      tools.appendChild(scanBtn);
      appsCol.appendChild(tools);
      var status = el('div', 'llStatus');
      status.setAttribute('aria-live', 'polite');
      appsCol.appendChild(status);
      var list = el('div', 'llList');
      appsCol.appendChild(list);
      body.appendChild(appsCol);

      /* ---- who, and what it says ---- */
      var sendCol = el('section', 'llSend');
      sendCol.appendChild(el('h3', 'llH3', '📨 Send for revision'));
      var picked = el('div', 'llPicked');
      sendCol.appendChild(picked);

      var whoHead = el('div', 'llWhoHead');
      whoHead.appendChild(el('span', 'llLabel', 'Students'));
      var whoLvl = el('select', 'llWhoLevel');
      whoLvl.setAttribute('aria-label', 'Students’ level');
      option(whoLvl, '', 'All levels');
      LEVELS.forEach(function (l) { option(whoLvl, l, l); });
      whoHead.appendChild(whoLvl);
      var whoSubj = el('select', 'llWhoSubject');
      whoSubj.setAttribute('aria-label', 'Students’ subject');
      option(whoSubj, '', 'All subjects');
      SUBJECTS.forEach(function (s) { option(whoSubj, s.id, s.label); });
      whoHead.appendChild(whoSubj);
      sendCol.appendChild(whoHead);
      var whoTools = el('div', 'llWhoTools');
      whoTools.appendChild(button('Tick all shown', 'llLink', null, function () {
        S.shownStudents.forEach(function (r) { S.who[r.email] = true; });
        renderStudents(); renderSend();
      }));
      whoTools.appendChild(button('Untick all', 'llLink', null, function () {
        S.who = Object.create(null);
        renderStudents(); renderSend();
      }));
      sendCol.appendChild(whoTools);
      var who = el('div', 'llWho');
      sendCol.appendChild(who);

      var extraLab = el('label', 'llLabel', 'Other email addresses');
      var extra = el('textarea', 'llExtra');
      extra.rows = 2;
      extra.placeholder = 'parent@example.com, another@example.com';
      extraLab.appendChild(extra);
      sendCol.appendChild(extraLab);
      var extraSaid = el('div', 'llSmall llWarn');
      sendCol.appendChild(extraSaid);

      var subjLab = el('label', 'llLabel', 'Subject');
      var subjIn = el('input', 'llSubjectLine');
      subjIn.type = 'text';
      subjIn.maxLength = SUBJECT_MAX;
      subjIn.placeholder = 'Revise: …';
      subjLab.appendChild(subjIn);
      sendCol.appendChild(subjLab);
      var noteLab = el('label', 'llLabel', 'Message');
      var note = el('textarea', 'llNote');
      note.rows = 4;
      note.maxLength = NOTE_MAX;
      note.value = DEFAULT_NOTE;
      noteLab.appendChild(note);
      sendCol.appendChild(noteLab);

      var sum = el('div', 'llSum');
      sendCol.appendChild(sum);
      var acts = el('div', 'llActs');
      var gmail = button('✉ Open in Gmail', 'llBtn llPrimary', 'Opens the email in your Gmail, addressed and written — read it over and press Send', function () { send('gmail'); });
      var mailApp = button('Mail app', 'llBtn llGhost', 'Opens the email in this device’s own mail app instead', function () { send('mailto'); });
      var copyBtn = button('📋 Copy', 'llBtn llGhost', 'Copy the message and links to paste anywhere — WhatsApp, Google Classroom…', function () { copyMessage(); });
      acts.appendChild(gmail);
      acts.appendChild(mailApp);
      acts.appendChild(copyBtn);
      sendCol.appendChild(acts);
      sendCol.appendChild(el('p', 'llSmall', 'Students go in Bcc, so nobody sees another child’s address. The email is sent from your own Gmail when you press Send there.'));
      body.appendChild(sendCol);

      S = {
        back: back, card: card, list: list, status: status, search: search, lvl: lvl, subj: subj,
        picked: Object.create(null), who: Object.create(null), entries: [], shown: [], students: [], shownStudents: [],
        studentsState: 'loading', whoBox: who, whoLvl: whoLvl, whoSubj: whoSubj, extra: extra, extraSaid: extraSaid,
        subjIn: subjIn, note: note, sum: sum, gmail: gmail, mailApp: mailApp, copyBtn: copyBtn, pickedBox: picked,
        asking: '', scanning: false, scanBtn: scanBtn, unsub: null, loaded: false, qr: Object.create(null), offKey: null
      };

      search.addEventListener('input', function () { renderApps(); });
      lvl.addEventListener('change', function () {
        // The class being revised is usually the class being emailed.
        if (!S.whoLvl.value) { S.whoLvl.value = lvl.value; renderStudents(); }
        renderApps(); renderSend();
      });
      subj.addEventListener('change', function () {
        if (!S.whoSubj.value) { S.whoSubj.value = subj.value; renderStudents(); }
        renderApps(); renderSend();
      });
      whoLvl.addEventListener('change', function () { renderStudents(); renderSend(); });
      whoSubj.addEventListener('change', function () { renderStudents(); renderSend(); });
      extra.addEventListener('input', function () { renderSend(); });
      subjIn.addEventListener('input', function () { renderSend(); });
      note.addEventListener('input', function () { renderSend(); });

      // Every key pressed in the window stays in the window: the worksheet's
      // one-letter tool shortcuts must not fire while an address is typed.
      back.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          if (S && S.asking) { S.asking = ''; renderApps(); return; }
          close();
        }
      });
      // Escape after a button the window redrew away (focus fell back to the
      // page) still belongs to the window, never to the worksheet.
      var onDocKey = function (e) {
        if (!S || S.back !== back || e.key !== 'Escape' || back.contains(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        if (S.asking) { S.asking = ''; renderApps(); return; }
        close();
      };
      window.addEventListener('keydown', onDocKey, true);
      S.offKey = function () { window.removeEventListener('keydown', onDocKey, true); };
      back.addEventListener('keyup', function (e) { e.stopPropagation(); });
      back.addEventListener('keypress', function (e) { e.stopPropagation(); });
      back.addEventListener('pointerdown', function (e) { if (e.target === back) close(); });

      document.body.appendChild(back);
      requestAnimationFrame(function () { if (S && S.back === back) back.classList.add('in'); });
      status.textContent = 'Loading the library…';
      renderApps();
      renderSend();

      var unsub = call('listen', function (rows) {
        if (!S || S.back !== back) return;
        var entries = [];
        (rows || []).forEach(function (r) {
          var e = readEntry(r && r.id, r && r.data);
          if (e) entries.push(e);
        });
        S.entries = sortEntries(entries);
        S.loaded = true;
        // An app forgotten (here or on another device) cannot stay ticked.
        Object.keys(S.picked).forEach(function (h) {
          if (!S.entries.some(function (e) { return e.hash === h; })) delete S.picked[h];
        });
        renderApps();
        renderSend();
      }, function (err) {
        if (!S || S.back !== back) return;
        S.loaded = true;
        S.status.textContent = 'Could not load the library: ' + cleanText(err && err.message || err, 160);
      });
      S.unsub = typeof unsub === 'function' ? unsub : null;

      Promise.resolve(call('students')).then(function (rows) {
        if (!S || S.back !== back) return;
        S.students = rows || [];
        S.studentsState = 'ready';
        renderStudents();
        renderSend();
      }, function (err) {
        if (!S || S.back !== back) return;
        S.studentsState = 'failed';
        S.studentsError = cleanText(err && err.message || err, 160);
        renderStudents();
        renderSend();
      });

      setTimeout(function () { if (S && S.back === back) search.focus(); }, 30);
    }

    function close() {
      if (!S) return;
      var s = S;
      S = null;
      if (s.unsub) { try { s.unsub(); } catch (e) {} }
      if (s.offKey) s.offKey();
      s.back.classList.remove('in');
      setTimeout(function () { if (s.back.parentNode) s.back.parentNode.removeChild(s.back); }, 180);
    }

    function link(e) {
      var u = '';
      try { u = call('viewerUrl', e.hash, e.token) || ''; } catch (err) { u = ''; }
      return u;
    }
    function qrFor(e) {
      if (S.qr[e.hash] !== undefined) return S.qr[e.hash];
      var svg = '';
      try { svg = call('qrSvg', link(e)) || ''; } catch (err) { svg = ''; }
      S.qr[e.hash] = svg;
      return svg;
    }

    function renderApps() {
      if (!S) return;
      var f = { q: S.search.value, level: S.lvl.value, subject: S.subj.value };
      S.shown = filterEntries(S.entries, f);
      var list = S.list;
      while (list.firstChild) list.removeChild(list.firstChild);
      if (!S.loaded) {
        S.status.textContent = 'Loading the library…';
      } else if (!S.entries.length) {
        S.status.textContent = '';
        var empty = el('div', 'llEmpty');
        empty.appendChild(el('p', null, 'No living apps in the library yet.'));
        empty.appendChild(el('p', 'llSmall', 'Every living app is added the next time its worksheet saves. 🔎 Find on all worksheets looks through the ones already saved.'));
        list.appendChild(empty);
      } else {
        var picks = Object.keys(S.picked).length;
        S.status.textContent = countText(S.shown.length, 'app') + (S.shown.length !== S.entries.length ? ' of ' + S.entries.length : '') +
          (picks ? ' · ' + picks + ' ticked' : '');
        if (!S.shown.length) list.appendChild(el('div', 'llEmpty', 'Nothing matches that. Try fewer words, or All levels.'));
      }
      S.shown.forEach(function (e) { list.appendChild(appRow(e)); });
    }

    function appRow(e) {
      var row = el('div', 'llRow' + (S.picked[e.hash] ? ' llOn' : ''));
      row.setAttribute('data-hash', e.hash);
      var tick = el('input', 'llTick');
      tick.type = 'checkbox';
      tick.checked = !!S.picked[e.hash];
      tick.setAttribute('aria-label', 'Send ' + e.title);
      tick.addEventListener('change', function () {
        if (tick.checked) S.picked[e.hash] = true; else delete S.picked[e.hash];
        row.classList.toggle('llOn', tick.checked);
        renderSend();
        var picks = Object.keys(S.picked).length;
        S.status.textContent = countText(S.shown.length, 'app') + (S.shown.length !== S.entries.length ? ' of ' + S.entries.length : '') + (picks ? ' · ' + picks + ' ticked' : '');
      });
      row.appendChild(tick);

      var qr = el('button', 'llQr');
      qr.type = 'button';
      qr.title = 'Show this app’s QR code bigger';
      var svg = qrFor(e);
      if (svg) qr.innerHTML = svg; else qr.textContent = '🪄';
      qr.addEventListener('click', function () { row.classList.toggle('llQrBig'); });
      row.appendChild(qr);

      var main = el('div', 'llMain');
      var t = el('div', 'llAppTitle', e.title + (e.wand ? '  🪄' : ''));
      main.appendChild(t);
      var sheets = el('div', 'llSheets');
      e.sheets.slice(0, SHEETS_SHOWN).forEach(function (s) {
        var chip = el('span', 'llSheet');
        var tag = [s.level, subjectWord(s.subject)].filter(Boolean).join(' ');
        if (tag) chip.appendChild(el('b', null, tag));
        chip.appendChild(document.createTextNode(s.name));
        sheets.appendChild(chip);
      });
      if (e.sheets.length > SHEETS_SHOWN) sheets.appendChild(el('span', 'llSheet llMore', '+' + (e.sheets.length - SHEETS_SHOWN) + ' more'));
      if (!e.sheets.length) sheets.appendChild(el('span', 'llSheet llMore', 'Not on a saved worksheet'));
      main.appendChild(sheets);
      var meta = [];
      if (e.lastAt) meta.push('Last on a worksheet ' + agoText(e.lastAt));
      if (e.sentCount) meta.push('emailed ' + countText(e.sentCount, 'time') + (e.lastSentAt ? ', last ' + agoText(e.lastSentAt) : ''));
      main.appendChild(el('div', 'llMeta', meta.join(' · ')));
      row.appendChild(main);

      var side = el('div', 'llRowActs');
      if (S.asking === e.hash) {
        side.appendChild(el('span', 'llAsk', 'Forget this app’s code? Printed codes still open it.'));
        side.appendChild(button('Cancel', 'llBtn llGhost', null, function () { S.asking = ''; renderApps(); }));
        side.appendChild(button('Forget', 'llBtn llDanger', null, function () { forget(e); }));
      } else {
        side.appendChild(button('▶ Open', 'llBtn llGhost', 'Open the app as a student will', function () {
          var u = link(e);
          if (u) call('openUrl', u);
        }));
        side.appendChild(button('🔗 Copy link', 'llBtn llGhost', 'Copy this app’s own link', function () {
          var u = link(e);
          Promise.resolve(call('copy', u)).then(function (ok) { say(ok ? 'Link copied — it opens this app alone.' : u, ok ? 2600 : 9000); });
        }));
        side.appendChild(button('✕', 'llBtn llGhost llForget', 'Forget this app (its printed codes keep working)', function () { S.asking = e.hash; renderApps(); }));
      }
      row.appendChild(side);
      return row;
    }

    function forget(e) {
      if (!isTeacher()) { say('Only the teacher can change the library.'); return; }
      S.asking = '';
      delete S.picked[e.hash];
      Promise.resolve(call('forget', e.hash)).then(function () {
        say('Forgotten. Printed codes for it still open the app.', 3200);
      }, function (err) {
        say('Could not forget that just now: ' + cleanText(err && err.message || err, 120), 5000);
      });
      renderApps();
      renderSend();
    }

    function renderStudents() {
      if (!S) return;
      var box = S.whoBox;
      while (box.firstChild) box.removeChild(box.firstChild);
      if (S.studentsState === 'loading') { box.appendChild(el('div', 'llSmall', 'Loading students…')); S.shownStudents = []; return; }
      if (S.studentsState === 'failed') {
        box.appendChild(el('div', 'llSmall llWarn', 'Could not load the students' + (S.studentsError ? ': ' + S.studentsError : '') + '. Type their addresses below instead.'));
        S.shownStudents = [];
        return;
      }
      S.shownStudents = studentRecipients(S.students, { level: S.whoLvl.value, subject: S.whoSubj.value });
      if (!S.shownStudents.length) {
        box.appendChild(el('div', 'llSmall', S.students.length
          ? 'No student with an email address in this group. Students who sign in with Google have one; type any others below.'
          : 'No students yet — they appear here after their first Google sign-in.'));
        return;
      }
      S.shownStudents.forEach(function (r) {
        var lab = el('label', 'llStudent' + (S.who[r.email] ? ' llOn' : ''));
        var cb = el('input');
        cb.type = 'checkbox';
        cb.checked = !!S.who[r.email];
        cb.addEventListener('change', function () {
          if (cb.checked) S.who[r.email] = true; else delete S.who[r.email];
          lab.classList.toggle('llOn', cb.checked);
          renderSend();
        });
        lab.appendChild(cb);
        var txt = el('span', 'llStuText');
        txt.appendChild(el('span', 'llStuName', r.name));
        txt.appendChild(el('span', 'llStuMeta', [r.level, subjectWord(r.subject)].filter(Boolean).join(' ') + ' · ' + r.email));
        lab.appendChild(txt);
        box.appendChild(lab);
      });
    }

    /* The apps ticked, newest first, with their links. */
    function pickedApps() {
      return S.entries.filter(function (e) { return S.picked[e.hash]; }).map(function (e) {
        return { hash: e.hash, title: e.title, url: link(e), from: sheetLine(e) };
      }).filter(function (a) { return a.url; });
    }
    function pickedStudents() {
      return S.students.length ? studentRecipients(S.students, {}).filter(function (r) { return S.who[r.email]; }) : [];
    }
    function message() {
      var me = call('self') || {};
      return composeMessage(pickedApps(), { subject: S.subjIn.value, note: S.note.value, signOff: me.name || '' });
    }

    function renderSend() {
      if (!S) return;
      var apps = pickedApps();
      var box = S.pickedBox;
      while (box.firstChild) box.removeChild(box.firstChild);
      if (!apps.length) box.appendChild(el('div', 'llSmall', 'Tick the apps to revise in the list.'));
      apps.forEach(function (a) {
        var chip = el('span', 'llChip', a.title);
        var x = button('✕', 'llChipX', 'Untick ' + a.title, function () { delete S.picked[a.hash]; renderApps(); renderSend(); });
        chip.appendChild(x);
        box.appendChild(chip);
      });
      var parsed = parseEmails(S.extra.value);
      S.extraSaid.textContent = parsed.bad.length ? 'Not an email address: ' + parsed.bad.slice(0, 4).join(', ') + (parsed.bad.length > 4 ? '…' : '') : '';
      var me = call('self') || {};
      var to = mergeRecipients(pickedStudents(), parsed.emails, me.email);
      var m = message();
      if (!S.subjIn.value) S.subjIn.placeholder = m.subject;
      var ready = apps.length > 0 && to.length > 0;
      S.sum.textContent = apps.length
        ? countText(apps.length, 'app') + ' → ' + (to.length ? countText(to.length, 'person', 'people') : 'nobody yet — tick students or type an address')
        : '';
      S.gmail.disabled = !ready;
      S.mailApp.disabled = !ready;
      S.copyBtn.disabled = !apps.length;
    }

    function send(how) {
      if (!S) return;
      if (!isTeacher()) { say('Sending revision emails is the teacher’s own.'); return; }
      var apps = pickedApps();
      var me = call('self') || {};
      var to = mergeRecipients(pickedStudents(), parseEmails(S.extra.value).emails, me.email);
      if (!apps.length) { say('Tick at least one app to revise.'); return; }
      if (!to.length) { say('Tick a student, or type an email address.'); return; }
      var m = message();
      var fields = { account: me.email || '', to: me.email ? [me.email] : [], bcc: to, subject: m.subject, body: m.body };
      var plan = sendPlan(fields, how);
      if (plan.tooMany) {
        say('That is too many addresses for one email link. Send to fewer students at a time.', 6000);
        return;
      }
      var go = function () {
        call('openUrl', plan.url);
        Promise.resolve(call('recordSent', apps.map(function (a) { return a.hash; }), to.length)).catch(function () {});
      };
      if (plan.copyBody) {
        Promise.resolve(call('copy', m.body)).then(function (ok) {
          say(ok ? 'The message is long, so it is on the clipboard — paste it into the email.' : 'The message is too long for an email link — use 📋 Copy and paste it in.', 7000);
          go();
        });
        return;
      }
      go();
      say(how === 'mailto' ? 'Opening your mail app — check it and press Send.' : 'Opening Gmail — check it and press Send.', 4200);
    }

    function copyMessage() {
      if (!S) return;
      var apps = pickedApps();
      if (!apps.length) { say('Tick at least one app first.'); return; }
      var m = message();
      Promise.resolve(call('copy', m.subject + '\n\n' + m.body)).then(function (ok) {
        say(ok ? 'Copied — paste it into a message, WhatsApp or Google Classroom.' : 'Could not reach the clipboard on this device.', 4000);
      });
    }

    function runScan() {
      if (!S || S.scanning) return;
      if (!isTeacher()) { say('Only the teacher can search the worksheets.'); return; }
      var s = S;
      s.scanning = true;
      s.scanBtn.disabled = true;
      s.scanBtn.textContent = '🔎 Looking…';
      Promise.resolve(call('scan', function (done, total) {
        if (S !== s) return;
        s.scanBtn.textContent = '🔎 ' + done + ' / ' + total;
      })).then(function (r) {
        r = r || {};
        var bits = [countText(r.sheets || 0, 'worksheet') + ' read', countText(r.apps || 0, 'living app') + ' found'];
        if (r.added) bits.push(r.added + ' new to the library');
        if (r.failed) bits.push(r.failed + ' could not be read');
        say('🔎 ' + bits.join(' · '), 6000);
      }, function (err) {
        say('Could not look through the worksheets: ' + cleanText(err && err.message || err, 140), 6000);
      }).then(function () {
        s.scanning = false;
        if (S !== s) return;
        s.scanBtn.disabled = false;
        s.scanBtn.textContent = '🔎 Find on all worksheets';
      });
    }

    return {
      open: open,
      close: close,
      isOpen: function () { return !!S; },
      // A different person at the device, or the teacher handing it over:
      // the window and its live listener go.
      roleChanged: function () { if (S && !isTeacher()) close(); },
      _state: function () { return S; }
    };
  }

  global.LivingLibrary = { create: create, pure: pure };
})(typeof window !== 'undefined' ? window : globalThis);
