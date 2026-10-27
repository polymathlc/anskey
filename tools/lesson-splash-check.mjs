/* =====================================================================
   🏰 LESSON START — in a real browser
   ---------------------------------------------------------------------
   The unit tests prove the helpers. What they cannot prove is what was
   asked for: that only the teacher gets the button, that the cover really
   is peppered with hero and boss stickers that keep clear of the title,
   that a tap swings a gate shut ACROSS the screen and opens it onto the
   rules, that the rules can be edited and are kept (on the device and in
   the account) through a reload, and that a role change takes it away.

     node tools/lesson-splash-check.mjs
     PW=/path/to/playwright/index.mjs node tools/lesson-splash-check.mjs
     LS_SCREENSHOTS=/some/dir   (writes cover / gate / board / edit / phone)
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) {
  console.log('lesson-splash-check: no Playwright at ' + PW + ' — skipped.');
  process.exit(0);
}

const FILE = pathToFileURL(path.resolve(process.argv[2] || 'index.html')).href;
const SHOTS = process.env.LS_SCREENSHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (note ? '\n      ' + note : '')); }
};
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

const browser = await chromium.launch();

async function boot(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const chain = () => new Proxy(function () { return chain(); }, {
      get: (t, k) => (k === 'then' ? undefined : chain()),
      apply: () => chain(), construct: () => chain(), set: () => true
    });
    window.pdfjsLib = chain(); window.firebase = chain(); window.grecaptcha = chain();
  });
  await page.route(/firebase-[a-z]+-compat\.js(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  // No network for the pixel face: the board must still work in a fallback font.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.fulfill({ contentType: 'text/css', body: '' }));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(FILE);
  await page.waitForTimeout(700);
  /* The teacher signs in. The account's settings record is an in-memory
     stand-in that remembers what was written, as Firestore would. */
  await page.evaluate((store) => {
    window.__lsCloud = store ? JSON.parse(store) : {};
    window.__lsWrites = 0;
    aiEngineDocRef = function () {
      return {
        get: () => Promise.resolve({ exists: true, data: () => JSON.parse(JSON.stringify(window.__lsCloud)) }),
        set: (d, o) => { window.__lsWrites++; window.__lsCloud = Object.assign({}, o && o.merge ? window.__lsCloud : {}, JSON.parse(JSON.stringify(d))); return Promise.resolve(); }
      };
    };
    currentUser = { uid: 'teacher-1', email: 'chungzhikai@gmail.com' };
    actingStudent = null;
    applyRewardVisibility();
  }, opts.cloud || null);
  return { ctx, page, errors };
}

async function waitFor(page, fn, arg, ms = 5000) {
  try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; }
  catch (e) { return false; }
}

/* ------------------------------------------------------------ desktop */
{
  console.log('Teacher on a 1280 × 800 screen');
  const { ctx, page, errors } = await boot({ width: 1280, height: 800 });
  ok('the header shows 🏰 Lesson start to the teacher', await page.$eval('#lessonSplashBtn', b => getComputedStyle(b).display !== 'none'));
  ok('the module is loaded and wired', await page.evaluate(() => !!(window.LessonSplash && lsplash)));

  await page.click('#lessonSplashBtn');
  ok('the cover opens', await waitFor(page, () => { const b = document.getElementById('lessonSplash'); return b && b.classList.contains('in'); }));
  await waitFor(page, () => document.querySelectorAll('[data-ls-stickers="cover"] .lsSticker').length > 0);
  await page.waitForTimeout(1500); // the stickers slap on, one after another
  const cover = await page.evaluate(() => {
    const back = document.getElementById('lessonSplash');
    const r = back.getBoundingClientRect();
    const title = back.querySelector('.lsCoverTitle').getBoundingClientRect();
    const stickers = [...back.querySelectorAll('[data-ls-stickers="cover"] .lsSticker')];
    const kinds = new Set(stickers.map(s => s.dataset.kind));
    const sheets = stickers.map(s => s.dataset.sheet);
    const clash = stickers.filter(s => {
      const b = s.getBoundingClientRect();
      // A sticker's box includes the sprite's own padding; its middle half
      // is the picture, and that must stay off the title.
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2, q = b.width / 4;
      return cx + q > title.left && cx - q < title.right && cy + q > title.top && cy - q < title.bottom;
    }).length;
    const off = stickers.filter(s => { const b = s.getBoundingClientRect(); return b.left < -b.width * 0.2 || b.top < -b.height * 0.2 || b.right > r.width + b.width * 0.2 || b.bottom > r.height + b.height * 0.2; }).length;
    const filter = stickers.length ? getComputedStyle(stickers[0]).filter : '';
    const rot = stickers.map(s => getComputedStyle(s).getPropertyValue('--rot')).filter(v => v && parseFloat(v) !== 0).length;
    return { n: stickers.length, kinds: [...kinds], sheets, clash, off, filter, rot,
      head: back.querySelector('.lsCoverHead').textContent, date: back.querySelector('.lsDate').textContent,
      covers: r.width === innerWidth && r.height === innerHeight,
      z: +getComputedStyle(back).zIndex };
  });
  ok('the cover fills the screen, above everything', cover.covers && cover.z >= 5000, JSON.stringify({ covers: cover.covers, z: cover.z }));
  ok('it says Today\'s Quest and today\'s date', cover.head === "Today's Quest" && /\d/.test(cover.date), cover.head + ' / ' + cover.date);
  ok('it is peppered with plenty of stickers (' + cover.n + ')', cover.n >= 12);
  ok('heroes, bosses and Chung are all among them', ['hero', 'boss', 'chung'].every(k => cover.kinds.includes(k)), cover.kinds.join(','));
  ok('every sticker is the existing Wheel Quest artwork', cover.sheets.every(s => /^assets\/battle-pixel\/(animations\/[a-z]+-(genders-)?sheet|bosses\/atlas-\d\d)\.png$/.test(s)), cover.sheets.find(s => !/^assets/.test(s)));
  ok('no sticker sits on the title', cover.clash === 0, cover.clash + ' clash');
  ok('no sticker hangs off the screen', cover.off === 0);
  ok('they have the die-cut white outline and shadow', /drop-shadow/.test(cover.filter) && /255, 255, 255/.test(cover.filter), cover.filter);
  ok('they are tilted, like stickers slapped on', cover.rot >= Math.floor(cover.n * 0.6));
  const loaded = await page.evaluate(async () => {
    const urls = [...new Set([...document.querySelectorAll('#lessonSplash .lsSticker')].map(s => s.dataset.sheet))];
    const res = await Promise.all(urls.map(u => new Promise(r => { const i = new Image(); i.onload = () => r(i.naturalWidth > 0); i.onerror = () => r(false); i.src = u; })));
    return res.every(Boolean) && res.length > 0;
  });
  ok('every sticker sheet actually loads', loaded);
  await shot(page, 'cover-desktop');

  // The worksheet's one-letter shortcuts must not fire under the board.
  const leaked = await page.evaluate(() => {
    let hit = 0;
    const spy = () => { hit++; };
    document.addEventListener('keydown', spy);
    document.getElementById('lessonSplash').dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
    document.removeEventListener('keydown', spy);
    return hit;
  });
  ok('a key pressed on the board stays on the board', leaked === 0);

  // ---- the gate
  await page.click('.lsCover', { position: { x: 640, y: 380 } });
  await page.waitForTimeout(950);
  const shut = await page.evaluate(() => {
    const gate = document.querySelector('#lessonSplash .lsGate');
    const L = gate.querySelector('.lsDoorL').getBoundingClientRect();
    const R = gate.querySelector('.lsDoorR').getBoundingClientRect();
    const bar = gate.querySelector('.lsBar').getBoundingClientRect();
    return { visible: !gate.hidden, L: [L.left, L.right], R: [R.left, R.right], barTop: bar.top, barH: bar.height, w: innerWidth, h: innerHeight };
  });
  ok('the gate is showing', shut.visible);
  ok('both doors have closed across the whole screen', shut.L[0] <= 10 && shut.R[1] >= shut.w - 10 && shut.L[1] >= shut.R[0] - 1, JSON.stringify(shut));
  await page.waitForTimeout(250);
  const barred = await page.evaluate(() => {
    const bar = document.querySelector('#lessonSplash .lsBar').getBoundingClientRect();
    return Math.abs(bar.top + bar.height / 2 - innerHeight / 2);
  });
  ok('the bar has dropped across the middle', barred < 6, 'off by ' + barred);
  await shot(page, 'gate-shut');
  ok('the rules are behind the gate already', await page.evaluate(() => !document.querySelector('#lessonSplash .lsBoardScene').hidden && document.querySelector('#lessonSplash .lsCover').hidden));
  ok('the gate opens again and goes away', await waitFor(page, () => document.querySelector('#lessonSplash .lsGate').hidden, null, 4000));
  await page.waitForTimeout(1600);
  const board = await page.evaluate(() => {
    const back = document.getElementById('lessonSplash');
    const card = back.querySelector('.lsBoard').getBoundingClientRect();
    const rules = [...back.querySelectorAll('.lsRule')].map(li => li.innerText.replace(/\s+/g, ' ').trim());
    const stickers = [...back.querySelectorAll('[data-ls-stickers="board"] .lsSticker')];
    const clash = stickers.filter(s => {
      const b = s.getBoundingClientRect();
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2, q = b.width / 4;
      return cx + q > card.left && cx - q < card.right && cy + q > card.top && cy - q < card.bottom;
    }).length;
    return { rules, n: stickers.length, clash, title: back.querySelector('.lsBoardTitle').textContent, inside: card.left >= 0 && card.right <= innerWidth && card.top >= 0 && card.bottom <= innerHeight };
  });
  ok('the rules heading shows', board.title === 'Quest rules', board.title);
  ok('the online students\' rule is there, with its 2 points', /Online students/i.test(board.rules[0] || '') && /camera for the whole lesson/i.test(board.rules[0]) && /\+2 points/.test(board.rules[0]), board.rules[0]);
  ok('the physical students\' rule is there, with its 2 points', /Physical students/i.test(board.rules[1] || '') && /focus and keep quiet/i.test(board.rules[1]) && /\+2 points/.test(board.rules[1]), board.rules[1]);
  ok('the homework line is there, with no reward', /homework, if any/i.test(board.rules[2] || '') && !/points/.test(board.rules[2]), board.rules[2]);
  ok('the board is peppered with stickers too (' + board.n + ')', board.n >= 8);
  ok('and none of them sits on the rules', board.clash === 0, board.clash + ' clash');
  ok('the rules fit on the screen', board.inside);
  await shot(page, 'board-desktop');

  // ---- editing
  await page.click('[data-ls="edit"]');
  ok('✎ Edit opens the form', await page.$$eval('#lessonSplash .lsFormRow', r => r.length === 3));
  await page.fill('#lessonSplash .lsFormRow[data-row="2"] [data-f="text"]', 'Copy the homework from the board: Practice 4B, questions 1 to 6.');
  await page.click('#lessonSplash [data-ls="add"]');
  await page.fill('#lessonSplash .lsFormRow[data-row="3"] [data-f="icon"]', '🏆');
  await page.fill('#lessonSplash .lsFormRow[data-row="3"] [data-f="who"]', 'Top scorer');
  await page.fill('#lessonSplash .lsFormRow[data-row="3"] [data-f="text"]', 'Highest marks in today\'s quiz.');
  await page.fill('#lessonSplash .lsFormRow[data-row="3"] [data-f="reward"]', '+5 points');
  await page.click('#lessonSplash .lsFormRow[data-row="3"] [data-ls="up"]');
  ok('moving a line keeps what was typed in every line', await page.$eval('#lessonSplash .lsFormRow[data-row="3"] [data-f="text"]', t => /Practice 4B/.test(t.value)));
  await page.fill('#lessonSplash [data-top="title"]', 'This lesson\'s rules');
  await shot(page, 'edit-desktop');
  await page.click('#lessonSplash [data-ls="save"]');
  ok('saving goes back to the board', await waitFor(page, () => !document.querySelector('#lessonSplash .lsEditing') && document.querySelectorAll('#lessonSplash .lsRule').length === 4));
  const after = await page.evaluate(() => ({
    rules: [...document.querySelectorAll('#lessonSplash .lsRule')].map(li => li.innerText.replace(/\s+/g, ' ').trim()),
    title: document.querySelector('#lessonSplash .lsBoardTitle').textContent,
    cloud: window.__lsCloud.lessonSplash, writes: window.__lsWrites,
    kept: JSON.parse(localStorage.getItem('polymath.lessonSplash.v1:teacher-1') || 'null')
  }));
  ok('the board shows the new heading', after.title === 'This lesson\'s rules');
  ok('the new line is where it was moved to', /Top scorer/i.test(after.rules[2]) && /\+5 points/.test(after.rules[2]) && /Practice 4B/.test(after.rules[3]), after.rules.join(' | '));
  ok('it was saved to the account', after.writes === 1 && after.cloud && after.cloud.items.length === 4 && after.cloud.title === 'This lesson\'s rules');
  ok('the save left the rest of the settings record alone', await page.evaluate(() => window.__lsCloud.lessonSplash && Object.keys(window.__lsCloud).length === 1));
  ok('and kept on this device', after.kept && after.kept.items.length === 4);
  await page.waitForTimeout(1300);
  ok('four lines still fit one screen with no scrolling', await page.$eval('#lessonSplash .lsBoard', b => b.scrollHeight <= b.clientHeight + 1));
  await shot(page, 'board-edited');

  // Cancel throws away what was typed.
  await page.click('[data-ls="edit"]');
  await page.fill('#lessonSplash [data-top="title"]', 'Not this');
  await page.keyboard.press('Escape');
  ok('Escape in the form cancels it, not the board', await page.evaluate(() => !!document.getElementById('lessonSplash') && document.querySelector('#lessonSplash .lsBoardTitle').textContent === 'This lesson\'s rules'));
  // An empty board cannot be saved.
  await page.click('[data-ls="edit"]');
  for (let i = 0; i < 3; i++) await page.click('#lessonSplash .lsFormRow[data-row="0"] [data-ls="remove"]');
  await page.fill('#lessonSplash .lsFormRow[data-row="0"] [data-f="who"]', '');
  await page.fill('#lessonSplash .lsFormRow[data-row="0"] [data-f="text"]', '   ');
  await page.click('#lessonSplash [data-ls="save"]');
  ok('an empty board is refused in words', await page.$eval('#lessonSplash .lsFormMsg', m => /at least one line/i.test(m.textContent)));
  ok('and nothing was written', await page.evaluate(() => window.__lsWrites === 1));
  await page.click('#lessonSplash [data-ls="cancel"]');

  // ↺ goes back to the cover; Escape closes.
  await page.click('[data-ls="replay"]');
  ok('↺ goes back to the cover for the next class', await page.evaluate(() => !document.querySelector('#lessonSplash .lsCover').hidden && lsplash.phase() === 'cover'));
  await page.keyboard.press('Escape');
  ok('Escape closes it', await waitFor(page, () => !document.getElementById('lessonSplash')));

  // A handover to a student closes it and hides the button.
  await page.click('#lessonSplashBtn');
  await waitFor(page, () => !!document.getElementById('lessonSplash'));
  await page.evaluate(() => { actingStudent = { id: 's1', name: 'A student' }; applyRewardVisibility(); });
  ok('handing the device to a student closes the board', await waitFor(page, () => !document.getElementById('lessonSplash')));
  ok('and hides the button', await page.$eval('#lessonSplashBtn', b => getComputedStyle(b).display === 'none'));
  ok('and the module refuses to open for them', await page.evaluate(() => { lsplashOpen(); return lsplash.open() === false && !document.getElementById('lessonSplash'); }));
  ok('no page errors', errors.length === 0, errors.join('\n'));

  // ---- a reload (a new device) reads the account's copy
  const cloud = await page.evaluate(() => JSON.stringify(window.__lsCloud));
  await ctx.close();
  console.log('Another device, signed in as the teacher');
  const two = await boot({ width: 1280, height: 800 }, { cloud });
  await two.page.click('#lessonSplashBtn');
  await waitFor(two.page, () => !!document.getElementById('lessonSplash'));
  await two.page.waitForTimeout(150);
  ok('the edited rules arrive from the account', await two.page.evaluate(() => { const d = lsplash.data(); return d && d.items.length === 4 && d.title === 'This lesson\'s rules'; }));
  await two.page.evaluate(() => { currentUser = null; applyRewardVisibility(); });
  ok('signing out closes it', await waitFor(two.page, () => !document.getElementById('lessonSplash')));
  ok('no page errors', two.errors.length === 0, two.errors.join('\n'));
  await two.ctx.close();
}

/* ------------------------------------------------------------ a phone and an iPad */
for (const [label, vp] of [['an iPad', { width: 1024, height: 768 }], ['a phone', { width: 390, height: 760 }]]) {
  console.log('Teacher on ' + label);
  const { ctx, page, errors } = await boot(vp);
  await page.evaluate(() => lsplashOpen());
  await waitFor(page, () => document.querySelectorAll('#lessonSplash [data-ls-stickers="cover"] .lsSticker').length > 0);
  const n = await page.$$eval('#lessonSplash [data-ls-stickers="cover"] .lsSticker', s => s.length);
  ok('the cover still has stickers (' + n + ')', n >= 4);
  await page.waitForTimeout(1200);
  await shot(page, 'cover-' + vp.width);
  await page.keyboard.press('Enter');
  ok('Enter opens the gate too', await waitFor(page, () => lsplash.phase() === 'board'));
  await waitFor(page, () => document.querySelector('#lessonSplash .lsGate').hidden, null, 4000);
  await page.waitForTimeout(1400);
  const fit = await page.evaluate(() => {
    const c = document.querySelector('#lessonSplash .lsBoard').getBoundingClientRect();
    return c.left >= 0 && c.right <= innerWidth + 0.5 && document.documentElement.scrollWidth <= innerWidth;
  });
  ok('the rules fit the width with no sideways scroll', fit);
  await shot(page, 'board-' + vp.width);
  await page.click('[data-ls="edit"]');
  const formFit = await page.evaluate(() => [...document.querySelectorAll('#lessonSplash .lsF input, #lessonSplash .lsF textarea')].every(i => { const r = i.getBoundingClientRect(); return r.right <= innerWidth + 0.5 && r.left >= 0; }));
  ok('the form fits too', formFit);
  await shot(page, 'edit-' + vp.width);
  ok('no page errors', errors.length === 0, errors.join('\n'));
  await ctx.close();
}

/* ------------------------------------------------------------ reduced motion */
{
  console.log('Reduced motion');
  const { ctx, page, errors } = await boot({ width: 1100, height: 760 }, { reduced: true });
  await page.evaluate(() => lsplashOpen());
  await waitFor(page, () => !!document.getElementById('lessonSplash'));
  await page.click('.lsCover', { position: { x: 550, y: 380 } });
  ok('the rules show at once, with no gate', await page.evaluate(() => lsplash.phase() === 'board' && document.querySelector('#lessonSplash .lsGate').hidden));
  ok('no page errors', errors.length === 0, errors.join('\n'));
  await ctx.close();
}

await browser.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
