/* Points-triggered wheel battles. Each awarded amount has a durable action receipt. */
(function () {
  'use strict';
  var Core = window.ClassroomBattleCore, Store = window.ClassroomBattleStore;
  if (!Core || !Store) return;
  var q = { epoch: 0, store: null, off: null, state: null, queued: null, player: null, playing: false, before: null, cls: '', uid: '', loading: false, busy: false, error: '', heroId: '', selection: null, request: null, assistOpen: false, assistMessage: '', assisted: new Set(), on: true };
  var played = new Set(), missionPanel = null;
  function missionBusy() {return !!(missionPanel && missionPanel.blocked());}
  function cancelFeedback() { if (q.player) q.player.cancel(); q.player=null; q.playing=false; q.before=null; }
  try { q.on = localStorage.getItem('polymath.wheelQuickFight') !== 'off'; } catch (_) {}
  function el(id) { return document.getElementById(id); }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function manual() { return window.ClassroomBattle && ClassroomBattle.isOpen(); }
  function visible() { return !!el('wheelModal') && el('wheelModal').classList.contains('open'); }
  function allowed() { return !!(window.wheelTeacher && wheelTeacher() && window.currentUser && currentUser.uid); }
  function mount() {
    if (el('wheelQuickFight')) return;
    var box = document.createElement('section'); box.id = 'wheelQuickFight'; box.className = 'cbQuick';
    box.innerHTML = '<label class="cbQuickToggle"><input id="wheelQuickToggle" type="checkbox"><span>Quick fight<small>Spin → award points → fight · +1 point = 1× power</small></span></label><div id="wheelQuickDuel" class="cbQuickDuel" aria-label="Quick fight duel"></div><p id="wheelQuickStatus" class="cbQuickStatus" role="status" aria-live="polite"></p><div id="wheelQuickAssist"></div><div id="wheelQuickLog"></div><button id="wheelQuickRetry" type="button" class="rwAmount" hidden></button>';
    var side = el('wheelSide');
    if (side) side.appendChild(box); else document.querySelector('#wheelModal .whSpinRow').insertAdjacentElement('afterend', box);
    var mission = document.createElement('section'); mission.id='wheelMissionDock'; mission.className='whMissionDock';
    mission.innerHTML='<div id="wheelMission"></div><p id="wheelMissionHint" class="whMissionHint"></p>';
    box.insertAdjacentElement('beforebegin', mission);
    el('wheelQuickToggle').checked = q.on;
    el('wheelQuickRetry').addEventListener('click', function () { (q.request && q.request.kind === 'assist' ? assist(null, true) : award(null, 0, '', true)).catch(function (err) { if (window.toast) toast(err.message); }); });
    el('wheelQuickAssist').addEventListener('click', function (event) {
      if (event.target.closest('[data-assist-toggle]')) { q.assistOpen = !q.assistOpen; render(); }
      if (event.target.closest('[data-assist-save]')) assist(el('wheelAssistStudent').value).catch(function (err) { if (window.toast) toast(err.message); });
    });
    el('wheelQuickToggle').addEventListener('change', function () {
      q.on = this.checked;
      try { localStorage.setItem('polymath.wheelQuickFight', q.on ? 'on' : 'off'); } catch (_) {}
      if (!q.on) cancelFeedback();
      open(window.wheelClass || '');
    });
  }
  function close() {
    cancelFeedback(); q.queued = null; if (missionPanel) missionPanel.destroy(); missionPanel=null;
    q.epoch++; if (q.off) q.off(); q.off = null; q.store = null;
    q.busy = false; q.loading = false; q.state = null; q.heroId = ''; q.selection = null; q.request = null; q.assistOpen = false; q.assistMessage = ''; q.error = '';
    if (el('wheelQuickFight')) el('wheelQuickFight').hidden = true;
    if (el('wheelMissionDock')) el('wheelMissionDock').hidden = true;
    if (el('wheelClassSelect')) el('wheelClassSelect').disabled = false;
  }
  function open(cls) {
    mount(); el('wheelQuickFight').hidden = manual();
    if (manual() || !allowed() || !visible()) { close(); return; }
    var uid = currentUser.uid;
    if (q.store && q.cls === cls && q.uid === uid) { render(); return; }
    close(); q.cls = cls; q.uid = uid;
    try {
      var saved = JSON.parse(sessionStorage.getItem(requestKey(uid, cls)) || 'null');
      if (saved && saved.action && /^[a-zA-Z0-9_-]{8,100}$/.test(saved.action.id || '') && (saved.kind === 'assist' || Number.isSafeInteger(saved.delta) && saved.delta > 0 && saved.delta <= 10000)) q.request = saved;
    } catch (_) {}
    if (q.request) q.heroId = q.request.action.heroId;
    if (!cls) { render(); return; }
    if (q.on && window.ClassroomBattleAnimation) ClassroomBattleAnimation.prepare();
    var stamp = q.epoch; q.loading = true; render();
    try {
      q.store = Store.create({ onMission:function(result){if(missionPanel)missionPanel.receive(result);}, db: window.db, teacherId: uid, classId: cls, canWrite: function () { return !manual() && stamp === q.epoch && allowed() && currentUser.uid === uid && window.wheelClass === cls && visible(); } });
      mountMission();
      q.off = q.store.subscribe(function (next) {
        if (stamp !== q.epoch) return;
        if (next && q.state && next.revision < q.state.revision) return;
        // Store listeners often arrive before the command response. Keep the
        // persisted snapshot, but let one acknowledged event own its playback.
        if (q.busy) { if (!q.queued || !next || next.revision >= q.queued.revision) q.queued = next; return; }
        if(q.playing && next && q.state && next.revision>q.state.revision)cancelFeedback(); q.state = next; q.loading = false; render(); if (missionPanel) missionPanel.refresh();
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
      var linked = window.wheelStudent && wheelStudent(entry);
      if (linked && seen.has(linked.id)) return;
      students.push({ id: guestId(entry), name: entry.n });
    });
    return students.map(function (student, index) { return Core.heroFromStudent(student, null, index); });
  }
  function heroId(entry) {
    var student = window.wheelStudent && wheelStudent(entry);
    if (student && !rwStudentClasses(student).includes(q.cls)) student = null;
    return Core.heroFromStudent(student || { id: guestId(entry), name: entry.n }).id;
  }
  function summary(s) {
    if (q.request && q.request.kind === 'assist') return 'Retry to confirm ' + q.request.studentName + '’s assist. The same helper receives XP only once per question.';
    if (q.assistMessage && !q.request) return q.assistMessage;
    if (q.request) return 'Confirm the pending +' + q.request.delta + ' points for ' + q.request.studentName + ' using Retry. The same award is never counted twice.';
    if (q.selection && (!s || !s.lastEvent || s.lastEvent.spinId !== q.selection.spinId)) return q.selection.entry.n + ' is ready. Award points for a correct answer to attack. +1 = 1× power; +5 = 5× power.';
    if (!s) return 'Spin to choose a student, then award points for a correct answer. Spinning alone never causes damage.';
    if (s.pending) return 'A manual answer is waiting. Open Battle to resolve it before using Quick fight.';
    var event = s.lastEvent || {}, h = s.heroes.find(function (hero) { return hero.id === event.heroId; });
    if(event.type==='summon') return 'One-Punch Chung · '+Number(event.damage||0)+' damage. Victory! Every hero earned treasure.';
    var text = event.type === 'auto' ? (h ? h.name : 'Hero') + ': ' + (event.move || 'Attack') + ' · +' + (event.points || 1) + ' points · ' + (event.damage || 0) + ' damage' : 'Award points after a spin to fight.';
    var healed = (event.healed || []).reduce(function (sum, entry) { return sum + entry.amount; }, 0);
    if (healed) text += ' · +' + healed + ' team HP';
    if (event.enemy) text += '. Enemy: ' + event.enemy.move + ' · ' + event.enemy.targets.reduce(function (sum, target) { return sum + target.damage; }, 0) + ' damage';
    if (s.status === 'victory') text += '. Victory! Every hero earned treasure. The next points award starts a new encounter.';
    if (s.status === 'defeat') text += '. Encounter ended. The next points award restores the party for a new encounter.';
    return text;
  }
  function avatar(hero, small) {
    var role = hero.role === 'healer' ? 'cleric' : hero.role;
    return window.ClassroomBattleAnimation ? ClassroomBattleAnimation.heroMarkup(role, { job:hero.job, gender:hero.gender, className: 'cbAvatar', alt: Core.ROLES[role].name + ' pixel hero', dormant: hero.hp <= 0 && !q.playing }) : '<img class="cbAvatar" src="assets/battle-pixel/' + esc(role) + '.png" alt="' + esc(Core.ROLES[role].name) + ' pixel hero">';
  }
  function controls(s) {
    el('wheelQuickToggle').disabled = q.busy || missionBusy() || !!q.request || !!window.wheelSpinning;
    if (q.on && q.cls) el('wheelSpinBtn').disabled = q.loading || q.busy || missionBusy() || !!q.request || !!window.wheelSpinning || !!(s && s.pending) || !window.wheelState || !wheelState.names.length;
    if (!q.on) el('wheelSpinBtn').disabled = missionBusy() || !!window.wheelSpinning || !window.wheelState || !wheelState.names.length;
    el('wheelClassSelect').disabled = q.busy || missionBusy() || !!q.request || !!window.wheelSpinning;
    el('wheelQuickRetry').hidden = !q.on || !q.request || q.busy;
    el('wheelQuickRetry').disabled = q.loading || q.busy;
    el('wheelQuickRetry').textContent = q.request ? q.request.kind === 'assist' ? 'Retry assist for ' + q.request.studentName : 'Retry +' + q.request.delta + ' points for ' + q.request.studentName : '';
    renderAssist();
    var selected = window.wheelState && window.wheelStudent && wheelStudent(wheelState.names[window.wheelWinnerIdx]);
    document.querySelectorAll('#wheelAward button, #wheelAward input').forEach(function (button) { button.disabled = blocksAward() || !!(window.rwAwarding && selected && rwAwarding[selected.id]); });
  }
  function render(force) {
    if (!el('wheelQuickFight')) return;
    el('wheelQuickFight').hidden = manual() || !visible();
    el('wheelMissionDock').hidden = manual() || !visible();
    if (manual() || !visible()) return;
    controls(q.state);
    el('wheelQuickLog').innerHTML = q.on && window.ClassroomBattleDisplay ? ClassroomBattleDisplay.log(q.state) : '';
    el('wheelMissionHint').textContent = !q.cls ? 'Choose a Lesson slot to turn for a class mission.' : !q.on ? 'Turn on Quick fight to use a summon during battle.' : '';
    el('wheelMissionHint').hidden = !!q.cls && q.on;
    if (!missionPanel) el('wheelMission').innerHTML = '<section class="mmPanel" aria-label="Class mission machine"><div class="mmHeading"><span class="mmMachine" role="img" aria-label="Pixel mission slot machine"></span><div><span class="mmEyebrow">WHOLE CLASS QUEST</span><h3>Mission machine</h3><p>Turn for a random objective and a class prize.</p></div></div><button type="button" disabled>↻ Turn</button></section>';
    if (missionPanel) missionPanel.render();
    el('wheelQuickStatus').textContent = !q.on ? 'Name wheel only. Turn on Quick fight to battle when points are awarded.' : q.error || (!q.cls ? 'Choose a Lesson slot to enable battles for points.' : q.loading ? 'Loading the saved encounter…' : q.busy ? 'Saving answer…' : window.wheelSpinning ? 'Choosing your champion…' : summary(q.state));
    if (q.playing && !force) return;
    var s = q.state, heroes = s ? s.heroes : roster(), h = heroes.find(function (hero) { return hero.id === q.heroId; }) || roster().find(function (hero) { return hero.id === q.heroId; }) || heroes.find(function (hero) { return s && s.lastEvent && hero.id === s.lastEvent.heroId; }) || heroes[0];
    var b = s ? Core.bossById(s.bossId) : q.selection ? Core.bossById(enemyFor(q.selection.spinId)) : null, role = h && (h.role === 'healer' ? 'cleric' : h.role);
    var shownHero = h;
    el('wheelQuickDuel').hidden = !q.on;
    el('wheelQuickStatus').hidden = !q.on;
    el('wheelQuickDuel').innerHTML = !q.on ? '' : '<div class="cbQuickHero" data-cba-actor="hero" data-cba-hero-id="' + esc(h && h.id) + '">' + (h ? avatar(h) + '<strong>' + esc(h.name) + '</strong><small>' + esc(Core.JOBS && Core.JOBS[h.job] ? Core.JOBS[h.job].name : Core.ROLES[role].name) + ' · LV ' + h.level + '</small>' + bars(h.name, shownHero ? shownHero.hp : null, shownHero ? shownHero.stats.maxHp : null, shownHero ? shownHero.mp : null, shownHero ? shownHero.stats.maxMp : null) : '<span>Choose a hero</span>') + '</div><b class="cbQuickVs">VS</b><div class="cbQuickEnemy" data-cba-actor="enemy">' + (b ? '<img src="' + esc(b.image) + '" alt="' + esc(b.name) + ' pixel enemy"><strong>' + esc(b.name) + '</strong><small>' + (s && s.status === 'victory' ? 'VICTORY' : s && s.status === 'defeat' ? 'FINISHED' : 'ENEMY') + '</small>' + bars(b.name, s ? s.bossHp : null, s ? s.bossMaxHp : null, s ? enemyMp(s) : null, s ? (s.bossMaxMp || Core.BOSS_MAX_MP || 60) : null) : '<span class="cbQuickMystery" aria-hidden="true">?</span><strong>Next encounter</strong><small>Revealed on your spin · waits for points</small>') + '</div>';
    if (q.playing && s && s.lastEvent) {
      var affected = new Set((s.lastEvent.healed || []).concat(s.lastEvent.supported || [], s.lastEvent.enemy && s.lastEvent.enemy.targets || []).map(function (entry) { return entry.heroId; }));
      var teammates = heroes.filter(function (hero) { return hero.id !== h.id && affected.has(hero.id); });
      if (teammates.length) el('wheelQuickDuel').innerHTML += '<div class="cbaParty" aria-label="Teammates affected by this turn">' + teammates.map(function (hero) { return '<div class="cbaRecipient" data-cba-hero-id="' + esc(hero.id) + '">' + avatar(hero, true) + '<strong>' + esc(hero.name) + '</strong></div>'; }).join('') + '</div>';
    }
    if (s && s.status === 'victory' && q.on) el('wheelQuickDuel').innerHTML += '<div class="cbQuickTreasure"><span class="cbChest" aria-label="Opening treasure chest" role="img"></span><div class="cbQuickSpoils"><h4>Treasure for all ' + s.rewards.length + ' heroes</h4>' + (window.ClassroomBattleDisplay ? ClassroomBattleDisplay.treasure(s) : '') + '</div></div>';
    if (window.ClassroomBattleAnimation) ClassroomBattleAnimation.mount(el('wheelQuickDuel'));
    el('wheelQuickStatus').textContent = !q.on ? 'Name wheel only. Turn on Quick fight to battle when points are awarded.' : q.error || (!q.cls ? 'Choose a Lesson slot to enable battles for points.' : q.loading ? 'Loading the saved encounter…' : q.busy ? 'Saving answer…' : window.wheelSpinning ? 'Choosing your champion…' : summary(s));
    el('wheelQuickStatus').classList.toggle('cbQuickError', !!q.error);
    if (q.on) el('wheelHeroPreview').hidden = true;
  }
  function enemyMp(state) { return Number.isFinite(state.bossMp) ? state.bossMp : Core.BOSS_MAX_MP || 60; }
  function bars(name, hp, maxHp, mp, maxMp) {
    return [['HP',hp,maxHp],['MP',mp,maxMp]].map(function (resource) {
      var known = Number.isFinite(resource[1]) && Number.isFinite(resource[2]) && resource[2] > 0;
      var value = known ? Math.max(0, Math.min(resource[2], resource[1])) : 0;
      return '<div class="cbQuickResource cbQuickResource-' + resource[0].toLowerCase() + '"><span>' + resource[0] + ' ' + (known ? value + '/' + resource[2] : '…') + '</span><div class="cbQuickBar" role="progressbar" aria-label="' + esc(name + ' ' + resource[0]) + '" aria-valuemin="0"' + (known ? ' aria-valuenow="' + value + '" aria-valuemax="' + resource[2] + '"' : ' aria-valuetext="Ready when the encounter begins"') + '><i style="width:' + (known ? value/resource[2]*100 : 0) + '%"></i></div></div>';
    }).join('');
  }
  function renderAssist() {
    var host = el('wheelQuickAssist'); if (!host) return;
    var called = q.selection && window.wheelStudent && wheelStudent(q.selection.entry);
    host.hidden = !q.on || !called || !!window.wheelSpinning;
    if (host.hidden) return;
    var helpers = rwStudentsInClass(q.cls).filter(function (student) { return student.id !== called.id; });
    var picked = el('wheelAssistStudent') && el('wheelAssistStudent').value;
    var busy = q.busy || q.loading || missionBusy() || !!q.request;
    host.innerHTML = '<button type="button" class="cbAssistToggle" data-assist-toggle aria-expanded="' + q.assistOpen + '"' + (busy || !helpers.length ? ' disabled' : '') + '>✦ Assist · reward a helper</button>' + (q.assistOpen ? '<div class="cbAssistPanel"><label for="wheelAssistStudent">Who helped ' + esc(called.name) + '?</label><select id="wheelAssistStudent"' + (busy ? ' disabled' : '') + '>' + helpers.map(function (student) { var used=q.assisted.has(q.selection.spinId+':'+student.id);return '<option value="' + esc(student.id) + '"' + (used ? ' disabled' : '') + (picked===student.id && !used ? ' selected' : '') + '>' + esc(student.name) + (used ? ' · XP given' : '') + '</option>'; }).join('') + '</select><button type="button" data-assist-save' + (busy || helpers.every(function (student) { return q.assisted.has(q.selection.spinId+':'+student.id); }) ? ' disabled' : '') + '>Give 6 assist XP</button><small>Once per helper for this question. No attack or enemy reply.</small></div>' : '');
  }
  function clearRequest(uid, cls, id) {
    try { var saved=JSON.parse(sessionStorage.getItem(requestKey(uid,cls)) || 'null'); if (saved && saved.action.id===id) sessionStorage.removeItem(requestKey(uid,cls)); } catch (_) {}
  }
  async function assist(studentId, retry) {
    if (manual() || !q.on || !allowed() || !visible() || !q.store || q.loading || q.busy || missionBusy() || window.wheelSpinning) throw new Error('Wait for the current turn before recording an assist.');
    if (retry ? !q.request || q.request.kind !== 'assist' : q.request) throw new Error('Confirm the pending save with Retry first.');
    if (!retry) {
      var called = q.selection && wheelStudent(q.selection.entry), helper = rwStudentsInClass(q.cls).find(function (student) { return student.id === studentId; });
      if (!called || !helper || called.id===helper.id || q.selection.spinId !== wheelState.lastSpinId) throw new Error('Choose another student in this Lesson slot who helped the called student.');
      if (q.assisted.has(q.selection.spinId+':'+helper.id)) throw new Error('This helper already received XP for this question.');
      var id='assist-'+(crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
      q.request={kind:'assist',studentId:helper.id,studentName:helper.name,helpedStudentId:called.id,helpedStudentName:called.name,action:{id:id,spinId:q.selection.spinId,heroId:q.heroId}};
    }
    var request=JSON.parse(JSON.stringify(q.request)),stamp=q.epoch,store=q.store,uid=q.uid,cls=q.cls;
    try { sessionStorage.setItem(requestKey(uid,cls),JSON.stringify(request)); } catch (_) { q.request=null;throw new Error('Enable session storage so assists can be retried safely.'); }
    cancelFeedback();q.busy=true;q.error='';q.assistMessage='';render();
    try {
      var result=await store.assist(request);clearRequest(uid,cls,request.action.id);
      if (stamp!==q.epoch || !allowed() || currentUser.uid!==uid || !visible()) return result;
      q.request=null;q.assisted.add(request.action.spinId+':'+request.studentId);
      if(result.state && (!q.state || result.state.revision>=q.state.revision))q.state=result.state;
      q.assistMessage=request.studentName+' helped '+request.helpedStudentName+' · '+(result.duplicate ? '6 XP already awarded for this question.' : '+6 XP!');
      if (window.toast) toast(q.assistMessage);
      return result;
    } catch(err) {
      if (['invalid_action','invalid_assist','invalid_slot','invalid_student','roster_changed','encounter_active','assist_changed'].includes(err.code)) { clearRequest(uid,cls,request.action.id);if(stamp===q.epoch)q.request=null; }
      if(stamp===q.epoch)q.error=(err.message || 'Could not confirm the assist.')+(q.request ? ' Retry safely to confirm it once.' : '');
      throw err;
    } finally {
      if(stamp===q.epoch) { if(q.queued && (!q.state || q.queued.revision>=q.state.revision))q.state=q.queued;q.queued=null;q.busy=false;render();if(missionPanel)missionPanel.refresh(); }
    }
  }
  function requestKey(uid, cls) { return 'polymath.wheelAward.' + uid + '.' + encodeURIComponent(cls); }
  function enemyFor(spinId) {
    var pool = Core.BOSSES.filter(function (enemy) { return !enemy.legacy; });
    return pool[Math.floor(Core.randomUnit(spinId + ':enemy') * pool.length)].id;
  }
  function blocksAward() {
    return !manual() && (missionBusy() || q.on && (q.loading || q.busy || !!q.request || !q.store || !!(q.state && q.state.pending)));
  }
  function landed(entry, spinId) {
    if (!entry || manual() || !q.on || !allowed() || !visible() || !q.store || q.loading || q.busy || missionBusy() || !q.cls) return;
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(spinId || '')) { q.error = 'Spin again before awarding points.'; render(); return; }
    q.selection = {entry: {id:entry.id, n:entry.n}, spinId:spinId};
    cancelFeedback(); q.heroId = heroId(entry); q.assistOpen = false; q.assistMessage = ''; q.error = ''; render();
  }
  async function award(entry, delta, reason, retry) {
    if (manual() || !q.on || !allowed() || !visible() || !q.store || q.loading || q.busy || missionBusy() || !q.cls || window.wheelSpinning) throw new Error('Wait for the wheel and saved encounter before awarding points.');
    if (q.state && q.state.pending) throw new Error('Resolve the manual answer in Battle before awarding Quick fight points.');
    if (retry ? !q.request : q.request) throw new Error('Use Retry to confirm the pending points award first.');
    var current = q.state;
    if (!retry) {
      if (!Number.isSafeInteger(delta) || delta < 1 || delta > 10000) throw new Error('Give a whole number of points from 1 to 10,000.');
      if (!entry || !q.selection || entry.id !== q.selection.entry.id || entry.n !== q.selection.entry.n || q.selection.spinId !== (window.wheelState && wheelState.lastSpinId)) throw new Error('Spin to select this student before awarding points.');
      var student = window.wheelStudent && wheelStudent(entry);
      if (!student || !rwStudentClasses(student).includes(q.cls)) throw new Error('Link this name to a student in this Lesson slot before awarding points.');
      var id = 'award-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
      q.request = {studentId:student.id,studentName:student.name || entry.n,delta:delta,reason:reason,action:{type:'auto',id:id,spinId:q.selection.spinId,heroId:Core.heroFromStudent(student).id,heroes:roster(),bossId:enemyFor(q.selection.spinId)}};
    }
    // Reusing the same receipt is safe after a timeout, including after reload.
    // A latest revision allows an explicitly retried, uncommitted award to proceed.
    if (current) { q.request.action.encounterId = current.encounterId; q.request.action.expectedRevision = current.revision; }
    var request = JSON.parse(JSON.stringify(q.request)), stamp = q.epoch, activeStore = q.store, uid = q.uid, cls = q.cls, feedbackEvent = null, feedbackEncounter = null;
    try { sessionStorage.setItem(requestKey(uid,cls), JSON.stringify(request)); }
    catch (_) { q.request = null; throw new Error('Enable session storage so points awards can be retried safely.'); }
    cancelFeedback(); q.heroId = request.action.heroId; q.busy = true; q.assistMessage = ''; q.error = ''; render();
    try {
      var result = await activeStore.award(request), next = result.state;
      // Clear only this acknowledgement; an older request must not erase a new one.
      try { var saved = JSON.parse(sessionStorage.getItem(requestKey(uid,cls)) || 'null'); if (saved && saved.action.id === request.action.id) sessionStorage.removeItem(requestKey(uid,cls)); } catch (_) {}
      if (stamp !== q.epoch || manual() || !visible()) return result;
      if (!allowed() || currentUser.uid !== uid) { close(); return result; }
      q.request = null;
      var student = window.rwStudents.find(function (s) { return s.id === result.award.studentId; });
      if (student) { student.marks = result.award.marks; student._just = (student._just || 0) + result.award.delta; }
      if (q.selection && q.selection.spinId === request.action.spinId) window.wheelGiven += result.award.delta;
      if (window.renderRewardList) renderRewardList();
      if (window.wheelRender) wheelRender();
      if (window.toast) toast('+' + result.award.delta + ' to ' + request.studentName + ' — now ' + result.award.marks + '.');
      if (next && (!q.state || next.revision >= q.state.revision)) q.state = next;
      if (next && next.lastEvent && next.lastEvent.type === 'auto' && next.lastEvent.id === request.action.id && !played.has(request.action.id) && window.ClassroomBattleAnimation) {
        played.add(request.action.id); if (played.size > 100) played.delete(played.values().next().value);
        feedbackEvent = next.lastEvent; feedbackEncounter = next.encounterId;
      }
      return result;
    } catch (err) {
      // These explicit server rejections occur without committing the award.
      // Network, auth and unknown failures retain their receipt for safe retry.
      if (['invalid_action','invalid_slot','invalid_student','invalid_points','invalid_award','invalid_reason','invalid_balance','invalid_roster','roster_changed','missing_student','encounter_active','battle_changed'].includes(err.code)) {
        try { var pending = JSON.parse(sessionStorage.getItem(requestKey(uid,cls)) || 'null'); if (pending && pending.action.id === request.action.id) sessionStorage.removeItem(requestKey(uid,cls)); } catch (_) {}
        if (stamp === q.epoch) q.request = null;
      }
      if (stamp === q.epoch) q.error = (err.message || 'Could not confirm this points award.') + (q.request ? ' Retry checks the same award without adding it twice.' : '');
      throw err;
    } finally {
      if (stamp === q.epoch) { if (q.queued && (!q.state || q.queued.revision >= q.state.revision)) q.state = q.queued; q.queued = null; q.busy = false; if (window.wheelRender) wheelRender(); render(); if (missionPanel) missionPanel.refresh(); if (feedbackEvent) playFeedback(feedbackEvent,feedbackEncounter); }
    }
  }
  function beforeSpin() {
    if (!q.on || !window.wheelClass) return true;
    if (!q.store) open(window.wheelClass);
    if (q.loading || q.busy || missionBusy() || q.request || !q.store || q.state && q.state.pending) { render(); return false; }
    cancelFeedback(); return allowed() && visible();
  }
  function playFeedback(event, encounterId) {
    if (!window.ClassroomBattleAnimation || !q.state || !event || !q.state.lastEvent || q.state.lastEvent.id !== event.id || q.state.encounterId !== encounterId) return;
    cancelFeedback(); q.playing = true; render(true);
    var player = event.type === 'summon' && ClassroomBattleAnimation.playChung ? ClassroomBattleAnimation.playChung(el('wheelQuickDuel'), {event:event,enemyActor:el('wheelQuickDuel').querySelector('[data-cba-actor="enemy"]')}) : ClassroomBattleAnimation.playDuel(el('wheelQuickDuel'), {hero:q.state.heroes.find(function (h) { return h.id===event.heroId; }),event:event,heroes:q.state.heroes});
    q.player=player;
    player.finished.then(function () { if(q.player===player) { q.player=null;q.playing=false;render(); } });
  }
  function mountMission() {
    if (!window.ClassroomMissionMachine || !q.store) return;
    missionPanel=ClassroomMissionMachine.mount(el('wheelMission'), {store:q.store,teacherId:q.uid,classId:q.cls,
      canAct:function () { return !q.loading&&!q.busy&&!q.request&&!window.wheelSpinning&&allowed()&&visible()&&!manual(); },
      getState:function () {return q.on ? q.state : null;},getSpinId:function () {return q.selection&&q.selection.spinId;},
      onChange:function (result) {if(result.state&&(!q.state||result.state.revision>=q.state.revision))q.state=result.state;render();},
      onBusy:function () {controls(q.state);},
      onSummon:function (event,encounterId) {if(event)playFeedback(event,encounterId);}
    });
  }
  window.QuickBattle = { open: open, close: close, beforeSpin: beforeSpin, landed: landed, award: award, assist: assist, blocksAward: blocksAward, render: render, enabled: function () { return q.on; } };
})();
