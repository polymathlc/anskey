/* ✉ A student's account email, changed by the teacher and verified by the
   student (v1.194.0). The pure helpers are checked here without a browser,
   the glue is checked against index.html, and the server and the browser
   must agree on what an email address is.

   Run: node --test tools/account-email-tests.mjs
   (The window itself, in real Chromium: node tools/account-email-check.mjs) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const AE = require('../account-email.js');
const SERVER = require('../functions/account-email.js');
const SRC = fs.readFileSync(new URL('../account-email.js', import.meta.url), 'utf8');
const CSS = fs.readFileSync(new URL('../account-email.css', import.meta.url), 'utf8');
const HTML = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const P = AE.pure;

test('the browser and the server agree on what an email address is', () => {
  const samples = ['alice@gmail.com', 'A.B+c@school.edu.sg', ' mailto:Me@Example.com ', 'nope', 'a@b', 'a b@c.com', '@c.com',
    'x@y..com', '<a@b.com>', 'x'.repeat(65) + '@gmail.com', 'ok@' + 'd'.repeat(63) + '.com', ''];
  for (const s of samples) {
    assert.equal(P.cleanEmail(s), SERVER.cleanEmail(s), 'clean ' + s);
    assert.equal(P.validEmail(s), SERVER.validEmail(s), 'valid ' + s);
  }
  assert.equal(P.sameEmail('A@B.com', 'a@b.com'), true);
  assert.equal(P.sameEmail('', ''), false);
});

test('each state of a change reads as a sentence, and only a waiting one is pending', () => {
  const at = new Date(2026, 10, 13, 17, 5).getTime();
  assert.equal(P.when(at), '13 Nov, 5:05pm');
  assert.equal(P.when(0), '');
  assert.match(P.statusText({ to: 'n@g.com', status: 'sent', requestedAt: at }), /^Waiting for n@g\.com to open the verification email \(sent 13 Nov, 5:05pm\)\.$/);
  assert.match(P.statusText({ to: 'n@g.com', status: 'link', requestedAt: at }), /from Gmail/);
  assert.match(P.statusText({ to: 'n@g.com', status: 'done', doneAt: at }), /^Changed to n@g\.com/);
  assert.match(P.statusText({ to: 'n@g.com', status: 'moved', movedAt: at }), /sign in with that Google account/);
  assert.match(P.statusText({ to: 'n@g.com', status: 'cancelled' }), /withdrawn/);
  assert.match(P.statusText({ to: 'n@g.com', status: 'expired' }), /never opened/);
  assert.equal(P.statusText(null), '');
  assert.equal(P.pending({ status: 'sent' }), true);
  assert.equal(P.pending({ status: 'link' }), true);
  for (const s of ['done', 'moved', 'cancelled', 'expired']) assert.equal(P.pending({ status: s }), false, s);
  assert.equal(P.badgeText({ to: 'n@g.com', status: 'sent' }), '✉ waiting for n@g.com');
  assert.equal(P.badgeText({ to: 'n@g.com', status: 'cancelled' }), '');
});

test('the Gmail fallback opens the teacher’s own compose with the link in the body', () => {
  const link = 'https://mathgen--app.firebaseapp.com/__/auth/action?mode=verifyAndChangeEmail&oobCode=abc&apiKey=k';
  const url = P.gmailUrl({ account: 'teacher@gmail.com', to: 'n@g.com', subject: P.mailSubject(), body: P.mailBody('Alice', 'n@g.com', link) });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://mail.google.com/mail/');
  assert.equal(u.searchParams.get('view'), 'cm');
  assert.equal(u.searchParams.get('authuser'), 'teacher@gmail.com');
  assert.equal(u.searchParams.get('to'), 'n@g.com');
  assert.ok(u.searchParams.get('body').includes(link), 'the exact link survives encoding');
  assert.match(u.searchParams.get('body'), /^Hi Alice,/);
  assert.match(u.searchParams.get('body'), /Nothing changes until you do/);
});

test('a sign-in is checked only when something could need finishing or moving', () => {
  const user = { uid: 'u', email: 'n@g.com', isAnonymous: false };
  assert.equal(P.needsCheck(null, null, ''), false);
  assert.equal(P.needsCheck({ uid: 'a', isAnonymous: true, email: '' }, null, ''), false);
  assert.equal(P.needsCheck(user, { level: 'P5', email: 'n@g.com' }, ''), false, 'a settled student costs nothing');
  assert.equal(P.needsCheck(user, { level: 'P5', email: 'N@G.com' }, ''), false);
  assert.equal(P.needsCheck(user, { level: 'P5', email: 'old@g.com' }, ''), true, 'account and roster disagree');
  assert.equal(P.needsCheck(user, null, ''), true, 'a brand new account');
  assert.equal(P.needsCheck(user, { name: 'x' }, ''), true, 'no level yet');
  assert.equal(P.needsCheck(user, { level: 'P5', email: 'n@g.com' }, '?emailChanged=1'), true, 'the verification link');
  assert.equal(P.needsCheck(user, { level: 'P5', email: 'n@g.com' }, '?x=1&emailChanged=1'), true);
});

test('stripLinkFlag removes only the flag', () => {
  const calls = [];
  const hist = { state: null, replaceState: (st, t, url) => calls.push(url) };
  assert.equal(AE.stripLinkFlag({ search: '?ws=abc&emailChanged=1', pathname: '/anskey/', hash: '#p2' }, hist), true);
  assert.deepEqual(calls, ['/anskey/?ws=abc#p2']);
  assert.equal(AE.stripLinkFlag({ search: '?emailChanged=1', pathname: '/anskey/', hash: '' }, hist), true);
  assert.equal(calls[1], '/anskey/');
  assert.equal(AE.stripLinkFlag({ search: '?ws=1', pathname: '/anskey/', hash: '' }, hist), false);
});

test('errors read in words, and the server’s own message wins', () => {
  assert.equal(P.errorText({ error: { message: 'That address already belongs to Bob.' } }, 409), 'That address already belongs to Bob.');
  assert.match(P.errorText(null, 0), /could not reach the server/);
  assert.match(P.errorText(null, 500), /Nothing was changed/);
});

test('the window writes with textContent only, and keeps its keys', () => {
  assert.doesNotMatch(SRC, /\.innerHTML\s*=/, 'nothing a person typed or the server sent is parsed as markup');
  assert.doesNotMatch(SRC, /insertAdjacentHTML/);
  assert.match(SRC, /\['keydown', 'keyup', 'keypress'\]\.forEach/);
  assert.match(SRC, /e\.stopPropagation\(\)/);
  assert.match(SRC, /e\.key === 'Escape'/);
  // Teacher-only in every action, not just by hiding the button.
  for (const fn of ['function open(', 'async function send(', 'async function withdrawChange(', 'async function refreshOne(', 'async function refreshAll(']) {
    const at = SRC.indexOf(fn);
    assert.ok(at > 0, fn);
    assert.match(SRC.slice(at, at + 400), /teacher\(\)/, fn + ' asks teacher()');
  }
  // A late answer for a closed or different student is dropped.
  assert.ok((SRC.match(/seq !== state\.seq/g) || []).length >= 6);
  assert.match(CSS, /\.aeBack \{[^}]*z-index: 150/);
  assert.match(CSS, /@media print \{ \.aeBack \{ display: none !important; \} \}/);
  assert.match(CSS, /\.aeInput \{[^}]*user-select: text/);
});

test('the glue: one gate, the row button, the roster refresh, the sign-in order', () => {
  assert.match(HTML, /<script src="account-email\.js\?v=1\.194\.0"><\/script>/);
  assert.match(HTML, /<link rel="stylesheet" href="account-email\.css\?v=1\.194\.0">/);
  assert.match(HTML, /var APP_VERSION = 'v1\.(?:19[4-9]|[2-9]\d\d)\.\d+';/);
  const glue = HTML.slice(HTML.indexOf('/* ✉ Account email — glue'), HTML.indexOf('/* End account email glue */'));
  assert.ok(glue.length > 500);
  assert.match(glue, /function accountEmailTeacher\(\) \{\n  return !!\(currentUser && isAdmin\(currentUser\) && !actingStudent && !isSharedVisitor\(\)\);/);
  assert.match(glue, /function accountEmailOpen\(uid, p\) \{\n  if \(!accountEmailTeacher\(\)\)/);
  assert.match(glue, /appCheckToken: function \(\) \{ return window\.liveAppCheckToken; \}/);
  assert.doesNotMatch(glue, /\.collection\(|\.set\(|\.update\(/, 'the glue writes nothing itself');
  // The row: managed students have no account and no button.
  const row = HTML.slice(HTML.indexOf('function studentAdminRow(uid, p) {'), HTML.indexOf('/* 🧩 THE GAP VIEW'));
  assert.match(row, /if \(!p\.managed && typeof accountEmailOpen === 'function'\)/);
  assert.match(row, /accountEmailOpen\(uid, p\)/);
  assert.match(row, /if \(!p\.managed && typeof accountEmailBadge === 'function'\)/);
  // The roster refresh is what finishes a change.
  assert.match(HTML, /accountEmailRefreshAll\(rows\.map\(function \(r\) \{ return r\.uid; \}\)\)/);
  // The sign-in check runs BEFORE the profile prompt, and a moved sign-in stops it.
  const auth = HTML.slice(HTML.indexOf('loadStudentProfile(user).then(function () {'));
  const check = auth.indexOf('accountEmailSignIn(user)'), prompt = auth.indexOf('openProfileModal(true)');
  assert.ok(check > 0 && prompt > check, 'the check comes first');
  assert.match(auth.slice(check, prompt), /if \(signedOut \|\| currentUser !== user\) return;/);
  assert.match(HTML, /if \(typeof accountEmailRoleChanged === 'function'\) accountEmailRoleChanged\(\);/);
  assert.match(HTML, /auth\/account-exists-with-different-credential/);
  assert.match(HTML, /try \{ accountEmailLanding\(\); \} catch \(e\) \{\}/);
});

test('the endpoint is the deployed function, and both files are syntax-checked', () => {
  assert.equal(AE.ENDPOINT, 'https://us-central1-mathgen--app.cloudfunctions.net/ansKeyAccountEmail');
  const idx = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  assert.match(idx, /exports\.ansKeyAccountEmail = onRequest\(/);
  const cs = fs.readFileSync(new URL('./check-syntax.mjs', import.meta.url), 'utf8');
  assert.match(cs, /'account-email\.js', 'functions\/account-email\.js'/);
});
