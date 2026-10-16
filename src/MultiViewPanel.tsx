import { ConsistencyPanel } from './ConsistencyPanel';
import { assertConsistencyReady, type ReviewPart } from '../electron/consistency.mjs';
import type { ConsistencyReport } from './types';
import { VIEW_ROLES, VIEW_LABELS, readyMultiView } from '../electron/multiview.mjs';
import { assetUrl, type Project, type Asset, type MultiView, type ViewRole } from './types';

interface Props {
  project: Project; current?: Asset; disabled: boolean; pixal: boolean; quality: string;
  onConfigure: (value: MultiView) => void;
  onAssign: (role: ViewRole, id: string) => void;
  onImport: (role: ViewRole) => void;
  onGenerate: (role: ViewRole) => void;
  onMatte: (role: ViewRole, id: string) => void;
  onInspect: (id: string) => void;
  onBuild: () => void;
  onReviewEditing: (editing:boolean) => void;
  onReview: (report:ConsistencyReport) => Promise<void>;
  onRepair: (role:ViewRole,part?:ReviewPart) => void;
}
export function MultiViewPanel({ project, current, disabled, pixal, quality, onConfigure, onAssign, onImport, onGenerate, onMatte, onInspect, onBuild, onReview, onRepair, onReviewEditing }: Props) {
  const config = project.multiView || { enabled: false, views: {}, fov: 20 };
  const images = project.assets.filter(a => ['reference', 'design', 'cutout'].includes(a.kind));
  let reason = '';
  try { readyMultiView(project); assertConsistencyReady(project); } catch (e) { reason = (e as Error).message; }
  const directions = { front: '正对镜头', left: '鼻尖朝画面左侧', back: '头部与身体都背对镜头', right: '鼻尖朝画面右侧' };
  return <section className="multi-view panel">
    <div className="multi-view-heading"><div><span className="eyebrow">CHARACTER VIEWS</span><h3>多视图角色设计</h3><p>用同一角色的正面、侧面与背面一起建模，让服装和发型的背面有据可依。</p></div><label><input aria-label="启用多视图建模" type="checkbox" checked={config.enabled} disabled={disabled} onChange={e => onConfigure({ ...config, enabled: e.target.checked })}/>用于 Pixal3D 多视图建模</label></div>
    {(config.enabled || Object.values(config.views).some(Boolean)) && <><div className="view-cards">{VIEW_ROLES.map(role => {
      const asset = images.find(a => a.id === config.views[role]);
      return <article className="view-card" key={role} data-view={role}>
        <header><strong>{VIEW_LABELS[role]}</strong><span>{role === 'front' || role === 'back' ? '必需' : '左右至少一侧'}</span></header>
        <button className="view-image" disabled={disabled || !asset} onClick={() => asset && onInspect(asset.id)}>{asset ? <img src={assetUrl(project, asset)} alt={`${VIEW_LABELS[role]}设计图`}/> : <span>准备{VIEW_LABELS[role]}图</span>}</button>
        <small>{directions[role]}</small>
        <select aria-label={`${VIEW_LABELS[role]}视图图片`} value={asset?.id || ''} disabled={disabled} onChange={e => onAssign(role, e.target.value)}><option value="">未指定</option>{images.map((a, i) => <option key={a.id} value={a.id} disabled={VIEW_ROLES.some(r => r !== role && config.views[r] === a.id)}>{a.viewRole ? `${VIEW_LABELS[a.viewRole]} · ` : ''}{a.kind === 'cutout' ? '已抠图' : '待抠图'} · {a.label} · {i + 1}</option>)}</select>
        <div className="view-actions"><button className="secondary" disabled={disabled} onClick={() => onImport(role)}>上传</button><button className="secondary" disabled={disabled || (role !== 'front' && !config.views.front)} onClick={() => onGenerate(role)}>{role === 'front' ? '生成正面' : '参考正面生成'}</button><button className="secondary" disabled={disabled || !current || !images.some(a => a.id === current.id) || VIEW_ROLES.some(r => r !== role && config.views[r] === current?.id)} onClick={() => current && onAssign(role, current.id)}>使用当前图</button></div>
        <div className="view-actions"><button disabled={disabled || !asset} onClick={() => asset && onMatte(role, asset.id)}>自动抠图</button><button disabled={disabled || !asset} onClick={() => asset && onInspect(asset.id)}>查看／修正</button><button disabled={disabled || asset?.kind!=='cutout'} onClick={()=>onRepair(role)}>局部重绘</button><span>{asset?.kind === 'cutout' ? '已备好蒙版，请检查轮廓' : '需抠图并检查'}</span></div>
      </article>;
    })}</div>
    <p className="view-note">同一姿势、全身入镜、平视镜头，避免透视或遮挡差异。生成侧背面会参考正面及其它已抠图视图，但仍需检查发型、衣服接缝与配饰；修正蒙版后，槽位会自动使用新版本。</p>
    <ConsistencyPanel onEditing={onReviewEditing} project={project} disabled={disabled} onSave={onReview} onRepair={onRepair}/>
    <div className="multi-view-footer"><details><summary>相机视角</summary><label>水平视角<input aria-label="多视图相机视角" type="number" min="1" max="170" step="1" value={config.fov} disabled={disabled} onChange={e => { const n = Number(e.target.value); if (n >= 1 && n <= 170) onConfigure({ ...config, fov: n }); }}/></label><small>默认 20° 适合角色设计图。各视图会统一人物高度、脚底位置和留边。</small></details><div><p role="status">{!pixal ? '请在生成服务设置中选择 Pixal3D。' : reason || '正面、侧面、背面与蒙版已齐备。'}{!config.enabled && ' 开启多视图后用于建模。'}</p><button className="primary" disabled={disabled || !pixal || !config.enabled || !!reason} onClick={onBuild}>多视图生成 3D · {quality === 'draft' ? '草模' : quality === 'high' ? '精细' : '标准'}</button></div></div>
    </>}
  </section>;
}
