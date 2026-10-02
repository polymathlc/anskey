/* Presentation only: generated sprite frames play after a saved battle event. */
(function () {
  'use strict';
  var root = 'assets/battle-pixel/', sheets = root + 'animations/';
  var roles = ['warrior', 'ranger', 'mage', 'cleric'], effects = ['slash', 'fire', 'ice', 'lightning', 'arrow', 'heal'];
  var images = new Map(), players = new WeakMap();
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
    options = options || {}; role = roleName(role);
    return '<span class="cbaHero ' + esc(options.className || 'cbAvatar') + (options.dormant ? ' cbaDormant' : '') + '" data-cba-role="' + role + '" role="img" aria-label="' + esc(options.alt || role.charAt(0).toUpperCase() + role.slice(1) + ' pixel hero') + '"><img class="cbaFallback" src="' + root + role + '.png" alt="" aria-hidden="true"><span class="cbaFrames" aria-hidden="true"></span></span>';
  }
  function mount(container) {
    if (!container) return;
    var nodes = Array.from(container.querySelectorAll('.cbaHero'));
    if (container.matches && container.matches('.cbaHero')) nodes.unshift(container);
    nodes.forEach(function (node, index) {
      if (node.dataset.cbaMounted) return;
      node.dataset.cbaMounted = 'true';
      var role = roleName(node.dataset.cbaRole);
      node.querySelector('.cbaFrames').style.backgroundImage = 'url("' + sheets + role + '-sheet.png")';
      node.querySelector('.cbaFrames').style.setProperty('--cba-phase', (-index * .23) + 's');
      load(role).then(function (ok) {
        if (node.isConnected) node.classList.toggle('cbaReady', ok);
      });
    });
  }
  function prepare() { return Promise.all(roles.concat(effects).map(load)); }
  function effectFor(hero, event) {
    var role = roleName(hero && hero.role), skill = window.ClassroomBattleCore && ClassroomBattleCore.skillById(event.skillId);
    if (event.itemId === 'fire-flask' || event.itemId === 'starbomb') return 'fire';
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
    var heroActor = container.querySelector('[data-cba-actor="hero"]'), enemyActor = container.querySelector('[data-cba-actor="enemy"]');
    var sprite = heroActor && heroActor.querySelector('.cbaHero');
    var fx = effectFor(hero, event), media = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
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
      if (sprite) sprite.classList.remove('cbaActing');
      container.classList.remove('cbaPlaying'); delete container.dataset.cbaPhase;
      if (media && media.removeEventListener) media.removeEventListener('change', motionChanged);
      if (players.get(container) === player) players.delete(container);
      resolveFinished({ cancelled: !!cancelled });
    }
    function motionChanged() { if (reduced()) finish(false); }
    function later(fn, time) { var id = setTimeout(function () { timers.delete(id); if (!done && container.isConnected) fn(); else finish(true); }, time); timers.add(id); }
    function animate(node, frames, duration) { if (node && node.animate && !reduced()) motions.push(node.animate(frames, { duration: duration, easing: 'steps(4,end)' })); }
    function findHero(id) {
      return Array.from(container.querySelectorAll('[data-cba-hero-id]')).find(function (node) { return node.dataset.cbaHeroId === id; });
    }
    function effect(name, target, label, travelling) {
      if (!target) return;
      var node = document.createElement('span'); node.className = 'cbaEffect cbaFx-' + name;
      node.style.backgroundImage = 'url("' + sheets + name + '-sheet.png")'; node.setAttribute('aria-hidden', 'true');
      target.appendChild(node); created.push(node);
      load(name).then(function (ok) { if (!ok) node.hidden = true; });
      if (travelling && heroActor && enemyActor) {
        var a = heroActor.getBoundingClientRect(), b = enemyActor.getBoundingClientRect();
        animate(node, [{ transform: 'translate(' + (a.left - b.left) + 'px, 0)', opacity: 1 }, { transform: 'translate(0, 0)', opacity: 1 }], 420);
      }
      if (label) {
        var number = document.createElement('b'); number.className = 'cbaNumber' + (name === 'heal' ? ' cbaHealing' : '');
        number.textContent = label; number.setAttribute('aria-hidden', 'true'); target.appendChild(number); created.push(number);
      }
      later(function () { node.remove(); }, 700);
    }
    var player = { finished: finished, cancel: function () { finish(true); } };
    players.set(container, player);
    if (reduced() || !hero || !event || event.type !== 'auto') { finish(false); return player; }
    if (media && media.addEventListener) media.addEventListener('change', motionChanged);
    container.classList.add('cbaPlaying');
    stage('windup', hero.name + ' uses ' + (event.move || 'Attack') + '…');
    if (sprite) sprite.classList.add('cbaActing');
    animate(sprite, roleName(hero.role) === 'warrior' ? [{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(20px)' }, { transform: 'translateX(0)' }] : [{ transform: 'translateY(0)' }, { transform: 'translateY(-5px)' }, { transform: 'translateY(0)' }], 750);
    later(function () {
      stage('hero-impact', hero.name + ': ' + (event.move || 'Attack') + (event.damage ? ' · ' + event.damage + ' damage' : ''));
      if (event.damage > 0) { effect(fx, enemyActor, '−' + event.damage, fx === 'arrow'); animate(enemyActor && enemyActor.querySelector('img'), [{ filter: 'brightness(1)' }, { filter: 'brightness(2)' }, { filter: 'brightness(1)' }], 420); }
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
        if (entry.amount > 0) effect('heal', findHero(entry.heroId), '+' + entry.amount, false);
      });
    }, 330);
    later(function () { if (sprite) sprite.classList.remove('cbaActing'); }, 780);
    if (event.enemy) {
      later(function () {
        stage('enemy-windup', 'Enemy uses ' + event.enemy.move + '…');
        animate(enemyActor && enemyActor.querySelector('img'), [{ transform: 'translateX(0)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-16px)' }, { transform: 'translateX(0)' }], 560);
      }, 1050);
      later(function () {
        var targets = event.enemy.targets || [];
        stage('enemy-impact', 'Enemy: ' + event.enemy.move + ' · ' + targets.reduce(function (sum, target) { return sum + target.damage; }, 0) + ' damage');
        targets.forEach(function (target) { if (target.damage > 0) effect('slash', findHero(target.heroId), '−' + target.damage, false); });
        (event.enemy.healed || []).forEach(function (entry) { if (entry.amount > 0) effect('heal', findHero(entry.heroId), '+' + entry.amount, false); });
      }, 1310);
    }
    later(function () { finish(false); }, event.enemy ? 2050 : 1120);
    return player;
  }
  window.ClassroomBattleAnimation = { heroMarkup: heroMarkup, mount: mount, unmount: unmount, prepare: prepare, playDuel: playDuel, effectFor: effectFor, reducedMotion: reduced };
})();
