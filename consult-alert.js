/* =====================================================================
   🙋 CONSULT ALERT — a student in Study Buddy asks for help, and the
   teacher, already on Ans Key, is shown a pop-up to join them (v1.149.0)

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

  function titleWith(base, n) {
    base = String(base || '').replace(/^🙋 \(\d+\) /, '');
    return n > 0 ? '🙋 (' + n + ') ' + base : base;
  }

  /* ---------------- State ---------------- */
  var W = { unsub: null, tick: null, items: {}, dismissed: {}, seen: {}, root: null, ac: null, uid: '' };

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

  function join(id) {
    var link = consultLink(id);
    if (!link) return;
    W.dismissed[id] = true;
    var win = null;
    try { win = global.open(link, '_blank'); } catch (e) {}
    // A blocked pop-up is not a reason to lose the consult: go there instead.
    if (!win) { try { global.location.href = link; } catch (e) {} }
    render();
  }

  function render() {
    var doc = global.document;
    if (!doc || !doc.body) return;
    var list = teacherHere() ? waitingList(W.items, W.dismissed, now()) : [];
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
    list.forEach(function (item) {
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
      var later = el('button', 'btn btnSm consultAlertLater', 'Later');
      later.type = 'button';
      later.title = 'Hide this pop-up — the email still has the link';
      later.addEventListener('click', function () { W.dismissed[item.id] = true; render(); });
      var go = el('button', 'btn btnSm btnPrimary consultAlertJoin', 'Join');
      go.type = 'button';
      go.title = 'Open the consult in Study Buddy and connect to them';
      go.addEventListener('click', function () { join(item.id); });
      row.appendChild(later);
      row.appendChild(go);
      card.appendChild(row);
      W.root.appendChild(card);
    });
  }

  function stop() {
    if (W.unsub) { try { W.unsub(); } catch (e) {} }
    if (W.tick) clearInterval(W.tick);
    W.unsub = null; W.tick = null; W.items = {};
    render();
  }

  function start() {
    stop();
    var db = global.db;
    if (!db || typeof db.collection !== 'function' || !teacherHere()) return;
    W.unsub = db.collection(COLLECTION).where('status', '==', 'waiting').onSnapshot(function (qs) {
      if (!teacherHere()) { stop(); return; }
      var next = {};
      (qs.docs || []).forEach(function (d) { next[d.id] = d.data() || {}; });
      var t = now();
      var fresh = Object.keys(next).filter(function (id) { return consultIdOk(id) && !W.seen[id] && consultFresh(next[id], t); });
      W.items = next;
      fresh.forEach(function (id) { W.seen[id] = true; });
      if (fresh.length) chime();
      render();
    }, function (err) { console.warn('consult alert: the waiting list could not be read', err); });
    // The cards age ("2 min ago") and a stale one drops off without a snapshot.
    W.tick = setInterval(render, TICK_MS);
  }

  /* Called on every sign-in change AND every role change (a handover to a
     student and back is a role change on the same account). */
  function roleChanged() {
    var here = teacherHere();
    var uid = here && global.currentUser ? global.currentUser.uid : '';
    if (uid !== W.uid) { W.dismissed = {}; W.seen = {}; }
    W.uid = uid;
    if (!here) { stop(); return; }
    if (!W.unsub) start(); else render();
  }

  global.ConsultAlert = {
    roleChanged: roleChanged,
    render: render,
    stop: stop,
    pure: {
      COLLECTION: COLLECTION, JOIN_BASE: JOIN_BASE, WAIT_FRESH_MS: WAIT_FRESH_MS, SEEN_FRESH_MS: SEEN_FRESH_MS,
      consultIdOk: consultIdOk, consultLink: consultLink, cleanText: cleanText, stampMs: stampMs,
      consultFresh: consultFresh, consultAgo: consultAgo, subjectWord: subjectWord, consultSummary: consultSummary,
      waitingList: waitingList, cardWords: cardWords, titleWith: titleWith
    },
    _internals: { W: W, teacherHere: teacherHere, join: join }
  };
})(typeof window !== 'undefined' ? window : globalThis);
