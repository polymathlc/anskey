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
  await page.click('#wheelBtn'); await page.evaluate(()=>setWheelMin(false)); // full-wheel coverage; the compact default (v1.189.0) has its own checks
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
  await setup();await add('away-alex');
  await page.click('#wheelBattleBtn');await page.waitForFunction(()=>!document.getElementById('cbStart').disabled);
  await page.selectOption('#cbFormation','3v3');await page.click('#cbStart');
  await page.waitForFunction(()=>__battleState()?.teamSize===3 && !document.getElementById('cbStart').disabled);
  check('manual 3v3 renders three individual enemies with HP and three active student highlights',await page.locator('#cbBossArt [data-enemy-id]').count()===3 && await page.locator('#cbHeroes .cbTeamActive').count()===3);
  await page.evaluate(async()=>{let s=__battleState();for(const values of [{command:'class',role:'warrior'},{command:'learn',skillId:'warrior-cleave'}]){await ClassroomHeroAPI.request({type:'battle',classId:'P5 Science',action:{type:'sync',id:crypto.randomUUID(),encounterId:s.encounterId,expectedRevision:s.revision,heroId:'student:home-alex',...values}});s=__battleState();}});
  await selectStudent('home-alex');await page.waitForFunction(()=>!!__battleState().pending && !document.getElementById('cbSkills').disabled);
  await page.click('#cbSkills');await page.click('[data-command="warrior-cleave"]');
  check('AoE skills display their scope and hide the single enemy selector',/AoE damage/.test(await page.locator('[data-command="warrior-cleave"]').innerText()) && !await page.locator('#cbEnemyTargetWrap').isVisible());
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.click('#cbCorrect');
  await page.waitForFunction(()=>document.querySelectorAll('#cbBossArt .cbaEffect').length>=3);
  check('group attack effects animate on individual enemy cards',await page.locator('#cbBossArt [data-enemy-id]:has(.cbaEffect)').count()===3);
  await page.waitForFunction(()=>!document.querySelector('#cbArena.cbaPlaying'));
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>!__battleState().pending && !document.getElementById('cbStart').disabled);
  check('one correct answer saves three student actions and hits every enemy with Cleave',await page.evaluate(()=>__battleState().lastEvent.actions.length===3 && __battleState().lastEvent.actions[0].enemyTargets.length===3));
  check('all grouped enemies have visible artwork dimensions',await page.evaluate(()=>[...document.querySelectorAll('#cbBossArt .cbEnemySprite,#cbBossArt img')].every(n=>n.getBoundingClientRect().height>=40)));
  await page.screenshot({path:path.join(output,'team-battle-3v3-desktop.png'),fullPage:true});
  await page.click('#cbAttack');await page.click('#cbStop');await page.waitForFunction(()=>__battleState().lastEvent.type==='boss');
  check('teacher meter resolves attacks from all living enemies together',await page.evaluate(()=>__battleState().lastEvent.actions.length===__battleState().enemies.filter(e=>e.hp>0).length));
  const hp=await page.evaluate(()=>JSON.stringify(__battleState().enemies));await setup();
  check('saved 3v3 reopens in the quick wheel with all student and enemy sprites',await page.locator('#wheelQuickDuel [data-enemy-id]').count()===3 && await page.locator('#wheelQuickDuel .cbActiveTeam [data-cba-hero-id]').count()===3 && await page.evaluate(hp=>JSON.stringify(__battleState().enemies)===hp,hp));
  await page.setViewportSize({width:390,height:844});
  check('phone enemy sprites remain visible',await page.evaluate(()=>[...document.querySelectorAll('#wheelQuickDuel .cbEnemySprite,#wheelQuickDuel .cbEnemyMember img')].every(n=>n.getBoundingClientRect().height>=40)));
  // The wheel re-lays itself out after the resize; on a slow runner the first
  // frame can still be the desktop width, so give it a moment to settle.
  const fitsPhone=()=>{const n=document.getElementById('wheelQuickDuel');return n.scrollWidth<=n.clientWidth+2;};
  await page.waitForFunction(fitsPhone,null,{timeout:4000}).catch(()=>{});
  check('team preview fits the phone wheel',await page.evaluate(fitsPhone));
  await page.locator('#wheelQuickDuel').screenshot({path:path.join(output,'team-battle-3v3-mobile.png')});
  await page.evaluate(()=>setWheelMin(true));
  await page.locator('#wheelModal').screenshot({path:path.join(output,'team-battle-3v3-compact.png')});
  check('minimised wheel preserves the 3v3 enemy team',await page.locator('#wheelQuickDuel [data-enemy-id]').count()===3);
  // The small window must hold both teams inside its battle box: nothing over the title bar,
  // the reel or the points controls, and every picture still large enough to recognise.
  const compactFits=()=>page.evaluate(()=>{
    const box=document.getElementById('cwBattle').getBoundingClientRect(),head=document.getElementById('wheelHead').getBoundingClientRect();
    const cards=[...document.querySelectorAll('#cwBattle .cbActiveTeam>.cbQuickHero,#cwBattle .cbEnemyMember')].map(n=>n.getBoundingClientRect());
    const art=[...document.querySelectorAll('#cwBattle .cbActiveTeam .cbaHero,#cwBattle .cbEnemyMember>:first-child')].map(n=>n.getBoundingClientRect());
    const award=document.getElementById('cwAwards').getBoundingClientRect();
    const inside=r=>r.top>=box.top-1&&r.bottom<=box.bottom+1&&r.left>=box.left-1&&r.right<=box.right+1;
    return {cards:cards.length,inside:cards.every(inside)&&art.every(inside),belowHead:cards.every(r=>r.top>=head.bottom),clearOfAward:!award.height||cards.every(r=>r.bottom<=award.top+1),art:Math.min(...art.map(r=>Math.min(r.width,r.height))),overflow:document.getElementById('cwBattle').scrollHeight<=document.getElementById('cwBattle').clientHeight+1};
  });
  for(const width of [390,1440]){
    await page.setViewportSize({width,height:width===390?844:1000});await page.waitForTimeout(100);
    let fit=await compactFits();
    check(width+'px minimised 3v3 keeps all six cards inside the battle box, under the title bar',fit.cards===6&&fit.inside&&fit.belowHead&&fit.overflow&&fit.art>=24);
    if(width===1440){
      await page.click('#cwSpin');await page.waitForFunction(()=>!wheelSpinning&&!document.getElementById('cwGive').disabled);
      await page.click('#cwGive');await page.waitForFunction(()=>__awardCalls.length>0&&!document.getElementById('cwGive').disabled);
      fit=await compactFits();
      check('minimised 3v3 with the points controls showing keeps every card above them, pictures beside names',fit.cards===6&&fit.inside&&fit.clearOfAward&&fit.overflow&&fit.art>=24);
      await page.locator('#wheelModal').screenshot({path:path.join(output,'team-battle-3v3-compact-award.png')});
    }
  }
  // v1.189.0 — the compact window resizes freely and everything in it scales together.
  // Sweep it from a small card to most of the screen, wide and tall: every hero and enemy
  // must stay inside the battle box, the names' type must follow --cw-k, and a bigger
  // window must never give smaller pictures.
  await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(80);
  const sizeTo=async box=>{await page.evaluate(b=>{wheelCompactWin=clampWheelWin({x:8,y:8,w:b.w,h:b.h});applyWheelWin();},box);await page.waitForTimeout(80);};
  const measure=()=>page.evaluate(()=>{
    const card=document.getElementById('wheelCard'),box=document.getElementById('cwBattle').getBoundingClientRect(),c=card.getBoundingClientRect();
    const k=Number(card.style.getPropertyValue('--cw-k'));
    const cards=[...document.querySelectorAll('#cwBattle .cbActiveTeam>.cbQuickHero,#cwBattle .cbEnemyMember')].map(n=>n.getBoundingClientRect());
    const art=[...document.querySelectorAll('#cwBattle .cbActiveTeam .cbaHero,#cwBattle .cbEnemyMember>:first-child')].map(n=>n.getBoundingClientRect());
    const name=document.querySelector('#cwBattle .cbEnemyMember>strong'),face=document.querySelector('.cwFace');
    const inside=r=>r.width>0&&r.height>0&&r.top>=box.top-1&&r.bottom<=box.bottom+1&&r.left>=box.left-1&&r.right<=box.right+1;
    const others=['cwSpin','cwClass','wheelGrip'].map(id=>document.getElementById(id).getBoundingClientRect());
    return {k,layout:card.dataset.cwLayout,w:c.width,h:c.height,cards:cards.length,inside:cards.every(inside)&&art.every(inside),
      art:Math.min(...art.map(r=>Math.min(r.width,r.height))),artMean:art.reduce((a,r)=>a+r.height,0)/art.length,
      nameFont:parseFloat(getComputedStyle(name).fontSize),faceFont:parseFloat(getComputedStyle(face).fontSize),
      inCard:others.every(r=>r.width>0&&r.left>=c.left-1&&r.right<=c.right+1&&r.top>=c.top-1&&r.bottom<=c.bottom+1),
      overflow:document.getElementById('cwBattle').scrollHeight<=document.getElementById('cwBattle').clientHeight+1};
  });
  let previous=null;
  for(const box of [{w:240,h:170},{w:420,h:200},{w:620,h:280},{w:900,h:400},{w:1240,h:560},{w:1420,h:980}]){
    await sizeTo(box);const m=await measure();
    check('compact '+box.w+'×'+box.h+' keeps all six fighters inside the battle box and its controls inside the window (k '+m.k+')',m.cards===6&&m.inside&&m.overflow&&m.inCard);
    check('compact '+box.w+'×'+box.h+' scales the type with the window',Math.abs(m.nameFont-10*m.k)<0.6&&Math.abs(m.faceFont-15*m.k)<0.6);
    if(previous)check('a bigger compact window ('+box.w+'×'+box.h+') never shows smaller characters or type',m.k>=previous.k&&m.artMean>=previous.artMean-1&&m.nameFont>=previous.nameFont);
    previous=m;
    if(box.w===1420)await page.locator('#wheelModal').screenshot({path:path.join(output,'team-battle-3v3-compact-large.png')});
    if(box.w===240)await page.locator('#wheelModal').screenshot({path:path.join(output,'team-battle-3v3-compact-small.png')});
  }
  check('the largest compact window draws the characters several times their base size',previous.k>=2.2&&previous.art>=60);
  for(const box of [{w:340,h:480},{w:420,h:900}]){
    await sizeTo(box);const m=await measure();
    check('a tall '+box.w+'×'+box.h+' window stacks the reel above the battle and keeps every fighter inside it',m.layout==='tall'&&m.cards===6&&m.inside&&m.overflow&&m.inCard&&m.art>=30);
    const order=await page.evaluate(()=>document.querySelector('.cwPicker').getBoundingClientRect().bottom<=document.getElementById('cwBattle').getBoundingClientRect().top+1);
    check('the tall layout puts the reel above the battle',order);
    if(box.h===900)await page.locator('#wheelModal').screenshot({path:path.join(output,'team-battle-3v3-compact-tall.png')});
  }
  // A real drag of the corner, not just a set box: the grip is on screen in the minimised window.
  await sizeTo({w:620,h:280});
  const grip=await page.locator('#wheelGrip').boundingBox();
  check('the resize corner is visible and on top in the minimised window',!!grip&&await page.evaluate(()=>{const g=document.getElementById('wheelGrip').getBoundingClientRect();return document.elementFromPoint(g.x+g.width/2,g.y+g.height/2)===document.getElementById('wheelGrip');}));
  await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();
  await page.mouse.move(grip.x+grip.width/2+500,grip.y+grip.height/2+260,{steps:8});await page.mouse.up();await page.waitForTimeout(80);
  const dragged=await measure();
  check('dragging the corner grows the compact window and everything in it',dragged.w>=1100&&dragged.h>=520&&dragged.k>1.7&&dragged.inside&&Math.abs(dragged.nameFont-10*dragged.k)<0.6);
  check('the dragged size is remembered for the compact window only',await page.evaluate(()=>{const saved=JSON.parse(localStorage.getItem(WHEEL_COMPACT_WIN_KEY));return saved.w===wheelCompactWin.w&&saved.h===wheelCompactWin.h&&wheelWin.w!==wheelCompactWin.w;}));
  await page.click('#wheelMinBtn');
  check('restoring the full wheel clears the compact scale',await page.evaluate(()=>!wheelMin&&!document.getElementById('wheelCard').style.getPropertyValue('--cw-k')));
  await page.click('#wheelMinBtn');
  check('team battle UI has no uncaught exceptions',errors.length===0);
  console.log(`Passed ${checks} team battle browser checks.`);
} finally {await browser.close();}
