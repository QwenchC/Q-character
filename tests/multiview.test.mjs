import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { normalizeMultiView, readyMultiView, prepareMultiViewImages, setViewSlot } from '../electron/multiview.mjs';
import { buildPixal3DWorkflow, pixalCapabilities } from '../electron/pixal3d.mjs';
import { buildQwenEditWorkflow } from '../electron/workflows.mjs';
import { ProjectStore } from '../electron/store.mjs';
import { validateManifest, mergeManifests } from '../electron/sync-protocol.mjs';

const assets = ['front', 'left', 'back', 'right'].map(id => ({ id, kind: 'cutout' }));
const config = { enabled: true, views: { front: 'front', left: 'left', back: 'back' }, fov: 20 };
test('view slots reject duplicate, dangling and model references; model generation requires checked front/side/back', () => {
  assert.deepEqual(readyMultiView({ assets, multiView: config }), config);
  assert.throws(() => normalizeMultiView({ ...config, views: { front: 'front', back: 'front' } }, assets), /同一张/);
  assert.throws(() => normalizeMultiView({ ...config, views: { front: 'absent' } }, assets), /缺少/);
  assert.throws(() => normalizeMultiView({ ...config, fov: NaN }, assets), /视角/);
  assert.throws(() => normalizeMultiView(config, assets.map(a => ({ ...a, kind: 'model' }))), /缺少/);
  assert.throws(() => readyMultiView({ assets, multiView: { ...config, views: { front: 'front', back: 'back' } } }), /侧面/);
  assert.throws(() => readyMultiView({ assets: assets.map(a => ({ ...a, kind: 'design' })), multiView: config }), /抠图/);
  assert.deepEqual(setViewSlot({ assets, multiView: config }, 'left', 'right', 'stale'), config);
});
const pixels = (width, height, left, top, w, h) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([255, 0, 255, 0], i);
  for (let y = top; y < top + h; y++) for (let x = left; x < left + w; x++) data.set([200, 180, 160, 255], (y * width + x) * 4);
  return { width, height, data };
};
test('different crops and margins become equal-height, aligned views; transparent background colors never leak', () => {
  const images = { front: pixels(60, 100, 15, 10, 30, 80), left: pixels(100, 120, 45, 20, 10, 80), back: pixels(60, 80, 20, 10, 20, 60) };
  const before = images.front.data.slice(), out = prepareMultiViewImages(images, 128), extents = [];
  for (const image of Object.values(out)) {
    let top = 128, bottom = -1;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) { const i = (y * 128 + x) * 4; assert.equal(image.data[i + 3], 255); if (image.data[i] > 100) { top = Math.min(top, y); bottom = Math.max(bottom, y); assert.ok(image.data[i + 1] > 80, 'transparent magenta must not enter the foreground'); } }
    extents.push([top, bottom]); assert.equal(image.data[0], 0);
    assert.ok(PNG.sync.write(image).length > 0);
  }
  assert.deepEqual(extents[0], extents[1]); assert.ok(Math.abs(extents[0][0] - extents[2][0]) <= 1); assert.deepEqual(images.front.data, before);
  const opaque = pixels(20, 20, 0, 0, 20, 20); assert.throws(() => prepareMultiViewImages({ front: opaque }), /透明蒙版/);
});
test('multiview graph uses dedicated weights and ordered camera inputs without recropping aligned views', () => {
  const g = buildPixal3DWorkflow({ views: { front: 'f.png', right: 'r.png', back: 'b.png' }, seed: 1, quality: 'draft', fov: 25 });
  assert.match(g['4'].inputs.unet_name, /multiview/); assert.equal(g['6'].class_type, 'Pixal3DMultiViewConditioning'); assert.equal(g['6'].inputs.fov, 25);
  assert.equal(g[g['6'].inputs.front[0]].inputs.image, 'f.png'); assert.equal(g[g['6'].inputs.back[0]].inputs.image, 'b.png'); assert.equal(g[g['6'].inputs.right[0]].inputs.image, 'r.png'); assert.equal(g['6'].inputs.left, undefined);
  assert.equal(Object.values(g).some(n => /CropToMask|RemoveBackground/.test(n.class_type)), false);
  assert.throws(() => buildPixal3DWorkflow({ views: { front: 'f', back: 'b' }, seed: 1 }), /侧面/);
  assert.throws(() => buildPixal3DWorkflow({ views: { front: 'f', back: 'b', left: 'l' }, seed: 1, pixalMultiModel: 'pixal3d_int8_convrot.safetensors' }), /专用/);
  const cap = pixalCapabilities({ UNETLoader: { input: { required: { unet_name: ['COMBO', { options: ['pixal3d_int8_convrot.safetensors', 'pixal3d_multiview_int8_convrot.safetensors'] }] } } } });
  assert.deepEqual(cap.models, ['pixal3d_int8_convrot.safetensors']); assert.deepEqual(cap.multiviewModels, ['pixal3d_multiview_int8_convrot.safetensors']); assert.ok(cap.missingMultiViewNodes.includes('Pixal3DMultiViewConditioning'));
});
test('Qwen view edits anchor to the front and confirmed views, with explicit profile/back instructions', () => {
  const base = { model: 'qwen_image_2.1_int8_convrot.safetensors', encoder: 'qwen3vl_8b_int8_convrot.safetensors', vae: 'qwen_image_2.1_vae_bf16.safetensors', image: 'front.png', references: ['left.png'], seed: 7 };
  const g = buildQwenEditWorkflow({ ...base, viewRole: 'back' });
  assert.match(g['5'].inputs.prompt, /180 度背面/); assert.doesNotMatch(g['5'].inputs.prompt, /脸朝正前方/); assert.deepEqual(g['5'].inputs['images.image_1'], ['4', 0]); assert.equal(g[g['5'].inputs['images.image_2'][0]].inputs.image, 'left.png');
  assert.match(buildQwenEditWorkflow({ ...base, viewRole: 'left' })['5'].inputs.prompt, /鼻尖朝画面左侧/);
  assert.match(buildQwenEditWorkflow({ ...base })['5'].inputs.prompt, /Q 版全身角色/);
});
test('slot edits serialize; completed jobs cannot overwrite a replaced slot; manual masks advance slot references', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qchar-views-')), store = new ProjectStore(root);
  try {
    let p = await store.create('Views');
    for (const role of ['front', 'left', 'back']) { p = await store.addAsset(p.id, await fs.readFile('examples/cutout.png'), '.png', 'cutout', role, undefined, { sourceAssetId: p.assets[0]?.id }); await store.setView(p.id, role, p.assets.at(-1).id); }
    p = await store.read(p.id); assert.equal(Object.keys(p.multiView.views).length, 3);
    const old = p.multiView.views.left; p = await store.addAsset(p.id, Buffer.from([1]), '.png', 'design', 'replacement'); const replacement = p.assets.at(-1).id;
    await store.setView(p.id, 'left', replacement); await store.setView(p.id, 'left', old, old); assert.equal((await store.read(p.id)).multiView.views.left, replacement);
    const parent = p.multiView.views.back, revised = await store.saveMaskRevision(p.id, parent, await fs.readFile('examples/mask.png'), await fs.readFile('examples/cutout.png'));
    assert.equal(revised.multiView.views.back, revised.assets.at(-1).id); assert.ok(revised.assets.some(a => a.id === parent));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('sync preserves view selections and model provenance; dangling references and concurrent conflicting choices are rejected or copied', () => {
  const id = randomUUID(), now = new Date().toISOString(); const aa = assets.slice(0, 3).map(a => ({ ...a, id: randomUUID(), filename: randomUUID()+'.png', createdAt: now }));
  const views = { front: aa[0].id, left: aa[1].id, back: aa[2].id };
  const m = { protocol: 1, project: { id, name: 'Views', description: '', ratio: '2.5', style: 'clay', heightMm: 80, createdAt: now, updatedAt: now, assets: aa, jobs: [], multiView: { ...config, views } }, files: aa.map(a => ({ assetId: a.id, filename: a.filename, size: 10, sha256: createHash('sha256').update(a.id).digest('hex') })) };
  validateManifest(m); const local = structuredClone(m), remote = structuredClone(m); local.project.multiView.fov = 25; remote.project.heightMm = 90;
  const merged = mergeManifests(m, local, remote); assert.deepEqual(merged.conflicts, []); assert.equal(merged.manifest.project.multiView.fov, 25); assert.equal(merged.manifest.project.heightMm, 90);
  remote.project.multiView.fov = 30; assert.ok(mergeManifests(m, local, remote).conflicts.includes('multiView'));
  const broken = structuredClone(m); broken.project.multiView.views.back = randomUUID(); assert.throws(() => validateManifest(broken), /缺少/);
  const model = { id: randomUUID(), filename: randomUUID()+'.glb', kind: 'model', createdAt: now, inputViewIds: views, viewFov: 20 }; m.project.assets.push(model); m.files.push({ assetId: model.id, filename: model.filename, size: 10, sha256: '1'.repeat(64) }); validateManifest(m); model.inputViewIds = { ...views, back: randomUUID() }; assert.throws(() => validateManifest(m), /缺少/);
});
