import { startVisionReview } from './vision-runner.mjs';
import { DEFAULT_VISION_MODEL, assertVisionReady, acceptedFinding } from './vision.mjs';
import { PNG } from 'pngjs';
import { assertConsistencyReady, validateRepairMask, compositeRepair, repairPrompt } from './consistency.mjs';
import { VIEW_ROLES, VIEW_LABELS, readyMultiView, prepareMultiViewImages } from './multiview.mjs';
import { PIXAL_DEFAULTS, buildPixal3DWorkflow, pixalCapabilities } from './pixal3d.mjs';
import { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, nativeImage, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ProjectStore, safeAsset, writeJson } from './store.mjs';
import { ComfyClient, normalizeServer } from './comfy.mjs';
import { buildDesignWorkflow, buildQwenEditWorkflow, buildRepairWorkflow, buildMatteWorkflow, buildShapeWorkflow, validateWorkflow } from './workflows.mjs';
import { prepareShapeImage, alphaSummary, applyForegroundMask, extractAlphaMask, validateEditedMask } from './background.mjs';
import { validateTexturedGlb, normalizeClayGuide, normalizeTextureConfig } from './texture.mjs';
import { SyncServer } from './sync-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
protocol.registerSchemesAsPrivileged([{ scheme: 'qasset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
let window, store, settingsFile, settings, active;
let syncServer;const syncEditing=new Set();
const pendingExports = new Set();
async function writeExport(file, bytes) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  const writing = (async () => { try { await fs.writeFile(temp, bytes, { flag: 'wx' }); await fs.rename(temp, file); } catch (error) { await fs.unlink(temp).catch(() => {}); throw error; } })();
  pendingExports.add(writing);
  try { await writing; } finally { pendingExports.delete(writing); }
}
const smokeMode = process.env.QCHARACTER_SMOKE && !app.isPackaged;
if (smokeMode) app.setPath('userData', path.join(here, '..', '.runtime', process.env.QCHARACTER_SMOKE === 'pixal' ? 'pixal-smoke' : process.env.QCHARACTER_SMOKE === 'color' ? 'color-desktop' : process.env.QCHARACTER_SMOKE === 'mask' ? 'mask-desktop' : process.env.QCHARACTER_SMOKE === 'qwen' ? 'qwen-desktop' : 'desktop-smoke'));
const defaults = { visionModel: DEFAULT_VISION_MODEL, server: 'http://127.0.0.1:8188', comfyPath: 'F:\\ComfyUI-aki\\ComfyUI', designCheckpoint: 'sdXL_v10VAEFix.safetensors', shapeCheckpoint: 'hunyuan_3d_v2.1.safetensors', imageEngine: 'qwen21', qwenModel: 'qwen_image_2.1_int8_convrot.safetensors', qwenEncoder: 'qwen3vl_8b_int8_convrot.safetensors', qwenVae: 'qwen_image_2.1_vae_bf16.safetensors', backgroundModel: 'birefnet.safetensors', ...PIXAL_DEFAULTS };

function emit(job) { if (window && !window.isDestroyed()) window.webContents.send('job', job); }
function handler(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('无效的窗口请求。');
    return fn(...args);
  });
}
function assertIdle() { if (active) throw new Error('请先等待当前任务结束，或取消当前任务。'); }
async function bootstrap() { return { settings, projects: await store.list(), dataPath: store.root, active: active?.job ?? null, version: app.getVersion() }; }
async function connect() {
  const result = await new ComfyClient(settings.server).capabilities();
  const required = ['ImageOnlyCheckpointLoader', 'Hunyuan3Dv2Conditioning', 'EmptyLatentHunyuan3Dv2', 'ModelSamplingAuraFlow', 'VAEDecodeHunyuan3D', 'VoxelToMesh', 'SaveGLB', 'CLIPVisionEncode', 'LoadImage', 'KSampler'];
  return { pixal: pixalCapabilities(result.info), stats: result.stats, checkpoints: result.checkpoints.filter(name => /sdxl|illustrious|hassaku/i.test(name)), shapeCheckpoints: result.shapeCheckpoints, missingShapeNodes: required.filter(name => !result.info[name]), qwenModels: result.qwenModels, qwenEncoders: result.qwenEncoders, qwenVaes: result.qwenVaes, backgroundModels: result.backgroundModels, missingEditNodes: ['UNETLoader', 'CLIPLoader', 'VAELoader', 'TextEncodeQwenImage21'].filter(name => !result.info[name]), missingVisionNodes: ['QCharacterVisionReview','JoinImageWithAlpha','LoadImage'].filter(name=>!result.info[name]), missingMatteNodes: ['LoadBackgroundRemovalModel', 'RemoveBackground', 'MaskToImage'].filter(name => !result.info[name]) };
}
function normalizedImage(bytes) {
  let decoded = nativeImage.createFromBuffer(bytes);
  if (decoded.isEmpty()) throw new Error('无法读取角色图片。');
  const size = decoded.getSize();
  if (Math.max(size.width, size.height) > 2048) decoded = decoded.resize(size.width > size.height ? { width: 2048 } : { height: 2048 });
  return decoded.toPNG();
}
async function saveCutout(projectId, sourceId, imageBytes, maskBytes, job, preserveAlpha = false) {
  const cutout = preserveAlpha ? imageBytes : applyForegroundMask(imageBytes, maskBytes);
  const withMask = await store.addAsset(projectId, maskBytes, '.png', 'mask', '前景蒙版 · 白色保留', job.id, { sourceAssetId: sourceId });
  const maskAsset = withMask.assets.at(-1);
  const saved = await store.addAsset(projectId, cutout, '.png', 'cutout', '人物透明抠图 · 请检查衣服与配饰', job.id, { sourceAssetId: sourceId, maskAssetId: maskAsset.id, viewRole: job.viewRole, ...(job.repairMaskId?{parentCutoutId:job.inputAssetId,repairMaskId:job.repairMaskId,repairInstruction:job.repairInstruction,revisionType:'repair'}:{}) });
  job.resultAssetId = saved.assets.at(-1).id;
  if (job.viewRole) await store.setView(projectId, job.viewRole, job.resultAssetId, job.viewExpectedId);
}
async function runGeneration(projectId, options) {
  assertIdle();
  if (!['design', 'shape', 'matte'].includes(options.kind)) throw new Error('无效的生成任务。');
  let project;
  const client = new ComfyClient(settings.server);
  const job = { id: randomUUID(), projectId, kind: options.kind, inputAssetId: options.assetId, status: 'submitting', createdAt: new Date().toISOString(), message: '检查模型与工作流…', seed: Math.floor(Math.random() * 0x100000000), server: settings.server };
  const state = { job, client, cancelled: false, cancelRequested: false, closeSocket: null, targetedInterrupt: false };
  active = state;
  try { project = await store.read(projectId); await store.saveJob(projectId, job); }
  catch (error) { active = null; throw error; }
  emit(job);
  void (async () => {
    try {
      let image, source, sourceBytes, views;
      const multi = options.kind === 'shape' && options.multiView ? readyMultiView(project) : null;
      if (multi) {
        assertConsistencyReady(project); assertVisionReady(project);
        if (settings.shapeEngine === 'hunyuan3d') throw new Error('多视图建模请选择 Pixal3D 生成方式。');
        options = { ...options, assetId: multi.views.front }; job.inputAssetId = multi.views.front;
        job.inputViewIds = { ...multi.views }; job.viewFov = multi.fov;
      }
      if (options.viewRole) {
        if (!VIEW_ROLES.includes(options.viewRole) || options.kind === 'shape') throw new Error('视图生成方向无效。');
        job.viewRole = options.viewRole; job.viewExpectedId = project.multiView?.views[options.viewRole] || '';
        if (options.kind === 'design' && options.viewRole !== 'front' && !options.repairMaskId) {
          const front = project.multiView?.views.front;
          if (!front || settings.imageEngine !== 'qwen21') throw new Error('请先指定正面设计图，并使用 Qwen 参考编辑生成侧背面。');
          options = { ...options, assetId: front }; job.inputAssetId = front;
        }
      }
      if (options.assetId) {
        source = project.assets.find(item => item.id === options.assetId && !['model', 'mask'].includes(item.kind));
        if (!source) throw new Error('找不到选中的角色图片。');
        sourceBytes = await fs.readFile(safeAsset(store.root, projectId, source.filename));
        if(!options.repairMaskId)sourceBytes=normalizedImage(sourceBytes);
        if(options.repairMaskId){
          if(source.kind!=='cutout'||project.multiView?.views[options.viewRole]!==source.id||settings.imageEngine!=='qwen21')throw new Error('重绘目标已变更，或未选择 Qwen 编辑，请重新打开目标视图。');
          if(options.referenceFindingId)acceptedFinding(project,options.referenceFindingId,options.viewRole,source.id);job.referenceFindingId=options.referenceFindingId;job.repairMaskId=options.repairMaskId;job.repairInstruction=options.instruction;repairPrompt(options.viewRole,options.instruction);
          const m=project.assets.find(a=>a.id===options.repairMaskId&&a.kind==='mask');if(!m)throw new Error('找不到重绘选区。');
          const decoded=PNG.sync.read(sourceBytes),selection=PNG.sync.read(await fs.readFile(safeAsset(store.root,projectId,m.filename)));validateRepairMask(decoded,selection);
          const flat=PNG.sync.read(sourceBytes);for(let i=0;i<flat.data.length;i+=4){const a=flat.data[i+3]/255;for(let c=0;c<3;c++)flat.data[i+c]=Math.round(flat.data[i+c]*a+255*(1-a));flat.data[i+3]=255;}
          image=await client.upload(PNG.sync.write(flat),'repair-source.png');
        }
        if (state.cancelRequested) throw new Error('QCHARACTER_CANCELLED');
        if (options.kind === 'matte' && alphaSummary(sourceBytes).hasTransparency) {
          job.engine = 'existing-alpha';
          await saveCutout(projectId, source.id, sourceBytes, extractAlphaMask(sourceBytes), job, true);
          job.status = 'completed'; job.message = '已保留图片原有透明通道。请检查衣服、头发和配饰，再生成 3D。';
          return;
        }
        if (options.kind === 'shape' && multi) {
          const decodedViews = {};
          for (const [role, id] of Object.entries(multi.views)) { const asset = project.assets.find(a => a.id === id); decodedViews[role] = PNG.sync.read(normalizedImage(await fs.readFile(safeAsset(store.root, projectId, asset.filename)))); }
          views = {};
          for (const [role, pixels] of Object.entries(prepareMultiViewImages(decodedViews))) {
            if (state.cancelRequested) throw new Error('QCHARACTER_CANCELLED');
            const bytes = PNG.sync.write(pixels);
            await store.addAsset(projectId, bytes, '.png', 'prepared', `${VIEW_LABELS[role]} · 多视图统一取景输入`, job.id, { sourceAssetId: multi.views[role], viewRole: role });
            views[role] = await client.upload(bytes, 'view.png');
          }
        } else if (options.kind === 'shape') {
          if (source.kind !== 'cutout') throw new Error('请先自动抠图，检查透明轮廓后再生成 3D。旧版颜色清理图不能直接用于此流程。');
          const bytes = settings.shapeEngine === 'hunyuan3d' ? prepareShapeImage(sourceBytes) : sourceBytes;
          await store.addAsset(projectId, bytes, '.png', 'prepared', settings.shapeEngine === 'hunyuan3d' ? '3D 输入 · 前景蒙版合成白底' : 'Pixal3D 输入 · 保留修正后的透明蒙版', job.id, { sourceAssetId: source.id });
          image = await client.upload(bytes, 'shape-input.png');
        } else if(!options.repairMaskId) {
          image = await client.upload(sourceBytes, 'source.png');
        }
      }
      if (state.cancelRequested) throw new Error('QCHARACTER_CANCELLED');
      if (options.kind === 'matte' && !image) throw new Error('请先选择一张图片。');
      const cap = await client.capabilities();
      const parts = (cap.stats.system.comfyui_version || '').split('.').map(Number);
      state.targetedInterrupt = parts[0] > 0 || parts[1] > 39 || (parts[1] === 39 && parts[2] >= 1);
      const references = [];
      if (options.kind === 'design' && options.viewRole && (options.viewRole !== 'front'||options.repairMaskId)) for (const role of VIEW_ROLES) {
        const id = project.multiView?.views[role], asset = project.assets.find(a => a.id === id && a.kind === 'cutout');
        if ((options.repairMaskId||role !== 'front') && role !== options.viewRole && asset) references.push(await client.upload(normalizedImage(await fs.readFile(safeAsset(store.root, projectId, asset.filename))), 'confirmed-view.png'));
      }
      const params = { views, fov: multi?.fov, viewRole: options.viewRole === 'front' ? undefined : options.viewRole, references, checkpoint: options.kind === 'shape' ? settings.shapeCheckpoint : settings.designCheckpoint, description: project.description, ratio: project.ratio, style: project.style, seed: job.seed, image, quality: ['draft', 'standard', 'high'].includes(options.quality) ? options.quality : 'standard', denoise: Math.min(0.95, Math.max(0.2, Number(options.denoise) || 0.65)) };
      const useQwen = options.kind === 'design' && image && settings.imageEngine === 'qwen21';
      const repairSelection=options.repairMaskId?project.assets.find(a=>a.id===options.repairMaskId):null;
      const repairSize=options.repairMaskId?PNG.sync.read(sourceBytes):null;
      const repairGraph=repairSelection?buildRepairWorkflow({...params,viewRole:options.viewRole,references,model:settings.qwenModel,encoder:settings.qwenEncoder,vae:settings.qwenVae,mask:await client.upload(await fs.readFile(safeAsset(store.root,projectId,repairSelection.filename)),'repair-mask.png'),width:repairSize.width,height:repairSize.height,instruction:options.instruction,backgroundModel:settings.backgroundModel}):null;
      const graph = repairGraph || (options.kind === 'shape' ? (settings.shapeEngine === 'hunyuan3d' ? buildShapeWorkflow(params) : buildPixal3DWorkflow({ ...params, ...settings })) : options.kind === 'matte' ? buildMatteWorkflow({ image, model: settings.backgroundModel }) : useQwen ? buildQwenEditWorkflow({ ...params, model: settings.qwenModel, encoder: settings.qwenEncoder, vae: settings.qwenVae }) : buildDesignWorkflow(params));
      validateWorkflow(graph, cap.info);
      job.workflow = graph; job.engine = options.kind === 'shape' ? (settings.shapeEngine === 'hunyuan3d' ? 'hunyuan3d' : multi ? 'pixal3d-multiview' : 'pixal3d') : options.kind === 'matte' ? 'birefnet' : useQwen ? 'qwen21' : 'sdxl';
      if(repairGraph)job.engine='qwen21-repair';
      state.closeSocket = client.watch(event => {
        if (event.data?.prompt_id !== job.promptId || state.cancelRequested) return;
        if (event.type === 'progress') { job.progress = Math.round(event.data.value / event.data.max * 100); job.message = `采样中 · ${event.data.value} / ${event.data.max}`; emit(job); }
        if (event.type === 'executing' && event.data.node) { job.node = event.data.node; job.progress = undefined; job.message = `正在处理 · ${graph[event.data.node]?.class_type ?? event.data.node}`; emit(job); }
      });
      const response = await client.json('/prompt', { prompt: graph, client_id: client.clientId });
      if (!response.prompt_id) throw new Error(JSON.stringify(response.node_errors || response.error || response));
      job.promptId = response.prompt_id;
      job.status = 'running'; job.message = '已加入 ComfyUI 队列，等待生成…';
      await store.saveJob(projectId, job); emit(job);
      if (state.cancelRequested) { await client.cancel(job.promptId, state.targetedInterrupt); state.cancelled = true; }
      const outputs = await client.waitFor(job.promptId, options.kind, () => state.cancelled, message => { job.message = message; emit(job); });
      if (state.cancelRequested) throw new Error('QCHARACTER_CANCELLED');
      job.status = 'downloading'; job.message = '正在保存生成结果…'; emit(job);
      for (const output of outputs) {
        let bytes = await client.download(output);
        if (state.cancelRequested) throw new Error('QCHARACTER_CANCELLED');
        if (options.kind === 'matte') {
          await saveCutout(projectId, source.id, sourceBytes, bytes, job);
          continue;
        }
        if(options.repairMaskId){
          const selection=PNG.sync.read(await fs.readFile(safeAsset(store.root,projectId,repairSelection.filename)));
          bytes=PNG.sync.write(compositeRepair(PNG.sync.read(sourceBytes),PNG.sync.read(bytes),selection));
          const raw=await store.addAsset(projectId,bytes,'.png','design','局部重绘原图',job.id,{sourceAssetId:source.id,repairMaskId:options.repairMaskId,repairInstruction:options.instruction,viewRole:job.viewRole});
          await saveCutout(projectId,raw.assets.at(-1).id,bytes,extractAlphaMask(bytes),job,true);
          continue;
        }
        const extension = path.extname(output.filename).toLowerCase();
        if (options.kind === 'shape' && bytes.subarray(0, 4).toString() !== 'glTF') throw new Error('生成服务返回的文件不是有效的 GLB。');
        if (job.engine?.startsWith('pixal3d')) validateTexturedGlb(bytes);
        const updated = await store.addAsset(projectId, bytes, extension, options.kind === 'shape' ? 'model' : 'design', options.kind === 'shape' ? (job.engine?.startsWith('pixal3d') ? (multi ? 'Pixal3D · 多视图 AI 贴图模型' : 'Pixal3D · AI 贴图模型') : '混元 3D 泥模') : job.viewRole ? `${VIEW_LABELS[job.viewRole]} · 角色设计图` : useQwen ? 'Qwen 2.1 人物 Q 版设计' : 'Q 版设计图', job.id, { sourceAssetId: source?.id, viewRole: job.viewRole, ...(multi ? { inputViewIds: job.inputViewIds, viewFov: multi.fov } : {}), ...(job.engine?.startsWith('pixal3d') ? { textureMethod: 'pixal3d-pbr', textureSourceId: source.id } : {}) });
        job.resultAssetId = updated.assets.at(-1).id;
        if (job.viewRole) await store.setView(projectId, job.viewRole, job.resultAssetId, job.viewExpectedId);
      }
      job.status = 'completed'; job.message = options.kind === 'matte' ? '自动抠图完成。请对照原图检查衣服、头发和配饰，再生成 3D。' : '生成完成，已保存到作品。';
    } catch (error) {
      job.status = state.cancelRequested || error.message === 'QCHARACTER_CANCELLED' ? 'cancelled' : 'failed';
      job.message = job.status === 'cancelled' ? (job.promptId && !state.targetedInterrupt ? '已停止接收结果。该版本服务不支持定向中断，计算可能继续。' : '任务已取消。') : error.message;
    } finally {
      state.closeSocket?.();
      job.finishedAt = new Date().toISOString();
      try { await store.saveJob(projectId, job); } catch (error) { job.message += ` 保存任务记录失败：${error.message}`; }
      if (active === state) active = null;
      emit(job);
    }
  })();
  return job;
}

app.whenReady().then(async () => {
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  try { settings = { ...defaults, ...JSON.parse(await fs.readFile(settingsFile, 'utf8')) }; } catch { settings = { ...defaults }; }
  store = new ProjectStore(path.join(app.getPath('userData'), 'projects'));
  await store.recoverJobs();
  const seal = value => { if (!safeStorage.isEncryptionAvailable()) throw new Error('系统无法加密保存同步证书，请检查 Windows 用户环境。'); return safeStorage.encryptString(value).toString('base64'); };
  syncServer = new SyncServer({ store, directory: path.join(app.getPath('userData'), 'sync-service'), seal, unseal: value => safeStorage.decryptString(Buffer.from(value,'base64')), busy: id => active?.job.projectId === id || syncEditing.has(id), changed: id => { if (window && !window.isDestroyed()) window.webContents.send('sync-event',{type:'changed',projectId:id}); } });
  await syncServer.init();
  if (!smokeMode && (await store.list()).length === 0) {
    const example = await store.create('示例 · 绿色围裙女孩');
    await store.saveFields(example.id, { description: 'a young girl with short brown hair, wearing a green apron dress, round face, gentle smile', ratio: '2.5', style: 'clay', heightMm: 80 });
    const withDesign = await store.addAsset(example.id, await fs.readFile(path.join(here, '..', 'examples', 'design.png')), '.png', 'design', 'SDXL 设计示例');
    const designId = withDesign.assets.at(-1).id;
    const withMask = await store.addAsset(example.id, await fs.readFile(path.join(here, '..', 'examples', 'mask.png')), '.png', 'mask', 'BiRefNet 前景蒙版', undefined, { sourceAssetId: designId });
    await store.addAsset(example.id, await fs.readFile(path.join(here, '..', 'examples', 'cutout.png')), '.png', 'cutout', '语义抠图示例 · 白色衣袖保留', undefined, { sourceAssetId: designId, maskAssetId: withMask.assets.at(-1).id });
    await store.addAsset(example.id, await fs.readFile(path.join(here, '..', 'examples', 'model.glb')), '.glb', 'model', '混元 3D 标准泥模示例');
  }
  let smokeProject;
  if (smokeMode) {
    settings.server = 'http://127.0.0.1:8199';
    const qwenSmoke = process.env.QCHARACTER_SMOKE === 'qwen';
    smokeProject = await store.create(qwenSmoke ? '验证样例 · Qwen 人物与白衣服抠图' : '验证样例 · 绿色围裙女孩');
    await store.saveFields(smokeProject.id, { description: qwenSmoke ? '' : 'a young girl with short brown hair, wearing a green apron dress, round face, gentle smile', ratio: '2.5', style: 'clay', heightMm: 80 });
    if (qwenSmoke) await store.addAsset(smokeProject.id, await fs.readFile(path.join(here, '..', 'docs', 'qwen-validation', 'reference-photo.png')), '.png', 'reference', '参考人物照片');
    const samples = process.env.QCHARACTER_SMOKE === 'color' ? path.join(here, '..', 'examples') : path.join(here, '..', 'docs', 'smoke-assets');
    await store.addAsset(smokeProject.id, await fs.readFile(path.join(samples, 'design.png')), '.png', 'design', '真实 SDXL 设计图');
    await store.addAsset(smokeProject.id, await fs.readFile(path.join(samples, 'model.glb')), '.glb', 'model', '真实混元 3D 泥模');
  }
  protocol.handle('qasset', async request => {
    try {
      const url = new URL(request.url);
      const filename = decodeURIComponent(url.pathname.slice(1));
      const assetPath = safeAsset(store.root, url.hostname, filename);
      const response = await net.fetch(pathToFileURL(assetPath).href);
      return new Response(response.body, { status: response.status, headers: { 'Content-Type': /\.glb$/i.test(filename) ? 'model/gltf-binary' : /\.png$/i.test(filename) ? 'image/png' : /\.webp$/i.test(filename) ? 'image/webp' : /\.jpe?g$/i.test(filename) ? 'image/jpeg' : 'application/octet-stream', 'Access-Control-Allow-Origin': '*', 'Content-Security-Policy': "default-src 'none'" } });
    } catch { return new Response('File not found', { status: 404 }); }
  });
  window = new BrowserWindow({ width: 1480, height: 980, minWidth: 1100, minHeight: 760, backgroundColor: '#f7f6f2', title: 'Q Character Studio', autoHideMenuBar: true, webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (smokeMode) window.webContents.setBackgroundThrottling(false);
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  let closing = false;
  window.on('close', event => {
    if (closing) return;
    event.preventDefault(); closing = true;
    void Promise.allSettled([syncServer.stop(), store.pending, ...pendingExports]).finally(() => window.destroy());
  });
  handler('bootstrap', bootstrap);
  handler('sync-status',()=>syncServer.status());
  handler('sync-configure',value=>syncServer.configure(value));
  handler('sync-pair-code',()=>syncServer.pairCode());
  handler('sync-revoke',id=>syncServer.revoke(String(id)));
  handler('sync-editing',(id,editing)=>{if(editing)syncEditing.add(id);else syncEditing.delete(id);});
  handler('settings', async value => {
    assertIdle();
    const next = { server: normalizeServer(value.server), imageEngine: value.imageEngine === 'sdxl' ? 'sdxl' : 'qwen21', shapeEngine: value.shapeEngine === 'hunyuan3d' ? 'hunyuan3d' : 'pixal3d' };
    for (const key of ['visionModel', 'comfyPath', 'designCheckpoint', 'shapeCheckpoint', 'qwenModel', 'qwenEncoder', 'qwenVae', 'backgroundModel', 'pixalModel', 'pixalMultiModel', 'pixalEncoder', 'pixalShapeVae', 'pixalTextureVae']) next[key] = String(value[key] ?? defaults[key]).slice(0, 500);
    settings = next;
    await writeJson(settingsFile, settings); return settings;
  });
  handler('connect', connect);
  handler('create-project', name => store.create(String(name || '我的小角色')));
  handler('save-project', async (id, fields) => {
    const value = {};
    if ('name' in fields) value.name = String(fields.name || '我的小角色').slice(0,80);
    if ('description' in fields) value.description = String(fields.description || '').slice(0,6000);
    if ('ratio' in fields) value.ratio = ['2','2.5','3'].includes(fields.ratio) ? fields.ratio : '2.5';
    if ('style' in fields) value.style = fields.style === 'anime' ? 'anime' : 'clay';
    if ('heightMm' in fields) value.heightMm = Math.min(500,Math.max(10,Number(fields.heightMm)||80));
    if ('multiView' in fields) value.multiView = fields.multiView;
    if ('consistency' in fields) value.consistency = fields.consistency;
    if ('visionReview' in fields) value.visionReview = fields.visionReview;
    if (fields.workspace) {
      const w=fields.workspace, p=await store.read(id);
      if (!['design','workbench','library'].includes(w.page)||!['text','image'].includes(w.inputMode)||[w.sourceId,w.modelId].some(a=>a&&!p.assets.some(asset=>asset.id===a))) throw new Error('作品编辑位置无效。');
      value.workspace={sourceId:String(w.sourceId||''),modelId:String(w.modelId||''),page:w.page,inputMode:w.inputMode};
    }
    if (fields.clayGuide) {
      value.clayGuide = normalizeClayGuide(fields.clayGuide);
      if (!(await store.read(id)).assets.some(a => a.id === value.clayGuide.referenceId && a.kind === 'cutout')) throw new Error('请使用透明抠图作为调色参考。');
    }
    return store.saveFields(id, value);
  });
  handler('import-asset', async (id, kind) => {
    assertIdle(); await store.read(id);
    const isModel = kind === 'model';
    const selected = await dialog.showOpenDialog(window, { title: isModel ? '导入已有 3D 模型' : '选择角色参考图', properties: ['openFile'], filters: [{ name: isModel ? '3D 模型' : '图片', extensions: isModel ? ['glb', 'stl', 'obj'] : ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (selected.canceled) return null;
    const file = selected.filePaths[0]; const stat = await fs.stat(file);
    if (stat.size > 256 * 1024 * 1024) throw new Error('文件不能超过 256MB。');
    const bytes = await fs.readFile(file); const extension = path.extname(file).toLowerCase();
    if (isModel && !['.glb', '.stl', '.obj'].includes(extension)) throw new Error('请选择 GLB、STL 或 OBJ。');
    if (!isModel && !['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) throw new Error('请选择 PNG、JPG 或 WebP。');
    await store.addAsset(id, bytes, extension, isModel ? 'model' : 'reference', path.basename(file));
    return store.read(id);
  });
  handler('repair-view', async(projectId,role,assetId,bytes,instruction,findingId)=>{
    assertIdle();repairPrompt(role,instruction);
    if(!(bytes instanceof Uint8Array)||bytes.length>64*1024*1024)throw new Error('重绘选区无效。');
    const p=await store.read(projectId),a=p.assets.find(a=>a.id===assetId&&a.kind==='cutout');
    if(!a||p.multiView?.views[role]!==assetId)throw new Error('目标视图已变更，请重新打开。');
    if(findingId)acceptedFinding(p,findingId,role,assetId);
    const source=PNG.sync.read(await fs.readFile(safeAsset(store.root,projectId,a.filename)));validateRepairMask(source,PNG.sync.read(Buffer.from(bytes)));
    const saved=await store.addAsset(projectId,Buffer.from(bytes),'.png','mask','局部重绘选区',undefined,{sourceAssetId:assetId,viewRole:role});
    return runGeneration(projectId,{kind:'design',assetId,viewRole:role,repairMaskId:saved.assets.at(-1).id,instruction,referenceFindingId:findingId});
  });
  handler('review-views', projectId=>{assertIdle();return startVisionReview(projectId,{store,client:new ComfyClient(settings.server),model:settings.visionModel,emit,activate:state=>{active=state;},finish:state=>{if(active===state)active=null;}});});
  handler('generate', runGeneration);
  handler('set-view', async (id, role, assetId, expected) => { assertIdle(); return store.setView(id, role, assetId, expected); });
  handler('save-mask', async (projectId, cutoutId, bytes) => {
    assertIdle();
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 64 * 1024 * 1024) throw new Error('无效的蒙版文件。');
    const project = await store.read(projectId);
    const cutout = project.assets.find(asset => asset.id === cutoutId && asset.kind === 'cutout');
    const source = cutout && project.assets.find(asset => asset.id === cutout.sourceAssetId && !['mask', 'model'].includes(asset.kind));
    if (!source) throw new Error('找不到这张抠图的原始图片。');
    const sourceBytes = normalizedImage(await fs.readFile(safeAsset(store.root, projectId, source.filename)));
    const maskBytes = Buffer.from(bytes);
    const corrected = validateEditedMask(maskBytes, sourceBytes);
    return store.saveMaskRevision(projectId, cutoutId, maskBytes, corrected);
  });
  handler('save-texture', async (id, modelId, referenceId, bytes, config) => {
    assertIdle();
    if (!(bytes instanceof Uint8Array)) throw new Error('带贴图模型格式无效。');
    const project = await store.read(id);
    if (!project.assets.some(a => a.id === modelId && a.kind === 'model') || !project.assets.some(a => a.id === referenceId && a.kind === 'cutout')) throw new Error('请选择模型和已经检查的透明抠图。');
    validateTexturedGlb(Buffer.from(bytes)); const textureConfig = normalizeTextureConfig(config);
    const pbr = project.assets.find(a => a.id === modelId)?.textureMethod?.startsWith('pixal3d-pbr');
    return store.addAsset(id, bytes, '.glb', 'model', pbr ? 'Pixal3D · 保留 AI 材质的换色模型' : '彩色模型 · 设计图贴图', undefined, { parentModelId: modelId, sourceAssetId: referenceId, textureSourceId: referenceId, textureMethod: pbr ? 'pixal3d-pbr-recolor' : 'reference-projection', textureConfig });
  });
  handler('cancel', async () => {
    if (!active) return;
    const state = active; state.cancelRequested = true;
    try { if (state.job.promptId && state.job.status === 'running') await state.client.cancel(state.job.promptId, state.targetedInterrupt); }
    finally { state.cancelled = true; state.job.message = '正在取消当前任务…'; emit(state.job); }
  });
  handler('export-asset', async (id, assetId) => {
    const project = await store.read(id); const asset = project.assets.find(x => x.id === assetId);
    if (!asset) throw new Error('找不到该文件。');
    const result = await dialog.showSaveDialog(window, { defaultPath: `${project.name}${path.extname(asset.filename)}` });
    if (!result.canceled) await writeExport(result.filePath, await fs.readFile(safeAsset(store.root, id, asset.filename)));
    return !result.canceled;
  });
  handler('export-bytes', async ({ name, bytes }) => {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 256 * 1024 * 1024 || !/\.(glb|stl|png)$/i.test(name)) throw new Error('无效的导出文件。');
    const result = await dialog.showSaveDialog(window, { defaultPath: path.basename(name) });
    if (!result.canceled) await writeExport(result.filePath, bytes);
    return !result.canceled;
  });
  handler('open-folder', async id => { await store.read(id); await shell.openPath(path.join(store.root, id)); });
  handler('open-comfy', () => shell.openExternal(normalizeServer(settings.server)));
  await window.loadFile(path.join(here, '..', 'dist', 'index.html'));
  if (smokeMode) {
    try { await (await import(process.env.QCHARACTER_SMOKE === 'pixal' ? '../scripts/pixal-desktop-smoke.mjs' : process.env.QCHARACTER_SMOKE === 'color' ? '../scripts/color-desktop-smoke.mjs' : process.env.QCHARACTER_SMOKE === 'mask' ? '../scripts/mask-desktop-smoke.mjs' : process.env.QCHARACTER_SMOKE === 'qwen' ? '../scripts/qwen-desktop-smoke.mjs' : '../scripts/desktop-smoke.mjs')).runDesktopSmoke({ window, store, projectId: smokeProject.id, root: path.join(here, '..'), mode: process.env.QCHARACTER_SMOKE }); }
    catch (error) { await fs.writeFile(path.join(here, '..', 'docs', 'desktop-validation-error.txt'), error.stack); }
    finally { app.quit(); }
  }
});
app.on('before-quit', () => { active?.closeSocket?.(); });
app.on('window-all-closed', () => app.quit());
