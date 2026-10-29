/* =====================================================================
   📚 THE LIVING APP LIBRARY — the real page, in a real browser
   ---------------------------------------------------------------------
   tools/living-library-tests.mjs pins the helpers and the wiring. This
   drives the real page: a save files the worksheet's living app (hosting
   it once), 🔎 finds the apps on older worksheets, the window lists them
   with their own QR codes, and ✉ opens Gmail addressed to the ticked
   students in Bcc with each app's link — and none of it is a student's.

     node tools/living-library-check.mjs
     PW=/path/to/playwright/index.mjs node tools/living-library-check.mjs
     LL_SCREENSHOTS=/some/dir node tools/living-library-check.mjs
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) {
  console.log('living-library-check: no Playwright at ' + PW + ' — skipped.');
  process.exit(0);
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FILE = pathToFileURL(path.join(ROOT, 'index.html')).href;
const SHOTS = process.env.LL_SCREENSHOTS || process.env.SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (note ? '\n      ' + note : '')); }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'living-library-' + name + '.png') }); };

await page.route(/firebase-[a-z]+-compat\.js(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/javascript', body: '' }));
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
ok('the library module is loaded and wired', await page.evaluate(() => !!(window.LivingLibrary && llib)));

/* A page, a teacher, a Firestore and a Storage that live in memory. */
await page.evaluate(() => {
  const W = 600, H = 780;
  const wrap = document.createElement('div');
  wrap.className = 'pageWrap';
  wrap.style.cssText = 'position:relative;width:' + W + 'px;height:' + H + 'px;background:#fff';
  const canvas = document.createElement('canvas');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.classList.add('overlay');
  wrap.appendChild(canvas); wrap.appendChild(svg);
  document.body.appendChild(wrap);
  const p = { num: 1, baseW: W, baseH: H, wrap, canvas, svg, viewport1: { convertToPdfPoint: (x, y) => [x, H - y] } };
  pages = [p]; pdfDoc = {}; scale = 1;
  attachOverlayHandlers(p);

  // ---- Storage: an object is there once it is put, with a token.
  const objects = {}; let puts = 0;
  window.__ll = { objects, puts: () => puts, sets: [], deletes: [], opened: [] };
  storage = {
    ref(pth) {
      return {
        getDownloadURL: async () => {
          if (!objects[pth]) { const e = new Error('object-not-found'); e.code = 'storage/object-not-found'; throw e; }
          return 'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/' + encodeURIComponent(pth) + '?alt=media&token=' + objects[pth].token;
        },
        putString: async (body, fmt, meta) => { puts++; objects[pth] = { body, meta, token: '5d0c2c1e-7a4b-4f7e-9b1a-0c' + String(puts).padStart(10, '0') }; }
      };
    }
  };

  // ---- Firestore: documents by path, live listeners on collections.
  const docs = {};
  const listeners = [];
  const isPlain = v => v && typeof v === 'object' && !Array.isArray(v) && !v.__inc;
  const merge = (a, b) => {
    const out = Object.assign({}, a);
    Object.keys(b).forEach(k => {
      const v = b[k];
      if (v && v.__inc) out[k] = (Number(out[k]) || 0) + v.__inc;
      else if (isPlain(v) && isPlain(out[k])) out[k] = merge(out[k], v);
      else out[k] = v;
    });
    return out;
  };
  const snapOf = (coll) => {
    const rows = Object.keys(docs).filter(k => k.slice(0, k.lastIndexOf('/')) === coll).map(k => ({ id: k.slice(k.lastIndexOf('/') + 1), data: () => JSON.parse(JSON.stringify(docs[k])) }));
    return { forEach: f => rows.forEach(f), size: rows.length };
  };
  const notify = () => listeners.forEach(l => { if (!l.off) l.cb(snapOf(l.coll)); });
  const collection = (cpath) => ({
    doc: (id) => {
      const dpath = cpath + '/' + id;
      return {
        collection: (name) => collection(dpath + '/' + name),
        set: async (data, opt) => {
          window.__ll.sets.push({ path: dpath, data: JSON.parse(JSON.stringify(data)) });
          docs[dpath] = opt && opt.merge ? merge(docs[dpath] || {}, data) : merge({}, data);
          setTimeout(notify, 0);
        },
        get: async () => ({ exists: !!docs[dpath], data: () => docs[dpath] }),
        delete: async () => { window.__ll.deletes.push(dpath); delete docs[dpath]; setTimeout(notify, 0); }
      };
    },
    get: async () => snapOf(cpath),
    limit: () => ({ get: async () => snapOf(cpath) }),
    orderBy: () => ({ get: async () => snapOf(cpath), limit: () => ({ get: async () => snapOf(cpath) }) }),
    onSnapshot: (cb) => { const l = { coll: cpath, cb, off: false }; listeners.push(l); setTimeout(() => cb(snapOf(cpath)), 0); return () => { l.off = true; }; }
  });
  db = { collection };
  window.__ll.docs = docs;
  window.__ll.listeners = listeners;
  firebase = { firestore: { FieldValue: { increment: n => ({ __inc: n }), serverTimestamp: () => Date.now() } } };

  // ---- The roster: two P5 Science students, one P4 maths, one with no Google.
  docs['studentProfiles/kid-a'] = { name: 'Aisha', email: 'aisha@school.sg', level: 'P5', subject: 'science' };
  docs['studentProfiles/kid-b'] = { name: 'Ben', email: 'ben@school.sg', level: 'P5', subject: 'both' };
  docs['studentProfiles/kid-c'] = { name: 'Chloe', email: 'chloe@school.sg', level: 'P4', subject: 'math' };
  docs['studentProfiles/kid-d'] = { name: 'Dev', email: '', level: 'P5', subject: 'science', managed: true };

  // ---- An older worksheet with a living app nobody has hosted yet, and
  // another teacher's worksheet that must not be read.
  const old = { type: 'ainote', kind: 'paste', id: 'old1', page: 1, x: 10, y: 10, w: 200, h: 90, src: 'data:image/png;base64,iVBORw0KGgo=',
    lapp: { v: 1, title: 'Water cycle explorer', html: '<!doctype html><title>Water cycle</title><p>Evaporation</p>', wand: true } };
  docs['pdfAnnotator/ws-old'] = { name: 'Water cycle W2', level: 'P5', subject: 'science', ownerUid: 'teacher-1', annotations: JSON.stringify([old]) };
  docs['pdfAnnotator/ws-plain'] = { name: 'No apps here', level: 'P5', subject: 'science', ownerUid: 'teacher-1', annotations: JSON.stringify([{ type: 'pen', id: 'p1' }]) };
  const theirs = Object.assign({}, old, { lapp: Object.assign({}, old.lapp, { html: '<!doctype html><p>Someone else</p>', title: 'Not mine' }) });
  docs['pdfAnnotator/ws-other'] = { name: 'Other teacher', level: 'P5', subject: 'science', ownerUid: 'teacher-2', annotations: JSON.stringify([theirs]) };

  // ---- The open worksheet, saved, with one living app on it.
  currentUser = { uid: 'teacher-1', email: ADMIN_EMAIL, displayName: 'Mr Chung' };
  applyRoleUI();
  currentDocId = 'ws-now'; docName = 'Floating and Sinking W3';
  wsMeta.level = 'P5'; wsMeta.subject = 'science';
  annotations = [{ type: 'ainote', kind: 'paste', id: 'la1', page: 1, x: 40, y: 60, w: 300, h: 130, ratio: 2.3,
    src: 'data:image/png;base64,iVBORw0KGgo=', title: 'Floating and Sinking Lab',
    lapp: { v: 1, title: 'Floating and Sinking Lab', html: '<!doctype html><title>Floating</title><button class="btn-wand">wand</button>', wand: true, hash: '' } }];
  annotations[0].lapp.hash = window.LivingApps.pure.contentHash(annotations[0].lapp.html);
  window.open = (url) => { window.__ll.opened.push(url); return null; };
  window.__llClip = '';
  try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__llClip = t; } } }); } catch (e) {}
  renderAllOverlays();
});

console.log('\n💾 A save files the living app');
const saved = await page.evaluate(async () => {
  dirty = false;
  const n = await llibAfterSave();
  const path = Object.keys(window.__ll.docs).find(k => k.startsWith('users/teacher-1/livingApps/'));
  return { n, path, entry: path ? window.__ll.docs[path] : null, pub: annotations[0].lapp.pub || null, dirty, puts: window.__ll.puts(), hash: annotations[0].lapp.hash };
});
ok('a save hosts the app once and files it in the library under its content hash', saved.n === 1 && saved.puts === 1 && saved.path === 'users/teacher-1/livingApps/' + saved.hash, JSON.stringify(saved));
ok('…with its title, its token and the worksheet it is on', saved.entry && saved.entry.title === 'Floating and Sinking Lab' && saved.entry.token === saved.pub.token &&
  saved.entry.sheets && saved.entry.sheets['ws-now'] && saved.entry.sheets['ws-now'].name === 'Floating and Sinking W3' && saved.entry.sheets['ws-now'].level === 'P5', JSON.stringify(saved.entry));
ok('…and never the app’s HTML', saved.entry && !JSON.stringify(saved.entry).includes('btn-wand'));
ok('…the code is kept on the annotation, and the worksheet saves it', saved.pub && saved.pub.hash === saved.hash && saved.dirty === true);
const again = await page.evaluate(async () => {
  const before = window.__ll.sets.length;
  const n = await llibAfterSave();
  return { n, sets: window.__ll.sets.length - before, puts: window.__ll.puts() };
});
ok('the next save writes nothing new and uploads nothing', again.n === 0 && again.sets === 0 && again.puts === 1, JSON.stringify(again));
const practice = await page.evaluate(async () => {
  practiceMode = true;
  const n = await llibAfterSave();
  practiceMode = false;
  return n;
});
ok('nothing is filed while the page holds a practice attempt', practice === 0);

console.log('\n📚 The window');
ok('the teacher has the 📚 App library button', await page.evaluate(() => getComputedStyle($('livingLibBtn')).display !== 'none'));
await page.evaluate(() => $('livingLibBtn').click());
await page.waitForSelector('.llBack.in', { timeout: 3000 }).catch(() => {});
await page.waitForFunction(() => document.querySelectorAll('.llRow').length === 1, null, { timeout: 3000 }).catch(() => {});
const win = await page.evaluate(() => {
  const row = document.querySelector('.llRow');
  return {
    rows: document.querySelectorAll('.llRow').length,
    title: row && row.querySelector('.llAppTitle').textContent,
    sheet: row && row.querySelector('.llSheet').textContent,
    qr: !!(row && row.querySelector('.llQr svg path')),
    students: [...document.querySelectorAll('.llStudent .llStuName')].map(n => n.textContent)
  };
});
ok('it opens and lists the remembered app', win.rows === 1 && /Floating and Sinking Lab/.test(win.title), JSON.stringify(win));
ok('…naming the worksheet it is on', /P5 Science/.test(win.sheet) && /Floating and Sinking W3/.test(win.sheet), win.sheet);
ok('…with its own QR code', win.qr);
const qrMatches = await page.evaluate(() => {
  const e = annotations[0];
  const url = LivingApps.pure.viewerUrl(location.href, e.lapp.pub.hash, e.lapp.pub.token);
  const want = new DOMParser().parseFromString(LivingApps.pure.qrSvg(QuestionBank.pure.qrMatrix(url)), 'image/svg+xml').querySelector('path').getAttribute('d');
  return document.querySelector('.llRow .llQr svg path').getAttribute('d') === want;
});
ok('…and that code is the code for the app’s own link', qrMatches);
ok('students with an email are listed; one with no Google is not', win.students.join(',') === 'Chloe,Aisha,Ben', win.students.join(','));
await shot('open');

console.log('\n🔎 Older worksheets');
await page.click('.llScan');
await page.waitForFunction(() => document.querySelectorAll('.llRow').length === 2, null, { timeout: 5000 }).catch(() => {});
const scanned = await page.evaluate(() => ({
  titles: [...document.querySelectorAll('.llRow .llAppTitle')].map(n => n.textContent),
  paths: Object.keys(window.__ll.docs).filter(k => k.startsWith('users/teacher-1/livingApps/')),
  puts: window.__ll.puts(),
  read: Object.keys(window.__ll.objects)
}));
ok('🔎 finds the living app on an older worksheet and adds it', scanned.titles.some(t => /Water cycle explorer/.test(t)) && scanned.paths.length === 2, JSON.stringify(scanned));
ok('…hosting it once (the same file an export would make)', scanned.puts === 2);
ok('…and never reads another teacher’s worksheet', !scanned.titles.some(t => /Not mine/.test(t)));

console.log('\n✉ Sending');
await page.selectOption('.llLevel', 'P5');
const filtered = await page.evaluate(() => ({
  whoLevel: document.querySelector('.llWhoLevel').value,
  students: [...document.querySelectorAll('.llStudent .llStuName')].map(n => n.textContent)
}));
ok('choosing P5 for the apps narrows the students to P5 too', filtered.whoLevel === 'P5' && filtered.students.join(',') === 'Aisha,Ben', JSON.stringify(filtered));
ok('✉ waits until an app and a person are ticked', await page.evaluate(() => document.querySelector('.llPrimary').disabled));
await page.fill('.llSearch', 'floating');
await page.waitForFunction(() => document.querySelectorAll('.llRow').length === 1, null, { timeout: 2000 }).catch(() => {});
ok('the search narrows the list', await page.evaluate(() => document.querySelectorAll('.llRow').length === 1));
const toolBefore = await page.evaluate(() => typeof tool !== 'undefined' ? tool : '');
await page.type('.llSearch', ' p');
ok('typing in the window never reaches the worksheet’s shortcuts', await page.evaluate(t => (typeof tool !== 'undefined' ? tool : '') === t, toolBefore));
await page.fill('.llSearch', '');
await page.waitForFunction(() => document.querySelectorAll('.llRow').length === 2, null, { timeout: 2000 }).catch(() => {});
await page.click('.llTools .llBtn'); // Select shown
await page.click('.llWhoTools .llLink'); // Tick all shown
await page.fill('.llExtra', 'mum@home.sg, not-an-address');
const ready = await page.evaluate(() => ({
  sum: document.querySelector('.llSum').textContent,
  warn: document.querySelector('.llWarn').textContent,
  chips: document.querySelectorAll('.llChip').length,
  disabled: document.querySelector('.llPrimary').disabled
}));
ok('two apps to three people, and a bad address is named', /2 apps → 3 people/.test(ready.sum) && /not-an-address/.test(ready.warn) && ready.chips === 2 && !ready.disabled, JSON.stringify(ready));
await shot('ready');
await page.click('.llPrimary');
await page.waitForTimeout(300);
const sent = await page.evaluate(() => {
  const url = window.__ll.opened[0] || '';
  const u = url ? new URL(url) : null;
  const links = annotations.length ? [LivingApps.pure.viewerUrl(location.href, annotations[0].lapp.pub.hash, annotations[0].lapp.pub.token)] : [];
  const entries = Object.keys(window.__ll.docs).filter(k => k.startsWith('users/teacher-1/livingApps/')).map(k => window.__ll.docs[k]);
  return {
    url, host: u && u.host, to: u && u.searchParams.get('to'), bcc: u && u.searchParams.get('bcc'), su: u && u.searchParams.get('su'),
    body: u && u.searchParams.get('body'), authuser: u && u.searchParams.get('authuser'), link: links[0], counts: entries.map(e => e.sentCount)
  };
});
ok('✉ opens Gmail in the teacher’s own account, addressed to the teacher', sent.host === 'mail.google.com' && sent.to === 'chungzhikai@gmail.com' && sent.authuser === 'chungzhikai@gmail.com', sent.url.slice(0, 200));
ok('…with the students and the typed address in Bcc', sent.bcc === 'aisha@school.sg,ben@school.sg,mum@home.sg', sent.bcc);
ok('…a subject naming what to revise', /^Revise: .+ and 1 more$/.test(sent.su || ''), sent.su);
ok('…and each app’s own link on a line of its own', (sent.body || '').split('\n').includes('   ' + sent.link) && /Water cycle explorer/.test(sent.body), sent.body);
ok('…signed with the teacher’s name', /Mr Chung$/.test(sent.body || ''));
ok('the library notes that both apps were emailed', sent.counts.length === 2 && sent.counts.every(c => c === 1), JSON.stringify(sent.counts));
await page.click('.llActs .llBtn:last-child');
await page.waitForTimeout(150);
ok('📋 Copy puts the subject, the message and the links on the clipboard', await page.evaluate(() => /^Revise: /.test(window.__llClip) && window.__llClip.includes('living.html?')));

console.log('\n✕ Forgetting');
const firstHash = await page.evaluate(() => document.querySelector('.llRow').getAttribute('data-hash'));
await page.click('.llRow .llForget');
ok('✕ asks first', await page.evaluate(() => /Forget this app/.test(document.querySelector('.llRow .llAsk')?.textContent || '')));
await page.keyboard.press('Escape');
ok('…Escape takes the question back, and the window stays', await page.evaluate(() => !document.querySelector('.llAsk') && !!document.querySelector('.llBack')));
await page.click('.llRow .llForget');
await page.click('.llRow .llDanger');
await page.waitForFunction(() => document.querySelectorAll('.llRow').length === 1, null, { timeout: 2000 }).catch(() => {});
ok('…and Forget removes it from the library', await page.evaluate(h => window.__ll.deletes.includes('users/teacher-1/livingApps/' + h) && document.querySelectorAll('.llRow').length === 1, firstHash));

console.log('\n📱 A phone');
await page.setViewportSize({ width: 390, height: 780 });
await page.waitForTimeout(250);
const phone = await page.evaluate(() => {
  const card = document.querySelector('.llCard').getBoundingClientRect();
  const body = document.querySelector('.llBody');
  return { w: card.width, overflow: body.scrollWidth > body.clientWidth + 1 };
});
ok('the window fills a phone with no sideways scroll', phone.w <= 390 && !phone.overflow, JSON.stringify(phone));
await shot('phone');
await page.setViewportSize({ width: 1280, height: 900 });

await page.keyboard.press('Escape');
await page.waitForTimeout(250);
ok('Escape closes the window and its live listener', await page.evaluate(() => !document.querySelector('.llBack') && window.__ll.listeners.every(l => l.off)));

console.log('\n🎒 A student');
const student = await page.evaluate(async () => {
  currentUser = { uid: 'kid-a', email: 'aisha@school.sg', displayName: 'Aisha' };
  applyRoleUI();
  lappRoleChanged();
  const before = window.__ll.sets.length;
  const opened = llib.open();
  await new Promise(r => setTimeout(r, 50));
  const n = await llibAfterSave();
  let scan = '';
  try { await llibScan(); } catch (e) { scan = e.message; }
  return {
    hidden: getComputedStyle($('livingLibBtn')).display === 'none', opened, win: !!document.querySelector('.llBack.in'),
    n, sets: window.__ll.sets.length - before, scan
  };
});
ok('a student has no library button', student.hidden);
ok('…cannot open it, file into it or search with it', student.opened === false && !student.win && student.n === 0 && student.sets === 0 && /teacher/.test(student.scan), JSON.stringify(student));

const handover = await page.evaluate(async () => {
  currentUser = { uid: 'teacher-1', email: ADMIN_EMAIL, displayName: 'Mr Chung' };
  applyRoleUI(); lappRoleChanged();
  llib.open();
  await new Promise(r => setTimeout(r, 50));
  currentUser = { uid: 'kid-b', email: 'ben@school.sg', displayName: 'Ben' };
  applyRoleUI(); lappRoleChanged();
  await new Promise(r => setTimeout(r, 250));
  return !document.querySelector('.llBack.in');
});
ok('the window closes the moment the device is handed to a student', handover);

ok('no uncaught error along the way', errors.length === 0, errors.join('\n      '));
await browser.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
