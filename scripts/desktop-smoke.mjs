import { dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function runDesktopSmoke({ window, store, projectId, root, mode }) {
  const output = path.join(root, 'docs', 'smoke-assets');
  const report = { startedAt: new Date().toISOString(), errors: [], checks: [] };
  window.webContents.on('console-message', (_, level, message) => { if (level >= 3) report.errors.push(message); });
  const js = code => window.webContents.executeJavaScript(code);
  const wait = async (expression, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await js(expression)) return; await new Promise(resolve => setTimeout(resolve, 150)); }
    throw new Error(`Desktop timeout: ${expression}`);
  };
  const click = label => js(`Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === ${JSON.stringify(label)}).click()`);
  try {
    await wait(`document.querySelector('textarea') !== null`);
    const connected = await js('window.studio.connect()');
    if (connected.missingShapeNodes.length) throw new Error('Missing shape nodes');
    report.checks.push('Electron preload IPC and live ComfyUI capabilities');
    await wait(`Array.from(document.images).some(x => x.complete && x.naturalWidth > 0)`);
    await window.webContents.capturePage().then(image => fs.writeFile(path.join(root, 'docs', 'desktop-design.png'), image.toPNG()));

    if (mode === 'e2e') {
      const project = await store.read(projectId);
      const result = await js(`new Promise(async (resolve, reject) => { let id; let timer; const off = window.studio.onJob(job => { if (job.id === id && ['completed','failed','cancelled'].includes(job.status)) { clearTimeout(timer); off(); resolve(job); } }); try { const started = await window.studio.generate(${JSON.stringify(projectId)}, {kind:'design', assetId:${JSON.stringify(project.assets[0].id)}, denoise:0.45}); id = started.id; timer = setTimeout(() => { off(); reject(new Error('generation timeout')); }, 180000); } catch(error) { off(); reject(error); } })`);
      if (result.status !== 'completed') throw new Error(result.message);
      report.checks.push('Real image-to-image generation through renderer IPC, upload, job lifecycle and asset persistence');
      const saved = await store.read(projectId);
      report.imageToImageJob = { id: result.id, promptId: result.promptId, assets: saved.assets.length };
      const cutout = await js(`new Promise(async (resolve, reject) => { let id; const off = window.studio.onJob(job => { if (job.id === id && ['completed','failed','cancelled'].includes(job.status)) { off(); resolve(job); } }); try { const started = await window.studio.generate(${JSON.stringify(projectId)}, {kind:'matte', assetId:${JSON.stringify(project.assets[0].id)}}); id = started.id; } catch(error) { off(); reject(error); } })`);
      if (cutout.status !== 'completed') throw new Error(cutout.message);
      const shapeResult = await js(`new Promise(async (resolve, reject) => { let id; let timer; const off = window.studio.onJob(job => { if (job.id === id && ['completed','failed','cancelled'].includes(job.status)) { clearTimeout(timer); off(); resolve(job); } }); try { const started = await window.studio.generate(${JSON.stringify(projectId)}, {kind:'shape', assetId:${JSON.stringify(cutout.resultAssetId)}, quality:'standard'}); id = started.id; timer = setTimeout(() => { off(); reject(new Error('shape generation timeout')); }, 180000); } catch(error) { off(); reject(error); } })`);
      if (shapeResult.status !== 'completed') throw new Error(shapeResult.message);
      const generatedProject = await store.read(projectId);
      const generatedModel = generatedProject.assets.filter(x => x.kind === 'model').at(-1);
      await fs.copyFile(path.join(store.root, projectId, 'assets', generatedModel.filename), path.join(output, 'model-standard.glb'));
      report.shapeJob = { id: shapeResult.id, promptId: shapeResult.promptId };
      report.checks.push('Standard 30-step / 256-resolution shape generation through renderer IPC, foreground preparation and model persistence');
    }

    await js(`Array.from(document.querySelectorAll('nav button')).find(x => x.textContent.startsWith('3D 工作台')).click()`);
    await wait(`parseInt(document.querySelector('.generation-footer strong')?.textContent.replace(/,/g,'')) > 0`);
    await new Promise(resolve => setTimeout(resolve, 300));
    await window.webContents.capturePage().then(image => fs.writeFile(path.join(root, 'docs', 'desktop-model.png'), image.toPNG()));
    report.checks.push('GLB asset protocol, real WebGL model loading and mesh count');
    dialog.showSaveDialog = async (_window, options) => ({ canceled: false, filePath: path.join(output, options.defaultPath.endsWith('.glb') ? 'export-80mm.glb' : options.defaultPath.endsWith('.stl') ? 'export-80mm.stl' : 'reference-sheet.png') });
    for (const [label, filename] of [['导出 GLB', 'export-80mm.glb'], ['STL', 'export-80mm.stl'], ['三视图参考', 'reference-sheet.png']]) {
      await fs.rm(path.join(output, filename), { force: true });
      await click(label);
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) { try { if ((await fs.stat(path.join(output, filename))).size > 0) break; } catch {} await new Promise(resolve => setTimeout(resolve, 200)); }
      const bytes = await fs.readFile(path.join(output, filename));
      if (!bytes.length) throw new Error(`Empty export ${filename}`);
      await wait(`!document.querySelector('.export-buttons .primary')?.disabled`);
      report.checks.push(`${label}: ${bytes.length} bytes`);
    }
    const glb = await fs.readFile(path.join(output, 'export-80mm.glb'));
    const length = glb.readUInt32LE(12); const gltf = JSON.parse(glb.subarray(20, 20 + length).toString());
    report.glb = { magic: glb.subarray(0, 4).toString(), meshes: gltf.meshes.length, nodes: gltf.nodes.length };
    const stl = await fs.readFile(path.join(output, 'export-80mm.stl')); const count = stl.readUInt32LE(80);
    let low = Infinity, high = -Infinity;
    for (let i = 0; i < count; i++) for (let v = 0; v < 3; v++) { const y = stl.readFloatLE(84 + i * 50 + 12 + v * 12 + 4); low = Math.min(low, y); high = Math.max(high, y); }
    if (Math.abs(high - low - 80) > 0.001) throw new Error(`Wrong STL height: ${high - low}`);
    report.stl = { triangles: count, heightMm: high - low };
    await js(`Array.from(document.querySelectorAll('nav button')).find(x => x.textContent.startsWith('我的作品')).click()`);
    report.checks.push('Library navigation');
    report.completedAt = new Date().toISOString();
  } finally { await fs.writeFile(path.join(root, 'docs', 'desktop-validation.json'), JSON.stringify(report, null, 2)); }
}
