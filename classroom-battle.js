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
  var failedAvatars = {};
  var roleText = {
    warrior: { icon: '⚔', name: 'Warrior', text: 'A strong melee strike, 35% more health and 25% more defence.' },
    ranger: { icon: '➶', name: 'Ranger', text: 'Two quick arrows and an extra 15% critical-hit chance.' },
    mage: { icon: '✦', name: 'Mage', text: 'A powerful spell projectile that ignores half the boss’s armour.' },
    healer: { icon: '✚', name: 'Healer', text: 'Light boss damage plus healing for the whole team, including resting heroes.' }
  };
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
    return students.map(function (s) {
      var h = Core.heroFromStudent(s, s.uid ? profiles[s.uid] : null);
      var saved = state && state.heroes.find(function (old) { return old.id === h.id; });
      var profile = profiles[s.uid] && profiles[s.uid].battleHero;
      if (saved && s.uid && !(profile && profile.version === 1 && profile.uid === s.uid)) {
        h.role = saved.role; h.stats = saved.stats; h.hp = saved.hp;
      }
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
      '<header class="cbHeader"><div><span class="cbEyebrow">LEARN TOGETHER · WIN TOGETHER</span><h2 id="cbTitle">Classroom boss battle</h2><p id="cbClassLabel">Choose a class on the wheel</p></div><div class="cbHeaderActions"><span class="cbSaved" id="cbSaveStatus" role="status">Choose a class</span><button type="button" id="cbClose" aria-label="Close battle">✕</button></div></header>' +
      '<div id="cbError" class="cbError" role="alert" hidden></div>' +
      '<main class="cbMain"><aside class="cbWheelPane"><div class="cbSectionTitle"><span>01 / CALL A HERO</span><span class="cbLiveDot">LIVE WHEEL</span></div><div id="cbWheelMount" class="cbWheelSlot"></div><details class="cbHelp"><summary>How your CER hero helps</summary><p>Your existing CER avatar, equipped items and stats update here automatically. Choose your role in CER. Each class has its own saved encounter.</p><div id="cbRoleGuide"></div><p>Attack powers damage; health and defence keep heroes standing. CER stats use bounded square-root scaling so every student can contribute. Critical chance is shown as a percentage. A resting hero returns at 25% health on a correct answer; healers can also revive teammates.</p><a href="https://polymathlc.github.io/cer/" target="_blank" rel="noopener">Open CER to choose your role ↗</a></details></aside>' +
      '<section class="cbArena" id="cbArena" aria-label="Battlefield"><div class="cbArenaTop"><div class="cbSectionTitle">02 / WORK AS A TEAM</div><span id="cbEncounterStatus" class="cbEncounterStatus">Ready when you are</span></div><div class="cbBattlefield"><section class="cbTeam"><div class="cbTeamTitle"><h3>Your heroes</h3><span id="cbTeamCount"></span></div><div id="cbHeroes" class="cbHeroes"></div></section>' +
      '<section class="cbBoss" id="cbBoss"><span class="cbBossTag" id="cbBossTag">MYSTERY ENCOUNTER</span><div class="cbBossArt" id="cbBossArt"><span class="cbMystery">?</span></div><h3 id="cbBossName">A new challenger awaits</h3><p id="cbBossStyle">Start an encounter to meet one of 20 original bosses.</p><div class="cbHpLine"><span>Boss health</span><strong id="cbBossHp">—</strong></div><div class="cbHp cbBossHp"><span id="cbBossBar"></span></div><div class="cbChargeLabel"><span id="cbUltimateName">Ultimate charge</span><strong id="cbChargeText">—</strong></div><div id="cbCharge" class="cbCharge"></div><p class="cbBossIntent" id="cbBossIntent">The teacher chooses when the boss attacks.</p></section></div><div id="cbEffects" class="cbEffects" aria-hidden="true"></div>' +
      '<div id="cbFeedback" class="cbFeedback" role="status" aria-live="polite">Choose a class and start an encounter. Your progress saves after every action.</div></section></main>' +
      '<footer class="cbControls"><div class="cbAnswerControls"><div class="cbTurnLabel"><span class="cbEyebrow">03 / RESOLVE THE ANSWER</span><strong id="cbTurnName">Spin the wheel to call a hero</strong></div><div class="cbAnswerButtons"><button id="cbCorrect" class="cbCorrect">✓ Correct <small>Use hero ability</small></button><button id="cbIncorrect">↻ Incorrect <small>Keep learning</small></button><button id="cbSkip">→ Skip <small>Next student</small></button></div></div><div class="cbTeacherControls"><button id="cbAttack">Boss attack</button><button id="cbUltimate" class="cbUltimate">Ultimate</button><button id="cbStart" class="cbStart">Start encounter</button></div></footer></section>';
    document.body.appendChild(node);
    el('cbRoleGuide').innerHTML = Object.keys(roleText).map(function (key) { var r = roleText[key]; return '<p><strong>' + r.icon + ' ' + r.name + '</strong> · ' + r.text + '</p>'; }).join('');
    el('cbClose').addEventListener('click', close);
    el('cbStart').addEventListener('click', start);
    el('cbCorrect').addEventListener('click', function () { answer('correct'); });
    el('cbIncorrect').addEventListener('click', function () { answer('incorrect'); });
    el('cbSkip').addEventListener('click', function () { answer('skip'); });
    el('cbAttack').addEventListener('click', function () { attack(false); });
    el('cbUltimate').addEventListener('click', function () { attack(true); });
    node.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
      if (e.key === 'Tab') {
        var items = Array.from(node.querySelectorAll('button:not([disabled]),select:not([disabled]),input:not([disabled]),summary,a[href]')).filter(function (n) { return n.getClientRects().length; });
        var first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      } else if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
    });
  }
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
    detach(); classId = cls; teacherId = uid || ''; state = null; profiles = {}; visuals = {}; error = ''; lastEventId = ''; loading = !!cls;
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
    var watched = new Set();
    rwStudentsInClass(cls).forEach(function (student) {
      if (!student.uid || watched.has(student.uid)) return;
      watched.add(student.uid);
      pendingProfiles++;
      var settled = false;
      function settle() { if (!settled) { settled = true; pendingProfiles--; } }
      offProfiles.push(db.collection('scienceGameLeaderboard').doc(student.uid).onSnapshot(function (snap) {
        if (stamp !== epoch || !opened) return;
        settle();
        profiles[student.uid] = snap.exists ? snap.data() : null;
        roster(); render(); scheduleSync();
      }, function () {
        if (stamp !== epoch || !opened) return;
        settle(); profiles[student.uid] = null; roster(); render(); scheduleSync();
      }));
    });
    roster(); render();
  }
  function scheduleSync() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      syncTimer = null;
      if (!opened || !store || !state || !classReady || pendingProfiles) return;
      if (busy || selectionInFlight || window.wheelSpinning) { scheduleSync(); return; }
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
    if (!allowed() || !classId || !classReady || pendingProfiles || busy || window.wheelSpinning) return;
    var heroes = roster();
    if (!heroes.length) { showError(new Error('Add students to this class or to the wheel first.')); return; }
    if (state && state.status === 'active' && !window.confirm('Start another encounter for ' + classId + '? This replaces the current boss and restores your team’s health.')) return;
    var chosen = Core.BOSSES[Math.floor((window.wheelRandom ? wheelRandom() : Math.random()) * Core.BOSSES.length)];
    try { await act({ type: 'start', heroes: heroes, bossId: chosen.id }); } catch (_) {}
  }
  function beforeSpin() {
    if (!opened) return true;
    if (!allowed() || busy || selectionInFlight || loading || pendingProfiles) return false;
    if (!state || state.status !== 'active') { showError(new Error('Start an encounter before calling a hero.')); return false; }
    if (state.pending) { showError(new Error('Choose Correct, Incorrect or Skip for the current answer first.')); return false; }
    error = ''; return true;
  }
  function spinning() { if (opened) render(); }
  function wheelClosed() {
    wheelPreviewEpoch++;
    if (offWheelProfile) offWheelProfile(); offWheelProfile = null;
    el('wheelHeroPreview').hidden = true;
  }
  function wheelPreview(entry) {
    wheelClosed();
    if (!entry || !allowed()) return;
    var student = entry.id && window.rwStudents.find(function (s) { return s.id === entry.id; });
    var stamp = wheelPreviewEpoch;
    function paint(profile) {
      if (stamp !== wheelPreviewEpoch || !allowed() || opened) return;
      var h = Core.heroFromStudent(student || { id: guestId(entry), name: entry.n }, profile);
      visuals[h.id] = h;
      var preview = el('wheelHeroPreview'); preview.hidden = false;
      preview.innerHTML = avatar(h) + '<span><strong>' + esc(h.name) + '</strong><small>' + esc(h.avatarUrl ? (roleText[h.role] || roleText.warrior).name + ' · CER synced' : h.fallbackReason) + '</small></span>';
      bindAvatarFailures(preview);
    }
    paint(null);
    if (student && student.uid) offWheelProfile = db.collection('scienceGameLeaderboard').doc(student.uid).onSnapshot(function (snap) { paint(snap.exists ? snap.data() : null); }, function () { paint(null); });
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
    if (!allowed() || busy || selectionInFlight || !state || !state.pending || window.wheelSpinning) return;
    try { await act({ type: 'answer', turnId: state.pending.id, outcome: outcome }); } catch (_) {}
  }
  async function attack(ultimate) {
    if (!allowed() || busy || selectionInFlight || !state || state.status !== 'active' || state.pending || window.wheelSpinning) return;
    var b = boss(); if (ultimate && (!b || state.charge < b.chargeMax)) return;
    try { await act({ type: 'boss', ultimate: !!ultimate }); } catch (_) {}
  }
  function avatar(h, extra) {
    var view = visuals[h.id] || h, url = view.avatarUrl;
    if (!failedAvatars[url] && typeof url === 'string' && /^(data:image\/(?:svg\+xml|png|jpeg|webp)[;,]|https:\/\/)/i.test(url)) {
      return '<img class="cbAvatar ' + (extra || '') + '" src="' + esc(url) + '" alt="' + esc(h.name) + '’s CER avatar" loading="lazy">';
    }
    return '<span class="cbAvatar cbAvatarFallback ' + (extra || '') + '" aria-label="Starter hero">' + (roleText[h.role] || roleText.warrior).icon + '</span>';
  }
  function bindAvatarFailures(container) {
    container.querySelectorAll('img.cbAvatar').forEach(function (img) {
      img.onerror = function () {
        failedAvatars[img.getAttribute('src')] = true;
        var card = img.closest('.cbHero') || img.closest('.cbWheelHero');
        var note = card && (card.querySelector('.cbAvatarNote') || card.querySelector('small'));
        if (note) note.textContent = 'Avatar unavailable — stats are synced';
        var fallback = document.createElement('span'); fallback.className = 'cbAvatar cbAvatarFallback'; fallback.textContent = '⚔'; fallback.setAttribute('aria-label', 'Avatar unavailable — starter hero shown'); img.replaceWith(fallback);
      };
    });
  }
  function feedback() {
    if (error) return 'The action was not confirmed. Check the message above before continuing.';
    if (!classId) return 'Choose a class on the wheel to load its saved progress.';
    if (loading) return 'Loading your class’s saved encounter…';
    if (!state) return 'Your team is ready. Start an encounter to meet a random boss.';
    if (state.status === 'victory') return 'Victory! Every answer helped. Your victory is saved — start another encounter whenever you’re ready.';
    if (state.status === 'defeat') return 'A brave effort! Your progress is saved. Start another encounter to give the class a fresh try.';
    var event = state.lastEvent, hero = event && state.heroes.find(function (h) { return h.id === event.heroId; });
    if (event && event.type === 'answer') {
      if (event.outcome !== 'correct') return (hero ? hero.name : 'Hero') + (event.outcome === 'skip' ? ' passed this turn. Spin for the next student.' : ' is still learning. No hero attack this turn — try the next question!');
      var healed = (event.healed || []).reduce(function (sum, h) { return sum + (h.amount || 0); }, 0);
      return (hero ? hero.name : 'Your hero') + ' dealt ' + (event.damage || 0) + ' damage' + (event.critical ? ' — critical hit!' : '!') + (healed ? ' Team healing: +' + healed + ' HP.' : '') + ' Spin to call the next hero.';
    }
    if (event && event.type === 'boss') return (event.move || (event.ultimate ? 'Ultimate attack' : 'Boss attack')) + ' hit ' + (event.targets || []).length + ' hero' + ((event.targets || []).length === 1 ? '' : 'es') + '. The teacher decides when the next boss turn happens.';
    if (state.pending) return 'Ask your question, then choose Correct, Incorrect or Skip. This answer can resolve only once.';
    return 'Spin the wheel for the next hero. Boss attacks only happen when the teacher triggers them.';
  }
  function render() {
    if (!opened || !el('classroomBattle')) return;
    var heroes = state ? state.heroes : roster(), b = boss(), pending = state && state.pending;
    var active = state && state.status === 'active', selected = pending && heroes.find(function (h) { return h.id === pending.heroId; });
    var locked = busy || loading || pendingProfiles > 0 || selectionInFlight || !!window.wheelSpinning || !classReady || !allowed();
    el('cbClassLabel').textContent = classId || 'Choose a class on the wheel';
    el('cbError').hidden = !error; el('cbError').textContent = error;
    el('cbSaveStatus').textContent = busy ? 'Saving…' : loading || pendingProfiles ? 'Loading…' : error ? 'Needs attention' : state ? '✓ Saved to your class' : 'Ready to start';
    el('cbSaveStatus').classList.toggle('cbSaveError', !!error);
    el('cbEncounterStatus').textContent = state ? (state.status === 'victory' ? '★ VICTORY' : state.status === 'defeat' ? 'ENCOUNTER COMPLETE' : 'ENCOUNTER IN PROGRESS') : 'READY WHEN YOU ARE';
    el('cbTeamCount').textContent = heroes.length + ' heroes';
    el('cbHeroes').innerHTML = heroes.length ? heroes.map(function (h) {
      var role = roleText[h.role] || roleText.warrior, stats = h.stats || {}, view = visuals[h.id] || h;
      var hp = state ? h.hp : stats.maxHp, maxHp = stats.maxHp || 1, ratio = Math.max(0, Math.min(100, hp / maxHp * 100));
      var equipped = view.equipment ? Object.values(view.equipment).filter(Boolean).length : 0;
      return '<article class="cbHero ' + (selected && selected.id === h.id ? 'cbSelected ' : '') + (hp <= 0 ? 'cbResting' : '') + '" data-hero-id="' + esc(h.id) + '">' +
        '<span class="cbHeroRole" title="' + esc(role.text) + '">' + role.icon + '</span>' + avatar(h) + '<strong class="cbHeroName">' + esc(h.name) + '</strong><span class="cbRoleName">' + role.name + '</span>' +
        '<div class="cbHp"><span style="width:' + ratio + '%"></span></div><span class="cbHeroHp">' + hp + ' / ' + maxHp + ' HP' + (hp <= 0 ? ' · resting' : '') + '</span>' +
        '<span class="cbHeroStats" title="Damage · Defence · Healing · Critical chance">⚔ ' + (stats.damage || 0) + ' · 🛡 ' + (stats.defence || 0) + (stats.healing ? ' · ✚ ' + stats.healing : '') + ' · ' + Math.round((stats.critChance || 0) * 100) + '% crit</span>' +
        '<span class="cbAvatarNote">' + (failedAvatars[view.avatarUrl] ? 'Avatar unavailable — stats are synced' : view.avatarUrl ? 'CER synced' + (equipped ? ' · ' + equipped + ' items' : '') : esc(view.fallbackReason || 'Starter hero · CER avatar unavailable')) + '</span></article>';
    }).join('') : '<p class="cbEmpty">Choose a class to gather your heroes. Names without a linked CER account receive a starter hero.</p>';
    // A malformed avatar must never hide the student or break the battle.
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
      el('cbBossIntent').textContent = state.charge >= b.chargeMax ? 'Ultimate ready! Hits the whole team when triggered.' : 'Next attack: ' + b.attackName + ' · +1 ultimate charge';
      el('cbAttack').textContent = b.attackName;
      el('cbUltimate').textContent = state.charge >= b.chargeMax ? '✦ ' + b.ultimateName : 'Ultimate · ' + state.charge + '/' + b.chargeMax;
    } else {
      el('cbBossArt').dataset.boss = ''; el('cbBossArt').innerHTML = '<span class="cbMystery">?</span>';
      el('cbBossTag').textContent = 'MYSTERY ENCOUNTER'; el('cbBossName').textContent = 'A new challenger awaits';
      el('cbBossStyle').textContent = 'Start an encounter to meet one of 20 original bosses.';
      el('cbBossHp').textContent = '—'; el('cbBossBar').style.width = '100%'; el('cbCharge').innerHTML = '';
      el('cbChargeText').textContent = '—'; el('cbUltimateName').textContent = 'Ultimate charge';
      el('cbBossIntent').textContent = 'The teacher chooses when the boss attacks.';
    }
    el('cbBoss').classList.toggle('cbDefeated', !!state && state.status === 'victory');
    el('cbFeedback').textContent = feedback();
    el('cbTurnName').textContent = window.wheelSpinning ? 'The wheel is choosing…' : selected ? selected.name + ' · ' + (roleText[selected.role] || roleText.warrior).name : 'Spin the wheel to call a hero';
    ['cbCorrect', 'cbIncorrect', 'cbSkip'].forEach(function (id) { el(id).disabled = locked || !active || !pending; });
    el('cbAttack').disabled = locked || !active || !!pending;
    el('cbUltimate').disabled = locked || !active || !!pending || !b || state.charge < b.chargeMax;
    el('cbStart').disabled = locked || !classId || !heroes.length;
    el('cbStart').textContent = state ? 'New encounter' : 'Start encounter';
    el('wheelSpinBtn').disabled = locked || !active || !!pending || !window.wheelState || !wheelState.names.length;
    el('wheelClassSelect').disabled = busy || selectionInFlight || !!window.wheelSpinning;
    var preview = el('wheelHeroPreview'); preview.hidden = !selected;
    if (selected) preview.innerHTML = avatar(selected) + '<span><strong>' + esc(selected.name) + '</strong><small>' + (roleText[selected.role] || roleText.warrior).name + ' · your turn</small></span>';
    bindAvatarFailures(preview);
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
      if (role === 'ranger') { particle('➶', source, destination, 'cbArrow', 0); particle('➶', source, destination, 'cbArrow', 170); }
      else particle(role === 'mage' ? '✦' : role === 'healer' ? '✧' : '⚔', source, destination, 'cb' + role, 0);
      particle('−' + (event.damage || 0), destination, { x: destination.x, y: destination.y - 60 }, 'cbDamage', 550);
      impact(el('cbBossArt'), false);
      (event.healed || []).forEach(function (h) { var node = heroNode(h.heroId), at = center(node); if (at) { particle('+' + h.amount + ' ✚', at, { x: at.x, y: at.y - 55 }, 'cbHealing', 200); impact(node, true); } });
    } else if (event.type === 'boss') {
      if (event.ultimate) {
        var area = document.createElement('div'); area.className = 'cbAreaAttack'; el('cbEffects').appendChild(area);
        var wave = area.animate([{ transform: 'scale(.2)', opacity: 0 }, { opacity: .75, offset: .25 }, { transform: 'scale(2)', opacity: 0 }], { duration: 950 }); wave.onfinish = function () { area.remove(); };
      }
      (event.targets || []).forEach(function (h, i) { var node = heroNode(h.heroId), at = center(node); if (at) { particle(event.ultimate ? '✹' : '◆', destination, at, 'cbBossProjectile', i * 65); particle('−' + h.damage, at, { x: at.x, y: at.y - 45 }, 'cbDamage', 550 + i * 65); impact(node, false); } });
    }
  }
  window.ClassroomBattle = { open: open, close: close, isOpen: function () { return opened; }, classChanged: classChanged, beforeSpin: beforeSpin, spinning: spinning, landed: landed, wheelClosed: wheelClosed };
  el('classroomBattleBtn').addEventListener('click', open);
  el('wheelBattleBtn').addEventListener('click', open);
  if (window.applyRewardVisibility) applyRewardVisibility();
})();
