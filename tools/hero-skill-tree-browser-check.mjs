// Shared component interaction and responsive layout, using the real battle rules.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const runtime = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(runtime.startsWith('file:') ? runtime : pathToFileURL(runtime).href);
const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: 1150, height: 1250 }, reducedMotion: 'reduce' });
const output = path.resolve(process.env.BATTLE_SCREENSHOTS || '../battle-validation');
fs.mkdirSync(output, { recursive: true });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/hero-skill-tree.css"><link rel="stylesheet" href="/battle-animation.css"><style>body{margin:0;padding:24px;background:#090d15}#mount{max-width:940px;margin:auto}@media(max-width:500px){body{padding:8px}}</style></head><body><main id="mount"></main><script src="/battle-bosses.js"></script><script src="/battle-content.js"></script><script src="/battle-core.js"></script><script src="/battle-animation.js"></script><script src="/hero-skill-tree.js"></script></body></html>';
await page.route('http://skill-tree.test/**', route => {
  const file = new URL(route.request().url()).pathname.slice(1);
  if (!file) return route.fulfill({ contentType: 'text/html', body: html });
  if (/^(battle-(bosses|content|core)\.js|battle-animation\.(js|css)|hero-skill-tree\.(js|css)|assets\/battle-pixel\/[a-z0-9/_.-]+\.(png|json))$/.test(file)) return route.fulfill({ path: path.resolve(file) });
  return route.fulfill({ status: 404, body: '' });
});
let checks = 0;
function check(name, ok) { assert.ok(ok, name); checks++; console.log('✓ ' + name); }
async function setup(role = 'mage', options = {}) {
  await page.evaluate(({ role, options }) => {
    window.h = { ...ClassroomBattleCore.heroFromStudent({ id: 'hero', name: 'Alex' }, null, Object.keys(ClassroomBattleCore.ROLES).indexOf(role)), ...options };
    window.calls = 0;
    window.widget = ClassroomSkillTree.render(document.getElementById('mount'), { hero: h, onLearn: async id => {
      window.calls++; await new Promise(resolve => { window.finishLearn = resolve; });
      const skill = ClassroomBattleCore.skillById(id);
      h = { ...h, learnedSkills: [...h.learnedSkills, id], skillPoints: h.skillPoints - skill.cost };
      return h;
    } });
  }, { role, options });
}
try {
  await page.goto('http://skill-tree.test/');
  await page.evaluate(()=>{window.__previews=[];window.__previewEnds=[];const preview=ClassroomBattleAnimation.previewSkill;if(preview)ClassroomBattleAnimation.previewSkill=function(container,hero,skill){const stamp=__previews.length;__previews.push({skillId:skill.id,passive:skill.passive});const player=preview.call(this,container,hero,skill);player.finished.then(result=>__previewEnds.push({stamp,...result}));return player;};});
  await setup();
  check('twelve skill buttons, three branches and all dependency edges render', await page.evaluate(() => document.querySelectorAll('[data-hst-node]').length === 12 && document.querySelectorAll('.hstBranch').length === 3 && document.querySelectorAll('.hstLink').length === 12));
  await page.click('[data-hst-node="mage-frozen-core"]');
  check('locked passive explains its level requirement and prerequisite', await page.evaluate(() => document.querySelector('[data-hst-learn]').disabled && document.querySelector('.hstDetail').textContent.includes('Ice Lance') && document.querySelector('.hstDetail').textContent.includes('Always-on passive') && document.querySelector('.hstDetail').textContent.includes('Requires level 2')));
  check('passive skills preview their own generated aura when inspected',await page.evaluate(()=>__previews.at(-1)?.skillId==='mage-frozen-core'&&__previews.at(-1)?.passive&&!!document.querySelector('.cbaSkillPreview .cbaHero')));
  const previewBefore=await page.evaluate(()=>({hero:JSON.stringify(h),count:__previews.length}));
  await page.click('[data-hst-preview]');
  check('replaying a skill preview cannot spend points or mutate the hero',await page.evaluate(before=>JSON.stringify(h)===before.hero&&calls===0&&__previews.length===before.count+1,previewBefore));
  await page.click('[data-hst-node="mage-ice-lance"]');
  check('available active skill shows MP, cooldown and SP cost', await page.evaluate(() => !document.querySelector('[data-hst-learn]').disabled && ['16 MP', '2 turn cooldown', '1 SP'].every(t => document.querySelector('.hstDetail').textContent.includes(t))));
  await page.evaluate(() => { const b = document.querySelector('[data-hst-learn]'); b.click(); b.click(); });
  check('double activation invokes only one save and disables learning during save', await page.evaluate(() => calls === 1 && document.querySelector('[data-hst-learn]').disabled && document.querySelector('[data-hst-learn]').textContent.includes('Saving')));
  await page.evaluate(() => finishLearn());
  await page.waitForFunction(() => document.querySelector('[data-hst-node="mage-ice-lance"]').dataset.state === 'learned');
  check('authoritative returned hero updates learned node, connection and point counter', await page.evaluate(() => h.skillPoints === 1 && document.querySelector('[data-to="mage-ice-lance"]').classList.contains('hstLink-learned') && document.querySelector('.hstPoints strong').textContent === '1'));
  await page.evaluate(() => widget.update({ hero: { ...h, level: 2, xp: 75, skillPoints: 2 } }));
  check('leveling makes only the next connected passive available', await page.evaluate(() => document.querySelector('[data-hst-node="mage-frozen-core"]').dataset.state === 'available' && document.querySelector('[data-hst-node="mage-glacial-ward"]').dataset.state === 'locked'));
  await page.locator('[data-hst-node="mage-ice-lance"]').focus();
  await page.keyboard.press('ArrowDown');
  check('arrow key follows the dependency branch and inspects the next skill', await page.evaluate(() => document.activeElement.dataset.hstNode === 'mage-frozen-core' && document.querySelector('.hstDetail h4').textContent === 'Frozen Core'));
  await page.keyboard.press('ArrowRight');
  check('arrow key moves between parallel branches', await page.evaluate(() => document.activeElement.dataset.hstNode === 'mage-deep-reserves'));
  await page.evaluate(() => widget.update({ locked: true }));
  check('teacher turn lock permits inspection but blocks mutation', await page.evaluate(() => document.querySelector('[data-hst-learn]').disabled && document.querySelector('.hstDetail').textContent.includes('Finish the current battle turn')));
  await page.evaluate(() => widget.update({ locked: false, onLearn: async () => { throw new Error('Save unavailable'); } }));
  await page.click('[data-hst-node="mage-frozen-core"]');
  await page.click('[data-hst-learn]');
  check('failed save explains error without marking a skill learned', await page.evaluate(() => document.querySelector('.hstError').textContent === 'Save unavailable' && document.querySelector('[data-hst-node="mage-frozen-core"]').dataset.state === 'available' && !document.querySelector('[data-hst-learn]').disabled));
  await page.click('[data-hst-zoom="in"]');
  check('zoom control enlarges the map inside its scroll container', await page.evaluate(() => parseInt(document.querySelector('.hstZoom output').textContent, 10) > 100 && document.querySelector('.hstViewport').scrollWidth > document.querySelector('.hstViewport').clientWidth));
  await page.click('[data-hst-zoom="fit"]');
  check('fit shows all four skill tiers inside the viewport', await page.evaluate(() => { const v = document.querySelector('.hstViewport'); return v.scrollHeight === v.clientHeight; }));
  await page.click('[data-hst-node="mage-meteor"]');
  await page.screenshot({ path: path.join(output, 'hero-skill-constellation-desktop.png'), fullPage: true });
  for (const role of ['warrior', 'ranger', 'cleric']) {
    await setup(role, { level: 4, xp: 450, skillPoints: 12 });
    check(role + ' changes its original sprite, skill names and branch effects', await page.evaluate(role => document.querySelector('.hstOrigin img').getAttribute('src').endsWith(role + '.png') && [...document.querySelectorAll('[data-hst-node]')].every(n => n.dataset.hstNode.startsWith(role + '-')), role));
  }
  for (const job of ['paladin','berserker','sharpshooter','beastmaster','archmage','chronomancer','hierophant','oracle']) {
    const role=await page.evaluate(id=>ClassroomBattleCore.JOBS[id].role,job);
    await setup(role,{job,level:15,xp:7500,skillPoints:30});
    check(job+' opens its advanced tree with distinct connected skills',await page.evaluate(id=>document.querySelectorAll('[data-hst-node]').length===12&&[...document.querySelectorAll('[data-hst-node]')].every(n=>ClassroomBattleCore.skillById(n.dataset.hstNode).job===id)&&document.querySelector('[data-hst-tree="job"]').getAttribute('aria-pressed')==='true',job));
    await page.click('[data-hst-tree="base"]');
    check(job+' foundation toggle keeps original class training accessible',await page.evaluate(role=>[...document.querySelectorAll('[data-hst-node]')].every(n=>n.dataset.hstNode.startsWith(role+'-'))&&document.querySelector('[data-hst-tree="base"]').getAttribute('aria-pressed')==='true',role));
    await page.click('[data-hst-tree="job"]');
  }
  await page.screenshot({path:path.join(output,'hero-advanced-oracle-tree.png'),fullPage:true});
  await page.setViewportSize({ width: 390, height: 844 });
  await setup('mage');
  check('mobile scrolls within the map without overflowing the page', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('.hstViewport').scrollWidth > document.querySelector('.hstViewport').clientWidth));
  await page.locator('[data-hst-node="mage-arcane-pulse"]').click();
  await page.locator('.hstDetailAction').scrollIntoViewIfNeeded();
  check('mobile skill description and learn button stay visible and tappable', await page.evaluate(() => { const b = document.querySelector('[data-hst-learn]').getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth && b.height >= 44 && document.querySelector('.hstDetail h4').textContent === 'Arcane Pulse'; }));
  await page.screenshot({ path: path.join(output, 'hero-skill-constellation-mobile.png'), fullPage: true });
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(() => { document.querySelector('[data-hst-preview]').click();widget.destroy(); });
  await page.waitForFunction(()=>__previewEnds.some(event=>event.stamp===__previews.length-1&&event.cancelled));
  check('destroy cancels an active generated skill preview',await page.evaluate(()=>!document.querySelector('.cbaSkillPreview.cbaPlaying')));
  const priorCalls = await page.evaluate(() => calls);
  await page.evaluate(() => document.querySelector('[data-hst-learn]').click());
  check('destroy removes handlers before a host remount', await page.evaluate(n => calls === n, priorCalls));
  assert.deepEqual(errors, []);
  console.log(`${checks} skill tree browser checks passed.`);
} finally { await browser.close(); }
