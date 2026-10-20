/* 🙋 CONSULT ALERT — the pop-up that tells the teacher a student in Study
   Buddy is asking for help (v1.149.0), or has left a question to be
   answered with a recording (v1.151.0).

   Every failure here is quiet. A card shown on a device handed to a student
   names another child on a child's screen; a stale consult pops up for a child
   who left half an hour ago; a link read off the document sends the teacher
   wherever a client wrote; a name painted as markup is a script on the
   teacher's page. The file is RUN in a vm against a stub document and a stub
   Firestore, and its rules are checked against the source itself. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../consult-alert.js', import.meta.url), 'utf8');
const answerSrc = fs.readFileSync(new URL('../consult-answer.js', import.meta.url), 'utf8');
const answerCss = fs.readFileSync(new URL('../consult-answer.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/* ---- a tiny DOM: enough for el(), appendChild and textContent ---- */
function makeDoc() {
  function node(tag) {
    return {
      tagName: tag.toUpperCase(), className: '', textContent: '', children: [], attrs: {},
      parentNode: null, isConnected: false, listeners: {}, type: '', title: '',
      get firstChild() { return this.children[0] || null; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      appendChild(c) { c.parentNode = this; c.isConnected = this.isConnected; this.children.push(c); return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; c.isConnected = false; return c; },
      addEventListener(t, f) { this.listeners[t] = f; },
      set innerHTML(v) { throw new Error('innerHTML must never be used'); }
    };
  }
  const body = node('body'); body.isConnected = true;
  return { title: 'Ans Key', body, createElement: node };
}
function texts(n) { return [n.textContent].concat(...n.children.map(texts)).filter(Boolean); }
function find(n, cls) {
  if ((' ' + n.className + ' ').includes(' ' + cls + ' ')) return n;
  for (const c of n.children) { const f = find(c, cls); if (f) return f; }
  return null;
}

function load({ admin = true, acting = null, now = 1_700_000_000_000, answer = null } = {}) {
  const doc = makeDoc();
  const opened = [];
  // One listener per status queried: the calls (`waiting`) and the questions.
  const listeners = {};
  let unsubbed = 0;
  const wheres = [];
  const db = {
    collection(name) {
      let status = null;
      return {
        where(a, b, c) { wheres.push([name, a, b, c]); status = c; return this; },
        onSnapshot(ok) { const k = status; listeners[k] = ok; return () => { unsubbed++; delete listeners[k]; }; }
      };
    }
  };
  const ctx = {
    document: doc, console, Date: { now: () => ctx._now }, _now: now,
    setInterval: () => 1, clearInterval() {},
    open: (u, t) => { opened.push([u, t]); return {}; },
    location: { href: '' },
    db, currentUser: { uid: 'teacher-1', email: 't@x' }, actingStudent: acting,
    isAdmin: () => admin
  };
  if (answer) ctx.ConsultAnswer = answer;
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src.replace('typeof window !== \'undefined\' ? window : globalThis', 'window'), ctx);
  return {
    ctx, doc, opened,
    CA: ctx.ConsultAlert,
    fire(items, status = 'waiting') { const l = listeners[status]; l && l({ docs: Object.entries(items).map(([id, d]) => ({ id, data: () => d })) }); },
    fireQ(items) { this.fire(items, 'question'); },
    get listening() { return !!listeners.waiting; }, get listeningQ() { return !!listeners.question; },
    get unsubbed() { return unsubbed; }, get wheres() { return wheres; }
  };
}

const NOW = 1_700_000_000_000;
const ID = 'AbCdEfGhIjKlMn12';
const waiting = (extra = {}) => ({ status: 'waiting', at: NOW - 60_000, seen: NOW - 10_000, studentName: 'Mei', level: 'P5', subject: 'science', worksheetName: 'Heat SA2', view: { page: 3 }, ...extra });

test('the pure helpers', () => {
  const { CA } = load();
  const P = CA.pure;
  assert.equal(P.consultIdOk(ID), true);
  assert.equal(P.consultIdOk('short'), false);
  assert.equal(P.consultIdOk('../evil/path/xxxxx'), false);
  assert.equal(P.consultLink(ID), 'https://polymathlc.github.io/tutor/?consult=' + ID);
  assert.equal(P.consultLink('javascript:alert(1)'), '');
  assert.equal(P.cleanText('  a\n\tb  ', 60), 'a b');
  assert.equal(P.stampMs({ toMillis: () => 5 }), 5);
  assert.equal(P.stampMs(null), 0);
  assert.equal(P.consultAgo(30_000), 'just now');
  assert.equal(P.consultAgo(5 * 60_000), '5 min ago');
  assert.equal(P.consultSummary(waiting()), 'P5 Science · Heat SA2 · page 3');
});

test('only a fresh, waiting consult from a device still there is a card', () => {
  const { CA } = load();
  const P = CA.pure;
  assert.equal(P.consultFresh(waiting(), NOW), true);
  assert.equal(P.consultFresh(waiting({ status: 'joined' }), NOW), false);
  assert.equal(P.consultFresh(waiting({ at: NOW - 31 * 60_000 }), NOW), false, 'asked half an hour ago');
  assert.equal(P.consultFresh(waiting({ seen: NOW - 3 * 60_000 }), NOW), false, 'the device stopped beating');
  assert.equal(P.consultFresh(waiting({ at: NOW + 3_600_000, seen: NOW + 3_600_000 }), NOW), true, 'a fast clock is read as now, never as fresh for ever');
});

test('the waiting list is oldest first, drops dismissed, stale and malformed ids', () => {
  const { CA } = load();
  const list = CA.pure.waitingList({
    [ID]: waiting({ at: NOW - 120_000 }),
    'ZyXwVuTsRqPoNm98': waiting({ at: NOW - 300_000 }),
    'QqQqQqQqQqQqQq11': waiting(),
    'bad id!': waiting(),
    'StaleStaleStale1': waiting({ at: NOW - 40 * 60_000 })
  }, { QqQqQqQqQqQqQq11: true }, NOW);
  assert.deepEqual([...list.map((x) => x.id)], ['ZyXwVuTsRqPoNm98', ID]);
});

test('the words on a card, and the tab title', () => {
  const { CA } = load();
  assert.equal(CA.pure.cardWords({ data: waiting() }).title, 'Mei is asking for help');
  assert.equal(CA.pure.cardWords({ data: waiting({ studentName: '', teacherLeft: true }) }).title, 'A student is waiting for you to come back');
  assert.equal(CA.pure.titleWith('Ans Key', 2), '🙋 (2) Ans Key');
  assert.equal(CA.pure.titleWith('🙋 (2) Ans Key', 1), '🙋 (1) Ans Key');
  assert.equal(CA.pure.titleWith('🙋 (2) Ans Key', 0), 'Ans Key');
});

test('the teacher signed in gets a card with Join, which opens the room', () => {
  const t = load();
  t.CA.roleChanged();
  assert.ok(t.listening);
  assert.deepEqual(t.wheres, [['tutorConsults', 'status', '==', 'waiting'], ['tutorConsults', 'status', '==', 'question']]);
  assert.ok(t.listeningQ, 'and the questions left, on a second listener');
  t.fire({ [ID]: waiting() });
  const root = find(t.doc.body, 'consultAlerts');
  assert.ok(root, 'a card is drawn');
  assert.ok(texts(root).includes('Mei is asking for help'));
  assert.equal(t.doc.title, '🙋 (1) Ans Key');
  find(root, 'consultAlertJoin').listeners.click();
  assert.deepEqual(t.opened, [['https://polymathlc.github.io/tutor/?consult=' + ID, '_blank']]);
  assert.equal(find(t.doc.body, 'consultAlerts'), null, 'joined, so the card goes');
  assert.equal(t.doc.title, 'Ans Key');
});

test('Hide hides the card and a new snapshot does not bring it back', () => {
  const t = load();
  t.CA.roleChanged();
  t.fire({ [ID]: waiting() });
  find(t.doc.body, 'consultAlertLater').listeners.click();
  assert.equal(find(t.doc.body, 'consultAlerts'), null);
  t.fire({ [ID]: waiting() });
  assert.equal(find(t.doc.body, 'consultAlerts'), null);
});

test('a student, and the teacher handing the device over, are never shown it', () => {
  const student = load({ admin: false });
  student.CA.roleChanged();
  assert.equal(student.listening, false, 'a student never even listens');
  const t = load();
  t.CA.roleChanged();
  t.fire({ [ID]: waiting() });
  assert.ok(find(t.doc.body, 'consultAlerts'));
  t.ctx.actingStudent = { name: 'Mei' };
  t.CA.roleChanged();
  assert.equal(t.unsubbed, 2, 'both listeners come down on a handover');
  assert.equal(find(t.doc.body, 'consultAlerts'), null, 'and the card with it');
});

test('a student name is painted as text, never markup', () => {
  const t = load();
  t.CA.roleChanged();
  t.fire({ [ID]: waiting({ studentName: '<img src=x onerror=alert(1)>' }) });
  assert.ok(texts(t.doc.body).some((s) => s.startsWith('<img src=x')), 'shown literally');
});

test('the file only reads: nothing in it writes tutorConsults', () => {
  assert.doesNotMatch(src, /\.(set|update|add|delete)\(/, 'no Firestore write');
  assert.doesNotMatch(src, /\.innerHTML\b|insertAdjacentHTML/, 'no markup');
  assert.doesNotMatch(src, /@[a-z0-9-]+\.[a-z]/i, 'no email address');
});

test('Ans Key loads it and asks it on every role change', () => {
  assert.match(html, /<link rel="stylesheet" href="consult-alert\.css">/);
  const at = html.indexOf('<script src="consult-alert.js"></script>');
  assert.ok(at > 0, 'script tag present');
  assert.ok(at < html.indexOf('<script>\n', at), 'loaded before the application script');
  const role = html.slice(html.indexOf('function applyRoleUI() {'), html.indexOf('var student = isStudent();', html.indexOf('function applyRoleUI() {')));
  assert.match(role, /ConsultAlert\.roleChanged\(\)/);
  assert.match(fs.readFileSync(new URL('./check-syntax.mjs', import.meta.url), 'utf8'), /'consult-alert\.js'/);
  assert.match(fs.readFileSync(new URL('./check-syntax.mjs', import.meta.url), 'utf8'), /'consult-answer\.js'/);
  // The recorder loads before the alert, so the alert's cards find it.
  assert.match(html, /<link rel="stylesheet" href="consult-answer\.css">/);
  const rec = html.indexOf('<script src="consult-answer.js"></script>');
  assert.ok(rec > 0 && rec < at, 'consult-answer.js loads before consult-alert.js');
  assert.match(html, /var APP_VERSION = 'v1\.(15[1-9]|1[6-9]\d|[2-9]\d\d)\.\d+';/);
});

/* ---------------- v1.151.0: questions left instead of a call ---------------- */

const question = (extra = {}) => ({ status: 'question', at: NOW - 600_000, seen: NOW - 600_000, studentName: 'Mei', level: 'P5', subject: 'science',
  worksheetName: 'Heat SA2', question: { text: 'Why is <b>Q3</b> 40°C?', page: 2, ws: 'w1', box: [0.1, 0.1, 0.5, 0.4], at: NOW - 120_000 }, ...extra });
function stubAnswer() {
  const calls = [];
  return {
    calls,
    pure: { questionFresh: (d) => !!d && d.status === 'question', questionWords: (d) => ({ title: d.studentName + ' left a question', where: 'P5 Science · ' + d.worksheetName + ' · page ' + d.question.page, text: d.question.text }),
      questionAgo: () => '2 min ago' },
    open: (id) => { calls.push(['open', id]); return Promise.resolve(true); },
    askLater: (id) => { calls.push(['askLater', id]); return Promise.resolve(true); },
    stop: () => { calls.push(['stop']); }
  };
}
const buttons = (n) => {
  const out = [];
  (function walk(x) { if (x.tagName === 'BUTTON') out.push(x); x.children.forEach(walk); })(n);
  return out;
};

test('a call card is Hide · ✋ Not now · Join, and Not now asks the student for a question', async () => {
  const ans = stubAnswer();
  const t = load({ answer: ans });
  t.CA.roleChanged();
  t.fire({ [ID]: waiting() });
  const root = find(t.doc.body, 'consultAlerts');
  assert.deepEqual(buttons(root).map((b) => b.textContent), ['Hide', '✋ Not now', 'Join']);
  await find(root, 'consultAlertNotNow').listeners.click();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(ans.calls, [['askLater', ID]], 'the write is the recorder\'s, never this file\'s');
  assert.equal(find(t.doc.body, 'consultAlerts'), null, 'the card goes once they have been asked');
});

test('without the recorder, a call card is the old Hide · Join', () => {
  const t = load();
  t.CA.roleChanged();
  t.fire({ [ID]: waiting() });
  assert.deepEqual(buttons(find(t.doc.body, 'consultAlerts')).map((b) => b.textContent), ['Hide', 'Join']);
});

test('a question left is a 📝 card with its words, and Answer opens the recorder here', () => {
  const ans = stubAnswer();
  const t = load({ answer: ans });
  t.CA.roleChanged();
  t.fireQ({ [ID]: question() });
  const root = find(t.doc.body, 'consultAlerts');
  assert.ok(root);
  const all = texts(root);
  assert.ok(all.includes('Mei left a question'));
  assert.ok(all.includes('“Why is <b>Q3</b> 40°C?”'), 'the question, as text');
  assert.ok(find(root, 'consultAlertQ'));
  assert.deepEqual(buttons(root).map((b) => b.textContent), ['Hide', '📝 Answer']);
  find(root, 'consultAlertAnswer').listeners.click();
  assert.deepEqual(ans.calls, [['open', ID]]);
  assert.deepEqual(t.opened, [], 'answered in Ans Key, not a new tab');
});

test('the same consult as a call and then a question is two cards in turn, keyed id:kind', () => {
  const ans = stubAnswer();
  const t = load({ answer: ans });
  t.CA.roleChanged();
  t.fire({ [ID]: waiting() });
  find(t.doc.body, 'consultAlertLater').listeners.click();
  assert.equal(find(t.doc.body, 'consultAlerts'), null, 'the call hidden');
  t.fire({});
  t.fireQ({ [ID]: question() });
  assert.ok(find(t.doc.body, 'consultAlertQ'), 'hiding the call never hides the question it became');
  assert.equal(t.doc.title, '🙋 (1) Ans Key');
});

test('calls first, then questions, at most four cards and the rest counted', () => {
  const ans = stubAnswer();
  const t = load({ answer: ans });
  t.CA.roleChanged();
  const ids = ['QuestionAaaaaa01', 'QuestionAaaaaa02', 'QuestionAaaaaa03', 'QuestionAaaaaa04'];
  t.fireQ(Object.fromEntries(ids.map((id, i) => [id, question({ question: { text: 'q' + i, page: 1, at: NOW - (i + 1) * 60_000 } })])));
  t.fire({ [ID]: waiting() });
  const root = find(t.doc.body, 'consultAlerts');
  const cards = root.children.filter((c) => /consultAlert\b/.test(c.className) && !/More/.test(c.className));
  assert.equal(cards.length, t.CA.pure.ALERT_SHOW_MAX);
  assert.ok(!/consultAlertQ/.test(cards[0].className), 'the call is first');
  assert.ok(texts(find(root, 'consultAlertMore')).some((x) => /\+ 1 more/.test(x)));
  assert.equal(t.doc.title, '🙋 (5) Ans Key');
});

test('a handover to a student closes the recorder with the cards', () => {
  const ans = stubAnswer();
  const t = load({ answer: ans });
  t.CA.roleChanged();
  t.fireQ({ [ID]: question() });
  t.ctx.actingStudent = { name: 'Mei' };
  t.CA.roleChanged();
  assert.deepEqual(ans.calls, [['stop']]);
  assert.equal(find(t.doc.body, 'consultAlerts'), null);
});

test('the recorder is Study Buddy\'s file, and keeps its bans', () => {
  const code = answerSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /getDisplayMedia\s*\(/, 'a canvas, never the screen');
  assert.doesNotMatch(code, /\.innerHTML\s*=|insertAdjacentHTML/);
  assert.doesNotMatch(code, /annotations\s*(\.\s*(push|splice|unshift)|=[^=])/, 'never the page\'s annotations');
  assert.doesNotMatch(code, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'no email address');
  for (const fn of ['async function askLater', 'async function open', 'async function sendReply']) {
    const a = answerSrc.indexOf(fn);
    assert.ok(a > 0, fn);
    assert.match(answerSrc.slice(a, a + 200), /teacherHere\(\)/, fn + ' asks teacherHere first');
  }
  const sandbox = { console, Math, Date, Number, String, Array, Object, JSON };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(answerSrc, sandbox);
  assert.equal(sandbox.ConsultAnswer.pure.COLLECTION, 'tutorConsults');
  assert.equal(sandbox.ConsultAnswer.pure.replyUrlOk('https://evil.example/x.mp4'), false);
});

const tutorAnswer = ['../../tutor/consult-answer.js', '../../polymathlc/tutor/consult-answer.js']
  .map((p) => new URL(p, import.meta.url)).find((u) => fs.existsSync(u));
test('consult-answer.js and .css are Study Buddy\'s, byte for byte', { skip: !tutorAnswer && 'polymathlc/tutor is not checked out beside this repo' }, () => {
  assert.equal(answerSrc, fs.readFileSync(tutorAnswer, 'utf8'), 'consult-answer.js has drifted from Study Buddy');
  assert.equal(answerCss, fs.readFileSync(new URL('consult-answer.css', tutorAnswer), 'utf8'), 'consult-answer.css has drifted from Study Buddy');
});

/* Freshness, the link and the summary are Study Buddy's rules. Whenever
   polymathlc/tutor is checked out beside this repository, the two copies are
   compared byte for byte (skipped in CI, where only one is). */
const tutorPath = ['../../tutor/consult.js', '../../polymathlc/tutor/consult.js']
  .map((p) => new URL(p, import.meta.url)).find((u) => fs.existsSync(u));
test('the shared helpers are Study Buddy\'s, byte for byte', { skip: !tutorPath && 'polymathlc/tutor is not checked out beside this repo' }, () => {
  const tutor = fs.readFileSync(tutorPath, 'utf8');
  const fn = (s, name) => {
    const a = s.indexOf('  function ' + name + '(');
    assert.ok(a >= 0, name + ' missing');
    return s.slice(a, s.indexOf('\n  }\n', a) + 4);
  };
  for (const name of ['consultIdOk', 'consultLink', 'cleanText', 'stampMs', 'consultFresh', 'consultAgo', 'consultSummary', 'subjectWord']) {
    assert.equal(fn(src, name), fn(tutor, name), name + ' has drifted from Study Buddy');
  }
  for (const k of ['JOIN_BASE', 'WAIT_FRESH_MS', 'SEEN_FRESH_MS']) {
    const re = new RegExp('var ' + k + ' = ([^;]+);');
    assert.equal(src.match(re)[1], tutor.match(re)[1], k + ' has drifted from Study Buddy');
  }
});
