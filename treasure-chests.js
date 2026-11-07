/* Victory chests reveal saved rewards only. Opening never writes game state. */
(function (root) {
  'use strict';
  var memory = new Map(), PREFIX = 'polymath.treasureReveal.v1:', renderCount = 0;
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function keyFor(state) { return JSON.stringify([state.teacherId || '', state.classId || '', state.encounterId || '']); }
  function openedFor(key) {
    if (memory.has(key)) return memory.get(key);
    var ids = [];
    try { var saved = JSON.parse(root.localStorage.getItem(PREFIX + key)); if (Array.isArray(saved)) ids = saved.filter(function (id) { return typeof id === 'string'; }).slice(0, 500); } catch (_) {}
    var opened = new Set(ids); memory.set(key, opened);
    if (memory.size > 60) memory.delete(memory.keys().next().value);
    return opened;
  }
  function groupsFor(state) {
    var groups = new Map();
    (state.rewards || []).forEach(function (reward) {
      if (!groups.has(reward.heroId)) {
        var hero = (state.heroes || []).find(function (h) { return h.id === reward.heroId; });
        groups.set(reward.heroId, {id: reward.heroId, name: hero ? hero.name : 'Hero', rewards: []});
      }
      groups.get(reward.heroId).rewards.push(reward);
    });
    return Array.from(groups.values());
  }
  function render(state, rewardCard) {
    var key = keyFor(state), opened = openedFor(key), groups = groupsFor(state), renderId = ++renderCount;
    if (!groups.length) return '';
    var left = groups.filter(function (g) { return !opened.has(g.id); }).length;
    return '<section class="cbChestCollection" data-treasure-key="' + esc(key) + '" aria-label="Victory treasure chests"><div class="cbChestToolbar"><div><strong>A chest for every student</strong><p>Click a chest to reveal that student’s saved loot.</p></div><button type="button" data-treasure-action="all"' + (!left ? ' disabled' : '') + '>Open all treasure chests</button></div><p class="cbChestProgress" role="status" aria-live="polite">' + (groups.length - left) + ' / ' + groups.length + ' chests opened</p><div class="cbChestGrid">' + groups.map(function (group, index) {
      var open = opened.has(group.id), resultId = 'treasure-' + renderId + '-' + index;
      return '<article class="cbStudentChest' + (open ? ' cbChestRevealed' : '') + '" data-treasure-hero="' + esc(group.id) + '"><h4>' + esc(group.name) + '</h4><button type="button" class="cbChestButton" data-treasure-action="one" aria-expanded="' + open + '" aria-controls="' + resultId + '" aria-label="' + esc((open ? 'Treasure opened for ' : 'Open treasure chest for ') + group.name) + '"' + (open ? ' disabled' : '') + '><span class="cbTreasureSprite" aria-hidden="true"></span><span class="cbChestButtonText">' + (open ? 'Treasure opened' : 'Open chest') + '</span></button><div id="' + resultId + '" class="cbChestContents"' + (!open ? ' hidden' : '') + '>' + group.rewards.map(rewardCard).join('') + '</div></article>';
    }).join('') + '</div></section>';
  }
  function reveal(collection, all, card) {
    var key = collection.dataset.treasureKey, opened = openedFor(key);
    var cards = all ? collection.querySelectorAll('.cbStudentChest') : [card];
    Array.from(cards).forEach(function (node) { if (node) opened.add(node.dataset.treasureHero); });
    try { root.localStorage.setItem(PREFIX + key, JSON.stringify(Array.from(opened))); } catch (_) {}
    // Keep mounted views in step without replacing the arena DOM.
    root.document.querySelectorAll('.cbChestCollection').forEach(function (host) {
      if (host.dataset.treasureKey !== key) return;
      var total = 0, count = 0;
      host.querySelectorAll('.cbStudentChest').forEach(function (node) {
        total++;
        if (!opened.has(node.dataset.treasureHero)) return;
        count++;
        if (node.classList.contains('cbChestRevealed')) return;
        node.classList.add('cbChestRevealed', 'cbChestJustOpened');
        var button = node.querySelector('.cbChestButton');
        button.setAttribute('aria-expanded', 'true'); button.disabled = true;
        button.setAttribute('aria-label', 'Treasure opened for ' + node.querySelector('h4').textContent);
        node.querySelector('.cbChestButtonText').textContent = 'Treasure opened';
        node.querySelector('.cbChestContents').hidden = false;
      });
      host.querySelector('[data-treasure-action="all"]').disabled = count === total;
      host.querySelector('.cbChestProgress').textContent = count + ' / ' + total + ' chests opened';
    });
  }
  if (root.document) root.document.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('[data-treasure-action]');
    if (!button || button.disabled) return;
    var collection = button.closest('.cbChestCollection'); if (!collection) return;
    reveal(collection, button.dataset.treasureAction === 'all', button.closest('.cbStudentChest'));
  });
  root.ClassroomTreasureChests = {render: render, groupsFor: groupsFor, keyFor: keyFor};
})(typeof globalThis !== 'undefined' ? globalThis : this);
