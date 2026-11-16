// 🧾 Receipts (v1.205.0): the money, the shape, the numbers, the email and
// the glue's rules, run against the REAL receipts.js and index.html.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../receipts.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../receipts.css', import.meta.url), 'utf8');

function load() {
  const ctx = { window: {}, console, TextEncoder, Date, Math, JSON, unescape, encodeURIComponent };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.window.Receipts;
}
const R = load();
const P = R.pure;
const NOW = Date.UTC(2026, 10, 16, 6, 0, 0); // 16 Nov 2026, 2 pm in Singapore
const plain = (v) => JSON.parse(JSON.stringify(v));

test('money is whole cents both ways', () => {
  assert.equal(P.parseMoney('1280'), 128000);
  assert.equal(P.parseMoney('$1,280.50'), 128050);
  assert.equal(P.parseMoney('S$ 1280.5'), 128050);
  assert.equal(P.parseMoney('SGD 99.99'), 9999);
  assert.equal(P.parseMoney('.5'), 50);
  assert.equal(P.parseMoney('0.105'), 11, 'half up at the third place');
  assert.equal(P.parseMoney('0.104'), 10);
  assert.equal(P.parseMoney('-20'), -2000);
  assert.ok(Number.isNaN(P.parseMoney('abc')));
  assert.ok(Number.isNaN(P.parseMoney('')));
  assert.ok(Number.isNaN(P.parseMoney('1.2.3')));
  assert.equal(P.parseMoney(0.1 + 0.2), 30, 'a float is rounded to the cent');
  assert.equal(P.formatMoney(128050), 'S$1,280.50');
  assert.equal(P.formatMoney(5), 'S$0.05');
  assert.equal(P.formatMoney(123456789), 'S$1,234,567.89');
  assert.equal(P.formatMoney(-2000), '−S$20.00');
  assert.equal(P.formatMoney(300, { bare: true }), '3.00');
  assert.equal(P.moneyInput(128050), '1280.50');
  assert.equal(P.moneyInput(0), '');
  assert.equal(P.parseMoney(P.moneyInput(98765)), 98765, 'what goes into the box reads back the same');
});

test('totals: lines × quantity, discount capped, GST on the net, half up', () => {
  const r = { items: [{ desc: 'Tuition', qty: 4, unit: 6500 }, { desc: 'Materials', qty: 1, unit: 1500 }], discount: 2000 };
  assert.deepEqual(plain(P.totals(r)), { subtotal: 27500, discount: 2000, net: 25500, gstRate: 0, gst: 0, total: 25500 });
  const g = P.totals(Object.assign({}, r, { gst: 9 }));
  assert.equal(g.gst, 2295);
  assert.equal(g.total, 27795);
  const big = P.totals({ items: [{ desc: 'x', qty: 1, unit: 1000 }], discount: 999999 });
  assert.equal(big.discount, 1000, 'a discount never takes the total below zero');
  assert.equal(big.total, 0);
  assert.equal(P.totals({ items: [{ desc: 'x', qty: 3, unit: '33.33' }] }).total, 9999, 'typed prices are read as money');
  assert.equal(P.totals({ items: [{ desc: 'x', qty: 1, unit: 1 }], gst: 9 }).gst, 0, '0.09 cents rounds to 0');
  assert.equal(P.totals({ items: [{ desc: 'x', qty: 1, unit: 6 }], gst: 9 }).gst, 1, '0.54 cents rounds up');
});

test('cleanReceipt is the one door: trims, caps, drops empty lines, adds up', () => {
  const r = P.cleanReceipt({
    id: 'abc_123', no: 'PLC-2026-0007', issued: '2026-11-16', paidOn: '2026-02-30',
    student: { uid: 'u1', name: '  Tan  Wei Ling ', level: 'P5' },
    billTo: 'Mrs Tan', emails: 'MUM@Example.com; not-an-email, dad@example.com, mum@example.com',
    items: [{ desc: '  Tuition fee — November 2026 ', qty: '4', unit: '65' }, { desc: '', unit: '' }, { desc: '', unit: 500 }, null, 'x'],
    discount: '10', method: 'BANK', ref: 'TXN 991', note: 'Thank you\r\nsee you', status: 'weird',
    sends: [{ at: NOW, to: ['mum@example.com'], via: 'gmail' }, { at: 5 }]
  }, { now: NOW });
  assert.equal(r.v, 1);
  assert.equal(r.id, 'abc_123');
  assert.equal(r.no, 'PLC-2026-0007');
  assert.equal(r.paidOn, '2026-11-16', 'an impossible day falls back to the receipt date');
  assert.equal(r.student.name, 'Tan Wei Ling');
  assert.deepEqual(plain(r.emails), ['mum@example.com', 'dad@example.com']);
  assert.equal(r.items.length, 2, 'blank lines go, a line with only an amount stays');
  assert.equal(r.items[0].desc, 'Tuition fee — November 2026');
  assert.equal(r.items[0].qty, 4);
  assert.equal(r.items[0].unit, 6500);
  assert.equal(r.items[1].desc, 'Item');
  assert.equal(r.discount, 1000);
  assert.equal(r.method, 'bank');
  assert.equal(r.note, 'Thank you\nsee you');
  assert.equal(r.status, 'draft');
  assert.equal(r.sends.length, 1, 'a send with a bad time is dropped');
  assert.equal(r.subtotal, 26500);
  assert.equal(r.total, 25500);
  assert.equal(r.currency, 'SGD');
  assert.equal(P.cleanReceipt({ id: '../x' }).id, '', 'an id with a slash is refused');
  assert.equal(P.cleanReceipt({ no: 'PLC-26-1' }).no, '', 'a malformed number is refused');
  const many = P.cleanReceipt({ items: Array.from({ length: 40 }, (_, i) => ({ desc: 'L' + i, unit: 100 })) });
  assert.equal(many.items.length, P.LIMITS.items);
  assert.equal(P.cleanReceipt({ items: [{ desc: 'x', qty: 5000, unit: 100 }] }).items[0].qty, P.LIMITS.qtyMax);
  assert.equal(P.cleanReceipt({ items: [{ desc: 'x', qty: 0, unit: 100 }] }).items[0].qty, 1);
  // Nothing undefined ever reaches Firestore.
  const walk = (v) => { if (v === undefined) throw new Error('undefined'); if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(r);
  walk(P.cleanReceipt({}));
});

test('a void keeps its reason; anything else forgets one', () => {
  const v = P.cleanReceipt({ status: 'void', voidReason: 'Paid twice', voidAt: NOW }, { now: NOW });
  assert.equal(v.voidReason, 'Paid twice');
  assert.equal(v.voidAt, NOW);
  const s = P.cleanReceipt({ status: 'sent', voidReason: 'x', voidAt: NOW });
  assert.equal(s.voidReason, '');
  assert.equal(s.voidAt, 0);
  assert.equal(P.isLocked(v), true);
  assert.equal(P.isLocked(s), true);
  assert.equal(P.isLocked(P.cleanReceipt({})), false);
});

test('receipt numbers: prefix-year-seq, never a bad one', () => {
  assert.equal(P.numberFor('PLC', 2026, 7), 'PLC-2026-0007');
  assert.equal(P.numberFor('plc', 2026, 12345), 'PLC-2026-12345');
  assert.equal(P.numberFor('p.l c!', 2027, 1), 'PLC-2027-0001');
  assert.equal(P.numberFor('', 2026, 1), 'PLC-2026-0001', 'no prefix → the default');
  assert.equal(P.numberFor('PLC', 1999, 1), '');
  assert.equal(P.numberFor('PLC', 2026, 0), '');
  assert.deepEqual(plain(P.parseNumber('PLC-2026-0007')), { prefix: 'PLC', year: 2026, seq: 7 });
  assert.equal(P.parseNumber('nope'), null);
});

test('days are Singapore days', () => {
  assert.equal(P.dayKey(Date.UTC(2026, 10, 16, 17, 0)), '2026-11-17', '1 am in Singapore is the next day');
  assert.equal(P.dayKey(Date.UTC(2026, 10, 16, 15, 59)), '2026-11-16');
  assert.equal(P.validDay('2026-02-29'), false);
  assert.equal(P.validDay('2028-02-29'), true);
  assert.equal(P.dayLabel('2026-11-16'), '16 November 2026');
  assert.equal(P.monthLabel('2026-11-16'), 'November 2026');
  assert.equal(P.presetDesc('tuition', '2026-11-16'), 'Tuition fee — November 2026');
  assert.equal(P.presetDesc('registration', '2026-11-16'), 'Registration fee');
});

test('problems: what stops a save, and what stops a send', () => {
  const empty = P.cleanReceipt({}, { now: NOW });
  assert.ok(P.problems(empty, false).some(m => /student/.test(m)));
  assert.ok(P.problems(empty, false).some(m => /at least one line/.test(m)));
  const ok = P.cleanReceipt({ student: { name: 'Ali' }, items: [{ desc: 'Tuition', unit: 26000 }] }, { now: NOW });
  assert.deepEqual(plain(P.problems(ok, false)), []);
  assert.ok(P.problems(ok, true).some(m => /email/.test(m)), 'a send needs an address');
  assert.deepEqual(plain(P.problems(Object.assign({}, ok, { emails: ['a@b.co'] }), true)), []);
  const zero = P.cleanReceipt({ student: { name: 'Ali' }, items: [{ desc: 'Tuition', unit: 1000 }], discount: 1000 });
  assert.ok(P.problems(zero, false).some(m => /more than/.test(m)), 'a nought total is refused');
  const voided = Object.assign({}, ok, { emails: ['a@b.co'], status: 'void' });
  assert.ok(P.problems(voided, true).some(m => /voided/.test(m)));
});

test('duplicate is a fresh draft: no id, number, sends, void or reference', () => {
  const src = P.cleanReceipt({ id: 'r1', no: 'PLC-2026-0003', status: 'void', voidReason: 'oops', ref: 'T1', issued: '2026-10-01',
    student: { uid: 'u1', name: 'Ali', level: 'P4' }, emails: ['a@b.co'], items: [{ desc: 'Tuition', unit: 26000 }], sends: [{ at: NOW, to: ['a@b.co'] }] }, { now: NOW });
  const d = P.duplicate(src, NOW);
  assert.equal(d.id, '');
  assert.equal(d.no, '');
  assert.equal(d.status, 'draft');
  assert.equal(d.sends.length, 0);
  assert.equal(d.voidReason, '');
  assert.equal(d.ref, '');
  assert.equal(d.issued, '2026-11-16');
  assert.equal(d.student.name, 'Ali');
  assert.equal(d.total, 26000);
  assert.equal(src.no, 'PLC-2026-0003', 'the original is untouched');
});

test('the list: newest first, search by every word, status filter, the year’s tally', () => {
  const rows = [
    { id: 'a', no: 'PLC-2026-0001', createdAt: NOW - 3000, issued: '2026-11-01', status: 'sent', student: { name: 'Ali Tan', level: 'P5' }, items: [{ desc: 'Tuition fee — November 2026', unit: 26000 }] },
    { id: 'b', no: 'PLC-2026-0002', createdAt: NOW - 2000, issued: '2026-11-02', status: 'void', student: { name: 'Bea Lim' }, items: [{ desc: 'Registration fee', unit: 5000 }] },
    { id: 'c', no: 'PLC-2026-0003', createdAt: NOW - 1000, issued: '2026-11-03', status: 'sent', student: { name: 'Chen Hao' }, emails: ['chen@x.sg'], items: [{ desc: 'Tuition fee — November 2026', unit: 30000 }] },
    { id: 'd', createdAt: NOW, issued: '2025-12-30', status: 'sent', student: { name: 'Old' }, items: [{ desc: 'x', unit: 100 }] },
    { no: 'PLC-2026-0009', student: { name: 'No id' } }
  ];
  const list = P.receiptsOf(rows);
  assert.deepEqual(plain(list.map(r => r.id)), ['d', 'c', 'b', 'a'], 'a row with no id is dropped');
  assert.deepEqual(P.filterReceipts(list, 'tuition november', '').map(r => r.id).join(), 'c,a');
  assert.deepEqual(P.filterReceipts(list, 'chen@x', '').map(r => r.id).join(), 'c');
  assert.deepEqual(P.filterReceipts(list, '', 'void').map(r => r.id).join(), 'b');
  assert.deepEqual(P.filterReceipts(list, 'tuition bea', '').map(r => r.id).join(), '', 'every word must match');
  assert.deepEqual(plain(P.sumSent(list, 2026)), { count: 2, total: 56000 }, 'voids and other years do not count');
});

test('the roster: names, levels, parents; search', () => {
  const roster = P.rosterOf([
    { uid: 'u2', p: { name: 'Zara', level: 'P6', parentEmails: ['z@x.sg', 'bad', 'z@x.sg'] } },
    { uid: 'u1', p: { email: 'ali@school.sg', level: 'P3' } },
    { uid: 'a/b', p: { name: 'Evil' } },
    { p: { name: 'No uid' } }
  ]);
  assert.deepEqual(plain(roster.map(s => s.uid)), ['u1', 'u2']);
  assert.equal(roster[0].name, 'ali', 'no name → the email’s first half');
  assert.deepEqual(plain(roster[1].parents), ['z@x.sg']);
  assert.deepEqual(plain(P.findStudents(roster, 'p6').map(s => s.uid)), ['u2']);
  assert.equal(P.findStudents(roster, '').length, 2);
});

test('the email escapes every field and says what was paid', () => {
  const r = P.cleanReceipt({ no: 'PLC-2026-0001', student: { name: '<img src=x onerror=alert(1)>', level: 'P5' }, billTo: 'Mrs "Tan" & co',
    items: [{ desc: '<script>bad()</script> fee', qty: 2, unit: 13000 }], discount: 1000, discountNote: 'sibling', method: 'paynow', ref: 'A1', note: 'line1\nline2' }, { now: NOW });
  const centre = P.cleanCentre({ name: 'Polymath <Learning> Centre', address: '1 Road\nSingapore 123456', uen: '201912345a', phone: '6123 4567' });
  const h = P.emailHtml(r, centre, { intro: 'Dear <b>you</b>' });
  assert.ok(!/<script>|<img src=x/.test(h), 'nothing typed becomes markup');
  assert.ok(h.includes('&lt;script&gt;bad()&lt;/script&gt; fee'));
  assert.ok(h.includes('Mrs &quot;Tan&quot; &amp; co'));
  assert.ok(h.includes('Dear &lt;b&gt;you&lt;/b&gt;'));
  assert.ok(h.includes('S$250.00'), 'the total');
  assert.ok(h.includes('UEN 201912345A'));
  assert.ok(h.includes('line1<br>line2'));
  const t = P.emailText(r, centre, { intro: 'Hello' });
  assert.match(t, /^Hello/);
  assert.match(t, /RECEIPT PLC-2026-0001/);
  assert.match(t, /TOTAL PAID: S\$250\.00/);
  assert.match(t, /Discount \(sibling\): −S\$10\.00/);
  assert.match(t, /× 2 @ S\$130\.00/);
  const v = P.emailHtml(Object.assign({}, r, { status: 'void', voidReason: 'Paid twice' }), centre);
  assert.match(v, /VOID — Paid twice/);
  assert.match(P.subjectLine(r, centre), /^Receipt PLC-2026-0001 — <img/);
  assert.match(P.defaultIntro(r, centre), /^Dear Mrs "Tan" & co,/);
  assert.equal(P.fileName(Object.assign({}, r, { student: { name: 'A/B: "c"' } })), 'PLC-2026-0001 A B c.pdf');
});

test('the MIME message: text + html, the PDF attached, headers safe', () => {
  const pdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]); // %PDF-1.7
  const raw = P.mimeMessage({ from: 'admin@polymathlc.com.sg', fromName: 'Polymath Learning Centre', to: ['a@b.co', 'bad'],
    replyTo: 'admin@polymathlc.com.sg', subject: 'Receipt — 收据', text: 'hi', html: '<p>hi</p>',
    attachment: { name: 'PLC-2026-0001 陈.pdf', mime: 'application/pdf', data: P.b64Bytes(pdf) } }, 'seed1');
  assert.match(raw, /^From: Polymath Learning Centre <admin@polymathlc\.com\.sg>\r\n/);
  assert.match(raw, /\r\nTo: a@b\.co\r\n/, 'a bad address never reaches the header');
  assert.match(raw, /Subject: =\?UTF-8\?B\?/);
  assert.match(raw, /Content-Type: multipart\/mixed; boundary="mix_seed1"/);
  assert.match(raw, /Content-Type: multipart\/alternative; boundary="alt_seed1"/);
  assert.match(raw, /Content-Disposition: attachment; filename="PLC-2026-0001 _\.pdf"/);
  assert.ok(raw.includes(P.b64Bytes(pdf)));
  assert.ok(raw.trim().endsWith('--mix_seed1--'));
  assert.ok(!/\r\n(?:To|Subject):[^\r]*\n(?!\r)/.test(raw.replace(/\r\n/g, '\r\n')), 'no bare newline in headers');
  const inj = P.mimeMessage({ from: 'a@b.co', to: ['c@d.co'], subject: 'x\r\nBcc: evil@x.co', text: '', html: '' });
  assert.ok(!/\r\nBcc: evil/.test(inj), 'a newline in the subject cannot add a header');
  // base64url of the raw is ASCII-safe for the Gmail API
  assert.match(P.b64url(raw), /^[A-Za-z0-9_-]+$/);
  const noAtt = P.mimeMessage({ from: 'a@b.co', to: ['c@d.co'], subject: 's', text: 't', html: 'h' }, 'z');
  assert.ok(!/multipart\/mixed/.test(noAtt));
});

test('b64 matches Node’s', () => {
  for (const s of ['', 'a', 'ab', 'abc', 'héllo 收据 💰', 'x'.repeat(1000)]) {
    assert.equal(P.b64Utf8(s), Buffer.from(s, 'utf8').toString('base64'));
  }
  const bytes = new Uint8Array(Array.from({ length: 300 }, (_, i) => (i * 37) & 255));
  assert.equal(P.b64Bytes(bytes), Buffer.from(bytes).toString('base64'));
});

test('the Gmail compose fallback drops a body too long for a link', () => {
  const small = P.composePlan({ account: 'admin@polymathlc.com.sg', to: ['a@b.co'], subject: 'Receipt', body: 'Hello' });
  assert.equal(small.copyBody, false);
  assert.match(small.url, /^https:\/\/mail\.google\.com\/mail\/\?view=cm&fs=1&authuser=/);
  assert.match(small.url, /body=Hello/);
  const big = P.composePlan({ to: ['a@b.co'], subject: 'Receipt', body: 'x'.repeat(9000) });
  assert.equal(big.copyBody, true);
  assert.ok(!/body=/.test(big.url));
});

test('centre details: defaults, prefix and GST cleaned', () => {
  const c = P.cleanCentre({ prefix: 'po-ly', gst: '9', email: 'not', uen: ' 2019x ' });
  assert.equal(c.name, 'Polymath Learning Centre');
  assert.equal(c.prefix, 'POLY');
  assert.equal(c.gst, 9);
  assert.equal(c.email, 'admin@polymathlc.com.sg');
  assert.equal(c.uen, '2019X');
  assert.equal(P.cleanCentre({ gst: 50 }).gst, P.LIMITS.gstMax);
  assert.equal(P.cleanCentre({ gst: -1 }).gst, 0);
  assert.equal(P.cleanCentre({ footer: '' }).footer, '', 'an emptied footer stays empty');
  assert.match(P.cleanCentre(null).footer, /no signature/i);
});

test('the PDF draws with pdf-lib when it is installed (any name, any line count)', async (t) => {
  let PDFLib = null;
  for (const p of [process.env.PDF_LIB_MODULE, 'pdf-lib'].filter(Boolean)) {
    try { PDFLib = await import(p); break; } catch (e) { /* not here */ }
  }
  if (!PDFLib) { t.skip('pdf-lib is not installed here'); return; }
  const r = P.cleanReceipt({ no: 'PLC-2026-0042', student: { name: '陈小明 Chen Xiao Ming 😀', level: 'P5' }, billTo: 'Mdm Chen',
    items: Array.from({ length: 20 }, (_, i) => ({ desc: 'Tuition fee — a very long description that has to wrap onto another line for lesson ' + (i + 1), qty: 1, unit: 6500 })),
    discount: 500, discountNote: 'sibling', note: 'Thanks −', status: 'void', voidReason: 'test' }, { now: NOW });
  // pdf-lib checks plain objects by realm, so this one runs in the main realm.
  const saved = globalThis.window;
  globalThis.window = {};
  vm.runInThisContext(src);
  const Rmain = globalThis.window.Receipts;
  globalThis.window = saved;
  const bytes = await Rmain.drawPdf(PDFLib, r, { address: '1 Road\nSingapore', uen: 'X1', gst: 9, payInfo: 'PayNow UEN X1' });
  assert.ok(bytes.length > 1000);
  assert.equal(String.fromCharCode(...bytes.slice(0, 5)), '%PDF-');
  const doc = await PDFLib.PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 2, 'twenty wrapped lines run onto a second page');
});

test('the glue: teacher-only, one transaction for the number, sent receipts never rewritten', () => {
  const start = html.indexOf('/* ================= 🧾 Receipts — glue');
  const end = html.indexOf('/* ================= End receipts glue');
  assert.ok(start > 0 && end > start, 'the glue section is marked');
  const glue = html.slice(start, end);
  assert.match(glue, /function rcptTeacher\(\) \{ return !!\(currentUser && isAdmin\(currentUser\) && !actingStudent && !isSharedVisitor\(\)\); \}/);
  for (const fn of ['rcptSave', 'rcptRecordSend', 'rcptVoid', 'rcptSaveCentre', 'rcptList']) {
    const body = glue.slice(glue.indexOf('function ' + fn), glue.indexOf('\n}\n', glue.indexOf('function ' + fn)));
    assert.match(body, /rcptColl\(\)|rcptSettingsRef\(\)/, fn + ' goes through the teacher-only refs');
  }
  const save = glue.slice(glue.indexOf('async function rcptSave'), glue.indexOf('async function rcptRecordSend'));
  assert.match(save, /db\.runTransaction/);
  assert.match(save, /receiptCounters/);
  assert.match(save, /P\.isLocked\(before\)/, 'a sent receipt is refused inside the transaction');
  assert.ok(save.indexOf('tx.get(settings)') < save.indexOf('tx.set(settings'), 'reads before writes');
  assert.match(glue, /async function rcptSendGmail[\s\S]*csumAuthorizeGmail\(\)/, 'one Gmail sign-in, shared with class summaries');
  assert.match(glue, /attachment: \{ name: P\.fileName/);
  // Wired into the page.
  assert.match(html, /<button class="btn" id="receiptBtn"[^>]*style="display:none"/, 'the button starts hidden');
  assert.match(html, /<script src="receipts\.js\?v=1\.205\.0"><\/script>\n<script>rcptInit\(\);<\/script>/);
  assert.match(html, /<link rel="stylesheet" href="receipts\.css\?v=1\.205\.0">/);
  const vis = html.slice(html.indexOf('function applyRewardVisibility'), html.indexOf('function applyRewardVisibility') + 2500);
  assert.match(vis, /rcptRoleChanged\(\)/, 'a handover closes the window');
  assert.ok(html.indexOf('<script src="class-summary.js') < html.indexOf('<script src="receipts.js'), 'the Gmail glue it shares is there first');
});

test('the window module: never sends by itself, writes text only', () => {
  const create = src.slice(src.indexOf('function create(env)'));
  assert.ok(!/innerHTML/.test(src), 'nothing is written as markup');
  const sends = create.match(/env\.sendGmail\(/g) || [];
  assert.equal(sends.length, 1, 'one place sends');
  const sendFn = create.slice(create.indexOf('function sendNow'), create.indexOf('function downloadPdf'));
  assert.ok(sendFn.indexOf('ask(') < sendFn.indexOf('env.sendGmail('), 'the confirm comes before the send');
  assert.ok(sendFn.indexOf('ask(') < sendFn.indexOf('env.authorizeGmail()'), 'nothing opens before the confirm');
  assert.match(create, /previewFrame\.setAttribute\('sandbox', ''\)/, 'the preview frame runs nothing');
  assert.match(css, /\.rcBack \{[\s\S]*z-index: 4300/);
  assert.match(css, /@media print \{ \.rcBack \{ display: none !important; \} \}/);
});

test('APP_VERSION is v1.205.0', () => {
  assert.match(html, /var APP_VERSION = 'v1\.205\.0';/);
  assert.ok(existsSync(new URL('../receipts.css', import.meta.url)));
});
