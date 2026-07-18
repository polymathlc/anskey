# Anskey — PDF worksheet annotator

Single-file web app (`index.html`) for annotating PDF worksheets, backed by
Firebase (Auth + Firestore + Storage, project `mathgen--app`).

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
