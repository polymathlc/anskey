# CLAUDE.md

Guidance for Claude when working in this repo.

## App
- `index.html` — **"Ans Key"**, the PDF worksheet annotator. One self-contained file (markup + CSS +
  JS), on the shared `mathgen--app` Firebase project with Google sign-in. Admin
  (`chungzhikai@gmail.com`) opens a PDF, marks it up (pen/highlight/text/shapes/arrows/keywords),
  generates AI answers and note cards, and saves it to `pdfAnnotator/{id}` (+ the PDF in Storage
  under `pdf-annotator/`). Students sign in, pick a level and subject once (`studentProfiles/{uid}`),
  and see the worksheets tagged for them; share links open one worksheet without an account.
  `README.md` is the feature log, newest version first — add a section there for anything
  user-visible.
- Roles: `isAdmin()` (the one admin email), `isStudent()` (anyone else, plus a share-link visitor
  and the teacher's device handed over with "Practise as"), `isSharedVisitor()`. `applyRoleUI()` is
  the single place that decides what each role sees — put new teacher-only UI through it.
- `pdfAnnotator` is shared with the older annotator in `polymathlc/cer` (`pdf-annotator.html`), so
  keep field names compatible: `wsSlot` is this app's 0–2 lesson session, `slot` is that app's
  free-form class string. `hidden` is this app's own field — the **Hidden** category
  (v1.70.0), checked in `canSeeDoc()` before the level and subject are, so a hidden worksheet
  reaches no student list anywhere here; a share link still opens it, and the `cer` app knows
  nothing about the field, so a worksheet hidden here is still listed there.
- Annotations bigger than `ANN_INLINE_LIMIT` do not fit in a Firestore document (~1 MB), so they
  go to Storage as `pdf-annotator/{id}.annotations.json` with `annotationsPath` +
  `annotationsStamp` on the doc and `annotations: ''` (see `writeAnnotations` /
  `readAnnotationJson`). Worksheets that fit are still written inline, unchanged. The `cer` app
  knows nothing about the pointer, so it reads such a worksheet as having no annotations — it
  could never have saved one that big either. Read annotations through `readAnnotationJson(d)`
  and write them through `writeAnnotations()`; never write the `annotations` field directly.

## Teaching notes & AI style training (`#notesBtn` / `#notesModal`, all `notes*` / `style*` code)
- **Every AI feature in this app is grounded through ONE function, `aiGrounding(kind)`** — the ✨
  Answer box, the Answer key, AI note cards, Ask AI and practice marking each append it to their
  system prompt. Adding an AI feature means calling it too; grounding one call site and not another
  is how the AI ends up answering in the teacher's voice on one button and not the next. `kind` is
  `'answer'` (writing an answer), `'mark'` (marking a student) or `'teach'` (explaining / a card):
  marking gets the marking standards and never the exemplar answers, everything else gets the key
  facts and the exemplars. **The authority order is stated in the digest and never changes**: what
  the worksheet itself prints wins, then the notes, then ordinary syllabus knowledge — and when
  marking, the teacher's model answer on the page beats all of it.
- **`guidance` is the hand-typed note (`#quickNoteBtn` / `#quickNoteModal`, all `quickNote*` code)
  and it is the ONLY field that reaches every `kind`, marking included** — it goes in verbatim
  through `guidanceBlock()`, ahead of `notesBlock`/`styleBlock`, and the authority order names it
  right after the worksheet. Nothing is sent to the AI when one is saved: it is a note with empty
  `subjects`/`levels` (so it applies everywhere) and empty `keywords`/`keyFacts`/`markingStandards`,
  written straight to Firestore. `guidance` is this app's own field — the `cer` app shares the
  collection and ignores it, which is why the shared fields are still written, empty.
- **The notes live at `users/{adminUid}/teachingNotes/{id}`, which is the SAME collection the
  Science Learning Portal (`polymathlc/cer`, `app.js`) and the **Scan app** (`polymathlc/scan`,
  `index.html`) write** — one notebook grounding three apps.
  Keep the fields compatible: `topics` is reserved for that app's syllabus list and this app writes
  it **empty**, so a note uploaded here reads as a general note there instead of one tagged with
  topics it has never heard of. This app's own wording goes in `noteTopics` / `subjects` / `levels`.
  **`guidance` is read by all three** since cer v1.309.0 and scan v1.0.0; it was this app's own
  field, and for a while the Portal simply ignored it — a house rule typed here that was obeyed on
  one screen and not the next. The Scan app is a straight port of this whole section
  (`aiGrounding`, the digests, the quick note): a fix to either belongs in both.
- **A student's device reads the notes too** (marking and Ask AI run there), and learns whose notes
  to read from the `ownerUid` on the first worksheet it opens (`notesNoteOwner`, remembered in
  `localStorage`). A read that is denied is not an error worth showing — the AI simply carries on
  ungrounded, exactly as it did before the feature existed. Only the admin ever writes.
- **A rule can be typed on an ANSWER CARD in the Scan app, and it lands here** (scan v1.5.0, this
  app v1.71.0). When a scanned answer is not good enough the teacher corrects it there and says what
  should have happened; that is written as an ordinary note in this collection — `guidance` for the
  rule, `keyFacts` for the corrected answer with its question above it, and `sourceQuestion` for the
  question it was written against. **`sourceQuestion` is for the READER, never for a prompt**: it is
  shown on the card here ("Written against") so a rule still makes sense once the paper is gone, and
  putting the whole question into `guidance` would drown the rule in a paragraph repeated on every
  question. `noteSourceLabel` is why the card names the right app: it used to file everything that
  was not this app's under the Learning Portal, so every rule typed on a phone over a worksheet was
  attributed to the wrong app.
- **The Scan app READS the style profile and never writes to it.** Nothing photographed there is
  an answer the teacher wrote, so there is nothing honest for it to learn from — the corpus is
  grown HERE, and every answer that app writes sharpens with it. Do not add a harvest path there
  without deciding first whose answers those are.
- **The style corpus is `users/{adminUid}/aiTraining/answerStyle`** — the answers the teacher has
  already written on their own worksheets, and the profile distilled from them. Three ways in:
  `styleHarvestOnSave()` takes the typed answers on every save for free, `styleLearnOpenWorksheet()`
  reads the open worksheet page by page with the vision model so **handwriting** counts, and
  `styleLearnAllWorksheets()` sweeps every saved worksheet (typed answers only, so no AI cost).
  Samples are keyed (`docId:annId`) so nothing is learned twice, trimmed, and capped at
  `STYLE_SAMPLE_MAX` — it is ONE Firestore document, which dies at ~1 MB.
- **The samples never reach a prompt; only the profile does.** `styleDistil()` turns the corpus into
  a few hundred characters plus up to `STYLE_EX_MAX` real answers, and re-runs itself in the
  background once `STYLE_DISTIL_EVERY` new answers have piled up — that is the "gets better over
  time" part, and it must stay automatic.
- **Students never see any of this**: the button, the window and every write are behind `isAdmin()`
  and off for `actingStudent` / share-link visitors (`applyNotesVisibility`, called from
  `applyRoleUI`).
- **`.modalCard.wide` is the reward register's class and its body is deliberately
  `overflow: hidden`.** These two windows scroll as a whole, so they use `.modalCard.tnWide`, which
  sets the width and nothing else. Reusing `.wide` clips the notes list with no way to scroll it.

## Reward system — ADMIN ONLY (`#rewardBtn` / `#rewardModal`, all `rw*` code)
- The Reward window hands marks to one class mid-lesson. It writes **only** into the reward
  system's collections in the separate `polymathlc/rewards` repo (`rewards/index.html`, same
  Firebase project): `students.marks`, an `awards` row with `source: "annotator"` (so it shows in
  the student's history there and can be undone there), and `rwDamageBosses()` on the active
  `bosses` — the same shape a test-paper upload uses in the rewards app. **Keep the award shape in
  step with the rewards app's `awardDoc()`, and ship changes to both repos together.**
- A "class" here is one of the reward system's free-form slot strings ("P5 Science — Wednesday
  5pm–6.45pm"), parsed best-effort by `rwClassDayIndex`/`rwClassStartMinutes` only for sorting and
  guessing. That is NOT this app's `wsSlot` (the 0–2 session of the day) — `rwGuessClass()` uses the
  worksheet's day and level first, then `slotsForDay()` hours to break a tie.
- The class marks were last given for is pinned on the worksheet as `rewardClass`, so the window
  reopens on the right register next lesson.
- The window also edits the roster: add a `students` doc for a new name in this class, drop a class
  from a student's `slots`, or delete the `students` doc outright. A student taken out of a class
  keeps their record, marks and history; only *Delete entirely* removes the doc.
- **Students never see any of this** — the button, the window and every award call are behind
  `isAdmin()` and off for `actingStudent` / share-link visitors. Do not add a student-facing earning
  path here; students earn in the rewards app.
- This feature lives HERE, not in `polymathlc/cer` — it was moved out of that repo's
  `pdf-annotator.html` deliberately. Do not add it back there.

## Mindmap window (`#mmBtn` / `#mmModal`, all `mm*` code + the `mmBoard` object)
- **The board is this app's port of the Mindmap app's canvas (`polymathlc/mindmap`, `js/app.js`),
  and the two must stay in step.** The element shape (`type` / `x` / `y` / `width` / `height` /
  `fill` / `stroke` / `strokeW` / `text` / `fontSize` / `fontFamily`) and the connection shape
  (`from` / `to` / `controlPoints`) are that app's, so a board built here reads the same way there.
  Four things this port added and that app now carries too: a **text colour** (`textColor`), a
  **link** on any box or picture (`link`), pictures kept **in proportion** on resize, and
  **pointer** events instead of mouse events. Ship engine changes to both repos together.
- **The state object is `mmBoard`, never `mm` — `mm(v)` is the millimetres-to-points helper the
  whole PDF answer-key and flattened export is built on.** A global `var mm = {...}` silently
  clobbers it and every print and export breaks. Everything else in the feature is `mm`-prefixed
  (`mmRender`, `mmSnap`, `mmBoardKey`), which is fine — only the bare name is taken.
- **The board never touches Firestore.** It is remembered per worksheet in `localStorage` under
  `polymath.mmBoard:{docId}`, read when the window opens, so opening another worksheet and
  reopening the window brings up that worksheet's board. Nothing about the shared `pdfAnnotator`
  document changes, and the `cer` app is unaffected. Pictures are data URLs, so a board that has
  grown past what `localStorage` will take says so once (`mmFlushBoard`) instead of failing mute.
- **It is a floating window like the calculator and the code window** — `.modalBack.floatWin`,
  `attachFloatWin`, `clampWinBox`. Every keystroke inside `#mmCard` is stopped there, or the page's
  own one-letter tool shortcuts fire while a mindmap is being built.
- **Sizes measured in screen pixels are divided by the board's zoom** (`mmS`) — handles, grab
  radius, guide dashes. Measuring them in board units is what made the Mindmap app's handles
  unusable once the board was zoomed out.
- Everyone gets this one — teacher, student and share-link visitor, like the calculator. It is not
  behind `applyRoleUI()`.
- After touching it, run `node tools/mindmap-tests.mjs`. It loads the REAL section out of
  `index.html` (up to `/* ---- Wiring ---- */`) and runs the geometry, snapping, resizing and
  save/reload round trip against stubs. These fail quietly in the app: an arrow dropped on the way
  through JSON is just an arrow that is not there any more.

## Versioning convention — applies to EVERY change (do this every time)
1. **Bump the version.** In `index.html`, update `var APP_VERSION = 'vX.Y.Z'` (search
   `APP_VERSION`). Patch bump for fixes/small tweaks, minor bump for new features.
2. **Keep it visible.** It renders in the header (`#versionTag`). This is how the user confirms the
   latest build is actually deployed.
3. **Report it.** When summarising an update in chat, always state the new version number
   (e.g., "Shipped in **v1.48.0**").

The whole point: the user checks the version shown in the app against the number reported in chat
to know whether the upload/deploy went through.

## Design convention — breathing space (applies to EVERY UI you build/touch)
- Give elements room to breathe: generous, consistent padding inside cards/banners, clear vertical
  spacing between title → description → meta → buttons, and comfortable line-height. Never cram
  content edge-to-edge or stack lines tightly.
- Cards/banners are rounded rectangles constrained to a sensible max-width (not full page width)
  and centered — not a dense, full-bleed block.
- When the user says something is "too big/thick/messy", the fix is usually *more* whitespace and a
  tighter width, not shrinking fonts until it's cramped.
- Keep spacing scale consistent across the whole app so every surface feels like the same design
  system.

## House rules
- **The Gemini model is `AI_MODEL` and its thinking floor is `AI_THINK_MIN`, and the two move
  TOGETHER** (v1.66.0). Every model has its own thinking scale, and a level it does not know is a
  **400 INVALID_ARGUMENT on every AI feature in the app** — not a worse answer, no answer at all.
  `gemini-3.7-flash` takes `low` / `medium` / `high` and **dropped the `"minimal"` 3.6 accepted**,
  exactly as 3.x had already dropped 2.x's numeric `thinkingBudget`. So the floor is a named
  constant, `askGeminiDirect`'s retry steps down to it (retrying the floor *at* the floor would
  just re-send the request that was refused), and `AI_NOTE_QUALITY`'s four steps have to stay four
  real steps — Quick and Standard both landing on `low` is a picker offering a choice that changes
  nothing. `polymathlc/cer` carries the same pair; keep the two in step.
- After touching **teaching notes or the style training** (`aiGrounding`, `notesBlock`,
  `styleBlock`, `notesRelevant`, `styleAddSamples`, `styleHarvestTyped`, `notesCardHtml`,
  `noteSourceLabel`), run
  `node tools/notes-tests.mjs`. It loads the REAL section out of `index.html` and runs it against
  stubs. Every failure here is silent — a digest that comes back empty is just an ungrounded
  prompt, and nothing throws.
- After editing `index.html`, syntax-check the script block, e.g.
  `python3 -c "import re;open('/tmp/c.js','w').write(re.findall(r'<script>\n(.*?)\n</script>', open('index.html').read(), re.S)[-1])" && node --check /tmp/c.js`
- Commit messages and pushed artifacts must not contain the model identifier.
