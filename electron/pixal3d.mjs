// Browser-compatible workflow shared by Windows and Android.
export const PIXAL_DEFAULTS = Object.freeze({
  shapeEngine: 'pixal3d',
  pixalModel: 'pixal3d_int8_convrot.safetensors',
  pixalEncoder: 'dino_v3_L_naf_fp32.safetensors',
  pixalShapeVae: 'trellis_2_shape_vae_bf16.safetensors',
  pixalTextureVae: 'trellis_2_texture_vae_bf16.safetensors',
});
const node = (class_type, inputs) => ({ class_type, inputs });
const options = (info, type, name) => {
  const spec = info[type]?.input?.required?.[name];
  return Array.isArray(spec?.[0]) ? spec[0] : spec?.[1]?.options ?? [];
};
export function buildPixal3DWorkflow({ image, seed, quality = 'standard', ...settings }) {
  if (!image) throw new Error('请先检查人物透明抠图，再生成 Pixal3D 模型。');
  if (!['draft', 'standard', 'high'].includes(quality)) throw new Error('无效的 Pixal3D 精度。');
  const config = { ...PIXAL_DEFAULTS, ...settings };
  for (const key of ['pixalModel', 'pixalEncoder', 'pixalShapeVae', 'pixalTextureVae']) if (!config[key]) throw new Error('请在设置中选择完整的 Pixal3D 模型与编码器。');
  if (/multiview/i.test(config.pixalModel)) throw new Error('当前单图流程不能使用多视图 Pixal3D 权重。');
  const size = quality === 'high' ? 4096 : 2048;
  const sample = (model, stage, steps, cfg, scheduler = 'normal') => node('KSampler', { model, positive: [stage, 0], negative: [stage, 1], latent_image: [stage, 2], seed, steps, cfg, sampler_name: 'euler', scheduler, denoise: 1 });
  const graph = {
    '1': node('LoadImage', { image }),
    '2': node('InvertMask', { mask: ['1', 1] }),
    '3': node('ImageCropToMask', { images: ['1', 0], masks: ['2', 0], width: 1024, height: 1024, pad_factor: 1.1, grow_mask: 0, background: '#000000' }),
    '4': node('UNETLoader', { unet_name: config.pixalModel, weight_dtype: 'default' }),
    '5': node('CLIPVisionLoader', { clip_name: config.pixalEncoder }),
    '6': node('Pixal3DConditioning', { clip_vision_model: ['5', 0], image: ['3', 0], camera_angle_x: 49.13 }),
    '7': node('VAELoader', { vae_name: config.pixalShapeVae }),
    '8': node('VAELoader', { vae_name: config.pixalTextureVae }),
    '9': node('CFGOverride', { model: ['4', 0], cfg: 1, start_percent: 0.667, end_percent: 1 }),
    '10': node('RescaleCFG', { model: ['9', 0], multiplier: 0.7 }),
    '11': node('ModelSamplingSD3', { model: ['10', 0], shift: 5 }),
    '12': node('EmptyTrellis2LatentStructure', { batch_size: 1 }),
    '13': node('KSampler', { model: ['11', 0], positive: ['6', 0], negative: ['6', 1], latent_image: ['12', 0], seed, steps: 12, cfg: 7.5, sampler_name: 'euler', scheduler: 'normal', denoise: 1 }),
    '14': node('VaeDecodeStructureTrellis2', { samples: ['13', 0], vae: ['7', 0], resolution: '32' }),
    '15': node('Trellis2ShapeStage', { positive: ['6', 0], negative: ['6', 1], voxel: ['14', 0] }),
    '16': node('CFGOverride', { model: ['4', 0], cfg: 1, start_percent: 0.769, end_percent: 1 }),
    '17': node('RescaleCFG', { model: ['16', 0], multiplier: 0.5 }),
    '18': sample(['17', 0], '15', 20, 7.5),
  };
  let stage = '15', latent = '18';
  if (quality !== 'draft') {
    graph['19'] = node('Trellis2UpsampleStage', { positive: ['15', 0], negative: ['15', 1], shape_latent: ['18', 0], vae: ['7', 0], target_resolution: quality === 'high' ? 1536 : 1024 });
    graph['20'] = sample(['17', 0], '19', 12, 7.5, 'simple');
    stage = '19'; latent = '20';
  }
  Object.assign(graph, {
    '21': node('VaeDecodeShapeTrellis', { samples: [latent, 0], vae: ['7', 0] }),
    '22': node('Trellis2TextureStage', { positive: [stage, 0], negative: [stage, 1], shape_latent: [latent, 0] }),
    '23': sample(['4', 0], '22', 12, 1),
    '24': node('VaeDecodeTextureTrellis', { samples: ['23', 0], vae: ['8', 0], shape_subdivides: ['21', 1] }),
    '32': node('RemeshMesh', { mesh: ['21', 0], resolution: quality === 'draft' ? 256 : quality === 'high' ? 640 : 512, sign_mode: 'udf', 'sign_mode.qef': false, 'sign_mode.drop_inverted_components': true, 'sign_mode.drop_enclosed_components': false, band: 1, project_back: 0, fix_poles: true, smooth_iters: 3, drop_small_components: 0.001, precluster_max_verts: 20000000 }),
    '25': node('DecimateMesh', { mesh: ['32', 0], target_face_count: quality === 'draft' ? 100000 : quality === 'high' ? 300000 : 200000, placement_mode: 'midpoint' }),
    '26': node('MeshSmoothNormals', { mesh: ['25', 0], crease_angle: 180 }),
    '27': node('UnwrapMesh', { mesh: ['26', 0], segmenter: 'pec', resolution: size, padding: 2, weld_distance: 0.0002 }),
    '28': node('BakeTextureFromVoxel', { mesh: ['27', 0], voxel_colors: ['24', 0], texture_size: size, reference_mesh: ['21', 0] }),
    '29': node('BakeNormalMapFromMesh', { low_poly: ['27', 0], high_poly: ['32', 0], resolution: size, cage_distance: 0.05, ignore_backfaces: true }),
    '30': node('ApplyTextureToMesh', { mesh: ['27', 0], base_color: ['28', 0], metallic: ['28', 1], roughness: ['28', 2], normal_map: ['29', 0] }),
    '31': node('SaveGLB', { mesh: ['30', 0], filename_prefix: 'QCharacter/pixal3d' }),
  });
  return graph;
}
export const PIXAL_REQUIRED_NODES = [...new Set(Object.values(buildPixal3DWorkflow({ image: 'check.png', seed: 0 })).map(n => n.class_type))];
export function pixalCapabilities(info) {
  return {
    models: options(info, 'UNETLoader', 'unet_name').filter(n => /^pixal3d_.*\.safetensors$/i.test(n) && !/multiview/i.test(n)),
    encoders: options(info, 'CLIPVisionLoader', 'clip_name').filter(n => /^dino_v3_L_naf_.*\.safetensors$/i.test(n)),
    shapeVaes: options(info, 'VAELoader', 'vae_name').filter(n => /^trellis_2_shape_vae_.*\.safetensors$/i.test(n)),
    textureVaes: options(info, 'VAELoader', 'vae_name').filter(n => /^trellis_2_texture_vae_.*\.safetensors$/i.test(n)),
    missingNodes: PIXAL_REQUIRED_NODES.filter(n => !info[n]),
  };
}
