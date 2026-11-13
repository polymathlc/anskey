'use strict';

const { initializeApp, getApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getAppCheck } = require('firebase-admin/app-check');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const WebSocket = require('ws');
const { createLiveService } = require('./live-service');
const { createRepository } = require('./live-repository');
const { createProvider } = require('./live-provider');
const { createJevProvider } = require('./jev-provider');
const { createJevService, createJevRepository } = require('./jev-service');
const { createHeroService } = require('./hero-service');
const { createHeroRepository } = require('./hero-repository');
const { createLessonComposeService } = require('./lesson-compose');
const { createAccountEmailService, createFirebaseMailer } = require('./account-email');

initializeApp();
// A field left undefined in a saved hero, encounter or log entry must never
// cost the whole award: without this, one missing value refuses the commit
// and every points award in that lesson fails as "could not be saved".
getFirestore().settings({ ignoreUndefinedProperties: true });
const heroService = createHeroService({
  auth: getAuth(), appCheck: getAppCheck(), repository: createHeroRepository(getFirestore()),
  report: (code, error) => logger.warn(code, { message: String(error?.message || error || '').slice(0, 500) })
});
// Scale to zero between lessons. Keeping an idle instance would add a fixed
// minimum bill and block non-interactive deployment without a billing override.
exports.ansKeyHeroes = onRequest({
  region: 'us-central1', timeoutSeconds: 60, minInstances: 0, maxInstances: 5,
  concurrency: 20, memory: '256MiB', invoker: 'public'
}, heroService.handler);
const openaiKey = defineSecret('OPENAI_API_KEY');
const jevService = createJevService({
  auth: getAuth(), appCheck: getAppCheck(), repository: createJevRepository(getFirestore()),
  provider: createJevProvider({ apiKey: () => openaiKey.value() }),
  report: code => logger.warn(code)
});

exports.ansKeyJevCommand = onRequest({
  region: 'us-central1', secrets: [openaiKey], timeoutSeconds: 30,
  maxInstances: 3, concurrency: 20, memory: '256MiB', invoker: 'public'
}, jevService.handler);
const service = createLiveService({
  auth: getAuth(), appCheck: getAppCheck(), repository: createRepository(getFirestore()),
  provider: createProvider({ apiKey: () => openaiKey.value(), connect: (url, options) => new WebSocket(url, options) }),
  report: code => logger.warn(code)
});

exports.ansKeyLive = onRequest({
  region: 'us-central1', secrets: [openaiKey], timeoutSeconds: 60,
  maxInstances: 5, concurrency: 20, memory: '256MiB', invoker: 'public'
}, service.handler);

// Browser timers are for the UI only. This separate server sweep also ends
// abandoned calls, with up to a scheduler interval of normal timing slack.
// Both functions must be deployed together. A failed close is retried.
exports.ansKeyLiveCleanup = onSchedule({
  region: 'us-central1', secrets: [openaiKey], schedule: 'every 1 minutes',
  timeZone: 'Asia/Singapore', timeoutSeconds: 180, maxInstances: 1,
  memory: '256MiB', retryCount: 3, minBackoffSeconds: 10, maxBackoffSeconds: 60
}, service.sweep);

// ☁ A lesson uploaded while it was being recorded is joined here into one file
// with Cloud Storage's own compose, so the teacher's tab only has to send the
// last few seconds after Stop. The bytes never pass through this function.
const lessonCompose = createLessonComposeService({
  auth: getAuth(), appCheck: getAppCheck(), bucket: getStorage().bucket('mathgen--app.firebasestorage.app'),
  report: code => logger.warn(code)
});
exports.ansKeyLessonCompose = onRequest({
  region: 'us-central1', timeoutSeconds: 120, maxInstances: 3,
  concurrency: 10, memory: '256MiB', invoker: 'public'
}, lessonCompose.handler);

// ✉ A student's account email, changed by the teacher and verified by the
// student (v1.194.0). The verification email is sent by Firebase Auth's own
// mailer, reached with this function's service credential; see
// account-email.js. The new address takes over only once its link is opened.
async function projectAccessToken() {
  const credential = getApp().options.credential;
  if (credential && typeof credential.getAccessToken === 'function') {
    const token = await credential.getAccessToken();
    if (token && token.access_token) return token.access_token;
  }
  // The metadata server is what the credential itself asks on Cloud Run.
  const res = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
  if (!res.ok) throw new Error('No service credential for the mailer.');
  return (await res.json()).access_token;
}
const accountEmail = createAccountEmailService({
  auth: getAuth(), appCheck: getAppCheck(), db: getFirestore(),
  mailer: createFirebaseMailer({ accessToken: projectAccessToken, adminAuth: getAuth() }),
  report: (code, error) => logger.warn(code, { message: String(error?.message || error || '').slice(0, 300) })
});
exports.ansKeyAccountEmail = onRequest({
  region: 'us-central1', timeoutSeconds: 60, maxInstances: 3,
  concurrency: 20, memory: '256MiB', invoker: 'public'
}, accountEmail.handler);
