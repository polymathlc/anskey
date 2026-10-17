import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),C=require('../battle-core.js'),A=require('../battle-adventure.js'),T=require('../hero-skill-tree.js');
let sequence=0;
const id=()=>`adventure-test-${++sequence}`;
function hero(role,level=35){let h=C.heroFromStudent({id:role,name:role},null,Object.keys(C.ROLES).indexOf(role));h.xp=C.xpForLevel(level);h.level=level;h=C.cleanHero(h,h);h.stats.critChance=0;h.hp=h.stats.maxHp;h.mp=h.stats.maxMp;return h;}
function start(heroes=[hero('warrior'),hero('cleric'),hero('mage')]){return C.reduce(null,{type:'start',id:id(),heroes});}
function turn(s,heroId,command={command:'attack'},outcome='correct'){
  const selected=C.reduce(s,{type:'select',id:id(),turnId:'adventure-fixed-turn',heroId,encounterId:s.encounterId,expectedRevision:s.revision});
  return C.reduce(selected,{type:'answer',id:id(),turnId:selected.pending.id,encounterId:s.encounterId,outcome,...command});
}
function arena(heroes){const s=start(heroes);s.heroes=structuredClone(heroes);s.bossHp=s.bossMaxHp=100000;s.adventure={...s.adventure,kind:'enemy',resolved:true};return s;}

test('road encounters use reproducible 2/6/18/74 percent rolls and cycle four biomes',()=>{
  const counts={uber:0,chest:0,event:0,enemy:0};
  for(let i=0;i<20000;i++){const road=C.adventureFor(null,'road-'+i);counts[road.kind]++;assert.deepEqual(road,C.adventureFor(null,'road-'+i));}
  for(const kind of Object.keys(counts))assert.ok(Math.abs(counts[kind]/20000-C.ADVENTURE_RATES[kind])<.01,kind+' remains at its declared rarity');
  let previous=null;
  for(let step=1;step<=32;step++){const adventure=C.adventureFor(previous,'step-'+step);assert.equal(adventure.step,step);assert.equal(adventure.biome,C.ADVENTURE_BIOMES[Math.floor((step-1)/4)%4]);previous={adventure};}
});

test('saved progress, health and roadside roll survive reload, retry and a later lesson',()=>{
  const s=start(),before=JSON.stringify(s);s.bossHp-=17;
  const normalized=C.normalizeState(JSON.parse(JSON.stringify(s)));
  assert.equal(normalized.bossHp,s.bossHp);assert.deepEqual(normalized.adventure,s.adventure);
  const duplicate=C.reduce(s,{type:'start',id:s.encounterId,heroes:s.heroes});assert.equal(duplicate,s);
  const next=C.reduce({...s,status:'defeat'},{type:'start',id:id(),expectedRevision:s.revision,heroes:s.heroes});
  assert.equal(next.adventure.step,s.adventure.step+1);assert.notEqual(before,JSON.stringify(s));
  const legacy=structuredClone(s);delete legacy.adventure;delete legacy.exposures;
  assert.equal(C.normalizeState(legacy).bossHp,legacy.bossHp);assert.deepEqual(C.normalizeState(legacy).exposures,{});
});

test('uber bosses apply saved empowerment and retain the per-answer damage cap',()=>{
  let seed;for(let i=0;i<10000;i++)if(C.adventureFor(null,'uber-roll-'+i).kind==='uber'){seed='uber-roll-'+i;break;}
  const heroes=[hero('warrior',1)],s=C.reduce(null,{type:'start',id:seed,heroes}),boss=C.bossById(s.bossId);
  const ordinary=Math.round(Math.max(200,s.heroes.reduce((sum,h)=>sum+h.stats.damage,0)*4)*boss.hpMultiplier);
  assert.equal(s.bossMaxHp,Math.ceil(Math.round(ordinary*1.8)/2));
  assert.equal(C.enemyScale(s).attack,1.25);assert.equal(C.enemyScale(s).xp,1.6);
  const result=C.reduce(s,{type:'auto',id:id(),spinId:id(),heroId:s.heroes[0].id,points:10000,encounterId:s.encounterId,expectedRevision:s.revision});
  assert.ok(result.lastEvent.damage<=Math.round(s.bossMaxHp*.25));assert.equal(result.status,'active');
});

test('a roadside blessing is awarded once on a correct answer and never scales with points',()=>{
  const s=arena([hero('warrior')]);s.adventure={...s.adventure,kind:'event',eventId:'guardian-shrine',resolved:false};
  const wrong=turn(s,s.heroes[0].id,{},'incorrect');assert.equal(wrong.adventure.resolved,false);assert.equal(wrong.heroes[0].shield,0);
  const correct=turn(wrong,s.heroes[0].id);assert.equal(correct.adventure.resolved,true);assert.equal(correct.lastEvent.discovery,'guardian-shrine');
  const shield=Math.round(correct.heroes[0].stats.maxHp*.15);assert.equal(correct.heroes[0].shield,shield);
  const again=turn(correct,correct.heroes[0].id);assert.equal(again.heroes[0].shield,shield);assert.equal(again.lastEvent.discovery,undefined);
  const auto=C.reduce(s,{type:'auto',id:id(),spinId:id(),heroId:s.heroes[0].id,points:100,encounterId:s.encounterId,expectedRevision:s.revision});
  const bestowed=auto.lastEvent.supported.find(r=>r.effect==='shield');assert.equal(bestowed.amount,shield);
});

test('rare chests grant one extra rare-or-better item to every hero only after victory',()=>{
  const s=arena([hero('warrior'),hero('cleric')]);s.adventure.kind='chest';s.bossHp=1;
  const before=structuredClone(s),win=turn(s,s.heroes[0].id);
  assert.equal(win.status,'victory');assert.equal(win.rewards.length,4);assert.deepEqual(s,before);
  for(const h of win.heroes){const bonus=win.rewards.filter(r=>r.heroId===h.id&&r.source==='road-chest');assert.equal(bonus.length,1);assert.ok(['rare','epic','legendary','mythical'].includes(bonus[0].rarity));assert.equal(bonus[0].xp,0);}
  assert.throws(()=>turn(win,win.heroes[0].id),/finished/);
  const loss=C.reduce({...s,bossHp:100},{type:'end',id:id(),encounterId:s.encounterId,expectedRevision:s.revision});assert.deepEqual(loss.rewards,[]);
});

test('cleric physical and elemental breaks benefit only matching teammate attacks',()=>{
  const cleric=hero('cleric');cleric.learnedSkills.push('cleric-physical-opening','cleric-elemental-opening');
  const s=arena([cleric,hero('warrior'),hero('mage')]);
  for(const [channel,skillId,target,other] of [['physical','cleric-physical-opening',1,2],['elemental','cleric-elemental-opening',2,1]]){
    const setup=turn(s,cleric.id,{command:'skill',skillId});
    assert.equal(setup.exposures[channel].turns,4);assert.equal(setup.exposures[channel].heroId,cleric.id);assert.equal(setup.lastEvent.synergy,null,'a new break benefits following attacks');
    const noBreak=structuredClone(setup);noBreak.exposures={};
    const boosted=turn(setup,s.heroes[target].id),plain=turn(noBreak,s.heroes[target].id);
    assert.ok(boosted.lastEvent.damage>plain.lastEvent.damage);assert.equal(boosted.lastEvent.synergy.sourceHeroId,cleric.id);
    assert.equal(boosted.exposures[channel].turns,3);
    assert.equal(turn(setup,s.heroes[other].id).lastEvent.damage,turn(noBreak,s.heroes[other].id).lastEvent.damage);
  }
});

test('support, incorrect answers and boss turns preserve breaks; four damaging actions expire them',()=>{
  const cleric=hero('cleric'),s=arena([cleric,hero('warrior')]);s.exposures={physical:{amount:.3,turns:4,heroId:cleric.id}};
  const heal=turn(s,cleric.id,{command:'skill',skillId:cleric.learnedSkills[0]});assert.equal(heal.exposures.physical.turns,4);
  const wrong=turn(heal,cleric.id,{},'incorrect');assert.equal(wrong.exposures.physical.turns,4);
  const boss=C.reduce(wrong,{type:'boss',id:id(),encounterId:s.encounterId,expectedRevision:wrong.revision,timing:0});assert.equal(boss.exposures.physical.turns,4);
  let next=boss;for(let i=0;i<4;i++)next=turn(next,s.heroes[1].id);assert.deepEqual(next.exposures,{});
});

test('every class supports physical, elemental and hybrid builds without leaking inactive-job bonuses',()=>{
  for(const role of Object.keys(C.ROLES)){
    const h=hero(role),physical={...h,learnedSkills:[...h.learnedSkills,role+'-physical-training',role+'-physical-mastery']},elemental={...h,learnedSkills:[...h.learnedSkills,role+'-elemental-training',role+'-elemental-mastery']};
    assert.equal(C.buildFor(physical).basicType,'physical');assert.ok(C.buildFor(physical).physicalBonus>=.4);
    assert.notEqual(C.buildFor(elemental).basicType,'physical');assert.ok(C.buildFor(elemental).elementalBonus>=.4);
    assert.equal(C.damageTypeFor(physical,C.skillById(role+'-convergence-apex')),'physical');
    assert.notEqual(C.damageTypeFor(elemental,C.skillById(role+'-convergence-apex')),'physical');
    assert.equal(C.buildFor({...h,learnedSkills:[...h.learnedSkills,'archmage-elemental-keystone']}).elementalBonus,0);
  }
});

test('all added prerequisites form reachable, acyclic graphs; ultimate builds fit the earned SP budget',()=>{
  for(const role of Object.keys(C.ROLES))for(const job of [null,...C.jobsFor({role}).map(j=>j.id)]){
    let h=hero(role,50);h.skillPoints=100;h.learnedSkills=[h.learnedSkills[0]];if(job)h=C.configureHero(h,{command:'advance',jobId:job});
    const target=job?job+'-worldweaver':role+'-convergence-apex',visiting=new Set(),required=new Set();
    function visit(id){assert.ok(!visiting.has(id),'no dependency cycles');if(required.has(id))return;visiting.add(id);const skill=C.skillById(id);assert.ok(skill);for(const dep of skill.requires){assert.ok(C.skillById(dep).tier<skill.tier);visit(dep);}visiting.delete(id);required.add(id);}
    visit(target);
    for(const id of required)if(!h.learnedSkills.includes(id))h=C.configureHero(h,{command:'learn',skillId:id});
    assert.ok(h.learnedSkills.includes(target));assert.ok(h.skillPoints>=0);
    const graph=T.model(h),taken=new Set();for(const node of graph.nodes){assert.ok(node.x>=87&&node.x+87<=graph.width);assert.ok(node.y+90<graph.height);const key=node.x+','+node.y;assert.ok(!taken.has(key));taken.add(key);}
    assert.ok(graph.nodes.some(n=>n.skill.requires.length>=3));
  }
});

test('learning names every missing prerequisite, cannot skip them, and automatic clerics set up teammates',()=>{
  const h=hero('cleric'),skill=C.skillById('cleric-shared-weakness');
  assert.equal(C.canLearn(h,skill.id).ok,false);for(const dependency of skill.requires)assert.ok(C.canLearn(h,skill.id).reason.includes(C.skillById(dependency).name));
  h.learnedSkills.push('cleric-physical-opening');const s=arena([h,hero('warrior')]);
  assert.equal(C.chooseAutoCommand(s,h).skillId,'cleric-physical-opening');
});

test('generated art, walking rows and accessible fallbacks match the shipped presentation',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('../assets/battle-pixel/adventure/provenance.json',import.meta.url)));
  assert.equal(manifest.assets.length,7);
  for(const asset of manifest.assets){const bytes=fs.readFileSync(new URL('../'+asset.file,import.meta.url));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),asset.sha256);assert.match(asset.sourceSha256,/^[a-f0-9]{64}$/);assert.equal(asset.export.kernel,'nearest');assert.equal(asset.visualReview,'passed');assert.ok(asset.prompt.includes('pixel-art'));}
  for(const form of Object.keys(A.FORMS))for(const gender of ['male','female']){const role=C.JOBS[form]?.role || form,h={...hero(role),job:C.JOBS[form]?form:null,gender};assert.ok(A.walkMarkup(h,0).includes('data-walk-form="'+form+'"'));}
  const h=hero('warrior');h.name='<img onerror=alert(1)>';
  const html=A.markup(null,[h]);assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img onerror'));assert.ok(html.includes('data-adventure-pause'));
});
