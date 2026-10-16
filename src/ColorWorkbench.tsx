import { useEffect, useMemo, useRef, useState } from 'react';
import { Palette, Pipette } from 'lucide-react';
import { clayRecipe, colorName, DEFAULT_BASES, extractPalette, gramsText, toHex, type Swatch } from './color';
import { DEFAULT_PROJECTION, type Projection } from './texture-image';
import { readReference } from './texturing';
import { assetUrl, type Asset, type ClayGuide, type Project, type TextureConfig } from './types';

export function ColorWorkbench({ project, model, disabled, onTexture, onSave, onExport, onDirtyChange }: { project: Project; model?: Asset; disabled: boolean; onTexture: (referenceId: string, config: TextureConfig) => Promise<void>; onSave: (guide: ClayGuide) => Promise<void>; onExport: (guide: ClayGuide, grams: number) => Promise<void>; onDirtyChange?: (dirty:boolean)=>void }) {
  const pbr = !!model?.textureMethod?.startsWith('pixal3d-pbr');
  const references = project.assets.filter(a => a.kind === 'cutout');
  const initial = references.find(a => a.id === model?.textureSourceId || a.id === model?.sourceAssetId) ?? references.at(-1);
  const [referenceId, setReferenceId] = useState(initial?.id || ''), [swatches, setSwatches] = useState<Swatch[]>([]);
  const [bases, setBases] = useState(project.clayGuide?.bases || DEFAULT_BASES), [projection, setProjection] = useState<Projection>(model?.textureConfig?.projection || DEFAULT_PROJECTION);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [grams, setGrams] = useState(project.clayGuide?.grams ?? 5), [dirty, setDirty] = useState(false);
  useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false);},[dirty,onDirtyChange]);
  const pixels = useRef<ImageData | null>(null), reference = references.find(a => a.id === referenceId) || initial;
  const referenceUrl = reference ? assetUrl(project, reference) : '';
  useEffect(() => {
    let alive = true; pixels.current = null; setSwatches([]); setError(''); setLoading(!!referenceUrl); setDirty(false);
    if (referenceUrl) void readReference(referenceUrl).then(image => {
      if (!alive) return; pixels.current = image;
      const saved = project.clayGuide?.referenceId === reference?.id ? project.clayGuide?.swatches : model?.textureSourceId === reference?.id ? model?.textureConfig?.swatches : undefined;
      setSwatches(saved || extractPalette(image.data, image.width, image.height));
      setLoading(false);
    }).catch(e => { if (alive) { setError(e.message); setLoading(false); } });
    return () => { alive = false; };
  }, [referenceUrl]);
  const targets = swatches.map(s => s.target).join(',');
  const recipes = useMemo(() => swatches.map(s => clayRecipe(s.target, bases)), [targets, bases]);
  const guide = (): ClayGuide => ({ referenceId: reference!.id, swatches, bases, grams });
  const change = (id: string, fields: Partial<Swatch>) => { setSwatches(old => old.map(s => s.id === id ? { ...s, ...fields } : s)); setDirty(true); };
  const save = async () => { try { await onSave(guide()); setDirty(false); } catch (e) { setError((e as Error).message); } };
  return <section className="color-workbench panel">
    <div className="color-heading"><div><span className="eyebrow">COLOR & CLAY</span><h3><Palette size={20}/>贴图上色与黏土调色</h3><p>使用检查过的透明设计图，保存带贴图模型，再准备手作配色。</p></div><span className="pill">{pbr ? 'AI 贴图 · 保留 PBR 材质' : '本机上色 · 无需额外模型'}</span></div>
    {!reference ? <p className="color-notice">请先在“角色设计”中自动抠图并检查轮廓，再使用设计图上色和取色。</p> : <>
      <div className="color-setup"><div className="color-reference"><label>上色与取色参考<select aria-label="上色参考图" value={reference.id} disabled={disabled || loading} onChange={e => setReferenceId(e.target.value)}>{references.map((a, i) => <option value={a.id} key={a.id}>{a.label} · {i + 1}</option>)}</select></label><img src={referenceUrl} alt="点击前景添加配饰颜色" onClick={event => {
        const image = pixels.current; if (!image || disabled || swatches.length >= 12) return;
        const box = event.currentTarget.getBoundingClientRect(), x = Math.min(image.width - 1, Math.floor((event.clientX - box.left) / box.width * image.width)), y = Math.min(image.height - 1, Math.floor((event.clientY - box.top) / box.height * image.height)), i = (y * image.width + x) * 4;
        if (image.data[i + 3] < 240) { setError('请点击人物前景，透明背景不参与取色。'); return; }
        const rgb = [image.data[i], image.data[i + 1], image.data[i + 2]] as [number, number, number], hex = toHex(rgb);
        setSwatches(old => [...old, { id: crypto.randomUUID(), name: colorName(rgb), original: hex, target: hex, share: 0 }]); setDirty(true); setError('');
      }}/><small><Pipette size={13}/>点击人物前景，可补取头发、衣服或小配饰的颜色（最多 12 色）。</small></div>
      <div className="texture-controls"><h4>{pbr ? 'AI 贴图换色' : '设计图上色'}</h4><p>{pbr ? '模型已经包含 AI 生成的全身贴图。调整下方目标色后保存换色版本，保留原有 UV、法线、粗糙度和金属度。相近颜色会一起变化。' : '正面保留图片细节，侧背面按主要色块延展。侧背面细节为近似结果，完成后请旋转检查。'}</p>{!pbr && <><label>模型朝向<select aria-label="贴图正面朝向" disabled={disabled} value={projection.turn} onChange={e => setProjection({ ...projection, turn: Number(e.target.value) })}><option value={0}>正面 +Z · 默认生成模型</option><option value={90}>向左转 90°</option><option value={180}>转向背面 180°</option><option value={270}>向右转 90°</option></select></label><details><summary>贴图对齐微调</summary>{([['scale', '图案缩放', 0.75, 1.25], ['offsetX', '水平位置', -0.2, 0.2], ['offsetY', '垂直位置', -0.2, 0.2], ['headFraction', '背面头部范围', 0.2, 0.5]] as const).map(([key, name, min, max]) => <label key={key}>{name}<output>{projection[key].toFixed(2)}</output><input aria-label={name} type="range" min={min} max={max} step="0.01" value={projection[key]} disabled={disabled} onChange={e => setProjection({ ...projection, [key]: Number(e.target.value) })}/></label>)}</details></>}<button className="primary" disabled={disabled || !model || loading || !swatches.length} onClick={() => void (async () => { try { await onSave(guide()); setDirty(false); await onTexture(reference.id, { swatches, projection }); } catch (e) { setError((e as Error).message); } })()}>{pbr ? '保存换色模型' : '按设计图上色'}</button><small>保存为新的彩色模型版本，使用下方“导出 GLB”即可带走内嵌贴图。STL 不包含颜色。</small>{model?.textureMethod && <div className="texture-ready">{pbr ? '当前版本包含 AI 颜色与 PBR 材质贴图' : '当前版本已包含设计图颜色贴图'}</div>}</div></div>
      {loading && <p>正在提取人物前景颜色…</p>}{error && <p className="color-error" role="alert">{error}</p>}
      <div className="clay-heading"><div><h4>黏土调色指引</h4><p>可给色块命名为“头发”“服装”“配饰”等；修改目标色也会用于下一次模型上色，相近颜色会一起变化。</p></div><label>每色试配量<input aria-label="每色试配克数" type="number" min="0.5" max="50" step="0.5" disabled={disabled} value={grams} onChange={e => { setGrams(Math.max(0.5, Math.min(50, Number(e.target.value) || 5))); setDirty(true); }}/> g</label></div>
      <details className="clay-bases"><summary>设置手边的六种基础黏土颜色</summary><div>{bases.map((base, i) => <label key={i}><input type="color" aria-label={`基础黏土颜色 ${i + 1}`} value={base.hex} disabled={disabled} onChange={e => { setBases(old => old.map((b, j) => i === j ? { ...b, hex: e.target.value } : b)); setDirty(true); }}/><input aria-label={`基础黏土名称 ${i + 1}`} maxLength={20} value={base.name} disabled={disabled} onChange={e => { setBases(old => old.map((b, j) => i === j ? { ...b, name: e.target.value } : b)); setDirty(true); }}/></label>)}</div><p>按你的成品色近似设置。屏幕色值无法测出实际颜料浓度，配方仍需要试色校正。</p></details>
      <div className="clay-swatches">{swatches.map((s, i) => <article key={s.id}><header><input type="color" aria-label={`目标颜色 ${i + 1}`} value={s.target} disabled={disabled} onChange={e => change(s.id, { target: e.target.value })}/><div><input aria-label={`颜色用途 ${i + 1}`} maxLength={30} value={s.name} disabled={disabled} onChange={e => change(s.id, { name: e.target.value })}/><code>{s.target.toUpperCase()}</code></div><button title={`移除颜色 ${i + 1}`} disabled={disabled || swatches.length === 1} onClick={() => { setSwatches(old => old.filter(x => x.id !== s.id)); setDirty(true); }}>×</button></header><small>{s.share > 0 ? `前景画面约 ${(s.share * 100).toFixed(1)}% · 非用量比例` : '手动补取的配饰色'}</small><div className="clay-recipe">{recipes[i].ingredients.map(b => <span key={b.name + b.hex}><i style={{ background: b.hex }}/>{b.name} <strong>{b.parts} 份</strong><small>{gramsText(grams * b.parts / 20)} g</small></span>)}</div><p>共 20 份，按重量试配。<span style={{ background: recipes[i].predicted }} className="recipe-chip"/>近似混色预览</p>{recipes[i].difference > 12 && <p className="recipe-distant">现有基础色较难接近，建议补充近似成品色。</p>}</article>)}</div>
      <div className="clay-tips"><strong>先少量试配，再整批制作</strong><p>① 先称取主色，深色分次少量加入。② 完全揉匀，再取小块留样。③ 保留湿样和干样对照，记录补色重量后再扩大用量。不同品牌、含水量和干燥都会影响成色；配方是起始建议，微量配料先做色母或放大试配；显示克数经过四舍五入。</p></div>
      <div className="color-actions"><span>{dirty ? '配色有未保存修改' : '配色可随作品保存，供下次继续使用'}</span><button className="secondary" disabled={disabled || loading || !swatches.length} onClick={() => void save()}>保存配色</button><button className="secondary" disabled={disabled || loading || !swatches.length} onClick={() => void onExport(guide(), grams)}>导出调色指引</button></div>
    </>}
  </section>;
}
