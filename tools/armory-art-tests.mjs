import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {inspectAtlas,sha256} from './pixel-atlas-inspection.mjs';
const Core=createRequire(import.meta.url)('../battle-core.js');
const directory=new URL('../assets/battle-pixel/items/',import.meta.url);
const provenance=JSON.parse(fs.readFileSync(new URL('armory-provenance.json',directory),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('armory-manifest.json',directory),'utf8'));
const catalog=JSON.parse(fs.readFileSync(new URL('armory-catalog.json',directory),'utf8'));
const items=Object.values(Core.ITEMS).filter(item=>['armory','companions'].includes(item.collection));
const inspected=manifest.assets.map(asset=>{
  const bytes=fs.readFileSync(new URL(asset.sheet+'.png',directory));
  return {sheet:asset.sheet,file:'assets/battle-pixel/items/'+asset.sheet+'.png',bytes:bytes.length,sha256:sha256(bytes),columns:asset.columns,rows:asset.rows,...inspectAtlas(bytes,asset.columns,asset.rows)};
});
test('native armory assets retain complete generation and revision provenance',()=>{
  assert.equal(provenance.tool,'Built-in ImageGen');assert.equal(provenance.nativePngUnchanged,true);
  assert.equal(manifest.nativePngUnchanged,true);assert.equal(manifest.assets.length,11);assert.equal(provenance.assets.length,11);
  assert.equal(new Set(manifest.assets.map(asset=>asset.sha256)).size,11);
  assert.deepEqual(manifest.assets,inspected);
  for(const [index,atlas] of inspected.entries()){
    const asset=provenance.assets[index];assert.equal(asset.sheet,atlas.sheet);assert.equal(asset.file,atlas.file);
    assert.equal(asset.columns,5);assert.equal(asset.rows,asset.sheet==='pets'?6:4);
    assert.match(asset.prompt,/pixel-art/);assert.ok(asset.prompt.length>300);
    assert.match(asset.source,/generated_images\/.*\.png$/);assert.match(asset.originalSource,/generated_images\/.*\.png$/);
    assert.ok(asset.revisionPrompts.length>=1);assert.ok(asset.revisionPrompts.every(prompt=>/transparent/i.test(prompt)&&/center/i.test(prompt)));
    assert.equal(asset.visualReview,'passed');assert.ok(Math.abs(atlas.width/atlas.columns-atlas.height/atlas.rows)<1,'native square cells');
  }
});
test('136 new equipment icons and 30 pet icons map uniquely into shipped native atlas tiles',()=>{
  assert.equal(items.length,166);assert.equal(items.filter(item=>item.type==='equipment').length,136);assert.equal(items.filter(item=>item.type==='pet').length,30);
  assert.deepEqual(catalog.items,items.map(({id,name,rarity,type,slot,art})=>({id,name,rarity,type,slot,art})));
  assert.equal(new Set(items.map(item=>`${item.art.sheet}:${item.art.col}:${item.art.row}`)).size,166);
  for(const item of items){
    const atlas=inspected.find(asset=>asset.sheet===item.art.sheet);assert.ok(atlas,item.id);
    assert.equal(item.art.columns,atlas.columns);assert.equal(item.art.rows,atlas.rows);
    assert.ok(Number.isInteger(item.art.col)&&item.art.col>=0&&item.art.col<atlas.columns,item.id);
    assert.ok(Number.isInteger(item.art.row)&&item.art.row>=0&&item.art.row<atlas.rows,item.id);
    assert.equal(atlas.frameDetails[item.art.row*atlas.columns+item.art.col].edgePixels,0,item.id+' stays in its tile');
  }
});
for(const atlas of inspected)test(atlas.sheet+' keeps all complete, unique inventory pictures on transparent alpha',()=>{
  const pixels=atlas.width*atlas.height;
  assert.ok(atlas.alpha.transparentPixels/pixels>.5,'genuine transparent gutters');
  assert.ok(atlas.alpha.nearOpaquePixels>1000,'opaque artwork rather than empty alpha');
  assert.equal(atlas.frameDetails.length,atlas.columns*atlas.rows);
  assert.equal(new Set(atlas.frameDetails.map(frame=>frame.fingerprint)).size,atlas.frameDetails.length,'distinct visible sprites');
  for(const frame of atlas.frameDetails){
    assert.ok(frame.occupiedPixels/frame.area>.02,'clearly visible sprite');
    assert.ok(frame.coloredPixels/frame.occupiedPixels>.1,'colored fantasy artwork');
    assert.equal(frame.edgePixels,0,'complete icon with no neighbour bleed');
  }
});
