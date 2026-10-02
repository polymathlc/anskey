/* =====================================================================
   🎡 THE NAME WHEEL — in a real browser
   ---------------------------------------------------------------------
   wheel-tests.mjs pins the round arithmetic. This asks what only a browser
   can: that the window opens as the teacher, the wheel really turns and
   stops on the name it announced, every student is called once per round,
   the window moves and resizes (and the wheel with it), the names survive a
   reload, and a mark reaches the award function for the right student.

     node tools/wheel-check.mjs
     PW=/path/to/playwright/index.mjs node tools/wheel-check.mjs
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) {
  console.log('wheel-check: no Playwright at ' + PW + ' — skipped.');
  process.exit(0);
}
const FILE = pathToFileURL(path.resolve(process.argv[2] || 'index.html')).href;
let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (note ? '\n      ' + note : '')); }
};

const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {});
const ctx = await browser.newContext({ viewport: { width: 1100, height: 860 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
// The fixture owns Firebase; do not replace its proxy with the network SDK.
await page.route(/firebase-[a-z]+-compat\.js(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/javascript', body: '' }));
await page.addInitScript(() => {
  // This harness covers the plain name wheel; quick combat has its own browser suite.
  localStorage.setItem('polymath.wheelQuickFight', 'off');
  const chain = () => new Proxy(function () { return chain(); }, {
    get: (t, k) => (k === 'then' ? undefined : chain()),
    apply: () => chain(), construct: () => chain(), set: () => true
  });
  window.pdfjsLib = chain(); window.firebase = chain(); window.grecaptcha = chain();
});
const errors = [];
page.on('pageerror', e => errors.push(e.stack || e.message));
await page.goto(FILE);
await page.waitForTimeout(1000);
ok('the page loads with no uncaught error', errors.length === 0, errors.join('\n      '));

const CLASS = 'P5 Science — Wednesday 5pm–6.45pm';
await page.evaluate((cls) => {
  window.isAdmin = () => true;
  window.currentUser = { email: 'chungzhikai@gmail.com' };
  window.__awards = [];
  window.rwStudents = ['Ann', 'Ben', 'Cai', 'Dee', 'Eli'].map((n, i) => ({ id: 's' + i, name: n, slots: [cls], marks: 10 }));
  window.rwAwardMarks = async (s, d, reason) => { window.__awards.push({ id: s.id, d, reason }); s.marks += d; };
  localStorage.clear();
  applyRewardVisibility();
}, CLASS);

ok('the Wheel button shows for the teacher', await page.evaluate(() => $('wheelBtn').style.display !== 'none'));
await page.evaluate(() => { window.isAdmin = () => false; applyRewardVisibility(); });
ok('and is hidden when not the teacher', await page.evaluate(() => $('wheelBtn').style.display === 'none'));
await page.evaluate((cls) => {
  window.isAdmin = () => true; applyRewardVisibility();
  // hiding the tools for a non-teacher drops the register, as it should
  window.rwStudents = ['Ann', 'Ben', 'Cai', 'Dee', 'Eli'].map((n, i) => ({ id: 's' + i, name: n, slots: [cls], marks: 10 }));
}, CLASS);

await page.evaluate((cls) => { localStorage.setItem('polymath.wheelClass', cls); }, CLASS);
await page.click('#wheelBtn');
await page.waitForFunction(() => wheelState && wheelState.names.length === 5, null, { timeout: 3000 });
ok('it opens on the class register', await page.evaluate(() => wheelState.names.map(n => n.n).join() === 'Ann,Ben,Cai,Dee,Eli'));
const box0 = await page.evaluate(() => { const r = $('wheelCanvas').getBoundingClientRect(); return { w: r.width, h: r.height }; });
ok('the wheel is drawn square and big enough to read', box0.w > 150 && Math.abs(box0.w - box0.h) < 1, JSON.stringify(box0));

// A round of five: each name once.
const called = [];
for (let i = 0; i < 5; i++) {
  await page.click('#wheelSpinBtn');
  await page.waitForFunction(() => !wheelSpinning, null, { timeout: 8000 });
  called.push(await page.evaluate(() => $('wheelWinner').textContent));
}
ok('five spins call five different students', new Set(called).size === 5, called.join());
ok('the round is complete and says so', await page.evaluate(() => /Round 1 complete/.test($('wheelRound').textContent)));
await page.click('#wheelSpinBtn');
await page.waitForFunction(() => !wheelSpinning);
ok('the next spin opens round 2', await page.evaluate(() => /Round 2 · 1 of 5/.test($('wheelRound').textContent)));

// The pointer ends inside the announced segment: ask the wheel itself.
const landed = await page.evaluate(() => {
  wheelNewRound();
  wheelSpin();
  return new Promise(res => {
    const t = setInterval(() => {
      if (!wheelSpinning) { clearInterval(t);
        const left = wheelRemaining(wheelState).length;
        res({ name: wheelState.names[wheelWinnerIdx].n, shown: $('wheelWinner').textContent, left });
      }
    }, 50);
  });
});
ok('the name shown is the name called', landed.name === landed.shown && landed.left === 4, JSON.stringify(landed));

// Marks.
await page.click('.whAward .rwAmount:nth-of-type(2)');   // +2
await page.waitForFunction(() => window.__awards.length === 1);
const aw = await page.evaluate(() => ({ a: window.__awards[0], w: wheelState.names[wheelWinnerIdx].id }));
ok('+2 reaches the award function for the student on the wheel', aw.a.d === 2 && aw.a.id === aw.w && /Name wheel/.test(aw.a.reason), JSON.stringify(aw));

// Add, remove, persist.
await page.fill('#wheelNewName', 'Zoe');
await page.click('#wheelAddBtn');
ok('a typed name joins the wheel', await page.evaluate(() => wheelState.names.some(n => n.n === 'Zoe')));
await page.click('.whChip:first-child .whChipX');
ok('a name can be taken off', await page.evaluate(() => wheelState.names.length === 5));
await page.evaluate(() => { document.querySelectorAll('.whChip')[0].querySelector('.whChipX').click(); });
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem(wheelStoreKey(wheelClass))));
ok('the names are stored for this class', stored && stored.names.length === 4, JSON.stringify(stored));

// Move and resize.
const head = await page.locator('#wheelHead').boundingBox();
await page.mouse.move(head.x + 40, head.y + 10);
await page.mouse.down(); await page.mouse.move(head.x - 160, head.y + 90, { steps: 6 }); await page.mouse.up();
const moved = await page.evaluate(() => ({ x: wheelWin.x, y: wheelWin.y }));
ok('dragging the title bar moves the window', moved.y > 20 && moved.x < 1100 - 340 - 28, JSON.stringify(moved));
const before = await page.evaluate(() => $('wheelCanvas').getBoundingClientRect().width);
const grip = await page.locator('#wheelGrip').boundingBox();
await page.mouse.move(grip.x + 12, grip.y + 12);
await page.mouse.down(); await page.mouse.move(grip.x - 60, grip.y - 150, { steps: 6 }); await page.mouse.up();
const after = await page.evaluate(() => ({ w: wheelWin.w, h: wheelWin.h, c: $('wheelCanvas').getBoundingClientRect().width }));
ok('dragging the corner makes the window — and the wheel — smaller', after.w < 340 && after.c <= before && after.c >= 150, JSON.stringify({ before, after }));
ok('the window cannot shrink past a usable size', after.w >= 260 && after.h >= 330);

// Minimise keeps the place and names the last pick.
await page.click('#wheelSpinBtn');
await page.waitForFunction(() => !wheelSpinning);
await page.click('#wheelMinBtn');
const mini = await page.evaluate(() => ({ h: $('wheelCard').getBoundingClientRect().height, t: $('wheelTitle').textContent }));
ok('minimised, only the title bar is left and it names the last pick', mini.h < 90 && mini.t !== '🎡 Name wheel', JSON.stringify(mini));
await page.click('#wheelMinBtn');

// Reload: same class, same names, same position.
await page.reload();
await page.waitForTimeout(800);
await page.evaluate((cls) => {
  window.isAdmin = () => true; window.currentUser = { email: 'chungzhikai@gmail.com' };
  window.rwStudents = ['Ann', 'Ben', 'Cai', 'Dee', 'Eli'].map((n, i) => ({ id: 's' + i, name: n, slots: [cls], marks: 10 }));
  applyRewardVisibility();
}, CLASS);
await page.click('#wheelBtn');
await page.waitForFunction(() => wheelState && wheelState.names.length);
const again = await page.evaluate(() => wheelState.names.map(n => n.n).join());
ok('after a reload the names are the ones left, not re-seeded from the register', again === 'Cai,Dee,Eli,Zoe', again);

// A new lesson day clears the calls, keeps the names.
await page.evaluate(() => {
  const k = wheelStoreKey(wheelClass);
  const s = JSON.parse(localStorage.getItem(k)); s.day = '2000-01-01'; s.round = 7;
  s.names.forEach(n => n.done = true);
  localStorage.setItem(k, JSON.stringify(s));
  wheelSetClass(wheelClass);
});
ok('next lesson: same names, nobody called, round 1',
  await page.evaluate(() => wheelState.names.length === 4 && wheelRemaining(wheelState).length === 4 && wheelState.round === 1));

// The page's own shortcuts stay out of the way while typing.
const tool0 = await page.evaluate(() => typeof tool !== 'undefined' ? tool : null);
await page.click('#wheelNewName');
await page.keyboard.type('pen');
const tool1 = await page.evaluate(() => typeof tool !== 'undefined' ? tool : null);
ok('typing a name does not fire tool shortcuts', tool0 === tool1);
await page.keyboard.press('Escape');
ok('Escape closes the window', await page.evaluate(() => !wheelIsOpen()));
ok('no script errors along the way', errors.length === 0, errors.join('\n      '));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
