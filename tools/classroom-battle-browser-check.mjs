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
    window.rwStudents = ['Ari', 'Bo', 'Cy', 'Dee', 'Guest'].map((name, i) => ({ id: 'student-' + i, name, ...(i < 4 ? { uid: 'account-' + i } : {}), slots: ['P5 Science', 'P6 Science'], marks: 10 }));
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
  check('teacher opens the battle with the original wheel embedded', await page.locator('#cbWheelMount #wheelCanvas').count() === 1);
  check('four CER roles and a clear starter fallback load', await page.evaluate(() => document.querySelectorAll('.cbHero').length === 5 && document.querySelectorAll('.cbHero img').length === 4 && document.querySelector('#cbHeroes').textContent.includes('No CER account linked')));
  await page.click('#cbStart'); await settle();
  check('random encounter is persisted for this teacher and class', await page.evaluate(() => __battleState().bossId && __battleState().heroes.length === 5));
  // Hurt teammates and charge an ultimate before the healer takes a turn.
  await page.click('#cbAttack'); await settle();
  check('boss turns launch an animated projectile and impact', await page.evaluate(() => __battleAnimations.some(a => a.className.includes('cbBossProjectile')) && __battleAnimations.some(a => a.className.includes('cbDamage'))));
  await page.click('#cbAttack'); await settle();
  await page.click('#cbAttack'); await settle();
  const chargeMax = await page.evaluate(() => ClassroomBattleCore.bossById(__battleState().bossId).chargeMax);
  for (let i = 3; i < chargeMax; i++) { await page.click('#cbAttack'); await settle(); }
  check('boss attack displays predictable charge', await page.evaluate(() => !document.querySelector('#cbUltimate').disabled));
  await page.click('#cbUltimate'); await settle();
  check('ultimate damages every hero and resets charge', await page.evaluate(() => __battleState().lastEvent.targets.length === 5 && __battleState().charge === 0));
  check('ultimate displays an animated area attack', await page.evaluate(() => __battleAnimations.some(a => a.className.includes('cbAreaAttack'))));
  const rolesSeen = [];
  for (let i = 0; i < 4; i++) {
    await spin();
    const before = await page.evaluate(() => ({ hp: __battleState().bossHp, count: __battleState().correctCount, hero: __battleState().heroes.find(h => h.id === __battleState().pending.heroId) }));
    rolesSeen.push(before.hero.role);
    check(before.hero.role + ' is highlighted from the wheel’s stable student ID', await page.locator('.cbHero.cbSelected').getAttribute('data-hero-id') === before.hero.id);
    await page.evaluate(() => { __battleAnimations = []; });
    await page.evaluate(() => { document.getElementById('cbCorrect').click(); document.getElementById('cbCorrect').click(); document.getElementById('cbCorrect').click(); });
    await settle();
    check(before.hero.role + ' correct answer damages boss exactly once', await page.evaluate(({ hp, count }) => __battleState().bossHp < hp && __battleState().correctCount === count + 1 && !__battleState().pending, before));
    check(before.hero.role + ' plays its role-specific animated attack', await page.evaluate(role => {
      const expected = { warrior: 'cbwarrior', ranger: 'cbArrow', mage: 'cbmage', healer: 'cbhealer' }[role];
      return __battleAnimations.filter(a => a.className.includes(expected)).length >= (role === 'ranger' ? 2 : 1);
    }, before.hero.role));
    if (before.hero.role === 'healer') check('healer restores teammates’ health', await page.evaluate(() => __battleState().lastEvent.healed.some(h => h.amount > 0)));
    if (before.hero.role === 'healer') check('healer animates healing on teammates', await page.evaluate(() => __battleAnimations.some(a => a.className.includes('cbHealing'))));
  }
  check('all four hero roles were exercised', new Set(rolesSeen).size === 4);
  for (const [button, outcome] of [['cbIncorrect', 'incorrect'], ['cbSkip', 'skip']]) {
    await spin(); const hp = await page.evaluate(() => __battleState().bossHp);
    await page.click('#' + button); await settle();
    check(outcome + ' resolves once without hero damage', await page.evaluate(({ hp, outcome }) => __battleState().bossHp === hp && !__battleState().pending && __battleState().lastEvent.outcome === outcome, { hp, outcome }));
  }
  await page.evaluate(() => { __battleDocuments['scienceGameLeaderboard/account-0'].battleHero.role = 'mage'; __battleDocuments['scienceGameLeaderboard/account-0'].battleHero.stats.atk = 90; __battleDocuments['scienceGameLeaderboard/account-0'].battleHero.equipment.pet = 'fox'; __battleNotify('scienceGameLeaderboard/account-0'); });
  await page.waitForFunction(() => __battleState().heroes[0].role === 'mage');
  check('live CER role/equipment/stat updates synchronize without recreating the encounter', await page.evaluate(() => __battleState().heroes[0].role === 'mage' && document.querySelector('.cbHero').textContent.includes('Mage') && document.querySelector('.cbHero').textContent.includes('3 items')));
  const source = await page.evaluate(() => structuredClone(__battleDocuments['scienceGameLeaderboard/account-0']));
  await page.evaluate(() => { __battleDocuments['scienceGameLeaderboard/account-0'].battleHero.avatarDataUrl = 'data:image/svg+xml;charset=utf-8,%3Csvg'; __battleNotify('scienceGameLeaderboard/account-0'); });
  await page.waitForFunction(() => document.querySelector('.cbHero .cbAvatarNote').textContent.includes('Avatar unavailable'));
  check('failed avatar decoding displays a clear fallback with synced stats', await page.locator('.cbHero').first().locator('.cbAvatarFallback').count() === 1);
  await page.evaluate(() => { delete __battleDocuments['scienceGameLeaderboard/account-0']; __battleNotify('scienceGameLeaderboard/account-0'); });
  await page.waitForTimeout(350);
  check('an unavailable profile never downgrades an existing saved hero', await page.evaluate(() => __battleState().heroes[0].role === 'mage'));
  await page.evaluate(source => { __battleDocuments['scienceGameLeaderboard/account-0'] = source; __battleNotify('scienceGameLeaderboard/account-0'); }, source);
  await spin();
  await page.screenshot({ path: path.join(output, 'battle-desktop.png'), fullPage: true });
  for (const [name, width, height] of [['tablet', 820, 1180], ['tablet-portrait', 768, 1024], ['tablet-landscape', 1024, 768]]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: path.join(output, 'battle-' + name + '.png'), fullPage: true });
    check(name + ' controls stay inside viewport and can be tapped', await page.evaluate(() => ['cbCorrect', 'cbIncorrect', 'cbSkip', 'cbStart'].every(id => { const b = document.getElementById(id).getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight && b.height >= 44; })));
  }
  await page.click('#cbSkip'); await settle();
  const saved = await page.evaluate(() => ({ id: __battleState().encounterId, hp: __battleState().bossHp, health: __battleState().heroes.map(h => h.hp), role: __battleState().heroes[0].role }));
  await setup(600);
  check('reload restores boss, damage, hero health and roles despite delayed profiles', await page.evaluate(saved => { const s = __battleState(); return s.encounterId === saved.id && s.bossHp === saved.hp && JSON.stringify(s.heroes.map(h => h.hp)) === JSON.stringify(saved.health) && s.heroes[0].role === saved.role; }, saved));
  await page.selectOption('#wheelClassSelect', 'P6 Science');
  await page.waitForFunction(() => !document.getElementById('cbStart').disabled);
  check('another class has a separate encounter', await page.evaluate(() => !__battleState('P6 Science') && document.getElementById('cbBossName').textContent.includes('awaits')));
  await page.selectOption('#wheelClassSelect', 'P5 Science');
  await page.waitForFunction(() => !document.getElementById('cbStart').disabled);
  await spin();
  const pending = await page.evaluate(() => __battleState().pending.id);
  await setup();
  check('an unresolved answer is restored after reload', await page.evaluate(id => __battleState().pending.id === id && !document.getElementById('cbCorrect').disabled && document.getElementById('wheelSpinBtn').disabled, pending));
  await page.click('#cbSkip'); await settle();
  await page.evaluate(() => { __battleState().bossHp = 1; __battleNotify('classroomBattles/teacher-fixture/classes/' + ClassroomBattleStore.classKey('P5 Science')); });
  await spin(); await page.click('#cbCorrect'); await settle();
  check('boss defeat shows saved victory and locks completed encounter controls', await page.evaluate(() => __battleState().status === 'victory' && document.getElementById('cbFeedback').textContent.includes('Victory!') && document.getElementById('wheelSpinBtn').disabled));
  await page.click('#cbStart'); await settle();
  await page.evaluate(() => { __battleState().heroes.forEach(h => { h.hp = 1; }); __battleState().charge = ClassroomBattleCore.bossById(__battleState().bossId).chargeMax; __battleNotify('classroomBattles/teacher-fixture/classes/' + ClassroomBattleStore.classKey('P5 Science')); });
  await page.click('#cbUltimate'); await settle();
  check('team defeat is explicit and permits a deliberate fresh encounter', await page.evaluate(() => __battleState().status === 'defeat' && document.getElementById('cbFeedback').textContent.includes('fresh try') && !document.getElementById('cbStart').disabled));
  await page.click('#cbClose');
  check('closing restores the normal wheel and leaves worksheet controls intact', await page.evaluate(() => document.getElementById('wheelModal').parentNode === document.body && !document.body.classList.contains('cbOpen')));
  await page.evaluate(async () => { await openWheel(); wheelNewRound(); });
  await page.click('#wheelSpinBtn');
  await page.waitForFunction(() => !wheelSpinning && !!document.querySelector('#wheelHeroPreview img'));
  check('the ordinary selection wheel also shows the existing CER avatar', await page.locator('#wheelHeroPreview').textContent().then(text => text.includes('CER synced')));
  await page.evaluate(() => { isAdmin = () => false; applyRewardVisibility(); });
  check('student mode hides and refuses teacher battle controls', await page.evaluate(() => document.getElementById('classroomBattleBtn').style.display === 'none' && !ClassroomBattle.isOpen()));
  check('no uncaught application errors', errors.length === 0);
  // Verify the full original-boss catalogue decodes in the browser.
  const art = await page.evaluate(async () => Promise.all(ClassroomBattleCore.BOSSES.map(b => new Promise(resolve => { const img = new Image(); img.onload = () => resolve({ id: b.id, ok: img.naturalWidth > 50 && img.naturalHeight > 50 }); img.onerror = () => resolve({ id: b.id, ok: false }); img.src = b.image; }))));
  check('all 20 original boss images decode', art.length === 20 && art.every(a => a.ok));
  console.log('\n' + checks + ' classroom browser checks passed. Screenshots: ' + output);
} finally { await browser.close(); }
