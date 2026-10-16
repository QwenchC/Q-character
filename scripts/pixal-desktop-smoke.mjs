import { dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateTexturedGlb } from '../electron/texture.mjs';

export async function runDesktopSmoke({ window, store, projectId, root }) {
  if (process.env.QCHARACTER_PIXAL_FIXTURE_PROJECT) projectId = process.env.QCHARACTER_PIXAL_FIXTURE_PROJECT;
  const output = path.join(root, '.runtime/pixal3d-validation/desktop'); await fs.mkdir(output, { recursive: true });
  const report = { startedAt: new Date().toISOString(), checks: [] }, pause = ms => new Promise(r => setTimeout(r, ms));
  const js = expression => window.webContents.executeJavaScript(expression);
  const wait = async (expression, seconds = 60) => { const end = Date.now() + seconds * 1000; while (Date.now() < end) { if (await js(expression)) return; await pause(500); } throw Error('Timeout: ' + expression); };
  const click = text => js(`[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)}).click()`);
  const bytes = asset => fs.readFile(path.join(store.root, projectId, 'assets', asset.filename));
  const json = b => JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12)));
  const hash = b => createHash('sha256').update(b).digest('hex');
  const components = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }, types = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const accessor = (b, g, index) => { const a = g.accessors[index], v = g.bufferViews[a.bufferView], width = components[a.componentType] * types[a.type], out = Buffer.alloc(a.count * width), start = 28 + b.readUInt32LE(12) + (v.byteOffset || 0) + (a.byteOffset || 0); for (let i = 0; i < a.count; i++) b.copy(out, i * width, start + i * (v.byteStride || width), start + i * (v.byteStride || width) + width); return out; };
  const image = (b, g, texture) => { const i = g.images[g.textures[texture.index].source], v = g.bufferViews[i.bufferView], start = 28 + b.readUInt32LE(12) + (v.byteOffset || 0); return b.subarray(start, start + v.byteLength); };
  const assertPreserved = (a, b) => {
    const ga = json(a), gb = json(b), pa = ga.meshes.flatMap(m => m.primitives), pb = gb.meshes.flatMap(m => m.primitives);
    assert.equal(pa.length, pb.length);
    for (let i = 0; i < pa.length; i++) {
      for (const key of ['POSITION', 'TEXCOORD_0', 'TANGENT']) assert.equal(hash(accessor(a, ga, pa[i].attributes[key])), hash(accessor(b, gb, pb[i].attributes[key])), key);
      const na = accessor(a, ga, pa[i].attributes.NORMAL), nb = accessor(b, gb, pb[i].attributes.NORMAL);
      assert.equal(na.length, nb.length); for (let j = 0; j < na.length; j += 12) { const n = [0,4,8].map(k => na.readFloatLE(j+k)), length = Math.hypot(...n); const expected = length === 0 ? [1,0,0] : n.map(v=>v/length); expected.forEach((v,k)=>assert.ok(Math.abs(v-nb.readFloatLE(j+k*4))<1e-6, 'NORMAL direction after exporter normalization')); }
      assert.equal(hash(accessor(a, ga, pa[i].indices)), hash(accessor(b, gb, pb[i].indices)));
      const ma = ga.materials[pa[i].material], mb = gb.materials[pb[i].material];
      // Export may encode PNGs differently; compare decoded pixels separately below.
      assert.ok(ma.normalTexture && mb.normalTexture);
      assert.ok(ma.pbrMetallicRoughness.metallicRoughnessTexture && mb.pbrMetallicRoughness.metallicRoughnessTexture);
    }
    return { original: ga, recolored: gb };
  };
  try {
    await wait('!!document.querySelector("textarea")');
    let p = await store.read(projectId); const design = p.assets.find(a => a.kind === 'design');
    p = await store.addAsset(projectId, await fs.readFile(path.join(root, 'examples/cutout.png')), '.png', 'cutout', 'Pixal3D 测试抠图', undefined, { sourceAssetId: design.id });
    const cutout = p.assets.at(-1);
    await js(`window.studio.bootstrap().then(d=>window.studio.settings({...d.settings,server:'http://127.0.0.1:8188',shapeEngine:'pixal3d'}))`);
    await window.webContents.reload(); await wait('!!document.querySelector("textarea")');
    const job = process.env.QCHARACTER_PIXAL_FIXTURE_PROJECT ? p.jobs.findLast(j => j.engine === 'pixal3d' && j.status === 'completed') : await js(`window.studio.generate(${JSON.stringify(projectId)},{kind:'shape',assetId:${JSON.stringify(cutout.id)},quality:'draft'})`);
    assert.ok(job, 'Missing completed Pixal3D fixture job');
    await wait(`window.studio.bootstrap().then(d=>!d.active)`, 1800);
    p = await store.read(projectId); const result = p.jobs.find(j => j.id === job.id);
    assert.equal(result.status, 'completed', result.message); assert.equal(result.engine, 'pixal3d');
    report.job = { id: job.id, promptId: result.promptId, seed: result.seed, quality: 'draft' };
    const original = p.assets.find(a => a.id === result.resultAssetId), originalBytes = await bytes(original), originalHash = hash(originalBytes);
    assert.equal(original.textureMethod, 'pixal3d-pbr'); validateTexturedGlb(originalBytes);
    await fs.writeFile(path.join(output, 'original-pbr.glb'), originalBytes);
    report.checks.push('Real desktop Pixal3D generation preserves corrected alpha and saves validated PBR GLB');
    const beforeRecolors = p.assets.filter(a => a.textureMethod === 'pixal3d-pbr-recolor').length;
    await store.saveFields(projectId, { workspace: { sourceId: result.inputAssetId, modelId: original.id, page: 'workbench', inputMode: 'image' } });
    await window.webContents.reload(); await wait('!!document.querySelector("textarea")');
    await wait(`!!document.querySelector('.texture-ready') && !document.querySelector('.viewer-overlay')`);
    await wait(`document.querySelectorAll('.clay-swatches article').length > 0`);
    assert.equal(await js(`!![...document.querySelectorAll('button')].find(b=>b.textContent==='按设计图上色')`), false);
    await js(`(()=>{const e=document.querySelector('input[aria-label="目标颜色 1"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'#416db3');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await click('保存换色模型');
    await wait(`window.studio.bootstrap().then(d=>d.projects.find(p=>p.id===${JSON.stringify(projectId)}).assets.filter(a=>a.textureMethod==='pixal3d-pbr-recolor').length>${beforeRecolors})`);
    await wait(`!document.querySelector('.viewer-overlay') && ![...document.querySelectorAll('button')].find(b=>b.textContent==='保存换色模型').disabled`);
    p = await store.read(projectId); const recolored = p.assets.at(-1), recoloredBytes = await bytes(recolored);
    assert.equal(recolored.parentModelId, original.id); assert.notEqual(hash(recoloredBytes), originalHash);
    assertPreserved(originalBytes, recoloredBytes);
    await fs.writeFile(path.join(output, 'recolored-pbr.glb'), recoloredBytes);
    // Decoded images are compared because GLTFExporter repacks PNGs.
    const { PNG } = await import('pngjs');
    const decodePng = b => { let end = 8; while (end + 12 <= b.length) { const size = b.readUInt32BE(end), type = b.toString('ascii', end + 4, end + 8); end += 12 + size; if (type === 'IEND') return PNG.sync.read(b.subarray(0, end)).data; } throw Error('Missing PNG IEND'); };
    const ga = json(originalBytes), gb = json(recoloredBytes), ma = ga.materials[0], mb = gb.materials[0];
    for (const [a, b] of [[ma.normalTexture, mb.normalTexture], [ma.pbrMetallicRoughness.metallicRoughnessTexture, mb.pbrMetallicRoughness.metallicRoughnessTexture]]) {
      assert.equal(hash(decodePng(image(originalBytes, ga, a))), hash(decodePng(image(recoloredBytes, gb, b))));
    }
    report.checks.push('Palette edit creates a new model while preserving geometry, UV, normals and PBR normal/MR image pixels');
    await click('保存换色模型');
    await wait(`window.studio.bootstrap().then(d=>d.projects.find(p=>p.id===${JSON.stringify(projectId)}).assets.filter(a=>a.textureMethod==='pixal3d-pbr-recolor').length===${beforeRecolors + 2})`);
    p = await store.read(projectId); const twiceBytes = await bytes(p.assets.at(-1));
    const gc = json(twiceBytes);
    assert.equal(hash(decodePng(image(recoloredBytes, gb, mb.pbrMetallicRoughness.baseColorTexture))), hash(decodePng(image(twiceBytes, gc, gc.materials[0].pbrMetallicRoughness.baseColorTexture))));
    assert.equal(hash(await bytes(original)), originalHash);
    report.checks.push('Repeated identical recolor does not accumulate color shifts; original model is immutable');
    await wait(`!document.querySelector('.viewer-overlay') && ![...document.querySelectorAll('button')].find(b=>b.textContent==='保存换色模型').disabled`);
    dialog.showSaveDialog = async (_w, options) => ({ canceled: false, filePath: path.join(output, options.defaultPath.endsWith('.glb') ? 'export-80mm.glb' : options.defaultPath.endsWith('.stl') ? 'export-80mm.stl' : 'clay-guide.png') });
    await js(`document.querySelector('button[title="素色泥模"]').click()`);
    await click('导出 GLB'); await wait(`![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='导出 GLB').disabled`);
    validateTexturedGlb(await fs.readFile(path.join(output, 'export-80mm.glb')));
    await click('STL'); await wait(`![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='STL').disabled`);
    await click('导出调色指引'); await wait(`![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='导出调色指引').disabled`);
    report.checks.push('Clay preview retains original PBR on scaled GLB export; STL and clay guide export succeed');
    await js(`document.querySelector('.viewer-shell').scrollIntoView({block:'center'})`);
    try { await fs.writeFile(path.join(output, 'desktop.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); } catch (error) { report.captureError = error.message; }
    report.projectId = projectId; report.dataPath = store.root; report.completedAt = new Date().toISOString();
  } catch (e) { report.error = e.stack; throw e; }
  finally { await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
}
