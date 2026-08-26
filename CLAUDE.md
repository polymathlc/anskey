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

## 🧠 No note left unread, and the profile that had stopped learning (v1.73.0)

`notesFairShare` / `notesJoinField` / `notesDedupe` / `notesTrimTo` /
`notesLedger` / `notesLedgerFor` / `notesLedgerCounts` (search `THESE ARE POTS`),
plus the ⚠️ fit warning at the top of the notes window and the **Trimmed** /
**Not sent to the AI** row on a note's card. **`polymathlc/cer` carries the same
block — ship a change to both together.**

*"Some of them don't seem to permanently learn my info inputs."* Three separate
silent faults, and none of them threw.

- **The budgets were a `.slice()` over the JOINED notes.** `NOTES_GUIDE_CHARS`
  was 1,600 characters of every standing instruction run together, so with two
  hand-typed rules of that length the first lost most of itself and **the second
  reached no prompt at all** — while sitting in this very window looking obeyed.
  They are POTS now: `notesFairShare` water-fills, so a SHORT note is never
  trimmed at all and a long one is TRIMMED rather than the next note vanishing.
  **The budget yields to the notes**, growing to `n × minEach` when there are
  more notes than it can floor; `NOTES_HARD_CHARS` is the only ceiling a note
  can be lost to, and a loss is named rather than silent. Read them as budgets
  to divide, never as a length to cut to — the `.slice()` IS the bug.
- **`notesLedger` makes what is left out visible.** Rebuilt on every
  `aiGrounding` call, and `renderNotesBody` builds the fullest digest once on
  open so the window says what really happens rather than what happened after
  some other screen made a call.
- **THE NOTEBOOK IS LIVE.** It was a one-shot `.get()` at sign-in — and this
  collection is written by THREE apps, so a rule typed in the Science portal
  mid-lesson reached the app it was typed in and NO other, and the same question
  was answered against two different notebooks depending on which tab it was
  answered in. `loadTeachingNotes` attaches `onSnapshot` on the notes AND on the
  style profile. Three rules hold it: the listeners come DOWN on every account
  change (`stopTeachingNotes`, from the auth hook) or one account's notes go on
  grounding the next person to sign in on the device; the first snapshot
  RELEASES whoever is waiting on `notesLoading`, or the window says "Loading…"
  for the rest of the session; and `notesLiveRepaint` yields to whatever is
  being typed, because `renderNotesBody` rebuilds the window and would empty the
  upload comment box mid-sentence.
- **The style profile had FROZEN, permanently.** The refresh trigger compared
  `samples.length` against the count at the last distil — and `samples` is
  capped at `STYLE_SAMPLE_MAX` (400), so the moment the corpus filled up that
  difference was 0 for ever and the profile never rebuilt again. `st.learned` is
  a **monotonic** counter that only ever increments, checked against
  `st.profileLearned`; both are seeded from the sample count so an existing
  corpus is not read as new.
- **An empty distil can no longer overwrite a good profile.** A reply that came
  back with nothing usable used to replace the profile the teacher's own answers
  were distilled into — grounding every prompt in the app on nothing, silently,
  until the next refresh. It throws instead and the old profile stands.
- **✒️ Improve and the note-picture SVG fallback are grounded now.** `aiRequest`
  is transport: its system prompt arrives already grounded from the button that
  called it, which is why the census cannot see ✨ Answer or ✒️ Improve at all —
  so the harness checks **every `aiRequest(` call site passes `aiGrounding(`**
  directly. Without that, either button could stop grounding without a single
  check moving.
- Run **`node tools/notes-tests.mjs`** after touching any of it.


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
- After touching it — **or 📌 attach-to-page or the ✨ AI bar** (`mmAttachToPage`,
  `mmEditAttached`, `mmFlushBoard`'s `mmAttachedId` branch, `mmLoadBoard`'s
  clear, `mmAttachX`/`mmAttachY`, `mmAiLayout`, `mmAiPlace`) — run
  `node tools/mindmap-tests.mjs`. It loads the REAL section out of
  `index.html` (up to `/* ---- Wiring ---- */`) and runs the geometry, snapping, resizing and
  save/reload round trip against stubs. These fail quietly in the app: an arrow dropped on the way
  through JSON is just an arrow that is not there any more. The new half fails
  quietly too, and worse: an attached board written to the worksheet's own
  localStorage slot destroys the separate board kept there, `mmLoadBoard`
  forgetting to clear `mmAttachedId` writes one mindmap over a card holding
  another, a ring that does not grow piles twenty boxes on one another, and an
  "Add to it" offset measured from the centre draws half the new map straight
  through the teacher's own work.

### 📌 The board goes ON the page, and ✨ the AI draws one (v1.74.0)

`MM_NOTE_KIND` / `mmAttachToPage` / `mmEditAttached` / `mmRenderToDataUrl` /
`mmRefreshAttachedPicture` / `mmAttachedId` (search `THE MINDMAP ON THE PAGE`),
and `mmAiBuild` / `mmAiSys` / `mmAiLayout` / `mmAiPlace` / `mmAiSyncBar`
(search `THE AI BAR`), plus `#mmPinBtn` and the `#mmAiBar` row in the window.

A board kept in `localStorage` lived on one device and never reached the
worksheet — it could be exported as a picture and that was all.

- **📌 puts it on the page as an ANNOTATION**, so from then on it moves,
  resizes, erases, lassoes, undoes, prints and SAVES like every other
  annotation, and it travels with the worksheet to whoever opens it.
- **It is an `ainote` card of kind `'mindmap'`, NOT a new annotation type**,
  and that is the whole trick. A new type would have to be taught to
  `annFrame`, the resize handles, the hit test, `enterEditMode`, the eraser,
  the lasso, the thumbnails and both PDF paths — nine places, each silent when
  missed. A kind the card renderer already knows needs none of them.
- **`MM_NOTE_KIND` is deliberately NOT in `AI_NOTE_KINDS`.** A mindmap is drawn
  and pinned, never asked for in the ✨ Generate chooser, so it must not appear
  as a fifth tile there — `aiNoteKindInfo` knows it separately.
- **The BOARD rides along on `a.mm`, not just the picture**, so ✎ (and a
  double-tap) opens it back up with every box still a box. Both routes go to
  `mmEditAttached`; the AI-note dialog would offer to regenerate a card that
  never came from a prompt.
- **A board opened from a card is written back to THAT CARD, never to the
  worksheet's localStorage slot** (`mmFlushBoard`'s `mmAttachedId` branch).
  Writing it to the slot would quietly destroy the separate board the teacher
  keeps there — the one silent data loss this feature can cause. It also means
  an edit is impossible to lose: the card is current the moment it is typed,
  and 📌 only has to redraw the picture (`mmRefreshAttachedPicture`, also run
  on close). A card DELETED while its board is open releases the board rather
  than leaving writes with nowhere to go.
- **`mmLoadBoard` clears `mmAttachedId`.** The worksheet's own board belongs to
  no card, so without that a later 📌 writes it over a card holding a
  completely different mindmap.
- **The card is sized to the BOARD's own shape** on landing, so nothing is
  letterboxed; `object-fit: contain` means a corner-drag can never distort it.
- **`'mindmap'` had to be added to BOTH PDF paths** (`embedAiNoteImages` and
  the card painter) or it prints as an empty box with a heading — a card on
  screen and a gap in the PDF.

**The ✨ AI bar** builds a map from a sentence: boxes for the ideas, arrows for
how they connect. It is grounded in the teaching notes like every other AI call
in the app, so the wording that comes back is the teacher's.

- **The model returns DATA — nodes and links — never a drawing.** The layout is
  done in code (`mmAiLayout`), because a model asked for coordinates puts boxes
  on top of each other and a board nobody can read is a board the teacher
  redraws by hand.
- **The ring GROWS with how many are on it.** A fixed radius is fine for five
  branches and a pile-up at twenty, which is exactly the size a real mindmap
  reaches. Depth is breadth-first from the centre, so a node's ring is its real
  distance from the middle rather than the order the model listed it in.
- **A node the model forgot to link is still placed.** Dropping it loses an
  idea the teacher asked for.
- **"Add to it" offsets by the new map's OWN LEFT EDGE**, not by its centre: a
  wide ring reaches far to the left of the middle, so "the old right edge plus
  a gap" drops half the new map through the teacher's own work. Building fresh
  REPLACES, or a second Build stacks two maps on one another.
- Enter builds; **Shift+Enter grows what is there**, so the common case never
  needs the mouse.
- The bar and 📌 are the **teacher's own** — hidden for a student or a
  share-link visitor by `mmAiSyncBar` (re-checked from `applyRoleUI`, so a
  device handed back mid-lesson does not keep them) **and refused in the
  handlers**, because hiding a button is never the lock.
- Run **`node tools/mindmap-tests.mjs`** after touching any of it.


## ✏️ Line styles, arrowheads and curly brackets (v1.75.0)

`ANN_DASH_STYLES` / `annDashName` / `annDashPattern` / `ANN_HEAD_ORDER` /
`annHeads` / `annHasHeadAtStart` / `annHasHeadAtEnd` / `arrowHeadPoints` /
`bracePoints` / `braceDepth` / `dashPolyline` (search `ANN_DASH_STYLES`), plus
`syncLineStyleCtl` / `setLineDash` / `setLineHeads`, the `#lineStyleCtl` group
in the toolbar and the `brace` tool.

- **A LINE AND AN ARROW ARE ONE SHAPE NOW.** `a.heads` is
  `'none' | 'start' | 'end' | 'both'` and a `line` with two heads IS a
  double-headed arrow, which is why `annNode`, the canvas flatten and the PDF
  each have ONE branch for the pair rather than two that can drift.
- **`a.heads` and `a.dash` are ABSENT on everything already saved, and the
  fallbacks are what keep those worksheets right.** `annHeads` falls back to
  the TYPE — an `arrow` has always had a head at the end, a `line` has always
  had none — and `annDashName` falls back to `'solid'`. Break either and every
  arrow on every saved worksheet quietly loses its point, or every line on
  every sheet turns dotted. For the same reason `setLineDash` **deletes**
  `a.dash` when the answer is solid rather than storing the word.
- **The dash pattern is a MULTIPLE OF THE STROKE WIDTH**, turned into page
  units by `annDashPattern`. A fixed pattern reads as dashed at 1px and as a
  solid line at 12px, so a table of absolute lengths is the bug.
- **The dashes are on the SHAFT and never on the heads.** A dotted arrowhead
  is two dots where the point should be, and it is the head that says which
  way the arrow points. All three renderers clear the dash before the barbs.
- **THE PDF CUTS ITS OWN DASHES** (`dashPolyline`), rather than trusting
  pdf-lib's `borderDashArray`. `strokePath` already reads a `null` in its
  point list as a segment break, so the cut costs nothing — and a dotted line
  that prints solid because a library option was ignored is exactly the
  failure nobody sees until the sheet is in front of a class. It must never
  start or end on a `null`, and never emit two in a row: `strokePath` would
  write `M M` and lose a piece.
- **THREE RENDERERS, ONE SHAPE.** The brace is sampled into a POLYLINE
  (`bracePoints`) rather than left as an SVG path, because the canvas flatten
  and the PDF cannot read one — so the screen, the picture the AI is shown and
  the printed sheet cannot disagree about a bracket the teacher drew once.
- **Which side a brace bulges is the PERPENDICULAR OF THE DRAG**, so dragging
  the other way flips it. That is the whole control: no handle to find, and
  reversible by redrawing, which is what a teacher does anyway. A sign error
  there draws a wave rather than a bracket, and the harness pins it.
- **A brace has no heads, ever** — it labels a span, it does not point. There
  is no `heads` in its `TOOL_STYLE_DEFAULTS` entry, `setLineHeads` skips it and
  `syncLineStyleCtl` hides the head buttons for it.
- **A DASHED LINE IS MOSTLY GAPS**, so the line, arrow and brace branches all
  append a fat `stroke: 'transparent'` path. Without it a teacher aiming at a
  dotted line hits the page between the dashes and cannot select or erase it
  at all — a shape that is on the page and cannot be touched.
- **`syncLineStyleCtl` is synced from `renderAllOverlays()`** as well as from
  `syncStyleControls()`, because that is the one function every selection
  change already goes through; hooking the dozen places that set `selectedId`
  is how one of them gets missed and the group goes stale on exactly one
  route. It reflects the SELECTED annotation rather than the pen when there is
  one, or pressing a button appears to do nothing to the mark on screen. It
  decides its own visibility (tool AND role), so it is deliberately **not** in
  `TEACHER_TOOLBAR_IDS` — `applyRoleUI` just re-asks it.
- Both setters follow `setColor`'s shape exactly: change the pen, sync the
  controls, restyle what is selected as one undo step, remember it against the
  tool. A style you can set only before you draw is one you have to undo and
  redraw to change.
- Run **`node tools/line-style-tests.mjs`** after touching any of it.

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

## 🌙 Kimi — the third engine (`kimiActive` / `window.askKimi` / `kimiListModels`)

Everything here answers through Gemini on the shared `mathgen--app` project or
through ChatGPT on the admin's own key — two suppliers on two bills. The
morning the Firebase project is capped **and** the OpenAI balance is at zero is
a morning that happens, and it used to leave every Polymath app dead at once.
Kimi (Moonshot AI) is a third company on a third account.

- **It is reached exactly the way ChatGPT is here** — a key pasted once into
  the AI Engine dialog and kept in the admin's own `adminSettings` record, so a
  new iPad, a cleared browser or a reinstall pick it back up. It speaks the
  OpenAI chat-completions dialect, so `window.askKimi` has the SAME call shape
  as `window.askGemini` and `window.askOpenAI` and the bridge swaps one for
  another. Students and share-link visitors have no key, so they keep running
  on Gemini, unaffected — the same as ChatGPT.
- **`loadAiEngineFromCloud` reads the Kimi key BEFORE its OpenAI early-out.**
  That function used to give up entirely when the record held no `openAiKey`,
  which would have left a Kimi key saved on the iPad and picked up on no other
  device — the very thing the record exists for.
- **`aiVendorName()` is the ONE place the engine is named**, so the header
  button says *AI · Kimi* when Kimi is the engine that is on. An app claiming
  Gemini while ChatGPT answers was the bug that function was written for; a
  third engine is a third way to make it. It is the ADMIN's answer — everything
  a student or a teacher reads says **Chung GPT** instead (see below).
- **THE MODEL IS A FIELD, NOT A CONSTANT.** Moonshot renames its flagship with
  every release (`kimi-k2-…`, `kimi-k3-…`), so an id hard-coded here is a 404
  on every call a few months from now — and a 404 on every call reads as "Kimi
  is broken" rather than "the id is a release out of date". 🔄 **Load models**
  asks the account itself, and every Kimi error names the model it tried.
- **The key can never live in this file.** The app is served from a public
  address, so a key written here would be in the page source of every student's
  browser and in the repository's history for good — the same rule the OpenAI
  key has always had.

## 🤖 The assistant is called Chung GPT (v1.76.0)

`aiEngineName()` / `aiVendorName()` / `refreshAiEngineNames` (search
`THE ASSISTANT IS CALLED CHUNG GPT`).

The app used to call its AI by whichever vendor was answering — *ChatGPT marks
this answer*, *Gemini reads every page*, *Kimi is busy* — so the assistant
changed its name depending on which key happened to be saved. It is the
centre's assistant, not a vendor's, and which company served a given call is no
use to a student or to a teacher mid-worksheet.

- **`aiEngineName()` returns `'Chung GPT'`, full stop**, and every user-facing
  mention still goes through it: the toolbar tooltips, the ✨ Answer / ✒️
  Improve menu, the marking and Ask AI status lines, the note builder, the
  mindmap toast. One function, so the name is one line to change.
- **It returns a LITERAL, never a variable declared above it.** A `var`
  assignment only runs if everything before it ran, so anything that throws
  higher up the script — the pdf.js CDN failing to load, say — would leave the
  app calling its assistant *"undefined"* on every surface at once. A function
  declaration is hoisted whole and cannot fail that way. This was caught in a
  browser with the CDN blocked, which is exactly the condition that produces it.
- **`aiVendorName()` is the vendor, and the admin's surfaces keep using it.**
  The header button (`AI · ChatGPT`), the AI Engine dialog's radio rows, the
  answer key's engine label, and every *"ChatGPT could not be reached — Gemini
  worked those pages out instead"* notice all name the real company, from their
  own literals. Branding the student's side must not take the truth away from
  the teacher's: an admin who cannot tell which engine answered cannot tell a
  missing key from a broken one.
- **The static markup carries the brand as its default**, so the first paint is
  not a vendor's name for the half-second before `refreshAiEngineNames()` runs
  — three `<span class="aiName">` and the AI tool's `title`.

### …and it says what it is DOING

The Ask AI thread's pending bubble said **✨ Thinking…**, which tells a student
nothing and explains nothing about the wait. It now reads **✨ Chung GPT is
reading the worksheet…** — the same wording ✨ Answer already used, and the
thing that is actually happening: it is reading the worksheet the question was
asked about.

## 📚 The science syllabus, searchable (v1.77.0)

`SYLLABUS_TOPICS` / `sylIndex` / `sylWords` / `sylSearch` / `sylGroup` /
`sylMark` / `renderSyllabus` (search `THE SCIENCE SYLLABUS`), plus
`#syllabusModal` and the `.syl*` CSS, opened from the 📚 **Syllabus** button in
the header.

The Learning Outcomes of the MOE Primary Science Syllabus 2023 — 18 topics, 79
objectives — with a search box over them. Type a term or a topic and the
sections that cover it come up: *states of matter* brings back the two sections
about matter and about water in its three states, *P5 systems* narrows to that
level and theme.

- **IT SHOWS THE SYLLABUS AND NOTHING ELSE.** The Science portal attaches
  questions to each objective; this deliberately does not. There is no question
  bank in this app, so a reference that half-worked — every objective listed
  with an empty "questions" section under it — would read as broken rather than
  as a reference. The harness pins that no objective carries a `questions`
  field at all.
- **IT IS A COPY of `SYLLABUS_LO_TOPICS` in `polymathlc/cer`**, and copies
  drift. This one drifts only when MOE changes the syllabus, at which point
  BOTH files want editing — search `SYLLABUS_TOPICS` in this file and
  `SYLLABUS_LO_TOPICS` in that one. It is a fixed public list, not anything
  either app computes, which is what makes a copy the right call here and the
  wrong one for a topic-level map.
- **EVERY WORD TYPED MUST MATCH.** An OR would put half the syllabus under
  "states of matter", which is the same as showing nothing.
- **A term is matched on the KEYWORDS as well as the wording**, which is what
  makes *evaporation* find the sections that never spell it out in their own
  titles. `sylIndex` joins the topic, level, theme, title, intro, objective and
  keywords once per objective and keeps it — the same 79 rows every time, and
  rebuilding it on every keystroke is the one thing that would make the box
  feel slow.
- **`sylWords` is the ONE place a search becomes words**, and both the matcher
  and the marking read it. Stop-words are dropped from both: "states of matter"
  must not be held to *of*, and marked up it would speckle every line with a
  highlight that means nothing. A search made ENTIRELY of stop-words falls back
  to using them, or it would return the whole syllabus.
- **`sylMark` escapes and THEN marks.** It builds markup by hand, so the escape
  has to come first or the syllabus is being written into the page as HTML —
  and the terms are sorted longest-first, or marking "state" inside "states"
  splits the word across two spans.
- It is open to **everyone signed in**: a student looking a term up is doing
  exactly what it is for. A share-link visitor does not get it — that path
  returns before the button is built.
- Every keystroke inside the window is stopped there, or the page's one-letter
  tool shortcuts fire while a term is being typed. Escape closes it.
- Run **`node tools/syllabus-tests.mjs`** after touching any of it.

### …and it has to SCROLL (v1.78.0)

It shipped unable to: 79 objectives ran off the bottom of a card with no way to
reach them, and nothing threw. **Four rules make it work and every one of them
fails silently** — the window still opens, still searches, still looks full.

1. **The card rules are `.modalCard.sylWide` (0,2,0), never a bare `.sylWide`.**
   The base `.modalCard { max-width: 520px; max-height: 78vh }` is declared
   LATER in the sheet, so a single-class rule loses wherever they collide — an
   860px window came out 520px wide.
2. **The BODY does not scroll; the LIST does.** The body is the flex column
   that holds the search box and the chips still while the list moves under
   them. A body that scrolls takes the search box away with it.
3. **`min-height: 0` on both.** A flex item defaults to `min-height: auto`, so
   it will not shrink below its content — `overflow: auto` then has nothing to
   do and the list simply grows past the card. That one line is the whole bug.
4. **The list is a BLOCK, not a flex column.** This is the one that survived
   the first fix and looked convincing: a flex column SHRINKS its children, so
   the 18 topics were squeezed into the visible height and clipped by their own
   `overflow: hidden`. `scrollHeight` came back **equal to** `clientHeight` —
   nothing to scroll, on a window that appeared perfectly full. Measured: 567px
   of "content" for 79 objectives; as a block it is 11,764px. The gap between
   topics is `.sylList > * + * { margin-top: 16px }` rather than `gap`.

**On a phone the furniture was the window.** At 390×620 the heading, the blurb,
the search box and two wrapped rows of theme chips took 300 of the card's 546px
— more than half of it — and the syllabus read through a 245px slot. Under
560px the blurb is hidden (the placeholder says the same thing) and the chips
become ONE row you swipe sideways, which gives the list 357px.

`tools/syllabus-tests.mjs` checks all five of those **against `index.html`
itself**, because none of them can be caught by testing the matcher and the one
that gets missed is always the CSS.

## 🖼️ The picture generator, on a button of its own (v1.77.0)

`armPictureGenerator`, and the 🖼️ **Picture** button beside AI Engine.

The generator is not new — it is the *Picture or diagram* kind inside the ✨ AI
notes builder — but it was three steps in: pick the AI notes tool, tap the
page, then find the kind in the list. The button arms the SAME tool with the
kind already chosen, so the next tap on the page opens the builder ready to
draw.

- **One pipeline, not two.** A second image path would be a second one to keep
  in step with the first, and the first is the one that knows how to place the
  card, redo it, print it and put it in the PDF.
- It still needs a SPOT on the page, which is why the button arms a tool rather
  than opening the window: an AI note is placed where it was started from.
- Teacher-only, like every other generating path — the handler checks the role
  itself rather than trusting that the button was never built.

## House rules
- After touching **the syllabus window** (`SYLLABUS_TOPICS`, `sylIndex`,
  `sylWords`, `SYL_STOP`, `sylSearch`, `sylGroup`, `sylMark`,
  `renderSyllabus`, **or any `.syl*` / `.modalCard.sylWide` rule**), run
  `node tools/syllabus-tests.mjs`. It is a reference a
  teacher looks a term up in mid-lesson, and every way it goes wrong is quiet:
  an OR match returns half the syllabus, which is the same as returning
  nothing; a matcher that stops reading the keywords makes *evaporation* find
  only the sections that spell it out; marks and hits that disagree either
  speckle the page with meaningless highlights or hide why a section came up;
  and marking BEFORE escaping writes the syllabus into the page as markup.
  The CSS half is quieter still: put `display: flex` back on `.sylList` and the
  topics shrink to fit instead of overflowing, so the window looks full, every
  topic is clipped by its own `overflow: hidden`, and there is nothing to
  scroll to — which is exactly how it shipped.
- **The Gemini model is `AI_MODEL` and its thinking floor is `AI_THINK_MIN`, and the two move
  TOGETHER** (v1.66.0). Every model has its own thinking scale, and a level it does not know is a
  **400 INVALID_ARGUMENT on every AI feature in the app** — not a worse answer, no answer at all.
  `gemini-3.7-flash` takes `low` / `medium` / `high` and **dropped the `"minimal"` 3.6 accepted**,
  exactly as 3.x had already dropped 2.x's numeric `thinkingBudget`. So the floor is a named
  constant, `askGeminiDirect`'s retry steps down to it (retrying the floor *at* the floor would
  just re-send the request that was refused), and `AI_NOTE_QUALITY`'s four steps have to stay four
  real steps — Quick and Standard both landing on `low` is a picker offering a choice that changes
  nothing. `polymathlc/cer` carries the same pair; keep the two in step.
- After touching **the note budgets, the live notebook or the style counter**
  (`notesFairShare`, `notesJoinField`, `notesDedupe`, `notesTrimTo`,
  `notesLedger*`, `NOTES_GUIDE_CHARS` and the other pots, `loadTeachingNotes`,
  `notesDetach`, `stopTeachingNotes`, `notesLiveRepaint`, `styleEnsure`'s
  `learned` / `profileLearned`, `styleDistil`'s empty-profile guard, or
  `UNGROUNDED_BY_DESIGN` in the harness), run `node tools/notes-tests.mjs`.
  Every one of these fails silently and the app answers fluently either way.
  Turn a pot back into a `.slice()` over the joined notes and the teacher's
  SECOND standing instruction reaches no prompt at all while sitting in the
  window looking obeyed. Go back to a one-shot read and a rule typed in another
  app never arrives, on a screen that looks perfectly current. Compare
  `samples.length` against the last distil again and the style profile freezes
  for good the day the corpus fills up. And let an empty reply replace the
  profile and every prompt in the app is grounded on nothing until the next
  refresh, which may never come.
- After touching **teaching notes or the style training** (`aiGrounding`, `notesBlock`,
  `styleBlock`, `notesRelevant`, `styleAddSamples`, `styleHarvestTyped`, `notesCardHtml`,
  `noteSourceLabel`), run
  `node tools/notes-tests.mjs`. It loads the REAL section out of `index.html` and runs it against
  stubs. Every failure here is silent — a digest that comes back empty is just an ungrounded
  prompt, and nothing throws.
- After touching **the line styles, the arrowheads or the brace**
  (`ANN_DASH_STYLES`, `annDashName`, `annDashPattern`, `annHeads`,
  `annHasHeadAtStart`/`annHasHeadAtEnd`, `arrowHeadPoints`, `braceDepth`,
  `bracePoints`, `dashPolyline`, `syncLineStyleCtl`, `setLineDash`,
  `setLineHeads`, or any of the three renderers' line / brace branches), run
  `node tools/line-style-tests.mjs`. Every failure here is silent and the
  sheet still prints: a pattern that comes back null draws a solid line with
  nothing anywhere saying the teacher asked for dotted; barbs read off the
  wrong end put the arrow the wrong way round in a diagram that still looks
  like a diagram; a `heads` fallback that stops reading the TYPE takes the
  point off every arrow on every worksheet already saved; and a brace whose
  perpendicular loses its sign draws a wave. The three renderers are checked
  against the file itself, because the one that gets forgotten is always the
  PDF — and a dotted line that prints solid is only ever found in front of a
  class.
- After editing `index.html`, syntax-check the script block, e.g.
  `python3 -c "import re;open('/tmp/c.js','w').write(re.findall(r'<script>\n(.*?)\n</script>', open('index.html').read(), re.S)[-1])" && node --check /tmp/c.js`
- Commit messages and pushed artifacts must not contain the model identifier.
