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
  await page.click('#wheelBtn');
  await page.waitForFunction(() => !!window.QuickBattle && !document.getElementById('wheelSpinBtn').disabled && !document.getElementById('wheelQuickStatus').textContent.includes('Loading'));
}
async function settle() { await page.waitForFunction(() => document.getElementById('cbSaveStatus').textContent !== 'Saving…'); }
async function spin() {
  const prior = await page.evaluate(() => __battleState()?.revision || 0);
  await page.click('#wheelSpinBtn');
  try { await page.waitForFunction(revision => (__battleState()?.revision || 0) > revision && !document.getElementById('wheelSpinBtn').disabled, prior,{timeout:8000}); } catch(error) { console.log(await page.evaluate(()=>({state:__battleState(),status:document.getElementById('wheelQuickStatus').textContent,spinning:wheelSpinning,spin:wheelState.lastSpinId})));throw error; }
}
try {
  await setup();
  check('ordinary Wheel enables Quick fight by default without opening manual battle',await page.evaluate(()=>document.getElementById('wheelQuickToggle').checked&&!ClassroomBattle.isOpen()));
  check('new party preview shows a pixel hero and encounter hint',await page.locator('#wheelQuickDuel .cbAvatar').count()===1);
  await spin();
  check('one spin starts combat, selects a learned skill and resolves enemy reply with no answer prompt',await page.evaluate(()=>{const s=__battleState();return s.lastEvent.type==='auto'&&s.lastEvent.skillId&&s.lastEvent.enemy&&s.pending===null&&s.bossTurns===1;}));
  check('wheel displays hero versus enemy avatars with HP and MP',await page.evaluate(()=>document.querySelectorAll('#wheelQuickDuel img').length===2&&document.getElementById('wheelQuickDuel').textContent.includes('MP ')&&document.getElementById('wheelQuickDuel').textContent.includes('HP ')));
  check('quick combat does not award marks or count a correct answer',await page.evaluate(()=>__battleState().correctCount===0&&rwStudents.every(s=>s.marks===10)));
  const first=await page.evaluate(()=>JSON.stringify(__battleState()));
  await page.evaluate(async()=>{const entry=wheelState.names[wheelWinnerIdx];await ClassroomBattle.landed(entry,wheelState.lastSpinId);await ClassroomBattle.landed(entry,wheelState.lastSpinId);});
  check('duplicate landing callbacks cannot replay the fight',await page.evaluate(first=>JSON.stringify(__battleState())===first,first));
  await page.screenshot({path:path.join(output,'quick-wheel-duel.png'),fullPage:true});
  await setup();
  check('reload restores duel without replaying the last spin',await page.evaluate(first=>JSON.stringify(__battleState())===first,first));
  await page.click('#wheelSpinBtn');await page.evaluate(()=>closeWheel());await page.waitForTimeout(650);
  check('closing mid-spin cancels battle work while retaining the wheel call',await page.evaluate(first=>JSON.stringify(__battleState())===first&&!wheelSpinning&&wheelState.names.filter(n=>n.done).length===2,first));
  await page.evaluate(()=>openWheel());await page.waitForFunction(()=>!document.getElementById('wheelSpinBtn').disabled);
  await page.uncheck('#wheelQuickToggle');
  await page.click('#wheelSpinBtn');await page.waitForFunction(()=>!wheelSpinning);
  check('turning Quick fight off leaves an ordinary name wheel',await page.evaluate(first=>JSON.stringify(__battleState())===first&&document.getElementById('wheelQuickDuel').hidden,first));
  await page.check('#wheelQuickToggle');await page.waitForFunction(()=>!document.getElementById('wheelSpinBtn').disabled);
  await page.evaluate(()=>{const s=__battleState();s.bossHp=1;s.heroes.forEach(h=>h.hp=h.stats.maxHp);__battleNotify('classroomBattles/teacher-fixture/classes/'+ClassroomBattleStore.classKey('P5 Science'));});
  await spin();
  check('victory shows an animated chest and saved personal treasure for every hero',await page.evaluate(()=>__battleState().status==='victory'&&__battleState().rewards.length===16&&document.querySelectorAll('.cbQuickTreasure .cbChest').length===1&&document.querySelectorAll('.cbQuickTreasure details p').length===16));
  await page.screenshot({path:path.join(output,'quick-wheel-treasure.png'),fullPage:true});
  const victory=await page.evaluate(()=>({id:__battleState().encounterId,xp:__battleState().heroes.reduce((sum,h)=>sum+h.xp,0)}));
  await spin();
  check('next spin starts a new encounter and carries all XP forward',await page.evaluate(v=>__battleState().encounterId!==v.id&&__battleState().heroes.reduce((sum,h)=>sum+h.xp,0)===v.xp+12,victory));
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
  check('quick wheel raises no application exceptions',errors.length===0);
  console.log('\n'+checks+' quick wheel browser checks passed. Screenshots: '+output);
} finally { await browser.close(); }

