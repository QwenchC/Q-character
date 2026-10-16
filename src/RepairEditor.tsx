import { useState } from 'react';
import { MaskEditor } from './MaskEditor';
import { VIEW_ROLES, VIEW_LABELS } from '../electron/multiview.mjs';
import { PART_LABELS, type ReviewPart } from '../electron/consistency.mjs';
import { assetUrl, type Project, type ViewRole } from './types';

export function RepairEditor({project,role,assetId,part,onSave,onClose}:{project:Project;role:ViewRole;assetId:string;part?:ReviewPart;onSave:(bytes:Uint8Array,instruction:string)=>Promise<void>;onClose:()=>void}){
  const target=project.assets.find(a=>a.id===assetId)!;
  const [instruction,setInstruction]=useState(`参考其它视图修正${part?PART_LABELS[part]:'选区内的细节'}，保持当前${VIEW_LABELS[role]}方向、姿势和角色比例。`);
  return <MaskEditor mode="repair" original={assetUrl(project,target)} cutout={assetUrl(project,target)} onSave={bytes=>onSave(bytes,instruction)} onClose={onClose}>
    <div className="repair-instructions"><label>局部修正要求<textarea aria-label="局部修正要求" maxLength={2000} rows={2} value={instruction} onChange={e=>setInstruction(e.target.value)}/></label><details><summary>查看其它方向参考图</summary><div className="repair-references">{VIEW_ROLES.filter(r=>r!==role).map(r=>{const a=project.assets.find(a=>a.id===project.multiView?.views[r]);return a&&<figure key={r}><img src={assetUrl(project,a)}/><figcaption>{VIEW_LABELS[r]}</figcaption></figure>;})}</div></details></div>
  </MaskEditor>;
}
