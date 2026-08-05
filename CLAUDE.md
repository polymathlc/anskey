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
- After editing `index.html`, syntax-check the script block, e.g.
  `python3 -c "import re;open('/tmp/c.js','w').write(re.findall(r'<script>\n(.*?)\n</script>', open('index.html').read(), re.S)[-1])" && node --check /tmp/c.js`
- Commit messages and pushed artifacts must not contain the model identifier.
