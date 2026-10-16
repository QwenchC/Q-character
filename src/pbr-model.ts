import type { Asset } from './types';

// Recolor the immutable AI texture each time, preventing successive edits from
// adding the same color offset repeatedly or losing detail to re-encoding.
export function originalPbrModel(assets: Asset[], selected: Asset): Asset | undefined {
  if (!selected.textureMethod?.startsWith('pixal3d-pbr')) return undefined;
  let model = selected;
  const visited = new Set<string>();
  while (model.textureMethod === 'pixal3d-pbr-recolor') {
    if (visited.has(model.id)) throw new Error('模型版本关联损坏，请选择原始 Pixal3D 模型。');
    visited.add(model.id);
    const parent = assets.find(a => a.kind === 'model' && a.id === model.parentModelId);
    if (!parent) throw new Error('找不到原始 AI 贴图模型，请先同步完整作品。');
    model = parent;
  }
  if (model.textureMethod !== 'pixal3d-pbr') throw new Error('模型版本没有关联到原始 AI 贴图。');
  return model;
}
