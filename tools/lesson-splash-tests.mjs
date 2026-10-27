/* =====================================================================
   🏰 LESSON START — the pure helpers and the glue
   ---------------------------------------------------------------------
   Runs lesson-splash.js in a vm (it only touches the DOM inside create's
   functions, never at load) and reads index.html for the glue.

     node --test tools/lesson-splash-tests.mjs

   Every failure here is quiet on screen: rules that come back empty open
   onto a blank board in front of a class; stickers that land on the title
   hide the words they decorate; a sprite cell read off the wrong row shows
   half a hero; and a button outside the teacher's gate puts the editor in a
   student's hands.
   ===================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../lesson-splash.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../lesson-splash.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const LS = sandbox.window.LessonSplash;
const P = LS.pure;
const plain = v => JSON.parse(JSON.stringify(v));

test('the module exposes create and the pure helpers', () => {
  assert.equal(typeof LS.create, 'function');
  for (const k of ['clean', 'stickerSpots', 'stickerPicks', 'spriteStyle', 'rng', 'same', 'newer', 'dateLine', 'esc']) {
    assert.equal(typeof P[k], 'function', k);
  }
});

test('the default rules are the three the teacher asked for', () => {
  const d = P.defaults();
  assert.equal(d.items.length, 3);
  assert.match(d.items[0].who, /online/i);
  assert.match(d.items[0].text, /camera for the whole lesson/i);
  assert.equal(d.items[0].reward, '+2 points');
  assert.match(d.items[1].who, /physical/i);
  assert.match(d.items[1].text, /focus and keep quiet/i);
  assert.equal(d.items[1].reward, '+2 points');
  assert.match(d.items[2].text, /homework, if any/i);
  assert.equal(d.items[2].reward, '');
  // defaults() hands out a copy: editing it never edits the next open.
  d.items[0].text = 'changed';
  assert.notEqual(P.defaults().items[0].text, 'changed');
});

test('clean keeps the shape and refuses what is not rules', () => {
  assert.equal(P.clean(null), null);
  assert.equal(P.clean('rules'), null);
  assert.equal(P.clean({ items: [] }), null);
  assert.equal(P.clean({ items: [{ icon: '⭐', who: '  ', text: '' }] }), null, 'a line with only an icon is nothing');
  const c = plain(P.clean({ title: '', cover: '', items: [{ who: ' Online\n students ', text: 'Camera\ton.', reward: 7 }] }));
  assert.deepEqual(c, { v: 1, kicker: '', cover: "Today's Quest", title: 'Quest rules', items: [{ icon: '', who: 'Online students', text: 'Camera on.', reward: '7' }] });
});

test('clean caps by characters, never splitting an emoji', () => {
  const long = '😀'.repeat(300);
  const c = P.clean({ items: [{ who: 'x', text: long, icon: '🎯🎯🎯🎯🎯🎯🎯🎯🎯🎯' }] });
  assert.equal(Array.from(c.items[0].text).length, P.LIMITS.text);
  assert.ok(!/[\uD800-\uDBFF]$/.test(c.items[0].text), 'no lone high surrogate at the end');
  assert.equal(Array.from(c.items[0].icon).length, P.LIMITS.icon);
});

test('clean keeps at most LIMITS.items lines', () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ who: 'W' + i, text: 'T' + i }));
  assert.equal(P.clean({ items }).items.length, P.LIMITS.items);
});

test('same ignores the stamp; newer prefers the later stamp', () => {
  const a = Object.assign(P.defaults(), { at: 1 });
  const b = Object.assign(P.defaults(), { at: 2 });
  assert.equal(P.same(a, b), true);
  b.items[0].text = 'Cameras on, please.';
  assert.equal(P.same(a, b), false);
  assert.equal(P.newer(a, b).items[0].text, 'Cameras on, please.');
  assert.equal(P.newer(b, a).items[0].text, 'Cameras on, please.');
  assert.equal(P.newer(null, a).at, 1);
  assert.equal(P.newer(a, { items: [] }).at, 1, 'a broken copy never wins');
  const unstamped = P.defaults(); unstamped.title = 'Old';
  assert.equal(P.newer(unstamped, a).title, 'Quest rules', 'a copy with a stamp beats one without');
});

test('the generator is seeded: the same seed peppers the same page', () => {
  const o = { w: 1280, h: 800, size: 90, max: 24, seed: 42, avoid: [{ x: 300, y: 200, w: 680, h: 300 }] };
  assert.deepEqual(plain(P.stickerSpots(o)), plain(P.stickerSpots(o)));
  assert.notDeepEqual(plain(P.stickerSpots(o)), plain(P.stickerSpots(Object.assign({}, o, { seed: 43 }))));
  assert.deepEqual(plain(P.stickerPicks(7, 12)), plain(P.stickerPicks(7, 12)));
});

test('stickers stay on screen and off what must stay readable', () => {
  for (let seed = 1; seed < 60; seed++) {
    const avoid = [{ x: 220, y: 150, w: 840, h: 420 }, { x: 1100, y: 10, w: 170, h: 44 }];
    const spots = P.stickerSpots({ w: 1280, h: 800, size: 88, max: 30, seed, avoid, pad: 8 });
    assert.ok(spots.length >= 8, 'seed ' + seed + ' gave only ' + spots.length);
    for (const p of spots) {
      // Centres and sizes come back rounded to whole pixels: allow that pixel.
      const box = { x: p.x - p.s / 2 + 1, y: p.y - p.s / 2 + 1, w: p.s - 2, h: p.s - 2 };
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= 1280 && box.y + box.h <= 800, 'off screen');
      for (const a of avoid) {
        assert.equal(P.overlaps(box, { x: a.x - 8, y: a.y - 8, w: a.w + 16, h: a.h + 16 }), false, 'on a kept area');
      }
      assert.ok(Math.abs(p.rot) <= 16, 'a gentle tilt');
    }
  }
});

test('stickers are peppered, not clumped: every quarter of a clear page gets some', () => {
  const spots = P.stickerSpots({ w: 1200, h: 800, size: 80, max: 30, seed: 9 });
  const quads = [0, 0, 0, 0];
  spots.forEach(p => { quads[(p.x < 600 ? 0 : 1) + (p.y < 400 ? 0 : 2)]++; });
  assert.ok(quads.every(n => n >= 3), quads.join(','));
});

test('stickers pop in one after another', () => {
  const spots = P.stickerSpots({ w: 1200, h: 800, size: 80, max: 20, seed: 3 });
  const delays = spots.map(p => p.delay).sort((a, b) => a - b);
  assert.equal(delays[0], 0);
  assert.equal(new Set(delays).size, delays.length);
});

test('nothing to place gives nothing, never an error', () => {
  assert.deepEqual(plain(P.stickerSpots({ w: 0, h: 800 })), []);
  assert.deepEqual(plain(P.stickerSpots({ w: 800, h: 600, max: 0 })), []);
  assert.deepEqual(plain(P.stickerSpots({ w: 800, h: 600, seed: 1, avoid: [{ x: 0, y: 0, w: 800, h: 600 }] })), []);
  assert.deepEqual(plain(P.stickerPicks(1, 0)), []);
});

test('the picks mix heroes and bosses, use every hero form, and always include Chung', () => {
  for (let seed = 1; seed < 30; seed++) {
    const picks = P.stickerPicks(seed, 26);
    const kinds = picks.map(p => p.kind);
    assert.equal(kinds.filter(k => k === 'chung').length, 1, 'Chung once');
    assert.ok(kinds.filter(k => k === 'hero').length >= 10);
    assert.ok(kinds.filter(k => k === 'boss').length >= 10);
    const forms = new Set(picks.filter(p => p.kind === 'hero').map(p => p.form));
    assert.equal(forms.size, Math.min(12, kinds.filter(k => k === 'hero').length), 'every form before any repeats');
    const bosses = picks.filter(p => p.kind === 'boss').map(p => p.index);
    assert.equal(new Set(bosses).size, bosses.length, 'no boss twice');
  }
});

test('every pick names a real sheet and a cell inside it', () => {
  const picks = P.stickerPicks(11, 40);
  for (const p of picks) {
    const file = new URL('../' + p.sheet, import.meta.url);
    assert.ok(fs.existsSync(file), p.sheet + ' exists');
    assert.ok(p.col >= 0 && p.col < p.cols && p.row >= 0 && p.row < p.rows, p.sheet + ' cell');
    if (p.kind === 'hero') { assert.equal(p.cols, 4); assert.equal(p.rows, 4); assert.match(p.sheet, /-genders-sheet\.png$/); }
    if (p.kind === 'boss') { assert.equal(p.cols, 5); assert.equal(p.rows, 2); assert.match(p.sheet, /bosses\/atlas-(0[1-9]|10)\.png$/); }
  }
  for (const form of P.HERO_FORMS) {
    assert.ok(fs.existsSync(new URL('../assets/battle-pixel/animations/' + form + '-genders-sheet.png', import.meta.url)), form);
  }
});

test('spriteStyle addresses the right cell of a grid', () => {
  assert.deepEqual(plain(P.spriteStyle({ sheet: 'a.png', cols: 4, rows: 4, col: 0, row: 0 })), { image: 'url("a.png")', size: '400% 400%', position: '0% 0%' });
  assert.equal(P.spriteStyle({ sheet: 'a.png', cols: 4, rows: 4, col: 3, row: 2 }).position, '100% 66.67%');
  assert.equal(P.spriteStyle({ sheet: 'b.png', cols: 5, rows: 2, col: 2, row: 1 }).position, '50% 100%');
  assert.equal(P.spriteStyle({ sheet: 'b.png', cols: 5, rows: 2, col: 4, row: 0 }).size, '500% 200%');
});

test('the date line reads like a person wrote it', () => {
  assert.equal(P.dateLine(new Date(2026, 9, 27)), 'Tuesday, 27 October');
  assert.equal(P.dateLine(new Date(2027, 0, 1)), 'Friday, 1 January');
});

test('esc escapes everything that could become markup', () => {
  assert.equal(P.esc('<img src=x onerror="a">&\''), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
});

test('the module never writes a teacher\'s words as markup', () => {
  // Every interpolation into the board and the form goes through esc().
  const board = src.slice(src.indexOf('function boardHtml'), src.indexOf('function formHtml'));
  const form = src.slice(src.indexOf('function formHtml'), src.indexOf('/* ---------------- stickers'));
  for (const part of [board, form]) {
    for (const m of part.matchAll(/'\s*\+\s*([^'+]+?)\s*\+\s*'/g)) {
      const expr = m[1].trim();
      if (/^esc\(|^i\b|^\(i|^LIMITS\.|^\(d\.items|^\(LIMITS|^i \+ 1|^rows$/.test(expr)) continue;
      assert.fail('unescaped interpolation: ' + expr);
    }
  }
  assert.match(src, /\.textContent = d\.cover/);
});

test('every action asks the teacher gate', () => {
  for (const fn of ['function open()', 'function enterGate()', 'function startEdit()', 'function formAction(', 'function save()']) {
    const at = src.indexOf(fn);
    assert.ok(at > 0, fn);
    assert.match(src.slice(at, at + 260), /teacher\(\)/, fn + ' asks teacher()');
  }
  assert.match(src, /function roleChanged\(\) \{ if \(s && !teacher\(\)\) close\(\); \}/);
});

test('keys pressed on the board never reach the worksheet', () => {
  assert.match(src, /\['keydown', 'keyup', 'keypress', 'paste', 'copy', 'cut'\]\.forEach/);
  assert.match(src, /e\.stopPropagation\(\);\s*\n\s*if \(t === 'keydown'\) key\(e\);/);
});

test('the gate closes all the way across, and the CSS timings match the script', () => {
  assert.match(css, /\.lsDoorL \{ left: 0; transform: translateX\(-102%\); \}/);
  assert.match(css, /\.lsDoorR \{ right: 0; transform: translateX\(102%\); \}/);
  assert.match(css, /\.lsGate\.lsShut \.lsDoorL, \.lsGate\.lsShut \.lsDoorR \{ transform: translateX\(0\); \}/);
  assert.match(css, /width: 50\.4%/, 'the two doors overlap a hair, so no light shows between them');
  const shut = css.match(/\.lsDoor \{[\s\S]*?transition: transform ([\d.]+)s/);
  assert.equal(Math.round(+shut[1] * 1000), P.GATE.shut);
  const open = css.match(/\.lsGate\.lsOpening \.lsDoor \{ transition: transform ([\d.]+)s/);
  assert.equal(Math.round(+open[1] * 1000), P.GATE.open);
  const shake = css.match(/animation: lsShake ([\d.]+)s/);
  assert.equal(Math.round(+shake[1] * 1000), P.GATE.shake);
});

test('the stickers look like stickers: die-cut outline, shadow, tilt', () => {
  const rule = css.match(/\.lsSticker \{[\s\S]*?\n\}/)[0];
  assert.match(rule, /drop-shadow\(3px 0 0 #fff\)/);
  assert.match(rule, /drop-shadow\(0 -3px 0 #fff\)/);
  assert.match(rule, /rgba\(20, 10, 40, 0\.38\)/);
  assert.match(rule, /rotate\(var\(--rot/);
});

test('reduced motion and print are handled', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media print \{ \.lsBack \{ display: none !important; \} \}/);
  assert.match(src, /if \(reduced\(\)\) \{\s*\n\s*showBoard\(\);/);
});

/* ------------------------------------------------------------------ glue */

const glue = html.slice(html.indexOf('/* ================= 🏰 Lesson start — glue'), html.indexOf('/* ================= End lesson start glue'));

test('index.html loads the feature once, in order', () => {
  assert.equal(html.split('<link rel="stylesheet" href="lesson-splash.css">').length, 2);
  assert.equal(html.split('<script src="lesson-splash.js"></script>').length, 2);
  assert.ok(html.indexOf('<script src="lesson-splash.js"></script>') < html.indexOf('<script>lsplashInit();</script>'));
  assert.match(html, /family=Press\+Start\+2P/);
  assert.ok(glue.length > 500, 'the glue section is there');
});

test('the button is the teacher\'s alone', () => {
  assert.match(html, /<button class="btn" id="lessonSplashBtn"[^>]*style="display:none">/);
  const vis = html.slice(html.indexOf('function applyRewardVisibility()'), html.indexOf('function applyRewardVisibility()') + 1600);
  assert.match(vis, /var show = isAdmin\(currentUser\) && !actingStudent && !isSharedVisitor\(\);/);
  assert.match(vis, /splashBtn\.style\.display = show \? '' : 'none'/);
  assert.match(vis, /lsplashRoleChanged\(\)/);
  assert.match(glue, /function lsplashTeacher\(\) \{\s*\n\s*return !!\(currentUser && isAdmin\(currentUser\) && !actingStudent && !isSharedVisitor\(\)\);/);
  assert.match(glue, /function lsplashOpen\(\) \{\s*\n\s*if \(!lsplashTeacher\(\)\) return;/);
  assert.match(glue, /function lsplashSave\(data\) \{\s*\n\s*if \(!lsplashTeacher\(\)\)/);
});

test('the rules are kept in the teacher\'s own record, merged, and on the device', () => {
  assert.match(glue, /aiEngineDocRef\(currentUser\)/);
  assert.match(glue, /ref\.set\(\{ lessonSplash: data \}, \{ merge: true \}\)/);
  assert.match(glue, /localStorage\.setItem\(lsplashLocalKey\(\)/);
  assert.match(glue, /LSPLASH_LOCAL \+ ':' \+/);
  // A late read for an account that has gone is dropped.
  assert.match(glue, /currentUser\.uid !== uid\) return null/);
  // The device copy is written BEFORE the account is asked.
  assert.ok(glue.indexOf('lsplashWriteLocal(data);') < glue.indexOf('ref.set({ lessonSplash'));
});

test('the version was bumped and the syntax check covers the file', () => {
  assert.match(html, /var APP_VERSION = 'v1\.16[6-9]\.\d+';|var APP_VERSION = 'v1\.1[7-9]\d\.\d+';|var APP_VERSION = 'v[2-9]\./);
  assert.match(fs.readFileSync(new URL('./check-syntax.mjs', import.meta.url), 'utf8'), /'lesson-splash\.js'/);
});
