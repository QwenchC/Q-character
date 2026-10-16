import { normalizeMultiView, readyMultiView } from './multiview.mjs';
import { normalizeConsistency } from './consistency.mjs';
import { normalizeVisionReview } from './vision.mjs';
import { normalizeClayGuide, normalizeTextureConfig } from './texture.mjs';

export const SYNC_VERSION = 1;
export const FILE_LIMIT = 64 * 1024 * 1024;
export const PROJECT_LIMIT = 512 * 1024 * 1024;
export const UUID = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const HASH = /^[a-f0-9]{64}$/;
export const ACTIVE = ['submitting', 'running', 'downloading', 'cancelling'];
const fields = ['name', 'description', 'ratio', 'style', 'heightMm', 'clayGuide', 'workspace', 'multiView', 'consistency', 'visionReview'];
const references = ['sourceAssetId', 'maskAssetId', 'parentCutoutId', 'parentModelId', 'textureSourceId', 'repairMaskId'];
const clone = value => JSON.parse(JSON.stringify(value));
export function canonical(value) {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function validateManifest(input) {
  if (!input || input.protocol !== SYNC_VERSION || !input.project || !Array.isArray(input.files)) throw new Error('不支持的作品同步格式，请更新两端应用。');
  if (canonical(input).length > 4 * 1024 * 1024) throw new Error('作品记录超过同步上限。');
  const m = clone(input), p = m.project;
  if (!UUID.test(p.id) || typeof p.name !== 'string' || p.name.length > 100 || typeof p.description !== 'string' || p.description.length > 6000 || !['2', '2.5', '3'].includes(p.ratio) || !['clay', 'anime'].includes(p.style) || !Number.isFinite(p.heightMm) || p.heightMm < 10 || p.heightMm > 500) throw new Error('作品基本信息无效。');
  if (!Array.isArray(p.assets) || p.assets.length > 2000 || !Array.isArray(p.jobs) || p.jobs.length > 2000 || m.files.length !== p.assets.length) throw new Error('作品素材或记录数量无效。');
  if (![p.createdAt, p.updatedAt].every(v => typeof v === 'string' && v.length < 80 && Number.isFinite(Date.parse(v)))) throw new Error('作品时间记录无效。');
  const assets = new Map(), filenames = new Set(), files = new Map(); let total = 0;
  for (const f of m.files) {
    if (!UUID.test(f.assetId) || !HASH.test(f.sha256) || !Number.isSafeInteger(f.size) || f.size < 1 || f.size > FILE_LIMIT || files.has(f.assetId)) throw new Error('素材校验信息无效，单文件最多 64 MiB。');
    files.set(f.assetId, f); total += f.size;
  }
  if (total > PROJECT_LIMIT) throw new Error('单个同步作品不能超过 512 MiB。');
  for (const a of p.assets) {
    if (!UUID.test(a.id) || assets.has(a.id) || !/^[a-zA-Z0-9_-]+\.(png|jpe?g|webp|glb|stl|obj)$/i.test(a.filename) || filenames.has(a.filename) || !['reference', 'design', 'mask', 'cutout', 'prepared', 'model'].includes(a.kind) || files.get(a.id)?.filename !== a.filename) throw new Error('素材编号、文件名或类型无效。');
    if ((a.kind === 'model') !== /\.(glb|stl|obj)$/i.test(a.filename)) throw new Error('模型与图片类型不匹配。');
    if (a.label !== undefined && (typeof a.label !== 'string' || a.label.length > 500)) throw new Error('素材名称过长。');
    if (a.textureConfig) normalizeTextureConfig(a.textureConfig);
    assets.set(a.id, a); filenames.add(a.filename);
  }
  for (const a of p.assets) for (const key of references) if (a[key] && !assets.has(a[key])) throw new Error('作品缺少原图、蒙版或模型版本，不能继续同步。');
  for (const a of p.assets) {
    if (a.maskAssetId && assets.get(a.maskAssetId).kind !== 'mask') throw new Error('前景蒙版引用无效。');
    if (a.parentModelId && assets.get(a.parentModelId).kind !== 'model') throw new Error('父模型引用无效。');
    if (a.parentCutoutId && assets.get(a.parentCutoutId).kind !== 'cutout') throw new Error('抠图版本关系无效。');
  }
  if (p.multiView) normalizeMultiView(p.multiView, p.assets);
  if (p.consistency) normalizeConsistency(p.consistency, p.assets);
  if (p.visionReview) { normalizeVisionReview(p.visionReview,p.assets); if(!p.jobs.some(j=>j.id===p.visionReview.id&&j.kind==='review'))throw new Error('视觉报告缺少原任务。'); }
  for (const a of p.assets) if (a.inputViewIds) readyMultiView({ assets: p.assets, multiView: { enabled: true, views: a.inputViewIds, fov: a.viewFov ?? 20 } });
  if (p.clayGuide) { normalizeClayGuide(p.clayGuide); if (assets.get(p.clayGuide.referenceId)?.kind !== 'cutout') throw new Error('黏土调色缺少透明参考图。'); }
  if (p.workspace) {
    for (const key of ['sourceId', 'modelId']) if (p.workspace[key] && !assets.has(p.workspace[key])) throw new Error('编辑位置引用无效。');
    if (!['design', 'workbench', 'library'].includes(p.workspace.page) || !['text', 'image'].includes(p.workspace.inputMode)) throw new Error('编辑位置无效。');
  }
  const jobs = new Set();
  for (const j of p.jobs) {
    if (!UUID.test(j.id) || jobs.has(j.id) || j.projectId !== p.id || !['design', 'matte', 'shape', 'review'].includes(j.kind)) throw new Error('生成记录无效。');
    if(j.reviewResult){normalizeVisionReview(j.reviewResult,p.assets);if(j.kind!=='review'||j.reviewResult.id!==j.id)throw new Error('历史视觉报告的任务引用无效。');}
    jobs.add(j.id);
    if (ACTIVE.includes(j.status)) { j.status = 'interrupted'; j.message = '此记录来自其他设备，请确认原任务状态后继续接收。'; }
  }
  return m;
}
export function contentKey(manifest) {
  if (!manifest) return '';
  const m = clone(manifest); delete m.revision; delete m.stamp;
  delete m.project.updatedAt;
  m.project.assets.sort((a, b) => a.id.localeCompare(b.id)); m.project.jobs.sort((a, b) => a.id.localeCompare(b.id)); m.files.sort((a, b) => a.assetId.localeCompare(b.assetId));
  return canonical(m);
}
export async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
}
export async function revision(manifest) { return digest(contentKey(manifest)); }

// Assets are immutable. Merge new versions; never replace bytes under an existing identity.
export function mergeManifests(base, local, remote) {
  if (!local) return { manifest: remote, conflicts: [] };
  if (!remote) return { manifest: local, conflicts: [] };
  local = validateManifest(local); remote = validateManifest(remote);
  if (local.project.id !== remote.project.id || base && base.project.id !== local.project.id) throw new Error('作品编号不一致。');
  const merged = clone(remote), conflicts = [];
  const rm = new Map(remote.project.assets.map(a => [a.id, a])), rf = new Map(remote.files.map(f => [f.assetId, f]));
  for (const a of local.project.assets) {
    const f = local.files.find(x => x.assetId === a.id);
    if (rm.has(a.id)) {
      if (canonical(a) !== canonical(rm.get(a.id)) || f.sha256 !== rf.get(a.id).sha256) throw new Error('同一素材编号的内容发生变化，已停止同步并保留本机作品。');
    } else { merged.project.assets.push(a); merged.files.push(f); }
  }
  for (const key of fields) {
    const l = local.project[key], r = remote.project[key], b = base?.project[key];
    if (canonical(l) === canonical(r)) continue;
    if (base && canonical(l) === canonical(b)) continue;
    if (base && canonical(r) === canonical(b)) { if (l === undefined) delete merged.project[key]; else merged.project[key] = clone(l); }
    else if (key === 'workspace') { if (l !== undefined) merged.project[key] = clone(l); }
    else { conflicts.push(key); }
  }
  const jobs = new Map(remote.project.jobs.map(j => [j.id, j]));
  for (const j of local.project.jobs) {
    const other = jobs.get(j.id), before = base?.project.jobs.find(x => x.id === j.id);
    if (!other || canonical(other) === canonical(before)) jobs.set(j.id, j);
    else if (canonical(j) !== canonical(other) && canonical(j) !== canonical(before)) conflicts.push('jobs');
  }
  merged.project.jobs = [...jobs.values()];
  merged.project.assets.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id));
  merged.project.updatedAt = new Date().toISOString();
  delete merged.revision; delete merged.stamp;
  return { manifest: validateManifest(merged), conflicts: [...new Set(conflicts)] };
}
export async function conflictCopy(local, remoteRevision) {
  // A remote commit can succeed before its acknowledgement is lost. Reuse the
  // same local copy on retry even when that commit changed the remote revision.
  const identity = await digest(`qcharacter-conflict:${await revision(local)}`);
  const id = `${identity.slice(0, 8)}-${identity.slice(8, 12)}-${identity.slice(12, 16)}-${identity.slice(16, 20)}-${identity.slice(20, 32)}`;
  const copy = clone(local); delete copy.revision; delete copy.stamp;
  copy.project.id = id; copy.project.name = `${copy.project.name.slice(0, 70)} · 同步冲突副本`;
  copy.project.syncConflictOf = local.project.id;
  for (const job of copy.project.jobs) job.projectId = id;
  return validateManifest(copy);
}
