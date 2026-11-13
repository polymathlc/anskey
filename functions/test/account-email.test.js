'use strict';
// ✉ The teacher changes a student's account email; the student verifies it.
// Fake Auth, Firestore and mailer stand in for Firebase so every path can be
// seen: who may ask, what is sent, what changes (and what never does) before
// the link is opened, the finish, the empty-account move and its rollback.
const test = require('node:test'), assert = require('node:assert/strict');
const AE = require('../account-email');
const { APP_ID, TEACHER_EMAIL } = require('../live-service');

const T0 = Date.UTC(2026, 10, 13, 9, 0, 0);

function fakeDb(initial = {}) {
  const data = new Map();
  Object.entries(initial).forEach(([path, value]) => data.set(path, JSON.parse(JSON.stringify(value))));
  const log = [];
  function doc(col, id) {
    const path = col + '/' + id;
    return {
      id,
      async get() { return { exists: data.has(path), id, data: () => (data.has(path) ? JSON.parse(JSON.stringify(data.get(path))) : undefined) }; },
      async set(value, opts) {
        log.push(['set', path, value, opts || null]);
        const next = opts && opts.merge ? Object.assign({}, data.get(path) || {}, value) : Object.assign({}, value);
        data.set(path, JSON.parse(JSON.stringify(next)));
      },
      async delete() { log.push(['delete', path]); data.delete(path); }
    };
  }
  return {
    data, log,
    collection(col) {
      return {
        doc: id => doc(col, id),
        where(field, op, value) {
          assert.equal(op, '==');
          return {
            limit() { return this; },
            async get() {
              const docs = [];
              for (const [path, v] of data) {
                const [c, id] = path.split('/');
                if (c === col && v[field] === value) docs.push({ id, data: () => JSON.parse(JSON.stringify(v)) });
              }
              return { forEach: fn => docs.forEach(fn), size: docs.length };
            }
          };
        }
      };
    }
  };
}

function fakeAuth(users) {
  const map = new Map(Object.entries(JSON.parse(JSON.stringify(users))));
  const calls = [];
  const notFound = () => Object.assign(new Error('There is no user record'), { code: 'auth/user-not-found' });
  return {
    map, calls,
    tokenUser: null,
    async verifyIdToken(token, revoked) { calls.push(['verify', token, revoked]); if (this.tokenUser instanceof Error) throw this.tokenUser; return this.tokenUser; },
    async getUserByEmail(email) {
      for (const u of map.values()) if (String(u.email || '').toLowerCase() === String(email).toLowerCase()) return JSON.parse(JSON.stringify(u));
      throw notFound();
    },
    async getUser(uid) { if (!map.has(uid)) throw notFound(); return JSON.parse(JSON.stringify(map.get(uid))); },
    async deleteUser(uid) { calls.push(['deleteUser', uid]); map.delete(uid); },
    async updateUser(uid, change) {
      calls.push(['updateUser', uid, change]);
      if (this.failLink && change.providerToLink && change.providerToLink.uid === this.failLink) throw new Error('link refused');
      const u = map.get(uid);
      if (change.providersToUnlink) u.providerData = (u.providerData || []).filter(p => change.providersToUnlink.indexOf(p.providerId) === -1);
      if (change.providerToLink) u.providerData = (u.providerData || []).concat([{ providerId: change.providerToLink.providerId, uid: change.providerToLink.uid, email: change.providerToLink.email }]);
      return u;
    },
    async revokeRefreshTokens(uid) { calls.push(['revoke', uid]); }
  };
}

const teacher = { uid: 'teacher', email: TEACHER_EMAIL, emailVerified: true, providerData: [{ providerId: 'google.com', uid: 'g-teacher' }] };
const alice = { uid: 'alice', email: 'alice.old@gmail.com', emailVerified: true, providerData: [{ providerId: 'google.com', uid: 'g-alice-old', email: 'alice.old@gmail.com' }] };

function harness({ users = {}, db = {}, mailer, tokenUser, clock } = {}) {
  const auth = fakeAuth(Object.assign({ teacher, alice }, users));
  auth.tokenUser = tokenUser === undefined ? { uid: 'teacher', email: TEACHER_EMAIL, email_verified: true } : tokenUser;
  const store = fakeDb(Object.assign({ 'studentProfiles/alice': { name: 'Alice Tan', level: 'P5', subject: 'science', email: 'alice.old@gmail.com', days: ['Wed'] } }, db));
  const sent = [], reports = [];
  const m = mailer || {
    async send(args) { sent.push(args); return { email: args.email }; },
    async link(args) { return 'https://mathgen--app.firebaseapp.com/__/auth/action?mode=verifyAndChangeEmail&oobCode=x&to=' + args.newEmail; }
  };
  let now = clock || T0;
  const service = AE.createAccountEmailService({
    auth, appCheck: { async verifyToken() { return { appId: APP_ID }; } }, db: store, mailer: m,
    now: () => now, report: code => reports.push(code)
  });
  async function call(body, opts = {}) {
    const headers = { origin: 'https://polymathlc.github.io', authorization: 'Bearer tok', 'x-firebase-appcheck': 'app', 'content-type': 'application/json', ...opts.headers };
    const req = { body, method: opts.method || 'POST', rawBody: Buffer.from(JSON.stringify(body || {})), get: n => headers[n.toLowerCase()] };
    const res = { headers: {}, statusCode: 200, set(k, v) { this.headers[k] = v; return this; }, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; }, send(v) { this.body = v; return this; } };
    await service.handler(req, res);
    return res;
  }
  return { auth, store, sent, reports, call, service, tick: ms => { now += ms; }, setNow: t => { now = t; } };
}

test('pure helpers: emails are cleaned, checked and compared without case', () => {
  assert.equal(AE.cleanEmail('  Mailto:Alice.New@Gmail.COM '), 'alice.new@gmail.com');
  assert.equal(AE.validEmail('alice.new@gmail.com'), true);
  assert.equal(AE.validEmail('a+tag@school.edu.sg'), true);
  for (const bad of ['', 'alice', 'alice@', '@gmail.com', 'a b@gmail.com', 'alice@gmail', '<a@b.com>', 'a@b..com', 'x'.repeat(65) + '@gmail.com']) {
    assert.equal(AE.validEmail(bad), false, bad);
  }
  assert.equal(AE.sameEmail('A@B.com', 'a@b.COM'), true);
  assert.equal(AE.sameEmail('', ''), false);
  assert.deepEqual(AE.recentSends([T0 - 25 * 3600e3, T0 - 3600e3, 'x', T0], T0), [T0 - 3600e3, T0]);
  assert.equal(AE.continueUrlFor('https://polymathlc.github.io'), 'https://polymathlc.github.io/anskey/?emailChanged=1');
  assert.equal(AE.continueUrlFor('http://localhost:8080'), 'https://polymathlc.github.io/anskey/?emailChanged=1');
  assert.equal(AE.continueUrlFor('https://evil.example'), 'https://polymathlc.github.io/anskey/?emailChanged=1');
  assert.equal(AE.profileSetUp(null), false);
  assert.equal(AE.profileSetUp({ email: 'x@y.com' }), false);
  assert.equal(AE.profileSetUp({ level: 'P4' }), true);
});

test('validateBody refuses what it cannot act on', () => {
  assert.throws(() => AE.validateBody(null), /Send an email change/);
  assert.throws(() => AE.validateBody({ type: 'drop' }), /valid email action/);
  assert.throws(() => AE.validateBody({ type: 'request', uid: 'a/b', email: 'x@y.com' }), /student is not valid/);
  assert.throws(() => AE.validateBody({ type: 'request', uid: 'managed_123', email: 'x@y.com' }), /no Google account/);
  assert.throws(() => AE.validateBody({ type: 'request', uid: 'alice', email: 'nope' }), /does not look like an email/);
  assert.deepEqual(AE.validateBody({ type: 'request', uid: 'alice', email: ' New@Gmail.com ' }), { type: 'request', uid: 'alice', email: 'new@gmail.com', replaceEmpty: false });
  assert.deepEqual(AE.validateBody({ type: 'status', uids: ['alice', 'alice', 'managed_1', 'bad/id', 'bob'] }).uids, ['alice', 'bob']);
  assert.throws(() => AE.validateBody({ type: 'status', uids: [] }), /between 1/);
  assert.deepEqual(AE.validateBody({ type: 'mine' }), { type: 'mine' });
});

test('only the teacher, from Ans Key, with App Check, may ask for a change', async () => {
  const student = harness({ tokenUser: { uid: 'alice', email: 'alice.old@gmail.com', email_verified: true } });
  let res = await student.call({ type: 'request', uid: 'alice', email: 'alice.new@gmail.com' });
  assert.equal(res.statusCode, 403); assert.equal(res.body.error.code, 'teacher_required');
  assert.equal(student.sent.length, 0);
  res = await student.call({ type: 'status', uids: ['alice'] });
  assert.equal(res.statusCode, 403);

  const h = harness();
  res = await h.call({ type: 'request', uid: 'alice', email: 'alice.new@gmail.com' }, { headers: { origin: 'https://evil.example' } });
  assert.equal(res.statusCode, 403); assert.equal(res.body.error.code, 'origin_not_allowed');
  res = await h.call({ type: 'request', uid: 'alice', email: 'alice.new@gmail.com' }, { headers: { 'x-firebase-appcheck': '' } });
  assert.equal(res.body.error.code, 'app_check_required');
  res = await h.call({ type: 'request', uid: 'alice', email: 'alice.new@gmail.com' }, { headers: { authorization: '' } });
  assert.equal(res.statusCode, 401);
  res = await h.call({}, { method: 'OPTIONS' });
  assert.equal(res.statusCode, 204);
  assert.equal(h.sent.length, 0);
  // The token is checked WITH revocation, like every other teacher service.
  assert.ok(h.auth.calls.some(c => c[0] === 'verify' && c[2] === true));
});

test('a request sends Firebase’s verification email and changes NOTHING yet', async () => {
  const h = harness();
  const res = await h.call({ type: 'request', uid: 'alice', email: 'Alice.New@gmail.com' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(h.sent, [{ email: 'alice.old@gmail.com', newEmail: 'alice.new@gmail.com', continueUrl: 'https://polymathlc.github.io/anskey/?emailChanged=1' }]);
  assert.equal(res.body.change.status, 'sent');
  assert.equal(res.body.change.to, 'alice.new@gmail.com');
  assert.equal(res.body.change.via, 'firebase');
  assert.equal(res.body.link, undefined);
  // The account and the roster row are untouched until the link is opened.
  assert.equal(h.auth.map.get('alice').email, 'alice.old@gmail.com');
  assert.equal(h.store.data.get('studentProfiles/alice').email, 'alice.old@gmail.com');
  const rec = h.store.data.get('accountEmailChanges/alice');
  assert.equal(rec.from, 'alice.old@gmail.com'); assert.equal(rec.requestedBy, 'teacher'); assert.deepEqual(rec.sends, [T0]);
  // Status before the link is opened: still pending, nothing written.
  const st = await h.call({ type: 'status', uids: ['alice'] });
  assert.equal(st.body.changes.alice.status, 'sent');
  assert.equal(h.store.data.get('studentProfiles/alice').email, 'alice.old@gmail.com');
});

test('opening the link finishes it: status writes the new address onto the roster row', async () => {
  const h = harness();
  await h.call({ type: 'request', uid: 'alice', email: 'alice.new@gmail.com' });
  // Firebase's own handler changes the account when the student opens the link.
  h.auth.map.get('alice').email = 'alice.new@gmail.com';
  h.tick(3600e3);
  const st = await h.call({ type: 'status', uids: ['alice', 'nobody'] });
  assert.equal(st.body.changes.alice.status, 'done');
  assert.equal(st.body.changes.nobody, undefined);
  const row = h.store.data.get('studentProfiles/alice');
  assert.equal(row.email, 'alice.new@gmail.com');
  assert.equal(row.emailChangedFrom, 'alice.old@gmail.com');
  // Everything else on the row is kept (merge).
  assert.equal(row.level, 'P5'); assert.deepEqual(row.days, ['Wed']); assert.equal(row.name, 'Alice Tan');
});

test('the student’s own `mine` finishes it too, and only for their own account', async () => {
  const h = harness();
  await h.call({ type: 'request', uid: 'alice', email: 'alice.new@gmail.com' });
  h.auth.map.get('alice').email = 'alice.new@gmail.com';
  h.auth.tokenUser = { uid: 'alice', email: 'alice.new@gmail.com', email_verified: true };
  const res = await h.call({ type: 'mine' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.change.status, 'done');
  assert.equal(res.body.moved, false);
  assert.equal(h.store.data.get('studentProfiles/alice').email, 'alice.new@gmail.com');
});

test('refusals: same address, the teacher’s address, own account, no account, a set-up account', async () => {
  const h = harness({ users: { bob: { uid: 'bob', email: 'bob@gmail.com', providerData: [{ providerId: 'google.com', uid: 'g-bob' }] } },
    db: { 'studentProfiles/bob': { name: 'Bob Lim', level: 'P4' } } });
  let res = await h.call({ type: 'request', uid: 'alice', email: 'ALICE.OLD@gmail.com' });
  assert.equal(res.body.error.code, 'same_email');
  res = await h.call({ type: 'request', uid: 'alice', email: TEACHER_EMAIL });
  assert.equal(res.body.error.code, 'bad_email');
  res = await h.call({ type: 'request', uid: 'teacher', email: 'x@gmail.com' });
  assert.equal(res.body.error.code, 'not_a_student');
  res = await h.call({ type: 'request', uid: 'ghost', email: 'x@gmail.com' });
  assert.equal(res.statusCode, 404); assert.equal(res.body.error.code, 'no_account');
  res = await h.call({ type: 'request', uid: 'alice', email: 'bob@gmail.com', replaceEmpty: true });
  assert.equal(res.statusCode, 409); assert.equal(res.body.error.code, 'email_in_use');
  assert.match(res.body.error.message, /Bob Lim/);
  assert.ok(h.auth.map.has('bob'), 'a set-up account is never removed');
  assert.equal(h.sent.length, 0);
});

test('an EMPTY account on the new address is removed only when the teacher says so', async () => {
  const h = harness({ users: { stray: { uid: 'stray', email: 'alice.new@gmail.com', providerData: [{ providerId: 'google.com', uid: 'g-alice-new' }] } } });
  let res = await h.call({ type: 'request', uid: 'alice', email: 'alice.new@gmail.com' });
  assert.equal(res.statusCode, 409); assert.equal(res.body.error.code, 'email_in_use_empty');
  assert.ok(h.auth.map.has('stray')); assert.equal(h.sent.length, 0);
  res = await h.call({ type: 'request', uid: 'alice', email: 'alice.new@gmail.com', replaceEmpty: true });
  assert.equal(res.statusCode, 200);
  assert.ok(!h.auth.map.has('stray'));
  assert.equal(h.sent.length, 1);
});

test('five sends a day, then the teacher is told to wait', async () => {
  const h = harness();
  for (let i = 0; i < AE.SENDS_PER_DAY; i++) {
    const res = await h.call({ type: 'request', uid: 'alice', email: 'alice.new' + i + '@gmail.com' });
    assert.equal(res.statusCode, 200);
    h.tick(60e3);
  }
  let res = await h.call({ type: 'request', uid: 'alice', email: 'alice.last@gmail.com' });
  assert.equal(res.statusCode, 429); assert.equal(res.body.error.code, 'too_many');
  h.tick(24 * 3600e3);
  res = await h.call({ type: 'request', uid: 'alice', email: 'alice.last@gmail.com' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.change.sendsToday, 1);
});

test('when Firebase will not send it, the SAME verified link comes back for the teacher’s Gmail', async () => {
  const h = harness({ mailer: {
    async send() { throw Object.assign(new Error('OPERATION_NOT_ALLOWED'), { code: 'OPERATION_NOT_ALLOWED' }); },
    async link(args) { return 'https://mathgen--app.firebaseapp.com/__/auth/action?mode=verifyAndChangeEmail&oobCode=abc&e=' + args.newEmail; }
  } });
  const res = await h.call({ type: 'request', uid: 'alice', email: 'alice.new@gmail.com' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body.link, /mode=verifyAndChangeEmail/);
  assert.equal(res.body.change.status, 'link');
  assert.equal(res.body.change.via, 'teacher');
  assert.match(res.body.reason, /not set up/);
  assert.equal(h.auth.map.get('alice').email, 'alice.old@gmail.com');
});

test('a mailer that cannot send or make a link changes nothing and says so', async () => {
  const h = harness({ mailer: { async send() { throw new Error('boom'); }, async link() { throw new Error('boom'); } } });
  const res = await h.call({ type: 'request', uid: 'alice', email: 'alice.new@gmail.com' });
  assert.equal(res.statusCode, 503); assert.equal(res.body.error.code, 'mailer_unavailable');
  assert.match(res.body.error.message, /Nothing was changed/);
  assert.equal(h.store.data.has('accountEmailChanges/alice'), false);
});

test('EMAIL_EXISTS from Firebase is reported as an address in use, not as a link', async () => {
  let linked = false;
  const h = harness({ mailer: { async send() { throw Object.assign(new Error('EMAIL_EXISTS'), { code: 'EMAIL_EXISTS' }); }, async link() { linked = true; return 'x'; } } });
  const res = await h.call({ type: 'request', uid: 'alice', email: 'alice.new@gmail.com' });
  assert.equal(res.statusCode, 409); assert.equal(linked, false);
});

test('cancel marks it withdrawn, and a later status still notices if it was opened anyway', async () => {
  const h = harness();
  await h.call({ type: 'request', uid: 'alice', email: 'alice.new@gmail.com' });
  let res = await h.call({ type: 'cancel', uid: 'alice' });
  assert.equal(res.body.change.status, 'cancelled');
  res = await h.call({ type: 'status', uids: ['alice'] });
  assert.equal(res.body.changes.alice.status, 'cancelled');
  h.setNow(T0 + 8 * 24 * 3600e3);
  await h.call({ type: 'request', uid: 'alice', email: 'alice.other@gmail.com' });
  h.setNow(T0 + 16 * 24 * 3600e3);
  res = await h.call({ type: 'status', uids: ['alice'] });
  assert.equal(res.body.changes.alice.status, 'expired');
});

test('a NEW Google sign-in on a verified address is moved onto the student’s real account', async () => {
  const h = harness();
  await h.call({ type: 'request', uid: 'alice', email: 'alice.new@gmail.com' });
  h.auth.map.get('alice').email = 'alice.new@gmail.com';            // link opened
  // The student signs in with the new Google account: a fresh, empty account.
  h.auth.map.set('fresh', { uid: 'fresh', email: 'alice.new@gmail.com', providerData: [{ providerId: 'google.com', uid: 'g-alice-new', email: 'alice.new@gmail.com', displayName: 'Alice' }] });
  h.auth.tokenUser = { uid: 'fresh', email: 'alice.new@gmail.com', email_verified: true };
  const res = await h.call({ type: 'mine' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.moved, true);
  assert.match(res.body.message, /Sign in with Google again/);
  assert.ok(!h.auth.map.has('fresh'), 'the empty account is gone');
  const google = h.auth.map.get('alice').providerData.filter(p => p.providerId === 'google.com');
  assert.deepEqual(google.map(p => p.uid), ['g-alice-new'], 'only the new Google sign-in opens the account now');
  assert.ok(h.auth.calls.some(c => c[0] === 'revoke' && c[1] === 'alice'));
  assert.equal(h.store.data.get('accountEmailChanges/alice').status, 'moved');
  assert.equal(h.store.data.get('studentProfiles/alice').email, 'alice.new@gmail.com');
  assert.equal(h.store.data.get('studentProfiles/alice').level, 'P5');
});

test('nothing moves before the link is opened, from a set-up account, or for an unverified token', async () => {
  const h = harness();
  await h.call({ type: 'request', uid: 'alice', email: 'alice.new@gmail.com' });
  h.auth.map.set('fresh', { uid: 'fresh', email: 'alice.new@gmail.com', providerData: [{ providerId: 'google.com', uid: 'g-alice-new' }] });
  h.auth.tokenUser = { uid: 'fresh', email: 'alice.new@gmail.com', email_verified: true };
  let res = await h.call({ type: 'mine' });
  assert.equal(res.body.moved, false); assert.equal(res.body.waiting, true);
  assert.ok(h.auth.map.has('fresh'));

  h.auth.map.get('alice').email = 'alice.new@gmail.com';
  h.store.data.set('studentProfiles/fresh', { name: 'Someone', level: 'P6' });
  res = await h.call({ type: 'mine' });
  assert.equal(res.body.moved, false); assert.equal(res.body.conflict, true);
  assert.ok(h.auth.map.has('fresh'));

  h.store.data.delete('studentProfiles/fresh');
  h.auth.tokenUser = { uid: 'fresh', email: 'alice.new@gmail.com', email_verified: false };
  res = await h.call({ type: 'mine' });
  assert.equal(res.body.moved, false);
  assert.ok(h.auth.map.has('fresh'));
  assert.deepEqual(h.auth.map.get('alice').providerData.map(p => p.uid), ['g-alice-old']);
});

test('a refused link puts the OLD Google sign-in back, so the student is never locked out', async () => {
  const h = harness();
  await h.call({ type: 'request', uid: 'alice', email: 'alice.new@gmail.com' });
  h.auth.map.get('alice').email = 'alice.new@gmail.com';
  h.auth.map.set('fresh', { uid: 'fresh', email: 'alice.new@gmail.com', providerData: [{ providerId: 'google.com', uid: 'g-alice-new' }] });
  h.auth.tokenUser = { uid: 'fresh', email: 'alice.new@gmail.com', email_verified: true };
  h.auth.failLink = 'g-alice-new';
  const res = await h.call({ type: 'mine' });
  assert.equal(res.statusCode, 503); assert.equal(res.body.error.code, 'move_failed');
  assert.deepEqual(h.auth.map.get('alice').providerData.map(p => p.uid), ['g-alice-old']);
});

test('the Firebase mailer asks the Identity Toolkit to SEND (no returnOobLink) and drops an unauthorised continue URL', async () => {
  const posts = [];
  const mailer = AE.createFirebaseMailer({
    accessToken: async () => 'access-1',
    fetchImpl: async (url, opts) => {
      const body = JSON.parse(opts.body);
      posts.push({ url, auth: opts.headers.Authorization, body });
      if (body.continueUrl) return { ok: false, status: 400, async json() { return { error: { message: 'UNAUTHORIZED_DOMAIN : Domain not allowlisted' } }; } };
      return { ok: true, status: 200, async json() { return { email: body.email }; } };
    }
  });
  await mailer.send({ email: 'alice.old@gmail.com', newEmail: 'alice.new@gmail.com', continueUrl: 'https://polymathlc.github.io/anskey/?emailChanged=1' });
  assert.equal(posts.length, 2);
  assert.match(posts[0].url, /projects\/mathgen--app\/accounts:sendOobCode$/);
  assert.equal(posts[0].auth, 'Bearer access-1');
  assert.equal(posts[0].body.requestType, 'VERIFY_AND_CHANGE_EMAIL');
  assert.equal(posts[0].body.returnOobLink, undefined, 'returnOobLink would stop Firebase sending the email');
  assert.equal(posts[1].body.continueUrl, undefined);

  const failing = AE.createFirebaseMailer({ accessToken: async () => 'a', fetchImpl: async () => ({ ok: false, status: 400, async json() { return { error: { message: 'EMAIL_EXISTS' } }; } }) });
  await assert.rejects(failing.send({ email: 'a@b.com', newEmail: 'c@d.com' }), e => e.code === 'EMAIL_EXISTS');
  await assert.rejects(failing.link({ email: 'a@b.com', newEmail: 'c@d.com' }), /link_unavailable/);
});

test('the deployment entry point exports the service', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.js'), 'utf8');
  assert.match(src, /exports\.ansKeyAccountEmail = onRequest\(/);
  assert.match(src, /createFirebaseMailer\(\{ accessToken: projectAccessToken, adminAuth: getAuth\(\) \}\)/);
});
