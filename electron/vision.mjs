import { normalizeAnalysis, validateFindingLinks, VISION_POLICY } from './vision-analysis.mjs';
export { CLASS_LABELS, VISIBILITY_LABELS, VISION_POLICY, visionPolicy, assertVisionPolicy } from './vision-analysis.mjs';
import { VIEW_ROLES, readyMultiView } from './multiview.mjs';
import {repairHistory} from './vision-history.mjs';
export {repairHistory} from './vision-history.mjs';
export const DEFAULT_VISION_MODEL='qwen3.6:35b-a3b';
const uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const parts=['hair','clothes','accessories'];
const text=(v,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error('视觉报告包含缺失或过长的说明，请重新检测。');return v;};
const count=v=>{if(v!==null&&(!Number.isInteger(v)||v<0||v>32))throw new Error('视觉报告数量无效。');return v;};
export function normalizeBox(value){
  if(!Array.isArray(value)||value.length!==4||value.some(v=>!Number.isFinite(v)||v<0||v>1000)||value[0]>=value[2]||value[1]>=value[3])throw new Error('视觉模型返回的区域坐标无效，未创建重绘选区。');
  return [...value];
}
function payload(value, roles){
  if(!value||typeof value!=='object')throw new Error('视觉报告不完整。');
  const summary=text(value.summary,2000);
  if(!Array.isArray(value.observations)||!value.observations.length||value.observations.length>64||!Array.isArray(value.findings)||value.findings.length>24||!Array.isArray(value.uncertainties)||value.uncertainties.length>16)throw new Error('视觉报告不完整，不能视作检查通过。');
  const observations=value.observations.map(o=>{if(!roles.includes(o.role)||!parts.includes(o.part))throw new Error('视觉观察引用了不存在的方向或部件。');return {role:o.role,part:o.part,name:text(o.name,120),visible_count:count(o.visible_count),description:text(o.description,1000)};});
  for(const role of roles)for(const part of parts)if(!observations.some(o=>o.role===role&&o.part===part))throw new Error('视觉报告未完整检查各方向的服装、发型与配饰，请重新检测。');
  const findings=value.findings.map(f=>{
    if(f.role==='front'||!roles.includes(f.role)||!parts.includes(f.part)||!['structure','count'].includes(f.kind)||!Number.isFinite(f.confidence)||f.confidence<0||f.confidence>1)throw new Error('视觉差异条目无效。');
    return {role:f.role,part:f.part,kind:f.kind,title:text(f.title,120),evidence:text(f.evidence,1000),suggestion:text(f.suggestion,2000),confidence:f.confidence,reference_count:count(f.reference_count),target_count:count(f.target_count),bbox:normalizeBox(f.bbox),reference_bbox:f.reference_bbox===null?null:normalizeBox(f.reference_bbox),...(Number.isInteger(f.assessmentIndex)?{assessmentIndex:f.assessmentIndex}:{})};
  });
  return {summary,observations,findings,uncertainties:value.uncertainties.map(v=>text(v,1000))};
}
export function normalizeVisionReview(value,assets){
  if(!value||![1,2,3].includes(value.version)||!uuid.test(value.id)||typeof value.createdAt!=='string'||value.createdAt.length>80||!Number.isFinite(Date.parse(value.createdAt))||typeof value.confirmed!=='boolean'||!Number.isFinite(value.elapsedMs)||value.elapsedMs<0||value.elapsedMs>3600000)throw new Error('本地视觉检查记录无效。');
  const model=text(value.model,200),views=readyMultiView({assets,multiView:{enabled:true,fov:20,views:value.views}}).views;
  const data=payload(value,Object.keys(views)),used=new Set();
  const analysis=value.version>=2?normalizeAnalysis(value.analysis,Object.keys(views),normalizeBox,value.version,assets,views):undefined;
  if(value.version===1&&value.analysis)throw new Error('请更新应用后读取新版视觉报告。');
  const findings=data.findings.map((f,i)=>{const raw=value.findings[i];if(typeof raw.id!=='string'||!raw.id.startsWith(value.id+':')||raw.id.length>80||used.has(raw.id)||!['pending','accepted','dismissed'].includes(raw.decision)||typeof raw.note!=='string'||raw.note.length>1000)throw new Error('视觉建议的确认状态无效。');used.add(raw.id);return {...f,id:raw.id,decision:raw.decision,note:raw.note};});
  if(analysis)validateFindingLinks(findings,analysis);
  if(findings.some(f=>f.decision==='dismissed'&&!f.note.trim()))throw new Error('请填写无需修正的原因，记录遮挡或合理差异。');
  if(value.confirmed&&findings.some(f=>f.decision!=='dismissed'))throw new Error('请先处理所有疑似差异，再确认本次检测。');
  return {version:value.version,...(analysis?{analysis}:{}),id:value.id,createdAt:value.createdAt,model,elapsedMs:value.elapsedMs,views,confirmed:value.confirmed,...data,findings};
}
export function createVisionReview(raw,project,job){
  const views=readyMultiView({assets:project.assets,multiView:{enabled:true,fov:20,views:job.inputViewIds}}).views;
  const data=payload(raw,Object.keys(views)),version=raw.version??1;
  let analysis=raw.analysis;
  if(version===3){const repairs=repairHistory(project.assets,views);if(!Array.isArray(analysis?.repairRoles)||analysis.repairRoles.length!==Object.keys(repairs).length||new Set(analysis.repairRoles).size!==analysis.repairRoles.length||analysis.repairRoles.some(r=>!repairs[r]))throw new Error('视觉报告与本次修正历史不匹配。');analysis={...analysis,repairs};}
  return normalizeVisionReview({version,...(version>=2?{analysis}:{}),id:job.id,createdAt:new Date().toISOString(),model:raw.model,elapsedMs:raw.elapsedMs,views,confirmed:false,...data,findings:data.findings.map((f,i)=>({...f,id:job.id+':'+i,decision:'pending',note:''}))},project.assets);
}
export function visionState(project){
  const r=project.visionReview;if(!r)return 'unchecked';
  if(VIEW_ROLES.some(role=>(r.views[role]||'')!==(project.multiView?.views[role]||'')))return 'stale';
  return r.confirmed?'confirmed':'pending';
}
export function assertVisionReady(project){const s=visionState(project);if(s==='stale')throw new Error('视图已更新，请重新运行本地视觉检测并确认。');if(s==='pending')throw new Error('请先处理本地视觉检测的疑似差异并确认本次结果，再生成 3D。');}
export function acceptedFinding(project,id,role,assetId){
  const r=project.visionReview,f=r?.findings.find(f=>f.id===id);
  if(visionState(project)==='stale'||!f||f.decision!=='accepted'||f.role!==role||r.views[role]!==assetId)throw new Error('请先确认当前视图的重绘建议；视图变化后需要重新检测。');return f;
}
export function readVisionOutput(entry){
  const strings=entry.outputs?.['900']?.text;
  if(!Array.isArray(strings)||strings.length!==1||typeof strings[0]!=='string'||strings[0].length>120000)throw new Error('本地视觉节点没有返回完整报告。');
  return [JSON.parse(strings[0])];
}
export function buildVisionWorkflow({views,repairs={},model=DEFAULT_VISION_MODEL,description=''}){
  if(typeof model!=='string'||!model.trim()||model.length>200||/cloud/i.test(model))throw new Error('请选择本机已安装的视觉模型。');
  const graph={},inputs={model,description,review_policy:VISION_POLICY};
  for(const [i,role]of VIEW_ROLES.entries())if(views[role]){const id=String(910+i),alpha=String(920+i);graph[id]={class_type:'LoadImage',inputs:{image:views[role]}};graph[alpha]={class_type:'JoinImageWithAlpha',inputs:{image:[id,0],alpha:[id,1]}};inputs[role]=[alpha,0];}
  for(const [i,role]of VIEW_ROLES.entries())if(repairs[role]){if(!views[role]||!repairs[role].before||!repairs[role].mask)throw new Error('修正历史图片不完整。');const id=String(930+i),alpha=String(940+i),mask=String(950+i);graph[id]={class_type:'LoadImage',inputs:{image:repairs[role].before}};graph[alpha]={class_type:'JoinImageWithAlpha',inputs:{image:[id,0],alpha:[id,1]}};graph[mask]={class_type:'LoadImage',inputs:{image:repairs[role].mask}};inputs[role+'_before']=[alpha,0];inputs[role+'_selection']=[mask,0];}
  graph['900']={class_type:'QCharacterVisionReview',inputs};return graph;
}
export function boxSelection(width,height,box){
  normalizeBox(box);if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>16000000)throw new Error('重绘图片尺寸无效。');
  const out=new Uint8ClampedArray(width*height),[x1,y1,x2,y2]=box,pad=6;
  const l=Math.max(0,Math.floor(x1/1000*width)-pad),t=Math.max(0,Math.floor(y1/1000*height)-pad),r=Math.min(width,Math.ceil(x2/1000*width)+pad),b=Math.min(height,Math.ceil(y2/1000*height)+pad);
  for(let y=t;y<b;y++)for(let x=l;x<r;x++)out[y*width+x]=Math.round(255*Math.min(1,(Math.min(x-l+1,r-x,y-t+1,b-y))/pad));return out;
}
