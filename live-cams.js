/* =====================================================================
   📹 LIVE CAMERAS — students show their answers on camera, the teacher
   watches every one of them live in a window of tiles.
   ---------------------------------------------------------------------
   The teacher opens 📹 Live cams. That writes ONE room document
   (`liveCamRooms/main`) with a fresh `epoch` and a heartbeat. Every
   signed-in student device listens to that document; while the room is
   open and fresh it offers a "Share my camera" card. Nothing is ever
   opened without that tap.

   A student who taps it writes a PEER document under the room
   (`liveCamRooms/main/peers/{peerId}`) carrying a WebRTC offer, and the
   teacher's window answers it. Firestore is only the signalling channel:
   the video itself goes browser to browser. When the two cannot reach
   each other (a school network that blocks UDP, an old browser with no
   RTCPeerConnection) the student falls back to SNAPSHOTS — a JPEG of the
   camera written onto the same peer document every SNAP_MS — so the
   teacher still sees the work, just not at video frame rate.

   THE RULES THIS FILE KEEPS
   - The camera opens only on a tap, and EVERY way out lets go of it:
     Stop, the teacher closing the room, the teacher removing the tile,
     the room going stale (teacher's tab died), an account or role change,
     and pagehide. A camera light left on over a child is the one failure
     here nobody forgives.
   - What the teacher receives is NEVER mirrored. The student's own
     preview may be (it is a mirror for holding paper up), the stream is
     not, or every word held up to the lens reads backwards.
   - The teacher's view is the teacher's: `role()` is asked in every
     handler, not only when the button is drawn.
   - Pure helpers are exported on `LiveCams.pure` so tools/live-cams-tests
     can pin the arithmetic without a browser; tools/live-cams-check.mjs
     runs a real teacher and a real student in Chromium with a fake camera.
   ===================================================================== */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------
     Constants
     --------------------------------------------------------------- */
  var ROOM_COLLECTION = 'liveCamRooms';
  var ROOM_ID = 'main';
  var PEERS = 'peers';

  var ROOM_BEAT_MS = 15000;     // the teacher's window re-stamps the room this often
  var ROOM_STALE_MS = 75000;    // …and a room not stamped for this long is closed
  var PEER_BEAT_MS = 10000;     // a sharing student re-stamps its peer this often
  var PEER_STALE_MS = 35000;    // a tile not stamped for this long is greyed out
  var PEER_GONE_MS = 120000;    // …and one not stamped for this long is cleared away
  var RTC_TIMEOUT_MS = 15000;   // no video by then and snapshots are asked for
  var TICK_MS = 2500;           // how often statuses are re-read on both sides
  var SNAP_MS = 1500;           // one snapshot this often while in snapshot mode
  var SNAP_QUALITY = 0.62;
  var SNAP_MAX_CHARS = 760000;  // a Firestore document dies at ~1 MB
  var NAME_MAX = 40;
  var WS_NAME_MAX = 80;
  var TILE_MIN_PX = 220;        // the narrowest a tile gets before the grid wraps

  var QUALITY = {
    normal: { label: 'Normal', maxBitrate: 600000, maxWidth: 960, snapPx: 720 },
    sharp: { label: 'Sharp (reads small writing)', maxBitrate: 1800000, maxWidth: 1280, snapPx: 1024 }
  };

  var ICE_DEFAULT = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

  var STATUS_TEXT = {
    live: 'Live',
    snap: 'Snapshots',
    connecting: 'Connecting…',
    failed: 'Could not connect',
    stale: 'Not responding',
    gone: 'Left'
  };

  /* ---------------------------------------------------------------
     Pure helpers — no DOM, no network, pinned by the tests
     --------------------------------------------------------------- */

  /* A name typed by a child, or read off a profile, is shown on the
     teacher's screen: one line, no control characters, never empty. */
  function cleanName(s, fallback) {
    var t = String(s == null ? '' : s)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (t.length > NAME_MAX) t = t.slice(0, NAME_MAX).trim();
    return t || (fallback == null ? '' : String(fallback));
  }

  function cleanWs(ws) {
    if (!ws || typeof ws !== 'object') return null;
    var id = typeof ws.id === 'string' ? ws.id.slice(0, 120) : '';
    var name = cleanName(ws.name, '');
    if (name.length > WS_NAME_MAX) name = name.slice(0, WS_NAME_MAX);
    if (!id && !name) return null;
    return { id: id, name: name };
  }

  function newId(prefix) {
    var a = '';
    try {
      var buf = new Uint8Array(9);
      (root.crypto || {}).getRandomValues(buf);
      for (var i = 0; i < buf.length; i++) a += ('0' + buf[i].toString(16)).slice(-2);
    } catch (e) {
      a = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }
    return (prefix || '') + Date.now().toString(36) + a.slice(0, 12);
  }

  /* An open room is only an open room while somebody is stamping it. A
     teacher's tab that crashed leaves `open: true` behind for ever, and a
     student offered the camera by it would be filming for nobody. A stamp
     from the FUTURE is distrusted the same way (a device clock set wrong). */
  function roomFresh(room, now) {
    if (!room || room.open !== true) return false;
    if (typeof room.epoch !== 'string' || !room.epoch) return false;
    var beat = Number(room.heartbeat);
    if (!isFinite(beat)) return false;
    return now - beat < ROOM_STALE_MS && beat - now < ROOM_STALE_MS;
  }

  function qualityOf(room) {
    return room && room.quality === 'sharp' ? 'sharp' : 'normal';
  }

  /* What a student's sender is asked to send at a quality. The scale is
     never below 1: a camera narrower than the target is sent as it is. */
  function encodingFor(quality, trackWidth) {
    var q = QUALITY[quality] || QUALITY.normal;
    var w = Number(trackWidth) || 0;
    var scale = w > q.maxWidth ? w / q.maxWidth : 1;
    return { maxBitrate: q.maxBitrate, scaleResolutionDownBy: Math.round(scale * 1000) / 1000 };
  }

  /* An ICE candidate travels as a string, tagged with the negotiation it
     belongs to. A renegotiation bumps `rev`, and a candidate left over from
     the last one must never be handed to the new connection. */
  function packCandidate(c, rev) {
    if (!c || !c.candidate) return '';
    return JSON.stringify({
      r: rev,
      c: String(c.candidate),
      m: c.sdpMid == null ? null : String(c.sdpMid),
      i: c.sdpMLineIndex == null ? null : Number(c.sdpMLineIndex)
    });
  }

  /* The candidates in `list` for `rev` that `seen` has not yet marked.
     Marks what it returns, so a snapshot re-delivering the whole array
     never adds a candidate twice. Anything malformed is skipped. */
  function unpackCandidates(list, rev, seen) {
    var out = [];
    if (!Array.isArray(list)) return out;
    seen = seen || {};
    for (var i = 0; i < list.length; i++) {
      var raw = list[i];
      if (typeof raw !== 'string' || seen[raw]) continue;
      var v = null;
      try { v = JSON.parse(raw); } catch (e) { v = null; }
      if (!v || v.r !== rev || typeof v.c !== 'string' || !v.c) continue;
      seen[raw] = true;
      out.push({ candidate: v.c, sdpMid: v.m == null ? null : v.m, sdpMLineIndex: v.i == null ? null : v.i });
    }
    return out;
  }

  /* What one tile is showing, in one word. Video beats a snapshot, a
     snapshot beats waiting, and a peer that has stopped stamping is stale
     whatever its connection last said. */
  function peerStatus(peer, now, rtcState) {
    if (!peer) return 'gone';
    var seen = Number(peer.seen);
    var age = isFinite(seen) ? now - seen : Infinity;
    if (age > PEER_GONE_MS) return 'gone';
    if (age > PEER_STALE_MS) return 'stale';
    if (rtcState === 'connected') return 'live';
    var snapAt = Number(peer.snapAt);
    if (peer.snap && isFinite(snapAt) && now - snapAt < PEER_STALE_MS) return 'snap';
    if (rtcState === 'failed') return 'failed';
    return 'connecting';
  }

  function statusLabel(status) {
    return STATUS_TEXT[status] || STATUS_TEXT.connecting;
  }

  /* A peer wants an answer when it carries an offer for a negotiation the
     teacher has not answered yet. */
  function needsAnswer(peer, handledRev) {
    if (!peer || !peer.offer || typeof peer.offer.sdp !== 'string' || !peer.offer.sdp) return false;
    var rev = Number(peer.rev);
    if (!isFinite(rev)) return false;
    return rev !== handledRev;
  }

  /* As square a grid as the window allows: as many columns as fit at
     TILE_MIN_PX, then evened out so the last row is not one lonely tile
     under a row of four. */
  function gridColumns(n, width, minTile) {
    n = Math.max(0, Math.floor(Number(n) || 0));
    if (n <= 1) return 1;
    var min = Number(minTile) || TILE_MIN_PX;
    var fit = Math.max(1, Math.floor((Number(width) || 0) / min));
    var cols = Math.min(n, fit);
    var rows = Math.ceil(n / cols);
    return Math.max(1, Math.ceil(n / rows));
  }

  /* The size a snapshot is drawn at: the long side capped at `max`, the
     shape kept, never enlarged, never zero. */
  function snapshotSize(w, h, max) {
    w = Number(w) || 0; h = Number(h) || 0; max = Number(max) || 720;
    if (w <= 0 || h <= 0) return { w: 0, h: 0 };
    var s = Math.min(1, max / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
  }

  /* A rotated picture inside a box: how much to scale it so a quarter
     turn still fits rather than spilling out of the tile. */
  function rotateFit(boxW, boxH, mediaW, mediaH, deg) {
    if (!(boxW > 0 && boxH > 0 && mediaW > 0 && mediaH > 0)) return 1;
    var quarter = ((deg % 180) + 180) % 180 === 90;
    if (!quarter) return 1;
    var plain = Math.min(boxW / mediaW, boxH / mediaH);
    var turned = Math.min(boxW / mediaH, boxH / mediaW);
    return Math.round((turned / plain) * 10000) / 10000;
  }

  function nextRotation(deg) {
    return (((Number(deg) || 0) + 90) % 360 + 360) % 360;
  }

  function sortPeers(list) {
    return (list || []).slice().sort(function (a, b) {
      var an = cleanName(a && a.name, '').toLowerCase(), bn = cleanName(b && b.name, '').toLowerCase();
      if (an !== bn) return an < bn ? -1 : 1;
      var ai = String(a && a.id || ''), bi = String(b && b.id || '');
      return ai < bi ? -1 : ai > bi ? 1 : 0;
    });
  }

  /* "3 live · 1 snapshots · 1 connecting" — the window's one-line count. */
  function summarize(statuses) {
    var order = ['live', 'snap', 'connecting', 'failed', 'stale'];
    var counts = {};
    (statuses || []).forEach(function (s) { counts[s] = (counts[s] || 0) + 1; });
    var parts = [];
    order.forEach(function (k) {
      if (counts[k]) parts.push(counts[k] + ' ' + statusLabel(k).replace('…', '').toLowerCase());
    });
    return parts.length ? parts.join(' · ') : 'Nobody is sharing yet';
  }

  /* A snapshot that will not fit a document is not written at all. */
  function snapFits(dataUrl) {
    return typeof dataUrl === 'string' && /^data:image\/(jpeg|webp|png);base64,/.test(dataUrl) &&
      dataUrl.length <= SNAP_MAX_CHARS;
  }

  /* A file name for a saved frame: the student and the time, nothing a
     file system refuses. */
  function frameFileName(name, when) {
    var d = new Date(Number(when) || Date.now());
    var pad = function (n) { return ('0' + n).slice(-2); };
    var stamp = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    var who = cleanName(name, 'Student').replace(/[\\/:*?"<>|]+/g, '').trim() || 'Student';
    return who + ' ' + stamp + '.jpg';
  }

  var pure = {
    ROOM_COLLECTION: ROOM_COLLECTION, ROOM_ID: ROOM_ID, PEERS: PEERS,
    ROOM_BEAT_MS: ROOM_BEAT_MS, ROOM_STALE_MS: ROOM_STALE_MS,
    PEER_BEAT_MS: PEER_BEAT_MS, PEER_STALE_MS: PEER_STALE_MS, PEER_GONE_MS: PEER_GONE_MS,
    RTC_TIMEOUT_MS: RTC_TIMEOUT_MS, SNAP_MS: SNAP_MS, SNAP_MAX_CHARS: SNAP_MAX_CHARS,
    NAME_MAX: NAME_MAX, QUALITY: QUALITY,
    cleanName: cleanName, cleanWs: cleanWs, newId: newId, roomFresh: roomFresh,
    qualityOf: qualityOf, encodingFor: encodingFor, packCandidate: packCandidate,
    unpackCandidates: unpackCandidates, peerStatus: peerStatus, statusLabel: statusLabel,
    needsAnswer: needsAnswer, gridColumns: gridColumns, snapshotSize: snapshotSize,
    rotateFit: rotateFit, nextRotation: nextRotation, sortPeers: sortPeers,
    summarize: summarize, snapFits: snapFits, frameFileName: frameFileName
  };

  /* ---------------------------------------------------------------
     Small DOM helpers
     --------------------------------------------------------------- */
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, String(v));
      });
    }
    (kids || []).forEach(function (k) {
      if (k == null) return;
      el.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
    });
    return el;
  }

  function stopStream(stream) {
    if (!stream) return;
    try { stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); } catch (e) {}
  }

  function closePc(pc) {
    if (!pc) return;
    try { pc.ontrack = pc.onicecandidate = pc.onconnectionstatechange = pc.oniceconnectionstatechange = null; } catch (e) {}
    try { pc.close(); } catch (e) {}
  }

  function sdpOf(desc) {
    return desc ? { type: String(desc.type), sdp: String(desc.sdp) } : null;
  }

  /* Draws whatever a <video> or <img> is showing, turned by `deg`, onto a
     canvas no larger than `max` on its long side. */
  function drawFrame(media, deg, max) {
    var w = media.videoWidth || media.naturalWidth || 0;
    var hh = media.videoHeight || media.naturalHeight || 0;
    if (!w || !hh) return null;
    var size = snapshotSize(w, hh, max || 1600);
    var quarter = ((deg % 180) + 180) % 180 === 90;
    var cv = document.createElement('canvas');
    cv.width = quarter ? size.h : size.w;
    cv.height = quarter ? size.w : size.h;
    var ctx = cv.getContext('2d');
    ctx.translate(cv.width / 2, cv.height / 2);
    ctx.rotate((deg || 0) * Math.PI / 180);
    ctx.drawImage(media, -size.w / 2, -size.h / 2, size.w, size.h);
    return cv;
  }

  function canvasBlob(cv, quality) {
    return new Promise(function (resolve) {
      if (!cv) { resolve(null); return; }
      try {
        cv.toBlob(function (b) { resolve(b || null); }, 'image/jpeg', quality || 0.9);
      } catch (e) { resolve(null); }
    });
  }

  /* =================================================================
     The controller — one per page in the app; the browser check makes
     a teacher and a student side by side in one page with a fake store.
     ================================================================= */
  function create(env) {
    env = env || {};
    var P = env.prefix || 'lc';
    var db = env.db;
    var now = env.now || function () { return Date.now(); };
    var toast = env.toast || function () {};
    var ice = env.iceServers || root.LIVE_CAM_ICE || ICE_DEFAULT;
    var RTC = env.RTCPeerConnection === undefined ? root.RTCPeerConnection : env.RTCPeerConnection;
    var media = env.mediaDevices || (root.navigator && root.navigator.mediaDevices) || null;
    var arrayUnion = env.arrayUnion || function () { return Array.prototype.slice.call(arguments); };
    var mountTo = env.mount || null;
    var roomId = env.roomId || ROOM_ID;

    function id(s) { return P + s; }
    function $(s) { return document.getElementById(id(s)); }
    function role() {
      try { return env.role ? env.role() : 'none'; } catch (e) { return 'none'; }
    }
    function me() {
      var u = null;
      try { u = env.user ? env.user() : null; } catch (e) { u = null; }
      return u || {};
    }
    function roomRef() { return db.collection(ROOM_COLLECTION).doc(roomId); }
    function peersRef() { return roomRef().collection(PEERS); }
    function host() { return mountTo || document.body; }

    var lastRole = 'none';

    /* ==============================================================
       TEACHER
       ============================================================== */
    var T = {
      open: false,           // the window is showing
      live: false,           // the room is open on the server
      epoch: '',
      quality: 'normal',
      peers: {},             // peerId → { id, data, pc, handledRev, seen, buf, answered, tile, rtc, startedAt, rotate, asked }
      unsubPeers: null,
      beatTimer: 0,
      tickTimer: 0,
      focus: '',
      min: false,
      win: null,
      built: false,
      busy: false
    };

    function teacherAllowed() { return role() === 'teacher'; }

    function buildTeacherWindow() {
      if (T.built) return;
      T.built = true;
      var modal = h('div', { class: 'modalBack floatWin lcWin', id: id('Modal') }, [
        h('div', { class: 'modalCard lcCard', id: id('Card'), tabindex: '-1' }, [
          h('div', { class: 'modalHead lcHead', id: id('Head'), title: 'Drag to move — the worksheet stays live underneath' }, [
            h('h2', { text: '📹 Live cams' }),
            h('div', { class: 'winBtns' }, [
              h('button', { class: 'modalClose', id: id('MinBtn'), title: 'Minimise — the cameras keep streaming', text: '–' }),
              h('button', { class: 'modalClose', id: id('CloseBtn'), title: 'Close — every student’s camera is switched off', text: '✕' })
            ])
          ]),
          h('div', { class: 'modalBody lcBody' }, [
            h('div', { class: 'lcBar' }, [
              h('span', { class: 'lcDot', id: id('RoomDot'), 'aria-hidden': 'true' }),
              h('span', { class: 'lcSummary', id: id('Summary'), role: 'status', 'aria-live': 'polite', text: 'Opening…' }),
              h('label', { class: 'lcQuality', title: 'Sharp sends more detail so small handwriting can be read — it uses more of the class’s internet' }, [
                h('span', { text: 'Quality' }),
                h('select', { id: id('Quality') }, [
                  h('option', { value: 'normal', text: QUALITY.normal.label }),
                  h('option', { value: 'sharp', text: QUALITY.sharp.label })
                ])
              ])
            ]),
            h('p', { class: 'lcHint', id: id('Hint'), text: 'Students see a “Share my camera” card on their own screen. Their camera turns on only when they tap it, and goes off when you close this window.' }),
            h('div', { class: 'lcStage', id: id('Stage'), hidden: true }),
            h('div', { class: 'lcGrid', id: id('Grid') }),
            h('div', { class: 'lcEmpty', id: id('Empty') }, [
              h('div', { class: 'lcEmptyIcon', text: '📹' }),
              h('div', { class: 'lcEmptyTitle', text: 'Waiting for students' }),
              h('div', { class: 'lcEmptyText', text: 'Ask the class to tap “Share my camera” and hold their answer up to the camera.' })
            ])
          ]),
          h('div', { class: 'floatWinGrip', id: id('Grip'), title: 'Drag to resize' })
        ])
      ]);
      host().appendChild(modal);

      $('MinBtn').addEventListener('click', function () { setTeacherMin(!T.min); });
      $('CloseBtn').addEventListener('click', function () { closeTeacher(); });
      $('Quality').addEventListener('change', function (e) { setQuality(e.target.value); });
      $('Grid').addEventListener('click', onTileClick);
      $('Stage').addEventListener('click', onTileClick);
      // Every key typed inside the window stays inside it, or the page's
      // one-letter tool shortcuts fire under the teacher's hand.
      $('Card').addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          if (T.focus) { e.stopPropagation(); setFocus(''); }
          return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey || e.key === 'Tab') return;
        e.stopPropagation();
      });

      if (typeof env.attachFloatWin === 'function') {
        env.attachFloatWin({
          modal: id('Modal'), card: id('Card'), head: id('Head'), grip: id('Grip'),
          get: function () { return T.win; },
          set: function (b) { T.win = b; },
          clamp: clampWin,
          apply: applyWin,
          save: saveWin
        });
      }
      if (root.ResizeObserver) {
        try { new root.ResizeObserver(function () { layoutGrid(); fitAllRotations(); }).observe($('Card')); } catch (e) {}
      }
    }

    function clampWin(b) {
      if (typeof env.clampWinBox === 'function') return env.clampWinBox(b, 340, 260, T.min ? 64 : 0);
      var vw = root.innerWidth || 1024, vh = root.innerHeight || 768;
      var w = Math.min(Math.max(b.w, 340), vw - 16), hh = Math.min(Math.max(b.h, 260), vh - 16);
      return { x: Math.max(8, Math.min(b.x, vw - w - 8)), y: Math.max(8, Math.min(b.y, vh - hh - 8)), w: w, h: hh };
    }
    function defaultWin() {
      var vw = root.innerWidth || 1024, vh = root.innerHeight || 768;
      var w = Math.min(820, vw - 32), hh = Math.min(620, vh - 96);
      return { x: Math.max(16, vw - w - 24), y: 72, w: w, h: hh };
    }
    var WIN_KEY = 'polymath.liveCamWin.v1';
    function loadWin() {
      try {
        var v = JSON.parse(root.localStorage.getItem(WIN_KEY) || 'null');
        if (v && ['x', 'y', 'w', 'h'].every(function (k) { return isFinite(v[k]); })) return v;
      } catch (e) {}
      return null;
    }
    function saveWin() { try { root.localStorage.setItem(WIN_KEY, JSON.stringify(T.win)); } catch (e) {} }
    function applyWin() {
      var c = $('Card');
      if (!c || !T.win) return;
      c.style.left = T.win.x + 'px';
      c.style.top = T.win.y + 'px';
      c.style.width = T.win.w + 'px';
      c.style.height = T.min ? '' : T.win.h + 'px';
      layoutGrid();
    }
    function setTeacherMin(v) {
      T.min = !!v;
      var m = $('Modal');
      if (m) m.classList.toggle('winMin', T.min);
      var b = $('MinBtn');
      if (b) { b.textContent = T.min ? '▢' : '–'; b.title = T.min ? 'Restore' : 'Minimise — the cameras keep streaming'; }
      if (T.win) { T.win = clampWin(T.win); applyWin(); }
    }

    async function openTeacher() {
      if (!teacherAllowed()) return false;
      buildTeacherWindow();
      var modal = $('Modal');
      if (T.open) {
        if (typeof env.raiseFloatWin === 'function') env.raiseFloatWin(id('Modal'));
        setTeacherMin(false);
        return true;
      }
      if (T.busy) return false;
      T.busy = true;
      T.open = true;
      modal.classList.add('open');
      if (typeof env.raiseFloatWin === 'function') env.raiseFloatWin(id('Modal'));
      T.win = clampWin(T.win || loadWin() || defaultWin());
      setTeacherMin(false);
      applyWin();
      syncButton();
      setSummary('Opening the room…');
      try {
        await openRoom();
      } catch (e) {
        T.busy = false;
        setSummary('Could not open the room');
        toast('Live cams could not start: ' + (e && e.message ? e.message : 'the database refused it') + '.', 5000);
        closeTeacher(true);
        return false;
      }
      T.busy = false;
      if (!T.open || !teacherAllowed()) { closeTeacher(); return false; }
      render();
      return true;
    }

    async function openRoom() {
      var user = me();
      T.epoch = newId('e');
      T.quality = T.quality || 'normal';
      $('Quality').value = T.quality;
      // Peers from an earlier opening belong to nobody now.
      await clearPeers(null);
      await roomRef().set({
        open: true,
        epoch: T.epoch,
        teacherUid: user.uid || '',
        openedAt: now(),
        heartbeat: now(),
        quality: T.quality
      });
      T.live = true;
      T.unsubPeers = peersRef().where('epoch', '==', T.epoch).onSnapshot(onPeers, function (err) {
        setSummary('The camera list stopped updating');
        toast('Live cams lost the connection to the database' + (err && err.code ? ' (' + err.code + ')' : '') + '.', 5000);
      });
      clearInterval(T.beatTimer);
      T.beatTimer = setInterval(beatRoom, ROOM_BEAT_MS);
      clearInterval(T.tickTimer);
      T.tickTimer = setInterval(teacherTick, TICK_MS);
    }

    function beatRoom() {
      if (!T.live) return;
      if (!teacherAllowed()) { closeTeacher(); return; }
      roomRef().update({ heartbeat: now(), quality: T.quality }).catch(function () {});
    }

    async function clearPeers(epochToKeep) {
      try {
        var snap = await peersRef().get();
        var jobs = [];
        snap.forEach(function (d) {
          var data = d.data() || {};
          if (epochToKeep && data.epoch === epochToKeep) return;
          jobs.push(d.ref.delete().catch(function () {}));
        });
        await Promise.all(jobs);
      } catch (e) { /* a refused read leaves old peers; they carry an old epoch and are never shown */ }
    }

    function closeTeacher(quiet) {
      var wasLive = T.live;
      T.open = false;
      T.live = false;
      clearInterval(T.beatTimer); T.beatTimer = 0;
      clearInterval(T.tickTimer); T.tickTimer = 0;
      if (T.unsubPeers) { try { T.unsubPeers(); } catch (e) {} T.unsubPeers = null; }
      Object.keys(T.peers).forEach(function (pid) { dropPeer(pid); });
      T.peers = {};
      T.focus = '';
      var m = $('Modal');
      if (m) m.classList.remove('open');
      syncButton();
      if (wasLive && db) {
        var ep = T.epoch;
        roomRef().set({ open: false, closedAt: now(), epoch: ep }, { merge: true }).catch(function () {});
        clearPeers(null);
      }
      if (wasLive && !quiet) toast('Live cams closed — every student’s camera has been switched off.');
    }

    function toggleTeacher() { return T.open ? (closeTeacher(), false) : openTeacher(); }

    function setQuality(q) {
      if (!teacherAllowed()) return;
      T.quality = q === 'sharp' ? 'sharp' : 'normal';
      if (T.live) roomRef().update({ quality: T.quality, heartbeat: now() }).catch(function () {});
    }

    function setSummary(text) {
      var s = $('Summary');
      if (s) s.textContent = text;
    }

    function syncButton() {
      var b = env.button ? env.button() : null;
      if (b) b.classList.toggle('active', T.open);
      var dot = $('RoomDot');
      if (dot) dot.classList.toggle('on', T.live);
    }

    /* ---- the peers snapshot ---- */
    function onPeers(snap) {
      if (!T.live) return;
      var present = {};
      snap.forEach(function (d) {
        present[d.id] = true;
        upsertPeer(d.id, d.data() || {});
      });
      Object.keys(T.peers).forEach(function (pid) {
        if (!present[pid]) dropPeer(pid);
      });
      render();
    }

    function upsertPeer(pid, data) {
      var p = T.peers[pid];
      if (!p) {
        p = T.peers[pid] = {
          id: pid, data: data, pc: null, handledRev: null, seen: {}, buf: [], answered: false,
          tile: null, rtc: 'new', startedAt: now(), rotate: 0, asked: false, stream: null
        };
      }
      p.data = data;
      if (needsAnswer(data, p.handledRev)) answerPeer(p);
      else applyRemoteCandidates(p);
      updateTile(p);
    }

    function dropPeer(pid) {
      var p = T.peers[pid];
      if (!p) return;
      closePc(p.pc);
      p.pc = null;
      if (p.tile && p.tile.parentNode) p.tile.parentNode.removeChild(p.tile);
      if (p.video) { try { p.video.srcObject = null; } catch (e) {} }
      delete T.peers[pid];
      if (T.focus === pid) T.focus = '';
    }

    async function answerPeer(p) {
      var data = p.data, rev = Number(data.rev);
      closePc(p.pc);
      p.pc = null;
      p.handledRev = rev;
      p.seen = {};
      p.buf = [];
      p.answered = false;
      p.rtc = 'new';
      p.asked = false;
      p.startedAt = now();
      if (!RTC) { p.rtc = 'failed'; askSnapshots(p); return; }
      var pc;
      try { pc = new RTC({ iceServers: ice }); }
      catch (e) { p.rtc = 'failed'; askSnapshots(p); return; }
      p.pc = pc;
      pc.ontrack = function (ev) {
        if (p.pc !== pc) return;
        var stream = ev.streams && ev.streams[0] ? ev.streams[0] : new MediaStream([ev.track]);
        p.stream = stream;
        ensureTile(p);
        if (p.video.srcObject !== stream) p.video.srcObject = stream;
        var play = p.video.play();
        if (play && play.catch) play.catch(function () {});
      };
      pc.onicecandidate = function (ev) {
        if (p.pc !== pc || !ev.candidate) return;
        var s = packCandidate(ev.candidate, rev);
        if (!s) return;
        if (p.answered) peersRef().doc(p.id).update({ tc: arrayUnion(s) }).catch(function () {});
        else p.buf.push(s);
      };
      pc.onconnectionstatechange = function () {
        if (p.pc !== pc) return;
        p.rtc = pc.connectionState;
        if (p.rtc === 'failed') askSnapshots(p);
        updateTile(p);
        render();
      };
      try {
        await pc.setRemoteDescription(data.offer);
        var answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (p.pc !== pc || !T.live) return;
        var buf = p.buf.slice();
        p.buf = [];
        await peersRef().doc(p.id).update({ answer: sdpOf(pc.localDescription || answer), arev: rev, tc: buf });
        p.answered = true;
        // Anything gathered while the answer was being written.
        if (p.buf.length) {
          var late = p.buf.slice(); p.buf = [];
          peersRef().doc(p.id).update({ tc: arrayUnion.apply(null, late) }).catch(function () {});
        }
        applyRemoteCandidates(p);
      } catch (e) {
        if (p.pc === pc) { p.rtc = 'failed'; askSnapshots(p); updateTile(p); }
      }
    }

    function applyRemoteCandidates(p) {
      var pc = p.pc;
      if (!pc || !pc.remoteDescription || p.handledRev == null) return;
      unpackCandidates(p.data.sc, p.handledRev, p.seen).forEach(function (c) {
        pc.addIceCandidate(c).catch(function () {});
      });
    }

    /* Video that has not arrived in RTC_TIMEOUT_MS is not coming: the
       student is asked for snapshots instead. Asked once per negotiation. */
    function askSnapshots(p) {
      if (p.asked || !T.live) return;
      p.asked = true;
      peersRef().doc(p.id).update({ wantSnap: true }).catch(function () {});
    }

    function teacherTick() {
      if (!T.live) return;
      if (!teacherAllowed()) { closeTeacher(); return; }
      var t = now();
      Object.keys(T.peers).forEach(function (pid) {
        var p = T.peers[pid];
        var st = peerStatus(p.data, t, p.rtc);
        if (st === 'gone') {
          peersRef().doc(pid).delete().catch(function () {});
          dropPeer(pid);
          return;
        }
        if (st === 'connecting' && t - p.startedAt > RTC_TIMEOUT_MS) askSnapshots(p);
        updateTile(p);
      });
      render();
    }

    /* ---- tiles ---- */
    function ensureTile(p) {
      if (p.tile) return p.tile;
      var video = h('video', { class: 'lcVideo', autoplay: true, muted: true, playsinline: true });
      video.muted = true;
      video.addEventListener('loadedmetadata', function () { fitRotation(p); });
      var img = h('img', { class: 'lcSnap', alt: '', draggable: 'false', hidden: true });
      img.addEventListener('load', function () { fitRotation(p); });
      var tile = h('figure', { class: 'lcTile', 'data-peer': p.id }, [
        h('div', { class: 'lcMedia' }, [video, img,
          h('div', { class: 'lcWaiting', text: 'Connecting…' })]),
        h('figcaption', { class: 'lcCap' }, [
          h('span', { class: 'lcState', 'aria-hidden': 'true' }),
          h('span', { class: 'lcName' }),
          h('span', { class: 'lcWs' }),
          h('span', { class: 'lcBtns' }, [
            h('button', { class: 'lcBtn', 'data-act': 'focus', title: 'Enlarge — see this answer big' , text: '⤢' }),
            h('button', { class: 'lcBtn', 'data-act': 'rotate', title: 'Turn a quarter — for a camera held sideways', text: '⟳' }),
            env.putOnPage ? h('button', { class: 'lcBtn', 'data-act': 'pin', title: 'Put this frame on the worksheet page', text: '📌' }) : null,
            h('button', { class: 'lcBtn', 'data-act': 'save', title: 'Save this frame as a picture', text: '⬇' }),
            h('button', { class: 'lcBtn', 'data-act': 'reconnect', title: 'Reconnect this camera', text: '↻' }),
            h('button', { class: 'lcBtn lcBtnDanger', 'data-act': 'remove', title: 'Stop this student’s camera', text: '✕' })
          ])
        ])
      ]);
      p.tile = tile; p.video = video; p.img = img;
      placeTile(p);
      return tile;
    }

    function placeTile(p) {
      var stage = $('Stage'), grid = $('Grid');
      if (!p.tile || !stage || !grid) return;
      var want = T.focus === p.id ? stage : grid;
      if (p.tile.parentNode !== want) {
        want.appendChild(p.tile);
        // A moved <video> may pause in some browsers.
        if (p.video && p.video.srcObject) { var pl = p.video.play(); if (pl && pl.catch) pl.catch(function () {}); }
      }
      p.tile.classList.toggle('lcBig', T.focus === p.id);
    }

    function updateTile(p) {
      ensureTile(p);
      var d = p.data || {};
      var st = peerStatus(d, now(), p.rtc);
      p.status = st;
      var tile = p.tile;
      tile.className = 'lcTile lc-' + st + (T.focus === p.id ? ' lcBig' : '');
      tile.querySelector('.lcName').textContent = cleanName(d.name, 'Student');
      var ws = cleanWs(d.ws);
      var wsEl = tile.querySelector('.lcWs');
      wsEl.textContent = ws && ws.name ? ws.name : '';
      wsEl.title = ws && ws.name ? 'On: ' + ws.name : '';
      tile.querySelector('.lcState').title = statusLabel(st);
      var showVideo = st === 'live' && !!p.stream;
      var showSnap = !showVideo && !!d.snap && snapFits(d.snap);
      p.video.hidden = !showVideo;
      p.img.hidden = !showSnap;
      if (showSnap && p.img.getAttribute('src') !== d.snap) p.img.setAttribute('src', d.snap);
      var waiting = tile.querySelector('.lcWaiting');
      waiting.hidden = showVideo || showSnap;
      waiting.textContent = st === 'failed' ? 'Could not connect — waiting for snapshots…'
        : st === 'stale' ? 'Not responding…' : 'Connecting…';
      applyRotation(p);
    }

    function mediaOf(p) {
      if (!p) return null;
      if (!p.video.hidden && p.video.videoWidth) return p.video;
      if (!p.img.hidden && p.img.naturalWidth) return p.img;
      if (p.video.videoWidth) return p.video;
      if (p.img.naturalWidth) return p.img;
      return null;
    }

    function applyRotation(p) {
      var deg = p.rotate || 0;
      var s = 1;
      var m = mediaOf(p);
      var box = p.tile ? p.tile.querySelector('.lcMedia') : null;
      if (m && box) {
        s = rotateFit(box.clientWidth, box.clientHeight,
          m.videoWidth || m.naturalWidth, m.videoHeight || m.naturalHeight, deg);
      }
      var tf = deg ? 'rotate(' + deg + 'deg) scale(' + s + ')' : '';
      p.video.style.transform = tf;
      p.img.style.transform = tf;
    }
    function fitRotation(p) { if (p && p.tile) applyRotation(p); }
    function fitAllRotations() { Object.keys(T.peers).forEach(function (k) { fitRotation(T.peers[k]); }); }

    function layoutGrid() {
      var grid = $('Grid');
      if (!grid) return;
      var n = 0;
      Object.keys(T.peers).forEach(function (k) { if (k !== T.focus) n++; });
      var width = grid.clientWidth || (T.win ? T.win.w - 40 : 600);
      var cols = T.focus ? Math.max(1, Math.min(n, Math.floor(width / 150) || 1)) : gridColumns(n, width, TILE_MIN_PX);
      grid.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
      grid.classList.toggle('lcStrip', !!T.focus);
    }

    function render() {
      if (!T.built) return;
      var list = sortPeers(Object.keys(T.peers).map(function (k) {
        return { id: k, name: T.peers[k].data && T.peers[k].data.name };
      }));
      var grid = $('Grid');
      list.forEach(function (row) {
        var p = T.peers[row.id];
        ensureTile(p);
        placeTile(p);
        if (p.tile.parentNode === grid) grid.appendChild(p.tile); // keeps alphabetical order
      });
      var stage = $('Stage');
      stage.hidden = !T.focus || !T.peers[T.focus];
      $('Empty').hidden = list.length > 0 || !T.live;
      $('Hint').hidden = list.length > 0;
      var statuses = list.map(function (row) { return T.peers[row.id].status || 'connecting'; });
      setSummary(T.live ? summarize(statuses) : 'Closed');
      syncButton();
      layoutGrid();
    }

    function setFocus(pid) {
      T.focus = pid && T.peers[pid] ? pid : '';
      Object.keys(T.peers).forEach(function (k) { placeTile(T.peers[k]); });
      render();
      requestAnimationFrame(fitAllRotations);
    }

    function onTileClick(e) {
      if (!teacherAllowed()) return;
      var btn = e.target.closest('[data-act]');
      var tile = e.target.closest('.lcTile');
      if (!tile) return;
      var pid = tile.getAttribute('data-peer');
      var p = T.peers[pid];
      if (!p) return;
      if (!btn) {
        // A tap on the picture itself enlarges it, and a tap on the big one
        // puts it back — the commonest thing the window is used for.
        if (e.target.closest('.lcMedia')) setFocus(T.focus === pid ? '' : pid);
        return;
      }
      var act = btn.getAttribute('data-act');
      if (act === 'focus') setFocus(T.focus === pid ? '' : pid);
      else if (act === 'rotate') { p.rotate = nextRotation(p.rotate); applyRotation(p); }
      else if (act === 'pin') pinFrame(p);
      else if (act === 'save') saveFrame(p);
      else if (act === 'reconnect') reconnectPeer(p);
      else if (act === 'remove') removePeer(p);
    }

    async function frameBlob(p) {
      var m = mediaOf(p);
      if (!m) return null;
      var cv = null;
      try { cv = drawFrame(m, p.rotate || 0, 1600); } catch (e) { cv = null; }
      return canvasBlob(cv, 0.9);
    }

    async function pinFrame(p) {
      if (!teacherAllowed() || !env.putOnPage) return;
      var blob = await frameBlob(p);
      if (!blob) { toast('There is no picture from ' + cleanName(p.data.name, 'this student') + ' yet.'); return; }
      try {
        var n = await env.putOnPage(blob, cleanName(p.data.name, 'Student'));
        if (n) toast('📌 ' + cleanName(p.data.name, 'Student') + '’s answer is on the page.');
      } catch (e) {
        toast('The frame could not be put on the page.');
      }
    }

    async function saveFrame(p) {
      if (!teacherAllowed()) return;
      var blob = await frameBlob(p);
      if (!blob) { toast('There is no picture from ' + cleanName(p.data.name, 'this student') + ' yet.'); return; }
      var url = URL.createObjectURL(blob);
      var a = h('a', { href: url, download: frameFileName(p.data.name, now()) });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }

    function reconnectPeer(p) {
      if (!teacherAllowed()) return;
      var n = (Number(p.data.restart) || 0) + 1;
      peersRef().doc(p.id).update({ restart: n, wantSnap: false }).catch(function () {});
      p.rtc = 'new';
      p.startedAt = now();
      updateTile(p);
      toast('Asking ' + cleanName(p.data.name, 'the student') + '’s camera to reconnect…');
    }

    function removePeer(p) {
      if (!teacherAllowed()) return;
      var name = cleanName(p.data.name, 'this student');
      peersRef().doc(p.id).delete().catch(function () {});
      dropPeer(p.id);
      render();
      toast(name + '’s camera has been switched off.');
    }

    /* A room left open by a teacher's tab that died is closed by the next
       teacher page that loads, so no student is offered a dead room for the
       next seventy-five seconds. */
    async function teacherStartupSweep() {
      if (!teacherAllowed() || T.live || !db) return;
      try {
        var d = await roomRef().get();
        if (!d.exists || T.live) return;
        var room = d.data() || {};
        var beat = Number(room.heartbeat);
        if (room.open === true && !(isFinite(beat) && Math.abs(now() - beat) < ROOM_BEAT_MS * 2)) {
          await roomRef().set({ open: false, closedAt: now() }, { merge: true });
        }
      } catch (e) {}
    }

    /* ==============================================================
       STUDENT
       ============================================================== */
    var S = {
      unsubRoom: null,
      room: null,
      roomEpoch: '',
      dismissed: '',           // the epoch whose invite was waved away
      sharing: false,
      starting: false,
      stream: null,
      pc: null,
      rev: 0,
      peerId: '',
      unsubPeer: null,
      beatTimer: 0,
      tickTimer: 0,
      snapTimer: 0,
      snapBusy: false,
      snapping: false,
      wantSnap: false,
      rtc: 'new',
      startedAt: 0,
      seenTc: {},
      buf: [],
      docReady: false,
      lastRestart: 0,
      selfStop: false,
      deviceId: '',
      devices: [],
      mirror: true,
      typedName: '',
      quality: 'normal',
      built: false,
      min: false,
      epochAtStart: ''
    };

    function studentAllowed() { return role() === 'student'; }

    function buildStudentUi() {
      if (S.built) return;
      S.built = true;
      var invite = h('div', { class: 'lcInvite', id: id('Invite'), role: 'dialog', 'aria-labelledby': id('InviteTitle'), hidden: true }, [
        h('div', { class: 'lcInviteIcon', 'aria-hidden': 'true', text: '📹' }),
        h('div', { class: 'lcInviteText' }, [
          h('div', { class: 'lcInviteTitle', id: id('InviteTitle'), text: 'Your teacher is looking at answers live' }),
          h('div', { class: 'lcInviteSub', text: 'Share your camera and hold your work up to it. Only your teacher sees it, and it is not recorded.' }),
          h('label', { class: 'lcNameRow', id: id('NameRow'), hidden: true }, [
            h('span', { text: 'Your name' }),
            h('input', { id: id('NameInput'), type: 'text', maxlength: String(NAME_MAX), autocomplete: 'name', placeholder: 'So your teacher knows who you are' })
          ])
        ]),
        h('div', { class: 'lcInviteBtns' }, [
          h('button', { class: 'btn btnPrimary', id: id('ShareBtn'), text: 'Share my camera' }),
          h('button', { class: 'btn', id: id('LaterBtn'), text: 'Not now' })
        ])
      ]);
      var self = h('div', { class: 'lcSelf', id: id('Self'), hidden: true, role: 'region', 'aria-label': 'Your camera' }, [
        h('div', { class: 'lcSelfHead' }, [
          h('span', { class: 'lcRec', 'aria-hidden': 'true' }),
          h('span', { class: 'lcSelfTitle', id: id('SelfTitle'), text: 'Your teacher can see your camera' }),
          h('button', { class: 'lcSelfMin', id: id('SelfMinBtn'), title: 'Make the preview small', text: '–' })
        ]),
        h('div', { class: 'lcSelfBody', id: id('SelfBody') }, [
          h('div', { class: 'lcSelfMedia' }, [
            h('video', { class: 'lcSelfVideo mirror', id: id('SelfVideo'), autoplay: true, muted: true, playsinline: true })
          ]),
          h('div', { class: 'lcSelfStatus', id: id('SelfStatus'), role: 'status', 'aria-live': 'polite', text: 'Connecting to your teacher…' }),
          h('div', { class: 'lcSelfRow' }, [
            h('select', { id: id('CamSelect'), title: 'Which camera to use', hidden: true }),
            h('label', { class: 'lcMirror', title: 'Only changes YOUR preview — your teacher always sees writing the right way round' }, [
              h('input', { type: 'checkbox', id: id('MirrorBox'), checked: true }),
              h('span', { text: 'Mirror my preview' })
            ])
          ]),
          h('button', { class: 'btn lcStopBtn', id: id('StopBtn'), text: '■ Stop sharing' })
        ])
      ]);
      host().appendChild(invite);
      host().appendChild(self);
      $('ShareBtn').addEventListener('click', function () { startSharing(); });
      $('LaterBtn').addEventListener('click', function () {
        S.dismissed = S.roomEpoch;
        hideInvite();
      });
      $('StopBtn').addEventListener('click', function () { stopSharing('user'); });
      $('SelfMinBtn').addEventListener('click', function () { setSelfMin(!S.min); });
      $('CamSelect').addEventListener('change', function (e) { switchCamera(e.target.value); });
      $('MirrorBox').addEventListener('change', function (e) { S.mirror = !!e.target.checked; syncMirror(); });
      $('NameInput').addEventListener('input', function (e) { S.typedName = cleanName(e.target.value, ''); });
      [invite, self].forEach(function (el) {
        el.addEventListener('keydown', function (e) {
          if (e.ctrlKey || e.metaKey || e.altKey || e.key === 'Tab' || e.key === 'Escape') return;
          e.stopPropagation();
        });
      });
    }

    function studentName() {
      var u = me();
      return cleanName(u.name, '') || S.typedName;
    }

    function showInvite() {
      buildStudentUi();
      var inv = $('Invite');
      var needName = !cleanName(me().name, '');
      $('NameRow').hidden = !needName;
      if (inv.hidden) {
        inv.hidden = false;
        inv.classList.remove('lcIn');
        void inv.offsetWidth;
        inv.classList.add('lcIn');
      }
    }
    function hideInvite() { var inv = $('Invite'); if (inv) inv.hidden = true; }

    function setSelfMin(v) {
      S.min = !!v;
      var s = $('Self');
      if (s) s.classList.toggle('lcSelfSmall', S.min);
      var b = $('SelfMinBtn');
      if (b) { b.textContent = S.min ? '▢' : '–'; b.title = S.min ? 'Show the preview' : 'Make the preview small'; }
    }

    function syncMirror() {
      var v = $('SelfVideo');
      if (v) v.classList.toggle('mirror', S.mirror);
      var box = $('MirrorBox');
      if (box) box.checked = S.mirror;
    }

    function setSelfStatus(text, tone) {
      var el = $('SelfStatus');
      if (!el) return;
      el.textContent = text;
      el.className = 'lcSelfStatus' + (tone ? ' lc-' + tone : '');
    }

    function watchRoom() {
      if (S.unsubRoom || !db) return;
      try {
        S.unsubRoom = roomRef().onSnapshot(function (d) {
          S.room = d.exists ? (d.data() || {}) : null;
          studentEvaluate();
        }, function () {
          // A device that may not read the room simply never sees an
          // invitation — exactly as if the feature were not there.
          S.room = null;
          studentEvaluate();
        });
      } catch (e) { S.unsubRoom = null; }
      clearInterval(S.tickTimer);
      S.tickTimer = setInterval(studentTick, TICK_MS);
    }

    function unwatchRoom() {
      if (S.unsubRoom) { try { S.unsubRoom(); } catch (e) {} S.unsubRoom = null; }
      clearInterval(S.tickTimer); S.tickTimer = 0;
      S.room = null;
      hideInvite();
    }

    function studentEvaluate() {
      if (!studentAllowed()) { stopSharing('role'); hideInvite(); return; }
      var room = S.room, fresh = roomFresh(room, now());
      S.roomEpoch = fresh ? room.epoch : '';
      if (S.sharing || S.starting) {
        if (!fresh) { stopSharing('closed'); return; }
        if (room.epoch !== S.epochAtStart) { stopSharing('closed'); return; }
        var q = qualityOf(room);
        if (q !== S.quality) { S.quality = q; applyQuality(); }
        hideInvite();
        return;
      }
      if (fresh && S.dismissed !== room.epoch) showInvite();
      else hideInvite();
    }

    function studentTick() {
      studentEvaluate();
      if (!S.sharing) return;
      // Video that has not connected by now is not coming on this network:
      // fall back to snapshots without waiting to be asked.
      if (S.rtc !== 'connected' && now() - S.startedAt > RTC_TIMEOUT_MS) S.wantSnap = true;
      syncSnapLoop();
      syncSelfStatus();
    }

    async function startSharing() {
      if (!studentAllowed() || S.sharing || S.starting) return;
      buildStudentUi();
      if (!roomFresh(S.room, now())) { hideInvite(); toast('Your teacher is not watching cameras right now.'); return; }
      var name = studentName();
      if (!name) {
        $('NameRow').hidden = false;
        var inp = $('NameInput');
        inp.focus();
        toast('Type your name first, so your teacher knows whose camera it is.');
        return;
      }
      if (!media || !media.getUserMedia) {
        toast('This browser cannot share a camera.', 4000);
        return;
      }
      S.starting = true;
      S.epochAtStart = S.room.epoch;
      S.quality = qualityOf(S.room);
      $('ShareBtn').disabled = true;
      var stream;
      try {
        stream = await openCamera(S.deviceId);
      } catch (e) {
        S.starting = false;
        $('ShareBtn').disabled = false;
        toast(cameraError(e), 5000);
        return;
      }
      // The teacher may have closed the room while the browser was asking.
      if (!S.starting || !studentAllowed() || !roomFresh(S.room, now()) || S.room.epoch !== S.epochAtStart) {
        stopStream(stream);
        S.starting = false;
        $('ShareBtn').disabled = false;
        return;
      }
      S.stream = stream;
      S.sharing = true;
      S.starting = false;
      $('ShareBtn').disabled = false;
      hideInvite();
      showSelf();
      listCameras();
      S.peerId = newId('p');
      S.rev = 0;
      S.lastRestart = 0;
      S.wantSnap = false;
      S.snapping = false;
      S.selfStop = false;
      S.docReady = false;
      try {
        await writePeerStart(name);
      } catch (e) {
        toast('Your camera could not reach your teacher: ' + (e && e.message ? e.message : 'the database refused it') + '.', 5000);
        stopSharing('error');
        return;
      }
      if (!S.sharing) return;
      S.unsubPeer = peersRef().doc(S.peerId).onSnapshot(onOwnPeer, function () {});
      clearInterval(S.beatTimer);
      S.beatTimer = setInterval(beatPeer, PEER_BEAT_MS);
      await negotiate();
    }

    function cameraError(e) {
      var n = e && e.name;
      if (n === 'NotAllowedError' || n === 'SecurityError') return 'The camera was not allowed. Allow it in the browser’s address bar, then try again.';
      if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No camera was found on this device.';
      if (n === 'NotReadableError') return 'The camera is busy in another app. Close it there and try again.';
      return 'The camera could not be opened.';
    }

    async function openCamera(deviceId) {
      var video = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } };
      if (deviceId) video.deviceId = { exact: deviceId };
      try {
        return await media.getUserMedia({ video: video, audio: false });
      } catch (e) {
        // A camera unplugged since it was chosen: take whichever is there.
        if (deviceId && e && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
          delete video.deviceId;
          return await media.getUserMedia({ video: video, audio: false });
        }
        throw e;
      }
    }

    async function listCameras() {
      try {
        var all = await media.enumerateDevices();
        S.devices = all.filter(function (d) { return d.kind === 'videoinput'; });
      } catch (e) { S.devices = []; }
      var sel = $('CamSelect');
      if (!sel) return;
      var cur = S.stream && S.stream.getVideoTracks()[0];
      var curId = cur && cur.getSettings ? (cur.getSettings().deviceId || '') : '';
      sel.innerHTML = '';
      S.devices.forEach(function (d, i) {
        sel.appendChild(h('option', { value: d.deviceId, text: d.label || ('Camera ' + (i + 1)) }));
      });
      if (curId) sel.value = curId;
      sel.hidden = S.devices.length < 2;
      var facing = cur && cur.getSettings ? cur.getSettings().facingMode : '';
      // A back camera is pointed at the paper, not at the child: no mirror.
      if (facing === 'environment') { S.mirror = false; syncMirror(); }
    }

    async function switchCamera(deviceId) {
      if (!S.sharing || !studentAllowed()) return;
      var next;
      try { next = await openCamera(deviceId); }
      catch (e) { toast(cameraError(e), 4000); listCameras(); return; }
      if (!S.sharing) { stopStream(next); return; }
      var track = next.getVideoTracks()[0];
      var old = S.stream;
      S.stream = next;
      S.deviceId = deviceId;
      $('SelfVideo').srcObject = next;
      var sender = S.pc && S.pc.getSenders ? S.pc.getSenders().filter(function (s) { return s.track && s.track.kind === 'video'; })[0] : null;
      if (sender && sender.replaceTrack) {
        try { await sender.replaceTrack(track); applyQuality(); }
        catch (e) { renegotiate(); }
      } else if (S.pc) {
        renegotiate();
      }
      stopStream(old);
      listCameras();
    }

    function showSelf() {
      buildStudentUi();
      var s = $('Self');
      s.hidden = false;
      setSelfMin(false);
      var v = $('SelfVideo');
      v.srcObject = S.stream;
      var pl = v.play();
      if (pl && pl.catch) pl.catch(function () {});
      syncMirror();
      setSelfStatus('Connecting to your teacher…');
    }

    function hideSelf() {
      var s = $('Self');
      if (s) s.hidden = true;
      var v = $('SelfVideo');
      if (v) { try { v.srcObject = null; } catch (e) {} }
    }

    async function writePeerStart(name) {
      var u = me();
      await peersRef().doc(S.peerId).set({
        epoch: S.epochAtStart,
        uid: u.uid || '',
        name: cleanName(name, 'Student'),
        ws: cleanWs(u.ws),
        rev: 0,
        offer: null,
        sc: [],
        answer: null,
        arev: null,
        tc: [],
        seen: now(),
        startedAt: now(),
        snap: null,
        snapAt: 0,
        wantSnap: false,
        restart: 0
      });
    }

    function beatPeer() {
      if (!S.sharing || !S.peerId) return;
      if (!studentAllowed()) { stopSharing('role'); return; }
      var u = me();
      peersRef().doc(S.peerId).update({ seen: now(), ws: cleanWs(u.ws) }).catch(function () {});
    }

    async function negotiate() {
      if (!S.sharing) return;
      closePc(S.pc);
      S.pc = null;
      S.rev += 1;
      var rev = S.rev;
      S.seenTc = {};
      S.buf = [];
      S.docReady = false;
      S.rtc = 'new';
      S.startedAt = now();
      if (!RTC) { S.rtc = 'failed'; S.wantSnap = true; syncSnapLoop(); syncSelfStatus(); return; }
      var pc;
      try { pc = new RTC({ iceServers: ice }); }
      catch (e) { S.rtc = 'failed'; S.wantSnap = true; syncSnapLoop(); syncSelfStatus(); return; }
      S.pc = pc;
      var track = S.stream.getVideoTracks()[0];
      try {
        if (pc.addTransceiver) pc.addTransceiver(track, { direction: 'sendonly', streams: [S.stream] });
        else pc.addTrack(track, S.stream);
      } catch (e) {
        pc.addTrack(track, S.stream);
      }
      pc.onicecandidate = function (ev) {
        if (S.pc !== pc || !ev.candidate) return;
        var s = packCandidate(ev.candidate, rev);
        if (!s) return;
        if (S.docReady) peersRef().doc(S.peerId).update({ sc: arrayUnion(s) }).catch(function () {});
        else S.buf.push(s);
      };
      pc.onconnectionstatechange = function () {
        if (S.pc !== pc) return;
        S.rtc = pc.connectionState;
        if (S.rtc === 'connected') applyQuality();
        if (S.rtc === 'failed') S.wantSnap = true;
        syncSnapLoop();
        syncSelfStatus();
      };
      try {
        var offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (S.pc !== pc || !S.sharing) return;
        var buf = S.buf.slice();
        S.buf = [];
        await peersRef().doc(S.peerId).update({
          offer: sdpOf(pc.localDescription || offer), rev: rev, sc: buf, answer: null, arev: null, tc: [], seen: now()
        });
        S.docReady = true;
        if (S.buf.length) {
          var late = S.buf.slice(); S.buf = [];
          peersRef().doc(S.peerId).update({ sc: arrayUnion.apply(null, late) }).catch(function () {});
        }
      } catch (e) {
        if (S.pc === pc) { S.rtc = 'failed'; S.wantSnap = true; syncSnapLoop(); syncSelfStatus(); }
      }
    }

    function renegotiate() { if (S.sharing) negotiate(); }

    async function onOwnPeer(d) {
      if (!S.sharing) return;
      if (!d.exists) {
        // Deleted, and not by this device: the teacher took the tile away.
        if (!S.selfStop) stopSharing('removed');
        return;
      }
      var data = d.data() || {};
      var pc = S.pc;
      if (data.restart && Number(data.restart) > S.lastRestart) {
        S.lastRestart = Number(data.restart);
        S.wantSnap = false;
        negotiate();
        return;
      }
      if (data.wantSnap && !S.wantSnap) { S.wantSnap = true; syncSnapLoop(); syncSelfStatus(); }
      if (!pc) return;
      if (data.answer && Number(data.arev) === S.rev && pc.signalingState === 'have-local-offer') {
        try { await pc.setRemoteDescription(data.answer); }
        catch (e) { S.rtc = 'failed'; S.wantSnap = true; syncSnapLoop(); syncSelfStatus(); return; }
      }
      if (pc.remoteDescription && S.pc === pc) {
        unpackCandidates(data.tc, S.rev, S.seenTc).forEach(function (c) {
          pc.addIceCandidate(c).catch(function () {});
        });
      }
    }

    function applyQuality() {
      if (!S.pc || !S.pc.getSenders || !S.stream) return;
      var track = S.stream.getVideoTracks()[0];
      var w = track && track.getSettings ? track.getSettings().width : 0;
      var enc = encodingFor(S.quality, w);
      S.pc.getSenders().forEach(function (sender) {
        if (!sender.track || sender.track.kind !== 'video' || !sender.getParameters) return;
        try {
          var params = sender.getParameters();
          if (!params.encodings || !params.encodings.length) params.encodings = [{}];
          params.encodings[0].maxBitrate = enc.maxBitrate;
          params.encodings[0].scaleResolutionDownBy = enc.scaleResolutionDownBy;
          var r = sender.setParameters(params);
          if (r && r.catch) r.catch(function () {});
        } catch (e) {}
      });
    }

    /* Snapshots run only while video is not getting through AND somebody
       asked for them (the teacher, or this device's own timeout). Video
       that connects later stops them: two copies of the same picture on
       the database is the class's whole internet for nothing. */
    function syncSnapLoop() {
      var want = S.sharing && S.wantSnap && S.rtc !== 'connected';
      if (want && !S.snapTimer) {
        S.snapping = true;
        S.snapTimer = setInterval(takeSnap, SNAP_MS);
        takeSnap();
      } else if (!want && S.snapTimer) {
        clearInterval(S.snapTimer);
        S.snapTimer = 0;
        S.snapping = false;
      }
    }

    async function takeSnap() {
      if (!S.sharing || S.snapBusy) return;
      var v = $('SelfVideo');
      if (!v || !v.videoWidth) return;
      S.snapBusy = true;
      try {
        var q = QUALITY[S.quality] || QUALITY.normal;
        var cv = drawFrame(v, 0, q.snapPx);
        var url = cv ? cv.toDataURL('image/jpeg', SNAP_QUALITY) : '';
        if (url && !snapFits(url) && cv) url = drawFrame(v, 0, Math.round(q.snapPx * 0.6)).toDataURL('image/jpeg', 0.5);
        if (snapFits(url) && S.sharing) {
          await peersRef().doc(S.peerId).update({ snap: url, snapAt: now(), seen: now() });
        }
      } catch (e) {
        /* one dropped frame is not worth a message */
      } finally {
        S.snapBusy = false;
      }
    }

    function syncSelfStatus() {
      if (!S.sharing) return;
      if (S.rtc === 'connected') setSelfStatus('● Live — your teacher can see you', 'live');
      else if (S.snapping) setSelfStatus('Sending pictures every couple of seconds (video could not connect)', 'snap');
      else setSelfStatus('Connecting to your teacher…');
    }

    var STOP_MESSAGES = {
      closed: 'Your teacher has finished looking at cameras — your camera is off.',
      removed: 'Your teacher switched your camera off.',
      role: '',
      user: 'Your camera is off.',
      error: '',
      pagehide: ''
    };

    function stopSharing(why) {
      var was = S.sharing || S.starting;
      S.starting = false;
      if (!S.sharing) {
        if (was) stopStream(S.stream);
        S.stream = null;
        return;
      }
      S.sharing = false;
      S.selfStop = true;
      clearInterval(S.beatTimer); S.beatTimer = 0;
      clearInterval(S.snapTimer); S.snapTimer = 0;
      S.snapping = false;
      if (S.unsubPeer) { try { S.unsubPeer(); } catch (e) {} S.unsubPeer = null; }
      closePc(S.pc); S.pc = null;
      stopStream(S.stream); S.stream = null;
      hideSelf();
      var pid = S.peerId;
      S.peerId = '';
      if (pid && why !== 'removed' && db) peersRef().doc(pid).delete().catch(function () {});
      // A student who stopped on purpose is not asked again in the same
      // session; anybody else is, if the room is still open.
      if (why === 'user') S.dismissed = S.epochAtStart;
      var msg = STOP_MESSAGES[why];
      if (msg) toast(msg, 3600);
      if (why !== 'role' && why !== 'pagehide') studentEvaluate();
    }

    /* ==============================================================
       Shared lifecycle
       ============================================================== */
    function roleChanged() {
      var r = role();
      if (r === lastRole) {
        if (r === 'student') studentEvaluate();
        return;
      }
      var prev = lastRole;
      lastRole = r;
      if (prev === 'teacher') closeTeacher(true);
      if (prev === 'student') { stopSharing('role'); unwatchRoom(); }
      if (r === 'student') watchRoom();
      if (r === 'teacher') teacherStartupSweep();
      syncButton();
    }

    function pageHide() {
      if (S.sharing || S.starting) stopSharing('pagehide');
      if (T.live) closeTeacher(true);
    }

    function destroy() {
      pageHide();
      unwatchRoom();
      [id('Modal'), id('Invite'), id('Self')].forEach(function (x) {
        var el = document.getElementById(x);
        if (el && el.parentNode) el.parentNode.removeChild(el);
      });
      T.built = false; S.built = false;
      lastRole = 'none';
    }

    if (env.listenPageHide !== false && root.addEventListener) {
      root.addEventListener('pagehide', pageHide);
    }

    return {
      open: openTeacher,
      close: function () { closeTeacher(); },
      toggle: toggleTeacher,
      roleChanged: roleChanged,
      share: startSharing,
      stop: function () { stopSharing('user'); },
      destroy: destroy,
      // Read-only views for the browser check and for debugging in a console.
      state: function () {
        return {
          role: lastRole,
          teacher: {
            open: T.open, live: T.live, epoch: T.epoch, quality: T.quality, focus: T.focus,
            peers: Object.keys(T.peers).map(function (k) {
              var p = T.peers[k];
              return { id: k, name: p.data && p.data.name, status: p.status || peerStatus(p.data, now(), p.rtc), rtc: p.rtc, rotate: p.rotate,
                videoWidth: p.video ? p.video.videoWidth : 0, hasSnap: !!(p.data && p.data.snap) };
            })
          },
          student: {
            sharing: S.sharing, starting: S.starting, rtc: S.rtc, snapping: S.snapping, wantSnap: S.wantSnap,
            peerId: S.peerId, rev: S.rev, quality: S.quality, invite: !!($('Invite') && !$('Invite').hidden),
            liveTracks: S.stream ? S.stream.getTracks().filter(function (t) { return t.readyState === 'live'; }).length : 0
          }
        };
      },
      _tick: function () { if (T.live) teacherTick(); studentTick(); }
    };
  }

  root.LiveCams = { create: create, pure: pure };
})(typeof window !== 'undefined' ? window : globalThis);
