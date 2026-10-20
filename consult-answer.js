/* =====================================================================
   📝 CONSULT ANSWER — the teacher answers a question a student LEFT,
   with a recorded video, in Study Buddy and in Ans Key alike (v1.65.0
   Study Buddy, v1.151.0 Ans Key).

   THIS FILE IS BYTE FOR BYTE THE SAME IN polymathlc/tutor AND
   polymathlc/anskey. Each repository's test compares the two copies
   whenever both are checked out side by side; a fix in either copies
   straight across rather than being re-derived.

   How a question gets here:

   ① A student presses 🙋 Consult. If the teacher is away — or is here
     but busy and presses "Not now — ask for a question" on the pop-up
     (`askLater`, status `later`) — the student's panel in Study Buddy
     asks them to tap the page, or drag a box round the part, and type
     or SAY what they want to ask. That goes up as status `question`
     with `question: { text, page, ws, box, at }` on the consult and the
     picture of the page, box drawn on it, at `frames/question`.
   ② The teacher's pop-up (here, and in Ans Key) shows "📝 … left a
     question". Answer opens THIS window (`open`): the question, the
     picture, three pens, the camera, the microphone. ⏺ records the
     picture with the teacher's writing appearing on it as it is drawn,
     the camera in the corner and the voice — one file.
   ③ Send uploads it to the one folder the shared rules guard
     (`pdf-annotator/lesson-consult-*`, readable by anybody, writable
     only by the verified teacher), then writes `status: 'answered'`
     and `reply: { url, path, mime, ms, note, at }` in ONE transaction.
     The student's Study Buddy picks it up and plays it.

   The rules this file keeps:

   - IT IS THE TEACHER'S ALONE, ASKED IN EVERY HANDLER (`teacherHere`):
     the window, ⏺, Send and `askLater` all ask, because a hidden
     button has never been the lock.
   - NOTHING HERE WRITES `annotations`. The writing lives on this
     window's own canvas and goes into the video, nowhere else — the
     rule the live consult's ink already carries.
   - NO `getDisplayMedia(`. The video is a canvas this window draws,
     so nothing else on the teacher's screen is ever recorded.
   - THE CAMERA IS NEVER MIRRORED IN THE FILE; only the live preview is.
   - EVERY WORD A STUDENT WROTE IS PAINTED WITH textContent.
   - A REPLY LINK IS A FIREBASE STORAGE LINK OR NOTHING (`replyUrlOk`):
     it ends up in a <video src> on a child's screen, and a consult is a
     document another client can write.
   - THE FILES GO IN `pdf-annotator/` FIRST; `tutor-worksheets/` is
     tried only on a REFUSAL by the rules — a dropped network is a
     retry, never a different folder.
   - THE WRITE IS A TRANSACTION THAT RE-READS: a consult the student
     cancelled while the teacher was recording is not answered over.
   - THE CAMERA AND THE MICROPHONE COME DOWN on close, on Escape, on
     pagehide and on an account change (`stop`), every time.
   ===================================================================== */
(function (global) {
  'use strict';

  var COLLECTION = 'tutorConsults';
  var QUESTION_MAX = 500;
  var NOTE_MAX = 300;
  var NAME_MAX = 60;
  var TITLE_MAX = 120;
  var QUESTION_FRESH_MS = 14 * 24 * 60 * 60 * 1000;
  var REC_MAX_MS = 10 * 60 * 1000;
  var REC_SLACK_MS = 1500;
  var STAGE_LONG = 1280;
  var VIDEO_BPS = 2500000;
  var AUDIO_BPS = 96000;
  var STROKE_W = 4;
  var PIP_SHARE = 0.24;
  var PIP_GAP = 0.022;
  var DIRS = ['pdf-annotator', 'tutor-worksheets'];
  var URL_PREFIX = 'https://firebasestorage.googleapis.com/';
  var PENS = [
    { key: 'red', name: 'Red', c: '#E5484D' },
    { key: 'blue', name: 'Blue', c: '#2563EB' },
    { key: 'black', name: 'Black', c: '#111827' }
  ];
  var MIMES = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];

  /* ===================================================================
     The pure half — no DOM, no Firebase. The harness runs these alone.
     =================================================================== */
  function consultIdOk(id) { return typeof id === 'string' && /^[A-Za-z0-9]{12,40}$/.test(id); }
  function cleanText(s, max) {
    if (typeof s !== 'string') return '';
    var t = s.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max).trim() : t;
  }
  function cleanLong(s, max) {
    // A question may run over several lines; keep the line breaks, fold the rest.
    if (typeof s !== 'string') return '';
    var t = s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]+/g, ' ');
    t = t.split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).join('\n');
    t = t.replace(/\n{3,}/g, '\n\n').trim();
    return t.length > max ? t.slice(0, max).trim() : t;
  }
  function stampMs(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (v instanceof Date) { var t = v.getTime(); return isFinite(t) ? t : 0; }
    if (typeof v.toMillis === 'function') { try { var m = v.toMillis(); return isFinite(m) ? m : 0; } catch (e) { return 0; } }
    if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.round((v.nanoseconds || 0) / 1e6);
    return 0;
  }
  function subjectWord(s) {
    if (s === 'math') return 'Maths';
    if (s === 'science') return 'Science';
    if (s === 'both') return 'Maths & Science';
    return '';
  }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  function round4(v) { return Math.round(v * 10000) / 10000; }

  // A box is [x0, y0, x1, y1] in 0..1 of the PAGE, corners in order, and
  // big enough to mean something. Anything else is "the whole page".
  function cleanQBox(b) {
    if (!Array.isArray(b) || b.length !== 4) return null;
    for (var i = 0; i < 4; i++) if (typeof b[i] !== 'number' || !isFinite(b[i])) return null;
    var x0 = clamp01(Math.min(b[0], b[2])), x1 = clamp01(Math.max(b[0], b[2]));
    var y0 = clamp01(Math.min(b[1], b[3])), y1 = clamp01(Math.max(b[1], b[3]));
    if (x1 - x0 < 0.01 || y1 - y0 < 0.01) return null;
    return [round4(x0), round4(y0), round4(x1), round4(y1)];
  }

  function cleanQuestion(q) {
    if (!q || typeof q !== 'object') return null;
    var text = cleanLong(q.text, QUESTION_MAX);
    var page = (typeof q.page === 'number' && isFinite(q.page) && q.page >= 1 && q.page <= 999) ? Math.round(q.page) : 0;
    var box = cleanQBox(q.box);
    if (!text && !page) return null;
    return { text: text, page: page, ws: cleanText(q.ws, TITLE_MAX), box: box, at: stampMs(q.at) };
  }

  function replyUrlOk(u) {
    return typeof u === 'string' && u.length < 2000 && u.indexOf(URL_PREFIX) === 0 && !/[\s"'<>\\]/.test(u);
  }
  function replyPathOk(p) {
    if (typeof p !== 'string') return false;
    return DIRS.some(function (d) {
      return p.indexOf(d + '/lesson-consult-') === 0 && /^[a-z-]+\/lesson-consult-[A-Za-z0-9]{12,40}-\d{6,16}\.(mp4|webm)$/.test(p);
    });
  }
  function cleanReply(r) {
    if (!r || typeof r !== 'object' || !replyUrlOk(r.url)) return null;
    var mime = typeof r.mime === 'string' && /^video\/(mp4|webm)/.test(r.mime) ? r.mime.split(';')[0] : 'video/webm';
    var ms = (typeof r.ms === 'number' && isFinite(r.ms) && r.ms > 0) ? Math.min(Math.round(r.ms), REC_MAX_MS + 60000) : 0;
    return {
      url: r.url,
      path: replyPathOk(r.path) ? r.path : '',
      mime: mime,
      ms: ms,
      note: cleanLong(r.note, NOTE_MAX),
      at: stampMs(r.at)
    };
  }

  function extFor(mime) { return /mp4/i.test(mime || '') ? 'mp4' : 'webm'; }
  function storagePath(dir, id, ts, mime) {
    if (DIRS.indexOf(dir) < 0 || !consultIdOk(id)) return '';
    var t = Math.max(0, Math.round(Number(ts) || 0));
    return dir + '/lesson-consult-' + id + '-' + String(t).padStart(6, '0') + '.' + extFor(mime);
  }
  function pickMime(isOk) {
    var test = typeof isOk === 'function' ? isOk : function () { return false; };
    for (var i = 0; i < MIMES.length; i++) {
      try { if (test(MIMES[i])) return MIMES[i]; } catch (e) {}
    }
    return '';
  }
  // The largest w × h of the given ratio inside maxW × maxH.
  function fit(srcW, srcH, maxW, maxH) {
    if (!(srcW > 0) || !(srcH > 0) || !(maxW > 0) || !(maxH > 0)) return { w: 0, h: 0 };
    var s = Math.min(maxW / srcW, maxH / srcH);
    return { w: Math.max(1, Math.floor(srcW * s)), h: Math.max(1, Math.floor(srcH * s)) };
  }
  // The recording canvas: the picture's own shape, long side STAGE_LONG,
  // and even sides (an encoder refuses an odd one).
  function stageSize(srcW, srcH) {
    var f = fit(srcW || 4, srcH || 3, STAGE_LONG, STAGE_LONG);
    return { w: Math.max(2, f.w - (f.w % 2)), h: Math.max(2, f.h - (f.h % 2)) };
  }
  function pipRect(W, H, camW, camH) {
    if (!(W > 0) || !(H > 0) || !(camW > 0) || !(camH > 0)) return null;
    var w = Math.round(Math.min(W, H) * PIP_SHARE * (camW >= camH ? 1.25 : 1));
    var h = Math.round(w * camH / camW);
    var gap = Math.round(Math.min(W, H) * PIP_GAP);
    return { x: W - w - gap, y: H - h - gap, w: w, h: h };
  }
  function fmtClock(ms) {
    var s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    var m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  function questionFresh(d, t) {
    if (!d || d.status !== 'question') return false;
    var q = d.question || {};
    var at = stampMs(q.at) || stampMs(d.at);
    if (!at) return false;
    var nowMs = typeof t === 'number' ? t : Date.now();
    return nowMs - at < QUESTION_FRESH_MS && at - nowMs < 5 * 60 * 1000;
  }
  function questionWords(d) {
    var who = cleanText(d && d.studentName, NAME_MAX) || 'A student';
    var q = cleanQuestion(d && d.question);
    var bits = [];
    // q.ws is the worksheet's ID (what "Open the worksheet" opens); the
    // NAME is on the consult itself, which sendQuestion re-points at the
    // worksheet the question was asked on.
    var ws = cleanText(d && d.worksheetName, TITLE_MAX);
    if (ws) bits.push(ws);
    if (q && q.page) bits.push('page ' + q.page + (q.box ? ' (a part of it)' : ''));
    var subj = [cleanText(d && d.level, 12), subjectWord(d && d.subject)].filter(Boolean).join(' ');
    if (subj) bits.push(subj);
    return { who: who, title: who + ' left a question', where: bits.join(' · '), text: q ? q.text : '' };
  }
  // How long ago a question was left, in words. A question waits for up
  // to QUESTION_FRESH_MS (two weeks), so this has to go past hours: "35
  // hours ago" is a number nobody reads as "yesterday". A stamp a little
  // in the future (another device's clock) is "just now", never "-3 min".
  function questionAgo(ms) {
    var v = Number(ms);
    if (!isFinite(v) || v < 60000) return 'just now';
    var min = Math.floor(v / 60000);
    if (min < 60) return min === 1 ? '1 min ago' : min + ' min ago';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr === 1 ? '1 hour ago' : hr + ' hours ago';
    var day = Math.floor(hr / 24);
    if (day < 2) return 'yesterday';
    return day + ' days ago';
  }
  // What "✋ Not now" says, by what the transaction found. "That call has
  // already ended" was said for every status but `waiting`, which was
  // wrong four times out of five: a call another screen has just opened,
  // a student already asked, a question already left and a question
  // already answered are four different things to be told, and only one
  // of them means the student has gone.
  function laterSaid(outcome) {
    switch (outcome) {
      case 'ok': return 'Asked them to show you the question — it will come to you here to answer.';
      case 'live': return 'That call is already open on another screen — join it there, or end it first.';
      case 'later': return 'They have already been asked to show you the question.';
      case 'question': return 'They have already left their question — it is in your list to answer.';
      case 'answered': return 'That question has already been answered.';
      case 'offline': return 'Not connected yet — try again in a moment.';
      case 'failed': return 'Could not reach them just now — try again.';
      default: return 'That call has already ended.';
    }
  }
  // A stroke the pens drew: a colour off the list, a width in canvas
  // thousandths, and points in 0..1. The only shape the renderer reads.
  function cleanPenStroke(s) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.p)) return null;
    var pen = PENS.filter(function (p) { return p.c === s.c; })[0];
    if (!pen) return null;
    var pts = [];
    for (var i = 0; i < s.p.length && pts.length < 4000; i++) {
      var q = s.p[i];
      if (!Array.isArray(q) || typeof q[0] !== 'number' || typeof q[1] !== 'number' || !isFinite(q[0]) || !isFinite(q[1])) continue;
      pts.push([round4(clamp01(q[0])), round4(clamp01(q[1]))]);
    }
    if (!pts.length) return null;
    var w = (typeof s.w === 'number' && s.w >= 1 && s.w <= 20) ? s.w : STROKE_W;
    return { c: pen.c, w: w, p: pts };
  }

  var pure = {
    COLLECTION: COLLECTION, QUESTION_MAX: QUESTION_MAX, NOTE_MAX: NOTE_MAX, QUESTION_FRESH_MS: QUESTION_FRESH_MS,
    REC_MAX_MS: REC_MAX_MS, STAGE_LONG: STAGE_LONG, DIRS: DIRS, URL_PREFIX: URL_PREFIX, PENS: PENS, MIMES: MIMES,
    consultIdOk: consultIdOk, cleanText: cleanText, cleanLong: cleanLong, stampMs: stampMs, subjectWord: subjectWord,
    cleanQBox: cleanQBox, cleanQuestion: cleanQuestion, replyUrlOk: replyUrlOk, replyPathOk: replyPathOk,
    cleanReply: cleanReply, extFor: extFor, storagePath: storagePath, pickMime: pickMime, fit: fit,
    stageSize: stageSize, pipRect: pipRect, fmtClock: fmtClock, questionFresh: questionFresh,
    questionWords: questionWords, questionAgo: questionAgo, cleanPenStroke: cleanPenStroke,
    laterSaid: laterSaid
  };

  if (!global.document) { global.ConsultAnswer = { pure: pure }; return; }

  /* ===================================================================
     The app around this file — read lazily, so the harness can load the
     pure half with none of it present.
     =================================================================== */
  function user() { return global.currentUser || null; }
  function teacherHere() {
    var u = user();
    try {
      if (!u || typeof global.isAdmin !== 'function' || !global.isAdmin(u)) return false;
      if (global.actingStudent) return false;
      if (global.CentreAdmin && global.CentreAdmin.isPractice && global.CentreAdmin.isPractice()) return false;
      return true;
    } catch (e) { return false; }
  }
  function teacherName() {
    try { if (typeof global.setterName === 'function') return global.setterName() || 'Mr Chung'; } catch (e) {}
    return 'Mr Chung';
  }
  function db() { return global.db || null; }
  function store() { return global.storage || null; }
  function fv() { try { return global.firebase && global.firebase.firestore && global.firebase.firestore.FieldValue || null; } catch (e) { return null; } }
  function serverStamp() { var F = fv(); return F && F.serverTimestamp ? F.serverTimestamp() : Date.now(); }
  function ref(id) { var d = db(); return d && consultIdOk(id) ? d.collection(COLLECTION).doc(id) : null; }
  function toast(msg, ms) { try { if (typeof global.toast === 'function') global.toast(msg, ms || 5000); } catch (e) {} }
  function el(tag, cls, text) {
    var n = global.document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function btn(text, cls, onClick, title) {
    var b = el('button', 'btn btnSm' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
    b.addEventListener('click', onClick);
    return b;
  }

  /* ===================================================================
     "Not now — ask for a question": the teacher is here but cannot take
     the call. The student's panel sees `later` and asks for the page.
     =================================================================== */
  // One press at a time per consult: a double-tap on "Not now" must not
  // run two transactions, the second of which would then toast "they have
  // already been asked" over the first one's success.
  var laterBusy = {};

  async function askLater(id) {
    if (!teacherHere()) { toast('Only the teacher can do that.'); return false; }
    if (!consultIdOk(id)) return false;
    if (laterBusy[id]) return false;
    var r = ref(id), d = db();
    if (!r || !d || typeof d.runTransaction !== 'function') { toast(laterSaid('offline'), 4500); return false; }
    laterBusy[id] = true;
    var outcome = 'failed';
    try {
      outcome = await d.runTransaction(async function (tx) {
        var snap = await tx.get(r);
        if (!snap.exists) return 'gone';
        var x = snap.data() || {};
        // Only a call that is still RINGING can be turned into a question.
        // A call already open (`live`) belongs to whoever opened it, and
        // writing `later` over it would cut that call off mid-sentence.
        if (x.status !== 'waiting') return typeof x.status === 'string' ? x.status : 'gone';
        tx.update(r, { status: 'later', laterAt: serverStamp(), offer: null, answer: null, tc: [], sc: [] });
        return 'ok';
      });
    } catch (e) {
      console.warn('consult: "not now" could not be written', e);
      outcome = 'failed';
    } finally {
      delete laterBusy[id];
    }
    toast(laterSaid(outcome), outcome === 'ok' ? 5000 : 4500);
    return outcome === 'ok';
  }

  /* ===================================================================
     The answer window.
     =================================================================== */
  var A = null;  // the open window's state, or null

  function blank() {
    return {
      id: '', ref: null, data: null, gen: 0,
      root: null, stageWrap: null, canvas: null, ctx: null,
      img: null, W: 0, H: 0,
      strokes: [], cur: null, pen: PENS[0].c, drawing: false, pointerId: null,
      cam: null, camOn: false, camVideo: null, mic: null,
      rec: null, recStream: null, chunks: [], recMime: '', recStart: 0, recMs: 0, recTimer: 0,
      blob: null, blobUrl: '', raf: 0, busy: false, sent: false,
      els: {}
    };
  }

  async function open(id) {
    if (!teacherHere()) { toast('Only the teacher can answer a question.'); return false; }
    if (!consultIdOk(id)) { toast('That question link is not valid.'); return false; }
    // The same question pressed again (its card, the email's link, Ans Key's
    // pop-up) is the window already open: bring it forward rather than
    // closing it and opening it again, which would throw away whatever is
    // half recorded in it.
    if (A && A.id === id) {
      try { if (A.root && typeof A.root.focus === 'function') A.root.focus(); } catch (e) {}
      return true;
    }
    // Another question is open. Closing it may be DECLINED — there is a
    // recording in it nobody has sent — and then this one must not open over
    // it: the old window would be orphaned on the page with its camera still
    // running and nothing left holding it.
    if (A) {
      close();
      if (A) return false;
    }
    var r = ref(id);
    if (!r) { toast('Not connected yet — try again in a moment.'); return false; }
    var s = blank();
    s.id = id; s.ref = r; s.gen = Date.now();
    A = s;
    var snap = null, frame = null;
    try {
      snap = await r.get();
      if (A !== s) return false;
      if (!snap.exists) { toast('That question has been taken away.'); A = null; return false; }
      try { frame = await r.collection('frames').doc('question').get(); } catch (e) { frame = null; }
      if (A !== s) return false;
    } catch (e) {
      if (A === s) A = null;
      toast('Could not open that question — try again.');
      return false;
    }
    s.data = snap.data() || {};
    if (['question', 'answered'].indexOf(s.data.status) < 0) {
      A = null;
      toast('There is no question waiting on that consult.');
      return false;
    }
    var img = frame && frame.exists ? (frame.data() || {}).img : '';
    s.img = await loadImage(typeof img === 'string' && img.indexOf('data:image/') === 0 ? img : '');
    if (A !== s) return false;
    build(s);
    return true;
  }

  function loadImage(src) {
    return new Promise(function (resolve) {
      if (!src) { resolve(null); return; }
      var im = new global.Image();
      im.onload = function () { resolve(im.naturalWidth > 0 ? im : null); };
      im.onerror = function () { resolve(null); };
      im.src = src;
    });
  }

  function build(s) {
    var d = s.data;
    var words = questionWords(d);
    var root = el('div', 'caBack');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', words.title);
    // Focusable, so Escape reaches the window the moment it opens and the
    // same question pressed again can bring it forward — a plain div cannot
    // take focus, and then neither of those does anything.
    root.tabIndex = -1;
    var card = el('div', 'caCard');
    root.appendChild(card);

    var head = el('div', 'caHead');
    var who = el('div', 'caWho');
    who.appendChild(el('div', 'caTitle', '📝 ' + words.title));
    if (words.where) who.appendChild(el('div', 'caWhere', words.where));
    head.appendChild(who);
    head.appendChild(btn('✕', 'caClose', function () { close(); }, 'Close'));
    card.appendChild(head);

    var body = el('div', 'caBody');
    card.appendChild(body);

    var side = el('div', 'caSide');
    body.appendChild(side);
    var qBox = el('div', 'caQuestion');
    qBox.appendChild(el('div', 'caLabel', 'Their question'));
    qBox.appendChild(el('div', 'caQText', words.text || 'They marked the part of the page below and did not type anything.'));
    side.appendChild(qBox);

    var prev = cleanReply(d.reply);
    if (d.status === 'answered' && prev) {
      var done = el('div', 'caDone');
      done.appendChild(el('div', 'caLabel', 'Already answered'));
      done.appendChild(el('div', 'caHint', d.replySeen ? 'They have watched it. Record again to send a new answer.' : 'Not watched yet. Record again to replace it.'));
      side.appendChild(done);
    }

    var tools = el('div', 'caTools');
    side.appendChild(tools);
    tools.appendChild(el('div', 'caLabel', 'Write on it'));
    var pens = el('div', 'caPens');
    PENS.forEach(function (p) {
      var b = btn('', 'caPen', function () { s.pen = p.c; syncPens(s); }, p.name + ' pen');
      b.style.setProperty('--pen', p.c);
      b.dataset.c = p.c;
      pens.appendChild(b);
    });
    pens.appendChild(btn('↶ Undo', 'caUndo', function () { s.strokes.pop(); paint(s); }, 'Undo the last line'));
    pens.appendChild(btn('Clear', 'caClear', function () { s.strokes = []; paint(s); }, 'Rub everything out'));
    tools.appendChild(pens);

    var camRow = el('div', 'caCamRow');
    var camBtn = btn('📷 Camera: off', 'caCamBtn', function () { toggleCam(s); }, 'Put you in the corner of the video');
    camRow.appendChild(camBtn);
    tools.appendChild(camRow);

    var noteLab = el('label', 'caLabel', 'A note with it (optional)');
    var note = el('textarea', 'caNote');
    note.maxLength = NOTE_MAX;
    note.rows = 2;
    note.placeholder = 'e.g. Try question 5 again after watching.';
    noteLab.appendChild(note);
    tools.appendChild(noteLab);

    var recRow = el('div', 'caRecRow');
    var recBtn = btn('⏺ Record', 'btnPrimary caRec', function () { recToggle(s); }, 'Record your answer');
    var clock = el('span', 'caClock', '0:00');
    recRow.appendChild(recBtn);
    recRow.appendChild(clock);
    tools.appendChild(recRow);

    var review = el('div', 'caReview');
    review.hidden = true;
    var video = el('video', 'caPlayback');
    video.controls = true;
    video.playsInline = true;
    review.appendChild(video);
    var revRow = el('div', 'caRecRow');
    var again = btn('↺ Record again', '', function () { discard(s); }, 'Throw this one away');
    var send = btn('📨 Send to ' + words.who, 'btnPrimary caSend', function () { sendReply(s); }, 'Send it to the student');
    revRow.appendChild(again);
    revRow.appendChild(send);
    review.appendChild(revRow);
    tools.appendChild(review);

    var status = el('div', 'caStatus', 'Write and talk it through — ⏺ records the page, your writing, your voice and (if on) your camera.');
    status.setAttribute('aria-live', 'polite');
    tools.appendChild(status);

    var stageWrap = el('div', 'caStageWrap');
    body.appendChild(stageWrap);
    var canvas = el('canvas', 'caStage');
    var size = stageSize(s.img ? s.img.naturalWidth : 4, s.img ? s.img.naturalHeight : 3);
    canvas.width = size.w; canvas.height = size.h;
    s.W = size.w; s.H = size.h;
    stageWrap.appendChild(canvas);
    var camVideo = el('video', 'caCamPreview');
    camVideo.muted = true; camVideo.playsInline = true; camVideo.autoplay = true;
    camVideo.hidden = true;
    stageWrap.appendChild(camVideo);

    s.root = root; s.canvas = canvas; s.ctx = canvas.getContext('2d'); s.stageWrap = stageWrap; s.camVideo = camVideo;
    s.els = { camBtn: camBtn, recBtn: recBtn, clock: clock, review: review, video: video, send: send, again: again, status: status, note: note, pens: pens };

    bindDraw(s);
    root.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    root.addEventListener('keyup', function (e) { e.stopPropagation(); });
    root.addEventListener('keypress', function (e) { e.stopPropagation(); });
    global.document.body.appendChild(root);
    syncPens(s);
    paint(s);
    loop(s);
    try { if (typeof root.focus === 'function') root.focus(); } catch (e) {}
  }

  function syncPens(s) {
    var bs = s.els.pens ? s.els.pens.querySelectorAll('.caPen') : [];
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', bs[i].dataset.c === s.pen);
  }
  function say(s, text) { if (s && s.els.status) s.els.status.textContent = text; }

  /* ---- Drawing: pointer events in 0..1 of the canvas ---- */
  function bindDraw(s) {
    var c = s.canvas;
    function pt(e) {
      var r = c.getBoundingClientRect();
      if (!(r.width > 0) || !(r.height > 0)) return null;
      return [round4(clamp01((e.clientX - r.left) / r.width)), round4(clamp01((e.clientY - r.top) / r.height))];
    }
    c.addEventListener('pointerdown', function (e) {
      if (s.blob || s.busy) return;
      if (e.button > 0) return;
      if (s.drawing) return;
      var p = pt(e);
      if (!p) return;
      e.preventDefault();
      s.drawing = true; s.pointerId = e.pointerId;
      try { c.setPointerCapture(e.pointerId); } catch (err) {}
      s.cur = { c: s.pen, w: STROKE_W, p: [p] };
      s.strokes.push(s.cur);
      paint(s);
    });
    c.addEventListener('pointermove', function (e) {
      if (!s.drawing || e.pointerId !== s.pointerId || !s.cur) return;
      var list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
      if (!list || !list.length) list = [e];
      for (var i = 0; i < list.length; i++) {
        var p = pt(list[i]);
        if (p && s.cur.p.length < 4000) s.cur.p.push(p);
      }
      paint(s);
    });
    function end(e) {
      if (!s.drawing || (e && e.pointerId !== s.pointerId)) return;
      s.drawing = false; s.pointerId = null; s.cur = null;
      paint(s);
    }
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('lostpointercapture', end);
  }

  function paint(s) {
    if (!s || !s.ctx) return;
    var ctx = s.ctx, W = s.W, H = s.H;
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);
    if (s.img) {
      ctx.drawImage(s.img, 0, 0, W, H);
    } else {
      ctx.fillStyle = '#6B6B66';
      ctx.font = Math.round(H / 24) + 'px sans-serif';
      ctx.fillText('No picture of the page came with this question.', Math.round(W * 0.05), Math.round(H * 0.1));
    }
    var k = W / 1000;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (var i = 0; i < s.strokes.length; i++) {
      var st = s.strokes[i];
      if (!st || !st.p.length) continue;
      ctx.strokeStyle = st.c;
      ctx.fillStyle = st.c;
      ctx.lineWidth = Math.max(1.5, st.w * k);
      if (st.p.length === 1) {
        ctx.beginPath();
        ctx.arc(st.p[0][0] * W, st.p[0][1] * H, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(st.p[0][0] * W, st.p[0][1] * H);
      for (var j = 1; j < st.p.length; j++) ctx.lineTo(st.p[j][0] * W, st.p[j][1] * H);
      ctx.stroke();
    }
    // The camera goes INTO the picture only while recording; the live
    // preview beside it is the mirrored one, and the file never is.
    if (s.camOn && s.cam && s.rec && s.camVideo && s.camVideo.videoWidth > 0) {
      var r = pipRect(W, H, s.camVideo.videoWidth, s.camVideo.videoHeight);
      if (r) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
        ctx.drawImage(s.camVideo, r.x, r.y, r.w, r.h);
      }
    }
    ctx.restore();
  }

  // The canvas must keep producing frames while recording, even when
  // nothing is being drawn, or captureStream hands the encoder nothing.
  function loop(s) {
    if (A !== s) return;
    if (s.rec) {
      paint(s);
      s.recMs = Date.now() - s.recStart;
      if (s.els.clock) s.els.clock.textContent = fmtClock(s.recMs) + ' / ' + fmtClock(REC_MAX_MS);
      if (s.recMs >= REC_MAX_MS - REC_SLACK_MS) { say(s, 'That is the ten-minute limit — stopped.'); recStop(s); }
    }
    s.raf = global.requestAnimationFrame ? global.requestAnimationFrame(function () { loop(s); }) : 0;
  }

  /* ---- The camera ---- */
  async function toggleCam(s) {
    if (!teacherHere() || A !== s || s.busy) return;
    if (s.rec) { say(s, 'Stop recording first to change the camera.'); return; }
    if (s.camOn) { stopCam(s); syncCam(s); return; }
    var md = global.navigator && global.navigator.mediaDevices;
    if (!md || !md.getUserMedia) { say(s, 'This browser cannot open a camera.'); return; }
    s.els.camBtn.disabled = true;
    try {
      var cam = await md.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (A !== s) { cam.getTracks().forEach(function (t) { t.stop(); }); return; }
      s.cam = cam; s.camOn = true;
      s.camVideo.srcObject = cam;
      s.camVideo.hidden = false;
      try { await s.camVideo.play(); } catch (e) {}
    } catch (e) {
      say(s, 'The camera would not open — check the browser’s permission.');
    } finally {
      if (s.els.camBtn) s.els.camBtn.disabled = false;
      syncCam(s);
    }
  }
  function stopCam(s) {
    if (s.cam) { try { s.cam.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} }
    s.cam = null; s.camOn = false;
    if (s.camVideo) { try { s.camVideo.srcObject = null; } catch (e) {} s.camVideo.hidden = true; }
  }
  function syncCam(s) {
    if (!s.els.camBtn) return;
    s.els.camBtn.textContent = s.camOn ? '📷 Camera: on' : '📷 Camera: off';
    s.els.camBtn.classList.toggle('on', !!s.camOn);
  }

  /* ---- Recording ---- */
  function recToggle(s) { if (s.rec) recStop(s); else recStart(s); }

  async function recStart(s) {
    if (!teacherHere()) { toast('Only the teacher can record an answer.'); return; }
    if (A !== s || s.rec || s.busy || s.blob) return;
    var MR = global.MediaRecorder;
    if (!MR || !s.canvas.captureStream) { say(s, 'This browser cannot record video — try Chrome, Edge or Safari.'); return; }
    var md = global.navigator && global.navigator.mediaDevices;
    s.busy = true;
    s.els.recBtn.disabled = true;
    var mic = null;
    try {
      if (md && md.getUserMedia) {
        mic = await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      }
    } catch (e) { mic = null; }
    if (A !== s) { if (mic) mic.getTracks().forEach(function (t) { t.stop(); }); return; }
    if (!mic) say(s, 'No microphone — recording the writing without your voice.');
    var stream;
    try {
      var vs = s.canvas.captureStream(30);
      stream = new global.MediaStream();
      vs.getVideoTracks().forEach(function (t) { stream.addTrack(t); });
      if (mic) mic.getAudioTracks().forEach(function (t) { stream.addTrack(t); });
    } catch (e) {
      if (mic) mic.getTracks().forEach(function (t) { t.stop(); });
      s.busy = false; s.els.recBtn.disabled = false;
      say(s, 'Could not start the recording.');
      return;
    }
    var mime = pickMime(function (m) { return MR.isTypeSupported && MR.isTypeSupported(m); });
    var rec;
    try {
      rec = mime ? new MR(stream, { mimeType: mime, videoBitsPerSecond: VIDEO_BPS, audioBitsPerSecond: AUDIO_BPS })
                 : new MR(stream, { videoBitsPerSecond: VIDEO_BPS });
    } catch (e) {
      try { rec = new MR(stream); } catch (e2) { rec = null; }
    }
    if (!rec) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      if (mic) mic.getTracks().forEach(function (t) { t.stop(); });
      s.busy = false; s.els.recBtn.disabled = false;
      say(s, 'This browser refused to record.');
      return;
    }
    s.mic = mic; s.recStream = stream; s.rec = rec; s.chunks = [];
    s.recMime = rec.mimeType || mime || 'video/webm';
    rec.ondataavailable = function (e) { if (e.data && e.data.size) s.chunks.push(e.data); };
    rec.onstop = function () { recDone(s); };
    s.recStart = Date.now(); s.recMs = 0;
    try { rec.start(1000); } catch (e) {
      recRelease(s); s.rec = null; s.busy = false; s.els.recBtn.disabled = false;
      say(s, 'The recording would not start.');
      return;
    }
    s.busy = false;
    s.els.recBtn.disabled = false;
    s.els.recBtn.textContent = '⏹ Stop';
    s.els.recBtn.classList.add('recording');
    s.root.classList.add('caRecording');
    say(s, mic ? 'Recording — talk it through and write on the page.' : 'Recording (no microphone).');
  }

  function recStop(s) {
    if (!s.rec) return;
    s.recMs = Date.now() - s.recStart;
    try { if (s.rec.state !== 'inactive') s.rec.stop(); else recDone(s); } catch (e) { recDone(s); }
  }

  function recRelease(s) {
    if (s.recStream) { try { s.recStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} }
    if (s.mic) { try { s.mic.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} }
    s.recStream = null; s.mic = null;
  }

  async function recDone(s) {
    if (!s.rec) return;
    var ms = Math.max(1, s.recMs || (Date.now() - s.recStart));
    s.rec = null;
    recRelease(s);
    if (s.root) s.root.classList.remove('caRecording');
    if (s.els.recBtn) { s.els.recBtn.textContent = '⏺ Record'; s.els.recBtn.classList.remove('recording'); }
    paint(s);
    if (A !== s) return;
    var mime = (s.recMime || 'video/webm').split(';')[0];
    var blob = new global.Blob(s.chunks, { type: mime });
    s.chunks = [];
    if (!blob.size) { say(s, 'Nothing was recorded — try again.'); return; }
    say(s, 'Getting it ready…');
    blob = await finalize(blob, ms, mime);
    if (A !== s) return;
    s.blob = blob; s.recMs = ms;
    s.blobUrl = global.URL.createObjectURL(blob);
    s.els.video.src = s.blobUrl;
    s.els.review.hidden = false;
    s.els.recBtn.hidden = true;
    s.els.clock.textContent = fmtClock(ms);
    say(s, 'Watch it back, then send it — or record again.');
  }

  // A recorder's file has no length and, for MP4, no index; the apps'
  // own finalizers put both in. One that refuses or throws keeps the
  // recording as it was: a video that plays is better than none.
  async function finalize(blob, ms, mime) {
    try {
      if (/mp4/i.test(mime) && global.LessonMp4Finalize && typeof global.LessonMp4Finalize.finalize === 'function') {
        return (await global.LessonMp4Finalize.finalize(blob)) || blob;
      }
      if (/webm/i.test(mime) && global.LessonAudioFinalize && typeof global.LessonAudioFinalize.finalize === 'function') {
        return (await global.LessonAudioFinalize.finalize(blob, Math.max(1, Math.round(ms)))) || blob;
      }
    } catch (e) {}
    return blob;
  }

  function discard(s) {
    if (s.busy) return;
    if (s.blobUrl) { try { global.URL.revokeObjectURL(s.blobUrl); } catch (e) {} }
    s.blob = null; s.blobUrl = '';
    if (s.els.video) { try { s.els.video.removeAttribute('src'); s.els.video.load(); } catch (e) {} }
    s.els.review.hidden = true;
    s.els.recBtn.hidden = false;
    s.els.clock.textContent = '0:00';
    say(s, 'Ready to record again. Your writing is still on the page.');
  }

  /* ---- Sending ---- */
  function storageRefused(e) {
    var c = e && (e.code || '');
    return c === 'storage/unauthorized' || c === 'storage/unauthenticated' || /permission|unauthori[sz]ed/i.test(String(e && e.message || ''));
  }
  function putOnce(st, path, blob, mime, onPct) {
    return new Promise(function (resolve, reject) {
      var task;
      try {
        task = st.ref(path).put(blob, { contentType: mime, cacheControl: 'public, max-age=31536000' });
      } catch (e) { reject(e); return; }
      task.on('state_changed', function (snap) {
        if (snap && snap.totalBytes) onPct(Math.round(snap.bytesTransferred / snap.totalBytes * 100));
      }, reject, function () { resolve(task.snapshot); });
    });
  }
  async function upload(s, blob, mime) {
    var st = store();
    if (!st) throw new Error('Storage is not ready.');
    var ts = Date.now();
    var lastErr = null;
    for (var i = 0; i < DIRS.length; i++) {
      var path = storagePath(DIRS[i], s.id, ts, mime);
      for (var attempt = 0; attempt < 3; attempt++) {
        try {
          var snap = await putOnce(st, path, blob, mime, function (p) { say(s, 'Sending… ' + p + '%'); });
          var url = await snap.ref.getDownloadURL();
          return { url: url, path: path };
        } catch (e) {
          lastErr = e;
          if (storageRefused(e)) break;               // try the other folder
          if (A !== s) throw e;
          await new Promise(function (r) { setTimeout(r, 1500 * (attempt + 1)); });
        }
      }
      if (!storageRefused(lastErr)) break;            // a dropped network is not a reason to change folder
    }
    throw lastErr || new Error('Upload failed.');
  }

  async function sendReply(s) {
    if (!teacherHere()) { toast('Only the teacher can send an answer.'); return; }
    if (A !== s || !s.blob || s.busy || s.sent) return;
    s.busy = true;
    s.els.send.disabled = true; s.els.again.disabled = true;
    var mime = (s.blob.type || s.recMime || 'video/webm').split(';')[0];
    var prevPath = '';
    var gone = false;
    try {
      var up = await upload(s, s.blob, mime);
      if (!replyUrlOk(up.url)) throw new Error('The saved video came back with a link that is not Firebase Storage.');
      var reply = { url: up.url, path: up.path, mime: mime, ms: Math.round(s.recMs), note: cleanLong(s.els.note.value, NOTE_MAX), at: Date.now() };
      var ok = await db().runTransaction(async function (tx) {
        var snap = await tx.get(s.ref);
        if (!snap.exists) { gone = true; return false; }
        var x = snap.data() || {};
        if (['question', 'answered'].indexOf(x.status) < 0) { gone = true; return false; }
        var old = cleanReply(x.reply);
        prevPath = old && old.path ? old.path : '';
        tx.update(s.ref, { status: 'answered', reply: reply, answeredAt: serverStamp(), replySeen: null });
        return true;
      });
      if (!ok) {
        try { await store().ref(up.path).delete(); } catch (e) {}
        throw new Error(gone ? 'The student took that question back, so it was not sent.' : 'Could not save the answer.');
      }
      if (prevPath && prevPath !== up.path) { try { await store().ref(prevPath).delete(); } catch (e) {} }
      s.sent = true;
      try { if (typeof global.usageNote === 'function') global.usageNote('consultAnswer', cleanText(s.data && s.data.worksheetName, 80)); } catch (e) {}
      toast('📨 Sent — ' + (cleanText(s.data && s.data.studentName, NAME_MAX) || 'the student') + ' will see it in Study Buddy.', 5000);
      // Only THIS window: the teacher may have closed it while the answer was
      // uploading and opened the next question, which must stay open.
      if (A === s) close();
    } catch (e) {
      s.busy = false;
      if (s.els.send) s.els.send.disabled = false;
      if (s.els.again) s.els.again.disabled = false;
      say(s, 'Not sent: ' + cleanText(String(e && e.message || e), 200));
    }
  }

  /* ---- Closing ---- */
  // `force` is the way out that asks nothing: an account change or the page
  // going away, where a question nobody can answer would only be in the way.
  // Every other close asks first when there is work in the window that has
  // not gone anywhere — a recording still RUNNING as much as one finished and
  // not sent, because stopping a recording half way through is losing it.
  // A send already on its way is never asked about: it finishes by itself.
  function closeWin(force) {
    var s = A;
    if (!s) return true;
    var unsent = !s.sent && !s.busy && (!!s.blob || !!(s.rec && s.rec.state && s.rec.state !== 'inactive'));
    if (!force && unsent && global.confirm && !global.confirm('Close without sending this recording?')) return false;
    A = null;
    if (s.rec) { try { s.rec.onstop = null; s.rec.ondataavailable = null; if (s.rec.state !== 'inactive') s.rec.stop(); } catch (e) {} s.rec = null; }
    recRelease(s);
    stopCam(s);
    if (s.raf && global.cancelAnimationFrame) { try { global.cancelAnimationFrame(s.raf); } catch (e) {} }
    if (s.blobUrl) { try { global.URL.revokeObjectURL(s.blobUrl); } catch (e) {} }
    if (s.root && s.root.parentNode) s.root.parentNode.removeChild(s.root);
    return true;
  }
  // The window's own ✕, Escape and the send: ask first when it would lose work.
  function close() { return closeWin(false); }
  // Everything down, no questions asked: an account change or the page going.
  function stop() { return closeWin(true); }

  try {
    global.addEventListener('pagehide', function () { stop(); });
  } catch (e) {}

  global.ConsultAnswer = {
    pure: pure,
    open: open,
    askLater: askLater,
    close: close,
    stop: stop,
    // With an id: is THAT question the one open. Without: is any.
    isOpen: function (id) { return !!A && (id == null || A.id === id); },
    _internals: { state: function () { return A; }, paint: paint, teacherHere: teacherHere }
  };
})(typeof window !== 'undefined' ? window : globalThis);
