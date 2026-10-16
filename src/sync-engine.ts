import { contentKey, conflictCopy, mergeManifests, revision, UUID, validateManifest, type SyncManifest } from '../electron/sync-protocol.mjs';
import type { SyncResult } from './types';

type Call = <T = unknown>(method: string, args?: Record<string, unknown>) => Promise<T>;
export async function synchronize(call: Call, options: { ids?: string[]; progress: (message: string) => void; cancelled: () => boolean }): Promise<SyncResult> {
  const result: SyncResult = { changed: 0, conflicts: 0, uploadedFiles: 0, downloadedFiles: 0, errors: [] };
  const sid = await call<string>('syncNetBegin');
  const check = () => { if (options.cancelled()) throw new Error('同步已取消；已完成的作品保留，未完成的作品不会覆盖。'); };
  const remote = <T = Record<string, unknown>>(route: string, body?: unknown) => { check(); return call<T>('syncNetJson', { session: sid, route: `/qsync/v1${route}`, ...(body ? { body } : {}) }); };
  const localSnapshot = async (id: string) => {
    const m = await call<SyncManifest | null>('syncSnapshot', { id });
    if (!m) return null; const value = validateManifest(m); value.revision = await revision(value); return value;
  };
  const pullFiles = async (m: SyncManifest) => {
    for (const f of m.files) {
      check(); if (await call<boolean>('syncHasFile', { id: m.project.id, file: f })) continue;
      options.progress(`接收 ${m.project.name} · ${f.filename}（${(f.size / 1048576).toFixed(1)} MiB）`);
      await call('syncNetDownload', { session: sid, id: m.project.id, file: f }); result.downloadedFiles++;
    }
  };
  const push = async (m: SyncManifest, expected: string | null, sourceId: string) => {
    const id = m.project.id;
    const { missing } = await remote<{ missing: string[] }>(`/projects/${id}/missing`, { manifest: m });
    if (!Array.isArray(missing) || missing.some(h => !m.files.some(f => f.sha256 === h))) throw new Error('电脑返回了无效的素材请求。');
    for (const hash of missing) {
      check(); const file = m.files.find(f => f.sha256 === hash)!;
      options.progress(`发送 ${m.project.name} · ${file.filename}（${(file.size / 1048576).toFixed(1)} MiB）`);
      await call('syncNetUpload', { session: sid, id, sourceId, file }); result.uploadedFiles++;
    }
    const response = await remote<{ manifest: SyncManifest }>(`/projects/${id}/commit`, { expected, manifest: m });
    return validateManifest(response.manifest);
  };
  try {
    const info = await remote<{ protocol: number; serverId: string }>('/info');
    if (info.protocol !== 1 || !UUID.test(info.serverId)) throw new Error('该地址不是兼容的 Q Character 同步服务。');
    const [listing, phone] = await Promise.all([remote<{ projects: { id: string; name: string }[] }>('/projects'), call<{ projects: { id: string; name: string }[] }>('bootstrap')]);
    if (!Array.isArray(listing.projects) || listing.projects.length > 2000 || listing.projects.some(p => !UUID.test(p.id))) throw new Error('电脑返回的作品列表无效。');
    const ids = options.ids ?? [...new Set([...phone.projects.map(p => p.id), ...listing.projects.map(p => p.id)])];
    for (const id of ids) {
      check(); if (!UUID.test(id)) throw new Error('作品编号无效。');
      try {
        const local = await localSnapshot(id);
        const response = await remote<{ manifest: SyncManifest | null }>(`/projects/${id}/manifest`);
        const desktop = response.manifest ? validateManifest(response.manifest) : null;
        if (desktop && (desktop.project.id !== id || desktop.revision !== await revision(desktop))) throw new Error('电脑作品清单校验失败。');
        if (!desktop && !local) continue;
        if (local && desktop && contentKey(local) === contentKey(desktop)) {
          await call('syncBasePut', { session: sid, serverId: info.serverId, id, manifest: desktop }); continue;
        }
        const base = await call<SyncManifest | null>('syncBaseGet', { serverId: info.serverId, id });
        const merged = mergeManifests(base, local, desktop);
        if (merged.conflicts.length && local && desktop) {
          const copy = await conflictCopy(local, desktop.revision!);
          options.progress(`${local.project.name} 有同时修改，正在保留冲突副本…`);
          const existing = await localSnapshot(copy.project.id);
          if (!existing) await call('syncCommit', { session: sid, manifest: copy, expected: null, sourceId: id });
          else if (contentKey(existing) !== contentKey(copy)) throw new Error('冲突副本已被继续编辑，请保留后重新同步。');
          const other = await remote<{ manifest: SyncManifest | null }>(`/projects/${copy.project.id}/manifest`);
          if (!other.manifest) await push(copy, null, id);
          else if (contentKey(other.manifest) !== contentKey(copy)) throw new Error('电脑冲突副本已更新，请先同步该副本。');
          result.conflicts++;
        }
        let accepted = desktop;
        if (!desktop || contentKey(merged.manifest) !== contentKey(desktop)) accepted = await push(merged.manifest, desktop?.revision ?? null, id);
        if (!accepted) throw new Error('电脑尚未确认作品。');
        check(); await pullFiles(accepted); check();
        if (!local || contentKey(local) !== contentKey(accepted)) await call('syncCommit', { session: sid, manifest: accepted, expected: local?.stamp ?? null, sourceId: id });
        await call('syncBasePut', { session: sid, serverId: info.serverId, id, manifest: accepted }); result.changed++;
      } catch (e) { check(); result.errors.push({ id, message: (e as Error).message }); }
    }
    return result;
  } finally { await call('syncNetEnd', { session: sid }).catch(() => {}); }
}
