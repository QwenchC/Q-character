export const SYNC_VERSION: number;
export const FILE_LIMIT: number;
export const PROJECT_LIMIT: number;
export const UUID: RegExp;
export const HASH: RegExp;
export const ACTIVE: string[];
export interface SyncManifest { protocol: number; project: import('../src/types').Project; files: { assetId: string; filename: string; size: number; sha256: string }[]; revision?: string; stamp?: string }
export function canonical(value: unknown): string;
export function validateManifest(value: unknown): SyncManifest;
export function contentKey(value: SyncManifest | null): string;
export function digest(value: string): Promise<string>;
export function revision(value: SyncManifest): Promise<string>;
export function mergeManifests(base: SyncManifest | null, local: SyncManifest | null, remote: SyncManifest | null): { manifest: SyncManifest; conflicts: string[] };
export function conflictCopy(local: SyncManifest, remoteRevision: string): Promise<SyncManifest>;
