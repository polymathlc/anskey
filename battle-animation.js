/* Presentation only: generated sprite frames play after a saved battle event. */
(function () {
  'use strict';
  var root = 'assets/battle-pixel/', sheets = root + 'animations/';
  var roles = ['warrior', 'ranger', 'mage', 'cleric'], effects = ['slash', 'fire', 'ice', 'lightning', 'arrow', 'heal'];
  var jobs = ['paladin','berserker','sharpshooter','beastmaster','archmage','chronomancer','hierophant','oracle'];
  var atlases = {
    shockwave:['warrior-advanced',0], guard:['warrior-advanced',1], fury:['warrior-advanced',2], rally:['warrior-advanced',3],
    venom:['ranger-advanced',0], volley:['ranger-advanced',1], thorns:['ranger-advanced',2], phantom:['ranger-advanced',3],
    meteor:['mage-advanced',0], blizzard:['mage-advanced',1], arcane:['mage-advanced',2], time:['mage-advanced',3],
    radiant:['cleric-advanced',0], ward:['cleric-advanced',1], revival:['cleric-advanced',2], purify:['cleric-advanced',3],
    'spirit-wolf':['beastmaster-effects',0], 'spirit-hawk':['beastmaster-effects',1], 'spirit-phoenix':['beastmaster-effects',2], grove:['beastmaster-effects',3]
  };
  var images = new Map(), players = new WeakMap();
  function allSkills() { var c=window.ClassroomBattleContent; return c ? Object.values(c.SKILLS).flat().concat(Object.values(c.JOB_SKILLS || {}).flat()) : []; }
  function skillById(id) { return window.ClassroomBattleCore && ClassroomBattleCore.skillById(id); }
  function sheetName(role,job) { return (jobs.includes(job) ? job : roleName(role)) + '-genders'; }
  function genderName(gender) { return gender === 'female' ? 'female' : 'male'; }
  function recipeFor(hero, value) {
    var skill=typeof value==='string'?skillById(value):value, role=roleName(hero && hero.role), id=skill && skill.id || role+'-attack';
    var effect=skill && skill.effect || {}, family=role==='warrior'?'slash':role==='ranger'?'arrow':role==='mage'?'fire':'lightning';
    if(role==='warrior') {
      if(/earth|fault|worldbreak|roar|cry/.test(id)) family='shockwave';
      else if(/blood|scarlet|crimson|rending|rampage|fury/.test(id)) family='fury';
      else if(/rally|sun|solar|radiant|consecration|dawn/.test(id)) family='rally';
      else if(effect.shield || effect.shieldSelf || skill && skill.passive) family='guard';
    }
    if(role==='ranger') {
      if(/wolf|fang|pack/.test(id)) family='spirit-wolf';
      else if(/hawk|sky-sight/.test(id)) family='spirit-hawk';
      else if(/phoenix/.test(id)) family='spirit-phoenix';
      else if(/bloom|worldtree|barkskin/.test(id)) family='grove';
      else if(/talons/.test(id)) family='lightning';
      else if(/venom/.test(id)) family='venom';
      else if(/thorn|root|trail|nature/.test(id)) family='thorns';
      else if(/phantom|smoke|ambush|quickstep/.test(id)) family='phantom';
      else if(/volley|fan-|rain-|constellation|storm|quiver/.test(id)) family='volley';
    }
    if(role==='mage') {
      if(skill && skill.job==='chronomancer' || /time|reserves/.test(id)) family='time';
      else if(/ice-lance/.test(id)) family='ice';
      else if(/frost|frozen|glacial|zero|winter|crystal/.test(id)) family='blizzard';
      else if(/arcane-pulse/.test(id)) family='lightning';
      else if(/arcane|supernova|sigil/.test(id)) family='arcane';
      else if(/lightning|storm|tempest|conduit/.test(id)) family='lightning';
      else if(/meteor|magma|eruption|collapse|inferno/.test(id)) family='meteor';
    }
    if(role==='cleric') {
      family=effect.power?'radiant':effect.shield?'ward':effect.cleanse?'purify':effect.healAll?'revival':'ward';
      if(skill && skill.job==='oracle') family=/fate|vision|prophe|star|constellation/.test(id)?'purify':family;
      if(id==='cleric-healing-light') family='heal';
    }
    var catalog=allSkills(), ordinal=Math.max(0,catalog.findIndex(function(s){return s.id===id;}));
    var tier=skill && skill.tier || 1;
    // Each learned skill has its own stable choreography. Branch imagery describes
    // what it does; tier, cadence, spread and trajectory distinguish related spells.
    var count=/twin/.test(id)?2:/rampage|pack|volley|barrage|rain|storm|constellation/.test(id)?Math.min(4,tier+1):1;
    var travel=/arrow|shot|piercer|pounce|fang|dive|flight|rush|charge/.test(id)?'projectile':/meteor|rain|falling|talons/.test(id)?'fall':/cyclone|vortex|time|warp|moment|rewind/.test(id)?'orbit':'burst';
    if(skill && skill.passive) travel='aura';
    return {id:id,family:family,count:count,trajectory:travel,duration:540+(ordinal%12)*17,interval:65+(ordinal%5)*19,
      scale:0.84+tier*0.085+(ordinal%3)*0.025,spread:12+(ordinal%7)*3,tilt:(ordinal%9-4)*5,
      accent:ordinal%4,passive:!!(skill && skill.passive),effect:effect};
  }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function roleName(role) { return role === 'healer' ? 'cleric' : roles.includes(role) ? role : 'warrior'; }
  function reduced() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function load(name) {
    if (!images.has(name)) {
      var image = new Image();
      var promise = new Promise(function (resolve) {
        image.onload = function () { resolve(image.naturalWidth > 0); };
        image.onerror = function () { resolve(false); };
      });
      images.set(name, promise); image.src = sheets + name + '-sheet.png';
    }
    return images.get(name);
  }
  function heroMarkup(role, options) {
    options = options || {}; role = roleName(role); var sheet=sheetName(role,options.job), gender=genderName(options.gender);
    var title=gender.charAt(0).toUpperCase()+gender.slice(1)+' '+(options.alt || (jobs.includes(options.job)?options.job:role)+' pixel hero');
    return '<span class="cbaHero ' + esc(options.className || 'cbAvatar') + (options.dormant ? ' cbaDormant' : '') + '" data-cba-role="' + role + '" data-cba-sheet="' + sheet + '" data-cba-gender="'+gender+'"' + (jobs.includes(options.job)?' data-cba-job="'+options.job+'"':'') + ' role="img" aria-label="' + esc(title) + '"><span class="cbaFallback" aria-hidden="true">'+(gender==='female'?'♀':'♂')+'</span><span class="cbaFrames" aria-hidden="true"></span></span>';
  }
  function mount(container) {
    if (!container) return;
    var nodes = Array.from(container.querySelectorAll('.cbaHero'));
    if (container.matches && container.matches('.cbaHero')) nodes.unshift(container);
    nodes.forEach(function (node, index) {
      if (node.dataset.cbaMounted) return;
      node.dataset.cbaMounted = 'true';
      var role = node.dataset.cbaSpecial==='chung' ? 'chung' : sheetName(node.dataset.cbaRole,node.dataset.cbaJob);
      node.querySelector('.cbaFrames').style.backgroundImage = 'url("' + sheets + role + '-sheet.png")';
      node.querySelector('.cbaFrames').style.setProperty('--cba-phase', (-index * .23) + 's');
      load(role).then(function (ok) {
        if (node.isConnected) node.classList.toggle('cbaReady', ok);
      });
    });
  }
  function prepare(hero) {
    var names=hero?[hero.isChung?'chung':sheetName(hero.role,hero.job)]:roles.map(function(role){return sheetName(role);}).concat(effects);
    (hero && hero.learnedSkills || []).forEach(function(id){var recipe=recipeFor(hero,id),atlas=atlases[recipe.family];names.push(atlas?atlas[0]:recipe.family);});
    return Promise.all(Array.from(new Set(names)).map(load));
  }
  function effectFor(hero, event) {
    if(hero && hero.isChung) return 'chung-punch';
    var role = roleName(hero && hero.role), skill = skillById(event.skillId);
    if (event.itemId === 'fire-flask' || event.itemId === 'starbomb') return 'fire';
    if (skill) return recipeFor(hero,skill).family;
    if (role === 'ranger') return 'arrow';
    if (role === 'mage') {
      if (skill && skill.branch === 'Frostcraft') return 'ice';
      if (skill && skill.branch === 'Arcanist') return 'lightning';
      return 'fire';
    }
    if (role === 'cleric') return 'lightning';
    return 'slash';
  }
  function unmount(container) {
    if (!container) return;
    var player = players.get(container); if (player) player.cancel();
  }
  function playDuel(container, options) {
    unmount(container); options = options || {};
    var event = options.event || {}, hero = options.hero, timers = new Set(), created = [], motions = [], done = false, resolveFinished;
    var finished = new Promise(function (resolve) { resolveFinished = resolve; });
    var heroActor = options.heroActor || container.querySelector('[data-cba-actor="hero"]'), enemyActor = options.enemyActor || container.querySelector('[data-cba-actor="enemy"]');
    var sprite = heroActor && heroActor.querySelector('.cbaHero');
    var skill=skillById(event.skillId), recipe=recipeFor(hero,skill), fx = effectFor(hero, event), wasDormant=sprite && sprite.classList.contains('cbaDormant'), media = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    if(hero && hero.isChung) recipe.id='one-punch-chung';
    function stage(name, text) {
      if (done) return;
      container.dataset.cbaPhase = name;
      if (options.onStage) options.onStage(name, text);
    }
    function finish(cancelled) {
      if (done) return;
      if (!cancelled) stage('settled', '');
      done = true; timers.forEach(clearTimeout); motions.forEach(function (motion) { motion.cancel(); });
      created.forEach(function (node) { node.remove(); });
      if (sprite) { sprite.classList.remove('cbaActing'); if(wasDormant) sprite.classList.add('cbaDormant'); }
      container.classList.remove('cbaPlaying'); delete container.dataset.cbaPhase; delete container.dataset.skillAnimation;
      if (media && media.removeEventListener) media.removeEventListener('change', motionChanged);
      if (players.get(container) === player) players.delete(container);
      resolveFinished({ cancelled: !!cancelled });
    }
    function motionChanged() { if (reduced()) finish(false); }
    function later(fn, time) { var id = setTimeout(function () { timers.delete(id); if (!done && container.isConnected) fn(); else finish(true); }, time); timers.add(id); }
    function animate(node, frames, duration) { if (node && node.animate && !reduced()) motions.push(node.animate(frames, { duration: duration, easing: 'steps(4,end)' })); }
    function findHero(id) {
      if(options.findHero) return options.findHero(id);
      return Array.from(container.querySelectorAll('[data-cba-hero-id]')).find(function (node) { return node.dataset.cbaHeroId === id; });
    }
    function effect(name, target, label, travelling, choreography, index) {
      if (!target) return;
      var spec=atlases[name], sheet=spec?spec[0]:name, r=choreography, step=index || 0;
      var node = document.createElement('span'); node.className = 'cbaEffect cbaFx-' + name + (spec?' cbaAtlasEffect':'');
      node.dataset.skillAnimation=r?r.id:'';
      node.style.backgroundImage = 'url("' + sheets + sheet + '-sheet.png")'; node.setAttribute('aria-hidden', 'true');
      if(spec) node.style.setProperty('--cba-row',(spec[1]*100/3)+'%');
      if(r) {
        node.style.setProperty('--cba-effect-duration',r.duration+'ms');
        node.style.setProperty('--cba-effect-scale',String(r.scale));
        node.style.setProperty('--cba-effect-tilt',((step%2?-1:1)*r.tilt)+'deg');
        node.style.marginLeft=((step-(r.count-1)/2)*r.spread)+'px';
        node.style.marginTop=((step%2?1:-1)*r.accent*3)+'px';
      }
      target.appendChild(node); created.push(node);
      load(sheet).then(function (ok) { if (!ok) node.hidden = true; });
      if ((travelling || r && r.trajectory==='projectile') && heroActor && enemyActor && target===enemyActor) {
        var a = heroActor.getBoundingClientRect(), b = enemyActor.getBoundingClientRect();
        animate(node, [{ translate: (a.left-b.left)+'px 0px', opacity:1 }, { translate:'0px 0px',opacity:1 }], 360);
      } else if(r && r.trajectory==='fall') animate(node,[{translate:'-28px -70px',opacity:0},{translate:'0px 0px',opacity:1}],380);
      else if(r && (r.trajectory==='orbit' || r.trajectory==='aura')) animate(node,[{rotate:'-25deg',opacity:.6},{rotate:'18deg',opacity:1},{rotate:'0deg',opacity:.8}],r.duration);
      if (label) {
        var number = document.createElement('b'); number.className = 'cbaNumber' + (/heal|revival|grove|purify/.test(name) ? ' cbaHealing' : '');
        var lane=target.querySelectorAll('.cbaNumber').length; number.style.top=(30+lane*22)+'px';
        number.textContent = label; number.setAttribute('aria-hidden', 'true'); target.appendChild(number); created.push(number);
      }
      later(function () { node.remove(); }, r?r.duration+30:700);
    }
    function skillEffect(target,label,family) {
      for(var i=0;i<recipe.count;i++) (function(index){
        var run=function(){effect(family || recipe.family,target,index===0?label:'',false,recipe,index);};
        if(index) later(run,index*recipe.interval); else run();
      })(i);
    }
    function supportEffects() {
      (event.supported || []).forEach(function(entry){
        var names={shield:'ward',mana:'arcane',cleanse:'purify',haste:'time'}, name=names[entry.effect];
        if(name) effect(name,findHero(entry.heroId),entry.effect==='mana'?(options.preview?'Mana restored':'+'+entry.amount+' MP'):entry.effect==='shield'?(options.preview?'Shield':'Shield +'+entry.amount):entry.effect==='haste'?'Haste':'Cleansed',false,recipe,0);
      });
      (event.afflicted || []).forEach(function(entry){effect(entry.effect==='poison'?(roleName(hero.role)==='mage'?'fire':'venom'):'time',enemyActor,entry.effect==='poison'?(roleName(hero.role)==='mage'?'Burning':'Poisoned'):'Weakened',false,recipe,0);});
      // A utility cast still has a visible incantation if everyone is already full.
      if(skill && !event.damage && !(event.healed || []).length && !(event.supported || []).length) skillEffect(heroActor,'',recipe.family);
    }
    var player = { finished: finished, cancel: function () { finish(true); } };
    players.set(container, player);
    if (reduced() || !hero || !event || !(event.type === 'auto' || hero.isChung && event.type==='summon' || options.arena && event.type==='answer' && event.outcome==='correct' || options.preview)) { finish(false); return player; }
    function begin() {
    if(done || !container.isConnected) { finish(true); return; }
    if(reduced()) { finish(false); return; }
    if (media && media.addEventListener) media.addEventListener('change', motionChanged);
    container.classList.add('cbaPlaying','cbaStage'); container.dataset.skillAnimation=recipe.id;
    stage('windup', hero.name + ' uses ' + (event.move || 'Attack') + '…');
    if (sprite) { sprite.classList.remove('cbaDormant'); sprite.classList.add('cbaActing'); }
    if(recipe.passive) effect(recipe.family,heroActor,'Passive aura',false,recipe,0);
    animate(sprite, roleName(hero.role) === 'warrior' ? [{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(20px)' }, { transform: 'translateX(0)' }] : [{ transform: 'translateY(0)' }, { transform: 'translateY(-5px)' }, { transform: 'translateY(0)' }], 750);
    later(function () {
      stage('hero-impact', hero.name + ': ' + (event.move || 'Attack') + (event.damage ? ' · ' + event.damage + ' damage' : ''));
      if (event.damage > 0) { if(skill) skillEffect(enemyActor,options.preview?'':'−'+event.damage); else effect(fx, enemyActor, '−' + event.damage, fx === 'arrow'); animate(enemyActor && enemyActor.querySelector('img'), [{ filter: 'brightness(1)' }, { filter: 'brightness(2)' }, { filter: 'brightness(1)' }], 420); }
      var enemyTargets = (event.enemy && event.enemy.targets || []).slice();
      (event.targets || []).forEach(function (target) {
        var enemyIndex = enemyTargets.findIndex(function (other) { return other.heroId === target.heroId && other.damage === target.damage; });
        if (enemyIndex >= 0) { enemyTargets.splice(enemyIndex, 1); return; }
        if (target.damage > 0) effect('slash', findHero(target.heroId), '−' + target.damage, false);
      });
      // The combined event also includes enemy-triggered revival. Do not show it early.
      var enemyHealed = (event.enemy && event.enemy.healed || []).slice();
      (event.healed || []).forEach(function (entry) {
        var enemyIndex = enemyHealed.findIndex(function (other) { return other.heroId === entry.heroId && other.amount === entry.amount; });
        if (enemyIndex >= 0) { enemyHealed.splice(enemyIndex, 1); return; }
        if (entry.amount > 0) { effect('heal', findHero(entry.heroId), options.preview?'':'+' + entry.amount, false); if(skill && recipe.family!=='heal') effect(recipe.family,findHero(entry.heroId),'',false,recipe,0); }
      });
      supportEffects();
    }, 330);
    later(function () { if (sprite) { sprite.classList.remove('cbaActing'); if(wasDormant) sprite.classList.add('cbaDormant'); } }, 780);
    var heroEnd=330+(recipe.count-1)*recipe.interval+recipe.duration+30;
    var enemyStart=Math.max(1050,heroEnd+80);
    if (event.enemy) {
      later(function () {
        stage('enemy-windup', 'Enemy uses ' + event.enemy.move + '…');
        animate(enemyActor && enemyActor.querySelector('img'), [{ transform: 'translateX(0)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-16px)' }, { transform: 'translateX(0)' }], 560);
      }, enemyStart);
      later(function () {
        var targets = event.enemy.targets || [];
        stage('enemy-impact', 'Enemy: ' + event.enemy.move + ' · ' + targets.reduce(function (sum, target) { return sum + target.damage; }, 0) + ' damage');
        targets.forEach(function (target) { if (target.damage > 0) effect('slash', findHero(target.heroId), '−' + target.damage, false); });
        (event.enemy.healed || []).forEach(function (entry) { if (entry.amount > 0) effect('heal',findHero(entry.heroId),'+'+entry.amount,false); });
      }, enemyStart+260);
    }
    later(function () { finish(false); }, event.enemy ? enemyStart+1080 : Math.max(1450,heroEnd+80));
    }
    // Wait for just this cast's generated pixels before starting its timeline.
    // Slow first loads cannot consume the animation while the image is invisible.
    var wanted=[hero.isChung?'chung':sheetName(hero.role,hero.job),atlases[fx]?atlases[fx][0]:fx,'heal'];
    if(event.enemy) wanted.push('slash');
    if(roleName(hero.role)==='mage' && (event.afflicted || []).some(function(entry){return entry.effect==='poison';})) wanted.push('fire');
    if((event.supported || []).length || (event.afflicted || []).length) wanted=wanted.concat(['cleric-advanced','mage-advanced','ranger-advanced']);
    Promise.all(Array.from(new Set(wanted)).map(load)).then(begin);
    return player;
  }
  function chungMarkup() {
    return '<span class="cbaHero cbAvatar" data-cba-role="warrior" data-cba-special="chung" data-cba-sheet="chung" role="img" aria-label="One-Punch Chung"><span class="cbaFallback" aria-hidden="true">C</span><span class="cbaFrames" aria-hidden="true"></span></span>';
  }
  function playChung(container,options) {
    options=options || {};
    if(!container || !options.event || options.event.type!=='summon') return {finished:Promise.resolve({cancelled:true}),cancel:function(){}};
    unmount(container);
    var actor=document.createElement('div');actor.className='cbaChungActor';actor.innerHTML=chungMarkup()+'<strong>One-Punch Chung</strong>';container.appendChild(actor);mount(actor);
    var hero={id:'teacher:chung',name:'One-Punch Chung',role:'warrior',isChung:true};
    var player=playDuel(container,{hero:hero,event:options.event,heroActor:actor,enemyActor:options.enemyActor || container.querySelector('[data-cba-actor="enemy"],.cbBossVisual'),onStage:options.onStage});
    player.finished.then(function(){actor.remove();});return player;
  }
  function playArena(container,options) { return playDuel(container,Object.assign({},options,{arena:true})); }
  function skillPreviewMarkup(skill,hero) {
    return '<div class="cbaPreviewStage cbQuickDuel" aria-label="'+esc(skill.name)+' animation preview"><div class="cbaPreviewActor" data-cba-actor="hero" data-cba-hero-id="'+esc(hero.id || 'preview')+'">'+heroMarkup(hero.role,{job:hero.job,gender:hero.gender})+'</div><div class="cbaPreviewActor cbaPreviewTarget" data-cba-actor="enemy"><img src="assets/battle-pixel/goblin.png" alt="Practice target"></div></div>';
  }
  function previewSkill(container,hero,skill) {
    unmount(container); if(!container || !hero || !skill) return {finished:Promise.resolve({cancelled:true}),cancel:function(){}};
    container.innerHTML=skillPreviewMarkup(skill,hero); mount(container);
    var id=hero.id || 'preview', effect=skill.effect || {}, event={type:'preview',skillId:skill.id,move:skill.name,damage:effect.power?1:0,healed:[],supported:[],afflicted:[]};
    if(effect.heal || effect.healAll || effect.leech) event.healed.push({heroId:id,amount:1});
    if(effect.shield || effect.shieldSelf) event.supported.push({heroId:id,effect:'shield',amount:0});
    if(effect.mana || effect.manaAll) event.supported.push({heroId:id,effect:'mana',amount:0});
    if(effect.cleanse) event.supported.push({heroId:id,effect:'cleanse',amount:0});
    if(effect.haste) event.supported.push({heroId:id,effect:'haste',amount:0});
    if(effect.poison) event.afflicted.push({effect:'poison'});
    if(effect.weakenBoss) event.afflicted.push({effect:'weaken'});
    var target=container.querySelector('.cbaPreviewTarget'); if(skill.passive || !effect.power) target.hidden=true;
    return playDuel(container,{hero:hero,event:event,preview:true});
  }
  window.ClassroomBattleAnimation = { heroMarkup: heroMarkup, chungMarkup:chungMarkup, playChung:playChung, mount: mount, unmount: unmount, prepare: prepare, playDuel: playDuel, effectFor: effectFor, recipeFor:recipeFor, previewSkill:previewSkill, skillPreviewMarkup:skillPreviewMarkup, playArena:playArena, reducedMotion: reduced };
})();
