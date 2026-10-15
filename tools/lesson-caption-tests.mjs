/* =====================================================================
   💬 Lesson captions — the pure cue arithmetic, and what the source must
   keep saying.

   tools/caption-check.mjs records a real lesson in Chromium and routes the
   transcription endpoint. These pin the parts that check cannot reach on
   every machine: splitting a long sentence into readable cues, shifting a
   piece by where it starts, refusing a saved file that says anything odd,
   finding the cue for a moment, and the WAV header OpenAI is sent — plus
   the gates: only the teacher writes captions, on the teacher's own key,
   into a file beside the lesson, and the export asks for them behind a
   typeof guard (it is cut out of the page on its own by export-tests).

     node --test tools/lesson-caption-tests.mjs
   ===================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function fn(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'missing function ' + name);
  let depth = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  return html.slice(start, i + 1);
}
const SECTION = (() => {
  const a = html.indexOf('/* ================= 💬 Lesson captions');
  const b = html.indexOf('/* ================= End lesson captions');
  assert.ok(a > 0 && b > a, 'the captions section markers are missing');
  return html.slice(a, b);
})();

const box = {};
vm.createContext(box);
vm.runInContext(
  'var LESSON_CAPTION_CHARS = 84; var LESSON_CAPTION_MAX_CUES = 20000;\n' +
  ['lessonCaptionSplit', 'lessonCaptionCues', 'lessonCaptionClean', 'lessonCaptionAt', 'lessonCaptionWav'].map(fn).join('\n'),
  box);
const { lessonCaptionSplit: split, lessonCaptionCues: cues, lessonCaptionClean: clean,
  lessonCaptionAt: at, lessonCaptionWav: wav } = box;
const plain = (x) => JSON.parse(JSON.stringify(x));

test('the constants the section and the check rely on', () => {
  assert.match(SECTION, /var LESSON_CAPTION_CHARS = 84;/);
  assert.match(SECTION, /var LESSON_CAPTION_MODEL = 'whisper-1';/);
  assert.match(SECTION, /var LESSON_CAPTION_DIRECT_MAX = 24 \* 1024 \* 1024;/);
  assert.match(SECTION, /var LESSON_CAPTION_PIECE_S = 600;/);
});

test('a short sentence is one cue over the whole segment', () => {
  assert.deepEqual(plain(split('  Hello   class. ', 1000, 2500)), [{ s: 1000, e: 2500, t: 'Hello class.' }]);
});

test('a long sentence is cut at word breaks, never past the line length', () => {
  const text = Array.from({ length: 60 }, (_, i) => 'word' + i).join(' ');
  const out = split(text, 0, 30000);
  assert.ok(out.length >= 4);
  out.forEach((c) => assert.ok(c.t.length <= 84, c.t));
  assert.equal(out.map((c) => c.t).join(' '), text);
});

test('the cut cues share the time in proportion, back to back, ending on the segment end', () => {
  const text = Array.from({ length: 40 }, () => 'abcdefg').join(' ');
  const out = split(text, 2000, 12000);
  assert.equal(out[0].s, 2000);
  assert.equal(out[out.length - 1].e, 12000);
  for (let i = 1; i < out.length; i++) assert.equal(out[i].s, out[i - 1].e);
  out.forEach((c) => assert.ok(c.e > c.s));
});

test('a single word longer than a line is kept whole rather than lost', () => {
  const long = 'x'.repeat(120);
  assert.deepEqual(plain(split(long, 0, 1000)), [{ s: 0, e: 1000, t: long }]);
});

test('empty text or a segment with no length makes no cue', () => {
  assert.deepEqual(plain(split('', 0, 1000)), []);
  assert.deepEqual(plain(split('hello', 1000, 1000)), []);
  assert.deepEqual(plain(split('hello', 1000, 900)), []);
});

test('segments in seconds become cues in milliseconds, moved by the piece offset', () => {
  const out = cues([{ start: 0, end: 1.4, text: ' First part.' }, { start: 1.5, end: 3, text: 'Second part.' }], 600000);
  assert.deepEqual(plain(out), [
    { s: 600000, e: 601400, t: 'First part.' },
    { s: 601500, e: 603000, t: 'Second part.' },
  ]);
});

test('a segment with no length still shows for a moment; junk segments are skipped', () => {
  const out = cues([{ start: 2, end: 2, text: 'Blink' }, null, { start: 'x', end: 3, text: 'bad' }, { start: 1, end: 2 }], 0);
  assert.deepEqual(plain(out), [{ s: 2000, e: 2400, t: 'Blink' }]);
  assert.deepEqual(plain(cues(undefined, 0)), []);
});

test('a saved file is read only as far as it makes sense', () => {
  const out = clean({ cues: [
    { s: 0, e: 1000, t: 'one' },
    { s: 500, e: 400, t: 'backwards' },
    { s: -5, e: 10, t: 'negative' },
    { s: 'a', e: 10, t: 'string time' },
    { s: 2000, e: 3000, t: 'two\u0007\n<b>' },
    { s: 1500, e: 2500, t: 'out of order' },
    { s: 4000, e: 5000, t: '   ' },
    { s: 5000, e: Infinity, t: 'forever' },
    { s: 6000, e: 7000, t: 'y'.repeat(400) },
  ] });
  assert.deepEqual(plain(out.map((c) => c.t.slice(0, 10))), ['one', 'two <b>', 'y'.repeat(10)]);
  assert.equal(out[2].t.length, 300);
  assert.deepEqual(plain(clean(null)), []);
  assert.deepEqual(plain(clean({ cues: 'nope' })), []);
});

test('the caption showing at a moment', () => {
  const list = [{ s: 0, e: 1000, t: 'a' }, { s: 1000, e: 2000, t: 'b' }, { s: 3000, e: 4000, t: 'c' }];
  assert.equal(at(list, 0).t, 'a');
  assert.equal(at(list, 999).t, 'a');
  assert.equal(at(list, 1000).t, 'b');
  assert.equal(at(list, 2500), null, 'a gap shows nothing');
  assert.equal(at(list, 3999).t, 'c');
  assert.equal(at(list, 4000), null);
  assert.equal(at(list, -1), null);
  assert.equal(at([], 10), null);
  assert.equal(at(null, 10), null);
});

test('the lookup agrees with a straight scan over many cues', () => {
  const list = [];
  for (let i = 0, t = 0; i < 500; i++) { const len = 300 + (i * 37) % 900; list.push({ s: t, e: t + len, t: 'c' + i }); t += len + (i % 3 ? 0 : 250); }
  for (let ms = 0; ms < list[list.length - 1].e + 500; ms += 77) {
    const want = list.find((c) => c.s <= ms && ms < c.e) || null;
    assert.equal(at(list, ms), want ? list[list.indexOf(want)] : null, 'at ' + ms);
  }
});

test('the WAV OpenAI is sent is 16-bit mono at the given rate', () => {
  const buf = wav(new Float32Array([0, 1, -1, 2, -2, 0.5]), 16000);
  const v = new DataView(buf);
  const str = (o, n) => String.fromCharCode(...new Uint8Array(buf, o, n));
  assert.equal(buf.byteLength, 44 + 12);
  assert.equal(str(0, 4), 'RIFF');
  assert.equal(v.getUint32(4, true), 36 + 12);
  assert.equal(str(8, 8), 'WAVEfmt ');
  assert.equal(v.getUint16(20, true), 1, 'PCM');
  assert.equal(v.getUint16(22, true), 1, 'mono');
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint32(28, true), 32000);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(str(36, 4), 'data');
  assert.equal(v.getUint32(40, true), 12);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => v.getInt16(44 + i * 2, true)), [0, 32767, -32768, 32767, -32768, 16383]);
});

test('only the teacher writes captions, on their own ChatGPT key, to OpenAI\'s transcription endpoint', () => {
  const gen = fn('lessonCaptionGenerate');
  assert.match(gen, /if \(!lessonTeacher\(\)\) throw new Error\('Only the teacher can make captions\.'\);/);
  assert.match(gen, /getOpenAiKey\(\)/);
  assert.match(gen, /Add your ChatGPT \(OpenAI\) key in AI Engine first/);
  const tr = fn('lessonCaptionTranscribe');
  assert.match(tr, /https:\/\/api\.openai\.com\/v1\/audio\/transcriptions/);
  assert.match(tr, /form\.append\('model', LESSON_CAPTION_MODEL\)/);
  assert.match(tr, /form\.append\('timestamp_granularities\[\]', 'segment'\)/);
  // The button handler asks again, rather than trusting the button was hidden.
  assert.match(fn('lessonCaptionBtnClick'), /lessonTeacher\(\)/);
});

test('the captions are a file beside the lesson, and the lesson points at it', () => {
  const gen = fn('lessonCaptionGenerate');
  assert.match(gen, /'\/lesson-' \+ docId \+ '-' \+ a\.id \+ '\.captions\.json'/);
  assert.match(gen, /captionsUrl/);
  assert.match(gen, /captionsPath/);
  // A late result after the worksheet or the account changed is dropped.
  assert.match(gen, /currentDocId !== docId/);
  // Reading goes through the same URL check every lesson asset does.
  assert.match(fn('lessonCaptionLoad'), /lessonAssetUrl\(r\.captionsUrl\)/);
  assert.match(fn('lessonCaptionLoad'), /lessonCaptionClean\(JSON\.parse\(text\)\)/);
});

test('captions never reach the recorder, and the sound sent is the lesson file', () => {
  assert.doesNotMatch(SECTION, /createMediaStreamSource|createMediaElementSource|AnsKeyLive|getUserMedia/);
});

test('the replay, the account change and the export are all wired', () => {
  assert.match(fn('lessonPlay'), /lessonCaptionReplayLoad\(pb\)/);
  assert.match(fn('lessonReplayFrame'), /lessonCaptionShow\(/);
  assert.match(fn('lessonExitPlayback'), /lessonCaptionHide\(\)/);
  assert.match(fn('lessonRoleChanged'), /lessonCaptionCancel\(\)/);
  // The export section is cut out of the page on its own, so it must ask.
  assert.match(fn('lessonExportDraw'), /typeof lessonCaptionDraw === 'function'/);
  assert.match(fn('lessonExportScreen'), /typeof lessonCaptionDraw === 'function'/);
  assert.match(html, /id="lessonCaptionBtn"/);
  assert.match(html, /id="lessonCaption"/);
  assert.match(html, /id="lessonExportCaptionSeg"/);
});
