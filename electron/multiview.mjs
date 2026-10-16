export const VIEW_ROLES = ['front', 'left', 'back', 'right'];
export const VIEW_LABELS = { front: '正面', left: '左侧', back: '背面', right: '右侧' };
export function normalizeMultiView(value, assets) {
  if (!value || typeof value.enabled !== 'boolean' || !value.views || typeof value.views !== 'object' || Array.isArray(value.views)) throw new Error('多视图配置无效。');
  const fov = value.fov ?? 20;
  if (!Number.isFinite(fov) || fov < 1 || fov > 170) throw new Error('多视图相机视角必须为 1–170 度。');
  const views = {}, used = new Set();
  for (const [role, id] of Object.entries(value.views)) {
    if (!VIEW_ROLES.includes(role)) throw new Error('视图方向无效。');
    if (!id) continue;
    const asset = assets.find(a => a.id === id && ['reference', 'design', 'cutout'].includes(a.kind));
    if (!asset) throw new Error(`${VIEW_LABELS[role]}缺少对应的设计图或抠图。`);
    if (used.has(id)) throw new Error('不同方向不能使用同一张图片，请分别准备侧面与背面。');
    used.add(id); views[role] = id;
  }
  return { enabled: value.enabled, views, fov };
}
export function readyMultiView(project) {
  const config = normalizeMultiView(project.multiView, project.assets);
  if (!config.views.front || !config.views.back || !(config.views.left || config.views.right)) throw new Error('请准备正面、背面和至少一个侧面视图。');
  for (const [role, id] of Object.entries(config.views)) if (project.assets.find(a => a.id === id)?.kind !== 'cutout') throw new Error(`请先为${VIEW_LABELS[role]}抠图并检查蒙版。`);
  return config;
}
export function setViewSlot(project, role, assetId, expected) {
  if (!VIEW_ROLES.includes(role)) throw new Error('视图方向无效。');
  const current = project.multiView || { enabled: false, views: {}, fov: 20 };
  if (expected !== undefined && (current.views[role] || '') !== expected) return current;
  return normalizeMultiView({ ...current, views: { ...current.views, [role]: assetId } }, project.assets);
}

// Equal foreground height, shared width limit and ground line across all views.
// Alpha is composited onto black only in these temporary model inputs.
export function prepareMultiViewImages(images, side = 1024) {
  if (!Number.isInteger(side) || side < 16 || side > 2048) throw new Error('视图输入尺寸无效。');
  const bounds = {};
  let widest = 1;
  for (const [role, image] of Object.entries(images)) {
    if (!VIEW_ROLES.includes(role) || !image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width * image.height > 16000000 || image.data.length !== image.width * image.height * 4) throw new Error('视图图片无效。');
    let left = image.width, top = image.height, right = -1, bottom = -1, transparent = 0, foreground = 0;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const alpha = image.data[(y * image.width + x) * 4 + 3];
      if (alpha < 247) transparent++;
      if (alpha > 8) { foreground++; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
    }
    if (transparent < image.width * image.height * .005 || foreground < image.width * image.height * .005) throw new Error(`请先检查${VIEW_LABELS[role]}的透明蒙版。`);
    bounds[role] = { left, top, width: right - left + 1, height: bottom - top + 1 };
    widest = Math.max(widest, (right - left + 1) / (bottom - top + 1));
  }
  const height = side / 1.1 / widest, output = {};
  for (const [role, image] of Object.entries(images)) {
    const b = bounds[role], scale = height / b.height, width = b.width * scale;
    const ox = (side - width) / 2, oy = (side - height) / 2, data = new Uint8ClampedArray(side * side * 4);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    for (let y = Math.max(0, Math.floor(oy)); y < Math.min(side, Math.ceil(oy + height)); y++) for (let x = Math.max(0, Math.floor(ox)); x < Math.min(side, Math.ceil(ox + width)); x++) {
      const sx = b.left + (x + .5 - ox) / scale - .5, sy = b.top + (y + .5 - oy) / scale - .5, ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
      const rgb = [0, 0, 0];
      for (const [dx, dy, weight] of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]]) {
        const px = ix + dx, py = iy + dy;
        if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue;
        const src = (py * image.width + px) * 4, dst = (y * side + x) * 4, alpha = image.data[src + 3] / 255;
        for (let c = 0; c < 3; c++) rgb[c] += image.data[src + c] * alpha * weight;
      }
      data.set(rgb, (y * side + x) * 4);
    }
    output[role] = { width: side, height: side, data };
  }
  return output;
}
