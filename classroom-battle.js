/* Classroom battle presentation. Authentication, wheel and rewards remain owned by anskey. */
(function () {
  'use strict';
  var Core = window.ClassroomBattleCore;
  var Store = window.ClassroomBattleStore;
  if (!Core || !Store) return;
  var opened = false, epoch = 0, store = null, offState = null, offProfiles = [];
  var state = null, profiles = {}, visuals = {}, classId = '', teacherId = '', busy = false;
  var loading = false, error = '', lastEventId = '', syncTimer = null, synced = '', previousFocus;
  var wheelParent, wheelNext, selectionInFlight = false, classReady = false, pendingProfiles = 0;
  var offWheelProfile = null, wheelPreviewEpoch = 0;
  var failedAvatars = {}, menu = 'attack', commandId = '', commandTurn = '', inspectId = '', timing = null, timingFrame = 0;
  var roleText = Core.ROLES;
  function roleOf(h) { return h.role === 'healer' ? 'cleric' : roleText[h.role] ? h.role : 'warrior'; }
  function heroList() { return state ? state.heroes : roster(); }
  function inspectedHero() { var heroes = heroList(); return heroes.find(function (h) { return h.id === inspectId; }) || heroes[0]; }
  function activeHero() { return state && state.pending && state.heroes.find(function (h) { return h.id === state.pending.heroId; }); }
  function itemInfo(entry) { return Core.itemById(entry.itemId); }
  function button(text, attrs, disabled) { return '<button type="button" ' + attrs + (disabled ? ' disabled' : '') + '>' + text + '</button>'; }
  function pixelIcon(skill) {
    var masks = {
      warrior: ['000001100000','000011110000','000111100000','001111000000','011110000000','001100000000','010011000000','100001100000'],
      ranger: ['000011000000','000100100000','001000010000','010000001000','010111111110','001000010000','000100100000','000011000000'],
      mage: ['000001000000','000011000000','001111100000','011111110000','111111111000','111111111000','011111110000','001111100000'],
      cleric: ['000011000000','000011000000','001111110000','001111110000','000011000000','000011000000','000011000000','000000000000'],
      passive: ['001111110000','011111111000','011000011000','011011011000','011011011000','001111110000','000111100000','000011000000']
    };
    var role = skill.role || 'mage', mask = masks[skill.passive ? 'passive' : role] || masks.mage;
    return '<svg class="cbSkillGlyph" viewBox="0 0 12 9" shape-rendering="crispEdges" aria-hidden="true">' + mask.map(function (row,y) { return row.split('').map(function (v,x) { return v === '1' ? '<rect x="'+x+'" y="'+y+'" width="1" height="1" fill="'+(y < 3 ? '#fff0bd' : (roleText[role] || roleText.mage).color)+'"/>' : ''; }).join(''); }).join('') + '</svg>';
  }

  function el(id) { return document.getElementById(id); }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uuid() { return window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2); }
  function allowed() { return !!(window.wheelTeacher && wheelTeacher() && window.currentUser && currentUser.uid); }
  function boss() { return state && Core.BOSSES.find(function (b) { return b.id === state.bossId; }); }
  function heroIdFor(entry) {
    var student = entry && window.rwStudents.find(function (s) { return entry.id && s.id === entry.id && rwStudentClasses(s).indexOf(classId) !== -1; });
    return Core.heroFromStudent(student || { id: guestId(entry), name: entry ? entry.n : 'Guest hero' }, student && profiles[student.uid]).id;
  }
  function guestId(entry) {
    var text = entry ? entry.n : 'Guest', h = 2166136261;
    for (var i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return 'wheel-' + (h >>> 0).toString(36);
  }
  function roster() {
    var students = window.rwStudentsInClass ? rwStudentsInClass(classId).slice() : [];
    var ids = new Set(students.map(function (s) { return s.id; }));
    if (window.wheelClass === classId && window.wheelState) wheelState.names.forEach(function (entry) {
      if (entry.id && ids.has(entry.id)) return;
      // Only a concrete register ID can link a wheel entry to an account. Never use a name lookup.
      var registered = entry.id && window.rwStudents.find(function (s) { return s.id === entry.id && rwStudentClasses(s).indexOf(classId) !== -1; });
      if (registered) { students.push(registered); ids.add(registered.id); }
      else students.push({ id: guestId(entry), name: entry.n });
    });
    var seen = new Set();
    return students.map(function (s, index) {
      var h = Core.heroFromStudent(s, null, index);
      var saved = state && state.heroes.find(function (old) { return old.id === h.id; });
      if (saved) h = Object.assign({}, h, saved, { name: h.name });
      return h;
    }).filter(function (h) {
      if (seen.has(h.id)) return false;
      seen.add(h.id); visuals[h.id] = h; return true;
    });
  }
  function mount() {
    if (el('classroomBattle')) return;
    var node = document.createElement('div'); node.id = 'classroomBattle'; node.className = 'cbOverlay'; node.hidden = true;
    node.innerHTML = '<section class="cbShell" role="dialog" aria-modal="true" aria-labelledby="cbTitle">' +
      '<header class="cbHeader"><div><span class="cbEyebrow">CLASSROOM CHRONICLES / PIXEL RPG</span><h2 id="cbTitle">Classroom boss battle</h2><p id="cbClassLabel"></p></div><div class="cbHeaderActions"><span class="cbSaved" id="cbSaveStatus" role="status"></span><button type="button" id="cbClose" aria-label="Close battle">✕</button></div></header>' +
      '<div id="cbError" class="cbError" role="alert" hidden></div><main class="cbMain"><aside class="cbWheelPane"><div class="cbSectionTitle">01 / CALL A HERO <span class="cbLiveDot">LIVE WHEEL</span></div><div id="cbWheelMount" class="cbWheelSlot"></div><details class="cbHelp"><summary>Adventure guide</summary><p>Spin for a student, choose Attack, Skills or Items, then mark the answer. A correct answer executes the command. Every student earns personal loot and XP after a victory.</p><p>Click a hero to choose their class, learn skills and equip treasure. Classroom characters progress independently from CER.</p><p>Boss attacks are teacher controlled. Start the power meter and press Stop: black is a glancing hit, orange is strong, and red deals the most damage. Resting heroes can rally on a correct answer.</p></details></aside>' +
      '<section class="cbArena" id="cbArena" aria-label="Battlefield"><div class="cbArenaTop"><div class="cbSectionTitle">02 / THE ENCOUNTER</div><span id="cbEncounterStatus" class="cbEncounterStatus"></span></div><div class="cbBattlefield"><section class="cbTeam"><div class="cbTeamTitle"><h3>Your party</h3><span id="cbTeamCount"></span></div><div id="cbHeroes" class="cbHeroes" aria-label="Party formation: four heroes per column"></div><p class="cbFormationHint">4 per column · choose a hero to manage skills & gear</p></section>' +
      '<section class="cbBoss" id="cbBoss"><span class="cbBossTag" id="cbBossTag"></span><div class="cbBossArt" id="cbBossArt"></div><h3 id="cbBossName"></h3><p id="cbBossStyle"></p><p id="cbBossGuard" class="cbCondition" hidden>Guard raised · next attack is reduced</p><div class="cbHpLine"><span>ENEMY HP</span><strong id="cbBossHp"></strong></div><div class="cbHp cbBossHp"><span id="cbBossBar"></span></div><div class="cbChargeLabel"><span id="cbUltimateName"></span><strong id="cbChargeText"></strong></div><div id="cbCharge" class="cbCharge"></div><p class="cbBossIntent" id="cbBossIntent"></p></section></div>' +
      '<div id="cbLoot" class="cbLoot" hidden></div><div id="cbEffects" class="cbEffects" aria-hidden="true"></div><div id="cbFeedback" class="cbFeedback" role="status" aria-live="polite"></div>' +
      '<section id="cbTiming" class="cbTiming" hidden aria-label="Boss attack power"><div class="cbTimingHead"><strong id="cbTimingTitle">BOSS POWER</strong><span id="cbPowerText">Press Stop near red for maximum damage</span></div><div class="cbPowerBar"><span class="cbBlackZone">GLANCE</span><span class="cbOrangeZone">STRONG</span><span class="cbRedZone">CRITICAL</span><i id="cbPowerNeedle"></i></div><div class="cbTimingActions"><button id="cbStop">■ Stop meter</button><button id="cbCancelMeter">Cancel</button></div></section>' +
      '<section class="cbCommandBox" aria-label="Hero commands"><div class="cbCommandHeading"><span class="cbEyebrow">03 / CHOOSE YOUR COMMAND</span><strong id="cbTurnName"></strong></div><div class="cbCommandTabs" role="group" aria-label="Command type"><button data-menu="attack" id="cbNormalAttack">⚔ Attack</button><button data-menu="skill" id="cbSkills">✦ Skills</button><button data-menu="item" id="cbItems">◆ Items</button></div><div id="cbCommandOptions" class="cbCommandOptions"></div><label id="cbTargetWrap" class="cbTargetWrap" hidden>Ally target <select id="cbTarget"></select></label><div class="cbAnswerButtons"><button id="cbCorrect" class="cbCorrect">✓ Correct / execute</button><button id="cbIncorrect">↻ Incorrect</button><button id="cbSkip">→ Skip</button></div></section>' +
      '<footer class="cbTeacherControls"><span class="cbEyebrow">TEACHER / ENEMY TURN</span><button id="cbAttack">Boss attack</button><button id="cbUltimate" class="cbUltimate">Boss skill</button><label class="cbEncounterChoice">Encounter <select id="cbEncounterChoice"><option value="">Random encounter</option></select></label><button id="cbStart" class="cbStart">Start encounter</button></footer></section></main>' +
      '<section id="cbHeroPanel" class="cbHeroPanel" hidden aria-label="Hero progression"><header><div><span class="cbEyebrow">HERO JOURNAL</span><h3 id="cbJournalName"></h3></div><button id="cbJournalClose" aria-label="Close hero journal">✕</button></header><div id="cbJournalBody"></div></section></section>';
    document.body.appendChild(node);
    var encounterPool = Core.BOSSES.filter(function (b) { return !b.legacy; });
    el('cbEncounterChoice').innerHTML += encounterPool.map(function (b) { return '<option value="' + esc(b.id) + '">' + esc(b.name) + '</option>'; }).join('');
    el('cbClose').addEventListener('click', close); el('cbStart').addEventListener('click', start);
    el('cbCorrect').addEventListener('click', function () { answer('correct'); }); el('cbIncorrect').addEventListener('click', function () { answer('incorrect'); }); el('cbSkip').addEventListener('click', function () { answer('skip'); });
    el('cbAttack').addEventListener('click', function () { attack(false); }); el('cbUltimate').addEventListener('click', function () { attack(true); });
    el('cbStop').addEventListener('click', stopMeter); el('cbCancelMeter').addEventListener('click', function () { cancelMeter(); render(); });
    el('cbJournalClose').addEventListener('click', function () { closeJournal(); });
    node.addEventListener('click', function (e) {
      var tab = e.target.closest('[data-menu]'), option = e.target.closest('[data-command]'), hero = e.target.closest('[data-inspect]'), learn = e.target.closest('[data-learn]'), equip = e.target.closest('[data-equip]');
      if (tab) { menu = tab.dataset.menu; commandId = ''; renderCommands(); }
      if (option) { commandId = option.dataset.command; renderCommands(); }
      if (hero) { inspectId = hero.dataset.inspect; el('cbHeroPanel').hidden = false; renderJournal(); el('cbJournalClose').focus(); }
      if (learn) journalAction({ command: 'learn', skillId: learn.dataset.learn });
      if (equip) journalAction({ command: 'equip', itemId: equip.dataset.equip || null });
    });
    node.addEventListener('change', function (e) { if (e.target.id === 'cbRoleChoice') journalAction({ command: 'class', role: e.target.value }); });
    node.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); if (!el('cbHeroPanel').hidden) closeJournal(); else if (timing) { cancelMeter(); render(); } else close(); return; }
      if (e.key === 'Tab') {
        var surface = el('cbHeroPanel').hidden ? node : el('cbHeroPanel');
        var items = Array.from(surface.querySelectorAll('button:not([disabled]),select:not([disabled]),input:not([disabled]),summary,a[href]')).filter(function (n) { return n.getClientRects().length; });
        var first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      } else if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
    });
  }
  function closeJournal() { el('cbHeroPanel').hidden = true; var node = heroNode(inspectId); if (node) node.focus(); }

  async function open() {
    if (!allowed()) { if (window.toast) toast('Sign in as a teacher to open a classroom battle.'); return; }
    if (opened) return;
    mount(); previousFocus = document.activeElement;
    opened = true; el('classroomBattle').hidden = false; document.body.classList.add('cbOpen');
    wheelParent = el('wheelModal').parentNode; wheelNext = el('wheelModal').nextSibling;
    el('cbWheelMount').appendChild(el('wheelModal'));
    try { await openWheel(); } catch (e) { showError(e); }
    if (!opened) return;
    classChanged(window.wheelClass || ''); wheelFit(); el('cbClose').focus();
  }
  function detach() {
    cancelMeter();
    epoch++; if (offState) offState(); offState = null;
    offProfiles.forEach(function (off) { off(); }); offProfiles = [];
    if (syncTimer) clearTimeout(syncTimer); syncTimer = null;
    store = null; classReady = false; pendingProfiles = 0; synced = ''; busy = false; selectionInFlight = false;
  }
  function close() {
    if (!opened) return;
    opened = false; detach(); closeWheel();
    if (wheelParent) wheelParent.insertBefore(el('wheelModal'), wheelNext && wheelNext.parentNode === wheelParent ? wheelNext : null);
    el('classroomBattle').hidden = true; document.body.classList.remove('cbOpen');
    el('wheelHeroPreview').hidden = true;
    el('wheelClassSelect').disabled = false;
    if (previousFocus && previousFocus.isConnected) previousFocus.focus();
  }
  function showError(e) { error = e && e.message ? e.message : String(e); render(); }
  function classChanged(cls) {
    wheelClosed();
    if (!opened) return;
    var uid = window.currentUser && currentUser.uid;
    if (cls === classId && teacherId === uid && store) return;
    detach(); classId = cls; teacherId = uid || ''; state = null; profiles = {}; visuals = {}; error = ''; inspectId = ''; el('cbHeroPanel').hidden = true; lastEventId = ''; loading = !!cls;
    if (!cls || !allowed()) { loading = false; render(); return; }
    var stamp = epoch;
    var boundUid = teacherId;
    try { store = Store.create({ db: window.db, teacherId: teacherId, classId: classId, canWrite: function () { return allowed() && currentUser.uid === boundUid; } }); }
    catch (e) { loading = false; showError(e); return; }
    offState = store.subscribe(function (next) {
      if (stamp !== epoch || !opened) return;
      if (next && state && next.revision < state.revision) return;
      var first = !classReady, previous = lastEventId;
      state = next; classReady = true; loading = false;
      lastEventId = next && next.lastEvent ? next.lastEvent.id : '';
      render();
      if (!first && lastEventId && lastEventId !== previous) animate(next.lastEvent);
      if (first) scheduleSync();
    }, function (e) { if (stamp === epoch) { loading = false; classReady = false; showError(e); } });

    roster(); render();
  }
  function scheduleSync() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      syncTimer = null;
      if (!opened || !store || !state || !classReady || pendingProfiles) return;
      if (busy || timing || selectionInFlight || window.wheelSpinning) { scheduleSync(); return; }
      var heroes = roster(), signature = JSON.stringify(heroes.map(function (h) { return { id: h.id, name: h.name, role: h.role, stats: h.stats }; }));
      if (signature === synced) return;
      synced = signature;
      act({ type: 'sync', heroes: heroes }).catch(function () { synced = ''; });
    }, 200);
  }
  async function act(action) {
    if (!opened || !allowed() || !store || busy) throw new Error('Wait for the current action to finish.');
    var stamp = epoch, activeStore = store;
    action.id = action.id || uuid();
    if (state) { action.encounterId = state.encounterId; action.expectedRevision = state.revision; }
    busy = true; error = ''; render();
    try {
      var next = await activeStore.act(action);
      if (stamp === epoch && opened && next && (!state || next.revision >= state.revision)) { state = next; render(); }
      return next;
    } catch (e) { if (stamp === epoch) showError(e); throw e; }
    finally { if (stamp === epoch) { busy = false; render(); } }
  }
  async function start() {
    if (!allowed() || !classId || !classReady || pendingProfiles || busy || timing || window.wheelSpinning) return;
    var heroes = roster();
    if (!heroes.length) { showError(new Error('Add students to this class or to the wheel first.')); return; }
    if (state && state.status === 'active' && !window.confirm('Start another encounter for ' + classId + '? This replaces the current boss and restores your team’s health.')) return;
    var pool = Core.BOSSES.filter(function (b) { return !b.legacy; });
    var chosen = el('cbEncounterChoice').value ? Core.bossById(el('cbEncounterChoice').value) : pool[Math.floor((window.wheelRandom ? wheelRandom() : Math.random()) * pool.length)];
    try { await act({ type: 'start', heroes: heroes, bossId: chosen.id }); } catch (_) {}
  }
  function beforeSpin() {
    if (!opened) return true;
    if (!allowed() || busy || timing || selectionInFlight || loading || pendingProfiles) return false;
    if (!state || state.status !== 'active') { showError(new Error('Start an encounter before calling a hero.')); return false; }
    if (state.pending) { showError(new Error('Choose Correct, Incorrect or Skip for the current answer first.')); return false; }
    error = ''; return true;
  }
  function spinning() { if (opened) render(); else wheelClosed(); }
  function wheelClosed() {
    wheelPreviewEpoch++;
    if (offWheelProfile) offWheelProfile(); offWheelProfile = null;
    el('wheelHeroPreview').hidden = true;
  }
  function wheelPreview(entry) {
    wheelClosed(); if (!entry || !allowed()) return;
    var student = entry.id && window.rwStudents.find(function (s) { return s.id === entry.id; });
    var h = Core.heroFromStudent(student || { id: guestId(entry), name: entry.n });
    var preview = el('wheelHeroPreview'); preview.hidden = false;
    preview.innerHTML = avatar(h) + '<span><strong>' + esc(h.name) + '</strong><small>' + esc(roleText[roleOf(h)].name) + ' · classroom hero</small></span>';
  }

  async function landed(entry) {
    if (!opened) { wheelPreview(entry); return; }
    if (!opened || !entry || !allowed() || !state || state.status !== 'active' || selectionInFlight) return;
    selectionInFlight = true;
    try {
      var hid = heroIdFor(entry);
      if (!state.heroes.some(function (h) { return h.id === hid; })) await act({ type: 'sync', heroes: roster() });
      await act({ type: 'select', heroId: hid, turnId: uuid() });
    } catch (_) {} finally { selectionInFlight = false; render(); }
  }
  async function answer(outcome) {
    if (!allowed() || busy || timing || selectionInFlight || !state || !state.pending || window.wheelSpinning) return;
    if (outcome === 'correct' && menu !== 'attack' && !commandId) { showError(new Error('Choose a skill or item first.')); return; }
    try { await act({ type: 'answer', turnId: state.pending.id, outcome: outcome, command: menu, skillId: menu === 'skill' ? commandId : undefined, itemId: menu === 'item' ? commandId : undefined, targetId: el('cbTarget').value || undefined }); } catch (_) {}
  }
  function attack(ultimate) {
    if (!allowed() || busy || timing || selectionInFlight || !state || state.status !== 'active' || state.pending || window.wheelSpinning) return;
    var b = boss(); if (ultimate && (!b || state.charge < b.chargeMax)) return;
    timing = { ultimate: !!ultimate, start: performance.now(), position: 0, encounterId: state.encounterId, revision: state.revision };
    render(); el('cbStop').focus(); tickMeter();
  }
  function tickMeter() {
    if (!timing) return;
    var phase = ((performance.now() - timing.start) % 2400) / 1200;
    timing.position = phase <= 1 ? phase : 2 - phase;
    el('cbPowerNeedle').style.left = (timing.position * 100) + '%';
    el('cbPowerText').textContent = (0.55 + 1.45 * timing.position).toFixed(2) + '× DAMAGE · ' + (timing.position >= .85 ? 'RED' : timing.position >= .55 ? 'ORANGE' : 'BLACK');
    timingFrame = requestAnimationFrame(tickMeter);
  }
  function cancelMeter() { if (timingFrame) cancelAnimationFrame(timingFrame); timingFrame = 0; timing = null; if (el('cbTiming')) el('cbTiming').hidden = true; }
  async function stopMeter() {
    if (!timing) return;
    var stopped = timing; cancelMeter();
    if (!state || state.encounterId !== stopped.encounterId || state.revision !== stopped.revision) { showError(new Error('The battle changed while aiming. Start the meter again.')); return; }
    try { await act({ type: 'boss', ultimate: stopped.ultimate, timing: stopped.position }); } catch (_) {}
  }
  function avatar(h, extra) {
    var role = roleOf(h);
    return '<img class="cbAvatar ' + (extra || '') + '" src="assets/battle-pixel/' + esc(role) + '.png" alt="' + esc(roleText[role].name) + ' pixel avatar facing right" draggable="false">';
  }
  function bindAvatarFailures(container) {
    container.querySelectorAll('img.cbAvatar').forEach(function (img) { img.onerror = function () { img.alt = 'Hero sprite unavailable'; }; });
  }
  async function journalAction(values) {
    var h = inspectedHero(); if (!h || busy || timing || state && state.pending) return;
    if (!state) { showError(new Error('Start the first encounter to save your class and skills.')); return; }
    try { await act(Object.assign({ type: 'sync', heroId: h.id }, values)); } catch (_) {}
  }
  function renderCommands() {
    var h = activeHero(), locked = busy || !!timing || !h || !!window.wheelSpinning;
    var turn = state && state.pending && state.pending.id || '';
    if (turn !== commandTurn) { commandTurn = turn; menu = 'attack'; commandId = ''; }
    document.querySelectorAll('[data-menu]').forEach(function (n) { n.setAttribute('aria-pressed', String(n.dataset.menu === menu)); n.disabled = locked; });
    var html = '';
    if (!h) html = '<p>Spin the wheel to call a hero. Choose a command before marking a correct answer.</p>';
    else if (menu === 'attack') html = '<p><strong>Normal attack</strong> · ' + h.stats.damage + ' power · restores 10 MP. A correct answer rallies a resting hero.</p>';
    else if (menu === 'skill') {
      var skills = (Core.SKILL_TREES[roleOf(h)] || []).filter(function (s) { return (h.learnedSkills || []).includes(s.id) && s.effect.type !== 'passive'; });
      html = skills.map(function (s) { var cooldown = (h.cooldowns || {})[s.id] || 0, unavailable = cooldown > 0 || (h.mp || 0) < s.mpCost; return button('<span class="cbPixelIcon">' + pixelIcon(s) + '</span><span><strong>' + esc(s.name) + '</strong><small>' + esc(s.description) + '</small><small>' + s.mpCost + ' MP' + (cooldown ? ' · wait ' + cooldown + ' turns' : '') + '</small></span>', 'data-command="' + esc(s.id) + '" aria-pressed="' + (commandId === s.id) + '"', locked || unavailable); }).join('') || '<p>No active skills learned. Click this hero to explore their skill tree.</p>';
    } else {
      html = (h.inventory || []).filter(function (entry) { return itemInfo(entry).type === 'consumable' && entry.quantity > 0; }).map(function (entry) { var item = itemInfo(entry); return button('<span class="cbPixelIcon">◆</span><span><strong>' + esc(item.name) + ' ×' + entry.quantity + '</strong><small>' + esc(item.description) + '</small></span>', 'data-command="' + esc(entry.id) + '" aria-pressed="' + (commandId === entry.id) + '"', locked); }).join('') || '<p>No consumables left. Defeat enemies to find more treasure.</p>';
    }
    el('cbCommandOptions').innerHTML = html;
    var oldTarget = el('cbTarget').value;
    el('cbTargetWrap').hidden = !h || menu === 'attack';
    el('cbTarget').innerHTML = (state ? state.heroes : []).map(function (hero) { return '<option value="' + esc(hero.id) + '">' + esc(hero.name) + ' · ' + hero.hp + '/' + hero.stats.maxHp + ' HP</option>'; }).join('');
    if (state && state.heroes.some(function (hero) { return hero.id === oldTarget; })) el('cbTarget').value = oldTarget; else if (h) el('cbTarget').value = h.id;
    el('cbTarget').disabled = locked;
    el('cbCorrect').disabled = locked || menu !== 'attack' && !commandId;
  }
  function renderJournal() {
    if (el('cbHeroPanel').hidden) return;
    var h = inspectedHero(); if (!h) return;
    var locked = busy || !!timing || !state || !!state.pending || !!window.wheelSpinning;
    el('cbJournalName').textContent = h.name + ' / ' + roleText[roleOf(h)].name;
    var learned = h.learnedSkills || [], tree = (Core.SKILL_TREES[roleOf(h)] || []).slice().sort(function (a,b) { return a.tier - b.tier; }), inventory = h.inventory || [];
    el('cbJournalBody').innerHTML = '<div class="cbJournalSummary">' + avatar(h) + '<div><strong>LEVEL ' + (h.level || 1) + ' · ' + (h.xp || 0) + ' XP</strong><p>' + (h.skillPoints || 0) + ' skill points · ' + (h.mp || 0) + '/' + (h.stats.maxMp || 0) + ' MP</p><label>Class <select id="cbRoleChoice"' + (locked ? ' disabled' : '') + '>' + Object.keys(roleText).map(function (key) { return '<option value="' + key + '"' + (key === roleOf(h) ? ' selected' : '') + '>' + roleText[key].name + '</option>'; }).join('') + '</select></label><p>Learned skills stay with their class. Switching classes keeps your XP, skill points and treasure.</p><p>ATK ' + h.stats.damage + ' · DEF ' + h.stats.defence + ' · HP ' + h.stats.maxHp + '</p></div></div>' +
      (locked ? '<p class="cbJournalNotice">' + (!state ? 'Start an encounter to begin character progression.' : 'Finish the current turn before changing skills or equipment.') + '</p>' : '') +
      '<h4>Skill tree <span>3 paths · 4 tiers</span></h4><div class="cbSkillTree">' + tree.map(function (s) { var known = learned.includes(s.id), prerequisites = s.requires.every(function (id) { return learned.includes(id); }); return '<div class="cbSkillNode ' + (known ? 'cbLearned' : prerequisites ? 'cbAvailable' : 'cbLocked') + '"><span class="cbSkillBranch">' + esc(s.branch) + ' / TIER ' + s.tier + '</span><span class="cbPixelIcon">' + pixelIcon(s) + '</span><strong>' + esc(s.name) + '</strong><p>' + esc(s.description) + '</p><small>' + (s.mpCost ? s.mpCost + ' MP · ' : '') + (s.cooldown ? s.cooldown + ' turn cooldown · ' : '') + s.cost + ' SP · LV ' + s.level + '</small><small>' + (s.requires.length ? 'Requires: ' + s.requires.map(function (id) { var req = tree.find(function (n) { return n.id === id; }); return esc(req ? req.name : id); }).join(', ') : 'Root skill') + '</small>' + button(known ? '✓ Learned' : 'Learn / ' + s.cost + ' SP', 'data-learn="' + esc(s.id) + '"', locked || !Core.canLearn(h, s.id).ok) + '</div>'; }).join('') + '</div><h4>Treasure bag <span>Equip one relic</span></h4><div class="cbInventory">' + inventory.map(function (entry) { var item = itemInfo(entry), equipped = h.equipped === entry.id; return '<article class="cbLootItem cbRarity-' + esc(item.rarity) + '"><span class="cbPixelIcon">◆</span><div><small>' + esc(item.rarity).toUpperCase() + '</small><strong>' + esc(item.name) + (entry.quantity > 1 ? ' ×' + entry.quantity : '') + '</strong><p>' + esc(item.description) + '</p>' + (item.type === 'consumable' ? '<small>Use from the Items command on a correct answer.</small>' : button(equipped ? '✓ Equipped / remove' : 'Equip relic', 'data-equip="' + (equipped ? '' : esc(entry.id)) + '"', locked)) + '</div></article>'; }).join('') + '</div>';
  }
  function renderLoot() {
    var show = state && state.status === 'victory'; el('cbLoot').hidden = !show; if (!show) return;
    var key = state.encounterId; if (el('cbLoot').dataset.encounter === key) return;
    el('cbLoot').dataset.encounter = key;
    el('cbLoot').innerHTML = '<div class="cbTreasureBurst"><span class="cbChest" role="img" aria-label="Opening treasure chest"></span><i>◆</i><i>✦</i><i>◆</i><div><span class="cbEyebrow">VICTORY SPOILS</span><h3>A treasure for every hero</h3><p>Personal rewards are already saved. Open a hero’s journal to equip them.</p></div></div><div class="cbRewardList">' + (state.rewards || []).map(function (reward) { var hero = state.heroes.find(function (h) { return h.id === reward.heroId; }); return '<div class="cbReward cbRarity-' + esc(reward.rarity) + '"><strong>' + esc(hero ? hero.name : 'Hero') + '</strong><span>' + esc(reward.name) + '</span><small>' + esc(reward.rarity).toUpperCase() + ' · +' + reward.xp + ' XP</small><p>' + esc(reward.description) + '</p></div>'; }).join('') + '</div>';
  }

  function feedback() {
    if (error) return 'The action was not confirmed. Check the message above before continuing.';
    if (!classId) return 'Choose a class on the wheel to load its saved progress.';
    if (loading) return 'Loading your class’s saved encounter…';
    if (!state) return 'Your team is ready. Start an encounter to meet a random boss.';
    if (state.status === 'victory') return 'Victory! Every hero earned a personal treasure and XP. Your rewards are saved — start another encounter when ready.';
    if (state.status === 'defeat') return 'A brave effort! Your progress is saved. Start another encounter to give the class a fresh try.';
    var event = state.lastEvent, hero = event && state.heroes.find(function (h) { return h.id === event.heroId; });
    if (event && event.type === 'answer') {
      if (event.outcome !== 'correct') return (hero ? hero.name : 'Hero') + (event.outcome === 'skip' ? ' passed this turn. Spin for the next student.' : ' is still learning. No hero attack this turn — try the next question!');
      var healed = (event.healed || []).reduce(function (sum, h) { return sum + (h.amount || 0); }, 0);
      if (!event.damage) return (hero ? hero.name : 'Your hero') + ' used ' + (event.move || 'a support command') + '.' + (healed ? ' Team healing: +' + healed + ' HP.' : ' Its effect is applied.') + ' Spin for the next hero.';
      return (hero ? hero.name : 'Your hero') + (event.move ? ' used ' + event.move + ' and dealt ' : ' dealt ') + (event.damage || 0) + ' damage' + (event.critical ? ' — critical hit!' : '!') + (healed ? ' Team healing: +' + healed + ' HP.' : '') + (event.effect === 'reflect' ? ' The boss reflected ' + (event.targets[0] && event.targets[0].damage || 0) + ' damage.' : '') + ' Spin to call the next hero.';
    }
    if (event && event.type === 'boss') return (event.move || (event.ultimate ? 'Ultimate attack' : 'Boss attack')) + ' hit ' + (event.targets || []).length + ' hero' + ((event.targets || []).length === 1 ? '' : 'es') + '.' + (event.bossHealed ? ' The boss restored ' + event.bossHealed + ' HP.' : '') + (event.multiplier ? ' Power: ' + event.multiplier.toFixed(2) + '× (' + event.zone + ').' : '') + ' The teacher chooses the next boss turn.';
    if (state.pending) return 'Ask your question, then choose Correct, Incorrect or Skip. This answer can resolve only once.';
    return 'Spin the wheel for the next hero. Boss attacks only happen when the teacher triggers them.';
  }
  function render() {
    if (!opened || !el('classroomBattle')) return;
    var heroes = state ? state.heroes : roster(), b = boss(), pending = state && state.pending;
    var active = state && state.status === 'active', selected = pending && heroes.find(function (h) { return h.id === pending.heroId; });
    var living = heroes.filter(function (h) { return h.hp > 0; }), nextTarget = state && living[state.bossTurns % living.length];
    var targetsAll = b && (b.playstyle === 'splash' || state.charge >= b.chargeMax);
    var locked = busy || !!timing || loading || pendingProfiles > 0 || selectionInFlight || !!window.wheelSpinning || !classReady || !allowed();
    el('cbClassLabel').textContent = classId || 'Choose a class on the wheel';
    el('cbError').hidden = !error; el('cbError').textContent = error;
    el('cbSaveStatus').textContent = busy ? 'Saving…' : loading || pendingProfiles ? 'Loading…' : error ? 'Needs attention' : state ? '✓ Saved to your class' : 'Ready to start';
    el('cbSaveStatus').classList.toggle('cbSaveError', !!error);
    el('cbEncounterStatus').textContent = state ? (state.status === 'victory' ? '★ VICTORY' : state.status === 'defeat' ? 'ENCOUNTER COMPLETE' : 'ENCOUNTER IN PROGRESS') : 'READY WHEN YOU ARE';
    el('cbTeamCount').textContent = heroes.length + ' heroes';
    el('cbHeroes').innerHTML = heroes.length ? heroes.map(function (h) {
      var role = roleText[roleOf(h)], stats = h.stats || {}, hp = state ? h.hp : stats.maxHp;
      var ratio = Math.max(0, Math.min(100, hp / (stats.maxHp || 1) * 100));
      return '<button type="button" class="cbHero ' + (selected && selected.id === h.id ? 'cbSelected ' : '') + (hp <= 0 ? 'cbResting' : '') + '" data-hero-id="' + esc(h.id) + '" data-inspect="' + esc(h.id) + '" aria-label="' + esc(h.name + ', ' + role.name + ', ' + hp + ' HP. Open skills and inventory') + '">' + avatar(h) + '<strong class="cbHeroName">' + esc(h.name) + '</strong><span class="cbRoleName">' + role.name + ' · LV ' + (h.level || 1) + '</span><div class="cbHp"><span style="width:' + ratio + '%"></span></div><span class="cbHeroHp">' + hp + ' / ' + stats.maxHp + (hp <= 0 ? ' · resting' : '') + '</span>' + (h.weakened ? '<span class="cbCondition">Weakened</span>' : '') + '</button>';
    }).join('') : '<p class="cbEmpty">Choose a class to gather your heroes.</p>';
    bindAvatarFailures(el('cbHeroes'));

    if (b) {
      if (el('cbBossArt').dataset.boss !== b.id) {
        el('cbBossArt').dataset.boss = b.id;
        el('cbBossArt').innerHTML = '<img src="' + esc(b.image) + '" alt="' + esc(b.name) + ', original classroom boss" id="cbBossImage">';
        el('cbBossImage').onerror = function () { el('cbBossArt').innerHTML = '<span class="cbMystery" aria-label="Boss artwork unavailable">♜</span>'; };
      }
      el('cbBoss').style.setProperty('--boss-color', b.color || '#8a6edb');
      el('cbBossTag').textContent = b.playstyle + ' challenger'; el('cbBossName').textContent = b.name;
      el('cbBossStyle').textContent = b.description || b.playstyle;
      el('cbBossHp').textContent = state.bossHp + ' / ' + state.bossMaxHp;
      el('cbBossBar').style.width = Math.max(0, state.bossHp / state.bossMaxHp * 100) + '%';
      el('cbUltimateName').textContent = b.ultimateName;
      el('cbChargeText').textContent = state.charge + ' / ' + b.chargeMax;
      el('cbCharge').innerHTML = Array.from({ length: b.chargeMax }, function (_, i) { return '<span class="' + (i < state.charge ? 'charged' : '') + '"></span>'; }).join('');
      el('cbBossIntent').textContent = state.charge >= b.chargeMax ? 'Ultimate ready! Hits every standing hero when triggered.' : 'Next: ' + b.attackName + ' → ' + (targetsAll ? 'every standing hero' : nextTarget ? nextTarget.name : 'team') + ' · +1 charge';
      el('cbAttack').textContent = b.attackName;
      el('cbUltimate').textContent = state.charge >= b.chargeMax ? '✦ ' + b.ultimateName : 'Ultimate · ' + state.charge + '/' + b.chargeMax;
    } else {
      el('cbBossArt').dataset.boss = ''; el('cbBossArt').innerHTML = '<span class="cbMystery">?</span>';
      el('cbBossTag').textContent = 'MYSTERY ENCOUNTER'; el('cbBossName').textContent = 'A new challenger awaits';
      el('cbBossStyle').textContent = 'Goblins, guardians and mighty bosses await your party.';
      el('cbBossHp').textContent = '—'; el('cbBossBar').style.width = '100%'; el('cbCharge').innerHTML = '';
      el('cbChargeText').textContent = '—'; el('cbUltimateName').textContent = 'Ultimate charge';
      el('cbBossIntent').textContent = 'The teacher chooses when the boss attacks.';
    }
    el('cbBossGuard').hidden = !(state && state.guard);
    el('cbBoss').classList.toggle('cbDefeated', !!state && state.status === 'victory');
    el('cbFeedback').textContent = feedback();
    el('cbTurnName').textContent = window.wheelSpinning ? 'The wheel is choosing…' : selected ? selected.name + ' · ' + roleText[roleOf(selected)].name + ' · MP ' + (selected.mp || 0) + '/' + (selected.stats.maxMp || 0) : 'Spin the wheel to call a hero';
    ['cbCorrect', 'cbIncorrect', 'cbSkip'].forEach(function (id) { el(id).disabled = locked || !active || !pending; });
    el('cbAttack').disabled = locked || !active || !!pending || !!b && state.charge >= b.chargeMax;
    el('cbUltimate').disabled = locked || !active || !!pending || !b || state.charge < b.chargeMax;
    el('cbStart').disabled = locked || !classId || !heroes.length;
    el('cbStart').textContent = state ? 'New encounter' : 'Start encounter';
    el('wheelSpinBtn').disabled = locked || !active || !!pending || !window.wheelState || !wheelState.names.length;
    el('wheelClassSelect').disabled = busy || !!timing || selectionInFlight || !!window.wheelSpinning;
    var preview = el('wheelHeroPreview'); preview.hidden = !selected;
    if (selected) preview.innerHTML = avatar(selected) + '<span><strong>' + esc(selected.name) + '</strong><small>' + roleText[roleOf(selected)].name + ' · your turn</small></span>';
    bindAvatarFailures(preview);
    el('cbTiming').hidden = !timing;
    el('cbEncounterChoice').disabled = locked;
    renderCommands(); renderJournal(); renderLoot();
  }
  function center(node) {
    if (!node) return null;
    var rect = node.getBoundingClientRect(), base = el('cbEffects').getBoundingClientRect();
    return { x: rect.left + rect.width / 2 - base.left, y: rect.top + rect.height / 2 - base.top };
  }
  function heroNode(id) { return Array.from(el('cbHeroes').children).find(function (node) { return node.dataset.heroId === id; }); }
  function particle(text, from, to, kind, delay) {
    if (!from || !to) return;
    var p = document.createElement('span'); p.className = 'cbParticle ' + kind; p.textContent = text;
    p.style.left = from.x + 'px'; p.style.top = from.y + 'px'; el('cbEffects').appendChild(p);
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var anim = p.animate([{ transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 }, { opacity: 1, offset: .15 }, { transform: 'translate(calc(-50% + ' + (to.x - from.x) + 'px),calc(-50% + ' + (to.y - from.y) + 'px)) scale(1.2)', opacity: 1 }, { transform: 'translate(calc(-50% + ' + (to.x - from.x) + 'px),calc(-50% + ' + (to.y - from.y) + 'px)) scale(1.7)', opacity: 0 }], { duration: reduce ? 120 : 850, delay: reduce ? 0 : delay || 0, easing: 'ease-in-out' });
    anim.onfinish = function () { p.remove(); };
  }
  function impact(node, heal) {
    if (!node) return;
    node.animate([{ filter: 'brightness(1)' }, { filter: heal ? 'brightness(1.5) drop-shadow(0 0 12px #45d9a4)' : 'brightness(1.6) drop-shadow(0 0 12px #ffae6c)' }, { filter: 'brightness(1)' }], { duration: 600 });
  }
  function animate(event) {
    if (!opened || !event || !el('cbEffects').animate) return;
    var destination = center(el('cbBossArt')), source = center(heroNode(event.heroId));
    if (event.type === 'answer' && event.outcome === 'correct') {
      var role = event.role || 'warrior';
      if (event.damage > 0) {
      if (role === 'ranger') { particle('➶', source, destination, 'cbArrow', 0); particle('➶', source, destination, 'cbArrow', 170); }
      else particle(role === 'mage' ? '✦' : role === 'cleric' ? '✧' : '⚔', source, destination, 'cb' + role, 0);
      particle('−' + (event.damage || 0), destination, { x: destination.x, y: destination.y - 60 }, 'cbDamage', 550);
      impact(el('cbBossArt'), false);
      }
      (event.healed || []).forEach(function (h) { var node = heroNode(h.heroId), at = center(node); if (at) { particle('+' + h.amount + ' ✚', at, { x: at.x, y: at.y - 55 }, 'cbHealing', 200); impact(node, true); } });
      (event.targets || []).forEach(function (h) { var node = heroNode(h.heroId), at = center(node); if (at) { particle('◆', destination, at, 'cbBossProjectile', 400); particle('−' + h.damage, at, { x: at.x, y: at.y - 45 }, 'cbDamage', 750); impact(node, false); } });
    } else if (event.type === 'boss') {
      if (event.ultimate) {
        var area = document.createElement('div'); area.className = 'cbAreaAttack'; el('cbEffects').appendChild(area);
        var wave = area.animate([{ transform: 'scale(.2)', opacity: 0 }, { opacity: .75, offset: .25 }, { transform: 'scale(2)', opacity: 0 }], { duration: 950 }); wave.onfinish = function () { area.remove(); };
      }
      (event.targets || []).forEach(function (h, i) { var node = heroNode(h.heroId), at = center(node); if (at) { particle(event.ultimate ? '✹' : '◆', destination, at, 'cbBossProjectile', i * 65); particle('−' + h.damage, at, { x: at.x, y: at.y - 45 }, 'cbDamage', 550 + i * 65); impact(node, false); } });
      if (event.bossHealed) particle('+' + event.bossHealed + ' ✚', destination, { x: destination.x, y: destination.y - 60 }, 'cbHealing', 350);
    }
  }
  window.ClassroomBattle = { open: open, close: close, isOpen: function () { return opened; }, classChanged: classChanged, beforeSpin: beforeSpin, spinning: spinning, landed: landed, wheelClosed: wheelClosed };
  el('classroomBattleBtn').addEventListener('click', open);
  el('wheelBattleBtn').addEventListener('click', open);
  if (window.applyRewardVisibility) applyRewardVisibility();
})();
