import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createVisionReview,normalizeVisionReview,normalizeBox,visionState,assertVisionReady,acceptedFinding,buildVisionWorkflow,readVisionOutput,boxSelection} from '../electron/vision.mjs';
import {ProjectStore} from '../electron/store.mjs';
import {validateManifest,mergeManifests} from '../electron/sync-protocol.mjs';
import {startVisionReview} from '../electron/vision-runner.mjs';
const roles=['front','left','back'];
const assets=roles.map(id=>({id,kind:'cutout'}));
const project={assets,multiView:{enabled:true,fov:20,views:Object.fromEntries(roles.map(r=>[r,r]))}};
const raw=()=>({model:'qwen3.6:35b-a3b',elapsedMs:1234,summary:'衣服一致，侧面多了一个发饰，需核对。',observations:roles.flatMap(role=>['hair','clothes','accessories'].map(part=>({role,part,name:part,visible_count:null,description:'仅记录可见部分，遮挡不推断数量。'}))),findings:[{role:'left',part:'accessories',kind:'count',title:'发饰数量待核对',evidence:'正面一个，侧面两个。',suggestion:'移除多余发饰，保持侧面方向。',confidence:.8,reference_count:1,target_count:2,bbox:[200,100,400,300],reference_bbox:[400,100,600,300]}],uncertainties:['耳朵被发束遮挡，无法确认耳饰。']});
const report=()=>createVisionReview(raw(),project,{id:randomUUID(),inputViewIds:project.multiView.views});
test('模型结果始终待确认，逐项接受绑定方向与版本；未处理、修改视图或蒙版阻止建模',()=>{
 const r=report(),p={...project,visionReview:r};assert.equal(r.confirmed,false);assert.equal(r.findings[0].decision,'pending');assert.equal(visionState(p),'pending');assert.throws(()=>assertVisionReady(p),/确认/);assert.throws(()=>acceptedFinding(p,r.findings[0].id,'left','left'),/先确认/);
 r.findings[0].decision='accepted';assert.equal(acceptedFinding(p,r.findings[0].id,'left','left').title,r.findings[0].title);assert.throws(()=>acceptedFinding(p,r.findings[0].id,'back','back'),/确认/);assert.throws(()=>normalizeVisionReview({...r,confirmed:true},assets),/处理/);
 r.findings[0].decision='dismissed';r.findings[0].note='透视变化，无需修改';r.confirmed=true;assert.doesNotThrow(()=>normalizeVisionReview(r,assets));assert.doesNotThrow(()=>assertVisionReady(p));p.multiView={...project.multiView,views:{...r.views,left:'new'}};assert.equal(visionState(p),'stale');assert.throws(()=>assertVisionReady(p),/重新/);
 const clean=raw();clean.findings=[];assert.equal(createVisionReview(clean,project,{id:randomUUID(),inputViewIds:r.views}).confirmed,false);
});
test('报告拒绝错误方向、遗漏观察、越界框、伪造数量、空输出与截断 JSON',()=>{
 for(const box of [[-1,0,500,500],[0,0,1001,500],[400,0,300,50],[0,1,1,1],[0,0,NaN,5]])assert.throws(()=>normalizeBox(box));
 for(const mutate of [r=>r.findings[0].role='front',r=>r.observations.pop(),r=>r.findings[0].reference_count=-1,r=>r.findings[0].confidence=2,r=>r.findings[0].bbox=[0,0,5000,5000],r=>r.findings[0].decision='autoapproved']){const r=report();mutate(r);assert.throws(()=>normalizeVisionReview(r,assets));}
 assert.throws(()=>readVisionOutput({outputs:{'901':{text:['{}']}}}),/完整/);assert.throws(()=>readVisionOutput({outputs:{'900':{text:['{']}}}));assert.deepEqual(readVisionOutput({outputs:{'900':{text:[JSON.stringify(raw())]}}})[0],raw());
});
test('视觉工作流保留各图 alpha；定位按原图坐标映射，框外保持空选区',()=>{
 const g=buildVisionWorkflow({views:{front:'f.png',left:'s.png',back:'b.png'}});assert.equal(g['900'].class_type,'QCharacterVisionReview');assert.deepEqual(g['900'].inputs.left,['921',0]);assert.deepEqual(g['921'].inputs.alpha,['911',1]);assert.equal(g['900'].inputs.model,'qwen3.6:35b-a3b');assert.throws(()=>buildVisionWorkflow({views:{},model:'qwen-cloud'}));
 const m=boxSelection(1000,500,[200,200,400,400]);assert.equal(m[150*1000+300],255);assert.equal(m[450*1000+300],0);assert.equal(m[150*1000+100],0);assert.equal(m[95*1000+195],85);assert.throws(()=>boxSelection(5000,5000,[0,0,100,100]));
});
test('视觉报告与历史决定持久化同步；独立字段合并，并发决定保留冲突',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'qchar-vision-'));try{const store=new ProjectStore(root);let p=await store.create('Vision');for(const role of roles){p=await store.addAsset(p.id,Buffer.from([1]),'.png','cutout',role);await store.setView(p.id,role,p.assets.at(-1).id);}p=await store.read(p.id);const j={id:randomUUID(),projectId:p.id,kind:'review',inputViewIds:p.multiView.views,status:'completed',createdAt:new Date().toISOString(),seed:0};await store.saveJob(p.id,j);const r=createVisionReview(raw(),p,j);p=await store.saveFields(p.id,{visionReview:r});assert.deepEqual(p.jobs[0].reviewResult,r);assert.deepEqual((await new ProjectStore(root).read(p.id)).visionReview,r);
 const m={protocol:1,project:p,files:p.assets.map(a=>({assetId:a.id,filename:a.filename,size:1,sha256:'a'.repeat(64)}))};validateManifest(m);const l=structuredClone(m),remote=structuredClone(m);l.project.visionReview.findings[0].decision='accepted';l.project.jobs[0].reviewResult=l.project.visionReview;remote.project.heightMm=90;assert.equal(mergeManifests(m,l,remote).conflicts.length,0);remote.project.visionReview.summary='不同核对';assert.ok(mergeManifests(m,l,remote).conflicts.includes('visionReview'));const bad=structuredClone(m);bad.project.jobs=[];assert.throws(()=>validateManifest(bad),/原任务/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('桌面检查单独接收结构化报告，不下载伪文件；取消前后都不自动改图',async()=>{
 let current,finished;const saved=[],p={...project,id:randomUUID()},s={root:'unused',read:async()=>p,saveJob:async(_,j)=>saved.push(structuredClone(j)),saveFields:async(_,fields)=>{p.visionReview=fields.visionReview;}};
 // Cancellation while capability discovery is pending must not upload or submit anything.
 let resolveCap;const cap=new Promise(resolve=>resolveCap=resolve),client={base:'http://127.0.0.1:8188',capabilities:()=>cap,upload:()=>{throw Error('must not upload');}};
 const done=new Promise(resolve=>finished=resolve);await startVisionReview(p.id,{store:s,client,emit:()=>{},activate:state=>{current=state;},finish:()=>finished()});current.cancelRequested=true;resolveCap({stats:{system:{comfyui_version:'0.39.1'}}});await done;assert.equal(saved.at(-1).status,'cancelled');assert.equal(p.visionReview,undefined);assert.equal(saved.at(-1).kind,'review');
});
