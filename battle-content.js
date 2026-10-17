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
  // Six tiers per branch: the original four, then a mastery passive and an
  // apex skill. Tiers 1-4 keep their levels and costs so saved builds stand.
  const BASE_LEVEL=[1,2,3,4,7,10], BASE_COST=[1,1,2,2,3,3];
  const JOB_LEVEL=[15,18,22,26,30,35], JOB_COST=[2,2,3,3,4,5];
  function branch(role, branchName, nodes) {
    const prior = [];
    nodes.forEach((n, i) => {
      const id = role + '-' + n[0];
      (SKILLS[role] || (SKILLS[role] = [])).push({ id, role, name:n[1], branch:branchName, tier:i+1,
        requires:i ? [prior[i-1]] : [], cost:BASE_COST[i], level:BASE_LEVEL[i],
        mpCost:n[2], cooldown:n[3], description:n[4], effect:{...n[5],type:n[5].passive?'passive':'active'}, icon:n[6] || ROLES[role].icon,
        passive:!!n[5].passive, animation:id });
      prior.push(id);
    });
  }
  branch('warrior','Vanguard',[
    ['power-strike','Power Strike',12,1,'A forceful strike for 165% damage.',{power:1.65}],
    ['iron-will','Iron Will',0,0,'Passive: +25 maximum HP and +4 defence.',{passive:{maxHp:25,defence:4}},'▣'],
    ['shield-wall','Shield Wall',22,3,'Strike for 80% damage and shield every ally for 20% of their HP.',{power:.8,shield:.2},'▣'],
    ['earthshatter','Earthshatter',36,3,'A 280% strike that ignores armour and weakens the next boss turn.',{power:2.8,pierce:1,weakenBoss:.3}],
    ['bulwark-mastery','Bulwark Mastery',0,0,'Passive: +40 maximum HP and +6 defence.',{passive:{maxHp:40,defence:6}},'▣'],
    ['titan-breaker','Titan Breaker',48,4,'A 420% armour-piercing blow that weakens the next enemy attack by 40%.',{power:4.2,pierce:1,weakenBoss:.4}]
  ]);
  branch('warrior','Berserker',[
    ['cleave','Cleave',14,1,'A sweeping 180% strike.',{power:1.8}],
    ['battle-fury','Battle Fury',0,0,'Passive: +7 attack and +5% critical chance.',{passive:{damage:7,critChance:.05}},'♦'],
    ['blood-oath','Blood Oath',24,2,'Deal 220% damage and recover 40% of damage dealt as HP.',{power:2.2,leech:.4}],
    ['rampage','Rampage',42,4,'Unleash a devastating 380% strike.',{power:3.8}],
    ['war-frenzy','War Frenzy',0,0,'Passive: +10 attack and +6% critical chance.',{passive:{damage:10,critChance:.06}},'♦'],
    ['skullsplitter','Skullsplitter',50,4,'A guaranteed critical 400% strike that drains 30% of the damage dealt as HP.',{power:4,guaranteedCrit:true,leech:.3}]
  ]);
  branch('warrior','Sentinel',[
    ['rally','Rally',16,2,'Strike for 60% damage and heal every ally for 12% maximum HP.',{power:.6,healAll:.12},'✚'],
    ['fortress','Fortress',0,0,'Passive: +50 maximum HP.',{passive:{maxHp:50}},'▣'],
    ['defiant-blow','Defiant Blow',24,2,'A 210% strike and a personal 35% HP shield.',{power:2.1,shieldSelf:.35}],
    ['last-bastion','Last Bastion',40,4,'Restore the team for 25% HP and shield everyone for 30% HP.',{healAll:.25,shield:.3},'▣'],
    ['stalwart-heart','Stalwart Heart',0,0,'Passive: +45 maximum HP and +6 healing.',{passive:{maxHp:45,healing:6}},'✚'],
    ['aegis-of-ages','Aegis of Ages',48,5,'Strike for 180% damage, shield every ally for 40% HP and heal the team for 20% HP.',{power:1.8,shield:.4,healAll:.2},'▣']
  ]);
  branch('ranger','Marksman',[
    ['twin-arrow','Twin Arrow',12,1,'Two precise arrows for 170% total damage.',{power:1.7}],
    ['eagle-eye','Eagle Eye',0,0,'Passive: +12% critical chance.',{passive:{critChance:.12}},'◉'],
    ['piercing-shot','Piercing Shot',24,2,'A 230% shot that bypasses all armour.',{power:2.3,pierce:1}],
    ['starfall-volley','Starfall Volley',40,4,'A 340% volley with guaranteed critical damage.',{power:3.4,guaranteedCrit:true}],
    ['hawkeye-focus','Hawkeye Focus',0,0,'Passive: +8% critical chance and +0.15 critical multiplier.',{passive:{critChance:.08,critMultiplier:.15}},'◉'],
    ['skypiercer','Skypiercer',46,4,'A 400% shot that ignores armour with guaranteed critical damage.',{power:4,pierce:1,guaranteedCrit:true}]
  ]);
  branch('ranger','Wildwood',[
    ['venom-arrow','Venom Arrow',15,2,'Deal 110% damage; poison adds 35% attack damage over 3 boss turns.',{power:1.1,poison:3}],
    ['trailcraft','Trailcraft',0,0,'Passive: +20 HP and +5 attack.',{passive:{maxHp:20,damage:5}},'♣'],
    ['natures-gift','Nature’s Gift',24,2,'Restore the whole team for 22% maximum HP.',{healAll:.22},'✚'],
    ['thornstorm','Thornstorm',36,3,'Deal 260% damage; poison persists for 5 boss turns.',{power:2.6,poison:5}],
    ['heartwood','Heartwood',0,0,'Passive: +30 maximum HP and +8 healing.',{passive:{maxHp:30,healing:8}},'♣'],
    ['verdant-cataclysm','Verdant Cataclysm',46,4,'Deal 330% damage, poison for 5 enemy turns and heal the team for 18% HP.',{power:3.3,poison:5,healAll:.18}]
  ]);
  branch('ranger','Shadowstep',[
    ['smoke-arrow','Smoke Arrow',14,2,'Deal 100% damage and reduce the next boss attack by 25%.',{power:1,weakenBoss:.25}],
    ['quickstep','Quickstep',0,0,'Passive: +7 defence and +10 maximum MP.',{passive:{defence:7,maxMp:10}},'»'],
    ['ambush','Ambush',25,2,'A guaranteed critical strike for 210% damage.',{power:2.1,guaranteedCrit:true}],
    ['phantom-barrage','Phantom Barrage',40,4,'Deal 300% damage and protect the team with a 20% HP shield.',{power:3,shield:.2}],
    ['shadow-veil','Shadow Veil',0,0,'Passive: +6 defence and +6% critical chance.',{passive:{defence:6,critChance:.06}},'»'],
    ['night-hunt','Night Hunt',48,4,'A guaranteed critical 360% strike; the next enemy attack is 35% weaker.',{power:3.6,guaranteedCrit:true,weakenBoss:.35}]
  ]);
  branch('mage','Pyromancy',[
    ['firebolt','Firebolt',14,1,'A 180% fire spell that ignores half the enemy armour.',{power:1.8,pierce:.5}],
    ['ember-heart','Ember Heart',0,0,'Passive: +9 attack.',{passive:{damage:9}},'♦'],
    ['inferno','Inferno',28,2,'Deal 270% damage; burning deals 35% attack for 3 boss turns.',{power:2.7,poison:3}],
    ['meteor','Meteor',48,4,'Call a meteor for 430% damage, ignoring armour.',{power:4.3,pierce:1}],
    ['kindled-soul','Kindled Soul',0,0,'Passive: +12 attack.',{passive:{damage:12}},'♦'],
    ['solar-flare','Solar Flare',58,5,'A 480% armour-piercing blaze; burning lasts 4 enemy turns.',{power:4.8,pierce:1,poison:4}]
  ]);
  branch('mage','Frostcraft',[
    ['ice-lance','Ice Lance',16,2,'Deal 150% damage and weaken the next boss turn by 20%.',{power:1.5,weakenBoss:.2}],
    ['frozen-core','Frozen Core',0,0,'Passive: +25 HP and +5 defence.',{passive:{maxHp:25,defence:5}},'❄'],
    ['glacial-ward','Glacial Ward',25,3,'Shield all heroes for 25% of their maximum HP.',{shield:.25},'▣'],
    ['absolute-zero','Absolute Zero',42,4,'Deal 320% damage and reduce the next boss attack by 60%.',{power:3.2,weakenBoss:.6}],
    ['permafrost','Permafrost',0,0,'Passive: +35 maximum HP and +7 defence.',{passive:{maxHp:35,defence:7}},'❄'],
    ['glacier-tomb','Glacier Tomb',52,4,'Deal 360% damage, weaken the next enemy attack by 70% and shield the team for 20% HP.',{power:3.6,weakenBoss:.7,shield:.2}]
  ]);
  branch('mage','Arcanist',[
    ['arcane-pulse','Arcane Pulse',12,1,'Deal 150% damage and restore 6 MP to every ally.',{power:1.5,manaAll:6}],
    ['deep-reserves','Deep Reserves',0,0,'Passive: +40 maximum MP.',{passive:{maxMp:40}},'✦'],
    ['time-warp','Time Warp',30,3,'Deal 200% damage and reduce all other team skill cooldowns by 2.',{power:2,haste:2},'⌛'],
    ['supernova','Supernova',52,4,'A 400% armour-piercing explosion; heal all heroes for 15% HP.',{power:4,pierce:1,healAll:.15}],
    ['mana-font','Mana Font',0,0,'Passive: +50 maximum MP and +5 attack.',{passive:{maxMp:50,damage:5}},'✦'],
    ['starweave','Starweave',56,4,'Deal 380% damage, restore 15 MP to every ally and reduce other team cooldowns by 2.',{power:3.8,manaAll:15,haste:2}]
  ]);
  branch('cleric','Restoration',[
    ['healing-light','Healing Light',14,1,'Heal the whole team for 22% maximum HP, including fallen allies.',{healAll:.22},'✚'],
    ['grace','Grace',0,0,'Passive: +10 healing and +20 maximum MP.',{passive:{healing:10,maxMp:20}},'✚'],
    ['renewal','Renewal',28,2,'Heal all allies for 38% maximum HP and cleanse weakness.',{healAll:.38,cleanse:true},'✚'],
    ['miracle','Miracle',48,4,'Restore every ally, including fallen heroes, to full health.',{healAll:1,cleanse:true},'✚'],
    ['benediction','Benediction',0,0,'Passive: +15 healing and +25 maximum MP.',{passive:{healing:15,maxMp:25}},'✚'],
    ['resurgence','Resurgence',54,5,'Restore every ally to full HP, cleanse weakness and shield the team for 20% HP.',{healAll:1,cleanse:true,shield:.2},'✚']
  ]);
  branch('cleric','Radiance',[
    ['smite','Smite',12,1,'Holy light deals 175% damage and ignores half of enemy armour.',{power:1.75,pierce:.5}],
    ['inner-light','Inner Light',0,0,'Passive: +8 attack and +5 healing.',{passive:{damage:8,healing:5}},'✦'],
    ['judgement','Judgement',26,2,'Deal 260% damage and heal the team for 12% maximum HP.',{power:2.6,healAll:.12}],
    ['dawns-wrath','Dawn’s Wrath',44,4,'Deal 360% damage and weaken the next boss turn by 40%.',{power:3.6,weakenBoss:.4}],
    ['zealous-light','Zealous Light',0,0,'Passive: +10 attack and +5% critical chance.',{passive:{damage:10,critChance:.05}},'✦'],
    ['heavens-lance','Heaven’s Lance',50,4,'A 400% armour-piercing beam that heals the team for 15% HP.',{power:4,pierce:1,healAll:.15}]
  ]);
  branch('cleric','Aegis',[
    ['sanctuary','Sanctuary',16,2,'Shield the whole team for 18% maximum HP.',{shield:.18},'▣'],
    ['sacred-oath','Sacred Oath',0,0,'Passive: +35 HP and +4 defence.',{passive:{maxHp:35,defence:4}},'▣'],
    ['purify','Purify',25,2,'Cleanse weakness, heal the team for 20% HP and restore 10 MP each.',{healAll:.2,cleanse:true,manaAll:10},'✚'],
    ['divine-aegis','Divine Aegis',44,4,'Shield the team for 50% maximum HP and heal everyone for 20% HP.',{shield:.5,healAll:.2},'▣'],
    ['hallowed-shell','Hallowed Shell',0,0,'Passive: +40 maximum HP and +6 defence.',{passive:{maxHp:40,defence:6}},'▣'],
    ['bastion-of-faith','Bastion of Faith',52,5,'Shield the team for 60% HP, cleanse weakness and weaken the next enemy attack by 30%.',{shield:.6,cleanse:true,healAll:.05,weakenBoss:.3},'▣']
  ]);
  // Advanced jobs preserve a hero's base class and its learned skills.
  const JOBS = {
    paladin:{id:'paladin',role:'warrior',name:'Paladin',description:'A radiant knight who turns shields into a refuge for the party.',bonuses:{maxHp:50,defence:8,healing:12},color:'#ffe19a'},
    berserker:{id:'berserker',role:'warrior',name:'Berserker',description:'A relentless fighter who sustains powerful blows with stolen vitality.',bonuses:{damage:16,maxHp:25,critChance:.06},color:'#ff8979'},
    sharpshooter:{id:'sharpshooter',role:'ranger',name:'Sharpshooter',description:'A patient marksman whose precision pierces the toughest armour.',bonuses:{damage:12,critChance:.12,maxMp:15},color:'#8cdbff'},
    beastmaster:{id:'beastmaster',role:'ranger',name:'Beastmaster',description:'A woodland guardian who calls spirit companions to strike and protect.',bonuses:{maxHp:45,defence:6,healing:10},color:'#ade9a1'},
    archmage:{id:'archmage',role:'mage',name:'Archmage',description:'An elemental master combining fire, frost and storms into enormous spells.',bonuses:{damage:18,maxMp:45},color:'#d6adff'},
    chronomancer:{id:'chronomancer',role:'mage',name:'Chronomancer',description:'A keeper of time who renews mana, accelerates allies and unravels enemy attacks.',bonuses:{maxMp:55,defence:5,maxHp:20},color:'#80eee8'},
    hierophant:{id:'hierophant',role:'cleric',name:'Hierophant',description:'A sacred protector whose restorative rituals bring the whole party back.',bonuses:{healing:24,maxHp:35,maxMp:30},color:'#fff0b6'},
    oracle:{id:'oracle',role:'cleric',name:'Oracle',description:'A celestial seer who joins radiant judgement with prophetic protection.',bonuses:{damage:14,critChance:.08,maxMp:30,healing:8},color:'#efb4ff'}
  };
  const JOB_SKILLS = {};
  function jobBranch(jobId, branchName, nodes) {
    const job=JOBS[jobId], prior=[];
    nodes.forEach((n,i)=>{
      const id=jobId+'-'+n[0];
      (JOB_SKILLS[jobId] || (JOB_SKILLS[jobId]=[])).push({id,role:job.role,job:jobId,name:n[1],branch:branchName,tier:i+1,
        requires:i?[prior[i-1]]:[],cost:JOB_COST[i],level:JOB_LEVEL[i],mpCost:n[2],cooldown:n[3],description:n[4],
        effect:{...n[5],type:n[5].passive?'passive':'active'},icon:n[6] || ROLES[job.role].icon,passive:!!n[5].passive,animation:id});
      prior.push(id);
    });
  }
  jobBranch('paladin','Sunblade',[
    ['radiant-cut','Radiant Cut',22,1,'A 240% holy slash that restores 8% HP to every ally.',{power:2.4,healAll:.08}],
    ['sun-forged','Sun Forged',0,0,'Passive: +12 attack and +8 healing.',{passive:{damage:12,healing:8}},'✦'],
    ['consecration','Consecration',34,2,'A 320% armour-piercing strike that cleanses and heals the party for 15% HP.',{power:3.2,pierce:1,healAll:.15,cleanse:true}],
    ['solar-verdict','Solar Verdict',54,4,'A 470% radiant strike; shield the party for 35% HP.',{power:4.7,shield:.35}],
    ['dawnlord','Dawnlord',0,0,'Passive: +16 attack and +10 healing.',{passive:{damage:16,healing:10}},'✦'],
    ['empyrean-judgement','Empyrean Judgement',72,5,'A 620% armour-piercing judgement that heals the party for 25% HP and shields for 30% HP.',{power:6.2,pierce:1,healAll:.25,shield:.3}]
  ]);
  jobBranch('paladin','Oathkeeper',[
    ['oath-shield','Oath Shield',24,2,'Shield all allies for 30% HP and weaken the next enemy attack by 20%.',{shield:.3,weakenBoss:.2},'▣'],
    ['unbroken-oath','Unbroken Oath',0,0,'Passive: +65 maximum HP and +8 defence.',{passive:{maxHp:65,defence:8}},'▣'],
    ['aegis-charge','Aegis Charge',36,2,'A 290% charge; gain a personal 60% HP shield.',{power:2.9,shieldSelf:.6}],
    ['citadel-of-light','Citadel of Light',56,4,'Shield every ally for 65% HP and restore 25% HP to the party.',{shield:.65,healAll:.25},'▣'],
    ['eternal-vow','Eternal Vow',0,0,'Passive: +90 maximum HP and +12 defence.',{passive:{maxHp:90,defence:12}},'▣'],
    ['bulwark-of-kings','Bulwark of Kings',70,5,'A 360% strike; shield every ally for 90% HP and weaken the next enemy attack by 50%.',{power:3.6,shield:.9,weakenBoss:.5},'▣']
  ]);
  jobBranch('paladin','Mercy',[
    ['mercy-bell','Mercy Bell',22,2,'Restore every ally for 24% HP, including fallen allies, and cleanse weakness.',{healAll:.24,cleanse:true},'✚'],
    ['hands-of-dawn','Hands of Dawn',0,0,'Passive: +20 healing and +25 maximum MP.',{passive:{healing:20,maxMp:25}},'✚'],
    ['dawn-procession','Dawn Procession',34,3,'Restore the party for 35% HP and 12 MP each.',{healAll:.35,manaAll:12},'✚'],
    ['sacred-reunion','Sacred Reunion',58,5,'Restore all allies for 70% HP; cleanse weakness and shield for 25% HP.',{healAll:.7,cleanse:true,shield:.25},'✚'],
    ['saints-mercy','Saint’s Mercy',0,0,'Passive: +28 healing and +35 maximum MP.',{passive:{healing:28,maxMp:35}},'✚'],
    ['lights-embrace','Light’s Embrace',74,6,'Restore every ally to full HP, cleanse weakness, shield for 40% HP and restore 20 MP each.',{healAll:1,cleanse:true,shield:.4,manaAll:20},'✚']
  ]);
  jobBranch('berserker','Bloodstorm',[
    ['rending-axe','Rending Axe',20,1,'Deal 260% damage and recover 25% of the damage dealt as HP.',{power:2.6,leech:.25}],
    ['bloodlust','Bloodlust',0,0,'Passive: +18 attack and +5% critical chance.',{passive:{damage:18,critChance:.05}},'♦'],
    ['scarlet-cyclone','Scarlet Cyclone',36,2,'Deal 350% damage and drain 45% of that damage as HP.',{power:3.5,leech:.45}],
    ['crimson-apocalypse','Crimson Apocalypse',56,4,'A 540% strike that drains 60% of damage dealt as HP.',{power:5.4,leech:.6}],
    ['red-tide','Red Tide',0,0,'Passive: +24 attack and +6% critical chance.',{passive:{damage:24,critChance:.06}},'♦'],
    ['sanguine-ragnarok','Sanguine Ragnarok',74,5,'A 720% strike that drains 70% of the damage dealt as HP.',{power:7.2,leech:.7}]
  ]);
  jobBranch('berserker','Warcry',[
    ['thunder-roar','Thunder Roar',22,2,'Deal 160% damage and reduce the next enemy attack by 40%.',{power:1.6,weakenBoss:.4}],
    ['titan-lungs','Titan Lungs',0,0,'Passive: +75 maximum HP.',{passive:{maxHp:75}},'▣'],
    ['shattering-cry','Shattering Cry',32,3,'A 280% armour-piercing roar that grants the party a 20% HP shield.',{power:2.8,pierce:1,shield:.2}],
    ['worldbreaker','Worldbreaker',54,4,'Deal 450% damage; halve the next enemy attack and shield the party for 30% HP.',{power:4.5,weakenBoss:.5,shield:.3}],
    ['stormvoice','Stormvoice',0,0,'Passive: +90 maximum HP and +10 attack.',{passive:{maxHp:90,damage:10}},'▣'],
    ['ragnarok-howl','Ragnarok Howl',70,5,'A 580% armour-piercing roar; reduce the next enemy attack by 70% and shield the party for 40% HP.',{power:5.8,pierce:1,weakenBoss:.7,shield:.4}]
  ]);
  jobBranch('berserker','Juggernaut',[
    ['iron-rush','Iron Rush',24,2,'A 250% charging strike that grants a personal 35% HP shield.',{power:2.5,shieldSelf:.35}],
    ['colossus','Colossus',0,0,'Passive: +12 defence and +40 maximum HP.',{passive:{defence:12,maxHp:40}},'▣'],
    ['faultline','Faultline',36,3,'Deal 370% damage, ignoring all enemy armour.',{power:3.7,pierce:1}],
    ['unstoppable','Unstoppable',58,4,'A guaranteed critical 440% strike with a personal 70% HP shield.',{power:4.4,guaranteedCrit:true,shieldSelf:.7}],
    ['living-fortress','Living Fortress',0,0,'Passive: +18 defence and +60 maximum HP.',{passive:{defence:18,maxHp:60}},'▣'],
    ['cataclysm-charge','Cataclysm Charge',76,5,'A guaranteed critical 600% armour-piercing charge with a personal 90% HP shield.',{power:6,guaranteedCrit:true,pierce:1,shieldSelf:.9}]
  ]);
  jobBranch('sharpshooter','Deadeye',[
    ['perfect-shot','Perfect Shot',22,1,'A precise 270% shot that ignores all enemy armour.',{power:2.7,pierce:1}],
    ['steady-breath','Steady Breath',0,0,'Passive: +15% critical chance and +0.2 critical multiplier.',{passive:{critChance:.15,critMultiplier:.2}},'◉'],
    ['glass-arrow','Glass Arrow',34,2,'A guaranteed critical 320% shot.',{power:3.2,guaranteedCrit:true}],
    ['horizon-piercer','Horizon Piercer',54,4,'A 490% shot with guaranteed critical damage that ignores armour.',{power:4.9,pierce:1,guaranteedCrit:true}],
    ['hunters-instinct','Hunter’s Instinct',0,0,'Passive: +12% critical chance and +0.3 critical multiplier.',{passive:{critChance:.12,critMultiplier:.3}},'◉'],
    ['singularity-shot','Singularity Shot',72,5,'A guaranteed critical 680% shot that ignores all armour and weakens the next enemy attack by 30%.',{power:6.8,pierce:1,guaranteedCrit:true,weakenBoss:.3}]
  ]);
  jobBranch('sharpshooter','Arrowstorm',[
    ['fan-of-arrows','Fan of Arrows',24,1,'A sweeping volley for 290% total damage.',{power:2.9}],
    ['endless-quiver','Endless Quiver',0,0,'Passive: +14 attack and +30 maximum MP.',{passive:{damage:14,maxMp:30}},'➶'],
    ['rain-of-steel','Rain of Steel',38,3,'Deal 380% damage and weaken the next enemy attack by 25%.',{power:3.8,weakenBoss:.25}],
    ['falling-constellation','Falling Constellation',60,4,'A 570% storm of arrows, ignoring half of enemy armour.',{power:5.7,pierce:.5}],
    ['thousand-quivers','Thousand Quivers',0,0,'Passive: +20 attack and +40 maximum MP.',{passive:{damage:20,maxMp:40}},'➶'],
    ['skyfall-barrage','Skyfall Barrage',78,5,'A 760% storm of arrows that ignores half of enemy armour and poisons for 4 enemy turns.',{power:7.6,pierce:.5,poison:4}]
  ]);
  jobBranch('sharpshooter','Windrunner',[
    ['gust-arrow','Gust Arrow',20,2,'Deal 200% damage and grant the party a 20% HP shield.',{power:2,shield:.2}],
    ['windborne','Windborne',0,0,'Passive: +10 defence and +25 maximum HP.',{passive:{defence:10,maxHp:25}},'»'],
    ['slipstream','Slipstream',34,3,'Deal 290% damage and reduce all other ally skill cooldowns by 2.',{power:2.9,haste:2}],
    ['eye-of-the-storm','Eye of the Storm',52,4,'A 390% shot that shields the team for 40% HP and restores 15 MP each.',{power:3.9,shield:.4,manaAll:15}],
    ['zephyr-soul','Zephyr Soul',0,0,'Passive: +14 defence, +40 maximum HP and +20 maximum MP.',{passive:{defence:14,maxHp:40,maxMp:20}},'»'],
    ['hurricane-arrow','Hurricane Arrow',70,5,'A 520% shot; shield the team for 55% HP, restore 20 MP each and reduce other cooldowns by 2.',{power:5.2,shield:.55,manaAll:20,haste:2}]
  ]);
  jobBranch('beastmaster','Spirit Pack',[
    ['wolf-pounce','Wolf Pounce',22,1,'A spirit wolf strikes for 260% damage and weakens the next enemy attack by 15%.',{power:2.6,weakenBoss:.15}],
    ['pack-bond','Pack Bond',0,0,'Passive: +13 attack and +35 maximum HP.',{passive:{damage:13,maxHp:35}},'♣'],
    ['twin-fangs','Twin Fangs',34,2,'Spirit wolves deal 350% damage; recover 25% of damage dealt as HP.',{power:3.5,leech:.25}],
    ['ancestral-pack','Ancestral Pack',54,4,'The spirit pack deals 490% damage and heals the party for 20% HP.',{power:4.9,healAll:.2}],
    ['alpha-spirit','Alpha Spirit',0,0,'Passive: +18 attack and +45 maximum HP.',{passive:{damage:18,maxHp:45}},'♣'],
    ['great-hunt','Great Hunt',74,5,'The ancestral pack deals 650% damage, drains 30% as HP and heals the party for 25% HP.',{power:6.5,leech:.3,healAll:.25}]
  ]);
  jobBranch('beastmaster','Ancient Grove',[
    ['root-snare','Root Snare',20,2,'Deal 180% damage; poison ticks for 4 turns and the next enemy attack is 25% weaker.',{power:1.8,poison:4,weakenBoss:.25}],
    ['barkskin','Barkskin',0,0,'Passive: +65 maximum HP and +7 defence.',{passive:{maxHp:65,defence:7}},'▣'],
    ['elder-bloom','Elder Bloom',34,3,'Restore all allies for 35% HP and cleanse weakness.',{healAll:.35,cleanse:true},'✚'],
    ['worldtree-embrace','Worldtree Embrace',56,4,'Restore the party for 50% HP, shield for 40% HP and renew 15 MP each.',{healAll:.5,shield:.4,manaAll:15},'♣'],
    ['eldertree-bark','Eldertree Bark',0,0,'Passive: +90 maximum HP and +10 defence.',{passive:{maxHp:90,defence:10}},'▣'],
    ['gaia-renewal','Gaia Renewal',76,6,'Restore the party to full HP, shield for 50% HP, cleanse weakness and renew 20 MP each.',{healAll:1,shield:.5,cleanse:true,manaAll:20},'♣']
  ]);
  jobBranch('beastmaster','Sky Companion',[
    ['hawk-dive','Hawk Dive',22,1,'A spirit hawk deals 250% damage, ignoring half of enemy armour.',{power:2.5,pierce:.5}],
    ['sky-sight','Sky Sight',0,0,'Passive: +12% critical chance and +25 maximum MP.',{passive:{critChance:.12,maxMp:25}},'◉'],
    ['thunder-talons','Thunder Talons',36,2,'A guaranteed critical 330% lightning strike.',{power:3.3,guaranteedCrit:true}],
    ['phoenix-flight','Phoenix Flight',58,4,'Deal 440% damage and restore every ally, including fallen allies, for 40% HP.',{power:4.4,healAll:.4}],
    ['stormwing-bond','Stormwing Bond',0,0,'Passive: +12% critical chance and +12 attack.',{passive:{critChance:.12,damage:12}},'◉'],
    ['thunderbird-ascent','Thunderbird Ascent',76,5,'A guaranteed critical 600% lightning dive that ignores all armour.',{power:6,guaranteedCrit:true,pierce:1}]
  ]);
  jobBranch('archmage','Volcanic Lore',[
    ['magma-orb','Magma Orb',26,1,'A 300% fire spell; burning persists for 3 enemy turns.',{power:3,poison:3}],
    ['living-flame','Living Flame',0,0,'Passive: +22 attack.',{passive:{damage:22}},'♦'],
    ['eruption','Eruption',42,3,'Deal 420% damage, ignoring half of enemy armour.',{power:4.2,pierce:.5}],
    ['sun-collapse','Sun Collapse',68,5,'An armour-piercing 660% inferno; burning persists for 5 turns.',{power:6.6,pierce:1,poison:5}],
    ['heart-of-magma','Heart of Magma',0,0,'Passive: +28 attack.',{passive:{damage:28}},'♦'],
    ['primordial-inferno','Primordial Inferno',88,6,'An armour-piercing 780% inferno; burning persists for 6 enemy turns.',{power:7.8,pierce:1,poison:6}]
  ]);
  jobBranch('archmage','Winter Crown',[
    ['frost-nova','Frost Nova',26,2,'Deal 260% damage and reduce the next enemy attack by 35%.',{power:2.6,weakenBoss:.35}],
    ['winter-throne','Winter Throne',0,0,'Passive: +45 maximum HP, +7 defence and +20 MP.',{passive:{maxHp:45,defence:7,maxMp:20}},'❄'],
    ['crystal-prison','Crystal Prison',40,3,'Deal 340% damage and grant the team a 35% HP shield.',{power:3.4,shield:.35}],
    ['eternal-winter','Eternal Winter',62,4,'Deal 480% damage and reduce the next enemy attack by 75%.',{power:4.8,weakenBoss:.75}],
    ['glacial-sovereign','Glacial Sovereign',0,0,'Passive: +60 maximum HP, +10 defence and +30 maximum MP.',{passive:{maxHp:60,defence:10,maxMp:30}},'❄'],
    ['endless-blizzard','Endless Blizzard',80,5,'Deal 620% damage, reduce the next enemy attack by 85% and shield the team for 45% HP.',{power:6.2,weakenBoss:.85,shield:.45}]
  ]);
  jobBranch('archmage','Stormweaving',[
    ['chain-lightning','Chain Lightning',24,1,'Lightning deals 280% damage and restores 8 MP to each ally.',{power:2.8,manaAll:8}],
    ['storm-conduit','Storm Conduit',0,0,'Passive: +15 attack and +40 maximum MP.',{passive:{damage:15,maxMp:40}},'✦'],
    ['tempest-sigil','Tempest Sigil',40,3,'Deal 390% damage and reduce other team skill cooldowns by 2.',{power:3.9,haste:2}],
    ['celestial-tempest','Celestial Tempest',66,4,'A guaranteed critical 540% bolt that bypasses armour.',{power:5.4,pierce:1,guaranteedCrit:true}],
    ['eye-of-the-tempest','Eye of the Tempest',0,0,'Passive: +20 attack, +55 maximum MP and +5% critical chance.',{passive:{damage:20,maxMp:55,critChance:.05}},'✦'],
    ['heavens-wrath','Heaven’s Wrath',84,5,'A guaranteed critical 700% bolt that bypasses armour and restores 15 MP to every ally.',{power:7,pierce:1,guaranteedCrit:true,manaAll:15}]
  ]);
  jobBranch('chronomancer','Acceleration',[
    ['quickening','Quickening',24,2,'Deal 210% damage and reduce other team skill cooldowns by 2.',{power:2.1,haste:2}],
    ['borrowed-hours','Borrowed Hours',0,0,'Passive: +50 maximum MP and +6 defence.',{passive:{maxMp:50,defence:6}},'⌛'],
    ['time-surge','Time Surge',36,3,'Deal 290% damage, restore 15 MP to allies and reduce other skill cooldowns by 2.',{power:2.9,manaAll:15,haste:2}],
    ['infinite-moment','Infinite Moment',58,5,'Deal 380% damage; restore 25 MP to allies and reduce other skill cooldowns by 4.',{power:3.8,manaAll:25,haste:4}],
    ['timeless-mind','Timeless Mind',0,0,'Passive: +70 maximum MP and +8 defence.',{passive:{maxMp:70,defence:8}},'⌛'],
    ['stop-the-clock','Stop the Clock',76,6,'Deal 480% damage; restore 30 MP to allies and reduce other skill cooldowns by 5.',{power:4.8,manaAll:30,haste:5}]
  ]);
  jobBranch('chronomancer','Reversal',[
    ['rewind-wounds','Rewind Wounds',24,2,'Restore every ally for 28% HP and cleanse weakness.',{healAll:.28,cleanse:true},'✚'],
    ['anchored-soul','Anchored Soul',0,0,'Passive: +60 maximum HP and +12 healing.',{passive:{maxHp:60,healing:12}},'▣'],
    ['echo-of-life','Echo of Life',38,3,'Restore the party for 42% HP and grant a 20% HP shield.',{healAll:.42,shield:.2},'✚'],
    ['second-dawn','Second Dawn',62,5,'Restore every ally to full HP, cleanse weakness and restore 20 MP each.',{healAll:1,cleanse:true,manaAll:20},'✚'],
    ['eternal-return','Eternal Return',0,0,'Passive: +80 maximum HP and +18 healing.',{passive:{maxHp:80,healing:18}},'▣'],
    ['genesis-loop','Genesis Loop',80,6,'Restore every ally to full HP, shield for 50% HP, cleanse weakness and restore 25 MP each.',{healAll:1,shield:.5,cleanse:true,manaAll:25},'✚']
  ]);
  jobBranch('chronomancer','Entropy',[
    ['aging-touch','Aging Touch',24,2,'Deal 230% damage; weaken the next enemy attack by 30% and poison for 3 turns.',{power:2.3,weakenBoss:.3,poison:3}],
    ['fractured-seconds','Fractured Seconds',0,0,'Passive: +16 attack and +8% critical chance.',{passive:{damage:16,critChance:.08}},'⌛'],
    ['temporal-rift','Temporal Rift',40,3,'Deal 360% armour-piercing damage and weaken the next enemy attack by 40%.',{power:3.6,pierce:1,weakenBoss:.4}],
    ['end-of-ages','End of Ages',64,4,'Deal 510% damage; weaken the next enemy attack by 65% and poison for 5 turns.',{power:5.1,weakenBoss:.65,poison:5}],
    ['heat-death','Heat Death',0,0,'Passive: +22 attack and +10% critical chance.',{passive:{damage:22,critChance:.1}},'⌛'],
    ['oblivion-hour','Oblivion Hour',82,5,'Deal 660% armour-piercing damage; weaken the next enemy attack by 80% and poison for 6 turns.',{power:6.6,pierce:1,weakenBoss:.8,poison:6}]
  ]);
  jobBranch('hierophant','Restoring Rites',[
    ['sacred-spring','Sacred Spring',24,1,'Restore every ally for 32% maximum HP, including fallen allies.',{healAll:.32},'✚'],
    ['boundless-grace','Boundless Grace',0,0,'Passive: +30 healing and +30 maximum MP.',{passive:{healing:30,maxMp:30}},'✚'],
    ['chorus-of-renewal','Chorus of Renewal',38,3,'Restore the party for 48% HP, cleanse weakness and restore 12 MP each.',{healAll:.48,cleanse:true,manaAll:12},'✚'],
    ['great-resurrection','Great Resurrection',64,5,'Restore every ally to full HP and grant each a 40% HP shield.',{healAll:1,shield:.4,cleanse:true},'✚'],
    ['fount-of-life','Fount of Life',0,0,'Passive: +40 healing and +40 maximum MP.',{passive:{healing:40,maxMp:40}},'✚'],
    ['ascension-rite','Ascension Rite',80,6,'Restore every ally to full HP, shield for 70% HP, cleanse weakness and restore 25 MP each.',{healAll:1,shield:.7,cleanse:true,manaAll:25},'✚']
  ]);
  jobBranch('hierophant','Sacred Bastion',[
    ['hallowed-ground','Hallowed Ground',24,2,'Shield every ally for 32% HP and cleanse weakness.',{shield:.32,cleanse:true,healAll:.01},'▣'],
    ['temple-guardian','Temple Guardian',0,0,'Passive: +70 maximum HP and +10 defence.',{passive:{maxHp:70,defence:10}},'▣'],
    ['seraphic-ward','Seraphic Ward',38,3,'Shield the party for 48% HP and reduce the next enemy attack by 30%.',{shield:.48,weakenBoss:.3},'▣'],
    ['sanctum-eternal','Sanctum Eternal',60,4,'Shield every ally for 75% HP and heal the party for 35% HP.',{shield:.75,healAll:.35},'▣'],
    ['cathedral-stone','Cathedral Stone',0,0,'Passive: +100 maximum HP and +14 defence.',{passive:{maxHp:100,defence:14}},'▣'],
    ['divine-citadel','Divine Citadel',78,6,'Shield every ally for 100% HP, heal for 40% HP and reduce the next enemy attack by 50%.',{shield:1,healAll:.4,weakenBoss:.5},'▣']
  ]);
  jobBranch('hierophant','Holy Flame',[
    ['purging-flame','Purging Flame',22,1,'Deal 240% holy damage and restore the party for 10% HP.',{power:2.4,healAll:.1}],
    ['sacred-fire','Sacred Fire',0,0,'Passive: +16 attack and +12 healing.',{passive:{damage:16,healing:12}},'✦'],
    ['seraph-strike','Seraph Strike',36,2,'Deal 340% armour-piercing damage and cleanse party weakness.',{power:3.4,pierce:1,healAll:.05,cleanse:true}],
    ['daybreak-anthem','Daybreak Anthem',58,4,'Deal 460% damage; heal allies for 30% HP and restore 18 MP each.',{power:4.6,healAll:.3,manaAll:18}],
    ['seraphic-fire','Seraphic Fire',0,0,'Passive: +22 attack and +16 healing.',{passive:{damage:22,healing:16}},'✦'],
    ['judgement-day','Judgement Day',78,5,'Deal 600% armour-piercing holy damage; heal allies for 35% HP and cleanse weakness.',{power:6,pierce:1,healAll:.35,cleanse:true}]
  ]);
  jobBranch('oracle','Starfall',[
    ['astral-ray','Astral Ray',24,1,'A 260% celestial beam that ignores all enemy armour.',{power:2.6,pierce:1}],
    ['stellar-clarity','Stellar Clarity',0,0,'Passive: +16 attack and +10% critical chance.',{passive:{damage:16,critChance:.1}},'✦'],
    ['comet-judgement','Comet Judgement',38,2,'Deal 370% damage and heal the party for 15% HP.',{power:3.7,healAll:.15}],
    ['zodiac-reckoning','Zodiac Reckoning',62,4,'A guaranteed critical 500% celestial strike that ignores half of enemy armour.',{power:5,guaranteedCrit:true,pierce:.5}],
    ['celestial-eye','Celestial Eye',0,0,'Passive: +22 attack and +10% critical chance.',{passive:{damage:22,critChance:.1}},'✦'],
    ['galaxy-collapse','Galaxy Collapse',80,5,'A guaranteed critical 680% celestial strike that ignores all armour.',{power:6.8,guaranteedCrit:true,pierce:1}]
  ]);
  jobBranch('oracle','Prophecy',[
    ['forewarning','Forewarning',22,2,'Shield the team for 25% HP and reduce the next enemy attack by 30%.',{shield:.25,weakenBoss:.3},'◉'],
    ['sight-beyond','Sight Beyond',0,0,'Passive: +40 maximum MP and +8 defence.',{passive:{maxMp:40,defence:8}},'◉'],
    ['fated-refuge','Fated Refuge',36,3,'Restore allies for 28% HP and reduce other team skill cooldowns by 2.',{healAll:.28,haste:2},'⌛'],
    ['destiny-rewritten','Destiny Rewritten',58,5,'Reduce the next enemy attack by 80%; heal allies for 35% HP and restore 20 MP.',{weakenBoss:.8,healAll:.35,manaAll:20},'⌛'],
    ['fates-loom','Fate’s Loom',0,0,'Passive: +55 maximum MP and +12 defence.',{passive:{maxMp:55,defence:12}},'◉'],
    ['written-in-the-stars','Written in the Stars',74,6,'Reduce the next enemy attack by 95%; heal allies for 45% HP, shield for 30% HP and reduce other cooldowns by 3.',{weakenBoss:.95,healAll:.45,shield:.3,haste:3},'⌛']
  ]);
  jobBranch('oracle','Lunar Renewal',[
    ['moonwell','Moonwell',24,2,'Restore every ally for 25% HP and 12 MP each.',{healAll:.25,manaAll:12},'✚'],
    ['lunar-vessel','Lunar Vessel',0,0,'Passive: +22 healing and +40 maximum HP.',{passive:{healing:22,maxHp:40}},'✚'],
    ['eclipse-prayer','Eclipse Prayer',38,3,'Deal 260% damage and restore all allies for 32% HP.',{power:2.6,healAll:.32}],
    ['moonrise-covenant','Moonrise Covenant',60,4,'Restore all allies for 65% HP, shield for 35% HP and cleanse weakness.',{healAll:.65,shield:.35,cleanse:true},'✚'],
    ['tidal-moon','Tidal Moon',0,0,'Passive: +30 healing and +55 maximum HP.',{passive:{healing:30,maxHp:55}},'✚'],
    ['full-moon-miracle','Full Moon Miracle',80,6,'Deal 380% damage, restore all allies to full HP, shield for 45% HP and restore 20 MP each.',{power:3.8,healAll:1,shield:.45,manaAll:20}]
  ]);
  // New forks are additive: saved skills keep their IDs, costs and prerequisites.
  // A physical, elemental or hybrid route is available to EVERY base class.
  const SPECIALISATIONS = {
    warrior:{physical:'Steel Discipline',elemental:'Runeblade',hybrid:'Battle Alchemy',element:'fire',names:['Sundering Edge','Steel Temper','Executioner','Worldsplitter','Ember Slash','Rune Attunement','Flameheart','Solar Rupture','Battle Catalyst','Runic Guard','Twin Discipline','Eclipse Breaker']},
    ranger:{physical:'Huntmaster',elemental:'Storm Arrows',hybrid:'Wild Covenant',element:'lightning',names:['Marked Prey','Draw Strength','Perfect Aim','Horizon Breaker','Spark Arrow','Storm Attunement','Thunderheart','Tempest Rain','Pack Signal','Storm Shelter','Twin Discipline','Primal Tempest']},
    mage:{physical:'Spellblade',elemental:'Elementalist',hybrid:'Prismatic Arts',element:'ice',names:['Force Blade','Blade Attunement','Gravity Edge','Rift Cleaver','Prismatic Bolt','Elemental Attunement','Winterheart','Prismatic Cataclysm','Resonance','Prism Shelter','Twin Discipline','Cosmic Convergence']},
    cleric:{physical:'Judicator',elemental:'Hexweaver',hybrid:'Covenant',element:'holy',names:['Fracture Armour','Judicator Training','Crushing Verdict','Heavenly Hammer','Expose Elements','Hex Attunement','Radiant Heart','Daybreak Seal','Shared Weakness','Covenant Ward','Twin Discipline','Grand Absolution']}
  };
  function forkSkill(list, owner, branchName, suffix, name, tier, level, cost, requires, effect, description, mpCost=0, cooldown=0, damageType=null) {
    list.push({id:owner+'-'+suffix,role:JOBS[owner]?.role || owner,...(JOBS[owner]?{job:owner}:{}),branch:branchName,
      name,tier,level,cost,requires,mpCost,cooldown,description,damageType,passive:!!effect.passive,
      effect:{...effect,type:effect.passive?'passive':'active'},icon:damageType==='physical'?'⚔':'✦',animation:owner+'-'+suffix});
  }
  Object.entries(SPECIALISATIONS).forEach(([role,design])=>{
    const list=SKILLS[role], old=list.slice(), names=design.names, id=s=>role+'-'+s;
    const add=(branch,suffix,index,tier,level,cost,requires,effect,description,mp=0,cd=0,type=null)=>forkSkill(list,role,branch,suffix,names[index],tier,level,cost,requires,effect,description,mp,cd,type);
    const physicalDebuff={physical:{amount:.30,turns:4}}, elementalDebuff={elemental:{amount:.30,turns:4}};
    add(design.physical,'physical-opening',0,3,3,2,[old[1].id],{power:1.6,...(role==='cleric'?{expose:physicalDebuff}:{})},role==='cleric'?'Deal 160% physical damage and lower enemy physical defence by 30% for the next 4 allied damaging actions.':'Deal 160% physical damage. Exploits physical defence breaks.',14,1,'physical');
    add(design.physical,'physical-training',1,5,7,3,[id('physical-opening')],{passive:{physicalBonus:.18}},'Passive: +18% physical damage. Basic attacks become physical.');
    add(design.physical,'physical-mastery',2,7,15,4,[id('physical-training'),old[3].id],{passive:{physicalBonus:.22,physicalPierce:.15}},'Passive: +22% physical damage and ignore 15% of physical defence.');
    add(design.physical,'physical-apex',3,9,26,5,[id('physical-mastery'),old[5].id],{power:4.8,expose:{physical:{amount:.25,turns:4}}},'Deal 480% physical damage and lower physical defence by 25% for 4 allied damaging actions.',52,4,'physical');
    add(design.elemental,'elemental-opening',4,3,3,2,[old[6].id],{power:1.6,...(role==='cleric'?{expose:elementalDebuff}:{})},role==='cleric'?'Deal 160% holy damage and lower ALL elemental defences by 30% for the next 4 allied damaging actions.':'Deal 160% '+design.element+' damage. Exploits elemental defence breaks.',16,1,design.element);
    add(design.elemental,'elemental-training',5,5,7,3,[id('elemental-opening')],{passive:{elementalBonus:.18,attackElement:design.element}},'Passive: +18% elemental damage. Basic attacks become '+design.element+' unless physical training is stronger.');
    add(design.elemental,'elemental-mastery',6,7,15,4,[id('elemental-training'),old[9].id],{passive:{elementalBonus:.22,elementalPierce:.15}},'Passive: +22% elemental damage and ignore 15% of elemental defence.');
    add(design.elemental,'elemental-apex',7,9,26,5,[id('elemental-mastery'),old[11].id],{power:4.8,expose:{elemental:{amount:.25,turns:4}}},'Deal 480% '+design.element+' damage and lower elemental defences by 25% for 4 allied damaging actions.',56,4,design.element);
    add(design.hybrid,'shared-weakness',8,4,5,2,[id('physical-opening'),id('elemental-opening')],{power:1,expose:{physical:{amount:.20,turns:4},elemental:{amount:.20,turns:4}}},'Deal 100% damage and lower physical AND elemental defences by 20% for 4 allied damaging actions. Teammates share the opening.',22,2,design.element);
    add(design.hybrid,'covenant-ward',9,6,12,3,[id('shared-weakness'),old[12].id],{shield:.22,manaAll:10},'Shield every ally for 22% HP and restore 10 MP. A support action does not consume defence breaks.',30,3);
    add(design.hybrid,'twin-discipline',10,8,22,4,[id('covenant-ward'),id('physical-training'),id('elemental-training')],{passive:{physicalBonus:.12,elementalBonus:.12,exposureBonus:.15}},'Passive: +12% physical and elemental damage; +15% damage against the matching defence break.');
    add(design.hybrid,'convergence-apex',11,10,35,6,[id('twin-discipline'),id('physical-apex'),id('elemental-apex')],{power:5.8,healAll:.15,expose:{physical:{amount:.35,turns:5},elemental:{amount:.35,turns:5}}},'Deal 580% adaptive damage, heal the party for 15% HP and lower both defences by 35% for 5 allied damaging actions. Uses your strongest damage discipline.',72,5,'adaptive');
  });
  // Advanced jobs gain their own branching keystones. They require independent
  // paths within that job rather than silently changing a saved legacy skill.
  Object.entries(JOB_SKILLS).forEach(([job,list])=>{
    const old=list.slice(), type=SPECIALISATIONS[JOBS[job].role].element, id=s=>job+'-'+s;
    const add=(suffix,name,tier,level,cost,requires,effect,description,mp=0,cd=0,channel=null)=>forkSkill(list,job,'Ascendant Arts',suffix,name,tier,level,cost,requires,effect,description,mp,cd,channel);
    add('steel-keystone','Steel Keystone',7,36,4,[old[3].id,old[7].id],{passive:{physicalBonus:.20,physicalPierce:.10}},'Passive: +20% physical damage and ignore 10% physical defence.');
    add('elemental-keystone','Elemental Keystone',7,36,4,[old[9].id,old[13].id],{passive:{elementalBonus:.20,elementalPierce:.10,attackElement:type}},'Passive: +20% elemental damage and ignore 10% elemental defence.');
    add('steel-ascension','Steel Ascension',8,40,5,[id('steel-keystone'),old[5].id],{power:5.2,expose:{physical:{amount:.35,turns:4}}},'Deal 520% physical damage and lower physical defence by 35% for 4 allied damaging actions.',65,4,'physical');
    add('elemental-ascension','Elemental Ascension',8,40,5,[id('elemental-keystone'),old[11].id],{power:5.2,expose:{elemental:{amount:.35,turns:4}}},'Deal 520% '+type+' damage and lower elemental defences by 35% for 4 allied damaging actions.',68,4,type);
    add('party-resonance','Party Resonance',9,45,5,[id('steel-keystone'),id('elemental-keystone'),old[17].id],{passive:{physicalBonus:.12,elementalBonus:.12,exposureBonus:.20}},'Passive: +12% to both damage disciplines; +20% damage against the matching defence break.');
    add('worldweaver','Worldweaver',10,50,7,[id('steel-ascension'),id('elemental-ascension'),id('party-resonance')],{power:6.5,healAll:.2,shield:.2,expose:{physical:{amount:.40,turns:5},elemental:{amount:.40,turns:5}}},'Deal 650% adaptive damage, heal and shield the party for 20% HP and lower both defences by 40% for 5 allied damaging actions.',90,6,'adaptive');
  });
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
  // Fifty illustrated relics; atlas positions are stable saved-content identifiers.
  const TREASURE_COLLECTION = [
    ['copper-sabre','Copper Sabre','common','+5 attack.',{damage:5},'⚔'],
    ['buckler-of-bravery','Buckler of Bravery','common','+4 defence.',{defence:4},'▣'],
    ['crimson-vial-charm','Crimson Vial Charm','common','+18 maximum HP.',{maxHp:18},'♥'],
    ['azure-vial-charm','Azure Vial Charm','common','+15 maximum MP.',{maxMp:15},'✦'],
    ['healers-ribbon','Healer’s Ribbon','common','+5 healing and +8 maximum MP.',{healing:5,maxMp:8},'✚'],
    ['scouts-feather','Scout’s Feather','common','+4% critical chance.',{critChance:.04},'➶'],
    ['oak-leaf-pendant','Oak Leaf Pendant','common','+12 maximum HP and +2 defence.',{maxHp:12,defence:2},'♣'],
    ['apprentice-grimoire','Apprentice Grimoire','common','+3 attack and +10 maximum MP.',{damage:3,maxMp:10},'✦'],
    ['iron-gauntlet','Iron Gauntlet','common','+3 attack and +2 defence.',{damage:3,defence:2},'⚔'],
    ['amber-band','Amber Band','common','+2 attack and +3% critical chance.',{damage:2,critChance:.03},'♦'],
    ['ember-sabre','Ember Sabre','uncommon','+8 attack and +2% critical chance.',{damage:8,critChance:.02},'⚔'],
    ['mossguard-shield','Mossguard Shield','uncommon','+7 defence and +18 maximum HP.',{defence:7,maxHp:18},'▣'],
    ['verdant-flask-charm','Verdant Flask Charm','uncommon','+35 maximum HP and +4 healing.',{maxHp:35,healing:4},'✚'],
    ['tideglass-pendant','Tideglass Pendant','uncommon','+25 maximum MP and restore 2 MP per correct answer.',{maxMp:25,manaRegen:2},'✦'],
    ['moonpetal-brooch','Moonpetal Brooch','uncommon','+9 healing and +15 maximum HP.',{healing:9,maxHp:15},'✚'],
    ['windfletch-quiver','Windfletch Quiver','uncommon','+6 attack and +7% critical chance.',{damage:6,critChance:.07},'➶'],
    ['foxtrail-boots','Foxtrail Boots','uncommon','+5 defence and +6% critical chance.',{defence:5,critChance:.06},'»'],
    ['runecarved-wand','Runecarved Wand','uncommon','+7 attack and +18 maximum MP.',{damage:7,maxMp:18},'✦'],
    ['thornvine-ring','Thornvine Ring','uncommon','+6 attack; heal for 4% of damage dealt.',{damage:6,leech:.04},'♣'],
    ['sunwoven-cape','Sunwoven Cape','uncommon','+22 maximum HP, +16 maximum MP and +3 defence.',{maxHp:22,maxMp:16,defence:3},'▣'],
    ['ruby-fang','Ruby Fang','rare','+14 attack; heal for 8% of damage dealt.',{damage:14,leech:.08},'⚔'],
    ['sapphire-bastion','Sapphire Bastion','rare','+13 defence and +35 maximum HP.',{defence:13,maxHp:35},'▣'],
    ['phoenix-plume','Phoenix Plume','rare','+45 maximum HP and +12 healing.',{maxHp:45,healing:12},'✚'],
    ['prismatic-compass','Prismatic Compass','rare','+38 maximum MP and restore 4 MP per correct answer.',{maxMp:38,manaRegen:4},'✦'],
    ['frostbite-bow','Frostbite Bow','rare','+12 attack and +12% critical chance.',{damage:12,critChance:.12},'➶'],
    ['celestial-censer','Celestial Censer','rare','+17 healing and +28 maximum MP.',{healing:17,maxMp:28},'✚'],
    ['stormglass-orb','Stormglass Orb','rare','+13 attack and +32 maximum MP.',{damage:13,maxMp:32},'✦'],
    ['lions-heart-medal','Lion’s Heart Medal','rare','+55 maximum HP and +8 attack.',{maxHp:55,damage:8},'♥'],
    ['silver-thread-gloves','Silver Thread Gloves','rare','+10 attack, +8% critical chance and +0.15 critical multiplier.',{damage:10,critChance:.08,critMultiplier:.15},'⚔'],
    ['starlit-tiara','Starlit Tiara','rare','+32 maximum MP, +8 defence and +8 healing.',{maxMp:32,defence:8,healing:8},'♛'],
    ['voidsteel-katana','Voidsteel Katana','epic','+20 attack and ignore half of enemy armour.',{damage:20,pierce:.5},'⚔'],
    ['dragonheart-aegis','Dragonheart Aegis','epic','+19 defence and +65 maximum HP.',{defence:19,maxHp:65},'▣'],
    ['astral-bottle-relic','Astral Bottle Relic','epic','+55 maximum MP, +16 healing and restore 5 MP per correct answer.',{maxMp:55,healing:16,manaRegen:5},'✦'],
    ['cometburst-relic','Cometburst Relic','epic','+22 attack and +0.25 critical multiplier.',{damage:22,critMultiplier:.25},'♦'],
    ['thunderwing-quiver','Thunderwing Quiver','epic','+18 attack and +18% critical chance.',{damage:18,critChance:.18},'➶'],
    ['eclipse-grimoire','Eclipse Grimoire','epic','+18 attack, +50 maximum MP and +12 healing.',{damage:18,maxMp:50,healing:12},'✦'],
    ['bloodmoon-pendant','Bloodmoon Pendant','epic','+16 attack; heal for 20% of damage dealt.',{damage:16,leech:.2},'♥'],
    ['spiritwood-totem','Spiritwood Totem','epic','+60 maximum HP, +14 healing and +10 defence.',{maxHp:60,healing:14,defence:10},'♣'],
    ['solar-sovereign-blade','Solar Sovereign Blade','legendary','+28 attack; each damaging correct action heals the team for 6% HP.',{damage:28,teamLeech:.06},'⚔'],
    ['worldtree-seed','Worldtree Seed','legendary','+115 maximum HP, +15 defence and restore 8 MP per correct answer.',{maxHp:115,defence:15,manaRegen:8},'♣'],
    ['titanforge-hammer','Titanforge Hammer','legendary','+32 attack, +12 defence and ignore half of enemy armour.',{damage:32,defence:12,pierce:.5},'⚔'],
    ['seraphim-halo','Seraphim Halo','legendary','+30 healing and +50 maximum MP; each damaging correct action heals the team for 8% HP.',{healing:30,maxMp:50,teamLeech:.08},'✚'],
    ['tempest-longbow','Tempest Longbow','legendary','+25 attack, +22% critical chance and +0.35 critical multiplier.',{damage:25,critChance:.22,critMultiplier:.35},'➶'],
    ['infinity-mana-lantern','Infinity Mana Lantern','legendary','+80 maximum MP, +18 attack and restore 10 MP per correct answer.',{maxMp:80,damage:18,manaRegen:10},'✦'],
    ['aegis-of-the-mountain','Aegis of the Mountain','legendary','+28 defence and +100 maximum HP.',{defence:28,maxHp:100},'▣'],
    ['starweaver-scepter','Starweaver Scepter','legendary','+24 attack and +20 healing; each damaging correct action restores 4 MP to the team.',{damage:24,healing:20,teamMana:4},'✦'],
    ['eternal-phoenix-diadem','Eternal Phoenix Diadem','mythical','Once per encounter, the first fallen teammate rises at 50% HP. +100 HP, +20 defence and +18 healing.',{maxHp:100,defence:20,healing:18,revive:true},'♛'],
    ['hourglass-of-infinity','Hourglass of Infinity','mythical','Every third damaging correct action echoes for double damage. +30 attack, +60 MP and restore 6 MP per correct answer.',{damage:30,maxMp:60,manaRegen:6,echo:true},'⌛'],
    ['reality-cleaver','Reality Cleaver','mythical','All attacks ignore armour and guard. +45 attack; heal for 12% of damage dealt.',{damage:45,pierce:1,ignoreGuard:true,leech:.12},'⚔'],
    ['heart-of-the-constellation','Heart of the Constellation','mythical','Each damaging correct action heals the team for 15% HP and restores 8 MP. +25 attack and +60 HP.',{damage:25,maxHp:60,teamLeech:.15,teamMana:8},'✦']
  ];
  TREASURE_COLLECTION.forEach((entry,index)=>{
    const [id,name,rarity,description,effect,icon]=entry;
    item(id,name,rarity,'equipment','While equipped: '+description,effect,icon);
    ITEMS[id].art={sheet:'items-'+(Math.floor(index/10)+1),col:index%5,row:Math.floor(index%10/5)};
    ITEMS[id].collection='treasure-fifty';
  });
  // Original rewards retain their IDs and mechanics and reuse the matching art archetype.
  const LEGACY_ART={
    'red-potion':'crimson-vial-charm','blue-ether':'azure-vial-charm','iron-charm':'iron-gauntlet','bronze-blade':'copper-sabre',
    'fire-flask':'crimson-vial-charm','party-tonic':'verdant-flask-charm','oak-amulet':'oak-leaf-pendant','hunters-band':'amber-band',
    'phoenix-feather':'phoenix-plume','mana-prism':'stormglass-orb','crimson-edge':'ruby-fang','silver-aegis':'sapphire-bastion',
    'elixir':'astral-bottle-relic','starbomb':'cometburst-relic','storm-quiver':'thunderwing-quiver','moon-codex':'eclipse-grimoire',
    'dawnbringer':'solar-sovereign-blade','worldroot':'worldtree-seed','phoenix-crown':'eternal-phoenix-diadem',
    'chronicle':'hourglass-of-infinity','void-edge':'reality-cleaver','sovereign-star':'heart-of-the-constellation'
  };
  Object.entries(LEGACY_ART).forEach(([legacy,id])=>{ITEMS[legacy].art={...ITEMS[id].art};});
  // Full character armory: exactly twenty choices in each of ten gear slots, plus thirty companions.
  const EQUIPMENT_SLOTS = {
    "helm": {
      "name": "Helm",
      "icon": "♛"
    },
    "torso": {
      "name": "Torso",
      "icon": "▣"
    },
    "gloves": {
      "name": "Gloves",
      "icon": "✊"
    },
    "legs": {
      "name": "Legs",
      "icon": "▥"
    },
    "boots": {
      "name": "Boots",
      "icon": "»"
    },
    "amulet": {
      "name": "Amulet",
      "icon": "◆"
    },
    "ring1": {
      "name": "Ring 1",
      "icon": "◉"
    },
    "ring2": {
      "name": "Ring 2",
      "icon": "◎"
    },
    "mainHand": {
      "name": "Main Hand",
      "icon": "⚔"
    },
    "offHand": {
      "name": "Off Hand",
      "icon": "▣"
    },
    "pet": {
      "name": "Pet",
      "icon": "♣"
    }
  };
  const LEGACY_SLOTS = {
    "scouts-feather": "helm",
    "starlit-tiara": "helm",
    "phoenix-crown": "helm",
    "eternal-phoenix-diadem": "helm",
    "seraphim-halo": "helm",
    "sunwoven-cape": "torso",
    "worldroot": "torso",
    "worldtree-seed": "torso",
    "spiritwood-totem": "torso",
    "iron-charm": "gloves",
    "iron-gauntlet": "gloves",
    "silver-thread-gloves": "gloves",
    "foxtrail-boots": "boots",
    "oak-amulet": "amulet",
    "crimson-vial-charm": "amulet",
    "azure-vial-charm": "amulet",
    "healers-ribbon": "amulet",
    "oak-leaf-pendant": "amulet",
    "verdant-flask-charm": "amulet",
    "tideglass-pendant": "amulet",
    "moonpetal-brooch": "amulet",
    "phoenix-plume": "amulet",
    "prismatic-compass": "amulet",
    "celestial-censer": "amulet",
    "lions-heart-medal": "amulet",
    "astral-bottle-relic": "amulet",
    "cometburst-relic": "amulet",
    "bloodmoon-pendant": "amulet",
    "sovereign-star": "amulet",
    "heart-of-the-constellation": "amulet",
    "hourglass-of-infinity": "amulet",
    "hunters-band": "ring1",
    "amber-band": "ring1",
    "thornvine-ring": "ring1",
    "bronze-blade": "mainHand",
    "crimson-edge": "mainHand",
    "dawnbringer": "mainHand",
    "void-edge": "mainHand",
    "copper-sabre": "mainHand",
    "ember-sabre": "mainHand",
    "runecarved-wand": "mainHand",
    "ruby-fang": "mainHand",
    "frostbite-bow": "mainHand",
    "voidsteel-katana": "mainHand",
    "solar-sovereign-blade": "mainHand",
    "titanforge-hammer": "mainHand",
    "tempest-longbow": "mainHand",
    "starweaver-scepter": "mainHand",
    "reality-cleaver": "mainHand",
    "silver-aegis": "offHand",
    "storm-quiver": "offHand",
    "moon-codex": "offHand",
    "buckler-of-bravery": "offHand",
    "apprentice-grimoire": "offHand",
    "mossguard-shield": "offHand",
    "windfletch-quiver": "offHand",
    "sapphire-bastion": "offHand",
    "stormglass-orb": "offHand",
    "dragonheart-aegis": "offHand",
    "thunderwing-quiver": "offHand",
    "eclipse-grimoire": "offHand",
    "infinity-mana-lantern": "offHand",
    "aegis-of-the-mountain": "offHand",
    "chronicle": "offHand"
  };
  Object.entries(LEGACY_SLOTS).forEach(([id,slot])=>{ITEMS[id].slot=slot;});
  const ARMORY_ITEMS = [
    {
      "id": "helm-tideglass-helm",
      "name": "Tideglass Helm",
      "rarity": "uncommon",
      "type": "equipment",
      "slot": "helm",
      "description": "While equipped: +12 maximum MP, +3 defence.",
      "effect": {
        "maxMp": 12,
        "defence": 3
      },
      "icon": "♛",
      "art": {
        "sheet": "gear-helm",
        "col": 0,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "helm-moonpetal-crown",
      "name": "Moonpetal Crown",
      "rarity": "epic",
      "type": "equipment",
      "slot": "helm",
      "description": "While equipped: +20 maximum MP, +5 defence.",
      "effect": {
        "maxMp": 20,
        "defence": 5
      },
      "icon": "♛",
      "art": {
        "sheet": "gear-helm",
        "col": 1,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "helm-foxfire-diadem",
      "name": "Foxfire Diadem",
      "rarity": "uncommon",
      "type": "equipment",
      "slot": "helm",
      "description": "While equipped: +11 maximum MP, +3 defence.",
      "effect": {
        "maxMp": 11,
        "defence": 3
      },
      "icon": "♛",
      "art": {
        "sheet": "gear-helm",
        "col": 2,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "helm-thunder-hood",
      "name": "Thunder Hood",
      "rarity": "uncommon",
      "type": "equipment",
      "slot": "helm",
      "description": "While equipped: +12 maximum MP, +3 defence.",
      "effect": {
        "maxMp": 12,
        "defence": 3
      },
      "icon": "♛",
      "art": {
        "sheet": "gear-helm",
        "col": 3,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "helm-sunwoven-helm",
      "name": "Sunwoven Helm",
      "rarity": "rare",
      "type": "equipment",
      "slot": "helm",
      "description": "While equipped: +15 maximum MP, +4 defence.",
      "effect": {
        "maxMp": 15,
        "defence": 4
      },
      "icon": "♛",
      "art": {
        "sheet": "gear-helm",
        "col": 4,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "helm-prismatic-crown",
      "name": "Prismatic Crown",
      "rarity": "rare",
      "type": "equipment",
      "slot": "helm",
      "description": "While equipped: +16 maximum MP, +4 defence.",
      "effect": {
        "maxMp": 16,
        "defence": 4
      },
      "icon": "♛",
      "art": {
        "sheet": "gear-helm",
        "col": 0,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "helm-ruby-diadem",
      "name": "Ruby Diadem",
      "rarity": "rare",
      "type": "equipment",
      "slot": "helm",
      "description": "While equipped: +17 maximum MP, +4 defence.",
      "effect": {
        "maxMp": 17,
        "defence": 4
      },
      "icon": "♛",
      "art": {
        "sheet": "gear-helm",
        "col": 1,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "helm-sapphire-hood",
      "name": "Sapphire Hood",
      "rarity": "rare",
      "type": "equipment",
      "slot": "helm",
      "description": "While equipped: +15 maximum MP, +4 defence.",
      "effect": {
        "maxMp": 15,
        "defence": 4
      },
      "icon": "♛",
      "art": {
        "sheet": "gear-helm",
        "col": 2,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "helm-spiritwood-helm",
      "name": "Spiritwood Helm",
      "rarity": "epic",
      "type": "equipment",
      "slot": "helm",
      "description": "While equipped: +21 maximum MP, +5 defence.",
      "effect": {
        "maxMp": 21,
        "defence": 5
      },
      "icon": "♛",
      "art": {
        "sheet": "gear-helm",
        "col": 3,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "helm-dragonheart-crown",
      "name": "Dragonheart Crown",
      "rarity": "epic",
      "type": "equipment",
      "slot": "helm",
      "description": "While equipped: +22 maximum MP, +5 defence.",
      "effect": {
        "maxMp": 22,
        "defence": 5
      },
      "icon": "♛",
      "art": {
        "sheet": "gear-helm",
        "col": 4,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "helm-bloodmoon-diadem",
      "name": "Bloodmoon Diadem",
      "rarity": "epic",
      "type": "equipment",
      "slot": "helm",
      "description": "While equipped: +20 maximum MP, +5 defence.",
      "effect": {
        "maxMp": 20,
        "defence": 5
      },
      "icon": "♛",
      "art": {
        "sheet": "gear-helm",
        "col": 0,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "helm-starweaver-hood",
      "name": "Starweaver Hood",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "helm",
      "description": "While equipped: +26 maximum MP, +6 defence.",
      "effect": {
        "maxMp": 26,
        "defence": 6
      },
      "icon": "♛",
      "art": {
        "sheet": "gear-helm",
        "col": 1,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "helm-solar-helm",
      "name": "Solar Helm",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "helm",
      "description": "While equipped: +27 maximum MP, +6 defence.",
      "effect": {
        "maxMp": 27,
        "defence": 6
      },
      "icon": "♛",
      "art": {
        "sheet": "gear-helm",
        "col": 2,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "helm-infinity-crown",
      "name": "Infinity Crown",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "helm",
      "description": "While equipped: +25 maximum MP, +6 defence.",
      "effect": {
        "maxMp": 25,
        "defence": 6
      },
      "icon": "♛",
      "art": {
        "sheet": "gear-helm",
        "col": 3,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "helm-eternal-diadem",
      "name": "Eternal Diadem",
      "rarity": "mythical",
      "type": "equipment",
      "slot": "helm",
      "description": "While equipped: +31 maximum MP, +7 defence.",
      "effect": {
        "maxMp": 31,
        "defence": 7
      },
      "icon": "♛",
      "art": {
        "sheet": "gear-helm",
        "col": 4,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "torso-copper-vest",
      "name": "Copper Vest",
      "rarity": "common",
      "type": "equipment",
      "slot": "torso",
      "description": "While equipped: +14 maximum HP, +2 defence.",
      "effect": {
        "maxHp": 14,
        "defence": 2
      },
      "icon": "▣",
      "art": {
        "sheet": "gear-torso",
        "col": 4,
        "row": 0,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "torso-tideglass-coat",
      "name": "Tideglass Coat",
      "rarity": "rare",
      "type": "equipment",
      "slot": "torso",
      "description": "While equipped: +30 maximum HP, +6 defence.",
      "effect": {
        "maxHp": 30,
        "defence": 6
      },
      "icon": "▣",
      "art": {
        "sheet": "gear-torso",
        "col": 0,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "torso-moonpetal-cuirass",
      "name": "Moonpetal Cuirass",
      "rarity": "mythical",
      "type": "equipment",
      "slot": "torso",
      "description": "While equipped: +61 maximum HP, +12 defence.",
      "effect": {
        "maxHp": 61,
        "defence": 12
      },
      "icon": "▣",
      "art": {
        "sheet": "gear-torso",
        "col": 1,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "torso-foxfire-mantle",
      "name": "Foxfire Mantle",
      "rarity": "uncommon",
      "type": "equipment",
      "slot": "torso",
      "description": "While equipped: +22 maximum HP, +4 defence.",
      "effect": {
        "maxHp": 22,
        "defence": 4
      },
      "icon": "▣",
      "art": {
        "sheet": "gear-torso",
        "col": 2,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "torso-thunder-vest",
      "name": "Thunder Vest",
      "rarity": "uncommon",
      "type": "equipment",
      "slot": "torso",
      "description": "While equipped: +23 maximum HP, +4 defence.",
      "effect": {
        "maxHp": 23,
        "defence": 4
      },
      "icon": "▣",
      "art": {
        "sheet": "gear-torso",
        "col": 3,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "torso-sunwoven-coat",
      "name": "Sunwoven Coat",
      "rarity": "rare",
      "type": "equipment",
      "slot": "torso",
      "description": "While equipped: +34 maximum HP, +6 defence.",
      "effect": {
        "maxHp": 34,
        "defence": 6
      },
      "icon": "▣",
      "art": {
        "sheet": "gear-torso",
        "col": 4,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "torso-prismatic-cuirass",
      "name": "Prismatic Cuirass",
      "rarity": "rare",
      "type": "equipment",
      "slot": "torso",
      "description": "While equipped: +30 maximum HP, +6 defence.",
      "effect": {
        "maxHp": 30,
        "defence": 6
      },
      "icon": "▣",
      "art": {
        "sheet": "gear-torso",
        "col": 0,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "torso-ruby-mantle",
      "name": "Ruby Mantle",
      "rarity": "rare",
      "type": "equipment",
      "slot": "torso",
      "description": "While equipped: +31 maximum HP, +6 defence.",
      "effect": {
        "maxHp": 31,
        "defence": 6
      },
      "icon": "▣",
      "art": {
        "sheet": "gear-torso",
        "col": 1,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "torso-sapphire-vest",
      "name": "Sapphire Vest",
      "rarity": "rare",
      "type": "equipment",
      "slot": "torso",
      "description": "While equipped: +32 maximum HP, +6 defence.",
      "effect": {
        "maxHp": 32,
        "defence": 6
      },
      "icon": "▣",
      "art": {
        "sheet": "gear-torso",
        "col": 2,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "torso-spiritwood-coat",
      "name": "Spiritwood Coat",
      "rarity": "epic",
      "type": "equipment",
      "slot": "torso",
      "description": "While equipped: +43 maximum HP, +8 defence.",
      "effect": {
        "maxHp": 43,
        "defence": 8
      },
      "icon": "▣",
      "art": {
        "sheet": "gear-torso",
        "col": 3,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "torso-dragonheart-cuirass",
      "name": "Dragonheart Cuirass",
      "rarity": "epic",
      "type": "equipment",
      "slot": "torso",
      "description": "While equipped: +44 maximum HP, +8 defence.",
      "effect": {
        "maxHp": 44,
        "defence": 8
      },
      "icon": "▣",
      "art": {
        "sheet": "gear-torso",
        "col": 4,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "torso-bloodmoon-mantle",
      "name": "Bloodmoon Mantle",
      "rarity": "epic",
      "type": "equipment",
      "slot": "torso",
      "description": "While equipped: +40 maximum HP, +8 defence.",
      "effect": {
        "maxHp": 40,
        "defence": 8
      },
      "icon": "▣",
      "art": {
        "sheet": "gear-torso",
        "col": 0,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "torso-starweaver-vest",
      "name": "Starweaver Vest",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "torso",
      "description": "While equipped: +51 maximum HP, +10 defence.",
      "effect": {
        "maxHp": 51,
        "defence": 10
      },
      "icon": "▣",
      "art": {
        "sheet": "gear-torso",
        "col": 1,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "torso-solar-coat",
      "name": "Solar Coat",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "torso",
      "description": "While equipped: +52 maximum HP, +10 defence.",
      "effect": {
        "maxHp": 52,
        "defence": 10
      },
      "icon": "▣",
      "art": {
        "sheet": "gear-torso",
        "col": 2,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "torso-infinity-cuirass",
      "name": "Infinity Cuirass",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "torso",
      "description": "While equipped: +53 maximum HP, +10 defence.",
      "effect": {
        "maxHp": 53,
        "defence": 10
      },
      "icon": "▣",
      "art": {
        "sheet": "gear-torso",
        "col": 3,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "torso-eternal-mantle",
      "name": "Eternal Mantle",
      "rarity": "mythical",
      "type": "equipment",
      "slot": "torso",
      "description": "While equipped: +64 maximum HP, +12 defence.",
      "effect": {
        "maxHp": 64,
        "defence": 12
      },
      "icon": "▣",
      "art": {
        "sheet": "gear-torso",
        "col": 4,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "gloves-sandstone-wraps",
      "name": "Sandstone Wraps",
      "rarity": "uncommon",
      "type": "equipment",
      "slot": "gloves",
      "description": "While equipped: +4 attack, +2% critical chance.",
      "effect": {
        "damage": 4,
        "critChance": 0.02
      },
      "icon": "✊",
      "art": {
        "sheet": "gear-gloves",
        "col": 3,
        "row": 0,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "gloves-copper-grips",
      "name": "Copper Grips",
      "rarity": "epic",
      "type": "equipment",
      "slot": "gloves",
      "description": "While equipped: +9 attack, +4% critical chance.",
      "effect": {
        "damage": 9,
        "critChance": 0.04
      },
      "icon": "✊",
      "art": {
        "sheet": "gear-gloves",
        "col": 4,
        "row": 0,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "gloves-tideglass-gloves",
      "name": "Tideglass Gloves",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "gloves",
      "description": "While equipped: +12 attack, +5% critical chance.",
      "effect": {
        "damage": 12,
        "critChance": 0.05
      },
      "icon": "✊",
      "art": {
        "sheet": "gear-gloves",
        "col": 0,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "gloves-moonpetal-gauntlets",
      "name": "Moonpetal Gauntlets",
      "rarity": "mythical",
      "type": "equipment",
      "slot": "gloves",
      "description": "While equipped: +12 attack, +6% critical chance.",
      "effect": {
        "damage": 12,
        "critChance": 0.06
      },
      "icon": "✊",
      "art": {
        "sheet": "gear-gloves",
        "col": 1,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "gloves-foxfire-wraps",
      "name": "Foxfire Wraps",
      "rarity": "uncommon",
      "type": "equipment",
      "slot": "gloves",
      "description": "While equipped: +5 attack, +2% critical chance.",
      "effect": {
        "damage": 5,
        "critChance": 0.02
      },
      "icon": "✊",
      "art": {
        "sheet": "gear-gloves",
        "col": 2,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "gloves-thunder-grips",
      "name": "Thunder Grips",
      "rarity": "uncommon",
      "type": "equipment",
      "slot": "gloves",
      "description": "While equipped: +6 attack, +2% critical chance.",
      "effect": {
        "damage": 6,
        "critChance": 0.02
      },
      "icon": "✊",
      "art": {
        "sheet": "gear-gloves",
        "col": 3,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "gloves-sunwoven-gloves",
      "name": "Sunwoven Gloves",
      "rarity": "rare",
      "type": "equipment",
      "slot": "gloves",
      "description": "While equipped: +6 attack, +3% critical chance.",
      "effect": {
        "damage": 6,
        "critChance": 0.03
      },
      "icon": "✊",
      "art": {
        "sheet": "gear-gloves",
        "col": 4,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "gloves-prismatic-gauntlets",
      "name": "Prismatic Gauntlets",
      "rarity": "rare",
      "type": "equipment",
      "slot": "gloves",
      "description": "While equipped: +7 attack, +3% critical chance.",
      "effect": {
        "damage": 7,
        "critChance": 0.03
      },
      "icon": "✊",
      "art": {
        "sheet": "gear-gloves",
        "col": 0,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "gloves-ruby-wraps",
      "name": "Ruby Wraps",
      "rarity": "rare",
      "type": "equipment",
      "slot": "gloves",
      "description": "While equipped: +8 attack, +3% critical chance.",
      "effect": {
        "damage": 8,
        "critChance": 0.03
      },
      "icon": "✊",
      "art": {
        "sheet": "gear-gloves",
        "col": 1,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "gloves-sapphire-grips",
      "name": "Sapphire Grips",
      "rarity": "rare",
      "type": "equipment",
      "slot": "gloves",
      "description": "While equipped: +6 attack, +3% critical chance.",
      "effect": {
        "damage": 6,
        "critChance": 0.03
      },
      "icon": "✊",
      "art": {
        "sheet": "gear-gloves",
        "col": 2,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "gloves-spiritwood-gloves",
      "name": "Spiritwood Gloves",
      "rarity": "epic",
      "type": "equipment",
      "slot": "gloves",
      "description": "While equipped: +9 attack, +4% critical chance.",
      "effect": {
        "damage": 9,
        "critChance": 0.04
      },
      "icon": "✊",
      "art": {
        "sheet": "gear-gloves",
        "col": 3,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "gloves-dragonheart-gauntlets",
      "name": "Dragonheart Gauntlets",
      "rarity": "epic",
      "type": "equipment",
      "slot": "gloves",
      "description": "While equipped: +10 attack, +4% critical chance.",
      "effect": {
        "damage": 10,
        "critChance": 0.04
      },
      "icon": "✊",
      "art": {
        "sheet": "gear-gloves",
        "col": 4,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "gloves-bloodmoon-wraps",
      "name": "Bloodmoon Wraps",
      "rarity": "epic",
      "type": "equipment",
      "slot": "gloves",
      "description": "While equipped: +8 attack, +4% critical chance.",
      "effect": {
        "damage": 8,
        "critChance": 0.04
      },
      "icon": "✊",
      "art": {
        "sheet": "gear-gloves",
        "col": 0,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "gloves-starweaver-grips",
      "name": "Starweaver Grips",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "gloves",
      "description": "While equipped: +11 attack, +5% critical chance.",
      "effect": {
        "damage": 11,
        "critChance": 0.05
      },
      "icon": "✊",
      "art": {
        "sheet": "gear-gloves",
        "col": 1,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "gloves-solar-gloves",
      "name": "Solar Gloves",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "gloves",
      "description": "While equipped: +12 attack, +5% critical chance.",
      "effect": {
        "damage": 12,
        "critChance": 0.05
      },
      "icon": "✊",
      "art": {
        "sheet": "gear-gloves",
        "col": 2,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "gloves-infinity-gauntlets",
      "name": "Infinity Gauntlets",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "gloves",
      "description": "While equipped: +10 attack, +5% critical chance.",
      "effect": {
        "damage": 10,
        "critChance": 0.05
      },
      "icon": "✊",
      "art": {
        "sheet": "gear-gloves",
        "col": 3,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "gloves-eternal-wraps",
      "name": "Eternal Wraps",
      "rarity": "mythical",
      "type": "equipment",
      "slot": "gloves",
      "description": "While equipped: +13 attack, +6% critical chance.",
      "effect": {
        "damage": 13,
        "critChance": 0.06
      },
      "icon": "✊",
      "art": {
        "sheet": "gear-gloves",
        "col": 4,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "legs-nettle-legguards",
      "name": "Nettle Legguards",
      "rarity": "common",
      "type": "equipment",
      "slot": "legs",
      "description": "While equipped: +8 maximum HP, +1 defence.",
      "effect": {
        "maxHp": 8,
        "defence": 1
      },
      "icon": "▥",
      "art": {
        "sheet": "gear-legs",
        "col": 0,
        "row": 0,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "legs-cinder-greaves",
      "name": "Cinder Greaves",
      "rarity": "uncommon",
      "type": "equipment",
      "slot": "legs",
      "description": "While equipped: +17 maximum HP, +2 defence.",
      "effect": {
        "maxHp": 17,
        "defence": 2
      },
      "icon": "▥",
      "art": {
        "sheet": "gear-legs",
        "col": 1,
        "row": 0,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "legs-frost-trousers",
      "name": "Frost Trousers",
      "rarity": "rare",
      "type": "equipment",
      "slot": "legs",
      "description": "While equipped: +26 maximum HP, +3 defence.",
      "effect": {
        "maxHp": 26,
        "defence": 3
      },
      "icon": "▥",
      "art": {
        "sheet": "gear-legs",
        "col": 2,
        "row": 0,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "legs-sandstone-leggings",
      "name": "Sandstone Leggings",
      "rarity": "epic",
      "type": "equipment",
      "slot": "legs",
      "description": "While equipped: +35 maximum HP, +4 defence.",
      "effect": {
        "maxHp": 35,
        "defence": 4
      },
      "icon": "▥",
      "art": {
        "sheet": "gear-legs",
        "col": 3,
        "row": 0,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "legs-copper-legguards",
      "name": "Copper Legguards",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "legs",
      "description": "While equipped: +40 maximum HP, +5 defence.",
      "effect": {
        "maxHp": 40,
        "defence": 5
      },
      "icon": "▥",
      "art": {
        "sheet": "gear-legs",
        "col": 4,
        "row": 0,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "legs-tideglass-greaves",
      "name": "Tideglass Greaves",
      "rarity": "mythical",
      "type": "equipment",
      "slot": "legs",
      "description": "While equipped: +49 maximum HP, +6 defence.",
      "effect": {
        "maxHp": 49,
        "defence": 6
      },
      "icon": "▥",
      "art": {
        "sheet": "gear-legs",
        "col": 0,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "legs-moonpetal-trousers",
      "name": "Moonpetal Trousers",
      "rarity": "uncommon",
      "type": "equipment",
      "slot": "legs",
      "description": "While equipped: +18 maximum HP, +2 defence.",
      "effect": {
        "maxHp": 18,
        "defence": 2
      },
      "icon": "▥",
      "art": {
        "sheet": "gear-legs",
        "col": 1,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "legs-foxfire-leggings",
      "name": "Foxfire Leggings",
      "rarity": "uncommon",
      "type": "equipment",
      "slot": "legs",
      "description": "While equipped: +19 maximum HP, +2 defence.",
      "effect": {
        "maxHp": 19,
        "defence": 2
      },
      "icon": "▥",
      "art": {
        "sheet": "gear-legs",
        "col": 2,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "legs-thunder-legguards",
      "name": "Thunder Legguards",
      "rarity": "uncommon",
      "type": "equipment",
      "slot": "legs",
      "description": "While equipped: +16 maximum HP, +2 defence.",
      "effect": {
        "maxHp": 16,
        "defence": 2
      },
      "icon": "▥",
      "art": {
        "sheet": "gear-legs",
        "col": 3,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "legs-sunwoven-greaves",
      "name": "Sunwoven Greaves",
      "rarity": "rare",
      "type": "equipment",
      "slot": "legs",
      "description": "While equipped: +25 maximum HP, +3 defence.",
      "effect": {
        "maxHp": 25,
        "defence": 3
      },
      "icon": "▥",
      "art": {
        "sheet": "gear-legs",
        "col": 4,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "legs-prismatic-trousers",
      "name": "Prismatic Trousers",
      "rarity": "rare",
      "type": "equipment",
      "slot": "legs",
      "description": "While equipped: +26 maximum HP, +3 defence.",
      "effect": {
        "maxHp": 26,
        "defence": 3
      },
      "icon": "▥",
      "art": {
        "sheet": "gear-legs",
        "col": 0,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "legs-ruby-leggings",
      "name": "Ruby Leggings",
      "rarity": "rare",
      "type": "equipment",
      "slot": "legs",
      "description": "While equipped: +27 maximum HP, +3 defence.",
      "effect": {
        "maxHp": 27,
        "defence": 3
      },
      "icon": "▥",
      "art": {
        "sheet": "gear-legs",
        "col": 1,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "legs-sapphire-legguards",
      "name": "Sapphire Legguards",
      "rarity": "rare",
      "type": "equipment",
      "slot": "legs",
      "description": "While equipped: +24 maximum HP, +3 defence.",
      "effect": {
        "maxHp": 24,
        "defence": 3
      },
      "icon": "▥",
      "art": {
        "sheet": "gear-legs",
        "col": 2,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "legs-spiritwood-greaves",
      "name": "Spiritwood Greaves",
      "rarity": "epic",
      "type": "equipment",
      "slot": "legs",
      "description": "While equipped: +33 maximum HP, +4 defence.",
      "effect": {
        "maxHp": 33,
        "defence": 4
      },
      "icon": "▥",
      "art": {
        "sheet": "gear-legs",
        "col": 3,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "legs-dragonheart-trousers",
      "name": "Dragonheart Trousers",
      "rarity": "epic",
      "type": "equipment",
      "slot": "legs",
      "description": "While equipped: +34 maximum HP, +4 defence.",
      "effect": {
        "maxHp": 34,
        "defence": 4
      },
      "icon": "▥",
      "art": {
        "sheet": "gear-legs",
        "col": 4,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "legs-bloodmoon-leggings",
      "name": "Bloodmoon Leggings",
      "rarity": "epic",
      "type": "equipment",
      "slot": "legs",
      "description": "While equipped: +35 maximum HP, +4 defence.",
      "effect": {
        "maxHp": 35,
        "defence": 4
      },
      "icon": "▥",
      "art": {
        "sheet": "gear-legs",
        "col": 0,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "legs-starweaver-legguards",
      "name": "Starweaver Legguards",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "legs",
      "description": "While equipped: +40 maximum HP, +5 defence.",
      "effect": {
        "maxHp": 40,
        "defence": 5
      },
      "icon": "▥",
      "art": {
        "sheet": "gear-legs",
        "col": 1,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "legs-solar-greaves",
      "name": "Solar Greaves",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "legs",
      "description": "While equipped: +41 maximum HP, +5 defence.",
      "effect": {
        "maxHp": 41,
        "defence": 5
      },
      "icon": "▥",
      "art": {
        "sheet": "gear-legs",
        "col": 2,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "legs-infinity-trousers",
      "name": "Infinity Trousers",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "legs",
      "description": "While equipped: +42 maximum HP, +5 defence.",
      "effect": {
        "maxHp": 42,
        "defence": 5
      },
      "icon": "▥",
      "art": {
        "sheet": "gear-legs",
        "col": 3,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "legs-eternal-leggings",
      "name": "Eternal Leggings",
      "rarity": "mythical",
      "type": "equipment",
      "slot": "legs",
      "description": "While equipped: +51 maximum HP, +6 defence.",
      "effect": {
        "maxHp": 51,
        "defence": 6
      },
      "icon": "▥",
      "art": {
        "sheet": "gear-legs",
        "col": 4,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "boots-cinder-treads",
      "name": "Cinder Treads",
      "rarity": "common",
      "type": "equipment",
      "slot": "boots",
      "description": "While equipped: +1 defence, +1% critical chance.",
      "effect": {
        "defence": 1,
        "critChance": 0.01
      },
      "icon": "»",
      "art": {
        "sheet": "gear-boots",
        "col": 1,
        "row": 0,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "boots-frost-sabatons",
      "name": "Frost Sabatons",
      "rarity": "rare",
      "type": "equipment",
      "slot": "boots",
      "description": "While equipped: +3 defence, +3% critical chance.",
      "effect": {
        "defence": 3,
        "critChance": 0.03
      },
      "icon": "»",
      "art": {
        "sheet": "gear-boots",
        "col": 2,
        "row": 0,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "boots-sandstone-sandals",
      "name": "Sandstone Sandals",
      "rarity": "epic",
      "type": "equipment",
      "slot": "boots",
      "description": "While equipped: +4 defence, +4% critical chance.",
      "effect": {
        "defence": 4,
        "critChance": 0.04
      },
      "icon": "»",
      "art": {
        "sheet": "gear-boots",
        "col": 3,
        "row": 0,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "boots-copper-boots",
      "name": "Copper Boots",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "boots",
      "description": "While equipped: +5 defence, +5% critical chance.",
      "effect": {
        "defence": 5,
        "critChance": 0.05
      },
      "icon": "»",
      "art": {
        "sheet": "gear-boots",
        "col": 4,
        "row": 0,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "boots-tideglass-treads",
      "name": "Tideglass Treads",
      "rarity": "mythical",
      "type": "equipment",
      "slot": "boots",
      "description": "While equipped: +6 defence, +6% critical chance.",
      "effect": {
        "defence": 6,
        "critChance": 0.06
      },
      "icon": "»",
      "art": {
        "sheet": "gear-boots",
        "col": 0,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "boots-moonpetal-sabatons",
      "name": "Moonpetal Sabatons",
      "rarity": "uncommon",
      "type": "equipment",
      "slot": "boots",
      "description": "While equipped: +2 defence, +2% critical chance.",
      "effect": {
        "defence": 2,
        "critChance": 0.02
      },
      "icon": "»",
      "art": {
        "sheet": "gear-boots",
        "col": 1,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "boots-foxfire-sandals",
      "name": "Foxfire Sandals",
      "rarity": "uncommon",
      "type": "equipment",
      "slot": "boots",
      "description": "While equipped: +2 defence, +2% critical chance.",
      "effect": {
        "defence": 2,
        "critChance": 0.02
      },
      "icon": "»",
      "art": {
        "sheet": "gear-boots",
        "col": 2,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "boots-thunder-boots",
      "name": "Thunder Boots",
      "rarity": "uncommon",
      "type": "equipment",
      "slot": "boots",
      "description": "While equipped: +2 defence, +2% critical chance.",
      "effect": {
        "defence": 2,
        "critChance": 0.02
      },
      "icon": "»",
      "art": {
        "sheet": "gear-boots",
        "col": 3,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "boots-sunwoven-treads",
      "name": "Sunwoven Treads",
      "rarity": "rare",
      "type": "equipment",
      "slot": "boots",
      "description": "While equipped: +3 defence, +3% critical chance.",
      "effect": {
        "defence": 3,
        "critChance": 0.03
      },
      "icon": "»",
      "art": {
        "sheet": "gear-boots",
        "col": 4,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "boots-prismatic-sabatons",
      "name": "Prismatic Sabatons",
      "rarity": "rare",
      "type": "equipment",
      "slot": "boots",
      "description": "While equipped: +3 defence, +3% critical chance.",
      "effect": {
        "defence": 3,
        "critChance": 0.03
      },
      "icon": "»",
      "art": {
        "sheet": "gear-boots",
        "col": 0,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "boots-ruby-sandals",
      "name": "Ruby Sandals",
      "rarity": "rare",
      "type": "equipment",
      "slot": "boots",
      "description": "While equipped: +3 defence, +3% critical chance.",
      "effect": {
        "defence": 3,
        "critChance": 0.03
      },
      "icon": "»",
      "art": {
        "sheet": "gear-boots",
        "col": 1,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "boots-sapphire-boots",
      "name": "Sapphire Boots",
      "rarity": "rare",
      "type": "equipment",
      "slot": "boots",
      "description": "While equipped: +3 defence, +3% critical chance.",
      "effect": {
        "defence": 3,
        "critChance": 0.03
      },
      "icon": "»",
      "art": {
        "sheet": "gear-boots",
        "col": 2,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "boots-spiritwood-treads",
      "name": "Spiritwood Treads",
      "rarity": "epic",
      "type": "equipment",
      "slot": "boots",
      "description": "While equipped: +4 defence, +4% critical chance.",
      "effect": {
        "defence": 4,
        "critChance": 0.04
      },
      "icon": "»",
      "art": {
        "sheet": "gear-boots",
        "col": 3,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "boots-dragonheart-sabatons",
      "name": "Dragonheart Sabatons",
      "rarity": "epic",
      "type": "equipment",
      "slot": "boots",
      "description": "While equipped: +4 defence, +4% critical chance.",
      "effect": {
        "defence": 4,
        "critChance": 0.04
      },
      "icon": "»",
      "art": {
        "sheet": "gear-boots",
        "col": 4,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "boots-bloodmoon-sandals",
      "name": "Bloodmoon Sandals",
      "rarity": "epic",
      "type": "equipment",
      "slot": "boots",
      "description": "While equipped: +4 defence, +4% critical chance.",
      "effect": {
        "defence": 4,
        "critChance": 0.04
      },
      "icon": "»",
      "art": {
        "sheet": "gear-boots",
        "col": 0,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "boots-starweaver-boots",
      "name": "Starweaver Boots",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "boots",
      "description": "While equipped: +5 defence, +5% critical chance.",
      "effect": {
        "defence": 5,
        "critChance": 0.05
      },
      "icon": "»",
      "art": {
        "sheet": "gear-boots",
        "col": 1,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "boots-solar-treads",
      "name": "Solar Treads",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "boots",
      "description": "While equipped: +5 defence, +5% critical chance.",
      "effect": {
        "defence": 5,
        "critChance": 0.05
      },
      "icon": "»",
      "art": {
        "sheet": "gear-boots",
        "col": 2,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "boots-infinity-sabatons",
      "name": "Infinity Sabatons",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "boots",
      "description": "While equipped: +5 defence, +5% critical chance.",
      "effect": {
        "defence": 5,
        "critChance": 0.05
      },
      "icon": "»",
      "art": {
        "sheet": "gear-boots",
        "col": 3,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "boots-eternal-sandals",
      "name": "Eternal Sandals",
      "rarity": "mythical",
      "type": "equipment",
      "slot": "boots",
      "description": "While equipped: +6 defence, +6% critical chance.",
      "effect": {
        "defence": 6,
        "critChance": 0.06
      },
      "icon": "»",
      "art": {
        "sheet": "gear-boots",
        "col": 4,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "amulet-infinity-medallion",
      "name": "Infinity Medallion",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "amulet",
      "description": "While equipped: +30 maximum MP, +10 healing.",
      "effect": {
        "maxMp": 30,
        "healing": 10
      },
      "icon": "◆",
      "art": {
        "sheet": "gear-amulet",
        "col": 3,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "amulet-eternal-talisman",
      "name": "Eternal Talisman",
      "rarity": "mythical",
      "type": "equipment",
      "slot": "amulet",
      "description": "While equipped: +36 maximum MP, +12 healing.",
      "effect": {
        "maxMp": 36,
        "healing": 12
      },
      "icon": "◆",
      "art": {
        "sheet": "gear-amulet",
        "col": 4,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring1-sandstone-ring",
      "name": "Sandstone Ring",
      "rarity": "rare",
      "type": "equipment",
      "slot": "ring1",
      "description": "While equipped: +6 attack, +3% critical chance.",
      "effect": {
        "damage": 6,
        "critChance": 0.03
      },
      "icon": "◉",
      "art": {
        "sheet": "gear-ring1",
        "col": 3,
        "row": 0,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring1-copper-signet",
      "name": "Copper Signet",
      "rarity": "epic",
      "type": "equipment",
      "slot": "ring1",
      "description": "While equipped: +8 attack, +4% critical chance.",
      "effect": {
        "damage": 8,
        "critChance": 0.04
      },
      "icon": "◉",
      "art": {
        "sheet": "gear-ring1",
        "col": 4,
        "row": 0,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring1-tideglass-band",
      "name": "Tideglass Band",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "ring1",
      "description": "While equipped: +10 attack, +5% critical chance.",
      "effect": {
        "damage": 10,
        "critChance": 0.05
      },
      "icon": "◉",
      "art": {
        "sheet": "gear-ring1",
        "col": 0,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring1-moonpetal-loop",
      "name": "Moonpetal Loop",
      "rarity": "mythical",
      "type": "equipment",
      "slot": "ring1",
      "description": "While equipped: +12 attack, +6% critical chance.",
      "effect": {
        "damage": 12,
        "critChance": 0.06
      },
      "icon": "◉",
      "art": {
        "sheet": "gear-ring1",
        "col": 1,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring1-foxfire-ring",
      "name": "Foxfire Ring",
      "rarity": "uncommon",
      "type": "equipment",
      "slot": "ring1",
      "description": "While equipped: +4 attack, +2% critical chance.",
      "effect": {
        "damage": 4,
        "critChance": 0.02
      },
      "icon": "◉",
      "art": {
        "sheet": "gear-ring1",
        "col": 2,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring1-thunder-signet",
      "name": "Thunder Signet",
      "rarity": "uncommon",
      "type": "equipment",
      "slot": "ring1",
      "description": "While equipped: +4 attack, +2% critical chance.",
      "effect": {
        "damage": 4,
        "critChance": 0.02
      },
      "icon": "◉",
      "art": {
        "sheet": "gear-ring1",
        "col": 3,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring1-sunwoven-band",
      "name": "Sunwoven Band",
      "rarity": "rare",
      "type": "equipment",
      "slot": "ring1",
      "description": "While equipped: +6 attack, +3% critical chance.",
      "effect": {
        "damage": 6,
        "critChance": 0.03
      },
      "icon": "◉",
      "art": {
        "sheet": "gear-ring1",
        "col": 4,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring1-prismatic-loop",
      "name": "Prismatic Loop",
      "rarity": "rare",
      "type": "equipment",
      "slot": "ring1",
      "description": "While equipped: +6 attack, +3% critical chance.",
      "effect": {
        "damage": 6,
        "critChance": 0.03
      },
      "icon": "◉",
      "art": {
        "sheet": "gear-ring1",
        "col": 0,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring1-ruby-ring",
      "name": "Ruby Ring",
      "rarity": "rare",
      "type": "equipment",
      "slot": "ring1",
      "description": "While equipped: +6 attack, +3% critical chance.",
      "effect": {
        "damage": 6,
        "critChance": 0.03
      },
      "icon": "◉",
      "art": {
        "sheet": "gear-ring1",
        "col": 1,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring1-sapphire-signet",
      "name": "Sapphire Signet",
      "rarity": "rare",
      "type": "equipment",
      "slot": "ring1",
      "description": "While equipped: +6 attack, +3% critical chance.",
      "effect": {
        "damage": 6,
        "critChance": 0.03
      },
      "icon": "◉",
      "art": {
        "sheet": "gear-ring1",
        "col": 2,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring1-spiritwood-band",
      "name": "Spiritwood Band",
      "rarity": "epic",
      "type": "equipment",
      "slot": "ring1",
      "description": "While equipped: +8 attack, +4% critical chance.",
      "effect": {
        "damage": 8,
        "critChance": 0.04
      },
      "icon": "◉",
      "art": {
        "sheet": "gear-ring1",
        "col": 3,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring1-dragonheart-loop",
      "name": "Dragonheart Loop",
      "rarity": "epic",
      "type": "equipment",
      "slot": "ring1",
      "description": "While equipped: +8 attack, +4% critical chance.",
      "effect": {
        "damage": 8,
        "critChance": 0.04
      },
      "icon": "◉",
      "art": {
        "sheet": "gear-ring1",
        "col": 4,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring1-bloodmoon-ring",
      "name": "Bloodmoon Ring",
      "rarity": "epic",
      "type": "equipment",
      "slot": "ring1",
      "description": "While equipped: +8 attack, +4% critical chance.",
      "effect": {
        "damage": 8,
        "critChance": 0.04
      },
      "icon": "◉",
      "art": {
        "sheet": "gear-ring1",
        "col": 0,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring1-starweaver-signet",
      "name": "Starweaver Signet",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "ring1",
      "description": "While equipped: +10 attack, +5% critical chance.",
      "effect": {
        "damage": 10,
        "critChance": 0.05
      },
      "icon": "◉",
      "art": {
        "sheet": "gear-ring1",
        "col": 1,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring1-solar-band",
      "name": "Solar Band",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "ring1",
      "description": "While equipped: +10 attack, +5% critical chance.",
      "effect": {
        "damage": 10,
        "critChance": 0.05
      },
      "icon": "◉",
      "art": {
        "sheet": "gear-ring1",
        "col": 2,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring1-infinity-loop",
      "name": "Infinity Loop",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "ring1",
      "description": "While equipped: +10 attack, +5% critical chance.",
      "effect": {
        "damage": 10,
        "critChance": 0.05
      },
      "icon": "◉",
      "art": {
        "sheet": "gear-ring1",
        "col": 3,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring1-eternal-ring",
      "name": "Eternal Ring",
      "rarity": "mythical",
      "type": "equipment",
      "slot": "ring1",
      "description": "While equipped: +12 attack, +6% critical chance.",
      "effect": {
        "damage": 12,
        "critChance": 0.06
      },
      "icon": "◉",
      "art": {
        "sheet": "gear-ring1",
        "col": 4,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring2-nettle-promise-ring",
      "name": "Nettle Promise Ring",
      "rarity": "common",
      "type": "equipment",
      "slot": "ring2",
      "description": "While equipped: +2 healing, +6 maximum HP.",
      "effect": {
        "healing": 2,
        "maxHp": 6
      },
      "icon": "◎",
      "art": {
        "sheet": "gear-ring2",
        "col": 0,
        "row": 0,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring2-cinder-seal",
      "name": "Cinder Seal",
      "rarity": "uncommon",
      "type": "equipment",
      "slot": "ring2",
      "description": "While equipped: +4 healing, +12 maximum HP.",
      "effect": {
        "healing": 4,
        "maxHp": 12
      },
      "icon": "◎",
      "art": {
        "sheet": "gear-ring2",
        "col": 1,
        "row": 0,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring2-frost-circle",
      "name": "Frost Circle",
      "rarity": "rare",
      "type": "equipment",
      "slot": "ring2",
      "description": "While equipped: +6 healing, +18 maximum HP.",
      "effect": {
        "healing": 6,
        "maxHp": 18
      },
      "icon": "◎",
      "art": {
        "sheet": "gear-ring2",
        "col": 2,
        "row": 0,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring2-sandstone-oath-ring",
      "name": "Sandstone Oath Ring",
      "rarity": "epic",
      "type": "equipment",
      "slot": "ring2",
      "description": "While equipped: +8 healing, +24 maximum HP.",
      "effect": {
        "healing": 8,
        "maxHp": 24
      },
      "icon": "◎",
      "art": {
        "sheet": "gear-ring2",
        "col": 3,
        "row": 0,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring2-copper-promise-ring",
      "name": "Copper Promise Ring",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "ring2",
      "description": "While equipped: +10 healing, +30 maximum HP.",
      "effect": {
        "healing": 10,
        "maxHp": 30
      },
      "icon": "◎",
      "art": {
        "sheet": "gear-ring2",
        "col": 4,
        "row": 0,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring2-tideglass-seal",
      "name": "Tideglass Seal",
      "rarity": "mythical",
      "type": "equipment",
      "slot": "ring2",
      "description": "While equipped: +12 healing, +36 maximum HP.",
      "effect": {
        "healing": 12,
        "maxHp": 36
      },
      "icon": "◎",
      "art": {
        "sheet": "gear-ring2",
        "col": 0,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring2-moonpetal-circle",
      "name": "Moonpetal Circle",
      "rarity": "uncommon",
      "type": "equipment",
      "slot": "ring2",
      "description": "While equipped: +4 healing, +12 maximum HP.",
      "effect": {
        "healing": 4,
        "maxHp": 12
      },
      "icon": "◎",
      "art": {
        "sheet": "gear-ring2",
        "col": 1,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring2-foxfire-oath-ring",
      "name": "Foxfire Oath Ring",
      "rarity": "uncommon",
      "type": "equipment",
      "slot": "ring2",
      "description": "While equipped: +4 healing, +12 maximum HP.",
      "effect": {
        "healing": 4,
        "maxHp": 12
      },
      "icon": "◎",
      "art": {
        "sheet": "gear-ring2",
        "col": 2,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring2-thunder-promise-ring",
      "name": "Thunder Promise Ring",
      "rarity": "uncommon",
      "type": "equipment",
      "slot": "ring2",
      "description": "While equipped: +4 healing, +12 maximum HP.",
      "effect": {
        "healing": 4,
        "maxHp": 12
      },
      "icon": "◎",
      "art": {
        "sheet": "gear-ring2",
        "col": 3,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring2-sunwoven-seal",
      "name": "Sunwoven Seal",
      "rarity": "rare",
      "type": "equipment",
      "slot": "ring2",
      "description": "While equipped: +6 healing, +18 maximum HP.",
      "effect": {
        "healing": 6,
        "maxHp": 18
      },
      "icon": "◎",
      "art": {
        "sheet": "gear-ring2",
        "col": 4,
        "row": 1,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring2-prismatic-circle",
      "name": "Prismatic Circle",
      "rarity": "rare",
      "type": "equipment",
      "slot": "ring2",
      "description": "While equipped: +6 healing, +18 maximum HP.",
      "effect": {
        "healing": 6,
        "maxHp": 18
      },
      "icon": "◎",
      "art": {
        "sheet": "gear-ring2",
        "col": 0,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring2-ruby-oath-ring",
      "name": "Ruby Oath Ring",
      "rarity": "rare",
      "type": "equipment",
      "slot": "ring2",
      "description": "While equipped: +6 healing, +18 maximum HP.",
      "effect": {
        "healing": 6,
        "maxHp": 18
      },
      "icon": "◎",
      "art": {
        "sheet": "gear-ring2",
        "col": 1,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring2-sapphire-promise-ring",
      "name": "Sapphire Promise Ring",
      "rarity": "rare",
      "type": "equipment",
      "slot": "ring2",
      "description": "While equipped: +6 healing, +18 maximum HP.",
      "effect": {
        "healing": 6,
        "maxHp": 18
      },
      "icon": "◎",
      "art": {
        "sheet": "gear-ring2",
        "col": 2,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring2-spiritwood-seal",
      "name": "Spiritwood Seal",
      "rarity": "epic",
      "type": "equipment",
      "slot": "ring2",
      "description": "While equipped: +8 healing, +24 maximum HP.",
      "effect": {
        "healing": 8,
        "maxHp": 24
      },
      "icon": "◎",
      "art": {
        "sheet": "gear-ring2",
        "col": 3,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring2-dragonheart-circle",
      "name": "Dragonheart Circle",
      "rarity": "epic",
      "type": "equipment",
      "slot": "ring2",
      "description": "While equipped: +8 healing, +24 maximum HP.",
      "effect": {
        "healing": 8,
        "maxHp": 24
      },
      "icon": "◎",
      "art": {
        "sheet": "gear-ring2",
        "col": 4,
        "row": 2,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring2-bloodmoon-oath-ring",
      "name": "Bloodmoon Oath Ring",
      "rarity": "epic",
      "type": "equipment",
      "slot": "ring2",
      "description": "While equipped: +8 healing, +24 maximum HP.",
      "effect": {
        "healing": 8,
        "maxHp": 24
      },
      "icon": "◎",
      "art": {
        "sheet": "gear-ring2",
        "col": 0,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring2-starweaver-promise-ring",
      "name": "Starweaver Promise Ring",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "ring2",
      "description": "While equipped: +10 healing, +30 maximum HP.",
      "effect": {
        "healing": 10,
        "maxHp": 30
      },
      "icon": "◎",
      "art": {
        "sheet": "gear-ring2",
        "col": 1,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring2-solar-seal",
      "name": "Solar Seal",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "ring2",
      "description": "While equipped: +10 healing, +30 maximum HP.",
      "effect": {
        "healing": 10,
        "maxHp": 30
      },
      "icon": "◎",
      "art": {
        "sheet": "gear-ring2",
        "col": 2,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring2-infinity-circle",
      "name": "Infinity Circle",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "ring2",
      "description": "While equipped: +10 healing, +30 maximum HP.",
      "effect": {
        "healing": 10,
        "maxHp": 30
      },
      "icon": "◎",
      "art": {
        "sheet": "gear-ring2",
        "col": 3,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "ring2-eternal-oath-ring",
      "name": "Eternal Oath Ring",
      "rarity": "mythical",
      "type": "equipment",
      "slot": "ring2",
      "description": "While equipped: +12 healing, +36 maximum HP.",
      "effect": {
        "healing": 12,
        "maxHp": 36
      },
      "icon": "◎",
      "art": {
        "sheet": "gear-ring2",
        "col": 4,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "mainhand-bloodmoon-bow",
      "name": "Bloodmoon Bow",
      "rarity": "epic",
      "type": "equipment",
      "slot": "mainHand",
      "description": "While equipped: +19 attack, +12 maximum MP.",
      "effect": {
        "damage": 19,
        "maxMp": 12
      },
      "icon": "⚔",
      "art": {
        "sheet": "gear-mainhand",
        "col": 0,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "mainhand-starweaver-blade",
      "name": "Starweaver Blade",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "mainHand",
      "description": "While equipped: +20 attack, +15 maximum MP.",
      "effect": {
        "damage": 20,
        "maxMp": 15
      },
      "icon": "⚔",
      "art": {
        "sheet": "gear-mainhand",
        "col": 1,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "mainhand-solar-wand",
      "name": "Solar Wand",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "mainHand",
      "description": "While equipped: +21 attack, +15 maximum MP.",
      "effect": {
        "damage": 21,
        "maxMp": 15
      },
      "icon": "⚔",
      "art": {
        "sheet": "gear-mainhand",
        "col": 2,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "mainhand-infinity-hammer",
      "name": "Infinity Hammer",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "mainHand",
      "description": "While equipped: +22 attack, +15 maximum MP.",
      "effect": {
        "damage": 22,
        "maxMp": 15
      },
      "icon": "⚔",
      "art": {
        "sheet": "gear-mainhand",
        "col": 3,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "mainhand-eternal-bow",
      "name": "Eternal Bow",
      "rarity": "mythical",
      "type": "equipment",
      "slot": "mainHand",
      "description": "While equipped: +27 attack, +18 maximum MP.",
      "effect": {
        "damage": 27,
        "maxMp": 18
      },
      "icon": "⚔",
      "art": {
        "sheet": "gear-mainhand",
        "col": 4,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "offhand-bloodmoon-quiver",
      "name": "Bloodmoon Quiver",
      "rarity": "epic",
      "type": "equipment",
      "slot": "offHand",
      "description": "While equipped: +8 defence, +20 maximum MP.",
      "effect": {
        "defence": 8,
        "maxMp": 20
      },
      "icon": "▣",
      "art": {
        "sheet": "gear-offhand",
        "col": 0,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "offhand-starweaver-shield",
      "name": "Starweaver Shield",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "offHand",
      "description": "While equipped: +10 defence, +25 maximum MP.",
      "effect": {
        "defence": 10,
        "maxMp": 25
      },
      "icon": "▣",
      "art": {
        "sheet": "gear-offhand",
        "col": 1,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "offhand-solar-codex",
      "name": "Solar Codex",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "offHand",
      "description": "While equipped: +10 defence, +25 maximum MP.",
      "effect": {
        "defence": 10,
        "maxMp": 25
      },
      "icon": "▣",
      "art": {
        "sheet": "gear-offhand",
        "col": 2,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "offhand-infinity-focus",
      "name": "Infinity Focus",
      "rarity": "legendary",
      "type": "equipment",
      "slot": "offHand",
      "description": "While equipped: +10 defence, +25 maximum MP.",
      "effect": {
        "defence": 10,
        "maxMp": 25
      },
      "icon": "▣",
      "art": {
        "sheet": "gear-offhand",
        "col": 3,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "offhand-eternal-quiver",
      "name": "Eternal Quiver",
      "rarity": "mythical",
      "type": "equipment",
      "slot": "offHand",
      "description": "While equipped: +12 defence, +30 maximum MP.",
      "effect": {
        "defence": 12,
        "maxMp": 30
      },
      "icon": "▣",
      "art": {
        "sheet": "gear-offhand",
        "col": 4,
        "row": 3,
        "columns": 5,
        "rows": 4
      },
      "collection": "armory"
    },
    {
      "id": "pet-bramble-mouse",
      "name": "Bramble Mouse",
      "rarity": "common",
      "type": "pet",
      "slot": "pet",
      "subject": "tiny leaf-eared green mouse",
      "description": "While equipped: +2 attack, +5 maximum HP.",
      "effect": {
        "damage": 2,
        "maxHp": 5
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 0,
        "row": 0,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-copper-beetle",
      "name": "Copper Beetle",
      "rarity": "common",
      "type": "pet",
      "slot": "pet",
      "subject": "bronze clockwork beetle",
      "description": "While equipped: +2 healing, +4 maximum MP.",
      "effect": {
        "healing": 2,
        "maxMp": 4
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 1,
        "row": 0,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-pebble-tortoise",
      "name": "Pebble Tortoise",
      "rarity": "common",
      "type": "pet",
      "slot": "pet",
      "subject": "stone-shell baby tortoise",
      "description": "While equipped: +1 defence, +6 maximum HP.",
      "effect": {
        "defence": 1,
        "maxHp": 6
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 2,
        "row": 0,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-cloud-sparrow",
      "name": "Cloud Sparrow",
      "rarity": "common",
      "type": "pet",
      "slot": "pet",
      "subject": "fluffy white sparrow",
      "description": "While equipped: +2 attack, +5 maximum HP.",
      "effect": {
        "damage": 2,
        "maxHp": 5
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 3,
        "row": 0,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-moss-bunny",
      "name": "Moss Bunny",
      "rarity": "common",
      "type": "pet",
      "slot": "pet",
      "subject": "green moss rabbit",
      "description": "While equipped: +2 healing, +4 maximum MP.",
      "effect": {
        "healing": 2,
        "maxMp": 4
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 4,
        "row": 0,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-ember-gecko",
      "name": "Ember Gecko",
      "rarity": "uncommon",
      "type": "pet",
      "slot": "pet",
      "subject": "orange fire gecko",
      "description": "While equipped: +2 defence, +12 maximum HP.",
      "effect": {
        "defence": 2,
        "maxHp": 12
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 0,
        "row": 1,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-dewdrop-frog",
      "name": "Dewdrop Frog",
      "rarity": "uncommon",
      "type": "pet",
      "slot": "pet",
      "subject": "blue dew frog",
      "description": "While equipped: +3 attack, +10 maximum HP.",
      "effect": {
        "damage": 3,
        "maxHp": 10
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 1,
        "row": 1,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-acorn-squirrel",
      "name": "Acorn Squirrel",
      "rarity": "uncommon",
      "type": "pet",
      "slot": "pet",
      "subject": "brown squirrel with acorn",
      "description": "While equipped: +3 healing, +8 maximum MP.",
      "effect": {
        "healing": 3,
        "maxMp": 8
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 2,
        "row": 1,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-honey-bumblebee",
      "name": "Honey Bumblebee",
      "rarity": "uncommon",
      "type": "pet",
      "slot": "pet",
      "subject": "golden bee",
      "description": "While equipped: +2 defence, +12 maximum HP.",
      "effect": {
        "defence": 2,
        "maxHp": 12
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 3,
        "row": 1,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-bubble-otter",
      "name": "Bubble Otter",
      "rarity": "uncommon",
      "type": "pet",
      "slot": "pet",
      "subject": "teal otter with bubbles",
      "description": "While equipped: +3 attack, +10 maximum HP.",
      "effect": {
        "damage": 3,
        "maxHp": 10
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 4,
        "row": 1,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-frost-kitten",
      "name": "Frost Kitten",
      "rarity": "rare",
      "type": "pet",
      "slot": "pet",
      "subject": "ice-blue snow kitten",
      "description": "While equipped: +4 healing, +12 maximum MP.",
      "effect": {
        "healing": 4,
        "maxMp": 12
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 0,
        "row": 2,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-moon-moth",
      "name": "Moon Moth",
      "rarity": "rare",
      "type": "pet",
      "slot": "pet",
      "subject": "lavender crescent moth",
      "description": "While equipped: +3 defence, +18 maximum HP.",
      "effect": {
        "defence": 3,
        "maxHp": 18
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 1,
        "row": 2,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-foxfire-cub",
      "name": "Foxfire Cub",
      "rarity": "rare",
      "type": "pet",
      "slot": "pet",
      "subject": "glowing amber fox cub",
      "description": "While equipped: +4 attack, +15 maximum HP.",
      "effect": {
        "damage": 4,
        "maxHp": 15
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 2,
        "row": 2,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-coral-crab",
      "name": "Coral Crab",
      "rarity": "rare",
      "type": "pet",
      "slot": "pet",
      "subject": "pink coral crab",
      "description": "While equipped: +4 healing, +12 maximum MP.",
      "effect": {
        "healing": 4,
        "maxMp": 12
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 3,
        "row": 2,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-rune-owl",
      "name": "Rune Owl",
      "rarity": "rare",
      "type": "pet",
      "slot": "pet",
      "subject": "purple owl with rune feathers",
      "description": "While equipped: +3 defence, +18 maximum HP.",
      "effect": {
        "defence": 3,
        "maxHp": 18
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 4,
        "row": 2,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-thunder-pup",
      "name": "Thunder Pup",
      "rarity": "epic",
      "type": "pet",
      "slot": "pet",
      "subject": "electric-blue puppy",
      "description": "While equipped: +5 attack, +20 maximum HP.",
      "effect": {
        "damage": 5,
        "maxHp": 20
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 0,
        "row": 3,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-crystal-hedgehog",
      "name": "Crystal Hedgehog",
      "rarity": "epic",
      "type": "pet",
      "slot": "pet",
      "subject": "amethyst crystal hedgehog",
      "description": "While equipped: +5 healing, +16 maximum MP.",
      "effect": {
        "healing": 5,
        "maxMp": 16
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 1,
        "row": 3,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-sapphire-axolotl",
      "name": "Sapphire Axolotl",
      "rarity": "epic",
      "type": "pet",
      "slot": "pet",
      "subject": "blue axolotl",
      "description": "While equipped: +4 defence, +24 maximum HP.",
      "effect": {
        "defence": 4,
        "maxHp": 24
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 2,
        "row": 3,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-jade-serpent",
      "name": "Jade Serpent",
      "rarity": "epic",
      "type": "pet",
      "slot": "pet",
      "subject": "small jade wingless serpent",
      "description": "While equipped: +5 attack, +20 maximum HP.",
      "effect": {
        "damage": 5,
        "maxHp": 20
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 3,
        "row": 3,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-silver-lynx",
      "name": "Silver Lynx",
      "rarity": "epic",
      "type": "pet",
      "slot": "pet",
      "subject": "silver lynx kitten",
      "description": "While equipped: +5 healing, +16 maximum MP.",
      "effect": {
        "healing": 5,
        "maxMp": 16
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 4,
        "row": 3,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-ruby-griffin",
      "name": "Ruby Griffin",
      "rarity": "legendary",
      "type": "pet",
      "slot": "pet",
      "subject": "red baby griffin",
      "description": "While equipped: +5 defence, +30 maximum HP.",
      "effect": {
        "defence": 5,
        "maxHp": 30
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 0,
        "row": 4,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-starlight-fawn",
      "name": "Starlight Fawn",
      "rarity": "legendary",
      "type": "pet",
      "slot": "pet",
      "subject": "violet star-spotted fawn",
      "description": "While equipped: +6 attack, +25 maximum HP.",
      "effect": {
        "damage": 6,
        "maxHp": 25
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 1,
        "row": 4,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-aurora-penguin",
      "name": "Aurora Penguin",
      "rarity": "legendary",
      "type": "pet",
      "slot": "pet",
      "subject": "pastel aurora penguin",
      "description": "While equipped: +6 healing, +20 maximum MP.",
      "effect": {
        "healing": 6,
        "maxMp": 20
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 2,
        "row": 4,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-spirit-panda",
      "name": "Spirit Panda",
      "rarity": "legendary",
      "type": "pet",
      "slot": "pet",
      "subject": "green spectral baby panda",
      "description": "While equipped: +5 defence, +30 maximum HP.",
      "effect": {
        "defence": 5,
        "maxHp": 30
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 3,
        "row": 4,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-sun-phoenix",
      "name": "Sun Phoenix",
      "rarity": "legendary",
      "type": "pet",
      "slot": "pet",
      "subject": "golden miniature phoenix",
      "description": "While equipped: +6 attack, +25 maximum HP.",
      "effect": {
        "damage": 6,
        "maxHp": 25
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 4,
        "row": 4,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-dragon-whelp",
      "name": "Dragon Whelp",
      "rarity": "mythical",
      "type": "pet",
      "slot": "pet",
      "subject": "crimson baby dragon",
      "description": "While equipped: +7 healing, +24 maximum MP.",
      "effect": {
        "healing": 7,
        "maxMp": 24
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 0,
        "row": 5,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-celestial-koi",
      "name": "Celestial Koi",
      "rarity": "mythical",
      "type": "pet",
      "slot": "pet",
      "subject": "floating blue-gold koi",
      "description": "While equipped: +6 defence, +36 maximum HP.",
      "effect": {
        "defence": 6,
        "maxHp": 36
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 1,
        "row": 5,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-worldtree-dryad",
      "name": "Worldtree Dryad",
      "rarity": "mythical",
      "type": "pet",
      "slot": "pet",
      "subject": "tiny leafy tree spirit",
      "description": "While equipped: +7 attack, +30 maximum HP.",
      "effect": {
        "damage": 7,
        "maxHp": 30
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 2,
        "row": 5,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-void-unicorn",
      "name": "Void Unicorn",
      "rarity": "mythical",
      "type": "pet",
      "slot": "pet",
      "subject": "purple galaxy unicorn foal",
      "description": "While equipped: +7 healing, +24 maximum MP.",
      "effect": {
        "healing": 7,
        "maxMp": 24
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 3,
        "row": 5,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    },
    {
      "id": "pet-eternal-kirin",
      "name": "Eternal Kirin",
      "rarity": "mythical",
      "type": "pet",
      "slot": "pet",
      "subject": "pink-gold mythical kirin foal",
      "description": "While equipped: +6 defence, +36 maximum HP.",
      "effect": {
        "defence": 6,
        "maxHp": 36
      },
      "icon": "♣",
      "art": {
        "sheet": "pets",
        "col": 4,
        "row": 5,
        "columns": 5,
        "rows": 6
      },
      "collection": "companions"
    }
  ];
  ARMORY_ITEMS.forEach(entry=>{ITEMS[entry.id]=entry;});
  // Unique is the rarest tier. Existing IDs, stats and relative tier order stay stable.
  RARITIES.common.weight=44.9;
  RARITIES.unique={name:'Unique',weight:.1,color:'#ffb965'};
  const ITEM_SKILLS=[];
  function relicSkill(id,name,damageType,mpCost,cooldown,effect,description) {
    const skill={id:'relic-'+id,name,damageType,mpCost,cooldown,effect:{type:'active',...effect},description,
      itemSkill:true,passive:false,requires:[],cost:0,level:1,branch:'Relics',icon:'✦'};
    ITEM_SKILLS.push(skill);return skill.id;
  }
  const tempest=relicSkill('tempest-grasp','Tempest Grasp','lightning',24,3,{power:1.8,expose:{elemental:{amount:.2,turns:3}}},'Lightning that opens an elemental defence break for your party.');
  const nightfall=relicSkill('nightfall','Nightfall Spear','shadow',22,3,{power:1.9,leech:.2},'A shadow strike that returns some damage as health.');
  const dragon=relicSkill('dragon-breath','Dragon Breath','fire',28,4,{power:2.2,burn:.22},'Dragonfire burns the enemy for three enemy turns.');
  const comet=relicSkill('cometfall','Cometfall','arcane',32,4,{power:2.5,pierce:.3},'An arcane comet pierces enemy armour.');
  const winter=relicSkill('winter-veil','Winter Veil','ice',25,3,{power:1.5,shield:.12,weakenBoss:.2},'Ice damage, a party ward and a weaker next enemy attack.');
  const volley=relicSkill('storm-volley','Storm Volley','lightning',24,3,{power:1.9,expose:{physical:{amount:.18,turns:3}}},'Lightning arrows leave an opening for physical allies.');
  const nova=relicSkill('worldspark','Worldspark Nova','arcane',34,5,{power:2.6,expose:{physical:{amount:.15,turns:3},elemental:{amount:.15,turns:3}}},'A rare rune opens both physical and elemental defences.');
  const starfall=relicSkill('starfall','Starfall','arcane',30,4,{power:2.1,manaAll:5},'A fallen star strikes and restores party mana. Permanently granted by a unique elixir.');
  const dawn={id:'relic-dawn-aura',name:'Dawn Aura',itemSkill:true,permanent:true,passive:true,requires:[],cost:0,level:1,branch:'Relics',mpCost:0,cooldown:0,
    description:'Permanently grants +20 maximum HP, +8 healing and 2 party mana on damaging answers.',effect:{type:'passive',passive:{maxHp:20,healing:8,teamMana:2}}};
  ITEM_SKILLS.push(dawn);
  const RUNE_DEFINITIONS=[
    ['ember','Ember','common','fire',{burn:.18},'Damaging answers burn for 18% of attack over each of three enemy turns.'],
    ['frost','Frost','uncommon','ice',{frost:.12},'Damaging answers weaken the next enemy attack by 12%.'],
    ['storm','Storm','rare','lightning',{elementalBreak:.08},'Damaging answers lower elemental defence by 8% for two allied damaging actions.'],
    ['earth','Earth','legendary','earth',{defence:5,selfWard:.05},'Grants +5 defence and a 5% self ward on each correct answer.'],
    ['tide','Tide','uncommon','water',{maxMp:12,manaRegen:2},'Grants +12 maximum MP and restores 2 MP on each correct answer.'],
    ['gale','Gale','epic','wind',{critChance:.05,physicalBonus:.06},'Grants +5% critical chance and +6% physical damage.'],
    ['radiance','Radiance','legendary','holy',{healing:8,teamMana:2},'Grants +8 healing and restores 2 party MP on damaging answers.'],
    ['umbral','Umbral','mythical','shadow',{leech:.1},'Damaging answers return 10% of damage as health.'],
    ['bloom','Bloom','rare','nature',{healing:5,teamLeech:.015},'Grants +5 healing and heals the party for 1.5% maximum HP on damaging answers.'],
    ['venom','Venom','epic','nature',{venom:.2},'Damaging answers apply venom for three enemy turns.'],
    ['arcane','Arcane','mythical','arcane',{maxMp:18,elementalPierce:.1},'Grants +18 maximum MP and 10% elemental armour piercing.'],
    ['iron','Iron','common','physical',{physicalBonus:.08,physicalPierce:.05},'Grants +8% physical damage and 5% physical armour piercing.'],
    ['phoenix','Phoenix','unique','fire',{burn:.25,revive:true},'Phoenix Rebirth: burning strikes and one party revival per encounter.'],
    ['winterheart','Winterheart','unique','ice',{frost:.2,selfWard:.07},'Heart of Winter: weaken the next enemy attack and gain a 7% self ward.'],
    ['worldspark','Worldspark','unique','arcane',{elementalBonus:.12},'Worldspark: grants Worldspark Nova while socketed.',nova],
    ['eclipse','Eclipse','unique','shadow',{leech:.15,echo:true},'Eclipse Echo: leech health and echo every third damaging answer.']
  ];
  RUNE_DEFINITIONS.forEach((r,i)=>{const [id,name,rarity,element,effect,description,grantSkill]=r;ITEMS['rune-'+id]={id:'rune-'+id,name:name+' Rune',type:'rune',rarity,element,effect,description:description+' In a weapon, the first rune sets normal-attack damage type.',
    ...(grantSkill?{grantSkill}:{}),passiveName:rarity==='unique'?name+' Resonance':undefined,icon:'◆',collection:'runes',art:{sheet:'runes-1',col:i%4,row:Math.floor(i/4),columns:4,rows:4}};});
  const UNIQUE_DEFINITIONS=[
    ['astral-crown','Astral Crown','helm',{maxMp:24,critChance:.08,manaRegen:3},'Astral Foresight: +24 MP, +8% critical chance and 3 MP per correct answer.'],
    ['phoenix-heart','Phoenix Heart','torso',{maxHp:45,revive:true,teamLeech:.025},'Phoenix Rebirth: one party revival per encounter and 2.5% party healing on damaging answers.'],
    ['tempest-grips','Tempest Grips','gloves',{damage:8},'Grants Tempest Grasp and +8 attack.',tempest],
    ['worldroot-greaves','Worldroot Greaves','legs',{defence:9,selfWard:.08},'Rooted Guardian: +9 defence and an 8% self ward each correct answer.'],
    ['riftwalker-boots','Riftwalker Boots','boots',{defence:4,selfHaste:1},'Rift Step: each correct answer reduces your other skill cooldowns by one extra turn.'],
    ['sun-promise','Sun’s Promise','amulet',{healing:12,teamMana:3},'Sunlit Covenant: +12 healing and 3 party MP on damaging answers.'],
    ['nightfall-band','Nightfall Band','ring1',{maxMp:15},'Grants Nightfall Spear and +15 MP.',nightfall],
    ['constellation-band','Constellation Band','ring2',{critChance:.07,echo:true},'Constellation Echo: +7% critical chance; every third damaging answer echoes.'],
    ['wyrmflame','Wyrmflame','mainHand',{damage:16,burn:.22},'Grants Dragon Breath; damaging answers burn.',dragon],
    ['winter-aegis','Winter Aegis','offHand',{defence:14,selfWard:.1,ignoreGuard:true},'Absolute Winter: +14 defence, a 10% self ward and attacks ignore enemy guard.'],
    ['comet-spire','Comet Spire','mainHand',{damage:14,elementalBonus:.12},'Grants Cometfall and +12% elemental damage.',comet],
    ['winter-codex','Winter Codex','offHand',{maxMp:28,healing:6},'Grants Winter Veil, +28 MP and +6 healing.',winter],
    ['skybreaker','Skybreaker','mainHand',{damage:13,critChance:.06},'Grants Storm Volley and +6% critical chance.',volley],
    ['dawnfox','Dawnfox','pet',{teamLeech:.025,teamMana:2},'Dawn Companion: heals the party for 2.5% maximum HP and restores 2 party MP on damaging answers.'],
    ['elixir-of-dawn','Elixir of Dawn','consumable',{heal:.35},'Permanently teaches Dawn Aura to its drinker. A hero can learn this gift once.',dawn.id],
    ['bottled-star','Bottled Star','consumable',{mana:35},'Permanently teaches Starfall to its drinker. A hero can learn this gift once.',starfall]
  ];
  UNIQUE_DEFINITIONS.forEach((r,i)=>{const [id,name,slot,effect,description,grantSkill]=r,type=slot==='pet'?'pet':slot==='consumable'?'consumable':'equipment';ITEMS['unique-'+id]={id:'unique-'+id,name,type,slot:type==='equipment'?slot:undefined,rarity:'unique',effect,description,
    ...(grantSkill?{[type==='consumable'?'giftSkill':'grantSkill']:grantSkill}:{passiveName:name}),icon:'✦',collection:'uniques',art:{sheet:'uniques-1',col:i%4,row:Math.floor(i/4),columns:4,rows:4,...(i===8?{frame:{x:0,y:600,width:314,height:302,atlasWidth:1254,atlasHeight:1254}}:{})}};});
  return {ROLES,SKILLS,SKILL_TREES:SKILLS,BASE_LEVEL,BASE_COST,JOB_LEVEL,JOB_COST,JOBS,JOB_SKILLS,JOB_TREES:JOB_SKILLS,ITEMS,RARITIES,EQUIPMENT_SLOTS,ITEM_SKILLS};
});
