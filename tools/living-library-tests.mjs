/* 📚 The living app library — the pure helpers, run in a vm, and the
   glue's wiring pinned against index.html.
     node --test tools/living-library-tests.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const SRC = fs.readFileSync(new URL('living-library.js', ROOT), 'utf8');
const LA_SRC = fs.readFileSync(new URL('living-apps.js', ROOT), 'utf8');
const HTML = fs.readFileSync(new URL('index.html', ROOT), 'utf8');

function load() {
  const ctx = { console, Date, Math, JSON, encodeURIComponent, decodeURIComponent, Object, Array, String, Number, RegExp, Promise };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(LA_SRC, ctx);
  vm.runInContext(SRC, ctx);
  return { L: ctx.LivingLibrary.pure, LA: ctx.LivingApps.pure, ctx };
}
const { L, LA } = load();
const plain = (v) => JSON.parse(JSON.stringify(v));

const HASH = LA.contentHash('<!doctype html><p>Floating and sinking</p>');
const TOKEN = '5d0c2c1e-7a4b-4f7e-9b1a-0c0000000001';

test('the hash and token checks are the hosted copy’s own', () => {
  assert.ok(L.validHash(HASH), HASH);
  assert.equal(L.validHash(HASH), LA.validHash(HASH));
  assert.ok(!L.validHash('../etc'));
  assert.ok(!L.validHash('la1-x-zz'));
  assert.ok(L.validToken(TOKEN));
  assert.ok(!L.validToken('short'));
  assert.ok(!L.validToken('has/slash-and-is-long-enough'));
});

test('emails are read leniently and kept strictly', () => {
  assert.equal(L.normEmail('  Kid@Example.COM '), 'kid@example.com');
  assert.equal(L.normEmail('mailto:a@b.co'), 'a@b.co');
  assert.equal(L.normEmail('no-at-sign'), '');
  assert.equal(L.normEmail('a@b'), '');
  assert.equal(L.normEmail('a b@c.com'), '');
  const r = L.parseEmails('Mum <mum@home.sg>, kid@school.sg; kid@school.sg\nnotanemail  dad@home.sg');
  assert.deepEqual(plain(r.emails), ['mum@home.sg', 'kid@school.sg', 'dad@home.sg']);
  assert.ok(r.bad.includes('notanemail'));
  assert.deepEqual(plain(L.parseEmails('').emails), []);
  const many = Array.from({ length: 80 }, (_, i) => 'k' + i + '@x.sg').join(',');
  assert.equal(L.parseEmails(many).emails.length, L.EXTRA_MAX);
});

test('an entry write is the link’s parts, the title and the sheet — never the app', () => {
  const w = L.entryWrite({ title: '  Floating   and sinking ', html: '<p>secret</p>', wand: true }, { hash: HASH, token: TOKEN },
    { id: 'ws1', name: 'Buoyancy W3', level: 'P5', subject: 'science' }, 1000);
  assert.deepEqual(plain(w), {
    v: 1, hash: HASH, token: TOKEN, title: 'Floating and sinking', wand: true, lastAt: 1000,
    sheets: { ws1: { name: 'Buoyancy W3', level: 'P5', subject: 'science', at: 1000 } }
  });
  assert.ok(!JSON.stringify(w).includes('secret'), 'the HTML never goes in the library');
  assert.equal(L.entryWrite({ title: 'x' }, null, null), null, 'no hosted copy, no entry');
  assert.equal(L.entryWrite({ title: 'x' }, { hash: 'bad', token: TOKEN }), null);
  const unsaved = L.entryWrite({ title: '' }, { hash: HASH, token: TOKEN }, null, 5);
  assert.equal(unsaved.title, 'Living app');
  assert.equal(unsaved.sheets, undefined, 'an unsaved worksheet adds no sheet');
  assert.equal(L.entryWrite({ title: 'x' }, { hash: HASH, token: TOKEN }, { id: 'bad/id' }).sheets, undefined);
});

test('a stored entry is read back whatever its shape', () => {
  const e = L.readEntry(HASH, {
    token: TOKEN, title: 'Lab', wand: 1, lastAt: { seconds: 10 }, sentCount: '2', lastSentAt: 99,
    sheets: { a: { name: 'Old', level: 'P5', subject: 'science', at: 5000 }, b: { name: 'New', level: 'P6', subject: 'both', at: 50000 }, 'x/y': { name: 'bad' } }
  });
  assert.equal(e.hash, HASH);
  assert.deepEqual(plain(e.sheets.map(s => s.name)), ['New', 'Old'], 'newest worksheet first, bad ids dropped');
  assert.deepEqual(plain(e.levels), ['P5', 'P6']);
  assert.deepEqual(plain(e.subjects), ['both', 'science']);
  assert.equal(e.lastAt, 50000, 'last seen is the newest sheet when that is later');
  assert.equal(e.sentCount, 2);
  assert.equal(L.readEntry('nope', { token: TOKEN }), null);
  assert.equal(L.readEntry(HASH, { token: 'x' }), null);
  assert.equal(L.readEntry(HASH, null), null);
});

test('newest first, then filtered by words, level and subject', () => {
  const mk = (title, at, sheets) => L.readEntry(LA.contentHash(title), { token: TOKEN, title, lastAt: at, sheets });
  const list = L.sortEntries([
    mk('Ballast tank', 10, { s1: { name: 'Submarines', level: 'P5', subject: 'science', at: 10 } }),
    mk('Fractions bar', 30, { s2: { name: 'Fractions 2', level: 'P4', subject: 'math', at: 30 } }),
    mk('Water cycle', 20, { s3: { name: 'Water', level: 'P5', subject: 'both', at: 20 } })
  ]);
  assert.deepEqual(plain(list.map(e => e.title)), ['Fractions bar', 'Water cycle', 'Ballast tank']);
  assert.deepEqual(plain(L.filterEntries(list, { level: 'P5' }).map(e => e.title)), ['Water cycle', 'Ballast tank']);
  assert.deepEqual(plain(L.filterEntries(list, { subject: 'math' }).map(e => e.title)), ['Fractions bar', 'Water cycle'], 'a “both” worksheet counts for maths');
  assert.deepEqual(plain(L.filterEntries(list, { q: 'submarines tank' }).map(e => e.title)), ['Ballast tank'], 'every word, title or worksheet');
  assert.deepEqual(plain(L.filterEntries(list, { q: 'tank fractions' })), []);
  assert.equal(L.filterEntries(list, {}).length, 3);
});

test('recipients: students with an address, by level and subject, never twice', () => {
  const profiles = [
    { uid: 'u1', name: 'Bea', email: 'BEA@x.sg', level: 'P5', subject: 'science' },
    { uid: 'u2', name: 'Al', email: 'al@x.sg', level: 'P5', subject: 'both' },
    { uid: 'u3', name: 'Cy', email: 'cy@x.sg', level: 'P4', subject: 'math' },
    { uid: 'u4', name: 'Managed', email: '', level: 'P5', subject: 'science', managed: true },
    { uid: 'u5', name: 'Dup', email: 'bea@x.sg', level: 'P5', subject: 'science' },
    { uid: 'u6', name: 'Broken', email: 'not-an-email', level: 'P5' }
  ];
  const all = L.studentRecipients(profiles, {});
  assert.deepEqual(plain(all.map(r => r.email)), ['cy@x.sg', 'al@x.sg', 'bea@x.sg']);
  assert.deepEqual(plain(L.studentRecipients(profiles, { level: 'P5', subject: 'science' }).map(r => r.name)), ['Al', 'Bea']);
  assert.deepEqual(plain(L.studentRecipients(profiles, { subject: 'math' }).map(r => r.name)), ['Cy', 'Al']);
  const merged = L.mergeRecipients(all.slice(0, 2), ['AL@x.sg', 'mum@home.sg', 'teacher@x.sg'], 'Teacher@x.sg');
  assert.deepEqual(plain(merged), ['cy@x.sg', 'al@x.sg', 'mum@home.sg'], 'the teacher is the To, never a Bcc');
});

test('the message names each app with its link on a line of its own', () => {
  const apps = [
    { title: 'Ballast tank', url: 'https://polymathlc.com.sg/anskey/living.html?AAAA', from: 'P5 Science — Submarines' },
    { title: 'Water cycle', url: 'https://polymathlc.com.sg/anskey/living.html?BBBB', from: '' }
  ];
  const m = L.composeMessage(apps, { note: 'Revise these before Friday.', signOff: 'Mr Chung' });
  assert.equal(m.subject, 'Revise: Ballast tank and 1 more');
  const lines = m.body.split('\n');
  assert.equal(lines[0], 'Hi,');
  assert.ok(lines.includes('Revise these before Friday.'));
  assert.ok(lines.includes('1. Ballast tank'));
  assert.ok(lines.includes('   From: P5 Science — Submarines'));
  assert.ok(lines.includes('   https://polymathlc.com.sg/anskey/living.html?AAAA'), 'the link is alone on its line');
  assert.ok(lines.includes('2. Water cycle'));
  assert.equal(lines[lines.length - 1], 'Mr Chung');
  assert.equal(L.composeMessage([apps[0]], {}).subject, 'Revise: Ballast tank');
  assert.ok(L.composeMessage([apps[0]], {}).body.includes(L.DEFAULT_NOTE), 'no note given → the default one');
  assert.equal(L.composeMessage([apps[0]], { subject: 'My own' }).subject, 'My own');
  assert.ok(!L.composeMessage([apps[0]], { note: '' }).body.includes(L.DEFAULT_NOTE), 'an emptied note stays empty');
  assert.equal(L.composeMessage([{ title: 'no link' }], {}).subject, 'Revision');
});

test('Gmail opens addressed, students in Bcc, in the teacher’s account', () => {
  const url = L.gmailUrl({ account: 't@x.sg', to: ['t@x.sg'], bcc: ['a@x.sg', 'b@x.sg'], subject: 'Revise: A & B', body: 'line 1\nline 2' });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://mail.google.com/mail/');
  assert.equal(u.searchParams.get('view'), 'cm');
  assert.equal(u.searchParams.get('authuser'), 't@x.sg');
  assert.equal(u.searchParams.get('to'), 't@x.sg');
  assert.equal(u.searchParams.get('bcc'), 'a@x.sg,b@x.sg');
  assert.equal(u.searchParams.get('su'), 'Revise: A & B');
  assert.equal(u.searchParams.get('body'), 'line 1\nline 2');
  const mt = L.mailtoUrl({ to: ['t@x.sg'], bcc: ['a@x.sg'], subject: 'S', body: 'B' });
  assert.equal(mt, 'mailto:t%40x.sg?bcc=a%40x.sg&subject=S&body=B');
});

test('a message too long for a link keeps its addresses and moves the body to the clipboard', () => {
  const short = L.sendPlan({ to: ['t@x.sg'], bcc: ['a@x.sg'], subject: 'S', body: 'short' }, 'gmail');
  assert.equal(short.copyBody, false);
  assert.ok(short.url.includes('body=short'));
  const long = L.sendPlan({ to: ['t@x.sg'], bcc: ['a@x.sg'], subject: 'S', body: 'x'.repeat(9000) }, 'gmail');
  assert.equal(long.copyBody, true);
  assert.ok(long.url && !long.url.includes('body='), 'the addresses still arrive');
  assert.ok(long.url.includes('bcc=a%40x.sg'));
  const mail = L.sendPlan({ to: ['t@x.sg'], bcc: ['a@x.sg'], subject: 'S', body: 'x'.repeat(2500) }, 'mailto');
  assert.equal(mail.copyBody, true, 'a mail app link is held to a far smaller size');
  const crowd = Array.from({ length: 400 }, (_, i) => 'student' + i + '@school.example.com');
  const tooMany = L.sendPlan({ to: [], bcc: crowd, subject: 'S', body: 'B' }, 'gmail');
  assert.equal(tooMany.tooMany, true);
});

test('a worksheet’s living apps are found once each, by their own content', () => {
  const html = '<!doctype html><p>Lab</p>';
  const anns = [
    { type: 'ainote', kind: 'paste', lapp: { html, title: 'Lab', hash: 'stale' } },
    { type: 'ainote', kind: 'paste', lapp: { html, title: 'Lab copy' } },
    { type: 'ainote', kind: 'paste', lapp: { html: '<p>Two</p>' } },
    { type: 'ainote', kind: 'paste', src: 'pic.jpg' },
    { type: 'pen', lapp: { html: '<p>not a picture</p>' } },
    { type: 'ainote', kind: 'paste', lapp: { html: '   ' } },
    null
  ];
  const found = L.scanAnnotations(anns, LA.contentHash);
  assert.deepEqual(plain(found.map(f => f.hash)), [LA.contentHash(html), LA.contentHash('<p>Two</p>')]);
  assert.deepEqual(plain(L.scanAnnotations('nope', LA.contentHash)), []);
});

test('short words for when', () => {
  const now = 1e12;
  assert.equal(L.agoText(0, now), '');
  assert.equal(L.agoText(now - 30e3, now), 'just now');
  assert.equal(L.agoText(now - 5 * 60e3, now), '5 min ago');
  assert.equal(L.agoText(now - 3 * 3600e3, now), '3 h ago');
  assert.equal(L.agoText(now - 86400e3, now), '1 day ago');
  assert.equal(L.agoText(now - 30 * 86400e3, now), '4 weeks ago');
  assert.equal(L.countText(1, 'app'), '1 app');
  assert.equal(L.countText(2, 'person', 'people'), '2 people');
});

/* ---- The glue, pinned against the page. ---- */
function section(start, end) {
  const a = HTML.indexOf(start), b = HTML.indexOf(end, a);
  assert.ok(a !== -1 && b !== -1, 'section ' + start);
  return HTML.slice(a, b);
}
const GLUE = section('📚 Living app library — glue', 'End living app library glue');

test('the library is the teacher’s: every handler asks', () => {
  for (const fn of ['llibRef', 'llibAfterSave', 'llibScan', 'llibStudents']) {
    const body = GLUE.slice(GLUE.indexOf('function ' + fn));
    assert.ok(/wheelTeacher\(\)/.test(body.slice(0, body.indexOf('\n}') )), fn + ' asks wheelTeacher()');
  }
  assert.ok(/if \(!wheelTeacher\(\)\) return;\s+\/\/ hiding the button is never the lock\s+llib\.open\(\)/.test(GLUE));
  assert.ok(/TEACHER_TOOLBAR_IDS = \[[^\]]*'livingLibBtn'/.test(HTML), 'the button is in the teacher’s toolbar list');
  assert.ok(/id="livingLibBtn"/.test(HTML));
});

test('the library is filled by both saves, and by every path that makes a code', () => {
  const auto = section('async function autoSave()', '\n}\n');
  assert.ok(auto.indexOf('llibAfterSave()') > auto.indexOf('await writeAnnotations('), 'auto-save files the apps after the save is written');
  const manual = section('async function performSave()', 'startLivePresence();');
  assert.ok(manual.indexOf('llibAfterSave()') > manual.indexOf('await writeAnnotations('), 'the Save button too');
  const qr = section('async function lappQrLink(id)', '\n}\n');
  assert.ok(/llibRemember\(a\.lapp, pub, llibSheet\(\)\)/.test(qr), 'the stage’s 📲 QR');
  const links = section('async function lappQrLinks(anns)', '\n}\n');
  assert.ok(/llibRemember\(a\.lapp, pub, llibSheet\(\)\)/.test(links), 'an export and a print');
});

test('not in practice, one run at a time, and never onto another worksheet', () => {
  const sync = section('async function llibAfterSave()', '\n}\n');
  assert.ok(/practiceMode/.test(sync.split('\n')[1]), 'practice holds a child’s attempt');
  assert.ok(/if \(llibSyncing\) \{ llibSyncAgain = true; return 0; \}/.test(sync));
  assert.ok(/currentDocId === docAtStart && lappRememberPub/.test(sync), 'a worksheet closed mid-run gets nothing written onto the next one');
});

test('the scan reads only this teacher’s worksheets and the library never holds the app', () => {
  const scan = section('async function llibScan(progress)', '\n}\n');
  assert.ok(/data\.ownerUid && data\.ownerUid !== currentUser\.uid/.test(scan));
  assert.ok(/readAnnotationJson\(d\.data\)/.test(scan), 'annotations go through the one reader');
  assert.ok(!/\.html\b/.test(GLUE.replace(/living\.html|innerHTML|index\.html/g, '')), 'no app HTML is written by the glue');
});

test('the person changing closes the window and forgets what was written', () => {
  const role = section('function lappRoleChanged()', '\n}\n');
  assert.ok(/if \(key === lappRoleKey\) return;/.test(role));
  assert.ok(role.indexOf('llib.roleChanged()') > role.indexOf('if (key === lappRoleKey) return;'));
  assert.ok(/llibSeen = Object\.create\(null\)/.test(role));
});

test('the module loads after living apps, and is syntax-checked', () => {
  assert.ok(HTML.indexOf('<script src="living-library.js">') > HTML.indexOf('<script src="living-apps.js">'));
  assert.ok(HTML.includes('<link rel="stylesheet" href="living-library.css">'));
  assert.ok(fs.readFileSync(new URL('tools/check-syntax.mjs', ROOT), 'utf8').includes("'living-library.js'"));
});
