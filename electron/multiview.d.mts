export type ViewRole = 'front' | 'left' | 'back' | 'right';
export interface MultiView { enabled: boolean; views: Partial<Record<ViewRole, string>>; fov: number }
export const VIEW_ROLES: ViewRole[];
export const VIEW_LABELS: Record<ViewRole, string>;
export function normalizeMultiView(value: unknown, assets: { id: string; kind: string }[]): MultiView;
export function readyMultiView(project: { multiView?: MultiView; assets: { id: string; kind: string }[] }): MultiView;
export function setViewSlot(project: { multiView?: MultiView; assets: { id: string; kind: string }[] }, role: ViewRole, assetId: string, expected?: string): MultiView;
export function prepareMultiViewImages(images: Record<string, { width: number; height: number; data: Uint8Array | Uint8ClampedArray }>, side?: number): Record<string, { width: number; height: number; data: Uint8ClampedArray }>;
