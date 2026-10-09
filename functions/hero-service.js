'use strict';

const { APP_ID, TEACHER_EMAIL, allowedOrigin } = require('./live-service');
class HeroError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const TYPES = new Set(['me', 'catalog', 'claim', 'cancelClaim', 'claims', 'approve', 'reject', 'unlink', 'configure', 'battle', 'wheelAward', 'assist', 'mission', 'lessonGuests', 'endEncounter']);
function validateHeroRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !TYPES.has(body.type)) throw new HeroError(400, 'invalid_request', 'Choose a valid hero action.');
  return body;
}
function createHeroService({ auth, appCheck, repository, report = () => {} }) {
  // The teacher record changes almost never, and looking it up is a round
  // trip to the Auth API on every single request, in series with the token
  // checks. Keep a resolved lookup for a few minutes; a failed one is not kept.
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
    if (!bearer) throw new HeroError(401, 'sign_in_required', 'Sign in to open My Hero.');
    // The three checks are independent network calls: run them together
    // rather than one after another, then judge them in the same order.
    const token = req.get('x-firebase-appcheck');
    const [userResult, appResult, teacherResult] = await Promise.allSettled([
      auth.verifyIdToken(bearer[1], true),
      token ? appCheck.verifyToken(token) : Promise.reject(new Error('missing')),
      teacherRecord()
    ]);
    if (userResult.status !== 'fulfilled') throw new HeroError(401, 'sign_in_required', 'Sign in again to open My Hero.');
    const user = userResult.value;
    if (!user?.uid || user.email_verified !== true || user.firebase?.sign_in_provider !== 'google.com') throw new HeroError(403, 'verified_account_required', 'Use your verified Google account to claim a hero.');
    if (appResult.status !== 'fulfilled' || appResult.value?.appId !== APP_ID) throw new HeroError(403, 'app_check_required', 'Refresh Ans Key to verify access to My Hero.');
    if (teacherResult.status !== 'fulfilled') throw teacherResult.reason;
    const teacher = teacherResult.value;
    if (!teacher?.uid || !teacher.emailVerified) throw new HeroError(503, 'teacher_unavailable', 'The teacher account is unavailable. Try again later.');
    return { uid: user.uid, email: String(user.email || '').slice(0,254), teacherId: teacher.uid,
      isTeacher: user.uid === teacher.uid && String(user.email).toLowerCase() === TEACHER_EMAIL };
  }
  async function handler(req, res) {
    res.set('Cache-Control', 'no-store'); res.set('Vary', 'Origin');
    const origin = req.get('origin');
    if (!allowedOrigin(origin)) return res.status(403).json({ error: { code: 'origin_not_allowed', message: 'Open My Hero from Ans Key.' } });
    res.set('Access-Control-Allow-Origin', origin); res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Firebase-AppCheck');
    // Every award is a cross-origin POST with an Authorization header, so the
    // browser asks permission first. Without a max age it re-asks every few
    // seconds, and each ask is a full round trip to us-central1 before the
    // award itself is even sent. Browsers cap this (Chrome at 2 hours).
    res.set('Access-Control-Max-Age', '7200');
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ error: { code: 'method_not_allowed', message: 'Use POST for hero actions.' } });
    try {
      if (!/^application\/json(?:;|$)/i.test(req.get('content-type') || '')) throw new HeroError(415, 'invalid_request', 'Send a JSON hero action.');
      if ((req.rawBody?.length || 0) > 240000) throw new HeroError(413, 'invalid_request', 'That hero action is too large.');
      const body = validateHeroRequest(req.body), actor = await identify(req);
      const result = await repository.execute(actor, body);
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof HeroError) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
      report('hero_request_failed');
      return res.status(503).json({ error: { code: 'hero_unavailable', message: 'Your hero could not be saved. Try again; your progress is safe.' } });
    }
  }
  return { handler };
}
module.exports = { HeroError, validateHeroRequest, createHeroService };
