'use strict';

// ✉ A student's account email, changed by the teacher and VERIFIED by the
// student (v1.194.0).
//
// Every student signs in with Google, so their account is a Firebase Auth user
// whose email is the Google address they first used. When that address has to
// change (a parent's Gmail that was used by mistake, a school address that is
// going away, a new account), the teacher asks for it here and NOTHING changes
// until the new address proves it is the student's:
//
//   1. `request`  (teacher only) records the change and has FIREBASE AUTH'S OWN
//      MAILER send a "verify your new email" message to the new address. That
//      is the VERIFY_AND_CHANGE_EMAIL out-of-band code, sent with the project's
//      own credential, so there is no mail server, no mail key and no template
//      to keep: it is the same mailer and the same template the project's
//      password resets and verifications already use. If Firebase refuses to
//      send it, the SAME verified link is generated and handed back to the
//      teacher, who sends it from their own Gmail (the library's way of
//      sending); the change still happens only when the link is opened.
//   2. The student opens the link. Firebase's own handler changes the
//      account's email at that moment, signs the account out everywhere and
//      tells the OLD address (with a link to undo it). Until then the old
//      address stays exactly as it was.
//   3. `status`   (teacher) and `mine` (the student) notice the change has
//      happened and finish it here: the roster row (`studentProfiles/{uid}`)
//      takes the new address, so the library's Bcc and every app on the
//      shared roster write to the right person.
//   4. `mine` also MOVES THE SIGN-IN. A student whose new address is a Google
//      account and who signs in with it lands, the first time, on a brand new
//      empty account. Only once the change is verified, and only from that
//      empty account (no roster row, so nothing is lost), the Google sign-in
//      is moved onto the student's real account and the empty one is removed;
//      from then on the new Google account opens their own worksheets, marks
//      and hero. The old Google account no longer opens it.
//
// The record is `accountEmailChanges/{uid}`, written only here (the Admin SDK
// is not bound by the browser rules) and never trusted from a browser.
const { APP_ID, TEACHER_EMAIL, allowedOrigin } = require('./live-service');

const COLLECTION = 'accountEmailChanges';
const PROFILES = 'studentProfiles';
const PROJECT_ID = 'mathgen--app';
// A verification link sent by Firebase stays usable for a few days; after a
// week an unopened request is shown as expired and may simply be sent again.
const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// How many verification emails one student's account may be sent in a day:
// enough for a typo and a retry or two, never a way to flood an inbox.
const SENDS_PER_DAY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const STATUS_MAX_UIDS = 300;
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL_MAX = 254;
// Deliberately plain: one @, something before it, a dotted domain after it, no
// spaces or angle brackets. Google decides whether the mailbox exists.
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

class EmailChangeError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra || null; }
}

function cleanEmail(value) {
  return String(value == null ? '' : value).trim().replace(/^mailto:/i, '').toLowerCase();
}
function validEmail(value) {
  const email = cleanEmail(value);
  return email.length > 3 && email.length <= EMAIL_MAX && EMAIL_RE.test(email);
}
function sameEmail(a, b) {
  return !!a && !!b && cleanEmail(a) === cleanEmail(b);
}
function stamp(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : 0;
}
// The sends made in the last day, newest last. Pure, so the limit is tested.
function recentSends(list, now) {
  return (Array.isArray(list) ? list : []).map(Number).filter(t => Number.isFinite(t) && now - t < DAY_MS && t <= now + 60000).sort((a, b) => a - b);
}
// Where the email's "continue" button brings the student back to. Built from
// the page the teacher is on, never from anything in the body; any origin this
// service would refuse gets the published site instead.
function continueUrlFor(origin) {
  const base = allowedOrigin(origin) && /^https:\/\//.test(origin || '') ? origin : 'https://polymathlc.github.io';
  return base + '/anskey/?emailChanged=1';
}
// What the browser is allowed to see of a record. Never the whole document.
function publicChange(rec, now) {
  if (!rec || !rec.to) return null;
  const at = stamp(rec.requestedAt);
  let status = String(rec.status || 'sent');
  if ((status === 'sent' || status === 'link') && at && now - at > PENDING_TTL_MS) status = 'expired';
  return {
    from: rec.from || '', to: rec.to, status, via: rec.via === 'teacher' ? 'teacher' : 'firebase',
    requestedAt: at || null, doneAt: stamp(rec.doneAt) || null, movedAt: stamp(rec.movedAt) || null,
    sendsToday: recentSends(rec.sends, now).length, sendsLeft: Math.max(0, SENDS_PER_DAY - recentSends(rec.sends, now).length)
  };
}
// A profile is "set up" once it has a level: that is the line the app itself
// draws (profileComplete). An account with no row, or a row with no level, has
// nothing on it that removing the account could lose.
function profileSetUp(data) {
  return !!(data && (data.level || data.name || data.managed));
}

function validateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new EmailChangeError(400, 'invalid_request', 'Send an email change.');
  const type = String(body.type || '');
  if (type === 'request') {
    const uid = String(body.uid || ''), email = cleanEmail(body.email);
    if (!UID_RE.test(uid)) throw new EmailChangeError(400, 'invalid_request', 'That student is not valid.');
    if (/^managed_/.test(uid)) throw new EmailChangeError(400, 'no_account', 'This student has no Google account to change — they practise from your device.');
    if (!validEmail(email)) throw new EmailChangeError(400, 'bad_email', 'That does not look like an email address. Check it and try again.');
    return { type, uid, email, replaceEmpty: body.replaceEmpty === true };
  }
  if (type === 'status') {
    const list = Array.isArray(body.uids) ? body.uids : (body.uid ? [body.uid] : []);
    if (!list.length || list.length > STATUS_MAX_UIDS) throw new EmailChangeError(400, 'invalid_request', 'Ask about between 1 and ' + STATUS_MAX_UIDS + ' students.');
    const uids = [];
    list.forEach(u => { u = String(u || ''); if (UID_RE.test(u) && !/^managed_/.test(u) && uids.indexOf(u) === -1) uids.push(u); });
    return { type, uids };
  }
  if (type === 'cancel') {
    const uid = String(body.uid || '');
    if (!UID_RE.test(uid)) throw new EmailChangeError(400, 'invalid_request', 'That student is not valid.');
    return { type, uid };
  }
  if (type === 'mine') return { type };
  throw new EmailChangeError(400, 'invalid_request', 'Choose a valid email action.');
}

// The Identity Toolkit's reasons, in words a teacher can act on.
function mailerReason(code) {
  const c = String(code || '').toUpperCase();
  if (/EMAIL_EXISTS/.test(c)) return 'That address already belongs to another account.';
  if (/INVALID_EMAIL|INVALID_NEW_EMAIL/.test(c)) return 'That address was refused as invalid.';
  if (/USER_NOT_FOUND|EMAIL_NOT_FOUND/.test(c)) return 'The student’s account could not be found.';
  if (/TOO_MANY_ATTEMPTS|QUOTA|RESOURCE_EXHAUSTED/.test(c)) return 'Too many emails have been sent just now. Try again later.';
  if (/OPERATION_NOT_ALLOWED|CONFIGURATION_NOT_FOUND|PERMISSION_DENIED/.test(c)) return 'Firebase is not set up to send this email.';
  return '';
}

function createAccountEmailService({ auth, appCheck, db, mailer, now = () => Date.now(), report = () => {} }) {
  const TEACHER_TTL_MS = 5 * 60 * 1000;
  let teacherLookup = null;
  function teacherRecord() {
    const t = now();
    if (teacherLookup && t - teacherLookup.at < TEACHER_TTL_MS) return teacherLookup.promise;
    const entry = { at: t, promise: null };
    entry.promise = Promise.resolve().then(() => auth.getUserByEmail(TEACHER_EMAIL)).then(teacher => {
      if (!teacher?.uid || !teacher.emailVerified) { if (teacherLookup === entry) teacherLookup = null; }
      return teacher;
    }, error => { if (teacherLookup === entry) teacherLookup = null; throw error; });
    teacherLookup = entry;
    return entry.promise;
  }
  // Everyone proves who they are and that they are using Ans Key itself. The
  // teacher actions then also prove they are the teacher.
  async function identify(req, teacherOnly) {
    const bearer = /^Bearer ([^\s]+)$/.exec(req.get('authorization') || '');
    if (!bearer) throw new EmailChangeError(401, 'sign_in_required', 'Sign in to Ans Key first.');
    const token = req.get('x-firebase-appcheck');
    const [userResult, appResult, teacherResult] = await Promise.allSettled([
      auth.verifyIdToken(bearer[1], true),
      token ? appCheck.verifyToken(token) : Promise.reject(new Error('missing')),
      teacherOnly ? teacherRecord() : Promise.resolve(null)
    ]);
    if (userResult.status !== 'fulfilled') throw new EmailChangeError(401, 'sign_in_required', 'Sign in again and try once more.');
    const user = userResult.value;
    if (!user?.uid) throw new EmailChangeError(401, 'sign_in_required', 'Sign in again and try once more.');
    if (appResult.status !== 'fulfilled' || appResult.value?.appId !== APP_ID) throw new EmailChangeError(403, 'app_check_required', 'Refresh Ans Key and try again.');
    if (!teacherOnly) return user;
    if (user.email_verified !== true) throw new EmailChangeError(403, 'teacher_required', 'Only the teacher can change a student’s email.');
    if (teacherResult.status !== 'fulfilled') throw teacherResult.reason;
    const teacher = teacherResult.value;
    if (!teacher?.uid || !teacher.emailVerified) throw new EmailChangeError(503, 'teacher_unavailable', 'The teacher account is unavailable. Try again later.');
    if (user.uid !== teacher.uid || cleanEmail(user.email) !== TEACHER_EMAIL) throw new EmailChangeError(403, 'teacher_required', 'Only the teacher can change a student’s email.');
    return user;
  }

  const changeRef = uid => db.collection(COLLECTION).doc(uid);
  const profileRef = uid => db.collection(PROFILES).doc(uid);
  async function readChange(uid) {
    const snap = await changeRef(uid).get();
    return snap.exists ? snap.data() : null;
  }
  async function readProfile(uid) {
    const snap = await profileRef(uid).get();
    return snap.exists ? snap.data() : null;
  }
  async function userOrNull(fn, arg) {
    try { return await fn(arg); } catch (error) {
      if (error && (error.code === 'auth/user-not-found' || /user-not-found|no user record/i.test(String(error.message || '')))) return null;
      throw error;
    }
  }

  // The account's email has become the requested one: write it onto the
  // roster row (merge, so nothing else on the row moves) and close the record.
  async function finish(uid, rec, user) {
    const t = now();
    await profileRef(uid).set({ email: cleanEmail(user.email), emailChangedFrom: rec.from || '', emailChangedAt: t, updatedAt: t }, { merge: true });
    const done = Object.assign({}, rec, { status: 'done', doneAt: t });
    await changeRef(uid).set(done, { merge: true });
    return done;
  }
  // Looks at one student's record against their real account and finishes it
  // when the link has been opened. Returns the record as it now stands.
  async function settle(uid, rec, user) {
    if (!rec || !rec.to) return rec;
    if ((rec.status === 'sent' || rec.status === 'link') && user && sameEmail(user.email, rec.to)) return finish(uid, rec, user);
    return rec;
  }

  async function request({ uid, email, replaceEmpty }, teacher, continueUrl) {
    if (uid === teacher.uid) throw new EmailChangeError(400, 'not_a_student', 'This is your own account. Change it in your Google account instead.');
    if (email === TEACHER_EMAIL) throw new EmailChangeError(400, 'bad_email', 'That is the teacher’s address.');
    const student = await userOrNull(u => auth.getUser(u), uid);
    if (!student) throw new EmailChangeError(404, 'no_account', 'This student has no account to change. They need to sign in with Google once first.');
    if (!student.email) throw new EmailChangeError(400, 'no_email', 'This account has no email on it to change.');
    if (sameEmail(student.email, email)) throw new EmailChangeError(400, 'same_email', 'That is already this student’s email.');
    const other = await userOrNull(e => auth.getUserByEmail(e), email);
    if (other && other.uid !== uid) {
      const otherProfile = await readProfile(other.uid);
      // An account that signed in once and was never set up holds nothing, and
      // is usually the student trying the new address themselves. Removing it
      // is offered, never done on its own.
      if (profileSetUp(otherProfile)) {
        throw new EmailChangeError(409, 'email_in_use', 'That address already belongs to ' + (otherProfile.name ? '“' + String(otherProfile.name).slice(0, 80) + '”' : 'another student') + '’s account.');
      }
      if (!replaceEmpty) {
        throw new EmailChangeError(409, 'email_in_use_empty', 'That address already has an empty account (it signed in once and was never set up). Remove it so the address can move to this student?');
      }
      await auth.deleteUser(other.uid);
      if (otherProfile) await profileRef(other.uid).delete().catch(() => report('email_empty_profile_delete_failed'));
      report('email_empty_account_removed');
    }
    const t = now();
    const rec = (await readChange(uid)) || {};
    const sends = recentSends(rec.sends, t);
    if (sends.length >= SENDS_PER_DAY) throw new EmailChangeError(429, 'too_many', 'This student has been sent ' + SENDS_PER_DAY + ' verification emails today. Try again tomorrow.');
    let via = 'firebase', link = '', mailerError = '';
    try {
      await mailer.send({ email: student.email, newEmail: email, continueUrl: continueUrl || '' });
    } catch (error) {
      mailerError = String(error?.code || error?.message || 'send_failed');
      report('email_change_send_failed', error);
      if (/EMAIL_EXISTS/i.test(mailerError)) throw new EmailChangeError(409, 'email_in_use', mailerReason(mailerError));
      if (/INVALID_EMAIL|INVALID_NEW_EMAIL/i.test(mailerError)) throw new EmailChangeError(400, 'bad_email', mailerReason(mailerError));
      // The mailer would not send it. The SAME verified change can still be
      // made: hand the link to the teacher, who sends it from their own Gmail.
      try {
        link = await mailer.link({ email: student.email, newEmail: email });
        via = 'teacher';
      } catch (linkError) {
        report('email_change_link_failed', linkError);
        throw new EmailChangeError(503, 'mailer_unavailable', (mailerReason(mailerError) || 'The verification email could not be sent.') + ' Nothing was changed. Try again in a moment.');
      }
    }
    const next = {
      uid, from: cleanEmail(student.email), to: email, status: via === 'teacher' ? 'link' : 'sent', via,
      requestedAt: t, requestedBy: teacher.uid, doneAt: null, movedAt: null, cancelledAt: null,
      sends: sends.concat([t]), mailerError: mailerError ? mailerError.slice(0, 200) : ''
    };
    await changeRef(uid).set(next);
    const out = { change: publicChange(next, t) };
    if (link) { out.link = link; out.reason = mailerReason(mailerError); }
    return out;
  }

  async function status({ uids }) {
    const t = now();
    const changes = {};
    for (let i = 0; i < uids.length; i += 25) {
      const slice = uids.slice(i, i + 25);
      await Promise.all(slice.map(async uid => {
        let rec = await readChange(uid);
        if (!rec || !rec.to) return;
        if (rec.status === 'sent' || rec.status === 'link') {
          const user = await userOrNull(u => auth.getUser(u), uid).catch(() => null);
          if (user) rec = await settle(uid, rec, user).catch(error => { report('email_change_settle_failed', error); return rec; });
        }
        changes[uid] = publicChange(rec, t);
      }));
    }
    return { changes };
  }

  async function cancel({ uid }) {
    const rec = await readChange(uid);
    if (!rec || !rec.to) return { change: null };
    if (rec.status !== 'sent' && rec.status !== 'link') return { change: publicChange(rec, now()) };
    // The link already in the inbox is Firebase's and cannot be recalled; the
    // record says the teacher withdrew it, and a later `status` still notices
    // honestly if the student opens it anyway.
    const next = Object.assign({}, rec, { status: 'cancelled', cancelledAt: now() });
    await changeRef(uid).set(next, { merge: true });
    return { change: publicChange(next, now()) };
  }

  // The signed-in student's own side: finish a verified change, and move a
  // new Google sign-in onto the account it belongs to.
  async function mine(user) {
    if (cleanEmail(user.email) === TEACHER_EMAIL) return { change: null };
    const t = now();
    // 1. This account itself had a change: finish it once the link was opened.
    const own = await readChange(user.uid);
    if (own && own.to) {
      const record = await userOrNull(u => auth.getUser(u), user.uid);
      const settled = record ? await settle(user.uid, own, record) : own;
      return { change: publicChange(settled, t), moved: false };
    }
    // 2. A NEW account signed in with an address some student's change went
    //    to. Only a verified (done) change moves anything, only to its own
    //    student, and only from an empty account.
    const email = cleanEmail(user.email);
    if (!email || user.email_verified !== true) return { change: null, moved: false };
    const found = await db.collection(COLLECTION).where('to', '==', email).limit(5).get();
    const docs = [];
    found.forEach(d => docs.push({ id: d.id, data: d.data() }));
    const target = docs.filter(d => d.id !== user.uid).sort((a, b) => stamp(b.data.requestedAt) - stamp(a.data.requestedAt))[0];
    if (!target) return { change: null, moved: false };
    let rec = target.data;
    const owner = await userOrNull(u => auth.getUser(u), target.id);
    if (!owner) return { change: null, moved: false };
    if (rec.status === 'sent' || rec.status === 'link') rec = await settle(target.id, rec, owner);
    if (rec.status === 'cancelled' || rec.status === 'expired') return { change: null, moved: false };
    if (rec.status !== 'done' && rec.status !== 'moved') {
      return { change: null, moved: false, waiting: true, message: 'Open the verification email sent to ' + email + ' first, then sign in again.' };
    }
    if (!sameEmail(owner.email, email)) return { change: null, moved: false };
    const here = await userOrNull(u => auth.getUser(u), user.uid);
    if (!here) return { change: null, moved: false };
    const hereProfile = await readProfile(user.uid);
    if (profileSetUp(hereProfile)) {
      // This account has its own work on it. Nothing is removed.
      return { change: null, moved: false, conflict: true, message: 'This Google account already has its own Ans Key profile, so it was not moved. Ask your teacher.' };
    }
    const google = (here.providerData || []).find(p => p && p.providerId === 'google.com');
    if (!google || !google.uid) return { change: null, moved: false };
    const before = (owner.providerData || []).find(p => p && p.providerId === 'google.com') || null;
    // The new Google sign-in can belong to one account only, so the empty
    // account goes first, then the old Google sign-in comes off the student's
    // account and the new one goes on. A failure part-way puts the old
    // sign-in back, so the student is never left with no way in.
    await auth.deleteUser(user.uid);
    if (hereProfile) await profileRef(user.uid).delete().catch(() => report('email_move_profile_delete_failed'));
    try {
      if (before) await auth.updateUser(target.id, { providersToUnlink: ['google.com'] });
      await auth.updateUser(target.id, { providerToLink: { providerId: 'google.com', uid: google.uid, email, displayName: google.displayName || undefined, photoURL: google.photoURL || undefined } });
    } catch (error) {
      report('email_move_failed', error);
      if (before) {
        await auth.updateUser(target.id, { providerToLink: { providerId: 'google.com', uid: before.uid, email: before.email || undefined, displayName: before.displayName || undefined, photoURL: before.photoURL || undefined } })
          .catch(e => report('email_move_restore_failed', e));
      }
      throw new EmailChangeError(503, 'move_failed', 'Your new Google account could not be connected yet. Sign in again in a minute.');
    }
    await auth.revokeRefreshTokens(target.id).catch(() => report('email_move_revoke_failed'));
    const moved = Object.assign({}, rec, { status: 'moved', movedAt: now(), movedFrom: before ? before.uid : '' });
    await changeRef(target.id).set(moved, { merge: true });
    return { change: publicChange(moved, now()), moved: true, message: 'Your Ans Key account now signs in with ' + email + '. Sign in with Google again.' };
  }

  async function handler(req, res) {
    res.set('Cache-Control', 'no-store'); res.set('Vary', 'Origin');
    const origin = req.get('origin');
    if (!allowedOrigin(origin)) return res.status(403).json({ error: { code: 'origin_not_allowed', message: 'Change an email from Ans Key.' } });
    res.set('Access-Control-Allow-Origin', origin); res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Firebase-AppCheck');
    res.set('Access-Control-Max-Age', '7200');
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ error: { code: 'method_not_allowed', message: 'Use POST.' } });
    try {
      if (!/^application\/json(?:;|$)/i.test(req.get('content-type') || '')) throw new EmailChangeError(415, 'invalid_request', 'Send the request as JSON.');
      if ((req.rawBody?.length || 0) > 20000) throw new EmailChangeError(413, 'invalid_request', 'That request is too large.');
      const body = validateBody(req.body);
      const user = await identify(req, body.type !== 'mine');
      let result;
      if (body.type === 'request') {
        // The continue button points back at the page the teacher used.
        result = await request(body, user, continueUrlFor(origin));
      } else if (body.type === 'status') result = await status(body);
      else if (body.type === 'cancel') result = await cancel(body);
      else result = await mine(user);
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof EmailChangeError) {
        const payload = { code: error.code, message: error.message };
        return res.status(error.status).json({ error: payload });
      }
      report('email_change_failed', error);
      return res.status(503).json({ error: { code: 'email_change_unavailable', message: 'The email change could not be made just now. Nothing was changed; try again.' } });
    }
  }
  return { handler, identify, request, status, cancel, mine, settle };
}

// Firebase Auth's own mailer, reached through the Identity Toolkit with the
// project's service credential. Sent WITHOUT returnOobLink, the toolkit emails
// the code itself using the project's "verify new email" template. A continue
// address the project has not authorised is dropped and the send retried, so a
// domain list that does not include the site never costs the email.
function createFirebaseMailer({ accessToken, fetchImpl = fetch, projectId = PROJECT_ID, adminAuth }) {
  const url = 'https://identitytoolkit.googleapis.com/v1/projects/' + encodeURIComponent(projectId) + '/accounts:sendOobCode';
  async function post(body) {
    const token = await accessToken();
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body)
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      const message = String(data?.error?.message || ('HTTP_' + res.status));
      const err = new Error(message); err.code = message.split(':')[0].trim(); err.status = res.status;
      throw err;
    }
    return data || {};
  }
  return {
    async send({ email, newEmail, continueUrl }) {
      const body = { requestType: 'VERIFY_AND_CHANGE_EMAIL', email, newEmail, targetProjectId: projectId };
      if (continueUrl) body.continueUrl = continueUrl;
      try { return await post(body); } catch (error) {
        if (continueUrl && /UNAUTHORIZED_DOMAIN|INVALID_CONTINUE_URI|DOMAIN/i.test(String(error.code || error.message))) {
          delete body.continueUrl;
          return post(body);
        }
        throw error;
      }
    },
    async link({ email, newEmail }) {
      if (!adminAuth || typeof adminAuth.generateVerifyAndChangeEmailLink !== 'function') throw new Error('link_unavailable');
      return adminAuth.generateVerifyAndChangeEmailLink(email, newEmail);
    }
  };
}

module.exports = {
  COLLECTION, PROFILES, PENDING_TTL_MS, SENDS_PER_DAY, STATUS_MAX_UIDS, EmailChangeError,
  cleanEmail, validEmail, sameEmail, recentSends, continueUrlFor, publicChange, profileSetUp, validateBody, mailerReason,
  createAccountEmailService, createFirebaseMailer
};
