import { DEFAULT_VISION_MODEL, normalizeVisionReview, assertVisionReady, acceptedFinding, buildVisionWorkflow, createVisionReview, readVisionOutput, assertVisionPolicy, visionPolicy } from '../../electron/vision.mjs';
import { normalizeConsistency, assertConsistencyReady, validateRepairMask, compositeRepair, repairPrompt } from '../../electron/consistency.mjs';
import { VIEW_ROLES, VIEW_LABELS, normalizeMultiView, readyMultiView, prepareMultiViewImages } from '../../electron/multiview.mjs';
import type { ViewRole } from '../types';
import { PIXAL_DEFAULTS, buildPixal3DWorkflow, pixalCapabilities } from '../../electron/pixal3d.mjs';
import { buildDesignWorkflow,buildQwenEditWorkflow,buildRepairWorkflow,buildMatteWorkflow,buildShapeWorkflow,validateWorkflow,collectOutputs } from '../../electron/workflows.mjs';
import { readReference } from '../texturing';
import { applyMask,alphaMask,shapeImage,summary,type Pixels } from './pixels';
import { assetUrl,isActive,type Asset,type Bootstrap,type Capabilities,type Job,type Project,type Settings,type StudioBridge } from '../types';
import { synchronize } from '../sync-engine';
import type { SyncEvent } from '../types';

interface AndroidNative { postMessage(message:string):void; onmessage:(event:{data:string})=>void }
declare global { interface Window {QNative?:AndroidNative} }
type Args = Record<string,unknown>;
const defaults:Settings={visionModel:DEFAULT_VISION_MODEL,server:'',comfyPath:'',designCheckpoint:'sdXL_v10VAEFix.safetensors',shapeCheckpoint:'hunyuan_3d_v2.1.safetensors',imageEngine:'qwen21',qwenModel:'qwen_image_2.1_int8_convrot.safetensors',qwenEncoder:'qwen3vl_8b_int8_convrot.safetensors',qwenVae:'qwen_image_2.1_vae_bf16.safetensors',backgroundModel:'birefnet.safetensors',...PIXAL_DEFAULTS};

export function initializeAndroidBridge(){
  const native=window.QNative;if(!native)return;
  document.documentElement.classList.add('android');
  let sequence=0,active:Job|null=null,session='',cancelled=false,starting=false,recovered=false;
  const editingProjects=new Set<string>();
  let syncBusy=false,syncAborted=false;const syncListeners=new Set<(event:SyncEvent)=>void>();
  const waiting=new Map<string,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>(),listeners=new Set<(job:Job)=>void>();
  native.onmessage=event=>{try{const message=JSON.parse(event.data),pending=waiting.get(message.id);if(!pending)return;waiting.delete(message.id);clearTimeout(pending.timer);if(message.error)pending.reject(new Error(message.error));else pending.resolve(message.result);}catch{/* Ignore malformed native replies. */}};
  const call=<T=unknown>(method:string,args:Args={}):Promise<T>=>new Promise((resolve,reject)=>{const id=String(++sequence),timer=setTimeout(()=>{waiting.delete(id);reject(new Error('手机操作等待超时，请重试。生成任务可按任务编号找回。'));},method.includes('export')||method==='importAsset'||method==='trustCertificate'?30*60*1000:180000);waiting.set(id,{resolve:resolve as (value:unknown)=>void,reject,timer});native.postMessage(JSON.stringify({id,method,args}));});
  const transfer=async(bytes:Uint8Array)=>{if(bytes.length>64*1024*1024)throw new Error('手机端文件不能超过 64 MB。');const id=await call<string>('beginTransfer');try{for(let i=0;i<bytes.length;i+=196608){const chunk=bytes.subarray(i,i+196608);let binary='';for(let j=0;j<chunk.length;j+=16384)binary+=String.fromCharCode(...chunk.subarray(j,j+16384));await call('appendTransfer',{id,data:btoa(binary)});}return id;}catch(e){void call('dropTransfer',{id});throw e;}};
  const png=async(image:Pixels)=>{const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.data),image.width,image.height),0,0);const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('图片保存失败。')),'image/png'));return new Uint8Array(await blob.arrayBuffer());};
  const saveAsset=async(projectId:string,bytes:Uint8Array,kind:Asset['kind'],label:string,metadata:Args={})=>call<Project>('saveAsset',{projectId,transfer:await transfer(bytes),extension:'.png',kind,label,metadata});
  const projects=async()=>{const data=await call<Bootstrap>('bootstrap');data.settings={...defaults,...data.settings};return data;};
  const read=async(id:string)=>{const p=(await projects()).projects.find(p=>p.id===id);if(!p)throw new Error('找不到作品。');return p;};
  const last=(p:Project)=>p.assets.at(-1)!;
  const idle=()=>{if(syncBusy)throw new Error('作品正在同步，请稍后编辑或生成。');if(starting||active&&isActive(active))throw new Error('请等待当前生成任务结束，或先取消任务。');};
  const emit=async(job:Job)=>{await call('saveJob',{id:job.projectId,job});listeners.forEach(fn=>fn({...job}));};
  const json=<T=Record<string,any>>(sid:string,route:string,body?:unknown)=>call<T>('remoteJson',{session:sid,route,...(body?{body}:{})});
  const infoOptions=(info:any,node:string,name:string):string[]=>{const spec=info[node]?.input?.required?.[name]??info[node]?.input?.optional?.[name];return Array.isArray(spec?.[0])?spec[0]:spec?.[1]?.options??[];};
  const capabilities=async(sid:string)=>{
    const [stats,info]=await Promise.all([json(sid,'/system_stats'),json(sid,'/object_info')]);if(!stats.system||!Array.isArray(stats.devices)||!info.KSampler?.input)throw new Error('该地址没有返回有效的 ComfyUI API，可能是穿透欢迎页或登录页。');
    const checks=infoOptions(info,'CheckpointLoaderSimple','ckpt_name'),shape=infoOptions(info,'ImageOnlyCheckpointLoader','ckpt_name');
    const cap:Capabilities={visionPolicy:visionPolicy(info),pixal:pixalCapabilities(info),stats:stats as unknown as Capabilities['stats'],checkpoints:checks.filter(n=>/sdxl|illustrious|hassaku/i.test(n)),shapeCheckpoints:shape.filter(n=>/hunyuan.*3d|hunyuan_3d/i.test(n)),missingShapeNodes:['ImageOnlyCheckpointLoader','Hunyuan3Dv2Conditioning','EmptyLatentHunyuan3Dv2','ModelSamplingAuraFlow','VAEDecodeHunyuan3D','VoxelToMesh','SaveGLB','CLIPVisionEncode','LoadImage','KSampler'].filter(n=>!info[n]),qwenModels:infoOptions(info,'UNETLoader','unet_name').filter(n=>/^qwen_image_2\.1_(bf16|int8_convrot)\.safetensors$/i.test(n)),qwenEncoders:infoOptions(info,'CLIPLoader','clip_name').filter(n=>/^qwen3vl_8b_(bf16|fp8_scaled|int8_convrot)\.safetensors$/i.test(n)),qwenVaes:infoOptions(info,'VAELoader','vae_name').filter(n=>n==='qwen_image_2.1_vae_bf16.safetensors'),backgroundModels:infoOptions(info,'LoadBackgroundRemovalModel','bg_removal_name'),missingEditNodes:['UNETLoader','CLIPLoader','VAELoader','TextEncodeQwenImage21'].filter(n=>!info[n]),missingVisionNodes:['QCharacterVisionReview','JoinImageWithAlpha','LoadImage'].filter(n=>!info[n]),missingMatteNodes:['LoadBackgroundRemovalModel','RemoveBackground','MaskToImage'].filter(n=>!info[n])};return{cap,info};
  };
  const upload=async(sid:string,projectId:string,assetId:string)=>{const result=await call<{name:string;subfolder?:string}>('remoteUpload',{session:sid,projectId,assetId});if(!result.name)throw new Error('服务没有返回上传文件名。');return result.subfolder?`${result.subfolder}/${result.name}`:result.name;};
  const receive=async(job:Job,sid:string)=>{
    const deadline=Date.now()+45*60*1000;let failures=0;
    while(Date.now()<deadline){if(cancelled)throw new Error('QCHARACTER_CANCELLED');let history:Record<string,any>|undefined;
      try{history=await json(sid,`/history/${encodeURIComponent(job.promptId!)}`);failures=0;}catch(e){failures++;job.message='连接中断，正在按原任务编号重试…';await emit(job);if(failures>=5)throw e;}
      const entry=history?.[job.promptId!];if(entry){const failed=entry.status?.messages?.find(([type]:[string])=>['execution_error','execution_interrupted'].includes(type));if(failed||entry.status?.status_str==='error')throw Object.assign(new Error(failed?.[1]?.exception_message||'ComfyUI 执行失败。'),{permanent:true});if(entry.status?.completed){if(job.kind==='review'){const p=await read(job.projectId);let report;try{const raw=readVisionOutput(entry)[0];if((job.workflow as any)?.['900']?.inputs?.review_policy==='visibility-v2'&&raw?.version!==2)throw new Error('视觉节点未返回独立复核，请更新节点并重启 ComfyUI。');report=createVisionReview(raw,p,job);}catch(error){throw Object.assign(error as Error,{permanent:true});}if(cancelled)throw new Error('QCHARACTER_CANCELLED');job.reviewResult=report;await call('saveProject',{id:p.id,fields:{visionReview:report}});return;}const outputs=collectOutputs(entry,job.kind);if(!outputs.length)throw new Error('任务完成，但没有正式输出。');
          const p=await read(job.projectId),source=p.assets.find(a=>a.id===job.inputAssetId);job.status='downloading';job.message='正在将生成结果保存到手机…';await emit(job);
          for(const output of outputs){if(cancelled)throw new Error('QCHARACTER_CANCELLED');const updated=await call<Project>('remoteDownload',{session:sid,projectId:p.id,output,kind:job.kind==='shape'?'model':job.kind==='matte'?'mask':'design',label:job.kind==='shape'?(job.engine?.startsWith('pixal3d')?(job.inputViewIds?'Pixal3D · 多视图 AI 贴图模型':'Pixal3D · AI 贴图模型'):'远程混元 3D 泥模'):job.kind==='matte'?'前景蒙版':job.viewRole?`${VIEW_LABELS[job.viewRole]} · 角色设计图`:'Q 版设计图',metadata:{jobId:job.id,viewRole:job.viewRole,...(job.inputViewIds?{inputViewIds:job.inputViewIds,viewFov:job.viewFov}:{}),...(source?{sourceAssetId:source.id}:{}),...(job.engine?.startsWith('pixal3d')?{textureMethod:'pixal3d-pbr',textureSourceId:job.inputAssetId}:{})}});
            if(cancelled)throw new Error('QCHARACTER_CANCELLED');
            if(job.repairMaskId){
              if(!source)throw new Error('找不到重绘原图。');const selection=p.assets.find(a=>a.id===job.repairMaskId);if(!selection)throw new Error('找不到重绘选区。');
              const result=compositeRepair(await readReference(assetUrl(p,source)),await readReference(assetUrl(updated,last(updated))),await readReference(assetUrl(p,selection)));
              const raw=await saveAsset(p.id,await png(result),'design','局部重绘原图',{sourceAssetId:source.id,repairMaskId:job.repairMaskId,repairInstruction:job.repairInstruction,jobId:job.id,viewRole:job.viewRole});
              const mask=await saveAsset(p.id,await png(alphaMask(result)),'mask','局部重绘前景蒙版',{sourceAssetId:last(raw).id,jobId:job.id});
              const fixed=await saveAsset(p.id,await png(result),'cutout','局部重绘 · 请重新检查一致性',{sourceAssetId:last(raw).id,maskAssetId:last(mask).id,parentCutoutId:source.id,revisionType:'repair',repairMaskId:job.repairMaskId,repairInstruction:job.repairInstruction,jobId:job.id,viewRole:job.viewRole});job.resultAssetId=last(fixed).id;
            }else if(job.kind==='matte'){if(!source)throw new Error('找不到原图。');const image=await readReference(assetUrl(p,source)),mask=await readReference(assetUrl(updated,last(updated)));const cutout=await saveAsset(p.id,await png(applyMask(image,mask)),'cutout','人物透明抠图',{sourceAssetId:source.id,maskAssetId:last(updated).id,viewRole:job.viewRole,jobId:job.id});job.resultAssetId=last(cutout).id;}else job.resultAssetId=last(updated).id;
            if(job.viewRole)await call('setView',{projectId:p.id,role:job.viewRole,assetId:job.resultAssetId,expected:job.viewExpectedId});
          }return;
      }}await new Promise(r=>setTimeout(r,1800));
    }throw new Error('等待超过 45 分钟，可稍后继续接收结果。');
  };
  const run=async(projectId:string,options:{kind:Job['kind'];assetId?:string;quality?:string;denoise?:number;viewRole?:ViewRole;multiView?:boolean;repairMaskId?:string;instruction?:string;referenceFindingId?:string},resume?:Job)=>{
    idle();starting=true;try{const settings=(await projects()).settings;
    if(resume?.server&&resume.server!==settings.server)throw new Error('当前地址与原任务地址不同，请切回原地址后继续接收。');
    const job:Job=resume?{...resume,status:'running',message:'按原任务编号继续接收…'}:{id:crypto.randomUUID(),projectId,kind:options.kind,inputAssetId:options.assetId,server:settings.server,status:'submitting',message:'检查远程模型与工作流…',createdAt:new Date().toISOString(),seed:crypto.getRandomValues(new Uint32Array(1))[0]};
    active=job;cancelled=false;try{await emit(job);}catch(e){active=null;throw e;}
    void(async()=>{let sid='';try{
      const p=await read(projectId);
      const multi=!resume&&options.kind==='shape'&&options.multiView?readyMultiView(p):null;
      if(multi){assertConsistencyReady(p);assertVisionReady(p);if(settings.shapeEngine==='hunyuan3d')throw new Error('多视图建模请选择 Pixal3D。');options={...options,assetId:multi.views.front};job.inputAssetId=multi.views.front;job.inputViewIds={...multi.views};job.viewFov=multi.fov;}
      if(!resume&&options.viewRole){if(!VIEW_ROLES.includes(options.viewRole)||options.kind==='shape')throw new Error('视图方向无效。');job.viewRole=options.viewRole;job.viewExpectedId=p.multiView?.views[options.viewRole]||'';if(options.kind==='design'&&options.viewRole!=='front'&&!options.repairMaskId){if(!p.multiView?.views.front||settings.imageEngine!=='qwen21')throw new Error('请先指定正面设计图，并使用 Qwen 参考编辑生成侧背面。');options={...options,assetId:p.multiView.views.front};job.inputAssetId=options.assetId;}}
      const source=p.assets.find(a=>a.id===options.assetId);
      if(!resume&&options.repairMaskId){if(source?.kind!=='cutout'||p.multiView?.views[options.viewRole!]!==source.id||settings.imageEngine!=='qwen21')throw new Error('目标视图已变更，或未选择 Qwen 编辑。');repairPrompt(options.viewRole!,options.instruction!);if(options.referenceFindingId)acceptedFinding(p,options.referenceFindingId,options.viewRole!,source.id);job.referenceFindingId=options.referenceFindingId;job.repairMaskId=options.repairMaskId;job.repairInstruction=options.instruction;}
      if(resume){const existing=[...p.assets].reverse().find(a=>a.jobId===job.id&&a.kind===(job.kind==='shape'?'model':job.kind==='matte'||job.repairMaskId?'cutout':'design'));if(existing){job.resultAssetId=existing.id;job.status='completed';job.message='已找回保存在手机上的结果。';return;}}
      sid=await call<string>('beginRemote');session=sid;
      if(!resume){let image:string|undefined,views:Partial<Record<ViewRole,string>>|undefined;
        if(source){const pixels=await readReference(assetUrl(p,source));
          if(options.repairMaskId){const selected=p.assets.find(a=>a.id===options.repairMaskId&&a.kind==='mask');if(!selected)throw new Error('找不到重绘选区。');validateRepairMask(pixels,await readReference(assetUrl(p,selected)));const flat={width:pixels.width,height:pixels.height,data:new Uint8ClampedArray(pixels.data)};for(let i=0;i<flat.data.length;i+=4){const a=flat.data[i+3]/255;for(let c=0;c<3;c++)flat.data[i+c]=Math.round(flat.data[i+c]*a+255*(1-a));flat.data[i+3]=255;}const prep=await saveAsset(p.id,await png(flat),'prepared','局部重绘白底输入',{sourceAssetId:source.id,jobId:job.id});image=await upload(sid,p.id,last(prep).id);}
          if(options.kind==='matte'&&summary(pixels).hasTransparency){const mask=await saveAsset(p.id,await png(alphaMask(pixels)),'mask','原有透明通道',{sourceAssetId:source.id,jobId:job.id});const cutout=await saveAsset(p.id,await png(pixels),'cutout','保留原有透明抠图',{sourceAssetId:source.id,maskAssetId:last(mask).id,viewRole:job.viewRole,jobId:job.id});job.resultAssetId=last(cutout).id;if(job.viewRole)await call('setView',{projectId:p.id,role:job.viewRole,assetId:job.resultAssetId,expected:job.viewExpectedId});job.engine='existing-alpha';job.status='completed';job.message='已保留原有透明度，请检查轮廓。';return;}
          if(options.kind==='shape'&&multi){const images:Record<string,Pixels>={};for(const [role,id]of Object.entries(multi.views)){const asset=p.assets.find(a=>a.id===id)!;images[role]=await readReference(assetUrl(p,asset));}views={};for(const [role,pixels]of Object.entries(prepareMultiViewImages(images))){if(cancelled)throw new Error('QCHARACTER_CANCELLED');const prepared=await saveAsset(p.id,await png(pixels),'prepared',`${VIEW_LABELS[role as ViewRole]} · 多视图统一取景输入`,{sourceAssetId:multi.views[role as ViewRole],viewRole:role,jobId:job.id});views[role as ViewRole]=await upload(sid,p.id,last(prepared).id);}}else if(options.kind==='shape'){if(source.kind!=='cutout')throw new Error('请先自动抠图并检查人物轮廓，再生成 3D。');const prepared=await saveAsset(p.id,await png(settings.shapeEngine==='hunyuan3d'?shapeImage(pixels):pixels),'prepared',settings.shapeEngine==='hunyuan3d'?'3D 输入 · 蒙版合成白底':'Pixal3D 输入 · 保留修正后的透明蒙版',{sourceAssetId:source.id,jobId:job.id});image=await upload(sid,p.id,last(prepared).id);}else if(!options.repairMaskId)image=await upload(sid,p.id,source.id);
        }
        if(options.kind!=='design'&&!source)throw new Error('请先选择角色图片。');
        const {cap,info}=await capabilities(sid),version=(cap.stats.system.comfyui_version||'').split('.').map(Number);job.targetedInterrupt=(version[0]>0||version[1]>39||version[1]===39&&version[2]>=1);
        const references:string[]=[];if(options.kind==='design'&&options.viewRole&&(options.viewRole!=='front'||options.repairMaskId))for(const role of VIEW_ROLES){const asset=p.assets.find(a=>a.id===p.multiView?.views[role]&&a.kind==='cutout');if((options.repairMaskId||role!=='front')&&role!==options.viewRole&&asset)references.push(await upload(sid,p.id,asset.id));}
        const params={views,fov:multi?.fov,viewRole:options.viewRole==='front'?undefined:options.viewRole,references,checkpoint:options.kind==='shape'?settings.shapeCheckpoint:settings.designCheckpoint,description:p.description,ratio:p.ratio,style:p.style,seed:job.seed,image,quality:['draft','standard','high'].includes(options.quality||'')?options.quality:'standard',denoise:options.denoise??0.65};
        const qwen=options.kind==='design'&&image&&settings.imageEngine==='qwen21';const repairSource=options.repairMaskId&&source?await readReference(assetUrl(p,source)):null;const repairGraph=options.repairMaskId?buildRepairWorkflow({...params,viewRole:options.viewRole,model:settings.qwenModel,encoder:settings.qwenEncoder,vae:settings.qwenVae,mask:await upload(sid,p.id,options.repairMaskId),width:repairSource!.width,height:repairSource!.height,instruction:options.instruction,backgroundModel:settings.backgroundModel}):null;const graph=repairGraph||(options.kind==='shape'?(settings.shapeEngine==='hunyuan3d'?buildShapeWorkflow(params):buildPixal3DWorkflow({...params,...settings})):options.kind==='matte'?buildMatteWorkflow({image,model:settings.backgroundModel}):qwen?buildQwenEditWorkflow({...params,model:settings.qwenModel,encoder:settings.qwenEncoder,vae:settings.qwenVae}):buildDesignWorkflow(params));
        validateWorkflow(graph,info);if(cancelled)throw new Error('QCHARACTER_CANCELLED');job.workflow=graph;job.engine=options.kind==='shape'?(settings.shapeEngine==='hunyuan3d'?'hunyuan3d':multi?'pixal3d-multiview':'pixal3d'):options.kind==='matte'?'birefnet':qwen?'qwen21':'sdxl';
        if(repairGraph)job.engine='qwen21-repair';
        const result=await json(sid,'/prompt',{prompt:graph,client_id:crypto.randomUUID()});if(!result.prompt_id)throw new Error('ComfyUI 没有返回任务编号。');job.promptId=result.prompt_id;job.status='running';job.message='远程服务器正在生成，可保留任务编号稍后找回。';await emit(job);
        if(cancelled){await json(sid,'/queue',{delete:[job.promptId]});if(job.targetedInterrupt)await json(sid,'/interrupt',{prompt_id:job.promptId});throw new Error('QCHARACTER_CANCELLED');}
      }
      await receive(job,sid);job.status='completed';job.message='生成完成，已保存到手机。';
    }catch(e){job.status=cancelled?'cancelled':(e as {permanent?:boolean}).permanent?'failed':job.promptId?'interrupted':'failed';job.message=cancelled?'已停止接收当前任务。':(e as Error).message;}finally{if(sid)await call('endRemote',{session:sid}).catch(()=>{});if(session===sid)session='';try{await emit(job);}finally{if(active===job)active=null;}}})();
    return job;}finally{starting=false;}
  };
  const runReview=async(projectId:string,resume?:Job)=>{
    idle();starting=true;try{
      const settings=(await projects()).settings;
      if(resume?.server&&resume.server!==settings.server)throw new Error('请切回原任务地址后继续接收。');
      const p=await read(projectId),multi=resume?null:readyMultiView(p);
      const job:Job=resume?{...resume,status:'running',message:'继续接收视觉检查…'}:{id:crypto.randomUUID(),projectId,kind:'review',seed:0,status:'submitting',message:'准备本地视觉检查…',createdAt:new Date().toISOString(),server:settings.server,visionModel:settings.visionModel||DEFAULT_VISION_MODEL,inputViewIds:{...multi!.views},engine:'local-vision'};
      active=job;cancelled=false;try{await emit(job);}catch(e){active=null;throw e;}
      void(async()=>{let sid='';try{
        sid=await call<string>('beginRemote');session=sid;
        if(!resume){const {cap,info}=await capabilities(sid);assertVisionPolicy(info);const v=(cap.stats.system.comfyui_version||'').split('.').map(Number);job.targetedInterrupt=v[0]>0||v[1]>39||v[1]===39&&v[2]>=1;
          const views:Partial<Record<ViewRole,string>>={};for(const role of VIEW_ROLES)if(job.inputViewIds?.[role]){if(cancelled)throw new Error('QCHARACTER_CANCELLED');views[role]=await upload(sid,p.id,job.inputViewIds[role]!);}
          const graph=buildVisionWorkflow({views,model:job.visionModel,description:p.description});validateWorkflow(graph,info);job.workflow=graph;if(cancelled)throw new Error('QCHARACTER_CANCELLED');
          const result=await json(sid,'/prompt',{prompt:graph,client_id:crypto.randomUUID()});if(!result.prompt_id)throw new Error('视觉检查未返回任务编号。');job.promptId=result.prompt_id;job.status='running';job.message='电脑上的视觉模型正在对比结构与数量…';await emit(job);
          if(cancelled){await json(sid,'/queue',{delete:[job.promptId]});if(job.targetedInterrupt)await json(sid,'/interrupt',{prompt_id:job.promptId});throw new Error('QCHARACTER_CANCELLED');}
        }
        await receive(job,sid);job.status='completed';job.message='视觉检查已保存，请逐项确认标记和重绘建议。';
      }catch(e){job.status=cancelled?'cancelled':(e as {permanent?:boolean}).permanent?'failed':job.promptId?'interrupted':'failed';job.message=(e as Error).message;}
      finally{if(sid)await call('endRemote',{session:sid}).catch(()=>{});if(session===sid)session='';try{await emit(job);}finally{if(active===job)active=null;}}
      })();return job;
    }finally{starting=false;}
  };
  const api:StudioBridge={
    reviewViews:projectId=>runReview(projectId),
    async syncEditing(id,editing){if(editing)editingProjects.add(id);else editingProjects.delete(id);},
    syncStatus:()=>call('syncStatus'),
    async syncPair(server,code){idle();await call('syncNetPair',{server,code});},
    async syncForget(){idle();await call('syncForget');},
    syncInspectCertificate:server=>call('inspectCertificate',{server,scope:'sync'}),
    syncTrustCertificate:certificate=>call('trustCertificate',{receipt:certificate.receipt,scope:'sync'}),
    async syncRun(ids){idle();if(editingProjects.size)throw new Error('请先保存建议或完成当前编辑，再同步作品。');syncBusy=true;syncAborted=false;try{return await synchronize(call,{ids,progress:message=>syncListeners.forEach(fn=>fn({type:'progress',message})),cancelled:()=>syncAborted});}finally{syncBusy=false;syncListeners.forEach(fn=>fn({type:'changed'}));}},
    async syncCancel(){syncAborted=true;await call('syncCancel');},
    syncAuto:enabled=>call('syncAuto',{enabled}).then(()=>{}),
    onSync:callback=>{syncListeners.add(callback);return()=>{syncListeners.delete(callback);};},
    async bootstrap(){const inFlight=!!active||starting;const data=await projects();let pending:Job|null=null;if(!recovered&&!inFlight&&!active&&!starting){recovered=true;try{for(const p of data.projects)for(const j of p.jobs)if(isActive(j)){j.status='interrupted';j.message=j.promptId?'上次任务尚未接收完成，可继续接收原任务结果。':'上次提交尚未记录任务编号。请先在 ComfyUI 历史确认执行状态，避免重复生成。';await call('saveJob',{id:p.id,job:j});pending=j;}}catch(e){recovered=false;throw e;}}return{...data,active:active||pending};},
    async settings(settings){idle();return call<Settings>('settings',{value:settings});},
    async connect(){const sid=await call<string>('beginRemote');try{return(await capabilities(sid)).cap;}finally{await call('endRemote',{session:sid});}},
    createProject:name=>call('createProject',{name}),async saveProject(id,fields){if(fields.visionReview)fields={...fields,visionReview:normalizeVisionReview(fields.visionReview,(await read(id)).assets)};if(fields.consistency)fields={...fields,consistency:normalizeConsistency(fields.consistency,(await read(id)).assets)};if(fields.multiView)fields={...fields,multiView:normalizeMultiView(fields.multiView,(await read(id)).assets)};return call('saveProject',{id,fields});},
    async setView(projectId,role,assetId,expected){idle();return call('setView',{projectId,role,assetId,expected});},
    importAsset:(projectId,kind)=>{idle();return call('importAsset',{projectId,kind});},
    async saveMask(projectId,cutoutId,bytes){idle();const p=await read(projectId),parent=p.assets.find(a=>a.id===cutoutId),source=p.assets.find(a=>a.id===parent?.sourceAssetId);if(!source)throw new Error('找不到抠图原始图片。');const image=await readReference(assetUrl(p,source));const blob=URL.createObjectURL(new Blob([new Uint8Array(bytes)]));try{const mask=await readReference(blob),corrected=applyMask(image,mask,true);return call('saveMask',{projectId,parentId:cutoutId,mask:await transfer(bytes),cutout:await transfer(await png(corrected))});}finally{URL.revokeObjectURL(blob);}},
    async saveTexture(projectId,parentId,referenceId,bytes,config){idle();return call('saveTexture',{projectId,parentId,referenceId,transfer:await transfer(bytes),config});},
    async repairView(projectId,role,assetId,bytes,instruction,findingId){idle();repairPrompt(role,instruction);const p=await read(projectId),a=p.assets.find(a=>a.id===assetId&&a.kind==='cutout');if(!a||p.multiView?.views[role]!==assetId)throw new Error('目标视图已变更，请重新打开。');if(findingId)acceptedFinding(p,findingId,role,assetId);const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)]));try{validateRepairMask(await readReference(assetUrl(p,a)),await readReference(url));}finally{URL.revokeObjectURL(url);}const mask=await saveAsset(projectId,bytes,'mask','局部重绘选区',{sourceAssetId:assetId,viewRole:role});return run(projectId,{kind:'design',assetId,viewRole:role,repairMaskId:last(mask).id,instruction,referenceFindingId:findingId});},
    generate:run,
    async cancel(){if(!active)return;cancelled=true;if(session&&active.promptId){await json(session,'/queue',{delete:[active.promptId]});if(active.targetedInterrupt)await json(session,'/interrupt',{prompt_id:active.promptId});}},
    exportAsset:(projectId,assetId)=>call('exportAsset',{projectId,assetId}),
    async exportBytes({name,bytes}){return call('exportTransfer',{name,transfer:await transfer(bytes)});},
    async openFolder(){throw new Error('手机作品保存在应用私有目录，请使用“导出”保存到系统文件夹。');},
    openComfy:()=>call('openComfy').then(()=>{}),onJob:listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},
    async resumeJob(projectId,jobId){const p=await read(projectId),job=p.jobs.find(j=>j.id===jobId&&j.promptId);if(!job)throw new Error('找不到可继续接收的任务。');return job.kind==='review'?runReview(projectId,job):run(projectId,{kind:job.kind,assetId:job.inputAssetId},job);},
    inspectCertificate:server=>call('inspectCertificate',{server}),
    trustCertificate:certificate=>call('trustCertificate',{receipt:certificate.receipt,summary:`${certificate.server}\n${certificate.subject}\n有效期：${certificate.validFrom} 至 ${certificate.validTo}\nSHA256：${certificate.fingerprint}`}),
    revokeCertificate:server=>call('revokeCertificate',{server}).then(()=>{}),
  };
  window.studio=api;
}
