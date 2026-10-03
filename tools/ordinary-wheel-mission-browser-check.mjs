// Real wheel UI -> production hero repository. The only substitute is Firestore
// storage/authentication; mission progress, receipts and payouts run server code.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { createHeroRepository, key } = require('../functions/hero-repository.js');
const Core = require('../functions/hero-game/battle-core.js');
const runtime = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(runtime.startsWith('file:') ? runtime : pathToFileURL(runtime).href);
const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {});
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce' });
const teacher = { uid: 'teacher-fixture', teacherId: 'teacher-fixture', email: 'teacher@example.test', isTeacher: true };
const errors = [], requests = [], data = new Map(), versions = new Map();
let version = 0, randomIndex = 0, objectiveRoll = .3, prizeRoll = .99, checks = 0;
const clone = value => value === undefined ? undefined : structuredClone(value);
function check(name, condition, details) { assert.ok(condition, details ? name + '\n' + JSON.stringify(details) : name); checks++; console.log('✓ ' + name); }
function ref(p, collection = false, filters = []) {
  return { path: p, isCollection: collection, filters, collection: name => ref(p + '/' + name, true), doc: id => ref(p + '/' + id), where: (field, op, value) => { assert.equal(op, '=='); return ref(p, true, [...filters, [field, value]]); }, get: async () => read(ref(p, collection, filters)) };
}
function snapshot(p) { return { id: p.split('/').at(-1), exists: data.has(p), data: () => clone(data.get(p)), ref: ref(p) }; }
function read(r) {
  if (!r.isCollection) return snapshot(r.path);
  return { docs: [...data.keys()].filter(p => p.startsWith(r.path + '/') && !p.slice(r.path.length + 1).includes('/') && r.filters.every(([field, value]) => data.get(p)[field] === value)).map(snapshot) };
}
const db = {
  collection: name => ref(name, true),
  seed(p, value) { data.set(p, clone(value)); versions.set(p, ++version); },
  async runTransaction(callback) {
    for (let retry = 0; retry < 40; retry++) {
      const reads = new Map(), writes = new Map(); let queryVersion = null, wrote = false;
      const result = await callback({ get: async r => {
        assert.equal(wrote, false, 'Firestore reads precede writes');
        if (r.isCollection) queryVersion = version; else reads.set(r.path, versions.get(r.path) || 0);
        await Promise.resolve(); return read(r);
      }, set: (r, value) => { wrote = true; writes.set(r.path, clone(value)); }, delete: r => { wrote = true; writes.set(r.path, undefined); } });
      if ((queryVersion !== null && queryVersion !== version) || [...reads].some(([p, v]) => (versions.get(p) || 0) !== v)) continue;
      for (const [p, value] of writes) { if (value === undefined) data.delete(p); else data.set(p, value); versions.set(p, ++version); }
      return result;
    }
    throw Error('Firestore transaction retry limit');
  }
};
const students = ['Ari', 'Bo', 'Cy', 'Dee', 'Evan', 'Faye', 'Gale', 'Hana', 'Ivan', 'Jade', 'Kai', 'Luna'].map((name, i) => ({ id: 'student-' + i, name, slots: ['P5 Science', 'P6 Science'], marks: 10 }));
students.forEach(student => {
  db.seed('students/' + student.id, student);
  db.seed('classroomHeroData/' + teacher.uid + '/profiles/' + student.id, { schemaVersion: 1, studentId: student.id, hero: Core.heroFromStudent(student), claim: null, activeEncounter: null });
});
db.seed('bosses/school-fixture', { active: true, hp: 100000, defeated: false });
const profileBaseline = JSON.stringify([...data].filter(([p]) => p.includes('/profiles/')));
const repo = createHeroRepository(db, { now: () => Date.now(), random: () => [objectiveRoll, prizeRoll][randomIndex++ % 2] });
const missionPath = (slot = 'P5 Science', uid = teacher.uid) => 'classroomHeroData/' + uid + '/missions/' + key(slot);
const mission = (slot, uid) => data.get(missionPath(slot, uid));
const awards = () => [...data].filter(([p]) => p.startsWith('awards/')).map(([, value]) => value);
const classAwards = () => [...data].filter(([p]) => p.startsWith('awards/mission-')).map(([, value]) => value);
const wheelAwards = () => [...data].filter(([p]) => p.startsWith('awards/wheel-')).map(([, value]) => value);
const totalMarks = () => students.reduce((sum, s) => sum + data.get('students/' + s.id).marks, 0);
const combatUnchanged = () => ![...data.keys()].some(p => p.startsWith('classroomBattles/') && p.split('/').length === 4) && JSON.stringify([...data].filter(([p]) => p.includes('/profiles/'))) === profileBaseline;
async function broadcast() {
  const docs = Object.fromEntries(data);
  await Promise.all(context.pages().map(p => p.evaluate(docs => window.__syncFixture?.(docs), docs).catch(() => {})));
}
await context.exposeFunction('__repoBridge', async ({ actor, body }) => {
  requests.push(clone({ actor, ...body }));
  try { const result = await repo.execute({ ...teacher, uid: actor, teacherId: actor }, body); await broadcast(); return { result }; }
  catch (e) { return { error: { message: e.message, code: e.code, status: e.status } }; }
});
await context.exposeFunction('__dbRead', async descriptor => {
  const result = read(ref(descriptor.path, descriptor.isCollection, descriptor.filters));
  const serialize = snap => ({ id: snap.id, exists: snap.exists, value: snap.data(), path: snap.ref.path });
  return result.docs ? { docs: result.docs.map(serialize) } : serialize(result);
});
await context.exposeFunction('__dbCommit', async writes => {
  await db.runTransaction(async tx => {
    const previous = await Promise.all(writes.map(w => tx.get(ref(w.path))));
    writes.forEach((w, i) => tx.set(ref(w.path), w.merge ? { ...previous[i].data(), ...w.value } : w.value));
  });
  await broadcast();
});
await context.route(/firebase-[a-z]+-compat\.js(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/javascript', body: '' }));
await context.addInitScript(() => {
  const chain = () => new Proxy(function () { return chain(); }, { get: (_, key) => key === 'then' ? undefined : chain(), apply: () => chain(), construct: () => chain(), set: () => true });
  window.pdfjsLib = chain(); window.firebase = chain(); window.grecaptcha = chain();
  if (!localStorage.getItem('polymath.wheelQuickFight')) localStorage.setItem('polymath.wheelQuickFight', 'off');
  if (!localStorage.getItem('polymath.wheelClass')) localStorage.setItem('polymath.wheelClass', 'P5 Science');
});
const file = pathToFileURL(path.resolve('index.html')).href;
const output = path.resolve(process.env.BATTLE_SCREENSHOTS || '../battle-validation'); fs.mkdirSync(output, { recursive: true });
async function setup(page, actor = teacher.uid) {
  await page.goto(file);
  await page.waitForFunction(() => !!window.QuickBattle);
  await page.evaluate(({ docs, actor }) => {
    const listeners = new Map(); window.__fixtureDocs = docs;
    const snap = item => ({ id: item.id, exists: item.exists, data: () => structuredClone(item.value), ref: reference(item.path) });
    function localSnap(p) { return snap({ id: p.split('/').at(-1), path: p, exists: p in __fixtureDocs, value: __fixtureDocs[p] }); }
    function reference(p, isCollection = false, filters = []) {
      return { path: p, collection: name => reference(p + '/' + name, true), doc: id => reference(p + '/' + (id || crypto.randomUUID())), where: (field, op, value) => reference(p, true, [...filters, [field, value]]),
        async get() { const result = await __dbRead({ path: p, isCollection, filters }); return result.docs ? { docs: result.docs.map(snap) } : snap(result); },
        onSnapshot(cb) { const set = listeners.get(p) || new Set(); listeners.set(p, set); set.add(cb); const timer = setTimeout(() => { if (set.has(cb)) cb(localSnap(p)); }, 0); return () => { clearTimeout(timer); set.delete(cb); }; }
      };
    }
    window.__syncFixture = next => { const previous = __fixtureDocs; __fixtureDocs = next; listeners.forEach((set, p) => { if (JSON.stringify(previous[p]) !== JSON.stringify(next[p])) set.forEach(cb => cb(localSnap(p))); }); };
    window.db = { collection: name => reference(name, true), async runTransaction(callback) {
      const writes = []; const result = await callback({ get: r => r.get(), set: (r, value) => writes.push({ path: r.path, value }), update: (r, value) => writes.push({ path: r.path, value, merge: true }) });
      await __dbCommit(writes); return result;
    } };
    const firestore = () => db; firestore.FieldValue = { serverTimestamp: () => ({ _seconds: Math.floor(Date.now() / 1000), _nanoseconds: 0 }) };
    window.firebase = { firestore };
    window.isAdmin = () => true; window.currentUser = { uid: actor, email: 'teacher@example.test' }; window.actingStudent = null;
    window.rwStudents = Object.entries(docs).filter(([p]) => p.startsWith('students/')).map(([p, value]) => ({ ...value, id: p.split('/').at(-1) }));
    window.__apiCalls = []; window.__failure = ''; window.__holdBefore = false; window.__holdAfter = false; window.__release = null;
    window.__failMissionRead = false; window.__holdMissionRead = false; window.__releaseMissionRead = null;
    window.ClassroomHeroAPI.request = async (body, lifecycle = {}) => {
      const user = currentUser, canSend = () => { if (user !== currentUser || lifecycle.canSend && !lifecycle.canSend()) throw Error('The lesson or account changed before sending.'); };
      canSend(); __apiCalls.push(structuredClone(body));
      if (body.type === 'mission' && body.command === 'get') {
        if (__holdMissionRead) await new Promise(resolve => { __releaseMissionRead = resolve; });
        canSend();
        if (__failMissionRead) throw Error('Fresh mission read timed out');
      }
      if (__holdBefore && body.type === 'wheelAward') await new Promise(resolve => { __release = resolve; });
      canSend();
      if (__failure === 'before' && (body.type === 'wheelAward' || body.command === 'incorrect')) { __failure = ''; throw Error('Timeout before commit'); }
      const reply = await __repoBridge({ actor: user.uid, body });
      if (__holdAfter && body.type === 'wheelAward') await new Promise(resolve => { __release = resolve; });
      if (__failure === 'after' && (body.type === 'wheelAward' || body.command === 'incorrect')) { __failure = ''; throw Error('Timeout after commit'); }
      if (user !== currentUser) throw Error('The signed-in account changed after saving.');
      if (reply.error) throw Object.assign(Error(reply.error.message), reply.error);
      return reply.result;
    };
    window.wheelRandom = () => 0; applyRewardVisibility();
  }, { docs: Object.fromEntries(data), actor });
  await page.click('#wheelBtn');
  await page.waitForFunction(() => document.querySelector('#wheelMission [data-mm=turn]') && !document.querySelector('#wheelMission .mmStatus').textContent.includes('Loading') && (!document.getElementById('wheelSpinBtn').disabled || !document.getElementById('wheelQuickRetry').hidden && !document.getElementById('wheelQuickRetry').disabled || document.querySelector('#wheelMission [data-mm=retry]:not([disabled])')));
}
async function ready(page) { await page.waitForFunction(() => !document.getElementById('wheelSpinBtn').disabled && document.querySelector('#wheelMission [data-mm=turn]') && !document.querySelector('#wheelMission .mmStatus').textContent.includes('Loading')); }
async function spin(page) { await page.click('#wheelSpinBtn'); await page.waitForFunction(() => !wheelSpinning && !document.getElementById('wheelSpinBtn').disabled, null, { timeout: 10000 }); return page.evaluate(() => wheelState.lastSpinId); }
async function award(page, delta = 1) { await page.evaluate(delta => wheelGive(delta), delta); }
async function turn(page) { await page.click('#wheelMission [data-mm=turn]'); await page.waitForFunction(() => document.querySelector('#wheelMission .mmReels').textContent.includes('0 / 7') && !document.querySelector('#wheelMission .mmStatus').textContent.includes('Saving')); }
async function reset(page) { await page.click('#wheelMission [data-mm=incorrect]'); await page.waitForFunction(() => !document.querySelector('#wheelMission .mmStatus').textContent.includes('Saving')); }
async function retryAward(page) { await page.click('#wheelQuickRetry'); await ready(page); }
const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
try {
  await setup(page);
  check('ordinary wheel loads with Quick fight off and the mission machine available', !(await page.isChecked('#wheelQuickToggle')) && await page.isEnabled('#wheelMission [data-mm=turn]'));
  await turn(page);
  check('production repository saves the seven-answer mission and rare class-points prize', mission().current.objectiveId === 'correct-streak' && mission().current.prize.id === 'class-points');
  const spinIds = [await spin(page)];
  await award(page, 1);
  check('a saved off-mode point award advances the visible mission without combat', mission().current.progress === 1 && await page.locator('#wheelMission .mmReels').textContent().then(t => t.includes('1 / 7')) && combatUnchanged());
  const firstAward = requests.find(r => r.type === 'wheelAward');
  const afterFirst = totalMarks();
  await award(page, 2); await award(page, 3);
  check('additional legitimate awards retain marks and history but count one answer per spin', mission().current.progress === 1 && totalMarks() === afterFirst + 5 && awards().length === 3);
  const beforeDuplicate = JSON.stringify([...data]);
  await page.evaluate(body => ClassroomHeroAPI.request(body), firstAward);
  check('duplicate award request cannot repeat marks, history, progress or prizes', JSON.stringify([...data]) === beforeDuplicate);
  for (let i = 1; i < 7; i++) { spinIds.push(await spin(page)); await award(page, 1); }
  check('seven actual off-mode spins produce seven fresh question identities', new Set(spinIds).size === 7);
  check('seven distinct correct answers complete and display the mission', mission().current.status === 'complete' && mission().current.progress === 7 && await page.locator('#wheelMission .mmStatus').textContent().then(t => t.includes('Mission complete')));
  check('+5 class-points prize is paid once to every lesson member with consistent balances and ledger', mission().bank.length === 1 && mission().lastPayout.awards.length === students.length && totalMarks() === 120 + 12 + 60 && awards().length === 9 + 12);
  check('mission payout updates all browser roster balances, including the final answering student', await page.evaluate(() => rwStudents.every(s => s.marks === __fixtureDocs['students/' + s.id].marks)));
  const lastAward = requests.filter(r => r.type === 'wheelAward').at(-1), complete = JSON.stringify([...data]);
  await Promise.all([page.evaluate(body => ClassroomHeroAPI.request(body), lastAward), page.evaluate(body => ClassroomHeroAPI.request(body), lastAward)]);
  check('concurrent duplicate completion requests do not repeat the prize or award rows', JSON.stringify([...data]) === complete);
  check('off-mode completion never starts encounters, attacks or grants hero XP/inventory', combatUnchanged() && !requests.some(r => r.type === 'battle'));
  await page.screenshot({ path: path.join(output, 'ordinary-wheel-mission-complete.png'), fullPage: true });
  check('school-wide boss loses only the ordinary awarded points, with no duplicate or class-prize damage', data.get('bosses/school-fixture').hp === 100000 - 12);

  await turn(page);
  await spin(page); await award(page); await spin(page); await award(page);
  check('a new mission builds a fresh two-answer streak through real wheel awards', mission().current.progress === 2);
  const wrongSpin = await spin(page);
  await reset(page);
  const incorrect = requests.filter(r => r.command === 'incorrect').at(-1);
  check('incorrect reset uses this off-mode question and visibly clears the streak', incorrect.spinId === wrongSpin && mission().current.progress === 0 && await page.locator('#wheelMission .mmReels').textContent().then(t => t.includes('0 / 7')));
  const beforeWrongAward = totalMarks(); await award(page, 2);
  check('a later legitimate point award on the incorrect question saves marks without counting it correct', totalMarks() === beforeWrongAward + 2 && mission().current.progress === 0);
  await spin(page); await award(page);
  const newerStreak = JSON.stringify(mission());
  await page.evaluate(body => ClassroomHeroAPI.request(body), incorrect);
  check('retrying an old saved incorrect request cannot clear the newer streak', JSON.stringify(mission()) === newerStreak && mission().current.progress === 1);

  await spin(page);
  const beforeTimeout = JSON.stringify([...data]);
  await page.evaluate(() => { __failure = 'before'; }); await award(page, 3);
  check('timeout before commit leaves marks, history and progress untouched with a visible retry', JSON.stringify([...data]) === beforeTimeout && await page.isVisible('#wheelQuickRetry') && await page.isDisabled('#wheelSpinBtn'));
  const failedId = await page.evaluate(() => __apiCalls.filter(r => r.type === 'wheelAward').at(-1).action.id);
  await retryAward(page);
  check('retry after an uncommitted timeout reuses the receipt and counts the question once', await page.evaluate(id => __apiCalls.filter(r => r.type === 'wheelAward').at(-1).action.id === id, failedId) && mission().current.progress === 2 && totalMarks() === beforeWrongAward + 2 + 1 + 3);

  const lostSpin = await spin(page), beforeLostMarks = totalMarks();
  await page.evaluate(() => { __failure = 'after'; }); await award(page, 4);
  const lostId = requests.filter(r => r.type === 'wheelAward').at(-1).action.id;
  check('timeout after commit saves exactly one award and answer while keeping confirmation pending', totalMarks() === beforeLostMarks + 4 && mission().current.progress === 3 && await page.isVisible('#wheelQuickRetry'));
  const beforeReload = await page.evaluate(() => ({ spinId: wheelState.lastSpinId, day: wheelState.day, round: wheelState.round, storedState: localStorage.getItem(wheelStoreKey(wheelClass)) }));
  await setup(page);
  await page.waitForFunction(() => !document.getElementById('wheelQuickRetry').hidden && !document.getElementById('wheelQuickRetry').disabled);
  const reloadedQuestion = await page.evaluate(() => ({ spinId: wheelState.lastSpinId, state: wheelState, storedState: localStorage.getItem(wheelStoreKey(wheelClass)), question: sessionStorage.getItem('polymath.wheelQuestion.' + currentUser.uid + '.' + encodeURIComponent(wheelClass)) }));
  const lostRequests = requests.filter(r => r.type === 'wheelAward' && r.action.id === lostId).length;
  check('reload retains the unresolved ordinary award and current question without resending', lostRequests === 1 && reloadedQuestion.spinId === lostSpin, { expectedSpinId: lostSpin, lostRequests, beforeReload, ...reloadedQuestion });
  await retryAward(page);
  check('reload retry confirms committed points without repeating marks, history, answer or prize', totalMarks() === beforeLostMarks + 4 && mission().current.progress === 3 && requests.filter(r => r.type === 'wheelAward' && r.action.id === lostId).length === 2 && mission().bank.length === 1);
  const afterReload = totalMarks(); await award(page, 1);
  check('additional points after reload use the restored question and do not extend the streak', totalMarks() === afterReload + 1 && mission().current.progress === 3);

  const other = await context.newPage(); other.on('pageerror', e => errors.push(e.message));
  await setup(other);
  const [firstTabSpin, secondTabSpin] = await Promise.all([spin(page), spin(other)]);
  await Promise.all([award(page, 1), award(other, 2)]);
  check('concurrent tabs generate distinct questions and atomically save both legitimate answers', firstTabSpin !== secondTabSpin && mission().current.progress === 5 && totalMarks() === afterReload + 1 + 3);
  const concurrentAwards = requests.filter(r => r.type === 'wheelAward').slice(-2), beforeTabRetries = JSON.stringify([...data]);
  await Promise.all([page.evaluate(body => ClassroomHeroAPI.request(body), concurrentAwards[0]), other.evaluate(body => ClassroomHeroAPI.request(body), concurrentAwards[1])]);
  check('concurrent tab retries leave both marks and mission progress unchanged', JSON.stringify([...data]) === beforeTabRetries);

  // A reset that never reached the server must not acquire a fresh revision on
  // retry after a different tab has already answered the next question.
  const staleSpin = await spin(page);
  await page.evaluate(() => { __failure = 'before'; }); await reset(page);
  await page.waitForSelector('#wheelMission [data-mm=retry]');
  const pendingReset = await page.evaluate(() => __apiCalls.filter(r => r.command === 'incorrect').at(-1));
  await spin(other); await award(other, 1);
  const streakBeforeOldReset = JSON.stringify(mission());
  await page.click('#wheelMission [data-mm=retry]');
  await page.waitForFunction(() => !document.querySelector('#wheelMission [data-mm=retry]'));
  check('uncommitted stale reset retry preserves its original question/revision and cannot erase a newer answer', pendingReset.spinId === staleSpin && JSON.stringify(mission()) === streakBeforeOldReset && mission().current.progress === 6);
  await spin(other); await award(other, 1);
  check('the post-reset mission still completes with one additional class-points prize', mission().current.status === 'complete' && mission().bank.length === 2 && classAwards().length === students.length * 2);

  // A completed save arriving after another tab's award must not rewrite
  // server balances or add a second ledger row when its UI settles.
  await turn(other); await setup(page); await spin(page);
  await page.evaluate(() => { __holdAfter = true; window.__inFlightAward = wheelGive(2); });
  await page.waitForFunction(() => !!__release);
  await spin(other); await award(other, 3);
  const marksAfterOther = totalMarks();
  await page.evaluate(() => { __holdAfter = false; __release(); });
  await page.evaluate(() => __inFlightAward);
  check('overlapping tab saves preserve the canonical total and award history', totalMarks() === marksAfterOther && mission().current.progress === 2);

  // Lifecycle guards run before transport. The outbox stays namespaced to its
  // original account and lesson until that context confirms or retries it.
  await spin(page);
  const beforeAccount = JSON.stringify([...data]), callsBeforeAccount = requests.filter(r => r.type === 'wheelAward').length;
  await page.evaluate(() => { __release = null; __holdBefore = true; window.__inFlightAward = wheelGive(4); });
  await page.waitForFunction(() => !!__release);
  await page.evaluate(() => { closeWheel(); currentUser = { uid: 'other-teacher', email: 'other@example.test' }; __holdBefore = false; __release(); });
  await page.evaluate(() => __inFlightAward);
  check('account change before send prevents stale points, progress and history writes', JSON.stringify([...data]) === beforeAccount && requests.filter(r => r.type === 'wheelAward').length === callsBeforeAccount);
  await setup(page, 'other-teacher');
  check('another account sees an independent mission and cannot replay the previous account outbox', await page.locator('#wheelMission .mmReels').textContent().then(t => t.includes('A new challenge')) && !(await page.isVisible('#wheelQuickRetry')));
  await setup(page);
  await page.waitForFunction(() => !document.getElementById('wheelQuickRetry').hidden && !document.getElementById('wheelQuickRetry').disabled);
  await retryAward(page);
  check('returning to the original account safely confirms its retained ordinary award', totalMarks() === marksAfterOther + 4 && mission().current.progress === 3);

  await spin(page);
  const beforeLesson = JSON.stringify([...data]), callsBeforeLesson = requests.filter(r => r.type === 'wheelAward').length;
  await page.evaluate(() => { __release = null; __holdBefore = true; window.__inFlightAward = wheelGive(5); });
  await page.waitForFunction(() => !!__release);
  await page.evaluate(() => { closeWheel(); wheelSetClass('P6 Science'); __holdBefore = false; __release(); });
  await page.evaluate(() => __inFlightAward);
  check('lesson change before send cannot write points or progress to either slot', JSON.stringify([...data]) === beforeLesson && requests.filter(r => r.type === 'wheelAward').length === callsBeforeLesson);
  await setup(page);
  check('new lesson does not inherit the previous mission, question or pending award', await page.evaluate(() => wheelClass === 'P6 Science') && !mission('P6 Science') && !(await page.isVisible('#wheelQuickRetry')));
  await page.selectOption('#wheelClassSelect', 'P5 Science');
  await page.waitForFunction(() => !document.getElementById('wheelQuickRetry').hidden && !document.getElementById('wheelQuickRetry').disabled);
  await retryAward(page);
  check('returning to the original lesson retries its own receipt once', totalMarks() === marksAfterOther + 4 + 5 && mission().current.progress === 4);
  await spin(page);
  await page.evaluate(() => { __failure = 'after'; }); await reset(page);
  await page.waitForSelector('#wheelMission [data-mm=retry]');
  const lostReset = requests.filter(r => r.command === 'incorrect').at(-1);
  check('a lost reset reply has committed the reset once and retains a mission retry', mission().current.progress === 0 && await page.isDisabled('#wheelSpinBtn'));
  await setup(other); await spin(other); await award(other);
  await setup(page);
  check('reload restores the pending reset without sending it or clearing the other tab’s newer answer', requests.filter(r => r.command === 'incorrect' && r.id === lostReset.id).length === 1 && mission().current.progress === 1 && await page.isVisible('#wheelMission [data-mm=retry]'));
  await page.click('#wheelMission [data-mm=retry]'); await ready(page);
  check('reloaded committed reset retry confirms the current streak rather than resetting it again', mission().current.progress === 1 && requests.filter(r => r.command === 'incorrect' && r.id === lostReset.id).length === 2 && await page.locator('#wheelMission .mmReels').textContent().then(t => t.includes('1 / 7')));
  check('all ordinary activity preserves combat profiles, XP, loot and encounters', combatUnchanged() && !requests.some(r => r.type === 'battle'));
  const ordinaryPoints = wheelAwards().reduce((sum, a) => sum + a.delta, 0);
  check('ordinary award ledger, marks and school boss damage agree after retries and tab races', totalMarks() === 120 + ordinaryPoints + 120 && data.get('bosses/school-fixture').hp === 100000 - ordinaryPoints);
  const beforeReward = { marks: totalMarks(), hp: data.get('bosses/school-fixture').hp, count: awards().length, mission: JSON.stringify(mission()) };
  await page.evaluate(() => rwAwardMarks(rwStudents[0], 2, 'Ordinary reward regression'));
  await page.waitForFunction(hp => __fixtureDocs['bosses/school-fixture'].hp === hp - 2, beforeReward.hp);
  check('ordinary reward controls still save marks/history and school boss damage independently of missions', totalMarks() === beforeReward.marks + 2 && awards().length === beforeReward.count + 1 && JSON.stringify(mission()) === beforeReward.mission && combatUnchanged());

  // Both tabs stay open throughout: a new spin must learn about a mission
  // started, reset or replaced elsewhere before freezing its answer context.
  await page.selectOption('#wheelClassSelect', 'P6 Science'); await ready(page);
  await other.selectOption('#wheelClassSelect', 'P6 Science'); await ready(other);
  await turn(page);
  const newMission = { id: mission('P6 Science').current.id, revision: mission('P6 Science').revision };
  await spin(other); await award(other);
  const idleAward = requests.filter(r => r.type === 'wheelAward').at(-1);
  check('an already-open idle tab learns a newly rolled mission on its next actual spin and counts the answer', idleAward.missionId === newMission.id && idleAward.missionRevision === newMission.revision && mission('P6 Science').current.progress === 1);
  await spin(page); await reset(page);
  const resetRevision = mission('P6 Science').revision;
  await spin(other); await award(other);
  const afterRemoteReset = requests.filter(r => r.type === 'wheelAward').at(-1);
  check('a new spin in an idle tab captures the latest remote reset revision before counting its answer', afterRemoteReset.missionRevision === resetRevision && mission('P6 Science').current.progress === 1);
  await page.click('#wheelMission [data-mm=cancel]'); await ready(page);
  await turn(page);
  const replacement = { id: mission('P6 Science').current.id, revision: mission('P6 Science').revision };
  await spin(other); await award(other);
  const replacementAward = requests.filter(r => r.type === 'wheelAward').at(-1);
  check('an idle tab rebinds a fresh spin to a replacement mission without closing or reloading', replacement.id !== newMission.id && replacementAward.missionId === replacement.id && replacementAward.missionRevision === replacement.revision && mission('P6 Science').current.progress === 1);

  const beforeFailedRead = JSON.stringify([...data]), awardsBeforeFailedRead = requests.filter(r => r.type === 'wheelAward').length;
  await other.evaluate(() => { __failMissionRead = true; }); await spin(other); await award(other, 2);
  check('failed per-spin mission refresh cannot save points or progress with a stale answer binding', JSON.stringify([...data]) === beforeFailedRead && requests.filter(r => r.type === 'wheelAward').length === awardsBeforeFailedRead);
  await other.evaluate(() => { __failMissionRead = false; }); await spin(other); await award(other, 2);
  check('the next real spin recovers from a failed mission refresh and counts its answer', mission('P6 Science').current.progress === 2 && requests.filter(r => r.type === 'wheelAward').length === awardsBeforeFailedRead + 1);

  const beforeDelayedRead = JSON.stringify([...data]), awardsBeforeDelayedRead = requests.filter(r => r.type === 'wheelAward').length;
  await other.evaluate(() => { __holdMissionRead = true; __releaseMissionRead = null; });
  await other.click('#wheelSpinBtn');
  await other.waitForFunction(() => !!__releaseMissionRead && !wheelSpinning, null, { timeout: 10000 });
  await award(other, 3);
  check('a delayed fresh mission read keeps landed-point awards blocked instead of using cached context', JSON.stringify([...data]) === beforeDelayedRead && requests.filter(r => r.type === 'wheelAward').length === awardsBeforeDelayedRead);
  await other.evaluate(() => { __holdMissionRead = false; __releaseMissionRead(); }); await ready(other); await award(other, 3);
  check('the landed question becomes awardable after its original fresh mission read is confirmed', mission('P6 Science').current.progress === 3 && requests.filter(r => r.type === 'wheelAward').length === awardsBeforeDelayedRead + 1);
  check('fresh mission reads and recovery never create encounters or change hero progression', combatUnchanged() && !requests.some(r => r.type === 'battle'));

  // The selected wheel award has committed, but its HTTP reply is held. The
  // ordinary rewards controls can still save a newer balance in this same tab.
  // A negative adjustment of exactly -2 deliberately returns the selected
  // balance to its pre-wheel value, so marks-value comparison alone is unsafe.
  for (const [target, delta, label] of [['selected', 5, 'selected student +5'], ['selected', -2, 'selected student -2 exact cancellation'], ['other', 4, 'another student +4'], ['other', -3, 'another student -3']]) {
    const correctionId = await other.evaluate(target => {
      const selected = wheelStudent(wheelState.names[wheelWinnerIdx]);
      return target === 'selected' ? selected.id : rwStudents.find(s => s.id !== selected.id).id;
    }, target);
    const beforeCorrection = { total: totalMarks(), rows: awards().length, wheelRows: wheelAwards().length, prizes: classAwards().length, mission: JSON.stringify(mission('P6 Science')), hp: data.get('bosses/school-fixture').hp };
    await other.evaluate(() => { __release = null; __holdAfter = true; window.__inFlightAward = wheelGive(2); });
    await other.waitForFunction(() => !!__release);
    await other.evaluate(({ id, delta }) => rwAwardMarks(rwStudents.find(s => s.id === id), delta, 'Concurrent ordinary adjustment regression'), { id: correctionId, delta });
    await other.waitForFunction(hp => __fixtureDocs['bosses/school-fixture'].hp === hp, beforeCorrection.hp - 2 - Math.max(0, delta));
    await other.evaluate(() => { __holdAfter = false; __release(); });
    await other.evaluate(() => __inFlightAward); await ready(other);
    check('late wheel reply preserves newer ordinary reward balance: ' + label,
      await other.evaluate(() => rwStudents.every(s => s.marks === __fixtureDocs['students/' + s.id].marks)) && totalMarks() === beforeCorrection.total + 2 + delta && awards().length === beforeCorrection.rows + 2 && wheelAwards().length === beforeCorrection.wheelRows + 1 && classAwards().length === beforeCorrection.prizes && JSON.stringify(mission('P6 Science')) === beforeCorrection.mission);
  }
  await page.selectOption('#wheelClassSelect', 'P5 Science'); await ready(page);
  const existingBattle = Core.reduce(null, { type: 'start', id: 'existing-off-mode-battle', bossId: 'goblin', heroes: students.map(s => Core.heroFromStudent(s)) });
  const battlePath = 'classroomBattles/' + teacher.uid + '/classes/' + key('P5 Science');
  db.seed(battlePath, existingBattle);
  await setup(page); await spin(page); await award(page, 2);
  check('off-mode awards also leave a pre-existing encounter byte-for-byte unchanged', JSON.stringify(data.get(battlePath)) === JSON.stringify(existingBattle) && JSON.stringify([...data].filter(([p]) => p.includes('/profiles/'))) === profileBaseline);
  check('a saved encounter stays hidden while ordinary mission progress continues', await page.isHidden('#wheelQuickDuel') && mission().current.progress === 2 && !requests.some(r => r.type === 'battle'));
  check('ordinary wheel mission workflow has no application errors', errors.length === 0);
  console.log('\n' + checks + ' ordinary wheel mission browser checks passed.');
} finally { await browser.close(); }
