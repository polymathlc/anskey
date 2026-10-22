// Real wheel quest UI with persistent local API fixtures; server authority is tested separately.
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

async function setup(pendingGuest = false, pendingQuest = false) {
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
    const documents = saved.documents || {}, memberships = saved.memberships || {}, receipts = saved.receipts || {}, profiles = saved.profiles || {}, attendance=saved.attendance || {};
    window.__attendanceDate=new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10);
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
    function persist() { localStorage.setItem('lesson-guest-fixture', JSON.stringify({ documents, memberships, receipts, profiles,attendance })); }
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
    const absent=cls=>attendance[cls]?.date===__attendanceDate?attendance[cls].ids:[];
    const roster = cls => rwStudents.filter(s => !absent(cls).includes(s.id) && (s.slots.includes(cls) || (memberships[cls] || []).includes(s.id)));
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
          if(['absent','restore'].includes(command)){attendance[classId]={date:__attendanceDate,ids:[...absent(classId)]};attendance[classId].ids=command==='absent'?[...new Set([...attendance[classId].ids,studentId])]:attendance[classId].ids.filter(id=>id!==studentId);}
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
        return { guests: guests(classId),absent:absent(classId).map(id=>{const s=rwStudents.find(s=>s.id===id);return {studentId:id,name:s.name,lessonSlots:s.slots};}),date:__attendanceDate,returned:attendance[classId]?.date!==__attendanceDate?(attendance[classId]?.ids || []):[], state:__battleState(classId) || null };
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
      const trusted = {formation:'raid',...action,heroes};
      if (type === 'wheelAward') {
        if (!roster(classId).some(s => s.id === studentId)) throw Object.assign(Error('This student is not in the lesson.'),{code:'roster_changed'});
        Object.assign(trusted,{type:'auto',points:delta});
      }
      // Keep the encounter alive: these checks exercise attendance rather
      // than enemy selection or treasure. Production ignores supplied bosses.
      let seeded = old || ((trusted.type === 'auto' || trusted.type === 'start') ? {revision:0,heroes,heroArchive:{}} : null);
      if (!old && seeded) trusted.expectedRevision=0;
      if (!old && trusted.type === 'auto') {
        seeded=ClassroomBattleCore.reduce(seeded,{type:'start',formation:'raid',id:trusted.id,expectedRevision:0,heroes,spinId:trusted.spinId});
        seeded.bossHp=seeded.bossMaxHp=100000;
        trusted.encounterId=seeded.encounterId;trusted.expectedRevision=seeded.revision;
      }
      const next = ClassroomBattleCore.reduce(seeded, trusted);
      const state = next ? {...next,teacherId:currentUser.uid,classId} : null;
      if (!old && trusted.type === 'start' && !state.enemies) state.bossHp=state.bossMaxHp=100000;
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
  if(pendingQuest){await page.waitForFunction(()=>!!document.querySelector('#wheelQuest [data-quest-retry]')&&!document.querySelector('#wheelQuest [data-quest-retry]').disabled);return;}
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

async function request(type,extra={}){
 await page.evaluate(async({type,extra})=>{const s=__battleState();await ClassroomHeroAPI.request({type:'battle',classId:'P5 Science',action:{type,id:crypto.randomUUID(),encounterId:s.encounterId,expectedRevision:s.revision,...extra}});},{type,extra});
}
async function answerHero(id,outcome='correct'){
 await request('select',{heroId:id});await page.waitForFunction(()=>!document.getElementById('cbCorrect').disabled);
 await page.click(outcome==='correct'?'#cbCorrect':'#cbIncorrect');
 await page.waitForFunction(()=>!__battleState().pending && !document.getElementById('cbStart').disabled);
}
try {
 await setup();await add('away-alex');await page.click('#wheelBattleBtn');await page.waitForFunction(()=>!document.getElementById('cbStart').disabled);
 await page.selectOption('#cbFormation','raid');await page.click('#cbStart');await page.waitForFunction(()=>!!__battleState()?.journey&&!document.getElementById('cbStart').disabled);
 check('new manual encounter displays its saved five-checkpoint chapter',await page.locator('#cbQuest .qpMap li').count()===5 && /Chapter 1/.test(await page.locator('#cbQuest').innerText()));
 await page.click('#cbQuest [data-quest-expand]');
 check('boss intent identifies the actual upcoming attack',await page.locator('#cbQuest .qpIntent').isVisible());
 await page.click('#cbQuest [data-quest-command="prepare"][data-choice-id="shield"]');await page.waitForFunction(()=>__battleState().preparation?.choice==='shield'&&!document.querySelector('#cbQuest .qpRetry'));
 check('a shield preparation is saved once and locks the other preparations',await page.locator('#cbQuest [data-quest-command="prepare"]:disabled').count()===3);
 await answerHero('student:home-alex');check('the first correct answer activates the preparation on the real party',await page.evaluate(()=>__battleState().heroes.every(h=>h.shield>0)));
 await answerHero('student:home-mira');await answerHero('student:away-alex','incorrect');
 check('a wrong answer pauses the combo at its existing count',await page.evaluate(()=>__battleState().combo.count===2&&__battleState().combo.paused));
 await page.click('#cbQuest [data-quest-command="recover"]');await page.waitForFunction(()=>!__battleState().combo.paused);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>{window.__comboEffects=[];new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.nodeType===1&&n.classList.contains('cbaFx-lightning'))__comboEffects.push(n.className);}).observe(document.getElementById('cbArena'),{childList:true,subtree:true});});
 await answerHero('student:away-alex');await page.waitForFunction(()=>__comboEffects.length>0);check('the combo launches the existing lightning artwork as a real animated attack',await page.evaluate(()=>__comboEffects.length>0));
 await page.emulateMedia({reducedMotion:'reduce'});
 check('the third alternating answer visibly unleashes Together strike',await page.evaluate(()=>__battleState().lastEvent.comboBurst?.level===3)&&/Together strike/.test(await page.locator('#cbQuest .qpBurst').innerText()));
 await answerHero('student:home-alex');await answerHero('student:home-mira');check('the fifth answer triggers the class ultimate and resets the saved meter',await page.evaluate(()=>__battleState().lastEvent.comboBurst?.level===5&&__battleState().combo.count===0));
 await request('summon',{source:'teacher'});await page.waitForFunction(()=>__battleState().status==='victory'&&!!document.querySelector('#cbQuest [data-quest-command="treasure"]'));
 check('victory opens three personal reward choices and one of two class routes',await page.locator('#cbQuest .qpRewards article').count()===3&&await page.locator('#cbQuest .qpRoute').count()===2);
 await page.click('#cbQuest [data-quest-command="treasure"][data-choice-id="materials"]');await page.waitForFunction(()=>__battleState().heroes[0].upgradeShards===3&&!document.querySelector('#cbQuest .qpRetry'));
 check('materials choice consumes the saved chest and credits three star shards',await page.evaluate(()=>__battleState().heroes[0].treasureInbox.length===0&&__battleState().heroes[0].upgradeShards===3));
 const route=await page.locator('#cbQuest [data-quest-command="vote"]').first().getAttribute('data-route-id');
 await page.locator('#cbQuest [data-quest-command="vote"]').first().click();await page.waitForFunction(()=>Object.keys(__battleState().journey.votes).length===1&&!document.querySelector('#cbQuest .qpRetry'));
 check('student votes are counted and labelled by saved identity',/1 vote/.test(await page.locator('#cbQuest .qpChoices').first().innerText()));
 await page.locator('#cbQuest [data-quest-command="route"]').first().click();await page.waitForFunction(()=>!!__battleState().journey.route&&!document.querySelector('#cbQuest .qpRetry'));
 check('the majority route is saved',await page.evaluate(route=>__battleState().journey.route===route,route));
 const surprise=await page.locator('#cbQuest [data-quest-command="event"]').count();check('a surprise event offers two meaningful class choices',surprise===2);
 await page.locator('#cbQuest [data-quest-command="event"]').first().click();await page.waitForFunction(()=>!!__battleState().journey.event.choice&&!document.querySelector('#cbQuest .qpRetry'));
 const saved=await page.evaluate(()=>JSON.stringify(__battleState().journey));
 await page.setViewportSize({width:390,height:844});await page.locator('#cbQuest').scrollIntoViewIfNeeded();
 check('phone quest controls fit their panel',await page.evaluate(()=>{const p=document.getElementById('cbQuest');return p.scrollWidth<=p.clientWidth+2;}));
 await page.locator('#cbQuest').screenshot({path:path.join(output,'quest-choices-mobile.png')});
 await setup();check('reload preserves route, chapter, event gift and canonical personal treasure',await page.evaluate(saved=>JSON.stringify(__battleState().journey)===saved&&__battleState().heroes[0].upgradeShards===3,saved));
 check('the ordinary wheel also mounts the same saved quest controls',await page.locator('#wheelQuest .qpPanel').isVisible());
 await page.click('#wheelQuest [data-quest-expand]');await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>{const w=document.getElementById('wheelModal');w.style.width='1000px';w.style.height='900px';w.style.left='20px';w.style.top='20px';});await page.locator('#wheelQuest').scrollIntoViewIfNeeded();await page.locator('#wheelQuest').screenshot({path:path.join(output,'quest-choices-desktop.png')});
 // Simulate a server commit whose response is lost. The receipt must be
 // explicitly retried, with the same ID, after a full controller reload.
 await page.evaluate(()=>{const original=ClassroomHeroAPI.request;window.__questIds=[];let lose=true;ClassroomHeroAPI.request=async(r,l)=>{if(r.action?.type==='quest'){__questIds.push(r.action.id);const result=await original(r,l);if(lose){lose=false;throw Error('Choice saved, response lost');}return result;}return original(r,l);};});
 await page.selectOption('#wheelQuest [data-quest-student]','student:home-mira');
 await page.click('#wheelQuest [data-quest-command="treasure"][data-choice-id="rune"]');await page.waitForFunction(()=>!!document.querySelector('#wheelQuest [data-quest-retry]')&&!document.querySelector('#wheelQuest [data-quest-retry]').disabled);
 const before=await page.evaluate(()=>({hero:JSON.stringify(__battleState().heroes.find(h=>h.studentId==='home-mira')),id:__questIds[0]}));
 check('an uncertain treasure choice blocks another wheel spin',await page.locator('#wheelSpinBtn').isDisabled());
 await setup(false,true);await page.waitForFunction(()=>!!document.querySelector('#wheelQuest [data-quest-retry]')&&!document.querySelector('#wheelQuest [data-quest-retry]').disabled);
 await page.click('#wheelQuest [data-quest-retry]');await page.waitForFunction(()=>!document.querySelector('#wheelQuest [data-quest-retry]'));
 check('reloading and confirming an uncertain choice cannot duplicate its reward',await page.evaluate(before=>JSON.stringify(__battleState().heroes.find(h=>h.studentId==='home-mira'))===before.hero,before));
 check('quest flows have no uncaught browser exceptions',errors.length===0);
 console.log(`Passed ${checks} quest browser checks.`);
}finally{await browser.close();}
