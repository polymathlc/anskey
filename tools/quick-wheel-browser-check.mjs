// Real application integration: original wheel + actual battle core/store/controller.
// Firebase is a persistent local transaction fixture; credentials are never required.
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
const file = pathToFileURL(path.resolve('index.html')).href;
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
        const trustedAction = type === 'wheelAward' ? {...action, type:'auto', points:delta} : action;
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
      if(type==='battle'&&action.type==='summon'&&__replaceSummonReply){const replacement=ClassroomBattleCore.reduce(result.state,{type:'start',id:'new-enemy-before-summon-reply',expectedRevision:result.state.revision,heroes:result.state.heroes,bossId:result.state.bossId});documents[ref.key]=replacement;localStorage.setItem('battle-fixture-documents',JSON.stringify(documents));notify(ref.key);}
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
  await page.click('#wheelBtn');
  await page.waitForFunction(pending => !!window.QuickBattle && (pending ? !document.getElementById('wheelQuickRetry').hidden && !document.getElementById('wheelQuickRetry').disabled : !document.getElementById('wheelSpinBtn').disabled) && !document.getElementById('wheelQuickStatus').textContent.includes('Loading'), pendingAward);
}
async function settle() { await page.waitForFunction(() => document.getElementById('cbSaveStatus').textContent !== 'Saving…'); }
async function spin() {
  await page.click('#wheelSpinBtn');
  await page.waitForFunction(() => !wheelSpinning && !document.getElementById('wheelSpinBtn').disabled, null, {timeout:8000});
}
async function award(points = 1) {
  await page.evaluate(points => wheelGive(points), points);
  await page.waitForFunction(() => !document.getElementById('wheelQuickStatus').textContent.includes('Saving answer'));
}
async function scrollWheelToTop() {
  await page.evaluate(() => document.querySelectorAll('#wheelCard, #wheelCard *').forEach(node => {
    if (node.scrollHeight > node.clientHeight) node.scrollTop = 0;
  }));
}
async function wheelLayout() {
  return page.evaluate(() => {
    const rect = selector => {
      const { x, y, width, height, right, bottom } = document.querySelector(selector).getBoundingClientRect();
      return { x, y, width, height, right, bottom };
    };
    const wheel = rect('#wheelCanvas'), card = rect('#wheelCard'), mission = rect('#wheelMissionDock');
    const turn = rect('#wheelMission [data-mm=turn]');
    const contains = (outer, inner) => inner.x >= outer.x - 1 && inner.right <= outer.right + 1 && inner.y >= outer.y - 1 && inner.bottom <= outer.bottom + 1;
    const viewport = { x: 0, y: 0, right: innerWidth, bottom: innerHeight };
    const overflow = [...document.querySelectorAll('#wheelCard, #wheelCard .whBody, #wheelMissionDock, #wheelQuickFight')].filter(node => node.scrollWidth > node.clientWidth + 2).map(node => node.id || node.className);
    return { wheel, card, mission, turn, overflow, inViewport: contains(viewport, card), wheelVisible: contains(viewport, wheel), turnVisible: contains(viewport, turn) };
  });
}
try {
  await setup();
  await page.waitForFunction(() => document.querySelector('#wheelMission [data-mm=turn]') && !document.querySelector('#wheelMission [data-mm=turn]').disabled);
  const desktopLayout = await wheelLayout();
  check('opening Wheel shows a large wheel and usable mission machine together without a disclosure click', desktopLayout.wheel.width >= 360 && desktopLayout.wheelVisible && desktopLayout.turnVisible && desktopLayout.mission.x >= desktopLayout.wheel.right && desktopLayout.inViewport);
  await page.locator('#wheelMission [data-mm=turn]').click({ trial: true });
  check('desktop wheel, mission and fight panels fit without horizontal scrolling', desktopLayout.overflow.length === 0);
  await page.screenshot({ path: path.join(output, 'quick-wheel-mission-desktop.png'), fullPage: true });
  check('ordinary Wheel enables Quick fight by default without opening manual battle',await page.evaluate(()=>document.getElementById('wheelQuickToggle').checked&&!ClassroomBattle.isOpen()));
  check('new party preview shows a pixel hero and encounter hint',await page.locator('#wheelQuickDuel .cbAvatar').count()===1);
  await spin();
  check('spin selects a hero without creating combat, XP, an enemy turn or rewards',await page.evaluate(()=>!__battleState()&&__awardCalls.length===0&&rwStudents.every(s=>s.marks===10)&&document.querySelector('.cbQuickHero').textContent.includes(wheelState.names[wheelWinnerIdx].n)));
  const firstSpin=await page.evaluate(()=>wheelState.lastSpinId);
  await page.evaluate(async()=>{const entry=wheelState.names[wheelWinnerIdx];await ClassroomBattle.landed(entry,wheelState.lastSpinId);await ClassroomBattle.landed(entry,wheelState.lastSpinId);});
  check('repeated landing callbacks remain a read-only hero preview',await page.evaluate(()=>!__battleState()&&__awardCalls.length===0));
  await award();
  check('awarding one point starts combat, chooses a skill and resolves one enemy reply',await page.evaluate(()=>{const s=__battleState();return s.lastEvent.type==='auto'&&s.lastEvent.skillId&&s.lastEvent.enemy&&s.pending===null&&s.bossTurns===1&&__awardCalls[0].delta===1;}));
  check('wheel displays hero versus enemy avatars with HP and MP',await page.evaluate(()=>document.querySelectorAll('#wheelQuickDuel .cbaHero').length===1&&document.querySelectorAll('#wheelQuickDuel .cbQuickEnemy img').length===1&&document.getElementById('wheelQuickDuel').textContent.includes('MP ')&&document.getElementById('wheelQuickDuel').textContent.includes('HP ')));
  const genderBattle=await page.evaluate(()=>{const s=__battleState();const h=s.heroes.find(h=>h.id===s.lastEvent.heroId);h.gender='female';__battleNotify('classroomBattles/teacher-fixture/classes/'+ClassroomBattleStore.classKey('P5 Science'));return JSON.stringify(s);});
  check('wheel uses saved character gender without resolving another turn',await page.evaluate(before=>JSON.stringify(__battleState())===before,genderBattle)&&await page.locator('.cbQuickHero [data-cba-gender="female"]').count()===1);
  check('combat and the awarded point update the same student exactly once',await page.evaluate(()=>{const s=wheelStudent(wheelState.names[wheelWinnerIdx]);return s.marks===11&&__battleDocuments['students/'+s.id].marks===11&&wheelGiven===1;}));
  await award(5);
  check('five awarded points increase attack damage and may follow another award on the same spin',await page.evaluate(id=>wheelState.lastSpinId===id&&__awardCalls.length===2&&__awardCalls[1].delta===5&&__awardPower.points===5&&__awardPower.damage>__awardPower.baseDamage&&wheelGiven===6&&wheelStudent(wheelState.names[wheelWinnerIdx]).marks===16,firstSpin));
  const first=await page.evaluate(()=>JSON.stringify(__battleState()));
  await page.evaluate(()=>ClassroomHeroAPI.request(__awardCalls[0]));
  check('replaying an award receipt cannot add marks, combat, XP or another enemy turn',await page.evaluate(first=>JSON.stringify(__battleState())===first&&wheelStudent(wheelState.names[wheelWinnerIdx]).marks===16&&__battleDocuments['students/'+wheelStudent(wheelState.names[wheelWinnerIdx]).id].marks===16,first));
  await page.evaluate(async()=>{await wheelGive(0);});
  check('zero points do not trigger a battle command',await page.evaluate(first=>JSON.stringify(__battleState())===first&&__awardCalls.length===3,first));
  await page.screenshot({path:path.join(output,'quick-wheel-duel.png'),fullPage:true});
  await setup();
  check('reload restores duel and marks without replaying the last spin',await page.evaluate(first=>JSON.stringify(__battleState())===first&&__awardCalls.length===0&&rwStudents.some(s=>s.marks===16),first));
  const called=await page.evaluate(()=>wheelState.names.filter(n=>n.done).length);
  await page.click('#wheelSpinBtn');await page.evaluate(()=>closeWheel());await page.waitForTimeout(650);
  check('closing mid-spin cancels battle work while retaining the wheel call',await page.evaluate(({first,called})=>JSON.stringify(__battleState())===first&&!wheelSpinning&&wheelState.names.filter(n=>n.done).length===called+1,{first,called}));
  await page.evaluate(()=>openWheel());await page.waitForFunction(()=>!document.getElementById('wheelSpinBtn').disabled);
  await page.uncheck('#wheelQuickToggle');
  await page.click('#wheelSpinBtn');await page.waitForFunction(()=>!wheelSpinning);
  check('turning Quick fight off leaves an ordinary name wheel',await page.evaluate(first=>JSON.stringify(__battleState())===first&&document.getElementById('wheelQuickDuel').hidden,first));
  await page.waitForFunction(() => document.querySelector('#wheelMission [data-mm=turn]') && !document.querySelector('#wheelMission [data-mm=turn]').disabled);
  await scrollWheelToTop();
  check('mission machine remains visible and usable while Quick fight is off', await page.locator('#wheelMissionDock').isVisible() && (await wheelLayout()).turnVisible);
  await page.locator('#wheelMission [data-mm=turn]').click({ trial: true });
  await page.check('#wheelQuickToggle');await page.waitForFunction(()=>!document.getElementById('wheelSpinBtn').disabled);
  await spin();
  const beforeFailure=await page.evaluate(()=>({state:JSON.stringify(__battleState()),marks:wheelStudent(wheelState.names[wheelWinnerIdx]).marks}));
  await page.evaluate(()=>__failAward=true);await award(2);
  check('failed point save causes no combat or points and preserves a retryable award',await page.evaluate(prior=>JSON.stringify(__battleState())===prior.state&&wheelStudent(wheelState.names[wheelWinnerIdx]).marks===prior.marks&&document.getElementById('wheelSpinBtn').disabled&&document.getElementById('wheelQuickRetry'),beforeFailure));
  const failedId=await page.evaluate(()=>__awardCalls.at(-1).action.id);
  await page.evaluate(()=>__failAward=false);await page.click('#wheelQuickRetry');await page.waitForFunction(()=>!document.getElementById('wheelSpinBtn').disabled);
  check('retry reuses the same award identity and credits points once',await page.evaluate(({id,prior})=>__awardCalls.at(-1).action.id===id&&wheelStudent(wheelState.names[wheelWinnerIdx]).marks===prior.marks+2&&__battleState().revision===JSON.parse(prior.state).revision+1,{id:failedId,prior:beforeFailure}));
  const beforeDouble=await page.evaluate(()=>({calls:__awardCalls.length,marks:wheelStudent(wheelState.names[wheelWinnerIdx]).marks,revision:__battleState().revision}));
  await page.evaluate(()=>Promise.all([wheelGive(1),wheelGive(5)]));
  check('concurrent point clicks save only the first award',await page.evaluate(prior=>__awardCalls.length===prior.calls+1&&wheelStudent(wheelState.names[wheelWinnerIdx]).marks===prior.marks+1&&__battleState().revision===prior.revision+1,beforeDouble));
  const beforeLost=await page.evaluate(()=>({marks:wheelStudent(wheelState.names[wheelWinnerIdx]).marks,revision:__battleState().revision}));
  await page.evaluate(()=>__loseAwardReply=true);await award(3);
  const lostId=await page.evaluate(()=>__awardCalls.at(-1).action.id);
  check('a lost server reply keeps the original award available for retry',await page.evaluate(prior=>__battleState().revision===prior.revision+1&&document.getElementById('wheelSpinBtn').disabled&&!document.querySelector('.cbaPlaying'),beforeLost));
  await page.click('#wheelQuickRetry');await page.waitForFunction(()=>!document.getElementById('wheelSpinBtn').disabled);
  check('retry after a committed award does not repeat damage, XP or points',await page.evaluate(({id,prior})=>__awardCalls.at(-1).action.id===id&&__battleState().revision===prior.revision+1&&wheelStudent(wheelState.names[wheelWinnerIdx]).marks===prior.marks+3&&__battleDocuments['students/'+wheelStudent(wheelState.names[wheelWinnerIdx]).id].marks===prior.marks+3,{id:lostId,prior:beforeLost}));
  await page.evaluate(()=>{const s=__battleState();s.bossHp=1;s.heroes.forEach(h=>h.hp=h.stats.maxHp);__battleNotify('classroomBattles/teacher-fixture/classes/'+ClassroomBattleStore.classKey('P5 Science'));});
  const waitingVictory=await page.evaluate(()=>JSON.stringify(__battleState()));
  await spin();
  check('selecting the next student leaves the existing enemy and party unchanged',await page.evaluate(old=>JSON.stringify(__battleState())===old,waitingVictory));
  await award();
  check('awarded final hit shows an animated chest and saved personal treasure for every hero',await page.evaluate(()=>__battleState().status==='victory'&&__battleState().rewards.length===16&&document.querySelectorAll('.cbQuickTreasure .cbChest').length===1&&document.querySelectorAll('.cbQuickTreasure .cbReward').length===16&&document.querySelectorAll('.cbQuickTreasure .cbItemIcon[role=img]').length===16));
  await scrollWheelToTop();
  const victoryLayout = await wheelLayout();
  check('a full class treasure grid leaves the wheel and mission control usable', victoryLayout.wheel.width >= 360 && victoryLayout.wheelVisible && victoryLayout.turnVisible && victoryLayout.overflow.length === 0);
  await page.locator('#wheelMission [data-mm=turn]').click({ trial: true });
  await page.locator('.cbQuickTreasure').evaluate(node=>node.scrollIntoView({block:'start'}));
  await page.screenshot({path:path.join(output,'quick-wheel-treasure.png'),fullPage:true});
  const victory=await page.evaluate(()=>({id:__battleState().encounterId,xp:__battleState().heroes.reduce((sum,h)=>sum+h.xp,0)}));
  await spin();
  check('spinning after victory does not start another encounter',await page.evaluate(v=>__battleState().encounterId===v.id&&__battleState().status==='victory',victory));
  await award();
  check('next awarded answer starts a new encounter and carries all XP forward',await page.evaluate(v=>__battleState().encounterId!==v.id&&__battleState().heroes.reduce((sum,h)=>sum+h.xp,0)===v.xp+12,victory));
  await page.click('#wheelBattleBtn');await page.waitForFunction(()=>!document.getElementById('wheelSpinBtn').disabled);
  await page.click('#wheelSpinBtn');await page.waitForFunction(()=>!!__battleState().pending);
  const pending=await page.evaluate(()=>__battleState().pending.id);
  await page.click('#cbClose');await page.evaluate(()=>openWheel());await page.waitForFunction(()=>document.getElementById('wheelQuickStatus').textContent.includes('manual answer'));
  check('Quick fight preserves a pending manual answer and refuses another spin',await page.evaluate(id=>__battleState().pending.id===id&&document.getElementById('wheelSpinBtn').disabled&&!ClassroomBattle.beforeSpin(),pending));
  await page.click('#wheelBattleBtn');await page.waitForFunction(()=>!document.getElementById('cbEnd').disabled);
  await page.click('#cbEnd');await settle();
  check('teacher can end a lesson encounter to release hero changes without awarding victory loot',await page.evaluate(()=>__battleState().status==='defeat'&&!__battleState().pending&&__battleState().rewards.length===0));
  await page.click('#cbClose');await page.evaluate(()=>openWheel());await page.waitForFunction(()=>!document.getElementById('wheelSpinBtn').disabled);
  const end=await page.evaluate(()=>JSON.stringify(__battleState()));
  await page.click('#wheelSpinBtn');await page.evaluate(()=>wheelSetClass('P6 Science'));await page.waitForTimeout(650);
  check('changing lesson slot during spin cannot write to either encounter',await page.evaluate(end=>JSON.stringify(__battleState())===end&&!__battleState('P6 Science')&&!wheelSpinning,end));
  await page.evaluate(()=>{isAdmin=()=>false;applyRewardVisibility();});
  check('sign-out or student mode closes the wheel and drops quick subscriptions',await page.evaluate(()=>!wheelIsOpen()&&!ClassroomBattle.isOpen()));
  await setup();
  await page.evaluate(()=>{
    wheelState.names[0].id='';wheelWinnerIdx=0;wheelState.lastSpinId='name-only-wheel-spin-001';
    ClassroomBattle.landed(wheelState.names[0],wheelState.lastSpinId);wheelRender();
  });
  check('a name-only entry that matches the roster previews the canonical student hero',await page.evaluate(()=>document.querySelector('.cbQuickHero').dataset.cbaHeroId==='student:student-0'));
  await award();
  check('awarding a name-only linked entry uses its student hero without a duplicate guest',await page.evaluate(()=>__awardCalls.at(-1).studentId==='student-0'&&__awardCalls.at(-1).action.heroId==='student:student-0'&&__battleState().heroes.filter(h=>h.name==='Ari').length===1&&__battleState().heroes.find(h=>h.id==='student:student-0').xp>0));
  await spin();
  const beforeRejection=await page.evaluate(()=>({state:JSON.stringify(__battleState()),marks:wheelStudent(wheelState.names[wheelWinnerIdx]).marks}));
  await page.evaluate(()=>__awardErrorCode='roster_changed');await award(2);
  check('an explicit uncommitted roster rejection clears retry state and unlocks the wheel',await page.evaluate(prior=>JSON.stringify(__battleState())===prior.state&&wheelStudent(wheelState.names[wheelWinnerIdx]).marks===prior.marks&&!document.getElementById('wheelSpinBtn').disabled&&!document.getElementById('wheelClassSelect').disabled&&document.getElementById('wheelQuickRetry').hidden&&!sessionStorage.getItem('polymath.wheelAward.teacher-fixture.P5%20Science'),beforeRejection));
  await page.evaluate(()=>__awardErrorCode=null);await spin();
  const beforeReload=await page.evaluate(()=>({studentId:wheelStudent(wheelState.names[wheelWinnerIdx]).id,marks:wheelStudent(wheelState.names[wheelWinnerIdx]).marks,revision:__battleState().revision}));
  await page.evaluate(()=>__failAward=true);await award(2);
  const reloadId=await page.evaluate(()=>__awardCalls.at(-1).action.id);
  await setup(0,true);
  check('reloading restores an uncertain award without sending it automatically',await page.evaluate(prior=>__awardCalls.length===0&&__battleState().revision===prior.revision&&document.getElementById('wheelSpinBtn').disabled&&!document.getElementById('wheelQuickRetry').hidden,beforeReload));
  await page.click('#wheelQuickRetry');await page.waitForFunction(()=>!document.getElementById('wheelSpinBtn').disabled);
  check('the restored award retries its original receipt for the original student',await page.evaluate(({id,prior})=>__awardCalls.at(-1).action.id===id&&__awardCalls.at(-1).studentId===prior.studentId&&__battleState().revision===prior.revision+1&&rwStudents.find(s=>s.id===prior.studentId).marks===prior.marks+2,{id:reloadId,prior:beforeReload}));
  await spin();
  const beforeCloseAward=await page.evaluate(()=>({studentId:wheelStudent(wheelState.names[wheelWinnerIdx]).id,marks:wheelStudent(wheelState.names[wheelWinnerIdx]).marks,revision:__battleState().revision}));
  await page.evaluate(()=>{__awardReplyDelay=400;window.__awardInFlight=wheelGive(3);});
  await page.waitForFunction(revision=>__battleState().revision===revision+1,beforeCloseAward.revision);
  const closeAwardId=await page.evaluate(()=>__awardCalls.at(-1).action.id);
  await page.evaluate(()=>closeWheel());await page.evaluate(()=>__awardInFlight);
  check('closing after a server commit stops presentation while keeping its retry receipt',await page.evaluate(prior=>!wheelIsOpen()&&__battleState().revision===prior.revision+1&&!!sessionStorage.getItem('polymath.wheelAward.teacher-fixture.P5%20Science')&&!document.querySelector('.cbaPlaying'),beforeCloseAward));
  await page.evaluate(()=>{__awardReplyDelay=0;openWheel();});
  await page.waitForFunction(()=>!document.getElementById('wheelQuickRetry').hidden&&!document.getElementById('wheelQuickRetry').disabled);
  await page.click('#wheelQuickRetry');await page.waitForFunction(()=>!document.getElementById('wheelSpinBtn').disabled);
  check('reopening and confirming a committed award cannot award damage or points twice',await page.evaluate(({id,prior})=>__awardCalls.at(-1).action.id===id&&__battleState().revision===prior.revision+1&&rwStudents.find(s=>s.id===prior.studentId).marks===prior.marks+3&&__battleDocuments['students/'+prior.studentId].marks===prior.marks+3,{id:closeAwardId,prior:beforeCloseAward}));
  await spin();
  check('wheel displays labelled hero and enemy HP/MP bars with saved values',await page.evaluate(()=>{
    const bars=[...document.querySelectorAll('#wheelQuickDuel [role=progressbar]')],state=__battleState(),hero=state.heroes.find(h=>h.id===document.querySelector('.cbQuickHero').dataset.cbaHeroId);
    return bars.length===4&&bars.every(b=>b.getAttribute('aria-label')&&Number(b.getAttribute('aria-valuemax'))>0)&&Number(bars[0].getAttribute('aria-valuenow'))===hero.hp&&Number(bars[1].getAttribute('aria-valuenow'))===hero.mp&&Number(bars[2].getAttribute('aria-valuenow'))===state.bossHp&&Number(bars[3].getAttribute('aria-valuenow'))===state.bossMp;
  }));
  await page.click('[data-assist-toggle]');
  const helper=await page.evaluate(()=>{const called=wheelStudent(wheelState.names[wheelWinnerIdx]),helper=rwStudents.find(s=>s.id!==called.id);return {id:helper.id,called:called.id,name:helper.name};});
  check('Assist picker excludes the called student',await page.evaluate(id=>![...document.querySelectorAll('#wheelAssistStudent option')].some(o=>o.value===id),helper.called));
  await page.selectOption('#wheelAssistStudent',helper.id);
  const beforeAssist=await page.evaluate(id=>({xp:__battleState().heroes.find(h=>h.studentId===id).xp,hp:__battleState().bossHp,mp:__battleState().bossMp,turns:__battleState().bossTurns,count:__battleState().actionCount,marks:rwStudents.map(s=>s.marks),animations:__battleAnimations.length}),helper.id);
  await page.click('[data-assist-save]');await page.waitForFunction(()=>!document.getElementById('wheelSpinBtn').disabled);
  check('Assist gives the selected helper 6 XP with no attack, enemy turn or marks change',await page.evaluate(({before,id})=>{const state=__battleState();return state.heroes.find(h=>h.studentId===id).xp===before.xp+6&&state.bossHp===before.hp&&state.bossMp===before.mp&&state.bossTurns===before.turns&&state.actionCount===before.count&&JSON.stringify(rwStudents.map(s=>s.marks))===JSON.stringify(before.marks)&&__battleAnimations.length===before.animations;},{before:beforeAssist,id:helper.id}));
  check('the helper is marked as already rewarded for this question',await page.evaluate(id=>document.querySelector('#wheelAssistStudent option[value="'+id+'"]').disabled,helper.id));
  const dedupAssist=await page.evaluate(async()=>ClassroomHeroAPI.request({...__assistCalls.at(-1),action:{...__assistCalls.at(-1).action,id:'new-client-assist-id-0001'}}));
  check('different client receipt for the same helper/question still awards only once',dedupAssist.duplicate&&dedupAssist.hero.xp===beforeAssist.xp+6);
  await page.screenshot({path:path.join(output,'quick-wheel-assist-bars.png'),fullPage:true});
  await spin();await page.click('[data-assist-toggle]');
  const retryHelper=await page.evaluate(()=>document.querySelector('#wheelAssistStudent option:not(:disabled)').value);
  await page.selectOption('#wheelAssistStudent',retryHelper);
  const retryXp=await page.evaluate(id=>__battleState().heroes.find(h=>h.studentId===id).xp,retryHelper);
  await page.evaluate(()=>__loseAssistReply=true);await page.click('[data-assist-save]');await page.waitForFunction(()=>!document.getElementById('wheelQuickRetry').hidden);
  check('uncertain assist retains a dedicated retry and blocks conflicting awards',await page.evaluate(()=>document.getElementById('wheelQuickRetry').textContent.includes('Retry assist')&&document.getElementById('wheelSpinBtn').disabled&&document.querySelector('#wheelAward button').disabled));
  await page.click('#wheelQuickRetry');await page.waitForFunction(()=>!document.getElementById('wheelSpinBtn').disabled);
  check('retrying an assist after a lost reply cannot duplicate XP',await page.evaluate(({id,xp})=>__battleState().heroes.find(h=>h.studentId===id).xp===xp+6&&document.getElementById('wheelQuickRetry').hidden,{id:retryHelper,xp:retryXp}));
  await page.waitForFunction(()=>!document.querySelector('#wheelMission [data-source=teacher]').disabled);
  const beforeChung=await page.evaluate(()=>__battleState().bossHp);
  await page.click('#wheelMission [data-source=teacher]');await page.waitForFunction(()=>__battleState().status==='victory'&&!document.getElementById('wheelSpinBtn').disabled);
  check('wheel teacher help settles one-hit damage and all treasure immediately',await page.evaluate(hp=>__battleState().lastEvent.type==='summon'&&__battleState().lastEvent.damage===hp&&document.querySelectorAll('.cbQuickTreasure .cbReward').length===16&&document.querySelector('.cbQuickEnemy').textContent.includes('HP 0/'),beforeChung));
  check('wheel damage log retains named attacks, replies and the finishing summon',await page.evaluate(()=>{const log=document.getElementById('wheelQuickLog');return log.textContent.includes('One-Punch Chung')&&log.querySelectorAll('[data-combat-id]').length===__battleState().combatLog.length&&__battleState().combatLog.length>1;}));
  await page.evaluate(()=>{const old=__battleState(),ref='classroomBattles/teacher-fixture/classes/'+ClassroomBattleStore.classKey('P5 Science');__battleDocuments[ref]=ClassroomBattleCore.reduce(old,{type:'start',id:'race-summon-target',expectedRevision:old.revision,heroes:old.heroes,bossId:old.bossId});__battleNotify(ref);__replaceSummonReply=true;window.__lateChungPlays=0;const original=ClassroomBattleAnimation.playChung;ClassroomBattleAnimation.playChung=function(...args){__lateChungPlays++;return original(...args);};});
  await page.waitForFunction(()=>!document.querySelector('#wheelMission [data-source=teacher]').disabled);await page.click('#wheelMission [data-source=teacher]');await page.waitForFunction(()=>!document.getElementById('wheelSpinBtn').disabled&&!document.querySelector('.mmRolling'));
  check('late summon acknowledgement cannot punch a newer saved encounter',await page.evaluate(()=>__lateChungPlays===0&&__battleState().encounterId==='new-enemy-before-summon-reply'&&document.querySelector('.cbQuickEnemy').textContent.includes('HP '+__battleState().bossHp+'/')));
  const savedWindow = await page.evaluate(() => ({ ...wheelWin }));
  await page.evaluate(() => { wheelWin = clampWheelWin({ ...wheelWin, w: 680, h: 690 }); applyWheelWin(); });
  await scrollWheelToTop();
  const resizedLayout = await wheelLayout();
  check('a manually narrowed wheel window stacks panels without horizontal overflow', resizedLayout.overflow.length === 0 && resizedLayout.inViewport && resizedLayout.wheel.width >= 220);
  await page.locator('#wheelMission [data-mm=turn]').click({ trial: true });
  for (const viewport of [{ width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => { wheelWin = clampWheelWin({ ...wheelWin, x: 12, y: 12, w: innerWidth - 24, h: innerHeight - 40 }); applyWheelWin(); });
    await scrollWheelToTop();
    const layout = await wheelLayout();
    check(viewport.width + 'px viewport keeps a readable wheel and all panels within the window width', layout.inViewport && layout.overflow.length === 0 && layout.wheel.width >= 220);
    if (viewport.width === 390) check('phone result panel fully contains wrapped point controls and the awarded-points tally', await page.evaluate(() => {
      const result = document.querySelector('#wheelCard .whResult').getBoundingClientRect();
      return [...document.querySelectorAll('#wheelAward button, #wheelAward input, #wheelAward .whAwardNote')].every(node => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.left >= result.left && rect.right <= result.right && rect.top >= result.top && rect.bottom <= result.bottom;
      });
    }));
    await page.screenshot({ path: path.join(output, 'quick-wheel-top-' + viewport.width + '.png'), fullPage: true });
    await page.locator('#wheelMission [data-mm=turn]').click({ trial: true });
    check(viewport.width + 'px viewport allows the mission machine control to scroll fully into view', (await wheelLayout()).turnVisible);
    await page.screenshot({ path: path.join(output, 'quick-wheel-mission-' + viewport.width + '.png'), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(saved => { wheelWin = clampWheelWin(saved); applyWheelWin(); }, savedWindow);
  check('quick wheel raises no application exceptions',errors.length===0);
  console.log('\n'+checks+' quick wheel browser checks passed. Screenshots: '+output);
} finally { await browser.close(); }
