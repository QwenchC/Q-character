import { CLASS_LABELS, VISIBILITY_LABELS, type VisionCheck, type VisionReview } from '../electron/vision.mjs';
import { VIEW_LABELS } from '../electron/multiview.mjs';
import { PART_LABELS } from '../electron/consistency.mjs';

const basis={component_type:'部件类型',connection:'连接方式',count:'同类部件数量',outline:'二维轮廓',surface_detail:'表面细节'};
const correspondence={same_component:'对应同类部件',different_surface:'不同表面／部件',unknown:'对应关系不确定'};
const alternative={none:'未找到其它解释',perspective:'透视可解释',occlusion:'遮挡可解释',different_surface:'不同表面可解释',unknown:'其它解释未排除'};
export function CheckEvidence({check:c}:{check:VisionCheck}){
  return <><p>正面：{c.reference_evidence}</p><p>目标：{c.target_evidence}</p><p>{c.reason}</p><small>{basis[c.basis]} · {correspondence[c.correspondence]} · 正面{VISIBILITY_LABELS[c.reference_visibility]}／目标{VISIBILITY_LABELS[c.target_visibility]} · {alternative[c.alternative]}</small>{!!c.gates.length&&<p>暂不建议重绘：{c.gates.join('；')}</p>}</>;
}
export function VisionAnalysisPanel({report,onRegion}:{report:VisionReview;onRegion:(index:number)=>void}){
  const analysis=report.analysis;
  if(!analysis)return <p className="view-note">此为旧版单次检测记录。更新电脑端视觉节点后重新检查，可获得透视与遮挡复核。</p>;
  return <div className="vision-analysis"><div className="vision-class-counts">{(Object.keys(CLASS_LABELS) as VisionCheck['verdict'][]).map(key=><span key={key} className={`vision-class ${key}`}>{CLASS_LABELS[key]} {analysis.checks.filter(c=>c.verdict===key).length}</span>)}</div>
    <p className="view-note">先初检，再结合原图与局部放大独立复核。正常透视、遮挡和证据不足不会直接创建重绘建议；仍请核对分类与全图，避免漏检。初检 {Math.round(analysis.overviewMs/1000)} 秒 · 复核 {Math.round(analysis.verificationMs/1000)} 秒。</p>
    <details className="vision-assessments"><summary>查看全部复核依据（{analysis.checks.length}）</summary>{analysis.checks.map((c,i)=><article key={i}><strong className={`vision-class ${c.verdict}`}>{CLASS_LABELS[c.verdict]}</strong><h4>{VIEW_LABELS[c.role]} · {PART_LABELS[c.part]} · {c.title}</h4><CheckEvidence check={c}/><button type="button" onClick={()=>onRegion(i)}>查看对应区域</button></article>)}{!analysis.checks.length&&<p>未生成可定位的差异候选，请对照全图检查。</p>}</details>
  </div>;
}
