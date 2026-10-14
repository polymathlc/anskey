// 🖼 A card that changes mid-lesson is painted again, and the replay switches
// to the new picture at that moment (v1.134.0). Run out of index.html.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('/* ================= Lesson recording backgrounds ================= */');
const end = html.indexOf('/* ================= End lesson recording backgrounds ================= */', start);
assert.ok(start >= 0 && end > start);
const ctx = vm.createContext({ atob, console, DOMException, setTimeout, Promise, Map, Set, JSON, Number, Math, Object, Array, String, Error });
vm.runInContext(html.slice(start, end), ctx);
const plain = (v) => JSON.parse(JSON.stringify(v));

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG2 = PNG.replace('awAAAABJ', 'awAAAABK');
const pages = [{ num: 1, baseW: 600, baseH: 800 }, { num: 2, baseW: 600, baseH: 800 }];
const pic = (page, data = PNG) => ({ page, x: 0, y: 0, w: 600, h: 800, data });

test('a page whose picture changed ends its old one and starts the new one at that moment', () => {
  const first = [pic(1), pic(2)];
  const later = plain(ctx.lessonBackgroundsChange(first, [pic(1), pic(2, PNG2)], 5000));
  assert.deepEqual(later, [pic(1), { ...pic(2), to: 5000 }, { ...pic(2, PNG2), from: 5000 }]);
  // The card on page 1 goes away at 9 s.
  const gone = plain(ctx.lessonBackgroundsChange(later, [pic(2, PNG2)], 9000));
  assert.deepEqual(gone, [{ ...pic(1), to: 9000 }, { ...pic(2), to: 5000 }, { ...pic(2, PNG2), from: 5000 }]);
  // Nothing changed: nothing added.
  assert.deepEqual(plain(ctx.lessonBackgroundsChange(gone, [pic(2, PNG2)], 12000)), gone);
});

test('a change at 0:00 replaces the starting picture rather than leaving an empty span', () => {
  assert.deepEqual(plain(ctx.lessonBackgroundsChange([pic(1)], [pic(1, PNG2)], 0)), [pic(1, PNG2)]);
  const twice = ctx.lessonBackgroundsChange(ctx.lessonBackgroundsChange([], [pic(1)], 300), [pic(1, PNG2)], 300);
  assert.deepEqual(plain(twice), [{ ...pic(1, PNG2), from: 300 }]);
});

test('the replay shows the pictures of the moment', () => {
  const list = [{ ...pic(1), to: 5000 }, { ...pic(1, PNG2), from: 5000 }, pic(2)];
  const at = (ms) => plain(ctx.lessonBackgroundsAt(list, ms)).map((b) => b.page + ':' + (b.data === PNG ? 'a' : 'b'));
  assert.deepEqual(at(0), ['1:a', '2:a']);
  assert.deepEqual(at(4999), ['1:a', '2:a']);
  assert.deepEqual(at(5000), ['1:b', '2:a']);
});

test('timed pictures pass validation; overlapping or backwards ones do not', () => {
  const ok = [{ ...pic(1), to: 5000 }, { ...pic(1, PNG2), from: 5000 }, pic(2)];
  assert.deepEqual(plain(ctx.lessonValidateBackgrounds(ok, pages)), ok);
  // Recordings made before v1.134.0 (one picture per page, no times) still play.
  assert.deepEqual(plain(ctx.lessonValidateBackgrounds([pic(1), pic(2)], pages)), [pic(1), pic(2)]);
  for (const bad of [
    [pic(1), pic(1)],
    [{ ...pic(1), to: 6000 }, { ...pic(1, PNG2), from: 5000 }],
    [{ ...pic(1), from: 5000, to: 5000 }],
    [{ ...pic(1), from: -1 }],
    [{ ...pic(1), from: 1.5 }],
    [{ ...pic(1), extra: 1 }]
  ]) assert.throws(() => ctx.lessonValidateBackgrounds(bad, pages), /Invalid lesson picture/, JSON.stringify(bad).slice(0, 90));
});
