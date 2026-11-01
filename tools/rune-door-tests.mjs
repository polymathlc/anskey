/* =====================================================================
   🚪 THE RUNE DOOR — the pure half, the film's contract and the glue
   ---------------------------------------------------------------------
     node --test tools/rune-door-tests.mjs

   What this proves without a browser: the one door into the switch's
   shape, when a device shows the door, that epochs only ever go up, the
   inscription's colours run teal → magenta like the logo, the rune
   alphabet, the seeded sparks and embers (a render must be the same every
   time), that rune-door.html is a well-formed HyperFrames composition
   whose clips last exactly as long as the film, that nothing in the CSS
   moves by itself (every motion is a GSAP tween, or the film and the app
   would disagree), and that index.html wires it the way CLAUDE.md says.
   The scene itself, the swing and the worksheet behind it are checked in
   Chromium by tools/rune-door-check.mjs.
   ===================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../rune-door.js', import.meta.url), 'utf8');
const CSS = fs.readFileSync(new URL('../rune-door.css', import.meta.url), 'utf8');
const FILM = fs.readFileSync(new URL('../rune-door.html', import.meta.url), 'utf8');
const PAGE = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function load() {
  const sandbox = { window: {}, Math, Date, JSON, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC.replace("var root = typeof window !== 'undefined' ? window : globalThis;", 'var root = window;'), sandbox);
  return sandbox.window.RuneDoor;
}
const RD = load();
const P = RD.pure;

/* ---------------------------------------------------------------- shape */
test('clean is the one door into the switch', () => {
  const empty = P.clean(null);
  assert.deepEqual({ ...empty }, { v: 1, on: false, epoch: 0, inscription: P.DEFAULT_INSCRIPTION, teacherUid: '', at: 0 });
  const c = P.clean({ on: true, epoch: 1730000000123.7, inscription: '  Polymath\n  Learning   Centre ', teacherUid: 'abc', at: 5, evil: '<script>' });
  assert.equal(c.on, true);
  assert.equal(c.epoch, 1730000000123);
  assert.equal(c.inscription, 'Polymath Learning Centre');
  assert.equal(c.teacherUid, 'abc');
  assert.equal('evil' in c, false, 'unknown fields are dropped');
  assert.equal(P.clean({ on: 'yes' }).on, false, 'only a real true switches it on');
  assert.equal(P.clean({ epoch: -4 }).epoch, 0);
  assert.equal(P.clean({ epoch: 'NaN' }).epoch, 0);
  assert.equal(P.clean({ inscription: 'x'.repeat(200) }).inscription.length, P.LIMITS.inscription);
  assert.equal(P.clean({ inscription: '   ' }).inscription, P.DEFAULT_INSCRIPTION, 'an empty inscription is the centre\'s name');
  assert.equal(P.clean({ inscription: 'a\u0000b' }).inscription, 'a b', 'control characters never reach the stone');
});

test('a device shows the door only when it is on and the epoch is new', () => {
  assert.equal(P.shouldShow({ on: true, epoch: 10 }, ''), true);
  assert.equal(P.shouldShow({ on: true, epoch: 10 }, '10'), false, 'already opened on this device');
  assert.equal(P.shouldShow({ on: true, epoch: 11 }, '10'), true, 'Show it again');
  assert.equal(P.shouldShow({ on: false, epoch: 11 }, ''), false, 'off is off');
  assert.equal(P.shouldShow({ on: true, epoch: 0 }, ''), false, 'no epoch, no door');
  assert.equal(P.shouldShow(null, null), false);
});

test('an epoch only ever goes up', () => {
  assert.equal(P.nextEpoch(0, 1000), 1000);
  assert.equal(P.nextEpoch(5000, 1000), 5001, 'a device whose clock is behind still moves it forward');
  assert.equal(P.nextEpoch(1000, 1000), 1001);
  assert.equal(P.nextEpoch(undefined, 7.9), 7);
});

/* -------------------------------------------------------------- colours */
test('the inscription lights teal to magenta, like the logo', () => {
  const cols = P.inscriptionColors('POLYMATH LEARNING CENTRE');
  assert.equal(cols.length, 24);
  assert.equal(cols[0].color, P.COLORS.teal);
  assert.equal(cols[cols.length - 1].color, P.COLORS.magenta);
  assert.equal(cols[8].ch, ' ');
  assert.equal(cols[8].color, '', 'a space has no colour of its own');
  assert.equal(P.mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(P.mix('#4fc3cf', '#e0218f', 0), '#4fc3cf');
  assert.equal(P.mix('#4fc3cf', '#e0218f', 9), '#e0218f', 'clamped');
});

test('the inscription fits the arch at any length', () => {
  const room = Math.PI * 141 * 0.86;
  for (const t of ['POLYMATH', 'POLYMATH LEARNING CENTRE', 'X'.repeat(40)]) {
    const size = P.inscriptionSize(t);
    assert.ok(size >= 9 && size <= 19, t + ' → ' + size);
    if (size > 9) assert.ok(t.length * size * 0.8 <= room + 1, t + ' overflows');
  }
});

/* ---------------------------------------------------------------- runes */
test('every letter has a rune, and a line of runes is centred', () => {
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    assert.ok(P.RUNES[ch] && P.RUNES[ch].length, 'no rune for ' + ch);
    for (const s of P.RUNES[ch]) {
      assert.equal(s.length, 4);
      s.forEach(v => assert.ok(v >= 0 && v <= 14, ch + ' leaves the grid'));
    }
    assert.match(P.runeGlyph(ch, 0, 0, 14), /^(M[\d.-]+,[\d.-]+L[\d.-]+,[\d.-]+)+$/);
  }
  assert.match(P.runeGlyph('7', 0, 0, 14), /Z$/, 'a letter with no rune is a small diamond');
  const line = P.runeLine('AB C', 200, 10, 14);
  assert.equal(line.glyphs.length, 3, 'a space is a gap, not a glyph');
  assert.equal(line.glyphs[2].i, 3);
  const xs = line.glyphs.flatMap(g => [...g.d.matchAll(/[ML]([\d.-]+),/g)].map(m => +m[1]));
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  assert.ok(Math.abs(mid - 200) < 4, 'centred on 200, got ' + mid);
});

/* ------------------------------------------------------ determinism */
test('sparks and embers are seeded: the same every render', () => {
  assert.deepEqual(P.sparkVectors(12, 7), P.sparkVectors(12, 7));
  assert.notDeepEqual(P.sparkVectors(12, 7), P.sparkVectors(12, 8));
  const sp = P.sparkVectors(28, 7);
  assert.equal(sp.length, 28);
  sp.forEach(v => { const d = Math.hypot(v.x, v.y); assert.ok(d >= 110 && d <= 290, 'spark distance ' + d); });
  const em = P.emberSpots(22, 11);
  assert.deepEqual(em, P.emberSpots(22, 11));
  em.forEach(e => {
    assert.ok(e.x >= 4 && e.x <= 96);
    assert.equal(Math.round(e.dur / P.TIMES.cycle * 1000) % 1000, 0, 'an ember lasts whole breaths, so the loop is clean');
  });
  const r = P.rng(42);
  const a = [r(), r(), r()];
  const r2 = P.rng(42);
  assert.deepEqual(a, [r2(), r2(), r2()]);
  a.forEach(v => assert.ok(v >= 0 && v < 1));
  assert.equal(/Math\.random/.test(SRC), false, 'nothing in the scene may use Math.random — a render must repeat');
});

/* ------------------------------------------------------------ geometry */
test('the doorway, the rune and the push-through agree', () => {
  const D = P.DOORWAY;
  assert.equal(D.left, 22.5); assert.equal(D.top, 18); assert.equal(D.width, 55); assert.equal(D.height, 76);
  // The CSS places the doorway and the rune from the same numbers.
  assert.match(CSS, /\.rdDoorway\s*\{[^}]*left:\s*22\.5%;[^}]*top:\s*18%;[^}]*width:\s*55%;[^}]*height:\s*76%/);
  const m = P.MEDAL;
  const left = (m.cx - m.size / 2) / P.VB.w * 100, top = (m.cy - m.size / 2) / P.VB.h * 100, width = m.size / P.VB.w * 100;
  assert.match(CSS, new RegExp('\\.rdRune\\s*\\{[^}]*left:\\s*' + left.toFixed(1) + '%;[^}]*top:\\s*' + top.toFixed(1) + '%;[^}]*width:\\s*' + width.toFixed(0) + '%'));
  assert.match(CSS, new RegExp('\\.rdSparks\\s*\\{[^}]*top:\\s*' + (m.cy / P.VB.h * 100).toFixed(1) + '%'), 'sparks fly from the rune\'s centre');
  // The push-through covers the screen whatever its shape.
  for (const [vw, vh] of [[1920, 1080], [390, 844], [1024, 768], [2560, 1080]]) {
    const w = Math.min(vw * 0.86, vh * 0.6), h = w * 1.25;
    const z = P.zoomScale(vw, vh, w, h);
    assert.ok(w * D.width / 100 * z >= vw && h * D.height / 100 * z >= vh, vw + '×' + vh + ' is not covered at ' + z);
  }
  assert.equal(P.zoomScale(0, 0, 0, 0), 4, 'a scene with no size still has a push');
  assert.match(P.archPath(), /^M90,470V200A110,110 0 0 1 310,200V470Z$/);
  assert.equal((P.starPath(8, 96, 56, 0).match(/L/g) || []).length, 15, 'eight points, sixteen corners');
  assert.equal(P.logoFaces(false).length, 8, 'two bars: a top, a front, a foot and the shadow in its fold');
  assert.ok(P.logoFaces(false).every(f => /^#[0-9a-f]{6}$/i.test(f.fill)));
});

/* ------------------------------------------------------- the logo */
/* Points read off the centre's own logo file (158 × 144 px) with the
   colour each one is there. The drawing is the file's, traced: every
   point must land on a face of that colour, with the faces painted in
   their order (the teal bar crosses OVER the magenta one). */
const LOGO_SAMPLES = [
  [60, 30, '#5b96a1'],  // the teal bar's top
  [120, 30, '#991e65'], // the magenta bar's top, behind it
  [96, 40, '#991e65'],  // magenta top where the teal bar has not crossed it
  [50, 75, '#7ebfca'],  // the teal front
  [84, 120, '#7ebfca'], // …down to its point at the middle
  [120, 80, '#c60085'], // the magenta front
  [88, 120, '#c60085'],
  [32, 116, '#5b96a1'], // the teal foot
  [42, 100, '#3a6a70'], // the shadow in its fold
  [140, 116, '#991e65'],// the magenta foot
  [126, 100, '#711648'],// the shadow in its fold
  [86, 40, null],       // the notch between the two tops
  [60, 118, null],      // the gap under the M
  [112, 118, null]
];
const toBox = (x, y) => [(x - 26) * 100 / 120, (y - 20) * 100 / 120 + 5.83];
function inside(px, py, d) {
  const pts = d.replace(/[MZ]/g, '').split('L').map(p => p.split(',').map(Number));
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
test('the logo is the centre\'s own: traced from its file, in its colours', () => {
  const faces = P.logoFaces(false);
  for (const [x, y, want] of LOGO_SAMPLES) {
    const [bx, by] = toBox(x, y);
    let got = null;
    faces.forEach(f => { if (inside(bx, by, f.d)) got = f.fill; });
    assert.equal(got, want, 'logo file pixel ' + x + ',' + y + ' is ' + want + ', the drawing has ' + got);
  }
  // The file's own colours, byte for byte, and nothing else.
  assert.deepEqual([...new Set(faces.map(f => f.fill))].sort(),
    ['#3a6a70', '#5b96a1', '#711648', '#7ebfca', '#991e65', '#c60085']);
  assert.equal(P.COLORS.teal, P.LOGO.tealFront, 'the door\'s teal is the logo\'s teal');
  assert.equal(P.COLORS.magenta, P.LOGO.magentaFront, 'the door\'s magenta is the logo\'s magenta');
  // The teal bar is painted after (over) the magenta bar's top.
  const order = faces.map(f => f.part);
  assert.ok(order.indexOf('tealTop') > order.indexOf('magentaTop'));
  // Lit, it is the same shape, brighter.
  P.logoFaces(true).forEach((f, i) => { assert.equal(f.d, faces[i].d); assert.notEqual(f.fill, faces[i].fill); });
});

/* ------------------------------------------------------- the materials */
test('a lit surface keeps its texture: the height never clips at 1', () => {
  // The bump is k2·noise + k3·edge. If that can pass 1 it clips, every
  // face goes flat and the noise shows only at the edges — which is how
  // the stone first rendered, as smooth plastic.
  for (const rough of [0, 0.35, 0.75, 1.2, 3]) {
    const f = P.reliefFilter('x', { rough });
    const k2 = +f.match(/k2="([\d.]+)" k3="([\d.]+)" result="bump"/)[1];
    const k3 = +f.match(/k2="([\d.]+)" k3="([\d.]+)" result="bump"/)[2];
    assert.ok(k2 + k3 < 1, 'rough ' + rough + ' clips: ' + k2 + ' + ' + k3);
  }
});

test('the right leaf is turned over INSIDE its filters, never round them', () => {
  // A lighting filter on a group with a negative scale renders black in
  // Chrome, and so does a CSS flip of the SVG — the right leaf went dark.
  const right = P.leafSvg('t-', 'right');
  const flips = [...right.matchAll(/<g transform="translate\(400,0\) scale\(-1,1\)">/g)].length;
  assert.ok(flips >= 6, 'the right leaf is mirrored piece by piece');
  // No filtered group sits inside a flip: every flip's contents are filter-free.
  const depthOk = (() => {
    let i = 0;
    while ((i = right.indexOf('<g transform="translate(400,0) scale(-1,1)">', i)) >= 0) {
      let depth = 0, j = i;
      do {
        const open = right.indexOf('<g', j + 1), close = right.indexOf('</g>', j + 1);
        if (open >= 0 && open < close) { depth++; j = open; } else { depth--; j = close; }
      } while (depth >= 0);
      if (/filter="url/.test(right.slice(i, j))) return false;
      i = j;
    }
    return true;
  })();
  assert.ok(depthOk, 'a filter inside a flipped group renders black');
  assert.equal(/rdMirror|scaleX\(-1\)/.test(SRC + CSS), false);
  assert.ok(!/scale\(-1,1\)/.test(P.leafSvg('t-', 'left')), 'the left leaf is drawn as it is');
});

/* ------------------------------------------------------- the film */
test('rune-door.html is a HyperFrames composition of the right length', () => {
  const id = (FILM.match(/data-composition-id="([^"]+)"/) || [])[1];
  assert.equal(id, RD.COMPOSITION_ID, 'the meta id is the key the timeline is registered under');
  assert.match(FILM, /<meta name="viewport" content="width=1920, height=1080"/);
  assert.match(FILM, /data-width="1920" data-height="1080"/);
  assert.match(SRC, /root\.__timelines\[COMPOSITION_ID\] = tl/, 'the film timeline is registered on window.__timelines');
  assert.match(SRC, /gsap\.timeline\(\{ paused: true \}\)/, 'HyperFrames needs a PAUSED timeline');
  const T = P.TIMES;
  const film = T.intro + T.filmIdle * T.cycle + T.end + T.filmTail;
  const clips = [...FILM.matchAll(/class="clip"[^>]*data-start="([\d.]+)" data-duration="([\d.]+)" data-track-index="(\d+)"/g)];
  assert.equal(clips.length, 2, 'the worksheet and the door');
  clips.forEach(c => {
    assert.equal(+c[1], 0);
    assert.ok(Math.abs(+c[2] - film) < 0.001, 'a clip lasts ' + c[2] + ', the film ' + film);
  });
  assert.deepEqual(clips.map(c => +c[3]), [0, 1], 'the worksheet behind, the door in front');
  assert.match(FILM, /<script src="vendor\/gsap\.min\.js"><\/script>/);
  assert.equal(/visibility\s*=\s*'hidden'|\.style\.visibility\s*=\s*'hidden'/.test(FILM + SRC), false, 'the framework owns visibility');
});

test('nothing in the CSS moves by itself: every motion is a GSAP tween', () => {
  const noComments = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/@keyframes/.test(noComments), false, 'a CSS animation would run on its own clock, not the film\'s');
  assert.equal(/(^|[;{\s])animation\s*:/.test(noComments), false);
  // The only transitions are the panel's switch — a control, not the scene.
  const trans = [...noComments.matchAll(/([^{}]+)\{[^}]*transition\s*:/g)].map(m => m[1].trim());
  trans.forEach(sel => assert.match(sel, /^\.rdSwitch/, 'a transition on ' + sel));
  // The resting states the timelines start from.
  assert.match(noComments, /\.rdSpark\s*\{[^}]*opacity:\s*0/);
  assert.match(noComments, /\.rdFlash\s*\{[^}]*opacity:\s*0/);
  assert.match(noComments, /\.rdLeaf\s*\{[^}]*filter:\s*brightness\(1\)/, 'the swing darkens from a filter GSAP can read');
  assert.match(noComments, /\.rdDoorway\s*\{[^}]*perspective:/, 'the leaves swing in 3D');
  assert.equal(/\.rdBeyond[^{]*\{[^}]*background\s*:/.test(noComments), false, 'nothing opaque behind the leaves: the worksheet must show');
});

test('the doorway is a hole in the wall, and the light beyond it is faint', () => {
  assert.match(SRC, /var wallHole = 'M' \+ \(-far\)[^\n]*\+ archPath\(\);/);
  assert.match(SRC, /class="rdWall" d="' \+ wallHole \+ '"[^>]*fill-rule="evenodd"/);
  assert.match(SRC, /class="rdVig" d="' \+ wallHole/, 'even the vignette leaves the worksheet alone');
  assert.match(SRC, /<rect class="rdGlow"[^>]*opacity="0"/, 'the glow starts invisible');
  assert.match(SRC, /s\.glow, \{ keyframes: \[\{ opacity: 0\.85[^\]]*\{ opacity: 0,/, 'and is gone before the scene is');
});

test('every SVG part that turns has its origin set before it moves', () => {
  assert.match(SRC, /gsap\.set\(\[s\.halo, s\.spin, s\.shock1, s\.shock2, s\.tap, s\.rays, s\.seam\], \{ transformOrigin: '50% 50%' \}\)/);
  assert.equal(/svgOrigin/.test(SRC), false, 'svgOrigin was measured from the wrong corner of a centred viewBox');
});

/* ------------------------------------------------------------ the module */
test('the module exposes what the glue and the film need', () => {
  for (const k of ['create', 'scene', 'introTimeline', 'idleTimeline', 'ambientTimeline', 'openTimeline', 'filmTimeline', 'composition']) {
    assert.equal(typeof RD[k], 'function', k);
  }
  assert.match(SRC, /function setOn\(on\) \{\s*if \(!teacher\(\)\) return/);
  assert.match(SRC, /function showAgain\(\) \{\s*if \(!teacher\(\)\) return/);
  assert.match(SRC, /function saveInscription\(text\) \{\s*if \(!teacher\(\)\) return/);
  assert.match(SRC, /function preview\(\) \{\s*if \(!teacher\(\)\) return/);
  assert.match(SRC, /function openPanel\(\) \{\s*if \(!teacher\(\)\) return/);
  assert.match(SRC, /function write\(patch\) \{\s*if \(!teacher\(\)\) return Promise\.reject/);
  assert.match(SRC, /if \(!door\.preview\) \{\s*try \{ if \(env\.writeSeen\) env\.writeSeen\(door\.epoch\)/, 'a preview never records an epoch');
  assert.match(SRC, /back\.addEventListener\('keydown', function \(e\) \{\s*e\.stopPropagation\(\);/, 'keys stop at the door');
});

/* ---------------------------------------------------------------- glue */
test('index.html wires the door the way CLAUDE.md says', () => {
  const s = PAGE.indexOf('🚪 Rune door — glue'), e = PAGE.indexOf('End rune door glue');
  assert.ok(s > 0 && e > s, 'the glue block');
  const glue = PAGE.slice(s, e);
  for (const fn of ['rdoorRole', 'rdoorRef', 'rdoorWho', 'rdoorSeenKey', 'rdoorReadSeen', 'rdoorWriteSeen', 'rdoorName', 'rdoorInit', 'rdoorOpen', 'rdoorRoleChanged']) {
    assert.match(glue, new RegExp('function ' + fn + '\\('), fn);
  }
  assert.match(glue, /if \(wheelTeacher\(\)\) return 'teacher';/);
  assert.match(glue, /db\.collection\('runeDoor'\)\.doc\('main'\)/);
  assert.match(glue, /if \(rdoorRole\(\) !== 'teacher'\) return;/, 'the button handler asks again');
  assert.match(PAGE, /id="runeDoorBtn"[^>]*style="display:none"/);
  assert.match(PAGE, /var doorBtn = \$\('runeDoorBtn'\);\s*if \(doorBtn\) doorBtn\.style\.display = show \? '' : 'none';/);
  assert.match(PAGE, /if \(typeof rdoorRoleChanged === 'function'\) rdoorRoleChanged\(\);/);
  assert.match(PAGE, /<script src="vendor\/gsap\.min\.js"><\/script>\s*<script src="rune-door\.js"><\/script>\s*<script>rdoorInit\(\);<\/script>/);
  assert.match(PAGE, /<link rel="stylesheet" href="rune-door\.css">/);
  assert.match(PAGE, /family=Cinzel/);
  const v = (PAGE.match(/var APP_VERSION = 'v(\d+)\.(\d+)\.(\d+)'/) || []).slice(1).map(Number);
  assert.ok(v[0] > 1 || v[1] >= 168, 'version bumped for the rune door');
});

test('GSAP is vendored, unchanged and licensed', () => {
  const g = fs.readFileSync(new URL('../vendor/gsap.min.js', import.meta.url), 'utf8');
  assert.match(g, /GSAP 3\.13\.0/);
  assert.ok(fs.existsSync(new URL('../vendor/gsap.LICENSE', import.meta.url)));
});
