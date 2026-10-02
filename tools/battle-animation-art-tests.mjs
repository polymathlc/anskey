import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inspectAtlas,sha256} from './pixel-atlas-inspection.mjs';

const directory = new URL('../assets/battle-pixel/animations/', import.meta.url);
const specs = [
  ['warrior', 4, 2, 'warrior-ranger-provenance.json', 0],
  ['ranger', 4, 2, 'warrior-ranger-provenance.json', 1],
  ['mage', 4, 2, 'mage-cleric-provenance.json', 0],
  ['cleric', 4, 2, 'mage-cleric-provenance.json', 1],
  ...['slash', 'fire', 'ice', 'lightning', 'arrow', 'heal'].map((role, index) =>
    [role, 2, 2, 'effects-provenance.json', index]),
  ...['paladin','berserker','sharpshooter','beastmaster','archmage','chronomancer','hierophant','oracle'].map((job,index)=>[job,4,2,'advancement-provenance.json',index]),
  ...['warrior','ranger','mage','cleric'].map((role,index)=>[role+'-advanced',4,4,'advancement-provenance.json',index+8]),
  ['beastmaster-effects',4,4,'beastmaster-effects-source.json',0],
  ...['warrior','ranger','paladin','berserker','sharpshooter','beastmaster'].map((hero,index)=>[hero+'-genders',4,4,'gender-physical-provenance.json',index]),
  ...['mage','cleric','archmage','chronomancer','hierophant','oracle'].map((hero,index)=>[hero+'-genders',4,4,'gender-magic-provenance.json',index])
];
function inspect(spec) {
  const [name, cols, rows, promptManifest, promptIndex] = spec;
  const file = name + '-sheet.png', bytes = fs.readFileSync(new URL(file, directory));
  const {width,height,alpha,frameDetails}=inspectAtlas(bytes,cols,rows);
  return {file,width,height,rows,cols,frames:rows*cols,bytes:bytes.length,sha256:sha256(bytes),promptManifest:promptManifest+'#/assets/'+promptIndex,alpha,frameDetails};
}
const inspected = specs.map(inspect);
const manifestUrl = new URL('manifest.json', directory);
if (process.argv.includes('--write-manifest')) {
  const assets = inspected.map(({ frameDetails, ...asset }) => asset);
  fs.writeFileSync(manifestUrl, JSON.stringify({ schemaVersion: 1, generatedAt: '2026-10-03', assets }, null, 2) + '\n');
}
const manifest = JSON.parse(fs.readFileSync(manifestUrl, 'utf8'));

test('all thirty-five generated animation sheets have intact PNG data and a matching asset manifest', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.assets.length, 35);
  assert.equal(new Set(manifest.assets.map(asset => asset.file)).size, 35);
  for (const actual of inspected) {
    const { frameDetails, ...expected } = actual;
    assert.deepEqual(manifest.assets.find(asset => asset.file === actual.file), expected, actual.file + ' manifest matches bytes');
    assert.ok(actual.bytes < 2 * 1024 * 1024, actual.file + ' below 2 MiB');
    assert.ok(Math.abs(actual.width / actual.cols - actual.height / actual.rows) <= 1, actual.file + ' has square animation cells');
    const [file, pointer] = actual.promptManifest.split('#');
    const provenance = JSON.parse(fs.readFileSync(new URL(file, directory), 'utf8'));
    const source = provenance.assets ? provenance.assets[Number(pointer.split('/').pop())] : provenance;
    assert.equal(source.file || source.name, actual.file, 'prompt belongs to this sheet');
    assert.ok(source.prompt.length > 100 && /pixel/i.test(source.prompt), 'full generation prompt retained');
  }
  assert.ok(inspected.reduce((sum, asset) => sum + asset.bytes, 0) < 48 * 1024 * 1024, 'entire animation library below 48 MiB');
});
for (const actual of inspected) {
  test(actual.file + ' contains real transparency and nonempty, distinct animation frames', () => {
    const total = actual.width * actual.height;
    assert.ok(actual.alpha.transparentPixels > total * 0.15, 'genuinely transparent backdrop');
    assert.ok(actual.alpha.nearOpaquePixels > total * 0.005, 'visible artwork with substantial opacity');
    assert.equal(actual.alpha.transparentPixels + actual.alpha.partialPixels + actual.alpha.opaquePixels, total);
    assert.equal(new Set(actual.frameDetails.map(frame => frame.fingerprint)).size, actual.frames, 'every frame visibly differs');
    actual.frameDetails.forEach((frame, index) => {
      assert.ok(frame.occupiedPixels > frame.area * 0.005, 'frame ' + index + ' contains visible artwork');
      assert.ok(frame.occupiedPixels < frame.area * 0.85, 'frame ' + index + ' has transparent padding');
      assert.ok(frame.coloredPixels > 100, 'frame ' + index + ' is colored artwork, not a blank/checkerboard');
      assert.equal(frame.edgePixels, 0, 'frame ' + index + ' has no silhouette clipped by a cell boundary');
    });
  });
}
