// 🖱 Right-click actions on worksheets (v1.199.0): the pure rules and the glue's wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const FA = require('../file-actions.js').pure;
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const src = readFileSync(new URL('../file-actions.js', import.meta.url), 'utf8');
const glue = html.slice(html.indexOf('🖱 Right-click actions — glue'), html.indexOf('End right-click actions glue'));

const TOKEN = '0f1e2d3c-4b5a-6978-8a9b-acbdcedf0011';
const BUCKET = 'mathgen--app.firebasestorage.app';
const keyUrl = (doc, day, token = TOKEN) =>
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(`pdf-annotator/lesson-key-${doc}-${day}.pdf`)}?alt=media&token=${token}`;
const at = (y, m, d, h = 17) => new Date(y, m - 1, d, h).getTime();
const rec = (id, url, ts) => ({ id, type: 'video', url, ts, page: 1, lessonRecording: { duration: 60000 } });
const pen = (id) => ({ id, type: 'pen', page: 1, points: [[0, 0], [1, 1]] });

test('days are real calendar days and read like the app', () => {
  assert.equal(FA.dayKey(at(2026, 11, 14, 9)), '2026-11-14');
  assert.equal(FA.dayKey(0), '');
  assert.ok(FA.validDay('2026-11-14'));
  assert.ok(!FA.validDay('2026-02-30'));
  assert.ok(!FA.validDay('../../x'));
  assert.equal(FA.dayLabel('2026-11-14'), 'Sat 14 Nov 2026');
  assert.equal(FA.dayLabel('x'), '');
});

test('annotation counts split writing from recorded lessons', () => {
  const json = JSON.stringify([pen('a'), pen('b'), rec('r1', 'https://v/1', 1), { id: 'r2', type: 'video', lessonRecording: {} }, null]);
  assert.deepEqual(FA.annotationCounts(json), { answers: 2, videos: 1 });
  assert.deepEqual(FA.annotationCounts('not json'), { answers: 0, videos: 0 });
  assert.deepEqual(FA.annotationCounts([pen('a')]), { answers: 1, videos: 0 });
});

test('answer key links follow the same rule as the portal and answer-key-online.js', () => {
  const AKO = require('../answer-key-online.js').pure;
  const cases = [keyUrl('abc', '2026-11-13'), keyUrl('abc', '2026-11-13', 'bad'), keyUrl('abc', '2026-11-13').replace('https:', 'http:'),
    'https://evil.example/x.pdf', keyUrl('abc', '2026-11-13').replace('lesson-key-', 'videos-'), 'javascript:alert(1)', ''];
  for (const u of cases) assert.equal(FA.validKeyUrl(u), AKO.validUrl(u), u);
});

test('key entries: newest first, junk dropped, hand-made ones marked', () => {
  const map = {
    '2026-11-06': { url: keyUrl('w', '2026-11-06'), pages: 3, videos: 2, at: at(2026, 11, 6) },
    '2026-11-13': { url: keyUrl('w', '2026-11-13'), pages: 4, manual: true, file: 'key.pdf', at: { seconds: at(2026, 11, 13) / 1000 } },
    'nope': { url: keyUrl('w', '2026-11-01') },
    '2026-11-01': { url: 'https://evil.example/a.pdf' }
  };
  const list = FA.keyEntries(map);
  assert.deepEqual(list.map(e => e.day), ['2026-11-13', '2026-11-06']);
  assert.equal(list[0].manual, true);
  assert.equal(list[0].file, 'key.pdf');
  assert.equal(list[0].at, at(2026, 11, 13));
  assert.equal(list[1].manual, false);
  assert.deepEqual(FA.manualDays(map), { '2026-11-13': true });
  assert.deepEqual(FA.keyEntries(null), []);
  assert.deepEqual(FA.keyEntries([1]), []);
});

test('docInfo reads a worksheet document without opening it', () => {
  const d = {
    name: 'P5 Fractions', storagePath: 'pdf-annotator/w.pdf', pageCount: 4, onlineCourseId: 'c1', level: 'P5',
    annotations: JSON.stringify([pen('a'), rec('r', 'https://v', 1)]),
    answerKeys: { '2026-11-13': { url: keyUrl('w', '2026-11-13'), manual: true } }
  };
  const i = FA.docInfo(d);
  assert.equal(i.name, 'P5 Fractions');
  assert.equal(i.answers, true);
  assert.equal(i.videos, 1);
  assert.equal(i.keys, 1);
  assert.equal(i.manualKeys, 1);
  assert.equal(i.inClass, 'c1');
  assert.equal(i.hasPdf, true);
  // Too big for the document: written on, videos known from the video page.
  const big = FA.docInfo({ annotationsPath: 'pdf-annotator/w.annotations.json', videoPlaylist: { n: 5 } });
  assert.equal(big.answers, true);
  assert.equal(big.videos, 5);
  assert.equal(big.big, true);
  assert.equal(FA.docInfo(null).name, 'Untitled');
});

test('match: the answer key replaces, the videos are added once each — Polymath Online\'s own rule', () => {
  const target = JSON.stringify([pen('t1'), rec('rv', 'https://v/same', 1)]);
  const source = JSON.stringify([pen('s1'), pen('s2'), rec('rv', 'https://v/same', 1), rec('new', 'https://v/new', 2), rec('dupurl', 'https://v/same', 3)]);
  const both = FA.mergeAnnotations(target, source, { answers: true, videos: true });
  assert.deepEqual(JSON.parse(both.json).map(a => a.id), ['s1', 's2', 'rv', 'new']);
  assert.equal(both.answers, 2);
  assert.equal(both.videos, 1);
  assert.equal(both.replacedAnswers, 1);
  const keysOnly = FA.mergeAnnotations(target, source, { answers: true, videos: false });
  assert.deepEqual(JSON.parse(keysOnly.json).map(a => a.id), ['s1', 's2', 'rv']);
  const videosOnly = FA.mergeAnnotations(target, source, { answers: false, videos: true });
  assert.deepEqual(JSON.parse(videosOnly.json).map(a => a.id), ['t1', 'rv', 'new']);
  assert.equal(videosOnly.answers, 0);
  const nothing = FA.mergeAnnotations(target, '[]', {});
  assert.deepEqual(JSON.parse(nothing.json).map(a => a.id), ['t1', 'rv']);
});

test('match: the answer key PDFs of the receiving worksheet win, the source fills the rest', () => {
  const t = { answerKeys: { '2026-11-13': { url: keyUrl('t', '2026-11-13'), pages: 1 } } };
  const s = { answerKeys: { '2026-11-13': { url: keyUrl('s', '2026-11-13'), pages: 9 }, '2026-11-06': { url: keyUrl('s', '2026-11-06') }, '2026-11-01': { url: 'https://evil' } } };
  const out = FA.mergeAnswerKeyMaps(t, s);
  assert.deepEqual(Object.keys(out).sort(), ['2026-11-06', '2026-11-13']);
  assert.equal(out['2026-11-13'].pages, 1);
  assert.deepEqual(FA.mergeAnswerKeyMaps(null, null), {});
});

test('the same merge as the portal, when polymathlc/cer is checked out beside this repo', { skip: !existsSync(new URL('../../cer/online/portal-core.js', import.meta.url)) }, () => {
  const Core = require('../../cer/online/portal-core.js');
  const C = Core.pure || Core;
  const target = JSON.stringify([pen('t1'), rec('rv', 'https://v/same', 1)]);
  const source = JSON.stringify([pen('s1'), rec('new', 'https://v/new', 2)]);
  for (const bring of [{ answers: true, videos: true }, { answers: true }, { videos: true }, {}])
    assert.deepEqual(FA.mergeAnnotations(target, source, bring), C.mergeAnnotations(target, source, bring));
});

const courses = {
  c1: { title: 'P5 Maths Sat 9am', level: 'P5', subject: 'math', day: 'Saturday', slot: 0, worksheetIds: ['w1', 'w2', 'w3', 'w4'], currentIndex: 1, releasedThrough: 3 },
  c2: { level: 'P4', subject: 'science', day: 'Monday', slot: 1, worksheetIds: ['x1', 'w9'], currentIndex: -1, releasedThrough: -1 }
};
const library = [
  { id: 'w1', data: { name: 'Ratio 1', storagePath: 'p', wsDate: '2026-11-01' } },
  { id: 'w2', data: { name: 'Ratio 2', storagePath: 'p', annotations: JSON.stringify([pen('a')]) } },
  { id: 'w3', data: { name: 'Fractions', storagePath: 'p' } },
  { id: 'x1', data: { name: 'Plants', storagePath: 'p' } },
  { id: 'loose1', data: { name: 'Loose sheet', storagePath: 'p', wsDate: '2026-11-10' } },
  { id: 'loose2', data: { name: 'Older loose', storagePath: 'p', wsDate: '2026-10-01' } },
  { id: 'nopdf', data: { name: 'No PDF' } }
];

test('class places and their words', () => {
  assert.deepEqual(FA.classPlaces(courses, 'w2'), [{ courseId: 'c1', title: 'P5 Maths Sat 9am', seq: 1, total: 4, state: 'current' }]);
  assert.equal(FA.classPlaces(courses, 'w3')[0].state, 'next');
  assert.equal(FA.classPlaces(courses, 'w4')[0].state, 'queued');
  assert.equal(FA.classPlaces(courses, 'w1')[0].state, 'done');
  assert.equal(FA.classPlaces(courses, 'x1')[0].state, 'current', 'worksheet 1 before the class starts');
  assert.deepEqual(FA.classPlaces(courses, 'loose1'), []);
  assert.equal(FA.placeText(FA.classPlaces(courses, 'w2')[0]), 'P5 Maths Sat 9am · worksheet 2 of 4 · Current worksheet');
  assert.equal(FA.courseTitle(courses.c2), 'P4 Science Monday 5 pm');
});

test('deleting a class worksheet keeps the class where it was', () => {
  const c = courses.c1;
  // Before the current one: the class stays on the same worksheet.
  assert.deepEqual(FA.removeFromCourse(c, 'w1'), { worksheetIds: ['w2', 'w3', 'w4'], removedAt: 0, currentIndex: 0, currentDocId: 'w2', releasedThrough: 2 });
  // The current one: the next becomes current, never "not started".
  assert.deepEqual(FA.removeFromCourse(c, 'w2'), { worksheetIds: ['w1', 'w3', 'w4'], removedAt: 1, currentIndex: 1, currentDocId: 'w3', releasedThrough: 2 });
  // After it: nothing moves but the count.
  assert.deepEqual(FA.removeFromCourse(c, 'w4'), { worksheetIds: ['w1', 'w2', 'w3'], removedAt: 3, currentIndex: 1, currentDocId: 'w2', releasedThrough: 2 });
  // The last current one at the end: the class sits on the new last.
  const end = { worksheetIds: ['a', 'b'], currentIndex: 1, releasedThrough: 1 };
  assert.deepEqual(FA.removeFromCourse(end, 'b'), { worksheetIds: ['a'], removedAt: 1, currentIndex: 0, currentDocId: 'a', releasedThrough: 0 });
  // A class not started stays not started.
  assert.equal(FA.removeFromCourse(courses.c2, 'x1').currentIndex, -1);
  assert.equal(FA.removeFromCourse(courses.c2, 'x1').releasedThrough, -1);
  // The only worksheet.
  assert.deepEqual(FA.removeFromCourse({ worksheetIds: ['a'], currentIndex: 0, releasedThrough: 0 }, 'a'), { worksheetIds: [], removedAt: 0, currentIndex: -1, currentDocId: null, releasedThrough: -1 });
  assert.equal(FA.removeFromCourse(c, 'zzz'), null);
});

test('the picker: class lists in teaching order, then the rest newest first, searchable', () => {
  const g = FA.pickerGroups(courses, library, { exclude: 'w2' });
  assert.deepEqual(g.map(x => x.title), ['P4 Science Monday 5 pm', 'P5 Maths Sat 9am'], 'P4 before P5');
  assert.deepEqual(g[1].items.map(i => i.id), ['w1', 'w3', 'w4'], 'the worksheet itself is left out');
  assert.equal(g[1].items[2].missing, true, 'a class worksheet not in the library still shows');
  assert.equal(g[0].items[1].name, 'Worksheet 2');
  const all = FA.pickerGroups(courses, library, { all: true });
  const rest = all[all.length - 1];
  assert.equal(rest.title, 'Not in a class list');
  assert.deepEqual(rest.items.map(i => i.id), ['loose1', 'loose2'], 'no PDF, no row; newest first');
  assert.deepEqual(FA.pickerGroups(courses, library, { query: 'ratio' }).map(x => x.items.map(i => i.id)), [['w1', 'w2']]);
  assert.deepEqual(FA.pickerGroups(courses, library, { query: 'science' })[0].items.map(i => i.id), ['x1', 'w9'], 'a class title match keeps its worksheets');
  assert.deepEqual(FA.pickerGroups(courses, library, { query: 'zzz', all: true }), []);
  assert.match(FA.itemMeta(g[1].items[1]), /#3 · Next worksheet/);
});

test('uploading a PDF by hand is checked first', () => {
  const ok = { name: 'Key.PDF', type: '', size: 2000 };
  assert.equal(FA.checkUpload(ok, '2026-11-14'), '');
  assert.match(FA.checkUpload(null, '2026-11-14'), /Choose/);
  assert.match(FA.checkUpload({ name: 'a.docx', type: 'application/msword', size: 9 }, '2026-11-14'), /not a PDF/);
  assert.match(FA.checkUpload({ name: 'a.pdf', type: 'application/pdf', size: 0 }, '2026-11-14'), /empty/);
  assert.match(FA.checkUpload({ name: 'a.pdf', type: 'application/pdf', size: FA.MAX_PDF_BYTES + 1 }, '2026-11-14'), /limit/);
  assert.match(FA.checkUpload(ok, '2026-02-30'), /class day/);
  const e = FA.manualEntry({ url: 'u', path: 'p', at: 7, pages: 3.6, file: 'x'.repeat(200) });
  assert.deepEqual(e, { url: 'u', path: 'p', at: 7, pages: 3, videos: 0, fp: 'manual', manual: true, file: 'x'.repeat(120) });
});

test('the menu: teacher only, and says why an entry is off', () => {
  assert.deepEqual(FA.menuModel({ teacher: false }), []);
  const info = FA.docInfo({ name: 'A', storagePath: 'p', annotations: JSON.stringify([rec('r', 'https://v', 1)]) });
  const m = FA.menuModel({ teacher: true, info });
  const ids = m.filter(x => !x.sep).map(x => x.id);
  assert.deepEqual(ids, ['open', 'upload-all', 'upload-key', 'upload-videos', 'upload-pdf', 'match', 'keys', 'delete']);
  assert.ok(m.every(x => x.sep || !x.disabled));
  const noVideos = FA.menuModel({ teacher: true, info: FA.docInfo({ storagePath: 'p' }) });
  assert.equal(noVideos.find(x => x.id === 'upload-videos').disabled, true);
  const recording = FA.menuModel({ teacher: true, info, busy: true, isOpen: false });
  assert.equal(recording.find(x => x.id === 'upload-all').disabled, true);
  assert.match(recording.find(x => x.id === 'upload-all').hint, /Stop the lesson recording/);
  assert.equal(recording.find(x => x.id === 'match').disabled, undefined, 'matching other worksheets is still fine');
  const recordingThis = FA.menuModel({ teacher: true, info, busy: true, isOpen: true });
  assert.equal(recordingThis.find(x => x.id === 'delete').disabled, true);
  assert.equal(recordingThis.find(x => x.id === 'upload-all').disabled, false);
  const noPdf = FA.menuModel({ teacher: true, info: FA.docInfo({ name: 'x' }) });
  assert.equal(noPdf.find(x => x.id === 'upload-key').disabled, true);
  assert.equal(m.find(x => x.id === 'delete').danger, true);
});

test('the delete confirmation says what goes and what stays', () => {
  const info = FA.docInfo({ name: 'Ratio 2', storagePath: 'p', annotations: JSON.stringify([pen('a'), rec('r', 'https://v', 1)]), answerKeys: { '2026-11-13': { url: keyUrl('w2', '2026-11-13') } } });
  const s = FA.deleteSummary(info, FA.classPlaces(courses, 'w2'));
  assert.equal(s.title, 'Delete “Ratio 2”?');
  assert.match(s.lines[0], /worksheet 2 of 4 in P5 Maths Sat 9am — the class is ON it now/);
  assert.ok(s.lines.some(l => /1 answer key PDF on Polymath Online disappears/.test(l)));
  assert.ok(s.lines.some(l => /1 lesson video .*video files stay/.test(l)));
  assert.equal(s.lines[s.lines.length - 1], 'This cannot be undone.');
  assert.equal(s.confirm, 'Delete worksheet');
});

test('the windows write text only and never delete without asking', () => {
  assert.ok(!/innerHTML/.test(src), 'no innerHTML in file-actions.js');
  assert.ok(!/insertAdjacentHTML/.test(src));
  assert.match(src, /'keydown', 'keyup', 'keypress'/, 'keys typed in a window never reach the tool shortcuts');
  // env.remove and env.removeKey are reached only after confirm(...) says yes.
  const del = src.slice(src.indexOf('function doDelete('), src.indexOf('/* ---- the window ---- */'));
  assert.ok(del.indexOf('confirm(') >= 0 && del.indexOf('confirm(') < del.indexOf('env.remove('));
  assert.match(del, /if \(!yes\)/);
  assert.equal(src.split('env.remove(').length, 2, 'one door to deleting a worksheet');
  assert.equal(src.split('env.removeKey(').length, 2, 'one door to removing a key');
  const keys = src.slice(src.indexOf('function openKeys('), src.indexOf('return {\n      attach'));
  assert.ok(keys.indexOf('confirm({') < keys.indexOf('env.removeKey('));
  // Cancel holds the focus in a confirmation.
  assert.match(src, /no\.focus\(/);
  // The menu is only for the teacher; everyone else keeps the browser's own.
  assert.match(src, /if \(!teacher\(\)\) return;\s+\/\/ everyone else keeps the browser's own menu/);
});

test('the glue: wired onto both lists, teacher gated, and through the lesson\'s own doors', () => {
  assert.match(html, /<script src="file-actions\.js\?v=1\.199\.0"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="file-actions\.css\?v=1\.199\.0">/);
  { const m = html.match(/var APP_VERSION = 'v1\.(\d+)\.\d+'/); assert.ok(m && +m[1] >= 199, 'APP_VERSION is v1.199.0 or later'); }
  assert.ok(glue.length > 3000);
  assert.match(html, /faAttach\(btn, function \(\) \{ return item; \}\)/, 'the worksheet list');
  assert.match(html, /faAttach\(row, function \(\) \{ return \{ id: docSnap\.id, data: d \}; \}\)/, 'My PDFs');
  for (const name of ['async function faUploadNow(', 'async function faUploadPdf(', 'async function faMatch(', 'async function faRemoveKey(', 'async function faDeleteWorksheet('])
    assert.match(glue.slice(glue.indexOf(name), glue.indexOf(name) + 200), /faTeacher\(\)/, name + ' asks for the teacher');
  assert.match(glue, /akoPublish\('manual'\)/, 'the answer key is made exactly as after a lesson');
  assert.match(glue, /vplPublish\(pl\)/, 'the video page is filed exactly as after a save');
  assert.match(glue, /A\.storagePath\(STORAGE_DIR, targetId, day\)/, 'a PDF by hand goes to the teacher-only lesson-key path');
  assert.match(glue, /A\.validUrl\(url\)/);
  assert.match(glue, /F\.mergeAnnotations\(/);
  assert.match(glue, /writeAnnotations\(targetId, merged\.json, extra,/, 'big answer keys go to Storage like every save');
  assert.match(glue, /onlinePrepareOnly = id/, 'opening for an upload never moves the class');
  assert.match(glue, /lessonBusy\(\)/);
  assert.match(glue, /F\.removeFromCourse\(/);
  // Deleting from My PDFs asks in the same window.
  const del = html.slice(html.indexOf('async function deleteSavedDoc('), html.indexOf('async function deleteSavedDoc(') + 1400);
  assert.match(del, /await ctl\.confirm\(/);
  assert.ok(del.indexOf('ctl.confirm(') < del.indexOf('faDeleteWorksheet('));
  // A hand-made key is never replaced by an automatic run.
  assert.match(html, /if \(trigger !== 'manual' && akoManualDays\[first\.day\]\) return null;/);
  assert.match(html, /akoManualDays = window\.FileActions \? window\.FileActions\.pure\.manualDays\(d && d\.answerKeys\) : \{\};/);
});
