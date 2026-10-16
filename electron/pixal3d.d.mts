export const PIXAL_DEFAULTS: { shapeEngine: 'pixal3d'; pixalModel: string; pixalEncoder: string; pixalShapeVae: string; pixalTextureVae: string };
export const PIXAL_REQUIRED_NODES: string[];
export interface PixalCapabilities { models: string[]; encoders: string[]; shapeVaes: string[]; textureVaes: string[]; missingNodes: string[] }
export function pixalCapabilities(info: Record<string, any>): PixalCapabilities;
export function buildPixal3DWorkflow(options: { image?: string; seed: number; quality?: string; pixalModel?: string; pixalEncoder?: string; pixalShapeVae?: string; pixalTextureVae?: string }): Record<string, { class_type: string; inputs: Record<string, any> }>;
