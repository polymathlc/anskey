import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),Core=require('../battle-core.js');
function fixture(storage=new Map(),document) {
  const context={document,ClassroomBattleCore:Core,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}};
  vm.createContext(context);
  for(const name of ['treasure-chests.js','battle-display.js'])vm.runInContext(fs.readFileSync(new URL('../'+name,import.meta.url),'utf8'),context);
  return context;
}
function victory() {
  const heroes=[{id:'one',name:'<Ari>'},{id:'two',name:'Bo'}],item=Object.values(Core.ITEMS)[0];
  return {teacherId:'teacher',classId:'Lesson',encounterId:'victory-1',heroes,status:'victory',rewards:[
    {heroId:'one',itemId:item.id,name:item.name,rarity:item.rarity,xp:45},
    {heroId:'two',itemId:item.id,name:item.name,rarity:item.rarity,xp:45},
    {heroId:'one',itemId:item.id,name:item.name,rarity:item.rarity,xp:0,source:'bonus-rune'}
  ]};
}
test('ordinary and bonus drops form one closed chest per student without mutating saved loot',()=>{
  const context=fixture(),state=victory(),before=JSON.stringify(state),html=context.ClassroomBattleDisplay.treasure(state);
  assert.equal((html.match(/class="cbStudentChest"/g)||[]).length,2);
  assert.equal((html.match(/class="cbChestContents" hidden/g)||[]).length,2);
  assert.equal((html.match(/class="cbReward cbRarity-/g)||[]).length,3);
  assert.match(html,/Open all treasure chests/);assert.match(html,/&lt;Ari&gt;/);
  assert.equal(JSON.stringify(state),before);
});
test('opened chests survive a fresh module and are isolated by teacher, lesson and encounter',()=>{
  const storage=new Map(),state=victory(),context=fixture(storage);
  storage.set('polymath.treasureReveal.v1:'+context.ClassroomTreasureChests.keyFor(state),JSON.stringify(['one']));
  const html=fixture(storage).ClassroomBattleDisplay.treasure(state);
  assert.equal((html.match(/cbChestRevealed/g)||[]).length,1);assert.match(html,/1 \/ 2 chests opened/);
  for(const change of [{teacherId:'different'},{classId:'different'},{encounterId:'next'}])
    assert.ok(!fixture(storage).ClassroomBattleDisplay.treasure({...state,...change}).includes('cbChestRevealed'));
});
test('denied or corrupted browser storage leaves usable closed chests',()=>{
  for(const raw of ['{broken','{}','null']) {
    const state=victory(),storage=new Map(),context=fixture(storage);
    storage.set('polymath.treasureReveal.v1:'+context.ClassroomTreasureChests.keyFor(state),raw);
    assert.match(context.ClassroomBattleDisplay.treasure(state),/0 \/ 2 chests opened/);
  }
  const context=fixture();context.localStorage.getItem=()=>{throw Error('blocked');};
  assert.match(context.ClassroomBattleDisplay.treasure(victory()),/0 \/ 2 chests opened/);
});
test('multiple mounted views have unique controls IDs and empty rewards show no opener',()=>{
  const context=fixture(),state=victory(),html=context.ClassroomBattleDisplay.treasure(state)+context.ClassroomBattleDisplay.treasure(state);
  const ids=Array.from(html.matchAll(/aria-controls="([^"]+)"/g),m=>m[1]);assert.equal(new Set(ids).size,ids.length);
  assert.equal(context.ClassroomBattleDisplay.treasure({...state,rewards:[]}), '');
});

test('click reveals one student, open all reveals the rest, and neither grants rewards',()=>{
  const storage=new Map(),state=victory(),before=JSON.stringify(state),key=JSON.stringify([state.teacherId,state.classId,state.encounterId]);
  let click;
  const progress={textContent:''},all={disabled:false,dataset:{treasureAction:'all'}};
  const cards=state.heroes.map(hero=>{
    const classes=new Set(),content={hidden:true},label={textContent:'Open chest'},heading={textContent:hero.name};
    const card={dataset:{treasureHero:hero.id},classList:{contains:c=>classes.has(c),add:(...c)=>c.forEach(v=>classes.add(v))}};
    const button={disabled:false,dataset:{treasureAction:'one'},setAttribute(k,v){this[k]=v;},closest:s=>s==='.cbStudentChest'?card:collection};
    card.button=button;card.content=content;
    card.querySelector=s=>s==='.cbChestButton'?button:s==='h4'?heading:s==='.cbChestButtonText'?label:content;
    return card;
  });
  const collection={dataset:{treasureKey:key},querySelectorAll:()=>cards,querySelector:s=>s.includes('all')?all:progress};
  all.closest=()=>collection;
  const document={addEventListener:(type,fn)=>{click=fn;},querySelectorAll:()=>[collection]};
  const context=fixture(storage,document);
  const press=button=>click({target:{closest:()=>button}});
  press(cards[0].button);
  assert.equal(cards[0].content.hidden,false);assert.equal(cards[1].content.hidden,true);
  assert.equal(cards[0].button['aria-expanded'],'true');assert.equal(progress.textContent,'1 / 2 chests opened');
  press(all);
  assert.ok(cards.every(c=>!c.content.hidden));assert.equal(all.disabled,true);assert.equal(progress.textContent,'2 / 2 chests opened');
  press(cards[0].button);
  assert.equal(JSON.stringify(state),before);
  const restored=fixture(storage).ClassroomBattleDisplay.treasure(state);
  assert.equal((restored.match(/cbChestRevealed/g)||[]).length,2);
});
