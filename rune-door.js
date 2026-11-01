/* =====================================================================
   🚪 The rune door — a sealed medieval door the teacher can put in front
   of every student (v1.168.0)
   ---------------------------------------------------------------------
   The teacher ticks "Show the door to students". Every student's screen
   is covered by a heavy wooden door in a stone arch, torches flickering
   on either side and embers drifting up. Carved round the arch is the
   centre's name, POLYMATH LEARNING CENTRE, and set over the seam of the
   two leaves is a rune: a gold eight-pointed star round the Polymath
   logo. A touch on the rune lights it in the centre's own teal and
   magenta, the inscription lights letter by letter, the rune spins
   faster and faster, bursts into light, and the two leaves swing open
   INWARD — onto the worksheet that is really loaded behind the door,
   because the doorway is a hole in the scene, not a picture. The camera
   pushes through the doorway and the scene is gone.

   IT IS A HYPERFRAMES COMPOSITION. Every moving thing is a GSAP tween on
   one of three timelines (intro → idle → open), and `composition(root)`
   strings them into one paused, seekable timeline registered on
   `window.__timelines['rune-door']` — the HyperFrames contract. So
   rune-door.html is a real composition: `npx hyperframes preview
   rune-door.html` plays it and `npx hyperframes render rune-door.html`
   writes it as an MP4. The app plays the SAME scene and the SAME tweens
   live: the intro, then the idle loop until the touch, then the opening.
   Nothing moves by CSS animation, so a frame of the film and a frame of
   the app are the same frame, and a render is deterministic (the sparks
   and embers come from a seeded generator, never the browser's own dice).

   THE TEACHER DECIDES; THE STUDENT ONLY OPENS. The switch lives in
   `runeDoor/main` = {v, on, epoch, inscription, teacherUid, at}. Only the
   teacher's panel writes it (env.role() === 'teacher', asked in every
   handler: hiding a button has never been the lock in this app). A
   student's device listens, and shows the door when it is on and its
   `epoch` is not the one this device last opened. Turning it on, or
   🔁 Show it again, gives a new epoch, so every student meets it again.
   Turning it off takes a door that is still shut off every screen.

   PRESENTATION ONLY. It awards nothing, touches no hero, no worksheet
   and no annotation. The pure helpers sit on RuneDoor.pure so
   tools/rune-door-tests.mjs can run them without a page.
   ===================================================================== */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : globalThis;

  /* ------------------------------------------------------------------
     The drawing. One coordinate system, the stage's: 400 wide, 500 tall.
     The doorway is a round-topped opening; the voussoirs (the wedge
     stones of the arch) carry the inscription; the rune sits over the
     seam of the two leaves, in the upper half like a door knocker.
     ------------------------------------------------------------------ */
  var VB = { w: 400, h: 500 };
  var ARCH = { cx: 200, cy: 200, r: 110, left: 90, right: 310, top: 90, bottom: 470 };
  var SEAM = { x: 200, gap: 1.3 };
  var VOUSSOIR = { r0: 110, r1: 172, n: 13, key: 186 };
  var JAMB = { outer: 30, inner: 90, top: 200, bottom: 470 };
  var STEP = { y: 470, h: 22, left: 22, right: 378 };
  var INSCRIPTION_R = 141;
  var MEDAL = { cx: 200, cy: 238, size: 124 };
  var TORCH = { x: 10, y: 33, w: 7 };          // percent of the stage

  /* The doorway as a box in percent of the stage — what the leaves, the
     light beyond and the push-through are placed against. */
  var DOORWAY = {
    left: Math.round(ARCH.left / VB.w * 100 * 1000) / 1000,
    top: Math.round(ARCH.top / VB.h * 100 * 1000) / 1000,
    width: Math.round((ARCH.right - ARCH.left) / VB.w * 100 * 1000) / 1000,
    height: Math.round((ARCH.bottom - ARCH.top) / VB.h * 100 * 1000) / 1000
  };

  /* The centre's own colours, from the logo: the teal block and the
     magenta block. The gold is the door's brass. */
  var COLORS = {
    teal: '#4fc3cf',
    tealLight: '#8ad0d8',
    tealMid: '#5db4bf',
    tealDeep: '#3c9aa5',
    tealDark: '#2f7f89',
    magenta: '#e0218f',
    magentaLight: '#e46cb6',
    magentaMid: '#c8187f',
    magentaDeep: '#a8136b',
    magentaDark: '#8e0f5a',
    gold: '#f2c14e',
    goldDeep: '#b9822b',
    brass: '#d9a441',
    wood: '#4a3442',
    woodDark: '#2f202b',
    woodLight: '#6d4d5f',
    iron: '#2a2530',
    stone: '#5d5464',
    stoneLight: '#8a8093',
    stoneDark: '#3a3340',
    wall: '#221c27',
    ember: '#ffb347'
  };

  var DEFAULT_INSCRIPTION = 'POLYMATH LEARNING CENTRE';
  var LIMITS = { inscription: 40, uid: 128 };

  /* The film's timings in seconds. The open timeline is laid out from
     these, and the browser check reads the same numbers. */
  var TIMES = {
    intro: 1.6,          // the scene fades up, the rune lands
    cycle: 1.6,          // one breath of the idle loop
    press: 0.12,         // the rune dips under the finger
    ignite: 0.75,        // the rune lights: halo, logo, rim glyphs
    spinAt: 0.6,         // the spin starts…
    spin: 1.9,           // …and runs this long, faster and faster
    letters: 0.8,        // when the inscription starts lighting
    unlockAt: 2.5,       // the rune bursts into light
    unlock: 0.55,
    openAt: 2.65,        // the leaves start to swing
    open: 1.9,
    zoomAt: 3.7,         // the camera pushes through the doorway
    zoom: 1.5,
    end: 5.3,            // the scene is gone
    filmIdle: 2,         // idle breaths in the film before the touch
    filmTail: 0.6        // the worksheet held on screen after the end
  };

  var COMPOSITION_ID = 'rune-door';
  var SPARKS = 28;
  var EMBERS = 22;

  /* ------------------------------------------------------------------
     Pure helpers
     ------------------------------------------------------------------ */

  /* A seeded generator (mulberry32): the same seed gives the same sparks
     and embers in every frame of every render. */
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function cleanText(s, max) {
    return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  /* The one door into the shape kept in runeDoor/main. Anything else is
     dropped; an empty inscription is the centre's name. */
  function clean(d) {
    d = d && typeof d === 'object' ? d : {};
    var epoch = Number(d.epoch);
    var at = Number(d.at);
    var words = cleanText(d.inscription, LIMITS.inscription);
    return {
      v: 1,
      on: d.on === true,
      epoch: isFinite(epoch) && epoch > 0 ? Math.floor(epoch) : 0,
      inscription: words || DEFAULT_INSCRIPTION,
      teacherUid: cleanText(d.teacherUid, LIMITS.uid),
      at: isFinite(at) && at > 0 ? Math.floor(at) : 0
    };
  }

  /* Should this device show the door? On, a real epoch, and not the epoch
     this device already opened. */
  function shouldShow(d, seen) {
    var c = clean(d);
    return !!(c.on && c.epoch > 0 && String(c.epoch) !== String(seen == null ? '' : seen));
  }

  /* A new epoch is always later than the last one, even when this
     device's clock is behind the device that wrote the last. */
  function nextEpoch(prev, now) {
    var p = Number(prev) || 0;
    var n = Math.floor(Number(now) || 0);
    return n > p ? n : p + 1;
  }

  function hex(c) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(c || ''));
    var n = m ? parseInt(m[1], 16) : 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function toHex(rgb) {
    return '#' + rgb.map(function (v) {
      var s = clamp(Math.round(v), 0, 255).toString(16);
      return s.length < 2 ? '0' + s : s;
    }).join('');
  }

  /* A colour a fraction t of the way from a to b. */
  function mix(a, b, t) {
    var x = hex(a), y = hex(b), k = clamp(Number(t) || 0, 0, 1);
    return toHex([x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k]);
  }

  /* Each letter of the inscription lights in its own colour, teal at the
     start of the arch to magenta at its end — the logo, left to right.
     Spaces keep their place (so the colours follow the arch) but have no
     colour of their own. */
  function inscriptionColors(text) {
    var chars = String(text || '').split('');
    var n = chars.length;
    return chars.map(function (ch, i) {
      return { ch: ch, color: ch === ' ' ? '' : mix(COLORS.teal, COLORS.magenta, n > 1 ? i / (n - 1) : 0) };
    });
  }

  /* The arch the words are carved on is half a circle; the words take the
     middle 86% of it. Cinzel's capitals are about 0.8 of their size wide. */
  function inscriptionSize(text) {
    var n = Math.max(1, String(text || '').length);
    var room = Math.PI * INSCRIPTION_R * 0.86;
    return Math.round(clamp(room / (n * 0.8), 9, 19) * 10) / 10;
  }

  /* How far the stage must grow for the doorway to cover the screen: the
     camera pushes through the opening until nothing else is visible. */
  function zoomScale(vw, vh, stageW, stageH) {
    var dw = stageW * DOORWAY.width / 100;
    var dh = stageH * DOORWAY.height / 100;
    if (!(dw > 0 && dh > 0 && vw > 0 && vh > 0)) return 4;
    return Math.round(Math.max(vw / dw, vh / dh) * 1.18 * 1000) / 1000;
  }

  /* Where each spark flies when the rune spins: evenly round the circle
     with a little jitter, further for some than others. */
  function sparkVectors(n, seed) {
    var r = rng(seed || 7);
    var out = [];
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.5;
      var d = 120 + r() * 160;
      out.push({ x: Math.round(Math.cos(a) * d), y: Math.round(Math.sin(a) * d), s: 0.5 + r() * 0.9, delay: Math.round(r() * 40) / 100, teal: i % 2 === 0 });
    }
    return out;
  }

  /* Where each ember starts (percent across the screen) and how it drifts.
     Durations are whole halves of an idle breath, so the film loops clean. */
  function emberSpots(n, seed) {
    var r = rng(seed || 11);
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push({
        x: Math.round((4 + r() * 92) * 10) / 10,
        size: Math.round((2 + r() * 4) * 10) / 10,
        drift: Math.round((r() - 0.5) * 80),
        dur: TIMES.cycle * (1 + Math.floor(r() * 3)),
        delay: Math.round(r() * TIMES.cycle * 100) / 100,
        hot: r() > 0.6
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------
     The runes. A small carved alphabet, one set of straight strokes per
     letter on an 8 × 14 grid — Elder Futhark in spirit, every stroke a
     line a chisel could cut. Used round the rim of the medallion and
     along the threshold step.
     ------------------------------------------------------------------ */
  var RUNES = {
    A: [[1, 0, 1, 14], [1, 0, 7, 4], [1, 5, 7, 9]],
    B: [[1, 0, 1, 14], [1, 0, 7, 3.5], [7, 3.5, 1, 7], [1, 7, 7, 10.5], [7, 10.5, 1, 14]],
    C: [[7, 0, 1, 7], [1, 7, 7, 14]],
    D: [[1, 0, 1, 14], [7, 0, 7, 14], [1, 0, 7, 14], [7, 0, 1, 14]],
    E: [[1, 0, 1, 14], [7, 0, 7, 14], [1, 0, 4, 4], [4, 4, 7, 0]],
    F: [[1, 0, 1, 14], [1, 4, 7, 0], [1, 8, 7, 4]],
    G: [[1, 0, 7, 14], [7, 0, 1, 14]],
    H: [[1, 0, 1, 14], [7, 0, 7, 14], [1, 5, 7, 9]],
    I: [[4, 0, 4, 14]],
    J: [[4, 0, 4, 14], [1, 4, 4, 7], [7, 7, 4, 10]],
    K: [[1, 0, 1, 14], [1, 7, 7, 0], [1, 7, 7, 14]],
    L: [[1, 0, 1, 14], [1, 0, 7, 4]],
    M: [[1, 0, 1, 14], [7, 0, 7, 14], [1, 0, 7, 6], [7, 0, 1, 6]],
    N: [[4, 0, 4, 14], [1, 5, 7, 9]],
    O: [[4, 0, 7, 4], [4, 0, 1, 4], [1, 4, 7, 11], [7, 4, 1, 11], [1, 11, 0, 14], [7, 11, 8, 14]],
    P: [[1, 0, 1, 14], [1, 0, 6, 3], [6, 3, 6, 5], [1, 14, 6, 11], [6, 11, 6, 9]],
    Q: [[4, 0, 4, 14], [4, 9, 7, 14], [1, 4, 4, 7]],
    R: [[1, 0, 1, 14], [1, 0, 7, 3.5], [7, 3.5, 1, 7], [1, 7, 7, 14]],
    S: [[6, 0, 2, 6], [2, 6, 6, 8], [6, 8, 2, 14]],
    T: [[4, 0, 4, 14], [4, 0, 0, 4], [4, 0, 8, 4]],
    U: [[1, 0, 1, 14], [1, 0, 7, 4], [7, 4, 7, 14]],
    V: [[1, 0, 4, 14], [4, 14, 7, 0]],
    W: [[1, 0, 1, 14], [1, 0, 6, 3], [6, 3, 1, 6]],
    X: [[1, 0, 7, 14], [7, 0, 1, 14], [4, 0, 4, 14]],
    Y: [[4, 4, 4, 14], [1, 0, 4, 4], [7, 0, 4, 4]],
    Z: [[4, 0, 4, 14], [1, 4, 4, 0], [7, 4, 4, 0], [1, 14, 4, 10], [7, 14, 4, 10]]
  };
  var RUNE_W = 8, RUNE_H = 14, RUNE_GAP = 4;

  function round1(v) { return Math.round(v * 10) / 10; }

  /* The strokes of one letter as an SVG path, at (x, y) with height h.
     A letter with no rune (a digit, a stop) is a small diamond, so the
     line never has a hole in it. */
  function runeGlyph(ch, x, y, h) {
    var k = h / RUNE_H;
    var strokes = RUNES[String(ch || '').toUpperCase()];
    if (!strokes) {
      var cx = x + RUNE_W * k / 2, cy = y + h / 2, s = 1.6 * k;
      return 'M' + round1(cx) + ',' + round1(cy - s) + 'L' + round1(cx + s) + ',' + round1(cy) +
        'L' + round1(cx) + ',' + round1(cy + s) + 'L' + round1(cx - s) + ',' + round1(cy) + 'Z';
    }
    return strokes.map(function (s) {
      return 'M' + round1(x + s[0] * k) + ',' + round1(y + s[1] * k) + 'L' + round1(x + s[2] * k) + ',' + round1(y + s[3] * k);
    }).join('');
  }

  /* A line of runes centred on cx. Spaces are a gap; every letter is a
     separate entry so each can light on its own. */
  function runeLine(text, cx, y, h) {
    var k = h / RUNE_H;
    var chars = String(text || '').toUpperCase().split('');
    var step = (RUNE_W + RUNE_GAP) * k;
    var width = chars.length * step - RUNE_GAP * k;
    var x = cx - width / 2;
    var glyphs = [];
    chars.forEach(function (ch, i) {
      if (ch !== ' ') glyphs.push({ ch: ch, i: i, d: runeGlyph(ch, x + i * step, y, h) });
    });
    return { width: round1(width), glyphs: glyphs };
  }

  /* ------------------------------------------------------------------
     SVG building blocks
     ------------------------------------------------------------------ */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pt(cx, cy, r, deg) {
    var a = deg * Math.PI / 180;
    return [round1(cx + r * Math.cos(a)), round1(cy - r * Math.sin(a))];
  }

  /* The doorway's outline, used for the hole in the wall and for the
     light beyond it. */
  function archPath() {
    return 'M' + ARCH.left + ',' + ARCH.bottom + 'V' + ARCH.cy +
      'A' + ARCH.r + ',' + ARCH.r + ' 0 0 1 ' + ARCH.right + ',' + ARCH.cy +
      'V' + ARCH.bottom + 'Z';
  }

  /* One wedge stone of the arch, between two angles (degrees, 180 → 0). */
  function voussoirPath(a0, a1, r0, r1) {
    var p0 = pt(ARCH.cx, ARCH.cy, r0, a0), p1 = pt(ARCH.cx, ARCH.cy, r1, a0);
    var p2 = pt(ARCH.cx, ARCH.cy, r1, a1), p3 = pt(ARCH.cx, ARCH.cy, r0, a1);
    return 'M' + p0 + 'L' + p1 + 'A' + r1 + ',' + r1 + ' 0 0 1 ' + p2 + 'L' + p3 +
      'A' + r0 + ',' + r0 + ' 0 0 0 ' + p0 + 'Z';
  }

  /* An eight-pointed star, the rune's brass setting. */
  function starPath(points, outer, inner, turn) {
    var d = '';
    for (var i = 0; i < points * 2; i++) {
      var r = i % 2 === 0 ? outer : inner;
      var a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2 + (turn || 0);
      d += (i ? 'L' : 'M') + round1(Math.cos(a) * r) + ',' + round1(Math.sin(a) * r);
    }
    return d + 'Z';
  }

  /* The Polymath logo: two isometric blocks making an M, teal on the left
     and magenta on the right, each with a lit top, a front face, an inner
     face and a dark foot. Drawn in a 100 × 100 box. `lit` brightens every
     face for the moment the rune catches fire. */
  function logoFaces(lit) {
    var c = function (a, b) { return lit ? mix(a, '#ffffff', 0.28) : a; };
    return [
      { d: 'M8,28L30,16L50,28L30,40Z', fill: c(COLORS.tealLight) },
      { d: 'M8,28L30,40L30,84L8,72Z', fill: c(COLORS.tealMid) },
      { d: 'M30,40L50,52L50,70L30,58Z', fill: c(COLORS.tealDeep) },
      { d: 'M8,72L30,84L8,92Z', fill: c(COLORS.tealDark) },
      { d: 'M50,28L70,16L92,28L70,40Z', fill: c(COLORS.magentaLight) },
      { d: 'M70,40L92,28L92,72L70,84Z', fill: c(COLORS.magentaMid) },
      { d: 'M50,52L70,40L70,58L50,70Z', fill: c(COLORS.magentaDeep) },
      { d: 'M92,72L70,84L92,92Z', fill: c(COLORS.magentaDark) }
    ];
  }

  function logoSvg(lit, cls) {
    return '<g class="' + cls + '">' + logoFaces(lit).map(function (f) {
      return '<path d="' + f.d + '" fill="' + f.fill + '"/>';
    }).join('') + '</g>';
  }

  /* ---- the wall, the floor, the stone frame and the inscription ---- */
  function frameSvg(id, inscription) {
    var far = 4000;
    var wallHole = 'M' + (-far) + ',' + (-far) + 'H' + (VB.w + far) + 'V' + (VB.h + far) + 'H' + (-far) + 'Z' + archPath();
    var parts = [];
    parts.push('<svg class="rdFrame" viewBox="0 0 ' + VB.w + ' ' + VB.h + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">');
    parts.push('<defs>' +
      // Stone bricks of the dungeon wall.
      '<pattern id="' + id + 'bricks" width="64" height="32" patternUnits="userSpaceOnUse">' +
      '<rect width="64" height="32" fill="' + COLORS.wall + '"/>' +
      '<rect x="1" y="1" width="30" height="14" rx="2" fill="#2b2431"/><rect x="33" y="1" width="30" height="14" rx="2" fill="#29222f"/>' +
      '<rect x="-15" y="17" width="30" height="14" rx="2" fill="#2a2330"/><rect x="17" y="17" width="30" height="14" rx="2" fill="#2c2532"/><rect x="49" y="17" width="30" height="14" rx="2" fill="#2a2330"/>' +
      '<path d="M2,2H30M34,2H62M18,18H46" stroke="#3a3242" stroke-width="1" opacity=".7"/></pattern>' +
      // Flagstones on the floor.
      '<pattern id="' + id + 'flags" width="56" height="26" patternUnits="userSpaceOnUse">' +
      '<rect width="56" height="26" fill="#1d1820"/><rect x="1" y="1" width="54" height="11" rx="2" fill="#2e2733"/>' +
      '<rect x="-27" y="14" width="54" height="11" rx="2" fill="#2b2430"/><rect x="29" y="14" width="54" height="11" rx="2" fill="#2c2531"/></pattern>' +
      // Shadow towards the edges, so the eye goes to the door.
      '<radialGradient id="' + id + 'vig" gradientUnits="userSpaceOnUse" cx="200" cy="270" r="430">' +
      '<stop offset="0.35" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".88"/></radialGradient>' +
      // Warm light the torches throw on the stone.
      '<radialGradient id="' + id + 'warm" gradientUnits="userSpaceOnUse" cx="200" cy="240" r="250">' +
      '<stop offset="0" stop-color="#ffb347" stop-opacity=".34"/><stop offset=".6" stop-color="#ff8c2a" stop-opacity=".1"/><stop offset="1" stop-color="#ff8c2a" stop-opacity="0"/></radialGradient>' +
      // The centre's colours on the stone, for the moment the door opens.
      '<radialGradient id="' + id + 'magic" gradientUnits="userSpaceOnUse" cx="200" cy="260" r="300">' +
      '<stop offset="0" stop-color="#fff2c4" stop-opacity=".55"/><stop offset=".45" stop-color="' + COLORS.teal + '" stop-opacity=".22"/><stop offset="1" stop-color="' + COLORS.magenta + '" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="' + id + 'stone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + COLORS.stoneLight + '"/><stop offset=".55" stop-color="' + COLORS.stone + '"/><stop offset="1" stop-color="' + COLORS.stoneDark + '"/></linearGradient>' +
      '<linearGradient id="' + id + 'step" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7d7387"/><stop offset="1" stop-color="#3a3340"/></linearGradient>' +
      '<filter id="' + id + 'glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '<path id="' + id + 'arc" d="M' + (ARCH.cx - INSCRIPTION_R) + ',' + ARCH.cy + 'A' + INSCRIPTION_R + ',' + INSCRIPTION_R + ' 0 0 1 ' + (ARCH.cx + INSCRIPTION_R) + ',' + ARCH.cy + '"/>' +
      '</defs>');

    // The wall: everything except the doorway. The worksheet shows through the hole.
    parts.push('<path class="rdWall" d="' + wallHole + '" fill="url(#' + id + 'bricks)" fill-rule="evenodd"/>');
    parts.push('<path class="rdFloor" d="M' + (-far) + ',' + (STEP.y + STEP.h - 2) + 'H' + (VB.w + far) + 'V' + (VB.h + far) + 'H' + (-far) + 'Z" fill="url(#' + id + 'flags)"/>');
    parts.push('<path class="rdWarm" d="' + wallHole + '" fill="url(#' + id + 'warm)" fill-rule="evenodd"/>');
    parts.push('<path class="rdMagic" d="' + wallHole + '" fill="url(#' + id + 'magic)" fill-rule="evenodd" opacity="0"/>');

    // The jambs: stacked blocks either side of the doorway.
    var rows = [[200, 246], [246, 286], [286, 334], [334, 376], [376, 424], [424, 470]];
    [0, 1].forEach(function (side) {
      rows.forEach(function (row, i) {
        var wide = (i + side) % 2 === 0;
        var x0 = side ? ARCH.right : JAMB.outer - (wide ? 6 : 0);
        var x1 = side ? VB.w - JAMB.outer + (wide ? 6 : 0) : ARCH.left;
        parts.push('<rect class="rdBlock" x="' + (x0 + 1) + '" y="' + (row[0] + 1) + '" width="' + (x1 - x0 - 2) + '" height="' + (row[1] - row[0] - 2) + '" rx="3" fill="url(#' + id + 'stone)" stroke="#2a2430" stroke-width="1.4"/>');
        parts.push('<path d="M' + (x0 + 4) + ',' + (row[0] + 3.5) + 'H' + (x1 - 4) + '" stroke="#a79fb0" stroke-width="1.2" opacity=".5"/>');
        if ((i * 7 + side * 3) % 5 === 1) {
          var cx = (x0 + x1) / 2;
          parts.push('<path d="M' + (cx - 6) + ',' + (row[0] + 8) + 'l5,7l-3,6l6,8" fill="none" stroke="#2a2430" stroke-width="1" opacity=".6"/>');
        }
      });
    });

    // The voussoirs, the keystone proud at the top.
    var n = VOUSSOIR.n;
    for (var i = 0; i < n; i++) {
      var a0 = 180 - (i / n) * 180, a1 = 180 - ((i + 1) / n) * 180;
      var key = i === Math.floor(n / 2);
      parts.push('<path class="rdBlock' + (key ? ' rdKey' : '') + '" d="' + voussoirPath(a0 - 0.4, a1 + 0.4, VOUSSOIR.r0, key ? VOUSSOIR.key : VOUSSOIR.r1) + '" fill="url(#' + id + 'stone)" stroke="#2a2430" stroke-width="1.4"/>');
    }
    // A carved emblem on the keystone: the logo, small, in the stone.
    parts.push('<g transform="translate(' + (ARCH.cx - 9) + ',' + (ARCH.cy - VOUSSOIR.key + 2) + ') scale(.18)" opacity=".85">' + logoSvg(false, 'rdKeyLogo') + '</g>');

    // The threshold step.
    parts.push('<rect class="rdStep" x="' + STEP.left + '" y="' + STEP.y + '" width="' + (STEP.right - STEP.left) + '" height="' + STEP.h + '" rx="3" fill="url(#' + id + 'step)" stroke="#221c27" stroke-width="1.5"/>');

    // The inscription round the arch: a carved shadow, a highlight, and a
    // lit copy whose letters start at nothing and light one by one.
    var size = inscriptionSize(inscription);
    var letters = inscriptionColors(inscription);
    var tspans = function (cls, fillFn) {
      return letters.map(function (l, i) {
        return '<tspan class="' + cls + '" data-i="' + i + '"' + (fillFn ? ' fill-opacity="0"' : '') + (fillFn ? ' fill="' + fillFn(l) + '"' : '') + '>' + (l.ch === ' ' ? ' ' : esc(l.ch)) + '</tspan>';
      }).join('');
    };
    var textAttrs = ' font-size="' + size + '" text-anchor="middle" letter-spacing="' + round1(size * 0.08) + '"';
    parts.push('<text class="rdCarveHi"' + textAttrs + ' transform="translate(0,1)"><textPath href="#' + id + 'arc" startOffset="50%">' + esc(inscription) + '</textPath></text>');
    parts.push('<text class="rdCarve"' + textAttrs + '><textPath href="#' + id + 'arc" startOffset="50%">' + esc(inscription) + '</textPath></text>');
    parts.push('<text class="rdLit"' + textAttrs + ' filter="url(#' + id + 'glow)"><textPath href="#' + id + 'arc" startOffset="50%">' +
      tspans('rdLetter', function (l) { return l.color || 'transparent'; }) + '</textPath></text>');

    // Runes along the threshold step: the same words, in the old letters.
    var line = runeLine(inscription.replace(/[^A-Za-z ]/g, ''), ARCH.cx, STEP.y + 5, 11);
    parts.push('<g class="rdStepRunes">' + line.glyphs.map(function (g) {
      return '<path class="rdStepRune" data-i="' + g.i + '" d="' + g.d + '"/>';
    }).join('') + '</g>');

    parts.push('<path class="rdVig" d="' + wallHole + '" fill="url(#' + id + 'vig)" fill-rule="evenodd"/>');
    parts.push('</svg>');
    return parts.join('');
  }

  /* ---- a leaf of the door ----
     Drawn once, as the LEFT leaf, in stage coordinates (x 90 → 200). The
     right leaf is the same drawing mirrored about the seam, so the two
     can never disagree about where a strap or a rivet is. */
  function leafSvg(id, side) {
    var mirror = side === 'right';
    var x0 = ARCH.left, x1 = SEAM.x - SEAM.gap;
    var vb = mirror ? (SEAM.x + SEAM.gap) + ' ' + ARCH.top + ' ' + (ARCH.right - SEAM.x - SEAM.gap) : x0 + ' ' + ARCH.top + ' ' + (x1 - x0);
    var shape = 'M' + x0 + ',' + ARCH.bottom + 'V' + ARCH.cy + 'A' + ARCH.r + ',' + ARCH.r + ' 0 0 1 ' + SEAM.x + ',' + ARCH.top + 'L' + x1 + ',' + ARCH.top + 'V' + ARCH.bottom + 'Z';
    var cid = id + side;
    var p = [];
    p.push('<svg class="rdLeafArt" viewBox="' + vb + ' ' + (ARCH.bottom - ARCH.top) + '" preserveAspectRatio="none" aria-hidden="true">');
    p.push('<defs><clipPath id="' + cid + 'clip"><path d="' + shape + '"/></clipPath>' +
      '<linearGradient id="' + cid + 'plank" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="' + COLORS.woodDark + '"/><stop offset=".25" stop-color="' + COLORS.wood + '"/><stop offset=".7" stop-color="' + COLORS.woodLight + '"/><stop offset="1" stop-color="' + COLORS.wood + '"/></linearGradient>' +
      '<linearGradient id="' + cid + 'iron" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a5262"/><stop offset=".45" stop-color="' + COLORS.iron + '"/><stop offset="1" stop-color="#141117"/></linearGradient>' +
      '<linearGradient id="' + cid + 'brass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="' + COLORS.goldDeep + '"/><stop offset=".5" stop-color="' + COLORS.gold + '"/><stop offset="1" stop-color="' + COLORS.goldDeep + '"/></linearGradient>' +
      '<linearGradient id="' + cid + 'shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset=".2" stop-color="#000" stop-opacity="0"/><stop offset=".85" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient>' +
      '</defs>');
    p.push('<g' + (mirror ? ' transform="translate(' + (SEAM.x * 2) + ',0) scale(-1,1)"' : '') + '>');
    p.push('<g clip-path="url(#' + cid + 'clip)">');
    // Three planks, each its own grain.
    var plankW = (x1 - x0) / 3;
    var grain = rng(side === 'right' ? 31 : 17);
    for (var k = 0; k < 3; k++) {
      var px = x0 + k * plankW;
      p.push('<rect x="' + round1(px) + '" y="' + ARCH.top + '" width="' + round1(plankW) + '" height="' + (ARCH.bottom - ARCH.top) + '" fill="url(#' + cid + 'plank)"/>');
      for (var g = 0; g < 5; g++) {
        var gx = px + 4 + grain() * (plankW - 8);
        var wob = 2 + grain() * 3;
        p.push('<path d="M' + round1(gx) + ',' + ARCH.top + 'C' + round1(gx + wob) + ',' + 180 + ' ' + round1(gx - wob) + ',' + 320 + ' ' + round1(gx + wob * 0.6) + ',' + ARCH.bottom + '" fill="none" stroke="#1d141b" stroke-width=".7" opacity=".45"/>');
      }
      if (grain() > 0.35) {
        var ky = 250 + grain() * 180, kx = px + plankW / 2 + (grain() - 0.5) * 10;
        p.push('<ellipse cx="' + round1(kx) + '" cy="' + round1(ky) + '" rx="3.2" ry="5.5" fill="#24181f" opacity=".7"/><ellipse cx="' + round1(kx) + '" cy="' + round1(ky) + '" rx="5.8" ry="9" fill="none" stroke="#24181f" stroke-width=".6" opacity=".5"/>');
      }
      p.push('<path d="M' + round1(px + plankW) + ',' + ARCH.top + 'V' + ARCH.bottom + '" stroke="#140d12" stroke-width="1.6"/>');
    }
    // Shading: dark at the hinge, lit at the seam.
    p.push('<rect x="' + x0 + '" y="' + ARCH.top + '" width="' + (x1 - x0) + '" height="' + (ARCH.bottom - ARCH.top) + '" fill="url(#' + cid + 'shade)"/>');
    // Iron straps with rivets and a curled hinge at the outer edge.
    [178, 306, 424].forEach(function (y) {
      p.push('<rect x="' + x0 + '" y="' + y + '" width="' + (x1 - x0) + '" height="15" fill="url(#' + cid + 'iron)"/>');
      p.push('<path d="M' + x0 + ',' + (y + 7.5) + 'h-2 m2,0 c22,0 30,-10 38,-16 m-38,16 c22,0 30,10 38,16" fill="none" stroke="#4a4352" stroke-width="3" stroke-linecap="round"/>');
      for (var rx = x0 + 9; rx < x1 - 4; rx += 17) {
        p.push('<circle cx="' + round1(rx) + '" cy="' + (y + 7.5) + '" r="2.4" fill="#6b6375"/><circle cx="' + round1(rx - 0.7) + '" cy="' + (y + 6.8) + '" r=".9" fill="#b7aec0"/>');
      }
    });
    p.push('</g>');
    // Brass trim down the seam, like the reference's glowing post.
    p.push('<rect x="' + (x1 - 6) + '" y="' + (ARCH.top + 2) + '" width="6" height="' + (ARCH.bottom - ARCH.top - 2) + '" fill="url(#' + cid + 'brass)" opacity=".9"/>');
    // An iron ring pull.
    p.push('<circle cx="' + (x1 - 20) + '" cy="368" r="4" fill="#3a3342"/><circle cx="' + (x1 - 20) + '" cy="380" r="9" fill="none" stroke="#5a5262" stroke-width="3"/>');
    p.push('<path d="' + shape + '" fill="none" stroke="#120c11" stroke-width="2.5"/>');
    p.push('</g></svg>');
    return p.join('');
  }

  /* ---- the light beyond the door: a seam of light while it is shut,
     and a glow and rays as it opens. Faint, so the worksheet behind it is
     what the eye finds. ---- */
  function beyondSvg(id) {
    var w = ARCH.right - ARCH.left, h = ARCH.bottom - ARCH.top;
    var p = [];
    p.push('<svg class="rdBeyondArt" viewBox="' + ARCH.left + ' ' + ARCH.top + ' ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">');
    p.push('<defs><clipPath id="' + id + 'hole"><path d="' + archPath() + '"/></clipPath>' +
      '<radialGradient id="' + id + 'beyond" gradientUnits="userSpaceOnUse" cx="200" cy="300" r="220">' +
      '<stop offset="0" stop-color="#fff6d6" stop-opacity=".95"/><stop offset=".35" stop-color="#ffe08a" stop-opacity=".55"/>' +
      '<stop offset=".7" stop-color="' + COLORS.teal + '" stop-opacity=".22"/><stop offset="1" stop-color="' + COLORS.magenta + '" stop-opacity=".12"/></radialGradient>' +
      '<linearGradient id="' + id + 'seam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffcf6b" stop-opacity="0"/><stop offset=".5" stop-color="#fff2c0"/><stop offset="1" stop-color="#ffcf6b" stop-opacity="0"/></linearGradient>' +
      '</defs>');
    p.push('<g clip-path="url(#' + id + 'hole)">');
    p.push('<rect class="rdGlow" x="' + ARCH.left + '" y="' + ARCH.top + '" width="' + w + '" height="' + h + '" fill="url(#' + id + 'beyond)" opacity="0"/>');
    p.push('<g class="rdRays" opacity="0">');
    for (var i = 0; i < 16; i++) {
      var a = i / 16 * Math.PI * 2;
      var x2 = 200 + Math.cos(a) * 420, y2 = 300 + Math.sin(a) * 420;
      var x3 = 200 + Math.cos(a + 0.09) * 420, y3 = 300 + Math.sin(a + 0.09) * 420;
      p.push('<path d="M200,300L' + round1(x2) + ',' + round1(y2) + 'L' + round1(x3) + ',' + round1(y3) + 'Z" fill="' + (i % 2 ? COLORS.teal : '#fff1b8') + '" opacity="' + (i % 2 ? '.35' : '.55') + '"/>');
    }
    p.push('</g>');
    p.push('<rect class="rdSeam" x="' + (SEAM.x - 5) + '" y="' + ARCH.top + '" width="10" height="' + h + '" fill="url(#' + id + 'seam)"/>');
    p.push('</g></svg>');
    return p.join('');
  }

  /* ---- the rune: the brass star, the rim of glyphs, the logo ---- */
  function runeSvg(id) {
    var p = [];
    p.push('<svg class="rdRuneArt" viewBox="-100 -100 200 200" aria-hidden="true">');
    p.push('<defs>' +
      '<radialGradient id="' + id + 'halo"><stop offset=".35" stop-color="#ffffff" stop-opacity=".9"/><stop offset=".55" stop-color="' + COLORS.teal + '" stop-opacity=".7"/><stop offset=".8" stop-color="' + COLORS.magenta + '" stop-opacity=".35"/><stop offset="1" stop-color="' + COLORS.magenta + '" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="' + id + 'soft"><stop offset=".5" stop-color="#ffd27a" stop-opacity=".55"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="' + id + 'gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe9a8"/><stop offset=".4" stop-color="' + COLORS.gold + '"/><stop offset="1" stop-color="' + COLORS.goldDeep + '"/></linearGradient>' +
      '<linearGradient id="' + id + 'gold2" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe39a"/><stop offset="1" stop-color="#8f5f1e"/></linearGradient>' +
      '<radialGradient id="' + id + 'slate" cx=".4" cy=".35"><stop offset="0" stop-color="#4b4556"/><stop offset="1" stop-color="#17141b"/></radialGradient>' +
      '<filter id="' + id + 'blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>' +
      '</defs>');
    // Behind: the soft idle glow, and the teal/magenta halo that wakes.
    p.push('<circle class="rdSoft" r="98" fill="url(#' + id + 'soft)" opacity=".3"/>');
    p.push('<g class="rdHalo" opacity="0"><circle r="99" fill="url(#' + id + 'halo)"/>' +
      '<circle r="86" fill="none" stroke="' + COLORS.teal + '" stroke-width="5" stroke-dasharray="40 22" opacity=".85"/>' +
      '<circle r="92" fill="none" stroke="' + COLORS.magenta + '" stroke-width="3" stroke-dasharray="18 30" opacity=".85"/></g>');
    p.push('<circle class="rdShock rdShock1" r="70" fill="none" stroke="#ffffff" stroke-width="4" opacity="0"/>');
    p.push('<circle class="rdShock rdShock2" r="70" fill="none" stroke="' + COLORS.teal + '" stroke-width="6" opacity="0"/>');
    p.push('<circle class="rdTap" r="70" fill="none" stroke="#fff4c8" stroke-width="5" opacity="0"/>');
    // The part that spins.
    p.push('<g class="rdSpin">');
    p.push('<path d="' + starPath(8, 74, 50, Math.PI / 8) + '" fill="url(#' + id + 'gold2)" stroke="#5e3d14" stroke-width="2"/>');
    p.push('<path d="' + starPath(8, 96, 56, 0) + '" fill="url(#' + id + 'gold)" stroke="#5e3d14" stroke-width="2.4"/>');
    p.push('<path d="' + starPath(8, 88, 60, 0) + '" fill="none" stroke="#fff0bf" stroke-width="1.2" opacity=".55"/>');
    p.push('<circle r="62" fill="#3a2a1c" stroke="#ffe39a" stroke-width="3"/>');
    p.push('<circle r="58" fill="url(#' + id + 'slate)" stroke="#6b4a22" stroke-width="2"/>');
    // Eight rim glyphs: the first eight letters of POLYMATH, carved and lit.
    var rim = 'POLYMATH'.split('');
    rim.forEach(function (ch, i) {
      var a = (i / rim.length) * 360;
      var g = runeGlyph(ch, -4.2, -55, 10.5);
      p.push('<g transform="rotate(' + a + ')"><path class="rdRimDark" d="' + g + '"/><path class="rdRimLit" data-i="' + i + '" d="' + g + '" stroke="' + (i % 2 ? COLORS.magenta : COLORS.teal) + '" opacity="0"/></g>');
    });
    p.push('<circle r="40" fill="#120f15" stroke="#ffe39a" stroke-width="2.2"/>');
    // The logo, and a blurred lit copy that blooms.
    p.push('<g transform="translate(-28,-28) scale(.56)">');
    p.push('<g class="rdLogoBloom" opacity="0" filter="url(#' + id + 'blur)">' + logoSvg(true, 'rdLogoBloomFaces') + '</g>');
    p.push(logoSvg(false, 'rdLogo'));
    p.push('<g class="rdLogoLit" opacity="0">' + logoSvg(true, 'rdLogoLitFaces') + '</g>');
    p.push('</g>');
    // A glint across the glass.
    p.push('<path d="M-30,-26 A40,40 0 0 1 22,-34" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity=".25"/>');
    p.push('</g>');
    p.push('</svg>');
    return p.join('');
  }

  /* ---- a torch in its iron sconce ---- */
  function torchHtml(side) {
    return '<div class="rdTorch rdTorch' + side + '" aria-hidden="true">' +
      '<div class="rdTorchLight"></div>' +
      '<div class="rdFlame"><span class="rdFlameOuter"></span><span class="rdFlameMid"></span><span class="rdFlameCore"></span></div>' +
      '<svg class="rdSconce" viewBox="0 0 40 70"><path d="M10,6h20l-4,14h-12z" fill="#3b2a1e" stroke="#16100b" stroke-width="2"/>' +
      '<path d="M14,20h12l-2,30h-8z" fill="#2a2530" stroke="#141117" stroke-width="2"/><path d="M8,44h24l-3,8h-18z" fill="#3a3342" stroke="#141117" stroke-width="2"/>' +
      '<path d="M20,52v14" stroke="#3a3342" stroke-width="4"/></svg></div>';
  }

  /* The whole scene. Returns the root element and handles on every part
     the timelines move. `doc` is the document to build it in (the app's
     or the composition's). */
  var sceneCount = 0;
  function scene(doc, opts) {
    opts = opts || {};
    doc = doc || root.document;
    var id = 'rd' + (++sceneCount) + '-';
    var inscription = cleanText(opts.inscription, LIMITS.inscription) || DEFAULT_INSCRIPTION;
    var el = doc.createElement('div');
    el.className = 'rdScene' + (opts.film ? ' rdFilm' : '');
    var embers = emberSpots(EMBERS, 11).map(function (e, i) {
      return '<span class="rdEmber' + (e.hot ? ' rdHot' : '') + '" data-i="' + i + '" style="left:' + e.x + '%;width:' + e.size + 'px;height:' + e.size + 'px"></span>';
    }).join('');
    var sparks = sparkVectors(SPARKS, 7).map(function (s, i) {
      return '<span class="rdSpark' + (s.teal ? ' rdSparkTeal' : ' rdSparkMagenta') + '" data-i="' + i + '"></span>';
    }).join('');
    el.innerHTML =
      '<div class="rdStage">' +
        '<div class="rdDoorway">' +
          '<div class="rdBeyond">' + beyondSvg(id) + '</div>' +
          '<div class="rdLeaf rdLeafL">' + leafSvg(id, 'left') + '</div>' +
          '<div class="rdLeaf rdLeafR">' + leafSvg(id, 'right') + '</div>' +
        '</div>' +
        frameSvg(id, inscription) +
        torchHtml('L') + torchHtml('R') +
        '<div class="rdDust" aria-hidden="true"></div>' +
        '<div class="rdSparks" aria-hidden="true">' + sparks + '</div>' +
        '<button type="button" class="rdRune" aria-label="Touch the Polymath rune to open the door">' + runeSvg(id) + '</button>' +
      '</div>' +
      '<div class="rdEmbers" aria-hidden="true">' + embers + '</div>' +
      '<div class="rdFlash" aria-hidden="true"></div>' +
      '<p class="rdHint"><span class="rdHintIcon" aria-hidden="true">✦</span> Touch the rune to open the door <span class="rdHintIcon" aria-hidden="true">✦</span></p>' +
      '<p class="rdWelcome" aria-live="polite">' + esc(opts.welcome || 'Welcome, adventurer') + '</p>';
    var q = function (s) { return el.querySelector(s); };
    var qa = function (s) { return Array.prototype.slice.call(el.querySelectorAll(s)); };
    return {
      id: id,
      el: el,
      inscription: inscription,
      stage: q('.rdStage'),
      doorway: q('.rdDoorway'),
      leafL: q('.rdLeafL'),
      leafR: q('.rdLeafR'),
      glow: q('.rdGlow'),
      rays: q('.rdRays'),
      seam: q('.rdSeam'),
      frame: q('.rdFrame'),
      warm: q('.rdWarm'),
      magic: q('.rdMagic'),
      carve: q('.rdCarve'),
      letters: qa('.rdLetter'),
      stepRunes: qa('.rdStepRune'),
      rune: q('.rdRune'),
      runeArt: q('.rdRuneArt'),
      spin: q('.rdSpin'),
      halo: q('.rdHalo'),
      soft: q('.rdSoft'),
      logoLit: q('.rdLogoLit'),
      bloom: q('.rdLogoBloom'),
      rimLit: qa('.rdRimLit'),
      shock1: q('.rdShock1'),
      shock2: q('.rdShock2'),
      tap: q('.rdTap'),
      sparks: qa('.rdSpark'),
      embers: qa('.rdEmber'),
      flames: qa('.rdFlame'),
      torchLights: qa('.rdTorchLight'),
      torches: qa('.rdTorch'),
      flash: q('.rdFlash'),
      hint: q('.rdHint'),
      welcome: q('.rdWelcome'),
      dust: q('.rdDust')
    };
  }

  /* ------------------------------------------------------------------
     The timelines. Each takes the scene and gsap and returns a paused
     timeline; nothing here touches the DOM except through gsap.
     ------------------------------------------------------------------ */

  /* The scene fades up out of the dark and the rune lands. */
  function introTimeline(s, gsap) {
    var tl = gsap.timeline({ paused: true, defaults: { ease: 'power2.out' } });
    tl.set(s.el, { opacity: 0 }, 0)
      .set(s.stage, { scale: 0.9, transformOrigin: '50% 56%' }, 0)
      .set(s.rune, { scale: 0.4, opacity: 0, rotation: -90 }, 0)
      .set(s.hint, { opacity: 0, y: 12 }, 0)
      .set(s.welcome, { opacity: 0, scale: 0.85 }, 0)
      .set(s.flames, { scale: 0, transformOrigin: '50% 100%' }, 0)
      .set(s.torchLights, { opacity: 0 }, 0)
      .set(s.seam, { opacity: 0 }, 0)
      .to(s.el, { opacity: 1, duration: 0.7 }, 0)
      .to(s.stage, { scale: 1, duration: TIMES.intro, ease: 'power3.out' }, 0)
      .to(s.flames, { scale: 1, duration: 0.5, stagger: 0.12, ease: 'back.out(2.2)' }, 0.25)
      .to(s.torchLights, { opacity: 1, duration: 0.6, stagger: 0.12 }, 0.3)
      .to(s.seam, { opacity: 0.8, duration: 0.6 }, 0.4)
      .to(s.rune, { scale: 1, opacity: 1, rotation: 0, duration: 0.9, ease: 'back.out(1.7)' }, 0.55)
      .to(s.hint, { opacity: 1, y: 0, duration: 0.5 }, 1.1);
    return tl;
  }

  /* One breath while the door waits: the rune glows and dims, the seam of
     light swells, the hint pulses. `cycles` breaths, or for ever (-1). */
  function idleTimeline(s, gsap, cycles) {
    var reps = cycles < 0 ? -1 : Math.max(0, cycles * 2 - 1);
    var half = TIMES.cycle / 2;
    var tl = gsap.timeline({ paused: true, repeat: cycles < 0 ? -1 : 0 });
    var inner = gsap.timeline({ repeat: reps, yoyo: true, defaults: { ease: 'sine.inOut', duration: half, immediateRender: false } });
    inner.fromTo(s.soft, { opacity: 0.25 }, { opacity: 0.75 }, 0)
      .fromTo(s.runeArt, { scale: 1 }, { scale: 1.045 }, 0)
      .fromTo(s.seam, { opacity: 0.55 }, { opacity: 1 }, 0)
      .fromTo(s.hint, { opacity: 0.6 }, { opacity: 1 }, 0)
      .fromTo(s.rimLit, { opacity: 0 }, { opacity: 0.35, stagger: { each: half / 8, from: 'start' }, duration: half / 2 }, 0);
    tl.add(inner, 0);
    return tl;
  }

  /* The torches and the embers, for as long as the scene is up. Their own
     timeline so the idle loop and the opening never fight over them.
     `total` seconds, or for ever (Infinity). */
  function ambientTimeline(s, gsap, total) {
    var forever = !(total < Infinity);
    var tl = gsap.timeline({ paused: true });
    var reps = function (dur, start) { return forever ? -1 : Math.max(0, Math.floor((total - (start || 0)) / dur) - 1); };
    s.flames.forEach(function (f, i) {
      var d = 0.18 + i * 0.05;
      tl.fromTo(f, { scaleY: 0.92, scaleX: 1.02, skewX: -2 }, { scaleY: 1.12, scaleX: 0.95, skewX: 3, duration: d, ease: 'sine.inOut', yoyo: true, repeat: reps(d) }, 0);
    });
    s.torchLights.forEach(function (l, i) {
      var d = 0.31 + i * 0.07;
      tl.fromTo(l, { scale: 0.94 }, { scale: 1.08, duration: d, ease: 'sine.inOut', yoyo: true, repeat: reps(d) }, 0);
    });
    tl.fromTo(s.warm, { opacity: 0.85 }, { opacity: 1, duration: 0.27, yoyo: true, repeat: reps(0.27), ease: 'sine.inOut' }, 0);
    var spots = emberSpots(EMBERS, 11);
    s.embers.forEach(function (e, i) {
      var sp = spots[i];
      tl.fromTo(e, { y: 0, x: 0 }, {
        y: function () { return -(root.innerHeight || 800) * 0.75; }, x: sp.drift,
        duration: sp.dur, ease: 'none', repeat: reps(sp.dur, sp.delay), immediateRender: false
      }, sp.delay);
      tl.to(e, {
        keyframes: [{ opacity: 0, duration: 0 }, { opacity: 1, duration: sp.dur * 0.2 }, { opacity: 0.8, duration: sp.dur * 0.5 }, { opacity: 0, duration: sp.dur * 0.3 }],
        repeat: reps(sp.dur, sp.delay)
      }, sp.delay);
    });
    return tl;
  }

  /* The touch: the rune lights, spins, bursts, and the door swings open
     onto the worksheet. `zoom` is a function giving how far the camera
     pushes through (measured when the push starts, so a turned phone is
     still covered). */
  function openTimeline(s, gsap, opts) {
    opts = opts || {};
    var T = TIMES;
    var zoom = opts.zoom || function () { return 4; };
    // Every SVG part that turns or grows does so about its own middle. Set
    // once, up front: GSAP keeps an SVG element where it is when its origin
    // changes mid-flight (smoothOrigin), so an origin first given in the
    // middle of a tween leaves the part drifting off to one side.
    gsap.set([s.halo, s.spin, s.shock1, s.shock2, s.tap, s.rays, s.seam], { transformOrigin: '50% 50%' });
    var tl = gsap.timeline({ paused: true, defaults: { immediateRender: false } });
    // Everything here that the intro or the idle loop also moves starts
    // from a stated value (fromTo), never from wherever it happens to be:
    // that is what makes a seek in the film land on the same frame every
    // time, and the opening in the app start the same way at any breath.
    // The finger: the rune dips, a ring spreads from it, the hint goes.
    tl.fromTo(s.hint, { opacity: 1, y: 0 }, { opacity: 0, y: 10, duration: 0.3, ease: 'power1.in' }, 0)
      .fromTo(s.rune, { scale: 1 }, { scale: 0.92, duration: T.press, ease: 'power2.out', yoyo: true, repeat: 1 }, 0)
      .fromTo(s.tap, { scale: 0.5, opacity: 1 }, { scale: 1.9, opacity: 0, duration: 0.6, ease: 'power2.out', transformOrigin: '50% 50%' }, 0);
    // It lights in the centre's colours.
    tl.to(s.halo, { opacity: 1, duration: T.ignite, ease: 'power2.out' }, 0.05)
      .fromTo(s.halo, { scale: 0.6 }, { scale: 1, transformOrigin: '50% 50%', duration: T.ignite, ease: 'back.out(1.6)' }, 0.05)
      .fromTo(s.soft, { opacity: 0.5 }, { opacity: 0, duration: 0.3 }, 0.05)
      .to(s.logoLit, { opacity: 1, duration: 0.45 }, 0.1)
      .to(s.bloom, { opacity: 0.95, duration: 0.5 }, 0.15)
      .to(s.rimLit, { opacity: 1, duration: 0.18, stagger: 0.06 }, 0.1)
      .to(s.rune, { filter: 'drop-shadow(0px 0px 22px rgba(79, 195, 207, 0.95))', duration: 0.5, ease: 'power2.out' }, 0.1)
      .to(s.rune, { filter: 'drop-shadow(0px 0px 30px rgba(224, 33, 143, 0.95))', duration: 0.6, ease: 'sine.inOut', yoyo: true, repeat: 2 }, T.spinAt + 0.1)
      .fromTo(s.shock1, { scale: 0.85, opacity: 0.9 }, { scale: 2.1, opacity: 0, duration: 0.8, ease: 'power2.out', transformOrigin: '50% 50%' }, 0.3);
    // It spins, faster and faster; the halo turns the other way.
    tl.fromTo(s.spin, { rotation: 0 }, { rotation: 1080, duration: T.spin, ease: 'power3.in', transformOrigin: '50% 50%' }, T.spinAt)
      .fromTo(s.halo, { rotation: 0 }, { rotation: -540, duration: T.spin + T.unlock, ease: 'power1.in', transformOrigin: '50% 50%' }, T.spinAt);
    // Sparks fly off it, twice.
    var vec = sparkVectors(SPARKS, 7);
    [T.spinAt + 0.15, T.spinAt + 1.05].forEach(function (at, wave) {
      s.sparks.forEach(function (sp, i) {
        var v = vec[i];
        var k = wave ? 1.25 : 0.8;
        var when = at + v.delay * 0.5;
        tl.fromTo(sp, { x: 0, y: 0, scale: v.s }, { x: v.x * k, y: v.y * k, scale: v.s * 0.6, ease: 'power2.out', duration: 0.78 }, when)
          .to(sp, { keyframes: [{ opacity: 1, duration: 0.08 }, { opacity: 0, duration: 0.7 }] }, when);
      });
    });
    // The inscription lights, letter by letter, teal to magenta; the runes
    // on the step answer it.
    var stepEach = s.letters.length ? 1.4 / s.letters.length : 0.05;
    tl.fromTo(s.letters, { fillOpacity: 0 }, { fillOpacity: 1, duration: 0.25, stagger: stepEach, ease: 'power1.out' }, T.letters)
      .to(s.carve, { opacity: 0.25, duration: 1.2 }, T.letters)
      .fromTo(s.stepRunes, { opacity: 0.35 }, { opacity: 1, stroke: COLORS.teal, duration: 0.25, stagger: stepEach }, T.letters + 0.2)
      .to(s.magic, { opacity: 0.6, duration: 1.4, ease: 'sine.inOut' }, T.letters);
    // Light leaks round the leaves; the door shudders against the lock.
    tl.fromTo(s.seam, { opacity: 0.8, scaleX: 1 }, { opacity: 1, scaleX: 3.2, duration: 1.2, ease: 'power2.in' }, 0.9)
      .to(s.glow, { opacity: 0.35, duration: 1.4 }, 1.0)
      .fromTo([s.leafL, s.leafR], { x: 0 }, { x: 1.6, duration: 0.06, yoyo: true, repeat: 15, ease: 'none' }, 1.5);
    // The rune bursts into light and is gone.
    tl.to(s.flash, { keyframes: [{ opacity: 0.85, duration: 0.14 }, { opacity: 0, duration: 0.5, ease: 'power2.out' }] }, T.unlockAt)
      .fromTo(s.rune, { scale: 1, opacity: 1 }, { scale: 1.7, opacity: 0, duration: T.unlock, ease: 'power2.in' }, T.unlockAt)
      .fromTo(s.shock2, { scale: 0.8, opacity: 1 }, { scale: 3.2, opacity: 0, duration: 0.9, ease: 'power2.out', transformOrigin: '50% 50%' }, T.unlockAt);
    // The leaves swing inward. Through the doorway: the worksheet.
    tl.to(s.leafL, { rotationY: 104, duration: T.open, ease: 'power2.inOut', transformOrigin: '0% 50%' }, T.openAt)
      .to(s.leafR, { rotationY: -104, duration: T.open, ease: 'power2.inOut', transformOrigin: '100% 50%' }, T.openAt)
      .to([s.leafL, s.leafR], { filter: 'brightness(0.45)', duration: T.open, ease: 'power1.in' }, T.openAt)
      .to(s.seam, { opacity: 0, duration: 0.4 }, T.openAt)
      .to(s.glow, { keyframes: [{ opacity: 0.85, duration: 0.6 }, { opacity: 0, duration: 1.4 }] }, T.openAt)
      .to(s.rays, { keyframes: [{ opacity: 0.75, duration: 0.6 }, { opacity: 0, duration: 1.3 }] }, T.openAt + 0.1)
      .fromTo(s.rays, { rotation: 0 }, { rotation: 35, duration: T.open + 0.5, ease: 'none', transformOrigin: '50% 50%' }, T.openAt)
      .set(s.dust, { scaleX: 0.4, transformOrigin: '50% 100%' }, T.openAt + 0.2)
      .to(s.dust, { keyframes: [{ opacity: 0.9, scaleX: 1, duration: 0.5, ease: 'power2.out' }, { opacity: 0, duration: 0.9 }] }, T.openAt + 0.2);
    // Welcome — and the camera pushes through the doorway.
    tl.to(s.welcome, { keyframes: [{ opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(1.8)' }, { opacity: 1, duration: 0.6 }, { opacity: 0, scale: 1.08, duration: 0.4 }] }, T.openAt + 0.3)
      .to(s.stage, { scale: function () { return zoom(); }, duration: T.zoom, ease: 'power2.in', transformOrigin: (50) + '% ' + round1(DOORWAY.top + DOORWAY.height / 2) + '%' }, T.zoomAt)
      .to(s.el, { opacity: 0, duration: 0.7, ease: 'power1.in' }, T.end - 0.7)
      .set({}, {}, T.end);
    return tl;
  }

  /* The film: intro, `filmIdle` breaths, a touch, the opening — one
     paused timeline, registered for HyperFrames. */
  function filmTimeline(s, gsap, opts) {
    var master = gsap.timeline({ paused: true });
    var idle = idleTimeline(s, gsap, TIMES.filmIdle);
    var intro = introTimeline(s, gsap);
    var open = openTimeline(s, gsap, opts);
    intro.paused(false); idle.paused(false); open.paused(false);
    var touchAt = TIMES.intro + TIMES.filmIdle * TIMES.cycle;
    var total = touchAt + TIMES.end + TIMES.filmTail;
    var amb = ambientTimeline(s, gsap, total);
    amb.paused(false);
    master.add(amb, 0).add(intro, 0).add(idle, TIMES.intro).add(open, touchAt).set({}, {}, total);
    master.addLabel('touch', touchAt);
    return master;
  }

  /* Build the film into a HyperFrames composition's root and register it.
     Used by rune-door.html. */
  function composition(rootEl, opts) {
    opts = opts || {};
    var gsap = opts.gsap || root.gsap;
    var doc = rootEl.ownerDocument || root.document;
    var s = scene(doc, { inscription: opts.inscription, welcome: opts.welcome, film: true });
    rootEl.appendChild(s.el);
    var tl = filmTimeline(s, gsap, {
      zoom: function () {
        var r = s.stage.getBoundingClientRect();
        var w = s.stage.offsetWidth || r.width, h = s.stage.offsetHeight || r.height;
        return zoomScale(rootEl.clientWidth || 1920, rootEl.clientHeight || 1080, w, h);
      }
    });
    root.__timelines = root.__timelines || {};
    root.__timelines[COMPOSITION_ID] = tl;
    return { scene: s, timeline: tl };
  }

  /* ------------------------------------------------------------------
     The live door, in the app
     ------------------------------------------------------------------ */
  function reducedMotion() {
    try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }

  function create(env) {
    env = env || {};
    var doc = root.document;
    var S = {
      role: 'none',
      unsub: null,
      listeningFor: '',
      data: null,          // last clean doc seen
      door: null,          // the door on screen, if any
      panel: null,
      saving: false
    };

    function role() { try { return env.role ? env.role() : 'none'; } catch (e) { return 'none'; } }
    function teacher() { return role() === 'teacher'; }
    function gsapLib() { return env.gsap ? env.gsap() : root.gsap; }
    function toast(t) { try { if (env.toast) env.toast(t); } catch (e) {} }
    function ref() { try { return env.doc ? env.doc() : null; } catch (e) { return null; } }
    function who() { try { return env.who ? String(env.who() || '') : ''; } catch (e) { return ''; } }

    /* ---- the door on screen ---- */
    function showDoor(data, how) {
      how = how || {};
      if (S.door) {
        if (!how.preview && S.door.epoch === data.epoch && !S.door.preview) return S.door;
        removeDoor(true);
      }
      var gsap = gsapLib();
      var name = '';
      try { name = env.name ? cleanText(env.name(), 40) : ''; } catch (e) {}
      var s = scene(doc, { inscription: data.inscription, welcome: name ? 'Welcome, ' + name : 'Welcome, adventurer' });
      var back = doc.createElement('div');
      back.className = 'rdBack';
      back.id = 'runeDoor';
      back.setAttribute('role', 'dialog');
      back.setAttribute('aria-modal', 'true');
      back.setAttribute('aria-label', 'A sealed door. Touch the rune to open it.');
      back.appendChild(s.el);
      // Every key pressed at the door stops at the door: the worksheet's
      // one-letter shortcuts must not fire behind it.
      back.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Tab') { e.preventDefault(); try { s.rune.focus(); } catch (x) {} }
      });
      ['pointerdown', 'mousedown', 'touchstart', 'wheel', 'contextmenu'].forEach(function (t) {
        back.addEventListener(t, function (e) { e.stopPropagation(); }, { passive: t === 'touchstart' || t === 'wheel' });
      });
      doc.body.appendChild(back);
      var door = {
        back: back, scene: s, epoch: data.epoch, preview: !!how.preview,
        state: 'sealed', tls: [], reduced: reducedMotion() || !gsap
      };
      S.door = door;
      back.classList.toggle('rdReduced', door.reduced);
      s.rune.addEventListener('click', function () { touch(door); });
      if (!door.reduced) {
        var amb = ambientTimeline(s, gsap, Infinity);
        var intro = introTimeline(s, gsap);
        var idle = idleTimeline(s, gsap, -1);
        door.tls = [amb, intro, idle];
        door.idle = idle;
        amb.play();
        intro.eventCallback('onComplete', function () { if (S.door === door && door.state === 'sealed') idle.play(); });
        intro.play();
      }
      // Focus for Enter and Space, without drawing the keyboard ring on a
      // screen that was only ever touched.
      setTimeout(function () { try { s.rune.focus({ preventScroll: true, focusVisible: false }); } catch (e) {} }, 60);
      back.dataset.state = 'sealed';
      return door;
    }

    /* The touch on the rune. The epoch is recorded at the touch, not at
       the end, so a reload half-way through does not shut the door again. */
    function touch(door) {
      if (S.door !== door || door.state !== 'sealed') return;
      door.state = 'opening';
      door.back.dataset.state = 'opening';
      if (!door.preview) {
        try { if (env.writeSeen) env.writeSeen(door.epoch); } catch (e) {}
      }
      var s = door.scene;
      var gsap = gsapLib();
      if (door.reduced) {
        // No spin and no swing: the rune lights and the scene fades.
        if (gsap) {
          gsap.set([s.halo, s.logoLit, s.rimLit], { opacity: 1 });
          gsap.set(s.letters, { fillOpacity: 1 });
          var t = gsap.to(s.el, { opacity: 0, duration: 0.6, delay: 0.5, onComplete: function () { finish(door); } });
          door.tls.push(t);
        } else {
          finish(door);
        }
        return;
      }
      if (door.idle) door.idle.pause();
      var open = openTimeline(s, gsap, {
        zoom: function () {
          return zoomScale(root.innerWidth, root.innerHeight, s.stage.offsetWidth, s.stage.offsetHeight);
        }
      });
      door.tls.push(open);
      open.eventCallback('onComplete', function () { finish(door); });
      open.play(0);
    }

    function finish(door) {
      if (S.door !== door) return;
      door.state = 'open';
      removeDoor(true);
    }

    function removeDoor(now) {
      var door = S.door;
      if (!door) return;
      S.door = null;
      door.state = 'gone';
      door.tls.forEach(function (t) { try { t.kill(); } catch (e) {} });
      var gsap = gsapLib();
      if (!now && gsap && !door.reduced) {
        gsap.to(door.back, { opacity: 0, duration: 0.45, onComplete: function () { door.back.remove(); } });
      } else {
        door.back.remove();
      }
    }

    /* ---- the student's side: listen to the switch ---- */
    function onData(raw) {
      var data = clean(raw);
      S.data = data;
      if (role() !== 'student') return;
      var seen = '';
      try { seen = env.readSeen ? env.readSeen() : ''; } catch (e) {}
      if (shouldShow(data, seen)) {
        showDoor(data, {});
      } else if (S.door && !S.door.preview && S.door.state === 'sealed' && (!data.on || data.epoch !== S.door.epoch)) {
        // Switched off (or a stale epoch) while the door is still shut: it goes.
        removeDoor(false);
      }
    }

    function listen() {
      var key = role() + '|' + who();
      if (S.unsub && S.listeningFor === key) return;
      stopListening();
      var r = ref();
      if (!r || typeof r.onSnapshot !== 'function') return;
      S.listeningFor = key;
      try {
        S.unsub = r.onSnapshot(function (snap) {
          var d = snap && (typeof snap.data === 'function' ? snap.data() : snap.data);
          onData(snap && snap.exists === false ? null : d);
        }, function () { /* a refused read is no door, never an error on a child's screen */ });
      } catch (e) { S.unsub = null; }
    }

    function stopListening() {
      if (S.unsub) { try { S.unsub(); } catch (e) {} }
      S.unsub = null;
      S.listeningFor = '';
    }

    /* Called whenever the person or their role may have changed. */
    function roleChanged() {
      var r = role();
      S.role = r;
      if (r === 'student') {
        listen();
      } else {
        stopListening();
        if (S.door && !(S.door.preview && r === 'teacher')) removeDoor(true);
      }
      if (r !== 'teacher') closePanel();
    }

    /* ---- the teacher's panel ---- */
    function panelHtml() {
      return '<div class="rdPanel" role="dialog" aria-modal="true" aria-labelledby="rdPanelTitle">' +
        '<div class="rdPanelHead"><div class="rdPanelSeal" aria-hidden="true">' + runeSvg('rdp-') + '</div>' +
        '<div><h2 id="rdPanelTitle">Rune door</h2>' +
        '<p class="rdPanelLead">Every student meets a sealed medieval door with the Polymath rune at its heart. A touch on the rune lights it in the centre\'s colours, spins it, and the door swings open onto their worksheet.</p></div></div>' +
        '<label class="rdSwitch"><input type="checkbox" data-rd="on"><span class="rdSwitchTrack" aria-hidden="true"><span class="rdSwitchKnob"></span></span><span class="rdSwitchText">Show the door to students</span></label>' +
        '<label class="rdField"><span>Inscription carved on the arch</span><input type="text" data-rd="inscription" maxlength="' + LIMITS.inscription + '" autocomplete="off" spellcheck="false"></label>' +
        '<div class="rdPanelRow">' +
          '<button type="button" class="btn" data-rd="preview">👁 Preview</button>' +
          '<button type="button" class="btn" data-rd="again">🔁 Show it again</button>' +
          '<span class="rdGrow"></span>' +
          '<button type="button" class="btn primary" data-rd="close">Done</button>' +
        '</div>' +
        '<p class="rdStatus" aria-live="polite"></p>' +
        '</div>';
    }

    function panelField(name) { return S.panel ? S.panel.querySelector('[data-rd="' + name + '"]') : null; }

    function setStatus(t, bad) {
      var el = S.panel && S.panel.querySelector('.rdStatus');
      if (!el) return;
      el.textContent = t || '';
      el.classList.toggle('rdBad', !!bad);
    }

    function describe(d) {
      return d.on ? 'On — every student meets the door. Once they open it, it stays open until you press 🔁 Show it again.'
        : 'Off — students go straight to their worksheet.';
    }

    function fillPanel(d) {
      if (!S.panel) return;
      var on = panelField('on'), ins = panelField('inscription'), again = panelField('again');
      if (on) on.checked = !!d.on;
      if (ins && doc.activeElement !== ins) ins.value = d.inscription;
      if (again) again.disabled = !d.on;
      setStatus(describe(d));
    }

    function openPanel() {
      if (!teacher()) return;
      if (S.panel) { fillPanel(S.data || clean(null)); return; }
      var back = doc.createElement('div');
      back.className = 'rdPanelBack';
      back.id = 'runeDoorPanel';
      back.innerHTML = panelHtml();
      doc.body.appendChild(back);
      S.panel = back;
      back.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); closePanel(); }
      });
      back.addEventListener('mousedown', function (e) { if (e.target === back) closePanel(); });
      back.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-rd]');
        if (!b) return;
        var what = b.getAttribute('data-rd');
        if (what === 'close') closePanel();
        else if (what === 'preview') preview();
        else if (what === 'again') showAgain();
      });
      panelField('on').addEventListener('change', function (e) { setOn(!!e.target.checked); });
      var ins = panelField('inscription');
      ins.addEventListener('change', function () { saveInscription(ins.value); });
      ins.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ins.blur(); } });
      fillPanel(S.data || clean(null));
      setStatus('Reading the switch…');
      var r = ref();
      if (r && typeof r.get === 'function') {
        Promise.resolve(r.get()).then(function (snap) {
          var d = snap && snap.exists !== false && typeof snap.data === 'function' ? snap.data() : null;
          S.data = clean(d);
          fillPanel(S.data);
        }).catch(function () { fillPanel(S.data || clean(null)); });
      } else {
        fillPanel(S.data || clean(null));
      }
      // The panel's own seal breathes, so the panel is a moving thing too.
      var gsap = gsapLib();
      var seal = back.querySelector('.rdPanelSeal .rdSpin');
      if (gsap && seal && !reducedMotion()) {
        S.panelTl = gsap.to(seal, { rotation: 360, duration: 24, ease: 'none', repeat: -1, transformOrigin: '50% 50%' });
        gsap.fromTo(back.querySelector('.rdPanel'), { y: 24, opacity: 0, scale: 0.97 }, { y: 0, opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(1.6)' });
      }
      setTimeout(function () { try { panelField('on').focus(); } catch (e) {} }, 30);
    }

    function closePanel() {
      if (!S.panel) return;
      if (S.panelTl) { try { S.panelTl.kill(); } catch (e) {} S.panelTl = null; }
      S.panel.remove();
      S.panel = null;
    }

    function write(patch) {
      if (!teacher()) return Promise.reject(new Error('teacher only'));
      var r = ref();
      if (!r || typeof r.set !== 'function') return Promise.reject(new Error('no connection'));
      var now = Date.now();
      var base = S.data || clean(null);
      var next = clean(Object.assign({}, base, patch, { teacherUid: who(), at: now }));
      S.saving = true;
      return Promise.resolve(r.set(next, { merge: true })).then(function () {
        S.saving = false;
        S.data = next;
        fillPanel(next);
        return next;
      }, function (e) {
        S.saving = false;
        fillPanel(base);
        setStatus('Could not save — ' + (e && e.message ? e.message : 'check the connection') + '.', true);
        throw e;
      });
    }

    function currentInscription() {
      var ins = panelField('inscription');
      return cleanText(ins ? ins.value : (S.data && S.data.inscription), LIMITS.inscription) || DEFAULT_INSCRIPTION;
    }

    function setOn(on) {
      if (!teacher()) return Promise.resolve(null);
      var base = S.data || clean(null);
      setStatus(on ? 'Sealing every student\'s door…' : 'Taking the door away…');
      return write({ on: on, epoch: on ? nextEpoch(base.epoch, Date.now()) : base.epoch, inscription: currentInscription() })
        .then(function (d) { toast(on ? '🚪 The rune door is up on every student\'s screen.' : '🚪 The rune door is off.'); return d; })
        .catch(function () { return null; });
    }

    function showAgain() {
      if (!teacher()) return Promise.resolve(null);
      var base = S.data || clean(null);
      setStatus('Sealing the door again…');
      return write({ on: true, epoch: nextEpoch(base.epoch, Date.now()), inscription: currentInscription() })
        .then(function (d) { toast('🚪 Every student meets the door again.'); return d; })
        .catch(function () { return null; });
    }

    function saveInscription(text) {
      if (!teacher()) return Promise.resolve(null);
      var words = cleanText(text, LIMITS.inscription) || DEFAULT_INSCRIPTION;
      setStatus('Carving the new inscription…');
      return write({ inscription: words }).then(function (d) {
        setStatus('Carved. ' + describe(d));
        return d;
      }).catch(function () { return null; });
    }

    /* The teacher's own look at the door, e.g. on the projector. It never
       records an epoch and never writes. */
    function preview() {
      if (!teacher()) return null;
      var data = clean(Object.assign({}, S.data || {}, { on: true, epoch: -1, inscription: currentInscription() }));
      closePanel();
      return showDoor(data, { preview: true });
    }

    return {
      roleChanged: roleChanged,
      openPanel: openPanel,
      closePanel: closePanel,
      preview: preview,
      setOn: setOn,
      showAgain: showAgain,
      saveInscription: saveInscription,
      isShowing: function () { return !!S.door; },
      doorState: function () { return S.door ? S.door.state : 'none'; },
      _state: S,
      _onData: onData
    };
  }

  root.RuneDoor = {
    create: create,
    scene: scene,
    introTimeline: introTimeline,
    idleTimeline: idleTimeline,
    ambientTimeline: ambientTimeline,
    openTimeline: openTimeline,
    filmTimeline: filmTimeline,
    composition: composition,
    COMPOSITION_ID: COMPOSITION_ID,
    pure: {
      VB: VB, ARCH: ARCH, DOORWAY: DOORWAY, MEDAL: MEDAL, TORCH: TORCH, COLORS: COLORS, TIMES: TIMES,
      LIMITS: LIMITS, DEFAULT_INSCRIPTION: DEFAULT_INSCRIPTION, RUNES: RUNES,
      rng: rng, clean: clean, shouldShow: shouldShow, nextEpoch: nextEpoch, mix: mix,
      inscriptionColors: inscriptionColors, inscriptionSize: inscriptionSize, zoomScale: zoomScale,
      sparkVectors: sparkVectors, emberSpots: emberSpots, runeGlyph: runeGlyph, runeLine: runeLine,
      archPath: archPath, voussoirPath: voussoirPath, starPath: starPath, logoFaces: logoFaces,
      cleanText: cleanText, esc: esc
    }
  };
})();
