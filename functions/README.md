# Live assistance for worksheet recordings

This directory contains the server bridge for optional AI voice assistance in
Ans Key. It uses the same `mathgen--app` Firebase project and existing
`OPENAI_API_KEY` secret as Study Buddy. Browser recordings do not depend on this
deployment: the app can still record the teacher's voice and worksheet work.

## Deploy

Use Node 22 and an authorized Firebase account with access to `mathgen--app`.
Do not put the API key in the page, an environment file committed to Git, or a
GitHub Pages setting. The project secret has already been configured.

```sh
npm --prefix functions ci
npm --prefix functions test
firebase deploy --project mathgen--app --only functions:ans-key-live
```

Deploy both `ansKeyLive` and `ansKeyLiveCleanup`; the separate `ans-key-live`
codebase keeps this deployment from replacing Study Buddy's functions. Billing,
Cloud Functions, Secret Manager and Cloud Scheduler must be available on the
Firebase project. Firebase grants access to the bound secret during deployment.
This repository does not change the shared project's Firestore or Storage rules.

## Boundaries and checks

- A request needs a non-revoked Google Firebase ID token, the verified teacher
  email, and App Check for the registered web app. The saved worksheet must be
  owned by that same Firebase user in `pdfAnnotator`.
- The server fixes the voice model, prompt and allowed events. It does not accept
  browser-supplied model settings or instructions. It requests `store: false`.
- Academic questions are delegated back to the app's existing grounded worksheet
  AI. The voice assistant stays quiet until addressed. It does not have a separate
  ungrounded route for solving questions.
- Audio and transcripts are not saved in server bookkeeping. The app records the
  processed microphone and assistant audio locally into the same recording clock.
  Background-noise suppression uses browser audio processing; it varies by device
  and cannot guarantee complete silence. There is no invented Live noise setting
  or provider cloud-recording feature.
- `ansKeyLiveSessions` and `ansKeyLiveLimits` are server-only collections. Leave
  client reads and writes denied. They store session IDs, lease times, ownership
  and counts so abandoned calls can be closed.
- Each account can have one active session, up to 10 minutes, and six starts per
  Singapore calendar day. There are additional server-wide ceilings of 20 active
  sessions and 100 starts per day. Failed starts may count toward the allowance.
- A scheduler closes abandoned sessions every minute, with normal scheduler and
  retry delay. Closing is retried if the provider does not confirm the end.

After deployment, start a short recording on an owned saved worksheet, enable
live assistance, ask a worksheet question, stop, and replay. Confirm both voices,
ink/text changes and the recorded view stay synchronized. Test canceling while
connecting and verify the microphone indicator ends when recording stops. The
automated suites mock paid calls; they do not claim a live production call passed.
