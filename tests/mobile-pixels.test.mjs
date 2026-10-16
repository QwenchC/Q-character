import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMask, alphaMask, shapeImage, summary } from '../src/mobile/pixels.ts';
const image = (pixels) => ({ width: 2, height: 2, data: new Uint8ClampedArray(pixels.flat()) });
test('手机蒙版保留浅色衣服原始 RGB，并保留原有半透明边缘', () => {
  const source = image([[250,250,250,255],[80,40,20,128],[0,150,0,255],[255,0,255,0]]);
  const mask = image([[255,255,255,255],[128,128,128,255],[0,0,0,255],[255,255,255,255]]);
  const auto = applyMask(source, mask), manual = applyMask(source, mask, true);
  assert.deepEqual([...auto.data.slice(0,4)],[250,250,250,255]);
  assert.equal(auto.data[7],64);assert.equal(manual.data[7],128);
  assert.equal(manual.data[11],0);assert.equal(manual.data[15],0);
  assert.equal(source.data[11],255);
  assert.deepEqual([...alphaMask(source).data.slice(4,8)],[128,128,128,255]);
});
test('手机蒙版拒绝非灰阶蒙版、空前景和全不透明结果', () => {
  const source=image(Array(4).fill([255,255,255,255]));
  assert.throws(()=>applyMask(source,image(Array(4).fill([255,0,0,255])),true),/黑白蒙版/);
  assert.throws(()=>applyMask(source,image(Array(4).fill([0,0,0,255]))),/前景/);
  assert.throws(()=>applyMask(source,source),/前景/);
  assert.throws(()=>applyMask(source,{...source,width:1}),/尺寸/);
});
test('3D 输入裁切居中合成白底，不把透明背景 RGB 带入模型', () => {
  const source=image([[255,0,255,0],[250,250,250,255],[80,40,20,128],[255,0,255,0]]);
  const result=shapeImage(source);
  assert.equal(result.width,result.height);assert.ok(result.width>=3);
  for(let i=0;i<result.data.length;i+=4){assert.equal(result.data[i+3],255);assert.notDeepEqual([...result.data.slice(i,i+3)],[255,0,255]);}
  assert.equal(summary(result).hasTransparency,false);
  assert.throws(()=>shapeImage(image(Array(4).fill([255,255,255,255]))),/抠图/);
});
