/* 📄 Answer keys on Polymath Online (v1.197.0)
 *
 * After every lesson Ans Key exports the worksheet's answer key, exactly as
 * ⬇ Download would (the teacher's writing, the 🎬 one-link video QR code,
 * the living app codes), and files the PDF on the worksheet's document under
 * the DAY OF THE CLASS:
 *
 *   pdfAnnotator/{id}.answerKeys = { 'YYYY-MM-DD': { url, path, at, pages, videos, fp } }
 *
 * Polymath Online (polymathlc/cer `online/`, `Core.answerKeysOf`) lists them
 * beside the worksheet, newest first, so a student opens the latest key and
 * can still open the key as it stood on any earlier class day. Nothing here
 * opens Ans Key for a student.
 *
 * - The PDF lives at `pdf-annotator/lesson-key-<docId>-<day>.pdf`. The
 *   `lesson-` prefix is the Storage rule that lets only the verified teacher
 *   write it (tools/lesson-storage-rules.mjs); anyone may read it by its
 *   download link, which is what the portal is handed.
 * - One file per class day: a later save on the same day replaces that day's
 *   key (same path), a new class day adds a new one. Old days are never
 *   touched, so a key stays exactly as it was taught.
 * - `fp` is a fingerprint of what went into the PDF. Nothing is exported
 *   again while it is unchanged.
 * - This file is pure: no Firebase, no DOM. index.html holds the glue
 *   (`📄 Answer keys on Polymath Online — glue`).
 */
(function (root) {
  'use strict';

  var PREFIX = 'lesson-key-';
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var DOC_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
  var TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var AT_MIN = Date.UTC(2020, 0, 1);
  var AT_MAX = Date.UTC(2100, 0, 1);
  var MAX_DAYS = 200;              // a worksheet taught on more days than this keeps its newest
  var SAVE_QUIET_MS = 90 * 1000;   // a save on a class day re-exports once the teacher pauses
  var OPEN_WAIT_MS = 6 * 1000;     // an older lesson with no key is filed a moment after opening

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* The calendar day of `ms` on this device — the same reading Polymath
     Online's `lessonDayKey` and videos.html use, so a lesson's videos and
     its answer key land on the same day. */
  function dayKey(ms) {
    var n = Number(ms);
    if (!(n >= AT_MIN && n < AT_MAX)) return '';
    var d = new Date(n);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function validDay(day) {
    if (!DAY_RE.test(String(day || ''))) return false;
    var p = String(day).split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    return d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2] && p[0] >= 2020 && p[0] < 2100;
  }

  function validDocId(id) { return DOC_ID_RE.test(String(id || '')); }

  /* Where the day's PDF goes. '' for anything that is not a real worksheet
     id and a real day — never a path built from loose text. */
  function storagePath(dir, docId, day) {
    if (!validDocId(docId) || !validDay(day)) return '';
    return String(dir || 'pdf-annotator') + '/' + PREFIX + docId + '-' + day + '.pdf';
  }

  /* A download link is accepted only when it is Firebase Storage's own, for
     a key file, with a token. The portal checks the same rule. */
  function validUrl(url) {
    var s = String(url || '');
    var m = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[A-Za-z0-9._-]+\/o\/([^?#]+)\?(.*)$/.exec(s);
    if (!m) return false;
    var name;
    try { name = decodeURIComponent(m[1]); } catch (e) { return false; }
    if (!/^pdf-annotator\/lesson-key-[A-Za-z0-9_-]{1,80}-\d{4}-\d{2}-\d{2}\.pdf$/.test(name)) return false;
    var q = m[2].split('&');
    var media = q.indexOf('alt=media') >= 0;
    var token = q.some(function (kv) { return kv.indexOf('token=') === 0 && TOKEN_RE.test(kv.slice(6)); });
    return media && token;
  }

  function num(v, lo, hi) {
    var n = Math.floor(Number(v));
    if (!isFinite(n)) return 0;
    return Math.max(lo, Math.min(hi, n));
  }

  function toMillis(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    return 0;
  }

  /* One day's entry, checked. null when it is not a real key. */
  function cleanEntry(day, e) {
    if (!validDay(day) || !e || typeof e !== 'object' || !validUrl(e.url)) return null;
    var at = toMillis(e.at);
    return {
      day: day,
      url: String(e.url),
      path: typeof e.path === 'string' ? e.path : '',
      at: at >= AT_MIN && at < AT_MAX ? at : 0,
      pages: num(e.pages, 0, 2000),
      videos: num(e.videos, 0, 5000),
      fp: typeof e.fp === 'string' ? e.fp.slice(0, 40) : ''
    };
  }

  /* The document's map → a list, NEWEST class day first. */
  function entriesOf(map) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
    var out = [];
    Object.keys(map).forEach(function (day) {
      var e = cleanEntry(day, map[day]);
      if (e) out.push(e);
    });
    out.sort(function (a, b) { return a.day < b.day ? 1 : a.day > b.day ? -1 : 0; });
    return out.slice(0, MAX_DAYS);
  }

  function entryFor(list, day) {
    for (var i = 0; i < (list || []).length; i++) if (list[i].day === day) return list[i];
    return null;
  }

  /* The lessons recorded on the sheet: [{ id, at }] newest first. */
  function lessonsOf(anns) {
    return (Array.isArray(anns) ? anns : []).filter(function (a) {
      return a && a.type === 'video' && a.lessonRecording && typeof a.lessonRecording === 'object';
    }).map(function (a) {
      var at = Number(a.ts) || Number(a.lessonRecording.at) || 0;
      return { id: String(a.id || ''), at: at >= AT_MIN && at < AT_MAX ? at : 0 };
    }).sort(function (p, q) { return q.at - p.at; });
  }

  function lastLessonDay(anns) {
    var l = lessonsOf(anns).filter(function (x) { return x.at; });
    return l.length ? dayKey(l[0].at) : '';
  }

  /* FNV-1a over what goes into the PDF: the annotations as saved, the video
     link printed on page 1, the share QR and the PDF's own stamp. */
  function fingerprint(parts) {
    var s = (Array.isArray(parts) ? parts : [parts]).map(function (p) { return String(p == null ? '' : p); }).join('\u0001');
    var h1 = 0x811c9dc5, h2 = 0x01000193 ^ s.length;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 ^= c; h2 = Math.imul(h2, 0x5bd1e995) >>> 0; h2 ^= h2 >>> 15;
    }
    return ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + (h2 >>> 0).toString(16)).slice(-8);
  }

  /* Which day (if any) a trigger files the key under.
       'lesson' — a lesson has just been saved: today.
       'save'   — an ordinary save: today, but only on a day that already
                  has a lesson or a key (corrections after class).
       'open'   — a sheet opened with lessons and no key yet: the day of its
                  newest lesson (so older worksheets fill in by themselves).
       'manual' — the teacher asked: today.
     '' when nothing should be filed. */
  function dayFor(trigger, ctx) {
    ctx = ctx || {};
    var today = dayKey(ctx.now || Date.now());
    var entries = Array.isArray(ctx.entries) ? ctx.entries : [];
    var lessonDay = ctx.lessonDay || '';
    if (trigger === 'lesson' || trigger === 'manual') return today;
    if (trigger === 'save') return (lessonDay === today || entryFor(entries, today)) ? today : '';
    if (trigger === 'open') return !entries.length && lessonDay ? lessonDay : '';
    return '';
  }

  /* The whole decision, pure: { day, why } — day '' means do nothing, and
     `why` says why (for the console and the tests). */
  function plan(trigger, ctx) {
    ctx = ctx || {};
    if (!ctx.teacher) return { day: '', why: 'not-teacher' };
    if (ctx.practice) return { day: '', why: 'practice' };
    if (!validDocId(ctx.docId)) return { day: '', why: 'unsaved' };
    if (!ctx.hasPdf) return { day: '', why: 'no-pdf' };
    if (ctx.online === false && trigger !== 'manual' && trigger !== 'lesson') return { day: '', why: 'not-online' };
    var day = dayFor(trigger, ctx);
    if (!day) return { day: '', why: 'no-class-day' };
    var have = entryFor(ctx.entries, day);
    if (have && ctx.fp && have.fp === ctx.fp && trigger !== 'manual') return { day: '', why: 'unchanged' };
    return { day: day, why: 'publish' };
  }

  /* What is written onto the document for the day. */
  function docEntry(o) {
    return {
      url: String(o.url || ''),
      path: String(o.path || ''),
      at: Number(o.at) || Date.now(),
      pages: num(o.pages, 0, 2000),
      videos: num(o.videos, 0, 5000),
      fp: String(o.fp || '').slice(0, 40)
    };
  }

  function dayLabel(day) {
    if (!validDay(day)) return '';
    var p = day.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()];
  }

  var api = {
    pure: {
      PREFIX: PREFIX, MAX_DAYS: MAX_DAYS, SAVE_QUIET_MS: SAVE_QUIET_MS, OPEN_WAIT_MS: OPEN_WAIT_MS,
      dayKey: dayKey, validDay: validDay, validDocId: validDocId, storagePath: storagePath,
      validUrl: validUrl, cleanEntry: cleanEntry, entriesOf: entriesOf, entryFor: entryFor,
      lessonsOf: lessonsOf, lastLessonDay: lastLessonDay, fingerprint: fingerprint,
      dayFor: dayFor, plan: plan, docEntry: docEntry, dayLabel: dayLabel
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AnswerKeyOnline = api;
})(typeof window !== 'undefined' ? window : globalThis);
