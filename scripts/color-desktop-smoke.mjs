import { dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateTexturedGlb } from '../electron/texture.mjs';

export async function runDesktopSmoke({ window, store, projectId, root }) {
  const output = process.env.QCHARACTER_VALIDATION_OUTPUT ? path.resolve(process.env.QCHARACTER_VALIDATION_OUTPUT) : path.join(root, 'docs', 'color-validation'); await fs.mkdir(output, { recursive: true });
  const report = { startedAt: new Date().toISOString(), checks: [], errors: [] }, pause = ms => new Promise(r => setTimeout(r, ms));
  window.webContents.on('console-message', event => { if (event.level === 'error') report.errors.push(event.message); });
  const js = code => window.webContents.executeJavaScript(code);
  const wait = async expression => { for (let i = 0; i < 300; i++) { if (await js(expression)) return; await pause(100); } throw new Error(`Timeout: ${expression}`); };
  const click = async label => { await js(`Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === ${JSON.stringify(label)}).click()`); await pause(100); };
  const assetBytes = asset => fs.readFile(path.join(store.root, projectId, 'assets', asset.filename));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const capture = async filename => { await pause(300); const image = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); await fs.writeFile(path.join(output, filename), image.toPNG()); };
  const exportFile = async (button, filename) => { await fs.rm(path.join(output, filename), { force: true }); await click(button); for (let i = 0; i < 300; i++) { try { if ((await fs.stat(path.join(output, filename))).size > 0 && await js(`!document.querySelector('.export-buttons .primary').disabled`)) return; } catch {} await pause(100); } throw new Error(`No export: ${filename}`); };
  const gltf = bytes => JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  const waitModel = () => wait(`!document.querySelector('.viewer-overlay') && parseInt(document.querySelector('.generation-footer strong')?.textContent.replace(/,/g,'')) > 0`);
  try {
    await wait(`document.querySelector('textarea') !== null`);
    let project = await store.read(projectId); const source = project.assets.find(a => a.kind === 'design'), parent = project.assets.find(a => a.kind === 'model');
    const parentHash = hash(await assetBytes(parent));
    project = await store.addAsset(projectId, await fs.readFile(path.join(root, 'examples', 'cutout.png')), '.png', 'cutout', '已检查的上色参考', undefined, { sourceAssetId: source.id });
    const reference = project.assets.at(-1);
    await window.webContents.reload(); await wait(`document.querySelector('.cutout-modes') !== null`);
    await js(`Array.from(document.querySelectorAll('nav button')).find(x=>x.textContent.startsWith('3D 工作台')).click()`); await waitModel();
    await wait(`document.querySelectorAll('.clay-swatches article').length >= 4`);
    report.palette = await js(`Array.from(document.querySelectorAll('.clay-swatches code')).map(x=>x.textContent)`);
    const paletteCount = report.palette.length;
    await js(`document.querySelector('.color-reference img').scrollIntoView({block:'center'})`);
    const pick = (x, y) => js(`(()=>{const img=document.querySelector('.color-reference img'),r=img.getBoundingClientRect();img.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.x+r.width*${x},clientY:r.y+r.height*${y}}));})()`);
    await pick(0.02, 0.02); await pause(80);
    if (await js(`document.querySelectorAll('.clay-swatches article').length`) !== paletteCount) throw new Error('Eyedropper included transparent background');
    await pick(0.5, 0.6); await pause(80);
    if (await js(`document.querySelectorAll('.clay-swatches article').length`) !== paletteCount + 1) throw new Error('Manual accessory color pick failed');
    await js(`document.querySelector('button[title="移除颜色 ${paletteCount + 1}"]').click()`); await pause(80);
    report.checks.push('Manual foreground color pick adds a swatch; transparent background excluded; swatch can be removed');
    await js(`document.querySelector('.color-workbench').scrollIntoView({block:'start'})`); await capture('color-workbench.png');
    await click('按设计图上色');
    await wait(`!Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()==='按设计图上色').disabled && document.querySelector('.texture-ready') !== null`);
    await waitModel();
    project = await store.read(projectId); const colored = project.assets.at(-1), bytes = await assetBytes(colored), json = gltf(bytes);
    report.glb = validateTexturedGlb(bytes);
    if (colored.parentModelId !== parent.id || colored.textureSourceId !== reference.id || hash(await assetBytes(parent)) !== parentHash) throw new Error('Model ancestry or parent bytes changed');
    await fs.writeFile(path.join(output, 'colored-model.glb'), bytes);
    const imageView = json.bufferViews[json.images[0].bufferView], binStart = 28 + bytes.readUInt32LE(12);
    await fs.writeFile(path.join(output, 'embedded-texture.png'), bytes.subarray(binStart + (imageView.byteOffset || 0), binStart + (imageView.byteOffset || 0) + imageView.byteLength));
    report.checks.push('Offline desktop reference-to-texture, UVs and embedded PNG; new model version; geometry parent bytes unchanged');
    await click('正面'); await js(`document.querySelector('.viewer-shell').scrollIntoView({block:'center'})`); await capture('model-front.png');
    await click('背面'); await capture('model-back.png');
    dialog.showSaveDialog = async (_window, options) => ({ canceled: false, filePath: path.join(output, options.defaultPath.includes('调色') ? 'clay-guide.png' : options.defaultPath.endsWith('.stl') ? 'export-80mm.stl' : options.defaultPath.endsWith('.glb') ? 'export-80mm.glb' : 'reference-sheet.png') });
    // Clay preview must remain display-only, even when exporting the textured asset.
    await js(`document.querySelector('button[title="素色泥模"]').click()`); await exportFile('导出 GLB', 'export-80mm.glb');
    report.exportedGlb = validateTexturedGlb(await fs.readFile(path.join(output, 'export-80mm.glb')));
    await js(`document.querySelector('button[title="素色泥模"]').click()`); await exportFile('STL', 'export-80mm.stl'); await exportFile('三视图参考', 'reference-sheet.png');
    await exportFile('导出调色指引', 'clay-guide.png');
    report.checks.push('GLB export retains texture in clay display mode; STL and color reference sheet; clay recipe PNG exported');
    await js(`(() => { const input=document.querySelector('input[aria-label="目标颜色 1"]'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'#416db3');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait(`document.querySelector('.clay-swatches code').textContent === '#416DB3'`);
    await click('保存配色'); await pause(200);
    if ((await store.read(projectId)).clayGuide.swatches[0].target !== '#416db3') throw new Error('Color override not persisted');
    await click('按设计图上色'); await wait(`!Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()==='按设计图上色').disabled && !document.querySelector('.viewer-overlay')`);
    project = await store.read(projectId); const recolored = project.assets.at(-1);
    if (recolored.id === colored.id || hash(await assetBytes(recolored)) === hash(bytes)) throw new Error('Recolor did not create a different texture');
    report.checks.push('Target color edit is persisted and creates a distinct recolored model version');
    await window.webContents.reload(); await wait(`document.querySelector('textarea') !== null`);
    await js(`Array.from(document.querySelectorAll('nav button')).find(x=>x.textContent.startsWith('3D 工作台')).click()`); await waitModel();
    await wait(`document.querySelector('.clay-swatches code')?.textContent === '#416DB3'`);
    const rejected = await js(`window.studio.saveTexture(${JSON.stringify(projectId)},${JSON.stringify(parent.id)},${JSON.stringify(reference.id)},new Uint8Array([1,2]),{}).then(()=>false,()=>true)`);
    if (!rejected) throw new Error('Invalid textured model accepted');
    report.checks.push('Reopened project retains recipe and texture; malformed model rejected');
    report.completedAt = new Date().toISOString();
  } catch (error) { report.error = error.stack; throw error; }
  finally { await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
}
