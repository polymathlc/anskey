/* =====================================================================
   🏰 Lesson start — the quest rules the teacher flashes at the start of
   every lesson (v1.166.0)
   ---------------------------------------------------------------------
   A full-screen cover ("Today's Quest") peppered with stickers of the
   class's own Wheel Quest heroes and bosses. A tap on the cover swings a
   castle gate shut across the screen, drops the bar, lifts it again and
   opens onto the quest rules: who earns what this lesson, and what to
   write down. The teacher can edit every line, and the words are kept in
   the teacher's own settings record so every device shows the same rules.

   THE TEACHER'S ALONE. index.html shows the button only to the signed-in
   teacher (applyRewardVisibility) and every handler here asks env.teacher()
   again: hiding a button has never been the lock in this app. A role or
   account change closes it (roleChanged).

   PRESENTATION ONLY. Nothing here awards a point, touches a hero or a
   battle, or reads the roster. The stickers are the existing artwork in
   assets/battle-pixel, shown at sticker size; nothing is generated.

   The pure helpers (clean, stickerSpots, stickerPicks, rng, …) sit on
   LessonSplash.pure so tools/lesson-splash-tests.mjs can run them without a
   page.
   ===================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------
     The artwork. Every hero form has one 4 × 4 sheet: male idle, male
     action, female idle, female action. Each boss atlas holds ten enemies
     on a 5 × 2 grid. Chung, the teacher's own champion, is a 4 × 2 sheet.
     ------------------------------------------------------------------ */
  var HERO_DIR = 'assets/battle-pixel/animations/';
  var BOSS_DIR = 'assets/battle-pixel/bosses/';
  var HERO_FORMS = ['warrior', 'ranger', 'mage', 'cleric', 'berserker', 'paladin',
    'sharpshooter', 'beastmaster', 'archmage', 'chronomancer', 'hierophant', 'oracle'];
  var BOSS_ATLASES = 10;
  var BOSSES_PER_ATLAS = 10;
  var CHUNG_SHEET = HERO_DIR + 'chung-sheet.png';

  /* How much of its cell each kind of sprite fills. A hero stands in the
     middle ~60% of a cell with room for a sword swing round it; a boss fills
     its cell. Scaling the hero's box up by this keeps the two looking the
     same size once they are stickers. */
  var HERO_SCALE = 1.5;
  var CHUNG_SCALE = 1.35;

  /* What a teacher can write, and how much of it. */
  var LIMITS = {
    cover: 40,
    title: 60,
    kicker: 60,
    icon: 8,
    who: 40,
    text: 220,
    reward: 24,
    items: 8
  };

  var DEFAULT = {
    v: 1,
    kicker: 'Polymath · Wheel Quest',
    cover: "Today's Quest",
    title: 'Quest rules',
    items: [
      { icon: '📹', who: 'Online students', text: 'Turn on your camera for the whole lesson.', reward: '+2 points' },
      { icon: '🤫', who: 'Physical students', text: 'Focus and keep quiet.', reward: '+2 points' },
      { icon: '📝', who: 'Everyone', text: 'Take note of any homework, if any.', reward: '' }
    ]
  };

  /* The gate's timeline, in milliseconds. */
  var GATE = {
    shut: 820,      // the doors swing shut (accelerating, so they land)
    bar: 260,       // the bar drops across them
    hold: 620,      // a beat with the gate shut
    lift: 240,      // the bar lifts
    open: 980,      // the doors open onto the rules
    shake: 380      // the screen shakes as the doors meet
  };

  /* ------------------------------------------------------------------
     Pure helpers
     ------------------------------------------------------------------ */

  /* A small seeded generator (mulberry32), so the same seed peppers the
     same stickers in the same places — which is what the tests pin. */
  function rng(seed) {
    var a = (Number(seed) >>> 0) || 0x9E3779B9;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, rand) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* Text a teacher typed: one line, no control characters, capped by
     CHARACTERS rather than UTF-16 units so an emoji is never cut in half. */
  function cleanLine(value, max) {
    if (value == null) return '';
    var s = String(value).replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
    var chars = Array.from(s);
    if (chars.length > max) s = chars.slice(0, max).join('').trim();
    return s;
  }

  /* The ONE door into the rules: whatever comes back from storage, a form
     or an older version is turned into this shape or refused (null). An
     item with nothing in it is dropped; a list with nothing left is
     refused, because an empty quest board is not something anybody meant
     to show a class. */
  function clean(data) {
    if (!data || typeof data !== 'object') return null;
    var out = {
      v: 1,
      kicker: cleanLine(data.kicker, LIMITS.kicker),
      cover: cleanLine(data.cover, LIMITS.cover),
      title: cleanLine(data.title, LIMITS.title),
      items: []
    };
    var items = Array.isArray(data.items) ? data.items : [];
    for (var i = 0; i < items.length && out.items.length < LIMITS.items; i++) {
      var it = items[i];
      if (!it || typeof it !== 'object') continue;
      var item = {
        icon: cleanLine(it.icon, LIMITS.icon),
        who: cleanLine(it.who, LIMITS.who),
        text: cleanLine(it.text, LIMITS.text),
        reward: cleanLine(it.reward, LIMITS.reward)
      };
      if (!item.who && !item.text) continue;
      out.items.push(item);
    }
    if (!out.items.length) return null;
    if (!out.cover) out.cover = DEFAULT.cover;
    if (!out.title) out.title = DEFAULT.title;
    if (typeof data.at === 'number' && isFinite(data.at)) out.at = data.at;
    return out;
  }

  function defaults() { return JSON.parse(JSON.stringify(DEFAULT)); }

  /* Two sets of rules are the same when what is SHOWN is the same; the
     stamp does not count. */
  function same(a, b) {
    var x = clean(a), y = clean(b);
    if (!x || !y) return x === y;
    delete x.at; delete y.at;
    return JSON.stringify(x) === JSON.stringify(y);
  }

  /* Newer of two saved copies (the device's and the account's). A copy
     without a stamp loses to one with a stamp. */
  function newer(a, b) {
    var x = clean(a), y = clean(b);
    if (!x) return y;
    if (!y) return x;
    return (y.at || 0) > (x.at || 0) ? y : x;
  }

  /* Which picture each sticker is. Heroes and bosses alternate so neither
     bunches up, every hero form is used before any repeats, and Chung —
     the teacher's own champion — is always somewhere on the page. */
  function stickerPicks(seed, count) {
    var rand = rng(seed);
    var n = Math.max(0, Math.floor(count || 0));
    var heroes = shuffle(HERO_FORMS, rand);
    var bossIds = [];
    for (var b = 0; b < BOSS_ATLASES * BOSSES_PER_ATLAS; b++) bossIds.push(b);
    bossIds = shuffle(bossIds, rand);
    var picks = [];
    var hi = 0, bi = 0;
    var chungAt = n ? Math.floor(rand() * n) : -1;
    for (var i = 0; i < n; i++) {
      if (i === chungAt) {
        picks.push({ kind: 'chung', sheet: CHUNG_SHEET, cols: 4, rows: 2, col: Math.floor(rand() * 4), row: 0, scale: CHUNG_SCALE });
        continue;
      }
      if (i % 2 === 0) {
        var form = heroes[hi % heroes.length]; hi++;
        // Rows 0/2 stand, rows 1/3 strike: a few mid-swing keep it lively.
        var female = rand() < 0.5;
        var action = rand() < 0.3;
        var row = (female ? 2 : 0) + (action ? 1 : 0);
        var col = action ? 1 + Math.floor(rand() * 2) : Math.floor(rand() * 4);
        picks.push({ kind: 'hero', form: form, sheet: HERO_DIR + form + '-genders-sheet.png', cols: 4, rows: 4, col: col, row: row, scale: HERO_SCALE, gender: female ? 'female' : 'male' });
      } else {
        var id = bossIds[bi % bossIds.length]; bi++;
        var atlas = Math.floor(id / BOSSES_PER_ATLAS) + 1;
        var within = id % BOSSES_PER_ATLAS;
        picks.push({ kind: 'boss', index: id, sheet: BOSS_DIR + 'atlas-' + String(atlas).padStart(2, '0') + '.png', cols: 5, rows: 2, col: within % 5, row: Math.floor(within / 5), scale: 1 });
      }
    }
    return picks;
  }

  /* Where the stickers go: one per cell of a jittered grid, skipping any
     cell whose sticker would touch what must stay readable (the title, the
     rules, the buttons) or hang off the screen. A grid with jitter rather
     than pure randomness, so they are PEPPERED — spread over the whole
     page — rather than clumped in one corner and missing from another.
     Returns centres, sizes, tilts and a pop-in order. */
  function stickerSpots(o) {
    o = o || {};
    var w = Math.max(0, +o.w || 0), h = Math.max(0, +o.h || 0);
    var size = Math.max(24, +o.size || 84);
    var max = Math.max(0, Math.floor(o.max == null ? 24 : o.max));
    var pad = Math.max(0, +o.pad || 0);
    var edge = Math.max(0, o.edge == null ? 6 : +o.edge);
    var avoid = (o.avoid || []).filter(function (r) { return r && r.w > 0 && r.h > 0; }).map(function (r) {
      return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
    });
    if (!w || !h || !max) return [];
    var rand = rng(o.seed);
    var cell = size * (o.spread || 1.32);
    var cols = Math.max(1, Math.floor(w / cell));
    var rows = Math.max(1, Math.floor(h / cell));
    var cw = w / cols, ch = h / rows;
    var cells = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) cells.push([c, r]);
    cells = shuffle(cells, rand);
    var spots = [];
    for (var i = 0; i < cells.length && spots.length < max; i++) {
      var cx = (cells[i][0] + 0.5) * cw + (rand() * 2 - 1) * cw * 0.26;
      var cy = (cells[i][1] + 0.5) * ch + (rand() * 2 - 1) * ch * 0.26;
      var s = size * (0.78 + rand() * 0.44);
      var half = s / 2;
      var box = { x: cx - half, y: cy - half, w: s, h: s };
      if (box.x < edge || box.y < edge || box.x + box.w > w - edge || box.y + box.h > h - edge) continue;
      var hit = false;
      for (var k = 0; k < avoid.length; k++) if (overlaps(box, avoid[k])) { hit = true; break; }
      if (hit) continue;
      spots.push({
        x: Math.round(cx), y: Math.round(cy), s: Math.round(s),
        rot: Math.round((rand() * 2 - 1) * 16 * 10) / 10,
        flip: rand() < 0.35,
        delay: 0
      });
    }
    // The pop-in runs top-left to bottom-right with a little noise, so the
    // page fills like stickers being slapped on rather than all at once.
    var order = spots.map(function (p, idx) { return { idx: idx, k: p.x / Math.max(1, w) + p.y / Math.max(1, h) + rand() * 0.35 }; })
      .sort(function (a, b) { return a.k - b.k; });
    order.forEach(function (o2, n) { spots[o2.idx].delay = n * 38; });
    return spots;
  }

  function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  /* The CSS background for one cell of a sheet. */
  function spriteStyle(pick) {
    var px = pick.cols > 1 ? (pick.col / (pick.cols - 1)) * 100 : 0;
    var py = pick.rows > 1 ? (pick.row / (pick.rows - 1)) * 100 : 0;
    return {
      image: 'url("' + pick.sheet + '")',
      size: (pick.cols * 100) + '% ' + (pick.rows * 100) + '%',
      position: round2(px) + '% ' + round2(py) + '%'
    };
  }
  function round2(n) { return Math.round(n * 100) / 100; }

  /* How many stickers suit a screen this size: plenty on a projector, a
     handful on a phone. */
  function stickerBudget(w, h) {
    var area = Math.max(0, w) * Math.max(0, h);
    return Math.max(6, Math.min(30, Math.round(area / 52000)));
  }
  function stickerSize(w, h) {
    var short = Math.min(Math.max(0, w), Math.max(0, h));
    return Math.max(52, Math.min(104, Math.round(short / 8.5)));
  }

  /* The date line on the cover, in the teacher's own words for a day. */
  function dateLine(d) {
    // Duck-typed, not instanceof: a Date from another frame is still a date.
    d = d && typeof d.getDay === 'function' && !isNaN(d.getTime()) ? d : new Date();
    var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return days[d.getDay()] + ', ' + d.getDate() + ' ' + months[d.getMonth()];
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var pure = {
    DEFAULT: DEFAULT, LIMITS: LIMITS, GATE: GATE, HERO_FORMS: HERO_FORMS,
    BOSS_ATLASES: BOSS_ATLASES, HERO_SCALE: HERO_SCALE,
    rng: rng, cleanLine: cleanLine, clean: clean, defaults: defaults, same: same, newer: newer,
    stickerPicks: stickerPicks, stickerSpots: stickerSpots, spriteStyle: spriteStyle,
    stickerBudget: stickerBudget, stickerSize: stickerSize, overlaps: overlaps,
    dateLine: dateLine, esc: esc
  };

  /* ------------------------------------------------------------------
     The overlay
     ------------------------------------------------------------------
     env = {
       teacher(): boolean        — asked by every handler
       readLocal(): data|null    — this device's copy, for an instant open
       readCloud(): Promise      — the account's copy (null when none)
       save(data): Promise<{cloud:boolean}>
       toast(text)               — optional
       now(): number             — optional, for tests
     }
     ------------------------------------------------------------------ */
  function create(env) {
    env = env || {};
    var s = null;               // the open splash, or null
    var seq = 0;                // bumps on every open/close: late work checks it

    function teacher() {
      try { return !!(env.teacher && env.teacher()); } catch (e) { return false; }
    }
    function toast(t) { try { if (env.toast) env.toast(t); } catch (e) { /* nothing */ } }
    function now() { try { return env.now ? env.now() : Date.now(); } catch (e) { return Date.now(); } }
    function reduced() {
      try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
      catch (e) { return false; }
    }

    function rules() {
      var local = null;
      try { local = clean(env.readLocal && env.readLocal()); } catch (e) { local = null; }
      return local || defaults();
    }

    function later(fn, ms) {
      if (!s) return 0;
      var mine = s;
      var id = setTimeout(function () {
        var k = mine.timers.indexOf(id);
        if (k >= 0) mine.timers.splice(k, 1);
        if (s === mine) fn();
      }, ms);
      mine.timers.push(id);
      return id;
    }
    function clearTimers() {
      if (!s) return;
      s.timers.forEach(clearTimeout);
      s.timers = [];
    }

    /* ---------------- building the screen ---------------- */

    function open() {
      if (!teacher()) return false;
      if (s) { showCover(); return true; }
      seq++;
      var back = document.createElement('div');
      back.className = 'lsBack';
      back.id = 'lessonSplash';
      back.setAttribute('role', 'dialog');
      back.setAttribute('aria-modal', 'true');
      back.setAttribute('aria-label', 'Lesson start');
      back.tabIndex = -1;
      back.innerHTML =
        '<div class="lsStage">' +
          '<section class="lsScene lsCover" data-ls-scene="cover" tabindex="0" aria-label="Cover — tap to open the gate">' +
            '<div class="lsSky" aria-hidden="true"><span class="lsStars"></span><span class="lsStars lsStars2"></span><span class="lsMoon"></span></div>' +
            '<div class="lsCastle" aria-hidden="true"><span class="lsHill"></span><span class="lsKeep"></span><span class="lsTowerL"></span><span class="lsTowerR"></span><span class="lsPortal"></span></div>' +
            '<div class="lsStickers" data-ls-stickers="cover" aria-hidden="true"></div>' +
            '<div class="lsCoverTitle">' +
              '<p class="lsKicker"></p>' +
              '<h1 class="lsCoverHead"></h1>' +
              '<p class="lsDate"></p>' +
              '<p class="lsPrompt"><span class="lsPromptKey">▶</span> Tap to open the gate</p>' +
            '</div>' +
          '</section>' +
          '<section class="lsScene lsBoardScene" data-ls-scene="board" hidden>' +
            '<div class="lsDay" aria-hidden="true"></div>' +
            '<div class="lsStickers" data-ls-stickers="board" aria-hidden="true"></div>' +
            '<div class="lsBoardWrap"><article class="lsBoard" aria-live="polite"></article></div>' +
          '</section>' +
        '</div>' +
        '<div class="lsGate" aria-hidden="true" hidden>' +
          '<div class="lsArch"></div>' +
          '<div class="lsDoor lsDoorL"><span class="lsBand lsBandT"></span><span class="lsBand lsBandB"></span><span class="lsRing"></span></div>' +
          '<div class="lsDoor lsDoorR"><span class="lsBand lsBandT"></span><span class="lsBand lsBandB"></span><span class="lsRing"></span></div>' +
          '<div class="lsBar"><span class="lsBarCap lsBarCapL"></span><span class="lsCrest"><span>⚔</span></span><span class="lsBarCap lsBarCapR"></span></div>' +
          '<div class="lsDust"><i></i><i></i><i></i><i></i><i></i><i></i></div>' +
        '</div>' +
        '<div class="lsTools" role="toolbar" aria-label="Lesson start">' +
          '<button type="button" class="lsTool" data-ls="edit" title="Edit the quest rules">✎ <span>Edit</span></button>' +
          '<button type="button" class="lsTool" data-ls="replay" title="Back to the cover (R)">↺ <span>Cover</span></button>' +
          '<button type="button" class="lsTool" data-ls="full" title="Full screen (F)">⛶ <span>Full screen</span></button>' +
          '<button type="button" class="lsTool lsClose" data-ls="close" title="Close (Esc)" aria-label="Close">✕</button>' +
        '</div>';

      s = {
        id: seq, back: back, phase: 'cover', busy: false, editing: false, saving: false,
        data: rules(), timers: [], seed: (now() >>> 0) ^ 0x5EED, resizeTimer: 0, draft: null
      };

      wire(back);
      document.body.appendChild(back);
      document.body.classList.add('lsOpen');
      fillCover();
      render();
      requestAnimationFrame(function () {
        if (!s || s.back !== back) return;
        back.classList.add('in');
        pepper('cover');
        try { back.querySelector('.lsCover').focus({ preventScroll: true }); } catch (e) { /* nothing */ }
      });
      refreshFromCloud(s.id);
      return true;
    }

    /* The account's copy arrives after the device's. It replaces what is on
       screen only while the teacher is not in the middle of editing it. */
    function refreshFromCloud(id) {
      var p;
      try { p = env.readCloud ? env.readCloud() : null; } catch (e) { p = null; }
      if (!p || typeof p.then !== 'function') return;
      p.then(function (cloud) {
        if (!s || s.id !== id) return;
        var best = newer(s.data, cloud);
        if (!best || same(best, s.data)) return;
        s.data = best;
        if (s.editing) return;
        fillCover();
        render();
      }, function () { /* the device's copy stands */ });
    }

    function fillCover() {
      if (!s) return;
      var d = s.data;
      var k = s.back.querySelector('.lsKicker');
      k.textContent = d.kicker || '';
      k.hidden = !d.kicker;
      s.back.querySelector('.lsCoverHead').textContent = d.cover;
      s.back.querySelector('.lsDate').textContent = dateLine(new Date(now()));
    }

    /* The rules, or the form that edits them. */
    function render() {
      if (!s) return;
      var board = s.back.querySelector('.lsBoard');
      var tools = s.back.querySelector('.lsTools');
      tools.querySelector('[data-ls="edit"]').hidden = s.phase !== 'board' || s.editing;
      tools.querySelector('[data-ls="replay"]').hidden = s.phase !== 'board' || s.editing;
      tools.querySelector('[data-ls="full"]').hidden = !fullscreenSupported();
      board.classList.toggle('lsEditing', s.editing);
      board.innerHTML = s.editing ? formHtml(s.draft) : boardHtml(s.data);
      board.scrollTop = 0;
      if (s.editing) wireForm(board);
    }

    function boardHtml(d) {
      var rows = d.items.map(function (it, i) {
        return '<li class="lsRule" style="--i:' + i + '">' +
          '<span class="lsIcon" aria-hidden="true">' + esc(it.icon || '★') + '</span>' +
          '<span class="lsRuleText">' +
            (it.who ? '<strong class="lsWho">' + esc(it.who) + '</strong>' : '') +
            (it.text ? '<span class="lsWhat">' + esc(it.text) + '</span>' : '') +
          '</span>' +
          (it.reward ? '<span class="lsReward"><span class="lsCoin" aria-hidden="true"></span>' + esc(it.reward) + '</span>' : '') +
        '</li>';
      }).join('');
      return '<header class="lsBoardHead">' +
          '<span class="lsBoardBadge" aria-hidden="true">⚔</span>' +
          '<h2 class="lsBoardTitle">' + esc(d.title) + '</h2>' +
        '</header>' +
        '<ol class="lsRules' + (d.items.length > 3 ? ' lsMany' : '') + '">' + rows + '</ol>';
    }

    function formHtml(d) {
      var rows = d.items.map(function (it, i) {
        return '<li class="lsFormRow" data-row="' + i + '">' +
          '<label class="lsF lsFIcon"><span>Icon</span><input data-f="icon" maxlength="16" value="' + esc(it.icon) + '" aria-label="Icon for line ' + (i + 1) + '"></label>' +
          '<label class="lsF lsFWho"><span>Who</span><input data-f="who" maxlength="' + (LIMITS.who * 2) + '" value="' + esc(it.who) + '" placeholder="e.g. Online students"></label>' +
          '<label class="lsF lsFText"><span>What to do</span><textarea data-f="text" rows="2" maxlength="' + (LIMITS.text * 2) + '" placeholder="e.g. Turn on your camera for the whole lesson.">' + esc(it.text) + '</textarea></label>' +
          '<label class="lsF lsFReward"><span>Reward</span><input data-f="reward" maxlength="' + (LIMITS.reward * 2) + '" value="' + esc(it.reward) + '" placeholder="e.g. +2 points"></label>' +
          '<span class="lsRowTools">' +
            '<button type="button" data-ls="up" title="Move up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
            '<button type="button" data-ls="down" title="Move down"' + (i === d.items.length - 1 ? ' disabled' : '') + '>↓</button>' +
            '<button type="button" data-ls="remove" title="Remove this line"' + (d.items.length <= 1 ? ' disabled' : '') + '>🗑</button>' +
          '</span>' +
        '</li>';
      }).join('');
      return '<header class="lsBoardHead lsFormHead"><h2 class="lsBoardTitle">Edit the quest rules</h2></header>' +
        '<div class="lsFormTop">' +
          '<label class="lsF"><span>Cover title</span><input data-top="cover" maxlength="' + (LIMITS.cover * 2) + '" value="' + esc(d.cover) + '"></label>' +
          '<label class="lsF"><span>Line above it</span><input data-top="kicker" maxlength="' + (LIMITS.kicker * 2) + '" value="' + esc(d.kicker) + '" placeholder="(none)"></label>' +
          '<label class="lsF"><span>Rules heading</span><input data-top="title" maxlength="' + (LIMITS.title * 2) + '" value="' + esc(d.title) + '"></label>' +
        '</div>' +
        '<ol class="lsFormRows">' + rows + '</ol>' +
        '<div class="lsFormFoot">' +
          '<button type="button" class="lsBtn" data-ls="add"' + (d.items.length >= LIMITS.items ? ' disabled' : '') + '>+ Add a line</button>' +
          '<button type="button" class="lsBtn lsBtnGhost" data-ls="defaults" title="Put back the original three lines">Restore the original</button>' +
          '<span class="lsGrow"></span>' +
          '<span class="lsFormMsg" role="status"></span>' +
          '<button type="button" class="lsBtn lsBtnGhost" data-ls="cancel">Cancel</button>' +
          '<button type="button" class="lsBtn lsBtnGo" data-ls="save">Save</button>' +
        '</div>';
    }

    /* ---------------- stickers ---------------- */

    function pepper(scene) {
      if (!s) return;
      var host = s.back.querySelector('[data-ls-stickers="' + scene + '"]');
      if (!host) return;
      var w = s.back.clientWidth || window.innerWidth;
      var h = s.back.clientHeight || window.innerHeight;
      var avoid = [];
      var base = s.back.getBoundingClientRect();
      var keep = scene === 'cover'
        ? ['.lsCoverTitle']
        : ['.lsBoard'];
      keep.push('.lsTools');
      keep.forEach(function (sel) {
        var el = s.back.querySelector(sel);
        if (!el || el.hidden) return;
        var r = el.getBoundingClientRect();
        if (r.width && r.height) avoid.push({ x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
      });
      if (scene === 'cover') {
        // The castle's gate sits under the title; keep it clear too.
        var portal = s.back.querySelector('.lsPortal');
        if (portal) {
          var pr = portal.getBoundingClientRect();
          if (pr.width) avoid.push({ x: pr.left - base.left, y: pr.top - base.top, w: pr.width, h: pr.height });
        }
      }
      // The board leaves only the margins round the rules, so its stickers
      // are a little smaller and packed a little closer to fill them.
      var size = Math.round(stickerSize(w, h) * (scene === 'cover' ? 1 : 0.86));
      var seed = (s.seed + (scene === 'cover' ? 0 : 7919)) >>> 0;
      var spots = stickerSpots({
        w: w, h: h, size: size, max: stickerBudget(w, h), avoid: avoid,
        pad: Math.round(size * (scene === 'cover' ? 0.12 : 0.04)),
        spread: scene === 'cover' ? 1.32 : 1.08, seed: seed
      });
      var picks = stickerPicks(seed ^ 0xA5A5, spots.length);
      var calm = reduced();
      host.innerHTML = '';
      spots.forEach(function (p, i) {
        var pick = picks[i];
        var st = spriteStyle(pick);
        var box = Math.round(p.s * (pick.scale || 1));
        var el = document.createElement('span');
        el.className = 'lsSticker lsSticker-' + pick.kind + (calm ? '' : ' lsPop');
        el.style.left = (p.x - box / 2) + 'px';
        el.style.top = (p.y - box / 2) + 'px';
        el.style.width = box + 'px';
        el.style.height = box + 'px';
        el.style.setProperty('--rot', p.rot + 'deg');
        el.style.setProperty('--delay', p.delay + 'ms');
        var art = document.createElement('span');
        art.className = 'lsArt';
        art.style.backgroundImage = st.image;
        art.style.backgroundSize = st.size;
        art.style.backgroundPosition = st.position;
        if (p.flip) art.style.transform = 'scaleX(-1)';
        el.appendChild(art);
        el.dataset.kind = pick.kind;
        el.dataset.sheet = pick.sheet;
        host.appendChild(el);
      });
    }

    /* ---------------- the gate ---------------- */

    function enterGate() {
      if (!s || s.busy || s.phase !== 'cover') return;
      if (!teacher()) { close(); return; }
      s.busy = true;
      var back = s.back;
      if (reduced()) {
        showBoard();
        s.busy = false;
        return;
      }
      var gate = back.querySelector('.lsGate');
      gate.hidden = false;
      gate.className = 'lsGate';
      // Two frames: the doors must be laid out OPEN before they can swing shut.
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (!s || s.back !== back) return;
          gate.classList.add('lsShut');
          later(function () {
            back.classList.add('lsShake');
            gate.classList.add('lsBarred', 'lsDusty');
            // While the gate is shut the cover is swapped for the rules
            // behind it, so the doors open onto them.
            showBoard(true);
            later(function () { back.classList.remove('lsShake'); }, GATE.shake);
            later(function () {
              gate.classList.remove('lsBarred');
              later(function () {
                gate.classList.add('lsOpening');
                gate.classList.remove('lsShut');
                pepper('board');
                later(function () {
                  gate.hidden = true;
                  gate.className = 'lsGate';
                  s.busy = false;
                }, GATE.open);
              }, GATE.lift);
            }, GATE.bar + GATE.hold);
          }, GATE.shut);
        });
      });
    }

    function showBoard(behindGate) {
      if (!s) return;
      s.phase = 'board';
      s.back.querySelector('.lsCover').hidden = true;
      s.back.querySelector('.lsBoardScene').hidden = false;
      s.back.classList.add('lsOnBoard');
      render();
      // The rules step in one after another as the gate opens — on the
      // reveal only, never again on every redraw after an edit.
      var board = s.back.querySelector('.lsBoard');
      board.classList.add('lsFresh');
      later(function () { board.classList.remove('lsFresh'); }, (behindGate ? GATE.bar + GATE.hold + GATE.lift + GATE.open : 0) + 1800);
      if (!behindGate) pepper('board');
      try { s.back.focus({ preventScroll: true }); } catch (e) { /* nothing */ }
    }

    function showCover() {
      if (!s) return;
      clearTimers();
      s.busy = false;
      s.editing = false;
      s.draft = null;
      s.phase = 'cover';
      var gate = s.back.querySelector('.lsGate');
      gate.hidden = true;
      gate.className = 'lsGate';
      s.back.classList.remove('lsShake', 'lsOnBoard');
      s.back.querySelector('.lsBoardScene').hidden = true;
      s.back.querySelector('.lsCover').hidden = false;
      s.seed = (s.seed * 1664525 + 1013904223) >>> 0;   // a fresh peppering
      fillCover();
      render();
      pepper('cover');
      try { s.back.querySelector('.lsCover').focus({ preventScroll: true }); } catch (e) { /* nothing */ }
    }

    /* ---------------- editing ---------------- */

    function startEdit() {
      if (!s || s.phase !== 'board' || s.busy) return;
      if (!teacher()) { close(); return; }
      s.editing = true;
      s.draft = JSON.parse(JSON.stringify(s.data));
      render();
      var first = s.back.querySelector('.lsBoard [data-f="text"]');
      if (first) try { first.focus(); } catch (e) { /* nothing */ }
    }

    /* Read every field back into the draft before anything re-renders the
       form, or a half-typed line is lost when a row is moved. */
    function readForm() {
      if (!s || !s.editing || !s.draft) return;
      var board = s.back.querySelector('.lsBoard');
      board.querySelectorAll('[data-top]').forEach(function (inp) { s.draft[inp.dataset.top] = inp.value; });
      board.querySelectorAll('.lsFormRow').forEach(function (row) {
        var i = +row.dataset.row;
        var it = s.draft.items[i];
        if (!it) return;
        row.querySelectorAll('[data-f]').forEach(function (inp) { it[inp.dataset.f] = inp.value; });
      });
    }

    function formMessage(text, bad) {
      var m = s && s.back.querySelector('.lsFormMsg');
      if (!m) return;
      m.textContent = text || '';
      m.classList.toggle('lsBad', !!bad);
    }

    function formAction(act, row) {
      if (!s || !s.editing || s.saving) return;
      if (!teacher()) { close(); return; }
      readForm();
      var items = s.draft.items;
      if (act === 'add') {
        if (items.length >= LIMITS.items) return;
        items.push({ icon: '⭐', who: '', text: '', reward: '' });
        render();
        var rows = s.back.querySelectorAll('.lsFormRow [data-f="who"]');
        if (rows.length) try { rows[rows.length - 1].focus(); } catch (e) { /* nothing */ }
        return;
      }
      if (act === 'defaults') {
        s.draft = defaults();
        render();
        formMessage('The original lines are back — Save to keep them.');
        return;
      }
      if (act === 'cancel') { s.editing = false; s.draft = null; render(); return; }
      if (act === 'save') { save(); return; }
      if (row == null || !items[row]) return;
      if (act === 'remove' && items.length > 1) items.splice(row, 1);
      if (act === 'up' && row > 0) items.splice(row - 1, 0, items.splice(row, 1)[0]);
      if (act === 'down' && row < items.length - 1) items.splice(row + 1, 0, items.splice(row, 1)[0]);
      render();
    }

    function save() {
      if (!s || !s.editing || s.saving) return;
      if (!teacher()) { close(); return; }
      readForm();
      var next = clean(s.draft);
      if (!next) { formMessage('Write at least one line to show the class.', true); return; }
      next.at = now();
      var mine = s;
      s.saving = true;
      var btn = s.back.querySelector('[data-ls="save"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
      formMessage('');
      var p;
      try { p = Promise.resolve(env.save ? env.save(next) : { cloud: false }); }
      catch (e) { p = Promise.reject(e); }
      p.then(function (res) {
        if (s !== mine) return;
        s.saving = false;
        s.data = next;
        s.editing = false;
        s.draft = null;
        fillCover();
        render();
        pepper('board');
        toast(res && res.cloud ? 'Quest rules saved' : 'Quest rules saved on this device — your account could not be reached');
      }, function () {
        if (s !== mine) return;
        s.saving = false;
        if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = 'Save'; }
        formMessage('Could not save. Try again.', true);
      });
    }

    /* ---------------- wiring ---------------- */

    function fullscreenSupported() {
      var d = document.documentElement;
      return !!(d && (d.requestFullscreen || d.webkitRequestFullscreen));
    }
    function toggleFullscreen() {
      if (!s) return;
      try {
        var cur = document.fullscreenElement || document.webkitFullscreenElement;
        if (cur) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
        var el = document.documentElement;
        var req = el.requestFullscreen || el.webkitRequestFullscreen;
        var r = req && req.call(el);
        if (r && r.catch) r.catch(function () { /* refused: nothing to do */ });
      } catch (e) { /* refused */ }
    }

    function wire(back) {
      back.addEventListener('click', function (e) {
        if (!s || s.back !== back) return;
        var b = e.target.closest('[data-ls]');
        if (b && back.contains(b)) {
          var act = b.dataset.ls;
          if (act === 'close') { close(); return; }
          if (act === 'full') { toggleFullscreen(); return; }
          if (act === 'edit') { startEdit(); return; }
          if (act === 'replay') { if (!s.busy) showCover(); return; }
          var row = b.closest('.lsFormRow');
          formAction(act, row ? +row.dataset.row : null);
          return;
        }
        if (s.phase === 'cover' && e.target.closest('.lsCover')) enterGate();
      });
      // Every key pressed here stays here: the worksheet's one-letter tool
      // shortcuts must not fire under a quest board, least of all mid-edit.
      ['keydown', 'keyup', 'keypress', 'paste', 'copy', 'cut'].forEach(function (t) {
        back.addEventListener(t, function (e) {
          e.stopPropagation();
          if (t === 'keydown') key(e);
        });
      });
      back.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      back.addEventListener('wheel', function (e) { if (!e.target.closest('.lsBoard')) e.preventDefault(); }, { passive: false });
    }

    function key(e) {
      if (!s) return;
      var typing = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (e.key === 'Escape') {
        e.preventDefault();
        if (s.editing) { formAction('cancel'); return; }
        close();
        return;
      }
      if (s.editing) {
        if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'Enter')) { e.preventDefault(); save(); }
        return;
      }
      if (typing) return;
      if (s.phase === 'cover' && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight')) {
        e.preventDefault();
        enterGate();
        return;
      }
      if (s.phase === 'board' && (e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); if (!s.busy) showCover(); return; }
      if (s.phase === 'board' && (e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); startEdit(); return; }
      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); toggleFullscreen(); }
    }

    function wireForm(board) {
      board.addEventListener('input', function () { formMessage(''); });
    }

    function onResize() {
      if (!s) return;
      clearTimeout(s.resizeTimer);
      s.resizeTimer = setTimeout(function () {
        if (!s) return;
        pepper(s.phase === 'cover' ? 'cover' : 'board');
      }, 160);
    }
    window.addEventListener('resize', onResize);

    function close() {
      if (!s) return false;
      var back = s.back;
      clearTimers();
      clearTimeout(s.resizeTimer);
      s = null;
      seq++;
      document.body.classList.remove('lsOpen');
      try {
        var cur = document.fullscreenElement || document.webkitFullscreenElement;
        if (cur) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } catch (e) { /* nothing */ }
      back.classList.remove('in');
      back.classList.add('out');
      setTimeout(function () { if (back.parentNode) back.parentNode.removeChild(back); }, 200);
      return true;
    }

    function roleChanged() { if (s && !teacher()) close(); }

    return {
      open: open,
      close: close,
      isOpen: function () { return !!s; },
      phase: function () { return s ? s.phase : null; },
      enter: enterGate,
      edit: startEdit,
      roleChanged: roleChanged,
      data: function () { return s ? JSON.parse(JSON.stringify(s.data)) : null; }
    };
  }

  window.LessonSplash = { create: create, pure: pure };
})();
