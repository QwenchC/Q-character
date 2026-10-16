export function buildDesignWorkflow(params: Record<string, unknown>): Record<string, unknown>;
export function buildQwenEditWorkflow(params: Record<string, unknown>): Record<string, unknown>;
export function buildMatteWorkflow(params: Record<string, unknown>): Record<string, unknown>;
export function buildShapeWorkflow(params: Record<string, unknown>): Record<string, unknown>;
export function validateWorkflow(graph: Record<string, unknown>, info: Record<string, unknown>): void;
export function collectOutputs(entry: Record<string, unknown>, kind: string): {filename:string;subfolder?:string;type:string}[];
