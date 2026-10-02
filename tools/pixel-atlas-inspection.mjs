import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function paeth(a, b, c) {
  const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
}

// Decode pixels rather than trusting PNG headers or a manifest's alpha claim.
export function decodePng(bytes) {
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'PNG signature');
  let width, height, offset = 8, ended = false;
  const compressed = [];
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length, 'complete PNG chunk');
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    assert.ok(end <= bytes.length, 'complete PNG chunk data');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    assert.equal(crc32(bytes.subarray(offset + 4, end - 4)), bytes.readUInt32BE(end - 4), type + ' CRC');
    const data = bytes.subarray(offset + 8, end - 4);
    if (type === 'IHDR') {
      assert.equal(offset, 8, 'IHDR first');
      assert.equal(length, 13, 'IHDR length');
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.ok(width >= 512 && width <= 4096 && height >= 512 && height <= 4096, 'reasonable atlas dimensions');
      assert.equal(data[8], 8, '8-bit channels');
      assert.equal(data[9], 6, 'true RGBA');
      assert.equal(data[10], 0, 'standard PNG compression');
      assert.equal(data[11], 0, 'standard PNG filtering');
      assert.equal(data[12], 0, 'non-interlaced PNG');
    } else if (type === 'IDAT') compressed.push(data);
    else if (type === 'IEND') { ended = true; assert.equal(end, bytes.length, 'no trailing data'); }
    offset = end;
  }
  assert.ok(ended && compressed.length && width, 'complete PNG');
  const stride = width * 4;
  const raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: (stride + 1) * height });
  assert.equal(raw.length, (stride + 1) * height, 'correct decompressed pixel length');
  const rgba = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert.ok(filter <= 4, 'supported PNG row filter');
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const left = x >= 4 ? rgba[index - 4] : 0;
      const above = y ? rgba[index - stride] : 0;
      const upperLeft = y && x >= 4 ? rgba[index - stride - 4] : 0;
      const prediction = [0, left, above, Math.floor((left + above) / 2), paeth(left, above, upperLeft)][filter];
      rgba[index] = (raw[y * (stride + 1) + x + 1] + prediction) & 255;
    }
  }
  return { width, height, rgba };
}
export function inspectAtlas(bytes, cols, rows) {
  const png = decodePng(bytes);
  const alpha = { transparentPixels: 0, partialPixels: 0, opaquePixels: 0, visiblePixels: 0, nearOpaquePixels: 0 };
  for (let p = 3; p < png.rgba.length; p += 4) {
    const a = png.rgba[p];
    if (a === 0) alpha.transparentPixels++;
    else if (a === 255) alpha.opaquePixels++;
    else alpha.partialPixels++;
    if (a > 127) alpha.visiblePixels++;
    if (a >= 240) alpha.nearOpaquePixels++;
  }
  const frameDetails = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const x0 = Math.floor(col * png.width / cols), x1 = Math.floor((col + 1) * png.width / cols);
    const y0 = Math.floor(row * png.height / rows), y1 = Math.floor((row + 1) * png.height / rows);
    let occupiedPixels = 0, edgePixels = 0, coloredPixels = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * png.width + x) * 4;
      if (png.rgba[i + 3] > 127) {
        occupiedPixels++;
        if (x === x0 || x === x1 - 1 || y === y0 || y === y1 - 1) edgePixels++;
        if (Math.max(...png.rgba.subarray(i, i + 3)) - Math.min(...png.rgba.subarray(i, i + 3)) > 15) coloredPixels++;
      }
    }
    // A normalized visible-pixel fingerprint avoids "different" frames caused only by
    // fractional grid widths or invisible RGB data in fully transparent pixels.
    const sample = Buffer.alloc(64 * 64 * 4);
    for (let sy = 0; sy < 64; sy++) for (let sx = 0; sx < 64; sx++) {
      const x = x0 + Math.floor((sx + 0.5) * (x1 - x0) / 64);
      const y = y0 + Math.floor((sy + 0.5) * (y1 - y0) / 64);
      const source = (y * png.width + x) * 4, target = (sy * 64 + sx) * 4;
      if (png.rgba[source + 3] > 127) png.rgba.copy(sample, target, source, source + 4);
    }
    frameDetails.push({ occupiedPixels, coloredPixels, edgePixels, area: (x1 - x0) * (y1 - y0), fingerprint: sha256(sample) });
  }
  return {width:png.width,height:png.height,alpha,frameDetails};
}
