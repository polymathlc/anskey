// Temporary roster membership through the real wheel and both battle interfaces.
// The API fixture persists by teacher/lesson and keeps canonical student heroes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const runtime = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(runtime.startsWith('file:') ? runtime : pathToFileURL(runtime).href);
const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const output = path.resolve(process.env.BATTLE_SCREENSHOTS || '../battle-validation');
fs.mkdirSync(output, { recursive: true });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route(/firebase-[a-z]+-compat\.js(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/javascript', body: '' }));
await page.addInitScript(() => {
  const chain = () => new Proxy(function () { return chain(); }, { get: (_, key) => key === 'then' ? undefined : chain(), apply: () => chain(), construct: () => chain(), set: () => true });
  window.pdfjsLib = chain(); window.firebase = chain(); window.grecaptcha = chain();
});
let checks = 0;
function check(name, condition) { assert.ok(condition, name); checks++; console.log('✓ ' + name); }

async function setup(pendingGuest = false) {
  await page.goto(pathToFileURL(path.resolve('index.html')).href);
  await page.waitForFunction(() => !!window.ClassroomBattle);
  await page.evaluate(() => {
    window.isAdmin = () => true;
    window.currentUser = { uid: 'guest-teacher', email: 'teacher@example.test' };
    window.actingStudent = null;
    window.rwStudents = [
      { id: 'home-alex', name: 'Alex', slots: ['P5 Science'], marks: 10 },
      { id: 'home-mira', name: 'Mira', slots: ['P5 Science'], marks: 20 },
      { id: 'away-alex', name: 'Alex', slots: ['P6 Science'], marks: 30 },
      { id: 'away-lena', name: 'Lena', slots: ['P6 Science'], marks: 40 },
      { id: 'away-locked', name: 'Sam', slots: ['P6 Science'], marks: 50 }
    ];
    const saved = JSON.parse(localStorage.getItem('lesson-guest-fixture') || '{}');
    const documents = saved.documents || {}, memberships = saved.memberships || {}, receipts = saved.receipts || {}, profiles = saved.profiles || {};
    const key = cls => 'classroomBattles/guest-teacher/classes/' + ClassroomBattleStore.classKey(cls);
    const home = 'P5 Science';
    rwStudents.forEach(student => {
      documents['students/' + student.id] ||= structuredClone(student);
      student.marks = documents['students/' + student.id].marks;
      profiles[student.id] ||= ClassroomBattleCore.heroFromStudent(student);
    });
    // The visiting Alex has a progressed Mage, distinct from the resident Alex.
    if (!saved.profiles) {
      const h = profiles['away-alex']; h.role = 'mage'; h.level = 4; h.xp = 300; h.gender = 'female';
      h.skillPoints = 3; h.learnedSkills = ['mage-firebolt'];
      h.stats = ClassroomBattleCore.heroFromStudent({id:'away-alex',name:'Alex',role:'mage'}).stats;
    }
    const listeners = new Map();
    function snapshot(k) { return { exists: k in documents, data: () => structuredClone(documents[k]) }; }
    function notify(k) { for (const listener of listeners.get(k) || []) listener(snapshot(k)); }
    function persist() { localStorage.setItem('lesson-guest-fixture', JSON.stringify({ documents, memberships, receipts, profiles })); }
    function reference(k) {
      return { key: k, doc: id => reference(k + '/' + id), collection: name => reference(k + '/' + name), onSnapshot(listener) {
        const set = listeners.get(k) || new Set(); listeners.set(k, set); set.add(listener);
        const timer = setTimeout(() => { if (set.has(listener)) listener(snapshot(k)); }, 5);
        return () => { clearTimeout(timer); set.delete(listener); };
      }};
    }
    window.db = { collection: name => reference(name) };
    window.__guestCalls = []; window.__awardCalls = []; window.__assistCalls = []; window.__loseGuestReply = false; window.__holdGuestGet = false; window.__releaseGuestGet = null;
    window.__battleState = (cls = home) => documents[key(cls)];
    window.__guestMemberships = memberships;
    window.__heroProfiles = profiles;
    window.__fixtureDocuments = documents;
    const roster = cls => rwStudents.filter(s => s.slots.includes(cls) || (memberships[cls] || []).includes(s.id));
    const guests = cls => (memberships[cls] || []).map(id => { const s = rwStudents.find(s => s.id === id); return { studentId: id, name: s.name, lessonSlots: s.slots }; });
    function saveState(cls, state) {
      if (!state) return;
      documents[key(cls)] = state;
      for (const h of state.heroes) if (profiles[h.studentId]) profiles[h.studentId] = structuredClone(h);
      persist(); notify(key(cls));
    }
    window.ClassroomHeroAPI.request = async (request, lifecycle = {}) => {
      const { type, classId, command, studentId, action, delta } = request;
      if (lifecycle.canSend && !lifecycle.canSend()) throw Error('The lesson or signed-in account changed.');
      if (type === 'mission' && command === 'get') return {mission:ClassroomMissionContent.empty(),state:__battleState(classId) || null};
      if (type === 'lessonGuests') {
        __guestCalls.push(structuredClone(request));
        if (command === 'get' && __holdGuestGet) await new Promise(resolve => __releaseGuestGet = resolve);
        if (command !== 'get' && !receipts[request.id]) {
          if (studentId === 'away-locked') throw Object.assign(Error('Finish Sam’s active encounter in P6 Science before adding them here.'), {code:'encounter_active'});
          memberships[classId] ||= [];
          if (command === 'add' && !memberships[classId].includes(studentId)) memberships[classId].push(studentId);
          if (command === 'remove') memberships[classId] = memberships[classId].filter(id => id !== studentId);
          const old = __battleState(classId);
          if (old) {
            const ids = new Set(roster(classId).map(s => s.id));
            const state = {...old, revision:old.revision + 1, heroes:old.heroes.filter(h => ids.has(h.studentId))};
            for (const s of roster(classId)) if (!state.heroes.some(h => h.studentId === s.id)) state.heroes.push(structuredClone(profiles[s.id]));
            saveState(classId, state);
          }
          receipts[request.id] = {command,studentId,classId}; persist();
          if (__loseGuestReply) { __loseGuestReply = false; throw Error('Membership saved, but response was lost.'); }
        }
        return { guests: guests(classId), state:__battleState(classId) || null };
      }
      if (type === 'assist') {
        __assistCalls.push(structuredClone(request));
        const old=__battleState(classId),h=old?.heroes.find(h=>h.studentId===studentId) || profiles[studentId];
        if(!roster(classId).some(s=>s.id===studentId) || studentId===request.helpedStudentId)throw Error('Choose another student in this lesson.');
        const hero=ClassroomBattleCore.grantAssistXp(h,6),assist={id:action.id,studentId,helpedStudentId:request.helpedStudentId,xp:6,spinId:action.spinId};
        const state=old?{...old,revision:old.revision+1,lastAssist:assist,heroes:old.heroes.map(h=>h.studentId===studentId?hero:h)}:null;
        saveState(classId,state);return {hero,assist,state};
      }
      if (type !== 'wheelAward' && type !== 'battle') throw Error('Unexpected API request: ' + type);
      if (type === 'wheelAward') __awardCalls.push(structuredClone(request));
      if (receipts[action.id]) return {state:__battleState(classId),award:receipts[action.id].award};
      const old = __battleState(classId) || null;
      const heroes = roster(classId).map(s => structuredClone(old?.heroes.find(h => h.studentId === s.id) || profiles[s.id]));
      const trusted = {...action,heroes};
      if (type === 'wheelAward') {
        if (!roster(classId).some(s => s.id === studentId)) throw Object.assign(Error('This student is not in the lesson.'),{code:'roster_changed'});
        Object.assign(trusted,{type:'auto',points:delta});
      }
      // Keep the encounter alive: these checks exercise attendance, not random victory loot.
      if (!old && (trusted.type === 'auto' || trusted.type === 'start')) trusted.bossId='dragon';
      const seeded = old || ((trusted.type === 'auto' || trusted.type === 'start') ? {revision:0,heroes,heroArchive:{}} : null);
      if (!old && seeded) trusted.expectedRevision=0;
      const next = ClassroomBattleCore.reduce(seeded, trusted);
      const state = next ? {...next,teacherId:currentUser.uid,classId} : null;
      let award;
      if (type === 'wheelAward') {
        documents['students/' + studentId].marks += delta;
        award = {id:action.id,studentId,delta,marks:documents['students/' + studentId].marks};
      }
      receipts[action.id] = {award}; saveState(classId,state); persist();
      return {state,award};
    };
    localStorage.setItem('polymath.wheelClass',home);
    window.wheelRandom = () => 0;
    applyRewardVisibility();
  });
  await page.click('#wheelBtn');
  await page.waitForFunction(pending => pending ? !document.getElementById('wheelGuestRetry').hidden && !document.getElementById('wheelGuestRetry').disabled : !window.wheelGuestsBusy?.() && !document.getElementById('wheelSpinBtn').disabled,pendingGuest);
}
async function panel() {
  if (!await page.locator('#wheelGuestPanel').isVisible()) await page.click('#wheelGuestToggle');
}
async function add(id) {
  await panel();
  await page.selectOption('#wheelGuestSlot','P6 Science');
  await page.selectOption('#wheelGuestStudent',id);
  await page.click('#wheelGuestAdd');
  await page.waitForFunction(() => !/Saving|Loading/.test(document.getElementById('wheelGuestStatus').textContent));
}
async function selectStudent(id) {
  await page.evaluate(id => {
    const remaining = wheelState.names.filter(entry => !entry.done);
    const wanted = remaining.findIndex(entry => entry.id === id);
    if (wanted < 0) throw Error('Student not available on the wheel: ' + id);
    wheelRandom = () => (wanted + 0.1) / remaining.length;
  },id);
  await page.click('#wheelSpinBtn');
  await page.waitForFunction(() => !wheelSpinning);
}

try {
  await setup();
  await panel();
  check('temporary student controls are on the wheel and labelled by lesson slot', await page.locator('#wheelGuestSlot').isVisible() && await page.locator('#wheelGuestStudent').isVisible() && /lesson slot/i.test(await page.locator('#wheelGuestPanel').innerText()));
  check('resident students start on the wheel with no temporary visitors',await page.evaluate(() => wheelState.names.length === 2 && wheelLessonStudents('P5 Science').length === 2));
  await page.selectOption('#wheelGuestSlot','P6 Science');
  check('source slot lists visiting students without exposing the resident duplicate name as the same ID',await page.evaluate(() => [...document.getElementById('wheelGuestStudent').options].some(o => o.value === 'away-alex') && ![...document.getElementById('wheelGuestStudent').options].some(o => o.value === 'home-alex')));
  await add('away-alex');
  check('adding a namesake keeps both distinct canonical wheel entries',await page.evaluate(() => wheelState.names.filter(e => e.n === 'Alex').length === 2 && wheelState.names.some(e => e.id === 'home-alex') && wheelState.names.some(e => e.id === 'away-alex')));
  check('visitor is marked temporary without changing their permanent lesson slot',await page.evaluate(() => rwStudents.find(s => s.id === 'away-alex').slots.join() === 'P6 Science' && wheelStudentInLesson(rwStudents.find(s => s.id === 'away-alex'),'P5 Science')) && await page.locator('#wheelGuestList [data-guest-remove="away-alex"]').count() === 1);
  check('temporary guest appears only once in the combined roster',await page.evaluate(() => wheelLessonStudents('P5 Science').filter(s => s.id === 'away-alex').length === 1));
  await selectStudent('away-alex');
  check('the wheel previews the visitor’s canonical character ID',await page.locator('.cbQuickHero').getAttribute('data-cba-hero-id') === 'student:away-alex');
  await page.evaluate(() => wheelGive(2));
  await page.waitForFunction(() => !document.getElementById('wheelQuickStatus').textContent.includes('Saving answer'));
  check('a guest point award credits the visiting student and resolves their canonical hero attack',await page.evaluate(() => __awardCalls.at(-1).studentId === 'away-alex' && __awardCalls.at(-1).action.heroId === 'student:away-alex' && rwStudents.find(s => s.id === 'away-alex').marks === 32 && rwStudents.find(s => s.id === 'home-alex').marks === 10 && __battleState().lastEvent.heroId === 'student:away-alex'));
  check('the visitor keeps their existing hero class, gender and experience',await page.evaluate(() => {const h=__battleState().heroes.find(h => h.studentId === 'away-alex');return h.role === 'mage' && h.gender === 'female' && h.xp > 300 && __battleState().heroes.filter(h => h.name === 'Alex').length === 2;}));
  const beforeReload = await page.evaluate(() => JSON.stringify({state:__battleState(),slots:rwStudents.find(s => s.id === 'away-alex').slots,marks:rwStudents.find(s => s.id === 'away-alex').marks}));
  await setup();
  check('reopening restores temporary membership, saved battle and points without another award',await page.evaluate(before => wheelState.names.some(e => e.id === 'away-alex') && __awardCalls.length === 0 && JSON.stringify({state:__battleState(),slots:rwStudents.find(s => s.id === 'away-alex').slots,marks:rwStudents.find(s => s.id === 'away-alex').marks}) === before,beforeReload));
  await page.click('#wheelBattleBtn');
  await page.waitForFunction(() => !document.getElementById('cbStart').disabled);
  check('manual battle shows both namesakes as separate heroes',await page.locator('#cbHeroes [data-inspect="student:away-alex"]').count() === 1 && await page.locator('#cbHeroes [data-inspect="student:home-alex"]').count() === 1);
  await panel();
  check('the same temporary guest controls remain accessible inside manual battle',await page.locator('#cbWheelMount #wheelGuestPanel').isVisible());
  await selectStudent('home-mira');
  await page.waitForFunction(() => !!__battleState().pending && !document.getElementById('cbSkip').disabled);
  check('an unresolved manual answer disables guest add and remove controls',await page.locator('#wheelGuestAdd').isDisabled() && await page.locator('[data-guest-remove="away-alex"]').isDisabled());
  await page.click('#cbSkip');
  await page.waitForFunction(() => !__battleState().pending && !document.querySelector('[data-guest-remove="away-alex"]').disabled);
  await page.screenshot({path:path.join(output,'lesson-guests-manual.png'),fullPage:true});
  const beforeRemove = await page.evaluate(() => ({hp:__battleState().bossHp,xp:__heroProfiles['away-alex'].xp,marks:rwStudents.find(s => s.id === 'away-alex').marks}));
  await page.click('[data-guest-remove="away-alex"]');
  await page.waitForFunction(() => !window.wheelGuestsBusy?.());
  check('removing a visitor removes their wheel entry and active party slot',await page.evaluate(() => !wheelState.names.some(e => e.id === 'away-alex') && !__battleState().heroes.some(h => h.studentId === 'away-alex')) && await page.locator('#cbHeroes [data-inspect="student:away-alex"]').count() === 0);
  check('removal retains earned XP, marks and the permanent slot without changing enemy health',await page.evaluate(before => __heroProfiles['away-alex'].xp === before.xp && rwStudents.find(s => s.id === 'away-alex').marks === before.marks && rwStudents.find(s => s.id === 'away-alex').slots.join() === 'P6 Science' && __battleState().bossHp === before.hp,beforeRemove));
  await page.click('#cbClose');
  await page.evaluate(() => openWheel());
  await page.waitForFunction(() => !document.getElementById('wheelSpinBtn').disabled);
  await add('away-locked');
  check('an active source encounter reports a clear error and does not create a guest',await page.evaluate(() => !wheelState.names.some(e => e.id === 'away-locked')) && /active encounter|finish/i.test(await page.locator('#wheelGuestStatus').innerText()));
  await page.evaluate(() => __loseGuestReply = true);
  await add('away-lena');
  check('a lost committed membership reply offers a retry rather than silently duplicating a student',await page.locator('#wheelGuestRetry').isVisible() && await page.evaluate(() => __guestMemberships['P5 Science'].filter(id => id === 'away-lena').length === 1));
  const retryId = await page.evaluate(() => __guestCalls.filter(c => c.command === 'add').at(-1).id);
  await page.click('#wheelGuestRetry');
  await page.waitForFunction(() => !window.wheelGuestsBusy?.());
  check('retry reuses its receipt and confirms one canonical visitor',await page.evaluate(id => __guestCalls.filter(c => c.command === 'add').at(-1).id === id && wheelState.names.filter(e => e.id === 'away-lena').length === 1 && __battleState().heroes.filter(h => h.studentId === 'away-lena').length === 1,retryId));
  await page.setViewportSize({width:390,height:844});
  await panel();
  await page.locator('#wheelGuestPanel').scrollIntoViewIfNeeded();
  check('mobile temporary controls fit the wheel without horizontal overflow',await page.evaluate(() => {const p=document.getElementById('wheelGuestPanel'),r=p.getBoundingClientRect();return r.left >= -1 && r.right <= innerWidth + 1 && p.scrollWidth <= p.clientWidth + 2 && [...p.querySelectorAll('select,button')].every(n=>n.getBoundingClientRect().width<=p.clientWidth+2);}));
  await page.screenshot({path:path.join(output,'lesson-guests-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await setup();
  check('removed guests stay removed while remaining guests survive a reload',await page.evaluate(() => !wheelState.names.some(e => e.id === 'away-alex') && wheelState.names.some(e => e.id === 'away-lena') && rwStudents.find(s=>s.id==='away-lena').slots.join()==='P6 Science'));
  await selectStudent('home-alex');
  await page.click('[data-assist-toggle]');
  check('a visiting student is available as an assist helper',await page.locator('#wheelAssistStudent option[value="away-lena"]').count()===1);
  const assistBefore=await page.evaluate(()=>({hp:__battleState().bossHp,xp:__heroProfiles['away-lena'].xp,turns:__battleState().bossTurns}));
  await page.selectOption('#wheelAssistStudent','away-lena');
  await page.click('[data-assist-save]');
  await page.waitForFunction(()=>__assistCalls.length===1 && !document.getElementById('wheelSpinBtn').disabled);
  check('guest assists award canonical XP without another attack or enemy turn',await page.evaluate(before=>__assistCalls[0].studentId==='away-lena' && __heroProfiles['away-lena'].xp===before.xp+6 && __battleState().bossHp===before.hp && __battleState().bossTurns===before.turns,assistBefore));
  await page.evaluate(() => {__holdGuestGet=true;wheelSetClass('P6 Science');});
  await page.waitForFunction(() => typeof __releaseGuestGet === 'function');
  await page.evaluate(() => {__holdGuestGet=false;wheelSetClass('P5 Science');});
  await page.waitForFunction(() => !wheelGuestsBusy());
  await page.evaluate(async () => {__releaseGuestGet();await new Promise(resolve=>setTimeout(resolve,50));});
  check('a delayed previous-slot guest response cannot replace the current lesson roster',await page.evaluate(() => wheelClass==='P5 Science' && wheelLessonStudents('P5 Science').length===3 && wheelState.names.some(e=>e.id==='away-lena') && !wheelState.names.some(e=>e.id==='away-alex')));
  await page.evaluate(() => __loseGuestReply=true);
  await add('away-alex');
  const pendingGuestId=await page.evaluate(()=>__guestCalls.filter(c=>c.command==='add').at(-1).id);
  await page.evaluate(async()=>{const s=__battleState();await ClassroomHeroAPI.request({type:'battle',classId:'P5 Science',action:{type:'select',id:'other-tab-select-guest',turnId:'other-tab-question-guest',encounterId:s.encounterId,expectedRevision:s.revision,heroId:'student:home-mira'}});});
  const pendingTurn=await page.evaluate(()=>JSON.stringify(__battleState().pending));
  await setup(true);
  check('reload offers guest receipt confirmation even while another tab has an unresolved manual answer',await page.locator('#wheelGuestRetry').isEnabled() && await page.locator('#wheelSpinBtn').isDisabled() && await page.evaluate(pending=>JSON.stringify(__battleState().pending)===pending,pendingTurn));
  await page.click('#wheelGuestRetry');
  await page.waitForFunction(()=>!wheelGuestsBusy());
  check('confirming the saved guest receipt preserves the pending turn and avoids duplicate membership',await page.evaluate(({id,turn})=>__guestCalls.find(c=>c.command==='add')?.id===id && wheelState.names.filter(e=>e.id==='away-alex').length===1 && __battleState().heroes.filter(h=>h.studentId==='away-alex').length===1 && JSON.stringify(__battleState().pending)===turn,{id:pendingGuestId,turn:pendingTurn}));
  await page.click('#wheelBattleBtn');
  await page.waitForFunction(()=>!document.getElementById('cbSkip').disabled);
  await page.click('#cbSkip');
  await page.waitForFunction(()=>!__battleState().pending && !document.getElementById('wheelSpinBtn').disabled);
  check('the teacher can resolve the waiting manual answer after confirming the guest change',await page.evaluate(()=>__battleState().lastEvent.outcome==='skip' && !__battleState().pending));
  check('temporary guest flows run without uncaught browser exceptions',errors.length === 0);
  console.log(`Passed ${checks} temporary lesson guest browser checks.`);
} catch (error) {
  console.error(await page.evaluate(() => ({guestStatus:document.getElementById('wheelGuestStatus')?.textContent,quickStatus:document.getElementById('wheelQuickStatus')?.textContent,selected:window.wheelState?.names[window.wheelWinnerIdx],hero:window.__battleState?.()?.heroes.find(h=>h.studentId==='away-alex'),errors:window.__guestCalls})));
  throw error;
} finally {
  await browser.close();
}
