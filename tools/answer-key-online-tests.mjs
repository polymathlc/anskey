// 📄 Answer keys on Polymath Online (v1.197.0): the pure rules and the glue's wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const AKO = require('../answer-key-online.js').pure;
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const TOKEN = '0f1e2d3c-4b5a-6978-8a9b-acbdcedf0011';
const BUCKET = 'mathgen--app.firebasestorage.app';
const urlFor = (doc, day, token = TOKEN) =>
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(`pdf-annotator/lesson-key-${doc}-${day}.pdf`)}?alt=media&token=${token}`;
const at = (y, m, d, h = 17) => new Date(y, m - 1, d, h).getTime();

test('a class day is the local calendar day, and only a real one', () => {
  assert.equal(AKO.dayKey(at(2026, 11, 13, 23)), '2026-11-13');
  assert.equal(AKO.dayKey(at(2026, 11, 14, 0)), '2026-11-14');
  assert.equal(AKO.dayKey(0), '');
  assert.equal(AKO.dayKey('x'), '');
  assert.ok(AKO.validDay('2026-02-28'));
  assert.ok(!AKO.validDay('2026-02-30'));
  assert.ok(!AKO.validDay('2026-13-01'));
  assert.ok(!AKO.validDay('../x'));
});

test('the storage path is built only from a real worksheet id and day, under the teacher-only lesson- rule', () => {
  assert.equal(AKO.storagePath('pdf-annotator', 'abcDEF_12-3', '2026-11-13'), 'pdf-annotator/lesson-key-abcDEF_12-3-2026-11-13.pdf');
  assert.equal(AKO.storagePath('pdf-annotator', '../evil', '2026-11-13'), '');
  assert.equal(AKO.storagePath('pdf-annotator', 'abc', 'today'), '');
  assert.match(AKO.storagePath('pdf-annotator', 'a', '2026-11-13').split('/')[1], /^lesson-/);
});

test('only Firebase Storage key links with a token are accepted', () => {
  assert.ok(AKO.validUrl(urlFor('abc', '2026-11-13')));
  assert.ok(!AKO.validUrl(urlFor('abc', '2026-11-13', 'nope')));
  assert.ok(!AKO.validUrl(urlFor('abc', '2026-11-13').replace('alt=media&', '')));
  assert.ok(!AKO.validUrl(urlFor('abc', '2026-11-13').replace('https:', 'http:')));
  assert.ok(!AKO.validUrl('https://evil.example/o/pdf-annotator%2Flesson-key-abc-2026-11-13.pdf?alt=media&token=' + TOKEN));
  assert.ok(!AKO.validUrl(urlFor('abc', '2026-11-13').replace('lesson-key-', 'videos-')));
  assert.ok(!AKO.validUrl('javascript:alert(1)'));
});

test('entries come back newest class day first, and junk is dropped', () => {
  const map = {
    '2026-11-06': { url: urlFor('w', '2026-11-06'), at: at(2026, 11, 6), pages: 4, videos: 2, fp: 'a' },
    '2026-11-13': { url: urlFor('w', '2026-11-13'), at: { seconds: at(2026, 11, 13) / 1000 }, pages: 4, videos: 3 },
    '2026-10-30': { url: urlFor('w', '2026-10-30'), at: at(2026, 10, 30), pages: '4' },
    'not-a-day': { url: urlFor('w', '2026-11-01') },
    '2026-11-01': { url: 'https://evil.example/x.pdf' },
    '2026-11-02': null
  };
  const list = AKO.entriesOf(map);
  assert.deepEqual(list.map(e => e.day), ['2026-11-13', '2026-11-06', '2026-10-30']);
  assert.equal(list[0].at, at(2026, 11, 13));
  assert.equal(list[2].pages, 4);
  assert.deepEqual(AKO.entriesOf(null), []);
  assert.deepEqual(AKO.entriesOf([1, 2]), []);
  assert.equal(AKO.entryFor(list, '2026-11-06').videos, 2);
  assert.equal(AKO.entryFor(list, '2026-01-01'), null);
});

test('the newest lesson decides an older worksheet\'s day', () => {
  const anns = [
    { id: 'a', type: 'video', ts: at(2026, 11, 6), lessonRecording: { url: 'x' } },
    { id: 'b', type: 'video', ts: at(2026, 11, 13), lessonRecording: { url: 'y' } },
    { id: 'c', type: 'video', ts: at(2026, 11, 20), url: 'https://youtu.be/x' },
    { id: 'd', type: 'pen', ts: at(2026, 12, 1) }
  ];
  assert.equal(AKO.lessonsOf(anns).length, 2);
  assert.equal(AKO.lastLessonDay(anns), '2026-11-13');
  assert.equal(AKO.lastLessonDay([]), '');
});

test('the fingerprint changes with what goes into the PDF and nothing else', () => {
  const a = AKO.fingerprint(['[1]', 'https://v', '', 100, 3]);
  assert.equal(a, AKO.fingerprint(['[1]', 'https://v', '', 100, 3]));
  assert.notEqual(a, AKO.fingerprint(['[2]', 'https://v', '', 100, 3]));
  assert.notEqual(a, AKO.fingerprint(['[1]', 'https://w', '', 100, 3]));
  assert.match(a, /^[0-9a-f]{16}$/);
});

test('plan: who, when and under which day', () => {
  const now = at(2026, 11, 13, 19);
  const base = { teacher: true, practice: false, docId: 'w1', hasPdf: true, entries: [], lessonDay: '', now, online: true };
  assert.deepEqual(AKO.plan('lesson', base), { day: '2026-11-13', why: 'publish' });
  assert.equal(AKO.plan('lesson', { ...base, teacher: false }).why, 'not-teacher');
  assert.equal(AKO.plan('lesson', { ...base, practice: true }).why, 'practice');
  assert.equal(AKO.plan('lesson', { ...base, docId: '' }).why, 'unsaved');
  assert.equal(AKO.plan('lesson', { ...base, hasPdf: false }).why, 'no-pdf');
  // An ordinary save files only on a class day.
  assert.equal(AKO.plan('save', base).why, 'no-class-day');
  assert.equal(AKO.plan('save', { ...base, lessonDay: '2026-11-13' }).day, '2026-11-13');
  const today = AKO.cleanEntry('2026-11-13', { url: urlFor('w1', '2026-11-13'), fp: 'abc' });
  assert.equal(AKO.plan('save', { ...base, entries: [today] }).day, '2026-11-13');
  assert.equal(AKO.plan('save', { ...base, entries: [today], fp: 'abc' }).why, 'unchanged');
  assert.equal(AKO.plan('save', { ...base, lessonDay: '2026-11-13', online: false }).why, 'not-online');
  // Opening an older worksheet files its last lesson's day, once.
  assert.equal(AKO.plan('open', { ...base, lessonDay: '2026-11-06' }).day, '2026-11-06');
  assert.equal(AKO.plan('open', { ...base, lessonDay: '2026-11-06', entries: [today] }).why, 'no-class-day');
  assert.equal(AKO.plan('open', base).why, 'no-class-day');
  // The teacher's own press always files today's.
  assert.equal(AKO.plan('manual', { ...base, entries: [today], fp: 'abc', online: false }).day, '2026-11-13');
});

test('the doc entry is plain data and labels read like the portal\'s', () => {
  const e = AKO.docEntry({ url: 'u', path: 'p', at: 5, pages: 3.7, videos: -2, fp: 'x'.repeat(60) });
  assert.deepEqual(e, { url: 'u', path: 'p', at: 5, pages: 3, videos: 0, fp: 'x'.repeat(40) });
  assert.equal(AKO.dayLabel('2026-11-13'), 'Fri 13 Nov');
  assert.equal(AKO.dayLabel('nope'), '');
});

test('the glue is wired where a lesson is saved, after both saves and where a document arrives', () => {
  assert.match(html, /<script src="answer-key-online\.js\?v=1\.197\.0"><\/script>/);
  assert.match(html, /akoAfterLesson\(\)/);
  const lessonSave = html.slice(html.indexOf('async function lessonSavePending('), html.indexOf('async function lessonSavePending(') + 9000);
  assert.ok(/vplAfterSave\(\)\)[\s\S]{0,200}akoAfterLesson\(\)/.test(lessonSave), 'the key is filed after the video list, at lesson save');
  assert.equal((html.match(/if \(typeof akoAfterSave === 'function'\) akoAfterSave\(\);/g) || []).length, 2, 'both saves');
  assert.equal((html.match(/if \(typeof akoReadDoc === 'function'\) akoReadDoc\(/g) || []).length, 2, 'both document arrivals');
  assert.match(html, /akoForget\(\)/);
  assert.match(html, /'akoPublishBtn'/);
  const glue = html.slice(html.indexOf('📄 Answer keys on Polymath Online — glue'), html.indexOf('End answer keys on Polymath Online glue'));
  assert.ok(glue.length > 1000);
  for (const guard of ['wheelTeacher()', 'practiceMode', 'currentDocId !== docAtStart', 'P.validUrl(url)', '{ merge: true }', 'P.storagePath(STORAGE_DIR'])
    assert.ok(glue.includes(guard), guard);
  assert.ok(!/printQrUrl\(\)/.test(glue), 'the quiet QR, never the toasting one');
  { const m = html.match(/var APP_VERSION = 'v1\.(\d+)\.\d+'/); assert.ok(m && +m[1] >= 197, 'APP_VERSION is v1.197.0 or later'); }
});
