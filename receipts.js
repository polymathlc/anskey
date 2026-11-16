/* 🧾 Receipts (v1.205.0) — write a receipt by hand and send it to a parent.

   window.Receipts = { pure, create(env), drawPdf(PDFLib, receipt, centre) }

   WHAT IT IS: a window with three tabs.
     ✍️ New receipt   — who paid, for what, how much, how; a live preview of
                        exactly what the parent will receive; Save, Send,
                        ⬇ PDF, Open in Gmail instead.
     📚 Receipts      — every receipt kept, newest first, searchable; open one
                        to resend it, download it again, copy it into a new
                        one, or void it.
     🏫 Centre details — the name, address, UEN, contact, number prefix and
                        the footer printed on every receipt.

   THE RULES THIS FILE HOLDS (all pure, all tested in tools/receipts-tests.mjs):
     - MONEY IS WHOLE CENTS, never floating dollars. `parseMoney` is the one
       door from typed text to cents and `formatMoney` the one door back, so
       0.1 + 0.2 can never print as 0.30000000000000004 on a parent's receipt.
     - `cleanReceipt` is the ONE door into the stored shape: everything typed
       is trimmed and capped, a line with no description and no amount is
       dropped, quantities are whole numbers 1–999, emails are checked.
     - `totals` is the ONE place a total is worked out. The stored `total` is
       written from it at save time, so the list, the email, the PDF and the
       preview can never disagree about how much was paid.
     - A receipt NUMBER is given once, by the glue's transaction on the
       teacher's settings record (`receiptCounters.<year>`), and never
       re-used: `numberFor(prefix, year, seq)` → "PLC-2026-0007".
     - A SENT receipt is never edited. It can be resent, downloaded, copied
       into a new draft, or voided (which keeps it, marked VOID, with the
       reason). Changing a receipt a parent already holds is how two copies
       of one number come to say different amounts.
     - NOTHING IS SENT BY ITSELF. Only the Send button, behind a confirm that
       names the addresses and the amount, calls `env.sendGmail`.

   Everything drawn in the window is written with textContent; the preview is
   a sandboxed srcdoc frame; `emailHtml` escapes every field. Every key pressed
   in the window stops at `.rcBack`, and a document-capture Escape closes it
   after a redraw drops focus. */
(function () {
  'use strict';

  var VERSION = 1;
  var SENDER = 'admin@polymathlc.com.sg';
  var CENTRE = 'Polymath Learning Centre';
  var CURRENCY = 'SGD';
  var CURRENCY_MARK = 'S$';
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
  var PREFIX_RE = /^[A-Z0-9]{1,8}$/;
  var AT_MIN = Date.UTC(2020, 0, 1);
  var AT_MAX = Date.UTC(2100, 0, 1);
  var MAX_CENTS = 100000000;            // S$1,000,000.00 — anything past this is a typo
  var GMAIL_URL_MAX = 7600;

  var LIMITS = {
    items: 20,
    desc: 160,
    name: 80,
    billTo: 120,
    ref: 80,
    note: 600,
    emails: 6,
    sends: 30,
    voidReason: 200,
    centreName: 80,
    address: 240,
    uen: 20,
    phone: 40,
    footer: 400,
    payInfo: 300,
    qtyMax: 999,
    gstMax: 20
  };

  var METHODS = [
    { id: 'paynow', label: 'PayNow' },
    { id: 'bank', label: 'Bank transfer' },
    { id: 'cash', label: 'Cash' },
    { id: 'cheque', label: 'Cheque' },
    { id: 'card', label: 'Card' },
    { id: 'other', label: 'Other' }
  ];

  var STATUSES = ['draft', 'sent', 'void'];

  /* The quick-add lines. `{month}` is replaced by the receipt month. */
  var PRESETS = [
    { id: 'tuition', label: 'Tuition fee', desc: 'Tuition fee — {month}' },
    { id: 'lessons', label: 'Lessons', desc: 'Lessons — {month} (4 lessons)' },
    { id: 'registration', label: 'Registration', desc: 'Registration fee' },
    { id: 'materials', label: 'Materials', desc: 'Materials fee — {month}' },
    { id: 'holiday', label: 'Holiday programme', desc: 'Holiday programme' },
    { id: 'deposit', label: 'Deposit', desc: 'Deposit (refundable)' }
  ];

  var DEFAULT_CENTRE = {
    name: CENTRE,
    address: '',
    uen: '',
    phone: '',
    email: SENDER,
    prefix: 'PLC',
    gst: 0,
    payInfo: '',
    footer: 'Thank you! This receipt was issued by computer and needs no signature.'
  };

  /* ---------------- small text helpers ---------------- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function cleanText(v, max) {
    if (v == null) return '';
    var s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n');
    s = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (max && s.length > max) s = s.slice(0, Math.max(0, max - 1)).replace(/\s+$/, '') + '…';
    return s;
  }

  function oneLine(v, max) { return cleanText(String(v == null ? '' : v).replace(/\s*\n\s*/g, ' '), max); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var EMAIL_RE = /^[^\s@<>(),;:"\[\]\\]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
  function normEmail(v) {
    var s = String(v == null ? '' : v).trim().replace(/^mailto:/i, '').toLowerCase();
    return EMAIL_RE.test(s) && s.length <= 254 ? s : '';
  }

  /* Any list of addresses, typed with commas, semicolons, spaces or new lines. */
  function parseEmails(text) {
    var seen = Object.create(null), out = [];
    var parts = Array.isArray(text) ? text : String(text == null ? '' : text).split(/[\s,;]+/);
    parts.forEach(function (part) {
      var m = /<([^>]+)>/.exec(String(part));
      var e = normEmail(m ? m[1] : part);
      if (e && !seen[e]) { seen[e] = true; out.push(e); }
    });
    return out;
  }

  /* The words typed that are NOT addresses, so the window can say which. */
  function badEmails(text) {
    return String(text == null ? '' : text).split(/[\s,;]+/).map(function (p) { return p.trim(); })
      .filter(function (p) { return p && !normEmail((/<([^>]+)>/.exec(p) || [])[1] || p); });
  }

  function toMillis(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    return 0;
  }

  function cleanAt(v) {
    var n = toMillis(v);
    return n >= AT_MIN && n <= AT_MAX ? Math.round(n) : 0;
  }

  /* ---------------- days ---------------- */

  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  /* The calendar day in Singapore (receipts are dated where the centre is). */
  function dayKey(ms) {
    var d = new Date((typeof ms === 'number' ? ms : Date.now()) + 8 * 3600 * 1000);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  function validDay(day) {
    if (!DAY_RE.test(String(day || ''))) return false;
    var p = String(day).split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2] && p[0] >= 2020 && p[0] < 2100;
  }

  function dayLabel(day) {
    if (!validDay(day)) return '';
    var p = String(day).split('-').map(Number);
    return p[2] + ' ' + MONTHS[p[1] - 1] + ' ' + p[0];
  }

  function monthLabel(day) {
    if (!validDay(day)) return '';
    var p = String(day).split('-').map(Number);
    return MONTHS[p[1] - 1] + ' ' + p[0];
  }

  function yearOf(day) { return validDay(day) ? Number(String(day).slice(0, 4)) : Number(dayKey(Date.now()).slice(0, 4)); }

  /* ---------------- money (whole cents) ---------------- */

  /* "1280", "$1,280.50", "S$ 1280.5", "1280.505" → cents (half up); bad → NaN. */
  function parseMoney(v) {
    if (typeof v === 'number') {
      if (!isFinite(v)) return NaN;
      return Math.round(v * 100);
    }
    var s = String(v == null ? '' : v).trim().replace(/^(?:S?\$|SGD)\s*/i, '').replace(/,/g, '').replace(/\s+/g, '');
    if (!s) return NaN;
    var neg = false;
    if (s.charAt(0) === '-') { neg = true; s = s.slice(1); }
    if (!/^\d+(?:\.\d*)?$|^\.\d+$/.test(s)) return NaN;
    var parts = s.split('.');
    var whole = parts[0] ? Number(parts[0]) : 0;
    var frac = (parts[1] || '') + '000';
    var cents = whole * 100 + Number(frac.slice(0, 2));
    if (Number(frac.charAt(2)) >= 5) cents += 1;
    return neg ? -cents : cents;
  }

  /* Cents for a field that must be money: blank is 0, nonsense is 0, out of range is clamped. */
  function cents(v, allowNegative) {
    var n = typeof v === 'number' && Math.round(v) === v && Math.abs(v) <= MAX_CENTS ? v : NaN;
    if (isNaN(n)) n = 0;
    if (!allowNegative && n < 0) n = 0;
    return Math.max(-MAX_CENTS, Math.min(MAX_CENTS, n));
  }

  function groupThousands(s) {
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatMoney(c, opts) {
    opts = opts || {};
    var n = Math.round(Number(c) || 0);
    var neg = n < 0;
    n = Math.abs(n);
    var s = groupThousands(String(Math.floor(n / 100))) + '.' + pad2(n % 100);
    var mark = opts.bare ? '' : CURRENCY_MARK;
    return (neg ? '−' : '') + mark + s;
  }

  /* What goes back into an input box: plain, no mark, no separators. */
  function moneyInput(c) {
    var n = Math.round(Number(c) || 0);
    if (!n) return '';
    var neg = n < 0;
    n = Math.abs(n);
    return (neg ? '-' : '') + Math.floor(n / 100) + '.' + pad2(n % 100);
  }

  /* ---------------- the shape ---------------- */

  function cleanQty(v) {
    var n = Math.round(Number(v));
    if (!isFinite(n) || n < 1) return 1;
    return Math.min(LIMITS.qtyMax, n);
  }

  function cleanItem(it) {
    if (!it || typeof it !== 'object') return null;
    var desc = oneLine(it.desc, LIMITS.desc);
    var unit = typeof it.unit === 'number' ? cents(it.unit, true) : cents(parseMoney(it.unit), true);
    var qty = cleanQty(it.qty == null ? 1 : it.qty);
    if (!desc && !unit) return null;
    return { desc: desc || 'Item', qty: qty, unit: unit };
  }

  function cleanMethod(v) {
    var s = String(v || '').toLowerCase();
    return METHODS.some(function (m) { return m.id === s; }) ? s : 'paynow';
  }

  function methodLabel(id) {
    var m = METHODS.filter(function (x) { return x.id === id; })[0];
    return m ? m.label : 'Other';
  }

  function cleanPrefix(v) {
    var s = String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    return PREFIX_RE.test(s) ? s : DEFAULT_CENTRE.prefix;
  }

  function cleanGst(v) {
    var n = Number(v);
    if (!isFinite(n) || n <= 0) return 0;
    return Math.min(LIMITS.gstMax, Math.round(n * 100) / 100);
  }

  function numberFor(prefix, year, seq) {
    var y = Math.round(Number(year));
    var n = Math.round(Number(seq));
    if (!(y >= 2020 && y < 2100) || !(n >= 1)) return '';
    var digits = String(n);
    while (digits.length < 4) digits = '0' + digits;
    return cleanPrefix(prefix) + '-' + y + '-' + digits;
  }

  var NUMBER_RE = /^([A-Z0-9]{1,8})-(\d{4})-(\d{4,7})$/;
  function parseNumber(no) {
    var m = NUMBER_RE.exec(String(no || ''));
    if (!m) return null;
    return { prefix: m[1], year: Number(m[2]), seq: Number(m[3]) };
  }

  function cleanSends(list) {
    return (Array.isArray(list) ? list : []).map(function (s) {
      if (!s || typeof s !== 'object') return null;
      var at = cleanAt(s.at);
      if (!at) return null;
      return {
        at: at,
        to: parseEmails(s.to || []).slice(0, LIMITS.emails),
        via: s.via === 'compose' ? 'compose' : 'gmail',
        from: normEmail(s.from) || ''
      };
    }).filter(Boolean).slice(-LIMITS.sends);
  }

  function cleanCentre(c) {
    c = c && typeof c === 'object' ? c : {};
    return {
      name: oneLine(c.name, LIMITS.centreName) || DEFAULT_CENTRE.name,
      address: cleanText(c.address, LIMITS.address),
      uen: oneLine(c.uen, LIMITS.uen).toUpperCase(),
      phone: oneLine(c.phone, LIMITS.phone),
      email: normEmail(c.email) || SENDER,
      prefix: cleanPrefix(c.prefix == null ? DEFAULT_CENTRE.prefix : c.prefix),
      gst: cleanGst(c.gst),
      payInfo: cleanText(c.payInfo, LIMITS.payInfo),
      footer: c.footer == null ? DEFAULT_CENTRE.footer : cleanText(c.footer, LIMITS.footer)
    };
  }

  /* The ONE door into the stored shape. `ctx.now` dates a receipt with no day. */
  function cleanReceipt(r, ctx) {
    r = r && typeof r === 'object' ? r : {};
    ctx = ctx || {};
    var now = typeof ctx.now === 'number' ? ctx.now : Date.now();
    var issued = validDay(r.issued) ? r.issued : dayKey(now);
    var paidOn = validDay(r.paidOn) ? r.paidOn : issued;
    var items = (Array.isArray(r.items) ? r.items : []).map(cleanItem).filter(Boolean).slice(0, LIMITS.items);
    var student = r.student && typeof r.student === 'object' ? r.student : {};
    var status = STATUSES.indexOf(r.status) >= 0 ? r.status : 'draft';
    var out = {
      v: VERSION,
      id: ID_RE.test(String(r.id || '')) ? String(r.id) : '',
      no: parseNumber(r.no) ? String(r.no) : '',
      issued: issued,
      paidOn: paidOn,
      student: {
        uid: ID_RE.test(String(student.uid || '')) ? String(student.uid) : '',
        name: oneLine(student.name, LIMITS.name),
        level: oneLine(student.level, 8)
      },
      billTo: oneLine(r.billTo, LIMITS.billTo),
      emails: parseEmails(r.emails || []).slice(0, LIMITS.emails),
      items: items,
      discount: cents(typeof r.discount === 'number' ? r.discount : parseMoney(r.discount), false),
      discountNote: oneLine(r.discountNote, LIMITS.desc),
      gst: cleanGst(r.gst),
      method: cleanMethod(r.method),
      ref: oneLine(r.ref, LIMITS.ref),
      note: cleanText(r.note, LIMITS.note),
      currency: CURRENCY,
      status: status,
      sends: cleanSends(r.sends),
      createdAt: cleanAt(r.createdAt) || now,
      at: cleanAt(r.at) || now,
      voidReason: status === 'void' ? oneLine(r.voidReason, LIMITS.voidReason) : '',
      voidAt: status === 'void' ? (cleanAt(r.voidAt) || now) : 0
    };
    var t = totals(out);
    out.subtotal = t.subtotal;
    out.total = t.total;
    return out;
  }

  /* The ONE place money is added up. GST (when the centre charges it) is on
     the amount after the discount, half up to the cent. */
  function totals(r) {
    r = r || {};
    var subtotal = 0;
    (r.items || []).forEach(function (it) {
      if (!it) return;
      subtotal += cents(typeof it.unit === 'number' ? it.unit : parseMoney(it.unit), true) * cleanQty(it.qty == null ? 1 : it.qty);
    });
    subtotal = Math.max(-MAX_CENTS, Math.min(MAX_CENTS, subtotal));
    var discount = Math.min(Math.max(0, cents(typeof r.discount === 'number' ? r.discount : parseMoney(r.discount), false)), Math.max(0, subtotal));
    var net = subtotal - discount;
    var rate = cleanGst(r.gst);
    var gst = rate ? Math.round(net * rate / 100) : 0;
    return { subtotal: subtotal, discount: discount, net: net, gstRate: rate, gst: gst, total: net + gst };
  }

  /* What is missing before a receipt can be SENT (saving a draft needs less). */
  function problems(r, forSend) {
    var out = [];
    if (!r) return ['There is no receipt.'];
    if (!r.student || !r.student.name) out.push('Type the student’s name.');
    if (!r.items || !r.items.length) out.push('Add at least one line — what the payment was for.');
    var t = totals(r);
    if (r.items && r.items.length && t.total <= 0) out.push('The total must be more than ' + formatMoney(0) + '.');
    if (r.items && r.items.some(function (it) { return it.unit < 0; }) && t.subtotal <= 0) out.push('A line has a negative amount.');
    if (forSend) {
      if (!r.emails || !r.emails.length) out.push('Type the parent’s email address.');
      if (r.status === 'void') out.push('This receipt was voided, so it cannot be sent.');
    }
    return out;
  }

  function isLocked(r) { return !!r && (r.status === 'sent' || r.status === 'void'); }

  /* A copy of a receipt as a fresh draft: no number, no sends, today. */
  function duplicate(r, now) {
    var src = cleanReceipt(r, { now: now });
    var copy = JSON.parse(JSON.stringify(src));
    copy.id = '';
    copy.no = '';
    copy.status = 'draft';
    copy.sends = [];
    copy.voidReason = '';
    copy.voidAt = 0;
    copy.issued = dayKey(typeof now === 'number' ? now : Date.now());
    copy.paidOn = copy.issued;
    copy.createdAt = 0;
    copy.at = 0;
    copy.ref = '';
    return cleanReceipt(copy, { now: now });
  }

  function blank(now, centre) {
    var c = cleanCentre(centre);
    return cleanReceipt({ items: [], gst: c.gst, method: 'paynow' }, { now: now });
  }

  function presetDesc(preset, day) {
    var p = typeof preset === 'string' ? PRESETS.filter(function (x) { return x.id === preset; })[0] : preset;
    if (!p) return '';
    return p.desc.replace('{month}', monthLabel(day) || monthLabel(dayKey(Date.now())));
  }

  /* ---------------- the list ---------------- */

  function receiptsOf(list) {
    return (Array.isArray(list) ? list : []).map(function (r) { return cleanReceipt(r); })
      .filter(function (r) { return r.id; })
      .sort(function (a, b) { return (b.createdAt - a.createdAt) || String(b.no).localeCompare(String(a.no)); });
  }

  function searchText(r) {
    return [r.no, r.student.name, r.student.level, r.billTo, r.emails.join(' '), r.ref,
      r.items.map(function (i) { return i.desc; }).join(' '), methodLabel(r.method), r.status, formatMoney(r.total)].join(' ').toLowerCase();
  }

  /* Every word typed must match. A status filter of '' means all. */
  function filterReceipts(list, query, status) {
    var words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    return (list || []).filter(function (r) {
      if (status && r.status !== status) return false;
      if (!words.length) return true;
      var hay = searchText(r);
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
  }

  function sumSent(list, year) {
    var n = 0, total = 0;
    (list || []).forEach(function (r) {
      if (r.status !== 'sent') return;
      if (year && yearOf(r.issued) !== year) return;
      n++;
      total += r.total;
    });
    return { count: n, total: total };
  }

  function lastSentAt(r) {
    var s = (r && r.sends) || [];
    return s.length ? s[s.length - 1].at : 0;
  }

  /* ---------------- the roster ---------------- */

  /* studentProfiles rows → [{uid, name, level, parents[], email}] by name. */
  function rosterOf(rows) {
    var out = [];
    (rows || []).forEach(function (row) {
      var p = row && (row.p || row);
      var uid = row && (row.uid || (p && p.uid));
      if (!p || !uid || !ID_RE.test(String(uid))) return;
      var email = normEmail(p.email);
      out.push({
        uid: String(uid),
        name: oneLine(p.name, LIMITS.name) || (email ? email.split('@')[0] : 'Student'),
        level: oneLine(p.level, 8),
        parents: parseEmails(Array.isArray(p.parentEmails) ? p.parentEmails : []).slice(0, LIMITS.emails),
        email: email
      });
    });
    out.sort(function (a, b) { return a.name.localeCompare(b.name) || a.uid.localeCompare(b.uid); });
    return out;
  }

  function findStudents(roster, query) {
    var words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return (roster || []).slice(0, 30);
    return (roster || []).filter(function (s) {
      var hay = (s.name + ' ' + s.level + ' ' + s.parents.join(' ')).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    }).slice(0, 30);
  }

  /* ---------------- the email ---------------- */

  function subjectLine(r, centre) {
    var c = cleanCentre(centre);
    var who = r && r.student && r.student.name ? ' — ' + r.student.name : '';
    var no = r && r.no ? 'Receipt ' + r.no : 'Receipt';
    return oneLine(no + who + ' — ' + c.name, 180);
  }

  var COLORS = { ink: '#2b2118', soft: '#6b5a4a', line: '#efe3d3', accent: '#c96a12', card: '#fff8ee', void: '#b3261e', ok: '#2e7d32' };

  function emailHtml(r, centre, opts) {
    opts = opts || {};
    var c = cleanCentre(centre);
    var t = totals(r);
    var e = escapeHtml;
    var C = COLORS;
    var td = 'padding:8px 10px;border-bottom:1px solid ' + C.line + ';vertical-align:top;';
    var rows = (r.items || []).map(function (it) {
      return '<tr><td style="' + td + '">' + e(it.desc) + '</td>' +
        '<td style="' + td + 'text-align:center;white-space:nowrap;">' + e(it.qty) + '</td>' +
        '<td style="' + td + 'text-align:right;white-space:nowrap;">' + e(formatMoney(it.unit)) + '</td>' +
        '<td style="' + td + 'text-align:right;white-space:nowrap;">' + e(formatMoney(it.unit * it.qty)) + '</td></tr>';
    }).join('');
    var sumRow = function (label, value, strong) {
      return '<tr><td colspan="3" style="padding:6px 10px;text-align:right;color:' + (strong ? C.ink : C.soft) + ';' + (strong ? 'font-weight:700;font-size:16px;' : '') + '">' + e(label) + '</td>' +
        '<td style="padding:6px 10px;text-align:right;white-space:nowrap;' + (strong ? 'font-weight:700;font-size:16px;' : '') + '">' + e(value) + '</td></tr>';
    };
    var sums = '';
    if (t.discount || t.gst) sums += sumRow('Subtotal', formatMoney(t.subtotal));
    if (t.discount) sums += sumRow('Discount' + (r.discountNote ? ' (' + r.discountNote + ')' : ''), '−' + formatMoney(t.discount));
    if (t.gst) sums += sumRow('GST ' + t.gstRate + '%', formatMoney(t.gst));
    sums += sumRow('Total paid', formatMoney(t.total), true);
    var meta = function (label, value) {
      return value ? '<tr><td style="padding:3px 14px 3px 0;color:' + C.soft + ';white-space:nowrap;">' + e(label) + '</td><td style="padding:3px 0;">' + e(value) + '</td></tr>' : '';
    };
    var centreBits = [c.address, c.uen ? 'UEN ' + c.uen : '', [c.phone, c.email].filter(Boolean).join(' · ')].filter(Boolean)
      .map(function (s) { return e(s).replace(/\n/g, '<br>'); }).join('<br>');
    var voidBanner = r.status === 'void'
      ? '<div style="margin:0 0 16px;padding:10px 14px;border:2px solid ' + C.void + ';color:' + C.void + ';border-radius:10px;font-weight:700;">VOID' + (r.voidReason ? ' — ' + e(r.voidReason) : '') + '</div>' : '';
    var draftBanner = !r.no && opts.preview
      ? '<div style="margin:0 0 16px;padding:8px 12px;background:' + C.card + ';border:1px dashed ' + C.accent + ';border-radius:10px;color:' + C.soft + ';font-size:13px;">Preview — the receipt number is given when you save or send.</div>' : '';
    var intro = opts.intro ? '<p style="margin:0 0 18px;line-height:1.6;">' + e(opts.intro).replace(/\n/g, '<br>') + '</p>' : '';
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
      '<body style="margin:0;padding:24px 12px;background:#f6f1ea;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:' + C.ink + ';">' +
      '<div style="max-width:620px;margin:0 auto;background:#fff;border-radius:16px;padding:28px 26px;border:1px solid ' + C.line + ';">' +
      intro + draftBanner + voidBanner +
      '<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px;"><tr>' +
      '<td style="vertical-align:top;"><div style="font-size:20px;font-weight:700;">' + e(c.name) + '</div>' +
      (centreBits ? '<div style="font-size:13px;color:' + C.soft + ';line-height:1.6;margin-top:6px;">' + centreBits + '</div>' : '') + '</td>' +
      '<td style="vertical-align:top;text-align:right;"><div style="font-size:13px;letter-spacing:.12em;color:' + C.accent + ';font-weight:700;">RECEIPT</div>' +
      '<div style="font-size:16px;font-weight:700;margin-top:4px;">' + e(r.no || 'Draft') + '</div>' +
      '<div style="font-size:13px;color:' + C.soft + ';margin-top:4px;">' + e(dayLabel(r.issued)) + '</div></td>' +
      '</tr></table>' +
      '<table role="presentation" style="border-collapse:collapse;font-size:14px;margin:0 0 20px;">' +
      meta('Student', [r.student.name, r.student.level].filter(Boolean).join(' · ')) +
      meta('Received from', r.billTo) +
      meta('Paid on', dayLabel(r.paidOn)) +
      meta('Payment', methodLabel(r.method) + (r.ref ? ' · ref ' + r.ref : '')) +
      '</table>' +
      '<table style="width:100%;border-collapse:collapse;font-size:14px;">' +
      '<thead><tr style="background:' + C.card + ';">' +
      '<th style="padding:8px 10px;text-align:left;">Description</th><th style="padding:8px 10px;">Qty</th>' +
      '<th style="padding:8px 10px;text-align:right;">Unit</th><th style="padding:8px 10px;text-align:right;">Amount</th></tr></thead>' +
      '<tbody>' + rows + '</tbody><tfoot>' + sums + '</tfoot></table>' +
      (r.note ? '<p style="margin:20px 0 0;line-height:1.6;font-size:14px;">' + e(r.note).replace(/\n/g, '<br>') + '</p>' : '') +
      (c.payInfo ? '<p style="margin:16px 0 0;line-height:1.6;font-size:13px;color:' + C.soft + ';">' + e(c.payInfo).replace(/\n/g, '<br>') + '</p>' : '') +
      (c.footer ? '<p style="margin:22px 0 0;padding-top:14px;border-top:1px solid ' + C.line + ';font-size:12px;color:' + C.soft + ';line-height:1.6;">' + e(c.footer).replace(/\n/g, '<br>') + '</p>' : '') +
      '</div></body></html>';
  }

  function emailText(r, centre, opts) {
    opts = opts || {};
    var c = cleanCentre(centre);
    var t = totals(r);
    var L = [];
    if (opts.intro) L.push(opts.intro, '');
    if (r.status === 'void') L.push('*** VOID' + (r.voidReason ? ' — ' + r.voidReason : '') + ' ***', '');
    L.push(c.name);
    if (c.address) L.push(c.address);
    if (c.uen) L.push('UEN ' + c.uen);
    var contact = [c.phone, c.email].filter(Boolean).join(' · ');
    if (contact) L.push(contact);
    L.push('', 'RECEIPT ' + (r.no || '(draft)'), 'Date: ' + dayLabel(r.issued), '');
    L.push('Student: ' + [r.student.name, r.student.level].filter(Boolean).join(' · '));
    if (r.billTo) L.push('Received from: ' + r.billTo);
    L.push('Paid on: ' + dayLabel(r.paidOn));
    L.push('Payment: ' + methodLabel(r.method) + (r.ref ? ' · ref ' + r.ref : ''), '');
    (r.items || []).forEach(function (it) {
      L.push('- ' + it.desc + (it.qty > 1 ? ' × ' + it.qty + ' @ ' + formatMoney(it.unit) : '') + ': ' + formatMoney(it.unit * it.qty));
    });
    L.push('');
    if (t.discount || t.gst) L.push('Subtotal: ' + formatMoney(t.subtotal));
    if (t.discount) L.push('Discount' + (r.discountNote ? ' (' + r.discountNote + ')' : '') + ': −' + formatMoney(t.discount));
    if (t.gst) L.push('GST ' + t.gstRate + '%: ' + formatMoney(t.gst));
    L.push('TOTAL PAID: ' + formatMoney(t.total));
    if (r.note) L.push('', r.note);
    if (c.payInfo) L.push('', c.payInfo);
    if (c.footer) L.push('', c.footer);
    return L.join('\n');
  }

  function defaultIntro(r, centre) {
    var c = cleanCentre(centre);
    var who = r && r.billTo ? r.billTo : 'Parent';
    var name = r && r.student && r.student.name ? r.student.name : 'your child';
    return 'Dear ' + who + ',\n\nThank you for your payment for ' + name + '. Your receipt is below and attached as a PDF.\n\nWarm regards,\n' + c.name;
  }

  function fileName(r) {
    var base = (r && r.no ? r.no : 'receipt-draft') + (r && r.student && r.student.name ? ' ' + r.student.name : '');
    return base.replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) + '.pdf';
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

  function encodeHeader(v) {
    var s = String(v == null ? '' : v).replace(/[\r\n]+/g, ' ');
    if (/^[\x20-\x7e]*$/.test(s)) return s;
    return '=?UTF-8?B?' + b64Utf8(s) + '?=';
  }

  function headerAddresses(list) { return parseEmails(list || []).join(', '); }

  /* A file name in a header: ASCII only, quotes and slashes gone. */
  function safeFileName(name) {
    var s = String(name || 'receipt.pdf').replace(/[^\x20-\x7e]/g, '_').replace(/["\\\/]/g, '_');
    return s || 'receipt.pdf';
  }

  /* multipart/mixed { multipart/alternative { text, html }, the PDF }.
     m: { from, fromName, to:[], cc:[], bcc:[], replyTo, subject, text, html,
          attachment: { name, data(base64), mime } } */
  function mimeMessage(m, boundarySeed) {
    m = m || {};
    var seed = String(boundarySeed || Date.now().toString(36)).replace(/[^A-Za-z0-9]/g, '');
    var mix = 'mix_' + seed, alt = 'alt_' + seed;
    var CRLF = '\r\n';
    var from = normEmail(m.from);
    var L = [];
    L.push('From: ' + (m.fromName ? encodeHeader(m.fromName) + ' <' + from + '>' : from));
    var to = headerAddresses(m.to);
    if (to) L.push('To: ' + to);
    var cc = headerAddresses(m.cc);
    if (cc) L.push('Cc: ' + cc);
    var bcc = headerAddresses(m.bcc);
    if (bcc) L.push('Bcc: ' + bcc);
    if (normEmail(m.replyTo)) L.push('Reply-To: ' + normEmail(m.replyTo));
    L.push('Subject: ' + encodeHeader(m.subject || ''));
    L.push('MIME-Version: 1.0');
    var att = m.attachment && m.attachment.data ? m.attachment : null;
    if (att) {
      L.push('Content-Type: multipart/mixed; boundary="' + mix + '"');
      L.push('');
      L.push('--' + mix);
    }
    L.push('Content-Type: multipart/alternative; boundary="' + alt + '"');
    L.push('');
    L.push('--' + alt);
    L.push('Content-Type: text/plain; charset="UTF-8"');
    L.push('Content-Transfer-Encoding: base64');
    L.push('');
    L.push(wrap76(b64Utf8(m.text || '')));
    L.push('--' + alt);
    L.push('Content-Type: text/html; charset="UTF-8"');
    L.push('Content-Transfer-Encoding: base64');
    L.push('');
    L.push(wrap76(b64Utf8(m.html || '')));
    L.push('--' + alt + '--');
    if (att) {
      var name = safeFileName(att.name);
      L.push('--' + mix);
      L.push('Content-Type: ' + (att.mime || 'application/pdf') + '; name="' + name + '"');
      L.push('Content-Transfer-Encoding: base64');
      L.push('Content-Disposition: attachment; filename="' + name + '"');
      L.push('');
      L.push(wrap76(String(att.data).replace(/\s+/g, '')));
      L.push('--' + mix + '--');
    }
    L.push('');
    return L.join(CRLF);
  }

  /* Gmail's own compose window (the fallback when the API cannot be used). */
  function composePlan(m) {
    m = m || {};
    var enc = function (s) { return encodeURIComponent(String(s == null ? '' : s)); };
    var build = function (body) {
      var q = ['view=cm', 'fs=1'];
      if (m.account) q.push('authuser=' + enc(m.account));
      if (m.to && m.to.length) q.push('to=' + enc([].concat(m.to).join(',')));
      if (m.subject) q.push('su=' + enc(m.subject));
      if (body) q.push('body=' + enc(body));
      return 'https://mail.google.com/mail/?' + q.join('&');
    };
    var full = build(m.body);
    if (full.length <= GMAIL_URL_MAX) return { url: full, copyBody: false };
    var bare = build('');
    return { url: bare, copyBody: true };
  }

  /* ---------------- the PDF (pdf-lib, Helvetica, WinAnsi only) ---------------- */

  /* Helvetica in pdf-lib can only draw WinAnsi. A name in Chinese, an emoji
     or a stray symbol would throw and lose the whole PDF, so every string is
     passed through the font first and anything it cannot draw becomes "?". */
  var PDF_SWAP = { '−': '-', '→': '->', ' ': ' ', ' ': ' ', ' ': ' ' };
  function pdfSafe(font, s) {
    var out = '';
    String(s == null ? '' : s).split('').forEach(function (ch) {
      if (PDF_SWAP[ch]) ch = PDF_SWAP[ch];
      if (ch === '\n' || ch === '\t') { out += ' '; return; }
      try { font.widthOfTextAtSize(ch, 10); out += ch; }
      catch (e) { out += '?'; }
    });
    return out;
  }

  function wrapLines(font, size, text, width) {
    var out = [];
    String(text || '').split('\n').forEach(function (para) {
      var words = para.split(/\s+/).filter(Boolean);
      var line = '';
      words.forEach(function (w) {
        var tryLine = line ? line + ' ' + w : w;
        if (font.widthOfTextAtSize(tryLine, size) <= width || !line) {
          // A single word longer than the line is cut, never drawn off the page.
          while (font.widthOfTextAtSize(tryLine, size) > width && tryLine.length > 1) {
            var cut = tryLine.length - 1;
            while (cut > 1 && font.widthOfTextAtSize(tryLine.slice(0, cut), size) > width) cut--;
            out.push(tryLine.slice(0, cut));
            tryLine = tryLine.slice(cut);
          }
          line = tryLine;
        } else {
          out.push(line);
          line = w;
        }
      });
      out.push(line);
    });
    return out;
  }

  async function drawPdf(PDFLib, receipt, centre) {
    if (!PDFLib || !PDFLib.PDFDocument) throw new Error('The PDF library has not loaded yet.');
    var r = cleanReceipt(receipt);
    var c = cleanCentre(centre);
    var t = totals(r);
    var doc = await PDFLib.PDFDocument.create();
    doc.setTitle('Receipt ' + (r.no || 'draft'));
    doc.setAuthor(c.name);
    doc.setCreator('Polymath Ans Key');
    var font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    var bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    var rgb = PDFLib.rgb;
    var INK = rgb(0.17, 0.13, 0.09), SOFT = rgb(0.42, 0.35, 0.29), LINE = rgb(0.94, 0.89, 0.83);
    var ACCENT = rgb(0.79, 0.42, 0.07), CARD = rgb(1, 0.97, 0.93), RED = rgb(0.7, 0.15, 0.12);
    var W = 595.28, H = 841.89, M = 50;
    // addPage() then setSize: an array made in another realm (a test's vm) fails pdf-lib's Array check.
    function blankPage() { var pg = doc.addPage(); pg.setSize(W, H); return pg; }
    var page = blankPage();
    var y = H - M;

    function text(s, x, yy, size, f, color) {
      page.drawText(pdfSafe(f || font, s), { x: x, y: yy, size: size, font: f || font, color: color || INK });
    }
    function textRight(s, xr, yy, size, f, color) {
      var str = pdfSafe(f || font, s);
      var w = (f || font).widthOfTextAtSize(str, size);
      page.drawText(str, { x: xr - w, y: yy, size: size, font: f || font, color: color || INK });
    }
    function newPageIfNeeded(need) {
      if (y - need > M + 40) return;
      page = blankPage();
      y = H - M;
    }

    // The heading: the centre on the left, RECEIPT and its number on the right.
    text(c.name, M, y - 16, 18, bold);
    textRight('RECEIPT', W - M, y - 12, 10, bold, ACCENT);
    textRight(r.no || 'DRAFT', W - M, y - 30, 14, bold);
    textRight(dayLabel(r.issued), W - M, y - 46, 10, font, SOFT);
    var cy = y - 34;
    var centreLines = [];
    if (c.address) centreLines = centreLines.concat(wrapLines(font, 9.5, pdfSafe(font, c.address), 280));
    if (c.uen) centreLines.push('UEN ' + c.uen);
    var contact = [c.phone, c.email].filter(Boolean).join('  ·  ');
    if (contact) centreLines.push(contact);
    centreLines.forEach(function (ln) { text(ln, M, cy, 9.5, font, SOFT); cy -= 13; });
    y = Math.min(cy, y - 60) - 14;

    if (r.status === 'void') {
      page.drawRectangle({ x: M, y: y - 26, width: W - 2 * M, height: 26, borderColor: RED, borderWidth: 1.5 });
      text('VOID' + (r.voidReason ? ' - ' + r.voidReason : ''), M + 10, y - 17, 11, bold, RED);
      y -= 40;
    }

    page.drawLine({ start: { x: M, y: y }, end: { x: W - M, y: y }, thickness: 1, color: LINE });
    y -= 22;

    var metaRow = function (label, value) {
      if (!value) return;
      text(label, M, y, 10, font, SOFT);
      var lines = wrapLines(font, 10, pdfSafe(font, value), W - 2 * M - 110);
      lines.forEach(function (ln, i) { text(ln, M + 110, y - i * 13, 10, i ? font : bold); });
      y -= 13 * lines.length + 4;
    };
    metaRow('Student', [r.student.name, r.student.level].filter(Boolean).join(' · '));
    metaRow('Received from', r.billTo);
    metaRow('Paid on', dayLabel(r.paidOn));
    metaRow('Payment', methodLabel(r.method) + (r.ref ? ' · ref ' + r.ref : ''));
    y -= 12;

    // The table.
    var colQty = W - M - 200, colUnit = W - M - 90, colAmt = W - M;
    var descW = colQty - M - 30;
    page.drawRectangle({ x: M, y: y - 8, width: W - 2 * M, height: 24, color: CARD });
    text('Description', M + 8, y, 10, bold);
    textRight('Qty', colQty, y, 10, bold);
    textRight('Unit', colUnit, y, 10, bold);
    textRight('Amount', colAmt - 8, y, 10, bold);
    y -= 26;
    r.items.forEach(function (it) {
      var lines = wrapLines(font, 10, pdfSafe(font, it.desc), descW);
      newPageIfNeeded(14 * lines.length + 12);
      lines.forEach(function (ln, i) { text(ln, M + 8, y - i * 13, 10); });
      textRight(String(it.qty), colQty, y, 10);
      textRight(formatMoney(it.unit), colUnit, y, 10);
      textRight(formatMoney(it.unit * it.qty), colAmt - 8, y, 10);
      y -= 13 * lines.length + 6;
      page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.6, color: LINE });
      y -= 12;
    });

    var sumRow = function (label, value, strong) {
      newPageIfNeeded(20);
      textRight(label, colUnit, y, strong ? 12 : 10, strong ? bold : font, strong ? INK : SOFT);
      textRight(value, colAmt - 8, y, strong ? 12 : 10, strong ? bold : font);
      y -= strong ? 20 : 16;
    };
    if (t.discount || t.gst) sumRow('Subtotal', formatMoney(t.subtotal));
    if (t.discount) sumRow('Discount' + (r.discountNote ? ' (' + r.discountNote + ')' : ''), '-' + formatMoney(t.discount));
    if (t.gst) sumRow('GST ' + t.gstRate + '%', formatMoney(t.gst));
    y -= 2;
    sumRow('Total paid', formatMoney(t.total), true);
    y -= 12;

    var para = function (s, size, color) {
      if (!s) return;
      var lines = wrapLines(font, size, pdfSafe(font, s), W - 2 * M);
      lines.forEach(function (ln) { newPageIfNeeded(size + 6); text(ln, M, y, size, font, color); y -= size + 4; });
      y -= 8;
    };
    para(r.note, 10, INK);
    para(c.payInfo, 9.5, SOFT);
    if (c.footer) {
      newPageIfNeeded(40);
      page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.6, color: LINE });
      y -= 12;
      para(c.footer, 9, SOFT);
    }
    return await doc.save();
  }

  /* ================================================================
     The window. env = {
       teacher() → bool, toast(msg),
       list() → Promise<[receipt]>,
       save(receipt) → Promise<receipt>   (allocates the number when it has none),
       voidReceipt(id, reason) → Promise<receipt>,
       recordSend(id, send) → Promise<receipt>,
       centre() → Promise<centre>, saveCentre(centre) → Promise<centre>,
       students() → Promise<[{uid, p}]>, saveParents(uid, emails) → Promise,
       pdf(receipt, centre) → Promise<Uint8Array>,
       sendGmail({receipt, centre, to, subject, intro, pdf}, say) → Promise<{from}>,
       authorizeGmail() → Promise, gmailReady() → bool,
       download(bytes, name), openUrl(url), copy(text) → Promise<bool>,
       confirm(msg) → bool
     }
     ================================================================ */
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
  function field(label, input, hint) {
    var wrap = el('label', 'rcField');
    wrap.appendChild(el('span', 'rcLabel', label));
    wrap.appendChild(input);
    if (hint) wrap.appendChild(el('span', 'rcHint', hint));
    return wrap;
  }
  function input(type, value, attrs) {
    var i = el(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') i.type = type || 'text';
    i.value = value == null ? '' : String(value);
    Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); });
    return i;
  }

  function create(env) {
    env = env || {};
    var state = {
      open: false, tab: 'new', seq: 0,
      draft: null, dirty: false, busy: false, sending: false, status: null,
      emailsText: '', intro: '', introEdited: false, saveParents: false,
      centre: cleanCentre(null), centreLoaded: false,
      list: [], listLoaded: false, listError: '', query: '', filter: '',
      roster: [], rosterLoaded: false, pickQuery: '', picking: false
    };
    var back = null, card = null, head = null, body = null, previewFrame = null, previewTimer = null;

    function teacher() { return !!(env.teacher && env.teacher()); }
    function toast(m, ms) { if (env.toast) env.toast(m, ms); }
    function ask(msg) { return env.confirm ? env.confirm(msg) : window.confirm(msg); }

    function build() {
      if (back) return;
      back = el('div', 'rcBack');
      back.id = 'receipts';
      back.setAttribute('role', 'dialog');
      back.setAttribute('aria-modal', 'true');
      back.setAttribute('aria-label', 'Receipts');
      back.hidden = true;
      card = el('div', 'rcCard');
      card.setAttribute('tabindex', '-1');
      head = el('div', 'rcHead');
      body = el('div', 'rcBody');
      card.appendChild(head);
      card.appendChild(body);
      back.appendChild(card);
      document.body.appendChild(back);
      // Every key pressed in the window stops here, or one-letter tool shortcuts fire mid-typing.
      ['keydown', 'keyup', 'keypress'].forEach(function (t) {
        back.addEventListener(t, function (e) {
          e.stopPropagation();
          if (t === 'keydown' && e.key === 'Escape') {
            e.preventDefault();
            if (state.picking) { state.picking = false; render(); return; }
            close();
          }
        });
      });
      back.addEventListener('pointerdown', function (e) { if (e.target === back) close(); });
      // A redraw can drop the focus back onto the page; Escape must still close the window then.
      document.addEventListener('keydown', function (e) {
        if (!state.open || e.key !== 'Escape' || back.contains(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        close();
      }, true);
    }

    function isOpen() { return state.open; }

    function close(force) {
      if (!back || back.hidden) return true;
      if (!force && state.dirty && !ask('Close without saving this receipt?')) return false;
      back.hidden = true;
      state.open = false;
      state.dirty = false;
      state.seq++;
      state.busy = false;
      state.status = null;
      state.picking = false;
      clearTimeout(previewTimer);
      return true;
    }

    function open(tab) {
      if (!teacher()) { toast('Only the teacher can open receipts.'); return; }
      build();
      state.open = true;
      state.seq++;
      state.busy = false;
      state.status = null;
      back.hidden = false;
      if (!state.draft) newDraft();
      state.tab = tab === 'list' || tab === 'centre' ? tab : state.tab || 'new';
      render();
      loadCentre();
      loadList();
      loadRoster();
      try { card.focus({ preventScroll: true }); } catch (e) { /* focus is a nicety */ }
    }

    function newDraft(from) {
      state.draft = from ? from : blank(Date.now(), state.centre);
      state.emailsText = (state.draft.emails || []).join(', ');
      state.intro = '';
      state.introEdited = false;
      state.saveParents = false;
      state.dirty = false;
      state.status = null;
    }

    function setStatus(text, kind) {
      state.status = text ? { text: text, kind: kind || '' } : null;
      paintStatus();
    }

    function paintStatus() {
      if (!card) return;
      var s = card.querySelector('[data-rc="status"]');
      if (!s) return;
      s.textContent = state.status ? state.status.text : '';
      s.className = 'rcStatus' + (state.status && state.status.kind ? ' rc' + state.status.kind : '');
      s.hidden = !state.status;
    }

    function loadCentre() {
      if (!env.centre) return;
      var seq = state.seq;
      Promise.resolve(env.centre()).then(function (c) {
        if (seq !== state.seq || !state.open) return;
        state.centre = cleanCentre(c);
        state.centreLoaded = true;
        if (state.draft && !isLocked(state.draft) && !state.dirty && !state.draft.items.length) state.draft.gst = state.centre.gst;
        render();
      }).catch(function (e) { console.warn('Receipts: the centre details could not be read', e); state.centreLoaded = true; });
    }

    function loadList() {
      if (!env.list) return;
      var seq = state.seq;
      state.listError = '';
      Promise.resolve(env.list()).then(function (rows) {
        if (seq !== state.seq || !state.open) return;
        state.list = receiptsOf(rows);
        state.listLoaded = true;
        if (state.tab === 'list') render(); else paintTabs();
      }).catch(function (e) {
        if (seq !== state.seq) return;
        state.listLoaded = true;
        state.listError = (e && e.message) || String(e);
        if (state.tab === 'list') render();
      });
    }

    function loadRoster() {
      if (!env.students) return;
      var seq = state.seq;
      Promise.resolve(env.students()).then(function (rows) {
        if (seq !== state.seq || !state.open) return;
        state.roster = rosterOf(rows);
        state.rosterLoaded = true;
        if (state.picking) render();
      }).catch(function (e) { state.rosterLoaded = true; console.warn('Receipts: the roster could not be read', e); });
    }

    function remember(saved) {
      var r = cleanReceipt(saved);
      if (!r.id) return r;
      var found = false;
      state.list = state.list.map(function (x) { if (x.id === r.id) { found = true; return r; } return x; });
      if (!found) state.list.unshift(r);
      state.list = receiptsOf(state.list);
      return r;
    }

    function markDirty() {
      state.dirty = true;
      paintTotals();
      paintSaveState();
      schedulePreview();
    }

    /* ---------------- painting ---------------- */

    function render() {
      if (!back || !state.open) return;
      renderHead();
      body.textContent = '';
      if (!teacher()) { body.appendChild(el('p', 'rcHint', 'Only the teacher can use receipts.')); return; }
      if (state.tab === 'list') renderList();
      else if (state.tab === 'centre') renderCentre();
      else renderNew();
    }

    function renderHead() {
      head.textContent = '';
      var row = el('div', 'rcTitleRow');
      row.appendChild(el('div', 'rcTitle', '🧾 Receipts'));
      var x = btn('✕', 'rcClose', 'Close (Esc)');
      x.setAttribute('aria-label', 'Close');
      x.addEventListener('click', function () { close(); });
      row.appendChild(x);
      head.appendChild(row);
      head.appendChild(el('div', 'rcSub', 'Write a receipt by hand and email it to a parent from ' + SENDER + '. Nothing is sent until you press Send.'));
      var tabs = el('div', 'rcTabs');
      tabs.setAttribute('role', 'tablist');
      [['new', '✍️ New receipt'], ['list', '📚 Receipts'], ['centre', '🏫 Centre details']].forEach(function (t) {
        var b = btn(t[1], 'rcTab' + (state.tab === t[0] ? ' on' : ''));
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', state.tab === t[0] ? 'true' : 'false');
        b.dataset.rcTab = t[0];
        b.addEventListener('click', function () { switchTab(t[0]); });
        tabs.appendChild(b);
      });
      head.appendChild(tabs);
      paintTabs();
    }

    function paintTabs() {
      if (!head) return;
      var b = head.querySelector('[data-rc-tab="list"]');
      if (b) b.textContent = '📚 Receipts' + (state.listLoaded && state.list.length ? ' (' + state.list.length + ')' : '');
    }

    function switchTab(tab) {
      if (tab === state.tab) return;
      state.tab = tab;
      state.picking = false;
      if (tab === 'list' && !state.listLoaded) loadList();
      render();
    }

    /* ---- ✍️ New receipt ---- */

    function renderNew() {
      var r = state.draft;
      var locked = isLocked(r);
      var wrap = el('div', 'rcSplit');
      var form = el('div', 'rcForm');
      var side = el('div', 'rcSide');
      wrap.appendChild(form);
      wrap.appendChild(side);
      body.appendChild(wrap);

      var status = el('div', 'rcStatus');
      status.dataset.rc = 'status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      form.appendChild(status);
      paintStatus();

      if (locked) {
        var lock = el('div', 'rcLocked');
        lock.appendChild(el('strong', null, r.status === 'void' ? 'VOID — ' : 'Sent — '));
        lock.appendChild(document.createTextNode(r.status === 'void'
          ? 'this receipt was voided' + (r.voidReason ? ' (' + r.voidReason + ')' : '') + '. It is kept for the record.'
          : 'a parent already holds this receipt, so it cannot be changed. Resend it, download it, or copy it into a new one.'));
        form.appendChild(lock);
      } else if (r.id) {
        form.appendChild(el('div', 'rcHint', 'Draft ' + (r.no || '') + ' — saved. Changes are kept when you press Save or Send.'));
      }

      // The student.
      var sec = el('div', 'rcSec');
      sec.appendChild(el('div', 'rcSecTitle', 'Student'));
      var stuRow = el('div', 'rcRow');
      var nameIn = input('text', r.student.name, { maxlength: String(LIMITS.name), placeholder: 'Student’s name', autocomplete: 'off' });
      nameIn.dataset.rc = 'name';
      nameIn.disabled = locked;
      nameIn.addEventListener('input', function () { r.student.name = nameIn.value; r.student.uid = ''; markDirty(); });
      var levelIn = input('text', r.student.level, { maxlength: '8', placeholder: 'P5', autocomplete: 'off' });
      levelIn.dataset.rc = 'level';
      levelIn.disabled = locked;
      levelIn.addEventListener('input', function () { r.student.level = levelIn.value; markDirty(); });
      var nameField = field('Name', nameIn);
      nameField.classList.add('rcGrow');
      stuRow.appendChild(nameField);
      var lvField = field('Level', levelIn);
      lvField.classList.add('rcNarrow');
      stuRow.appendChild(lvField);
      sec.appendChild(stuRow);
      if (!locked) {
        var pick = btn(state.picking ? 'Close the list' : '👤 Pick from my students', 'rcSmall', 'Fill in the name, level and the parents’ emails from a student’s profile');
        pick.dataset.rc = 'pick';
        pick.addEventListener('click', function () { state.picking = !state.picking; if (state.picking && !state.rosterLoaded) loadRoster(); render(); });
        sec.appendChild(pick);
        if (state.picking) sec.appendChild(renderPicker());
      }
      form.appendChild(sec);

      // Who paid and where it goes.
      var sec2 = el('div', 'rcSec');
      sec2.appendChild(el('div', 'rcSecTitle', 'Parent'));
      var billIn = input('text', r.billTo, { maxlength: String(LIMITS.billTo), placeholder: 'e.g. Mrs Tan', autocomplete: 'off' });
      billIn.dataset.rc = 'billTo';
      billIn.disabled = locked;
      billIn.addEventListener('input', function () { r.billTo = billIn.value; if (!state.introEdited) state.intro = ''; markDirty(); });
      sec2.appendChild(field('Received from', billIn, 'Printed on the receipt and used to greet them in the email.'));
      var mailIn = input('text', state.emailsText, { placeholder: 'parent@example.com, another@example.com', autocomplete: 'off', inputmode: 'email' });
      mailIn.dataset.rc = 'emails';
      mailIn.addEventListener('input', function () {
        state.emailsText = mailIn.value;
        if (!locked) r.emails = parseEmails(mailIn.value).slice(0, LIMITS.emails);
        paintEmailCheck();
        if (!locked) markDirty();
      });
      sec2.appendChild(field('Email to', mailIn, 'Up to ' + LIMITS.emails + ' addresses. Each gets the same email with the PDF attached.'));
      var mailCheck = el('div', 'rcWarn');
      mailCheck.dataset.rc = 'emailCheck';
      mailCheck.hidden = true;
      sec2.appendChild(mailCheck);
      if (r.student.uid && !locked) {
        var keep = el('label', 'rcCheckRow');
        var cb = input('checkbox');
        cb.checked = state.saveParents;
        cb.dataset.rc = 'saveParents';
        cb.addEventListener('change', function () { state.saveParents = cb.checked; });
        keep.appendChild(cb);
        keep.appendChild(el('span', null, 'Also keep these addresses as this student’s parents (used by class summaries too)'));
        sec2.appendChild(keep);
      }
      form.appendChild(sec2);

      // The lines.
      var sec3 = el('div', 'rcSec');
      sec3.appendChild(el('div', 'rcSecTitle', 'What was paid for'));
      var items = el('div', 'rcItems');
      items.dataset.rc = 'items';
      var headRow = el('div', 'rcItemHead');
      ['Description', 'Qty', 'Unit price (S$)', 'Amount', ''].forEach(function (h) { headRow.appendChild(el('span', null, h)); });
      items.appendChild(headRow);
      r.items.forEach(function (it, i) { items.appendChild(itemRow(it, i, locked)); });
      if (!r.items.length) items.appendChild(el('div', 'rcHint rcEmptyItems', locked ? 'No lines.' : 'No lines yet — add one below, or tap a quick line.'));
      sec3.appendChild(items);
      if (!locked) {
        var add = el('div', 'rcActions');
        var addBtn = btn('＋ Add a line', 'rcSmall');
        addBtn.dataset.rc = 'addItem';
        addBtn.addEventListener('click', function () {
          if (r.items.length >= LIMITS.items) { toast('A receipt holds at most ' + LIMITS.items + ' lines.'); return; }
          r.items.push({ desc: '', qty: 1, unit: 0, fresh: true });
          markDirty();
          render();
          var ins = card.querySelectorAll('[data-rc="desc"]');
          if (ins.length) ins[ins.length - 1].focus();
        });
        add.appendChild(addBtn);
        PRESETS.forEach(function (p) {
          var b = btn('＋ ' + p.label, 'rcSmall rcPreset', presetDesc(p, r.issued));
          b.dataset.rcPreset = p.id;
          b.addEventListener('click', function () {
            if (r.items.length >= LIMITS.items) { toast('A receipt holds at most ' + LIMITS.items + ' lines.'); return; }
            r.items.push({ desc: presetDesc(p, r.issued), qty: 1, unit: 0 });
            markDirty();
            render();
            var units = card.querySelectorAll('[data-rc="unit"]');
            if (units.length) units[units.length - 1].focus();
          });
          add.appendChild(b);
        });
        sec3.appendChild(add);
      }
      // Discount and GST.
      var adj = el('div', 'rcRow');
      var discIn = input('text', moneyInput(r.discount), { inputmode: 'decimal', placeholder: '0.00', autocomplete: 'off' });
      discIn.dataset.rc = 'discount';
      discIn.disabled = locked;
      discIn.addEventListener('input', function () {
        var v = parseMoney(discIn.value);
        r.discount = discIn.value.trim() === '' ? 0 : (isNaN(v) ? r.discount : Math.max(0, v));
        discIn.classList.toggle('rcBad', discIn.value.trim() !== '' && isNaN(v));
        markDirty();
      });
      var discField = field('Discount (S$)', discIn);
      discField.classList.add('rcNarrow');
      adj.appendChild(discField);
      var discNote = input('text', r.discountNote, { maxlength: String(LIMITS.desc), placeholder: 'e.g. sibling discount', autocomplete: 'off' });
      discNote.dataset.rc = 'discountNote';
      discNote.disabled = locked;
      discNote.addEventListener('input', function () { r.discountNote = discNote.value; markDirty(); });
      var dnField = field('Discount reason', discNote);
      dnField.classList.add('rcGrow');
      adj.appendChild(dnField);
      if (r.gst || state.centre.gst) {
        var gstIn = input('number', r.gst || '', { min: '0', max: String(LIMITS.gstMax), step: '0.01' });
        gstIn.dataset.rc = 'gst';
        gstIn.disabled = locked;
        gstIn.addEventListener('input', function () { r.gst = cleanGst(gstIn.value); markDirty(); });
        var gField = field('GST %', gstIn);
        gField.classList.add('rcNarrow');
        adj.appendChild(gField);
      }
      sec3.appendChild(adj);
      var tot = el('div', 'rcTotals');
      tot.dataset.rc = 'totals';
      sec3.appendChild(tot);
      form.appendChild(sec3);

      // The payment.
      var sec4 = el('div', 'rcSec');
      sec4.appendChild(el('div', 'rcSecTitle', 'Payment'));
      var payRow = el('div', 'rcRow');
      var meth = el('select', 'rcSelect');
      meth.dataset.rc = 'method';
      meth.disabled = locked;
      METHODS.forEach(function (m) {
        var o = el('option', null, m.label);
        o.value = m.id;
        if (m.id === r.method) o.selected = true;
        meth.appendChild(o);
      });
      meth.addEventListener('change', function () { r.method = cleanMethod(meth.value); markDirty(); });
      payRow.appendChild(field('Paid by', meth));
      var refIn = input('text', r.ref, { maxlength: String(LIMITS.ref), placeholder: 'PayNow / bank reference', autocomplete: 'off' });
      refIn.dataset.rc = 'ref';
      refIn.disabled = locked;
      refIn.addEventListener('input', function () { r.ref = refIn.value; markDirty(); });
      var refField = field('Reference (optional)', refIn);
      refField.classList.add('rcGrow');
      payRow.appendChild(refField);
      sec4.appendChild(payRow);
      var dateRow = el('div', 'rcRow');
      var paidIn = input('date', r.paidOn);
      paidIn.dataset.rc = 'paidOn';
      paidIn.disabled = locked;
      paidIn.addEventListener('change', function () { if (validDay(paidIn.value)) { r.paidOn = paidIn.value; markDirty(); } });
      dateRow.appendChild(field('Paid on', paidIn));
      var issIn = input('date', r.issued);
      issIn.dataset.rc = 'issued';
      issIn.disabled = locked || !!r.no;
      issIn.title = r.no ? 'The date is fixed once the receipt has a number.' : '';
      issIn.addEventListener('change', function () { if (validDay(issIn.value)) { r.issued = issIn.value; markDirty(); } });
      dateRow.appendChild(field('Receipt date', issIn));
      sec4.appendChild(dateRow);
      var noteIn = input('textarea', r.note, { maxlength: String(LIMITS.note), rows: '2', placeholder: 'A note printed on the receipt (optional)' });
      noteIn.dataset.rc = 'note';
      noteIn.disabled = locked;
      noteIn.addEventListener('input', function () { r.note = noteIn.value; markDirty(); });
      sec4.appendChild(field('Note', noteIn));
      form.appendChild(sec4);

      // The email's own words.
      var sec5 = el('div', 'rcSec');
      sec5.appendChild(el('div', 'rcSecTitle', 'The email'));
      var introIn = input('textarea', state.intro || defaultIntro(r, state.centre), { rows: '5', maxlength: '2000' });
      introIn.dataset.rc = 'intro';
      introIn.addEventListener('input', function () { state.intro = introIn.value; state.introEdited = true; schedulePreview(); });
      sec5.appendChild(field('Message above the receipt', introIn));
      form.appendChild(sec5);

      // The buttons.
      var acts = el('div', 'rcActions rcMain');
      if (!locked) {
        var save = btn('💾 Save draft', '', 'Save it (the receipt number is given the first time)');
        save.dataset.rc = 'save';
        save.addEventListener('click', function () { saveDraft(); });
        acts.appendChild(save);
      }
      var send = btn(r.status === 'sent' ? '✉️ Resend' : '✉️ Send', 'btnPrimary', 'Email it from ' + SENDER + ' with the PDF attached');
      send.dataset.rc = 'send';
      send.disabled = r.status === 'void';
      send.addEventListener('click', function () { sendNow(); });
      acts.appendChild(send);
      if (env.gmailReady && !env.gmailReady() && env.authorizeGmail && r.status !== 'void') {
        var signIn = btn('🔑 Sign in as ' + SENDER, '', 'Sign in to the centre\u2019s Gmail once and allow sending; nothing is sent by signing in');
        signIn.dataset.rc = 'signIn';
        signIn.addEventListener('click', function () {
          Promise.resolve(env.authorizeGmail()).then(function () { toast('Signed in as ' + SENDER + '. Press Send when you are ready.'); if (state.open && state.tab === 'new') { var b = card.querySelector('[data-rc="signIn"]'); if (b) b.remove(); } })
            .catch(function (e) { toast('Gmail sign-in did not finish: ' + ((e && e.message) || e), 7000); });
        });
        acts.appendChild(signIn);
      }
      var pdf = btn('⬇ PDF', '', 'Download the receipt as a PDF');
      pdf.dataset.rc = 'pdf';
      pdf.addEventListener('click', function () { downloadPdf(); });
      acts.appendChild(pdf);
      var gm = btn('Open in Gmail instead', '', 'Open a Gmail draft in ' + SENDER + ' — the PDF downloads so you can attach it');
      gm.dataset.rc = 'compose';
      gm.disabled = r.status === 'void';
      gm.addEventListener('click', function () { composeInstead(); });
      acts.appendChild(gm);
      form.appendChild(acts);
      var acts2 = el('div', 'rcActions');
      var fresh = btn('＋ Start a new receipt', 'rcSmall');
      fresh.dataset.rc = 'fresh';
      fresh.addEventListener('click', function () {
        if (state.dirty && !ask('Start a new receipt and drop the changes to this one?')) return;
        newDraft();
        render();
      });
      acts2.appendChild(fresh);
      if (r.id) {
        var dup = btn('⧉ Copy into a new receipt', 'rcSmall');
        dup.dataset.rc = 'duplicate';
        dup.addEventListener('click', function () { duplicateCurrent(); });
        acts2.appendChild(dup);
      }
      if (r.id && r.status !== 'void') {
        var vd = btn('🚫 Void', 'rcSmall rcDanger', 'Keep it for the record, marked VOID');
        vd.dataset.rc = 'void';
        vd.addEventListener('click', function () { voidCurrent(); });
        acts2.appendChild(vd);
      }
      form.appendChild(acts2);
      if (r.sends && r.sends.length) {
        var hist = el('div', 'rcSends');
        hist.appendChild(el('div', 'rcSecTitle', 'Sent'));
        r.sends.slice().reverse().forEach(function (s) {
          hist.appendChild(el('div', 'rcHint', new Date(s.at).toLocaleString() + ' — ' + (s.via === 'compose' ? 'Gmail draft opened for ' : 'emailed to ') + (s.to.join(', ') || '—')));
        });
        form.appendChild(hist);
      }

      // The preview.
      side.appendChild(el('div', 'rcSecTitle', 'What the parent receives'));
      previewFrame = el('iframe', 'rcPreview');
      previewFrame.setAttribute('sandbox', '');
      previewFrame.setAttribute('title', 'Receipt preview');
      previewFrame.dataset.rc = 'preview';
      side.appendChild(previewFrame);
      paintTotals();
      paintEmailCheck();
      paintSaveState();
      paintPreview();
    }

    function itemRow(it, i, locked) {
      var r = state.draft;
      var row = el('div', 'rcItem');
      row.dataset.rcItem = String(i);
      var d = input('text', it.desc, { maxlength: String(LIMITS.desc), placeholder: 'e.g. Tuition fee — ' + monthLabel(r.issued), autocomplete: 'off' });
      d.dataset.rc = 'desc';
      d.setAttribute('aria-label', 'Description of line ' + (i + 1));
      d.disabled = locked;
      d.addEventListener('input', function () { it.desc = d.value; markDirty(); });
      var q = input('number', it.qty, { min: '1', max: String(LIMITS.qtyMax), step: '1', inputmode: 'numeric' });
      q.dataset.rc = 'qty';
      q.setAttribute('aria-label', 'Quantity of line ' + (i + 1));
      q.disabled = locked;
      q.addEventListener('input', function () { it.qty = cleanQty(q.value); markDirty(); paintLine(row, it); });
      var u = input('text', moneyInput(it.unit), { inputmode: 'decimal', placeholder: '0.00', autocomplete: 'off' });
      u.dataset.rc = 'unit';
      u.setAttribute('aria-label', 'Unit price of line ' + (i + 1));
      u.disabled = locked;
      u.addEventListener('input', function () {
        var v = parseMoney(u.value);
        var bad = u.value.trim() !== '' && (isNaN(v) || Math.abs(v) > MAX_CENTS);
        u.classList.toggle('rcBad', bad);
        it.unit = u.value.trim() === '' ? 0 : (bad ? it.unit : v);
        markDirty();
        paintLine(row, it);
      });
      var amt = el('span', 'rcAmt', formatMoney(it.unit * it.qty));
      amt.dataset.rc = 'amount';
      row.appendChild(d);
      row.appendChild(q);
      row.appendChild(u);
      row.appendChild(amt);
      if (!locked) {
        var x = btn('✕', 'rcSmall rcDel', 'Remove this line');
        x.setAttribute('aria-label', 'Remove line ' + (i + 1));
        x.addEventListener('click', function () { r.items.splice(i, 1); markDirty(); render(); });
        row.appendChild(x);
      } else row.appendChild(el('span'));
      return row;
    }

    function paintLine(row, it) {
      var a = row.querySelector('[data-rc="amount"]');
      if (a) a.textContent = formatMoney(cents(it.unit, true) * cleanQty(it.qty));
    }

    function paintTotals() {
      var box = card && card.querySelector('[data-rc="totals"]');
      if (!box || !state.draft) return;
      var t = totals(state.draft);
      box.textContent = '';
      var line = function (label, value, strong) {
        var row = el('div', 'rcTotRow' + (strong ? ' rcTotal' : ''));
        row.appendChild(el('span', null, label));
        var v = el('span', null, value);
        if (strong) v.dataset.rc = 'total';
        row.appendChild(v);
        box.appendChild(row);
      };
      if (t.discount || t.gst) line('Subtotal', formatMoney(t.subtotal));
      if (t.discount) line('Discount', '−' + formatMoney(t.discount));
      if (t.gst) line('GST ' + t.gstRate + '%', formatMoney(t.gst));
      line('Total paid', formatMoney(t.total), true);
    }

    function paintEmailCheck() {
      var box = card && card.querySelector('[data-rc="emailCheck"]');
      if (!box) return;
      var bad = badEmails(state.emailsText);
      var n = parseEmails(state.emailsText).length;
      var msgs = [];
      if (bad.length) msgs.push('Not an email address: ' + bad.slice(0, 3).join(', ') + (bad.length > 3 ? '…' : ''));
      if (n > LIMITS.emails) msgs.push('Only the first ' + LIMITS.emails + ' addresses are used.');
      box.textContent = msgs.join(' ');
      box.hidden = !msgs.length;
    }

    function paintSaveState() {
      var b = card && card.querySelector('[data-rc="save"]');
      if (b) { b.disabled = state.busy || state.sending || (!state.dirty && !!state.draft.id); b.textContent = state.dirty || !state.draft.id ? '💾 Save draft' : '✓ Saved'; }
      var s = card && card.querySelector('[data-rc="send"]');
      if (s) s.disabled = state.busy || state.sending || state.draft.status === 'void';
    }

    function schedulePreview() {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(paintPreview, 160);
    }

    function paintPreview() {
      if (!previewFrame || !state.draft) return;
      var r = cleanReceipt(state.draft);
      previewFrame.srcdoc = emailHtml(r, state.centre, { preview: true, intro: introText(r) });
    }

    function introText(r) {
      return cleanText(state.intro || defaultIntro(r, state.centre), 2000);
    }

    function renderPicker() {
      var box = el('div', 'rcPicker');
      var q = input('search', state.pickQuery, { placeholder: 'Search by name or level', autocomplete: 'off' });
      q.dataset.rc = 'pickQuery';
      box.appendChild(q);
      var list = el('div', 'rcPickList');
      list.dataset.rc = 'pickList';
      box.appendChild(list);
      var paint = function () {
        list.textContent = '';
        if (!state.rosterLoaded) { list.appendChild(el('div', 'rcHint', 'Reading your students…')); return; }
        var found = findStudents(state.roster, state.pickQuery);
        if (!found.length) { list.appendChild(el('div', 'rcHint', state.roster.length ? 'No student matches.' : 'No student profiles yet — type the name instead.')); return; }
        found.forEach(function (s) {
          var b = btn('', 'rcPickRow');
          b.dataset.rcUid = s.uid;
          b.appendChild(el('span', 'rcPickName', s.name));
          b.appendChild(el('span', 'rcPickMeta', [s.level, s.parents.length ? s.parents.join(', ') : 'no parent email yet'].filter(Boolean).join(' · ')));
          b.addEventListener('click', function () { pickStudent(s); });
          list.appendChild(b);
        });
      };
      q.addEventListener('input', function () { state.pickQuery = q.value; paint(); });
      paint();
      setTimeout(function () { try { q.focus(); } catch (e) { /* nicety */ } }, 0);
      return box;
    }

    function pickStudent(s) {
      var r = state.draft;
      if (isLocked(r)) return;
      r.student = { uid: s.uid, name: s.name, level: s.level };
      if (s.parents.length) {
        r.emails = s.parents.slice(0, LIMITS.emails);
        state.emailsText = r.emails.join(', ');
      }
      state.picking = false;
      state.pickQuery = '';
      if (!state.introEdited) state.intro = '';
      markDirty();
      render();
      if (!s.parents.length) setStatus(s.name + ' has no parent email saved yet — type it in, and tick “keep these addresses” to remember it.', 'Warn');
    }

    /* ---------------- actions ---------------- */

    function stillHere(seq) { return seq === state.seq && state.open && teacher(); }

    /* Saves the draft (and gives it its number). Resolves the saved receipt or null. */
    function persist(seq, extra) {
      var r = cleanReceipt(Object.assign({}, state.draft, extra || {}), { now: Date.now() });
      var bad = problems(r, false);
      if (bad.length) { setStatus(bad.join(' '), 'Err'); return Promise.resolve(null); }
      if (!env.save) return Promise.resolve(r);
      return Promise.resolve(env.save(r)).then(function (saved) {
        if (!stillHere(seq)) return null;
        var s = remember(saved);
        state.draft = JSON.parse(JSON.stringify(s));
        state.dirty = false;
        paintTabs();
        return s;
      });
    }

    function saveDraft() {
      if (!teacher()) { toast('Only the teacher can save receipts.'); return; }
      if (state.busy || isLocked(state.draft)) return;
      var seq = state.seq;
      state.busy = true;
      paintSaveState();
      setStatus('Saving…');
      persist(seq).then(function (s) {
        if (!stillHere(seq)) return;
        state.busy = false;
        if (!s) { paintSaveState(); return; }
        return keepParents(seq).then(function () {
          render();
          setStatus('Saved as ' + s.no + '.', 'Ok');
        });
      }).catch(function (e) {
        if (seq !== state.seq) return;
        state.busy = false;
        paintSaveState();
        setStatus('Could not save: ' + ((e && e.message) || e), 'Err');
      });
    }

    function keepParents(seq) {
      var r = state.draft;
      if (!state.saveParents || !r.student.uid || !env.saveParents || !r.emails.length) return Promise.resolve();
      return Promise.resolve(env.saveParents(r.student.uid, r.emails)).then(function () {
        if (seq !== state.seq) return;
        state.saveParents = false;
        state.roster.forEach(function (s) { if (s.uid === r.student.uid) s.parents = r.emails.slice(); });
      }).catch(function (e) { toast('The parents’ addresses could not be kept: ' + ((e && e.message) || e)); });
    }

    function sendNow() {
      if (!teacher()) { toast('Only the teacher can send receipts.'); return; }
      if (state.sending || state.busy) return;
      var r = cleanReceipt(state.draft, { now: Date.now() });
      // A sent receipt keeps its addresses; what is typed now is who gets it this time.
      var to = parseEmails(state.emailsText).slice(0, LIMITS.emails);
      var bad = problems(Object.assign({}, r, { emails: to }), true);
      if (bad.length) { setStatus(bad.join(' '), 'Err'); return; }
      var t = totals(r);
      var what = (r.no ? 'Receipt ' + r.no : 'This receipt') + ' for ' + r.student.name + ' (' + formatMoney(t.total) + ')';
      var again = r.status === 'sent' ? '\n\nThis receipt was ALREADY emailed ' + r.sends.length + ' time' + (r.sends.length === 1 ? '' : 's') + '.' : '';
      if (!ask('Email ' + what + ' to:\n\n' + to.join('\n') + '\n\nfrom ' + SENDER + '?' + again)) return;
      // The Google window must open inside this tap, before anything waits.
      var auth = env.gmailReady && !env.gmailReady() && env.authorizeGmail ? env.authorizeGmail() : null;
      if (auth && auth.catch) auth.catch(function () { /* reported below */ });
      var seq = state.seq;
      state.sending = true;
      paintSaveState();
      setStatus(r.status === 'sent' ? 'Resending…' : 'Saving the receipt…');
      var job = isLocked(r) ? Promise.resolve(r) : persist(seq, { emails: to });
      job.then(function (saved) {
        if (!saved) throw new Error(state.status ? state.status.text : 'The receipt could not be saved.');
        if (!stillHere(seq)) throw new Error('The window was closed.');
        return keepParents(seq).then(function () {
          setStatus('Making the PDF…');
          return env.pdf(saved, state.centre);
        }).then(function (bytes) {
          if (!stillHere(seq)) throw new Error('The window was closed.');
          return Promise.resolve(auth).then(function () {
            return env.sendGmail({ receipt: saved, centre: state.centre, to: to, subject: subjectLine(saved, state.centre), intro: introText(saved), pdf: bytes },
              function (m) { if (seq === state.seq) setStatus(m); });
          });
        }).then(function (res) {
          var send = { at: Date.now(), to: to, via: 'gmail', from: (res && res.from) || SENDER };
          return Promise.resolve(env.recordSend ? env.recordSend(saved.id, send) : null).catch(function (e) {
            console.warn('Receipts: the send could not be recorded', e);
            return null;
          }).then(function (rec) {
            var after = rec || Object.assign({}, saved, { status: 'sent', sends: (saved.sends || []).concat([send]) });
            return after;
          });
        });
      }).then(function (after) {
        state.sending = false;
        var s = remember(after);
        if (seq !== state.seq) { toast('Receipt ' + s.no + ' was emailed.'); return; }
        state.draft = JSON.parse(JSON.stringify(s));
        state.dirty = false;
        render();
        setStatus('✓ Receipt ' + s.no + ' emailed to ' + to.join(', ') + '.', 'Ok');
        toast('🧾 Receipt ' + s.no + ' sent.');
      }).catch(function (e) {
        state.sending = false;
        var msg = (e && e.message) || String(e);
        if (seq !== state.seq) { toast('The receipt was not sent: ' + msg); return; }
        paintSaveState();
        setStatus('Not sent: ' + msg, 'Err');
      });
    }

    function downloadPdf() {
      if (!teacher()) return;
      var seq = state.seq;
      var r = cleanReceipt(state.draft);
      if (!r.items.length) { setStatus('Add at least one line first.', 'Err'); return; }
      setStatus('Making the PDF…');
      Promise.resolve(env.pdf(r, state.centre)).then(function (bytes) {
        if (seq !== state.seq) return;
        env.download(bytes, fileName(r));
        setStatus(r.no ? 'Downloaded ' + fileName(r) + '.' : 'Downloaded a draft PDF — save it to give it a number.', 'Ok');
      }).catch(function (e) { if (seq === state.seq) setStatus('The PDF could not be made: ' + ((e && e.message) || e), 'Err'); });
    }

    function composeInstead() {
      if (!teacher()) return;
      var seq = state.seq;
      var to = parseEmails(state.emailsText).slice(0, LIMITS.emails);
      var r0 = cleanReceipt(state.draft);
      var bad = problems(Object.assign({}, r0, { emails: to }), true);
      if (bad.length) { setStatus(bad.join(' '), 'Err'); return; }
      // The tab is opened inside the tap (or a browser blocks it), then pointed at Gmail.
      var win = null;
      try { win = window.open('about:blank', '_blank'); } catch (e) { win = null; }
      var job = isLocked(r0) ? Promise.resolve(r0) : persist(seq, { emails: to });
      job.then(function (saved) {
        if (!saved) { if (win) win.close(); return; }
        var text = emailText(saved, state.centre, { intro: introText(saved) });
        var plan = composePlan({ account: SENDER, to: to, subject: subjectLine(saved, state.centre), body: text });
        var copied = plan.copyBody && env.copy ? env.copy(text) : Promise.resolve(false);
        return Promise.resolve(copied).then(function () {
          if (win) { try { win.opener = null; win.location.href = plan.url; } catch (e) { env.openUrl(plan.url); } }
          else env.openUrl(plan.url);
          return env.pdf(saved, state.centre);
        }).then(function (bytes) {
          env.download(bytes, fileName(saved));
          var send = { at: Date.now(), to: to, via: 'compose', from: SENDER };
          return Promise.resolve(env.recordSend ? env.recordSend(saved.id, send) : null).catch(function () { return null; });
        }).then(function (rec) {
          if (rec) remember(rec);
          if (seq !== state.seq) return;
          if (rec) state.draft = JSON.parse(JSON.stringify(cleanReceipt(rec)));
          render();
          setStatus('A Gmail draft opened in ' + SENDER + '. The PDF downloaded — attach it, then send.' + (plan.copyBody ? ' The message was too long for a link, so it is on your clipboard.' : ''), 'Ok');
        });
      }).catch(function (e) {
        if (win) { try { win.close(); } catch (x) { /* ignore */ } }
        if (seq === state.seq) setStatus('Gmail could not be opened: ' + ((e && e.message) || e), 'Err');
      });
    }

    function duplicateCurrent() {
      var copy = duplicate(state.draft, Date.now());
      newDraft(copy);
      state.dirty = true;
      render();
      setStatus('A new receipt, copied from the last one. Change what you need and save it.', 'Ok');
    }

    function voidCurrent() {
      if (!teacher() || !env.voidReceipt) return;
      var r = state.draft;
      if (!r.id || r.status === 'void') return;
      var reason = window.prompt('Void receipt ' + (r.no || '') + '? It is kept, marked VOID. Why (optional)?', '');
      if (reason === null) return;
      var seq = state.seq;
      setStatus('Voiding…');
      Promise.resolve(env.voidReceipt(r.id, oneLine(reason, LIMITS.voidReason))).then(function (rec) {
        var s = remember(rec);
        if (seq !== state.seq) return;
        state.draft = JSON.parse(JSON.stringify(s));
        state.dirty = false;
        render();
        setStatus('Receipt ' + s.no + ' is void.', 'Ok');
      }).catch(function (e) { if (seq === state.seq) setStatus('Could not void it: ' + ((e && e.message) || e), 'Err'); });
    }

    function openReceipt(id) {
      var r = state.list.filter(function (x) { return x.id === id; })[0];
      if (!r) return;
      if (state.dirty && state.tab !== 'new' && !ask('Open receipt ' + r.no + ' and drop the unsaved changes to the receipt you were writing?')) return;
      newDraft(JSON.parse(JSON.stringify(r)));
      state.tab = 'new';
      render();
    }

    /* ---- 📚 Receipts ---- */

    function renderList() {
      var top = el('div', 'rcListTop');
      var q = input('search', state.query, { placeholder: 'Search: name, number, email, month…', autocomplete: 'off' });
      q.dataset.rc = 'query';
      top.appendChild(q);
      var f = el('select', 'rcSelect');
      f.dataset.rc = 'filter';
      [['', 'All'], ['sent', 'Sent'], ['draft', 'Drafts'], ['void', 'Void']].forEach(function (o) {
        var opt = el('option', null, o[1]);
        opt.value = o[0];
        if (o[0] === state.filter) opt.selected = true;
        f.appendChild(opt);
      });
      top.appendChild(f);
      var refresh = btn('↻', 'rcSmall', 'Read the receipts again');
      refresh.addEventListener('click', function () { state.listLoaded = false; render(); loadList(); });
      top.appendChild(refresh);
      body.appendChild(top);
      var sum = el('div', 'rcHint');
      sum.dataset.rc = 'listSum';
      body.appendChild(sum);
      var list = el('div', 'rcList');
      list.dataset.rc = 'list';
      body.appendChild(list);
      var paint = function () {
        list.textContent = '';
        if (!state.listLoaded) { list.appendChild(el('div', 'rcHint', 'Reading your receipts…')); sum.textContent = ''; return; }
        if (state.listError) { list.appendChild(el('div', 'rcWarn', 'The receipts could not be read: ' + state.listError)); return; }
        var year = Number(dayKey(Date.now()).slice(0, 4));
        var tally = sumSent(state.list, year);
        sum.textContent = tally.count + ' sent in ' + year + ' · ' + formatMoney(tally.total) + ' received';
        var rows = filterReceipts(state.list, state.query, state.filter);
        if (!rows.length) {
          list.appendChild(el('div', 'rcHint', state.list.length ? 'No receipt matches.' : 'No receipts yet. Write one in ✍️ New receipt.'));
          return;
        }
        rows.forEach(function (r) {
          var b = btn('', 'rcListRow rc-' + r.status);
          b.dataset.rcId = r.id;
          var main = el('span', 'rcListMain');
          main.appendChild(el('span', 'rcListNo', r.no || 'Draft'));
          main.appendChild(el('span', 'rcListName', [r.student.name, r.student.level].filter(Boolean).join(' · ') || '—'));
          b.appendChild(main);
          var meta = el('span', 'rcListMeta');
          meta.appendChild(el('span', null, dayLabel(r.issued)));
          meta.appendChild(el('span', 'rcListAmt', formatMoney(r.total)));
          var badge = el('span', 'rcBadge rcBadge-' + r.status, r.status === 'sent' ? 'Sent' : r.status === 'void' ? 'Void' : 'Draft');
          meta.appendChild(badge);
          b.appendChild(meta);
          b.title = r.items.map(function (i) { return i.desc; }).join('; ');
          b.addEventListener('click', function () { openReceipt(r.id); });
          list.appendChild(b);
        });
      };
      q.addEventListener('input', function () { state.query = q.value; paint(); });
      f.addEventListener('change', function () { state.filter = f.value; paint(); });
      paint();
    }

    /* ---- 🏫 Centre details ---- */

    function renderCentre() {
      var c = JSON.parse(JSON.stringify(state.centre));
      var box = el('div', 'rcCentre');
      box.appendChild(el('p', 'rcHint', 'Printed at the top and bottom of every receipt. Saved in your account, so every device uses the same.'));
      var status = el('div', 'rcStatus');
      status.dataset.rc = 'status';
      box.appendChild(status);
      var add = function (key, label, type, attrs, hint) {
        var i = input(type, c[key], attrs);
        i.dataset.rcCentre = key;
        i.addEventListener('input', function () { c[key] = i.value; });
        box.appendChild(field(label, i, hint));
      };
      add('name', 'Centre name', 'text', { maxlength: String(LIMITS.centreName) });
      add('address', 'Address', 'textarea', { rows: '2', maxlength: String(LIMITS.address) });
      var row = el('div', 'rcRow');
      box.appendChild(row);
      var addTo = function (parent, key, label, type, attrs, cls) {
        var i = input(type, c[key], attrs);
        i.dataset.rcCentre = key;
        i.addEventListener('input', function () { c[key] = i.value; });
        var f = field(label, i);
        if (cls) f.classList.add(cls);
        parent.appendChild(f);
      };
      addTo(row, 'uen', 'UEN', 'text', { maxlength: String(LIMITS.uen) }, 'rcGrow');
      addTo(row, 'phone', 'Phone', 'text', { maxlength: String(LIMITS.phone) }, 'rcGrow');
      var row2 = el('div', 'rcRow');
      box.appendChild(row2);
      addTo(row2, 'email', 'Email shown on the receipt', 'email', {}, 'rcGrow');
      addTo(row2, 'prefix', 'Number prefix', 'text', { maxlength: '8' }, 'rcNarrow');
      addTo(row2, 'gst', 'GST % (0 = none)', 'number', { min: '0', max: String(LIMITS.gstMax), step: '0.01' }, 'rcNarrow');
      add('payInfo', 'Payment details (optional)', 'textarea', { rows: '2', maxlength: String(LIMITS.payInfo) }, 'e.g. PayNow to UEN …, or the bank account for transfers.');
      add('footer', 'Footer', 'textarea', { rows: '2', maxlength: String(LIMITS.footer) });
      box.appendChild(el('p', 'rcHint', 'Next number: ' + numberFor(cleanPrefix(c.prefix), Number(dayKey(Date.now()).slice(0, 4)), 1).replace(/0001$/, '…') + ' — numbers count up by year and are never used twice.'));
      var acts = el('div', 'rcActions rcMain');
      var save = btn('💾 Save centre details', 'btnPrimary');
      save.dataset.rc = 'saveCentre';
      save.addEventListener('click', function () {
        if (!teacher()) { toast('Only the teacher can change the centre details.'); return; }
        var clean = cleanCentre(c);
        var seq = state.seq;
        save.disabled = true;
        setStatus('Saving…');
        Promise.resolve(env.saveCentre ? env.saveCentre(clean) : clean).then(function (saved) {
          if (seq !== state.seq) return;
          state.centre = cleanCentre(saved || clean);
          if (state.draft && !isLocked(state.draft) && !state.draft.items.length) state.draft.gst = state.centre.gst;
          render();
          setStatus('Saved.', 'Ok');
        }).catch(function (e) {
          if (seq !== state.seq) return;
          save.disabled = false;
          setStatus('Could not save: ' + ((e && e.message) || e), 'Err');
        });
      });
      acts.appendChild(save);
      box.appendChild(acts);
      body.appendChild(box);
      paintStatus();
    }

    function roleChanged() {
      if (!teacher()) {
        close(true);
        state.draft = null;
        state.list = [];
        state.listLoaded = false;
        state.roster = [];
        state.rosterLoaded = false;
        state.centre = cleanCentre(null);
        state.centreLoaded = false;
      }
    }

    return {
      open: open,
      close: close,
      isOpen: isOpen,
      refresh: function () { if (state.open) { loadList(); render(); } },
      roleChanged: roleChanged,
      // For the browser check and the glue.
      _state: state
    };
  }

  window.Receipts = {
    VERSION: VERSION,
    create: create,
    drawPdf: drawPdf,
    pure: {
      VERSION: VERSION, SENDER: SENDER, CENTRE: CENTRE, CURRENCY: CURRENCY, LIMITS: LIMITS, METHODS: METHODS,
      PRESETS: PRESETS, DEFAULT_CENTRE: DEFAULT_CENTRE, MAX_CENTS: MAX_CENTS, GMAIL_URL_MAX: GMAIL_URL_MAX,
      cleanText: cleanText, oneLine: oneLine, escapeHtml: escapeHtml, normEmail: normEmail, parseEmails: parseEmails,
      badEmails: badEmails, toMillis: toMillis, dayKey: dayKey, validDay: validDay, dayLabel: dayLabel,
      monthLabel: monthLabel, yearOf: yearOf, parseMoney: parseMoney, formatMoney: formatMoney, moneyInput: moneyInput,
      cleanItem: cleanItem, cleanQty: cleanQty, cleanMethod: cleanMethod, methodLabel: methodLabel,
      cleanPrefix: cleanPrefix, cleanGst: cleanGst, numberFor: numberFor, parseNumber: parseNumber,
      cleanSends: cleanSends, cleanCentre: cleanCentre, cleanReceipt: cleanReceipt, totals: totals,
      problems: problems, isLocked: isLocked, duplicate: duplicate, blank: blank, presetDesc: presetDesc,
      receiptsOf: receiptsOf, filterReceipts: filterReceipts, sumSent: sumSent, lastSentAt: lastSentAt,
      rosterOf: rosterOf, findStudents: findStudents, subjectLine: subjectLine, emailHtml: emailHtml,
      emailText: emailText, defaultIntro: defaultIntro, fileName: fileName, b64Bytes: b64Bytes,
      b64Utf8: b64Utf8, b64url: b64url, encodeHeader: encodeHeader, safeFileName: safeFileName,
      mimeMessage: mimeMessage, composePlan: composePlan, wrapLines: wrapLines, pdfSafe: pdfSafe
    }
  };
})();
