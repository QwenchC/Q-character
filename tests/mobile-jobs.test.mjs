import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { build } from 'esbuild';
const bundle = (await build({entryPoints:['src/mobile/bridge.ts'],bundle:true,write:false,format:'iife',globalName:'Mobile',logLevel:'silent'})).outputFiles[0].text;
const tick = () => new Promise(resolve => setTimeout(resolve,10));
async function wait(fn) { for(let i=0;i<200;i++){if(fn())return;await tick();}throw Error('Job did not settle'); }
function phone({version='0.39.1',oldJob,vision=false,server='https://example.test:8443/comfy'}={}){
  const project={id:'p',name:'Test',description:'a clay girl',ratio:'2.5',style:'clay',assets:[],jobs:oldJob?[oldJob]:[]};
  if(vision){project.assets=['front','left','back'].map(id=>({id,filename:id+'.png',kind:'cutout'}));project.multiView={enabled:true,fov:20,views:{front:'front',left:'left',back:'back'}};}
  const settings={server,designCheckpoint:'sdxl.safetensors',imageEngine:'qwen21'};
  const calls=[],events=[];let complete=false,stale=false;
  const info=Object.fromEntries(['KSampler','CheckpointLoaderSimple','CLIPTextEncode','EmptyLatentImage','VAEDecode','SaveImage','LoadImage','JoinImageWithAlpha','QCharacterVisionReview'].map(n=>[n,{input:{required:{}}}]));
  info.QCharacterVisionReview.input.optional={review_policy:[['visibility-v2','repair-aware-v3']]};
  const native={postMessage(text){const {id,method,args}=JSON.parse(text);calls.push({method,args});Promise.resolve().then(()=>{
    let result;
    if(method==='bootstrap'){result={settings,projects:[structuredClone(project)]};if(stale){stale=false;result.projects[0].jobs.forEach(j=>j.status='running');}}
    else if(method==='saveJob'){const index=project.jobs.findIndex(j=>j.id===args.job.id);if(index<0)project.jobs.push(args.job);else project.jobs[index]=args.job;result=true;}
    else if(method==='saveProject'){Object.assign(project,args.fields);result=structuredClone(project);}
    else if(method==='remoteUpload')result={name:args.assetId+'.png'};
    else if(method==='beginRemote')result='session';
    else if(method==='remoteJson'){
      if(args.route==='/system_stats')result={system:{comfyui_version:version},devices:[]};
      else if(args.route==='/object_info')result=info;
      else if(args.route==='/prompt')result={prompt_id:'original-prompt'};
      else if(args.route.startsWith('/history/'))result=complete?{'original-prompt':{status:{completed:true},outputs:vision?{'900':{text:[JSON.stringify({version:3,analysis:{policy:'repair-aware-v3',repairRoles:[],candidateCount:0,overviewMs:50,verificationMs:50,checks:[]},model:'qwen3.6:35b-a3b',elapsedMs:100,summary:'未见明确差异',observations:['front','left','back'].flatMap(role=>['hair','clothes','accessories'].map(part=>({role,part,name:part,visible_count:null,description:'遮挡不推断数量'}))),findings:[],uncertainties:['背面耳饰不可见']})]}}:{'7':{images:[{filename:'result.png',type:'output'}]}}}}:{};
      else result={};
    }else if(method==='remoteDownload'){project.assets.push({id:'result',filename:'result.png',kind:'design',jobId:args.metadata.jobId});result=structuredClone(project);}
    else result=true;
    native.onmessage({data:JSON.stringify({id,result})});
  }).catch(error=>native.onmessage({data:JSON.stringify({id,error:error.message})}));}};
  const context=vm.createContext({window:{QNative:native},document:{documentElement:{classList:{add(){}}}},crypto:webcrypto,console,Uint8Array,Uint32Array,setTimeout:(f,t)=>setTimeout(f,t===1800?5:t),clearTimeout});
  vm.runInContext(bundle,context);context.Mobile.initializeAndroidBridge();const api=context.window.studio;api.onJob(j=>events.push(j));
  return{api,calls,events,project,finish(){complete=true;},staleNextBootstrap(){stale=true;}};
}
test('Android 同时点击生成只提交一个任务；取消只针对自己的任务',async()=>{
  const p=phone();const first=p.api.generate('p',{kind:'design'});await assert.rejects(p.api.generate('p',{kind:'design'}),/等待/);await first;
  await wait(()=>p.project.jobs[0]?.promptId);await p.api.cancel();await wait(()=>p.events.at(-1)?.status==='cancelled');
  assert.equal(p.calls.filter(c=>c.args.route==='/prompt').length,1);
  assert.deepEqual(p.calls.find(c=>c.args.route==='/interrupt').args.body,{prompt_id:'original-prompt'});
  assert.deepEqual(p.calls.find(c=>c.args.route==='/queue').args.body,{delete:['original-prompt']});
});
test('旧服务取消不发送全局 interrupt',async()=>{
  const p=phone({version:'0.38.0'});await p.api.generate('p',{kind:'design'});await wait(()=>p.project.jobs[0]?.promptId);await p.api.cancel();await wait(()=>p.events.at(-1)?.status==='cancelled');
  assert.equal(p.calls.filter(c=>c.args.route==='/interrupt').length,0);
});
test('重启恢复使用原 prompt_id；更换服务器后拒绝恢复，不重复计费提交',async()=>{
  const job={id:'old',projectId:'p',kind:'design',status:'running',server:'https://example.test:8443/comfy',promptId:'original-prompt',createdAt:'2026-01-01',seed:42};
  const p=phone({oldJob:job});const data=await p.api.bootstrap();assert.equal(data.active.status,'interrupted');p.finish();await p.api.resumeJob('p','old');await wait(()=>p.events.at(-1)?.status==='completed');
  assert.equal(p.calls.filter(c=>c.args.route==='/prompt').length,0);assert.equal(p.events.at(-1).resultAssetId,'result');
  const other=phone({oldJob:job,server:'https://other.test'});await assert.rejects(other.api.resumeJob('p','old'),/地址不同/);assert.equal(other.calls.filter(c=>c.method==='beginRemote').length,0);
});

test('当前会话完成后，旧任务快照不能触发重启恢复并覆盖完成状态',async()=>{
  const p=phone();await p.api.bootstrap();p.finish();await p.api.generate('p',{kind:'design'});await wait(()=>p.events.at(-1)?.status==='completed');
  p.staleNextBootstrap();await p.api.bootstrap();
  assert.equal(p.project.jobs[0].status,'completed');assert.equal(p.calls.filter(c=>c.method==='saveJob'&&c.args.job.status==='interrupted').length,0);
});

test('局部重绘恢复只承认最终抠图，下载的中间设计图不能冒充完成结果',async()=>{
 const job={id:'repair',projectId:'p',kind:'design',status:'running',server:'https://example.test:8443/comfy',promptId:'original-prompt',repairMaskId:'selection',createdAt:'2026-01-01',seed:1};
 const partial=phone({oldJob:job});partial.project.assets.push({id:'raw',kind:'design',jobId:'repair'});await partial.api.bootstrap();await partial.api.resumeJob('p','repair');await wait(()=>partial.calls.some(c=>c.args.route?.startsWith('/history/')));assert.notEqual(partial.events.at(-1)?.status,'completed');await partial.api.cancel();await wait(()=>partial.events.at(-1)?.status==='cancelled');
 const done=phone({oldJob:job});done.project.assets.push({id:'raw',kind:'design',jobId:'repair'},{id:'final',kind:'cutout',jobId:'repair'});await done.api.bootstrap();await done.api.resumeJob('p','repair');await wait(()=>done.events.at(-1)?.status==='completed');assert.equal(done.events.at(-1).resultAssetId,'final');assert.equal(done.calls.filter(c=>c.args.route==='/prompt').length,0);
});


test('Android 视觉检测串行提交、保存结构化报告；零差异仍待确认，不下载图片',async()=>{
 const p=phone({vision:true});const first=p.api.reviewViews('p');await assert.rejects(p.api.reviewViews('p'),/等待/);await first;await wait(()=>p.project.jobs[0]?.promptId);p.finish();await wait(()=>p.events.at(-1)?.status==='completed');assert.equal(p.project.visionReview.confirmed,false);assert.equal(p.project.jobs[0].reviewResult.model,'qwen3.6:35b-a3b');assert.equal(p.calls.filter(c=>c.method==='remoteDownload').length,0);assert.equal(p.calls.filter(c=>c.args.route==='/prompt').length,1);
});

test('手机建议未保存时手动同步也会等待编辑完成',async()=>{
 const p=phone({vision:true});await p.api.syncEditing('p',true);await assert.rejects(p.api.syncRun(['p']),/保存建议/);assert.equal(p.calls.filter(c=>c.method==='syncBegin').length,0);await p.api.syncEditing('p',false);
});

test('Android 视觉检查恢复沿用原任务，取消定向中断且不生成通过记录',async()=>{
 const job={id:'abcdef12-1234-1234-1234-123456789abc',projectId:'p',kind:'review',status:'running',server:'https://example.test:8443/comfy',promptId:'original-prompt',inputViewIds:{front:'front',left:'left',back:'back'},createdAt:'2026-01-01',seed:0};
 const p=phone({vision:true,oldJob:job});await p.api.bootstrap();p.finish();await p.api.resumeJob('p',job.id);await wait(()=>p.events.at(-1)?.status==='completed');assert.equal(p.calls.filter(c=>c.args.route==='/prompt').length,0);assert.equal(p.project.visionReview.confirmed,false);
 const cancel=phone({vision:true});await cancel.api.reviewViews('p');await wait(()=>cancel.project.jobs[0]?.promptId);await cancel.api.cancel();await wait(()=>cancel.events.at(-1)?.status==='cancelled');assert.equal(cancel.project.visionReview,undefined);assert.deepEqual(cancel.calls.find(c=>c.args.route==='/interrupt').args.body,{prompt_id:'original-prompt'});
});
