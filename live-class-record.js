/* 📼 The live class recording, saved to Ans Key's cloud WHILE the lesson goes on (v1.208.0).
 *
 * window.LiveClassRecord = { pure, create(env) }
 *
 * What it does:
 *   - The teacher's device records the class as ONE video: the worksheet the
 *     students see (the cropped share), the teacher's camera in a corner, and
 *     every voice in the room (the teacher's and each student's), mixed.
 *   - Every second the recorder's newest bytes go into this device's
 *     IndexedDB FIRST, so a crash, a closed lid or a dead battery loses at
 *     most a second.
 *   - Every ~30 seconds the bytes recorded since the last piece go up to
 *     Cloud Storage as a numbered piece (`pdf-annotator/lesson-liveclass-<id>
 *     .part-NNNN`, the teacher-only `lesson-` rule), so when the class ends
 *     almost all of it is already in the cloud.
 *   - When the class ends the rest goes up IN THE BACKGROUND: the teacher can
 *     close the window and start the next lesson straight away. The pieces are
 *     joined into one file by the existing ansKeyLessonCompose function (Cloud
 *     Storage compose: an hour joins in about a second), and the file's head
 *     is rewritten with its length so the video can be scrubbed.
 *   - A recording whose upload was cut off (the tab or the browser closed) is
 *     finished the next time the teacher opens Ans Key on that device.
 *
 * Why the head waits: a WebM written by MediaRecorder has no length in it.
 * LessonAudioFinalize.plan writes the length into the first bytes of the
 * file, and only into the first bytes — everything from HEAD on is final the
 * moment it is recorded. So pieces start at HEAD, and part 0 (the head) is
 * sent last, rewritten. HEAD must equal index.html's LESSON_UP_HEAD (the test
 * reads both).
 *
 * The glue (index.html, the live class glue) supplies everything that touches
 * Firebase: put(path, blob), compose(request), plan(blob, ms), finishWhole(blob),
 * saved(job, result), canUpload(job), teacherUid(), currentDoc(), toast().
 * Nothing here knows a key, a token or a bucket.
 */
(function (root) {
  'use strict';

  var VERSION = '1.208.0';
  var DB_NAME = 'polymath-live-class-rec';
  var DB_VERSION = 1;
  var HEAD = 1280 * 1024;                 // = LESSON_UP_HEAD
  var DOC_ID = 'liveclass';               // the compose service's "worksheet" for every class
  var CHUNK_MS = 1000;                    // MediaRecorder timeslice
  var PIECE_MS = 30000;                   // a piece every ~30 seconds…
  var PIECE_MAX = 8 * 1024 * 1024;        // …or every 8 MB, whichever comes first
  var PIECE_MIN = 64 * 1024;              // never a piece smaller than this mid-lesson
  var MAX_PARTS = 880;                    // the compose service joins at most 900
  var MAX_BYTES = 1536 * 1024 * 1024;     // = the compose service's ceiling
  var BEAT_MS = 5000;                     // a recording tab writes its heartbeat this often
  var STALE_MS = 45000;                   // no heartbeat for this long: the tab has gone
  var RETRY_MS = [2000, 5000, 15000, 30000, 60000, 120000];
  var FRAME = { w: 1600, h: 900, fps: 8 };
  var VIDEO_BPS = 900000;
  var AUDIO_BPS = 48000;
  var CAM_BOX = { w: 256, h: 144, margin: 14 };
  var DONE_SHOW_MS = 8000;
  var TAIL_BYTES = 4 * 1024 * 1024;       // how far back a cut-off end is looked for

  /* ================================================================
     PURE
     ================================================================ */
  function str(v) { return v == null ? '' : String(v); }
  function num(v, d) { var n = Number(v); return Number.isFinite(n) ? n : (d === undefined ? 0 : d); }
  function streamable(type) { return /webm/i.test(str(type)); }
  function extOf(type) { return /mp4/i.test(str(type)) ? 'mp4' : /ogg/i.test(str(type)) ? 'ogg' : 'webm'; }
  function jobId(epoch, startedAt) { return 'e' + Math.floor(num(epoch)) + 'p' + Math.floor(num(startedAt)).toString(36); }
  function validJobId(id) { return /^e\d{1,16}p[0-9a-z]{1,12}$/.test(str(id)); }
  function partName(id, i) { return 'pdf-annotator/lesson-' + DOC_ID + '-' + id + '.part-' + String(i).padStart(4, '0'); }

  // The one door into a stored job.
  function cleanJob(j) {
    j = j && typeof j === 'object' ? j : {};
    var id = str(j.id);
    if (!validJobId(id)) return null;
    var states = ['recording', 'finishing', 'saving', 'done', 'failed'];
    var pieces = (Array.isArray(j.pieces) ? j.pieces : []).map(function (p, k) {
      return { i: k + 1, from: Math.max(0, Math.floor(num(p && p.from))), to: Math.max(0, Math.floor(num(p && p.to))), done: !!(p && p.done) };
    }).filter(function (p) { return p.to > p.from; });
    // Pieces must run on from each other without a gap, or the join is wrong.
    for (var k = 0; k < pieces.length; k++) {
      var want = k === 0 ? HEAD : pieces[k - 1].to;
      if (pieces[k].from !== want) { pieces = pieces.slice(0, k); break; }
    }
    return {
      v: 1, id: id, uid: str(j.uid).slice(0, 128), epoch: Math.floor(num(j.epoch)), startedAt: Math.floor(num(j.startedAt)),
      endedAt: Math.floor(num(j.endedAt)), durationMs: Math.max(0, Math.floor(num(j.durationMs))),
      slot: str(j.slot).slice(0, 20), slotLabel: str(j.slotLabel).slice(0, 120), type: str(j.type).slice(0, 80) || 'video/webm',
      state: states.indexOf(j.state) !== -1 ? j.state : 'finishing', beat: Math.floor(num(j.beat)), lastPieceAt: Math.floor(num(j.lastPieceAt)),
      pieces: pieces, docs: (Array.isArray(j.docs) ? j.docs : []).filter(function (d) { return d && /^[A-Za-z0-9_-]{1,64}$/.test(str(d.id)); })
        .slice(0, 6).map(function (d) { return { id: str(d.id), name: str(d.name).slice(0, 120) }; }),
      tries: Math.floor(num(j.tries)), error: str(j.error).slice(0, 300), url: str(j.url).slice(0, 2000), path: str(j.path).slice(0, 300),
      bytes: Math.floor(num(j.bytes)), uploaded: Math.floor(num(j.uploaded)), trim: Math.max(0, Math.floor(num(j.trim)))
    };
  }
  // Where the next piece starts: HEAD, or where the last one ended.
  function lastTo(job) { var p = job.pieces; return p.length ? p[p.length - 1].to : HEAD; }
  // The next piece to cut, or null. Mid-lesson a piece waits for PIECE_MS (or
  // PIECE_MAX bytes); at the end everything left goes, PIECE_MAX at a time.
  function nextPiece(job, bytes, nowMs, final) {
    if (!streamable(job.type)) return null;
    var from = lastTo(job);
    if (bytes <= from) return null;
    var waiting = bytes - from;
    // Keep inside the compose service's count: the last pieces grow to fit.
    // The last slot is kept for the end: mid-lesson stops one short, and the
    // end then sends everything left as that one piece.
    var room = MAX_PARTS - 1 - job.pieces.length;
    if (room <= 0 || (!final && room <= 1)) return null;
    var size = room <= 1 ? waiting : Math.min(waiting, PIECE_MAX);
    if (!final) {
      if (waiting < PIECE_MIN) return null;
      var since = nowMs - (job.lastPieceAt || job.startedAt || 0);
      if (since < PIECE_MS && waiting < PIECE_MAX) return null;
    }
    return { i: job.pieces.length + 1, from: from, to: from + size, done: false };
  }
  function uploadedBytes(job) {
    return job.pieces.reduce(function (s, p) { return s + (p.done ? p.to - p.from : 0); }, 0) + (job.state === 'done' ? Math.min(HEAD, job.bytes) : 0);
  }
  function percent(sent, total) {
    if (!(total > 0)) return 0;
    var p = Math.floor(sent * 100 / total);
    return Math.max(0, Math.min(sent >= total ? 100 : 99, p));
  }
  // Which stored chunks cover [from, to), and where to cut them.
  function chunksFor(index, from, to) {
    var out = [];
    for (var k = 0; k < index.length; k++) {
      var c = index[k], a = c.start, b = c.start + c.size;
      if (b <= from) continue;
      if (a >= to) break;
      out.push({ seq: c.seq, cutFrom: Math.max(0, from - a), cutTo: Math.min(c.size, to - a) });
    }
    return out;
  }
  // A frame of size W×H holding a picture of w×h, as large as fits, centred.
  function fit(w, h, W, H) {
    if (!(w > 0) || !(h > 0)) return { x: 0, y: 0, w: W, h: H };
    var k = Math.min(W / w, H / h);
    var ww = Math.round(w * k), hh = Math.round(h * k);
    return { x: Math.round((W - ww) / 2), y: Math.round((H - hh) / 2), w: ww, h: hh };
  }
  // What each frame shows: the worksheet big with the teacher small in the
  // corner; the teacher big when nothing is shared; a card when neither.
  function frameLayout(W, H, screen, cam) {
    var out = { screen: null, cam: null, card: false };
    if (screen) {
      out.screen = fit(screen.w, screen.h, W, H);
      if (cam) {
        var b = fit(cam.w, cam.h, CAM_BOX.w, CAM_BOX.h);
        out.cam = { x: W - CAM_BOX.margin - b.w, y: H - CAM_BOX.margin - b.h, w: b.w, h: b.h };
      }
    } else if (cam) {
      out.cam = fit(cam.w, cam.h, W, H);
    } else {
      out.card = true;
    }
    return out;
  }
  function fmtClock(ms) {
    var s = Math.max(0, Math.floor(num(ms) / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(r).padStart(2, '0');
  }
  // A WebM cut off mid-write (a recorder that never stopped) ends part way
  // through a block. Given the file's TAIL (bytes from `base` on, of a file
  // `total` long), where the last whole block ends: found from the last
  // unknown-length Cluster header (1F 43 B6 75 01 FF FF FF FF FF FF FF, the
  // way Chrome writes them), walking its children. 0 when no cluster is found.
  function wholeEnd(tail, base, total) {
    var b = tail, n = b.length;
    function vint(p, keep) {
      if (p >= n) return null;
      var f = b[p], len = 1, m = 0x80;
      while (len <= 8 && !(f & m)) { len++; m >>= 1; }
      if (len > 8 || p + len > n) return null;
      var v = keep ? f : (f & (m - 1)), ones = (f & (m - 1)) === m - 1;
      for (var i = 1; i < len; i++) { v = v * 256 + b[p + i]; if (b[p + i] !== 255) ones = false; }
      return { len: len, v: v, unknown: !keep && ones };
    }
    for (var at = n - 12; at >= 0; at--) {
      if (b[at] !== 0x1F || b[at + 1] !== 0x43 || b[at + 2] !== 0xB6 || b[at + 3] !== 0x75 || b[at + 4] !== 0x01) continue;
      var all = true;
      for (var k = 5; k < 12; k++) if (b[at + k] !== 0xFF) { all = false; break; }
      if (!all) continue;
      var p = at + 12, good = p;
      while (p < n) {
        var id = vint(p, true); if (!id) break;
        var sz = vint(p + id.len, false); if (!sz || sz.unknown) break;
        var end = p + id.len + sz.len + sz.v;
        if (end > n) break;
        p = good = end;
      }
      return base + good;
    }
    return 0;
  }
  function stale(job, nowMs) { return job.state === 'recording' && nowMs - (job.beat || job.startedAt) > STALE_MS; }
  function pickMime(isType) {
    var list = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a', 'video/mp4'];
    for (var k = 0; k < list.length; k++) { try { if (isType(list[k])) return list[k]; } catch (e) {} }
    return '';
  }
  function badgeText(jobs, nowMs) {
    var busy = jobs.filter(function (j) { return j.state === 'finishing' || j.state === 'saving' || (j.state === 'recording' && stale(j, nowMs)); });
    if (!busy.length) return '';
    var sent = 0, total = 0;
    busy.forEach(function (j) { sent += uploadedBytes(j); total += Math.max(j.bytes, 1); });
    var failing = busy.some(function (j) { return j.tries >= 3; });
    return (failing ? '⚠ ' : '☁ ') + 'Uploading ' + busy.length + ' class recording' + (busy.length === 1 ? '' : 's') + ' · ' + percent(sent, total) + '%' + (failing ? ' · retrying' : '');
  }

  var pure = {
    VERSION: VERSION, HEAD: HEAD, DOC_ID: DOC_ID, CHUNK_MS: CHUNK_MS, PIECE_MS: PIECE_MS, PIECE_MAX: PIECE_MAX, PIECE_MIN: PIECE_MIN,
    MAX_PARTS: MAX_PARTS, MAX_BYTES: MAX_BYTES, STALE_MS: STALE_MS, FRAME: FRAME, CAM_BOX: CAM_BOX, VIDEO_BPS: VIDEO_BPS, AUDIO_BPS: AUDIO_BPS,
    streamable: streamable, extOf: extOf, jobId: jobId, validJobId: validJobId, partName: partName, cleanJob: cleanJob, lastTo: lastTo,
    nextPiece: nextPiece, uploadedBytes: uploadedBytes, percent: percent, chunksFor: chunksFor, fit: fit, frameLayout: frameLayout,
    fmtClock: fmtClock, stale: stale, wholeEnd: wholeEnd, pickMime: pickMime, badgeText: badgeText
  };

  /* ================================================================
     THE DEVICE'S COPY: IndexedDB
     ================================================================ */
  function idb() {
    return new Promise(function (resolve, reject) {
      var r;
      try { r = root.indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains('jobs')) db.createObjectStore('jobs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: ['job', 'seq'] });
      };
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error || new Error('This device could not keep the recording.')); };
      r.onblocked = function () { reject(new Error('Close the other Ans Key tabs and try again.')); };
    });
  }
  function makeStore() {
    var dbp = null;
    function db() { if (!dbp) dbp = idb().catch(function (e) { dbp = null; throw e; }); return dbp; }
    function tx(names, mode, fn) {
      return db().then(function (d) {
        return new Promise(function (resolve, reject) {
          var t = d.transaction(names, mode), out;
          t.oncomplete = function () { resolve(out); };
          t.onerror = function () { reject(t.error || new Error('This device could not keep the recording.')); };
          t.onabort = function () { reject(t.error || new Error('This device ran out of room for the recording.')); };
          out = fn(t);
          if (out && typeof out.then === 'function') out.then(function (v) { out = v; }, reject);
        });
      });
    }
    function req(r) { return new Promise(function (resolve, reject) { r.onsuccess = function () { resolve(r.result); }; r.onerror = function () { reject(r.error); }; }); }
    return {
      putJob: function (job) { return tx(['jobs'], 'readwrite', function (t) { t.objectStore('jobs').put(job); }); },
      jobs: function () {
        var out = [];
        return tx(['jobs'], 'readonly', function (t) { return req(t.objectStore('jobs').getAll()).then(function (list) { out = list; return list; }); })
          .then(function () { return out.map(cleanJob).filter(Boolean); });
      },
      putChunk: function (c) { return tx(['chunks'], 'readwrite', function (t) { t.objectStore('chunks').put(c); }); },
      // Every chunk of a job: seq, start, size and the Blob (a handle to the
      // disk copy, not the bytes, so an hour does not land in memory).
      chunks: function (id) {
        var out = [];
        return tx(['chunks'], 'readonly', function (t) {
          var range = root.IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
          return req(t.objectStore('chunks').getAll(range)).then(function (list) { out = list; return list; });
        }).then(function () { return out.sort(function (a, b) { return a.seq - b.seq; }); });
      },
      drop: function (id) {
        return tx(['jobs', 'chunks'], 'readwrite', function (t) {
          t.objectStore('jobs').delete(id);
          t.objectStore('chunks').delete(root.IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
        });
      }
    };
  }

  /* ================================================================
     THE RECORDER AND THE UPLOADER
     ================================================================ */
  function create(env) {
    env = env || {};
    var store = env.store || makeStore();
    var say = env.toast || function () {};
    var nowFn = env.now || function () { return Date.now(); };
    var live = {};            // id → the recording running in THIS page
    var cache = {};           // id → { index:[{seq,start,size}], blobs:{seq:Blob} } for this page's jobs
    var jobsSeen = [];        // the last read of every job, for the badge
    var pumping = false, again = false, retryTimer = 0, badgeTimer = 0, doneUntil = 0, booted = false;
    var listeners = [];

    function emit() { paintBadge(); listeners.forEach(function (fn) { try { fn(status()); } catch (e) {} }); }
    function onChange(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; }

    /* ---------- one recording ---------- */
    function start(opts) {
      opts = opts || {};
      if (!root.MediaRecorder || !root.document) return Promise.reject(new Error('This browser cannot record the class.'));
      var startedAt = nowFn();
      var id = jobId(opts.epoch, startedAt);
      var mime = pickMime(function (t) { return root.MediaRecorder.isTypeSupported(t); });
      if (!mime) return Promise.reject(new Error('This browser cannot record the class.'));
      var job = cleanJob({ id: id, uid: opts.uid, epoch: opts.epoch, startedAt: startedAt, slot: opts.slot, slotLabel: opts.slotLabel,
        type: mime.split(';')[0], state: 'recording', beat: startedAt, pieces: [], docs: [] });
      var r = {
        id: id, job: job, seq: 0, bytes: 0, t0: (root.performance && performance.now()) || startedAt, saving: Promise.resolve(),
        canvas: document.createElement('canvas'), videos: {}, audio: {}, ctx: null, dest: null, rec: null, timer: 0, beatTimer: 0,
        stopped: false, failed: false, closing: null, lastBeat: 0, savingError: false
      };
      r.canvas.width = FRAME.w; r.canvas.height = FRAME.h;
      r.g = r.canvas.getContext('2d');
      cache[id] = { index: [], blobs: {} };
      live[id] = r;
      try {
        var AC = root.AudioContext || root.webkitAudioContext;
        if (AC) {
          r.ctx = new AC();
          r.dest = r.ctx.createMediaStreamDestination();
          // A silent source keeps the audio track running when nobody speaks
          // (and before the microphone is on), so the file's clock never stalls.
          var osc = r.ctx.createConstantSource ? r.ctx.createConstantSource() : null;
          if (osc) { var g = r.ctx.createGain(); g.gain.value = 0; osc.connect(g); g.connect(r.dest); osc.start(); r.silence = osc; }
          if (r.ctx.state === 'suspended' && r.ctx.resume) r.ctx.resume().catch(function () {});
        }
      } catch (e) { r.ctx = null; r.dest = null; }
      draw(r);
      var vtrack = r.canvas.captureStream ? r.canvas.captureStream(FRAME.fps).getVideoTracks()[0] : null;
      if (!vtrack) { delete live[id]; return Promise.reject(new Error('This browser cannot record the class.')); }
      var tracks = [vtrack];
      if (r.dest) tracks = tracks.concat(r.dest.stream.getAudioTracks());
      r.stream = new MediaStream(tracks);
      try { r.rec = new root.MediaRecorder(r.stream, { mimeType: mime, videoBitsPerSecond: VIDEO_BPS, audioBitsPerSecond: AUDIO_BPS }); }
      catch (e) { delete live[id]; return Promise.reject(new Error('The recorder could not start: ' + ((e && e.message) || e))); }
      r.rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) keep(r, ev.data); };
      r.rec.onerror = function (ev) { say('The class recording stopped: ' + ((ev && ev.error && ev.error.message) || 'the recorder failed') + '. What was recorded is kept.'); stop(id); };
      return store.putJob(job).then(function () {
        r.rec.start(CHUNK_MS);
        r.timer = setInterval(function () { draw(r); }, Math.round(1000 / FRAME.fps));
        r.beatTimer = setInterval(function () { beat(r); }, BEAT_MS);
        emit();
        return handle(r);
      }, function (e) { delete live[id]; throw e; });
    }
    function handle(r) {
      return {
        id: r.id,
        setVideo: function (kind, track) { setVideo(r, kind, track); },
        setAudio: function (key, track) { setAudio(r, key, track); },
        noteDoc: function (doc) { noteDoc(r, doc); },
        elapsed: function () { return elapsed(r); },
        bytes: function () { return r.bytes; },
        stop: function () { return stop(r.id); },
        info: function () { return { id: r.id, bytes: r.bytes, elapsed: elapsed(r), pieces: r.job.pieces.length, sent: r.job.pieces.filter(function (p) { return p.done; }).length, failed: r.failed }; }
      };
    }
    function elapsed(r) { return Math.max(0, ((root.performance && performance.now()) || nowFn()) - r.t0); }
    function keep(r, blob) {
      var c = { job: r.id, seq: r.seq++, start: r.bytes, size: blob.size, at: nowFn(), blob: blob };
      r.bytes += blob.size;
      r.job.bytes = r.bytes;
      cache[r.id].index.push({ seq: c.seq, start: c.start, size: c.size });
      cache[r.id].blobs[c.seq] = blob;
      // Written in order: each chunk waits for the one before it.
      r.saving = r.saving.then(function () { return store.putChunk(c); }).then(function () {
        // Once it is on the device, memory only keeps what is not yet in the cloud.
        if (c.start + c.size <= lastTo(r.job) && cache[r.id]) delete cache[r.id].blobs[c.seq];
      }, function (e) {
        if (!r.savingError) { r.savingError = true; say('This device could not keep a copy of the recording (' + ((e && e.message) || 'no room') + '). It still goes to the cloud.'); }
      });
      if (r.bytes > MAX_BYTES - 32 * 1024 * 1024 && !r.stopped) { say('The class recording is as long as one recording may be. It has stopped and is being saved; press ⏺ to record more.'); stop(r.id); }
      kick();
    }
    function beat(r) {
      if (r.stopped) return;
      r.job.beat = nowFn();
      r.job.durationMs = Math.round(elapsed(r));
      if (typeof env.currentDoc === 'function') noteDoc(r, env.currentDoc());
      store.putJob(r.job).catch(function () {});
      emit();
    }
    function noteDoc(r, doc) {
      if (!doc || !/^[A-Za-z0-9_-]{1,64}$/.test(str(doc.id))) return;
      if (r.job.docs.some(function (d) { return d.id === doc.id; }) || r.job.docs.length >= 6) return;
      r.job.docs.push({ id: str(doc.id), name: str(doc.name).slice(0, 120) });
    }
    function videoFor(r, kind, track) {
      var v = r.videos[kind];
      if (v && v.track === track) return v;
      if (v) { try { v.el.srcObject = null; } catch (e) {} delete r.videos[kind]; }
      if (!track) return null;
      var el = document.createElement('video');
      el.muted = true; el.playsInline = true; el.autoplay = true;
      el.setAttribute('playsinline', '');
      try { el.srcObject = new MediaStream([track]); } catch (e) { return null; }
      var p = el.play(); if (p && p.catch) p.catch(function () {});
      r.videos[kind] = { el: el, track: track };
      return r.videos[kind];
    }
    function setVideo(r, kind, track) {
      if (r.stopped || (kind !== 'screen' && kind !== 'camera')) return;
      videoFor(r, kind, track && track.readyState !== 'ended' ? track : null);
    }
    function setAudio(r, key, track) {
      if (r.stopped || !r.ctx || !r.dest) return;
      var cur = r.audio[key];
      if (cur && cur.track === track) return;
      if (cur) { try { cur.node.disconnect(); } catch (e) {} delete r.audio[key]; }
      if (!track || track.readyState === 'ended') return;
      try {
        var node = r.ctx.createMediaStreamSource(new MediaStream([track]));
        node.connect(r.dest);
        r.audio[key] = { node: node, track: track };
      } catch (e) {}
    }
    function live2d(v) { return v && v.el && v.el.readyState >= 2 && v.el.videoWidth > 0 && v.track && v.track.readyState === 'live' && !v.track.muted ? v : null; }
    function draw(r) {
      var g = r.g, W = FRAME.w, H = FRAME.h;
      if (!g) return;
      var sv = live2d(r.videos.screen), cv = live2d(r.videos.camera);
      if (cv && r.videos.camera.track.enabled === false) cv = null;
      var L = frameLayout(W, H, sv ? { w: sv.el.videoWidth, h: sv.el.videoHeight } : null, cv ? { w: cv.el.videoWidth, h: cv.el.videoHeight } : null);
      g.fillStyle = sv ? '#f3f2f0' : '#1d1b18';
      g.fillRect(0, 0, W, H);
      try {
        if (L.screen) g.drawImage(sv.el, L.screen.x, L.screen.y, L.screen.w, L.screen.h);
        if (L.cam) {
          if (L.screen) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(L.cam.x - 2, L.cam.y - 2, L.cam.w + 4, L.cam.h + 4); }
          g.drawImage(cv.el, L.cam.x, L.cam.y, L.cam.w, L.cam.h);
        }
      } catch (e) {}
      if (L.card) {
        g.fillStyle = '#ffe0b2';
        g.font = '600 44px "Segoe UI", system-ui, sans-serif';
        g.textAlign = 'center';
        g.fillText('🎥 Live class', W / 2, H / 2 - 20);
        g.fillStyle = '#d9d4cc';
        g.font = '28px "Segoe UI", system-ui, sans-serif';
        g.fillText((r.job.slotLabel || '') + '  ·  ' + fmtClock(elapsed(r)), W / 2, H / 2 + 36);
      }
    }
    function stop(id) {
      var r = live[id];
      if (!r) return Promise.resolve(null);
      if (r.closing) return r.closing;
      r.stopped = true;
      clearInterval(r.timer); clearInterval(r.beatTimer);
      r.closing = new Promise(function (resolve) {
        var done = function () {
          r.saving.then(function () {
            r.job.state = 'finishing';
            r.job.endedAt = nowFn();
            r.job.durationMs = Math.max(1000, Math.round(elapsed(r)));
            r.job.bytes = r.bytes;
            Object.keys(r.videos).forEach(function (k) { try { r.videos[k].el.srcObject = null; } catch (e) {} });
            Object.keys(r.audio).forEach(function (k) { try { r.audio[k].node.disconnect(); } catch (e) {} });
            try { if (r.silence) r.silence.stop(); } catch (e) {}
            try { if (r.ctx && r.ctx.close) r.ctx.close(); } catch (e) {}
            try { r.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
            r.canvas.width = r.canvas.height = 0;
            delete live[id];
            if (!r.bytes) return store.drop(id).then(function () { resolve(null); }, function () { resolve(null); });
            return store.putJob(r.job).then(function () { emit(); kick(); resolve(r.job); }, function () { emit(); kick(); resolve(r.job); });
          });
        };
        if (r.rec && r.rec.state !== 'inactive') { r.rec.onstop = done; try { r.rec.stop(); } catch (e) { done(); } }
        else done();
      });
      return r.closing;
    }
    function stopAll() { return Promise.all(Object.keys(live).map(stop)); }

    /* ---------- the uploader: one piece at a time, every job in turn ---------- */
    function kick(delay) {
      clearTimeout(retryTimer);
      if (delay) { retryTimer = setTimeout(kick, delay); return; }
      if (pumping) { again = true; return; }
      pumping = true;
      var run = function () { return pump().catch(function () {}); };
      var p = root.navigator && navigator.locks && navigator.locks.request
        ? navigator.locks.request('polymath-live-class-upload', { ifAvailable: true }, function (lock) { return lock ? run() : null; })
        : run();
      Promise.resolve(p).catch(function () {}).then(function () {
        pumping = false;
        if (again) { again = false; kick(); }
      });
    }
    function allowed(job) {
      if (typeof env.canUpload === 'function') return !!env.canUpload(job);
      return true;
    }
    async function pump() {
      var jobs;
      try { jobs = await store.jobs(); } catch (e) { return; }
      // A page's own recording is fresher than its stored copy.
      jobs = jobs.map(function (j) { return live[j.id] ? live[j.id].job : j; });
      jobsSeen = jobs;
      emit();
      jobs.sort(function (a, b) { return a.startedAt - b.startedAt; });
      var wait = 0;
      for (var k = 0; k < jobs.length; k++) {
        var job = jobs[k];
        if (!allowed(job)) continue;
        try {
          await advance(job);
          if (job.tries) { job.tries = 0; job.error = ''; await saveJob(job); }
        } catch (e) {
          job.tries = (job.tries || 0) + 1;
          job.error = str((e && e.message) || e).slice(0, 300);
          await saveJob(job).catch(function () {});
          if (job.tries === 3) say('A class recording has not reached the cloud yet (' + job.error + '). It is kept on this device and will keep trying.');
          wait = wait ? Math.min(wait, RETRY_MS[Math.min(job.tries - 1, RETRY_MS.length - 1)]) : RETRY_MS[Math.min(job.tries - 1, RETRY_MS.length - 1)];
        }
      }
      try { jobsSeen = (await store.jobs()).map(function (j) { return live[j.id] ? live[j.id].job : j; }); } catch (e) {}
      emit();
      var busy = jobsSeen.some(function (j) { return j.state !== 'done' && j.state !== 'failed' && allowed(j); });
      if (wait) kick(wait);
      else if (busy) kick(Object.keys(live).length ? 5000 : 15000);
    }
    function saveJob(job) { return live[job.id] ? Promise.resolve() : store.putJob(job); }
    async function indexOf(job) {
      if (cache[job.id] && (live[job.id] || cache[job.id].full)) return cache[job.id];
      var list = await store.chunks(job.id);
      var c = { index: [], blobs: {}, full: true };
      var at = 0;
      list.forEach(function (x) {
        // A chunk lost from the middle would shift every byte after it: stop there.
        if (x.start !== at) return;
        c.index.push({ seq: x.seq, start: x.start, size: x.size });
        c.blobs[x.seq] = x.blob;
        at += x.size;
      });
      c.bytes = at;
      c.lastAt = list.length ? list[list.length - 1].at : 0;
      cache[job.id] = c;
      return c;
    }
    async function blobRange(job, from, to) {
      var c = await indexOf(job);
      var parts = chunksFor(c.index, from, to);
      var missing = parts.some(function (p) { return !c.blobs[p.seq]; });
      if (missing) {
        // This page dropped them from memory: read them back off the disk.
        var list = await store.chunks(job.id);
        list.forEach(function (x) { c.blobs[x.seq] = x.blob; });
      }
      var out = parts.map(function (p) {
        var b = c.blobs[p.seq];
        if (!b) throw new Error('Part of the recording is missing on this device.');
        return p.cutFrom === 0 && p.cutTo === b.size ? b : b.slice(p.cutFrom, p.cutTo);
      });
      return new Blob(out, { type: job.type });
    }
    async function sendPiece(job, piece) {
      var blob = await blobRange(job, piece.from, piece.to);
      if (blob.size !== piece.to - piece.from) throw new Error('A piece of the recording came out the wrong size.');
      await env.put(partName(job.id, piece.i), blob, job.type);
      piece.done = true;
      job.lastPieceAt = nowFn();
      // Memory no longer needs what is now on the device and in the cloud.
      var c = cache[job.id];
      if (c && live[job.id]) c.index.forEach(function (x) { if (x.start + x.size <= piece.to && c.blobs[x.seq] !== undefined) delete c.blobs[x.seq]; });
    }
    async function advance(job) {
      var nowMs = nowFn();
      if (job.state === 'done') { await store.drop(job.id).catch(function () {}); delete cache[job.id]; return; }
      if (job.state === 'failed') return;
      if (job.state === 'recording' && !live[job.id]) {
        if (!stale(job, nowMs)) return;
        // The page that recorded it has gone: finish what it kept.
        var c0 = await indexOf(job);
        job.state = 'finishing';
        // A recorder that never stopped leaves its last block cut short, and
        // a cut block makes the file's length unwritable. Keep the file up to
        // the last chunk it still reads to the end of.
        job.trim = await readableEnd(job, c0);
        job.bytes = job.trim || c0.bytes;
        job.endedAt = c0.lastAt || job.beat || nowMs;
        job.durationMs = Math.max(1000, (c0.lastAt || job.beat || nowMs) - job.startedAt);
        await store.putJob(job);
      }
      if (job.state === 'recording') {
        // Mid-lesson: one piece if one is due.
        var r = live[job.id];
        var p = nextPiece(job, r.bytes, nowMs, false);
        if (p) { job.pieces.push(p); await sendPiece(job, p); await store.putJob(job); emit(); }
        return;
      }
      if (job.state === 'finishing') {
        var c = await indexOf(job);
        job.bytes = job.trim ? Math.min(job.trim, c.bytes) : c.bytes;
        if (!job.bytes) { await store.drop(job.id); return; }
        // Pieces already cut but not yet sent (a piece in flight when the tab closed).
        for (var k = 0; k < job.pieces.length; k++) if (!job.pieces[k].done) { await sendPiece(job, job.pieces[k]); await store.putJob(job); emit(); }
        var p2;
        while ((p2 = nextPiece(job, job.bytes, nowMs, true))) {
          job.pieces.push(p2);
          await sendPiece(job, p2);
          await store.putJob(job);
          emit();
        }
        job.state = 'saving';
        await store.putJob(job);
      }
      if (job.state === 'saving') {
        var result = await join(job);
        job.url = result.url; job.path = result.path;
        if (typeof env.saved === 'function') await env.saved(job, result);
        job.state = 'done';
        await store.putJob(job);
        doneUntil = nowFn() + DONE_SHOW_MS;
        say('📼 The class recording' + (job.slotLabel ? ' (' + job.slotLabel + ')' : '') + ' is saved' + (job.docs.length ? ' and on its worksheet' : '') + '.');
        await store.drop(job.id).catch(function () {});
        delete cache[job.id];
        emit();
      }
    }
    // Where a cut-off recording still reads to the end: the whole of it when
    // the finalizer can read it, else the end of its last whole block.
    async function readableEnd(job, c) {
      if (!streamable(job.type) || typeof env.plan !== 'function' || !c.index.length) return 0;
      var ms = Math.max(1000, (c.lastAt || job.beat || nowFn()) - job.startedAt);
      try { await env.plan(await blobRange(job, 0, c.bytes), ms); return 0; } catch (e) {}
      var base = Math.max(0, c.bytes - TAIL_BYTES);
      var tail = new Uint8Array(await (await blobRange(job, base, c.bytes)).arrayBuffer());
      var end = wholeEnd(tail, base, c.bytes);
      if (!end || (job.pieces.length && end < lastTo(job))) return 0;     // never below what is already in the cloud
      try { await env.plan(await blobRange(job, 0, end), ms); return end; } catch (e) { return 0; }
    }
    // Part 0 (the head, with the file's length written in), then the join.
    async function join(job) {
      var c = await indexOf(job);
      var raw = await blobRange(job, 0, Math.min(c.bytes, job.bytes || c.bytes));
      var pieces = job.pieces.filter(function (p) { return p.done; });
      var count, bytes;
      if (streamable(job.type)) {
        var plan = { head: [], cut: 0 };
        try { plan = typeof env.plan === 'function' ? await env.plan(raw, job.durationMs) : plan; } catch (e) { plan = { head: [], cut: 0 }; }
        var headEnd = pieces.length ? HEAD : raw.size;
        if (plan.cut > headEnd) {
          // The length could not be written inside the head: send it whole.
          pieces = [];
          headEnd = raw.size;
        }
        var head = new Blob((plan.head || []).concat([raw.slice(plan.cut, headEnd)]), { type: job.type });
        await env.put(partName(job.id, 0), head, job.type);
        count = pieces.length + 1;
        bytes = head.size + pieces.reduce(function (s, p) { return s + (p.to - p.from); }, 0);
        if (!pieces.length && job.pieces.length) job.pieces = [];
      } else {
        var whole = typeof env.finishWhole === 'function' ? await env.finishWhole(raw) : raw;
        await env.put(partName(job.id, 0), whole, job.type);
        count = 1; bytes = whole.size;
      }
      try {
        return await env.compose({ type: 'compose', docId: DOC_ID, id: job.id, ext: extOf(job.type), parts: count, contentType: job.type, bytes: bytes });
      } catch (e) {
        // The cloud lost a piece: send them all again next time round.
        if (/not in the cloud|has not reached|did not reach/i.test(str(e && e.message))) { job.pieces.forEach(function (p) { p.done = false; }); job.state = 'finishing'; }
        throw e;
      }
    }

    /* ---------- what the teacher sees ---------- */
    function status() {
      var list = jobsSeen.map(function (j) {
        var r = live[j.id];
        var bytes = r ? r.bytes : j.bytes;
        return { id: j.id, epoch: j.epoch, startedAt: j.startedAt, slotLabel: j.slotLabel, state: j.state, recording: !!r,
          bytes: bytes, percent: percent(uploadedBytes(j), Math.max(bytes, 1)), tries: j.tries, error: j.error };
      });
      Object.keys(live).forEach(function (id) {
        if (!list.some(function (x) { return x.id === id; })) {
          var r = live[id];
          list.push({ id: id, epoch: r.job.epoch, startedAt: r.job.startedAt, slotLabel: r.job.slotLabel, state: 'recording', recording: true, bytes: r.bytes, percent: percent(uploadedBytes(r.job), Math.max(r.bytes, 1)) });
        }
      });
      return list;
    }
    function paintBadge() {
      if (!root.document || !document.body) return;
      var b = document.getElementById('vcUpBadge');
      var text = badgeText(jobsSeen.filter(function (j) { return allowed(j) && !live[j.id]; }), nowFn());
      var done = !text && nowFn() < doneUntil;
      if (!text && !done) { if (b) b.hidden = true; return; }
      if (!b) {
        b = document.createElement('div');
        b.id = 'vcUpBadge';
        b.className = 'vcUpBadge';
        b.setAttribute('role', 'status');
        b.setAttribute('aria-live', 'polite');
        document.body.appendChild(b);
      }
      b.hidden = false;
      b.classList.toggle('done', done);
      b.textContent = done ? '✓ Class recording saved' : text;
      b.title = done ? 'Saved to Ans Key: it is on the lesson\'s worksheet and in 🎥 Live class → Recordings.'
        : 'The class recording is going up to Ans Key\'s cloud in the background. You can carry on teaching. If this tab closes, it finishes the next time Ans Key opens on this device.';
      clearTimeout(badgeTimer);
      if (done) badgeTimer = setTimeout(paintBadge, DONE_SHOW_MS + 100);
    }
    function pending() { return Object.keys(live).length > 0 || jobsSeen.some(function (j) { return (j.state === 'finishing' || j.state === 'saving') && allowed(j); }); }
    function boot() {
      if (booted) { kick(); return; }
      booted = true;
      root.addEventListener && root.addEventListener('beforeunload', function (e) {
        if (!pending()) return;
        // Nothing is lost if they leave (it resumes next time), but leaving
        // now holds the recording back until then, so ask.
        e.preventDefault(); e.returnValue = '';
        return '';
      });
      root.addEventListener && root.addEventListener('online', function () { kick(); });
      kick();
    }
    return { start: start, stop: stop, stopAll: stopAll, kick: kick, boot: boot, status: status, onChange: onChange, pending: pending,
      _jobs: function () { return jobsSeen; } };
  }

  root.LiveClassRecord = { pure: pure, create: create, makeStore: makeStore };
})(typeof window !== 'undefined' ? window : globalThis);
