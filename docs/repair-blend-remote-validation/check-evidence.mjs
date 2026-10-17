import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = name => fs.readFile(path.join(root, name));
const verification = JSON.parse(await read('verification.json'));
const manifest = JSON.parse(await read('evidence-manifest.json'));
for (const file of manifest.files) {
  const target = path.resolve(root, file.name);
  assert.ok(target.startsWith(root + path.sep));
  const bytes = await fs.readFile(target);
  assert.equal(bytes.length, file.size, file.name);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.name);
}
for (const platform of ['windows', 'android']) {
  const images = {};
  for (const name of ['before', 'mask', 'after', 'plain-blend', 'computed-blend']) {
    images[name] = PNG.sync.read(await read(`${platform}-${name}.png`));
  }
  const { before, mask, after } = images;
  let outside = 0, inside = 0, changed = 0, band = 0, direct = 0, fused = 0;
  for (let y = 0; y < before.height; y++) for (let x = 0; x < before.width; x++) {
    const i = (y * before.width + x) * 4;
    if (!mask.data[i]) {
      outside++;
      assert.deepEqual(after.data.subarray(i, i + 4), before.data.subarray(i, i + 4));
    } else {
      inside++;
      if (!after.data.subarray(i, i + 4).equals(before.data.subarray(i, i + 4))) changed++;
    }
    assert.equal(after.data[i + 3], images['computed-blend'].data[i + 3]);
    if (after.data[i + 3] >= 240) {
      for (let k = 0; k < 3; k++) assert.equal(after.data[i + k], images['computed-blend'].data[i + k]);
    }
    const radius = Math.hypot(x - 320, y - 540);
    if (radius >= 24 && radius <= 37 && before.data[i + 3] > 240 && before.data[i + 1] > before.data[i] * 1.4) {
      band++;
      for (let k = 0; k < 3; k++) {
        direct += Math.abs(images['plain-blend'].data[i + k] - before.data[i + k]) / 3;
        fused += Math.abs(after.data[i + k] - before.data[i + k]) / 3;
      }
    }
  }
  const expected = verification[platform];
  assert.equal(outside, expected.outside);
  assert.equal(inside, expected.inside);
  assert.equal(changed, expected.insideChanged);
  assert.equal(band, expected.sameCandidate.bandPixels);
  assert.ok(Math.abs(direct / band - expected.sameCandidate.plainMaskedBlendMeanAbsRGB) < 1e-9);
  assert.ok(Math.abs(fused / band - expected.sameCandidate.actualMeanAbsRGB) < 1e-9);
  const gold = (image, y0, y1) => {
    let count = 0;
    for (let y = y0; y < y1; y++) for (let x = 290; x < 350; x++) {
      const [r, g, b, a] = image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4);
      if (a > 200 && r > 170 && g > 120 && r > g * 1.1 && g > b * 1.3) count++;
    }
    return count;
  };
  assert.equal(gold(after, 510, 570), 0);
  for (const [lo, hi] of [[450, 510], [570, 630]]) assert.equal(gold(after, lo, hi), gold(before, lo, hi));
  console.log(`${platform}: exterior RGBA, removed button, retained buttons and blend metrics verified`);
}
