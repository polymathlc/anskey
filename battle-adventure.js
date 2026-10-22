/* Saved adventure presentation. Scrolling, walking and pausing never write game state. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./battle-core.js'));
  else root.ClassroomAdventure=factory(root.ClassroomBattleCore);
})(typeof globalThis!=='undefined'?globalThis:this,function(Core){
  'use strict';
  var BIOMES={forest:'Emerald Trail',ruins:'Moonfall Ruins',cavern:'Crystal Hollows',volcano:'Ember Highlands'};
  var EVENTS={'guardian-shrine':['Guardian shrine','The first correct answer grants the party a 15% HP shield.'],
    'mana-spring':['Mana spring','The first correct answer restores 18 MP to every hero.'],
    'travelling-smith':['Travelling smith','The first correct answer opens both enemy defences by 15% for 4 allied damaging actions.']};
  var FORMS={warrior:['walk-base',0],ranger:['walk-base',2],mage:['walk-base',4],cleric:['walk-base',6],paladin:['walk-martial',0],berserker:['walk-martial',2],sharpshooter:['walk-martial',4],beastmaster:['walk-martial',6],archmage:['walk-mystic',0],chronomancer:['walk-mystic',2],hierophant:['walk-mystic',4],oracle:['walk-mystic',6]};
  var mounts=new WeakMap();
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function walkMarkup(hero,index){
    var form=Core.JOBS[hero.job]&&Core.JOBS[hero.job].role===hero.role&&hero.level>=15?hero.job:hero.role;
    var spec=FORMS[form]||FORMS.warrior,row=spec[1]+(hero.gender==='female'?1:0),title=(hero.gender==='female'?'Female ':'Male ')+(Core.JOBS[form]||Core.ROLES[form]||Core.ROLES.warrior).name;
    return '<div class="advTraveller" data-adventure-hero="'+esc(hero.id)+'" style="--adv-index:'+index+'"><span class="advWalk" data-walk-form="'+esc(form)+'" role="img" aria-label="'+esc(title+' walking')+'" style="--adv-row:'+row/7*100+'%;--adv-aspect:'+(spec[0]==='walk-martial'?4/3:1)+';background-image:url(assets/battle-pixel/adventure/'+spec[0]+'.png)"></span><span class="advName">'+esc(hero.name)+'</span></div>';
  }
  function encounterText(state){
    var road=state&&state.adventure;
    if(!road)return ['The adventure begins','Spin the wheel to lead your party along the trail.'];
    if(road.chapterGuardian)return ['CHAPTER GUARDIAN','Win to complete this chapter. Empowered enemy: 1.8× HP, 1.25× attack and 1.6× victory XP. Your route gifts still apply.'];
    if(road.kind==='uber')return ['UBER BOSS · 2% encounter','A rare empowered enemy: 1.8× HP, 1.25× attack and 1.6× victory XP.'];
    if(road.kind==='chest')return ['RARE CHEST · 6% discovery',state.status==='victory'?'Chest opened! Every hero’s bonus treasure is saved.':'A locked chest is guarded by this enemy. Win to grant every hero a bonus rare-or-better item.'];
    if(road.kind==='event'){var event=EVENTS[road.eventId]||EVENTS['guardian-shrine'];return [event[0]+(road.resolved?' · blessing received':''),road.resolved?'Your roadside blessing is saved for this encounter.':event[1]];}
    return ['Enemy on the trail','Correct answers power your hero’s move. Combine defence breaks with matching damage types.'];
  }
  function markup(state,heroes,options){
    options=options||{};var road=state&&state.adventure,biome=road&&BIOMES[road.biome]?road.biome:'forest';
    var travelling=!!options.travelling||!state||state.status!=='active',info=encounterText(state),limit=options.compact?4:8,party=(heroes||[]).slice(0,limit),boss=state&&Core.bossById(state.bossId);
    var enemy=!travelling&&boss&&typeof window!=='undefined'&&window.ClassroomBattleDisplay?ClassroomBattleDisplay.enemyArt(boss):'';
    return '<section class="advScene '+(travelling?'advTravelling ':'advEncounter ')+(road&&road.kind==='uber'?'advUber':'')+'" aria-label="Class adventure"><div class="advBackdrop" style="background-image:url(assets/battle-pixel/adventure/'+biome+'.png)"></div><div class="advMist"></div><div class="advHeading"><span>CHAPTER '+Math.ceil((road&&road.step||1)/16)+' / '+esc(BIOMES[biome])+'</span><strong>Checkpoint '+(road&&road.step||1)+'</strong><button type="button" data-adventure-pause aria-pressed="false" aria-label="Pause adventure motion">Ⅱ</button></div><div class="advParty" aria-label="Travelling party">'+party.map(walkMarkup).join('')+'</div>'+((heroes||[]).length>limit?'<span class="advMore">+'+((heroes||[]).length-limit)+' party members</span>':'')+'<div class="advRoadObject" aria-hidden="true">'+(road&&road.kind==='chest'?'<span class="cbChest"></span>':road&&road.kind==='event'?'<span class="advShrine">✧</span>':enemy)+'</div><div class="advTrail"></div><div class="advCaption"><strong>'+esc(travelling?'Onward, adventurers…':info[0])+'</strong><p>'+esc(info[1])+'</p></div></section><div class="advBreaks" aria-label="Enemy defence breaks">'+breaks(state)+'</div>';
  }
  function breaks(state){
    return Object.entries(state&&state.exposures||{}).filter(function(pair){return pair[1].turns>0;}).map(function(pair){var channel=pair[0],value=pair[1],hero=(state.heroes||[]).find(function(h){return h.id===value.heroId;});return '<span class="advBreak advBreak-'+esc(channel)+'">'+esc(channel)+' defence −'+Math.round(value.amount*100)+'% · '+value.turns+' damaging actions'+(hero?' · '+esc(hero.name):'')+'</span>';}).join('');
  }
  function render(host,state,heroes,options){
    if(!host)return;options=options||{};
    var prior=mounts.get(host),key=JSON.stringify([state&&state.encounterId,state&&state.status,state&&state.adventure,!!options.travelling,!!options.compact,(heroes||[]).map(function(h){return [h.id,h.name,h.role,h.job,h.gender,h.level];})]);
    if(prior&&prior.key===key){var status=host.querySelector('.advBreaks');if(status)status.innerHTML=breaks(state);return;}
    var paused=prior&&prior.paused;
    host.innerHTML=markup(state,heroes,options);
    var record={key:key,paused:!!paused};mounts.set(host,record);
    function setPaused(){var scene=host.querySelector('.advScene'),button=host.querySelector('[data-adventure-pause]');scene.classList.toggle('advPaused',record.paused);button.setAttribute('aria-pressed',String(record.paused));button.setAttribute('aria-label',record.paused?'Resume adventure motion':'Pause adventure motion');button.textContent=record.paused?'▶':'Ⅱ';}
    host.querySelector('[data-adventure-pause]').addEventListener('click',function(){record.paused=!record.paused;setPaused();});setPaused();
  }
  return {render:render,markup:markup,walkMarkup:walkMarkup,encounterText:encounterText,BIOMES:BIOMES,FORMS:FORMS};
});
