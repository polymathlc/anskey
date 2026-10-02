/* Deterministic classroom JRPG rules, shared by the browser and transaction tests. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./battle-bosses.js'), require('./battle-content.js'));
  else root.ClassroomBattleCore = factory(root.ClassroomBosses, root.ClassroomBattleContent);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(BOSSES, CONTENT) {
  'use strict';
  const { ROLES, SKILLS, ITEMS, RARITIES } = CONTENT;
  const ROLE_KEYS = Object.keys(ROLES), ALL_SKILLS = Object.values(SKILLS).flat();
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || 0));
  const int = (n, lo, hi) => Math.round(clamp(n, lo, hi));
  const roleKey = key => key === 'healer' ? 'cleric' : Object.prototype.hasOwnProperty.call(ROLES,key) ? key : 'warrior';
  const copy = value => JSON.parse(JSON.stringify(value));
  function fail(message) { throw new Error(message); }
  function bossById(id) { return BOSSES.find(b => b.id === id) || fail('Unknown enemy. Reload the app.'); }
  function skillById(id) { return ALL_SKILLS.find(s => s.id === id) || null; }
  function itemById(id) { return ITEMS[id] || null; }
  function randomUnit(seed) {
    let hash = 2166136261;
    for (const ch of String(seed)) hash = Math.imul(hash ^ ch.charCodeAt(0),16777619);
    // Final avalanche prevents adjacent student IDs getting almost identical loot rolls.
    hash ^= hash >>> 16; hash = Math.imul(hash,0x7feb352d); hash ^= hash >>> 15;
    hash = Math.imul(hash,0x846ca68b); hash ^= hash >>> 16;
    return (hash >>> 0) / 4294967296;
  }
  function xpForLevel(level) { return 75 * (int(level,1,50)-1) * int(level,1,50) / 2; }
  function levelForXp(xp) { let level=1; while (level<50 && xp>=xpForLevel(level+1)) level++; return level; }
  function equipmentEffect(hero) {
    const entry = (hero.inventory || []).find(i => i.id === hero.equipped && i.quantity > 0);
    const item = entry && itemById(entry.itemId);
    return item && item.type === 'equipment' ? item.effect : {};
  }
  function statsFor(hero) {
    const role = ROLES[hero.role], level = hero.level || 1;
    const stats = { maxHp:role.hp+(level-1)*9, damage:role.power+(level-1)*3, defence:role.defence+(level-1),
      healing:role.healing+(hero.role==='cleric'?(level-1)*2:0), maxMp:role.mp+(level-1)*3,
      critChance:role.crit, critMultiplier:1.6, attacks:role.attacks };
    const bonuses = [equipmentEffect(hero), ...(hero.learnedSkills || []).map(skillById).filter(s=>s && s.role===hero.role && s.passive).map(s=>s.effect.passive)];
    bonuses.forEach(b => Object.keys(stats).forEach(k => { if (Number.isFinite(b[k])) stats[k]+=b[k]; }));
    stats.critChance = clamp(stats.critChance,0,.85); stats.critMultiplier=clamp(stats.critMultiplier,1,3);
    return stats;
  }
  function refreshStats(hero) {
    const old=hero.stats || {}, hp=hero.hp, mp=hero.mp;
    hero.stats=statsFor(hero);
    hero.hp=hp===undefined ? hero.stats.maxHp : hp<=0 ? 0 : int(hero.stats.maxHp-((old.maxHp || hero.stats.maxHp)-hp),1,hero.stats.maxHp);
    hero.mp=mp===undefined ? hero.stats.maxMp : int(mp,0,hero.stats.maxMp);
  }
  function freshHero(identity, role) {
    const hero={...identity,role:roleKey(role),progressionVersion:1,level:1,xp:0,skillPoints:2,
      learnedSkills:[SKILLS[roleKey(role)][0].id],inventory:[{id:'bag:red-potion',itemId:'red-potion',quantity:2},{id:'bag:blue-ether',itemId:'blue-ether',quantity:1}],
      equipped:null,cooldowns:{},shield:0,weakened:false,correctActions:0,mythicalUsed:false};
    refreshStats(hero); return hero;
  }
  function heroFromStudent(student, ignoredCerProfile, index) {
    const uid = typeof student.uid==='string' && student.uid ? student.uid : null;
    const identity={id:'student:'+String(student.id),uid,studentId:String(student.id || ''),name:String(student.name || 'Student').slice(0,100)};
    const role=ROLE_KEYS[Number.isInteger(index)?Math.abs(index)%4:Math.floor(randomUnit(identity.id)*4)];
    return freshHero(identity,role);
  }
  function cleanHero(input, prior) {
    if (!input || typeof input.id!=='string' || !input.id || input.id.length>180) fail('Invalid hero identity.');
    const identity={id:input.id,uid:input.uid || null,studentId:String(input.studentId || ''),name:String(input.name || 'Student').slice(0,100)};
    // New roster data never supplies progression, stats, equipment or avatars.
    if (!prior || prior.progressionVersion!==1) return freshHero(identity,prior?roleKey(prior.role):roleKey(input.role));
    const hero={...copy(prior),...identity,role:roleKey(prior.role)};
    delete hero.avatarUrl; delete hero.equipment; delete hero.fallbackReason;
    hero.xp=int(hero.xp,0,xpForLevel(50)); hero.level=levelForXp(hero.xp);
    hero.skillPoints=int(hero.skillPoints,0,150);
    hero.learnedSkills=[...new Set((hero.learnedSkills || []).filter(id=>!!skillById(id)))];
    if (!hero.learnedSkills.includes(SKILLS[hero.role][0].id)) hero.learnedSkills.push(SKILLS[hero.role][0].id);
    hero.inventory=(hero.inventory || []).filter(i=>i && itemById(i.itemId) && i.quantity>0).map(i=>({id:'bag:'+i.itemId,itemId:i.itemId,quantity:int(i.quantity,1,999)}));
    hero.cooldowns=hero.cooldowns || {}; hero.shield=int(hero.shield,0,5000);
    refreshStats(hero); return hero;
  }
  function configureHero(input, action) {
    const hero=cleanHero(input,input), hpBefore=hero.hp;
    if (action.command==='learn') {
      const result=canLearn(hero,action.skillId); if (!result.ok) fail(result.reason);
      hero.learnedSkills.push(action.skillId); hero.skillPoints-=skillById(action.skillId).cost;
    } else if (action.command==='class') {
      if (!ROLES[action.role] && action.role!=='healer') fail('Choose Warrior, Ranger, Mage or Cleric.');
      hero.role=roleKey(action.role);
      const starter=SKILLS[hero.role][0].id; if (!hero.learnedSkills.includes(starter)) hero.learnedSkills.push(starter);
    } else if (action.command==='equip') {
      if (action.itemId===null || action.itemId==='') hero.equipped=null;
      else {
        const entry=hero.inventory.find(i=>i.id===action.itemId && i.quantity>0), item=entry && itemById(entry.itemId);
        if (!item || item.type!=='equipment') fail('Choose equipment from this hero’s inventory.');
        hero.equipped=entry.id;
      }
    } else fail('Unknown hero command.');
    refreshStats(hero);
    if (action.command==='class' || action.command==='equip') hero.hp=Math.min(hpBefore,hero.stats.maxHp);
    return hero;
  }
  function roster(heroes, priorState) {
    if (!Array.isArray(heroes) || !heroes.length || heroes.length>100) fail('Choose a class with 1–100 students.');
    const old=new Map(Object.entries(priorState && priorState.heroArchive || {}));
    (priorState && priorState.heroes || []).forEach(h=>old.set(h.id,h));
    const seen=new Set();
    return heroes.filter(h=>{ if (!h || seen.has(h.id)) return false; seen.add(h.id); return true; }).map(h=>cleanHero(h,old.get(h.id) || [...old.values()].find(prior=>h.studentId && prior.studentId===h.studentId)));
  }
  function archiveFor(previous, heroes) {
    const archive=copy(previous && previous.heroArchive || {}), active=new Set(heroes.map(h=>h.id));
    (previous && previous.heroes || []).forEach(h=>{ if (!active.has(h.id)) archive[h.id]=h; });
    heroes.forEach(h=>delete archive[h.id]);
    Object.keys(archive).slice(0,Math.max(0,Object.keys(archive).length-100)).forEach(id=>delete archive[id]);
    return archive;
  }
  function addXp(hero, amount) {
    const level=hero.level;
    hero.xp=int(hero.xp+amount,0,xpForLevel(50)); hero.level=levelForXp(hero.xp);
    hero.skillPoints+=Math.max(0,hero.level-level)*2; refreshStats(hero);
  }
  function availableSkills(hero) { return (SKILLS[roleKey(hero.role)] || []).filter(s=>!s.passive && (hero.learnedSkills || []).includes(s.id)); }
  function canLearn(hero, id) {
    const skill=skillById(id);
    if (!skill || skill.role!==hero.role) return {ok:false,reason:'Choose a skill from this hero’s class.'};
    if ((hero.learnedSkills || []).includes(id)) return {ok:false,reason:'Already learned.'};
    if (hero.level<skill.level) return {ok:false,reason:'Requires level '+skill.level+'.'};
    if (!skill.requires.every(required=>(hero.learnedSkills || []).includes(required))) return {ok:false,reason:'Learn the preceding branch skill first.'};
    if (hero.skillPoints<skill.cost) return {ok:false,reason:'Requires '+skill.cost+' skill points.'};
    return {ok:true,reason:''};
  }
  function timingMultiplier(position) { return .55+clamp(position,0,1)*1.45; }
  function rollReward(encounterId,heroId,boss) {
    const seed=encounterId+':'+heroId, roll=randomUnit(seed+':rarity')*100;
    let sum=0, rarity='mythical';
    for (const key of Object.keys(RARITIES)) { sum+=RARITIES[key].weight; if (roll<sum) {rarity=key; break;} }
    const pool=Object.values(ITEMS).filter(i=>i.rarity===rarity), item=pool[Math.floor(randomUnit(seed+':item')*pool.length)];
    return {heroId,itemId:item.id,instanceId:seed,rarity,name:item.name,description:item.description,xp:boss.rewardXp || 65};
  }
  function awardLoot(state,event) {
    if (state.lootAwarded) return;
    state.lootAwarded=true;
    state.rewards=state.heroes.map(hero=>{
      const reward=rollReward(state.encounterId,hero.id,bossById(state.bossId));
      const entry=hero.inventory.find(i=>i.itemId===reward.itemId);
      if (entry) entry.quantity=Math.min(999,entry.quantity+1);
      else hero.inventory.push({id:'bag:'+reward.itemId,itemId:reward.itemId,quantity:1});
      addXp(hero,reward.xp); return reward;
    });
    event.rewards=state.rewards;
  }
  function finish(state,event) {
    // Revival applies to every damage source, including reflected hero attacks.
    state.heroes.filter(h=>event.targets.some(t=>t.damage>0) && equipmentEffect(h).revive && !h.mythicalUsed).forEach(holder=>{
      const fallen=state.heroes.find(h=>h.hp<=0);
      if (fallen) {holder.mythicalUsed=true;heal(fallen,fallen.stats.maxHp*.5,event);event.revival=true;}
    });
    state.revision++; state.actionCount++; state.lastEvent=event;
    state.status=state.bossHp<=0?'victory':state.heroes.every(h=>h.hp<=0)?'defeat':'active';
    if (state.status!=='active') state.pending=null;
    if (state.status==='victory') awardLoot(state,event);
    return state;
  }
  function heal(hero,amount,event) {
    const actual=Math.min(hero.stats.maxHp-hero.hp,Math.max(0,Math.round(amount)));
    hero.hp+=actual; if (actual) event.healed.push({heroId:hero.id,amount:actual});
  }
  function restoreMana(hero,amount) { hero.mp=int(hero.mp+amount,0,hero.stats.maxMp); }
  function support(state,hero,effect,event,target) {
    const boost=hero.role==='cleric'?1+hero.stats.healing/200:1;
    if (effect.heal) heal(target,target.stats.maxHp*effect.heal,event);
    if (effect.healAll) state.heroes.forEach(h=>heal(h,h.stats.maxHp*effect.healAll*boost,event));
    if (effect.mana) restoreMana(target,effect.mana);
    if (effect.manaAll) state.heroes.forEach(h=>restoreMana(h,effect.manaAll));
    if (effect.shield) state.heroes.forEach(h=>{h.shield=Math.min(h.stats.maxHp,Math.round(h.shield+h.stats.maxHp*effect.shield));});
    if (effect.shieldSelf) hero.shield=Math.min(hero.stats.maxHp,Math.round(hero.shield+hero.stats.maxHp*effect.shieldSelf));
    if (effect.cleanse) (effect.healAll?state.heroes:[target]).forEach(h=>{h.weakened=false;});
    if (effect.weakenBoss) state.bossWeakness=Math.max(state.bossWeakness || 0,effect.weakenBoss);
    if (effect.poison) state.poison={turns:effect.poison,damage:Math.round(hero.stats.damage*.35),heroId:hero.id};
    if (effect.haste) state.heroes.forEach(h=>Object.keys(h.cooldowns).forEach(id=>{if (h.id!==hero.id || id!==event.skillId) h.cooldowns[id]=Math.max(0,h.cooldowns[id]-effect.haste);}));
  }
  function normalizeState(previous) {
    const state=copy(previous), migrated=new Map();
    function migrate(hero) {
      if (hero.studentId) { const id='student:'+hero.studentId; migrated.set(hero.id,id); hero.id=id; }
      return hero;
    }
    state.heroes=state.heroes.map(migrate);
    state.heroArchive=Object.fromEntries(Object.values(state.heroArchive || {}).map(h=>{migrate(h);return [h.id,h];}));
    const identity=id=>migrated.get(id) || id;
    if (state.pending) state.pending.heroId=identity(state.pending.heroId);
    if (state.poison) state.poison.heroId=identity(state.poison.heroId);
    (state.rewards || []).forEach(r=>{r.heroId=identity(r.heroId);});
    if (state.lastEvent) {
      if (state.lastEvent.heroId) state.lastEvent.heroId=identity(state.lastEvent.heroId);
      ['targets','healed','rewards'].forEach(key=>(state.lastEvent[key] || []).forEach(e=>{e.heroId=identity(e.heroId);}));
    }
    if (!state.heroes.every(h=>h.progressionVersion===1)) {
      state.heroes=state.heroes.map(h=>{
        const next=cleanHero(h,h); next.hp=h.hp<=0?0:int(next.stats.maxHp*(h.hp/h.stats.maxHp),1,next.stats.maxHp); return next;
      });
    }
    state.heroArchive=state.heroArchive || {}; state.rewards=state.rewards || [];
    if (state.lootAwarded===undefined) state.lootAwarded=state.status!=='active';
    state.bossWeakness=state.bossWeakness || 0; state.poison=state.poison || null;
    return state;
  }
  // Pick only learned, affordable, ready skills. Support becomes valuable when
  // allies need it; otherwise a normal attack restores MP instead of wasting it.
  function chooseAutoCommand(state, hero) {
    const hurt=state.heroes.filter(h=>h.hp/h.stats.maxHp<.7), fallen=state.heroes.filter(h=>h.hp<=0);
    const candidates=availableSkills(hero).filter(s=>hero.mp>=s.mpCost && !(hero.cooldowns[s.id]>0));
    const rated=candidates.map(skill=>{
      const e=skill.effect;
      let score=(e.power || 0)+(e.damage || 0)/Math.max(1,hero.stats.damage);
      if (e.guaranteedCrit) score*=hero.stats.critMultiplier;
      score+=(e.pierce || 0)*.3;
      if (e.healAll && hurt.length) score+=4+e.healAll*3+fallen.length*2;
      if (e.heal && hero.hp/hero.stats.maxHp<.7) score+=4+e.heal*3;
      if (e.shield && state.heroes.some(h=>h.hp>0 && h.shield<h.stats.maxHp*.1)) score+=1+e.shield;
      if (e.weakenBoss) score+=e.weakenBoss;
      if (e.poison && !state.poison) score+=.3;
      return {skill,score};
    }).sort((a,b)=>b.score-a.score || a.skill.id.localeCompare(b.skill.id));
    return rated.length && rated[0].score>1 ? {command:'skill',skillId:rated[0].skill.id} : {command:'attack'};
  }
  function autoTurn(previous, action) {
    if (typeof action.spinId!=='string' || action.spinId!==action.id) fail('Quick fights require the saved wheel spin ID.');
    if (previous && previous.lastAutoSpinId===action.spinId) return previous;
    if (previous && previous.pending) fail('Finish the manual battle answer before using Quick fight.');
    if (previous && action.expectedRevision!==previous.revision) fail('The encounter changed on another screen. Spin again.');
    let state=previous?normalizeState(previous):null;
    if (!state || state.status!=='active') {
      state=reduce(state,{type:'start',id:action.id,expectedRevision:state && state.revision,heroes:action.heroes,bossId:action.bossId});
    } else if (action.encounterId!==state.encounterId) fail('This encounter has changed. Reload its latest progress.');
    if (Array.isArray(action.heroes) && action.heroes.length) {
      const fresh=roster(action.heroes,state); state.heroArchive=archiveFor(state,fresh); state.heroes=fresh;
    }
    const hero=state.heroes.find(h=>h.id===action.heroId);
    if (!hero) fail('This student is no longer in the encounter. Open Battle to refresh the party.');
    const command=chooseAutoCommand(state,hero);
    state.pending={id:action.spinId,heroId:hero.id};
    state=reduce(state,{...command,type:'answer',id:action.id,encounterId:state.encounterId,turnId:action.spinId,outcome:'correct'});
    const heroEvent=state.lastEvent;
    let enemyEvent=null;
    if (state.status==='active') {
      const boss=bossById(state.bossId);
      state=reduce(state,{type:'boss',id:action.id,encounterId:state.encounterId,expectedRevision:state.revision,
        ultimate:state.charge>=boss.chargeMax,timing:randomUnit(state.encounterId+':'+action.spinId+':boss')*.75});
      enemyEvent=state.lastEvent;
    }
    state.revision=(previous && previous.revision || 0)+1;
    state.actionCount=(previous && previous.status==='active'?previous.actionCount:0)+1;
    // Quick spins earn combat XP but are not answers and never award answer marks.
    state.correctCount=previous && previous.status==='active'?previous.correctCount:0;
    state.lastAutoSpinId=action.spinId;
    state.lastEvent={...heroEvent,id:action.id,type:'auto',outcome:state.status,spinId:action.spinId,enemy:enemyEvent,
      targets:[...(heroEvent.targets || []),...(enemyEvent && enemyEvent.targets || [])],
      healed:[...(heroEvent.healed || []),...(enemyEvent && enemyEvent.healed || [])],rewards:state.status==='victory'?state.rewards:[]};
    return state;
  }
  function reduce(previous,action) {
    if (!action || typeof action.id!=='string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(action.id)) fail('Invalid battle action.');
    const event={id:action.id,type:action.type,healed:[],targets:[]};
    if (action.type==='auto') return autoTurn(previous,action);
    if (action.type==='start') {
      if (previous && action.expectedRevision!==previous.revision) fail('The class changed on another screen. Try again.');
      const heroes=roster(action.heroes,previous && normalizeState(previous)), boss=bossById(action.bossId);
      heroes.forEach(h=>{h.hp=h.stats.maxHp;h.mp=h.stats.maxMp;h.cooldowns={};h.shield=0;h.weakened=false;h.mythicalUsed=false;h.correctActions=0;});
      const bossMaxHp=Math.round(Math.max(200,heroes.reduce((sum,h)=>sum+h.stats.damage,0)*4)*boss.hpMultiplier);
      return {schemaVersion:1,encounterId:action.id,revision:(previous && previous.revision || 0)+1,
        bossId:boss.id,bossHp:bossMaxHp,bossMaxHp,charge:0,heroes,heroArchive:archiveFor(previous,heroes),pending:null,status:'active',
        bossTurns:0,actionCount:1,correctCount:0,guard:false,bossWeakness:0,poison:null,rewards:[],lootAwarded:false,lastEvent:event};
    }
    if (!previous || action.encounterId!==previous.encounterId) fail('This encounter has changed. Reload its latest progress.');
    const state=normalizeState(previous), boss=bossById(state.bossId);
    if (action.type==='sync') {
      if (action.expectedRevision!==state.revision) fail('The class changed on another screen. Try again.');
      if (action.command) {
        if (state.pending) fail('Resolve the selected answer before changing a hero.');
        const hero=state.heroes.find(h=>h.id===action.heroId);
        if (!hero) fail('This student is no longer in the class.');
        state.heroes[state.heroes.indexOf(hero)]=configureHero(hero,action);
        event.command=action.command; event.heroId=hero.id;
      } else {
        const fresh=roster(action.heroes,state);
        state.heroArchive=archiveFor(state,fresh); state.heroes=fresh;
        if (state.pending && !state.heroes.some(h=>h.id===state.pending.heroId)) state.pending=null;
        if (JSON.stringify(state.heroes)===JSON.stringify(previous.heroes) && JSON.stringify(state.pending)===JSON.stringify(previous.pending)) return previous;
      }
      if (state.status==='active' && state.heroes.every(h=>h.hp<=0)) {state.status='defeat';state.pending=null;}
      state.revision++; state.lastEvent=event; return state;
    }
    if (action.type==='end') {
      if (action.expectedRevision!==state.revision) fail('The encounter changed. Try again.');
      state.status='defeat'; state.pending=null; state.revision++; state.lastEvent=event; return state;
    }
    if (state.status!=='active') fail('Encounter finished. Start a new encounter to play again.');
    if (action.type==='select') {
      if (state.pending) fail('Resolve the selected answer before spinning again.');
      if (action.expectedRevision!==state.revision) fail('The class changed on another screen. Spin again.');
      const hero=state.heroes.find(h=>h.id===action.heroId); if (!hero) fail('This student is no longer in the class.');
      state.pending={id:action.turnId || action.id,heroId:hero.id}; event.heroId=hero.id; return finish(state,event);
    }
    if (action.type==='answer') {
      if (!state.pending || action.turnId!==state.pending.id) fail('This answer was already resolved or belongs to an older turn.');
      if (!['correct','incorrect','skip'].includes(action.outcome)) fail('Choose Correct, Incorrect or Skip.');
      const hero=state.heroes.find(h=>h.id===state.pending.heroId);
      Object.assign(event,{heroId:hero.id,role:hero.role,outcome:action.outcome,damage:0,critical:false,command:action.command || 'attack'});
      if (action.outcome==='correct') {
        let effect={power:1}, skill=null, itemEntry=null;
        const gear=equipmentEffect(hero), target=action.targetId?state.heroes.find(h=>h.id===action.targetId):hero;
        if (!target) fail('Choose a teammate in this encounter.');
        if (event.command==='skill') {
          skill=skillById(action.skillId);
          if (!skill || skill.role!==hero.role || skill.passive || !hero.learnedSkills.includes(skill.id)) fail('Learn that active skill first.');
          if ((hero.cooldowns[skill.id] || 0)>0) fail('That skill is cooling down. Use another command.');
          if (hero.mp<skill.mpCost) fail('Not enough MP. Attack to recover MP or use an Ether.');
          effect=skill.effect; event.skillId=skill.id; event.move=skill.name;
        } else if (event.command==='item') {
          itemEntry=hero.inventory.find(i=>i.id===action.itemId && i.quantity>0);
          const item=itemEntry && itemById(itemEntry.itemId);
          if (!item || item.type!=='consumable') fail('Choose a consumable from this hero’s inventory.');
          effect=item.effect; event.itemId=item.id; event.move=item.name;
        } else if (event.command!=='attack') fail('Choose Attack, Skills or Items.');
        if (hero.hp<=0) heal(hero,hero.stats.maxHp*.25,event);
        Object.keys(hero.cooldowns).forEach(id=>{hero.cooldowns[id]=Math.max(0,hero.cooldowns[id]-1);});
        if (skill) {hero.mp-=skill.mpCost;hero.cooldowns[skill.id]=skill.cooldown;}
        if (itemEntry) {itemEntry.quantity--;hero.inventory=hero.inventory.filter(i=>i.quantity>0);}
        if (event.command==='attack') restoreMana(hero,10);
        restoreMana(hero,gear.manaRegen || 0);
        support(state,hero,effect,event,target);
        if (effect.power || effect.damage) {
          hero.correctActions++;
          event.critical=!!effect.power && (!!effect.guaranteedCrit || randomUnit(state.encounterId+':'+action.turnId)<hero.stats.critChance);
          const armour=boss.defence*(1-Math.max(effect.pierce || 0,gear.pierce || 0));
          const echo=gear.echo && hero.correctActions%3===0?2:1;
          const raw=(effect.damage || hero.stats.damage*effect.power*(event.critical?hero.stats.critMultiplier:1)*(1-armour)*(hero.weakened?.7:1)*(state.guard && !gear.ignoreGuard?.6:1))*echo;
          event.damage=Math.min(state.bossHp,Math.max(1,Math.round(raw))); event.echo=echo===2;
          state.bossHp-=event.damage; state.guard=false;
          if (effect.leech || gear.leech) heal(hero,event.damage*((effect.leech || 0)+(gear.leech || 0)),event);
          if (gear.teamLeech) state.heroes.forEach(h=>heal(h,h.stats.maxHp*gear.teamLeech,event));
          if (gear.teamMana) state.heroes.forEach(h=>restoreMana(h,gear.teamMana));
          if (boss.playstyle==='reflect' && state.bossHp>0) {
            const damage=Math.min(hero.hp,Math.max(1,Math.round(event.damage*.12)));
            hero.hp-=damage;event.targets.push({heroId:hero.id,damage});event.effect='reflect';
          }
        }
        hero.weakened=false; state.correctCount++; addXp(hero,12);
      }
      state.pending=null; return finish(state,event);
    }
    if (action.type==='boss') {
      if (action.expectedRevision!==state.revision) fail('That boss turn already changed. Check the latest health before attacking again.');
      if (state.pending) fail('Resolve the selected answer before the boss turn.');
      const ultimate=!!action.ultimate;
      if (ultimate && state.charge<boss.chargeMax) fail('The ultimate is not charged yet.');
      if (!ultimate && state.charge>=boss.chargeMax) fail('Ultimate is ready. Trigger it before another normal attack.');
      if (action.timing!==undefined && (!Number.isFinite(action.timing) || action.timing<0 || action.timing>1)) fail('Stop the timing meter inside the bar.');
      const timing=action.timing===undefined?.5:action.timing, multiplier=timingMultiplier(timing);
      const living=state.heroes.filter(h=>h.hp>0),focus=living[state.bossTurns%living.length],targets=ultimate || boss.playstyle==='splash'?living:[focus];
      Object.assign(event,{ultimate,move:ultimate?boss.ultimateName:boss.attackName,effect:boss.playstyle,timing,multiplier,zone:timing>=.85?'red':timing>=.55?'orange':'black'});
      targets.forEach(h=>{
        const scale=ultimate?1.4:boss.playstyle==='splash'?.6:1;
        const raw=(18+h.stats.maxHp*.07)*boss.attackMultiplier*scale;
        const defence=h.stats.defence*(boss.playstyle==='pierce'?.35:1),hits=!ultimate && boss.playstyle==='swift'?2:1;
        const beforeShield=Math.max(1,Math.round(Math.max(3,raw-defence*.65)*hits*multiplier*(1-state.bossWeakness)));
        const absorbed=Math.min(h.shield,beforeShield),damage=Math.min(h.hp,beforeShield-absorbed);
        h.shield-=absorbed;h.hp-=damage;if (boss.playstyle==='weaken') h.weakened=true;
        event.targets.push({heroId:h.id,damage,hits,absorbed});
      });
      state.bossWeakness=0;
      if (!ultimate && boss.playstyle==='regenerate') {event.bossHealed=Math.min(state.bossMaxHp-state.bossHp,Math.round(state.bossMaxHp*.025));state.bossHp+=event.bossHealed;}
      if (boss.playstyle==='guard') state.guard=true;
      if (state.poison && state.poison.turns>0) {
        event.poisonDamage=Math.min(state.bossHp,state.poison.damage);state.bossHp-=event.poisonDamage;state.poison.turns--;
        if (!state.poison.turns) state.poison=null;
      }
      state.bossTurns++;state.charge=ultimate?0:Math.min(boss.chargeMax,state.charge+1);return finish(state,event);
    }
    fail('Unknown battle action.');
  }
  return {ROLES,BOSSES,CONTENT,SKILLS,SKILL_TREES:SKILLS,ITEMS,RARITIES,bossById,skillById,itemById,heroFromStudent,
    reduce,cleanHero,configureHero,normalizeState,levelForXp,chooseAutoCommand,randomUnit,availableSkills,canLearn,xpForLevel,timingMultiplier,equipmentEffect,statsFor,rollReward};
});
