import type { Swatch, ClayBase } from './color';
import type { Projection } from './texture-image';
export interface ClayGuide { referenceId: string; swatches: Swatch[]; bases: ClayBase[]; grams?: number }
export interface TextureConfig { swatches: Swatch[]; projection: Projection }
export interface Asset { id: string; filename: string; kind: 'reference' | 'design' | 'model' | 'prepared' | 'cutout' | 'mask'; label: string; createdAt: string; jobId?: string; sourceAssetId?: string; maskAssetId?: string; parentCutoutId?: string; revisionType?: 'manual'; parentModelId?: string; textureSourceId?: string; textureMethod?: string; textureConfig?: TextureConfig }
export interface Job { id: string; projectId: string; kind: 'design' | 'shape' | 'matte'; status: string; message: string; progress?: number; promptId?: string; createdAt: string; seed: number; resultAssetId?: string; engine?: string; inputAssetId?: string; server?: string; targetedInterrupt?: boolean; workflow?: Record<string, unknown> }
export interface Project { id: string; name: string; description: string; ratio: string; style: string; heightMm: number; createdAt: string; updatedAt: string; assets: Asset[]; jobs: Job[]; clayGuide?: ClayGuide; workspace?: { sourceId: string; modelId: string; page: 'design' | 'workbench' | 'library'; inputMode: 'text' | 'image' }; syncConflictOf?: string }
export interface SyncResult { changed: number; conflicts: number; uploadedFiles: number; downloadedFiles: number; errors: { id: string; message: string }[] }
export interface SyncEvent { type: 'changed' | 'progress'; projectId?: string; message?: string }
export interface SyncStatus { platform: 'android' | 'desktop'; enabled?: boolean; port?: number; publicUrl?: string; urls?: string[]; fingerprint?: string; devices?: { id: string; name: string; pairedAt: string }[]; pairing?: { code: string; expiresAt: string } | null; error?: string; server?: string; paired?: boolean; auto?: boolean }
export interface Settings { server: string; comfyPath: string; designCheckpoint: string; shapeCheckpoint: string; imageEngine: 'qwen21' | 'sdxl'; qwenModel: string; qwenEncoder: string; qwenVae: string; backgroundModel: string; authType?: 'none' | 'bearer' | 'basic'; authToken?: string; authUsername?: string; authPassword?: string; hasCredentials?: boolean; certificateFingerprint?: string }
export interface ServerCertificate { receipt: string; server: string; subject: string; issuer: string; fingerprint: string; validFrom: string; validTo: string }
export interface Capabilities { stats: { system: { comfyui_version?: string }; devices: { name: string; vram_total: number }[] }; checkpoints: string[]; shapeCheckpoints: string[]; missingShapeNodes: string[]; qwenModels: string[]; qwenEncoders: string[]; qwenVaes: string[]; backgroundModels: string[]; missingEditNodes: string[]; missingMatteNodes: string[] }
export interface Bootstrap { settings: Settings; projects: Project[]; dataPath: string; active: Job | null; version: string; platform?: 'android' | 'desktop' }
export interface StudioBridge {
  bootstrap(): Promise<Bootstrap>;
  settings(settings: Settings): Promise<Settings>;
  connect(): Promise<Capabilities>;
  createProject(name: string): Promise<Project>;
  saveProject(id: string, fields: Partial<Pick<Project, 'name' | 'description' | 'ratio' | 'style' | 'heightMm' | 'clayGuide' | 'workspace'>>): Promise<Project>;
  importAsset(id: string, kind: 'reference' | 'model'): Promise<Project | null>;
  saveMask(projectId: string, cutoutId: string, mask: Uint8Array): Promise<Project>;
  saveTexture(projectId: string, modelId: string, referenceId: string, bytes: Uint8Array, config: TextureConfig): Promise<Project>;
  generate(id: string, options: { kind: 'design' | 'shape' | 'matte'; assetId?: string; denoise?: number; quality?: string }): Promise<Job>;
  cancel(): Promise<void>;
  exportAsset(id: string, assetId: string): Promise<boolean>;
  exportBytes(options: { name: string; bytes: Uint8Array }): Promise<boolean>;
  openFolder(id: string): Promise<void>;
  openComfy(): Promise<void>;
  onJob(callback: (job: Job) => void): () => void;
  resumeJob?(projectId: string, jobId: string): Promise<Job>;
  inspectCertificate?(server: string): Promise<ServerCertificate>;
  trustCertificate?(certificate: ServerCertificate): Promise<boolean>;
  revokeCertificate?(server: string): Promise<void>;
  syncStatus?(): Promise<SyncStatus>;
  syncConfigure?(settings: { enabled: boolean; port: number; publicUrl: string }): Promise<SyncStatus>;
  syncPairCode?(): Promise<SyncStatus>;
  syncRevoke?(deviceId: string): Promise<SyncStatus>;
  syncPair?(server: string, code: string): Promise<void>;
  syncForget?(): Promise<void>;
  syncInspectCertificate?(server: string): Promise<ServerCertificate>;
  syncTrustCertificate?(certificate: ServerCertificate): Promise<boolean>;
  syncRun?(ids?: string[]): Promise<SyncResult>;
  syncCancel?(): Promise<void>;
  syncAuto?(enabled: boolean): Promise<void>;
  syncEditing?(id: string, editing: boolean): Promise<void>;
  onSync?(callback: (event: SyncEvent) => void): () => void;
}
declare global { interface Window { studio?: StudioBridge } }
export const assetUrl = (project: Project, asset: Asset) => typeof window !== 'undefined' && window.QNative ? `https://appassets.androidplatform.net/projects/${project.id}/assets/${asset.filename}` : `qasset://${project.id}/${asset.filename}`;
export const isActive = (job: Job | null) => !!job && ['submitting', 'running', 'downloading', 'cancelling'].includes(job.status);
