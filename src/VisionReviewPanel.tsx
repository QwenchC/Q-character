import { VisionAnalysisPanel, CheckEvidence } from './VisionAnalysisPanel';
import { useEffect, useState } from 'react';
import { visionState, type VisionReview, type VisionFinding } from '../electron/vision.mjs';
import { VIEW_ROLES, VIEW_LABELS, readyMultiView } from '../electron/multiview.mjs';
import { PART_LABELS } from '../electron/consistency.mjs';
import { assetUrl, type Project } from './types';

export function VisionReviewPanel({project,disabled,onRun,onSave,onRepair,onEditing,onDirty}:{project:Project;disabled:boolean;onRun:()=>Promise<void>;onSave:(r:VisionReview)=>Promise<void>;onRepair:(f:VisionFinding)=>void;onEditing:(value:boolean)=>void;onDirty:(value:boolean)=>void}){
  const [error,setError]=useState(''),[saving,setSaving]=useState(false),[selected,setSelected]=useState(''),[drafts,setDrafts]=useState<Record<string,Partial<VisionFinding>>>({});
  const [focused,setFocused]=useState(false);
  const dirty=Object.keys(drafts).length>0;
  useEffect(()=>{onDirty(dirty);return()=>onDirty(false);},[dirty,onDirty]);
  useEffect(()=>{onEditing(focused||dirty);},[focused,dirty,onEditing]);
  useEffect(()=>()=>onEditing(false),[onEditing]);
  const report=project.visionReview,state=visionState(project);
  const locked=disabled||saving||state==='stale';let ready=true;try{readyMultiView(project);}catch{ready=false;}
  const act=async(fn:()=>Promise<void>)=>{setError('');setSaving(true);try{await fn();}catch(e){setError((e as Error).message);}finally{setSaving(false);}};
  const edit=async(f:VisionFinding,fields:Partial<VisionFinding>)=>{await onSave({...report!,confirmed:false,findings:report!.findings.map(x=>({...x,...drafts[x.id],...(x.id===f.id?fields:{})}))});setDrafts({});};
  const draft=(f:VisionFinding,fields:Partial<VisionFinding>)=>setDrafts(old=>({...old,[f.id]:{...old[f.id],...fields}}));
  const focus=report?.findings.find(f=>f.id===selected)??report?.analysis?.checks.map((c,i)=>({...c,id:'check:'+i})).find(c=>c.id===selected);
  return <section className="vision-panel consistency-panel" onFocusCapture={()=>setFocused(true)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setFocused(false);}}>
    <div className="consistency-heading"><div><h3>本地视觉 · 结构与数量检查</h3><p>对比服装层次、发束与配饰，标出疑似差异并提出局部修正建议。</p></div><button disabled={disabled||saving||!ready||dirty} onClick={()=>void act(onRun)}>{report?'重新运行视觉检查':'运行本地视觉检查'}</button></div>
    <p className="view-note">使用电脑上已安装的视觉模型。检测可能误判透视、遮挡和细节；标记是待核对的建议。先逐项确认，再调整红色选区并点击“开始局部重绘”。</p>
    {state==='stale'&&<p role="alert">视图已改变，旧标记仅供参考，请重新检测。</p>}
    {report&&<><p>{report.summary}</p><small>{report.model} · {Math.round(report.elapsedMs/1000)} 秒 · {new Date(report.createdAt).toLocaleString()}</small>
      <VisionAnalysisPanel project={project} report={report} onRegion={i=>{setSelected("check:"+i);document.querySelector(".vision-images")?.scrollIntoView({block:"center",behavior:"smooth"});}}/>
      <div className="vision-images">{VIEW_ROLES.filter(role=>report.views[role]).map(role=>{const a=project.assets.find(a=>a.id===report.views[role]);const boxes=focus?(focus.role===role?[{...focus,reference:false}]:role==='front'&&focus.reference_bbox?[{...focus,bbox:focus.reference_bbox,reference:true}]:[]):report.findings.filter(f=>f.role===role).map(f=>({...f,reference:false}));return a&&<figure key={role}><div><img src={assetUrl(project,a)} alt={`${VIEW_LABELS[role]}视觉标记`}/><svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label={`${VIEW_LABELS[role]}疑似差异区域`}>{boxes.map(f=><g key={f.id} className={f.reference?'reference':selected.startsWith('check:')?'review-context':''} onClick={()=>setSelected(f.id)}><rect x={f.bbox[0]} y={f.bbox[1]} width={f.bbox[2]-f.bbox[0]} height={f.bbox[3]-f.bbox[1]}/><text x={f.bbox[0]+4} y={Math.max(28,f.bbox[1]-6)}>{report.findings.some(x=>x.id===f.id)?report.findings.findIndex(x=>x.id===f.id)+1:'复核'}</text></g>)}</svg></div><figcaption>{VIEW_LABELS[role]}{role==='front'?' · 蓝框为参照':''}</figcaption></figure>;})}</div>
      <button className="secondary" disabled={!selected} onClick={()=>setSelected('')}>显示全部标记</button>
      <div className="vision-findings">{report.findings.map((f,i)=><article key={f.id} data-finding={f.id} className={selected===f.id?'selected':''}>
        <button className="vision-finding-title" onClick={()=>setSelected(f.id)}>{i+1}. {VIEW_LABELS[f.role]} · {PART_LABELS[f.part]} · {f.title}</button>
        {report.analysis&&f.assessmentIndex!==undefined&&<details><summary>独立复核证据</summary><CheckEvidence check={report.analysis.checks[f.assessmentIndex]}/></details>}
        <p>{f.evidence}</p><small>{f.kind==='count'?'数量差异':'结构差异'} · 正面可见数 {f.reference_count??'不确定'} ／ 当前可见数 {f.target_count??'不确定'} · 模型自评 {Math.round(f.confidence*100)}%（不代表正确率）</small>
        <label>重绘建议<textarea aria-label={`建议 ${i+1}`} key={report.id+':'+f.suggestion} maxLength={2000} rows={3} value={drafts[f.id]?.suggestion??f.suggestion} disabled={locked} onChange={e=>draft(f,{suggestion:e.target.value})}/></label>
        <label>核对说明<input aria-label={`核对说明 ${i+1}`} key={report.id+':'+f.note} maxLength={1000} value={drafts[f.id]?.note??f.note} disabled={locked} placeholder="例如侧面被遮挡，或该部件只在背面存在" onChange={e=>draft(f,{note:e.target.value})}/></label>
        <div className="view-actions"><button disabled={locked||!drafts[f.id]} onClick={()=>void act(()=>edit(f,{}))}>保存建议与说明</button><span>{f.decision==='accepted'?'已确认，待修正':f.decision==='dismissed'?'已核对，无需修正':'待你确认'}</span><button disabled={locked} onClick={()=>void act(async()=>{await edit(f,{decision:'accepted'});onRepair({...f,...drafts[f.id],decision:'accepted'});})}>确认建议并调整选区</button><button disabled={locked||!(drafts[f.id]?.note??f.note).trim()} onClick={()=>void act(()=>edit(f,{decision:'dismissed'}))}>合理差异／无需修正</button><button disabled={locked||f.decision==='pending'} onClick={()=>void act(()=>edit(f,{decision:'pending'}))}>恢复待核对</button></div>
      </article>)}</div>
      {!report.findings.length&&<p>模型未发现明确差异，仍需对照各方向核对。</p>}
      {!!report.uncertainties.length&&<div className="vision-uncertain"><strong>无法确认的内容，请人工核对</strong><ul>{report.uncertainties.map((u,i)=><li key={i}>{u}</li>)}</ul></div>}
      <details><summary>各方向的观察与可见数量</summary>{report.observations.map((o,i)=><p key={i}><strong>{VIEW_LABELS[o.role]} · {PART_LABELS[o.part]} · {o.name}</strong>（可见数：{o.visible_count??'不确定'}）{o.description}</p>)}</details>
      <button disabled={locked||dirty||report.confirmed||report.findings.some(f=>f.decision!=='dismissed')} onClick={()=>void act(()=>onSave({...report,confirmed:true}))}>{state==='confirmed'?'已核对本次检测':'已核对标记及不确定项，确认本次检测'}</button>
      {report.findings.some(f=>f.decision==='accepted')&&<p>已确认的修正需完成重绘，然后重新检测新版本；不会自动视为已解决。</p>}
    </>}
    <details><summary>历史视觉检查（{project.jobs.filter(j=>j.reviewResult).length}）</summary>{project.jobs.filter(j=>j.reviewResult).slice().reverse().map(j=><div key={j.id}><strong>{new Date(j.createdAt).toLocaleString()} · {j.reviewResult!.model}</strong><p>{j.reviewResult!.summary}</p><small>{j.reviewResult!.findings.length} 项建议 · {j.reviewResult!.confirmed?'当时已确认':'当时未确认'}</small></div>)}</details>
    {dirty&&<p role="status">建议或说明尚未保存。保存后可同步作品或重新检测。</p>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
