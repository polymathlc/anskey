/* =====================================================================
   🎬 VIDEOS ON PAPER — one link and one QR code for every video (v1.195.0)
   ---------------------------------------------------------------------
   A worksheet with a lesson recorded for question 2, a YouTube clip for
   question 5 and a camera lesson for question 7 used to download as a PDF
   with three purple "Play video" rectangles baked over the paper, each one
   sitting on top of whatever was printed under it, and each one a separate
   link a student had to find and tap. Now the exported PDF carries ONE box
   on page 1 — a QR code and a link — that opens videos.html: a media player
   with every video on the worksheet in a playlist, in question order. The
   rectangles are left off the paper entirely, so nothing is covered.

   This file is shared by the two halves of that feature and holds NO state:

     • Ans Key (index.html's `🎬 Videos on paper — glue`) turns the
       worksheet's video annotations into a playlist (`buildPlaylist`),
       uploads it once under its own content hash (`publishPath` /
       `publishPayload`), and draws the box on page 1 of the PDF
       (`choosePlacement`, `drawOnPdf`).
     • videos.html downloads that one file by its token (`parseViewerQuery`
       → `mediaUrl`), checks it is the playlist the code was printed for
       (`readPublished`), and plays it.

   THE PLAYLIST IS CONTENT-ADDRESSED, exactly like a living app's code
   (living-apps.js): `pdf-annotator/videos-<hash>.json`, where the hash is
   taken over the CLEANED playlist. The same videos are one file however
   many times the sheet is exported, and a changed playlist is a new file —
   so a printed code can never start showing a different set of videos.

   `cleanItem` IS THE ONE DOOR. Everything the player puts on screen goes
   through it, on the way up (so the hash is over what will be shown) and on
   the way back down (because the bucket is shared and a file is only data):
   https only, YouTube and Drive reduced to their ids and rebuilt from them,
   a lesson's media only from the bucket's own `pdf-annotator/lesson-` path,
   words capped. Nothing from the file is ever written as markup.

   `orderKey` IS THE SAME ORDER AS THE APP'S PLAYLIST (`lessonPlaylistItems`
   in index.html): page, then ROW (24 page units, rounded), then left to
   right. tools/video-playlist-tests.mjs runs both on the same annotations.
   ===================================================================== */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------
     Constants
     --------------------------------------------------------------- */
  var VERSION = 1;
  var PUBLISH_DIR = 'pdf-annotator';
  var PUBLISH_PREFIX = 'videos-';
  var VIEWER_PAGE = 'videos.html';
  var BUCKET = 'mathgen--app.firebasestorage.app';
  var BUCKETS = ['mathgen--app.firebasestorage.app', 'mathgen--app.appspot.com'];
  var HASH_RE = /^vp1-\d{1,7}-[0-9a-f]{1,8}$/;
  var TOKEN_RE = /^[0-9A-Za-z-]{16,80}$/;
  var CODE_RE = /^[A-Za-z0-9_-]{31}$/;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var WS_RE = /^[A-Za-z0-9_-]{1,128}$/;
  var REC_RE = /^[A-Za-z0-9_-]{1,120}$/;
  var YT_RE = /^[\w-]{6,20}$/;
  var DRIVE_RE = /^[\w-]{10,120}$/;
  var B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  var ROW = 24;                 // page units: pills this close vertically are one row (= PLAYLIST_ROW)
  var ITEMS_MAX = 150;          // a worksheet with more videos than this is not a worksheet
  var LABEL_MAX = 120;
  var NAME_MAX = 140;
  var URL_MAX = 2048;
  var MS_MAX = 8 * 60 * 60 * 1000;   // the lesson recorder's own ceiling
  var KINDS = ['lesson', 'file', 'youtube', 'drive', 'link'];
  var DEFAULT_LABEL = 'Watch video solution';
  var AT_MIN = Date.UTC(2020, 0, 1);  // a lesson's recorded-at time must fall
  var AT_MAX = Date.UTC(2100, 0, 1);  // inside these, or it is left off
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var UNDATED_LABEL = 'More videos';

  /* ---------------------------------------------------------------
     Small helpers
     --------------------------------------------------------------- */
  function str(v) { return v == null ? '' : String(v); }
  function clip(v, max) {
    var s = str(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (s.length <= max) return s;
    return s.slice(0, Math.max(1, max - 1)).replace(/\s+\S*$/, '') + '…';
  }
  function finite(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function parseUrl(u) {
    try { return new URL(str(u)); } catch (e) { return null; }
  }

  /* A web address the player may open or play: https (or, for a link that
     only opens in a new tab, http), no credentials, no other scheme. */
  function cleanUrl(u, allowHttp) {
    var s = str(u).trim();
    if (!s || s.length > URL_MAX) return '';
    var p = parseUrl(s);
    if (!p) return '';
    if (p.protocol !== 'https:' && !(allowHttp && p.protocol === 'http:')) return '';
    if (p.username || p.password) return '';
    if (!p.hostname || !/\./.test(p.hostname)) return '';
    return p.href;
  }

  /* A lesson's media and captions live in OUR bucket, under
     pdf-annotator/lesson-…, and nowhere else (the app's lessonAssetUrl). */
  function lessonAssetOk(u) {
    var p = parseUrl(u);
    if (!p || p.protocol !== 'https:' || p.hostname !== 'firebasestorage.googleapis.com') return false;
    var m = /^\/v0\/b\/([^/]+)\/o\/(.+)$/.exec(p.pathname);
    if (!m || BUCKETS.indexOf(m[1]) < 0) return false;
    var name = '';
    try { name = decodeURIComponent(m[2]); } catch (e) { return false; }
    return name.indexOf(PUBLISH_DIR + '/lesson-') === 0 && name.indexOf('..') < 0;
  }

  /* What a pasted link is — the same reading as the app's videoEmbedInfo:
     YouTube and Drive play in their own player, Dropbox and plain video
     files (and anything in our own bucket) in a <video>, the rest is a link
     that can only be opened. */
  function classify(url) {
    var s = str(url).trim();
    var m = s.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{6,})/i);
    if (m) return { kind: 'youtube', id: m[1].slice(0, 20) };
    m = s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]+)/i);
    if (m) return { kind: 'drive', id: m[1] };
    if (/^https?:\/\/(www\.)?dropbox\.com\//i.test(s)) {
      var src = s
        .replace(/^https?:\/\/(www\.)?dropbox\.com/i, 'https://dl.dropboxusercontent.com')
        .replace(/([?&])(dl|raw)=\d+/g, '$1')
        .replace(/[?&]+$/, '')
        .replace(/\?&/, '?');
      return { kind: 'file', url: src };
    }
    if (/\.(mp4|m4v|webm|mov)($|\?)/i.test(s)) return { kind: 'file', url: s };
    if (/^https?:\/\/(firebasestorage\.googleapis\.com|[\w.-]*\.firebasestorage\.app)\//i.test(s)) return { kind: 'file', url: s };
    return { kind: 'link', url: s };
  }

  /* ---------------------------------------------------------------
     The order: page, then row, then left to right
     --------------------------------------------------------------- */
  function orderKey(a) {
    var page = finite(a && a.page, 0);
    return { page: page, row: Math.round(finite(a && a.y, 0) / ROW), x: finite(a && a.x, 0) };
  }
  function compareOrder(p, q) {
    var a = orderKey(p), b = orderKey(q);
    if (a.page !== b.page) return a.page - b.page;
    if (a.row !== b.row) return a.row - b.row;
    return a.x - b.x;
  }

  /* ---------------------------------------------------------------
     An annotation → a playlist item, and THE ONE DOOR (cleanItem)
     --------------------------------------------------------------- */
  function isVideoAnnotation(a) { return !!(a && a.type === 'video'); }

  /* The raw item for one video annotation, or null when there is nothing on
     it to watch (a pill whose upload was abandoned has no url). `labelFn` is
     the app's videoPillLabel, so the playlist says what the pill said. */
  function itemFromAnnotation(a, labelFn) {
    if (!isVideoAnnotation(a) || !a.url || !isFinite(Number(a.page))) return null;
    var label = typeof labelFn === 'function' ? labelFn(a) : (a.label || DEFAULT_LABEL);
    var r = a.lessonRecording;
    if (r && typeof r === 'object') {
      var it = {
        kind: 'lesson', label: label, page: Number(a.page), url: a.url,
        camera: !!(r.video || r.screen), ms: r.duration, rec: a.id
      };
      // 📅 When it was recorded: the player and Polymath Online group the
      // lessons by the day of the class they were taught in.
      if (isFinite(Number(a.ts))) it.at = Number(a.ts);
      if (r.title) it.title = r.title;
      if (r.captionsUrl && r.captionsLang === 'en') it.captions = r.captionsUrl;
      if (r.screen && r.frame === 'portrait') it.portrait = true;
      return it;
    }
    var c = classify(a.url);
    var out = { kind: c.kind, label: label, page: Number(a.page) };
    if (c.kind === 'youtube' || c.kind === 'drive') { out.id = c.id; out.open = a.url; }
    else out.url = c.url;
    return out;
  }

  /* Every field the player reads, checked. Returns a fresh object in a
     fixed key order (the hash depends on it) or null. Idempotent:
     cleanItem(cleanItem(x)) deep-equals cleanItem(x). */
  function cleanItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var kind = str(raw.kind);
    if (KINDS.indexOf(kind) < 0) return null;
    var page = Math.round(finite(raw.page, 0));
    if (!(page >= 1 && page <= 9999)) return null;
    var out = { kind: kind, label: clip(raw.label, LABEL_MAX) || DEFAULT_LABEL, page: page };
    if (kind === 'lesson') {
      var u = cleanUrl(raw.url);
      if (!u || !lessonAssetOk(u)) return null;
      out.url = u;
      out.camera = !!raw.camera;
      var ms = Math.round(finite(raw.ms, 0));
      if (ms > 0 && ms <= MS_MAX) out.ms = ms;
      if (raw.title) { var t = clip(raw.title, 60); if (t) out.title = t; }
      if (raw.captions) { var cc = cleanUrl(raw.captions); if (cc && lessonAssetOk(cc)) out.captions = cc; }
      if (raw.rec && REC_RE.test(str(raw.rec))) out.rec = str(raw.rec);
      if (raw.portrait) out.portrait = true;
      // Optional, so a list hosted before lessons carried a date keeps its hash.
      var at = Math.round(finite(raw.at, 0));
      if (at >= AT_MIN && at < AT_MAX) out.at = at;
      return out;
    }
    if (kind === 'youtube') {
      var y = str(raw.id);
      if (!YT_RE.test(y)) return null;
      out.id = y;
      var yo = cleanUrl(raw.open, true);
      out.open = yo || 'https://www.youtube.com/watch?v=' + y;
      return out;
    }
    if (kind === 'drive') {
      var d = str(raw.id);
      if (!DRIVE_RE.test(d)) return null;
      out.id = d;
      out.open = 'https://drive.google.com/file/d/' + d + '/view';
      return out;
    }
    if (kind === 'file') {
      var f = cleanUrl(raw.url);
      if (!f) return null;
      out.url = f;
      return out;
    }
    // A link that can only be opened in a new tab.
    var l = cleanUrl(raw.url, true);
    if (!l) return null;
    out.url = l;
    return out;
  }

  /* The worksheet's videos as a playlist, or null when there are none.
     `meta` = { name, ws, label } — the worksheet's name, its document id
     (for a lesson's "with the writing" link) and the app's pill label. */
  function buildPlaylist(anns, meta) {
    meta = meta || {};
    var list = (anns || []).filter(isVideoAnnotation).slice().sort(compareOrder);
    var items = [];
    for (var i = 0; i < list.length && items.length < ITEMS_MAX; i++) {
      var it = cleanItem(itemFromAnnotation(list[i], meta.label));
      if (it) items.push(it);
    }
    if (!items.length) return null;
    var pl = { v: VERSION, name: clip(meta.name, NAME_MAX) || 'Worksheet', ws: WS_RE.test(str(meta.ws)) ? str(meta.ws) : '', items: items };
    pl.hash = contentHash(canonical(pl));
    return pl;
  }

  /* The text the hash is taken over: the cleaned playlist, in a fixed key
     order, without the hash itself. */
  function canonical(pl) {
    return JSON.stringify({ v: VERSION, name: pl.name, ws: pl.ws, items: pl.items });
  }

  /* The same 32-bit FNV-1a as a living app's, with its own prefix. */
  function contentHash(text) {
    var s = str(text), h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return 'vp1-' + s.length + '-' + (h >>> 0).toString(16);
  }

  /* A downloaded playlist, cleaned field by field. */
  function cleanPlaylist(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.items)) return null;
    var items = [];
    for (var i = 0; i < d.items.length && items.length < ITEMS_MAX; i++) {
      var it = cleanItem(d.items[i]);
      if (it) items.push(it);
    }
    if (!items.length) return null;
    return { v: VERSION, name: clip(d.name, NAME_MAX) || 'Worksheet', ws: WS_RE.test(str(d.ws)) ? str(d.ws) : '', items: items };
  }

  /* ---------------------------------------------------------------
     Hosting: the file, its token, the viewer link
     --------------------------------------------------------------- */
  function validHash(h) { return typeof h === 'string' && HASH_RE.test(h); }
  function validToken(t) { return typeof t === 'string' && TOKEN_RE.test(t); }
  function publishPath(hash) {
    return validHash(hash) ? PUBLISH_DIR + '/' + PUBLISH_PREFIX + hash + '.json' : '';
  }
  /* What is stored: the worksheet's name, its id and its videos — never a
     student, never the teacher, never the page's other annotations. */
  function publishPayload(pl) {
    if (!pl || !validHash(pl.hash) || !Array.isArray(pl.items) || !pl.items.length) return '';
    var clean = cleanPlaylist(pl);
    if (!clean || contentHash(canonical(clean)) !== pl.hash) return '';
    return JSON.stringify({ v: VERSION, name: clean.name, ws: clean.ws, items: clean.items, hash: pl.hash });
  }
  function tokenFromDownloadUrl(url) {
    var m = /[?&]token=([^&#]+)/.exec(str(url));
    var t = '';
    try { t = m ? decodeURIComponent(m[1]) : ''; } catch (e) { t = ''; }
    return validToken(t) ? t : '';
  }
  /* The file's address is REBUILT from the bucket, the hash and the token:
     a code can never be pointed at anything else. */
  function mediaUrl(hash, token, bucket) {
    var p = publishPath(hash);
    if (!p || !validToken(token)) return '';
    return 'https://firebasestorage.googleapis.com/v0/b/' + (bucket || BUCKET) + '/o/' +
      encodeURIComponent(p) + '?alt=media&token=' + encodeURIComponent(token);
  }

  /* The packed code — the living apps' 23-byte packing (length 3 bytes,
     FNV 4 bytes, the token's 16), written as 31 base64url characters after
     a bare `?`. About 80 characters in all: a small code that a phone reads
     off a photocopy. */
  function bytesToB64u(bytes) {
    var out = '', i;
    for (i = 0; i < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      var left = bytes.length - i;
      out += B64U[(n >> 18) & 63] + B64U[(n >> 12) & 63];
      if (left > 1) out += B64U[(n >> 6) & 63];
      if (left > 2) out += B64U[n & 63];
    }
    return out;
  }
  function b64uToBytes(s) {
    var bytes = [], bits = 0, acc = 0;
    for (var i = 0; i < s.length; i++) {
      var v = B64U.indexOf(s[i]);
      if (v < 0) return null;
      acc = (acc << 6) | v;
      bits += 6;
      if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); }
    }
    return bytes;
  }
  function packCode(hash, token) {
    if (!validHash(hash) || typeof token !== 'string' || !UUID_RE.test(token)) return '';
    var parts = hash.split('-');
    var len = Number(parts[1]), h = parseInt(parts[2], 16);
    if (!(len >= 0 && len < 16777216) || !(h >= 0 && h <= 4294967295)) return '';
    var bytes = [(len >>> 16) & 255, (len >>> 8) & 255, len & 255,
      (h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255];
    var hex = token.replace(/-/g, '');
    for (var i = 0; i < 32; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
    return bytesToB64u(bytes);
  }
  function unpackCode(code) {
    if (typeof code !== 'string' || !CODE_RE.test(code)) return null;
    var b = b64uToBytes(code);
    if (!b || b.length !== 23) return null;
    var len = (b[0] << 16) | (b[1] << 8) | b[2];
    var h = ((b[3] << 24) | (b[4] << 16) | (b[5] << 8) | b[6]) >>> 0;
    var hex = '';
    for (var i = 7; i < 23; i++) hex += ('0' + b[i].toString(16)).slice(-2);
    var token = hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
    var hash = 'vp1-' + len + '-' + h.toString(16);
    return validHash(hash) && validToken(token) ? { hash: hash, token: token } : null;
  }
  /* videos.html beside the page that made it, then the packed code (or,
     for a token that cannot be packed, the hash and token spelled out). */
  function viewerUrl(pageHref, hash, token) {
    if (!validHash(hash) || !validToken(token)) return '';
    var base = str(pageHref).split('#')[0].split('?')[0].replace(/[^/]*$/, '');
    if (!/^https?:\/\//i.test(base)) return '';
    var code = packCode(hash, token);
    return base + VIEWER_PAGE + '?' + (code || 'p=' + hash + '&t=' + token);
  }
  function parseViewerQuery(search) {
    var raw = str(search).replace(/^\?/, '');
    var bare = raw.split('&')[0].split('#')[0];
    if (CODE_RE.test(bare)) return unpackCode(bare);
    var q = {};
    raw.split('#')[0].split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      var k = i < 0 ? kv : kv.slice(0, i);
      var v = i < 0 ? '' : kv.slice(i + 1);
      try { q[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) {}
    });
    var hash = q.p || '', token = q.t || '';
    return validHash(hash) && validToken(token) ? { hash: hash, token: token } : null;
  }
  /* The downloaded file, checked: it must be a playlist, and the playlist
     must be the one the code was printed for. */
  function readPublished(text, hash) {
    var d = null;
    try { d = JSON.parse(str(text)); } catch (e) { return { ok: false, message: 'That video list could not be read.' }; }
    var clean = cleanPlaylist(d);
    if (!clean) return { ok: false, message: 'That video list is empty or damaged.' };
    if (contentHash(canonical(clean)) !== hash) return { ok: false, message: 'That video list is not the one this code was printed for.' };
    clean.hash = hash;
    return { ok: true, playlist: clean };
  }
  /* A remembered hosted copy, when it is still this playlist. */
  function publishedFor(pl, pub) {
    if (!pl || !pub || !validHash(pub.hash) || !validToken(pub.token) || pub.hash !== pl.hash) return null;
    return { hash: pub.hash, token: pub.token };
  }

  /* ---------------------------------------------------------------
     The annotations a PDF draws once the link is on page 1
     --------------------------------------------------------------- */
  function stripVideos(anns) {
    return (anns || []).filter(function (a) { return !isVideoAnnotation(a); });
  }
  function countWords(n) {
    n = Math.max(0, Math.round(finite(n, 0)));
    return n === 1 ? 'the video' : 'all ' + n + ' videos';
  }
  function headline(n) {
    n = Math.max(0, Math.round(finite(n, 0)));
    return n === 1 ? 'Watch the video' : 'Watch all ' + n + ' videos';
  }

  /* ---------------------------------------------------------------
     📄 The box on page 1
     Two shapes: WIDE (the code with three lines beside it) and COMPACT (the
     code with one line under it). The placement tries the six edge spots of
     the page for each, scores every one by how much printed ink and how
     much writing it would cover, and takes the cleanest — so on a page with
     an empty corner the box covers nothing at all.
     --------------------------------------------------------------- */
  var BOX = Object.freeze({
    margin: 16,       // points from the page's edge (inside every printer's margin)
    pad: 6,
    wide: { qr: 60, text: 120, gap: 7 },
    compact: { qr: 56, label: 11 },
    quiet: 2          // modules of white round the code
  });
  var SPOT_ORDER = ['top-right', 'bottom-right', 'top-left', 'bottom-left', 'bottom-center', 'top-center'];

  function boxSize(variant) {
    if (variant === 'compact') return { w: BOX.pad * 2 + BOX.compact.qr, h: BOX.pad * 2 + BOX.compact.qr + BOX.compact.label };
    return { w: BOX.pad * 2 + BOX.wide.qr + BOX.wide.gap + BOX.wide.text, h: BOX.pad * 2 + BOX.wide.qr };
  }

  /* The six spots for a box of w × h on a page whose box is
     { x, y, width, height } (PDF points, origin bottom-left). */
  function candidateSpots(page, w, h, margin) {
    var m = margin == null ? BOX.margin : margin;
    var X = finite(page.x, 0), Y = finite(page.y, 0), W = finite(page.width, 0), H = finite(page.height, 0);
    if (W < w + 2 * m || H < h + 2 * m) return [];
    var left = X + m, right = X + W - m - w, centre = X + (W - w) / 2;
    var top = Y + H - m - h, bottom = Y + m;
    var at = {
      'top-right': [right, top], 'bottom-right': [right, bottom], 'top-left': [left, top],
      'bottom-left': [left, bottom], 'bottom-center': [centre, bottom], 'top-center': [centre, top]
    };
    return SPOT_ORDER.map(function (name, i) {
      return { name: name, order: i, x: round2(at[name][0]), y: round2(at[name][1]), w: w, h: h };
    });
  }
  function round2(v) { return Math.round(v * 100) / 100; }

  function overlapArea(a, b) {
    var w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    var h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  }

  /* How much a spot would cover: the share of it that is printed ink
     (`ink(rect)` → 0…1, or null when the page could not be measured) plus
     twice the share of it under the teacher's own writing (`obstacles`).
     Writing counts double because it was written for this worksheet and
     this class; a printed border or a ruled line usually was not. */
  function spotScore(spot, obstacles, ink) {
    var area = Math.max(1, spot.w * spot.h), covered = 0;
    (obstacles || []).forEach(function (o) { covered += overlapArea(spot, o); });
    var s = Math.min(1, covered / area) * 2;
    if (typeof ink === 'function') {
      var v = null;
      try { v = ink(spot); } catch (e) { v = null; }
      if (typeof v === 'number' && isFinite(v)) s += Math.max(0, Math.min(1, v));
    }
    return s;
  }

  /* The cleanest spot of a list. Ties within TIE go to the earlier spot in
     SPOT_ORDER, so a blank page always gets the top-right corner. */
  var TIE = 0.004;
  function pickSpot(spots, obstacles, ink) {
    var best = null;
    (spots || []).forEach(function (s) {
      var sc = spotScore(s, obstacles, ink);
      if (!best || sc < best.score - TIE) best = { name: s.name, order: s.order, x: s.x, y: s.y, w: s.w, h: s.h, score: sc };
    });
    return best;
  }

  /* Wide where it fits cleanly; compact when every wide spot covers
     something and a compact one covers clearly less. */
  var CLEAN_ENOUGH = 0.012;
  function choosePlacement(page, obstacles, ink) {
    var ws = boxSize('wide'), cs = boxSize('compact');
    var wide = pickSpot(candidateSpots(page, ws.w, ws.h), obstacles, ink);
    if (wide && wide.score <= CLEAN_ENOUGH) { wide.variant = 'wide'; return wide; }
    var compact = pickSpot(candidateSpots(page, cs.w, cs.h), obstacles, ink);
    if (compact && (!wide || compact.score < wide.score * 0.6)) { compact.variant = 'compact'; return compact; }
    if (wide) { wide.variant = 'wide'; return wide; }
    return null;
  }

  /* Where things go inside the box, in points from its bottom-left. */
  function boxLayout(variant) {
    var size = boxSize(variant);
    if (variant === 'compact') {
      return { w: size.w, h: size.h, qr: { x: BOX.pad, y: BOX.pad + BOX.compact.label, size: BOX.compact.qr },
        label: { x: size.w / 2, y: BOX.pad + 2.5, size: 6.4, centre: true } };
    }
    var tx = BOX.pad + BOX.wide.qr + BOX.wide.gap;
    return { w: size.w, h: size.h, qr: { x: BOX.pad, y: BOX.pad, size: BOX.wide.qr },
      text: { x: tx, w: BOX.wide.text, head: size.h - BOX.pad - 15, sub: size.h - BOX.pad - 27, url: BOX.pad + 11 } };
  }

  /* The link as words: no scheme, cut into lines that fit `maxW`. */
  function linkLines(url, widthOf, size, maxW, maxLines) {
    var s = str(url).replace(/^https?:\/\//i, '');
    var lines = [], cur = '';
    for (var i = 0; i < s.length; i++) {
      var trial = cur + s[i];
      if (cur && widthOf(trial, size) > maxW) {
        lines.push(cur); cur = s[i];
        if (lines.length === maxLines) break;
      } else cur = trial;
    }
    if (lines.length < maxLines && cur) lines.push(cur);
    else if (lines.length === maxLines && i < s.length) {
      var last = lines[maxLines - 1];
      while (last.length > 1 && widthOf(last + '...', size) > maxW) last = last.slice(0, -1);
      lines[maxLines - 1] = last + '...';
    }
    return lines;
  }

  /* A rounded rectangle as an SVG path, for pdf-lib's drawSvgPath (whose y
     axis points down from the `y` it is given). */
  function roundRectPath(w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    return 'M ' + r + ' 0 L ' + (w - r) + ' 0 Q ' + w + ' 0 ' + w + ' ' + r + ' L ' + w + ' ' + (h - r) +
      ' Q ' + w + ' ' + h + ' ' + (w - r) + ' ' + h + ' L ' + r + ' ' + h + ' Q 0 ' + h + ' 0 ' + (h - r) +
      ' L 0 ' + r + ' Q 0 0 ' + r + ' 0 Z';
  }

  /* Draws the box on `page` of the pdf-lib document `pdfDoc`:
       args = { url, count, spot (from choosePlacement), lib (PDFLib),
                font, fontBold, qrMatrix(text) → rows, qrRuns(rows) → runs }
     Vector squares, so it scans from a photocopy; a link annotation over the
     whole box, so it is a tap on a tablet. Returns true when drawn. */
  function drawOnPdf(pdfDoc, page, args) {
    args = args || {};
    var lib = args.lib, spot = args.spot;
    if (!pdfDoc || !page || !lib || !spot || !args.url || typeof args.qrMatrix !== 'function') return false;
    var matrix = args.qrMatrix(args.url);
    if (!matrix || !matrix.length) return false;
    var runs = typeof args.qrRuns === 'function' ? args.qrRuns(matrix) : rowsToRuns(matrix);
    var rgb = lib.rgb;
    var L = boxLayout(spot.variant);
    var x0 = spot.x, y0 = spot.y;
    var ink = rgb(0.10, 0.10, 0.10), muted = rgb(0.36, 0.36, 0.34), soft = rgb(0.55, 0.55, 0.52);

    // The card: white, a hairline edge, softly rounded.
    page.drawSvgPath(roundRectPath(L.w, L.h, 7), {
      x: x0, y: y0 + L.h, color: rgb(1, 1, 1), borderColor: rgb(0.84, 0.83, 0.80), borderWidth: 0.7
    });

    // The code.
    var n = matrix.length, q = L.qr;
    var cell = q.size / (n + BOX.quiet * 2);
    runs.forEach(function (run) {
      page.drawRectangle({
        x: x0 + q.x + (BOX.quiet + run.c) * cell,
        y: y0 + q.y + q.size - (BOX.quiet + run.r + 1) * cell,
        width: run.len * cell + 0.01, height: cell + 0.01, color: rgb(0, 0, 0)
      });
    });

    var font = args.font, bold = args.fontBold || args.font;
    if (font) {
      if (spot.variant === 'compact') {
        var lab = (Math.round(finite(args.count, 0)) === 1 ? 'Video' : 'All ' + Math.round(finite(args.count, 0)) + ' videos');
        var ls = L.label.size;
        var lw = bold.widthOfTextAtSize(lab, ls);
        drawPlay(page, rgb, x0 + (L.w - lw - 8) / 2, y0 + L.label.y, 5.2);
        page.drawText(lab, { x: x0 + (L.w - lw + 8) / 2, y: y0 + L.label.y, size: ls, font: bold, color: ink });
      } else {
        var t = L.text;
        var head = headline(args.count);
        var hs = 9.6;
        while (hs > 7 && bold.widthOfTextAtSize(head, hs) > t.w - 12) hs -= 0.2;
        drawPlay(page, rgb, x0 + t.x, y0 + t.head + 0.4, 7);
        page.drawText(head, { x: x0 + t.x + 11, y: y0 + t.head, size: hs, font: bold, color: ink });
        page.drawText('Scan the code, or tap this box,', { x: x0 + t.x, y: y0 + t.sub, size: 6.4, font: font, color: muted });
        page.drawText('for a player with every video.', { x: x0 + t.x, y: y0 + t.sub - 8.2, size: 6.4, font: font, color: muted });
        var lines = linkLines(args.url, function (s, z) { return font.widthOfTextAtSize(s, z); }, 4.7, t.w, 2);
        lines.forEach(function (line, i) {
          page.drawText(line, { x: x0 + t.x, y: y0 + t.url - i * 6, size: 4.7, font: font, color: soft });
        });
      }
    }

    // The whole box is the link.
    try {
      var ref = pdfDoc.context.register(pdfDoc.context.obj({
        Type: 'Annot', Subtype: 'Link', Rect: [x0, y0, x0 + L.w, y0 + L.h],
        Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: lib.PDFString.of(args.url) }
      }));
      var annots = page.node.lookup(lib.PDFName.of('Annots'));
      if (annots) annots.push(ref);
      else page.node.set(lib.PDFName.of('Annots'), pdfDoc.context.obj([ref]));
    } catch (e) { /* the code still scans without the link */ }
    return true;
  }

  // A small gold disc with a white play triangle, `d` points across.
  function drawPlay(page, rgb, x, y, d) {
    var r = d / 2;
    page.drawEllipse({ x: x + r, y: y + r * 0.72, xScale: r, yScale: r, color: rgb(0.95, 0.72, 0.02) });
    var s = d * 0.36;
    page.drawSvgPath('M 0 0 L 0 ' + (s * 1.6) + ' L ' + (s * 1.35) + ' ' + (s * 0.8) + ' Z', {
      x: x + r - s * 0.48, y: y + r * 0.72 + s * 0.8, color: rgb(1, 1, 1)
    });
  }

  function rowsToRuns(matrix) {
    var out = [];
    (matrix || []).forEach(function (row, r) {
      var c = 0;
      while (c < row.length) {
        if (!row[c]) { c++; continue; }
        var start = c;
        while (c < row.length && row[c]) c++;
        out.push({ r: r, c: start, len: c - start });
      }
    });
    return out;
  }

  /* ---------------------------------------------------------------
     🎬 The player's helpers (videos.html)
     --------------------------------------------------------------- */
  /* What the player puts in its frame for an item:
       { tag: 'video' | 'audio' | 'iframe' | 'link', src, open, ends } —
     `ends` says whether the next video can follow by itself (a YouTube or
     Drive player says nothing when it finishes). Built ONLY from a cleaned
     item; an embed's address is rebuilt from its id. */
  function playerFor(item) {
    var it = cleanItem(item);
    if (!it) return null;
    if (it.kind === 'lesson') return { tag: it.camera ? 'video' : 'audio', src: it.url, open: it.url, ends: true };
    if (it.kind === 'file') return { tag: 'video', src: it.url, open: it.url, ends: true };
    if (it.kind === 'youtube') {
      return { tag: 'iframe', src: 'https://www.youtube-nocookie.com/embed/' + it.id + '?rel=0&playsinline=1&autoplay=1', open: it.open, ends: false };
    }
    if (it.kind === 'drive') return { tag: 'iframe', src: 'https://drive.google.com/file/d/' + it.id + '/preview', open: it.open, ends: false };
    return { tag: 'link', src: '', open: it.url, ends: false };
  }

  /* "Page 3 · lesson with the camera · 4:12" */
  function itemDetail(item) {
    var it = cleanItem(item);
    if (!it) return '';
    var bits = ['Page ' + it.page];
    if (it.kind === 'lesson') bits.push(it.camera ? 'video lesson' : 'voice lesson');
    else if (it.kind === 'youtube') bits.push('YouTube');
    else if (it.kind === 'drive') bits.push('Google Drive');
    else if (it.kind === 'link') bits.push('opens in a new tab');
    else bits.push('video');
    if (it.ms) bits.push(fmtTime(it.ms));
    return bits.join(' · ');
  }

  function fmtTime(ms) {
    var s = Math.max(0, Math.floor(finite(ms, 0) / 1000));
    var m = Math.floor(s / 60);
    if (m < 60) return m + ':' + ('0' + (s % 60)).slice(-2);
    return Math.floor(m / 60) + ':' + ('0' + (m % 60)).slice(-2) + ':' + ('0' + (s % 60)).slice(-2);
  }

  /* A lesson's captions file ({cues:[{s,e,t}]}, milliseconds) as WebVTT,
     for a <track> on the player. Bad cues are dropped, as the app does. */
  function captionsVtt(data, maxCues) {
    var list = data && Array.isArray(data.cues) ? data.cues : [];
    var max = maxCues || 20000, last = -1, out = ['WEBVTT', ''];
    var n = 0;
    for (var i = 0; i < list.length && n < max; i++) {
      var c = list[i];
      if (!c || typeof c.t !== 'string' || typeof c.s !== 'number' || typeof c.e !== 'number') continue;
      if (!isFinite(c.s) || !isFinite(c.e) || c.s < 0 || c.e <= c.s || c.s < last) continue;
      var t = c.t.replace(/[\u0000-\u001f]+/g, ' ').replace(/-->/g, '→').trim().slice(0, 300);
      if (!t) continue;
      out.push(vttTime(c.s) + ' --> ' + vttTime(c.e), t, '');
      last = c.s; n++;
    }
    return n ? out.join('\n') : '';
  }
  function vttTime(ms) {
    ms = Math.max(0, Math.round(ms));
    var h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, r = ms % 1000;
    return ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2) + '.' + ('00' + r).slice(-3);
  }

  /* A lesson replayed with its writing, in Ans Key — the portal's own link
     action (`?ws=<id>&do=play&rec=<id>`, onlineLinkAction). Relative to
     videos.html, which sits beside index.html. */
  function writingLink(pl, item) {
    if (!pl || !WS_RE.test(str(pl.ws)) || !item || item.kind !== 'lesson' || !REC_RE.test(str(item.rec))) return '';
    return './?ws=' + encodeURIComponent(pl.ws) + '&do=play&rec=' + encodeURIComponent(item.rec);
  }

  /* Where to start: `#3` in the address plays the third video. */
  function startIndex(hash, count) {
    var m = /^#?(\d{1,4})$/.exec(str(hash));
    var n = m ? Number(m[1]) : 1;
    return Math.max(0, Math.min(Math.max(0, count - 1), n - 1));
  }

  /* The next item the player moves on to by itself, or -1. */
  function nextIndex(items, i) {
    var n = (items || []).length;
    return i + 1 < n ? i + 1 : -1;
  }

  /* ---------------------------------------------------------------
     📅 By the day of the class (v1.196.0)
     The player shows the videos the way Polymath Online lists them: each
     lesson under the day it was taught, the first lesson first, and inside
     a day in question order. Videos with no date (a YouTube clip, a file,
     a lesson recorded before lessons carried a date) come last. The FILE
     keeps question order — that is what the hash and the paper link are
     over — so the grouping is a view, worked out here and nowhere else.
     Days are the viewer's own calendar days (both the player and the
     portal read the same `at` the same way, so they agree).
     --------------------------------------------------------------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(ms) {
    var n = Number(ms);
    if (!(n >= AT_MIN && n < AT_MAX)) return '';
    var d = new Date(n);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  /* "Wed 12 Nov" — and the year, when it is not this year. */
  function dayLabel(ms, now) {
    var key = dayKey(ms);
    if (!key) return '';
    var d = new Date(Number(ms)), today = new Date(finite(now, Date.now()));
    return WEEKDAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] +
      (d.getFullYear() !== today.getFullYear() ? ' ' + d.getFullYear() : '');
  }
  /* "Wednesday's lesson" */
  function dayHeading(ms) {
    var key = dayKey(ms);
    return key ? WEEKDAYS_LONG[new Date(Number(ms)).getDay()] + '’s lesson' : '';
  }
  /* [{ key, label, heading, at, idx:[item indexes] }]: dated days oldest
     first, then one group of undated videos. With nothing dated at all
     there is one group, labelled for the worksheet as a whole. */
  function lessonDays(items, now) {
    var list = Array.isArray(items) ? items : [];
    var byKey = {}, days = [], rest = [];
    list.forEach(function (it, i) {
      var key = it && it.kind === 'lesson' ? dayKey(it.at) : '';
      if (!key) { rest.push(i); return; }
      if (!byKey[key]) {
        byKey[key] = { key: key, label: dayLabel(it.at, now), heading: dayHeading(it.at), at: Number(it.at), idx: [] };
        days.push(byKey[key]);
      }
      var g = byKey[key];
      if (Number(it.at) < g.at) g.at = Number(it.at);
      g.idx.push(i);
    });
    days.sort(function (p, q) { return p.key < q.key ? -1 : p.key > q.key ? 1 : 0; });
    if (rest.length) {
      days.push({ key: '', label: days.length ? UNDATED_LABEL : 'Videos', heading: days.length ? 'Not from a lesson day' : '', at: 0, idx: rest });
    }
    return days;
  }
  /* The order the player plays in: day by day, as listed. */
  function playOrder(items, now) {
    var out = [];
    lessonDays(items, now).forEach(function (g) { out = out.concat(g.idx); });
    return out;
  }
  /* The item after / before item i in that order, or -1. */
  function orderStep(order, i, step) {
    var o = Array.isArray(order) ? order : [];
    var at = o.indexOf(i);
    if (at < 0) return -1;
    var j = at + step;
    return j >= 0 && j < o.length ? o[j] : -1;
  }
  function orderNext(order, i) { return orderStep(order, i, 1); }
  function orderPrev(order, i) { return orderStep(order, i, -1); }
  /* `#day-2026-11-12` (Polymath Online's link for one lesson day) → the
     first video of that day, or -1 when the day is not on this list. */
  function dayStart(hash, items, now) {
    var m = /^#?day-(\d{4}-\d{2}-\d{2})$/.exec(str(hash));
    if (!m || !DAY_RE.test(m[1])) return -1;
    var g = lessonDays(items, now).filter(function (d) { return d.key === m[1]; })[0];
    return g && g.idx.length ? g.idx[0] : -1;
  }
  /* The worksheet's answer key in Ans Key (beside videos.html), always the
     live one; `print` opens it straight into the print window (the portal
     link action `do=print-answers`). */
  function answerKeyLink(pl, print) {
    if (!pl || !WS_RE.test(str(pl.ws))) return '';
    return './?ws=' + encodeURIComponent(pl.ws) + (print ? '&do=print-answers' : '');
  }

  var api = Object.freeze({
    drawOnPdf: drawOnPdf,
    pure: Object.freeze({
      VERSION: VERSION, PUBLISH_DIR: PUBLISH_DIR, PUBLISH_PREFIX: PUBLISH_PREFIX, VIEWER_PAGE: VIEWER_PAGE,
      BUCKET: BUCKET, ROW: ROW, ITEMS_MAX: ITEMS_MAX, KINDS: KINDS, BOX: BOX, SPOT_ORDER: SPOT_ORDER,
      CLEAN_ENOUGH: CLEAN_ENOUGH,
      classify: classify, cleanUrl: cleanUrl, lessonAssetOk: lessonAssetOk,
      orderKey: orderKey, compareOrder: compareOrder,
      isVideoAnnotation: isVideoAnnotation, itemFromAnnotation: itemFromAnnotation, cleanItem: cleanItem,
      buildPlaylist: buildPlaylist, canonical: canonical, contentHash: contentHash, cleanPlaylist: cleanPlaylist,
      validHash: validHash, validToken: validToken, publishPath: publishPath, publishPayload: publishPayload,
      tokenFromDownloadUrl: tokenFromDownloadUrl, mediaUrl: mediaUrl, packCode: packCode, unpackCode: unpackCode,
      viewerUrl: viewerUrl, parseViewerQuery: parseViewerQuery, readPublished: readPublished, publishedFor: publishedFor,
      stripVideos: stripVideos, countWords: countWords, headline: headline,
      boxSize: boxSize, candidateSpots: candidateSpots, overlapArea: overlapArea, spotScore: spotScore,
      pickSpot: pickSpot, choosePlacement: choosePlacement, boxLayout: boxLayout, linkLines: linkLines,
      roundRectPath: roundRectPath, rowsToRuns: rowsToRuns,
      playerFor: playerFor, itemDetail: itemDetail, fmtTime: fmtTime, captionsVtt: captionsVtt,
      writingLink: writingLink, startIndex: startIndex, nextIndex: nextIndex,
      AT_MIN: AT_MIN, AT_MAX: AT_MAX, UNDATED_LABEL: UNDATED_LABEL,
      dayKey: dayKey, dayLabel: dayLabel, dayHeading: dayHeading, lessonDays: lessonDays, playOrder: playOrder,
      orderNext: orderNext, orderPrev: orderPrev, dayStart: dayStart, answerKeyLink: answerKeyLink
    })
  });
  root.VideoPlaylist = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
