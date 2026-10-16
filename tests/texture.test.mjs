import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PNG } from 'pngjs';
import { normalizeClayGuide, normalizeTextureConfig, validateTexturedGlb } from '../electron/texture.mjs';

function fixture() {
  const png = new PNG({ width: 2, height: 2 }); png.data.fill(255); const image = PNG.sync.write(png);
  const json = { asset: { version: '2.0' }, buffers: [{ byteLength: image.length }], bufferViews: [{ buffer: 0, byteLength: image.length }], images: [{ bufferView: 0, mimeType: 'image/png' }], textures: [{ source: 0 }], materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }], accessors: [{}, {}], meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }] };
  return { json, image };
}
function glb(json, image) { const jsonBytes = Buffer.from(JSON.stringify(json)); const j = Buffer.alloc(Math.ceil(jsonBytes.length / 4) * 4, 32); jsonBytes.copy(j); const bin = Buffer.alloc(Math.ceil(image.length / 4) * 4); image.copy(bin); const bytes = Buffer.alloc(28 + j.length + bin.length); bytes.write('glTF'); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8); bytes.writeUInt32LE(j.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); j.copy(bytes, 20); bytes.writeUInt32LE(bin.length, 20 + j.length); bytes.writeUInt32LE(0x004e4942, 24 + j.length); bin.copy(bytes, 28 + j.length); return bytes; }
test('带贴图 GLB 要求 UV、颜色材质和内嵌图片，拒绝缺失贴图、外链和截断文件', async () => {
  const { json, image } = fixture(); const bytes = glb(json, image); assert.equal(validateTexturedGlb(bytes).textures, 1);
  assert.throws(() => validateTexturedGlb(bytes.subarray(0, bytes.length - 1)), /有效/);
  json.images[0].uri = 'https://example.org/image.png'; assert.throws(() => validateTexturedGlb(glb(json, image)), /外部/); delete json.images[0].uri;
  delete json.meshes[0].primitives[0].attributes.TEXCOORD_0; assert.throws(() => validateTexturedGlb(glb(json, image)), /UV/);
  const plain = await fs.readFile('examples/model.glb'); assert.throws(() => validateTexturedGlb(plain), /UV/);
});
test('配色和投影配置限制格式、数量与合理范围，不接受任意原始对象', () => {
  const guide = { referenceId: 'abc', swatches: [{ name: '衣服', original: '#338844', target: '#2244BB', share: 0.5 }], bases: Array.from({ length: 6 }, () => ({ name: '白', hex: '#ffffff' })) };
  assert.equal(normalizeClayGuide(guide).swatches[0].target, '#2244bb');
  assert.equal(normalizeClayGuide({...guide, grams:7.5}).grams,7.5);
  assert.throws(()=>normalizeClayGuide({...guide, grams:100}),/试配量/);
  assert.throws(() => normalizeClayGuide({ ...guide, bases: [] }), /无效/);
  assert.throws(() => normalizeTextureConfig({ ...guide, projection: { turn: 20, scale: 1, offsetX: 0, offsetY: 0 } }), /对齐/);
  assert.equal(normalizeTextureConfig({ ...guide, projection: { turn: 90, scale: 1, offsetX: 0, offsetY: 0 } }).projection.turn, 90);
});
