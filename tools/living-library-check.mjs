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

/* 📝 v1.181.0: a living question is painted by the question bank's own
   painter, so what it holds is read off the blocks handed to it. */
await page.evaluate(() => {
  window.__qbq = [];
  // QuestionBank is frozen, so the spy is a copy with one function wrapped.
  const QB = window.QuestionBank, orig = QB.paintQuestion;
  window.QuestionBank = Object.assign({}, QB, { paintQuestion: function (q) { window.__qbq.push(JSON.parse(JSON.stringify(q))); return orig.apply(QB, arguments); } });
  window.__qLast = () => window.__qbq[window.__qbq.length - 1] || { blocks: [] };
  window.__qText = (q) => q.blocks.filter(b => b.type === 'text').map(b => {
    const lab = (b.part ? '(' + b.part + ')' : '') + (b.subPart ? '(' + b.subPart + ')' : '');
    const t = b.content.replace(/<\/p><p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'");
    return (lab ? lab + ' ' : '') + t + (b.marks ? '  [' + b.marks + ']' : '');
  });
  window.__qLines = (q) => q.blocks.filter(b => b.type === 'plainanswer').map(b => b.lines);
  window.__qKinds = (q) => q.blocks.map(b => b.type);
});

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

console.log('\n☁ Library first (v1.179.0)');
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
// The hosted copies are served from the fake Storage, the way the bucket's
// CORS-open download link serves them in class.
await page.evaluate(() => {
  const realFetch = window.fetch;
  window.__ll.fetched = [];
  window.fetch = async (url, opt) => {
    const u = String(url);
    if (u.startsWith('https://firebasestorage.googleapis.com/')) {
      window.__ll.fetched.push(u);
      const m = /\/o\/([^?]+)\?alt=media&token=([^&]+)/.exec(u);
      const pth = m && decodeURIComponent(m[1]);
      const obj = pth && window.__ll.objects[pth];
      if (!obj || obj.token !== decodeURIComponent(m[2])) return new Response('gone', { status: 404 });
      return new Response(obj.body, { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(url, opt);
  };
});
const FIGURE = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 200'><rect x='20' y='40' width='160' height='90' rx='12' fill='none' stroke='#222' stroke-width='3'/><circle cx='300' cy='90' r='50' fill='none' stroke='#222' stroke-width='3'/><text x='40' y='170' font-size='18'>Tank A</text></svg>";
const QUESTION = {
  title: 'Ballast tanks', stem: 'The diagram below shows a submarine and its ballast tank.', figure: FIGURE,
  parts: [
    { label: '(a)', text: 'What fills the tank when the submarine dives?', marks: 1, lines: 2, answer: 'Sea water.' },
    { label: '(b)', text: 'Explain why the submarine rises when air is pumped in.', marks: 2, lines: 4, answer: 'The air pushes the water out, so it weighs less than the water it displaces.' }
  ]
};
const APP_Q = '<!doctype html><html><head><title>Ballast Tank Lab</title></head><body><div id="stage" class="wand-target">sub</div>' +
  '<button class="btn-wand" data-polymath-wand data-wand-target="#stage">🪄</button>' +
  '<script type="application/json" id="polymath-question">' + JSON.stringify(QUESTION) + '</script>' +
  '<script>window.polymathWand = function () {};</script></body></html>';
const REPLY = 'Here is your living app!\n\n```html\n' + APP_Q + '\n```\n\nPaste it into Ans Key.';
await page.evaluate(() => { annotations = []; undoStack = []; renderAllOverlays(); $('livingAppBtn').click(); });
await page.waitForSelector('.laAdder', { timeout: 3000 }).catch(() => {});
await page.evaluate((reply) => {
  const ta = document.querySelector('.laAdder .laPaste');
  ta.value = reply;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}, REPLY);
await page.waitForFunction(() => !document.querySelector('.laAdder [data-la="add"]').disabled, null, { timeout: 3000 }).catch(() => {});
const adder = await page.evaluate(() => ({
  info: document.querySelector('.laInfo').textContent,
  title: document.querySelector('.laAdder .laTitle').value,
  asq: !!document.querySelector('.laAdder [data-la="asq"]')?.checked,
  answersRow: !document.querySelector('.laAdder [data-la="answersRow"]')?.hidden,
  add: document.querySelector('.laAdder [data-la="add"]').textContent,
  lib: !!document.querySelector('.laAdder [data-la="lib"]'),
  prompt: !!document.querySelector('.laAdder [data-la="prompt"]')
}));
ok('an AI’s whole reply is pasted and the app is taken out of it', /taken out of the pasted reply/.test(adder.info) && adder.title === 'Ballast Tank Lab', JSON.stringify(adder));
ok('…its question is read: 2 parts, 6 working lines, 3 marks and a diagram', /📝 a question: 2 parts · 6 working lines · 3 marks · a diagram/.test(adder.info), adder.info);
ok('…so 📝 As a question is ticked, with the model answers offered', adder.asq && adder.answersRow && /Save and add the question/.test(adder.add), JSON.stringify(adder));
ok('…beside ☁ Library only and 📋 AI prompt', adder.lib && adder.prompt);
await page.check('.laAdder [data-la="answers"]');
await shot('adder-question');
const putsBefore = await page.evaluate(() => window.__ll.puts());
await page.click('.laAdder [data-la="add"]');
await page.waitForFunction(() => !document.querySelector('.laAdder') && annotations.some(annLivingApp), null, { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(250);
const q1 = await page.evaluate(async () => {
  const app = annotations.find(annLivingApp);
  const lq = annotations.filter(annLivingQuestion);
  const answers = annotations.filter(a => a.type === 'text' && !annLivingQuestion(a));
  const path = 'users/teacher-1/livingApps/' + (app && app.lapp.hash);
  const entry = window.__ll.docs[path];
  const inside = annotations.every(a => a.x >= 0 && a.y >= 0 && a.x + a.w <= 600 && a.y + (a.h || 0) <= 780);
  const q = window.__qLast();
  // 📲 The corner of the picture on screen: the app is hosted, so its QR.
  let cornerDark = 0, cornerAll = 0, labelDark = 0, viewerQr = false;
  if (app && app.lqr) {
    const im = new Image();
    await new Promise(r => { im.onload = r; im.onerror = r; im.src = app.src; });
    const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight;
    const cx = cv.getContext('2d'); cx.drawImage(im, 0, 0);
    const X = Math.round(app.lqr.x * cv.width), Y = Math.round(app.lqr.y * cv.height), S = Math.round(app.lqr.s * cv.width);
    const dd = cx.getImageData(X, Y, S, S).data;
    for (let i = 0; i < dd.length; i += 4) { cornerAll++; if (dd[i] < 80 && dd[i + 1] < 80 && dd[i + 2] < 80) cornerDark++; }
    const lab = cx.getImageData(Math.max(0, X - 12), Y + S, Math.min(cv.width - X + 12, S + 24), Math.round(S * 0.3)).data;
    for (let i = 0; i < lab.length; i += 4) if (lab[i] < 150 && lab[i + 1] < 150 && lab[i + 2] < 150) labelDark++;
    const P = LivingApps.pure;
    const url = P.viewerUrl(location.href, app.lapp.pub.hash, app.lapp.pub.token);
    const m = QuestionBank.pure.qrMatrix(url), n = m.length, cell = S / (n + 2);
    let agree = 0, total = 0;
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) {
      const px = Math.floor(X + (1 + k + 0.5) * cell), py = Math.floor(Y + (1 + r + 0.5) * cell);
      const v = cx.getImageData(px, py, 1, 1).data;
      const dark = v[0] < 128;
      total++; if (dark === !!m[r][k]) agree++;
    }
    viewerQr = agree / total > 0.97;
  }
  return {
    corner: { dark: cornerAll ? cornerDark / cornerAll : 0, labelDark, viewerQr },
    app: app && { lq: app.lq, src: app.src.slice(0, 21), ratio: app.ratio, pub: !!app.lapp.pub, x: app.x, y: app.y, w: app.w, h: app.h, lqr: app.lqr },
    texts: window.__qText(q), lines: window.__qLines(q), kinds: window.__qKinds(q), pieces: lq.length,
    answers: answers.map(a => a.text), answerColor: answers.every(a => a.color === LivingQuestion.pure.ANSWER_COLOR),
    answersOn: answers.every(a => app && a.x >= app.x && a.x + a.w <= app.x + app.w + 0.5 && a.y >= app.y && a.y <= app.y + app.h),
    entry, inside, undo: undoStack.length, puts: window.__ll.puts(), sel: selectedId === (app && app.id)
  };
});
ok('☁ the app goes into the cloud library first — hosted once, filed with inLibrary', q1.entry && q1.entry.inLibrary === true && q1.puts === putsBefore + 1 && q1.app && q1.app.pub, JSON.stringify(q1.entry));
ok('…with what its question holds, and never its HTML', q1.entry && q1.entry.question && q1.entry.question.parts === 2 && q1.entry.question.lines === 6 && q1.entry.question.figure === true &&
  !JSON.stringify(q1.entry).includes('polymath-question'), JSON.stringify(q1.entry && q1.entry.question));
ok('📝 the question is painted in the question bank’s format: its words, its diagram, each part with its marks', q1.texts.length === 3 && /^The diagram below/.test(q1.texts[0]) && q1.texts[1] === '(a) What fills the tank when the submarine dives?  [1]' && /^\(b\) Explain .*\[2\]$/.test(q1.texts[2]) &&
  q1.kinds.join() === 'text,image,text,plainanswer,text,plainanswer', JSON.stringify(q1));
ok('…ONE picture that carries the app, with the tiny wand’s corner at its top right', q1.app && q1.app.lq && q1.pieces === 1 && /^data:image\/(jpeg|png)/.test(q1.app.src) && q1.app.lqr && q1.app.lqr.x > 0.85 && q1.app.lqr.y < 0.05 && q1.app.lqr.s < 0.12, JSON.stringify(q1.app));
ok('📲 the corner on screen IS the app’s QR code — the same code the paper and the stage print — in a plain square', q1.corner.viewerQr && q1.corner.dark > 0.25 && q1.corner.dark < 0.75, JSON.stringify(q1.corner));
ok('…with “living app” and the wand in small type under it', q1.corner.labelDark > 40, JSON.stringify(q1.corner));
ok('…six ruled working lines under the parts, by their marks', q1.lines.reduce((a, b) => a + b, 0) === 6, JSON.stringify(q1.lines));
ok('…the model answers sit on the painted lines as the teacher’s own (no lq)', q1.answers.length === 2 && q1.answerColor && q1.answers[0] === 'Sea water.' && q1.answersOn, JSON.stringify(q1.answers));
ok('…all of it inside the page, as one undo step, with the app selected', q1.inside && q1.undo === 1 && q1.sel, JSON.stringify({ inside: q1.inside, undo: q1.undo, sel: q1.sel, app: q1.app }));
await shot('question-on-page');
const undone = await page.evaluate(() => { undo(); return annotations.length; });
ok('one ↶ takes the whole question back off', undone === 0);
await page.evaluate(() => redo());

const practiceQ = await page.evaluate(() => {
  startPractice();
  const kept = annotations.map(a => ({ t: a.type, lq: !!a.lq, locked: !!a.locked, app: annLivingApp(a) }));
  endPractice();
  return kept;
});
ok('practice keeps the question as a locked copy — and hides the model answers', practiceQ.length === 1 && practiceQ.every(a => a.locked && a.lq) && practiceQ.filter(a => a.app).length === 1, JSON.stringify(practiceQ));
ok('the questions print keeps it too', await page.evaluate(() => annotations.filter(a => annBankQ(a) || annLivingApp(a) || annLivingQuestion(a)).length === 1));

console.log('\n☁ Library only, then from the library onto a worksheet');
const APP_LOOSE = '<!doctype html><title>Magnet Lab</title><div id="stage" class="wand-target">N S</div><button class="btn-wand">🪄</button>';
await page.evaluate(() => $('livingAppBtn').click());
await page.waitForSelector('.laAdder', { timeout: 3000 }).catch(() => {});
await page.fill('.laAdder .laPaste', APP_LOOSE);
await page.waitForFunction(() => !document.querySelector('.laAdder [data-la="lib"]').disabled, null, { timeout: 3000 }).catch(() => {});
const before = await page.evaluate(() => annotations.length);
await page.click('.laAdder [data-la="lib"]');
await page.waitForFunction(() => !document.querySelector('.laAdder'), null, { timeout: 8000 }).catch(() => {});
const loose = await page.evaluate((n) => {
  const h = LivingApps.pure.contentHash('<!doctype html><title>Magnet Lab</title><div id="stage" class="wand-target">N S</div><button class="btn-wand">🪄</button>');
  return { entry: window.__ll.docs['users/teacher-1/livingApps/' + h], added: annotations.length - n, hash: h };
}, before);
ok('☁ Library only files it in the cloud and puts nothing on the page', loose.entry && loose.entry.inLibrary && !loose.entry.sheets && loose.added === 0, JSON.stringify(loose));
ok('…under the worksheet’s level and subject', loose.entry && loose.entry.level === 'P5' && loose.entry.subject === 'science');

// The worksheet the first app came from is DELETED: nothing in the
// library depends on it.
await page.evaluate(() => { Object.keys(window.__ll.docs).filter(k => k.startsWith('pdfAnnotator/')).forEach(k => delete window.__ll.docs[k]); });
await page.evaluate(() => $('livingLibBtn').click());
await page.waitForSelector('.llBack.in', { timeout: 3000 }).catch(() => {});
await page.waitForFunction(h => !!document.querySelector('.llRow[data-hash="' + h + '"]'), loose.hash, { timeout: 3000 }).catch(() => {});
const row = await page.evaluate(h => {
  const r = document.querySelector('.llRow[data-hash="' + h + '"]');
  return r && { text: r.textContent, add: !!r.querySelector('.llAdd:not(.llAsQ)'), asq: !!r.querySelector('.llAsQ'), disabled: r.querySelector('.llAdd').disabled };
}, loose.hash);
ok('the library lists it as in the library, on no worksheet yet, with ➕ and 📝', row && /Not on a worksheet yet/.test(row.text) && row.add && row.asq && !row.disabled, JSON.stringify(row));
await page.selectOption('.llWhere', 'loose');
ok('“On no worksheet” shows only the apps that live in the library alone', await page.evaluate(h => {
  const rows = [...document.querySelectorAll('.llRow')];
  return rows.length >= 1 && rows.every(r => /Not on a worksheet yet/.test(r.textContent)) && rows.some(r => r.getAttribute('data-hash') === h);
}, loose.hash));
await page.selectOption('.llWhere', 'question');
ok('“With a question” shows the ballast app', await page.evaluate(() => [...document.querySelectorAll('.llRow .llAppTitle')].map(n => n.textContent).join('|').includes('Ballast Tank Lab')));
await page.selectOption('.llWhere', '');
await shot('library-loose');
const beforePlace = await page.evaluate(() => ({ n: annotations.length, puts: window.__ll.puts() }));
await page.click('.llRow[data-hash="' + loose.hash + '"] .llAdd:not(.llAsQ)');
await page.waitForFunction(() => !document.querySelector('.llBack'), null, { timeout: 8000 }).catch(() => {});
const placed = await page.evaluate((b) => {
  const added = annotations.slice(b.n);
  const a = added.find(annLivingApp);
  return { added: added.length, title: a && a.lapp.title, pub: a && a.lapp.pub, fetched: window.__ll.fetched.length, puts: window.__ll.puts() - b.puts, lq: !!(a && a.lq) };
}, beforePlace);
ok('➕ Add to page fetches the hosted copy and puts the app on the page', placed.added === 1 && placed.title === 'Magnet Lab' && placed.fetched >= 1 && !placed.lq, JSON.stringify(placed));
ok('…already carrying its code, so nothing is uploaded again', placed.pub && placed.pub.hash === loose.hash && placed.puts === 0, JSON.stringify(placed));
const linkStill = await page.evaluate(async (h) => {
  const e = window.__ll.docs['users/teacher-1/livingApps/' + h];
  const url = LivingApps.pure.viewerUrl(location.href, e.hash, e.token);
  const code = LivingApps.pure.parseViewerQuery(url.slice(url.indexOf('?')));
  const res = await fetch(LivingApps.pure.mediaUrl(code.hash, code.token));
  const read = LivingApps.pure.readPublished(await res.text(), code.hash);
  return { url, ok: read.ok, title: read.app && read.app.title };
}, loose.hash);
ok('its QR code’s link opens the cloud copy, with every worksheet deleted', linkStill.ok && linkStill.title === 'Magnet Lab' && /living\.html\?/.test(linkStill.url), JSON.stringify(linkStill));

// 📝 the same library app as a question: no block, so its title is the
// question and it gets the default working lines.
await page.evaluate(() => $('livingLibBtn').click());
await page.waitForFunction(h => !!document.querySelector('.llRow[data-hash="' + h + '"] .llAsQ'), loose.hash, { timeout: 3000 }).catch(() => {});
const n2 = await page.evaluate(() => annotations.length);
await page.click('.llRow[data-hash="' + loose.hash + '"] .llAsQ');
await page.waitForFunction(() => !document.querySelector('.llBack'), null, { timeout: 8000 }).catch(() => {});
const asQ = await page.evaluate((n) => {
  const added = annotations.slice(n);
  const q = window.__qLast();
  return { texts: window.__qText(q), lines: window.__qLines(q), pieces: added.length, apps: added.filter(annLivingApp).length, lq: added.every(annLivingQuestion), corner: !!(added[0] && added[0].lqr) };
}, n2);
ok('📝 As a question from the library: an app with no question block is read — its few words with its title', asQ.texts.join() === 'Magnet Lab\nN S', JSON.stringify(asQ));
ok('…five lines exactly, all of it one picture of the question', asQ.lines.join() === '5' && asQ.pieces === 1 && asQ.apps === 1 && asQ.lq && asQ.corner, JSON.stringify(asQ));

// 📝 v1.180.0 — an app with NO question block, written the way most apps
// are: a heading, a wand line, the question in paragraphs, an SVG diagram
// styled by the app's own stylesheet, a canvas drawn in requestAnimationFrame,
// a results table, parts (a) and (b), buttons and a hidden answer. All of
// it but the controls and the hidden answer goes on the paper.
const APP_RICH = '<!doctype html><html><head><title>Ice Lab</title><style>.tank{fill:#E01B24;stroke:#000}.lbl{font:18px sans-serif;fill:#111}' +
  'table{border-collapse:collapse}td,th{border:1px solid #888;padding:4px}</style></head><body>' +
  '<header class="top"><img alt="Polymath Learning Centre" width="120" height="60" src="data:image/svg+xml,' + encodeURIComponent('<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'120\' height=\'60\'><rect width=\'120\' height=\'60\' fill=\'#C60085\'/></svg>') + '"></header>' +
  '<div class="brand"><svg width="120" height="60"><rect width="120" height="60" fill="#C60085"/></svg><span>POLYMATH</span></div>' +
  '<svg class="site-logo" width="90" height="50"><rect width="90" height="50" fill="#C60085"/></svg>' +
  '<h1>Ice Lab</h1><p>Tap the 🪄 magic wand to watch the ice melt.</p>' +
  '<p>Ali left a beaker of crushed ice in the sun and recorded its temperature every minute.</p>' +
  '<svg viewBox="0 0 300 160" width="300" height="160"><rect class="tank" x="20" y="20" width="160" height="100"/><text class="lbl" x="30" y="150">beaker</text></svg>' +
  '<canvas id="cv" width="220" height="120" style="width:220px;height:120px"></canvas>' +
  '<table><caption>Results</caption><tr><th>Time / min</th><th>Temperature / °C</th></tr><tr><td>0</td><td>0</td></tr><tr><td>6</td><td>14</td></tr></table>' +
  '<p>(a) What is the state of the water at 0 minutes? [1]</p><p>(b) Explain why the temperature stays at 0 °C for a while. [2]</p>' +
  '<button class="btn-wand">🪄</button><button>Reset</button><input type="range"><div style="display:none">Answer: it is melting</div>' +
  '<script>requestAnimationFrame(function(){var x=document.getElementById("cv").getContext("2d");x.fillStyle="#1C71D8";x.fillRect(10,10,200,100);});</script>' +
  '</body></html>';
const nRich = await page.evaluate(() => annotations.length);
const rich = await page.evaluate(async (html) => {
  // On a page of its own, as a teacher starting a fresh question would.
  window.__keptAnns = annotations.splice(0);
  renderAllOverlays();
  document.querySelector('.pageWrap').scrollIntoView();
  const n0 = annotations.length;
  const app = LivingApps.pure.normalizeApp({ html }).app;
  const cover = { src: 'data:image/png;base64,iVBORw0KGgo=', ratio: 2.3 };
  const t0 = Date.now();
  const pageNum = await lappAddQuestion(cover, app, {});
  const added = annotations.slice(n0);
  const pic = added.find(annLivingApp);
  // What the picture holds: the stylesheet's red, the canvas's blue and the table's dark lines.
  const img = new Image();
  await new Promise(r => { img.onload = r; img.onerror = r; img.src = pic.src; });
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let red = 0, blue = 0, dark = 0, magenta = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 170 && d[i + 1] < 40 && d[i + 2] > 100 && d[i + 2] < 160) magenta++;
    if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) red++;
    if (d[i] < 60 && d[i + 1] > 90 && d[i + 1] < 140 && d[i + 2] > 190) blue++;
    if (d[i] < 140 && d[i + 1] < 150 && d[i + 2] < 160 && Math.abs(d[i] - d[i + 2]) < 30) dark++;
  }
  const q = window.__qLast();
  return {
    pageNum, ms: Date.now() - t0,
    texts: window.__qText(q), kinds: window.__qKinds(q),
    lines: window.__qLines(q),
    apps: added.filter(annLivingApp).length, lq: added.every(annLivingQuestion),
    notCover: pic.src !== cover.src, w: img.naturalWidth, h: img.naturalHeight, red, blue, dark, magenta,
    texts2: window.__qText(q).join('\n'),
    frames: document.querySelectorAll('iframe.laHarvest').length,
    onPage: added.every(a => a.y >= 0 && a.y + (a.h || 0) <= 781)
  };
}, APP_RICH);
ok('📝 an app with no block: its question goes on the page, not its heading, its wand line or its hidden answer',
  rich.texts[0] === 'Ali left a beaker of crushed ice in the sun and recorded its temperature every minute.' && !rich.texts.join('\n').includes('Answer:') && !rich.texts.join('\n').includes('🪄') && !rich.texts.join('\n').includes('Reset'),
  JSON.stringify(rich.texts));
ok('…its parts, with their marks', rich.texts[1] === '(a) What is the state of the water at 0 minutes?  [1]' && rich.texts[2] === '(b) Explain why the temperature stays at 0 °C for a while.  [2]', JSON.stringify(rich.texts));
ok('…working space under each part by its marks (2 + 4 lines), and the table as a real table', rich.lines.join() === '2,4' && rich.apps === 1 && rich.lq && rich.kinds.join() === 'text,image,table,text,plainanswer,text,plainanswer', JSON.stringify(rich));
ok('…the picture is what the app DRAWS, not the cover: the diagram in its stylesheet’s red', rich.notCover && rich.red > 500, JSON.stringify({ red: rich.red, w: rich.w, h: rich.h }));
ok('…the canvas it painted in requestAnimationFrame', rich.blue > 500, JSON.stringify({ blue: rich.blue }));
ok('…and its results table', rich.dark > 300, JSON.stringify({ dark: rich.dark }));
ok('🏷 the app’s logo stays off the paper: a header picture, a brand box and a logo SVG, and the centre’s name', rich.magenta < 20 && !/POLYMATH/.test(rich.texts2), JSON.stringify({ magenta: rich.magenta, texts: rich.texts2 }));
ok('…everything on the paper, and the reading frame taken down', rich.onPage && rich.frames === 0, JSON.stringify(rich));
await shot('question-read-off-app');
await page.evaluate(() => { annotations.splice(0, annotations.length, ...window.__keptAnns); renderAllOverlays(); });
ok('…and the page’s other work is back as it was', await page.evaluate((n) => annotations.length === n, nRich));

// 📝 v1.183.0 — the question's story, in the order the app tells it: the
// opening paragraph before the first diagram (an app's wand instructions
// that say "model answer" must not swallow it), (a), the lead-in, the
// second diagram, (b). Built the way Zhi Kai's "Alisha's frozen meat" is.
const APP_STORY = '<!doctype html><html><head><title>Thawing and Cooking Meat</title><style>.m{fill:#E01B24}.p{fill:#1C71D8}</style></head><body>' +
  '<h1 class="worksheet-title">Alisha’s frozen meat: thawing and cooking</h1>' +
  '<p class="lede">Pick up the magic wand and tap a picture. It comes alive and acts out the model answer, one line per tap. You can write and submit your own answers first, or use the wand straight away.</p>' +
  '<article><p>Alisha took a slab of frozen meat from the freezer and thawed it on a tray as shown in the diagram below. Thawing is a process by which a frozen substance becomes soft as a result of warming up.</p>' +
  '<div class="figure-stage"><svg viewBox="0 0 300 120" width="300" height="120"><rect class="m" x="20" y="20" width="160" height="80"/></svg></div>' +
  '<div class="part"><span class="part-label">(a)</span><p>Which tray, plastic or metal, should be used so that the slab of frozen meat can be thawed in a shorter time? Explain your answer. [1]</p></div>' +
  '<button class="btn-wand" data-polymath-wand>🪄</button></article>' +
  '<article><p>After the meat was thawed, Alisha cut the slab of meat into four thin slices and cooked them on a hot plate as shown in the diagram below.</p>' +
  '<div class="figure-stage"><svg viewBox="0 0 300 120" width="300" height="120"><rect class="p" x="20" y="20" width="200" height="60"/></svg></div>' +
  '<div class="part"><span class="part-label">(b)</span><p>Would the sliced meat cook faster or slower than the whole slab of meat on the hot plate? Explain your answer. [2]</p></div></article>' +
  '</body></html>';
const story = await page.evaluate(async (html) => {
  window.__keptAnns = annotations.splice(0);
  renderAllOverlays();
  document.querySelector('.pageWrap').scrollIntoView();
  const app = LivingApps.pure.normalizeApp({ html }).app;
  const cover = { src: 'data:image/png;base64,iVBORw0KGgo=', ratio: 2.3 };
  await lappAddQuestion(cover, app, {});
  const q = window.__qLast();
  const out = { texts: window.__qText(q), kinds: window.__qKinds(q), lines: window.__qLines(q) };
  annotations.splice(0, annotations.length, ...window.__keptAnns);
  renderAllOverlays();
  return out;
}, APP_STORY);
ok('📝 the opening paragraph comes first, before the first diagram — not the app’s heading or its wand help',
  /^Alisha took a slab of frozen meat/.test(story.texts[0] || '') && !story.texts.join('\n').includes('magic wand') && !story.texts.join('\n').includes('thawing and cooking'), JSON.stringify(story.texts));
ok('…then (a), its lines, the lead-in, the second diagram, (b) and its lines — in the app’s own order',
  story.kinds.join() === 'text,image,text,plainanswer,text,image,text,plainanswer' && /^After the meat was thawed/.test(story.texts[2] || '') && /^\(a\)/.test(story.texts[1] || '') && /^\(b\)/.test(story.texts[3] || '') && story.lines.join() === '2,4',
  JSON.stringify(story));

console.log('\n📋 The AI prompt');
await page.evaluate(() => $('livingLibBtn').click());
await page.waitForSelector('.llBack.in .llPromptBtn', { timeout: 3000 }).catch(() => {});
await page.click('.llPromptBtn');
await page.waitForSelector('.lqBack', { timeout: 3000 }).catch(() => {});
const prm = await page.evaluate(() => {
  const out = document.querySelector('.lqOut').value;
  return { out, level: document.querySelector('.lqLevel').value, subject: document.querySelector('.lqSubject').value, z: getComputedStyle(document.querySelector('.lqBack')).zIndex };
});
ok('📋 opens over the library with a prompt for this worksheet’s level and subject', prm.level === 'P5' && prm.subject === 'science' && /Primary 5 Science/.test(prm.out) && Number(prm.z) > 4300, JSON.stringify({ level: prm.level, subject: prm.subject, z: prm.z }));
ok('…asking for the wand, the sandbox rules and the question block this app reads',
  /class="btn-wand"/.test(prm.out) && /window\.polymathWand/.test(prm.out) && /id="polymath-question"/.test(prm.out) && /no fetch/.test(prm.out) && /localStorage/.test(prm.out), prm.out.slice(0, 200));
const toolBefore2 = await page.evaluate(() => typeof tool !== 'undefined' ? tool : '');
await page.fill('.lqTopic', 'How a lever balances');
await page.type('.lqTopic', ' p');
ok('typing a topic rewrites the prompt and never reaches the worksheet’s shortcuts', await page.evaluate(t => /How a lever balances p/.test(document.querySelector('.lqOut').value) && (typeof tool !== 'undefined' ? tool : '') === t, toolBefore2));
await page.click('.lqFoot .lqPrimary');
await page.waitForTimeout(150);
ok('📋 Copy prompt puts it on the clipboard', await page.evaluate(() => window.__llClip === document.querySelector('.lqOut').value && window.__llClip.length > 2000));
await page.click('.lqOpens [data-ai="chatgpt"]');
await page.waitForTimeout(150);
ok('…and Copy and open ChatGPT opens it with the prompt typed in', await page.evaluate(() => {
  const u = window.__ll.opened[window.__ll.opened.length - 1] || '';
  return u.startsWith('https://chatgpt.com/?q=') && decodeURIComponent(u.slice(23)).includes('How a lever balances');
}));
await shot('prompt');
await page.keyboard.press('Escape');
ok('Escape closes the prompt and leaves the library open', await page.evaluate(() => !document.querySelector('.lqBack') && !!document.querySelector('.llBack')));
await page.keyboard.press('Escape');
await page.waitForTimeout(250);

console.log('\n📋 Over the adder');
await page.evaluate(() => $('livingAppBtn').click());
await page.waitForSelector('.laAdder [data-la="prompt"]', { timeout: 3000 }).catch(() => {});
await page.click('.laAdder [data-la="prompt"]');
await page.waitForSelector('.lqBack', { timeout: 3000 }).catch(() => {});
ok('📋 AI prompt opens from the adder too', await page.evaluate(() => !!document.querySelector('.lqBack') && /polymath-question/.test(document.querySelector('.lqOut').value)));
await page.keyboard.press('Escape');
ok('…and Escape closes only the prompt, keeping the adder', await page.evaluate(() => !document.querySelector('.lqBack') && !!document.querySelector('.laAdder')));
await page.keyboard.press('Escape');
console.log('\n☁ No worksheet open');
const noSheet = await page.evaluate(() => {
  const keep = pdfDoc;
  pdfDoc = null;
  $('livingAppBtn').click();
  const a = document.querySelector('.laAdder');
  const r = { opened: !!a, add: a && a.querySelector('[data-la="add"]').textContent, lib: !!(a && a.querySelector('[data-la="lib"]')), asq: !!(a && a.querySelector('[data-la="asq"]')) };
  lapp.close();
  pdfDoc = keep;
  return r;
});
ok('with no worksheet open the adder still opens — and saves to the library alone', noSheet.opened && /Save to library/.test(noSheet.add) && !noSheet.lib && !noSheet.asq, JSON.stringify(noSheet));

console.log('\n📱 A phone');
await page.evaluate(() => $('livingLibBtn').click());
await page.waitForSelector('.llBack.in', { timeout: 3000 }).catch(() => {});
await page.waitForTimeout(400);
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
  let place = '';
  try { await llibPlace({ hash: 'la1-1-1', token: '5d0c2c1e-7a4b-4f7e-9b1a-0c0000000001' }, {}); } catch (e) { place = e.message; }
  let save = '';
  try { await llibSaveApp({ title: 'x', html: '<p>x</p>' }); } catch (e) { save = e.message; }
  const prompt = lqOpenPrompt();
  const q = await lappAddQuestion({ src: 'data:image/png;base64,iVBORw0KGgo=', ratio: 2 }, { title: 'x', html: '<p>x</p>' });
  return {
    place, save, prompt, q, promptWin: !!document.querySelector('.lqBack'),
    hidden: getComputedStyle($('livingLibBtn')).display === 'none', opened, win: !!document.querySelector('.llBack.in'),
    n, sets: window.__ll.sets.length - before, scan
  };
});
ok('a student has no library button', student.hidden);
ok('…and cannot add from it, save to it, ask for the prompt or add a question', /teacher/.test(student.place) && /teacher/.test(student.save) && student.prompt === false && !student.promptWin && !student.q, JSON.stringify(student));
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
