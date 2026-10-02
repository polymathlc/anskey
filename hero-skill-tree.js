/* Shared, dependency-driven skill constellation for student heroes and the teacher journal. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./battle-core.js'));
  else root.ClassroomSkillTree = factory(root.ClassroomBattleCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';
  var WIDTH = 840, HEIGHT = 850, mounts = new WeakMap();
  var palettes = ['#f3bc73', '#9dddc8', '#c3acff'];
  var paths = {
    Vanguard: 'Guard your allies', Berserker: 'Crushing damage', Sentinel: 'Rally and endure',
    Marksman: 'Precision and criticals', Wildwood: 'Poison and restoration', Shadowstep: 'Evasion and ambush',
    Pyromancy: 'Fire and devastation', Frostcraft: 'Ice and protection', Arcanist: 'Mana and time',
    Restoration: 'Healing and revival', Radiance: 'Holy damage', Aegis: 'Shields and cleansing'
  };
  var masks = {
    sword: ['000000000011','000000000121','000000001210','000000012100','000000121000','001001210000','000112100000','000121000000','001211100000','012100100000','121000000000','010000000000'],
    arrow: ['000000222000','000000002200','011111111220','000000002200','000000222000','000000000000','000022200000','000000220000','111111122000','000000220000','000022200000','000000000000'],
    flame: ['000000100000','000001100000','000001210000','001011210000','001112211000','012112211100','012222221210','122222212210','122122112210','012111112100','001111111000','000111110000'],
    frost: ['000001100000','010001100010','001101101100','000111111000','000011110000','111111111111','111111111111','000011110000','000111111000','001101101100','010001100010','000001100000'],
    star: ['000001100000','000001100000','000011110000','001111111100','111112211111','011122221110','001122221100','000122221000','001111111100','001100001100','011000000110','000000000000'],
    cross: ['000011110000','000012210000','000012210000','000012210000','111112211111','122222222221','122222222221','111112211111','000012210000','000012210000','000012210000','000011110000'],
    shield: ['000111111000','111122221111','122222222221','122221122221','122221122221','122111111221','012221122210','012221122210','001222222100','000122221000','000012210000','000001100000'],
    heart: ['001110011100','012221122210','122222222221','122222222221','122222222221','012222222210','001222222100','000122221000','000012210000','000001100000','000000000000','000000000000'],
    eye: ['000000000000','000111111000','001222222100','012221122210','122212212221','122212212221','012221122210','001222222100','000111111000','000000000000','000000000000','000000000000'],
    poison: ['000001100000','000012210000','000122221000','001222222100','001222222100','012222222210','012212212210','122112211221','122222222221','012222222210','001111111100','000000000000'],
    clock: ['001111111100','000122221000','000122221000','000012210000','000012210000','000001100000','000001100000','000012210000','000012210000','000122221000','000122221000','001111111100'],
    wing: ['000000000001','000000000011','000000000121','000000001221','000000012210','000001122210','000012222100','000122221100','001222110100','012211011000','122101110000','111111000000'],
    book: ['011110011110','122221122221','122221122221','121121121121','122221122221','121121121121','122221122221','121121121121','122221122221','011111111110','000001100000','000000000000']
  };
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function roleKey(hero) { return hero && Core.ROLES[hero.role] ? hero.role : 'warrior'; }
  function iconType(skill) {
    var e = skill.effect || {}, p = e.passive || {}, id = skill.id || '';
    if (e.haste || /time|chron/.test(id)) return 'clock';
    if (e.shield || e.shieldSelf || p.defence) return 'shield';
    if (e.cleanse) return 'wing';
    if (e.healAll || p.healing || e.cleanse) return 'cross';
    if (e.leech || p.maxHp) return 'heart';
    if (e.manaAll || p.maxMp) return 'book';
    if (e.guaranteedCrit || p.critChance) return 'eye';
    if (skill.branch === 'Pyromancy') return 'flame';
    if (skill.branch === 'Frostcraft') return 'frost';
    if (e.poison) return 'poison';
    if (e.weakenBoss && skill.role === 'ranger') return 'wing';
    return { warrior: 'sword', ranger: 'arrow', mage: 'star', cleric: 'star' }[skill.role] || 'star';
  }
  function pixelIcon(skill) {
    var mask = masks[iconType(skill)], color = (Core.ROLES[skill.role] || Core.ROLES.mage).color;
    return '<svg class="hstPixelIcon" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">' + mask.map(function (row, y) {
      return row.split('').map(function (value, x) { return value === '0' ? '' : '<rect x="' + (x + 2) + '" y="' + (y + 2) + '" width="1" height="1" fill="' + (value === '2' ? color : '#fff1c9') + '"/>'; }).join('');
    }).join('') + '</svg>';
  }
  function model(hero) {
    var role = roleKey(hero), skills = Core.SKILL_TREES[role], branches = [];
    skills.forEach(function (s) { if (branches.indexOf(s.branch) < 0) branches.push(s.branch); });
    var learned = new Set(hero.learnedSkills || []);
    var nodes = skills.map(function (skill) {
      var branch = branches.indexOf(skill.branch), base = 190 + branch * 230, direction = branch - 1;
      var x = base + direction * (skill.tier % 2 === 0 ? 37 : 0);
      var availability = Core.canLearn(hero, skill.id);
      return { skill: skill, x: x, y: 270 + (skill.tier - 1) * 157, branch: branch,
        state: learned.has(skill.id) ? 'learned' : availability.ok ? 'available' : 'locked', reason: availability.reason };
    });
    var links = [];
    nodes.forEach(function (node) {
      (node.skill.requires.length ? node.skill.requires : ['hero']).forEach(function (id) {
        var prior = nodes.find(function (n) { return n.skill.id === id; });
        if (id !== 'hero' && !prior) return;
        links.push({ from: id, to: node.skill.id, x1: prior ? prior.x : 420, y1: prior ? prior.y : 170,
          x2: node.x, y2: node.y, state: node.state, branch: node.branch });
      });
    });
    return { role: role, branches: branches, nodes: nodes, links: links };
  }
  function graphMarkup(hero, selectedId) {
    var graph = model(hero), role = Core.ROLES[graph.role];
    var actor = typeof window !== 'undefined' && window.ClassroomBattleAnimation ? window.ClassroomBattleAnimation.heroMarkup(graph.role, { className: 'hstHero', alt: role.name + ' pixel hero' }) : '<img src="assets/battle-pixel/' + graph.role + '.png" alt="" loading="lazy"/>';
    var connectors = graph.links.map(function (link) {
      var middle = link.from === 'hero' ? 180 : link.y1 + (link.y2 - link.y1) * .52;
      var d = 'M ' + link.x1 + ' ' + link.y1 + ' L ' + link.x1 + ' ' + middle + ' L ' + link.x2 + ' ' + middle + ' L ' + link.x2 + ' ' + link.y2;
      return '<g class="hstLink hstLink-' + link.state + '" data-from="' + esc(link.from) + '" data-to="' + esc(link.to) + '" style="--hst-branch:' + palettes[link.branch % 3] + '"><path class="hstLinkShadow" d="' + d + '"/><path class="hstLinkStroke" d="' + d + '"/><rect x="' + (link.x2 - 3) + '" y="' + (middle - 3) + '" width="6" height="6"/></g>';
    }).join('');
    return '<div class="hstMap" style="width:' + WIDTH + 'px;height:' + HEIGHT + 'px"><svg class="hstConnections" viewBox="0 0 ' + WIDTH + ' ' + HEIGHT + '" aria-hidden="true"><path class="hstRune" d="M420 0L825 400L420 800L15 400Z M420 48L777 400L420 752L63 400Z M420 0V810"/>' + connectors + '</svg>' +
      '<div class="hstOrigin"><div class="hstOriginFrame">' + actor + '</div><strong>' + esc(role.name) + '</strong><span>CHOOSE YOUR PATH</span></div>' +
      graph.branches.map(function (branch, index) { return '<div class="hstBranch" style="left:' + (190 + index * 230) + 'px;--hst-branch:' + palettes[index % 3] + '"><strong>' + esc(branch) + '</strong><span>' + esc(paths[branch] || 'Explore this path') + '</span></div>'; }).join('') +
      graph.nodes.map(function (node) {
        var s = node.skill;
        return '<button type="button" class="hstNode hstNode-' + node.state + (s.passive ? ' hstNode-passive' : '') + (s.tier === 4 ? ' hstNode-capstone' : '') + '" data-hst-node="' + esc(s.id) + '" data-state="' + node.state + '" aria-pressed="' + (selectedId === s.id) + '" aria-label="' + esc(s.name + ', ' + (s.passive ? 'passive' : 'active') + ', ' + node.state + ', level ' + s.level + ', ' + s.cost + ' skill points. ' + (node.state === 'locked' ? node.reason : 'Select for details.')) + '" style="left:' + node.x + 'px;top:' + node.y + 'px;--hst-branch:' + palettes[node.branch % 3] + '"><span class="hstNodeFrame">' + pixelIcon(s) + '<span class="hstNodeMark" aria-hidden="true">' + (node.state === 'learned' ? '✓' : node.state === 'available' ? '+' : '•') + '</span></span><strong class="hstNodeName">' + esc(s.name) + '</strong><span class="hstNodeMeta">' + (node.state === 'learned' ? 'LEARNED' : 'LV ' + s.level + ' · ' + s.cost + ' SP') + (s.passive ? ' · PASSIVE' : '') + '</span></button>';
      }).join('') + '</div>';
  }
  function render(container, options) {
    if (!container || typeof container.addEventListener !== 'function') throw new Error('A skill tree container is required.');
    if (mounts.has(container)) mounts.get(container).destroy();
    var settings = Object.assign({}, options), selected = '', zoom = 1, pending = false, disposed = false, error = '', drawnRole = '', hasZoomed = false;
    var observer;
    container.innerHTML = '<section class="hst" aria-label="Hero skill tree"><header class="hstHeader"><div><span class="hstEyebrow">THE PATH YOU FORGE</span><h3>Skill constellation</h3><p class="hstProgress"></p></div><div class="hstPoints" aria-label="Available skill points"></div></header><div class="hstToolbar"><p>Follow the connected paths. Select a skill to explore its power.</p><div class="hstZoom" role="group" aria-label="Skill tree zoom"><button type="button" data-hst-zoom="out" aria-label="Zoom out">−</button><output aria-label="Zoom level">100%</output><button type="button" data-hst-zoom="in" aria-label="Zoom in">+</button><button type="button" data-hst-zoom="fit">Fit</button></div></div><div class="hstViewport" tabindex="0" role="region" aria-label="Skill map. Scroll to explore; use arrow keys between focused skills."><div class="hstMapSpace"></div></div><div class="hstLegend"><span class="hstLegendLearned">Learned</span><span class="hstLegendAvailable">Ready to learn</span><span class="hstLegendLocked">Locked</span><span>◇ Passive · ◆ Active</span></div><div class="hstDetail" aria-live="polite"></div><p class="hstError" role="alert" hidden></p></section>';
    var tree = container.querySelector('.hst'), viewport = tree.querySelector('.hstViewport'), space = tree.querySelector('.hstMapSpace'), detail = tree.querySelector('.hstDetail');
    function hero() { return settings.hero; }
    function currentSkill() { return Core.SKILL_TREES[roleKey(hero())].find(function (s) { return s.id === selected; }); }
    function showDetail() {
      var h = hero(), skill = currentSkill();
      if (!skill) return;
      var known = (h.learnedSkills || []).includes(skill.id), eligibility = Core.canLearn(h, skill.id), locked = settings.locked || pending || known || !eligibility.ok || typeof settings.onLearn !== 'function';
      var reason = known ? 'This skill is part of your hero’s training.' : settings.locked ? settings.lockedReason || 'Finish the current battle turn before changing your skills.' : eligibility.reason;
      detail.innerHTML = '<div class="hstDetailIcon">' + pixelIcon(skill) + '</div><div class="hstDetailCopy"><span class="hstEyebrow">' + esc(skill.branch) + ' / TIER ' + skill.tier + (skill.tier === 4 ? ' / CAPSTONE' : '') + '</span><h4>' + esc(skill.name) + '</h4><p>' + esc(skill.description) + '</p><div class="hstFacts"><span>' + (skill.passive ? 'Always-on passive' : 'Active skill') + '</span><span>Level ' + skill.level + '</span><span>' + skill.cost + ' SP</span>' + (!skill.passive ? '<span>' + skill.mpCost + ' MP</span><span>' + skill.cooldown + ' turn cooldown</span>' : '') + '</div><p class="hstPrerequisite">' + (skill.requires.length ? 'Requires: ' + skill.requires.map(function (id) { return esc(Core.skillById(id).name); }).join(' + ') : 'Branch starting skill · no prerequisite') + '</p></div><div class="hstDetailAction"><button type="button" data-hst-learn="' + esc(skill.id) + '"' + (locked ? ' disabled' : '') + '>' + (pending ? 'Saving…' : known ? '✓ Learned' : 'Learn · ' + skill.cost + ' SP') + '</button><p>' + esc(reason || 'Unlock this skill permanently for your hero class.') + '</p></div>';
      tree.querySelectorAll('[data-hst-node]').forEach(function (node) { node.setAttribute('aria-pressed', String(node.dataset.hstNode === selected)); });
      var alert = tree.querySelector('.hstError'); alert.textContent = error; alert.hidden = !error;
    }
    function applyZoom(center) {
      var oldWidth = parseFloat(space.style.width) || WIDTH, ratio = (viewport.scrollLeft + viewport.clientWidth / 2) / oldWidth;
      space.style.width = WIDTH * zoom + 'px'; space.style.height = HEIGHT * zoom + 'px';
      var map = space.querySelector('.hstMap'); if (map) map.style.transform = 'scale(' + zoom + ')';
      tree.querySelector('.hstZoom output').textContent = Math.round(zoom * 100) + '%';
      if (center) viewport.scrollLeft = Math.max(0, WIDTH * zoom / 2 - viewport.clientWidth / 2);
      else viewport.scrollLeft = Math.max(0, ratio * WIDTH * zoom - viewport.clientWidth / 2);
      tree.querySelector('[data-hst-zoom="out"]').disabled = zoom <= .5;
      tree.querySelector('[data-hst-zoom="in"]').disabled = zoom >= 1.4;
    }
    function fit() { zoom = Math.max(.5, Math.min(1, (viewport.clientWidth - 16) / WIDTH, (viewport.clientHeight - 16) / HEIGHT)); applyZoom(true); viewport.scrollTop = 0; }
    function draw() {
      if (disposed || !hero()) return;
      var h = hero(), role = roleKey(h), fresh = drawnRole !== role;
      if (!currentSkill()) selected = Core.SKILL_TREES[role][0].id;
      var level = h.level || 1, next = level < 50 ? Core.xpForLevel(level + 1) : null;
      tree.querySelector('.hstProgress').textContent = 'LEVEL ' + level + ' · ' + (h.xp || 0) + ' XP' + (next ? ' · ' + Math.max(0, next - (h.xp || 0)) + ' XP to level ' + (level + 1) : ' · Maximum level');
      tree.querySelector('.hstPoints').innerHTML = '<strong>' + (Number(h.skillPoints) || 0) + '</strong><span>SKILL POINTS</span>';
      var focused = tree.ownerDocument.activeElement, focusId = focused && focused.dataset && focused.dataset.hstNode;
      space.innerHTML = graphMarkup(h, selected); drawnRole = role;
      if (typeof window !== 'undefined' && window.ClassroomBattleAnimation) window.ClassroomBattleAnimation.mount(space);
      if (!hasZoomed && fresh) zoom = Math.max(.78, Math.min(1, (viewport.clientWidth - 16) / WIDTH));
      applyZoom(fresh); showDetail();
      if (focusId) { var focus = Array.from(tree.querySelectorAll('[data-hst-node]')).find(function (node) { return node.dataset.hstNode === focusId; }); if (focus) focus.focus({ preventScroll: true }); }
    }
    async function click(event) {
      var node = event.target.closest('[data-hst-node]'), learn = event.target.closest('[data-hst-learn]'), zoomControl = event.target.closest('[data-hst-zoom]');
      if (node && tree.contains(node)) { selected = node.dataset.hstNode; error = ''; showDetail(); return; }
      if (zoomControl && tree.contains(zoomControl)) { hasZoomed = true; if (zoomControl.dataset.hstZoom === 'fit') fit(); else { zoom = Math.max(.5, Math.min(1.4, Math.round((zoom + (zoomControl.dataset.hstZoom === 'in' ? .15 : -.15)) * 100) / 100)); applyZoom(); } return; }
      if (!learn || !tree.contains(learn) || pending || settings.locked || learn.disabled || typeof settings.onLearn !== 'function') return;
      var skillId = learn.dataset.hstLearn;
      if (!Core.canLearn(hero(), skillId).ok) return;
      pending = true; error = ''; showDetail();
      try {
        var updated = await settings.onLearn(skillId);
        if (updated && updated.role && updated.learnedSkills) settings.hero = updated;
      } catch (e) { error = e && e.message || 'Could not save this skill. Please try again.'; }
      finally { pending = false; if (!disposed) draw(); }
    }
    function keydown(event) {
      var source = event.target.closest('[data-hst-node]');
      if (!source || !tree.contains(source) || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      var graph = model(hero()), current = graph.nodes.find(function (n) { return n.skill.id === source.dataset.hstNode; }), target;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') target = graph.nodes.find(function (n) { return n.branch === current.branch + (event.key === 'ArrowLeft' ? -1 : 1) && n.skill.tier === current.skill.tier; });
      else target = graph.nodes.find(function (n) { return n.branch === current.branch && n.skill.tier === current.skill.tier + (event.key === 'ArrowUp' ? -1 : 1); });
      event.preventDefault();
      if (target) { selected = target.skill.id; showDetail(); var button = Array.from(tree.querySelectorAll('[data-hst-node]')).find(function (n) { return n.dataset.hstNode === selected; }); button.focus({ preventScroll: true }); button.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    }
    container.addEventListener('click', click); container.addEventListener('keydown', keydown);
    var api = { update: function (next) { settings = Object.assign({}, settings, next); draw(); }, destroy: function () { disposed = true; if (observer) observer.disconnect(); container.removeEventListener('click', click); container.removeEventListener('keydown', keydown); mounts.delete(container); } };
    mounts.set(container, api); draw();
    var ViewResizeObserver = tree.ownerDocument.defaultView && tree.ownerDocument.defaultView.ResizeObserver;
    if (ViewResizeObserver) { observer = new ViewResizeObserver(function () { if (!hasZoomed) { zoom = Math.max(.78, Math.min(1, (viewport.clientWidth - 16) / WIDTH)); applyZoom(true); } }); observer.observe(viewport); }
    return api;
  }
  return { render: render, model: model, graphMarkup: graphMarkup, pixelIcon: pixelIcon };
});
