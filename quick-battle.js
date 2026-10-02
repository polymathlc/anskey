/* Compact automatic wheel battles. The persisted spin ID is the action receipt. */
(function () {
  'use strict';
  var Core = window.ClassroomBattleCore, Store = window.ClassroomBattleStore;
  if (!Core || !Store) return;
  var q = { epoch: 0, store: null, off: null, state: null, queued: null, player: null, playing: false, before: null, cls: '', uid: '', loading: false, busy: false, error: '', heroId: '', on: true };
  var played = new Set();
  try { q.on = localStorage.getItem('polymath.wheelQuickFight') !== 'off'; } catch (_) {}
  function el(id) { return document.getElementById(id); }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function manual() { return window.ClassroomBattle && ClassroomBattle.isOpen(); }
  function visible() { return !!el('wheelModal') && el('wheelModal').classList.contains('open'); }
  function allowed() { return !!(window.wheelTeacher && wheelTeacher() && window.currentUser && currentUser.uid); }
  function mount() {
    if (el('wheelQuickFight')) return;
    var box = document.createElement('section'); box.id = 'wheelQuickFight'; box.className = 'cbQuick';
    box.innerHTML = '<label class="cbQuickToggle"><input id="wheelQuickToggle" type="checkbox"><span>Quick fight<small>Spin → automatic skills & enemy reply</small></span></label><div id="wheelQuickDuel" class="cbQuickDuel" aria-label="Quick fight duel"></div><p id="wheelQuickStatus" class="cbQuickStatus" role="status" aria-live="polite"></p>';
    document.querySelector('#wheelModal .whSpinRow').insertAdjacentElement('afterend', box);
    el('wheelQuickToggle').checked = q.on;
    el('wheelQuickToggle').addEventListener('change', function () {
      q.on = this.checked;
      try { localStorage.setItem('polymath.wheelQuickFight', q.on ? 'on' : 'off'); } catch (_) {}
      if (q.on) open(window.wheelClass || ''); else { close(); render(); }
    });
  }
  function close() {
    if (q.player) q.player.cancel(); q.player = null; q.playing = false; q.before = null; q.queued = null;
    q.epoch++; if (q.off) q.off(); q.off = null; q.store = null;
    q.busy = false; q.loading = false; q.state = null; q.heroId = ''; q.error = '';
    if (el('wheelQuickFight')) el('wheelQuickFight').hidden = true;
    if (el('wheelClassSelect')) el('wheelClassSelect').disabled = false;
  }
  function open(cls) {
    mount(); el('wheelQuickFight').hidden = manual();
    if (manual() || !allowed() || !visible()) { close(); return; }
    var uid = currentUser.uid;
    if (q.store && q.cls === cls && q.uid === uid) { render(); return; }
    close(); q.cls = cls; q.uid = uid;
    if (!q.on || !cls) { render(); return; }
    if (window.ClassroomBattleAnimation) ClassroomBattleAnimation.prepare();
    var stamp = q.epoch; q.loading = true; render();
    try {
      q.store = Store.create({ db: window.db, teacherId: uid, classId: cls, canWrite: function () { return !manual() && q.on && stamp === q.epoch && allowed() && currentUser.uid === uid && window.wheelClass === cls && visible(); } });
      q.off = q.store.subscribe(function (next) {
        if (stamp !== q.epoch) return;
        if (next && q.state && next.revision < q.state.revision) return;
        // Store listeners often arrive before the command response. Keep the
        // persisted snapshot, but let one acknowledged event own its playback.
        if (q.busy) { if (!q.queued || !next || next.revision >= q.queued.revision) q.queued = next; return; }
        q.state = next; q.loading = false; render();
      }, function (err) { if (stamp === q.epoch) { q.loading = false; q.error = err.message; render(); } });
    } catch (err) { q.loading = false; q.error = err.message; render(); }
  }
  function guestId(entry) {
    var text = entry ? entry.n : 'Guest', h = 2166136261;
    for (var i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return 'wheel-' + (h >>> 0).toString(36);
  }
  function roster() {
    var students = window.rwStudentsInClass ? rwStudentsInClass(q.cls).slice() : [], seen = new Set(students.map(function (s) { return s.id; }));
    if (window.wheelState) wheelState.names.forEach(function (entry) {
      if (entry.id && seen.has(entry.id)) return;
      students.push({ id: guestId(entry), name: entry.n });
    });
    return students.map(function (student, index) { return Core.heroFromStudent(student, null, index); });
  }
  function heroId(entry) {
    var student = entry.id && window.rwStudents.find(function (s) { return s.id === entry.id && rwStudentClasses(s).includes(q.cls); });
    return Core.heroFromStudent(student || { id: guestId(entry), name: entry.n }).id;
  }
  function summary(s) {
    if (!s) return 'Spin to begin an encounter. Heroes earn XP and treasure; marks are awarded separately.';
    if (s.pending) return 'A manual answer is waiting. Open Battle to resolve it before using Quick fight.';
    var event = s.lastEvent || {}, h = s.heroes.find(function (hero) { return hero.id === event.heroId; });
    var text = event.type === 'auto' ? (h ? h.name : 'Hero') + ': ' + (event.move || 'Attack') + ' · ' + (event.damage || 0) + ' damage' : 'Spin for an automatic hero turn.';
    var healed = (event.healed || []).reduce(function (sum, entry) { return sum + entry.amount; }, 0);
    if (healed) text += ' · +' + healed + ' team HP';
    if (event.enemy) text += '. Enemy: ' + event.enemy.move + ' · ' + event.enemy.targets.reduce(function (sum, target) { return sum + target.damage; }, 0) + ' damage';
    if (s.status === 'victory') text += '. Victory! Every hero earned treasure. Next spin starts a new encounter.';
    if (s.status === 'defeat') text += '. Encounter ended. Next spin restores the party for a new encounter.';
    return text;
  }
  function avatar(hero, small) {
    var role = hero.role === 'healer' ? 'cleric' : hero.role;
    return window.ClassroomBattleAnimation ? ClassroomBattleAnimation.heroMarkup(role, { className: 'cbAvatar', alt: Core.ROLES[role].name + ' pixel hero', dormant: hero.hp <= 0 && !q.playing }) : '<img class="cbAvatar" src="assets/battle-pixel/' + esc(role) + '.png" alt="' + esc(Core.ROLES[role].name) + ' pixel hero">';
  }
  function controls(s) {
    el('wheelQuickToggle').disabled = q.busy || !!window.wheelSpinning;
    if (q.on && q.cls) el('wheelSpinBtn').disabled = q.loading || q.busy || !!window.wheelSpinning || !!(s && s.pending) || !window.wheelState || !wheelState.names.length;
    if (!q.on) el('wheelSpinBtn').disabled = !!window.wheelSpinning || !window.wheelState || !wheelState.names.length;
    el('wheelClassSelect').disabled = q.busy || !!window.wheelSpinning;
  }
  function render(force) {
    if (!el('wheelQuickFight')) return;
    el('wheelQuickFight').hidden = manual() || !visible();
    if (manual() || !visible()) return;
    controls(q.state);
    if (q.playing && !force) return;
    var s = q.state, heroes = s ? s.heroes : roster(), h = heroes.find(function (hero) { return hero.id === q.heroId; }) || heroes.find(function (hero) { return s && s.lastEvent && hero.id === s.lastEvent.heroId; }) || heroes[0];
    var b = s && Core.bossById(s.bossId), role = h && (h.role === 'healer' ? 'cleric' : h.role);
    var before = q.playing && q.before && s && q.before.encounterId === s.encounterId ? q.before : null;
    var beforeHero = before && h && before.heroes.find(function (hero) { return hero.id === h.id; });
    var shownHero = q.playing ? beforeHero : h;
    el('wheelQuickDuel').hidden = !q.on;
    el('wheelQuickStatus').hidden = !q.on;
    el('wheelQuickDuel').innerHTML = !q.on ? '' : '<div class="cbQuickHero" data-cba-actor="hero" data-cba-hero-id="' + esc(h && h.id) + '">' + (h ? avatar(h) + '<strong>' + esc(h.name) + '</strong><small>' + Core.ROLES[role].name + ' · LV ' + h.level + '</small><span>HP ' + (shownHero ? shownHero.hp + '/' + shownHero.stats.maxHp : '…') + '</span><span>MP ' + (shownHero ? shownHero.mp + '/' + shownHero.stats.maxMp : '…') + '</span>' : '<span>Choose a hero</span>') + '</div><b class="cbQuickVs">VS</b><div class="cbQuickEnemy" data-cba-actor="enemy">' + (b ? '<img src="' + esc(b.image) + '" alt="' + esc(b.name) + ' pixel enemy"><strong>' + esc(b.name) + '</strong><small>' + (!q.playing && s.status === 'victory' ? 'VICTORY' : !q.playing && s.status === 'defeat' ? 'FINISHED' : 'ENEMY') + '</small><span>HP ' + (q.playing ? before ? before.bossHp + '/' + before.bossMaxHp : '…' : s.bossHp + '/' + s.bossMaxHp) + '</span>' : '<span class="cbQuickMystery" aria-hidden="true">?</span><strong>Next encounter</strong><small>Revealed on your spin</small>') + '</div>';
    if (q.playing && s && s.lastEvent) {
      var affected = new Set((s.lastEvent.healed || []).concat(s.lastEvent.enemy && s.lastEvent.enemy.targets || []).map(function (entry) { return entry.heroId; }));
      var teammates = heroes.filter(function (hero) { return hero.id !== h.id && affected.has(hero.id); });
      if (teammates.length) el('wheelQuickDuel').innerHTML += '<div class="cbaParty" aria-label="Teammates affected by this turn">' + teammates.map(function (hero) { return '<div class="cbaRecipient" data-cba-hero-id="' + esc(hero.id) + '">' + avatar(hero, true) + '<strong>' + esc(hero.name) + '</strong></div>'; }).join('') + '</div>';
    }
    if (s && s.status === 'victory' && q.on && !q.playing) el('wheelQuickDuel').innerHTML += '<div class="cbQuickTreasure"><span class="cbChest" aria-label="Opening treasure chest" role="img"></span><details><summary>Treasure for all ' + s.rewards.length + ' heroes</summary>' + s.rewards.map(function (r) { var hero = s.heroes.find(function (hero) { return hero.id === r.heroId; }); return '<p class="cbRarity-' + esc(r.rarity) + '"><strong>' + esc(hero ? hero.name : 'Hero') + '</strong> · ' + esc(r.name) + '<small>' + esc(r.rarity) + ' · +' + r.xp + ' XP</small></p>'; }).join('') + '</details></div>';
    if (window.ClassroomBattleAnimation) ClassroomBattleAnimation.mount(el('wheelQuickDuel'));
    el('wheelQuickStatus').textContent = !q.on ? 'Name wheel only. Turn on Quick fight to battle automatically.' : q.error || (!q.cls ? 'Choose a Lesson slot to enable automatic battles.' : q.loading ? 'Loading the saved encounter…' : q.busy ? 'Resolving the fight…' : window.wheelSpinning ? 'Choosing your champion…' : summary(s));
    el('wheelQuickStatus').classList.toggle('cbQuickError', !!q.error);
    if (q.on) el('wheelHeroPreview').hidden = true;
  }
  async function landed(entry, spinId) {
    if (!entry || manual() || !q.on || !allowed() || !visible() || !q.store || q.loading || q.busy || !q.cls) return;
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(spinId || '')) { q.error = 'Spin again to start the next fight.'; render(); return; }
    if (played.has(spinId) || q.state && q.state.lastAutoSpinId === spinId) return;
    if (q.state && q.state.pending) { render(); return; }
    var stamp = q.epoch, activeStore = q.store, current = q.state, pool = Core.BOSSES.filter(function (enemy) { return !enemy.legacy; });
    q.heroId = heroId(entry); q.busy = true; q.error = ''; render();
    var action = { type: 'auto', id: spinId, spinId: spinId, heroId: q.heroId, heroes: roster(), bossId: pool[Math.floor(Core.randomUnit(spinId + ':enemy') * pool.length)].id };
    if (current) { action.encounterId = current.encounterId; action.expectedRevision = current.revision; }
    try {
      var next = await activeStore.act(action);
      if (stamp !== q.epoch || manual() || !visible()) return;
      if (!allowed() || currentUser.uid !== q.uid) { close(); return; }
      if (next && (!q.state || next.revision >= q.state.revision)) q.state = next;
      if (next && next.lastEvent && next.lastEvent.type === 'auto' && next.lastEvent.id === spinId && window.ClassroomBattleAnimation) {
        played.add(spinId); if (played.size > 100) played.delete(played.values().next().value);
        q.playing = true; q.before = current; render(true);
        q.player = ClassroomBattleAnimation.playDuel(el('wheelQuickDuel'), { hero: next.heroes.find(function (hero) { return hero.id === next.lastEvent.heroId; }), event: next.lastEvent, heroes: next.heroes, onStage: function (stage, text) { if (stamp === q.epoch && text) el('wheelQuickStatus').textContent = text; } });
        await q.player.finished;
      }
    } catch (err) { if (stamp === q.epoch) q.error = err.message || 'Fight could not be saved. Try the next spin.'; }
    finally { if (stamp === q.epoch) { q.playing = false; q.player = null; q.before = null; if (q.queued && (!q.state || q.queued.revision >= q.state.revision)) q.state = q.queued; q.queued = null; q.busy = false; render(); } }
  }
  function beforeSpin() {
    if (!q.on || !window.wheelClass) return true;
    if (!q.store) open(window.wheelClass);
    if (q.loading || q.busy || !q.store || q.state && q.state.pending) { render(); return false; }
    return allowed() && visible();
  }
  window.QuickBattle = { open: open, close: close, beforeSpin: beforeSpin, landed: landed, render: render, enabled: function () { return q.on; } };
})();
