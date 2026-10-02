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


test('advanced jobs open a distinct twelve-node tree while foundation skills remain available', () => {
  for (const job of Object.values(Core.JOBS)) {
    const h = { ...hero(job.role), level: 15, xp: Core.xpForLevel(15), skillPoints: 40, job: job.id };
    const graph = Tree.model(h);
    assert.equal(graph.job.id, job.id);
    assert.equal(graph.nodes.length, 12);
    assert.equal(graph.branches.length, 3);
    assert.equal(graph.links.filter(link => link.from === 'hero').length, 3);
    assert.ok(graph.nodes.every(node => node.skill.job === job.id));
    assert.deepEqual([...new Set(graph.nodes.map(node => node.skill.level))], [15, 18, 22, 26]);
    assert.equal(graph.nodes.filter(node => node.state === 'available').length, 3);
    assert.equal(Tree.model(h, 'base').job, null);
    assert.deepEqual(Tree.model(h, 'base').nodes.map(node => node.skill.id), Core.SKILL_TREES[job.role].map(skill => skill.id));
    assert.match(Tree.graphMarkup(h), new RegExp(job.name));
    assert.ok(Tree.graphMarkup(h, '', 'base').includes('<strong>' + Core.ROLES[job.role].name + '</strong><span>CHOOSE YOUR PATH</span>'));
  }
});

test('advanced tree progression requires its own connected prerequisites', () => {
  const job = Core.JOBS.archmage, first = Core.JOB_SKILLS.archmage[0], next = Core.JOB_SKILLS.archmage[1];
  const h = { ...hero(job.role), level: 18, xp: Core.xpForLevel(18), skillPoints: 40, job: job.id };
  assert.equal(Tree.model(h).nodes.find(node => node.skill.id === next.id).state, 'locked');
  h.learnedSkills = [...h.learnedSkills, first.id];
  assert.equal(Tree.model(h).nodes.find(node => node.skill.id === next.id).state, 'available');
  assert.equal(Tree.model(h).nodes.find(node => node.skill.id === first.id).state, 'learned');
});
