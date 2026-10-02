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
async function setup(delayProfiles = 0) {
  await page.goto(file);
  await page.waitForFunction(() => !!window.ClassroomBattle);
  await page.evaluate(({ delayProfiles }) => {
    window.__arenaPlays=[];window.__arenaFinished=[];
    const playArena=window.ClassroomBattleAnimation.playArena;
    if(playArena)window.ClassroomBattleAnimation.playArena=function(container,options){
      window.__arenaPlays.push({id:options.event.id,skillId:options.event.skillId,job:options.hero.job,connected:container.isConnected&&options.heroActor.isConnected&&options.enemyActor.isConnected});
      const player=playArena.call(this,container,options);player.finished.then(result=>window.__arenaFinished.push({id:options.event.id,...result}));return player;
    };
    window.isAdmin = () => true;
    window.currentUser = { uid: 'teacher-fixture', email: 'teacher@example.test' };
    window.actingStudent = null;
    window.rwStudents = ['Ari', 'Bo', 'Cy', 'Dee', 'Evan', 'Faye', 'Gale', 'Hana', 'Ivan', 'Jade', 'Kai', 'Luna', 'Maya', 'Noah', 'Owen', 'Pia'].map((name, i) => ({ id: 'student-' + i, name, ...(i < 4 ? { uid: 'account-' + i } : {}), slots: ['P5 Science', 'P6 Science'], marks: 10 }));
    const roles = ['warrior', 'ranger', 'mage', 'healer'];
    const documents = JSON.parse(localStorage.getItem('battle-fixture-documents') || '{}');
    roles.forEach((role, i) => {
      documents['scienceGameLeaderboard/account-' + i] ||= { battleHero: { version: 1, uid: 'account-' + i, role, avatarDataUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="90" height="110"><circle cx="45" cy="28" r="19" fill="#e9b892"/><rect x="20" y="49" width="50" height="47" rx="12" fill="' + ['#688dc1', '#6aab71', '#a586ca', '#76baa9'][i] + '"/><circle cx="39" cy="26" r="2"/><circle cx="51" cy="26" r="2"/></svg>'), stats: { atk: 40, def: 20, maxHp: 150, crit: 10, critMult: 1.5 }, equipment: { weapon: 'starter-sword', helmet: 'cloth-hat' } } };
    });
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
    window.ClassroomHeroAPI.request = async ({type, classId, action}) => {
      if (type !== 'battle') throw new Error('Unexpected request in battle fixture.');
      const ref = db.collection('classroomBattles').doc(currentUser.uid).collection('classes').doc(ClassroomBattleStore.classKey(classId));
      return db.runTransaction(async tx => {
        const receipt = ref.collection('actions').doc(action.id), oldReceipt = await tx.get(receipt), snapshot = await tx.get(ref);
        const old = snapshot.exists ? snapshot.data() : null;
        if (oldReceipt.exists) return {state:old};
        const next = ClassroomBattleCore.reduce(old, action);
        if (next === old) return {state:old};
        const state = {...next,teacherId:currentUser.uid,classId};
        tx.set(ref,state);tx.set(receipt,{encounterId:state.encounterId,revision:state.revision,type:action.type});return {state};
      });
    };
    window.__battleDocuments = documents;
    window.__battleNotify = notify;
    window.__battleState = (cls = 'P5 Science') => documents['classroomBattles/teacher-fixture/classes/' + ClassroomBattleStore.classKey(cls)];
    localStorage.setItem('polymath.wheelClass', 'P5 Science');
    window.wheelRandom = () => 0;
    applyRewardVisibility();
  }, { delayProfiles });
  await page.click('#classroomBattleBtn');
  await page.waitForFunction(() => !document.getElementById('cbStart').disabled);
}
async function settle() { await page.waitForFunction(() => document.getElementById('cbSaveStatus').textContent !== 'Saving…'); }
async function spin() {
  await page.click('#wheelSpinBtn');
  await page.waitForFunction(() => !!__battleState()?.pending && !document.getElementById('cbCorrect').disabled);
}
try {
  await setup();
  check('teacher opens the battle with original wheel and independent pixel avatars', await page.evaluate(() => document.querySelectorAll('#cbHeroes .cbHero').length === 16 && document.querySelectorAll('#cbHeroes img[src^="assets/battle-pixel/"]').length === 16 && !!document.querySelector('#cbWheelMount #wheelCanvas')));
  check('animated avatars leave room for every hero name and HP label', await page.evaluate(() => [...document.querySelectorAll('#cbHeroes .cbHero')].every(node => node.querySelector('.cbHeroHp').getBoundingClientRect().bottom <= node.getBoundingClientRect().bottom + 1)));
  await page.selectOption('#cbEncounterChoice', await page.evaluate(() => ClassroomBattleCore.BOSSES.find(b => !b.legacy && b.id.includes('goblin')).id));
  await page.click('#cbStart'); await settle();
  check('new encounter is persisted for this teacher and class', await page.evaluate(() => __battleState().heroes.length === 16 && __battleState().status === 'active'));
  check('four heroes form a vertical column facing the enemy on the right', await page.evaluate(() => { const a = [...document.querySelectorAll('#cbHeroes .cbHero')].map(n=>n.getBoundingClientRect()); const boss=document.getElementById('cbBoss').getBoundingClientRect(); return a[0].left === a[3].left && a[3].top > a[0].top && a[4].left > a[0].left && a[4].top === a[0].top && boss.left > a[0].right; }));
  await page.locator('.cbHero').first().click();
  await page.selectOption('#cbRoleChoice', 'mage'); await settle();
  check('class changes are saved locally to the classroom hero', await page.evaluate(() => __battleState().heroes[0].role === 'mage'));
  check('skill tree has 12 nodes and three visible branching columns', await page.locator('.hstNode').count() === 12);
  await page.click('[data-hst-node="mage-ice-lance"]'); await page.click('[data-hst-learn="mage-ice-lance"]'); await settle();
  check('learning a skill spends points and persists the prerequisite root', await page.evaluate(() => __battleState().heroes[0].learnedSkills.includes('mage-ice-lance')));
  await page.screenshot({ path:path.join(output,'pixel-skill-tree.png'),fullPage:true });
  await page.click('#cbJournalClose');
  const independent = await page.evaluate(() => JSON.stringify(__battleState().heroes[0]));
  await page.evaluate(() => { __battleDocuments['scienceGameLeaderboard/account-0'].battleHero.role='cleric'; __battleDocuments['scienceGameLeaderboard/account-0'].battleHero.stats.atk=9999; __battleNotify('scienceGameLeaderboard/account-0'); });
  await page.waitForTimeout(300);
  check('CER profile changes cannot overwrite classroom progression', await page.evaluate(old => JSON.stringify(__battleState().heroes[0]) === old, independent));
  const beforeMeter = await page.evaluate(() => __battleState().bossTurns);
  await page.click('#cbAttack');
  check('boss attack opens black/orange/red meter without damage', await page.evaluate(turns => !document.getElementById('cbTiming').hidden && __battleState().bossTurns === turns && document.getElementById('wheelSpinBtn').disabled, beforeMeter));
  const needle = await page.locator('#cbPowerNeedle').getAttribute('style'); await page.waitForTimeout(100);
  check('meter needle moves until stopped', needle !== await page.locator('#cbPowerNeedle').getAttribute('style'));
  await page.screenshot({path:path.join(output,'pixel-boss-meter.png'),fullPage:true});
  await page.click('#cbStop'); await settle();
  check('stopping applies exactly one timed boss turn and closes meter', await page.evaluate(turns => __battleState().bossTurns === turns+1 && document.getElementById('cbTiming').hidden && __battleState().lastEvent.targets.length > 0, beforeMeter));
  await spin();
  const turn = await page.evaluate(() => ({hp:__battleState().bossHp, count:__battleState().correctCount, hero:__battleState().heroes.find(h=>h.id===__battleState().pending.heroId)}));
  await page.click('#cbSkills');
  const usable = page.locator('#cbCommandOptions [data-command]:not([disabled])').first();
  check('learned active skills are available in command box', await usable.count() === 1);
  await usable.click();
  await page.evaluate(() => { document.getElementById('cbCorrect').click(); document.getElementById('cbCorrect').click(); }); await settle();
  check('skill resolves once and spends MP', await page.evaluate(before => __battleState().correctCount === before.count+1 && !__battleState().pending && __battleState().heroes.find(h=>h.id===before.hero.id).mp < before.hero.mp,turn));
  check('reduced-motion manual casts settle without a moving overlay',await page.evaluate(()=>__arenaPlays.at(-1)?.id===__battleState().lastEvent.id&&!document.querySelector('#cbArena.cbaPlaying')));
  await spin(); await page.click('#cbItems');
  const item = page.locator('#cbCommandOptions [data-command]:not([disabled])').first();
  const itemId = await item.getAttribute('data-command');
  const itemBefore = await page.evaluate(id => {const s=__battleState(),h=s.heroes.find(h=>h.id===s.pending.heroId); return {id:h.id,qty:h.inventory.find(i=>i.id===id).quantity};},itemId);
  await item.click(); await page.click('#cbCorrect'); await settle();
  check('correct item command consumes exactly one inventory charge',await page.evaluate(({id,before}) => {const h=__battleState().heroes.find(h=>h.id===before.id), entry=h.inventory.find(i=>i.id===id);return (entry?.quantity||0)===before.qty-1;},{id:itemId,before:itemBefore}));
  for (const [id,outcome] of [['cbIncorrect','incorrect'],['cbSkip','skip']]) { await spin(); const hp=await page.evaluate(()=>__battleState().bossHp); await page.click('#'+id); await settle(); check(outcome+' resolves without damage',await page.evaluate(hp=>__battleState().bossHp===hp&&!__battleState().pending,hp)); }
  await spin();
  await page.screenshot({path:path.join(output,'pixel-battle-desktop.png'),fullPage:true});
  for (const [name,width,height] of [['tablet',820,1180],['landscape',1024,768],['phone',390,844]]) {
    await page.setViewportSize({width,height});
    await page.locator('#cbCorrect').scrollIntoViewIfNeeded();
    check(name+' commands remain tappable without page overflow',await page.evaluate(()=>{const b=document.getElementById('cbCorrect').getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&b.height>=44&&document.querySelector('.cbShell').scrollWidth<=innerWidth;}));
    check(name+' maintains heroes left and enemy right',await page.evaluate(()=>document.getElementById('cbHeroes').getBoundingClientRect().left<document.getElementById('cbBoss').getBoundingClientRect().left));
    check(name+' enemy artwork does not overlap its name or health',await page.evaluate(()=>document.getElementById('cbBossImage').getBoundingClientRect().bottom<=document.getElementById('cbBossName').getBoundingClientRect().top));
    await page.screenshot({path:path.join(output,'pixel-battle-'+name+'.png'),fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  const pending = await page.evaluate(()=>__battleState().pending.id); await setup();
  check('reload restores unresolved turn and disables another spin',await page.evaluate(id=>__battleState().pending.id===id&&document.getElementById('wheelSpinBtn').disabled,pending));
  await page.click('#cbSkip'); await settle();
  await page.evaluate(()=>{__battleState().bossHp=1;__battleState().heroes[4].hp=0;__battleNotify('classroomBattles/teacher-fixture/classes/'+ClassroomBattleStore.classKey('P5 Science'));});
  await spin(); await page.click('#cbCorrect'); await settle();
  check('victory awards a personal treasure to every hero including fallen allies',await page.evaluate(()=>__battleState().status==='victory'&&__battleState().rewards.length===16&&document.querySelectorAll('.cbReward').length===16&&!document.getElementById('cbLoot').hidden));
  const rewards=await page.evaluate(()=>JSON.stringify(__battleState().rewards));
  await page.locator('#cbLoot').scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
  await page.screenshot({path:path.join(output,'pixel-victory-loot.png'),fullPage:true});
  await setup(); check('victory reload keeps exactly the same loot',await page.evaluate(r=>JSON.stringify(__battleState().rewards)===r,rewards));
  const relicHero = await page.evaluate(()=>__battleState().heroes.find(h=>h.inventory.some(i=>ClassroomBattleCore.itemById(i.itemId).type==='equipment'))?.id);
  assert.ok(relicHero,'victory fixture contains equipment');
  await page.locator('[data-inspect="'+relicHero+'"]').click();
  check('victory automatically equips collected gear in its owner journal',await page.evaluate(id=>!!__battleState().heroes.find(h=>h.id===id).equipped,relicHero));
  const selectedRelic = await page.evaluate(id=>__battleState().heroes.find(h=>h.id===id).equipped,relicHero);
  await page.locator('[data-equip=""]').click(); await settle();
  await page.locator('[data-equip="'+selectedRelic+'"]').click(); await settle();
  check('collected equipment can be equipped from its owner journal',await page.evaluate(id=>!!__battleState().heroes.find(h=>h.id===id).equipped,relicHero));
  await page.click('#cbJournalClose');
  await page.evaluate(()=>{const h=__battleState().heroes[0];Object.assign(h,{level:15,xp:ClassroomBattleCore.xpForLevel(15),skillPoints:30});__battleNotify('classroomBattles/teacher-fixture/classes/'+ClassroomBattleStore.classKey('P5 Science'));});
  await page.locator('.cbHero').first().click();
  check('teacher journal offers two advanced jobs after level 15 between encounters',await page.locator('[data-advance]').count()===2&&await page.locator('[data-advance="archmage"]').isEnabled());
  await page.click('[data-advance="archmage"]');await settle();
  check('teacher job upgrade saves and opens the advanced skill tree',await page.evaluate(()=>__battleState().heroes[0].job==='archmage'&&document.querySelector('#cbSkillGraph .hstOrigin strong').textContent==='Archmage'));
  await page.click('[data-hst-tree="base"]');
  check('teacher can inspect the foundation tree after an advanced job upgrade',await page.locator('[data-hst-node="mage-ice-lance"]').getAttribute('data-state')==='learned');
  await page.click('#cbJournalClose');
  const progression=await page.evaluate(()=>__battleState().heroes.map(h=>({id:h.id,xp:h.xp,inventory:h.inventory,learned:h.learnedSkills})));
  await page.click('#cbStart'); await settle();
  check('next encounter preserves every hero inventory, XP and learned skills',await page.evaluate(old=>JSON.stringify(__battleState().heroes.map(h=>({id:h.id,xp:h.xp,inventory:h.inventory,learned:h.learnedSkills})))===JSON.stringify(old),progression));
  await page.locator('.cbHero').first().click();
  check('teacher cannot switch an advanced job during an active encounter',await page.locator('[data-advance]').evaluateAll(nodes=>nodes.every(node=>node.disabled)));
  await page.click('#cbJournalClose');
  await page.evaluate(()=>{const s=__battleState();s.pending={id:'test-advanced-command',heroId:s.heroes[0].id};__battleNotify('classroomBattles/teacher-fixture/classes/'+ClassroomBattleStore.classKey('P5 Science'));});
  await page.click('#cbSkills');
  check('manual command menu offers learned foundation and advanced skills together',await page.evaluate(()=>!!document.querySelector('[data-command="mage-firebolt"]')&&!!document.querySelector('[data-command="'+ClassroomBattleCore.JOB_SKILLS.archmage[0].id+'"]')));
  const advancedSkill=await page.evaluate(()=>ClassroomBattleCore.JOB_SKILLS.archmage[0].id);
  await page.evaluate(()=>{const s=__battleState();s.bossHp=10000;s.bossMaxHp=10000;});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.click('[data-command="'+advancedSkill+'"]');await page.click('#cbCorrect');await settle();
  check('manual advanced cast starts generated animation on connected final-render actors',await page.evaluate(id=>__arenaPlays.at(-1)?.skillId===id&&__arenaPlays.at(-1)?.job==='archmage'&&__arenaPlays.at(-1)?.connected,advancedSkill));
  const playedAdvanced=await page.evaluate(()=>({count:__arenaPlays.length,id:__battleState().lastEvent.id,revision:__battleState().revision,hp:__battleState().bossHp}));
  await page.evaluate(()=>__battleNotify('classroomBattles/teacher-fixture/classes/'+ClassroomBattleStore.classKey('P5 Science')));
  check('repeated saved snapshots neither replay a cast nor calculate a second battle',await page.evaluate(before=>__arenaPlays.length===before.count&&__battleState().revision===before.revision&&__battleState().bossHp===before.hp,playedAdvanced));
  await page.click('#cbClose');
  await page.waitForFunction(id=>__arenaFinished.some(event=>event.id===id&&event.cancelled),playedAdvanced.id);
  check('closing the battle cancels in-progress generated casts',await page.evaluate(()=>!document.querySelector('#cbArena.cbaPlaying')));
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>ClassroomBattle.open());
  await page.waitForFunction(()=>!document.getElementById('cbAttack').disabled);
  check('reopening does not replay the saved advanced cast',await page.evaluate(before=>__arenaPlays.length===before.count,playedAdvanced));
  await page.evaluate(()=>{const s=__battleState();s.bossMp=0;s.charge=ClassroomBattleCore.bossById(s.bossId).chargeMax;__battleNotify('classroomBattles/teacher-fixture/classes/'+ClassroomBattleStore.classKey('P5 Science'));});
  check('low enemy mana allows a recovery attack instead of trapping a full charge',await page.locator('#cbAttack').isEnabled()&&await page.locator('#cbUltimate').isDisabled()&&await page.locator('#cbBossMp').textContent()==='0 / 60');
  await page.evaluate(()=>{__battleState().bossMp=60;__battleNotify('classroomBattles/teacher-fixture/classes/'+ClassroomBattleStore.classKey('P5 Science'));});
  await page.evaluate(()=>{const s=__battleState();s.heroes.forEach(h=>h.hp=1);s.charge=ClassroomBattleCore.bossById(s.bossId).chargeMax;__battleNotify('classroomBattles/teacher-fixture/classes/'+ClassroomBattleStore.classKey('P5 Science'));});
  await page.click('#cbUltimate'); await page.click('#cbStop'); await settle();
  check('boss skill uses meter and team defeat allows a fresh encounter',await page.evaluate(()=>__battleState().status==='defeat'&&!document.getElementById('cbStart').disabled));
  await page.selectOption('#wheelClassSelect','P6 Science'); await page.waitForFunction(()=>!document.getElementById('cbStart').disabled);
  check('another class has separate encounter and progression',await page.evaluate(()=>!__battleState('P6 Science')));
  await page.evaluate(()=>{const old=structuredClone(__battleState()); old.classId='P6 Science';old.status='active';old.pending=null;old.bossHp=old.bossMaxHp;old.heroes.forEach(h=>{delete h.progressionVersion;delete h.learnedSkills;delete h.inventory;delete h.mp;h.role='healer';h.hp=Math.round(h.stats.maxHp/2);}); __battleDocuments['classroomBattles/teacher-fixture/classes/'+ClassroomBattleStore.classKey('P6 Science')]=old;localStorage.setItem('battle-fixture-documents',JSON.stringify(__battleDocuments));});
  await page.click('#cbClose'); await page.evaluate(()=>ClassroomBattle.open()); await page.selectOption('#wheelClassSelect','P6 Science');
  await page.waitForFunction(()=>__battleState('P6 Science').heroes.every(h=>h.progressionVersion===1));
  check('old CER healer encounters render and migrate without a crash',await page.evaluate(()=>__battleState('P6 Science').heroes.every(h=>h.role==='cleric'&&h.hp>0&&h.hp<h.stats.maxHp)));
  await page.click('#cbClose');
  check('closing restores original wheel',await page.evaluate(()=>document.getElementById('wheelModal').parentNode===document.body&&!document.body.classList.contains('cbOpen')));
  await page.evaluate(()=>{isAdmin=()=>false;applyRewardVisibility();});
  check('student mode cannot open teacher controls',await page.evaluate(()=>document.getElementById('classroomBattleBtn').style.display==='none'&&!ClassroomBattle.isOpen()));
  const art=await page.evaluate(async()=>Promise.all([...Object.keys(ClassroomBattleCore.ROLES).map(role=>'assets/battle-pixel/'+role+'.png'),...ClassroomBattleCore.BOSSES.map(b=>b.image),'assets/battle-pixel/chest-sheet.png'].map(src=>new Promise(resolve=>{const img=new Image();img.onload=()=>resolve({src,ok:img.naturalWidth>32});img.onerror=()=>resolve({src,ok:false});img.src=src;}))));
  check('every class, enemy and chest image decodes',art.every(a=>a.ok));
  check('no uncaught application errors',errors.length===0);
  console.log('\n'+checks+' pixel classroom browser checks passed. Screenshots: '+output);
} finally { await browser.close(); }
