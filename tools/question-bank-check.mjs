/* =====================================================================
   📚 QUESTION BANK — the real page, in a real browser
   ---------------------------------------------------------------------
   tools/question-bank-tests.mjs pins the arithmetic. What no reading of
   the source can say is whether the picker really lists and previews the
   bank, whether ➕ Add really paints the question and puts a frameless
   picture of it on the page, whether a tap really opens the window, ✓
   Check really marks it, 🧩 Show app really runs the app in its sandbox,
   practice really keeps the question, and whether the printed PDF really
   carries the picture and a QR code that links to the worksheet.

   The real index.html is loaded (the CDN libraries it cannot reach are
   stood in for, as in tools/picture-check.mjs), with a page built the way
   loadPdf builds one and an in-memory Firestore holding a small bank.

     node tools/question-bank-check.mjs
     PW=/path/to/playwright/index.mjs node tools/question-bank-check.mjs
     PDF_LIB=/path/to/pdf-lib.min.js node tools/question-bank-check.mjs   # offline
     SHOTS=/some/dir node tools/question-bank-check.mjs                   # keep screenshots
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) {
  console.log('question-bank-check: no Playwright at ' + PW + ' — skipped.');
  process.exit(0);
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FILE = pathToFileURL(path.join(ROOT, 'index.html')).href;
const SHOTS = process.env.QB_SCREENSHOTS || process.env.SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (note ? '\n      ' + note : '')); }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
const page = await ctx.newPage();
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'question-bank-' + name + '.png') }); };

/* pdf-lib is the one CDN library this check needs for real: it is what
   prints. Offline, PDF_LIB points at a local copy. */
if (process.env.PDF_LIB) {
  const body = fs.readFileSync(process.env.PDF_LIB);
  await page.route('**/pdf-lib.min.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body }));
}
// The fixture owns Firebase; the real SDK loaded from the network over the
// stand-in throws inside its own startup (as wheel-check / live-cams-check).
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
ok('the question bank module is loaded and wired', await page.evaluate(() => !!(window.QuestionBank && bankQ && window.qrcode && window.QuestionApps)));
const hasPdfLib = await page.evaluate(() => !!(window.PDFLib && PDFLib.PDFDocument));

/* ---------------- the bank and the page ---------------- */
await page.evaluate(() => {
  const APP = '<style>body{font:16px sans-serif}</style><h3 id="t">Magnet lab</h3>' +
    '<input id="s" type="range" min="0" max="10" value="3"><p id="v">3</p>' +
    '<script>document.getElementById("s").oninput=function(e){document.getElementById("v").textContent=e.target.value;};' +
    'document.getElementById("t").setAttribute("data-ran","yes");</script>';
  const BANK = {
    q1: { id: 'q1', qno: 41, title: 'Magnets and iron', topic: 'Magnets', category: 'Multiple Choice Question', updatedAt: 3,
      blocks: [
        { id: 'b1', type: 'text', content: '<p>Which material is <b>attracted</b> to a magnet?</p><img src="x" onerror="window.__pwned=1"><script>window.__pwned=2</script>' },
        { id: 'b2', type: 'mcq', correctId: 'o2', options: [
          { id: 'o1', text: 'Wood' }, { id: 'o2', text: 'Iron' }, { id: 'o3', text: 'Plastic' }, { id: 'o4', text: 'Glass' }] },
        { id: 'b3', type: 'explanation', content: 'Iron is a magnetic material.' },
        { id: 'b4', type: 'widget', title: 'Magnet lab', height: 300, html: APP }
      ] },
    q2: { id: 'q2', qno: 4, title: 'Water cycle words', topic: 'Water', updatedAt: 2,
      blocks: [
        { id: 'c1', type: 'text', content: 'Fill in the blanks.', part: 'a', marks: 2 },
        { id: 'c2', type: 'fillblank', text: 'Water [[evaporates]] when heated and [[condenses]] when cooled.' },
        { id: 'c3', type: 'table', cols: 2, rows: 2, data: { 0: { 0: 'State', 1: 'Example' }, 1: { 0: 'Gas', 1: 'Steam' } } },
        { id: 'c4', type: 'answer', part: 'b', claim: 'The puddle dried up.', evidence: 'It was sunny.', reasoning: 'Heat makes water evaporate.' }
      ] },
    q3: { id: 'q3', qno: 412, title: 'Plant parts', topic: 'Plants', updatedAt: 1,
      blocks: [{ id: 'd1', type: 'text', content: 'Name the part that takes in water.' }, { id: 'd2', type: 'plainanswer', content: 'The roots.' }] }
  };
  const snap = (obj) => ({ exists: !!obj, data: () => obj && JSON.parse(JSON.stringify(obj)) });
  window.__bankReads = 0;
  db = {
    collection(name) {
      return {
        doc(id) {
          return {
            get: async () => snap(name === 'config' && id === 'admin' ? { uid: 'teacher-1' } : null),
            collection(sub) {
              return { get: async () => {
                window.__bankReads++;
                const docs = id === 'teacher-1' && sub === 'questions' ? Object.values(BANK) : [];
                return { forEach: fn => docs.forEach(d => fn({ id: d.id, data: () => JSON.parse(JSON.stringify(d)) })) };
              } };
            }
          };
        }
      };
    }
  };

  const W = 600, H = 780;
  const el = (tag, attrs) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(k => n.setAttribute(k, attrs[k]));
    return n;
  };
  const wrap = document.createElement('div');
  wrap.className = 'pageWrap';
  wrap.style.cssText = 'position:relative;flex:none;width:' + W + 'px;height:' + H +
    'px;min-width:' + W + 'px;min-height:' + H + 'px;background:#fff';
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' });
  svg.classList.add('overlay');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  wrap.appendChild(canvas); wrap.appendChild(svg);
  document.body.appendChild(wrap);
  const p = { num: 1, baseW: W, baseH: H, wrap, canvas, svg,
    viewport1: { convertToPdfPoint: (x, y) => [x, H - y] } };
  pages = [p]; pdfDoc = {}; scale = 1; annotations = [];
  attachOverlayHandlers(p);
  currentUser = { uid: 'teacher-1', email: ADMIN_EMAIL, displayName: 'Teacher' };
  applyRoleUI();
  setTool('select');
});

console.log('\n📚 The picker');
await page.evaluate(() => $('bankQBtn').click());
await page.waitForSelector('.qbPick .qbRow', { timeout: 5000 }).catch(() => {});
const listed = await page.evaluate(() => ({
  rows: Array.from(document.querySelectorAll('.qbPick .qbRow .qbRowTitle')).map(n => n.textContent.replace(/^#\d+/, '')),
  preview: (document.querySelector('.qbPreview') || {}).innerText || '',
  appTag: !!document.querySelector('.qbRow .qbTagApp'),
  onPage: document.querySelectorAll('.pastePic').length,
  shown: getComputedStyle(document.querySelector('.qbPickBack')).opacity
}));
ok('the teacher’s button opens the picker over the page', listed.rows.length === 3, JSON.stringify(listed.rows));
ok('…newest first', listed.rows[0] === 'Magnets and iron', listed.rows.join(' | '));
ok('…marking the question that has an app', listed.appTag);
ok('nothing of a question shows until one is picked', /Pick a question/.test(listed.preview) && listed.onPage === 0, listed.preview);

await page.fill('.qbSearch', 'evaporates');
const searched = await page.evaluate(() => Array.from(document.querySelectorAll('.qbRow .qbRowTitle')).map(n => n.textContent.replace(/^#\d+/, '')));
ok('search reads the question’s own words, not just its title', searched.length === 1 && searched[0] === 'Water cycle words', JSON.stringify(searched));
await page.fill('.qbSearch', '#4');
const byNo = await page.evaluate(() => Array.from(document.querySelectorAll('.qbRow')).map(n => n.getAttribute('data-qid') + ':' + ((n.querySelector('.qbNo') || {}).textContent || '')));
ok('🔢 "#4" finds question #4 and nothing else (not #41, not #412)', byNo.length === 1 && byNo[0] === 'q2:#4', JSON.stringify(byNo));
await page.fill('.qbSearch', '412');
const bare = await page.evaluate(() => Array.from(document.querySelectorAll('.qbRow')).map(n => n.getAttribute('data-qid')));
ok('🔢 a bare number puts that question first', bare[0] === 'q3', JSON.stringify(bare));
await page.fill('.qbSearch', 'zzzz nothing');
ok('a search that matches nothing says so', /No question matches/.test(await page.innerText('.qbList')));
await page.fill('.qbSearch', '');
await page.click('.qbChips [data-qb-only="app"]');
ok('🧩 With app narrows to the questions that carry one', (await page.$$('.qbRow')).length === 1);
await page.click('.qbChips [data-qb-only=""]');

await page.click('.qbRow[data-qid="q1"]');
const prev = await page.evaluate(() => ({
  text: document.querySelector('.qbPreview').innerText,
  opts: document.querySelectorAll('.qbPreview .qbOpt').length,
  disabled: Array.from(document.querySelectorAll('.qbPreview .qbOpt')).every(b => b.disabled),
  add: !!document.querySelector('.qbPreview [data-qb="add"]'),
  script: document.querySelector('.qbPreview').innerHTML.includes('<script'),
  handler: !!document.querySelector('.qbPreview [onerror]')
}));
ok('picking it draws the question in the preview', /attracted/.test(prev.text) && prev.opts === 4, prev.text.slice(0, 120));
ok('…read-only, with ➕ Add to page', prev.disabled && prev.add);
ok('…and the question’s own HTML cannot run here', !prev.script && !prev.handler);
await shot('picker');

console.log('\n➕ On the page, as a picture of itself');
await page.click('.qbPreview [data-qb="add"]');
await page.waitForFunction(() => annotations.some(annBankQ), null, { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(250);
const added = await page.evaluate(() => {
  const a = annotations.find(annBankQ);
  const g = a && pages[0].svg.querySelector('g[data-id="' + a.id + '"]');
  const box = g && g.querySelector('.pastePic');
  return {
    made: !!a, kind: a && a.kind, src: a ? a.src.slice(0, 23) : '', srcLen: a ? a.src.length : 0,
    ratio: a && a.ratio, w: a && a.w, h: a && a.h, inside: a && a.x >= 0 && a.y >= 0 && a.x + a.w <= 600 && a.y + a.h <= 780,
    bq: a && a.bq && a.bq.blocks.length, bqId: a && a.bq && a.bq.id, owner: a && a.bq && a.bq.owner,
    app: a && a.bq.blocks.some(b => b.type === 'widget' && b.html.includes('Magnet lab')),
    data: box && box.getAttribute('data-bq'),
    chrome: g ? g.querySelectorAll('.aiNoteHead, .aiNoteBtn, .aiNoteTitle, button').length : -1,
    picker: !!document.querySelector('.qbPickBack'),
    dirty: dirty, undo: undoStack.length
  };
});
ok('➕ Add puts the question on the page', added.made && added.kind === 'paste' && added.bqId === 'q1', JSON.stringify(added));
ok('…as a picture painted from the question', added.src === 'data:image/jpeg;base64,' && added.srcLen > 3000, added.src + ' ' + added.srcLen);
ok('…in the picture’s own shape, on the paper', Math.abs(added.w / added.h - added.ratio) < 0.02 && added.inside, JSON.stringify(added));
ok('…carrying the whole question and its app', added.bq === 4 && added.app && added.owner === 'teacher-1');
ok('…with no window round it: no heading, no buttons', added.chrome === 0 && added.data === '1');
ok('…and the picker closes behind it, one undo step and a save to come', !added.picker && added.dirty === true && added.undo >= 1);

const pixels = await page.evaluate(async () => {
  const a = annotations.find(annBankQ);
  const img = new Image();
  await new Promise(r => { img.onload = r; img.src = a.src; });
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let dark = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 100 && d[i + 1] < 100 && d[i + 2] < 100) dark++;
  return { w: img.width, h: img.height, dark };
});
ok('the picture really has the question written on it', pixels.w === 1200 && pixels.dark > 2000, JSON.stringify(pixels));

console.log('\n▶ Selected, it says what it is');
const bar = await page.evaluate(() => {
  const a = annotations.find(annBankQ);
  selectedId = a.id; editModeId = a.id;
  renderAllOverlays();
  return {
    bar: (pages[0].wrap.querySelector('.aiBar') || {}).innerText || '',
    badge: (pages[0].wrap.querySelector('.editBadge') || {}).textContent || ''
  };
});
ok('its bar offers ▶ Open and 🧩 Show app beside Lock and Remove', /Open/.test(bar.bar) && /Show app/.test(bar.bar) && /Lock/.test(bar.bar) && /Remove/.test(bar.bar), bar.bar);
ok('…and the badge names it as a bank question, with its number', /Question #41 from the bank/.test(bar.badge), bar.badge);
await shot('selected');
await page.evaluate(() => {
  const btn = Array.from(pages[0].wrap.querySelectorAll('.aiBar button')).find(b => /Open/.test(b.textContent));
  btn.click();
});
await page.waitForSelector('.qbWin', { timeout: 3000 }).catch(() => {});

console.log('\n✓ The window answers and checks');
const opened = await page.evaluate(() => ({
  open: !!document.querySelector('.qbWin'),
  opts: document.querySelectorAll('.qbWin .qbOpt').length,
  enabled: Array.from(document.querySelectorAll('.qbWin .qbOpt')).every(b => !b.disabled),
  appShown: !!document.querySelector('.qbWin .qbApp'),
  appBtn: (document.querySelector('.qbWin [data-qb="app"]') || {}).textContent || '',
  explanation: /magnetic material/.test(document.querySelector('.qbWin').innerText),
  pwned: window.__pwned || 0
}));
ok('▶ Open shows the question in its window, answerable', opened.open && opened.opts === 4 && opened.enabled, JSON.stringify(opened));
ok('…the app stays behind 🧩 Show app until asked for', !opened.appShown && /Show app/.test(opened.appBtn));
ok('…the explanation stays hidden until it is checked', !opened.explanation);
ok('…and nothing in the question’s HTML ran', opened.pwned === 0);
await page.click('.qbWin .qbOpt[data-qb-opt="o1"]');
await page.click('.qbWin [data-qb="check"]');
const checked = await page.evaluate(() => ({
  wrong: !!document.querySelector('.qbWin .qbOpt.wrong[data-qb-opt="o1"]'),
  right: !!document.querySelector('.qbWin .qbOpt.right[data-qb-opt="o2"]'),
  score: (document.querySelector('.qbWin .qbScore') || {}).textContent || '',
  explanation: /magnetic material/.test(document.querySelector('.qbWin').innerText),
  glow: !!document.querySelector('.qbWin .qbAppBtn.glow'),
  locked: Array.from(document.querySelectorAll('.qbWin .qbOpt')).every(b => b.disabled)
}));
ok('✓ Check marks the choice wrong and shows the right one', checked.wrong && checked.right && checked.locked, JSON.stringify(checked));
ok('…says the score in words', checked.score === '0 of 1 correct', checked.score);
ok('…reveals the explanation', checked.explanation);
ok('…and invites the app', checked.glow);
await shot('checked');

console.log('\n🧩 Show app runs the app, sandboxed');
await page.click('.qbWin [data-qb="app"]');
await page.waitForSelector('.qbWin iframe.question-app-frame', { timeout: 3000 }).catch(() => {});
const app = await page.evaluate(() => {
  const f = document.querySelector('.qbWin iframe.question-app-frame');
  return f ? { sandbox: f.getAttribute('sandbox'), csp: /Content-Security-Policy/.test(f.getAttribute('srcdoc') || ''),
    btn: document.querySelector('.qbWin [data-qb="app"]').textContent } : null;
});
ok('the app opens in the window', !!app, JSON.stringify(app));
ok('…in an opaque-origin sandbox with its CSP', app && app.sandbox === 'allow-scripts' && app.csp);
const frame = page.frames().find(f => f !== page.mainFrame() && /srcdoc|about:/.test(f.url()));
let ran = false, moved = false;
if (frame) {
  await frame.waitForSelector('#t[data-ran="yes"]', { timeout: 3000 }).then(() => { ran = true; }).catch(() => {});
  try {
    await frame.fill('#s', '8').catch(() => {});
    await frame.$eval('#s', el => { el.value = '8'; el.dispatchEvent(new Event('input')); });
    moved = (await frame.textContent('#v')) === '8';
  } catch (e) {}
}
ok('…and it really runs: its script ran and its slider answers', ran && moved, 'ran=' + ran + ' moved=' + moved);
ok('the button now reads Hide app', app && /Hide app/.test(app.btn));
await shot('app');
await page.click('.qbWin [data-qb="retry"]');
const retried = await page.evaluate(() => ({
  checked: !!document.querySelector('.qbWin .qbOpt.right'),
  picked: !!document.querySelector('.qbWin .qbOpt.picked'),
  app: !!document.querySelector('.qbWin .qbApp')
}));
ok('↺ Try again clears the marking and the choice, and keeps the app open', !retried.checked && !retried.picked && retried.app, JSON.stringify(retried));
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
ok('Escape closes the window, and the app’s frame goes with it',
  await page.evaluate(() => !document.querySelector('.qbWinBack') && !document.querySelector('iframe.question-app-frame')));

console.log('\n✍️ Blanks, a table and written answers');
await page.evaluate(() => $('bankQBtn').click());
await page.waitForSelector('.qbRow[data-qid="q2"]');
await page.click('.qbRow[data-qid="q2"]');
await page.click('.qbPreview [data-qb="add"]');
await page.waitForFunction(() => annotations.filter(annBankQ).length === 2, null, { timeout: 8000 }).catch(() => {});
const second = await page.evaluate(() => {
  const qs = annotations.filter(annBankQ);
  const a = qs[1];
  return a ? { id: a.id, table: a.bq.blocks.find(b => b.type === 'table').data, dx: Math.abs(a.x - qs[0].x) + Math.abs(a.y - qs[0].y) } : null;
});
ok('a second question lands too, stepped off the first', second && second.dx > 0, JSON.stringify(second));
ok('…its table travels as rows of cells', second && Array.isArray(second.table) && second.table[1][1] === 'Steam', JSON.stringify(second && second.table));
await page.evaluate(id => bankQOpen(id, false), second.id);
await page.waitForSelector('.qbWin .qbBlank');
const blanks = await page.$$('.qbWin .qbBlank');
ok('the fill-in-the-blank sentence has a box for each blank', blanks.length === 2);
await blanks[0].fill('Evaporates');
await blanks[1].fill('melts');
const cer = await page.$$('.qbWin .qbCer textarea');
ok('a claim–evidence–reasoning answer has three boxes', cer.length === 3);
if (cer[0]) await cer[0].fill('The water evaporated.');
await page.click('.qbWin [data-qb="check"]');
const marked = await page.evaluate(() => ({
  right: document.querySelectorAll('.qbWin .qbBlank.right').length,
  wrong: document.querySelectorAll('.qbWin .qbBlank.wrong').length,
  fix: (document.querySelector('.qbWin .qbFix') || {}).textContent || '',
  score: (document.querySelector('.qbWin .qbScore') || {}).textContent || '',
  model: /Heat makes water evaporate/.test(document.querySelector('.qbWin').innerText),
  kept: (document.querySelector('.qbWin .qbCer textarea') || {}).value || '',
  table: (document.querySelector('.qbWin .qbTable') || {}).innerText || '',
  parts: Array.from(document.querySelectorAll('.qbWin .qbPart')).map(n => n.textContent),
  marks: (document.querySelector('.qbWin .qbMarks') || {}).textContent || ''
}));
ok('✓ Check marks each blank, case aside, and shows the missed word', marked.right === 1 && marked.wrong === 1 && marked.fix === 'condenses', JSON.stringify(marked));
ok('…scores it', marked.score === '1 of 2 correct', marked.score);
ok('…reveals the model claim, evidence and reasoning, and keeps what was written', marked.model && marked.kept === 'The water evaporated.');
ok('the table, the parts and the marks are all drawn', /Steam/.test(marked.table) && marked.parts.join() === '(a),(b)' && marked.marks === '[2]', JSON.stringify(marked));
await shot('written');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

console.log('\n👩‍🎓 A student taps it open');
const student = await page.evaluate(async () => {
  currentUser = { uid: 'kid-1', email: 'kid@example.com', displayName: 'Kid' };
  applyRoleUI();
  setTool('select');
  const a = annotations.find(annBankQ);
  renderAllOverlays();
  const img = pages[0].svg.querySelector('g[data-id="' + a.id + '"] .pastePic img');
  const r = img.getBoundingClientRect();
  img.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse',
    button: 0, buttons: 1, isPrimary: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  await new Promise(r2 => setTimeout(r2, 60));
  return {
    hidden: getComputedStyle($('bankQBtn')).display === 'none',
    open: !!document.querySelector('.qbWin'),
    fresh: !document.querySelector('.qbWin .qbOpt.picked'),
    qr: getComputedStyle($('printQrBtn')).display === 'none'
  };
});
ok('the student has no 📚 button and no QR switch', student.hidden && student.qr, JSON.stringify(student));
ok('…and a tap on the question opens it', student.open);
ok('…fresh: the teacher’s answers were not left for the student', student.fresh);
const sOpen = await page.evaluate(() => {
  const back = document.querySelector('.qbWinBack');
  bankQ.openPicker();
  return { picker: !!document.querySelector('.qbPickBack'), back: !!back };
});
ok('…and the picker refuses a student even when called directly', !sOpen.picker);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

console.log('\n📝 Practice keeps the questions');
const practice = await page.evaluate(() => {
  currentUser = { uid: 'teacher-1', email: ADMIN_EMAIL, displayName: 'Teacher' };
  applyRoleUI();
  annotations.push({ id: 'ink1', page: 1, type: 'pen', color: '#000', width: 2, points: [{ x: 10, y: 10 }, { x: 40, y: 40 }] });
  const before = annotations.length;
  startPractice();
  const during = annotations.map(a => ({ bq: annBankQ(a), locked: !!a.locked }));
  const realLocked = teacherAnswers.filter(annBankQ).some(a => a.locked);
  endPractice();
  return { before, during, after: annotations.length, realLocked };
});
ok('practising shows the bank questions and hides the answers', practice.during.length === 2 && practice.during.every(x => x.bq && x.locked), JSON.stringify(practice));
ok('…as locked copies — the teacher’s own are untouched', !practice.realLocked);
ok('…and ending practice puts everything back', practice.after === practice.before);

console.log('\n🖨 Printing, with the QR code');
const qr = await page.evaluate(() => {
  printQrOn = false;
  const off = printQrUrl();
  $('printQrBtn').click();
  const on = printQrOn;
  currentDocId = '';
  const unsaved = printQrUrl();
  currentDocId = 'ws-123';
  wsShare = { mode: 'off', passwordHash: '' };
  const linkOff = printQrUrl();
  wsShare = { mode: 'view', passwordHash: '' };
  const url = printQrUrl();
  const qBank = answerAnnotations().filter(annBankQ).length;
  return { off, on, unsaved, linkOff, url, qBank, label: $('printQrLabel').textContent, pressed: $('printQrBtn').getAttribute('aria-pressed') };
});
ok('the QR switch turns on, and says so', qr.on && qr.label === 'QR code on page 1: On' && qr.pressed === 'true', JSON.stringify(qr));
ok('…no code while it is off, or before the worksheet is saved, or with the link switched off', qr.off === '' && qr.unsaved === '' && qr.linkOff === '');
ok('…otherwise the code carries the worksheet’s share link', /\?share=ws-123$/.test(qr.url), qr.url);
ok('the questions-only print keeps the bank questions and drops the ink', qr.qBank === 2);

if (hasPdfLib) {
  const pdf = await page.evaluate(async (url) => {
    const doc = await PDFLib.PDFDocument.create();
    doc.addPage([600, 780]);
    doc.addPage([600, 780]);
    pdfBytes = await doc.save();
    const bytes = await buildAnnotatedPdf(false, { anns: answerAnnotations().filter(annBankQ), qr: url });
    const out = await PDFLib.PDFDocument.load(bytes);
    const p1 = out.getPage(0), p2 = out.getPage(1);
    const links = [];
    const annots = p1.node.lookup(PDFLib.PDFName.of('Annots'));
    if (annots) for (let i = 0; i < annots.size(); i++) {
      const an = annots.lookup(i);
      const A = an.lookup(PDFLib.PDFName.of('A'));
      const uri = A && A.lookup(PDFLib.PDFName.of('URI'));
      const rect = an.lookup(PDFLib.PDFName.of('Rect'));
      links.push({ uri: uri ? uri.decodeText() : '', rect: rect ? rect.asArray().map(n => n.asNumber()) : [] });
    }
    const xobj = p1.node.Resources().lookup(PDFLib.PDFName.of('XObject'));
    const images = xobj ? xobj.keys().length : 0;
    const p2annots = p2.node.lookup(PDFLib.PDFName.of('Annots'));
    // The questions print with the code off.
    printQrOn = false;
    const plain = await PDFLib.PDFDocument.load(await buildAnnotatedPdf(false, { anns: answerAnnotations().filter(annBankQ), qr: printQrUrl() }));
    const plainAnnots = plain.getPage(0).node.lookup(PDFLib.PDFName.of('Annots'));
    return { links, images, size: bytes.length, p2annots: !!p2annots, plainLinks: plainAnnots ? plainAnnots.size() : 0 };
  }, qr.url);
  ok('the printed PDF carries the questions as pictures', pdf.images >= 2, JSON.stringify(pdf));
  ok('…and page 1 links to the worksheet through the QR code', pdf.links.length === 1 && pdf.links[0].uri === qr.url, JSON.stringify(pdf.links));
  ok('…in the top-right corner', pdf.links[0] && pdf.links[0].rect[0] > 450 && pdf.links[0].rect[1] > 650, JSON.stringify(pdf.links[0]));
  ok('…on page 1 only', !pdf.p2annots);
  ok('with the switch off, no code at all', pdf.plainLinks === 0);
  const decoded = await page.evaluate((url) => {
    const m = QuestionBank.pure.qrMatrix(url);
    return m && m.length;
  }, qr.url);
  ok('the code is a real QR code for that link', decoded >= 25, String(decoded));
} else {
  console.log('  – pdf-lib is not reachable here (set PDF_LIB=…) — the PDF half was skipped.');
}

console.log('\n🔄 A new worksheet or another person closes it all');
const gone = await page.evaluate(() => {
  const a = annotations.find(annBankQ);
  bankQOpen(a.id, true);
  const was = !!document.querySelector('.qbWin iframe');
  bankQWorksheetChanged();
  return { was, now: !!document.querySelector('.qbWin'), frames: document.querySelectorAll('iframe.question-app-frame').length };
});
ok('leaving the worksheet closes an open question and stops its app', gone.was && !gone.now && gone.frames === 0, JSON.stringify(gone));

console.log('\n📱 A phone');
await page.setViewportSize({ width: 390, height: 780 });
await page.evaluate(() => { $('bankQBtn').click(); });
await page.waitForSelector('.qbRow[data-qid="q1"]');
await page.click('.qbRow[data-qid="q1"]');
const phone = await page.evaluate(() => {
  const pick = document.querySelector('.qbPick').getBoundingClientRect();
  const add = document.querySelector('.qbPreview [data-qb="add"]').getBoundingClientRect();
  return { w: pick.width, fits: pick.right <= 390 && pick.left >= 0, addVisible: add.bottom <= 780 && add.width > 0,
    scroll: document.documentElement.scrollWidth <= 390 };
});
ok('the picker fits a phone, with ➕ Add in reach', phone.fits && phone.addVisible, JSON.stringify(phone));
await shot('phone');

ok('no uncaught error along the way', errors.length === 0, errors.join('\n      '));
await browser.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
