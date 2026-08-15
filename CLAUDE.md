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
  free-form class string.
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
  Science Learning Portal (`polymathlc/cer`, `app.js`) writes** — one notebook grounding both apps.
  Keep the fields compatible: `topics` is reserved for that app's syllabus list and this app writes
  it **empty**, so a note uploaded here reads as a general note there instead of one tagged with
  topics it has never heard of. This app's own wording goes in `noteTopics` / `subjects` / `levels`.
- **A student's device reads the notes too** (marking and Ask AI run there), and learns whose notes
  to read from the `ownerUid` on the first worksheet it opens (`notesNoteOwner`, remembered in
  `localStorage`). A read that is denied is not an error worth showing — the AI simply carries on
  ungrounded, exactly as it did before the feature existed. Only the admin ever writes.
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
  `styleBlock`, `notesRelevant`, `styleAddSamples`, `styleHarvestTyped`, `notesCardHtml`), run
  `node tools/notes-tests.mjs`. It loads the REAL section out of `index.html` and runs it against
  stubs. Every failure here is silent — a digest that comes back empty is just an ungrounded
  prompt, and nothing throws.
- After editing `index.html`, syntax-check the script block, e.g.
  `python3 -c "import re;open('/tmp/c.js','w').write(re.findall(r'<script>\n(.*?)\n</script>', open('index.html').read(), re.S)[-1])" && node --check /tmp/c.js`
- Commit messages and pushed artifacts must not contain the model identifier.
