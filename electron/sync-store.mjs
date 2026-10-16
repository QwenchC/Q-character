import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { safeAsset, writeJson } from './store.mjs';
import { FILE_LIMIT, UUID, HASH, validateManifest, revision, canonical } from './sync-protocol.mjs';
import { validateTexturedGlb } from './texture.mjs';

export async function fileHash(file) { const h = createHash('sha256'); for await (const bytes of createReadStream(file)) h.update(bytes); return h.digest('hex'); }
export class SyncRepository {
  constructor(store, cache) { this.store = store; this.cache = cache; }
  blob(hash) { if (!HASH.test(hash)) throw new Error('素材校验值无效。'); return path.join(this.cache, `${hash}.blob`); }
  async snapshot(id) { return this.store.mutate(() => this.snapshotUnlocked(id)); }
  async snapshotUnlocked(id) {
    let project; try { project = await this.store.read(id); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    const files = [];
    for (const a of project.assets) {
      const file = safeAsset(this.store.root, id, a.filename), stat = await fs.stat(file);
      files.push({ assetId: a.id, filename: a.filename, size: stat.size, sha256: await fileHash(file) });
    }
    const manifest = validateManifest({ protocol: 1, project, files }); manifest.revision = await revision(manifest);
    return manifest;
  }
  async hasBlob(f) {
    try { const p = this.blob(f.sha256); return (await fs.stat(p)).size === f.size && await fileHash(p) === f.sha256; } catch { return false; }
  }
  async commit(manifest, expected, allowed = () => {}) {
    manifest = validateManifest(manifest); const id = manifest.project.id;
    return this.store.mutate(async () => {
      allowed(); const current = await this.snapshotUnlocked(id);
      if ((current?.revision ?? null) !== expected) throw Object.assign(new Error('作品在传输期间已更新，请再次同步；现有内容已保留。'), { status: 409 });
      const oldFiles = new Map(current?.files.map(f => [f.assetId, f]) ?? []), oldAssets = new Map(current?.project.assets.map(a => [a.id, a]) ?? []);
      const incoming = new Map(manifest.files.map(f => [f.assetId, f]));
      for (const [aid, before] of oldFiles) {
        const next = incoming.get(aid), asset = manifest.project.assets.find(a => a.id === aid);
        if (!next || before.sha256 !== next.sha256 || before.filename !== next.filename || JSON.stringify(oldAssets.get(aid)) !== JSON.stringify(asset)) {
          // Key order can differ between Java and JS. Compare semantics separately.
          if (!next || before.sha256 !== next.sha256 || before.filename !== next.filename || canonical(oldAssets.get(aid)) !== canonical(asset)) throw new Error('同步不能删除或替换已有素材。');
        }
      }
      const directory = path.join(this.store.root, id), fresh = !current;
      const staging = fresh ? path.join(this.store.root, `.sync-${id}-${randomUUID()}`) : directory;
      const created = [];
      try {
        await fs.mkdir(path.join(staging, 'assets'), { recursive: true });
        for (const f of manifest.files) {
          allowed(); if (oldFiles.has(f.assetId)) continue;
          const reused = current?.files.find(x => x.sha256 === f.sha256 && x.size === f.size);
          if (!reused && !await this.hasBlob(f)) throw new Error('素材缺失或校验失败，请重试同步。');
          const bytes = await fs.readFile(reused ? safeAsset(this.store.root, id, reused.filename) : this.blob(f.sha256)), a = manifest.project.assets.find(a => a.id === f.assetId);
          validateBytes(a, bytes);
          const target = path.join(staging, 'assets', f.filename);
          await fs.writeFile(target, bytes, { flag: 'wx' }); created.push(target);
        }
        allowed(); const p = manifest.project; p.updatedAt = new Date().toISOString();
        if (fresh) { await writeJson(path.join(staging, 'project.json'), p); allowed(); await fs.rename(staging, directory); }
        else await writeJson(this.store.projectFile(id), p);
        const result = { ...manifest, project: p }; result.revision = await revision(result); return result;
      } catch (e) {
        for (const f of created) await fs.unlink(f).catch(() => {});
        // Only the newly created, scoped staging directory is removed. Existing projects are never moved.
        if (fresh && path.dirname(staging) === path.resolve(this.store.root) && path.basename(staging).startsWith(`.sync-${id}-`)) await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
        throw e;
      }
    });
  }
  async asset(id, hash) { if (!UUID.test(id)) throw new Error('作品编号无效。'); const m = await this.snapshot(id), f = m?.files.find(f => f.sha256 === hash); if (!f) throw Object.assign(new Error('素材不存在。'), { status: 404 }); return { file: safeAsset(this.store.root, id, f.filename), size: f.size }; }
}
function validateBytes(asset, bytes) {
  if (!bytes.length || bytes.length > FILE_LIMIT) throw new Error('素材大小无效。');
  if (/\.glb$/i.test(asset.filename)) {
    if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a || 20 + bytes.readUInt32LE(12) > bytes.length) throw new Error('同步模型不是完整 GLB。');
    const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
    for (const key of ['buffers', 'images']) for (const item of gltf[key] ?? []) if (item.uri && !item.uri.startsWith('data:')) throw new Error('同步 GLB 不能引用外部文件。');
    if (asset.textureMethod) validateTexturedGlb(bytes);
  } else if (/\.(png|jpe?g|webp)$/i.test(asset.filename)) {
    const valid = /\.png$/i.test(asset.filename) ? bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' : /\.webp$/i.test(asset.filename) ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' : bytes[0] === 255 && bytes[1] === 216;
    if (!valid) throw new Error('同步图片格式无效。');
  }
}
