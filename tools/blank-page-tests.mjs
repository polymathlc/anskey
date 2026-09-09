/* ➕ A BLANK PAGE and 📎 A PICTURE PASTED ONTO IT.

   Every failure here is silent. The blank page still appears, the picture
   still lands, the card still renders — and the worksheet is quietly wrong:

     - a page appended to `pdfBytes` and NOT written back to Storage lives in
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
           pasteCardBox: pasteCardBox, pasteGoesToWorksheet: pasteGoesToWorksheet,
           PASTE_IMG_MAX_PX: PASTE_IMG_MAX_PX, PASTE_IMG_QUALITY: PASTE_IMG_QUALITY,
           PASTE_CASCADE: PASTE_CASCADE };
`)();

const A4 = { num: 1, baseW: 595, baseH: 842, wrap: null };

/* A LANDSCAPE picture must come back a landscape card and a PORTRAIT one a
   portrait card. Letterboxing is what `object-fit: contain` then does to it —
   the picture is still all there, sitting in a band of empty card, and it
   reads as a paste that went wrong. */
const wide = mod.pasteCardBox(A4, 16 / 9, 0);
const tall = mod.pasteCardBox(A4, 3 / 4, 0);
ok('a wide picture gets a wide card', wide.w > (wide.h - 18), JSON.stringify(wide));
ok('a tall picture gets a tall card', (tall.h - 18) > tall.w, JSON.stringify(tall));
ok('the card matches the picture’s own ratio',
  Math.abs((wide.w / (wide.h - 18)) - 16 / 9) < 0.06, JSON.stringify(wide));

/* NEVER TALLER THAN THE PAPER. A card that overhangs the page cannot be
   dragged back onto it — the drag is clamped to the page it is on. */
const skinny = mod.pasteCardBox(A4, 0.2, 0);
ok('a very tall picture is capped to the page', skinny.h <= A4.baseH - 8, JSON.stringify(skinny));
ok('…and stays on the page top to bottom',
  skinny.y >= 0 && skinny.y + skinny.h <= A4.baseH, JSON.stringify(skinny));
const panorama = mod.pasteCardBox(A4, 8, 0);
ok('a panorama stays on the page left to right',
  panorama.x >= 0 && panorama.x + panorama.w <= A4.baseW, JSON.stringify(panorama));
ok('a picture with NO ratio still gets a real box',
  mod.pasteCardBox(A4, 0, 0).w >= 90 && mod.pasteCardBox(A4, 0, 0).h >= 60);

/* A SECOND PICTURE MUST NOT LAND ON THE FIRST, or the teacher presses Ctrl+V,
   sees nothing move, and presses it again. */
const first = mod.pasteCardBox(A4, 1, 0);
const second = mod.pasteCardBox(A4, 1, 1);
ok('the second picture is stepped off the first',
  second.x !== first.x || second.y !== first.y, JSON.stringify([first, second]));
ok('the cascade comes back round rather than walking off the page',
  JSON.stringify(mod.pasteCardBox(A4, 1, 6)) === JSON.stringify(first));
for (let i = 0; i < 12; i++) {
  const b = mod.pasteCardBox(A4, 1, i);
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
  /async function loadPdf\([\s\S]{0,4000}?await buildPagesFromBytes\(\);/.test(html));
ok('there is exactly ONE pdf.js getDocument in the app',
  (html.match(/pdfjsLib\.getDocument\(/g) || []).length === 1,
  (html.match(/pdfjsLib\.getDocument\(/g) || []).length);
ok('the builder is what addBlankPage rebuilds with',
  /async function addBlankPage\([\s\S]{0,3000}?await buildPagesFromBytes\(\);/.test(html));

const builder = cut('async function buildPagesFromBytes() {', '/* ================= ➕ A BLANK PAGE', 'builder');
/* A page added while the teacher is zoomed into a diagram must not throw them
   back out to the whole sheet — but a worksheet just OPENED is still fitted. */
ok('the builder keeps the zoom unless the pages were fitted',
  /if \(fittedWidth\) fitWidth\(\); else applyScale\(\);/.test(builder));
ok('loadPdf asks for the fit explicitly', /fittedWidth = true;\s*\n\s*await buildPagesFromBytes\(\);/.test(html));
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
const blank = cut('var BLANK_PAGE_W', '/* ================= 📎 PASTE A PICTURE', 'blank page');
ok('the page is made with pdf-lib', /PDFLib\.PDFDocument\.load\(pdfBytes\)/.test(blank));
ok('…and appended to the document', /outDoc\.addPage\(/.test(blank));
ok('…and it becomes the worksheet’s own bytes', /pdfBytes = await outDoc\.save\(\);/.test(blank));
/* Sized from the LAST page, so a blank page in an A4 worksheet is A4 rather
   than a card stapled to the back of it. */
ok('the blank page is the size of the page before it',
  /outDoc\.addPage\(\[last\.baseW \|\| BLANK_PAGE_W, last\.baseH \|\| BLANK_PAGE_H\]\)/.test(blank));
ok('with nothing open, a blank page IS the worksheet',
  /if \(!pdfDoc \|\| !pages\.length\)[\s\S]{0,300}?await loadPdf\(await blankPdfBytes\(\)/.test(blank));
ok('adding a page is the teacher’s own',
  /if \(isStudent\(\) \|\| isSharedVisitor\(\)\)/.test(blank));

/* THE LOAD-BEARING ONE. performSave uploads the PDF only when the worksheet
   is NEW; every later save writes the annotations alone. So a page appended
   without this is a page that exists in one tab and in no saved worksheet. */
ok('a saved worksheet’s PDF is written again',
  /if \(currentDocId\) \{[\s\S]{0,300}?storage\.ref\(STORAGE_DIR \+ '\/' \+ currentDocId \+ '\.pdf'\)[\s\S]{0,120}?\.put\(/.test(blank));
/* It goes up BEFORE the page is shown, or a failed upload is only found out
   about once there is work on the page to lose. */
ok('it is stored BEFORE the page is put on screen',
  blank.indexOf('.put(new Blob([pdfBytes]') < blank.indexOf('await buildPagesFromBytes();'));
ok('a page that could not be stored is taken back off',
  /catch \(upErr\) \{\s*\n\s*pdfBytes = prevBytes;\s*\n\s*throw upErr;/.test(blank));
/* Auto-save writes the annotations and the page stars and nothing else, so a
   worksheet that grew a page would go on saying "3 pages" in every list in
   the app until somebody happened to press Save. */
ok('the record is told how many pages there are now',
  /\.set\(\{ pageCount: outDoc\.getPageCount\(\) \}, \{ merge: true \}\)/.test(blank));
ok('…as a MERGE, so it cannot take the rest of the record off with it',
  /pageCount: outDoc\.getPageCount\(\) \}, \{ merge: true \}/.test(blank));
ok('the work is marked unsaved so the record catches up', /setDirty\(true\);/.test(blank));
ok('…and the local rescue copy carries the new page too', /scheduleDraftSave\(\);/.test(blank));

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
ok('the card body draws it on screen',
  /\} else if \(a\.kind === 'image' \|\| a\.kind === 'mindmap' \|\| a\.kind === 'paste'\) \{/.test(html));
ok('…edge to edge, like every other picture card',
  /a\.kind === 'image' \|\| a\.kind === 'widget' \|\| a\.kind === 'mindmap' \|\| a\.kind === 'paste'\) body\.classList\.add\('aiNoteBodyFlush'\)/.test(html));

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
