'use strict';
// 🎥 The live class (v1.207.0): a video lesson inside Ans Key, on LiveKit.
//
// This function is the ONLY place a LiveKit credential exists. The browser
// never sees the API secret: it asks here for a short-lived access token,
// signed with the secret, that lets ONE identity into ONE room with exactly
// the permissions its role is allowed. Everything else — the room, the
// cameras, the questions and the answers — then flows between the browsers
// and LiveKit Cloud directly.
//
// Who may do what is decided here and nowhere else:
//   - The teacher (the one admin account, verified, with App Check) may save
//     the LiveKit keys, open and close the class, mute or remove a
//     participant, and join with `roomAdmin`.
//   - Any other signed-in, non-anonymous account with App Check is a student.
//     A student may join ONLY while the teacher has the class open, and only
//     as the name they picked and confirmed (`r:<family>_<student>` from the
//     /office roster, or `g:<their own uid>` for a trial) — the identity is the
//     server's, so a student can never speak as the teacher. A student removed this
//     lesson is refused until the teacher lets them back in.
//
// Storage, all written with the Admin SDK only:
//   ansKeyLiveClassConfig/livekit  — {url, apiKey, secret:{v,iv,tag,data}, at, by}
//                                    The secret is AES-256-GCM encrypted with a
//                                    key derived (HKDF) from a server secret, so
//                                    the document alone is not a credential.
//   ansKeyLiveClassState/main      — {open, epoch, room, startedAt, closedAt,
//                                    teacherUid, removed:{uid:at}, letIn}
//   ansKeyLiveClassConfig/settings — {earlyMin} how early students may join
//   liveClassRooms/main            — {open, epoch, room, startedAt, at}
//                                    A public MIRROR the student's app listens
//                                    to so a "Class is live" badge can appear.
//                                    It decides nothing: every token is judged
//                                    against the server-only state above.
// The ansKeyLiveClass* collections are server-only like ansKeyLiveSessions;
// never add client rules for them.

const { createHash, createHmac, createCipheriv, createDecipheriv, hkdfSync, randomBytes } = require('node:crypto');
const { APP_ID, TEACHER_EMAIL, allowedOrigin } = require('./live-service');

const CONFIG_COLLECTION = 'ansKeyLiveClassConfig';
const STATE_COLLECTION = 'ansKeyLiveClassState';
const MIRROR_COLLECTION = 'liveClassRooms';
const LIVE_CLASS_LIMITS = Object.freeze({
  bodyBytes: 20000,
  urlMax: 300,
  keyMax: 120,
  secretMin: 16,
  secretMax: 400,
  nameMax: 60,
  identityMax: 140,
  teacherTtlSeconds: 6 * 3600,
  studentTtlSeconds: 4 * 3600,
  removedMax: 200,
  checkTimeoutMs: 8000
});
const ACTIONS = new Set(['status', 'config', 'configure', 'forget', 'open', 'close', 'slots', 'roster', 'token', 'mute', 'remove', 'readmit', 'settings', 'letin', 'passes', 'repass', 'pass', 'study']);
const TEACHER_ACTIONS = new Set(['config', 'configure', 'forget', 'open', 'close', 'slots', 'mute', 'remove', 'readmit', 'settings', 'letin', 'passes', 'repass']);
// 🔗 Personal links and PINs (v1.210.0). A child's own link carries a code
// the server can CHECK but nobody can make: the roster key, a generation
// (bumped when a link is lost) and an HMAC over both, keyed from the same
// server secret as the LiveKit secret's seal but with its own HKDF label. The
// PIN is the short spoken fallback: four digits, unique across the roster,
// tried only while a class is open, and counted so it cannot be walked.
const PASS_INFO = 'personal-link-v1';
const PASS_MAC_CHARS = 16;                 // 96 bits of base64url
const PASS_RE = /^([A-Za-z0-9-]{1,60}_[A-Za-z0-9-]{1,60})\.(\d{1,6})\.([A-Za-z0-9_-]{16})$/;
const PIN_RE = /^\d{4}$/;
const PIN_WEAK = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321', '0123', '9876', '1212', '6969', '2580', '1004', '2000', '2026', '2027']);
const PIN_LIMITS = Object.freeze({ windowMs: 10 * 60 * 1000, perUid: 6, total: 60 });
// 📖 The same link or PIN signs a child into Study Buddy (v1.211.0). The
// account is the CHILD's on the /office roster, not the device's: a custom
// token for `office-<family>-<child>` carrying `officePass: true`, so the
// child's mistake book and worksheets follow them to any device. A PIN can be
// typed at any hour on Study Buddy (there is no class to be open), so its
// misses are counted in a bucket of their own, tighter and over an hour.
const STUDY_UID_PREFIX = 'office-';
const STUDY_PIN_LIMITS = Object.freeze({ windowMs: 60 * 60 * 1000, perUid: 5, total: 30 });
const PROFILES_COLLECTION = 'studentProfiles';
const STUDY_ONBOARD_VERSION = 2;           // Study Buddy's ONBOARD_VERSION
const LIVE_CLASS_ORIGINS = Object.freeze(['https://polymathlc.github.io', 'https://polymathlc.com.sg', 'https://www.polymathlc.com.sg']);
const ROOM_PREFIX = 'polymath-class-';
const HKDF_SALT = 'ans-key-live-class';
const HKDF_INFO = 'livekit-api-secret-v1';

class LiveClassError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function fail(status, code, message) { throw new LiveClassError(status, code, message); }

/* ---------- pure helpers (all exported for the tests) ---------- */

function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(typeof input === 'string' ? input : JSON.stringify(input));
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(text) {
  const s = String(text || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(s + '='.repeat((4 - s.length % 4) % 4), 'base64');
}

// A LiveKit access token is an ordinary HS256 JWT: the API key is the issuer,
// the identity is the subject, and `video` holds the grants.
function signAccessToken({ apiKey, apiSecret, identity, name, ttlSeconds, video, metadata, attributes, now }) {
  if (!apiKey || !apiSecret) throw new Error('LiveKit keys are missing.');
  const t = Math.floor((now == null ? Date.now() : now) / 1000);
  const payload = {
    iss: apiKey,
    nbf: t - 10,
    exp: t + Math.max(60, Math.floor(ttlSeconds || 3600)),
    video: video || {}
  };
  if (identity) { payload.sub = identity; payload.jti = identity; }
  if (name) payload.name = name;
  if (metadata) payload.metadata = typeof metadata === 'string' ? metadata : JSON.stringify(metadata);
  if (attributes && Object.keys(attributes).length) payload.attributes = attributes;
  const head = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url(payload);
  const sig = b64url(createHmac('sha256', apiSecret).update(head + '.' + body).digest());
  return head + '.' + body + '.' + sig;
}
function readAccessToken(token, apiSecret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const sig = b64url(createHmac('sha256', apiSecret).update(parts[0] + '.' + parts[1]).digest());
  if (sig !== parts[2]) return null;
  try { return JSON.parse(b64urlDecode(parts[1]).toString('utf8')); } catch { return null; }
}

// The LiveKit project URL, as LiveKit Cloud shows it: wss://name.livekit.cloud.
// A self-hosted server (or the test server) may be ws:// on localhost only.
function cleanUrl(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text || text.length > LIVE_CLASS_LIMITS.urlMax) return '';
  let u;
  try { u = new URL(text); } catch { return ''; }
  if (u.username || u.password || u.search || u.hash) return '';
  const local = /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
  if (u.protocol === 'https:') u.protocol = 'wss:';
  if (u.protocol === 'http:' && local) u.protocol = 'ws:';
  if (u.protocol !== 'wss:' && !(u.protocol === 'ws:' && local)) return '';
  if (!/^[a-z0-9.-]+$/i.test(u.hostname)) return '';
  const path = u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '');
  return u.protocol + '//' + u.host + path;
}
// The server API lives on the same host over HTTP(S).
function httpBase(url) {
  const clean = cleanUrl(url);
  if (!clean) return '';
  return clean.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
}
function cleanKey(value) {
  const text = String(value == null ? '' : value).trim();
  return /^[A-Za-z0-9_-]{4,120}$/.test(text) ? text : '';
}
function cleanSecret(value) {
  const text = String(value == null ? '' : value).trim();
  if (text.length < LIVE_CLASS_LIMITS.secretMin || text.length > LIVE_CLASS_LIMITS.secretMax) return '';
  return /^[\x21-\x7e]+$/.test(text) ? text : '';
}
function maskKey(key) {
  const k = String(key || '');
  if (k.length <= 6) return k ? '••••' : '';
  return k.slice(0, 3) + '•••' + k.slice(-3);
}
function cleanName(value, fallback) {
  const text = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (text || fallback || '').slice(0, LIVE_CLASS_LIMITS.nameMax);
}
// t: the teacher · r: a roster student (the students/{id} doc, so a mark or a
// point lands on the same record the wheel and the rewards use) · g: a trial
// guest, keyed by the device's own (often anonymous) account.
function cleanIdentity(value) {
  const text = String(value == null ? '' : value);
  return /^[trg]:[A-Za-z0-9_-]{1,128}$/.test(text) ? text : '';
}
function cleanSlot(value) { const text = String(value == null ? '' : value).trim(); return isSlotId(text) ? text : ''; }
/* ---------- the class list: /office's enrolled students ----------
   polymathlc.com.sg/office (polymathlc/cer office/) is where the centre keeps
   every family: `officeFamilies/{id}` = {status, lastMonth, pauseFrom,
   pauseUntil, email, email2, students:[{id, name, level, status,
   classes:[{slotId:'WED-2', mode, custom, label}]}]}, and the timetable is
   `schedule_config/main.slots[slotId]` = {level, subject, type, …}. Those
   collections are admin-only, so only this function reads them, and a
   student's device is only ever sent NAMES — never a parent, a phone number
   or a fee. The timetable constants below are office-core.mjs's (DAYS,
   WEEKDAY_TIMES, SATURDAY_TIMES); keep them equal. */
const OFFICE_FAMILIES = 'officeFamilies';
const SCHEDULE_DOC = ['schedule_config', 'main'];
const WEEKDAY_TIMES = [{ n: 1, label: '3:00pm – 4:45pm' }, { n: 2, label: '5:00pm – 6:45pm' }, { n: 3, label: '7:00pm – 8:45pm' }];
const SATURDAY_TIMES = [{ n: 1, label: '9:00am – 10:45am' }, { n: 2, label: '11:00am – 12:45pm' }, { n: 3, label: '1:00pm – 2:45pm' }];
const DAYS = [
  { code: 'MON', name: 'Monday', short: 'Mon', times: WEEKDAY_TIMES }, { code: 'TUE', name: 'Tuesday', short: 'Tue', times: WEEKDAY_TIMES },
  { code: 'WED', name: 'Wednesday', short: 'Wed', times: WEEKDAY_TIMES }, { code: 'THU', name: 'Thursday', short: 'Thu', times: WEEKDAY_TIMES },
  { code: 'FRI', name: 'Friday', short: 'Fri', times: WEEKDAY_TIMES }, { code: 'SAT', name: 'Saturday', short: 'Sat', times: SATURDAY_TIMES }
];
function slotParts(id) {
  const [code, n] = String(id || '').split('-');
  const day = DAYS.find(d => d.code === code) || null;
  const time = day ? day.times.find(t => String(t.n) === String(n)) || null : null;
  return { day, time };
}
function isSlotId(id) { const p = slotParts(id); return !!(p.day && p.time); }
function levelLabel(level) {
  const v = String(level || '').trim();
  if (/^P[1-6]$/i.test(v)) return 'P' + v.slice(1);
  if (/^S(ec)?\s*\d$/i.test(v)) return 'Sec ' + v.replace(/\D/g, '');
  return v;
}
// "Wed 5:00pm · P5 Science" — the label a teacher and a child both read.
function slotLabel(id, schedule) {
  const { day, time } = slotParts(id);
  if (!day || !time) return String(id || '');
  const slot = ((schedule && schedule.slots) || {})[id] || {};
  const what = slot.level && slot.subject ? (slot.type === 'master' ? 'Master Class · ' : '') + levelLabel(slot.level) + ' ' + slot.subject : '';
  return day.short + ' ' + time.label.split(/\s*[–—-]\s*/)[0] + (what ? ' · ' + what : '');
}
function startMinutes(label) {
  const m = String(label || '').match(/(\d{1,2}):(\d{2})\s*([ap])\.?m/i);
  if (!m) return 24 * 60;
  return (Number(m[1]) % 12 + (m[3].toLowerCase() === 'p' ? 12 : 0)) * 60 + Number(m[2]);
}
function slotOrder(id) {
  const { day, time } = slotParts(id);
  return day ? DAYS.indexOf(day) * 2000 + startMinutes(time && time.label) : 99999;
}
// "YYYY-MM" in Singapore.
function sgMonth(nowMs) { return new Date((Number(nowMs) || Date.now()) + 8 * 3600000).toISOString().slice(0, 7); }
function monthOf(v) { const m = /^(\d{4})-(\d{2})/.exec(String(v || '')); return m ? m[1] + '-' + m[2] : ''; }

/* ---- 🚪 The lesson-time gate (v1.208.0) ----------------------------------
   A student may join only once THEIR lesson is about to start: a P6 child who
   opens the class link while the P5 class is still being taught is told when
   their lesson starts instead of walking into somebody else's. The class's own
   slot decides it: from `earlyMin` minutes before its start time (Singapore
   time, the timetable's own clock) the door is open, and it stays open after
   the end time, because a lesson that runs over is still the same lesson. A
   class started on another day (a lesson moved to a Monday) waits for the
   teacher's "Let students in now" (`letIn`), which opens it whatever the
   clock says. All of it is decided HERE: the browser only paints the wait. */
const SG_OFFSET_MS = 8 * 3600000;
const DAY_MS = 86400000;
const EARLY_DEFAULT = 10;
const EARLY_MAX = 120;
const DAY_CODES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
function cleanEarly(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return EARLY_DEFAULT;
  return Math.max(0, Math.min(EARLY_MAX, n));
}
function cleanSettings(d) {
  const o = d && typeof d === 'object' ? d : {};
  return { earlyMin: o.earlyMin === undefined ? EARLY_DEFAULT : cleanEarly(o.earlyMin) };
}
// Where `ms` falls in Singapore: the day's code, minutes since midnight and
// the instant that midnight was.
function sgClock(ms) {
  const local = Number(ms) + SG_OFFSET_MS;
  const midnight = local - (((local % DAY_MS) + DAY_MS) % DAY_MS);
  const d = new Date(local);
  return { code: DAY_CODES[d.getUTCDay()], dayIndex: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), midnight: midnight - SG_OFFSET_MS };
}
// A slot's start and end in minutes, from the timetable's own labels.
function slotTimes(id) {
  const { day, time } = slotParts(id);
  if (!day || !time) return null;
  const [a, b] = time.label.split(/\s*[–—-]\s*/);
  return { code: day.code, dayName: day.name, start: startMinutes(a), end: startMinutes(b || a), startLabel: a, endLabel: b || '' };
}
function clockLabel(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = m % 60;
  return ((h % 12) || 12) + ':' + String(mm).padStart(2, '0') + (h < 12 ? 'am' : 'pm');
}
// { open:true } or { open:false, reason, startsAt, opensAt, message }.
function joinGate(slotId, nowMs, earlyMin, letIn) {
  if (letIn === true) return { open: true, reason: 'let_in' };
  const times = slotTimes(slotId);
  if (!times) return { open: true, reason: 'no_slot' };
  const early = cleanEarly(earlyMin);
  const c = sgClock(nowMs);
  const target = DAY_CODES.indexOf(times.code);
  let ahead = (target - c.dayIndex + 7) % 7;
  if (ahead === 0 && c.minutes >= times.start - early) return { open: true, reason: 'on_time' };
  const startsAt = c.midnight + ahead * DAY_MS + times.start * 60000;
  const opensAt = startsAt - early * 60000;
  const from = early ? ' You can join from ' + clockLabel(times.start - early) + '.' : '';
  if (ahead === 0) {
    return { open: false, reason: 'early', startsAt, opensAt, early, now: nowMs,
      message: 'Your lesson starts at ' + times.startLabel + '.' + from };
  }
  return { open: false, reason: 'other_day', startsAt, opensAt, early, now: nowMs,
    message: 'This class is on ' + times.dayName + ' at ' + times.startLabel + '. Your teacher can let you in early.' };
}
// A make-up pick whose OWN lesson is later today: they belong in that lesson,
// not in this one. Null when nothing stands in the way.
function laterLessonToday(student, currentSlot, nowMs, earlyMin, schedule) {
  const c = sgClock(nowMs);
  const early = cleanEarly(earlyMin);
  for (const id of (student && student.slots) || []) {
    if (id === currentSlot) continue;
    const t = slotTimes(id);
    if (!t || t.code !== c.code) continue;
    if (c.minutes < t.start - early) {
      return { slot: id, startsAt: c.midnight + t.start * 60000, opensAt: c.midnight + (t.start - early) * 60000,
        message: 'Your lesson today (' + slotLabel(id, schedule) + ') starts at ' + t.startLabel + '.' + (early ? ' You can join it from ' + clockLabel(t.start - early) + '.' : '') };
    }
  }
  return null;
}
// office-core's familyStateIn: is this family with the centre THIS month?
function familyState(f, period) {
  let status = String(f && f.status || 'active');
  if (status === 'inactive' || f.withdrawn === true || f.withdrawn === 'yes') status = status === 'paused' ? 'paused' : 'withdrawn';
  if (status === 'withdrawn') { const last = monthOf(f.lastMonth); return last && period <= last ? 'active' : 'withdrawn'; }
  if (status === 'paused') {
    const from = monthOf(f.pauseFrom), until = monthOf(f.pauseUntil);
    if (from && period < from) return 'active';
    if (until && period > until) return 'active';
    return 'paused';
  }
  return 'active';
}
const ID_RE = /^[A-Za-z0-9-]{1,60}$/;
// The roster key of one child: family and child ids, joined with "_" (neither
// may hold one), so `r:<key>` names the same child in every lesson.
function rosterKey(familyId, studentId) {
  return ID_RE.test(String(familyId || '')) && ID_RE.test(String(studentId || '')) ? familyId + '_' + studentId : '';
}
function splitRosterKey(key) {
  const m = /^([A-Za-z0-9-]{1,60})_([A-Za-z0-9-]{1,60})$/.exec(String(key || ''));
  return m ? { familyId: m[1], studentId: m[2] } : null;
}
// Every enrolled child, current this month, with the slots they attend.
function enrolledStudents(families, period) {
  const out = [];
  for (const f of families || []) {
    if (!f || familyState(f, period) !== 'active') continue;
    for (const st of Array.isArray(f.students) ? f.students : []) {
      if (!st || (st.status && st.status !== 'active')) continue;
      const id = rosterKey(f.id, st.id);
      const name = cleanName(st.name, '');
      if (!id || !name) continue;
      const slots = (Array.isArray(st.classes) ? st.classes : []).filter(c => c && !c.custom && isSlotId(c.slotId)).map(c => c.slotId);
      if (!slots.length) continue;
      out.push({ id, name, level: cleanName(st.level, '').slice(0, 12), slots: [...new Set(slots)] });
    }
  }
  return out;
}
// The teacher's "Lesson slot" list: every slot with a child in it, in week order.
function slotChoices(students, schedule) {
  const count = new Map();
  for (const s of students) for (const id of s.slots) count.set(id, (count.get(id) || 0) + 1);
  return [...count.keys()].sort((a, b) => slotOrder(a) - slotOrder(b))
    .map(id => ({ slot: id, label: slotLabel(id, schedule), count: count.get(id) }));
}
// The "Who are you?" lists. Names are shown IN FULL, surname included: two
// Ethans in one centre is the commonest way a child takes another child's
// name. A name still shared after that carries its level, then its slot.
function rosterLists(students, slot, schedule) {
  const all = students.filter(s => s && s.name && s.id && Array.isArray(s.slots) && s.slots.length);
  const byName = new Map();
  for (const s of all) { const k = s.name.toLowerCase(); byName.set(k, (byName.get(k) || 0) + 1); }
  const byNameLevel = new Map();
  for (const s of all) { const k = s.name.toLowerCase() + '|' + s.level; byNameLevel.set(k, (byNameLevel.get(k) || 0) + 1); }
  const label = s => {
    if (byName.get(s.name.toLowerCase()) < 2) return s.name;
    if (s.level && byNameLevel.get(s.name.toLowerCase() + '|' + s.level) < 2) return s.name + ' (' + s.level + ')';
    return s.name + ' (' + slotLabel(s.slots[0], schedule) + ')';
  };
  const sortByName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  const mine = all.filter(s => s.slots.includes(slot)).sort(sortByName)
    .map(s => ({ id: s.id, name: s.name, label: label(s), level: s.level }));
  const mineIds = new Set(mine.map(s => s.id));
  const groups = new Map();
  for (const s of all) {
    if (mineIds.has(s.id)) continue;
    const home = [...s.slots].sort((a, b) => slotOrder(a) - slotOrder(b))[0];
    if (!groups.has(home)) groups.set(home, []);
    groups.get(home).push({ id: s.id, name: s.name, label: label(s), level: s.level, slot: home });
  }
  const others = [...groups.entries()].sort((a, b) => slotOrder(a[0]) - slotOrder(b[0]))
    .map(([g, list]) => ({ slot: g, label: slotLabel(g, schedule), students: list.sort(sortByName) }));
  return { students: mine, others };
}
function roomFor(epoch) { return ROOM_PREFIX + String(epoch); }
// A new epoch is always later than the last one, even if the clock stepped back.
function nextEpoch(prev, now) {
  const p = Number(prev) || 0;
  return Math.max(p + 1, Math.floor(Number(now) || Date.now()));
}

// The permissions each role gets. A student may publish a camera and a
// microphone and send data (their answers) but never share a screen, never
// administer the room and never change their own name or metadata.
function grantsFor(role, room) {
  if (role === 'teacher') {
    return { room, roomJoin: true, roomAdmin: true, canPublish: true, canSubscribe: true, canPublishData: true, canUpdateOwnMetadata: true };
  }
  return {
    room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true,
    canPublishSources: ['camera', 'microphone'], canUpdateOwnMetadata: false
  };
}

/* ---------- the secret at rest ---------- */

function deriveKey(master) {
  if (!master || String(master).length < 16) throw new LiveClassError(503, 'server_not_ready', 'The live class server is not ready yet. Try again in a minute.');
  return Buffer.from(hkdfSync('sha256', Buffer.from(String(master)), Buffer.from(HKDF_SALT), Buffer.from(HKDF_INFO), 32));
}
function sealSecret(secret, master) {
  const key = deriveKey(master), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64'),
    fp: createHash('sha256').update(String(master)).digest('hex').slice(0, 12) };
}
function openSecret(sealed, master) {
  if (!sealed || sealed.v !== 1) return '';
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(master), Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8');
  } catch (error) {
    if (error instanceof LiveClassError) throw error;
    return '';
  }
}

/* ---------- 🔗 personal links and PINs (v1.210.0) ---------- */

function passKey(master) {
  if (!master || String(master).length < 16) throw new LiveClassError(503, 'server_not_ready', 'The live class server is not ready yet. Try again in a minute.');
  return Buffer.from(hkdfSync('sha256', Buffer.from(String(master)), Buffer.from(HKDF_SALT), Buffer.from(PASS_INFO), 32));
}
function passMac(rosterId, gen, master) {
  return b64url(createHmac('sha256', passKey(master)).update('pass|' + rosterId + '|' + (Number(gen) || 0)).digest()).slice(0, PASS_MAC_CHARS);
}
// The code a child's link carries: `<family>_<child>.<gen>.<mac>`.
function passCode(rosterId, gen, master) {
  if (!splitRosterKey(rosterId)) return '';
  const g = Math.max(0, Math.floor(Number(gen) || 0));
  return rosterId + '.' + g + '.' + passMac(rosterId, g, master);
}
function parsePass(code) {
  const m = PASS_RE.exec(String(code == null ? '' : code).trim());
  if (!m || !splitRosterKey(m[1])) return null;
  return { rosterId: m[1], gen: Number(m[2]), mac: m[3] };
}
function sameText(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
// A code is good when its MAC is right AND its generation is the one on file
// (a link the teacher replaced stops working, even though its MAC is real).
function checkPass(code, passes, master) {
  const p = parsePass(code);
  if (!p) return null;
  if (!sameText(p.mac, passMac(p.rosterId, p.gen, master))) return null;
  const entry = passes && passes[p.rosterId];
  const gen = entry ? Number(entry.gen) || 0 : 0;
  if (p.gen !== gen) return null;
  return p.rosterId;
}
function cleanPin(v) {
  const t = String(v == null ? '' : v).replace(/\s+/g, '');
  return PIN_RE.test(t) ? t : '';
}
// One child's PIN: drawn from the HMAC (so the same roster gives the same
// PINs on any server), stepping past weak and taken ones.
function pinFor(rosterId, gen, taken, master) {
  for (let i = 0; i < 400; i++) {
    const h = createHmac('sha256', passKey(master)).update('pin|' + rosterId + '|' + (Number(gen) || 0) + '|' + i).digest();
    const pin = String(h.readUInt32BE(0) % 10000).padStart(4, '0');
    if (PIN_WEAK.has(pin) || taken.has(pin)) continue;
    return pin;
  }
  return '';
}
function cleanPasses(raw) {
  const out = {};
  const list = raw && typeof raw === 'object' && raw.list && typeof raw.list === 'object' ? raw.list : {};
  for (const id of Object.keys(list)) {
    const e = list[id];
    if (!splitRosterKey(id) || !e || typeof e !== 'object') continue;
    out[id] = { gen: Math.max(0, Math.floor(Number(e.gen) || 0)), pin: cleanPin(e.pin), at: Number(e.at) || 0 };
  }
  return out;
}
// Gives every enrolled child an entry (generation 0 and a PIN of its own).
// Entries for children who left are KEPT: a child who comes back keeps their
// link and PIN. Returns the new map and whether anything changed.
function ensurePasses(passes, students, master, t) {
  const next = { ...passes };
  const taken = new Set(Object.values(next).map(e => e.pin).filter(Boolean));
  let changed = false;
  const seen = new Set();
  for (const e of Object.values(next)) {
    if (!e.pin) continue;
    if (seen.has(e.pin)) { e.pin = ''; changed = true; } else seen.add(e.pin);
  }
  const ids = students.map(s => s.id).sort();
  for (const id of ids) {
    const e = next[id] ? { ...next[id] } : { gen: 0, pin: '', at: t };
    if (!next[id]) changed = true;
    if (!e.pin) {
      e.pin = pinFor(id, e.gen, taken, master);
      if (e.pin) taken.add(e.pin);
      changed = true;
    }
    next[id] = e;
  }
  return { passes: next, changed };
}
function pinOwner(pin, passes) {
  const p = cleanPin(pin);
  if (!p) return '';
  const hits = Object.keys(passes).filter(id => passes[id].pin === p);
  return hits.length === 1 ? hits[0] : '';
}
// Wrong PINs are counted in ten-minute windows, per account and in all: a
// child mistyping is fine; a script walking 0000–9999 is not.
function pinTriesAllowed(tries, uid, t, limits) {
  const L = limits || PIN_LIMITS;
  const w = tries && Number(tries.win) && t - Number(tries.win) < L.windowMs ? tries : { win: t, total: 0, by: {} };
  const mine = Number(w.by && w.by[uid]) || 0;
  return { ok: mine < L.perUid && (Number(w.total) || 0) < L.total, window: w };
}
function pinTriesAfterMiss(window, uid) {
  const by = { ...(window.by || {}) };
  by[uid] = (Number(by[uid]) || 0) + 1;
  const keys = Object.keys(by);
  if (keys.length > 300) keys.slice(0, keys.length - 300).forEach(k => delete by[k]);
  return { win: window.win, total: (Number(window.total) || 0) + 1, by };
}

/* ---------- 📖 Study Buddy from the same link (v1.211.0) ---------- */

// Whole origins only: a lookalike such as polymathlc.com.sg.example is not one.
function liveClassOrigin(origin) {
  const o = String(origin || '');
  return LIVE_CLASS_ORIGINS.includes(o) || allowedOrigin(o);
}
// The child's own Study Buddy account. Both ids are already [A-Za-z0-9-], so
// the uid is stable, readable in the console and never collides with a
// Firebase-made uid (those have no dashes).
function studyUid(rosterId) {
  const k = splitRosterKey(rosterId);
  return k ? STUDY_UID_PREFIX + k.familyId + '-' + k.studentId : '';
}
// "Maths", "Math", "Mathematics", "Science", "Maths & Science" → the words
// this app and Study Buddy store ('math' | 'science').
function subjectWords(text) {
  const t = String(text || '').toLowerCase();
  const out = [];
  if (/\bmath/.test(t)) out.push('math');
  if (/\bscience/.test(t)) out.push('science');
  return out;
}
// Every subject the child's own lessons are (their slots in the timetable).
function slotSubjects(slots, schedule) {
  const table = (schedule && schedule.slots) || {};
  const set = new Set();
  for (const id of Array.isArray(slots) ? slots : []) {
    const row = table[id];
    if (!row) continue;
    for (const w of subjectWords(row.subject)) set.add(w);
  }
  return [...set].sort();
}
// The one subject value a profile holds. P3 is Science only (the rule
// levelSubjects carries in both apps); two subjects are 'both'; a child whose
// slots name no subject falls back to the level's widest choice, which only
// ever shows MORE worksheets, never none.
function studySubject(level, subjects) {
  const lv = String(level || '').toUpperCase();
  if (lv === 'P3') return 'science';
  const list = Array.isArray(subjects) ? subjects : [];
  if (list.includes('math') && list.includes('science')) return 'both';
  if (list.length === 1) return list[0];
  return 'both';
}
// A level the two apps can match on: "P5", never "Primary 5" / "p5".
function studyLevel(level) {
  const v = String(level || '').trim();
  const m = /^(?:p|pri|primary)\s*([1-6])$/i.exec(v);
  return m ? 'P' + m[1] : v.slice(0, 12);
}
// What the server writes onto the child's roster row on every sign-in, so
// Study Buddy and Ans Key both follow /office the moment it changes.
// `tutorOnboard` answers Study Buddy's first-sign-in questions for them: the
// centre's own child is enrolled and pays no app fee.
function studyProfileDoc(student, schedule, rosterId, t, existing) {
  const level = studyLevel(student.level);
  const subject = studySubject(level, slotSubjects(student.slots, schedule));
  const doc = {
    name: student.name, level, subject,
    officeId: rosterId, levelSource: 'office', officeSlots: (student.slots || []).slice(0, 8),
    tutorOnboard: { v: STUDY_ONBOARD_VERSION, parent: '', students: [{ name: student.name, level, subject }], enrolled: true,
      payingFee: false, fee: '', via: 'office', at: new Date(Number(t) || Date.now()).toISOString() },
    updatedAt: Number(t) || Date.now()
  };
  if (!existing) doc.createdAt = Number(t) || Date.now();
  return doc;
}

/* ---------- requests ---------- */

function validateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !ACTIONS.has(body.action)) {
    fail(400, 'invalid_request', 'Choose a valid live class action.');
  }
  return body;
}

// LiveKit's server API is Twirp: a JSON POST per method.
async function roomService(fetchImpl, cfg, method, body, now) {
  const base = httpBase(cfg.url);
  if (!base) throw new LiveClassError(503, 'not_configured', 'Add the LiveKit keys first.');
  const token = signAccessToken({
    apiKey: cfg.apiKey, apiSecret: cfg.apiSecret, ttlSeconds: 600, now,
    video: { roomAdmin: true, roomList: true, roomCreate: true, room: body && body.room ? body.room : undefined }
  });
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), LIVE_CLASS_LIMITS.checkTimeoutMs) : null;
  try {
    const res = await fetchImpl(base + '/twirp/livekit.RoomService/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body || {}),
      signal: ctl ? ctl.signal : undefined
    });
    const text = await res.text().catch(() => '');
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch { data = null; }
    if (!res.ok) {
      const err = new LiveClassError(res.status === 401 || res.status === 403 ? 400 : 502,
        res.status === 401 || res.status === 403 ? 'keys_refused' : 'livekit_error',
        res.status === 401 || res.status === 403 ? 'LiveKit refused those keys. Copy the API key and secret again from the same project.'
          : (data && data.msg ? 'LiveKit said: ' + String(data.msg).slice(0, 200) : 'LiveKit could not be reached. Try again.'));
      err.upstream = res.status; err.twirp = data && data.code;
      throw err;
    }
    return data || {};
  } catch (error) {
    if (error instanceof LiveClassError) throw error;
    throw new LiveClassError(502, 'livekit_unreachable', 'LiveKit could not be reached. Check the project URL and try again.');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// The teacher's rows: name, level, the slots they attend (labelled), the link
// code and the PIN, in week order of their first slot, then by name.
function passRows(students, passes, schedule, master) {
  return students.map(s => {
    const e = passes[s.id] || { gen: 0, pin: '' };
    const slots = [...s.slots].sort((a, b) => slotOrder(a) - slotOrder(b));
    return { id: s.id, name: s.name, level: s.level, slots: slots.map(id => ({ slot: id, label: slotLabel(id, schedule) })), gen: e.gen, pin: e.pin, code: master ? passCode(s.id, e.gen, master) : '', _first: slots[0] || '' };
  }).sort((a, b) => (slotOrder(a._first) - slotOrder(b._first)) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
    .map(r => { delete r._first; return r; });
}
function createLiveClassService({ auth, appCheck, db, master, fetchImpl = (...a) => fetch(...a), now = () => Date.now(), lessonClock = null, report = () => {}, serverTimestamp = null }) {
  // The clock the lesson-time door reads (Singapore wall time). The same as
  // `now` in production; a check can move the lesson day without moving the
  // clock tokens are signed with.
  const doorNow = typeof lessonClock === 'function' ? lessonClock : now;
  const configRef = db.collection(CONFIG_COLLECTION).doc('livekit');
  const stateRef = db.collection(STATE_COLLECTION).doc('main');
  const mirrorRef = db.collection(MIRROR_COLLECTION).doc('main');
  const settingsRef = db.collection(CONFIG_COLLECTION).doc('settings');
  const passesRef = db.collection(CONFIG_COLLECTION).doc('passes');
  const pinTriesRef = db.collection(STATE_COLLECTION).doc('pins');
  // 📖 Study Buddy PINs are counted apart, in hour-long windows: a Study
  // Buddy PIN works at any hour, so it gets a tighter, slower bucket than the
  // class door's (which is only ever open for a lesson).
  const studyTriesRef = db.collection(STATE_COLLECTION).doc('studyPins');
  async function readPasses() {
    const snap = await passesRef.get();
    return cleanPasses(snap.exists ? snap.data() : null);
  }
  async function writePasses(passes, t, by) {
    await passesRef.set({ v: 1, list: passes, at: t, by: by || '' });
  }
  // 🔗 Who a code or a PIN names, or a refusal in words. A PIN is tried only
  // while a class is open and every miss is counted (pinTriesAllowed).
  async function resolvePass(actor, p, state) {
    const passes = await readPasses();
    if (p.kind === 'pass') {
      const id = checkPass(p.code, passes, master());
      if (!id) fail(404, 'pass_unknown', 'That class link is not working any more. Choose your name from the list, or ask your teacher for a new link.');
      return id;
    }
    if (!state.open) fail(409, 'class_closed', 'The live class has not started yet. Type your PIN again when your teacher starts it.');
    const t = now();
    let tries = null;
    try { const snap = await pinTriesRef.get(); tries = snap.exists ? snap.data() : null; } catch (error) { report('live_class_pin_tries', error); }
    const allowed = pinTriesAllowed(tries, actor.uid, t);
    if (!allowed.ok) fail(429, 'pin_wait', 'Too many wrong PINs. Wait ten minutes, or choose your name from the list.');
    const id = pinOwner(p.pin, passes);
    if (!id) {
      try { await pinTriesRef.set(pinTriesAfterMiss(allowed.window, actor.uid)); } catch (error) { report('live_class_pin_tries', error); }
      fail(404, 'pin_unknown', cleanPin(p.pin) ? 'That PIN is not right. Check the four numbers your teacher gave you.' : 'Type the four numbers of your PIN.');
    }
    return id;
  }
  async function readSettings() {
    try { const snap = await settingsRef.get(); return cleanSettings(snap.exists ? snap.data() : null); }
    catch (error) { report('live_class_settings_read', error); return cleanSettings(null); }
  }

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

  async function identify(req) {
    const bearer = /^Bearer ([^\s]+)$/.exec(req.get('authorization') || '');
    if (!bearer) fail(401, 'sign_in_required', 'Sign in to join the live class.');
    const appToken = req.get('x-firebase-appcheck');
    const [userResult, appResult, teacherResult] = await Promise.allSettled([
      auth.verifyIdToken(bearer[1], true),
      appToken ? appCheck.verifyToken(appToken) : Promise.reject(new Error('missing')),
      teacherRecord()
    ]);
    if (userResult.status !== 'fulfilled') fail(401, 'sign_in_required', 'Sign in again to join the live class.');
    const user = userResult.value;
    if (!user?.uid) fail(401, 'sign_in_required', 'Sign in again to join the live class.');
    // A student who is not signed in to Google arrives on an anonymous
    // account and says who they are on the "Who are you?" list. That is
    // allowed for a student; the teacher must be the verified admin.
    const provider = user.firebase?.sign_in_provider || '';
    const anonymous = provider === 'anonymous';
    if (appResult.status !== 'fulfilled' || appResult.value?.appId !== APP_ID) fail(403, 'app_check_required', 'Refresh Ans Key and try again.');
    if (teacherResult.status !== 'fulfilled') { report('live_class_teacher_lookup', teacherResult.reason); fail(503, 'teacher_unavailable', 'The class is unavailable right now. Try again shortly.'); }
    const teacher = teacherResult.value;
    if (!teacher?.uid || !teacher.emailVerified) fail(503, 'teacher_unavailable', 'The class is unavailable right now. Try again shortly.');
    const isTeacher = user.uid === teacher.uid && user.email_verified === true && String(user.email || '').toLowerCase() === TEACHER_EMAIL;
    return { uid: user.uid, name: cleanName(user.name, ''), email: String(user.email || '').slice(0, 254), teacherId: teacher.uid, isTeacher: isTeacher && !anonymous, anonymous };
  }

  async function readConfig(reveal) {
    const snap = await configRef.get();
    const data = snap.exists ? snap.data() : null;
    if (!data || !cleanUrl(data.url) || !cleanKey(data.apiKey) || !data.secret) return null;
    const cfg = { url: cleanUrl(data.url), apiKey: cleanKey(data.apiKey), at: Number(data.at) || 0 };
    if (reveal) {
      const secret = openSecret(data.secret, master());
      if (!secret) {
        cfg.broken = true;
      } else {
        cfg.apiSecret = secret;
      }
    }
    return cfg;
  }
  async function requireConfig() {
    const cfg = await readConfig(true);
    if (!cfg) fail(409, 'not_configured', 'The teacher has not set up the live class yet.');
    if (cfg.broken) fail(409, 'keys_unreadable', 'The saved LiveKit secret can no longer be read. Paste the keys again in ⚙ Settings.');
    return cfg;
  }
  async function readState() {
    const snap = await stateRef.get();
    const d = snap.exists ? snap.data() : {};
    return {
      open: d.open === true,
      epoch: Number(d.epoch) || 0,
      room: typeof d.room === 'string' ? d.room : '',
      startedAt: Number(d.startedAt) || 0,
      closedAt: Number(d.closedAt) || 0,
      teacherUid: typeof d.teacherUid === 'string' ? d.teacherUid : '',
      slot: typeof d.slot === 'string' ? d.slot : '',
      letIn: d.letIn === true,
      removed: d.removed && typeof d.removed === 'object' ? d.removed : {}
    };
  }
  function publicState(state) {
    return { open: state.open, epoch: state.epoch, room: state.open ? state.room : '', slot: state.open ? state.slot : '', startedAt: state.startedAt, closedAt: state.closedAt, letIn: state.open ? state.letIn === true : false };
  }
  async function writeMirror(state) {
    try {
      await mirrorRef.set({ open: state.open, epoch: state.epoch, room: state.open ? state.room : '', slot: state.open ? state.slot : '', startedAt: state.startedAt, letIn: state.open ? state.letIn === true : false, at: now() });
    } catch (error) {
      // The mirror only lights a badge; a refused write must not refuse the class.
      report('live_class_mirror_failed', error);
    }
  }

  function docsOf(snap) {
    const out = [];
    if (snap && typeof snap.forEach === 'function') snap.forEach(d => out.push({ ...(d.data() || {}), id: d.id }));
    return out;
  }
  function attrOf(p, key) {
    const a = p && p.attributes;
    if (a && typeof a === 'object' && typeof a[key] === 'string') return a[key];
    try { const m = JSON.parse(p.metadata || '{}'); return typeof m[key] === 'string' ? m[key] : ''; } catch { return ''; }
  }
  async function participantsIn(cfg, room, t) {
    try {
      const listed = await roomService(fetchImpl, cfg, 'ListParticipants', { room }, t);
      return Array.isArray(listed.participants) ? listed.participants : [];
    } catch (error) {
      // An empty room that LiveKit has not created yet answers 404: nobody is in it.
      if (error.upstream === 404) return [];
      throw error;
    }
  }
  // "Who are you?" — the pick a student confirmed, checked against the roster.
  async function whoIs(actor, pick, state, settings) {
    let p = pick && typeof pick === 'object' ? pick : {};
    if (p.kind === 'trial') {
      const name = cleanName(p.name, '');
      if (name.length < 2) fail(400, 'name_required', 'Type your full name so your teacher knows who you are.');
      return { kind: 'trial', identity: 'g:' + actor.uid, name: name, rosterId: '', level: '', home: '' };
    }
    // 🔗 A personal link or a PIN names the child; their own lesson or a
    // make-up is then worked out exactly as for a name picked from the list.
    let viaPass = '';
    if (p.kind === 'pass' || p.kind === 'pin') {
      viaPass = p.kind;
      const id = await resolvePass(actor, p, state);
      p = { kind: 'auto', id };
    }
    if (p.kind !== 'roster' && p.kind !== 'makeup' && p.kind !== 'auto') fail(400, 'pick_required', 'Choose your name from the list, then press Confirm.');
    const key = splitRosterKey(p.id);
    if (!key) fail(400, 'pick_required', 'Choose your name from the list, then press Confirm.');
    const [famSnap, schedule] = await Promise.all([db.collection(OFFICE_FAMILIES).doc(key.familyId).get(), readSchedule()]);
    const family = famSnap.exists ? { ...(famSnap.data() || {}), id: key.familyId } : null;
    const student = enrolledStudents(family ? [family] : [], sgMonth(now())).find(s => s.id === p.id) || null;
    if (!student) fail(404, 'not_on_roster', viaPass ? 'Your name is not on the class list this month. Ask your teacher.' : 'That name is no longer on the class list. Choose again, or ask your teacher.');
    if (p.kind === 'auto') p = { kind: !state.slot || student.slots.includes(state.slot) ? 'roster' : 'makeup', id: p.id };
    if (p.kind === 'roster' && state.slot && !student.slots.includes(state.slot)) fail(400, 'wrong_list', 'That name is in another class. Choose Make-up to find it.');
    if (p.kind === 'makeup' && state.letIn !== true) {
      const later = laterLessonToday(student, state.slot, doorNow(), settings ? settings.earlyMin : EARLY_DEFAULT, schedule);
      if (later) fail(403, 'not_yet', later.message);
    }
    const home = p.kind === 'makeup' ? [...student.slots].sort((a, b) => slotOrder(a) - slotOrder(b))[0] : state.slot;
    return { kind: p.kind, identity: 'r:' + student.id, name: student.name, rosterId: student.id,
      level: student.level, home: home ? slotLabel(home, schedule) : '', via: viaPass,
      slots: student.slots.slice(), schedule };
  }

  async function readSchedule() {
    try { const snap = await db.collection(SCHEDULE_DOC[0]).doc(SCHEDULE_DOC[1]).get(); return snap.exists ? snap.data() || {} : {}; }
    catch { return {}; }
  }
  async function enrolment(t) {
    const [famSnap, schedule] = await Promise.all([db.collection(OFFICE_FAMILIES).get(), readSchedule()]);
    return { students: enrolledStudents(docsOf(famSnap), sgMonth(t)), schedule };
  }

  async function action(actor, body) {
    if (TEACHER_ACTIONS.has(body.action) && !actor.isTeacher) fail(403, 'teacher_only', 'Only the teacher can do that.');
    const t = now();

    if (body.action === 'status') {
      const state = await readState();
      const out = { role: actor.isTeacher ? 'teacher' : 'student', ...publicState(state) };
      const settings = await readSettings();
      if (state.open) out.gate = joinGate(state.slot, doorNow(), settings.earlyMin, state.letIn);
      if (actor.isTeacher) {
        out.settings = settings;
        const cfg = await readConfig(false);
        out.configured = !!cfg;
        if (cfg) { out.url = cfg.url; out.apiKey = maskKey(cfg.apiKey); }
      }
      return out;
    }

    if (body.action === 'config') {
      const cfg = await readConfig(true);
      if (!cfg) return { configured: false };
      return { configured: true, url: cfg.url, apiKey: maskKey(cfg.apiKey), at: cfg.at, readable: !cfg.broken };
    }

    if (body.action === 'configure') {
      const url = cleanUrl(body.url), apiKey = cleanKey(body.apiKey), apiSecret = cleanSecret(body.apiSecret);
      if (!url) fail(400, 'bad_url', 'Paste the LiveKit project URL — it starts with wss:// and ends with .livekit.cloud.');
      if (!apiKey) fail(400, 'bad_key', 'Paste the API key exactly as LiveKit shows it (letters and numbers).');
      if (!apiSecret) fail(400, 'bad_secret', 'Paste the API secret exactly as LiveKit shows it.');
      // Prove the keys work BEFORE they replace keys that did.
      if (body.check !== false) await roomService(fetchImpl, { url, apiKey, apiSecret }, 'ListRooms', {}, t);
      await configRef.set({ url, apiKey, secret: sealSecret(apiSecret, master()), at: t, by: actor.uid });
      return { configured: true, url, apiKey: maskKey(apiKey), at: t, checked: body.check !== false };
    }

    if (body.action === 'forget') {
      await configRef.set({ url: '', apiKey: '', secret: null, at: t, by: actor.uid });
      return { configured: false };
    }

    if (body.action === 'open') {
      const cfg = await requireConfig();
      const prev = await readState();
      // Re-opening a class that is already open keeps its room: a teacher
      // whose tab reloaded must land back in the SAME lesson, with the same
      // students, not start an empty one beside it.
      const slot = cleanSlot(body.slot);
      let state = prev;
      if (!prev.open || body.fresh === true) {
        const epoch = nextEpoch(prev.epoch, t);
        state = { open: true, epoch, room: roomFor(epoch), slot, startedAt: t, closedAt: 0, teacherUid: actor.uid, removed: {}, letIn: false };
        await stateRef.set(state);
        await writeMirror(state);
      } else if (body.slot != null && slot !== prev.slot) {
        // The teacher picked another lesson slot for the class that is
        // running: only the "Who are you?" list changes.
        state = { ...prev, slot, letIn: false };
        await stateRef.set(state);
        await writeMirror(state);
      }
      const settings = await readSettings();
      return { ...publicState(state), gate: joinGate(state.slot, doorNow(), settings.earlyMin, state.letIn), settings, url: cfg.url, token: teacherToken(cfg, actor, state, t), identity: 't:' + actor.uid };
    }

    if (body.action === 'settings') {
      const prev = await readSettings();
      const next = cleanSettings({ ...prev, ...(body.earlyMin !== undefined ? { earlyMin: body.earlyMin } : {}) });
      if (body.earlyMin !== undefined) await settingsRef.set({ ...next, at: t, by: actor.uid });
      const state = await readState();
      return { settings: next, gate: state.open ? joinGate(state.slot, doorNow(), next.earlyMin, state.letIn) : null };
    }

    if (body.action === 'letin') {
      const prev = await readState();
      if (!prev.open) fail(409, 'class_closed', 'Start the class first.');
      const state = { ...prev, letIn: body.on !== false };
      await stateRef.set(state);
      await writeMirror(state);
      const settings = await readSettings();
      return { ...publicState(state), gate: joinGate(state.slot, doorNow(), settings.earlyMin, state.letIn) };
    }

    if (body.action === 'close') {
      const prev = await readState();
      const state = { ...prev, open: false, closedAt: t, letIn: false };
      await stateRef.set(state);
      await writeMirror(state);
      // Ending the room disconnects everyone at once; a failure here is not
      // a failure to close, because no new token is issued for it anyway.
      if (prev.room) {
        try { const cfg = await requireConfig(); await roomService(fetchImpl, cfg, 'DeleteRoom', { room: prev.room }, t); }
        catch (error) { report('live_class_delete_room', error); }
      }
      return publicState(state);
    }

    if (body.action === 'slots') {
      const { students, schedule } = await enrolment(t);
      return { slots: slotChoices(students, schedule) };
    }

    if (body.action === 'roster') {
      const state = await readState();
      if (!state.open) fail(409, 'class_closed', 'The live class has not started yet. It will open here when your teacher starts it.');
      const [{ students, schedule }, settings] = await Promise.all([enrolment(t), readSettings()]);
      const gate = joinGate(state.slot, doorNow(), settings.earlyMin, state.letIn);
      const label = state.slot ? slotLabel(state.slot, schedule) : '';
      // Before the lesson's time a waiting child is told when, and is sent no
      // names: the list is for the people in the lesson.
      if (!gate.open) return { slot: state.slot, slotLabel: label, epoch: state.epoch, gate, students: [], others: [] };
      const lists = rosterLists(students, state.slot, schedule);
      return { slot: state.slot, slotLabel: label, epoch: state.epoch, gate, ...lists };
    }

    // 🔗 The teacher's list of every child's link code and PIN. Missing
    // entries are made (and saved) on the way.
    if (body.action === 'passes') {
      const [{ students, schedule }, stored] = await Promise.all([enrolment(t), readPasses()]);
      const { passes, changed } = ensurePasses(stored, students, master(), t);
      if (changed) await writePasses(passes, t, actor.uid);
      return { students: passRows(students, passes, schedule, master()) };
    }
    // A lost link or an overheard PIN: a new generation (the old link stops
    // working at once) and a new PIN.
    if (body.action === 'repass') {
      const id = splitRosterKey(body.id) ? String(body.id) : '';
      if (!id) fail(400, 'invalid_request', 'Choose a student.');
      const [{ students, schedule }, stored] = await Promise.all([enrolment(t), readPasses()]);
      const student = students.find(s => s.id === id);
      if (!student) fail(404, 'not_on_roster', 'That student is not on the class list this month.');
      const prev = stored[id] || { gen: 0, pin: '', at: t };
      const others = new Set(Object.keys(stored).filter(k => k !== id).map(k => stored[k].pin).filter(Boolean));
      if (prev.pin) others.add(prev.pin);
      const gen = prev.gen + 1;
      const entry = { gen, pin: pinFor(id, gen, others, master()), at: t };
      const passes = { ...stored, [id]: entry };
      await writePasses(passes, t, actor.uid);
      return { student: passRows([student], passes, schedule, master())[0] };
    }
    // 🔗 A child's own link or PIN: who it is, and whether they may come in
    // now. The page shows "You are …" with one Join button.
    if (body.action === 'pass') {
      if (actor.isTeacher) fail(400, 'teacher_pass', 'This is a student\'s link. Open it on the student\'s device.');
      const kind = body.pin != null && body.code == null ? 'pin' : 'pass';
      const state = await readState();
      const passes = kind === 'pass' ? await readPasses() : null;
      // Before the class opens a link still says whose it is (a PIN does not:
      // it is only ever tried against an open class).
      if (!state.open) {
        if (kind === 'pin') fail(409, 'class_closed', 'The live class has not started yet. Type your PIN again when your teacher starts it.');
        const id = checkPass(body.code, passes, master());
        if (!id) fail(404, 'pass_unknown', 'That class link is not working any more. Choose your name from the list, or ask your teacher for a new link.');
        const [famSnap] = await Promise.all([db.collection(OFFICE_FAMILIES).doc(splitRosterKey(id).familyId).get()]);
        const fam = famSnap.exists ? { ...(famSnap.data() || {}), id: splitRosterKey(id).familyId } : null;
        const student = enrolledStudents(fam ? [fam] : [], sgMonth(t)).find(s => s.id === id);
        if (!student) fail(404, 'not_on_roster', 'Your name is not on the class list this month. Ask your teacher.');
        return { ...publicState(state), code: String(body.code), me: { id, name: student.name, level: student.level, kind: '' } };
      }
      const settings = await readSettings();
      const gate = joinGate(state.slot, doorNow(), settings.earlyMin, state.letIn);
      const schedule = await readSchedule();
      const label = state.slot ? slotLabel(state.slot, schedule) : '';
      if (!gate.open) {
        // A PIN is still checked before the door says "not yet", so a child
        // knows the four numbers were right.
        const id = await resolvePass(actor, kind === 'pin' ? { kind, pin: body.pin } : { kind, code: body.code }, state);
        const entry = (await readPasses())[id] || { gen: 0 };
        return { ...publicState(state), slotLabel: label, gate, code: passCode(id, entry.gen, master()), me: { id, name: '', level: '', kind: '' } };
      }
      const who = await whoIs(actor, kind === 'pin' ? { kind, pin: body.pin } : { kind, code: body.code }, state, settings);
      const entry = (await readPasses())[who.rosterId] || { gen: 0 };
      return { ...publicState(state), slotLabel: label, gate, code: passCode(who.rosterId, entry.gen, master()),
        me: { id: who.rosterId, name: who.name, level: who.level, kind: who.kind, home: who.home } };
    }

    // 📖 The same link or PIN signs the child into Study Buddy as THEMSELVES:
    // their roster row is brought up to date from /office (name, level, the
    // subjects of their own lessons) and a custom token for their own uid
    // comes back. It works at any hour (Study Buddy is homework, not a
    // lesson), never for the teacher, and a PIN miss is counted.
    if (body.action === 'study') {
      if (actor.isTeacher) fail(400, 'teacher_pass', 'This is a student\'s link. Open it on the student\'s device.');
      if (typeof auth.createCustomToken !== 'function') fail(503, 'study_unavailable', 'Study Buddy sign-in is unavailable right now. Try again shortly.');
      const kind = body.pin != null && body.code == null ? 'pin' : 'pass';
      const passes = await readPasses();
      let id = '';
      if (kind === 'pass') {
        id = checkPass(body.code, passes, master());
        if (!id) fail(404, 'pass_unknown', 'That link is not working any more. Ask your teacher for a new one.');
      } else {
        let tries = null;
        try { const snap = await studyTriesRef.get(); tries = snap.exists ? snap.data() : null; } catch (error) { report('live_class_study_tries', error); }
        const allowed = pinTriesAllowed(tries, actor.uid, t, STUDY_PIN_LIMITS);
        if (!allowed.ok) fail(429, 'pin_wait', 'Too many wrong PINs. Wait an hour, or open your personal link instead.');
        id = pinOwner(body.pin, passes);
        if (!id) {
          try { await studyTriesRef.set(pinTriesAfterMiss(allowed.window, actor.uid)); } catch (error) { report('live_class_study_tries', error); }
          fail(404, 'pin_unknown', cleanPin(body.pin) ? 'That PIN is not right. Check the four numbers your teacher gave you.' : 'Type the four numbers of your PIN.');
        }
      }
      const key = splitRosterKey(id);
      if (!key) fail(404, 'pass_unknown', 'That link is not working any more. Ask your teacher for a new one.');
      const [famSnap, schedule] = await Promise.all([db.collection(OFFICE_FAMILIES).doc(key.familyId).get(), readSchedule()]);
      const family = famSnap.exists ? { ...(famSnap.data() || {}), id: key.familyId } : null;
      const student = enrolledStudents(family ? [family] : [], sgMonth(t)).find(s => s.id === id) || null;
      if (!student) fail(404, 'not_on_roster', 'Your name is not on the class list this month. Ask your teacher.');
      const uid = studyUid(id);
      if (!uid) fail(404, 'pass_unknown', 'That link is not working any more. Ask your teacher for a new one.');
      const profileRef = db.collection(PROFILES_COLLECTION).doc(uid);
      let existing = null;
      try { const snap = await profileRef.get(); existing = snap.exists ? snap.data() || {} : null; } catch (error) { report('live_class_study_profile_read', error); }
      const doc = studyProfileDoc(student, schedule, id, t, existing);
      await profileRef.set(doc, { merge: true });
      const token = await auth.createCustomToken(uid, { officePass: true, officeId: id });
      const entry = passes[id] || { gen: 0 };
      return { token, uid, code: passCode(id, entry.gen, master()),
        me: { id, name: doc.name, level: doc.level, subject: doc.subject } };
    }

    if (body.action === 'token') {
      const state = await readState();
      if (!state.open || !state.room) fail(409, 'class_closed', actor.isTeacher ? 'Start the class first.' : 'The live class has not started yet. It will open here when your teacher starts it.');
      const cfg = await requireConfig();
      if (actor.isTeacher) return { ...publicState(state), url: cfg.url, token: teacherToken(cfg, actor, state, t), identity: 't:' + actor.uid };
      const settings = await readSettings();
      const gate = joinGate(state.slot, doorNow(), settings.earlyMin, state.letIn);
      if (!gate.open) fail(403, 'not_yet', gate.message);
      const who = await whoIs(actor, body.pick, state, settings);
      if (state.removed[who.identity]) fail(403, 'removed', 'Your teacher has taken you out of this class. Ask them to let you back in.');
      // The same name already in the class on ANOTHER device is nearly always
      // a child who tapped the wrong name. Ask before letting the second one in
      // (LiveKit would otherwise silently throw the first one out).
      if (body.takeover !== true) {
        const here = await participantsIn(cfg, state.room, t);
        const same = here.find(p => p.identity === who.identity);
        if (same && attrOf(same, 'uid') !== actor.uid) {
          fail(409, 'already_in', who.name + ' is already in the class on another device. If that really is you, press "Yes, it\'s me".');
        }
      }
      const attributes = { role: 'student', kind: who.kind, uid: actor.uid };
      if (who.rosterId) attributes.rosterId = who.rosterId;
      if (who.level) attributes.level = who.level;
      if (who.home) attributes.home = who.home.slice(0, 120);
      const token = signAccessToken({
        apiKey: cfg.apiKey, apiSecret: cfg.apiSecret, identity: who.identity, name: who.name, now: t,
        ttlSeconds: LIVE_CLASS_LIMITS.studentTtlSeconds, video: grantsFor('student', state.room),
        attributes, metadata: { role: 'student', kind: who.kind, rosterId: who.rosterId || '' }
      });
      const out = { ...publicState(state), url: cfg.url, token, identity: who.identity, name: who.name, kind: who.kind, rosterId: who.rosterId || '' };
      // A PIN join hands the device its link code, so next time it is one tap.
      if (who.via && who.rosterId) {
        const entry = (await readPasses())[who.rosterId] || { gen: 0 };
        out.code = passCode(who.rosterId, entry.gen, master());
      }
      return out;
    }

    if (body.action === 'mute' || body.action === 'remove' || body.action === 'readmit') {
      const state = await readState();
      if (body.action === 'readmit') {
        const identity = cleanIdentity(body.identity);
        if (!identity || identity.startsWith('t:')) fail(400, 'invalid_request', 'Choose a student to let back in.');
        const removed = { ...state.removed }; delete removed[identity];
        await stateRef.set({ ...state, removed });
        return { readmitted: identity };
      }
      if (!state.open || !state.room) fail(409, 'class_closed', 'The class is not running.');
      const cfg = await requireConfig();
      if (body.action === 'remove') {
        const identity = cleanIdentity(body.identity);
        if (!identity || identity.startsWith('t:')) fail(400, 'invalid_request', 'Choose a student to remove.');
        const removed = { ...state.removed, [identity]: t };
        const keys = Object.keys(removed);
        if (keys.length > LIVE_CLASS_LIMITS.removedMax) keys.sort((a, b) => removed[a] - removed[b]).slice(0, keys.length - LIVE_CLASS_LIMITS.removedMax).forEach(k => delete removed[k]);
        await stateRef.set({ ...state, removed });
        try { await roomService(fetchImpl, cfg, 'RemoveParticipant', { room: state.room, identity }, t); }
        catch (error) { if (error.upstream !== 404) throw error; }
        return { removed: identity };
      }
      // mute: one participant's microphone (or camera), or every student's.
      const source = body.source === 'camera' ? 'CAMERA' : 'MICROPHONE';
      const listed = await roomService(fetchImpl, cfg, 'ListParticipants', { room: state.room }, t);
      const want = body.all === true ? null : cleanIdentity(body.identity);
      if (!body.all && !want) fail(400, 'invalid_request', 'Choose who to mute.');
      let muted = 0;
      for (const p of Array.isArray(listed.participants) ? listed.participants : []) {
        const identity = String(p.identity || '');
        if (!identity || identity.startsWith('t:')) continue;          // never the teacher
        if (want && identity !== want) continue;
        for (const track of Array.isArray(p.tracks) ? p.tracks : []) {
          const src = String(track.source == null ? '' : track.source).toUpperCase();
          const isMic = src === 'MICROPHONE' || src === '2' || (src === '' && String(track.type).toUpperCase() === 'AUDIO');
          const isCam = src === 'CAMERA' || src === '1';
          if ((source === 'MICROPHONE' && isMic) || (source === 'CAMERA' && isCam)) {
            if (track.muted) continue;
            await roomService(fetchImpl, cfg, 'MutePublishedTrack', { room: state.room, identity, track_sid: track.sid, muted: true }, t);
            muted += 1;
          }
        }
      }
      return { muted };
    }
    fail(400, 'invalid_request', 'Choose a valid live class action.');
  }

  function teacherToken(cfg, actor, state, t) {
    return signAccessToken({
      apiKey: cfg.apiKey, apiSecret: cfg.apiSecret, identity: 't:' + actor.uid, name: 'Teacher', now: t,
      ttlSeconds: LIVE_CLASS_LIMITS.teacherTtlSeconds, video: grantsFor('teacher', state.room),
      attributes: { role: 'teacher', uid: actor.uid }, metadata: { role: 'teacher' }
    });
  }

  async function handler(req, res) {
    res.set('Cache-Control', 'no-store'); res.set('Vary', 'Origin');
    const origin = req.get('origin');
    if (!liveClassOrigin(origin)) return res.status(403).json({ error: { code: 'origin_not_allowed', message: 'Open the live class from Ans Key.' } });
    res.set('Access-Control-Allow-Origin', origin); res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Firebase-AppCheck');
    res.set('Access-Control-Max-Age', '7200');
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ error: { code: 'method_not_allowed', message: 'Use POST.' } });
    try {
      if (!/^application\/json(?:;|$)/i.test(req.get('content-type') || '')) fail(415, 'invalid_request', 'Send JSON.');
      if ((req.rawBody?.length || 0) > LIVE_CLASS_LIMITS.bodyBytes) fail(413, 'invalid_request', 'That request is too large.');
      const body = validateBody(req.body);
      const actor = await identify(req);
      const result = await action(actor, body);
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof LiveClassError) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
      report('live_class_failed', error);
      return res.status(503).json({ error: { code: 'live_class_unavailable', message: 'The live class could not be reached. Try again.' } });
    }
  }

  return { handler, action, identify };
}

module.exports = {
  CONFIG_COLLECTION, STATE_COLLECTION, MIRROR_COLLECTION, LIVE_CLASS_LIMITS, ROOM_PREFIX,
  LiveClassError, validateBody, createLiveClassService,
  signAccessToken, readAccessToken, b64url, b64urlDecode, cleanUrl, httpBase, cleanKey, cleanSecret, maskKey,
  EARLY_DEFAULT, EARLY_MAX, cleanEarly, cleanSettings, sgClock, slotTimes, clockLabel, joinGate, laterLessonToday,
  PASS_LIMITS_PIN: PIN_LIMITS, STUDY_PIN_LIMITS, STUDY_UID_PREFIX, PROFILES_COLLECTION, LIVE_CLASS_ORIGINS,
  liveClassOrigin, studyUid, subjectWords, slotSubjects, studySubject, studyLevel, studyProfileDoc, passCode, parsePass, checkPass, cleanPin, pinFor, cleanPasses, ensurePasses, pinOwner, pinTriesAllowed, pinTriesAfterMiss, passRows,
  cleanName, cleanIdentity, cleanSlot, rosterLists, enrolledStudents, slotChoices, slotLabel, familyState, rosterKey, splitRosterKey, sgMonth, roomFor, nextEpoch, grantsFor, sealSecret, openSecret, roomService
};
