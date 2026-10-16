import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { build } from 'esbuild';
const bundle = (await build({entryPoints:['src/mobile/bridge.ts'],bundle:true,write:false,format:'iife',globalName:'Mobile',logLevel:'silent'})).outputFiles[0].text;
const tick = () => new Promise(resolve => setTimeout(resolve,10));
async function wait(fn) { for(let i=0;i<200;i++){if(fn())return;await tick();}throw Error('Job did not settle'); }
function phone({version='0.39.1',oldJob,server='https://example.test:8443/comfy'}={}){
  const project={id:'p',name:'Test',description:'a clay girl',ratio:'2.5',style:'clay',assets:[],jobs:oldJob?[oldJob]:[]};
  const settings={server,designCheckpoint:'sdxl.safetensors',imageEngine:'qwen21'};
  const calls=[],events=[];let complete=false,stale=false;
  const info=Object.fromEntries(['KSampler','CheckpointLoaderSimple','CLIPTextEncode','EmptyLatentImage','VAEDecode','SaveImage'].map(n=>[n,{input:{required:{}}}]));
  const native={postMessage(text){const {id,method,args}=JSON.parse(text);calls.push({method,args});Promise.resolve().then(()=>{
    let result;
    if(method==='bootstrap'){result={settings,projects:[structuredClone(project)]};if(stale){stale=false;result.projects[0].jobs.forEach(j=>j.status='running');}}
    else if(method==='saveJob'){const index=project.jobs.findIndex(j=>j.id===args.job.id);if(index<0)project.jobs.push(args.job);else project.jobs[index]=args.job;result=true;}
    else if(method==='beginRemote')result='session';
    else if(method==='remoteJson'){
      if(args.route==='/system_stats')result={system:{comfyui_version:version},devices:[]};
      else if(args.route==='/object_info')result=info;
      else if(args.route==='/prompt')result={prompt_id:'original-prompt'};
      else if(args.route.startsWith('/history/'))result=complete?{'original-prompt':{status:{completed:true},outputs:{'7':{images:[{filename:'result.png',type:'output'}]}}}}:{};
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
