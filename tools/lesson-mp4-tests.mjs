import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

/* LessonMp4Finalize makes a video downloaded from the 1080p export SEEKABLE.
   MediaRecorder writes an MP4 in fragments with no total length and no index,
   so Windows Media Player, VLC and most editors play it from the top and cannot
   jump ahead. Every failure here is silent: the file still plays. */

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const begin = page.indexOf('var LessonMp4Finalize = (function () {');
const endMark = 'return { finalize: finalize };\n})();';
const end = page.indexOf(endMark, begin);
assert.ok(begin >= 0 && end > begin, 'The page ships the MP4 finalizer.');
const context = vm.createContext({ Uint8Array, DataView, Blob, Number, Math, Error, Object, String });
vm.runInContext(page.slice(begin, end + endMark.length).replace('var LessonMp4Finalize', 'globalThis.LessonMp4Finalize'), context);
const finalize = context.LessonMp4Finalize.finalize;

/* ---------- a fragmented MP4 written the way a recorder writes one ---------- */
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const i32 = n => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };
const box = (type, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([u32(body.length + 8), Buffer.from(type, 'ascii'), body]); };
const full = (type, flags, ...parts) => box(type, u32(flags), ...parts);

function track(id, scale, kind) {
  const tkhd = full('tkhd', 3, u32(0), u32(0), u32(id), u32(0), u32(0), Buffer.alloc(60));
  const mdhd = full('mdhd', 0, u32(0), u32(0), u32(scale), u32(0), u32(0x55c40000));
  const hdlr = full('hdlr', 0, u32(0), Buffer.from(kind === 'video' ? 'vide' : 'soun'), Buffer.alloc(12), Buffer.from('h\0'));
  // The sample entry is opaque to the finalizer: it must be carried across untouched.
  const stsd = full('stsd', 0, u32(1), box(kind === 'video' ? 'avc1' : 'mp4a', Buffer.from('opaque-' + kind + '-entry')));
  const empty = [full('stts', 0, u32(0)), full('stsc', 0, u32(0)), full('stsz', 0, u32(0), u32(0)), full('stco', 0, u32(0))];
  const minf = box('minf', box('dinf'), box('stbl', stsd, ...empty));
  return box('trak', tkhd, box('mdia', mdhd, hdlr, minf));
}
function movie() {
  const mvhd = full('mvhd', 0, u32(0), u32(0), u32(1000), u32(0), u32(0x10000), Buffer.alloc(76), u32(3));
  const trex = id => full('trex', 0, u32(id), u32(1), u32(0), u32(0), u32(0));
  return box('moov', mvhd, track(1, 30000, 'video'), track(2, 48000, 'audio'), box('mvex', trex(1), trex(2)));
}
/* One run of samples for one track: the bytes are derived from the track, the
   sample number and its size, so a moved or shifted byte is found by value. */
function payload(id, serial, size) { return Buffer.alloc(size, (id * 61 + serial * 7) & 0xff); }
function makeFragments(spec) {
  // spec: [{ id, first, durations, sizes, sync, tfdt, ctsOffsets, legacy }...] per fragment
  const out = [], samples = { 1: [], 2: [] };
  spec.forEach(frag => {
    const trafs = [], datas = [];
    frag.runs.forEach(run => {
      const flags = 0x01 | 0x100 | 0x200 | 0x400 | (run.cts ? 0x800 : 0);
      const entries = run.sizes.map((size, i) => Buffer.concat([
        u32(run.durations[i]), u32(size), u32(run.sync[i] ? 0x2000000 : 0x1010000), ...(run.cts ? [i32(run.cts[i])] : [])]));
      datas.push({ run, entries, flags });
    });
    const build = base => {
      let cursor = 0;
      return datas.map(d => {
        const trun = full('trun', d.flags, u32(d.entries.length), i32(base + 8 + cursor), ...d.entries);
        cursor += d.run.sizes.reduce((a, b) => a + b, 0);
        const tfhd = full('tfhd', 0x20000, u32(d.run.id));
        const tfdt = d.run.tfdt === undefined ? Buffer.alloc(0) : full('tfdt', 0, u32(d.run.tfdt));
        return box('traf', tfhd, tfdt, trun);
      });
    };
    const mfhd = full('mfhd', 0, u32(out.length + 1));
    const size = box('moof', mfhd, ...build(0)).length;
    const moof = box('moof', mfhd, ...build(size));
    const bytes = [];
    datas.forEach(d => d.run.sizes.forEach((s, i) => {
      samples[d.run.id] = samples[d.run.id] || [];
      const data = payload(d.run.id, samples[d.run.id].length, s);
      samples[d.run.id].push({ size: s, dur: d.run.durations[i], sync: d.run.sync[i], data });
      bytes.push(data);
    }));
    out.push(moof, box('mdat', ...bytes));
  });
  return { bytes: Buffer.concat(out), samples };
}
const ftyp = box('ftyp', Buffer.from('iso5'), u32(512), Buffer.from('iso5iso6mp41'));
function recording(options = {}) {
  const { bytes, samples } = makeFragments(options.fragments || defaultFragments());
  const file = Buffer.concat([ftyp, options.moov || movie(), bytes]);
  return { blob: new Blob([file], { type: 'video/mp4;codecs=avc1.640028,mp4a.40.2' }), samples, file };
}
function defaultFragments() {
  // 3 fragments, video at 30 fps (ticks of 1/30000), audio at 48 kHz in 1024s.
  const video = (n, first) => ({ id: 1, tfdt: first * 1000, sizes: Array.from({ length: n }, (_, i) => 300 + i * 7),
    durations: Array(n).fill(1000), sync: Array.from({ length: n }, (_, i) => i === 0) });
  const audio = (n, first) => ({ id: 2, tfdt: first * 1024, sizes: Array.from({ length: n }, (_, i) => 90 + (i % 3)),
    durations: Array(n).fill(1024), sync: Array(n).fill(true) });
  return [
    { runs: [video(30, 0), audio(47, 0)] },
    { runs: [video(30, 30), audio(47, 47)] },
    { runs: [video(15, 60), audio(23, 94)] }
  ];
}

/* ---------- an independent reader of the plain MP4 that comes back ---------- */
function boxes(buf, start = 0, stop = buf.length) {
  const list = []; let at = start;
  while (at + 8 <= stop) {
    const size = buf.readUInt32BE(at); const type = buf.toString('ascii', at + 4, at + 8);
    assert.ok(size >= 8 && at + size <= stop, `box ${type} is inside the file`);
    list.push({ type, start: at, body: at + 8, end: at + size }); at += size;
  }
  return list;
}
const child = (buf, parent, type) => boxes(buf, parent.body, parent.end).find(b => b.type === type);
function readPlain(buf) {
  const top = boxes(buf), moov = top.find(b => b.type === 'moov'), mvhd = child(buf, moov, 'mvhd');
  const result = { top: top.map(b => b.type), moov, mvhd: { scale: buf.readUInt32BE(mvhd.body + 12), duration: buf.readUInt32BE(mvhd.body + 16) }, tracks: [] };
  boxes(buf, moov.body, moov.end).filter(b => b.type === 'trak').forEach(trak => {
    const mdia = child(buf, trak, 'mdia'), minf = child(buf, mdia, 'minf'), stbl = child(buf, minf, 'stbl'), mdhd = child(buf, mdia, 'mdhd');
    const get = type => { const b = child(buf, stbl, type); return b && b; };
    const tkhd = child(buf, trak, 'tkhd'), edts = child(buf, trak, 'edts');
    const stts = get('stts'), stsz = get('stsz'), stsc = get('stsc'), stco = get('stco'), stss = get('stss');
    const durations = [];
    for (let i = 0, n = buf.readUInt32BE(stts.body + 4); i < n; i++) {
      const count = buf.readUInt32BE(stts.body + 8 + i * 8), delta = buf.readUInt32BE(stts.body + 12 + i * 8);
      for (let k = 0; k < count; k++) durations.push(delta);
    }
    const count = buf.readUInt32BE(stsz.body + 8), uniform = buf.readUInt32BE(stsz.body + 4), sizes = [];
    for (let i = 0; i < count; i++) sizes.push(uniform || buf.readUInt32BE(stsz.body + 12 + i * 4));
    const groups = [];
    for (let i = 0, n = buf.readUInt32BE(stsc.body + 4); i < n; i++) {
      groups.push({ first: buf.readUInt32BE(stsc.body + 8 + i * 12), n: buf.readUInt32BE(stsc.body + 12 + i * 12), sdi: buf.readUInt32BE(stsc.body + 16 + i * 12) });
    }
    const offsets = [];
    for (let i = 0, n = buf.readUInt32BE(stco.body + 4); i < n; i++) offsets.push(buf.readUInt32BE(stco.body + 8 + i * 4));
    // Walk the sample-to-chunk table to put every sample at its absolute offset.
    const where = []; let sample = 0;
    offsets.forEach((offset, chunk) => {
      const group = [...groups].reverse().find(g => g.first <= chunk + 1);
      let at = offset;
      for (let k = 0; k < group.n; k++, sample++) { where.push(at); at += sizes[sample]; }
    });
    const sync = [];
    if (stss) for (let i = 0, n = buf.readUInt32BE(stss.body + 4); i < n; i++) sync.push(buf.readUInt32BE(stss.body + 8 + i * 4));
    const elst = edts && child(buf, edts, 'elst');
    result.tracks.push({
      id: buf.readUInt32BE(tkhd.body + 12), tkhd: buf.readUInt32BE(tkhd.body + 20),
      scale: buf.readUInt32BE(mdhd.body + 12), mdhd: buf.readUInt32BE(mdhd.body + 16),
      durations, sizes, where, sync, hasSync: !!stss, groups, chunks: offsets.length,
      stsd: buf.subarray(child(buf, stbl, 'stsd').start, child(buf, stbl, 'stsd').end).toString('latin1'),
      edit: elst ? Array.from({ length: buf.readUInt32BE(elst.body + 4) }, (_, i) => ({
        duration: buf.readUInt32BE(elst.body + 8 + i * 12), time: buf.readInt32BE(elst.body + 12 + i * 12) })) : null
    });
  });
  return result;
}
const bytesOf = async blob => Buffer.from(await blob.arrayBuffer());

/* ---------- the behaviour ---------- */
test('a fragmented recording becomes a plain MP4: index first, one mdat, no fragments', async () => {
  const input = recording(), fixed = await finalize(input.blob), out = await bytesOf(fixed);
  const plain = readPlain(out);
  assert.deepEqual(plain.top, ['ftyp', 'moov', 'mdat']);
  assert.equal(fixed.type, input.blob.type, 'The recording keeps its type.');
  assert.equal(out.includes(Buffer.from('moof')), false, 'No fragment is left behind.');
  assert.equal(out.includes(Buffer.from('mvex')), false, 'The fragment index is gone.');
  // The recorder's sample entries are carried across byte for byte.
  assert.ok(plain.tracks[0].stsd.includes('opaque-video-entry'));
  assert.ok(plain.tracks[1].stsd.includes('opaque-audio-entry'));
});

test('every sample is where the new index says, byte for byte, in the recorder\'s order', async () => {
  const input = recording(), out = await bytesOf(await finalize(input.blob)), plain = readPlain(out);
  for (const t of plain.tracks) {
    const expected = input.samples[t.id];
    assert.equal(t.sizes.length, expected.length, `track ${t.id} keeps every sample`);
    expected.forEach((sample, i) => {
      assert.equal(t.sizes[i], sample.size);
      assert.deepEqual(out.subarray(t.where[i], t.where[i] + sample.size), sample.data, `track ${t.id} sample ${i}`);
    });
  }
});

test('durations are real: the track, the movie and every sample', async () => {
  const input = recording(), plain = readPlain(await bytesOf(await finalize(input.blob)));
  const [video, audio] = plain.tracks;
  assert.equal(video.mdhd, 75 * 1000, 'the video lasts 75 frames at 30 fps');
  assert.equal(audio.mdhd, 117 * 1024);
  assert.equal(plain.mvhd.scale, 1000);
  const videoMs = 75 * 1000 * 1000 / 30000, audioMs = Math.round(117 * 1024 * 1000 / 48000);
  assert.equal(video.tkhd, Math.round(videoMs));
  assert.equal(audio.tkhd, audioMs);
  assert.equal(plain.mvhd.duration, Math.max(Math.round(videoMs), audioMs), 'the movie lasts as long as its longest track');
  assert.ok(video.durations.every(d => d === 1000));
});

test('only sync samples are keyframes: the video gets a sync table, the audio does not', async () => {
  const plain = readPlain(await bytesOf(await finalize(recording().blob)));
  assert.deepEqual(plain.tracks[0].sync, [1, 31, 61]);
  assert.equal(plain.tracks[1].hasSync, false, 'A track whose every sample is a keyframe has no stss.');
});

test('chunks keep the recorder\'s interleave and are grouped, not one per sample', async () => {
  const plain = readPlain(await bytesOf(await finalize(recording().blob)));
  assert.equal(plain.tracks[0].chunks, 3);
  assert.equal(plain.tracks[1].chunks, 3);
  assert.deepEqual(plain.tracks[0].groups.map(g => g.n), [30, 15], 'equal neighbours merge in the sample-to-chunk table');
  // Within the file the first video chunk comes before the first audio chunk and the second video after it.
  const v = plain.tracks[0].where, a = plain.tracks[1].where;
  assert.ok(v[0] < a[0] && a[0] < v[30] && v[30] < a[47]);
});

test('an index that fits in front: the stream can start before the file has downloaded', async () => {
  const out = await bytesOf(await finalize(recording().blob)), plain = readPlain(out);
  const mdat = boxes(out).find(b => b.type === 'mdat');
  assert.ok(plain.moov.end <= mdat.start, 'moov precedes mdat');
  assert.ok(plain.tracks.every(t => t.where.every(at => at >= mdat.body && at < mdat.end)), 'every offset points into the one mdat');
  assert.equal(mdat.end, out.length);
});

test('the file type no longer claims to be a fragmented file', async () => {
  const out = await bytesOf(await finalize(recording().blob));
  const brands = out.subarray(8, boxes(out)[0].end).toString('ascii');
  assert.ok(brands.startsWith('isom'));
  assert.ok(brands.includes('mp41'), 'The ordinary compatible brands are there.');
  assert.equal(/iso5|iso6/.test(brands), false, 'iso5/iso6 describe fragmented files only.');
});

test('a track that starts late gets an empty edit so the picture and the sound stay in step', async () => {
  const late = defaultFragments();
  late[0].runs[0].tfdt = 3000;          // the video's first frame is 0.1 s after the sound begins
  late[1].runs[0].tfdt = 33000;
  late[2].runs[0].tfdt = 63000;
  const plain = readPlain(await bytesOf(await finalize(recording({ fragments: late }).blob)));
  const [video, audio] = plain.tracks;
  assert.equal(audio.edit, null, 'the track that starts first needs no edit');
  assert.deepEqual(video.edit, [{ duration: 100, time: -1 }, { duration: Math.round(75 * 1000 * 1000 / 30000), time: 0 }]);
  assert.equal(video.tkhd, 100 + 2500, 'the track\'s own length includes the wait');
  assert.equal(plain.mvhd.duration, 2600);
});

test('both tracks starting at the same non-zero time do not add a black lead-in', async () => {
  const shifted = defaultFragments();
  shifted[0].runs[0].tfdt = 30000; shifted[1].runs[0].tfdt = 60000; shifted[2].runs[0].tfdt = 90000;
  shifted[0].runs[1].tfdt = 48000; shifted[1].runs[1].tfdt = 96000; shifted[2].runs[1].tfdt = 144000;
  const plain = readPlain(await bytesOf(await finalize(recording({ fragments: shifted }).blob)));
  assert.equal(plain.tracks[0].edit, null); assert.equal(plain.tracks[1].edit, null);
});

test('a track the movie never declared is skipped without moving anyone else\'s bytes', async () => {
  const frags = defaultFragments();
  frags[1].runs.push({ id: 9, tfdt: 0, sizes: [11, 12], durations: [5, 5], sync: [true, true] });
  const input = recording({ fragments: frags }), out = await bytesOf(await finalize(input.blob)), plain = readPlain(out);
  assert.equal(plain.tracks.length, 2);
  for (const t of plain.tracks) {
    input.samples[t.id].forEach((s, i) => assert.deepEqual(out.subarray(t.where[i], t.where[i] + s.size), s.data));
  }
});

test('a recording cut short keeps every whole sample and nothing else', async () => {
  const input = recording(), cut = new Blob([input.file.subarray(0, input.file.length - 50)], { type: 'video/mp4' });
  const out = await bytesOf(await finalize(cut)), plain = readPlain(out);
  const total = plain.tracks.reduce((a, t) => a + t.sizes.length, 0);
  assert.ok(total > 0 && total < 75 + 117, 'the cut sample is dropped');
  plain.tracks.forEach(t => t.sizes.forEach((size, i) => {
    assert.ok(t.where[i] + size <= out.length, 'every sample lies inside the file');
    assert.deepEqual(out.subarray(t.where[i], t.where[i] + size), input.samples[t.id][i].data);
  }));
});

test('a file that is already plain is returned as it is', async () => {
  const done = await finalize(recording().blob), again = await finalize(done);
  assert.equal(again, done, 'Finalizing twice is a no-op, not a second rewrite.');
});

test('anything that is not a fragmented MP4 passes through untouched', async () => {
  const webm = new Blob([Buffer.from('1a45dfa39f4286810142f7810142f2810442f3810842820477656d62', 'hex')], { type: 'video/webm' });
  assert.equal(await finalize(webm), webm);
  const text = new Blob(['not a video at all'], { type: 'video/mp4' });
  assert.equal(await finalize(text), text);
  const empty = new Blob([], { type: 'video/mp4' });
  assert.equal(await finalize(empty), empty);
  assert.equal(await finalize(null), null);
  const headerOnly = new Blob([Buffer.concat([ftyp, movie()])], { type: 'video/mp4' });
  assert.equal(await finalize(headerOnly), headerOnly, 'A movie with no fragments has nothing to index.');
});

test('a layout it does not understand throws, so the recording is kept as it was written', async () => {
  const frags = defaultFragments();
  frags[0].runs[0].cts = Array(30).fill(0).map((_, i) => (i === 3 ? -1000 : 0));
  await assert.rejects(() => finalize(recording({ fragments: frags }).blob), /seekable/);
});

test('composition offsets are carried into a ctts table', async () => {
  const frags = defaultFragments();
  frags.forEach(frag => { frag.runs[0].cts = frag.runs[0].sizes.map((_, i) => (i % 2 ? 2000 : 1000)); });
  const out = await bytesOf(await finalize(recording({ fragments: frags }).blob));
  const moov = boxes(out).find(b => b.type === 'moov'), trak = boxes(out, moov.body, moov.end).filter(b => b.type === 'trak')[0];
  const stbl = child(out, child(out, child(out, trak, 'mdia'), 'minf'), 'stbl'), ctts = child(out, stbl, 'ctts');
  assert.ok(ctts, 'a track with composition offsets gets a ctts table');
  const entries = out.readUInt32BE(ctts.body + 4), expanded = [];
  for (let i = 0; i < entries; i++) for (let k = 0; k < out.readUInt32BE(ctts.body + 8 + i * 8); k++) expanded.push(out.readUInt32BE(ctts.body + 12 + i * 8));
  assert.equal(expanded.length, 75);
  assert.deepEqual(expanded.slice(0, 4), [1000, 2000, 1000, 2000]);
});

test('a file past what 32-bit offsets can address is left fragmented rather than corrupted', async () => {
  const huge = { size: 5 * 1024 * 1024 * 1024, type: 'video/mp4', slice() { throw new Error('never read'); } };
  assert.equal(await finalize(huge), huge);
});

test('the source of the media is only ever sliced, never read into memory', () => {
  const source = page.slice(begin, end);
  assert.ok(/blob\.slice\(c\.at, c\.at \+ c\.len\)/.test(source), 'The samples are attached as Blob slices.');
  assert.equal(/blob\.arrayBuffer\(\)/.test(source), false, 'The whole recording is never read at once.');
  assert.equal(/MediaRecorder|createMediaElementSource|AudioContext/.test(source), false, 'The finalizer has no business with the recorder or audio graph.');
});

test('the export hands MP4 to this finalizer and WebM to the other, each guarded', () => {
  const finish = page.slice(page.indexOf('async function lessonExportFinish(job)'), page.indexOf('function lessonExportDownload(job)'));
  assert.ok(/\/webm\/i\.test\(type\)[\s\S]{0,200}LessonAudioFinalize\.finalize/.test(finish), 'WebM still gets its duration.');
  assert.ok(/else if \(\/mp4\/i\.test\(type\)\)[\s\S]{0,200}LessonMp4Finalize\.finalize\(blob\)/.test(finish), 'An MP4 gets its index.');
  assert.equal((finish.match(/catch \(e\)/g) || []).length >= 2, true, 'A file the finalizer refuses is still handed over as recorded.');
  assert.ok(finish.indexOf('LessonMp4Finalize') < finish.indexOf('job.blob = blob'), 'The index is fixed before the file is stored, named and downloaded.');
});

/* ---------- against a real encoder, when one is installed ---------- */
const ffmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stderr}`);
  return result.stdout;
}
test('a real fragmented recording decodes to the same frames and is seekable', { skip: !ffmpeg && 'ffmpeg is not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mp4-'));
  try {
    run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5',
      '-c:v', 'libx264', '-bf', '0', '-g', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof', join(dir, 'in.mp4')]);
    const input = readFileSync(join(dir, 'in.mp4'));
    const fixed = await bytesOf(await finalize(new Blob([input], { type: 'video/mp4' })));
    writeFileSync(join(dir, 'out.mp4'), fixed);
    assert.deepEqual(boxes(fixed).map(b => b.type), ['ftyp', 'moov', 'mdat']);
    const frames = file => run('ffmpeg', ['-v', 'error', '-i', file, '-map', '0', '-f', 'framemd5', '-'])
      .split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split(',').map(x => x.trim()).filter((_, i) => i !== 3).join(',')).sort();
    assert.deepEqual(frames(join(dir, 'out.mp4')), frames(join(dir, 'in.mp4')), 'Every decoded frame and sample is identical.');
    const packets = file => run('ffprobe', ['-v', 'error', '-show_entries', 'packet=stream_index,pts,dts,size,flags', '-of', 'csv=p=0', file])
      .split('\n').filter(Boolean).sort();
    assert.deepEqual(packets(join(dir, 'out.mp4')), packets(join(dir, 'in.mp4')), 'Packet timing, size and keyframes are unchanged.');
    const length = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(dir, 'out.mp4')]));
    assert.ok(Math.abs(length - 5) < 0.15, `the file reports its real length (${length})`);
    // The container itself must say it is seekable: ffprobe reads the keyframe index.
    const index = run('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', join(dir, 'out.mp4')]);
    assert.equal(index.split('\n').filter(l => /K/.test(l)).length, 5, 'one keyframe per second is still marked');
    run('ffmpeg', ['-v', 'error', '-y', '-ss', '3.2', '-i', join(dir, 'out.mp4'), '-frames:v', '1', join(dir, 'seek.png')]);
    assert.ok(readFileSync(join(dir, 'seek.png')).length > 100, 'A jump to 3.2 s produces a picture.');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
