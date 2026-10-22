/* Deterministic classroom JRPG rules, shared by the browser and transaction tests. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./battle-bosses.js'), require('./battle-content.js'));
  else root.ClassroomBattleCore = factory(root.ClassroomBosses, root.ClassroomBattleContent);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(BOSSES, CONTENT) {
  'use strict';
  const { ROLES, SKILLS, JOBS, JOB_SKILLS, ITEMS, RARITIES } = CONTENT;
  const ITEM_SKILLS=CONTENT.ITEM_SKILLS || [];
  const EQUIPMENT_SLOTS = CONTENT.EQUIPMENT_SLOTS || Object.fromEntries(['helm','torso','gloves','legs','boots','amulet','ring1','ring2','mainHand','offHand','pet'].map(key=>[key,{name:key}]));
  const SLOT_KEYS = Object.keys(EQUIPMENT_SLOTS);
  const ROLE_KEYS = Object.keys(ROLES), ALL_SKILLS = [...Object.values(SKILLS).flat(),...Object.values(JOB_SKILLS).flat(),...ITEM_SKILLS];
  const BOSS_MAX_MP=60, BOSS_SKILL_MP=30, BOSS_ATTACK_MP=15;
  const ENEMY_HEALTH_VERSION=1;
  // Enemies grow with the party. An encounter started since this rule existed
  // carries enemyScalingVersion and its own enemyLevel, fixed at the start, so
  // a hero levelling up mid-fight never changes the enemy under the class.
  // Older encounters carry neither and play exactly as they always did.
  const ENEMY_SCALING_VERSION=1;
  const ENEMY_SCALING={hpPerLevel:.12,attackPerLevel:.04,armourPerLevel:.004,armourMax:.15,xpPerLevel:.04,
    // No single correct answer can take more than this share of the enemy's
    // health, however many points were awarded or how strong the skill was,
    // so an enemy always needs several answers. Burns tick for less.
    hitShare:.25,poisonShare:.08};
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || 0));
  const int = (n, lo, hi) => Math.round(clamp(n, lo, hi));
  const roleKey = key => key === 'healer' ? 'cleric' : Object.prototype.hasOwnProperty.call(ROLES,key) ? key : 'warrior';
  const copy = value => JSON.parse(JSON.stringify(value));
  function fail(message) { throw new Error(message); }
  function bossById(id) { return BOSSES.find(b => b.id === id) || fail('Unknown enemy. Reload the app.'); }
  function skillById(id) { return ALL_SKILLS.find(s => s.id === id) || null; }
  function itemById(id) { return ITEMS[id] || null; }
  function activeJob(hero) { const job=JOBS[hero.job]; return job && job.role===hero.role && hero.level>=15 ? job : null; }
  function jobsFor(hero) { return Object.values(JOBS).filter(j=>j.role===roleKey(hero.role)); }
  function skillsFor(hero) { const job=activeJob(hero); return [...(SKILLS[roleKey(hero.role)] || []),...(job?JOB_SKILLS[job.id]:[]),...grantedSkills(hero)]; }
  function treeSkills(hero,mode='job') { const job=activeJob(hero); return mode==='base' || !job ? SKILLS[roleKey(hero.role)] : JOB_SKILLS[job.id]; }
  function activeSkill(hero,skill) { if (skill?.itemSkill) return grantedSkills(hero).some(s=>s.id===skill.id); return skill && skill.role===hero.role && (!skill.job || (activeJob(hero)?.id===skill.job && hero.level>=skill.level)); }
  function canAdvance(hero,jobId) {
    const job=JOBS[jobId];
    if (!job || job.role!==hero.role) return {ok:false,reason:'Choose an advanced job for this hero’s base class.'};
    if (levelForXp(hero.xp || 0)<15) return {ok:false,reason:'Requires level 15.'};
    if (hero.job===jobId) return {ok:false,reason:'This advanced job is already selected.'};
    return {ok:true,reason:''};
  }
  function randomUnit(seed) {
    let hash = 2166136261;
    for (const ch of String(seed)) hash = Math.imul(hash ^ ch.charCodeAt(0),16777619);
    // Final avalanche prevents adjacent student IDs getting almost identical loot rolls.
    hash ^= hash >>> 16; hash = Math.imul(hash,0x7feb352d); hash ^= hash >>> 15;
    hash = Math.imul(hash,0x846ca68b); hash ^= hash >>> 16;
    return (hash >>> 0) / 4294967296;
  }
  const ADVENTURE_RATES={uber:.02,chest:.06,event:.18,enemy:.74};
  const ADVENTURE_BIOMES=['forest','ruins','cavern','volcano'];
  function adventureFor(previous,seed) {
    const step=int((previous?.adventure?.step || 0)+1,1,1000000), roll=randomUnit(seed+':road');
    const kind=roll<.02?'uber':roll<.08?'chest':roll<.26?'event':'enemy';
    const events=['guardian-shrine','mana-spring','travelling-smith'];
    return {version:1,step,biome:ADVENTURE_BIOMES[Math.floor((step-1)/4)%4],kind,
      eventId:kind==='event'?events[Math.floor(randomUnit(seed+':event')*events.length)]:null,resolved:false};
  }
  // Presentation reads this same build profile; it never invents a combat bonus.
  function buildFor(hero) {
    const result={physicalBonus:0,elementalBonus:0,physicalPierce:0,elementalPierce:0,exposureBonus:0,element:null};
    (hero.learnedSkills || []).map(skillById).filter(s=>s && !s.itemSkill && activeSkill(hero,s) && s.passive).forEach(s=>{
      const p=s.effect.passive;
      Object.keys(result).filter(k=>k!=='element').forEach(k=>{if(Number.isFinite(p[k]))result[k]+=p[k];});
      if (p.attackElement) result.element=p.attackElement;
    });
    const gear=equipmentEffect(hero);
    Object.keys(result).filter(k=>k!=='element').forEach(k=>{if(Number.isFinite(gear[k]))result[k]+=gear[k];});
    const infused=weaponElement(hero);
    result.basicType=infused || (result.element && result.elementalBonus>result.physicalBonus ? result.element :
      result.physicalBonus>0 ? 'physical' : result.element || (hero.role==='mage'?'arcane':hero.role==='cleric'?'holy':'physical'));
    return result;
  }
  function damageTypeFor(hero,skill) {
    const build=buildFor(hero);
    if (!skill) return build.basicType;
    if (skill.damageType==='adaptive') return build.elementalBonus>build.physicalBonus ? build.element || 'arcane' : 'physical';
    if (skill.damageType) return skill.damageType;
    const name=skill.id+' '+skill.branch;
    if (/fire|flame|magma|volcan|ember|inferno|pyro|solar/i.test(name)) return 'fire';
    if (/ice|frost|winter|glaci|zero/i.test(name)) return 'ice';
    if (/thunder|lightning|storm|tempest/i.test(name)) return 'lightning';
    return hero.role==='mage'?'arcane':hero.role==='cleric'?'holy':'physical';
  }
  function adventureDiscovery(state,hero,event) {
    const road=state.adventure;
    if (!road || road.resolved) return;
    road.resolved=true;
    if (road.kind!=='event') return;
    const effects={'guardian-shrine':{shield:.15},'mana-spring':{manaAll:18},'travelling-smith':{expose:{physical:{amount:.15,turns:4},elemental:{amount:.15,turns:4}}}};
    support(state,hero,effects[road.eventId] || effects['guardian-shrine'],event,hero);
    event.discovery=road.eventId;
  }
  function bossRotationFor(previous) {
    const playable=new Set(BOSSES.filter(b=>!b.legacy).map(b=>b.id)),saved=previous?.bossRotation;
    const rotation={version:1,round:int(saved?.round || 1,1,1000000),seen:[...new Set((Array.isArray(saved?.seen)?saved.seen:[]).filter(id=>playable.has(id)))]};
    // Existing encounters already showed their current enemy. Count it once
    // when introducing rotations or reconciling an older six-enemy catalogue.
    if (!previous?.teamVersion && playable.has(previous?.bossId) && !rotation.seen.includes(previous.bossId)) rotation.seen.push(previous.bossId);
    return rotation;
  }
  function nextBoss(previous,seed,exclude=[]) {
    const rotation=bossRotationFor(previous),playable=BOSSES.filter(b=>!b.legacy);
    if (!playable.length) fail('No playable enemies. Reload the app.');
    const remaining=playable.filter(b=>!rotation.seen.includes(b.id)),pool=(remaining.length?remaining:playable).filter(b=>!exclude.includes(b.id));
    return pool[Math.floor(randomUnit(String(seed)+':enemy')*pool.length)];
  }
  function rotationAfterStart(previous,boss) {
    const rotation=bossRotationFor(previous),count=BOSSES.filter(b=>!b.legacy).length;
    if (rotation.seen.length>=count) {rotation.round++;rotation.seen=[];}
    rotation.seen.push(boss.id);return rotation;
  }
  // The enemy level leans towards the strongest hero, so one levelled-up
  // student in a young class still meets an enemy that can stand a hit.
  function enemyLevelFor(heroes) {
    const levels=(heroes || []).map(h=>int(h.level || 1,1,50));
    if (!levels.length) return 1;
    const average=levels.reduce((a,b)=>a+b,0)/levels.length,highest=Math.max(...levels);
    return int(Math.ceil((average+highest*2)/3),1,50);
  }
  function enemyScale(state) {
    const scaled=!!state && state.enemyScalingVersion>=ENEMY_SCALING_VERSION,level=scaled?int(state.enemyLevel || 1,1,50):1;
    return {scaled,level,
      hp:(1+ENEMY_SCALING.hpPerLevel*(level-1))*(state?.adventure?.kind==='uber'?1.8:1),
      attack:(1+ENEMY_SCALING.attackPerLevel*(level-1))*(state?.adventure?.kind==='uber'?1.25:1),
      armour:scaled?Math.min(ENEMY_SCALING.armourMax,ENEMY_SCALING.armourPerLevel*(level-1)):0,
      xp:(1+ENEMY_SCALING.xpPerLevel*(level-1))*(state?.adventure?.kind==='uber'?1.6:1),
      hitCap:scaled?Math.max(1,Math.round((state.bossMaxHp || 1)*ENEMY_SCALING.hitShare)):Infinity,
      poisonCap:scaled?Math.max(1,Math.round((state.bossMaxHp || 1)*ENEMY_SCALING.poisonShare)):Infinity};
  }
  // Old encounters have no enemies array and keep their original raid rules.
  const RUNE_BONUS_CHANCE=.5;
  function enemiesFor(state) {
    return state?.enemies || (state ? [{id:state.bossId,bossId:state.bossId,hp:state.bossHp,maxHp:state.bossMaxHp}] : []);
  }
  function combatHeroes(state) {
    return state?.teamSize>1 ? state.heroes.filter(h=>(state.teamHeroIds || []).includes(h.id)) : state.heroes;
  }
  function setTeam(state,heroId) {
    if (!(state.teamSize>1)) return;
    const lead=state.heroes.find(h=>h.id===heroId),others=state.heroes.filter(h=>h.id!==heroId && h.hp>0);
    const offset=others.length?state.correctCount%others.length:0;
    state.teamHeroIds=[...(lead?[lead.id]:[]),...others.slice(offset).concat(others.slice(0,offset)).slice(0,state.teamSize-(lead?1:0)).map(h=>h.id)];
  }
  function syncEnemyHp(state) {
    if(state.enemies) state.bossHp=state.enemies.reduce((n,e)=>n+e.hp,0);
  }
  function hitEnemy(state,enemy,damage) {
    const dealt=Math.min(enemy.hp,Math.max(0,damage));
    if(state.enemies){enemy.hp-=dealt;syncEnemyHp(state);}else state.bossHp-=dealt;
    return dealt;
  }
  function tickDamage(state,ailment,cap) {
    let dealt=0;
    for(const enemy of enemiesFor(state).filter(e=>e.hp>0 && (!ailment.enemyIds || ailment.enemyIds.includes(e.id)))){
      dealt+=hitEnemy(state,enemy,Math.min(cap-dealt,Math.max(0,ailment.damage)));
    }
    return dealt;
  }
  function startFormation(state,previous,seed,choice) {
    if(choice!==undefined && !['auto','raid','2v2','3v3'].includes(choice)) fail('Choose a valid encounter formation.');
    const roll=randomUnit(seed+':formation'),size=choice==='raid'?1:choice==='2v2'?2:choice==='3v3'?3:roll<.15?3:roll<.4?2:1;
    if(size>state.heroes.length && choice && choice!=='auto')fail('Add enough students for that team formation.');
    if(size<2 || state.heroes.length<size)return state;
    state.teamSize=size;state.teamVersion=1;
    const total=state.bossMaxHp,rotation=state.bossRotation;
    state.enemies=[{id:state.bossId,bossId:state.bossId,hp:0,maxHp:0}];
    for(let i=1;i<size;i++){
      const boss=nextBoss({bossRotation:rotation,bossId:state.enemies.at(-1).bossId},seed+':ally:'+i,state.enemies.map(e=>e.bossId));
      const next=rotationAfterStart({bossRotation:rotation},boss);
      rotation.round=next.round;rotation.seen=next.seen;
      state.enemies.push({id:boss.id,bossId:boss.id,hp:0,maxHp:0});
    }
    // Split the encounter's health budget, so extra enemies do not multiply grind.
    state.enemies.forEach((enemy,i)=>{enemy.maxHp=Math.floor(total/size)+(i<total%size?1:0);enemy.hp=enemy.maxHp;});
    setTeam(state,state.heroes[0].id);return state;
  }
  function targetingLabel(skill) {
    if(skill.passive)return 'Passive';
    const labels=[];
    if(skill.damageTarget)labels.push(skill.damageTarget==='aoe'?'AoE damage':'Single-target damage');
    if(skill.healTarget)labels.push(skill.healTarget==='aoe'?'AoE healing':'Single-target healing');
    return labels.join(' · ') || (skill.supportTarget==='aoe'?'AoE support':'Single-target support');
  }
  function xpForLevel(level) { return 75 * (int(level,1,50)-1) * int(level,1,50) / 2; }
  function levelForXp(xp) { let level=1; while (level<50 && xp>=xpForLevel(level+1)) level++; return level; }
  function equipmentSlot(item) {
    if (!item || !['equipment','pet'].includes(item.type)) return null;
    const slot=item.type==='pet'?'pet':item.slot || 'mainHand';
    return SLOT_KEYS.includes(slot) ? slot : null;
  }
  function equipmentFits(item,slot) {
    const assigned=equipmentSlot(item);
    return !!assigned && SLOT_KEYS.includes(slot) && (assigned===slot || ['ring1','ring2'].includes(assigned) && ['ring1','ring2'].includes(slot));
  }
  function loadoutFor(hero) {
    const result={},used=new Map(),inventory=(hero.inventory || []).filter(e=>e && e.quantity>0);
    const source=hero.loadout && typeof hero.loadout==='object' && !Array.isArray(hero.loadout) ? hero.loadout : {};
    const add=(slot,id)=>{
      const entry=inventory.find(e=>e.id===id);
      if (!entry || !equipmentFits(itemById(entry.itemId),slot) || (used.get(id)||0)>=entry.quantity) return;
      result[slot]=entry.id;used.set(id,(used.get(id)||0)+1);
    };
    SLOT_KEYS.forEach(slot=>add(slot,source[slot]));
    // Old profiles store a single inventory ID. Interpret it until the first
    // save writes the canonical loadout, retaining every owned legacy relic.
    if (!Object.keys(result).length && typeof hero.equipped==='string') {
      const entry=inventory.find(e=>e.id===hero.equipped),slot=entry && equipmentSlot(itemById(entry.itemId));
      if (slot) add(slot,entry.id);
    }
    return result;
  }
  function equippedEntries(hero) {
    return Object.values(loadoutFor(hero)).map(id=>(hero.inventory || []).find(e=>e.id===id));
  }
  function syncLoadout(hero) {
    hero.loadout=loadoutFor(hero);
    const ids=Object.values(hero.loadout);
    hero.equipped=ids.includes(hero.equipped)?hero.equipped:(hero.loadout.mainHand || ids[0] || null);
  }
  // Socket metadata belongs to a saved inventory entry, never to the catalogue.
  function socketable(item) { return item?.type==='equipment'; }
  function socketsFor(entry) {
    if (!entry || !socketable(itemById(entry.itemId)) || entry.socketVersion!==1 || !Array.isArray(entry.sockets)) return [];
    return entry.sockets.slice(0,3).map(id=>itemById(id)?.type==='rune'?id:null);
  }
  function socketRoll(seed,item) {
    if (!socketable(item)) return undefined;
    const roll=randomUnit(seed+':sockets');
    return Array(roll<.5?0:roll<.85?1:roll<.97?2:3).fill(null);
  }
  function addInventory(hero,itemId,quantity=1,sockets) {
    const item=itemById(itemId),hasSockets=socketable(item) && Array.isArray(sockets);
    const id='bag:'+itemId+(hasSockets?':s'+sockets.length:'');
    let entry=hero.inventory.find(i=>i.id===id);
    if (entry) entry.quantity=Math.min(999,entry.quantity+quantity);
    else {entry={id,itemId,quantity:Math.min(999,quantity),...(hasSockets?{socketVersion:1,sockets:[...sockets]}:{})};hero.inventory.push(entry);}
    return entry;
  }
  function equippedTraits(hero) {
    return equippedEntries(hero).flatMap(entry=>[itemById(entry.itemId),...socketsFor(entry).filter(Boolean).map(itemById)]).filter(Boolean);
  }
  function grantedSkills(hero) {
    const gifts=new Set((hero.giftSkills || []).filter(id=>Object.values(ITEMS).some(item=>item.giftSkill===id)));
    equippedTraits(hero).forEach(item=>{if(item.grantSkill)gifts.add(item.grantSkill);});
    return ITEM_SKILLS.filter(skill=>gifts.has(skill.id));
  }
  function weaponElement(hero) {
    const loadout=loadoutFor(hero);
    for (const slot of ['mainHand','offHand']) {
      const entry=(hero.inventory || []).find(i=>i.id===loadout[slot]);
      const rune=socketsFor(entry).find(Boolean);if(rune)return itemById(rune).element;
    }
    return null;
  }
  function configureSockets(hero,action) {
    if (typeof action.id!=='string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(action.id)) fail('Socket changes require a saved action ID.');
    let entry=hero.inventory.find(i=>i.id===action.itemId && i.quantity>0);
    const sockets=socketsFor(entry),index=action.socketIndex;
    if (!sockets.length) fail('This item has no sockets. Find equipment with sockets in treasure.');
    if (!Number.isInteger(index) || index<0 || index>=sockets.length) fail('Choose a socket on this item.');
    if (action.slot!==undefined && (!SLOT_KEYS.includes(action.slot) || hero.loadout[action.slot]!==entry.id)) fail('That equipment slot changed. Reopen the item.');
    if (action.command==='socket') {
      if (sockets[index]) fail('Remove the existing rune before inserting another.');
      const rune=hero.inventory.find(i=>i.id===action.runeId && i.quantity>0);
      if (itemById(rune?.itemId)?.type!=='rune') fail('Choose a rune owned by this hero.');
      // Split just one copy. Two equipped rings must never share the inserted rune.
      if (entry.quantity>1 || !/^runed:/.test(entry.id)) {
        const source=entry;source.quantity--;
        entry={id:'runed:'+action.id,itemId:source.itemId,quantity:1,socketVersion:1,sockets:[...sockets]};
        if(hero.inventory.some(i=>i.id===entry.id))fail('This socket action was already used. Refresh your hero.');
        hero.inventory.push(entry);
        const slot=action.slot || Object.keys(hero.loadout).find(key=>hero.loadout[key]===source.id);
        if(slot)hero.loadout[slot]=entry.id;
        if(hero.equipped===source.id)hero.equipped=entry.id;
      }
      entry.sockets[index]=rune.itemId;rune.quantity--;
      hero.inventory=hero.inventory.filter(i=>i.quantity>0);
    } else {
      if (!sockets[index]) fail('This socket is already empty.');
      addInventory(hero,sockets[index]);entry.sockets[index]=null;
    }
    syncLoadout(hero);
  }
  function equipmentEffect(hero) {
    const result={},effects=equippedTraits(hero).map(item=>item.effect || {});
    grantedSkills(hero).filter(s=>s.passive).forEach(s=>effects.push(s.effect.passive));
    effects.forEach(effect=>Object.entries(effect).forEach(([key,value])=>{
      if (typeof value==='boolean') result[key]=!!result[key] || value;
      else if (Number.isFinite(value)) result[key]=(Number(result[key]) || 0)+value;
    }));
    // Fractional combat mechanics stay bounded with eleven slots and their runes.
    for (const [key,maximum] of Object.entries({pierce:1,leech:.75,teamLeech:.3,critChance:.85,physicalBonus:1,elementalBonus:1,
      physicalPierce:.75,elementalPierce:.75,burn:.6,venom:.6,frost:.35,selfWard:.25,elementalBreak:.3,selfHaste:1})) {
      if (result[key]!==undefined) result[key]=clamp(result[key],0,maximum);
    }
    return result;
  }
  function statsFor(hero) {
    const role = ROLES[hero.role], level = hero.level || 1;
    const stats = { maxHp:role.hp+(level-1)*9, damage:role.power+(level-1)*3, defence:role.defence+(level-1),
      healing:role.healing+(hero.role==='cleric'?(level-1)*2:0), maxMp:role.mp+(level-1)*3,
      critChance:role.crit, critMultiplier:1.6, attacks:role.attacks };
    const bonuses = [equipmentEffect(hero),activeJob(hero)?.bonuses || {}, ...(hero.learnedSkills || []).map(skillById).filter(s=>s && !s.itemSkill && activeSkill(hero,s) && s.passive).map(s=>s.effect.passive)];
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
    const hero={...identity,role:roleKey(role),gender:'male',progressionVersion:1,level:1,xp:0,skillPoints:2,
      learnedSkills:[SKILLS[roleKey(role)][0].id],inventory:[{id:'bag:red-potion',itemId:'red-potion',quantity:2},{id:'bag:blue-ether',itemId:'blue-ether',quantity:1}],
      equipped:null,loadout:{},loadoutVersion:1,cooldowns:{},shield:0,weakened:false,correctActions:0,mythicalUsed:false};
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
    const hero={...copy(prior),...identity,role:roleKey(prior.role),gender:prior.gender==='female'?'female':'male'};
    delete hero.avatarUrl; delete hero.equipment; delete hero.fallbackReason;
    hero.xp=int(hero.xp,0,xpForLevel(50)); hero.level=levelForXp(hero.xp);
    if (!activeJob(hero)) delete hero.job;
    hero.skillPoints=int(hero.skillPoints,0,150);
    hero.learnedSkills=[...new Set((hero.learnedSkills || []).filter(id=>skillById(id) && !skillById(id).itemSkill))];
    if (!hero.learnedSkills.includes(SKILLS[hero.role][0].id)) hero.learnedSkills.push(SKILLS[hero.role][0].id);
    const gifts=[...new Set((hero.giftSkills || []).filter(id=>Object.values(ITEMS).some(item=>item.giftSkill===id)))];
    if(gifts.length)hero.giftSkills=gifts;else delete hero.giftSkills;
    const oldInventory=hero.inventory || [],inventory=new Map(),ids=new Map();
    oldInventory.filter(i=>i && itemById(i.itemId) && i.quantity>0).forEach(i=>{
      const sockets=socketsFor(i),versioned=socketable(itemById(i.itemId)) && i.socketVersion===1;
      const filled=sockets.some(Boolean),instance=filled || versioned && /^runed:[a-zA-Z0-9_-]{8,100}$/.test(i.id);
      const id=instance?i.id:'bag:'+i.itemId+(versioned?':s'+sockets.length:'');
      const existing=inventory.get(id);ids.set(i.id,id);
      inventory.set(id,{id,itemId:i.itemId,quantity:instance?1:int((existing?.quantity || 0)+int(i.quantity,1,999),1,999),
        ...(versioned?{socketVersion:1,sockets}:{})});
    });
    hero.inventory=[...inventory.values()];
    if (hero.loadout && typeof hero.loadout==='object') hero.loadout=Object.fromEntries(Object.entries(hero.loadout).map(([slot,id])=>[slot,ids.get(id)||id]));
    hero.equipped=ids.get(hero.equipped) || hero.equipped;syncLoadout(hero);hero.loadoutVersion=1;
    hero.cooldowns=hero.cooldowns || {}; hero.shield=int(hero.shield,0,5000);
    const hp=hero.hp,mp=hero.mp;refreshStats(hero);
    if (Number.isFinite(hp)) hero.hp=int(hp,0,hero.stats.maxHp);
    if (Number.isFinite(mp)) hero.mp=int(mp,0,hero.stats.maxMp);
    return hero;
  }
  function configureHero(input, action) {
    const hero=cleanHero(input,input), hpBefore=hero.hp;
    if (action.command==='appearance') {
      if (action.gender!=='male' && action.gender!=='female') fail('Choose a male or female hero appearance.');
      hero.gender=action.gender;
      return hero;
    } else if (action.command==='learn') {
      const result=canLearn(hero,action.skillId); if (!result.ok) fail(result.reason);
      hero.learnedSkills.push(action.skillId); hero.skillPoints-=skillById(action.skillId).cost;
    } else if (action.command==='class') {
      if (!ROLES[action.role] && action.role!=='healer') fail('Choose Warrior, Ranger, Mage or Cleric.');
      hero.role=roleKey(action.role);
      if (!activeJob(hero)) delete hero.job;
      const starter=SKILLS[hero.role][0].id; if (!hero.learnedSkills.includes(starter)) hero.learnedSkills.push(starter);
    } else if (action.command==='advance') {
      const result=canAdvance(hero,action.jobId); if (!result.ok) fail(result.reason);
      hero.job=action.jobId;
      const starter=JOB_SKILLS[hero.job][0].id; if (!hero.learnedSkills.includes(starter)) hero.learnedSkills.push(starter);
    } else if (action.command==='equip') {
      if (action.slot!==undefined && !SLOT_KEYS.includes(action.slot)) fail('Choose a valid equipment slot.');
      if (action.itemId===null || action.itemId==='') {
        if (action.slot) delete hero.loadout[action.slot]; else hero.loadout={};
        hero.equipped=null;
      }
      else {
        const entry=hero.inventory.find(i=>i.id===action.itemId && i.quantity>0), item=entry && itemById(entry.itemId);
        const assigned=equipmentSlot(item);
        if (!assigned) fail('Choose equipment or a pet from this hero’s inventory.');
        const slot=action.slot || assigned;
        if (!equipmentFits(item,slot)) fail('That item does not fit this equipment slot.');
        const used=Object.entries(hero.loadout).filter(([key,id])=>key!==slot && id===entry.id).length;
        if (used>=entry.quantity) fail('Each equipped item must be owned by this hero.');
        hero.loadout[slot]=entry.id;hero.equipped=entry.id;
      }
      syncLoadout(hero);
    } else if (action.command==='socket' || action.command==='unsocket') configureSockets(hero,action);
    else fail('Unknown hero command.');
    refreshStats(hero);
    if (action.command==='class' || action.command==='equip' || action.command==='advance' || action.command==='socket' || action.command==='unsocket') hero.hp=Math.min(hpBefore,hero.stats.maxHp);
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
  function grantAssistXp(input,amount) {
    if (!Number.isSafeInteger(amount) || amount<1 || amount>1000) fail('Invalid assist experience.');
    const hero=cleanHero(input,input); addXp(hero,amount); return hero;
  }
  function autoEquip(hero) {
    syncLoadout(hero);
    const ranks=Object.keys(RARITIES), rank=entry=>{const item=itemById(entry.itemId);return equipmentSlot(item)?ranks.indexOf(item.rarity):-1;};
    const equipment=(hero.inventory || []).filter(e=>e.quantity>0 && rank(e)>=0);
    const changed=[],hp=hero.hp,mp=hero.mp;
    SLOT_KEYS.forEach(slot=>{
      let best=equipment.find(e=>e.id===hero.loadout[slot]) || null;
      // Stable inventory order preserves an existing item on rarity ties.
      equipment.filter(e=>equipmentFits(itemById(e.itemId),slot) && Object.entries(hero.loadout).filter(([key,id])=>key!==slot && id===e.id).length<e.quantity).forEach(entry=>{if (!best || rank(entry)>rank(best)) best=entry;});
      if (best && best.id!==hero.loadout[slot]) {hero.loadout[slot]=best.id;hero.equipped=best.id;changed.push(best.itemId);}
    });
    if (!changed.length) return null;
    syncLoadout(hero);refreshStats(hero);
    hero.hp=Math.min(hp,hero.stats.maxHp);hero.mp=Math.min(mp,hero.stats.maxMp);
    return changed[changed.length-1];
  }
  function availableSkills(hero) { return skillsFor(hero).filter(s=>activeSkill(hero,s) && !s.passive && (s.itemSkill || (hero.learnedSkills || []).includes(s.id))); }
  function canLearn(hero, id) {
    const skill=skillById(id);
    if (!skill || skill.itemSkill || skill.role!==hero.role || (skill.job && activeJob(hero)?.id!==skill.job)) return {ok:false,reason:'Choose a skill from this hero’s active class or advanced job.'};
    if ((hero.learnedSkills || []).includes(id)) return {ok:false,reason:'Already learned.'};
    if (hero.level<skill.level) return {ok:false,reason:'Requires level '+skill.level+'.'};
    const missing=skill.requires.filter(required=>!(hero.learnedSkills || []).includes(required));
    if (missing.length) return {ok:false,reason:'Requires '+missing.map(id=>skillById(id)?.name || id).join(' + ')+'.'};
    if (hero.skillPoints<skill.cost) return {ok:false,reason:'Requires '+skill.cost+' skill points.'};
    return {ok:true,reason:''};
  }
  function timingMultiplier(position) { return .55+clamp(position,0,1)*1.45; }
  function rollReward(encounterId,heroId,boss,xpScale=1) {
    const seed=encounterId+':'+heroId, roll=randomUnit(seed+':rarity')*100;
    let sum=0, rarity='mythical';
    for (const key of Object.keys(RARITIES)) { sum+=RARITIES[key].weight; if (roll<sum) {rarity=key; break;} }
    const pool=Object.values(ITEMS).filter(i=>i.rarity===rarity), item=pool[Math.floor(randomUnit(seed+':item')*pool.length)];
    return {heroId,itemId:item.id,instanceId:seed,rarity,name:item.name,description:item.description,...(socketable(item)?{sockets:socketRoll(seed,item)}:{}),xp:Math.round((boss.rewardXp || 65)*(Number.isFinite(xpScale) && xpScale>1?xpScale:1))};
  }
  function awardLoot(state,event) {
    if (state.lootAwarded) return;
    state.lootAwarded=true;
    state.rewards=state.heroes.map(hero=>{
      const reward=rollReward(state.encounterId,hero.id,bossById(state.bossId),enemyScale(state).xp);
      addInventory(hero,reward.itemId,1,reward.sockets);
      addXp(hero,reward.xp);
      const equipped=autoEquip(hero); if (equipped) {reward.autoEquipped=equipped;reward.autoEquippedName=itemById(equipped).name;}
      return reward;
    });
    // The rare roadside chest adds one guaranteed rare-or-better item per hero.
    // It is inside the same immutable victory receipt as ordinary treasure.
    if (state.adventure?.kind==='chest') state.heroes.forEach(hero=>{
      const seed=state.encounterId+':'+hero.id+':road-chest',pool=Object.values(ITEMS).filter(i=>['rare','epic','legendary','mythical'].includes(i.rarity));
      const item=pool[Math.floor(randomUnit(seed)*pool.length)],sockets=socketRoll(seed,item);
      addInventory(hero,item.id,1,sockets);
      const reward={heroId:hero.id,itemId:item.id,instanceId:seed,rarity:item.rarity,name:item.name,description:item.description,...(sockets?{sockets}:{}),xp:0,source:'road-chest'};
      const equipped=autoEquip(hero);if(equipped){reward.autoEquipped=equipped;reward.autoEquippedName=itemById(equipped).name;}
      state.rewards.push(reward);
    });
    state.heroes.forEach(hero=>{
      const seed=state.encounterId+':'+hero.id+':bonus-rune';
      if(randomUnit(seed+':drop')>=RUNE_BONUS_CHANCE)return;
      const rarityRoll=randomUnit(seed+':rarity')*100;let sum=0,rarity='common';
      for(const key of Object.keys(RARITIES)){sum+=RARITIES[key].weight;if(rarityRoll<sum){rarity=key;break;}}
      const pool=Object.values(ITEMS).filter(i=>i.type==='rune' && i.rarity===rarity),item=pool[Math.floor(randomUnit(seed+':item')*pool.length)];
      addInventory(hero,item.id);
      state.rewards.push({heroId:hero.id,itemId:item.id,instanceId:seed,rarity:item.rarity,name:item.name,description:item.description,xp:0,source:'bonus-rune'});
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
  function restoreMana(hero,amount) { const before=hero.mp; hero.mp=int(hero.mp+amount,0,hero.stats.maxMp); return hero.mp-before; }
  function support(state,hero,effect,event,target,points=1) {
    const scaled=amount=>Math.round(amount)*points;
    const boost=1+hero.stats.healing/200;
    const supported=(h,type,amount)=>{if(amount>0)(event.supported || (event.supported=[])).push({heroId:h.id,effect:type,amount});};
    const afflicted=(type,amount)=>{if(amount>0)(event.afflicted || (event.afflicted=[])).push({effect:type,amount});};
    const shield=(h,amount)=>{const before=h.shield;h.shield=Math.min(h.stats.maxHp,h.shield+amount);supported(h,'shield',h.shield-before);};
    if (effect.heal) heal(target,scaled(target.stats.maxHp*effect.heal),event);
    if (effect.healAll) combatHeroes(state).forEach(h=>heal(h,scaled(h.stats.maxHp*effect.healAll*boost),event));
    if (effect.mana) supported(target,'mana',restoreMana(target,scaled(effect.mana)));
    if (effect.manaAll) combatHeroes(state).forEach(h=>supported(h,'mana',restoreMana(h,scaled(effect.manaAll))));
    if (effect.shield) combatHeroes(state).forEach(h=>shield(h,scaled(h.stats.maxHp*effect.shield)));
    if (effect.shieldSelf) shield(hero,scaled(hero.stats.maxHp*effect.shieldSelf));
    if (effect.cleanse) (effect.healAll?combatHeroes(state):[target]).forEach(h=>{if(h.weakened)supported(h,'cleanse',1);h.weakened=false;});
    if (effect.weakenBoss) {const before=state.bossWeakness || 0;state.bossWeakness=Math.max(before,effect.weakenBoss);afflicted('weaken',state.bossWeakness-before);}
    if (effect.poison) {state.poison={turns:effect.poison,damage:Math.min(enemyScale(state).poisonCap,scaled(hero.stats.damage*.35)),heroId:hero.id,...(state.enemies?{enemyIds:event.enemyTargets?.map(t=>t.enemyId) || enemiesFor(state).filter(e=>e.hp>0).map(e=>e.id)}:{})};afflicted('poison',state.poison.damage);}
    if (effect.expose) Object.entries(effect.expose).forEach(([channel,value])=>{
      if (!['physical','elemental'].includes(channel)) return;
      const before=state.exposures[channel] || {amount:0,turns:0};
      const amount=Math.max(before.amount,clamp(value.amount,0,.5)),turns=Math.max(before.turns,int(value.turns,1,6));
      state.exposures[channel]={amount,turns,heroId:!before.heroId || clamp(value.amount,0,.5)>=before.amount?hero.id:before.heroId};
      if(amount>before.amount || turns>before.turns)(event.afflicted || (event.afflicted=[])).push({effect:channel+' defence break',amount,turns,heroId:hero.id});
    });
    if (effect.haste) combatHeroes(state).forEach(h=>{let turns=0;Object.keys(h.cooldowns).forEach(id=>{if(h.id!==hero.id || id!==event.skillId){const before=h.cooldowns[id];h.cooldowns[id]=Math.max(0,before-effect.haste);turns+=before-h.cooldowns[id];}});supported(h,'haste',turns);});
  }
  function relicSupport(state,hero,gear,effect,event) {
    support(state,hero,{shieldSelf:gear.selfWard || 0},event,hero);
    if(gear.selfHaste){let turns=0;Object.keys(hero.cooldowns).forEach(id=>{if(id!==event.skillId){const before=hero.cooldowns[id];hero.cooldowns[id]=Math.max(0,before-gear.selfHaste);turns+=before-hero.cooldowns[id];}});
      if(turns)(event.supported || (event.supported=[])).push({heroId:hero.id,effect:'haste',amount:turns});}
    if (!event.damage) return;
    const weaken=Math.min(.35,gear.frost || 0);
    if(weaken)support(state,hero,{weakenBoss:weaken},event,hero);
    if(gear.elementalBreak)support(state,hero,{expose:{elemental:{amount:gear.elementalBreak,turns:2}}},event,hero);
    state.ailments=state.ailments || {};
    for(const [type,amount] of [['burn',Math.max(gear.burn || 0,effect.burn || 0)],['venom',gear.venom || 0]]) {
      if(!amount)continue;
      const prior=state.ailments[type],damage=Math.min(enemyScale(state).poisonCap,Math.max(1,Math.round(hero.stats.damage*amount)));
      state.ailments[type]={turns:Math.max(prior?.turns || 0,3),damage:Math.max(prior?.damage || 0,damage),heroId:!prior || damage>=prior.damage?hero.id:prior.heroId,...(state.enemies?{enemyIds:event.enemyTargets?.map(t=>t.enemyId) || []}:{})};
      (event.afflicted || (event.afflicted=[])).push({effect:type,amount:damage});
    }
  }
  // Preserve the progress of an existing fight while applying this balance
  // change once. A living enemy keeps at least 1 HP when halving odd values.
  function rebalanceEnemyHealth(previous) {
    if (!previous || previous.status!=='active' || previous.enemyHealthVersion>=ENEMY_HEALTH_VERSION) return previous;
    if (!Number.isFinite(previous.bossMaxHp) || previous.bossMaxHp<=0) return previous;
    const state=copy(previous);
    state.bossMaxHp=Math.max(1,Math.ceil(previous.bossMaxHp/2));
    state.bossHp=int(Math.ceil(previous.bossHp/2),0,state.bossMaxHp);
    state.enemyHealthVersion=ENEMY_HEALTH_VERSION;
    return state;
  }
  function normalizeState(previous) {
    const state=copy(rebalanceEnemyHealth(previous)), migrated=new Map();
    function migrate(hero) {
      if (hero.studentId) { const id='student:'+hero.studentId; migrated.set(hero.id,id); hero.id=id; }
      hero.gender=hero.gender==='female'?'female':'male';
      return hero;
    }
    state.heroes=state.heroes.map(migrate);
    state.heroArchive=Object.fromEntries(Object.values(state.heroArchive || {}).map(h=>{migrate(h);return [h.id,h];}));
    const identity=id=>migrated.get(id) || id;
    if(state.teamHeroIds){state.teamHeroIds=state.teamHeroIds.map(identity).filter(id=>state.heroes.some(h=>h.id===id));if(state.teamHeroIds.length<Math.min(state.teamSize,state.heroes.length))setTeam(state,state.pending?.heroId || state.teamHeroIds[0] || state.heroes[0]?.id);}
    if (state.pending) state.pending.heroId=identity(state.pending.heroId);
    if (state.poison) state.poison.heroId=identity(state.poison.heroId);
    (state.rewards || []).forEach(r=>{r.heroId=identity(r.heroId);});
    if (state.lastEvent) {
      if (state.lastEvent.heroId) state.lastEvent.heroId=identity(state.lastEvent.heroId);
      ['targets','healed','supported','rewards'].forEach(key=>(state.lastEvent[key] || []).forEach(e=>{e.heroId=identity(e.heroId);}));
    }
    if (!state.heroes.every(h=>h.progressionVersion===1 && h.loadoutVersion===1)) {
      state.heroes=state.heroes.map(h=>{
        const next=cleanHero(h,h);
        if (h.progressionVersion!==1) next.hp=h.hp<=0?0:int(next.stats.maxHp*(h.hp/h.stats.maxHp),1,next.stats.maxHp);
        return next;
      });
    }
    state.heroArchive=Object.fromEntries(Object.entries(state.heroArchive || {}).map(([id,h])=>[id,h.loadoutVersion===1?h:cleanHero(h,h)]));
    state.bossRotation=bossRotationFor(state);
    state.heroArchive=state.heroArchive || {}; state.rewards=state.rewards || [];state.combatLog=(state.combatLog || []).slice(-40);
    if (state.lootAwarded===undefined) state.lootAwarded=state.status!=='active';
    state.bossWeakness=state.bossWeakness || 0; state.poison=state.poison || null;
    state.exposures=state.exposures || {};state.ailments=state.ailments || {};
    state.bossMaxMp=BOSS_MAX_MP;state.bossMp=state.bossMp===undefined?BOSS_MAX_MP:int(state.bossMp,0,BOSS_MAX_MP);
    return state;
  }
  // Pick only learned, affordable, ready skills. Support becomes valuable when
  // allies need it; otherwise a normal attack restores MP instead of wasting it.
  function chooseAutoCommand(state, hero) {
    const hurt=combatHeroes(state).filter(h=>h.hp/h.stats.maxHp<.7), fallen=combatHeroes(state).filter(h=>h.hp<=0);
    const patient=[...combatHeroes(state)].sort((a,b)=>a.hp/a.stats.maxHp-b.hp/b.stats.maxHp)[0] || hero;
    const candidates=availableSkills(hero).filter(s=>hero.mp>=s.mpCost && !(hero.cooldowns[s.id]>0));
    const rated=candidates.map(skill=>{
      const e=skill.effect;
      let score=(e.power || 0)+(e.damage || 0)/Math.max(1,hero.stats.damage);
      if(skill.damageTarget==='aoe') score*=Math.max(1,enemiesFor(state).filter(e=>e.hp>0).length)*.85;
      if (e.guaranteedCrit) score*=hero.stats.critMultiplier;
      score+=(e.pierce || 0)*.3;
      if (e.healAll && hurt.length) score+=4+e.healAll*3+fallen.length*2+Math.max(0,hurt.length-1)*3;
      if (e.heal && patient.hp/patient.stats.maxHp<.7) score+=4+e.heal*3;
      if (e.shield && combatHeroes(state).some(h=>h.hp>0 && h.shield<h.stats.maxHp*.1)) score+=1+e.shield;
      if (e.weakenBoss) score+=e.weakenBoss;
      if (e.poison && !state.poison) score+=.3;
      const build=buildFor(hero),channel=damageTypeFor(hero,skill)==='physical'?'physical':'elemental';
      score*=1+build[channel+'Bonus'];
      if (state.exposures[channel]?.turns>0) score*=1+state.exposures[channel].amount+build.exposureBonus;
      if (e.expose) Object.entries(e.expose).forEach(([type,value])=>{
        const ready=combatHeroes(state).filter(h=>h.hp>0 && h.id!==hero.id && (availableSkills(h).some(s=>damageTypeFor(h,s)==='physical'?type==='physical':type==='elemental') || (buildFor(h).basicType==='physical'?type==='physical':type==='elemental'))).length;
        if(ready && (!state.exposures[type] || state.exposures[type].turns<=1))score+=2+Math.min(3,ready)*value.amount;
      });
      return {skill,score};
    }).sort((a,b)=>b.score-a.score || a.skill.id.localeCompare(b.skill.id));
    return rated.length && rated[0].score>1 ? {command:'skill',skillId:rated[0].skill.id,targetId:patient.id} : {command:'attack'};
  }
  function autoTurn(previous, action) {
    if (typeof action.spinId!=='string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(action.spinId)) fail('Quick fights require the saved wheel spin ID.');
    if (!Number.isSafeInteger(action.points) || action.points<1 || action.points>10000) fail('Award between 1 and 10000 whole points to start a Quick fight.');
    if (previous && previous.lastAutoAwardId===action.id) return previous;
    if (previous && previous.pending) fail('Finish the manual battle answer before using Quick fight.');
    if (previous && action.expectedRevision!==previous.revision) fail('The encounter changed on another screen. Try awarding points again.');
    let state=previous?normalizeState(previous):null;
    if (!state || state.status!=='active') {
      state=reduce(state,{type:'start',id:action.id,spinId:action.spinId,expectedRevision:state && state.revision,heroes:action.heroes,bossId:action.bossId,formation:action.formation});
    } else if (action.encounterId!==state.encounterId) fail('This encounter has changed. Reload its latest progress.');
    if (Array.isArray(action.heroes) && action.heroes.length) {
      const fresh=roster(action.heroes,state); state.heroArchive=archiveFor(state,fresh); state.heroes=fresh;
    }
    const hero=state.heroes.find(h=>h.id===action.heroId);
    if (!hero) fail('This student is no longer in the encounter. Open Battle to refresh the party.');
    setTeam(state,hero.id);
    const command=chooseAutoCommand(state,hero);
    state.pending={id:action.spinId,heroId:hero.id};
    state=apply(state,{...command,type:'answer',id:action.id,encounterId:state.encounterId,turnId:action.spinId,outcome:'correct'},action.points);
    const heroEvent=state.lastEvent;
    let enemyEvent=null;
    if (state.status==='active') {
      const boss=bossById(state.bossId);
      state=reduce(state,{type:'boss',id:action.id,encounterId:state.encounterId,expectedRevision:state.revision,
        ultimate:state.charge>=boss.chargeMax && state.bossMp>=BOSS_SKILL_MP,timing:randomUnit(state.encounterId+':'+action.spinId+':boss')*.75});
      enemyEvent=state.lastEvent;
    }
    state.revision=(previous && previous.revision || 0)+1;
    state.actionCount=(previous && previous.status==='active'?previous.actionCount:0)+1;
    // One awarded answer earns one turn and one XP grant, regardless of its points.
    state.lastAutoAwardId=action.id;
    state.lastAutoSpinId=action.spinId;
    state.lastEvent={...heroEvent,id:action.id,type:'auto',outcome:state.status,spinId:action.spinId,points:action.points,enemy:enemyEvent,
      targets:[...(heroEvent.targets || []),...(enemyEvent && enemyEvent.targets || [])],
      healed:[...(heroEvent.healed || []),...(enemyEvent && enemyEvent.healed || [])],rewards:state.status==='victory'?state.rewards:[]};
    return state;
  }
  function heroAction(state,hero,action,event,points) {
    let effect={power:1}, skill=null, itemEntry=null;
    const gear=equipmentEffect(hero), target=action.targetId?state.heroes.find(h=>h.id===action.targetId):hero;
    if (!target || state.teamSize>1 && !combatHeroes(state).some(h=>h.id===target.id)) fail('Choose a teammate in this encounter.');
    if (event.command==='skill') {
      skill=skillById(action.skillId);
      if (!activeSkill(hero,skill) || skill.passive || (!skill.itemSkill && !hero.learnedSkills.includes(skill.id))) fail('Learn that active skill first.');
      if ((hero.cooldowns[skill.id] || 0)>0) fail('That skill is cooling down. Use another command.');
      if (hero.mp<skill.mpCost) fail('Not enough MP. Attack to recover MP or use an Ether.');
      effect=skill.effect; event.skillId=skill.id; event.move=skill.name;
    } else if (event.command==='item') {
      itemEntry=hero.inventory.find(i=>i.id===action.itemId && i.quantity>0);
      const item=itemEntry && itemById(itemEntry.itemId);
      if (!item || item.type!=='consumable') fail('Choose a consumable from this hero’s inventory.');
      if(item.giftSkill && (hero.giftSkills || []).includes(item.giftSkill)) fail('This hero already knows that unique gift. Save it for another adventure.');
      effect=item.effect; event.itemId=item.id; event.move=item.name;
      if(item.giftSkill){hero.giftSkills=[...(hero.giftSkills || []),item.giftSkill];refreshStats(hero);event.giftSkill=item.giftSkill;}
    } else if (event.command!=='attack') fail('Choose Attack, Skills or Items.');
    if (hero.hp<=0) heal(hero,hero.stats.maxHp*.25,event);
    Object.keys(hero.cooldowns).forEach(id=>{hero.cooldowns[id]=Math.max(0,hero.cooldowns[id]-1);});
    if (skill) {hero.mp-=skill.mpCost;hero.cooldowns[skill.id]=skill.cooldown;}
    if (itemEntry) {itemEntry.quantity--;hero.inventory=hero.inventory.filter(i=>i.quantity>0);}
    const restore=(h,amount)=>{const actual=restoreMana(h,amount);if(actual>0)(event.supported||(event.supported=[])).push({heroId:h.id,effect:'mana',amount:actual});};
    if (event.command==='attack') restore(hero,10);
    restore(hero,gear.manaRegen || 0);
    if (effect.power || effect.damage) {
      const living=enemiesFor(state).filter(e=>e.hp>0);
      const chosen=action.enemyTargetId?living.find(e=>e.id===action.enemyTargetId):living[0];
      if(!chosen)fail('Choose a living enemy in this encounter.');
      const enemyTargets=skill?.damageTarget==='aoe'?living:[chosen];
      event.enemyTargets=[];
      const exposures=copy(state.exposures);
      for(const enemy of enemyTargets){
        const boss=bossById(enemy.bossId);

        event.critical=!!effect.power && (!!effect.guaranteedCrit || randomUnit(state.encounterId+':'+action.turnId)<hero.stats.critChance);
        const scale=enemyScale(state),build=buildFor(hero),damageType=damageTypeFor(hero,skill),channel=damageType==='physical'?'physical':'elemental';
        const exposure=exposures[channel],broken=!!(exposure && exposure.turns>0);
        const armour=Math.max(-.5,(boss.defence+scale.armour)*(1-Math.max(effect.pierce || 0,gear.pierce || 0,Math.min(.75,build[channel+'Pierce'])))-(broken?exposure.amount:0));
        const echo=gear.echo && (hero.correctActions+1)%3===0?2:1;
        const raw=(effect.damage || hero.stats.damage*effect.power*(event.critical?hero.stats.critMultiplier:1)*(1-armour)*(hero.weakened?.7:1)*(state.guard && !gear.ignoreGuard?.6:1))*echo*(1+build[channel+'Bonus'])*(broken?1+build.exposureBonus:1);
        event.damageType=damageType;event.infused=event.command==='attack' && !!weaponElement(hero);event.synergy=broken?{channel,amount:exposure.amount,sourceHeroId:exposure.heroId}:null;

        const dealt=Math.max(1,Math.round(raw))*points;
        const hitCap=state.enemies?Math.max(1,Math.round(enemy.maxHp*ENEMY_SCALING.hitShare)):scale.hitCap;
        const damage=hitEnemy(state,enemy,Math.min(dealt,hitCap));event.damage+=damage;event.echo=echo===2;
        event.enemyTargets.push({enemyId:enemy.id,damage});
        if (dealt>hitCap && damage===hitCap) event.capped=true;

        if (effect.leech || gear.leech) heal(hero,damage*((effect.leech || 0)+(gear.leech || 0)),event);
        if (boss.playstyle==='reflect' && (state.enemies?enemy.hp:state.bossHp)>0) {
          const reflected=Math.min(hero.hp,Math.max(1,Math.round(damage*.12)));
          hero.hp-=reflected;event.targets.push({heroId:hero.id,damage:reflected});event.effect='reflect';
        }
      }
      if (gear.teamLeech) combatHeroes(state).forEach(h=>heal(h,Math.round(h.stats.maxHp*gear.teamLeech)*points,event));
      if (gear.teamMana) combatHeroes(state).forEach(h=>restore(h,gear.teamMana*points));
      hero.correctActions++;state.guard=false;
      Object.keys(state.exposures).forEach(key=>{if(--state.exposures[key].turns<=0)delete state.exposures[key];});
    }
    support(state,hero,effect,event,target,points);
    relicSupport(state,hero,gear,effect,event);
    adventureDiscovery(state,hero,event);
    hero.weakened=false; addXp(hero,12);
  }
  function apply(previous,action,points=1) {
    if (!action || typeof action.id!=='string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(action.id)) fail('Invalid battle action.');
    const event={id:action.id,type:action.type,healed:[],targets:[]};
    if (action.type==='auto') return autoTurn(previous,action);
    if (action.type==='start') {
      if (previous?.encounterId===action.id) return previous;
      if (previous && action.expectedRevision!==previous.revision) fail('The class changed on another screen. Try again.');
      const heroes=roster(action.heroes,previous && normalizeState(previous)), boss=nextBoss(previous,action.spinId || action.id);
      heroes.forEach(h=>{h.hp=h.stats.maxHp;h.mp=h.stats.maxMp;h.cooldowns={};h.shield=0;h.weakened=false;h.mythicalUsed=false;h.correctActions=0;});
      const adventure=adventureFor(previous,action.spinId || action.id);
      const enemyLevel=enemyLevelFor(heroes),scale=enemyScale({enemyScalingVersion:ENEMY_SCALING_VERSION,enemyLevel,adventure});
      const bossMaxHp=Math.max(1,Math.ceil(Math.round(Math.round(Math.max(200,heroes.reduce((sum,h)=>sum+h.stats.damage,0)*4)*boss.hpMultiplier)*scale.hp)/2));
      return startFormation({schemaVersion:1,encounterId:action.id,revision:(previous && previous.revision || 0)+1,
        enemyHealthVersion:ENEMY_HEALTH_VERSION,enemyScalingVersion:ENEMY_SCALING_VERSION,enemyLevel,bossRotation:rotationAfterStart(previous,boss),adventure,exposures:{},
        bossId:boss.id,bossHp:bossMaxHp,bossMaxHp,bossMp:BOSS_MAX_MP,bossMaxMp:BOSS_MAX_MP,charge:0,heroes,heroArchive:archiveFor(previous,heroes),pending:null,status:'active',
        bossTurns:0,actionCount:1,correctCount:0,guard:false,bossWeakness:0,poison:null,ailments:{},exposures:{},rewards:[],lootAwarded:false,lastEvent:event,combatLog:copy(previous?.combatLog || []).slice(-40)},previous,action.spinId || action.id,action.formation);
    }
    if (!previous || action.encounterId!==previous.encounterId) fail('This encounter has changed. Reload its latest progress.');
    const state=normalizeState(previous), boss=bossById(state.bossId);
    if (action.type==='sync') {
      if (action.expectedRevision!==state.revision) fail('The class changed on another screen. Try again.');
      if (action.command) {
        if (action.command==='advance' && state.status==='active') fail('End the active encounter before changing advanced jobs.');
        if (state.pending && action.command!=='appearance') fail('Resolve the selected answer before changing a hero.');
        const hero=state.heroes.find(h=>h.id===action.heroId);
        if (!hero) fail('This student is no longer in the class.');
        state.heroes[state.heroes.indexOf(hero)]=configureHero(hero,action);
        event.command=action.command; event.heroId=hero.id;
      } else {
        const fresh=roster(action.heroes,state);
        state.heroArchive=archiveFor(state,fresh); state.heroes=fresh;
        if(state.teamSize>1)setTeam(state,state.pending?.heroId || state.teamHeroIds?.find(id=>fresh.some(h=>h.id===id)) || fresh[0].id);
        if (state.pending && !state.heroes.some(h=>h.id===state.pending.heroId)) state.pending=null;
        if (state.enemyHealthVersion===previous.enemyHealthVersion && JSON.stringify(state.bossRotation)===JSON.stringify(previous.bossRotation) && JSON.stringify(state.heroes)===JSON.stringify(previous.heroes) && JSON.stringify(state.pending)===JSON.stringify(previous.pending)) return previous;
      }
      if (action.command!=='appearance' && state.status==='active' && state.heroes.every(h=>h.hp<=0)) {state.status='defeat';state.pending=null;}
      state.revision++; if (action.command!=='appearance') state.lastEvent=event; return state;
    }
    if (action.type==='end') {
      if (action.expectedRevision!==state.revision) fail('The encounter changed. Try again.');
      state.status='defeat'; state.pending=null; state.revision++; state.lastEvent=event; return state;
    }
    if (state.status!=='active') fail('Encounter finished. Start a new encounter to play again.');
    if (action.type==='summon') {
      if (action.expectedRevision!==state.revision) fail('The encounter changed. Try the summon again.');
      if (!['reward','teacher'].includes(action.source)) fail('Choose a class summon reward or teacher help.');
      Object.assign(event,{actorName:'One-Punch Chung',move:'One Huge Punch',damage:state.bossHp,source:action.source,outcome:'victory'});
      if(state.enemies)state.enemies.forEach(e=>{e.hp=0;});state.bossHp=0;state.pending=null;return finish(state,event);
    }
    if (action.type==='select') {
      if (state.pending) fail('Resolve the selected answer before spinning again.');
      if (action.expectedRevision!==state.revision) fail('The class changed on another screen. Spin again.');
      const hero=state.heroes.find(h=>h.id===action.heroId); if (!hero) fail('This student is no longer in the class.');
      setTeam(state,hero.id);
      state.pending={id:action.turnId || action.id,heroId:hero.id}; event.heroId=hero.id; return finish(state,event);
    }
    if (action.type==='answer') {
      if (!state.pending || action.turnId!==state.pending.id) fail('This answer was already resolved or belongs to an older turn.');
      if (!['correct','incorrect','skip'].includes(action.outcome)) fail('Choose Correct, Incorrect or Skip.');
      const hero=state.heroes.find(h=>h.id===state.pending.heroId);
      Object.assign(event,{heroId:hero.id,role:hero.role,job:hero.job || null,outcome:action.outcome,damage:0,critical:false,command:action.command || 'attack'});
      if (action.outcome==='correct') {
        setTeam(state,hero.id);
        heroAction(state,hero,action,event,points);
        if(state.teamSize>1){
          const actions=[copy(event)];
          for(const ally of combatHeroes(state).filter(h=>h.id!==hero.id && h.hp>0)){
            if(state.bossHp<=0)break;
            const command=chooseAutoCommand(state,ally),part={id:action.id,type:'answer',outcome:'correct',heroId:ally.id,role:ally.role,job:ally.job || null,command:command.command,damage:0,critical:false,healed:[],targets:[]};
            heroAction(state,ally,{...action,...command,turnId:action.turnId+':'+ally.id,enemyTargetId:undefined},part,1);actions.push(part);
            event.damage+=part.damage;event.healed.push(...part.healed);event.targets.push(...part.targets);
            for(const key of ['supported','afflicted'])if(part[key])event[key]=[...(event[key] || []),...part[key]];
          }
          event.actions=actions;event.actorName=actions.map(a=>state.heroes.find(h=>h.id===a.heroId).name).join(' + ');event.move='Team attack';
        }
        state.correctCount++;
      }
      state.pending=null; return finish(state,event);
    }
    if (action.type==='boss') {
      if (action.expectedRevision!==state.revision) fail('That boss turn already changed. Check the latest health before attacking again.');
      if (state.pending) fail('Resolve the selected answer before the boss turn.');
      const ultimate=!!action.ultimate;
      if (ultimate && state.charge<boss.chargeMax) fail('The ultimate is not charged yet.');
      if (ultimate && state.bossMp<BOSS_SKILL_MP) fail('Not enough enemy MP. Use a normal attack to recover MP.');
      if (!ultimate && state.charge>=boss.chargeMax && state.bossMp>=BOSS_SKILL_MP) fail('Ultimate is ready. Trigger it before another normal attack.');
      if (action.timing!==undefined && (!Number.isFinite(action.timing) || action.timing<0 || action.timing>1)) fail('Stop the timing meter inside the bar.');
      const timing=action.timing===undefined?.5:action.timing, multiplier=timingMultiplier(timing);
      const manaBefore=state.bossMp;state.bossMp=ultimate?state.bossMp-BOSS_SKILL_MP:Math.min(BOSS_MAX_MP,state.bossMp+BOSS_ATTACK_MP);
      const living=combatHeroes(state).filter(h=>h.hp>0);
      const attackers=enemiesFor(state).filter(e=>e.hp>0);
      if(!living.length)fail('Call a standing hero before the enemy team attacks.');
      Object.assign(event,{ultimate,manaBefore,manaAfter:state.bossMp,manaCost:ultimate?BOSS_SKILL_MP:0,manaRestored:ultimate?0:state.bossMp-manaBefore,move:ultimate?boss.ultimateName:boss.attackName,effect:boss.playstyle,timing,multiplier,zone:timing>=.85?'red':timing>=.55?'orange':'black'});
      if(state.enemies)event.actions=[];
      for(const [index,enemy] of attackers.entries()){
        const boss=bossById(enemy.bossId),focus=living[(state.bossTurns+index)%living.length];
        const aoe=ultimate || boss.playstyle==='splash' || state.teamSize>1 && (state.bossTurns+index)%2===1;
        const targets=aoe?living:[focus],part={enemyId:enemy.id,move:ultimate?boss.ultimateName:boss.attackName,targeting:aoe?'aoe':'single',targets:[]};
      targets.forEach(h=>{
        const scale=ultimate?1.4:aoe?.6:boss.playstyle==='splash'?.6:1;
        const raw=(18+h.stats.maxHp*.07)*boss.attackMultiplier*scale*enemyScale(state).attack/(state.teamSize || 1);
        const defence=h.stats.defence*(boss.playstyle==='pierce'?.35:1),hits=!ultimate && boss.playstyle==='swift'?2:1;
        const beforeShield=Math.max(1,Math.round(Math.max(3,raw-defence*.65)*hits*multiplier*(1-state.bossWeakness)));
        const absorbed=Math.min(h.shield,beforeShield),damage=Math.min(h.hp,beforeShield-absorbed);
        h.shield-=absorbed;h.hp-=damage;if (boss.playstyle==='weaken') h.weakened=true;
        const hit={heroId:h.id,damage,hits,absorbed,...(state.enemies?{enemyId:enemy.id}:{})};event.targets.push(hit);part.targets.push(hit);
      });
      if(state.enemies)event.actions.push(part);
      if (!ultimate && boss.playstyle==='regenerate') {const amount=Math.min(enemy.maxHp-enemy.hp,Math.round(enemy.maxHp*.025));event.bossHealed=(event.bossHealed || 0)+amount;if(state.enemies)enemy.hp+=amount;else state.bossHp+=amount;}
      if (boss.playstyle==='guard') state.guard=true;
      }
      syncEnemyHp(state);state.bossWeakness=0;
      if(state.enemies){event.move=ultimate?'Enemy team ultimate':'Enemy team attack';}
      if (state.poison && state.poison.turns>0) {
        event.poisonDamage=tickDamage(state,state.poison,enemyScale(state).poisonCap);state.poison.turns--;
        if (!state.poison.turns) state.poison=null;
      }
      let remaining=enemyScale(state).poisonCap-(event.poisonDamage || 0);
      Object.entries(state.ailments || {}).forEach(([type,ailment])=>{
        const damage=tickDamage(state,ailment,remaining);remaining-=damage;
        if(damage)(event.ailmentTicks || (event.ailmentTicks=[])).push({effect:type,amount:damage,heroId:ailment.heroId});
        if(--ailment.turns<=0)delete state.ailments[type];
      });
      state.bossTurns++;state.charge=ultimate?0:Math.min(boss.chargeMax,state.charge+1);return finish(state,event);
    }
    fail('Unknown battle action.');
  }
  // The multiplier is private: manual answer payloads cannot amplify combat.
  function combatLogEntry(state,event) {
    const names=new Map(state.heroes.map(h=>[h.id,h.name])),enemyName=bossById(state.bossId).name;
    const named=rows=>(rows || []).map(row=>({...row,name:names.get(row.heroId)||'Hero'}));
    const enemy=event.enemy?{actorName:enemyName,move:event.enemy.move,targets:named(event.enemy.targets),healed:named(event.enemy.healed),bossHealed:event.enemy.bossHealed||0,poisonDamage:event.enemy.poisonDamage||0,ailmentTicks:copy(event.enemy.ailmentTicks||[]),actions:copy(event.enemy.actions || [])}:null;
    // Auto events already combine their recipient arrays; retain only the
    // hero phase here, with the separately saved enemy reply nested below.
    const withoutEnemy=(rows,other)=>{const result=[...(rows||[])];for(const row of other||[]){const i=result.findLastIndex(x=>JSON.stringify(x)===JSON.stringify(row));if(i>=0)result.splice(i,1);}return result;};
    return {id:event.id,encounterId:state.encounterId,type:event.type,actorName:event.actorName || (event.type==='boss'?enemyName:names.get(event.heroId)||'Hero'),heroId:event.heroId||null,enemyName,
      actions:copy(event.actions || []),enemyTargets:copy(event.enemyTargets || []),move:event.move||(event.type==='answer'&&event.outcome!=='correct'?event.outcome==='skip'?'Skipped answer':'Incorrect answer':'Attack'),damage:event.damage||0,damageType:event.damageType||null,infused:!!event.infused,giftSkill:event.giftSkill||null,synergy:copy(event.synergy||null),discovery:event.discovery||null,critical:!!event.critical,outcome:event.outcome||state.status,points:event.points||null,
      targets:named(withoutEnemy(event.targets,event.enemy?.targets)),healed:named(withoutEnemy(event.healed,event.enemy?.healed)),supported:named(event.supported),afflicted:copy(event.afflicted||[]),enemy,bossHealed:event.bossHealed||0,poisonDamage:event.poisonDamage||0,ailmentTicks:copy(event.ailmentTicks||[])};
  }
  function reduce(previous,action) {
    const next=apply(previous,action);
    if(next===previous || !['answer','boss','auto','summon'].includes(action.type))return next;
    const log=(previous?.combatLog || []).filter(row=>row.id!==action.id);
    next.combatLog=[...copy(log),combatLogEntry(next,next.lastEvent)].slice(-40);return next;
  }
  return {RUNE_BONUS_CHANCE,enemiesFor,combatHeroes,targetingLabel,ROLES,BOSSES,CONTENT,SKILLS,SKILL_TREES:SKILLS,JOBS,JOB_SKILLS,JOB_TREES:JOB_SKILLS,ITEMS,RARITIES,ITEM_SKILLS,EQUIPMENT_SLOTS,socketable,socketsFor,socketRoll,addInventory,grantedSkills,weaponElement,BOSS_MAX_MP,BOSS_SKILL_MP,BOSS_ATTACK_MP,ENEMY_SCALING_VERSION,ENEMY_SCALING,enemyLevelFor,enemyScale,bossById,skillById,itemById,heroFromStudent,
    reduce,cleanHero,configureHero,normalizeState,rebalanceEnemyHealth,levelForXp,chooseAutoCommand,randomUnit,availableSkills,canLearn,canAdvance,jobsFor,skillsFor,treeSkills,grantAssistXp,autoEquip,xpForLevel,timingMultiplier,equipmentEffect,equipmentSlot,equipmentFits,loadoutFor,equippedEntries,statsFor,rollReward,nextBoss,bossRotationFor,adventureFor,ADVENTURE_RATES,ADVENTURE_BIOMES,buildFor,damageTypeFor};
});
