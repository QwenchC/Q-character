import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDesignWorkflow, buildShapeWorkflow, buildQwenEditWorkflow, buildMatteWorkflow, qwenEditPrompt, validateWorkflow, collectOutputs, designPrompt } from '../electron/workflows.mjs';

test('文字设计和图片重绘分别连接正确的 latent 输入', () => {
  const text = buildDesignWorkflow({ checkpoint: 'sdxl.safetensors', description: 'a wizard', seed: 42 });
  assert.equal(text['5'].inputs.denoise, 1);
  assert.deepEqual(text['5'].inputs.latent_image, ['4', 0]);
  const image = buildDesignWorkflow({ checkpoint: 'sdxl.safetensors', description: 'a wizard', seed: 42, image: 'uploaded.png', denoise: 0.55 });
  assert.equal(image['5'].inputs.denoise, 0.55);
  assert.deepEqual(image['5'].inputs.latent_image, ['10', 0]);
  assert.deepEqual(image['10'].inputs.pixels, ['9', 0]);
  assert.equal(image['4'], undefined);
});
test('3D 必须有图片，快速草模降低采样步数和体素分辨率', () => {
  assert.throws(() => buildShapeWorkflow({ checkpoint: '3d.safetensors', seed: 1 }), /设计图/);
  const graph = buildShapeWorkflow({ checkpoint: '3d.safetensors', seed: 1, image: 'chibi.png', quality: 'draft' });
  assert.equal(graph['7'].inputs.steps, 12);
  assert.equal(graph['8'].inputs.octree_resolution, 128);
  assert.equal(graph['10'].class_type, 'SaveGLB');
});
test('提交前拒绝缺少节点、缺少必填参数以及不存在的模型', () => {
  const graph = { '1': { class_type: 'Loader', inputs: { ckpt_name: 'missing' } } };
  assert.throws(() => validateWorkflow(graph, {}), /缺少节点/);
  assert.throws(() => validateWorkflow(graph, { Loader: { input: { required: { ckpt_name: [['present']] } } } }), /不可用/);
  assert.throws(() => validateWorkflow({ '1': { class_type: 'Loader', inputs: {} } }, { Loader: { input: { required: { ckpt_name: [['present']] } } } }), /缺少输入/);
});
test('仅下载正确类型的正式输出，不误取临时预览或未知文件', () => {
  const entry = { outputs: { a: { images: [{ filename: 'a.png', type: 'temp' }, { filename: 'b.png', type: 'output' }] }, b: { '3d': [{ filename: 'mesh.glb', type: 'output' }, { filename: 'bad.html', type: 'output' }] } } };
  assert.deepEqual(collectOutputs(entry, 'shape'), [{ filename: 'mesh.glb', type: 'output' }]);
  assert.deepEqual(collectOutputs(entry, 'design'), [{ filename: 'b.png', type: 'output' }]);
});
test('风格与头身比例进入设计提示词，原始描述保留', () => {
  const text = designPrompt('green hair', '2', 'anime');
  assert.match(text, /2 heads tall/); assert.match(text, /anime collectible/); assert.match(text, /green hair/);
});
test('上传图片允许使用能力快照之后新增的文件名', () => {
  const graph = { '1': { class_type: 'LoadImage', inputs: { image: 'just-uploaded.png' } } };
  assert.doesNotThrow(() => validateWorkflow(graph, { LoadImage: { input: { required: { image: [['old.png'], { image_upload: true }] } } } }));
});
test('Qwen 编辑同时使用视觉参考和 VAE 参考 latent，不用 SDXL 低强度重绘', () => {
  const graph = buildQwenEditWorkflow({ model: 'qwen_image_2.1_int8_convrot.safetensors', encoder: 'qwen3vl_8b_int8_convrot.safetensors', vae: 'qwen_image_2.1_vae_bf16.safetensors', image: 'person.png', seed: 42 });
  assert.equal(graph['5'].class_type, 'TextEncodeQwenImage21');
  assert.deepEqual(graph['5'].inputs['images.image_1'], ['4', 0]);
  assert.deepEqual(graph['5'].inputs.vae, ['3', 0]);
  assert.deepEqual(graph['6'].inputs.latent_image, ['5', 2]);
  assert.equal(graph['6'].inputs.denoise, 1); assert.equal(graph['6'].inputs.cfg, 1);
  assert.equal(graph['6'].inputs.scheduler, 'simple');
});
test('拒绝将提示词增强编码器、旧版 VAE 或文生图模型冒充配套编辑模型', () => {
  const options = { model: 'qwen_image_2.1_bf16.safetensors', encoder: 'qwen3vl_8b_bf16.safetensors', vae: 'qwen_image_2.1_vae_bf16.safetensors', image: 'person.png', seed: 1 };
  assert.throws(() => buildQwenEditWorkflow({ ...options, encoder: 'qwen3.5_9b_qwen_image_2.1_pe_i2i.int8_convrot.safetensors' }), /提示词增强器/);
  assert.throws(() => buildQwenEditWorkflow({ ...options, vae: 'qwen_image_vae.safetensors' }), /配套/);
  assert.throws(() => buildQwenEditWorkflow({ ...options, model: 'qwen_image_2512_fp8_e4m3fn.safetensors' }), /配套/);
  assert.match(qwenEditPrompt('保留红色围巾'), /原图中实际存在/);
});
test('语义抠图导出正向前景蒙版，使用新式 COMBO 模型枚举预检', () => {
  const graph = buildMatteWorkflow({ image: 'person.png', model: 'birefnet.safetensors' });
  assert.deepEqual(graph['4'].inputs.mask, ['3', 0]); assert.equal(graph['3'].class_type, 'RemoveBackground');
  assert.throws(() => validateWorkflow({ '2': graph['2'] }, { LoadBackgroundRemovalModel: { input: { required: { bg_removal_name: ['COMBO', { options: ['other.safetensors'] }] } } } }), /不可用/);
});
test('Qwen 自动增长图片输入能通过节点预检', () => {
  assert.doesNotThrow(() => validateWorkflow({ '1': { class_type: 'Qwen', inputs: { 'images.image_1': ['4', 0] } } }, { Qwen: { input: { required: { images: ['COMFY_AUTOGROW_V3', {}] } } } }));
});
