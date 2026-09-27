'use strict';

const { createHash } = require('node:crypto');
const { APP_ID, TEACHER_EMAIL, allowedOrigin } = require('./live-service');

const JEV_LIMITS = Object.freeze({ objects: 100, transcript: 4000, bodyBytes: 180000, perMinute: 90, perDay: 1800 });
const INTENTS = Object.freeze(['add', 'move', 'resize', 'delete', 'undo', 'redo', 'navigate', 'write_answer', 'answer', 'unsupported']);
const TARGET_INTENTS = new Set(['move', 'resize', 'delete']);
const MIN_CONFIDENCE = 0.6;

class JevError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function invalid(message = 'The voice command is not valid. Please try again.') {
  throw new JevError(400, 'invalid_command', message);
}

function validateCommand(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid();
  if (typeof body.worksheetId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.worksheetId)) {
    invalid('Open one of your saved worksheets before using voice commands.');
  }
  if (typeof body.transcript !== 'string' || !body.transcript.trim() || body.transcript.length > JEV_LIMITS.transcript) invalid();
  const context = body.context;
  if (!context || typeof context !== 'object' || Array.isArray(context) || !Array.isArray(context.objects) || context.objects.length > JEV_LIMITS.objects) invalid();
  const page = context.page === undefined ? 1 : context.page;
  if (!Number.isInteger(page) || page < 1 || page > 10000) invalid();
  const ids = new Set();
  const objects = context.objects.map(object => {
    if (!object || typeof object !== 'object' || Array.isArray(object) || typeof object.id !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(object.id) || ids.has(object.id) || typeof object.type !== 'string' ||
        !/^[A-Za-z0-9_-]{1,40}$/.test(object.type)) invalid();
    ids.add(object.id);
    const clean = { id: object.id, type: object.type };
    for (const [key, max] of [['text', 1200], ['title', 240], ['color', 64]]) {
      if (object[key] !== undefined) {
        if (typeof object[key] !== 'string' || object[key].length > max) invalid();
        clean[key] = object[key];
      }
    }
    for (const key of ['x', 'y', 'w', 'h']) {
      if (object[key] !== undefined) {
        if (typeof object[key] !== 'number' || !Number.isFinite(object[key]) || Math.abs(object[key]) > 1000000 ||
            ((key === 'w' || key === 'h') && object[key] < 0)) invalid();
        clean[key] = object[key];
      }
    }
    if (object.locked !== undefined) {
      if (typeof object.locked !== 'boolean') invalid();
      clean.locked = object.locked;
    }
    return clean;
  });
  const selectedId = context.selectedId == null ? null : context.selectedId;
  if (selectedId !== null && !ids.has(selectedId)) invalid();
  const cleanContext = { page, selectedId, objects };
  if (context.cursor !== undefined) {
    const cursor = context.cursor;
    if (cursor !== null && (!cursor || typeof cursor !== 'object' || Array.isArray(cursor) || cursor.page !== page ||
        typeof cursor.x !== 'number' || !Number.isFinite(cursor.x) || cursor.x < 0 || cursor.x > 1000000 ||
        typeof cursor.y !== 'number' || !Number.isFinite(cursor.y) || cursor.y < 0 || cursor.y > 1000000)) invalid();
    cleanContext.cursor = cursor === null ? null : { page, x: cursor.x, y: cursor.y };
  }
  return { worksheetId: body.worksheetId, transcript: body.transcript.trim(), context: cleanContext };
}

// Keep only counters. Transcripts and worksheet contents are never persisted.
function createJevRepository(db) {
  return {
    async authorize(uid, worksheetId, now) {
      const ownerKey = createHash('sha256').update(uid).digest('hex');
      const ref = db.collection('ansKeyJevLimits').doc(ownerKey);
      const minute = Math.floor(now / 60000);
      const day = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
      await db.runTransaction(async tx => {
        const [worksheet, counter] = await Promise.all([
          tx.get(db.collection('pdfAnnotator').doc(worksheetId)), tx.get(ref)
        ]);
        if (!worksheet.exists || worksheet.data().ownerUid !== uid) {
          throw new JevError(403, 'worksheet_not_owned', 'Open one of your saved worksheets before using voice commands.');
        }
        const value = counter.data() || {};
        const minuteCount = value.minute === minute ? Number(value.minuteCount || 0) : 0;
        const dayCount = value.day === day ? Number(value.dayCount || 0) : 0;
        if (minuteCount >= JEV_LIMITS.perMinute || dayCount >= JEV_LIMITS.perDay) {
          throw new JevError(429, 'jev_limit', 'Voice commands have reached their allowance. Please try again later.');
        }
        tx.set(ref, { minute, minuteCount: minuteCount + 1, day, dayCount: dayCount + 1 });
      });
    }
  };
}

function createJevService({ auth, appCheck, repository, provider, now = Date.now, report = () => {} }) {
  async function identify(req) {
    const match = /^Bearer ([^\s]+)$/.exec(req.get('authorization') || '');
    if (!match) throw new JevError(401, 'sign_in_required', 'Sign in again before using voice commands.');
    const token = req.get('x-firebase-appcheck');
    if (!token) throw new JevError(403, 'app_check_required', 'App verification failed. Refresh Ans Key and try again.');
    let user;
    try { user = await auth.verifyIdToken(match[1], true); }
    catch { throw new JevError(401, 'sign_in_required', 'Sign in again before using voice commands.'); }
    if (!user?.uid || user.firebase?.sign_in_provider !== 'google.com' || user.email_verified !== true ||
        String(user.email || '').toLowerCase() !== TEACHER_EMAIL) {
      throw new JevError(403, 'teacher_required', 'Voice commands are available to the signed-in teacher only.');
    }
    try {
      const claims = await appCheck.verifyToken(token);
      if (claims.appId !== APP_ID) throw new Error('wrong app');
    } catch { throw new JevError(403, 'app_check_required', 'App verification failed. Refresh Ans Key and try again.'); }
    return user.uid;
  }

  async function handler(req, res) {
    res.set('Cache-Control', 'no-store');
    res.set('Vary', 'Origin');
    const origin = req.get('origin');
    if (!allowedOrigin(origin)) return res.status(403).json({ error: { code: 'origin_not_allowed', message: 'Open voice commands from Ans Key.' } });
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Firebase-AppCheck');
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ error: { code: 'method_not_allowed', message: 'Use POST for voice commands.' } });
    try {
      if (!/^application\/json(?:;|$)/i.test(req.get('content-type') || '')) throw new JevError(415, 'invalid_command', 'Send a JSON voice command.');
      if ((req.rawBody?.length || 0) > JEV_LIMITS.bodyBytes) throw new JevError(413, 'invalid_command', 'The voice command is too large.');
      const body = validateCommand(req.body);
      const uid = await identify(req);
      await repository.authorize(uid, body.worksheetId, now());
      if (res.destroyed) return;
      const result = await provider.classify(body.transcript, body.context);
      if (!res.destroyed) return res.status(200).json(result);
    } catch (error) {
      if (res.destroyed) return;
      if (error instanceof JevError) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
      report('jev_request_failed');
      return res.status(503).json({ error: { code: 'jev_unavailable', message: 'Jev could not check this command. Please try again.' } });
    }
  }
  return { handler };
}

module.exports = { JevError, JEV_LIMITS, INTENTS, TARGET_INTENTS, MIN_CONFIDENCE, validateCommand, createJevRepository, createJevService };
