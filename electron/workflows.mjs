export const NEGATIVE = 'photorealistic, realistic human proportions, multiple people, multiple views, collage, cropped, out of frame, text, watermark, complex background, thin fingers, extra limbs, deformed hands';

export function designPrompt(description, ratio = '2.5', style = 'clay') {
  const surface = style === 'anime' ? 'anime collectible figurine, clean shapes, soft pastel colors' : 'handmade ultralight clay figurine, soft matte clay, rounded simplified shapes';
  return `chibi character, ${ratio} heads tall, oversized head, small body, ${surface}, single character, full body, front view, relaxed standing pose, both feet visible, arms slightly away from body, isolated on pure white background, even studio lighting, clear silhouette, no cast shadow. ${description}`;
}

const node = (class_type, inputs) => ({ class_type, inputs });

export function qwenEditPrompt(description = '', ratio = '2.5', style = 'clay') {
  const appearance = style === 'anime' ? '动漫收藏手办，轮廓清晰，色块简洁' : '超轻黏土手作手办，圆润体块，柔和哑光质感';
  return `将参考图片中的同一个人物改造成 ${ratio} 头身的 Q 版全身角色。以参考图为身份依据，保留人物的脸型轮廓、五官关系、发型、发色和肤色，服装保持原有颜色、款式与层次。仅保留原图中实际存在的配饰；除用户明确要求外，原图没有的眼镜、帽子或其他配饰全部省略。只改变为大头小身体的 Q 版比例和${appearance}风格。单人，全身完整入镜，正面自然站姿，脸朝正前方，双脚可见，手臂略离开身体，适合制作黏土手办。使用纯白背景，均匀柔和照明，无地面投影，不添加文字或第二个人。${description ? `用户补充要求：${description}` : ''}`;
}

export function buildQwenEditWorkflow({ model, encoder, vae, image, description, ratio, style, seed, steps = 25, resolution = 768 }) {
  if (!model || !encoder || !vae || !image) throw new Error('Qwen 编辑需要参考图片、2.1 编辑模型、视觉编码器和配套 VAE。');
  if (!/^qwen_image_2\.1_(bf16|int8_convrot)\.safetensors$/i.test(model) || !/^qwen3vl_8b_(bf16|fp8_scaled|int8_convrot)\.safetensors$/i.test(encoder) || vae !== 'qwen_image_2.1_vae_bf16.safetensors') throw new Error('请选择配套的 Qwen-Image 2.1 模型、qwen3vl_8b 编码器和 2.1 VAE；提示词增强器不能替代视觉编码器。');
  return {
    '1': node('UNETLoader', { unet_name: model, weight_dtype: 'default' }),
    '2': node('CLIPLoader', { clip_name: encoder, type: 'qwen_image', device: 'default' }),
    '3': node('VAELoader', { vae_name: vae }),
    '4': node('LoadImage', { image }),
    '5': node('TextEncodeQwenImage21', { clip: ['2', 0], vae: ['3', 0], prompt: qwenEditPrompt(description, ratio, style), negative_prompt: '', resolution, 'images.image_1': ['4', 0] }),
    '6': node('KSampler', { model: ['1', 0], positive: ['5', 0], negative: ['5', 1], latent_image: ['5', 2], seed, steps, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }),
    '7': node('VAEDecode', { samples: ['6', 0], vae: ['3', 0] }),
    '8': node('SaveImage', { images: ['7', 0], filename_prefix: 'QCharacter/qwen-edit' }),
  };
}

export function buildMatteWorkflow({ image, model }) {
  if (!image || !model) throw new Error('自动抠图需要图片与 BiRefNet 模型。');
  return {
    '1': node('LoadImage', { image }),
    '2': node('LoadBackgroundRemovalModel', { bg_removal_name: model }),
    '3': node('RemoveBackground', { bg_removal_model: ['2', 0], image: ['1', 0] }),
    '4': node('MaskToImage', { mask: ['3', 0] }),
    '5': node('SaveImage', { images: ['4', 0], filename_prefix: 'QCharacter/masks' }),
  };
}

export function buildDesignWorkflow({ checkpoint, description, ratio, style, seed, steps = 28, image, denoise = 0.65 }) {
  if (!checkpoint) throw new Error('请选择 SDXL 设计图模型。');
  const graph = {
    '1': node('CheckpointLoaderSimple', { ckpt_name: checkpoint }),
    '2': node('CLIPTextEncode', { clip: ['1', 1], text: designPrompt(description, ratio, style) }),
    '3': node('CLIPTextEncode', { clip: ['1', 1], text: NEGATIVE }),
    '4': node('EmptyLatentImage', { width: 768, height: 1024, batch_size: 1 }),
    '5': node('KSampler', { model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0], seed, steps, cfg: 6, sampler_name: 'euler', scheduler: 'normal', denoise: image ? denoise : 1 }),
    '6': node('VAEDecode', { samples: ['5', 0], vae: ['1', 2] }),
    '7': node('SaveImage', { images: ['6', 0], filename_prefix: 'QCharacter/design' }),
  };
  if (image) {
    delete graph['4'];
    graph['8'] = node('LoadImage', { image });
    graph['9'] = node('ImageScale', { image: ['8', 0], upscale_method: 'lanczos', width: 768, height: 1024, crop: 'disabled' });
    graph['10'] = node('VAEEncode', { pixels: ['9', 0], vae: ['1', 2] });
    graph['5'].inputs.latent_image = ['10', 0];
  }
  return graph;
}

export function buildShapeWorkflow({ checkpoint, image, seed, quality = 'standard' }) {
  if (!checkpoint || !image) throw new Error('请选择混元 3D 模型和角色设计图。');
  return {
    '1': node('ImageOnlyCheckpointLoader', { ckpt_name: checkpoint }),
    '2': node('LoadImage', { image }),
    '3': node('CLIPVisionEncode', { clip_vision: ['1', 1], image: ['2', 0], crop: 'none' }),
    '4': node('Hunyuan3Dv2Conditioning', { clip_vision_output: ['3', 0] }),
    '5': node('EmptyLatentHunyuan3Dv2', { resolution: 3072, batch_size: 1 }),
    '6': node('ModelSamplingAuraFlow', { model: ['1', 0], shift: 1 }),
    '7': node('KSampler', { model: ['6', 0], positive: ['4', 0], negative: ['4', 1], latent_image: ['5', 0], seed, steps: quality === 'draft' ? 12 : 30, cfg: 5, sampler_name: 'euler', scheduler: 'normal', denoise: 1 }),
    '8': node('VAEDecodeHunyuan3D', { samples: ['7', 0], vae: ['1', 2], num_chunks: 8000, octree_resolution: quality === 'draft' ? 128 : 256 }),
    '9': node('VoxelToMesh', { voxel: ['8', 0], algorithm: 'surface net', threshold: 0.6 }),
    '10': node('SaveGLB', { mesh: ['9', 0], filename_prefix: 'QCharacter/mesh' }),
  };
}

export function validateWorkflow(graph, info) {
  const missing = [...new Set(Object.values(graph).map(n => n.class_type))].filter(name => !info[name]);
  if (missing.length) throw new Error(`ComfyUI 缺少节点：${missing.join('、')}`);
  for (const item of Object.values(graph)) {
    const required = info[item.class_type].input?.required ?? {};
    for (const [name, spec] of Object.entries(required)) {
      if (!(name in item.inputs)) {
        if (name === 'images' && Object.keys(item.inputs).some(key => key.startsWith('images.'))) continue;
        throw new Error(`${item.class_type} 缺少输入 ${name}`);
      }
      const value = item.inputs[name];
      if (Array.isArray(value)) continue;
      if (Array.isArray(spec[0]) && !spec[1]?.image_upload && !spec[0].includes(value)) throw new Error(`${item.class_type} 的 ${name} 不可用：${value}`);
      if (spec[0] === 'COMBO' && Array.isArray(spec[1]?.options) && !spec[1].options.includes(value)) throw new Error(`${item.class_type} 的 ${name} 不可用：${value}`);
    }
  }
}

export function collectOutputs(entry, kind) {
  const key = kind === 'shape' ? '3d' : 'images';
  return Object.values(entry.outputs ?? {}).flatMap(output => output[key] ?? [])
    .filter(item => item.type === 'output' && typeof item.filename === 'string' &&
      (kind === 'shape' ? /\.glb$/i.test(item.filename) : /\.(png|jpe?g|webp)$/i.test(item.filename)));
}
