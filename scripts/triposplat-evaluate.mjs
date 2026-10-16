import fs from 'node:fs/promises';
import path from 'node:path';
import { ComfyClient } from '../electron/comfy.mjs';
import { validateWorkflow } from '../electron/workflows.mjs';

// Reuses installed weights. Outputs are kept separate from application projects.
const client = new ComfyClient(process.env.QCHARACTER_TEST_SERVER || 'http://127.0.0.1:8188');
const smooth = process.argv.includes('--smooth');
const output = path.resolve('.runtime/triposplat-evaluation');
await fs.mkdir(output, { recursive: true });
const { info } = await client.capabilities();
const image = await client.upload(await fs.readFile('examples/cutout.png'), 'cutout.png');
const node = (class_type, inputs) => ({ class_type, inputs });
const graph = {
  '1': node('LoadImage', { image }),
  '2': node('InvertMask', { mask: ['1', 1] }),
  '3': node('TripoSplatPreprocessImage', { image: ['1', 0], mask: ['2', 0], erode_radius: 0, size: 1024 }),
  '4': node('UNETLoader', { unet_name: 'triposplat_fp16.safetensors', weight_dtype: 'default' }),
  '5': node('CLIPVisionLoader', { clip_name: 'dino_v3_vit_h.safetensors' }),
  '6': node('VAELoader', { vae_name: 'flux2-vae.safetensors' }),
  '7': node('TripoSplatConditioning', { clip_vision: ['5', 0], vae: ['6', 0], image: ['3', 0] }),
  '8': node('KSampler', { model: ['4', 0], positive: ['7', 0], negative: ['7', 1], latent_image: ['7', 2], seed: 123456, steps: 40, cfg: 3, sampler_name: 'dpmpp_2m', scheduler: 'simple', denoise: 1 }),
  '9': node('VAELoader', { vae_name: 'triposplat_vae_decoder_fp16.safetensors' }),
  '10': node('VAEDecodeTripoSplat', { samples: ['8', 0], vae: ['9', 0], num_gaussians: 262144, seed: 123456 }),
  '11': node('SplatToMesh', { splat: ['10', 0], resolution: 384, kernel: 5, smooth: smooth ? 6 : 0, level: 0.6, min_component: 500, min_opacity: 0.02, color_sharpen: 2 }),
  '12': node('SaveGLB', { mesh: [smooth ? '14' : '11', 0], filename_prefix: `QCharacter/triposplat-${smooth ? 'smooth-' : ''}evaluation` }),
  '13': node('PreviewImage', { images: ['3', 0] }),
};
if (smooth) graph['14'] = node('MeshSmoothNormals', { mesh: ['11', 0], crease_angle: 180 });
validateWorkflow(graph, info);
await fs.writeFile(path.join(output, smooth ? 'workflow-smooth-api.json' : 'workflow-api.json'), JSON.stringify(graph, null, 2));
let promptId;
const report = { startedAt: new Date().toISOString(), input: 'examples/cutout.png', seed: 123456, steps: 40, resolution: 384, smooth: smooth ? 6 : 0 };
const close = client.watch(event => {
  if (event.data?.prompt_id === promptId && event.type === 'executing') console.log('Executing', event.data.node);
});
try {
  const response = await client.json('/prompt', { prompt: graph, client_id: client.clientId });
  promptId = response.prompt_id;
  if (!promptId) throw new Error(JSON.stringify(response));
  report.promptId = promptId;
  const outputs = await client.waitFor(promptId, 'shape', () => false, () => {});
  const bytes = await client.download(outputs[0]);
  await fs.writeFile(path.join(output, smooth ? 'triposplat-smooth.glb' : 'triposplat-colored.glb'), bytes);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  const primitives = gltf.meshes.flatMap(mesh => mesh.primitives);
  report.bytes = bytes.length;
  report.vertexColors = primitives.every(p => p.attributes.COLOR_0 !== undefined);
  report.uvs = primitives.every(p => p.attributes.TEXCOORD_0 !== undefined);
  report.textureCount = gltf.images?.length || 0;
  report.triangles = primitives.reduce((sum, p) => sum + (p.indices !== undefined ? gltf.accessors[p.indices].count : gltf.accessors[p.attributes.POSITION].count) / 3, 0);
  report.extensions = gltf.extensionsUsed;
  report.completedAt = new Date().toISOString();
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = error.message;
  console.error(error);
  process.exitCode = 1;
} finally {
  close();
  await fs.writeFile(path.join(output, smooth ? 'smooth-report.json' : 'report.json'), JSON.stringify(report, null, 2));
}
