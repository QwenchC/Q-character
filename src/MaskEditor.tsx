import { boxSelection, type VisionBox } from '../electron/vision.mjs';
import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { Eraser, Hand, Paintbrush, Redo2, Undo2, X } from 'lucide-react';
import { MaskDocument, paintMaskSegment, type PaintBounds, type Point } from './mask-paint';

type View = 'overlay' | 'transparent' | 'mask' | 'original';
type Tool = 'restore' | 'erase' | 'pan';
type Surface = { doc: MaskDocument; width: number; height: number; original: HTMLCanvasElement; color: HTMLCanvasElement; sourceAlpha: Uint8ClampedArray; mask: HTMLCanvasElement; preview: HTMLCanvasElement; dirtyBounds: PaintBounds | null };
const canvas = (width: number, height: number) => { const result = document.createElement('canvas'); result.width = width; result.height = height; return result; };
const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.crossOrigin = 'anonymous'; image.onload = () => resolve(image); image.onerror = () => reject(new Error('无法读取原图或蒙版，请关闭后重试。')); image.src = url; });
const cleanError = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function MaskEditor({ original, mask, cutout, onSave, onClose, mode='matte', initialBox, children }: { mode?:'matte'|'repair'; initialBox?:VisionBox; children?:ReactNode; original: string; mask?: string; cutout: string; onSave: (bytes: Uint8Array) => Promise<void>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), stage = useRef<HTMLDivElement>(null), screen = useRef<HTMLCanvasElement>(null);
  const surface = useRef<Surface | null>(null);
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [saving, setSaving] = useState(false), [discard, setDiscard] = useState(false);
  const [tool, setTool] = useState<Tool>('restore'), [view, setView] = useState<View>('overlay');
  const [diameter, setDiameter] = useState(40), [hardness, setHardness] = useState(0.8);
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [, changed] = useState(0);
  const [cursor, setCursor] = useState<Point | null>(null);
  const gesture = useRef<{ id: number; pan: boolean; last: Point } | null>(null), space = useRef(false);
  const touches = useRef(new Map<number, Point>());
  const pinch = useRef<{ distance: number; center: Point } | null>(null);
  const redraw = () => {
    const s = surface.current, target = screen.current;
    if (!s || !target) return;
    if (s.dirtyBounds) {
      const { left, top, right, bottom } = s.dirtyBounds, width = right - left + 1, height = bottom - top + 1;
      const mc = s.mask.getContext('2d')!, image = mc.createImageData(width, height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = (y + top) * s.width + x + left, p = (y * width + x) * 4; image.data[p] = image.data[p + 1] = image.data[p + 2] = 255; const alpha = Math.min(s.doc.pixels[i], s.sourceAlpha[i]); image.data[p + 3] = alpha <= 8 ? 0 : alpha; }
      mc.putImageData(image, left, top); s.dirtyBounds = null;
    }
    const pc = s.preview.getContext('2d')!;
    pc.clearRect(0, 0, s.width, s.height); pc.globalCompositeOperation = 'source-over';
    if (view === 'overlay') { pc.fillStyle = 'rgba(235,65,92,0.62)'; pc.fillRect(0, 0, s.width, s.height); pc.globalCompositeOperation = mode==='repair'?'destination-in':'destination-out'; pc.drawImage(s.mask, 0, 0); }
    else { pc.drawImage(s.color, 0, 0); pc.globalCompositeOperation = 'destination-in'; pc.drawImage(s.mask, 0, 0); }
    pc.globalCompositeOperation = 'source-over';
    const ctx = target.getContext('2d')!; ctx.clearRect(0, 0, s.width, s.height);
    if (view === 'original' || view === 'overlay') ctx.drawImage(s.original, 0, 0);
    if (view === 'mask') { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, s.width, s.height); ctx.drawImage(s.mask, 0, 0); }
    else if (view !== 'original') ctx.drawImage(s.preview, 0, 0);
  };
  const fit = () => {
    const s = surface.current, area = stage.current;
    if (!s || !area) return;
    const scale = Math.min((area.clientWidth - 48) / s.width, (area.clientHeight - 48) / s.height, 1);
    setTransform({ scale, x: (area.clientWidth - s.width * scale) / 2, y: (area.clientHeight - s.height * scale) / 2 });
  };
  const finish = () => { if (gesture.current) { surface.current?.doc.commitStroke(); gesture.current = null; changed(x => x + 1); } };
  const close = () => { if (saving) return; finish(); if (surface.current?.doc.dirty) setDiscard(true); else onClose(); };
  const history = (redo = false) => { finish(); const s = surface.current, doc = s?.doc; if (s && (redo ? doc?.redo() : doc?.undo())) { s.dirtyBounds = { left: 0, top: 0, right: s.width - 1, bottom: s.height - 1 }; redraw(); changed(x => x + 1); } };
  const save = async () => {
    if (saving || !surface.current) return;
    finish(); const s = surface.current; if (!s.doc.dirty) return;
    setSaving(true); setError('');
    try {
      const output = canvas(s.width, s.height), ctx = output.getContext('2d')!, pixels = ctx.createImageData(s.width, s.height);
      for (let i = 0; i < s.doc.pixels.length; i++) { const p = i * 4; pixels.data[p] = pixels.data[p + 1] = pixels.data[p + 2] = s.doc.pixels[i]; pixels.data[p + 3] = 255; }
      ctx.putImageData(pixels, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => output.toBlob(value => value ? resolve(value) : reject(new Error('蒙版保存失败，请重试。')), 'image/png'));
      await onSave(new Uint8Array(await blob.arrayBuffer()));
    } catch (e) { setError(cleanError(e)); setSaving(false); }
  };
  useEffect(() => {
    dialog.current?.showModal(); let alive = true;
    void Promise.all([loadImage(original), loadImage(cutout)]).then(([source, matte]) => {
      if (!alive) return;
      const width = matte.naturalWidth, height = matte.naturalHeight;
      if (width * height > 16_000_000) throw new Error('图片过大，请缩小后重试。');
      const base = canvas(width, height); base.getContext('2d')!.drawImage(source, 0, 0, width, height);
      const temporary = canvas(width, height); temporary.getContext('2d')!.drawImage(matte, 0, 0);
      const rgba = temporary.getContext('2d')!.getImageData(0, 0, width, height).data;
      const pixels = new Uint8ClampedArray(width * height), sourceAlpha = new Uint8ClampedArray(width * height);
      const color = canvas(width, height), basePixels = base.getContext('2d')!.getImageData(0, 0, width, height);
      for (let i = 0; i < pixels.length; i++) { pixels[i] = mode==='repair'?0:rgba[i * 4 + 3]; sourceAlpha[i] = mode==='repair'?255:basePixels.data[i * 4 + 3]; basePixels.data[i * 4 + 3] = 255; }
      if(mode==='repair'&&initialBox)pixels.set(boxSelection(width,height,initialBox));
      color.getContext('2d')!.putImageData(basePixels, 0, 0);
      surface.current = { doc: mode==='repair' ? MaskDocument.selection(pixels) : new MaskDocument(pixels), width, height, original: base, color, sourceAlpha, mask: canvas(width, height), preview: canvas(width, height), dirtyBounds: { left: 0, top: 0, right: width - 1, bottom: height - 1 } };
      screen.current!.width = width; screen.current!.height = height; setReady(true); redraw(); fit();
    }).catch(e => { if (alive) setError(cleanError(e)); });
    return () => { alive = false; };
  }, [original, mask, cutout]);
  useEffect(() => { if (ready) redraw(); }, [view, ready]);
  useEffect(() => {
    const resize = new ResizeObserver(() => fit()); if (stage.current) resize.observe(stage.current); return () => resize.disconnect();
  }, []);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !/INPUT|BUTTON|SELECT/.test((event.target as HTMLElement).tagName)) { space.current = true; event.preventDefault(); }
      if (!(event.ctrlKey || event.metaKey) || saving || /INPUT|SELECT/.test((event.target as HTMLElement).tagName)) return;
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); history(event.shiftKey); }
      if (event.key.toLowerCase() === 'y') { event.preventDefault(); history(true); }
      if (event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
    };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') space.current = false; };
    const blur = () => { space.current = false; finish(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  });
  const position = (clientX: number, clientY: number) => { const box = stage.current!.getBoundingClientRect(); return { x: clientX - box.left, y: clientY - box.top }; };
  const paint = (from: Point, to: Point) => {
    const s = surface.current!;
    const pixel = (point: Point) => ({ x: (point.x - transform.x) / transform.scale, y: (point.y - transform.y) / transform.scale });
    const bounds = paintMaskSegment(s.doc.pixels, s.width, s.height, pixel(from), pixel(to), { diameter, hardness, mode: tool === 'erase' ? 'erase' : 'restore' });
    if (bounds) { s.doc.markChanged(); const old = s.dirtyBounds; s.dirtyBounds = old ? { left: Math.min(old.left, bounds.left), top: Math.min(old.top, bounds.top), right: Math.max(old.right, bounds.right), bottom: Math.max(old.bottom, bounds.bottom) } : bounds; }
  };
  const pointerDown = (event: ReactPointerEvent) => {
    if (!ready || saving || ![0, 1].includes(event.button)) return;
    event.preventDefault(); const point = position(event.clientX, event.clientY);
    if (event.pointerType === 'touch') {
      touches.current.set(event.pointerId, point); stage.current!.setPointerCapture(event.pointerId);
      if (touches.current.size > 1) { finish(); const [a, b] = [...touches.current.values()]; pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; return; }
    }
    const pan = tool === 'pan' || space.current || event.button === 1;
    if (!pan && view === 'original') return;
    stage.current!.setPointerCapture(event.pointerId); gesture.current = { id: event.pointerId, pan, last: point };
    if (!pan) { paint(point, point); redraw(); }
  };
  const pointerMove = (event: ReactPointerEvent) => {
    const point = position(event.clientX, event.clientY); setCursor(point);
    if (touches.current.has(event.pointerId)) touches.current.set(event.pointerId, point);
    if (pinch.current && touches.current.size > 1) {
      const [a, b] = [...touches.current.values()], distance = Math.hypot(a.x - b.x, a.y - b.y), center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, previous = pinch.current;
      setTransform(old => { const scale = Math.min(8, Math.max(0.05, old.scale * distance / Math.max(1, previous.distance))); return { scale, x: center.x - (previous.center.x - old.x) * scale / old.scale, y: center.y - (previous.center.y - old.y) * scale / old.scale }; });
      pinch.current = { distance, center }; return;
    }
    const stroke = gesture.current; if (!stroke || stroke.id !== event.pointerId) return;
    if (stroke.pan) { const dx = point.x - stroke.last.x, dy = point.y - stroke.last.y; setTransform(old => ({ ...old, x: old.x + dx, y: old.y + dy })); }
    else { const samples = event.nativeEvent.getCoalescedEvents?.(); for (const item of samples?.length ? samples : [event.nativeEvent]) { const next = position(item.clientX, item.clientY); paint(stroke.last, next); stroke.last = next; } redraw(); }
    stroke.last = point;
  };
  const pointerEnd = (event: ReactPointerEvent) => { touches.current.delete(event.pointerId); pinch.current = null; finish(); };
  const zoom = (factor: number, anchor?: Point) => {
    if (!ready) return;
    finish(); const area = stage.current!, point = anchor || { x: area.clientWidth / 2, y: area.clientHeight / 2 };
    setTransform(old => { const scale = Math.min(8, Math.max(0.05, old.scale * factor)); return { scale, x: point.x - (point.x - old.x) * scale / old.scale, y: point.y - (point.y - old.y) * scale / old.scale }; });
  };
  useEffect(() => {
    const area = stage.current;
    if (!area) return;
    const wheel = (event: WheelEvent) => { event.preventDefault(); if (!saving) zoom(Math.exp(-event.deltaY * 0.0015), position(event.clientX, event.clientY)); };
    area.addEventListener('wheel', wheel, { passive: false });
    return () => area.removeEventListener('wheel', wheel);
  }, [ready, saving]);
  const doc = surface.current?.doc;
  return <dialog ref={dialog} className="mask-editor" aria-labelledby="mask-title" onCancel={event => { event.preventDefault(); close(); }}>
    <header className="mask-heading"><div><h2 id="mask-title">{mode==='repair'?'局部重绘视图':'手动修正抠图'}</h2><p>{mode==='repair'?'涂选要修正的服装、发型或配饰。红色区域会重绘，选区外保留原图。':'恢复衣服、头发与配饰，擦除残留背景。红色区域会被删除。'}</p></div><button title="关闭修正" onClick={close} disabled={saving}><X size={21}/></button></header>
    <div className="mask-toolbar"><div className="mask-tools">{([['restore', '恢复前景', Paintbrush], ['erase', '擦除背景', Eraser], ['pan', '移动画布', Hand]] as const).map(([value, label, Icon]) => <button key={value} className={tool === value ? 'selected' : ''} aria-pressed={tool === value} disabled={!ready || saving} onClick={() => { finish(); setTool(value); if (value !== 'pan' && view === 'original') setView('overlay'); }}><Icon size={16}/>{mode==='repair'&&value!=='pan'?(value==='restore'?'涂选重绘':'擦除选区'):label}</button>)}</div><label>笔刷大小 <input aria-label="笔刷大小" type="range" min="1" max="200" value={diameter} disabled={saving} onChange={e => setDiameter(Number(e.target.value))}/><output>{diameter} px</output></label><label>边缘硬度 <input aria-label="边缘硬度" type="range" min="0" max="1" step="0.05" value={hardness} disabled={saving} onChange={e => setHardness(Number(e.target.value))}/><output>{Math.round(hardness * 100)}%</output></label><button title="撤销 (Ctrl+Z)" aria-label="撤销" disabled={saving || !doc?.canUndo} onClick={() => history()}><Undo2 size={18}/></button><button title="重做 (Ctrl+Shift+Z)" aria-label="重做" disabled={saving || !doc?.canRedo} onClick={() => history(true)}><Redo2 size={18}/></button></div>
    <div className="mask-viewbar"><div>{([['overlay', '修正叠加'], ['transparent', '透明结果'], ['mask', '黑白蒙版'], ['original', '原图对照']] as const).map(([value, label]) => <button className={view === value ? 'selected' : ''} key={value} disabled={saving} onClick={() => { finish(); setView(value); }}>{label}</button>)}</div><div><button aria-label="缩小画布" disabled={!ready || saving} onClick={() => zoom(1 / 1.25)}>−</button><output>{Math.round(transform.scale * 100)}%</output><button aria-label="放大画布" disabled={!ready || saving} onClick={() => zoom(1.25)}>＋</button><button disabled={!ready || saving} onClick={fit}>适应窗口</button><button disabled={!ready || saving} onClick={() => zoom(1 / transform.scale)}>100%</button></div></div>
    {children}
    <div ref={stage} className={`mask-canvas-stage ${tool === 'pan' ? 'panning' : ''}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd} onPointerLeave={() => setCursor(null)}>
      <canvas ref={screen} aria-label={mode==='repair'?'局部重绘选区画布':'抠图蒙版修正画布'} style={{ width: surface.current?.width, height: surface.current?.height, transform: `translate(${transform.x}px,${transform.y}px) scale(${transform.scale})` }}/>
      {!ready && <span className="mask-loading">{error ? '图片读取失败' : '正在读取原图与蒙版…'}</span>}
      {ready && cursor && tool !== 'pan' && view !== 'original' && <span className={`mask-brush-cursor ${tool}`} style={{ left: cursor.x, top: cursor.y, width: diameter * transform.scale, height: diameter * transform.scale }}/ >}
    </div>
    {error && <p role="alert" className="mask-error">{error}</p>}
    <footer className="mask-footer"><p>{view === 'original' ? '原图仅供对照，切换其他视图后可继续涂画。' : '滚轮缩放 · 空格或中键拖动画布 · Ctrl+Z 撤销'}<small>{mode==='repair'?'保存为新版本；重绘后自动抠图，需重新检查一致性和轮廓。':'保存为新版本，保留原图和已有抠图。已有透明原图无法恢复原本透明区域的内容。'}</small></p>{discard ? <div className="mask-discard"><span>放弃本次未保存的修正？</span><button className="secondary" onClick={() => setDiscard(false)}>继续修正</button><button className="secondary" onClick={onClose}>放弃修改</button></div> : <div><button className="secondary" disabled={saving} onClick={close}>取消</button><button className="primary" disabled={!ready || saving || !doc?.dirty} onClick={() => void save()}>{saving ? '正在提交…' : mode==='repair'?'开始局部重绘':'保存修正'}</button></div>}</footer>
  </dialog>;
}
