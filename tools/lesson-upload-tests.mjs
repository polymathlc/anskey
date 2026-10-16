/* ☁ A lesson that uploads WHILE it records, and ⏩ the loading bar (v1.143.0).

   The shipped sections are cut out of index.html and run against stubs: the
   upload section, the two finishers whose PLANS it relies on, and the loading
   bar. The streaming is driven with real recordings made by ffmpeg — a
   fragmented MP4 and a live WebM, both laid out the way MediaRecorder lays
   them out — cut into arbitrary chunks, uploaded piece by piece to a fake
   Storage, finished and joined. The one thing that must never happen is a
   join whose bytes differ from the file the whole-file route would have
   uploaded: it plays, and is wrong, and nobody would see it until a lesson
   froze half way through. So every join below is compared byte for byte. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function cut(begin, end, inclusive) {
  const a = page.indexOf(begin), b = page.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'The page ships ' + begin.slice(0, 60));
  return page.slice(a, inclusive ? b + end.length : b);
}
const audioFinalizer = cut('var LessonAudioFinalize = (function () {', 'return { finalize: finalize, plan: plan };\n})();', true);
const mp4Finalizer = cut('var LessonMp4Finalize = (function () {', 'return { finalize: finalize, plan: plan };\n})();', true);
const upload = cut('/* ================= ☁ Upload while recording (v1.143.0)', '/* ================= End upload while recording ================= */');
const loading = cut('/* ================= ⏩ The lesson loading bar (v1.143.0)', '/* ================= End lesson loading bar ================= */');

function makeContext(extra = {}) {
  const ctx = {
    Blob, Uint8Array, DataView, Number, Math, Error, Object, String, Array, Promise, JSON, console,
    setTimeout: (fn) => setImmediate(fn), clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    STORAGE_DIR: 'pdf-annotator', wsEpoch: 1, currentDocId: 'doc1', lessonCapture: null, lessonPending: null,
    statuses: [], puts: [], deletes: [], objects: new Map(), composeCalls: [], failPut: null,
    navigator: { onLine: true },
    recExt(mime) {
      if (/mp4|mpeg/i.test(mime)) return /^audio\//i.test(mime) ? 'm4a' : 'mp4';
      if (/webm/i.test(mime)) return 'webm';
      return 'bin';
    },
    lessonStatus(t) { ctx.statuses.push(t); },
    lessonAssetUrl: u => u,
    lessonTeacher: () => true,
    currentUser: { uid: 'teacher', getIdToken: async () => 'id-token' },
    ...extra
  };
  ctx.window = { liveAppCheckToken: async () => 'app-token' };
  ctx.storage = {
    ref(path) {
      return {
        fullPath: path,
        put(blob, meta) {
          ctx.puts.push({ path, size: blob.size, type: meta && meta.contentType });
          if (ctx.failPut && ctx.failPut(path)) return Promise.reject(new Error('offline'));
          ctx.objects.set(path, blob);
          return Promise.resolve();
        },
        delete() { ctx.deletes.push(path); ctx.objects.delete(path); return Promise.resolve(); },
        getDownloadURL: async () => 'blob:' + path
      };
    }
  };
  // The cloud join, as the service does it: the pieces in order, end to end.
  ctx.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    ctx.composeCalls.push({ url, body, headers: init.headers });
    if (ctx.composeFails) return { ok: false, status: 503, json: async () => ({ error: { message: 'down' } }) };
    const prefix = 'pdf-annotator/lesson-' + body.docId + '-' + body.id;
    const parts = [];
    for (let i = 0; i < body.parts; i++) {
      const name = prefix + '.part-' + String(i).padStart(4, '0');
      if (!ctx.objects.has(name)) return { ok: false, status: 409, json: async () => ({ error: { message: 'missing ' + i } }) };
      parts.push(ctx.objects.get(name));
    }
    const joined = new Blob(parts, { type: body.contentType });
    if (body.bytes !== undefined && joined.size !== body.bytes) return { ok: false, status: 409, json: async () => ({ error: { message: 'size' } }) };
    const path = prefix + '.' + body.ext;
    ctx.objects.set(path, joined);
    return { ok: true, status: 200, json: async () => ({ path, url: 'https://storage.test/' + path, bytes: joined.size }) };
  };
  vm.createContext(ctx);
  vm.runInContext(audioFinalizer + '\n' + mp4Finalizer + '\n' + upload + '\n' + loading +
    '\nthis.LessonAudioFinalize = LessonAudioFinalize; this.LessonMp4Finalize = LessonMp4Finalize;', ctx);
  return ctx;
}
const bytesOf = async blob => Buffer.from(await blob.arrayBuffer());
// Arrays made inside the page's context have that context's prototype.
const plain = v => JSON.parse(JSON.stringify(v));

/* ---------- the pure range arithmetic ---------- */
test('ranges merge where they touch, and slices of the payload map back to the original', () => {
  const c = makeContext();
  assert.deepEqual(plain(c.lessonUpMerge([[0, 4], [4, 9], [12, 12], [12, 20]])), [[0, 9], [12, 20]]);
  assert.equal(c.lessonUpBytes([[0, 9], [12, 20]]), 17);
  const plan = [[10, 20], [30, 35], [40, 60]];
  assert.deepEqual(plain(c.lessonUpSlice(plan, 0, 35)), [[10, 20], [30, 35], [40, 60]]);
  assert.deepEqual(plain(c.lessonUpSlice(plan, 5, 17)), [[15, 20], [30, 35], [40, 42]]);
  assert.deepEqual(plain(c.lessonUpSlice(plan, 15, 35)), [[40, 60]]);
  assert.deepEqual(plain(c.lessonUpSlice(plan, 20, 20)), []);
});

test('lessonUpLocate accepts exactly one unbroken run of the payload, and nothing else', () => {
  const c = makeContext();
  const plan = [[10, 20], [30, 35], [40, 60]];
  assert.equal(c.lessonUpLocate(plan, [[10, 20], [30, 33]]), 0);
  assert.equal(c.lessonUpLocate(plan, [[15, 20], [30, 35], [40, 50]]), 5);
  assert.equal(c.lessonUpLocate(plan, [[42, 60]]), 17);
  assert.equal(c.lessonUpLocate(plan, [[10, 20], [40, 50]]), -1, 'a gap is refused');
  assert.equal(c.lessonUpLocate(plan, [[5, 15]]), -1, 'bytes the file does not carry are refused');
  assert.equal(c.lessonUpLocate(plan, [[20, 25]]), -1);
  assert.equal(c.lessonUpLocate(plan, [[50, 70]]), -1, 'running past the end is refused');
  assert.equal(c.lessonUpLocate(plan, []), -1);
  assert.equal(c.lessonUpLocate([], [[0, 1]]), -1);
});

test('the pill percentage is whole, bounded and never claims what is not up', () => {
  const c = makeContext();
  assert.equal(c.lessonUpPercent(0, 0), 0);
  assert.equal(c.lessonUpPercent(50, 200), 25);
  assert.equal(c.lessonUpPercent(199, 200), 99);
  assert.equal(c.lessonUpPercent(300, 200), 100);
  assert.equal(c.lessonUpPartName('pdf-annotator/lesson-d-a1', 3), 'pdf-annotator/lesson-d-a1.part-0003');
});

/* ---------- ⏩ the loading bar ---------- */
test('opening: the manifest and the first seconds; 100 only when both are there', () => {
  const c = makeContext();
  const p = s => c.lessonLoadPercent(Object.assign({ phase: 'opening', manifest: 0, aheadMs: 0, bufferedMs: 0, durationMs: 600000, local: false, ready: false }, s));
  assert.equal(p({}), 0);
  assert.equal(p({ manifest: 1 }), 35);
  assert.equal(p({ manifest: 1, aheadMs: 2000 }), 67);
  assert.equal(p({ manifest: 0.5, aheadMs: 4000 }), 82);
  assert.equal(p({ manifest: 1, aheadMs: 4000 }), 100);
  assert.equal(p({ manifest: 0.99, ready: true }), 99, 'never 100 before it really is');
  assert.equal(p({ manifest: 1, local: true }), 100, 'a preloaded lesson needs nothing more');
  assert.equal(p({ manifest: 1, aheadMs: 900, durationMs: 1000 }), 93);
  assert.equal(p({ manifest: 1, aheadMs: 1000, durationMs: 1000 }), 100, 'a lesson shorter than the start window needs only itself');
});

test('playing: how much of the whole lesson is here', () => {
  const c = makeContext();
  const p = s => c.lessonLoadPercent(Object.assign({ phase: 'playing', manifest: 1, aheadMs: 0, bufferedMs: 0, durationMs: 600000, local: false, ready: true }, s));
  assert.equal(p({ bufferedMs: 150000 }), 25);
  assert.equal(p({ bufferedMs: 599000 }), 99);
  assert.equal(p({ bufferedMs: 599600 }), 100, 'the last half second is not worth waiting on');
  assert.equal(p({ bufferedMs: 900000 }), 100);
  assert.equal(p({ local: true }), 100);
  assert.equal(p({ durationMs: 0, ready: true }), 100);
});

test('lessonLoadBuffered reads the range the playhead is in and the total', () => {
  const c = makeContext();
  const media = { currentTime: 12, buffered: { length: 2, start: i => [0, 30][i], end: i => [20, 45][i] } };
  const b = c.lessonLoadBuffered(media);
  assert.equal(b.total, 35000);
  assert.equal(b.ahead, 8000);
  assert.deepEqual(JSON.parse(JSON.stringify(c.lessonLoadBuffered(null))), { ahead: 0, total: 0 });
});

/* ---------- the stream, end to end, against real files ---------- */
const ffmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
function make(args, name) {
  const dir = mkdtempSync(join(tmpdir(), 'up-'));
  try {
    const out = join(dir, name);
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y'].concat(args, [out]), { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return readFileSync(out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const LONG = ['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8'];
const fragmentedMp4 = () => make(LONG.concat(['-c:v', 'libx264', '-bf', '0', '-g', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
  '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '500000']), 'rec.mp4');
// A WebM laid out the way Chrome's recorder writes one: an unknown-size
// Segment, an Info with no Duration, then unknown-size Clusters of blocks —
// and no SeekHead or Cues, which the finisher would rightly refuse to shift.
function chromeWebm(clusters = 60, blockBytes = 2600) {
  const hex = v => Buffer.from(v, 'hex');
  const size = value => {
    let width = 1; while (value >= 2 ** (7 * width) - 1) width++;
    const out = Buffer.alloc(width); let rest = value;
    for (let i = width - 1; i >= 0; i--) { out[i] = rest % 256; rest = Math.floor(rest / 256); }
    out[0] |= 1 << (8 - width); return out;
  };
  const field = (id, body, unknown) => Buffer.concat([hex(id), unknown ? hex('01ffffffffffffff') : size(body.length), body]);
  const header = field('1a45dfa3', field('4282', Buffer.from('webm')));
  const info = field('1549a966', Buffer.concat([field('2ad7b1', hex('0f4240')), field('4d80', Buffer.from('Chrome'))]));
  const list = [info];
  let seed = 7;
  for (let c = 0; c < clusters; c++) {
    const block = Buffer.alloc(blockBytes);
    for (let i = 0; i < block.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; block[i] = seed & 0xff; }
    block[0] = 0x81; block[1] = 0; block[2] = 0; block[3] = 0x80;
    list.push(field('1f43b675', Buffer.concat([field('e7', hex((c * 100).toString(16).padStart(4, '0'))), field('a3', block)]), true));
  }
  return Buffer.concat([header, field('18538067', Buffer.concat(list), true)]);
}

// Feeds a file to the recorder side in uneven chunks, the way MediaRecorder
// hands them over, and lets every scan and upload run.
async function record(c, bytes, type, chunkSizes) {
  const cap = { docId: 'doc1', id: 'a1', chunks: [], bytes: 0, recorder: { mimeType: type } };
  c.lessonUpBegin(cap);
  let at = 0, k = 0;
  while (at < bytes.length) {
    const n = Math.min(bytes.length - at, chunkSizes[k++ % chunkSizes.length]);
    const chunk = new Blob([bytes.subarray(at, at + n)], { type });
    cap.chunks.push(chunk); cap.bytes += n; at += n;
    c.lessonUpFeed(cap, type);
    for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r));
  }
  for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r));
  await cap.up.chain;
  return cap;
}
async function finishAndJoin(c, cap, type, durationMs) {
  cap.up.stopped = true;
  const raw = new Blob(cap.chunks, { type });
  const job = { docId: 'doc1', id: 'a1', duration: durationMs, up: cap.up };
  c.lessonPending = job;
  const ok = await c.lessonUpFinish(job, raw);
  return { ok, job, raw };
}

test('an MP4 streams its mdat contents and the join is byte for byte the indexed file', { skip: !ffmpeg && 'ffmpeg is not installed' }, async () => {
  const file = fragmentedMp4();
  const c = makeContext();
  vm.runInContext('LESSON_UP_PART = 24 * 1024;', c);
  const cap = await record(c, file, 'video/mp4', [7000, 31000, 1500, 52000]);
  const sentDuring = cap.up.parts.filter(p => p.done).length;
  assert.ok(sentDuring >= 3, 'pieces went up while it was still recording: ' + sentDuring);
  assert.equal(cap.up.off, false);
  const { ok, job, raw } = await finishAndJoin(c, cap, 'video/mp4', 8000);
  assert.equal(ok, true);
  const joined = c.objects.get('pdf-annotator/lesson-doc1-a1.mp4');
  assert.ok(joined, 'the joined file exists');
  const expected = await bytesOf(await c.LessonMp4Finalize.finalize(raw));
  const got = await bytesOf(joined);
  assert.equal(got.length, expected.length);
  assert.ok(got.equals(expected), 'the join is exactly the file the whole upload would have sent');
  assert.equal(got.toString('latin1', 4, 8), 'ftyp');
  assert.equal(got.toString('latin1', got.readUInt32BE(0) + 4, got.readUInt32BE(0) + 8), 'moov', 'the index comes first, so a player can start and jump at once');
  assert.equal(job.audioPath, 'pdf-annotator/lesson-doc1-a1.mp4');
  assert.equal(job.audioUrl, 'https://storage.test/pdf-annotator/lesson-doc1-a1.mp4');
  const call = c.composeCalls[0];
  assert.equal(call.body.parts, sentDuring + 2, 'the head, the pieces and the rest');
  assert.equal(call.body.bytes, expected.length);
  assert.equal(call.headers.Authorization, 'Bearer id-token');
  assert.equal(call.headers['X-Firebase-AppCheck'], 'app-token');
  // After Stop, only the head and the last seconds went up.
  const afterStop = c.puts.slice(-2).reduce((n, p) => n + p.size, 0);
  assert.ok(afterStop < file.length / 2, 'after Stop it sends ' + afterStop + ' of ' + file.length + ' bytes');
  assert.ok(c.statuses.some(s => /^Saving · \d+%$/.test(s)));
});

test('a WebM streams from its first megabyte on and the join is byte for byte the finished file', async () => {
  const file = chromeWebm();
  const c = makeContext();
  // The real head is 1.25 MB; a small test file uses a smaller one, still
  // well past the Info element at the top of the file.
  vm.runInContext('LESSON_UP_PART = 16 * 1024; LESSON_UP_HEAD = 8 * 1024;', c);
  const cap = await record(c, file, 'video/webm;codecs=vp8,opus', [5000, 9000, 2500]);
  assert.ok(cap.up.head >= 8 * 1024);
  assert.ok(cap.up.parts.filter(p => p.done).length >= 2);
  const { ok, raw } = await finishAndJoin(c, cap, 'video/webm;codecs=vp8,opus', 8000);
  assert.equal(ok, true);
  const got = await bytesOf(c.objects.get('pdf-annotator/lesson-doc1-a1.webm'));
  const expected = await bytesOf(await c.LessonAudioFinalize.finalize(raw, 8000));
  assert.ok(got.equals(expected), 'the join is exactly the finished WebM');
  assert.ok(got.includes(Buffer.from([0x44, 0x89, 0x88])), 'it carries its Duration');
});

test('a piece that never went up is sent again after Stop, and the join is still exact', { skip: !ffmpeg && 'ffmpeg is not installed' }, async () => {
  const file = fragmentedMp4();
  const c = makeContext();
  vm.runInContext('LESSON_UP_PART = 24 * 1024; LESSON_UP_RETRY_MS = [];', c);
  let refused = 0;
  c.failPut = path => /part-0003$/.test(path) && refused++ < 1;
  const cap = await record(c, file, 'video/mp4', [9000, 40000]);
  assert.equal(cap.up.off, true, 'a piece that will not go stops the streaming');
  assert.equal(cap.up.parts.filter(p => p.done).length, 2);
  c.failPut = null;
  const { ok, raw } = await finishAndJoin(c, cap, 'video/mp4', 8000);
  assert.equal(ok, true);
  const got = await bytesOf(c.objects.get('pdf-annotator/lesson-doc1-a1.mp4'));
  assert.ok(got.equals(await bytesOf(await c.LessonMp4Finalize.finalize(raw))));
  assert.equal(c.composeCalls[0].body.parts, 4, 'two pieces, the head and everything after them');
});

test('nothing streamed, or a stream that does not match the file, hands over to the whole upload', { skip: !ffmpeg && 'ffmpeg is not installed' }, async () => {
  const file = fragmentedMp4();
  const quiet = makeContext();
  const cap = await record(quiet, file, 'video/mp4', [50000]);   // the default 4 MB piece is never reached
  assert.equal(cap.up.parts.length, 0);
  assert.equal((await finishAndJoin(quiet, cap, 'video/mp4', 8000)).ok, false);
  assert.equal(quiet.composeCalls.length, 0, 'no join is asked for');

  const odd = makeContext();
  vm.runInContext('LESSON_UP_PART = 24 * 1024;', odd);
  const cap2 = await record(odd, file, 'video/mp4', [9000]);
  cap2.up.parts[0].ranges = [[0, cap2.up.parts[0].bytes]];   // bytes that are not the file's payload
  assert.equal((await finishAndJoin(odd, cap2, 'video/mp4', 8000)).ok, false);
  assert.equal(odd.composeCalls.length, 0);
});

test('a join the cloud refuses throws, and the save falls back with its pieces still there', { skip: !ffmpeg && 'ffmpeg is not installed' }, async () => {
  const file = fragmentedMp4();
  const c = makeContext();
  vm.runInContext('LESSON_UP_PART = 24 * 1024;', c);
  const cap = await record(c, file, 'video/mp4', [12000]);
  c.composeFails = true;
  await assert.rejects(() => finishAndJoin(c, cap, 'video/mp4', 8000), /down/);
  c.lessonUpDiscard({ up: cap.up });
  assert.ok(c.deletes.some(p => /part-0001$/.test(p)), 'the pieces are cleared once the whole upload has gone instead');
});

test('the backup is plain data, taken at once, and never carries a promise', () => {
  const c = makeContext();
  const job = { id: 'a1', docId: 'doc1', saving: true, error: 'x', backup: Promise.resolve(), raw: new Blob(['r']), blob: new Blob(['b']),
    up: { kind: 'mp4', type: 'video/mp4', prefix: 'p', next: 3, chain: Promise.resolve(), parts: [{ i: 1, ranges: [[0, 4]], bytes: 4, done: true }] } };
  const rec = c.lessonJobRecord(job);
  assert.equal('saving' in rec || 'error' in rec || 'backup' in rec || 'raw' in rec, false);
  assert.equal('chain' in rec.up, false);
  assert.deepEqual(JSON.parse(JSON.stringify(rec.up.parts)), [{ i: 1, ranges: [[0, 4]], bytes: 4, done: true }]);
  job.up.parts[0].done = false;
  assert.equal(rec.up.parts[0].done, true, 'a copy, not the live object');
  structuredClone(rec);
});

/* ---------- wiring, read from the page ---------- */
test('the recorder feeds the stream, and the save tries the join before the whole upload', () => {
  assert.match(page, /c\.chunks\.push\(ev\.data\); c\.bytes \+= ev\.data\.size;\n\s+\/\/ ☁[^\n]*\n\s+lessonUpFeed\(c, ev\.data\.type\);/);
  assert.match(page, /lessonUpBegin\(c\);\n\s+c\.recorder\.start\(1000\);/);
  const save = page.slice(page.indexOf('async function lessonSavePending() {'), page.indexOf('function lessonDownloadPending() {'));
  assert.ok(save.indexOf('lessonUpFinish(job, job.raw, startManifest)') > 0);
  assert.ok(save.indexOf('lessonUpFinish(') < save.indexOf('lessonFinalizeMedia(job.raw'), 'the join is tried first');
  assert.ok(save.indexOf('if (job.backup) await job.backup;') < save.indexOf("lessonRecovery('delete'"), 'the device copy is deleted only once it was written');
  assert.match(page, /job\.backup = lessonRecovery\('put', job\.uid \+ '\/' \+ job\.docId, lessonJobRecord\(job\)\)/);
  assert.match(page, /if \(typeof lessonResumePending === 'function'\) lessonResumePending\(id\);\n\s+if \(typeof lessonAutoAsk === 'function'\) lessonAutoAsk\(id\);/);
  assert.match(page, /LESSON_UP_ENDPOINT = 'https:\/\/us-central1-mathgen--app\.cloudfunctions\.net\/ansKeyLessonCompose'/);
});

test('an MP4 lesson is indexed before it is saved, and one the indexer refuses still goes up as recorded', () => {
  const fin = page.slice(page.indexOf('async function lessonFinalizeMedia('), page.indexOf('async function lessonUpCompose('));
  assert.match(fin, /try \{ return await LessonMp4Finalize\.finalize\(blob\); \} catch \(e\) \{ return blob; \}/);
  assert.match(fin, /return LessonAudioFinalize\.finalize\(blob, durationMs\);/);
});

test('the replay starts the media download at once and does not restart it', () => {
  const play = page.slice(page.indexOf('async function lessonPlay(a) {'), page.indexOf('/* ================= ⏩ The lesson loading bar'));
  assert.ok(play.indexOf('load.src = load.media.src = local || audioUrl;') < play.indexOf('var result = await Promise.all(['), 'the media is set before the manifest is awaited');
  assert.match(play, /if \(!\(lessonLoad === load && load\.src === chosen && load\.media === media\)\)/);
  assert.match(page, /function lessonExitPlayback\(\) \{\n[^\n]*\n\s+lessonLoadEnd\(\);/);
  assert.match(page, /<div class="lessonLoad" id="lessonLoad" hidden>/);
  assert.match(page, /role="progressbar"[^>]*aria-label="How much of the lesson has loaded"/);
});

test('the recording bar is a small pill in a corner while it records', () => {
  assert.match(page, /\.lessonBar\.mini \{ position:fixed; left:12px; bottom:12px;/);
  assert.match(page, /\.lessonBar\.mini \.lessonInfo \{ display:none; \}/);
  assert.match(page, /\.lessonBar\.mini \.lessonStepNow \{ display:none; \}/);
  assert.match(page, /body\.lessonScreenRec \.lessonBar\.mini \{ top:8px; bottom:auto; left:auto; right:12px; \}/);
  assert.equal(/\.barStack \{[^}]*transform:/.test(page), false, 'a transformed stack would pin the pill to the stack, not the screen');
  assert.match(page, /bar\.classList\.toggle\('mini', !!lessonCapture \|\| saving\);/);
});
