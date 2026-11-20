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

  var VERSION = '1.218.0';
  var TOPIC = 'plc';
  var KINDS = ['mcq', 'blank', 'open', 'cloze'];
  var KIND_LABEL = { mcq: 'Multiple choice', blank: 'Fill in the blank', open: 'Open-ended', cloze: 'Fill in the keywords' };
  var LIMITS = {
    leaveLog: 80,
    text: 600,
    option: 140,
    options: 6,
    accepted: 8,
    answer: 1200,
    gaps: 8,               // 🔤 keyword blanks in one fill-in-the-keywords question
    gapChars: 120,
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
  // 🔗 This device's own class link (v1.210.0): the code from a personal link
  // or a PIN, kept so next time "You are Amy Tan — Join" is one tap.
  var PASS_KEY = 'polymath.liveClass.pass.v1';
  // 📈 Performance tracking (v1.216.0): how long this device's class screen
  // was hidden (another app, another tab, the phone locked) in this lesson,
  // kept per lesson so a reload does not forget it.
  var FOCUS_PREFIX = 'polymath.liveClass.focus.v1:';

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
    } else if (kind === 'cloze') {
      // 🔤 The AI's answer with the teacher's chosen keywords taken out.
      var cz = cleanCloze(q.parts, q.keys);
      if (!cz) return null;
      out.parts = cz.parts;
      if (cz.keys) out.keys = cz.keys;
      var full = clean(q.model, LIMITS.answer);
      if (full) out.model = full;
    } else {
      out.photo = q.photo !== false;
      var model = clean(q.model, LIMITS.answer);
      if (model) out.model = model;
    }
    if (!text && !q.img && kind !== 'cloze') return null;
    if (q.img && typeof q.img === 'object' && validId(q.img.ref)) out.img = { ref: q.img.ref, n: Math.max(1, Math.min(200, Number(q.img.n) || 1)) };
    var to = q.to;
    if (Array.isArray(to)) {
      out.to = to.filter(validIdentity).filter(function (id) { return roleOfIdentity(id) === 'student'; }).slice(0, 200);
      if (!out.to.length) out.to = 'all';
    } else {
      out.to = 'all';
    }
    out.open = q.open !== false;
    if (q.ai === true) out.ai = true;
    if (q.hidden === true) out.hidden = true;   // 🔒 from the hidden answers: the board covers its answer too
    return out;
  }
  // The part of a question a STUDENT's device is sent: never the answer.
  function questionForStudent(q) {
    var c = cleanQuestion(q);
    if (!c) return null;
    var out = { id: c.id, kind: c.kind, text: c.text, at: c.at, n: c.n, open: c.open };
    if (c.options) out.options = c.options.slice();
    if (c.kind === 'open') out.photo = c.photo;
    // A keyword question goes out as the sentence WITH ITS GAPS: the words
    // that fill them (keys) and the full answer (model) never leave the
    // teacher's device until the teacher shows the answer.
    if (c.kind === 'cloze') out.parts = c.parts.slice();
    if (c.img) out.img = { ref: c.img.ref, n: c.img.n };
    return out;
  }

  /* ---------- 🔤 Fill in the keywords (v1.215.0) ----------
     The teacher takes the AI's (hidden) answer, taps the few words that
     matter and those become blanks. `parts` is the sentence as text pieces
     and blank numbers in order — ["Plants make food by ", 0, " using ", 1,
     "."] — and `keys[i]` the words that were taken out of blank i. */
  function cleanCloze(parts, keys) {
    if (!Array.isArray(parts)) return null;
    var out = [], outKeys = [], chars = 0, haveKeys = Array.isArray(keys);
    var seen = {};
    for (var i = 0; i < parts.length && i < 80; i++) {
      var p = parts[i];
      if (typeof p === 'number') {
        var k = Math.floor(p);
        if (!(k >= 0 && k < 40) || seen[k] || outKeys.length >= LIMITS.gaps) continue;
        seen[k] = true;
        var words = haveKeys ? (Array.isArray(keys[k]) ? keys[k] : keys[k] != null ? [keys[k]] : []) : [];
        words = words.map(function (w) { return oneLine(w, LIMITS.gapChars); }).filter(Boolean).slice(0, LIMITS.accepted);
        out.push(outKeys.length);
        outKeys.push(words);
      } else {
        var t = str(p).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ');
        if (!t) continue;
        t = t.slice(0, Math.max(0, LIMITS.answer - chars));
        if (!t) continue;
        chars += t.length;
        if (out.length && typeof out[out.length - 1] === 'string') out[out.length - 1] += t; else out.push(t);
      }
    }
    if (!outKeys.length) return null;
    var res = { parts: out };
    if (haveKeys) res.keys = outKeys;
    return res;
  }
  function gapCount(q) { return q && Array.isArray(q.parts) ? q.parts.filter(function (p) { return typeof p === 'number'; }).length : 0; }
  // The sentence as a student wrote it in: their words in [brackets].
  function clozeText(parts, words) {
    return (parts || []).map(function (p) {
      if (typeof p !== 'number') return str(p);
      var w = Array.isArray(words) ? oneLine(words[p], LIMITS.gapChars) : '';
      return '[' + (w || '___') + ']';
    }).join('');
  }
  // The full sentence with the taken-out words back in (the teacher's copy).
  function clozeFull(q) {
    if (!q || !q.parts) return '';
    return q.parts.map(function (p) { return typeof p === 'number' ? ((q.keys && q.keys[p] && q.keys[p][0]) || '___') : str(p); }).join('');
  }
  // The words of an answer, one token per word or space, for the teacher to
  // tap: lead/trail punctuation stays in the sentence, the word goes.
  function clozeTokens(text) {
    var out = [];
    str(text).replace(/\r\n?/g, '\n').split(/(\s+)/).forEach(function (t) {
      if (!t) return;
      if (/^\s+$/.test(t)) { out.push({ t: t, space: true }); return; }
      var m = /^([("'\u201c\u2018\[]*)(.*?)([)"'\u201d\u2019\].,!?;:]*)$/.exec(t);
      var core = m ? m[2] : t;
      if (!core) { out.push({ t: t }); return; }
      out.push({ t: t, word: true, lead: m[1], core: core, trail: m[3] });
    });
    return out;
  }
  // The tapped words → parts + keys. Words tapped side by side (only a space
  // between) are ONE blank: "light energy" is one gap, not two.
  function clozeFrom(text, picks) {
    var toks = clozeTokens(text), parts = [], keys = [], buf = '', open = false, gap = '';
    var picked = function (i) { return Array.isArray(picks) ? picks.indexOf(i) !== -1 : !!(picks && picks[i]); };
    toks.forEach(function (tk, i) {
      if (tk.space) { if (open) gap += tk.t; else buf += tk.t; return; }
      if (tk.word && picked(i)) {
        if (open && gap && !tk.lead) { keys[keys.length - 1][0] += ' ' + tk.core; gap = ''; }
        else {
          buf += gap; gap = '';
          buf += tk.lead;
          if (buf) parts.push(buf);
          buf = '';
          parts.push(keys.length);
          keys.push([tk.core]);
        }
        open = !tk.trail;
        buf += tk.trail;
        return;
      }
      if (open) { buf += gap; gap = ''; open = false; }
      buf += tk.t;
    });
    buf += gap;
    if (buf) parts.push(buf);
    return keys.length ? cleanCloze(parts, keys) : null;
  }
  // The AI's keywords, found in the answer's words: which tokens to light.
  function pickKeywords(text, keywords) {
    var toks = clozeTokens(text), picks = {};
    var norm = function (s) { return str(s).toLowerCase().replace(/[^a-z0-9\u00c0-\u024f%°]+/g, ''); };
    var wordIdx = [];
    toks.forEach(function (tk, i) { if (tk.word) wordIdx.push(i); });
    (Array.isArray(keywords) ? keywords : []).slice(0, LIMITS.gaps).forEach(function (kw) {
      var want = str(kw).split(/\s+/).map(norm).filter(Boolean);
      if (!want.length) return;
      for (var a = 0; a + want.length <= wordIdx.length; a++) {
        var ok = true;
        for (var b = 0; b < want.length; b++) if (norm(toks[wordIdx[a + b]].core) !== want[b]) { ok = false; break; }
        if (ok) { for (var c = 0; c < want.length; c++) picks[wordIdx[a + c]] = true; break; }
      }
    });
    return picks;
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
    if (kind === 'cloze') {
      if (!Array.isArray(value)) return null;
      var words = value.slice(0, LIMITS.gaps).map(function (w) { return oneLine(w, LIMITS.gapChars); });
      return words.some(Boolean) ? words : null;
    }
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
    if (q.kind === 'cloze') return clozeAuto(q, value);
    return null;
  }
  // Every gap filled with the word that was taken out (or the same number)
  // is ✓ straight away. Anything else is NOT ✗ here: a different word can
  // still be right ("sunlight" for "light energy"), so it goes to the AI to
  // judge and the teacher has the last word.
  function clozeAuto(q, value) {
    if (!q || !q.keys || !Array.isArray(value)) return null;
    var n = gapCount(q);
    if (!n) return null;
    for (var i = 0; i < n; i++) {
      if (!q.keys[i] || !q.keys[i].length || !blankMatches(q.keys[i], value[i])) return null;
    }
    return true;
  }
  function answerText(q, value) {
    if (!q || value == null) return '';
    if (q.kind === 'mcq') {
      var i = Number(value);
      return q.options && q.options[i] != null ? letter(i) + '. ' + q.options[i] : '';
    }
    if (q.kind === 'cloze') return Array.isArray(value) ? clozeText(q.parts, value) : '';
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
      ms: Number(p.ms) || 0, hands: Number(p.hands) || 0, here: !!p.here, since: Number(p.since) || 0,
      via: p.via === 'zoom' ? 'zoom' : '',
      // 📈 v1.216.0: milliseconds the class screen was hidden on the child's
      // device, and how many times it was left (their device's own count).
      away: Math.max(0, Math.min(FOCUS_MAX_MS, Number(p.away) || 0)), awayN: Math.max(0, Math.min(9999, Math.floor(Number(p.awayN) || 0))),
      // 👀 v1.217.0: every time they left the lesson screen, by the teacher's
      // clock: { at (when they left), ms (how long; 0 = still away), k: 'away' | 'photo' }.
      leaves: cleanLeaves(p.leaves)
    };
  }
  /* ---------- 👀 leaving the lesson screen (v1.217.0) ----------
     Zhi Kai, 18 Nov 2026: "students will use AI to generate answers". The
     child's device now counts EVERY time the lesson stops being the thing in
     front of them: another tab, another app, the window minimised, the phone
     locked, or a click on another window (the browser window losing focus).
     A blip under LEAVE_MIN_MS (a click on the address bar) is not counted.
     Opening the camera for "📷 Add a photo of my working" is recorded as a
     photo, not as leaving. The teacher's device is told the moment a child
     leaves and when they come back, and an answer carries how often the
     child left while that question was open and how soon after coming back
     they sent it. It cannot see a second device, and a 📱 Zoom answer phone
     (which sits behind Zoom by design) reports nothing. */
  var LEAVE_MIN_MS = 2000;
  var LEAVES_KEEP = 60;
  var BACK_RECENT_S = 60;
  function cleanLeave(x) {
    if (!x || typeof x !== 'object') return null;
    var at = Math.floor(Number(x.at) || 0);
    if (!(at > 0)) return null;
    return { at: at, ms: Math.max(0, Math.min(FOCUS_MAX_MS, Math.floor(Number(x.ms) || 0))), k: x.k === 'photo' ? 'photo' : 'away' };
  }
  function cleanLeaves(list) {
    return (Array.isArray(list) ? list : []).map(cleanLeave).filter(Boolean).slice(-LEAVES_KEEP);
  }
  // The teacher's device hears "left" (out: true) and "back" (out: false, ms).
  // A "back" closes the open leave; a "back" whose "left" was lost is added
  // with its start worked out from how long the child was away.
  function personLeave(session, identity, msg, now) {
    var p = session && session.people && session.people[identity];
    if (!p || !msg || (msg.out !== true && msg.out !== false)) return session;
    var q = cleanPerson(p);
    var list = q.leaves.slice();
    var last = list.length ? list[list.length - 1] : null;
    var k = msg.k === 'photo' ? 'photo' : 'away';
    if (msg.out === true) {
      if (last && last.ms === 0) return session;            // already away
      list.push({ at: now, ms: 0, k: k });
    } else {
      var ms = Math.max(LEAVE_MIN_MS, Math.min(FOCUS_MAX_MS, Math.floor(Number(msg.ms) || 0)));
      if (last && last.ms === 0) list[list.length - 1] = { at: last.at, ms: Math.max(ms, Math.min(FOCUS_MAX_MS, now - last.at)), k: last.k };
      else list.push({ at: Math.max(1, now - ms), ms: ms, k: k });
    }
    q.leaves = list.slice(-LEAVES_KEEP);
    var people = Object.assign({}, session.people); people[identity] = q;
    return Object.assign({}, session, { people: people });
  }
  function isAwayNow(p) {
    var l = p && Array.isArray(p.leaves) && p.leaves.length ? p.leaves[p.leaves.length - 1] : null;
    return !!(l && l.ms === 0);
  }
  // What an answer says about leaving: { n: times left while the question was
  // open, ms: for how long in all, back: seconds from the last return to the
  // answer (-1 = had not left) }. From the child's own device.
  function cleanOut(x) {
    if (!x || typeof x !== 'object') return null;
    var n = Math.max(0, Math.min(99, Math.floor(Number(x.n) || 0)));
    if (!n) return null;
    var back = Math.floor(Number(x.back));
    return { n: n, ms: Math.max(0, Math.min(FOCUS_MAX_MS, Math.floor(Number(x.ms) || 0))), back: isFinite(back) && back >= 0 ? Math.min(3600, back) : -1 };
  }
  // The child's side: from their leave log [{from, to, k}] (their own clock),
  // what to say about leaving with an answer to a question that arrived at gotAt.
  function outForAnswer(log, gotAt, sentAt) {
    var n = 0, ms = 0, lastBack = 0;
    (Array.isArray(log) ? log : []).forEach(function (x) {
      if (!x || x.k === 'photo') return;
      var to = x.to || sentAt;
      if (to <= gotAt || x.from >= sentAt) return;
      n++; ms += Math.max(0, Math.min(to, sentAt) - Math.max(x.from, gotAt));
      if (x.to && x.to > lastBack) lastBack = x.to;
    });
    if (!n) return null;
    return { n: n, ms: Math.round(ms), back: lastBack ? Math.max(0, Math.round((sentAt - lastBack) / 1000)) : 0 };
  }
  // A flagged answer: the child left while the question was open.
  function outWords(o) {
    o = cleanOut(o);
    if (!o) return '';
    return 'left the lesson ' + (o.n === 1 ? 'once' : o.n + ' times') + ' during this question (' + secondsWords(Math.round(o.ms / 1000)) + ')' +
      (o.back >= 0 && o.back <= BACK_RECENT_S ? ', answered ' + secondsWords(o.back) + ' after coming back' : '');
  }
  // For the teacher: the leaves, counted and listed (photos apart).
  function leaveSummary(session, identity, now) {
    var p = session && session.people && session.people[identity];
    if (!p) return null;
    var list = cleanLeaves(p.leaves);
    var away = list.filter(function (x) { return x.k !== 'photo'; });
    var flagged = 0;
    Object.keys((session && session.answers) || {}).forEach(function (qid) {
      var e = session.answers[qid][identity];
      if (e && cleanOut(e.out)) flagged++;
    });
    var longest = 0, total = 0;
    away.forEach(function (x) { var ms = x.ms || Math.max(0, now - x.at); total += ms; if (ms > longest) longest = ms; });
    return { count: away.length, photos: list.length - away.length, totalMs: total, longestMs: longest, awayNow: isAwayNow({ leaves: list }), flagged: flagged,
      list: away.map(function (x) { return { at: x.at, clock: sgClock(x.at), ms: x.ms, now: x.ms === 0 }; }) };
  }
  // A participant arriving or leaving: presence is counted in milliseconds so
  // a child who drops out on weak wifi and comes back keeps every minute.
  function personJoined(session, info, now) {
    var id = str(info.identity);
    if (!validIdentity(id) || roleOfIdentity(id) !== 'student') return session;
    var prev = session.people[id] ? cleanPerson(session.people[id]) : cleanPerson({ identity: id, joinedAt: now });
    var p = cleanPerson(Object.assign({}, prev, {
      name: info.name || prev.name, kind: info.kind || prev.kind, rosterId: info.rosterId || prev.rosterId, home: info.home || prev.home,
      via: info.via === undefined ? prev.via : info.via
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
  // 📈 A student's device reports how long the class screen was hidden. The
  // count only ever goes up (a late, older report never lowers it), and is
  // capped so a broken clock cannot claim a child was away for a day.
  var FOCUS_MAX_MS = 6 * 3600 * 1000;
  function personFocus(session, identity, msg, now) {
    var p = session && session.people && session.people[identity];
    if (!p || !msg) return session;
    var away = Math.max(0, Math.min(FOCUS_MAX_MS, Math.floor(Number(msg.away) || 0)));
    var n = Math.max(0, Math.min(9999, Math.floor(Number(msg.n) || 0)));
    var q = cleanPerson(p);
    if (away <= q.away && n <= q.awayN) return session;
    q.away = Math.max(q.away, away); q.awayN = Math.max(q.awayN, n);
    var people = Object.assign({}, session.people); people[identity] = q;
    return Object.assign({}, session, { people: people });
  }
  function presentMs(p, now) {
    if (!p) return 0;
    return (Number(p.ms) || 0) + (p.here && p.since ? Math.max(0, now - p.since) : 0);
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
    // 👀 v1.217.0: the child left the lesson while this question was open.
    var out = cleanOut(msg.out);
    if (out) entry.out = out;
    if (had) { entry.ok = null; entry.pts = had.pts || 0; }
    var nb = Object.assign({}, byQ); nb[identity] = entry;
    var answers = Object.assign({}, session.answers); answers[q.id] = nb;
    return { session: Object.assign({}, session, { answers: answers }), fresh: true, entry: entry };
  }
  /* ---------- ✓ ◐ ✗ — marks are PROVISIONAL until the teacher gives them (v1.209.0) ----------
     An answer can carry three marks, and only ONE of them counts:
       • `auto` — the answer key on this device (MCQ, a fill in the blank with
         accepted answers). Instant, and right whenever the key is right.
       • `ai`   — Chung GPT's pre-mark for a written answer: correct / partial
         / wrong with a one-line reason. Quick, and NOT 100% accurate.
       • `ok`   — the TEACHER's mark: ✓ Confirm (the provisional mark becomes
         theirs), Confirm all, or a one-tap override (✓ ◐ ✗).
     The board shows `markOf` (the teacher's, else the provisional one) so a
     class of thirty can be read at a glance. Reports, a student's own screen
     and a rejoin read `confirmedOf` ALONE: a guess never reaches a parent or
     a child as if it were the teacher's. */
  var VERDICTS = ['correct', 'partial', 'wrong'];
  var VERDICT_MARK = { correct: true, partial: 'partial', wrong: false };
  var VERDICT_WORDS = {
    correct: 'correct', right: 'correct', true: 'correct', yes: 'correct', accept: 'correct', accepted: 'correct',
    partial: 'partial', partly: 'partial', 'partly correct': 'partial', 'partially correct': 'partial', 'half': 'partial', 'partial credit': 'partial',
    wrong: 'wrong', incorrect: 'wrong', false: 'wrong', no: 'wrong', reject: 'wrong', 'not correct': 'wrong'
  };
  function cleanMark(v) { return v === true || v === false || v === 'partial' ? v : null; }
  function markWord(m) { return m === true ? '✓' : m === false ? '✗' : m === 'partial' ? '◐' : ''; }
  function cleanVerdict(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var said = oneLine(raw.verdict != null ? raw.verdict : raw.v != null ? raw.v : raw.mark, 40).toLowerCase().replace(/[.!]+$/, '');
    var v = Object.prototype.hasOwnProperty.call(VERDICT_WORDS, said) ? VERDICT_WORDS[said] : '';
    if (!v) return null;
    return { v: v, why: oneLine(raw.why != null ? raw.why : raw.reason, 160), by: oneLine(raw.by, 30), at: Number(raw.at) || 0 };
  }
  // What came back from the model for a batch, as {studentId: verdict}. Only
  // ids that were ASKED about are kept: a reply cannot mark someone else.
  function cleanVerdicts(raw, ids) {
    var want = {};
    (ids || []).forEach(function (id) { want[str(id)] = true; });
    var list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.results) ? raw.results : raw && Array.isArray(raw.marks) ? raw.marks : [];
    var out = {};
    list.forEach(function (r) {
      if (!r || typeof r !== 'object') return;
      var id = str(r.id != null ? r.id : r.student);
      if (!want[id] || out[id]) return;
      var v = cleanVerdict(r);
      if (v) out[id] = v;
    });
    return out;
  }
  function provisionalOf(entry) {
    if (!entry) return null;
    var ai = entry.ai && cleanVerdict(entry.ai);
    if (ai) return VERDICT_MARK[ai.v];
    return entry.auto === true || entry.auto === false ? entry.auto : null;
  }
  function confirmedOf(entry) { return entry ? cleanMark(entry.ok) : null; }
  function markOf(entry) {
    if (!entry) return null;
    var c = confirmedOf(entry);
    return c != null ? c : provisionalOf(entry);
  }
  // Where the mark on the board came from: the teacher, the key or the AI.
  function markSource(entry) {
    if (!entry) return '';
    if (confirmedOf(entry) != null) return 'teacher';
    if (entry.ai && cleanVerdict(entry.ai)) return 'ai';
    if (entry.auto === true || entry.auto === false) return 'key';
    return '';
  }
  // A written answer the key cannot settle goes to Chung GPT once: never an
  // MCQ (the key marks it instantly), never one the teacher has marked, never
  // one already pre-marked, and a blank only when the key did not accept it
  // ("one hundred" against 100 is the model's to judge, not the key's).
  function needsAiMark(q, entry) {
    if (!q || !entry || q.kind === 'mcq') return false;
    if (confirmedOf(entry) != null || (entry.ai && cleanVerdict(entry.ai))) return false;
    if ((q.kind === 'blank' || q.kind === 'cloze') && entry.auto === true) return false;
    if (Array.isArray(entry.v)) return entry.v.some(function (w) { return str(w).trim() !== ''; });
    return (entry.v != null && str(entry.v).trim() !== '') || !!entry.ph;
  }
  // Everything the teacher's ✓ Confirm all would do for one question.
  function confirmPlan(session, q) {
    var byQ = (session && session.answers && session.answers[q.id]) || {};
    return Object.keys(byQ).map(function (id) {
      var e = byQ[id];
      return confirmedOf(e) == null && provisionalOf(e) != null ? { identity: id, ok: provisionalOf(e) } : null;
    }).filter(Boolean);
  }
  // The live tally, and WHO is in each part of it (tap a chip to see).
  function tallyOf(session, q, present) {
    var byQ = (session && session.answers && session.answers[q.id]) || {};
    var out = { right: [], partial: [], wrong: [], unmarked: [], waiting: [], toConfirm: [] };
    Object.keys(byQ).forEach(function (id) {
      var m = markOf(byQ[id]);
      (m === true ? out.right : m === false ? out.wrong : m === 'partial' ? out.partial : out.unmarked).push(id);
      if (confirmedOf(byQ[id]) == null && provisionalOf(byQ[id]) != null) out.toConfirm.push(id);
    });
    (present || []).forEach(function (id) { if (meantFor(q, id) && !byQ[id]) out.waiting.push(id); });
    return out;
  }
  // MCQ: who chose which option.
  function choosersOf(session, q, option) {
    var byQ = (session && session.answers && session.answers[q.id]) || {};
    return Object.keys(byQ).filter(function (id) { return Number(byQ[id].v) === option && byQ[id].v !== '' && byQ[id].v != null; });
  }

  /* ---------- ✨ AI send: a question Chung GPT read off the worksheet ----------
     The model returns DATA; this is the one door from that data to the
     composer's shape, so a reply of the wrong shape can never push a broken
     question (cleanQuestion still guards the push itself). */
  var AI_KIND = { mcq: 'mcq', 'multiple choice': 'mcq', 'multiple-choice': 'mcq', multiplechoice: 'mcq', choice: 'mcq', options: 'mcq',
    blank: 'blank', 'fill in the blank': 'blank', 'fill-in-the-blank': 'blank', fill: 'blank', 'fill in': 'blank', 'short answer': 'blank', short: 'blank', number: 'blank', numeric: 'blank',
    open: 'open', 'open-ended': 'open', 'open ended': 'open', structured: 'open', explain: 'open', long: 'open', written: 'open' };
  var OPTION_LEAD = /^\s*(?:\(?\s*(?:[1-9]|[A-Fa-f])\s*[).:]|\(\s*(?:[1-9]|[A-Fa-f])\s*\))\s*/;
  function questionFromAi(raw) {
    if (typeof raw === 'string') { try { raw = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (e) { return null; } }
    if (!raw || typeof raw !== 'object') return null;
    if (raw.question && typeof raw.question === 'object') raw = raw.question;
    var said = oneLine(raw.kind != null ? raw.kind : raw.type, 40).toLowerCase();
    var kind = Object.prototype.hasOwnProperty.call(AI_KIND, said) ? AI_KIND[said] : '';
    var text = clean(raw.text != null ? raw.text : raw.question != null ? raw.question : raw.stem, LIMITS.text);
    var options = (Array.isArray(raw.options) ? raw.options : Array.isArray(raw.choices) ? raw.choices : [])
      .map(function (o) { return oneLine(o && typeof o === 'object' ? o.text : o, LIMITS.option).replace(OPTION_LEAD, '').trim(); })
      .filter(Boolean).slice(0, LIMITS.options);
    if (!kind) kind = options.length >= 2 ? 'mcq' : 'open';
    if (kind === 'mcq' && options.length < 2) kind = 'open';
    if (!text && !options.length) return null;
    var out = { kind: kind, text: text, options: kind === 'mcq' ? options : ['', '', '', ''], answer: -1, accepted: '', model: '', photo: true,
      note: oneLine(raw.note != null ? raw.note : raw.why, 160) };
    if (kind === 'mcq') {
      var a = raw.answer != null ? raw.answer : raw.correct;
      var idx = -1;
      // A number is the option's 0-based index (the prompt asks for that);
      // a letter or "(2)" is read the way a worksheet prints it.
      if (typeof a === 'number' && isFinite(a)) idx = Math.floor(a);
      else if (a != null) {
        var t = oneLine(a, LIMITS.option);
        var m = /^\(?\s*([A-Fa-f]|[1-9])\s*\)?\.?$/.exec(t);
        if (m) idx = /[A-Fa-f]/.test(m[1]) ? m[1].toUpperCase().charCodeAt(0) - 65 : Number(m[1]) - 1;
        else { var low = t.replace(OPTION_LEAD, '').toLowerCase(); options.forEach(function (o, i) { if (idx < 0 && o.toLowerCase() === low) idx = i; }); }
      }
      out.answer = idx >= 0 && idx < options.length ? idx : -1;
    } else if (kind === 'blank') {
      var acc = Array.isArray(raw.accepted) ? raw.accepted : raw.accepted != null ? str(raw.accepted).split(/[|\n]/) : raw.answer != null ? [raw.answer] : [];
      out.accepted = acc.map(function (x) { return oneLine(x, LIMITS.option); }).filter(Boolean).slice(0, LIMITS.accepted).join('\n');
    } else {
      out.model = clean(raw.model != null ? raw.model : raw.answer, LIMITS.text);
    }
    return out;
  }
  /* ---------- 🔒 Hidden answers: the whole worksheet worked out in the background (v1.215.0) ----------
     The glue asks the AI for every question on the worksheet before the
     teacher needs it, and keeps the result on the TEACHER's own account
     (users/{teacher}/liveKeys/{worksheet}) — never in the room, never in
     the shared picture. cleanKeyItems is the one door from that data, and
     keyItemCompose turns one row into a question for the composer. */
  var KEY_KINDS = { mcq: 'mcq', blank: 'blank', open: 'open' };
  function cleanKeyItems(raw) {
    var list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.items) ? raw.items : [];
    var out = [];
    list.slice(0, 150).forEach(function (r, i) {
      if (!r || typeof r !== 'object') return;
      var answer = clean(r.answer, LIMITS.answer), model = clean(r.model, LIMITS.answer), option = oneLine(r.option, 8);
      if (!answer && !model && !option) return;
      var opts = (Array.isArray(r.options) ? r.options : []).map(function (o) { return oneLine(o, LIMITS.option).replace(OPTION_LEAD, '').trim(); }).filter(Boolean).slice(0, LIMITS.options);
      var kind = KEY_KINDS[oneLine(r.kind, 10).toLowerCase()] || (option ? 'mcq' : 'open');
      if (kind === 'mcq' && opts.length < 2 && !option) kind = 'open';
      out.push({
        id: validId(r.id) ? r.id : 'k' + i,
        page: Math.max(0, Math.min(999, Math.floor(Number(r.page) || 0))),
        number: oneLine(r.number, 12).replace(/^\s*(question|qn?)[\s.:]*/i, ''),
        kind: kind, question: clean(r.question, LIMITS.text), answer: answer, option: option, model: model, options: opts,
        keywords: (Array.isArray(r.keywords) ? r.keywords : []).map(function (k) { return oneLine(k, LIMITS.gapChars); }).filter(Boolean).slice(0, LIMITS.gaps)
      });
    });
    return out;
  }
  // One hidden-answer row → the composer. form: 'open' (fully blank: the
  // student writes it all; the AI answer stays hidden and only marks),
  // 'cloze' (the AI answer with the keywords lit for the teacher to choose),
  // 'asis' (the question as printed: MCQ with its key, or a short blank).
  function keyItemCompose(item, form) {
    if (!item) return null;
    var full = item.model || item.answer || '';
    var text = item.question || ('Question ' + (item.number || '?') + (item.page ? ' on page ' + item.page : '') + ' of the worksheet');
    var base = { text: text, options: ['', '', '', ''], answer: -1, accepted: '', model: '', photo: true, img: '', keyFrom: item.id };
    if (form === 'cloze') {
      return Object.assign(base, { kind: 'cloze', model: full, gapPick: pickKeywords(full, item.keywords) });
    }
    if (form === 'asis' && item.kind === 'mcq' && item.options.length >= 2) {
      var idx = -1, m = /^\(?\s*([A-Fa-f]|[1-9])\s*\)?\.?$/.exec(item.option || '');
      if (m) idx = /[A-Fa-f]/.test(m[1]) ? m[1].toUpperCase().charCodeAt(0) - 65 : Number(m[1]) - 1;
      return Object.assign(base, { kind: 'mcq', options: item.options.slice(), answer: idx >= 0 && idx < item.options.length ? idx : -1 });
    }
    if (form === 'asis' && item.kind === 'blank') {
      return Object.assign(base, { kind: 'blank', accepted: item.answer });
    }
    return Object.assign(base, { kind: 'open', model: full, hideModel: true });
  }

  function questionStats(session, q, present) {
    var byQ = session.answers[q.id] || {};
    var ids = Object.keys(byQ);
    var right = 0, wrong = 0, partial = 0, unmarked = 0, toConfirm = 0;
    ids.forEach(function (id) {
      var m = markOf(byQ[id]);
      if (m === true) right++; else if (m === false) wrong++; else if (m === 'partial') partial++; else unmarked++;
      if (confirmedOf(byQ[id]) == null && provisionalOf(byQ[id]) != null) toConfirm++;
    });
    var asked = (present || []).filter(function (id) { return meantFor(q, id); });
    var waiting = asked.filter(function (id) { return !byQ[id]; });
    return { answered: ids.length, right: right, wrong: wrong, partial: partial, unmarked: unmarked, toConfirm: toConfirm, asked: asked.length, waiting: waiting };
  }
  // Everyone the lesson saw, present or not, sorted by name.
  function roster(session) {
    return Object.keys(session.people).map(function (k) { return cleanPerson(session.people[k]); })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }); });
  }

  /* ---------- 🙋 attendance (v1.218.0) ----------
     The server (ansKeyLiveClass, action "attendance") knows the class list
     and sends the emails; the teacher's device says who joined and when the
     minute's countdown is up. These are the rules the window paints from. */
  // { rosterId: first join ms } from the lesson's record (roster children only).
  function attJoinedMap(session) {
    var out = {};
    var people = (session && session.people) || {};
    Object.keys(people).forEach(function (k) {
      var m = /^r:([A-Za-z0-9-]{1,60}_[A-Za-z0-9-]{1,60})$/.exec(k);
      var p = people[k];
      if (m && p && Number(p.joinedAt) > 0) out[m[1]] = Number(p.joinedAt);
    });
    return out;
  }
  // The children whose parents would be emailed now: not here, not emailed
  // yet, with an address, not marked absent in the office, not skipped.
  function attPending(data, skip, joinedNow) {
    if (!data || !data.taken || data.mode === 'off') return [];
    var sk = skip || {}, jn = joinedNow || {};
    return (Array.isArray(data.students) ? data.students : []).filter(function (r) {
      return r && !r.here && !jn[r.id] && !r.late && !r.noEmail && r.mark !== 'absent' && !sk[r.id];
    });
  }
  // "Amy, Ben and Chloe".
  function namesWords(list) {
    var n = (list || []).map(function (x) { return typeof x === 'string' ? x : (x && x.name) || ''; }).filter(Boolean);
    if (n.length <= 1) return n.join('');
    return n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
  }
  // One child's line in the teacher's attendance list.
  function attStatus(r, joinedNow) {
    if (!r) return { word: '', cls: '' };
    var j = (joinedNow && joinedNow[r.id]) || r.joinedAt;
    if (r.mark === 'here' && !j) return { word: '✋ Marked here', cls: 'here' };
    if (r.mark === 'absent') return { word: '✗ Marked absent', cls: 'absent' };
    if (j) return { word: '✓ Joined ' + sgClock(j), cls: 'here' };
    if (r.catchup) return { word: '📚 Absent · catch-up emailed ' + sgClock(r.catchup), cls: 'absent' };
    if (r.late) return { word: '✉ Not joined · parent emailed ' + sgClock(r.late), cls: 'late' };
    if (r.noEmail) return { word: '⏳ Not joined · no parent email on file', cls: 'late' };
    return { word: '⏳ Not joined yet', cls: 'wait' };
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
      // ONLY the teacher's own mark reaches a parent — never a provisional one.
      return { q: q, entry: e || null, mark: confirmedOf(e), text: e ? answerText(q, e.v) : '', photo: !!(e && e.ph) };
    });
    var answered = rows.filter(function (r) { return r.entry; }).length;
    var right = rows.filter(function (r) { return r.mark === true; }).length;
    var partly = rows.filter(function (r) { return r.mark === 'partial'; }).length;
    var marked = rows.filter(function (r) { return r.mark != null; }).length;
    var pts = rows.reduce(function (s, r) { return s + (r.entry && r.entry.pts ? r.entry.pts : 0); }, 0);
    return {
      name: p.name, kind: p.kind, rosterId: p.rosterId, minutes: minutesPresent(p, now),
      asked: asked.length, answered: answered, right: right, partly: partly, marked: marked, hands: p.hands || 0, points: pts,
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
    var acc = r.marked ? ', getting ' + r.right + ' of ' + r.marked + ' marked answer' + (r.marked === 1 ? '' : 's') + ' right' +
      (r.partly ? ' and ' + r.partly + ' partly right' : '') : '';
    return r.name + ' ' + part + acc + '.';
  }
  function reportText(session, identity, now, centre, history) {
    var r = participation(session, identity, now);
    if (!r) return '';
    var perf = performance(session, identity, now);
    var lines = [];
    lines.push('Dear Parent,');
    lines.push('');
    lines.push('Here is how ' + r.name + ' took part in today\'s live class (' + fmtDate(session.startedAt || now) + (session.slotLabel || session.slot ? ', ' + (session.slotLabel || session.slot) : '') + ').');
    lines.push('');
    lines.push('• Time in class: ' + r.minutes + ' minute' + (r.minutes === 1 ? '' : 's'));
    lines.push('• Questions answered: ' + r.answered + ' of ' + r.asked);
    if (r.marked) lines.push('• Correct: ' + r.right + ' of ' + r.marked + ' marked' + (r.partly ? ' (' + r.partly + ' partly right)' : ''));
    if (r.hands) lines.push('• Raised a hand to ask or answer: ' + r.hands + ' time' + (r.hands === 1 ? '' : 's'));
    if (r.points) lines.push('• Points earned in class: ' + r.points);
    // 📈 Performance tracking (v1.216.0): only what the class measured.
    if (perf) {
      if (perf.joinedClock) lines.push('• Joined the class at ' + perf.joinedClock);
      if (perf.avgSecs != null) lines.push('• Average time to answer: ' + secondsWords(perf.avgSecs));
      if (perf.focusPct != null) lines.push('• Focus: on the class screen ' + perf.focusPct + '% of the time' + (perf.awayTimes ? ' (left it ' + perf.awayTimes + ' time' + (perf.awayTimes === 1 ? '' : 's') + ')' : ''));
      var hl = historyLines(history);
      if (hl.length) { lines.push(''); lines.push('Recent live lessons:'); hl.forEach(function (x) { lines.push('  ' + x); }); }
    }
    if (r.rows.length) {
      lines.push('');
      lines.push('Questions in class:');
      r.rows.forEach(function (row, i) {
        var label = 'Q' + (row.q.n || i + 1) + (row.q.text ? ': ' + oneLine(row.q.text, 140) : ' (picture question)');
        var said = row.entry ? (row.text ? '“' + oneLine(row.text, 200) + '”' : '') + (row.photo ? (row.text ? ' + ' : '') + 'a photo of the working' : '') : 'no answer';
        var mk = row.mark === true ? ' ✓' : row.mark === false ? ' ✗' : row.mark === 'partial' ? ' ◐ (partly right)' : '';
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


  /* ---------- 📈 performance tracking (v1.216.0) ----------
     Everything here is MEASURED by the class itself — nothing is guessed:
       • when the child joined (Singapore time) and how long they stayed;
       • how many questions they answered, and how many the TEACHER marked
         right (a provisional key/AI mark never counts, as in the report);
       • how quickly they answered: the time from the question popping up
         on screen to their answer reaching the teacher's device;
       • focus: how much of their time in class the class screen was in
         front of them (their device reports when it is hidden — another
         app, another tab, the phone locked). A 📱 Zoom child's phone only
         answers, so it is not judged on focus.
     A short summary of each lesson is kept per child (progressMerge), so the
     report can show the last few live lessons side by side. */
  function sgClock(ms) {
    ms = Number(ms) || 0;
    if (!ms) return '';
    var d = new Date(ms + 8 * 3600000);
    var h = d.getUTCHours(), m = d.getUTCMinutes();
    return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + ' ' + (h < 12 ? 'AM' : 'PM');
  }
  function sgDay(ms) {
    ms = Number(ms) || 0;
    if (!ms) return '';
    var d = new Date(ms + 8 * 3600000);
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return days[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + months[d.getUTCMonth()];
  }
  function secondsWords(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    if (sec < 60) return sec + ' second' + (sec === 1 ? '' : 's');
    var m = Math.floor(sec / 60), r = sec % 60;
    return m + ' min' + (r ? ' ' + r + ' s' : '');
  }
  function pct(a, b) { return b > 0 ? Math.round(a / b * 100) : null; }
  function performance(session, identity, now) {
    var r = participation(session, identity, now);
    if (!r) return null;
    var p = cleanPerson(session.people[identity]);
    var here = presentMs(p, now);
    var speeds = [];
    r.rows.forEach(function (row) {
      var qa = Number(row.q && row.q.at) || 0, ea = Number(row.entry && row.entry.at) || 0;
      if (row.entry && qa && ea >= qa && ea - qa <= 30 * 60000) speeds.push((ea - qa) / 1000);
    });
    var avg = speeds.length ? Math.round(speeds.reduce(function (a, b) { return a + b; }, 0) / speeds.length) : null;
    var focus = null;
    if (p.via !== 'zoom' && here >= 60000) focus = Math.max(0, Math.min(100, Math.round(100 * (1 - Math.min(p.away, here) / here))));
    var score = r.marked ? Math.round((r.right + 0.5 * r.partly) / r.marked * 100) : null;
    return Object.assign({}, r, {
      joinedAt: p.joinedAt, joinedClock: sgClock(p.joinedAt), via: p.via,
      answeredPct: pct(r.answered, r.asked), scorePct: score, avgSecs: avg,
      focusPct: focus, awayMin: Math.round(Math.min(p.away, here) / 60000), awayTimes: p.away > 0 ? p.awayN : 0
    });
  }
  // A word a parent can read at a glance for each measure.
  function levelWord(kind, v) {
    if (v == null) return '';
    if (kind === 'score') return v >= 85 ? 'Excellent' : v >= 65 ? 'Good' : v >= 40 ? 'Fair' : 'Needs practice';
    if (kind === 'answered') return v >= 90 ? 'Very active' : v >= 60 ? 'Active' : v > 0 ? 'Quiet' : 'Did not answer';
    if (kind === 'focus') return v >= 90 ? 'Fully focused' : v >= 75 ? 'Mostly focused' : v >= 50 ? 'Sometimes away' : 'Often away';
    if (kind === 'speed') return v <= 45 ? 'Quick' : v <= 120 ? 'Steady' : 'Takes time';
    return '';
  }
  // The one line kept per child per lesson (small: a whole term fits one doc).
  function perfSummary(session, identity, now) {
    var f = performance(session, identity, now);
    if (!f) return null;
    return { e: Number(session.epoch) || 0, d: Number(session.startedAt) || 0, l: oneLine(session.slotLabel || session.slot, 60),
      m: f.minutes, q: f.asked, a: f.answered, r: f.right, h: f.partly, k: f.marked,
      s: f.avgSecs == null ? -1 : f.avgSecs, f: f.focusPct == null ? -1 : f.focusPct };
  }
  function cleanSummary(x) {
    if (!x || typeof x !== 'object') return null;
    var n = function (v, max) { v = Math.floor(Number(v)); return isFinite(v) ? Math.max(-1, Math.min(max, v)) : 0; };
    var e = Math.floor(Number(x.e)) || 0;
    if (!(e > 0)) return null;
    var out = { e: e, d: Math.max(0, Number(x.d) || 0), l: oneLine(x.l, 60), m: n(x.m, 1000), q: n(x.q, 500), a: n(x.a, 500), r: n(x.r, 500), h: n(x.h, 500), k: n(x.k, 500), s: n(x.s, 1800), f: n(x.f, 100) };
    // 🙋 v1.218.0: a lesson the child missed (from the day's attendance, never
    // from the progress book): shown as "absent", never as a zero.
    if (x.x === 1 || x.x === true) { out.x = 1; out.m = 0; out.q = 0; out.a = 0; out.r = 0; out.h = 0; out.k = 0; out.s = -1; out.f = -1; }
    return out;
  }
  var PROGRESS_KEEP = 12;
  // The teacher's progress book: { v, students: { identity: { name, rows: [summary…] } } }.
  // Merging a lesson replaces that lesson's own row (it is re-saved as marks
  // are given) and keeps the newest PROGRESS_KEEP lessons per child.
  function progressMerge(progress, session, now) {
    var out = { v: 1, students: {} };
    var had = progress && progress.students && typeof progress.students === 'object' ? progress.students : {};
    Object.keys(had).forEach(function (id) {
      if (!validIdentity(id)) return;
      var st = had[id] || {};
      var rows = (Array.isArray(st.rows) ? st.rows : []).map(cleanSummary).filter(function (x) { return x && !x.x; });
      out.students[id] = { name: oneLine(st.name, LIMITS.name) || 'Student', rows: rows };
    });
    if (session && session.people && Number(session.epoch) > 0) {
      Object.keys(session.people).forEach(function (id) {
        if (!validIdentity(id) || roleOfIdentity(id) !== 'student') return;
        var sum = cleanSummary(perfSummary(session, id, now));
        if (!sum) return;
        var st = out.students[id] || { name: '', rows: [] };
        st.name = cleanPerson(session.people[id]).name;
        st.rows = st.rows.filter(function (x) { return x.e !== sum.e; }).concat([sum])
          .sort(function (a, b) { return a.e - b.e; }).slice(-PROGRESS_KEEP);
        out.students[id] = st;
      });
    }
    return out;
  }
  // The lessons BEFORE this one, oldest first (at most `max`).
  function historyFor(progress, identity, epoch, max) {
    var st = progress && progress.students && progress.students[identity];
    if (!st || !Array.isArray(st.rows)) return [];
    return st.rows.map(cleanSummary).filter(function (x) { return x && x.e !== Number(epoch); })
      .sort(function (a, b) { return a.e - b.e; }).slice(-(max || 5));
  }
  function historyLine(x) {
    if (x.x) return (sgDay(x.d) || 'Earlier lesson') + (x.l ? ' · ' + x.l : '') + ' · absent (missed this lesson)';
    var parts = [sgDay(x.d) || 'Earlier lesson'];
    if (x.q > 0) parts.push('answered ' + x.a + ' of ' + x.q);
    if (x.k > 0) parts.push(x.r + ' of ' + x.k + ' right' + (x.h ? ', ' + x.h + ' partly' : '') + ' (' + Math.round((x.r + 0.5 * x.h) / x.k * 100) + '%)');
    if (x.f >= 0) parts.push('focus ' + x.f + '%');
    if (!x.q) parts.push(x.m + ' min in class');
    return parts.join(' · ');
  }
  // 🙋 The lessons before this one with the ones the child missed put in
  // (absences: [{ d: lesson start, l: label }]), oldest first, at most `max`.
  function historyWithAbsences(history, absences, beforeMs, max) {
    var rows = (Array.isArray(history) ? history : []).map(cleanSummary).filter(Boolean);
    (Array.isArray(absences) ? absences : []).forEach(function (a) {
      var d = Number(a && a.d) || 0;
      if (!(d > 0) || (beforeMs && d >= beforeMs - 30 * 60000)) return;
      // A lesson they were in after all (a row the same day) wins over a mark.
      if (rows.some(function (x) { return !x.x && sgDay(x.d) === sgDay(d); })) return;
      if (rows.some(function (x) { return x.x && sgDay(x.d) === sgDay(d); })) return;
      rows.push(cleanSummary({ e: d, d: d, l: a.l || '', x: 1 }));
    });
    return rows.sort(function (a, b) { return a.d - b.d; }).slice(-(max || 5));
  }
  function historyLines(history) {
    return (Array.isArray(history) ? history : []).map(cleanSummary).filter(Boolean).map(historyLine);
  }
  // Better, the same or lower than the average of the earlier lessons.
  function trendOf(history, perf) {
    var rows = (Array.isArray(history) ? history : []).map(cleanSummary).filter(function (x) { return x && !x.x && x.k > 0; });
    if (!perf || perf.scorePct == null || rows.length < 2) return '';
    var avg = rows.reduce(function (a, x) { return a + (x.r + 0.5 * x.h) / x.k * 100; }, 0) / rows.length;
    if (perf.scorePct >= avg + 10) return 'up';
    if (perf.scorePct <= avg - 10) return 'down';
    return 'same';
  }

  /* The report as an email a parent can read on a phone: a card of the
     measures, the questions, the teacher's note and the recent lessons.
     Plain inline styles (email apps drop <style>); every field escaped. */
  function reportCardHtml(session, identity, now, centre, history) {
    var f = performance(session, identity, now);
    if (!f) return '';
    var E = escapeHtml;
    var when = fmtDate(session.startedAt || now) + (session.slotLabel || session.slot ? ' · ' + (session.slotLabel || session.slot) : '');
    var tile = function (label, value, word, colour) {
      return '<td style="width:33%;padding:6px;vertical-align:top"><div style="background:#F7F7F5;border-radius:12px;padding:12px 10px;text-align:center">' +
        '<div style="font-size:12px;color:#6B6B6B;text-transform:uppercase;letter-spacing:.04em">' + E(label) + '</div>' +
        '<div style="font-size:24px;font-weight:700;color:' + (colour || '#1A1A1A') + ';margin-top:4px">' + E(value) + '</div>' +
        (word ? '<div style="font-size:12px;color:#444;margin-top:2px">' + E(word) + '</div>' : '') + '</div></td>';
    };
    var green = '#0B7A50', amber = '#B26A00', red = '#B3261E';
    var colourOf = function (v, good, ok) { return v == null ? '#1A1A1A' : v >= good ? green : v >= ok ? amber : red; };
    var tiles = [
      tile('Time in class', f.minutes + ' min', f.joinedClock ? 'joined ' + f.joinedClock : ''),
      tile('Answered', f.asked ? f.answered + ' / ' + f.asked : '—', levelWord('answered', f.answeredPct), colourOf(f.answeredPct, 80, 50)),
      tile('Correct', f.scorePct == null ? '—' : f.scorePct + '%', f.scorePct == null ? 'not marked' : levelWord('score', f.scorePct), colourOf(f.scorePct, 75, 45))
    ];
    var tiles2 = [
      tile('Answer speed', f.avgSecs == null ? '—' : (f.avgSecs < 60 ? f.avgSecs + ' s' : Math.floor(f.avgSecs / 60) + 'm ' + (f.avgSecs % 60) + 's'), levelWord('speed', f.avgSecs)),
      tile('Focus', f.focusPct == null ? '—' : f.focusPct + '%', f.focusPct == null ? (f.via === 'zoom' ? 'watched on Zoom' : '') : levelWord('focus', f.focusPct), colourOf(f.focusPct, 85, 65)),
      tile('Hands raised', String(f.hands || 0), f.points ? f.points + ' point' + (f.points === 1 ? '' : 's') + ' earned' : '')
    ];
    var html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222;max-width:620px;margin:0 auto">';
    html += '<p style="margin:0 0 4px">Dear Parent,</p>';
    html += '<p style="margin:0 0 14px">Here is how <b>' + E(f.name) + '</b> did in today’s live lesson (' + E(when) + ').</p>';
    html += '<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse"><tr>' + tiles.join('') + '</tr><tr>' + tiles2.join('') + '</tr></table>';
    html += '<p style="margin:14px 0 0">' + E(participationLine(f)) + '</p>';
    var tr = trendOf(history, f);
    if (tr === 'up') html += '<p style="margin:6px 0 0;color:' + green + '">↑ Better than ' + E(f.name) + '’s recent live lessons.</p>';
    if (tr === 'down') html += '<p style="margin:6px 0 0;color:' + amber + '">↓ Lower than ' + E(f.name) + '’s recent live lessons — worth a little extra practice this week.</p>';
    if (f.note) html += '<div style="margin:16px 0 0;padding:12px 14px;border-left:4px solid #0B7A50;background:#F1F8F4;border-radius:6px"><b>Teacher’s note:</b> ' + E(f.note) + '</div>';
    if (f.rows.length) {
      html += '<h3 style="font-size:16px;margin:22px 0 8px">Questions in class</h3><table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:14px">';
      f.rows.forEach(function (row, i) {
        var label = 'Q' + (row.q.n || i + 1) + (row.q.text ? ': ' + oneLine(row.q.text, 140) : ' (picture question)');
        var said = row.entry ? (row.text ? '“' + oneLine(row.text, 200) + '”' : '') + (row.photo ? (row.text ? ' + ' : '') + 'a photo of the working' : '') : 'No answer';
        var mk = row.mark === true ? ['✓ Right', green] : row.mark === false ? ['✗ Not right', red] : row.mark === 'partial' ? ['◐ Partly right', amber] : row.entry ? ['Not marked', '#6B6B6B'] : ['—', '#6B6B6B'];
        html += '<tr><td style="padding:8px 6px;border-top:1px solid #E6E6E3;vertical-align:top"><div>' + E(label) + '</div><div style="color:#555">' + E(said) + '</div></td>' +
          '<td style="padding:8px 6px;border-top:1px solid #E6E6E3;vertical-align:top;white-space:nowrap;color:' + mk[1] + ';font-weight:700;text-align:right">' + E(mk[0]) + '</td></tr>';
      });
      html += '</table>';
    }
    var hist = (Array.isArray(history) ? history : []).map(cleanSummary).filter(Boolean);
    if (hist.length) {
      html += '<h3 style="font-size:16px;margin:22px 0 8px">Recent live lessons</h3><table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:14px">';
      html += '<tr style="color:#6B6B6B;font-size:12px;text-transform:uppercase"><td style="padding:4px 6px">Lesson</td><td style="padding:4px 6px;text-align:right">Answered</td><td style="padding:4px 6px;text-align:right">Correct</td><td style="padding:4px 6px;text-align:right">Focus</td></tr>';
      hist.concat([{ e: Number(session.epoch) || 1, d: session.startedAt || now, q: f.asked, a: f.answered, r: f.right, h: f.partly, k: f.marked, f: f.focusPct == null ? -1 : f.focusPct, today: true }]).forEach(function (x) {
        var sc = x.k > 0 ? Math.round((x.r + 0.5 * x.h) / x.k * 100) + '%' : '—';
        if (x.x) {
          html += '<tr><td style="padding:6px;border-top:1px solid #E6E6E3">' + E(sgDay(x.d) || 'Lesson') + '</td>' +
            '<td colspan="3" style="padding:6px;border-top:1px solid #E6E6E3;text-align:right;color:' + red + ';font-weight:700">Absent</td></tr>';
          return;
        }
        html += '<tr' + (x.today ? ' style="font-weight:700"' : '') + '><td style="padding:6px;border-top:1px solid #E6E6E3">' + E((sgDay(x.d) || 'Lesson') + (x.today ? ' (today)' : '')) + '</td>' +
          '<td style="padding:6px;border-top:1px solid #E6E6E3;text-align:right">' + E(x.q > 0 ? x.a + ' / ' + x.q : '—') + '</td>' +
          '<td style="padding:6px;border-top:1px solid #E6E6E3;text-align:right">' + E(sc) + '</td>' +
          '<td style="padding:6px;border-top:1px solid #E6E6E3;text-align:right">' + E(x.f >= 0 ? x.f + '%' : '—') + '</td></tr>';
      });
      html += '</table>';
    }
    html += '<p style="margin:22px 0 0;font-size:13px;color:#6B6B6B">How we measure: <b>Correct</b> counts only answers your child’s teacher has marked. <b>Answer speed</b> is the time from a question appearing to the answer arriving. <b>Focus</b> is how much of the lesson the class screen stayed open in front of your child (it drops when they switch to another app or tab).</p>';
    html += '<p style="margin:18px 0 0">Warm regards,<br>' + E(centre || 'Polymath Learning Centre') + '</p>';
    html += '<p style="margin:10px 0 0;font-size:13px;color:#6B6B6B">Questions? Reply to this email or WhatsApp us at +65 9645 0588.</p></div>';
    return html;
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
  // 💸 What each device sends (v1.208.0). LiveKit bills the data every
  // student RECEIVES, so the plan spends it where it is read:
  //   - the WORKSHEET is the lesson: sharp (its own resolution, a high bit
  //     rate, `contentHint: 'text'`, resolution kept over frame rate) but only
  //     5 frames a second, because a page being written on needs no more. A
  //     second layer (720p, 3 frames a second) is what a student on weak
  //     wifi falls back to.
  //   - every CAMERA is a small tile, so it is sent small: the teacher's at
  //     320×180, a student's at 320×240 (160×120 on low data), each ONE
  //     layer — there is nothing smaller worth switching down to. Students'
  //     cameras stay ON; only the teacher receives them.
  //   - voices at the speech preset (24 kbps, with DTX: silence costs nothing).
  var SCREEN = { fps: 5, bps: 1400000, low: { w: 1280, h: 720, fps: 3, bps: 350000 } };
  function publishPlan(role, lowData) {
    if (role === 'teacher') return { camera: { w: 320, h: 180, fps: 15, bps: 150000 }, screen: SCREEN, audioBps: 24000 };
    return { camera: lowData ? { w: 160, h: 120, fps: 8, bps: 45000 } : { w: 320, h: 240, fps: 12, bps: 110000 }, screen: null, audioBps: 24000 };
  }
  // Roughly what one student receives in a minute, in megabytes, at the
  // ceilings above (a still page costs far less than its ceiling).
  function minuteMB(plan, opts) {
    opts = opts || {};
    var bps = (opts.camera === false ? 0 : plan.camera.bps) + (opts.screen === false || !plan.screen ? 0 : plan.screen.bps) + plan.audioBps;
    return Math.round(bps * 60 / 8 / 1e6 * 10) / 10;
  }
  // Which remote tracks a student's device receives. The teacher always;
  // classmates only when asked; in low-data mode the teacher's CAMERA is
  // dropped (the screen and the voice are the lesson).
  function wantTrack(myRole, prefs, publisherIdentity, source) {
    var pubRole = roleOfIdentity(publisherIdentity);
    if (myRole === 'teacher') return true;
    // 📱 A Zoom child's phone only answers: they watch and hear on Zoom, and
    // a second copy of the lesson's sound out of the phone is an echo.
    if (prefs && prefs.answerOnly) return false;
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
  // What the teacher's browser is asked for when the worksheet is shared:
  // THIS tab (the worksheet is in it), at the worksheet's low frame rate.
  function shareConstraints() {
    return { video: { displaySurface: 'browser', frameRate: { ideal: SCREEN.fps, max: SCREEN.fps } }, audio: false,
      preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', monitorTypeSurfaces: 'exclude' };
  }
  function cleanPrefs(p) {
    p = p && typeof p === 'object' ? p : {};
    return { classmates: p.classmates === true, lowData: p.lowData === true, mirror: p.mirror !== false, autoLow: p.autoLow !== false,
      cameraOff: p.cameraOff === true, record: p.record !== false, hideSelf: p.hideSelf === true, lastKind: KINDS.indexOf(p.lastKind) !== -1 ? p.lastKind : 'mcq',
      aiMark: p.aiMark !== false, aiReview: p.aiReview === true, answerOnly: p.answerOnly === true, keyAuto: p.keyAuto !== false,
      zoomGain: isFinite(Number(p.zoomGain)) ? Math.max(0, Math.min(2, Number(p.zoomGain))) : 1, zoomDuck: p.zoomDuck !== false };
  }

  /* 🔗 Personal links and PINs (v1.210.0). The server makes and checks the
     codes; these only read their shape and lay the teacher's list out. */
  var PASS_CODE_RE = /^[A-Za-z0-9-]{1,60}_[A-Za-z0-9-]{1,60}\.\d{1,6}\.[A-Za-z0-9_-]{16}$/;
  function cleanPassCode(v) {
    var t = str(v).trim();
    return PASS_CODE_RE.test(t) ? t : '';
  }
  // `?live=<code>` (the personal link) → the code; a bare `?live` → ''.
  function passFromSearch(search) {
    var q = str(search).replace(/^\?/, '');
    var out = '';
    q.split('&').forEach(function (part) {
      var i = part.indexOf('=');
      var k = i < 0 ? part : part.slice(0, i);
      if (k !== 'live' || i < 0) return;
      var v = part.slice(i + 1);
      try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { v = ''; }
      if (!out) out = cleanPassCode(v);
    });
    return out;
  }
  function cleanPinInput(v) { return str(v).replace(/\D+/g, '').slice(0, 4); }
  // The personal link for a code, from the class link (`…/anskey/?live`).
  function passLink(classLink, code) {
    var c = cleanPassCode(code);
    if (!c) return '';
    var base = str(classLink).replace(/[?#].*$/, '');
    return base + '?live=' + encodeURIComponent(c);
  }
  // 📖 The same child's Study Buddy link: Study Buddy lives beside Ans Key
  // (…/anskey/ → …/tutor/), and `?pass=` signs the child in as themselves.
  function studyBase(classLink) {
    var base = str(classLink).replace(/[?#].*$/, '');
    if (!/^https?:\/\/[^\/]+/i.test(base)) return '';
    if (!/\/[^\/]*\/?(?:index\.html)?$/.test(base.replace(/^https?:\/\/[^\/]+/i, '') || '/')) return '';
    var host = /^https?:\/\/[^\/]+/i.exec(base)[0];
    var path = base.slice(host.length) || '/';
    path = path.replace(/\/[^\/]*\/?(?:index\.html)?$/, '/tutor/');
    return host + path;
  }
  function studyLink(classLink, code) {
    var c = cleanPassCode(code), base = studyBase(classLink);
    if (!c || !base) return '';
    return base + '?pass=' + encodeURIComponent(c);
  }
  function cleanPassRow(r) {
    r = r && typeof r === 'object' ? r : {};
    return {
      id: str(r.id).slice(0, 130), name: oneLine(r.name, LIMITS.name) || 'Student', level: oneLine(r.level, 12),
      slots: (Array.isArray(r.slots) ? r.slots : []).map(function (x) { return { slot: oneLine(x && x.slot, 40), label: oneLine(x && x.label, 120) }; }).slice(0, 8),
      gen: Math.max(0, Math.floor(Number(r.gen) || 0)), pin: /^\d{4}$/.test(str(r.pin)) ? str(r.pin) : '', code: cleanPassCode(r.code)
    };
  }
  // The rows shown: one lesson slot ('' = everyone), then the typed words.
  function passesShown(rows, slot, query) {
    var list = (rows || []).filter(function (r) { return !slot || r.slots.some(function (x) { return x.slot === slot; }); });
    return filterNames(list, query);
  }
  // Every slot that has a child, in the order the rows came (week order).
  function passSlots(rows) {
    var seen = {}, out = [];
    (rows || []).forEach(function (r) { r.slots.forEach(function (x) { if (x.slot && !seen[x.slot]) { seen[x.slot] = 1; out.push(x); } }); });
    return out;
  }
  // "Copy all": one line per child, ready for a WhatsApp message to parents.
  function passLines(rows, classLink) {
    return (rows || []).map(function (r) {
      var study = studyLink(classLink, r.code);
      var zoom = zoomLink(classLink, r.code);
      return r.name + (r.level ? ' (' + r.level + ')' : '') + ' — ' + passLink(classLink, r.code) + (r.pin ? ' — PIN ' + r.pin : '') +
        (zoom ? ' — from Zoom ' + zoom : '') + (study ? ' — Study Buddy ' + study : '');
    }).join('\n');
  }
  // The QR modules as one SVG path description (four-module quiet zone).
  function qrPath(matrix) {
    var n = matrix && matrix.length || 0, q = 4, d = '';
    for (var r = 0; r < n; r++) {
      var row = matrix[r] || [], c = 0;
      while (c < n) {
        if (!row[c]) { c++; continue; }
        var start = c;
        while (c < n && row[c]) c++;
        d += 'M' + (start + q) + ' ' + (r + q) + 'h' + (c - start) + 'v1h-' + (c - start) + 'z';
      }
    }
    return { size: n + q * 2, d: d };
  }

  /* 📞 Zoom hybrid (v1.212.0). Half the class can be in a Zoom meeting:
     the teacher feeds the Zoom room's sound into the live class as ONE
     extra audio track (so the children here hear the children there), the
     Zoom children answer pop-ups from a phone through their own link, and
     nothing loops back. These helpers decide; the window only wires. */
  var ZOOM = {
    name: 'zoom',                // the track's name: the only one the teacher publishes under it
    bps: 64000,                  // a room of voices at music quality, not the speech preset
    duck: 0.35,                  // how far the Zoom room is turned down while a child here speaks
    duckHoldMs: 600,             // and how long it stays down after they stop (no pumping)
    talkLevel: 0.05,             // the level above which a child here counts as speaking
    meterMs: 120
  };
  // What the browser is asked for. 'display': the Zoom WINDOW (or a tab, or
  // the whole screen with system sound). 'input': a sound input the teacher
  // picks (a loopback cable, or a microphone near the Zoom laptop). Either
  // way the browser's voice processing is OFF — it is built for one voice
  // into one microphone, and on a room of voices it gates and pumps — and
  // `restrictOwnAudio` / `suppressLocalAudioPlayback` keep THIS page's own
  // sound (every child here) out of what is captured. That is the echo guard:
  // without it, a child here hears themselves come back through Zoom.
  function zoomCaptureConstraints(route, deviceId) {
    var plain = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, sampleRate: 48000 };
    if (route === 'input') {
      var a = Object.assign({}, plain);
      var id = oneLine(deviceId, 200);
      if (id) a.deviceId = { exact: id };
      return { audio: a, video: false };
    }
    return {
      video: { displaySurface: 'window', frameRate: { ideal: 1, max: 5 }, width: { max: 640 }, height: { max: 360 } },
      audio: Object.assign({}, plain, { suppressLocalAudioPlayback: true, restrictOwnAudio: true }),
      systemAudio: 'include', windowAudio: 'window', restrictOwnAudio: true,
      selfBrowserSurface: 'exclude', surfaceSwitching: 'include', preferCurrentTab: false, monitorTypeSurfaces: 'include'
    };
  }
  // The Zoom room's gain: full while nobody here speaks, ducked while a child
  // here does (Zoom is ALSO hearing that child through the teacher's share,
  // so a feed at full volume over them is the double-talk Zoom's own echo
  // cancelling turns into chopped sound). `heldUntil` keeps it down a little
  // after they stop.
  function duckGain(talking, nowMs, heldUntil, base) {
    var b = Number(base);
    if (!isFinite(b) || b < 0) b = 1;
    if (b > 2) b = 2;
    var down = !!talking || (Number(heldUntil) || 0) > (Number(nowMs) || 0);
    return Math.round((down ? b * ZOOM.duck : b) * 1000) / 1000;
  }
  // The level of a slice of samples (root mean square, 0..1).
  function rmsLevel(samples) {
    var n = samples && samples.length || 0;
    if (!n) return 0;
    var sum = 0;
    for (var i = 0; i < n; i++) { var v = Number(samples[i]) || 0; sum += v * v; }
    return Math.min(1, Math.sqrt(sum / n));
  }
  // What a chosen sound input probably is, read off its name, and what to
  // say about it. A loopback device carries EVERYTHING the computer plays,
  // this page's own sound included, so it is only safe when only Zoom plays
  // into it; a microphone hears the room and the speakers.
  var LOOPBACK_RE = /stereo mix|what u hear|wave out|blackhole|vb-?audio|vb-?cable|cable output|voicemeeter|loopback|soundflower|zoomaudiodevice|zoom audio/i;
  var MIC_RE = /micro?phone|\bmic\b|headset|airpods|built-?in|internal|webcam|array/i;
  function loopbackHint(label) {
    var t = oneLine(label, 200);
    if (!t) return { kind: 'unknown', note: 'Allow the microphone once to see each input’s name.' };
    if (LOOPBACK_RE.test(t)) return { kind: 'loopback', note: 'A loopback input carries everything the computer plays. Send ONLY Zoom’s speaker to it, never Chrome’s, or the class hears itself come back.' };
    if (MIC_RE.test(t)) return { kind: 'mic', note: 'A microphone hears the room. Wear headphones on the Zoom computer, or the class hears itself through the speakers.' };
    return { kind: 'other', note: 'Check with the meter: talk into Zoom from a phone and watch it move.' };
  }
  // `&zoom` on a personal link: this phone only ANSWERS (the child watches
  // and listens on Zoom), so it takes no camera, no microphone and no video.
  function zoomFromSearch(search) {
    var q = str(search).replace(/^\?/, '');
    return q.split('&').some(function (part) {
      var i = part.indexOf('=');
      var k = i < 0 ? part : part.slice(0, i);
      if (k !== 'zoom') return false;
      var v = i < 0 ? '' : part.slice(i + 1).toLowerCase();
      return v === '' || v === '1' || v === 'yes' || v === 'true' || v === 'on';
    });
  }
  function zoomLink(classLink, code) {
    var l = passLink(classLink, code);
    return l ? l + '&zoom' : '';
  }
  // The setup guide, step by step, for the teacher's computer. Words only;
  // the window writes each with textContent.
  var ZOOM_GUIDE = {
    mac: {
      title: 'On a Mac',
      steps: [
        'Open Zoom and Ans Key side by side. Put headphones on: the speakers would play the class back into your microphone.',
        'In Zoom, press Share Screen, choose the Chrome window with Ans Key in it, and tick “Share sound” at the bottom. The Zoom children now see the worksheet and hear the children here.',
        'In Ans Key, press 📞 Zoom → 🪟 Pick the Zoom window. Choose the zoom.us window and leave “Also share window audio” on. (Chrome needs macOS 14.2 or later for window sound.)',
        'No window sound on your Mac? Install BlackHole 2ch, set Zoom → Settings → Audio → Speaker to BlackHole, and pick “BlackHole 2ch” under 🎚 A sound input. Keep Chrome on your headphones.',
        'Send each Zoom child their 📱 Zoom link from 🔗 Links & PINs. It opens straight to their name and only answers questions: they watch and listen on Zoom.',
        'Test: ask a Zoom child to say hello. The meter moves, and a child here hears them once (not twice).'
      ]
    },
    windows: {
      title: 'On Windows',
      steps: [
        'Open Zoom and Ans Key. Use headphones: the speakers would play the class back into your microphone.',
        'In Zoom, press Share Screen, choose the Chrome window with Ans Key in it, and tick “Share sound”. The Zoom children now see the worksheet and hear the children here.',
        'In Ans Key, press 📞 Zoom → 🪟 Pick the Zoom window, choose “Entire screen” and turn on “Also share system audio”. Chrome leaves Ans Key’s own sound out, so only Zoom is sent.',
        'Or route it: install VB-CABLE, set Zoom → Settings → Audio → Speaker to “CABLE Input”, and pick “CABLE Output” under 🎚 A sound input.',
        'Send each Zoom child their 📱 Zoom link from 🔗 Links & PINs. It opens straight to their name and only answers questions: they watch and listen on Zoom.',
        'Test: ask a Zoom child to say hello. The meter moves, and a child here hears them once (not twice).'
      ]
    }
  };
  // Which guide to open first, from the browser's own platform string.
  function guideFor(platform) {
    return /win/i.test(str(platform)) ? 'windows' : 'mac';
  }
  // Is this remote audio publication the teacher's Zoom feed?
  function isZoomFeed(identity, source, name) {
    return roleOfIdentity(identity) === 'teacher' && source === 'screen_audio' && str(name) === ZOOM.name;
  }

  var pure = {
    VERSION: VERSION, TOPIC: TOPIC, KINDS: KINDS, KIND_LABEL: KIND_LABEL, LIMITS: LIMITS,
    cleanQuestion: cleanQuestion, questionForStudent: questionForStudent, meantFor: meantFor,
    cleanAnswer: cleanAnswer, normAnswer: normAnswer, numberOf: numberOf, blankMatches: blankMatches,
    autoMark: autoMark, answerText: answerText,
    cleanCloze: cleanCloze, clozeText: clozeText, clozeFull: clozeFull, clozeTokens: clozeTokens, clozeFrom: clozeFrom, pickKeywords: pickKeywords,
    clozeAuto: clozeAuto, gapCount: gapCount, cleanKeyItems: cleanKeyItems, keyItemCompose: keyItemCompose, letter: letter, validImage: validImage,
    encode: encode, decode: decode, chunkImage: chunkImage, makeAssembler: makeAssembler,
    outboxAdd: outboxAdd, outboxAck: outboxAck, outboxDue: outboxDue,
    emptySession: emptySession, personJoined: personJoined, personLeft: personLeft, minutesPresent: minutesPresent,
    recordAnswer: recordAnswer, markOf: markOf, questionStats: questionStats, roster: roster,
    VERDICTS: VERDICTS, cleanMark: cleanMark, markWord: markWord, cleanVerdict: cleanVerdict, cleanVerdicts: cleanVerdicts,
    provisionalOf: provisionalOf, confirmedOf: confirmedOf, markSource: markSource, needsAiMark: needsAiMark,
    confirmPlan: confirmPlan, tallyOf: tallyOf, choosersOf: choosersOf, questionFromAi: questionFromAi,
    participation: participation, participationLine: participationLine, reportText: reportText, reportHtml: reportHtml,
    personFocus: personFocus, presentMs: presentMs, performance: performance, levelWord: levelWord, sgClock: sgClock, sgDay: sgDay, secondsWords: secondsWords,
    perfSummary: perfSummary, cleanSummary: cleanSummary, progressMerge: progressMerge, historyFor: historyFor, historyLines: historyLines, trendOf: trendOf,
    historyWithAbsences: historyWithAbsences, attJoinedMap: attJoinedMap, attPending: attPending, namesWords: namesWords, attStatus: attStatus,
    reportCardHtml: reportCardHtml, FOCUS_PREFIX: FOCUS_PREFIX, PROGRESS_KEEP: PROGRESS_KEEP,
    LEAVE_MIN_MS: LEAVE_MIN_MS, cleanLeaves: cleanLeaves, personLeave: personLeave, isAwayNow: isAwayNow, cleanOut: cleanOut, outForAnswer: outForAnswer, outWords: outWords, leaveSummary: leaveSummary,
    gridFor: gridFor, clampBox: clampBox, qualityWord: qualityWord, publishPlan: publishPlan, minuteMB: minuteMB, SCREEN: SCREEN, wantTrack: wantTrack,
    shareConstraints: shareConstraints,
    filterNames: filterNames, cleanPrefs: cleanPrefs,
    cleanPassCode: cleanPassCode, passFromSearch: passFromSearch, cleanPinInput: cleanPinInput, passLink: passLink, studyLink: studyLink, studyBase: studyBase,
    ZOOM: ZOOM, zoomCaptureConstraints: zoomCaptureConstraints, duckGain: duckGain, rmsLevel: rmsLevel, loopbackHint: loopbackHint,
    zoomFromSearch: zoomFromSearch, zoomLink: zoomLink, ZOOM_GUIDE: ZOOM_GUIDE, guideFor: guideFor, isZoomFeed: isZoomFeed,
    cleanPassRow: cleanPassRow, passesShown: passesShown, passSlots: passSlots, passLines: passLines, qrPath: qrPath, PASS_KEY: PASS_KEY, roleOfIdentity: roleOfIdentity, validIdentity: validIdentity,
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
      // ✨ AI send and Chung GPT's pre-marks (v1.209.0)
      aiq: {}, aiBusy: 0, aiMarking: {}, aiFailed: {}, aiSend: '', tally: '', tallyQ: '',
      // student
      questions: {}, order: [], mine: {}, outbox: {}, popup: null, popMin: false, gotState: false, helloTimer: 0, resendTimer: 0,
      handUp: false, lists: null, pickTab: (typeof env.startTab === 'function' && env.startTab() === 'pin') ? 'pin' : 'mine', pick: null, query: '', confirmAgain: null,
      // 🔗 personal link / PIN (v1.210.0)
      me: null, passOff: false, passNote: '', pinDraft: '', pinMsg: '', pinBusy: false, pv: null,
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
      row.appendChild(btn('', '🔗 Links & PINs', 'Every student\'s own join link, QR code and PIN', function () { openPasses(sel.value); }));
      row.appendChild(btn('', '⚙ Keys', 'Change the LiveKit keys', function () { paintSetup(false); }));
      card.appendChild(row);
      // Settings that outlive one class: how early students may come in, and
      // whether the class is recorded.
      var opts = el('div', 'vcOpts');
      var early = el('label', 'vcOpt');
      early.appendChild(el('span', null, '🚪 Students can join'));
      var earlyIn = el('input');
      earlyIn.type = 'number'; earlyIn.min = '0'; earlyIn.max = '120'; earlyIn.step = '5'; earlyIn.className = 'vcEarly';
      earlyIn.value = String(st.settings && st.settings.earlyMin !== undefined ? st.settings.earlyMin : 10);
      early.appendChild(earlyIn);
      early.appendChild(el('span', null, 'minutes before their lesson starts'));
      earlyIn.addEventListener('change', function () {
        var n = Math.max(0, Math.min(120, Math.round(Number(earlyIn.value) || 0)));
        earlyIn.value = String(n);
        call('settings', { earlyMin: n }).then(function (r) {
          S.status = Object.assign({}, S.status || {}, { settings: r.settings });
          say('Students can now join ' + r.settings.earlyMin + ' minute' + (r.settings.earlyMin === 1 ? '' : 's') + ' before their lesson.');
        }, function (e) { say((e && e.message) || 'That setting could not be saved.'); });
      });
      opts.appendChild(early);
      var recLab = el('label', 'vcOpt');
      var recBox = el('input'); recBox.type = 'checkbox'; recBox.checked = S.prefs.record !== false; recBox.className = 'vcRecPref';
      recBox.addEventListener('change', function () { S.prefs.record = recBox.checked; savePrefs(); });
      recLab.appendChild(recBox);
      recLab.appendChild(el('span', null, '⏺ Record the class (saved to Ans Key and put on the worksheet you teach from)'));
      opts.appendChild(recLab);
      paintAttSettings(opts, st);
      card.appendChild(opts);
      S.body.appendChild(card);
      paintRecordings(card);
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
    // 📼 The classes recorded so far: from the lesson records (every device of
    // the teacher's), and this device's uploads still on their way.
    function paintRecordings(card) {
      if (typeof env.recordings !== 'function') return;
      var sec = el('div', 'vcRecs');
      sec.appendChild(el('h4', null, '📼 Recordings'));
      var list = el('div', 'vcRecList');
      list.appendChild(el('p', 'vcMuted', 'Loading…'));
      sec.appendChild(list);
      card.appendChild(sec);
      var seq = S.seq;
      Promise.resolve(env.recordings()).then(function (rows) {
        if (seq !== S.seq || S.mode !== 'start') return;
        var local = env.recorder && typeof env.recorder.status === 'function' ? env.recorder.status() : [];
        clear(list);
        var items = [];
        (Array.isArray(rows) ? rows : []).forEach(function (r) {
          (Array.isArray(r.videos) && r.videos.length ? r.videos : [null]).forEach(function (v) { items.push({ r: r, v: v }); });
        });
        local.forEach(function (j) {
          if (j.state === 'done') return;
          if (!items.some(function (it) { return it.v && it.v.id === j.id; })) items.push({ r: { epoch: j.epoch, slotLabel: j.slotLabel, startedAt: j.startedAt }, v: null, job: j });
        });
        items.sort(function (a, b) { return ((b.v && b.v.startedAt) || b.r.startedAt || 0) - ((a.v && a.v.startedAt) || a.r.startedAt || 0); });
        items = items.slice(0, 12);
        if (!items.length) { list.appendChild(el('p', 'vcMuted', 'No class has been recorded yet. Recordings appear here and on the worksheet.')); return; }
        items.forEach(function (it) {
          var row = el('div', 'vcRecRow');
          var when = (it.v && it.v.startedAt) || it.r.startedAt;
          row.appendChild(el('span', 'vcRecWhen', fmtDate(when) + ' · ' + new Date(when).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })));
          row.appendChild(el('span', 'vcRecWhat', it.r.slotLabel || 'Live class'));
          var job = it.job || local.filter(function (j) { return it.v === null && j.epoch === it.r.epoch && j.state !== 'done'; })[0];
          if (it.v && it.v.url) {
            row.appendChild(el('span', 'vcMuted', fmtRecClock(it.v.durationMs || 0)));
            var a = el('a', 'vcBtn', '▶ Watch'); a.href = it.v.url; a.target = '_blank'; a.rel = 'noopener';
            row.appendChild(a);
            row.appendChild(btn('', '⧉ Link', 'Copy the video link', function () { copyText(it.v.url).then(function () { say('Video link copied.'); }); }));
          } else if (job) {
            row.appendChild(el('span', 'vcRecUp', job.recording ? '⏺ recording now' : '☁ uploading from this device · ' + job.percent + '%'));
          } else {
            row.appendChild(el('span', 'vcMuted', 'not recorded'));
          }
          list.appendChild(row);
        });
      }, function () { if (seq === S.seq) { clear(list); list.appendChild(el('p', 'vcMuted', 'The recordings could not be loaded.')); } });
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
      S.closeAtt = null;
      paintBusy(fresh ? 'Starting a new class…' : 'Opening the class…');
      var seq = ++S.seq;
      call('open', { slot: slot || '', fresh: !!fresh }).then(function (res) {
        if (seq !== S.seq || !isTeacher()) return;
        S.slot = res.slot || slot || ''; S.epoch = res.epoch; S.room_name = res.room;
        S.door = res.gate ? Object.assign({}, res.gate, { skew: Number(res.gate.now) ? Number(res.gate.now) - now() : 0 }) : null;
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
      stopAttTimer();
      var closeBody = S.session ? { epoch: S.session.epoch, joined: attJoinedMap(S.session), skip: S.att ? Object.keys(S.att.skip) : [] } : {};
      call('close', closeBody).then(function (r) {
        var d = r && r.attendance;
        if (!d || !d.taken) return;
        S.closeAtt = d;
        var caught = d.students.filter(function (x) { return x.catchup && !x.here; });
        if (caught.length) say('📚 Catch-up link emailed to the parents of ' + namesWords(caught) + '.');
        if (S.mode === 'ended') paintSide();
      }).catch(function (e) { say('The class could not be closed: ' + ((e && e.message) || e)); });
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
        // 🔗 A personal link (or this device's remembered one) says who this
        // is: no list to search, one Join button.
        var code = passNow();
        if (code) return checkPassCode(code, st);
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
        // The teacher pressed "Let students in now", or started another class.
        if (S.role === 'student' && S.mode === 'gate' && (!open || m.letIn || Number(m.epoch) !== Number(S.gateEpoch))) openStudent();
      });
    }
    // 🚪 Too early for this lesson: when it starts, when the door opens, and
    // a count down to it. The door is the server's; this only waits for it.
    function paintGate(res) {
      var g = res.gate || {};
      S.mode = 'gate';
      S.gateEpoch = res.epoch;
      placeWindow();
      clear(S.body);
      var box = el('div', 'vcCenter vcWait vcGateCard');
      box.appendChild(el('div', 'vcBig', '⏳'));
      if (S.me && S.me.name && passNow()) box.appendChild(el('p', 'vcHello', 'Hi ' + S.me.name + '!'));
      box.appendChild(el('h3', null, g.reason === 'other_day' ? 'This class is not on today' : 'Your lesson has not started yet'));
      if (res.slotLabel) box.appendChild(el('p', 'vcMsg', res.slotLabel));
      box.appendChild(el('p', 'vcMuted', g.message || 'Your teacher will let you in soon.'));
      var count = el('p', 'vcCountdown');
      box.appendChild(count);
      box.appendChild(btn('', 'Check again', null, openStudent));
      S.body.appendChild(box);
      // Counted on the SERVER's clock (a device clock can be wrong by hours).
      var skew = Number(g.now) ? Number(g.now) - now() : 0;
      var tick = function () {
        if (S.mode !== 'gate') return;
        var left = Number(g.opensAt) - (now() + skew);
        if (left <= 0) { openStudent(); return; }
        var mins = Math.ceil(left / 60000);
        count.textContent = left < 120000 ? 'Opening in ' + Math.ceil(left / 1000) + ' s' : mins < 120 ? 'Opening in ' + mins + ' min' : '';
        clearTimeout(S.waitTimer);
        S.waitTimer = setTimeout(tick, left < 120000 ? 1000 : 20000);
      };
      tick();
    }
    function paintWait() {
      S.mode = 'wait';
      placeWindow();
      clear(S.body);
      var box = el('div', 'vcCenter vcWait');
      box.appendChild(el('div', 'vcBig', '⏳'));
      if (S.me && S.me.name && passNow()) box.appendChild(el('p', 'vcHello', 'Hi ' + S.me.name + '!'));
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
        if (res.gate && res.gate.open === false) return paintGate(res);
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
      if (S.passNote) card.appendChild(el('p', 'vcNote', S.passNote));
      var tabs = el('div', 'vcTabs');
      tabs.setAttribute('role', 'tablist');
      [['mine', 'My class'], ['makeup', 'Make-up'], ['trial', 'Trial'], ['pin', '🔢 PIN']].forEach(function (t) {
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

      if (S.pickTab === 'pin') {
        paintPinPane(pane, confirm);
      } else if (S.pickTab === 'trial') {
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
      if (urlZoom() && !S.prefs.answerOnly) { S.prefs.answerOnly = true; savePrefs(); }
      foot.appendChild(zoomChoice());
      if (S.pickTab !== 'pin') foot.appendChild(confirm);
      card.appendChild(foot);
      if (S.pickTab !== 'pin') syncConfirm();
      S.body.appendChild(card);
    }

    function joinAsStudent(pick, takeover) {
      if (S.role !== 'student') return;
      S.mode = 'joining';
      paintBusy('Joining the class as ' + (pick.label || pick.name) + '…');
      blessAudio();
      var seq = ++S.seq;
      var body = pick.kind === 'pass' ? { kind: 'pass', code: pick.code }
        : { kind: pick.kind, id: pick.id, name: pick.kind === 'trial' ? pick.name : undefined };
      call('token', { pick: body, takeover: !!takeover }).then(function (res) {
        if (seq !== S.seq) return;
        if (pick.kind === 'pass') {
          rememberPass(res.code || pick.code, res.name || pick.name);
          writeJson(local(), PICK_KEY, { kind: res.kind === 'makeup' ? 'makeup' : 'roster', id: res.rosterId || '', name: '', epoch: 0 });
        } else {
          writeJson(local(), PICK_KEY, { kind: pick.kind, id: pick.id || '', name: pick.kind === 'trial' ? pick.name : '', epoch: 0 });
        }
        S.kind = res.kind; S.rosterId = res.rosterId || '';
        return connect(res);
      }).catch(function (e) {
        if (seq !== S.seq) return;
        if (e && e.code === 'already_in') return paintAlreadyIn(pick, e.message);
        if (e && e.code === 'class_closed') return paintWait();
        // 🔗 A link that was replaced, or a child no longer on the list: back
        // to choosing a name, saying why.
        if (pick.kind === 'pass' && e && (e.code === 'pass_unknown' || e.code === 'not_on_roster')) {
          forgetPass(); S.passNote = e.message; return loadRoster();
        }
        if (pick.kind === 'pass' && e && e.code === 'not_yet') return openStudent();
        // Before the lesson time: the roster says when (a make-up child's own
        // lesson later today is told in words, with the list to go back to).
        if (e && e.code === 'not_yet' && pick.kind !== 'makeup') return loadRoster();
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
      row.appendChild(btn('', 'No, choose again', null, function () {
        S.pick = null;
        if (pick.kind === 'pass') { forgetPass(); S.passOff = true; return loadRoster(); }
        paintPick();
      }));
      card.appendChild(row);
      S.body.appendChild(card);
    }

    /* ================================================================
       🔗 PERSONAL LINKS AND PINs (v1.210.0)
       A child's own link (`?live=<code>`) or their four-digit PIN names
       them: no list to search. The server checks every code and every PIN;
       nothing here decides who anyone is. The code is kept on this device
       so the next lesson is "You are Amy Tan — Join", one tap.
       ================================================================ */
    function urlPass() {
      if (typeof env.passCode === 'function') return cleanPassCode(env.passCode());
      try { return passFromSearch(root.location && root.location.search); } catch (e) { return ''; }
    }
    function storedPass() {
      var p = readJson(local(), PASS_KEY, null);
      return p && typeof p === 'object' ? { code: cleanPassCode(p.code), name: oneLine(p.name, LIMITS.name) } : { code: '', name: '' };
    }
    // The code to use now: "Not me" switches both off for this visit.
    function passNow() {
      if (S.passOff) return '';
      return urlPass() || storedPass().code;
    }
    function rememberPass(code, name) {
      var c = cleanPassCode(code);
      if (!c) return;
      writeJson(local(), PASS_KEY, { code: c, name: oneLine(name, LIMITS.name), at: now() });
    }
    function forgetPass() {
      try { var l = local(); if (l) l.removeItem(PASS_KEY); } catch (e) {}
      S.me = null;
    }
    function checkPassCode(code, st) {
      paintBusy('Checking your class link…');
      var seq = ++S.seq;
      call('pass', { code: code }).then(function (res) {
        if (seq !== S.seq || S.role !== 'student') return;
        S.me = res.me || null;
        if (res.me && res.me.name) rememberPass(res.code || code, res.me.name);
        if (!res.open) return paintWait();
        if (res.gate && res.gate.open === false) return paintGate(res);
        paintMe(res);
      }, function (e) {
        if (seq !== S.seq) return;
        if (e && (e.code === 'pass_unknown' || e.code === 'not_on_roster')) {
          forgetPass();
          S.passOff = true;
          S.passNote = e.message;
          return st && st.open === false ? paintWait() : loadRoster();
        }
        if (e && e.code === 'class_closed') return paintWait();
        if (e && e.code === 'teacher_pass') { S.passOff = true; return paintError(e, null); }
        paintError(e, openStudent);
      });
    }
    // "You are Amy Tan" — one Join button, and a way out for the wrong device.
    function paintMe(res) {
      S.mode = 'me';
      S.slot = res.slot || '';
      placeWindow();
      clear(S.body);
      var me = res.me || {};
      var card = el('div', 'vcCard vcCenter vcMe');
      card.appendChild(el('div', 'vcBig', '👋'));
      card.appendChild(el('p', 'vcMuted', 'You are'));
      card.appendChild(el('h3', 'vcMeName', me.name || 'a student'));
      if (res.slotLabel) card.appendChild(el('p', 'vcMsg', res.slotLabel));
      if (me.kind === 'makeup') card.appendChild(el('p', 'vcMuted', 'A make-up lesson' + (me.home ? ' (your class: ' + me.home + ')' : '') + '.'));
      var code = cleanPassCode(res.code) || passNow();
      // 📱 In the Zoom room? Then this phone only answers (a `&zoom` link
      // ticks it; the choice is remembered on the device).
      if (urlZoom()) { S.prefs.answerOnly = true; savePrefs(); }
      card.appendChild(zoomChoice());
      var go = btn('vcPrimary vcGo', '▶ Join the class', null, function () {
        joinAsStudent({ kind: 'pass', code: code, name: me.name || '', label: me.name || '' }, false);
      });
      card.appendChild(go);
      card.appendChild(btn('vcLinkBtn', 'Not me — choose my name', 'This is not your device or not your name', function () {
        forgetPass(); S.passOff = true; S.passNote = ''; loadRoster();
      }));
      S.body.appendChild(card);
      if (!phone()) setTimeout(function () { try { go.focus(); } catch (e) {} }, 0);
    }
    function urlZoom() {
      try { return zoomFromSearch(root.location && root.location.search); } catch (e) { return false; }
    }
    // The "I'm in Zoom" switch on the join card.
    function zoomChoice() {
      var lab = el('label', 'vcZoomPick');
      var box = el('input');
      box.type = 'checkbox';
      box.checked = !!S.prefs.answerOnly;
      box.addEventListener('change', function () { S.prefs.answerOnly = !!box.checked; savePrefs(); });
      lab.appendChild(box);
      lab.appendChild(el('span', '', '📱 I’m in the Zoom meeting — just answer questions on this phone'));
      return lab;
    }
    // 🔢 The PIN tab: four numbers, checked by the server (and counted).
    function paintPinPane(pane) {
      pane.appendChild(el('p', 'vcMuted', 'Your teacher gave you a four-number PIN. Type it here.'));
      var form = el('div', 'vcPinRow');
      var input = el('input', 'vcPinIn');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.autocomplete = 'off';
      input.maxLength = 4;
      input.pattern = '[0-9]*';
      input.placeholder = '• • • •';
      input.value = S.pinDraft || '';
      input.setAttribute('aria-label', 'Your four-number PIN');
      var go = btn('vcPrimary', 'Check my PIN', null, function () { submit(); });
      form.appendChild(input);
      form.appendChild(go);
      pane.appendChild(form);
      var msg = el('p', 'vcPinMsg', S.pinMsg || '');
      msg.setAttribute('role', 'status');
      pane.appendChild(msg);
      function sync() {
        var v = cleanPinInput(input.value);
        if (v !== input.value) input.value = v;
        S.pinDraft = v;
        go.disabled = v.length !== 4 || S.pinBusy;
      }
      function submit() {
        sync();
        if (S.pinDraft.length !== 4 || S.pinBusy) return;
        S.pinBusy = true; go.disabled = true;
        msg.textContent = 'Checking…';
        var seq = ++S.seq;
        call('pass', { pin: S.pinDraft }).then(function (res) {
          S.pinBusy = false;
          if (seq !== S.seq || S.role !== 'student') return;
          S.pinDraft = ''; S.pinMsg = '';
          S.passOff = false; S.passNote = '';
          S.me = res.me || null;
          if (res.code) rememberPass(res.code, res.me && res.me.name);
          if (res.gate && res.gate.open === false) return paintGate(res);
          paintMe(res);
        }, function (e) {
          S.pinBusy = false;
          if (seq !== S.seq) return;
          S.pinMsg = (e && e.message) || 'That PIN could not be checked.';
          msg.textContent = S.pinMsg;
          if (e && e.code === 'class_closed') return paintWait();
          input.value = ''; sync();
          try { input.focus(); } catch (x) {}
        });
      }
      input.addEventListener('input', sync);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
      sync();
      setTimeout(function () { try { input.focus(); } catch (e) {} }, 0);
    }

    /* ---------- the teacher's list of links and PINs ---------- */
    function linkFor(code) {
      var base = typeof env.classLink === 'function' ? env.classLink() : '';
      return passLink(base, code);
    }
    function zoomFor(code) {
      var base = typeof env.classLink === 'function' ? env.classLink() : '';
      return zoomLink(base, code);
    }
    function studyFor(code) {
      var base = typeof env.classLink === 'function' ? env.classLink() : '';
      return studyLink(base, code);
    }
    function qrNode(text, cls) {
      var matrix = null;
      try { matrix = typeof env.qrMatrix === 'function' ? env.qrMatrix(text) : null; } catch (e) { matrix = null; }
      if (!matrix || !matrix.length) return el('p', 'vcMuted', 'QR codes are not available here — copy the link instead.');
      return qrSvgNode(root.document, matrix, cls);
    }
    function qrSvgNode(doc, matrix, cls) {
      var NS = 'http://www.w3.org/2000/svg';
      var q = qrPath(matrix);
      var svg = doc.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + q.size + ' ' + q.size);
      svg.setAttribute('shape-rendering', 'crispEdges');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'QR code');
      if (cls) svg.setAttribute('class', cls);
      var bg = doc.createElementNS(NS, 'rect');
      bg.setAttribute('width', String(q.size)); bg.setAttribute('height', String(q.size)); bg.setAttribute('fill', '#fff');
      var path = doc.createElementNS(NS, 'path');
      path.setAttribute('fill', '#111'); path.setAttribute('d', q.d);
      svg.appendChild(bg); svg.appendChild(path);
      return svg;
    }
    function openPasses(slot) {
      if (!isTeacher()) return;
      S.mode = 'passes';
      S.pv = { rows: S.pv && S.pv.rows || null, slot: slot || (S.pv && S.pv.slot) || '', query: '', qr: {} };
      setTitle('Live class — links and PINs');
      paintBusy('Getting every student\'s link…');
      var seq = ++S.seq;
      call('passes').then(function (res) {
        if (seq !== S.seq || !isTeacher()) return;
        S.pv.rows = (Array.isArray(res.students) ? res.students : []).map(cleanPassRow);
        paintPasses();
      }, function (e) { if (seq === S.seq) paintError(e, function () { openPasses(slot); }); });
    }
    function paintPasses() {
      if (!isTeacher() || !S.pv) return;
      S.mode = 'passes';
      placeWindow();
      clear(S.body);
      var pv = S.pv, rows = pv.rows || [];
      var card = el('div', 'vcCard vcPasses');
      card.appendChild(el('h3', null, '🔗 Personal links and PINs'));
      card.appendChild(el('p', 'vcMuted', 'Each student has their own link. Opening it in a lesson goes straight to "You are … — Join": no list to search. The lesson-time door still applies, and a link from another class joins as a make-up. Students without their link can type their four-number PIN on the class link.'));
      card.appendChild(el('p', 'vcMuted', '📖 The same link and PIN also sign the student into Study Buddy as themselves, at any hour, showing their own level and subjects from /office.'));
      var tools = el('div', 'vcPassTools');
      var sel = el('select', 'vcPassSlot');
      sel.setAttribute('aria-label', 'Which lesson');
      sel.appendChild(new Option('Every lesson (' + rows.length + ')', ''));
      passSlots(rows).forEach(function (x) { sel.appendChild(new Option(x.label || x.slot, x.slot)); });
      sel.value = pv.slot;
      if (sel.value !== pv.slot) { pv.slot = ''; sel.value = ''; }
      sel.addEventListener('change', function () { pv.slot = sel.value; paintList(); });
      var search = el('input', 'vcSearch');
      search.type = 'search'; search.placeholder = 'Find a student'; search.value = pv.query;
      search.setAttribute('aria-label', 'Find a student');
      search.addEventListener('input', function () { pv.query = search.value; paintList(); });
      tools.appendChild(sel); tools.appendChild(search);
      card.appendChild(tools);
      var acts = el('div', 'vcRow vcPassActs');
      acts.appendChild(btn('', '⧉ Copy all', 'Every link and PIN shown, one line each (for a message to parents)', function () {
        var shown = passesShown(rows, pv.slot, pv.query);
        if (!shown.length) { say('No students shown.'); return; }
        copyText(passLines(shown, typeof env.classLink === 'function' ? env.classLink() : '')).then(function () { say(shown.length + ' links copied.'); });
      }));
      acts.appendChild(btn('', '🖨 Print cards', 'A card per student shown: name, QR code and PIN', function () {
        printCards(passesShown(rows, pv.slot, pv.query));
      }));
      acts.appendChild(btn('', '← Back', null, function () { S.pv.qr = {}; setTitle('Live class'); paintStart(); }));
      card.appendChild(acts);
      var list = el('div', 'vcPassList');
      card.appendChild(list);
      function paintList() {
        clear(list);
        var shown = passesShown(rows, pv.slot, pv.query);
        if (!shown.length) { list.appendChild(el('p', 'vcMuted vcEmpty', rows.length ? 'No student matches.' : 'No students on the /office roster this month.')); return; }
        shown.forEach(function (r) {
          var row = el('div', 'vcPassRow');
          var who = el('div', 'vcPassWho');
          who.appendChild(el('b', null, r.name + (r.level ? ' (' + r.level + ')' : '')));
          who.appendChild(el('span', 'vcMuted', r.slots.map(function (x) { return x.label || x.slot; }).join(' · ')));
          row.appendChild(who);
          var pin = el('code', 'vcPin', r.pin || '—');
          pin.title = 'PIN';
          row.appendChild(pin);
          var b = el('div', 'vcPassBtns');
          b.appendChild(btn('', '⧉ Link', 'Copy ' + r.name + '\'s link', function () {
            var link = linkFor(r.code);
            if (!link) { say('This link is not ready yet.'); return; }
            copyText(link).then(function () { say(r.name + '\'s link copied.'); });
          }));
          b.appendChild(btn('', '⧉ 📱 Zoom', 'Copy ' + r.name + '\'s Zoom link: for a phone, when they join from a Zoom meeting (answers only)', function () {
            var link = zoomFor(r.code);
            if (!link) { say('This link is not ready yet.'); return; }
            copyText(link).then(function () { say(r.name + '\'s Zoom link copied.'); });
          }));
          b.appendChild(btn('', '⧉ Study', 'Copy ' + r.name + '\'s Study Buddy link', function () {
            var link = studyFor(r.code);
            if (!link) { say('This link is not ready yet.'); return; }
            copyText(link).then(function () { say(r.name + '\'s Study Buddy link copied.'); });
          }));
          b.appendChild(btn(pv.qr[r.id] ? 'on' : '', '▦ QR', 'Show the QR code', function () { pv.qr[r.id] = !pv.qr[r.id]; paintList(); }));
          b.appendChild(btn('', '↻ New', 'Make a new link and PIN (the old ones stop working)', function () { renewPass(r); }));
          row.appendChild(b);
          if (pv.qr[r.id]) {
            var qbox = el('div', 'vcPassQr');
            var live = el('figure', 'vcQrFig');
            live.appendChild(qrNode(linkFor(r.code), 'vcQrSvg'));
            live.appendChild(el('figcaption', 'vcMuted', '🎥 Live class'));
            qbox.appendChild(live);
            var zLink = zoomFor(r.code);
            if (zLink) {
              var zf = el('figure', 'vcQrFig');
              zf.appendChild(qrNode(zLink, 'vcQrSvg'));
              zf.appendChild(el('figcaption', 'vcMuted', '📱 From Zoom'));
              qbox.appendChild(zf);
            }
            var sLink = studyFor(r.code);
            if (sLink) {
              var study = el('figure', 'vcQrFig');
              study.appendChild(qrNode(sLink, 'vcQrSvg'));
              study.appendChild(el('figcaption', 'vcMuted', '📖 Study Buddy'));
              qbox.appendChild(study);
            }
            qbox.appendChild(el('span', 'vcMuted', 'Scan with a phone or iPad camera.'));
            row.appendChild(qbox);
          }
          list.appendChild(row);
        });
      }
      paintList();
      S.body.appendChild(card);
    }
    function renewPass(r) {
      if (!isTeacher()) return;
      if (!root.confirm('Make a new link and PIN for ' + r.name + '? Their old link and PIN stop working at once.')) return;
      call('repass', { id: r.id }).then(function (res) {
        if (!isTeacher() || !S.pv || !S.pv.rows) return;
        var fresh = cleanPassRow(res.student);
        S.pv.rows = S.pv.rows.map(function (x) { return x.id === fresh.id ? fresh : x; });
        say('New link and PIN for ' + fresh.name + ': ' + fresh.pin + '.');
        if (S.mode === 'passes') paintPasses();
      }, function (e) { say((e && e.message) || 'A new link could not be made.'); });
    }
    // 🖨 One card per student: name, lesson, QR code, PIN and how to use them.
    // Built with DOM calls in a new window (nothing is written as markup).
    function printCards(rows) {
      if (!isTeacher()) return;
      if (!rows || !rows.length) { say('No students shown.'); return; }
      var w = null;
      try { w = root.open('', '_blank'); } catch (e) { w = null; }
      if (!w || !w.document) { say('Allow pop-ups for Ans Key to print the cards.'); return; }
      var doc = w.document;
      var classLink = typeof env.classLink === 'function' ? env.classLink() : '';
      try { doc.title = 'Live class cards'; } catch (e) {}
      var style = doc.createElement('style');
      style.textContent = '@page{margin:12mm}body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;color:#1a1a1a}' +
        '.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8mm}' +
        '.card{border:1.5px dashed #999;border-radius:10px;padding:6mm 7mm;break-inside:avoid;display:grid;grid-template-columns:1fr 30mm;gap:5mm;align-items:center}' +
        '.card h2{margin:0 0 2mm;font-size:17pt}.card p{margin:0 0 2mm;font-size:10pt;color:#444}' +
        '.pin{font:700 22pt ui-monospace,Menlo,monospace;letter-spacing:3pt;color:#1a1a1a;margin:3mm 0 2mm}' +
        '.how{font-size:8.5pt;color:#555;line-height:1.35}svg{width:30mm;height:30mm;display:block}' +
        '.codes{display:grid;gap:2mm;justify-items:center}.codes span{font-size:7.5pt;color:#555}' +
        '.top{font-size:10pt;color:#666;margin:0 0 6mm}@media print{.top{display:none}}';
      (doc.head || doc.documentElement).appendChild(style);
      var body = doc.body || doc.documentElement.appendChild(doc.createElement('body'));
      while (body.firstChild) body.removeChild(body.firstChild);
      var top = doc.createElement('p'); top.className = 'top';
      top.textContent = rows.length + ' card' + (rows.length === 1 ? '' : 's') + '. Cut along the dashed lines.';
      body.appendChild(top);
      var grid = doc.createElement('div'); grid.className = 'grid';
      rows.forEach(function (r) {
        var link = linkFor(r.code);
        var c = doc.createElement('div'); c.className = 'card';
        var left = doc.createElement('div');
        var h = doc.createElement('h2'); h.textContent = r.name; left.appendChild(h);
        var sl = doc.createElement('p'); sl.textContent = '🎥 Live class · ' + r.slots.map(function (x) { return x.label || x.slot; }).join(' · '); left.appendChild(sl);
        var pinLabel = doc.createElement('p'); pinLabel.textContent = 'Your PIN'; left.appendChild(pinLabel);
        var pin = doc.createElement('div'); pin.className = 'pin'; pin.textContent = r.pin || '—'; left.appendChild(pin);
        var how = doc.createElement('div'); how.className = 'how';
        var study = studyFor(r.code);
        how.textContent = 'Scan the 🎥 code with your phone or iPad camera at lesson time. No code? Open ' + (classLink || 'the class link') + ' and type your PIN.' +
          (study ? ' The 📖 code (or the same PIN) opens Study Buddy for homework, any time.' : '');
        left.appendChild(how);
        c.appendChild(left);
        var codes = doc.createElement('div'); codes.className = 'codes';
        [[link, '🎥 Live class'], [study, '📖 Study Buddy']].forEach(function (pair) {
          if (!pair[0]) return;
          var matrix = null;
          try { matrix = typeof env.qrMatrix === 'function' ? env.qrMatrix(pair[0]) : null; } catch (e) { matrix = null; }
          if (!matrix || !matrix.length) return;
          codes.appendChild(qrSvgNode(doc, matrix, ''));
          var cap = doc.createElement('span'); cap.textContent = pair[1]; codes.appendChild(cap);
        });
        if (codes.firstChild) c.appendChild(codes);
        grid.appendChild(c);
      });
      body.appendChild(grid);
      setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 350);
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
    function roomOptions(LK) {
      var plan = publishPlan(S.role, S.prefs.lowData);
      var c = plan.camera;
      // One small camera layer: simulcast would only add a smaller copy nobody needs.
      var publish = { simulcast: false, videoCodec: 'vp8', red: true, dtx: true, stopMicTrackOnMute: false,
        videoEncoding: { maxBitrate: c.bps, maxFramerate: c.fps }, audioPreset: { maxBitrate: plan.audioBps } };
      if (plan.screen) publish.screenShareEncoding = { maxBitrate: plan.screen.bps, maxFramerate: plan.screen.fps };
      return {
        adaptiveStream: true,
        dynacast: true,
        disconnectOnPageLeave: true,
        videoCaptureDefaults: { resolution: { width: c.w, height: c.h, frameRate: c.fps } },
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
      // 📱 A Zoom child's phone publishes nothing: they are on camera in Zoom.
      var camOn = S.role === 'teacher' ? true : (S.prefs.cameraOff !== true && !S.prefs.answerOnly);
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
        focusLoad();
        clearInterval(S.resendTimer);
        S.resendTimer = setInterval(studentTick, 1500);
      } else {
        clearInterval(S.resendTimer);
        S.resendTimer = setInterval(teacherTick, 5000);
        saveSoon();
        if (S.prefs.record !== false) startRecording();
      }
      clearInterval(S.tick);
      S.tick = setInterval(function () { paintPresence(); }, 30000);
      if (!room.canPlaybackAudio && !answerOnlyHere()) showAudioGate(true);
      layout();
    }
    // A student's phone that only answers (the child is in Zoom).
    function answerOnlyHere() { return S.role === 'student' && !!S.prefs.answerOnly; }

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
      room.on(E.AudioPlaybackStatusChanged, function () { showAudioGate(!room.canPlaybackAudio && !answerOnlyHere()); });
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
        if (S.role === 'teacher') zoomSpeakers(ids);
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
      stopRecording(false);
      stopShareTrack();
      stopZoom(true);
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
    // 👀 v1.217.0: a click on another window, and coming back to this one.
    root.addEventListener('blur', function () { setTimeout(focusChanged, 0); });
    root.addEventListener('focus', function () { setTimeout(focusChanged, 0); });
    document.addEventListener('visibilitychange', function () {
      focusChanged();
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
      else paintAttBanner();
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
      if (answerOnlyHere()) return paintAnswerOnlyBar();
      S.bar.appendChild(ctl(micOn ? '' : 'off', micOn ? '🎤' : '🔇', micOn ? 'Mute your microphone' : 'Unmute your microphone', micOn, function () {
        Promise.resolve(lp.setMicrophoneEnabled(!micOn)).catch(function (e) { say('Microphone: ' + ((e && e.message) || e)); }).then(paintControls);
      }));
      S.bar.appendChild(ctl(camOn ? '' : 'off', camOn ? '📷' : '🚫', camOn ? 'Turn your camera off' : 'Turn your camera on', camOn, function () {
        S.prefs.cameraOff = camOn; savePrefs();
        Promise.resolve(lp.setCameraEnabled(!camOn)).catch(function (e) { say('Camera: ' + ((e && e.message) || e)); }).then(function () { paintControls(); layout(); });
      }));
      if (S.role === 'teacher') {
        var canShare = !!(root.navigator && navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
        if (canShare) S.bar.appendChild(ctl('vcShare', shareOn ? '🛑 Stop sharing' : '🖥 Share worksheet', shareOn ? 'Stop sharing the worksheet' : 'Share the worksheet with the class — only the worksheet, never this window or the toolbars (choose “This tab”)', shareOn, function () {
          if (shareOn) stopShare(); else startShare();
        }));
        var rec = S.rec ? S.rec.info() : null;
        S.bar.appendChild(ctl(rec ? 'vcRecOn' : '', rec ? '⏺ ' + fmtRecClock(rec.elapsed) + (rec.pieces ? ' · ☁ ' + rec.sent + '/' + rec.pieces : '') : '⏺ Record',
          rec ? 'Recording the class to Ans Key — each half minute goes up as you teach. Press to stop recording.' : 'Record the class: it is saved to Ans Key\'s cloud and put on the worksheet', !!rec, function () {
          if (S.rec) { stopRecording(true); S.prefs.record = false; savePrefs(); }
          else { S.prefs.record = true; savePrefs(); startRecording(); }
        }));
        var z = S.zoom;
        S.bar.appendChild(ctl(z ? 'vcZoomOn' : '', z ? '📞 Zoom on' : '📞 Zoom', z ? 'The Zoom room’s sound is in the class. Press for the Zoom settings.' : 'Bring a Zoom meeting’s sound into the class, and the setup guide', !!z, function () {
          S.tab = 'zoom'; paintSide();
        }));
        if (S.door && !S.door.open) S.bar.appendChild(ctl('vcDoor', '🚪 Let students in now', S.door.message ? 'Students are waiting: ' + S.door.message : 'Let students join before the lesson time', false, letIn));
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
        S.bar.appendChild(ctl('', S.prefs.hideSelf ? '🙈' : '🙂', S.prefs.hideSelf ? 'Show my own video (your teacher still sees you)' : 'Hide my own video from my screen (your teacher still sees you)', !S.prefs.hideSelf, function () {
          S.prefs.hideSelf = !S.prefs.hideSelf; savePrefs(); layout(); paintControls();
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
    // 📱 The answer-only bar: a Zoom child needs their hand, the question
    // and a way out — nothing that sends or plays the lesson a second time.
    function paintAnswerOnlyBar() {
      S.bar.appendChild(ctl(S.handUp ? 'vcHandUp' : '', S.handUp ? '✋ Hand up' : '✋', S.handUp ? 'Put your hand down' : 'Raise your hand', S.handUp, function () {
        S.handUp = !S.handUp;
        sendTeacher({ t: 'hand', up: S.handUp });
        paintControls();
      }));
      var qCount = openQuestions().length;
      if (qCount && S.popMin) S.bar.appendChild(ctl('vcQPill', '❓ Question', 'Show the question', true, function () { S.popMin = false; paintQuestion(); paintControls(); }));
      S.bar.appendChild(ctl('vcZoomOnly', '📱 Zoom', 'You answer here and watch on Zoom. Press to watch and listen on this device instead.', true, function () {
        setAnswerOnly(false);
      }));
      S.bar.appendChild(el('span', 'vcBarGap'));
      S.bar.appendChild(ctl('vcEnd', 'Leave', 'Leave the class', false, leaveAsk));
    }
    // Switch this phone between "answer only" (in Zoom) and the full class.
    function setAnswerOnly(on) {
      on = !!on;
      S.prefs.answerOnly = on; savePrefs();
      var lp = S.room && S.room.localParticipant;
      if (lp) {
        if (on) {
          Promise.resolve(lp.setCameraEnabled(false)).catch(function () {});
          Promise.resolve(lp.setMicrophoneEnabled(false)).catch(function () {});
        } else if (S.prefs.cameraOff !== true) {
          Promise.resolve(lp.setCameraEnabled(true)).catch(function () { say('Your camera could not start. You can still see and answer.'); }).then(function () { paintControls(); layout(); });
        }
      }
      applySubscriptions();
      if (S.room) {
        sayHello();
        showAudioGate(!S.room.canPlaybackAudio && !on);
      }
      say(on ? 'Answer-only: watch and listen on Zoom, answer here.' : 'You now see and hear the class on this device.');
      paintControls(); layout();
    }
    function setLowData(on, auto) {
      S.prefs.lowData = !!on; savePrefs();
      applySubscriptions();
      var lp = S.room && S.room.localParticipant;
      // Your own camera drops to the smallest picture too.
      if (lp && lp.isCameraEnabled && S.LK && S.LK.VideoPresets) {
        try {
          var pub = lp.getTrackPublication(S.LK.Track.Source.Camera);
          var pc = publishPlan('student', on).camera;
          if (pub && pub.videoTrack && pub.videoTrack.restartTrack) pub.videoTrack.restartTrack({ resolution: { width: pc.w, height: pc.h, frameRate: pc.fps } }).catch(function () {});
        } catch (e) {}
      }
      if (auto) say('Weak connection — low data is on, so the teacher’s screen and voice stay clear.');
      paintControls(); layout();
    }


    /* ---------- 🖥 sharing ONLY the worksheet (v1.208.0) ----------
       The teacher's browser is asked for THIS tab, and the capture is then
       narrowed to the worksheet itself (env.shareTarget(): #viewerArea):
         - Element Capture (`restrictTo`, Chrome/Edge 132+) sends the worksheet
           and NOTHING drawn over it — not this window, not the answers, not a
           menu — so a student never sees the teacher open the responses.
         - Region Capture (`cropTo`) where that is missing: the worksheet's
           rectangle, which still shows anything moved on top of it, so the
           teacher is told to keep this window off the page.
         - Otherwise the whole tab, said in words.
       The narrowing happens BEFORE the track is published, so not one frame
       of the whole tab ever reaches a student. */
    function limitShare(track, target) {
      if (!target) return Promise.resolve('whole');
      var crop = function () {
        if (!root.CropTarget || !track.cropTo) return 'whole';
        return root.CropTarget.fromElement(target).then(function (t) { return track.cropTo(t); }).then(function () { return 'crop'; }, function () { return 'whole'; });
      };
      if (root.RestrictionTarget && track.restrictTo) {
        return root.RestrictionTarget.fromElement(target).then(function (t) { return track.restrictTo(t); }).then(function () { return 'element'; }, crop);
      }
      return Promise.resolve(crop());
    }
    function startShare() {
      if (!isTeacher() || !S.room || S.shareTrack) return;
      var md = root.navigator && navigator.mediaDevices;
      if (!md || !md.getDisplayMedia) { say('This browser cannot share the screen.'); return; }
      var room = S.room, LK = S.LK;
      var target = typeof env.shareTarget === 'function' ? env.shareTarget() : null;
      if (target && root.document) document.body.classList.add('vcShareArea');
      // Asked inside the tap: the browser only allows a share from a press.
      md.getDisplayMedia(shareConstraints()).then(function (stream) {
        var track = stream.getVideoTracks()[0];
        if (!track) throw new Error('No picture came back from the share.');
        if (S.room !== room || !isTeacher()) { track.stop(); return; }
        try { track.contentHint = 'text'; } catch (e) {}
        return limitShare(track, target).then(function (how) {
          if (S.room !== room || !isTeacher()) { track.stop(); return; }
          S.shareHow = how;
          var opts = { source: LK.Track.Source.ScreenShare, name: 'worksheet', videoCodec: 'vp8', simulcast: true,
            degradationPreference: 'maintain-resolution', screenShareEncoding: { maxBitrate: SCREEN.bps, maxFramerate: SCREEN.fps } };
          if (LK.VideoPreset) opts.screenShareSimulcastLayers = [new LK.VideoPreset(SCREEN.low.w, SCREEN.low.h, SCREEN.low.bps, SCREEN.low.fps)];
          return room.localParticipant.publishTrack(track, opts).then(function () {
            S.shareTrack = track;
            S.sharing = true;
            track.addEventListener('ended', function () { if (S.shareTrack === track) stopShare(); });
            if (how === 'crop') say('Sharing the worksheet. This browser also shares whatever is moved over it, so keep this window to one side.');
            else if (how === 'whole') say(target ? 'Sharing the whole tab: choose “This tab” in Chrome or Edge to share only the worksheet.' : 'Sharing the screen.');
            paintControls(); layout();
          });
        }).catch(function (e) { try { track.stop(); } catch (x) {} throw e; });
      }).catch(function (e) {
        if (!S.shareTrack && root.document) document.body.classList.remove('vcShareArea');
        if (!/permission|notallowed|abort/i.test((e && (e.name + e.message)) || '')) say('Sharing: ' + ((e && e.message) || e));
      });
    }
    function stopShareTrack() {
      var t = S.shareTrack;
      S.shareTrack = null; S.sharing = false; S.shareHow = '';
      if (root.document) document.body.classList.remove('vcShareArea');
      if (!t) return;
      try { if (S.room && S.room.localParticipant) S.room.localParticipant.unpublishTrack(t); } catch (e) {}
      try { t.stop(); } catch (e) {}
    }
    function stopShare() { stopShareTrack(); paintControls(); layout(); }

    /* ---------- 📞 the Zoom room's sound (v1.212.0) ----------
       The teacher picks where Zoom's sound is: the Zoom WINDOW (Chrome asks
       inside the tap) or a sound INPUT (a loopback cable or a microphone).
       It goes through ONE gain (the duck) and a meter into a fresh track,
       published as the teacher's `zoom` screen-share audio — so it is never
       muted with the teacher's microphone and every child here receives it.
       The capture asks Chrome to leave this page's own sound out
       (restrictOwnAudio), so a child here is never sent back to themselves. */
    function zoomSupported() {
      var md = root.navigator && navigator.mediaDevices;
      return !!(md && (md.getDisplayMedia || md.getUserMedia) && (root.AudioContext || root.webkitAudioContext));
    }
    function startZoom(route, deviceId) {
      if (!isTeacher() || !S.room || !S.LK) { say('Start the class first, then bring Zoom in.'); return; }
      var md = root.navigator && navigator.mediaDevices;
      if (!md) { say('This browser cannot capture sound.'); return; }
      var room = S.room, LK = S.LK;
      var ask = zoomCaptureConstraints(route, deviceId);
      var seq = ++S.zoomSeq;
      S.zoomBusy = true; paintSide(true);
      // Asked inside the tap: the browser only lets a capture start from a press.
      var got = route === 'input' ? md.getUserMedia(ask) : md.getDisplayMedia(ask);
      Promise.resolve(got).then(function (stream) {
        var src = stream.getAudioTracks()[0];
        // A window share keeps its (tiny) picture only so Chrome keeps the
        // sound; it is never published.
        if (!src) {
          stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
          throw new Error(route === 'input' ? 'That input gave no sound.' : 'No sound came with that share. Tick “Also share window audio” (or system audio) and try again.');
        }
        if (seq !== S.zoomSeq || S.room !== room || !isTeacher()) { stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); return; }
        stopZoom(true);
        var Ctx = root.AudioContext || root.webkitAudioContext;
        var ctx = new Ctx({ latencyHint: 'interactive' });
        var input = ctx.createMediaStreamSource(new MediaStream([src]));
        var gain = ctx.createGain();
        var meter = ctx.createAnalyser();
        meter.fftSize = 512;
        var out = ctx.createMediaStreamDestination();
        input.connect(gain); gain.connect(meter); gain.connect(out);
        gain.gain.value = duckGain(false, 0, 0, S.prefs.zoomGain);
        var track = out.stream.getAudioTracks()[0];
        var z = { route: route, label: oneLine(src.label, 120), stream: stream, src: src, ctx: ctx, gain: gain, meter: meter, track: track,
          heldUntil: 0, talking: false, level: 0, timer: 0, buf: new Float32Array(meter.fftSize) };
        S.zoom = z;
        src.addEventListener('ended', function () { if (S.zoom === z) { stopZoom(); say('Zoom’s sound stopped (the share ended).'); } });
        if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(function () {});
        var opts = { source: LK.Track.Source.ScreenShareAudio, name: ZOOM.name, dtx: false, red: true, audioPreset: { maxBitrate: ZOOM.bps } };
        return room.localParticipant.publishTrack(track, opts).then(function () {
          if (S.zoom !== z) return;
          z.timer = setInterval(zoomMeterTick, ZOOM.meterMs);
          syncRecorder();
          var hint = route === 'input' ? loopbackHint(z.label) : null;
          say('📞 Zoom is in the class' + (z.label ? ' (' + z.label + ')' : '') + '.' + (hint && hint.kind !== 'loopback' ? ' ' + hint.note : ''));
        });
      }).catch(function (e) {
        if (seq === S.zoomSeq && !/permission|notallowed|abort/i.test((e && (e.name + e.message)) || '')) say('Zoom sound: ' + ((e && e.message) || e));
        if (seq === S.zoomSeq && S.zoom && !S.zoom.timer) stopZoom(true);
      }).then(function () {
        if (seq === S.zoomSeq) S.zoomBusy = false;
        paintControls(); paintSide(true);
      });
    }
    function stopZoom(quiet) {
      var z = S.zoom;
      S.zoom = null;
      if (!z) return;
      clearInterval(z.timer);
      try { if (S.room && S.room.localParticipant && z.track) S.room.localParticipant.unpublishTrack(z.track); } catch (e) {}
      try { z.track && z.track.stop(); } catch (e) {}
      try { z.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      try { z.ctx.close(); } catch (e) {}
      if (S.rec) { try { S.rec.setAudio('zoom', null); } catch (e) {} }
      if (!quiet) { paintControls(); paintSide(true); }
    }
    // Every tick: the meter, and the duck decided by `duckGain` from who is
    // speaking here (LiveKit's own active-speaker list, `zoomSpeakers`).
    function zoomMeterTick() {
      var z = S.zoom;
      if (!z) return;
      try { z.meter.getFloatTimeDomainData(z.buf); z.level = rmsLevel(z.buf); } catch (e) { z.level = 0; }
      var g = S.prefs.zoomDuck === false ? duckGain(false, 0, 0, S.prefs.zoomGain) : duckGain(z.talking, now(), z.heldUntil, S.prefs.zoomGain);
      try { z.gain.gain.setTargetAtTime(g, z.ctx.currentTime, 0.08); } catch (e) { try { z.gain.gain.value = g; } catch (x) {} }
      if (S.zoomBar) S.zoomBar.style.width = Math.round(Math.min(1, z.level * 4) * 100) + '%';
      if (S.zoomDuckNote) S.zoomDuckNote.textContent = g < (S.prefs.zoomGain == null ? 1 : S.prefs.zoomGain) ? '↓ turned down while a child here speaks' : '';
    }
    function zoomSpeakers(ids) {
      var z = S.zoom;
      if (!z) return;
      var talking = Object.keys(ids || {}).some(function (id) { return roleOfIdentity(id) === 'student'; });
      if (z.talking && !talking) z.heldUntil = now() + ZOOM.duckHoldMs;
      z.talking = talking;
    }
    function zoomInputs() {
      var md = root.navigator && navigator.mediaDevices;
      if (!md || !md.enumerateDevices) return Promise.resolve([]);
      return md.enumerateDevices().then(function (list) {
        return (list || []).filter(function (d) { return d.kind === 'audioinput'; }).map(function (d, i) {
          return { id: d.deviceId, label: d.label || ('Sound input ' + (i + 1)) , named: !!d.label };
        });
      }, function () { return []; });
    }

    /* ---------- 📞 the Zoom panel: the feed, the volume and the guide ---------- */
    function paintZoom(box) {
      var z = S.zoom;
      box.appendChild(el('h4', 'vcZoomH', '📞 Zoom hybrid'));
      box.appendChild(el('p', 'vcMuted', 'Children in a Zoom meeting take the same class: they hear the children here, you hear them, and they answer the pop-ups on a phone.'));
      var card = el('div', 'vcCard vcZoomCard');
      if (!zoomSupported()) {
        card.appendChild(el('p', 'vcMsg', 'This browser cannot capture sound. Use Chrome or Edge on a computer.'));
        box.appendChild(card);
      } else if (z) {
        card.appendChild(el('p', 'vcZoomLive', '🟢 Zoom’s sound is in the class'));
        if (z.label) card.appendChild(el('p', 'vcMuted', 'From: ' + z.label));
        var meter = el('div', 'vcZoomMeter');
        S.zoomBar = el('div', 'vcZoomLevel');
        meter.appendChild(S.zoomBar);
        card.appendChild(meter);
        S.zoomDuckNote = el('p', 'vcMuted vcZoomDuck', '');
        card.appendChild(S.zoomDuckNote);
        var volRow = el('label', 'vcZoomRow');
        volRow.appendChild(el('span', '', 'Volume'));
        var vol = el('input');
        vol.type = 'range'; vol.min = '0'; vol.max = '200'; vol.step = '5';
        vol.value = String(Math.round((S.prefs.zoomGain == null ? 1 : S.prefs.zoomGain) * 100));
        vol.setAttribute('aria-label', 'Zoom volume');
        var volText = el('span', 'vcMuted', vol.value + '%');
        vol.addEventListener('input', function () { S.prefs.zoomGain = Number(vol.value) / 100; volText.textContent = vol.value + '%'; savePrefs(); });
        volRow.appendChild(vol); volRow.appendChild(volText);
        card.appendChild(volRow);
        var duckRow = el('label', 'vcZoomRow');
        var duck = el('input'); duck.type = 'checkbox'; duck.checked = S.prefs.zoomDuck !== false;
        duck.addEventListener('change', function () { S.prefs.zoomDuck = !!duck.checked; savePrefs(); });
        duckRow.appendChild(duck);
        duckRow.appendChild(el('span', '', 'Turn Zoom down while a child here is speaking (stops double-talk)'));
        card.appendChild(duckRow);
        if (z.route === 'input') { var h = loopbackHint(z.label); card.appendChild(el('p', 'vcZoomHint ' + h.kind, h.note)); }
        card.appendChild(btn('vcDanger', '⏹ Stop Zoom sound', 'Take the Zoom room out of the class', function () { stopZoom(); }));
        box.appendChild(card);
      } else {
        S.zoomBar = null; S.zoomDuckNote = null;
        var canWin = !!(root.navigator && navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
        if (canWin) card.appendChild(btn('vcPrimary', S.zoomBusy ? 'Waiting for your pick…' : '🪟 Pick the Zoom window', 'Chrome asks which window: choose Zoom, with its sound on', function () { startZoom('display'); }));
        card.appendChild(el('p', 'vcMuted', 'or bring it in from a sound input:'));
        var row = el('div', 'vcZoomRow');
        var sel = el('select', 'vcSelect');
        sel.setAttribute('aria-label', 'Sound input with Zoom in it');
        sel.appendChild(new Option('Loading inputs…', ''));
        var hint = el('p', 'vcZoomHint', '');
        var use = btn('', '🎚 Use this input', 'Bring the Zoom room in from this input', function () { startZoom('input', sel.value); });
        use.disabled = true;
        sel.addEventListener('change', function () {
          var o = sel.options[sel.selectedIndex];
          var h = loopbackHint(o ? o.textContent : '');
          hint.className = 'vcZoomHint ' + h.kind; hint.textContent = h.note;
          use.disabled = !sel.value;
        });
        row.appendChild(sel); row.appendChild(use);
        card.appendChild(row);
        card.appendChild(hint);
        zoomInputs().then(function (list) {
          clear(sel);
          if (!list.length) { sel.appendChild(new Option('No sound inputs found', '')); return; }
          list.forEach(function (d) { sel.appendChild(new Option(d.label, d.id)); });
          var best = list.filter(function (d) { return loopbackHint(d.label).kind === 'loopback'; })[0];
          if (best) sel.value = best.id;
          sel.dispatchEvent(new Event('change'));
        });
        if (!S.room) card.appendChild(el('p', 'vcMsg', 'Start the class first.'));
        box.appendChild(card);
      }
      // The Zoom children's own links.
      var links = el('div', 'vcCard');
      links.appendChild(el('h4', 'vcZoomH', '📱 The Zoom children'));
      links.appendChild(el('p', 'vcMuted', 'Each child opens their 📱 Zoom link on a phone. It knows their name, takes no camera or sound, and only shows your questions: they watch and listen on Zoom. Their answers count like everyone else’s.'));
      var zoomKids = presentStudents().filter(function (id) { var p = S.session.people[id]; return p && p.via === 'zoom'; })
        .map(function (id) { return S.session.people[id].name; });
      links.appendChild(el('p', 'vcMsg', zoomKids.length ? 'Answering from Zoom now: ' + zoomKids.join(', ') : 'No Zoom child has joined yet.'));
      links.appendChild(btn('', '🔗 Links & PINs', 'Every child’s link, with a 📱 Zoom link for each', function () { openPasses(); }));
      box.appendChild(links);
      // The guide.
      var g = el('div', 'vcCard vcZoomGuide');
      g.appendChild(el('h4', 'vcZoomH', '🧭 Setting it up'));
      var which = S.zoomGuide || guideFor(root.navigator && (navigator.userAgentData && navigator.userAgentData.platform || navigator.platform));
      var tabs = el('div', 'vcSeg');
      ['mac', 'windows'].forEach(function (k) {
        var b = btn('vcSegBtn' + (which === k ? ' on' : ''), ZOOM_GUIDE[k].title, null, function () { S.zoomGuide = k; paintSide(); });
        b.setAttribute('aria-pressed', which === k ? 'true' : 'false');
        tabs.appendChild(b);
      });
      g.appendChild(tabs);
      var ol = el('ol', 'vcZoomSteps');
      ZOOM_GUIDE[which].steps.forEach(function (t) { ol.appendChild(el('li', '', t)); });
      g.appendChild(ol);
      box.appendChild(g);
    }

    /* ---------- 🚪 the lesson-time door ---------- */
    function letIn() {
      if (!isTeacher()) return;
      call('letin', { on: true }).then(function (res) {
        S.door = res.gate ? Object.assign({}, res.gate, { skew: Number(res.gate.now) ? Number(res.gate.now) - now() : 0 }) : { open: true };
        say('Students can join now.');
        paintControls();
      }, function (e) { say((e && e.message) || 'Could not let students in.'); });
    }

    /* ---------- 📼 recording the class (live-class-record.js does the work) ---------- */
    function fmtRecClock(ms) {
      var sec = Math.floor(ms / 1000), h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), r = sec % 60;
      return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(r).padStart(2, '0');
    }
    function startRecording() {
      if (!isTeacher() || !S.room || S.rec || S.recStarting || !env.recorder || typeof env.recorder.start !== 'function') return;
      S.recStarting = true;
      var room = S.room;
      Promise.resolve(env.recorder.start({ uid: typeof env.teacherUid === 'function' ? env.teacherUid() : '', epoch: S.epoch, slot: S.slot, slotLabel: S.slotLabel || '' }))
        .then(function (h) {
          S.recStarting = false;
          if (!h) return;
          if (S.room !== room || !isTeacher()) { h.stop(); return; }
          S.rec = h;
          syncRecorder(); paintControls();
        }, function (e) {
          S.recStarting = false;
          say('The class is not being recorded: ' + ((e && e.message) || e));
          paintControls();
        });
    }
    function stopRecording(tell) {
      var h = S.rec;
      S.rec = null; S.recKeys = {};
      if (!h) return;
      h.stop();
      if (tell) say('Recording stopped. It is finishing its upload in the background — you can carry on.');
      paintControls();
    }
    // Every picture and voice the recording should hold, asked afresh each
    // time (a restarted camera or microphone is a new track).
    function syncRecorder() {
      var h = S.rec;
      if (!h || !S.room || !S.LK) return;
      var T = S.LK.Track.Source, lp = S.room.localParticipant;
      var trackOf = function (pub, muted) { return pub && pub.track && !(muted && pub.isMuted) ? pub.track.mediaStreamTrack : null; };
      try {
        h.setVideo('camera', trackOf(lp.getTrackPublication(T.Camera), true));
        h.setVideo('screen', S.shareTrack || trackOf(lp.getTrackPublication(T.ScreenShare), false));
        h.setAudio('self', trackOf(lp.getTrackPublication(T.Microphone), false));
        h.setAudio('zoom', S.zoom && S.zoom.track ? S.zoom.track : null);
        var keys = {};
        S.room.remoteParticipants.forEach(function (p) {
          var a = p.getTrackPublication(T.Microphone);
          var t = a && a.isSubscribed ? trackOf(a, false) : null;
          if (t) { keys[p.identity] = true; h.setAudio(p.identity, t); }
        });
        Object.keys(S.recKeys || {}).forEach(function (k) { if (!keys[k]) h.setAudio(k, null); });
        S.recKeys = keys;
        if (typeof env.currentDoc === 'function') h.noteDoc(env.currentDoc());
      } catch (e) {}
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
        syncRecorder();
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
      if (S.session && S.session.people[identity] && S.session.people[identity].via === 'zoom') t.el.classList.add('vcViaZoom');
      if (S.session && S.session.people[identity] && isAwayNow(cleanPerson(S.session.people[identity]))) t.el.classList.add('vcOutNow');
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
          t.badge.textContent = !q ? '' : e ? (markWord(mark) || '✎') : meantFor(q, id) ? '…' : '';
          // A provisional mark (the key's, or Chung GPT's) is drawn dashed
          // until the teacher gives it.
          t.badge.className = 'vcTileBadge' + (e ? mark === true ? ' ok' : mark === false ? ' no' : mark === 'partial' ? ' part' : ' in' : '') +
            (e && mark != null && confirmedOf(e) == null ? ' prov' : '');
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
        syncRecorder();
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
        if (answerOnlyHere()) S.mainEmpty.textContent = '📱 Answering from this phone. Watch and listen on Zoom — a question pops up here when your teacher sends one.';
        else if (tid) S.mainEmpty.textContent = S.prefs.lowData ? 'Low data is on — you can hear your teacher.' : 'Your teacher’s camera is off.';
      }
      S.main.classList.toggle('screen', !!screen);
      if (screen && cam) { put(S.pip, cam); S.pip.hidden = false; } else S.pip.hidden = true;
      if (selfCam && !S.prefs.hideSelf) put(S.self, selfCam);
      else if (selfCam && selfCam.parentNode) selfCam.remove();
      S.self.hidden = !selfCam || S.prefs.hideSelf;
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
        if (msg.t === 'hello') return onHello(from, msg);
        if (msg.t === 'a') return onAnswer(from, msg);
        if (msg.t === 'hand') return onHand(from, !!msg.up);
        if (msg.t === 'needimg') return onNeedImage(from, msg.ref);
        if (msg.t === 'focus') return onFocus(from, msg);
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
        if (waiting) {
          delete S.pendingPhotos[ref];
          send({ t: 'ack', aid: waiting.aid, qid: waiting.qid }, [waiting.identity]);
          var wq = questionById(waiting.qid);
          if (wq) queueAiMark(wq, waiting.identity);
        }
        paintSide(true);
      } else {
        paintQuestion();
      }
    }

    /* ---------- the teacher's side of the wire ---------- */
    function openQuestionsFor(identity) {
      return S.session.questions.filter(function (q) { return q.open && meantFor(q, identity); });
    }
    function onHello(identity, msg) {
      // 📱 A phone that only answers says so: the child is in the Zoom room.
      var via = msg && msg.zoom === true ? 'zoom' : '';
      var prevP = S.session.people[identity];
      if (prevP && (prevP.via || '') !== via) {
        S.session = personJoined(S.session, { identity: identity, via: via }, now());
        saveSoon(); paintSide();
        var tile = S.tiles[identity];
        if (tile && tile.el) tile.el.classList.toggle('vcViaZoom', via === 'zoom');
      }
      var qs = openQuestionsFor(identity);
      var mine = {};
      qs.forEach(function (q) {
        var e = (S.session.answers[q.id] || {})[identity];
        // Only a mark the teacher GAVE goes back on a rejoin: the key's own
        // guess stays on the teacher's board until it is given, exactly as on
        // the first send (the acknowledgement never carries it either).
        if (e) mine[q.id] = { aid: e.aid, ok: confirmedOf(e), pts: e.pts || 0 };
      });
      var revealed = S.session.questions.filter(function (q) { return q.revealed && meantFor(q, identity); }).slice(-3).map(function (q) {
        var e = (S.session.answers[q.id] || {})[identity];
        return { q: questionForStudent(q), answer: revealOf(q), mine: e ? { aid: e.aid, v: e.v, ok: confirmedOf(e), pts: e.pts || 0 } : null };
      });
      var chain = Promise.resolve();
      qs.forEach(function (q) { if (q.img && S.images[q.img.ref]) chain = chain.then(function () { return sendImage(S.images[q.img.ref], q.img.ref, [identity]); }); });
      chain.then(function () {
        send({ t: 'state', qs: qs.map(questionForStudent).filter(Boolean), mine: mine, revealed: revealed, hand: !!S.hands[identity] }, [identity]);
      });
    }
    // 📈 The child's device: how long the class screen has been hidden.
    function onFocus(identity, msg) {
      if (!S.session || !S.session.people[identity]) return;
      var next = personFocus(S.session, identity, msg, now());
      // 👀 v1.217.0: left / came back, the moment it happens.
      if (msg.out === true || msg.out === false) {
        var wasAway = isAwayNow(cleanPerson(next.people[identity]));
        next = personLeave(next, identity, msg, now());
        var p = cleanPerson(next.people[identity]);
        if (msg.out === true && !wasAway && msg.k !== 'photo' && S.mode === 'live') say('👀 ' + p.name + ' left the lesson screen.');
        markTileAway(identity, isAwayNow(p) && msg.k !== 'photo');
      }
      if (next === S.session) return;
      S.session = next;
      saveSoon();
      if (S.tab === 'people' || S.tab === 'answers' || S.tab === 'reports') paintSide(true);
    }
    function markTileAway(identity, on) {
      var tile = S.tiles && S.tiles[identity];
      if (tile && tile.el) tile.el.classList.toggle('vcOutNow', !!on);
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
        if (res.fresh) { var aq = questionById(msg.qid); if (aq) queueAiMark(aq, identity); }
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
      if (q.kind === 'cloze') return { text: q.model || clozeFull(q) };
      return q.model ? { text: q.model } : null;
    }
    function resendOpenQuestions() {
      if (!S.session) return;
      S.session.questions.filter(function (q) { return q.open; }).forEach(function (q) { pushQuestion(q, true); });
    }
    function teacherTick() {
      // Pictures that only partly arrived are dropped after a few minutes.
      S.assembler.sweep(5 * 60 * 1000);
      attendanceTick(false);
      syncRecorder();
      hiddenTick();
      // The lesson's time arrived: the door opened by itself.
      if (S.door && !S.door.open && Number(S.door.opensAt) && now() + (S.door.skew || 0) >= Number(S.door.opensAt)) { S.door = { open: true }; paintControls(); }
      else if (S.rec) paintControls();
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
        if (teacherIdentity()) sendTeacher(S.prefs.answerOnly ? { t: 'hello', zoom: true } : { t: 'hello' });
        if (++tries < 20) S.helloTimer = setTimeout(again, LIMITS.helloMs);
      })();
    }
    function studentTick() { flushOutbox(false); S.assembler.sweep(5 * 60 * 1000); focusTick(false); }
    /* ---------- 📈 focus (v1.216.0) ----------
       While the class is live, the time this device's class screen is
       hidden is added up and sent to the teacher's device every half
       minute and the moment the child comes back. A 📱 Zoom answer phone is
       expected to sit in the background, so it reports nothing. */
    function focusKey() { return FOCUS_PREFIX + (S.epoch || 0) + ':' + (S.identity || ''); }
    function focusLoad() {
      var f = readJson(session(), focusKey(), null);
      S.focus = { away: Math.max(0, Number(f && f.away) || 0), n: Math.max(0, Math.floor(Number(f && f.n) || 0)),
        log: (Array.isArray(f && f.log) ? f.log : []).filter(function (x) { return x && x.from > 0; }).slice(-LIMITS.leaveLog),
        awayAt: 0, kind: 'away', told: false, timer: 0, photoAt: 0, sentAt: 0, sent: -1 };
      // 👀 Told once, at the start: the deterrent is half the point.
      say('👀 Stay on this lesson screen — your teacher can see when you leave it.');
      focusChanged();
    }
    function focusSave() {
      var f = S.focus;
      if (f) writeJson(session(), focusKey(), { away: f.away, n: f.n, log: f.log.slice(-LIMITS.leaveLog) });
    }
    function focusAway() {
      var f = S.focus;
      if (!f) return 0;
      return f.away + (f.awayAt && f.told && f.kind === 'away' ? Math.max(0, now() - f.awayAt) : 0);
    }
    function focusTick(force) {
      if (S.role !== 'student' || S.mode !== 'live' || answerOnlyHere() || !S.focus) return;
      var away = focusAway();
      if (!force && now() - S.focus.sentAt < 30000) return;
      if (!force && away === S.focus.sent) return;
      S.focus.sentAt = now();
      S.focus.sent = away;
      sendTeacher({ t: 'focus', away: Math.round(away), n: S.focus.n });
    }
    // 👀 Away = this tab hidden (another tab or app, minimised, locked) OR
    // the browser window not the one in front (a click on another window).
    function domAway() {
      if (document.visibilityState === 'hidden') return true;
      try { if (typeof document.hasFocus === 'function' && !document.hasFocus()) return true; } catch (e) {}
      return false;
    }
    // "📷 Add a photo" opens the camera or the file picker: that is not leaving.
    function focusPhotoSoon() { if (S.focus) S.focus.photoAt = now(); }
    function focusChanged() {
      if (S.role !== 'student' || S.mode !== 'live' || !S.focus || answerOnlyHere()) return;
      var f = S.focus;
      if (domAway()) {
        if (f.awayAt) return;
        f.awayAt = now(); f.told = false;
        f.kind = f.photoAt && now() - f.photoAt < 15000 ? 'photo' : 'away';
        clearTimeout(f.timer);
        // A blip (a click on the address bar) is not leaving.
        f.timer = setTimeout(function () {
          if (!f.awayAt || !domAway() || S.focus !== f) return;
          f.told = true;
          if (f.kind === 'away') f.n += 1;
          f.log.push({ from: f.awayAt, to: 0, k: f.kind });
          f.log = f.log.slice(-LIMITS.leaveLog);
          focusSave();
          sendTeacher({ t: 'focus', out: true, k: f.kind, away: Math.round(focusAway()), n: f.n });
        }, LEAVE_MIN_MS);
        return;
      }
      if (!f.awayAt) return;
      clearTimeout(f.timer);
      var ms = now() - f.awayAt;
      var wasTold = f.told;
      if (ms >= LEAVE_MIN_MS) {
        if (!wasTold) { if (f.kind === 'away') f.n += 1; f.log.push({ from: f.awayAt, to: 0, k: f.kind }); }
        var last = f.log[f.log.length - 1];
        if (last && !last.to) last.to = now();
        if (f.kind === 'away') f.away += ms;
        f.awayAt = 0; f.told = false; f.photoAt = 0;
        focusSave();
        sendTeacher({ t: 'focus', out: false, ms: Math.round(ms), k: last ? last.k : 'away', away: Math.round(f.away), n: f.n });
        f.sentAt = now(); f.sent = f.away;
      } else {
        f.awayAt = 0; f.told = false;
      }
    }
    function flushOutbox(force) {
      if (S.mode !== 'live' || !teacherIdentity()) return;
      var due = outboxDue(S.outbox, force ? Infinity : now(), LIMITS.resendMs);
      if (!due.length) return;
      due.forEach(function (e) {
        e.sentAt = now();
        e.tries = (e.tries || 0) + 1;
        var chain = Promise.resolve();
        if (e.ph && e.photo && (e.tries === 1 || e.tries % 3 === 0 || force)) chain = chain.then(function () { return sendImage(e.photo, e.ph, [teacherIdentity()]); });
        chain.then(function () { return sendTeacher({ t: 'a', aid: e.aid, qid: e.qid, v: e.v, ph: e.ph || undefined, at: e.at, out: e.out || undefined }); });
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
      if (!S.qGot) S.qGot = {};
      if (!S.qGot[q.id]) S.qGot[q.id] = now();
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
        if (!have.aid || have.aid === m.aid) S.mine[qid] = Object.assign({}, have, { aid: m.aid, sent: true, acked: true, ok: cleanMark(m.ok), pts: m.pts });
        S.outbox = outboxAck(S.outbox, m.aid);
      });
      (Array.isArray(msg.revealed) ? msg.revealed : []).forEach(function (r) {
        var q = r && cleanQuestion(r.q); if (!q) return;
        q.open = false; q.revealed = r.answer || null;
        S.questions[q.id] = Object.assign({}, S.questions[q.id] || {}, q);
        if (S.order.indexOf(q.id) === -1) S.order.push(q.id);
        if (r.mine) S.mine[q.id] = Object.assign({}, S.mine[q.id] || {}, { aid: r.mine.aid, v: r.mine.v, sent: true, acked: true, ok: cleanMark(r.mine.ok), pts: r.mine.pts });
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
      // The teacher's own mark only — ✓, ◐ (partly right) or ✗; null takes it off.
      if (msg.ok === null) m.ok = null; else if (cleanMark(msg.ok) != null) m.ok = cleanMark(msg.ok);
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
      // The newest question that is open, or closed with news for this
      // student (a reveal, a mark) they have not tapped OK on. An older
      // question left open no longer hides the answer to a newer one (v1.215.0).
      for (var i = S.order.length - 1; i >= 0; i--) {
        var q = S.questions[S.order[i]];
        if (!q) continue;
        if (q.open) return q;
        if ((q.revealed || (S.mine[q.id] && (S.mine[q.id].ok != null))) && !q.dismissed) return q;
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
      } else if (q.kind === 'cloze') {
        // 🔤 The sentence with its gaps: one box per missing keyword.
        var words = Array.isArray(draft.v) ? draft.v.slice() : [];
        draft.v = words;
        var sentence = el('div', 'vcCloze');
        var boxes = [];
        (q.parts || []).forEach(function (p) {
          if (typeof p !== 'number') { sentence.appendChild(el('span', 'vcClozeText', String(p))); return; }
          var gap = el('input', 'vcGap');
          gap.type = 'text';
          gap.value = words[p] != null ? String(words[p]) : '';
          gap.maxLength = LIMITS.gapChars;
          gap.size = Math.max(6, Math.min(18, gap.value.length + 2));
          gap.disabled = closed;
          gap.autocomplete = 'off';
          gap.setAttribute('autocorrect', 'off');
          gap.setAttribute('aria-label', 'Missing word ' + (p + 1));
          gap.placeholder = String(p + 1);
          gap.addEventListener('input', function () {
            words[p] = gap.value; draft.v = words; mine.dirty = true;
            gap.size = Math.max(6, Math.min(18, gap.value.length + 2));
            syncCloze();
          });
          gap.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            var at = boxes.indexOf(gap);
            if (at >= 0 && at < boxes.length - 1) boxes[at + 1].focus(); else sendCloze.click();
          });
          boxes.push(gap);
          sentence.appendChild(gap);
        });
        body.appendChild(sentence);
        var cTools = el('div', 'vcOpenTools');
        cTools.appendChild(el('span', 'vcMuted', 'Fill in the missing words, then press Send.'));
        cTools.appendChild(el('span', 'vcBarGap'));
        var sendCloze = btn('vcPrimary', mine.sent && !mine.dirty ? 'Send again' : 'Send', null, function () {
          if (closed) return;
          draft.v = boxes.map(function (b) { return b.value; });
          if (!draft.v.some(function (w) { return oneLine(w, 5); })) return;
          submit(q, draft);
        });
        cTools.appendChild(sendCloze);
        body.appendChild(cTools);
        var syncCloze = function () { sendCloze.disabled = closed || !boxes.some(function (b) { return oneLine(b.value, 5); }); };
        syncCloze();
        if (!closed && !mine.sent && boxes[0]) setTimeout(function () { try { boxes[0].focus({ preventScroll: true }); } catch (e) {} }, 30);
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
          tools.appendChild(btn('', draft.photo ? '📷 Change photo' : '📷 Add a photo of my working', 'Take or choose a photo', function () { if (!closed) { focusPhotoSoon(); file.click(); } }));
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
      if (mine.ok === 'partial') { status.classList.add('part'); text = '◐ Partly right.' + (mine.pts ? ' ⭐ +' + mine.pts : '') + (q.revealed && q.revealed.text ? ' Answer: ' + q.revealed.text : ' Your teacher will go through it.'); }
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
      // 👀 Did they leave the lesson while this question was open?
      var out = S.focus ? outForAnswer(S.focus.log, (S.qGot && S.qGot[q.id]) || q.at || 0, entry.at) : null;
      if (out) entry.out = out;
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
      { id: 'reports', icon: '🧾', label: 'Reports' },
      { id: 'zoom', icon: '📞', label: 'Zoom' }
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
      var tab = S.mode === 'ended' && (S.tab === 'ask' || S.tab === 'people' || S.tab === 'zoom') ? 'reports' : S.tab;
      if (tab === 'ask') paintAsk(S.sideBody);
      else if (tab === 'answers') paintAnswers(S.sideBody);
      else if (tab === 'people') paintPeople(S.sideBody);
      else if (tab === 'zoom') paintZoom(S.sideBody);
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
        if (S.mode === 'ended' && (t.id === 'ask' || t.id === 'people' || t.id === 'zoom')) return;
        var badge = '';
        if (t.id === 'answers' && (waitingNow || unmarked)) badge = waitingNow ? '⏳' + waitingNow : '•' + unmarked;
        if (t.id === 'people') badge = (hands ? '✋' + hands + ' ' : '') + here;
        if (t.id === 'zoom' && S.zoom) badge = '●';
        var b = btn('vcTab' + (S.tab === t.id ? ' on' : ''), t.icon + ' ' + t.label, null, function () { S.tab = t.id; paintSide(); });
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', S.tab === t.id ? 'true' : 'false');
        if (badge) b.appendChild(el('span', 'vcBadge', badge));
        S.sideTabs.appendChild(b);
      });
    }

    /* ---------- ❓ Ask: build a question and push it ---------- */
    function blankCompose(kind) {
      return { kind: kind || 'mcq', text: '', options: ['', '', '', ''], answer: -1, accepted: '', model: '', photo: true, img: '', to: 'all', pick: {}, gapPick: {}, hideModel: false, keyFrom: '' };
    }
    /* ---------- ✨ AI send: drag over a question, Chung GPT reads and pushes it ----------
       The teacher drags a box round a question on the worksheet (the glue's
       env.cropQuestion: the 📸 Snip layer, painted from the page itself, so
       the window over it does not matter). env.readQuestion sends that
       picture to the AI with the answer key for the page when one is loaded,
       and gets DATA back — the kind (MCQ / fill in the blank / open-ended),
       the words, the options, the answer. questionFromAi is the one door to
       the composer's shape, and sendQuestion → cleanQuestion still guards the
       push: the answer stays on the teacher's device as for any question.
       With "check it first" on it lands in the composer instead. */
    function aiSendReady() { return typeof env.cropQuestion === 'function' && typeof env.readQuestion === 'function'; }
    function aiSendStart() {
      if (!isTeacher() || S.mode !== 'live' || S.aiSend || !aiSendReady()) return;
      var epoch = S.session && S.session.epoch;
      var to = S.compose ? S.compose.to : 'all', pick = S.compose ? Object.assign({}, S.compose.pick) : {};
      S.aiSend = 'crop';
      paintSide(true);
      var still = function () { return isTeacher() && S.mode === 'live' && S.session && S.session.epoch === epoch; };
      Promise.resolve().then(function () { return env.cropQuestion(); }).then(function (img) {
        if (!still() || !img) return null;
        if (!validImage(img)) throw new Error('That part of the page is too big to send — drag a smaller box.');
        S.aiSend = 'read';
        S.aiSendImg = img;
        paintSide(true);
        return Promise.resolve(env.readQuestion({ img: img })).then(function (raw) {
          if (!still()) return null;
          var got = questionFromAi(raw);
          if (!got) throw new Error(aiName() + ' could not find a question in that box. Drag round the whole question, or type it.');
          var c = Object.assign(blankCompose(got.kind), got, { img: img, to: to, pick: pick, ai: true });
          if (got.kind === 'mcq') while (c.options.length < 2) c.options.push('');
          if (S.prefs.aiReview) {
            S.compose = c;
            S.tab = 'ask';
            say('✨ Read as ' + KIND_LABEL[c.kind] + '. Check it, then press 📤 Push.');
            return null;
          }
          sendQuestion(c, false);
          var key = c.kind === 'mcq' ? (c.answer >= 0 ? ' The key says ' + letter(c.answer) + '.' : ' No answer was found — mark by hand, or tap ✓ on the right option.')
            : c.kind === 'blank' ? (c.accepted ? ' Accepted: ' + c.accepted.split('\n').join(', ') + '.' : '') : '';
          say('✨ Sent as ' + KIND_LABEL[c.kind] + '.' + key + (got.note ? ' (' + got.note + ')' : ''));
          return null;
        });
      }).catch(function (e) {
        say('✨ AI send: ' + ((e && e.message) || e));
      }).then(function () {
        S.aiSend = '';
        S.aiSendImg = '';
        paintSide(true);
      });
    }
    function paintAiSend(card) {
      if (!aiSendReady()) return;
      var row = el('div', 'vcAiSend');
      var label = S.aiSend === 'crop' ? '⬚ Drag a box round the question on the worksheet…'
        : S.aiSend === 'read' ? '✨ ' + aiName() + ' is reading the question…'
        : '✨ AI send';
      var go = btn('vcPrimary vcAiSendBtn', label, 'Drag a box round a question on the worksheet: ' + aiName() + ' reads it, works out whether it is multiple choice, fill in the blank or open-ended, and pushes it to the class', aiSendStart);
      go.disabled = !!S.aiSend || S.mode !== 'live';
      row.appendChild(go);
      if (S.aiSend === 'read' && S.aiSendImg) {
        var th = el('img', 'vcThumb vcAiSendShot'); th.src = S.aiSendImg; th.alt = 'The question being read';
        row.appendChild(th);
      }
      var opts = el('div', 'vcAiOpts');
      var review = el('label', 'vcCheck');
      var rBox = el('input'); rBox.type = 'checkbox'; rBox.checked = !!S.prefs.aiReview;
      rBox.addEventListener('change', function () { S.prefs.aiReview = rBox.checked; savePrefs(); });
      review.appendChild(rBox); review.appendChild(el('span', null, 'Let me check it before it goes out'));
      opts.appendChild(review);
      if (typeof env.aiMark === 'function') {
        var pm = el('label', 'vcCheck');
        var pBox = el('input'); pBox.type = 'checkbox'; pBox.checked = S.prefs.aiMark !== false;
        pBox.addEventListener('change', function () { S.prefs.aiMark = pBox.checked; savePrefs(); paintSide(true); });
        pm.appendChild(pBox); pm.appendChild(el('span', null, aiName() + ' pre-marks written answers (you confirm)'));
        opts.appendChild(pm);
      }
      row.appendChild(opts);
      card.appendChild(row);
    }
    function paintAsk(box) {
      var c = S.compose || (S.compose = blankCompose(S.prefs.lastKind));
      var card = el('div', 'vcAsk');
      paintAiSend(card);
      paintHidden(card);

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
      qLab.appendChild(el('span', null, c.kind === 'blank' ? 'Question (use ___ for the blank)' : c.kind === 'cloze' ? 'Question (shown above the sentence with the gaps)' : 'Question'));
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
      } else if (c.kind === 'cloze') {
        paintClozeFields(card, c, function () { syncSend(); });
      } else if (c.hideModel && c.model) {
        // 🔒 The AI's answer came from the hidden answers: it marks, it is
        // shown when the teacher presses 💡, and it stays covered here so a
        // screen the class can see never shows it by accident.
        var hid = el('div', 'vcHiddenModel');
        hid.appendChild(el('span', null, '🔒 The AI answer is kept hidden — it is used to mark, and shown only when you press 💡 Show the answer.'));
        hid.appendChild(btn('vcChip', '👁 Show it to me', 'Show the hidden answer here (only on this screen)', function () { c.hideModel = false; paintSide(); }));
        card.appendChild(hid);
        var ph0 = el('label', 'vcCheck');
        var ph0Box = el('input'); ph0Box.type = 'checkbox'; ph0Box.checked = c.photo !== false;
        ph0Box.addEventListener('change', function () { c.photo = ph0Box.checked; });
        ph0.appendChild(ph0Box); ph0.appendChild(el('span', null, 'Students may add a photo of their working'));
        card.appendChild(ph0);
      } else {
        var mLab = el('label', 'vcField');
        mLab.appendChild(el('span', null, 'Model answer (optional — marks the answers, and is shown when you reveal)'));
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
      if (c.ai) foot.appendChild(el('span', 'vcMuted', '✨ read by ' + aiName() + ' — check the answer'));
      card.appendChild(foot);
      function syncSend() {
        var ok = !!(oneLine(c.text, 10) || c.img);
        if (c.kind === 'mcq') ok = ok && c.options.filter(function (o) { return oneLine(o, 5); }).length >= 2;
        if (c.kind === 'cloze') ok = !!clozeFrom(c.model, c.gapPick);
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

    /* ---------- 🔤 Fill in the keywords: tap the words to blank out ---------- */
    function paintClozeFields(card, c, changed) {
      var aLab = el('label', 'vcField');
      aLab.appendChild(el('span', null, 'The full answer (the AI’s, or type your own)'));
      var full = el('textarea'); full.rows = 3; full.value = c.model;
      full.placeholder = 'e.g. Plants make their own food by photosynthesis, using light energy from the Sun.';
      full.addEventListener('input', function () { c.model = full.value; c.gapPick = {}; changed(); });
      // The chips are redrawn when the teacher leaves the box (not on every
      // key, which would take the cursor away mid-word).
      full.addEventListener('change', function () { paintSide(); });
      aLab.appendChild(full);
      card.appendChild(aLab);
      var toks = clozeTokens(c.model);
      if (!toks.some(function (t) { return t.word; })) {
        card.appendChild(el('p', 'vcHint', 'Type or fetch the answer first, then tap the words the student must fill in.'));
        return;
      }
      card.appendChild(el('span', 'vcMuted', 'Tap the keywords to blank out (' + aiName() + '’s suggestions are lit). Words side by side make one blank.'));
      var chips = el('div', 'vcWordChips');
      toks.forEach(function (tk, i) {
        if (tk.space) { if (/\n/.test(tk.t)) chips.appendChild(el('span', 'vcWordBreak')); return; }
        if (!tk.word) { chips.appendChild(el('span', 'vcWordPunct', tk.t)); return; }
        var on = !!c.gapPick[i];
        var b = btn('vcWord' + (on ? ' on' : ''), tk.t, on ? 'Put this word back' : 'Blank out this word', function () {
          if (c.gapPick[i]) delete c.gapPick[i]; else c.gapPick[i] = true;
          paintSide();
        });
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        chips.appendChild(b);
      });
      card.appendChild(chips);
      var cz = clozeFrom(c.model, c.gapPick);
      var prev = el('div', 'vcClozePreview');
      prev.appendChild(el('b', null, 'The student sees: '));
      if (cz) {
        cz.parts.forEach(function (p) { prev.appendChild(typeof p === 'number' ? el('span', 'vcGapShow', String(p + 1)) : el('span', null, p)); });
        if (cz.keys.length >= LIMITS.gaps) prev.appendChild(el('span', 'vcMuted', ' (at most ' + LIMITS.gaps + ' blanks)'));
      } else {
        prev.appendChild(el('span', 'vcMuted', 'no blanks yet — tap a word above.'));
      }
      card.appendChild(prev);
      card.appendChild(el('p', 'vcHint', 'An answer with the same word is ✓ at once; a different word that means the same is judged by ' + aiName() + ' (you confirm or change the mark).'));
    }

    /* ---------- 🔒 Hidden answers: the whole worksheet, worked out in the background ---------- */
    function hiddenKey() { return env.hiddenKey && typeof env.hiddenKey.state === 'function' ? env.hiddenKey : null; }
    function hiddenAuto() { return S.prefs.keyAuto !== false; }
    // Called from the teacher's tick: a worksheet open with nothing worked
    // out yet starts by itself (once per worksheet), unless switched off.
    function hiddenTick() {
      var hk = hiddenKey();
      if (!hk || !isTeacher() || S.mode !== 'live' || !hiddenAuto() || typeof hk.ensure !== 'function') return;
      try { hk.ensure(); } catch (e) {}
    }
    function useKeyItem(item, form) {
      var made = keyItemCompose(item, form);
      if (!made) return;
      var c = S.compose || blankCompose();
      S.compose = Object.assign(blankCompose(made.kind), made, { to: c.to, pick: c.pick });
      S.tab = 'ask';
      S.keyOpen = false;
      paintSide();
      say(form === 'cloze' ? '🔤 Tap the keywords to blank out, then press 📤 Push.' : form === 'open' ? '✍️ Ready as a blank open-ended question — the AI answer stays hidden. Press 📤 Push.' : 'Ready — check it, then press 📤 Push.');
    }
    function paintHidden(card) {
      var hk = hiddenKey();
      if (!hk || !isTeacher()) return;
      if (!S.keyWired && typeof hk.onChange === 'function') {
        S.keyWired = true;
        hk.onChange(function () { if (S.role === 'teacher' && S.tab === 'ask') paintSide(true); });
      }
      var st = hk.state() || {};
      var items = cleanKeyItems(st.items);
      var box = el('div', 'vcHidden');
      var top = el('div', 'vcHiddenTop');
      var word = st.status === 'running' ? '🔒 Working out the answers… ' + (st.total ? (st.done || 0) + ' of ' + st.total + ' pages' : '')
        : st.status === 'ready' ? '🔒 Hidden answers ready · ' + items.length + ' question' + (items.length === 1 ? '' : 's')
        : st.status === 'failed' ? '🔒 The answers could not be worked out' + (st.error ? ': ' + st.error : '')
        : !st.docId ? '🔒 Open a worksheet to work out its answers' : '🔒 Hidden answers';
      var head = btn('vcHiddenHead', word + (items.length ? (S.keyOpen ? ' ▴' : ' ▾') : ''), 'Every question on the worksheet, worked out by ' + aiName() + ' and kept off the shared screen', function () { S.keyOpen = !S.keyOpen; paintSide(true); });
      top.appendChild(head);
      if (st.docId && st.status !== 'running') {
        top.appendChild(btn('vcChip', st.status === 'ready' ? '↻ Again' : '✨ Work out all answers', st.status === 'ready' ? 'Work every answer out again' : 'Have ' + aiName() + ' answer every question on this worksheet now, in the background', function () {
          Promise.resolve(hk.build(st.status === 'ready')).catch(function (e) { say('🔒 ' + ((e && e.message) || e)); });
          paintSide(true);
        }));
      }
      box.appendChild(top);
      if (st.status === 'failed' && st.failed && st.failed.length) box.appendChild(el('p', 'vcHint', 'Page' + (st.failed.length === 1 ? ' ' : 's ') + st.failed.join(', ') + ' could not be read.'));
      if (S.keyOpen && items.length) {
        box.appendChild(el('p', 'vcHint', 'Answers stay covered. ✍️ Blank sends the question for the student to answer in full; 🔤 Keywords lets you pick words of the answer to blank out.'));
        var list = el('div', 'vcHiddenList');
        S.keyPeek = S.keyPeek || {};
        items.forEach(function (it) {
          var row = el('div', 'vcHiddenRow');
          var line = el('div', 'vcHiddenQ');
          line.appendChild(el('b', null, 'Q' + (it.number || '?') + (it.page ? ' · p' + it.page : '')));
          line.appendChild(el('span', 'vcHiddenText', it.question || '(question on the worksheet)'));
          row.appendChild(line);
          if (S.keyPeek[it.id]) {
            var shown = it.kind === 'mcq' && it.option ? '(' + it.option + ') ' + it.answer : (it.model || it.answer);
            row.appendChild(el('p', 'vcHiddenAns', shown));
          }
          var acts = el('div', 'vcHiddenActs');
          acts.appendChild(btn('vcChip', S.keyPeek[it.id] ? '🙈 Hide' : '👁 Peek', S.keyPeek[it.id] ? 'Cover the answer again' : 'Show this answer on THIS screen only', function () {
            if (S.keyPeek[it.id]) delete S.keyPeek[it.id]; else S.keyPeek[it.id] = true;
            paintSide(true);
          }));
          if (it.kind !== 'mcq') {
            acts.appendChild(btn('vcChip', '✍️ Blank', 'Send it fully blank: the student writes the whole answer', function () { useKeyItem(it, 'open'); }));
            acts.appendChild(btn('vcChip', '🔤 Keywords', 'Send the answer with a few keywords blanked out for the student to fill in', function () { useKeyItem(it, 'cloze'); }));
          }
          if (it.kind === 'mcq' || it.kind === 'blank') acts.appendChild(btn('vcChip', it.kind === 'mcq' ? '🅰 As MCQ' : '▭ Short blank', 'Send it the way it is printed, marked by the key', function () { useKeyItem(it, 'asis'); }));
          row.appendChild(acts);
          list.appendChild(row);
        });
        box.appendChild(list);
      }
      var auto = el('label', 'vcCheck');
      var aBox = el('input'); aBox.type = 'checkbox'; aBox.checked = hiddenAuto();
      aBox.addEventListener('change', function () { S.prefs.keyAuto = aBox.checked; savePrefs(); if (aBox.checked) hiddenTick(); });
      auto.appendChild(aBox); auto.appendChild(el('span', null, 'Work out the answers by itself when a worksheet is open in class'));
      box.appendChild(auto);
      card.appendChild(box);
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
      var cz = c.kind === 'cloze' ? clozeFrom(c.model, c.gapPick) : null;
      if (c.kind === 'cloze' && !cz) { say('Tap at least one word of the answer to blank it out.'); return; }
      var q = cleanQuestion({
        id: randomId('q'), kind: c.kind, text: c.text, options: c.options, answer: c.answer,
        accepted: c.accepted, model: c.model, photo: c.photo, img: img, to: to, at: now(), n: S.session.questions.length + 1, open: true,
        ai: c.ai === true, parts: cz ? cz.parts : null, keys: cz ? cz.keys : null, hidden: !!c.keyFrom
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
    // The teacher's one-tap override: ✓ ◐ ✗ gives that mark; the same tap
    // again takes it off, and the provisional mark shows again.
    function setMark(q, identity, ok) {
      var e = entryOf(q.id, identity);
      if (!e || cleanMark(ok) == null) return;
      var next = Object.assign({}, e, { ok: confirmedOf(e) === ok ? null : ok });
      setEntry(q.id, identity, next);
      send({ t: 'mark', qid: q.id, ok: confirmedOf(next), pts: next.pts || 0 }, [identity]);
      paintSide(true);
      layout();
    }
    // ✓ Confirm: the provisional mark (the key's, or Chung GPT's) becomes the
    // teacher's — the only kind that counts and the only kind a student sees.
    function confirmMark(q, identity, quiet) {
      var e = entryOf(q.id, identity);
      if (!e || confirmedOf(e) != null) return false;
      var p = provisionalOf(e);
      if (p == null) return false;
      var next = Object.assign({}, e, { ok: p, by: markSource(e) });
      setEntry(q.id, identity, next);
      send({ t: 'mark', qid: q.id, ok: p, pts: next.pts || 0 }, [identity]);
      if (!quiet) { paintSide(true); layout(); }
      return true;
    }
    function confirmAll(q) {
      if (!isTeacher()) return;
      var plan = confirmPlan(S.session, q);
      if (!plan.length) { say('Nothing is waiting to be confirmed on Q' + q.n + '.'); return; }
      var n = 0;
      plan.forEach(function (row) { if (confirmMark(q, row.identity, true)) n++; });
      paintSide(true); layout();
      say('✓ Confirmed ' + n + ' mark' + (n === 1 ? '' : 's') + ' on Q' + q.n + '. They now count, and the students can see them.');
    }

    /* ---------- ✨ Chung GPT pre-marks written answers (v1.209.0) ----------
       A blank the key cannot settle and every open answer go to the model in
       BATCHES (one call for up to AI_BATCH answers to the same question,
       gathered for AI_WAIT_MS), at most AI_PARALLEL calls at a time, so a
       class answering at once is marked in seconds rather than thirty
       separate waits. The result is PROVISIONAL (entry.ai) and stays on the
       teacher's board until ✓ Confirm / Confirm all / an override. A late
       reply is dropped when the lesson, the answer (its aid) or the teacher
       has changed meanwhile. */
    var AI_BATCH = 8, AI_WAIT_MS = 1200, AI_PARALLEL = 2;
    function aiName() { var n = typeof env.aiName === 'function' ? oneLine(env.aiName(), 30) : ''; return n || 'Chung GPT'; }
    function aiMarkOn() { return isTeacher() && typeof env.aiMark === 'function' && S.prefs.aiMark !== false; }
    function queueAiMark(q, identity) {
      if (!aiMarkOn() || !S.session) return;
      var e = entryOf(q.id, identity);
      if (!needsAiMark(q, e)) return;
      if (e.ph && !S.images[e.ph]) return;              // its photo is still arriving; imageArrived asks again
      var b = S.aiq[q.id] || (S.aiq[q.id] = { ids: {}, timer: 0 });
      b.ids[identity] = e.aid;
      clearTimeout(b.timer);
      b.timer = setTimeout(function () { aiFlush(q.id); }, Object.keys(b.ids).length >= AI_BATCH ? 0 : AI_WAIT_MS);
    }
    function aiFlush(qid) {
      var b = S.aiq[qid];
      if (!b) return;
      clearTimeout(b.timer);
      if (!aiMarkOn() || !S.session) { delete S.aiq[qid]; return; }
      if (S.aiBusy >= AI_PARALLEL) { b.timer = setTimeout(function () { aiFlush(qid); }, 700); return; }
      var q = questionById(qid);
      if (!q) { delete S.aiq[qid]; return; }
      var ids = Object.keys(b.ids).slice(0, AI_BATCH);
      ids.forEach(function (id) { delete b.ids[id]; });
      if (!Object.keys(b.ids).length) delete S.aiq[qid];
      var batch = ids.map(function (id) {
        var e = entryOf(qid, id);
        if (!needsAiMark(q, e)) return null;
        var person = S.session.people[id];
        return { id: id, aid: e.aid, name: person ? person.name : '', text: answerText(q, e.v), photo: e.ph && validImage(S.images[e.ph]) ? S.images[e.ph] : '' };
      }).filter(Boolean);
      if (!batch.length) { if (S.aiq[qid]) aiFlush(qid); return; }
      var epoch = S.session.epoch;
      S.aiBusy++;
      S.aiMarking[qid] = (S.aiMarking[qid] || 0) + batch.length;
      paintSide(true);
      var ask = {
        question: { n: q.n, kind: q.kind, text: q.text, accepted: q.accepted || [], model: q.model || '',
          gaps: q.kind === 'cloze' ? clozeText(q.parts, []) : '', keys: q.kind === 'cloze' ? (q.keys || []) : [] },
        img: q.img && validImage(S.images[q.img.ref]) ? S.images[q.img.ref] : '',
        // Students are numbered, never named, for the model: a name is no
        // help in marking and stays on the teacher's device.
        answers: batch.map(function (a, i) { return { id: 's' + (i + 1), text: a.text, photo: a.photo }; })
      };
      var byKey = {};
      batch.forEach(function (a, i) { byKey['s' + (i + 1)] = a; });
      Promise.resolve().then(function () { return env.aiMark(ask); }).then(function (res) {
        if (!S.session || S.session.epoch !== epoch || !isTeacher()) return;
        var got = cleanVerdicts(res, Object.keys(byKey));
        var by = res && res.by ? oneLine(res.by, 30) : '';
        var missed = 0;
        Object.keys(byKey).forEach(function (k) {
          var a = byKey[k], e = entryOf(qid, a.id), v = got[k];
          if (!e || e.aid !== a.aid) return;                 // the student changed their answer meanwhile
          if (!v) { missed++; return; }
          setEntry(qid, a.id, Object.assign({}, e, { ai: { v: v.v, why: v.why, by: by, at: now() } }));
        });
        if (missed) S.aiFailed[qid] = (S.aiFailed[qid] || 0) + missed;
      }, function (err) {
        if (!S.session || S.session.epoch !== epoch) return;
        S.aiFailed[qid] = (S.aiFailed[qid] || 0) + batch.length;
        say('✨ Chung GPT could not pre-mark Q' + q.n + ': ' + ((err && err.message) || err) + ' — mark them with ✓ ◐ ✗.');
      }).then(function () {
        S.aiBusy = Math.max(0, S.aiBusy - 1);
        S.aiMarking[qid] = Math.max(0, (S.aiMarking[qid] || 0) - batch.length);
        if (S.session && S.session.epoch === epoch) { paintSide(true); layout(); }
        if (S.aiq[qid]) aiFlush(qid);
      });
    }
    // ↻ Pre-mark again: whatever the model missed or failed on, once more.
    function aiRetry(q) {
      delete S.aiFailed[q.id];
      Object.keys(S.session.answers[q.id] || {}).forEach(function (id) { queueAiMark(q, id); });
      paintSide(true);
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
      S.boardPeek = S.boardPeek || {};
      if (right && right.text && q.hidden && !q.revealed && !S.boardPeek[q.id]) {
        // 🔒 Sent from the hidden answers: covered here too until it is shown.
        var cover = el('div', 'vcHiddenModel');
        cover.appendChild(el('span', null, '🔒 Answer hidden — it marks the answers, and the class sees it only when you press 💡.'));
        cover.appendChild(btn('vcChip', '👁 Show it to me', 'Show the answer on this screen only', function () { S.boardPeek[q.id] = true; paintSide(true); }));
        head.appendChild(cover);
      } else if (right && right.text) head.appendChild(el('p', 'vcHint', 'Answer: ' + right.text));
      var stats = el('p', 'vcStats');
      stats.textContent = st.answered + ' answered' + (st.asked ? ' of ' + st.asked + ' here' : '') +
        (st.right ? ' · ✓ ' + st.right : '') + (st.partial ? ' · ◐ ' + st.partial : '') + (st.wrong ? ' · ✗ ' + st.wrong : '') +
        (st.unmarked ? ' · ' + st.unmarked + ' to mark' : '') + (st.toConfirm ? ' · ' + st.toConfirm + ' to confirm' : '');
      head.appendChild(stats);
      if (q.ai) head.appendChild(el('p', 'vcHint', '✨ Read off the worksheet by Chung GPT.'));
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

      // The live tally: ✓ ◐ ✗ ? ⏳ — tap a chip to see who.
      var tally = tallyOf(s, q, present);
      if (S.tallyQ !== q.id) { S.tally = ''; S.tallyQ = q.id; }
      var tallyRow = el('div', 'vcTally');
      tallyRow.setAttribute('role', 'group');
      tallyRow.setAttribute('aria-label', 'Tally — tap to see who');
      [
        { k: 'right', icon: '✓', word: 'right', cls: 'ok' },
        { k: 'partial', icon: '◐', word: 'partly right', cls: 'part' },
        { k: 'wrong', icon: '✗', word: 'not right', cls: 'no' },
        { k: 'unmarked', icon: '?', word: 'not marked yet', cls: 'un' },
        { k: 'waiting', icon: '⏳', word: 'still to answer', cls: 'wait' }
      ].forEach(function (c) {
        var n = tally[c.k].length;
        if (!n && c.k !== 'right' && c.k !== 'wrong') return;
        var chip = btn('vcTallyChip ' + c.cls + (S.tally === c.k ? ' on' : ''), c.icon + ' ' + n, n + ' ' + c.word + ' — tap to see who', function () {
          S.tally = S.tally === c.k ? '' : c.k; paintSide(true);
        });
        chip.setAttribute('aria-pressed', S.tally === c.k ? 'true' : 'false');
        tallyRow.appendChild(chip);
      });
      box.appendChild(tallyRow);
      var tallyIds = null;
      if (S.tally) {
        var mOpt = /^opt:(\d+)$/.exec(S.tally);
        tallyIds = mOpt ? choosersOf(s, q, Number(mOpt[1])) : (tally[S.tally] || []);
        var who = el('div', 'vcTallyWho');
        var label = mOpt ? 'Chose ' + letter(Number(mOpt[1])) + ': ' : { right: 'Right: ', partial: 'Partly right: ', wrong: 'Not right: ', unmarked: 'Not marked yet: ', waiting: 'Still to answer: ' }[S.tally] || '';
        who.appendChild(el('b', null, label));
        who.appendChild(el('span', null, tallyIds.length ? tallyIds.map(function (id) { return (s.people[id] || { name: 'Student' }).name; }).join(', ') : 'nobody'));
        who.appendChild(btn('vcIcon', '✕', 'Show everyone again', function () { S.tally = ''; paintSide(true); }));
        box.appendChild(who);
      }
      // Provisional marks: only confirmed ones count (points, reports, what the
      // student sees).
      var marking = S.aiMarking[q.id] || 0;
      if (st.toConfirm || marking || S.aiFailed[q.id]) {
        var conf = el('div', 'vcConfirmBar');
        var words = [];
        if (marking) words.push('✨ ' + aiName() + ' is marking ' + marking + ' answer' + (marking === 1 ? '' : 's') + '…');
        if (st.toConfirm) words.push(st.toConfirm + ' provisional mark' + (st.toConfirm === 1 ? '' : 's') + ' — only confirmed marks count');
        if (S.aiFailed[q.id]) words.push(S.aiFailed[q.id] + ' could not be pre-marked');
        conf.appendChild(el('span', 'vcConfirmText', words.join(' · ')));
        if (S.aiFailed[q.id] && aiMarkOn()) conf.appendChild(btn('', '↻ Pre-mark again', 'Ask ' + aiName() + ' again for the answers it missed', function () { aiRetry(q); }));
        if (st.toConfirm) conf.appendChild(btn('vcPrimary vcConfirmAll', '✓ Confirm all (' + st.toConfirm + ')', 'Make every provisional mark on this question yours: it counts, and each student sees it', function () { confirmAll(q); }));
        box.appendChild(conf);
      }

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
          row.title = letter(i) + '. ' + o + ' — tap to see who chose it';
          row.setAttribute('role', 'button');
          row.tabIndex = 0;
          var pickOpt = function () { S.tally = S.tally === 'opt:' + i ? '' : 'opt:' + i; paintSide(true); };
          row.addEventListener('click', pickOpt);
          row.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pickOpt(); } });
          if (S.tally === 'opt:' + i) row.classList.add('on');
          bars.appendChild(row);
        });
        box.appendChild(bars);
      }

      // Every answer.
      var list = el('div', 'vcAnsList');
      ids.sort(function (a, b) { return (byQ[a].at || 0) - (byQ[b].at || 0); }).forEach(function (id) {
        if (tallyIds && tallyIds.indexOf(id) === -1) return;
        var e = byQ[id], p = s.people[id] || { name: 'Student' };
        var mk = markOf(e), mine = confirmedOf(e), src = markSource(e);
        var row = el('div', 'vcAns' + (mk === true ? ' ok' : mk === false ? ' no' : mk === 'partial' ? ' part' : '') + (mk != null && mine == null ? ' prov' : ''));
        var top = el('div', 'vcAnsTop');
        top.appendChild(el('b', 'vcAnsName', p.name));
        if (p.kind === 'trial') top.appendChild(el('span', 'vcTag', 'Trial'));
        if (p.kind === 'makeup') top.appendChild(el('span', 'vcTag', 'Make-up'));
        if (p.via === 'zoom') top.appendChild(el('span', 'vcTag zoom', '📱 Zoom'));
        if (e.edits) top.appendChild(el('span', 'vcMuted', 'changed ' + e.edits + '×'));
        top.appendChild(el('span', 'vcMuted', new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })));
        row.appendChild(top);
        var said = answerText(q, e.v);
        if (said) row.appendChild(el('p', 'vcAnsText', said));
        // 👀 v1.217.0: they left the lesson while this question was open.
        if (cleanOut(e.out)) row.appendChild(el('p', 'vcOutFlag', '⚠ ' + outWords(e.out)));
        if (e.ph) {
          var img = el('img', 'vcThumb vcAnsPhoto');
          photoFor(e.ph, img);
          img.addEventListener('click', function () { if (S.images[e.ph]) openBigPhoto(S.images[e.ph]); });
          row.appendChild(img);
        }
        if (src === 'ai' && e.ai) {
          var why = el('p', 'vcAiWhy');
          why.appendChild(el('b', null, '✨ ' + markWord(mk) + ' ' + ({ correct: 'Correct', partial: 'Partly right', wrong: 'Not right' }[e.ai.v] || '') + ' · '));
          why.appendChild(el('span', null, e.ai.why || 'no reason given'));
          row.appendChild(why);
        } else if (mine != null && e.ai && e.ai.v && VERDICT_MARK[e.ai.v] !== mine) {
          row.appendChild(el('p', 'vcAiWhy was', '✨ ' + aiName() + ' had said ' + ({ correct: 'correct', partial: 'partly right', wrong: 'not right' }[e.ai.v]) + (e.ai.why ? ': ' + e.ai.why : '')));
        }
        var tools = el('div', 'vcAnsTools');
        // The one-tap override: the button lit is the TEACHER's mark.
        tools.appendChild(btn('vcMark' + (mine === true ? ' on' : mk === true ? ' guess' : ''), '✓', 'Right', function () { setMark(q, id, true); }));
        if (q.kind !== 'mcq') tools.appendChild(btn('vcMark part' + (mine === 'partial' ? ' on' : mk === 'partial' ? ' guess' : ''), '◐', 'Partly right', function () { setMark(q, id, 'partial'); }));
        tools.appendChild(btn('vcMark no' + (mine === false ? ' on' : mk === false ? ' guess' : ''), '✗', 'Not right', function () { setMark(q, id, false); }));
        if (mine == null && mk != null) {
          tools.appendChild(btn('vcConfirm', '✓ Confirm', 'Make this ' + (src === 'ai' ? aiName() + '’s' : 'key’s') + ' mark yours — then it counts and ' + p.name + ' sees it', function () { confirmMark(q, id); }));
          tools.appendChild(el('span', 'vcMuted', src === 'ai' ? 'provisional · ✨' : 'provisional · the key'));
        } else if (mine == null && needsAiMark(q, e) && aiMarkOn()) {
          tools.appendChild(el('span', 'vcMuted', (S.aiMarking[q.id] ? '✨ marking…' : 'not marked')));
        } else if (mine != null) {
          tools.appendChild(el('span', 'vcMuted vcMine', 'confirmed'));
        }
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
    /* ================================================================
       🙋 ATTENDANCE AND ABSENCE ALERTS (v1.218.0)
       Every minute the teacher's device tells the server who has joined
       (the lesson's record) and gets back the class list for this slot.
       N minutes into the lesson (10 by default) the children still missing
       show on a banner over the class: in "automatic" a minute counts down
       and then their parents are emailed from admin@ (one email per child
       per lesson, never twice); "ask me first" waits for the button. Any
       name can be skipped or marked "here" (a child on Zoom who never
       opened the live class). When the class ends the server emails a
       catch-up link to the parents of every child who never came.
       ================================================================ */
    var ATT_EVERY_MS = 60000;
    var ATT_COUNTDOWN_MS = 60000;
    function att() {
      if (!S.att || S.att.epoch !== (S.session && S.session.epoch)) {
        S.att = { epoch: S.session && S.session.epoch, data: null, at: 0, busy: false, until: 0, held: false, skip: {}, hidden: '', err: '', skew: 0, dueSeen: false, timer: 0 };
      }
      return S.att;
    }
    function attOn() { return isTeacher() && S.mode === 'live' && !!S.session && !!(S.session.slot || S.slot); }
    function attNow() { return now() + (att().skew || 0); }
    function attendanceTick(force) {
      if (!attOn()) return;
      var a = att();
      if (a.busy) return;
      var d = a.data;
      var dueNow = !!(d && d.taken && !a.dueSeen && attNow() >= d.dueAt);
      if (dueNow) a.dueSeen = true;
      var countdownDone = !!(a.until && now() >= a.until);
      if (countdownDone) { attendanceSend(); return; }
      if (force || dueNow || now() - a.at >= ATT_EVERY_MS) attendanceCall(false);
    }
    function attendanceCall(sendNow, extra) {
      var a = att();
      a.busy = true;
      var body = Object.assign({ epoch: S.session.epoch, joined: attJoinedMap(S.session), send: !!sendNow, skip: Object.keys(a.skip) }, extra || {});
      return call('attendance', body).then(function (r) {
        a.busy = false; a.at = now(); a.err = '';
        if (r && r.taken) { a.data = r; a.skew = Number(r.now) ? Number(r.now) - now() : 0; }
        else a.data = r || null;
        if (sendNow) {
          a.until = 0;
          var nm = function (ids) { return namesWords((ids || []).map(function (id) { var x = (r.students || []).filter(function (s) { return s.id === id; })[0]; return x ? x.name : ''; })); };
          if (r && r.sent && r.sent.length) say('✉ Emailed the parents of ' + nm(r.sent) + ': not joined yet.');
          else if (r && r.taken) say('Nobody left to email — everyone is here or already told.');
          if (r && r.noEmail && r.noEmail.length) say('No parent email on file for ' + nm(r.noEmail) + ' — add one in the office.');
        }
        attendancePlan();
        paintAttBanner();
        if (S.tab === 'people') paintSide(true); else paintTabs();
        return r;
      }, function (e) {
        a.busy = false; a.at = now(); a.err = (e && e.message) || 'The class list could not be checked.';
        if (sendNow) { a.until = 0; say('The parents could not be emailed: ' + a.err); }
        paintAttBanner();
      });
    }
    function attendanceSend() {
      var a = att();
      a.until = 0;
      stopAttTimer();
      return attendanceCall(true);
    }
    // After each check: start the minute's countdown when it is due (automatic).
    function attendancePlan() {
      var a = att(), d = a.data;
      if (!d || !d.taken || d.mode === 'off' || attNow() < d.dueAt) { a.until = 0; stopAttTimer(); return; }
      var pend = attPending(d, a.skip, attJoinedMap(S.session));
      if (!pend.length) { a.until = 0; stopAttTimer(); return; }
      if (d.mode === 'auto' && !a.held && !a.until) a.until = now() + ATT_COUNTDOWN_MS;
      if (a.until) startAttTimer();
    }
    function startAttTimer() {
      var a = att();
      if (a.timer) return;
      a.timer = setInterval(function () {
        if (!attOn()) { stopAttTimer(); return; }
        if (a.until && now() >= a.until) { attendanceSend(); return; }
        paintAttBanner();
      }, 1000);
    }
    function stopAttTimer() { var a = S.att; if (a && a.timer) { clearInterval(a.timer); a.timer = 0; } }
    function markHere(id, name) {
      var a = att();
      delete a.skip[id];
      say(name + ' is marked as here.');
      return attendanceCall(false, { here: [id] });
    }
    // The banner over the class, top left: who is missing and what happens next.
    function paintAttBanner() {
      if (!S.stage || S.role !== 'teacher') return;
      if (!S.attBox) { S.attBox = el('div', 'vcAttBanner'); S.attBox.setAttribute('role', 'status'); }
      if (S.attBox.parentNode !== S.stage) S.stage.appendChild(S.attBox);
      var box = S.attBox;
      clear(box);
      var a = att(), d = a.data;
      var pend = d ? attPending(d, a.skip, attJoinedMap(S.session)) : [];
      var sig = pend.map(function (r) { return r.id; }).join(',');
      var show = !!(d && d.taken && d.mode !== 'off' && attNow() >= d.dueAt && pend.length && a.hidden !== sig);
      box.hidden = !show;
      if (!show) return;
      var mins = Math.max(0, Math.round((attNow() - d.start) / 60000));
      box.appendChild(el('b', 'vcAttTitle', '⏰ ' + mins + ' min in · not joined yet'));
      var list = el('div', 'vcAttNames');
      pend.forEach(function (r) {
        var chip = el('span', 'vcAttChip');
        chip.appendChild(el('span', null, r.name));
        chip.appendChild(btn('vcAttMini', '✋ Here', 'They are in the lesson another way (e.g. on Zoom): mark them here, no email', function () { markHere(r.id, r.name); }));
        chip.appendChild(btn('vcAttMini', 'Skip', 'Do not email this parent', function () { a.skip[r.id] = true; attendancePlan(); paintAttBanner(); }));
        list.appendChild(chip);
      });
      box.appendChild(list);
      var row = el('div', 'vcRow');
      if (a.until) {
        var secs = Math.max(0, Math.ceil((a.until - now()) / 1000));
        box.appendChild(el('p', 'vcAttWhen', 'Their parents are emailed in ' + secs + ' s, from admin@polymathlc.com.sg.'));
        row.appendChild(btn('vcPrimary', '✉ Send now', 'Email these parents now', function () { attendanceSend(); }));
        row.appendChild(btn('', 'Wait', 'Stop the countdown — you can still send with the button', function () { a.held = true; a.until = 0; stopAttTimer(); paintAttBanner(); }));
      } else {
        box.appendChild(el('p', 'vcAttWhen', 'Email their parents that their child has not joined (with a one-tap join link)?'));
        row.appendChild(btn('vcPrimary', '✉ Email ' + (pend.length === 1 ? 'the parent' : 'their parents'), 'Email these parents now, from admin@', function () { attendanceSend(); }));
        row.appendChild(btn('', 'Not now', 'Hide this until someone else is missing', function () { a.hidden = sig; paintAttBanner(); }));
      }
      box.appendChild(row);
      if (a.err) box.appendChild(el('p', 'vcMuted', a.err));
    }
    // 👥 People: the whole class list for this lesson slot, at the top.
    function paintAttendance(box) {
      var a = att(), d = a.data;
      var sec = el('div', 'vcAttList');
      if (!d) {
        sec.appendChild(el('h4', null, '🙋 Attendance'));
        sec.appendChild(el('p', 'vcMuted', a.err || (S.session && (S.session.slot || S.slot) ? 'Checking the class list…' : 'Pick a lesson slot when you start the class to take attendance.')));
        box.appendChild(sec);
        if (!a.busy && !a.err) attendanceTick(true);
        return;
      }
      if (!d.taken) {
        sec.appendChild(el('h4', null, '🙋 Attendance'));
        sec.appendChild(el('p', 'vcMuted', 'No lesson slot was picked for this class, so attendance is not taken.'));
        box.appendChild(sec);
        return;
      }
      var jn = attJoinedMap(S.session);
      var here = d.students.filter(function (r) { return r.here || jn[r.id]; }).length;
      sec.appendChild(el('h4', null, '🙋 Attendance · ' + here + ' of ' + d.students.length + ' here'));
      var when = d.mode === 'off' ? 'Absence emails are off.' : attNow() < d.dueAt
        ? 'Missing children are checked at ' + sgClock(d.dueAt) + (d.mode === 'auto' ? ' and their parents emailed a minute later.' : ' (you choose whether to email).')
        : d.mode === 'auto' ? 'Parents of missing children are emailed automatically.' : 'You choose whether to email parents.';
      sec.appendChild(el('p', 'vcMuted', when + (d.catchUp && d.mode !== 'off' ? ' A catch-up link goes to the parents of anyone still absent when you end the class.' : '')));
      d.students.forEach(function (r) {
        var st = attStatus(r, jn);
        var row = el('div', 'vcAttRow ' + st.cls);
        row.appendChild(el('b', null, r.name));
        row.appendChild(el('span', 'vcAttWord', st.word));
        if (!r.here && !jn[r.id]) row.appendChild(btn('vcAttMini', '✋ Mark here', 'They are in the lesson another way (e.g. on Zoom)', function () { markHere(r.id, r.name); }));
        sec.appendChild(row);
      });
      sec.appendChild(el('p', 'vcMuted vcAttNote', 'Only the live class is seen: a child on Zoom alone shows as not joined — mark them here. The office can correct any day in 💬 Lesson updates.'));
      box.appendChild(sec);
    }
    // 🧾 Reports: who was absent, so no one is forgotten (they get the catch-up, not a report).
    function paintAbsentNote(box) {
      var d = (S.closeAtt && S.closeAtt.taken ? S.closeAtt : null) || (S.att && S.att.data && S.att.data.taken ? S.att.data : null);
      if (!d) return;
      var jn = attJoinedMap(S.session);
      var absent = d.students.filter(function (r) { return !r.here && !jn[r.id]; });
      if (!absent.length) return;
      var n = el('div', 'vcAttAbsent');
      n.appendChild(el('b', null, '🙋 Absent today: ' + namesWords(absent)));
      var caught = absent.filter(function (r) { return r.catchup; });
      n.appendChild(el('p', 'vcMuted', caught.length === absent.length ? 'Their parents were emailed a catch-up link (worksheet, answer key and lesson video on Polymath Online). They have no report for this lesson.'
        : d.catchUp && d.mode !== 'off' ? 'When you end the class their parents are emailed a catch-up link instead of a report.' : 'They have no report for this lesson; the office’s lesson updates and weekly reports say they were absent.'));
      box.appendChild(n);
    }
    // ⚙ On the start card: how absences are handled (kept on the server for every class).
    function paintAttSettings(card, st) {
      var set = (st && st.settings) || {};
      var wrap = el('div', 'vcOpt vcAttOpt');
      wrap.appendChild(el('span', null, '🙋 Not joined'));
      var after = el('input');
      after.type = 'number'; after.min = '3'; after.max = '45'; after.step = '1'; after.className = 'vcEarly';
      after.value = String(set.absentAfter || 10);
      wrap.appendChild(after);
      wrap.appendChild(el('span', null, 'minutes in:'));
      var mode = el('select', 'vcAttMode');
      [['auto', 'email the parents automatically (1-minute countdown)'], ['ask', 'ask me first'], ['off', 'do nothing']].forEach(function (o) {
        var opt = new Option(o[1], o[0]);
        if ((set.absentMode || 'auto') === o[0]) opt.selected = true;
        mode.appendChild(opt);
      });
      wrap.appendChild(mode);
      var cuLab = el('label', 'vcOpt');
      var cu = el('input'); cu.type = 'checkbox'; cu.checked = set.catchUp !== false;
      cuLab.appendChild(cu);
      cuLab.appendChild(el('span', null, '📚 When I end the class, email a catch-up link to the parents of every child who was absent'));
      function save(change, words) {
        call('settings', change).then(function (r) {
          S.status = Object.assign({}, S.status || {}, { settings: r.settings });
          say(words(r.settings));
        }, function (e) { say((e && e.message) || 'That setting could not be saved.'); });
      }
      after.addEventListener('change', function () {
        var n = Math.max(3, Math.min(45, Math.round(Number(after.value) || 10)));
        after.value = String(n);
        save({ absentAfter: n }, function (x) { return 'Missing children are now checked ' + x.absentAfter + ' minutes into the lesson.'; });
      });
      mode.addEventListener('change', function () {
        save({ absentMode: mode.value }, function (x) { return x.absentMode === 'auto' ? 'Parents of missing children are emailed automatically.' : x.absentMode === 'ask' ? 'You will be asked before parents are emailed.' : 'Absence emails are off.'; });
      });
      cu.addEventListener('change', function () {
        save({ catchUp: cu.checked }, function (x) { return x.catchUp ? 'A catch-up link goes to absent children’s parents when a class ends.' : 'No catch-up emails when a class ends.'; });
      });
      card.appendChild(wrap);
      card.appendChild(cuLab);
    }
    // 🙋 Earlier absences for a report's "Recent live lessons" (the office's
    // record of each day), loaded once per class.
    function loadAbsences() {
      if (S.absState || typeof env.loadAbsences !== 'function') return;
      S.absState = 'loading';
      Promise.resolve(env.loadAbsences()).then(function (map) {
        S.absences = map && typeof map === 'object' ? map : {};
        S.absState = 'ready';
        if (S.tab === 'reports' || S.mode === 'ended') paintSide();
      }, function () { S.absState = 'failed'; S.absences = {}; });
    }
    function absencesOf(identity) {
      var m = /^r:(.+)$/.exec(String(identity || ''));
      return m && S.absences ? S.absences[m[1]] || [] : [];
    }

    function paintPeople(box) {
      var s = S.session;
      var people = roster(s);
      paintAttendance(box);
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
        if (p.via === 'zoom') top.appendChild(el('span', 'vcTag zoom', '📱 Zoom'));
        if (S.removed[p.identity]) top.appendChild(el('span', 'vcTag warn', 'Removed'));
        row.appendChild(top);
        var q = S.quality[p.identity];
        var pf = performance(s, p.identity, now());
        row.appendChild(el('p', 'vcMuted', r.minutes + ' min · ' + r.answered + '/' + r.asked + ' answered' + (r.marked ? ' · ✓ ' + r.right + '/' + r.marked : '') + (p.hands ? ' · ✋ ' + p.hands : '') +
          (pf && pf.focusPct != null ? ' · 👀 ' + pf.focusPct + '%' : '') + (q && p.here ? ' · ' + q : '')));
        var lv = leaveSummary(s, p.identity, now());
        if (lv && (lv.count || lv.awayNow)) {
          row.appendChild(el('p', 'vcOutFlag', (lv.awayNow ? '👀 Away from the lesson now · ' : '') + 'Left ' + lv.count + '× (' + secondsWords(Math.round(lv.totalMs / 1000)) + ')' +
            (lv.flagged ? ' · ⚠ ' + lv.flagged + ' answer' + (lv.flagged === 1 ? '' : 's') + ' after leaving' : '')));
        }
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
    /* 📈 The progress book (v1.216.0): one small summary per child per
       lesson, kept by the glue (users/{teacher}/liveClassProgress/main), so a
       report can show the child's recent live lessons. It is loaded before
       it is ever written, so a slow read can never overwrite it with an
       empty book. */
    function loadProgress() {
      if (S.progressState || typeof env.loadProgress !== 'function') return;
      S.progressState = 'loading';
      Promise.resolve(env.loadProgress()).then(function (book) {
        S.progress = book && typeof book === 'object' ? book : { v: 1, students: {} };
        S.progressState = 'ready';
        updateProgress(true);
        if (S.tab === 'reports' || S.mode === 'ended') paintSide();
      }, function () { S.progressState = 'failed'; });
    }
    function updateProgress(force) {
      if (S.progressState !== 'ready' || !S.session || typeof env.saveProgress !== 'function') return;
      if (!force && now() - (S.progressSavedAt || 0) < 60000) return;
      S.progressSavedAt = now();
      S.progress = progressMerge(S.progress, S.session, S.session.endedAt || now());
      Promise.resolve(env.saveProgress(S.progress)).catch(function () {});
    }
    function historyOf(identity) {
      loadAbsences();
      var hist = S.progressState === 'ready' ? historyFor(S.progress, identity, S.session.epoch, 8) : [];
      return historyWithAbsences(hist, absencesOf(identity), S.session.startedAt || now(), 5);
    }
    function reportFor(identity) {
      var r = S.reports[identity];
      if (r && r.edited) return r.text;
      return reportText(S.session, identity, S.session.endedAt || now(), centreName(), historyOf(identity));
    }
    // The email: the full performance card, unless the teacher rewrote the
    // words — then exactly their words, as they wrote them.
    function reportMailHtml(identity, text) {
      var r = S.reports[identity];
      if (r && r.edited) return reportHtml(text);
      return reportCardHtml(S.session, identity, S.session.endedAt || now(), centreName(), historyOf(identity));
    }
    // 📈 The measures for one child, as the teacher sees them before sending.
    function perfPanel(p) {
      var f = performance(S.session, p.identity, S.session.endedAt || now());
      var box = el('div', 'vcPerf');
      if (!f) return box;
      var tile = function (label, value, word) {
        var t = el('div', 'vcPerfTile');
        t.appendChild(el('span', 'vcPerfLabel', label));
        t.appendChild(el('b', null, value));
        if (word) t.appendChild(el('span', 'vcPerfWord', word));
        box.appendChild(t);
      };
      tile('Time in class', f.minutes + ' min', f.joinedClock ? 'joined ' + f.joinedClock : '');
      tile('Answered', f.asked ? f.answered + '/' + f.asked : '—', levelWord('answered', f.answeredPct));
      tile('Correct', f.scorePct == null ? '—' : f.scorePct + '%', f.scorePct == null ? (f.answered ? 'mark answers to count' : '') : levelWord('score', f.scorePct));
      tile('Answer speed', f.avgSecs == null ? '—' : secondsWords(f.avgSecs), levelWord('speed', f.avgSecs));
      tile('Focus', f.focusPct == null ? '—' : f.focusPct + '%', f.focusPct == null ? (f.via === 'zoom' ? '📱 on Zoom' : 'not measured') : levelWord('focus', f.focusPct) + (f.awayTimes ? ' · left ' + f.awayTimes + '×' : ''));
      tile('Hands', String(f.hands || 0), f.points ? f.points + ' pts' : '');
      // 👀 v1.217.0: every time they left the lesson screen, for the teacher.
      var lv = leaveSummary(S.session, p.identity, S.session.endedAt || now());
      if (lv && lv.count) {
        var lb = el('div', 'vcPerfHist vcLeaves');
        lb.appendChild(el('span', 'vcPerfLabel', '👀 Left the lesson screen ' + lv.count + '× · ' + secondsWords(Math.round(lv.totalMs / 1000)) + ' in all · longest ' + secondsWords(Math.round(lv.longestMs / 1000))));
        lb.appendChild(el('p', 'vcMuted', lv.list.map(function (x) { return x.clock + (x.now ? ' (still away)' : ' for ' + secondsWords(Math.round(x.ms / 1000))); }).join(' · ')));
        if (lv.flagged) lb.appendChild(el('p', 'vcOutFlag', '⚠ ' + lv.flagged + ' answer' + (lv.flagged === 1 ? ' was' : 's were') + ' sent after leaving the lesson during that question — see 📋 Answers.'));
        if (lv.photos) lb.appendChild(el('p', 'vcMuted', '📷 Opened the camera for a photo of their working ' + lv.photos + '× (not counted).'));
        box.appendChild(lb);
      }
      var hist = historyOf(p.identity);
      if (hist.length) {
        var h = el('div', 'vcPerfHist');
        h.appendChild(el('span', 'vcPerfLabel', 'Recent live lessons'));
        historyLines(hist).forEach(function (line) { h.appendChild(el('p', 'vcMuted', line)); });
        var tr = trendOf(hist, f);
        if (tr) h.appendChild(el('p', 'vcPerfTrend ' + tr, tr === 'up' ? '↑ Better than recent lessons' : tr === 'down' ? '↓ Lower than recent lessons' : '→ About the same as recent lessons'));
        box.appendChild(h);
      } else if (S.progressState === 'loading') {
        box.appendChild(el('p', 'vcMuted vcPerfHist', 'Loading recent lessons…'));
      }
      return box;
    }
    function subjectFor(p) {
      return 'Live lesson report — ' + p.name + ' — ' + fmtDate(S.session.startedAt || now());
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
      loadProgress();
      updateProgress(false);
      paintAbsentNote(box);
      if (!people.length) {
        box.appendChild(el('p', 'vcMuted vcEmptySide', 'Each student who joins gets a summary here: time in class, every answer, marks and hands raised — ready to send to their parent.'));
        return;
      }
      var intro = el('div', 'vcRepIntro');
      intro.appendChild(el('p', 'vcMuted', 'A performance report for each student’s parent: time in class, answers and marks, answer speed, focus and their recent live lessons. Emails go from admin@polymathlc.com.sg. Nothing is sent until you press Send.'));
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
        var pf = performance(s, p.identity, s.endedAt || now());
        if (pf) {
          var chips = [];
          if (pf.scorePct != null) chips.push('✓ ' + pf.scorePct + '%');
          if (pf.avgSecs != null) chips.push('⏱ ' + secondsWords(pf.avgSecs));
          if (pf.focusPct != null) chips.push('👀 ' + pf.focusPct + '%');
          var lvc = leaveSummary(s, p.identity, s.endedAt || now());
          if (lvc && lvc.count) chips.push('left ' + lvc.count + '×' + (lvc.flagged ? ' ⚠ ' + lvc.flagged : ''));
          if (chips.length) head.appendChild(el('span', 'vcRepChips', chips.join('  ·  ')));
        }
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
      wrap.appendChild(perfPanel(p));
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
        // A copy to the teacher's own inbox first, to see exactly what the parent will get.
        row.appendChild(btn('', '✉ Test to me', 'Email this report to yourself only, to check it before a parent sees it', function () {
          var text = ta.value;
          Promise.resolve(env.sendEmail({ to: [], test: true, subject: '[Test] ' + subjectFor(p), text: text, html: reportMailHtml(id, text), rosterId: p.rosterId || '', epoch: S.session.epoch }))
            .then(function (res) { say('✓ Test sent to ' + ((res && res.to && res.to.join(', ')) || 'you') + '.'); }, function (e) { say('The test could not be sent: ' + ((e && e.message) || e)); });
        }));
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
      updateProgress(true);
      var job = Promise.resolve(env.sendEmail({ to: addrs, subject: subjectFor(p), text: text, html: reportMailHtml(p.identity, text), rosterId: p.rosterId || '', epoch: S.session.epoch }));
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
      loadProgress();
      updateProgress(true);
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
      if (S.role === 'student') { S.questions = {}; S.order = []; S.mine = {}; S.popup = null; S.pick = null; S.pinDraft = ''; S.pinMsg = ''; S.passNote = ''; }
      S.pv = null;
      S.hands = {};
      S.mode = 'closed';
    }
    function forget() {
      close();
      if (S.mirrorOff) { try { S.mirrorOff(); } catch (e) {} S.mirrorOff = null; }
      S.session = null; S.reports = {}; S.compose = null; S.images = {}; S.removed = {}; S.outbox = {};
      S.progress = null; S.progressState = '';
      S.status = null; S.lists = null; S.box = null; S.me = null; S.passOff = false;
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
      state: function () { return { mode: S.mode, role: S.role, identity: S.identity, slot: S.slot, epoch: S.epoch, sharing: !!S.shareTrack, shareHow: S.shareHow || '', recording: !!S.rec, session: S.session ? JSON.parse(JSON.stringify(S.session)) : null }; }
    };
  }

  root.LiveClass = { pure: pure, create: typeof create === 'function' ? create : null, VERSION: VERSION };
})(typeof window !== 'undefined' ? window : globalThis);
