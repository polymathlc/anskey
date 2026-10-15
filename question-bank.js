/* =====================================================================
   📚 QUESTION BANK — questions from the Science portal (polymathlc/cer)
   put onto a worksheet here, with their interactive apps.
   ---------------------------------------------------------------------
   The teacher opens 📚 Question bank. A picker lists the questions in the
   portal's bank (`users/{adminUid}/questions`, the same documents the
   portal's own practice reads). Nothing about a question shows until it is
   PICKED: then the preview pane draws it, and ➕ Add to page puts it on the
   page in view.

   ON THE PAGE A QUESTION IS A PICTURE OF ITSELF, AND NOTHING ELSE.
   It is painted onto a canvas here (`paintQuestion`) and lands as an
   ordinary pasted picture (`kind: 'paste'`) that also carries the question
   itself on `a.bq`. That is the whole trick, the same one the mindmap and
   the pasted picture play: the annotation is a kind the app already knows,
   so it moves, resizes, locks, erases around, undoes, saves, thumbnails and
   PRINTS without a single new branch in any of those nine places. There is
   no window round it, no heading and no badge — the page shows the
   question, the way a printed question looks.

   THE SIGN IS ON SELECTING IT. Tapped with Select, the picture's own bar
   offers ▶ Open and 🧩 Show app beside 🔒 Lock and ✕ Remove. A student or a
   share-link visitor taps the question (with anything but a drawing tool in
   hand) and the WINDOW opens: the question in full, answerable — options
   to choose, blanks to fill, boxes to write in — ✓ Check marks what can be
   marked and reveals the model answer and the explanation, and 🧩 Show app
   opens the question's own interactive app beside it.

   THE APP RUNS EXACTLY AS THE PORTAL RUNS IT: through `QuestionApps.frame`
   (question-apps.js, byte-identical to the portal's), an opaque-origin
   sandboxed iframe with an enforced CSP in its srcdoc. Its HTML is never
   put into this page.

   THE QUESTION'S OWN HTML IS SANITISED before it is shown (`sanitizeHtml`)
   — a whitelist of tags and attributes, no script, no handler, no
   javascript: link. It was written in the portal by the teacher, and it is
   still not allowed to run here.

   🖨 THE QR CODE. With "QR code on page 1" switched on, a print (and the
   download) carries a QR code in the top corner of the first page. It is
   the worksheet's share link, so a student scans it and lands in Ans Key
   on this worksheet, with every question and app on it. `drawQrOnPdf`
   draws it as vector squares — it stays sharp however the sheet is
   scaled — and adds a real PDF link over it for the digital copy.

   Pure helpers are on `QuestionBank.pure` for tools/question-bank-tests.mjs;
   tools/question-bank-check.mjs drives the real page in Chromium.
   ===================================================================== */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------
     Constants
     --------------------------------------------------------------- */
  var PIC_W = 600;            // CSS px the question picture is laid out at
  var PIC_SCALE = 2;          // …and painted at, so it prints sharp
  var PIC_PAD = 14;           // white space round the question in the picture
  var PIC_MAX_H = 3600;       // CSS px — a picture taller than this is cut
  var PIC_QUALITY = 0.9;      // JPEG quality; text at 0.82 goes soft
  var BODY_PX = 15;
  var SMALL_PX = 13;
  var LINE_K = 1.42;
  var RULE_GAP = 26;          // ruled answer lines, the portal's own spacing
  var IMG_MAX_H = 380;        // CSS px — no picture in a question taller
  var IMG_TIMEOUT_MS = 12000;
  var FAMILY = '-apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
  var INK = '#1d1d1f', SOFT = '#55554f', FAINT = '#9a9a94', RULE = '#cfcfca';
  var WIDGET_MAX_CHARS = 420000;   // an app bigger than this travels as its link
  var LIST_MAX = 160;              // rows the picker draws at once
  var OPEN_LINES_MAX = 12;
  var QR_PT = 64;                  // the QR code's size on paper, in points
  var QR_MARGIN_PT = 14;
  var QR_LABEL = 'Scan to open in Ans Key';
  var QR_MAX_URL = 600;

  /* ---------------------------------------------------------------
     Pure helpers — no DOM, no Firebase
     --------------------------------------------------------------- */
  function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", deg: '°', times: '×',
    divide: '÷', minus: '−', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘',
    rdquo: '”', ldquo: '“', middot: '·', sup2: '²', sup3: '³', frac12: '½', frac14: '¼', frac34: '¾',
    micro: 'µ', plusmn: '±', le: '≤', ge: '≥', ne: '≠', rarr: '→', larr: '←' };
  function decodeEntities(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, function (m, e) {
      if (e[0] === '#') {
        var n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
      }
      var k = e.toLowerCase();
      return Object.prototype.hasOwnProperty.call(ENTITIES, k) ? ENTITIES[k] : m;
    });
  }

  /* Text a person would read out of a fragment of HTML — line breaks kept
     where the markup broke the line, every tag gone. */
  function stripHtml(html) {
    var s = String(html == null ? '' : html)
      .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr|blockquote)\s*>/gi, '\n')
      .replace(/<[^>]*>/g, '');
    return decodeEntities(s).replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n').trim();
  }

  /* (a), (b)(ii) — a part is a LETTER on `part` (or the label of a legacy
     `part` block) and a roman sub-part on `subPart`, exactly as the portal
     files them. Anything that is not one of those is not shown, rather
     than shown wrongly. */
  var ROMANS = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii'];
  function partLetter(v) {
    var m = String(v == null ? '' : v).trim().toLowerCase().replace(/^\(|\)$/g, '').match(/^([a-h])$/);
    return m ? m[1] : '';
  }
  function partSub(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase().replace(/^\(|\)$/g, '');
    return ROMANS.indexOf(s) >= 0 ? s : '';
  }
  function partOpens(b) {
    if (!b) return '';
    var L = partLetter(b.part) || (b.type === 'part' ? partLetter(b.label) : '');
    var S = partSub(b.subPart);
    if (!L && !S) return '';
    return (L ? '(' + L + ')' : '') + (S ? '(' + S + ')' : '');
  }

  function marksOf(b) {
    var n = parseInt(b && b.marks, 10);
    return isFinite(n) && n > 0 && n <= 50 ? n : 0;
  }

  /* A fill-in-the-blank sentence: `[[answer]]` marks a blank. A run of
     blanks with only spaces between them is ONE blank — an author blanks a
     two-word answer one word at a time, and two rules would tell the student
     it is two answers. */
  function fbSegments(text) {
    var src = String(text == null ? '' : text);
    var out = [];
    var re = /\[\[([\s\S]+?)\]\]/g, last = 0, m;
    while ((m = re.exec(src))) {
      if (m.index > last) out.push({ type: 'text', text: src.slice(last, m.index) });
      out.push({ type: 'blank', answer: m[1].trim() });
      last = re.lastIndex;
    }
    if (last < src.length) out.push({ type: 'text', text: src.slice(last) });
    var merged = [];
    for (var i = 0; i < out.length; i++) {
      var seg = out[i];
      var prev = merged[merged.length - 1];
      var prev2 = merged[merged.length - 2];
      if (seg.type === 'blank' && prev && prev.type === 'text' && !/\S/.test(prev.text) &&
          prev2 && prev2.type === 'blank') {
        merged.pop();
        prev2.answer = (prev2.answer + ' ' + seg.answer).trim();
        continue;
      }
      if (seg.type === 'blank' && prev && prev.type === 'blank') {
        prev.answer = (prev.answer + ' ' + seg.answer).trim();
        continue;
      }
      merged.push(seg);
    }
    return merged;
  }
  function fbHasBlanks(b) { return !!(b && b.type === 'fillblank' && /\[\[[\s\S]+?\]\]/.test(b.text || '')); }

  function normAnswer(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9.\s-]/g, ' ')
      .replace(/\s+/g, ' ').trim().replace(/\.+$/, '').trim();
  }
  /* An exact match after tidying, against any of the alternatives an author
     wrote with a slash or a bar ("evaporate / evaporation"). */
  function blankCorrect(student, model) {
    var s = normAnswer(student);
    if (!s) return false;
    var alts = String(model == null ? '' : model).split(/\s*[\/|]\s*/);
    for (var i = 0; i < alts.length; i++) if (s === normAnswer(alts[i])) return true;
    return s === normAnswer(model);
  }

  /* Primary questions number their options (1)–(4); Secondary ones letter
     them (A)–(D). An explicit choice on the question wins. */
  function mcqStyle(q) {
    var own = q && q.mcqLabels;
    if (own === 'letters' || own === 'numbers') return own;
    var lvl = String((q && q.level) || '');
    if (/^\s*(s|sec)/i.test(lvl)) return 'letters';
    return 'numbers';
  }
  function mcqLabel(i, style) {
    var k = Math.max(0, i | 0);
    return style === 'letters' && k < 26 ? String.fromCharCode(65 + k) : String(k + 1);
  }
  /* An option whose whole text is the bracketed marker naming it — "(3)" on
     the third — is the option's label, drawn in the question's own style. */
  function mcqOptionText(text, i, style) {
    var raw = String(text == null ? '' : text);
    var plain = stripHtml(raw);
    var m = plain.match(/^\(\s*([1-9]|[a-h])\s*\)$/i);
    if (m) {
      var n = /\d/.test(m[1]) ? parseInt(m[1], 10) : m[1].toLowerCase().charCodeAt(0) - 96;
      if (n === (i | 0) + 1) return '(' + mcqLabel(i, style) + ')';
    }
    return raw;
  }

  /* Table data in the shape the portal saves it — an object of row objects
     for Firestore, an array of arrays in memory — always as rows of cells.
     A table saved before header rows were folded in still carries
     `headers`, and it is folded in here too. */
  function tableGrid(block) {
    var data = block && block.data;
    var rows;
    if (Array.isArray(data)) rows = data.map(function (r) { return Array.isArray(r) ? r.slice() : objRow(r); });
    else if (data && typeof data === 'object') {
      rows = Object.keys(data).sort(function (a, b) { return parseInt(a, 10) - parseInt(b, 10); })
        .map(function (k) { return Array.isArray(data[k]) ? data[k].slice() : objRow(data[k]); });
    } else rows = [];
    var cols = Math.max(block && block.cols | 0, rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0));
    var merges = Array.isArray(block && block.merges) ? block.merges.slice() : [];
    if (block && Array.isArray(block.headers) && block.headers.length) {
      rows.unshift(block.headers.slice());
      merges = merges.map(function (m) { return { sr: m.sr + 1, sc: m.sc, er: m.er + 1, ec: m.ec }; });
    }
    var nRows = Math.max(rows.length, 0);
    rows = rows.map(function (r) { while (r.length < cols) r.push(''); return r; });
    var widths = [];
    var cw = (block && block.colWidths) || [];
    for (var c = 0; c < cols; c++) {
      var w = Array.isArray(cw) ? cw[c] : cw[c] != null ? cw[c] : cw[String(c)];
      widths.push(isFinite(+w) && +w > 0 ? +w : 0);
    }
    return { rows: rows, nRows: nRows, cols: cols, merges: merges.filter(function (m) {
      return m && m.er >= m.sr && m.ec >= m.sc && m.sr >= 0 && m.sc >= 0;
    }), widths: widths, styles: (block && block.cellStyles) || {} };
    function objRow(r) {
      if (!r || typeof r !== 'object') return [];
      return Object.keys(r).sort(function (a, b) { return parseInt(a, 10) - parseInt(b, 10); })
        .map(function (k) { return r[k] == null ? '' : r[k]; });
    }
  }
  /* Where each cell sits once merges are applied: the top-left cell of a
     merge carries its spans, every cell it covers is null. */
  function tableCells(grid) {
    var out = [];
    for (var r = 0; r < grid.nRows; r++) {
      var row = [];
      for (var c = 0; c < grid.cols; c++) {
        var cell = { r: r, c: c, rs: 1, cs: 1, html: grid.rows[r][c] || '' };
        for (var k = 0; k < grid.merges.length; k++) {
          var m = grid.merges[k];
          if (r >= m.sr && r <= m.er && c >= m.sc && c <= m.ec) {
            if (r === m.sr && c === m.sc) {
              cell.rs = Math.min(m.er, grid.nRows - 1) - m.sr + 1;
              cell.cs = Math.min(m.ec, grid.cols - 1) - m.sc + 1;
            } else cell = null;
            break;
          }
        }
        row.push(cell);
      }
      out.push(row);
    }
    return out;
  }
  /* Column widths that add up to `total`: the author's own widths in
     proportion, and an equal share for a column that has none. */
  function columnWidths(grid, total) {
    var n = grid.cols || 1;
    var given = grid.widths.filter(function (w) { return w > 0; });
    var avg = given.length ? given.reduce(function (a, b) { return a + b; }, 0) / given.length : 1;
    var raw = [];
    for (var c = 0; c < n; c++) raw.push(grid.widths[c] > 0 ? grid.widths[c] : avg);
    var sum = raw.reduce(function (a, b) { return a + b; }, 0) || 1;
    return raw.map(function (w) { return total * w / sum; });
  }

  function toMillis(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch (e) { return 0; } }
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    var t = Date.parse(v);
    return isFinite(t) ? t : 0;
  }

  function widgetBlocks(q) {
    return ((q && q.blocks) || []).filter(function (b) {
      return b && b.type === 'widget' && (String(b.html || '').trim() || b.appUrl);
    });
  }
  function hasApp(q) { return widgetBlocks(q).length > 0; }
  function isMcq(q) { return ((q && q.blocks) || []).some(function (b) { return b && b.type === 'mcq' && (b.options || []).length; }); }
  function hasOpenAnswer(q) {
    return ((q && q.blocks) || []).some(function (b) {
      return b && (b.type === 'answer' || b.type === 'plainanswer' || b.type === 'answerLine');
    });
  }

  /* Everything a student would read, as one string — what search matches. */
  function questionPlain(q) {
    var bits = [];
    ((q && q.blocks) || []).forEach(function (b) {
      if (!b) return;
      if (b.type === 'text' || b.type === 'part' || b.type === 'commonMistake') bits.push(stripHtml(b.content || b.text || ''));
      else if (b.type === 'mcq') (b.options || []).forEach(function (o) { bits.push(stripHtml(o && o.text)); });
      else if (b.type === 'fillblank') bits.push(stripHtml(String(b.text || '').replace(/\[\[([\s\S]+?)\]\]/g, '____')));
    });
    return bits.join(' ').replace(/\s+/g, ' ').trim();
  }
  function questionTopics(q) {
    var out = [];
    [q && q.topic, q && q.topic2].forEach(function (t) {
      t = String(t || '').trim();
      if (t && out.indexOf(t) < 0) out.push(t);
    });
    return out;
  }
  function questionTitle(q) {
    var t = String((q && q.title) || '').trim();
    if (t) return t;
    var p = questionPlain(q);
    return p ? (p.length > 70 ? p.slice(0, 68).trim() + '…' : p) : 'Untitled question';
  }

  /* EVERY word typed must match somewhere — an OR would return half the
     bank for "states of matter", which is the same as returning nothing. */
  function searchWords(query) {
    return String(query || '').toLowerCase().split(/[^a-z0-9°]+/).filter(function (w) { return w.length > 0; });
  }
  /* The teacher searches by the answer too — "evaporates" should find the
     sentence it is the missing word of. Only the picker reads this. */
  function questionHaystack(q) {
    var answers = ((q && q.blocks) || []).map(function (b) {
      return b && b.type === 'fillblank' ? fbSegments(b.text).filter(function (x) { return x.type === 'blank'; })
        .map(function (x) { return x.answer; }).join(' ') : '';
    }).join(' ');
    return (questionTitle(q) + ' ' + questionTopics(q).join(' ') + ' ' + (q.category || '') + ' ' +
      (q.category2 || '') + ' ' + (q.level || '') + ' ' + questionPlain(q) + ' ' + answers).toLowerCase();
  }
  function filterQuestions(list, opts) {
    opts = opts || {};
    var words = searchWords(opts.query);
    var topic = String(opts.topic || '');
    var only = String(opts.only || '');
    var out = (list || []).filter(function (q) {
      if (!q || !Array.isArray(q.blocks) || !q.blocks.length) return false;
      if (topic && questionTopics(q).indexOf(topic) < 0) return false;
      if (only === 'app' && !hasApp(q)) return false;
      if (only === 'mcq' && !isMcq(q)) return false;
      if (only === 'open' && !hasOpenAnswer(q)) return false;
      if (!words.length) return true;
      var hay = q._qbHay || (q._qbHay = questionHaystack(q));
      for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) < 0) return false;
      return true;
    });
    var titleHit = function (q) {
      if (!words.length) return 0;
      var t = questionTitle(q).toLowerCase();
      return words.every(function (w) { return t.indexOf(w) >= 0; }) ? 1 : 0;
    };
    return out.sort(function (a, b) {
      return (titleHit(b) - titleHit(a)) ||
        (toMillis(b.updatedAt || b.createdAt) - toMillis(a.updatedAt || a.createdAt)) ||
        questionTitle(a).localeCompare(questionTitle(b));
    });
  }
  function allTopics(list) {
    var seen = {};
    (list || []).forEach(function (q) { questionTopics(q).forEach(function (t) { seen[t] = 1; }); });
    return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b); });
  }

  /* The question as it travels on the annotation. A COPY — the bank can be
     edited afterwards without the worksheet changing under the class — and
     a slim one: editor state stays behind, and an app too large to ride
     along inside every auto-save travels as its published link instead. */
  var KEEP_Q = ['id', 'title', 'topic', 'topic2', 'category', 'level', 'mcqLabels', 'answerKeyImage'];
  function snapshotQuestion(q, owner) {
    var out = { v: 1 };
    KEEP_Q.forEach(function (k) {
      if (q && q[k] != null && q[k] !== '') out[k] = typeof q[k] === 'object' ? JSON.parse(JSON.stringify(q[k])) : q[k];
    });
    if (owner) out.owner = String(owner);
    out.blocks = ((q && q.blocks) || []).filter(function (b) { return b && typeof b === 'object' && b.type; })
      .map(function (b) {
        var c = JSON.parse(JSON.stringify(b));
        delete c._qbHay;
        if (c.type === 'widget') {
          if (String(c.html || '').length > WIDGET_MAX_CHARS) { c.html = ''; c.tooBig = true; }
          delete c.prompt; delete c.history; delete c.messages;
        }
        if (c.type === 'table') {
          var g = tableGrid(c);
          c.data = g.rows; c.cols = g.cols; c.rows = g.nRows; c.merges = g.merges; delete c.headers;
          c.colWidths = g.widths;
        }
        return c;
      });
    out.title = questionTitle(q);
    out.at = Date.now();
    return out;
  }
  function validSnapshot(bq) {
    return !!(bq && typeof bq === 'object' && Array.isArray(bq.blocks) && bq.blocks.length);
  }

  /* Only http(s) and inline pictures are ever loaded or linked. */
  function safeUrl(u, allowData) {
    var s = String(u == null ? '' : u).trim();
    if (!s) return '';
    if (allowData && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(s)) return s;
    if (/^https?:\/\//i.test(s)) return s;
    return '';
  }
  /* Share links from Dropbox and Google Drive point at a page, not a
     picture; this is the portal's own rewrite. */
  function imageUrl(u) {
    var s = safeUrl(u, true);
    if (!s || /^data:/i.test(s) || typeof URL !== 'function') return s;
    try {
      var url = new URL(s);
      if (/dropbox\.com$/.test(url.hostname) && url.hostname !== 'dl.dropboxusercontent.com') {
        url.hostname = 'dl.dropboxusercontent.com';
        url.searchParams.delete('dl');
        return url.toString();
      }
      if (url.hostname === 'drive.google.com') {
        var m = url.pathname.match(/\/file\/d\/([^/]+)/);
        var id = m ? m[1] : url.searchParams.get('id');
        if (id) return 'https://drive.google.com/uc?export=view&id=' + id;
      }
    } catch (e) { return ''; }
    return s;
  }

  /* The picture's place on a page: as wide as reads comfortably beside the
     margin, never taller than the paper, below whatever the teacher can see
     at the top of the page. `index` steps a second question down so it
     does not land exactly on the first. All in page units. */
  function placeOnPage(pageW, pageH, ratio, index, anchorY) {
    var pw = pageW || 600, ph = pageH || 800;
    var r = Math.max(0.08, ratio || 0.6);       // width ÷ height
    var w = Math.min(pw - 48, Math.max(260, pw * 0.82));
    var h = w / r;
    var maxH = ph * 0.9;
    if (h > maxH) { h = maxH; w = h * r; }
    w = Math.max(60, Math.min(w, pw - 8));
    h = Math.max(40, Math.min(h, ph - 8));
    var step = (index || 0) % 6;
    var x = (pw - w) / 2 + step * 14;
    var y = (isFinite(anchorY) ? anchorY : ph * 0.08) + step * 14;
    x = Math.max(4, Math.min(pw - w - 4, x));
    y = Math.max(4, Math.min(ph - h - 4, y));
    return { x: round2(x), y: round2(y), w: round2(w), h: round2(h) };
  }
  function round2(n) { return Math.round(n * 100) / 100; }

  /* Where the QR code goes on the first page, in PDF points with the origin
     at the BOTTOM-left, as pdf-lib draws: the top-right corner, inside the
     margin, with room for its label underneath. */
  function qrPlacement(pageW, pageH, sizePt) {
    var size = Math.max(36, Math.min(sizePt || QR_PT, Math.min(pageW, pageH) * 0.2));
    var x = pageW - QR_MARGIN_PT - size;
    var y = pageH - QR_MARGIN_PT - size;
    return { x: round2(x), y: round2(y), size: round2(size), labelY: round2(y - 8) };
  }
  /* The QR modules as rows of booleans. Medium error correction survives a
     smudge on a photocopy; the URL is short enough for a small code. */
  function qrMatrix(text, qrcodeFn) {
    var make = qrcodeFn || root.qrcode;
    var s = String(text || '');
    if (typeof make !== 'function' || !s || s.length > QR_MAX_URL) return null;
    var qr = make(0, 'M');
    qr.addData(s, 'Byte');
    qr.make();
    var n = qr.getModuleCount();
    var rows = [];
    for (var r = 0; r < n; r++) {
      var row = [];
      for (var c = 0; c < n; c++) row.push(!!qr.isDark(r, c));
      rows.push(row);
    }
    return rows;
  }
  /* Runs of dark modules along each row, so a 33 × 33 code is a few hundred
     rectangles on paper rather than a thousand. */
  function qrRuns(matrix) {
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

  /* A score line a person reads, never a number alone. */
  function scoreLine(right, total) {
    if (!total) return '';
    if (right === total) return right === 1 ? 'Correct!' : 'All ' + total + ' correct!';
    return right + ' of ' + total + ' correct';
  }

  function parseJsonLoose(raw) {
    var s = String(raw == null ? '' : raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    try { return JSON.parse(s); } catch (e) {}
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e2) {} }
    return null;
  }

  /* ---------------------------------------------------------------
     Sanitising — a whitelist, in a parsed document that runs nothing
     --------------------------------------------------------------- */
  var ALLOWED_TAGS = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, SUP: 1, SUB: 1, BR: 1, P: 1, DIV: 1, SPAN: 1,
    UL: 1, OL: 1, LI: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, TABLE: 1, THEAD: 1, TBODY: 1, TR: 1,
    TD: 1, TH: 1, IMG: 1, A: 1, SMALL: 1, CODE: 1, PRE: 1, BLOCKQUOTE: 1, HR: 1, FONT: 1, MARK: 1, S: 1,
    COLGROUP: 1, COL: 1, FIGURE: 1, FIGCAPTION: 1 };
  var DROP_WITH_CONTENT = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, NOSCRIPT: 1, TEMPLATE: 1,
    SVG: 1, MATH: 1, FORM: 1, INPUT: 1, BUTTON: 1, SELECT: 1, TEXTAREA: 1, LINK: 1, META: 1, BASE: 1,
    FRAME: 1, FRAMESET: 1, AUDIO: 1, VIDEO: 1, SOURCE: 1, TITLE: 1 };
  function cleanStyle(css) {
    var s = String(css || '');
    if (/url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:/i.test(s)) return '';
    return s.split(';').filter(function (d) {
      return /^\s*(color|background-color|font-weight|font-style|text-decoration|text-align|vertical-align|font-size|width|height|max-width|margin(-[a-z]+)?|padding(-[a-z]+)?|border(-[a-z]+)*|display|white-space)\s*:/i.test(d);
    }).join(';');
  }
  function sanitizeHtml(html, doc) {
    var d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d) return escapeHtml(stripHtml(html));
    var tpl = d.createElement('template');
    tpl.innerHTML = String(html == null ? '' : html);
    (function walk(node) {
      var kids = Array.prototype.slice.call(node.childNodes);
      kids.forEach(function (n) {
        if (n.nodeType === 8) { n.remove(); return; }           // comments
        if (n.nodeType !== 1) return;
        var tag = n.tagName.toUpperCase();
        if (DROP_WITH_CONTENT[tag]) { n.remove(); return; }
        if (!ALLOWED_TAGS[tag]) {
          walk(n);
          while (n.firstChild) n.parentNode.insertBefore(n.firstChild, n);
          n.remove();
          return;
        }
        Array.prototype.slice.call(n.attributes).forEach(function (at) {
          var name = at.name.toLowerCase();
          var keep = false, val = at.value;
          if (name === 'style') { val = cleanStyle(val); keep = !!val; }
          else if (name === 'colspan' || name === 'rowspan') keep = /^\d{1,2}$/.test(val);
          else if (name === 'width' || name === 'height') keep = /^\d{1,4}%?$/.test(val);
          else if (name === 'align') keep = /^(left|right|center|justify)$/i.test(val);
          else if (name === 'color' && tag === 'FONT') keep = /^#?[0-9a-z]{3,20}$/i.test(val);
          else if (name === 'src' && tag === 'IMG') { val = imageUrl(val); keep = !!val; }
          else if (name === 'alt' || name === 'title') keep = true;
          else if (name === 'href' && tag === 'A') { val = safeUrl(val, false); keep = !!val; }
          if (keep) n.setAttribute(at.name, val); else n.removeAttribute(at.name);
        });
        if (tag === 'A') { n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener noreferrer'); }
        if (tag === 'IMG') { n.setAttribute('loading', 'lazy'); n.setAttribute('referrerpolicy', 'no-referrer'); }
        walk(n);
      });
    })(tpl.content);
    return tpl.innerHTML;
  }

  /* ---------------------------------------------------------------
     The picture on the page — a small layout engine over a canvas
     --------------------------------------------------------------- */
  var BLOCK_TAGS = { P: 1, DIV: 1, LI: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, UL: 1, OL: 1,
    BLOCKQUOTE: 1, TABLE: 1, TR: 1, PRE: 1, FIGURE: 1, FIGCAPTION: 1, HR: 1 };

  /* HTML → paragraphs of styled runs, and pictures as paragraphs of their
     own. The sanitiser has already run, so this only ever meets the
     whitelisted tags. */
  function htmlToParas(html) {
    var paras = [];
    var cur = null;
    function flush() {
      if (cur && cur.runs.some(function (r) { return /\S/.test(r.t); })) {
        // A paragraph's own leading and trailing space is not part of it.
        cur.runs[0].t = cur.runs[0].t.replace(/^[ \t]+/, '');
        var L = cur.runs[cur.runs.length - 1];
        L.t = L.t.replace(/[ \t]+$/, '');
        paras.push(cur);
      }
      cur = null;
    }
    function open(extra) {
      if (!cur) cur = { runs: [], prefix: '' };
      if (extra) Object.keys(extra).forEach(function (k) { cur[k] = extra[k]; });
      return cur;
    }
    function styleOf(el, base) {
      var s = { b: base.b, i: base.i, s: base.s, c: base.c };
      var tag = el.tagName.toUpperCase();
      if (tag === 'B' || tag === 'STRONG' || /^H[1-6]$/.test(tag) || tag === 'TH') s.b = true;
      if (tag === 'I' || tag === 'EM') s.i = true;
      if (tag === 'SUP') s.s = 'sup';
      if (tag === 'SUB') s.s = 'sub';
      var st = (el.getAttribute && el.getAttribute('style')) || '';
      if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(st)) s.b = true;
      if (/font-style\s*:\s*italic/i.test(st)) s.i = true;
      var col = st.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
      if (col) s.c = col[1].trim();
      if (tag === 'FONT' && el.getAttribute('color')) s.c = el.getAttribute('color');
      return s;
    }
    function walk(node, style, listCtx) {
      Array.prototype.forEach.call(node.childNodes, function (n) {
        if (n.nodeType === 3) {
          var t = n.nodeValue.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ');
          if (!t) return;
          open().runs.push({ t: t, b: !!style.b, i: !!style.i, s: style.s || '', c: style.c || '' });
          return;
        }
        if (n.nodeType !== 1) return;
        var tag = n.tagName.toUpperCase();
        if (tag === 'BR') { open().runs.push({ t: '\n', b: false, i: false, s: '', c: '' }); return; }
        if (tag === 'IMG') {
          flush();
          var src = n.getAttribute('src');
          if (src) paras.push({ img: src, w: parseInt(n.getAttribute('width'), 10) || 0 });
          return;
        }
        if (tag === 'HR') { flush(); paras.push({ rule: true }); return; }
        if (tag === 'TABLE') { flush(); paras.push({ tableHtml: n.outerHTML }); return; }
        var st = styleOf(n, style);
        if (tag === 'UL' || tag === 'OL') {
          flush();
          walk(n, st, { ordered: tag === 'OL', n: 0 });
          flush();
          return;
        }
        if (tag === 'LI') {
          flush();
          var mark = listCtx && listCtx.ordered ? (++listCtx.n) + '. ' : '• ';
          open({ prefix: mark, indent: 18 });
          walk(n, st, null);
          flush();
          return;
        }
        if (BLOCK_TAGS[tag]) {
          flush();
          var align = (n.getAttribute('align') || ((n.getAttribute('style') || '').match(/text-align\s*:\s*(left|right|center)/i) || [])[1] || '').toLowerCase();
          if (align) open({ align: align });
          walk(n, st, listCtx);
          flush();
          return;
        }
        walk(n, st, listCtx);
      });
    }
    if (typeof document === 'undefined') return [{ runs: [{ t: stripHtml(html), b: false, i: false, s: '', c: '' }] }];
    var tpl = document.createElement('template');
    tpl.innerHTML = sanitizeHtml(html);
    walk(tpl.content, { b: false, i: false, s: '', c: '' }, null);
    flush();
    // A forced line break at the very end of a paragraph is not a line.
    paras.forEach(function (p) {
      if (!p.runs) return;
      while (p.runs.length > 1 && p.runs[p.runs.length - 1].t === '\n') p.runs.pop();
    });
    return paras;
  }
  function plainPara(text, extra) {
    var p = { runs: [{ t: String(text == null ? '' : text), b: false, i: false, s: '', c: '' }] };
    if (extra) Object.keys(extra).forEach(function (k) { p[k] = extra[k]; });
    return p;
  }

  function fontFor(run, px) {
    var size = run.s ? Math.round(px * 0.72) : px;
    return (run.i ? 'italic ' : '') + (run.b ? '700 ' : '400 ') + size + 'px ' + FAMILY;
  }
  /* Word-wraps runs to a width. Each line is a list of pieces with their own
     font, measured once; a word longer than the line is broken by letters
     rather than spilling off the picture. */
  function layoutRuns(ctx, runs, maxW, px) {
    var lines = [];
    var line = { items: [], w: 0 };
    function push(item) { line.items.push(item); line.w += item.w; }
    function breakLine() { lines.push(line); line = { items: [], w: 0 }; }
    (runs || []).forEach(function (run) {
      var font = fontFor(run, px);
      ctx.font = font;
      var tokens = String(run.t).split(/(\n| +)/);
      tokens.forEach(function (tok) {
        if (!tok) return;
        if (tok === '\n') { breakLine(); return; }
        var space = /^ +$/.test(tok);
        if (space) {
          if (!line.items.length) return;          // no space at a line's start
          push({ t: ' ', font: font, w: ctx.measureText(' ').width, run: run, space: true });
          return;
        }
        var w = ctx.measureText(tok).width;
        if (line.w + w > maxW && line.items.length) {
          while (line.items.length && line.items[line.items.length - 1].space) {
            line.w -= line.items.pop().w;
          }
          breakLine();
        }
        if (w > maxW) {
          var chunk = '';
          for (var i = 0; i < tok.length; i++) {
            var next = chunk + tok[i];
            if (ctx.measureText(next).width > maxW - line.w && chunk) {
              push({ t: chunk, font: font, w: ctx.measureText(chunk).width, run: run });
              breakLine();
              chunk = tok[i];
            } else chunk = next;
          }
          if (chunk) push({ t: chunk, font: font, w: ctx.measureText(chunk).width, run: run });
          return;
        }
        push({ t: tok, font: font, w: w, run: run });
      });
    });
    if (line.items.length || !lines.length) lines.push(line);
    return lines;
  }
  function drawLines(ctx, lines, x, y, maxW, px, align) {
    var lh = px * LINE_K;
    lines.forEach(function (ln, k) {
      var lx = x;
      if (align === 'center') lx = x + (maxW - ln.w) / 2;
      else if (align === 'right') lx = x + maxW - ln.w;
      var base = y + k * lh + px * 1.02;
      ln.items.forEach(function (it) {
        ctx.font = it.font;
        ctx.fillStyle = it.run.c && /^(#[0-9a-f]{3,8}|rgb|[a-z]+$)/i.test(it.run.c) ? it.run.c : INK;
        var dy = it.run.s === 'sup' ? -px * 0.38 : it.run.s === 'sub' ? px * 0.2 : 0;
        ctx.fillText(it.t, lx, base + dy);
        lx += it.w;
      });
    });
    return lines.length * lh;
  }

  function loadImage(src) {
    return new Promise(function (resolve) {
      var url = imageUrl(src);
      if (!url || typeof Image === 'undefined') { resolve(null); return; }
      var img = new Image();
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, IMG_TIMEOUT_MS);
      if (!/^data:/i.test(url)) img.crossOrigin = 'anonymous';
      img.onload = function () {
        if (done) return;
        done = true; clearTimeout(timer);
        resolve(img.naturalWidth ? img : null);
      };
      img.onerror = function () { if (!done) { done = true; clearTimeout(timer); resolve(null); } };
      img.referrerPolicy = 'no-referrer';
      img.src = url;
    });
  }

  /* Every picture a question's text, options and image blocks name. */
  function questionImageUrls(q) {
    var urls = [];
    function add(u) { u = imageUrl(u); if (u && urls.indexOf(u) < 0) urls.push(u); }
    function fromHtml(h) {
      var re = /<img[^>]+src\s*=\s*["']([^"']+)["']/gi, m;
      while ((m = re.exec(String(h || '')))) add(decodeEntities(m[1]));
    }
    ((q && q.blocks) || []).forEach(function (b) {
      if (!b) return;
      if (b.type === 'image') add(b.url);
      if (b.type === 'text' || b.type === 'part') fromHtml(b.content);
      if (b.type === 'mcq') (b.options || []).forEach(function (o) { fromHtml(o && o.text); if (o && o.image) add(o.image); });
      if (b.type === 'commonMistake') fromHtml(b.text);
    });
    return urls;
  }

  /* The question laid out as a list of drawing steps, each knowing its own
     height — measured first, so the canvas is made exactly as tall as the
     question, then drawn. */
  function buildOps(q, mctx, images) {
    var ops = [];
    var W = PIC_W - PIC_PAD * 2;
    var style = mcqStyle(q);
    var shownPart = '';
    function gap(h) { ops.push({ h: h, gap: true, draw: function () {} }); }
    function textOp(paras, opts) {
      opts = opts || {};
      var px = opts.px || BODY_PX;
      paras.forEach(function (p, idx) {
        if (p.rule) {
          ops.push({ h: 12, draw: function (ctx, y) {
            ctx.strokeStyle = RULE; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(0, y + 6); ctx.lineTo(W, y + 6); ctx.stroke();
          } });
          return;
        }
        if (p.img) { imageOp(p.img, p.w, opts.indent || 0); return; }
        if (p.tableHtml) { tableFromHtmlOp(p.tableHtml); return; }
        var indent = (opts.indent || 0) + (p.indent || 0);
        var runs = p.runs.slice();
        if (p.prefix) runs.unshift({ t: p.prefix, b: false, i: false, s: '', c: '' });
        var lines = layoutRuns(mctx, runs, W - indent, px);
        var h = lines.length * px * LINE_K;
        var align = p.align;
        ops.push({ h: h + (idx < paras.length - 1 ? 4 : 0), draw: function (ctx, y) {
          drawLines(ctx, lines, indent, y, W - indent, px, align);
        } });
      });
    }
    function imageOp(src, wantW, indent) {
      var url = imageUrl(src);
      var img = url ? images[url] : null;
      if (!img) {
        ops.push({ h: 46, draw: function (ctx, y) {
          ctx.strokeStyle = RULE; ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
          ctx.strokeRect((indent || 0) + 0.5, y + 4.5, W - (indent || 0) - 1, 36);
          ctx.setLineDash([]);
          ctx.fillStyle = FAINT; ctx.font = '400 12px ' + FAMILY;
          ctx.fillText('Picture — open the question to see it', (indent || 0) + 12, y + 27);
        } });
        return;
      }
      var maxW = W - (indent || 0);
      var w = Math.min(maxW, wantW > 0 ? wantW : img.naturalWidth / 1.6, maxW);
      var h = w * img.naturalHeight / img.naturalWidth;
      if (h > IMG_MAX_H) { h = IMG_MAX_H; w = h * img.naturalWidth / img.naturalHeight; }
      ops.push({ h: h + 10, draw: function (ctx, y) {
        ctx.drawImage(img, (indent || 0) + (maxW - w) / 2, y + 5, w, h);
      } });
    }
    function ruledOp(n, label, indent) {
      var lines = Math.max(1, n | 0);
      var top = label ? 20 : 4;
      ops.push({ h: top + lines * RULE_GAP + 4, draw: function (ctx, y) {
        if (label) {
          ctx.fillStyle = SOFT; ctx.font = '700 12px ' + FAMILY;
          ctx.fillText(label, (indent || 0), y + 14);
        }
        ctx.strokeStyle = RULE; ctx.lineWidth = 1;
        for (var i = 1; i <= lines; i++) {
          var ly = Math.round(y + top + i * RULE_GAP) + 0.5;
          ctx.beginPath(); ctx.moveTo((indent || 0), ly); ctx.lineTo(W, ly); ctx.stroke();
        }
      } });
    }
    function spaceOp(rows, dashed) {
      var h = Math.min(OPEN_LINES_MAX, Math.max(1, rows | 0)) * RULE_GAP * 0.8;
      ops.push({ h: h + 8, draw: function (ctx, y) {
        if (!dashed) return;
        ctx.strokeStyle = RULE; ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
        ctx.strokeRect(0.5, y + 4.5, W - 1, h);
        ctx.setLineDash([]);
      } });
    }
    function marksOp(n) {
      if (!n) return;
      ops.push({ h: 18, draw: function (ctx, y) {
        ctx.fillStyle = INK; ctx.font = '700 13px ' + FAMILY;
        var t = '[' + n + ']';
        ctx.fillText(t, W - ctx.measureText(t).width, y + 13);
      } });
    }
    function labelOp(lab) {
      ops.push({ h: BODY_PX * LINE_K, draw: function (ctx, y) {
        ctx.fillStyle = INK; ctx.font = '700 ' + BODY_PX + 'px ' + FAMILY;
        ctx.fillText(lab, 0, y + BODY_PX * 1.02);
      } });
    }
    function tableOp(grid) {
      if (!grid.nRows || !grid.cols) return;
      var widths = columnWidths(grid, W);
      var cells = tableCells(grid);
      var PADX = 7, PADY = 5, px = SMALL_PX;
      var laid = [];
      var rowH = [];
      for (var r = 0; r < grid.nRows; r++) rowH.push(px * LINE_K + PADY * 2);
      cells.forEach(function (row) {
        row.forEach(function (cell) {
          if (!cell) return;
          var cw = 0;
          for (var k = 0; k < cell.cs; k++) cw += widths[cell.c + k] || 0;
          var st = grid.styles[cell.r + '_' + cell.c] || {};
          var paras = htmlToParas(cell.html).filter(function (p) { return p.runs; });
          if (st.fontWeight && /bold|[6-9]00/.test(String(st.fontWeight))) {
            paras.forEach(function (p) { p.runs.forEach(function (rn) { rn.b = true; }); });
          }
          var blocks = paras.map(function (p) { return layoutRuns(mctx, p.runs, Math.max(10, cw - PADX * 2), px); });
          var textH = blocks.reduce(function (s, ls) { return s + ls.length * px * LINE_K; }, 0);
          var need = Math.max(px * LINE_K, textH) + PADY * 2;
          laid.push({ cell: cell, cw: cw, blocks: blocks, need: need, st: st });
          if (cell.rs === 1) rowH[cell.r] = Math.max(rowH[cell.r], need);
        });
      });
      laid.forEach(function (L) {
        if (L.cell.rs <= 1) return;
        var have = 0;
        for (var k = 0; k < L.cell.rs; k++) have += rowH[L.cell.r + k];
        if (have < L.need) rowH[L.cell.r + L.cell.rs - 1] += L.need - have;
      });
      var total = rowH.reduce(function (a, b) { return a + b; }, 0);
      var colX = [0];
      widths.forEach(function (w, i) { colX.push(colX[i] + w); });
      var rowY = [0];
      rowH.forEach(function (h, i) { rowY.push(rowY[i] + h); });
      ops.push({ h: total + 10, draw: function (ctx, y0) {
        var y = y0 + 4;
        laid.forEach(function (L) {
          var x = colX[L.cell.c], top = y + rowY[L.cell.r];
          var h = 0;
          for (var k = 0; k < L.cell.rs; k++) h += rowH[L.cell.r + k];
          if (L.st.backgroundColor && /^(#[0-9a-f]{3,8}|rgb)/i.test(L.st.backgroundColor)) {
            ctx.fillStyle = L.st.backgroundColor; ctx.fillRect(x, top, L.cw, h);
          }
          ctx.strokeStyle = '#b9b9b4'; ctx.lineWidth = 1;
          ctx.strokeRect(Math.round(x) + 0.5, Math.round(top) + 0.5, Math.round(L.cw), Math.round(h));
          var align = L.st.textAlign || '';
          var ty = top + PADY;
          var textH = L.blocks.reduce(function (s, ls) { return s + ls.length * px * LINE_K; }, 0);
          if (/middle/.test(L.st.verticalAlign || 'middle')) ty = top + (h - textH) / 2;
          L.blocks.forEach(function (ls) {
            ty += drawLines(ctx, ls, x + PADX, ty, L.cw - PADX * 2, px, align);
          });
        });
      } });
    }
    function tableFromHtmlOp(html) {
      if (typeof document === 'undefined') return;
      var tpl = document.createElement('template');
      tpl.innerHTML = html;
      var t = tpl.content.querySelector('table');
      if (!t) return;
      var data = [], merges = [];
      var taken = {};
      Array.prototype.forEach.call(t.querySelectorAll('tr'), function (tr, r) {
        data[r] = data[r] || [];
        var c = 0;
        Array.prototype.forEach.call(tr.children, function (td) {
          while (taken[r + '_' + c]) c++;
          var rs = parseInt(td.getAttribute('rowspan'), 10) || 1, cs = parseInt(td.getAttribute('colspan'), 10) || 1;
          data[r][c] = td.innerHTML;
          if (rs > 1 || cs > 1) merges.push({ sr: r, sc: c, er: r + rs - 1, ec: c + cs - 1 });
          for (var i = 0; i < rs; i++) for (var j = 0; j < cs; j++) taken[(r + i) + '_' + (c + j)] = 1;
          c += cs;
        });
      });
      tableOp(tableGrid({ data: data, merges: merges }));
    }

    var blocks = (q.blocks || []).filter(Boolean);
    blocks.forEach(function (b, bi) {
      var lab = partOpens(b);
      var newPart = lab && lab !== shownPart;
      if (newPart) shownPart = lab;
      var withLabel = function (paras) {
        if (!newPart || !paras.length) return paras;
        var first = paras.find(function (p) { return p.runs; });
        if (first) first.runs.unshift({ t: lab + ' ', b: true, i: false, s: '', c: '' });
        else paras.unshift(plainPara(lab, {}));
        newPart = false;
        return paras;
      };
      var n = marksOf(b);
      switch (b.type) {
        case 'text': {
          var paras = withLabel(htmlToParas(b.content || ''));
          if (n) {
            var lastText = null;
            for (var i = paras.length - 1; i >= 0; i--) if (paras[i].runs) { lastText = paras[i]; break; }
            if (lastText) { lastText.runs.push({ t: '  [' + n + ']', b: true, i: false, s: '', c: '' }); n = 0; }
          }
          textOp(paras);
          marksOp(n);
          gap(8);
          break;
        }
        case 'part': {
          var pp = htmlToParas(b.content || '');
          var plab = lab || (b.label ? String(b.label) : '');
          if (pp.length && pp[0].runs && plab) pp[0].runs.unshift({ t: plab + ' ', b: true, i: false, s: '', c: '' });
          else if (plab) pp.unshift(plainPara(plab));
          newPart = false;
          textOp(pp);
          gap(6);
          break;
        }
        case 'image':
          if (newPart) { labelOp(lab); newPart = false; }
          var scale = parseFloat(b.scale);
          imageOp(b.url, isFinite(scale) && scale > 0 && scale <= 1 ? (W * scale) : 0, 0);
          if (b.caption) textOp([plainPara(b.caption, { align: 'center' })], { px: 12 });
          gap(6);
          break;
        case 'table':
          if (newPart) { labelOp(lab); newPart = false; }
          tableOp(tableGrid(b));
          gap(6);
          break;
        case 'mcq': {
          if (newPart) { labelOp(lab); newPart = false; }
          (b.options || []).forEach(function (o, oi) {
            var label = '(' + mcqLabel(oi, style) + ')';
            var paras = htmlToParas(mcqOptionText(o && o.text, oi, style));
            if (o && o.image) paras.push({ img: o.image });
            var textParas = paras.filter(function (p) { return p.runs; });
            if (!textParas.length) paras.unshift(plainPara(''));
            var startIndex = ops.length;
            textOp(paras, { indent: 46 });
            var first = ops[startIndex];
            if (first) {
              var inner = first.draw;
              first.draw = function (ctx, y) {
                ctx.strokeStyle = '#8f8f89'; ctx.lineWidth = 1.2;
                ctx.beginPath(); ctx.arc(8, y + BODY_PX * 0.68, 6, 0, Math.PI * 2); ctx.stroke();
                ctx.fillStyle = INK; ctx.font = '700 ' + BODY_PX + 'px ' + FAMILY;
                ctx.fillText(label, 20, y + BODY_PX * 1.02);
                inner(ctx, y);
              };
            }
            gap(6);
          });
          marksOp(n);
          gap(4);
          break;
        }
        case 'answer':
          if (newPart) { labelOp(lab); newPart = false; }
          ruledOp(2, 'Claim', 0);
          ruledOp(2, 'Evidence', 0);
          ruledOp(2, 'Reasoning', 0);
          marksOp(n);
          gap(6);
          break;
        case 'plainanswer':
          if (newPart) { labelOp(lab); newPart = false; }
          ruledOp(3, '', 0);
          marksOp(n);
          gap(6);
          break;
        case 'answerLine': {
          var al = (lab && newPart ? lab + ' ' : '') + (b.label ? String(b.label) : '');
          newPart = false;
          ops.push({ h: 30, draw: function (ctx, y) {
            ctx.fillStyle = INK; ctx.font = '700 ' + BODY_PX + 'px ' + FAMILY;
            var lw = al ? ctx.measureText(al + ' ').width : 0;
            if (al) ctx.fillText(al, 0, y + 20);
            var len = Math.min(W - lw, Math.max(140, (Number(b.lineLength) || 30) * 7));
            ctx.strokeStyle = '#8f8f89'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(lw, y + 23.5); ctx.lineTo(lw + len, y + 23.5); ctx.stroke();
          } });
          marksOp(n);
          gap(4);
          break;
        }
        case 'openLines':
          spaceOp(b.lines || 4, false);
          break;
        case 'workingSpace':
          spaceOp(b.lines || 6, true);
          gap(4);
          break;
        case 'fillblank': {
          var segs = fbSegments(b.text || '');
          var runs = [];
          if (newPart) { runs.push({ t: lab + ' ', b: true, i: false, s: '', c: '' }); newPart = false; }
          segs.forEach(function (sg) {
            if (sg.type === 'text') runs.push({ t: stripHtml(sg.text), b: false, i: false, s: '', c: '' });
            else {
              var len = Math.max(8, Math.min(26, String(sg.answer).length + 4));
              runs.push({ t: new Array(len + 1).join('_'), b: false, i: false, s: '', c: '#8f8f89' });
            }
          });
          textOp([{ runs: runs }], { px: BODY_PX });
          marksOp(n);
          gap(8);
          break;
        }
        case 'commonMistake':
        case 'studentAnswer': {
          var title = b.type === 'commonMistake' ? ('⚠ ' + (b.title || 'Common mistake')) : (b.label || "Student's answer");
          var body = htmlToParas(b.type === 'commonMistake' ? (b.text || '') : (b.answer || ''));
          var start = ops.length;
          textOp([plainPara(title)].map(function (p) { p.runs[0].b = true; return p; }).concat(body), { indent: 12, px: SMALL_PX + 1 });
          var hSum = 0;
          for (var k = start; k < ops.length; k++) hSum += ops[k].h;
          var firstOp = ops[start];
          if (firstOp) {
            var innerDraw = firstOp.draw;
            var boxH = hSum;
            firstOp.draw = function (ctx, y) {
              ctx.fillStyle = b.type === 'commonMistake' ? '#fdf3e4' : '#f3f1ec';
              ctx.fillRect(0, y - 4, W, boxH + 8);
              ctx.fillStyle = b.type === 'commonMistake' ? '#d08a2c' : '#c9c6bd';
              ctx.fillRect(0, y - 4, 3, boxH + 8);
              innerDraw(ctx, y);
            };
          }
          gap(10);
          break;
        }
        // The answer, the explanation, the app and print-only furniture are
        // not part of the question a student reads on the page.
        default:
          break;
      }
    });
    // No trailing space under the last thing on the page.
    while (ops.length && ops[ops.length - 1].gap) ops.pop();
    return ops;
  }

  /* Paints the question and hands back a picture of it. A picture that
     cannot be read back (a host that sent no CORS header) is painted again
     without its pictures, as a placeholder, rather than failing the add. */
  function paintQuestion(q) {
    if (typeof document === 'undefined') return Promise.reject(new Error('No document to paint in'));
    var urls = questionImageUrls(q);
    return Promise.all(urls.map(loadImage)).then(function (imgs) {
      var images = {};
      urls.forEach(function (u, i) { if (imgs[i]) images[u] = imgs[i]; });
      var out = paintWith(q, images);
      if (!out) out = paintWith(q, {});
      if (!out) throw new Error('The question could not be drawn');
      return out;
    });
  }
  function paintWith(q, images) {
    var scratch = document.createElement('canvas').getContext('2d');
    var ops = buildOps(q, scratch, images);
    var total = PIC_PAD * 2 + ops.reduce(function (s, op) { return s + op.h; }, 0);
    var h = Math.max(60, Math.min(PIC_MAX_H, Math.ceil(total)));
    var cvs = document.createElement('canvas');
    cvs.width = PIC_W * PIC_SCALE;
    cvs.height = h * PIC_SCALE;
    var ctx = cvs.getContext('2d');
    ctx.scale(PIC_SCALE, PIC_SCALE);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, PIC_W, h);
    ctx.textBaseline = 'alphabetic';
    ctx.translate(PIC_PAD, 0);
    var y = PIC_PAD;
    ops.forEach(function (op) {
      if (y > h) return;
      try { op.draw(ctx, y); } catch (e) { /* one bad step costs that step, never the question */ }
      y += op.h;
    });
    try {
      var src = cvs.toDataURL('image/jpeg', PIC_QUALITY);
      if (!/^data:image\/jpeg/.test(src)) src = cvs.toDataURL('image/png');
      return { src: src, ratio: PIC_W / h, w: PIC_W, h: h };
    } catch (e) {
      return null;   // tainted by a picture with no CORS header
    }
  }

  /* ---------------------------------------------------------------
     The question as HTML — the window, and the picker's preview
     --------------------------------------------------------------- */
  function cerKeys(b) { return [['claim', 'Claim'], ['evidence', 'Evidence'], ['reasoning', 'Reasoning']]; }

  function questionHtml(q, st, opts) {
    opts = opts || {};
    var ro = !!opts.readOnly;
    var checked = !!(st && st.checked);
    var style = mcqStyle(q);
    var out = [];
    var shownPart = '';
    var blocks = (q.blocks || []).filter(Boolean);
    blocks.forEach(function (b, bi) {
      var key = b.id || ('b' + bi);
      var lab = partOpens(b);
      var labHtml = '';
      if (lab && lab !== shownPart) { shownPart = lab; labHtml = '<span class="qbPart">' + escapeHtml(lab) + '</span> '; }
      var n = marksOf(b);
      var marks = n ? ' <span class="qbMarks">[' + n + ']</span>' : '';
      switch (b.type) {
        case 'text':
          out.push('<div class="qbText">' + labHtml + sanitizeHtml(b.content || '') + marks + '</div>');
          break;
        case 'part':
          out.push('<div class="qbText">' + (labHtml || (b.label ? '<span class="qbPart">' + escapeHtml(b.label) + '</span> ' : '')) +
            sanitizeHtml(b.content || '') + '</div>');
          break;
        case 'image': {
          var src = imageUrl(b.url);
          if (!src) break;
          var scale = parseFloat(b.scale);
          var w = isFinite(scale) && scale > 0 && scale <= 1 ? 'width:' + Math.round(scale * 100) + '%;' : '';
          out.push(labHtml + '<figure class="qbFig"><img src="' + escapeHtml(src) + '" alt="' + escapeHtml(b.caption || 'Diagram') +
            '" loading="lazy" referrerpolicy="no-referrer" style="' + w + '">' +
            (b.caption ? '<figcaption>' + escapeHtml(b.caption) + '</figcaption>' : '') + '</figure>');
          break;
        }
        case 'table':
          out.push(labHtml + tableHtml(tableGrid(b)));
          break;
        case 'mcq': {
          var pick = st && st.mcq ? st.mcq[key] : '';
          var h = '<div class="qbMcq" data-qb-mcq="' + escapeHtml(key) + '">' + labHtml;
          (b.options || []).forEach(function (o, oi) {
            var cls = 'qbOpt';
            if (pick && pick === o.id) cls += ' picked';
            if (checked && o.id === b.correctId) cls += ' right';
            else if (checked && pick === o.id) cls += ' wrong';
            h += '<button type="button" class="' + cls + '" data-qb-opt="' + escapeHtml(o.id) + '"' + (ro || checked ? ' disabled' : '') + '>' +
              '<span class="qbOptLab">(' + mcqLabel(oi, style) + ')</span><span class="qbOptText">' +
              sanitizeHtml(mcqOptionText(o.text, oi, style)) +
              (o.image && imageUrl(o.image) ? '<img src="' + escapeHtml(imageUrl(o.image)) + '" alt="" referrerpolicy="no-referrer">' : '') +
              '</span></button>';
          });
          h += marks + '</div>';
          out.push(h);
          break;
        }
        case 'fillblank': {
          var segs = fbSegments(b.text || '');
          var vals = (st && st.blanks && st.blanks[key]) || [];
          var bi2 = 0;
          var h2 = '<div class="qbFill">' + labHtml;
          segs.forEach(function (sg) {
            if (sg.type === 'text') { h2 += escapeHtml(stripHtml(sg.text)); return; }
            var idx = bi2++;
            var v = vals[idx] || '';
            var cls = 'qbBlank';
            if (checked) cls += blankCorrect(v, sg.answer) ? ' right' : ' wrong';
            h2 += '<input class="' + cls + '" data-qb-blank="' + escapeHtml(key) + '" data-qb-i="' + idx + '" value="' + escapeHtml(v) +
              '" size="' + Math.max(6, Math.min(24, sg.answer.length + 2)) + '" autocomplete="off" spellcheck="false"' + (ro || checked ? ' disabled' : '') + '>';
            if (checked && !blankCorrect(v, sg.answer)) h2 += '<span class="qbFix">' + escapeHtml(sg.answer) + '</span>';
          });
          h2 += marks + '</div>';
          out.push(h2);
          break;
        }
        case 'answer': {
          var h3 = '<div class="qbCer">' + labHtml;
          cerKeys(b).forEach(function (pair) {
            var tk = key + ':' + pair[0];
            var v = (st && st.text && st.text[tk]) || '';
            h3 += '<label class="qbField"><span>' + pair[1] + '</span>' +
              '<textarea rows="2" data-qb-text="' + escapeHtml(tk) + '"' + (ro ? ' disabled' : '') + ' placeholder="' +
              (ro ? '' : 'Write your ' + pair[1].toLowerCase() + '…') + '">' + escapeHtml(v) + '</textarea></label>';
            if (checked && stripHtml(b[pair[0]] || '')) {
              h3 += '<div class="qbModel"><b>Model ' + pair[1].toLowerCase() + ':</b> ' + sanitizeHtml(b[pair[0]]) + '</div>';
            }
          });
          h3 += marks + '</div>';
          out.push(h3);
          break;
        }
        case 'plainanswer':
        case 'answerLine': {
          var tk2 = key + ':a';
          var v2 = (st && st.text && st.text[tk2]) || '';
          var model = b.type === 'plainanswer' ? b.content : (b.answer || b.content || '');
          var field = b.type === 'answerLine'
            ? '<input class="qbLine" data-qb-text="' + escapeHtml(tk2) + '" value="' + escapeHtml(v2) + '"' + (ro ? ' disabled' : '') + ' placeholder="' + (ro ? '' : 'Your answer') + '">'
            : '<textarea rows="3" data-qb-text="' + escapeHtml(tk2) + '"' + (ro ? ' disabled' : '') + ' placeholder="' + (ro ? '' : 'Write your answer…') + '">' + escapeHtml(v2) + '</textarea>';
          out.push('<div class="qbAns">' + labHtml + (b.label ? '<span class="qbAnsLab">' + escapeHtml(b.label) + '</span>' : '') + field + marks +
            (checked && stripHtml(model || '') ? '<div class="qbModel"><b>Model answer:</b> ' + sanitizeHtml(model) + '</div>' : '') + '</div>');
          break;
        }
        case 'openLines':
        case 'workingSpace': {
          var tk3 = key + ':w';
          var v3 = (st && st.text && st.text[tk3]) || '';
          if (ro) { out.push('<div class="qbSpace" style="height:' + Math.min(OPEN_LINES_MAX, Math.max(2, b.lines | 0 || 4)) * 14 + 'px"></div>'); break; }
          out.push('<div class="qbAns">' + labHtml + '<textarea rows="3" class="qbWork" data-qb-text="' + escapeHtml(tk3) + '" placeholder="Working (optional)…">' +
            escapeHtml(v3) + '</textarea>' +
            (checked && b.type === 'workingSpace' && stripHtml(b.answerKey || '') ? '<div class="qbModel"><b>Worked answer:</b> ' + sanitizeHtml(b.answerKey) + '</div>' : '') + '</div>');
          break;
        }
        case 'commonMistake':
          out.push('<div class="qbNote qbWarn"><b>⚠ ' + escapeHtml(b.title || 'Common mistake') + '</b><div>' + sanitizeHtml(b.text || '') + '</div></div>');
          break;
        case 'studentAnswer':
          out.push('<div class="qbNote"><b>' + escapeHtml(b.label || "Student's answer") + '</b><div><i>' + sanitizeHtml(b.answer || '') + '</i></div></div>');
          break;
        case 'video': {
          var vu = safeUrl(b.url, false);
          if (vu && !ro) out.push('<a class="qbVideo" href="' + escapeHtml(vu) + '" target="_blank" rel="noopener noreferrer">▶ Watch the video</a>');
          break;
        }
        default:
          break;
      }
    });
    return out.join('');
  }
  function tableHtml(grid) {
    if (!grid.nRows || !grid.cols) return '';
    var cells = tableCells(grid);
    var h = '<div class="qbTableWrap"><table class="qbTable">';
    cells.forEach(function (row) {
      h += '<tr>';
      row.forEach(function (cell) {
        if (!cell) return;
        var st = grid.styles[cell.r + '_' + cell.c] || {};
        var css = '';
        if (/^(left|right|center)$/.test(st.textAlign || '')) css += 'text-align:' + st.textAlign + ';';
        if (/^(#[0-9a-f]{3,8}|rgb\([\d,\s.]+\))$/i.test(st.backgroundColor || '')) css += 'background:' + st.backgroundColor + ';';
        if (/bold|[6-9]00/.test(String(st.fontWeight || ''))) css += 'font-weight:700;';
        h += '<td' + (cell.rs > 1 ? ' rowspan="' + cell.rs + '"' : '') + (cell.cs > 1 ? ' colspan="' + cell.cs + '"' : '') +
          (css ? ' style="' + css + '"' : '') + '>' + sanitizeHtml(cell.html) + '</td>';
      });
      h += '</tr>';
    });
    return h + '</table></div>';
  }

  /* What ✓ Check reveals underneath: the explanation, and every picture
     drawn to explain the answer. Shown only once the question is checked —
     the question itself never shows it, or it would be the answer. */
  function revealHtml(q) {
    var out = '';
    var exps = (q.blocks || []).filter(function (b) { return b && b.type === 'explanation' && stripHtml(b.content || ''); });
    if (exps.length) {
      out += '<div class="qbReveal qbExplain"><div class="qbRevealHead">💡 Explanation</div>' +
        exps.map(function (b) { return '<div>' + sanitizeHtml(b.content) + '</div>'; }).join('') + '</div>';
    }
    var pics = [];
    function add(u) { u = imageUrl(u); if (u && pics.indexOf(u) < 0) pics.push(u); }
    add(q.answerKeyImage);
    (q.blocks || []).forEach(function (b) { if (b && b.type === 'answerKey') add(b.url); });
    if (pics.length) {
      out += '<div class="qbReveal qbExplain"><div class="qbRevealHead">🖼 Answer diagram</div>' +
        pics.map(function (u) { return '<img src="' + escapeHtml(u) + '" alt="Diagram explaining the answer" referrerpolicy="no-referrer">'; }).join('') + '</div>';
    }
    return out;
  }

  /* Marks what can be marked by comparison: the options and the blanks. A
     written answer is not judged here — its model answer is revealed beside
     it, and ✨ Mark asks the AI when it is available. */
  function markState(q, st) {
    var right = 0, total = 0;
    (q.blocks || []).forEach(function (b, bi) {
      if (!b) return;
      var key = b.id || ('b' + bi);
      if (b.type === 'mcq' && b.correctId && (b.options || []).length) {
        total++;
        if (st.mcq && st.mcq[key] === b.correctId) right++;
      }
      if (fbHasBlanks(b)) {
        var vals = (st.blanks && st.blanks[key]) || [];
        fbSegments(b.text).filter(function (s) { return s.type === 'blank'; }).forEach(function (sg, i) {
          total++;
          if (blankCorrect(vals[i], sg.answer)) right++;
        });
      }
    });
    return { right: right, total: total };
  }

  /* What a written answer is marked against, for ✨ Mark. */
  function openItems(q, st) {
    var items = [];
    (q.blocks || []).forEach(function (b, bi) {
      if (!b) return;
      var key = b.id || ('b' + bi);
      if (b.type === 'answer') {
        var parts = cerKeys(b).map(function (p) {
          return { label: p[1], model: stripHtml(b[p[0]] || ''), student: ((st.text || {})[key + ':' + p[0]] || '').trim() };
        });
        items.push({ part: partOpens(b), marks: marksOf(b), cer: parts });
      } else if (b.type === 'plainanswer' || b.type === 'answerLine') {
        items.push({ part: partOpens(b), marks: marksOf(b),
          model: stripHtml(b.type === 'plainanswer' ? b.content : (b.answer || b.content || '')),
          student: ((st.text || {})[key + ':a'] || '').trim() });
      }
    });
    return items;
  }
  function markPrompt(q, items) {
    var lines = ['QUESTION:', questionPlain(q), ''];
    items.forEach(function (it, i) {
      lines.push('ANSWER ' + (i + 1) + (it.part ? ' ' + it.part : '') + (it.marks ? ' [' + it.marks + ' marks]' : '') + ':');
      if (it.cer) it.cer.forEach(function (p) {
        lines.push('  ' + p.label + ' — model: ' + (p.model || '(none)'));
        lines.push('  ' + p.label + ' — student: ' + (p.student || '(blank)'));
      });
      else {
        lines.push('  model: ' + (it.model || '(none)'));
        lines.push('  student: ' + (it.student || '(blank)'));
      }
    });
    lines.push('', 'Mark each student answer against its model answer. Be fair to correct ideas in different words.',
      'Return ONLY JSON: {"items":[{"verdict":"correct"|"partial"|"incorrect","feedback":"one short sentence to the student"}],"summary":"one encouraging sentence"}');
    return lines.join('\n');
  }

  /* ---------------------------------------------------------------
     The controller
     --------------------------------------------------------------- */
  function create(env) {
    env = env || {};
    var bank = null;           // [{q, owner}] once loaded
    var loading = null;
    var states = {};           // annotation id → the answers typed into its window
    var picker = null, win = null;
    var pick = { query: '', topic: '', only: '', sel: '' };

    /* `db` may be handed over as a getter, so the database the page is using
       NOW is the one asked — never one captured when this was made. */
    function dbNow() { return typeof env.db === 'function' && !env.db.collection ? env.db() : env.db; }
    function role() { try { return env.role ? env.role() : 'none'; } catch (e) { return 'none'; } }
    function teacher() { return role() === 'teacher'; }
    function toast(m, ms) { if (env.toast) env.toast(m, ms); }

    /* ---------- loading the bank ---------- */
    function ownerUids() {
      var uids = [];
      var mine = env.uid ? env.uid() : '';
      var db = dbNow();
      var cfg = db ? db.collection('config').doc('admin').get().then(function (s) {
        var d = s && s.exists && s.data ? s.data() : null;
        if (d && d.uid) uids.push(d.uid);
      }).catch(function () {}) : Promise.resolve();
      return cfg.then(function () {
        if (mine && uids.indexOf(mine) < 0) uids.push(mine);
        return uids;
      });
    }
    function load(force) {
      if (bank && !force) return Promise.resolve(bank);
      if (loading && !force) return loading;
      if (env.loadQuestions) {
        loading = Promise.resolve(env.loadQuestions()).then(function (list) {
          bank = (list || []).map(function (x) { return x && x.q ? x : { q: x, owner: '' }; });
          return bank;
        });
      } else {
        loading = ownerUids().then(function (uids) {
          var seen = {}, out = [];
          return uids.reduce(function (p, uid) {
            return p.then(function () {
              return dbNow().collection('users').doc(uid).collection('questions').get().then(function (snap) {
                snap.forEach(function (d) {
                  var q = d.data();
                  if (!q) return;
                  if (!q.id) q.id = d.id;
                  if (seen[q.id]) return;
                  seen[q.id] = 1;
                  out.push({ q: q, owner: uid });
                });
              }).catch(function (e) { console.warn('Question bank read failed for one owner', e); });
            });
          }, Promise.resolve()).then(function () { bank = out; return bank; });
        });
      }
      loading.catch(function () { loading = null; });
      return loading;
    }

    /* ---------- shared overlay plumbing ---------- */
    function overlay(cls, label) {
      var back = document.createElement('div');
      back.className = 'qbBack ' + cls;
      back.setAttribute('role', 'dialog');
      back.setAttribute('aria-modal', 'true');
      back.setAttribute('aria-label', label);
      // Every keystroke typed in here stays here, or a letter typed into the
      // search box fires one of the page's one-letter tool shortcuts.
      ['keydown', 'keyup', 'keypress', 'paste', 'copy', 'cut'].forEach(function (t) {
        back.addEventListener(t, function (e) {
          if (t === 'keydown' && e.key === 'Escape') { e.preventDefault(); closeTop(); }
          e.stopPropagation();
        });
      });
      back.addEventListener('pointerdown', function (e) {
        e.stopPropagation();
        if (e.target === back) closeTop();
      });
      document.body.appendChild(back);
      requestAnimationFrame(function () { back.classList.add('in'); });
      return back;
    }
    /* The card takes the focus when it opens, so what is typed reaches it
       and not the page's one-letter shortcuts — and Escape closes it even
       when the focus has wandered back to the page. */
    function focusCard(back) {
      var card = back && back.firstElementChild;
      if (!card) return;
      try { card.focus({ preventScroll: true }); } catch (e) { card.focus(); }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' || !(picker || win)) return;
        if (e.target && e.target.closest && e.target.closest('.qbBack')) return;   // handled inside
        e.preventDefault();
        e.stopPropagation();
        closeTop();
      }, true);
    }
    function closeTop() {
      if (win) closeWindow();
      else if (picker) closePicker();
    }

    /* ---------- the picker ---------- */
    function openPicker() {
      if (!teacher()) { toast('Adding questions from the bank is the teacher’s own.'); return; }
      if (env.canAdd && !env.canAdd()) return;
      if (picker) { focusSearch(); return; }
      picker = overlay('qbPickBack', 'Question bank');
      picker.innerHTML =
        '<div class="qbPick" tabindex="-1">' +
          '<div class="qbHead">' +
            '<div class="qbHeadTitle"><span class="qbIcon">📚</span><div><h2>Question bank</h2>' +
            '<p>Pick a question to see it, then add it to the page.</p></div></div>' +
            '<button type="button" class="qbClose" data-qb="close" aria-label="Close">✕</button>' +
          '</div>' +
          '<div class="qbFilters">' +
            '<input type="search" class="qbSearch" placeholder="Search the bank — a word, a topic…" aria-label="Search questions" autocomplete="off" spellcheck="false">' +
            '<select class="qbTopic" aria-label="Topic"><option value="">All topics</option></select>' +
            '<div class="qbChips" role="group" aria-label="Kind">' +
              '<button type="button" data-qb-only="" class="on">All</button>' +
              '<button type="button" data-qb-only="app">🧩 With app</button>' +
              '<button type="button" data-qb-only="mcq">MCQ</button>' +
              '<button type="button" data-qb-only="open">Written</button>' +
            '</div>' +
            '<button type="button" class="qbRefresh" data-qb="refresh" title="Load the bank again">↻</button>' +
          '</div>' +
          '<div class="qbPickBody">' +
            '<div class="qbList" role="listbox" aria-label="Questions"><div class="qbEmpty">Loading the question bank…</div></div>' +
            '<div class="qbPreview"><div class="qbEmpty qbHint"><div class="qbHintIcon">👈</div>Pick a question to see it here.</div></div>' +
          '</div>' +
        '</div>';
      var search = picker.querySelector('.qbSearch');
      search.value = pick.query;
      search.addEventListener('input', function () { pick.query = search.value; renderList(); });
      picker.querySelector('.qbTopic').addEventListener('change', function (e) { pick.topic = e.target.value; renderList(); });
      picker.addEventListener('click', onPickerClick);
      picker.querySelector('.qbList').addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
        var rows = Array.prototype.slice.call(picker.querySelectorAll('.qbRow'));
        var i = rows.findIndex(function (r) { return r.getAttribute('data-qid') === pick.sel; });
        if (e.key === 'Enter') { if (pick.sel) addSelected(); e.preventDefault(); return; }
        i = e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1);
        if (rows[i]) { selectRow(rows[i].getAttribute('data-qid')); rows[i].focus(); }
        e.preventDefault();
      });
      focusSearch();
      load(false).then(function () { if (picker) { fillTopics(); renderList(); } })
        .catch(function (e) {
          console.warn('Question bank load failed', e);
          var list = picker && picker.querySelector('.qbList');
          if (list) list.innerHTML = '<div class="qbEmpty">The question bank could not be loaded. Check the connection and press ↻.</div>';
        });
    }
    function focusSearch() {
      var s = picker && picker.querySelector('.qbSearch');
      if (s) setTimeout(function () { try { s.focus({ preventScroll: true }); } catch (e) { s.focus(); } }, 30);
    }
    function fillTopics() {
      var sel = picker.querySelector('.qbTopic');
      var topics = allTopics((bank || []).map(function (x) { return x.q; }));
      sel.innerHTML = '<option value="">All topics</option>' + topics.map(function (t) {
        return '<option value="' + escapeHtml(t) + '"' + (t === pick.topic ? ' selected' : '') + '>' + escapeHtml(t) + '</option>';
      }).join('');
    }
    function entry(id) {
      return (bank || []).find(function (x) { return x.q && String(x.q.id) === String(id); }) || null;
    }
    function renderList() {
      if (!picker) return;
      var list = picker.querySelector('.qbList');
      if (!bank) return;
      var qs = filterQuestions(bank.map(function (x) { return x.q; }), pick);
      if (!bank.length) { list.innerHTML = '<div class="qbEmpty">The question bank is empty.</div>'; return; }
      if (!qs.length) { list.innerHTML = '<div class="qbEmpty">No question matches. Try fewer words.</div>'; return; }
      var shown = qs.slice(0, LIST_MAX);
      list.innerHTML = '<div class="qbCount">' + (qs.length > shown.length ? 'Showing ' + shown.length + ' of ' + qs.length + ' — search to narrow it' :
        qs.length + ' question' + (qs.length === 1 ? '' : 's')) + '</div>' +
        shown.map(function (q) {
          var tags = questionTopics(q).map(function (t) { return '<span class="qbTag">' + escapeHtml(t) + '</span>'; }).join('');
          var kind = (hasApp(q) ? '<span class="qbTag qbTagApp" title="Has an interactive app">🧩 App</span>' : '') +
            (isMcq(q) ? '<span class="qbTag qbTagSoft">MCQ</span>' : '');
          return '<button type="button" class="qbRow' + (String(q.id) === pick.sel ? ' sel' : '') + '" role="option" data-qid="' + escapeHtml(q.id) + '">' +
            '<span class="qbRowTitle">' + escapeHtml(questionTitle(q)) + '</span>' +
            '<span class="qbRowMeta">' + tags + kind + '</span></button>';
        }).join('');
    }
    function selectRow(id) {
      pick.sel = String(id || '');
      Array.prototype.forEach.call(picker.querySelectorAll('.qbRow'), function (r) {
        r.classList.toggle('sel', r.getAttribute('data-qid') === pick.sel);
      });
      renderPreview();
    }
    function renderPreview() {
      var pane = picker && picker.querySelector('.qbPreview');
      if (!pane) return;
      var e = entry(pick.sel);
      if (!e) { pane.innerHTML = '<div class="qbEmpty qbHint"><div class="qbHintIcon">👈</div>Pick a question to see it here.</div>'; return; }
      var q = e.q;
      var tags = questionTopics(q).map(function (t) { return '<span class="qbTag">' + escapeHtml(t) + '</span>'; }).join('') +
        (q.category ? '<span class="qbTag qbTagSoft">' + escapeHtml(q.category) + '</span>' : '');
      pane.innerHTML =
        '<div class="qbPrevHead"><h3>' + escapeHtml(questionTitle(q)) + '</h3><div class="qbRowMeta">' + tags + '</div></div>' +
        '<div class="qbPrevBody qbQ">' + questionHtml(q, null, { readOnly: true }) + '</div>' +
        '<div class="qbPrevFoot">' +
          (hasApp(q) ? '<span class="qbAppNote">🧩 Comes with an interactive app — Show app opens it.</span>' : '<span></span>') +
          '<button type="button" class="qbBtn qbPrimary" data-qb="add">➕ Add to page</button>' +
        '</div>';
      pane.scrollTop = 0;
    }
    function onPickerClick(e) {
      var t = e.target.closest ? e.target.closest('[data-qb],[data-qid],[data-qb-only]') : null;
      if (!t) return;
      if (t.hasAttribute('data-qid')) { selectRow(t.getAttribute('data-qid')); return; }
      if (t.hasAttribute('data-qb-only')) {
        pick.only = t.getAttribute('data-qb-only');
        Array.prototype.forEach.call(picker.querySelectorAll('[data-qb-only]'), function (b) { b.classList.toggle('on', b === t); });
        renderList();
        return;
      }
      var act = t.getAttribute('data-qb');
      if (act === 'close') closePicker();
      else if (act === 'refresh') {
        picker.querySelector('.qbList').innerHTML = '<div class="qbEmpty">Loading the question bank…</div>';
        load(true).then(function () { if (picker) { fillTopics(); renderList(); renderPreview(); } })
          .catch(function () { toast('The question bank could not be loaded.'); });
      } else if (act === 'add') addSelected();
    }
    function addSelected() {
      if (!teacher()) { closePicker(); return; }
      var e = entry(pick.sel);
      if (!e) return;
      var btn = picker && picker.querySelector('[data-qb="add"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Placing it on the page…'; }
      var snap = snapshotQuestion(e.q, e.owner);
      paintQuestion(snap).then(function (pic) {
        if (!teacher()) return null;   // the device changed hands while it painted
        return Promise.resolve(env.addToPage ? env.addToPage(pic, snap) : 0);
      }).then(function (pageNum) {
        if (pageNum == null) return;
        if (!pageNum) { if (btn) { btn.disabled = false; btn.textContent = '➕ Add to page'; } return; }
        closePicker();
        toast('📚 Added to page ' + pageNum + '. Tap it with Select to open it' + (hasApp(snap) ? ' or show its app.' : '.'), 4200);
      }).catch(function (err) {
        console.warn('Adding a bank question failed', err);
        toast('That question could not be put on the page: ' + ((err && err.message) || err));
        if (btn) { btn.disabled = false; btn.textContent = '➕ Add to page'; }
      });
    }
    function closePicker() {
      if (!picker) return;
      var p = picker;
      picker = null;
      p.classList.remove('in');
      setTimeout(function () { p.remove(); }, 160);
    }

    /* ---------- the question window ---------- */
    function stateFor(id) {
      return states[id] || (states[id] = { mcq: {}, blanks: {}, text: {}, checked: false, appOpen: false, ai: null, aiBusy: false });
    }
    function openQuestion(id, withApp) {
      var a = env.findAnnotation ? env.findAnnotation(id) : null;
      if (!a || !validSnapshot(a.bq)) { toast('That question is no longer on the page.'); return; }
      if (picker) closePicker();
      if (win) closeWindow(true);
      var st = stateFor(id);
      if (withApp && hasApp(a.bq)) st.appOpen = true;
      win = overlay('qbWinBack', 'Question');
      win.setAttribute('data-ann', id);
      win.addEventListener('click', onWinClick);
      win.addEventListener('input', onWinInput);
      renderWindow();
      focusCard(win);
      if (withApp) setTimeout(scrollToApp, 60);
    }
    function currentAnn() {
      if (!win) return null;
      var a = env.findAnnotation ? env.findAnnotation(win.getAttribute('data-ann')) : null;
      return a && validSnapshot(a.bq) ? a : null;
    }
    function renderWindow() {
      var a = currentAnn();
      if (!a) { closeWindow(); return; }
      var q = a.bq, st = stateFor(a.id);
      var app = hasApp(q);
      var score = st.checked ? markState(q, st) : null;
      var canMark = st.checked && !!env.mark && openItems(q, st).some(function (it) {
        return it.cer ? it.cer.some(function (p) { return p.student; }) : !!it.student;
      });
      var tags = questionTopics(q).map(function (t) { return '<span class="qbTag">' + escapeHtml(t) + '</span>'; }).join('');
      var keepScroll = win.querySelector('.qbWinBody');
      var scrollTop = keepScroll ? keepScroll.scrollTop : 0;
      var appHtml = '';
      if (app && st.appOpen) {
        appHtml = '<section class="qbApp" aria-label="Interactive app">' +
          '<div class="qbAppHead">🧩 Explore it — interactive</div>' +
          widgetBlocks(q).map(function (b) {
            var html = String(b.html || '').trim();
            if (html && root.QuestionApps) return '<div class="qbAppFrame">' + root.QuestionApps.frame(b) + '</div>';
            var link = root.QuestionApps && root.QuestionApps.validViewerUrl ? root.QuestionApps.validViewerUrl(b.appUrl) : '';
            return link ? '<a class="qbVideo" href="' + escapeHtml(link) + '" target="_blank" rel="noopener noreferrer">Open the app ↗</a>'
              : '<div class="qbEmpty">This app could not be opened here.</div>';
          }).join('') + '</section>';
      }
      var ai = st.ai ? '<div class="qbReveal qbAi"><div class="qbRevealHead">✨ ' + escapeHtml(env.aiName ? env.aiName() : 'AI') + ' marked your answer</div>' +
        (st.ai.items || []).map(function (it, i) {
          var v = String(it.verdict || '').toLowerCase();
          var icon = v === 'correct' ? '✅' : v === 'partial' ? '🟡' : '❌';
          return '<div class="qbAiRow">' + icon + ' ' + escapeHtml(it.feedback || v) + '</div>';
        }).join('') + (st.ai.summary ? '<div class="qbAiSum">' + escapeHtml(st.ai.summary) + '</div>' : '') + '</div>' : '';
      win.innerHTML =
        '<div class="qbWin" tabindex="-1">' +
          '<div class="qbHead">' +
            '<div class="qbHeadTitle"><span class="qbIcon">📝</span><div><h2>' + escapeHtml(questionTitle(q)) + '</h2>' +
            (tags ? '<div class="qbRowMeta">' + tags + '</div>' : '') + '</div></div>' +
            '<button type="button" class="qbClose" data-qb="close" aria-label="Close">✕</button>' +
          '</div>' +
          '<div class="qbWinBody">' +
            '<div class="qbQ">' + questionHtml(q, st, {}) + '</div>' +
            (score && score.total ? '<div class="qbScore ' + (score.right === score.total ? 'good' : '') + '">' + escapeHtml(scoreLine(score.right, score.total)) + '</div>' : '') +
            (st.checked ? revealHtml(q) : '') + ai + appHtml +
          '</div>' +
          '<div class="qbFoot">' +
            (st.checked
              ? '<button type="button" class="qbBtn" data-qb="retry">↺ Try again</button>'
              : '<button type="button" class="qbBtn qbPrimary" data-qb="check">✓ Check</button>') +
            (canMark ? '<button type="button" class="qbBtn" data-qb="mark"' + (st.aiBusy ? ' disabled' : '') + '>' +
              (st.aiBusy ? '✨ Marking…' : '✨ Mark my answer') + '</button>' : '') +
            '<span class="qbGrow"></span>' +
            (app ? '<button type="button" class="qbBtn qbAppBtn' + (st.checked && !st.appOpen ? ' glow' : '') + '" data-qb="app" aria-pressed="' + st.appOpen + '">' +
              (st.appOpen ? 'Hide app' : '🧩 Show app') + '</button>' : '') +
          '</div>' +
        '</div>';
      var body = win.querySelector('.qbWinBody');
      if (body) body.scrollTop = scrollTop;
    }
    function scrollToApp() {
      var el = win && win.querySelector('.qbApp');
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function onWinInput(e) {
      var a = currentAnn();
      if (!a) return;
      var st = stateFor(a.id);
      var t = e.target;
      if (t.hasAttribute('data-qb-text')) st.text[t.getAttribute('data-qb-text')] = t.value;
      else if (t.hasAttribute('data-qb-blank')) {
        var k = t.getAttribute('data-qb-blank');
        (st.blanks[k] = st.blanks[k] || [])[+t.getAttribute('data-qb-i')] = t.value;
      }
    }
    function onWinClick(e) {
      var a = currentAnn();
      if (!a) { closeWindow(); return; }
      var st = stateFor(a.id);
      var opt = e.target.closest ? e.target.closest('[data-qb-opt]') : null;
      if (opt && !opt.disabled) {
        var box = opt.closest('[data-qb-mcq]');
        st.mcq[box.getAttribute('data-qb-mcq')] = opt.getAttribute('data-qb-opt');
        Array.prototype.forEach.call(box.querySelectorAll('[data-qb-opt]'), function (b) { b.classList.toggle('picked', b === opt); });
        return;
      }
      var t = e.target.closest ? e.target.closest('[data-qb]') : null;
      if (!t) return;
      var act = t.getAttribute('data-qb');
      if (act === 'close') closeWindow();
      else if (act === 'check') { st.checked = true; renderWindow(); }
      else if (act === 'retry') { st.checked = false; st.ai = null; st.mcq = {}; st.blanks = {}; renderWindow(); }
      else if (act === 'app') {
        st.appOpen = !st.appOpen;
        renderWindow();
        if (st.appOpen) setTimeout(scrollToApp, 40);
      } else if (act === 'mark') runMark(a);
    }
    function runMark(a) {
      var st = stateFor(a.id);
      if (st.aiBusy || !env.mark) return;
      var items = openItems(a.bq, st);
      st.aiBusy = true;
      renderWindow();
      var id = a.id;
      Promise.resolve(env.mark(markPrompt(a.bq, items), a.bq)).then(function (raw) {
        var res = parseJsonLoose(raw);
        if (!res || !Array.isArray(res.items)) throw new Error('The marking reply could not be read');
        st.ai = { items: res.items.slice(0, items.length), summary: String(res.summary || '').slice(0, 400) };
      }).catch(function (err) {
        console.warn('Marking a bank question failed', err);
        toast('Marking did not work this time — the model answers are shown below each box.');
      }).then(function () {
        st.aiBusy = false;
        if (win && win.getAttribute('data-ann') === id) renderWindow();
      });
    }
    function closeWindow(instant) {
      if (!win) return;
      var w = win;
      win = null;
      // The app's frame goes with the window: a running simulation must not
      // carry on in a detached iframe.
      Array.prototype.forEach.call(w.querySelectorAll('iframe'), function (f) { try { f.src = 'about:blank'; } catch (e) {} f.remove(); });
      if (instant) { w.remove(); return; }
      w.classList.remove('in');
      setTimeout(function () { w.remove(); }, 160);
    }

    /* The device changed hands, or the worksheet went: nothing typed into a
       question by one person is left for the next, and the teacher's picker
       does not stay open for a student. */
    function roleChanged() {
      if (picker && !teacher()) closePicker();
      if (win) closeWindow(true);
      states = {};
    }
    function worksheetChanged() {
      closeWindow(true);
      states = {};
    }
    function forget(id) { delete states[id]; if (win && win.getAttribute('data-ann') === id) closeWindow(true); }

    return {
      openPicker: openPicker,
      closePicker: closePicker,
      openQuestion: openQuestion,
      closeWindow: function () { closeWindow(true); },
      roleChanged: roleChanged,
      worksheetChanged: worksheetChanged,
      forget: forget,
      isOpen: function () { return !!(picker || win); },
      load: load,
      _state: function (id) { return states[id]; }
    };
  }

  /* ---------------------------------------------------------------
     The QR code on paper
     --------------------------------------------------------------- */
  /* Draws the worksheet's link as a QR code in the top-right corner of a
     pdf-lib page, on a white pad so it reads on a dark scan, with a short
     label under it and a real link over it for the digital copy. Returns
     false (and draws nothing) when there is no QR library or the link is
     too long for a code a phone reads from across a desk. */
  function drawQrOnPdf(pdfDoc, page, url, lib, font) {
    var matrix = qrMatrix(url);
    if (!matrix || !page || !lib) return false;
    var W = page.getWidth(), H = page.getHeight();
    var at = qrPlacement(W, H, QR_PT);
    var n = matrix.length;
    var quiet = 2;                           // modules of white round the code
    var cell = at.size / (n + quiet * 2);
    var rgb = lib.rgb;
    page.drawRectangle({ x: at.x - 3, y: at.y - 12, width: at.size + 6, height: at.size + 15, color: rgb(1, 1, 1),
      borderColor: rgb(0.85, 0.85, 0.83), borderWidth: 0.6 });
    qrRuns(matrix).forEach(function (run) {
      page.drawRectangle({
        x: at.x + (quiet + run.c) * cell,
        y: at.y + at.size - (quiet + run.r + 1) * cell,
        width: run.len * cell + 0.01, height: cell + 0.01, color: rgb(0, 0, 0)
      });
    });
    if (font) {
      var size = 5.6;
      var tw = font.widthOfTextAtSize(QR_LABEL, size);
      page.drawText(QR_LABEL, { x: at.x + (at.size - tw) / 2, y: at.y - 8, size: size, font: font, color: rgb(0.3, 0.3, 0.28) });
    }
    try {
      var ref = pdfDoc.context.register(pdfDoc.context.obj({
        Type: 'Annot', Subtype: 'Link', Rect: [at.x, at.y, at.x + at.size, at.y + at.size],
        Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: lib.PDFString.of(url) }
      }));
      var annots = page.node.lookup(lib.PDFName.of('Annots'));
      if (annots) annots.push(ref);
      else page.node.set(lib.PDFName.of('Annots'), pdfDoc.context.obj([ref]));
    } catch (e) { /* the code still scans without the link */ }
    return true;
  }

  root.QuestionBank = Object.freeze({
    create: create,
    paintQuestion: paintQuestion,
    drawQrOnPdf: drawQrOnPdf,
    questionHtml: questionHtml,
    pure: Object.freeze({
      escapeHtml: escapeHtml, stripHtml: stripHtml, decodeEntities: decodeEntities,
      partOpens: partOpens, marksOf: marksOf, fbSegments: fbSegments, fbHasBlanks: fbHasBlanks,
      normAnswer: normAnswer, blankCorrect: blankCorrect, mcqStyle: mcqStyle, mcqLabel: mcqLabel,
      mcqOptionText: mcqOptionText, tableGrid: tableGrid, tableCells: tableCells, columnWidths: columnWidths,
      widgetBlocks: widgetBlocks, hasApp: hasApp, isMcq: isMcq, hasOpenAnswer: hasOpenAnswer,
      questionPlain: questionPlain, questionTopics: questionTopics, questionTitle: questionTitle,
      searchWords: searchWords, filterQuestions: filterQuestions, allTopics: allTopics,
      snapshotQuestion: snapshotQuestion, validSnapshot: validSnapshot, safeUrl: safeUrl, imageUrl: imageUrl,
      placeOnPage: placeOnPage, qrPlacement: qrPlacement, qrMatrix: qrMatrix, qrRuns: qrRuns,
      scoreLine: scoreLine, parseJsonLoose: parseJsonLoose, markState: markState, openItems: openItems,
      markPrompt: markPrompt, questionImageUrls: questionImageUrls, cleanStyle: cleanStyle,
      WIDGET_MAX_CHARS: WIDGET_MAX_CHARS, QR_LABEL: QR_LABEL
    })
  });
})(typeof window !== 'undefined' ? window : globalThis);
