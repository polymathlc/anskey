// 🧾 Class summaries for parents (v1.198.0): the pure rules and the glue's wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CS = require('../class-summary.js');
const P = CS.pure;
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const src = readFileSync(new URL('../class-summary.js', import.meta.url), 'utf8');

const at = (y, m, d, h = 17) => new Date(y, m - 1, d, h).getTime();
const BUCKET = 'mathgen--app.firebasestorage.app';
const TOKEN = '0f1e2d3c-4b5a-6978-8a9b-acbdcedf0011';
const imgUrl = (doc, day, n) => `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(`pdf-annotator/lesson-summary-${doc}-${day}-q${n}.jpg`)}?alt=media&token=${TOKEN}`;

function glue() {
  const a = html.indexOf('/* ================= 🧾 Class summary — glue');
  const b = html.indexOf('/* ================= End class summary glue ================= */');
  assert.ok(a > 0 && b > a, 'the glue section is marked');
  return html.slice(a, b);
}

test('days are real calendar days, labelled for parents', () => {
  assert.equal(P.dayKey(at(2026, 11, 14, 9)), '2026-11-14');
  assert.equal(P.dayKey(0), '');
  assert.ok(P.validDay('2026-11-14'));
  assert.ok(!P.validDay('2026-02-30'));
  assert.ok(!P.validDay('../x'));
  assert.equal(P.weekdayOf('2026-11-14'), 'Saturday');
  assert.equal(P.dayLabel('2026-11-14'), 'Saturday, 14 November 2026');
});

test('the lessons of a class day are the recordings saved that day, in order', () => {
  const anns = [
    { id: 'a', type: 'video', ts: at(2026, 11, 14, 10), page: 2, lessonRecording: { duration: 60000, title: 'Q3' } },
    { id: 'b', type: 'video', ts: at(2026, 11, 14, 9), page: 1, lessonRecording: { duration: 90000, captionsUrl: 'x', captionsLang: 'en' } },
    { id: 'c', type: 'video', ts: at(2026, 11, 7), page: 1, lessonRecording: { duration: 1 } },
    { id: 'd', type: 'video', ts: at(2026, 11, 14), page: 1, url: 'https://youtu.be/x' },   // a plain video pill, not a lesson
    { id: 'e', type: 'text', ts: at(2026, 11, 14), text: 'hi' }
  ];
  const today = P.lessonsOnDay(anns, '2026-11-14');
  assert.deepEqual(today.map(l => l.id), ['b', 'a']);
  assert.equal(today[0].captions, true);
  assert.equal(today[1].title, 'Q3');
  assert.deepEqual(P.lessonDays(anns), ['2026-11-14', '2026-11-07']);
});

test('the transcript joins close cues, keeps the end (homework is said last) and shares the budget fairly', () => {
  const cues = [{ s: 0, e: 1000, t: 'Today we look at' }, { s: 1500, e: 3000, t: 'fractions.' }, { s: 9000, e: 10000, t: 'Homework is page 12.' }];
  const t = P.transcriptOf(cues, 10000);
  assert.equal(t, '[0:00] Today we look at fractions.\n[0:09] Homework is page 12.');
  const long = Array.from({ length: 400 }, (_, i) => ({ s: i * 5000, e: i * 5000 + 1000, t: 'sentence number ' + i + ' about the topic' }));
  long.push({ s: 2100000, e: 2101000, t: 'Your homework is workbook page 40.' });
  const short = P.transcriptOf(long, 2000);
  assert.ok(short.length <= 2100, 'capped');
  assert.match(short, /homework is workbook page 40/, 'the end survives');
  assert.match(short, /shortened/);
  const shares = P.transcriptShares([500, 90000, 90000], 60000, 3000);
  assert.equal(shares[0], 500, 'a short lesson keeps every word');
  assert.ok(shares[1] > 20000 && shares[1] === shares[2], 'the long ones split the rest');
  assert.ok(shares.reduce((a, b) => a + b, 0) <= 60000);
});

test('links: known ones always, written ones kept, heard ones flagged, invented ones dropped', () => {
  const known = [{ label: 'Answer key', url: 'https://firebasestorage.googleapis.com/v0/b/x/o/k.pdf?alt=media', kind: 'key' }];
  const source = 'Practise on https://www.seneca.example/maths today. [0:10] go to khan academy';
  const out = P.reconcileLinks([
    { label: 'Seneca', url: 'seneca.example/maths' },                    // no scheme: not a link the model may write…
    { label: 'Seneca practice', url: 'https://seneca.example/maths/' },   // …this one matches what was written
    { label: 'Made up', url: 'https://totally-invented.example/page' },   // nowhere in the class: dropped
    { label: 'Khan Academy', url: 'https://www.khanacademy.org', heard: true },
    { label: 'The Seneca site again', url: 'https://www.seneca.example/maths' },
    { label: 'A site with no address', url: '', heard: true },
    { label: 'Bad', url: 'javascript:alert(1)' }
  ], known, source);
  assert.deepEqual(out.map(l => [l.label, !!l.check]), [
    ['Seneca practice', false],
    ['Khan Academy', true],
    ['A site with no address', true],
    ['Answer key', false]
  ]);
  assert.equal(out[0].url, 'https://seneca.example/maths/');
  assert.ok(!out.some(l => /invented|javascript/.test(l.url)));
  assert.deepEqual(P.extractUrls('see www.abc.example/x). and https://a.example/b, then https://a.example/b'), ['https://www.abc.example/x', 'https://a.example/b']);
  assert.equal(P.normUrl('https://user:pw@a.example/'), '', 'no credentials in a link');
  assert.equal(P.normUrl('ftp://a.example'), '');
});

test('the prompt carries the class and asks for JSON; the reply is read from prose or a fence', () => {
  const p = P.buildPrompt({ worksheet: 'Fractions 2', level: 'P5', subject: 'math', day: '2026-11-14', pages: 3,
    lessons: [{ title: 'Q3', duration: 61000, page: 2, transcript: '[0:00] Homework is page 12.' }],
    board: 'Remember: common denominator', links: [{ label: 'Answer key', url: 'https://a.example/k' }],
    questionRefs: [{ page: 2, refs: ['Q3', 'Q4'] }], grounding: 'TEACHING NOTES' });
  assert.match(p.user, /P5 Mathematics — worksheet "Fractions 2" — Saturday, 14 November 2026/);
  assert.match(p.user, /Recording 1 \(Q3\), page 2, 1:01/);
  assert.match(p.user, /Homework is page 12/);
  assert.match(p.user, /page 2: Q3, Q4/);
  assert.match(p.system, /NEVER invent homework/);
  assert.match(p.system, /Never invent an address/);
  assert.match(p.system, /TEACHING NOTES$/);
  assert.match(P.buildPrompt({ lessons: [] }).user, /no recorded explanations/);
  assert.deepEqual(P.parseReply('Here you go:\n```json\n{"title":"A"}\n```'), { title: 'A' });
  assert.deepEqual(P.parseReply('blah {"title":"B"} blah'), { title: 'B' });
  assert.equal(P.parseReply('no json'), null);
});

test('cleanSummary is the one door: caps, drops "no homework", keeps only real pictures', () => {
  const s = P.cleanSummary({
    title: 'Adding unlike fractions', overview: 'We learned…', points: ['One', { text: 'Two' }, '', 'x'.repeat(900)],
    homework: [{ task: 'Workbook p. 12', due: 'Wednesday' }, 'None', { task: '' }],
    links: [{ label: 'L', url: 'https://a.example' }],
    questions: [
      { ref: '3', page: 2, text: 'Find 1/2 + 1/3.', why: 'Core', answer: '5/6', img: imgUrl('doc1', '2026-11-14', 1) },
      { ref: 'Q4', page: 2, text: 'Q4 text', img: 'https://evil.example/x.jpg' },
      { ref: 'Q5', text: '' }
    ],
    parentNote: 'Ask them to explain.', edited: true
  }, { day: '2026-11-14', now: 5, model: 'claude-opus-5-5', engine: 'Claude', lessons: 2 });
  assert.equal(s.points.length, 3);
  assert.ok(s.points[2].length <= P.LIMITS.point);
  assert.deepEqual(s.homework, [{ task: 'Workbook p. 12', due: 'Wednesday' }]);
  assert.equal(s.questions.length, 2);
  assert.equal(s.questions[0].ref, 'Q3');
  assert.equal(s.questions[0].img, imgUrl('doc1', '2026-11-14', 1));
  assert.equal(s.questions[1].img, '', 'a picture from anywhere else is dropped');
  assert.equal(s.day, '2026-11-14');
  assert.equal(s.lessons, 2);
  assert.equal(s.edited, true);
  assert.equal(P.cleanSummary({}, {}), null);
  assert.equal(P.cleanSummary({ overview: 'Only words' }).title, 'Today’s class');
  // Nothing undefined ever reaches Firestore.
  const walk = v => { if (v === undefined) throw new Error('undefined'); if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(s);
  const map = P.summariesOf({ '2026-11-14': s, 'bad': s, '2026-11-13': { title: '' } });
  assert.deepEqual(Object.keys(map), ['2026-11-14']);
});

test('the question pictures are named under the teacher-only lesson- rule and only Storage links are trusted', () => {
  assert.equal(P.imagePath('pdf-annotator', 'doc_1', '2026-11-14', 2), 'pdf-annotator/lesson-summary-doc_1-2026-11-14-q2.jpg');
  assert.match(P.imagePath('pdf-annotator', 'd', '2026-11-14', 1).split('/')[1], /^lesson-/);
  assert.equal(P.imagePath('pdf-annotator', '../x', '2026-11-14', 1), '');
  assert.equal(P.imagePath('pdf-annotator', 'd', '2026-11-14', 9), '');
  assert.ok(P.validImageUrl(imgUrl('d', '2026-11-14', 1)));
  assert.ok(!P.validImageUrl(imgUrl('d', '2026-11-14', 1).replace('alt=media&', '')));
  assert.ok(!P.validImageUrl('https://evil.example/o/pdf-annotator%2Flesson-summary-d-2026-11-14-q1.jpg?alt=media&token=' + TOKEN));
});

test('a question is cut from just above its number to just above the next', () => {
  const items = [
    { str: '1.', x: 30, y: 100 }, { str: '2', x: 30, y: 300 }, { str: '2', x: 400, y: 320 },   // a "2" in the body is not a number
    { str: 'Q3)', x: 32, y: 520 }, { str: '1', x: 30, y: 700 },                                // a stray 1 below Q3 is not Q1
    { str: '1.5 kg', x: 30, y: 600 }
  ];
  const marks = P.questionMarks(items, 600);
  assert.deepEqual(marks.map(m => m.n), [1, 2, 3]);
  const band = P.questionBand(marks, 'Q2', 600, 842);
  assert.ok(band.y < 300 && band.y + band.h < 520 && band.y + band.h > 450);
  assert.equal(Math.round(band.x), 18);
  const last = P.questionBand(marks, 'Q3(b)', 600, 842);
  assert.ok(last.y + last.h <= 842);
  assert.equal(P.questionBand(marks, 'Q9', 600, 842), null);
  assert.equal(P.questionBand(marks, 'Intro', 600, 842), null);
});

test('plan: automatic runs never touch an edited or sent summary, and never run outside the teacher', () => {
  const now = at(2026, 11, 14, 18);
  const base = { teacher: true, practice: false, docId: 'doc1', now, auto: true, lessonsByDay: { '2026-11-14': 2 }, summaries: {}, fp: 'f1' };
  assert.deepEqual(P.plan('lesson', base), { day: '2026-11-14', why: 'new' });
  assert.equal(P.plan('lesson', { ...base, teacher: false }).day, '');
  assert.equal(P.plan('lesson', { ...base, practice: true }).day, '');
  assert.equal(P.plan('lesson', { ...base, docId: '' }).day, '');
  assert.equal(P.plan('lesson', { ...base, auto: false }).why, 'auto-off');
  assert.equal(P.plan('lesson', { ...base, lessonsByDay: {} }).why, 'no-lessons');
  const sum = (x) => ({ '2026-11-14': { lessons: 2, fp: 'f0', edited: false, sends: [], ...x } });
  assert.equal(P.plan('lesson', { ...base, summaries: sum({ sends: [{ at: now }] }) }).why, 'sent');
  assert.equal(P.plan('lesson', { ...base, summaries: sum({ edited: true }) }).why, 'edited');
  assert.equal(P.plan('lesson', { ...base, summaries: sum({ fp: 'f1' }) }).why, 'unchanged');
  assert.equal(P.plan('lesson', { ...base, summaries: sum({}) }).why, 'refresh');
  // Opening: the last class day, only while recent, only when there is none yet.
  assert.equal(P.plan('open', { ...base, lastLessonDay: '2026-11-14' }).day, '2026-11-14');
  assert.equal(P.plan('open', { ...base, lastLessonDay: '2026-11-14', summaries: sum({}) }).why, 'exists');
  assert.equal(P.plan('open', { ...base, lastLessonDay: '2026-10-01', lessonsByDay: { '2026-10-01': 1 } }).why, 'old');
  // Manual: whatever day was asked, even with auto off or an edited summary (the window asks first).
  assert.equal(P.plan('manual', { ...base, auto: false, day: '2026-11-07', summaries: sum({ edited: true }) }).day, '2026-11-07');
  assert.equal(P.plan('manual', { ...base, teacher: false, day: '2026-11-07' }).day, '');
});

test('the parents: the class roster by level, subject and day, Bcc deduped, never the sender', () => {
  const rows = [
    { uid: 'u1', p: { name: 'Amy', level: 'P5', subject: 'math', days: ['Saturday'], parentEmails: ['Mum@Example.com', 'dad@example.com', 'mum@example.com'] } },
    { uid: 'u2', p: { name: 'Ben', level: 'P5', subject: 'both', days: ['Monday'], parentEmails: ['ben.parent@example.com'] } },
    { uid: 'u3', p: { name: 'Cat', level: 'P5', subject: 'science', days: ['Saturday'], parentEmails: ['cat@example.com'] } },
    { uid: 'u4', p: { name: 'Dan', level: 'P4', subject: 'math', days: ['Saturday'], parentEmails: ['dan@example.com'] } },
    { uid: 'u5', p: { name: 'Eve', level: 'P5', subject: 'math', days: [], parentEmails: 'eve@example.com; not-an-email' } }
  ];
  const r = P.recipientsFor(rows, { level: 'P5', subject: 'math', weekday: 'Saturday' });
  assert.deepEqual(r.map(x => [x.name, x.inClass]), [['Amy', true], ['Eve', true], ['Ben', false]]);
  assert.deepEqual(r[0].parents, ['mum@example.com', 'dad@example.com']);
  assert.deepEqual(r[1].parents, ['eve@example.com']);
  const bcc = P.mergeRecipients(r, { u1: true, u2: true }, 'extra@example.com, admin@polymathlc.com.sg, DAD@example.com', P.SENDER);
  assert.deepEqual(bcc, ['mum@example.com', 'dad@example.com', 'ben.parent@example.com', 'extra@example.com']);
  assert.deepEqual(P.mergeRecipients(r, {}, '', P.SENDER), [], 'nobody ticked: nobody emailed');
  assert.equal(P.cleanParentEmails('a@x.co, b@x.co, c@x.co, d@x.co, e@x.co').length, P.LIMITS.parentsPerStudent);
});

test('the email escapes everything, leaves unchecked links out, and answers only when asked', () => {
  const s = P.cleanSummary({
    title: '<b>Fractions</b>', overview: 'We <script>alert(1)</script> learned.', points: ['A & B'],
    homework: [{ task: 'Page 12', due: 'Wed' }],
    links: [{ label: 'Good', url: 'https://good.example' }, { label: 'Heard', url: 'https://heard.example', heard: true, check: true }],
    questions: [{ ref: 'Q3', page: 2, text: 'What is 1/2 + 1/3?', why: 'Core', answer: '5/6', img: imgUrl('d', '2026-11-14', 1) },
                { ref: 'Q4', page: 2, text: 'Left out', include: false }],
    parentNote: 'Ask them.'
  }, { day: '2026-11-14' });
  const h = P.emailHtml(s, { images: 'url', worksheet: 'WS', classLine: 'P5 Mathematics' });
  assert.ok(!/<script>/.test(h) && /&lt;script&gt;/.test(h));
  assert.ok(/&lt;b&gt;Fractions/.test(h));
  assert.match(h, /https:\/\/good\.example/);
  assert.ok(!/heard\.example/.test(h), 'an unchecked heard link never reaches a parent');
  assert.ok(!/Left out/.test(h));
  assert.ok(!/5\/6/.test(h), 'no answers unless asked');
  assert.match(P.emailHtml(s, { includeAnswers: true }), /Answer: 5\/6/);
  assert.match(h, /lesson-summary-d-2026-11-14-q1/);
  const cid = P.emailHtml({ ...s, questions: [{ ...s.questions[0], cid: 'q1.x' }] }, { images: 'cid' });
  assert.match(cid, /src="cid:q1\.x"/);
  const t = P.emailText(s, { imageLinks: true });
  assert.match(t, /HOMEWORK\n• Page 12 \(due Wed\)/);
  assert.match(t, /1\. Q3 \(page 2\): What is 1\/2 \+ 1\/3\?/);
  assert.match(t, /Picture: https:\/\/firebasestorage/);
  assert.match(P.emailText({ ...s, homework: [] }), /No homework was set/);
  assert.equal(P.subjectLine(s, { level: 'P5', subjectWord: 'Mathematics' }), 'P5 Mathematics — <b>Fractions</b> (Saturday, 14 November 2026)');
});

test('the MIME message for Gmail: headers encoded, parts base64, pictures by cid', () => {
  const raw = P.mimeMessage({ from: P.SENDER, fromName: 'Polymath Learning Centre', to: [P.SENDER], bcc: ['a@x.co', 'bad', 'b@x.co'],
    subject: 'P5 — Fractions ½', html: '<p>Hi ½</p>', text: 'Hi ½', images: [{ cid: 'q1.x', mime: 'image/jpeg', data: 'AAAA' }, { cid: 'bad cid', data: 'x' }] }, 'seed');
  assert.match(raw, /^From: Polymath Learning Centre <admin@polymathlc\.com\.sg>\r\n/);
  assert.match(raw, /\r\nBcc: a@x\.co, b@x\.co\r\n/);
  assert.match(raw, /\r\nSubject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=\r\n/);
  assert.match(raw, /multipart\/alternative; boundary="alt_seed"/);
  assert.match(raw, /multipart\/related; boundary="rel_seed"/);
  assert.match(raw, /Content-ID: <q1\.x>/);
  assert.ok(!/bad cid/.test(raw));
  assert.ok(/^[\x00-\x7f]*$/.test(raw), 'the whole message is ASCII');
  const htmlPart = raw.split('Content-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n')[0];
  assert.equal(Buffer.from(htmlPart, 'base64').toString('utf8'), '<p>Hi ½</p>');
  assert.equal(Buffer.from(P.b64url(raw).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'), raw);
  assert.equal(P.encodeHeader('Plain'), 'Plain');
});

test('the Gmail compose fallback keeps the addresses and moves a long body to the clipboard', () => {
  const short = P.composePlan({ account: P.SENDER, to: [P.SENDER], bcc: ['a@x.co'], subject: 'S', body: 'Hi' });
  assert.ok(short.url.startsWith('https://mail.google.com/mail/?view=cm'));
  assert.match(short.url, /authuser=admin%40polymathlc\.com\.sg/);
  assert.equal(short.copyBody, false);
  const long = P.composePlan({ account: P.SENDER, to: [P.SENDER], bcc: ['a@x.co'], subject: 'S', body: 'x'.repeat(9000) });
  assert.equal(long.copyBody, true);
  assert.ok(long.url && !/body=/.test(long.url));
});

test('the Claude request: adaptive thinking, explicit effort, no sampling fields, pictures before the words', () => {
  const b = P.claudeRequest({ model: 'claude-sonnet-5-5', system: 'S', user: 'U', images: [{ data: 'AA', mimeType: 'image/png' }] });
  assert.equal(b.model, 'claude-sonnet-5-5');
  assert.deepEqual(b.thinking, { type: 'adaptive' });
  assert.equal(b.output_config.effort, 'medium');
  assert.equal(b.fallbacks, 'default');
  assert.ok(!('temperature' in b) && !('top_p' in b) && !JSON.stringify(b).includes('budget_tokens'));
  assert.equal(b.messages[0].content[0].type, 'image');
  assert.equal(b.messages[0].content[1].text, 'U');
  assert.ok(b.max_tokens >= 1024);
  assert.equal(P.claudeRequest({ model: 'gpt-4' }).model, P.DEFAULT_MODEL, 'only listed models');
  assert.equal(P.DEFAULT_MODEL, 'claude-opus-5-5');
  assert.equal(P.claudeText({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: ' {"a":1} ' }], stop_reason: 'end_turn' }), '{"a":1}');
  assert.throws(() => P.claudeText({ content: [], stop_reason: 'refusal', stop_details: { category: 'cyber' } }), /declined/);
  assert.throws(() => P.claudeText({ content: [], stop_reason: 'max_tokens' }), /ran out of room/);
});

test('the window writes with textContent and never sends by itself', () => {
  assert.ok(!/innerHTML\s*=/.test(src), 'no innerHTML in class-summary.js');
  assert.ok(!/insertAdjacentHTML/.test(src));
  // The only callers of env.sendGmail are inside sendNow, behind a confirm.
  const sendNow = src.slice(src.indexOf('function sendNow('), src.indexOf('function renderSettings('));
  assert.match(sendNow, /window\.confirm\(/);
  assert.ok(src.split('env.sendGmail(').length === 2, 'one door to sending');
  assert.match(src, /'keydown', 'keyup', 'keypress'/);
  assert.match(src, /e\.stopPropagation\(\)/);
  assert.match(src, /frame\.setAttribute\('sandbox', ''\)/, 'the preview frame runs nothing');
});

test('the glue: hooked after each lesson, teacher only, never sends on its own', () => {
  const g = glue();
  // After the lesson, beside the answer key, behind the context check.
  assert.match(html, /akoAfterLesson\(\);\n\s*\/\/ 🧾[^\n]*\n\s*if \(lessonContextOK\(job\) && typeof csumAfterLesson === 'function'\) csumAfterLesson\(\);/);
  assert.match(html, /akoReadDoc\(d\);[^\n]*\n\s*if \(typeof csumReadDoc === 'function'\) csumReadDoc\(d\);/);
  assert.match(html, /akoReadDoc\(data\);[^\n]*\n\s*if \(typeof csumReadDoc === 'function'\) csumReadDoc\(data\);/);
  assert.match(html, /akoForget\(\);[^\n]*\n\s*if \(typeof csumForget === 'function'\) csumForget\(\);/);
  assert.match(html, /csumRoleChanged\(\);/);
  assert.match(html, /'akoPublishBtn', 'classSummaryBtn'/, 'the button is in TEACHER_TOOLBAR_IDS');
  assert.match(html, /<script src="class-summary\.js\?v=1\.198\.0"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="class-summary\.css\?v=1\.198\.0">/);
  { const m = html.match(/var APP_VERSION = 'v1\.(\d+)\.\d+'/); assert.ok(m && +m[1] >= 198, 'APP_VERSION is v1.198.0 or later'); }
  // Sending is reached only from the window's env (a tap), never from a timer or a run.
  const run = g.slice(g.indexOf('async function csumRun('), g.indexOf('async function csumSave('));
  assert.ok(!/csumSendGmail|sendGmail|gmail\.googleapis/.test(run), 'writing a summary never sends it');
  const afterLesson = g.slice(g.indexOf('function csumAfterLesson('), g.indexOf('function csumSyncBadge('));
  assert.ok(!/send/i.test(afterLesson.replace(/never emailed/g, '')));
  assert.match(g, /sendGmail: csumSendGmail/);
  // Grounded like every AI feature, Claude first and Chung GPT behind it.
  const ask = g.slice(g.indexOf('async function csumAsk('), g.indexOf('/* ---- reading the class'));
  assert.match(ask, /aiGrounding\('teach'\)/);
  assert.match(ask, /askClaude\(/);
  assert.match(ask, /window\.askGemini\(/);
  // Teacher gates in every writer.
  ['async function csumSetClaudeKey(', 'async function csumSave(', 'async function csumSaveParents(', 'function csumAuthorizeGmail(', 'async function csumSendGmail(', 'function csumOpen('].forEach(name => {
    const body = g.slice(g.indexOf(name), g.indexOf(name) + 400);
    assert.match(body, /csumTeacher\(\)/, name + ' asks for the teacher');
  });
  // The run re-checks the worksheet after every wait and skips practice.
  assert.match(run, /stillHere\(\)/);
  assert.match(g, /practice: !!practiceMode/);
  // The Claude key lives in the admin's own record, never in the page.
  assert.ok(!/sk-ant-[A-Za-z0-9]{8,}/.test(html), 'no key in the page source');
  assert.match(g, /aiEngineDocRef\(\)/);
  assert.match(g, /'anthropic-dangerous-direct-browser-access': 'true'/);
  // Gmail: the centre's account only, the send scope only, and the teacher's own session untouched.
  assert.match(g, /gmail\.send'/);
  assert.match(g, /'csumMailer'/);
  assert.match(g, /email !== SENDER/);
  assert.match(g, /mAuth\.signOut\(\)/);
  // Pictures under the teacher-only Storage rule.
  assert.match(g, /P\.imagePath\(STORAGE_DIR, docAtStart, day, k \+ 1\)/);
  // A deliberate mistake is never read as the teacher's words.
  assert.match(g, /annHoldsMistake\(a\)/);
});
