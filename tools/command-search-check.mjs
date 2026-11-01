/* =====================================================================
   🔎 Command search (v1.170.0) — in a real browser
   ---------------------------------------------------------------------
   `tools/command-search-tests.mjs` pins the matching. This asks the page:
   does Ctrl+K (and "/") open the box, does typing "lasso" bring the Lasso
   out with its icon and shortcut, does Enter or a click really press it
   (the tool changes), do the letters typed never reach the tool shortcuts
   behind the box, does Escape close it, does a student see none of the
   teacher's buttons, does a role change close it, and does it fit a phone.

     node tools/command-search-check.mjs
     PW=/path/to/playwright/index.mjs node tools/command-search-check.mjs
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) {
  console.log('command-search-check: no Playwright at ' + PW + ' — skipped.');
  process.exit(0);
}

const FILE = pathToFileURL(path.resolve(process.argv[2] || 'index.html')).href;
const SHOTS = process.env.CS_SCREENSHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (note ? '\n      ' + note : '')); }
};

const browser = await chromium.launch();

async function open(viewport, role) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const chain = () => new Proxy(function () { return chain(); }, {
      get: (t, k) => (k === 'then' ? undefined : chain()),
      apply: () => chain(), construct: () => chain(), set: () => true
    });
    window.pdfjsLib = chain(); window.firebase = chain(); window.grecaptcha = chain();
  });
  await page.route(/firebase-[a-z]+-compat\.js(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(FILE);
  await page.waitForTimeout(900);
  await page.evaluate((role) => {
    try { localStorage.clear(); } catch (e) {}
    if (role === 'student') {
      currentUser = { uid: 'stu-1', email: 'kid@example.com' };
      studentProfile = { name: 'Kid', level: 'P5', subject: 'science', days: ['Monday'], slot: 0 };
      try { localStorage.setItem('polymath.studentGuide.v1:stu-1', '1'); } catch (e) {}
    } else {
      currentUser = { uid: 'teacher', email: ADMIN_EMAIL };
    }
    applyRoleUI();
    renderAuthArea();
    if (typeof applyRewardVisibility === 'function') applyRewardVisibility();
    // The student tour opens by itself once; it is not what is being checked.
    const t = document.getElementById('stuTour');
    if (t && !t.hidden && typeof studentGuideClose === 'function') studentGuideClose();
  }, role || 'teacher');
  return { ctx, page, errors };
}

const boxOpen = (page) => page.evaluate(() => { const r = document.getElementById('cmdSearch'); return !!r && !r.hidden; });
const rows = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#cmdSearch .cmdRow')).map(r => ({
  key: r.getAttribute('data-cmd'),
  name: r.querySelector('.cmdName').textContent,
  sub: (r.querySelector('.cmdSub') || {}).textContent || '',
  icon: !!r.querySelector('.cmdIcon svg, .cmdIcon .cmdSwatch') || /\S/.test(r.querySelector('.cmdIcon').textContent),
  kbd: (r.querySelector('.cmdKey') || {}).textContent || '',
  mark: (r.querySelector('mark') || {}).textContent || '',
  active: r.classList.contains('active')
})));

/* ---------- The teacher ---------- */
{
  const { ctx, page, errors } = await open({ width: 1280, height: 860 });
  ok('the page loads with no uncaught error', errors.length === 0, errors.join('\n      '));
  ok('the 🔎 search button is on the toolbar', await page.evaluate(() => {
    const b = document.querySelector('#toolbar .cmdSearchBtn');
    const r = b && b.getBoundingClientRect();
    return !!r && r.width > 0 && r.height > 0;
  }));

  await page.evaluate(() => setTool('pen'));
  await page.keyboard.press('Control+k');
  ok('Ctrl+K opens the search box', await boxOpen(page));
  await page.waitForTimeout(50);
  ok('the field has the focus', await page.evaluate(() => document.activeElement && document.activeElement.id === 'cmdInput'));
  await page.keyboard.type('lasso', { delay: 25 });
  let r = await rows(page);
  ok('typing "lasso" brings the Lasso out first', r.length && r[0].key === 'tool:lasso' && /Lasso/.test(r[0].name), JSON.stringify(r.slice(0, 3)));
  ok('the result shows its icon, where it lives and its shortcut', r[0].icon && /Tools menu/.test(r[0].sub) && r[0].kbd === 'S', JSON.stringify(r[0]));
  ok('the matched letters are marked', /lasso/i.test(r[0].mark));
  ok('typing in the box never fired a tool shortcut behind it', await page.evaluate(() => tool === 'pen'), await page.evaluate(() => tool));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'search-lasso.png') });
  await page.keyboard.press('Enter');
  ok('Enter presses the Lasso — the tool is now the lasso', await page.evaluate(() => tool === 'lasso'));
  ok('and the box has closed', !(await boxOpen(page)));
  ok('no dropdown is left open behind it', await page.evaluate(() => !document.querySelector('.toolbarMenuPanel:not([hidden])')));

  // A click on a result, arrow keys, and a synonym.
  await page.keyboard.press('/');
  ok('"/" opens it too', await boxOpen(page));
  await page.keyboard.type('rubber');
  r = await rows(page);
  ok('"rubber" finds the Eraser', r.length && r[0].key === 'tool:eraser', JSON.stringify(r.slice(0, 3)));
  await page.click('#cmdSearch .cmdRow[data-cmd="tool:eraser"]');
  ok('a click on the result presses it', await page.evaluate(() => tool === 'eraser'));
  ok('a pressed button sitting on screen is flashed', await page.evaluate(() => {
    const b = document.querySelector('#toolbar [data-tool="eraser"]');
    return !!b && b.classList.contains('cmdFlash');
  }));

  await page.keyboard.press('Control+k');
  await page.keyboard.type('print');
  r = await rows(page);
  ok('"print" offers both prints', r.some(x => x.key === '#printQBtn') && r.some(x => x.key === '#printABtn'), JSON.stringify(r.map(x => x.key)));
  await page.keyboard.press('ArrowDown');
  r = await rows(page);
  ok('↓ moves the highlight', r[1] && r[1].active && !r[0].active);
  await page.keyboard.press('Escape');
  ok('Escape closes it without pressing anything', !(await boxOpen(page)) && await page.evaluate(() => tool === 'eraser'));
  ok('the focus never stays inside the closed box', await page.evaluate(() => !document.getElementById('cmdSearch').contains(document.activeElement)));
  await page.keyboard.press('p');
  ok('after closing, the page shortcuts work again (P → pencil)', await page.evaluate(() => tool === 'pen'));
  await page.evaluate(() => setTool('eraser'));

  // Relevance across the toolbar the teacher really has.
  const q = async (s) => (await page.evaluate((s) => cmdSearch.query(s), s)).map(x => x.key);
  const expect = {
    'pen': 'tool:pen', 'highlight': 'tool:highlight', 'spin names': '#wheelBtn', 'mind map': '#mmBtn',
    'print answers': '#printABtn', 'print worksheet': '#printQBtn', 'answer key': '#keyPdfBtn',
    'new page': '#blankPageBtn', 'calculator': '#calcBtn', 'lasoo': 'tool:lasso', 'marks': '#rewardBtn',
    'full screen': '#fsBtn', 'undo': '#undoBtn', 'open pdf': '#uploadBtn', 'screenshot': '#snipBtn',
    'select many': 'tool:lasso', 'circle': 'tool:ellipse', 'save': '#saveBtn', 'share': '#shareBtn'
  };
  const misses = [];
  for (const [s, k] of Object.entries(expect)) { const got = await q(s); if (got[0] !== k) misses.push(s + ' → ' + got.slice(0, 3).join(', ')); }
  ok('real toolbar: ' + Object.keys(expect).length + ' everyday searches land on the right button first', !misses.length, misses.join('\n      '));
  ok('a nonsense word finds nothing', (await q('zzqx')).length === 0);

  await page.keyboard.press('Control+k');
  await page.keyboard.type('qqqzz');
  ok('no match says so in words', await page.evaluate(() => {
    const e = document.getElementById('cmdEmpty'); return !e.hidden && /No button matches/.test(e.textContent);
  }));
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+k');
  const recent = await rows(page);
  ok('an empty box offers what was used recently', recent.length >= 2 && recent[0].key === 'tool:eraser' && recent.some(x => x.key === 'tool:lasso'), JSON.stringify(recent.map(x => x.key)));
  // A role change closes it.
  await page.evaluate(() => { currentUser = { uid: 'stu-9', email: 'x@example.com' }; applyRoleUI(); });
  ok('a change of person closes the box', !(await boxOpen(page)));
  ok('no uncaught error along the way', errors.length === 0, errors.join('\n      '));
  await ctx.close();
}

/* ---------- A student ---------- */
{
  const { ctx, page, errors } = await open({ width: 1280, height: 860 }, 'student');
  const keys = await page.evaluate(() => cmdSearch.collect().map(c => c.key));
  const teacherOnly = ['#rewardBtn', '#wheelBtn', '#saveBtn', '#shareBtn', '#uploadBtn', '#notesBtn', '#keyPdfBtn', '#deletePageBtn'];
  const leaked = teacherOnly.filter(k => keys.includes(k));
  ok('a student is offered none of the teacher\'s buttons', !leaked.length, leaked.join(', '));
  ok('a student can still find their own buttons', keys.length > 5, keys.join(', '));
  const marks = await page.evaluate(() => cmdSearch.query('award marks').map(x => x.key));
  ok('searching "award marks" as a student finds no reward button', !marks.includes('#rewardBtn'), marks.join(', '));
  ok('student: no uncaught error', errors.length === 0, errors.join('\n      '));
  await ctx.close();
}

/* ---------- A phone ---------- */
{
  const { ctx, page } = await open({ width: 390, height: 780 });
  await page.evaluate(() => cmdSearchOpen());
  await page.keyboard.type('zoom');
  const fit = await page.evaluate(() => {
    const c = document.querySelector('#cmdSearch .cmdCard').getBoundingClientRect();
    return { left: c.left, right: c.right, top: c.top, bottom: c.bottom, w: innerWidth, h: innerHeight,
      rows: document.querySelectorAll('#cmdSearch .cmdRow').length };
  });
  ok('phone: the box fits the screen', fit.left >= 0 && fit.right <= fit.w && fit.top >= 0 && fit.bottom <= fit.h, JSON.stringify(fit));
  ok('phone: results show', fit.rows >= 2);
  await page.waitForTimeout(250);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'search-phone.png') });
  await page.click('#cmdSearch', { position: { x: 5, y: 770 } });
  ok('phone: a tap outside the box closes it', !(await boxOpen(page)));
  await ctx.close();
}

await browser.close();
console.log('\ncommand-search-check: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
