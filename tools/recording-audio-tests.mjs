import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = (process.env.ANSKEY_AUDIO_SOURCE ? readFileSync(process.env.ANSKEY_AUDIO_SOURCE, 'utf8') : page).replace(/\r\n/g, '\n');
const begin = source.indexOf('var LessonAudioFinalize = (function () {');
const endMark = 'return { finalize: finalize };\n})();';
const end = source.indexOf(endMark, begin);
assert.ok(begin >= 0 && end > begin, 'The page ships the recording audio finalizer.');
const context = vm.createContext({ Uint8Array, DataView, Blob, Number, Math, Error });
vm.runInContext(source.slice(begin, end + endMark.length), context);
const finalize = context.LessonAudioFinalize.finalize;

const IDS = { header: '1a45dfa3', segment: '18538067', info: '1549a966', cluster: '1f43b675', duration: '4489', scale: '2ad7b1', cues: '1c53bb6b', seek: '114d9b74' };
const hex = value => Buffer.from(value, 'hex');
function size(value) {
  let width = 1; while (value >= 2 ** (7 * width) - 1) width++;
  const bytes = Buffer.alloc(width); let rest = value;
  for (let i = width - 1; i >= 0; i--) { bytes[i] = rest % 256; rest = Math.floor(rest / 256); }
  bytes[0] |= 1 << (8 - width); return bytes;
}
function field(id, body, unknown = false) { return Buffer.concat([hex(id), unknown ? hex('01ffffffffffffff') : size(body.length), body]); }
function uint(value) { let result = value.toString(16); if (result.length % 2) result = '0' + result; return hex(result); }
function float(value, width = 8) { const bytes = Buffer.alloc(width); width === 8 ? bytes.writeDoubleBE(value) : bytes.writeFloatBE(value); return bytes; }
const clusterBytes = field(IDS.cluster, Buffer.concat([
  field('e7', uint(0)),
  // Level-one IDs deliberately occur inside compressed/block payload bytes.
  field('a3', hex('81000080001549a9661c53bb6b114d9b74deadbeef'))
]), true);
function recording({ scale = 1000000, duration, width = 8, known = false, before = Buffer.alloc(0), extra = Buffer.alloc(0), after = Buffer.alloc(0), padding = 0 } = {}) {
  const fields = [field(IDS.scale, uint(scale)), field('4d80', Buffer.from('Chrome'))];
  if (duration !== undefined) fields.push(field(IDS.duration, float(duration, width)));
  if (padding) fields.push(field('ec', Buffer.alloc(padding)));
  fields.push(extra);
  const info = field(IDS.info, Buffer.concat(fields));
  const header = field(IDS.header, field('4282', Buffer.from('webm')));
  const payload = Buffer.concat([before, info, clusterBytes, after]);
  return new Blob([header, field(IDS.segment, payload, !known)], { type: 'audio/webm;codecs=opus' });
}
async function bytes(blob) { return Buffer.from(await blob.arrayBuffer()); }
function durationIn(data) {
  const at = data.indexOf(hex(IDS.duration)); assert.ok(at >= 0);
  const length = data[at + 2] & 0x7f;
  return length === 8 ? data.readDoubleBE(at + 3) : data.readFloatBE(at + 3);
}
function clusterTail(data) { return data.subarray(data.indexOf(hex(IDS.cluster))); }

test('MP4 audio passes through without decoding or rewriting', async () => {
  const input = new Blob(['mp4-content'], { type: 'audio/mp4;codecs=opus' });
  assert.equal(await finalize(input, 2000), input);
});

test('Chrome streaming WebM gains a finite float64 duration without changing its clusters', async () => {
  const input = recording(), original = await bytes(input), fixed = await finalize(input, 4321), data = await bytes(fixed);
  assert.equal(durationIn(data), 4321); assert.equal(data.length, original.length + 11);
  assert.equal(fixed.type, input.type); assert.deepEqual(clusterTail(data), clusterTail(original));
  assert.deepEqual(await bytes(input), original, 'The original recording remains untouched.');
});

test('the timestamp scale is applied instead of assuming every WebM tick is one millisecond', async () => {
  const fixed = await finalize(recording({ scale: 1000 }), 2500);
  assert.equal(durationIn(await bytes(fixed)), 2500000);
});

test('an existing positive finite duration is preserved', async () => {
  const input = recording({ duration: 2400 }); assert.equal(await finalize(input, 2500), input);
});

test('missing or invalid float duration is replaced in place without moving indexes', async () => {
  for (const width of [4, 8]) for (const duration of [0, NaN, Infinity]) {
    const input = recording({ duration, width, before: field(IDS.seek, Buffer.alloc(0)), after: field(IDS.cues, Buffer.alloc(0)) });
    const original = await bytes(input), data = await bytes(await finalize(input, 2500));
    assert.equal(durationIn(data), 2500); assert.equal(data.length, original.length);
    assert.deepEqual(clusterTail(data), clusterTail(original));
  }
});

test('known segment sizes and Info size-width growth are updated consistently', async () => {
  const input = recording({ known: true, padding: 105 }), original = await bytes(input);
  const data = await bytes(await finalize(input, 2000));
  assert.equal(durationIn(data), 2000); assert.deepEqual(clusterTail(data), clusterTail(original));
  // Reopening the resulting container validates both master element boundaries.
  const fixed = new Blob([data], { type: input.type }); assert.equal(await finalize(fixed, 3000), fixed);
});

test('multiple unknown-sized clusters are traversed by element boundaries', async () => {
  const input = recording({ after: clusterBytes }), original = await bytes(input);
  const data = await bytes(await finalize(input, 3500));
  assert.equal(durationIn(data), 3500); assert.deepEqual(clusterTail(data), clusterTail(original));
});

test('positional indexes and checksums are never silently corrupted by inserting metadata', async () => {
  for (const option of [
    { before: field(IDS.seek, Buffer.alloc(0)) }, { after: field(IDS.cues, Buffer.alloc(0)) },
    { extra: field('bf', Buffer.alloc(4)) }, { before: field('bf', Buffer.alloc(4)) }
  ]) await assert.rejects(finalize(recording(option), 2000), /could not be prepared/);
});

test('truncated EBML, invalid timestamp scales, missing Info and oversized recordings fail safely', async () => {
  const good = await bytes(recording());
  for (const data of [Buffer.alloc(0), good.subarray(0, 2), good.subarray(0, good.length - 1),
    Buffer.concat([field(IDS.header, Buffer.alloc(0)), field(IDS.segment, clusterBytes, true)])]) {
    await assert.rejects(finalize(new Blob([data], { type: 'audio/webm' }), 2000), /could not be prepared/);
  }
  await assert.rejects(finalize(recording({ scale: 0 }), 2000), /could not be prepared/);
  await assert.rejects(finalize({ type: 'audio/webm', size: 64 * 1024 * 1024 + 1, arrayBuffer() { throw new Error('must not allocate'); } }, 2000), /could not be prepared/);
  // Read the finalizer's own ceiling: it is checked against the replay core's in
  // tools/recording-core-tests.mjs, and there is no recording length limit to
  // pin a literal to here.
  const maxMs = Function('return ' + /var MAX_MS = ([^;]+);/.exec(source.slice(source.indexOf('var LessonAudioFinalize')))[1])();
  for (const duration of [0, -1, NaN, Infinity, maxMs + 1]) await assert.rejects(finalize(recording(), duration), /could not be prepared/);
  await finalize(recording(), maxMs);   // the recorder's own ceiling must still save
});

/* ---- 🎥 A lesson recorded WITH THE CAMERA is a WebM video of the same shape ---- */
// Read the finalizer's own ceilings: tools/recording-core-tests.mjs checks them
// against the recorder's, and these checks pin what each ceiling refuses.
const finalizerSource = source.slice(source.indexOf('var LessonAudioFinalize'));
const ceiling = name => Function('return ' + new RegExp('var ' + name + ' = ([^;]+);').exec(finalizerSource)[1])();
const videoType = 'video/webm;codecs=vp8,opus';
function asVideo(blob) { return new Blob([blob], { type: videoType }); }
// Many blocks of a fixed size inside ONE unknown-sized cluster — the shape
// Chrome and Firefox write — so the walk has to cross read windows.
function longRecording(blocks, blockBytes, type = videoType) {
  const body = Buffer.alloc(blockBytes - 2 - (blockBytes - 2 > 126 ? 1 : 0));
  const one = field('a3', body);
  assert.equal(one.length, blockBytes, 'test block is the size asked for');
  const info = field(IDS.info, Buffer.concat([field(IDS.scale, uint(1000000)), field('4d80', Buffer.from('Chrome'))]));
  const header = field(IDS.header, field('4282', Buffer.from('webm')));
  const cluster = Buffer.concat([hex(IDS.cluster), hex('01ffffffffffffff'), field('e7', uint(0)), ...Array(blocks).fill(one)]);
  return new Blob([header, field(IDS.segment, Buffer.concat([info, cluster]), true)], { type });
}
// A blob that refuses to be read WHOLE: every read must be a window of it.
// Slices are real Blobs — the finalizer hands the untouched stretches straight
// back into the output — so only a slice whose BYTES are fetched counts.
function windowedOnly(blob, reads) {
  return {
    type: blob.type, size: blob.size,
    arrayBuffer() { throw new Error('the whole file must never be read at once'); },
    slice(a, b) {
      const piece = blob.slice(a, b), read = piece.arrayBuffer.bind(piece);
      piece.arrayBuffer = () => { reads.push(piece.size); return read(); };
      return piece;
    }
  };
}

test('a WebM VIDEO lesson gains its finite duration exactly as an audio one does', async () => {
  const input = asVideo(recording()), original = await bytes(input);
  const fixed = await finalize(input, 61234), data = await bytes(fixed);
  assert.equal(durationIn(data), 61234);
  assert.equal(fixed.type, videoType, 'the video type survives, so the replay knows what it is');
  assert.deepEqual(clusterTail(data), clusterTail(original), 'no video or audio block is touched');
});

test('an MP4 video lesson — Safari and current Chrome — passes through untouched', async () => {
  const input = new Blob(['mp4-video'], { type: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2' });
  assert.equal(await finalize(input, 5000), input);
});

test('a file far bigger than one read window is walked to its end without ever being read whole', async () => {
  // 3,000 blocks of 1,009 bytes: about 3 MB, so the walk crosses the 1 MB
  // window again and again, and an odd block size lands headers across its edges.
  const real = longRecording(3000, 1009), reads = [];
  const fixed = await finalize(windowedOnly(real, reads), 180000);
  const data = await bytes(fixed), original = await bytes(real);
  assert.equal(durationIn(data), 180000);
  assert.deepEqual(clusterTail(data), clusterTail(original), 'every block survives byte for byte');
  assert.ok(reads.length >= 3, 'the walk read the file in several windows: ' + reads.length);
  assert.ok(Math.max(...reads) <= 1024 * 1024 + 12, 'no read was larger than one window: ' + Math.max(...reads));
  assert.ok(reads.reduce((a, b) => a + b, 0) >= real.size - 1024 * 1024, 'the walk really reached the end of the file');
});

test('a video lesson may be far larger than an audio one, and each has its own ceiling', async () => {
  const audioMax = ceiling('MAX_BYTES'), videoMax = ceiling('MAX_VIDEO_BYTES');
  assert.equal(audioMax, 64 * 1024 * 1024);
  assert.ok(videoMax > audioMax, 'a video ceiling below the audio one would refuse every long video lesson');
  // One real 65 MB file: over the AUDIO ceiling, well inside the video one.
  const big = Buffer.alloc(65 * 1024 * 1024);
  const info = field(IDS.info, Buffer.concat([field(IDS.scale, uint(1000000)), field('4d80', Buffer.from('Chrome'))]));
  const header = field(IDS.header, field('4282', Buffer.from('webm')));
  const cluster = Buffer.concat([hex(IDS.cluster), hex('01ffffffffffffff'), field('e7', uint(0)), field('a3', big)]);
  const parts = [header, field(IDS.segment, Buffer.concat([info, cluster]), true)];
  const video = new Blob(parts, { type: videoType }), audio = new Blob(parts, { type: 'audio/webm' });
  assert.ok(video.size > audioMax);
  const reads = [], fixed = await finalize(windowedOnly(video, reads), 3600000);
  assert.equal(durationIn(Buffer.from(await fixed.slice(0, 4096).arrayBuffer())), 3600000);
  assert.equal(fixed.size, video.size + 11);
  await assert.rejects(finalize(audio, 3600000), /could not be prepared/, 'the same bytes as AUDIO are over its ceiling');
  // Past the video ceiling it is refused before a single byte is read.
  await assert.rejects(finalize({ type: videoType, size: videoMax + 1,
    arrayBuffer() { throw new Error('must not allocate'); }, slice() { throw new Error('must not read'); } }, 2000), /could not be prepared/);
});

test('the work bound grows with the file: a long lesson of small blocks is walked, a file of empty elements is not', async () => {
  // 120,000 blocks is past the old flat bound of 100,000 — about 50 minutes of
  // camera at 24 frames a second, which the old walk refused at save time.
  const long = longRecording(120000, 40);
  const fixed = await finalize(long, 3000000);
  assert.equal(durationIn(await bytes(fixed)), 3000000);
  // 150,000 two-byte Void elements: nothing a recorder writes, and refused.
  const voids = Buffer.alloc(150000 * 2);
  for (let i = 0; i < voids.length; i += 2) { voids[i] = 0xec; voids[i + 1] = 0x80; }
  const info = field(IDS.info, field(IDS.scale, uint(1000000)));
  const header = field(IDS.header, field('4282', Buffer.from('webm')));
  const cluster = Buffer.concat([hex(IDS.cluster), hex('01ffffffffffffff'), voids]);
  await assert.rejects(finalize(new Blob([header, field(IDS.segment, Buffer.concat([info, cluster]), true)], { type: videoType }), 2000), /could not be prepared/);
});
