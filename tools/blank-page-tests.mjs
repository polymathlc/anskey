/* ➕ A BLANK PAGE and 📎 A PICTURE PASTED ONTO IT.

   Every failure here is silent. The blank page still appears, the picture
   still lands, the card still renders — and the worksheet is quietly wrong:

     - a page inserted into `pdfBytes` and NOT written back to Storage lives in
       one tab and nowhere else, so every picture put on it is an annotation
       pointing at a page that does not exist the next time the worksheet is
       opened;
     - a picture that stops being an `ainote` kind the card renderer already
       knows has to be taught to nine places, each of which fails quietly;
     - a kind missing from either PDF path prints as an empty box with a
       heading — a picture on screen and a gap on the sheet;
     - and a card sized off the wrong ratio is letterboxed, or taller than the
       paper and impossible to drag back into view.

   The geometry is cut out of index.html and RUN; the rules that are about
   ordering and about which function calls which are checked against the file
   itself, because that is the half no unit test can see. */
import fs from 'fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fail++;
  console.error('FAIL: ' + name + (extra === undefined ? '' : '  (' + extra + ')'));
}

/* ---------- the real sizing, run ---------- */
function cut(from, to, what) {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  if (a < 0 || b < 0) { console.error(what + ' section not found'); process.exit(1); }
  return html.slice(a, b);
}
const geom =
  cut('var PASTE_IMG_MAX_PX', 'function imageRatio(', 'paste geometry') +
  cut('function mmAttachX(page, w) {', '/* ✎ on a pinned card', 'mmAttach');

const del = cut('function annsAfterPageRemoved(', 'async function deletePage(', 'delete page');
const dmod = new Function(`
  function normalizeStarPages(v) {
    if (!Array.isArray(v)) return [];
    var seen = {}, out = [];
    v.forEach(function (n) {
      n = parseInt(n, 10);
      if (!(n > 0) || seen[n]) return;
      seen[n] = 1; out.push(n);
    });
    return out.sort(function (a, b) { return a - b; });
  }
  ` + del + `
  return { annsAfterPageRemoved, starsAfterPageRemoved, historyAfterPageRemoved };
`)();

const mod = new Function(`
  var AI_NOTE_HEAD_H = 18, AI_NOTE_MIN_W = 90, AI_NOTE_MIN_H = 60;
  var isStudent = function () { return false; };
  var isSharedVisitor = function () { return false; };
  var pdfDoc = {}, pages = [{}], annotations = [];
  var openDialog = null;   // the harness sets this to try a dialog being open
  var document = { querySelector: function (q) { return openDialog; }, activeElement: null };
  var window = { innerHeight: 900 };
  function round2(n) { return Math.round(n * 100) / 100; }
  function toast() {}
  ` + geom + `
  return { setOpenDialog: function (v) { openDialog = v; },
           pastePicBox: pastePicBox, pasteGoesToWorksheet: pasteGoesToWorksheet,
           PASTE_IMG_MAX_PX: PASTE_IMG_MAX_PX, PASTE_IMG_QUALITY: PASTE_IMG_QUALITY,
           PASTE_CASCADE: PASTE_CASCADE };
`)();

/* 🔒 THE PREDICATES AND THE RESIZE, run for real. A locked picture that can
   still be dragged is a lock that does nothing, and a picture that stretches
   on a corner drag is the one thing the frame used to hide — inside a frame
   `object-fit: contain` letterboxed the distortion away where nobody saw it. */
const hmod = new Function(`
  var AI_NOTE_MIN_W = 90, AI_NOTE_MIN_H = 60, PASTE_MIN_PX = 24;
  var annotations = [];
  function round2(n) { return Math.round(n * 100) / 100; }
  ` + cut('function annNoteMin(a) {', '/* Unrotated frame of an', 'predicates')
    + cut('function applyHandle(a, h, pt) {', 'function translateAnn(', 'applyHandle') + `
  return { annNoteMin, annLocked, annPastePic, annNoteMinW, annNoteMinH, applyHandle, picFitRatio };
`)();

const A4 = { num: 1, baseW: 595, baseH: 842, wrap: null };

/* A LANDSCAPE picture must come back a landscape card and a PORTRAIT one a
   portrait card. Letterboxing is what `object-fit: contain` then does to it —
   the picture is still all there, sitting in a band of empty card, and it
   reads as a paste that went wrong. */
const wide = mod.pastePicBox(A4, 16 / 9, 0);
const tall = mod.pastePicBox(A4, 3 / 4, 0);
ok('a wide picture gets a wide box', wide.w > wide.h, JSON.stringify(wide));
ok('a tall picture gets a tall box', tall.h > tall.w, JSON.stringify(tall));
/* THE BOX **IS** THE PICTURE. Nothing is added for a heading any more, so the
   box's own shape has to be the picture's — a stray + AI_NOTE_HEAD_H here is a
   band of nothing under every picture on the page. */
ok('the box matches the picture’s own ratio',
  Math.abs((wide.w / wide.h) - 16 / 9) < 0.02, JSON.stringify(wide));
ok('…and a portrait one too',
  Math.abs((tall.w / tall.h) - 3 / 4) < 0.02, JSON.stringify(tall));
ok('nothing is left over for a heading',
  !/AI_NOTE_HEAD_H/.test(cut('function pastePicBox(', 'function imageRatio(', 'box')));

/* NEVER TALLER THAN THE PAPER. A card that overhangs the page cannot be
   dragged back onto it — the drag is clamped to the page it is on. */
const skinny = mod.pastePicBox(A4, 0.2, 0);
ok('a very tall picture is capped to the page', skinny.h <= A4.baseH - 8, JSON.stringify(skinny));
ok('…and stays on the page top to bottom',
  skinny.y >= 0 && skinny.y + skinny.h <= A4.baseH, JSON.stringify(skinny));
const panorama = mod.pastePicBox(A4, 8, 0);
ok('a panorama stays on the page left to right',
  panorama.x >= 0 && panorama.x + panorama.w <= A4.baseW, JSON.stringify(panorama));
ok('a picture with NO ratio still gets a real box',
  mod.pastePicBox(A4, 0, 0).w >= 24 && mod.pastePicBox(A4, 0, 0).h >= 24);
/* A card's 90 x 60 floor made room for a heading and a body. A picture has
   neither, and that floor DISTORTED a wide thin one — an 8 : 1 panorama came
   back 6 : 1 for no reason anybody chose. */
ok('a panorama keeps its shape rather than being floored to a card',
  Math.abs((panorama.w / panorama.h) - 8) < 0.2, JSON.stringify(panorama));

/* A SECOND PICTURE MUST NOT LAND ON THE FIRST, or the teacher presses Ctrl+V,
   sees nothing move, and presses it again. */
const first = mod.pastePicBox(A4, 1, 0);
const second = mod.pastePicBox(A4, 1, 1);
ok('the second picture is stepped off the first',
  second.x !== first.x || second.y !== first.y, JSON.stringify([first, second]));
ok('the cascade comes back round rather than walking off the page',
  JSON.stringify(mod.pastePicBox(A4, 1, 6)) === JSON.stringify(first));
for (let i = 0; i < 12; i++) {
  const b = mod.pastePicBox(A4, 1, i);
  ok('picture ' + i + ' is on the page',
    b.x >= 0 && b.y >= 0 && b.x + b.w <= A4.baseW && b.y + b.h <= A4.baseH, JSON.stringify(b));
}

/* ---------- where a paste belongs ---------- */
/* Typing is the commonest thing a teacher is doing when they press Ctrl+V. A
   picture landing on the worksheet instead of in the box being typed into is
   the one way this feature is worse than not having it. */
function target(sel) {
  return { closest: (q) => (q.split(',').some((s) => sel.indexOf(s.trim()) !== -1) ? {} : null) };
}
ok('a paste with nothing focused goes to the worksheet',
  mod.pasteGoesToWorksheet({ target: { closest: () => null } }));
ok('a paste while typing in a text box does NOT',
  !mod.pasteGoesToWorksheet({ target: target('input') }));
ok('…nor in a textarea', !mod.pasteGoesToWorksheet({ target: target('textarea') }));
ok('…nor in a contenteditable — that is a text annotation being written',
  !mod.pasteGoesToWorksheet({ target: target('[contenteditable="true"]') }));
ok('…nor inside a floating window, which has its own paste',
  !mod.pasteGoesToWorksheet({ target: target('.modalBack') }));
/* A DIALOG covers the worksheet, so the paste is its own. A FLOATING window
   does not — the worksheet is live underneath it — so bailing on every open
   .modalBack would mean a teacher with the mindmap board open could not paste
   onto the page at all, and NEITHER handler would act on it. */
ok('the selector asks for a dialog and NOT a floating window',
  /\.modalBack\.open:not\(\.floatWin\)/.test(html));
mod.setOpenDialog({});
ok('a dialog over the worksheet takes the paste',
  !mod.pasteGoesToWorksheet({ target: { closest: () => null } }));
mod.setOpenDialog(null);
ok('…and with it shut the worksheet has it back',
  mod.pasteGoesToWorksheet({ target: { closest: () => null } }));

/* ---------- ONE page builder ---------- */
/* Opening a worksheet and ADDING a page to it are the same job downstream, so
   two builders is two that drift — and the one that drifts is always the one
   nobody opens a worksheet with. */
ok('loadPdf builds its pages through the shared builder',
  /async function loadPdf\([\s\S]{0,4000}?await buildPagesFromBytes\(contextCheck\);/.test(html));
ok('there is exactly ONE pdf.js getDocument in the app',
  (html.match(/pdfjsLib\.getDocument\(/g) || []).length === 1,
  (html.match(/pdfjsLib\.getDocument\(/g) || []).length);
ok('the builder is what addBlankPage rebuilds with',
  /async function addBlankPage\([\s\S]{0,8500}?await buildPagesFromBytes\(requireCurrent\);/.test(html));

const builder = cut('async function buildPagesFromBytes(contextCheck) {', '/* ================= ➕ A BLANK PAGE', 'builder');
/* A page added while the teacher is zoomed into a diagram must not throw them
   back out to the whole sheet — but a worksheet just OPENED is still fitted. */
ok('the builder keeps the zoom unless the pages were fitted',
  /if \(fittedWidth\) fitWidth\(\); else applyScale\(\);/.test(builder));
ok('loadPdf asks for the fit explicitly', /fittedWidth = true;\s*\n\s*await buildPagesFromBytes\(contextCheck\);/.test(html));
/* The overlays live on the SVGs the builder has just thrown away, so without
   this every annotation on the worksheet disappears off the screen the moment
   a page is added — while still sitting in the array, and still saved. */
ok('the builder draws the annotations back onto the new overlays',
  /renderAllOverlays\(\);/.test(builder));
ok('…and the page stars with them', /syncThumbStars\(\);/.test(builder));
ok('the builder rebuilds the thumbnails', /buildThumbs\(\);/.test(builder));
ok('the builder cancels the renders of the pages it is replacing',
  /renderTask\.cancel\(\)/.test(builder));

/* ---------- the blank page is a REAL PDF page ---------- */
const blank = cut('var BLANK_PAGE_W', '/* ================= 🗑 DELETING A PAGE', 'blank page');
ok('the page is made with pdf-lib from the captured worksheet bytes', /PDFLib\.PDFDocument\.load\(prev\.bytes\)/.test(blank));
ok('…and inserted after the page in view', /outDoc\.insertPage\(after,/.test(blank));
ok('…and it becomes the worksheet’s own bytes', /pdfBytes = nextBytes;/.test(blank));
/* Sized from the CURRENT page, including mixed portrait/landscape sheets. */
ok('the blank page is the size of the page before it',
  /outDoc\.insertPage\(after, \[source\.baseW \|\| BLANK_PAGE_W, source\.baseH \|\| BLANK_PAGE_H\]\)/.test(blank));
ok('with nothing open, a blank page IS the worksheet',
  /if \(!pdfDoc \|\| !pages\.length\)[\s\S]{0,600}?await loadPdf\(firstBytes, 'Blank worksheet', requireCurrent\)/.test(blank));
ok('adding a page is the teacher’s own',
  /if \(isStudent\(\) \|\| isSharedVisitor\(\)\)/.test(blank));

/* THE LOAD-BEARING ONE. performSave uploads the PDF only when the worksheet
   is NEW; every later save writes the annotations alone. So a page inserted
   without this is a page that exists in one tab and in no saved worksheet. */
ok('a saved worksheet’s PDF is written again',
  /if \(prev\.docId\) \{[\s\S]{0,300}?storage\.ref\(STORAGE_DIR \+ '\/' \+ prev\.docId \+ '\.pdf'\)[\s\S]{0,120}?\.put\(/.test(blank));
/* It goes up BEFORE the page is shown, or a failed upload is only found out
   about once there is work on the page to lose. */
ok('it is stored BEFORE the page is put on screen',
  blank.indexOf('.put(new Blob([nextBytes]') < blank.indexOf('await buildPagesFromBytes(requireCurrent);'));
ok('a page that could not be stored is taken back off',
  /pdfBytes = prev\.bytes; annotations = prev\.anns;/.test(blank));
/* Auto-save writes the annotations and the page stars and nothing else, so a
   worksheet that grew a page would go on saying "3 pages" in every list in
   the app until somebody happened to press Save. */
ok('the record is told how many pages there are now',
  /pageCount: outDoc\.getPageCount\(\), starPages: nextStars/.test(blank));
ok('…together with shifted annotations through the overflow-aware merge writer',
  /await writeAnnotations\(prev\.docId, JSON\.stringify\(nextAnns\),/.test(blank));
ok('the work is marked unsaved so the record catches up', /setDirty\(true\);/.test(blank));
ok('…and the local rescue copy carries the new page too', /scheduleDraftSave\(\);/.test(blank));

/* Run the actual insertion coordinator. Simulated PDF bytes retain page IDs
   and sizes so order, remapping, persistence, rollback and locks are observable
   across the same awaits as the application. */
function insertionHarness(options = {}) {
  return new Function('options', `
    var events = [], messages = [], uploads = 0, writes = 0, builds = 0;
    var time = 0, Date = { now: function () { return options.stalled ? (time += 15000) : globalThis.Date.now(); } };
    var encode = function (v) { return new TextEncoder().encode(JSON.stringify(v)); };
    var decode = function (v) { return JSON.parse(new TextDecoder().decode(v)); };
    var originalPdf = [{ id: 'first', w: 595, h: 842 }, { id: 'middle', w: 842, h: 595 }, { id: 'last', w: 612, h: 792 }];
    var pdfBytes = options.empty ? null : encode(originalPdf);
    var annotations = options.empty ? [] : [
      { id: 'a', page: 1, text: 'first' }, { id: 'b', page: 2, text: 'typed', kw: [0] },
      { id: 'c', page: 3, type: 'pen', points: [[1, 2], [3, 4]] }
    ];
    var undoStack = [JSON.stringify(annotations)], redoStack = [JSON.stringify([{ id: 'r', page: 3 }])];
    var wsMeta = { starPages: [1, 2, 3] }, dirty = options.dirty !== false, selectedId = 'b', editModeId = 'b', editingId = 'b';
    var lastAnswerKey = { items: [{ page: 3 }] }, wsEpoch = 5;
    var annOverflow = false, lastAnnUpload = { path: '', stamp: '' };
    var currentDocId = options.unsaved || options.empty ? null : 'worksheet', currentUser = { uid: 'teacher' };
    var practiceMode = !!options.practice, aiBusy = !!options.aiBusy, autoRunning = false, notesBusy = false;
    var autoSaveTimer = null, autoSaveInFlight = !!options.saving, autoSaveQueued = false;
    var askTarget = { kind: 'page', page: 3 }, askThreads = { 'page:3': ['old'] }, askCredits = { 'page:3': 20 };
    var aiNoteEdit = { page: 3 }, videoBtnEdit = { page: 3 }, recTarget = { page: 3 };
    var elements = { blankPageBtn: { disabled: false }, saveBtn: { disabled: false }, deletePageBtn: { disabled: false } };
    var document = { body: { inert: false } }, listeners = new Set();
    var window = { addEventListener: function (name) { listeners.add(name); }, removeEventListener: function (name) { listeners.delete(name); } };
    var console = { error: function () {} };
    function $(id) { return elements[id]; }
    function lessonGuardChange() { return true; }
    function isStudent() { return !!options.student; }
    function isSharedVisitor() { return !!options.visitor; }
    function recBusy() { return false; }
    function recUploadsPending() { return 0; }
    function commitActiveTextEdit() { if (options.typed) annotations[1].text = options.typed; editingId = null; events.push('commit'); }
    function suspendPointerInput() { events.push('suspend'); }
    function toast(message) { messages.push(message); }
    function starredPages() { return wsMeta.starPages; }
    function normalizeStarPages(list) { return [...new Set(list)].sort(function (a, b) { return a - b; }); }
    function makePages(bytes) { return decode(bytes).map(function (p, i) { return {
      num: i + 1, baseW: p.w, baseH: p.h, wrap: { scrollIntoView: function () { events.push('land:' + (i + 1)); } }
    }; }); }
    var pages = options.empty ? [] : makePages(pdfBytes), pdfDoc = options.empty ? null : { numPages: pages.length };
    function mmTargetPage() { return pages[(options.current || 2) - 1]; }
    var remote = { pdf: pdfBytes && decode(pdfBytes), anns: JSON.parse(JSON.stringify(annotations)), count: pages.length, stars: wsMeta.starPages.slice() };
    function switchIf(stage) {
      if (options.switchAt !== stage) return;
      options.switchAt = '';
      if (options.switchAccount) currentUser = { uid: 'another-user' };
      currentDocId = 'other-worksheet'; wsEpoch++;
      pdfBytes = encode([{ id: 'new-document', w: 400, h: 500 }]);
      annotations = [{ id: 'new-answer', page: 1, text: 'keep this' }];
      undoStack = ['new-undo']; redoStack = ['new-redo']; wsMeta.starPages = [1];
      annOverflow = true; lastAnnUpload = { path: 'new-cache', stamp: 'new-stamp' };
      pages = makePages(pdfBytes); pdfDoc = { numPages: 1 }; lastAnswerKey = { other: true };
    }
    var STORAGE_DIR = 'pdfs';
    var storage = { ref: function (path) { return { put: async function (blob) {
      uploads++; events.push('upload:' + uploads); events.push('path:' + path);
      if (options.failUpload && uploads === 1 || options.failRollback && uploads === 2) throw new Error('upload refused');
      remote.pdf = decode(new Uint8Array(await blob.arrayBuffer()));
      switchIf('upload');
    } }; } };
    async function writeAnnotations(id, json, extra, context) {
      if (context) context.check();
      writes++; events.push('write:' + writes);
      events.push('doc:' + id);
      if (!autoSaveInFlight) throw new Error('autosave was not locked');
      if (options.failMetadata && writes === 1) throw new Error('metadata refused');
      remote.anns = JSON.parse(json); remote.count = extra.pageCount; remote.stars = extra.starPages;
      switchIf('metadata');
      if (context) context.check();
    }
    var PDFLib = { PDFDocument: {
      load: async function (bytes) { var docPages = decode(bytes); switchIf('pdf-load'); return {
        insertPage: function (at, size) { events.push('insert:' + at); docPages.splice(at, 0, { id: 'blank', w: size[0], h: size[1] }); },
        save: async function () { switchIf('pdf-save'); return encode(docPages); }, getPageCount: function () { return docPages.length; }
      }; },
      create: async function () { var docPages = []; return {
        addPage: function (size) { docPages.push({ id: 'blank', w: size[0], h: size[1] }); },
        save: async function () { switchIf('blank-create'); return encode(docPages); }
      }; }
    } };
    async function buildPagesFromBytes(contextCheck) {
      builds++; events.push('build:' + builds);
      if (options.failRender && builds === 1) throw new Error('render refused');
      switchIf('render');
      if (contextCheck) contextCheck();
      pages = makePages(pdfBytes); pdfDoc = { numPages: pages.length };
    }
    async function loadPdf(bytes, name, contextCheck) { wsEpoch++; pdfBytes = bytes; await buildPagesFromBytes(contextCheck); dirty = false; }
    function clearLassoSel() { events.push('clear-lasso'); }
    function updateAnswerKeyCard() { events.push('key-cleared'); }
    function autoLearnReset(drop) { events.push('learn-reset:' + drop); }
    function rememberStarPages(id, stars) { events.push('stars:' + stars.join(',')); }
    function setDirty(v) { dirty = v; }
    function scheduleDraftSave() { events.push('draft'); }
    function scheduleAutoSave() { events.push('autosave'); }
    ${blank}
    return {
      run: addBlankPage, remap: annsAfterPageInserted, stars: starsAfterPageInserted, history: historyAfterPageInserted,
      unlock: function () { autoSaveInFlight = false; },
      state: function () { return { pdf: pdfBytes && decode(pdfBytes), annotations: annotations, undo: undoStack, redo: redoStack,
        stars: wsMeta.starPages, remote: remote, key: lastAnswerKey, epoch: wsEpoch, askTarget: askTarget, askThreads: askThreads,
        docId: currentDocId, uid: currentUser.uid, annOverflow: annOverflow, lastAnnUpload: lastAnnUpload,
        inert: document.body.inert, disabled: elements.blankPageBtn.disabled, locked: autoSaveInFlight, listeners: listeners.size,
        events: events, messages: messages, uploads: uploads, writes: writes, pageCount: pages.length, dirty: dirty }; }
    };
  `)(options);
}

const inserted = insertionHarness({ typed: 'The exact words just typed.' });
const beforeInsert = inserted.state();
await inserted.run();
const added = inserted.state();
ok('the new page follows the current middle page, not the document end',
  added.pdf.map(p => p.id).join(',') === 'first,middle,blank,last');
ok('the new page inherits the current landscape page dimensions', added.pdf[2].w === 842 && added.pdf[2].h === 595);
ok('annotations keep their original page before/at insertion and move after it',
  added.annotations.map(a => a.page).join(',') === '1,2,4');
ok('newly typed text is committed before numbering and storage change', added.remote.anns[1].text === 'The exact words just typed.');
ok('ink points and keyword marks are preserved', JSON.stringify(added.annotations[2].points) === '[[1,2],[3,4]]' && added.annotations[1].kw[0] === 0);
ok('insertion does not mutate earlier annotation snapshots', beforeInsert.annotations[2].page === 3);
ok('both undo and redo keep their content on the right pages', JSON.parse(added.undo[0])[2].page === 4 && JSON.parse(added.redo[0])[0].page === 4);
ok('stars shift with their pages', added.stars.join(',') === '1,2,4');
ok('saved PDF, annotation numbering, star numbering and count agree',
  added.remote.pdf.map(p => p.id).join(',') === 'first,middle,blank,last' && added.remote.anns[2].page === 4 && added.remote.count === 4 && added.remote.stars.join(',') === '1,2,4');
ok('the saved metadata reaches storage before the new page is shown', added.events.indexOf('write:1') < added.events.indexOf('build:1'));
ok('the new blank page is brought into view', added.events.includes('land:3'));
ok('old answer key and page-based AI context are invalidated', added.key === null && added.askTarget === null && Object.keys(added.askThreads).length === 0 && added.epoch > 5);
ok('finished insertion releases input, keyboard and autosave locks', !added.inert && !added.disabled && !added.locked && added.listeners === 0);
ok('corrupt history is discarded instead of restoring old page numbers', inserted.history(['not-json'], 2).length === 0);

for (const [label, options] of [
  ['PDF upload', { failUpload: true }], ['metadata', { failMetadata: true }], ['rendering', { failRender: true }]
]) {
  const attempt = insertionHarness(options);
  await attempt.run();
  const s = attempt.state();
  ok(label + ' failure restores the local PDF and page numbering', s.pdf.map(p => p.id).join(',') === 'first,middle,last' && s.annotations[2].page === 3 && s.stars.join(',') === '1,2,3');
  ok(label + ' failure leaves the stored PDF and metadata in agreement', s.remote.pdf.map(p => p.id).join(',') === 'first,middle,last' && s.remote.anns[2].page === 3 && s.remote.count === 3 && s.remote.stars.join(',') === '1,2,3');
  ok(label + ' failure retains both history stacks', JSON.parse(s.undo[0])[2].page === 3 && JSON.parse(s.redo[0])[0].page === 3);
  ok(label + ' failure releases input and saving locks', !s.inert && !s.disabled && !s.locked && s.listeners === 0);
  ok(label + ' failure reports the problem', s.messages.some(m => m.includes('could not be added')));
}
const unrestored = insertionHarness({ failMetadata: true, failRollback: true });
await unrestored.run();
ok('a cloud rollback failure is reported explicitly, preserving local work',
  unrestored.state().messages.some(m => m.includes('cloud copy could not be restored')) && unrestored.state().annotations[2].page === 3);
const unsaved = insertionHarness({ unsaved: true, current: 1 });
await unsaved.run();
ok('an unsaved worksheet inserts after page one without cloud writes', unsaved.state().pdf[1].id === 'blank' && unsaved.state().uploads === 0 && unsaved.state().writes === 0 && unsaved.state().dirty);
const atEnd = insertionHarness({ current: 3 });
await atEnd.run();
ok('selecting the last page still adds the blank at the end', atEnd.state().pdf[3].id === 'blank' && atEnd.state().annotations[2].page === 3);
const empty = insertionHarness({ empty: true });
await empty.run();
ok('an empty screen creates one A4 page and re-enables the button', empty.state().pageCount === 1 && empty.state().pdf[0].w === 595.28 && !empty.state().disabled && !empty.state().locked);
for (const gate of ['practice', 'student', 'visitor', 'aiBusy']) {
  const denied = insertionHarness({ [gate]: true });
  await denied.run();
  ok(gate + ' cannot mutate page numbering', denied.state().uploads === 0 && denied.state().pageCount === 3);
}
const concurrent = insertionHarness({ saving: true });
const pendingInsert = concurrent.run();
await concurrent.run();
ok('an existing autosave finishes before PDF or annotations change', concurrent.state().uploads === 0 && concurrent.state().pageCount === 3);
concurrent.unlock();
await pendingInsert;
ok('a second click while inserting cannot create duplicate pages', concurrent.state().pageCount === 4 && concurrent.state().uploads === 1);
const stalled = insertionHarness({ saving: true, stalled: true });
await stalled.run();
ok('a stalled autosave cannot trap the worksheet behind the input lock', !stalled.state().inert && !stalled.state().disabled && stalled.state().uploads === 0 && stalled.state().messages.some(m => m.includes('taking too long')));
const savedRestore = insertionHarness({ dirty: false, failMetadata: true });
await savedRestore.run();
ok('rollback preserves an originally clean saved document', !savedRestore.state().dirty && savedRestore.state().pageCount === 3);
for (const stage of ['pdf-load', 'pdf-save', 'upload', 'metadata', 'render']) {
  for (const switchAccount of [false, true]) {
    const changed = insertionHarness({ switchAt: stage, switchAccount });
    await changed.run();
    const s = changed.state(), label = (switchAccount ? 'account' : 'worksheet') + ' changed during ' + stage;
    ok(label + ' preserves the newly opened worksheet', s.docId === 'other-worksheet' && s.pdf[0].id === 'new-document' && s.annotations[0].id === 'new-answer' && s.pageCount === 1);
    ok(label + ' preserves its history, stars, answer key and annotation cache', s.undo[0] === 'new-undo' && s.redo[0] === 'new-redo' && s.stars.join(',') === '1' && s.key.other && s.annOverflow && s.lastAnnUpload.path === 'new-cache');
    ok(label + ' never sends old bytes or annotations to the new document', !s.events.some(e => e.includes('path:pdfs/other-worksheet') || e === 'doc:other-worksheet'));
    ok(label + ' releases input lock', !s.inert && !s.disabled && !s.locked);
    if (!switchAccount) ok(label + ' restores the original saved document', s.remote.pdf.map(p => p.id).join(',') === 'first,middle,last' && s.remote.anns[2].page === 3);
  }
}
const switchedBlank = insertionHarness({ empty: true, switchAt: 'blank-create' });
await switchedBlank.run();
ok('a worksheet opened while a new blank PDF is encoding is preserved', switchedBlank.state().pdf[0].id === 'new-document' && switchedBlank.state().annotations[0].id === 'new-answer');

// Exercise the REAL overflow-aware writer, including its awaits, so the
// coordinator's guard cannot leave another worksheet's cache contaminated.
const writerSource = cut('async function annotationFields(', '/* Read them back from wherever', 'annotation writer');
function guardedWriterHarness(stage) {
  return new Function('stage', `
    var annOverflow = false, lastAnnUpload = { path: 'old-cache', stamp: 'old-stamp' };
    var ANN_INLINE_LIMIT = 5, COLLECTION = 'worksheets', active = true, writes = 0;
    function annByteLength(json) { return json.length; }
    function annStoragePath(id) { return 'pdfs/' + id + '.annotations.json'; }
    function annStamp(json) { return String(json.length); }
    function change() { active = false; annOverflow = true; lastAnnUpload = { path: 'new-cache', stamp: 'new-stamp' }; }
    var firebase = { firestore: { FieldValue: { delete: function () { return 'DELETE'; }, serverTimestamp: function () { return 'NOW'; } } } };
    var storage = { ref: function () { return { put: async function () { if (stage === 'overflow') change(); } }; } };
    var db = { collection: function () { return { doc: function () { return { set: async function () { writes++; if (stage === 'metadata') change(); } }; } }; } };
    ${writerSource}
    return { run: function () { return writeAnnotations('original', '[{"page":4}]', { pageCount: 4 }, {
      check: function () { if (!active) throw new Error('context changed'); }, apply: function () { return active; },
      overflow: false, lastUpload: { path: '', stamp: '' }
    }); }, state: function () { return { annOverflow: annOverflow, lastAnnUpload: lastAnnUpload, writes: writes }; } };
  `)(stage);
}
for (const stage of ['overflow', 'metadata']) {
  const writer = guardedWriterHarness(stage);
  let error;
  try { await writer.run(); } catch (e) { error = e; }
  ok('real writer detects context change after ' + stage + ' await', error && error.message === 'context changed');
  ok('real writer leaves the new document cache intact after ' + stage, writer.state().annOverflow && writer.state().lastAnnUpload.path === 'new-cache');
  if (stage === 'overflow') ok('stale overflow upload cannot trigger a metadata write', writer.state().writes === 0);
}

/* ---------- the pasted picture is a kind, not a new type ---------- */
ok('a pasted picture is an ainote card',
  /type: 'ainote', kind: 'paste'/.test(html));
ok('aiNoteKindInfo knows the pasted picture',
  /if \(k === 'paste'\) return PASTE_NOTE_KIND;/.test(html));
/* It is not something the ✨ Generate chooser can be asked for, so it must
   not appear there as a fifth tile. */
const kinds = cut('var AI_NOTE_KINDS = [', '/* PASTE_NOTE_KIND', 'kinds');
ok('…and it is NOT in the Generate chooser', !/key: 'paste'/.test(kinds));
ok('the card is sized for a picture', /paste:\s*\{ w: \d+, h: \d+ \}/.test(html));

/* A pasted picture came off the clipboard: there is nothing to ask the model
   for again, and the AI note dialog would offer exactly that. */
ok('a pasted card gets no ✨ redo button',
  /!isStudent\(\) && !isSharedVisitor\(\) && a\.kind !== 'paste'/.test(html));
ok('double-tapping one opens the resize handles, not the AI dialog',
  /if \(a\.kind === 'paste'\) \{[\s\S]{0,220}?editModeId = id;/.test(html));

/* ---------- both PDF paths ---------- */
/* Missed, the picture is on the screen and the printed sheet has an empty box
   with a heading where it should be. */
ok('the picture is EMBEDDED in the printed PDF',
  /a\.kind === 'image' \|\| a\.kind === 'mindmap' \|\| a\.kind === 'paste'\) &&\s*\n?\s*\/\^data:image/.test(html));
ok('…and PAINTED by the card painter',
  /if \(a\.kind === 'image' \|\| a\.kind === 'mindmap' \|\| a\.kind === 'paste'\) \{\s*\n\s*if \(o\.image\)/.test(html));
ok('the card body would still draw it, if it ever got there',
  /\} else if \(a\.kind === 'image' \|\| a\.kind === 'mindmap' \|\| a\.kind === 'paste'\) \{/.test(html));

/* ---------- 📎 NO WINDOW ROUND THE PICTURE ---------- */
/* The card came FIRST and the picture was inside it, so the screen renderer
   has to turn away before it builds any of that. Miss this and the heading,
   the border and the coloured spine are back over the printed question. */
ok('the screen renderer turns a pasted picture away before the card',
  /function aiNoteCardNode\(a\) \{\s*\n\s*if \(annNoteMin\(a\)\) return aiNotePillNode\(a\);\s*\n\s*if \(annPastePic\(a\)\) return pastePicNode\(a\);/.test(html));
const picNode = cut('function pastePicNode(a) {', 'function aiNoteCardNode(', 'pastePicNode');
ok('…and what it draws is the picture and nothing else',
  /className = 'pastePic'/.test(picNode) &&
  !/aiNoteHead|aiNoteBtn|aiNoteTitle|aiNoteBody/.test(picNode));
/* An <img> is natively draggable: without this a mouse drag on the picture
   starts the browser's own drag of the image file instead of moving it. */
ok('…with the browser’s own image drag switched off', /img\.draggable = false/.test(picNode));
ok('the stylesheet gives it no frame at all',
  /\.pastePic \{ display: block; width: 100%; height: 100%; \}/.test(html) &&
  /\.pastePic img \{[\s\S]{0,400}?object-fit: contain/.test(html));

/* ON PAPER TOO, or the picture is frameless on screen and prints with a
   heading band — found only once the sheet is in front of a class. */
/* The anchor is the PDF branch's OWN first line — `if (annPastePic(a)) {` on
   its own is a substring of `applyHandle`'s copy of the same test, which sits
   earlier in the file, so a bare cut on it silently slices the resize instead
   and this check then reports on code it was never about. */
const pdfPaste = cut('  if (annPastePic(a)) {\n    if (o.image) {',
                     '  var headH = Math.min(14', 'pdf paste');
ok('the printed picture has no heading, border or spine',
  /page\.drawImage/.test(pdfPaste) && !/drawRectangle/.test(pdfPaste));
ok('…and is FITTED, not stretched, so paper agrees with `contain`',
  /Math\.min\(pw \/ o\.image\.width, ph \/ o\.image\.height\)/.test(pdfPaste));
ok('…before any of the chrome is drawn',
  html.indexOf('if (annPastePic(a)) {\n    if (o.image) {') <
  html.indexOf('var headH = Math.min(14'));

/* ---------- 🔒 LOCKED IN POSITION ---------- */
ok('a lock is one flag, read in one place',
  /function annLocked\(a\) \{ return !!\(a && a\.locked\); \}/.test(html));
ok('the eraser steps over a locked picture', /if \(annLockedId\(id\)\) continue;/.test(html));
ok('the lasso steps over it too',
  /if \(annLocked\(a\)\) return;\s*\n\s*var b = annBBox\(a\);/.test(html));
ok('the select tool selects it and does not pick it up',
  /if \(annLocked\(selA\)\) return;/.test(html));
ok('a card’s grip does not pick it up either',
  /if \(annLocked\(gAnn\)\) return;/.test(html));
ok('the resize refuses it', /if \(annLocked\(a\)\) return;/.test(cut('function applyHandle(', 'function translateAnn(', 'ah')));
ok('…and no handles are drawn on it at all',
  /\} else if \(annLocked\(a\)\) \{/.test(html));
/* A lock nothing can undo is a picture nobody can take off the page. */
ok('a locked picture can still be removed from its own bar',
  /function removePictureAnn\(id\) \{[\s\S]{0,260}?deleteSelected\(\);/.test(html));
ok('the lock flag is DELETED rather than written false',
  /if \(a\.locked\) delete a\.locked; else a\.locked = true;/.test(html));
/* The controls have to exist somewhere, and a frameless picture has no
   heading to put them on — so they are on the bar, which is drawn only while
   the picture is the one in hand. */
ok('its bar carries Lock and Remove',
  /🔓 Unlock' : '🔒 Lock'/.test(html) && /'✕ Remove'/.test(html));
ok('…and is only drawn while it is selected',
  /else if \(annPastePic\(a\) && !isStudent\(\) && !isSharedVisitor\(\)\) renderPictureBar/.test(html));
ok('a student never gets the bar',
  /function togglePictureLock\(id\) \{\s*\n\s*if \(isStudent\(\) \|\| isSharedVisitor\(\)\) return;/.test(html));

/* ---------- the resize, run for real ---------- */
function box(o) { return { type: 'ainote', kind: 'paste', ratio: 2, x: 100, y: 100, w: 200, h: 100, ...o }; }
let r = box();
hmod.applyHandle(r, 'se', { x: 400, y: 400 });
ok('a corner drag keeps the picture’s shape', Math.abs(r.w / r.h - 2) < 0.02, JSON.stringify(r));
ok('…anchored to the opposite corner', r.x === 100 && r.y === 100, JSON.stringify(r));
r = box();
hmod.applyHandle(r, 'nw', { x: 0, y: 0 });
ok('…and dragging the top-left anchors the bottom-right',
  Math.abs((r.x + r.w) - 300) < 0.02 && Math.abs((r.y + r.h) - 200) < 0.02, JSON.stringify(r));
ok('…still in the picture’s shape', Math.abs(r.w / r.h - 2) < 0.02, JSON.stringify(r));
r = box();
hmod.applyHandle(r, 'ne', { x: 400, y: 0 });
ok('…the bottom-left for the top-right',
  r.x === 100 && Math.abs((r.y + r.h) - 200) < 0.02, JSON.stringify(r));
r = box();
hmod.applyHandle(r, 'sw', { x: 0, y: 400 });
ok('…and the top-right for the bottom-left',
  Math.abs((r.x + r.w) - 300) < 0.02 && r.y === 100, JSON.stringify(r));
/* THE SCALE IS THE DRAG PROJECTED ONTO THE SHAPE'S OWN DIAGONAL, and these
   four cases are why. Whichever way the corner is pulled the picture has to
   ANSWER: a "larger axis wins" rule leaves a wide picture dead when it is
   pulled straight in along its long edge (the height never moved, so the scale
   never moves) and a "smaller axis wins" rule leaves it dead when pulled
   straight out — and a handle that does nothing reads as a feature that does
   not work. On a true diagonal it must be EXACT, and it must be IDEMPOTENT,
   because it runs on every single pointermove with no start snapshot kept. */
let fit = hmod.picFitRatio(200, 100, 2, 24, 24);
ok('a drag straight down the diagonal comes back exact',
  Math.abs(fit.w - 200) < 0.001 && Math.abs(fit.h - 100) < 0.001, JSON.stringify(fit));
ok('…so running it again changes nothing',
  JSON.stringify(hmod.picFitRatio(fit.w, fit.h, 2, 24, 24)) === JSON.stringify(fit));
ok('a corner pulled straight IN along the long edge still shrinks',
  hmod.picFitRatio(140, 100, 2, 24, 24).w < 195,
  JSON.stringify(hmod.picFitRatio(140, 100, 2, 24, 24)));
ok('…and one pulled straight OUT along it still grows',
  hmod.picFitRatio(260, 100, 2, 24, 24).w > 205,
  JSON.stringify(hmod.picFitRatio(260, 100, 2, 24, 24)));
ok('…and both keep the shape',
  Math.abs(hmod.picFitRatio(140, 100, 2, 24, 24).w / hmod.picFitRatio(140, 100, 2, 24, 24).h - 2) < 0.001
  && Math.abs(hmod.picFitRatio(260, 100, 2, 24, 24).w / hmod.picFitRatio(260, 100, 2, 24, 24).h - 2) < 0.001);
/* THE FLOOR KEEPS THE SHAPE TOO, or a picture dragged down to nothing comes
   back as a square. Whichever floor bites harder is the one that decides. */
fit = hmod.picFitRatio(2, 2, 2, 24, 24);
ok('the floor keeps the picture’s shape', Math.abs(fit.w / fit.h - 2) < 0.001
  && fit.w >= 24 && fit.h >= 24, JSON.stringify(fit));
fit = hmod.picFitRatio(2, 2, 0.25, 24, 24);
ok('…whichever way round the picture is', Math.abs(fit.w / fit.h - 0.25) < 0.001
  && fit.w >= 24 && fit.h >= 24, JSON.stringify(fit));
ok('a negative drag is read by its distance', Math.abs(
  hmod.picFitRatio(-200, -100, 2, 24, 24).w - 200) < 0.001);

/* A picture pasted before `ratio` was stored has none. Free resize is what it
   always had, and `contain` is what stops that one ever looking stretched. */
r = box({ ratio: undefined });
hmod.applyHandle(r, 'se', { x: 400, y: 150 });
ok('a picture with no stored ratio resizes freely',
  Math.abs(r.w - 300) < 0.02 && Math.abs(r.h - 50) < 0.02, JSON.stringify(r));
ok('…which is `picFitRatio` refusing to invent one',
  JSON.stringify(hmod.picFitRatio(300, 50, 0, 24, 24)) === JSON.stringify({ w: 300, h: 50 }));
/* A CARD keeps its own 90 x 60 floor: there is a heading and a body inside it
   that have nowhere else to go. */
r = { type: 'ainote', kind: 'notes', x: 100, y: 100, w: 200, h: 100 };
hmod.applyHandle(r, 'se', { x: 101, y: 101 });
ok('a note card keeps the card floor', r.w === 90 && r.h === 60, JSON.stringify(r));
ok('…and a picture gets a far smaller one',
  hmod.annNoteMinW({ type: 'ainote', kind: 'paste' }) === 24);
r = box({ locked: true });
hmod.applyHandle(r, 'se', { x: 400, y: 400 });
ok('a LOCKED picture is not resized at all',
  r.w === 200 && r.h === 100 && r.x === 100 && r.y === 100, JSON.stringify(r));
/* `min` on a pasted picture can only have come from a save made while it still
   had a frame to fold into. Drawn as a pill it would be a photograph squashed
   into a 60-point tab. */
ok('a pasted picture is never folded to a pill',
  !hmod.annNoteMin({ type: 'ainote', kind: 'paste', min: true }));
ok('…but a note card still is',
  hmod.annNoteMin({ type: 'ainote', kind: 'notes', min: true }));

ok('the resize reads `picFitRatio` rather than carrying its own arithmetic',
  /var fit = picFitRatio\(pt\.x - nfx, pt\.y - nfy, a\.ratio,/.test(html)
  && (html.match(/function picFitRatio\(/g) || []).length === 1);

/* ---------- the paste itself ---------- */
const paste = cut('/* ================= 📎 PASTE A PICTURE', "document.addEventListener('paste'", 'paste');
/* A phone photo is megabytes of data URL and the annotations are re-written
   on every auto-save. */
ok('a pasted photo is redrawn small', /shrinkImageDataUrl\(raw, PASTE_IMG_MAX_PX, PASTE_IMG_QUALITY\)/.test(paste));
ok('…at a quality a screenshot of text survives', mod.PASTE_IMG_QUALITY > 0.82, mod.PASTE_IMG_QUALITY);
ok('…and big enough for a worksheet page', mod.PASTE_IMG_MAX_PX >= 1200, mod.PASTE_IMG_MAX_PX);
/* The quality argument has to be OPTIONAL, or every existing caller of
   shrinkImageDataUrl silently changes what it stores. */
ok('shrinkImageDataUrl still defaults to what it always was',
  /quality = quality \|\| 0\.82;/.test(html));
ok('the picture goes on the page you are looking at', /var page = mmTargetPage\(\);/.test(paste));
ok('it goes on the undo stack like any annotation', /pushUndo\(\);/.test(paste));
ok('pasting a picture is the teacher’s own', /isStudent\(\) \|\| isSharedVisitor\(\)/.test(paste));
ok('a paste is saved', /scheduleAutoSave\(\);/.test(paste) && /scheduleDraftSave\(\);/.test(paste));
/* Text on the clipboard belongs to whatever the teacher was doing. */
ok('a paste with no picture in it is left alone',
  /if \(!hasImage\) return;/.test(html));
ok('a picture DROPPED on the page goes through the same door',
  /pasteImagesFromClipboard\(e\.dataTransfer\)/.test(html));

/* ---------- the way in ---------- */
ok('there is a Blank page button', /id="blankPageBtn"/.test(html));
ok('…wired to addBlankPage', /\$\('blankPageBtn'\)\.addEventListener\('click', addBlankPage\)/.test(html));
ok('…and an empty screen offers one too',
  /\$\('emptyBlankBtn'\)\.addEventListener\('click', addBlankPage\)/.test(html));
/* Hiding a button is not the lock — but it must be hidden too, or a student
   is offered something that refuses them. */
ok('a student never sees the button',
  /var TEACHER_TOOLBAR_IDS = \['uploadBtn', 'blankPageBtn'/.test(html));

/* ---------- 🗑 deleting a page ---------- */
/* DELETING A PAGE RENUMBERS EVERY PAGE AFTER IT — which is the whole
   difficulty, and the whole silent failure. Miss the shift and page 4's ink
   is drawn on what is now page 4 (the old page 5) on a worksheet that renders
   perfectly and is saved that way. */
const anns = [
  { id: 'a', page: 1 }, { id: 'b', page: 2 }, { id: 'c', page: 2 },
  { id: 'd', page: 3 }, { id: 'e', page: 5 }
];
const after = dmod.annsAfterPageRemoved(anns, 2);
ok('what was ON the deleted page goes with it',
  !after.some((a) => a.id === 'b' || a.id === 'c'), JSON.stringify(after));
ok('a page BEFORE it does not move',
  after.find((a) => a.id === 'a').page === 1);
ok('every page AFTER it moves up one',
  after.find((a) => a.id === 'd').page === 2 && after.find((a) => a.id === 'e').page === 4,
  JSON.stringify(after));
ok('nothing else is lost', after.length === 3, after.length);
/* The list handed in is the live `annotations`, so a remapper that wrote
   through it would renumber the very snapshots the undo stack is holding. */
ok('the annotations handed in are not written through',
  anns.find((a) => a.id === 'e').page === 5 && anns.length === 5);

const stars = dmod.starsAfterPageRemoved([1, 2, 4, 6], 2);
ok('a star on the deleted page goes', stars.indexOf(2) === -1, JSON.stringify(stars));
ok('the stars after it move up', JSON.stringify(stars) === '[1,3,5]', JSON.stringify(stars));
ok('deleting an unstarred page leaves the stars alone',
  JSON.stringify(dmod.starsAfterPageRemoved([1, 4], 9)) === '[1,4]');

/* A HISTORY SNAPSHOT LEFT UNSHIFTED is the same corruption one Ctrl+Z later —
   and worse, because by then nobody connects it to the delete. */
const hist = dmod.historyAfterPageRemoved(
  [JSON.stringify([{ id: 'x', page: 4 }, { id: 'y', page: 2 }])], 2);
ok('every undo snapshot is remapped too',
  JSON.parse(hist[0]).length === 1 && JSON.parse(hist[0])[0].page === 3, hist[0]);
ok('a snapshot that cannot be parsed is dropped, never kept unshifted',
  dmod.historyAfterPageRemoved(['not json'], 2).length === 0);
ok('both stacks go through it',
  /undoStack = historyAfterPageRemoved\(undoStack, num\);/.test(html) &&
  /redoStack = historyAfterPageRemoved\(redoStack, num\);/.test(html));

const dp = cut('async function deletePage(num) {', "/* ================= 📎 PASTE A PICTURE", 'deletePage');
/* A worksheet with no pages has nothing to render, nothing to save and no way
   back. */
ok('the last page cannot be deleted', /if \(pages\.length < 2\)/.test(dp));
/* In practice mode `annotations` is a CHILD'S attempt and the teacher's own
   answers are parked in `teacherAnswers`, which this never renumbers. */
ok('practice mode is refused', /if \(practiceMode\)/.test(dp));
ok('deleting a page is the teacher’s own',
  /if \(isStudent\(\) \|\| isSharedVisitor\(\)\)/.test(dp));
/* The PDF changes and is written to the cloud, so this is past what the undo
   stack can reach — the confirm has to say so rather than letting the teacher
   find out by pressing Ctrl+Z. */
ok('it asks first, and says it cannot be undone',
  /window\.confirm\(/.test(dp) && /cannot be undone/.test(dp));
ok('…and says how much written work goes with the page', /onIt \+ ' thing'/.test(dp));
ok('the page is removed with pdf-lib', /outDoc\.removePage\(num - 1\)/.test(dp));
/* Same load-bearing rule as the blank page: performSave uploads the file only
   when the worksheet is NEW, so without this the page is gone from the tab and
   still in the saved worksheet, every annotation after it one page out. */
ok('the stored PDF is written again',
  /if \(currentDocId\) \{[\s\S]{0,300}?storage\.ref\(STORAGE_DIR \+ '\/' \+ currentDocId \+ '\.pdf'\)[\s\S]{0,120}?\.put\(/.test(dp));
ok('…and the record is told how many pages are left',
  /pageCount: outDoc\.getPageCount\(\) \}, \{ merge: true \}/.test(dp));
ok('it is stored BEFORE anything on screen changes',
  dp.indexOf('.put(new Blob([pdfBytes]') < dp.indexOf('annotations = annsAfterPageRemoved('));
ok('a page that could not be removed from the stored file is put back',
  /catch \(upErr\) \{\s*\n\s*pdfBytes = prevBytes;\s*\n\s*throw upErr;/.test(dp));
/* Selection chrome drawn round an annotation that has just gone. */
ok('the selection is cleared with the page',
  /selectedId = null;/.test(dp) && /editModeId = null;/.test(dp));
ok('the stars are re-saved, not just re-drawn',
  /rememberStarPages\(currentDocId, starredPages\(\)\)/.test(dp));
/* An answer key built before the delete cites the OLD page numbers, and it is
   a card a teacher marks from. 📚 auto-learn holds page numbers too — in
   `autoSeenPage` and in every queued job — and a job captured for the page
   that has just gone must not be filed at all. */
ok('an answer key built on the old numbering is dropped', /lastAnswerKey = null;/.test(dp));
ok('the auto-learn queue is dropped rather than renumbered',
  /autoLearnReset\(true\)/.test(dp));
ok('the work is marked unsaved', /setDirty\(true\);/.test(dp));
ok('…and the local rescue copy follows', /scheduleDraftSave\(\);/.test(dp));
/* A failure part-way must not leave the screen showing pages the bytes in
   hand do not have. */
ok('a failure puts the screen back in step with the bytes',
  /catch \(e\) \{[\s\S]{0,400}?try \{ await buildPagesFromBytes\(\); \} catch/.test(dp));

ok('there is a Delete page button', /id="deletePageBtn"/.test(html));
ok('…wired to deletePage',
  /\$\('deletePageBtn'\)\.addEventListener\('click', function \(\) \{ deletePage\(\); \}\)/.test(html));
ok('a student never sees it', /'blankPageBtn', 'deletePageBtn'/.test(html));

console.log((fail ? 'FAILED ' : 'OK ') + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
