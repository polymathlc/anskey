/* Original pixel adventure classes, branching skills and treasure. No CER profile data. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ClassroomBattleContent = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const ROLES = {
    warrior: { name:'Warrior', icon:'⚔', description:'A durable front-line defender with crushing strikes.', hp:160, power:29, defence:9, mp:60, healing:0, crit:.08, attacks:1, color:'#f8ba68' },
    ranger: { name:'Ranger', icon:'➶', description:'Precise arrows, poison and evasive woodland tactics.', hp:118, power:27, defence:5, mp:75, healing:0, crit:.22, attacks:2, color:'#90dc9d' },
    mage: { name:'Mage', icon:'✦', description:'Elemental spells, arcane power and time magic.', hp:105, power:33, defence:3, mp:110, healing:0, crit:.1, attacks:1, color:'#b5a2ff' },
    cleric: { name:'Cleric', icon:'✚', description:'Restoration, protective wards and radiant judgement.', hp:128, power:23, defence:6, mp:100, healing:24, crit:.08, attacks:1, color:'#f3e7b6' }
  };
  const SKILLS = {};
  function branch(role, branchName, nodes) {
    const prior = [];
    nodes.forEach((n, i) => {
      const id = role + '-' + n[0];
      (SKILLS[role] || (SKILLS[role] = [])).push({ id, role, name:n[1], branch:branchName, tier:i+1,
        requires:i ? [prior[i-1]] : [], cost:i < 2 ? 1 : 2, level:i+1,
        mpCost:n[2], cooldown:n[3], description:n[4], effect:{...n[5],type:n[5].passive?'passive':'active'}, icon:n[6] || ROLES[role].icon,
        passive:!!n[5].passive });
      prior.push(id);
    });
  }
  branch('warrior','Vanguard',[
    ['power-strike','Power Strike',12,1,'A forceful strike for 165% damage.',{power:1.65}],
    ['iron-will','Iron Will',0,0,'Passive: +25 maximum HP and +4 defence.',{passive:{maxHp:25,defence:4}},'▣'],
    ['shield-wall','Shield Wall',22,3,'Strike for 80% damage and shield every ally for 20% of their HP.',{power:.8,shield:.2},'▣'],
    ['earthshatter','Earthshatter',36,3,'A 280% strike that ignores armour and weakens the next boss turn.',{power:2.8,pierce:1,weakenBoss:.3}]
  ]);
  branch('warrior','Berserker',[
    ['cleave','Cleave',14,1,'A sweeping 180% strike.',{power:1.8}],
    ['battle-fury','Battle Fury',0,0,'Passive: +7 attack and +5% critical chance.',{passive:{damage:7,critChance:.05}},'♦'],
    ['blood-oath','Blood Oath',24,2,'Deal 220% damage and recover 40% of damage dealt as HP.',{power:2.2,leech:.4}],
    ['rampage','Rampage',42,4,'Unleash a devastating 380% strike.',{power:3.8}]
  ]);
  branch('warrior','Sentinel',[
    ['rally','Rally',16,2,'Strike for 60% damage and heal every ally for 12% maximum HP.',{power:.6,healAll:.12},'✚'],
    ['fortress','Fortress',0,0,'Passive: +50 maximum HP.',{passive:{maxHp:50}},'▣'],
    ['defiant-blow','Defiant Blow',24,2,'A 210% strike and a personal 35% HP shield.',{power:2.1,shieldSelf:.35}],
    ['last-bastion','Last Bastion',40,4,'Restore the team for 25% HP and shield everyone for 30% HP.',{healAll:.25,shield:.3},'▣']
  ]);
  branch('ranger','Marksman',[
    ['twin-arrow','Twin Arrow',12,1,'Two precise arrows for 170% total damage.',{power:1.7}],
    ['eagle-eye','Eagle Eye',0,0,'Passive: +12% critical chance.',{passive:{critChance:.12}},'◉'],
    ['piercing-shot','Piercing Shot',24,2,'A 230% shot that bypasses all armour.',{power:2.3,pierce:1}],
    ['starfall-volley','Starfall Volley',40,4,'A 340% volley with guaranteed critical damage.',{power:3.4,guaranteedCrit:true}]
  ]);
  branch('ranger','Wildwood',[
    ['venom-arrow','Venom Arrow',15,2,'Deal 110% damage; poison adds 35% attack damage over 3 boss turns.',{power:1.1,poison:3}],
    ['trailcraft','Trailcraft',0,0,'Passive: +20 HP and +5 attack.',{passive:{maxHp:20,damage:5}},'♣'],
    ['natures-gift','Nature’s Gift',24,2,'Restore the whole team for 22% maximum HP.',{healAll:.22},'✚'],
    ['thornstorm','Thornstorm',36,3,'Deal 260% damage; poison persists for 5 boss turns.',{power:2.6,poison:5}]
  ]);
  branch('ranger','Shadowstep',[
    ['smoke-arrow','Smoke Arrow',14,2,'Deal 100% damage and reduce the next boss attack by 25%.',{power:1,weakenBoss:.25}],
    ['quickstep','Quickstep',0,0,'Passive: +7 defence and +10 maximum MP.',{passive:{defence:7,maxMp:10}},'»'],
    ['ambush','Ambush',25,2,'A guaranteed critical strike for 210% damage.',{power:2.1,guaranteedCrit:true}],
    ['phantom-barrage','Phantom Barrage',40,4,'Deal 300% damage and protect the team with a 20% HP shield.',{power:3,shield:.2}]
  ]);
  branch('mage','Pyromancy',[
    ['firebolt','Firebolt',14,1,'A 180% fire spell that ignores half the enemy armour.',{power:1.8,pierce:.5}],
    ['ember-heart','Ember Heart',0,0,'Passive: +9 attack.',{passive:{damage:9}},'♦'],
    ['inferno','Inferno',28,2,'Deal 270% damage; burning deals 35% attack for 3 boss turns.',{power:2.7,poison:3}],
    ['meteor','Meteor',48,4,'Call a meteor for 430% damage, ignoring armour.',{power:4.3,pierce:1}]
  ]);
  branch('mage','Frostcraft',[
    ['ice-lance','Ice Lance',16,2,'Deal 150% damage and weaken the next boss turn by 20%.',{power:1.5,weakenBoss:.2}],
    ['frozen-core','Frozen Core',0,0,'Passive: +25 HP and +5 defence.',{passive:{maxHp:25,defence:5}},'❄'],
    ['glacial-ward','Glacial Ward',25,3,'Shield all heroes for 25% of their maximum HP.',{shield:.25},'▣'],
    ['absolute-zero','Absolute Zero',42,4,'Deal 320% damage and reduce the next boss attack by 60%.',{power:3.2,weakenBoss:.6}]
  ]);
  branch('mage','Arcanist',[
    ['arcane-pulse','Arcane Pulse',12,1,'Deal 150% damage and restore 6 MP to every ally.',{power:1.5,manaAll:6}],
    ['deep-reserves','Deep Reserves',0,0,'Passive: +40 maximum MP.',{passive:{maxMp:40}},'✦'],
    ['time-warp','Time Warp',30,3,'Deal 200% damage and reduce all other team skill cooldowns by 2.',{power:2,haste:2},'⌛'],
    ['supernova','Supernova',52,4,'A 400% armour-piercing explosion; heal all heroes for 15% HP.',{power:4,pierce:1,healAll:.15}]
  ]);
  branch('cleric','Restoration',[
    ['healing-light','Healing Light',14,1,'Heal the whole team for 22% maximum HP, including fallen allies.',{healAll:.22},'✚'],
    ['grace','Grace',0,0,'Passive: +10 healing and +20 maximum MP.',{passive:{healing:10,maxMp:20}},'✚'],
    ['renewal','Renewal',28,2,'Heal all allies for 38% maximum HP and cleanse weakness.',{healAll:.38,cleanse:true},'✚'],
    ['miracle','Miracle',48,4,'Restore every ally, including fallen heroes, to full health.',{healAll:1,cleanse:true},'✚']
  ]);
  branch('cleric','Radiance',[
    ['smite','Smite',12,1,'Holy light deals 175% damage and ignores half of enemy armour.',{power:1.75,pierce:.5}],
    ['inner-light','Inner Light',0,0,'Passive: +8 attack and +5 healing.',{passive:{damage:8,healing:5}},'✦'],
    ['judgement','Judgement',26,2,'Deal 260% damage and heal the team for 12% maximum HP.',{power:2.6,healAll:.12}],
    ['dawns-wrath','Dawn’s Wrath',44,4,'Deal 360% damage and weaken the next boss turn by 40%.',{power:3.6,weakenBoss:.4}]
  ]);
  branch('cleric','Aegis',[
    ['sanctuary','Sanctuary',16,2,'Shield the whole team for 18% maximum HP.',{shield:.18},'▣'],
    ['sacred-oath','Sacred Oath',0,0,'Passive: +35 HP and +4 defence.',{passive:{maxHp:35,defence:4}},'▣'],
    ['purify','Purify',25,2,'Cleanse weakness, heal the team for 20% HP and restore 10 MP each.',{healAll:.2,cleanse:true,manaAll:10},'✚'],
    ['divine-aegis','Divine Aegis',44,4,'Shield the team for 50% maximum HP and heal everyone for 20% HP.',{shield:.5,healAll:.2},'▣']
  ]);
  const RARITIES = {
    common:{name:'Common',color:'#c6d0dc',weight:45}, uncommon:{name:'Uncommon',color:'#85dfa1',weight:27},
    rare:{name:'Rare',color:'#83c7ff',weight:16}, epic:{name:'Epic',color:'#be9aff',weight:8},
    legendary:{name:'Legendary',color:'#ffc26f',weight:3.3}, mythical:{name:'Mythical',color:'#ff86bb',weight:.7}
  };
  const ITEMS = {};
  function item(id,name,rarity,type,description,effect,icon) { ITEMS[id]={id,name,rarity,type,description,effect,icon:icon || (type==='consumable'?'◆':'♦')}; }
  item('red-potion','Red Potion','common','consumable','Restore 40% maximum HP to one hero, including a fallen ally.',{heal:.4},'✚');
  item('blue-ether','Blue Ether','common','consumable','Restore 45 MP to one hero.',{mana:45},'✦');
  item('iron-charm','Iron Charm','common','equipment','While equipped: +3 defence.',{defence:3},'▣');
  item('bronze-blade','Bronze Blade','common','equipment','While equipped: +4 attack.',{damage:4},'⚔');
  item('fire-flask','Fire Flask','uncommon','consumable','Deal 100 armour-piercing damage.',{damage:100},'♦');
  item('party-tonic','Party Tonic','uncommon','consumable','Restore 25% maximum HP to every hero.',{healAll:.25},'✚');
  item('oak-amulet','Oak Amulet','uncommon','equipment','While equipped: +30 maximum HP and +2 defence.',{maxHp:30,defence:2},'♣');
  item('hunters-band','Hunter’s Band','uncommon','equipment','While equipped: +6 attack and +5% critical chance.',{damage:6,critChance:.05},'➶');
  item('phoenix-feather','Phoenix Feather','rare','consumable','Restore one hero to full health and remove weakness.',{heal:1,cleanse:true},'✚');
  item('mana-prism','Mana Prism','rare','consumable','Restore 35 MP to every hero.',{manaAll:35},'✦');
  item('crimson-edge','Crimson Edge','rare','equipment','While equipped: +12 attack; heal for 10% of damage dealt.',{damage:12,leech:.1},'⚔');
  item('silver-aegis','Silver Aegis','rare','equipment','While equipped: +12 defence and +30 maximum HP.',{defence:12,maxHp:30},'▣');
  item('elixir','Astral Elixir','epic','consumable','Fully restore one hero’s HP and MP and cleanse weakness.',{heal:1,mana:999,cleanse:true},'✦');
  item('starbomb','Starbomb','epic','consumable','Deal 280 armour-piercing damage and weaken the next boss turn by 25%.',{damage:280,weakenBoss:.25},'♦');
  item('storm-quiver','Storm Quiver','epic','equipment','While equipped: +15 attack, +15% critical chance and +0.25 critical multiplier.',{damage:15,critChance:.15,critMultiplier:.25},'➶');
  item('moon-codex','Moon Codex','epic','equipment','While equipped: +15 attack, +45 maximum MP and +10 healing.',{damage:15,maxMp:45,healing:10},'✦');
  item('dawnbringer','Dawnbringer','legendary','equipment','While equipped: +24 attack; every successful damaging action heals the team for 6% HP.',{damage:24,teamLeech:.06},'⚔');
  item('worldroot','Worldroot Heart','legendary','equipment','While equipped: +100 maximum HP, +14 defence and 8 MP restored per correct answer.',{maxHp:100,defence:14,manaRegen:8},'♣');
  item('phoenix-crown','Phoenix Crown','mythical','equipment','Once per encounter, the first fallen teammate rises at 50% HP. +80 HP and +15 defence.',{maxHp:80,defence:15,revive:true},'♛');
  item('chronicle','Chronicle of Tomorrow','mythical','equipment','Every third damaging correct action echoes for double damage. +20 attack and +35 MP.',{damage:20,maxMp:35,echo:true},'⌛');
  item('void-edge','Void Edge','mythical','equipment','All attacks ignore enemy armour and guard. +35 attack.',{damage:35,pierce:1,ignoreGuard:true},'⚔');
  item('sovereign-star','Sovereign Star','mythical','equipment','Each damaging correct action heals the whole team for 12% HP and restores 5 MP. +20 attack.',{damage:20,teamLeech:.12,teamMana:5},'✦');
  return {ROLES,SKILLS,SKILL_TREES:SKILLS,ITEMS,RARITIES};
});
