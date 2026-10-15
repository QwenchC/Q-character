import { dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { alphaSummary } from '../electron/background.mjs';

export async function runDesktopSmoke({ window, store, projectId, root }) {
  const output = path.join(root, 'docs', 'qwen-validation', 'desktop'); await fs.mkdir(output, { recursive: true });
  const report = { startedAt: new Date().toISOString(), checks: [], errors: [], jobs: [] };
  window.webContents.on('console-message', (_, level, message) => { if (level >= 3) report.errors.push(message); });
  const js = code => window.webContents.executeJavaScript(code);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async expression => { for (let i = 0; i < 300; i++) { if (await js(expression)) return; await pause(100); } throw new Error(`Desktop timeout: ${expression}`); };
  const clickCode = label => `Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === ${JSON.stringify(label)}).click()`;
  const click = label => js(clickCode(label));
  const capture = async filename => {
    await wait(`Array.from(document.querySelectorAll('img')).every(image => image.complete)`);
    await pause(300);
    for (let attempt = 0; attempt < 3; attempt++) {
      try { const image = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); await fs.writeFile(path.join(output, filename), image.toPNG()); return; }
      catch (error) { if (attempt === 2) throw error; await pause(300); }
    }
  };
  const runJob = async action => {
    const result = await js(`new Promise((resolve, reject) => { const timer = setTimeout(() => { off(); reject(new Error('Job timeout')); }, 240000); const off = window.studio.onJob(job => { if (job.projectId === ${JSON.stringify(projectId)} && ['completed','failed','cancelled'].includes(job.status)) { clearTimeout(timer); off(); resolve(job); } }); Promise.resolve().then(() => { ${action} }).catch(error => { clearTimeout(timer); off(); reject(error); }); })`);
    report.jobs.push({ kind: result.kind, status: result.status, engine: result.engine, promptId: result.promptId });
    return result;
  };
  const generateCode = (kind, id) => `return window.studio.generate(${JSON.stringify(projectId)}, {kind:${JSON.stringify(kind)}, assetId:${JSON.stringify(id)}});`;
  const requireSuccess = job => { if (job.status !== 'completed') throw new Error(job.message); };
  const assetBytes = async id => { const project = await store.read(projectId); const asset = project.assets.find(x => x.id === id); return fs.readFile(path.join(store.root, projectId, 'assets', asset.filename)); };
  try {
    await wait(`document.querySelector('textarea') !== null`);
    const cap = await js('window.studio.connect()');
    if (cap.missingEditNodes.length || cap.missingMatteNodes.length || !cap.qwenModels.length || !cap.backgroundModels.length) throw new Error('Qwen or matting capabilities unavailable');
    report.checks.push('Real Qwen 2.1 and native BiRefNet capabilities');
    const initial = await store.read(projectId); const photo = initial.assets.find(x => x.kind === 'reference'), whiteClothes = initial.assets.find(x => x.kind === 'design');
    const rejected = await runJob(generateCode('shape', photo.id));
    if (rejected.status !== 'failed' || rejected.promptId || !rejected.message.includes('先自动抠图')) throw new Error('Opaque input bypassed shape preflight');
    report.checks.push('Opaque original rejected before 3D submission');
    await click('图片参考');
    await js(`Array.from(document.querySelectorAll('.asset-strip button')).find(x => x.title === '参考人物照片').click()`);
    const design = await runJob(clickCode('生成 Q 版设计图')); requireSuccess(design);
    if (design.engine !== 'qwen21') throw new Error('Photo editing fell back to SDXL');
    await fs.writeFile(path.join(output, 'qwen-design.png'), await assetBytes(design.resultAssetId));
    await wait(`document.querySelector('.image-kind')?.textContent.includes('Q 版设计图')`);
    report.checks.push('Photo-to-chibi via actual UI, Qwen reference conditioning and persistent output');
    const matte = await runJob(clickCode('自动抠图')); requireSuccess(matte);
    await wait(`document.querySelector('.cutout-modes') !== null`);
    await fs.writeFile(path.join(output, 'qwen-cutout.png'), await assetBytes(matte.resultAssetId));
    await capture('cutout-preview.png');
    for (const label of ['前景蒙版', '对照原图', '白底检查', '透明轮廓']) { await click(label); await wait(`document.querySelector('.cutout-modes .selected')?.textContent === ${JSON.stringify(label)}`); }
    report.checks.push('Cutout, white background, foreground mask and original comparison controls');
    dialog.showSaveDialog = async (_window, options) => ({ canceled: false, filePath: path.join(output, options.defaultPath.endsWith('.glb') ? 'export-80mm.glb' : options.defaultPath.endsWith('.stl') ? 'export-80mm.stl' : options.defaultPath.endsWith('三视图.png') ? 'reference-sheet.png' : 'export-cutout.png') });
    await click('透明 PNG');
    const exportedFile = path.join(output, 'export-cutout.png');
    for (let i = 0; i < 100; i++) { try { if ((await fs.stat(exportedFile)).size > 0) break; } catch {} await pause(100); }
    if (!alphaSummary(await fs.readFile(exportedFile)).hasTransparency) throw new Error('PNG export lost alpha');
    report.checks.push('Transparent PNG export retains actual alpha');
    const shape = await runJob(clickCode('生成 3D')); requireSuccess(shape);
    await wait(`parseInt(document.querySelector('.generation-footer strong')?.textContent.replace(/,/g,'')) > 0`);
    await fs.writeFile(path.join(output, 'model.glb'), await assetBytes(shape.resultAssetId));
    await capture('model-preview.png');
    report.checks.push('Qwen design -> BiRefNet cutout -> standard Hunyuan3D model through desktop UI');
    for (const [label, filename] of [['导出 GLB', 'export-80mm.glb'], ['STL', 'export-80mm.stl'], ['三视图参考', 'reference-sheet.png']]) {
      const file = path.join(output, filename); await fs.rm(file, { force: true }); await click(label);
      for (let i = 0; i < 300; i++) { try { if ((await fs.stat(file)).size > 0) break; } catch {} await pause(100); }
      report.checks.push(`${label}: ${(await fs.stat(file)).size} bytes`);
      await wait(`!document.querySelector('.export-buttons .primary')?.disabled`);
    }
    const clothes = await runJob(generateCode('matte', whiteClothes.id)); requireSuccess(clothes);
    const cutout = PNG.sync.read(await assetBytes(clothes.resultAssetId));
    const points = [[310, 480], [470, 450]];
    report.whiteClothingPixels = points.map(([x, y]) => ({ x, y, rgba: [...cutout.data.subarray((y * cutout.width + x) * 4, (y * cutout.width + x) * 4 + 4)] }));
    if (report.whiteClothingPixels.some(point => point.rgba[3] < 240)) throw new Error('Known white sleeve points were removed');
    await wait(`document.querySelector('.cutout-modes') !== null`);
    await capture('white-clothes-preview.png');
    report.checks.push('White sleeve regression: both known clothing pixels remain opaque');
    const preserved = await runJob(generateCode('matte', clothes.resultAssetId)); requireSuccess(preserved);
    if (preserved.engine !== 'existing-alpha' || preserved.promptId) throw new Error('Existing alpha was regenerated');
    report.checks.push('Existing transparency preserved without a generation request');
    report.completedAt = new Date().toISOString();
  } catch (error) { report.error = error.message; throw error; }
  finally { await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
}
