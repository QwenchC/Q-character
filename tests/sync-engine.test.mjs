import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID}from'node:crypto';import{build}from'esbuild';import{revision}from'../electron/sync-protocol.mjs';
const code=(await build({entryPoints:['src/sync-engine.ts'],bundle:true,write:false,format:'esm',logLevel:'silent'})).outputFiles[0].text;
const{synchronize}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
for(const lostAcknowledgement of [false,true])test(`冲突副本继续编辑使用共同基线，不再次分叉；丢失提交确认=${lostAcknowledgement}`,async()=>{
 const id=randomUUID(),serverId=randomUUID(),date=new Date().toISOString(),m={protocol:1,project:{id,name:'V3 复核',description:'',ratio:'2.5',style:'clay',heightMm:80,createdAt:date,updatedAt:date,assets:[],jobs:[]},files:[]},clone=x=>structuredClone(x),base=new Map([[id,clone(m)]]),local=new Map([[id,clone(m)]]),remote=new Map([[id,clone(m)]]);
 local.get(id).project.heightMm=100;remote.get(id).project.heightMm=90;remote.get(id).revision=await revision(remote.get(id));let lose=lostAcknowledgement;
 const call=async(method,args={})=>{
  if(method==='syncNetBegin')return'session';if(method==='syncNetEnd')return;
  if(method==='bootstrap')return{projects:[...local.values()].map(m=>m.project)};
  if(method==='syncSnapshot')return clone(local.get(args.id)??null);
  if(method==='syncBaseGet')return clone(base.get(args.id)??null);
  if(method==='syncBasePut'){base.set(args.id,clone(args.manifest));return;}
  if(method==='syncCommit'){local.set(args.manifest.project.id,clone(args.manifest));return;}
  if(method==='syncHasFile')return true;
  if(method==='syncNetJson'){
   const route=args.route.replace('/qsync/v1','');if(route==='/info')return{protocol:1,serverId};if(route==='/projects')return{projects:[...remote.values()].map(m=>({id:m.project.id,name:m.project.name}))};
   const [,pid,action]=route.match(/^\/projects\/([^/]+)\/(manifest|missing|commit)$/)??[];
   if(action==='manifest')return{manifest:clone(remote.get(pid)??null)};
   if(action==='missing')return{missing:[]};
   if(action==='commit'){const accepted=clone(args.body.manifest);accepted.revision=await revision(accepted);remote.set(pid,accepted);if(pid!==id&&lose){lose=false;throw Error('提交成功但响应丢失');}return{manifest:clone(accepted)};}
  }throw Error('Unexpected '+method);
 };
 const run=ids=>synchronize(call,{ids,progress:()=>{},cancelled:()=>false});let result=await run([id]);if(lostAcknowledgement){assert.equal(result.errors.length,1);result=await run([id]);}
 assert.equal(result.errors.length,0);assert.equal(result.conflicts,1);const copy=[...local.keys()].find(k=>k!==id);assert.ok(copy);assert.ok(base.has(copy));assert.equal(local.size,2);assert.equal(remote.size,2);
 local.get(copy).project.heightMm=110;result=await run([copy]);assert.equal(result.errors.length,0);assert.equal(result.conflicts,0);assert.equal(remote.get(copy).project.heightMm,110);assert.equal(local.size,2);assert.equal(remote.size,2);
});
