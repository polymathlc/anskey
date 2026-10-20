/* =====================================================================
   🧭 The student's start-here bar and tour — in a real browser
   ---------------------------------------------------------------------
   `tools/student-guide-tests.mjs` pins what the source SAYS. This asks the
   page: does a signed-in student actually SEE the bar, does every icon
   actually carry its name, does the tour open by itself once and walk the
   buttons on screen, do Practise and Watch appear on a worksheet with
   answers and a video, and does the teacher see none of it.

     node tools/student-guide-check.mjs
     PW=/path/to/playwright/index.mjs node tools/student-guide-check.mjs
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) {
  console.log('student-guide-check: no Playwright at ' + PW + ' — skipped.');
  process.exit(0);
}

const FILE = pathToFileURL(path.resolve(process.argv[2] || 'index.html')).href;
const SHOTS = process.env.GUIDE_SCREENSHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (note ? '\n      ' + note : '')); }
};

const browser = await chromium.launch();

async function open(viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  /* pdf.js and Firebase come off a CDN; a chain proxy lets the script run. */
  await page.addInitScript(() => {
    const chain = () => new Proxy(function () { return chain(); }, {
      get: (t, k) => (k === 'then' ? undefined : chain()),
      apply: () => chain(), construct: () => chain(), set: () => true
    });
    window.pdfjsLib = chain(); window.firebase = chain(); window.grecaptcha = chain();
  });
  /* On CI the real Firebase scripts load over the stand-in above and throw on
     their own; answer them empty, as the snip, caption and upload checks do. */
  await page.route(/firebase-[a-z]+-compat\.js(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(FILE);
  await page.waitForTimeout(1000);
  return { ctx, page, errors };
}

/* ---------- The teacher sees none of it ---------- */
{
  const { ctx, page, errors } = await open({ width: 1280, height: 860 });
  ok('the page loads with no uncaught error', errors.length === 0, errors.join('\n      '));
  const t = await page.evaluate(() => {
    currentUser = { uid: 'teacher', email: ADMIN_EMAIL };
    applyRoleUI();
    return { bar: !$('studentBar').hidden, view: document.body.classList.contains('studentView'),
      burgerW: $('burgerBtn').getBoundingClientRect().width };
  });
  ok('the teacher has no start-here bar', !t.bar);
  ok('the teacher toolbar keeps its icons bare', !t.view && t.burgerW < 40, 'burger ' + t.burgerW);
  await ctx.close();
}

/* ---------- A student signing in ---------- */
for (const vp of [{ name: 'desktop', width: 1280, height: 860 }, { name: 'phone', width: 390, height: 780 }]) {
  const { ctx, page } = await open({ width: vp.width, height: vp.height });
  const s = await page.evaluate(() => {
    try { localStorage.clear(); } catch (e) {}
    currentUser = { uid: 'stu-1', email: 'kid@example.com' };
    applyRoleUI();
    const vis = id => { const e = $(id); const r = e.getBoundingClientRect(); return !e.hidden && r.width > 0 && r.height > 0; };
    return {
      bar: vis('studentBar'), worksheets: vis('sbWorksheetsBtn'), guide: vis('sbGuideBtn'),
      practice: vis('sbPracticeBtn'), videos: vis('sbVideosBtn'),
      burger: getComputedStyle($('burgerBtn'), '::after').content,
      emptyBtn: vis('emptyWorksheetsBtn'), blank: vis('emptyBlankBtn'),
      body: document.body.scrollWidth <= innerWidth + 1
    };
  });
  ok(vp.name + ': a signed-in student sees the start-here bar', s.bar && s.worksheets && s.guide);
  ok(vp.name + ': nothing to practise or watch before a worksheet is open', !s.practice && !s.videos);
  ok(vp.name + ': the ☰ button says Worksheets (a phone has 📚 in the bar instead)', vp.width < 520 ? s.worksheets : /Worksheets/.test(s.burger), s.burger);
  ok(vp.name + ': the empty page offers Pick a worksheet, not a blank page', s.emptyBtn && !s.blank);
  ok(vp.name + ': the page does not scroll sideways', s.body);

  await page.waitForTimeout(1400);
  const tour = await page.evaluate(() => {
    const root = $('stuTour');
    if (!root || root.hidden) return null;
    const card = root.querySelector('.stCard').getBoundingClientRect();
    return { title: $('stTitle').textContent, step: $('stStep').textContent,
      onScreen: card.left >= 0 && card.top >= 0 && card.right <= innerWidth && card.bottom <= innerHeight };
  });
  ok(vp.name + ': the tour opens by itself on first sign-in', !!tour && /Welcome/.test(tour.title), JSON.stringify(tour));
  ok(vp.name + ': the tour card is on screen', !!tour && tour.onScreen);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'guide-' + vp.name + '-1.png') });

  const walk = await page.evaluate(() => {
    const seen = [];
    let offScreen = [];
    for (let i = 0; i < 30 && !$('stuTour').hidden; i++) {
      const card = document.querySelector('#stuTour .stCard').getBoundingClientRect();
      if (card.left < 0 || card.top < 0 || card.right > innerWidth + 1 || card.bottom > innerHeight + 1) offScreen.push($('stTitle').textContent);
      seen.push($('stTitle').textContent);
      if (/Practise/.test($('stTitle').textContent)) window.__practiceText = $('stText').textContent;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
      $('stNext').click();
    }
    return { seen, offScreen, closed: $('stuTour').hidden, practice: window.__practiceText || '',
      tool: typeof currentTool !== 'undefined' ? currentTool : '' };
  });
  ok(vp.name + ': the tour walks to the end and closes', walk.closed && walk.seen.length >= 5, walk.seen.join(' | '));
  ok(vp.name + ': practice is in the tour, saying where it will appear', /orange bar/.test(walk.practice), walk.practice);
  ok(vp.name + ': every tour card stays on screen', walk.offScreen.length === 0, walk.offScreen.join(', '));
  const again = await page.evaluate(() => {
    applyRoleUI();
    return new Promise(r => setTimeout(() => r($('stuTour').hidden), 1300));
  });
  ok(vp.name + ': it does not open by itself a second time', again);
  const reopen = await page.evaluate(() => { $('sbGuideBtn').click(); return !$('stuTour').hidden; });
  ok(vp.name + ': ❓ brings it back', reopen);
  const esc = await page.evaluate(() => {
    $('stuTour').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return $('stuTour').hidden;
  });
  ok(vp.name + ': Escape closes it', esc);

  /* A worksheet with an answer and two lesson videos on it. */
  const w = await page.evaluate(() => {
    const W = 600, H = 780;
    const wrap = document.createElement('div');
    wrap.className = 'pageWrap';
    wrap.style.cssText = 'position:relative;width:' + W + 'px;height:' + H + 'px;background:#fff';
    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H });
    svg.classList.add('overlay');
    wrap.appendChild(svg);
    $('pagesContainer').appendChild(wrap);
    $('emptyState').style.display = 'none';
    pages = [{ num: 1, baseW: W, baseH: H, wrap, svg }]; pdfDoc = {};
    annotations = [
      { id: 'a1', type: 'text', page: 1, x: 40, y: 60, w: 200, h: 40, text: 'The answer is 42', color: '#1A1A1A', size: 16 },
      { id: 'v1', type: 'video', page: 1, x: 40, y: 140, w: 150, h: 30, url: 'https://example.com/a.mp4' },
      { id: 'v2', type: 'video', page: 1, x: 40, y: 300, w: 150, h: 30, url: 'https://example.com/b.mp4' }
    ];
    try { renderAllOverlays(); } catch (e) { lessonPlaylistSync(); }
    updatePracticeCard();
    const vis = id => { const e = $(id); const r = e.getBoundingClientRect(); return !e.hidden && r.width > 0 && r.height > 0; };
    return { practice: vis('sbPracticeBtn'), videos: vis('sbVideosBtn'), count: $('sbVideosBtn').querySelector('.sbCount').textContent,
      glow: $('sbVideosBtn').classList.contains('sbCall'), noVideo: vis('sbNoVideo'),
      words: $('sbVideosBtn').textContent.replace(/\s+/g, ' ').trim() };
  });
  ok(vp.name + ': an open worksheet shows ✏️ Practise', w.practice);
  ok(vp.name + ': and ▶ Watch lesson videos with its count', w.videos && w.count === '2' && /Watch lesson videos/.test(w.words), JSON.stringify(w));
  ok(vp.name + ': the video button calls for a tap', w.glow && !w.noVideo);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'guide-' + vp.name + '-worksheet.png') });

  const fold = await page.evaluate(() => {
    const vis = id => { const e = $(id); const r = e.getBoundingClientRect(); return !e.hidden && r.width > 0 && r.height > 0; };
    const tall = $('studentBar').getBoundingClientRect().height;
    $('sbHideBtn').click();
    const r = { tall, slim: $('studentBar').getBoundingClientRect().height, practice: vis('sbPracticeBtn'),
      show: vis('sbShowBtn'), saved: localStorage.getItem('polymath.studentBarMin.v1'),
      body: document.body.scrollWidth <= innerWidth + 1 };
    studentGuideOpen();
    r.tourOpens = $('studentBar').classList.contains('sbMin') === false;
    studentGuideClose();
    r.tourCloses = $('studentBar').classList.contains('sbMin');
    $('sbShowBtn').click();
    r.back = vis('sbPracticeBtn') && localStorage.getItem('polymath.studentBarMin.v1') === '0';
    return r;
  });
  ok(vp.name + ': ▴ Hide folds the bar into a slim strip', fold.slim < 40 && fold.slim < fold.tall && !fold.practice && fold.show, JSON.stringify(fold));
  ok(vp.name + ': the fold is remembered on this device', fold.saved === '1');
  ok(vp.name + ': the tour opens a folded bar and folds it again after', fold.tourOpens && fold.tourCloses, JSON.stringify(fold));
  ok(vp.name + ': ▾ Show my buttons brings the bar back', fold.back);
  ok(vp.name + ': a folded bar does not scroll sideways', fold.body);

  const panel = await page.evaluate(() => { $('sbVideosBtn').click(); return !$('playlistPanel').hidden && $('playlistList').children.length; });
  ok(vp.name + ': ▶ opens the list of the worksheet’s videos', panel === 2, String(panel));
  await page.evaluate(() => lessonPlaylistClosePanel());

  const p = await page.evaluate(() => {
    $('sbPracticeBtn').click();
    const vis = id => { const e = $(id); const r = e.getBoundingClientRect(); return !e.hidden && r.width > 0 && r.height > 0; };
    const r = { on: practiceMode, status: vis('sbPracticing'), mark: vis('sbMarkAllBtn'), stop: vis('sbStopBtn'),
      start: vis('sbPracticeBtn'), videos: vis('sbVideosBtn'),
      pen: getComputedStyle(document.querySelector('[data-tool="pen"]'), '::after').content };
    $('sbStopBtn').click();
    r.after = practiceMode;
    r.back = vis('sbPracticeBtn') && vis('sbVideosBtn');
    return r;
  });
  ok(vp.name + ': ✏️ Practise really starts practice', p.on && p.status && p.mark && p.stop && !p.start);
  ok(vp.name + ': the videos step aside while the answers are hidden', !p.videos);
  ok(vp.name + (vp.width > 640 ? ': the practising pencil says Pencil' : ': a phone keeps the pencil an icon (the bar has the room)'),
    vp.width > 640 ? /Pencil/.test(p.pen) : p.pen === 'none', p.pen);
  ok(vp.name + ': 👁 Stop ends it and brings Practise and the videos back', !p.after && p.back);
  await ctx.close();
}

await browser.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
