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
function fakeDb(initial = ROSTER) {
  const store = new Map(Object.entries(initial));
  const writes = [];
  function ref(path) {
    return {
      path,
      async get() { const d = store.get(path); return { exists: d !== undefined, data: () => (d === undefined ? undefined : JSON.parse(JSON.stringify(d))) }; },
      async set(v) { writes.push([path, v]); store.set(path, JSON.parse(JSON.stringify(v))); },
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

function harness({ db = fakeDb(), user = teacherUser, appId = APP_ID, lk = fakeLiveKit(), clock = { t: 1_800_000_000_000 } } = {}) {
  const reports = [];
  const current = { user };
  const service = lc.createLiveClassService({
    auth: { async verifyIdToken() { if (current.user instanceof Error) throw current.user; return current.user; },
      async getUserByEmail() { return { uid: 'teacher', emailVerified: true }; } },
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
  return { call, db, lk, clock, reports, current };
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
