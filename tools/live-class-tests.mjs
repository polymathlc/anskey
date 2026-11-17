// 🎥 Live class — the pure helpers, the module's safety rules and the glue.
// Run: node --test tools/live-class-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const src = fs.readFileSync(new URL('live-class.js', root), 'utf8');
const css = fs.readFileSync(new URL('live-class.css', root), 'utf8');
const html = fs.readFileSync(new URL('index.html', root), 'utf8');

function load() {
  const sandbox = { console, TextEncoder, TextDecoder, Date, Math, JSON };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'live-class.js' });
  return sandbox.LiveClass;
}
const LC = load();
const P = LC.pure;
// Objects made inside the vm have the vm's prototypes; compare as JSON.
const plain = v => JSON.parse(JSON.stringify(v));

test('the module loads with no DOM and exposes pure + create', () => {
  assert.equal(typeof LC.create, 'function');
  assert.equal(P.VERSION, '1.216.0');
  assert.equal(P.TOPIC, 'plc');
});

test('the version shown in the app matches the module', () => {
  assert.match(html, /var APP_VERSION = 'v1\.2(1[2-9]|[2-9]\d)\.\d+'/);
  assert.match(html, /live-class\.js\?v=1\.216\.0/);
});

/* ---------- questions ---------- */
test('cleanQuestion is the one door: kinds, options, answer, targets', () => {
  assert.equal(P.cleanQuestion(null), null);
  assert.equal(P.cleanQuestion({ id: 'q1', kind: 'essay', text: 'x' }), null);
  assert.equal(P.cleanQuestion({ id: 'bad id!', kind: 'mcq', text: 'x', options: ['a', 'b'] }), null);
  assert.equal(P.cleanQuestion({ id: 'q1', kind: 'mcq', text: 'x', options: ['only one'] }), null, 'mcq needs two options');
  const q = P.cleanQuestion({ id: 'q1', kind: 'mcq', text: ' Which? ', options: ['Iron', '', 'Wood', '', ''], answer: 0, to: ['r:fam_s1', 't:teacher', 'nonsense'] });
  assert.deepEqual(plain(q.options), ['Iron', 'B', 'Wood'], 'trailing blanks dropped, a middle blank named by its letter');
  assert.equal(q.answer, 0);
  assert.deepEqual(plain(q.to), ['r:fam_s1'], 'only student identities can be targets');
  const all = P.cleanQuestion({ id: 'q2', kind: 'mcq', text: 'x', options: ['a', 'b'], answer: 7, to: ['t:abc'] });
  assert.equal(all.answer, -1, 'an answer off the end is no answer');
  assert.equal(all.to, 'all', 'no valid target means everyone');
  const blank = P.cleanQuestion({ id: 'q3', kind: 'blank', text: 'Water boils at ___', accepted: '100\n100 °C' });
  assert.deepEqual(plain(blank.accepted), ['100', '100 °C']);
  const open = P.cleanQuestion({ id: 'q4', kind: 'open', text: 'Explain', model: 'Because metal conducts heat.' });
  assert.equal(open.photo, true);
  assert.equal(open.model, 'Because metal conducts heat.');
  assert.equal(P.cleanQuestion({ id: 'q5', kind: 'open', text: '' }), null, 'no words and no picture is no question');
  assert.ok(P.cleanQuestion({ id: 'q6', kind: 'open', text: '', img: { ref: 'i1', n: 3 } }), 'a picture alone is a question');
});

test('a student is never sent the answer', () => {
  const q = P.cleanQuestion({ id: 'q1', kind: 'mcq', text: 'x', options: ['a', 'b'], answer: 1 });
  const s = P.questionForStudent(q);
  assert.equal('answer' in s, false);
  const b = P.questionForStudent(P.cleanQuestion({ id: 'q2', kind: 'blank', text: 'x', accepted: ['42'] }));
  assert.equal('accepted' in b, false);
  const o = P.questionForStudent(P.cleanQuestion({ id: 'q3', kind: 'open', text: 'x', model: 'secret' }));
  assert.equal('model' in o, false);
  assert.equal(JSON.stringify(o).includes('secret'), false);
});

test('meantFor: everyone, or only the chosen', () => {
  assert.equal(P.meantFor({ to: 'all' }, 'r:a_b'), true);
  assert.equal(P.meantFor({ to: ['r:a_b'] }, 'r:a_b'), true);
  assert.equal(P.meantFor({ to: ['r:a_b'] }, 'r:c_d'), false);
  assert.equal(P.meantFor(null, 'r:a_b'), false);
});

/* ---------- marking ---------- */
test('fill-in-the-blank marks generously on form, exactly on substance', () => {
  const m = (acc, v) => P.blankMatches(acc, v);
  assert.equal(m(['Evaporation'], 'evaporation.'), true);
  assert.equal(m(['the heart'], 'Heart'), true);
  assert.equal(m(['100'], '100.0'), true);
  assert.equal(m(['0.5'], '1/2'), true);
  assert.equal(m(['0.5'], '.5'), true);
  assert.equal(m(['1.5'], '1 1/2'), true, 'a mixed number');
  assert.equal(m(['5.5'], '1 1/2'), false, 'a mixed number is never read as 11/2');
  assert.equal(m(['1000'], '1,000'), true);
  assert.equal(m(['3'], '3 cm'), true, 'no unit asked for: any unit is fine');
  assert.equal(m(['3 cm'], '3 m'), false, 'a unit asked for must match');
  assert.equal(m(['3 cm'], '3cm'), true);
  assert.equal(m(['condensation'], 'evaporation'), false);
  assert.equal(m(['42'], ''), false);
  assert.equal(P.numberOf('-1 1/2'), -1.5);
});

test('autoMark: mcq by index, blank by the key, open never', () => {
  const mcq = P.cleanQuestion({ id: 'q1', kind: 'mcq', text: 'x', options: ['a', 'b', 'c'], answer: 2 });
  assert.equal(P.autoMark(mcq, 2), true);
  assert.equal(P.autoMark(mcq, 0), false);
  const unkeyed = P.cleanQuestion({ id: 'q2', kind: 'mcq', text: 'x', options: ['a', 'b'] });
  assert.equal(P.autoMark(unkeyed, 0), null, 'no right answer ticked: the teacher marks');
  const blank = P.cleanQuestion({ id: 'q3', kind: 'blank', text: 'x', accepted: ['7'] });
  assert.equal(P.autoMark(blank, '7'), true);
  assert.equal(P.autoMark(P.cleanQuestion({ id: 'q4', kind: 'open', text: 'x' }), 'anything'), null);
  assert.equal(P.answerText(mcq, 1), 'B. b');
});

test('cleanAnswer refuses what a kind cannot hold', () => {
  assert.equal(P.cleanAnswer('mcq', '2'), 2);
  assert.equal(P.cleanAnswer('mcq', -1), null);
  assert.equal(P.cleanAnswer('mcq', 99), null);
  assert.equal(P.cleanAnswer('blank', '   '), null);
  assert.equal(P.cleanAnswer('open', 'a\r\nb'), 'a\nb');
  assert.equal(P.cleanAnswer('open', 'x'.repeat(5000)).length, P.LIMITS.answer);
});

/* ---------- the wire ---------- */
test('messages round-trip and junk is refused', () => {
  const bytes = P.encode({ t: 'a', aid: 'a1', v: 'héllo ✓' });
  assert.deepEqual(plain(P.decode(bytes)), { t: 'a', aid: 'a1', v: 'héllo ✓' });
  assert.equal(P.decode(new TextEncoder().encode('not json')), null);
  assert.equal(P.decode(new TextEncoder().encode('{"no":"type"}')), null);
  assert.equal(P.decode(new TextEncoder().encode(JSON.stringify({ t: 'x', d: 'y'.repeat(70000) }))), null, 'oversized');
});

test('a picture travels in pieces and is rebuilt in any order, once', () => {
  const img = 'data:image/jpeg;base64,' + 'A'.repeat(30000);
  const parts = P.chunkImage(img, 'p1');
  assert.ok(parts.length >= 3);
  for (const part of parts) assert.ok(JSON.stringify(part).length < 15000, 'each piece fits one reliable message');
  const asm = P.makeAssembler();
  const shuffled = parts.slice().reverse();
  let whole = null;
  shuffled.forEach((p, i) => { const r = asm.add(p); if (i < shuffled.length - 1) assert.equal(r, null); else whole = r; });
  assert.equal(whole, img);
  assert.equal(asm.has('p1'), false, 'forgotten once whole');
  const asm2 = P.makeAssembler();
  assert.equal(asm2.add({ t: 'img', ref: 'p2', i: 0, n: 2, d: 'x' }), null);
  assert.equal(asm2.add({ t: 'img', ref: 'p2', i: 0, n: 3, d: 'x' }), null, 'a piece that disagrees about the count is refused');
  assert.equal(asm2.add({ t: 'img', ref: '../evil', i: 0, n: 1, d: 'x' }), null);
  const asm3 = P.makeAssembler();
  assert.equal(asm3.add({ t: 'img', ref: 'p3', i: 0, n: 1, d: 'javascript:alert(1)' }), null, 'only a real picture is rebuilt');
});

test('the student outbox keeps one answer per question until it is acknowledged', () => {
  let box = {};
  box = P.outboxAdd(box, { aid: 'a1', qid: 'q1', at: 1 });
  box = P.outboxAdd(box, { aid: 'a2', qid: 'q2', at: 2 });
  box = P.outboxAdd(box, { aid: 'a3', qid: 'q1', at: 3 });
  assert.deepEqual(Object.keys(box).sort(), ['a2', 'a3'], 'a newer answer to q1 replaces the older one');
  assert.deepEqual(plain(P.outboxDue(box, 10, 4000).map(e => e.aid)), ['a2', 'a3'], 'never sent: due now, oldest first');
  box.a2.sentAt = 9;
  assert.deepEqual(plain(P.outboxDue(box, 10, 4000).map(e => e.aid)), ['a3']);
  assert.deepEqual(plain(P.outboxDue(box, 9 + 4000, 4000).map(e => e.aid)), ['a2', 'a3'], 'resent after the interval');
  box = P.outboxAck(box, 'a3');
  assert.deepEqual(Object.keys(box), ['a2']);
});

/* ---------- the lesson record ---------- */
function lesson() {
  let s = P.emptySession(5, 'WED-2', 1000);
  s.slotLabel = 'Wed 5:00pm · P5 Science';
  s = P.personJoined(s, { identity: 'r:famA_s1', name: 'Ethan Lim', kind: 'roster', rosterId: 'famA_s1' }, 1000);
  s = P.personJoined(s, { identity: 'g:anon1', name: 'Bella Koh', kind: 'trial' }, 1000);
  s = P.personJoined(s, { identity: 't:teacher', name: 'Teacher' }, 1000);
  const q1 = P.cleanQuestion({ id: 'q1', kind: 'mcq', text: 'Which conducts heat best?', options: ['Wood', 'Iron'], answer: 1, at: 2000, n: 1 });
  const q2 = P.cleanQuestion({ id: 'q2', kind: 'blank', text: 'Water boils at ___ °C', accepted: ['100'], at: 3000, n: 2 });
  const q3 = P.cleanQuestion({ id: 'q3', kind: 'open', text: 'Explain', at: 4000, n: 3, to: ['r:famA_s1'] });
  s.questions = [q1, q2, q3];
  return s;
}

test('presence is counted across a drop-out and a rejoin', () => {
  let s = lesson();
  assert.equal(s.people['t:teacher'], undefined, 'the teacher is not a student');
  s = P.personLeft(s, 'r:famA_s1', 1000 + 10 * 60000);
  s = P.personJoined(s, { identity: 'r:famA_s1', name: 'Ethan Lim' }, 1000 + 12 * 60000);
  assert.equal(P.minutesPresent(s.people['r:famA_s1'], 1000 + 42 * 60000), 40);
  assert.equal(s.people['r:famA_s1'].kind, 'roster', 'kind survives a rejoin that does not repeat it');
});

test('recordAnswer: fresh, duplicate, changed, closed, empty, unknown', () => {
  let s = lesson();
  let r = P.recordAnswer(s, 'r:famA_s1', { qid: 'q1', aid: 'a1', v: 1 }, 5000);
  assert.equal(r.fresh, true);
  assert.equal(r.entry.auto, true);
  s = r.session;
  r = P.recordAnswer(s, 'r:famA_s1', { qid: 'q1', aid: 'a1', v: 1 }, 6000);
  assert.equal(r.reason, 'duplicate', 'a resend of the same answer is not news');
  r = P.recordAnswer(s, 'r:famA_s1', { qid: 'q1', aid: 'a2', v: 0 }, 7000);
  assert.equal(r.fresh, true);
  assert.equal(r.entry.edits, 1);
  assert.equal(r.entry.auto, false);
  s = r.session;
  assert.equal(P.recordAnswer(s, 'r:famA_s1', { qid: 'nope', aid: 'a9', v: 1 }, 1).reason, 'unknown');
  assert.equal(P.recordAnswer(s, 'r:famA_s1', { qid: 'q2', aid: 'a9', v: '  ' }, 1).reason, 'empty');
  const closed = Object.assign({}, s, { questions: s.questions.map(q => q.id === 'q2' ? Object.assign({}, q, { open: false }) : q) });
  assert.equal(P.recordAnswer(closed, 'g:anon1', { qid: 'q2', aid: 'a5', v: '100' }, 1).reason, 'closed');
  const photo = P.recordAnswer(s, 'r:famA_s1', { qid: 'q3', aid: 'a6', v: '', ph: 'p1' }, 8000);
  assert.equal(photo.fresh, true, 'a photo alone is an answer');
  assert.equal(photo.entry.ph, 'p1');
});

test('markOf: the teacher overrides the key', () => {
  assert.equal(P.markOf({ auto: true, ok: null }), true);
  assert.equal(P.markOf({ auto: true, ok: false }), false);
  assert.equal(P.markOf({ auto: null, ok: null }), null);
  assert.equal(P.markOf(null), null);
});

test('questionStats counts who is still owed an answer', () => {
  let s = lesson();
  s = P.recordAnswer(s, 'r:famA_s1', { qid: 'q1', aid: 'a1', v: 1 }, 5000).session;
  const st = P.questionStats(s, s.questions[0], ['r:famA_s1', 'g:anon1']);
  assert.equal(st.answered, 1);
  assert.equal(st.right, 1);
  assert.deepEqual(plain(st.waiting), ['g:anon1']);
  const st3 = P.questionStats(s, s.questions[2], ['r:famA_s1', 'g:anon1']);
  assert.equal(st3.asked, 1, 'a question for one student is owed by one');
});

test('the parent report: facts, every answer, the note, no invention', () => {
  let s = lesson();
  s = P.recordAnswer(s, 'r:famA_s1', { qid: 'q1', aid: 'a1', v: 1 }, 5000).session;
  s = P.recordAnswer(s, 'r:famA_s1', { qid: 'q2', aid: 'a2', v: '99' }, 6000).session;
  s.notes = { 'r:famA_s1': 'Asked a great question about magnets.' };
  // The key's marks are PROVISIONAL: nothing reaches a parent until the
  // teacher confirms it.
  const before = P.participation(s, 'r:famA_s1', 1000 + 50 * 60000);
  assert.equal(before.marked, 0, 'a provisional mark is not counted');
  assert.equal(before.right, 0);
  assert.doesNotMatch(P.reportText(s, 'r:famA_s1', 1000 + 50 * 60000), /✓|✗|Correct:/);
  s.questions.forEach(q => P.confirmPlan(s, q).forEach(row => { s.answers[q.id][row.identity].ok = row.ok; }));
  const r = P.participation(s, 'r:famA_s1', 1000 + 50 * 60000);
  assert.equal(r.asked, 3);
  assert.equal(r.answered, 2);
  assert.equal(r.right, 1);
  assert.equal(r.marked, 2);
  const text = P.reportText(s, 'r:famA_s1', 1000 + 50 * 60000, 'Polymath Learning Centre');
  assert.match(text, /Ethan Lim/);
  assert.match(text, /Wed 5:00pm · P5 Science/, 'the slot is named in words, not by its id');
  assert.match(text, /Time in class: 50 minutes/);
  assert.match(text, /Questions answered: 2 of 3/);
  assert.match(text, /Correct: 1 of 2 marked/);
  assert.match(text, /“B\. Iron” ✓/);
  assert.match(text, /“99” ✗/);
  assert.match(text, /no answer/);
  assert.match(text, /Teacher's note: Asked a great question about magnets\./);
  assert.match(P.participationLine(r), /answered 2 of the 3 questions asked in class, getting 1 of 2 marked answers right/);
  // Bella joined for the class questions but not the one meant only for Ethan.
  const b = P.participation(s, 'g:anon1', 1000 + 50 * 60000);
  assert.equal(b.asked, 2);
  assert.equal(P.participation(s, 'r:nobody_x', 1), null);
});

test('reportHtml escapes every field', () => {
  const h = P.reportHtml('<script>alert(1)</script>\n& "x"');
  assert.equal(h.includes('<script>'), false);
  assert.match(h, /&lt;script&gt;/);
  assert.match(h, /&amp; &quot;x&quot;/);
});

/* ---------- layout and media choices ---------- */
test('gridFor picks the shape with the largest tiles', () => {
  assert.equal(P.gridFor(1, 800, 450).cols, 1);
  assert.equal(P.gridFor(4, 800, 450).cols, 2);
  assert.equal(P.gridFor(9, 1600, 900).cols, 3);
  assert.equal(P.gridFor(6, 1600, 200).cols, 6, 'a wide short box puts them in a row');
  assert.equal(P.gridFor(0, 10, 10).cols, 1);
});

test('clampBox keeps the window on screen', () => {
  assert.deepEqual(plain(P.clampBox({ x: -500, y: 9000, w: 5000, h: 100 }, 1024, 768, 320, 300)), { x: 8, y: 460, w: 1008, h: 300 });
});

test('students on weak wifi send less and receive less', () => {
  const low = P.publishPlan('student', true), std = P.publishPlan('student', false), tch = P.publishPlan('teacher', false);
  assert.ok(low.camera.bps < std.camera.bps && low.camera.w < std.camera.w, 'low data is smaller');
  assert.ok(std.camera.w <= 320 && std.camera.bps <= 120000, 'a student camera stays small');
  assert.ok(tch.camera.w <= 320 && tch.camera.bps <= 160000, 'the teacher camera is a small tile too');
  assert.equal(std.screen, null, 'a student never shares a screen');
  assert.ok(tch.screen.bps >= 1000000, 'the worksheet feed is sharp');
  assert.ok(tch.screen.fps <= 5, 'but slow: a page hardly moves');
  assert.ok(P.minuteMB(tch) < 15, 'a minute of the class stays modest');
  const sc = P.shareConstraints();
  assert.equal(sc.audio, false);
  assert.equal(sc.video.frameRate.max, tch.screen.fps);
  const prefs = { lowData: true, classmates: true };
  assert.equal(P.wantTrack('student', prefs, 't:x', 'camera'), false, 'low data drops the teacher camera');
  assert.equal(P.wantTrack('student', prefs, 't:x', 'screen'), true, 'but never the screen');
  assert.equal(P.wantTrack('student', prefs, 't:x', 'microphone'), true);
  assert.equal(P.wantTrack('student', prefs, 'r:a_b', 'camera'), false, 'no classmates on low data');
  assert.equal(P.wantTrack('student', { classmates: true }, 'r:a_b', 'camera'), true);
  assert.equal(P.wantTrack('student', {}, 'r:a_b', 'camera'), false, 'classmates are opt-in');
  assert.equal(P.wantTrack('teacher', {}, 'r:a_b', 'camera'), true);
  assert.equal(P.qualityWord('poor'), 'Weak');
});

test('filterNames: every word matches the start of a word', () => {
  const list = [{ name: 'Ethan Lim', label: 'Ethan Lim (P5)' }, { name: 'Ethan Tan', label: 'Ethan Tan (P5)' }, { name: 'Bella Koh' }];
  assert.deepEqual(plain(P.filterNames(list, 'eth li').map(s => s.name)), ['Ethan Lim']);
  assert.deepEqual(plain(P.filterNames(list, 'ethan').map(s => s.name)), ['Ethan Lim', 'Ethan Tan']);
  assert.deepEqual(plain(P.filterNames(list, 'han')), [], 'not inside a word');
  assert.equal(P.filterNames(list, '').length, 3);
});

test('identities: teacher, roster child, trial guest — nothing else', () => {
  assert.equal(P.roleOfIdentity('t:abc'), 'teacher');
  assert.equal(P.roleOfIdentity('r:fam_s1'), 'student');
  assert.equal(P.roleOfIdentity('g:xyz'), 'student');
  assert.equal(P.validIdentity('x:abc'), false);
  assert.equal(P.validIdentity('r:../../x'), false);
  assert.match(P.randomId('q'), /^q[A-Za-z0-9_-]+$/);
  assert.notEqual(P.randomId('q'), P.randomId('q'));
  assert.deepEqual(plain(P.cleanPrefs({ lowData: true, lastKind: 'evil' })), { classmates: false, lowData: true, mirror: true, autoLow: true, cameraOff: false, record: true, hideSelf: false, lastKind: 'mcq', aiMark: true, aiReview: false, answerOnly: false, keyAuto: true, zoomGain: 1, zoomDuck: true });
  assert.equal(P.cleanPrefs({ record: false }).record, false, 'recording can be switched off');
});

/* ---------- the module's safety rules (read off the source) ---------- */
test('everything is written with textContent: no innerHTML, no insertAdjacentHTML, no eval', () => {
  assert.equal(/\binnerHTML\b/.test(src), false);
  assert.equal(/insertAdjacentHTML|outerHTML|document\.write|\beval\(|new Function/.test(src), false);
});

test('a student device obeys only the teacher identity', () => {
  assert.match(src, /if \(fromRole !== 'teacher'\) return;/);
  assert.match(src, /if \(fromRole !== 'student'\) return;/);
});

test('every key pressed in the window stays in the window', () => {
  assert.match(src, /\['keydown', 'keyup', 'keypress'\]\.forEach[\s\S]{0,200}e\.stopPropagation\(\)/);
});

test('every class is .vc*, never live cams\' .lc*', () => {
  const classes = new Set([...src.matchAll(/\b(vc[A-Z][A-Za-z]*)/g)].map(m => m[1]));
  assert.ok(classes.size > 80);
  assert.equal(/'lc[A-Z]/.test(src), false);
  assert.equal(/\.lc[A-Z]/.test(css), false);
  for (const c of ['vcWin', 'vcStage', 'vcQ', 'vcOpt', 'vcSide', 'vcTile', 'vcName', 'vcConfirm', 'vcAns', 'vcRep', 'vcBar', 'vcCtl', 'vcLiveNow', 'vcAudioGate']) {
    assert.ok(classes.has(c), c + ' is used');
    assert.match(css, new RegExp('\\.' + c + '\\b'), c + ' is styled');
  }
});

test('the stylesheet: phone-sized inputs, reduced motion, hidden in print', () => {
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*font-size: 16px/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /@media print \{ \.vcWin \{ display: none !important; \} \}/);
});

test('the student\'s Confirm names who they are choosing', () => {
  assert.match(src, /'I am ' \+ \(S\.pick\.label \|\| S\.pick\.name\) \+ ' — Confirm'/);
});

test('sending a report is always behind a confirm naming the addresses', () => {
  assert.match(src, /root\.confirm\('Send ' \+ p\.name \+ '’s report to ' \+ addrs\.join/);
  assert.match(src, /if \(!root\.confirm\(msg\)\) return;/);
});

/* ---------- the glue ---------- */
const glue = html.slice(html.indexOf('/* ================= 🎥 Live class — glue'), html.indexOf('/* ================= End live class glue'));

test('the glue is present, marked and loaded after its module', () => {
  assert.ok(glue.length > 2000);
  assert.ok(html.indexOf('<script src="live-class.js?v=1.207.0"></script>') < html.indexOf('<script>liveClassInit();</script>'));
  assert.match(html, /id="liveClassBtn"/);
  assert.match(html, /<link rel="stylesheet" href="live-class\.css\?v=1\.216\.0">/);
  assert.match(html, /if \(typeof liveClassRoleChanged === 'function'\) liveClassRoleChanged\(\);/);
});

test('the glue never holds a LiveKit secret', () => {
  assert.equal(/apiSecret|API_SECRET|livekit\.cloud/i.test(glue), false);
  assert.equal(/apiSecret\s*[:=]\s*['"][^'"]+['"]/.test(src), false);
});

test('every teacher-only writer asks wheelTeacher()', () => {
  for (const fn of ['liveClassTeacherUid', 'liveClassAward', 'liveClassParentEmails', 'liveClassSendEmail', 'liveClassSnapWorksheet']) {
    const body = glue.slice(glue.indexOf('function ' + fn), glue.indexOf('\n}', glue.indexOf('function ' + fn)));
    assert.match(body, /wheelTeacher\(\)/, fn);
  }
  assert.match(glue, /function liveClassDoc\(epoch\) \{\s*var uid = liveClassTeacherUid\(\);/);
});

test('a handed-over device never joins as the teacher', () => {
  assert.match(glue, /if \(actingStudent\) return 'none';/);
});

test('Gmail is asked for inside the tap, before anything waits', () => {
  const body = glue.slice(glue.indexOf('function liveClassSendEmail'), glue.indexOf('/* ---- 📸'));
  assert.ok(body.indexOf('csumAuthorizeGmail()') < body.indexOf('await'), 'authorize comes first');
});

test('?live skips the profile prompt and the button shows for a ?live visitor', () => {
  assert.match(html, /!SHARE_OPEN_ID && !LIVE_OPEN\) openProfileModal\(true\)/);
  assert.match(glue, /b\.style\.display = r === 'none' && !LIVE_OPEN \? 'none' : '';/);
});

test('the guessed slot follows the /office timetable', () => {
  const fn = new Function('Date', glue.slice(glue.indexOf('function liveClassGuessSlot'), glue.indexOf('/* ---- points')) + '; return liveClassGuessSlot;');
  const at = (iso) => {
    class D extends Date {
      constructor(...a) { if (a.length) super(...a); else super(iso); }
      toLocaleString() { return new Date(iso).toString(); }
    }
    return fn(D)();
  };
  assert.equal(at('2026-11-18T17:10:00'), 'WED-2');
  assert.equal(at('2026-11-18T14:40:00'), 'WED-1', 'half an hour early counts');
  assert.equal(at('2026-11-21T11:05:00'), 'SAT-2');
  assert.equal(at('2026-11-22T11:05:00'), '', 'no Sunday class');
  assert.equal(at('2026-11-18T10:00:00'), '');
});

test('the syntax checker covers the new files', () => {
  const chk = fs.readFileSync(new URL('tools/check-syntax.mjs', root), 'utf8');
  assert.match(chk, /'live-class\.js'/);
  assert.match(chk, /'functions\/live-class\.js'/);
});

test('LiveKit is vendored with its licence', () => {
  assert.ok(fs.statSync(new URL('vendor/livekit-client.umd.js', root)).size > 400000);
  assert.match(fs.readFileSync(new URL('vendor/livekit-client.LICENSE', root), 'utf8'), /Apache License/);
});

/* ---------- 📼 the class recording (v1.208.0) ---------- */
const recSrc = fs.readFileSync(new URL('live-class-record.js', root), 'utf8');
function loadRec() {
  const sandbox = { console, Date, Math, JSON };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(recSrc, sandbox, { filename: 'live-class-record.js' });
  return sandbox.LiveClassRecord;
}
const R = loadRec().pure;

test('the recording module loads with no DOM, at this version', () => {
  assert.equal(R.VERSION, '1.208.0');
  assert.match(html, /live-class-record\.js\?v=1\.208\.0/);
  assert.ok(html.indexOf('live-class-record.js') < html.indexOf('live-class.js?v='), 'the recorder loads before the window');
});

test('HEAD equals the lesson upload head, so the join plan agrees', () => {
  const m = html.match(/var LESSON_UP_HEAD = ([^;]+);/);
  assert.ok(m, 'LESSON_UP_HEAD is in index.html');
  assert.equal(R.HEAD, eval(m[1]));
  assert.ok(R.MAX_PARTS < 900, 'inside the compose service\'s part count');
});

test('job ids and piece names are what the compose service accepts', () => {
  const id = R.jobId(1768000000000, 1768000123456);
  assert.ok(R.validJobId(id));
  assert.match(id, /^[A-Za-z0-9_-]{1,64}$/);
  assert.equal(R.validJobId('../x'), false);
  assert.equal(R.partName(id, 7), 'pdf-annotator/lesson-liveclass-' + id + '.part-0007');
});

test('cleanJob: the one door, and pieces must run on without a gap', () => {
  assert.equal(R.cleanJob({ id: 'nope' }), null);
  const H = R.HEAD;
  const j = R.cleanJob({ id: 'e1p1', state: 'weird', pieces: [{ from: H, to: H + 10, done: true }, { from: H + 10, to: H + 20 }, { from: H + 99, to: H + 120 }] });
  assert.equal(j.state, 'finishing', 'an unknown state is finished, never left recording');
  assert.equal(j.pieces.length, 2, 'a piece after a gap is dropped');
  assert.equal(R.lastTo(j), H + 20);
});

test('nextPiece waits ~30 s mid-lesson, sends the rest at the end', () => {
  const H = R.HEAD;
  const job = R.cleanJob({ id: 'e1p1', type: 'video/webm', state: 'recording', startedAt: 0, pieces: [] });
  assert.equal(R.nextPiece(job, H - 5, 60000, false), null, 'nothing past the head yet');
  assert.equal(R.nextPiece(job, H + 500000, 1000, false), null, 'too soon');
  const p = R.nextPiece(job, H + 500000, R.PIECE_MS + 1, false);
  assert.deepEqual(plain(p), { i: 1, from: H, to: H + 500000, done: false });
  assert.equal(R.nextPiece(job, H + R.PIECE_MAX + 5, 10, false).to, H + R.PIECE_MAX, 'a big burst goes at 8 MB');
  assert.equal(R.nextPiece(job, H + 100, 10, true).to, H + 100, 'the end sends even a crumb');
  const mp4 = R.cleanJob({ id: 'e1p1', type: 'video/mp4', pieces: [] });
  assert.equal(R.nextPiece(mp4, H * 4, 1e9, true), null, 'an MP4 is uploaded whole');
});

test('nextPiece never needs more parts than compose joins', () => {
  const H = R.HEAD;
  let job = R.cleanJob({ id: 'e1p1', type: 'video/webm', state: 'recording', startedAt: 0, pieces: [] });
  let bytes = H, t = 0;
  for (let k = 0; k < 2000; k++) {
    bytes += 300000; t += R.PIECE_MS + 1;
    const p = R.nextPiece(job, bytes, t, false);
    if (p) { job.pieces.push(p); job.lastPieceAt = t; }
  }
  const last = R.nextPiece(job, bytes + 999, t, true);
  if (last) job.pieces.push(last);
  assert.ok(job.pieces.length + 1 <= 900, 'pieces + head fit');
  assert.equal(R.lastTo(job), bytes + 999, 'every byte is covered at the end');
});

test('chunksFor cuts stored chunks to a piece exactly', () => {
  const index = [{ seq: 0, start: 0, size: 100 }, { seq: 1, start: 100, size: 50 }, { seq: 2, start: 150, size: 100 }];
  assert.deepEqual(plain(R.chunksFor(index, 120, 200)), [{ seq: 1, cutFrom: 20, cutTo: 50 }, { seq: 2, cutFrom: 0, cutTo: 50 }]);
  assert.deepEqual(plain(R.chunksFor(index, 0, 100)), [{ seq: 0, cutFrom: 0, cutTo: 100 }]);
});

test('the frame: worksheet big, teacher small in the corner', () => {
  const W = R.FRAME.w, H = R.FRAME.h;
  const both = R.frameLayout(W, H, { w: 1920, h: 1080 }, { w: 320, h: 180 });
  assert.ok(both.screen.w <= W && both.screen.h <= H);
  assert.ok(both.cam.w <= R.CAM_BOX.w && both.cam.x + both.cam.w <= W && both.cam.y + both.cam.h <= H);
  assert.ok(both.cam.x > W / 2 && both.cam.y > H / 2, 'bottom right');
  assert.ok(R.frameLayout(W, H, null, { w: 320, h: 180 }).cam.w > W / 2, 'no share: the teacher fills the frame');
  assert.equal(R.frameLayout(W, H, null, null).card, true);
});

test('badge text counts the recordings still going up', () => {
  const H = R.HEAD;
  const a = R.cleanJob({ id: 'e1p1', state: 'finishing', bytes: H * 2, pieces: [{ from: H, to: H * 2, done: true }] });
  const b = R.cleanJob({ id: 'e2p1', state: 'done', bytes: 10 });
  assert.match(R.badgeText([a, b], 0), /Uploading 1 class recording · 50%/);
  assert.equal(R.badgeText([b], 0), '');
  const old = R.cleanJob({ id: 'e3p1', state: 'recording', beat: 1, bytes: 5 });
  assert.match(R.badgeText([old], R.STALE_MS + 10), /Uploading 1/, 'a recording whose tab has gone is finished here');
  assert.equal(R.percent(5, 5), 100);
  assert.equal(R.percent(99, 100), 99);
  assert.equal(R.fmtClock(3723000), '1:02:03');
});

test('the glue: compose through the lesson endpoint, saves merge, teacher only', () => {
  const g = html.slice(html.indexOf('🎥 Live class — glue'), html.indexOf('End live class glue'));
  assert.match(g, /function liveClassRecCompose/);
  assert.match(g, /LESSON_UP_ENDPOINT/);
  assert.match(g, /LessonAudioFinalize\.plan/);
  assert.match(g, /function liveClassRecSaved/);
  assert.match(g, /liveClassVideo/);
  assert.match(g, /shareTarget:/);
  assert.match(g, /recorder: liveClassRecInit\(\)/);
  assert.doesNotMatch(recSrc, /\.innerHTML\s*=/, 'the recorder writes with textContent');
});

test('the share is narrowed to the worksheet before it is published', () => {
  const i = src.indexOf('function startShare');
  const body = src.slice(i, src.indexOf('function stopShareTrack'));
  assert.ok(body.indexOf('limitShare') !== -1 && body.indexOf('limitShare') < body.indexOf('publishTrack'), 'narrow first, then publish');
  assert.match(src, /restrictTo/);
  assert.match(src, /cropTo/);
  assert.match(src, /'text'/, 'contentHint text');
});

test('the door: the teacher can let students in early', () => {
  assert.match(src, /vcDoor/);
  assert.match(src, /call\('letin'/);
  assert.match(src, /paintGate/);
  assert.match(src, /call\('settings'/);
});

test('wholeEnd finds where a cut-off recording\'s last whole block ends', () => {
  const cluster = [0x1F, 0x43, 0xB6, 0x75, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];
  const timecode = [0xE7, 0x81, 0x00];
  const block = n => [0xA3, 0x80 | (n + 0)].concat(new Array(n).fill(7));
  const whole = [9, 9, 9].concat(cluster, timecode, block(5), block(6));
  const cut = whole.concat([0xA3, 0x8A, 1, 2, 3]);              // a block of 10 with only 3 written
  assert.equal(R.wholeEnd(new Uint8Array(cut), 100, 100 + cut.length), 100 + whole.length);
  assert.equal(R.wholeEnd(new Uint8Array(whole), 0, whole.length), whole.length, 'a whole file ends where it ends');
  assert.equal(R.wholeEnd(new Uint8Array([1, 2, 3]), 0, 3), 0, 'no cluster: no answer');
});

test('a rejoin never hands a student the key\'s own guess before the teacher gives a mark', () => {
  const hello = src.slice(src.indexOf('function onHello('), src.indexOf('function onNeedImage('));
  assert.ok(hello.length > 100);
  const open = hello.slice(0, hello.indexOf('var revealed'));
  assert.doesNotMatch(open, /markOf\(/, 'an open question\'s mark on a rejoin is only the teacher\'s');
  assert.match(open, /ok: confirmedOf\(e\)/);
});

/* ---------- ✓ ◐ ✗ provisional marks, Chung GPT's pre-marks, ✨ AI send (v1.209.0) ---------- */
test('verdicts: only correct / partial / wrong, in any reasonable wording, and only for the ids asked about', () => {
  assert.equal(P.cleanVerdict({ verdict: 'Correct.', why: 'Names the gas.' }).v, 'correct');
  assert.equal(P.cleanVerdict({ verdict: 'partially correct' }).v, 'partial');
  assert.equal(P.cleanVerdict({ mark: 'incorrect' }).v, 'wrong');
  assert.equal(P.cleanVerdict({ verdict: 'maybe' }), null);
  assert.equal(P.cleanVerdict(null), null);
  assert.equal(P.cleanVerdict({ verdict: 'correct', why: 'x'.repeat(500) }).why.length, 160, 'a reason is one short line');
  const got = P.cleanVerdicts({ results: [{ id: 's1', verdict: 'correct' }, { id: 's9', verdict: 'wrong' }, { id: 's2', verdict: 'nonsense' }, { id: 's1', verdict: 'wrong' }] }, ['s1', 's2']);
  assert.deepEqual(plain(Object.keys(got)), ['s1'], 'an id nobody asked about is dropped, a bad verdict is dropped');
  assert.equal(got.s1.v, 'correct', 'the first verdict for an id stands');
  assert.deepEqual(plain(Object.keys(P.cleanVerdicts([{ id: 's2', verdict: 'partial' }], ['s2']))), ['s2'], 'a bare list works too');
  assert.deepEqual(plain(P.cleanVerdicts('junk', ['s1'])), {});
});

test('a mark is provisional until the teacher gives it: the key, then the AI, then the teacher', () => {
  let s = lesson();
  s = P.recordAnswer(s, 'r:famA_s1', { qid: 'q2', aid: 'a1', v: 'one hundred' }, 5000).session;
  const e = s.answers.q2['r:famA_s1'];
  assert.equal(e.auto, false, 'the key does not accept "one hundred"');
  assert.equal(P.markOf(e), false);
  assert.equal(P.confirmedOf(e), null);
  assert.equal(P.markSource(e), 'key');
  assert.equal(P.needsAiMark(s.questions[1], e), true, 'a blank the key refused goes to Chung GPT');
  e.ai = { v: 'correct', why: 'One hundred is 100.' };
  assert.equal(P.markOf(e), true, 'the AI\'s reading wins over the key\'s refusal');
  assert.equal(P.markSource(e), 'ai');
  assert.equal(P.needsAiMark(s.questions[1], e), false, 'never asked twice');
  e.ok = 'partial';
  assert.equal(P.markOf(e), 'partial', 'the teacher\'s override wins over everything');
  assert.equal(P.confirmedOf(e), 'partial');
  assert.equal(P.markSource(e), 'teacher');
  e.ok = 'maybe';
  assert.equal(P.confirmedOf(e), null, 'a mark that is not ✓ ◐ ✗ is no mark');
  assert.equal(P.markWord('partial'), '◐');
});

test('Chung GPT is asked only about answers the key cannot settle', () => {
  let s = lesson();
  s = P.recordAnswer(s, 'r:famA_s1', { qid: 'q1', aid: 'a1', v: 0 }, 5000).session;
  s = P.recordAnswer(s, 'r:famA_s1', { qid: 'q2', aid: 'a2', v: '100' }, 5000).session;
  s = P.recordAnswer(s, 'r:famA_s1', { qid: 'q3', aid: 'a3', v: 'It melts because heat flows in.' }, 5000).session;
  const [q1, q2, q3] = s.questions;
  assert.equal(P.needsAiMark(q1, s.answers.q1['r:famA_s1']), false, 'an MCQ is the key\'s, instantly');
  assert.equal(P.needsAiMark(q2, s.answers.q2['r:famA_s1']), false, 'a blank the key accepted is settled');
  assert.equal(P.needsAiMark(q3, s.answers.q3['r:famA_s1']), true, 'every open answer is pre-marked');
  s.answers.q3['r:famA_s1'].ok = true;
  assert.equal(P.needsAiMark(q3, s.answers.q3['r:famA_s1']), false, 'nor one the teacher has marked');
});

test('Confirm all turns every provisional mark into the teacher\'s, and nothing else', () => {
  let s = lesson();
  s = P.recordAnswer(s, 'r:famA_s1', { qid: 'q2', aid: 'a1', v: '100' }, 5000).session;
  s = P.recordAnswer(s, 'g:anon1', { qid: 'q2', aid: 'a2', v: 'boiling' }, 5000).session;
  s.answers.q2['g:anon1'].ai = { v: 'wrong', why: 'No number given.' };
  const q2 = s.questions[1];
  const plan = P.confirmPlan(s, q2);
  assert.deepEqual(plain(plan.map(r => [r.identity, r.ok]).sort()), [['g:anon1', false], ['r:famA_s1', true]]);
  s.answers.q2['r:famA_s1'].ok = false;   // the teacher overrode one
  assert.deepEqual(plain(P.confirmPlan(s, q2).map(r => r.identity)), ['g:anon1'], 'a mark the teacher gave is never confirmed over');
  const st = P.questionStats(s, q2, ['r:famA_s1', 'g:anon1']);
  assert.equal(st.toConfirm, 1);
  assert.equal(st.wrong, 2);
});

test('the tally says who is in each part, and who chose each option', () => {
  let s = lesson();
  s = P.recordAnswer(s, 'r:famA_s1', { qid: 'q1', aid: 'a1', v: 1 }, 5000).session;
  s = P.recordAnswer(s, 'g:anon1', { qid: 'q1', aid: 'a2', v: 0 }, 5000).session;
  const q1 = s.questions[0];
  const t = P.tallyOf(s, q1, ['r:famA_s1', 'g:anon1']);
  assert.deepEqual(plain(t.right), ['r:famA_s1']);
  assert.deepEqual(plain(t.wrong), ['g:anon1']);
  assert.deepEqual(plain(t.toConfirm.sort()), ['g:anon1', 'r:famA_s1'], 'the key\'s marks are provisional too');
  assert.deepEqual(plain(P.choosersOf(s, q1, 0)), ['g:anon1']);
  assert.deepEqual(plain(P.choosersOf(s, q1, 1)), ['r:famA_s1']);
  const t3 = P.tallyOf(s, s.questions[2], ['r:famA_s1', 'g:anon1']);
  assert.deepEqual(plain(t3.waiting), ['r:famA_s1'], 'only those the question was meant for are waited on');
});

test('the parent report says "partly right" for a confirmed ◐', () => {
  let s = lesson();
  s = P.recordAnswer(s, 'r:famA_s1', { qid: 'q3', aid: 'a3', v: 'Heat.' }, 5000).session;
  s.answers.q3['r:famA_s1'].ai = { v: 'partial', why: 'Names heat but not the flow.' };
  assert.doesNotMatch(P.reportText(s, 'r:famA_s1', 60000), /partly/, 'the AI\'s guess never reaches a parent');
  s.answers.q3['r:famA_s1'].ok = 'partial';
  const text = P.reportText(s, 'r:famA_s1', 60000);
  assert.match(text, /“Heat\.” ◐ \(partly right\)/);
  assert.match(text, /Correct: 0 of 1 marked \(1 partly right\)/);
  assert.match(P.participationLine(P.participation(s, 'r:famA_s1', 60000)), /and 1 partly right/);
});

test('✨ AI send: what the model read becomes the composer\'s shape, or nothing', () => {
  const mcq = P.questionFromAi({ kind: 'MCQ', text: 'Which is a conductor?', options: ['(1) wood', '(2) iron', '(3) glass', '(4) rubber'], answer: 1 });
  assert.equal(mcq.kind, 'mcq');
  assert.deepEqual(plain(mcq.options), ['wood', 'iron', 'glass', 'rubber'], 'the printed (1) (2) labels come off');
  assert.equal(mcq.answer, 1);
  assert.equal(P.questionFromAi({ kind: 'mcq', text: 'Q', options: ['a', 'b', 'c'], answer: '(3)' }).answer, 2, '"(3)" is the third option');
  assert.equal(P.questionFromAi({ kind: 'mcq', text: 'Q', options: ['a', 'b'], answer: 'B' }).answer, 1);
  assert.equal(P.questionFromAi({ kind: 'mcq', text: 'Q', options: ['red', 'blue'], answer: 'blue' }).answer, 1);
  assert.equal(P.questionFromAi({ kind: 'mcq', text: 'Q', options: ['a', 'b'], answer: 7 }).answer, -1, 'an answer off the end is no answer');
  assert.equal(P.questionFromAi({ kind: 'mcq', text: 'Q', options: ['only one'] }).kind, 'open', 'an MCQ needs two options');
  const blank = P.questionFromAi({ type: 'fill in the blank', question: 'Water boils at ___ °C.', accepted: ['100', '100 °C'] });
  assert.equal(blank.kind, 'blank');
  assert.equal(blank.accepted, '100\n100 °C');
  const open = P.questionFromAi('```json\n{"kind":"open","text":"Explain why.","model":"Heat flows in."}\n```');
  assert.equal(open.kind, 'open');
  assert.equal(open.model, 'Heat flows in.');
  assert.equal(P.questionFromAi({ kind: 'mystery', text: 'Describe.' }).kind, 'open', 'an unknown kind is open-ended');
  assert.equal(P.questionFromAi({}), null);
  assert.equal(P.questionFromAi('not json'), null);
  // Whatever it read still goes through cleanQuestion, and the answer never reaches a student.
  const q = P.cleanQuestion(Object.assign({ id: 'qai', at: 1, n: 1, ai: true }, mcq));
  assert.equal(q.ai, true);
  assert.equal(P.questionForStudent(q).answer, undefined);
});

test('the glue: AI send borrows the snip layer, and both calls are grounded and teacher only', () => {
  assert.match(html, /cropQuestion: liveClassCropQuestion/);
  assert.match(html, /readQuestion: liveClassReadQuestion/);
  assert.match(html, /aiMark: liveClassAiMark/);
  const read = html.slice(html.indexOf('async function liveClassReadQuestion'), html.indexOf('var LIVE_MARK_SYS'));
  assert.match(read, /wheelTeacher\(\)/);
  assert.match(read, /aiGrounding\('answer'/);
  assert.match(read, /liveClassKeyContext\(\)/, 'the answer key for the page wins over the model\'s own working');
  const mark = html.slice(html.indexOf('async function liveClassAiMark'), html.indexOf('/* ---- 📼 the class recording'));
  assert.match(mark, /wheelTeacher\(\)/);
  assert.match(mark, /aiGrounding\('mark'/);
  assert.match(mark, /liveClassKeyContext\(\)/);
  assert.match(html, /function snipAsk\(words\)/);
  assert.match(html, /if \(snipAskResolve\) \{ var res = snipAskResolve; snipAskResolve = null; snipAskEnd\(\); res\(''\); \}/, 'a cancelled crop answers nothing');
  // Students are numbered for the model, never named.
  assert.match(src, /answers: batch\.map\(function \(a, i\) \{ return \{ id: 's' \+ \(i \+ 1\), text: a\.text, photo: a\.photo \}; \}\)/);
  assert.match(src, /if \(!e \|\| e\.aid !== a\.aid\) return;/, 'a reply for an answer the student has since changed is dropped');
});

/* ---------- 🔗 personal links and PINs (v1.210.0) ---------- */

test('🔗 a personal link\'s code is read from ?live=<code>, and only in its shape', () => {
  const code = 'famA_sA1.0.' + 'Ab-_'.repeat(4);
  assert.equal(P.cleanPassCode(code), code);
  assert.equal(P.passFromSearch('?live=' + encodeURIComponent(code)), code);
  assert.equal(P.passFromSearch('?who=s1&live=' + code), code);
  assert.equal(P.passFromSearch('?live'), '', 'the general link has no code');
  assert.equal(P.passFromSearch('?live='), '');
  assert.equal(P.passFromSearch('?live=<script>'), '');
  assert.equal(P.passFromSearch('?live=famA_sA1.0.short'), '');
  assert.equal(P.passFromSearch('?live=%E0%A4%A'), '', 'a broken escape is nothing, not a throw');
  assert.equal(P.passFromSearch('?alive=' + code), '');
  assert.equal(P.passLink('https://polymathlc.com.sg/anskey/?live', code), 'https://polymathlc.com.sg/anskey/?live=' + encodeURIComponent(code));
  assert.equal(P.passLink('https://x.test/anskey/?live#top', code), 'https://x.test/anskey/?live=' + encodeURIComponent(code));
  assert.equal(P.passLink('https://x.test/?live', 'nope'), '');
  assert.equal(P.cleanPinInput(' 1a2-3 4 5'), '1234');
});

test('🔗 the teacher\'s list: cleaned rows, one lesson, typed words, copy-all lines', () => {
  const code = 'famA_sA1.0.' + 'x'.repeat(16);
  const rows = [
    { id: 'famA_sA1', name: 'Amy Tan', level: 'P5', slots: [{ slot: 'WED-2', label: 'Wed 5:00pm · P5 Science' }], gen: 0, pin: '4821', code },
    { id: 'famC_sC2', name: 'Zoe Ng', level: 'P6', slots: [{ slot: 'FRI-2', label: 'Fri 5:00pm · P6 Science' }], gen: 2, pin: '12345', code: 'bad' }
  ].map(P.cleanPassRow);
  assert.equal(rows[1].pin, '', 'a PIN that is not four digits is not shown');
  assert.equal(rows[1].code, '');
  assert.equal(rows[1].gen, 2);
  assert.deepEqual(plain(P.passSlots(rows)).map(s => s.slot), ['WED-2', 'FRI-2']);
  assert.deepEqual(plain(P.passesShown(rows, 'FRI-2', '')).map(r => r.name), ['Zoe Ng']);
  assert.deepEqual(plain(P.passesShown(rows, '', 'am')).map(r => r.name), ['Amy Tan']);
  const lines = P.passLines(rows.slice(0, 1), 'https://x.test/anskey/?live');
  assert.equal(lines, 'Amy Tan (P5) — https://x.test/anskey/?live=' + encodeURIComponent(code) + ' — PIN 4821' +
    ' — from Zoom https://x.test/anskey/?live=' + encodeURIComponent(code) + '&zoom' +
    ' — Study Buddy https://x.test/tutor/?pass=' + encodeURIComponent(code));
  // 📖 The Study Buddy link sits beside Ans Key, whatever the page was opened as.
  assert.equal(P.studyLink('https://polymathlc.github.io/anskey/?live', code), 'https://polymathlc.github.io/tutor/?pass=' + encodeURIComponent(code));
  assert.equal(P.studyLink('https://polymathlc.com.sg/anskey/index.html#x', code), 'https://polymathlc.com.sg/tutor/?pass=' + encodeURIComponent(code));
  assert.equal(P.studyLink('https://polymathlc.com.sg/anskey', code), 'https://polymathlc.com.sg/tutor/?pass=' + encodeURIComponent(code));
  assert.equal(P.studyLink('file:///x/anskey/index.html', code), '', 'never a file: link on a card');
  assert.equal(P.studyLink('https://x.test/anskey/', 'bad'), '');
  const q = P.qrPath([[true, true, false], [false, true, false], [true, false, true]]);
  assert.equal(q.size, 11);
  assert.equal(q.d, 'M4 4h2v1h-2zM5 5h1v1h-1zM4 6h1v1h-1zM6 6h1v1h-1z');
});

test('🔗 the window: a link or PIN is checked by the server, remembered, and forgettable', () => {
  assert.match(src, /call\('pass', \{ code: code \}\)/);
  assert.match(src, /call\('pass', \{ pin: S\.pinDraft \}\)/);
  assert.match(src, /kind: 'pass', code: pick\.code/, 'the token is asked for with the code, never a name the page chose');
  assert.match(src, /'Not me — choose my name'/);
  assert.match(src, /forgetPass\(\); S\.passOff = true;/);
  assert.match(src, /e\.code === 'pass_unknown' \|\| e\.code === 'not_on_roster'/, 'a replaced link goes back to the list, saying why');
  assert.match(src, /'🔗 Links & PINs'/);
  assert.match(src, /root\.confirm\('Make a new link and PIN for '/, 'a new link is asked about first');
  // The printed cards are built with DOM calls, never markup.
  const cards = src.slice(src.indexOf('function printCards'), src.indexOf('THE ROOM'));
  assert.doesNotMatch(cards, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.match(cards, /createElementNS|qrSvgNode\(doc/);
  assert.match(html, /passCode: function \(\) \{ return window\.LiveClass\.pure\.passFromSearch\(location\.search\); \}/);
  assert.match(html, /qrMatrix: function \(text\)/);
  assert.match(css, /\.vcPassRow/);
  assert.match(css, /\.vcPinIn/);
});

test('📞 Zoom hybrid: the answer-only phone receives nothing and sends nothing', () => {
  const prefs = P.cleanPrefs({ answerOnly: true });
  assert.equal(prefs.answerOnly, true);
  assert.equal(P.cleanPrefs({}).answerOnly, false);
  assert.equal(P.cleanPrefs({ answerOnly: 'yes' }).answerOnly, false, 'only true switches it on');
  for (const src of ['camera', 'screen', 'microphone', 'screen_audio']) {
    assert.equal(P.wantTrack('student', prefs, 't:abc', src), false, 'an answer-only phone takes no ' + src + ' (the child hears it in Zoom)');
    assert.equal(P.wantTrack('teacher', prefs, 'r:abc', src), true, 'the teacher is never answer-only');
  }
  assert.equal(P.wantTrack('student', P.cleanPrefs({}), 't:abc', 'screen_audio'), true, 'a child here hears the Zoom room');
  assert.equal(P.wantTrack('student', P.cleanPrefs({ lowData: true }), 't:abc', 'screen_audio'), true, 'low data keeps the Zoom room (it is sound)');
  assert.equal(P.cleanPrefs({ zoomGain: 5 }).zoomGain, 2);
  assert.equal(P.cleanPrefs({ zoomGain: -1 }).zoomGain, 0);
  assert.equal(P.cleanPrefs({}).zoomGain, 1);
  assert.equal(P.cleanPrefs({}).zoomDuck, true);
  assert.equal(P.cleanPrefs({ zoomDuck: false }).zoomDuck, false);
});

test('📞 Zoom hybrid: the &zoom link', () => {
  const code = 'fam1_kid2.3.abcdefghijklmnop';
  assert.equal(P.zoomFromSearch('?live=' + code + '&zoom'), true);
  assert.equal(P.zoomFromSearch('?zoom=1&live=' + code), true);
  assert.equal(P.zoomFromSearch('?live=' + code), false);
  assert.equal(P.zoomFromSearch('?zoom=0'), false);
  assert.equal(P.zoomFromSearch('?zoomy'), false, 'a key that only starts with zoom is not it');
  assert.equal(P.zoomFromSearch(''), false);
  assert.equal(P.zoomLink('https://x.test/anskey/?live', code), 'https://x.test/anskey/?live=' + encodeURIComponent(code) + '&zoom');
  assert.equal(P.zoomLink('https://x.test/anskey/?live', 'bad'), '', 'no link without a real code');
  assert.equal(P.passFromSearch('?live=' + code + '&zoom'), code, 'the code still reads with &zoom after it');
});

test('📞 Zoom hybrid: capture asks for no voice processing and leaves this page out', () => {
  const d = plain(P.zoomCaptureConstraints('display'));
  assert.equal(d.audio.echoCancellation, false);
  assert.equal(d.audio.noiseSuppression, false);
  assert.equal(d.audio.autoGainControl, false);
  assert.equal(d.audio.suppressLocalAudioPlayback, true, 'the page’s own sound is never captured');
  assert.equal(d.restrictOwnAudio, true);
  assert.equal(d.systemAudio, 'include');
  assert.equal(d.selfBrowserSurface, 'exclude', 'Ans Key itself is not offered as the Zoom window');
  assert.ok(d.video, 'Chrome needs a picture with a window share; it is never published');
  const i = plain(P.zoomCaptureConstraints('input', 'dev-1'));
  assert.equal(i.video, false);
  assert.deepEqual(i.audio.deviceId, { exact: 'dev-1' });
  assert.equal(i.audio.echoCancellation, false);
  assert.equal(plain(P.zoomCaptureConstraints('input', '')).audio.deviceId, undefined);
});

test('📞 Zoom hybrid: the duck and the meter', () => {
  assert.equal(P.duckGain(false, 1000, 0, 1), 1);
  assert.equal(P.duckGain(true, 1000, 0, 1), P.ZOOM.duck);
  assert.equal(P.duckGain(false, 1000, 1500, 1), P.ZOOM.duck, 'held down a little after a child stops');
  assert.equal(P.duckGain(false, 2000, 1500, 1), 1);
  assert.equal(P.duckGain(false, 0, 0, 1.5), 1.5);
  assert.equal(P.duckGain(true, 0, 0, 2), Math.round(2 * P.ZOOM.duck * 1000) / 1000);
  assert.equal(P.duckGain(false, 0, 0, 9), 2, 'never louder than double');
  assert.equal(P.duckGain(false, 0, 0, 'x'), 1);
  assert.equal(P.rmsLevel([]), 0);
  assert.equal(P.rmsLevel([0.5, -0.5, 0.5, -0.5]), 0.5);
  assert.equal(P.rmsLevel([3, 3]), 1);
});

test('📞 Zoom hybrid: what a sound input probably is', () => {
  assert.equal(P.loopbackHint('BlackHole 2ch (Virtual)').kind, 'loopback');
  assert.equal(P.loopbackHint('CABLE Output (VB-Audio Virtual Cable)').kind, 'loopback');
  assert.equal(P.loopbackHint('Stereo Mix (Realtek Audio)').kind, 'loopback');
  assert.equal(P.loopbackHint('MacBook Pro Microphone').kind, 'mic');
  assert.equal(P.loopbackHint('Default - Headset (AirPods)').kind, 'mic');
  assert.equal(P.loopbackHint('').kind, 'unknown');
  assert.equal(P.loopbackHint('Scarlett 2i2 USB').kind, 'other');
  for (const k of ['loopback', 'mic', 'unknown', 'other']) assert.ok(P.loopbackHint(k === 'loopback' ? 'blackhole' : k === 'mic' ? 'mic' : k === 'unknown' ? '' : 'x').note.length > 20);
  assert.equal(P.isZoomFeed('t:abc', 'screen_audio', 'zoom'), true);
  assert.equal(P.isZoomFeed('r:abc', 'screen_audio', 'zoom'), false);
  assert.equal(P.isZoomFeed('t:abc', 'microphone', 'zoom'), false);
});

test('📞 Zoom hybrid: the setup guide', () => {
  for (const k of ['mac', 'windows']) {
    const g = P.ZOOM_GUIDE[k];
    assert.ok(g.title && g.steps.length >= 4);
    const all = g.steps.join(' ');
    assert.match(all, /Share sound/, 'Zoom gets the class through Share sound');
    assert.match(all, /headphones/i, 'headphones stop the speakers looping back');
    assert.match(all, /📱 Zoom link/);
  }
  assert.match(P.ZOOM_GUIDE.mac.steps.join(' '), /BlackHole/);
  assert.match(P.ZOOM_GUIDE.windows.steps.join(' '), /VB-CABLE/);
  assert.equal(P.guideFor('Win32'), 'windows');
  assert.equal(P.guideFor('Windows'), 'windows');
  assert.equal(P.guideFor('MacIntel'), 'mac');
  assert.equal(P.guideFor(''), 'mac');
});

test('📞 Zoom hybrid: the people record carries how a child joined', () => {
  let s = P.emptySession(1, 'WED-2', 1000);
  s = P.personJoined(s, { identity: 'r:abc', name: 'Amy Tan', kind: 'roster' }, 1000);
  assert.equal(s.people['r:abc'].via, '');
  s = P.personJoined(s, { identity: 'r:abc', via: 'zoom' }, 1200);
  assert.equal(s.people['r:abc'].via, 'zoom');
  assert.equal(s.people['r:abc'].name, 'Amy Tan', 'the name is kept');
  s = P.personJoined(s, { identity: 'r:abc', name: 'Amy Tan' }, 1300);
  assert.equal(s.people['r:abc'].via, 'zoom', 'a rejoin without a word keeps it');
  s = P.personJoined(s, { identity: 'r:abc', via: '' }, 1400);
  assert.equal(s.people['r:abc'].via, '');
});

test('📞 Zoom hybrid: the window wires it as published, recorded and stopped', () => {
  assert.match(src, /source: LK\.Track\.Source\.ScreenShareAudio, name: ZOOM\.name, dtx: false/);
  assert.match(src, /md\.getDisplayMedia\(ask\)/);
  assert.match(src, /stopShareTrack\(\);\n      stopZoom\(true\);/, 'a disconnect takes Zoom out');
  assert.match(src, /h\.setAudio\('zoom'/, 'the recording carries the Zoom room');
  assert.match(src, /sendTeacher\(S\.prefs\.answerOnly \? \{ t: 'hello', zoom: true \}/);
  assert.match(src, /msg\.t === 'hello'\) return onHello\(from, msg\)/);
  assert.match(src, /S\.prefs\.cameraOff !== true && !S\.prefs\.answerOnly/, 'an answer-only phone never turns its camera on');
  assert.match(src, /'vcTag zoom', '📱 Zoom'/);
  const panel = src.slice(src.indexOf('function paintZoom'), src.indexOf('THE ROOM') > src.indexOf('function paintZoom') ? src.indexOf('THE ROOM') : src.length);
  assert.doesNotMatch(panel, /innerHTML|outerHTML|insertAdjacentHTML/);
  assert.match(css, /\.vcZoomSteps/);
  assert.match(css, /\.vcTag\.zoom/);
});

/* ---------- 📈 performance tracking (v1.216.0) ---------- */
function markedLesson() {
  let s = lesson();
  s.epoch = 1700000000000;
  s.startedAt = Date.UTC(2026, 10, 18, 7, 0);     // Wed 18 Nov 2026, 3:00 PM in Singapore
  s.people['r:famA_s1'].joinedAt = Date.UTC(2026, 10, 18, 7, 2);
  s.people['r:famA_s1'].since = s.people['r:famA_s1'].joinedAt;
  s.people['g:anon1'].since = s.startedAt;
  s.questions.forEach((q, i) => { q.at = s.startedAt + (i + 1) * 5 * 60000; });
  s = P.recordAnswer(s, 'r:famA_s1', { qid: 'q1', aid: 'a1', v: 1 }, s.questions[0].at + 20000).session;
  s = P.recordAnswer(s, 'r:famA_s1', { qid: 'q2', aid: 'a2', v: '100' }, s.questions[1].at + 40000).session;
  s.questions.forEach(q => P.confirmPlan(s, q).forEach(row => { s.answers[q.id][row.identity].ok = row.ok; }));
  return s;
}

test('📈 focus: only ever goes up, capped, and only for people in the lesson', () => {
  let s = lesson();
  s = P.personFocus(s, 'r:famA_s1', { away: 90000, n: 2 }, 5000);
  assert.equal(s.people['r:famA_s1'].away, 90000);
  assert.equal(s.people['r:famA_s1'].awayN, 2);
  const same = P.personFocus(s, 'r:famA_s1', { away: 1000, n: 1 }, 6000);
  assert.equal(same, s, 'an older, smaller report changes nothing');
  s = P.personFocus(s, 'r:famA_s1', { away: 1e12, n: 3 }, 7000);
  assert.equal(s.people['r:famA_s1'].away, 6 * 3600 * 1000, 'capped');
  assert.equal(P.personFocus(s, 'r:nobody_x', { away: 5 }, 1), s);
  // Survives the clean of a saved record.
  s = P.personLeft(s, 'r:famA_s1', 9000);
  assert.equal(s.people['r:famA_s1'].awayN, 3);
});

test('📈 performance: join time, answer speed, focus and score are measured, never guessed', () => {
  let s = markedLesson();
  const end = s.startedAt + 62 * 60000;
  s = P.personFocus(s, 'r:famA_s1', { away: 6 * 60000, n: 2 }, end);
  const f = P.performance(s, 'r:famA_s1', end);
  assert.equal(f.joinedClock, '3:02 PM');
  assert.equal(f.minutes, 60);
  assert.equal(f.asked, 3);
  assert.equal(f.answered, 2);
  assert.equal(f.answeredPct, 67);
  assert.equal(f.scorePct, 100, 'two marked, both right');
  assert.equal(f.avgSecs, 30, '(20 s + 40 s) / 2');
  assert.equal(f.focusPct, 90, '6 of 60 minutes away');
  assert.equal(f.awayTimes, 2);
  assert.equal(P.levelWord('focus', 90), 'Fully focused');
  assert.equal(P.levelWord('score', 50), 'Fair');
  assert.equal(P.secondsWords(95), '1 min 35 s');
  // A 📱 Zoom answer phone is not judged on focus.
  s = P.personJoined(s, { identity: 'r:famA_s1', via: 'zoom' }, end);
  assert.equal(P.performance(s, 'r:famA_s1', end).focusPct, null);
  // Provisional marks never become a score.
  const raw = lesson();
  const r2 = P.recordAnswer(raw, 'r:famA_s1', { qid: 'q1', aid: 'a1', v: 1 }, 9000).session;
  assert.equal(P.performance(r2, 'r:famA_s1', 60000).scorePct, null);
});

test('📈 progress book: one row per lesson per child, replaced on re-save, newest twelve kept', () => {
  let book = null;
  for (let i = 0; i < 14; i++) {
    const s = markedLesson();
    s.epoch = 1700000000000 + i;
    s.startedAt += i * 7 * 86400000;
    book = P.progressMerge(book, s, s.startedAt + 3600000);
  }
  const rows = book.students['r:famA_s1'].rows;
  assert.equal(rows.length, 12);
  assert.equal(rows[0].e, 1700000000002, 'the oldest two fell off');
  assert.equal(book.students['r:famA_s1'].name, 'Ethan Lim');
  assert.equal(book.students['t:teacher'], undefined);
  // Saving the same lesson again replaces its row.
  const again = markedLesson(); again.epoch = 1700000000013; again.startedAt += 13 * 7 * 86400000;
  assert.equal(P.progressMerge(book, again, again.startedAt + 3600000).students['r:famA_s1'].rows.length, 12);
  // History leaves out this lesson and keeps the last five, oldest first.
  const h = P.historyFor(book, 'r:famA_s1', 1700000000013, 5);
  assert.equal(h.length, 5);
  assert.ok(h.every(x => x.e !== 1700000000013));
  assert.ok(h[0].e < h[4].e);
  assert.match(P.historyLines(h)[0], /^Wed \d+ \w+ · answered 2 of 3 · 2 of 2 right \(100%\)/);
  // A broken book is cleaned, never trusted.
  const dirty = P.progressMerge({ students: { 'x:bad': { rows: [{ e: 1 }] }, 'r:a_b': { name: '<b>', rows: [{ e: 'no' }, { e: 9, q: 1e9 }] } } }, null, 0);
  assert.equal(dirty.students['x:bad'], undefined);
  assert.equal(dirty.students['r:a_b'].rows.length, 1);
  assert.equal(dirty.students['r:a_b'].rows[0].q, 500);
});

test('📈 trend: better / lower / the same as the recent lessons', () => {
  const hist = [{ e: 1, d: 1, q: 4, a: 4, r: 2, h: 0, k: 4, f: -1, m: 50, s: -1 }, { e: 2, d: 2, q: 4, a: 4, r: 2, h: 0, k: 4, f: -1, m: 50, s: -1 }];
  assert.equal(P.trendOf(hist, { scorePct: 80 }), 'up');
  assert.equal(P.trendOf(hist, { scorePct: 30 }), 'down');
  assert.equal(P.trendOf(hist, { scorePct: 52 }), 'same');
  assert.equal(P.trendOf(hist.slice(0, 1), { scorePct: 90 }), '', 'one lesson is not a trend');
});

test('📈 the report: tracking lines and recent lessons in the words, a card in the email', () => {
  let s = markedLesson();
  const end = s.startedAt + 62 * 60000;
  s = P.personFocus(s, 'r:famA_s1', { away: 6 * 60000, n: 2 }, end);
  s.people['r:famA_s1'].name = 'Ethan <Lim>';
  s.notes = { 'r:famA_s1': 'Great <work>' };
  const hist = [{ e: 1, d: Date.UTC(2026, 10, 11, 7), q: 4, a: 3, r: 1, h: 1, k: 3, f: 80, m: 55, s: 40 }];
  const text = P.reportText(s, 'r:famA_s1', end, 'Polymath Learning Centre', hist);
  assert.match(text, /Joined the class at 3:02 PM/);
  assert.match(text, /Average time to answer: 30 seconds/);
  assert.match(text, /Focus: on the class screen 90% of the time \(left it 2 times\)/);
  assert.match(text, /Recent live lessons:\n  Wed 11 Nov · answered 3 of 4 · 1 of 3 right, 1 partly \(50%\) · focus 80%/);
  // Without history (and for old callers) the report still reads well.
  assert.doesNotMatch(P.reportText(s, 'r:famA_s1', end, 'Polymath Learning Centre'), /Recent live lessons/);
  const html = P.reportCardHtml(s, 'r:famA_s1', end, 'Polymath Learning Centre', hist);
  assert.equal(html.includes('<Lim>'), false, 'names are escaped');
  assert.equal(html.includes('<work>'), false, 'notes are escaped');
  assert.match(html, /Ethan &lt;Lim&gt;/);
  assert.match(html, /90%/);
  assert.match(html, /Fully focused/);
  assert.match(html, /Recent live lessons/);
  assert.match(html, /\(today\)/);
  assert.match(html, /How we measure/);
  assert.equal(P.reportCardHtml(s, 'r:nobody_x', end), '');
});

test('📈 the glue keeps the progress book, sends from admin@ and opens the PIN tab from /live', () => {
  assert.match(html, /collection\('liveClassProgress'\)\.doc\('main'\)/);
  assert.match(html, /loadProgress: liveClassLoadProgress/);
  assert.match(html, /saveProgress: liveClassSaveProgress/);
  assert.match(html, /liveClassCall\('report', body\)/);
  assert.match(html, /startTab: function/);
  assert.match(src, /msg\.t === 'focus'\) return onFocus/);
  assert.match(src, /'✉ Test to me'/);
});

/* ---------- 🔤 fill in the keywords + 🔒 hidden answers (v1.215.0) ---------- */
test('clozeFrom: tapped words become blanks, side-by-side words are one blank, punctuation stays', () => {
  const text = 'Plants make food by photosynthesis, using light energy from the Sun.';
  const toks = P.clozeTokens(text);
  const idx = w => toks.findIndex(t => t.word && t.core === w);
  const picks = {}; [idx('photosynthesis'), idx('light'), idx('energy')].forEach(i => { picks[i] = true; });
  const cz = plain(P.clozeFrom(text, picks));
  assert.deepEqual(cz.parts, ['Plants make food by ', 0, ', using ', 1, ' from the Sun.']);
  assert.deepEqual(cz.keys, [['photosynthesis'], ['light energy']]);
  assert.equal(P.clozeFrom(text, {}), null, 'no blanks, no question');
  assert.equal(P.clozeText(cz.parts, ['photosinthesis', '']), 'Plants make food by [photosinthesis], using [___] from the Sun.');
  // A word with a comma after it ends its blank: the next tapped word is a new blank.
  const t2 = 'heat, light and sound';
  const k2 = P.clozeTokens(t2); const p2 = {};
  k2.forEach((t, i) => { if (t.word && (t.core === 'heat' || t.core === 'light')) p2[i] = true; });
  assert.deepEqual(plain(P.clozeFrom(t2, p2)).keys, [['heat'], ['light']]);
});

test('pickKeywords lights the AI keywords, phrases included, case and punctuation ignored', () => {
  const text = 'The Sun gives LIGHT energy; plants trap it in chlorophyll.';
  const toks = P.clozeTokens(text);
  const picks = P.pickKeywords(text, ['light energy', 'Chlorophyll', 'not there']);
  const words = Object.keys(picks).map(i => toks[i].core);
  assert.deepEqual(words, ['LIGHT', 'energy', 'chlorophyll']);
});

test('a keyword question: the student gets the gaps, never the words or the full answer', () => {
  const q = P.cleanQuestion({ id: 'q9', kind: 'cloze', text: 'Explain how plants make food.', parts: ['Plants use ', 0, ' to make food by ', 1, '.'],
    keys: [['light energy'], ['photosynthesis']], model: 'Plants use light energy to make food by photosynthesis.', to: 'all' });
  assert.equal(q.kind, 'cloze');
  assert.deepEqual(plain(q.keys), [['light energy'], ['photosynthesis']]);
  const sq = plain(P.questionForStudent(q));
  assert.deepEqual(sq.parts, ['Plants use ', 0, ' to make food by ', 1, '.']);
  assert.equal(sq.keys, undefined);
  assert.equal(sq.model, undefined);
  assert.equal(JSON.stringify(sq).includes('photosynthesis'), false, 'no hidden word anywhere in what is sent');
  // Rebuilt on the student's device through the same door.
  assert.equal(P.cleanQuestion(sq).kind, 'cloze');
  assert.equal(P.cleanQuestion({ id: 'q8', kind: 'cloze', parts: ['no gaps'] }), null);
});

test('keyword marking: exact words are ✓ at once, anything else goes to the AI, never ✗ by the key', () => {
  const q = P.cleanQuestion({ id: 'q9', kind: 'cloze', text: 'x', parts: ['A ', 0, ' and ', 1], keys: [['light energy'], ['photosynthesis']] });
  assert.deepEqual(plain(P.cleanAnswer('cloze', ['Light energy ', 'Photosynthesis.'])), ['Light energy', 'Photosynthesis.']);
  assert.equal(P.cleanAnswer('cloze', ['', ' ']), null);
  assert.equal(P.cleanAnswer('cloze', 'text'), null);
  assert.equal(P.autoMark(q, ['Light energy', 'photosynthesis.']), true);
  assert.equal(P.autoMark(q, ['sunlight', 'photosynthesis']), null, 'a different word is the AI\'s to judge');
  const e1 = { aid: 'a1', v: ['sunlight', 'photosynthesis'], auto: null, ok: null };
  assert.equal(P.needsAiMark(q, e1), true);
  assert.equal(P.needsAiMark(q, Object.assign({}, e1, { auto: true })), false);
  assert.equal(P.answerText(q, ['sunlight', '']), 'A [sunlight] and [___]');
  // Through the teacher's record, like any answer.
  let s = P.emptySession(1, 'MON-1', 0);
  s.questions = [Object.assign({}, q, { open: true })];
  const r = P.recordAnswer(s, 'r:fam_s1', { qid: 'q9', aid: 'a1', v: ['light energy', 'photosynthesis'] }, 5);
  assert.equal(r.fresh, true);
  assert.equal(r.entry.auto, true);
});

test('hidden answers: cleaned rows, and each form of question built from one', () => {
  const items = plain(P.cleanKeyItems({ items: [
    { page: 1, number: 'Question 3', kind: 'open', question: 'Why did the ice melt?', answer: 'Heat gained', model: 'The ice gained heat from the warmer metal tray and melted.', keywords: ['gained heat', 'metal'] },
    { page: 1, number: '1', kind: 'mcq', question: 'Which is a conductor?', option: 'B', answer: 'Copper', options: ['(1) Wood', '(2) Copper'] },
    { page: 2, number: '4', answer: '', model: '' },
    'junk'
  ] }));
  assert.equal(items.length, 2);
  assert.equal(items[0].number, '3');
  assert.deepEqual(items[1].options, ['Wood', 'Copper']);
  const open = plain(P.keyItemCompose(items[0], 'open'));
  assert.equal(open.kind, 'open'); assert.equal(open.hideModel, true);
  assert.match(open.model, /gained heat/);
  const cz = plain(P.keyItemCompose(items[0], 'cloze'));
  assert.equal(cz.kind, 'cloze');
  const toks = P.clozeTokens(cz.model);
  assert.deepEqual(Object.keys(cz.gapPick).map(i => toks[i].core), ['gained', 'heat', 'metal']);
  const mcq = plain(P.keyItemCompose(items[1], 'asis'));
  assert.equal(mcq.kind, 'mcq'); assert.equal(mcq.answer, 1);
});

test('hidden answers never travel in the room: only the teacher\'s panel reads them', () => {
  // The hidden key is read through env.hiddenKey on the teacher's side only;
  // nothing in a message to students names it.
  assert.equal(/t: 'q', q: questionForStudent\(q\)/.test(src), true);
  assert.equal(/hiddenKey[^\n]*send\(/.test(src), false);
  assert.match(html, /liveKeys/);
});
