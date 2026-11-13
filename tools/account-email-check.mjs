/* ✉ The account email window in real Chromium (v1.194.0).
   The module runs on a bare page with a fake server (fetch) so every answer
   the real function can give is seen in the real DOM: send, the empty-account
   question, the Gmail fallback, a refusal, withdraw, the roster badge, keys
   that must never reach the worksheet, Escape, the teacher gate, a phone, and
   the student's moved sign-in.

   Run: node tools/account-email-check.mjs   (PW=/path/to/playwright/index.mjs) */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = process.env.PW ? await import(process.env.PW) : require('playwright');
const chromium = pw.chromium || (pw.default && pw.default.chromium);
const JS = fs.readFileSync(new URL('../account-email.js', import.meta.url), 'utf8');
const CSS = fs.readFileSync(new URL('../account-email.css', import.meta.url), 'utf8');
const SHOTS = process.env.AE_SCREENSHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const HARNESS = `
window.__calls = []; window.__toasts = []; window.__leaked = 0; window.__teacher = true;
window.__answers = [];
document.addEventListener('keydown', function () { window.__leaked++; });
window.fakeFetch = async function (url, opts) {
  var body = JSON.parse(opts.body);
  window.__calls.push({ url: url, body: body, auth: opts.headers.Authorization, app: opts.headers['X-Firebase-AppCheck'] });
  var next = window.__answers.length ? window.__answers.shift() : { status: 200, json: { changes: {} } };
  if (typeof next === 'function') next = await next(body);
  return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async function () { return next.json; } };
};
window.ae = AccountEmail.create({
  user: function () { return { uid: 'teacher', email: 'teacher@gmail.com', getIdToken: async function () { return 'id-token'; } }; },
  appCheckToken: function () { return async function () { return 'app-token'; }; },
  isTeacher: function () { return window.__teacher; },
  teacherEmail: function () { return 'teacher@gmail.com'; },
  toast: function (m) { window.__toasts.push(m); },
  fetch: window.fakeFetch
});
window.row = { name: 'Alice Tan', email: 'alice.old@gmail.com', level: 'P5' };
window.rowEmails = [];
document.getElementById('nm').appendChild(ae.badge('alice', window.row, function (e) { window.rowEmails.push(e); }));
`;

const browser = await chromium.launch();
let failures = 0;
async function step(name, fn) {
  try { await fn(); console.log('ok - ' + name); }
  catch (e) { failures++; console.log('not ok - ' + name + '\n  ' + (e && e.stack || e)); }
}
try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => { failures++; console.log('page error: ' + e.message); });
  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + CSS +
    ' .btn{padding:8px 14px;border-radius:10px;border:1px solid #ddd;background:#fff;font:inherit}.btnPrimary{background:#FFE0B2}</style></head>' +
    '<body><div id="nm">Alice Tan</div><script>' + JS + '</script><script>' + HARNESS + '</script></body></html>');

  await step('opens on the student, says where it stands, and asks the server about them', async () => {
    await page.evaluate(() => { window.__answers.push({ status: 200, json: { changes: {} } }); ae.open({ uid: 'alice', profile: window.row }); });
    await page.waitForSelector('.aeBack.open');
    assert.equal(await page.textContent('.aeTitle'), '✉ Change Alice Tan’s email');
    assert.equal(await page.textContent('.aeEmail'), 'alice.old@gmail.com');
    await page.waitForFunction(() => window.__calls.length === 1);
    const c = await page.evaluate(() => window.__calls[0]);
    assert.deepEqual(c.body, { type: 'status', uids: ['alice'] });
    assert.equal(c.auth, 'Bearer id-token'); assert.equal(c.app, 'app-token');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'aeNewEmail');
  });

  await step('typing never reaches the worksheet, and Send waits for a full address', async () => {
    await page.click('#aeNewEmail');
    await page.keyboard.type('alice.new');
    assert.equal(await page.evaluate(() => window.__leaked), 0);
    assert.equal(await page.isDisabled('.aeSend'), true);
    assert.match(await page.textContent('.aeHint'), /full email address/);
    await page.keyboard.type('@gmail.com');
    assert.equal(await page.isDisabled('.aeSend'), false);
    assert.match(await page.textContent('.aeHint'), /goes to alice\.new@gmail\.com/);
  });

  await step('the empty-account question, then Remove it and send', async () => {
    await page.evaluate(() => {
      window.__answers.push({ status: 409, json: { error: { code: 'email_in_use_empty', message: 'That address already has an empty account. Remove it so the address can move to this student?' } } });
      window.__answers.push(body => ({ status: 200, json: { change: { to: body.email, from: 'alice.old@gmail.com', status: 'sent', via: 'firebase', requestedAt: Date.now() } } }));
    });
    await page.keyboard.press('Enter');
    await page.waitForSelector('.aeAsk');
    assert.match(await page.textContent('.aeAskText'), /empty account/);
    await page.click('.aeAskYes');
    await page.waitForSelector('.aeNote.aeOk');
    const calls = await page.evaluate(() => window.__calls.slice(1).map(c => c.body));
    assert.deepEqual(calls, [
      { type: 'request', uid: 'alice', email: 'alice.new@gmail.com', replaceEmpty: false },
      { type: 'request', uid: 'alice', email: 'alice.new@gmail.com', replaceEmpty: true }
    ]);
    assert.match(await page.textContent('.aeNote'), /verification email from Firebase/);
    assert.match(await page.textContent('.aeStatus.aeWaiting'), /Waiting for alice\.new@gmail\.com/);
    // NOTHING changed on the roster: the old address is still shown.
    assert.equal(await page.textContent('.aeEmail'), 'alice.old@gmail.com');
    assert.match(await page.textContent('#nm'), /✉ waiting for alice\.new@gmail\.com/);
    if (SHOTS) await page.screenshot({ path: SHOTS + '/waiting.png' });
  });

  await step('a refusal is shown in the server’s words', async () => {
    await page.fill('#aeNewEmail', 'bob@gmail.com');
    await page.evaluate(() => window.__answers.push({ status: 409, json: { error: { code: 'email_in_use', message: 'That address already belongs to “Bob Lim”’s account.' } } }));
    await page.click('.aeSend');
    await page.waitForSelector('.aeNote.aeBad');
    assert.match(await page.textContent('.aeNote'), /Bob Lim/);
  });

  await step('when Firebase cannot send it, the teacher’s own Gmail is offered with the link', async () => {
    const link = 'https://mathgen--app.firebaseapp.com/__/auth/action?mode=verifyAndChangeEmail&oobCode=abc';
    await page.fill('#aeNewEmail', 'alice.school@school.edu.sg');
    await page.evaluate(l => window.__answers.push({ status: 200, json: { link: l, reason: 'Firebase is not set up to send this email.', change: { to: 'alice.school@school.edu.sg', status: 'link', via: 'teacher', requestedAt: Date.now() } } }), link);
    await page.click('.aeSend');
    await page.waitForSelector('.aeLinkBox');
    const href = await page.getAttribute('.aeGmail', 'href');
    const u = new URL(href);
    assert.equal(u.searchParams.get('authuser'), 'teacher@gmail.com');
    assert.equal(u.searchParams.get('to'), 'alice.school@school.edu.sg');
    assert.ok(u.searchParams.get('body').includes(link));
    assert.equal(await page.getAttribute('.aeGmail', 'target'), '_blank');
    if (SHOTS) await page.screenshot({ path: SHOTS + '/gmail-fallback.png' });
  });

  await step('withdraw, then a roster refresh that finds it opened updates the row', async () => {
    await page.evaluate(() => window.__answers.push({ status: 200, json: { change: { to: 'alice.school@school.edu.sg', status: 'cancelled' } } }));
    await page.click('.aeWithdraw');
    await page.waitForSelector('.aeStatus.aeOff');
    assert.match(await page.textContent('.aeStatusText'), /withdrawn/);
    assert.equal(await page.isHidden('.aeBadge'), true);
    await page.evaluate(() => window.__answers.push({ status: 200, json: { changes: { alice: { to: 'alice.new@gmail.com', status: 'done', doneAt: Date.now() } } } }));
    await page.evaluate(() => ae.refreshAll(['alice', 'managed_1']));
    await page.waitForFunction(() => window.rowEmails.length === 1);
    assert.deepEqual(await page.evaluate(() => window.rowEmails), ['alice.new@gmail.com']);
    assert.equal(await page.evaluate(() => window.row.email), 'alice.new@gmail.com');
    assert.deepEqual(await page.evaluate(() => window.__calls[window.__calls.length - 1].body), { type: 'status', uids: ['alice'] });
    assert.match(await page.textContent('.aeBadge'), /✉ changed/);
  });

  await step('Escape closes it, and keys still never leaked', async () => {
    await page.focus('#aeNewEmail');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.aeBack:not(.open)', { state: 'attached' });
    assert.equal(await page.evaluate(() => window.__leaked), 0);
  });

  await step('a late answer for a closed window is dropped', async () => {
    await page.evaluate(() => {
      window.__answers.push({ status: 200, json: { changes: {} } });
      ae.open({ uid: 'alice', profile: window.row });
    });
    await page.waitForFunction(() => window.__answers.length === 0);
    await page.fill('#aeNewEmail', 'late@gmail.com');
    await page.evaluate(() => {
      window.__answers.push(() => new Promise(res => { window.__release = () => res({ status: 200, json: { change: { to: 'late@gmail.com', status: 'sent' } } }); }));
    });
    await page.click('.aeSend');
    await page.waitForFunction(() => typeof window.__release === 'function');
    assert.equal(await page.textContent('.aeSend'), 'Sending…');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => ae.isOpen()), false);
    await page.evaluate(() => window.__release());
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => ae.isOpen()), false);
    assert.equal(await page.evaluate(() => document.querySelector('.aeBack').classList.contains('open')), false);
    assert.equal(await page.evaluate(() => !!document.querySelector('.aeNote')), false, 'nothing was drawn for a closed window');
  });

  await step('a non-teacher cannot open it or refresh the roster', async () => {
    const before = await page.evaluate(() => window.__calls.length);
    const opened = await page.evaluate(() => { window.__teacher = false; return ae.open({ uid: 'alice', profile: window.row }); });
    assert.equal(opened, false);
    await page.evaluate(() => ae.refreshAll(['alice']));
    assert.equal(await page.evaluate(() => window.__calls.length), before);
    assert.match(await page.evaluate(() => window.__toasts[window.__toasts.length - 1]), /Only the teacher/);
    await page.evaluate(() => { window.__teacher = true; });
    const managed = await page.evaluate(() => ae.open({ uid: 'managed_x', profile: { managed: true } }));
    assert.equal(managed, false);
  });

  await step('a phone: the window fits with no sideways scroll', async () => {
    await page.setViewportSize({ width: 375, height: 700 });
    await page.evaluate(() => { window.__answers.push({ status: 200, json: { changes: { alice: { to: 'alice.new@gmail.com', status: 'sent', requestedAt: Date.now() } } } }); ae.open({ uid: 'alice', profile: { name: 'Alice Tan', email: 'a.very.long.address.for.a.phone@gmail.com' } }); });
    await page.waitForSelector('.aeStatus');
    const box = await page.evaluate(() => { const r = document.querySelector('.aeCard').getBoundingClientRect(); return { left: r.left, right: r.right, sw: document.documentElement.scrollWidth }; });
    assert.ok(box.left >= 0 && box.right <= 375, JSON.stringify(box));
    assert.ok(box.sw <= 375, JSON.stringify(box));
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('aeNewEmail')).fontSize), '16px');
    if (SHOTS) await page.screenshot({ path: SHOTS + '/phone.png' });
    await page.keyboard.press('Escape');
  });

  await step('the student’s side: a moved sign-in says so; a settled one is not asked at all', async () => {
    const r = await page.evaluate(async () => {
      try { sessionStorage.clear(); } catch (e) {}
      window.__answers.push({ status: 200, json: { moved: true, message: 'Your Ans Key account now signs in with n@gmail.com. Sign in with Google again.' } });
      const user = { uid: 'fresh', email: 'n@gmail.com', isAnonymous: false, getIdToken: async () => 'stu' };
      const stu = AccountEmail.create({ user: () => user, appCheckToken: () => async () => 'app', isTeacher: () => false, fetch: window.fakeFetch });
      const moved = await stu.checkSignIn(user, null);
      const n = window.__calls.length;
      const settled = await stu.checkSignIn({ uid: 's', email: 's@g.com', isAnonymous: false, getIdToken: async () => 'x' }, { level: 'P5', email: 's@g.com' });
      return { moved, asked: window.__calls.length - n, last: window.__calls[n - 1].body };
    });
    assert.equal(r.moved.moved, true);
    assert.match(r.moved.message, /Sign in with Google again/);
    assert.deepEqual(r.last, { type: 'mine' });
    assert.equal(r.asked, 0);
  });
} finally {
  await browser.close();
}
if (failures) { console.log(failures + ' failed'); process.exit(1); }
console.log('account email browser check passed');
