# Anskey — PDF worksheet annotator

Single-file web app (`index.html`) for annotating PDF worksheets, backed by
Firebase (Auth + Firestore + Storage, project `mathgen--app`).

## AI notes: build quality, and cards made in the background (v1.42.0)

The AI notes window used to hold the lesson hostage: one card at a time, the
window stuck open until it landed, and a widget budget so tight that anything
ambitious came back half-built.

- **Build quality — Quick / Standard / High / Highest.** Picked in the window
  and remembered on the device (default **High**). It raises three things
  together: the output budget (widgets go from 8k tokens to 6k/12k/22k/32k),
  how hard the model thinks (ChatGPT `reasoning_effort`, Gemini
  `thinkingLevel`), and how much the prompt asks for — labelled layouts, live
  readouts, sane defaults, edge values that don't break it. Pictures follow
  too, through the image model's own quality setting.
- **Everything runs in the background.** Pressing Generate hands the build to a
  job and gives the window straight back. Minimise it with the **–** button
  (title bar only — tap the bar to open it again), close it, or carry on
  annotating; the card lands on the page by itself.
- **Up to four at once.** Start a widget, click another spot, start the next.
  A fifth is politely refused until one lands.
- **A small notification per card.** Each build gets a chip in the bottom-right
  corner: a spinner while it works, then a notification naming what was made —
  tap it to jump to the card, ✕ to dismiss. Failures say what went wrong and
  stay until dismissed, including a widget that was cut off before it finished.
- **Late answers can't land on the wrong worksheet.** A job remembers the
  worksheet, page and card it was started for; if the worksheet was closed, the
  page is gone, or the card being redone was deleted, the result is dropped and
  the chip says so.

## ChatGPT engine toggle (v1.41.0)

Every AI feature in the app — **Answer** and **Improve** on text boxes, **AI
notes**, the answer key, marking, keyword extraction and Ask AI — runs on
Gemini 3.6 Flash through Firebase AI Logic by default, with no key to manage.
Teachers who want a second opinion (or heavier reasoning on a hard worksheet)
can switch the whole app to **ChatGPT gpt-5.6-sol**, the same toggle the CER
Science Learning Portal uses.

- **Where:** an **AI Engine** button in the header, next to *Students*. Admin
  only — students never see it and are never affected.
- **What you set:** the engine (Gemini or ChatGPT), the ChatGPT chat model
  (`gpt-5.6-sol` by default, plus `gpt-4o-mini` / `gpt-4o` / `gpt-4.1`), the
  ChatGPT image model used by the *picture* AI note card (`gpt-image-1`), and
  your OpenAI API key.
- **The key stays on the device.** It is written to `localStorage` in that one
  browser — never uploaded, synced or committed. Paste it only on machines you
  control; any other device simply keeps using Gemini.
- **Gemini is always the safety net.** If a ChatGPT call fails for any reason —
  bad key, rate limit, network — the request is retried on Gemini automatically
  and the feature carries on. Picture cards fall back ChatGPT → Gemini → drawn
  SVG.
- The header button reads **AI · ChatGPT** while that engine is on, so the
  current engine is visible without opening the dialog.
- **The wording follows the engine.** Every label, hint, tooltip and busy line
  names whichever engine is actually running — the AI notes dialog asks *"What
  should ChatGPT make?"* and reports *"ChatGPT is making your interactive
  widget…"* once the toggle is on, instead of always saying Gemini.

## Worksheets listed day by day (v1.40.0)

The worksheets list is built around the class day, for students and teachers
alike. Each day is a **coloured band** — Monday burnt orange, Tuesday amber,
Wednesday green, Thursday blue, Friday violet, Saturday magenta, Sunday teal,
and grey for worksheets with no class day set — with every worksheet for that
day directly underneath it.

- **Tap a day band to fold it.** A student's own class day is tagged *your
  class day* and opens first; their other days start folded so the list stays
  short. Teachers see every day open. If a student has not set a class day —
  or their day has nothing on it yet — the list opens rather than showing
  nothing but bands.
- **Two classes on the same day** are separated by a thin `🕒 5:00 – 6:45pm`
  line rather than another thing to open, so the list is two levels deep
  instead of three. A student's own class time leads their day and is tagged.
- **Newest first** within every day.
- **My PDFs uses the same day bands**, in the same colours, with the Open /
  Edit / Delete buttons unchanged.

### Students taking both subjects

A student whose profile subject is **Both** sees Maths *and* Science
worksheets together under each day — the subject is a coloured chip on every
card (Maths blue, Science green, Maths & Science violet), so which is which
reads at a glance.

When a list holds both subjects, **All · Mathematics · Science** chips appear
under the drawer heading to narrow it to one subject for a moment. They are
hidden for anyone whose list only ever holds one subject, and they never
change what a student is allowed to see — only what is on screen.

## AI answer key (v1.39.0)

The **Answer key** card in the worksheet panel has one button: **✨ Generate
answer key**. Gemini reads the worksheet a page at a time — the printed
questions, plus whatever answers are written on the page — and returns one
condensed entry per question: the answer itself and a short explanation of why
it is right.

The result opens in a dialog and prints as a plain answer key, one block per
question:

```
Question 16
    ANSWER
    2. (2)
    EXPLANATION
    Air is a gas and has no definite shape, so it takes the shape of the
    balloon. When the balloon is twisted, the shape changes — but no air was
    added or removed, so the mass of air is unchanged.
```

- **Multiple choice** prints the option's number in bold followed by the
  option's own wording, exactly as it reads on the paper.
- **Everything else** prints the final answer in bold — the value with its
  unit, or one short sentence — condensed to what a marker needs.
- **The teacher's own answers win.** Where the worksheet already carries
  written or typed answers, those are attached to the request and Gemini
  follows them; where a page has none, it works the answer out from the
  question.
- **The worksheet's own numbering is kept** ("16", "3a"). A question that runs
  across a page break comes back from both pages and is merged into one entry.
- **A page that cannot be read is named**, and the rest of the key is still
  produced.

The key is built from the pages themselves, not from the on-screen canvases —
the viewer only rasterises the pages you can see, so each page is rendered
again for the request.

**🖨 Print / save as PDF** opens the key in a new tab and prints it; choose
"Save as PDF" in the print dialog to keep it as a file. **📄 View the answer
key** re-opens the last one without spending another AI call. The key lives
for as long as the worksheet is open — opening another worksheet clears it.

Like the AI answer tool, this is teacher-only: students and share-link
visitors never see the card.

## Marking summary (v1.38.0)

Every marked answer now ends with a **Summary** segment, in point form:

- **📘 What you need to learn** — the skills, concepts, formulae or keywords
  the question calls for, named plainly so the student knows what to revise.
- **🔍 What your answer was missing** — what was actually short in *their*
  answer: a missing unit, a skipped step, a keyword not written, a wrong
  method.

A fully correct answer shows no "missing" list at all — an empty heading
there reads as a telling-off. Marking that returns neither list (an older
response shape) simply omits the segment.

**Mark ALL my answers** additionally opens with one **What to work on**
roll-up above the answer-by-answer detail, merging the points from every
question so the same weakness across three questions is one thing to revise,
not three. Matching ignores case and punctuation, so near-identical phrasings
collapse together.

Both the on-screen report and the printed one carry the summaries.

## Full screen (v1.37.0)

The last button in the toolbar's view-toggle group folds the banner and the
toolbar away so the worksheet has the whole window. `Shift+F` does the same
from the keyboard. A floating **Exit full screen** chip in the top-right
corner brings them back — the toolbar is hidden, so the way out travels with
the worksheet. Students, teachers and share-link visitors all get it.

That gains about 25% more height for the worksheet on an iPad.

### Why the browser's own bars are a separate question

Losing the *browser's* bars on top of that is the Fullscreen API, and it is
only dependable on desktop and Android. On iPadOS Safari it lets go of the
page by itself the moment a drag or a focused input looks like a system
gesture, and re-entering needs a fresh user gesture — so trying to hold on
to it just made the mode flicker in and out.

So the API is asked for where it holds and **never called on iOS at all**.
Nothing to drop there means nothing to flicker: the worksheet goes edge to
edge inside Safari and stays there.

### Losing Safari's bars for good: Add to Home Screen

`manifest.webmanifest` plus the `apple-mobile-web-app-*` tags mean the app
can be installed from **Share → Add to Home Screen**. Opened from there it
launches with no browser bars at all, which on an iPad is the only reliable
way to be rid of them. The first time full screen is used on iOS, a toast
says so.

Because a popup opened from an installed web app lands in a detached browser
window that never reports back, `signIn()` uses `signInWithRedirect` when it
detects standalone mode and `signInWithPopup` everywhere else, with
`getRedirectResult()` collected on load. Ordinary browser tabs are on exactly
the same path they always were.

## Printing questions and answers (v1.35.0)

The toolbar has two small print buttons (next to Download), and the same pair
sits in the **Print** card in the worksheet panel. Both are available to
students and teachers:

- **Questions** (`Ctrl+P`) — the worksheet exactly as it arrived. Every
  working, mark, text box, video button and timestamp is taken out, so it can
  be handed to a class to attempt.
- **Answers** (`Ctrl+Shift+P`) — the same paper with all the workings baked
  in, timestamps included when they are switched on. While a student is
  practising, this prints the *teacher's* answer key, not their own attempt.

### The cover page

Both prints can start with a Polymath cover — logo, title, subtitle, and Name
/ Date lines. It is drawn straight into the PDF, so it needs no browser
rendering step and comes out identical on an iPad and a laptop.

- **Toggle it on or off** with “Add a Polymath cover page” in the Print card.
  The choice is remembered per device.
- **The title follows the worksheet name.** Admin accounts get a *Cover title*
  box to override it; the override is saved with the worksheet, so everyone
  who prints it gets the same cover. Leave it empty to go back to the name.
- **The footer follows the level and subject** — “Primary Mathematics” or
  “Primary Science” (and “Secondary …” for Sec 1 worksheets).
- **A lesson recording adds a QR code** to the top right, with the link
  underneath in a small font, so students can scan the printed sheet and watch.

The QR encoder is built in (byte mode, EC level M, versions 1-15) rather than
pulled from a CDN, and is verified module-for-module against the
`qrcode-generator` reference implementation.

The logo is fetched from Dropbox once per session. If the network or CORS
swallows it, the cover falls back to a plain `POLYMATH` wordmark rather than
failing the print.

## Sharing a worksheet (v1.32.0)

The purple **Share** button (next to Save, admin only) gives you a link that
opens exactly one saved worksheet — `…/index.html?share=<worksheet-id>`.
In the Share dialog you can:

- **Copy the link** to send to students.
- **Choose who the link admits** — saved on the worksheet itself:
  - *Anyone with the link can view* (default): read-only, with Download.
  - *Anyone with the link can edit*: students also get the drawing tools and
    their writing auto-saves onto the worksheet.
  - *Off — only you*: the link turns visitors away.
- **Add a password**: students must type it before the worksheet opens. Only
  a SHA-256 fingerprint of the password is stored, never the password itself.
  (Note: this is a classroom-level deterrent enforced in the browser, not
  bank-grade security.)

Visitors on a share link see only that worksheet — no My PDFs, no questions
drawer, no save/print/AI — but Download always works.

### One-time Firebase setup for share links

1. **Anonymous sign-in** (Firebase console → Authentication → Sign-in
   method → Anonymous → Enable). The app signs link visitors in anonymously
   so "anyone with the link" works without a Google account. If it stays
   disabled, visitors are asked to sign in with Google instead.
2. **Firestore rules** must let signed-in users (including anonymous) read
   worksheets, and — if you use edit links — update the annotations, e.g.:

   ```
   match /pdfAnnotator/{docId} {
     allow read: if request.auth != null;
     allow create, delete: if request.auth != null
       && request.auth.token.email == 'chungzhikai@gmail.com';
     allow update: if request.auth != null
       && (request.auth.token.email == 'chungzhikai@gmail.com'
           || (resource.data.share.mode == 'edit'
               && request.resource.data.diff(resource.data).affectedKeys()
                    .hasOnly(['annotations', 'updatedAt'])));
   }
   ```
3. **Storage rules** must allow signed-in reads of `pdf-annotator/` (see the
   section below) so the PDF bytes download for visitors too.

## Fixing “Could not open: Failed to fetch”

When you open a saved worksheet, the app asks Firebase Storage for a download
URL (this works) and then downloads the PDF bytes with `fetch()`. That second
step is a **cross-origin download**, and Google Cloud Storage only sends the
CORS headers the browser needs if the bucket has a CORS configuration.
The `mathgen--app.firebasestorage.app` bucket currently has none, so the
browser blocks the download and reports the generic `Failed to fetch` error.

This is a **one-time setup** on the bucket — no code change can work around it.

### One-time fix (about 2 minutes, no installs needed)

1. Open [Google Cloud Shell](https://console.cloud.google.com/home/dashboard?project=mathgen--app&cloudshell=true)
   while signed in with the Google account that owns the `mathgen--app`
   Firebase project, and wait for the terminal at the bottom to start.

2. Paste this into the Cloud Shell terminal and press Enter:

   ```bash
   cat > cors.json <<'EOF'
   [
     {
       "origin": ["*"],
       "method": ["GET", "HEAD"],
       "responseHeader": ["Content-Type", "Content-Disposition", "Content-Length"],
       "maxAgeSeconds": 3600
     }
   ]
   EOF
   gcloud storage buckets update gs://mathgen--app.firebasestorage.app --cors-file=cors.json
   ```

3. Verify it took effect:

   ```bash
   gcloud storage buckets describe gs://mathgen--app.firebasestorage.app --format="default(cors_config)"
   ```

4. Reload the app and open a saved worksheet — it should load immediately.

Notes:

- `"origin": ["*"]` is safe here: CORS is not access control, it only tells the
  browser it may hand the bytes to the page. Who can read a file is still
  governed by your Storage security rules and download tokens.
- If you prefer to restrict it, replace `"*"` with the exact origins the app is
  served from, e.g. `["https://<your-username>.github.io"]`.

## Recommended: tighten Storage security rules

While diagnosing this, we noticed the bucket currently allows **unauthenticated
reads and listing** — anyone with the bucket name can list and download every
saved worksheet. If that is not intended, set the Storage rules (Firebase
console → Storage → Rules) to require sign-in, e.g.:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /pdf-annotator/{file} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
  }
}
```

## Never lose unsaved work again (local draft failsafe)

Since v1.22.0 the app mirrors everything on screen — the PDF bytes, all
annotations, the worksheet name and details — into a **local draft** in the
browser's IndexedDB a couple of seconds after every change, *even before the
worksheet has ever been saved*. If the tab closes, the browser crashes, or the
iPad discards the page, the next visit shows an **"Unsaved work found 🛟"**
dialog offering to restore the draft exactly as it was. Closing the dialog
keeps the draft for next time; only "Discard it" deletes it.

Notes:

- The draft lives in that browser on that device only (one slot — the most
  recently edited worksheet). Cloud "Save" is still the real backup: once a
  worksheet is saved once, cloud auto-save takes over after every change.
- The draft is marked clean whenever a cloud save succeeds, so you are only
  prompted when something genuinely never reached the cloud.

### Recovering work lost before this failsafe existed

Annotations made before v1.22.0 on a worksheet that was **never saved** lived
only in page memory — they cannot be recovered once the tab is gone. But:

1. **The PDF itself is not lost.** The app only reads a copy, so the original
   file is untouched wherever it came from — check your Downloads folder,
   email/WhatsApp attachment, or the browser's download history (Ctrl+J).
2. **Check My PDFs anyway** (M key) — if the worksheet was ever saved even
   once, the latest auto-saved version is in the cloud, sorted by most
   recently updated.
