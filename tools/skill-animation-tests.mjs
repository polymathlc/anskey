import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),Core=require('../battle-core.js'),Content=require('../battle-content.js');
const window={ClassroomBattleCore:Core,ClassroomBattleContent:Content};
vm.runInNewContext(fs.readFileSync(new URL('../battle-animation.js',import.meta.url),'utf8'),{window});
const Animation=window.ClassroomBattleAnimation,skills=Object.values(Core.SKILLS).flat().concat(Object.values(Core.JOB_SKILLS).flat());

test('all 144 skills have distinct animation choreography beyond their names and mechanical effects',()=>{
  const signatures=new Set();
  for(const skill of skills){
    const recipe=Animation.recipeFor({role:skill.role,job:skill.job},skill);
    const {id,effect,...choreography}=recipe;
    assert.equal(id,skill.id);assert.ok(recipe.family);assert.ok(recipe.duration>=300&&recipe.duration<=1200);
    assert.ok(recipe.count>=1&&recipe.count<=4);assert.equal(recipe.passive,skill.passive);
    const key=JSON.stringify(choreography);assert.ok(!signatures.has(key),'distinct visible recipe for '+id);signatures.add(key);
  }
  assert.equal(signatures.size,144);
});
test('creature and elemental skills use their generated visual families',()=>{
  const cases={'beastmaster-wolf-pounce':'spirit-wolf','beastmaster-hawk-dive':'spirit-hawk','beastmaster-phoenix-flight':'spirit-phoenix','beastmaster-worldtree-embrace':'grove','archmage-frost-nova':'blizzard','archmage-eruption':'meteor','chronomancer-rewind-wounds':'time'};
  for(const [id,family] of Object.entries(cases)){const skill=Core.skillById(id);assert.equal(Animation.recipeFor({role:skill.role,job:skill.job},skill).family,family);}
});
test('animation recipe inspection never changes hero progress or skill mechanics',()=>{
  const hero=Core.heroFromStudent({id:'animation-read-only',name:'Hero'}),before=JSON.stringify(hero),catalog=JSON.stringify(skills);
  for(const skill of skills)Animation.recipeFor(hero,skill);
  assert.equal(JSON.stringify(hero),before);assert.equal(JSON.stringify(skills),catalog);
});
test('every advanced job selects its own generated sprite and keeps an accessible fallback',()=>{
  for(const job of Object.values(Core.JOBS)){
    const html=Animation.heroMarkup(job.role,{job:job.id,alt:job.name+' hero'});
    assert.ok(html.includes('data-cba-sheet="'+job.id+'"'));assert.ok(html.includes('data-cba-job="'+job.id+'"'));
    assert.ok(html.includes('aria-label="'+job.name+' hero"'));assert.ok(html.includes('assets/battle-pixel/'+job.role+'.png'));
  }
});
