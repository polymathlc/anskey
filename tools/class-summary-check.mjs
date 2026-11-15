// 🧾 The class summary window in real Chromium (v1.202.0): a summary already
// being written is FOLLOWED (its progress, then its result), the window can be
// closed and opened again mid-run and still follows it, a run that stopped
// says why, and the Write button is never a silent no-op.
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const js = readFileSync(new URL('../class-summary.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../class-summary.css', import.meta.url), 'utf8');

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) { console.log('class-summary-check: no Playwright at ' + PW + ' — skipped.'); process.exit(0); }
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><main id="ws">worksheet</main></body></html>`);
await page.addScriptTag({ content: js });
await page.evaluate(() => {
  const P = window.ClassSummary.pure;
  const day = P.dayKey(Date.now());
  const summary = (title) => P.cleanSummary({ title, overview: 'We revised heat.', points: ['Heat flows from hot to cold.'], homework: [], links: [], questions: [] }, { day, now: Date.now() });
  const T = window.__t = { day, summaries: {}, job: null, fail: null, toasts: [], generated: 0 };
  // A fake glue: a job that the test drives by hand.
  T.startJob = () => {
    const job = { step: 'Captions: ChatGPT is writing the captions… 2 of 6', listeners: [] };
    job.promise = new Promise((res, rej) => { job.finish = (t) => { T.summaries[day] = summary(t); T.job = null; res(T.summaries[day]); }; job.fail = (m) => { T.job = null; rej(new Error(m)); }; });
    job.say = (m) => { job.step = m; job.listeners.forEach(f => f(m)); };
    T.job = job;
    return job;
  };
  T.w = window.ClassSummary.create({
    teacher: () => true,
    toast: (m) => T.toasts.push(m),
    worksheet: () => ({ docId: 'doc1', name: 'P5 Science November WS 2 - Revision', level: 'P5', subject: 'science', subjectWord: 'Science' }),
    days: () => [{ day, lessons: 1, summary: T.summaries[day] || null }],
    generate: (d, say) => {
      T.generated++;
      if (T.job) { T.job.listeners.push(say); say(T.job.step); return T.job.promise; }
      const job = T.startJob(); job.listeners.push(say); say('Starting…'); return job.promise;
    },
    running: (d) => T.job && d === day ? { day, step: T.job.step } : null,
    follow: (d, say) => { if (!T.job) return Promise.resolve(T.summaries[d] || null); T.job.listeners.push(say); say(T.job.step); return T.job.promise; },
    failure: () => T.fail,
    save: async () => true, students: async () => [], saveParents: async () => [], sendGmail: async () => ({}), authorizeGmail: async () => ({}),
    gmailReady: () => false, recordSend: async () => {}, settings: () => ({ auto: true, captions: true, model: P.DEFAULT_MODEL, hasKey: false }),
    setSettings: () => {}, setClaudeKey: async () => true, copy: async () => true, openUrl: () => {}
  });
});
const status = () => page.locator('#classSummary [data-cs="status"]').textContent().catch(() => '');
const write = page.locator('#classSummary [data-cs="write"]');

// 1. A run after class is already going on when the window opens: it is followed.
await page.evaluate(() => { window.__t.startJob(); window.__t.w.open(window.__t.day); });
assert.match(await status(), /2 of 6/, 'the run’s progress is shown');
assert.equal(await write.isDisabled(), true, 'Write shows it is busy, not a silent button');
assert.match(await write.textContent(), /Writing/);
await page.evaluate(() => window.__t.job.say('Chung GPT is writing the summary…'));
assert.match(await status(), /Chung GPT is writing/, 'progress keeps coming');

// 2. A tab and back keeps the progress in view.
await page.locator('#classSummary .csTab', { hasText: 'Settings' }).click();
await page.locator('#classSummary .csTab', { hasText: 'Summary' }).click();
assert.match(await status(), /Chung GPT is writing/);

// 3. Closed and opened again mid-run: still followed (this used to leave Write dead).
await page.keyboard.press('Escape');
await page.evaluate(() => window.__t.w.open(window.__t.day));
assert.match(await status(), /Chung GPT is writing/);
assert.equal(await write.isDisabled(), true);

// 4. It finishes: the summary is painted at once.
await page.evaluate(() => window.__t.job.finish('Heat and its effects'));
await page.waitForFunction(() => /Heat and its effects/.test(document.querySelector('#classSummary .csBody').innerText) ||
  [...document.querySelectorAll('#classSummary input, #classSummary textarea')].some(i => i.value === 'Heat and its effects'));
assert.equal(await page.locator('#classSummary [data-cs="status"]').count(), 0, 'no stale status left behind');

// 5. A run that stopped by itself says why, and Write is live again.
await page.evaluate(() => { const T = window.__t; delete T.summaries[T.day]; T.fail = { message: 'The AI took longer than 11 minutes to write the summary.', at: Date.now(), trigger: 'auto' }; T.w.close(); T.w.open(T.day); });
assert.match(await page.locator('#classSummary [data-cs="failure"]').textContent(), /automatic summary after class stopped: The AI took longer/);
assert.equal(await write.isDisabled(), false);

// 6. Pressing Write: progress, then the result; a failure is shown in words and Write comes back.
await page.evaluate(() => { window.__t.fail = null; });
await write.click();
assert.equal(await page.locator('#classSummary [data-cs="failure"]').count(), 0, 'the old reason is cleared by a new try');
assert.match(await status(), /Starting/);
await page.evaluate(() => window.__t.job.fail('Claude API error 529'));
await page.waitForFunction(() => /could not be written: Claude API error 529/.test((document.querySelector('#classSummary [data-cs="status"]') || {}).textContent || ''));
assert.equal(await write.isDisabled(), false, 'Write is pressable again after a failure');
await write.click();
await page.evaluate(() => window.__t.job.finish('Second try'));
await page.waitForFunction(() => [...document.querySelectorAll('#classSummary input, #classSummary textarea')].some(i => i.value === 'Second try') ||
  /Second try/.test(document.querySelector('#classSummary .csBody').innerText));

// 7. Phone width: the status and the button stay inside the card.
await page.setViewportSize({ width: 390, height: 740 });
await page.evaluate(() => { const T = window.__t; delete T.summaries[T.day]; T.w.close(); T.startJob(); T.w.open(T.day); });
const box = await page.locator('#classSummary [data-cs="status"]').boundingBox();
assert.ok(box && box.x >= 0 && box.x + box.width <= 390, 'status fits on a phone');
const shot = process.env.CSUM_SHOT || '';
if (shot) { mkdirSync(path.dirname(shot), { recursive: true }); await page.screenshot({ path: shot }); }

assert.deepEqual(errors, [], 'no page errors');
await browser.close();
console.log('class-summary-check: all good');
