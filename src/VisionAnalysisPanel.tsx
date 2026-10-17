import { CLASS_LABELS, VISIBILITY_LABELS, type VisionCheck, type VisionReview } from '../electron/vision.mjs';
import { VIEW_LABELS } from '../electron/multiview.mjs';
import { PART_LABELS } from '../electron/consistency.mjs';
import {assetUrl,type Project} from './types';

const basis={component_type:'部件类型',connection:'连接方式',count:'同类部件数量',outline:'二维轮廓',surface_detail:'表面细节'};
const correspondence={same_component:'对应同类部件',different_surface:'不同表面／部件',unknown:'对应关系不确定'};
const alternative={none:'未找到其它解释',perspective:'透视可解释',occlusion:'遮挡可解释',different_surface:'不同表面可解释',unknown:'其它解释未排除'};
export function CheckEvidence({check:c}:{check:VisionCheck}){
  return <><p>正面：{c.reference_evidence}</p><p>目标：{c.target_evidence}</p><p>{c.reason}</p><small>{basis[c.basis]} · {correspondence[c.correspondence]} · 正面{VISIBILITY_LABELS[c.reference_visibility]}／目标{VISIBILITY_LABELS[c.target_visibility]} · {alternative[c.alternative]}</small>{c.repair_evidence&&<p>修正前后核对：{c.repair_evidence}<br/><small>修正影响：{({surface_trace:'表面痕迹',component_change:'真实部件变化',none:'未关联',uncertain:'不确定'} as const)[c.repair_assessment!]} · 独立部件依据：{c.component_evidence==='present'?'可见':c.component_evidence==='absent'?'未见':'不确定'} · 与选区关系：{({none:'未关联选区',boundary:'边缘',interior:'内部',outside:'选区外',unknown:'不确定'} as const)[c.repair_relation!]}</small></p>}{!!c.gates.length&&<p>暂不建议重绘：{c.gates.join('；')}</p>}</>;
}
export function VisionAnalysisPanel({report,project,onRegion}:{report:VisionReview;project:Project;onRegion:(index:number)=>void}){
  const analysis=report.analysis;
  if(!analysis)return <p className="view-note">此为旧版单次检测记录。更新电脑端视觉节点后重新检查，可获得透视与遮挡复核。</p>;
  return <div className="vision-analysis"><div className="vision-class-counts">{(Object.keys(CLASS_LABELS) as VisionCheck['verdict'][]).map(key=><span key={key} className={`vision-class ${key}`}>{CLASS_LABELS[key]} {analysis.checks.filter(c=>c.verdict===key).length}</span>)}</div>
    <p className="view-note">先初检，再结合原图与局部放大独立复核。正常透视、遮挡和证据不足不会直接创建重绘建议；仍请核对分类与全图，避免漏检。初检 {Math.round(analysis.overviewMs/1000)} 秒 · 复核 {Math.round(analysis.verificationMs/1000)} 秒。</p>
    {analysis.policy==='repair-aware-v3'&&<><p className="view-note">本次结合修正前图和实际选区区分表面痕迹与独立部件。“可能为修补痕迹”也需你核对，确认按钮不会自动勾选。</p><details className="vision-repair-history"><summary>查看修正前后与选区（{Object.keys(analysis.repairs!).length} 个方向）</summary>{Object.entries(analysis.repairs!).map(([role,r])=><div key={role}><strong>{VIEW_LABELS[role as keyof typeof VIEW_LABELS]}</strong><div>{[['beforeId','修正前'],['viewId','当前'],['maskId','白色为重绘选区']].map(([key,label])=>{const a=project.assets.find(a=>a.id===r![key as keyof typeof r]);return a&&<figure key={key}><img src={assetUrl(project,a)} alt={`${role}${label}`}/><figcaption>{label}</figcaption></figure>;})}</div></div>)}{!Object.keys(analysis.repairs!).length&&<p>当前视图没有修正历史，不能仅凭圆形轮廓判定为修补痕迹。</p>}</details></>}
    <details className="vision-assessments"><summary>查看全部复核依据（{analysis.checks.length}）</summary>{analysis.checks.map((c,i)=><article key={i}><strong className={`vision-class ${c.verdict}`}>{CLASS_LABELS[c.verdict]}</strong><h4>{VIEW_LABELS[c.role]} · {PART_LABELS[c.part]} · {c.title}</h4><CheckEvidence check={c}/><button type="button" onClick={()=>onRegion(i)}>查看对应区域</button></article>)}{!analysis.checks.length&&<p>未生成可定位的差异候选，请对照全图检查。</p>}</details>
  </div>;
}
