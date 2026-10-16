import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function safeAsset(root, projectId, filename) {
  if (!/^[a-f0-9-]{36}$/.test(projectId) || !/^[a-zA-Z0-9_.-]+$/.test(filename) || filename === '.' || filename === '..') throw new Error('无效的作品文件路径。');
  return path.join(root, projectId, 'assets', filename);
}

export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
  // Windows can briefly deny replacement while a reader or virus scanner holds
  // the destination. Keep the old JSON intact and retry the atomic operation.
  for (let attempt = 0; ; attempt++) {
    try { await fs.rename(temp, file); break; }
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 5) throw error;
      await new Promise(resolve => setTimeout(resolve, 30 * 2 ** attempt));
    }
  }
}

export class ProjectStore {
  constructor(root) { this.root = root; this.pending = Promise.resolve(); }
  mutate(fn) {
    const result = this.pending.then(fn);
    this.pending = result.catch(() => {});
    return result;
  }
  projectFile(id) { safeAsset(this.root, id, 'check'); return path.join(this.root, id, 'project.json'); }
  async list() {
    await fs.mkdir(this.root, { recursive: true });
    const dirs = await fs.readdir(this.root, { withFileTypes: true });
    const projects = [];
    for (const dir of dirs) {
      if (!dir.isDirectory() || !/^[a-f0-9-]{36}$/.test(dir.name)) continue;
      try { projects.push(await this.read(dir.name)); } catch { /* A damaged project stays on disk for recovery. */ }
    }
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async read(id) { return JSON.parse(await fs.readFile(this.projectFile(id), 'utf8')); }
  async create(name) {
    const now = new Date().toISOString();
    const project = { id: randomUUID(), name: String(name || '我的小角色').slice(0, 80), createdAt: now, updatedAt: now, description: '', ratio: '2.5', style: 'clay', heightMm: 80, assets: [], jobs: [] };
    await fs.mkdir(path.join(this.root, project.id, 'assets'), { recursive: true });
    await writeJson(this.projectFile(project.id), project);
    return project;
  }
  async saveFields(id, fields) {
    return this.mutate(async () => {
    const project = await this.read(id);
    for (const key of ['name', 'description', 'ratio', 'style', 'heightMm', 'clayGuide', 'workspace']) if (key in fields) project[key] = fields[key];
    project.updatedAt = new Date().toISOString();
    await writeJson(this.projectFile(id), project);
    return project;
    });
  }
  async addAsset(id, bytes, extension, kind, label, jobId, metadata = {}) {
    return this.mutate(async () => {
    if (!['.png', '.jpg', '.jpeg', '.webp', '.glb', '.stl', '.obj'].includes(extension)) throw new Error('不支持的文件格式。');
    const asset = { id: randomUUID(), filename: `${randomUUID()}${extension}`, kind, label, createdAt: new Date().toISOString(), ...(jobId ? { jobId } : {}) };
    for (const key of ['sourceAssetId', 'maskAssetId', 'parentModelId', 'textureSourceId', 'textureMethod', 'textureConfig']) if (metadata[key]) asset[key] = metadata[key];
    await fs.writeFile(safeAsset(this.root, id, asset.filename), bytes);
    const project = await this.read(id);
    project.assets.push(asset);
    project.updatedAt = asset.createdAt;
    await writeJson(this.projectFile(id), project);
    return project;
    });
  }
  async saveJob(id, job) {
    return this.mutate(async () => {
    const project = await this.read(id);
    const index = project.jobs.findIndex(x => x.id === job.id);
    if (index === -1) project.jobs.push(job); else project.jobs[index] = job;
    project.updatedAt = new Date().toISOString();
    await writeJson(this.projectFile(id), project);
    });
  }
  async saveMaskRevision(id, parentId, maskBytes, cutoutBytes) {
    return this.mutate(async () => {
      const project = await this.read(id);
      const parent = project.assets.find(asset => asset.id === parentId && asset.kind === 'cutout');
      if (!parent || !project.assets.some(asset => asset.id === parent.sourceAssetId && !['mask', 'model'].includes(asset.kind))) throw new Error('找不到这张抠图的原始图片。');
      const now = new Date().toISOString();
      const mask = { id: randomUUID(), filename: `${randomUUID()}.png`, kind: 'mask', label: '手动修正前景蒙版', createdAt: now, sourceAssetId: parent.sourceAssetId, parentCutoutId: parentId };
      const cutout = { id: randomUUID(), filename: `${randomUUID()}.png`, kind: 'cutout', label: '手动修正抠图', createdAt: now, sourceAssetId: parent.sourceAssetId, maskAssetId: mask.id, parentCutoutId: parentId, revisionType: 'manual' };
      const files = [safeAsset(this.root, id, mask.filename), safeAsset(this.root, id, cutout.filename)];
      const created = [];
      try {
        await fs.writeFile(files[0], maskBytes, { flag: 'wx' });
        created.push(files[0]);
        await fs.writeFile(files[1], cutoutBytes, { flag: 'wx' });
        created.push(files[1]);
        project.assets.push(mask, cutout); project.updatedAt = now;
        await writeJson(this.projectFile(id), project);
      } catch (error) {
        for (const file of created) await fs.unlink(file).catch(() => {});
        throw error;
      }
      return project;
    });
  }
  async recoverJobs() {
    for (const project of await this.list()) for (const job of project.jobs) {
      if (['submitting', 'running', 'downloading', 'cancelling'].includes(job.status)) {
        await this.saveJob(project.id, { ...job, status: 'interrupted', message: '应用上次关闭时任务尚未结束。可按任务编号从 ComfyUI 历史中找回；重新生成会创建新任务。' });
      }
    }
  }
}
