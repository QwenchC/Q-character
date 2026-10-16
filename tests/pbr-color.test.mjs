import test from 'node:test';
import assert from 'node:assert/strict';
import { recolorPixels } from '../src/texture-image.ts';
import { originalPbrModel } from '../src/pbr-model.ts';

test('AI texture recoloring preserves alpha and shading; unchanged colors preserve bytes', () => {
  const original = new Uint8ClampedArray([55, 130, 65, 255, 45, 120, 55, 128, 255, 1, 255, 0]);
  const palette = [{ id: 'dress', name: '服装', original: '#378241', target: '#378241', share: 1 }];
  const identity = original.slice(); recolorPixels(identity, palette); assert.deepEqual(identity, original);
  const changed = original.slice(); recolorPixels(changed, [{ ...palette[0], target: '#3264c8' }]);
  assert.deepEqual([...changed], [50, 100, 200, 255, 40, 90, 190, 128, 255, 1, 255, 0]);
  assert.deepEqual(original, new Uint8ClampedArray([55, 130, 65, 255, 45, 120, 55, 128, 255, 1, 255, 0]));
});
test('successive palette edits always resolve the immutable original AI model; broken chains fail visibly', () => {
  const model = { id: 'original', kind: 'model', textureMethod: 'pixal3d-pbr' };
  const a = { id: 'blue', kind: 'model', parentModelId: 'original', textureMethod: 'pixal3d-pbr-recolor' };
  const b = { id: 'red', kind: 'model', parentModelId: 'blue', textureMethod: 'pixal3d-pbr-recolor' };
  assert.equal(originalPbrModel([model, a, b], b), model);
  assert.equal(originalPbrModel([model], model), model);
  assert.equal(originalPbrModel([], { textureMethod: 'reference-projection' }), undefined);
  assert.throws(() => originalPbrModel([a, b], b), /同步完整作品/);
  assert.throws(() => originalPbrModel([{ ...a, parentModelId: 'red' }, b], b), /关联损坏/);
});
