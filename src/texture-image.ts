import { distance, fromHex, lab, type RGB, type Swatch } from './color.ts';

export function foregroundBounds(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number) {
  if (rgba.length !== width * height * 4) throw new Error('图片尺寸无效。');
  let left = width, top = height, right = -1, bottom = -1, count = 0, removed = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const alpha = rgba[(y * width + x) * 4 + 3]; if (alpha >= 32) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); count++; } if (alpha < 247) removed++; }
  if (count < width * height * 0.005 || removed < width * height * 0.005) throw new Error('请先完成抠图并检查背景，再为模型上色。');
  return { left, top, right, bottom };
}

export function buildTextureAtlas(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, swatches: Swatch[], side = 1024, headFraction = 0.34) {
  const bounds = foregroundBounds(rgba, width, height);
  if (![512, 1024].includes(side)) throw new Error('请选择支持的贴图尺寸。');
  const original = swatches.map(s => fromHex(s.original)), targets = swatches.map(s => fromHex(s.target)), labs = original.map(lab), cache = new Map<number, RGB>();
  const recolor = (r: number, g: number, b: number): RGB => {
    if (!swatches.some(s => s.target.toLowerCase() !== s.original.toLowerCase())) return [r, g, b];
    const key = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3); let delta = cache.get(key);
    if (!delta) { const point = lab([r, g, b]); let best = Infinity, nearest = 0; labs.forEach((c, j) => { const d = distance(point, c); if (d < best) { best = d; nearest = j; } }); delta = targets[nearest].map((v, c) => v - original[nearest][c]) as RGB; cache.set(key, delta); }
    return [r, g, b].map((v, c) => Math.max(0, Math.min(255, v + delta![c]))) as RGB;
  };
  const front = new Uint8ClampedArray(side * side * 4), known = new Uint8Array(side * side), queue = new Int32Array(side * side); let tail = 0;
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const sx = Math.round(bounds.left + x / (side - 1) * (bounds.right - bounds.left)), sy = Math.round(bounds.top + y / (side - 1) * (bounds.bottom - bounds.top)), src = (sy * width + sx) * 4, index = y * side + x, dst = index * 4;
    if (rgba[src + 3] < 32) continue;
    front.set([...recolor(rgba[src], rgba[src + 1], rgba[src + 2]), 255], dst); known[index] = 1; queue[tail++] = index;
  }
  // Extend only foreground colors, so UV edges cannot pull deleted background into the mesh.
  for (let head = 0; head < tail; head++) {
    const i = queue[head], x = i % side;
    for (const next of [x ? i - 1 : -1, x + 1 < side ? i + 1 : -1, i - side, i + side]) if (next >= 0 && next < known.length && !known[next]) { known[next] = 1; queue[tail++] = next; front.set(front.subarray(i * 4, i * 4 + 4), next * 4); }
  }
  const atlas = new Uint8ClampedArray(side * 2 * side * 4);
  const sample = (v: number) => { const i = (Math.round(v * (side - 1)) * side + Math.round(side / 2)) * 4; return [...front.subarray(i, i + 3)] as RGB; };
  const rim: RGB[] = [];
  for (let sy = bounds.top + Math.round((bounds.bottom - bounds.top) * 0.02); sy < bounds.top + (bounds.bottom - bounds.top) * 0.2; sy += 2) {
    let left = width, right = -1;
    for (let x = bounds.left; x <= bounds.right; x++) if (rgba[(sy * width + x) * 4 + 3] >= 240) { left = Math.min(left, x); right = Math.max(right, x); }
    if (right <= left) continue;
    for (const x of [Math.round(left + (right - left) * 0.08), Math.round(right - (right - left) * 0.08)]) { const i = (sy * width + x) * 4; if (rgba[i + 3] >= 240) rim.push(recolor(rgba[i], rgba[i + 1], rgba[i + 2])); }
  }
  const hair = rim.length ? [0, 1, 2].map(c => rim.map(rgb => rgb[c]).sort((a, b) => a - b)[Math.floor(rim.length / 2)]) as RGB : sample(0.03);
  for (let y = 0; y < side; y++) {
    const v = y / (side - 1);
    atlas.set(front.subarray(y * side * 4, (y + 1) * side * 4), y * side * 8);
    for (let x = side; x < side * 2; x++) {
      const i = (y * side + x - side) * 4;
      atlas.set(v < headFraction ? [...hair, 255] : front.subarray(i, i + 4), (y * side * 2 + x) * 4);
    }
  }
  return { pixels: atlas, width: side * 2, height: side, bounds };
}

export interface Projection { turn: number; scale: number; offsetX: number; offsetY: number; headFraction: number }
export const DEFAULT_PROJECTION: Projection = { turn: 0, scale: 1, offsetX: 0, offsetY: 0, headFraction: 0.34 };
