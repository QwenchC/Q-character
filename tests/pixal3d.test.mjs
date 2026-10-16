import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPixal3DWorkflow, pixalCapabilities, PIXAL_DEFAULTS, PIXAL_REQUIRED_NODES } from '../electron/pixal3d.mjs';

test('Pixal3D uses corrected alpha directly and bakes generated PBR textures on the final UV mesh', () => {
  const g = buildPixal3DWorkflow({ image: 'manual.png', seed: 42 });
  assert.equal(g['1'].inputs.image, 'manual.png');
  assert.deepEqual(g['2'].inputs.mask, ['1', 1]);
  assert.deepEqual(g['3'].inputs.masks, ['2', 0]);
  assert.equal(g['3'].inputs.grow_mask, 0);
  assert.equal(Object.values(g).some(n => /RemoveBackground|BiRefNet/.test(n.class_type)), false);
  assert.deepEqual(g['22'].inputs.shape_latent, ['20', 0]);
  assert.deepEqual(g['24'].inputs.shape_subdivides, ['21', 1]);
  assert.deepEqual(g['28'].inputs.mesh, g['30'].inputs.mesh);
  assert.deepEqual(g['28'].inputs.reference_mesh, ['21', 0]);
  assert.deepEqual(g['25'].inputs.mesh, ['32', 0]);
  assert.equal(g['32'].inputs.smooth_iters, 3);
  assert.equal(g['32'].inputs['sign_mode.drop_inverted_components'], true);
  assert.deepEqual(g['29'].inputs.high_poly, ['32', 0]);
  assert.deepEqual(g['30'].inputs.base_color, ['28', 0]);
  assert.deepEqual(g['30'].inputs.metallic, ['28', 1]);
  assert.deepEqual(g['30'].inputs.roughness, ['28', 2]);
  assert.deepEqual(g['30'].inputs.normal_map, ['29', 0]);
  assert.deepEqual(g['31'].inputs.mesh, ['30', 0]);
});
test('quality presets keep structure, shape and texture stages connected with bounded outputs', () => {
  for (const quality of ['draft', 'standard', 'high']) {
    const g = buildPixal3DWorkflow({ image: 'a.png', seed: 1, quality });
    assert.equal(g['19']?.inputs.target_resolution, quality === 'draft' ? undefined : quality === 'high' ? 1536 : 1024);
    assert.deepEqual(g['21'].inputs.samples, [quality === 'draft' ? '18' : '20', 0]);
    assert.equal(g['27'].inputs.resolution, g['28'].inputs.texture_size);
    assert.equal(g['29'].inputs.resolution, g['28'].inputs.texture_size);
    for (const n of Object.values(g)) for (const value of Object.values(n.inputs)) if (Array.isArray(value)) assert.ok(g[value[0]], `Missing ${value[0]}`);
  }
  assert.throws(() => buildPixal3DWorkflow({ image: '', seed: 1 }), /透明抠图/);
  assert.throws(() => buildPixal3DWorkflow({ image: 'x', seed: 1, quality: 'huge' }), /精度/);
  assert.throws(() => buildPixal3DWorkflow({ image: 'x', seed: 1, pixalModel: 'pixal3d_multiview_bf16.safetensors' }), /多视图/);
});
test('capability discovery handles old and new model combos and excludes incompatible multiview models', () => {
  const info = Object.fromEntries(PIXAL_REQUIRED_NODES.map(n => [n, { input: { required: {} } }]));
  info.UNETLoader.input.required.unet_name = ['COMBO', { options: [PIXAL_DEFAULTS.pixalModel, 'pixal3d_multiview_bf16.safetensors'] }];
  info.CLIPVisionLoader.input.required.clip_name = [[PIXAL_DEFAULTS.pixalEncoder]];
  info.VAELoader.input.required.vae_name = [[PIXAL_DEFAULTS.pixalShapeVae, PIXAL_DEFAULTS.pixalTextureVae]];
  assert.deepEqual(pixalCapabilities(info).models, [PIXAL_DEFAULTS.pixalModel]);
  assert.deepEqual(pixalCapabilities(info).missingNodes, []);
  delete info.BakeTextureFromVoxel;
  assert.deepEqual(pixalCapabilities(info).missingNodes, ['BakeTextureFromVoxel']);
  assert.deepEqual(pixalCapabilities({}).encoders, []);
});
