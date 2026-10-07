# Voice commands with OpenAI Decisions and live assistance

This directory provides the server functions for Ans Key's **Voice AI** button.
The teacher can speak to move, resize, add or delete worksheet objects, undo or
redo edits, change pages, and ask questions. OpenAI Decisions routes the spoken request and
selects an existing target; the app validates and applies supported edits. The
existing worksheet tutor supplies answers and explanations. OpenAI Live handles
the speech conversation. OpenAI Decisions returns typed decisions, not audio or prose.

Cursor context includes the hovered page and page-unit coordinates;
`write_answer` asks the grounded worksheet tutor to place the requested answer
at that captured spot. “Answer question A” with a worksheet cursor uses this
route; “explain question A” remains spoken. Triangles are supported additions.

**Voice AI** and **Record lesson** are separate controls. A lesson recording
captures the teacher's microphone, optional camera, and worksheet changes.
Assistant audio plays through the Voice AI player and is not mixed into that
recording. Recordings work without these server functions.

## Fast formatting commands (v1.109.0)

Select an editable object, then address Jev (the existing voice alias) with an explicit command. These
commands run locally after the Live delegation, without another routing or
planning API call and without a new backend deployment:

- “Make this bold and blue and font size 24.”
- “Set font size to 20.” / “Make this font Times New Roman.”
- “Make this italic and underlined and centre aligned.”
- “Make this normal.” (clears bold, italic and underline)
- “Make all text on this page font size 20 and black.”
- “Make this dashed and line width 3.” / “Make this arrowheads both.”
- “Make this width 180 and height 80 and rotation 90.”
- “Duplicate this 3 times.” (1–12 copies, offset on the same page)
- “Bring this to the front.” / “Send this to the back.”
- ‘Change the text in this to "New answer".’ (literal replacement)
- “Next page.” / “Move this right by 20 units.” / “Resize this to 150 percent.”

Supported fonts are Arial, Times New Roman, Courier New and the existing
handwriting style. Text size is 8–144; stroke width is 0.5–24. Rotation applies
to text, rectangles and ellipses. Bulk text formatting is limited to the current
page; every target must be unlocked and present in the bounded inventory. Cards
and videos cannot be duplicated. An invalid operation rolls back the whole edit.
Styles persist in normal saves, undo/redo and lesson timelines; SVG, canvas and
PDF output preserve font emphasis, alignment, underline and line dashes.
Standard PDF fonts approximate the screen fonts; handwriting retains the existing
standard-font fallback in PDF/canvas output.

For other commands, addressed transcript drafts prefetch the Decisions result after a
200 ms pause. No draft performs an edit or generates an answer. Only an exact
command/context match is reused at delegation; newer speech cancels earlier
work. At most two prefetches run per delegated turn. These can consume existing
decision allowances even when cancelled. The existing grounded tutor still handles
academic explanations and answers. No live microphone latency claim is made by
mocked tests.

## Functions and secrets

All three functions use the existing `mathgen--app` Firebase project:

| Function | Purpose | Secret |
| --- | --- | --- |
| `ansKeyLive` | Start, renew and stop an authenticated Live conversation | `OPENAI_API_KEY` |
| `ansKeyLiveCleanup` | Close expired or abandoned conversations | `OPENAI_API_KEY` |
| `ansKeyJevCommand` | Classify a spoken request and resolve one worksheet target | `OPENAI_API_KEY` |

The shared OpenAI key is configured in the project's Secret Manager. Keep it out of the
page, browser storage, committed environment files and GitHub Pages settings.
To replace the OpenAI secret, use Firebase's prompt for the value:

```sh
firebase functions:secrets:set OPENAI_API_KEY --project mathgen--app
```

Deploy the bound function after changing a secret so it uses the new version.

## Deploy and test

Merges that change the backend trigger the scoped deployment workflow. It requires the existing `FIREBASE_SERVICE_ACCOUNT` repository secret for `mathgen--app`; missing credentials fail visibly. No shared database rules are deployed.

Use Node 22 and an authorized Firebase account with access to `mathgen--app`:

```sh
npm --prefix functions ci
npm --prefix functions test
firebase deploy --project mathgen--app --only functions:ans-key-live
```

Deploy the complete `ans-key-live` codebase, including `ansKeyJevCommand` and
both Live functions. This separate codebase keeps the deployment from replacing
Study Buddy's functions. Billing, Cloud Functions, Secret Manager and Cloud
Scheduler must be available. Firebase binds the required secrets during
deployment. This repository does not change the shared project's Firestore or
Storage rules. The browser changes also need to be published through the
repository's existing GitHub Pages deployment.

The backend suite covers identity, App Check, worksheet ownership, quotas,
malformed model responses, unavailable providers, secret sanitization, timeouts,
and Live cleanup. Browser regression checks include:

```sh
node tools/check-syntax.mjs
node tools/recording-live-tests.mjs
node tools/voice-context-tests.mjs
node --test tools/voice-cursor-tests.mjs tools/voice-answer-placement-tests.mjs tools/voice-actions-tests.mjs tools/jev-ui-tests.mjs
node tools/recording-ui-tests.mjs
node tools/recording-audio-tests.mjs
```

Automated tests mock paid calls and exercise the OpenAI Decisions request and response schema. Live Decisions access, microphone capture and signed-in production behavior require a deployed smoke check.

## Access and request handling

- Requests require a non-revoked Google Firebase ID token, the verified teacher
  email, and App Check for the registered Ans Key web app. The saved worksheet
  must belong to the same Firebase user in `pdfAnnotator`.
- The server fixes the Live model, instructions and allowed events, and requests
  `store: false`. It does not accept browser-supplied provider settings.
- Voice AI stays quiet until addressed. Requests are delegated to the app, where
  OpenAI Decisions routes them to editing or the grounded worksheet tutor. Decisions receives only
  the transcript and a bounded object inventory, not audio or the page image.
- Decisions requests permit a transcript of at most 4,000 characters and at most 100
  objects. Low-confidence or unresolved target decisions require clarification.
  The browser validates the plan against the current worksheet before editing.
- `ansKeyJevCommand` allows 90 requests per minute and 1,800 per Singapore day
  for the authenticated teacher. Failed provider calls can count toward these
  allowances. `ansKeyJevLimits` stores counters only.
- Audio, transcripts and worksheet contents are not persisted in server
  bookkeeping. `ansKeyLiveSessions` and `ansKeyLiveLimits` hold ownership,
  session IDs, lease times and counts. Keep all three bookkeeping collections
  denied to browser reads and writes.

## Session lifetime

Voice AI has no fixed session duration. It stops after five minutes without
meaningful speech from either participant. The browser renews a 180-second
server lease every 45 seconds while connected. A separate scheduler checks
expired leases every minute and retries closure if the provider does not
confirm it. Scheduler timing and retries can delay final cleanup.

Each account can have one active conversation and six starts per Singapore
calendar day. Server-wide limits are 20 active conversations and 100 starts per
day. Failed starts may count toward the allowance. Stopping Voice AI releases
its microphone and connection without stopping a separate lesson recording.

## Production check

Open an owned saved worksheet as the teacher and start **Voice AI**. Try adding
a shape, moving the selected shape, undoing that edit, and asking a worksheet
question. Confirm edits affect the intended object and answers use the current
worksheet. Stop Voice AI and confirm its microphone indicator clears. Also test
canceling while connecting and changing the page while a command is pending.

Run **Record lesson** separately, optionally alongside Voice AI, then stop and
replay the recording. Confirm the teacher's microphone, camera and worksheet
changes stay synchronized, and the assistant audio is not added to the recorded
audio mix. Stopping either feature must leave the other operating independently.

## Provider references

- [OpenAI Decisions](https://developers.openai.com/api/docs/guides/decisions): fixed-choice routing, named answers and probability arrays.
- [OpenAI Live WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live)
  and [server controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live).
