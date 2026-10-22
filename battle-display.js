/* Shared saved treasure and combat history. Presentation never calculates combat. */
(function (root) {
  'use strict';
  var Core = root.ClassroomBattleCore;
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function itemIcon(item) {
    var art = item && item.art;
    var columns = art && art.columns != null ? art.columns : 5, rows = art && art.rows != null ? art.rows : 2;
    if (!art || !/^(items-[1-5]|gear-[a-z0-9]+|runes-1|uniques-1|pets|pets-[a-z0-9-]+|pet-[a-z0-9-]+)$/.test(art.sheet) || !validTile(art,columns,rows)) return '<span class="cbItemIcon cbItemUnknown" aria-hidden="true">◆</span>';
    var frame=art.frame,framed=frame && ['x','y','width','height','atlasWidth','atlasHeight'].every(function(key){return Number.isInteger(frame[key]);}) && frame.x>=0 && frame.y>=0 && frame.width>0 && frame.height>0 && frame.atlasWidth<=4096 && frame.atlasHeight<=4096 && frame.x+frame.width<=frame.atlasWidth && frame.y+frame.height<=frame.atlasHeight;
    var size=framed?frame.atlasWidth/frame.width*100+'% '+frame.atlasHeight/frame.height*100+'%':columns*100+'% '+rows*100+'%';
    var offset=framed?(frame.atlasWidth===frame.width?0:frame.x/(frame.atlasWidth-frame.width)*100)+'% '+(frame.atlasHeight===frame.height?0:frame.y/(frame.atlasHeight-frame.height)*100)+'%':position(art.col,columns)+'% '+position(art.row,rows)+'%';
    return '<span class="cbItemIcon" role="img" aria-label="' + esc(item.name) + '" style="background-image:url(assets/battle-pixel/items/' + art.sheet + '.png);background-size:' + size + ';background-position:' + offset + '"></span>';
  }
  function validTile(art,columns,rows) { return Number.isInteger(columns) && columns > 0 && columns <= 10 && Number.isInteger(rows) && rows > 0 && rows <= 10 && Number.isInteger(art.col) && art.col >= 0 && art.col < columns && Number.isInteger(art.row) && art.row >= 0 && art.row < rows; }
  function position(index,count) { return count > 1 ? index / (count - 1) * 100 : 0; }
  function enemyArt(enemy, id) {
    if (!enemy) return '';
    var art=enemy.art, attrs=(id ? ' id="' + esc(id) + '"' : '') + ' role="img" aria-label="' + esc(enemy.name + ' pixel enemy') + '"';
    if (art && /^assets\/battle-pixel\/bosses\/atlas-\d+\.png$/.test(art.sheet) && validTile(art,art.columns,art.rows)) return '<span class="cbEnemySprite"' + attrs + ' style="--cb-enemy-aspect:' + (Number.isFinite(art.aspect) && art.aspect > 0 && art.aspect <= 4 ? art.aspect : 1) + ';background-image:url(' + art.sheet + ');background-size:' + art.columns*100 + '% ' + art.rows*100 + '%;background-position:' + position(art.col,art.columns) + '% ' + position(art.row,art.rows) + '%"></span>';
    if (!/^assets\/(battle-pixel|classroom-bosses)\/[a-zA-Z0-9/-]+\.png$/.test(enemy.image || '')) return '<span class="cbMystery" aria-label="Boss artwork unavailable">♜</span>';
    return '<img' + (id ? ' id="' + esc(id) + '"' : '') + ' src="' + esc(enemy.image) + '" alt="' + esc(enemy.name + ' pixel enemy') + '">';
  }
  function slots() {
    var definitions=Core.EQUIPMENT_SLOTS || {};
    return Array.isArray(definitions) ? definitions : Object.keys(definitions).map(function(key){return Object.assign({key:key},definitions[key]);});
  }
  function slotName(key) { var slot=slots().find(function(row){return row.key===key;});return slot ? slot.name : key || 'Consumable'; }
  function equipmentPanel(hero, options) {
    options=options || {};var prefix=options.prefix==='sh'?'sh':'cb', loadout=Core.loadoutFor(hero), inventory=(hero.inventory || []).filter(function(entry){return entry.quantity > 0;});
    function slot(key) {
      var definition=slots().find(function(row){return row.key===key;}) || {name:key}, entry=inventory.find(function(row){return row.id===loadout[key];}), item=entry && Core.itemById(entry.itemId);
      var candidates=inventory.filter(function(row){return Core.equipmentFits(Core.itemById(row.itemId),key) && Object.keys(loadout).filter(function(slot){return slot!==key && loadout[slot]===row.id;}).length<row.quantity;});
      return '<article class="cbGearSlot cbRarity-' + esc(item ? item.rarity : 'common') + '" data-equipment-slot="' + key + '"><h5>' + esc(definition.name) + '</h5><details class="cbGearMenu"><summary class="cbGearCurrent">' + (item ? itemIcon(item) : '<span class="cbEmptySlot" aria-hidden="true">' + esc(definition.icon || '◇') + '</span>') + '<div><strong>' + esc(item ? item.name : 'Empty slot') + '</strong><small>' + esc(item ? (Core.RARITIES[item.rarity] || {}).name || item.rarity : key==='pet' ? 'Choose a companion' : 'Find gear in treasure') + '</small></div></summary>' + (item ? '<div class="cbGearDropdown"><p>' + esc(item.description) + '</p>' + socketSummary(entry) + socketButton(entry,key,options.locked) + '</div>' : '<p>Choose equipment from the list below.</p>') + '</details><label class="cbGearChoice"><span class="cbVisuallyHidden">Change ' + esc(definition.name) + '</span><select data-' + prefix + '-loadout-slot="' + key + '" aria-label="Change ' + esc(definition.name) + '"' + (options.locked || !candidates.length ? ' disabled' : '') + '><option value="">' + (item ? 'Change equipment…' : 'Choose equipment…') + '</option>' + candidates.map(function(candidate){var value=Core.itemById(candidate.itemId);return '<option value="' + esc(candidate.id) + '"' + (entry && candidate.id===entry.id ? ' selected' : '') + '>' + esc(value.name + ' · ' + ((Core.RARITIES[value.rarity] || {}).name || value.rarity) + (Core.socketable(value)?' · '+Core.socketsFor(candidate).length+' sockets':'')) + '</option>';}).join('') + '</select></label>' + (item ? '<button type="button" class="cbGearRemove" data-' + prefix + '-remove-slot="' + key + '" aria-label="Remove ' + esc(definition.name) + '"' + (options.locked ? ' disabled' : '') + '>Remove</button>' : '') + '</article>';
    }
    return '<section class="cbEquipment" aria-label="Character equipment and pet"><div class="cbEquipmentHeading"><div><span class="cbEyebrow">CHARACTER EQUIPMENT</span><h3>Equipment & companion</h3></div><span>' + Object.keys(loadout).filter(function(key){return !!loadout[key];}).length + ' / ' + slots().length + ' slots</span></div><p class="cbEquipmentHint">Wear one item in each slot. Click an equipped item for its details and Socket runes menu. The first rune in your weapons sets normal-attack damage type. Their bonuses work together. Treasure automatically upgrades each slot by rarity.</p><div class="cbLoadout"><div class="cbLoadoutLeft">' + ['helm','torso','gloves','legs','boots'].map(slot).join('') + '</div><div class="cbLoadoutPortrait">' + (options.portrait || '') + '<strong>' + esc(hero.name) + '</strong><span>LEVEL ' + Number(hero.level || 1) + '</span></div><div class="cbLoadoutRight">' + ['amulet','ring1','ring2','pet'].map(slot).join('') + '</div><div class="cbLoadoutWeapons">' + ['mainHand','offHand'].map(slot).join('') + '</div></div></section>';
  }
  function rotation(state) { var pool=Core.BOSSES.filter(function(b){return !b.legacy;}), progress=state && state.bossRotation;return 'Boss round ' + (progress && progress.round || 1) + ' · ' + (progress && progress.seen ? progress.seen.length : 0) + '/' + pool.length + ' encountered'; }
  function treasure(state) {
    return '<div class="cbRewardGrid" aria-label="Treasure received by every student">' + (state.rewards || []).map(function (reward) {
      var hero = (state.heroes || []).find(function (h) { return h.id === reward.heroId; }), item = Core.itemById(reward.itemId);
      return '<article class="cbReward cbRarity-' + esc(reward.rarity) + '">' + itemIcon(item) + '<strong>' + esc(hero ? hero.name : 'Hero') + '</strong><span>' + esc(reward.name) + '</span><small>' + esc(reward.rarity).toUpperCase() + (reward.source==='road-chest'?' · ROAD CHEST BONUS':'') + ' · +' + Number(reward.xp || 0) + ' XP</small><p>' + esc(reward.description || item && item.description) + '</p>' + (reward.sockets ? '<small>' + reward.sockets.length + ' sockets</small>' : '') + (reward.autoEquippedName ? '<small class="cbEquippedNote">Auto-equipped: ' + esc(reward.autoEquippedName) + '</small>' : '') + '</article>';
    }).join('') + '</div>';
  }
  function log(state) {
    var rows = state && state.combatLog || [];
    if (!rows.length) return '<section class="cbDamageLog" aria-label="Damage log"><h4>Damage log</h4><p>Saved attacks, healing and enemy replies appear here.</p></section>';
    function effects(row) {
      var parts=[];
      (row.actions || []).forEach(function(a){
        var hero=(state.heroes || []).find(function(h){return h.id===a.heroId;}),b=a.enemyId && Core.bossById(a.enemyId);
        var skill=a.skillId && Core.skillById(a.skillId);
        parts.push(esc(hero?hero.name:b?b.name:'Hero')+': '+esc(a.move || 'Attack')+(skill?' ['+esc(Core.targetingLabel(skill))+']':a.targeting?' ['+esc(a.targeting==='aoe'?'AoE damage':'Single-target damage')+']':'')+(a.damage?' −'+a.damage:'')+(a.enemyTargets || []).map(function(t){return ' → '+esc(Core.bossById(t.enemyId).name)+' −'+t.damage;}).join(''));
      });
      if(row.comboBurst)parts.push('CLASS COMBO · '+esc(row.comboBurst.name));
      if(row.preparation)parts.push('Preparation: '+esc(row.preparation));
      if(row.damageType)parts.push(esc(row.damageType)+' damage');
      if(row.synergy){var setter=(state.heroes||[]).find(function(h){return h.id===row.synergy.sourceHeroId;});parts.push('TEAM SYNERGY · '+esc(row.synergy.channel)+' defence break'+(setter?' by '+esc(setter.name):''));}
      if(row.discovery)parts.push('Roadside blessing: '+esc(row.discovery.replace(/-/g,' ')));
      (row.targets || []).forEach(function (r) { parts.push(esc(r.name || 'Hero') + ' −' + Number(r.damage || 0) + ' HP' + (r.absorbed ? ' · ' + Number(r.absorbed) + ' blocked' : '')); });
      (row.healed || []).forEach(function (r) { parts.push(esc(r.name || 'Hero') + ' +' + Number(r.amount || 0) + ' HP'); });
      (row.supported || []).forEach(function (r) { parts.push(esc(r.name || 'Hero') + ' · ' + esc(r.effect) + ' +' + Number(r.amount || 0)); });
      (row.afflicted || []).forEach(function (r) { parts.push(esc(r.effect) + ' ' + (r.turns?Math.round(Number(r.amount||0)*100)+'% · '+r.turns+' damaging actions':Number(r.amount || 0))); });
      (row.ailmentTicks || []).forEach(function(tick){parts.push(esc(tick.effect)+': −'+Number(tick.amount)+' enemy HP');});
      if(row.giftSkill){var gift=Core.skillById(row.giftSkill);parts.push('Unique gift learned: '+esc(gift?gift.name:row.giftSkill));}
      if (row.poisonDamage) parts.push('Poison: −' + Number(row.poisonDamage) + ' enemy HP');
      if (row.bossHealed) parts.push('Enemy +' + Number(row.bossHealed) + ' HP');
      return parts.length ? '<small>' + parts.join(' · ') + '</small>' : '';
    }
    return '<section class="cbDamageLog" aria-label="Damage log"><h4>Damage log <small>Latest ' + rows.length + ' saved turns</small></h4><ol>' + rows.slice().reverse().map(function (row) {
      var outcome = row.outcome === 'incorrect' ? 'Incorrect answer · no attack' : row.outcome === 'skip' ? 'Question skipped · no attack' : esc(row.move || 'Attack') + (row.points ? ' · +' + Number(row.points) + ' points' : '') + (row.damage ? ' → ' + esc(row.enemyName || 'Enemy') + ' −' + Number(row.damage) + ' HP' : '') + (row.critical ? ' · CRITICAL' : '');
      return '<li data-combat-id="' + esc(row.id) + '"><strong>' + esc(row.actorName || 'Hero') + '</strong><span>' + outcome + '</span>' + effects(row) + (row.enemy ? '<div class="cbLogEnemy"><b>' + esc(row.enemy.actorName || row.enemyName || 'Enemy') + '</b> · ' + esc(row.enemy.move) + effects(row.enemy) + '</div>' : '') + '</li>';
    }).join('') + '</ol></section>';
  }
  function socketSummary(entry) {
    var item=Core.itemById(entry.itemId);
    if(!Core.socketable(item))return item && item.type==='rune'?'<small class="cbSocketHint">Socket into weapons, armour or jewellery.</small>':'';
    var sockets=Core.socketsFor(entry);
    return '<div class="cbSocketSummary"><small>'+sockets.filter(Boolean).length+' / '+sockets.length+' sockets filled'+(sockets.length?'':' · No sockets')+'</small>'+sockets.map(function(id){var rune=Core.itemById(id);return '<span class="cbSocketPip'+(rune?' filled':'')+'" title="'+esc(rune?rune.name:'Empty socket')+'">'+(rune?itemIcon(rune):'◇')+'</span>';}).join('')+'</div>';
  }
  function socketButton(entry,slot,locked) {
    return Core.socketable(Core.itemById(entry.itemId))?'<button type="button" class="btn cbSocketOpen" data-socket-item="'+esc(entry.id)+'"'+(slot?' data-socket-slot="'+esc(slot)+'"':'')+(locked?' disabled':'')+'>Socket runes</button>':'';
  }
  var socketDialog=null;
  function enemyTeam(state) {
    return '<div class="cbEnemyTeam" aria-label="Enemy team">'+Core.enemiesFor(state).map(function(enemy){
      var b=Core.bossById(enemy.bossId);
      return '<article class="cbEnemyMember'+(enemy.hp<=0?' cbEnemyFallen':'')+'" data-enemy-id="'+esc(enemy.id)+'" data-boss-id="'+esc(b.id)+'">'+enemyArt(b)+'<strong>'+esc(b.name)+'</strong><small>'+esc(b.playstyle)+' · '+(enemy.hp<=0?'DEFEATED':enemy.hp+' / '+enemy.maxHp+' HP')+'</small><div class="cbHp" role="progressbar" aria-label="'+esc(b.name)+' HP" aria-valuemin="0" aria-valuemax="'+enemy.maxHp+'" aria-valuenow="'+enemy.hp+'"><span style="width:'+Math.max(0,enemy.hp/enemy.maxHp*100)+'%"></span></div></article>';
    }).join('')+'</div>';
  }
  function heroTeam(state) {
    return '<div class="cbActiveTeam" aria-label="Active student team">'+Core.combatHeroes(state).map(function(h){
      return '<div class="cbQuickHero" data-cba-hero-id="'+esc(h.id)+'" data-cba-actor="hero">'+(root.ClassroomBattleAnimation?root.ClassroomBattleAnimation.heroMarkup(h.role,{job:h.job,gender:h.gender,dormant:h.hp<=0}):'')+'<strong>'+esc(h.name)+'</strong><small>'+h.hp+' / '+h.stats.maxHp+' HP · '+h.mp+' MP</small><div class="cbHp"><span style="width:'+Math.max(0,h.hp/h.stats.maxHp*100)+'%"></span></div></div>';
    }).join('')+'</div>';
  }
  function closeSockets() {if(socketDialog){var previous=socketDialog;socketDialog=null;previous.close();previous.remove();}}
  function openSockets(options) {
    closeSockets();
    var focus=root.document.activeElement,entryId=options.entryId,slot=options.slot,pending=null,saving=false,message='';
    var dialog=root.document.createElement('dialog');socketDialog=dialog;dialog.className='cbSocketDialog';dialog.setAttribute('aria-labelledby','cbSocketTitle');
    root.document.body.appendChild(dialog);
    function render() {
      if(socketDialog!==dialog)return;
      var hero=options.getHero(),entry=hero && (hero.inventory || []).find(function(i){return i.id===entryId && i.quantity>0;});
      // A split copy follows the selected equipment slot after a successful save.
      if(!entry && hero && slot){entryId=Core.loadoutFor(hero)[slot];entry=(hero.inventory || []).find(function(i){return i.id===entryId;});}
      var item=entry && Core.itemById(entry.itemId),locked=saving || !!pending || options.locked();
      if(!item){closeSockets();return;}
      var sockets=Core.socketsFor(entry),runes=hero.inventory.filter(function(i){return i.quantity>0 && Core.itemById(i.itemId).type==='rune';});
      dialog.innerHTML='<header><div><small>RUNE WORKSHOP</small><h2 id="cbSocketTitle">'+esc(item.name)+'</h2></div><button type="button" class="btn" data-socket-close aria-label="Close rune workshop">✕</button></header><div class="cbSocketItem">'+itemIcon(item)+'<p>'+esc(item.description)+'</p></div><p class="cbSocketHint">Runes work while this item is equipped. Removing a rune returns it to your bag. Only one copy changes when items are stacked. Main-hand runes take priority over off-hand runes.</p>'+(!sockets.length?'<p>This item has no sockets. Newly found weapons, armour and jewellery can have 0–3 sockets. Existing treasure keeps its original sockets.</p>':sockets.map(function(id,index){var rune=Core.itemById(id);return '<section class="cbSocketRow"><div class="cbSocketRune">'+(rune?itemIcon(rune):'<span class="cbEmptySocket">◇</span>')+'<div><strong>Socket '+(index+1)+' · '+esc(rune?rune.name:'Empty')+'</strong><p>'+esc(rune?rune.description:'Choose a rune from your treasure bag.')+'</p></div></div>'+(rune?'<button type="button" class="btn" data-socket-remove="'+index+'"'+(locked?' disabled':'')+'>Remove rune</button>':'<label class="cbSocketSelect">Rune<select aria-label="Rune for socket '+(index+1)+'" data-socket-choice="'+index+'"'+(locked || !runes.length?' disabled':'')+'><option value="">Choose a rune…</option>'+runes.map(function(e){var r=Core.itemById(e.itemId);return '<option value="'+esc(e.id)+'">'+esc(r.name+' · '+Core.RARITIES[r.rarity].name+' · ×'+e.quantity)+'</option>';}).join('')+'</select></label><button type="button" class="btn primary" data-socket-insert="'+index+'"'+(locked || !runes.length?' disabled':'')+'>Insert rune</button>')+'</section>';}).join(''))+(!runes.length && sockets.some(function(id){return !id;})?'<p>No loose runes in your bag. Defeat enemies to find more.</p>':'')+(options.locked()?'<p>Finish the current turn or encounter before changing sockets.</p>':'')+'<p data-socket-status role="'+(message?'alert':'status')+'">'+esc(message || (saving?'Saving rune…':''))+'</p>'+(pending && !saving?'<button type="button" class="btn" data-socket-retry>Retry saved change</button>':'');
      dialog.setAttribute('aria-busy',String(saving));
    }
    async function save(action) {
      if(saving || options.locked())return;
      pending=pending || Object.assign({id:root.crypto && root.crypto.randomUUID?root.crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),itemId:entryId},slot?{slot:slot}:{},action);
      saving=true;message='';render();
      try {
        await options.dispatch(pending);
        if(socketDialog!==dialog)return;
        var hero=options.getHero();if(slot)entryId=Core.loadoutFor(hero)[slot] || entryId;
        // Unequipped stacks split into a saved, individually runed copy too.
        else if(hero.inventory.some(function(i){return i.id==='runed:'+pending.id;}))entryId='runed:'+pending.id;
        pending=null;message='Rune change saved.';
      }catch(e){message=e.message || 'Unable to save. Retry the same change.';}
      finally{saving=false;render();}
    }
    dialog.addEventListener('click',function(event){var button=event.target.closest('button');if(!button || button.disabled)return;
      if(button.hasAttribute('data-socket-close')){closeSockets();if(focus && root.document.contains(focus))focus.focus();return;}
      if(button.hasAttribute('data-socket-retry')){save(pending);return;}
      if(pending)return;
      if(button.dataset.socketRemove!==undefined)save({command:'unsocket',socketIndex:Number(button.dataset.socketRemove)});
      if(button.dataset.socketInsert!==undefined){var index=Number(button.dataset.socketInsert),choice=dialog.querySelector('[data-socket-choice="'+index+'"]');if(!choice.value){message='Choose a rune first.';render();return;}save({command:'socket',socketIndex:index,runeId:choice.value});}
    });
    dialog.addEventListener('cancel',function(event){event.preventDefault();closeSockets();});
    render();if(socketDialog===dialog)dialog.showModal();
  }
  root.ClassroomBattleDisplay = {enemyTeam:enemyTeam,heroTeam:heroTeam,itemIcon:itemIcon,enemyArt:enemyArt,equipmentPanel:equipmentPanel,slotName:slotName,rotation:rotation,treasure:treasure,log:log,socketSummary:socketSummary,socketButton:socketButton,openSockets:openSockets,closeSockets:closeSockets};
})(typeof window !== 'undefined' ? window : globalThis);
