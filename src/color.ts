export type RGB = [number, number, number];
export interface Swatch { id: string; name: string; original: string; target: string; share: number }
export interface ClayBase { name: string; hex: string }
export const DEFAULT_BASES: ClayBase[] = [{ name: '白色', hex: '#f2f0e9' }, { name: '黑色', hex: '#272526' }, { name: '红色', hex: '#cb3542' }, { name: '黄色', hex: '#f2c53d' }, { name: '蓝色', hex: '#416db3' }, { name: '棕色', hex: '#744c3b' }];
export const gramsText = (grams: number) => grams.toFixed(grams > 0 && grams < 0.01 ? 3 : 2);
export const fromHex = (hex: string): RGB => { if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('请输入六位颜色值。'); return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as RGB; };
export const toHex = (rgb: number[]) => '#' + rgb.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
const linear = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const srgb = (c: number) => 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
export function lab(rgb: RGB): RGB {
  const [r, g, b] = rgb.map(linear), f = (x: number) => x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116;
  const x = f((r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047), y = f(r * 0.2126729 + g * 0.7151522 + b * 0.072175), z = f((r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export const distance = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + (x - b[i]) ** 2, 0);
export function colorName([r, g, b]: RGB) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (min > 205 && max - min < 45) return r - b > 20 ? '浅肤色' : '米白色';
  if (max - min < 18) return max > 220 ? '米白色' : max < 70 ? '深灰色' : '灰色';
  if (r > g * 1.08 && g > b * 1.08) return r > 200 && g > 150 ? '暖肤色' : r < 155 ? '棕色' : '暖棕色';
  if (g >= r * 0.88 && g > b * 1.3) return r > 150 ? '黄绿色' : '橄榄绿';
  if (g >= r && g > b) return '绿色'; if (b > r && b > g) return '蓝色'; if (r > b * 1.3 && g > b * 1.3) return '黄色';
  return r > b ? '红色' : '紫色';
}
export function extractPalette(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, count = 7): Swatch[] {
  if (rgba.length !== width * height * 4 || width < 1 || height < 1) throw new Error('图片尺寸无效。');
  const samples: RGB[] = [], step = Math.max(1, Math.ceil(width * height / 18000));
  for (let i = 0; i < width * height; i += step) if (rgba[i * 4 + 3] >= 240) samples.push([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
  if (!samples.length) throw new Error('没有可取色的前景，请检查抠图。');
  const points = samples.map(lab), centers = [points[0].slice()];
  while (centers.length < Math.min(count, samples.length)) {
    let farthest = 0, best = 0;
    for (let i = 0; i < points.length; i++) { const d = Math.min(...centers.map(c => distance(c, points[i]))); if (d > best) { best = d; farthest = i; } }
    if (best < 100) break; centers.push(points[farthest].slice());
  }
  let assignments = new Int16Array(points.length);
  for (let iteration = 0; iteration < 12; iteration++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < points.length; i++) { let nearest = 0, best = Infinity; centers.forEach((c, j) => { const d = distance(c, points[i]); if (d < best) { nearest = j; best = d; } }); assignments[i] = nearest; const sum = sums[nearest]; points[i].forEach((v, k) => sum[k] += v); sum[3]++; }
    centers.forEach((c, j) => { if (sums[j][3]) c.forEach((_, k) => c[k] = sums[j][k] / sums[j][3]); });
  }
  const groups = centers.map(() => ({ rgb: [0, 0, 0], n: 0 }));
  samples.forEach((rgb, i) => { const group = groups[assignments[i]]; group.n++; rgb.forEach((v, k) => group.rgb[k] += v); });
  return groups.filter(g => g.n / samples.length >= 0.004).sort((a, b) => b.n - a.n).map((g, i) => { const rgb = g.rgb.map(x => Math.round(x / g.n)) as RGB, hex = toHex(rgb); return { id: `color-${i}`, name: colorName(rgb), original: hex, target: hex, share: g.n / samples.length }; });
}

// RGB-based pigment approximation; a starting recipe, never a measured clay formula.
export function mixClay(bases: ClayBase[], parts: number[]): RGB {
  const total = parts.reduce((a, b) => a + b, 0); if (!total || bases.length !== parts.length) throw new Error('调色比例无效。');
  const coefficients = bases.map(base => fromHex(base.hex).map(c => { const r = Math.max(0.002, linear(c)); return (1 - r) ** 2 / (2 * r); }));
  return [0, 1, 2].map(c => { const k = coefficients.reduce((sum, base, i) => sum + base[c] * parts[i] / total, 0), r = 1 / (1 + k + Math.sqrt(k * k + 2 * k)); return Math.round(srgb(r)); }) as RGB;
}
export function clayRecipe(targetHex: string, bases = DEFAULT_BASES) {
  const target = lab(fromHex(targetHex)); let bestParts = bases.map(() => 0), best = Infinity;
  const consider = (parts: number[]) => { const predicted = mixClay(bases, parts), error = distance(lab(predicted), target); if (error < best) { best = error; bestParts = parts.slice(); } };
  // Enumerate up to three ingredients in 20 parts, keeping recipes easy to weigh.
  for (let a = 0; a < bases.length; a++) { const p = bases.map(() => 0); p[a] = 20; consider(p);
    for (let b = a + 1; b < bases.length; b++) for (let x = 1; x < 20; x++) {
      const two = bases.map(() => 0); two[a] = x; two[b] = 20 - x; consider(two);
      for (let c = b + 1; c < bases.length; c++) for (let y = 1; y < 20 - x; y++) { const three = bases.map(() => 0); three[a] = x; three[b] = y; three[c] = 20 - x - y; consider(three); }
    }
  }
  // Refine small tints without forcing a full 5% dose of dark pigment into pale clay.
  for (const step of [0.5, 0.1]) for (let iteration = 0; iteration < 60; iteration++) {
    const previous = best, start = bestParts.slice();
    for (let a = 0; a < bases.length; a++) for (let b = 0; b < bases.length; b++) {
      if (a === b || start[a] + 1e-6 < step) continue;
      const candidate = start.slice(); candidate[a] = Math.round((candidate[a] - step) * 10) / 10; candidate[b] = Math.round((candidate[b] + step) * 10) / 10;
      if (candidate.filter(p => p > 0).length <= 3) consider(candidate);
    }
    if (previous - best < 0.0001) break;
  }
  const predicted = toHex(mixClay(bases, bestParts));
  return { ingredients: bases.flatMap((base, i) => bestParts[i] ? [{ ...base, parts: bestParts[i] }] : []), predicted, difference: Math.sqrt(best) };
}
