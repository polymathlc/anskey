import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const bosses = createRequire(import.meta.url)('../battle-bosses.js');
test('all twenty original PNGs match the visually reviewed transparent artwork manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../assets/classroom-bosses/generation-manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.assets.length,20); assert.equal(new Set(manifest.assets.map(a=>a.sha256)).size,20);
  for (const boss of bosses) {
    const art = manifest.assets.find(a=>a.id===boss.id); assert.ok(art,boss.id);
    assert.equal(art.path,boss.image); assert.equal(art.name,boss.name);
    const png = fs.readFileSync(new URL('../'+boss.image,import.meta.url));
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(createHash('sha256').update(png).digest('hex'),art.sha256);
    assert.equal(png.readUInt32BE(16),art.width); assert.equal(png.readUInt32BE(20),art.height);
    assert.equal(png[25],6,'RGBA color type');
    assert.equal(art.alphaMin,0); assert.equal(art.alphaMax,255); assert.ok(art.transparentPixels>10000);
    assert.equal(art.fullBodyVisualReview,'passed'); assert.match(art.prompt,/transparent/i);
  }
});
