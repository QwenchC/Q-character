import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPalette, clayRecipe, DEFAULT_BASES, mixClay } from '../src/color.ts';
import { buildTextureAtlas } from '../src/texture-image.ts';

test('只从前景提取主色，不把透明区域的 RGB 当成背景色或配饰色', () => {
  const rgba = new Uint8ClampedArray(40 * 40 * 4);
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) rgba.set(x < 10 ? [255, 0, 255, 0] : y < 20 ? [70, 45, 30, 255] : [55, 130, 65, 255], (y * 40 + x) * 4);
  const colors = extractPalette(rgba, 40, 40);
  assert.equal(colors.length, 2); assert.deepEqual(new Set(colors.map(s => s.original)), new Set(['#462d1e', '#378241']));
  assert.ok(Math.abs(colors.reduce((sum, s) => sum + s.share, 0) - 1) < 1e-6);
  assert.throws(() => extractPalette(new Uint8ClampedArray(16), 2, 2), /前景/);
});
test('贴图延展仅使用前景颜色，背面不复制眼睛等正面细节；目标色替换保留色差', () => {
  const rgba = new Uint8ClampedArray(20 * 40 * 4);
  for (let y = 0; y < 40; y++) for (let x = 0; x < 20; x++) {
    const inside = x >= 4 && x <= 15 && y >= 2 && y <= 37;
    rgba.set(inside ? (y < 18 ? [70, 45, 30, 255] : [55, 130, 65, 255]) : [255, 0, 255, 0], (y * 20 + x) * 4);
  }
  const palette = extractPalette(rgba, 20, 40), atlas = buildTextureAtlas(rgba, 20, 40, palette, 512);
  assert.equal(atlas.width, 1024); assert.equal(atlas.height, 512);
  const colors = new Set(); for (let i = 0; i < atlas.pixels.length; i += 4) { assert.equal(atlas.pixels[i + 3], 255); colors.add([...atlas.pixels.subarray(i, i + 3)].join(',')); }
  assert.deepEqual(colors, new Set(['70,45,30', '55,130,65']));
  palette.find(s => s.original === '#378241').target = '#3264c8';
  const recolored = buildTextureAtlas(rgba, 20, 40, palette, 512);
  assert.deepEqual([...recolored.pixels.subarray((400 * 1024 + 200) * 4, (400 * 1024 + 200) * 4 + 3)], [50, 100, 200]);
  rgba.fill(255); assert.throws(() => buildTextureAtlas(rgba, 20, 40, [], 512), /抠图/);
});
test('调色配方按 20 个重量份、最多三种基础色；纯色目标不加入无关颜色', () => {
  for (const base of DEFAULT_BASES) { const recipe = clayRecipe(base.hex); assert.equal(recipe.ingredients.reduce((sum, b) => sum + b.parts, 0), 20); assert.equal(recipe.ingredients.length, 1); assert.equal(recipe.predicted, base.hex); }
  const warm = clayRecipe('#ddb899'); assert.ok(warm.ingredients.length <= 3); assert.equal(warm.ingredients.reduce((sum, b) => sum + b.parts, 0), 20);
  const weights = DEFAULT_BASES.map(b => warm.ingredients.find(i => i.name === b.name)?.parts || 0);
  assert.ok(mixClay(DEFAULT_BASES, weights).every(v => v >= 0 && v <= 255));
});
