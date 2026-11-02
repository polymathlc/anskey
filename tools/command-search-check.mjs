/* =====================================================================
   🔎 Command search (v1.170.0) — in a real browser
   ---------------------------------------------------------------------
   `tools/command-search-tests.mjs` pins the matching. This asks the page:
   is the 🔎 search bar on the toolbar (v1.172.0), does a tap on it drop the
   recent buttons down under it, does Ctrl+K (and "/") jump into it — or open
   the centred box when the toolbar is folded away — does typing "lasso" bring the Lasso
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
  const barBox = await page.evaluate(() => {
    const b = document.querySelector('#toolbar .cmdBar');
    const r = b && b.getBoundingClientRect();
    const first = document.querySelector('#toolbar .tGroup');
    return r ? { w: r.width, h: r.height, top: r.top, first: !!first && first.contains(b),
      key: (b.querySelector('.cmdBarKey') || {}).textContent || '',
      ph: b.querySelector('.cmdBarInput').placeholder } : null;
  });
  ok('the 🔎 search bar is on the toolbar, first, wide enough to read', !!barBox && barBox.first && barBox.w >= 200 && barBox.h >= 28, JSON.stringify(barBox));
  ok('the bar says what it is for and how to reach it', !!barBox && /lasso/.test(barBox.ph) && /K$/.test(barBox.key), JSON.stringify(barBox));
  ok('the bar is never offered as a result of itself', await page.evaluate(() => !cmdSearch.collect().some(c => c.el.closest('.cmdBar'))));

  // A tap on the bar: the recent buttons drop down under it.
  await page.evaluate(() => setTool('pen'));
  await page.click('#toolbar .cmdBarInput');
  await page.waitForTimeout(60);
  ok('a tap on the bar opens the list under it', await boxOpen(page) && await page.evaluate(() => cmdSearch.where() === 'docked'));
  const drop = await page.evaluate(() => {
    const b = document.querySelector('#toolbar .cmdBar').getBoundingClientRect();
    const c = document.querySelector('#cmdSearch .cmdCard').getBoundingClientRect();
    return { barL: b.left, barB: b.bottom, l: c.left, t: c.top, r: c.right, bt: c.bottom, w: innerWidth, h: innerHeight,
      field: getComputedStyle(document.querySelector('#cmdSearch .cmdField')).display,
      backdrop: getComputedStyle(document.getElementById('cmdSearch')).backgroundColor };
  });
  ok('the list hangs just under the bar, from its left edge', Math.abs(drop.l - drop.barL) <= 1 && drop.t > drop.barB && drop.t - drop.barB <= 10, JSON.stringify(drop));
  ok('the list is on screen', drop.l >= 0 && drop.r <= drop.w && drop.bt <= drop.h, JSON.stringify(drop));
  ok('under the bar there is no second field and no dimmed backdrop', drop.field === 'none' && /rgba\(0, 0, 0, 0\)|transparent/.test(drop.backdrop), JSON.stringify(drop));
  ok('the bar keeps the focus', await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('cmdBarInput')));
  await page.keyboard.press('Escape');
  ok('Escape shuts the list and gives the keys back to the page', !(await boxOpen(page)) && await page.evaluate(() => !document.activeElement || !document.activeElement.classList.contains('cmdBarInput')));

  await page.keyboard.press('Control+k');
  ok('Ctrl+K opens the search', await boxOpen(page));
  await page.waitForTimeout(50);
  ok('… in the toolbar\'s bar, which has the focus', await page.evaluate(() => cmdSearch.where() === 'docked' && document.activeElement && document.activeElement.classList.contains('cmdBarInput')));
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
  ok('… nor in the bar, which Escape empties', await page.evaluate(() => {
    const b = document.querySelector('#toolbar .cmdBarInput');
    return document.activeElement !== b && b.value === '';
  }));
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
  ok('… and empties the bar', await page.evaluate(() => document.querySelector('#toolbar .cmdBarInput').value === ''));
  ok('no uncaught error along the way', errors.length === 0, errors.join('\n      '));
  await ctx.close();
}


/* ---------- The bar, more closely ---------- */
{
  const { ctx, page, errors } = await open({ width: 1280, height: 860 });
  await page.evaluate(() => setTool('pen'));
  // Typing straight into the bar, letter by letter, as a person would.
  await page.click('#toolbar .cmdBarInput');
  await page.keyboard.type('spin', { delay: 30 });
  let r = await rows(page);
  ok('bar: typing "spin" finds the name wheel', r.length && r[0].key === '#wheelBtn', JSON.stringify(r.slice(0, 3)));
  ok('bar: no letter typed into it reached a tool shortcut', await page.evaluate(() => tool === 'pen'));
  ok('bar: the clear ✕ shows once something is typed', await page.evaluate(() => !document.querySelector('#toolbar .cmdBarClear').hidden));
  ok('bar: the shortcut hint steps aside while typing', await page.evaluate(() => getComputedStyle(document.querySelector('#toolbar .cmdBarKey')).display === 'none'));
  await page.click('#toolbar .cmdBarClear');
  ok('bar: ✕ empties it and keeps the list open on the recent buttons', await page.evaluate(() =>
    document.querySelector('#toolbar .cmdBarInput').value === '' && cmdSearch.isOpen() &&
    document.activeElement === document.querySelector('#toolbar .cmdBarInput')));
  await page.keyboard.type('highlighter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  r = await rows(page);
  ok('bar: ↓ ↑ move through the list and back', r[0] && r[0].active && r[0].key === 'tool:highlight', JSON.stringify(r.slice(0, 2)));
  await page.keyboard.press('Enter');
  ok('bar: Enter presses the highlighter', await page.evaluate(() => tool === 'highlight'));
  ok('bar: after a press it is empty and lets go of the keys', await page.evaluate(() => {
    const b = document.querySelector('#toolbar .cmdBarInput');
    return b.value === '' && document.activeElement !== b && !cmdSearch.isOpen();
  }));

  // A tap anywhere else shuts the list and keeps what was typed.
  await page.click('#toolbar .cmdBarInput');
  await page.keyboard.type('zoom');
  await page.mouse.click(700, 600);
  await page.waitForTimeout(40);
  ok('bar: a tap elsewhere shuts the list', !(await boxOpen(page)));
  ok('bar: … and keeps the word for when it is tapped again', await page.evaluate(() => document.querySelector('#toolbar .cmdBarInput').value === 'zoom'));
  await page.click('#toolbar .cmdBarInput');
  r = await rows(page);
  ok('bar: tapped again, the same matches come back', r.length && r.some(x => x.key === '#zoomInBtn'), JSON.stringify(r.map(x => x.key)));
  await page.keyboard.press('Escape');

  // A press on a toolbar button keeps the focus where it is; the list must still go.
  await page.click('#toolbar .cmdBarInput');
  await page.keyboard.type('undo');
  await page.click('#toolbar [data-tool="pen"]');
  await page.waitForTimeout(40);
  ok('bar: pressing a toolbar button shuts the list', !(await boxOpen(page)));
  ok('bar: … and that button still did its job', await page.evaluate(() => tool === 'pen'));

  // "/" jumps into the bar and is not typed into it.
  await page.evaluate(() => { const b = document.querySelector('#toolbar .cmdBarInput'); b.value = ''; b.blur(); cmdSearch.reset(); });
  await page.keyboard.press('/');
  ok('bar: "/" jumps into the bar', await page.evaluate(() => cmdSearch.where() === 'docked'));
  ok('bar: … and the slash is not typed into it', await page.evaluate(() => document.querySelector('#toolbar .cmdBarInput').value === ''));
  await page.keyboard.press('Control+k');
  ok('bar: Ctrl+K inside the bar shuts it again', !(await boxOpen(page)));
  if (SHOTS) {
    await page.click('#toolbar .cmdBarInput');
    await page.keyboard.type('lasso');
    await page.waitForTimeout(220);
    await page.screenshot({ path: path.join(SHOTS, 'search-bar-lasso.png') });
    await page.keyboard.press('Escape');
  }

  // Toolbar folded away: the shortcut still works, in the centred box.
  await page.evaluate(() => document.body.classList.add('toolbarMin'));
  await page.keyboard.press('Control+k');
  ok('toolbar hidden: Ctrl+K opens the centred box instead', await page.evaluate(() => cmdSearch.where() === 'modal'));
  await page.waitForTimeout(50);
  ok('toolbar hidden: the box\'s own field has the focus', await page.evaluate(() => document.activeElement && document.activeElement.id === 'cmdInput'));
  await page.keyboard.type('calc');
  r = await rows(page);
  ok('toolbar hidden: the box still finds buttons', r.length && r[0].key === '#calcBtn', JSON.stringify(r.slice(0, 3)));
  ok('toolbar hidden: the box has its field and backdrop again', await page.evaluate(() =>
    getComputedStyle(document.querySelector('#cmdSearch .cmdField')).display !== 'none' &&
    !document.getElementById('cmdSearch').classList.contains('cmdDocked')));
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.body.classList.remove('toolbarMin'));
  await page.keyboard.press('Control+k');
  ok('toolbar back: Ctrl+K goes to the bar again', await page.evaluate(() => cmdSearch.where() === 'docked'));
  await page.keyboard.press('Escape');

  // The same person with different buttons keeps the word; another person empties it.
  await page.click('#toolbar .cmdBarInput');
  await page.keyboard.type('pen');
  await page.evaluate(() => applyRoleUI());
  ok('the same person again (applyRoleUI): the word is kept', await page.evaluate(() => document.querySelector('#toolbar .cmdBarInput').value === 'pen'));
  ok('bar: no uncaught error', errors.length === 0, errors.join('\n      '));
  await ctx.close();
}

/* ---------- A 1024px iPad, the teacher's widest toolbar ---------- */
{
  const { ctx, page, errors } = await open({ width: 1024, height: 768 });
  const fit = await page.evaluate(() => {
    const t = document.getElementById('toolbar');
    const b = document.querySelector('#toolbar .cmdBar').getBoundingClientRect();
    return { sw: t.scrollWidth, cw: t.clientWidth, bw: b.width, br: b.right, w: innerWidth };
  });
  ok('iPad: the bar is on screen and the toolbar does not overflow', fit.sw <= fit.cw && fit.br <= fit.w && fit.bw >= 170, JSON.stringify(fit));
  await page.click('#toolbar .cmdBarInput');
  await page.keyboard.type('answer key');
  const c = await page.evaluate(() => {
    const r = document.querySelector('#cmdSearch .cmdCard').getBoundingClientRect();
    return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: innerWidth, h: innerHeight, docked: cmdSearch.where() };
  });
  ok('iPad: the list drops down under the bar, inside the screen', c.docked === 'docked' && c.l >= 0 && c.r <= c.w && c.b <= c.h, JSON.stringify(c));
  const r = await rows(page);
  ok('iPad: "answer key" finds the answer key', r.length && r[0].key === '#keyPdfBtn', JSON.stringify(r.slice(0, 3)));
  if (SHOTS) { await page.waitForTimeout(200); await page.screenshot({ path: path.join(SHOTS, 'search-bar-ipad.png') }); }
  ok('iPad: no uncaught error', errors.length === 0, errors.join('\n      '));
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
  ok('a student has the search bar too', await page.evaluate(() => {
    const b = document.querySelector('#toolbar .cmdBar'); const r = b && b.getBoundingClientRect();
    return !!r && r.width >= 170;
  }));
  await page.click('#toolbar .cmdBarInput');
  await page.keyboard.type('reward');
  const stuRows = await rows(page);
  ok('a student typing "reward" in the bar is offered no reward button', !stuRows.some(x => x.key === '#rewardBtn'), JSON.stringify(stuRows.map(x => x.key)));
  await page.keyboard.press('Escape');
  const marks = await page.evaluate(() => cmdSearch.query('award marks').map(x => x.key));
  ok('searching "award marks" as a student finds no reward button', !marks.includes('#rewardBtn'), marks.join(', '));
  ok('student: no uncaught error', errors.length === 0, errors.join('\n      '));
  await ctx.close();
}

/* ---------- A phone ---------- */
{
  const { ctx, page } = await open({ width: 390, height: 780 });
  const pb = await page.evaluate(() => {
    const b = document.querySelector('#toolbar .cmdBar').getBoundingClientRect();
    const t = document.getElementById('toolbar').getBoundingClientRect();
    return { l: b.left, r: b.right, w: b.width, tw: t.width, fs: getComputedStyle(document.querySelector('#toolbar .cmdBarInput')).fontSize };
  });
  ok('phone: the bar takes a row of its own, full width', pb.w >= pb.tw - 40 && pb.r <= 390, JSON.stringify(pb));
  ok('phone: the field is 16px, so iOS does not zoom the page on a tap', pb.fs === '16px', pb.fs);
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
  await page.mouse.click(5, 770);
  await page.waitForTimeout(40);
  ok('phone: a tap outside the list closes it', !(await boxOpen(page)));
  await ctx.close();
}

await browser.close();
console.log('\ncommand-search-check: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
