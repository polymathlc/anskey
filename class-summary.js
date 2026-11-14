/* 🧾 Class summaries for parents (v1.198.0)
 *
 * After every lesson Ans Key writes a summary of the class: the key learning
 * points, every link Mr Chung mentioned or put on the page, the homework, and
 * a few important questions from the worksheet with their pictures. The
 * teacher reviews it and — ONLY when they choose to — emails it to the
 * students' parents from admin@polymathlc.com.sg.
 *
 *   pdfAnnotator/{id}.classSummaries = { 'YYYY-MM-DD': <summary> }
 *
 * - NOTHING IS EVER SENT BY ITSELF. Writing the summary is automatic (after a
 *   lesson, once the teacher pauses); sending it is a button, a list of
 *   ticked parents and a confirm. The glue never calls `send` from a timer.
 * - The words come from the model, but every LINK in it is checked against
 *   what was really on the page, in the recording or filed for the class
 *   (`reconcileLinks`). A link the model only "heard" is kept, flagged ⚠ for
 *   the teacher to check, and never made clickable until it is confirmed.
 * - A summary the teacher has edited, or one already sent, is never replaced
 *   by an automatic run (`plan`).
 * - Question pictures live at `pdf-annotator/lesson-summary-<docId>-<day>-q<n>.jpg`
 *   (the `lesson-` prefix is the teacher-only Storage rule).
 * - This file holds the pure rules (`pure`, testable in node) and the review
 *   window (`create(env)`), which writes everything with textContent.
 *   index.html holds the glue (`🧾 Class summary — glue`): the model call,
 *   the captions, the page pictures, Firestore, Storage and Gmail.
 */
(function (root) {
  'use strict';

  var VERSION = 1;
  var SENDER = 'admin@polymathlc.com.sg';
  var CENTRE = 'Polymath Learning Centre';
  var TEACHER = 'Mr Chung';
  var IMG_PREFIX = 'lesson-summary-';
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var DOC_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
  var AT_MIN = Date.UTC(2020, 0, 1);
  var AT_MAX = Date.UTC(2100, 0, 1);

  var MODELS = [
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'best summaries (default)' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'faster, cheaper' }
  ];
  var DEFAULT_MODEL = 'claude-opus-5-5';

  var LIMITS = {
    title: 120,
    overview: 1200,
    point: 400,
    points: 10,
    homework: 8,
    homeworkText: 300,
    due: 60,
    links: 12,
    linkLabel: 120,
    url: 600,
    questions: 6,
    questionText: 1200,
    why: 300,
    answer: 800,
    parentNote: 600,
    ref: 16,
    transcriptTotal: 60000,   // characters of speech handed to the model, every lesson together
    transcriptMinEach: 3000,  // a short lesson keeps all of its words
    boardText: 8000,
    recipients: 90,           // Gmail's own per-message limit is higher; this keeps one send sane
    parentsPerStudent: 4,
    sends: 20
  };

  var AFTER_LESSON_MS = 2 * 60 * 1000;   // a class is several recordings: wait for the teacher to pause
  var OPEN_WAIT_MS = 8 * 1000;           // an older class day with no summary is offered after opening
  var GMAIL_URL_MAX = 7600;

  /* ---------------- little helpers ---------------- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

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

  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function weekdayOf(day) {
    if (!validDay(day)) return '';
    var p = day.split('-').map(Number);
    return WEEKDAYS[new Date(p[0], p[1] - 1, p[2]).getDay()];
  }

  /* "Saturday, 14 November 2026" */
  function dayLabel(day) {
    if (!validDay(day)) return '';
    var p = day.split('-').map(Number);
    return weekdayOf(day) + ', ' + p[2] + ' ' + MONTHS[p[1] - 1] + ' ' + p[0];
  }

  function cleanText(v, max) {
    if (v == null) return '';
    var s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n');
    s = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (max && s.length > max) s = s.slice(0, Math.max(0, max - 1)).replace(/\s+\S*$/, '') + '…';
    return s;
  }

  function oneLine(v, max) { return cleanText(String(v == null ? '' : v).replace(/\s*\n\s*/g, ' '), max); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function stripTags(s) {
    return String(s == null ? '' : s).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n')
      .replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }

  var EMAIL_RE = /^[^\s@<>(),;:"\[\]\\]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
  function normEmail(v) {
    var s = String(v == null ? '' : v).trim().replace(/^mailto:/i, '').toLowerCase();
    return EMAIL_RE.test(s) && s.length <= 254 ? s : '';
  }

  /* Any list of addresses, typed with commas, semicolons, spaces or new lines. */
  function parseEmails(text) {
    var seen = Object.create(null), out = [];
    String(text == null ? '' : text).split(/[\s,;]+/).forEach(function (part) {
      var m = /<([^>]+)>/.exec(part);
      var e = normEmail(m ? m[1] : part);
      if (e && !seen[e]) { seen[e] = true; out.push(e); }
    });
    return out;
  }

  function cleanParentEmails(list) {
    var arr = Array.isArray(list) ? list : parseEmails(list);
    var seen = Object.create(null), out = [];
    arr.forEach(function (e) {
      var n = normEmail(e);
      if (n && !seen[n]) { seen[n] = true; out.push(n); }
    });
    return out.slice(0, LIMITS.parentsPerStudent);
  }

  function toMillis(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    return 0;
  }

  /* FNV-1a over the parts: what went into a summary. */
  function fingerprint(parts) {
    var h = 0x811c9dc5;
    var s = (Array.isArray(parts) ? parts : [parts]).map(function (p) { return String(p == null ? '' : p); }).join('\u0001');
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8) + ':' + s.length.toString(36);
  }

  function clock(ms) {
    var s = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    var m = Math.floor(s / 60);
    if (m < 60) return m + ':' + pad2(s % 60);
    return Math.floor(m / 60) + ':' + pad2(m % 60) + ':' + pad2(s % 60);
  }

  /* ---------------- the lessons of a class day ---------------- */

  /* Every lesson recording on the worksheet, as a short record. A lesson is a
     video annotation carrying `lessonRecording`; its day is the day it was
     saved (`ts`), the same reading the answer key and the video page use. */
  function lessonsOf(annotations) {
    var out = [];
    (Array.isArray(annotations) ? annotations : []).forEach(function (a) {
      if (!a || a.type !== 'video' || !a.lessonRecording || typeof a.lessonRecording !== 'object') return;
      var r = a.lessonRecording;
      var ts = Number(a.ts) || 0;
      var day = dayKey(ts);
      if (!day) return;
      out.push({
        id: String(a.id || ''),
        day: day,
        ts: ts,
        page: Number(a.page) || 1,
        title: oneLine(r.title, 60),
        duration: Number(r.duration) || 0,
        video: !!r.video,
        captions: !!(r.captionsUrl && r.captionsLang === 'en'),
        url: typeof a.url === 'string' ? a.url : ''
      });
    });
    out.sort(function (a, b) { return a.ts - b.ts; });
    return out;
  }

  function lessonsOnDay(annotations, day) {
    return lessonsOf(annotations).filter(function (l) { return l.day === day; });
  }

  /* Class days with lessons, newest first. */
  function lessonDays(annotations) {
    var seen = Object.create(null), out = [];
    lessonsOf(annotations).forEach(function (l) { if (!seen[l.day]) { seen[l.day] = true; out.push(l.day); } });
    out.sort(function (a, b) { return a < b ? 1 : a > b ? -1 : 0; });
    return out;
  }

  /* Captions → "[m:ss] words" lines, joining cues closer than 2 s so the
     model reads sentences rather than fragments, capped at `max` characters
     (the END is kept as well as the start: homework is usually said last). */
  function transcriptOf(cues, max) {
    var lines = [], cur = null;
    (Array.isArray(cues) ? cues : []).forEach(function (c) {
      if (!c || typeof c.t !== 'string') return;
      var t = oneLine(c.t, 500);
      if (!t) return;
      var s = Number(c.s) || 0, e = Number(c.e) || s;
      if (cur && s - cur.e < 2000 && cur.t.length < 400) { cur.t += ' ' + t; cur.e = e; }
      else { if (cur) lines.push(cur); cur = { s: s, e: e, t: t }; }
    });
    if (cur) lines.push(cur);
    var text = lines.map(function (l) { return '[' + clock(l.s) + '] ' + l.t; }).join('\n');
    max = max || LIMITS.transcriptTotal;
    if (text.length <= max) return text;
    var head = Math.floor(max * 0.6), tail = max - head - 40;
    return text.slice(0, head).replace(/\n[^\n]*$/, '') + '\n[… the middle of the lesson is shortened …]\n' +
      text.slice(text.length - tail).replace(/^[^\n]*\n/, '');
  }

  /* Share `total` characters among the lessons: a short lesson keeps all of
     its words, a long one is shortened — never the next lesson dropped. */
  function transcriptShares(lengths, total, minEach) {
    total = total || LIMITS.transcriptTotal;
    minEach = minEach || LIMITS.transcriptMinEach;
    var n = lengths.length, out = lengths.map(function () { return 0; });
    if (!n) return out;
    var left = Math.max(total, n * minEach), open = lengths.map(function (_, i) { return i; });
    while (open.length) {
      var each = Math.floor(left / open.length), next = [];
      var done = false;
      open.forEach(function (i) {
        if (lengths[i] <= each) { out[i] = lengths[i]; left -= lengths[i]; done = true; }
        else next.push(i);
      });
      if (!done) { next.forEach(function (i) { out[i] = each; }); break; }
      open = next;
    }
    return out;
  }

  /* ---------------- links ---------------- */

  var URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

  function normUrl(u) {
    var s = String(u == null ? '' : u).trim().replace(/[)\].,;:!?'"»]+$/, '');
    if (/^www\./i.test(s)) s = 'https://' + s;
    if (!/^https?:\/\//i.test(s)) return '';
    try {
      var url = new URL(s);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
      if (url.username || url.password) return '';
      if (!/\./.test(url.hostname)) return '';
      return url.href.length <= LIMITS.url ? url.href : '';
    } catch (e) { return ''; }
  }

  /* A loose key for "is this the same link": scheme, www. and a trailing
     slash do not make a different page. */
  function linkKey(u) {
    var n = normUrl(u);
    if (!n) return '';
    return n.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '').toLowerCase();
  }

  function extractUrls(text) {
    var seen = Object.create(null), out = [];
    String(text == null ? '' : text).replace(URL_RE, function (m) {
      var n = normUrl(m);
      var k = linkKey(n);
      if (n && !seen[k]) { seen[k] = true; out.push(n); }
      return m;
    });
    return out;
  }

  /* The model's links, checked:
     - one that is among the class's own links (`known`, e.g. the answer key
       and the video page) or appears in the board / transcript text is kept,
     - one it only heard said aloud is kept as `heard`, flagged for the
       teacher, never shown as a clickable link until it is confirmed,
     - one that is neither is dropped (a link the model invented),
     and every `known` link the model left out is put back. */
  function reconcileLinks(aiLinks, known, sourceText) {
    var sources = Object.create(null);
    extractUrls(sourceText).forEach(function (u) { sources[linkKey(u)] = u; });
    var knownMap = Object.create(null);
    (known || []).forEach(function (k) { var key = linkKey(k && k.url); if (key) knownMap[key] = k; });
    var seen = Object.create(null), out = [];
    (Array.isArray(aiLinks) ? aiLinks : []).forEach(function (l) {
      if (!l || out.length >= LIMITS.links) return;
      var url = normUrl(l.url);
      var key = linkKey(url);
      var label = oneLine(l.label || l.title, LIMITS.linkLabel);
      if (!key || seen[key]) {
        // A spoken link with no address the model could write ("the Seneca website")
        // is still worth a line for the teacher to fill in.
        if (!key && label && l.heard) { out.push({ label: label, url: '', heard: true, check: true }); }
        return;
      }
      if (knownMap[key]) {
        seen[key] = true;
        out.push({ label: label || knownMap[key].label || url, url: normUrl(knownMap[key].url), heard: false, check: false, kind: knownMap[key].kind || '' });
      } else if (sources[key]) {
        seen[key] = true;
        out.push({ label: label || url, url: url, heard: false, check: false });
      } else if (l.heard) {
        seen[key] = true;
        out.push({ label: label || url, url: url, heard: true, check: true });
      }
    });
    (known || []).forEach(function (k) {
      var key = linkKey(k && k.url);
      if (!key || seen[key] || out.length >= LIMITS.links) return;
      seen[key] = true;
      out.push({ label: oneLine(k.label, LIMITS.linkLabel) || normUrl(k.url), url: normUrl(k.url), heard: false, check: false, kind: k.kind || '' });
    });
    return out;
  }

  /* ---------------- the prompt ---------------- */

  var SYSTEM = [
    'You write the summary of one tuition class at ' + CENTRE + ' (Singapore, primary school).',
    'The teacher is ' + TEACHER + '. The summary is read by the students’ PARENTS, and by the students.',
    'You are given what really happened in the class: the transcript of ' + TEACHER + '’s recorded explanations,',
    'the words and links written on the worksheet, and pictures of the worksheet pages with ' + TEACHER + '’s writing on them.',
    '',
    'Write:',
    '- "title": a short title naming the topic of the class (not the date).',
    '- "overview": 2 to 4 warm, plain sentences a parent can read in ten seconds: what the class learned and why it matters.',
    '- "points": 3 to 7 KEY LEARNING POINTS, each one concrete (a method, a rule, a common mistake to avoid, a definition),',
    '  in ' + TEACHER + '’s own way of explaining when the transcript shows it. Never a vague line like "they learned fractions".',
    '- "homework": every piece of homework ' + TEACHER + ' set or mentioned, word for word as far as possible,',
    '  with "due" when a day was said. If no homework was mentioned, return an empty list — NEVER invent homework.',
    '- "links": every website or link ' + TEACHER + ' mentioned or wrote down. Use the exact address when it was written',
    '  or given to you; set "heard": true for a site that was only SAID aloud. Never invent an address.',
    '- "questions": the 2 to 5 MOST IMPORTANT questions on the worksheet for this class (the ones explained in the',
    '  recording, or that carry the main idea). For each: "ref" (its number as printed, e.g. "Q5" or "Q3(b)"), "page",',
    '  "text" (the question written out in full so it reads on its own), "why" (one line: why it matters), and',
    '  "answer" (a short model answer in ' + TEACHER + '’s method).',
    '- "parentNote": one or two sentences suggesting how a parent can help at home this week.',
    '',
    'Rules: British spelling, Singapore primary school terms. Do not mention AI, transcripts or recordings.',
    'Do not name any student. Say only what the class material supports. Reply with JSON only, in exactly this shape:',
    '{"title":"","overview":"","points":[""],"homework":[{"task":"","due":""}],"links":[{"label":"","url":"","heard":false}],',
    '"questions":[{"ref":"","page":1,"text":"","why":"","answer":""}],"parentNote":""}'
  ].join('\n');

  /* input: { worksheet, level, subject, day, lessons:[{title, duration, transcript}],
             board, links:[{label,url,kind}], questionRefs:[{page, refs:[...] }], pages } */
  function buildPrompt(input) {
    input = input || {};
    var parts = [];
    var subjectWord = input.subject === 'math' || input.subject === 'mathematics' ? 'Mathematics'
      : input.subject === 'science' ? 'Science' : cleanText(input.subject, 30);
    parts.push('CLASS: ' + [input.level, subjectWord].filter(Boolean).join(' ') + (input.worksheet ? ' — worksheet "' + oneLine(input.worksheet, 140) + '"' : '') +
      (validDay(input.day) ? ' — ' + dayLabel(input.day) : ''));
    if (input.pages) parts.push('The worksheet has ' + input.pages + ' page' + (input.pages === 1 ? '' : 's') + '. Pictures of the pages taught are attached, in page order.');
    var lessons = Array.isArray(input.lessons) ? input.lessons : [];
    if (lessons.length) {
      parts.push('');
      parts.push('RECORDED EXPLANATIONS (' + lessons.length + '):');
      lessons.forEach(function (l, i) {
        parts.push('');
        parts.push('--- Recording ' + (i + 1) + (l.title ? ' (' + oneLine(l.title, 60) + ')' : '') + (l.page ? ', page ' + l.page : '') +
          (l.duration ? ', ' + clock(l.duration) : '') + ' ---');
        parts.push(l.transcript ? String(l.transcript) : '(no transcript — use the page pictures for this one)');
      });
    } else {
      parts.push('');
      parts.push('There are no recorded explanations for this class: work from the worksheet pages and the writing on them.');
    }
    if (input.board) {
      parts.push('');
      parts.push('WORDS WRITTEN ON THE WORKSHEET BY ' + TEACHER.toUpperCase() + ':');
      parts.push(cleanText(input.board, LIMITS.boardText));
    }
    var links = Array.isArray(input.links) ? input.links : [];
    if (links.length) {
      parts.push('');
      parts.push('LINKS FOR THIS CLASS (always include these):');
      links.forEach(function (l) { parts.push('- ' + (l.label ? oneLine(l.label, 100) + ': ' : '') + l.url); });
    }
    var refs = Array.isArray(input.questionRefs) ? input.questionRefs : [];
    if (refs.length) {
      parts.push('');
      parts.push('QUESTION NUMBERS PRINTED ON THE PAGES (use these as "ref" and "page"):');
      refs.forEach(function (r) { if (r && r.refs && r.refs.length) parts.push('- page ' + r.page + ': ' + r.refs.join(', ')); });
    }
    parts.push('');
    parts.push('Write the summary now, as JSON only.');
    return { system: SYSTEM + (input.grounding ? '\n\n' + input.grounding : ''), user: parts.join('\n') };
  }

  /* The model's reply → an object, or null. Accepts a fenced block or prose
     around the JSON. */
  function parseReply(raw) {
    if (raw && typeof raw === 'object') return raw;
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    var fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
    if (fence) s = fence[1].trim();
    try { return JSON.parse(s); } catch (e) { /* fall through */ }
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try { return JSON.parse(s.slice(a, b + 1)); } catch (e2) { return null; }
    }
    return null;
  }

  function cleanRef(v) {
    var s = oneLine(v, LIMITS.ref).replace(/^question\s*/i, 'Q');
    if (/^\d/.test(s)) s = 'Q' + s;
    return s;
  }

  var IMG_URL_RE = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[A-Za-z0-9._-]+\/o\/([^?#]+)\?(.*)$/;

  function imagePath(dir, docId, day, n) {
    var i = Math.floor(Number(n));
    if (!validDocId(docId) || !validDay(day) || !(i >= 1 && i <= LIMITS.questions)) return '';
    return String(dir || 'pdf-annotator') + '/' + IMG_PREFIX + docId + '-' + day + '-q' + i + '.jpg';
  }

  function validImageUrl(url) {
    var m = IMG_URL_RE.exec(String(url || ''));
    if (!m) return false;
    var name;
    try { name = decodeURIComponent(m[1]); } catch (e) { return false; }
    if (!/^pdf-annotator\/lesson-summary-[A-Za-z0-9_-]{1,80}-\d{4}-\d{2}-\d{2}-q\d\.jpg$/.test(name)) return false;
    var q = m[2].split('&');
    return q.indexOf('alt=media') >= 0 && q.some(function (kv) { return /^token=[0-9a-f-]{36}$/i.test(kv); });
  }

  function cleanQuestion(q, i) {
    if (!q || typeof q !== 'object') return null;
    var text = cleanText(q.text || q.question, LIMITS.questionText);
    if (!text) return null;
    var page = Math.floor(Number(q.page));
    return {
      ref: cleanRef(q.ref || q.number || ('Q' + (i + 1))),
      page: page >= 1 && page <= 2000 ? page : 0,
      text: text,
      why: cleanText(q.why, LIMITS.why),
      answer: cleanText(q.answer, LIMITS.answer),
      include: q.include !== false,
      img: validImageUrl(q.img) ? String(q.img) : '',
      imgPath: typeof q.imgPath === 'string' && q.imgPath.indexOf('pdf-annotator/' + IMG_PREFIX) === 0 ? q.imgPath : ''
    };
  }

  function cleanSends(list) {
    return (Array.isArray(list) ? list : []).map(function (s) {
      if (!s || typeof s !== 'object') return null;
      var at = toMillis(s.at);
      if (!(at >= AT_MIN && at < AT_MAX)) return null;
      return { at: at, count: Math.max(0, Math.min(1000, Math.floor(Number(s.count) || 0))),
               via: s.via === 'gmail-api' || s.via === 'compose' || s.via === 'copy' ? s.via : 'compose',
               from: normEmail(s.from) || '' };
    }).filter(Boolean).slice(-LIMITS.sends);
  }

  /* The one door into a stored summary. Anything the model or the document
     says goes through here before it is shown, saved or emailed. */
  function cleanSummary(obj, ctx) {
    ctx = ctx || {};
    if (!obj || typeof obj !== 'object') return null;
    var points = (Array.isArray(obj.points) ? obj.points : []).map(function (p) {
      return cleanText(typeof p === 'string' ? p : p && (p.text || p.point), LIMITS.point);
    }).filter(Boolean).slice(0, LIMITS.points);
    var homework = (Array.isArray(obj.homework) ? obj.homework : []).map(function (h) {
      if (typeof h === 'string') h = { task: h };
      if (!h || typeof h !== 'object') return null;
      var task = cleanText(h.task || h.text, LIMITS.homeworkText);
      if (!task || /^(none|no homework|nil|n\/a)\.?$/i.test(task)) return null;
      return { task: task, due: oneLine(h.due, LIMITS.due) };
    }).filter(Boolean).slice(0, LIMITS.homework);
    var links = ctx.reconcile ? reconcileLinks(obj.links, ctx.known, ctx.sourceText)
      : (Array.isArray(obj.links) ? obj.links : []).map(function (l) {
        if (!l || typeof l !== 'object') return null;
        var url = normUrl(l.url);
        var label = oneLine(l.label, LIMITS.linkLabel);
        if (!url && !label) return null;
        return { label: label || url, url: url, heard: !!l.heard, check: !!l.check || !url, kind: oneLine(l.kind, 20) };
      }).filter(Boolean).slice(0, LIMITS.links);
    var questions = (Array.isArray(obj.questions) ? obj.questions : []).map(cleanQuestion).filter(Boolean).slice(0, LIMITS.questions);
    var out = {
      v: VERSION,
      day: validDay(obj.day) ? obj.day : (validDay(ctx.day) ? ctx.day : ''),
      title: oneLine(obj.title, LIMITS.title),
      overview: cleanText(obj.overview, LIMITS.overview),
      points: points,
      homework: homework,
      links: links,
      questions: questions,
      parentNote: cleanText(obj.parentNote, LIMITS.parentNote),
      at: toMillis(obj.at) || (ctx.now || 0),
      model: oneLine(obj.model || ctx.model, 60),
      engine: oneLine(obj.engine || ctx.engine, 60),
      fp: typeof (obj.fp || ctx.fp) === 'string' ? String(obj.fp || ctx.fp).slice(0, 40) : '',
      lessons: Math.max(0, Math.min(200, Math.floor(Number(obj.lessons != null ? obj.lessons : ctx.lessons) || 0))),
      edited: !!obj.edited,
      includeAnswers: !!obj.includeAnswers,
      sends: cleanSends(obj.sends)
    };
    if (!out.title && !out.overview && !out.points.length) return null;
    if (!out.title) out.title = 'Today’s class';
    return out;
  }

  function summariesOf(map) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
    var out = {};
    Object.keys(map).forEach(function (day) {
      if (!validDay(day)) return;
      var s = cleanSummary(map[day], { day: day });
      if (s) { s.day = day; out[day] = s; }
    });
    return out;
  }

  function sentAt(summary) {
    var s = summary && summary.sends;
    return s && s.length ? s[s.length - 1].at : 0;
  }

  /* ---------------- the decision ---------------- */

  /* plan(trigger, ctx) → { day, why }. `day` is '' when nothing should run.
     trigger: 'lesson' (a lesson was just saved), 'open' (a worksheet was
     opened), 'manual' (↻ in the window, always runs for the asked day). */
  function plan(trigger, ctx) {
    ctx = ctx || {};
    var no = function (why) { return { day: '', why: why }; };
    if (!ctx.teacher) return no('not-teacher');
    if (ctx.practice) return no('practice');
    if (!validDocId(ctx.docId)) return no('unsaved');
    var day = trigger === 'manual' ? ctx.day : trigger === 'open' ? ctx.lastLessonDay : dayKey(ctx.now);
    if (!validDay(day)) return no('no-day');
    if (trigger === 'manual') return { day: day, why: 'manual' };
    if (ctx.auto === false) return no('auto-off');
    var count = ctx.lessonsByDay ? Number(ctx.lessonsByDay[day]) || 0 : Number(ctx.lessonsToday) || 0;
    if (!(count > 0)) return no('no-lessons');
    // An older class is caught up only while it is recent: opening last term's
    // worksheet must not write (and pay for) a summary nobody will send.
    if (trigger === 'open' && ctx.now && dayKey(ctx.now - (ctx.recentDays || 2) * 86400000) > day) return no('old');
    var have = ctx.summaries && ctx.summaries[day];
    if (have) {
      if (sentAt(have)) return no('sent');
      if (have.edited) return no('edited');
      if (trigger === 'open') return no('exists');
      if (ctx.fp && have.fp === ctx.fp) return no('unchanged');
      if (have.lessons >= count && trigger !== 'lesson') return no('exists');
    }
    return { day: day, why: have ? 'refresh' : 'new' };
  }

  /* ---------------- the question pictures ---------------- */

  var QNUM_RE = /^(?:Q(?:uestion)?\s*)?(\d{1,2})\s*[.)]?(?=\s|$)/i;

  /* Question numbers printed down the left margin of a page.
     items: [{str, x, y}] in page units, y down the page. */
  function questionMarks(items, pageW, margin) {
    var m = margin == null ? 0.22 : margin, out = [], seen = Object.create(null);
    (items || []).forEach(function (it) {
      if (!it) return;
      var hit = String(it.str || '').trim().match(QNUM_RE);
      if (!hit || !(it.x >= 0) || it.x > pageW * m || !isFinite(it.y)) return;
      var n = Number(hit[1]);
      if (!(n >= 1 && n <= 99) || seen[n]) return;
      seen[n] = true;
      out.push({ n: n, y: it.y });
    });
    out.sort(function (a, b) { return a.y - b.y; });
    // Numbers must run downwards in order; a stray "2" in a table below Q5 is not Q2.
    var clean = [];
    out.forEach(function (q) { if (!clean.length || q.n > clean[clean.length - 1].n) clean.push(q); });
    return clean;
  }

  /* The part of the page a question takes: from just above its number to just
     above the next number (or the page's foot), the full width. null when
     the number is not on the page. */
  function questionBand(marks, ref, pageW, pageH) {
    var n = Number(String(ref || '').replace(/^\D*/, '').replace(/\D.*$/, ''));
    if (!(n >= 1)) return null;
    var i = -1;
    (marks || []).forEach(function (q, k) { if (q.n === n) i = k; });
    if (i < 0) return null;
    var lead = Math.min(28, pageH * 0.03);
    var top = Math.max(0, marks[i].y - lead - 14);
    var next = marks[i + 1];
    var bottom = next ? next.y - lead : pageH - pageH * 0.04;
    // A question longer than 60% of the page is cut there: a picture in an email is read on a phone.
    bottom = Math.min(bottom, top + pageH * 0.6);
    if (bottom - top < pageH * 0.06) bottom = Math.min(pageH, top + pageH * 0.12);
    var x = pageW * 0.03;
    return { x: x, y: top, w: pageW - 2 * x, h: Math.max(1, bottom - top) };
  }

  /* ---------------- who receives it ---------------- */

  function subjectOk(profileSubject, subject) {
    if (!subject) return true;
    var s = String(profileSubject || '').toLowerCase();
    var want = String(subject).toLowerCase();
    if (want === 'mathematics') want = 'math';
    if (s === 'mathematics') s = 'math';
    return s === want || s === 'both';
  }

  /* The roster for the summary: every student of the worksheet's level and
     subject, with `inClass` when their class days include the class's
     weekday. A student with no parent address is listed (so it can be typed
     in) but cannot be ticked. */
  function recipientsFor(profiles, f) {
    f = f || {};
    var out = [];
    (profiles || []).forEach(function (row) {
      var p = row && (row.p || row);
      var uid = row && (row.uid || p.uid);
      if (!p || !uid) return;
      var level = oneLine(p.level, 8);
      if (f.level && level !== f.level) return;
      if (f.subject && !subjectOk(p.subject, f.subject)) return;
      var days = Array.isArray(p.days) ? p.days : [];
      var inClass = !f.weekday || !days.length || days.indexOf(f.weekday) >= 0;
      out.push({
        uid: String(uid),
        name: oneLine(p.name, 60) || (normEmail(p.email) ? normEmail(p.email).split('@')[0] : 'Student'),
        level: level,
        parents: cleanParentEmails(p.parentEmails),
        inClass: inClass,
        days: days.slice(0, 7)
      });
    });
    out.sort(function (a, b) {
      return (b.inClass - a.inClass) || a.name.localeCompare(b.name);
    });
    return out;
  }

  /* The Bcc list: the ticked students' parents plus whatever was typed, one
     address once, never the sender (it is the To). */
  function mergeRecipients(rows, ticked, extra, sender) {
    var seen = Object.create(null), out = [];
    var me = normEmail(sender);
    if (me) seen[me] = true;
    var tick = ticked || {};
    (rows || []).forEach(function (r) {
      if (!r || !tick[r.uid]) return;
      (r.parents || []).forEach(function (e) {
        var n = normEmail(e);
        if (n && !seen[n]) { seen[n] = true; out.push(n); }
      });
    });
    parseEmails(Array.isArray(extra) ? extra.join(',') : extra).forEach(function (e) {
      if (!seen[e]) { seen[e] = true; out.push(e); }
    });
    return out.slice(0, LIMITS.recipients);
  }

  /* ---------------- the email ---------------- */

  function subjectLine(summary, ctx) {
    ctx = ctx || {};
    var bits = [ctx.level, ctx.subjectWord].filter(Boolean).join(' ');
    var day = validDay(summary && summary.day) ? dayLabel(summary.day).replace(/, \d{4}$/, '') : '';
    var title = summary && summary.title ? summary.title : 'Class summary';
    return oneLine((bits ? bits + ' — ' : '') + title + (day ? ' (' + day + ')' : ''), 180);
  }

  var COLORS = { ink: '#2b2118', soft: '#6b5a4a', line: '#efe3d3', accent: '#c96a12', card: '#fff8ee', link: '#0b6aa2', warn: '#9a5b00' };

  /* The HTML email. Every value is escaped; inline styles only (mail apps
     drop <style>). `images`: 'cid' (attached, for the Gmail send) or 'url'
     (the stored picture, for a preview or a pasted copy). */
  function emailHtml(summary, opts) {
    opts = opts || {};
    var s = summary || {};
    var c = COLORS;
    var h = [];
    var p = function (t, style) { return '<p style="margin:0 0 12px;line-height:1.55;' + (style || '') + '">' + escapeHtml(t).replace(/\n/g, '<br>') + '</p>'; };
    var heading = function (t) { return '<h2 style="font-size:17px;margin:26px 0 10px;color:' + c.accent + ';font-weight:700;">' + escapeHtml(t) + '</h2>'; };
    h.push('<div style="background:#f6f1ea;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:' + c.ink + ';">');
    h.push('<div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:14px;padding:28px 26px;border:1px solid ' + c.line + ';">');
    h.push('<div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:' + c.soft + ';margin-bottom:6px;">' +
      escapeHtml([CENTRE, opts.classLine].filter(Boolean).join(' · ')) + '</div>');
    h.push('<h1 style="font-size:22px;line-height:1.3;margin:0 0 6px;">' + escapeHtml(s.title || 'Class summary') + '</h1>');
    if (validDay(s.day)) h.push('<div style="color:' + c.soft + ';font-size:14px;margin-bottom:18px;">' + escapeHtml(dayLabel(s.day)) +
      (opts.worksheet ? ' · ' + escapeHtml(opts.worksheet) : '') + '</div>');
    if (opts.greeting !== false) h.push(p('Dear Parents,'));
    if (s.overview) h.push(p(s.overview));
    if (s.points && s.points.length) {
      h.push(heading('Key learning points'));
      h.push('<ul style="margin:0 0 8px;padding-left:20px;">');
      s.points.forEach(function (pt) { h.push('<li style="margin:0 0 8px;line-height:1.55;">' + escapeHtml(pt) + '</li>'); });
      h.push('</ul>');
    }
    h.push(heading('Homework'));
    if (s.homework && s.homework.length) {
      h.push('<ul style="margin:0 0 8px;padding-left:20px;">');
      s.homework.forEach(function (hw) {
        h.push('<li style="margin:0 0 8px;line-height:1.55;">' + escapeHtml(hw.task) +
          (hw.due ? ' <span style="color:' + c.accent + ';font-weight:600;">(due ' + escapeHtml(hw.due) + ')</span>' : '') + '</li>');
      });
      h.push('</ul>');
    } else h.push(p('No homework was set for this class.', 'color:' + c.soft + ';'));
    var links = (s.links || []).filter(function (l) { return l && l.url && !l.check; });
    if (links.length) {
      h.push(heading('Links from the class'));
      h.push('<ul style="margin:0 0 8px;padding-left:20px;">');
      links.forEach(function (l) {
        h.push('<li style="margin:0 0 8px;line-height:1.55;">' + escapeHtml(l.label || l.url) + '<br><a href="' + escapeHtml(l.url) +
          '" style="color:' + c.link + ';word-break:break-all;">' + escapeHtml(l.url) + '</a></li>');
      });
      h.push('</ul>');
    }
    var qs = (s.questions || []).filter(function (q) { return q && q.include !== false; });
    if (qs.length) {
      h.push(heading('Important questions to revise'));
      qs.forEach(function (q, i) {
        h.push('<div style="background:' + c.card + ';border:1px solid ' + c.line + ';border-radius:12px;padding:16px 16px 6px;margin:0 0 14px;">');
        h.push('<div style="font-weight:700;margin:0 0 8px;">' + escapeHtml((q.ref || 'Question ' + (i + 1)) + (q.page ? ' · page ' + q.page : '')) + '</div>');
        var src = opts.images === 'cid' ? (q.cid ? 'cid:' + q.cid : '') : (q.img || '');
        if (src) h.push('<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(q.ref || 'Question') +
          '" style="display:block;max-width:100%;height:auto;border-radius:8px;border:1px solid ' + c.line + ';margin:0 0 10px;background:#fff;">');
        h.push(p(q.text));
        if (q.why) h.push(p('Why it matters: ' + q.why, 'color:' + c.soft + ';font-size:14px;'));
        if ((opts.includeAnswers || s.includeAnswers) && q.answer) h.push(p('Answer: ' + q.answer, 'font-size:14px;border-top:1px dashed ' + c.line + ';padding-top:10px;'));
        h.push('</div>');
      });
    }
    if (s.parentNote) {
      h.push(heading('How you can help at home'));
      h.push(p(s.parentNote));
    }
    h.push('<p style="margin:24px 0 0;line-height:1.55;">Warm regards,<br>' + escapeHtml(opts.signOff || TEACHER + '<br>' + CENTRE).replace(/&lt;br&gt;/g, '<br>') + '</p>');
    h.push('</div>');
    h.push('<div style="max-width:640px;margin:10px auto 0;font-size:12px;color:' + c.soft + ';text-align:center;line-height:1.5;">' +
      escapeHtml('You are receiving this because your child attends ' + CENTRE + '. Reply to this email to reach us.') + '</div>');
    h.push('</div>');
    return h.join('');
  }

  /* The same email as plain text, for the text part and for Gmail's compose window. */
  function emailText(summary, opts) {
    opts = opts || {};
    var s = summary || {};
    var L = [];
    L.push((s.title || 'Class summary') + (validDay(s.day) ? ' — ' + dayLabel(s.day) : ''));
    if (opts.worksheet) L.push('Worksheet: ' + opts.worksheet);
    L.push('');
    if (opts.greeting !== false) L.push('Dear Parents,', '');
    if (s.overview) L.push(s.overview, '');
    if (s.points && s.points.length) {
      L.push('KEY LEARNING POINTS');
      s.points.forEach(function (pt) { L.push('• ' + pt); });
      L.push('');
    }
    L.push('HOMEWORK');
    if (s.homework && s.homework.length) s.homework.forEach(function (hw) { L.push('• ' + hw.task + (hw.due ? ' (due ' + hw.due + ')' : '')); });
    else L.push('No homework was set for this class.');
    L.push('');
    var links = (s.links || []).filter(function (l) { return l && l.url && !l.check; });
    if (links.length) {
      L.push('LINKS FROM THE CLASS');
      links.forEach(function (l) { L.push('• ' + (l.label || l.url)); L.push('  ' + l.url); });
      L.push('');
    }
    var qs = (s.questions || []).filter(function (q) { return q && q.include !== false; });
    if (qs.length) {
      L.push('IMPORTANT QUESTIONS TO REVISE');
      qs.forEach(function (q, i) {
        L.push((i + 1) + '. ' + (q.ref ? q.ref + (q.page ? ' (page ' + q.page + ')' : '') + ': ' : '') + q.text);
        if (q.why) L.push('   Why it matters: ' + q.why);
        if ((opts.includeAnswers || s.includeAnswers) && q.answer) L.push('   Answer: ' + q.answer);
        if (opts.imageLinks && q.img) L.push('   Picture: ' + q.img);
      });
      L.push('');
    }
    if (s.parentNote) L.push('HOW YOU CAN HELP AT HOME', s.parentNote, '');
    L.push('Warm regards,', TEACHER, CENTRE);
    return L.join('\n');
  }

  /* ---------------- MIME for the Gmail API ---------------- */

  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var out = [], s = unescape(encodeURIComponent(str));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64Bytes(bytes) {
    var out = '', i;
    for (i = 0; i + 2 < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    var rest = bytes.length - i;
    if (rest === 1) { var a = bytes[i] << 16; out += B64[(a >> 18) & 63] + B64[(a >> 12) & 63] + '=='; }
    else if (rest === 2) { var b = (bytes[i] << 16) | (bytes[i + 1] << 8); out += B64[(b >> 18) & 63] + B64[(b >> 12) & 63] + B64[(b >> 6) & 63] + '='; }
    return out;
  }
  function b64Utf8(str) { return b64Bytes(utf8Bytes(str)); }
  function b64url(str) { return b64Utf8(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function wrap76(s) { return String(s).replace(/(.{76})/g, '$1\r\n'); }

  /* A header value: plain ASCII as it is, anything else as RFC 2047 words. */
  function encodeHeader(v) {
    var s = String(v == null ? '' : v).replace(/[\r\n]+/g, ' ');
    if (/^[\x20-\x7e]*$/.test(s)) return s;
    return '=?UTF-8?B?' + b64Utf8(s) + '?=';
  }

  function headerAddresses(list) {
    return (list || []).map(normEmail).filter(Boolean).join(', ');
  }

  /* The whole message: multipart/related (HTML + the question pictures, by
     cid) inside multipart/alternative with the plain text.
     m: { from, fromName, to:[], bcc:[], subject, html, text, images:[{cid, mime, data(base64)}], replyTo } */
  function mimeMessage(m, boundarySeed) {
    m = m || {};
    var seed = String(boundarySeed || Date.now().toString(36));
    var alt = 'alt_' + seed, rel = 'rel_' + seed;
    var CRLF = '\r\n';
    var from = normEmail(m.from);
    var lines = [];
    lines.push('From: ' + (m.fromName ? encodeHeader(m.fromName) + ' <' + from + '>' : from));
    var to = headerAddresses(m.to);
    if (to) lines.push('To: ' + to);
    var bcc = headerAddresses(m.bcc);
    if (bcc) lines.push('Bcc: ' + bcc);
    if (normEmail(m.replyTo)) lines.push('Reply-To: ' + normEmail(m.replyTo));
    lines.push('Subject: ' + encodeHeader(m.subject || ''));
    lines.push('MIME-Version: 1.0');
    lines.push('Content-Type: multipart/alternative; boundary="' + alt + '"');
    lines.push('');
    lines.push('--' + alt);
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(wrap76(b64Utf8(m.text || '')));
    lines.push('--' + alt);
    var imgs = (m.images || []).filter(function (im) { return im && im.cid && im.data && /^[A-Za-z0-9._-]+$/.test(im.cid); });
    if (imgs.length) {
      lines.push('Content-Type: multipart/related; boundary="' + rel + '"');
      lines.push('');
      lines.push('--' + rel);
    }
    lines.push('Content-Type: text/html; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(wrap76(b64Utf8(m.html || '')));
    imgs.forEach(function (im) {
      lines.push('--' + rel);
      lines.push('Content-Type: ' + (im.mime === 'image/png' ? 'image/png' : 'image/jpeg'));
      lines.push('Content-Transfer-Encoding: base64');
      lines.push('Content-ID: <' + im.cid + '>');
      lines.push('Content-Disposition: inline; filename="' + im.cid + (im.mime === 'image/png' ? '.png' : '.jpg') + '"');
      lines.push('');
      lines.push(wrap76(String(im.data).replace(/\s+/g, '')));
    });
    if (imgs.length) lines.push('--' + rel + '--');
    lines.push('--' + alt + '--');
    lines.push('');
    return lines.join(CRLF);
  }

  /* Gmail's own compose window in the sender's account (the fallback when
     the Gmail API cannot be used). A body too long for a link goes to the
     clipboard instead, and the addresses always arrive. */
  function composePlan(m) {
    m = m || {};
    var enc = function (s) { return encodeURIComponent(String(s == null ? '' : s)); };
    var build = function (body) {
      var q = ['view=cm', 'fs=1'];
      if (m.account) q.push('authuser=' + enc(m.account));
      if (m.to && m.to.length) q.push('to=' + enc([].concat(m.to).join(',')));
      if (m.bcc && m.bcc.length) q.push('bcc=' + enc([].concat(m.bcc).join(',')));
      if (m.subject) q.push('su=' + enc(m.subject));
      if (body) q.push('body=' + enc(body));
      return 'https://mail.google.com/mail/?' + q.join('&');
    };
    var full = build(m.body);
    if (full.length <= GMAIL_URL_MAX) return { url: full, copyBody: false };
    var bare = build('');
    if (bare.length <= GMAIL_URL_MAX) return { url: bare, copyBody: true };
    return { url: '', copyBody: true, tooMany: true };
  }

  /* ---------------- Claude ---------------- */

  /* The Messages API request the glue sends (browser, the admin's own key).
     Adaptive thinking; effort set explicitly (Opus 5.5 defaults to medium);
     no temperature (refused on these models); no assistant prefill. */
  function claudeRequest(o) {
    o = o || {};
    var model = MODELS.some(function (m) { return m.id === o.model; }) ? o.model : DEFAULT_MODEL;
    var content = [];
    (o.images || []).forEach(function (img) {
      if (!img || !img.data) return;
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType || 'image/jpeg', data: img.data } });
    });
    content.push({ type: 'text', text: String(o.user || '') });
    var body = {
      model: model,
      max_tokens: Math.max(1024, Math.min(32000, o.maxTokens || 16000)),
      thinking: { type: 'adaptive' },
      output_config: { effort: o.effort || 'medium' },
      system: String(o.system || ''),
      messages: [{ role: 'user', content: content }]
    };
    if (o.fallbacks !== false) body.fallbacks = 'default';
    return body;
  }

  /* The reply's text, or a thrown error that says why. */
  function claudeText(data) {
    if (!data || typeof data !== 'object') throw new Error('Claude sent no answer.');
    if (data.stop_reason === 'refusal') throw new Error('Claude declined this one' + (data.stop_details && data.stop_details.category ? ' (' + data.stop_details.category + ')' : '') + '.');
    var text = (Array.isArray(data.content) ? data.content : []).filter(function (b) { return b && b.type === 'text'; })
      .map(function (b) { return b.text || ''; }).join('').trim();
    if (!text) throw new Error(data.stop_reason === 'max_tokens' ? 'Claude ran out of room before finishing.' : 'Claude sent no answer.');
    return text;
  }

  function modelLabel(id) {
    var m = MODELS.filter(function (x) { return x.id === id; })[0];
    return m ? m.label : String(id || '');
  }

  var pure = {
    VERSION: VERSION, SENDER: SENDER, CENTRE: CENTRE, TEACHER: TEACHER, LIMITS: LIMITS, MODELS: MODELS, DEFAULT_MODEL: DEFAULT_MODEL,
    AFTER_LESSON_MS: AFTER_LESSON_MS, OPEN_WAIT_MS: OPEN_WAIT_MS, GMAIL_URL_MAX: GMAIL_URL_MAX, SYSTEM: SYSTEM, IMG_PREFIX: IMG_PREFIX,
    dayKey: dayKey, validDay: validDay, validDocId: validDocId, weekdayOf: weekdayOf, dayLabel: dayLabel,
    cleanText: cleanText, oneLine: oneLine, escapeHtml: escapeHtml, stripTags: stripTags, normEmail: normEmail, parseEmails: parseEmails,
    cleanParentEmails: cleanParentEmails, fingerprint: fingerprint, clock: clock,
    lessonsOf: lessonsOf, lessonsOnDay: lessonsOnDay, lessonDays: lessonDays, transcriptOf: transcriptOf, transcriptShares: transcriptShares,
    normUrl: normUrl, linkKey: linkKey, extractUrls: extractUrls, reconcileLinks: reconcileLinks,
    buildPrompt: buildPrompt, parseReply: parseReply, cleanSummary: cleanSummary, summariesOf: summariesOf, sentAt: sentAt,
    plan: plan, questionMarks: questionMarks, questionBand: questionBand, imagePath: imagePath, validImageUrl: validImageUrl,
    subjectOk: subjectOk, recipientsFor: recipientsFor, mergeRecipients: mergeRecipients,
    subjectLine: subjectLine, emailHtml: emailHtml, emailText: emailText,
    encodeHeader: encodeHeader, b64Utf8: b64Utf8, b64url: b64url, mimeMessage: mimeMessage, composePlan: composePlan,
    claudeRequest: claudeRequest, claudeText: claudeText, modelLabel: modelLabel
  };

  /* =================================================================
     THE REVIEW WINDOW — create(env)
     env: {
       teacher(), toast(msg, ms),
       worksheet() → {docId, name, level, subject, subjectWord},
       days() → [{day, lessons, summary|null}] newest first,
       generate(day, say) → Promise<summary>,
       save(day, summary) → Promise,
       students() → Promise<[{uid, p}]>,
       saveParents(uid, emails) → Promise,
       sendGmail({summary, bcc, subject, opts}, say) → Promise<{from}>,
       authorizeGmail() → Promise (opens Google's window; call inside a tap), gmailReady() → bool,
       recordSend(day, send) → Promise,
       settings() → {auto, captions, model, hasKey},
       setSettings(patch), setClaudeKey(key) → Promise,
       copy(text, html) → Promise<boolean>,
       openUrl(url)
     }
     ================================================================= */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function btn(text, cls, title) {
    var b = el('button', 'btn ' + (cls || ''), text);
    b.type = 'button';
    if (title) b.title = title;
    return b;
  }

  function create(env) {
    var state = { open: false, day: '', summary: null, dirty: false, busy: false, rows: [], ticked: {}, extra: '', showAll: false, seq: 0, tab: 'summary' };
    var back = null, card = null, body = null, head = null;

    function teacher() { return !!(env && env.teacher && env.teacher()); }
    function toast(m, ms) { if (env && env.toast) env.toast(m, ms); }

    function build() {
      if (back) return;
      back = el('div', 'csBack');
      back.id = 'classSummary';
      back.setAttribute('role', 'dialog');
      back.setAttribute('aria-modal', 'true');
      back.setAttribute('aria-label', 'Class summary for parents');
      back.hidden = true;
      card = el('div', 'csCard');
      head = el('div', 'csHead');
      body = el('div', 'csBody');
      card.appendChild(head);
      card.appendChild(body);
      back.appendChild(card);
      document.body.appendChild(back);
      // Every key pressed in the window stops here, or one-letter tool shortcuts fire mid-typing.
      ['keydown', 'keyup', 'keypress'].forEach(function (t) {
        back.addEventListener(t, function (e) {
          e.stopPropagation();
          if (t === 'keydown' && e.key === 'Escape') { e.preventDefault(); close(); }
        });
      });
      back.addEventListener('pointerdown', function (e) { if (e.target === back) close(); });
      card.setAttribute('tabindex', '-1');
      // A redraw can drop the focus back onto the page; Escape must still close the window then.
      document.addEventListener('keydown', function (e) {
        if (!state.open || e.key !== 'Escape' || back.contains(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        close();
      }, true);
    }

    function close() {
      if (!back || back.hidden) return;
      if (state.dirty && !window.confirm('Close without saving your edits to this summary?')) return;
      back.hidden = true;
      state.open = false;
      state.dirty = false;
      state.seq++;
    }

    function open(day) {
      if (!teacher()) { toast('Only the teacher can open class summaries.'); return; }
      build();
      state.open = true;
      state.seq++;
      back.hidden = false;
      var days = env.days() || [];
      state.day = validDay(day) ? day : (days[0] && days[0].day) || dayKey(Date.now());
      load();
      loadStudents();
      try { card.focus({ preventScroll: true }); } catch (e) { /* focus is a nicety */ }
    }

    function currentEntry() {
      return (env.days() || []).filter(function (d) { return d.day === state.day; })[0] || { day: state.day, lessons: 0, summary: null };
    }

    function load() {
      var entry = currentEntry();
      state.summary = entry.summary ? JSON.parse(JSON.stringify(entry.summary)) : null;
      state.dirty = false;
      render();
    }

    function loadStudents() {
      var seq = state.seq;
      if (!env.students) return;
      Promise.resolve(env.students()).then(function (rows) {
        if (seq !== state.seq || !state.open) return;
        var ws = env.worksheet() || {};
        state.rows = recipientsFor(rows, { level: ws.level, subject: ws.subject, weekday: weekdayOf(state.day) });
        state.ticked = {};
        state.rows.forEach(function (r) { if (r.inClass && r.parents.length) state.ticked[r.uid] = true; });
        if (state.tab === 'send') render();
        else renderSendCount();
      }).catch(function (e) {
        state.rows = [];
        if (state.tab === 'send') render();
        console.warn('Class summary: the roster could not be read', e);
      });
    }

    function markDirty() { state.dirty = true; if (state.summary) state.summary.edited = true; paintSaveState(); }

    function paintSaveState() {
      var b = card && card.querySelector('[data-cs="save"]');
      if (b) { b.disabled = !state.dirty || state.busy; b.textContent = state.dirty ? '💾 Save edits' : '✓ Saved'; }
    }

    function renderSendCount() {
      var n = card && card.querySelector('[data-cs="sendcount"]');
      if (n) n.textContent = String(mergeRecipients(state.rows, state.ticked, state.extra, SENDER).length);
    }

    function renderHead() {
      head.textContent = '';
      var ws = env.worksheet() || {};
      var titleRow = el('div', 'csTitleRow');
      titleRow.appendChild(el('div', 'csTitle', '🧾 Class summary for parents'));
      var x = btn('✕', 'csClose', 'Close (Esc)');
      x.setAttribute('aria-label', 'Close');
      x.addEventListener('click', close);
      titleRow.appendChild(x);
      head.appendChild(titleRow);
      var sub = el('div', 'csSub', [ws.level, ws.subjectWord, ws.name].filter(Boolean).join(' · ') || 'This worksheet');
      head.appendChild(sub);
      var bar = el('div', 'csDayBar');
      var sel = el('select', 'csDaySel');
      sel.setAttribute('aria-label', 'Class day');
      var days = (env.days() || []).slice();
      if (!days.some(function (d) { return d.day === state.day; })) days.unshift({ day: state.day, lessons: 0, summary: null });
      days.forEach(function (d) {
        var o = el('option', null, dayLabel(d.day) + ' — ' + (d.lessons ? d.lessons + (d.lessons === 1 ? ' recording' : ' recordings') : 'no recordings') +
          (d.summary ? (sentAt(d.summary) ? ' · sent' : ' · summary ready') : ''));
        o.value = d.day;
        if (d.day === state.day) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () {
        if (state.dirty && !window.confirm('Switch day without saving your edits?')) { sel.value = state.day; return; }
        state.day = sel.value;
        load();
        loadStudents();
      });
      bar.appendChild(sel);
      var tabs = el('div', 'csTabs');
      tabs.setAttribute('role', 'tablist');
      [['summary', '📝 Summary'], ['preview', '👁 Email preview'], ['send', '✉ Send to parents'], ['settings', '⚙ Settings']].forEach(function (t) {
        var b = btn(t[1], 'csTab' + (state.tab === t[0] ? ' on' : ''));
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', state.tab === t[0] ? 'true' : 'false');
        b.addEventListener('click', function () { state.tab = t[0]; render(); });
        tabs.appendChild(b);
      });
      bar.appendChild(tabs);
      head.appendChild(bar);
    }

    function render() {
      if (!back) return;
      renderHead();
      body.textContent = '';
      if (state.tab === 'settings') renderSettings();
      else if (!state.summary) renderEmpty();
      else if (state.tab === 'preview') renderPreview();
      else if (state.tab === 'send') renderSend();
      else renderSummary();
    }

    function statusLine(text, cls) { var d = el('div', 'csStatus ' + (cls || ''), text); d.setAttribute('aria-live', 'polite'); return d; }

    function generate() {
      if (!teacher() || state.busy) return;
      if (state.summary && (state.summary.edited || sentAt(state.summary)) &&
          !window.confirm(sentAt(state.summary) ? 'This summary was already sent. Write a new one anyway? (Nothing is emailed.)' : 'Replace your edited summary with a fresh one?')) return;
      state.busy = true;
      var seq = state.seq, day = state.day;
      var st = body.querySelector('.csStatus') || body.insertBefore(statusLine(''), body.firstChild);
      var say = function (m) { if (seq === state.seq) st.textContent = m; };
      say('Starting…');
      Promise.resolve(env.generate(day, say)).then(function (s) {
        state.busy = false;
        if (seq !== state.seq || day !== state.day) return;
        state.summary = s ? JSON.parse(JSON.stringify(s)) : null;
        state.dirty = false;
        state.tab = 'summary';
        render();
        if (s) toast('🧾 The class summary is ready to review. Nothing has been emailed.', 5200);
      }).catch(function (e) {
        state.busy = false;
        if (seq !== state.seq) return;
        st.className = 'csStatus csErr';
        st.textContent = 'The summary could not be written: ' + ((e && e.message) || e);
      });
    }

    function renderEmpty() {
      var entry = currentEntry();
      var box = el('div', 'csEmpty');
      box.appendChild(el('div', 'csEmptyIcon', '🧾'));
      box.appendChild(el('p', null, entry.lessons
        ? 'There ' + (entry.lessons === 1 ? 'is 1 recording' : 'are ' + entry.lessons + ' recordings') + ' from ' + dayLabel(state.day) +
          '. Write the summary: the key learning points, links, homework and the important questions.'
        : 'No lesson was recorded on ' + dayLabel(state.day) + '. A summary can still be written from the worksheet and your writing on it.'));
      var go = btn('✨ Write the summary', 'btnPrimary');
      go.addEventListener('click', generate);
      box.appendChild(go);
      var s = env.settings ? env.settings() : {};
      box.appendChild(el('p', 'csHint', s.hasKey ? 'Written by ' + modelLabel(s.model) + '. Nothing is emailed until you press Send.'
        : 'Add a Claude key in ⚙ Settings to write it with ' + modelLabel(s.model || DEFAULT_MODEL) + '; until then Chung GPT writes it. Nothing is emailed until you press Send.'));
      body.appendChild(box);
    }

    function field(label, value, rows, onInput, opts) {
      opts = opts || {};
      var wrap = el('label', 'csField');
      wrap.appendChild(el('span', 'csLabel', label));
      var input = rows > 1 ? el('textarea') : el('input');
      if (rows > 1) input.rows = rows; else input.type = opts.type || 'text';
      input.value = value || '';
      if (opts.placeholder) input.placeholder = opts.placeholder;
      if (opts.max) input.maxLength = opts.max;
      input.addEventListener('input', function () { onInput(input.value); markDirty(); });
      wrap.appendChild(input);
      return wrap;
    }

    function section(title, hint) {
      var sec = el('section', 'csSec');
      var h = el('h3', 'csSecTitle', title);
      sec.appendChild(h);
      if (hint) sec.appendChild(el('p', 'csHint', hint));
      return sec;
    }

    function renderSummary() {
      var s = state.summary;
      var meta = [];
      if (s.at) meta.push('Written ' + new Date(s.at).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' }));
      if (s.model || s.engine) meta.push('by ' + (modelLabel(s.model) || s.engine));
      if (s.lessons) meta.push('from ' + s.lessons + (s.lessons === 1 ? ' recording' : ' recordings'));
      if (sentAt(s)) meta.push('emailed ' + new Date(sentAt(s)).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' }));
      if (s.edited) meta.push('edited by you');
      body.appendChild(statusLine(meta.join(' · ')));

      var actions = el('div', 'csActions');
      var regen = btn('↻ Write again', '', 'Read the class again and write a fresh summary (nothing is emailed)');
      regen.addEventListener('click', generate);
      var save = btn('✓ Saved', 'btnPrimary');
      save.setAttribute('data-cs', 'save');
      save.disabled = true;
      save.addEventListener('click', saveNow);
      var next = btn('Next: preview →');
      next.addEventListener('click', function () { state.tab = 'preview'; render(); });
      actions.appendChild(regen); actions.appendChild(save); actions.appendChild(next);
      body.appendChild(actions);

      var top = section('Title and overview');
      top.appendChild(field('Title', s.title, 1, function (v) { s.title = v; }, { max: LIMITS.title }));
      top.appendChild(field('Overview for parents', s.overview, 4, function (v) { s.overview = v; }, { max: LIMITS.overview }));
      body.appendChild(top);

      var pts = section('Key learning points', 'One point per line.');
      pts.appendChild(field('Points', (s.points || []).join('\n'), Math.max(4, (s.points || []).length + 1), function (v) {
        s.points = v.split('\n').map(function (x) { return x.replace(/^\s*[-•*]\s*/, '').trim(); }).filter(Boolean).slice(0, LIMITS.points);
      }));
      body.appendChild(pts);

      var hw = section('Homework', 'One task per line. Add the due day after " | ", e.g. "Workbook p. 12–13 | Wednesday". Leave empty when none was set.');
      hw.appendChild(field('Homework', (s.homework || []).map(function (h) { return h.task + (h.due ? ' | ' + h.due : ''); }).join('\n'),
        Math.max(3, (s.homework || []).length + 1), function (v) {
          s.homework = v.split('\n').map(function (line) {
            var parts = line.split('|');
            var task = parts[0].replace(/^\s*[-•*]\s*/, '').trim();
            return task ? { task: task.slice(0, LIMITS.homeworkText), due: (parts.slice(1).join('|') || '').trim().slice(0, LIMITS.due) } : null;
          }).filter(Boolean).slice(0, LIMITS.homework);
        }, { placeholder: 'No homework' }));
      body.appendChild(hw);

      body.appendChild(renderLinks(s));
      body.appendChild(renderQuestions(s));

      var pn = section('How parents can help');
      pn.appendChild(field('Note', s.parentNote, 3, function (v) { s.parentNote = v; }, { max: LIMITS.parentNote }));
      body.appendChild(pn);
    }

    function renderLinks(s) {
      var sec = section('Links', 'Links marked ⚠ were only heard in the recording: check the address before sending, or remove them. They are left out of the email until checked.');
      var list = el('div', 'csLinks');
      function draw() {
        list.textContent = '';
        (s.links || []).forEach(function (l, i) {
          var row = el('div', 'csLinkRow' + (l.check ? ' csCheck' : ''));
          var lab = el('input', 'csLinkLabel'); lab.value = l.label || ''; lab.placeholder = 'What it is'; lab.maxLength = LIMITS.linkLabel;
          var url = el('input', 'csLinkUrl'); url.value = l.url || ''; url.placeholder = 'https://…'; url.type = 'url';
          lab.addEventListener('input', function () { l.label = lab.value; markDirty(); });
          url.addEventListener('input', function () { l.url = url.value.trim(); markDirty(); });
          row.appendChild(lab); row.appendChild(url);
          if (l.check) {
            var ok = btn('✓ Checked', 'csSmall', 'The address is right — include it in the email');
            ok.addEventListener('click', function () {
              var n = normUrl(url.value);
              if (!n) { toast('Type the full address first (https://…).'); url.focus(); return; }
              l.url = n; l.check = false; l.heard = false; markDirty(); draw();
            });
            row.appendChild(ok);
          }
          var rm = btn('✕', 'csSmall', 'Remove this link');
          rm.setAttribute('aria-label', 'Remove link');
          rm.addEventListener('click', function () { s.links.splice(i, 1); markDirty(); draw(); });
          row.appendChild(rm);
          list.appendChild(row);
        });
        if (!(s.links || []).length) list.appendChild(el('p', 'csHint', 'No links for this class.'));
      }
      draw();
      sec.appendChild(list);
      var add = btn('＋ Add a link', 'csSmall');
      add.addEventListener('click', function () {
        s.links = s.links || [];
        if (s.links.length >= LIMITS.links) return;
        s.links.push({ label: '', url: '', heard: false, check: true });
        markDirty(); draw();
      });
      sec.appendChild(add);
      return sec;
    }

    function renderQuestions(s) {
      var sec = section('Important questions', 'Ticked questions go into the email with their picture from the worksheet.');
      var ans = el('label', 'csCheckRow');
      var ansBox = el('input'); ansBox.type = 'checkbox'; ansBox.checked = !!s.includeAnswers;
      ansBox.addEventListener('change', function () { s.includeAnswers = ansBox.checked; markDirty(); });
      ans.appendChild(ansBox); ans.appendChild(el('span', null, 'Include the answers in the email'));
      sec.appendChild(ans);
      (s.questions || []).forEach(function (q) {
        var qc = el('div', 'csQ' + (q.include === false ? ' off' : ''));
        var top = el('div', 'csQTop');
        var inc = el('input'); inc.type = 'checkbox'; inc.checked = q.include !== false;
        inc.setAttribute('aria-label', 'Include ' + (q.ref || 'this question'));
        inc.addEventListener('change', function () { q.include = inc.checked; qc.classList.toggle('off', !inc.checked); markDirty(); });
        top.appendChild(inc);
        top.appendChild(el('strong', null, (q.ref || 'Question') + (q.page ? ' · page ' + q.page : '')));
        qc.appendChild(top);
        if (q.img) {
          var im = el('img', 'csQImg');
          im.alt = q.ref || 'Question';
          im.loading = 'lazy';
          im.src = q.img;
          qc.appendChild(im);
        } else qc.appendChild(el('p', 'csHint', 'No picture: the question number was not found on the page. The words below go in the email.'));
        qc.appendChild(field('Question', q.text, 3, function (v) { q.text = v; }, { max: LIMITS.questionText }));
        qc.appendChild(field('Why it matters', q.why, 1, function (v) { q.why = v; }, { max: LIMITS.why }));
        qc.appendChild(field('Answer', q.answer, 2, function (v) { q.answer = v; }, { max: LIMITS.answer }));
        sec.appendChild(qc);
      });
      if (!(s.questions || []).length) sec.appendChild(el('p', 'csHint', 'No questions were picked for this class.'));
      return sec;
    }

    function cleaned() {
      return cleanSummary(state.summary, { day: state.day });
    }

    function saveNow() {
      if (!teacher() || !state.summary) return Promise.resolve(false);
      var s = cleaned();
      if (!s) { toast('A summary needs at least a title, an overview or a point.'); return Promise.resolve(false); }
      s.edited = true;
      var b = card.querySelector('[data-cs="save"]');
      if (b) { b.disabled = true; b.textContent = 'Saving…'; }
      return Promise.resolve(env.save(state.day, s)).then(function () {
        state.summary = JSON.parse(JSON.stringify(s));
        state.dirty = false;
        paintSaveState();
        toast('Summary saved.');
        return true;
      }).catch(function (e) {
        state.dirty = true;
        paintSaveState();
        toast('Could not save the summary: ' + ((e && e.message) || e), 6000);
        return false;
      });
    }

    function emailOpts() {
      var ws = env.worksheet() || {};
      return { worksheet: ws.name, classLine: [ws.level, ws.subjectWord].filter(Boolean).join(' '), includeAnswers: !!(state.summary && state.summary.includeAnswers) };
    }

    function renderPreview() {
      var s = cleaned();
      if (!s) { body.appendChild(el('p', 'csHint', 'Nothing to preview yet.')); return; }
      var ws = env.worksheet() || {};
      body.appendChild(statusLine('Subject: ' + subjectLine(s, { level: ws.level, subjectWord: ws.subjectWord })));
      var frame = el('iframe', 'csPreview');
      frame.setAttribute('sandbox', '');
      frame.setAttribute('title', 'Email preview');
      frame.srcdoc = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<body style="margin:0">' + emailHtml(s, Object.assign(emailOpts(), { images: 'url' })) + '</body>';
      body.appendChild(frame);
      var actions = el('div', 'csActions');
      var copy = btn('📋 Copy the email', '', 'Copy it to paste into any email (keeps the formatting where the app allows)');
      copy.addEventListener('click', function () {
        Promise.resolve(env.copy(emailText(s, Object.assign(emailOpts(), { imageLinks: true })), emailHtml(s, Object.assign(emailOpts(), { images: 'url' }))))
          .then(function (ok) { toast(ok ? 'Copied. Paste it into an email.' : 'Copying was refused by the browser.'); });
      });
      var next = btn('Next: send to parents →', 'btnPrimary');
      next.addEventListener('click', function () { state.tab = 'send'; render(); });
      actions.appendChild(copy); actions.appendChild(next);
      body.appendChild(actions);
    }

    function renderSend() {
      var s = cleaned();
      if (!s) { body.appendChild(el('p', 'csHint', 'Write the summary first.')); return; }
      var info = el('div', 'csSendInfo');
      info.appendChild(el('p', null, 'From ' + SENDER + '. Parents are put in Bcc, so no family sees another family’s address. Nothing is sent until you press Send and confirm.'));
      if (sentAt(s)) info.appendChild(el('p', 'csWarn', 'Already emailed on ' + new Date(sentAt(s)).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' }) +
        ' to ' + s.sends[s.sends.length - 1].count + ' address' + (s.sends[s.sends.length - 1].count === 1 ? '' : 'es') + '.'));
      var unchecked = (s.links || []).filter(function (l) { return l.check; }).length;
      if (unchecked) info.appendChild(el('p', 'csWarn', unchecked + ' heard link' + (unchecked === 1 ? ' is' : 's are') + ' not checked yet and will be left out.'));
      body.appendChild(info);

      var sec = section('Parents', 'Tick the families to email. Type or correct a parent’s address in the box on their row — it is kept on the student’s record for next time.');
      var tools = el('div', 'csRosterTools');
      var all = el('label', 'csCheckRow');
      var allBox = el('input'); allBox.type = 'checkbox'; allBox.checked = state.showAll;
      allBox.addEventListener('change', function () { state.showAll = allBox.checked; render(); });
      all.appendChild(allBox); all.appendChild(el('span', null, 'Show students not in this class day'));
      tools.appendChild(all);
      var tickAll = btn('Tick all with an address', 'csSmall');
      tickAll.addEventListener('click', function () {
        state.rows.forEach(function (r) { if (r.parents.length && (state.showAll || r.inClass)) state.ticked[r.uid] = true; });
        render();
      });
      var none = btn('Untick all', 'csSmall');
      none.addEventListener('click', function () { state.ticked = {}; render(); });
      tools.appendChild(tickAll); tools.appendChild(none);
      sec.appendChild(tools);

      var list = el('div', 'csRoster');
      var rows = state.rows.filter(function (r) { return state.showAll || r.inClass; });
      if (!state.rows.length) list.appendChild(el('p', 'csHint', 'Loading the students… (or none match this worksheet’s level and subject).'));
      rows.forEach(function (r) {
        var row = el('div', 'csRosterRow');
        var tick = el('input'); tick.type = 'checkbox';
        tick.checked = !!state.ticked[r.uid];
        tick.disabled = !r.parents.length;
        tick.setAttribute('aria-label', 'Email ' + r.name + '’s parents');
        tick.addEventListener('change', function () { if (tick.checked) state.ticked[r.uid] = true; else delete state.ticked[r.uid]; renderSendCount(); });
        row.appendChild(tick);
        var who = el('div', 'csWho');
        who.appendChild(el('div', 'csWhoName', r.name + (r.inClass ? '' : ' (another day)')));
        var mail = el('input', 'csParentInput');
        mail.type = 'text';
        mail.placeholder = 'parent@example.com, second parent…';
        mail.value = r.parents.join(', ');
        mail.setAttribute('aria-label', r.name + '’s parent emails');
        var saveP = btn('Save', 'csSmall');
        saveP.hidden = true;
        mail.addEventListener('input', function () { saveP.hidden = false; });
        saveP.addEventListener('click', function () {
          var list2 = cleanParentEmails(mail.value);
          saveP.disabled = true;
          Promise.resolve(env.saveParents(r.uid, list2)).then(function () {
            r.parents = list2;
            mail.value = list2.join(', ');
            saveP.hidden = true; saveP.disabled = false;
            tick.disabled = !list2.length;
            if (list2.length) { state.ticked[r.uid] = true; tick.checked = true; } else { delete state.ticked[r.uid]; tick.checked = false; }
            renderSendCount();
            toast(list2.length ? 'Saved ' + r.name + '’s parent email.' : 'Removed ' + r.name + '’s parent email.');
          }).catch(function (e) { saveP.disabled = false; toast('Could not save: ' + ((e && e.message) || e)); });
        });
        mail.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); saveP.click(); } });
        var line = el('div', 'csParentLine');
        line.appendChild(mail); line.appendChild(saveP);
        who.appendChild(line);
        row.appendChild(who);
        list.appendChild(row);
      });
      sec.appendChild(list);
      // Not `field`: typing an address is not an edit of the summary.
      var extraWrap = el('label', 'csField');
      extraWrap.appendChild(el('span', 'csLabel', 'Other addresses (optional)'));
      var extra = el('textarea');
      extra.rows = 2;
      extra.placeholder = 'Anyone else, separated by commas';
      extra.value = state.extra;
      extra.addEventListener('input', function () { state.extra = extra.value; renderSendCount(); });
      extraWrap.appendChild(extra);
      sec.appendChild(extraWrap);
      body.appendChild(sec);

      var go = el('div', 'csSendBar');
      var count = el('span', 'csCount');
      count.appendChild(document.createTextNode('Recipients: '));
      var n = el('strong', null, '0'); n.setAttribute('data-cs', 'sendcount');
      count.appendChild(n);
      go.appendChild(count);
      var send = btn('✉ Send from ' + SENDER, 'btnPrimary', 'Sends now through Gmail, from the centre’s account (you sign in to it once)');
      send.addEventListener('click', function () { sendNow('gmail-api'); });
      var compose = btn('Open in Gmail instead', '', 'Opens a Gmail draft in the centre’s account with the addresses and text filled in; you press Send there');
      compose.addEventListener('click', function () { sendNow('compose'); });
      if (env.gmailReady && !env.gmailReady() && env.authorizeGmail) {
        var signIn = btn('🔑 Sign in as ' + SENDER, '', 'Sign in to the centre\u2019s Gmail once and allow sending; nothing is sent by signing in');
        signIn.addEventListener('click', function () {
          Promise.resolve(env.authorizeGmail()).then(function () { toast('Signed in as ' + SENDER + '. Press Send when you are ready.'); render(); })
            .catch(function (e) { toast('Gmail sign-in did not finish: ' + ((e && e.message) || e), 7000); });
        });
        go.appendChild(signIn);
      }
      go.appendChild(send); go.appendChild(compose);
      body.appendChild(go);
      renderSendCount();
    }

    function sendNow(via) {
      if (!teacher() || state.busy) return;
      var s = cleaned();
      if (!s) return;
      var bcc = mergeRecipients(state.rows, state.ticked, state.extra, SENDER);
      if (!bcc.length) { toast('Tick at least one family with a parent email, or type an address.'); return; }
      var ws = env.worksheet() || {};
      var subject = subjectLine(s, { level: ws.level, subjectWord: ws.subjectWord });
      var again = sentAt(s) ? '\n\nThis summary was ALREADY emailed once.' : '';
      if (!window.confirm('Email "' + subject + '" to ' + bcc.length + ' address' + (bcc.length === 1 ? '' : 'es') + ' (in Bcc) from ' + SENDER + '?' + again)) return;
      // The Google window must open inside the tap, before anything waits.
      var authorized = via === 'gmail-api' && env.authorizeGmail ? env.authorizeGmail() : null;
      if (authorized && authorized.catch) authorized.catch(function () {});
      var pending = state.dirty ? saveNow() : Promise.resolve(true);
      state.busy = true;
      var seq = state.seq, day = state.day;
      var st = statusLine('Preparing the email…');
      body.insertBefore(st, body.firstChild);
      var say = function (m) { if (seq === state.seq) st.textContent = m; };
      pending.then(function (saved) {
        if (saved === false) throw new Error('Save the summary first.');
        var opts = emailOpts();
        if (via === 'compose') {
          var plan2 = composePlan({ account: SENDER, to: [SENDER], bcc: bcc, subject: subject, body: emailText(s, Object.assign({}, opts, { imageLinks: true })) });
          return Promise.resolve(plan2.copyBody ? env.copy(emailText(s, Object.assign({}, opts, { imageLinks: true })), emailHtml(s, Object.assign({}, opts, { images: 'url' }))) : true).then(function () {
            if (plan2.url) env.openUrl(plan2.url);
            if (plan2.tooMany) throw new Error('Too many addresses for a Gmail link — use Send instead.');
            if (plan2.copyBody) toast('The email is on the clipboard: paste it into the Gmail draft.', 7000);
            return { via: 'compose', from: SENDER };
          });
        }
        return Promise.resolve(authorized).then(function () {
          return env.sendGmail({ summary: s, bcc: bcc, subject: subject, opts: opts }, say);
        }).then(function (r) { return { via: 'gmail-api', from: (r && r.from) || SENDER }; });
      }).then(function (r) {
        var send = { at: Date.now(), count: bcc.length, via: r.via, from: r.from };
        return Promise.resolve(env.recordSend(day, send)).catch(function () {}).then(function () {
          state.busy = false;
          if (seq !== state.seq) return;
          state.summary.sends = (state.summary.sends || []).concat([send]);
          st.textContent = r.via === 'compose' ? 'Opened in Gmail. Press Send there.' : 'Sent to ' + bcc.length + ' address' + (bcc.length === 1 ? '' : 'es') + '.';
          st.className = 'csStatus csOk';
          toast(r.via === 'compose' ? 'The Gmail draft is open — press Send there.' : '✉ The class summary was emailed to ' + bcc.length + (bcc.length === 1 ? ' parent.' : ' parents.'), 6000);
        });
      }).catch(function (e) {
        state.busy = false;
        if (seq !== state.seq) return;
        st.className = 'csStatus csErr';
        st.textContent = 'Not sent: ' + ((e && e.message) || e);
      });
    }

    function renderSettings() {
      var s = env.settings ? env.settings() : {};
      var sec = section('Writing the summary');
      var auto = el('label', 'csCheckRow');
      var autoBox = el('input'); autoBox.type = 'checkbox'; autoBox.checked = s.auto !== false;
      autoBox.addEventListener('change', function () { env.setSettings({ auto: autoBox.checked }); });
      auto.appendChild(autoBox); auto.appendChild(el('span', null, 'Write the summary by itself after each class (a couple of minutes after the last recording is saved). It is never emailed by itself.'));
      sec.appendChild(auto);
      var cap = el('label', 'csCheckRow');
      var capBox = el('input'); capBox.type = 'checkbox'; capBox.checked = s.captions !== false;
      capBox.addEventListener('change', function () { env.setSettings({ captions: capBox.checked }); });
      cap.appendChild(capBox); cap.appendChild(el('span', null, 'Make captions for recordings that have none (uses the ChatGPT key) so the summary hears what was said, including homework and links.'));
      sec.appendChild(cap);
      body.appendChild(sec);

      var ai = section('The model', 'Summaries are written by Claude with your Anthropic API key, kept in your own settings like the ChatGPT key. Without a key, or if Claude fails, Chung GPT writes it.');
      var sel = el('select', 'csModelSel');
      sel.setAttribute('aria-label', 'Claude model');
      MODELS.forEach(function (m) {
        var o = el('option', null, m.label + ' — ' + m.note); o.value = m.id;
        if (m.id === (s.model || DEFAULT_MODEL)) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () { env.setSettings({ model: sel.value }); });
      ai.appendChild(sel);
      var keyWrap = el('div', 'csKeyRow');
      var key = el('input', 'csKey'); key.type = 'password'; key.autocomplete = 'off';
      key.placeholder = s.hasKey ? 'A key is saved — paste a new one to replace it' : 'sk-ant-…';
      key.setAttribute('aria-label', 'Anthropic API key');
      var saveKey = btn(s.hasKey ? 'Replace key' : 'Save key', 'btnPrimary');
      saveKey.addEventListener('click', function () {
        var v = key.value.trim();
        if (v && !/^sk-ant-/.test(v)) { toast('That does not look like an Anthropic key (sk-ant-…).'); return; }
        Promise.resolve(env.setClaudeKey(v)).then(function () { key.value = ''; toast(v ? 'Claude key saved.' : 'Claude key removed.'); render(); })
          .catch(function (e) { toast('Could not save the key: ' + ((e && e.message) || e)); });
      });
      keyWrap.appendChild(key); keyWrap.appendChild(saveKey);
      if (s.hasKey) {
        var rm = btn('Remove key', 'csSmall');
        rm.addEventListener('click', function () {
          if (!window.confirm('Remove the Claude key from this account?')) return;
          Promise.resolve(env.setClaudeKey('')).then(function () { toast('Claude key removed.'); render(); });
        });
        keyWrap.appendChild(rm);
      }
      ai.appendChild(keyWrap);
      body.appendChild(ai);

      var mail = section('Sending', 'Send uses Gmail from ' + SENDER + ': the first time, a Google window asks you to sign in to that account and allow sending. If that is refused, "Open in Gmail instead" opens a draft in that account.');
      body.appendChild(mail);
    }

    function isOpen() { return !!(back && !back.hidden); }

    function roleChanged() { if (!teacher() && isOpen()) { state.dirty = false; close(); } }

    function refresh() { if (isOpen() && !state.dirty && !state.busy) load(); }

    return { open: open, close: close, isOpen: isOpen, roleChanged: roleChanged, refresh: refresh, state: function () { return state; } };
  }

  var api = { pure: pure, create: create };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ClassSummary = api;
})(typeof window !== 'undefined' ? window : this);
