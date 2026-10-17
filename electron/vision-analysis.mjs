import {repairHistory} from './vision-history.mjs';
export const VISION_POLICY='repair-aware-v3';
export const CHECK_ENUMS={
  verdict:['structural','perspective','occluded','uncertain'],
  reference_visibility:['clear','partial','hidden','unknown'], target_visibility:['clear','partial','hidden','unknown'],
  correspondence:['same_component','different_surface','unknown'], basis:['component_type','connection','count','outline','surface_detail'],
  alternative:['none','perspective','occlusion','different_surface','unknown'], count_unit:['per_component','whole_character','unknown'],
};
export const CLASS_LABELS={structural:'疑似结构差异',perspective:'可能为正常透视',occluded:'遮挡／不可见',uncertain:'证据不足',repair_artifact:'可能为修补痕迹'};
export const VISIBILITY_LABELS={clear:'完整清晰',partial:'部分可见',hidden:'不可见',unknown:'不确定'};
const fail=()=>{throw new Error('视觉复核记录不完整或证据相互矛盾，请重新检查。');};
const str=(v,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail();return v;};
const count=v=>{if(v!==null&&(!Number.isInteger(v)||v<0||v>32))fail();return v;};
export function structuralEvidence(c){
  return c.reference_visibility==='clear'&&c.target_visibility==='clear'&&c.correspondence==='same_component'&&c.alternative==='none'&&c.basis!=='outline'&&c.reference_bbox!==null&&
    (c.kind==='count'?c.basis==='count'&&c.count_unit==='per_component'&&Number.isInteger(c.reference_count)&&Number.isInteger(c.target_count)&&c.reference_count!==c.target_count:c.basis!=='count');
}
export function normalizeAnalysis(value,roles,normalizeBox,version=2,assets=[],views={}){
  const v3=version===3,verdicts=v3?[...CHECK_ENUMS.verdict,'repair_artifact']:CHECK_ENUMS.verdict;
  if(!value||value.policy!==(v3?VISION_POLICY:'visibility-v2')||!Number.isInteger(value.candidateCount)||value.candidateCount<0||value.candidateCount>6||![value.overviewMs,value.verificationMs].every(v=>Number.isFinite(v)&&v>=0&&v<=3600000)||!Array.isArray(value.checks)||value.checks.length>12)fail();
  const repairs=v3?repairHistory(assets,views):undefined;
  if(v3&&(!value.repairs||Array.isArray(value.repairs)||Object.keys(value.repairs).length!==Object.keys(repairs).length||Object.entries(repairs).some(([role,r])=>!value.repairs[role]||Object.keys(value.repairs[role]).length!==3||Object.keys(r).some(k=>value.repairs[role][k]!==r[k]))))fail();
  const seen=new Set();
  const checks=value.checks.map(raw=>{
    if(!raw||Object.entries(CHECK_ENUMS).some(([key,values])=>!(key==='verdict'?verdicts:values).includes(raw[key]))||!verdicts.includes(raw.model_verdict)||!roles.includes(raw.role)||raw.role==='front'||!['hair','clothes','accessories'].includes(raw.part)||!['count','structure'].includes(raw.kind))fail();
    const candidate_index=raw.candidate_index;
    if(!Number.isInteger(candidate_index)||candidate_index< -1||candidate_index>=value.candidateCount||candidate_index>=0&&seen.has(candidate_index))fail();
    if(candidate_index>=0)seen.add(candidate_index);
    if(!Number.isFinite(raw.confidence)||raw.confidence<0||raw.confidence>1||!Array.isArray(raw.gates)||raw.gates.length>7)fail();
    const c={candidate_index,role:raw.role,part:raw.part,kind:raw.kind,title:str(raw.title,120),reason:str(raw.reason,1000),reference_evidence:str(raw.reference_evidence,1000),target_evidence:str(raw.target_evidence,1000),suggestion:str(raw.suggestion,1000),confidence:raw.confidence,reference_count:count(raw.reference_count),target_count:count(raw.target_count),bbox:normalizeBox(raw.bbox),reference_bbox:raw.reference_bbox===null?null:normalizeBox(raw.reference_bbox),...Object.fromEntries(Object.keys(CHECK_ENUMS).map(k=>[k,raw[k]])),model_verdict:raw.model_verdict,gates:raw.gates.map(g=>str(g,120))};
    if(v3){
      if(!['none','boundary','interior','outside','unknown'].includes(raw.repair_relation)||!['surface_trace','component_change','none','uncertain'].includes(raw.repair_assessment)||!['present','absent','uncertain'].includes(raw.component_evidence))fail();
      Object.assign(c,{repair_relation:raw.repair_relation,repair_assessment:raw.repair_assessment,component_evidence:raw.component_evidence,repair_evidence:str(raw.repair_evidence,1000)});
      if(c.repair_assessment==='surface_trace'&&c.verdict!=='repair_artifact'&&!(c.verdict==='uncertain'&&c.gates.length))fail();
      const coverage=raw.repair_coverage;
      if(repairs[c.role]){if(!coverage||!['selected','boundary'].every(k=>Number.isFinite(coverage[k])&&coverage[k]>=0&&coverage[k]<=1))fail();c.repair_coverage={selected:coverage.selected,boundary:coverage.boundary};}
      else if(coverage!==null)fail();else c.repair_coverage=null;
      if(c.verdict==='repair_artifact'&&(!repairs[c.role]||!['boundary','interior'].includes(c.repair_relation)||c.repair_assessment!=='surface_trace'||c.component_evidence!=='absent'||c.target_visibility!=='clear'||!['outline','surface_detail'].includes(c.basis)||c.gates.length||c.repair_coverage.selected<.05||c.repair_coverage.boundary<.02||c.reference_count!==null&&c.target_count!==null&&c.reference_count!==c.target_count))fail();
    }
    if(c.verdict==='structural'&&(!structuralEvidence(c)||c.model_verdict!=='structural'||c.gates.length||v3&&c.component_evidence!=='present'))fail();
    if(c.verdict!==c.model_verdict&&!(v3&&c.verdict==='repair_artifact')&&(c.verdict!=='uncertain'||!(['structural',...(v3?['repair_artifact']:[])].includes(c.model_verdict)||v3&&c.repair_assessment==='surface_trace')||!c.gates.length))fail();
    return c;
  });
  if(seen.size!==value.candidateCount)fail();
  return{policy:value.policy,...(v3?{repairs}:{}),candidateCount:value.candidateCount,overviewMs:value.overviewMs,verificationMs:value.verificationMs,checks};
}
export function validateFindingLinks(findings,analysis){
  const expected=analysis.checks.flatMap((c,i)=>c.verdict==='structural'?[i]:[]);
  if(findings.length!==expected.length)fail();
  for(const [i,f]of findings.entries()){
    const index=expected[i],c=analysis.checks[index];
    if(f.assessmentIndex!==index||['role','part','kind','reference_count','target_count'].some(k=>f[k]!==c[k])||JSON.stringify(f.bbox)!==JSON.stringify(c.bbox)||JSON.stringify(f.reference_bbox)!==JSON.stringify(c.reference_bbox))fail();
  }
}
export function visionPolicy(info){const input=info?.QCharacterVisionReview?.input;const spec=input?.optional?.review_policy??input?.required?.review_policy;return Array.isArray(spec?.[0])&&spec[0].includes(VISION_POLICY)?VISION_POLICY:null;}
export function assertVisionPolicy(info){if(visionPolicy(info)!==VISION_POLICY)throw new Error('请先更新电脑端 QCharacterVision 节点并重启 ComfyUI，以启用修补痕迹复核。');}
