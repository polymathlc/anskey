'use strict';
// 🎥 The live class's token and switch service. A fake Firestore and a fake
// LiveKit server API stand in, so every rule can be watched: who may open the
// class, what a student's token lets them do, that the secret is never
// stored or returned in the clear, and that a removed student stays out.
const test = require('node:test'), assert = require('node:assert/strict');
const lc = require('../live-class');
const { APP_ID, TEACHER_EMAIL } = require('../live-service');

const MASTER = 'master-secret-from-secret-manager-0123456789';
const SECRET = 'LiveKitApiSecretValue0123456789abcdef';
const teacherUser = { uid: 'teacher', email: TEACHER_EMAIL, email_verified: true, firebase: { sign_in_provider: 'google.com' } };
const studentUser = { uid: 'kid1', email: 'kid@example.com', name: 'Google Name', email_verified: true, firebase: { sign_in_provider: 'google.com' } };

const ROSTER = {
  'officeFamilies/famA': { status: 'active', email: 'tan@example.com', students: [
    { id: 'sA1', name: 'Amy Tan', level: 'P5', status: 'active', classes: [{ slotId: 'WED-2', mode: 'Online' }] },
    { id: 'sA2', name: 'Ben Tan', level: 'P3', status: 'left', classes: [{ slotId: 'WED-2' }] }
  ] },
  'officeFamilies/famB': { status: 'active', students: [
    { id: 'sB1', name: 'Ethan Lim', level: 'P5', status: 'active', classes: [{ slotId: 'WED-2' }] }
  ] },
  'officeFamilies/famC': { status: 'active', students: [
    { id: 'sC1', name: 'Ethan Lim', level: 'P6', status: 'active', classes: [{ slotId: 'FRI-2' }] },
    { id: 'sC2', name: 'Zoe Ng', level: 'P6', status: 'active', classes: [{ slotId: 'FRI-2' }, { custom: true, label: 'Holiday camp' }] }
  ] },
  'officeFamilies/famD': { status: 'withdrawn', lastMonth: '2020-01', students: [
    { id: 'sD1', name: 'Gone Away', level: 'P5', status: 'active', classes: [{ slotId: 'WED-2' }] }
  ] },
  'officeFamilies/famE': { status: 'paused', pauseFrom: '2020-01', students: [
    { id: 'sE1', name: 'On Pause', level: 'P5', status: 'active', classes: [{ slotId: 'WED-2' }] }
  ] },
  'schedule_config/main': { slots: { 'WED-2': { level: 'P5', subject: 'Science' }, 'FRI-2': { level: 'P6', subject: 'Science' } } }
};
const SLOT = 'WED-2';
// Wednesday 13 January 2027, 4:55pm in Singapore: five minutes before WED-2.
const WED_1655 = Date.UTC(2027, 0, 13, 8, 55);
function fakeDb(initial = ROSTER) {
  const store = new Map(Object.entries(initial));
  const writes = [];
  function ref(path) {
    return {
      path,
      async get() { const d = store.get(path); return { exists: d !== undefined, data: () => (d === undefined ? undefined : JSON.parse(JSON.stringify(d))) }; },
      async set(v, opts) {
        writes.push([path, v]);
        const next = JSON.parse(JSON.stringify(v));
        // { merge: true } merges maps the way Firestore does (deeply).
        const merge = (a, b) => { for (const k of Object.keys(b)) { a[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], b[k]) : b[k]; } return a; };
        store.set(path, opts && opts.merge && store.has(path) ? merge(JSON.parse(JSON.stringify(store.get(path))), next) : next);
      },
      collection(name) { return coll(path + '/' + name); }
    };
  }
  function coll(path) {
    return {
      doc: id => ref(path + '/' + id),
      async get() {
        const docs = [...store.entries()].filter(([k]) => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/'))
          .map(([k, v]) => ({ id: k.slice(path.length + 1), data: () => JSON.parse(JSON.stringify(v)) }));
        return { forEach: fn => docs.forEach(fn), size: docs.length };
      }
    };
  }
  return { store, writes, collection: coll };
}

function fakeLiveKit() {
  const calls = [];
  let participants = [];
  let refuse = 0;
  const fetchImpl = async (url, init) => {
    const method = url.split('/').pop();
    const auth = init.headers.Authorization.replace(/^Bearer /, '');
    const claims = lc.readAccessToken(auth, SECRET);
    calls.push({ url, method, body: JSON.parse(init.body), claims });
    if (refuse) return { ok: false, status: refuse, text: async () => JSON.stringify({ code: 'unauthenticated', msg: 'invalid token' }) };
    if (!claims) return { ok: false, status: 401, text: async () => '{"code":"unauthenticated"}' };
    if (method === 'ListParticipants') return { ok: true, status: 200, text: async () => JSON.stringify({ participants }) };
    return { ok: true, status: 200, text: async () => '{}' };
  };
  return { calls, fetchImpl, setParticipants: p => { participants = p; }, refuse: s => { refuse = s; } };
}

function harness({ db = fakeDb(), user = teacherUser, appId = APP_ID, lk = fakeLiveKit(), clock = { t: WED_1655 } } = {}) {
  const reports = [];
  const minted = [];
  const current = { user };
  const service = lc.createLiveClassService({
    auth: { async verifyIdToken() { if (current.user instanceof Error) throw current.user; return current.user; },
      async getUserByEmail() { return { uid: 'teacher', emailVerified: true }; },
      async createCustomToken(uid, claims) { minted.push({ uid, claims }); return 'custom.' + uid + '.' + JSON.stringify(claims); } },
    appCheck: { async verifyToken() { return { appId }; } },
    db, master: () => MASTER, fetchImpl: lk.fetchImpl, now: () => clock.t, report: c => reports.push(c)
  });
  async function call(body, opts = {}) {
    if (opts.as) current.user = opts.as;
    const headers = { origin: 'https://polymathlc.github.io', authorization: 'Bearer x', 'x-firebase-appcheck': 'ac', 'content-type': 'application/json', ...opts.headers };
    const req = { body, method: opts.method || 'POST', rawBody: Buffer.from(JSON.stringify(body || {})), get: n => headers[n.toLowerCase()] };
    const res = { headers: {}, statusCode: 200, set(k, v) { this.headers[k] = v; return this; }, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; }, send(v) { this.body = v; return this; } };
    await service.handler(req, res);
    return res;
  }
  return { call, db, lk, clock, reports, current, minted };
}

const KEYS = { action: 'configure', url: 'wss://polymath-abc.livekit.cloud', apiKey: 'APIabc123XYZ', apiSecret: SECRET };

test('URLs: LiveKit Cloud and local servers only, cleaned to one form', () => {
  assert.equal(lc.cleanUrl('wss://polymath-abc.livekit.cloud'), 'wss://polymath-abc.livekit.cloud');
  assert.equal(lc.cleanUrl(' wss://polymath-abc.livekit.cloud/ '), 'wss://polymath-abc.livekit.cloud');
  assert.equal(lc.cleanUrl('https://polymath-abc.livekit.cloud'), 'wss://polymath-abc.livekit.cloud');
  assert.equal(lc.cleanUrl('ws://localhost:7880'), 'ws://localhost:7880');
  assert.equal(lc.cleanUrl('http://127.0.0.1:7880'), 'ws://127.0.0.1:7880');
  assert.equal(lc.cleanUrl('ws://evil.example.com'), '', 'plain ws only on this machine');
  assert.equal(lc.cleanUrl('wss://user:pw@x.livekit.cloud'), '');
  assert.equal(lc.cleanUrl('wss://x.livekit.cloud?token=1'), '');
  assert.equal(lc.cleanUrl('javascript:alert(1)'), '');
  assert.equal(lc.cleanUrl(''), '');
  assert.equal(lc.httpBase('wss://a.livekit.cloud'), 'https://a.livekit.cloud');
  assert.equal(lc.httpBase('ws://localhost:7880'), 'http://localhost:7880');
});

test('keys, secrets, names and identities are cleaned', () => {
  assert.equal(lc.cleanKey('APIabc123'), 'APIabc123');
  assert.equal(lc.cleanKey('API abc'), '');
  assert.equal(lc.cleanSecret('short'), '');
  assert.equal(lc.cleanSecret(SECRET), SECRET);
  assert.equal(lc.cleanSecret('has space in the middle of it'), '');
  assert.equal(lc.maskKey('APIabc123XYZ'), 'API•••XYZ');
  assert.equal(lc.cleanName('  Amy\n\tTan  ', 'x'), 'Amy Tan');
  assert.equal(lc.cleanName('', 'Student'), 'Student');
  assert.equal(lc.cleanName('x'.repeat(200)).length, lc.LIVE_CLASS_LIMITS.nameMax);
  assert.equal(lc.cleanIdentity('r:abc_1-2'), 'r:abc_1-2');
  assert.equal(lc.cleanIdentity('g:x'), 'g:x');
  assert.equal(lc.cleanIdentity('s:abc'), '');
  assert.equal(lc.cleanIdentity('x:abc'), '');
  assert.equal(lc.cleanIdentity('s:a b'), '');
});

test('access tokens are HS256 JWTs LiveKit can read', () => {
  const tok = lc.signAccessToken({ apiKey: 'K', apiSecret: SECRET, identity: 's:u', name: 'Amy', ttlSeconds: 3600, now: 1000_000, video: lc.grantsFor('student', 'r1'), attributes: { role: 'student' } });
  const parts = tok.split('.');
  assert.equal(parts.length, 3);
  assert.deepEqual(JSON.parse(lc.b64urlDecode(parts[0])), { alg: 'HS256', typ: 'JWT' });
  const claims = lc.readAccessToken(tok, SECRET);
  assert.equal(claims.iss, 'K');
  assert.equal(claims.sub, 's:u');
  assert.equal(claims.name, 'Amy');
  assert.equal(claims.exp - claims.nbf, 3600 + 10);
  assert.equal(claims.video.room, 'r1');
  assert.equal(lc.readAccessToken(tok, 'wrong-secret-wrong-secret'), null, 'a wrong secret does not verify');
});

test('grants: a student can never share a screen or administer the room', () => {
  const s = lc.grantsFor('student', 'r');
  assert.deepEqual(s.canPublishSources, ['camera', 'microphone']);
  assert.equal(s.roomAdmin, undefined);
  assert.equal(s.canUpdateOwnMetadata, false);
  assert.equal(s.canPublishData, true);
  const t = lc.grantsFor('teacher', 'r');
  assert.equal(t.roomAdmin, true);
  assert.equal(t.canPublishSources, undefined, 'the teacher may share a screen');
});

test('the secret at rest is sealed, and opens only with the same master', () => {
  const sealed = lc.sealSecret(SECRET, MASTER);
  assert.ok(!JSON.stringify(sealed).includes(SECRET));
  assert.equal(lc.openSecret(sealed, MASTER), SECRET);
  assert.equal(lc.openSecret(sealed, MASTER + 'x'), '', 'a rotated master cannot read it');
  const tampered = { ...sealed, data: Buffer.from('nope').toString('base64') };
  assert.equal(lc.openSecret(tampered, MASTER), '');
  assert.throws(() => lc.sealSecret(SECRET, ''), /not ready/);
});

test('epochs only ever move forward', () => {
  assert.equal(lc.nextEpoch(0, 500), 500);
  assert.equal(lc.nextEpoch(900, 500), 901);
  assert.equal(lc.roomFor(5), 'polymath-class-5');
});

test('requests: origin, method, JSON and known actions only', async () => {
  const h = harness();
  assert.equal((await h.call({ action: 'status' }, { headers: { origin: 'https://evil.example' } })).statusCode, 403);
  assert.equal((await h.call(null, { method: 'OPTIONS' })).statusCode, 204);
  assert.equal((await h.call({ action: 'status' }, { method: 'GET' })).statusCode, 405);
  assert.equal((await h.call({ action: 'status' }, { headers: { 'content-type': 'text/plain' } })).statusCode, 415);
  assert.equal((await h.call({ action: 'hack' })).statusCode, 400);
  assert.equal((await h.call({ action: 'status' }, { headers: { authorization: '' } })).statusCode, 401);
});

const anonUser = { uid: 'anon1', firebase: { sign_in_provider: 'anonymous' } };
test('App Check is required; a device with no Google account is a student', async () => {
  const h1 = harness({ appId: 'other' });
  assert.equal((await h1.call({ action: 'status' })).body.error.code, 'app_check_required');
  const h2 = harness({ user: anonUser });
  const st = await h2.call({ action: 'status' });
  assert.equal(st.statusCode, 200);
  assert.equal(st.body.role, 'student');
  const h3 = harness({ user: { ...teacherUser, firebase: { sign_in_provider: 'anonymous' } } });
  assert.equal((await h3.call({ action: 'open' })).body.error.code, 'teacher_only');
});

test('roster lists: this slot first in full names, make-up grouped by slot, duplicates told apart', () => {
  const fams = Object.entries(ROSTER).filter(([k]) => k.startsWith('officeFamilies/')).map(([k, v]) => ({ ...v, id: k.split('/')[1] }));
  const students = lc.enrolledStudents(fams, '2026-11');
  assert.deepEqual(students.map(s => s.id).sort(), ['famA_sA1', 'famB_sB1', 'famC_sC1', 'famC_sC2'], 'withdrawn, paused and left are not offered');
  const sched = ROSTER['schedule_config/main'];
  const l = lc.rosterLists(students, SLOT, sched);
  assert.deepEqual(l.students.map(s => s.label), ['Amy Tan', 'Ethan Lim (P5)']);
  assert.equal(l.others.length, 1);
  assert.equal(l.others[0].slot, 'FRI-2');
  assert.equal(l.others[0].label, 'Fri 5:00pm · P6 Science');
  assert.deepEqual(l.others[0].students.map(s => s.label), ['Ethan Lim (P6)', 'Zoe Ng']);
  assert.ok(!JSON.stringify(l).includes('tan@example.com'), 'a parent address never leaves the server');
  assert.deepEqual(lc.slotChoices(students, sched), [{ slot: 'WED-2', label: 'Wed 5:00pm · P5 Science', count: 2 }, { slot: 'FRI-2', label: 'Fri 5:00pm · P6 Science', count: 2 }]);
  assert.equal(lc.familyState({ status: 'withdrawn', lastMonth: '2026-12' }, '2026-11'), 'active', 'withdrawing at the end of next month still attends');
  assert.equal(lc.familyState({ status: 'paused', pauseFrom: '2026-12' }, '2026-11'), 'active');
  assert.equal(lc.rosterKey('fam_1', 's2'), '', 'an id holding the separator is refused');
  assert.deepEqual(lc.splitRosterKey('famA_sA1'), { familyId: 'famA', studentId: 'sA1' });
});

test('only the teacher may set up, open, close, mute or remove', async () => {
  const h = harness({ user: studentUser });
  for (const action of ['config', 'configure', 'forget', 'open', 'close', 'mute', 'remove', 'readmit']) {
    const res = await h.call({ ...KEYS, action });
    assert.equal(res.statusCode, 403, action);
    assert.equal(res.body.error.code, 'teacher_only');
  }
  assert.equal(h.db.writes.length, 0);
});

test('configure: the keys are checked with LiveKit, then stored sealed', async () => {
  const h = harness();
  const res = await h.call(KEYS);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.configured, true);
  assert.equal(res.body.apiKey, 'API•••XYZ');
  assert.ok(!JSON.stringify(res.body).includes(SECRET), 'the secret never comes back');
  assert.equal(h.lk.calls[0].method, 'ListRooms');
  assert.equal(h.lk.calls[0].url, 'https://polymath-abc.livekit.cloud/twirp/livekit.RoomService/ListRooms');
  const stored = h.db.store.get('ansKeyLiveClassConfig/livekit');
  assert.equal(stored.url, KEYS.url);
  assert.ok(!JSON.stringify(stored).includes(SECRET), 'the secret is never stored in the clear');
  const cfg = await h.call({ action: 'config' });
  assert.equal(cfg.body.configured, true);
  assert.equal(cfg.body.readable, true);
});

test('configure: refused keys never replace working ones', async () => {
  const h = harness();
  await h.call(KEYS);
  const before = JSON.stringify(h.db.store.get('ansKeyLiveClassConfig/livekit'));
  h.lk.refuse(401);
  const res = await h.call({ ...KEYS, apiKey: 'APIother999' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'keys_refused');
  assert.equal(JSON.stringify(h.db.store.get('ansKeyLiveClassConfig/livekit')), before);
});

test('configure: bad fields are refused in words', async () => {
  const h = harness();
  assert.equal((await h.call({ ...KEYS, url: 'http://example.com' })).body.error.code, 'bad_url');
  assert.equal((await h.call({ ...KEYS, apiKey: 'a b' })).body.error.code, 'bad_key');
  assert.equal((await h.call({ ...KEYS, apiSecret: 'x' })).body.error.code, 'bad_secret');
});

test('a student cannot join before the class opens', async () => {
  const h = harness();
  await h.call(KEYS);
  assert.equal((await h.call({ action: 'roster' }, { as: studentUser })).body.error.code, 'class_closed');
  const res = await h.call({ action: 'token', pick: { kind: 'roster', id: 'famA_sA1' } }, { as: studentUser });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'class_closed');
});

test('open → student token → close', async () => {
  const db = fakeDb(ROSTER);
  const h = harness({ db });
  await h.call(KEYS);
  const opened = await h.call({ action: 'open', slot: SLOT });
  assert.equal(opened.body.slot, SLOT);
  assert.equal(opened.statusCode, 200);
  assert.equal(opened.body.open, true);
  assert.match(opened.body.room, /^polymath-class-\d+$/);
  const tclaims = lc.readAccessToken(opened.body.token, SECRET);
  assert.equal(tclaims.sub, 't:teacher');
  assert.equal(tclaims.video.roomAdmin, true);
  assert.equal(db.store.get('liveClassRooms/main').open, true, 'the mirror lights the badge');

  const roster = await h.call({ action: 'roster' }, { as: studentUser });
  assert.equal(roster.body.students.length, 2);
  assert.equal(roster.body.slotLabel, 'Wed 5:00pm · P5 Science');
  const slots = await h.call({ action: 'slots' }, { as: teacherUser });
  assert.equal(slots.body.slots[0].slot, 'WED-2');
  h.current.user = studentUser;
  assert.equal((await h.call({ action: 'token' }, { as: studentUser })).body.error.code, 'pick_required', 'no token without a confirmed name');
  const tok = await h.call({ action: 'token', pick: { kind: 'roster', id: 'famA_sA1' } }, { as: studentUser });
  assert.equal(tok.statusCode, 200);
  assert.equal(tok.body.identity, 'r:famA_sA1');
  assert.equal(tok.body.name, 'Amy Tan', 'the roster name, not the Google name');
  assert.equal(tok.body.rosterId, 'famA_sA1');
  const claims = lc.readAccessToken(tok.body.token, SECRET);
  assert.equal(claims.sub, 'r:famA_sA1');
  assert.equal(claims.video.room, opened.body.room);
  assert.equal(claims.video.roomAdmin, undefined);
  assert.deepEqual(claims.attributes, { role: 'student', kind: 'roster', uid: 'kid1', rosterId: 'famA_sA1', level: 'P5', home: 'Wed 5:00pm · P5 Science' });

  const st = await h.call({ action: 'status' }, { as: studentUser });
  assert.equal(st.body.open, true);
  assert.equal(st.body.slot, SLOT);
  assert.equal(st.body.configured, undefined, 'a student is not told about the keys');

  h.clock.t += 60000;
  const closed = await h.call({ action: 'close' }, { as: teacherUser });
  assert.equal(closed.body.open, false);
  assert.ok(h.lk.calls.some(c => c.method === 'DeleteRoom' && c.body.room === opened.body.room));
  assert.equal(db.store.get('liveClassRooms/main').open, false);
  assert.equal((await h.call({ action: 'token', pick: { kind: 'roster', id: 'famA_sA1' } }, { as: studentUser })).body.error.code, 'class_closed');
});

test('make-up and trial picks', async () => {
  const h = harness({ user: teacherUser });
  await h.call(KEYS);
  await h.call({ action: 'open', slot: SLOT });
  assert.equal((await h.call({ action: 'token', pick: { kind: 'roster', id: 'famC_sC2' } }, { as: anonUser })).body.error.code, 'wrong_list');
  const mk = await h.call({ action: 'token', pick: { kind: 'makeup', id: 'famC_sC2' } }, { as: anonUser });
  assert.equal(mk.statusCode, 200);
  assert.equal(mk.body.kind, 'makeup');
  assert.equal(lc.readAccessToken(mk.body.token, SECRET).attributes.home, 'Fri 5:00pm · P6 Science');
  assert.equal((await h.call({ action: 'token', pick: { kind: 'roster', id: 'famD_sD1' } }, { as: anonUser })).body.error.code, 'not_on_roster');
  assert.equal((await h.call({ action: 'token', pick: { kind: 'trial', name: ' ' } }, { as: anonUser })).body.error.code, 'name_required');
  const tr = await h.call({ action: 'token', pick: { kind: 'trial', name: 'Bella  Koh' } }, { as: anonUser });
  assert.equal(tr.body.identity, 'g:anon1');
  assert.equal(tr.body.name, 'Bella Koh');
  assert.equal(tr.body.rosterId, '');
});

test('a name already in the class on another device is asked about first', async () => {
  const h = harness({ user: teacherUser });
  await h.call(KEYS);
  await h.call({ action: 'open', slot: SLOT });
  h.lk.setParticipants([{ identity: 'r:famA_sA1', attributes: { uid: 'someone-else' }, tracks: [] }]);
  const res = await h.call({ action: 'token', pick: { kind: 'roster', id: 'famA_sA1' } }, { as: anonUser });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'already_in');
  assert.match(res.body.error.message, /Amy Tan is already in the class/);
  assert.equal((await h.call({ action: 'token', pick: { kind: 'roster', id: 'famA_sA1' }, takeover: true }, { as: anonUser })).statusCode, 200);
  h.lk.setParticipants([{ identity: 'r:famA_sA1', attributes: { uid: 'anon1' }, tracks: [] }]);
  assert.equal((await h.call({ action: 'token', pick: { kind: 'roster', id: 'famA_sA1' } }, { as: anonUser })).statusCode, 200);
});

test('opening again keeps the same room; fresh starts a new one', async () => {
  const h = harness();
  await h.call(KEYS);
  const a = await h.call({ action: 'open' });
  h.clock.t += 5000;
  const b = await h.call({ action: 'open' });
  assert.equal(b.body.room, a.body.room, 'a reloaded teacher lands in the same lesson');
  const c = await h.call({ action: 'open', fresh: true });
  assert.notEqual(c.body.room, a.body.room);
  assert.ok(c.body.epoch > a.body.epoch);
});

test('a removed student stays out until let back in', async () => {
  const h = harness();
  await h.call(KEYS);
  await h.call({ action: 'open', slot: SLOT });
  const pick = { kind: 'roster', id: 'famA_sA1' };
  const rm = await h.call({ action: 'remove', identity: 'r:famA_sA1' });
  assert.equal(rm.statusCode, 200);
  assert.ok(h.lk.calls.some(c => c.method === 'RemoveParticipant' && c.body.identity === 'r:famA_sA1'));
  assert.equal((await h.call({ action: 'token', pick }, { as: studentUser })).body.error.code, 'removed');
  await h.call({ action: 'readmit', identity: 'r:famA_sA1' }, { as: teacherUser });
  assert.equal((await h.call({ action: 'token', pick }, { as: studentUser })).statusCode, 200);
  await h.call({ action: 'remove', identity: 'r:famA_sA1' }, { as: teacherUser });
  await h.call({ action: 'open', fresh: true, slot: SLOT });
  assert.equal((await h.call({ action: 'token', pick }, { as: studentUser })).statusCode, 200);
});

test('the teacher can never be removed', async () => {
  const h = harness();
  await h.call(KEYS);
  await h.call({ action: 'open' });
  assert.equal((await h.call({ action: 'remove', identity: 't:teacher' })).statusCode, 400);
});

test('mute all: every student microphone, never the teacher', async () => {
  const h = harness();
  await h.call(KEYS);
  await h.call({ action: 'open' });
  h.lk.setParticipants([
    { identity: 't:teacher', tracks: [{ sid: 'TR_t', source: 'MICROPHONE' }] },
    { identity: 'r:a', tracks: [{ sid: 'TR_a', source: 'MICROPHONE' }, { sid: 'TR_ac', source: 'CAMERA' }] },
    { identity: 'g:b', tracks: [{ sid: 'TR_b', source: 2 }] },
    { identity: 'r:c', tracks: [{ sid: 'TR_c', source: 'MICROPHONE', muted: true }] }
  ]);
  const res = await h.call({ action: 'mute', all: true });
  assert.equal(res.body.muted, 2);
  const muted = h.lk.calls.filter(c => c.method === 'MutePublishedTrack').map(c => c.body.track_sid).sort();
  assert.deepEqual(muted, ['TR_a', 'TR_b']);
  const one = await h.call({ action: 'mute', identity: 'r:a', source: 'camera' });
  assert.equal(one.body.muted, 1);
});

test('keys sealed under another master say so instead of failing mutely', async () => {
  const db = fakeDb();
  const h = harness({ db });
  await h.call(KEYS);
  const sealed = db.store.get('ansKeyLiveClassConfig/livekit');
  sealed.secret = lc.sealSecret(SECRET, 'a-different-master-secret-xyz');
  db.store.set('ansKeyLiveClassConfig/livekit', sealed);
  const res = await h.call({ action: 'open' });
  assert.equal(res.body.error.code, 'keys_unreadable');
  assert.equal((await h.call({ action: 'config' })).body.readable, false);
});

test('a failed mirror write never refuses the class', async () => {
  const db = fakeDb();
  const real = db.collection;
  db.collection = name => name === 'liveClassRooms' ? { doc: () => ({ async set() { throw new Error('denied'); }, async get() { return { exists: false }; } }) } : real(name);
  const h = harness({ db });
  await h.call(KEYS);
  const res = await h.call({ action: 'open' });
  assert.equal(res.statusCode, 200);
  assert.ok(h.reports.includes('live_class_mirror_failed'));
});

test('🚪 the lesson-time gate: Singapore time, early minutes, other days', () => {
  const c = lc.sgClock(WED_1655);
  assert.equal(c.code, 'WED');
  assert.equal(c.minutes, 16 * 60 + 55);
  assert.deepEqual(lc.slotTimes('SAT-2'), { code: 'SAT', dayName: 'Saturday', start: 660, end: 765, startLabel: '11:00am', endLabel: '12:45pm' });
  assert.equal(lc.clockLabel(16 * 60 + 50), '4:50pm');
  assert.equal(lc.clockLabel(9 * 60), '9:00am');
  assert.equal(lc.joinGate('WED-2', WED_1655, 10).open, true, 'inside the ten minutes');
  const early = lc.joinGate('WED-2', WED_1655, 4);
  assert.equal(early.open, false);
  assert.equal(early.reason, 'early');
  assert.equal(early.startsAt, Date.UTC(2027, 0, 13, 9, 0));
  assert.equal(early.opensAt, Date.UTC(2027, 0, 13, 8, 56));
  assert.match(early.message, /starts at 5:00pm\. You can join from 4:56pm/);
  assert.equal(lc.joinGate('WED-2', Date.UTC(2027, 0, 13, 13, 30), 10).open, true, 'a lesson running over is still open');
  const fri = lc.joinGate('FRI-2', WED_1655, 10);
  assert.equal(fri.reason, 'other_day');
  assert.equal(fri.startsAt, Date.UTC(2027, 0, 15, 9, 0));
  assert.match(fri.message, /Friday at 5:00pm/);
  assert.equal(lc.joinGate('FRI-2', WED_1655, 10, true).open, true, 'the teacher let them in');
  assert.equal(lc.joinGate('', WED_1655, 10).open, true, 'no slot, no gate');
  assert.equal(lc.cleanEarly(-5), 0);
  assert.equal(lc.cleanEarly(999), lc.EARLY_MAX);
  assert.equal(lc.cleanEarly('x'), lc.EARLY_DEFAULT);
  assert.deepEqual(lc.cleanSettings(null), { earlyMin: 10, absentMode: 'auto', absentAfter: 10, catchUp: true });
  const later = lc.laterLessonToday({ slots: ['WED-3', 'SAT-1'] }, 'WED-2', WED_1655, 10, {});
  assert.equal(later.slot, 'WED-3');
  assert.match(later.message, /starts at 7:00pm/);
  assert.equal(lc.laterLessonToday({ slots: ['WED-1', 'SAT-1'] }, 'WED-2', WED_1655, 10, {}), null, 'an earlier lesson today is no reason to wait');
});

test('🚪 a student waits for the lesson time; the teacher can let them in', async () => {
  const clock = { t: Date.UTC(2027, 0, 13, 8, 30) };   // 4:30pm Wednesday
  const db = fakeDb(ROSTER);
  const h = harness({ db, clock });
  await h.call(KEYS);
  const opened = await h.call({ action: 'open', slot: SLOT });
  assert.equal(opened.body.gate.open, false, 'the teacher sees the door is still shut');
  const roster = await h.call({ action: 'roster' }, { as: anonUser });
  assert.equal(roster.statusCode, 200);
  assert.equal(roster.body.gate.open, false);
  assert.equal(roster.body.students.length, 0, 'no names before the lesson time');
  assert.equal(roster.body.gate.opensAt, Date.UTC(2027, 0, 13, 8, 50));
  const st = await h.call({ action: 'status' }, { as: anonUser });
  assert.equal(st.body.gate.open, false);
  const tok = await h.call({ action: 'token', pick: { kind: 'roster', id: 'famA_sA1' } }, { as: anonUser });
  assert.equal(tok.statusCode, 403);
  assert.equal(tok.body.error.code, 'not_yet');
  assert.match(tok.body.error.message, /4:50pm/);
  // The teacher changes how early students may come in.
  assert.equal((await h.call({ action: 'settings', earlyMin: 45 }, { as: anonUser })).body.error.code, 'teacher_only');
  const set = await h.call({ action: 'settings', earlyMin: 45 }, { as: teacherUser });
  assert.equal(set.body.settings.earlyMin, 45);
  assert.equal(set.body.gate.open, true);
  assert.equal((await h.call({ action: 'status' }, { as: teacherUser })).body.settings.earlyMin, 45, 'kept for the next class');
  await h.call({ action: 'settings', earlyMin: 10 }, { as: teacherUser });
  assert.equal((await h.call({ action: 'token', pick: { kind: 'roster', id: 'famA_sA1' } }, { as: anonUser })).body.error.code, 'not_yet');
  // Let them in now.
  assert.equal((await h.call({ action: 'letin', on: true }, { as: anonUser })).body.error.code, 'teacher_only');
  const li = await h.call({ action: 'letin', on: true }, { as: teacherUser });
  assert.equal(li.body.letIn, true);
  assert.equal(db.store.get('liveClassRooms/main').letIn, true, 'the mirror tells waiting students to look again');
  const ok = await h.call({ action: 'token', pick: { kind: 'roster', id: 'famA_sA1' } }, { as: anonUser });
  assert.equal(ok.statusCode, 200);
  // A new class starts with the door shut again.
  await h.call({ action: 'open', slot: SLOT, fresh: true }, { as: teacherUser });
  assert.equal((await h.call({ action: 'token', pick: { kind: 'roster', id: 'famA_sA1' } }, { as: anonUser })).body.error.code, 'not_yet');
});

test('🚪 a make-up pick whose own lesson is later today is told to wait for it', async () => {
  const roster = JSON.parse(JSON.stringify(ROSTER));
  roster['officeFamilies/famC'].students[1].classes = [{ slotId: 'WED-3' }];
  const db = fakeDb(roster);
  const h = harness({ db });
  await h.call(KEYS);
  await h.call({ action: 'open', slot: SLOT });
  const mk = await h.call({ action: 'token', pick: { kind: 'makeup', id: 'famC_sC2' } }, { as: anonUser });
  assert.equal(mk.statusCode, 403);
  assert.equal(mk.body.error.code, 'not_yet');
  assert.match(mk.body.error.message, /Your lesson today .* starts at 7:00pm/);
  const other = await h.call({ action: 'token', pick: { kind: 'makeup', id: 'famC_sC1' } }, { as: anonUser });
  assert.equal(other.statusCode, 200, 'a Friday child may make up on Wednesday');
  await h.call({ action: 'letin', on: true }, { as: teacherUser });
  assert.equal((await h.call({ action: 'token', pick: { kind: 'makeup', id: 'famC_sC2' } }, { as: anonUser })).statusCode, 200, 'the teacher can still let them in');
});

/* ---------- 🔗 personal links and PINs (v1.210.0) ---------- */

test('🔗 a link code is checked, not trusted: MAC, generation and shape', () => {
  const code = lc.passCode('famA_sA1', 0, MASTER);
  assert.match(code, /^famA_sA1\.0\.[A-Za-z0-9_-]{16}$/);
  assert.equal(lc.checkPass(code, {}, MASTER), 'famA_sA1', 'generation 0 needs no entry yet');
  assert.equal(lc.checkPass(code, { famA_sA1: { gen: 0 } }, MASTER), 'famA_sA1');
  assert.equal(lc.checkPass(code, { famA_sA1: { gen: 1 } }, MASTER), null, 'a replaced link stops working');
  assert.equal(lc.checkPass(code, {}, 'another-master-secret-0123456789'), null, 'another server cannot make one');
  const forged = code.replace(/\.[^.]+$/, '.' + 'A'.repeat(16));
  assert.equal(lc.checkPass(forged, {}, MASTER), null);
  assert.equal(lc.checkPass('famB_sB1' + code.slice(8), {}, MASTER), null, 'a MAC is for one child only');
  assert.equal(lc.checkPass('', {}, MASTER), null);
  assert.equal(lc.checkPass('famA_sA1.0', {}, MASTER), null);
  assert.equal(lc.checkPass('<script>.0.' + 'a'.repeat(16), {}, MASTER), null);
  assert.equal(lc.passCode('not a key', 0, MASTER), '');
});

test('🔗 PINs: four digits, unique, never weak, the same on any run', () => {
  assert.equal(lc.cleanPin(' 12 34 '), '1234');
  assert.equal(lc.cleanPin('123'), '');
  assert.equal(lc.cleanPin('12a4'), '');
  const students = [];
  for (let i = 0; i < 400; i++) students.push({ id: 'fam' + i + '_s' + i });
  const { passes, changed } = lc.ensurePasses({}, students, MASTER, 1);
  assert.equal(changed, true);
  const pins = Object.values(passes).map(e => e.pin);
  assert.equal(pins.length, 400);
  assert.ok(pins.every(p => /^\d{4}$/.test(p)));
  assert.equal(new Set(pins).size, 400, 'no two children share a PIN');
  assert.ok(!pins.includes('1234') && !pins.includes('0000'));
  const again = lc.ensurePasses({}, students, MASTER, 2).passes;
  assert.deepEqual(Object.values(again).map(e => e.pin), pins, 'deterministic');
  const kept = lc.ensurePasses(passes, students.slice(0, 10), MASTER, 3);
  assert.equal(kept.changed, false, 'nothing new, nothing written');
  assert.equal(Object.keys(kept.passes).length, 400, 'a child who left keeps their link for when they come back');
  // A duplicate that somehow got stored is re-drawn rather than shared.
  const dup = { a_1: { gen: 0, pin: '5555', at: 0 }, b_2: { gen: 0, pin: '5821', at: 0 }, c_3: { gen: 0, pin: '5821', at: 0 } };
  const fixed = lc.ensurePasses(dup, [{ id: 'a_1' }, { id: 'b_2' }, { id: 'c_3' }], MASTER, 4).passes;
  assert.notEqual(fixed.b_2.pin, fixed.c_3.pin);
  assert.equal(lc.pinOwner('5821', fixed) !== '', true);
  assert.equal(lc.pinOwner('99', fixed), '');
});

test('🔗 wrong PINs are counted per account and in all, in ten-minute windows', () => {
  let tries = null;
  for (let i = 0; i < lc.PASS_LIMITS_PIN.perUid; i++) {
    const a = lc.pinTriesAllowed(tries, 'u1', 1000 + i);
    assert.equal(a.ok, true);
    tries = lc.pinTriesAfterMiss(a.window, 'u1');
  }
  assert.equal(lc.pinTriesAllowed(tries, 'u1', 2000).ok, false, 'one account: stopped');
  assert.equal(lc.pinTriesAllowed(tries, 'u2', 2000).ok, true, 'another account is not');
  assert.equal(lc.pinTriesAllowed(tries, 'u1', 1000 + lc.PASS_LIMITS_PIN.windowMs + 1).ok, true, 'a new window');
  const many = { win: 1000, total: lc.PASS_LIMITS_PIN.total, by: {} };
  assert.equal(lc.pinTriesAllowed(many, 'fresh', 2000).ok, false, 'many anonymous accounts cannot walk the PINs');
});

test('🔗 the teacher gets every child\'s link and PIN; students cannot', async () => {
  const h = harness();
  assert.equal((await h.call({ action: 'passes' }, { as: studentUser })).body.error.code, 'teacher_only');
  assert.equal((await h.call({ action: 'repass', id: 'famA_sA1' }, { as: anonUser })).body.error.code, 'teacher_only');
  const res = await h.call({ action: 'passes' }, { as: teacherUser });
  assert.equal(res.statusCode, 200);
  const names = res.body.students.map(s => s.name);
  assert.deepEqual(names, ['Amy Tan', 'Ethan Lim', 'Ethan Lim', 'Zoe Ng'], 'enrolled only, in week order');
  const amy = res.body.students[0];
  assert.equal(amy.id, 'famA_sA1');
  assert.match(amy.pin, /^\d{4}$/);
  assert.equal(lc.checkPass(amy.code, {}, MASTER), 'famA_sA1');
  assert.deepEqual(amy.slots, [{ slot: 'WED-2', label: 'Wed 5:00pm · P5 Science' }]);
  const stored = h.db.store.get('ansKeyLiveClassConfig/passes');
  assert.equal(stored.list.famA_sA1.pin, amy.pin);
  assert.ok(!JSON.stringify(stored).includes(MASTER));
  const writes = h.db.writes.length;
  await h.call({ action: 'passes' }, { as: teacherUser });
  assert.equal(h.db.writes.length, writes, 'nothing changed, nothing written');
  // A new link: the old one stops, the PIN changes.
  const re = await h.call({ action: 'repass', id: 'famA_sA1' }, { as: teacherUser });
  assert.equal(re.body.student.gen, 1);
  assert.notEqual(re.body.student.code, amy.code);
  assert.notEqual(re.body.student.pin, amy.pin);
  assert.equal((await h.call({ action: 'repass', id: 'famD_sD1' }, { as: teacherUser })).body.error.code, 'not_on_roster');
  assert.equal((await h.call({ action: 'repass', id: '../x' }, { as: teacherUser })).body.error.code, 'invalid_request');
});

test('🔗 a personal link: whose it is before the class, one tap in at lesson time', async () => {
  const h = harness();
  await h.call(KEYS);
  const amy = (await h.call({ action: 'passes' })).body.students[0];
  // Class not open yet: the link still says whose it is.
  const early = await h.call({ action: 'pass', code: amy.code }, { as: anonUser });
  assert.equal(early.statusCode, 200);
  assert.equal(early.body.open, false);
  assert.equal(early.body.me.name, 'Amy Tan');
  await h.call({ action: 'open', slot: SLOT }, { as: teacherUser });
  const me = await h.call({ action: 'pass', code: amy.code }, { as: anonUser });
  assert.equal(me.body.gate.open, true);
  assert.equal(me.body.me.kind, 'roster');
  assert.equal(me.body.code, amy.code);
  const tok = await h.call({ action: 'token', pick: { kind: 'pass', code: amy.code } }, { as: anonUser });
  assert.equal(tok.statusCode, 200);
  assert.equal(tok.body.identity, 'r:famA_sA1');
  assert.equal(tok.body.name, 'Amy Tan');
  assert.equal(tok.body.kind, 'roster');
  assert.equal((await h.call({ action: 'pass', code: amy.code }, { as: teacherUser })).body.error.code, 'teacher_pass');
  // Replaced: refused in words.
  await h.call({ action: 'repass', id: 'famA_sA1' }, { as: teacherUser });
  const old = await h.call({ action: 'token', pick: { kind: 'pass', code: amy.code } }, { as: anonUser });
  assert.equal(old.body.error.code, 'pass_unknown');
});

test('🔗 a link from another class joins as a make-up, and the door still applies', async () => {
  const h = harness();
  await h.call(KEYS);
  const zoe = (await h.call({ action: 'passes' })).body.students.find(s => s.name === 'Zoe Ng');
  await h.call({ action: 'open', slot: SLOT });
  const tok = await h.call({ action: 'token', pick: { kind: 'pass', code: zoe.code } }, { as: anonUser });
  assert.equal(tok.statusCode, 200);
  assert.equal(tok.body.kind, 'makeup');
  // Too early for the Wednesday lesson: the link is right, the door is shut.
  h.clock.t -= 40 * 60000;
  const shut = await h.call({ action: 'pass', code: zoe.code }, { as: anonUser });
  assert.equal(shut.body.gate.open, false);
  assert.equal((await h.call({ action: 'token', pick: { kind: 'pass', code: zoe.code } }, { as: anonUser })).body.error.code, 'not_yet');
});

test('🔗 a PIN: only while a class is open, and counted', async () => {
  const h = harness();
  await h.call(KEYS);
  const amy = (await h.call({ action: 'passes' })).body.students[0];
  assert.equal((await h.call({ action: 'pass', pin: amy.pin }, { as: anonUser })).body.error.code, 'class_closed', 'never tried against a closed class');
  await h.call({ action: 'open', slot: SLOT }, { as: teacherUser });
  const ok = await h.call({ action: 'pass', pin: amy.pin }, { as: anonUser });
  assert.equal(ok.body.me.name, 'Amy Tan');
  assert.equal(ok.body.code, amy.code, 'the device is handed its link for next time');
  const tok = await h.call({ action: 'token', pick: { kind: 'pin', pin: amy.pin } }, { as: anonUser });
  assert.equal(tok.body.identity, 'r:famA_sA1');
  assert.equal(tok.body.code, amy.code);
  const wrongPin = amy.pin === '5821' ? '5822' : '5821';
  let last = null;
  for (let i = 0; i < lc.PASS_LIMITS_PIN.perUid; i++) last = await h.call({ action: 'pass', pin: wrongPin }, { as: studentUser });
  assert.equal(last.body.error.code, 'pin_unknown');
  const stopped = await h.call({ action: 'pass', pin: amy.pin }, { as: studentUser });
  assert.equal(stopped.statusCode, 429, 'even the right PIN waits once an account has guessed too often');
  assert.equal(stopped.body.error.code, 'pin_wait');
});


/* ---------- 📖 Study Buddy from the same link (v1.211.0) ---------- */

test('📖 subjects, levels and the profile Study Buddy reads', () => {
  assert.deepEqual(lc.subjectWords('Maths & Science'), ['math', 'science']);
  assert.deepEqual(lc.subjectWords('Mathematics'), ['math']);
  assert.deepEqual(lc.subjectWords('English'), []);
  const sched = { slots: { A: { subject: 'Maths' }, B: { subject: 'Science' }, C: { subject: 'science' } } };
  assert.deepEqual(lc.slotSubjects(['A', 'B', 'X'], sched), ['math', 'science']);
  assert.deepEqual(lc.slotSubjects(['C'], sched), ['science']);
  assert.deepEqual(lc.slotSubjects(null, sched), []);
  assert.equal(lc.studySubject('P3', ['math']), 'science', 'P3 is Science only');
  assert.equal(lc.studySubject('P5', ['math', 'science']), 'both');
  assert.equal(lc.studySubject('P5', ['math']), 'math');
  assert.equal(lc.studySubject('P6', []), 'both', 'no subject named: the widest, never none');
  assert.equal(lc.studyLevel('p5'), 'P5');
  assert.equal(lc.studyLevel('Primary 4'), 'P4');
  assert.equal(lc.studyLevel('Pri 6'), 'P6');
  assert.equal(lc.studyUid('famA_sA1'), 'office-famA-sA1');
  assert.equal(lc.studyUid('../x'), '');
  const doc = lc.studyProfileDoc({ name: 'Amy Tan', level: 'P5', slots: ['A', 'B'] }, sched, 'famA_sA1', 1000, null);
  assert.equal(doc.subject, 'both');
  assert.equal(doc.officeId, 'famA_sA1');
  assert.equal(doc.levelSource, 'office');
  assert.equal(doc.tutorOnboard.v, 2, 'answers Study Buddy\'s first-sign-in questions');
  assert.equal(doc.tutorOnboard.enrolled, true);
  assert.equal(doc.tutorOnboard.payingFee, false, 'the centre\'s own child pays no app fee');
  assert.deepEqual(doc.tutorOnboard.students, [{ name: 'Amy Tan', level: 'P5', subject: 'both' }]);
  assert.equal(doc.createdAt, 1000);
  assert.equal(lc.studyProfileDoc({ name: 'Amy', level: 'P5', slots: [] }, sched, 'famA_sA1', 2000, { name: 'x' }).createdAt, undefined, 'never rewritten');
});

test('📖 origins: Ans Key, Study Buddy on github.io and the centre\'s domain, nothing that only looks like them', () => {
  assert.ok(lc.liveClassOrigin('https://polymathlc.github.io'));
  assert.ok(lc.liveClassOrigin('https://polymathlc.com.sg'));
  assert.ok(lc.liveClassOrigin('https://www.polymathlc.com.sg'));
  assert.ok(!lc.liveClassOrigin('https://polymathlc.com.sg.example'));
  assert.ok(!lc.liveClassOrigin('http://polymathlc.com.sg'));
  assert.ok(!lc.liveClassOrigin('https://evil.example'));
  assert.ok(!lc.liveClassOrigin(''));
});

test('📖 a personal link signs the child into Study Buddy as themselves, at any hour', async () => {
  const h = harness();
  const amy = (await h.call({ action: 'passes' }, { as: teacherUser })).body.students[0];
  // No class open, any time of day.
  h.clock.t = Date.UTC(2027, 0, 16, 2, 0);
  const res = await h.call({ action: 'study', code: amy.code }, { as: anonUser, headers: { origin: 'https://polymathlc.com.sg' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.uid, 'office-famA-sA1');
  assert.equal(res.body.me.name, 'Amy Tan');
  assert.equal(res.body.me.level, 'P5');
  assert.equal(res.body.me.subject, 'science', 'from her own lessons: WED-2 is Science');
  assert.equal(res.body.code, amy.code);
  assert.deepEqual(h.minted, [{ uid: 'office-famA-sA1', claims: { officePass: true, officeId: 'famA_sA1' } }]);
  assert.match(res.body.token, /^custom\.office-famA-sA1\./);
  const row = h.db.store.get('studentProfiles/office-famA-sA1');
  assert.equal(row.name, 'Amy Tan');
  assert.equal(row.subject, 'science');
  assert.equal(row.tutorOnboard.v, 2);
  assert.equal(typeof row.createdAt, 'number');
  // A second sign-in writes no new createdAt (it is a merge onto the row).
  await h.call({ action: 'study', code: amy.code }, { as: anonUser });
  const second = h.db.writes.filter(w => w[0] === 'studentProfiles/office-famA-sA1').pop()[1];
  assert.equal(second.createdAt, undefined);
  assert.equal(h.minted.length, 2);
  // Never the teacher, never a replaced link, never a child who left.
  assert.equal((await h.call({ action: 'study', code: amy.code }, { as: teacherUser })).body.error.code, 'teacher_pass');
  await h.call({ action: 'repass', id: 'famA_sA1' }, { as: teacherUser });
  assert.equal((await h.call({ action: 'study', code: amy.code }, { as: anonUser })).body.error.code, 'pass_unknown');
  assert.equal((await h.call({ action: 'study', code: 'nonsense' }, { as: anonUser })).body.error.code, 'pass_unknown');
  assert.equal(h.minted.length, 2, 'no token for a refusal');
});

test('📖 a Study Buddy PIN works without a class, in its own slower bucket', async () => {
  const h = harness();
  const list = (await h.call({ action: 'passes' }, { as: teacherUser })).body.students;
  const zoe = list.find(s => s.name === 'Zoe Ng');
  const ok = await h.call({ action: 'study', pin: zoe.pin }, { as: anonUser });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.uid, 'office-famC-sC2');
  assert.equal(ok.body.me.level, 'P6');
  const used = new Set(list.map(s => s.pin));
  let wrong = '5821'; while (used.has(wrong)) wrong = String(Number(wrong) + 1);
  let last = null;
  for (let i = 0; i < lc.STUDY_PIN_LIMITS.perUid; i++) last = await h.call({ action: 'study', pin: wrong }, { as: studentUser });
  assert.equal(last.body.error.code, 'pin_unknown');
  const stopped = await h.call({ action: 'study', pin: zoe.pin }, { as: studentUser });
  assert.equal(stopped.statusCode, 429);
  assert.equal(stopped.body.error.code, 'pin_wait');
  // Counted apart from the class door's PINs.
  assert.ok(h.db.store.get('ansKeyLiveClassState/studyPins'));
  assert.equal(h.db.store.get('ansKeyLiveClassState/pins'), undefined);
  // An hour later the account may try again.
  h.clock.t += lc.STUDY_PIN_LIMITS.windowMs + 1;
  assert.equal((await h.call({ action: 'study', pin: zoe.pin }, { as: studentUser })).statusCode, 200);
});

// 📈 ✉ Parent performance reports (v1.214.0): a `mail` document from the
// centre's own address, only ever written by the teacher.
test('report: the teacher emails a parent from admin@ through the mail collection', async () => {
  const h = harness();
  const res = await h.call({ action: 'report', to: ['Tan@Example.com', 'not-an-email', 'tan@example.com'], subject: 'Live lesson report —\n Amy Tan', html: '<p>Hi</p>', text: 'Hi', rosterId: 'famA_sA1', epoch: 123 });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.sent, true);
  assert.deepEqual(res.body.to, ['tan@example.com'], 'cleaned, lower case, no repeats, bad ones dropped');
  const [path, doc] = h.db.writes.find(([p]) => p.startsWith('mail/'));
  assert.match(path, /^mail\/live-class-report-123-[0-9a-f]{12}$/);
  assert.equal(doc.from, 'Polymath Learning Centre <admin@polymathlc.com.sg>');
  assert.equal(doc.replyTo, 'admin@polymathlc.com.sg');
  assert.deepEqual(doc.to, ['tan@example.com']);
  assert.equal(doc.message.subject, 'Live lesson report — Amy Tan', 'one line');
  assert.equal(doc.message.html, '<p>Hi</p>');
  assert.equal(doc.liveClassReport.rosterId, 'famA_sA1');
  assert.equal(doc.liveClassReport.test, false);
});

test('report: a test copy goes only to the teacher, whatever the request says', async () => {
  const h = harness();
  const res = await h.call({ action: 'report', test: true, to: ['parent@example.com'], subject: 'x', html: '<p>x</p>', text: 'x', epoch: 5 });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.to, [TEACHER_EMAIL.toLowerCase()]);
  const [path, doc] = h.db.writes.find(([p]) => p.startsWith('mail/'));
  assert.match(path, /^mail\/live-class-report-test-5-/);
  assert.deepEqual(doc.to, [TEACHER_EMAIL.toLowerCase()]);
  assert.equal(doc.liveClassReport.test, true);
});

test('report: students cannot send; empty, address-less and oversized reports are refused', async () => {
  const kid = harness({ user: studentUser });
  const r1 = await kid.call({ action: 'report', to: ['a@example.com'], subject: 's', html: '<p>x</p>' });
  assert.equal(r1.statusCode, 403);
  assert.equal(r1.body.error.code, 'teacher_only');
  assert.equal(kid.db.writes.length, 0);
  const h = harness();
  assert.equal((await h.call({ action: 'report', to: ['a@example.com'], subject: 's', html: ' ', text: '' })).statusCode, 400);
  const noTo = await h.call({ action: 'report', to: ['nope'], subject: 's', html: '<p>x</p>' });
  assert.equal(noTo.body.error.code, 'bad_email');
  const big = await h.call({ action: 'report', to: ['a@example.com'], subject: 's', html: 'x'.repeat(lc.LIVE_CLASS_LIMITS.reportHtmlMax + 1) });
  assert.equal(big.statusCode, 413);
  assert.equal(h.db.writes.filter(([p]) => p.startsWith('mail/')).length, 0);
  // Other actions keep the small body limit.
  const huge = await h.call({ action: 'status', pad: 'x'.repeat(lc.LIVE_CLASS_LIMITS.bodyBytes + 10) });
  assert.equal(huge.statusCode, 413);
});

test('reportEmails keeps at most four clean addresses', () => {
  assert.deepEqual(lc.reportEmails(['a@b.co', 'c@d.co', 'e@f.co', 'g@h.co', 'i@j.co']), ['a@b.co', 'c@d.co', 'e@f.co', 'g@h.co']);
  assert.deepEqual(lc.reportEmails(['<x>@y.com', 'a b@c.com', '']), []);
  assert.deepEqual(lc.reportEmails('a@b.co'), []);
});

// 🙋 Attendance and absence alerts (v1.218.0).
const ATT_ROSTER = {
  ...ROSTER,
  'officeFamilies/famA': { ...ROSTER['officeFamilies/famA'], parentName: 'Mrs Tan', email2: 'Mr.Tan@Example.com' },
  'officeFamilies/famF': { status: 'active', parentName: 'Mr Goh', email: 'goh@example.com', students: [
    { id: 'sF1', name: 'Chloe Goh', level: 'P5', status: 'active', classes: [{ slotId: 'WED-2' }] }
  ] }
};
// Wednesday 13 January 2027 in Singapore; WED-2 is 5:00pm – 6:45pm.
const WED_1700 = Date.UTC(2027, 0, 13, 9, 0);

test('🙋 the lesson window: the slot\'s own times, or from when a moved lesson was opened', () => {
  const w = lc.lessonWindow('WED-2', WED_1655);
  assert.equal(w.start, WED_1700);
  assert.equal(w.end, WED_1700 + 105 * 60000);
  assert.equal(w.release, w.end + 15 * 60000, 'answer keys open 15 minutes after the end');
  assert.equal(w.day, '2027-01-13');
  assert.equal(w.moved, false);
  const moved = lc.lessonWindow('FRI-2', WED_1655);
  assert.equal(moved.moved, true);
  assert.equal(moved.start, WED_1655);
  assert.equal(lc.lessonWindow('nope', WED_1655), null);
  assert.equal(lc.absentDueAt(w, WED_1655, 10), WED_1700 + 10 * 60000, 'ten minutes after the lesson starts');
  assert.equal(lc.absentDueAt(w, WED_1700 + 20 * 60000, 10), WED_1700 + 30 * 60000, 'a class opened late counts from when it opened');
  assert.equal(lc.cleanAbsentAfter(1), 3);
  assert.equal(lc.cleanAbsentAfter(99), 45);
  assert.deepEqual(lc.cleanSettings(null), { earlyMin: 10, absentMode: 'auto', absentAfter: 10, catchUp: true });
  assert.equal(lc.cleanSettings({ absentMode: 'loud' }).absentMode, 'auto');
});

test('🙋 attendance: who is here, a hand mark wins, and the emails read as plain words', () => {
  const split = lc.attendanceSplit({ a_1: 'A', b_2: 'B', c_3: 'C' }, { a_1: 5 }, { 'WED-2__b_2': { s: 'here' }, 'WED-2__a_1': { s: 'absent' } }, 'WED-2');
  assert.deepEqual(split.present, ['b_2']);
  assert.deepEqual(split.missing.sort(), ['a_1', 'c_3']);
  assert.deepEqual(lc.cleanJoined({ 'famA_sA1': 100, 'bad id': 100, 'famB_sB1': 5, 'famF_sF1': 'x' }, 50, 200), { famA_sA1: 100 });
  const late = lc.absentEmail({ parentName: 'Mrs <Tan>', childName: 'Amy Tan', classLabel: 'P5 Science', startMs: WED_1700, joinUrl: 'https://polymathlc.com.sg/live/?c=x', catchUp: true });
  assert.match(late.subject, /^Amy has not joined today’s P5 Science yet \(5:00pm\)$/);
  assert.match(late.html, /Hi Mrs &lt;Tan&gt;,/, 'escaped');
  assert.match(late.text, /Join the lesson: https:\/\/polymathlc\.com\.sg\/live\/\?c=x/);
  assert.match(late.text, /on Zoom, or is away today, there is nothing you need to do/);
  const w = lc.lessonWindow('WED-2', WED_1655);
  const cu = lc.catchUpEmail({ parentName: '', childName: 'Amy Tan', classLabel: 'P5 Science', win: w });
  assert.match(cu.subject, /^Catch-up for Amy: P5 Science on Wed 13 Jan$/);
  assert.match(cu.text, /^Hello,/);
  assert.match(cu.text, /Amy was absent from today’s P5 Science lesson \(Wed 13 Jan, 5:00pm – 6:45pm\)/);
  assert.match(cu.text, /from 7:00pm/);
  assert.match(cu.text, /polymathlc\.com\.sg\/online\//);
  assert.equal(lc.alertMailId('late', '2027-01-13', 'WED-2', 'famA_sA1'), 'live-class-absent-2027-01-13-WED-2-famA_sA1');
  assert.equal(lc.classWords('WED-2', { slots: { 'WED-2': { level: 'P5', subject: 'Math' } } }), 'P5 Maths');
});

test('🙋 ten minutes in: the parents of children not in the class are emailed once, never a child marked here', async () => {
  const db = fakeDb(ATT_ROSTER);
  const clock = { t: WED_1655 };
  const h = harness({ db, clock });
  await h.call(KEYS);
  const opened = await h.call({ action: 'open', slot: SLOT });
  const epoch = opened.body.epoch;
  // Amy joined at 4:58; LiveKit also has Chloe in the room.
  h.lk.setParticipants([{ identity: 'r:famF_sF1', joined_at: String(Math.floor((WED_1700 + 60000) / 1000)) }, { identity: 't:teacher' }]);
  clock.t = WED_1700 + 5 * 60000;
  const early = await h.call({ action: 'attendance', epoch, joined: { famA_sA1: WED_1655 + 3 * 60000 }, send: true });
  assert.equal(early.statusCode, 200);
  assert.equal(early.body.taken, true);
  assert.equal(early.body.dueAt, WED_1700 + 10 * 60000);
  assert.deepEqual(early.body.missing, ['famB_sB1'], 'only Ethan is missing');
  assert.equal(early.body.sent.length, 0, 'not due yet');
  assert.equal(db.writes.filter(([p]) => p.startsWith('mail/')).length, 0);
  const doc = db.store.get('officeSettings/attend-2027-01-13');
  assert.equal(doc.kind, 'attendance-day');
  assert.equal(doc.live['WED-2'].joined.famF_sF1, WED_1700 + 60000, 'from the room');
  assert.equal(doc.live['WED-2'].expected.famA_sA1, 'Amy Tan');
  assert.equal(doc.live['WED-2'].expected['famD_sD1'], undefined, 'withdrawn families are not expected');

  // Ten minutes in. Ethan's family has no email: nothing is sent, and the teacher is told.
  clock.t = WED_1700 + 11 * 60000;
  h.lk.setParticipants([]);
  const due = await h.call({ action: 'attendance', epoch, joined: {}, send: true });
  assert.deepEqual(due.body.noEmail, ['famB_sB1']);
  assert.equal(db.writes.filter(([p]) => p.startsWith('mail/')).length, 0);
  assert.deepEqual(due.body.present.sort(), ['famA_sA1', 'famF_sF1'], 'a child who joined stays here after leaving');

  // Chloe never really came: the office marks her absent → no "not joined yet" email, but she is missing.
  const st = db.store.get('officeSettings/attend-2027-01-13');
  st.live['WED-2'].joined = { famA_sA1: WED_1655 + 3 * 60000 };
  db.store.set('officeSettings/attend-2027-01-13', st);
  const again = await h.call({ action: 'attendance', epoch, joined: {}, send: true });
  assert.deepEqual(again.body.missing.sort(), ['famB_sB1', 'famF_sF1']);
  const mails = db.writes.filter(([p]) => p.startsWith('mail/'));
  assert.equal(mails.length, 1);
  const [path, mail] = mails[0];
  assert.equal(path, 'mail/live-class-absent-2027-01-13-WED-2-famF_sF1');
  assert.deepEqual(mail.to, ['goh@example.com']);
  assert.equal(mail.from, 'Polymath Learning Centre <admin@polymathlc.com.sg>');
  assert.match(mail.message.subject, /^Chloe has not joined/);
  assert.match(mail.message.text, /Hi Mr Goh,/);
  assert.equal(mail.liveClassAttendance.kind, 'late');
  assert.ok(db.store.get('officeSettings/attend-2027-01-13').alerts['WED-2__famF_sF1'].late.at > 0);
  // Asked again: never a second email.
  await h.call({ action: 'attendance', epoch, joined: {}, send: true });
  assert.equal(db.writes.filter(([p]) => p.startsWith('mail/')).length, 1);

  // "Here (on Zoom)" from the teacher: a hand mark the office sees.
  const marked = await h.call({ action: 'attendance', epoch, here: ['famB_sB1'] });
  assert.deepEqual(marked.body.missing, ['famF_sF1']);
  assert.equal(db.store.get('officeSettings/attend-2027-01-13').marks['WED-2__famB_sB1'].s, 'here');
  // Students may not ask.
  assert.equal((await h.call({ action: 'attendance', epoch }, { as: studentUser })).statusCode, 403);
});

test('🙋 skipped names, off, and an old class', async () => {
  const db = fakeDb(ATT_ROSTER);
  const clock = { t: WED_1655 };
  const h = harness({ db, clock });
  await h.call(KEYS);
  const { epoch } = (await h.call({ action: 'open', slot: SLOT })).body;
  clock.t = WED_1700 + 12 * 60000;
  const r = await h.call({ action: 'attendance', epoch, joined: { famB_sB1: WED_1700 }, send: true, skip: ['famF_sF1'] });
  assert.deepEqual(r.body.sent, ['famA_sA1'], 'Chloe was skipped by the teacher');
  const [, mail] = db.writes.find(([p]) => p.startsWith('mail/'));
  assert.deepEqual(mail.to, ['tan@example.com', 'mr.tan@example.com'], 'both of the family\'s addresses');
  assert.match(mail.message.text, /\/live\/\?c=famA_sA1\.0\./, 'the child\'s own one-tap link');
  await h.call({ action: 'settings', absentMode: 'off' });
  const off = await h.call({ action: 'attendance', epoch, joined: {}, send: true });
  assert.equal(off.body.mode, 'off');
  assert.equal(off.body.sent.length, 0);
  assert.equal((await h.call({ action: 'settings', absentMode: 'shout' })).statusCode, 400);
  assert.equal((await h.call({ action: 'attendance', epoch: epoch - 1 })).body.error.code, 'class_closed');
});

test('🙋 ending the class sends the catch-up to every child who never came', async () => {
  const db = fakeDb(ATT_ROSTER);
  const clock = { t: WED_1655 };
  const h = harness({ db, clock });
  await h.call(KEYS);
  const { epoch } = (await h.call({ action: 'open', slot: SLOT })).body;
  clock.t = WED_1700 + 100 * 60000;
  const closed = await h.call({ action: 'close', joined: { famA_sA1: WED_1700 + 2 * 60000 }, epoch });
  assert.equal(closed.statusCode, 200);
  assert.equal(closed.body.open, false);
  assert.deepEqual(closed.body.attendance.missing.sort(), ['famB_sB1', 'famF_sF1']);
  const mails = db.writes.filter(([p]) => p.startsWith('mail/'));
  assert.equal(mails.length, 1, 'Ethan\'s family has no email');
  assert.equal(mails[0][0], 'mail/live-class-catchup-2027-01-13-WED-2-famF_sF1');
  assert.match(mails[0][1].message.subject, /^Catch-up for Chloe: P5 Science on Wed 13 Jan$/);
  const rec = db.store.get('officeSettings/attend-2027-01-13').live['WED-2'];
  assert.equal(rec.final, true);
  assert.equal(rec.closedAt, clock.t);
  // A class opened and closed before the check was due sends nothing.
  const db2 = fakeDb(ATT_ROSTER);
  const h2 = harness({ db: db2, clock: { t: WED_1655 } });
  await h2.call(KEYS);
  await h2.call({ action: 'open', slot: SLOT });
  h2.clock.t = WED_1655 + 60000;
  await h2.call({ action: 'close', joined: {} });
  assert.equal(db2.writes.filter(([p]) => p.startsWith('mail/')).length, 0);
});
