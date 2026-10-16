import { VIEW_LABELS, VIEW_ROLES, readyMultiView } from '../electron/multiview.mjs';
import { analyzeConsistency, consistencyState, PART_LABELS, type ReviewPart } from '../electron/consistency.mjs';
import { readReference } from './texturing';
import { assetUrl, type Project, type ConsistencyReport, type ViewRole } from './types';
import { useEffect, useState } from 'react';

export function ConsistencyPanel({project,disabled,onSave,onRepair,onEditing}:{onEditing:(editing:boolean)=>void;project:Project;disabled:boolean;onSave:(report:ConsistencyReport)=>Promise<void>;onRepair:(role:ViewRole,part?:ReviewPart)=>void}) {
  const [checking,setChecking]=useState(false),[error,setError]=useState('');
  useEffect(()=>()=>onEditing(false),[onEditing]);
  const report=project.consistency,state=consistencyState(project);
  const run=async()=>{setChecking(true);setError('');try{const c=readyMultiView(project),images:Record<string,Awaited<ReturnType<typeof readReference>>>={};for(const [role,id]of Object.entries(c.views)){const a=project.assets.find(a=>a.id===id)!;images[role]=await readReference(assetUrl(project,a));}await onSave(analyzeConsistency(project,images));}catch(e){setError((e as Error).message);}finally{setChecking(false);}};
  const edit=async(index:number,fields:Partial<ConsistencyReport['rows'][number]>)=>{if(!report)return;setError('');try{await onSave({...report,rows:report.rows.map((r,i)=>i===index?{...r,...fields}:r)});}catch(e){setError((e as Error).message);}};
  return <div className="consistency-panel" onFocusCapture={()=>onEditing(true)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))onEditing(false);}}>
    <div className="consistency-heading"><div><h3>视图一致性检查</h3><p>对照发型、服装与配饰，确认后再建模。</p></div><button disabled={disabled||checking} onClick={()=>void run()}>{checking?'正在对比…':report?'重新检查一致性':'检查多视图一致性'}</button></div>
    <p className="view-note">自动比较人物上部与躯干取样区的颜色，辅助发现色差。区域按人物高度划分，并未识别发型结构或服装部件；配饰数量、形状和遮挡需对照图片逐项确认，背面不应复制正面图案。</p>
    {state==='stale'&&<p role="alert">视图或蒙版已更新，旧记录仅供参考。请重新检查，确认修正结果后再生成 3D。</p>}
    {report&&<><div className="review-comparison">{VIEW_ROLES.filter(role=>report.views[role]).map(role=>{const a=project.assets.find(a=>a.id===report.views[role]);return a&&<figure key={role}><img src={assetUrl(project,a)} alt={`${VIEW_LABELS[role]}一致性对照`}/><figcaption>{VIEW_LABELS[role]}{role==='front'?' · 参照':''}</figcaption></figure>;})}</div>
    <div className="review-rows">{report.rows.map((row,index)=><div className="review-row" key={report.createdAt+row.role+row.part}>
      <div><strong>{VIEW_LABELS[row.role]} · {PART_LABELS[row.part]}</strong><small>{row.distance===null?'配饰数量、位置、形状与遮挡需人工核对':`${row.part==='hair'?'人物上部':'躯干'}颜色差异：${Math.round(row.distance*100)} / 100${row.distance>.18?'，建议重点对照':'，仍需核对结构'}`}</small><span className="review-colors">{row.colors.map(c=><i key={c} style={{background:c}} title={c}/>)}</span></div>
      <label>核对结果<select aria-label={`${VIEW_LABELS[row.role]}${PART_LABELS[row.part]}核对结果`} disabled={disabled||checking||state==='stale'} value={row.status} onChange={e=>void edit(index,{status:e.target.value as typeof row.status})}><option value="pending">待人工核对</option><option value="repair">有差异，需修正</option><option value="consistent">已核对，一致</option><option value="occluded">该方向不可见／合理差异</option></select></label>
      <label>差异或遮挡说明<input aria-label={`${VIEW_LABELS[row.role]}${PART_LABELS[row.part]}说明`} disabled={disabled||checking||state==='stale'} maxLength={1000} defaultValue={row.note} onBlur={e=>{if(e.target.value!==row.note)void edit(index,{note:e.target.value});}} placeholder="例如背面看不到胸前徽章"/></label>
      <button disabled={disabled||checking||state==='stale'} onClick={()=>onRepair(row.role,row.part)}>涂选局部重绘</button>
    </div>)}</div><p role="status">{state==='confirmed'?'已逐项确认当前视图，可继续生成 3D。':'待核对或需修正项目会阻止本组视图建模。选择“不可见／合理差异”时请填写说明。'}</p></>}
    {!report&&<p className="view-note">尚未建立检查记录。开始检查后，需要确认所有项目；替换设计图或修正蒙版会使记录过期。</p>}
    {error&&<p role="alert">{error}</p>}
  </div>;
}
