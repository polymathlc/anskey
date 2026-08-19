# Anskey — PDF worksheet annotator

Single-file web app (`index.html`) for annotating PDF worksheets, backed by
Firebase (Auth + Firestore + Storage, project `mathgen--app`).

## Hidden worksheets — a category of your own (v1.70.0)

**A worksheet can now be saved as hidden.** The **Save worksheet** dialog has a
*Who can see it* switch — **🔒 Hidden — keep this out of every student's list** — and a
worksheet saved with it on is filed under **Hidden**, a category of its own at
the foot of your Worksheets list and of **My PDFs**.

**Students never see one, anywhere.** Hidden is checked before the level and
the subject are, so a hidden worksheet reaches no student list, no day band, no
subject chip and no count — not even one tagged for exactly their class. The
teacher's own device follows the same rule while it is handed over with
*Practise as*. The one way in stays open on purpose: a **share link you send
still opens it**, because sending that link is a deliberate act of its own.

**Hiding and unhiding takes one tap.** Every card in the Worksheets list carries
a padlock beside its star: 🔓 files the worksheet under Hidden, 🔒 puts it back
under its class day. The switch is also on the **Edit** row in My PDFs, so a
worksheet can be filed away without opening it, and the Save dialog remembers
the setting the next time that worksheet is saved.

**What a hidden worksheet looks like.** A dashed grey card saying *🔒 Hidden from
students* instead of the gold a starred one wears, gathered under one folded
**🔒 Hidden** band in the grey that means "no class day". The band stays folded
until you open it, whatever day or subject is being filtered — a file you have
put away is not something to go hunting for through the filters. With one on
screen, the sidebar says so under the worksheet's date.

The mark lives on the worksheet itself (`hidden` on its Firestore document,
written with merge so a save never clears it), so a worksheet hidden on the
tablet is hidden on the laptop too. The Hidden category is deliberately not a
class day: a card cannot be dragged into or out of it, because dropping one
there would file it under a day called "hidden".

## Two prints a student can read, and no generated cover (v1.69.0)

**The two print buttons now say what a student is actually choosing between.**
They have always been there for everyone — a student can print any worksheet
they can open — but they were named for the teacher's side of the desk. Signed
in as a student (or with the teacher's device handed over with *Practise as*),
they now read:

- **🖨 Print without working** — the worksheet on its own, every working, mark,
  text box and timestamp taken out, so it can be tried again from scratch.
- **🖨 Print with working** — the same worksheet with all the workings and
  answers on it, to revise from. While a student is practising, this is still
  the *teacher's* answer key, never their own attempt.

The toolbar pair (`Ctrl+P` / `Ctrl+Shift+P`), the pair in the **Print** card and
the toasts all follow the same wording. The teacher keeps **Questions** and
**Answers** — same two PDFs, same buttons, one set of words each.

**The generated cover page is gone.** Most worksheets already print their own
cover, so a second one in front of it was a page to throw away. Both prints are
now the worksheet itself from its first page — nothing prepended, no *Add a
Polymath cover page* toggle, no *Cover title* box, and the `coverTitle` field is
no longer written to the worksheet. The QR code that put a lesson recording on
the cover goes with it; the recording is still on the worksheet, in the **Video**
card and behind the video buttons on the page, exactly as before.

## Mindmap — the Mindmap app, in a window over the worksheet (v1.68.0)

A **new mindmap button on the toolbar** (or press **Y**) opens the board from
the Mindmap app in a window of its own, floating over the worksheet. Drag the
title bar to move it, the corner to resize it, the **–** to fold it down to its
title bar — the worksheet stays live underneath the whole time, so a map can be
built beside the question it belongs to.

**Building a map**

- Pick a shape — box, bubble, diamond or plain words — and click the board.
  Type straight away; typing on a box that is already selected replaces what is
  in it.
- **Tab** adds the next box along and joins it on. **Enter** adds one below on
  the same branch. Both open for typing immediately, so a whole map can be
  built without touching the mouse.
- The join tool links two boxes with an arrow that follows them wherever they
  are dragged. Straight lines and free-hand arrows are there too.
- Boxes line up with the ones already on the board as they are dragged, and a
  box joined to another is pulled square with it so the arrow between them comes
  out straight — the guides show in red and green while you drag.
- Wheel to zoom, drag the bare board to pan, **pinch to zoom** on an iPad. The
  fit button puts the whole map back on screen.

**What is new over the Mindmap app**

- **Text colour of its own.** Box fill, border and the words are now three
  separate colours, each with a row of quick swatches and a full picker behind
  it. Text size and typeface are on the same strip.
- **Links.** Any box or picture can carry a web address. A small chain appears
  in its corner; tapping it opens the page (Ctrl/⌘-click anywhere on the box
  does the same).
- **Pictures, properly.** Paste one with **Ctrl+V**, drop one on the board, or
  choose a file. Dropped or pasted onto a box, it fills that box. Pictures
  **keep their proportions** whenever they are resized, from any handle — no
  more squashed photos.
- **Resizing that works when zoomed.** The handles stay the same size under your
  finger however far in or out the board is zoomed, and Shift holds a box's
  proportions.
- **Finger and Apple Pencil.** The whole board runs on pointer events, so
  everything works on an iPad, pinch-to-zoom included.

**Keeping it**

The board is remembered **per worksheet, on this device** — open the same
worksheet tomorrow, press Y, and it is still there. Nothing about the worksheet
saved to the cloud changes. The download button saves the map as a picture at
double resolution, with the dotted paper and the selection outlines left out.

Everyone gets it — teacher and student alike, exactly like the calculator.

## Add note — a house rule in ten seconds (v1.67.0)

Teaching the AI something used to mean uploading a document. **A new
✍️ *Add note* button on the toolbar** takes a note the short way: type it, press
save, and it is live on the very next question.

- It lands in a new **General guidance** section of the Teaching notes window —
  standing instructions with no subject and no level, so they apply to **every**
  worksheet.
- The wording goes into the prompt **exactly as you typed it**. Nothing is sent
  to the AI to be read, extracted or summarised, so there is no waiting and no
  cost.
- Guidance is the one thing that reaches **every** AI call — writing an answer,
  the answer key, an explanation, a note card **and marking a student**. Only
  the worksheet in front of it (and, when marking, your own model answer)
  outranks it.
- Ctrl/⌘ + Enter saves, Esc closes. Leave the title empty and the first line
  becomes the title.
- Every note stays editable and deletable like any other, and the Teaching notes
  window now lists your guidance first, uploaded notes below. Any uploaded set of
  notes can be given standing instructions of its own from **✎ Edit**.

Students never see any of it, exactly as before.

## The AI runs on Gemini 3.7 Flash (v1.66.0)

Every Gemini call in the app — **Answer** and **Improve**, AI note cards, the
answer key, marking, keyword extraction and Ask AI — now goes to
**gemini-3.7-flash**. The ChatGPT engine is untouched: still your own key on
your own device, still tried first when you have switched to it, still falling
back to Gemini if it fails.

Two things had to move with the model, because 3.7 Flash **dropped the
"minimal" thinking level 3.6 accepted** and a level the model does not know
comes back as an error rather than a worse answer:

- The floor every ordinary call asks for is now `low`, kept in one named
  constant so the next model change is one edit.
- **Build quality** on AI note cards keeps its four real steps. Quick and
  Standard would both have landed on `low`, which would have made the choice
  between them change nothing, so Standard now asks for `medium` — Gemini's own
  default. Quick is still the cheap one; High and Pro build are unchanged.

## You can read the worksheet through the text box's bar (v1.65.1)

The floating bar sits over the page, so for as long as a text box was open it
hid whatever it landed on — a diagram, the question, the very line being
answered. **The bar is now 80% see-through**, and the words underneath read
straight through it.

Only the panel fades; the buttons, the colour dots and the size stay at full
strength, so nothing gets harder to use. Reaching for the bar (or pressing it)
turns it solid again. The student's **Check this answer / Ask AI** bar in
practice mode is the same bar, so it clears the page too.

## Colour and text size on the text box's own bar (v1.65.0)

**Restyling the box you are writing in no longer means leaving it.** The
floating bar above an open text box — the one carrying ✨ **Answer** and
✒️ **Improve** — now carries the colour and the text size as well.

- **Five colour dots**, the same palette as the toolbar, with a ring around
  the one the box is currently written in. Tapping one recolours the box
  straight away.
- **A− / A+** step the text size, with the current size between them.
- **Nothing is lost on the way.** The change is applied to the box in place,
  so on an iPad the keyboard stays up and the caret stays where it was —
  reaching up to the toolbar mid-sentence used to end the edit.
- **The choice carries over** to the toolbar and to the next text box, exactly
  as picking it on the toolbar does. Nudging the size up several times in a
  row is a single undo, not one per press.

**↔ Set width is gone**, and with it the remembered width for new text boxes —
new boxes size themselves from where you tap again, as they did before.

## Teaching notes, and an AI that learns how you answer (v1.64.0)

**The AI now writes from your notebook, not from the internet's.** A new
📚 **Notes** button on the toolbar (teacher only) opens the Teaching Notes
window, and everything the AI writes on a worksheet — the ✨ **Answer** on a
text box, the **Answer key**, **AI note cards**, **Ask AI**, and every mark it
gives a student in practice mode — is written from what is in there.

- **Upload your own notes.** PDFs and photos, several at once (they are read
  *together* as one set). The AI pulls out the **keywords** your students must
  use, your **marking standards** and the **key facts**, and everything it
  extracts stays editable — the keywords above all, since they are what it
  looks for when marking and reaches for when it writes.
- **Notes can name their subject and level**, or name neither and apply
  everywhere. If nothing matches the worksheet on screen the whole notebook is
  used rather than none of it.
- **They are the same notes as the Science Learning Portal's.** Both apps read
  and write one notebook, so anything uploaded on either side already counts on
  the other.
- **The order of authority never changes**: what the worksheet itself prints
  always wins, then your notes, then ordinary syllabus knowledge. When marking,
  your model answer on the page beats everything.

**And it learns from the answers you have already written.** Every answer you
type onto a worksheet is picked up quietly when you save it, and the window has
two buttons for going further:

- **📖 Learn from this worksheet** reads the worksheet on screen page by page,
  **handwriting included**, and takes down the answers you wrote in your own
  words.
- **📚 Learn from all my saved worksheets** sweeps every worksheet you have
  ever saved in one go.

What comes out is a short profile of *how you answer* — how long, how phrased,
what you always include, which words you insist on, what you accept for full
marks — with a handful of your real answers carried along as examples. It
rebuilds itself as more answers pile up, so the AI sounds a little more like you
every week. The window shows the profile in plain words, and **Forget what was
learned** clears it without touching your uploaded notes.

Students never see any of this: the button, the window and every write are the
teacher's own. Their device does read the notes, so the AI marks their practice
against your standards and not its own.

## Day dots on the toolbar, and a slimmer toolbar to hang them on (v1.63.0)

**Six pastel circles — M T W T F S.** They sit on the toolbar just after
*Open PDF*, one per class day (nobody teaches on a Sunday, so there is no
seventh). Tap one and the Worksheets list opens on that day and nothing else.
Tap the same circle again and the whole week comes back — so does the
*✕ Whole week* button on the banner at the top of the list.

- **The colours are the day's own.** A dot wears exactly the colour its day
  wears as a band in the list, so the circle you tapped and the heading you
  land on are obviously the same day. Tuesday's amber has been pushed clear of
  Monday's burnt orange, because two circles one letter apart have to be told
  apart by colour too.
- **Today's dot carries a thin ring**, so the day you are actually teaching is
  the easy one to find.
- **Everybody gets them** — a student's fastest route to "what did we do on
  Wednesday?" A share link is still one worksheet, so the dots stay out of it.

**Lesson times are banners now, not whispers.** The class time inside a day
used to be a small grey line; it is now a coloured banner with its own hue per
lesson — 3:00pm teal, 5:00pm amber, 7:00pm violet (and the same three on the
weekend morning timings, since the colour follows the *session*, not the
clock). Two classes on one day can no longer blur into each other. While a day
is picked out, every lesson gets its banner, even a day holding a single class,
and nothing starts folded — the times are the whole point of that view.

**The toolbar itself is short and sweet.** Every icon, chip, slider and file
button was trimmed: 28px tool buttons with 16px glyphs, tighter gaps and
padding, smaller colour chips and shorter sliders. Even with six new circles on
it the bar is *shorter* than it was before them, and the worksheet gets the
space back. The floating favourites bar was trimmed to match.

## Two quick taps no longer zoom the whole app in (v1.62.2)

Tapping a calculator key twice quickly set Safari's double-tap zoom off: the
whole app magnified, and getting back meant pinching out again — a chore in the
middle of a lesson, every time.

Buttons now say `touch-action: manipulation`, which keeps ordinary scrolling and
pinch-zoom of the page and drops only the double-tap gesture. It covers the
calculator (every part of it, keys included), the toolbar and header buttons,
the worksheet cards, the page-preview stars and the panel buttons — anything
you tap in a hurry. Two quick taps on a key are simply two presses now.

The parts that are *meant* to claim a touch keep doing so: the calculator's
title bar and resize grip, the ⠿ grip on a worksheet card, and the page overlay
you write on.

As a bonus, `manipulation` also removes the small tap delay Safari holds while
it waits to see whether a second tap is coming, so every button answers
immediately.

## Double-tapping a calculator key no longer breaks the sum (v1.62.1)

Double-click any key and it was typed twice. On the digits that is harmless —
77 is a number — but on everything else it made nonsense: `77//88`, `2..5`,
`÷÷`. The screen filled with a red *“That sum is not finished.”* instead of the
number you were after, and the double-click also selected the key's label, so
the pad went blue.

- **A second operator replaces the first.** Two taps on ÷ is one ÷, and
  pressing × after ÷ means × — the way every calculator behaves. The same for
  the a/b fraction bar.
- **One decimal point per number.** A second point in the same number is
  ignored; the next number gets its own.
- **x² needs something to square.** Pressed with nothing in front of it, or
  straight after an operator, it does nothing instead of writing a broken sum.
- **An operator needs something to work on**, except a minus, which is allowed
  to be a sign at the start of a sum or straight after a bracket.
- **Nothing highlights blue.** The keypad is no longer selectable text. The
  screen still is, so an answer can be copied.

Roots deliberately still stack: `√√9` is a real thing to ask for.

## Smooth pinch zoom, and the pencil ready from the start (v1.62.0)

**The zoom follows your fingers now.** Two things were making it lurch:

- **It ignored anything under 2%.** The pinch only moved the page when the
  fingers had changed the distance between them by more than 2% — and then it
  applied all of it at once. Fingers move smoothly; the page arrived in jumps.
  Every scrap of the gesture now counts.
- **It did a full day's work on every touch report.** An iPad reports a pinch up
  to 120 times a second, and each report resized all sixty pages of a worksheet
  and then read the scroll position back — two forced layouts per report. The
  reports are now collected and turned into exactly one zoom per animation
  frame, which is as often as the screen can show one: 120 pointer moves came
  out as 6 zooms in testing, landing on precisely the scale the fingers asked
  for. Nothing is dropped, twenty times less work is done.
- **The pages no longer re-sharpen mid-pinch.** Rasterising a page throws its
  picture away and paints a new one — a visible stutter if it happened while
  you merely paused with your fingers still down. It now waits for the fingers
  to come off, then sharpens.

**Pencil-only mode is on from the start.** The Apple Pencil draws, fingers
scroll the page, and a resting palm does nothing — no more discovering that a
palm has drawn across a worksheet. It used to wait until a pencil had touched
the screen once before switching itself on. Turning it off is still one tap on
the pencil button, and the device remembers that choice from then on.

## Why the answer key disagreed with ChatGPT (v1.61.1)

The same paper, the same model, two different answer keys. The model was never
the difference — **how hard it was allowed to think was**.

- **The reasoning was never turned on.** The answer key asked for a reply
  without setting a reasoning level at all, so ChatGPT ran at its default
  effort while the ChatGPT app was on *Extra High*, and Gemini ran at
  `thinkingLevel: "minimal"` — the app-wide default, which is barely thinking.
  A P5 word problem is four or five steps of units and model drawing; a model
  answering off the top of its head gets them wrong. The key now asks for the
  most reasoning either engine will give (`xhigh` / `high`), with the budget
  raised to cover the thinking as well as the answer. If a model refuses that
  level it steps down to `high` rather than giving up on reasoning altogether,
  which is what used to happen.
- **The page went up too small to read.** Pages were sent at 1500px and JPEG
  0.85 — on a dense worksheet "$140.20" and "$14.20" are the same few pixels,
  and one misread number makes every step after it wrong. Now 2200px at 0.92,
  which is about twice the detail.
- **It is asked to check itself.** Every page is now told to work each question
  out step by step and check the arithmetic back against the numbers printed on
  the page before answering.
- **The key says which model worked it out.** On screen, in the print-out and
  in the PDF: *"by ChatGPT gpt-5.6-sol"* or *"by Gemini gemini-3.7-flash"*.
  Choosing ChatGPT in AI Engine is not the same as using it — with no OpenAI
  key saved every call quietly goes to Gemini, and a failed ChatGPT call falls
  back to Gemini mid-key. Both cases now say so out loud when the key finishes.

**If your key still disagrees with the ChatGPT app, read the line under the
title first.** A key that says *Gemini* was never gpt-5.6-sol's work — paste
your OpenAI key into AI Engine and generate it again.

## A calculator, in a window you can drag (v1.61.0)

A calculator button in the toolbar (or press **K**). It opens a window that
floats over the worksheet, moves wherever you drag its title bar, resizes from
the corner, and comes back where you left it next time.

- **Fractions stay fractions.** `1/3 + 1/6` comes back as **1/2**, not
  0.4999999999999999; `6/8` shows as **3/4** and `3/4 + 1/2` as **5/4**, with
  “= 1 1/4 = 1.25” underneath. Fractions are drawn the way they are written on
  paper, one number over the other. Even a typed decimal is exact — 2.75 is
  11/4 — so it stays a fraction all the way through the sum.
- **Powers and roots.** x², xʸ, √ and ∛, and they stay exact when they can:
  √(9/4) is 3/2, ∛(8/27) is 2/3, (1/2)³ is 1/8, 2⁻² is 1/4. π is there too.
  Anything that cannot be a fraction — π, most roots — carries on as a decimal,
  and the answer says which of the two it is. **F↔D** swaps between them.
- **No trigonometry.** Nothing on these papers needs sin or cos, and every key
  not there is one less to hunt past.
- **Written the way it is said.** `2π`, `3(4+1)` and `2√9` all work — the × is
  put in for you. `±` flips the number you just typed rather than starting
  again, and `Ans` carries the last answer into the next sum.
- **Type it or tap it.** The keyboard works while the calculator has focus —
  `/` makes a fraction, `^` a power, Enter works it out, Esc closes it — and
  those keystrokes stay inside the calculator, so the app's own one-letter
  shortcuts do not fire while a sum is being typed.
- **Everybody gets one.** Teacher, student and share-link visitor alike.

Exactness is never faked: every step checks its numbers are still whole numbers
a browser can hold exactly, and the moment they are not the answer becomes a
decimal rather than a wrong fraction.

## ChatGPT gpt-5.6-sol is the default engine (v1.60.0)

Every AI feature — the answer key, Answer and Improve, AI notes, marking,
keywords, Ask AI — now runs on **ChatGPT gpt-5.6-sol** unless it is switched
back. Gemini stays as the engine that needs no key, and as the automatic
fallback whenever ChatGPT fails, so the AI never simply stops working.

- **The key is asked for once, in the app.** Sign in as the teacher on a device
  with no key saved and the AI Engine window opens by itself, ready to paste
  into. Saving it puts it in your own teacher-only settings record, so every
  device you sign in on afterwards fills itself in and never asks again. Cancel
  and it stays out of the way — the AI button in the header opens it whenever
  you are ready. Asked at most once per device.
- **Nothing changes for students.** Until a key is saved, `openAiActive()` is
  false and everything runs on Gemini exactly as before. Students and
  share-link visitors have no key and never will, so they always use Gemini —
  and every "Gemini"/"ChatGPT" label on screen names the engine that actually
  answered, so nothing ever claims ChatGPT while Gemini is doing the work.

### Why the key is never in this repository

`index.html` is served as a public web page. A key written into it would be in
the page source of every student's browser, in the repository's history for
good, and — since OpenAI and GitHub both scan public code for keys — revoked
within minutes of being pushed. So the app has no place to hardcode one: it is
pasted into the AI Engine window and kept in the admin's own `adminSettings`
record, which only that account can read. If a key ever does get committed,
treat it as public: revoke it at platform.openai.com and issue a new one.

## The Worksheets list knows whose it is (v1.59.1)

The list on the left is the student's way in and the teacher's errand. It now
behaves like it.

- **Shut for the teacher, open for a student.** Which one it is is decided once,
  as soon as the account is known. A student signing in gets the list open —
  their first question is always "which worksheet?" — and a teacher never does.
  A device where a student had been signed in has the list closed again when the
  teacher takes it back.
- **It closes behind the teacher.** Picking a worksheet from the list used to
  leave it open, taking a column of the page for the rest of the lesson (it only
  ever got out of the way on a tablet). The teacher came for one worksheet, so
  once it is on screen the list closes. A student's list stays open — they are
  browsing — except on a tablet, where it floats over the worksheet as before.
- **A panel moved by hand is left alone.** The first time the list is opened or
  closed by hand it settles for the session; nothing opens or closes it again
  behind the user's back.
- **Share links are untouched** — a visitor arriving at one worksheet never gets
  a list of the others.

## Answer key button — worked from the blank paper (v1.59.0)

A new **Answer key** button sits beside “My PDFs” in the toolbar. Press it and
the whole worksheet is worked out from scratch and a PDF answer key lands in
your downloads.

- **It reads the paper, not the markings.** The pages sent to the AI are
  rendered without a single annotation on them, and nothing that was written on
  the worksheet — pen, text boxes, note cards — is mentioned in what it is
  asked. The answers are worked out from the printed questions alone, so the key
  is an independent check rather than a tidy-up of what is already there.
- **Every question, explained properly.** Each entry gives the answer and a full
  worked explanation: the concept being tested, the working line by line with
  the numbers in, and the answer stated at the end. A multiple-choice question
  also says why the tempting wrong options are wrong.
- **Downloaded as a PDF.** Laid out as a document — A4, one question after
  another, never a heading stranded at the foot of a page — and saved as
  “<worksheet> - Answer key.pdf”. Nothing is written to the worksheet and
  nothing on screen is changed.
- **Filenames that survive.** A download name with an em dash in it made
  Chromium throw the whole name away and save the file as “download”. Both
  downloads (this one and the annotated PDF) now clean the name first.
- **Teacher only.** The button is not there for students, for a device handed
  over with “Practise as”, or for a share link.

The sidebar's own *Generate answer key* is unchanged — that one still reads the
teacher's handwritten answers and treats them as authoritative. This button is
the other half: the answer key when there is nothing on the page yet.

## Drag a worksheet where it belongs (v1.58.0)

The list orders itself newest-first inside every class, which is right until it
isn't: the worksheets for one lesson have an order the teacher knows and the
dates do not. Now they can just be moved.

- **Pick one up by its grip.** Every card in the ☰ worksheets list has a ⠿ grip
  on its left. Drag it up or down to set the order inside its class; the list
  opens a space as the card passes. On a desktop the card itself can be dragged
  too — on a touchscreen only the grip does, so a finger on a card still
  scrolls the list and a tap still opens the worksheet.
- **Across to another class time.** Drop it under the day's other lesson and its
  class time changes with it.
- **Across to another day.** Drop it on another day's band or between its cards.
  The worksheet's date moves to the nearest date that falls on that day — a
  worksheet dragged from Tuesday 21 Jul to Monday becomes Monday 20 Jul — so the
  date on the card still means something and saving it later keeps it there.
- **Empty classes count.** While a card is in the air, every class of every day
  appears in the list, including the lessons and days with nothing in them yet,
  so there is always somewhere to drop it. They vanish again when it lands.
- **It is the same list for everybody.** The arrangement is saved on the
  worksheets themselves, so students see the order their teacher set. A
  worksheet saved after the arranging sits at the top of its class until it is
  dragged, which is where a new worksheet belongs anyway.
- **Teacher only.** Students and share-link visitors have no grip and cannot
  move anything. A drop that cannot be saved puts the card back and says so.

## A starred page stays starred (v1.57.1)

Marking a page and finding the star gone later. The mark was being saved — it
was the *opening* that threw it away, and the same fault was quietly rolling
back annotations too.

- **A worksheet now opens from the live document.** The ☰ questions list is
  fetched once, when the drawer is opened, and on a desktop the drawer then
  stays open for the whole lesson. Opening a worksheet from it a second time
  replayed that snapshot — the worksheet exactly as it was when the list was
  loaded, before the page was ever starred. Every open now re-reads the
  worksheet first, so the marks, the annotations and the details are whatever
  they actually are. (This was losing more than stars: writing added after the
  list was loaded came back missing, and the next auto-save wrote that stale
  copy over the real one.)
- **A failed mark says so.** A mark that could not reach the cloud used to fail
  in the console only. It now says so on screen, and stays on the page.
- **Every save carries the marks.** The teacher's auto-save re-states the pages
  still to be done, so a mark whose own write failed — or a worksheet saved by
  the older annotator, which knows nothing about the field — is put right by the
  next stroke on the page.
- **The device remembers them too.** The marks are mirrored into this browser
  per worksheet. A worksheet that comes back without any marks at all gets them
  from that memory and writes them back; clearing a page still clears it
  everywhere, because a cleared list is saved as an empty list, not as nothing.

## Star the pages still to be done (v1.57.0)

A 59-page worksheet has maybe six pages that matter this lesson, and nothing on
screen said which. Now the page previews do.

- **★ on every preview.** Open the page thumbnails (the toolbar's page button,
  or `N`) and each preview has a star in its corner. Tap it to mark that page
  as important and not done yet; tap again to clear it once it's finished. The
  outline stays out of the way until you hover a preview — only the marked ones
  keep their star showing.
- **The marked page stands out.** A starred preview gets the same gold ring the
  starred worksheet cards use, and its page number turns gold, so the pages to
  do are findable at a glance while scrolling the strip.
- **A running tally at the top.** When any page is marked, a small gold bar sits
  at the top of the strip — “★ 3 pages still to do”. Tap it to jump straight to
  the next marked page below where you are, wrapping round to the first.
- **It belongs to the worksheet, not the device.** The marks are saved on the
  worksheet the moment they're made (`starPages` on its Firestore document), so
  they're there next lesson, on any device, and they reach every student who has
  the worksheet open live — no reopening needed.
- **Teacher-only marking.** Students (and a device handed over with “Practise
  as”) see the pages you marked and the tally, but never the empty outlines, and
  can't mark or clear a page.

## The answer key covers the MCQs too (v1.56.2)

The generated answer key was coming back with only the open-ended questions on
it — every multiple-choice question was missing. Three things were dropping
them, all fixed:

- **Two sections, one set of numbers.** A paper with a multiple-choice section
  followed by an open-ended section numbers both from 1. The key folded any two
  entries sharing a number into one and kept the fuller of them — which is
  always the open-ended one, so every clashing MCQ answer was thrown away.
  Entries are now only merged when they are genuinely one question split across
  a page break: same number, same kind of question, and on this page or the one
  before. When a number really does appear twice, each entry says which page it
  is on.
- **The reply ran out of room.** A page of 15–20 multiple-choice questions
  needs far more room than the four or five on an open-ended page, and the
  answer ran out mid-sentence — losing the tail of the page, or the page
  entirely. The budget is now three times bigger, and if a page still does not
  fit it is asked again for the answers alone rather than being dropped.
- **It was never told they count.** The instructions now say in as many words
  that every question is keyed whatever its form — multiple choice, fill in the
  blank, true or false, matching, tables and diagrams included — that a page of
  nothing but MCQs must come back with one entry each, and that the count must
  be checked against the page before answering.

## Star the worksheet to open next (v1.56.1)

Whoever teaches the next lesson opens the ☰ questions list and has to work out
which worksheet is the right one. Now the teacher can just point at it.

- **★ on every card.** In the questions list on the left, each worksheet has a
  star in its corner. Tap it and the worksheet is marked as the one to open.
  Tap again to unstar. Star as many as you like — a day with two lessons needs
  two.
- **The card turns gold.** A starred worksheet's rectangle gets a gold ring, a
  gold tint and an “★ Open this one” tag, so it stands out from every other
  card at a glance.
- **It stays where it belongs.** The card keeps its place under its class day
  and lesson time — the highlight is the whole signal, so nothing has to be
  hunted for anywhere else. A day holding a starred worksheet never starts
  folded, and the list's subtitle counts them (“· ★ 1 to open”).
- **Everyone sees the same mark.** The star lives on the worksheet itself, so
  it is there on every device that opens the list — that is the whole point.
  Only the teacher can add or remove one; students (and the teacher's own
  device handed over with Practise as) see the highlight but no star button.
- **Saving never clears it.** The mark is written on its own and survives every
  later save, rename or re-tag of the worksheet.

## A text box lands on the cursor and types straight away (v1.55.1)

- **It appears exactly where you clicked.** A new text box used to sit slightly
  right of and below the pointer — the first letter started a padding's width
  in, and the whole line hung below the tap. The box is now placed so the first
  letter begins on the pointer and the first line is centred on it, matching
  the middle of the I-beam cursor.
- **You can type immediately.** The keyboard occasionally failed to land in a
  brand new box, and it took a second click — often slightly to the right,
  where the words are — before typing worked. The box now keeps hold of the
  focus for longer, and takes it back whenever a re-render (an auto-save, a
  live update) swaps its node out mid-sentence.
- **Clicking inside the box you are typing in always works.** A tap on the
  box's padding or edge, rather than on the words themselves, now puts the
  caret where you tapped instead of leaving the box looking open but deaf.

## No size limit on a worksheet's annotations (v1.55.0)

Saving a heavily marked-up worksheet could fail with *“…is longer than
1048487 bytes”*. That is Firebase's hard cap on a single Firestore document,
and a lesson's worth of pen strokes, AI note cards and widgets goes past it.
**A save is never refused for being too big any more.**

- **Big annotations get a file of their own.** When the annotations no longer
  fit in the worksheet's document, they are written next to the PDF in Storage
  as `pdf-annotator/{id}.annotations.json`, and the document keeps a pointer to
  it. Nothing about using the app changes — Save, auto-save, opening, share
  links, live updates on a student's screen and downloads all work exactly as
  before, at any size.
- **Small worksheets are untouched.** Anything that still fits is saved
  inline, the same way as always, so nothing needed converting.
- **And if it still refuses.** Should Firebase turn a write away for size even
  so, the app immediately re-saves it into Storage instead of showing an
  error. The one thing a save must never do is fail.
- **Steadier auto-save on the big ones.** A worksheet whose annotations live in
  Storage re-uploads the whole file each time, so auto-save waits ~9s after the
  last change instead of ~4s. Identical bytes are never uploaded twice.
- **Nothing is ever silently emptied.** If the annotations file cannot be
  downloaded, the worksheet refuses to open rather than opening blank — a blank
  worksheet would otherwise be auto-saved over the real one.

**If you have tightened the Firestore rules for edit-mode share links** (see
*One-time Firebase setup for share links* below), let a visitor's write touch
the two new fields as well, or their saving stops once a worksheet grows past
the cap:

```
.hasOnly(['annotations', 'annotationsPath', 'annotationsStamp', 'updatedAt'])
```

The Storage side needs nothing new: the file sits in the same `pdf-annotator/`
folder as the PDF, so the existing rules and CORS setup already cover it.

## A button that always brings the toolbar back (v1.54.0)

The toolbar can fold away — from the favourites bar, or with full screen — and
until now only the teacher's favourites bar could bring it back. On a device
where it was already folded away, the toolbar simply looked like it had gone
missing.

- **Top-right corner of the worksheet.** A rounded **Hide toolbar / Show
  toolbar** button now floats in the top-right corner of the working area,
  above the page you are annotating.
- **One press puts it back, the next folds it away.** While the toolbar is
  away the button turns amber and reads *Show toolbar* — pressing it brings the
  toolbar back whichever way it went, full screen included. Pressing it again
  hides the toolbar, with a message reminding you that the same button brings
  it back.
- **Everyone gets it.** Teacher, student and share-link visitor alike, so
  nobody is ever left on a device with no toolbar and no way to it.
- **It follows the chrome.** The button parks itself against the top of the
  working area, so it stays put when the banner is hidden, when the toolbar
  wraps onto a second row, and on any screen size. In full screen it sits just
  below *Exit full screen*.

## Recordings go to your own Google Drive (v1.53.0)

Recordings were landing in the app's Firebase Storage bucket, which is small
and shared with every worksheet PDF. They now go into **your Google Drive**,
where the 20 TB is — and the pill on the page links to the Drive file behind
the scenes, so nothing about watching one changes.

- **A folder of its own.** Everything the app records goes into a folder
  called *Ans Key recordings* in your Drive, named after the worksheet and the
  time: `Speed & Density WS3 — recording 2026-08-03 14.32.mp4`.
- **Connect once a session.** The recorder window has a Drive card at the top
  with a **Connect** button. It asks Google for the same account you are
  already signed in as, with one extra permission (`drive.file`) — per-file
  access, so Ans Key can only ever see the folder and the recordings it made
  itself. Nothing else in your Drive is reachable by it. Google's access lasts
  about an hour, and the card says how much is left; **Start** waits until you
  are connected.
- **Shared as “anyone with the link”.** Each recording is set to link-sharing
  as it is uploaded, so students (and share-link visitors) open it without a
  Google account. If your Drive refuses to make it public, you are told —
  the file is still there to share yourself.
- **Nothing gets lost.** A recording is held in the app until it is safely
  uploaded. If Drive access has expired, the corner card offers **Retry**,
  which reconnects and carries on; if Drive turns the file away for any other
  reason, it goes into Firebase Storage instead and a message says so. There
  is a **Use Firebase** button there as well.
- **Give it a minute.** Drive processes a newly uploaded video before it will
  play, so a recording watched seconds after it goes up may say it is still
  processing.

Recordings uploaded before this version keep working exactly as they did.

**Setting it up once:** the Google Cloud project behind this app
(`mathgen--app`) needs the **Google Drive API** switched on, and `drive.file`
listed on its OAuth consent screen. Both are console settings, not code.

## Record a video answer without leaving the worksheet (v1.52.0)

Explaining a question used to mean recording somewhere else, uploading it
somewhere else again, and pasting the link back in. The new **🎥 record button**
in the toolbar (or **Shift+R**) does the lot from inside the app.

- **Three things to record.** *Camera + microphone* for a talking-head answer,
  *this screen + microphone* for a walkthrough with your voice over it (the
  screen's own sound and your voice are mixed into one track), or *microphone
  only* for a quick spoken note. The screen option hides itself on devices that
  cannot share a screen, such as an iPad.
- **720p, deliberately.** The capture is capped at 1280×720 at 30fps and about
  1.2 Mbit/s, so a long answer is a few megabytes a minute rather than tens —
  small enough to upload over classroom wifi and quick for a student to open.
  A recording stops itself at 20 minutes.
- **Stop, and get on with the lesson.** The window closes the moment you stop.
  Packing the file up and uploading it to Firebase Storage happens in the
  background, with a small card in the corner showing how far along it is (and
  a **Stop** if you change your mind). Nothing blocks the worksheet in the
  meantime.
- **What lands on the page is a button.** The recording drops onto the page in
  view as an ordinary video-solution pill. It sits greyed out reading
  *Uploading… 42%* while it goes up, then turns into **Watch the recording** —
  tap it and the player opens right there, with scrubbing and full screen, for
  students and share-link visitors alike. Move it, erase it or lasso it like
  any other annotation, and it bakes into the downloaded PDF as a tappable
  link, same as a pasted one.
- **Or record into a pill you have already placed.** The video-solution window
  now has a **🎥 Record** button beside the link box, so you can put the button
  exactly where you want it first — and **Record over it** replaces the video
  on a pill that already has one.

Recording is the teacher's, like the AI tools: students, share-link visitors
and a device handed over with "Practise as" never see the button.

## A widget can take the whole screen, or a tab of its own (v1.51.0)

A widget card is drawn to sit beside the question it teaches, which is the
wrong size for a model the back of the room is meant to read. Two new buttons
on every finished widget's heading:

- **⛶ Full screen.** The running widget fills the whole screen — the same
  frame, never rebuilt, so whatever it was doing carries straight on. It goes
  live for as long as it is up (and back to however you left it afterwards),
  and the browser's own bars go too wherever that request holds (not on iPadOS
  Safari, which drops it again at the first drag — there the widget still goes
  edge to edge inside Safari). Come back with the **✕ Exit full screen** button
  floating over it, or with Esc.
- **↗ New tab.** The widget opens in a tab of its own, filling it, and the
  worksheet stays exactly where it was — so a widget can be put on the board
  while the marked-up page stays in front of you. The tab has its own
  **⛶ Full screen** button for real full screen. The widget keeps the sandbox
  it has on the worksheet: it runs in a sandboxed frame there too, with no
  reach into the app, its sign-in or the network.

Both buttons are everyone's — a student handed a share link is exactly who
needs the model at a readable size.

## Cards move and resize by their grips (v1.50.0)

Moving a widget was fiddly, and while one was running it was close to
impossible. Three things were in the way, all fixed:

- **A finger was panning the page instead.** Once the Apple Pencil has been
  used, the app switches to pencil-only mode, where one finger on the page
  scrolls it — and that rule was claiming the finger before the card ever saw
  it. A finger on a card's grip now moves the card; everywhere else it still
  pans.
- **The heading was the only thing you could grab, and it was thin.** The
  heading of every AI card is now an explicit **drag bar** — grip dots at the
  left, and the whole strip drags, title and all — and it is deeper than it was
  (18pt rather than 15pt) so it can be caught rather than aimed at. It works
  with **whatever tool is in hand**: no switching to select first. Its buttons
  still win over the drag, and the eraser and lasso still do their own job on a
  card. A minimised pill drags the same way, and double-tapping it still opens
  it back up.
- **A live widget could not be resized at all.** The card's usual corner
  handles are drawn in the annotation layer, which a running widget sits on top
  of — so they were unreachable exactly when the widget was at its most useful.
  A live widget now carries its own **⇲ resize corner** above its frame, sized
  for a finger. Drag it and the card resizes without the model inside
  restarting.

Students see neither grip and cannot move or resize a teacher's cards; they
still get ▶ Use, the widget itself and the minimise button.

## Widgets work under a finger (v1.49.1)

A finished widget could not be used on an iPad — buttons did nothing, dragging
did nothing. Two separate causes, both fixed:

- **It arrived locked.** A new widget was created with `live: false`, so the
  first thing you did after waiting a minute for it was tap a widget that had
  been told to ignore taps. A freshly built widget now arrives **live**. ✋ Lock
  is still one tap away in its heading for when the pen needs to write over it,
  and widgets saved before this update still need ▶ Use once.
- **The generated code was written for a mouse.** Left alone, a code model
  writes `mousedown` / `mousemove` / `mouseup` on a canvas and `click` on a
  `<div>` — and iOS fires neither during a finger drag. Every widget now runs
  behind a small compatibility layer that turns finger gestures into the events
  the app is listening for, sends the click a plain `<div>` never gets, and
  claims the gesture so the browser's own delayed mouse burst cannot fire the
  same button twice. Real buttons, sliders and links are left completely alone
  — iOS already drives those properly. An app that handles touch itself is
  detected and left alone too.

Widgets are also given a proper viewport now, so iOS stops laying them out for
an imaginary desktop window and putting the buttons where you are not pressing.
New builds are additionally told to use Pointer Events and `touch-action:none`
for anything draggable, so they are touch-native from the start rather than
relying on the compatibility layer.

## The ChatGPT key is remembered, and widgets build properly (v1.49.0)

**Paste the OpenAI key once.** It used to live only in this browser's
localStorage, which iPad Safari throws away after about a week of not opening
the site — so it had to be pasted again every school holiday. It is now also
kept in your own teacher-only settings record (`adminSettings/{your uid}`), and
read back the moment you sign in. A new iPad, a cleared browser, a reinstall:
ChatGPT is already on, with the model and image model you chose. Clearing the
box and saving forgets it in both places.

> **One-time setup:** add this to the Firestore rules, or the key cannot be
> saved (the app will say so and keep working on this device only):
>
> ```
> match /adminSettings/{uid} {
>   allow read, write: if request.auth != null
>                      && request.auth.token.email == 'chungzhikai@gmail.com';
> }
> ```
>
> Students, share-link visitors and “Practise as” devices never read this
> collection.

**“Highest” is now “Pro build”, and it means it.** The top build-quality
setting was still producing thumbnail-grade widgets, for three reasons that are
all fixed:

- **It was being told to keep things small.** Every card shared one brief —
  *“the card is small, so every word has to earn its place”* — which is right
  for a note and wrong for a teaching app. A Pro build now gets its own brief:
  a proper stage and control panel, three to six controls, live readouts, a
  second linked view (graph, table or trace) where it helps, real physics and
  maths rather than a faked animation, a “what to look for” line, a challenge
  for the class, and presentation-sized text for an iPad held up at the front.
- **It was quietly running out of room.** A reasoning model spends its budget
  on thinking as well as writing; at the old ceiling the thinking could eat the
  lot, the build came back empty or half-written, and the card silently fell
  back to Gemini. A Pro build now has no practical length limit, and if it
  still runs out mid-page it is told to carry on from where it stopped and the
  pieces are stitched together — the same “continue” you would press in the
  ChatGPT app.
- **You could not tell which engine built it.** If ChatGPT fails, Gemini still
  steps in so a lesson never stalls — but a Pro build now says so on screen,
  with the reason, instead of leaving you wondering why it came back plain.

Pro-build cards are also drawn larger to begin with (430×320 instead of
310×230), so a full app is not squeezed into a thumbnail. Still resizable, as
always. The other three settings are unchanged.

## Award marks without leaving the worksheet (v1.48.0)

The **Reward** button in the toolbar (shortcut **B**) opens the class you are
teaching and hands marks out on the spot. It writes straight into the reward
system — the same marks, the same history, the same bosses the students see in
the points app — so nothing has to be typed up again after the lesson.

- **The class is already chosen.** The worksheet's day, level and lesson time
  pick it: a Wednesday 5pm P5 worksheet opens the P5 Wednesday 5pm register,
  not the 7pm one. Change it in the dropdown whenever the guess is wrong.
- **The class is remembered on the worksheet**, so next lesson it opens on the
  right register straight away.
- **A tap is a mark.** Choose the amount — 1, 2, 5, 10 or type your own — then
  **+** or **−** per student, or **Award everyone** for the whole class at
  once. Each tap shows the student's new balance and how much they have been
  given so far in this sitting.
- **It is logged like any other award.** Every tap appends to the marks history
  in the points app with the worksheet's name as the reason, and can be undone
  there. Marks earned damage the active boss, exactly as a test-paper upload
  does.
- **The register is editable mid-lesson.** Type a name at the bottom to add a
  student to this class (the level is filled in from the worksheet), or press
  **✕** on a row and say which you meant: *Take out of class* keeps the record,
  the marks and the history and only drops this class; *Delete entirely*
  removes them from the reward system, behind a second confirm.
- **Teacher-only, admin-only.** The button does not exist for students, for
  share-link visitors, or while the device is handed to a student with
  “Practise as”. Students still earn and spend in the points app — this is only
  the giving end.

Moved here from the older annotator in the `cer` repo, which no longer has any
reward feature.

## Scrolling a long app in the code window (v1.47.0)

An app taller than the code window used to have to be scrolled from inside the
sandbox, and an app whose own CSS says `overflow: hidden` — which generated
pages very often do — could not be scrolled at all: everything below the fold
was simply unreachable. Now the **pane** is the scroller, not the frame.

- **The frame is made as tall as the app says it is.** The hook already inside
  the sandbox reports the content height back, and the pane scrolls over it as
  an ordinary scroller in the app's own document — wheel, trackpad, scrollbar
  or finger.
- **Apps that fill the frame are untouched.** One laid out to `100vh` reports
  exactly the frame height, so nothing scrolls and nothing changes.
- **Finger drags are forwarded** from inside the sandbox as an absolute
  position, so where the browser also scrolls the pane by itself the two agree
  instead of adding up. A drag that starts on something interactive — a slider,
  a canvas, a button — or inside a scroller of the app's own is left alone.
- **A runaway app cannot grow forever:** the frame is stretched at most four
  times per run, so a body sized at 200% of the window settles instead of
  doubling on every measurement.

## Zoom what is running (v1.46.0)

**−** and **+** buttons scale the app inside a frame, in both places one runs:
the **widget card** on the worksheet (in its heading, beside ▶ Use) and the
**code window** (in its button bar, with a percentage beside them).

- **The app does not restart.** The frame is restyled, never rebuilt, so a
  simulation mid-demonstration keeps its state — zoom in on the thing you are
  pointing at without losing where you had got to.
- **The app does not reflow either.** The frame is laid out at its natural size
  and the whole result is scaled, so a widget built for a phone stays built for
  a phone — it just gets bigger, instead of rearranging itself as you zoom.
- **Steps from 40% to 300%**, growing from the top-left corner so what you are
  pointing at stays where it was.
- **The percentage in the code window resets to 100%** when you click it.
- A card's zoom is remembered with the worksheet; the code window's is
  remembered on the device.

## Minimise a card (v1.45.0)

Every card on the worksheet — a widget, notes, a table, a picture — now has a
**–** button in its heading. It folds the card down to a small rounded
rectangle wearing its own name: **Widget**, **Note**, **Graph** or **Picture**.

- **The question underneath comes back.** A card generated beside a question
  usually lands on top of it. Minimise it and the printed question is readable
  again, without moving or deleting anything.
- **A running widget keeps running.** The frame is hidden, not thrown away, so
  a simulation mid-demonstration is exactly where it was when it comes back —
  and a widget still switched on with ▶ Use returns live.
- **⤢ opens it back up**, and so does a double-tap anywhere on the pill. The
  card returns at the size it was drawn at; minimising never touches it.
- **The pill moves like any annotation** — drag it into a margin and park it
  there. It has no resize handles: there is nothing to resize until it is open.
- **Remembered with the worksheet**, so a card parked out of the way stays
  parked, and it prints minimised too — the printout matches the screen.
- **Students get the button as well.** Reading the worksheet needs the question
  uncovered as much as teaching it does.

## Code window (v1.44.0)

A **`</>`** button in the toolbar (shortcut **J**) opens a floating code
window: paste HTML in, and the app runs underneath it. For showing the class a
simulation you already have — from a chat, a lesson folder, or written by hand.

- **Paste and it runs.** No button needed; pasting (or dropping) code runs it.
  ▶ Run restarts it, Ctrl/⌘+Enter does the same from the keyboard.
- **Takes what you give it.** A whole page, a bare snippet, or a ```` ```html ````
  code fence copied straight out of a chat — the fence is stripped and a
  snippet is wrapped into a page.
- **Hide code** collapses the editor so the app fills the window for the class.
  The window drags, resizes and minimises like the AI notes window, and the
  worksheet underneath stays live.
- **📌 Pin to page** drops the running app onto the worksheet as an ordinary
  widget card — it saves with the worksheet, moves and resizes like any card,
  and ▶ Use switches it on.
- **Broken code says so.** Script errors inside the sandbox are reported in the
  window instead of leaving a blank white box.
- **Same sandbox as the generated widgets:** scripts only, no network, no
  storage, no access back into the app. Teacher-only — students and share-link
  visitors never see the button.
- The code you pasted and the window's size and position are remembered on the
  device.

## One-tap teaching widgets (v1.43.0)

Choose **Interactive widget**, click beside a question, press Generate with the
instructions box **empty** — and you get an interactive app that teaches the
concept behind that question. No typing, mid-lesson.

- **The spot is the brief.** The job sends the page image plus where on the page
  you clicked ("roughly 50% across and 49% down"), and asks for the question
  printed nearest there — the one above, if the spot falls between two. The
  instruction is to teach the idea underneath the question, not to answer it.
- **The page always goes with it.** With nothing typed there is nothing else to
  go on, so the snapshot is attached even if *Let … see this page* is unticked.
  If the page cannot be read at all, the window asks for words instead of
  guessing.
- **Blank means blank only for widgets.** Notes, tables and pictures still ask
  what you want.
- **Redo stays blank.** A card built this way remembers no instructions, so
  reopening it shows an empty box and Generate again re-reads the question at
  the card's own spot.
- **The card type is remembered** across reloads, so a widget teacher opens the
  window already on *Interactive widget*.

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
Gemini 3.7 Flash through Firebase AI Logic by default, with no key to manage.
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

Both prints are the worksheet itself, first page onwards — nothing is put in
front of it. (v1.35.0-v1.68.0 could prepend a generated Polymath cover page;
that was taken out in v1.69.0, since the worksheets already carry their own.)

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
                    .hasOnly(['annotations', 'annotationsPath',
                              'annotationsStamp', 'updatedAt'])));
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
