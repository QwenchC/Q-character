import { dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { applyForegroundMask, prepareShapeImage } from '../electron/background.mjs';

export async function runDesktopSmoke({ window, store, projectId, root }) {
  const output = path.join(root, 'docs', 'mask-validation'); await fs.mkdir(output, { recursive: true });
  const report = { startedAt: new Date().toISOString(), checks: [], errors: [] };
  const js = code => window.webContents.executeJavaScript(code), pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  window.webContents.on('console-message', (_, level, message) => { if (level >= 3) report.errors.push(message); });
  const wait = async expression => { for (let i = 0; i < 300; i++) { if (await js(expression)) return; await pause(100); } throw new Error(`Timeout: ${expression}`); };
  const clickCode = label => `Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === ${JSON.stringify(label)}).click()`;
  const click = async label => { await js(clickCode(label)); await pause(80); };
  const capture = async filename => { await pause(300); const image = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); await fs.writeFile(path.join(output, filename), image.toPNG()); };
  const pixel = (x, y) => js(`[...document.querySelector('.mask-canvas-stage canvas').getContext('2d').getImageData(${x},${y},1,1).data]`);
  const paint = async (x, y, dx = 0, dy = 0) => {
    const rect = await js(`(() => { const c=document.querySelector('.mask-canvas-stage canvas'),r=c.getBoundingClientRect(); return {x:r.x,y:r.y,scale:r.width/c.width}; })()`);
    const point = { x: Math.round(rect.x + x * rect.scale), y: Math.round(rect.y + y * rect.scale) };
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point });
    window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
    if (dx || dy) window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(point.x + dx * rect.scale), y: Math.round(point.y + dy * rect.scale), movementX: dx, movementY: dy });
    window.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(point.x + dx * rect.scale), y: Math.round(point.y + dy * rect.scale), button: 'left', clickCount: 1 });
    await pause(150);
  };
  const reload = async () => { await window.webContents.reload(); await wait(`document.querySelector('.cutout-modes') !== null`); };
  const open = async () => { await click('手动修正'); await wait(`document.querySelector('.mask-editor canvas')?.width === 768 && !Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='恢复前景')?.disabled`); };
  const assetBytes = async asset => fs.readFile(path.join(store.root, projectId, 'assets', asset.filename));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  try {
    await wait(`document.querySelector('textarea') !== null`);
    let project = await store.addAsset(projectId, await fs.readFile(path.join(root, 'examples', 'design.png')), '.png', 'design', '手修测试原图');
    const source = project.assets.at(-1), image = await assetBytes(source);
    const mask = PNG.sync.read(await fs.readFile(path.join(root, 'examples', 'mask.png')));
    for (let y = 463; y < 487; y++) for (let x = 300; x < 324; x++) mask.data.set([0, 0, 0, 255], (y * mask.width + x) * 4);
    for (let y = 483; y <= 517; y++) for (let x = 103; x <= 137; x++) if (Math.hypot(x - 120, y - 500) <= 14) mask.data.set([255, 255, 255, 255], (y * mask.width + x) * 4);
    const damagedMask = PNG.sync.write(mask), damagedCutout = applyForegroundMask(image, damagedMask);
    project = await store.addAsset(projectId, damagedMask, '.png', 'mask', '测试误删与残留', undefined, { sourceAssetId: source.id });
    project = await store.addAsset(projectId, damagedCutout, '.png', 'cutout', '测试待修正抠图', undefined, { sourceAssetId: source.id, maskAssetId: project.assets.at(-1).id });
    const parent = project.assets.at(-1), previousHash = hash(damagedCutout);
    await reload(); await open(); await capture('editor-before.png');
    await click('黑白蒙版');
    if ((await pixel(312, 475))[0] !== 0 || (await pixel(120, 500))[0] !== 255) throw new Error('Damaged mask fixture mismatch');
    await paint(312, 475);
    if ((await pixel(312, 475))[0] !== 255) throw new Error('Restore brush did not recover clothing');
    await js(`document.querySelector('button[aria-label="撤销"]').click()`); await pause(80);
    if ((await pixel(312, 475))[0] !== 0) throw new Error('Undo did not restore removed sleeve');
    await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,shiftKey:true,bubbles:true}))`); await pause(80);
    if ((await pixel(312, 475))[0] !== 255) throw new Error('Keyboard redo did not restore sleeve');
    await paint(100, 200, 100, 0);
    if ((await pixel(150, 200))[0] !== 255) throw new Error('Fast pointer stroke left gaps');
    await js(`document.querySelector('button[aria-label="撤销"]').click()`); await pause(80);
    if ((await pixel(150, 200))[0] !== 0) throw new Error('Fast stroke undo failed');
    const zoomBefore = await js(`document.querySelector('.mask-viewbar output').textContent`);
    window.webContents.sendInputEvent({ type: 'mouseWheel', x: 700, y: 500, deltaX: 0, deltaY: -80 }); await pause(120);
    if (await js(`document.querySelector('.mask-viewbar output').textContent`) === zoomBefore) throw new Error('Mouse wheel did not zoom');
    await js(`document.querySelector('button[aria-label="放大画布"]').click()`); await pause(80);
    await click('移动画布');
    const panBefore = await js(`document.querySelector('.mask-editor canvas').getBoundingClientRect().x`);
    await paint(384, 512, 60, 30);
    const panAfter = await js(`document.querySelector('.mask-editor canvas').getBoundingClientRect().x`);
    if (!(panAfter - panBefore > 20)) throw new Error('Canvas pan did not move the image');
    await click('擦除背景'); await paint(120, 500);
    if ((await pixel(120, 500))[0] !== 0) throw new Error('Erase brush failed after zoom and pan');
    report.checks.push('Actual mouse brush restores deleted white sleeve; erases background after zoom and pan; undo and keyboard redo');
    await click('修正叠加'); await capture('editor-after.png');
    await click('保存修正'); await wait(`document.querySelector('.mask-editor') === null`);
    project = await store.read(projectId); const corrected = project.assets.at(-1);
    const bytes = await assetBytes(corrected), rgba = PNG.sync.read(bytes), original = PNG.sync.read(image);
    for (const [x, y, alpha] of [[312, 475, 255], [120, 500, 0]]) {
      const offset = (y * rgba.width + x) * 4;
      if (rgba.data[offset + 3] !== alpha) throw new Error('Saved alpha mismatch');
      if (!rgba.data.subarray(offset, offset + 3).equals(original.data.subarray(offset, offset + 3))) throw new Error('Saved RGB does not match original');
    }
    if (corrected.sourceAssetId !== source.id || corrected.parentCutoutId !== parent.id || hash(await assetBytes(parent)) !== previousHash) throw new Error('Version ancestry or previous file changed');
    await fs.writeFile(path.join(output, 'corrected-cutout.png'), bytes);
    await fs.writeFile(path.join(output, 'shape-input.png'), prepareShapeImage(bytes));
    report.correctedAssetId = corrected.id; report.parentHash = previousHash;
    report.checks.push('Saved new cutout and grayscale mask; original RGB preserved; parent bytes unchanged');
    await reload(); await open(); await click('黑白蒙版');
    if ((await pixel(312, 475))[0] !== 255 || (await pixel(120, 500))[0] !== 0) throw new Error('Mask did not survive restart');
    await click('恢复前景'); await paint(120, 500);
    await js(`document.querySelector('button[title="关闭修正"]').click()`); await pause(80);
    if (!await js(`document.querySelector('.mask-discard') !== null`)) throw new Error('Dirty edits were silently discarded');
    await click('继续修正'); await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))`); await pause(80);
    await click('取消'); await wait(`document.querySelector('.mask-editor') === null`);
    try { await js(`window.studio.saveMask(${JSON.stringify(projectId)},${JSON.stringify(corrected.id)},new Uint8Array([1,2,3]))`); throw new Error('Invalid mask accepted'); }
    catch (error) { if (error.message === 'Invalid mask accepted') throw error; }
    if ((await store.read(projectId)).assets.length !== project.assets.length) throw new Error('Cancel or invalid save created a version');
    report.checks.push('Reload/reopen retains mask; unsaved edits protected; undo to clean; invalid PNG rejected without asset mutation');
    await capture('corrected-preview.png');
    const cap = await js('window.studio.connect()'); if (cap.missingShapeNodes.length) throw new Error('Missing 3D nodes');
    const job = await js(`new Promise((resolve,reject)=>{const timer=setTimeout(()=>{off();reject(new Error('Shape timeout'));},300000);const off=window.studio.onJob(job=>{if(job.projectId===${JSON.stringify(projectId)}&&['completed','failed','cancelled'].includes(job.status)){clearTimeout(timer);off();resolve(job);}});${clickCode('生成 3D')};})`);
    if (job.status !== 'completed' || job.inputAssetId !== corrected.id) throw new Error(`Wrong shape input or failure: ${job.message}`);
    report.shape = { inputAssetId: job.inputAssetId, promptId: job.promptId, engine: job.engine, status: job.status };
    await wait(`parseInt(document.querySelector('.generation-footer strong')?.textContent.replace(/,/g,'')) > 0`);
    dialog.showSaveDialog = async (_window, options) => ({ canceled: false, filePath: path.join(output, options.defaultPath.endsWith('.glb') ? 'export-80mm.glb' : options.defaultPath.endsWith('.stl') ? 'export-80mm.stl' : 'reference-sheet.png') });
    for (const [label, filename] of [['导出 GLB', 'export-80mm.glb'], ['STL', 'export-80mm.stl'], ['三视图参考', 'reference-sheet.png']]) {
      await click(label); const file = path.join(output, filename);
      for (let i = 0; i < 300; i++) { try { if ((await fs.stat(file)).size > 0) break; } catch {} await pause(100); }
      report.checks.push(`${label}: ${(await fs.stat(file)).size} bytes`); await wait(`!document.querySelector('.export-buttons .primary')?.disabled`);
    }
    await capture('model-preview.png'); report.checks.push('Corrected cutout selected automatically and consumed by real Hunyuan3D standard workflow');
    report.completedAt = new Date().toISOString();
  } catch (error) { report.error = error.stack; throw error; }
  finally { await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
}
