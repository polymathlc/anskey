/* =====================================================================
   live-class.js — 🎥 the live class: a video lesson inside Ans Key (v1.207.0)
   ---------------------------------------------------------------------
   Zoom on one screen and Ans Key on another was too much for some
   students. This puts the class INSIDE the app: the teacher's camera and
   shared screen, every student's camera, and questions the teacher pushes
   that pop up over the video on the student's screen. The teacher sees
   every answer in one board, marks it, gives points through the reward
   roster, and ends the lesson with a participation report for each
   student's parent.

   THE MEDIA is LiveKit (LiveKit Cloud, Singapore). The browser never holds
   a LiveKit secret: functions/live-class.js signs a short token for ONE
   identity in ONE room. Identities are the server's, so a student can never
   pose as the teacher (`t:`), a roster child is `r:<students doc id>` (their
   marks land on the same record the wheel uses) and a trial child is
   `g:<device account>`.

   QUESTIONS AND ANSWERS travel as LiveKit data messages (topic "plc"),
   reliable, and are made robust for weak wifi on top of that:
     • a student's answer waits in an OUTBOX (sessionStorage) and is sent
       again until the teacher's device acknowledges it — a dropped link, a
       teacher whose tab reloaded, a student who rejoined, all still arrive;
     • a student who (re)joins says "hello" and the teacher's device sends
       back every open question meant for them;
     • pictures (a question's worksheet snip, a student's photo of their
       working) go in numbered chunks under the data channel's size limit.

   THE TEACHER'S BOARD is the record: it is saved to the teacher's own tree
   (users/{uid}/liveClass/{epoch}) by the glue, so a reload restores it.

   Pure helpers live on LiveClass.pure (tools/live-class-tests.mjs runs
   them under node). create(env) builds the window. Everything a student or
   a question wrote is put on screen with textContent, never as markup.
   ===================================================================== */
(function (root) {
  'use strict';

  var VERSION = '1.207.0';
  var TOPIC = 'plc';
  var KINDS = ['mcq', 'blank', 'open'];
  var KIND_LABEL = { mcq: 'Multiple choice', blank: 'Fill in the blank', open: 'Open-ended' };
  var LIMITS = {
    text: 600,
    option: 140,
    options: 6,
    accepted: 8,
    answer: 1200,
    name: 60,
    chunk: 12000,          // characters per data message (LiveKit's reliable limit is ~15 KiB)
    imageChars: 900000,    // ~650 KB of JPEG as a data URL, the most one picture may be
    photoPx: 1100,
    questionImgPx: 1400,
    questions: 120,
    resendMs: 4000,
    ackWaitMs: 15000,
    helloMs: 6000,
    poorLowDataMs: 12000,
    rejoinTries: 6
  };
  var WIN_KEY = 'polymath.liveClass.win.v1';
  var PREF_KEY = 'polymath.liveClass.prefs.v1';
  var OUTBOX_PREFIX = 'polymath.liveClass.outbox.v1:';
  var PICK_KEY = 'polymath.liveClass.pick.v1';

  /* ================================================================
     PURE HELPERS
     ================================================================ */

  function str(v) { return v == null ? '' : String(v); }
  function clean(v, max) {
    return str(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);
  }
  function oneLine(v, max) { return str(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
  function randomId(prefix) {
    var a = '';
    try {
      var b = new Uint8Array(9);
      (root.crypto || globalThis.crypto).getRandomValues(b);
      for (var i = 0; i < b.length; i++) a += ('0' + b[i].toString(16)).slice(-2);
    } catch (e) {
      a = Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
    return (prefix || '') + a.slice(0, 16);
  }
  function validId(id) { return /^[A-Za-z0-9_-]{1,64}$/.test(str(id)); }
  function validIdentity(id) { return /^[trg]:[A-Za-z0-9_-]{1,128}$/.test(str(id)); }
  function roleOfIdentity(id) {
    var c = str(id).charAt(0);
    return c === 't' ? 'teacher' : c === 'r' || c === 'g' ? 'student' : '';
  }
  function letter(i) { return String.fromCharCode(65 + i); }

  // A data URL we will draw: JPEG / PNG / WebP pictures only, never markup.
  function validImage(d) {
    var s = str(d);
    return s.length > 30 && s.length <= LIMITS.imageChars && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s);
  }

  // THE ONE DOOR into a question, on BOTH sides: the teacher's composer
  // builds one through it, and a student's device rebuilds what arrived
  // through it, so a malformed message can never draw a broken pop-up.
  function cleanQuestion(q) {
    if (!q || typeof q !== 'object') return null;
    var kind = KINDS.indexOf(q.kind) !== -1 ? q.kind : '';
    if (!kind) return null;
    var id = validId(q.id) ? q.id : '';
    if (!id) return null;
    var text = clean(q.text, LIMITS.text);
    var out = { id: id, kind: kind, text: text, at: Number(q.at) || 0, n: Math.max(0, Math.min(999, Math.floor(Number(q.n) || 0))) };
    if (kind === 'mcq') {
      var opts = (Array.isArray(q.options) ? q.options : []).map(function (o) { return oneLine(o, LIMITS.option); });
      while (opts.length && !opts[opts.length - 1]) opts.pop();
      opts = opts.slice(0, LIMITS.options).map(function (o, i) { return o || letter(i); });
      if (opts.length < 2) return null;
      out.options = opts;
      var ans = q.answer == null || q.answer === '' ? -1 : Math.floor(Number(q.answer));
      out.answer = ans >= 0 && ans < opts.length ? ans : -1;
    } else if (kind === 'blank') {
      var acc = Array.isArray(q.accepted) ? q.accepted : str(q.accepted).split(/[|\n]/);
      out.accepted = acc.map(function (a) { return oneLine(a, LIMITS.option); }).filter(Boolean).slice(0, LIMITS.accepted);
    } else {
      out.photo = q.photo !== false;
      var model = clean(q.model, LIMITS.text);
      if (model) out.model = model;
    }
    if (!text && !q.img) return null;
    if (q.img && typeof q.img === 'object' && validId(q.img.ref)) out.img = { ref: q.img.ref, n: Math.max(1, Math.min(200, Number(q.img.n) || 1)) };
    var to = q.to;
    if (Array.isArray(to)) {
      out.to = to.filter(validIdentity).filter(function (id) { return roleOfIdentity(id) === 'student'; }).slice(0, 200);
      if (!out.to.length) out.to = 'all';
    } else {
      out.to = 'all';
    }
    out.open = q.open !== false;
    return out;
  }
  // The part of a question a STUDENT's device is sent: never the answer.
  function questionForStudent(q) {
    var c = cleanQuestion(q);
    if (!c) return null;
    var out = { id: c.id, kind: c.kind, text: c.text, at: c.at, n: c.n, open: c.open };
    if (c.options) out.options = c.options.slice();
    if (c.kind === 'open') out.photo = c.photo;
    if (c.img) out.img = { ref: c.img.ref, n: c.img.n };
    return out;
  }
  function meantFor(q, identity) {
    if (!q) return false;
    return q.to === 'all' || (Array.isArray(q.to) && q.to.indexOf(identity) !== -1);
  }

  // An answer: an option index, a few words, or a paragraph (+ a photo).
  function cleanAnswer(kind, value) {
    if (kind === 'mcq') {
      var i = Math.floor(Number(value));
      return isFinite(i) && i >= 0 && i < LIMITS.options ? i : null;
    }
    if (kind === 'blank') { var b = oneLine(value, 200); return b || null; }
    if (kind === 'open') { var o = clean(str(value).replace(/\r\n?/g, '\n'), LIMITS.answer); return o; }
    return null;
  }

  // Fill-in-the-blank marking. Generous on the things a child cannot see as
  // different (case, spaces, a full stop, "the"), exact on the thing that
  // matters (the word or the number). "0.5", ".5" and "1/2" are one number;
  // "3 cm" matches an accepted "3" only when the teacher wrote no unit.
  function normAnswer(s) {
    return oneLine(s, 200).toLowerCase()
      .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
      .replace(/^(the|a|an)\s+/, '')
      .replace(/[.!?;:,]+$/, '')
      .replace(/\s*([+\-×x*÷/=])\s*/g, '$1')
      .replace(/\s+/g, ' ').trim();
  }
  function numberOf(s) {
    // A mixed number first ("1 1/2"), before the spaces are taken out and
    // it reads as 11/2.
    var m = /^([+-]?\d+)\s+(\d+)\/(\d+)$/.exec(str(s).trim());
    if (m && Number(m[3]) !== 0) return Number(m[1]) + (/^-/.test(m[1]) ? -1 : 1) * Number(m[2]) / Number(m[3]);
    var t = str(s).replace(/,(?=\d{3}\b)/g, '').replace(/\s+/g, '');
    m = /^([+-]?\d+)\/(\d+)$/.exec(t);
    if (m && Number(m[2]) !== 0) return Number(m[1]) / Number(m[2]);
    if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return Number(t);
    return null;
  }
  function splitUnit(s) {
    var m = /^\s*([+-]?[\d.,/ ]*\d)\s*([a-z°%$¢µ²³/]+[a-z0-9²³]*)?\s*$/i.exec(str(s));
    if (!m) return null;
    var n = numberOf(m[1]);
    return n == null ? null : { n: n, unit: (m[2] || '').toLowerCase() };
  }
  function blankMatches(accepted, value) {
    var v = normAnswer(value);
    if (!v) return false;
    for (var i = 0; i < accepted.length; i++) {
      var a = normAnswer(accepted[i]);
      if (!a) continue;
      if (a === v) return true;
      var na = splitUnit(a), nv = splitUnit(v);
      if (na && nv && Math.abs(na.n - nv.n) <= 1e-9 * Math.max(1, Math.abs(na.n))) {
        if (!na.unit || na.unit === nv.unit) return true;
      }
    }
    return false;
  }
  // true / false when the device can tell, null when only the teacher can.
  function autoMark(q, value) {
    if (!q) return null;
    if (q.kind === 'mcq') return q.answer >= 0 && value != null ? Number(value) === q.answer : null;
    if (q.kind === 'blank') return q.accepted && q.accepted.length && value != null ? blankMatches(q.accepted, value) : null;
    return null;
  }
  function answerText(q, value) {
    if (!q || value == null) return '';
    if (q.kind === 'mcq') {
      var i = Number(value);
      return q.options && q.options[i] != null ? letter(i) + '. ' + q.options[i] : '';
    }
    return str(value);
  }

  /* ---------- messages ---------- */
  function encode(msg) {
    var text = JSON.stringify(msg);
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text);
    var out = new Uint8Array(text.length);
    for (var i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 255;
    return out;
  }
  function decode(bytes) {
    try {
      var text = typeof TextDecoder === 'function' ? new TextDecoder().decode(bytes) : String.fromCharCode.apply(null, bytes);
      if (text.length > 64000) return null;
      var m = JSON.parse(text);
      return m && typeof m === 'object' && typeof m.t === 'string' ? m : null;
    } catch (e) { return null; }
  }
  // A picture in pieces small enough for one reliable data message each.
  function chunkImage(dataUrl, ref, size) {
    size = size || LIMITS.chunk;
    var s = str(dataUrl), n = Math.max(1, Math.ceil(s.length / size)), out = [];
    for (var i = 0; i < n; i++) out.push({ t: 'img', ref: ref, i: i, n: n, d: s.slice(i * size, (i + 1) * size) });
    return out;
  }
  // Collects pieces; returns the whole picture once every piece is in.
  function makeAssembler() {
    var parts = {};
    return {
      add: function (m) {
        if (!m || !validId(m.ref) || typeof m.d !== 'string') return null;
        var n = Math.floor(Number(m.n)), i = Math.floor(Number(m.i));
        if (!(n >= 1 && n <= 200 && i >= 0 && i < n)) return null;
        var p = parts[m.ref] || (parts[m.ref] = { n: n, got: {}, count: 0, at: Date.now() });
        if (p.n !== n) return null;
        if (p.got[i] == null) { p.got[i] = m.d; p.count++; }
        if (p.count < n) return null;
        var whole = '';
        for (var k = 0; k < n; k++) whole += p.got[k];
        delete parts[m.ref];
        return validImage(whole) ? whole : null;
      },
      has: function (ref) { return !!parts[ref]; },
      sweep: function (maxAgeMs) {
        var now = Date.now();
        Object.keys(parts).forEach(function (k) { if (now - parts[k].at > maxAgeMs) delete parts[k]; });
      }
    };
  }

  /* ---------- the student's outbox ---------- */
  // Pending answers keyed by answer id. An answer is dropped only when the
  // teacher's device has acknowledged it, or when a newer answer to the SAME
  // question replaces it.
  function outboxAdd(box, entry) {
    var next = {};
    Object.keys(box || {}).forEach(function (k) { if (box[k] && box[k].qid !== entry.qid) next[k] = box[k]; });
    next[entry.aid] = entry;
    return next;
  }
  function outboxAck(box, aid) {
    var next = {};
    Object.keys(box || {}).forEach(function (k) { if (k !== aid) next[k] = box[k]; });
    return next;
  }
  function outboxDue(box, now, everyMs) {
    return Object.keys(box || {}).map(function (k) { return box[k]; })
      .filter(function (e) { return e && (!e.sentAt || now - e.sentAt >= everyMs); })
      .sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
  }

  /* ---------- the teacher's record of the lesson ---------- */
  function emptySession(epoch, slot, startedAt) {
    return { v: 1, epoch: Number(epoch) || 0, slot: str(slot), startedAt: Number(startedAt) || 0, endedAt: 0,
      questions: [], answers: {}, people: {}, notes: {} };
  }
  function cleanPerson(p) {
    return {
      identity: str(p.identity), name: oneLine(p.name, LIMITS.name) || 'Student', kind: ['roster', 'makeup', 'trial'].indexOf(p.kind) !== -1 ? p.kind : 'roster',
      rosterId: validId(p.rosterId) || /^[A-Za-z0-9_-]{1,128}$/.test(str(p.rosterId)) ? str(p.rosterId) : '',
      home: oneLine(p.home, 120), joinedAt: Number(p.joinedAt) || 0, leftAt: Number(p.leftAt) || 0,
      ms: Number(p.ms) || 0, hands: Number(p.hands) || 0, here: !!p.here, since: Number(p.since) || 0
    };
  }
  // A participant arriving or leaving: presence is counted in milliseconds so
  // a child who drops out on weak wifi and comes back keeps every minute.
  function personJoined(session, info, now) {
    var id = str(info.identity);
    if (!validIdentity(id) || roleOfIdentity(id) !== 'student') return session;
    var prev = session.people[id] ? cleanPerson(session.people[id]) : cleanPerson({ identity: id, joinedAt: now });
    var p = cleanPerson(Object.assign({}, prev, {
      name: info.name || prev.name, kind: info.kind || prev.kind, rosterId: info.rosterId || prev.rosterId, home: info.home || prev.home
    }));
    if (!p.here) { p.here = true; p.since = now; }
    if (!p.joinedAt) p.joinedAt = now;
    var people = Object.assign({}, session.people); people[id] = p;
    return Object.assign({}, session, { people: people });
  }
  function personLeft(session, identity, now) {
    var p = session.people[identity];
    if (!p || !p.here) return session;
    var q = cleanPerson(p);
    q.ms += Math.max(0, now - (q.since || now)); q.here = false; q.since = 0; q.leftAt = now;
    var people = Object.assign({}, session.people); people[identity] = q;
    return Object.assign({}, session, { people: people });
  }
  function minutesPresent(p, now) {
    if (!p) return 0;
    var ms = (Number(p.ms) || 0) + (p.here && p.since ? Math.max(0, now - p.since) : 0);
    return Math.round(ms / 60000);
  }
  // An answer arriving at the teacher's device. Returns the new session and
  // whether this was news (a resend of an answer already held is not).
  function recordAnswer(session, identity, msg, now) {
    var q = null;
    for (var i = 0; i < session.questions.length; i++) if (session.questions[i].id === msg.qid) q = session.questions[i];
    if (!q || !validIdentity(identity) || !validId(msg.aid)) return { session: session, fresh: false, reason: 'unknown' };
    var byQ = session.answers[q.id] || {};
    var had = byQ[identity];
    if (had && had.aid === msg.aid) return { session: session, fresh: false, reason: 'duplicate', entry: had };
    if (!q.open) return { session: session, fresh: false, reason: 'closed', entry: had };
    var value = cleanAnswer(q.kind, msg.v);
    var hasPhoto = !!msg.ph && validId(msg.ph);
    if ((value == null || value === '') && !hasPhoto) return { session: session, fresh: false, reason: 'empty' };
    var entry = { aid: msg.aid, v: value, at: now, sentAt: Number(msg.at) || now, auto: autoMark(q, value), ok: null, pts: 0, ph: hasPhoto ? msg.ph : '', edits: had ? (had.edits || 0) + 1 : 0 };
    if (had) { entry.ok = null; entry.pts = had.pts || 0; }
    var nb = Object.assign({}, byQ); nb[identity] = entry;
    var answers = Object.assign({}, session.answers); answers[q.id] = nb;
    return { session: Object.assign({}, session, { answers: answers }), fresh: true, entry: entry };
  }
  function markOf(entry) {
    if (!entry) return null;
    if (entry.ok === true || entry.ok === false) return entry.ok;
    return entry.auto === true || entry.auto === false ? entry.auto : null;
  }
  function questionStats(session, q, present) {
    var byQ = session.answers[q.id] || {};
    var ids = Object.keys(byQ);
    var right = 0, wrong = 0, unmarked = 0;
    ids.forEach(function (id) { var m = markOf(byQ[id]); if (m === true) right++; else if (m === false) wrong++; else unmarked++; });
    var asked = (present || []).filter(function (id) { return meantFor(q, id); });
    var waiting = asked.filter(function (id) { return !byQ[id]; });
    return { answered: ids.length, right: right, wrong: wrong, unmarked: unmarked, asked: asked.length, waiting: waiting };
  }
  // Everyone the lesson saw, present or not, sorted by name.
  function roster(session) {
    return Object.keys(session.people).map(function (k) { return cleanPerson(session.people[k]); })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }); });
  }

  /* ---------- the parent's participation report ---------- */
  function fmtDate(ms) {
    var d = new Date(Number(ms) || Date.now());
    var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return days[d.getDay()] + ' ' + d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }
  function participation(session, identity, now) {
    var p = session.people[identity] ? cleanPerson(session.people[identity]) : null;
    if (!p) return null;
    var asked = session.questions.filter(function (q) { return meantFor(q, identity) && (q.at || 0) >= (p.joinedAt || 0) - 60000; });
    var rows = asked.map(function (q) {
      var e = (session.answers[q.id] || {})[identity];
      return { q: q, entry: e || null, mark: markOf(e), text: e ? answerText(q, e.v) : '', photo: !!(e && e.ph) };
    });
    var answered = rows.filter(function (r) { return r.entry; }).length;
    var right = rows.filter(function (r) { return r.mark === true; }).length;
    var marked = rows.filter(function (r) { return r.mark === true || r.mark === false; }).length;
    var pts = rows.reduce(function (s, r) { return s + (r.entry && r.entry.pts ? r.entry.pts : 0); }, 0);
    return {
      name: p.name, kind: p.kind, rosterId: p.rosterId, minutes: minutesPresent(p, now),
      asked: asked.length, answered: answered, right: right, marked: marked, hands: p.hands || 0, points: pts,
      note: oneLine((session.notes || {})[identity], 400), rows: rows
    };
  }
  // One encouraging, factual sentence: what a parent can act on.
  function participationLine(r) {
    if (!r) return '';
    if (!r.asked) return r.name + ' attended for ' + r.minutes + ' minute' + (r.minutes === 1 ? '' : 's') + '. No questions were asked in class while they were there.';
    var part = r.answered === r.asked ? 'answered every question asked in class (' + r.asked + ')'
      : r.answered ? 'answered ' + r.answered + ' of the ' + r.asked + ' questions asked in class'
      : 'did not answer the ' + r.asked + ' question' + (r.asked === 1 ? '' : 's') + ' asked in class';
    var acc = r.marked ? ', getting ' + r.right + ' of ' + r.marked + ' marked answer' + (r.marked === 1 ? '' : 's') + ' right' : '';
    return r.name + ' ' + part + acc + '.';
  }
  function reportText(session, identity, now, centre) {
    var r = participation(session, identity, now);
    if (!r) return '';
    var lines = [];
    lines.push('Dear Parent,');
    lines.push('');
    lines.push('Here is how ' + r.name + ' took part in today\'s live class (' + fmtDate(session.startedAt || now) + (session.slotLabel || session.slot ? ', ' + (session.slotLabel || session.slot) : '') + ').');
    lines.push('');
    lines.push('• Time in class: ' + r.minutes + ' minute' + (r.minutes === 1 ? '' : 's'));
    lines.push('• Questions answered: ' + r.answered + ' of ' + r.asked);
    if (r.marked) lines.push('• Correct: ' + r.right + ' of ' + r.marked + ' marked');
    if (r.hands) lines.push('• Raised a hand to ask or answer: ' + r.hands + ' time' + (r.hands === 1 ? '' : 's'));
    if (r.points) lines.push('• Points earned in class: ' + r.points);
    if (r.rows.length) {
      lines.push('');
      lines.push('Questions in class:');
      r.rows.forEach(function (row, i) {
        var label = 'Q' + (row.q.n || i + 1) + (row.q.text ? ': ' + oneLine(row.q.text, 140) : ' (picture question)');
        var said = row.entry ? (row.text ? '“' + oneLine(row.text, 200) + '”' : '') + (row.photo ? (row.text ? ' + ' : '') + 'a photo of the working' : '') : 'no answer';
        var mk = row.mark === true ? ' ✓' : row.mark === false ? ' ✗' : '';
        lines.push('  ' + label);
        lines.push('     ' + said + mk);
      });
    }
    if (r.note) { lines.push(''); lines.push('Teacher\'s note: ' + r.note); }
    lines.push('');
    lines.push(participationLine(r));
    lines.push('');
    lines.push('Warm regards,');
    lines.push(centre || 'Polymath Learning Centre');
    return lines.join('\n');
  }
  function escapeHtml(s) {
    return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  // The same report as a plain, email-safe HTML body (every field escaped).
  function reportHtml(text) {
    return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222">' +
      str(text).split('\n').map(function (line) { return line ? escapeHtml(line) : '&nbsp;'; }).join('<br>') + '</div>';
  }

  /* ---------- layout ---------- */
  // Columns for a grid of n tiles in a w × h box, the shape that leaves the
  // tiles largest at 16:9.
  function gridFor(n, w, h) {
    n = Math.max(1, n | 0); w = Math.max(1, w); h = Math.max(1, h);
    var best = { cols: 1, rows: n, size: 0 };
    for (var cols = 1; cols <= n; cols++) {
      var rows = Math.ceil(n / cols);
      var tw = w / cols, th = h / rows;
      var size = Math.min(tw, th * 16 / 9);
      if (size > best.size) best = { cols: cols, rows: rows, size: size };
    }
    return best;
  }
  function clampBox(box, vw, vh, minW, minH) {
    minW = minW || 300; minH = minH || 220;
    var w = Math.max(minW, Math.min(vw - 16, Number(box.w) || 720));
    var h = Math.max(minH, Math.min(vh - 16, Number(box.h) || 480));
    var x = Math.max(8, Math.min(vw - w - 8, Number(box.x) || (vw - w - 16)));
    var y = Math.max(8, Math.min(vh - h - 8, Number(box.y) || 72));
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  }
  // A network quality word a child understands, from LiveKit's ConnectionQuality.
  function qualityWord(q) {
    q = str(q).toLowerCase();
    return q === 'excellent' ? 'Strong' : q === 'good' ? 'Good' : q === 'poor' ? 'Weak' : q === 'lost' ? 'Lost' : '';
  }
  // Per-role publishing choices. Students on weak wifi send a small picture;
  // the teacher's camera and screen get more.
  function publishPlan(role, lowData) {
    if (role === 'teacher') return { camera: 'h540', layers: ['h180', 'h360'], screen: 'h1080fps15', screenLayers: ['h720fps5'] };
    return lowData ? { camera: 'h180', layers: ['h90'] } : { camera: 'h360', layers: ['h90', 'h180'] };
  }
  // Which remote tracks a student's device receives. The teacher always;
  // classmates only when asked; in low-data mode the teacher's CAMERA is
  // dropped (the screen and the voice are the lesson).
  function wantTrack(myRole, prefs, publisherIdentity, source) {
    var pubRole = roleOfIdentity(publisherIdentity);
    if (myRole === 'teacher') return true;
    if (pubRole === 'teacher') {
      if (source === 'camera' && prefs && prefs.lowData) return false;
      return true;
    }
    if (source === 'microphone') return true;      // a classmate the teacher lets speak is heard
    return !!(prefs && prefs.classmates) && !(prefs && prefs.lowData) && source === 'camera';
  }
  // Filter the "Who are you?" list by what is typed: every word must match
  // the start of a word in the name, so "eth li" finds Ethan Lim.
  function filterNames(list, query) {
    var words = oneLine(query, 60).toLowerCase().split(' ').filter(Boolean);
    if (!words.length) return list.slice();
    return list.filter(function (s) {
      var parts = str(s.label || s.name).toLowerCase().split(/[\s()-]+/).filter(Boolean);
      return words.every(function (w) { return parts.some(function (p) { return p.indexOf(w) === 0; }); });
    });
  }
  function cleanPrefs(p) {
    p = p && typeof p === 'object' ? p : {};
    return { classmates: p.classmates === true, lowData: p.lowData === true, mirror: p.mirror !== false, autoLow: p.autoLow !== false,
      cameraOff: p.cameraOff === true, lastKind: KINDS.indexOf(p.lastKind) !== -1 ? p.lastKind : 'mcq' };
  }

  var pure = {
    VERSION: VERSION, TOPIC: TOPIC, KINDS: KINDS, KIND_LABEL: KIND_LABEL, LIMITS: LIMITS,
    cleanQuestion: cleanQuestion, questionForStudent: questionForStudent, meantFor: meantFor,
    cleanAnswer: cleanAnswer, normAnswer: normAnswer, numberOf: numberOf, blankMatches: blankMatches,
    autoMark: autoMark, answerText: answerText, letter: letter, validImage: validImage,
    encode: encode, decode: decode, chunkImage: chunkImage, makeAssembler: makeAssembler,
    outboxAdd: outboxAdd, outboxAck: outboxAck, outboxDue: outboxDue,
    emptySession: emptySession, personJoined: personJoined, personLeft: personLeft, minutesPresent: minutesPresent,
    recordAnswer: recordAnswer, markOf: markOf, questionStats: questionStats, roster: roster,
    participation: participation, participationLine: participationLine, reportText: reportText, reportHtml: reportHtml,
    gridFor: gridFor, clampBox: clampBox, qualityWord: qualityWord, publishPlan: publishPlan, wantTrack: wantTrack,
    filterNames: filterNames, cleanPrefs: cleanPrefs, roleOfIdentity: roleOfIdentity, validIdentity: validIdentity,
    randomId: randomId, fmtDate: fmtDate, oneLine: oneLine
  };

  /* ================================================================
     THE WINDOW
     ================================================================ */

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function btn(cls, text, title, onClick) {
    var b = el('button', 'vcBtn' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }
  function readJson(store, key, fallback) {
    try { var v = store && store.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function writeJson(store, key, value) {
    try { if (store) store.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function local() { try { return root.localStorage; } catch (e) { return null; } }
  function session() { try { return root.sessionStorage; } catch (e) { return null; } }

  function create(env) {
    env = env || {};
    var say = env.toast || function () {};
    var S = {
      mode: 'closed',          // closed | setup | start | wait | pick | joining | live | ended
      role: 'none',
      win: null, box: null, view: 'float',
      LK: null, room: null, url: '', identity: '', name: '', kind: '', rosterId: '', slot: '', epoch: 0, room_name: '',
      prefs: cleanPrefs(readJson(local(), PREF_KEY, {})),
      leaving: false, rejoinTries: 0, rejoinTimer: 0,
      // teacher
      session: null, saveTimer: 0, tab: 'ask', compose: null, images: {}, pendingPhotos: {}, hands: {}, removed: {},
      reports: {}, mirrorOff: null, status: null, sharing: false,
      // student
      questions: {}, order: [], mine: {}, outbox: {}, popup: null, popMin: false, gotState: false, helloTimer: 0, resendTimer: 0,
      handUp: false, lists: null, pickTab: 'mine', pick: null, query: '', confirmAgain: null,
      // both
      assembler: makeAssembler(), tiles: {}, mediaEls: {}, quality: {}, audioBlocked: false, wakeLock: null, tick: 0,
      poorSince: 0, seq: 0
    };

    /* ---------- small utilities ---------- */
    function role() { return typeof env.role === 'function' ? env.role() : 'none'; }
    function isTeacher() { return S.role === 'teacher' && role() === 'teacher'; }
    function call(action, body) {
      if (typeof env.call !== 'function') return Promise.reject(new Error('The live class is not available here.'));
      return env.call(action, body || {});
    }
    function savePrefs() { writeJson(local(), PREF_KEY, S.prefs); }
    function now() { return Date.now(); }

    /* ---------- the window frame ---------- */
    function build() {
      if (S.win) return S.win;
      var w = el('div', 'vcWin');
      w.id = 'vcWin';
      w.setAttribute('role', 'dialog');
      w.setAttribute('aria-label', 'Live class');
      w.hidden = true;

      var head = el('div', 'vcHead');
      var title = el('div', 'vcTitle');
      title.appendChild(el('span', 'vcLiveDot'));
      S.titleText = el('span', 'vcTitleText', 'Live class');
      title.appendChild(S.titleText);
      S.netBadge = el('span', 'vcNet');
      title.appendChild(S.netBadge);
      head.appendChild(title);
      var hb = el('div', 'vcHeadBtns');
      S.miniBtn = btn('vcIcon', '▁', 'Make the window small', function () { setView(S.view === 'mini' ? 'float' : 'mini'); });
      S.fullBtn = btn('vcIcon', '⤢', 'Full screen', function () { setView(S.view === 'full' ? 'float' : 'full'); });
      S.closeBtn = btn('vcIcon vcClose', '✕', 'Leave the class', function () { leaveAsk(); });
      hb.appendChild(S.miniBtn); hb.appendChild(S.fullBtn); hb.appendChild(S.closeBtn);
      head.appendChild(hb);
      w.appendChild(head);

      S.body = el('div', 'vcBody');
      w.appendChild(S.body);
      S.grip = el('div', 'vcGrip');
      S.grip.setAttribute('aria-hidden', 'true');
      w.appendChild(S.grip);
      S.audioBox = el('div', 'vcAudioBox');
      S.audioBox.setAttribute('aria-hidden', 'true');
      w.appendChild(S.audioBox);

      // Every key pressed in the window stays in the window: the worksheet's
      // one-letter tool shortcuts must never fire while a child types an answer.
      ['keydown', 'keyup', 'keypress'].forEach(function (type) {
        w.addEventListener(type, function (e) {
          e.stopPropagation();
          if (type === 'keydown' && e.key === 'Escape') {
            var t = e.target;
            if (S.bigPhoto) { closeBigPhoto(); return; }
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) { t.blur(); return; }
            if (S.mode === 'live') setView('mini');
          }
        });
      });
      // A press inside the window never reaches the worksheet's pen.
      ['pointerdown', 'mousedown', 'touchstart', 'wheel'].forEach(function (type) {
        w.addEventListener(type, function (e) { e.stopPropagation(); }, { passive: true });
      });
      wireDrag(head);
      wireResize(S.grip);
      document.body.appendChild(w);
      S.win = w;
      root.addEventListener('resize', function () { if (!S.win.hidden) placeWindow(); });
      return w;
    }

    function phone() { return (root.innerWidth || 1024) < 700; }
    function defaultBox() {
      var vw = root.innerWidth || 1024, vh = root.innerHeight || 768;
      if (S.role === 'teacher') return { w: Math.min(1100, vw * 0.72), h: Math.min(760, vh * 0.8), x: vw * 0.26, y: 70 };
      return { w: Math.min(620, vw * 0.5), h: Math.min(560, vh * 0.72), x: vw - Math.min(620, vw * 0.5) - 16, y: 70 };
    }
    function placeWindow() {
      var w = S.win, vw = root.innerWidth || 1024, vh = root.innerHeight || 768;
      w.dataset.view = phone() && S.view === 'float' ? 'full' : S.view;
      w.dataset.role = S.role;
      w.dataset.mode = S.mode;
      if (w.dataset.view === 'full') { w.style.left = w.style.top = w.style.width = w.style.height = ''; return; }
      if (S.view === 'mini') {
        var mw = Math.min(340, vw - 16), mh = 230;
        var mb = clampBox({ x: vw - mw - 12, y: vh - mh - 12, w: mw, h: mh }, vw, vh, 220, 160);
        w.style.left = mb.x + 'px'; w.style.top = mb.y + 'px'; w.style.width = mb.w + 'px'; w.style.height = mb.h + 'px';
        return;
      }
      if (!S.box) S.box = readJson(local(), WIN_KEY + ':' + S.role, null) || defaultBox();
      S.box = clampBox(S.box, vw, vh, S.role === 'teacher' ? 520 : 320, 300);
      w.style.left = S.box.x + 'px'; w.style.top = S.box.y + 'px'; w.style.width = S.box.w + 'px'; w.style.height = S.box.h + 'px';
    }
    function setView(v) {
      S.view = v === 'mini' || v === 'full' ? v : 'float';
      S.miniBtn.textContent = S.view === 'mini' ? '▢' : '▁';
      S.miniBtn.title = S.view === 'mini' ? 'Make the window bigger' : 'Make the window small';
      S.fullBtn.textContent = S.view === 'full' ? '⤡' : '⤢';
      placeWindow();
      layout();
    }
    function rememberBox() { if (S.box) writeJson(local(), WIN_KEY + ':' + S.role, S.box); }
    function wireDrag(handle) {
      var drag = null;
      handle.addEventListener('pointerdown', function (e) {
        if (e.button > 0 || S.view !== 'float' || phone() || (e.target && e.target.closest && e.target.closest('button'))) return;
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, bx: S.box.x, by: S.box.y };
        try { handle.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
      });
      handle.addEventListener('pointermove', function (e) {
        if (!drag || e.pointerId !== drag.id) return;
        S.box.x = drag.bx + e.clientX - drag.x; S.box.y = drag.by + e.clientY - drag.y;
        placeWindow();
      });
      function end(e) { if (drag && e.pointerId === drag.id) { drag = null; rememberBox(); } }
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
      handle.addEventListener('dblclick', function (e) { if (!(e.target && e.target.closest && e.target.closest('button'))) setView(S.view === 'full' ? 'float' : 'full'); });
    }
    function wireResize(grip) {
      var rs = null;
      grip.addEventListener('pointerdown', function (e) {
        if (e.button > 0 || S.view !== 'float') return;
        rs = { id: e.pointerId, x: e.clientX, y: e.clientY, w: S.box.w, h: S.box.h };
        try { grip.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
      });
      grip.addEventListener('pointermove', function (e) {
        if (!rs || e.pointerId !== rs.id) return;
        S.box.w = rs.w + e.clientX - rs.x; S.box.h = rs.h + e.clientY - rs.y;
        placeWindow(); layout();
      });
      function end(e) { if (rs && e.pointerId === rs.id) { rs = null; rememberBox(); } }
      grip.addEventListener('pointerup', end);
      grip.addEventListener('pointercancel', end);
    }

    function show() {
      build();
      S.role = role();
      S.win.hidden = false;
      if (phone()) S.view = 'full';
      placeWindow();
    }
    function hideWindow() {
      if (!S.win) return;
      S.win.hidden = true;
    }
    function setTitle(text) { if (S.titleText) S.titleText.textContent = text; }

    /* ================================================================
       OPENING: who is this, and what should they see first?
       ================================================================ */
    function open() {
      var r = role();
      if (r !== 'teacher' && r !== 'student') { say('Sign in to join the live class.'); return; }
      if (S.mode === 'live' || S.mode === 'joining') { show(); if (S.view === 'mini') setView('float'); return; }
      S.role = r;
      show();
      if (r === 'teacher') return openTeacher();
      return openStudent();
    }

    /* ---------- the teacher: keys, then the slot, then Start ---------- */
    function openTeacher() {
      S.mode = 'start';
      setTitle('Live class');
      paintBusy('Checking the live class…');
      var seq = ++S.seq;
      call('status').then(function (st) {
        if (seq !== S.seq || !isTeacher()) return;
        S.status = st;
        if (!st.configured) return paintSetup(true);
        paintStart();
      }, function (e) {
        if (seq !== S.seq) return;
        paintError(e, openTeacher);
      });
    }

    function paintBusy(text) {
      clear(S.body);
      var box = el('div', 'vcCenter');
      box.appendChild(el('div', 'vcSpinner'));
      box.appendChild(el('p', 'vcMuted', text));
      S.body.appendChild(box);
    }
    function paintError(e, retry) {
      clear(S.body);
      var box = el('div', 'vcCenter');
      box.appendChild(el('div', 'vcBig', '⚠️'));
      box.appendChild(el('p', 'vcMsg', (e && e.message) || 'Something went wrong.'));
      if (retry) box.appendChild(btn('vcPrimary', 'Try again', null, retry));
      S.body.appendChild(box);
    }

    function paintSetup(first) {
      S.mode = 'setup';
      placeWindow();
      clear(S.body);
      var card = el('div', 'vcCard vcSetup');
      card.appendChild(el('h3', null, first ? 'Set up the live class' : '⚙ LiveKit keys'));
      var steps = el('ol', 'vcSteps');
      ['Sign in at cloud.livekit.io and create a project (any name, e.g. "Polymath Live").',
        'Open Settings → API Keys → Create key.',
        'Copy the URL (wss://…livekit.cloud), the API Key and the API Secret into the boxes below.'].forEach(function (t) { steps.appendChild(el('li', null, t)); });
      card.appendChild(steps);
      card.appendChild(el('p', 'vcMuted', 'The secret goes straight to the Ans Key server, encrypted. It is never kept in this page or shown again.'));
      var url = field(card, 'Project URL', 'wss://your-project.livekit.cloud', S.status && S.status.url || '');
      var key = field(card, 'API Key', 'APIxxxxxxxx', '');
      var secret = field(card, 'API Secret', 'Paste the secret', '');
      secret.type = 'password';
      secret.autocomplete = 'off';
      var msg = el('p', 'vcMsg');
      card.appendChild(msg);
      var row = el('div', 'vcRow');
      var save = btn('vcPrimary', 'Save and test', null, function () {
        msg.textContent = 'Checking the keys with LiveKit…';
        save.disabled = true;
        call('configure', { url: url.value, apiKey: key.value, apiSecret: secret.value }).then(function (res) {
          secret.value = '';
          S.status = Object.assign({}, S.status || {}, { configured: true, url: res.url, apiKey: res.apiKey });
          say('✓ LiveKit is connected.');
          paintStart();
        }, function (e) {
          save.disabled = false;
          msg.textContent = (e && e.message) || 'Those keys could not be saved.';
        });
      });
      row.appendChild(save);
      if (!first) row.appendChild(btn('', 'Back', null, paintStart));
      card.appendChild(row);
      if (S.status && S.status.configured) card.appendChild(el('p', 'vcMuted', 'Saved now: ' + (S.status.url || '') + ' · key ' + (S.status.apiKey || '')));
      S.body.appendChild(card);
      (S.status && S.status.url ? key : url).focus();
    }
    function field(parent, label, placeholder, value) {
      var lab = el('label', 'vcField');
      lab.appendChild(el('span', null, label));
      var input = el('input');
      input.type = 'text';
      input.placeholder = placeholder || '';
      input.value = value || '';
      input.spellcheck = false;
      input.autocapitalize = 'off';
      input.setAttribute('autocorrect', 'off');
      lab.appendChild(input);
      parent.appendChild(lab);
      return input;
    }

    function paintStart() {
      S.mode = 'start';
      placeWindow();
      clear(S.body);
      var card = el('div', 'vcCard vcStart');
      card.appendChild(el('h3', null, '🎥 Start the live class'));
      var st = S.status || {};
      if (st.open) {
        card.appendChild(el('p', 'vcMsg', 'A class is running now' + (st.slotLabel || st.slot ? ' — ' + (st.slotLabel || st.slot) : '') + ', started ' + new Date(st.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.'));
      } else {
        card.appendChild(el('p', 'vcMuted', 'Students join from the 🎥 Live class button in Ans Key, or from the class link. They choose their name from the lesson slot you pick here.'));
      }
      var lab = el('label', 'vcField');
      lab.appendChild(el('span', null, 'Lesson slot (whose names students see)'));
      var sel = el('select');
      sel.appendChild(new Option('Loading the class list…', ''));
      lab.appendChild(sel);
      card.appendChild(lab);
      var linkRow = el('div', 'vcLinkRow');
      var link = typeof env.classLink === 'function' ? env.classLink() : '';
      if (link) {
        var linkText = el('code', 'vcLink', link);
        linkRow.appendChild(el('span', 'vcMuted', 'Class link for students:'));
        linkRow.appendChild(linkText);
        linkRow.appendChild(btn('', '⧉ Copy', 'Copy the class link', function () {
          copyText(link).then(function () { say('Class link copied.'); });
        }));
        card.appendChild(linkRow);
      }
      var row = el('div', 'vcRow');
      var go = btn('vcPrimary vcGo', st.open ? '▶ Rejoin the class' : '▶ Start class', null, function () { startClass(sel.value, false); });
      row.appendChild(go);
      if (st.open) {
        row.appendChild(btn('', 'Start a new class', 'End the running class and start a fresh one', function () {
          if (!root.confirm('Start a NEW class? Everyone in the running class is taken out of it.')) return;
          startClass(sel.value, true);
        }));
        row.appendChild(btn('vcDanger', 'End class', 'End the running class for everyone', function () { endClass(); }));
      }
      row.appendChild(btn('', '⚙ Keys', 'Change the LiveKit keys', function () { paintSetup(false); }));
      card.appendChild(row);
      S.body.appendChild(card);
      Promise.resolve(typeof env.slots === 'function' ? env.slots() : []).then(function (slots) {
        clear(sel);
        var list = Array.isArray(slots) ? slots : [];
        if (!list.length) sel.appendChild(new Option('No lesson slots on the roster yet', ''));
        var guess = st.open && st.slot ? st.slot : typeof env.guessSlot === 'function' ? env.guessSlot() : '';
        S.slotList = list;
        list.forEach(function (s) {
          var name = typeof s === 'string' ? s : s.slot;
          var label = typeof s === 'object' && s.label ? s.label : name;
          var count = typeof s === 'object' && s.count ? ' · ' + s.count + ' student' + (s.count === 1 ? '' : 's') : '';
          var o = new Option(label + count, name);
          if (name === guess) o.selected = true;
          sel.appendChild(o);
        });
      }, function () { clear(sel); sel.appendChild(new Option('The class list could not be loaded', '')); });
    }
    function copyText(text) {
      if (root.navigator && navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(function () { return fallbackCopy(text); });
      return Promise.resolve(fallbackCopy(text));
    }
    function fallbackCopy(text) {
      var ta = el('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      ta.remove();
    }

    function startClass(slot, fresh) {
      if (!isTeacher()) return;
      S.mode = 'joining';
      paintBusy(fresh ? 'Starting a new class…' : 'Opening the class…');
      var seq = ++S.seq;
      call('open', { slot: slot || '', fresh: !!fresh }).then(function (res) {
        if (seq !== S.seq || !isTeacher()) return;
        S.slot = res.slot || slot || ''; S.epoch = res.epoch; S.room_name = res.room;
        S.slotLabel = res.slotLabel || slotLabelOf(S.slot);
        return loadSession(res).then(function () { return connect(res); });
      }).catch(function (e) {
        if (seq !== S.seq) return;
        S.mode = 'start';
        paintError(e, openTeacher);
      });
    }
    function slotLabelOf(id) {
      var hit = (S.slotList || []).filter(function (x) { return x && typeof x === 'object' && x.slot === id; })[0];
      return hit && hit.label ? hit.label : id || '';
    }
    function loadSession(res) {
      var fresh = emptySession(res.epoch, res.slot, res.startedAt);
      if (typeof env.loadSession !== 'function') { S.session = fresh; return Promise.resolve(); }
      return Promise.resolve(env.loadSession(res.epoch)).then(function (saved) {
        if (saved && Number(saved.epoch) === Number(res.epoch)) {
          S.session = Object.assign(fresh, saved, { people: saved.people || {}, answers: saved.answers || {}, questions: (saved.questions || []).map(cleanQuestion).filter(Boolean), notes: saved.notes || {} });
          // Nobody is "here" until LiveKit says so again.
          Object.keys(S.session.people).forEach(function (k) { S.session = personLeft(S.session, k, now()); });
        } else {
          S.session = fresh;
        }
        S.session.slotLabel = S.slotLabel || S.session.slotLabel || '';
      }, function () { S.session = fresh; S.session.slotLabel = S.slotLabel || ''; });
    }
    function saveSoon() {
      if (!isTeacher() || !S.session) return;
      clearTimeout(S.saveTimer);
      S.saveTimer = setTimeout(saveNow, 1500);
    }
    function saveNow() {
      clearTimeout(S.saveTimer);
      if (!S.session || typeof env.saveSession !== 'function') return Promise.resolve();
      var snap = JSON.parse(JSON.stringify(S.session));
      return Promise.resolve(env.saveSession(snap.epoch, snap)).catch(function (e) {
        if (!S.saveWarned) { S.saveWarned = true; say('The class record could not be saved just now: ' + ((e && e.message) || e)); }
      });
    }

    function endClass() {
      if (!isTeacher()) return;
      if (!root.confirm('End the class for everyone?')) return;
      broadcast({ t: 'end' });
      if (S.session) { S.session.endedAt = now(); Object.keys(S.session.people).forEach(function (k) { S.session = personLeft(S.session, k, now()); }); }
      var done = saveNow();
      call('close').catch(function (e) { say('The class could not be closed: ' + ((e && e.message) || e)); });
      S.leaving = true;
      disconnect();
      Promise.resolve(done).then(function () {
        if (S.session && S.session.questions.length + Object.keys(S.session.people).length) {
          S.mode = 'ended';
          S.tab = 'reports';
          paintEnded();
        } else {
          S.mode = 'start';
          S.status = Object.assign({}, S.status || {}, { open: false });
          paintStart();
        }
      });
    }

    /* ---------- the student: wait → who are you? → join ---------- */
    function openStudent() {
      setTitle('Live class');
      paintBusy('Looking for your class…');
      var seq = ++S.seq;
      watchMirror();
      call('status').then(function (st) {
        if (seq !== S.seq) return;
        S.status = st;
        if (!st.open) return paintWait();
        loadRoster();
      }, function (e) { if (seq === S.seq) paintError(e, openStudent); });
    }
    function watchMirror() {
      if (S.mirrorOff || typeof env.onMirror !== 'function') return;
      S.mirrorOff = env.onMirror(function (m) {
        var open = !!(m && m.open);
        if (env.button) {
          var b = env.button();
          if (b) b.classList.toggle('vcLiveNow', open);
        }
        if (S.role === 'student' && S.mode === 'wait' && open) openStudent();
      });
    }
    function paintWait() {
      S.mode = 'wait';
      placeWindow();
      clear(S.body);
      var box = el('div', 'vcCenter vcWait');
      box.appendChild(el('div', 'vcBig', '⏳'));
      box.appendChild(el('h3', null, 'The class has not started yet'));
      box.appendChild(el('p', 'vcMuted', 'Keep this window open. The class opens here by itself when your teacher starts it.'));
      box.appendChild(btn('', 'Check again', null, openStudent));
      S.body.appendChild(box);
      clearTimeout(S.waitTimer);
      S.waitTimer = setTimeout(function () { if (S.mode === 'wait' && !S.win.hidden) openStudent(); }, 20000);
    }
    function loadRoster() {
      paintBusy('Getting the class list…');
      var seq = ++S.seq;
      call('roster').then(function (res) {
        if (seq !== S.seq) return;
        S.lists = res;
        S.slot = res.slot || '';
        var last = readJson(local(), PICK_KEY, null);
        S.pick = null;
        // A signed-in student's own name, or this device's last name, is
        // CHOSEN for them — they still press Confirm.
        var pre = res.suggest || (last && last.epoch !== res.epoch && last.kind !== 'trial' ? last.id : '');
        if (pre) {
          var mine = (res.students || []).filter(function (s) { return s.id === pre; })[0];
          var other = null;
          (res.others || []).forEach(function (g) { g.students.forEach(function (s) { if (s.id === pre) other = s; }); });
          if (mine) { S.pick = { kind: 'roster', id: mine.id, name: mine.name, label: mine.label }; S.pickTab = 'mine'; }
          else if (other) { S.pick = { kind: 'makeup', id: other.id, name: other.name, label: other.label }; S.pickTab = 'makeup'; }
        }
        if (!S.pick && last && last.kind === 'trial' && last.name) S.trialName = last.name;
        paintPick();
      }, function (e) {
        if (seq !== S.seq) return;
        if (e && e.code === 'class_closed') return paintWait();
        paintError(e, openStudent);
      });
    }

    function paintPick() {
      S.mode = 'pick';
      placeWindow();
      clear(S.body);
      var card = el('div', 'vcCard vcPick');
      card.appendChild(el('h3', null, 'Who are you?'));
      var slotText = (S.lists && S.lists.slotLabel) || S.slot;
      if (slotText) card.appendChild(el('p', 'vcMuted', slotText));
      var tabs = el('div', 'vcTabs');
      tabs.setAttribute('role', 'tablist');
      [['mine', 'My class'], ['makeup', 'Make-up'], ['trial', 'Trial']].forEach(function (t) {
        var b = btn('vcTab' + (S.pickTab === t[0] ? ' on' : ''), t[1], null, function () {
          S.pickTab = t[0]; S.query = '';
          if (S.pick && (t[0] === 'trial') !== (S.pick.kind === 'trial')) S.pick = null;
          if (S.pick && t[0] === 'mine' && S.pick.kind !== 'roster') S.pick = null;
          if (S.pick && t[0] === 'makeup' && S.pick.kind !== 'makeup') S.pick = null;
          paintPick();
        });
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', S.pickTab === t[0] ? 'true' : 'false');
        tabs.appendChild(b);
      });
      card.appendChild(tabs);

      var pane = el('div', 'vcPickPane');
      card.appendChild(pane);
      var confirm = btn('vcPrimary vcConfirm', 'Confirm', null, function () {
        if (!S.pick) return;
        joinAsStudent(S.pick, false);
      });

      function syncConfirm() {
        confirm.disabled = !S.pick;
        confirm.textContent = S.pick ? 'I am ' + (S.pick.label || S.pick.name) + ' — Confirm' : 'Choose your name, then Confirm';
      }

      if (S.pickTab === 'trial') {
        pane.appendChild(el('p', 'vcMuted', 'New here for a trial lesson? Type your full name (first name and surname).'));
        var nameIn = field(pane, 'Your full name', 'e.g. Bella Koh', S.trialName || '');
        nameIn.autocapitalize = 'words';
        nameIn.maxLength = 60;
        var syncTrial = function () {
          var v = oneLine(nameIn.value, 60);
          S.trialName = v;
          S.pick = v.length >= 2 ? { kind: 'trial', name: v, label: v } : null;
          syncConfirm();
        };
        nameIn.addEventListener('input', syncTrial);
        nameIn.addEventListener('keydown', function (e) { if (e.key === 'Enter' && S.pick) confirm.click(); });
        syncTrial();
        setTimeout(function () { nameIn.focus(); }, 0);
      } else {
        var search = el('input', 'vcSearch');
        search.type = 'search';
        search.placeholder = S.pickTab === 'mine' ? 'Type to find your name' : 'Type your name to find it in another class';
        search.value = S.query;
        search.setAttribute('aria-label', 'Find your name');
        pane.appendChild(search);
        var list = el('div', 'vcNames');
        list.setAttribute('role', 'listbox');
        pane.appendChild(list);
        var paintList = function () {
          clear(list);
          var groups = S.pickTab === 'mine'
            ? [{ slot: '', students: (S.lists && S.lists.students) || [] }]
            : ((S.lists && S.lists.others) || []);
          var shown = 0;
          groups.forEach(function (g) {
            var names = filterNames(g.students, S.query);
            if (!names.length) return;
            if (g.slot) list.appendChild(el('div', 'vcGroup', g.label || g.slot));
            names.forEach(function (s) {
              shown++;
              var on = S.pick && S.pick.id === s.id;
              var b = btn('vcName' + (on ? ' on' : ''), s.label || s.name, null, function () {
                S.pick = { kind: S.pickTab === 'mine' ? 'roster' : 'makeup', id: s.id, name: s.name, label: s.label || s.name };
                paintList(); syncConfirm();
              });
              b.setAttribute('role', 'option');
              b.setAttribute('aria-selected', on ? 'true' : 'false');
              list.appendChild(b);
            });
          });
          if (!shown) {
            list.appendChild(el('p', 'vcMuted vcEmpty', S.query ? 'No name matches "' + S.query + '".'
              : S.pickTab === 'mine' ? 'No names on this class list yet. Try Make-up or Trial, or ask your teacher.' : 'No other classes on the list.'));
          }
        };
        search.addEventListener('input', function () { S.query = search.value; paintList(); });
        search.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter') return;
          var first = list.querySelector('.vcName');
          if (first) first.click();
        });
        paintList();
        if (!phone()) setTimeout(function () { search.focus(); }, 0);
      }
      var foot = el('div', 'vcPickFoot');
      foot.appendChild(confirm);
      card.appendChild(foot);
      syncConfirm();
      S.body.appendChild(card);
    }

    function joinAsStudent(pick, takeover) {
      if (S.role !== 'student') return;
      S.mode = 'joining';
      paintBusy('Joining the class as ' + (pick.label || pick.name) + '…');
      blessAudio();
      var seq = ++S.seq;
      call('token', { pick: { kind: pick.kind, id: pick.id, name: pick.kind === 'trial' ? pick.name : undefined }, takeover: !!takeover }).then(function (res) {
        if (seq !== S.seq) return;
        writeJson(local(), PICK_KEY, { kind: pick.kind, id: pick.id || '', name: pick.kind === 'trial' ? pick.name : '', epoch: 0 });
        S.kind = res.kind; S.rosterId = res.rosterId || '';
        return connect(res);
      }).catch(function (e) {
        if (seq !== S.seq) return;
        if (e && e.code === 'already_in') return paintAlreadyIn(pick, e.message);
        if (e && e.code === 'class_closed') return paintWait();
        S.mode = 'pick';
        paintError(e, function () { paintPick(); });
      });
    }
    function paintAlreadyIn(pick, message) {
      S.mode = 'pick';
      clear(S.body);
      var card = el('div', 'vcCard vcCenter');
      card.appendChild(el('div', 'vcBig', '🤔'));
      card.appendChild(el('p', 'vcMsg', message || (pick.name + ' is already in the class on another device.')));
      card.appendChild(el('p', 'vcMuted', 'Only press "Yes" if you really are ' + (pick.label || pick.name) + '. The other device will leave the class.'));
      var row = el('div', 'vcRow');
      row.appendChild(btn('vcPrimary', "Yes, it's me — join here", null, function () { joinAsStudent(pick, true); }));
      row.appendChild(btn('', 'No, choose again', null, function () { S.pick = null; paintPick(); }));
      card.appendChild(row);
      S.body.appendChild(card);
    }

    /* ================================================================
       THE ROOM
       ================================================================ */
    function blessAudio() {
      // Safari plays a call's sound only after a tap that played something.
      // This runs inside the tap, before anything waits.
      try {
        var a = new Audio();
        a.muted = true;
        a.playsInline = true;
        a.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
        var p = a.play();
        if (p && p.catch) p.catch(function () {});
      } catch (e) {}
    }
    function preset(LK, name, screen) {
      var table = screen ? LK.ScreenSharePresets : LK.VideoPresets;
      return table && table[name] ? table[name] : null;
    }
    function roomOptions(LK) {
      var plan = publishPlan(S.role, S.prefs.lowData);
      var cam = preset(LK, plan.camera);
      var layers = (plan.layers || []).map(function (n) { return preset(LK, n); }).filter(Boolean);
      var publish = { simulcast: true, videoCodec: 'vp8', red: true, dtx: true, stopMicTrackOnMute: false };
      if (layers.length) publish.videoSimulcastLayers = layers;
      if (cam) publish.videoEncoding = cam.encoding;
      if (plan.screen) {
        var sc = preset(LK, plan.screen, true);
        if (sc) publish.screenShareEncoding = sc.encoding;
        var sl = (plan.screenLayers || []).map(function (n) { return preset(LK, n, true); }).filter(Boolean);
        if (sl.length) publish.screenShareSimulcastLayers = sl;
      }
      return {
        adaptiveStream: true,
        dynacast: true,
        disconnectOnPageLeave: true,
        videoCaptureDefaults: cam ? { resolution: cam.resolution } : undefined,
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        publishDefaults: publish
      };
    }
    function loadLK() {
      if (S.LK) return Promise.resolve(S.LK);
      if (root.LivekitClient) { S.LK = root.LivekitClient; return Promise.resolve(S.LK); }
      if (typeof env.loadLiveKit !== 'function') return Promise.reject(new Error('The video system could not be loaded.'));
      return Promise.resolve(env.loadLiveKit()).then(function (LK) {
        S.LK = LK || root.LivekitClient;
        if (!S.LK) throw new Error('The video system could not be loaded. Check the connection and try again.');
        return S.LK;
      });
    }

    function connect(res) {
      S.url = res.url; S.identity = res.identity; S.name = res.name || (S.role === 'teacher' ? 'Teacher' : '');
      S.epoch = res.epoch; S.room_name = res.room; if (res.slot) S.slot = res.slot;
      S.leaving = false;
      var token = res.token;
      return loadLK().then(function (LK) {
        if (S.mode !== 'joining') return;
        if (!LK.isBrowserSupported || LK.isBrowserSupported()) { /* ok */ } else {
          throw new Error('This browser cannot join video classes. Update Safari or Chrome and try again.');
        }
        var room = new LK.Room(roomOptions(LK));
        S.room = room;
        wireRoom(room, LK);
        if (S.role === 'student') loadOutbox();
        return room.prepareConnection ? Promise.resolve(room.prepareConnection(S.url, token)).catch(function () {}).then(function () { return room; }) : room;
      }).then(function (room) {
        if (!room || S.room !== room) return;
        return room.connect(S.url, token, { autoSubscribe: S.role === 'teacher' }).then(function () {
          if (S.room !== room) return;
          S.mode = 'live';
          S.rejoinTries = 0;
          paintLive();
          afterConnect(room);
        });
      }).catch(function (e) {
        var r = S.room; S.room = null;
        if (r) { try { r.disconnect(); } catch (err) {} }
        S.mode = S.role === 'teacher' ? 'start' : 'pick';
        paintError(friendlyMediaError(e), S.role === 'teacher' ? openTeacher : function () { paintPick(); });
      });
    }
    function friendlyMediaError(e) {
      var m = (e && e.message) || String(e || '');
      if (/permission|notallowed/i.test(m)) return new Error('The camera or microphone was blocked. Allow them for this site in the browser settings, then try again.');
      if (/could not establish|signal|websocket|timeout|failed to fetch|network/i.test(m)) return new Error('Could not reach the class. Check the wifi and try again.');
      return e instanceof Error ? e : new Error(m || 'The class could not be joined.');
    }

    function afterConnect(room) {
      var lp = room.localParticipant;
      startWakeLock();
      // Publish. A student joins with the camera on and the microphone OFF,
      // the way a class starts; the teacher with both on.
      var camOn = S.role === 'teacher' ? true : S.prefs.cameraOff !== true;
      Promise.resolve(lp.setCameraEnabled(camOn)).catch(function (e) {
        say(S.role === 'teacher' ? 'Your camera could not start: ' + ((e && e.message) || e) : 'Your camera could not start. You can still see and answer.');
      }).then(function () { paintControls(); layout(); });
      if (S.role === 'teacher') {
        Promise.resolve(lp.setMicrophoneEnabled(true)).catch(function (e) {
          say('Your microphone could not start: ' + ((e && e.message) || e));
        }).then(paintControls);
      }
      // Existing participants and tracks.
      room.remoteParticipants.forEach(function (p) { participantIn(p); });
      if (S.role === 'student') {
        applySubscriptions();
        sayHello();
        clearInterval(S.resendTimer);
        S.resendTimer = setInterval(studentTick, 1500);
      } else {
        clearInterval(S.resendTimer);
        S.resendTimer = setInterval(teacherTick, 5000);
        saveSoon();
      }
      clearInterval(S.tick);
      S.tick = setInterval(function () { paintPresence(); }, 30000);
      if (!room.canPlaybackAudio) showAudioGate(true);
      layout();
    }

    function wireRoom(room, LK) {
      var E = LK.RoomEvent;
      room.on(E.ParticipantConnected, function (p) { participantIn(p); if (S.role === 'student' && roleOfIdentity(p.identity) === 'teacher') sayHello(); layout(); });
      room.on(E.ParticipantDisconnected, function (p) { participantOut(p); layout(); });
      room.on(E.TrackPublished, function (pub, p) { if (S.role === 'student') subscribeOne(pub, p); });
      room.on(E.TrackSubscribed, function (track, pub, p) { trackIn(track, pub, p); });
      room.on(E.TrackUnsubscribed, function (track, pub, p) { trackOut(track, pub, p); });
      room.on(E.TrackMuted, function () { layout(); });
      room.on(E.TrackUnmuted, function () { layout(); });
      room.on(E.LocalTrackPublished, function (pub) { localTrackIn(pub); });
      room.on(E.LocalTrackUnpublished, function (pub) { localTrackOut(pub); });
      room.on(E.DataReceived, function (payload, p, kind, topic) {
        if (topic && topic !== TOPIC) return;
        var msg = decode(payload);
        if (!msg || !p) return;
        try { onData(msg, p); } catch (e) { if (root.console) console.warn('Live class message failed', e); }
      });
      room.on(E.ConnectionQualityChanged, function (q, p) { onQuality(q, p); });
      room.on(E.AudioPlaybackStatusChanged, function () { showAudioGate(!room.canPlaybackAudio); });
      room.on(E.Reconnecting, function () { setNet('Reconnecting…', 'warn'); });
      room.on(E.Reconnected, function () {
        setNet('', '');
        if (S.role === 'student') { sayHello(); flushOutbox(true); }
        else resendOpenQuestions();
      });
      room.on(E.ActiveSpeakersChanged, function (speakers) {
        var ids = {};
        (speakers || []).forEach(function (s) { ids[s.identity] = true; });
        Object.keys(S.tiles).forEach(function (id) { S.tiles[id].el.classList.toggle('speaking', !!ids[id]); });
      });
      if (E.MediaDevicesError) room.on(E.MediaDevicesError, function (e) { say('Camera or microphone: ' + ((e && e.message) || e)); });
      room.on(E.Disconnected, function (reason) { onDisconnected(room, reason, LK); });
    }

    function onDisconnected(room, reason, LK) {
      if (S.room !== room) return;
      S.room = null;
      stopTimers();
      releaseMedia();
      var R = LK.DisconnectReason || {};
      if (S.leaving) return;
      if (reason === R.DUPLICATE_IDENTITY) return paintGone('You joined the class on another device, so this one has left.');
      if (reason === R.PARTICIPANT_REMOVED) return paintGone('Your teacher took you out of the class.');
      if (reason === R.ROOM_DELETED) return S.role === 'teacher' ? paintGone('The class has ended.') : paintStudentEnded();
      // Anything else (wifi gone for too long, the laptop slept) → rejoin
      // with a FRESH token, a few times, further apart each time.
      if (S.rejoinTries >= LIMITS.rejoinTries) return paintGone('The connection to the class was lost.', true);
      S.rejoinTries++;
      var wait = Math.min(15000, 1000 * Math.pow(2, S.rejoinTries - 1));
      paintBusy('Connection lost. Joining again in ' + Math.round(wait / 1000) + ' s…');
      clearTimeout(S.rejoinTimer);
      S.rejoinTimer = setTimeout(rejoin, wait);
    }
    function rejoin() {
      if (S.mode === 'closed') return;
      S.mode = 'joining';
      paintBusy('Joining the class again…');
      var p = S.role === 'teacher' ? call('token', {}) : call('token', { pick: lastPick(), takeover: false });
      p.then(function (res) { return connect(res); }).catch(function (e) {
        if (e && e.code === 'class_closed') return S.role === 'teacher' ? paintGone('The class has ended.') : paintStudentEnded();
        if (e && e.code === 'already_in') return paintAlreadyIn(lastPick(), e.message);
        if (S.rejoinTries >= LIMITS.rejoinTries) return paintGone('The connection to the class was lost.', true);
        S.rejoinTries++;
        clearTimeout(S.rejoinTimer);
        S.rejoinTimer = setTimeout(rejoin, Math.min(15000, 1000 * Math.pow(2, S.rejoinTries)));
      });
    }
    function lastPick() {
      var p = S.pick || readJson(local(), PICK_KEY, null) || {};
      return { kind: p.kind, id: p.id, name: p.name };
    }
    function paintGone(text, canRetry) {
      S.mode = 'ended';
      clear(S.body);
      var box = el('div', 'vcCenter');
      box.appendChild(el('div', 'vcBig', '👋'));
      box.appendChild(el('p', 'vcMsg', text));
      var row = el('div', 'vcRow');
      if (canRetry) row.appendChild(btn('vcPrimary', 'Join again', null, function () { S.rejoinTries = 0; rejoin(); }));
      row.appendChild(btn('', 'Close', null, function () { close(); }));
      box.appendChild(row);
      S.body.appendChild(box);
    }
    function paintStudentEnded() {
      S.mode = 'ended';
      stopTimers();
      clear(S.body);
      var box = el('div', 'vcCenter vcEnded');
      box.appendChild(el('div', 'vcBig', '🎉'));
      box.appendChild(el('h3', null, 'The class has ended. Well done!'));
      var answered = Object.keys(S.mine).filter(function (k) { return S.mine[k] && S.mine[k].sent; }).length;
      var right = Object.keys(S.mine).filter(function (k) { return S.mine[k] && S.mine[k].ok === true; }).length;
      if (answered) box.appendChild(el('p', 'vcMsg', 'You answered ' + answered + ' question' + (answered === 1 ? '' : 's') + (right ? ' and got ' + right + ' right' : '') + '.'));
      box.appendChild(btn('vcPrimary', 'Close', null, function () { close(); }));
      S.body.appendChild(box);
      try { session().removeItem(outboxKey()); } catch (e) {}
    }

    function disconnect() {
      stopTimers();
      var r = S.room; S.room = null;
      if (r) { try { r.disconnect(); } catch (e) {} }
      releaseMedia();
    }
    function stopTimers() {
      clearInterval(S.resendTimer); clearInterval(S.tick); clearTimeout(S.helloTimer); clearTimeout(S.rejoinTimer); clearTimeout(S.waitTimer);
      stopWakeLock();
    }
    function releaseMedia() {
      Object.keys(S.mediaEls).forEach(function (k) { var m = S.mediaEls[k]; if (m && m.el) { try { m.el.remove(); } catch (e) {} } });
      S.mediaEls = {}; S.tiles = {}; S.quality = {};
      if (S.audioBox) clear(S.audioBox);
      S.sharing = false;
    }

    function startWakeLock() {
      try {
        if (!root.navigator || !navigator.wakeLock || S.wakeLock) return;
        navigator.wakeLock.request('screen').then(function (l) { S.wakeLock = l; l.addEventListener('release', function () { S.wakeLock = null; }); }, function () {});
      } catch (e) {}
    }
    function stopWakeLock() { try { if (S.wakeLock) S.wakeLock.release(); } catch (e) {} S.wakeLock = null; }
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && S.mode === 'live') {
        startWakeLock();
        if (S.role === 'student') { sayHello(); flushOutbox(true); }
      }
    });

    /* ================================================================
       THE LIVE VIEW
       ================================================================ */
    function paintLive() {
      S.mode = 'live';
      placeWindow();
      setTitle(S.role === 'teacher' ? 'Live class' + (S.slotLabel ? ' · ' + S.slotLabel : '') : 'Live class · ' + S.name);
      clear(S.body);
      var live = el('div', 'vcLive');
      S.stage = el('div', 'vcStage');
      S.main = el('div', 'vcMain');
      S.mainEmpty = el('div', 'vcMainEmpty', S.role === 'teacher' ? 'Waiting for students…' : 'Waiting for your teacher’s video…');
      S.main.appendChild(S.mainEmpty);
      S.grid = el('div', 'vcGrid');
      S.pip = el('div', 'vcPip');
      S.self = el('div', 'vcSelf');
      S.strip = el('div', 'vcStrip');
      S.qLayer = el('div', 'vcQLayer');
      S.gate = btn('vcAudioGate', '🔊 Tap to hear the class', null, function () {
        blessAudio();
        if (S.room && S.room.startAudio) S.room.startAudio().then(function () { showAudioGate(false); }, function () {});
      });
      S.gate.hidden = true;
      if (S.role === 'teacher') S.stage.appendChild(S.grid); else S.stage.appendChild(S.main);
      S.stage.appendChild(S.pip);
      S.stage.appendChild(S.self);
      S.stage.appendChild(S.strip);
      S.stage.appendChild(S.qLayer);
      S.stage.appendChild(S.gate);
      live.appendChild(S.stage);
      S.bar = el('div', 'vcBar');
      live.appendChild(S.bar);
      S.body.appendChild(live);
      if (S.role === 'teacher') {
        S.side = el('div', 'vcSide');
        S.body.appendChild(S.side);
        paintSide();
      }
      paintControls();
      layout();
      if (S.role === 'student') paintQuestion();
    }

    function ctl(cls, text, title, on, onClick) {
      var b = btn('vcCtl' + (cls ? ' ' + cls : '') + (on ? ' on' : ''), text, title, onClick);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      return b;
    }
    function paintControls() {
      if (!S.bar || !S.room) return;
      clear(S.bar);
      var lp = S.room.localParticipant;
      var micOn = !!(lp && lp.isMicrophoneEnabled), camOn = !!(lp && lp.isCameraEnabled), shareOn = !!(lp && lp.isScreenShareEnabled);
      S.bar.appendChild(ctl(micOn ? '' : 'off', micOn ? '🎤' : '🔇', micOn ? 'Mute your microphone' : 'Unmute your microphone', micOn, function () {
        Promise.resolve(lp.setMicrophoneEnabled(!micOn)).catch(function (e) { say('Microphone: ' + ((e && e.message) || e)); }).then(paintControls);
      }));
      S.bar.appendChild(ctl(camOn ? '' : 'off', camOn ? '📷' : '🚫', camOn ? 'Turn your camera off' : 'Turn your camera on', camOn, function () {
        S.prefs.cameraOff = camOn; savePrefs();
        Promise.resolve(lp.setCameraEnabled(!camOn)).catch(function (e) { say('Camera: ' + ((e && e.message) || e)); }).then(function () { paintControls(); layout(); });
      }));
      if (S.role === 'teacher') {
        var canShare = !!(root.navigator && navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
        if (canShare) S.bar.appendChild(ctl('vcShare', shareOn ? '🛑 Stop sharing' : '🖥 Share screen', shareOn ? 'Stop sharing your screen' : 'Share this tab or your screen with the class', shareOn, function () {
          var opts = shareOn ? undefined : { audio: false, selfBrowserSurface: 'include', preferCurrentTab: true, surfaceSwitching: 'include', video: { displaySurface: 'browser' } };
          Promise.resolve(lp.setScreenShareEnabled(!shareOn, opts)).catch(function (e) {
            if (!/permission|notallowed|abort/i.test((e && (e.name + e.message)) || '')) say('Screen share: ' + ((e && e.message) || e));
          }).then(function () { S.sharing = !!lp.isScreenShareEnabled; paintControls(); layout(); });
        }));
        S.bar.appendChild(ctl('', '🔇 All', 'Mute every student’s microphone', false, function () {
          call('mute', { all: true }).then(function (r) { say(r.muted ? 'Muted ' + r.muted + ' microphone' + (r.muted === 1 ? '' : 's') + '.' : 'Every student is already muted.'); }, function (e) { say((e && e.message) || 'Could not mute.'); });
        }));
        var hands = Object.keys(S.hands).length;
        S.bar.appendChild(ctl(hands ? 'vcHands' : '', '✋ ' + hands, hands ? hands + ' hand' + (hands === 1 ? '' : 's') + ' up' : 'No hands up', !!hands, function () { S.tab = 'people'; paintSide(); }));
        S.bar.appendChild(el('span', 'vcBarGap'));
        S.bar.appendChild(ctl('vcEnd', 'End class', 'End the class for everyone', false, endClass));
      } else {
        S.bar.appendChild(ctl(S.handUp ? 'vcHandUp' : '', S.handUp ? '✋ Hand up' : '✋', S.handUp ? 'Put your hand down' : 'Raise your hand', S.handUp, function () {
          S.handUp = !S.handUp;
          sendTeacher({ t: 'hand', up: S.handUp });
          paintControls();
        }));
        S.bar.appendChild(ctl('', '👥', S.prefs.classmates ? 'Hide classmates' : 'See classmates', S.prefs.classmates, function () {
          S.prefs.classmates = !S.prefs.classmates; savePrefs(); applySubscriptions(); layout(); paintControls();
        }));
        S.bar.appendChild(ctl('', '📶', S.prefs.lowData ? 'Low data is on: the teacher’s camera is hidden so the screen and voice stay clear' : 'Low data: hide the teacher’s camera on weak wifi', S.prefs.lowData, function () {
          setLowData(!S.prefs.lowData, false);
        }));
        var qCount = openQuestions().length;
        if (qCount && S.popMin) S.bar.appendChild(ctl('vcQPill', '❓ Question', 'Show the question', true, function () { S.popMin = false; paintQuestion(); paintControls(); }));
        S.bar.appendChild(el('span', 'vcBarGap'));
        S.bar.appendChild(ctl('vcEnd', 'Leave', 'Leave the class', false, leaveAsk));
      }
    }
    function setLowData(on, auto) {
      S.prefs.lowData = !!on; savePrefs();
      applySubscriptions();
      var lp = S.room && S.room.localParticipant;
      // Your own camera drops to the smallest picture too.
      if (lp && lp.isCameraEnabled && S.LK && S.LK.VideoPresets) {
        try {
          var pub = lp.getTrackPublication(S.LK.Track.Source.Camera);
          if (pub && pub.videoTrack && pub.videoTrack.restartTrack) pub.videoTrack.restartTrack({ resolution: (on ? S.LK.VideoPresets.h180 : S.LK.VideoPresets.h360).resolution }).catch(function () {});
        } catch (e) {}
      }
      if (auto) say('Weak connection — low data is on, so the teacher’s screen and voice stay clear.');
      paintControls(); layout();
    }

    function showAudioGate(on) {
      S.audioBlocked = !!on;
      if (S.gate) S.gate.hidden = !on;
    }
    function setNet(text, tone) {
      if (!S.netBadge) return;
      S.netBadge.textContent = text || '';
      S.netBadge.className = 'vcNet' + (tone ? ' ' + tone : '');
    }
    function onQuality(q, p) {
      var id = p && p.identity;
      if (!id) return;
      var word = qualityWord(q);
      S.quality[id] = word;
      var tile = S.tiles[id];
      if (tile) tile.net.textContent = word === 'Weak' || word === 'Lost' ? '📶 ' + word : '';
      if (S.room && p === S.room.localParticipant) {
        setNet(word === 'Weak' || word === 'Lost' ? '📶 ' + word + ' wifi' : '', word === 'Weak' || word === 'Lost' ? 'warn' : '');
        if (S.role === 'student' && !S.prefs.lowData && S.prefs.autoLow) {
          if (word === 'Weak' || word === 'Lost') {
            if (!S.poorSince) S.poorSince = now();
            else if (now() - S.poorSince > LIMITS.poorLowDataMs) { S.poorSince = 0; setLowData(true, true); }
          } else {
            S.poorSince = 0;
          }
        }
      }
    }

    /* ---------- tracks ---------- */
    function sourceOf(pub) {
      var s = pub && pub.source;
      var T = S.LK && S.LK.Track && S.LK.Track.Source;
      if (T) {
        if (s === T.Camera) return 'camera';
        if (s === T.ScreenShare) return 'screen';
        if (s === T.Microphone) return 'microphone';
        if (s === T.ScreenShareAudio) return 'screen_audio';
      }
      return String(s || '').toLowerCase().replace('screen_share', 'screen');
    }
    function participantIn(p) {
      if (!p || !validIdentity(p.identity)) return;
      var r = roleOfIdentity(p.identity);
      if (S.role === 'teacher' && r === 'student') {
        var a = p.attributes || {};
        S.session = personJoined(S.session, { identity: p.identity, name: p.name, kind: a.kind, rosterId: a.rosterId, home: a.home }, now());
        saveSoon();
        tileFor(p.identity, p.name);
        paintSide();
      }
      if (S.role === 'student') p.trackPublications.forEach(function (pub) { subscribeOne(pub, p); });
    }
    function participantOut(p) {
      if (!p) return;
      if (S.role === 'teacher' && roleOfIdentity(p.identity) === 'student') {
        S.session = personLeft(S.session, p.identity, now());
        delete S.hands[p.identity];
        saveSoon();
        dropTile(p.identity);
        paintControls(); paintSide();
      }
      if (S.role === 'student' && roleOfIdentity(p.identity) === 'teacher') {
        if (S.mainEmpty) S.mainEmpty.textContent = 'Your teacher’s connection dropped. Waiting for them…';
      }
    }
    function subscribeOne(pub, p) {
      if (S.role !== 'student' || !pub || !p || !pub.setSubscribed) return;
      var want = wantTrack('student', S.prefs, p.identity, sourceOf(pub));
      try { if (pub.isSubscribed !== want) pub.setSubscribed(want); } catch (e) {}
      // A teacher's screen is read, so ask for its sharpest layer.
      if (want && sourceOf(pub) === 'screen' && pub.setVideoQuality && S.LK.VideoQuality) { try { pub.setVideoQuality(S.LK.VideoQuality.HIGH); } catch (e) {} }
    }
    function applySubscriptions() {
      if (!S.room || S.role !== 'student') return;
      S.room.remoteParticipants.forEach(function (p) { p.trackPublications.forEach(function (pub) { subscribeOne(pub, p); }); });
    }
    function mediaKey(identity, source) { return identity + '|' + source; }
    function trackIn(track, pub, p) {
      var source = sourceOf(pub);
      var key = mediaKey(p.identity, source);
      if (track.kind === 'audio') {
        var a = track.attach();
        a.dataset.vcKey = key;
        S.audioBox.appendChild(a);
        S.mediaEls[key] = { el: a, track: track };
        return;
      }
      var v = track.attach();
      v.playsInline = true; v.muted = true; v.autoplay = true;
      v.setAttribute('playsinline', '');
      v.className = 'vcVideo vcV-' + source;
      S.mediaEls[key] = { el: v, track: track, identity: p.identity, source: source };
      layout();
    }
    function trackOut(track, pub, p) {
      var key = mediaKey(p.identity, sourceOf(pub));
      var m = S.mediaEls[key];
      if (m) { try { track.detach(m.el); } catch (e) {} try { m.el.remove(); } catch (e) {} delete S.mediaEls[key]; }
      layout();
    }
    function localTrackIn(pub) {
      var source = sourceOf(pub);
      if (source !== 'camera' || !pub.track) { paintControls(); layout(); return; }
      var v = pub.track.attach();
      v.playsInline = true; v.muted = true; v.setAttribute('playsinline', '');
      v.className = 'vcVideo vcV-self' + (S.prefs.mirror ? ' mirror' : '');
      S.mediaEls[mediaKey('self', 'camera')] = { el: v, track: pub.track, identity: 'self', source: 'camera' };
      paintControls(); layout();
    }
    function localTrackOut(pub) {
      var source = sourceOf(pub);
      var key = mediaKey('self', source);
      var m = S.mediaEls[key];
      if (m) { try { m.el.remove(); } catch (e) {} delete S.mediaEls[key]; }
      paintControls(); layout();
    }
    function put(container, node) {
      if (!container || !node) return;
      if (node.parentNode !== container) {
        container.appendChild(node);
        // Moving a playing <video> can pause it (Safari): play it again.
        if (node.play) { var pr = node.play(); if (pr && pr.catch) pr.catch(function () {}); }
      }
    }
    function tileFor(identity, name) {
      if (S.tiles[identity]) { if (name) S.tiles[identity].name.textContent = name; return S.tiles[identity]; }
      var t = { el: el('div', 'vcTile'), media: el('div', 'vcTileMedia'), name: el('div', 'vcTileName', name || ''), badge: el('div', 'vcTileBadge'), net: el('div', 'vcTileNet'), hand: el('div', 'vcTileHand', '✋'), initials: el('div', 'vcInitials', initials(name)) };
      t.hand.hidden = true;
      t.el.dataset.identity = identity;
      t.media.appendChild(t.initials);
      t.el.appendChild(t.media); t.el.appendChild(t.name); t.el.appendChild(t.badge); t.el.appendChild(t.net); t.el.appendChild(t.hand);
      if (S.role === 'teacher') {
        t.el.tabIndex = 0;
        t.el.title = 'Tap for this student';
        t.el.addEventListener('click', function () { S.focusPerson = identity; S.tab = 'people'; paintSide(); });
      }
      S.tiles[identity] = t;
      return t;
    }
    function dropTile(identity) {
      var t = S.tiles[identity];
      if (t) { try { t.el.remove(); } catch (e) {} delete S.tiles[identity]; }
    }
    function initials(name) {
      return oneLine(name, 60).split(' ').filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || '🙂';
    }
    function media(identity, source) { var m = S.mediaEls[mediaKey(identity, source)]; return m ? m.el : null; }
    function teacherIdentity() {
      var id = '';
      if (S.room) S.room.remoteParticipants.forEach(function (p) { if (roleOfIdentity(p.identity) === 'teacher') id = p.identity; });
      return id;
    }

    // Where every picture goes, decided from scratch each time something changes.
    function layout() {
      if (S.mode !== 'live' || !S.stage) return;
      var selfCam = media('self', 'camera');
      if (S.role === 'teacher') {
        var ids = Object.keys(S.tiles).sort(function (a, b) {
          var ha = S.hands[a] ? 0 : 1, hb = S.hands[b] ? 0 : 1;
          if (ha !== hb) return ha - hb;
          return (S.tiles[a].name.textContent || '').localeCompare(S.tiles[b].name.textContent || '');
        });
        ids.forEach(function (id) {
          var t = S.tiles[id];
          put(S.grid, t.el);
          var v = media(id, 'camera');
          var pub = null;
          try { var rp = S.room.getParticipantByIdentity ? S.room.getParticipantByIdentity(id) : null; pub = rp && S.LK ? rp.getTrackPublication(S.LK.Track.Source.Camera) : null; } catch (e) {}
          var showVideo = v && !(pub && pub.isMuted);
          if (v) { if (showVideo) put(t.media, v); else if (v.parentNode) v.remove(); }
          t.initials.hidden = !!showVideo;
          t.hand.hidden = !S.hands[id];
          t.el.classList.toggle('hand', !!S.hands[id]);
          var q = currentQuestion();
          var e = q && S.session.answers[q.id] ? S.session.answers[q.id][id] : null;
          var mark = markOf(e);
          t.badge.textContent = !q ? '' : e ? (mark === true ? '✓' : mark === false ? '✗' : '✎') : meantFor(q, id) ? '…' : '';
          t.badge.className = 'vcTileBadge' + (e ? mark === true ? ' ok' : mark === false ? ' no' : ' in' : '');
        });
        S.mainEmpty.hidden = ids.length > 0;
        if (!ids.length && S.mainEmpty.parentNode !== S.grid) S.grid.appendChild(S.mainEmpty);
        if (ids.length && S.mainEmpty.parentNode) S.mainEmpty.remove();
        var g = gridFor(ids.length, S.grid.clientWidth || 600, S.grid.clientHeight || 400);
        S.grid.style.gridTemplateColumns = 'repeat(' + g.cols + ', minmax(0, 1fr))';
        S.grid.dataset.count = String(ids.length);
        if (selfCam) put(S.self, selfCam);
        S.self.hidden = !selfCam;
        S.pip.hidden = true;
        S.strip.hidden = true;
        S.stage.classList.toggle('sharing', !!S.sharing);
        return;
      }
      // Student: the teacher's screen big, the teacher's camera small beside
      // it; the teacher's camera big when nothing is shared.
      var tid = teacherIdentity();
      var screen = tid ? media(tid, 'screen') : null;
      var cam = tid ? media(tid, 'camera') : null;
      var mainNode = screen || cam;
      Array.prototype.slice.call(S.main.querySelectorAll('video')).forEach(function (v) { if (v !== mainNode) v.remove(); });
      Array.prototype.slice.call(S.pip.querySelectorAll('video')).forEach(function (v) { if (v !== cam || !screen) v.remove(); });
      if (mainNode) { put(S.main, mainNode); S.mainEmpty.hidden = true; }
      else {
        S.mainEmpty.hidden = false;
        if (tid) S.mainEmpty.textContent = S.prefs.lowData ? 'Low data is on — you can hear your teacher.' : 'Your teacher’s camera is off.';
      }
      S.main.classList.toggle('screen', !!screen);
      if (screen && cam) { put(S.pip, cam); S.pip.hidden = false; } else S.pip.hidden = true;
      if (selfCam) put(S.self, selfCam);
      S.self.hidden = !selfCam;
      // Classmates
      var classmates = [];
      if (S.room && S.prefs.classmates && !S.prefs.lowData) {
        S.room.remoteParticipants.forEach(function (p) { if (roleOfIdentity(p.identity) === 'student') classmates.push(p); });
      }
      var keep = {};
      classmates.forEach(function (p) {
        keep[p.identity] = true;
        var t = tileFor(p.identity, p.name);
        put(S.strip, t.el);
        var v = media(p.identity, 'camera');
        if (v) put(t.media, v);
        t.initials.hidden = !!v;
      });
      Object.keys(S.tiles).forEach(function (id) { if (!keep[id]) dropTile(id); });
      S.strip.hidden = !classmates.length;
    }
    function paintPresence() {
      if (S.role === 'teacher') { paintSide(true); }
    }

    /* ================================================================
       DATA: the questions and the answers
       ================================================================ */
    function send(msg, identities) {
      var room = S.room;
      if (!room || !room.localParticipant) return Promise.resolve(false);
      var opts = { reliable: true, topic: TOPIC };
      if (identities && identities.length) opts.destinationIdentities = identities;
      try {
        return Promise.resolve(room.localParticipant.publishData(encode(msg), opts)).then(function () { return true; }, function () { return false; });
      } catch (e) { return Promise.resolve(false); }
    }
    function broadcast(msg) { return send(msg, null); }
    function sendTeacher(msg) {
      var tid = teacherIdentity();
      if (!tid) return Promise.resolve(false);
      return send(msg, [tid]);
    }
    function sendImage(dataUrl, ref, identities) {
      var parts = chunkImage(dataUrl, ref);
      return parts.reduce(function (p, part) { return p.then(function () { return send(part, identities); }); }, Promise.resolve());
    }

    function onData(msg, p) {
      var from = p.identity, fromRole = roleOfIdentity(from);
      if (msg.t === 'img') {
        var whole = S.assembler.add(msg);
        if (whole) imageArrived(msg.ref, whole, from);
        return;
      }
      if (S.role === 'teacher') {
        if (fromRole !== 'student') return;
        if (msg.t === 'hello') return onHello(from);
        if (msg.t === 'a') return onAnswer(from, msg);
        if (msg.t === 'hand') return onHand(from, !!msg.up);
        if (msg.t === 'needimg') return onNeedImage(from, msg.ref);
        return;
      }
      // A student's device obeys only the teacher's identity, which the
      // server alone can hand out.
      if (fromRole !== 'teacher') return;
      if (msg.t === 'q') return onQuestion(msg.q);
      if (msg.t === 'state') return onState(msg);
      if (msg.t === 'qend') return onQuestionEnd(msg.id);
      if (msg.t === 'reveal') return onReveal(msg);
      if (msg.t === 'ack') return onAck(msg);
      if (msg.t === 'mark') return onMark(msg);
      if (msg.t === 'hand') {
        S.handUp = !!msg.up; paintControls();
        if (msg.speak) say('🎤 Your teacher would like to hear you — tap the microphone to unmute.');
        else if (!msg.up) say('Your teacher put your hand down.');
        return;
      }
      if (msg.t === 'end') { S.leaving = true; disconnect(); paintStudentEnded(); return; }
    }
    function imageArrived(ref, dataUrl, from) {
      S.images[ref] = dataUrl;
      if (S.role === 'teacher') {
        if (typeof env.savePhoto === 'function' && S.session) {
          Promise.resolve(env.savePhoto(S.session.epoch, ref, dataUrl)).catch(function () {});
        }
        // An answer that was waiting for its photo can now be acknowledged.
        var waiting = S.pendingPhotos[ref];
        if (waiting) { delete S.pendingPhotos[ref]; send({ t: 'ack', aid: waiting.aid, qid: waiting.qid }, [waiting.identity]); }
        paintSide(true);
      } else {
        paintQuestion();
      }
    }

    /* ---------- the teacher's side of the wire ---------- */
    function openQuestionsFor(identity) {
      return S.session.questions.filter(function (q) { return q.open && meantFor(q, identity); });
    }
    function onHello(identity) {
      var qs = openQuestionsFor(identity);
      var mine = {};
      qs.forEach(function (q) {
        var e = (S.session.answers[q.id] || {})[identity];
        if (e) mine[q.id] = { aid: e.aid, ok: markOf(e), pts: e.pts || 0 };
      });
      var revealed = S.session.questions.filter(function (q) { return q.revealed && meantFor(q, identity); }).slice(-3).map(function (q) {
        var e = (S.session.answers[q.id] || {})[identity];
        return { q: questionForStudent(q), answer: revealOf(q), mine: e ? { aid: e.aid, v: e.v, ok: markOf(e), pts: e.pts || 0 } : null };
      });
      var chain = Promise.resolve();
      qs.forEach(function (q) { if (q.img && S.images[q.img.ref]) chain = chain.then(function () { return sendImage(S.images[q.img.ref], q.img.ref, [identity]); }); });
      chain.then(function () {
        send({ t: 'state', qs: qs.map(questionForStudent).filter(Boolean), mine: mine, revealed: revealed, hand: !!S.hands[identity] }, [identity]);
      });
    }
    function onNeedImage(identity, ref) {
      if (!S.images[ref]) return;
      sendImage(S.images[ref], ref, [identity]);
    }
    function onAnswer(identity, msg) {
      var res = recordAnswer(S.session, identity, msg, now());
      if (res.reason === 'closed') { send({ t: 'ack', aid: msg.aid, qid: msg.qid, closed: true }, [identity]); return; }
      if (res.reason === 'unknown' || res.reason === 'empty') return;
      S.session = res.session;
      var e = res.entry;
      if (e && e.ph && !S.images[e.ph]) {
        // Acknowledge only once the photo has arrived, so the student's
        // device keeps sending it until it does.
        S.pendingPhotos[e.ph] = { aid: e.aid, qid: msg.qid, identity: identity };
        if (S.assembler.has(e.ph) === false) send({ t: 'needimg', ref: e.ph }, [identity]);
      } else {
        send({ t: 'ack', aid: msg.aid, qid: msg.qid }, [identity]);
      }
      if (res.fresh) {
        saveSoon();
        layout();
        paintSide(true);
      }
    }
    function onHand(identity, up) {
      if (up) {
        if (!S.hands[identity]) {
          S.hands[identity] = now();
          var p = S.session.people[identity];
          if (p) { var q = Object.assign({}, p); q.hands = (q.hands || 0) + 1; var people = Object.assign({}, S.session.people); people[identity] = q; S.session = Object.assign({}, S.session, { people: people }); saveSoon(); }
          say('✋ ' + ((p && p.name) || 'A student') + ' raised a hand.');
          chime();
        }
      } else {
        delete S.hands[identity];
      }
      paintControls(); layout(); paintSide(true);
    }
    function lowerHand(identity) {
      delete S.hands[identity];
      send({ t: 'hand', up: false }, [identity]);
      paintControls(); layout(); paintSide(true);
    }
    function revealOf(q) {
      if (q.kind === 'mcq') return q.answer >= 0 ? { index: q.answer, text: letter(q.answer) + '. ' + q.options[q.answer] } : null;
      if (q.kind === 'blank') return q.accepted && q.accepted.length ? { text: q.accepted[0] } : null;
      return q.model ? { text: q.model } : null;
    }
    function resendOpenQuestions() {
      if (!S.session) return;
      S.session.questions.filter(function (q) { return q.open; }).forEach(function (q) { pushQuestion(q, true); });
    }
    function teacherTick() {
      // Pictures that only partly arrived are dropped after a few minutes.
      S.assembler.sweep(5 * 60 * 1000);
    }
    function currentQuestion() {
      if (!S.session) return null;
      for (var i = S.session.questions.length - 1; i >= 0; i--) if (S.session.questions[i].open) return S.session.questions[i];
      return S.session.questions[S.session.questions.length - 1] || null;
    }
    function presentStudents() {
      return Object.keys(S.session.people).filter(function (k) { return S.session.people[k].here; });
    }

    function pushQuestion(q, quiet) {
      var targets = q.to === 'all' ? null : q.to;
      var chain = Promise.resolve();
      if (q.img && S.images[q.img.ref]) chain = chain.then(function () { return sendImage(S.images[q.img.ref], q.img.ref, targets); });
      return chain.then(function () { return send({ t: 'q', q: questionForStudent(q) }, targets); }).then(function (ok) {
        if (!quiet) say(ok ? 'Question sent to ' + (targets ? targets.length + ' student' + (targets.length === 1 ? '' : 's') : 'the class') + '.' : 'The question could not be sent. Check the connection.');
      });
    }
    function chime() {
      try {
        var Ctx = root.AudioContext || root.webkitAudioContext;
        if (!Ctx) return;
        S.chimeCtx = S.chimeCtx || new Ctx();
        var c = S.chimeCtx, o = c.createOscillator(), g = c.createGain();
        o.frequency.value = 880; g.gain.value = 0.0001;
        o.connect(g); g.connect(c.destination);
        var t = c.currentTime;
        g.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        o.start(t); o.stop(t + 0.4);
      } catch (e) {}
    }

    /* ---------- the student's side of the wire ---------- */
    function outboxKey() { return OUTBOX_PREFIX + (S.room_name || '') + ':' + (S.identity || ''); }
    function loadOutbox() {
      var box = readJson(session(), outboxKey(), {});
      S.outbox = box && typeof box === 'object' ? box : {};
      // A reloaded page lost its pictures' bytes only if storage refused them.
      Object.keys(S.outbox).forEach(function (k) { var e = S.outbox[k]; if (e) e.sentAt = 0; });
    }
    function saveOutbox() {
      if (!writeJson(session(), outboxKey(), S.outbox)) {
        // Too big to keep with its photo: keep the words at least.
        var slim = {};
        Object.keys(S.outbox).forEach(function (k) { slim[k] = Object.assign({}, S.outbox[k], { photo: '' }); });
        writeJson(session(), outboxKey(), slim);
      }
    }
    function sayHello() {
      S.gotState = false;
      clearTimeout(S.helloTimer);
      var tries = 0;
      (function again() {
        if (S.mode !== 'live' || S.role !== 'student' || S.gotState) return;
        if (teacherIdentity()) sendTeacher({ t: 'hello' });
        if (++tries < 20) S.helloTimer = setTimeout(again, LIMITS.helloMs);
      })();
    }
    function studentTick() { flushOutbox(false); S.assembler.sweep(5 * 60 * 1000); }
    function flushOutbox(force) {
      if (S.mode !== 'live' || !teacherIdentity()) return;
      var due = outboxDue(S.outbox, force ? Infinity : now(), LIMITS.resendMs);
      if (!due.length) return;
      due.forEach(function (e) {
        e.sentAt = now();
        e.tries = (e.tries || 0) + 1;
        var chain = Promise.resolve();
        if (e.ph && e.photo && (e.tries === 1 || e.tries % 3 === 0 || force)) chain = chain.then(function () { return sendImage(e.photo, e.ph, [teacherIdentity()]); });
        chain.then(function () { return sendTeacher({ t: 'a', aid: e.aid, qid: e.qid, v: e.v, ph: e.ph || undefined, at: e.at }); });
        var mine = S.mine[e.qid];
        if (mine && mine.aid === e.aid && e.tries > 2 && !mine.slow) { mine.slow = true; paintQuestion(); }
      });
      saveOutbox();
    }
    function openQuestions() {
      return S.order.map(function (id) { return S.questions[id]; }).filter(function (q) { return q && q.open; });
    }
    function onQuestion(raw) {
      var q = cleanQuestion(raw);
      if (!q) return;
      var isNew = !S.questions[q.id];
      S.questions[q.id] = q;
      if (S.order.indexOf(q.id) === -1) S.order.push(q.id);
      if (q.img && !S.images[q.img.ref]) {
        // The picture comes in pieces just before the question; ask again if
        // it has not arrived in a few seconds.
        setTimeout(function () { if (!S.images[q.img.ref] && S.mode === 'live') sendTeacher({ t: 'needimg', ref: q.img.ref }); }, 5000);
      }
      if (isNew) {
        S.popMin = false;
        if (S.view === 'mini') setView('float');
        chime();
      }
      paintQuestion(); paintControls();
    }
    function onState(msg) {
      S.gotState = true;
      var ids = {};
      (Array.isArray(msg.qs) ? msg.qs : []).forEach(function (raw) {
        var q = cleanQuestion(raw); if (!q) return;
        ids[q.id] = true;
        S.questions[q.id] = q;
        if (S.order.indexOf(q.id) === -1) S.order.push(q.id);
      });
      // A question this device thought was open but the teacher has closed.
      Object.keys(S.questions).forEach(function (id) { if (S.questions[id].open && !ids[id]) S.questions[id].open = false; });
      var mine = msg.mine && typeof msg.mine === 'object' ? msg.mine : {};
      Object.keys(mine).forEach(function (qid) {
        var m = mine[qid] || {};
        var have = S.mine[qid] || {};
        if (!have.aid || have.aid === m.aid) S.mine[qid] = Object.assign({}, have, { aid: m.aid, sent: true, acked: true, ok: m.ok, pts: m.pts });
        S.outbox = outboxAck(S.outbox, m.aid);
      });
      (Array.isArray(msg.revealed) ? msg.revealed : []).forEach(function (r) {
        var q = r && cleanQuestion(r.q); if (!q) return;
        q.open = false; q.revealed = r.answer || null;
        S.questions[q.id] = Object.assign({}, S.questions[q.id] || {}, q);
        if (S.order.indexOf(q.id) === -1) S.order.push(q.id);
        if (r.mine) S.mine[q.id] = Object.assign({}, S.mine[q.id] || {}, { aid: r.mine.aid, v: r.mine.v, sent: true, acked: true, ok: r.mine.ok, pts: r.mine.pts });
      });
      S.handUp = !!msg.hand;
      saveOutbox();
      flushOutbox(true);
      paintQuestion(); paintControls();
    }
    function onQuestionEnd(id) {
      var q = S.questions[id];
      if (!q) return;
      q.open = false;
      paintQuestion(); paintControls();
    }
    function onReveal(msg) {
      var q = S.questions[msg.id];
      if (!q) return;
      q.open = false;
      q.revealed = msg.answer || { text: '' };
      if (!S.popup || S.popup !== q.id) S.popMin = false;
      paintQuestion(); paintControls();
    }
    function onAck(msg) {
      S.outbox = outboxAck(S.outbox, msg.aid);
      saveOutbox();
      var m = S.mine[msg.qid];
      if (m && m.aid === msg.aid) { m.acked = true; m.slow = false; if (msg.closed) m.late = true; }
      paintQuestion();
    }
    function onMark(msg) {
      var m = S.mine[msg.qid] || (S.mine[msg.qid] = {});
      if (msg.ok === true || msg.ok === false) m.ok = msg.ok; else if (msg.ok === null) m.ok = null;
      if (typeof msg.pts === 'number') {
        var gained = msg.pts - (m.pts || 0);
        m.pts = msg.pts;
        if (gained > 0) say('⭐ +' + gained + ' point' + (gained === 1 ? '' : 's') + ' from your teacher!');
      }
      if (msg.note) m.note = oneLine(msg.note, 300);
      if (S.questions[msg.qid] && !S.questions[msg.qid].open) S.popMin = false;
      paintQuestion();
    }

    /* ---------- the pop-up over the video ---------- */
    function questionToShow() {
      var open = openQuestions();
      if (open.length) return open[open.length - 1];
      // The last closed one stays up while it has news (a reveal, a mark).
      for (var i = S.order.length - 1; i >= 0; i--) {
        var q = S.questions[S.order[i]];
        if (q && (q.revealed || (S.mine[q.id] && (S.mine[q.id].ok != null))) && !q.dismissed) return q;
        if (q) break;
      }
      return null;
    }
    function paintQuestion() {
      if (!S.qLayer || S.role !== 'student') return;
      var q = questionToShow();
      clear(S.qLayer);
      S.qLayer.hidden = !q || S.popMin;
      if (!q || S.popMin) { S.popup = null; return; }
      var keepDraft = S.popup === q.id && S.draft;
      S.popup = q.id;
      var mine = S.mine[q.id] || {};
      var card = el('div', 'vcQ');
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-label', 'Question from your teacher');
      var head = el('div', 'vcQHead');
      head.appendChild(el('span', 'vcQTag', (q.n ? 'Q' + q.n + ' · ' : '') + KIND_LABEL[q.kind]));
      var hide = btn('vcIcon', '–', 'Hide the question for now', function () { S.popMin = true; paintQuestion(); paintControls(); });
      head.appendChild(hide);
      card.appendChild(head);
      if (q.text) card.appendChild(el('div', 'vcQText', q.text));
      if (q.img) {
        var src = S.images[q.img.ref];
        if (src) {
          var img = el('img', 'vcQImg');
          img.alt = 'The question’s picture';
          img.src = src;
          img.addEventListener('click', function () { openBigPhoto(src); });
          card.appendChild(img);
        } else {
          card.appendChild(el('div', 'vcQImgWait', 'Loading the picture…'));
        }
      }
      var body = el('div', 'vcQBody');
      card.appendChild(body);
      var closed = !q.open;
      var draft = keepDraft || { v: mine.v != null ? mine.v : null, photo: mine.photo || '' };
      S.draft = draft;
      if (q.kind === 'mcq') {
        var opts = el('div', 'vcOpts');
        q.options.forEach(function (o, i) {
          var chosen = draft.v === i;
          var right = q.revealed && q.revealed.index === i;
          var b = btn('vcOpt' + (chosen ? ' on' : '') + (right ? ' right' : '') + (q.revealed && chosen && !right ? ' wrong' : ''), '', null, function () {
            if (closed) return;
            draft.v = i;
            submit(q, draft);
          });
          b.appendChild(el('span', 'vcOptLetter', letter(i)));
          b.appendChild(el('span', 'vcOptText', o));
          b.disabled = closed;
          b.setAttribute('aria-pressed', chosen ? 'true' : 'false');
          opts.appendChild(b);
        });
        body.appendChild(opts);
      } else if (q.kind === 'blank') {
        var row = el('div', 'vcBlankRow');
        var input = el('input', 'vcBlank');
        input.type = 'text';
        input.placeholder = 'Type your answer';
        input.value = draft.v != null ? String(draft.v) : '';
        input.maxLength = 200;
        input.disabled = closed;
        input.autocomplete = 'off';
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('aria-label', 'Your answer');
        input.addEventListener('input', function () { draft.v = input.value; mine.dirty = true; syncSend(); });
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); sendBtn.click(); } });
        row.appendChild(input);
        var sendBtn = btn('vcPrimary', mine.sent && !mine.dirty ? 'Send again' : 'Send', null, function () { if (!closed && oneLine(input.value, 200)) { draft.v = input.value; submit(q, draft); } });
        row.appendChild(sendBtn);
        body.appendChild(row);
        var syncSend = function () { sendBtn.disabled = closed || !oneLine(input.value, 200); };
        syncSend();
        if (!closed && !mine.sent) setTimeout(function () { try { input.focus({ preventScroll: true }); } catch (e) {} }, 30);
      } else {
        var ta = el('textarea', 'vcOpen');
        ta.placeholder = 'Write your answer here';
        ta.rows = 4;
        ta.value = draft.v != null ? String(draft.v) : '';
        ta.disabled = closed;
        ta.maxLength = LIMITS.answer;
        ta.setAttribute('aria-label', 'Your answer');
        ta.addEventListener('input', function () { draft.v = ta.value; mine.dirty = true; syncOpen(); });
        body.appendChild(ta);
        var tools = el('div', 'vcOpenTools');
        if (q.photo !== false) {
          var file = el('input');
          file.type = 'file'; file.accept = 'image/*'; file.setAttribute('capture', 'environment'); file.hidden = true;
          file.addEventListener('change', function () {
            var f = file.files && file.files[0];
            if (!f) return;
            shrinkPhoto(f, LIMITS.photoPx).then(function (d) { draft.photo = d; mine.dirty = true; paintQuestion(); }, function () { say('That photo could not be read. Try again.'); });
          });
          tools.appendChild(file);
          tools.appendChild(btn('', draft.photo ? '📷 Change photo' : '📷 Add a photo of my working', 'Take or choose a photo', function () { if (!closed) file.click(); }));
          var camVid = media('self', 'camera');
          if (camVid) tools.appendChild(btn('', '🎦 Snap from my camera', 'Take a picture from your video camera — hold your work up to it', function () {
            if (closed) return;
            snapVideo(camVid).then(function (d) { if (d) { draft.photo = d; mine.dirty = true; paintQuestion(); } });
          }));
          if (draft.photo) {
            var th = el('img', 'vcThumb'); th.src = draft.photo; th.alt = 'Your photo';
            th.addEventListener('click', function () { openBigPhoto(draft.photo); });
            tools.appendChild(th);
            tools.appendChild(btn('vcIcon', '✕', 'Remove the photo', function () { draft.photo = ''; mine.dirty = true; paintQuestion(); }));
          }
        }
        var sendOpen = btn('vcPrimary', mine.sent && !mine.dirty ? 'Send again' : 'Send', null, function () {
          if (closed) return;
          draft.v = ta.value;
          if (!oneLine(ta.value, 50) && !draft.photo) return;
          submit(q, draft);
        });
        tools.appendChild(el('span', 'vcBarGap'));
        tools.appendChild(sendOpen);
        body.appendChild(tools);
        var syncOpen = function () { sendOpen.disabled = closed || (!oneLine(ta.value, 50) && !draft.photo); };
        syncOpen();
      }
      var status = el('div', 'vcQStatus');
      var text = '';
      if (mine.sent) {
        text = mine.acked ? (mine.late ? 'Your teacher had already closed this question.' : '✓ Your teacher has your answer.') : mine.slow ? 'Still sending… (weak connection — it will keep trying)' : 'Sending…';
      }
      if (closed && !mine.sent) text = q.revealed ? 'The question is closed.' : 'Your teacher has closed this question.';
      if (q.revealed && q.revealed.text) text = 'Answer: ' + q.revealed.text + (text ? ' · ' + text : '');
      if (mine.ok === true) { status.classList.add('ok'); text = '✓ Correct!' + (mine.pts ? ' ⭐ +' + mine.pts : '') + (q.revealed && q.revealed.text && q.kind !== 'mcq' ? ' · Answer: ' + q.revealed.text : ''); }
      if (mine.ok === false) { status.classList.add('no'); text = '✗ Not quite.' + (q.revealed && q.revealed.text ? ' Answer: ' + q.revealed.text : ' Have another look.'); }
      if (mine.note) text += ' · ' + mine.note;
      status.textContent = text;
      card.appendChild(status);
      if (closed && (q.revealed || mine.ok != null)) {
        card.appendChild(btn('vcDone', 'OK', null, function () { q.dismissed = true; paintQuestion(); paintControls(); }));
      }
      S.qLayer.appendChild(card);
    }
    function submit(q, draft) {
      if (!q.open) return;
      var value = cleanAnswer(q.kind, draft.v);
      if ((value == null || value === '') && !draft.photo) return;
      var aid = randomId('a');
      var ph = draft.photo ? randomId('p') : '';
      var entry = { aid: aid, qid: q.id, v: value, ph: ph, photo: draft.photo || '', at: now(), sentAt: 0, tries: 0 };
      S.outbox = outboxAdd(S.outbox, entry);
      S.mine[q.id] = { aid: aid, v: value, photo: draft.photo || '', sent: true, acked: false, ok: null, pts: (S.mine[q.id] || {}).pts || 0 };
      saveOutbox();
      flushOutbox(true);
      paintQuestion();
    }
    function shrinkPhoto(file, maxPx) {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          try {
            var k = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
            var c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
            var ctx = c.getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
            ctx.drawImage(img, 0, 0, c.width, c.height);
            var q = 0.72, d = c.toDataURL('image/jpeg', q);
            while (d.length > LIMITS.imageChars && q > 0.3) { q -= 0.12; d = c.toDataURL('image/jpeg', q); }
            URL.revokeObjectURL(url);
            if (!validImage(d)) return reject(new Error('too big'));
            resolve(d);
          } catch (e) { URL.revokeObjectURL(url); reject(e); }
        };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
        img.src = url;
      });
    }
    function snapVideo(video) {
      try {
        var w = video.videoWidth, h = video.videoHeight;
        if (!w || !h) return Promise.resolve('');
        var k = Math.min(1, LIMITS.photoPx / Math.max(w, h));
        var c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);   // never mirrored: words held up stay readable
        return Promise.resolve(c.toDataURL('image/jpeg', 0.75));
      } catch (e) { return Promise.resolve(''); }
    }
    function openBigPhoto(src) {
      closeBigPhoto();
      var back = el('div', 'vcPhotoBack');
      var img = el('img', 'vcPhotoBig'); img.src = src; img.alt = 'Photo';
      back.appendChild(img);
      back.appendChild(btn('vcIcon vcPhotoX', '✕', 'Close the photo', closeBigPhoto));
      back.addEventListener('click', function (e) { if (e.target === back) closeBigPhoto(); });
      S.win.appendChild(back);
      S.bigPhoto = back;
    }
    function closeBigPhoto() { if (S.bigPhoto) { S.bigPhoto.remove(); S.bigPhoto = null; } }


    /* ================================================================
       THE TEACHER'S SIDE PANEL: Ask · Answers · People · Reports
       ================================================================ */
    var TABS = [
      { id: 'ask', icon: '❓', label: 'Ask' },
      { id: 'answers', icon: '📝', label: 'Answers' },
      { id: 'people', icon: '👥', label: 'People' },
      { id: 'reports', icon: '🧾', label: 'Reports' }
    ];
    function typingInSide() {
      var a = document.activeElement;
      return !!(S.side && a && S.side.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'));
    }
    // soft = "something changed elsewhere": the panel is redrawn only when
    // nobody is typing in it, so a question half-written is never wiped.
    function paintSide(soft) {
      if (!S.side || S.role !== 'teacher' || !S.session) return;
      if (soft && typingInSide()) { paintTabs(); return; }
      var keepScroll = S.sideBody ? S.sideBody.scrollTop : 0;
      clear(S.side);
      S.sideTabs = el('div', 'vcTabs');
      S.sideTabs.setAttribute('role', 'tablist');
      S.side.appendChild(S.sideTabs);
      S.sideBody = el('div', 'vcSideBody');
      S.side.appendChild(S.sideBody);
      paintTabs();
      var tab = S.mode === 'ended' && (S.tab === 'ask' || S.tab === 'people') ? 'reports' : S.tab;
      if (tab === 'ask') paintAsk(S.sideBody);
      else if (tab === 'answers') paintAnswers(S.sideBody);
      else if (tab === 'people') paintPeople(S.sideBody);
      else paintReports(S.sideBody);
      if (soft) S.sideBody.scrollTop = keepScroll;
    }
    function paintTabs() {
      if (!S.sideTabs) return;
      clear(S.sideTabs);
      var s = S.session;
      var waitingNow = 0, unmarked = 0;
      var cur = currentQuestion();
      if (cur && cur.open) waitingNow = questionStats(s, cur, presentStudents()).waiting.length;
      s.questions.forEach(function (q) { unmarked += questionStats(s, q, []).unmarked; });
      var here = presentStudents().length;
      var hands = Object.keys(S.hands).length;
      TABS.forEach(function (t) {
        if (S.mode === 'ended' && (t.id === 'ask' || t.id === 'people')) return;
        var badge = '';
        if (t.id === 'answers' && (waitingNow || unmarked)) badge = waitingNow ? '⏳' + waitingNow : '•' + unmarked;
        if (t.id === 'people') badge = (hands ? '✋' + hands + ' ' : '') + here;
        var b = btn('vcTab' + (S.tab === t.id ? ' on' : ''), t.icon + ' ' + t.label, null, function () { S.tab = t.id; paintSide(); });
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', S.tab === t.id ? 'true' : 'false');
        if (badge) b.appendChild(el('span', 'vcBadge', badge));
        S.sideTabs.appendChild(b);
      });
    }

    /* ---------- ❓ Ask: build a question and push it ---------- */
    function blankCompose(kind) {
      return { kind: kind || 'mcq', text: '', options: ['', '', '', ''], answer: -1, accepted: '', model: '', photo: true, img: '', to: 'all', pick: {} };
    }
    function paintAsk(box) {
      var c = S.compose || (S.compose = blankCompose(S.prefs.lastKind));
      var card = el('div', 'vcAsk');

      // Quick questions: one tap, for "everyone look at the board".
      var quick = el('div', 'vcQuick');
      quick.appendChild(el('span', 'vcMuted', 'Quick:'));
      quick.appendChild(btn('vcChip', '⚡ A B C D', 'Push a multiple-choice question with options A to D', function () {
        sendQuestion({ kind: 'mcq', text: c.text || 'Which one? Look at the question on the screen.', options: ['A', 'B', 'C', 'D'], answer: -1, img: c.img, to: c.to, pick: c.pick });
      }));
      quick.appendChild(btn('vcChip', '⚡ True / False', 'Push a true-or-false question', function () {
        sendQuestion({ kind: 'mcq', text: c.text || 'True or false?', options: ['True', 'False'], answer: -1, img: c.img, to: c.to, pick: c.pick });
      }));
      quick.appendChild(btn('vcChip', '⚡ Show working', 'Ask everyone for a photo of their working', function () {
        sendQuestion({ kind: 'open', text: c.text || 'Show me your working. Add a photo of your page.', photo: true, img: c.img, to: c.to, pick: c.pick });
      }));
      card.appendChild(quick);

      // The kind.
      var kinds = el('div', 'vcSeg');
      KINDS.forEach(function (k) {
        kinds.appendChild(btn('vcSegBtn' + (c.kind === k ? ' on' : ''), KIND_LABEL[k], null, function () {
          c.kind = k; S.prefs.lastKind = k; savePrefs(); paintSide();
        }));
      });
      card.appendChild(kinds);

      // The question.
      var qLab = el('label', 'vcField');
      qLab.appendChild(el('span', null, c.kind === 'blank' ? 'Question (use ___ for the blank)' : 'Question'));
      var ta = el('textarea', 'vcQText');
      ta.rows = 3;
      ta.placeholder = c.kind === 'mcq' ? 'e.g. Which of these is a conductor of electricity?'
        : c.kind === 'blank' ? 'e.g. Water boils at ___ °C.' : 'e.g. Explain why the ice melted faster on the metal tray.';
      ta.value = c.text;
      ta.addEventListener('input', function () { c.text = ta.value; syncSend(); });
      qLab.appendChild(ta);
      card.appendChild(qLab);

      // A picture: what is on the worksheet now, or a file.
      var pic = el('div', 'vcPicRow');
      if (c.img) {
        var th = el('img', 'vcThumb'); th.src = c.img; th.alt = 'The picture that goes with the question';
        th.addEventListener('click', function () { openBigPhoto(c.img); });
        pic.appendChild(th);
        pic.appendChild(btn('vcIcon', '✕', 'Take the picture off', function () { c.img = ''; paintSide(); }));
      }
      if (typeof env.snapWorksheet === 'function') {
        pic.appendChild(btn('', '📸 Add what’s on my page', 'Put the part of the worksheet you can see into the question', function () {
          Promise.resolve(env.snapWorksheet()).then(function (d) {
            if (d && validImage(d)) { c.img = d; paintSide(); } else say('Open a worksheet first, then try again.');
          }, function (e) { say('The page could not be captured: ' + ((e && e.message) || e)); });
        }));
      }
      var file = el('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true;
      file.addEventListener('change', function () {
        var f = file.files && file.files[0];
        if (!f) return;
        shrinkPhoto(f, LIMITS.questionImgPx).then(function (d) { c.img = d; paintSide(); }, function () { say('That picture could not be read.'); });
      });
      pic.appendChild(file);
      pic.appendChild(btn('', '🖼 Picture…', 'Add a picture from this device', function () { file.click(); }));
      card.appendChild(pic);

      // The kind's own fields.
      if (c.kind === 'mcq') {
        var opts = el('div', 'vcOpts');
        opts.appendChild(el('span', 'vcMuted', 'Options — tick the right one to mark answers by themselves (optional)'));
        c.options.forEach(function (o, i) {
          var row = el('div', 'vcOptRow');
          var right = el('input'); right.type = 'radio'; right.name = 'vcRight'; right.checked = c.answer === i;
          right.title = 'This is the right answer';
          right.addEventListener('change', function () { c.answer = i; });
          right.addEventListener('click', function () { if (c.answer === i && right.dataset.was === '1') { c.answer = -1; right.checked = false; } right.dataset.was = right.checked ? '1' : ''; });
          right.dataset.was = right.checked ? '1' : '';
          row.appendChild(right);
          row.appendChild(el('b', 'vcOptL', letter(i)));
          var inp = el('input'); inp.type = 'text'; inp.value = o; inp.placeholder = 'Option ' + letter(i);
          inp.addEventListener('input', function () { c.options[i] = inp.value; syncSend(); });
          row.appendChild(inp);
          if (c.options.length > 2) row.appendChild(btn('vcIcon', '−', 'Remove this option', function () {
            c.options.splice(i, 1);
            if (c.answer === i) c.answer = -1; else if (c.answer > i) c.answer--;
            paintSide();
          }));
          opts.appendChild(row);
        });
        if (c.options.length < LIMITS.options) opts.appendChild(btn('vcChip', '+ Option', null, function () { c.options.push(''); paintSide(); }));
        card.appendChild(opts);
      } else if (c.kind === 'blank') {
        var aLab = el('label', 'vcField');
        aLab.appendChild(el('span', null, 'Accepted answers, one per line (optional — marks answers by themselves)'));
        var acc = el('textarea'); acc.rows = 2; acc.value = c.accepted; acc.placeholder = '100\n100 °C';
        acc.addEventListener('input', function () { c.accepted = acc.value; });
        aLab.appendChild(acc);
        card.appendChild(aLab);
        card.appendChild(el('p', 'vcHint', 'Numbers match however they are written (100, 100.0, 1e2), and capitals and spaces are ignored.'));
      } else {
        var mLab = el('label', 'vcField');
        mLab.appendChild(el('span', null, 'Model answer (optional — shown when you reveal)'));
        var model = el('textarea'); model.rows = 2; model.value = c.model;
        model.addEventListener('input', function () { c.model = model.value; });
        mLab.appendChild(model);
        card.appendChild(mLab);
        var ph = el('label', 'vcCheck');
        var phBox = el('input'); phBox.type = 'checkbox'; phBox.checked = c.photo !== false;
        phBox.addEventListener('change', function () { c.photo = phBox.checked; });
        ph.appendChild(phBox); ph.appendChild(el('span', null, 'Students may add a photo of their working'));
        card.appendChild(ph);
      }

      // Who it goes to.
      var here = presentStudents();
      var toBox = el('div', 'vcTo');
      toBox.appendChild(el('span', 'vcMuted', 'Send to'));
      var seg = el('div', 'vcSeg');
      seg.appendChild(btn('vcSegBtn' + (c.to === 'all' ? ' on' : ''), 'Everyone (' + here.length + ')', null, function () { c.to = 'all'; paintSide(); }));
      seg.appendChild(btn('vcSegBtn' + (c.to === 'some' ? ' on' : ''), 'Chosen students', null, function () { c.to = 'some'; paintSide(); }));
      toBox.appendChild(seg);
      card.appendChild(toBox);
      if (c.to === 'some') {
        var chips = el('div', 'vcPickChips');
        if (!here.length) chips.appendChild(el('span', 'vcMuted', 'Nobody is in the class yet.'));
        here.forEach(function (id) {
          var p = S.session.people[id];
          var chip = btn('vcChip' + (c.pick[id] ? ' on' : ''), (c.pick[id] ? '✓ ' : '') + p.name, null, function () {
            if (c.pick[id]) delete c.pick[id]; else c.pick[id] = true;
            paintSide();
          });
          chips.appendChild(chip);
        });
        card.appendChild(chips);
      }

      var foot = el('div', 'vcRow vcAskFoot');
      var sendBtn = btn('vcPrimary', '📤 Push the question', null, function () { sendQuestion(c, true); });
      foot.appendChild(sendBtn);
      foot.appendChild(btn('', 'Clear', null, function () { S.compose = blankCompose(c.kind); paintSide(); }));
      card.appendChild(foot);
      function syncSend() {
        var ok = !!(oneLine(c.text, 10) || c.img);
        if (c.kind === 'mcq') ok = ok && c.options.filter(function (o) { return oneLine(o, 5); }).length >= 2;
        sendBtn.disabled = !ok;
      }
      syncSend();
      box.appendChild(card);

      // What was asked so far, newest first.
      if (S.session.questions.length) {
        var past = el('div', 'vcPast');
        past.appendChild(el('h4', null, 'Asked this lesson'));
        S.session.questions.slice().reverse().slice(0, 8).forEach(function (q) {
          var st = questionStats(S.session, q, presentStudents());
          var row = btn('vcPastRow', '', null, function () { S.focusQ = q.id; S.tab = 'answers'; paintSide(); });
          row.appendChild(el('b', null, 'Q' + q.n));
          row.appendChild(el('span', 'vcPastText', q.text || '(picture)'));
          row.appendChild(el('span', 'vcMuted', st.answered + '/' + Math.max(st.asked, st.answered) + (q.open ? ' · open' : '')));
          past.appendChild(row);
        });
        box.appendChild(past);
      }
    }

    // ONE way a question leaves the teacher: built through cleanQuestion,
    // recorded in the lesson, then pushed.
    function sendQuestion(c, fromComposer) {
      if (!isTeacher() || !S.session || S.mode !== 'live') return;
      if (S.session.questions.length >= LIMITS.questions) { say('That is the most questions one lesson can hold.'); return; }
      var to = 'all';
      if (c.to === 'some') {
        to = Object.keys(c.pick || {}).filter(function (id) { return S.session.people[id] && S.session.people[id].here; });
        if (!to.length) { say('Choose at least one student who is in the class.'); return; }
      }
      var img = null;
      if (c.img) {
        if (!validImage(c.img)) { say('That picture is too big to send.'); return; }
        var ref = randomId('i');
        S.images[ref] = c.img;
        img = { ref: ref, n: chunkImage(c.img, ref).length };
        if (typeof env.savePhoto === 'function') Promise.resolve(env.savePhoto(S.session.epoch, ref, c.img)).catch(function () {});
      }
      var q = cleanQuestion({
        id: randomId('q'), kind: c.kind, text: c.text, options: c.options, answer: c.answer,
        accepted: c.accepted, model: c.model, photo: c.photo, img: img, to: to, at: now(), n: S.session.questions.length + 1, open: true
      });
      if (!q) { say(c.kind === 'mcq' ? 'A multiple-choice question needs a question (or a picture) and at least two options.' : 'Type the question, or add a picture, first.'); return; }
      S.session = Object.assign({}, S.session, { questions: S.session.questions.concat([q]) });
      saveSoon();
      pushQuestion(q);
      if (fromComposer) S.compose = blankCompose(c.kind);
      S.focusQ = q.id;
      S.tab = 'answers';
      paintSide();
      layout();
    }

    /* ---------- 📝 Answers: everything every student sent ---------- */
    function questionById(id) {
      for (var i = 0; i < S.session.questions.length; i++) if (S.session.questions[i].id === id) return S.session.questions[i];
      return null;
    }
    function replaceQuestion(q) {
      S.session = Object.assign({}, S.session, { questions: S.session.questions.map(function (x) { return x.id === q.id ? q : x; }) });
      saveSoon();
    }
    function targetsOf(q) { return q.to === 'all' ? null : q.to; }
    function closeQuestion(q) {
      var c = Object.assign({}, q, { open: false });
      replaceQuestion(c);
      send({ t: 'qend', id: q.id }, targetsOf(q));
      paintSide(); layout();
    }
    function reopenQuestion(q) {
      var c = Object.assign({}, q, { open: true, revealed: false });
      replaceQuestion(c);
      pushQuestion(c);
      paintSide();
    }
    function revealQuestion(q) {
      var c = Object.assign({}, q, { open: false, revealed: true });
      replaceQuestion(c);
      send({ t: 'reveal', id: q.id, answer: revealOf(q) }, targetsOf(q));
      paintSide(); layout();
    }
    function entryOf(qid, identity) { return (S.session.answers[qid] || {})[identity] || null; }
    function setEntry(qid, identity, entry) {
      var byQ = Object.assign({}, S.session.answers[qid] || {});
      byQ[identity] = entry;
      var answers = Object.assign({}, S.session.answers); answers[qid] = byQ;
      S.session = Object.assign({}, S.session, { answers: answers });
      saveSoon();
    }
    function setMark(q, identity, ok) {
      var e = entryOf(q.id, identity);
      if (!e) return;
      var next = Object.assign({}, e, { ok: e.ok === ok ? null : ok });
      setEntry(q.id, identity, next);
      send({ t: 'mark', qid: q.id, ok: next.ok, pts: next.pts || 0 }, [identity]);
      paintSide();
    }
    function givePoints(q, identity, n) {
      var e = entryOf(q.id, identity);
      var person = S.session.people[identity];
      if (!e || !person || !(n > 0)) return;
      var next = Object.assign({}, e, { pts: (e.pts || 0) + n });
      setEntry(q.id, identity, next);
      send({ t: 'mark', qid: q.id, ok: next.ok, pts: next.pts }, [identity]);
      paintSide();
      if (typeof env.award === 'function') {
        Promise.resolve(env.award(person, n, 'Live class Q' + q.n)).then(function (res) {
          if (res && res.saved) say('⭐ +' + n + ' for ' + person.name + ' (saved to the reward register).');
          else if (res && res.reason) say('⭐ +' + n + ' noted for ' + person.name + ' in this lesson. ' + res.reason);
        }, function (err) { say('⭐ +' + n + ' noted in this lesson, but the reward register said: ' + ((err && err.message) || err)); });
      }
    }
    function photoFor(ref, img) {
      if (S.images[ref]) { img.src = S.images[ref]; return; }
      img.alt = 'Loading the photo…';
      if (typeof env.loadPhoto !== 'function' || !S.session) return;
      Promise.resolve(env.loadPhoto(S.session.epoch, ref)).then(function (d) {
        if (d && validImage(d)) { S.images[ref] = d; img.src = d; }
      }, function () {});
    }
    function paintAnswers(box) {
      var s = S.session;
      if (!s.questions.length) {
        var empty = el('div', 'vcCenter vcEmptySide');
        empty.appendChild(el('p', 'vcMuted', 'No questions yet. Push one from ❓ Ask and every answer lands here.'));
        if (S.mode === 'live') empty.appendChild(btn('vcPrimary', '❓ Ask a question', null, function () { S.tab = 'ask'; paintSide(); }));
        box.appendChild(empty);
        return;
      }
      var q = (S.focusQ && questionById(S.focusQ)) || currentQuestion();
      // The question strip.
      var strip = el('div', 'vcQStrip');
      s.questions.forEach(function (x) {
        var st = questionStats(s, x, []);
        var b = btn('vcQChip' + (x.id === q.id ? ' on' : '') + (x.open ? ' open' : ''), 'Q' + x.n, (x.text || 'Picture question') + ' — ' + st.answered + ' answer' + (st.answered === 1 ? '' : 's'), function () { S.focusQ = x.id; paintSide(); });
        if (st.unmarked) b.appendChild(el('span', 'vcDot'));
        strip.appendChild(b);
      });
      box.appendChild(strip);

      var present = presentStudents();
      var st = questionStats(s, q, present);
      var head = el('div', 'vcAnsHead');
      var t = el('div', 'vcAnsTitle');
      t.appendChild(el('span', 'vcKind', KIND_LABEL[q.kind]));
      t.appendChild(el('span', 'vcState ' + (q.open ? 'open' : 'closed'), q.open ? 'Open' : q.revealed ? 'Answer shown' : 'Closed'));
      head.appendChild(t);
      if (q.text) head.appendChild(el('p', 'vcAnsQ', 'Q' + q.n + '. ' + q.text));
      if (q.img) {
        var qi = el('img', 'vcThumb'); qi.alt = 'The question’s picture';
        photoFor(q.img.ref, qi);
        qi.addEventListener('click', function () { if (S.images[q.img.ref]) openBigPhoto(S.images[q.img.ref]); });
        head.appendChild(qi);
      }
      var right = revealOf(q);
      if (right && right.text) head.appendChild(el('p', 'vcHint', 'Answer: ' + right.text));
      var stats = el('p', 'vcStats');
      stats.textContent = st.answered + ' answered' + (st.asked ? ' of ' + st.asked + ' here' : '') +
        (st.right ? ' · ✓ ' + st.right : '') + (st.wrong ? ' · ✗ ' + st.wrong : '') + (st.unmarked ? ' · ' + st.unmarked + ' to mark' : '');
      head.appendChild(stats);
      if (S.mode === 'live') {
        var acts = el('div', 'vcRow');
        if (q.open) {
          acts.appendChild(btn('', '⏹ Close', 'Stop taking answers', function () { closeQuestion(q); }));
          acts.appendChild(btn('', '↻ Send again', 'Send it again to anyone who missed it', function () { pushQuestion(q); }));
        } else {
          acts.appendChild(btn('', '▶ Reopen', 'Take answers again', function () { reopenQuestion(q); }));
        }
        if (!q.revealed) acts.appendChild(btn('vcPrimary', '💡 Show the answer', 'Close the question and show everyone the answer', function () { revealQuestion(q); }));
        head.appendChild(acts);
      }
      box.appendChild(head);

      // Multiple choice: how the class split.
      var byQ = s.answers[q.id] || {};
      var ids = Object.keys(byQ);
      if (q.kind === 'mcq') {
        var counts = q.options.map(function () { return 0; });
        ids.forEach(function (id) { var v = byQ[id].v; if (typeof v === 'number' && counts[v] != null) counts[v]++; });
        var bars = el('div', 'vcBars');
        q.options.forEach(function (o, i) {
          var row = el('div', 'vcBarRow' + (q.answer === i ? ' right' : ''));
          row.appendChild(el('b', null, letter(i)));
          var track = el('div', 'vcBarTrack');
          var fill = el('div', 'vcBarFill');
          fill.style.width = (ids.length ? Math.round(100 * counts[i] / ids.length) : 0) + '%';
          track.appendChild(fill);
          row.appendChild(track);
          row.appendChild(el('span', 'vcBarN', String(counts[i])));
          row.title = o;
          bars.appendChild(row);
        });
        box.appendChild(bars);
      }

      // Every answer.
      var list = el('div', 'vcAnsList');
      ids.sort(function (a, b) { return (byQ[a].at || 0) - (byQ[b].at || 0); }).forEach(function (id) {
        var e = byQ[id], p = s.people[id] || { name: 'Student' };
        var mk = markOf(e);
        var row = el('div', 'vcAns' + (mk === true ? ' ok' : mk === false ? ' no' : ''));
        var top = el('div', 'vcAnsTop');
        top.appendChild(el('b', 'vcAnsName', p.name));
        if (p.kind === 'trial') top.appendChild(el('span', 'vcTag', 'Trial'));
        if (p.kind === 'makeup') top.appendChild(el('span', 'vcTag', 'Make-up'));
        if (e.edits) top.appendChild(el('span', 'vcMuted', 'changed ' + e.edits + '×'));
        top.appendChild(el('span', 'vcMuted', new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })));
        row.appendChild(top);
        var said = answerText(q, e.v);
        if (said) row.appendChild(el('p', 'vcAnsText', said));
        if (e.ph) {
          var img = el('img', 'vcThumb vcAnsPhoto');
          photoFor(e.ph, img);
          img.addEventListener('click', function () { if (S.images[e.ph]) openBigPhoto(S.images[e.ph]); });
          row.appendChild(img);
        }
        var tools = el('div', 'vcAnsTools');
        tools.appendChild(btn('vcMark' + (mk === true ? ' on' : ''), '✓', 'Right', function () { setMark(q, id, true); }));
        tools.appendChild(btn('vcMark no' + (mk === false ? ' on' : ''), '✗', 'Not right', function () { setMark(q, id, false); }));
        if (e.ok == null && (e.auto === true || e.auto === false)) tools.appendChild(el('span', 'vcMuted', 'marked by the key'));
        tools.appendChild(el('span', 'vcBarGap'));
        [1, 2, 5].forEach(function (n) {
          tools.appendChild(btn('vcPts', '+' + n, 'Give ' + p.name + ' ' + n + ' point' + (n === 1 ? '' : 's'), function () { givePoints(q, id, n); }));
        });
        if (e.pts) tools.appendChild(el('span', 'vcStar', '⭐ ' + e.pts));
        row.appendChild(tools);
        list.appendChild(row);
      });
      box.appendChild(list);
      if (st.waiting.length) {
        var wait = el('div', 'vcWaiting');
        wait.appendChild(el('span', 'vcMuted', 'Still waiting for: '));
        wait.appendChild(el('span', null, st.waiting.map(function (id) { return s.people[id].name; }).join(', ')));
        box.appendChild(wait);
      }
    }

    /* ---------- 👥 People: hands, presence, mute, remove ---------- */
    function paintPeople(box) {
      var s = S.session;
      var people = roster(s);
      var handIds = Object.keys(S.hands).sort(function (a, b) { return S.hands[a] - S.hands[b]; });
      if (handIds.length) {
        var hb = el('div', 'vcHandsBox');
        hb.appendChild(el('h4', null, '✋ Hands up'));
        handIds.forEach(function (id) {
          var row = el('div', 'vcHandRow');
          row.appendChild(el('b', null, (s.people[id] || {}).name || 'Student'));
          row.appendChild(el('span', 'vcMuted', Math.max(0, Math.round((now() - S.hands[id]) / 1000)) + ' s'));
          row.appendChild(el('span', 'vcBarGap'));
          row.appendChild(btn('', '🎤 Let them speak', 'Ask them to unmute', function () {
            send({ t: 'hand', up: false, speak: true }, [id]);
            lowerHand(id);
            say('Asked ' + ((s.people[id] || {}).name || 'them') + ' to unmute and speak.');
          }));
          row.appendChild(btn('', 'Hand down', null, function () { lowerHand(id); }));
          hb.appendChild(row);
        });
        box.appendChild(hb);
      }
      if (!people.length) {
        box.appendChild(el('p', 'vcMuted vcEmptySide', 'Nobody has joined yet. Share the class link, or ask the students to press 🎥 Live class in Ans Key.'));
        return;
      }
      var here = people.filter(function (p) { return p.here; }).length;
      box.appendChild(el('p', 'vcMuted', here + ' here now · ' + people.length + ' joined this lesson'));
      var list = el('div', 'vcPeople');
      people.forEach(function (p) {
        var r = participation(s, p.identity, now());
        var row = el('div', 'vcPerson' + (p.here ? '' : ' away') + (S.focusPerson === p.identity ? ' focus' : ''));
        var top = el('div', 'vcAnsTop');
        top.appendChild(el('span', 'vcPresence ' + (p.here ? 'here' : 'gone'), p.here ? '●' : '○'));
        top.appendChild(el('b', null, p.name));
        if (p.kind === 'trial') top.appendChild(el('span', 'vcTag', 'Trial'));
        if (p.kind === 'makeup') top.appendChild(el('span', 'vcTag', 'Make-up' + (p.home ? ' · ' + p.home : '')));
        if (S.removed[p.identity]) top.appendChild(el('span', 'vcTag warn', 'Removed'));
        row.appendChild(top);
        var q = S.quality[p.identity];
        row.appendChild(el('p', 'vcMuted', r.minutes + ' min · ' + r.answered + '/' + r.asked + ' answered' + (r.marked ? ' · ✓ ' + r.right + '/' + r.marked : '') + (p.hands ? ' · ✋ ' + p.hands : '') + (q && p.here ? ' · ' + q : '')));
        if (S.mode === 'live') {
          var acts = el('div', 'vcRow vcSmall');
          if (p.here) {
            acts.appendChild(btn('', '🔇 Mute', 'Mute their microphone', function () {
              call('mute', { identity: p.identity, source: 'microphone' }).then(function () { say(p.name + ' is muted.'); }, function (e) { say((e && e.message) || 'Could not mute.'); });
            }));
            acts.appendChild(btn('', '🚫 Camera off', 'Turn their camera off', function () {
              call('mute', { identity: p.identity, source: 'camera' }).then(function () { say(p.name + '’s camera is off.'); }, function (e) { say((e && e.message) || 'Could not turn it off.'); });
            }));
            acts.appendChild(btn('', '❓ Ask just them', 'Write a question for this student only', function () {
              var c = S.compose || (S.compose = blankCompose(S.prefs.lastKind));
              c.to = 'some'; c.pick = {}; c.pick[p.identity] = true;
              S.tab = 'ask'; paintSide();
            }));
          }
          if (!S.removed[p.identity]) {
            if (p.here) acts.appendChild(btn('vcDanger', 'Remove', 'Take them out of the class', function () {
              if (!root.confirm('Take ' + p.name + ' out of the class? They cannot join again unless you let them back in.')) return;
              call('remove', { identity: p.identity }).then(function () { S.removed[p.identity] = true; say(p.name + ' was taken out of the class.'); paintSide(); }, function (e) { say((e && e.message) || 'Could not remove them.'); });
            }));
          } else {
            acts.appendChild(btn('', 'Let back in', 'Allow them to join again', function () {
              call('readmit', { identity: p.identity }).then(function () { delete S.removed[p.identity]; say(p.name + ' may join again.'); paintSide(); }, function (e) { say((e && e.message) || 'Could not let them in.'); });
            }));
          }
          row.appendChild(acts);
        }
        list.appendChild(row);
      });
      box.appendChild(list);
    }

    /* ---------- 🧾 Reports: one summary per student, for the parent ---------- */
    function centreName() { return typeof env.centre === 'function' ? env.centre() : 'Polymath Learning Centre'; }
    function reportFor(identity) {
      var r = S.reports[identity];
      if (r && r.edited) return r.text;
      return reportText(S.session, identity, S.session.endedAt || now(), centreName());
    }
    function subjectFor(p) {
      return 'Live class report — ' + p.name + ' — ' + fmtDate(S.session.startedAt || now());
    }
    function sentOf(identity) { return ((S.session.sent || {})[identity]) || null; }
    function recordSent(identity, to) {
      var sent = Object.assign({}, S.session.sent || {});
      sent[identity] = { at: now(), to: to.slice(0, 4) };
      S.session = Object.assign({}, S.session, { sent: sent });
      saveSoon();
      if (S.mode === 'ended') saveNow();
    }
    function emailsFor(p) {
      if (typeof env.parentEmails !== 'function') return Promise.resolve([]);
      return Promise.resolve(env.parentEmails(p)).then(function (list) {
        return (Array.isArray(list) ? list : []).map(function (x) { return oneLine(x, 200); }).filter(function (x) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x); }).slice(0, 4);
      }, function () { return []; });
    }
    function paintReports(box) {
      var s = S.session;
      var people = roster(s);
      if (!people.length) {
        box.appendChild(el('p', 'vcMuted vcEmptySide', 'Each student who joins gets a summary here: time in class, every answer, marks and hands raised — ready to send to their parent.'));
        return;
      }
      var intro = el('div', 'vcRepIntro');
      intro.appendChild(el('p', 'vcMuted', 'A summary for each student’s parent: how long they were in class, every answer, and how many were right. Nothing is sent until you press Send.'));
      var allRow = el('div', 'vcRow vcSmall');
      allRow.appendChild(btn('', '⧉ Copy all', 'Copy every report', function () {
        copyText(people.map(function (p) { return reportFor(p.identity); }).join('\n\n— — —\n\n')).then(function () { say('Every report copied.'); });
      }));
      if (typeof env.sendEmail === 'function') allRow.appendChild(btn('vcPrimary', '✉ Send to every parent', null, function () { sendAll(people); }));
      intro.appendChild(allRow);
      box.appendChild(intro);

      var list = el('div', 'vcRepList');
      people.forEach(function (p) {
        var r = participation(s, p.identity, s.endedAt || now());
        var open = S.reportOpen === p.identity;
        var sent = sentOf(p.identity);
        var row = el('div', 'vcRep' + (open ? ' open' : ''));
        var head = btn('vcRepHead', '', null, function () { S.reportOpen = open ? '' : p.identity; paintSide(); });
        head.appendChild(el('b', null, p.name));
        if (p.kind !== 'roster') head.appendChild(el('span', 'vcTag', p.kind === 'trial' ? 'Trial' : 'Make-up'));
        head.appendChild(el('span', 'vcRepLine', participationLine(r)));
        if (sent) head.appendChild(el('span', 'vcTag ok', '✓ sent ' + new Date(sent.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })));
        row.appendChild(head);
        if (open) row.appendChild(reportEditor(p));
        list.appendChild(row);
      });
      box.appendChild(list);
    }
    function reportEditor(p) {
      var wrap = el('div', 'vcRepBody');
      var id = p.identity;
      var noteLab = el('label', 'vcField');
      noteLab.appendChild(el('span', null, 'Your note to the parent (optional)'));
      var note = el('input'); note.type = 'text'; note.value = (S.session.notes || {})[id] || '';
      note.placeholder = 'e.g. Asked a great question about magnets today.';
      noteLab.appendChild(note);
      wrap.appendChild(noteLab);
      var taLab = el('label', 'vcField');
      taLab.appendChild(el('span', null, 'The report'));
      var ta = el('textarea', 'vcRepText'); ta.rows = 12; ta.value = reportFor(id);
      taLab.appendChild(ta);
      wrap.appendChild(taLab);
      note.addEventListener('input', function () {
        var notes = Object.assign({}, S.session.notes || {}); notes[id] = oneLine(note.value, 400);
        S.session = Object.assign({}, S.session, { notes: notes });
        saveSoon();
        if (!(S.reports[id] && S.reports[id].edited)) ta.value = reportFor(id);
      });
      ta.addEventListener('input', function () { S.reports[id] = { edited: true, text: ta.value }; });
      var toLab = el('label', 'vcField');
      toLab.appendChild(el('span', null, 'Parent’s email'));
      var to = el('input'); to.type = 'text'; to.placeholder = 'Loading the family’s email…';
      toLab.appendChild(to);
      wrap.appendChild(toLab);
      emailsFor(p).then(function (list) {
        if (!to.value) to.value = list.join(', ');
        to.placeholder = list.length ? '' : (p.kind === 'trial' ? 'A trial student has no family on file — type the parent’s email' : 'No email on file — type the parent’s email');
      });
      var row = el('div', 'vcRow');
      row.appendChild(btn('', '⧉ Copy', null, function () { copyText(ta.value).then(function () { say('Report copied.'); }); }));
      if (S.reports[id] && S.reports[id].edited) row.appendChild(btn('', '↺ Rebuild', 'Throw away your edits and build the report again', function () { delete S.reports[id]; ta.value = reportFor(id); paintSide(); }));
      if (typeof env.sendEmail === 'function') {
        row.appendChild(btn('vcPrimary', '✉ Send', 'Email this report to the parent', function () {
          var addrs = to.value.split(/[,;\s]+/).map(function (x) { return x.trim(); }).filter(function (x) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x); }).slice(0, 4);
          if (!addrs.length) { say('Type the parent’s email first.'); to.focus(); return; }
          if (!root.confirm('Send ' + p.name + '’s report to ' + addrs.join(', ') + '?')) return;
          sendOne(p, addrs, ta.value);
        }));
      }
      wrap.appendChild(row);
      return wrap;
    }
    function sendOne(p, addrs, text) {
      var job = Promise.resolve(env.sendEmail({ to: addrs, subject: subjectFor(p), text: text, html: reportHtml(text) }));
      return job.then(function () {
        recordSent(p.identity, addrs);
        say('✓ Sent ' + p.name + '’s report.');
        paintSide();
        return true;
      }, function (e) {
        say('The report could not be sent: ' + ((e && e.message) || e));
        return false;
      });
    }
    function sendAll(people) {
      Promise.all(people.map(function (p) { return emailsFor(p).then(function (list) { return { p: p, to: list }; }); })).then(function (rows) {
        var ready = rows.filter(function (r) { return r.to.length && !sentOf(r.p.identity); });
        var missing = rows.filter(function (r) { return !r.to.length; }).map(function (r) { return r.p.name; });
        if (!ready.length) { say(missing.length ? 'No emails on file for ' + missing.join(', ') + '.' : 'Every report has been sent already.'); return; }
        var msg = 'Send ' + ready.length + ' report' + (ready.length === 1 ? '' : 's') + ' to the parents of ' + ready.map(function (r) { return r.p.name; }).join(', ') + '?' +
          (missing.length ? '\n\nNo email on file (not sent): ' + missing.join(', ') : '');
        if (!root.confirm(msg)) return;
        var chain = Promise.resolve(0);
        ready.forEach(function (r) {
          chain = chain.then(function (n) { return sendOne(r.p, r.to, reportFor(r.p.identity)).then(function (ok) { return n + (ok ? 1 : 0); }); });
        });
        chain.then(function (n) { say('✓ Sent ' + n + ' of ' + ready.length + ' reports.'); });
      });
    }

    /* ================================================================
       THE END OF A CLASS, LEAVING, AND CLOSING
       ================================================================ */
    function paintEnded() {
      S.mode = 'ended';
      setTitle('Class ended' + (S.slotLabel ? ' · ' + S.slotLabel : ''));
      placeWindow();
      clear(S.body);
      var wrap = el('div', 'vcEndedWrap');
      var top = el('div', 'vcCard vcEndedTop');
      top.appendChild(el('h3', null, '🎉 The class has ended'));
      var people = roster(S.session);
      top.appendChild(el('p', 'vcMuted', people.length + ' student' + (people.length === 1 ? '' : 's') + ' · ' + S.session.questions.length + ' question' + (S.session.questions.length === 1 ? '' : 's') + ' · the record is saved.'));
      var row = el('div', 'vcRow');
      row.appendChild(btn('', '▶ Start another class', null, function () { S.session = null; S.reports = {}; openTeacher(); }));
      row.appendChild(btn('', 'Close', null, function () { close(); }));
      top.appendChild(row);
      wrap.appendChild(top);
      S.side = el('div', 'vcSide vcSideWide');
      wrap.appendChild(S.side);
      S.body.appendChild(wrap);
      if (S.tab !== 'answers') S.tab = 'reports';
      paintSide();
    }

    function leaveAsk() {
      if (S.mode !== 'live' && S.mode !== 'joining') { close(); return; }
      if (S.role === 'teacher') {
        if (!root.confirm('Leave the class window? The class keeps running for the students — press 🎥 Live class to come back, or End class to finish it.')) return;
      } else if (!root.confirm('Leave the class?')) return;
      close();
    }
    function close() {
      S.seq++;
      if (S.room) {
        S.leaving = true;
        if (S.role === 'teacher') saveNow();
        disconnect();
      }
      stopTimers();
      closeBigPhoto();
      hideWindow();
      if (S.role === 'student') { S.questions = {}; S.order = []; S.mine = {}; S.popup = null; S.pick = null; }
      S.hands = {};
      S.mode = 'closed';
    }
    function forget() {
      close();
      if (S.mirrorOff) { try { S.mirrorOff(); } catch (e) {} S.mirrorOff = null; }
      S.session = null; S.reports = {}; S.compose = null; S.images = {}; S.removed = {}; S.outbox = {};
      S.status = null; S.lists = null; S.box = null;
    }
    // A change of person on this device ends everything that was theirs:
    // the call, the camera, the class record held in memory.
    function roleChanged() {
      var r = role();
      if (S.mode !== 'closed' && r !== S.role) forget();
      if (r === 'none') { if (S.mirrorOff) { try { S.mirrorOff(); } catch (e) {} S.mirrorOff = null; } return; }
      if (!S.mirrorOff) { S.role = r; watchMirror(); }
    }

    return {
      open: open,
      close: close,
      roleChanged: roleChanged,
      isOpen: function () { return S.mode !== 'closed'; },
      isLive: function () { return S.mode === 'live'; },
      state: function () { return { mode: S.mode, role: S.role, identity: S.identity, slot: S.slot, epoch: S.epoch, session: S.session ? JSON.parse(JSON.stringify(S.session)) : null }; }
    };
  }

  root.LiveClass = { pure: pure, create: typeof create === 'function' ? create : null, VERSION: VERSION };
})(typeof window !== 'undefined' ? window : globalThis);
