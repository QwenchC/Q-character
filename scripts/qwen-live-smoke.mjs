import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { ComfyClient } from '../electron/comfy.mjs';
import { buildQwenEditWorkflow, buildMatteWorkflow, validateWorkflow } from '../electron/workflows.mjs';
import { applyForegroundMask, alphaSummary, prepareShapeImage } from '../electron/background.mjs';

const client = new ComfyClient(process.env.QCHARACTER_TEST_SERVER || 'http://127.0.0.1:8199');
const root = path.resolve('docs/qwen-validation'); await fs.mkdir(root, { recursive: true });
const { info, stats } = await client.capabilities();
const report = { startedAt: new Date().toISOString(), version: stats.system.comfyui_version, tasks: [] };
let promptId;
const close = client.watch(event => { if (event.data?.prompt_id === promptId && event.type === 'progress') console.log('progress', event.data.value, '/', event.data.max); });
async function execute(graph, kind) {
  validateWorkflow(graph, info);
  const response = await client.json('/prompt', { prompt: graph, client_id: client.clientId });
  promptId = response.prompt_id; if (!promptId) throw new Error(JSON.stringify(response));
  console.log('SUBMITTED', kind, promptId);
  const outputs = await client.waitFor(promptId, kind, () => false, console.log);
  return { bytes: await client.download(outputs[0]), promptId };
}
async function matte(bytes, name) {
  const uploaded = await client.upload(bytes, `${name}.png`);
  const result = await execute(buildMatteWorkflow({ image: uploaded, model: 'birefnet.safetensors' }), 'matte');
  const cutout = applyForegroundMask(bytes, result.bytes);
  await fs.writeFile(path.join(root, `${name}-mask.png`), result.bytes);
  await fs.writeFile(path.join(root, `${name}-cutout.png`), cutout);
  await fs.writeFile(path.join(root, `${name}-3d-input.png`), prepareShapeImage(cutout));
  report.tasks.push({ kind: 'matte', name, promptId: result.promptId, alpha: alphaSummary(cutout) });
  return cutout;
}
try {
  const original = await fs.readFile('docs/smoke-assets/design.png');
  const cutout = await matte(original, 'white-clothes');
  const originalPNG = PNG.sync.read(original), cutoutPNG = PNG.sync.read(cutout);
  let changedRGB = 0;
  for (let i = 0; i < originalPNG.data.length; i += 4) for (let c = 0; c < 3; c++) if (originalPNG.data[i + c] !== cutoutPNG.data[i + c]) changedRGB++;
  if (changedRGB) throw new Error('Matting changed original RGB pixels.');
  report.rgbPreserved = true;
  const photo = await fs.readFile(path.join(root, 'reference-photo.png'));
  const image = await client.upload(photo, 'reference-photo.png');
  const result = await execute(buildQwenEditWorkflow({ model: 'qwen_image_2.1_int8_convrot.safetensors', encoder: 'qwen3vl_8b_int8_convrot.safetensors', vae: 'qwen_image_2.1_vae_bf16.safetensors', image, description: '', ratio: '2.5', style: 'clay', seed: 123456 }), 'design');
  await fs.writeFile(path.join(root, 'qwen-chibi.png'), result.bytes);
  report.tasks.push({ kind: 'qwen-edit', promptId: result.promptId, bytes: result.bytes.length });
  await matte(result.bytes, 'qwen-chibi');
  report.completedAt = new Date().toISOString();
} catch (error) { report.error = error.message; console.error(error); process.exitCode = 1; }
finally { close(); await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); }
