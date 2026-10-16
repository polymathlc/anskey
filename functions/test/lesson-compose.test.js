'use strict';
// ☁ The cloud join for a lesson uploaded while it was recorded. A fake bucket
// stands in for Cloud Storage so the joins, the batches of 32, the checks and
// the clean-up can all be seen; the auth fakes are the hero service's.
const test = require('node:test'), assert = require('node:assert/strict');
const { createLessonComposeService, validateComposeRequest, partName, finalName, composeAll, COMPOSE_BATCH, MAX_PARTS } = require('../lesson-compose');
const { APP_ID, TEACHER_EMAIL } = require('../live-service');

const teacherUser = { uid: 'teacher', email: TEACHER_EMAIL, email_verified: true, firebase: { sign_in_provider: 'google.com' } };

function fakeBucket(initial = {}) {
  const objects = new Map(Object.entries(initial).map(([name, bytes]) => [name, { data: Buffer.from(bytes), meta: {} }]));
  const log = [];
  const bucket = {
    name: 'mathgen--app.firebasestorage.app',
    objects, log,
    file(name) {
      return {
        name,
        async exists() { return [objects.has(name)]; },
        async getMetadata() {
          const o = objects.get(name); if (!o) throw new Error('No such object ' + name);
          return [{ size: String(o.data.length), contentType: o.meta.contentType, cacheControl: o.meta.cacheControl, metadata: o.meta.metadata }];
        },
        async setMetadata(meta) {
          const o = objects.get(name); if (!o) throw new Error('No such object ' + name);
          log.push(['setMetadata', name, meta]);
          Object.assign(o.meta, meta, { metadata: Object.assign({}, o.meta.metadata || {}, meta.metadata || {}) });
          return [o.meta];
        },
        async delete() { log.push(['delete', name]); objects.delete(name); return []; }
      };
    },
    async combine(sources, dest) {
      if (sources.length > COMPOSE_BATCH) throw new Error('Compose takes at most 32 sources');
      log.push(['combine', sources.map(s => s.name), dest.name]);
      const data = Buffer.concat(sources.map(s => { const o = objects.get(s.name); if (!o) throw new Error('missing ' + s.name); return o.data; }));
      objects.set(dest.name, { data, meta: (objects.get(dest.name) || {}).meta || {} });
      return [dest];
    }
  };
  return bucket;
}

function harness({ bucket = fakeBucket(), user = teacherUser, appId = APP_ID, teacher = { uid: 'teacher', emailVerified: true } } = {}) {
  const calls = [];
  const service = createLessonComposeService({
    auth: { async verifyIdToken(token, revoked) { calls.push(['auth', token, revoked]); if (user instanceof Error) throw user; return user; },
      async getUserByEmail(email) { calls.push(['teacher', email]); return teacher; } },
    appCheck: { async verifyToken(token) { calls.push(['appCheck', token]); return { appId }; } },
    bucket, report: code => calls.push(['report', code]), makeToken: () => 'tok-1'
  });
  async function request(body, opts = {}) {
    const headers = { origin: 'https://polymathlc.github.io', authorization: 'Bearer token', 'x-firebase-appcheck': 'app-token', 'content-type': 'application/json', ...opts.headers };
    const req = { body, method: opts.method || 'POST', rawBody: opts.rawBody, get: n => headers[n.toLowerCase()] };
    const res = { headers: {}, statusCode: 200, set(k, v) { this.headers[k] = v; return this; }, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; }, send(v) { this.body = v; return this; } };
    await service.handler(req, res); return res;
  }
  return { request, calls, bucket, service };
}

function pieces(docId, id, list) {
  const out = {};
  list.forEach((bytes, i) => { out[partName(docId, id, i)] = bytes; });
  return out;
}

const body = (over = {}) => Object.assign({ type: 'compose', docId: 'doc1', id: 'aabc1', ext: 'mp4', parts: 3, contentType: 'video/mp4' }, over);

test('the pieces are joined in order into the lesson file, with a token and the replay cache header', async () => {
  const bucket = fakeBucket(pieces('doc1', 'aabc1', ['HEAD', 'one-', 'two']));
  const h = harness({ bucket });
  const res = await h.request(body({ bytes: 11 }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const dest = finalName('doc1', 'aabc1', 'mp4');
  assert.equal(bucket.objects.get(dest).data.toString(), 'HEADone-two');
  assert.equal(res.body.path, dest);
  assert.equal(res.body.bytes, 11);
  assert.equal(res.body.url, 'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/' + encodeURIComponent(dest) + '?alt=media&token=tok-1');
  const meta = bucket.objects.get(dest).meta;
  assert.equal(meta.contentType, 'video/mp4');
  assert.equal(meta.cacheControl, 'private,max-age=3600');
  assert.equal(meta.metadata.firebaseStorageDownloadTokens, 'tok-1');
  // The pieces are gone once the file is there.
  for (let i = 0; i < 3; i++) assert.equal(bucket.objects.has(partName('doc1', 'aabc1', i)), false);
});

test('more than 32 pieces are joined in batches, each later batch on top of the file so far', async () => {
  const list = []; for (let i = 0; i < 70; i++) list.push(String.fromCharCode(65 + (i % 26)));
  const bucket = fakeBucket(pieces('doc1', 'aabc1', list));
  const h = harness({ bucket });
  const res = await h.request(body({ parts: 70, ext: 'webm', contentType: 'video/webm;codecs=vp9,opus' }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const combines = bucket.log.filter(x => x[0] === 'combine');
  assert.equal(combines.length, 3);
  assert.equal(combines[0][1].length, 32);
  const dest = finalName('doc1', 'aabc1', 'webm');
  assert.equal(combines[1][1][0], dest);
  assert.equal(combines[1][1].length, 32);
  assert.equal(bucket.objects.get(dest).data.toString(), list.join(''));
});

test('composeAll never hands Cloud Storage more than 32 sources at once', async () => {
  const names = [], init = {};
  for (let i = 0; i < 95; i++) { names.push('p' + i); init['p' + i] = 'x'; }
  const bucket = fakeBucket(init);
  await composeAll(bucket, names, 'out');
  assert.equal(bucket.objects.get('out').data.length, 95);
  assert.ok(bucket.log.filter(x => x[0] === 'combine').every(x => x[1].length <= 32));
});

test('a missing piece, or a total that does not match, refuses rather than joining a hole', async () => {
  const gap = fakeBucket({ [partName('doc1', 'aabc1', 0)]: 'H', [partName('doc1', 'aabc1', 2)]: 'Z' });
  const res = await harness({ bucket: gap }).request(body());
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'parts_missing');
  assert.equal(gap.objects.has(finalName('doc1', 'aabc1', 'mp4')), false);
  const short = fakeBucket(pieces('doc1', 'aabc1', ['a', 'b', 'c']));
  const res2 = await harness({ bucket: short }).request(body({ bytes: 4 }));
  assert.equal(res2.statusCode, 409);
  assert.equal(res2.body.error.code, 'size_mismatch');
  assert.equal(short.objects.has(partName('doc1', 'aabc1', 0)), true, 'a refused join leaves every piece in place');
});

test('a retry after the join went through answers with the file that is already there', async () => {
  const bucket = fakeBucket(pieces('doc1', 'aabc1', ['A', 'B', 'C']));
  const h = harness({ bucket });
  assert.equal((await h.request(body())).statusCode, 200);
  const again = await h.request(body());
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.reused, true);
  assert.match(again.body.url, /token=tok-1$/);
  const nothing = await harness({ bucket: fakeBucket() }).request(body());
  assert.equal(nothing.statusCode, 409);
});

test('only the teacher may join a lesson, and every refusal comes before a file is touched', async () => {
  const cases = [
    { user: { ...teacherUser, uid: 'pupil', email: 'pupil@example.com' } },
    { user: { ...teacherUser, email_verified: false } },
    { user: { ...teacherUser, email: 'other@example.com' } },
    { user: new Error('revoked') },
    { appId: 'another-app' }
  ];
  for (const c of cases) {
    const bucket = fakeBucket(pieces('doc1', 'aabc1', ['A', 'B', 'C']));
    const res = await harness({ bucket, ...c }).request(body());
    assert.ok(res.statusCode === 401 || res.statusCode === 403, JSON.stringify(c) + ' → ' + res.statusCode);
    assert.equal(bucket.log.length, 0);
    assert.equal(bucket.objects.has(finalName('doc1', 'aabc1', 'mp4')), false);
  }
  const noToken = harness();
  assert.equal((await noToken.request(body(), { headers: { authorization: '' } })).statusCode, 401);
});

test('names are built from validated ids only, so a request cannot reach another object', () => {
  const bad = [
    body({ docId: '../secret' }), body({ docId: 'a/b' }), body({ id: 'x y' }), body({ id: '' }),
    body({ ext: 'html' }), body({ ext: 'json' }), body({ parts: 0 }), body({ parts: MAX_PARTS + 1 }), body({ parts: 2.5 }),
    body({ contentType: 'text/html' }), body({ contentType: 'application/json' }), body({ type: 'delete' }),
    body({ bytes: -1 }), body({ bytes: 'lots' }), null, [], 'compose'
  ];
  for (const b of bad) assert.throws(() => validateComposeRequest(b), /./, JSON.stringify(b));
  const ok = validateComposeRequest(body({ ext: 'WEBM', contentType: 'audio/webm;codecs=opus', bytes: 5 }));
  assert.equal(ok.ext, 'webm');
  assert.equal(partName('doc1', 'aabc1', 7), 'pdf-annotator/lesson-doc1-aabc1.part-0007');
});

test('origin, method, JSON type and body size fail before auth; failures never leak details', async () => {
  const h = harness();
  for (const opts of [{ headers: { origin: 'https://evil.example' } }, { method: 'GET' }, { headers: { 'content-type': 'text/plain' } }, { rawBody: Buffer.alloc(4001) }]) {
    assert.ok((await h.request(body(), opts)).statusCode >= 400);
  }
  assert.deepEqual(h.calls, []);
  assert.equal((await h.request(body(), { method: 'OPTIONS' })).statusCode, 204);
  const broken = fakeBucket(pieces('doc1', 'aabc1', ['A', 'B', 'C']));
  broken.combine = async () => { throw new Error('private bucket detail'); };
  const h2 = harness({ bucket: broken });
  const res = await h2.request(body());
  assert.equal(res.statusCode, 503);
  assert.ok(!JSON.stringify(res.body).includes('private'));
  assert.deepEqual(h2.calls.at(-1), ['report', 'lesson_compose_failed']);
});
