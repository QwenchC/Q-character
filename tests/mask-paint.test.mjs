import test from 'node:test';
import assert from 'node:assert/strict';
import { MaskDocument, paintMaskSegment } from '../src/mask-paint.ts';

const brush = (mode = 'restore', diameter = 8, hardness = 1) => ({ mode, diameter, hardness });
test('画笔连续恢复浅色衣服和擦除背景，快速拖动不会漏点，越界安全裁切', () => {
  const pixels = new Uint8ClampedArray(100 * 40);
  paintMaskSegment(pixels, 100, 40, { x: -10000, y: 20 }, { x: 10000, y: 20 }, brush());
  for (let x = 0; x < 100; x++) assert.equal(pixels[20 * 100 + x], 255);
  assert.equal(pixels[0], 0);
  paintMaskSegment(pixels, 100, 40, { x: 40, y: 20 }, { x: 60, y: 20 }, brush('erase'));
  for (let x = 40; x <= 60; x++) assert.equal(pixels[20 * 100 + x], 0);
  assert.equal(pixels[20 * 100 + 10], 255);
  assert.equal(paintMaskSegment(pixels, 100, 40, { x: -100, y: -100 }, { x: -20, y: -20 }, brush()), null);
});
test('软笔刷保留半透明过渡，最细笔刷与非法坐标处理正确', () => {
  const pixels = new Uint8ClampedArray(20 * 20);
  paintMaskSegment(pixels, 20, 20, { x: 10.5, y: 10.5 }, { x: 10.5, y: 10.5 }, brush('restore', 10, 0.2));
  assert.equal(pixels[10 * 20 + 10], 255); assert.ok(pixels[10 * 20 + 14] > 0 && pixels[10 * 20 + 14] < 255);
  assert.equal(pixels[0], 0);
  assert.equal(paintMaskSegment(pixels, 20, 20, { x: NaN, y: 0 }, { x: 2, y: 3 }, brush()), null);
  paintMaskSegment(pixels, 20, 20, { x: 1, y: 1 }, { x: 1, y: 1 }, brush('restore', 1)); assert.equal(pixels[21], 255);
});
test('撤销重做以笔画为单位；新笔画分叉丢弃旧重做，历史有内存上限', () => {
  const doc = new MaskDocument(new Uint8ClampedArray(10), 30);
  const stroke = (index, value) => { doc.pixels[index] = value; doc.markChanged(); doc.commitStroke(); };
  assert.equal(doc.dirty, false); stroke(0, 255); stroke(1, 255);
  assert.equal(doc.undo(), true); assert.equal(doc.pixels[1], 0); assert.equal(doc.redo(), true);
  doc.undo(); stroke(2, 255); assert.equal(doc.canRedo, false); assert.equal(doc.pixels[1], 0);
  stroke(3, 255); stroke(4, 255); assert.equal(doc.capacity, 3);
  assert.equal(doc.undo(), true); assert.equal(doc.undo(), true); assert.equal(doc.undo(), false);
  assert.equal(doc.dirty, true);
  const clean = new MaskDocument(new Uint8ClampedArray(10)); clean.pixels[0] = 255; clean.markChanged(); clean.undo(); assert.equal(clean.dirty, false); assert.equal(clean.canRedo, true);
});
