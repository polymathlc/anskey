// 🎁 Item desk (v1.158.0): the hero journal's gift form, drop history and restore,
// on the real page with the real battle controller. The server is unit tested.
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
    window.__appearanceHold=false;window.__appearanceRelease=null;window.__appearanceCancelled=0;
    window.ClassroomHeroAPI.request = async (__body, lifecycle={}) => { const {type, classId, action, command}=__body;
      if(type==='lessonGuests'&&command==='get')return {guests:[],state:null};
      if(type==='items')return window.__itemsApi(__body);
      if(action?.command==='appearance' && __appearanceHold)await new Promise(resolve=>__appearanceRelease=resolve);
      if(lifecycle.canSend && !lifecycle.canSend()){__appearanceCancelled++;throw new Error('The lesson or signed-in account changed.');}
      if (type !== 'battle') throw new Error('Unexpected request in battle fixture.');
      const ref = db.collection('classroomBattles').doc(currentUser.uid).collection('classes').doc(ClassroomBattleStore.classKey(classId));
      return db.runTransaction(async tx => {
        const receipt = ref.collection('actions').doc(action.id), oldReceipt = await tx.get(receipt), snapshot = await tx.get(ref);
        const old = snapshot.exists ? snapshot.data() : null;
        if (oldReceipt.exists) return {state:old};
        const next = ClassroomBattleCore.reduce(old, {...action,formation:'raid'});
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

await page.addInitScript(()=>{
  window.__itemRequests=[];
  const rows=[{dropId:'battle-abc:0',kind:'drop',studentId:'student-0',name:'Ari',itemId:'red-potion',itemName:'Red Potion',rarity:'common',type:'consumable',quantity:1,source:'victory',classId:'P5 Science',createdAt:Date.UTC(2026,9,20,3,0),restored:[]},
    {dropId:'battle-abc:1',kind:'drop',studentId:'student-0',name:'Ari',itemId:'pet-copper-beetle',itemName:'Copper Beetle',rarity:'common',type:'pet',quantity:1,source:'bonus-rune',classId:'P5 Science',createdAt:Date.UTC(2026,9,19,3,0),restored:[{at:Date.UTC(2026,9,21),studentId:'student-0',name:'Ari'}]}];
  const guests=[{dropId:'battle-xyz:0',kind:'drop',studentId:null,guest:true,name:'Ari T',itemId:'rune-ember',itemName:'Ember Rune',rarity:'common',type:'rune',quantity:1,source:'victory',classId:'P5 Science',createdAt:Date.UTC(2026,9,18),restored:[]}];
  window.__itemsApi=async body=>{
    __itemRequests.push(structuredClone(body));
    if(body.command==='history')return body.guests?{rows:guests,total:guests.length,owned:{}}:{rows:body.studentId==='student-0'?rows:[],total:body.studentId==='student-0'?2:0,owned:{'red-potion':3}};
    if(body.command==='gift'){const C=ClassroomBattleCore,item=body.itemId?C.itemById(body.itemId):Object.values(C.ITEMS).find(i=>(body.rarity==='random'||i.rarity===body.rarity)&&(body.itemType==='any'||i.type===body.itemType));
      return {entry:{studentId:body.studentId,itemId:item.id,itemName:item.name,rarity:item.rarity,type:item.type,quantity:body.quantity,source:'gift'},hero:null};}
    if(body.command==='restore'){const row=[...rows,...guests].find(r=>r.dropId===body.dropId);return {entry:{...row,studentId:body.studentId,restoreOf:body.dropId,source:'restore'},hero:null};}
    throw new Error('unexpected');
  };
});
try {
  await setup();
  await page.click('#cbStart'); await settle();
  await page.locator('.cbHero').first().click();
  await page.waitForSelector('.hiDesk .hiRow');
  check('clicking a character opens the gift form and the permanent drop history',await page.locator('.hiGift select[data-hi-field="rarity"]').count()===1&&await page.locator('.hiDesk .hiRow').count()===2);
  check('the history asks the server for this student only',await page.evaluate(()=>__itemRequests.some(r=>r.command==='history'&&r.studentId==='student-0'&&!r.guests)));
  check('a restored drop says so and offers to restore again',await page.locator('.hiRow').nth(1).textContent().then(t=>t.includes('Restored')&&t.includes('Restore again')));
  check('current counts are shown beside each drop',await page.locator('.hiRow').first().textContent().then(t=>t.includes('Owns ×3 now')));
  const rarities=await page.locator('select[data-hi-field="rarity"] option').allTextContents();
  check('every rarity and Random can be chosen',rarities.length===1+await page.evaluate(()=>Object.keys(ClassroomBattleCore.RARITIES).length)&&rarities[0].includes('Random'));
  check('the item list waits for a rarity',await page.locator('select[data-hi-field="itemId"]').isDisabled());
  await page.click('[data-hi-give]');await page.waitForSelector('.hiMessage');
  check('Random sends rarity random with no item id',await page.evaluate(()=>{const r=__itemRequests.filter(r=>r.command==='gift').at(-1);return r.rarity==='random'&&!r.itemId&&r.itemType==='any'&&r.quantity===1&&r.studentId==='student-0'&&r.classId==='P5 Science'&&/^[\w-]{8,}$/.test(r.id);}));
  await page.selectOption('select[data-hi-field="rarity"]','epic');
  await page.selectOption('select[data-hi-field="itemType"]','equipment');
  check('a rarity fills the item list with that rarity only',await page.evaluate(()=>{const ids=[...document.querySelectorAll('select[data-hi-field="itemId"] option')].map(o=>o.value).filter(Boolean);return ids.length>5&&ids.every(id=>{const i=ClassroomBattleCore.itemById(id);return i.rarity==='epic'&&i.type==='equipment';});}));
  const epic=await page.evaluate(()=>[...document.querySelectorAll('select[data-hi-field="itemId"] option')].map(o=>o.value).filter(Boolean)[2]);
  await page.selectOption('select[data-hi-field="itemId"]',epic);
  await page.fill('input[data-hi-field="quantity"]','3');await page.locator('input[data-hi-field="quantity"]').dispatchEvent('change');
  await page.click('[data-hi-give]');await page.waitForFunction(()=>__itemRequests.filter(r=>r.command==='gift').length===2);
  await page.waitForSelector('.hiMessage');
  check('a chosen item and copies are sent exactly',await page.evaluate(id=>{const r=__itemRequests.filter(r=>r.command==='gift').at(-1);return r.itemId===id&&r.quantity===3&&r.rarity===undefined;},epic));
  check('the gift is confirmed by name',await page.locator('.hiMessage').textContent().then(t=>t.includes('received')&&t.includes('×3')));
  check('the gift form keeps its choices when the journal redraws',await page.evaluate(()=>{__battleNotify('classroomBattles/teacher-fixture/classes/'+ClassroomBattleStore.classKey('P5 Science'));return true;})&&await page.locator('select[data-hi-field="rarity"]').inputValue()==='epic');
  await page.locator('.hiRow').first().locator('[data-hi-restore]').click();
  await page.waitForFunction(()=>__itemRequests.some(r=>r.command==='restore'));
  check('Restore sends the drop id for this student',await page.evaluate(()=>{const r=__itemRequests.find(r=>r.command==='restore');return r.dropId==='battle-abc:0'&&r.studentId==='student-0'&&!r.again;}));
  page.once('dialog',d=>d.accept());
  await page.waitForSelector('.hiRow:nth-child(2) [data-hi-restore]');
  await page.locator('.hiRow').nth(1).locator('[data-hi-restore]').click();
  await page.waitForFunction(()=>__itemRequests.filter(r=>r.command==='restore').length===2);
  check('restoring again is confirmed first and marked as deliberate',await page.evaluate(()=>__itemRequests.filter(r=>r.command==='restore')[1].again===true));
  await page.click('[data-hi-guests]');await page.waitForSelector('.hiGuests .hiRow');
  check('drops to unlinked wheel names can be given to this student',await page.locator('.hiGuests .hiRow').textContent().then(t=>t.includes('Ari T')&&t.includes('Give to Ari')));
  await page.locator('.hiGuests [data-hi-restore]').click();
  await page.waitForFunction(()=>__itemRequests.some(r=>r.command==='restore'&&r.dropId==='battle-xyz:0'&&r.studentId==='student-0'));
  check('a guest drop is restored to the open student',true);
  await page.screenshot({path:path.join(output,'hero-items-desk.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);
  check('the desk fits a phone with no sideways scroll',await page.evaluate(()=>{const d=document.querySelector('.hiDesk');return d.scrollWidth<=d.clientWidth+1&&[...d.querySelectorAll('select,input,button')].every(n=>n.getBoundingClientRect().right<=window.innerWidth+1);}));
  await page.screenshot({path:path.join(output,'hero-items-desk-phone.png'),fullPage:true});
  check('no page errors',errors.length===0||(console.log(errors),false));
  console.log(checks+' item desk checks passed.');
} finally { await browser.close(); }
