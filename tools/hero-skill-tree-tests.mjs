import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Core = require('../battle-core.js');
const Tree = require('../hero-skill-tree.js');
const hero = (role, changes = {}) => ({ ...Core.heroFromStudent({ id: 'test', name: 'Hero' }, null, Object.keys(Core.ROLES).indexOf(role)), ...changes });

test('every hero class renders the real skill dependencies, including three starting paths', () => {
  for (const role of Object.keys(Core.ROLES)) {
    const graph = Tree.model(hero(role));
    assert.equal(graph.nodes.length, 12);
    assert.equal(graph.branches.length, 3);
    assert.equal(graph.links.length, 12);
    assert.equal(graph.links.filter(link => link.from === 'hero').length, 3);
    assert.deepEqual(graph.nodes.map(node => node.skill.id), Core.SKILL_TREES[role].map(skill => skill.id));
    for (const link of graph.links.filter(link => link.from !== 'hero')) {
      assert.ok(Core.skillById(link.to).requires.includes(link.from));
      assert.ok(link.y2 > link.y1, 'prerequisite is placed before its dependent skill');
    }
    assert.equal(new Set(graph.nodes.map(node => node.x + ',' + node.y)).size, 12);
    const markup = Tree.graphMarkup(hero(role));
    assert.equal((markup.match(/data-hst-node=/g) || []).length, 12);
    assert.equal((markup.match(/data-to=/g) || []).length, 12);
    assert.ok(markup.includes('assets/battle-pixel/' + role + '.png'));
  }
});

test('node availability respects learned state, level, dependencies and actual skill point cost', () => {
  const h = hero('mage');
  let graph = Tree.model(h);
  const state = id => graph.nodes.find(node => node.skill.id === id).state;
  assert.equal(state('mage-firebolt'), 'learned');
  assert.equal(state('mage-ice-lance'), 'available');
  assert.equal(state('mage-frozen-core'), 'locked');
  graph = Tree.model({ ...h, level: 4, skillPoints: 30 });
  assert.equal(state('mage-frozen-core'), 'locked', 'higher level cannot skip a prerequisite');
  graph = Tree.model({ ...h, level: 2, learnedSkills: [...h.learnedSkills, 'mage-ice-lance'] });
  assert.equal(state('mage-frozen-core'), 'available');
  graph = Tree.model({ ...h, level: 4, skillPoints: 1, learnedSkills: [...h.learnedSkills, 'mage-ice-lance', 'mage-frozen-core'] });
  assert.equal(state('mage-glacial-ward'), 'locked', 'a two-point skill needs two points');
  graph = Tree.model({ ...h, level: 4, skillPoints: 0 });
  assert.equal(state('mage-firebolt'), 'learned', 'already learned remains learned when points are spent');
  assert.equal(state('mage-ice-lance'), 'locked');
});

test('pixel icons communicate different combat effects and remain original vector artwork', () => {
  const icon = id => Tree.pixelIcon(Core.skillById(id));
  for (const role of Object.keys(Core.ROLES)) {
    assert.ok(new Set(Core.SKILL_TREES[role].map(Tree.pixelIcon)).size >= 4, role + ' has distinct effect icons');
    Core.SKILL_TREES[role].forEach(skill => {
      const svg = Tree.pixelIcon(skill);
      assert.match(svg, /shape-rendering="crispEdges"/);
      assert.match(svg, /aria-hidden="true"/);
      assert.doesNotMatch(svg, /<image|<script|https:/);
    });
  }
  assert.notEqual(icon('mage-firebolt'), icon('mage-ice-lance'));
  assert.notEqual(icon('mage-time-warp'), icon('mage-glacial-ward'));
  assert.notEqual(icon('ranger-venom-arrow'), icon('ranger-twin-arrow'));
});

test('render data never mutates the hero or skill definitions', () => {
  const h = hero('cleric'), before = JSON.stringify(h), skills = JSON.stringify(Core.SKILL_TREES);
  Tree.model(h); Tree.graphMarkup(h);
  assert.equal(JSON.stringify(h), before);
  assert.equal(JSON.stringify(Core.SKILL_TREES), skills);
});
