/* =====================================================================
   🚪 THE RUNE DOOR — in a real browser
   ---------------------------------------------------------------------
   The unit tests prove the helpers and the film's contract. What they
   cannot prove is what was asked for: that the teacher's switch puts a
   door on a STUDENT's screen, that the rune really lights in the centre's
   colours and spins, that the leaves swing open onto the worksheet that is
   loaded behind them (the doorway is a hole, not a picture), that the door
   then goes and stays gone, that 🔁 Show it again brings it back, that
   switching it off takes it away, and that a student can never reach the
   switch. Plus a phone, reduced motion, and the HyperFrames film itself.

     node tools/rune-door-check.mjs
     PW=/path/to/playwright/index.mjs node tools/rune-door-check.mjs
     RD_SCREENSHOTS=/some/dir   (sealed / lit / spin / open / phone / film)
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) {
  console.log('rune-door-check: no Playwright at ' + PW + ' — skipped.');
  process.exit(0);
}

const FILE = pathToFileURL(path.resolve('index.html')).href;
const FILM = pathToFileURL(path.resolve('rune-door.html')).href;
const SHOTS = process.env.RD_SCREENSHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (note ? '\n      ' + note : '')); }
};
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

/* The mean brightness of a screenshot (a PNG from Playwright: 8-bit,
   RGB or RGBA, not interlaced), so the check can SEE what it is looking
   at — a leaf that renders black still has every element in place. */
function pngMeanLuma(buf) {
  let p = 8, w = 0, h = 0, ch = 4, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ch = data[9] === 6 ? 4 : 3; }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch, out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[y * stride + x - ch] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= ch && y ? out[(y - 1) * stride + x - ch] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + x] = v & 255;
    }
  }
  let sum = 0;
  for (let i = 0; i < out.length; i += ch) sum += 0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2];
  return sum / (w * h);
}

const browser = await chromium.launch();

async function boot(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: !!opts.touch, reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const chain = () => new Proxy(function () { return chain(); }, {
      get: (t, k) => (k === 'then' ? undefined : chain()),
      apply: () => chain(), construct: () => chain(), set: () => true
    });
    window.pdfjsLib = chain(); window.firebase = chain(); window.grecaptcha = chain();
  });
  await page.route(/firebase-[a-z]+-compat\.js(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  // No network for the carved face: the door must still work in a fallback serif.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.fulfill({ contentType: 'text/css', body: '' }));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(FILE);
  await page.waitForTimeout(600);
  /* `runeDoor/main` is an in-memory stand-in that remembers what was
     written and tells every listener, as Firestore would. A worksheet
     stands in the viewer, so there is something behind the door. */
  await page.evaluate(() => {
    window.__rd = { data: null, writes: 0, listeners: [] };
    const snap = () => ({ exists: !!window.__rd.data, data: () => (window.__rd.data ? JSON.parse(JSON.stringify(window.__rd.data)) : undefined) });
    rdoorRef = function () {
      return {
        get: () => Promise.resolve(snap()),
        set: (d, o) => {
          window.__rd.writes++;
          window.__rd.data = Object.assign({}, o && o.merge ? window.__rd.data : {}, JSON.parse(JSON.stringify(d)));
          const s = snap();
          setTimeout(() => window.__rd.listeners.slice().forEach(fn => fn(s)), 20);
          return Promise.resolve();
        },
        onSnapshot: (fn) => {
          window.__rd.listeners.push(fn);
          setTimeout(() => fn(snap()), 10);
          return () => { window.__rd.listeners = window.__rd.listeners.filter(f => f !== fn); };
        }
      };
    };
    const ws = document.createElement('div');
    ws.id = 'rdTestSheet';
    ws.style.cssText = 'position:fixed;left:0;right:0;bottom:0;top:120px;z-index:50;background:#ffffff;display:flex;align-items:center;justify-content:center;font:700 64px Georgia;color:#1565c0';
    ws.textContent = 'WORKSHEET';
    document.body.appendChild(ws);
    window.__asTeacher = () => { currentUser = { uid: 'teacher-1', email: 'chungzhikai@gmail.com', displayName: 'Zhi Kai' }; actingStudent = null; studentProfile = null; applyRewardVisibility(); };
    window.__asStudent = (uid, name) => { currentUser = { uid: uid || 'student-1', email: 'kid@example.com', displayName: name || 'Mei Ling Tan' }; actingStudent = null; studentProfile = { name: name || 'Mei Ling Tan' }; applyRewardVisibility(); };
  });
  return { ctx, page, errors };
}

async function waitFor(page, fn, arg, ms = 6000) {
  try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; }
  catch (e) { return false; }
}

const doorGone = () => !document.getElementById('runeDoor');
const doorUp = () => !!document.getElementById('runeDoor');

/* ------------------------------------------------------------ teacher → student */
{
  console.log('Teacher, then a student, on a 1280 × 800 screen');
  const { ctx, page, errors } = await boot({ width: 1280, height: 800 });
  await page.evaluate(() => window.__asTeacher());
  ok('the module and GSAP are loaded and wired', await page.evaluate(() => !!(window.RuneDoor && window.gsap && runeDoor)));
  ok('the header shows 🚪 Rune door to the teacher', await page.$eval('#runeDoorBtn', b => getComputedStyle(b).display !== 'none'));
  ok('the teacher does not get a door of their own', await page.evaluate(doorGone));

  await page.evaluate(() => document.getElementById('runeDoorBtn').click());
  ok('the panel opens', await waitFor(page, () => !!document.querySelector('#runeDoorPanel .rdPanel')));
  ok('it starts off, with the centre\'s name to carve', await page.evaluate(() =>
    !document.querySelector('[data-rd="on"]').checked && document.querySelector('[data-rd="inscription"]').value === 'POLYMATH LEARNING CENTRE'));
  const leak = await page.evaluate(() => {
    let hit = 0; const spy = () => { hit++; };
    document.addEventListener('keydown', spy);
    document.querySelector('[data-rd="inscription"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
    document.removeEventListener('keydown', spy);
    return hit;
  });
  ok('a key typed in the panel stays in the panel', leak === 0);
  await shot(page, 'panel');

  await page.click('.rdSwitch');
  ok('ticking the switch writes it on, with an epoch', await waitFor(page, () => window.__rd.data && window.__rd.data.on === true && window.__rd.data.epoch > 0));
  const first = await page.evaluate(() => window.__rd.data);
  ok('the record is the clean shape and names the teacher', first.v === 1 && first.teacherUid === 'teacher-1' && first.inscription === 'POLYMATH LEARNING CENTRE', JSON.stringify(first));
  ok('the panel says students see it', await waitFor(page, () => /every student meets the door/i.test(document.querySelector('.rdStatus').textContent)));

  // 👁 Preview: the teacher's own look, which records nothing.
  await page.click('[data-rd="preview"]');
  ok('Preview puts the door on the teacher\'s screen', await waitFor(page, doorUp));
  await page.waitForTimeout(1900);
  await page.click('#runeDoor .rdRune');
  ok('…and it opens when the rune is touched', await waitFor(page, doorGone, null, 8000));
  ok('a preview records no epoch', await page.evaluate(() => !Object.keys(localStorage).some(k => k.startsWith('polymath.runeDoor.seen'))));

  // ---- a student signs in
  await page.evaluate(() => window.__asStudent());
  ok('a student does not get the button', await page.$eval('#runeDoorBtn', b => getComputedStyle(b).display === 'none'));
  ok('the student\'s screen shows the door', await waitFor(page, doorUp));
  ok('a student cannot open the panel', await page.evaluate(() => { rdoorOpen(); runeDoor.openPanel(); return !document.getElementById('runeDoorPanel'); }));
  const setOnRefused = await page.evaluate(async () => { const w = window.__rd.writes; await runeDoor.setOn(false); await runeDoor.showAgain(); return window.__rd.writes === w; });
  ok('…and every write is refused for a student', setOnRefused);
  await page.waitForTimeout(1900);   // the intro: the scene fades up and the rune lands

  const sealed = await page.evaluate(() => {
    const back = document.getElementById('runeDoor');
    const r = back.getBoundingClientRect();
    const stage = back.querySelector('.rdStage').getBoundingClientRect();
    const rune = back.querySelector('.rdRune').getBoundingClientRect();
    const doorway = back.querySelector('.rdDoorway').getBoundingClientRect();
    const lit = [...back.querySelectorAll('.rdLetter')];
    return {
      covers: r.width === innerWidth && r.height === innerHeight, z: +getComputedStyle(back).zIndex,
      stageIn: stage.top >= -1 && stage.bottom <= innerHeight + 1 && stage.left >= 0 && stage.right <= innerWidth,
      runeMid: Math.abs((rune.left + rune.right) / 2 - (doorway.left + doorway.right) / 2) < 2,
      runeUpper: (rune.top + rune.bottom) / 2 < (doorway.top + doorway.bottom) / 2,
      letters: lit.map(t => t.textContent).join(''),
      firstColor: lit[0] && lit[0].getAttribute('fill'), lastColor: lit[lit.length - 1] && lit[lit.length - 1].getAttribute('fill'),
      dark: lit.every(t => +(getComputedStyle(t).fillOpacity) === 0),
      hint: back.querySelector('.rdHint').textContent, hintOpacity: +getComputedStyle(back.querySelector('.rdHint')).opacity,
      runeOpacity: +getComputedStyle(back.querySelector('.rdRune')).opacity,
      flames: [...back.querySelectorAll('.rdFlame')].length, embers: back.querySelectorAll('.rdEmber').length,
      focus: document.activeElement && document.activeElement.classList.contains('rdRune'),
      sheetBehind: !!document.getElementById('rdTestSheet')
    };
  });
  ok('the door covers the whole screen, above everything', sealed.covers && sealed.z >= 7000, JSON.stringify({ covers: sealed.covers, z: sealed.z }));
  ok('the door fits on the screen', sealed.stageIn);
  ok('the rune sits over the seam, in the upper half', sealed.runeMid && sealed.runeUpper);
  ok('the arch is carved with the centre\'s name', sealed.letters.replace(/ /g, ' ') === 'POLYMATH LEARNING CENTRE', sealed.letters);
  ok('its letters will light teal to magenta, like the logo', sealed.firstColor === '#7ebfca' && sealed.lastColor === '#c60085', sealed.firstColor + ' → ' + sealed.lastColor);
  ok('…and are dark while the door is sealed', sealed.dark);
  ok('the rune has landed and the hint is up', sealed.runeOpacity > 0.95 && sealed.hintOpacity > 0.5 && /Touch the rune/.test(sealed.hint));
  ok('torches burn and embers drift', sealed.flames === 2 && sealed.embers >= 12);
  ok('the rune has the focus, so Enter opens it too', sealed.focus);
  const moving = await page.evaluate(async () => {
    const e = [...document.querySelectorAll('#runeDoor .rdEmber')];
    const a = e.map(x => x.getBoundingClientRect().top);
    await new Promise(r => setTimeout(r, 400));
    const b = e.map(x => x.getBoundingClientRect().top);
    return a.filter((v, i) => Math.abs(v - b[i]) > 2).length;
  });
  ok('it is all moving while it waits (embers rising)', moving >= 6, moving + ' embers moved');
  const keyLeak = await page.evaluate(() => {
    let hit = 0; const spy = () => { hit++; };
    document.addEventListener('keydown', spy);
    document.getElementById('runeDoor').dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
    document.removeEventListener('keydown', spy);
    return hit;
  });
  ok('a key pressed at the door stays at the door', keyLeak === 0);
  const blocked = await page.evaluate(() => {
    const r = document.querySelector('#runeDoor .rdDoorway').getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height * 0.85);
    return !!(el && el.closest('#runeDoor'));
  });
  ok('the worksheet cannot be touched through the shut door', blocked);
  await shot(page, 'sealed');
  // Both leaves are really drawn: the right one is the left turned over,
  // and a lighting filter under a flip renders black in Chrome.
  const leafBox = await page.evaluate(() => ['.rdLeafL', '.rdLeafR'].map(s => {
    const r = document.querySelector('#runeDoor ' + s).getBoundingClientRect();
    return { x: r.left + r.width * 0.1, y: r.top + r.height * 0.62, width: r.width * 0.5, height: r.height * 0.2 };
  }));
  const lumaL = pngMeanLuma(await page.screenshot({ clip: leafBox[0] }));
  const lumaR = pngMeanLuma(await page.screenshot({ clip: leafBox[1] }));
  ok('both leaves are lit wood, neither renders black', lumaL > 40 && lumaR > 40 && Math.abs(lumaL - lumaR) < 18, 'left ' + lumaL.toFixed(1) + ', right ' + lumaR.toFixed(1));
  const logoFill = await page.evaluate(() => [...document.querySelectorAll('#runeDoor .rdLogo path')].map(p => p.getAttribute('fill')));
  ok('the rune carries the logo in the logo file\'s own colours', logoFill.join() === '#991e65,#5b96a1,#7ebfca,#5b96a1,#3a6a70,#c60085,#991e65,#711648', logoFill.join());

  // ---- the touch
  await page.click('#runeDoor .rdRune');
  const epoch = await page.evaluate(() => String(window.__rd.data.epoch));
  ok('the touch records this epoch on the device at once', await page.evaluate((ep) => rdoorReadSeen() === ep, epoch));
  await page.waitForTimeout(500);
  const lit = await page.evaluate(() => {
    const b = document.getElementById('runeDoor');
    return { halo: +gsap.getProperty(b.querySelector('.rdHalo'), 'opacity'), logo: +gsap.getProperty(b.querySelector('.rdLogoLit'), 'opacity'),
      rim: [...b.querySelectorAll('.rdRimLit')].filter(x => +gsap.getProperty(x, 'opacity') > 0.5).length, state: b.dataset.state,
      glow: getComputedStyle(b.querySelector('.rdRune')).filter };
  });
  ok('the rune lights: halo, logo and rim glyphs', lit.halo > 0.6 && lit.logo > 0.8 && lit.rim >= 6, JSON.stringify(lit));
  // The glow starts in the logo's teal and later breathes towards its
  // magenta, so a moment caught on the way is judged by which it is nearer.
  const glowRgb = (lit.glow.match(/rgba?\((\d+), (\d+), (\d+)/) || []).slice(1).map(Number);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  ok('it glows in the centre\'s teal', glowRgb.length === 3 && dist(glowRgb, [126, 191, 202]) < dist(glowRgb, [198, 0, 133]), lit.glow);
  await shot(page, 'lit');
  await page.waitForTimeout(1300);
  const spin = await page.evaluate(() => {
    const b = document.getElementById('runeDoor');
    const sp = [...b.querySelectorAll('.rdSpark')].filter(x => +getComputedStyle(x).opacity > 0.1).length;
    return { rot: +gsap.getProperty(b.querySelector('.rdSpin'), 'rotation'), sparks: sp,
      letters: [...b.querySelectorAll('.rdLetter')].filter(t => +getComputedStyle(t).fillOpacity > 0.5).length };
  });
  ok('it spins (' + Math.round(spin.rot) + '°)', spin.rot > 60, JSON.stringify(spin));
  ok('the inscription is lighting letter by letter', spin.letters >= 6 && spin.letters < 24 || spin.letters === 24, spin.letters + ' lit');
  await shot(page, 'spin');
  await page.waitForTimeout(400);
  const faster = await page.evaluate(() => +gsap.getProperty(document.querySelector('#runeDoor .rdSpin'), 'rotation'));
  // The spin is a power3.in tween to 1080°. On a slow runner the first
  // sample lands late (past 720°), where half as much again is past the end
  // of the tween, so reaching the end from there counts as speeding up too.
  const SPIN_END = 1080;
  ok('…faster and faster (' + Math.round(faster) + '°)',
    faster - spin.rot > spin.rot * 0.5 || (faster > spin.rot && faster >= SPIN_END - 0.5), spin.rot + ' → ' + faster);

  await page.waitForTimeout(1350);   // into the swing
  const swing = await page.evaluate(() => {
    const b = document.getElementById('runeDoor');
    const L = +gsap.getProperty(b.querySelector('.rdLeafL'), 'rotationY'), R = +gsap.getProperty(b.querySelector('.rdLeafR'), 'rotationY');
    const d = b.querySelector('.rdDoorway').getBoundingClientRect();
    const hits = [];
    for (const fx of [0.5, 0.45, 0.55]) for (const fy of [0.45, 0.6, 0.75]) {
      const stack = document.elementsFromPoint(d.left + d.width * fx, d.top + d.height * fy);
      // Under the door's own layers, the first thing is the worksheet.
      const below = stack.find(el => !el.closest('#runeDoor'));
      hits.push(below && below.id);
    }
    return { L, R, hits, rune: +gsap.getProperty(b.querySelector('.rdRune'), 'opacity') };
  });
  ok('the leaves swing open, inward (' + Math.round(swing.L) + '° / ' + Math.round(swing.R) + '°)', swing.L > 30 && swing.R < -30, JSON.stringify(swing));
  ok('the rune has burst into light and gone', swing.rune < 0.2);
  ok('the worksheet loaded behind the door is what shows through it', swing.hits.every(h => h === 'rdTestSheet'), swing.hits.join(','));
  // Between the swung leaves, nothing of the door is in the way.
  const clear = await page.evaluate(() => {
    const b = document.getElementById('runeDoor');
    const d = b.querySelector('.rdDoorway').getBoundingClientRect();
    const cx = d.left + d.width / 2;
    const L = b.querySelector('.rdLeafL').getBoundingClientRect(), R = b.querySelector('.rdLeafR').getBoundingClientRect();
    return { gap: Math.round(R.left - L.right), leftEdge: Math.round(L.right), cx: Math.round(cx), glow: +gsap.getProperty(b.querySelector('.rdGlow'), 'opacity') };
  });
  ok('…and it is really visible: the leaves have parted and the light is faint', clear.gap > 0 && clear.leftEdge < clear.cx && clear.glow < 0.9, JSON.stringify(clear));
  await shot(page, 'open');

  ok('the door goes when it has opened', await waitFor(page, doorGone, null, 5000));
  await page.waitForTimeout(300);
  ok('and stays gone: the same epoch again shows nothing', await page.evaluate(() => { runeDoor._onData(window.__rd.data); return !document.getElementById('runeDoor'); }));

  // ---- 🔁 Show it again
  await page.evaluate(() => window.__asTeacher());
  ok('a teacher sees no door, even with it on', await page.evaluate(doorGone));
  await page.evaluate(() => runeDoor.showAgain());
  ok('🔁 Show it again gives a later epoch', await waitFor(page, (ep) => window.__rd.data.epoch > +ep, epoch));
  await page.evaluate(() => window.__asStudent());
  ok('…and the student meets the door again', await waitFor(page, doorUp));

  // ---- the teacher switches it off while the door is still shut
  await page.evaluate(() => { const fns = window.__rd.listeners.slice(); window.__rd.data = Object.assign({}, window.__rd.data, { on: false }); fns.forEach(f => f({ exists: true, data: () => window.__rd.data })); });
  ok('switching it off takes a shut door off the screen', await waitFor(page, doorGone, null, 3000));

  // ---- a new inscription is carved
  await page.evaluate(() => window.__asTeacher());
  await page.evaluate(() => runeDoor.openPanel());
  await page.fill('[data-rd="inscription"]', 'Polymath Quest');
  await page.press('[data-rd="inscription"]', 'Enter');
  ok('the teacher can carve a new inscription', await waitFor(page, () => window.__rd.data.inscription === 'Polymath Quest'));
  await page.click('.rdSwitch');
  await waitFor(page, () => window.__rd.data.on === true);
  await page.keyboard.press('Escape');
  ok('Escape closes the panel', await waitFor(page, () => !document.getElementById('runeDoorPanel')));
  await page.evaluate(() => window.__asStudent('student-2', 'Arjun'));
  ok('another student meets the door with the new words', await waitFor(page, () => {
    const t = document.querySelector('#runeDoor .rdLit');
    return t && t.textContent.replace(/ /g, ' ') === 'Polymath Quest';
  }));
  await page.waitForTimeout(1800);
  await page.focus('#runeDoor .rdRune');
  await page.keyboard.press('Enter');
  ok('Enter on the rune opens it too', await waitFor(page, () => { const b = document.getElementById('runeDoor'); return !b || b.dataset.state === 'opening'; }));
  ok('…and the welcome names the student', await waitFor(page, () => { const w = document.querySelector('#runeDoor .rdWelcome'); return !w || /Arjun/.test(w.textContent); }));
  await waitFor(page, doorGone, null, 8000);

  // ---- a handover to the teacher takes a student's door away
  await page.evaluate(() => { const fns = window.__rd.listeners.slice(); window.__rd.data = Object.assign({}, window.__rd.data, { epoch: window.__rd.data.epoch + 5 }); fns.forEach(f => f({ exists: true, data: () => window.__rd.data })); });
  await waitFor(page, doorUp);
  await page.evaluate(() => window.__asTeacher());
  ok('signing in as the teacher takes the student\'s door away and stops listening', await page.evaluate(() => !document.getElementById('runeDoor') && window.__rd.listeners.length === 0));

  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

/* ------------------------------------------------------------------ phone */
{
  console.log('A student on a phone (390 × 844)');
  const { ctx, page, errors } = await boot({ width: 390, height: 844 }, { touch: true });
  await page.evaluate(() => { window.__rd.data = { v: 1, on: true, epoch: 77, inscription: 'POLYMATH LEARNING CENTRE', teacherUid: 't', at: 1 }; window.__asStudent(); });
  ok('the door comes up', await waitFor(page, doorUp));
  await page.waitForTimeout(1900);
  const m = await page.evaluate(() => {
    const b = document.getElementById('runeDoor');
    const st = b.querySelector('.rdStage').getBoundingClientRect(), ru = b.querySelector('.rdRune').getBoundingClientRect(), h = b.querySelector('.rdHint').getBoundingClientRect();
    return { st: [st.left, st.right, st.top, st.bottom].map(Math.round), rune: Math.round(ru.width), hint: [h.left, h.right, h.top].map(Math.round), overlap: h.top < st.bottom - 2, scrollW: document.documentElement.scrollWidth };
  });
  ok('the door fits the phone', m.st[0] >= 0 && m.st[1] <= 390 && m.st[2] >= 0 && m.st[3] <= 844, JSON.stringify(m));
  ok('the rune is big enough to touch (' + m.rune + 'px)', m.rune >= 80);
  ok('the hint is on screen and clear of the door', m.hint[0] >= 0 && m.hint[1] <= 390 && !m.overlap, JSON.stringify(m.hint));
  await shot(page, 'phone');
  await page.tap('#runeDoor .rdRune');
  ok('a tap opens it', await waitFor(page, doorGone, null, 8000));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

/* ---------------------------------------------------------- reduced motion */
{
  console.log('A student whose device asks for less motion');
  const { ctx, page, errors } = await boot({ width: 1024, height: 768 }, { reduced: true });
  await page.evaluate(() => { window.__rd.data = { v: 1, on: true, epoch: 88, inscription: 'POLYMATH LEARNING CENTRE', teacherUid: 't', at: 1 }; window.__asStudent(); });
  ok('the door still comes up', await waitFor(page, doorUp));
  ok('…flagged as reduced', await page.evaluate(() => document.getElementById('runeDoor').classList.contains('rdReduced')));
  await page.click('#runeDoor .rdRune');
  const rot = await page.evaluate(() => +gsap.getProperty(document.querySelector('#runeDoor .rdSpin'), 'rotation'));
  ok('nothing spins', rot === 0);
  ok('it fades away quickly instead', await waitFor(page, doorGone, null, 2500));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

/* ------------------------------------------------------------ the film */
{
  console.log('The HyperFrames composition (rune-door.html)');
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.goto(FILM + '?paused');
  await page.waitForTimeout(300);
  const film = await page.evaluate(() => {
    const tl = window.__timelines && window.__timelines['rune-door'];
    const meta = document.querySelector('meta[data-composition-id]');
    const clips = [...document.querySelectorAll('.clip')].map(c => +c.dataset.duration);
    return { ok: !!tl, paused: tl && tl.paused(), dur: tl && tl.duration(), id: meta && meta.dataset.compositionId, clips, touch: tl && tl.labels.touch };
  });
  ok('it registers a paused timeline under its composition id', film.ok && film.paused && film.id === 'rune-door', JSON.stringify(film));
  ok('the film lasts as long as its clips (' + (film.dur || 0).toFixed(2) + ' s)', film.clips.every(d => Math.abs(d - film.dur) < 0.01), JSON.stringify(film));
  // Seeking is deterministic: the same moment twice is the same frame.
  const frame = async (t) => page.evaluate((t) => {
    window.__timelines['rune-door'].seek(t);
    const b = document.querySelector('.rdScene');
    // What is SEEN: an invisible part counts as invisible, whatever its
    // transform; a visible one by its computed transform and opacity.
    return JSON.stringify([...b.querySelectorAll('.rdEmber, .rdSpark, .rdLeaf, .rdRune, .rdSpin, .rdHalo')].map(e => {
      const cs = getComputedStyle(e);
      const op = +cs.opacity;
      if (op < 0.01) return 'hidden';
      const tf = cs.transform === 'none' ? 'matrix(1, 0, 0, 1, 0, 0)' : cs.transform;
      return tf + '|' + op.toFixed(3) + '|' + (e.getAttribute('transform') || '');
    }));
  }, t);
  let same = 0;
  const moments = [film.touch + 0.3, film.touch + 1.4, film.touch + 2.0, film.touch + 2.8, film.touch + 3.6];
  for (const t of moments) {
    const a = await frame(t); await frame(1.1); await frame(film.dur - 0.2);
    if (a === await frame(t)) same++;
  }
  const b0 = await frame(2.2), b1 = await frame(film.touch + 1.4);
  ok('seeking back and forth lands on the same frame every time (' + same + '/' + moments.length + ')', same === moments.length && b0 !== b1);
  for (const [t, n] of [[2.5, 'film-sealed'], [film.touch + 1.6, 'film-spin'], [film.touch + 3.6, 'film-open']]) {
    await page.evaluate((t) => { window.__timelines['rune-door'].seek(t); }, t);
    await shot(page, n);
  }
  const end = await page.evaluate((t) => { window.__timelines['rune-door'].seek(t); return +getComputedStyle(document.querySelector('.rdScene')).opacity; }, film.dur);
  ok('at the end the door is gone and the worksheet holds the screen', end < 0.05);
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
