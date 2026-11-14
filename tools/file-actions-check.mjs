/* =====================================================================
   🖱 Right-click actions on worksheets (v1.199.0) — in a real browser
   ---------------------------------------------------------------------
   `tools/file-actions-tests.mjs` pins the rules. This asks the page: does
   right-clicking a worksheet card (and pressing and holding it with a
   finger) open the teacher's menu, and only the teacher's? Do Upload,
   Match, Upload a PDF, the answer key list and Delete reach the glue with
   the right worksheet — and do Delete and Remove ALWAYS stop at a
   confirmation first, with Cancel doing nothing? Does it fit a phone?
   The Firebase work itself is stubbed: what is checked is that each
   action reaches its door with the right arguments, and only after a yes.

     node tools/file-actions-check.mjs
     PW=/path/to/playwright/index.mjs node tools/file-actions-check.mjs
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) {
  console.log('file-actions-check: no Playwright at ' + PW + ' — skipped.');
  process.exit(0);
}

const FILE = pathToFileURL(path.resolve(process.argv[2] || 'index.html')).href;
const SHOTS = process.env.FA_SCREENSHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (note ? '\n      ' + note : '')); }
};
async function shot(page, name) {
  if (!SHOTS) return;
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, name) });
}

const browser = await chromium.launch();

async function open(viewport, extra) {
  const ctx = await browser.newContext(Object.assign({ viewport }, extra || {}));
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const chain = () => new Proxy(function () { return chain(); }, {
      get: (t, k) => (k === 'then' ? undefined : chain()),
      apply: () => chain(), construct: () => chain(), set: () => true
    });
    window.pdfjsLib = chain(); window.firebase = chain(); window.grecaptcha = chain();
  });
  await page.route(/firebase-[a-z]+-compat\.js(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  const errors = [], dialogs = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  await page.goto(FILE);
  await page.waitForTimeout(900);
  return { ctx, page, errors, dialogs };
}


/* A Monday 5pm P5 Maths class of four worksheets on worksheet 2, a loose
   worksheet that belongs to no class, and stubs that record every call. */
function seed() {
  return ({ role }) => {
    const key = (doc, day) => 'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/' +
      encodeURIComponent('pdf-annotator/lesson-key-' + doc + '-' + day + '.pdf') + '?alt=media&token=0f1e2d3c-4b5a-6978-8a9b-acbdcedf0011';
    window.__calls = [];
    const rec = (name) => function () { window.__calls.push({ name, args: Array.prototype.slice.call(arguments).map(a => (a && a.name && a.size != null) ? { file: a.name, size: a.size } : (typeof a === 'function' ? 'fn' : a)) }); return Promise.resolve(name + ' done'); };
    // The Firebase doors, stubbed BEFORE the menu is first built (it keeps them).
    faUploadNow = rec('upload'); faUploadPdf = rec('uploadPdf'); faMatch = rec('match');
    faRemoveKey = rec('removeKey'); faDeleteWorksheet = rec('remove');
    faFresh = (id) => Promise.resolve((qDocs.find(d => d.id === id) || {}).data || null);
    faLibrary = () => Promise.resolve(qDocs.slice());
    fa = null;
    const ids = ['ws1', 'ws2', 'ws3', 'ws4'];
    onlineCourses = {
      k1: { id: 'k1', title: 'P5 Maths · Monday 5pm', level: 'P5', subject: 'math', day: 'Monday', slot: 1,
        worksheetIds: ids.slice(), currentIndex: 1, releasedThrough: 3 }
    };
    onlineCoursesLoaded = true;
    const docs = ids.map((id, i) => ({ id, data: {
      name: 'Term 4 · Worksheet ' + (i + 1), wsDay: 'Monday', wsSlot: 1, level: 'P5', subject: 'math', storagePath: 'pdf-annotator/' + id + '.pdf',
      pageCount: 4, onlineCourseId: 'k1', onlineSeq: i, listOrder: i,
      annotations: JSON.stringify(i === 1 ? [{ id: 'p', type: 'pen', page: 1 }, { id: 'r1', type: 'video', url: 'https://v/1', ts: 1, lessonRecording: { duration: 1 } }] : []),
      answerKeys: i === 1 ? { '2026-11-09': { url: key('ws2', '2026-11-09'), pages: 4, videos: 1, at: 1 }, '2026-11-02': { url: key('ws2', '2026-11-02'), pages: 4, manual: true, file: 'scan.pdf' } } : {}
    } }));
    docs.push({ id: 'loose', data: { name: 'Extra practice (not in a class list)', wsDay: 'Monday', wsSlot: 1, level: 'P5', subject: 'math', pageCount: 2, wsDate: '2026-11-02', storagePath: 'pdf-annotator/loose.pdf',
      annotations: JSON.stringify([{ id: 'p', type: 'pen', page: 1 }]) } });
    if (role === 'student') {
      currentUser = { uid: 'stu-1', email: 'kid@example.com' };
      studentProfile = { name: 'Kid', level: 'P5', subject: 'math', days: ['Monday'], slot: 1 };
    } else {
      currentUser = { uid: 'teacher', email: ADMIN_EMAIL };
      studentProfile = null;
    }
    qDocs = docs;
    actingStudent = null;
    try { applyRoleUI(); } catch (e) {}
    qSubjectFilter = 'all';
    qDayFilter = 'Monday';
    $('qDrawer').classList.add('open');
    renderQuestionList();
    const head = document.querySelector('#qList .qSlotSection[data-slot="1"] .qSlotHead');
    const sec = document.querySelector('#qList .qSlotSection[data-slot="1"]');
    if (head && sec && sec.classList.contains('collapsed')) head.click();
    document.getElementById('qList').scrollTop = 0;
  };
}

const card = (id) => '#qList .qItemRow[data-qid="' + id + '"] .qItem';
const menuState = () => {
  const m = document.querySelector('.faMenu');
  if (!m) return null;
  return {
    name: (m.querySelector('.faMenuName') || {}).textContent,
    sub: (m.querySelector('.faMenuSub') || {}).textContent,
    note: !!m.querySelector('.faMenuNote'),
    items: Array.prototype.map.call(m.querySelectorAll('.faMenuItem'), b => ({ id: b.getAttribute('data-fa'), off: b.disabled, text: b.textContent }))
  };
};
const win = () => {
  const b = document.querySelector('.faBack');
  if (!b || b.hidden) return null;
  return { cls: b.querySelector('.faCard').className, title: (b.querySelector('.faTitle') || {}).textContent, text: b.textContent };
};
const calls = () => window.__calls;

/* ---------- The teacher, with a mouse ---------- */
{
  const { ctx, page, errors, dialogs } = await open({ width: 1280, height: 900 });
  ok('the page loads with no uncaught error', errors.length === 0, errors.join('\n      '));
  await page.evaluate(seed(), { role: 'teacher'});

  await page.click(card('ws2'), { button: 'right' });
  let m = await page.evaluate(menuState);
  ok('right-click opens the menu', !!m);
  ok('the menu names the worksheet', m && m.name === 'Term 4 · Worksheet 2', m && m.name);
  ok('and says where it is in its class', m && /P5 Maths · Monday 5pm · worksheet 2 of 4 · Current worksheet/.test(m.sub), m && m.sub);
  ok('and what it carries', m && /✍ answer key · 📄 2 PDFs online · 🎬 1 video/.test(m.sub), m && m.sub);
  ok('every action is there', m && m.items.map(i => i.id).join() === 'open,upload-all,upload-key,upload-videos,upload-pdf,match,keys,delete', m && m.items.map(i => i.id).join());
  await shot(page, 'menu-class-worksheet.png');

  await page.click('.faMenuItem[data-fa="upload-all"]');
  await page.waitForTimeout(150);
  let c = await page.evaluate(calls);
  ok('⬆ Upload answer key + videos reaches the glue for that worksheet', c.length === 1 && c[0].name === 'upload' && c[0].args[0].id === 'ws2' && c[0].args[1].answers === true && c[0].args[1].videos === true, JSON.stringify(c));
  ok('the menu closes after a choice', !(await page.evaluate(menuState)));

  await page.click(card('ws2'), { button: 'right' });
  await page.click('.faMenuItem[data-fa="upload-videos"]');
  await page.waitForTimeout(150);
  c = await page.evaluate(calls);
  ok('🎬 Upload videos only asks for videos and not the key', c[1] && c[1].args[1].videos === true && c[1].args[1].answers === false, JSON.stringify(c[1]));

  // The loose worksheet: no class, no videos.
  await page.click(card('loose'), { button: 'right' });
  m = await page.evaluate(menuState);
  ok('a worksheet in no class says so and points to Match', m && /Not in a Polymath Online class list/.test(m.sub) && m.note, m && m.sub);
  ok('with no videos, Upload videos only is off', m && m.items.find(i => i.id === 'upload-videos').off === true);
  await shot(page, 'menu-loose-worksheet.png');
  await page.keyboard.press('Escape');
  ok('Escape closes the menu', !(await page.evaluate(menuState)));

  /* 🔗 Match */
  await page.click(card('loose'), { button: 'right' });
  await page.click('.faMenuItem[data-fa="match"]');
  await page.waitForTimeout(250);
  let w = await page.evaluate(win);
  ok('🔗 Match opens its window', w && /faCard-match/.test(w.cls), w && w.cls);
  const groups = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('.faGroupTitle'), g => g.textContent));
  ok('the picker lists the class list', groups.join() === 'P5 Maths · Monday 5pm', groups.join());
  const goOff = await page.evaluate(() => document.querySelector('[data-fa="match-go"]').disabled);
  ok('Match is off until a worksheet is chosen', goOff === true);
  await page.click('.faPickRow:has([data-pick="ws3"])');
  let goText = await page.evaluate(() => document.querySelector('[data-fa="match-go"]').textContent);
  ok('choosing one turns Match on and says what goes', /^Match the answer key$/.test(goText), goText);
  await page.fill('.faSearch', 'worksheet 3');
  const searched = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('.faPickRow [data-pick]'), r => r.getAttribute('data-pick')));
  ok('the search narrows the list', searched.join() === 'ws3', searched.join());
  await page.fill('.faSearch', '');
  await page.check('.faAllToggle input');
  const groups2 = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('.faGroupTitle'), g => g.textContent));
  ok('“Also worksheets not in a class” adds the rest (never the worksheet itself)', groups2.length === 1 || !(await page.evaluate(() => !!document.querySelector('[data-pick="loose"]'))), groups2.join());
  await page.click('[data-fa="dir-take"]');
  const explain = await page.evaluate(() => document.querySelector('.faCard-match .faHint').textContent);
  ok('the direction can be turned round', /comes to “Extra practice/.test(explain), explain);
  await page.click('[data-fa="dir-send"]');
  await shot(page, 'match-window.png');
  await page.click('[data-fa="match-go"]');
  await page.waitForTimeout(150);
  w = await page.evaluate(win);
  ok('Match asks first', w && /faCard-confirm/.test(w.cls) && /Match these two worksheets\?/.test(w.title), w && w.title);
  await shot(page, 'match-confirm.png');
  await page.click('[data-fa="confirm-no"]');
  await page.waitForTimeout(150);
  w = await page.evaluate(win);
  c = await page.evaluate(calls);
  ok('No goes back to the window, nothing matched', w && /faCard-match/.test(w.cls) && !c.some(x => x.name === 'match'));
  const kept = await page.evaluate(() => { const r = document.querySelector('[data-pick="ws3"]'); return !!(r && r.checked); });
  ok('…with the choice still made', kept);
  await page.click('[data-fa="match-go"]');
  await page.click('[data-fa="confirm-yes"]');
  await page.waitForTimeout(250);
  c = await page.evaluate(calls);
  const mc = c.find(x => x.name === 'match');
  ok('Yes matches this worksheet → the chosen one', mc && mc.args[0] === 'loose' && mc.args[1] === 'ws3' && mc.args[2].answers === true && mc.args[3].refresh === true, JSON.stringify(mc));
  ok('and the window closes', !(await page.evaluate(win)));

  /* 📎 Upload a PDF */
  await page.click(card('ws3'), { button: 'right' });
  await page.click('.faMenuItem[data-fa="upload-pdf"]');
  await page.waitForTimeout(250);
  w = await page.evaluate(win);
  ok('📎 opens the upload window', w && /faCard-upload/.test(w.cls));
  const pre = await page.evaluate(() => { const r = document.querySelector('[data-pick="ws3"]'); return !!(r && r.checked); });
  ok('the worksheet right-clicked is chosen already', pre);
  const upOff = await page.evaluate(() => document.querySelector('[data-fa="upload-go"]').disabled);
  ok('Upload is off until a PDF is chosen', upOff === true);
  await page.setInputFiles('.faFile', { name: 'not-a-pdf.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  let st = await page.evaluate(() => document.querySelector('.faCard-upload .faStatus').textContent);
  ok('a file that is not a PDF is refused', /not a PDF/.test(st), st);
  await page.setInputFiles('.faFile', { name: 'answer-key.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') });
  await page.fill('[data-fa="day"]', '2026-11-09');
  await page.dispatchEvent('[data-fa="day"]', 'change');
  goText = await page.evaluate(() => document.querySelector('[data-fa="upload-go"]').textContent);
  ok('with a PDF, Upload names the worksheet', /Upload to “Term 4 · Worksheet 3”/.test(goText), goText);
  await shot(page, 'upload-window.png');
  await page.click('[data-fa="upload-go"]');
  await page.waitForTimeout(250);
  c = await page.evaluate(calls);
  const uc = c.find(x => x.name === 'uploadPdf');
  ok('the PDF goes to the chosen worksheet on the chosen day', uc && uc.args[0] === 'ws3' && uc.args[1].file === 'answer-key.pdf' && uc.args[2] === '2026-11-09', JSON.stringify(uc));
  await page.keyboard.press('Escape');

  /* 📋 The answer key PDFs, and removing one */
  await page.click(card('ws2'), { button: 'right' });
  await page.click('.faMenuItem[data-fa="keys"]');
  await page.waitForTimeout(300);
  const rows = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('.faKeyDay'), r => r.textContent));
  ok('📋 lists each class day, newest first, hand-made ones marked', rows.length === 2 && /9 Nov/.test(rows[0]) && /2 Nov.*uploaded by hand/.test(rows[1]), JSON.stringify(rows));
  await shot(page, 'keys-window.png');
  await page.click('.faKeyRow [data-fa="key-remove"]');
  await page.waitForTimeout(150);
  w = await page.evaluate(win);
  ok('Remove asks first', w && /faCard-confirm/.test(w.cls) && /Remove the answer key for Mon 9 Nov 2026\?/.test(w.title), w && w.title);
  await page.click('[data-fa="confirm-no"]');
  await page.waitForTimeout(250);
  c = await page.evaluate(calls);
  ok('Cancel removes nothing', !c.some(x => x.name === 'removeKey'));
  await page.click('.faKeyRow [data-fa="key-remove"]');
  await page.click('[data-fa="confirm-yes"]');
  await page.waitForTimeout(300);
  c = await page.evaluate(calls);
  const rk = c.find(x => x.name === 'removeKey');
  ok('Remove, confirmed, removes that day only', rk && rk.args[0] === 'ws2' && rk.args[1] === '2026-11-09', JSON.stringify(rk));
  await page.keyboard.press('Escape');

  /* 🗑 Delete */
  await page.click(card('ws2'), { button: 'right' });
  await page.click('.faMenuItem[data-fa="delete"]');
  await page.waitForTimeout(250);
  w = await page.evaluate(win);
  ok('Delete always asks first', w && /faCard-confirm/.test(w.cls) && /Delete “Term 4 · Worksheet 2”\?/.test(w.title), w && w.title);
  ok('…saying the class is on it and what goes with it', w && /the class is ON it now/.test(w.text) && /2 answer key PDFs/.test(w.text) && /This cannot be undone/.test(w.text), w && w.text);
  const focusOnCancel = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-fa'));
  ok('Cancel holds the focus, so Enter never deletes', focusOnCancel === 'confirm-no', focusOnCancel);
  await shot(page, 'delete-confirm.png');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  c = await page.evaluate(calls);
  ok('Enter (on Cancel) deletes nothing', !c.some(x => x.name === 'remove'));
  await page.click(card('ws2'), { button: 'right' });
  await page.click('.faMenuItem[data-fa="delete"]');
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  c = await page.evaluate(calls);
  ok('Escape deletes nothing', !c.some(x => x.name === 'remove'));
  await page.click(card('ws2'), { button: 'right' });
  await page.click('.faMenuItem[data-fa="delete"]');
  await page.waitForTimeout(250);
  await page.click('[data-fa="confirm-yes"]');
  await page.waitForTimeout(300);
  c = await page.evaluate(calls);
  const rm = c.filter(x => x.name === 'remove');
  ok('Delete worksheet, confirmed, deletes that one worksheet once', rm.length === 1 && rm[0].args[0].id === 'ws2', JSON.stringify(rm));

  /* ☁ My PDFs' own Delete button uses the same confirmation, never the browser's */
  await page.evaluate(() => { deleteSavedDoc('ws4', qDocs.find(d => d.id === 'ws4').data, null); });
  await page.waitForTimeout(250);
  w = await page.evaluate(win);
  ok('My PDFs Delete asks in the same window', w && /Delete “Term 4 · Worksheet 4”\?/.test(w.title), w && w.title);
  await page.click('[data-fa="confirm-no"]');
  await page.waitForTimeout(200);
  c = await page.evaluate(calls);
  ok('…and Cancel there deletes nothing', c.filter(x => x.name === 'remove').length === 1);
  ok('no browser confirm() box anywhere', dialogs.length === 0, dialogs.join(' | '));

  /* A plain left click still opens the worksheet as before */
  const opened = await page.evaluate(() => { let got = ''; const real = openSavedDoc; openSavedDoc = (id) => { got = id; return Promise.resolve(); }; document.querySelector('#qList .qItemRow[data-qid="ws1"] .qItem').click(); openSavedDoc = real; return got; });
  ok('a left click still opens the worksheet', opened === 'ws1', opened);
  ok('no error along the way', errors.length === 0, errors.join('\n      '));
  await ctx.close();
}

/* ---------- A student: no menu ---------- */
{
  const { ctx, page, errors } = await open({ width: 1280, height: 900 });
  await page.evaluate(seed(), { role: 'student'});
  const first = await page.evaluate(() => { const r = document.querySelector('#qList .qItemRow .qItem'); return r ? r.closest('.qItemRow').getAttribute('data-qid') : ''; });
  const prevented = await page.evaluate((id) => {
    const el = document.querySelector('#qList .qItemRow[data-qid="' + id + '"] .qItem');
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, first);
  ok('a student gets no menu', !(await page.evaluate(menuState)));
  ok('…and keeps the browser\'s own right-click', prevented === false);
  ok('no error for a student', errors.length === 0, errors.join('\n      '));
  await ctx.close();
}

/* ---------- The iPad: press and hold ---------- */
{
  const { ctx, page, errors } = await open({ width: 1024, height: 1366 }, { hasTouch: true });
  await page.evaluate(seed(), { role: 'teacher'});
  const box = await page.locator(card('ws3')).boundingBox();
  const hold = async (ms, move) => page.evaluate(({ sel, ms, move }) => new Promise((resolve) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const x = r.left + 30, y = r.top + 20;
    const opts = (dx) => ({ bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x + dx, clientY: y });
    el.dispatchEvent(new PointerEvent('pointerdown', opts(0)));
    if (move) el.dispatchEvent(new PointerEvent('pointermove', opts(move)));
    setTimeout(() => {
      const opened = !!document.querySelector('.faMenu');
      el.dispatchEvent(new PointerEvent('pointerup', opts(move || 0)));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      resolve(opened);
    }, ms);
  }), { sel: card('ws3'), ms, move });
  ok('the card is on screen', !!box);
  const real = await page.evaluate(() => { window.__opened = ''; window.__realOpen = openSavedDoc; openSavedDoc = (id) => { window.__opened = id; return Promise.resolve(); }; return true; });
  void real;
  const quick = await hold(150, 0);
  ok('a quick tap opens no menu', quick === false);
  ok('…and opens the worksheet as before', (await page.evaluate(() => window.__opened)) === 'ws3');
  await page.evaluate(() => { window.__opened = ''; });
  const scroll = await hold(700, 30);
  ok('a finger that moves (a scroll) opens no menu', scroll === false);
  await page.evaluate(() => { window.__opened = ''; });
  const held = await hold(700, 0);
  ok('press and hold opens the menu', held === true);
  ok('…and the tap that ends the hold does not open the worksheet', (await page.evaluate(() => window.__opened)) === '');
  await shot(page, 'ipad-hold-menu.png');
  const fits = await page.evaluate(() => { const r = document.querySelector('.faMenu').getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });
  ok('the menu stays on screen', fits);
  ok('no error on the iPad', errors.length === 0, errors.join('\n      '));
  await ctx.close();
}

/* ---------- A phone ---------- */
{
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  await page.evaluate(seed(), { role: 'teacher'});
  await page.evaluate(() => {
    const el = document.querySelector('#qList .qItemRow[data-qid="ws2"] .qItem');
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 360, clientY: 700 }));
  });
  const fit = await page.evaluate(() => { const r = document.querySelector('.faMenu').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight }; });
  ok('phone: a menu opened near the corner is pulled back on screen', fit.l >= 0 && fit.t >= 0 && fit.r <= fit.w && fit.b <= fit.h, JSON.stringify(fit));
  await shot(page, 'phone-menu.png');
  await page.click('.faMenuItem[data-fa="match"]');
  await page.waitForTimeout(250);
  const over = await page.evaluate(() => { const c = document.querySelector('.faCard'); return c.scrollWidth - c.clientWidth; });
  ok('phone: the Match window does not scroll sideways', over <= 1, String(over));
  await shot(page, 'phone-match.png');
  ok('phone: no error', errors.length === 0, errors.join('\n      '));
  await ctx.close();
}

await browser.close();
console.log('\nfile-actions-check: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
