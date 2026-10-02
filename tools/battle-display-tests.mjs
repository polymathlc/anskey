import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),Core=require('../battle-core.js');
const context={ClassroomBattleCore:Core};vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../battle-display.js',import.meta.url),'utf8'),context);
const display=context.ClassroomBattleDisplay;
test('treasure grids show every recipient, matching generated item icon, stats and equipment note',()=>{
  const item=Object.values(Core.ITEMS).find(item=>item.art&&item.rarity==='mythical'),hero={id:'one',name:'<Ari>'};
  const state={heroes:[hero],rewards:[{heroId:'one',itemId:item.id,name:item.name,rarity:item.rarity,xp:45,description:item.description,autoEquippedName:item.name}]};
  const html=display.treasure(state);
  assert.match(html,/cbRewardGrid/);assert.match(html,/&lt;Ari&gt;/);assert.match(html,new RegExp(item.art.sheet+'\\.png'));assert.ok(html.includes(item.description.replace(/&/g,'&amp;')));assert.match(html,/Auto-equipped:/);assert.match(html,/MYTHICAL · \+45 XP/);
});
test('saved combat log displays actual damage, enemy replies and support amounts without mutating state',()=>{
  const state={combatLog:[{id:'hit-1',actorName:'<Mage>',enemyName:'Goblin',move:'Firebolt',damage:17,points:2,critical:true,healed:[{name:'Ari',amount:8}],supported:[{name:'Bo',effect:'shield',amount:6}],enemy:{actorName:'Goblin',move:'Jab',targets:[{name:'Ari',damage:3,absorbed:4}]}}]};
  const before=JSON.stringify(state),html=display.log(state);
  for(const text of ['&lt;Mage&gt;','−17 HP','+2 points','CRITICAL','Ari +8 HP','shield +6','−3 HP','4 blocked'])assert.ok(html.includes(text),text);
  assert.equal(JSON.stringify(state),before);
});
test('damage history shows newest first, escapes saved text and explains incorrect answers',()=>{
  const html=display.log({combatLog:[{id:'older',actorName:'Ari',move:'<img onerror=bad>',damage:2},{id:'newer',actorName:'Bo',outcome:'incorrect'}]});
  assert.ok(html.indexOf('data-combat-id="newer"')<html.indexOf('data-combat-id="older"'));assert.match(html,/Incorrect answer · no attack/);assert.match(html,/&lt;img onerror=bad&gt;/);assert.ok(!html.includes('<img'));
});
test('icon metadata cannot inject a URL or CSS outside the shipped atlas coordinates',()=>{
  for(const art of [{sheet:'javascript:bad',col:0,row:0},{sheet:'items-1',col:5,row:0},{sheet:'items-1',col:0,row:2},{sheet:'items-1',col:'0;bad',row:0}])assert.match(display.itemIcon({name:'Bad',art}),/cbItemUnknown/);
});
