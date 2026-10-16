'use strict';

// ☁ A lesson that uploads WHILE it is being recorded (v1.143.0).
//
// The browser sends the recording up in pieces as the lesson goes on:
// `pdf-annotator/lesson-{docId}-{id}.part-0001`, `-0002`, … each a few
// megabytes, so when the teacher presses Stop almost all of it is already in
// Cloud Storage. Only the head (the file's first bytes, rewritten once the
// length is known) and the last few seconds are left to send. This service
// then joins the pieces into the ONE file the replay, the preload and the
// 1080p export all read, using Cloud Storage's own compose: the bytes never
// pass through this function, so an hour of video joins in about a second.
//
// It is the teacher's alone, like every other write under `lesson-*`: the
// Storage rules already let nobody else upload a piece, and this service
// refuses any caller who is not the teacher before it touches a file. It only
// ever joins names it builds itself from validated ids, so a request cannot
// point it at somebody else's object.
const crypto = require('node:crypto');
const { APP_ID, TEACHER_EMAIL, allowedOrigin } = require('./live-service');

const STORAGE_DIR = 'pdf-annotator';
// Must stay at or above the recorder's LESSON_VIDEO_LIMIT plus its slack: a
// joined file this refuses is a lesson the teacher believes was saved.
const MAX_TOTAL_BYTES = 1536 * 1024 * 1024 + 64 * 1024 * 1024;
const MAX_PARTS = 900;
// Cloud Storage joins at most 32 objects per compose call.
const COMPOSE_BATCH = 32;
const EXTENSIONS = { webm: true, mp4: true, m4a: true, ogg: true };
const CONTENT_TYPE_RE = /^(?:audio|video)\/(?:webm|mp4|ogg)(?:;[ -~]{0,120})?$/i;
const DOC_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

class ComposeError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function partName(docId, id, index) {
  return STORAGE_DIR + '/lesson-' + docId + '-' + id + '.part-' + String(index).padStart(4, '0');
}
function finalName(docId, id, ext) {
  return STORAGE_DIR + '/lesson-' + docId + '-' + id + '.' + ext;
}

function validateComposeRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ComposeError(400, 'invalid_request', 'Send a lesson to join.');
  if (body.type !== 'compose') throw new ComposeError(400, 'invalid_request', 'Choose a valid lesson action.');
  const docId = String(body.docId || ''), id = String(body.id || ''), ext = String(body.ext || '').toLowerCase();
  const count = Number(body.parts), contentType = String(body.contentType || '');
  if (!DOC_RE.test(docId)) throw new ComposeError(400, 'invalid_request', 'That worksheet id is not valid.');
  if (!ID_RE.test(id)) throw new ComposeError(400, 'invalid_request', 'That lesson id is not valid.');
  if (!EXTENSIONS[ext]) throw new ComposeError(400, 'invalid_request', 'That kind of recording cannot be joined.');
  if (!Number.isInteger(count) || count < 1 || count > MAX_PARTS) throw new ComposeError(400, 'invalid_request', 'That number of pieces is not valid.');
  if (!CONTENT_TYPE_RE.test(contentType)) throw new ComposeError(400, 'invalid_request', 'That recording type is not valid.');
  // An expected total, when the browser sends one, is checked against what is
  // really there: a piece that went missing must never be joined over.
  let expect = null;
  if (body.bytes !== undefined) {
    expect = Number(body.bytes);
    if (!Number.isSafeInteger(expect) || expect < 1 || expect > MAX_TOTAL_BYTES) throw new ComposeError(400, 'invalid_request', 'That lesson size is not valid.');
  }
  return { docId, id, ext, count, contentType, expect };
}

// The download address in the shape every reader already accepts
// (lessonAssetUrl): the Firebase Storage host, this bucket, a lesson name.
function downloadUrl(bucketName, name, token) {
  return 'https://firebasestorage.googleapis.com/v0/b/' + bucketName + '/o/' +
    encodeURIComponent(name) + '?alt=media&token=' + encodeURIComponent(token);
}

function tokenOf(metadata) {
  const raw = metadata && metadata.metadata && metadata.metadata.firebaseStorageDownloadTokens;
  return raw ? String(raw).split(',')[0].trim() : '';
}

// Joins `sources` into `destination` in batches of 32: the first batch makes
// the file, and each later batch is the file so far plus up to 31 more pieces.
async function composeAll(bucket, sources, destination) {
  const dest = bucket.file(destination);
  let at = 0, first = true;
  while (at < sources.length) {
    const room = first ? COMPOSE_BATCH : COMPOSE_BATCH - 1;
    const batch = sources.slice(at, at + room).map(name => bucket.file(name));
    await bucket.combine(first ? batch : [dest].concat(batch), dest);
    at += room; first = false;
  }
  return dest;
}

function createLessonComposeService({ auth, appCheck, bucket, report = () => {}, makeToken = () => crypto.randomUUID() }) {
  const TEACHER_TTL_MS = 5 * 60 * 1000;
  let teacherLookup = null;
  function teacherRecord() {
    const now = Date.now();
    if (teacherLookup && now - teacherLookup.at < TEACHER_TTL_MS) return teacherLookup.promise;
    const entry = { at: now, promise: null };
    entry.promise = Promise.resolve().then(() => auth.getUserByEmail(TEACHER_EMAIL)).then(teacher => {
      if (!teacher?.uid || !teacher.emailVerified) { if (teacherLookup === entry) teacherLookup = null; }
      return teacher;
    }, error => { if (teacherLookup === entry) teacherLookup = null; throw error; });
    teacherLookup = entry;
    return entry.promise;
  }
  async function identify(req) {
    const bearer = /^Bearer ([^\s]+)$/.exec(req.get('authorization') || '');
    if (!bearer) throw new ComposeError(401, 'sign_in_required', 'Sign in as the teacher to save a lesson.');
    const token = req.get('x-firebase-appcheck');
    const [userResult, appResult, teacherResult] = await Promise.allSettled([
      auth.verifyIdToken(bearer[1], true),
      token ? appCheck.verifyToken(token) : Promise.reject(new Error('missing')),
      teacherRecord()
    ]);
    if (userResult.status !== 'fulfilled') throw new ComposeError(401, 'sign_in_required', 'Sign in again to save the lesson.');
    const user = userResult.value;
    if (!user?.uid || user.email_verified !== true) throw new ComposeError(403, 'teacher_required', 'Only the teacher can save a lesson.');
    if (appResult.status !== 'fulfilled' || appResult.value?.appId !== APP_ID) throw new ComposeError(403, 'app_check_required', 'Refresh Ans Key and save the lesson again.');
    if (teacherResult.status !== 'fulfilled') throw teacherResult.reason;
    const teacher = teacherResult.value;
    if (!teacher?.uid || !teacher.emailVerified) throw new ComposeError(503, 'teacher_unavailable', 'The teacher account is unavailable. Try again later.');
    if (user.uid !== teacher.uid || String(user.email || '').toLowerCase() !== TEACHER_EMAIL) throw new ComposeError(403, 'teacher_required', 'Only the teacher can save a lesson.');
    return { uid: user.uid };
  }
  async function compose(request) {
    const { docId, id, ext, count, contentType, expect } = request;
    const destination = finalName(docId, id, ext);
    const names = [];
    for (let i = 0; i < count; i++) names.push(partName(docId, id, i));
    const sizes = await Promise.all(names.map(async name => {
      const [exists] = await bucket.file(name).exists();
      if (!exists) return null;
      const [meta] = await bucket.file(name).getMetadata();
      return Number(meta.size);
    }));
    // A retry after a join that already went through: the pieces are gone and
    // the file is there. Answer with the file rather than refusing.
    if (sizes.every(size => size === null)) {
      const dest = bucket.file(destination);
      const [exists] = await dest.exists();
      if (!exists) throw new ComposeError(409, 'parts_missing', 'The pieces of this lesson are not in the cloud. Save it again from this device.');
      const [meta] = await dest.getMetadata();
      let token = tokenOf(meta);
      if (!token) { token = makeToken(); await dest.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } }); }
      return { path: destination, url: downloadUrl(bucket.name, destination, token), bytes: Number(meta.size), reused: true };
    }
    const missing = sizes.findIndex(size => size === null);
    if (missing !== -1) throw new ComposeError(409, 'parts_missing', 'Piece ' + missing + ' of this lesson has not reached the cloud yet. Save it again.');
    const total = sizes.reduce((a, b) => a + b, 0);
    if (total > MAX_TOTAL_BYTES) throw new ComposeError(413, 'too_large', 'This lesson is larger than a lesson may be.');
    if (expect !== null && total !== expect) throw new ComposeError(409, 'size_mismatch', 'Some of this lesson did not reach the cloud. Save it again.');
    const dest = await composeAll(bucket, names, destination);
    const token = makeToken();
    await dest.setMetadata({ contentType, cacheControl: 'private,max-age=3600', metadata: { firebaseStorageDownloadTokens: token } });
    const [meta] = await dest.getMetadata();
    if (Number(meta.size) !== total) throw new ComposeError(500, 'compose_failed', 'The lesson could not be joined. Save it again.');
    // The pieces go once the file is safely there. A piece left behind costs a
    // little storage and nothing else, so a failed delete never fails the save.
    await Promise.all(names.map(name => bucket.file(name).delete().catch(() => report('lesson_part_delete_failed'))));
    return { path: destination, url: downloadUrl(bucket.name, destination, token), bytes: total };
  }
  async function handler(req, res) {
    res.set('Cache-Control', 'no-store'); res.set('Vary', 'Origin');
    const origin = req.get('origin');
    if (!allowedOrigin(origin)) return res.status(403).json({ error: { code: 'origin_not_allowed', message: 'Save the lesson from Ans Key.' } });
    res.set('Access-Control-Allow-Origin', origin); res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Firebase-AppCheck');
    res.set('Access-Control-Max-Age', '7200');
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ error: { code: 'method_not_allowed', message: 'Use POST to save a lesson.' } });
    try {
      if (!/^application\/json(?:;|$)/i.test(req.get('content-type') || '')) throw new ComposeError(415, 'invalid_request', 'Send the lesson as JSON.');
      if ((req.rawBody?.length || 0) > 4000) throw new ComposeError(413, 'invalid_request', 'That request is too large.');
      const request = validateComposeRequest(req.body);
      await identify(req);
      const result = await compose(request);
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ComposeError) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
      report('lesson_compose_failed');
      return res.status(503).json({ error: { code: 'compose_unavailable', message: 'The lesson could not be joined in the cloud. It is still on this device; try saving again.' } });
    }
  }
  return { handler, compose, identify };
}

module.exports = { ComposeError, MAX_PARTS, MAX_TOTAL_BYTES, COMPOSE_BATCH, partName, finalName, downloadUrl,
  validateComposeRequest, composeAll, createLessonComposeService };
