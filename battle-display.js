/* Shared saved treasure and combat history. Presentation never calculates combat. */
(function (root) {
  'use strict';
  var Core = root.ClassroomBattleCore;
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function itemIcon(item) {
    var art = item && item.art;
    var columns = art && art.columns != null ? art.columns : 5, rows = art && art.rows != null ? art.rows : 2;
    if (!art || !/^(items-[1-5]|gear-[a-z0-9]+|pets|pets-[a-z0-9-]+|pet-[a-z0-9-]+)$/.test(art.sheet) || !validTile(art,columns,rows)) return '<span class="cbItemIcon cbItemUnknown" aria-hidden="true">◆</span>';
    return '<span class="cbItemIcon" role="img" aria-label="' + esc(item.name) + '" style="background-image:url(assets/battle-pixel/items/' + art.sheet + '.png);background-size:' + columns*100 + '% ' + rows*100 + '%;background-position:' + position(art.col,columns) + '% ' + position(art.row,rows) + '%"></span>';
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
      return '<article class="cbGearSlot cbRarity-' + esc(item ? item.rarity : 'common') + '" data-equipment-slot="' + key + '"><h5>' + esc(definition.name) + '</h5><div class="cbGearCurrent">' + (item ? itemIcon(item) : '<span class="cbEmptySlot" aria-hidden="true">' + esc(definition.icon || '◇') + '</span>') + '<div><strong>' + esc(item ? item.name : 'Empty slot') + '</strong><small>' + esc(item ? (Core.RARITIES[item.rarity] || {}).name || item.rarity : key==='pet' ? 'Choose a companion' : 'Find gear in treasure') + '</small></div></div><label class="cbGearChoice"><span class="cbVisuallyHidden">Change ' + esc(definition.name) + '</span><select data-' + prefix + '-loadout-slot="' + key + '" aria-label="Change ' + esc(definition.name) + '"' + (options.locked || !candidates.length ? ' disabled' : '') + '><option value="">' + (item ? 'Change equipment…' : 'Choose equipment…') + '</option>' + candidates.map(function(candidate){var value=Core.itemById(candidate.itemId);return '<option value="' + esc(candidate.id) + '"' + (entry && candidate.id===entry.id ? ' selected' : '') + '>' + esc(value.name + ' · ' + ((Core.RARITIES[value.rarity] || {}).name || value.rarity)) + '</option>';}).join('') + '</select></label>' + (item ? '<button type="button" class="cbGearRemove" data-' + prefix + '-remove-slot="' + key + '" aria-label="Remove ' + esc(definition.name) + '"' + (options.locked ? ' disabled' : '') + '>Remove</button>' : '') + '</article>';
    }
    return '<section class="cbEquipment" aria-label="Character equipment and pet"><div class="cbEquipmentHeading"><div><span class="cbEyebrow">CHARACTER EQUIPMENT</span><h3>Equipment & companion</h3></div><span>' + Object.keys(loadout).filter(function(key){return !!loadout[key];}).length + ' / ' + slots().length + ' slots</span></div><p class="cbEquipmentHint">Wear one item in each slot. Their bonuses work together. Treasure automatically upgrades each slot by rarity.</p><div class="cbLoadout"><div class="cbLoadoutLeft">' + ['helm','torso','gloves','legs','boots'].map(slot).join('') + '</div><div class="cbLoadoutPortrait">' + (options.portrait || '') + '<strong>' + esc(hero.name) + '</strong><span>LEVEL ' + Number(hero.level || 1) + '</span></div><div class="cbLoadoutRight">' + ['amulet','ring1','ring2','pet'].map(slot).join('') + '</div><div class="cbLoadoutWeapons">' + ['mainHand','offHand'].map(slot).join('') + '</div></div></section>';
  }
  function rotation(state) { var pool=Core.BOSSES.filter(function(b){return !b.legacy;}), progress=state && state.bossRotation;return 'Boss round ' + (progress && progress.round || 1) + ' · ' + (progress && progress.seen ? progress.seen.length : 0) + '/' + pool.length + ' encountered'; }
  function treasure(state) {
    return '<div class="cbRewardGrid" aria-label="Treasure received by every student">' + (state.rewards || []).map(function (reward) {
      var hero = (state.heroes || []).find(function (h) { return h.id === reward.heroId; }), item = Core.itemById(reward.itemId);
      return '<article class="cbReward cbRarity-' + esc(reward.rarity) + '">' + itemIcon(item) + '<strong>' + esc(hero ? hero.name : 'Hero') + '</strong><span>' + esc(reward.name) + '</span><small>' + esc(reward.rarity).toUpperCase() + ' · +' + Number(reward.xp || 0) + ' XP</small><p>' + esc(reward.description || item && item.description) + '</p>' + (reward.autoEquippedName ? '<small class="cbEquippedNote">Auto-equipped: ' + esc(reward.autoEquippedName) + '</small>' : '') + '</article>';
    }).join('') + '</div>';
  }
  function log(state) {
    var rows = state && state.combatLog || [];
    if (!rows.length) return '<section class="cbDamageLog" aria-label="Damage log"><h4>Damage log</h4><p>Saved attacks, healing and enemy replies appear here.</p></section>';
    function effects(row) {
      var parts=[];
      (row.targets || []).forEach(function (r) { parts.push(esc(r.name || 'Hero') + ' −' + Number(r.damage || 0) + ' HP' + (r.absorbed ? ' · ' + Number(r.absorbed) + ' blocked' : '')); });
      (row.healed || []).forEach(function (r) { parts.push(esc(r.name || 'Hero') + ' +' + Number(r.amount || 0) + ' HP'); });
      (row.supported || []).forEach(function (r) { parts.push(esc(r.name || 'Hero') + ' · ' + esc(r.effect) + ' +' + Number(r.amount || 0)); });
      (row.afflicted || []).forEach(function (r) { parts.push(esc(r.effect) + ' ' + Number(r.amount || 0)); });
      if (row.poisonDamage) parts.push('Poison: −' + Number(row.poisonDamage) + ' enemy HP');
      if (row.bossHealed) parts.push('Enemy +' + Number(row.bossHealed) + ' HP');
      return parts.length ? '<small>' + parts.join(' · ') + '</small>' : '';
    }
    return '<section class="cbDamageLog" aria-label="Damage log"><h4>Damage log <small>Latest ' + rows.length + ' saved turns</small></h4><ol>' + rows.slice().reverse().map(function (row) {
      var outcome = row.outcome === 'incorrect' ? 'Incorrect answer · no attack' : row.outcome === 'skip' ? 'Question skipped · no attack' : esc(row.move || 'Attack') + (row.points ? ' · +' + Number(row.points) + ' points' : '') + (row.damage ? ' → ' + esc(row.enemyName || 'Enemy') + ' −' + Number(row.damage) + ' HP' : '') + (row.critical ? ' · CRITICAL' : '');
      return '<li data-combat-id="' + esc(row.id) + '"><strong>' + esc(row.actorName || 'Hero') + '</strong><span>' + outcome + '</span>' + effects(row) + (row.enemy ? '<div class="cbLogEnemy"><b>' + esc(row.enemy.actorName || row.enemyName || 'Enemy') + '</b> · ' + esc(row.enemy.move) + effects(row.enemy) + '</div>' : '') + '</li>';
    }).join('') + '</ol></section>';
  }
  root.ClassroomBattleDisplay = {itemIcon:itemIcon,enemyArt:enemyArt,equipmentPanel:equipmentPanel,slotName:slotName,rotation:rotation,treasure:treasure,log:log};
})(typeof window !== 'undefined' ? window : globalThis);
