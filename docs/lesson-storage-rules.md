# Protect recorded lesson uploads

Recorded lessons use `pdf-annotator/lesson-{worksheetId}-{recordingId}.m4a`
(or `.webm`) and a `.json` replay file in the existing
`mathgen--app.firebasestorage.app` bucket. Only the signed-in, verified Google
teacher account can create, replace or delete these objects. Students and
share-link visitors retain public playback access.

The shared bucket previously allowed every client to write every object. The
lesson rule narrows that existing permission for the new `lesson-` prefix only.
It also protects descendants beneath that prefix. Permissions for existing PDF,
annotation, camera/screen recording and other object paths remain unchanged.

## Inspect, test and maintain the deployed rule

Use an already signed-in Firebase CLI account authorized for `mathgen--app`.
The helper uses that CLI's authenticated client; it does not sign in, inspect
secret values, or print credentials. Replace `<firebase-tools-directory>` with
the installed `firebase-tools` package directory containing `lib/`.

```sh
node tools/lesson-storage-rules.mjs --firebase-tools <firebase-tools-directory> --read
node tools/lesson-storage-rules.mjs --firebase-tools <firebase-tools-directory>
```

`--read` fetches the live release and source and reports whether protection is
needed. The default mode tests the current and proposed rules without publishing.
It verifies 210 unchanged-path cases and 330 proposed-policy cases, including
public playback, teacher upload/delete, unverified accounts, and password/custom
sign-in denial even when the email matches the teacher.

When an authorized rules change is needed:

```sh
node tools/lesson-storage-rules.mjs --firebase-tools <firebase-tools-directory> --apply
```

Apply mode builds a small addition from the **current deployed source**, tests it,
checks that the live ruleset and release timestamp still match, publishes, and
verifies the resulting release. It refuses unfamiliar or additional permissions
that could bypass the restriction. A changed source requires review. Running it
against the matching protected source tests the policy and makes no new release.

Do not deploy a full rules snapshot from another app or add Storage configuration
to this repository's Firebase deployment file. This is a shared production bucket;
the helper deliberately preserves unrelated existing rules.

## Local verification

```sh
node --test tools/lesson-storage-rules-tests.mjs
```

These checks cover precise patch scope, Google teacher requirements, permission
test failures, repeat runs, concurrent release changes, and publication
verification. The Firebase Rules API tests validate actual rule decisions without
uploading or deleting any recording. Audio playback and spoken AI responses need
their separate app checks; permission tests do not establish audio quality.
