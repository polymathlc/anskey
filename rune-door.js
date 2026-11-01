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
    teal: '#7ebfca',
    magenta: '#c60085',
    gold: '#f2c14e',
    goldDeep: '#b9822b',
    brass: '#d9a441',
    wood: '#5a3a2c',
    woodDark: '#28170f',
    woodLight: '#8a5d43',
    iron: '#2a2530',
    stone: '#6a6071',
    stoneLight: '#958a9e',
    stoneDark: '#3f3746',
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

  /* ------------------------------------------------------------------
     The Polymath logo, TRACED from the centre's own logo file (158 × 144
     px, read pixel by pixel), not drawn from memory: two isometric bars
     crossing to make an M. The magenta bar runs from the top right down
     to the middle and lies BEHIND; the teal bar runs from the top left
     down to the middle and lies IN FRONT of it. Each bar shows its top,
     its front, and a folded foot with a shadow in the fold. The colours
     are the file's own, byte for byte. Drawn in a 100 × 100 box.
     ------------------------------------------------------------------ */
  var LOGO = {
    tealFront: '#7ebfca',
    tealTop: '#5b96a1',
    tealFoot: '#5b96a1',
    tealShade: '#3a6a70',
    magentaFront: '#c60085',
    magentaTop: '#991e65',
    magentaFoot: '#991e65',
    magentaShade: '#711648'
  };

  /* Painted back to front: the magenta bar's top first (the teal bar
     crosses over it), then the teal bar, then the magenta front. `lit`
     brightens every face for the moment the rune catches fire. */
  var LOGO_FACES = [
    { part: 'magentaTop', d: 'M100,23.3L77.5,5.8L30,41.7L50,59.2Z' },
    { part: 'tealTop', d: 'M0,23.3L22.5,5.8L70,41.7L50,59.2Z' },
    { part: 'tealFront', d: 'M0,23.3L50,59.2L50,94.2L0,59.2Z' },
    { part: 'tealFoot', d: 'M0,59.2L25,76.7L0,94.2Z' },
    { part: 'tealShade', d: 'M0.8,60L25,76.7L15.8,82.5Z' },
    { part: 'magentaFront', d: 'M100,23.3L50,59.2L50,94.2L100,59.2Z' },
    { part: 'magentaFoot', d: 'M100,59.2L75,76.7L100,94.2Z' },
    { part: 'magentaShade', d: 'M99.2,60L75,76.7L84.2,82.5Z' }
  ];

  function logoFaces(lit) {
    return LOGO_FACES.map(function (f) {
      var base = LOGO[f.part];
      return { part: f.part, d: f.d, fill: lit ? mix(base, '#ffffff', 0.3) : base };
    });
  }

  function logoSvg(lit, cls) {
    return '<g class="' + cls + '">' + logoFaces(lit).map(function (f) {
      return '<path d="' + f.d + '" fill="' + f.fill + '"/>';
    }).join('') + '</g>';
  }

  /* ------------------------------------------------------------------
     Surfaces. Every material is LIT, not flat: a fractal-noise height
     field plus a blur of the shape's own outline (which is what bevels
     the edge of every stone and every plank) goes through a diffuse and
     a specular light from the top left, and the result is multiplied
     into the shape's own colour. One filter per material, applied to a
     whole group, so a door costs a handful of filter passes rather than
     one per stone.
     ------------------------------------------------------------------ */
  function reliefFilter(fid, o) {
    o = o || {};
    var region = o.region || 'x="-4%" y="-4%" width="108%" height="108%"';
    return '<filter id="' + fid + '" ' + region + ' color-interpolation-filters="sRGB">' +
      '<feTurbulence type="' + (o.type || 'fractalNoise') + '" baseFrequency="' + (o.freq || '.06') + '" numOctaves="' + (o.octaves || 4) + '" seed="' + (o.seed || 3) + '" result="noise"/>' +
      '<feGaussianBlur in="SourceAlpha" stdDeviation="' + (o.bevel || 2.2) + '" result="edge"/>' +
      // The height never reaches 1: a sum that clips at 1 is flat, and the
      // noise would vanish from every face and show only at the edges.
      '<feComposite in="noise" in2="edge" operator="arithmetic" k2="' + Math.min(0.45, Math.round((o.rough || 0.35) * 40) / 100) + '" k3=".5" result="bump"/>' +
      '<feDiffuseLighting in="bump" surfaceScale="' + round1((o.depth || 4) * 1.85) + '" diffuseConstant="1" lighting-color="#ffffff" result="diffuse">' +
      '<feDistantLight azimuth="' + (o.azimuth || 225) + '" elevation="' + (o.elevation || 52) + '"/></feDiffuseLighting>' +
      '<feSpecularLighting in="bump" surfaceScale="' + round1((o.depth || 4) * 1.85) + '" specularConstant="' + (o.shine || 0.45) + '" specularExponent="' + (o.sharp || 16) + '" lighting-color="' + (o.glint || '#ffd9a0') + '" result="spec">' +
      '<feDistantLight azimuth="' + (o.azimuth || 225) + '" elevation="' + (o.elevation || 52) + '"/></feSpecularLighting>' +
      '<feComposite in="diffuse" in2="SourceGraphic" operator="arithmetic" k1="' + (o.gain || 1.25) + '" result="lit"/>' +
      '<feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn"/>' +
      '<feComposite in="lit" in2="specIn" operator="arithmetic" k2="1" k3="' + (o.specMix || 0.55) + '" result="all"/>' +
      '<feComposite in="all" in2="SourceAlpha" operator="in"/>' +
      '</filter>';
  }

  /* A soft drop shadow, for things that stand proud of the surface
     behind them: the stones off the wall, the iron off the wood. */
  function shadowFilter(fid, dx, dy, blur, alpha) {
    return '<filter id="' + fid + '" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">' +
      '<feGaussianBlur in="SourceAlpha" stdDeviation="' + blur + '"/>' +
      '<feOffset dx="' + dx + '" dy="' + dy + '" result="off"/>' +
      '<feComponentTransfer in="off" result="sh"><feFuncA type="linear" slope="' + alpha + '"/></feComponentTransfer>' +
      '<feMerge><feMergeNode in="sh"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
  }

  /* A stone's colour varies a little from its neighbours': the same
     seeded generator every time, so the wall never changes between
     frames or between renders. */
  function stoneTint(r, base) {
    var t = r();
    return mix(base, t > 0.5 ? '#a596a8' : '#2b2430', Math.abs(t - 0.5) * 0.5);
  }

  /* The wall's stones, as two pattern tiles of ONE course each, the
     second shifted half a tile across and one course down. No stone ever
     crosses the edge of its own tile, so the lighting never shows a seam
     where the tile repeats (a stone cut by the tile edge was lit twice,
     from two different patches of noise, and a pale stripe ran up the
     wall). Lit inside the tile, so a screenful of wall is two tiles' work. */
  function coursePattern(pid, fid, w, h, joints, base, seed, dx, dy) {
    var r = rng(seed);
    var out = '<pattern id="' + pid + '" x="' + dx + '" y="' + dy + '" width="' + w + '" height="' + (h * 2) + '" patternUnits="userSpaceOnUse">' +
      '<rect width="' + w + '" height="' + h + '" fill="#110d14"/><g filter="url(#' + fid + ')">';
    for (var i = 0; i < joints.length - 1; i++) {
      var x = joints[i] + 1.6, sw = joints[i + 1] - joints[i] - 3.2;
      out += '<rect x="' + round1(x) + '" y="1.6" width="' + round1(sw) + '" height="' + round1(h - 3.2) + '" rx="' + round1(2 + r() * 3) + '" fill="' + stoneTint(r, base) + '"/>';
    }
    return out + '</g></pattern>';
  }

  function wallPattern(id) {
    return coursePattern(id + 'bricksA', id + 'wallFx', 160, 40, [0, 52, 108, 160], '#2d2632', 41, 0, 0) +
      coursePattern(id + 'bricksB', id + 'wallFx', 160, 40, [0, 54, 106, 160], '#2b2430', 43, 80, 40);
  }

  /* The flagstones on the floor, the same way. */
  function floorPattern(id) {
    return coursePattern(id + 'flagsA', id + 'floorFx', 120, 22, [0, 64, 120], '#342b38', 57, 0, 0) +
      coursePattern(id + 'flagsB', id + 'floorFx', 120, 22, [0, 56, 120], '#30283a', 59, 60, 22);
  }

  /* ---- the wall, the floor, the stone frame and the inscription ---- */
  function frameSvg(id, inscription) {
    var far = 4000;
    var wallHole = 'M' + (-far) + ',' + (-far) + 'H' + (VB.w + far) + 'V' + (VB.h + far) + 'H' + (-far) + 'Z' + archPath();
    var parts = [];
    parts.push('<svg class="rdFrame" viewBox="0 0 ' + VB.w + ' ' + VB.h + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">');
    parts.push('<defs>' +
      reliefFilter(id + 'wallFx', { freq: '.11', octaves: 4, seed: 9, bevel: 2.2, rough: 0.75, depth: 3.4, gain: 1.08, shine: 0.2, region: 'filterUnits="userSpaceOnUse" x="-10" y="-10" width="180" height="60"' }) +
      reliefFilter(id + 'floorFx', { freq: '.09', octaves: 3, seed: 21, bevel: 2, rough: 0.7, depth: 4, gain: 1.1, shine: 0.3, region: 'filterUnits="userSpaceOnUse" x="-10" y="-10" width="140" height="42"' }) +
      reliefFilter(id + 'stoneFx', { freq: '.065', octaves: 5, seed: 5, bevel: 2.6, rough: 0.8, depth: 4, gain: 1.18, shine: 0.5, sharp: 20 }) +
      shadowFilter(id + 'standOff', 0, 4, 4, 0.75) +
      wallPattern(id) + floorPattern(id) +
      // Shadow towards the edges, so the eye goes to the door.
      '<radialGradient id="' + id + 'vig" gradientUnits="userSpaceOnUse" cx="200" cy="270" r="440">' +
      '<stop offset="0.28" stop-color="#000" stop-opacity="0"/><stop offset=".62" stop-color="#05030a" stop-opacity=".72"/><stop offset="1" stop-color="#000" stop-opacity=".96"/></radialGradient>' +
      // Warm light the torches throw on the stone.
      '<radialGradient id="' + id + 'warm" gradientUnits="userSpaceOnUse" cx="200" cy="250" r="260">' +
      '<stop offset="0" stop-color="#ffb347" stop-opacity=".24"/><stop offset=".55" stop-color="#ff8c2a" stop-opacity=".09"/><stop offset="1" stop-color="#ff8c2a" stop-opacity="0"/></radialGradient>' +
      // A pool of torchlight on each side of the frame.
      '<radialGradient id="' + id + 'torchPool" cx=".5" cy=".5" r=".5">' +
      '<stop offset="0" stop-color="#ffc56b" stop-opacity=".5"/><stop offset=".45" stop-color="#ff9a3c" stop-opacity=".16"/><stop offset="1" stop-color="#ff7a20" stop-opacity="0"/></radialGradient>' +
      // The light under and round the door, spilling onto the step and the floor.
      '<radialGradient id="' + id + 'spill" cx=".5" cy="0" r=".9" fx=".5" fy="0">' +
      '<stop offset="0" stop-color="#ffd27a" stop-opacity=".75"/><stop offset=".35" stop-color="#ff9b3d" stop-opacity=".28"/><stop offset="1" stop-color="#ff7a20" stop-opacity="0"/></radialGradient>' +
      // The centre's colours on the stone, for the moment the door opens.
      '<radialGradient id="' + id + 'magic" gradientUnits="userSpaceOnUse" cx="200" cy="260" r="300">' +
      '<stop offset="0" stop-color="#fff2c4" stop-opacity=".55"/><stop offset=".45" stop-color="' + COLORS.teal + '" stop-opacity=".26"/><stop offset="1" stop-color="' + COLORS.magenta + '" stop-opacity="0"/></radialGradient>' +
      // The stone of the frame: warm where the torches reach it.
      '<linearGradient id="' + id + 'stone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + COLORS.stoneLight + '"/><stop offset=".5" stop-color="' + COLORS.stone + '"/><stop offset="1" stop-color="' + COLORS.stoneDark + '"/></linearGradient>' +
      '<radialGradient id="' + id + 'stoneWarm" gradientUnits="userSpaceOnUse" cx="200" cy="220" r="210"><stop offset="0" stop-color="#ffcf8a" stop-opacity=".16"/><stop offset=".6" stop-color="#ff9a40" stop-opacity=".06"/><stop offset="1" stop-color="#ff9a40" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="' + id + 'step" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8d8296"/><stop offset=".4" stop-color="#5f5568"/><stop offset="1" stop-color="#2c2533"/></linearGradient>' +
      // Gilding for the inscription and the keystone's setting.
      '<linearGradient id="' + id + 'gild" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0b5"/><stop offset=".45" stop-color="#e2b04a"/><stop offset="1" stop-color="#8a5a18"/></linearGradient>' +
      '<linearGradient id="' + id + 'gildRing" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2bf"/><stop offset=".5" stop-color="#d8a43c"/><stop offset="1" stop-color="#6b4210"/></linearGradient>' +
      '<radialGradient id="' + id + 'enamel" cx=".4" cy=".35"><stop offset="0" stop-color="#2c2636"/><stop offset="1" stop-color="#0c0a10"/></radialGradient>' +
      '<filter id="' + id + 'glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4" result="b"/><feGaussianBlur stdDeviation="6" result="w"/><feMerge><feMergeNode in="w"/><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '<filter id="' + id + 'soften" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="6"/></filter>' +
      '<path id="' + id + 'arc" d="M' + (ARCH.cx - INSCRIPTION_R) + ',' + ARCH.cy + 'A' + INSCRIPTION_R + ',' + INSCRIPTION_R + ' 0 0 1 ' + (ARCH.cx + INSCRIPTION_R) + ',' + ARCH.cy + '"/>' +
      '</defs>');

    // The wall: everything except the doorway. The worksheet shows through the hole.
    parts.push('<path d="' + wallHole + '" fill="#110d14" fill-rule="evenodd"/>');
    parts.push('<path class="rdWall" d="' + wallHole + '" fill="url(#' + id + 'bricksA)" fill-rule="evenodd"/>');
    parts.push('<path d="' + wallHole + '" fill="url(#' + id + 'bricksB)" fill-rule="evenodd"/>');
    var floorPath = 'M' + (-far) + ',' + (STEP.y + STEP.h - 2) + 'H' + (VB.w + far) + 'V' + (VB.h + far) + 'H' + (-far) + 'Z';
    parts.push('<path class="rdFloor" d="' + floorPath + '" fill="#0d0a10"/>');
    parts.push('<path d="' + floorPath + '" fill="url(#' + id + 'flagsA)"/><path d="' + floorPath + '" fill="url(#' + id + 'flagsB)"/>');
    // Torchlight pooled on the wall round each sconce.
    parts.push('<ellipse cx="' + (VB.w * (TORCH.x + TORCH.w / 2) / 100) + '" cy="' + (VB.h * TORCH.y / 100) + '" rx="95" ry="120" fill="url(#' + id + 'torchPool)"/>');
    parts.push('<ellipse cx="' + (VB.w * (100 - TORCH.x - TORCH.w / 2) / 100) + '" cy="' + (VB.h * TORCH.y / 100) + '" rx="95" ry="120" fill="url(#' + id + 'torchPool)"/>');

    // The frame's shadow on the wall: the whole arch stands proud of it.
    var frameOutline = 'M' + JAMB.outer + ',' + STEP.y + 'V' + ARCH.cy + 'A' + (VOUSSOIR.r1 + 2) + ',' + (VOUSSOIR.r1 + 2) + ' 0 0 1 ' + (VB.w - JAMB.outer) + ',' + ARCH.cy + 'V' + STEP.y + 'Z' + archPath();
    parts.push('<path d="' + frameOutline + '" fill="#000" fill-rule="evenodd" opacity=".6" filter="url(#' + id + 'soften)" transform="translate(0,6)"/>');

    // The stones of the frame, lit as one: the jambs and the voussoirs.
    var stones = [];
    var tint = rng(73);
    var rows = [[200, 246], [246, 286], [286, 334], [334, 376], [376, 424], [424, 470]];
    var cracks = [];
    [0, 1].forEach(function (side) {
      rows.forEach(function (row, i) {
        var wide = (i + side) % 2 === 0;
        var x0 = side ? ARCH.right : JAMB.outer - (wide ? 6 : 0);
        var x1 = side ? VB.w - JAMB.outer + (wide ? 6 : 0) : ARCH.left;
        stones.push('<rect class="rdBlock" x="' + (x0 + 1.4) + '" y="' + (row[0] + 1.4) + '" width="' + (x1 - x0 - 2.8) + '" height="' + (row[1] - row[0] - 2.8) + '" rx="3.5" fill="' + stoneTint(tint, COLORS.stone) + '"/>');
        if ((i * 7 + side * 3) % 5 === 1) {
          var cx = (x0 + x1) / 2;
          cracks.push('<path d="M' + (cx - 6) + ',' + (row[0] + 8) + 'l5,7l-3,6l6,8l-2,5" fill="none" stroke="#17121b" stroke-width="1.1" stroke-linecap="round" opacity=".7"/>' +
            '<path d="M' + (cx - 5.2) + ',' + (row[0] + 8.8) + 'l5,7l-3,6l6,8" fill="none" stroke="#b9aec2" stroke-width=".5" opacity=".35"/>');
        }
      });
    });
    var n = VOUSSOIR.n;
    for (var i = 0; i < n; i++) {
      var a0 = 180 - (i / n) * 180, a1 = 180 - ((i + 1) / n) * 180;
      var key = i === Math.floor(n / 2);
      stones.push('<path class="rdBlock' + (key ? ' rdKey' : '') + '" d="' + voussoirPath(a0 - 0.55, a1 + 0.55, VOUSSOIR.r0, key ? VOUSSOIR.key : VOUSSOIR.r1) + '" fill="' + stoneTint(tint, key ? '#7a6f80' : COLORS.stone) + '"/>');
    }
    // The threshold step, one long stone.
    stones.push('<rect class="rdStep" x="' + STEP.left + '" y="' + STEP.y + '" width="' + (STEP.right - STEP.left) + '" height="' + STEP.h + '" rx="3" fill="#5c5266"/>');
    parts.push('<g class="rdStones" filter="url(#' + id + 'stoneFx)">' + stones.join('') + '</g>');
    // Torchlight warming the stone, and the cracks on top of it.
    parts.push('<path d="' + frameOutline + '" fill="url(#' + id + 'stoneWarm)" fill-rule="evenodd" style="mix-blend-mode:screen"/>');
    parts.push(cracks.join(''));
    // The light from under the door, on the step and the floor in front of it.
    parts.push('<clipPath id="' + id + 'below"><rect x="-200" y="' + STEP.y + '" width="800" height="200"/></clipPath>');
    parts.push('<ellipse class="rdSpill" cx="' + ARCH.cx + '" cy="' + STEP.y + '" rx="160" ry="52" fill="url(#' + id + 'spill)" clip-path="url(#' + id + 'below)" style="mix-blend-mode:screen"/>');

    // The keystone's emblem: the logo inlaid in enamel, in a gilded ring.
    // It sits high in the keystone, above the inscription's line.
    var kx = ARCH.cx, ky = ARCH.cy - (INSCRIPTION_R + VOUSSOIR.key) / 2 - 10;
    parts.push('<g class="rdKeyEmblem" transform="translate(' + kx + ',' + round1(ky) + ') scale(.72)">' +
      '<circle r="15.5" fill="#000" opacity=".5" transform="translate(0,1.6)" filter="url(#' + id + 'glow)"/>' +
      '<circle r="15" fill="url(#' + id + 'gildRing)" stroke="#4a2e0b" stroke-width=".8"/>' +
      '<circle r="12.4" fill="url(#' + id + 'enamel)" stroke="#5e3d14" stroke-width=".8"/>' +
      '<g transform="translate(-9,-9) scale(.18)">' + logoSvg(false, 'rdKeyLogo') + '</g>' +
      '<path d="M-9,-6.5A11,11 0 0 1 6,-9.5" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" opacity=".3"/></g>');

    parts.push('</svg>');

    /* Everything above this line is STILL, and expensive: every stone is
       lit through a filter. Everything below moves — the torchlight
       breathes, the magic wakes, the letters light — so it is a second
       SVG over the first. One element's opacity changing repaints its
       whole SVG; in one SVG, every flicker of a torch re-lit every stone
       of the wall, and the scene ran at a fifth of its frame rate. */
    parts.push('<svg class="rdFrame rdFrameFx" viewBox="0 0 ' + VB.w + ' ' + VB.h + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">');
    parts.push('<path class="rdWarm" d="' + wallHole + '" fill="url(#' + id + 'warm)" fill-rule="evenodd"/>');
    parts.push('<path class="rdMagic" d="' + wallHole + '" fill="url(#' + id + 'magic)" fill-rule="evenodd" opacity="0"/>');
    // The dark at the edges goes under the lettering: the inscription is
    // lit from within, and a vignette over it put the light out.
    parts.push('<path class="rdVig" d="' + wallHole + '" fill="url(#' + id + 'vig)" fill-rule="evenodd"/>');

    // The inscription round the arch, cut into the stone and gilded: a
    // dark cut, the gold in it, and a lit copy whose letters start at
    // nothing and light one by one in the centre's colours.
    var size = inscriptionSize(inscription);
    var letters = inscriptionColors(inscription);
    var tspans = function (cls, fillFn) {
      return letters.map(function (l, i) {
        return '<tspan class="' + cls + '" data-i="' + i + '"' + (fillFn ? ' fill-opacity="0"' : '') + (fillFn ? ' fill="' + fillFn(l) + '"' : '') + '>' + (l.ch === ' ' ? ' ' : esc(l.ch)) + '</tspan>';
      }).join('');
    };
    var textAttrs = ' font-size="' + size + '" text-anchor="middle" letter-spacing="' + round1(size * 0.08) + '"';
    parts.push('<text class="rdCarveHi"' + textAttrs + ' transform="translate(0,-1.1)"><textPath href="#' + id + 'arc" startOffset="50%">' + esc(inscription) + '</textPath></text>');
    parts.push('<text class="rdCarve"' + textAttrs + ' fill="url(#' + id + 'gild)"><textPath href="#' + id + 'arc" startOffset="50%">' + esc(inscription) + '</textPath></text>');
    parts.push('<text class="rdLit"' + textAttrs + ' filter="url(#' + id + 'glow)"><textPath href="#' + id + 'arc" startOffset="50%">' +
      tspans('rdLetter', function (l) { return l.color || 'transparent'; }) + '</textPath></text>');

    // Runes along the threshold step: the same words, in the old letters.
    var line = runeLine(inscription.replace(/[^A-Za-z ]/g, ''), ARCH.cx, STEP.y + 5, 11);
    parts.push('<g class="rdStepRunes">' + line.glyphs.map(function (g) {
      return '<path class="rdStepRune" data-i="' + g.i + '" d="' + g.d + '"/>';
    }).join('') + '</g>');

    parts.push('</svg>');
    return parts.join('');
  }

  /* ---- a leaf of the door ----
     Drawn once, as the LEFT leaf, in stage coordinates (x 90 → 200). The
     right leaf is the same drawing mirrored about the seam, so the two
     can never disagree about where a strap or a rivet is.

     Oak planks in a heavy frame, each plank its own tone and grain, the
     grain LIT (it is a relief, not a stripe); wrought-iron straps that
     stand off the wood with a shadow under them, domed rivets, scrolled
     hinges, a brass seam and a ring pull on a rosette; the light beyond
     leaking round the seam onto the wood. */
  function leafSvg(id, side) {
    var mirror = side === 'right';
    var x0 = ARCH.left, x1 = SEAM.x - SEAM.gap;
    var vb = mirror ? (SEAM.x + SEAM.gap) + ' ' + ARCH.top + ' ' + (ARCH.right - SEAM.x - SEAM.gap) : x0 + ' ' + ARCH.top + ' ' + (x1 - x0);
    // The right leaf is the left one turned over about the seam. The turn
    // goes INSIDE every filtered group, never round one: a lighting filter
    // on a group with a negative scale renders black in Chrome (its filter
    // region turns inside out), and so does a CSS flip of the whole SVG.
    var flip = 'translate(' + (SEAM.x * 2) + ',0) scale(-1,1)';
    var M = function (c) { return mirror ? '<g transform="' + flip + '">' + c + '</g>' : c; };
    var shape = 'M' + x0 + ',' + ARCH.bottom + 'V' + ARCH.cy + 'A' + ARCH.r + ',' + ARCH.r + ' 0 0 1 ' + SEAM.x + ',' + ARCH.top + 'L' + x1 + ',' + ARCH.top + 'V' + ARCH.bottom + 'Z';
    var inset = 9;
    var inner = 'M' + (x0 + inset) + ',' + (ARCH.bottom - inset) + 'V' + ARCH.cy + 'A' + (ARCH.r - inset) + ',' + (ARCH.r - inset) + ' 0 0 1 ' + SEAM.x + ',' + (ARCH.top + inset) + 'L' + (x1 - inset + 2) + ',' + (ARCH.top + inset) + 'V' + (ARCH.bottom - inset) + 'Z';
    var cid = id + side;
    var h = ARCH.bottom - ARCH.top;
    var p = [];
    p.push('<svg class="rdLeafArt" viewBox="' + vb + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">');
    p.push('<defs><clipPath id="' + cid + 'clip"><path d="' + shape + '"' + (mirror ? ' transform="' + flip + '"' : '') + '/></clipPath>' +
      '<clipPath id="' + cid + 'inner"><path d="' + inner + '"/></clipPath>' +
      reliefFilter(cid + 'wood', { freq: '.16 .009', octaves: 4, seed: mirror ? 13 : 7, bevel: 1.6, rough: 0.75, depth: 2.4, gain: 1.3, shine: 0.35, sharp: 22, glint: '#ffcf9a', azimuth: 200, elevation: 48 }) +
      reliefFilter(cid + 'iron', { freq: '.8', octaves: 2, seed: 4, bevel: 1.1, rough: 0.25, depth: 2.6, gain: 1.35, shine: 0.9, sharp: 30, glint: '#ffe6c0' }) +
      shadowFilter(cid + 'standOff', 0, 2.2, 1.6, 0.85) +
      '<linearGradient id="' + cid + 'plank" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="' + COLORS.woodDark + '"/><stop offset=".3" stop-color="' + COLORS.wood + '"/><stop offset=".72" stop-color="' + COLORS.woodLight + '"/><stop offset="1" stop-color="' + COLORS.wood + '"/></linearGradient>' +
      '<linearGradient id="' + cid + 'rail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#24150e"/><stop offset=".5" stop-color="#4a2f22"/><stop offset="1" stop-color="#2a1910"/></linearGradient>' +
      '<linearGradient id="' + cid + 'ironG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#77707f"/><stop offset=".22" stop-color="#46404d"/><stop offset=".6" stop-color="' + COLORS.iron + '"/><stop offset="1" stop-color="#0f0d12"/></linearGradient>' +
      '<linearGradient id="' + cid + 'brass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6b4512"/><stop offset=".35" stop-color="' + COLORS.gold + '"/><stop offset=".55" stop-color="#fff0b8"/><stop offset="1" stop-color="' + COLORS.goldDeep + '"/></linearGradient>' +
      '<radialGradient id="' + cid + 'rivet" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#e6dff0"/><stop offset=".3" stop-color="#8d8597"/><stop offset=".75" stop-color="#3a3442"/><stop offset="1" stop-color="#1a161e"/></radialGradient>' +
      '<linearGradient id="' + cid + 'shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset=".22" stop-color="#000" stop-opacity="0"/><stop offset=".82" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".2"/></linearGradient>' +
      '<linearGradient id="' + cid + 'topShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".6"/><stop offset=".22" stop-color="#000" stop-opacity="0"/><stop offset=".85" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></linearGradient>' +
      '<linearGradient id="' + cid + 'leak" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#ffcf7a" stop-opacity=".55"/><stop offset=".12" stop-color="#ff9a40" stop-opacity=".18"/><stop offset=".4" stop-color="#ff9a40" stop-opacity="0"/></linearGradient>' +
      '<radialGradient id="' + cid + 'warmth" gradientUnits="userSpaceOnUse" cx="200" cy="250" r="170"><stop offset="0" stop-color="#ffb35c" stop-opacity=".22"/><stop offset="1" stop-color="#ffb35c" stop-opacity="0"/></radialGradient>' +
      '</defs>');
    p.push('<g>');
    p.push('<g clip-path="url(#' + cid + 'clip)">');
    // Behind everything: the dark of the gaps between the boards.
    p.push(M('<rect x="' + x0 + '" y="' + ARCH.top + '" width="' + (x1 - x0) + '" height="' + h + '" fill="#0b0604"/>'));
    // The frame and the planks, lit as one carved surface.
    var wood = [];
    wood.push('<path d="' + shape + '" fill="url(#' + cid + 'rail)"/>');
    var planks = 4;
    var plankW = (x1 - inset - (x0 + inset)) / planks;
    var grain = rng(mirror ? 31 : 17);
    var tones = [];
    for (var k = 0; k < planks; k++) {
      var px = x0 + inset + k * plankW;
      tones.push(mix(COLORS.wood, grain() > 0.5 ? '#86593f' : '#2e1b12', 0.15 + grain() * 0.3));
      wood.push('<rect x="' + round1(px + 0.7) + '" y="' + ARCH.top + '" width="' + round1(plankW - 1.4) + '" height="' + h + '" fill="' + tones[k] + '" clip-path="url(#' + cid + 'inner)"/>');
    }
    p.push('<g filter="url(#' + cid + 'wood)">' + M(wood.join('')) + '</g>');
    // The plank gradient on top of the grain: each board rounded a little.
    for (var k2 = 0; k2 < planks; k2++) {
      var qx = x0 + inset + k2 * plankW;
      p.push(M('<rect x="' + round1(qx + 0.7) + '" y="' + ARCH.top + '" width="' + round1(plankW - 1.4) + '" height="' + h + '" fill="url(#' + cid + 'plank)" opacity=".35" style="mix-blend-mode:overlay" clip-path="url(#' + cid + 'inner)"/>'));
      // A knot or two, with the grain flowing round it.
      if (grain() > 0.3) {
        var ky = 230 + grain() * 200, kx = qx + plankW / 2 + (grain() - 0.5) * 8;
        p.push(M('<g clip-path="url(#' + cid + 'inner)"><ellipse cx="' + round1(kx) + '" cy="' + round1(ky) + '" rx="2.6" ry="4.6" fill="#170c07" opacity=".85"/>' +
          '<ellipse cx="' + round1(kx) + '" cy="' + round1(ky) + '" rx="4.8" ry="8" fill="none" stroke="#170c07" stroke-width=".7" opacity=".55"/>' +
          '<ellipse cx="' + round1(kx) + '" cy="' + round1(ky) + '" rx="6.8" ry="12" fill="none" stroke="#170c07" stroke-width=".5" opacity=".35"/>' +
          '<ellipse cx="' + round1(kx - 0.8) + '" cy="' + round1(ky - 1.6) + '" rx="1" ry="1.6" fill="#a8805f" opacity=".35"/></g>'));
      }
    }
    // The groove where the frame meets the boards: a cut and its lit lip.
    p.push(M('<path d="' + inner + '" fill="none" stroke="#0b0609" stroke-width="2"/>'));
    p.push(M('<path d="' + inner + '" fill="none" stroke="#a57a5c" stroke-width=".6" opacity=".45" transform="translate(.8,.9)"/>'));
    // Shading: dark at the hinge and under the arch, lit by the torches.
    p.push(M('<rect x="' + x0 + '" y="' + ARCH.top + '" width="' + (x1 - x0) + '" height="' + h + '" fill="url(#' + cid + 'shade)"/>'));
    p.push(M('<rect x="' + x0 + '" y="' + ARCH.top + '" width="' + (x1 - x0) + '" height="' + h + '" fill="url(#' + cid + 'topShade)"/>'));
    p.push(M('<rect x="' + x0 + '" y="' + ARCH.top + '" width="' + (x1 - x0) + '" height="' + h + '" fill="url(#' + cid + 'warmth)" style="mix-blend-mode:screen"/>'));
    // Wrought-iron straps: a spear-tipped band, a scrolled hinge at the
    // outer edge, domed rivets — standing off the wood.
    var iron = [];
    var rivets = [];
    [176, 300, 418].forEach(function (y) {
      var t = 14;
      var tip = x1 - 14;
      iron.push('<path d="M' + (x0 - 4) + ',' + y + 'H' + (tip - 10) + 'L' + tip + ',' + (y - 4) + 'L' + (tip + 8) + ',' + (y + t / 2) + 'L' + tip + ',' + (y + t + 4) + 'L' + (tip - 10) + ',' + (y + t) + 'H' + (x0 - 4) + 'Z" fill="url(#' + cid + 'ironG)"/>');
      // The hinge's scrolls, curling back from the strap.
      iron.push('<path d="M' + (x0 + 4) + ',' + (y + 1) + 'c14,-2 24,-9 30,-20c3,-6 -2,-11 -7,-8c-4,3 -1,8 3,6" fill="none" stroke="url(#' + cid + 'ironG)" stroke-width="3.6" stroke-linecap="round"/>');
      iron.push('<path d="M' + (x0 + 4) + ',' + (y + t - 1) + 'c14,2 24,9 30,20c3,6 -2,11 -7,8c-4,-3 -1,-8 3,-6" fill="none" stroke="url(#' + cid + 'ironG)" stroke-width="3.6" stroke-linecap="round"/>');
      for (var rx = x0 + 10; rx < tip - 8; rx += 15) {
        rivets.push('<circle cx="' + round1(rx) + '" cy="' + (y + t / 2) + '" r="2.7" fill="url(#' + cid + 'rivet)"/>');
      }
      rivets.push('<circle cx="' + tip + '" cy="' + (y + t / 2) + '" r="3" fill="url(#' + cid + 'rivet)"/>');
      // The strap's lit top edge.
      rivets.push('<path d="M' + (x0 - 4) + ',' + (y + 0.8) + 'H' + (tip - 10) + '" stroke="#b6aec2" stroke-width=".7" opacity=".55"/>');
    });
    p.push('<g filter="url(#' + cid + 'standOff)"><g filter="url(#' + cid + 'iron)">' + M(iron.join('')) + '</g></g>');
    p.push(M(rivets.join('')));
    // Light from beyond, leaking round the seam onto the boards.
    p.push(M('<rect class="rdLeak" x="' + x0 + '" y="' + ARCH.top + '" width="' + (x1 - x0) + '" height="' + h + '" fill="url(#' + cid + 'leak)" style="mix-blend-mode:screen"/>'));
    p.push('</g>');
    // Brass trim down the seam, riveted.
    p.push('<g filter="url(#' + cid + 'standOff)">' + M('<rect x="' + (x1 - 6.5) + '" y="' + (ARCH.top + 1) + '" width="6.5" height="' + (h - 1) + '" fill="url(#' + cid + 'brass)"/>') + '</g>');
    for (var by = ARCH.top + 30; by < ARCH.bottom - 10; by += 34) {
      p.push(M('<circle cx="' + (x1 - 3.2) + '" cy="' + by + '" r="1.5" fill="#fff3c8" opacity=".8"/><circle cx="' + (x1 - 3.2) + '" cy="' + (by + 0.6) + '" r="1.5" fill="none" stroke="#5e3d14" stroke-width=".5"/>'));
    }
    // An iron ring pull on a rosette.
    var ringX = x1 - 22, ringY = 362;
    p.push('<g filter="url(#' + cid + 'standOff)">' + M(
      '<path d="' + starPath(8, 9, 6.2, 0).replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, function (m, a, b) { return round1(+a + ringX) + ',' + round1(+b + ringY); }) + '" fill="url(#' + cid + 'ironG)"/>' +
      '<circle cx="' + ringX + '" cy="' + ringY + '" r="3.6" fill="url(#' + cid + 'rivet)"/>' +
      '<ellipse cx="' + ringX + '" cy="' + (ringY + 13) + '" rx="9.5" ry="11" fill="none" stroke="#1a161e" stroke-width="4.4"/>' +
      '<ellipse cx="' + ringX + '" cy="' + (ringY + 13) + '" rx="9.5" ry="11" fill="none" stroke="url(#' + cid + 'ironG)" stroke-width="3"/>' +
      '<path d="M' + (ringX - 8) + ',' + (ringY + 8) + 'a9.5,11 0 0 1 6,-6" fill="none" stroke="#d8d0e2" stroke-width=".9" opacity=".6"/>') + '</g>');
    p.push(M('<path d="' + shape + '" fill="none" stroke="#080507" stroke-width="2.6"/>'));
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
      '<linearGradient id="' + id + 'seam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffb347" stop-opacity="0"/><stop offset=".35" stop-color="#ffcf6b" stop-opacity=".6"/><stop offset=".5" stop-color="#fffbe6"/><stop offset=".65" stop-color="#ffcf6b" stop-opacity=".6"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></linearGradient>' +
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
    p.push('<rect class="rdSeam" x="' + (SEAM.x - 7) + '" y="' + ARCH.top + '" width="14" height="' + h + '" fill="url(#' + id + 'seam)"/>');
    p.push('</g></svg>');
    return p.join('');
  }

  /* A star whose every point is cut into two facets, one towards the
     light (top left) and one away from it, so the brass reads as solid
     metal rather than a flat shape. Returns path elements. */
  var LIGHT_ANGLE = Math.atan2(-1, -1);
  function facetStar(points, outer, inner, turn, light, dark) {
    var out = '';
    var step = Math.PI / points;
    for (var i = 0; i < points; i++) {
      var a = (i / points) * Math.PI * 2 - Math.PI / 2 + (turn || 0);
      var tip = [round1(Math.cos(a) * outer), round1(Math.sin(a) * outer)];
      var bl = [round1(Math.cos(a - step) * inner), round1(Math.sin(a - step) * inner)];
      var br = [round1(Math.cos(a + step) * inner), round1(Math.sin(a + step) * inner)];
      [[bl, a - Math.PI / 2], [br, a + Math.PI / 2]].forEach(function (f) {
        var b = 0.5 + 0.5 * Math.cos(f[1] - LIGHT_ANGLE);
        out += '<path d="M0,0L' + tip + 'L' + f[0] + 'Z" fill="' + mix(dark, light, b) + '"/>';
      });
    }
    return out;
  }

  /* ---- the rune: an iron boss on the door, a faceted brass star, a
     gilded bezel, a band of enamel with the rim glyphs and eight gems,
     and the logo under glass. ---- */
  function runeSvg(id) {
    var p = [];
    p.push('<svg class="rdRuneArt" viewBox="-100 -100 200 200" aria-hidden="true">');
    p.push('<defs>' +
      '<radialGradient id="' + id + 'halo"><stop offset=".35" stop-color="#ffffff" stop-opacity=".9"/><stop offset=".55" stop-color="' + COLORS.teal + '" stop-opacity=".75"/><stop offset=".8" stop-color="' + COLORS.magenta + '" stop-opacity=".4"/><stop offset="1" stop-color="' + COLORS.magenta + '" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="' + id + 'soft"><stop offset=".5" stop-color="#ffd27a" stop-opacity=".55"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="' + id + 'gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff4c4"/><stop offset=".35" stop-color="' + COLORS.gold + '"/><stop offset=".7" stop-color="#b47a22"/><stop offset="1" stop-color="#5a3608"/></linearGradient>' +
      '<linearGradient id="' + id + 'goldIn" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff0b8"/><stop offset=".5" stop-color="#c8913a"/><stop offset="1" stop-color="#4f2f08"/></linearGradient>' +
      '<radialGradient id="' + id + 'boss" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#6c6476"/><stop offset=".55" stop-color="#2c2633"/><stop offset="1" stop-color="#100d13"/></radialGradient>' +
      '<radialGradient id="' + id + 'band" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#2b2340"/><stop offset=".7" stop-color="#14101f"/><stop offset="1" stop-color="#07050b"/></radialGradient>' +
      '<radialGradient id="' + id + 'glass" cx=".42" cy=".36" r=".72"><stop offset="0" stop-color="#2e2a3e"/><stop offset=".7" stop-color="#121019"/><stop offset="1" stop-color="#050408"/></radialGradient>' +
      '<radialGradient id="' + id + 'gemT" cx=".35" cy=".3"><stop offset="0" stop-color="#ffffff"/><stop offset=".35" stop-color="' + COLORS.teal + '"/><stop offset="1" stop-color="' + LOGO.tealShade + '"/></radialGradient>' +
      '<radialGradient id="' + id + 'gemM" cx=".35" cy=".3"><stop offset="0" stop-color="#ffd6ef"/><stop offset=".35" stop-color="' + COLORS.magenta + '"/><stop offset="1" stop-color="' + LOGO.magentaShade + '"/></radialGradient>' +
      '<radialGradient id="' + id + 'rivet" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#e6dff0"/><stop offset=".35" stop-color="#857d90"/><stop offset="1" stop-color="#16131a"/></radialGradient>' +
      '<filter id="' + id + 'blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>' +
      '<filter id="' + id + 'drop" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4"/></filter>' +
      '</defs>');
    // Behind: the soft idle glow, and the teal/magenta halo that wakes.
    p.push('<circle class="rdSoft" r="98" fill="url(#' + id + 'soft)" opacity=".3"/>');
    p.push('<g class="rdHalo" opacity="0"><circle r="99" fill="url(#' + id + 'halo)"/>' +
      '<circle r="86" fill="none" stroke="' + COLORS.teal + '" stroke-width="5" stroke-dasharray="40 22" opacity=".85"/>' +
      '<circle r="92" fill="none" stroke="' + COLORS.magenta + '" stroke-width="3" stroke-dasharray="18 30" opacity=".85"/></g>');
    // Its shadow on the door, and the iron boss it is mounted on.
    p.push('<circle r="84" fill="#000" opacity=".6" transform="translate(2,6)" filter="url(#' + id + 'drop)"/>');
    p.push('<circle r="82" fill="url(#' + id + 'boss)" stroke="#07060a" stroke-width="2"/>');
    p.push('<circle r="78" fill="none" stroke="#8d8597" stroke-width=".8" opacity=".35"/>');
    for (var r0 = 0; r0 < 16; r0++) {
      var ra = (r0 / 16) * Math.PI * 2 + Math.PI / 16;
      p.push('<circle cx="' + round1(Math.cos(ra) * 74) + '" cy="' + round1(Math.sin(ra) * 74) + '" r="2.6" fill="url(#' + id + 'rivet)"/>');
    }
    p.push('<circle class="rdShock rdShock1" r="70" fill="none" stroke="#ffffff" stroke-width="4" opacity="0"/>');
    p.push('<circle class="rdShock rdShock2" r="70" fill="none" stroke="' + COLORS.teal + '" stroke-width="6" opacity="0"/>');
    p.push('<circle class="rdTap" r="70" fill="none" stroke="#fff4c8" stroke-width="5" opacity="0"/>');
    // The part that spins.
    p.push('<g class="rdSpin">');
    p.push('<g>' + facetStar(8, 78, 46, Math.PI / 8, '#f6d27a', '#5a3608') + '</g>');
    p.push('<path d="' + starPath(8, 78, 46, Math.PI / 8) + '" fill="none" stroke="#3b2306" stroke-width="1.6" stroke-linejoin="round"/>');
    p.push('<g>' + facetStar(8, 97, 54, 0, '#fff4c4', '#7a4c12') + '</g>');
    p.push('<path d="' + starPath(8, 97, 54, 0) + '" fill="none" stroke="#3b2306" stroke-width="2" stroke-linejoin="round"/>');
    // The bezel: a gilded ring with its bevel cut the other way inside.
    p.push('<circle r="65" fill="url(#' + id + 'gold)" stroke="#3b2306" stroke-width="1.6"/>');
    p.push('<circle r="60.5" fill="url(#' + id + 'goldIn)"/>');
    p.push('<circle r="57.5" fill="url(#' + id + 'band)" stroke="#1d1308" stroke-width="1.2"/>');
    // Eight rim glyphs: POLYMATH, engraved in the gold and lit in turn.
    var rim = 'POLYMATH'.split('');
    rim.forEach(function (ch, i) {
      var a = (i / rim.length) * 360;
      var g = runeGlyph(ch, -4.2, -55, 10.5);
      p.push('<g transform="rotate(' + a + ')"><path class="rdRimDark" d="' + g + '"/><path class="rdRimLit" data-i="' + i + '" d="' + g + '" stroke="' + (i % 2 ? COLORS.magenta : COLORS.teal) + '" opacity="0"/></g>');
    });
    // Eight gems between the glyphs, teal and magenta in turn.
    for (var gi = 0; gi < 8; gi++) {
      var ga = (gi / 8) * Math.PI * 2 + Math.PI / 8 - Math.PI / 2;
      var gx = round1(Math.cos(ga) * 50), gy = round1(Math.sin(ga) * 50);
      p.push('<circle cx="' + gx + '" cy="' + gy + '" r="4.2" fill="#c8913a" stroke="#3b2306" stroke-width=".8"/>' +
        '<circle cx="' + gx + '" cy="' + gy + '" r="3" fill="url(#' + id + (gi % 2 ? 'gemM' : 'gemT') + ')"/>' +
        '<circle cx="' + round1(gx - 1) + '" cy="' + round1(gy - 1.1) + '" r=".9" fill="#fff" opacity=".9"/>');
    }
    // The inner bezel and the glass the logo sits under.
    p.push('<circle r="43" fill="url(#' + id + 'goldIn)" stroke="#3b2306" stroke-width="1"/>');
    p.push('<circle r="40" fill="url(#' + id + 'glass)" stroke="#5e3d14" stroke-width="1"/>');
    p.push('<circle r="39" fill="none" stroke="#000" stroke-width="3" opacity=".45"/>');
    // The logo, and a blurred lit copy that blooms.
    p.push('<g class="rdLogoGroup" transform="translate(-28,-28) scale(.56)">');
    p.push('<g class="rdLogoBloom" opacity="0" filter="url(#' + id + 'blur)">' + logoSvg(true, 'rdLogoBloomFaces') + '</g>');
    p.push(logoSvg(false, 'rdLogo'));
    p.push('<g class="rdLogoLit" opacity="0">' + logoSvg(true, 'rdLogoLitFaces') + '</g>');
    p.push('</g>');
    // A reflection across the glass, and a sharp glint on the bezel.
    p.push('<path d="M-34,-12A36,36 0 0 1 12,-35A40,40 0 0 0 -28,-4Z" fill="#ffffff" opacity=".12"/>');
    p.push('<path d="M-46,-38A60,60 0 0 1 -8,-60" fill="none" stroke="#fffbe6" stroke-width="2.2" stroke-linecap="round" opacity=".7"/>');
    p.push('</g>');
    p.push('</svg>');
    return p.join('');
  }

  /* ---- a torch in its wrought-iron sconce ---- */
  function torchHtml(side) {
    var g = 'rdTorchG' + side;
    return '<div class="rdTorch rdTorch' + side + '" aria-hidden="true">' +
      '<div class="rdTorchLight"></div>' +
      '<div class="rdFlame"><span class="rdFlameGlow"></span><span class="rdFlameOuter"></span><span class="rdFlameMid"></span><span class="rdFlameCore"></span></div>' +
      '<svg class="rdSconce" viewBox="0 0 40 70"><defs>' +
      '<linearGradient id="' + g + 'w" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1e140d"/><stop offset=".5" stop-color="#5a3b24"/><stop offset="1" stop-color="#22160e"/></linearGradient>' +
      '<linearGradient id="' + g + 'i" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#16131a"/><stop offset=".45" stop-color="#6f6779"/><stop offset="1" stop-color="#1c1820"/></linearGradient>' +
      '</defs>' +
      '<path d="M9,5h22l-5,15h-12z" fill="url(#' + g + 'w)" stroke="#0e0906" stroke-width="1.4"/>' +
      '<path d="M8,4h24v3h-24z" fill="url(#' + g + 'i)" stroke="#0e0906" stroke-width="1"/>' +
      '<path d="M14,20h12l-2,30h-8z" fill="url(#' + g + 'w)" stroke="#0e0906" stroke-width="1.4"/>' +
      '<path d="M13,28h14M13.5,38h13" stroke="url(#' + g + 'i)" stroke-width="2.4"/>' +
      '<path d="M7,44h26l-4,8h-18z" fill="url(#' + g + 'i)" stroke="#0e0906" stroke-width="1.4"/>' +
      '<path d="M20,52v14M14,66h12" stroke="url(#' + g + 'i)" stroke-width="3.4" stroke-linecap="round"/>' +
      '<path d="M10,48c-6,3 -6,10 0,10" fill="none" stroke="url(#' + g + 'i)" stroke-width="2"/><path d="M30,48c6,3 6,10 0,10" fill="none" stroke="url(#' + g + 'i)" stroke-width="2"/>' +
      '</svg></div>';
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
      .set(s.hint, { opacity: 0, y: 12, xPercent: -50, x: 0 }, 0)
      .set(s.welcome, { opacity: 0, scale: 0.85, xPercent: -50, x: 0 }, 0)
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
    // The words are centred by translateX(-50%) in the CSS. GSAP reads a
    // transform back as pixels, measured while the text may not have its
    // face yet, so the welcome landed off to the right; say it in percent.
    gsap.set([s.hint, s.welcome], { xPercent: -50, x: 0 });
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
      .to(s.rune, { filter: 'drop-shadow(0px 0px 22px rgba(126, 191, 202, 0.95))', duration: 0.5, ease: 'power2.out' }, 0.1)
      .to(s.rune, { filter: 'drop-shadow(0px 0px 30px rgba(198, 0, 133, 0.95))', duration: 0.6, ease: 'sine.inOut', yoyo: true, repeat: 2 }, T.spinAt + 0.1)
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
      .fromTo(s.stepRunes, { opacity: 0.55 }, { opacity: 1, stroke: COLORS.teal, duration: 0.25, stagger: stepEach }, T.letters + 0.2)
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
      LOGO: LOGO, reliefFilter: reliefFilter, facetStar: facetStar, leafSvg: leafSvg,
      cleanText: cleanText, esc: esc
    }
  };
})();
