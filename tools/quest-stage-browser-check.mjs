// 🧙 The quest on the worksheet (v1.193.0): the wheel's characters and enemies
// stand on the worksheet with no background, and the teacher drags and resizes
// them. The fixture (a local transaction store standing in for Firebase) is the
// one tools/quick-wheel-browser-check.mjs uses, copied so this check runs alone.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const runtime = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(runtime.startsWith('file:') ? runtime : pathToFileURL(runtime).href);
const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
await page.route(/firebase-[a-z]+-compat\.js(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/javascript', body: '' }));
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
  const chain = () => new Proxy(function () { return chain(); }, { get: (_, k) => k === 'then' ? undefined : chain(), apply: () => chain(), construct: () => chain(), set: () => true });
  window.pdfjsLib = chain(); window.firebase = chain(); window.grecaptcha = chain();
  window.__battleAnimations = [];
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (frames, options) {
    window.__battleAnimations.push({ className: String(this.className), options });
    return animate.call(this, frames, options);
  };
});
// A stable web origin makes remembered preferences and reloads match production.
const root = path.resolve('.');
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'};
const server = http.createServer((req,res) => {
  try {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const data = fs.readFileSync(file);
    res.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream'}); res.end(data);
  } catch (_) { if (!res.headersSent) res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); server.unref();
const file = 'http://127.0.0.1:' + server.address().port + '/index.html';
const output = path.resolve(process.env.BATTLE_SCREENSHOTS || '../battle-validation');
fs.mkdirSync(output, { recursive: true });
let checks = 0;
function check(name, condition) { assert.ok(condition, name); checks++; console.log('✓ ' + name); }
async function setup(delayProfiles = 0, pendingAward = false) {
  await page.goto(file);
  await page.waitForFunction(() => !!window.ClassroomBattle);
  await page.evaluate(({ delayProfiles }) => {
    window.isAdmin = () => true;
    window.currentUser = { uid: 'teacher-fixture', email: 'teacher@example.test' };
    window.actingStudent = null;
    window.rwStudents = ['Ari', 'Bo', 'Cy', 'Dee', 'Evan', 'Faye', 'Gale', 'Hana', 'Ivan', 'Jade', 'Kai', 'Luna', 'Maya', 'Noah', 'Owen', 'Pia'].map((name, i) => ({ id: 'student-' + i, name, ...(i < 4 ? { uid: 'account-' + i } : {}), slots: ['P5 Science', 'P6 Science'], marks: 10 }));
    const roles = ['warrior', 'ranger', 'mage', 'healer'];
    const documents = JSON.parse(localStorage.getItem('battle-fixture-documents') || '{}');
    roles.forEach((role, i) => {
      documents['scienceGameLeaderboard/account-' + i] ||= { battleHero: { version: 1, uid: 'account-' + i, role, avatarDataUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="90" height="110"><circle cx="45" cy="28" r="19" fill="#e9b892"/><rect x="20" y="49" width="50" height="47" rx="12" fill="' + ['#688dc1', '#6aab71', '#a586ca', '#76baa9'][i] + '"/><circle cx="39" cy="26" r="2"/><circle cx="51" cy="26" r="2"/></svg>'), stats: { atk: 40, def: 20, maxHp: 150, crit: 10, critMult: 1.5 }, equipment: { weapon: 'starter-sword', helmet: 'cloth-hat' } } };
    });
    rwStudents.forEach(student => { documents['students/' + student.id] ||= { marks: student.marks }; student.marks = documents['students/' + student.id].marks; });
    const listeners = new Map();
    function snap(key) { return { exists: key in documents, data: () => structuredClone(documents[key]) }; }
    function notify(key) { for (const cb of listeners.get(key) || []) cb(snap(key)); }
    function reference(key) {
      return { key, collection: name => reference(key + '/' + name), doc: id => reference(key + '/' + id),
        onSnapshot(cb) {
          const set = listeners.get(key) || new Set(); listeners.set(key, set); set.add(cb);
          const timer = setTimeout(() => { if (set.has(cb)) cb(snap(key)); }, key.startsWith('scienceGameLeaderboard/') ? delayProfiles : 5);
          return () => { clearTimeout(timer); set.delete(cb); };
        } };
    }
    let queue = Promise.resolve();
    window.db = { collection: name => reference(name), runTransaction(fn) {
      const next = queue.then(async () => {
        const writes = new Map();
        const result = await fn({ get: async ref => snap(ref.key), set: (ref, value) => writes.set(ref.key, structuredClone(value)) });
        writes.forEach((value, key) => { documents[key] = value; });
        localStorage.setItem('battle-fixture-documents', JSON.stringify(documents));
        writes.forEach((_, key) => notify(key));
        return result;
      }); queue = next.catch(() => {}); return next;
    } };
    window.__replaceSummonReply=false;window.__assistCalls = []; window.__loseAssistReply = false; window.__awardCalls = []; window.__failAward = false; window.__loseAwardReply = false; window.__awardErrorCode = null; window.__awardReplyDelay = 0;
    window.ClassroomHeroAPI.request = async request => {
      const {type, classId, action, studentId, delta} = request;
      if(type==='lessonGuests'&&request.command==='get'){if(window.__guestDelay)await new Promise(resolve=>setTimeout(resolve,window.__guestDelay));return {guests:[],state:null};}
      if(type==='mission'&&request.command==='get')return {mission:ClassroomMissionContent.empty(),state:null};
      if (!['battle','wheelAward','assist'].includes(type)) throw new Error('Unexpected request in battle fixture.');
      if (type === 'assist') __assistCalls.push(structuredClone(request));
      if (type === 'battle' && action.type === 'auto') throw new Error('Award points before fighting.');
      if (type === 'wheelAward') {
        __awardCalls.push(structuredClone(request));
        if (__failAward) throw new Error('Award save failed for test');
        if (__awardErrorCode) throw Object.assign(new Error('Roster changed before this award.'), {code:__awardErrorCode});
      }
      const ref = db.collection('classroomBattles').doc(currentUser.uid).collection('classes').doc(ClassroomBattleStore.classKey(classId));
      const result = await db.runTransaction(async tx => {
        if (type === 'assist') {
          const receipt=ref.collection('assists').doc(action.spinId+'-'+studentId),saved=await tx.get(receipt),snapshot=await tx.get(ref),old=snapshot.exists?snapshot.data():null;
          const profileRef=db.collection('assistHeroes').doc(studentId),profile=await tx.get(profileRef);
          let hero=old?.heroes.find(h=>h.studentId===studentId) || (profile.exists?profile.data():ClassroomBattleCore.heroFromStudent(rwStudents.find(s=>s.id===studentId)));
          if(saved.exists)return {hero,state:old,assist:saved.data(),duplicate:true};
          if(studentId===request.helpedStudentId)throw Error('Choose another helper.');
          hero=ClassroomBattleCore.grantAssistXp(hero,6);
          const assist={id:action.id,spinId:action.spinId,studentId,helpedStudentId:request.helpedStudentId,xp:6};
          const state=old?{...old,revision:old.revision+1,lastAssist:assist,heroes:old.heroes.map(h=>h.studentId===studentId?hero:h)}:null;
          tx.set(profileRef,hero);tx.set(receipt,assist);if(state)tx.set(ref,state);
          return {hero,state,assist};
        }
        const receipt = ref.collection('actions').doc(action.id), oldReceipt = await tx.get(receipt), snapshot = await tx.get(ref);
        const old = snapshot.exists ? snapshot.data() : null;
        if (oldReceipt.exists) return {state:old,award:oldReceipt.data().award};
        const trustedAction = type === 'wheelAward' ? {formation:'raid',...action, type:'auto', points:delta} : action;
        const next = ClassroomBattleCore.reduce(old, trustedAction);
        if (next === old) return {state:old};
        const state = {...next,teacherId:currentUser.uid,classId};
        let award;
        if (type === 'wheelAward') {
          if (!Number.isInteger(delta) || delta < 1 || delta > 10000 || !rwStudents.some(s => s.id === studentId && s.slots.includes(classId))) throw new Error('Invalid point award.');
          const studentRef = db.collection('students').doc(studentId), student = await tx.get(studentRef);
          award = {id:action.id,studentId,delta,marks:student.data().marks + delta};
          tx.set(studentRef,{marks:award.marks});
          const base = ClassroomBattleCore.reduce(old, {...trustedAction, points:1});
          window.__awardPower = {points:trustedAction.points,baseDamage:base.lastEvent.damage,damage:state.lastEvent.damage};
        }
        tx.set(ref,state);tx.set(receipt,{encounterId:state.encounterId,revision:state.revision,type:action.type,...(award?{award}:{})});return {state,award};
      });
      if(type==='battle'&&action.type==='summon'&&__replaceSummonReply){const replacement=ClassroomBattleCore.reduce(result.state,{type:'start',formation:'raid',id:'new-enemy-before-summon-reply',expectedRevision:result.state.revision,heroes:result.state.heroes,bossId:result.state.bossId});documents[ref.key]=replacement;localStorage.setItem('battle-fixture-documents',JSON.stringify(documents));notify(ref.key);}
      if (type === 'assist' && __loseAssistReply) { __loseAssistReply=false;throw Error('Assist saved but reply lost'); }
      if (type === 'wheelAward' && __awardReplyDelay) await new Promise(resolve => setTimeout(resolve, __awardReplyDelay));
      if (type === 'wheelAward' && __loseAwardReply) { __loseAwardReply = false; throw new Error('Award saved but reply lost for test'); }
      return result;
    };
    window.__battleDocuments = documents;
    window.__battleNotify = notify;
    window.__battleState = (cls = 'P5 Science') => documents['classroomBattles/teacher-fixture/classes/' + ClassroomBattleStore.classKey(cls)];
    localStorage.setItem('polymath.wheelClass', 'P5 Science');
    window.wheelRandom = () => 0;
    applyRewardVisibility();
  }, { delayProfiles });
  await page.click('#wheelBtn'); // the compact window: the wheel quest's default (v1.190.0)
  await page.waitForFunction(pending => !!window.QuickBattle && (pending ? !document.getElementById('wheelQuickRetry').hidden && !document.getElementById('wheelQuickRetry').disabled : !document.getElementById('wheelSpinBtn').disabled) && !document.getElementById('wheelQuickStatus').textContent.includes('Loading'), pendingAward);
}
async function settle() { await page.waitForFunction(() => document.getElementById('cbSaveStatus').textContent !== 'Saving…'); }
async function spin() {
  // The compact window's Turn or the full wheel's Spin, whichever is showing.
  await page.click(await page.locator('#cwSpin').isVisible() ? '#cwSpin' : '#wheelSpinBtn');
  await page.waitForFunction(() => !wheelSpinning && !document.getElementById('wheelSpinBtn').disabled, null, {timeout:8000});
}
async function award(points = 1) {
  await page.evaluate(points => wheelGive(points), points);
  await page.waitForFunction(() => !document.getElementById('wheelQuickStatus').textContent.includes('Saving answer'));
}
const QuestStageMin = 0.35;

// The worksheet underneath: a plain page with words, so the screenshots show
// the characters standing on it with the page showing through.
async function worksheet() {
  await page.evaluate(() => {
    const sheet = document.createElement('div');
    sheet.id = 'qsFixtureSheet';
    sheet.style.cssText = 'position:fixed;inset:60px 40px 20px 40px;background:#fff;color:#222;font:18px/1.7 Georgia,serif;padding:40px 60px;box-shadow:0 2px 12px #0003;z-index:1;overflow:hidden;pointer-events:none';
    sheet.innerHTML = '<h2 style="margin:0 0 12px">Worksheet 3: Forces and magnets</h2>' + Array.from({length: 14}, (_, i) => '<p style="margin:0 0 10px">' + (i + 1) + '. A magnet attracts objects made of iron, steel, nickel and cobalt. Explain why the toy train moves when the magnet is brought near it. ______________________</p>').join('');
    document.body.appendChild(sheet);
  });
}
const box = () => page.evaluate(() => { const r = document.getElementById('questStage').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, k: QuestStage.box().k }; });
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('polymath.questStage.v1') || 'null'));
const duelIn = () => page.evaluate(() => { const d = document.getElementById('wheelQuickDuel'); return d ? (d.closest('#questStage') ? 'stage' : d.closest('#cwBattle') ? 'compact' : d.closest('#wheelQuickFight') ? 'wheel' : 'elsewhere') : 'missing'; });

try {
  await setup();
  await worksheet();
  check('the 🧙 button sits in the wheel title bar, off at first', await page.evaluate(() => {
    const b = document.getElementById('wheelStageBtn');
    return !!b && b.closest('#wheelHead') && b.getAttribute('aria-pressed') === 'false' && !document.getElementById('questStage')?.offsetParent;
  }));
  check('the compact window holds the duel before the stage is turned on', await duelIn() === 'compact');
  await spin();
  await award(3);
  await page.waitForFunction(() => !!document.querySelector('#wheelQuickDuel .cbQuickEnemy :is(img,.cbEnemySprite)'));

  // ---- On ----
  await page.click('#wheelStageBtn');
  await page.waitForFunction(() => QuestStage.holds());
  check('🧙 moves the live duel onto the worksheet', await duelIn() === 'stage');
  check('the button is lit and pressed', await page.evaluate(() => { const b = document.getElementById('wheelStageBtn'); return b.classList.contains('active') && b.getAttribute('aria-pressed') === 'true'; }));
  check('the wheel shows a note with Bring it back where the characters were', await page.evaluate(() => {
    const n = document.getElementById('questStageNote');
    return !!n && !n.hidden && !!n.closest('#cwBattle') && n.offsetParent !== null && /Bring it back/.test(n.textContent);
  }));
  check('the compact window does not show its empty-battle message under the note', await page.evaluate(() => document.getElementById('cwBattleEmpty').hidden));
  const stageStyle = await page.evaluate(() => {
    const s = document.getElementById('questStage'), cs = getComputedStyle(s), duel = getComputedStyle(document.getElementById('wheelQuickDuel'));
    return { bg: cs.backgroundColor, pe: cs.pointerEvents, duelBg: duel.backgroundColor, duelImage: duel.backgroundImage, pos: cs.position };
  });
  check('the stage and the duel have no background: the worksheet shows through', stageStyle.bg === 'rgba(0, 0, 0, 0)' && stageStyle.duelBg === 'rgba(0, 0, 0, 0)' && stageStyle.duelImage === 'none');
  check('the stage is a fixed layer whose empty parts let presses through', stageStyle.pos === 'fixed' && stageStyle.pe === 'none');
  check('both sides are on the worksheet: a hero and an enemy picture', await page.evaluate(() => !!document.querySelector('#questStage .cbQuickHero :is(.cbaHero,.cbAvatar,img)') && !!document.querySelector('#questStage .cbQuickEnemy :is(img,.cbEnemySprite)')));
  let b0 = await box();
  check('the stage lands inside the screen at the normal size', b0.x >= 0 && b0.y >= 0 && b0.x + b0.w <= 1440 && b0.y + b0.h <= 1000 && b0.k === 1 && b0.w > 300);
  const hit = await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e && (e.closest('#questStage') ? 'stage' : e.closest('#qsFixtureSheet') ? 'sheet' : e.id || e.tagName); }, { x: b0.x + 2, y: b0.y + b0.h - 2 });
  check('a press on an empty corner of the stage reaches the worksheet', hit !== 'stage');
  await page.screenshot({ path: path.join(output, 'quest-stage-on-worksheet.png') });

  // ---- Drag to move ----
  const hero = page.locator('#questStage .cbQuickHero').first();
  const hb = await hero.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 3);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 - 100, hb.y + hb.height / 3 - 150, { steps: 8 });
  await page.mouse.up();
  let b1 = await box();
  check('dragging a character moves the whole stage by the drag', Math.abs((b0.x - b1.x) - 100) <= 2 && Math.abs((b0.y - b1.y) - 150) <= 2 && b1.k === b0.k);
  check('the place is remembered', await stored().then(s => s && s.on === true && Math.abs(s.x - b1.x) <= 1 && Math.abs(s.y - b1.y) <= 1));
  // The ⠿ handle moves it too.
  await page.hover('#questStage .qsHero, #questStage .cbQuickHero');
  const handle = await page.locator('#questStage .qsMove').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 60, handle.y + handle.height / 2 + 20, { steps: 5 });
  await page.mouse.up();
  const b1b = await box();
  check('the ⠿ handle drags the stage', Math.abs((b1b.x - b1.x) - 60) <= 2 && Math.abs((b1b.y - b1.y) - 20) <= 2);
  b1 = b1b;

  // ---- Corner resize ----
  const grip = await page.locator('#questStageGrip').boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + b1.w * 0.3, grip.y + grip.height / 2 + b1.h * 0.3, { steps: 10 });
  await page.mouse.up();
  const b2 = await box();
  if (process.env.QS_DEBUG) console.log(JSON.stringify({ b1, b2, grip }));
  check('dragging the corner makes the characters bigger, keeping their shape', b2.k > 1.2 && Math.abs(b2.w / b2.h - b1.w / b1.h) < 0.03 && Math.abs(b2.y - b1.y) <= 1);
  check('a stage grown past the right edge is slid back on screen, not cut off', (Math.abs(b2.x - b1.x) <= 1 || Math.abs(b2.x + b2.w - 1440) <= 1) && b2.x + b2.w <= 1441);
  check('the pictures really scale with it', await page.evaluate(k => { const inner = document.getElementById('questStageInner'); return inner.style.transform === 'scale(' + k + ')' && inner.dataset.qsScale === String(k); }, b2.k));
  await page.screenshot({ path: path.join(output, 'quest-stage-bigger.png') });
  await page.mouse.move(grip.x + grip.width / 2 + b1.w * 0.3, grip.y + grip.height / 2 + b1.h * 0.3);
  const g2 = await page.locator('#questStageGrip').boundingBox();
  await page.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2);
  await page.mouse.down();
  await page.mouse.move(g2.x - 2000, g2.y - 2000, { steps: 6 });
  await page.mouse.up();
  const b3 = await box();
  check('shrinking stops at the smallest size and stays on screen', b3.k === QuestStageMin && b3.x >= 0 && b3.y >= 0);

  // ---- Buttons and keys ----
  await page.evaluate(() => { const s = QuestStage.settings(); });
  await page.hover('#questStage .cbQuickHero');
  await page.click('#questStage [data-qs="bigger"]');
  check('+ makes it bigger by a step', await page.evaluate(min => Math.abs(QuestStage.box().k - (min + 0.1)) < 1e-6, QuestStageMin));
  await page.click('#questStage [data-qs="reset"]');
  const b4 = await box();
  check('↺ puts it back at the normal size in the corner', b4.k === 1 && b4.x + b4.w <= 1440 && b4.x > 600);
  await page.focus('#questStage');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Shift+ArrowUp');
  const b5 = await box();
  check('arrow keys move the focused stage', Math.abs((b4.x - b5.x) - 10) <= 1 && Math.abs((b4.y - b5.y) - 40) <= 1);
  await page.keyboard.press('+');
  check('+ on the keyboard resizes around the middle', await page.evaluate(() => Math.abs(QuestStage.box().k - 1.1) < 1e-6));
  await page.keyboard.press('0');
  check('0 resets the size', await page.evaluate(() => QuestStage.box().k === 1));

  await page.click('#questStage [data-qs="labels"]');
  if (process.env.QS_DEBUG) console.log(await page.evaluate(() => { const s = document.getElementById('questStage'), n = s.querySelector('.cbQuickDuel strong'), e = s.querySelector('.cbQuickEnemy :is(img,.cbEnemySprite)'); return [s.className, n && getComputedStyle(n).display, e && e.getBoundingClientRect().width, e && e.tagName]; }));
  check('🏷 off hides the names and bars, leaving only the characters', await page.evaluate(() => {
    const s = document.getElementById('questStage'), name = s.querySelector('.cbQuickDuel strong');
    return s.classList.contains('qsNoLabels') && (!name || getComputedStyle(name).display === 'none') && !!s.querySelector('.cbQuickEnemy :is(img,.cbEnemySprite)').getBoundingClientRect().width;
  }));
  await page.screenshot({ path: path.join(output, 'quest-stage-characters-only.png') });
  await page.click('#questStage [data-qs="labels"]');
  await page.click('#questStage [data-qs="flip"]');
  check('⇋ puts the heroes on the right', await page.evaluate(() => {
    const h = document.querySelector('#questStage .cbQuickHero').getBoundingClientRect(), e = document.querySelector('#questStage .cbQuickEnemy').getBoundingClientRect();
    return h.left > e.left;
  }));
  await page.click('#questStage [data-qs="flip"]');
  await page.click('#questStage [data-qs="faint"]');
  check('👻 makes the characters faint', await page.evaluate(() => Number(getComputedStyle(document.getElementById('questStageInner')).opacity) < 0.9));
  await page.click('#questStage [data-qs="faint"]');
  check('the options are remembered', await stored().then(s => s.labels === true && s.flip === false && s.faint === false));

  // ---- The fight keeps going on the worksheet ----
  const before = await page.evaluate(() => __battleState().revision);
  await spin();
  await award(2);
  check('awarding points while the quest is on the worksheet still fights, in the stage', await page.evaluate(r => __battleState().revision > r, before) && await duelIn() === 'stage');
  check('the stage still shows the characters after the repaint', await page.evaluate(() => !!document.querySelector('#questStage .cbQuickHero') && document.getElementById('questStage').offsetParent !== null || getComputedStyle(document.getElementById('questStage')).display !== 'none'));

  // ---- Full wheel and back ----
  await page.click('#wheelMinBtn');
  check('restoring the full wheel keeps the duel on the worksheet, with the note in the full wheel', await duelIn() === 'stage' && await page.evaluate(() => { const n = document.getElementById('questStageNote'); return !n.hidden && !!n.closest('#wheelQuickFight'); }));
  await page.click('#wheelMinBtn');
  check('back to compact: the note follows into the compact battle box', await page.evaluate(() => !!document.getElementById('questStageNote').closest('#cwBattle')) && await duelIn() === 'stage');

  // ---- Quick fight off and on ----
  await page.evaluate(() => setWheelMin(false));
  await page.click('#wheelQuickToggle');
  await page.waitForFunction(() => !QuestStage.holds());
  check('turning Quick fight off gives the duel back and hides the stage', await page.evaluate(() => getComputedStyle(document.getElementById('questStage')).display === 'none'));
  await page.click('#wheelQuickToggle');
  await page.waitForFunction(() => QuestStage.holds());
  check('turning it on again walks the quest back onto the worksheet', await duelIn() === 'stage');
  await page.evaluate(() => setWheelMin(true));

  // ---- Bring it back ----
  await page.click('#questStageNote .qsNoteBack');
  check('Bring it back returns the duel to the compact window', await duelIn() === 'compact' && await page.evaluate(() => !QuestStage.holds() && document.getElementById('questStageNote').hidden));
  check('and remembers it is off', await stored().then(s => s.on === false));

  // ---- Close and reopen remembers ----
  await page.click('#wheelStageBtn');
  await page.waitForFunction(() => QuestStage.holds());
  const placed = await box();
  await page.click('#wheelCloseBtn');
  check('closing the wheel takes the quest off the worksheet and gives the duel back', await page.evaluate(() => !QuestStage.holds() && getComputedStyle(document.getElementById('questStage')).display === 'none' && !document.querySelector('#questStage #wheelQuickDuel')));
  await page.click('#wheelBtn');
  await page.waitForFunction(() => QuestStage.holds(), null, { timeout: 8000 });
  const again = await box();
  check('opening the wheel again puts the quest back where it was', Math.abs(again.x - placed.x) <= 1 && Math.abs(again.y - placed.y) <= 1 && again.k === placed.k);

  // ---- Reload ----
  await setup();
  await page.waitForFunction(() => QuestStage.holds(), null, { timeout: 8000 });
  const reloaded = await box();
  check('after a reload the quest comes back to the same place and size', Math.abs(reloaded.x - placed.x) <= 1 && Math.abs(reloaded.y - placed.y) <= 1);

  // ---- Small screen ----
  await page.setViewportSize({ width: 390, height: 760 });
  await page.waitForTimeout(100);
  const phone = await box();
  check('on a phone-sized window the stage shrinks and stays on screen', phone.x >= 0 && phone.y >= 0 && phone.x + phone.w <= 391 && phone.y + phone.h <= 761);
  await page.screenshot({ path: path.join(output, 'quest-stage-phone.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });

  // ---- Print ----
  await page.emulateMedia({ media: 'print' });
  check('the quest never prints', await page.evaluate(() => getComputedStyle(document.getElementById('questStage')).display === 'none'));
  await page.emulateMedia({ media: 'screen' });

  // ---- Manual battle takes it back ----
  await page.evaluate(() => ClassroomBattle.open());
  await page.waitForFunction(() => ClassroomBattle.isOpen());
  check('the manual Battle screen takes the quest off the worksheet', await page.evaluate(() => !QuestStage.holds() && !document.querySelector('#questStage #wheelQuickDuel')));

  check('the quest on the worksheet raises no application exceptions', errors.length === 0);
  console.log('\n' + checks + ' quest-on-the-worksheet browser checks passed. Screenshots: ' + output);
} catch (error) {
  console.error(errors);
  throw error;
} finally { await browser.close(); server.close(); }
