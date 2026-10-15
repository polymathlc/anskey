/* =====================================================================
   💬 LESSON CAPTIONS — in a real browser, with a real recording
   ---------------------------------------------------------------------
   A short lesson is recorded with Chromium's fake microphone, then
   captioned: OpenAI's transcription endpoint is answered here (no key, no
   network), and everything around it is the shipped code — the lesson's
   real file decoded and cut into WAV pieces (or sent whole), the captions
   file written beside the lesson, the CC button in the replay, the caption
   over the page, and the Captions row of the ⬇ 1080p export drawing them
   into the frame.

     node tools/caption-check.mjs
     PW=/path/to/playwright/index.mjs node tools/caption-check.mjs
     SHOTS=/some/dir node tools/caption-check.mjs
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) { console.log('caption-check: no Playwright at ' + PW + ' — skipped.'); process.exit(0); }

const FILE = pathToFileURL(path.resolve(process.argv[2] || 'index.html')).href;
const SHOTS = process.env.SHOTS || process.env.QB_SCREENSHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (note ? '\n      ' + note : '')); }
};
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'captions-' + name + '.png') }); };

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 820 }, permissions: ['microphone'] });
const page = await ctx.newPage();
await page.route(/firebase-[a-z]+-compat\.js(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/javascript', body: '' }));
// OpenAI's speech-to-text, answered here. Each call is recorded: which model,
// which file, how big.
const calls = [];
await page.route('https://api.openai.com/v1/audio/transcriptions', async route => {
  const req = route.request();
  const body = req.postDataBuffer() || Buffer.alloc(0);
  const text = body.toString('latin1');
  const name = (/filename="([^"]+)"/.exec(text) || [])[1] || '';
  const model = (/name="model"\r\n\r\n([^\r]+)/.exec(text) || [])[1] || '';
  const format = (/name="response_format"\r\n\r\n([^\r]+)/.exec(text) || [])[1] || '';
  const language = (/name="language"\r\n\r\n([^\r]+)/.exec(text) || [])[1] || '';
  const prompt = (/name="prompt"\r\n\r\n([^\r]+)/.exec(text) || [])[1] || '';
  calls.push({ auth: req.headers().authorization, name, model, format, language, prompt, size: body.length, riff: text.includes('RIFF') && text.includes('WAVE') });
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({
    text: 'x', segments: [
      { start: 0.0, end: 1.4, text: ' First we find the total mass of the beaker and the water inside it.' },
      { start: 1.4, end: 3.0, text: ' Then the heat gained is mass times change in temperature.' }] }) });
});
await page.addInitScript(() => {
  const chain = () => new Proxy(function () { return chain(); }, {
    get: (t, k) => (k === 'then' ? undefined : chain()),
    apply: () => chain(), construct: () => chain(), set: () => true
  });
  window.pdfjsLib = chain(); window.firebase = chain(); window.grecaptcha = chain();
});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(FILE);
await page.waitForTimeout(1000);
ok('the page loads with no uncaught error', errors.length === 0, errors.join('\n      '));

await page.evaluate(() => {
  const W = 600, H = 780, wrap = document.createElement('div');
  wrap.className = 'pageWrap';
  wrap.style.cssText = 'position:relative;flex:none;width:' + W + 'px;height:' + H + 'px;min-width:' + W + 'px;min-height:' + H + 'px;background:#fff';
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' });
  svg.classList.add('overlay'); svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  wrap.appendChild(canvas); wrap.appendChild(svg);
  $('viewerArea').appendChild(wrap);
  const fakePage = { getViewport: o => ({ width: W * o.scale, height: H * o.scale }),
    render: o => { const c = o.canvasContext; c.fillStyle = '#fff'; c.fillRect(0, 0, 9999, 9999); return { promise: Promise.resolve(), cancel() {} }; },
    getTextContent: async () => ({ items: [] }) };
  const p = { num: 1, baseW: W, baseH: H, wrap, canvas, svg, page: fakePage };
  pages = [p]; pdfDoc = {}; scale = 1; annotations = [];
  attachOverlayHandlers(p);
  currentUser = { uid: 'teacher', email: ADMIN_EMAIL, getIdToken: async () => 'token' };
  currentDocId = 'doc1'; docName = 'Heat worksheet'; pdfBytes = new Uint8Array([37, 80, 68, 70]);
  ['saveBtn', 'blankPageBtn', 'deletePageBtn'].forEach(id => { $(id).disabled = false; });
  window.__uploaded = {};
  storage = { ref: p2 => ({ fullPath: p2,
    put: blob => { window.__uploaded[p2] = blob; return Promise.resolve(); },
    getDownloadURL: async () => URL.createObjectURL(window.__uploaded[p2]) }) };
  writeAnnotations = async () => {};
  scheduleAutoSave = () => {};
  lessonAssetUrl = u => u;
  lessonReadManifest = async url => JSON.parse(await (await fetch(url)).text());
  setTool('select');
  try { localStorage.clear(); } catch (e) {}
  localStorage.setItem(AI_ENGINE_STORE.key, 'sk-test-key');
});

console.log('\n⏺ A short lesson to caption');
await page.evaluate(() => lessonOpenModal());
await page.waitForFunction(() => lessonDev.micState === 'live', null, { timeout: 8000 }).catch(() => {});
await page.click('#lessonStartBtn');
await page.waitForFunction(() => lessonCapture && lessonCapture.phase === 'recording', null, { timeout: 10000 }).catch(() => {});
await page.evaluate(() => { annotations.push({ id: 'ink1', page: 1, type: 'pen', color: '#1565C0', width: 3, points: [{ x: 80, y: 90 }, { x: 260, y: 150 }] }); renderAllOverlays(); setDirty(true); });
await page.waitForTimeout(3200);
await page.evaluate(() => lessonStop());
const saved = await page.waitForFunction(() => !lessonCapture && !lessonPending && annotations.some(a => a.lessonRecording), null, { timeout: 15000 }).then(() => true).catch(() => false);
ok('a lesson is recorded and saved', saved);

console.log('\n▶ The replay offers ✨ Captions to the teacher');
await page.evaluate(() => lessonPlay(annotations.find(x => x.lessonRecording)));
await page.waitForFunction(() => lessonPlayback && lessonPlayback.captionsTried, null, { timeout: 8000 }).catch(() => {});
const offer = await page.evaluate(() => ({ shown: !$('lessonCaptionBtn').hidden, text: $('lessonCaptionBtn').textContent, box: $('lessonCaption').hidden }));
ok('the button offers to write captions, and no caption shows yet', offer.shown && /Captions/.test(offer.text) && offer.box, JSON.stringify(offer));

// A long lesson's path: the file decoded here and sent as WAV pieces.
await page.evaluate(() => { window.__directMax = LESSON_CAPTION_DIRECT_MAX; LESSON_CAPTION_DIRECT_MAX = 1000; });
await page.click('#lessonCaptionBtn');
const made = await page.waitForFunction(() => lessonPlayback && lessonPlayback.captions && lessonPlayback.captions.length, null, { timeout: 20000 }).then(() => true).catch(() => false);
const after = await page.evaluate(() => {
  const a = annotations.find(x => x.lessonRecording), r = a.lessonRecording;
  const file = Object.keys(window.__uploaded).find(k => k.endsWith('.captions.json'));
  return { made: !!(lessonPlayback && lessonPlayback.captions), cues: lessonPlayback && lessonPlayback.captions, url: r.captionsUrl, path: r.captionsPath, file,
    lang: r.captionsLang,
    dirty, btn: $('lessonCaptionBtn').textContent, on: $('lessonCaptionBtn').classList.contains('on') };
});
ok('ChatGPT was asked, on the teacher\'s key, with the transcription model and timed segments',
   calls.length >= 1 && calls[0].auth === 'Bearer sk-test-key' && calls[0].model === 'whisper-1' && calls[0].format === 'verbose_json', JSON.stringify(calls));
ok('…in English, always, with an English prompt (never left to guess Malay)',
   calls.length >= 1 && calls.every(c => c.language === 'en' && /English/.test(c.prompt)), JSON.stringify(calls.map(c => [c.language, c.prompt])));
ok('…and the lesson is stamped English', after.lang === 'en', JSON.stringify({ lang: after.lang }));
const oldCc = await page.evaluate(async () => ({
  none: await lessonCaptionLoad({ lessonRecording: { captionsUrl: 'https://firebasestorage.googleapis.com/x.json' } }),
  ms: await lessonCaptionLoad({ lessonRecording: { captionsUrl: 'https://firebasestorage.googleapis.com/x.json', captionsLang: 'ms' } }) }));
ok('older captions with no English stamp read as none, so they are remade', oldCc.none === null && oldCc.ms === null, JSON.stringify(oldCc));
ok('…a long file is sent as a WAV the browser decoded', calls[0] && calls[0].riff && /\.wav$/.test(calls[0].name), JSON.stringify(calls[0]));
ok('the captions are made and switched on', made && after.on && /^CC on$/.test(after.btn), JSON.stringify(after));
ok('…split into short cues with times in milliseconds', after.cues && after.cues.length >= 2 && after.cues.every(c => c.t.length <= 84 && c.e > c.s) && after.cues[0].s === 0, JSON.stringify(after.cues));
ok('…saved as a file beside the lesson, and the lesson points at it', after.file === 'pdf-annotator/lesson-doc1-' + (await page.evaluate(() => annotations.find(x => x.lessonRecording).id)) + '.captions.json' && after.path === after.file && !!after.url && after.dirty, JSON.stringify(after));
await page.evaluate(() => { LESSON_CAPTION_DIRECT_MAX = window.__directMax; const m = lessonMedia(); m.currentTime = 0.4; m.play().catch(() => {}); });
await page.waitForFunction(() => !$('lessonCaption').hidden, null, { timeout: 5000 }).catch(() => {});
const showing = await page.evaluate(() => ({ hidden: $('lessonCaption').hidden, text: $('lessonCaption').textContent,
  r: $('lessonCaption').getBoundingClientRect().toJSON(), player: $('lessonPlayer').getBoundingClientRect().toJSON() }));
ok('the caption shows over the page while the lesson plays', !showing.hidden && /First we find the total mass/.test(showing.text), JSON.stringify(showing));
ok('…above the player, not under it', showing.r.bottom <= showing.player.top + 1 && showing.r.width > 100, JSON.stringify(showing));
await shot(page, '1-replay');
await page.click('#lessonCaptionBtn');
const off = await page.evaluate(() => ({ hidden: $('lessonCaption').hidden, btn: $('lessonCaptionBtn').textContent, pref: localStorage.getItem('polymath.lessonCaptions') }));
ok('CC switches them off, and the device remembers', off.hidden && off.btn === 'CC off' && off.pref === 'false', JSON.stringify(off));
await page.click('#lessonCaptionBtn');
ok('…and back on', await page.evaluate(() => $('lessonCaptionBtn').textContent === 'CC on'));

console.log('\n👀 A student reads them and never calls ChatGPT');
const before = calls.length;
await page.evaluate(() => { lessonExitPlayback(); actingStudent = true; lessonPlay(annotations.find(x => x.lessonRecording)); });
await page.waitForTimeout(100);
// lessonPlay refuses nothing for a student; captions load from the file.
await page.waitForFunction(() => lessonPlayback && lessonPlayback.captionsTried, null, { timeout: 8000 }).catch(() => {});
const student = await page.evaluate(() => ({ btn: !$('lessonCaptionBtn').hidden, text: $('lessonCaptionBtn').textContent, cues: lessonPlayback && lessonPlayback.captions && lessonPlayback.captions.length }));
ok('a student gets the CC switch for a captioned lesson', student.btn && /^CC/.test(student.text) && student.cues >= 2, JSON.stringify(student));
let refused = '';
try { await page.evaluate(() => lessonCaptionGenerate(annotations.find(x => x.lessonRecording))); } catch (e) { refused = e.message; }
ok('…and cannot make captions', /Only the teacher/.test(refused) && calls.length === before, refused);
await page.evaluate(() => { lessonExitPlayback(); actingStudent = false; });

console.log('\n⬇ The export draws them into the video, or leaves them out');
await page.evaluate(() => lessonExportOpen(annotations.find(x => x.lessonRecording)));
await page.waitForFunction(() => lessonExportJob && (lessonExportJob.phase === 'ready' || lessonExportJob.phase === 'failed'), null, { timeout: 20000 }).catch(() => {});
const exp = await page.evaluate(() => {
  const job = lessonExportJob;
  // Inside the first cue; the two renders are compared pixel by pixel.
  const grab = () => job.ctx.getImageData(0, 0, 1920, 1080).data;
  job.cc = true; lessonExportDraw(job, 500, 0); const a = grab();
  job.cc = false; lessonExportDraw(job, 500, 0); const b = grab();
  let diff = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) diff++;
  const withCc = diff, without = 0;
  job.cc = true; lessonExportUi(job);
  return { phase: job.phase, cues: job.captions && job.captions.length, withCc, without,
    seg: !$('lessonExportCaptionSeg').hidden, make: $('lessonExportCaptionMake').hidden,
    on: document.querySelector('[data-lx-cc="on"]').classList.contains('on') };
});
ok('the export window loads the captions and shows On / Off, on', exp.phase === 'ready' && exp.cues >= 2 && exp.seg && exp.make && exp.on, JSON.stringify(exp));
await page.evaluate(() => lessonExportDraw(lessonExportJob, 2000, 0));
await shot(page, '2-export');
ok('…with captions on, a caption box is drawn into the frame; off, it is not', exp.withCc > exp.without + 50, JSON.stringify(exp));
await page.click('[data-lx-cc="off"]');
ok('Off is remembered for the replay too', await page.evaluate(() => !lessonExportJob.cc && localStorage.getItem('polymath.lessonCaptions') === 'false'));
await page.evaluate(() => lessonExportClose(true));

console.log('\n✨ A lesson with no captions can get them from the export window (the file sent whole)');
await page.evaluate(() => { const a = annotations.find(x => x.lessonRecording); delete a.lessonRecording.captionsUrl; delete a.lessonRecording.captionsPath; lessonExportOpen(a); });
await page.waitForFunction(() => lessonExportJob && lessonExportJob.phase === 'ready', null, { timeout: 20000 }).catch(() => {});
const none = await page.evaluate(() => ({ seg: $('lessonExportCaptionSeg').hidden, make: !$('lessonExportCaptionMake').hidden }));
ok('with none, the row offers to write them', none.seg && none.make, JSON.stringify(none));
const n0 = calls.length;
await page.click('#lessonExportCaptionMake');
const got = await page.waitForFunction(() => lessonExportJob.captions && lessonExportJob.captions.length, null, { timeout: 20000 }).then(() => true).catch(() => false);
const last = calls[calls.length - 1] || {};
ok('…ChatGPT writes them, and they are on', got && calls.length === n0 + 1 && await page.evaluate(() => lessonExportJob.cc && !$('lessonExportCaptionSeg').hidden), JSON.stringify(last));
ok('…a small file goes up as it is, not re-encoded', /^lesson\.(webm|m4a|mp4|ogg)$/.test(last.name) && !last.riff, JSON.stringify(last));
await page.evaluate(() => lessonExportClose(true));

console.log('\n🔑 Without a key it says what to do');
await page.evaluate(() => { localStorage.removeItem(AI_ENGINE_STORE.key); });
let nokey = '';
try { await page.evaluate(() => lessonCaptionGenerate(annotations.find(x => x.lessonRecording))); } catch (e) { nokey = e.message; }
ok('no key: it asks for the ChatGPT key in AI Engine', /AI Engine/.test(nokey), nokey);

ok('no uncaught error anywhere along the way', errors.length === 0, errors.join('\n      '));
await browser.close();
console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ all ') + pass + ' passed');
process.exit(fail ? 1 : 0);
