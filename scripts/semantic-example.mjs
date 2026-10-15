import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { ComfyClient } from '../electron/comfy.mjs';
import { buildShapeWorkflow, validateWorkflow } from '../electron/workflows.mjs';
import { prepareShapeImage } from '../electron/background.mjs';

const client = new ComfyClient(process.env.QCHARACTER_TEST_SERVER || 'http://127.0.0.1:8199');
const root = path.resolve('docs/qwen-validation');
const cutout = await fs.readFile(path.join(root, 'white-clothes-cutout.png'));
const image = await client.upload(prepareShapeImage(cutout), 'semantic-clay-input.png');
const { info } = await client.capabilities();
const graph = buildShapeWorkflow({ checkpoint: 'hunyuan_3d_v2.1.safetensors', image, seed: 123456, quality: 'standard' });
validateWorkflow(graph, info);
const response = await client.json('/prompt', { prompt: graph, client_id: client.clientId });
if (!response.prompt_id) throw new Error(JSON.stringify(response));
const outputs = await client.waitFor(response.prompt_id, 'shape', () => false, console.log);
const model = await client.download(outputs[0]);
if (model.subarray(0, 4).toString() !== 'glTF') throw new Error('Invalid GLB');
await fs.writeFile(path.join(root, 'white-clothes-model.glb'), model);
try { await fs.copyFile('examples/model.glb', path.join(root, 'example-v0.1.glb'), constants.COPYFILE_EXCL); } catch (error) { if (error.code !== 'EEXIST') throw error; }
await fs.writeFile('examples/model.glb', model);
await fs.writeFile('examples/cutout.png', cutout);
await fs.copyFile(path.join(root, 'white-clothes-mask.png'), 'examples/mask.png');
const gltf = JSON.parse(model.subarray(20, 20 + model.readUInt32LE(12)).toString());
const triangles = gltf.meshes.flatMap(mesh => mesh.primitives).reduce((sum, primitive) => sum + gltf.accessors[primitive.indices].count / 3, 0);
await fs.writeFile(path.join(root, 'example-report.json'), JSON.stringify({ promptId: response.prompt_id, triangles, bytes: model.length, workflow: graph, completedAt: new Date().toISOString() }, null, 2));
console.log('SEMANTIC_EXAMPLE_COMPLETED', triangles);
