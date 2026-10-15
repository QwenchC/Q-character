import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { prepareShapeImage, applyForegroundMask, alphaSummary, extractAlphaMask, validateEditedMask } from '../electron/background.mjs';

function fixture() {
  const image = new PNG({ width: 80, height: 120 }), mask = new PNG({ width: 80, height: 120 });
  for (let y = 0; y < 120; y++) for (let x = 0; x < 80; x++) {
    const i = (y * 80 + x) * 4, inside = x >= 25 && x <= 55 && y >= 20 && y <= 100;
    image.data.set(inside ? [250, 249, 245, 255] : [180, 180, 180, 255], i);
    mask.data.set(inside ? [255, 255, 255, 255] : [0, 0, 0, 255], i);
  }
  return { image: PNG.sync.write(image), mask: PNG.sync.write(mask) };
}

test('手修从原图恢复衣服 RGB，移除残留背景，灰度边缘保留；非法蒙版拒绝', () => {
  const { image, mask } = fixture(); const edited = PNG.sync.read(mask);
  const sleeve = (40 * 80 + 40) * 4, fringe = (41 * 80 + 40) * 4;
  edited.data.set([180, 180, 180, 255], fringe);
  const result = PNG.sync.read(validateEditedMask(PNG.sync.write(edited), image));
  assert.deepEqual([...result.data.subarray(sleeve, sleeve + 4)], [250, 249, 245, 255]);
  assert.equal(result.data[fringe + 3], 180); assert.equal(result.data[3], 0);
  const old = PNG.sync.read(applyForegroundMask(image, mask)); old.data[sleeve + 3] = 0;
  assert.equal(PNG.sync.read(validateEditedMask(PNG.sync.write(edited), image)).data[sleeve + 3], 255);
  edited.data[0] = 1; assert.throws(() => validateEditedMask(PNG.sync.write(edited), image), /黑白/);
  edited.data[0] = 0; edited.data[3] = 0; assert.throws(() => validateEditedMask(PNG.sync.write(edited), image), /黑白/);
  assert.throws(() => validateEditedMask(Buffer.from('not png'), image), /有效的 PNG/);
  assert.throws(() => validateEditedMask(PNG.sync.write(new PNG({ width: 2, height: 2 })), image), /尺寸不一致/);
  const transparent = PNG.sync.read(image); transparent.data[sleeve + 3] = 0;
  assert.equal(PNG.sync.read(validateEditedMask(mask, PNG.sync.write(transparent))).data[sleeve + 3], 0);
  transparent.data[sleeve + 3] = 128; const softMask = PNG.sync.read(mask); softMask.data.set([128, 128, 128, 255], sleeve);
  assert.equal(PNG.sync.read(validateEditedMask(PNG.sync.write(softMask), PNG.sync.write(transparent))).data[sleeve + 3], 128);
});

test('抠图只使用前景蒙版：白衣服保留，背景透明，原图 RGB 完全不变', () => {
  const { image, mask } = fixture(); const input = PNG.sync.read(image), cutout = PNG.sync.read(applyForegroundMask(image, mask));
  for (let i = 0; i < input.data.length; i += 4) for (let c = 0; c < 3; c++) assert.equal(cutout.data[i+c], input.data[i+c]);
  assert.equal(cutout.data[(40 * 80 + 40) * 4 + 3], 255);
  assert.equal(cutout.data[3], 0);
  assert.equal(alphaSummary(PNG.sync.write(cutout)).hasTransparency, true);
});
test('尺寸不符、全黑或全白蒙版停止处理，不把错误背景交给 3D', () => {
  const { image } = fixture(); const wrong = new PNG({ width: 10, height: 10 });
  assert.throws(() => applyForegroundMask(image, PNG.sync.write(wrong)), /尺寸不一致/);
  const mask = new PNG({ width: 80, height: 120 }); mask.data.fill(0);
  assert.throws(() => applyForegroundMask(image, PNG.sync.write(mask)), /有效的前景/);
  mask.data.fill(255); assert.throws(() => applyForegroundMask(image, PNG.sync.write(mask)), /有效的前景/);
});
test('3D 输入拒绝不透明原图，只合成蒙版前景，浅色衣服不参与颜色阈值判断', () => {
  const { image, mask } = fixture(); assert.throws(() => prepareShapeImage(image), /先自动抠图/);
  const result = PNG.sync.read(prepareShapeImage(applyForegroundMask(image, mask)));
  assert.equal(result.width, result.height); assert.equal(result.data[0], 255);
  const colors = new Set();
  for (let i = 0; i < result.data.length; i += 4) colors.add(`${result.data[i]},${result.data[i+1]},${result.data[i+2]}`);
  assert.deepEqual([...colors].sort(), ['250,249,245', '255,255,255']);
});
test('透明通道可导出为白色表示保留的蒙版，半透明边缘保持原有数值', () => {
  const { image, mask } = fixture(); const cutout = PNG.sync.read(applyForegroundMask(image, mask));
  cutout.data[(40 * 80 + 40) * 4 + 3] = 128;
  const alpha = PNG.sync.read(extractAlphaMask(PNG.sync.write(cutout)));
  assert.equal(alpha.data[(40 * 80 + 40) * 4], 128); assert.equal(alpha.data[0], 0); assert.equal(alpha.data[3], 255);
});
