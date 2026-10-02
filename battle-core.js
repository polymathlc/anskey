/* Deterministic classroom battle rules; shared by the browser and tests. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./battle-bosses.js'));
  else root.ClassroomBattleCore = factory(root.ClassroomBosses);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(BOSSES) {
  'use strict';
  const ROLES = Object.freeze({
    warrior: { name: 'Warrior', icon: '⚔', description: 'Strong melee strike. 35% more health and 25% more defence.', power: 1.15, hp: 1.35, defence: 1.25, attacks: 1 },
    ranger: { name: 'Ranger', icon: '➶', description: 'Two quick arrows with an extra 15% critical chance.', power: 1, hp: 1, defence: 1, attacks: 2 },
    mage: { name: 'Mage', icon: '✦', description: 'A powerful spell that ignores half the boss armour.', power: 1.35, hp: .95, defence: .9, attacks: 1 },
    healer: { name: 'Healer', icon: '✚', description: 'Light damage and healing for every teammate, including resting heroes.', power: .55, hp: 1.1, defence: 1, attacks: 1 }
  });
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || 0));
  const int = (n, lo, hi) => Math.round(clamp(n, lo, hi));
  const roleKey = key => Object.prototype.hasOwnProperty.call(ROLES, key) ? key : 'warrior';
  const copy = value => JSON.parse(JSON.stringify(value));
  function fail(message) { throw new Error(message); }
  function bossById(id) { return BOSSES.find(b => b.id === id) || fail('Unknown boss. Reload the app.'); }
  function randomUnit(seed) {
    // A retry must produce the same critical roll and outcome on every device.
    let hash = 2166136261;
    for (const ch of String(seed)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
    return (hash >>> 0) / 4294967296;
  }
  function heroFromStudent(student, profile) {
    const uid = typeof student.uid === 'string' && student.uid ? student.uid : null;
    const raw = profile && profile.battleHero;
    const source = uid && raw && raw.version === 1 && raw.uid === uid ? raw : null;
    const role = roleKey(source && source.role), bonus = ROLES[role], s = source && source.stats || {};
    // Bounded square-root scaling keeps new students useful beside advanced characters.
    const stats = {
      maxHp: Math.round((95 + Math.sqrt(clamp(s.maxHp || 100, 1, 100000)) * 2.5) * bonus.hp),
      damage: Math.round((16 + Math.sqrt(clamp(s.atk || 10, 1, 10000)) * 2) * bonus.power * (role === 'mage' ? 1 + clamp(s.spellPct, 0, .5) : 1)),
      defence: Math.round((3 + Math.sqrt(clamp(s.def, 0, 10000)) * 1.2) * bonus.defence),
      healing: role === 'healer' ? Math.round((12 + Math.sqrt(clamp(s.atk || 10, 1, 10000)) * 1.5) * (1 + clamp(s.leechPct, 0, .5) + clamp(s.spellPct, 0, .5))) : 0,
      critChance: Math.min(.45, clamp(s.crit || 5, 0, 100) / 100 + (role === 'ranger' ? .15 : .03)),
      critMultiplier: clamp(s.critMult || 1.5, 1.25, 2), attacks: bonus.attacks
    };
    const url = source && source.avatarDataUrl;
    // SVG is displayed exclusively in an <img>, never inserted into the document.
    const avatarUrl = typeof url === 'string' && url.length < 250000 && /^data:image\/svg\+xml;(?:charset=utf-8,|base64,)/.test(url) ? url : '';
    return { id: uid ? 'uid:' + uid : 'student:' + String(student.id), uid,
      studentId: String(student.id || ''), name: String(student.name || 'Student').slice(0, 100), role,
      stats, hp: stats.maxHp, avatarUrl, equipment: source && source.equipment || {},
      fallbackReason: !uid ? 'No CER account linked — starter hero' : !source ? 'Open your CER character once to sync — starter hero' : !avatarUrl ? 'Avatar unavailable — stats are synced' : '' };
  }
  function cleanHero(h) {
    if (!h || typeof h.id !== 'string' || !h.id || h.id.length > 180) fail('Invalid hero identity.');
    const s = h.stats || {}, role = roleKey(h.role);
    return { id: h.id, uid: h.uid || null, studentId: String(h.studentId || ''), name: String(h.name || 'Student').slice(0, 100), role,
      stats: { maxHp: int(s.maxHp, 80, 1500), damage: int(s.damage, 8, 300), defence: int(s.defence, 0, 120),
        healing: role === 'healer' ? int(s.healing, 12, 180) : 0, critChance: clamp(s.critChance, 0, .45),
        critMultiplier: clamp(s.critMultiplier || 1.5, 1.25, 2), attacks: ROLES[role].attacks }, hp: 0, weakened: false };
  }
  function roster(heroes) {
    if (!Array.isArray(heroes) || !heroes.length || heroes.length > 100) fail('Choose a class with 1–100 students.');
    const seen = new Set();
    return heroes.map(cleanHero).filter(h => { if (seen.has(h.id)) return false; seen.add(h.id); return true; });
  }
  function finish(state, event) {
    state.revision += 1; state.actionCount += 1; state.lastEvent = event;
    state.status = state.bossHp <= 0 ? 'victory' : state.heroes.every(h => h.hp <= 0) ? 'defeat' : 'active';
    if (state.status !== 'active') state.pending = null;
    return state;
  }
  function reduce(previous, action) {
    if (!action || typeof action.id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(action.id)) fail('Invalid battle action.');
    const event = { id: action.id, type: action.type, healed: [], targets: [] };
    if (action.type === 'start') {
      if (previous && action.expectedRevision !== previous.revision) fail('The class changed on another screen. Try again.');
      const heroes = roster(action.heroes), boss = bossById(action.bossId);
      heroes.forEach(h => { h.hp = h.stats.maxHp; });
      const bossMaxHp = Math.round(Math.max(260, heroes.reduce((sum, h) => sum + h.stats.damage, 0) * 4) * boss.hpMultiplier);
      return { schemaVersion: 1, encounterId: action.id, revision: (previous && previous.revision || 0) + 1,
        bossId: boss.id, bossHp: bossMaxHp, bossMaxHp, charge: 0, heroes, pending: null, status: 'active',
        bossTurns: 0, actionCount: 1, correctCount: 0, guard: false, lastEvent: event };
    }
    if (!previous || action.encounterId !== previous.encounterId) fail('This encounter has changed. Reload its latest progress.');
    const state = copy(previous), boss = bossById(state.bossId);
    if (action.type === 'sync') {
      const fresh = roster(action.heroes);
      state.heroes = fresh.map(h => {
        const old = state.heroes.find(o => o.id === h.id);
        h.hp = old ? old.hp === 0 ? 0 : int(h.stats.maxHp - (old.stats.maxHp - old.hp), 1, h.stats.maxHp) : h.stats.maxHp;
        h.weakened = !!(old && old.weakened); return h;
      });
      if (state.pending && !state.heroes.some(h => h.id === state.pending.heroId)) state.pending = null;
      if (JSON.stringify(state.heroes) === JSON.stringify(previous.heroes) && JSON.stringify(state.pending) === JSON.stringify(previous.pending)) return previous;
      // Profile changes cannot restart a completed encounter.
      if (state.status === 'active' && state.heroes.every(h => h.hp <= 0)) { state.status = 'defeat'; state.pending = null; }
      state.revision++; state.lastEvent = event; return state;
    }
    if (state.status !== 'active') fail('Encounter finished. Start a new encounter to play again.');
    if (action.type === 'select') {
      if (state.pending) fail('Resolve the selected answer before spinning again.');
      if (action.expectedRevision !== state.revision) fail('The class changed on another screen. Spin again.');
      const hero = state.heroes.find(h => h.id === action.heroId);
      if (!hero) fail('This student is no longer in the class.');
      state.pending = { id: action.turnId || action.id, heroId: hero.id };
      event.heroId = hero.id; return finish(state, event);
    }
    if (action.type === 'answer') {
      if (!state.pending || action.turnId !== state.pending.id) fail('This answer was already resolved or belongs to an older turn.');
      if (!['correct', 'incorrect', 'skip'].includes(action.outcome)) fail('Choose Correct, Incorrect or Skip.');
      const hero = state.heroes.find(h => h.id === state.pending.heroId);
      Object.assign(event, { heroId: hero.id, role: hero.role, outcome: action.outcome, damage: 0, critical: false });
      state.pending = null;
      if (action.outcome === 'correct') {
        // A resting hero can still answer and rejoin, so no student is excluded.
        if (hero.hp <= 0) { hero.hp = Math.ceil(hero.stats.maxHp * .25); event.healed.push({ heroId: hero.id, amount: hero.hp }); }
        event.critical = randomUnit(state.encounterId + ':' + action.turnId) < hero.stats.critChance;
        const armour = boss.defence * (hero.role === 'mage' ? .5 : 1);
        event.damage = Math.min(state.bossHp, Math.max(1, Math.round(hero.stats.damage * (event.critical ? hero.stats.critMultiplier : 1) * (1 - armour) * (hero.weakened ? .7 : 1) * (state.guard ? .6 : 1))));
        state.bossHp -= event.damage; state.correctCount++; hero.weakened = false; state.guard = false;
        if (hero.role === 'healer') state.heroes.forEach(h => {
          const amount = Math.min(h.stats.maxHp - h.hp, hero.stats.healing);
          h.hp += amount; if (amount) event.healed.push({ heroId: h.id, amount });
        });
        if (boss.playstyle === 'reflect' && state.bossHp > 0) {
          const damage = Math.min(hero.hp, Math.max(1, Math.round(event.damage * .12)));
          hero.hp -= damage; event.targets.push({ heroId: hero.id, damage }); event.effect = 'reflect';
        }
      }
      return finish(state, event);
    }
    if (action.type === 'boss') {
      if (action.expectedRevision !== state.revision) fail('That boss turn already changed. Check the latest health before attacking again.');
      if (state.pending) fail('Resolve the selected answer before the boss turn.');
      const ultimate = !!action.ultimate;
      if (ultimate && state.charge < boss.chargeMax) fail('The ultimate is not charged yet.');
      if (!ultimate && state.charge >= boss.chargeMax) fail('Ultimate is ready. Trigger it before another normal attack.');
      const living = state.heroes.filter(h => h.hp > 0);
      const focus = living[state.bossTurns % living.length];
      const targets = ultimate || boss.playstyle === 'splash' ? living : [focus];
      Object.assign(event, { ultimate, move: ultimate ? boss.ultimateName : boss.attackName, effect: boss.playstyle });
      targets.forEach(h => {
        const scale = ultimate ? 1.4 : boss.playstyle === 'splash' ? .6 : 1;
        const raw = (18 + h.stats.maxHp * .07) * boss.attackMultiplier * scale;
        const defence = h.stats.defence * (boss.playstyle === 'pierce' ? .35 : 1);
        const hits = !ultimate && boss.playstyle === 'swift' ? 2 : 1;
        const damage = Math.min(h.hp, Math.max(3, Math.round(raw - defence * .65)) * hits);
        h.hp -= damage; if (boss.playstyle === 'weaken') h.weakened = true;
        event.targets.push({ heroId: h.id, damage, hits });
      });
      if (!ultimate && boss.playstyle === 'regenerate') {
        event.bossHealed = Math.min(state.bossMaxHp - state.bossHp, Math.round(state.bossMaxHp * .025));
        state.bossHp += event.bossHealed;
      }
      if (boss.playstyle === 'guard') state.guard = true;
      state.bossTurns++; state.charge = ultimate ? 0 : Math.min(boss.chargeMax, state.charge + 1);
      return finish(state, event);
    }
    fail('Unknown battle action.');
  }
  return { ROLES, BOSSES, bossById, heroFromStudent, reduce, randomUnit };
});
