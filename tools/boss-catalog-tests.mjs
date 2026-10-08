import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {inspectAtlas,sha256} from './pixel-atlas-inspection.mjs';

const bosses=createRequire(import.meta.url)('../battle-bosses.js');
const playable=bosses.filter(b=>!b.legacy), expanded=playable.filter(b=>b.art);
const readJson=path=>JSON.parse(fs.readFileSync(new URL('../'+path,import.meta.url),'utf8'));
const designs=readJson('assets/battle-pixel/bosses/boss-designs.json');
const manifest=readJson('assets/battle-pixel/bosses/provenance.json');
const rarities=['common','uncommon','rare','epic','legendary','mythical'];
const tiers={common:'Skirmish',uncommon:'Skirmish',rare:'Elite',epic:'Elite',legendary:'Boss',mythical:'Mythic boss'};

test('exactly 100 distinct bosses are playable and the 20 historical bosses remain available',()=>{
  assert.equal(playable.length,100);
  assert.equal(expanded.length,94);
  assert.equal(bosses.filter(b=>b.legacy).length,20);
  assert.equal(new Set(bosses.map(b=>b.id)).size,bosses.length,'no ambiguous boss IDs');
  assert.equal(new Set(bosses.map(b=>b.name)).size,bosses.length,'every boss has a distinct name');
  assert.deepEqual(new Set(playable.map(b=>b.rarity)),new Set(rarities));
  const styles=new Set(['balanced','guard','reflect','swift','weaken','regenerate','splash','pierce','charge']);
  for(const boss of playable) {
    assert.ok(styles.has(boss.playstyle),boss.id+' supports combat behavior');
    assert.equal(boss.tier,tiers[boss.rarity],boss.id+' rarity determines tier');
    assert.ok(boss.description && boss.attackName && boss.ultimateName,boss.id+' has move identities and strategy');
  }
  for(const boss of expanded) {
    assert.ok(boss.hpMultiplier>=.5 && boss.hpMultiplier<=2.75,boss.id+' health stays within encounter range');
    assert.ok(boss.attackMultiplier>=.3 && boss.attackMultiplier<=1.65,boss.id+' damage stays within encounter range');
    assert.ok(boss.defence>=0 && boss.defence<=.28);
    assert.ok(boss.chargeMax>=2 && boss.chargeMax<=5);
    assert.ok(boss.rewardXp>0);
  }
});

test('94 original boss designs map exactly once to generated atlas tiles',()=>{
  assert.equal(designs.length,94);
  assert.equal(new Set(designs.map(d=>d[2])).size,94,'distinct visual subjects');
  assert.equal(manifest.assets.length,10);
  assert.equal(manifest.generator,'OpenAI built-in image_gen');
  assert.equal(manifest.nativePngUnchanged,true);
  const tiles=new Set();
  expanded.forEach((boss,index)=>{
    const design=designs[index],asset=manifest.assets[Math.floor(index/10)];
    assert.equal(boss.id,design[0]);assert.equal(boss.name,design[1]);assert.equal(boss.subject,design[2]);
    assert.equal(boss.image,asset.file);assert.equal(boss.art.sheet,asset.file);
    assert.equal(boss.art.columns,5);assert.equal(boss.art.rows,2);
    assert.equal(boss.art.col,index%5);assert.equal(boss.art.row,Math.floor(index%10/5));
    assert.ok(Math.abs(boss.art.aspect-asset.aspect)<.000001,'native sprite aspect ratio');
    assert.equal(asset.bossIds[index%10],boss.id,'prompt and tile order agree');
    tiles.add([boss.art.sheet,boss.art.col,boss.art.row].join(':'));
  });
  assert.equal(tiles.size,94,'no reused boss artwork tiles');
});

test('every generated boss sprite is transparent, visually distinct and wholly inside its tile',()=>{
  const fingerprints=new Set(),hashes=new Set();
  for(const asset of manifest.assets) {
    const png=fs.readFileSync(new URL('../'+asset.file,import.meta.url));
    const inspection=inspectAtlas(png,5,2);
    hashes.add(sha256(png));
    assert.equal(sha256(png),asset.sha256,asset.name+' unchanged saved native PNG');
    assert.equal(asset.sha256,asset.sourceSha256,asset.name+' native source hash');
    assert.equal(asset.nativePngUnchanged,true);
    assert.equal(inspection.width,asset.width);assert.equal(inspection.height,asset.height);
    assert.ok(inspection.alpha.transparentPixels>inspection.width*inspection.height*.3,'genuine transparent background');
    assert.ok(inspection.alpha.nearOpaquePixels>10000,'visible solid sprite pixels');
    assert.equal(asset.fullBodyVisualReview,'passed');assert.equal(asset.gridVisualReview,'passed');
    assert.match(asset.prompt,/pixel-art/);assert.match(asset.prompt,/transparent/i);
    assert.equal(asset.count,asset.bossIds.length);
    inspection.frameDetails.forEach((frame,index)=>{
      assert.equal(frame.edgePixels,0,asset.name+' tile '+index+' has no clipping or border');
      if(index<asset.count) {
        assert.ok(frame.occupiedPixels>1000,'full sprite exists in '+asset.name+' tile '+index);
        assert.ok(frame.coloredPixels>frame.occupiedPixels*.3,'colored boss pixels');
        fingerprints.add(frame.fingerprint);
      } else assert.equal(frame.occupiedPixels,0,'unused tile remains transparent');
    });
  }
  assert.equal(hashes.size,10,'ten distinct native atlases');
  assert.equal(fingerprints.size,94,'94 distinct visible sprites');
});
