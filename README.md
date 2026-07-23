# Anskey — PDF worksheet annotator

Single-file web app (`index.html`) for annotating PDF worksheets, backed by
Firebase (Auth + Firestore + Storage, project `mathgen--app`).

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
