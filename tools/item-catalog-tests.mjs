import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {inspectAtlas,sha256} from './pixel-atlas-inspection.mjs';

const require=createRequire(import.meta.url),C=require('../battle-core.js');
const items=Object.values(C.ITEMS),collection=items.filter(item=>item.collection==='treasure-fifty');
const directory=new URL('../assets/battle-pixel/items/',import.meta.url);
const catalog=JSON.parse(fs.readFileSync(new URL('catalog.json',directory),'utf8'));
const provenance=JSON.parse(fs.readFileSync(new URL('provenance.json',directory),'utf8'));
const inspected=Array.from({length:5},(_,i)=>{
  const sheet='items-'+(i+1),file=sheet+'.png',bytes=fs.readFileSync(new URL(file,directory));
  return {sheet,file,bytes:bytes.length,sha256:sha256(bytes),...inspectAtlas(bytes,5,2)};
});
if(process.argv.includes('--write-manifest')) {
  fs.writeFileSync(new URL('manifest.json',directory),JSON.stringify({version:1,columns:5,rows:2,assets:inspected.map(({frameDetails,...asset})=>asset)},null,2)+'\n');
}
const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',directory),'utf8'));

test('fifty additional relics preserve the twenty-two original reward IDs and rarity weighting',()=>{
  assert.equal(collection.length,50);assert.equal(items.length,72);
  assert.deepEqual(Object.fromEntries(Object.keys(C.RARITIES).map(rarity=>[rarity,collection.filter(i=>i.rarity===rarity).length])),{common:10,uncommon:10,rare:10,epic:8,legendary:8,mythical:4});
  assert.deepEqual(Object.values(C.RARITIES).map(r=>r.weight),[45,27,16,8,3.3,.7]);
  for(const id of ['red-potion','blue-ether','iron-charm','bronze-blade','fire-flask','party-tonic','oak-amulet','hunters-band','phoenix-feather','mana-prism','crimson-edge','silver-aegis','elixir','starbomb','storm-quiver','moon-codex','dawnbringer','worldroot','phoenix-crown','chronicle','void-edge','sovereign-star'])assert.ok(C.ITEMS[id],id);
  assert.deepEqual(C.ITEMS['red-potion'].effect,{heal:.4});assert.deepEqual(C.ITEMS['blue-ether'].effect,{mana:45});
  assert.deepEqual(catalog.items,collection.map(({id,name,rarity,art})=>({id,name,rarity,art})));
});

test('all new relics increase real hero stats and only use supported equipment effects',()=>{
  const allowed=new Set(['damage','defence','maxHp','maxMp','healing','critChance','critMultiplier','leech','manaRegen','teamLeech','teamMana','revive','echo','pierce','ignoreGuard']);
  const hero=C.heroFromStudent({id:'items-proof',name:'Hero'},null,0),base=C.statsFor(hero);
  for(const item of collection) {
    assert.equal(item.type,'equipment');
    for(const [key,value] of Object.entries(item.effect)) {assert.ok(allowed.has(key),item.id+': '+key);assert.ok(value===true || Number.isFinite(value)&&value>0,item.id+': positive bonus');}
    const equipped={...hero,inventory:[{id:'test-relic',itemId:item.id,quantity:1}],equipped:'test-relic'},stats=C.statsFor(equipped);
    assert.ok(Object.keys(base).some(key=>stats[key]>base[key]),item.id+' improves actual stats');
    assert.deepEqual(C.equipmentEffect(equipped),item.effect);
  }
  assert.equal(C.ITEMS['eternal-phoenix-diadem'].effect.revive,true);
  assert.equal(C.ITEMS['hourglass-of-infinity'].effect.echo,true);
  assert.equal(C.ITEMS['reality-cleaver'].effect.ignoreGuard,true);
  assert.equal(C.ITEMS['heart-of-the-constellation'].effect.teamLeech,.15);
});

test('all seventy-two rewards can drop and their inventory art always resolves',()=>{
  const seen=new Set();
  for(let i=0;i<30000;i++)seen.add(C.rollReward('loot-atlas-'+i,'student:art',{rewardXp:45}).itemId);
  assert.equal(seen.size,72);
  for(const item of items) {
    assert.ok(seen.has(item.id));assert.match(item.art.sheet,/^items-[1-5]$/);
    assert.ok(Number.isInteger(item.art.col)&&item.art.col>=0&&item.art.col<5);
    assert.ok(Number.isInteger(item.art.row)&&item.art.row>=0&&item.art.row<2);
    assert.ok(fs.existsSync(new URL(item.art.sheet+'.png',directory)),item.id);
  }
  assert.equal(new Set(collection.map(i=>`${i.art.sheet}:${i.art.col}:${i.art.row}`)).size,50);
  const hero=C.heroFromStudent({id:'rarity-proof',name:'Hero'},null,0);
  hero.inventory=collection.map(i=>({id:'bag:'+i.id,itemId:i.id,quantity:1}));
  C.autoEquip(hero);assert.equal(C.ITEMS[hero.inventory.find(i=>i.id===hero.equipped).itemId].rarity,'mythical');
});

test('all five native item atlases match their provenance and integrity manifest',()=>{
  assert.equal(provenance.tool,'Built-in ImageGen');assert.equal(provenance.nativePngUnchanged,true);
  assert.equal(provenance.assets.length,5);assert.equal(manifest.assets.length,5);
  inspected.forEach((atlas,index)=>{
    const {frameDetails,...expected}=atlas;assert.deepEqual(manifest.assets[index],expected);
    assert.equal(provenance.assets[index].sheet,atlas.sheet);
    assert.ok(provenance.assets[index].file.endsWith('/'+atlas.file));
    assert.ok(provenance.assets[index].prompt.length>300);
    assert.ok(Math.abs(atlas.width/5-atlas.height/2)<=1,'square native grid cells');
  });
  assert.ok(inspected.reduce((sum,a)=>sum+a.bytes,0)<8*1024*1024,'item artwork payload stays bounded');
});

for(const atlas of inspected)test(atlas.file+' has ten distinct, complete icons on genuine transparent alpha',()=>{
  assert.ok(atlas.alpha.transparentPixels/(atlas.width*atlas.height)>.15);
  assert.equal(atlas.frameDetails.length,10);
  assert.equal(new Set(atlas.frameDetails.map(frame=>frame.fingerprint)).size,10);
  for(const frame of atlas.frameDetails) {
    assert.ok(frame.occupiedPixels/frame.area>.03,'visible icon');
    assert.ok(frame.coloredPixels/frame.occupiedPixels>.1,'coloured pixel artwork');
    assert.equal(frame.edgePixels,0,'icon fits entirely inside its cell');
  }
});
