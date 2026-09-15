/* Exercise the shipped static-card renderer with deterministic canvas/image
   adapters. No microphone, account, storage, network, or live widget is used. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function section(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end, a);
  assert(a >= 0 && b > a, `Missing source: ${start}`);
  return text.slice(a, b);
}
const start = '/* ================= Lesson recording backgrounds ================= */';
const end = '/* ================= End lesson recording backgrounds ================= */';
const helper = section(html, start, end);
const actualRenderers = section(html, 'function drawAiNotePillOnPdf(', 'async function buildAnnotatedPdf(') +
  section(html, 'function annFrame(a)', '/* Corners of a possibly-rotated frame') +
  section(html, 'function winAnsiSafe(', '/* ================= Flattened PDF download ================= */');

function png(width = 600, height = 800, padding = 0) {
  const bytes = Buffer.alloc(33 + padding);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}
function harness(options = {}) {
  const calls = [], images = [], canvases = [], keyCalls = [];
  class Context {
    save() { calls.push(['save']); } restore() { calls.push(['restore']); }
    scale(...args) { calls.push(['scale', ...args]); }
    measureText(text) { return { width: String(text).length * 3 }; }
    fillText(...args) { calls.push(['text', ...args]); }
    fillRect(...args) { calls.push(['rect', this.globalAlpha, ...args]); }
    strokeRect(...args) { calls.push(['border', ...args]); }
    drawImage(img, ...args) { calls.push(['image', img.src, ...args]); }
    beginPath() {} moveTo() {} lineTo() {} stroke() {}
  }
  class Canvas {
    constructor() { this.width = 0; this.height = 0; this.context = new Context(); canvases.push(this); }
    getContext() { return this.context; }
    toDataURL(type) {
      calls.push(['encoded', type, this.width, this.height]);
      return type === 'image/png' ? png(this.width, this.height, options.padding || 0) : 'data:image/jpeg;base64,ZmFrZS1qcGVn';
    }
  }
  class Image {
    constructor() { this.width = this.naturalWidth = 400; this.height = this.naturalHeight = 300; images.push(this); }
    set src(value) {
      this.value = value;
      if (!value || options.deferImages) return;
      queueMicrotask(() => { if (this.onload) this.onload(); });
    }
    get src() { return this.value; }
  }
  const box = {
    AbortController, DOMException, setTimeout, clearTimeout, Image,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    document: { createElement(name) { assert.equal(name, 'canvas', 'only inert canvases may be created'); return new Canvas(); } },
    AI_NOTE_MIN_W: 90, AI_NOTE_MIN_H: 60, AI_NOTE_PILL_W: 110, AI_NOTE_PILL_H: 20, AI_NOTE_ALPHA: 0.15,
    aiNoteShortName: a => a.title || 'Card',
    keyPageJpeg: async (...args) => { keyCalls.push(args); return options.keyPromise || 'cGRm'; },
    drawAnnsOnCtx: (...args) => { calls.push(['ink', JSON.parse(JSON.stringify(args[3])), args[4]]); }
  };
  vm.createContext(box); vm.runInContext(actualRenderers + '\n' + helper, box);
  return { box, calls, images, canvases, keyCalls };
}
const pages = () => [{ num: 1, baseW: 600, baseH: 800, page: {} }, { num: 2, baseW: 600, baseH: 800, page: {} }];
const card = (extra = {}) => ({ id: 'card', type: 'ainote', kind: 'notes', page: 1, x: 20, y: 30, w: 300, h: 200, title: 'Question', text: 'What is 2 + 2?', ...extra });
const plain = value => JSON.parse(JSON.stringify(value));
async function rejects(fn, pattern) { await assert.rejects(Promise.resolve().then(fn), pattern); }
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('No background canvas for ordinary pencil and text worksheets', async () => {
  const h = harness();
  const result = await h.box.lessonCaptureBackgrounds([{ type: 'pen', page: 1 }], pages());
  assert.deepEqual(plain(result), []); assert.equal(h.canvases.length, 0); assert.equal(h.images.length, 0);
});
test('Preserves cards on affected pages without baking current handwriting or PDF', async () => {
  const h = harness();
  const result = await h.box.lessonCaptureBackgrounds([card(), { type: 'text', page: 1, text: 'Do not bake ink' }], pages());
  assert.deepEqual(Object.keys(result[0]), ['page', 'x', 'y', 'w', 'h', 'data']);
  assert.equal(result.length, 1); assert.equal(result[0].page, 1); assert.equal(result[0].w, 600); assert.equal(result[0].h, 800);
  assert(h.calls.some(c => c[0] === 'text' && c[1] === 'Question'));
  assert(h.calls.some(c => c[0] === 'text' && c[1] === 'What is 2 + 2?'));
  assert(!h.calls.some(c => c.includes('Do not bake ink') || c[0] === 'ink' || c[0] === 'image'));
  assert(h.calls.some(c => c[0] === 'rect' && c[1] === 0.15), 'card chrome remains transparent');
  assert.deepEqual(h.calls.find(c => c[0] === 'encoded'), ['encoded', 'image/png', 1200, 1600]);
  assert.equal(h.canvases[0].width, 0, 'release canvas backing memory');
});
test('Image, table, and widget cards use the actual inert export renderer', async () => {
  const h = harness();
  const widget = card({ id: 'widget', kind: 'widget', title: 'Model' });
  Object.defineProperty(widget, 'html', { get() { throw new Error('Active widget HTML must never be inspected'); } });
  await h.box.lessonCaptureBackgrounds([
    card({ kind: 'paste', src: png() }),
    card({ id: 'table', kind: 'table', columns: ['Topic', 'Answer'], rows: [['Sum', 'Four']] }),
    widget
  ], pages());
  assert.equal(h.images.length, 1); assert(h.calls.some(c => c[0] === 'image'));
  assert(h.calls.some(c => c[0] === 'text' && c[1] === 'Four'));
  assert(h.calls.some(c => c[0] === 'text' && /Interactive widget/.test(c[1])));
});
test('Freezes cards, table arrays, and page dimensions before asynchronous image decoding', async () => {
  const h = harness({ deferImages: true }), pg = pages();
  const image = card({ kind: 'paste', src: png() });
  const table = card({ kind: 'table', title: 'Original', columns: ['Answer'], rows: [['Before']] });
  const promise = h.box.lessonCaptureBackgrounds([image, table], pg);
  table.title = 'Changed'; table.rows[0][0] = 'After'; image.src = 'https://untrusted.invalid/image'; pg[0].baseW = 900;
  h.images[0].onload();
  const result = await promise;
  assert.equal(result[0].w, 600);
  assert(h.calls.some(c => c[0] === 'text' && c[1] === 'Original'));
  assert(h.calls.some(c => c[0] === 'text' && c[1] === 'Before'));
  assert(!h.calls.some(c => c[1] === 'After' || c[1] === 'Changed'));
});
test('Abort while an image is loading stops capture and releases its pending image', async () => {
  const h = harness({ deferImages: true }), control = new AbortController();
  const promise = h.box.lessonCaptureBackgrounds([card({ kind: 'paste', src: png() })], pages(), control.signal);
  control.abort();
  await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(h.images[0].src, ''); assert.equal(h.canvases[0].width, 0);
});
test('Missing/broken/remote images fail instead of silently omitting the question', async () => {
  const h = harness();
  await rejects(() => h.box.lessonCaptureBackgrounds([card({ kind: 'paste' })], pages()), /still loading/);
  await rejects(() => h.box.lessonCaptureBackgrounds([card({ kind: 'paste', src: 'https://untrusted.invalid/image.png' })], pages()), /supported embedded/);
  const broken = harness({ deferImages: true });
  const promise = broken.box.lessonCaptureBackgrounds([card({ kind: 'paste', src: png() })], pages());
  broken.images[0].onerror(); await assert.rejects(promise, /could not be opened/);
});
test('Enforces combined 8 MiB output before returning backgrounds', async () => {
  const h = harness({ padding: 4 * 1024 * 1024 });
  await rejects(() => h.box.lessonCaptureBackgrounds([card(), card({ page: 2 })], pages()), /exceed 8 MB/);
  assert(h.canvases.every(c => c.width === 0));
});
test('Playback validator rejects active URLs, unknown fields, wrong pages and huge PNG dimensions', () => {
  const h = harness(), valid = { page: 1, x: 0, y: 0, w: 600, h: 800, data: png() };
  assert.equal(h.box.lessonValidateBackgrounds([valid], pages()).length, 1);
  for (const changed of [
    { data: 'https://example.org/x.png' }, { data: 'data:image/svg+xml,<svg onload="alert(1)"/>' },
    { data: png(100000, 800) }, { page: 3 }, { w: 900 }, { x: 12 }, { onload: 'active code' }
  ]) assert.throws(() => h.box.lessonValidateBackgrounds([{ ...valid, ...changed }], pages()), /Invalid lesson picture/);
  assert.throws(() => h.box.lessonValidateBackgrounds([valid, valid], pages()), /Invalid lesson picture/);
});
test('Voice image composites PDF, frozen question cards, then current-page ink in that order', async () => {
  let resolveKey;
  const h = harness({ keyPromise: new Promise(r => { resolveKey = r; }) });
  const pg = pages()[0], ink = [{ page: 1, type: 'text', text: 'Before' }, { page: 2, type: 'text', text: 'Other page' }];
  const bg = [{ page: 1, x: 0, y: 0, w: 600, h: 800, data: png() }];
  const promise = h.box.lessonTeachingPageJpeg(pg, ink, bg);
  ink[0].text = 'After'; resolveKey('cGRm');
  assert.equal(await promise, 'ZmFrZS1qcGVn');
  assert.deepEqual(plain(h.keyCalls[0][1]), [], 'PDF render must not bake ink before card background');
  const paints = h.calls.filter(c => c[0] === 'image' || c[0] === 'ink');
  assert.equal(paints[0][1], 'data:image/jpeg;base64,cGRm'); assert.equal(paints[1][1], bg[0].data);
  assert.deepEqual(paints[2][1], [{ page: 1, type: 'text', text: 'Before' }]);
});
test('Voice image aborts promptly during PDF render without sending a stale screenshot', async () => {
  const h = harness({ keyPromise: new Promise(() => {}) }), control = new AbortController();
  const promise = h.box.lessonTeachingPageJpeg(pages()[0], [], [], control.signal);
  control.abort(); await assert.rejects(promise, { name: 'AbortError' }); assert.equal(h.images.length, 0);
});

for (const [name, fn] of tests) { await fn(); console.log(`PASS ${name}`); }
console.log(`${tests.length} recording background tests passed.`);
