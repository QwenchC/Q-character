import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { safeAsset } from './store.mjs';
import { readyMultiView } from './multiview.mjs';
import { buildVisionWorkflow, createVisionReview, readVisionOutput, DEFAULT_VISION_MODEL, assertVisionPolicy, repairHistory } from './vision.mjs';
import { validateWorkflow } from './workflows.mjs';

// The same ComfyUI queue owns both vision and generation; cancellation never interrupts another user's prompt.
export async function startVisionReview(projectId, { store, client, model=DEFAULT_VISION_MODEL, emit, activate, finish }) {
  const job={id:randomUUID(),projectId,kind:'review',status:'submitting',createdAt:new Date().toISOString(),message:'准备本地视觉检查…',seed:0,server:client.base,visionModel:model,engine:'local-vision'};
  const state={job,client,cancelled:false,cancelRequested:false,targetedInterrupt:false};
  activate(state);
  let project,multi;
  try {project=await store.read(projectId);multi=readyMultiView(project);job.inputViewIds={...multi.views};await store.saveJob(projectId,job);}catch(error){finish(state);throw error;}
  emit(job);
  void(async()=>{try{
    const cap=await client.capabilities(),v=(cap.stats.system.comfyui_version||'').split('.').map(Number);
    assertVisionPolicy(cap.info);
    state.targetedInterrupt=v[0]>0||v[1]>39||v[1]===39&&v[2]>=1;
    const views={};
    for(const [role,id]of Object.entries(multi.views)){
      if(state.cancelRequested)throw new Error('QCHARACTER_CANCELLED');
      const a=project.assets.find(a=>a.id===id);views[role]=await client.upload(await fs.readFile(safeAsset(store.root,projectId,a.filename)),'vision-view.png');
    }
    const repairs={};for(const [role,r]of Object.entries(repairHistory(project.assets,multi.views))){repairs[role]={};for(const [key,id]of [['before',r.beforeId],['mask',r.maskId]]){if(state.cancelRequested)throw new Error('QCHARACTER_CANCELLED');const a=project.assets.find(a=>a.id===id);repairs[role][key]=await client.upload(await fs.readFile(safeAsset(store.root,projectId,a.filename)),'repair-context.png');}}
    const graph=buildVisionWorkflow({views,repairs,model,description:project.description});validateWorkflow(graph,cap.info);job.workflow=graph;
    if(state.cancelRequested)throw new Error('QCHARACTER_CANCELLED');
    const response=await client.json('/prompt',{prompt:graph,client_id:client.clientId});
    if(!response.prompt_id)throw new Error('视觉检查未返回任务编号。');
    job.promptId=response.prompt_id;job.status='running';job.message='本地视觉模型正在对比结构与数量，请稍候…';await store.saveJob(projectId,job);emit(job);
    if(state.cancelRequested){await client.cancel(job.promptId,state.targetedInterrupt);state.cancelled=true;}
    const [raw]=await client.waitFor(job.promptId,'review',()=>state.cancelled,message=>{job.message=message;emit(job);},readVisionOutput);
    if(state.cancelRequested)throw new Error('QCHARACTER_CANCELLED');
    if(raw?.version!==3)throw new Error('视觉节点未返回修补痕迹复核结果，请更新节点并重启 ComfyUI。');
    const report=createVisionReview(raw,project,job);job.reviewResult=report;
    await store.saveFields(projectId,{visionReview:report});
    job.status='completed';job.message='视觉检查完成，请逐项核对标记与建议；确认后才会重绘。';
  }catch(e){job.status=state.cancelRequested?'cancelled':'failed';job.message=state.cancelRequested?'视觉检查已取消。':e.message;}
  finally{job.finishedAt=new Date().toISOString();try{await store.saveJob(projectId,job);}finally{finish(state);emit(job);}}
  })();
  return job;
}
