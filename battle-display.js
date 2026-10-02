/* Shared saved treasure and combat history. Presentation never calculates combat. */
(function (root) {
  'use strict';
  var Core = root.ClassroomBattleCore;
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function itemIcon(item) {
    var art = item && item.art;
    if (!art || !/^items-[1-5]$/.test(art.sheet) || !Number.isInteger(art.col) || art.col < 0 || art.col > 4 || ![0,1].includes(art.row)) return '<span class="cbItemIcon cbItemUnknown" aria-hidden="true">◆</span>';
    return '<span class="cbItemIcon" role="img" aria-label="' + esc(item.name) + '" style="background-image:url(assets/battle-pixel/items/' + art.sheet + '.png);background-position:' + art.col*25 + '% ' + art.row*100 + '%"></span>';
  }
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
  root.ClassroomBattleDisplay = {itemIcon:itemIcon,treasure:treasure,log:log};
})(typeof window !== 'undefined' ? window : globalThis);
