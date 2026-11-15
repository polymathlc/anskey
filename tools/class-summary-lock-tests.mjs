// 🧾 Class summaries never get stuck (v1.202.0): one run at a time, but a run
// that hangs gives way. The pure rules, then the REAL glue cut out of
// index.html and run in a vm with the real aiWithDeadline and stubs for the
// worksheet, Firestore, Storage and the AI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const csSrc = readFileSync(new URL('../class-summary.js', import.meta.url), 'utf8');

function freshCS() {
  // A private copy per test, so a test that shrinks the budgets touches only itself.
  const m = { exports: {} };
  new Function('module', 'exports', csSrc)(m, m.exports);
  return m.exports;
}
const P = freshCS().pure;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Today: an automatic try after opening only catches up a RECENT class.
const DAY = P.dayKey(Date.now());
const OTHER = P.dayKey(Date.now() - 86400000);
const tsOn = (day, h = 17) => { const [y, mo, d] = day.split('-').map(Number); return new Date(y, mo - 1, d, h).getTime(); };

/* ---------------- the pure rules ---------------- */

test('a job is alive only while it keeps its promise', () => {
  const now = 1_000_000_000;
  assert.deepEqual(P.jobStale(null, now), { stale: true, why: 'none' });
  assert.equal(P.jobStale({ done: true, startedAt: now, until: now + 9e9 }, now).why, 'done');
  assert.equal(P.jobStale({ abandoned: true, startedAt: now, until: now + 9e9 }, now).why, 'abandoned');
  const live = { startedAt: now - 1000, until: now + 1000 };
  assert.deepEqual(P.jobStale(live, now), { stale: false, why: '' });
  assert.equal(P.jobStale({ startedAt: now - 1000, until: now - 1 }, now).why, 'quiet', 'a step that overran its budget is stuck');
  assert.equal(P.jobStale({ startedAt: now - P.JOB_MAX_MS - 1, until: now + 1e9 }, now).why, 'long', 'no run lives past JOB_MAX_MS');
  assert.equal(P.jobStale({ startedAt: 0, until: now + 1 }, now).why, 'long', 'a job with no start is not trusted');
  assert.equal(P.jobStale({ startedAt: now - 10 }, now).stale, false, 'no until yet: the grace applies');
  assert.equal(P.jobStale({ startedAt: now - P.STEP_GRACE_MS - 10 }, now).why, 'quiet');
});

test('arrival: a press never meets "already being written"', () => {
  const now = 5_000_000;
  const live = { day: DAY, docId: 'doc1', startedAt: now - 10, until: now + 60_000 };
  const stuck = { ...live, until: now - 1 };
  assert.equal(P.arrival(null, { trigger: 'manual', day: DAY, docId: 'doc1' }, now), 'start');
  assert.equal(P.arrival({ ...live, done: true }, { trigger: 'manual', day: DAY, docId: 'doc1' }, now), 'start');
  assert.equal(P.arrival(live, { trigger: 'manual', day: DAY, docId: 'doc1' }, now), 'join', 'the same class: follow it');
  assert.equal(P.arrival(live, { trigger: 'manual', day: '2026-11-14', docId: 'doc1' }, now), 'wait', 'another class: after it');
  assert.equal(P.arrival(live, { trigger: 'manual', day: DAY, docId: 'doc2' }, now), 'wait', 'another worksheet: after it');
  assert.equal(P.arrival(live, { trigger: 'lesson' }, now), 'queue');
  assert.equal(P.arrival(live, { trigger: 'open' }, now), 'queue');
  assert.equal(P.arrival(stuck, { trigger: 'manual', day: DAY, docId: 'doc1' }, now), 'takeover');
  assert.equal(P.arrival(stuck, { trigger: 'open' }, now), 'takeover', 'an automatic try also replaces a stuck one');
  assert.equal(P.arrival({ ...live, startedAt: now - P.JOB_MAX_MS - 5 }, { trigger: 'manual', day: DAY, docId: 'doc1' }, now), 'takeover');
});

test('every step has a budget, the whole run fits inside the cap, and the grace is added once', () => {
  const steps = ['captions', 'captionLoad', 'links', 'page', 'marks', 'write', 'picture', 'save'];
  steps.forEach(k => assert.ok(P.STEP_MS[k] > 0, k + ' has a budget'));
  assert.ok(P.STEP_MS.write >= 10 * 60 * 1000, 'Claude (5 min) and Chung GPT behind it fit');
  assert.ok(P.STEP_MS.captions + P.STEP_MS.write < P.JOB_MAX_MS, 'captions and the writing fit in one run');
  assert.equal(P.stepUntil('save', 100), 100 + P.STEP_MS.save + P.STEP_GRACE_MS);
  assert.equal(P.stepUntil('nonsense', 100), 100 + P.STEP_MS.page + P.STEP_GRACE_MS, 'an unknown step gets a page’s budget');
});

test('a failure is shown for its own worksheet and day, until a newer summary', () => {
  const now = 10_000_000_000;
  const fails = { ['doc1|' + DAY]: { message: 'Claude API error 529\n(model x)', at: now - 1000, trigger: 'open' } };
  const f = P.failureFor(fails, 'doc1', DAY, null, now);
  assert.equal(f.trigger, 'auto');
  assert.equal(f.message, 'Claude API error 529 (model x)', 'one line');
  assert.equal(P.failureFor(fails, 'doc2', DAY, null, now), null);
  assert.equal(P.failureFor(fails, 'doc1', OTHER, null, now), null);
  assert.equal(P.failureFor(fails, 'doc1', DAY, { at: now }, now), null, 'a summary written since makes it moot');
  assert.ok(P.failureFor(fails, 'doc1', DAY, { at: now - 5000 }, now), 'an older summary does not');
  assert.equal(P.failureFor(fails, 'doc1', DAY, null, now + P.FAIL_KEEP_MS + 1), null, 'forgotten after a day');
  assert.equal(P.failureFor({ ['doc1|' + DAY]: { message: 'x', at: now, trigger: 'manual' } }, 'doc1', DAY, null, now).trigger, 'manual');
});

/* ---------------- the glue, run for real ---------------- */

function cut(from, to) {
  const a = html.indexOf(from), b = html.indexOf(to, a + 1);
  assert.ok(a > 0 && b > a, 'found ' + from);
  return html.slice(a, b);
}

/* A sandbox holding the real glue. `ask` decides what the AI does each call. */
function harness({ ask, budgets = {}, captions } = {}) {
  const CS = freshCS();
  Object.assign(CS.pure.STEP_MS, budgets);
  const writes = [];
  const toasts = [];
  const askCalls = [];
  const win = {
    ClassSummary: CS,
    askGemini: async (user, opts) => { askCalls.push(opts); return ask(askCalls.length, opts); },
    aiLastCall: { engine: 'gemini' }
  };
  const lesson = { id: 'L1', type: 'video', ts: tsOn(DAY), page: 1, url: 'https://x/lesson.webm', lessonRecording: { duration: 120000 } };
  const ctx = {
    window: win, console: { warn() {}, log() {} }, setTimeout, clearTimeout, Promise, Date, JSON, Math, Object, Array, String, Number, Error,
    AbortController, encodeURIComponent,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    annotations: [lesson], pages: [{ num: 1, page: {}, baseW: 600, baseH: 800 }],
    currentDocId: 'doc1', practiceMode: false, wsMeta: { level: 'P5', subject: 'science' }, docName: 'P5 Science November WS 2 - Revision',
    STORAGE_DIR: 'pdf-annotator', COLLECTION: 'pdfAnnotator', PROFILES_COLLECTION: 'studentProfiles',
    currentUser: { uid: 'teacher' }, actingStudent: null,
    wheelTeacher: () => ctx.teacher !== false,
    toast: (m) => toasts.push(m),
    aiViewPaintPage: async () => ({ width: 10, height: 10, toDataURL: () => 'data:image/jpeg;base64,QUJD' }),
    aiViewCrop: () => 'QUJD',
    storage: { ref: () => ({ putString: async () => {}, getDownloadURL: async () => 'https://x' }) },
    db: { collection: () => ({ doc: (id) => ({ set: async (data) => { writes.push({ id, data }); } }) }) },
    firebase: { firestore: { FieldValue: { delete: () => null } } },
    document: { getElementById: () => null },
    isAdmin: () => true, isSharedVisitor: () => false
  };
  if (captions) Object.assign(ctx, captions(ctx));
  vm.createContext(ctx);
  const deadline = cut('function aiThrowIfAborted(signal) {', 'function tutorMethodRule() {');
  const glue = cut('/* ================= 🧾 Class summary — glue', '/* ================= End class summary glue ================= */');
  vm.runInContext(deadline + '\n' + glue + '\n;this.__get = function (n) { return eval(n); };', ctx);
  return { ctx, writes, toasts, askCalls, get: (n) => ctx.__get(n), CS };
}
const reply = (title) => JSON.stringify({
  title, overview: 'We revised heat and its effects on matter.', points: ['Heat flows from a hotter place to a colder place.'],
  homework: [], links: [], questions: [], parentNote: ''
});
const never = () => new Promise(() => {});

test('the reported fault: a background run that hangs no longer blocks the button for ever', async () => {
  // The automatic try after opening the worksheet hangs in the AI call
  // (it never answers). The teacher presses ✨ Write the summary.
  let first = true;
  const h = harness({ ask: () => { if (first) { first = false; return never(); } return reply('Heat and matter'); } });
  const bg = h.ctx.csumRun('open');
  await sleep(20);
  const job = h.get('csumJob');
  assert.ok(job && job.trigger === 'open' && job.day === DAY, 'the automatic try is running');
  assert.ok(h.get('csumRunningFor')(DAY), 'the window can see it');

  // 1. While it is alive, a press FOLLOWS it — no "already being written".
  const said = [];
  const press = h.ctx.csumRun('manual', DAY, (m) => said.push(m));
  await sleep(10);
  assert.ok(said.length >= 1, 'the press is shown the run’s progress: ' + said.join(' / '));
  assert.ok(!said.some(m => /already being written/i.test(m)));

  // 2. It stops keeping its promise (we move its clock past `until`): the
  //    next press takes it over, and a summary arrives.
  job.until = Date.now() - 1;
  const said2 = [];
  const s = await h.ctx.csumRun('manual', DAY, (m) => said2.push(m));
  assert.ok(s && s.title === 'Heat and matter', 'the summary is written');
  assert.ok(job.abandoned, 'the stuck run was dropped');
  assert.ok(said2.some(m => /had stopped/i.test(m)), 'and the teacher is told why it started again');
  assert.equal(h.writes.length, 1, 'filed once');
  assert.ok(h.writes[0].data.classSummaries[DAY], 'under the class day');
  assert.equal(h.get('csumJob'), null, 'the lock is let go');
  // The follower and the stuck run both end, without a second save.
  await Promise.race([press.catch(() => null), sleep(50)]);
  assert.equal(await bg, null, 'the replaced run resolves quietly');
  assert.equal(h.writes.length, 1);
  assert.equal(h.get('csumFailureFor')(DAY), null, 'a replaced run is not reported as a failure');
});

test('a step that overruns its budget ends the run, lets go and says why', async () => {
  const h = harness({ ask: never, budgets: { write: 40 } });
  await assert.rejects(h.ctx.csumRun('manual', DAY, () => {}), /longer than 11 minutes|took longer/);
  assert.equal(h.get('csumJob'), null, 'nothing is left holding the lock');
  // The next press runs at once.
  const h2Ask = harness({ ask: () => reply('Second try') });
  const s = await h2Ask.ctx.csumRun('manual', DAY, () => {});
  assert.equal(s.title, 'Second try');
});

test('an automatic failure is remembered for the window, and cleared by the next try', async () => {
  let n = 0;
  const h = harness({ ask: () => { n++; if (n === 1) throw new Error('Gemini is overloaded'); return reply('Heat'); } });
  assert.equal(await h.ctx.csumRun('open'), null);
  const f = h.get('csumFailureFor')(DAY);
  assert.ok(f && /overloaded/.test(f.message) && f.trigger === 'auto');
  assert.equal(h.get('csumJob'), null);
  const s = await h.ctx.csumRun('manual', DAY, () => {});
  assert.equal(s.title, 'Heat');
  assert.equal(h.get('csumFailureFor')(DAY), null);
});

test('the same class asked twice is written once, and both get it', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const h = harness({ ask: async () => { await gate; return reply('Once'); } });
  const a = h.ctx.csumRun('manual', DAY, () => {});
  await sleep(10);
  const b = h.ctx.csumRun('manual', DAY, () => {});
  await sleep(10);
  release();
  const [sa, sb] = await Promise.all([a, b]);
  assert.equal(sa.title, 'Once');
  assert.equal(sb.title, 'Once');
  assert.equal(h.askCalls.length, 1, 'one AI call');
  assert.equal(h.writes.length, 1, 'one save');
});

test('another class waits for the one being written, then is written', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const other = OTHER;
  const h = harness({ ask: async (n) => { if (n === 1) { await gate; return reply('First'); } return reply('Second'); } });
  h.ctx.annotations.push({ id: 'L2', type: 'video', ts: tsOn(other), page: 1, url: 'https://x/2.webm', lessonRecording: { duration: 60000 } });
  const a = h.ctx.csumRun('manual', DAY, () => {});
  await sleep(10);
  const said = [];
  const b = h.ctx.csumRun('manual', other, (m) => said.push(m));
  await sleep(10);
  assert.ok(said.some(m => /first/i.test(m) && m.includes(P.dayLabel(DAY))), 'told it is waiting: ' + said.join(' / '));
  release();
  assert.equal((await a).title, 'First');
  assert.equal((await b).title, 'Second');
  assert.deepEqual(h.writes.map(w => Object.keys(w.data.classSummaries)[0]), [DAY, other]);
});

test('an automatic request mid-run is queued and runs afterwards', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const h = harness({ ask: async (n) => { if (n === 1) { await gate; } return reply('T' + n); } });
  const a = h.ctx.csumRun('manual', DAY, () => {});
  await sleep(10);
  assert.equal(await h.ctx.csumRun('lesson'), null, 'queued, not refused');
  assert.equal(h.get('csumAgain'), 'lesson');
  release();
  await a;
  await sleep(30);
  assert.equal(h.get('csumAgain'), '', 'the queued try ran');
});

test('a new worksheet or a new account drops the run and its lock', async () => {
  const h = harness({ ask: never });
  const run = h.ctx.csumRun('open');
  await sleep(10);
  assert.ok(h.get('csumJob'));
  h.ctx.currentDocId = 'doc2';
  h.ctx.csumForget();
  assert.equal(h.get('csumJob'), null, 'the old worksheet’s run let go');
  assert.equal(await run, null);
  assert.equal(h.writes.length, 0, 'nothing written onto either worksheet');

  const h2 = harness({ ask: never });
  const run2 = h2.ctx.csumRun('open');
  await sleep(10);
  h2.ctx.teacher = false;
  h2.ctx.csumRoleChanged();
  assert.equal(h2.get('csumJob'), null);
  assert.equal(await run2, null);
});

test('captions that hang are cancelled and the summary goes on without them', async () => {
  let aborted = false;
  const h = harness({
    ask: () => reply('Without captions'),
    budgets: { captions: 40 },
    captions: (ctx) => ({
      getOpenAiKey: () => 'sk-test',
      lessonCaptionUsable: () => false,
      lessonCaptionBusy: null,
      lessonCaptionLoad: async () => null,
      lessonCaptionGenerate: function () {
        const c = new AbortController();
        c.signal.addEventListener('abort', () => { aborted = true; });
        ctx.lessonCaptionBusy = c;
        return never();
      }
    })
  });
  const said = [];
  const s = await h.ctx.csumRun('manual', DAY, (m) => said.push(m));
  assert.equal(s.title, 'Without captions');
  assert.ok(aborted, 'the hung caption request was stopped');
  assert.ok(said.some(m => /captions could not be made/i.test(m)));
});

test('the glue: no flag left that only a finished run can clear', () => {
  const g = cut('/* ================= 🧾 Class summary — glue', '/* ================= End class summary glue ================= */');
  assert.ok(!/throw new Error\('A summary is already being written/.test(g), 'the dead-end message is gone');
  assert.ok(!/var csumRunning\b/.test(g));
  const work = g.slice(g.indexOf('async function csumWork('), g.indexOf('async function csumSave('));
  // Every wait in the run is a bounded step (the AI, the pages, the links, the captions, the save).
  ['captions', 'captionLoad', 'links', 'page', 'marks', 'write', 'picture', 'save'].forEach(k =>
    assert.match(work, new RegExp("csumStep\\(job, '" + k + "'"), k + ' is bounded'));
  // Only the job's own lock is ever let go.
  assert.match(g, /if \(csumJob === job\) csumJob = null;/);
  // The window can follow a run and see why one stopped.
  assert.match(g, /running: function \(day\)/);
  assert.match(g, /follow: function \(day, say\)/);
  assert.match(g, /failure: csumFailureFor/);
  // Writing still never sends.
  assert.ok(!/csumSendGmail|gmail\.googleapis/.test(work));
});

test('the window: follows a run, survives a close and reopen, and never sends twice', () => {
  const src = csSrc;
  assert.match(src, /function followIfRunning\(\)/);
  assert.match(src, /followIfRunning\(\);\n    \}/, 'the empty view follows a run going on');
  const open = src.slice(src.indexOf('    function open(day) {'), src.indexOf('    function currentEntry() {'));
  assert.match(open, /state\.busy = false;/, 'reopening clears a busy flag no handler can clear any more');
  const send = src.slice(src.indexOf('    function sendNow(via) {'), src.indexOf('    function renderSettings() {'));
  assert.match(send, /state\.sending/, 'a send in flight outlives a close and reopen');
  assert.match(send, /if \(!teacher\(\) \|\| state\.busy \|\| state\.sending\) return;/);
  assert.ok(!/innerHTML\s*=/.test(src));
});
