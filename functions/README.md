# Jev voice commands and live assistance

This directory provides the server functions for Ans Key's **Voice AI** button.
The teacher can speak to move, resize, add or delete worksheet objects, undo or
redo edits, change pages, and ask questions. Jev routes the spoken request and
selects an existing target; the app validates and applies supported edits. The
existing worksheet tutor supplies answers and explanations. OpenAI Live handles
the speech conversation. Jev itself returns typed decisions, not audio or prose.

**Voice AI** and **Record lesson** are separate controls. A lesson recording
captures the teacher's microphone, optional camera, and worksheet changes.
Assistant audio plays through the Voice AI player and is not mixed into that
recording. Recordings work without these server functions.

## Functions and secrets

All three functions use the existing `mathgen--app` Firebase project:

| Function | Purpose | Secret |
| --- | --- | --- |
| `ansKeyLive` | Start, renew and stop an authenticated Live conversation | `OPENAI_API_KEY` |
| `ansKeyLiveCleanup` | Close expired or abandoned conversations | `OPENAI_API_KEY` |
| `ansKeyJevCommand` | Classify a spoken request and resolve one worksheet target | `JEV_API_KEY` |

Both keys are configured in the project's Secret Manager. Keep them out of the
page, browser storage, committed environment files and GitHub Pages settings.
To replace the Jev secret, use Firebase's prompt for the value:

```sh
firebase functions:secrets:set JEV_API_KEY --project mathgen--app
```

Deploy the bound function after changing a secret so it uses the new version.

## Deploy and test

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
node tools/recording-ui-tests.mjs
node tools/recording-audio-tests.mjs
```

Automated tests mock paid calls. A separate real Jev provider check has verified
synthetic move, add and question requests. That check does not verify microphone
capture or a signed-in production conversation.

## Access and request handling

- Requests require a non-revoked Google Firebase ID token, the verified teacher
  email, and App Check for the registered Ans Key web app. The saved worksheet
  must belong to the same Firebase user in `pdfAnnotator`.
- The server fixes the Live model, instructions and allowed events, and requests
  `store: false`. It does not accept browser-supplied provider settings.
- Voice AI stays quiet until addressed. Requests are delegated to the app, where
  Jev routes them to editing or the grounded worksheet tutor. Jev receives only
  the transcript and a bounded object inventory, not audio or the page image.
- Jev requests permit a transcript of at most 4,000 characters and at most 100
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

- [TypeSafe API reference](https://docs.typesafe.ai/api): official endpoint,
  Bearer authentication, and typed Choice responses.
- [TypeSafe capabilities](https://docs.typesafe.ai/introduction): decisions and
  confidence, without text generation.
- [Choice confidence](https://docs.typesafe.ai/confidence) and
  [structured criteria](https://docs.typesafe.ai/primitives/advanced).
- [OpenAI Live WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live)
  and [server controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live).
