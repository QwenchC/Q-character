export interface Point { x: number; y: number }
export interface PaintBounds { left: number; top: number; right: number; bottom: number }
export interface Brush { diameter: number; hardness: number; mode: 'restore' | 'erase' }

function clippedSegment(a: Point, b: Point, width: number, height: number, radius: number): [Point, Point] | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  let low = 0, high = 1;
  for (const [p, q] of [[-dx, a.x + radius], [dx, width + radius - a.x], [-dy, a.y + radius], [dy, height + radius - a.y]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) low = Math.max(low, t); else high = Math.min(high, t);
    if (low > high) return null;
  }
  return [{ x: a.x + low * dx, y: a.y + low * dy }, { x: a.x + high * dx, y: a.y + high * dy }];
}

export function paintMaskSegment(pixels: Uint8ClampedArray, width: number, height: number, from: Point, to: Point, brush: Brush): PaintBounds | null {
  if (pixels.length !== width * height) throw new Error('蒙版尺寸不匹配。');
  if (![from.x, from.y, to.x, to.y, brush.diameter, brush.hardness].every(Number.isFinite)) return null;
  const radius = Math.max(0.5, Math.min(250, brush.diameter / 2));
  const segment = clippedSegment(from, to, width, height, radius);
  if (!segment) return null;
  const [a, b] = segment;
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(distance / Math.max(0.5, radius * 0.4)));
  const inner = radius * Math.min(1, Math.max(0, brush.hardness));
  const target = brush.mode === 'restore' ? 255 : 0;
  let left = width, top = height, right = -1, bottom = -1;
  for (let step = 0; step <= steps; step++) {
    let cx = a.x + (b.x - a.x) * step / steps, cy = a.y + (b.y - a.y) * step / steps;
    if (radius === 0.5) { cx = Math.floor(cx) + 0.5; cy = Math.floor(cy) + 0.5; }
    const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(width - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(height - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (r > radius) continue;
      const coverage = r <= inner || inner === radius ? 1 : (radius - r) / (radius - inner);
      const index = y * width + x, next = Math.round(pixels[index] + (target - pixels[index]) * coverage);
      if (next === pixels[index]) continue;
      pixels[index] = next; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  return right < 0 ? null : { left, top, right, bottom };
}

export class MaskDocument {
  static selection(initial: Uint8ClampedArray) {
    const doc = new MaskDocument(new Uint8ClampedArray(initial.length));
    if (initial.some(value => value !== 0)) {
      doc.pixels.set(initial); doc.markChanged(); doc.commitStroke();
    }
    return doc;
  }
  readonly pixels: Uint8ClampedArray;
  private readonly baseline: Uint8ClampedArray;
  private frames: Uint8ClampedArray[];
  private position = 0;
  private strokeChanged = false;
  private isDirty = false;
  readonly capacity: number;
  constructor(initial: Uint8ClampedArray, maxHistoryBytes = 64 * 1024 * 1024) {
    if (!initial.length) throw new Error('蒙版为空。');
    this.pixels = initial.slice(); this.baseline = initial.slice(); this.frames = [initial.slice()];
    this.capacity = Math.max(2, Math.min(30, Math.floor(maxHistoryBytes / initial.length)));
  }
  markChanged() { this.strokeChanged = true; }
  commitStroke() {
    if (!this.strokeChanged) return false;
    this.strokeChanged = false;
    this.frames = this.frames.slice(0, this.position + 1); this.frames.push(this.pixels.slice());
    if (this.frames.length > this.capacity) this.frames.shift();
    this.position = this.frames.length - 1;
    this.isDirty = this.pixels.some((value, index) => value !== this.baseline[index]);
    return true;
  }
  undo() { this.commitStroke(); if (!this.canUndo) return false; this.position--; this.pixels.set(this.frames[this.position]); this.isDirty = this.pixels.some((value, index) => value !== this.baseline[index]); return true; }
  redo() { if (!this.canRedo) return false; this.position++; this.pixels.set(this.frames[this.position]); this.isDirty = this.pixels.some((value, index) => value !== this.baseline[index]); return true; }
  get canUndo() { return this.position > 0; }
  get canRedo() { return this.position + 1 < this.frames.length; }
  get dirty() { return this.isDirty || this.strokeChanged; }
}
