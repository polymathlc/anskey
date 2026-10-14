// ⏬ Lesson preload: a worksheet's recorded lessons, downloaded with a bar from
// 0 to 100% and kept on the device so replays seek instantly. Run out of index.html.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const plain = (v) => JSON.parse(JSON.stringify(v));
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function cut(start, end) {
  const i = html.indexOf(start);
  assert.ok(i >= 0, 'missing ' + start);
  const j = html.indexOf(end, i);
  assert.ok(j > i, 'missing ' + end);
  return html.slice(i, j + end.length);
}
const preload = cut('/* ================= ⏬ Lesson preload', '/* ================= End lesson preload ================= */');
const assetUrl = cut('function lessonAssetUrl(value) {', '\n}\n');

const BASE = 'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/';
const asset = (name) => BASE + encodeURIComponent('pdf-annotator/' + name) + '?alt=media&token=t';
function lesson(id, ts, { video = false, bytes = 0 } = {}) {
  return { id, type: 'video', ts, url: asset('lesson-w1-' + id + (video ? '.webm' : '.m4a')), label: 'Lesson ' + id,
    lessonRecording: { version: 1, manifestUrl: asset('lesson-w1-' + id + '.json'), audioPath: 'pdf-annotator/lesson-w1-' + id + (video ? '.webm' : '.m4a'), duration: 60000, video, bytes } };
}

function fakeNode(id) {
  const listeners = {};
  const classes = new Set();
  return {
    id, hidden: false, textContent: '', checked: false, style: {}, attributes: {}, src: '', currentTime: 0, paused: true,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle(c, on) { on ? classes.add(c) : classes.delete(c); } },
    setAttribute(k, v) { this.attributes[k] = String(v); }, getAttribute(k) { return k === 'src' ? this.src : this.attributes[k] ?? null; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
    fire(type) { (listeners[type] || []).slice().forEach((fn) => fn({})); },
    play() { this.paused = false; return Promise.resolve(); }
  };
}

// Cache Storage, kept in memory: what was put comes back as a fresh Response.
function fakeCaches() {
  const stores = {};
  return {
    stores,
    async open(name) {
      const m = (stores[name] = stores[name] || new Map());
      return {
        async put(url, res) { const buf = new Uint8Array(await res.arrayBuffer()); m.set(String(url), { buf, type: res.headers.get('Content-Type') }); },
        async match(url) { const e = m.get(String(url)); return e ? new Response(e.buf, { headers: { 'Content-Type': e.type || '' } }) : undefined; },
        async delete(url) { return m.delete(String(url)); }
      };
    }
  };
}

// The network: each file is served in 4 chunks, with its Content-Length.
function fakeFetch(files, log, { failOn = '', cutShort = '' } = {}) {
  return async (url, options = {}) => {
    log.push(url);
    if (url === failOn) return new Response('no', { status: 403 });
    const body = files[url];
    if (!body) return new Response('missing', { status: 404 });
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    const size = bytes.byteLength, step = Math.ceil(size / 4);
    let at = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (options.signal && options.signal.aborted) { controller.error(new DOMException('aborted', 'AbortError')); return; }
        if (at >= size || (url === cutShort && at >= step)) { controller.close(); return; }
        controller.enqueue(bytes.slice(at, at + step)); at += step;
      }
    });
    return new Response(stream, { headers: { 'Content-Length': String(size), 'Content-Type': url.includes('.json') ? 'application/json' : 'audio/mp4' } });
  };
}

function makeContext(overrides = {}) {
  const nodes = {};
  const timers = [];
  const objectUrls = [];
  const ctx = {
    console, Promise, Math, Number, Array, Object, JSON, String, Date, Error, DOMException,
    URL: Object.assign(function (...a) { return new URL(...a); }, {
      createObjectURL: (blob) => { const u = 'blob:local/' + objectUrls.length; objectUrls.push({ u, blob }); return u; },
      revokeObjectURL: (u) => { ctx.revoked.push(u); }
    }),
    Blob, Response, ReadableStream, AbortController, TextEncoder,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    localStorage: { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } },
    navigator: { connection: { saveData: false }, storage: { estimate: async () => ({ quota: 10e9, usage: 0 }) } },
    caches: fakeCaches(),
    $: (id) => (nodes[id] = nodes[id] || fakeNode(id)),
    STORAGE_DIR: 'pdf-annotator',
    lessonTeacher: () => false,
    lessonPlayback: null,
    lessonMedia: () => nodes.media || (nodes.media = fakeNode('media')),
    currentDocId: 'w1',
    annotations: [],
    storage: { ref: (path) => ({ getMetadata: async () => ({ size: ctx.sizes[path] || 0 }) }) },
    sizes: {},
    fetched: [],
    revoked: [],
    ...overrides
  };
  ctx.nodes = nodes; ctx.timers = timers; ctx.objectUrls = objectUrls;
  vm.createContext(ctx);
  vm.runInContext(assetUrl + '\n' + preload, ctx);
  return ctx;
}
const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(times = 6) { for (let i = 0; i < times; i++) await flush(); }

test('every recorded lesson is found once, newest first, and other links are never fetched', () => {
  const c = makeContext();
  const a = lesson('a', 100), b = lesson('b', 300, { video: true });
  const items = c.lessonPreloadItems([
    a, { id: 'pen', type: 'pen' }, { id: 'yt', type: 'video', url: 'https://youtube.com/x' },
    b, { ...a, id: 'copy' },
    { id: 'evil', type: 'video', url: 'https://evil.test/lesson.m4a', lessonRecording: { version: 1, manifestUrl: 'https://evil.test/m.json' } },
    { id: 'other', type: 'video', url: BASE + encodeURIComponent('pdf-annotator/other.m4a'), lessonRecording: { version: 1, manifestUrl: asset('lesson-x.json') } }
  ]);
  assert.deepEqual(plain(items.map((i) => i.id)), ['b', 'a']);
  assert.equal(items[0].video, true);
  assert.equal(items[0].path, 'pdf-annotator/lesson-w1-b.webm');
  assert.deepEqual(plain(c.lessonPreloadItems(null)), []);
});

test('manifests are downloaded before media, and files already on the device are skipped', () => {
  const c = makeContext();
  const items = c.lessonPreloadItems([lesson('a', 1), lesson('b', 2)]);
  const have = { [items[1].manifestUrl]: true };
  const files = c.lessonPreloadFiles(items, have);
  assert.deepEqual(plain(files.map((f) => f.kind)), ['manifest', 'media', 'media']);
  assert.equal(files[0].url, items[0].manifestUrl);
});

test('the bar goes from 0 to 99 while loading and reaches 100 only when done', () => {
  const c = makeContext();
  assert.equal(c.lessonPreloadPercent(0, 100, false), 0);
  assert.equal(c.lessonPreloadPercent(37, 100, false), 37);
  assert.equal(c.lessonPreloadPercent(100, 100, false), 99);
  assert.equal(c.lessonPreloadPercent(150, 100, false), 99);
  assert.equal(c.lessonPreloadPercent(5, 0, false), 0);
  assert.equal(c.lessonPreloadPercent(0, 0, true), 100);
});

test('sizes read like a person would say them', () => {
  const c = makeContext();
  assert.equal(c.lessonPreloadSize(0), '');
  assert.equal(c.lessonPreloadSize(300), '1 KB');
  assert.equal(c.lessonPreloadSize(512 * 1024), '512 KB');
  assert.equal(c.lessonPreloadSize(3.25 * 1048576), '3.3 MB');
  assert.equal(c.lessonPreloadSize(148 * 1048576), '148 MB');
  assert.equal(c.lessonPreloadSize(2.5 * 1073741824), '2.5 GB');
});

test('the card asks, counts up, finishes and explains a failure', () => {
  const c = makeContext();
  const ask = c.lessonPreloadView({ phase: 'ask', count: 1, video: true, bytes: 148 * 1048576 });
  assert.equal(ask.title, 'Preload this lesson video?');
  assert.match(ask.sub, /^148 MB\. Jumping to any question/);
  assert.equal(ask.go, 'Preload'); assert.equal(ask.no, 'Not now'); assert.equal(ask.always, true); assert.equal(ask.meter, false);
  const many = c.lessonPreloadView({ phase: 'ask', count: 3, video: false, bytes: 0 });
  assert.equal(many.title, 'Preload these 3 lesson recordings?');
  assert.match(many.sub, /^Jumping/);
  const loading = c.lessonPreloadView({ phase: 'loading', count: 2, video: true, loaded: 50 * 1048576, total: 200 * 1048576 });
  assert.equal(loading.title, 'Preloading 2 lesson videos…');
  assert.equal(loading.sub, '50 MB of 200 MB');
  assert.equal(loading.pct, 25); assert.equal(loading.meter, true); assert.equal(loading.no, 'Cancel'); assert.equal(loading.go, '');
  const done = c.lessonPreloadView({ phase: 'done', count: 2 });
  assert.equal(done.pct, 100); assert.equal(done.title, 'All 2 lessons ready to play instantly');
  const failed = c.lessonPreloadView({ phase: 'error', message: 'No room.', loaded: 1, total: 4 });
  assert.equal(failed.sub, 'No room.'); assert.equal(failed.go, 'Try again'); assert.equal(failed.pct, 25);
});

test('the oldest preloaded lessons make room, never the ones being preloaded', () => {
  const c = makeContext();
  const index = [{ url: 'old', bytes: 600, at: 1 }, { url: 'mid', bytes: 300, at: 2 }, { url: 'keep', bytes: 500, at: 0 }, { url: 'new', bytes: 100, at: 3 }];
  assert.deepEqual(plain(c.lessonPreloadEvictions(index, 400, 1600, {})), ['keep']);
  assert.deepEqual(plain(c.lessonPreloadEvictions(index, 400, 1600, { keep: true })), ['old']);
  assert.deepEqual(plain(c.lessonPreloadEvictions(index, 400, 2000, {})), []);
  assert.deepEqual(plain(c.lessonPreloadEvictions(index, 1000, 1000, { keep: true })), ['old', 'mid', 'new']);
});

test('the teacher is never asked, and neither is a worksheet without recorded lessons', async () => {
  const teacher = makeContext({ lessonTeacher: () => true, annotations: [lesson('a', 1)] });
  teacher.lessonPreloadOffer('w1'); await settle();
  assert.equal(teacher.nodes.lessonPreload, undefined);
  const empty = makeContext({ annotations: [{ id: 'p', type: 'pen' }] });
  empty.lessonPreloadOffer('w1'); await settle();
  assert.equal(empty.lessonPreloadState, null);
});

test('a student is asked once per worksheet, with the size from Storage', async () => {
  const a = lesson('a', 1, { video: true });
  const c = makeContext({ annotations: [a] });
  c.sizes[a.lessonRecording.audioPath] = 40 * 1048576;
  await c.lessonPreloadOffer('w1');
  assert.equal(c.lessonPreloadState.phase, 'ask');
  assert.equal(c.nodes.lessonPreload.hidden, false);
  assert.equal(c.nodes.lessonPreloadTitle.textContent, 'Preload this lesson video?');
  assert.match(c.nodes.lessonPreloadSub.textContent, /^40 MB\./);
  assert.equal(c.nodes.lessonPreloadGo.textContent, 'Preload');
  assert.equal(c.nodes.lessonPreloadAlwaysRow.hidden, false);
  c.nodes.lessonPreloadNo.fire('click');
  assert.equal(c.nodes.lessonPreload.hidden, true);
  await c.lessonPreloadOffer('w1');
  assert.equal(c.lessonPreloadState, null, 'not asked twice in one visit');
});

test('Preload downloads every file with a rising bar, keeps them, then plays them locally', async () => {
  const a = lesson('a', 1, { video: true }), b = lesson('b', 2);
  const media = new Uint8Array(4000).fill(7), audio = new Uint8Array(1000).fill(3);
  const files = { [a.url]: media, [b.url]: audio, [a.lessonRecording.manifestUrl]: '{"version":1}', [b.lessonRecording.manifestUrl]: '{"version":1,"b":1}' };
  const log = [];
  const c = makeContext({ annotations: [a, b] });
  c.fetch = fakeFetch(files, log);
  const seen = [];
  const render = c.lessonPreloadRender;
  c.lessonPreloadRender = () => { render(); if (c.lessonPreloadState) seen.push(c.nodes.lessonPreloadPct.textContent); };
  await c.lessonPreloadOffer('w1');
  await c.lessonPreloadStart();
  assert.equal(c.lessonPreloadState.phase, 'done');
  assert.equal(c.nodes.lessonPreloadPct.textContent, '100%');
  assert.equal(c.nodes.lessonPreloadFill.style.width, '100%');
  assert.equal(c.nodes.lessonPreloadMeter.attributes['aria-valuenow'], '100');
  assert.equal(c.nodes.lessonPreloadTitle.textContent, 'All 2 lessons ready to play instantly');
  const numbers = seen.filter((p) => /%$/.test(p)).map((p) => parseInt(p, 10));
  assert.ok(numbers.length > 3, 'the bar moved: ' + numbers);
  for (let i = 1; i < numbers.length; i++) assert.ok(numbers[i] >= numbers[i - 1], 'the bar never goes back: ' + numbers);
  assert.ok(numbers.slice(0, -1).every((n) => n < 100), 'only the end says 100%');
  // Manifests first, then the media; each once.
  assert.deepEqual(log, [b.lessonRecording.manifestUrl, a.lessonRecording.manifestUrl, b.url, a.url]);
  // Kept on the device, and remembered for the size budget.
  const store = c.caches.stores['polymath-lesson-media-v1'];
  assert.equal(store.get(a.url).buf.byteLength, 4000);
  assert.equal(c.lessonPreloadIndex().length, 4);
  // The replay asks for the local copy and gets it, a manifest included.
  const src = await c.lessonPreloadSrc(a.url);
  assert.match(src, /^blob:local\//);
  assert.equal(c.objectUrls.find((o) => o.u === src).blob.size, 4000);
  assert.equal(await c.lessonPreloadSrc(a.url), src, 'one object URL per lesson');
  const manifest = await c.lessonPreloadResponse(b.lessonRecording.manifestUrl);
  assert.deepEqual(await manifest.json(), { version: 1, b: 1 });
  assert.equal(await c.lessonPreloadSrc(asset('lesson-w1-never.m4a')), '');
  // The card goes away by itself.
  c.timers.at(-1).fn();
  assert.equal(c.nodes.lessonPreload.hidden, true);
  // Opening the worksheet again on a later visit asks nothing: it is all here.
  c.lessonPreloadAskedFor = {};
  vm.runInContext('lessonPreloadAskedFor = {}', c);
  await c.lessonPreloadOffer('w1');
  assert.equal(c.lessonPreloadState, null);
});

test('"Always preload" starts at once, except on a data saver connection', async () => {
  const a = lesson('a', 1);
  const files = { [a.url]: new Uint8Array(100), [a.lessonRecording.manifestUrl]: '{}' };
  const c = makeContext({ annotations: [a] });
  c.fetch = fakeFetch(files, []);
  c.$('lessonPreloadAlways').checked = true;
  c.$('lessonPreloadAlways').fire('change');
  assert.equal(c.localStorage.getItem('anskeyLessonPreload'), 'always');
  await c.lessonPreloadOffer('w1');
  assert.equal(c.lessonPreloadState.phase, 'done');
  const saver = makeContext({ annotations: [a], navigator: { connection: { saveData: true } } });
  saver.localStorage.setItem('anskeyLessonPreload', 'always');
  saver.fetch = fakeFetch(files, []);
  await saver.lessonPreloadOffer('w1');
  assert.equal(saver.lessonPreloadState.phase, 'ask');
  saver.$('lessonPreloadAlways').checked = false;
  saver.$('lessonPreloadAlways').fire('change');
  assert.equal(saver.localStorage.getItem('anskeyLessonPreload'), null);
});

test('a failed or cut-short download stops with a reason and keeps nothing broken', async () => {
  const a = lesson('a', 1);
  const files = { [a.url]: new Uint8Array(1000), [a.lessonRecording.manifestUrl]: '{}' };
  const c = makeContext({ annotations: [a] });
  c.fetch = fakeFetch(files, [], { failOn: a.url });
  await c.lessonPreloadOffer('w1');
  await c.lessonPreloadStart();
  assert.equal(c.lessonPreloadState.phase, 'error');
  assert.match(c.nodes.lessonPreloadSub.textContent, /could not be downloaded/);
  assert.equal(c.nodes.lessonPreloadGo.textContent, 'Try again');
  assert.equal(c.caches.stores['polymath-lesson-media-v1'].has(a.url), false);
  // Try again only fetches what is still missing.
  const log = [];
  c.fetch = fakeFetch(files, log, { cutShort: a.url });
  await c.lessonPreloadStart();
  assert.deepEqual(log, [a.url]);
  assert.equal(c.lessonPreloadState.phase, 'error');
  assert.match(c.nodes.lessonPreloadSub.textContent, /cut short/);
  assert.equal(c.caches.stores['polymath-lesson-media-v1'].has(a.url), false);
  c.fetch = fakeFetch(files, log);
  await c.lessonPreloadStart();
  assert.equal(c.lessonPreloadState.phase, 'done');
});

test('a device without room says so before downloading anything', async () => {
  const a = lesson('a', 1);
  const log = [];
  const c = makeContext({ annotations: [a], navigator: { storage: { estimate: async () => ({ quota: 1000, usage: 900 }) } } });
  c.sizes[a.lessonRecording.audioPath] = 50 * 1048576;
  c.fetch = fakeFetch({ [a.url]: new Uint8Array(10) }, log);
  await c.lessonPreloadOffer('w1');
  await c.lessonPreloadStart();
  assert.equal(c.lessonPreloadState.phase, 'error');
  assert.match(c.nodes.lessonPreloadSub.textContent, /does not have 50 MB free/);
  assert.deepEqual(log, []);
});

test('Cancel stops the download and closes the card', async () => {
  const a = lesson('a', 1);
  const c = makeContext({ annotations: [a] });
  let release;
  c.fetch = async () => { await new Promise((r) => { release = r; }); throw new DOMException('aborted', 'AbortError'); };
  await c.lessonPreloadOffer('w1');
  const running = c.lessonPreloadStart();
  await settle();
  assert.equal(c.lessonPreloadState.phase, 'loading');
  assert.equal(c.nodes.lessonPreloadNo.textContent, 'Cancel');
  c.nodes.lessonPreloadNo.fire('click');
  release(); await running;
  assert.equal(c.lessonPreloadState, null);
  assert.equal(c.nodes.lessonPreload.hidden, true);
});

test('without Cache Storage the lessons are kept in memory for the visit', async () => {
  const a = lesson('a', 1);
  const c = makeContext({ annotations: [a], caches: undefined });
  c.fetch = fakeFetch({ [a.url]: new Uint8Array(800), [a.lessonRecording.manifestUrl]: '{"m":1}' }, []);
  await c.lessonPreloadOffer('w1');
  await c.lessonPreloadStart();
  assert.equal(c.lessonPreloadState.phase, 'done');
  assert.match(await c.lessonPreloadSrc(a.url), /^blob:/);
  assert.deepEqual(await (await c.lessonPreloadResponse(a.lessonRecording.manifestUrl)).json(), { m: 1 });
});

test('a lesson already playing moves to its local copy at the same moment', async () => {
  const a = lesson('a', 1);
  const c = makeContext({ annotations: [a] });
  c.fetch = fakeFetch({ [a.url]: new Uint8Array(500), [a.lessonRecording.manifestUrl]: '{}' }, []);
  const media = c.lessonMedia();
  media.src = a.url; media.currentTime = 42.5; media.paused = false;
  const pb = { ann: a, local: false };
  c.lessonPlayback = pb;
  await c.lessonPreloadOffer('w1');
  await c.lessonPreloadStart();
  assert.equal(pb.local, true);
  assert.match(media.src, /^blob:/);
  media.currentTime = 0; media.paused = true;
  media.fire('loadedmetadata');
  assert.equal(media.currentTime, 42.5);
  assert.equal(media.paused, false, 'still playing');
  // Another lesson, or one already local, is left alone.
  assert.equal(await c.lessonPreloadAdopt(a.url), false);
});

test('opening another worksheet lets go of the last one\'s object URLs, but not the one playing', async () => {
  const a = lesson('a', 1);
  const c = makeContext({ annotations: [a] });
  c.fetch = fakeFetch({ [a.url]: new Uint8Array(500), [a.lessonRecording.manifestUrl]: '{}' }, []);
  await c.lessonPreloadOffer('w1');
  await c.lessonPreloadStart();
  const src = await c.lessonPreloadSrc(a.url);
  c.lessonPlayback = { ann: a, local: true };
  c.lessonPreloadRelease('w2');
  assert.deepEqual(c.revoked, []);
  c.lessonPlayback = null;
  c.lessonPreloadRelease('w2');
  assert.deepEqual(c.revoked, [src]);
});

test('the replay and the worksheet opening are wired to the preload, guarded', () => {
  assert.match(html, /if \(typeof lessonPreloadOffer === 'function'\) lessonPreloadOffer\(id\);/);
  assert.match(html, /typeof lessonPreloadSrc === 'function' \? lessonPreloadSrc\(a\.url\)/);
  assert.match(html, /media\.src = result\[2\] \|\| audioUrl;/);
  assert.match(html, /typeof lessonPreloadResponse === 'function' \? await lessonPreloadResponse\(url\)/);
  assert.match(html, /<div class="lessonPreload" id="lessonPreload" hidden/);
  assert.ok(html.indexOf('id="lessonPreload"') < html.indexOf('id="lessonPlayer"'), 'the card sits above the player');
  assert.match(html, /@media print \{ \.lessonPreload \{ display:none !important; \} \}/);
});

test('with the video sizes known the bar counts bytes, "2.0 MB of 4.0 MB"', async () => {
  const a = lesson('a', 1, { video: true });
  const big = new Uint8Array(4 * 1048576);
  const c = makeContext({ annotations: [a] });
  c.sizes[a.lessonRecording.audioPath] = big.byteLength;
  c.fetch = fakeFetch({ [a.url]: big, [a.lessonRecording.manifestUrl]: '{}' }, []);
  const subs = [], pcts = [];
  const render = c.lessonPreloadRender;
  c.lessonPreloadRender = () => { render(); if (c.lessonPreloadState?.phase === 'loading') { subs.push(c.nodes.lessonPreloadSub.textContent); pcts.push(c.lessonPreloadState.pct); } };
  await c.lessonPreloadOffer('w1');
  await c.lessonPreloadStart();
  assert.ok(subs.includes('2.0 MB of 4.0 MB'), subs.join(' | '));
  assert.deepEqual(pcts.filter((p) => p > 0), [25, 50, 75, 99]);
  assert.equal(c.lessonPreloadState.phase, 'done');
});

test('the old network copy takes over if a preloaded file will not play', () => {
  assert.match(html, /if \(pb && pb\.local && pb\.remote && lessonMedia\(\) === media && media\.getAttribute\('src'\) !== pb\.remote\) \{/);
  assert.match(html, /pb\.local = !!result\[2\]; pb\.remote = audioUrl;/);
});
