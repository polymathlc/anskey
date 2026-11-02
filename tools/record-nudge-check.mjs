/* =====================================================================
   ⏺ Writing without recording (v1.173.0) — in a real browser
   ---------------------------------------------------------------------
   `tools/record-nudge-tests.mjs` walks the rules. This asks the page: do
   three REAL pen strokes on a worksheet bring the "Not recording" card up
   over the worksheet (and one does not), does it leave the stroke alone and
   the focus where it was, does ● Record now open the Record lesson window
   with Start lit up and not focused, does a recording starting take it away,
   do Not now / Escape / Don't warn me / the window's switch work, does a
   student, practice mode or an unsaved sheet never see it, and does it fit a
   phone without covering the toolbar.

     node tools/record-nudge-check.mjs
     PW=/path/to/playwright/index.mjs node tools/record-nudge-check.mjs
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) {
  console.log('record-nudge-check: no Playwright at ' + PW + ' — skipped.');
  process.exit(0);
}

const FILE = pathToFileURL(path.resolve(process.argv[2] || 'index.html')).href;
const SHOTS = process.env.RN_SCREENSHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (note ? '\n      ' + note : '')); }
};

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
});

/* One page, built the way loadPdf builds one — the real overlay and the real
   handlers, with no PDF behind it — placed inside #viewerArea like a real one. */
async function open(viewport, role) {
  const ctx = await browser.newContext({ viewport, permissions: ['microphone', 'camera'] });
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
    const t = document.getElementById('stuTour');
    if (t && !t.hidden && typeof studentGuideClose === 'function') studentGuideClose();
    // Nothing else asking for attention: the start-of-lesson prompt is its own feature.
    try { localStorage.setItem('anskeyAskToRecord', '0'); } catch (e) {}
    document.querySelectorAll('.modalBack.open').forEach(m => m.classList.remove('open'));

    const W = 600, H = 780;
    const host = document.getElementById('pagesContainer') || document.getElementById('viewerArea') || document.body;
    const empty = document.getElementById('emptyState');
    if (empty) empty.style.display = 'none';
    const wrap = document.createElement('div');
    wrap.className = 'pageWrap';
    wrap.style.cssText = 'position:relative;flex:none;width:' + W + 'px;height:' + H +
      'px;min-width:' + W + 'px;min-height:' + H + 'px;background:#fff;margin:24px auto';
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' });
    svg.classList.add('overlay');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    wrap.appendChild(canvas); wrap.appendChild(svg);
    host.appendChild(wrap);
    // A page object pdf.js would hand back, for anything that re-renders.
    const fakePage = {
      getViewport: () => ({ width: W, height: H, transform: [1, 0, 0, 1, 0, 0] }),
      render: () => ({ promise: Promise.resolve(), cancel() {} }),
      getTextContent: async () => ({ items: [] })
    };
    const p = { num: 1, baseW: W, baseH: H, wrap, canvas, svg, page: fakePage, pdfPage: fakePage };
    pages = [p]; pdfDoc = { numPages: 1, getPage: async () => fakePage }; scale = 1; annotations = [];
    pdfBytes = new Uint8Array([37, 80, 68, 70]);
    currentDocId = 'doc-1';
    attachOverlayHandlers(p);
    setTool('pen');
    wrap.scrollIntoView({ block: 'start' });
  }, role || 'teacher');
  await page.waitForTimeout(100);
  return { ctx, page, errors };
}

const shown = (page) => page.evaluate(() => { const r = document.getElementById('recNudge'); return !!r && !r.hidden; });
const strokes = (page) => page.evaluate(() => annotations.filter(a => a.type === 'pen').length);

async function stroke(page, i) {
  const box = await page.evaluate(() => { const r = pages[0].svg.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const x = box.x + 80 + (i % 5) * 70, y = box.y + 240 + Math.floor(i / 5) * 60;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(x + k * 6, y + Math.sin(k) * 8);
  await page.mouse.up();
  await page.waitForTimeout(40);
}

/* ---------- The teacher, writing with nothing recording ---------- */
{
  const { ctx, page, errors } = await open({ width: 1280, height: 860 });
  ok('the page loads with no uncaught error', errors.length === 0, errors.join('\n      '));
  ok('the module is loaded and created', await page.evaluate(() => !!window.RecordNudge && !!recNudge));

  await stroke(page, 0);
  ok('one stroke is written…', (await strokes(page)) === 1);
  ok('…and one stroke is not "writing" — no warning yet', !(await shown(page)));
  await stroke(page, 1);
  await stroke(page, 2);
  ok('three strokes are kept on the page', (await strokes(page)) === 3);
  ok('three strokes bring up "Not recording"', await shown(page));
  const text = await page.evaluate(() => document.getElementById('recNudge').textContent);
  ok('it says what is wrong and offers Record now', /Not recording/.test(text) && /Record now/.test(text) && /Not now/.test(text), text);
  ok('it never took the focus', await page.evaluate(() => !document.getElementById('recNudge').contains(document.activeElement)));
  ok('the pen is still the tool', await page.evaluate(() => tool === 'pen'));
  const geo = await page.evaluate(() => {
    const b = document.getElementById('recNudge').getBoundingClientRect();
    const v = document.getElementById('viewerArea').getBoundingClientRect();
    const t = document.getElementById('toolbar');
    const tb = t ? t.getBoundingClientRect() : { bottom: 0 };
    return { b: { l: b.left, r: b.right, t: b.top, bt: b.bottom, w: b.width }, v: { l: v.left, r: v.right, t: v.top }, tb: tb.bottom, vw: innerWidth };
  });
  ok('it sits over the top of the worksheet area, under the toolbar', geo.b.t >= geo.v.t && geo.b.t <= geo.v.t + 40 && geo.b.t >= geo.tb - 1, JSON.stringify(geo));
  ok('it is centred on the worksheet area and inside the screen', Math.abs((geo.b.l + geo.b.r) / 2 - (geo.v.l + geo.v.r) / 2) < 4 && geo.b.l >= 0 && geo.b.r <= geo.vw, JSON.stringify(geo));
  ok('it is a card, not a banner across the page', geo.b.w <= 570, JSON.stringify(geo.b));
  await page.waitForTimeout(400);
  ok('it has finished sliding in and is fully opaque', await page.evaluate(() => getComputedStyle(document.getElementById('recNudge')).opacity === '1'));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'not-recording.png') });

  // Writing on with it up keeps it up and does not show it twice.
  await stroke(page, 3);
  ok('writing on keeps it up (shown once)', await shown(page) && await page.evaluate(() => recNudge.state().shows === 1));

  // Keys pressed inside stay inside: Escape is "Not now".
  await page.focus('#recNudge .rnLater');
  await page.keyboard.press('e');
  ok('a letter typed on the card never reaches the tool shortcuts', await page.evaluate(() => tool === 'pen'));
  await page.keyboard.press('Escape');
  ok('Escape on the card is "Not now"', !(await shown(page)));
  ok('the focus does not stay inside the hidden card', await page.evaluate(() => !document.getElementById('recNudge').contains(document.activeElement)));
  for (let i = 4; i < 8; i++) await stroke(page, i);
  ok('after "Not now" this worksheet stays quiet', !(await shown(page)));

  // Another worksheet is not snoozed.
  await page.evaluate(() => { currentDocId = 'doc-2'; recNudgeChanged(); });
  for (let i = 8; i < 11; i++) await stroke(page, i);
  ok('another worksheet is asked about afresh', await shown(page));

  // A recording starting takes it away.
  await page.evaluate(() => { lessonCapture = { phase: 'recording' }; lessonBar(true); });
  ok('a recording starting takes the warning away at once', !(await shown(page)));
  for (let i = 11; i < 14; i++) await stroke(page, i);
  ok('writing while recording is never warned about', !(await shown(page)));
  await page.evaluate(() => { lessonCapture = null; lessonBar(false); });

  // ● Record now opens the Record lesson window with Start lit.
  await page.evaluate(() => { currentDocId = 'doc-3'; recNudgeChanged(); });
  for (let i = 14; i < 17; i++) await stroke(page, i);
  ok('a third worksheet: up again', await shown(page));
  await page.click('#recNudge .rnRec');
  await page.waitForTimeout(500);
  ok('● Record now opens the Record lesson window', await page.evaluate(() => document.getElementById('lessonModal').classList.contains('open')));
  ok('…and the card has gone', !(await shown(page)));
  ok('Start recording is lit up', await page.evaluate(() => document.getElementById('lessonStartBtn').classList.contains('rnCue')));
  ok('…but NOT focused — Enter must never start a recording', await page.evaluate(() => document.activeElement !== document.getElementById('lessonStartBtn')));
  ok('no recording was started by the warning itself', await page.evaluate(() => !lessonCapture));
  ok('the window carries the switch, on', await page.evaluate(() => document.getElementById('lessonNudgeAgain').checked));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'record-window.png') });
  for (let i = 0; i < 3; i++) await page.evaluate(() => recNudgeInk({ type: 'pen' }));
  ok('while the Record window is open, no warning', !(await shown(page)));
  await page.click('#lessonCancelBtn');
  await page.waitForTimeout(150);

  // Don't warn me, and the window's switch brings it back.
  await page.evaluate(() => { currentDocId = 'doc-4'; recNudgeChanged(); });
  for (let i = 0; i < 3; i++) await stroke(page, i);
  ok('a fourth worksheet: up again', await shown(page));
  await page.click('#recNudge .rnOff');
  ok('"Don\'t warn me" hides it', !(await shown(page)));
  ok('…and remembers it on this device', await page.evaluate(() => localStorage.getItem('polymath.recordNudge.v1') === '0'));
  await page.evaluate(() => { currentDocId = 'doc-5'; recNudgeChanged(); });
  for (let i = 3; i < 7; i++) await stroke(page, i);
  ok('switched off, it never comes up', !(await shown(page)));
  await page.evaluate(() => { lessonOpenModal(); });
  ok('the Record window shows the switch off', await page.evaluate(() => !document.getElementById('lessonNudgeAgain').checked));
  await page.click('#lessonNudgeAgain');
  ok('ticking it turns the warning back on', await page.evaluate(() => recNudge.enabled() && localStorage.getItem('polymath.recordNudge.v1') === null));
  await page.evaluate(() => lessonCloseModal());
  await page.evaluate(() => { currentDocId = 'doc-6'; recNudgeChanged(); });
  for (let i = 7; i < 10; i++) await stroke(page, i);
  ok('back on, it comes up again', await shown(page));

  // A float window does not count as a dialog in front of the page.
  await page.click('#recNudge .rnLater');
  await page.evaluate(() => { currentDocId = 'doc-7'; recNudgeChanged(); document.getElementById('calcModal').classList.add('open'); });
  // The marks are handed over directly: the calculator may sit where a stroke would land.
  for (let i = 10; i < 13; i++) await page.evaluate(() => recNudgeInk({ type: 'pen' }));
  ok('with the calculator open beside the page, it still warns', await shown(page));
  await page.evaluate(() => document.getElementById('calcModal').classList.remove('open'));

  // A role change takes it away.
  await page.evaluate(() => { practiceMode = true; applyRoleUI(); });
  ok('practice mode takes it away (the ink is a child\'s)', !(await shown(page)));
  for (let i = 13; i < 16; i++) await page.evaluate(() => recNudgeInk({ type: 'pen' }));
  ok('…and practising never brings it up', !(await shown(page)));
  await page.evaluate(() => { practiceMode = false; applyRoleUI(); });

  // An unsaved worksheet: nothing to attach a lesson to.
  await page.evaluate(() => { currentDocId = null; recNudgeChanged(); });
  for (let i = 0; i < 4; i++) await stroke(page, i);
  ok('an unsaved worksheet is never warned about', !(await shown(page)));

  ok('no uncaught error along the way', errors.length === 0, errors.join('\n      '));
  await ctx.close();
}

/* ---------- A student ---------- */
{
  const { ctx, page, errors } = await open({ width: 1280, height: 860 }, 'student');
  for (let i = 0; i < 5; i++) await page.evaluate(() => recNudgeInk({ type: 'pen' }));
  ok('a student writing is never told about recording', !(await shown(page)));
  await page.evaluate(() => recNudgeRecord());
  ok('and a student cannot reach Record now\'s door', await page.evaluate(() => !document.getElementById('lessonModal').classList.contains('open')));
  ok('no error for the student', errors.length === 0, errors.join('\n      '));
  await ctx.close();
}

/* ---------- A share-link visitor / handed-over device ---------- */
{
  const { ctx, page } = await open({ width: 1280, height: 860 });
  await page.evaluate(() => { actingStudent = { name: 'Kid' }; applyRoleUI(); });
  for (let i = 0; i < 5; i++) await page.evaluate(() => recNudgeInk({ type: 'pen' }));
  ok('"Practise as" (a handed-over device) is never warned', !(await shown(page)));
  await ctx.close();
}

/* ---------- A phone ---------- */
{
  const { ctx, page, errors } = await open({ width: 390, height: 760 });
  for (let i = 0; i < 3; i++) await page.evaluate(() => recNudgeInk({ type: 'pen' }));
  ok('a phone: it comes up', await shown(page));
  const g = await page.evaluate(() => {
    const b = document.getElementById('recNudge').getBoundingClientRect();
    const rec = document.querySelector('#recNudge .rnRec').getBoundingClientRect();
    const later = document.querySelector('#recNudge .rnLater').getBoundingClientRect();
    return { l: b.left, r: b.right, vw: innerWidth, scroll: document.documentElement.scrollWidth, rec: rec.height, recW: rec.width, laterH: later.height };
  });
  ok('it fits the screen with a gutter', g.l >= 7 && g.r <= g.vw - 7, JSON.stringify(g));
  ok('its buttons are big enough to hit', g.rec >= 34 && g.laterH >= 34 && g.recW >= 120, JSON.stringify(g));
  await page.waitForTimeout(400);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone.png') });
  ok('no error on the phone', errors.length === 0, errors.join('\n      '));
  await ctx.close();
}

await browser.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
