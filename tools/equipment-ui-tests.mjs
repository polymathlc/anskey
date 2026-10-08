import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const Core=createRequire(import.meta.url)('../battle-core.js');
const context={ClassroomBattleCore:Core};vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../battle-display.js',import.meta.url),'utf8'),context);
const display=context.ClassroomBattleDisplay;
test('character loadout shows every gear slot and pet with slot-specific controls and owned items only',()=>{
  const gear=Object.values(Core.ITEMS).find(item=>item.slot==='helm'),pet=Object.values(Core.ITEMS).find(item=>item.type==='pet');
  const hero={...Core.heroFromStudent({id:'ari',name:'<Ari>'}),inventory:[{id:'helmet-instance',itemId:gear.id,quantity:1},{id:'pet-instance',itemId:pet.id,quantity:1}],loadout:{helm:'helmet-instance',pet:'pet-instance'}};
  const before=JSON.stringify(hero),html=display.equipmentPanel(hero,{prefix:'sh',portrait:'<span>Portrait</span>'});
  for (const key of Object.keys(Core.EQUIPMENT_SLOTS)) assert.ok(html.includes('data-equipment-slot="'+key+'"'),key);
  assert.equal((html.match(/data-equipment-slot=/g)||[]).length,11);
  assert.ok(html.includes('data-sh-remove-slot="helm"'));assert.ok(html.includes('data-sh-remove-slot="pet"'));
  assert.ok(html.includes('Change Ring 1'));assert.ok(html.includes('Change Ring 2'));assert.ok(html.includes('&lt;Ari&gt;'));
  assert.equal((html.match(/value="helmet-instance"/g)||[]).length,1);assert.equal((html.match(/value="pet-instance"/g)||[]).length,1);
  assert.match(html,/2 \/ 11 slots/);assert.equal(JSON.stringify(hero),before);
  const locked=display.equipmentPanel(hero,{prefix:'cb',locked:true});
  assert.equal((locked.match(/<select[^>]* disabled/g)||[]).length,11);
  assert.ok(locked.includes('data-cb-remove-slot="helm" aria-label="Remove Helm" disabled'));
});
test('all ring and pet atlas coordinates render without malformed CSS or unsanctioned paths',()=>{
  for(const item of Object.values(Core.ITEMS).filter(item=>item.slot==='ring1'||item.slot==='ring2'||item.type==='pet')){
    const html=display.itemIcon(item);assert.ok(!html.includes('cbItemUnknown'),item.id);assert.match(html,/background-size:500%/);
  }
  for(const art of [{sheet:'gear-ring1',col:5,row:0,columns:5,rows:4},{sheet:'pets',col:0,row:6,columns:5,rows:6},{sheet:'../secret',col:0,row:0,columns:5,rows:6}]) assert.match(display.itemIcon({art}),/cbItemUnknown/);
});

test('either ring selector accepts interchangeable owned rings without offering a duplicate single copy',()=>{
  const ring=Object.values(Core.ITEMS).find(item=>item.slot==='ring1'),hero=Core.heroFromStudent({id:'ring-panel',name:'Hero'});
  hero.inventory=[{id:'ring-copy',itemId:ring.id,quantity:1}];hero.loadout={ring2:'ring-copy'};
  let html=display.equipmentPanel(hero,{prefix:'cb'});
  const options=slot=>html.match(new RegExp('<select data-cb-loadout-slot="'+slot+'"[^>]*>(.*?)</select>'))[1];
  assert.ok(!options('ring1').includes('value="ring-copy"'));assert.ok(options('ring2').includes('value="ring-copy" selected'));
  assert.ok(html.includes('data-cb-remove-slot="ring2"'));
  hero.inventory[0].quantity=2;html=display.equipmentPanel(hero,{prefix:'cb'});
  assert.ok(options('ring1').includes('value="ring-copy"'));assert.ok(options('ring2').includes('value="ring-copy"'));
});
test('generated boss atlas markup clips one tile and rotation reflects persisted progress',()=>{
  const html=display.enemyArt({name:'<Ember>',image:'assets/battle-pixel/bosses/atlas-01.png',art:{sheet:'assets/battle-pixel/bosses/atlas-01.png',col:4,row:1,columns:5,rows:2}},'boss-view');
  assert.match(html,/class="cbEnemySprite"/);assert.match(html,/background-size:500% 200%/);assert.match(html,/background-position:100% 100%/);assert.match(html,/&lt;Ember&gt;/);assert.match(html,/id="boss-view"/);
  assert.match(display.rotation({bossRotation:{round:2,seen:['a','b']}}),/Boss round 2 · 2\//);
  assert.ok(!display.enemyArt({name:'bad',image:'javascript:bad'}).includes('src='));
});
