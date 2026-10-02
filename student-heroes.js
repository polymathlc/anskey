/* Student-owned classroom heroes. All claims and changes go through the verified API. */
(function () {
  'use strict';
  var Core = window.ClassroomBattleCore;
  if (!Core) return;
  var refreshId = 0;
  var epoch = 0, identity = '', openedFor = '', readyFor = '', mode = '', tree = null, poll = null, busy = false, lastFocus = null;
  var model = null, catalog = null, chosenSlot = '';
  var roles = ['warrior', 'ranger', 'mage', 'cleric'];
  var descriptions = {
    warrior: 'Protect your party with shields, rallying cries and powerful sword strikes.',
    ranger: 'Master precise arrows, poison, woodland healing and evasive attacks.',
    mage: 'Choose fire, frost or arcane magic to burn, weaken and overwhelm enemies.',
    cleric: 'Heal your friends, shield the party or channel radiant damage.'
  };
  function el(id) { return document.getElementById(id); }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function user() { return window.currentUser; }
  function teacher() { return !!user() && window.isAdmin(user()) && !window.actingStudent && !window.isSharedVisitor(); }
  function student() { return !!user() && !user().isAnonymous && !window.isAdmin(user()) && !window.actingStudent && !window.isSharedVisitor(); }
  function heroName(hero) { return Core.JOBS && Core.JOBS[hero.job] ? Core.JOBS[hero.job].name : Core.ROLES[hero.role].name; }
  function sprite(role, cls, job) { var name = Core.JOBS && Core.JOBS[job] ? Core.JOBS[job].name : Core.ROLES[role] ? Core.ROLES[role].name : 'Warrior'; if (window.ClassroomBattleAnimation) return ClassroomBattleAnimation.heroMarkup(role, { job:job, className:'shSprite ' + (cls || ''), alt:name + ' pixel hero' }); return '<img class="shSprite ' + (cls || '') + '" src="assets/battle-pixel/' + (roles.includes(role) ? role : 'warrior') + '.png" alt="' + esc(name) + ' pixel hero">'; }
  function api(action) { if (!window.ClassroomHeroAPI) return Promise.reject(new Error('The hero service is still loading. Please try again.')); var token = epoch; return window.ClassroomHeroAPI.request(action, { canSend:function () { return alive(token); } }); }
  function alive(token) { return token === epoch && !!mode && (mode === 'teacher' ? teacher() : student()); }
  function error(message) { el('shError').textContent = message; el('shError').hidden = !message; }
  function cleanupTree() { if (tree) tree.destroy(); tree = null; }
  function content(html) { cleanupTree(); if (window.ClassroomBattleAnimation) ClassroomBattleAnimation.unmount(el('shBody')); el('shBody').innerHTML = html; if (window.ClassroomBattleAnimation) ClassroomBattleAnimation.mount(el('shBody')); }
  function stopPoll() { if (poll) clearTimeout(poll); poll = null; }
  function schedule() { stopPoll(); if (mode && model) poll = setTimeout(function () { if (busy || document.hidden) schedule(); else refresh(false); }, 15000); }
  function setBusy(value) {
    busy = value; el('shDialog').setAttribute('aria-busy', String(value));
    el('shBody').querySelectorAll('button,select').forEach(function (node) { if (value) { node.dataset.wasDisabled = String(node.disabled); node.disabled = true; } else if (node.dataset.wasDisabled != null) { node.disabled = node.dataset.wasDisabled === 'true'; delete node.dataset.wasDisabled; } });
    el('shRefresh').disabled = value;
  }
  async function mutate(action) {
    if (busy || !mode) return;
    var token = epoch;
    error(''); setBusy(true);
    try { await api(action); if (alive(token)) await refresh(false); }
    catch (e) { if (alive(token)) error(e.message || 'Unable to save. Please try again.'); }
    finally { if (alive(token)) setBusy(false); }
  }
  function renderClaim() {
    if (model.status === 'pending') {
      content('<div class="shWelcome"><span class="shEyebrow">CLAIM REQUEST SENT</span><h2>Your adventure is almost ready</h2><p>Your teacher will check your name before linking your account.</p><div class="shPending"><strong>' + esc(model.claim.name) + '</strong><span>Lesson slot · ' + esc(model.claim.lessonSlot) + '</span></div><p>Your existing XP, skills and treasure stay with your character.</p><button class="btn" data-sh-action="cancelClaim">Cancel this request</button></div>');
      return;
    }
    var slots = catalog.slots || [];
    if (!slots.some(function (slot) { return (slot.id || slot.name) === chosenSlot; })) chosenSlot = '';
    content('<div class="shWelcome"><span class="shEyebrow">YOUR FIRST ADVENTURE</span><h2>Find your character</h2><p>Choose your lesson, then claim the name your teacher added to the roster.</p><label class="shField" for="shSlot">Lesson slot<select id="shSlot"><option value="">Choose your lesson slot</option>' + slots.map(function (slot) { var id = slot.id || slot.name; return '<option value="' + esc(id) + '"' + (id === chosenSlot ? ' selected' : '') + '>' + esc(slot.name || id) + '</option>'; }).join('') + '</select></label><div id="shNames" class="shNames"></div><p class="shHint">Your teacher approves claims. If your name is missing or already claimed, ask your teacher to correct the roster.</p></div>');
    el('shSlot').addEventListener('change', function () { chosenSlot = this.value; renderNames(); });
    renderNames();
  }
  function renderNames() {
    var students = (catalog.students || []).filter(function (row) { return (row.lessonSlots || []).includes(chosenSlot); });
    el('shNames').innerHTML = !chosenSlot ? '<p>Select a lesson slot to see its roster.</p>' : !students.length ? '<p>No students are listed for this lesson slot yet.</p>' : students.map(function (row) {
      var available = row.status === 'available';
      return '<button class="shName" data-sh-claim="' + esc(row.id) + '"' + (available ? '' : ' disabled') + '><strong>' + esc(row.name) + '</strong><span>' + (available ? 'Claim my character →' : row.status === 'pending' ? 'Awaiting teacher approval' : 'Already claimed') + '</span></button>';
    }).join('');
  }
  function classCards(hero, first, locked) {
    return '<section class="shClasses"><div><span class="shEyebrow">HERO CLASS</span><h2>' + (first ? 'Choose how you play' : 'Your path') + '</h2><p>' + (first ? 'Each class has three skill branches. Choose a hero to begin.' : 'Changing hero class keeps your level, learned skills and treasure. Each class uses its own skills. Change between encounters.') + '</p></div><div class="shClassGrid">' + roles.map(function (role) { return '<button class="shClass' + (hero.role === role && !first ? ' selected' : '') + '" data-sh-role="' + role + '"' + (locked ? ' disabled' : '') + '>' + sprite(role) + '<strong>' + esc(Core.ROLES[role].name) + '</strong><span>' + descriptions[role] + '</span><b>' + (hero.role === role && !first ? 'Current class' : 'Choose ' + Core.ROLES[role].name) + '</b></button>'; }).join('') + '</div></section>';
  }
  function advancement(hero, locked) {
    var jobs = Core.jobsFor ? Core.jobsFor(hero) : [], current = Core.JOBS && Core.JOBS[hero.job];
    if (!jobs.length) return '';
    var atLevel = hero.level >= 15;
    return '<section class="shAdvance"><span class="shEyebrow">LEVEL 15 / JOB CLASS UPGRADE</span><h2>' + (current ? esc(current.name) + ' training' : 'Choose your advanced path') + '</h2><p>' + (current ? 'Your advanced tree and foundation tree both remain available. Your XP, equipment and learned skills stay with your hero.' : 'At level 15, your Hero class opens two specializations, each with a new twelve-skill tree. Your XP, equipment and learned skills carry forward. Your first advanced skill is free.') + '</p>' + (!atLevel ? '<p class="shAdvanceLock">Reach level 15 to upgrade · ' + (15 - hero.level) + ' levels to go.</p>' : locked ? '<p class="shAdvanceLock">Finish or end the encounter before choosing a job upgrade.</p>' : '') + '<div class="shJobGrid">' + jobs.map(function (job) {
      var eligibility = Core.canAdvance ? Core.canAdvance(hero, job.id) : {ok:atLevel}, chosen = hero.job === job.id;
      return '<button type="button" class="shClass shJob' + (chosen ? ' selected' : '') + '" data-sh-job="' + esc(job.id) + '"' + (locked || !eligibility.ok ? ' disabled' : '') + '>' + sprite(hero.role, '', job.id) + '<strong>' + esc(job.name) + '</strong><span>' + esc(job.description) + '</span><b>' + (chosen ? 'Current job' : !atLevel ? 'Unlocks at level 15' : eligibility.ok ? 'Advance to ' + esc(job.name) : esc(eligibility.reason || 'Unavailable')) + '</b></button>';
    }).join('') + '</div></section>';
  }
  function renderHero() {
    var hero = model.hero, claim = model.claim || {}, locked = !!model.activeEncounter;
    if (!hero) { content('<p>Your character is being prepared. Refresh to try again.</p>'); return; }
    var first = hero.classChosen === false || claim.classChosen === false;
    var floor = Core.xpForLevel(hero.level), next = Core.xpForLevel(Math.min(50, hero.level + 1)), maxed = hero.level >= 50;
    var pct = maxed ? 100 : Math.max(0, Math.min(100, (hero.xp - floor) / (next - floor) * 100));
    var items = (hero.inventory || []).filter(function (entry) { return entry.quantity > 0; });
    content('<div class="shHeroTop">' + sprite(hero.role, '', hero.job) + '<div><span class="shEyebrow">MY HERO · LEVEL ' + esc(hero.level) + '</span><h2>' + esc(hero.name || claim.name) + '</h2><p>Lesson slot · ' + esc((claim.lessonSlots || []).join(' · ') || claim.lessonSlot || 'Ask your teacher') + '</p><p>Hero class · ' + (first ? 'Choose below' : esc(heroName(hero))) + '</p><div class="shXp" role="progressbar" aria-label="Experience toward next level" aria-valuenow="' + Math.round(pct) + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + pct + '%"></i></div><small>' + (maxed ? 'Maximum level · ' + hero.xp + ' XP' : hero.xp + ' / ' + next + ' XP · ' + Math.max(0, next - hero.xp) + ' XP to level ' + (hero.level + 1)) + '</small></div><div class="shStats"><strong>' + esc(hero.skillPoints) + ' skill points</strong><span>' + esc(hero.hp) + ' / ' + esc(hero.stats.maxHp) + ' HP</span><span>' + esc(hero.mp) + ' / ' + esc(hero.stats.maxMp) + ' MP</span></div></div>' + (locked ? '<p class="shLock">An encounter is in progress' + (model.activeEncounter.classId ? ' · ' + esc(model.activeEncounter.classId) : '') + '. Your teacher can finish or end it before you change your class, skills or equipment.</p>' : '') + (first ? classCards(hero, true, locked) : '<div class="shAdventureNote">Earn XP for answering questions, assisting classmates and defeating enemies. Leveling up grants 2 skill points. Every hero receives treasure after a victory. New gear automatically equips your highest-rarity relic.</div>' + advancement(hero, locked) + '<section><h2>Skill tree</h2><div id="shTree"></div></section><section><h2>Treasure bag</h2><p class="shHint">When you receive gear, your highest-rarity relic equips automatically. You can still choose a different effect between encounters.</p><div class="shInventory">' + (items.length ? items.map(function (entry) {
      var item = Core.itemById(entry.itemId);
      if (!item) return '';
      var rarity = Core.RARITIES[item.rarity] || {}, equipped = hero.equipped === entry.id;
      return '<article class="shItem" data-rarity="' + esc(item.rarity) + '"><span class="shEyebrow">' + esc(rarity.name || item.rarity) + ' · ×' + esc(entry.quantity) + '</span><h3>' + esc(item.name) + '</h3><p>' + esc(item.description) + '</p>' + (item.type === 'consumable' ? '<span class="shHint">Use during battle</span>' : '<button class="btn" data-sh-equip="' + esc(entry.id) + '"' + (locked || equipped ? ' disabled' : '') + '>' + (equipped ? 'Equipped' : 'Equip') + '</button>') + '</article>';
    }).join('') : '<p>Your next victory brings new treasure.</p>') + '</div></section><details class="shChange"><summary>Change Hero class</summary>' + classCards(hero, false, locked) + '</details>'));
    if (!first && window.ClassroomSkillTree) tree = window.ClassroomSkillTree.render(el('shTree'), { hero: hero, locked: locked, lockedReason: 'Finish or end the active encounter before learning skills.', onLearn: async function (skillId) { await mutate({type:'configure',command:'learn',skillId:skillId}); } });
  }
  function renderTeacher() {
    var claims = model.claims || [];
    var encounters = (model.activeEncounters || []).filter(function (row, index, all) { return all.findIndex(function (other) { return other.classId === row.classId && other.encounterId === row.encounterId; }) === index; });
    function rows(status) { return claims.filter(function (claim) { return claim.status === status; }).map(function (claim) { return '<article class="shClaimRow"><div><strong>' + esc(claim.name) + '</strong><span>' + esc(claim.email) + '</span><span>Lesson slot · ' + esc((claim.lessonSlots || []).join(' / ') || claim.lessonSlot) + '</span>' + (claim.rosterMissing ? '<span>Removed from roster - unlink to let this account claim its current name.</span>' : '') + '</div><div>' + (status === 'pending' ? '<button class="btn primary" data-sh-manage="approve" data-student-id="' + esc(claim.studentId) + '">Approve</button><button class="btn" data-sh-manage="reject" data-student-id="' + esc(claim.studentId) + '">Reject</button>' : '<button class="btn" data-sh-manage="unlink" data-student-id="' + esc(claim.studentId) + '">Unlink account</button>') + '</div></article>'; }).join('') || '<p>No ' + (status === 'pending' ? 'pending requests.' : 'approved claims yet.') + '</p>'; }
    content('<div class="shWelcome"><span class="shEyebrow">TEACHER · CHARACTER OWNERSHIP</span><h2>Hero claims</h2><p>Approve each student’s account before they choose a Hero class. Names and Lesson slots come from your existing rewards roster.</p></div><section><h2>Awaiting approval</h2>' + rows('pending') + '</section><section><h2>Approved characters</h2><p class="shHint">Unlink a mistaken claim to make the name available again. XP, skills, equipment and treasure stay with the roster character.</p>' + rows('approved') + '</section><section><h2>Active encounters</h2><p class="shHint">End an encounter to release its heroes for class changes, skills or a different Lesson slot. Ending does not grant victory rewards.</p>' + (encounters.map(function (row) { return '<article class="shClaimRow"><div><strong>' + esc(row.classId) + '</strong><span>Heroes currently in battle</span></div><button class="btn" data-sh-manage="endEncounter" data-student-id="' + esc(row.studentId) + '">End encounter</button></article>'; }).join('') || '<p>No active encounters.</p>') + '</section>');
  }
  async function refresh(showLoading) {
    if (!mode) return;
    var token = epoch, requestId = ++refreshId;
    stopPoll(); error('');
    if (showLoading) content('<p class="shLoading" role="status">Loading your adventure…</p>');
    try {
      var result = await api({type:mode === 'teacher' ? 'claims' : 'me'});
      if (!alive(token) || requestId !== refreshId) return;
      if (!showLoading && JSON.stringify(model) === JSON.stringify(result) && (mode === 'teacher' || result.status !== 'unclaimed')) { schedule(); return; }
      model = result;
      if (mode === 'teacher') renderTeacher();
      else if (model.status === 'approved') renderHero();
      else {
        if (model.status !== 'pending') { var list = await api({type:'catalog'}); if (!alive(token) || requestId !== refreshId) return; catalog = list; }
        renderClaim();
      }
      schedule();
    } catch (e) { if (alive(token) && requestId === refreshId) { error(e.message || 'Unable to load heroes. Please refresh.'); schedule(); } }
  }
  function close() {
    if (window.ClassroomBattleAnimation) ClassroomBattleAnimation.unmount(el('shBody'));
    epoch++; mode = ''; model = catalog = null; busy = false; stopPoll(); cleanupTree();
    el('shDialog').close(); el('shBody').textContent = ''; error('');
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }
  function open(which) {
    if (which === 'teacher' ? !teacher() : !student()) return;
    epoch++; mode = which; busy = false; el('shRefresh').disabled = false;
    el('shTitle').textContent = which === 'teacher' ? 'Hero claims' : 'My Hero';
    lastFocus = document.activeElement;
    if (!el('shDialog').open) el('shDialog').showModal();
    refresh(true);
  }
  function maybeOpen() {
    if (student() && readyFor === user().uid && openedFor !== user().uid && !window.sharedLink && !window.SHARE_OPEN_ID && !window.shareOpenInProgress && !el('profileModal').classList.contains('open')) { openedFor = user().uid; open('student'); }
  }
  function roleChanged() {
    var next = user() && user().uid || '';
    if (next !== identity) { identity = next; openedFor = readyFor = ''; close(); }
    if (mode && (mode === 'teacher' ? !teacher() : !student())) close();
    el('myHeroBtn').style.display = student() ? '' : 'none';
    el('heroClaimsBtn').style.display = teacher() ? '' : 'none';
    maybeOpen();
  }
  document.body.insertAdjacentHTML('beforeend', '<dialog id="shDialog" class="shDialog" aria-labelledby="shTitle"><header class="shHeader"><div><span class="shEyebrow">CLASSROOM ADVENTURES</span><h1 id="shTitle">My Hero</h1></div><div><button class="btn" id="shRefresh">Refresh</button><button class="btn" id="shClose" aria-label="Close My Hero">✕</button></div></header><div id="shError" role="alert" class="shError" hidden></div><main id="shBody" class="shBody"></main></dialog>');
  el('myHeroBtn').addEventListener('click', function () { open('student'); });
  el('heroClaimsBtn').addEventListener('click', function () { open('teacher'); });
  el('shClose').addEventListener('click', close);
  el('shDialog').addEventListener('cancel', function (event) { event.preventDefault(); close(); });
  el('shRefresh').addEventListener('click', function () { if (!busy) refresh(true); });
  el('shBody').addEventListener('click', function (event) {
    var target = event.target.closest('button'); if (!target || target.disabled || busy) return;
    if (target.dataset.shClaim) mutate({type:'claim',studentId:target.dataset.shClaim,lessonSlot:chosenSlot});
    else if (target.dataset.shAction) mutate({type:target.dataset.shAction});
    else if (target.dataset.shJob) mutate({type:'configure',command:'advance',jobId:target.dataset.shJob});
    else if (target.dataset.shRole) mutate({type:'configure',command:'class',role:target.dataset.shRole});
    else if (target.dataset.shEquip) mutate({type:'configure',command:'equip',itemId:target.dataset.shEquip});
    else if (target.dataset.shManage) mutate({type:target.dataset.shManage,studentId:target.dataset.studentId});
  });
  window.StudentHeroes = { open:open, close:close, roleChanged:roleChanged, profileReady:function (uid) { if (user() && user().uid === uid) { readyFor = uid; maybeOpen(); } } };
  roleChanged();
  if (student() && window.profileComplete && window.profileComplete(window.studentProfile)) window.StudentHeroes.profileReady(user().uid);
})();
