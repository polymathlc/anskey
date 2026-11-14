/* 🖱 Right-click actions on worksheets (v1.199.0)
 *
 * Right-click a worksheet in the worksheet list or in ☁ My PDFs (on a
 * tablet: press and hold it) and the teacher gets a menu:
 *
 *   📂 Open
 *   ⬆ Upload answer key + videos to Polymath Online
 *   📄 Upload answer key only
 *   🎬 Upload videos only
 *      — each does NOW what happens by itself after a lesson (the answer
 *        key PDF filed under today's class, answer-key-online.js; the video
 *        page filed on the worksheet, video-playlist.js). For when the
 *        automatic run did not happen or did not finish.
 *   📎 Upload an answer key PDF from this device…
 *      — the last resort: any PDF, put on Polymath Online as the answer key
 *        of the worksheet the teacher picks, under the class day they pick.
 *        A PDF put up by hand is never replaced by an automatic run.
 *   🔗 Match answer key with a worksheet…
 *      — the teacher picks which worksheet gets which answer key: this
 *        worksheet's writing, answer key PDFs and/or lesson videos go to
 *        the chosen one (or come from it), exactly as Polymath Online's
 *        "From Ans Key" does it (the same merge rules, byte for byte).
 *   📋 Answer key PDFs on Polymath Online…
 *      — every class day's key, to open or remove (always asked first).
 *   🗑 Delete worksheet…
 *      — always asked first, saying what goes with it (its class place,
 *        its answer keys, its videos).
 *
 * Teacher only. This file is the rules (pure, tested in
 * tools/file-actions-tests.mjs) and the menu and windows (DOM, built with textContent only,
 * no HTML strings). index.html holds the glue that talks to Firebase
 * (`🖱 Right-click actions — glue`).
 */
(function (root) {
  'use strict';

  var LONG_PRESS_MS = 520;          // a held finger opens the menu after this
  var LONG_PRESS_SLOP = 10;         // …unless it moved more than this (a scroll)
  var MAX_PDF_BYTES = 60 * 1024 * 1024;
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var DOC_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
  var TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var LEVEL_ORDER = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'S1', 'S2', 'S3', 'S4'];
  var WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  /* ================= The rules (pure) ================= */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function dayKey(ms) {
    var n = Number(ms);
    if (!(n >= Date.UTC(2020, 0, 1) && n < Date.UTC(2100, 0, 1))) return '';
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

  function dayLabel(day) {
    if (!validDay(day)) return '';
    var p = day.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  function toMillis(v) {
    if (!v) return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch (e) { return 0; } }
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    return 0;
  }

  function parseAnnotations(json) {
    if (Array.isArray(json)) return json;
    if (typeof json !== 'string' || !json) return [];
    try { var list = JSON.parse(json); return Array.isArray(list) ? list : []; } catch (e) { return []; }
  }

  function isRecording(a) { return !!(a && a.lessonRecording); }
  function isVideoLesson(a) { return isRecording(a) && a.type === 'video' && !!a.url; }

  /* How much writing and how many recorded lessons a list of annotations holds. */
  function annotationCounts(json) {
    var answers = 0, videos = 0;
    parseAnnotations(json).forEach(function (a) {
      if (!a) return;
      if (isRecording(a)) { if (isVideoLesson(a)) videos++; }
      else answers++;
    });
    return { answers: answers, videos: videos };
  }

  /* An answer key link is used only when it is Firebase Storage's own, for a
     key file, with a token — the same rule as answer-key-online.js and the
     portal's answerKeyUrlOk. */
  function validKeyUrl(url) {
    var m = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[A-Za-z0-9._-]+\/o\/([^?#]+)\?(.*)$/.exec(String(url || ''));
    if (!m) return false;
    var name;
    try { name = decodeURIComponent(m[1]); } catch (e) { return false; }
    if (!/^pdf-annotator\/lesson-key-[A-Za-z0-9_-]{1,80}-\d{4}-\d{2}-\d{2}\.pdf$/.test(name)) return false;
    var q = m[2].split('&');
    return q.indexOf('alt=media') >= 0 && q.some(function (kv) { return kv.indexOf('token=') === 0 && TOKEN_RE.test(kv.slice(6)); });
  }

  /* The worksheet's filed answer keys, NEWEST class day first, with whether
     each was put up by hand. */
  function keyEntries(map) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
    var out = [];
    Object.keys(map).forEach(function (day) {
      var e = map[day];
      if (!validDay(day) || !e || typeof e !== 'object' || !validKeyUrl(e.url)) return;
      out.push({
        day: day,
        label: dayLabel(day),
        url: String(e.url),
        path: typeof e.path === 'string' ? e.path : '',
        at: toMillis(e.at),
        pages: Math.max(0, Math.floor(Number(e.pages) || 0)),
        videos: Math.max(0, Math.floor(Number(e.videos) || 0)),
        manual: e.manual === true,
        file: typeof e.file === 'string' ? e.file.slice(0, 120) : ''
      });
    });
    return out.sort(function (a, b) { return a.day < b.day ? 1 : a.day > b.day ? -1 : 0; });
  }

  /* The days whose key was put up by hand: no automatic run replaces them. */
  function manualDays(map) {
    var out = {};
    keyEntries(map).forEach(function (e) { if (e.manual) out[e.day] = true; });
    return out;
  }

  /* What a worksheet carries, read from its document alone. Annotations kept
     in Storage (`annotationsPath`) are too big to read for a menu, so they
     count as written on, and their videos are known from the video page. */
  function docInfo(d) {
    d = d || {};
    var answers = 0, videos = 0;
    if (d.annotationsPath) {
      answers = 1;
      var vp = d.videoPlaylist;
      videos = vp && typeof vp === 'object' ? Math.max(0, Math.floor(Number(vp.n) || 0)) : 0;
    } else {
      var c = annotationCounts(d.annotations);
      answers = c.answers; videos = c.videos;
    }
    var keys = keyEntries(d.answerKeys);
    return {
      name: String(d.name || 'Untitled'),
      answers: answers > 0,
      big: !!d.annotationsPath,
      videos: videos,
      keys: keys.length,
      manualKeys: keys.filter(function (k) { return k.manual; }).length,
      newestKey: keys.length ? keys[0].day : '',
      inClass: d.onlineCourseId ? String(d.onlineCourseId) : '',
      pages: Math.max(0, Math.floor(Number(d.pageCount) || 0)),
      hidden: !!d.hidden,
      hasPdf: !!d.storagePath,
      level: String(d.level || ''),
      subject: String(d.subject || ''),
      wsDate: String(d.wsDate || ''),
      wsDay: String(d.wsDay || '')
    };
  }

  /* A worksheet's annotations with another one's answer key and/or videos —
     the SAME rule as Polymath Online's Core.mergeAnnotations:
       answers: the source's writing REPLACES the target's (one answer key).
       videos:  the source's recorded lessons are ADDED beside the target's
                own, once each (a lesson already there is not doubled).
     The target keeps whatever was not asked for. */
  function mergeAnnotations(targetJson, sourceJson, bring) {
    var b = bring || {};
    var target = parseAnnotations(targetJson), source = parseAnnotations(sourceJson);
    var keepAnswers = target.filter(function (a) { return a && !isRecording(a); });
    var keepVideos = target.filter(isRecording);
    var srcAnswers = source.filter(function (a) { return a && !isRecording(a); });
    var srcVideos = source.filter(isVideoLesson);
    var have = {};
    keepVideos.forEach(function (a) { if (a.id) have[a.id] = true; if (a.url) have['url:' + a.url] = true; });
    var addVideos = b.videos ? srcVideos.filter(function (a) { return !(a.id && have[a.id]) && !have['url:' + a.url]; }) : [];
    var answers = b.answers ? srcAnswers : keepAnswers;
    return {
      json: JSON.stringify(answers.concat(keepVideos, addVideos)),
      answers: b.answers ? srcAnswers.length : 0,
      videos: addVideos.length,
      replacedAnswers: b.answers ? keepAnswers.length : 0
    };
  }

  /* The answer key PDFs filed per class day: the target's own days win, the
     source's fill the days the target has none for (the portal's
     Core.mergeAnswerKeyMaps). Only real, checked entries are carried. */
  function mergeAnswerKeyMaps(target, source) {
    var out = {};
    var add = function (doc) {
      var map = doc && doc.answerKeys;
      if (!map || typeof map !== 'object' || Array.isArray(map)) return;
      Object.keys(map).forEach(function (key) {
        var e = map[key];
        if (out[key] || !validDay(key) || !e || typeof e !== 'object' || !validKeyUrl(e.url)) return;
        out[key] = e;
      });
    };
    add(target);
    add(source);
    return out;
  }

  /* ---- Class lists ---- */
  function courseIds(course) { return course && Array.isArray(course.worksheetIds) ? course.worksheetIds.filter(function (x) { return typeof x === 'string' && x; }) : []; }
  function intOr(v, dflt) { var n = Number(v); return typeof v === 'number' && isFinite(n) ? Math.floor(n) : dflt; }

  function slotText(slot, day) {
    if (slot !== 0 && slot !== 1 && slot !== 2) return '';
    if (day === 'Saturday') return ['9 am', '11 am', '1 pm'][slot] || '';
    return ['3 pm', '5 pm', '7 pm'][slot] || '';
  }

  function courseTitle(c) {
    if (!c) return 'Class';
    if (c.title) return String(c.title).slice(0, 80);
    var bits = [c.level, c.subject === 'science' ? 'Science' : c.subject === 'math' ? 'Maths' : c.subject, c.day, slotText(c.slot, c.day)].filter(Boolean);
    return bits.length ? bits.join(' ') : 'Class';
  }

  function compareCourses(a, b) {
    var la = LEVEL_ORDER.indexOf(a.level), lb = LEVEL_ORDER.indexOf(b.level);
    if (la !== lb) return (la < 0 ? 99 : la) - (lb < 0 ? 99 : lb);
    var da = WEEK.indexOf(a.day), db = WEEK.indexOf(b.day);
    if (da !== db) return (da < 0 ? 99 : da) - (db < 0 ? 99 : db);
    var sa = intOr(a.slot, 9), sb = intOr(b.slot, 9);
    if (sa !== sb) return sa - sb;
    return courseTitle(a) < courseTitle(b) ? -1 : courseTitle(a) > courseTitle(b) ? 1 : 0;
  }

  // Where the class is: worksheet 1 before it starts.
  function classAt(course) {
    var ids = courseIds(course);
    if (!ids.length) return -1;
    var cur = intOr(course.currentIndex, -1);
    if (cur < 0) return 0;
    return Math.min(cur, ids.length - 1);
  }

  function queueState(course, seq) {
    var ids = courseIds(course);
    if (!(seq >= 0 && seq < ids.length)) return '';
    var at = classAt(course);
    if (seq === at) return 'current';
    if (seq === at + 1) return 'next';
    if (seq < at) return 'done';
    return 'queued';
  }

  function stateWords(state) {
    return state === 'current' ? 'Current worksheet' : state === 'next' ? 'Next worksheet'
      : state === 'done' ? 'Taught' : state === 'queued' ? 'Queued' : '';
  }

  /* Every class list a worksheet sits in (normally one), read from the class
     lists themselves so a stale `onlineCourseId` cannot mislead. */
  function classPlaces(courses, id) {
    var out = [];
    Object.keys(courses || {}).forEach(function (cid) {
      var c = courses[cid];
      var ids = courseIds(c);
      var seq = ids.indexOf(id);
      if (seq < 0) return;
      out.push({ courseId: cid, title: courseTitle(c), seq: seq, total: ids.length, state: queueState(c, seq) });
    });
    return out.sort(function (a, b) { return compareCourses(courses[a.courseId], courses[b.courseId]); });
  }

  function placeText(p) {
    if (!p) return '';
    var w = stateWords(p.state);
    return p.title + ' · worksheet ' + (p.seq + 1) + ' of ' + p.total + (w ? ' · ' + w : '');
  }

  /* A worksheet taken out of its class list (because it is being deleted).
     The class stays on the worksheet it was on; deleting the CURRENT one puts
     the class on the one that followed it (never back to "not started"), and
     the released count shrinks with the list. null when it is not in it. */
  function removeFromCourse(course, id) {
    var ids = courseIds(course);
    var at = ids.indexOf(id);
    if (at < 0) return null;
    var next = ids.slice(0, at).concat(ids.slice(at + 1));
    var cur = intOr(course.currentIndex, -1);
    var rel = intOr(course.releasedThrough, -1);
    var newCur = cur;
    if (cur >= 0) {
      if (at < cur) newCur = cur - 1;
      else if (at === cur) newCur = Math.min(cur, next.length - 1);
    }
    if (!next.length) newCur = -1;
    var newRel = rel;
    if (rel >= 0 && at <= rel) newRel = rel - 1;
    newRel = Math.min(newRel, next.length - 1);
    if (newCur > newRel) newRel = newCur;
    return {
      worksheetIds: next,
      removedAt: at,
      currentIndex: newCur,
      currentDocId: newCur >= 0 ? next[newCur] : null,
      releasedThrough: newRel
    };
  }

  /* ---- The worksheet picker ---- */
  function queryWords(query) { return String(query || '').toLowerCase().split(/\s+/).filter(Boolean); }
  function matchesQuery(hay, query) {
    var words = queryWords(query);
    if (!words.length) return true;
    var h = String(hay || '').toLowerCase();
    return words.every(function (w) { return h.indexOf(w) >= 0; });
  }

  /* The worksheets to choose from, grouped: one group per class list, in
     teaching order, then (with `all`) every other worksheet in Ans Key,
     newest first. `exclude` leaves one out (the worksheet itself). A class
     whose title matches the search keeps all its worksheets. */
  function pickerGroups(courses, library, opts) {
    var o = opts || {};
    var byId = {};
    (Array.isArray(library) ? library : []).forEach(function (item) { if (item && item.id) byId[item.id] = item.data || {}; });
    var groups = [];
    var inAClass = {};
    Object.keys(courses || {}).map(function (cid) { return Object.assign({ id: cid }, courses[cid]); })
      .sort(compareCourses)
      .forEach(function (c) {
        var title = courseTitle(c);
        var titleHit = queryWords(o.query).length && matchesQuery(title, o.query);
        var items = [];
        courseIds(c).forEach(function (wid, seq) {
          inAClass[wid] = true;
          if (wid === o.exclude) return;
          var d = byId[wid];
          var name = d ? String(d.name || 'Untitled') : 'Worksheet ' + (seq + 1);
          if (!titleHit && !matchesQuery([name, d && d.wsDate, d && d.wsDay].filter(Boolean).join(' '), o.query)) return;
          items.push({ id: wid, name: name, seq: seq, state: queueState(c, seq), info: d ? docInfo(d) : null, missing: !d });
        });
        if (items.length) groups.push({ key: 'class:' + c.id, title: title, sub: courseIds(c).length + ' worksheets · on worksheet ' + (classAt(c) + 1), items: items });
      });
    if (o.all) {
      var rest = Object.keys(byId).filter(function (wid) {
        if (inAClass[wid] || wid === o.exclude) return false;
        var d = byId[wid];
        return !!d.storagePath && matchesQuery([d.name, d.wsDate, d.wsDay, d.level].filter(Boolean).join(' '), o.query);
      }).map(function (wid) {
        var d = byId[wid];
        return { id: wid, name: String(d.name || 'Untitled'), seq: -1, state: '', info: docInfo(d), when: d.wsDate && DAY_RE.test(d.wsDate) ? d.wsDate : '' };
      }).sort(function (a, b) {
        if (a.when !== b.when) return a.when < b.when ? 1 : -1;
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });
      if (rest.length) groups.push({ key: 'other', title: 'Not in a class list', sub: rest.length + ' worksheets in Ans Key', items: rest });
    }
    return groups;
  }

  function itemMeta(item) {
    var bits = [];
    if (item.seq >= 0) bits.push('#' + (item.seq + 1));
    if (item.state) bits.push(stateWords(item.state));
    var i = item.info;
    if (i) {
      if (i.level) bits.push(i.level);
      if (i.wsDate) bits.push(i.wsDate);
      if (i.answers) bits.push('✍ written on');
      if (i.keys) bits.push('📄 ' + i.keys + ' key PDF' + (i.keys === 1 ? '' : 's'));
      if (i.videos) bits.push('🎬 ' + i.videos);
    } else if (item.missing) bits.push('not loaded');
    return bits.join(' · ');
  }

  /* ---- Uploading a PDF by hand ---- */
  function checkUpload(file, day) {
    if (!file) return 'Choose the answer key PDF first.';
    var name = String(file.name || '');
    var type = String(file.type || '');
    if (!(type === 'application/pdf' || /\.pdf$/i.test(name))) return 'That is not a PDF. Choose the answer key as a .pdf file.';
    var size = Number(file.size) || 0;
    if (size <= 0) return 'That file is empty.';
    if (size > MAX_PDF_BYTES) return 'That PDF is ' + Math.round(size / 1048576) + ' MB — the limit is ' + Math.round(MAX_PDF_BYTES / 1048576) + ' MB.';
    if (!validDay(day)) return 'Choose the class day this answer key is for.';
    return '';
  }

  /* What goes on the worksheet document for a PDF put up by hand. */
  function manualEntry(o) {
    return {
      url: String(o.url || ''),
      path: String(o.path || ''),
      at: Number(o.at) || Date.now(),
      pages: Math.max(0, Math.min(2000, Math.floor(Number(o.pages) || 0))),
      videos: 0,
      fp: 'manual',
      manual: true,
      file: String(o.file || '').slice(0, 120)
    };
  }

  /* ---- The menu ---- */
  function menuModel(ctx) {
    var c = ctx || {};
    if (!c.teacher) return [];
    var info = c.info || docInfo({});
    var blocked = c.busy && !c.isOpen ? 'Stop the lesson recording first' : '';
    var noPdf = info.hasPdf ? '' : 'This worksheet has no PDF';
    var why = blocked || noPdf;
    var items = [
      { id: 'open', icon: '📂', label: c.isOpen ? 'Open (it is open now)' : 'Open', disabled: !!blocked || !!noPdf || !!c.isOpen, hint: c.isOpen ? '' : blocked },
      { sep: true },
      { id: 'upload-all', icon: '⬆', label: 'Upload answer key + videos to Polymath Online', hint: why || 'Does now what happens by itself after a lesson', disabled: !!why },
      { id: 'upload-key', icon: '📄', label: 'Upload answer key only', hint: why || 'Today\'s answer key PDF, with the video QR code', disabled: !!why },
      { id: 'upload-videos', icon: '🎬', label: 'Upload videos only', hint: why || (info.videos ? info.videos + ' video' + (info.videos === 1 ? '' : 's') + ' · refreshes the video page' : 'No lesson videos are recorded on it'), disabled: !!why || !info.videos },
      { sep: true },
      { id: 'upload-pdf', icon: '📎', label: 'Upload an answer key PDF from this device…', hint: 'Choose the worksheet and the class day yourself' },
      { id: 'match', icon: '🔗', label: 'Match answer key with a worksheet…', hint: 'Choose which worksheet gets this answer key and videos' },
      { id: 'keys', icon: '📋', label: 'Answer key PDFs on Polymath Online' + (info.keys ? ' (' + info.keys + ')' : '') + '…', hint: info.keys ? 'Open or remove each class day\'s key' : 'None filed yet' },
      { sep: true },
      { id: 'delete', icon: '🗑', label: 'Delete worksheet…', danger: true, hint: 'You are always asked first', disabled: !!(c.busy && c.isOpen) }
    ];
    if (c.busy && c.isOpen) items[items.length - 1].hint = 'Stop the lesson recording first';
    return items;
  }

  /* The words of the delete confirmation: what goes, and what stays. */
  function deleteSummary(info, places) {
    var i = info || docInfo({});
    var lines = [];
    (places || []).forEach(function (p) {
      lines.push('It is worksheet ' + (p.seq + 1) + ' of ' + p.total + ' in ' + p.title +
        (p.state === 'current' ? ' — the class is ON it now; the class moves to the next worksheet.' : '. It comes out of that class list.'));
    });
    if (i.answers) lines.push('Its answer key (everything written on it) is deleted with it.');
    if (i.keys) lines.push(i.keys + ' answer key PDF' + (i.keys === 1 ? '' : 's') + ' on Polymath Online disappear' + (i.keys === 1 ? 's' : '') + ' with it.');
    if (i.videos) lines.push(i.videos + ' lesson video' + (i.videos === 1 ? '' : 's') + ' will no longer be listed (the video files stay, in case another worksheet uses them).');
    lines.push('This cannot be undone.');
    return { title: 'Delete “' + i.name + '”?', lines: lines, confirm: 'Delete worksheet' };
  }

  function bringText(bring, counts) {
    var b = bring || {}, c = counts || {}, bits = [];
    if (b.answers) bits.push(c.answers != null ? (c.answers ? 'its answer key (' + c.answers + ' item' + (c.answers === 1 ? '' : 's') + ')' : 'its (empty) answer key') : 'the answer key');
    if (b.videos) bits.push(c.videos != null ? (c.videos ? c.videos + ' video' + (c.videos === 1 ? '' : 's') : 'no new videos') : 'the videos');
    return bits.join(' and ');
  }

  var pure = {
    LONG_PRESS_MS: LONG_PRESS_MS, LONG_PRESS_SLOP: LONG_PRESS_SLOP, MAX_PDF_BYTES: MAX_PDF_BYTES,
    dayKey: dayKey, validDay: validDay, validDocId: validDocId, dayLabel: dayLabel, toMillis: toMillis,
    parseAnnotations: parseAnnotations, annotationCounts: annotationCounts, validKeyUrl: validKeyUrl,
    keyEntries: keyEntries, manualDays: manualDays, docInfo: docInfo,
    mergeAnnotations: mergeAnnotations, mergeAnswerKeyMaps: mergeAnswerKeyMaps,
    courseIds: courseIds, courseTitle: courseTitle, classAt: classAt, queueState: queueState, stateWords: stateWords,
    classPlaces: classPlaces, placeText: placeText, removeFromCourse: removeFromCourse,
    matchesQuery: matchesQuery, pickerGroups: pickerGroups, itemMeta: itemMeta,
    checkUpload: checkUpload, manualEntry: manualEntry, menuModel: menuModel, deleteSummary: deleteSummary, bringText: bringText
  };

  /* ================= The menu and the windows (DOM) =================
     env = {
       teacher() → bool, toast(msg, ms),
       currentId() → id of the open worksheet, busy() → recording?,
       courses() → { id: course }, library() → Promise<[{id, data}]>,
       fresh(id) → Promise<data|null>,
       open(item), upload(item, { answers, videos }, say) → Promise<string>,
       uploadPdf(targetId, file, day, say) → Promise<string>,
       match(sourceId, targetId, bring, opts, say) → Promise<string>,
       removeKey(id, day) → Promise, remove(item, say) → Promise<string>,
       openUrl(url)
     } */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function button(text, cls, title) {
    var b = el('button', 'btn ' + (cls || ''), text);
    b.type = 'button';
    if (title) b.title = title;
    return b;
  }

  function create(env) {
    var menu = null, menuItem = null, menuKeyHandler = null;
    var back = null, card = null, win = null;   // the one window at a time
    var confirmResolve = null;

    function teacher() { return !!(env && env.teacher && env.teacher()); }
    function toast(m, ms) { if (env && env.toast) env.toast(m, ms); }
    function errText(e) { return String((e && e.message) || e || 'Something went wrong.'); }

    /* ---- the menu ---- */
    function closeMenu() {
      if (!menu) return;
      if (menu.parentNode) menu.parentNode.removeChild(menu);
      document.removeEventListener('pointerdown', outsideMenu, true);
      document.removeEventListener('keydown', menuKeyHandler, true);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('blur', closeMenu);
      document.removeEventListener('scroll', closeMenu, true);
      menu = null; menuItem = null;
    }
    function outsideMenu(e) { if (menu && !menu.contains(e.target)) closeMenu(); }

    function showMenu(item, x, y) {
      closeMenu();
      if (!teacher() || !item || !item.id) return null;
      var data = item.data || {};
      var info = docInfo(data);
      var courses = env.courses ? env.courses() || {} : {};
      var places = classPlaces(courses, item.id);
      var model = menuModel({ teacher: true, info: info, isOpen: env.currentId && env.currentId() === item.id, busy: env.busy && env.busy() });
      menuItem = item;
      menu = el('div', 'faMenu');
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', 'Actions for ' + info.name);
      var head = el('div', 'faMenuHead');
      head.appendChild(el('div', 'faMenuName', info.name));
      var sub = [];
      if (places.length) sub.push(placeText(places[0]) + (places.length > 1 ? ' (+' + (places.length - 1) + ' more)' : ''));
      else sub.push('Not in a Polymath Online class list');
      var have = [];
      if (info.answers) have.push('✍ answer key');
      if (info.keys) have.push('📄 ' + info.keys + ' PDF' + (info.keys === 1 ? '' : 's') + ' online');
      if (info.videos) have.push('🎬 ' + info.videos + ' video' + (info.videos === 1 ? '' : 's'));
      if (have.length) sub.push(have.join(' · '));
      head.appendChild(el('div', 'faMenuSub', sub.join('\n')));
      if (!places.length) head.appendChild(el('div', 'faMenuNote', 'Students only see answer keys of worksheets in a class list. Use 🔗 Match to give its answer key to a class worksheet.'));
      menu.appendChild(head);
      model.forEach(function (m) {
        if (m.sep) { menu.appendChild(el('div', 'faMenuSep')); return; }
        var b = el('button', 'faMenuItem' + (m.danger ? ' faDanger' : ''));
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.setAttribute('data-fa', m.id);
        b.disabled = !!m.disabled;
        b.appendChild(el('span', 'faMenuIcon', m.icon || ''));
        var txt = el('span', 'faMenuText');
        txt.appendChild(el('span', 'faMenuLabel', m.label));
        if (m.hint) txt.appendChild(el('span', 'faMenuHint', m.hint));
        b.appendChild(txt);
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          var it = menuItem;
          closeMenu();
          run(m.id, it);
        });
        menu.appendChild(b);
      });
      menu.style.left = '0px';
      menu.style.top = '0px';
      menu.style.visibility = 'hidden';
      document.body.appendChild(menu);
      // Kept on screen: flipped left or up when it would run off the edge.
      var vw = window.innerWidth || document.documentElement.clientWidth || 800;
      var vh = window.innerHeight || document.documentElement.clientHeight || 600;
      // Layout sizes, not getBoundingClientRect: the opening animation scales it.
      var r = { width: menu.offsetWidth, height: menu.offsetHeight };
      var left = x + r.width + 8 > vw ? Math.max(8, x - r.width) : x;
      var top = y + r.height + 8 > vh ? Math.max(8, vh - r.height - 8) : y;
      menu.style.left = Math.round(Math.max(8, Math.min(left, vw - r.width - 8))) + 'px';
      menu.style.top = Math.round(Math.max(8, top)) + 'px';
      menu.style.visibility = '';
      setTimeout(function () {
        if (!menu) return;
        document.addEventListener('pointerdown', outsideMenu, true);
        window.addEventListener('resize', closeMenu);
        window.addEventListener('blur', closeMenu);
        document.addEventListener('scroll', closeMenu, true);
      }, 0);
      menuKeyHandler = function (e) {
        if (!menu) return;
        var items = Array.prototype.slice.call(menu.querySelectorAll('.faMenuItem:not([disabled])'));
        var at = items.indexOf(document.activeElement);
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation();
          if (!items.length) return;
          var next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at <= 0 ? items.length - 1 : at - 1);
          items[next].focus();
          return;
        }
        // Tool shortcuts must not fire while the menu is up.
        if (e.key.length === 1) e.stopPropagation();
      };
      document.addEventListener('keydown', menuKeyHandler, true);
      var first = menu.querySelector('.faMenuItem:not([disabled])');
      if (first) { try { first.focus({ preventScroll: true }); } catch (err) {} }
      return menu;
    }

    /* ---- attaching to a worksheet card or row ----
       Right-click with a mouse; press and hold with a finger or a pencil.
       `getItem` is asked at the moment of the press, so the menu always
       shows the card's current data. Returns a function that says whether
       a long press just happened (the click that follows is swallowed). */
    function attach(target, getItem) {
      if (!target || target.__faAttached) return;
      target.__faAttached = true;
      var timer = 0, sx = 0, sy = 0, firedAt = 0, pid = null;
      function cancel() { clearTimeout(timer); timer = 0; pid = null; }
      target.addEventListener('contextmenu', function (e) {
        if (!teacher()) return;          // everyone else keeps the browser's own menu
        e.preventDefault();
        e.stopPropagation();
        if (Date.now() - firedAt < 800) return;   // the long press already opened it
        showMenu(getItem(), e.clientX, e.clientY);
      });
      target.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' || !teacher()) return;
        cancel();
        sx = e.clientX; sy = e.clientY; pid = e.pointerId;
        timer = setTimeout(function () {
          timer = 0;
          firedAt = Date.now();
          if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) {} }
          showMenu(getItem(), sx, sy);
        }, LONG_PRESS_MS);
      });
      target.addEventListener('pointermove', function (e) {
        if (!timer || e.pointerId !== pid) return;
        if (Math.abs(e.clientX - sx) > LONG_PRESS_SLOP || Math.abs(e.clientY - sy) > LONG_PRESS_SLOP) cancel();
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) { target.addEventListener(t, cancel); });
      target.addEventListener('click', function (e) {
        if (Date.now() - firedAt < 800) { e.preventDefault(); e.stopPropagation(); }
      }, true);
    }

    /* ---- what each menu entry does ---- */
    function run(id, item) {
      if (!item || !teacher()) return;
      if (id === 'open') { env.open(item); return; }
      if (id === 'upload-all') return doUpload(item, { answers: true, videos: true });
      if (id === 'upload-key') return doUpload(item, { answers: true, videos: false });
      if (id === 'upload-videos') return doUpload(item, { answers: false, videos: true });
      if (id === 'upload-pdf') return openUpload(item);
      if (id === 'match') return openMatch(item);
      if (id === 'keys') return openKeys(item);
      if (id === 'delete') return doDelete(item);
    }

    function doUpload(item, what) {
      toast('⬆ ' + (what.answers && what.videos ? 'Putting the answer key and videos' : what.answers ? 'Putting the answer key' : 'Putting the videos') +
        ' of “' + docInfo(item.data).name + '” on Polymath Online…', 6000);
      return Promise.resolve(env.upload(item, what, function (m) { toast(m, 6000); })).then(function (msg) {
        if (msg) toast(msg, 7000);
      }).catch(function (e) {
        toast('Could not upload: ' + errText(e), 7000);
      });
    }

    function doDelete(item) {
      var fresh = env.fresh ? env.fresh(item.id) : Promise.resolve(item.data);
      return Promise.resolve(fresh).then(function (data) {
        var d = data || item.data || {};
        var s = deleteSummary(docInfo(d), classPlaces(env.courses ? env.courses() || {} : {}, item.id));
        return confirm({ title: s.title, lines: s.lines, confirm: s.confirm, danger: true }).then(function (yes) {
          if (!yes) { toast('Nothing was deleted.'); return; }
          return Promise.resolve(env.remove({ id: item.id, data: d }, function (m) { toast(m, 6000); })).then(function (msg) {
            toast(msg || 'Deleted.', 5000);
          });
        });
      }).catch(function (e) { toast('Delete failed: ' + errText(e), 7000); });
    }

    /* ---- the window ---- */
    function buildWindow() {
      if (back) return;
      back = el('div', 'faBack');
      back.setAttribute('role', 'dialog');
      back.setAttribute('aria-modal', 'true');
      back.hidden = true;
      card = el('div', 'faCard');
      card.setAttribute('tabindex', '-1');
      back.appendChild(card);
      document.body.appendChild(back);
      // Every key pressed in the window stops here, or one-letter tool shortcuts fire mid-typing.
      ['keydown', 'keyup', 'keypress'].forEach(function (t) {
        back.addEventListener(t, function (e) {
          e.stopPropagation();
          if (t === 'keydown' && e.key === 'Escape') { e.preventDefault(); closeWindow(); }
        });
      });
      back.addEventListener('pointerdown', function (e) { if (e.target === back) closeWindow(); });
      // A button that turns itself off drops the focus back onto the page;
      // Escape must still close the window then, and no shortcut may fire.
      document.addEventListener('keydown', function (e) {
        if (!back || back.hidden || back.contains(e.target)) return;
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); closeWindow(); }
      }, true);
    }

    function openWindow(kind, label) {
      buildWindow();
      if (confirmResolve) { var r = confirmResolve; confirmResolve = null; r(false); }
      win = { kind: kind, seq: (win ? win.seq : 0) + 1, busy: false };
      back.setAttribute('aria-label', label);
      back.hidden = false;
      card.className = 'faCard faCard-' + kind;
      while (card.firstChild) card.removeChild(card.firstChild);
      return win;
    }

    function closeWindow() {
      if (!back || back.hidden) return;
      if (win && win.busy) { toast('Still working — wait for it to finish.'); return; }
      back.hidden = true;
      if (confirmResolve) { var r = confirmResolve; confirmResolve = null; r(false); }
      win = null;
    }

    function headOf(title, sub) {
      var head = el('div', 'faHead');
      var row = el('div', 'faTitleRow');
      row.appendChild(el('div', 'faTitle', title));
      var x = button('✕', 'faClose', 'Close');
      x.setAttribute('aria-label', 'Close');
      x.addEventListener('click', closeWindow);
      row.appendChild(x);
      head.appendChild(row);
      if (sub) head.appendChild(el('div', 'faSub', sub));
      return head;
    }

    /* ---- confirmation (every delete and every removal goes through it) ---- */
    function confirm(o) {
      o = o || {};
      openWindow('confirm', o.title || 'Are you sure?');
      var w = win;
      card.appendChild(headOf(o.title || 'Are you sure?', ''));
      var body = el('div', 'faBody');
      (o.lines || []).forEach(function (line, i) {
        body.appendChild(el('p', 'faLine' + (i === (o.lines.length - 1) && o.danger ? ' faWarnLine' : ''), line));
      });
      card.appendChild(body);
      var foot = el('div', 'faFoot');
      var no = button('Cancel', 'faCancel');
      var yes = button(o.confirm || 'Yes', o.danger ? 'faDangerBtn' : 'btnPrimary');
      yes.setAttribute('data-fa', 'confirm-yes');
      no.setAttribute('data-fa', 'confirm-no');
      foot.appendChild(no);
      foot.appendChild(yes);
      card.appendChild(foot);
      // Cancel holds the focus: Enter on its own never deletes anything.
      setTimeout(function () { try { no.focus({ preventScroll: true }); } catch (e) {} }, 0);
      return new Promise(function (resolve) {
        confirmResolve = resolve;
        function finish(v) {
          if (win !== w) return;
          confirmResolve = null;
          back.hidden = true;
          win = null;
          resolve(v);
        }
        no.addEventListener('click', function () { finish(false); });
        yes.addEventListener('click', function () { finish(true); });
      });
    }

    /* ---- the worksheet picker, inside a window ---- */
    function picker(state, onPick) {
      var wrap = el('div', 'faPicker');
      var tools = el('div', 'faPickTools');
      var search = el('input', 'faSearch');
      search.type = 'search';
      search.placeholder = 'Search by worksheet name, class or date';
      search.setAttribute('aria-label', 'Search worksheets');
      search.value = state.query || '';
      tools.appendChild(search);
      var allLbl = el('label', 'faCheck faAllToggle');
      var allBox = el('input');
      allBox.type = 'checkbox';
      allBox.checked = !!state.all;
      allLbl.appendChild(allBox);
      allLbl.appendChild(el('span', '', 'Also worksheets not in a class'));
      tools.appendChild(allLbl);
      wrap.appendChild(tools);
      var list = el('div', 'faPickList');
      list.setAttribute('role', 'radiogroup');
      wrap.appendChild(list);
      function draw() {
        while (list.firstChild) list.removeChild(list.firstChild);
        if (!state.library) { list.appendChild(el('div', 'faEmpty', 'Opening the worksheets…')); return; }
        var groups = pickerGroups(env.courses ? env.courses() || {} : {}, state.library, { query: state.query, all: state.all, exclude: state.exclude });
        if (!groups.length) {
          list.appendChild(el('div', 'faEmpty', state.query ? 'Nothing matches “' + state.query + '”.' : state.all ? 'There are no other worksheets.' : 'No class lists yet — tick “Also worksheets not in a class”.'));
          return;
        }
        groups.forEach(function (g) {
          var gh = el('div', 'faGroupHead');
          gh.appendChild(el('span', 'faGroupTitle', g.title));
          gh.appendChild(el('span', 'faGroupSub', g.sub));
          list.appendChild(gh);
          g.items.forEach(function (it) {
            var row = el('label', 'faPickRow' + (state.picked === it.id ? ' faPicked' : '') + (it.state === 'current' ? ' faIsCurrent' : ''));
            var radio = el('input');
            radio.type = 'radio';
            radio.name = 'faPick' + state.uid;
            radio.checked = state.picked === it.id;
            radio.setAttribute('data-pick', it.id);
            radio.addEventListener('change', function () {
              state.picked = it.id;
              state.pickedName = it.name;
              Array.prototype.forEach.call(list.querySelectorAll('.faPickRow'), function (r) { r.classList.remove('faPicked'); });
              row.classList.add('faPicked');
              if (onPick) onPick(it);
            });
            row.appendChild(radio);
            var t = el('span', 'faPickText');
            t.appendChild(el('span', 'faPickName', it.name));
            t.appendChild(el('span', 'faPickMeta', itemMeta(it)));
            row.appendChild(t);
            list.appendChild(row);
          });
        });
        var on = list.querySelector('.faPicked');
        if (on && state.scrollToPick) { state.scrollToPick = false; try { on.scrollIntoView({ block: 'center' }); } catch (e) {} }
      }
      search.addEventListener('input', function () { state.query = search.value; draw(); });
      allBox.addEventListener('change', function () { state.all = allBox.checked; draw(); });
      draw();
      return { el: wrap, draw: draw };
    }

    function loadLibrary(state, redraw) {
      var w = win;
      Promise.resolve(env.library()).then(function (lib) {
        if (win !== w) return;
        state.library = lib || [];
        redraw();
      }).catch(function (e) {
        if (win !== w) return;
        state.library = [];
        redraw();
        toast('The worksheets could not be read: ' + errText(e), 6000);
      });
    }

    function statusLine() { return el('div', 'faStatus'); }
    function say(node, msg, kind) { node.textContent = msg || ''; node.className = 'faStatus' + (kind ? ' fa' + kind : ''); }

    /* ---- 🔗 Match answer key with a worksheet ---- */
    function openMatch(item, preset) {
      var w = openWindow('match', 'Match answer key with a worksheet');
      var info = docInfo(item.data);
      var p = preset || {};
      var state = { uid: w.seq, query: p.query || '', all: !!p.all, picked: p.picked || '', pickedName: p.pickedName || '', exclude: item.id, library: null,
        dir: p.dir === 'take' ? 'take' : 'send', bring: p.bring || { answers: true, videos: info.videos > 0 }, refresh: p.refresh !== false, scrollToPick: !!p.picked };
      card.appendChild(headOf('🔗 Match answer key with a worksheet',
        'For when the answer key did not reach the right worksheet on Polymath Online by itself. Choose the worksheet, and what goes across.'));
      var body = el('div', 'faBody');
      var dirRow = el('div', 'faSeg');
      var send = button('“' + info.name + '” → chosen worksheet', 'faSegBtn');
      var take = button('Chosen worksheet → “' + info.name + '”', 'faSegBtn');
      send.setAttribute('data-fa', 'dir-send');
      take.setAttribute('data-fa', 'dir-take');
      dirRow.appendChild(send);
      dirRow.appendChild(take);
      body.appendChild(el('div', 'faLabel', 'Which way'));
      body.appendChild(dirRow);
      var explain = el('div', 'faHint');
      body.appendChild(explain);
      body.appendChild(el('div', 'faLabel', 'The other worksheet'));
      var pk = picker(state, function () { paint(); });
      body.appendChild(pk.el);
      body.appendChild(el('div', 'faLabel', 'What goes across'));
      var bringBox = el('div', 'faBring');
      function check(key, title, small) {
        var l = el('label', 'faCheck');
        var c = el('input');
        c.type = 'checkbox';
        c.checked = !!state.bring[key];
        c.setAttribute('data-bring', key);
        c.addEventListener('change', function () { state.bring[key] = c.checked; paint(); });
        l.appendChild(c);
        var t = el('span');
        t.appendChild(el('b', '', title));
        t.appendChild(el('small', '', small));
        l.appendChild(t);
        return l;
      }
      bringBox.appendChild(check('answers', 'The answer key', 'The writing replaces what is written on the receiving worksheet; its answer key PDFs come too (days it already has stay).'));
      bringBox.appendChild(check('videos', 'The lesson videos', 'Added beside the receiving worksheet\'s own recordings, once each.'));
      var refreshLbl = el('label', 'faCheck');
      var refreshBox = el('input');
      refreshBox.type = 'checkbox';
      refreshBox.checked = state.refresh;
      refreshBox.addEventListener('change', function () { state.refresh = refreshBox.checked; });
      refreshLbl.appendChild(refreshBox);
      var rt = el('span');
      rt.appendChild(el('b', '', 'Then put it on Polymath Online now'));
      rt.appendChild(el('small', '', 'Opens the receiving worksheet here (the class stays where it is), refreshes its video page and makes today\'s answer key PDF.'));
      refreshLbl.appendChild(rt);
      bringBox.appendChild(refreshLbl);
      body.appendChild(bringBox);
      var status = statusLine();
      body.appendChild(status);
      card.appendChild(body);
      var foot = el('div', 'faFoot');
      var cancel = button('Cancel', 'faCancel');
      cancel.addEventListener('click', closeWindow);
      var go = button('Match', 'btnPrimary');
      go.setAttribute('data-fa', 'match-go');
      foot.appendChild(cancel);
      foot.appendChild(go);
      card.appendChild(foot);

      function paint() {
        send.classList.toggle('on', state.dir === 'send');
        take.classList.toggle('on', state.dir === 'take');
        var other = state.pickedName ? '“' + state.pickedName + '”' : 'the worksheet you choose';
        explain.textContent = state.dir === 'send'
          ? 'The answer key of “' + info.name + '” goes to ' + other + '.'
          : 'The answer key of ' + other + ' comes to “' + info.name + '”.';
        var ready = !!state.picked && (state.bring.answers || state.bring.videos) && !w.busy;
        go.disabled = !ready;
        go.textContent = state.picked ? 'Match ' + bringText(state.bring) : 'Choose a worksheet';
      }
      send.addEventListener('click', function () { state.dir = 'send'; paint(); });
      take.addEventListener('click', function () { state.dir = 'take'; paint(); });
      go.addEventListener('click', function () {
        if (go.disabled) return;
        var src = state.dir === 'send' ? item.id : state.picked;
        var dst = state.dir === 'send' ? state.picked : item.id;
        var srcName = state.dir === 'send' ? info.name : state.pickedName;
        var dstName = state.dir === 'send' ? state.pickedName : info.name;
        var lines = ['From: “' + srcName + '”', 'To: “' + dstName + '”', 'Goes across: ' + bringText(state.bring) + '.'];
        if (state.bring.answers) lines.push('What is written on “' + dstName + '” now is replaced.');
        var bring = { answers: !!state.bring.answers, videos: !!state.bring.videos };
        var refresh = !!state.refresh;
        // Said No, or it failed: the window comes back as it was left.
        var keep = { picked: state.picked, pickedName: state.pickedName, dir: state.dir, all: state.all, query: state.query,
          bring: { answers: bring.answers, videos: bring.videos }, refresh: refresh };
        confirm({ title: 'Match these two worksheets?', lines: lines, confirm: 'Match' }).then(function (yes) {
          if (!yes) { openMatch(item, keep); return; }
          var w2 = openWindow('working', 'Matching');
          w2.busy = true;
          card.appendChild(headOf('🔗 Matching…', '“' + srcName + '” → “' + dstName + '”'));
          var b2 = el('div', 'faBody');
          var st = statusLine();
          say(st, 'Copying across…');
          b2.appendChild(st);
          card.appendChild(b2);
          Promise.resolve(env.match(src, dst, bring, { refresh: refresh }, function (m) { say(st, m); })).then(function (msg) {
            w2.busy = false;
            closeWindow();
            toast(msg || 'Matched.', 8000);
          }).catch(function (e) {
            w2.busy = false;
            say(st, 'Could not match: ' + errText(e), 'Err');
            var f2 = el('div', 'faFoot');
            var again = button('Back', 'faCancel');
            again.addEventListener('click', function () { openMatch(item, keep); });
            var cl = button('Close', 'btnPrimary');
            cl.addEventListener('click', closeWindow);
            f2.appendChild(again);
            f2.appendChild(cl);
            card.appendChild(f2);
          });
        });
      });
      paint();
      loadLibrary(state, function () { pk.draw(); paint(); });
      // Straight into the search with a keyboard; a tablet would throw its keyboard up over the list.
      var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      if (!coarse) setTimeout(function () { var s = card.querySelector('.faSearch'); if (s) { try { s.focus({ preventScroll: true }); } catch (e) {} } }, 0);
      return w;
    }

    /* ---- 📎 Upload an answer key PDF from this device ---- */
    function openUpload(item, preset) {
      var w = openWindow('upload', 'Upload an answer key PDF');
      var p = preset || {};
      var state = { uid: w.seq, query: '', all: true, picked: p.picked || item.id, pickedName: p.pickedName || docInfo(item.data).name,
        exclude: '', library: null, scrollToPick: true, file: null, day: p.day || dayKey(Date.now()) };
      card.appendChild(headOf('📎 Upload an answer key PDF',
        'For when nothing else worked: any PDF on this device goes on Polymath Online as the answer key of the worksheet you choose, under the class day you choose. An automatic run never replaces it.'));
      var body = el('div', 'faBody');
      body.appendChild(el('div', 'faLabel', '1 · The PDF'));
      var fileRow = el('div', 'faFileRow');
      var input = el('input', 'faFile');
      input.type = 'file';
      input.accept = 'application/pdf,.pdf';
      input.setAttribute('data-fa', 'file');
      var fileName = el('span', 'faFileName', 'No file chosen');
      var choose = button('Choose PDF…', '');
      choose.addEventListener('click', function () { input.click(); });
      fileRow.appendChild(choose);
      fileRow.appendChild(fileName);
      fileRow.appendChild(input);
      body.appendChild(fileRow);
      body.appendChild(el('div', 'faLabel', '2 · The class day'));
      var dayRow = el('div', 'faDayRow');
      var dayInput = el('input', 'faDay');
      dayInput.type = 'date';
      dayInput.value = state.day;
      dayInput.setAttribute('data-fa', 'day');
      var dayWords = el('span', 'faHint', dayLabel(state.day));
      dayRow.appendChild(dayInput);
      dayRow.appendChild(dayWords);
      body.appendChild(dayRow);
      body.appendChild(el('div', 'faLabel', '3 · The worksheet it is the answer key of'));
      var pk = picker(state, function () { paint(); });
      body.appendChild(pk.el);
      var status = statusLine();
      body.appendChild(status);
      card.appendChild(body);
      var foot = el('div', 'faFoot');
      var cancel = button('Cancel', 'faCancel');
      cancel.addEventListener('click', closeWindow);
      var go = button('Upload', 'btnPrimary');
      go.setAttribute('data-fa', 'upload-go');
      foot.appendChild(cancel);
      foot.appendChild(go);
      card.appendChild(foot);
      function paint() {
        var problem = checkUpload(state.file, state.day);
        if (!problem && !state.picked) problem = 'Choose the worksheet.';
        go.disabled = !!problem || w.busy;
        go.textContent = state.picked && state.file && !problem ? 'Upload to “' + state.pickedName + '”' : 'Upload';
        if (state.file && problem) say(status, problem, 'Err');
        else if (!w.busy) say(status, '');
      }
      input.addEventListener('change', function () {
        state.file = input.files && input.files[0] ? input.files[0] : null;
        fileName.textContent = state.file ? state.file.name + ' · ' + Math.max(1, Math.round((state.file.size || 0) / 1024)) + ' KB' : 'No file chosen';
        paint();
      });
      dayInput.addEventListener('change', function () { state.day = dayInput.value; dayWords.textContent = dayLabel(state.day); paint(); });
      go.addEventListener('click', function () {
        if (go.disabled) return;
        w.busy = true; paint();
        say(status, 'Uploading…');
        Promise.resolve(env.uploadPdf(state.picked, state.file, state.day, function (m) { say(status, m); })).then(function (msg) {
          w.busy = false;
          say(status, msg || 'Uploaded.', 'Ok');
          go.textContent = '✓ Uploaded';
          go.disabled = true;
          cancel.textContent = 'Close';
          toast(msg || 'Uploaded.', 7000);
        }).catch(function (e) {
          w.busy = false; paint();
          say(status, 'Could not upload: ' + errText(e), 'Err');
        });
      });
      paint();
      loadLibrary(state, function () { pk.draw(); paint(); });
      return w;
    }

    /* ---- 📋 The answer key PDFs filed on a worksheet ---- */
    function openKeys(item) {
      var w = openWindow('keys', 'Answer key PDFs on Polymath Online');
      var info = docInfo(item.data);
      card.appendChild(headOf('📋 Answer key PDFs · ' + info.name, 'What Polymath Online shows beside this worksheet, newest class day first.'));
      var body = el('div', 'faBody');
      var list = el('div', 'faKeyList');
      body.appendChild(list);
      var status = statusLine();
      body.appendChild(status);
      card.appendChild(body);
      var foot = el('div', 'faFoot');
      var make = button('⬆ Make today\'s from the worksheet', '');
      make.addEventListener('click', function () { closeWindow(); doUpload(item, { answers: true, videos: true }); });
      var add = button('📎 Upload a PDF…', '');
      add.addEventListener('click', function () { openUpload(item); });
      var done = button('Close', 'btnPrimary');
      done.addEventListener('click', closeWindow);
      foot.appendChild(make);
      foot.appendChild(add);
      foot.appendChild(done);
      card.appendChild(foot);
      function draw(data) {
        while (list.firstChild) list.removeChild(list.firstChild);
        var entries = keyEntries(data && data.answerKeys);
        if (!entries.length) { list.appendChild(el('div', 'faEmpty', 'No answer key PDF is on Polymath Online for this worksheet yet.')); return; }
        entries.forEach(function (k) {
          var row = el('div', 'faKeyRow');
          var t = el('div', 'faKeyText');
          t.appendChild(el('div', 'faKeyDay', k.label + (k.manual ? ' · 📎 uploaded by hand' : '')));
          var bits = [];
          if (k.pages) bits.push(k.pages + ' page' + (k.pages === 1 ? '' : 's'));
          if (k.videos) bits.push('QR to ' + k.videos + ' video' + (k.videos === 1 ? '' : 's'));
          if (k.file) bits.push(k.file);
          if (k.at) bits.push('filed ' + new Date(k.at).toLocaleString());
          t.appendChild(el('div', 'faKeyMeta', bits.join(' · ')));
          row.appendChild(t);
          var openB = button('Open', 'faSmall');
          openB.addEventListener('click', function () { env.openUrl(k.url); });
          var rm = button('Remove', 'faSmall faDangerGhost');
          rm.setAttribute('data-fa', 'key-remove');
          rm.addEventListener('click', function () {
            confirm({
              title: 'Remove the answer key for ' + k.label + '?',
              lines: ['Students will no longer see this day\'s answer key PDF beside “' + info.name + '” on Polymath Online.', 'The worksheet and its writing are not touched. This cannot be undone.'],
              confirm: 'Remove', danger: true
            }).then(function (yes) {
              if (!yes) { openKeys(item); return; }
              var w2 = openKeys(item);
              w2.busy = true;
              Promise.resolve(env.removeKey(item.id, k.day)).then(function () {
                w2.busy = false;
                toast('Removed the answer key for ' + k.label + '.', 5000);
                openKeys(item);
              }).catch(function (e) {
                w2.busy = false;
                toast('Could not remove it: ' + errText(e), 6000);
                openKeys(item);
              });
            });
          });
          row.appendChild(openB);
          row.appendChild(rm);
          list.appendChild(row);
        });
      }
      list.appendChild(el('div', 'faEmpty', 'Reading…'));
      Promise.resolve(env.fresh ? env.fresh(item.id) : item.data).then(function (data) {
        if (win !== w) return;
        if (data) item = { id: item.id, data: data };
        draw(data || item.data);
      }).catch(function () { if (win === w) draw(item.data); });
      return w;
    }

    return {
      attach: attach, showMenu: showMenu, closeMenu: closeMenu, confirm: confirm,
      openMatch: openMatch, openUpload: openUpload, openKeys: openKeys, closeWindow: closeWindow,
      run: run, isOpen: function () { return !!(back && !back.hidden) || !!menu; }
    };
  }

  var api = { pure: pure, create: create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FileActions = api;
})(typeof window !== 'undefined' ? window : globalThis);
