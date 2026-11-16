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
  assert.equal(P.VERSION, '1.208.0');
  assert.equal(P.TOPIC, 'plc');
});

test('the version shown in the app matches the module', () => {
  assert.match(html, /var APP_VERSION = 'v1\.208\.0'/);
  assert.match(html, /live-class\.js\?v=1\.208\.0/);
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
  assert.deepEqual(plain(P.cleanPrefs({ lowData: true, lastKind: 'evil' })), { classmates: false, lowData: true, mirror: true, autoLow: true, cameraOff: false, record: true, hideSelf: false, lastKind: 'mcq' });
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
  assert.match(html, /<link rel="stylesheet" href="live-class\.css\?v=1\.208\.0">/);
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
  assert.match(open, /e\.ok === true \|\| e\.ok === false/);
});
