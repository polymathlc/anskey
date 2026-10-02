'use strict';

const { APP_ID, TEACHER_EMAIL, allowedOrigin } = require('./live-service');
class HeroError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const TYPES = new Set(['me', 'catalog', 'claim', 'cancelClaim', 'claims', 'approve', 'reject', 'unlink', 'configure', 'battle', 'wheelAward', 'assist', 'endEncounter']);
function validateHeroRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !TYPES.has(body.type)) throw new HeroError(400, 'invalid_request', 'Choose a valid hero action.');
  return body;
}
function createHeroService({ auth, appCheck, repository, report = () => {} }) {
  async function identify(req) {
    const bearer = /^Bearer ([^\s]+)$/.exec(req.get('authorization') || '');
    if (!bearer) throw new HeroError(401, 'sign_in_required', 'Sign in to open My Hero.');
    let user;
    try { user = await auth.verifyIdToken(bearer[1], true); }
    catch { throw new HeroError(401, 'sign_in_required', 'Sign in again to open My Hero.'); }
    if (!user?.uid || user.email_verified !== true || user.firebase?.sign_in_provider !== 'google.com') throw new HeroError(403, 'verified_account_required', 'Use your verified Google account to claim a hero.');
    try {
      const token = req.get('x-firebase-appcheck');
      if (!token || (await appCheck.verifyToken(token)).appId !== APP_ID) throw new Error('wrong app');
    } catch { throw new HeroError(403, 'app_check_required', 'Refresh Ans Key to verify access to My Hero.'); }
    const teacher = await auth.getUserByEmail(TEACHER_EMAIL);
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
