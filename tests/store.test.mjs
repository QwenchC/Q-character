import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectStore, safeAsset } from '../electron/store.mjs';

test('彩色模型保留父模型和参考图，配色和基础黏土设置并发保存后可重新读取', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qcharacter-color-'));
  try {
    const store = new ProjectStore(root), p = await store.create('上色测试');
    const initial = await store.addAsset(p.id, Buffer.from('geometry'), '.glb', 'model', '泥模'), parent = initial.assets.at(-1);
    const config = { swatches: [{ name: '服装', original: '#448855', target: '#3344bb' }], projection: { turn: 0, scale: 1, offsetX: 0, offsetY: 0 } };
    await Promise.all([store.saveFields(p.id, { clayGuide: { referenceId: 'cutout', swatches: config.swatches, bases: [{ name: '白色', hex: '#ffffff' }] } }), store.addAsset(p.id, Buffer.from('textured'), '.glb', 'model', '彩色模型', undefined, { parentModelId: parent.id, textureSourceId: 'cutout', textureMethod: 'reference-projection', textureConfig: config })]);
    const reopened = await new ProjectStore(root).read(p.id); assert.equal(reopened.clayGuide.swatches[0].target, '#3344bb');
    assert.equal(reopened.assets.at(-1).parentModelId, parent.id); assert.deepEqual(reopened.assets.at(-1).textureConfig, config);
    assert.equal(await fs.readFile(safeAsset(root, p.id, parent.filename), 'utf8'), 'geometry');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('蒙版修正保存为新版本，原图始终指向原始素材；并发保存和重启保留所有版本', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qcharacter-mask-'));
  try {
    const store = new ProjectStore(root), p = await store.create('修正测试');
    let next = await store.addAsset(p.id, Buffer.from('original-rgb'), '.png', 'design', '原图'); const source = next.assets.at(-1);
    next = await store.addAsset(p.id, Buffer.from('old-cutout'), '.png', 'cutout', '自动抠图', undefined, { sourceAssetId: source.id }); const parent = next.assets.at(-1);
    await Promise.all([store.saveFields(p.id, { name: '已改名' }), store.saveMaskRevision(p.id, parent.id, Buffer.from('mask1'), Buffer.from('cutout1'))]);
    next = await store.read(p.id); const revision = next.assets.at(-1);
    assert.equal(next.name, '已改名'); assert.equal(revision.sourceAssetId, source.id); assert.equal(revision.parentCutoutId, parent.id); assert.equal(revision.revisionType, 'manual');
    assert.equal(next.assets.find(asset => asset.id === revision.maskAssetId).kind, 'mask');
    next = await store.saveMaskRevision(p.id, revision.id, Buffer.from('mask2'), Buffer.from('cutout2'));
    assert.equal(next.assets.at(-1).sourceAssetId, source.id); assert.equal(next.assets.at(-1).parentCutoutId, revision.id);
    assert.equal(await fs.readFile(safeAsset(root, p.id, parent.filename), 'utf8'), 'old-cutout');
    assert.equal(await fs.readFile(safeAsset(root, p.id, source.filename), 'utf8'), 'original-rgb');
    const reopened = await new ProjectStore(root).read(p.id); assert.equal(reopened.assets.length, 6);
    await assert.rejects(store.saveMaskRevision(p.id, source.id, Buffer.from('x'), Buffer.from('x')), /原始图片/);
    assert.equal((await fs.readdir(path.join(root, p.id, 'assets'))).length, 6);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('作品素材路径拒绝路径穿越与无效作品编号', () => {
  const id = '11111111-2222-3333-4444-555555555555';
  assert.throws(() => safeAsset('/test', id, '../settings.json'));
  assert.throws(() => safeAsset('/test', id, '..'));
  assert.throws(() => safeAsset('/test', '../escape', 'a.glb'));
  assert.equal(safeAsset('/test', id, 'a.glb'), path.join('/test', id, 'assets', 'a.glb'));
});
test('并发保存字段、生成任务和素材不丢失记录；重启保留结果并标记中断任务', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qcharacter-test-'));
  try {
    const store = new ProjectStore(root); const project = await store.create('测试角色');
    await Promise.all([
      store.saveFields(project.id, { description: '绿色头发', heightMm: 80 }),
      store.saveJob(project.id, { id: 'job-1', status: 'running', promptId: 'owned-job' }),
      store.addAsset(project.id, Buffer.from('test-asset'), '.png', 'design', '设计图'),
    ]);
    let saved = await store.read(project.id);
    assert.equal(saved.description, '绿色头发'); assert.equal(saved.jobs.length, 1); assert.equal(saved.assets.length, 1);
    await store.recoverJobs(); saved = await store.read(project.id);
    assert.equal(saved.jobs[0].status, 'interrupted'); assert.equal(saved.jobs[0].promptId, 'owned-job');
    const reopened = new ProjectStore(root); assert.equal((await reopened.list())[0].name, '测试角色');
    assert.equal(await fs.readFile(safeAsset(root, project.id, saved.assets[0].filename), 'utf8'), 'test-asset');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
