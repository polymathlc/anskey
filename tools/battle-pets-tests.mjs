import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),Core=require('../battle-core.js');
const context={ClassroomBattleCore:Core};context.window=context;vm.createContext(context);
for(const file of ['battle-display.js','battle-pets.js','battle-animation.js'])vm.runInContext(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),context);
const Pets=context.ClassroomBattlePets,Animation=context.ClassroomBattleAnimation;
function hero(itemId='pet-cloud-sparrow'){return {id:'ari',name:'Ari',hp:50,inventory:[{id:'companion',itemId,quantity:1}],loadout:{pet:'companion'}};}
test('only an owned equipped pet renders',()=>{
  const h=hero();assert.equal(Pets.equipped(h).id,'pet-cloud-sparrow');
  for(const value of [{...h,loadout:{}},{...h,loadout:{pet:'missing'}},{...h,inventory:[{...h.inventory[0],quantity:0}]},{...h,inventory:[{id:'companion',itemId:'iron-band',quantity:1}]}]){
    assert.equal(Pets.equipped(value),null);assert.equal(Pets.markup(value),'');assert.equal(Pets.control(value),'');
  }
});
test('all companions have stable species choreography and existing art',()=>{
  const families=new Set();let pets=0;
  for(const item of Object.values(Core.ITEMS).filter(i=>i.type==='pet')){
    pets++;const h=hero(item.id),html=Pets.markup(h);families.add(Pets.behavior(item));
    assert.ok(html.includes('data-pet-item="'+item.id+'"'));assert.ok(html.includes(item.art.sheet+'.png'));assert.equal(html,Pets.markup(h));
  }
  assert.equal(pets,31);assert.equal(families.size,9);
  for(const id of ['pet-cloud-sparrow','pet-rune-owl','pet-sun-phoenix'])assert.equal(Pets.behavior(Core.itemById(id)),'bird');
  for(const id of ['pet-frost-kitten','pet-silver-lynx'])assert.equal(Pets.behavior(Core.itemById(id)),'walk');
});
test('rest survives redraw, stays per hero and pet, and never changes canonical data',()=>{
  const h=hero(),before=JSON.stringify(h),key='ari:pet-cloud-sparrow';Pets.toggle(key);
  assert.match(Pets.markup(h),/cbPetResting/);assert.match(Pets.control(h),/Let pet roam/);
  assert.doesNotMatch(Pets.markup({...h,id:'bo'}),/cbPetResting/);assert.doesNotMatch(Pets.markup(hero('pet-frost-kitten')),/cbPetResting/);
  assert.equal(JSON.stringify(h),before);Pets.toggle(key);assert.doesNotMatch(Pets.markup(h),/cbPetResting/);assert.match(Pets.markup({...h,hp:0}),/cbPetResting/);
});
test('pet layers preserve generated and custom hero wrappers and appearance',()=>{
  const h=hero(),html=Animation.heroMarkup('mage',{hero:h,gender:'female'});
  assert.match(html,/data-cba-gender="female"/);assert.match(html,/cbPet-bird/);assert.equal((html.match(/class="cbaHero/g)||[]).length,1);
  context.HeroAvatar={markup(){return '<span class="cbaHero cbaCustom"><svg></svg></span>';}};
  assert.match(Animation.heroMarkup('mage',{hero:h,avatar:{}}),/<svg><\/svg><span class="cbPet/);assert.doesNotMatch(Animation.heroMarkup('mage',{}),/cbPet/);
});
test('metadata is escaped and reduced motion stops every animation',()=>{
  assert.match(Pets.markup({...hero(),id:'<img onerror="bad">'}),/&lt;img/);
  assert.match(fs.readFileSync(new URL('../battle-pets.css',import.meta.url),'utf8'),/@media\(prefers-reduced-motion:reduce\)[\s\S]*animation:none!important/);
});
