/* 🙋 CONSULT ALERT — the pop-up that tells the teacher a student in Study
   Buddy is asking for help (v1.149.0).

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

function load({ admin = true, acting = null, now = 1_700_000_000_000 } = {}) {
  const doc = makeDoc();
  const opened = [];
  let listener = null, unsubbed = 0, where = null;
  const db = {
    collection(name) {
      return {
        where(a, b, c) { where = [name, a, b, c]; return this; },
        onSnapshot(ok) { listener = ok; return () => { unsubbed++; listener = null; }; }
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
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src.replace('typeof window !== \'undefined\' ? window : globalThis', 'window'), ctx);
  return {
    ctx, doc, opened,
    CA: ctx.ConsultAlert,
    fire(items) { listener && listener({ docs: Object.entries(items).map(([id, d]) => ({ id, data: () => d })) }); },
    get listening() { return !!listener; }, get unsubbed() { return unsubbed; }, get where() { return where; }
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
  assert.deepEqual(t.where, ['tutorConsults', 'status', '==', 'waiting']);
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

test('Later hides the card and a new snapshot does not bring it back', () => {
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
  assert.equal(t.unsubbed, 1, 'the listener comes down on a handover');
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
