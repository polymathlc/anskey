/* =====================================================================
   🙋 CONSULT ALERT — a student in Study Buddy asks for help, and the
   teacher, already on Ans Key, is shown a pop-up to join them (v1.149.0)
   — or, when they cannot take the call, a question the student LEFT,
   answered here with a recording (v1.151.0)

   Study Buddy (`polymathlc/tutor`, `consult.js`) owns the whole consult:
   the student's button, the call, the teacher's room, the writing on the
   student's page and the email. This file is the ONE thing Ans Key adds:
   while the teacher is signed in here, every consult WAITING in
   `tutorConsults` is a card in the top-right corner with a Join button,
   and Join opens Study Buddy's room in a new tab on the same link the
   email carries.

   THE RULES THAT HOLD IT TOGETHER
   - ONLY THE TEACHER IS SHOWN IT, AND ONLY AS THEMSELVES. `isAdmin` on the
     signed-in account, and never while the device has been handed to a
     student (`actingStudent`) — a pop-up naming another child on a screen a
     child is using is exactly the leak the handover exists to prevent. The
     listener is detached the moment either stops being true.
   - IT ONLY READS. Nothing here writes `tutorConsults`; the room in Study
     Buddy is what marks a consult joined, so two apps can never disagree
     about whose state it is.
   - FRESHNESS IS STUDY BUDDY'S RULE, PORTED BYTE FOR BYTE
     (`consultFresh`, `WAIT_FRESH_MS`, `SEEN_FRESH_MS`). A consult whose
     device stopped beating, or that was asked for half an hour ago, is not
     a pop-up — the child has very likely gone. `tools/consult-alert-tests.mjs`
     compares the two copies whenever both repositories are side by side.
   - EVERYTHING A STUDENT TYPED IS PAINTED AS TEXT. The name and the
     worksheet's title are fields on a document a client wrote; they go in
     through `textContent` and never `innerHTML`.
   - THE LINK IS BUILT HERE FROM A CHECKED ID, never read off the document,
     so a field somebody wrote cannot send the teacher anywhere else.
   - A CHIME, ONCE PER NEW CONSULT, and silence when the browser refuses
     sound without a tap: the card is the alert, the sound is a courtesy.

   QUESTIONS LEFT INSTEAD (v1.151.0)
   - TWO EQUALITY LISTENERS, ONE LIST: `waiting` (a call) and `question`
     (a question the student left). A card is keyed `id:kind`, because the
     same consult turns from a call into a question and that is a new thing
     to be told about. Calls first, then questions, at most ALERT_SHOW_MAX.
   - A CALL CARD is Join · ✋ Not now · Hide. Not now asks the student to
     leave a question instead; a QUESTION CARD is 📝 Answer · Hide, and
     Answer opens the recorder RIGHT HERE (`consult-answer.js`, the same
     file as Study Buddy's, byte for byte) — the teacher teaches from Ans
     Key, so the answer is made where they already are.
   - THIS FILE STILL WRITES NOTHING. ✋ Not now and the answer's Send are
     `ConsultAnswer.askLater` / the recorder's own transaction; this file
     only calls them, and the harness fails on a write in it.
   - HIDE IS THIS SCREEN'S ALONE. A hidden question stays in the list for
     the next visit and in Study Buddy until it is answered.
   - A HANDOVER TO A STUDENT CLOSES THE RECORDER (`ConsultAnswer.stop`): a
     child's question and its camera are never left open on a screen a
     child is using.

   EVERY CONSULT, KEPT (v1.152.0)
   - 🙋 CONSULTS in the header and 📚 All consults under the cards open
     `ConsultAnswer.openLog` — the same archive as Study Buddy's: every
     call and question, the hidden ones included, and the videos sent.
   - THE BUTTON IS PAINTED BY `render` AND ASKS `teacherHere()`, so it is
     the teacher's alone exactly as the cards are, and its count is the calls
     and questions waiting now. Opening the log is still a read; nothing here writes.
   ===================================================================== */
(function (global) {
  'use strict';

  var COLLECTION = 'tutorConsults';
  var JOIN_BASE = 'https://polymathlc.github.io/tutor/';
  var WAIT_FRESH_MS = 30 * 60 * 1000;
  var SEEN_FRESH_MS = 2 * 60 * 1000;
  var NAME_MAX = 60;
  var TITLE_MAX = 120;
  var TICK_MS = 30 * 1000;
  var ALERT_SHOW_MAX = 4;
  var QUESTION_MAX = 500;

  /* ---------------- Pure helpers (pinned by the harness) ---------------- */
  function consultIdOk(id) {
    return typeof id === 'string' && /^[A-Za-z0-9]{12,40}$/.test(id);
  }

  function consultLink(id) {
    return consultIdOk(id) ? JOIN_BASE + '?consult=' + encodeURIComponent(id) : '';
  }

  function cleanText(s, max) {
    return String(s == null ? '' : s)
      .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max || NAME_MAX);
  }

  function stampMs(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch (e) { return 0; } }
    if (v instanceof Date) return v.getTime();
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  /* Whether a consult is one the teacher should be shown a pop-up for: it
     is waiting, it was asked for recently, and the device that asked for it
     is still there. A stamp in the future (a fast clock) is not "fresh for
     ever"; it is read as now. */
  function consultFresh(data, now) {
    if (!data || data.status !== 'waiting') return false;
    var at = Math.min(stampMs(data.at), now), seen = Math.min(stampMs(data.seen) || at, now);
    if (!at) return false;
    return now - at < WAIT_FRESH_MS && now - seen < SEEN_FRESH_MS;
  }

  function consultAgo(ms) {
    ms = Math.max(0, Number(ms) || 0);
    var m = Math.floor(ms / 60000);
    if (m < 1) return 'just now';
    if (m === 1) return '1 min ago';
    if (m < 60) return m + ' min ago';
    var h = Math.floor(m / 60);
    return h === 1 ? '1 hour ago' : h + ' hours ago';
  }

  function subjectWord(s) {
    var map = { math: 'Maths', science: 'Science', both: 'Maths & Science', english: 'English', chinese: 'Chinese' };
    return map[s] || s;
  }

  function consultSummary(data) {
    if (!data) return '';
    var bits = [];
    var lvl = cleanText(data.level, 12), sub = cleanText(data.subject, 20);
    if (lvl || sub) bits.push([lvl, subjectWord(sub)].filter(Boolean).join(' '));
    var title = cleanText(data.worksheetName, TITLE_MAX);
    if (title) bits.push(title);
    var page = data.view && Number(data.view.page);
    if (page >= 1) bits.push('page ' + page);
    return bits.join(' · ');
  }

  /* The cards to show, oldest first: the child who has waited longest is
     the one at the top. Dismissed and stale consults are not shown, and a
     malformed id is never a card, because the card's link is built from it. */
  function waitingList(items, dismissed, now) {
    items = items || {}; dismissed = dismissed || {};
    return Object.keys(items)
      .filter(function (id) { return consultIdOk(id) && !dismissed[id] && consultFresh(items[id], now); })
      .map(function (id) { return { id: id, data: items[id] }; })
      .sort(function (a, b) { return stampMs(a.data.at) - stampMs(b.data.at); });
  }

  function cardWords(item) {
    var d = (item && item.data) || {};
    return {
      title: (cleanText(d.studentName, NAME_MAX) || 'A student') + (d.teacherLeft ? ' is waiting for you to come back' : ' is asking for help'),
      where: cleanText(consultSummary(d), 200)
    };
  }

  /* A question card's words. The recorder's own `questionWords` when it is
     loaded (one wording in both apps), a plain fallback when it is not. */
  function questionCardWords(item) {
    var d = (item && item.data) || {};
    var CA = global.ConsultAnswer && global.ConsultAnswer.pure;
    if (CA && typeof CA.questionWords === 'function') {
      var w = CA.questionWords(d);
      return { title: w.title, where: cleanText(w.where, 200), text: w.text || '' };
    }
    var q = d.question && typeof d.question === 'object' ? d.question : {};
    var text = String(q.text == null ? '' : q.text).replace(/[\u0000-\u0009\u000B-\u001F\u007F]+/g, ' ').trim().slice(0, QUESTION_MAX);
    return { title: (cleanText(d.studentName, NAME_MAX) || 'A student') + ' left a question', where: cleanText(consultSummary(d), 200), text: text };
  }
  function questionFresh(data, now) {
    var CA = global.ConsultAnswer && global.ConsultAnswer.pure;
    if (CA && typeof CA.questionFresh === 'function') return CA.questionFresh(data, now);
    return !!data && data.status === 'question';
  }
  function questionAt(data) {
    var q = data && data.question;
    return stampMs(q && q.at) || stampMs(data && data.at);
  }
  function questionAgo(ms) {
    var CA = global.ConsultAnswer && global.ConsultAnswer.pure;
    if (CA && typeof CA.questionAgo === 'function') return CA.questionAgo(ms);
    return consultAgo(ms);
  }

  /* Every card there is to show: the calls (`waitingList`'s rule) first,
     then the questions, each oldest first. `items` is keyed `id:kind`. */
  function alertList(items, dismissed, now) {
    items = items || {}; dismissed = dismissed || {};
    var out = Object.keys(items)
      .map(function (k) { return items[k]; })
      .filter(function (it) {
        if (!it || !consultIdOk(it.id) || dismissed[it.key]) return false;
        return it.kind === 'question' ? questionFresh(it.data, now) : consultFresh(it.data, now);
      });
    out.sort(function (a, b) {
      if (a.kind !== b.kind) return a.kind === 'call' ? -1 : 1;
      var ta = a.kind === 'question' ? questionAt(a.data) : stampMs(a.data.at);
      var tb = b.kind === 'question' ? questionAt(b.data) : stampMs(b.data.at);
      return ta - tb;
    });
    return out;
  }

  function titleWith(base, n) {
    base = String(base || '').replace(/^🙋 \(\d+\) /, '');
    return n > 0 ? '🙋 (' + n + ') ' + base : base;
  }

  /* ---------------- State ---------------- */
  var W = { unsub: null, unsubQ: null, tick: null, items: {}, dismissed: {}, seen: {}, root: null, ac: null, uid: '' };

  function now() { return Date.now(); }

  function teacherHere() {
    try {
      var u = global.currentUser;
      if (!u || typeof global.isAdmin !== 'function' || !global.isAdmin(u)) return false;
      if (global.actingStudent) return false;
      return true;
    } catch (e) { return false; }
  }

  function el(tag, cls, text) {
    var n = global.document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function chime() {
    try {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      var ac = W.ac || (W.ac = new AC());
      if (ac.state === 'suspended' && ac.resume) ac.resume().catch(function () {});
      [[880, 0], [1320, 0.16]].forEach(function (n) {
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.value = n[0];
        g.gain.setValueAtTime(0.0001, ac.currentTime + n[1]);
        g.gain.exponentialRampToValueAtTime(0.18, ac.currentTime + n[1] + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + n[1] + 0.32);
        o.connect(g); g.connect(ac.destination);
        o.start(ac.currentTime + n[1]); o.stop(ac.currentTime + n[1] + 0.35);
      });
    } catch (e) {}
  }

  function answerApi() {
    var CA = global.ConsultAnswer;
    return CA && typeof CA.open === 'function' && teacherHere() ? CA : null;
  }

  function btn(text, cls, title, onClick) {
    var b = el('button', 'btn btnSm' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  function join(id) {
    var link = consultLink(id);
    if (!link) return;
    W.dismissed[id + ':call'] = true;
    var win = null;
    try { win = global.open(link, '_blank'); } catch (e) {}
    // A blocked pop-up is not a reason to lose the consult: go there instead.
    if (!win) { try { global.location.href = link; } catch (e) {} }
    render();
  }

  /* ---- 🙋 Consults: every call and question, kept (v1.152.0) ----
     The list itself is ConsultAnswer.openLog (Study Buddy's file, byte for
     byte). This file only shows the button and opens it; Join from the list
     goes through join() above, which opens the consult in Study Buddy. */
  function logApi() {
    var CA = global.ConsultAnswer;
    return CA && typeof CA.openLog === 'function' && teacherHere() ? CA : null;
  }
  function openLog() {
    var api = logApi();
    if (!api) return false;
    return api.openLog({ join: join });
  }
  // The count includes the cards the teacher HID: Hide is "not now", and
  // this button is where they are found again.
  function waitingCount() {
    return teacherHere() ? alertList(W.items, {}, now()).length : 0;
  }
  /* ---- 🙋 The student's side (v1.157.0) ----
     A student signed in to Ans Key gets the same 🙋 Consults button: their
     window to ASK (ConsultAnswer.openLibrary with `ask: 'anskey'` — a typed
     question and a photo, saved as the same `question` consult Study Buddy
     leaves) and to watch every video answer, wherever it was asked. The
     count is the answers not watched yet. This file still writes nothing:
     the question and the "seen" are ConsultAnswer's. A teacher who has
     handed the device to a student (`actingStudent`) is still signed in as
     the teacher, so there is no student here then — asking needs the
     student's own account. */
  var SB = { uid: '', unsub: null, docs: [] };
  function studentHere() {
    var u = global.currentUser;
    try {
      if (!u || !u.uid || u.isAnonymous) return false;
      return !(typeof global.isAdmin === 'function' && global.isAdmin(u));
    } catch (e) { return false; }
  }
  function libApi() {
    var CA = global.ConsultAnswer;
    return CA && typeof CA.openLibrary === 'function' && studentHere() ? CA : null;
  }
  function openLibrary() {
    var api = libApi();
    if (!api) return false;
    return api.openLibrary({ ask: 'anskey' });
  }
  function studentUnseen(docs) {
    var n = 0;
    (docs || []).forEach(function (d) { if (d && d.status === 'answered' && d.reply && !d.replySeen) n++; });
    return n;
  }
  function studentStop() {
    if (SB.unsub) { try { SB.unsub(); } catch (e) {} }
    SB.unsub = null; SB.uid = ''; SB.docs = [];
  }
  function studentSync() {
    var uid = studentHere() ? global.currentUser.uid : '';
    if (uid === SB.uid && (SB.unsub || !uid)) { syncLogButton(); return; }
    studentStop();
    if (!uid) { syncLogButton(); return; }
    var db = global.db;
    SB.uid = uid;
    if (db && typeof db.collection === 'function') {
      try {
        SB.unsub = db.collection(COLLECTION).where('studentUid', '==', uid).onSnapshot(function (qs) {
          if (SB.uid !== uid) return;
          SB.docs = (qs.docs || []).map(function (d) { return d.data() || {}; });
          syncLogButton();
        }, function (err) { console.warn('consult: your answers', err); });
      } catch (e) { console.warn('consult: your answers', e); }
    }
    syncLogButton();
  }

  function syncLogButton() {
    var doc = global.document;
    var b = doc && doc.getElementById ? doc.getElementById('consultLogBtn') : null;
    if (!b) return;
    if (!b._consultBound) {
      b._consultBound = true;
      b.addEventListener('click', function () { if (!openLog()) openLibrary(); });
    }
    var teacher = !!logApi(), student = !teacher && !!libApi();
    var on = teacher || student;
    b.style.display = on ? '' : 'none';
    if (!on) return;
    var n = teacher ? waitingCount() : studentUnseen(SB.docs);
    var label = b.querySelector ? b.querySelector('.btnLabel') : null;
    var words = 'Consults' + (n ? ' · ' + n + (student ? ' new' : '') : '');
    if (label) label.textContent = words; else b.textContent = '🙋 ' + words;
    b.title = teacher
      ? (n ? n + ' waiting — every call and question students have sent you'
        : 'Every call and question students have sent you, and the videos you answered with')
      : (n ? n + ' new video answer' + (n === 1 ? '' : 's') + ' from Mr Chung'
        : 'Ask Mr Chung a question, and watch his video answers');
    if (b.classList) b.classList.toggle('consultOn', n > 0);
  }

  function render() {
    syncLogButton();
    var doc = global.document;
    if (!doc || !doc.body) return;
    var list = teacherHere() ? alertList(W.items, W.dismissed, now()) : [];
    try { doc.title = titleWith(doc.title, list.length); } catch (e) {}
    if (!list.length) {
      if (W.root && W.root.parentNode) W.root.parentNode.removeChild(W.root);
      W.root = null;
      return;
    }
    if (!W.root || !W.root.isConnected) {
      W.root = el('div', 'consultAlerts');
      W.root.setAttribute('role', 'region');
      W.root.setAttribute('aria-label', 'Students asking for help');
      doc.body.appendChild(W.root);
    }
    while (W.root.firstChild) W.root.removeChild(W.root.firstChild);
    var t = now();
    list.slice(0, ALERT_SHOW_MAX).forEach(function (item) {
      W.root.appendChild(item.kind === 'question' ? questionCard(item, t) : callCard(item, t));
    });
    if (list.length > ALERT_SHOW_MAX) {
      W.root.appendChild(el('div', 'consultAlertMore', '+ ' + (list.length - ALERT_SHOW_MAX) + ' more waiting — hide one to see the next'));
    }
    if (logApi()) {
      W.root.appendChild(btn('📚 All consults', 'consultAlertAll', 'Every call and question, including the ones you hid', function () { openLog(); }));
    }
  }

  function hide(item) { W.dismissed[item.key] = true; render(); }

  function callCard(item, t) {
    var words = cardWords(item);
    var card = el('div', 'consultAlert');
    card.setAttribute('role', 'alert');
    var top = el('div', 'consultAlertTop');
    top.appendChild(el('span', 'consultAlertIcon', '🙋'));
    var box = el('div', 'consultAlertWords');
    box.appendChild(el('b', '', words.title));
    box.appendChild(el('span', 'consultAlertWhere', [words.where, consultAgo(t - stampMs(item.data.at))].filter(Boolean).join(' · ')));
    top.appendChild(box);
    card.appendChild(top);
    var row = el('div', 'consultAlertRow');
    row.appendChild(btn('Hide', 'consultAlertLater', 'Hide this pop-up — the email still has the link', function () { hide(item); }));
    var api = answerApi();
    if (api && typeof api.askLater === 'function') {
      var later = btn('✋ Not now', 'consultAlertNotNow', 'Ask them to show you the question instead — you answer it later with a recording', async function () {
        later.disabled = true;
        var ok = false;
        try { ok = await api.askLater(item.id); } catch (e) { ok = false; }
        if (ok) hide(item); else later.disabled = false;
      });
      row.appendChild(later);
    }
    row.appendChild(btn('Join', 'btnPrimary consultAlertJoin', 'Open the consult in Study Buddy and connect to them', function () { join(item.id); }));
    card.appendChild(row);
    return card;
  }

  function questionCard(item, t) {
    var words = questionCardWords(item);
    var card = el('div', 'consultAlert consultAlertQ');
    card.setAttribute('role', 'alert');
    var top = el('div', 'consultAlertTop');
    top.appendChild(el('span', 'consultAlertIcon', '📝'));
    var box = el('div', 'consultAlertWords');
    box.appendChild(el('b', '', words.title));
    box.appendChild(el('span', 'consultAlertWhere', [words.where, questionAgo(t - questionAt(item.data))].filter(Boolean).join(' · ')));
    // What the student wrote, painted as text and cut short on the card; the
    // recorder shows all of it.
    if (words.text) {
      var short = words.text.length > 140 ? words.text.slice(0, 139).trim() + '…' : words.text;
      box.appendChild(el('span', 'consultAlertQText', '“' + short + '”'));
    }
    top.appendChild(box);
    card.appendChild(top);
    var row = el('div', 'consultAlertRow');
    row.appendChild(btn('Hide', 'consultAlertLater', 'Hide this for now — it stays in your list', function () { hide(item); }));
    var api = answerApi();
    if (api) {
      row.appendChild(btn('📝 Answer', 'btnPrimary consultAlertAnswer', 'Write on their page and record your answer', function () { api.open(item.id); }));
    } else {
      // No recorder loaded (a blocked file): Study Buddy answers it too.
      row.appendChild(btn('Open in Study Buddy', 'btnPrimary consultAlertJoin', 'Answer it in Study Buddy', function () { join(item.id); }));
    }
    card.appendChild(row);
    return card;
  }

  function stop() {
    if (W.unsub) { try { W.unsub(); } catch (e) {} }
    if (W.unsubQ) { try { W.unsubQ(); } catch (e) {} }
    if (W.tick) clearInterval(W.tick);
    W.unsub = null; W.unsubQ = null; W.tick = null; W.items = {};
    render();
  }

  function start() {
    stop();
    var db = global.db;
    if (!db || typeof db.collection !== 'function' || !teacherHere()) return;
    // A limited or stubbed db (a share link, a harness) must never throw
    // into applyRoleUI: the pop-up is a courtesy, the role setup is not.
    var listen = function (status, kind) {
      var query = null;
      try {
        var coll = db.collection(COLLECTION);
        query = coll && typeof coll.where === 'function' ? coll.where('status', '==', status) : null;
      } catch (e) { query = null; }
      if (!query || typeof query.onSnapshot !== 'function') return null;
      try {
        return query.onSnapshot(function (qs) {
          if (!teacherHere()) { stop(); return; }
          var t = now();
          var next = {};
          Object.keys(W.items).forEach(function (k) { if (W.items[k].kind !== kind) next[k] = W.items[k]; });
          var fresh = [];
          (qs.docs || []).forEach(function (d) {
            if (!consultIdOk(d.id)) return;
            var key = d.id + ':' + kind;
            var data = d.data() || {};
            next[key] = { key: key, id: d.id, kind: kind, data: data };
            var isFresh = kind === 'question' ? questionFresh(data, t) : consultFresh(data, t);
            if (!W.seen[key] && isFresh) fresh.push(key);
          });
          W.items = next;
          fresh.forEach(function (k) { W.seen[k] = true; });
          if (fresh.length) chime();
          render();
        }, function (err) { console.warn('consult alert: the ' + kind + ' list could not be read', err); });
      } catch (e) { console.warn('consult alert: could not listen', e); return null; }
    };
    W.unsub = listen('waiting', 'call');
    if (!W.unsub) return;
    W.unsubQ = listen('question', 'question');
    // The cards age ("2 min ago") and a stale one drops off without a snapshot.
    W.tick = setInterval(render, TICK_MS);
  }

  /* Called on every sign-in change AND every role change (a handover to a
     student and back is a role change on the same account). */
  function roleChanged() {
    studentSync();
    var here = teacherHere();
    var uid = here && global.currentUser ? global.currentUser.uid : '';
    if (uid !== W.uid) { W.dismissed = {}; W.seen = {}; }
    W.uid = uid;
    if (!here) {
      stop();
      // A handover to a student, or a sign-out: the recorder, its camera and
      // the child's question it holds come down with the cards.
      try { if (global.ConsultAnswer && typeof global.ConsultAnswer.stop === 'function') global.ConsultAnswer.stop(); } catch (e) {}
      return;
    }
    if (!W.unsub) start(); else render();
  }

  global.ConsultAlert = {
    roleChanged: roleChanged,
    render: render,
    openLog: openLog,
    openLibrary: openLibrary,
    stop: stop,
    pure: {
      COLLECTION: COLLECTION, JOIN_BASE: JOIN_BASE, WAIT_FRESH_MS: WAIT_FRESH_MS, SEEN_FRESH_MS: SEEN_FRESH_MS,
      consultIdOk: consultIdOk, consultLink: consultLink, cleanText: cleanText, stampMs: stampMs,
      consultFresh: consultFresh, consultAgo: consultAgo, subjectWord: subjectWord, consultSummary: consultSummary,
      waitingList: waitingList, cardWords: cardWords, titleWith: titleWith,
      ALERT_SHOW_MAX: ALERT_SHOW_MAX, alertList: alertList, questionCardWords: questionCardWords,
      studentUnseen: studentUnseen
    },
    _internals: { W: W, teacherHere: teacherHere, join: join, answerApi: answerApi, logApi: logApi, waitingCount: waitingCount,
      SB: SB, studentHere: studentHere, libApi: libApi, studentSync: studentSync }
  };
})(typeof window !== 'undefined' ? window : globalThis);
