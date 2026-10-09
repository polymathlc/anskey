'use strict';

const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getAppCheck } = require('firebase-admin/app-check');
const { getFirestore } = require('firebase-admin/firestore');
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

initializeApp();
const heroService = createHeroService({
  auth: getAuth(), appCheck: getAppCheck(), repository: createHeroRepository(getFirestore()),
  report: code => logger.warn(code)
});
// One warm instance: a points award during a lesson must not wait several
// seconds for a cold start (loading firebase-admin and the battle content on a
// fractional CPU) after the wheel has been idle for a while.
exports.ansKeyHeroes = onRequest({
  region: 'us-central1', timeoutSeconds: 60, minInstances: 1, maxInstances: 5,
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
