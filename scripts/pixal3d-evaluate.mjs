import fs from 'node:fs/promises';
import path from 'node:path';
import { ComfyClient } from '../electron/comfy.mjs';
import { buildPixal3DWorkflow } from '../electron/pixal3d.mjs';
import { validateWorkflow } from '../electron/workflows.mjs';
import { validateTexturedGlb } from '../electron/texture.mjs';

const quality = process.argv.find(a => ['draft', 'standard', 'high'].includes(a)) || 'standard';
const output = path.resolve(`.runtime/pixal3d-evaluation/${quality}`);
await fs.mkdir(output, { recursive: true });
const client = new ComfyClient(process.env.QCHARACTER_TEST_SERVER || 'http://127.0.0.1:8188');
const report = { input: 'examples/cutout.png', quality, seed: 123456, startedAt: new Date().toISOString() };
let promptId;
const close = client.watch(event => {
  if (event.data?.prompt_id !== promptId) return;
  if (event.type === 'executing') console.log('Executing', event.data.node);
  if (event.type === 'progress') console.log('Sampling', event.data.value, '/', event.data.max);
});
try {
  const { info } = await client.capabilities();
  const image = await client.upload(await fs.readFile(report.input), 'cutout.png');
  const graph = buildPixal3DWorkflow({ image, seed: report.seed, quality });
  validateWorkflow(graph, info);
  await fs.writeFile(path.join(output, 'workflow-api.json'), JSON.stringify(graph, null, 2));
  const response = await client.json('/prompt', { prompt: graph, client_id: client.clientId });
  promptId = report.promptId = response.prompt_id;
  if (!promptId) throw new Error(JSON.stringify(response));
  console.log('Prompt', promptId);
  const outputs = await client.waitFor(promptId, 'shape', () => false, () => {});
  const bytes = await client.download(outputs[0]);
  validateTexturedGlb(bytes);
  await fs.writeFile(path.join(output, 'pixal3d-pbr.glb'), bytes);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  const primitives = gltf.meshes.flatMap(m => m.primitives);
  Object.assign(report, {
    bytes: bytes.length,
    triangles: primitives.reduce((sum, p) => sum + gltf.accessors[p.indices ?? p.attributes.POSITION].count / 3, 0),
    textures: gltf.images,
    materials: gltf.materials,
    uvs: primitives.every(p => p.attributes.TEXCOORD_0 !== undefined),
    normals: primitives.every(p => p.attributes.NORMAL !== undefined),
    completedAt: new Date().toISOString(),
    seconds: (Date.now() - Date.parse(report.startedAt)) / 1000,
  });
  console.log(JSON.stringify(report, null, 2));
} catch (error) { report.error = error.message; console.error(error); process.exitCode = 1; }
finally { close(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
