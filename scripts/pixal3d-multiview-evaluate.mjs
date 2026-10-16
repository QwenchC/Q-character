import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { ComfyClient } from '../electron/comfy.mjs';
import { VIEW_ROLES, prepareMultiViewImages } from '../electron/multiview.mjs';
import { buildPixal3DWorkflow } from '../electron/pixal3d.mjs';
import { validateWorkflow } from '../electron/workflows.mjs';
import { validateTexturedGlb } from '../electron/texture.mjs';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node scripts/pixal3d-multiview-evaluate.mjs <cutout-directory> [draft|standard|high]');
const quality = process.argv[3] || 'standard', images = {};
for (const role of VIEW_ROLES) {
  try { images[role] = PNG.sync.read(await fs.readFile(path.join(directory, role + '.png'))); }
  catch (e) { if (e.code !== 'ENOENT' || ['front', 'back'].includes(role)) throw e; }
}
const output = path.resolve('.runtime/multiview-evaluation', quality);
await fs.mkdir(output, { recursive: true });
const client = new ComfyClient(process.env.QCHARACTER_TEST_SERVER || 'http://127.0.0.1:8188');
const report = { startedAt: new Date().toISOString(), directory, quality, seed: 123456, views: Object.keys(images) };
try {
  const { info } = await client.capabilities(), views = {};
  for (const [role, pixels] of Object.entries(prepareMultiViewImages(images))) views[role] = await client.upload(PNG.sync.write(pixels), role + '.png');
  const graph = buildPixal3DWorkflow({ views, quality, seed: report.seed, fov: 20 });
  validateWorkflow(graph, info);
  await fs.writeFile(path.join(output, 'workflow-api.json'), JSON.stringify(graph, null, 2));
  const result = await client.json('/prompt', { prompt: graph, client_id: client.clientId });
  if (!result.prompt_id) throw new Error(JSON.stringify(result));
  report.promptId = result.prompt_id; console.log('Prompt', report.promptId);
  const files = await client.waitFor(report.promptId, 'shape', () => false, message => console.log(message));
  const bytes = await client.download(files[0]);
  report.glb = validateTexturedGlb(bytes); report.bytes = bytes.length;
  await fs.writeFile(path.join(output, 'multiview-pbr.glb'), bytes);
  report.completedAt = new Date().toISOString();
} catch (e) { report.error = e.message; process.exitCode = 1; }
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(report);
