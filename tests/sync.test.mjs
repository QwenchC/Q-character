import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import net from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { ProjectStore, safeAsset } from '../electron/store.mjs';
import { SyncRepository } from '../electron/sync-store.mjs';
import { SyncServer } from '../electron/sync-server.mjs';
import { canonical, contentKey, conflictCopy, mergeManifests, revision, validateManifest } from '../electron/sync-protocol.mjs';
const clone = x => structuredClone(x), sha = b => createHash('sha256').update(b).digest('hex');
function manifest() {
  const id=randomUUID(), image=randomUUID(),cutout=randomUUID();
  const p={id,name:'绿色围裙女孩',description:'brown hair',ratio:'2.5',style:'clay',heightMm:80,createdAt:'2026-10-16T00:00:00Z',updatedAt:'2026-10-16T00:00:00Z',jobs:[],assets:[{id:image,kind:'design',filename:image+'.png',label:'设计图',createdAt:'2026-10-16T00:00:00Z'},{id:cutout,kind:'cutout',filename:cutout+'.png',sourceAssetId:image,label:'抠图',createdAt:'2026-10-16T00:00:00Z'}],clayGuide:{referenceId:cutout,swatches:[{id:'green',name:'服装',original:'#448855',target:'#448855',share:1}],bases:Array.from({length:6},()=>({name:'白色',hex:'#ffffff'}))}};
  return{protocol:1,project:p,files:p.assets.map(a=>({assetId:a.id,filename:a.filename,size:12,sha256:sha(a.id)}))};
}
test('同步合并不同字段和新增版本，原图、蒙版、贴图引用与调色方案完整保留',async()=>{
  const base=manifest(),phone=clone(base),desktop=clone(base),id=randomUUID();phone.project.description='手机修改发型';desktop.project.heightMm=100;
  phone.project.assets.push({id,filename:id+'.png',kind:'mask',sourceAssetId:phone.project.assets[0].id,createdAt:'2026-10-16T01:00:00Z'});phone.files.push({assetId:id,filename:id+'.png',size:10,sha256:sha(id)});
  const result=mergeManifests(base,phone,desktop);assert.deepEqual(result.conflicts,[]);assert.equal(result.manifest.project.description,phone.project.description);assert.equal(result.manifest.project.heightMm,100);assert.equal(result.manifest.project.assets.length,3);assert.deepEqual(result.manifest.project.clayGuide,base.project.clayGuide);
  const reordered=clone(result.manifest);reordered.files.reverse();reordered.project.assets.reverse();reordered.project.updatedAt='2099-01-01';assert.equal(await revision(result.manifest),await revision(reordered));
});
test('同时修改调色保留确定编号的冲突副本，重试不产生新副本；不可按时间戳覆盖',async()=>{
  const base=manifest(),phone=clone(base),desktop=clone(base);phone.project.clayGuide.swatches[0].target='#112233';desktop.project.clayGuide.swatches[0].target='#aabbcc';phone.project.updatedAt='2099-01-01';
  const merged=mergeManifests(base,phone,desktop);assert.deepEqual(merged.conflicts,['clayGuide']);assert.equal(merged.manifest.project.clayGuide.swatches[0].target,'#aabbcc');
  const copy=await conflictCopy(phone,await revision(desktop));assert.equal(copy.project.clayGuide.swatches[0].target,'#112233');assert.equal(copy.project.syncConflictOf,base.project.id);assert.equal(copy.project.id,(await conflictCopy(phone,await revision(desktop))).project.id);assert.deepEqual(copy.files,phone.files);
  desktop.project.heightMm=100;assert.equal(copy.project.id,(await conflictCopy(phone,await revision(desktop))).project.id,'Lost acknowledgement must reuse the original conflict copy');
});
test('拒绝路径穿越、悬空蒙版、损坏校验值和同编号字节变化',()=>{
  const original=manifest();for(const change of [m=>m.project.assets[0].filename='../settings.json',m=>m.project.assets[1].sourceAssetId=randomUUID(),m=>m.files[0].sha256='x',m=>m.files[0].size=65*1024*1024]){const m=clone(original);change(m);assert.throws(()=>validateManifest(m));}
  const different=clone(original);different.files[0].sha256=sha('modified');assert.throws(()=>mergeManifests(original,different,original),/同一素材/);
});
test('同步事务校验失败和过期版本不覆盖作品；新素材安装与 JSON 一并完成',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'qchar-sync-store-'));try{
    const store=new ProjectStore(path.join(root,'projects')),repo=new SyncRepository(store,path.join(root,'incoming'));let p=await store.create('test');
    const bytes=await fs.readFile('examples/design.png');p=await store.addAsset(p.id,bytes,'.png','design','原图');const before=await repo.snapshot(p.id);assert.equal(before.files[0].sha256,sha(bytes));
    const next=clone(before),id=randomUUID();next.project.assets.push({id,filename:id+'.png',kind:'reference',label:'副本',createdAt:new Date().toISOString()});next.files.push({assetId:id,filename:id+'.png',size:bytes.length,sha256:sha(bytes)});
    const accepted=await repo.commit(next,before.revision);assert.equal(accepted.project.assets.length,2);assert.deepEqual(await fs.readFile(safeAsset(store.root,p.id,id+'.png')),bytes);
    await assert.rejects(repo.commit(before,before.revision),/更新/);assert.equal((await store.read(p.id)).assets.length,2);
    const broken=clone(accepted),bad=randomUUID();broken.project.assets.push({id:bad,filename:bad+'.png',kind:'design',createdAt:new Date().toISOString()});broken.files.push({assetId:bad,filename:bad+'.png',size:8,sha256:sha('missing')});await assert.rejects(repo.commit(broken,accepted.revision),/缺失|校验/);assert.equal((await store.read(p.id)).assets.length,2);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
async function unusedPort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
test('HTTPS 配对限时一次使用、认证隔离、增量上传、CAS 提交与撤销授权',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'qchar-sync-http-')),store=new ProjectStore(path.join(root,'projects'));let server;
  try{
    server=new SyncServer({store,directory:path.join(root,'service')});await server.init();const port=await unusedPort();await server.configure({enabled:true,port,publicUrl:''});
    const request=(route,{method='GET',token,body,bytes,headers={}}={})=>new Promise((resolve,reject)=>{const data=bytes??(body?Buffer.from(JSON.stringify(body)):null);const req=https.request({hostname:'127.0.0.1',port,path:'/prefix/qsync/v1'+route,method,ca:server.certificate,headers:{...headers,...(token?{Authorization:'Bearer '+token}:{}),...(data?{'Content-Length':data.length}:{})}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{const b=Buffer.concat(chunks);let value;try{value=JSON.parse(b)}catch{value=b}resolve({status:res.statusCode,value});});});req.on('error',reject);req.end(data);});
    assert.equal((await request('/projects')).status,401);server.pairCode();let code=server.status().pairing.code;server.pairing.expires=Date.now()-1;
    assert.equal((await request('/pair',{method:'POST',body:{code}})).status,403);
    server.pairCode();code=server.status().pairing.code;for(let i=0;i<8;i++)assert.equal((await request('/pair',{method:'POST',body:{code:'00000000'}})).status,403);
    assert.equal((await request('/pair',{method:'POST',body:{code}})).status,403);
    server.pairCode();code=server.status().pairing.code;
    const paired=await request('/pair',{method:'POST',body:{code,name:'手机'}});assert.equal(paired.status,200);const token=paired.value.token;assert.equal((await request('/pair',{method:'POST',body:{code}})).status,403);assert.equal(JSON.stringify(server.config).includes(token),false);
    assert.equal((await request('/info',{token})).value.serverId,server.config.id);assert.equal((await request('/projects',{token,headers:{Origin:'https://evil.example'}})).status,403);
    const p=await store.create('incoming'),m=await server.repository.snapshot(p.id),png=await fs.readFile('examples/design.png'),id=randomUUID();m.project.assets.push({id,filename:id+'.png',kind:'design',label:'设计图',createdAt:new Date().toISOString()});m.files.push({assetId:id,filename:id+'.png',size:png.length,sha256:sha(png)});
    assert.deepEqual((await request(`/projects/${p.id}/missing`,{token,method:'POST',body:{manifest:m}})).value.missing,[sha(png)]);
    const bad=await request(`/projects/${p.id}/files/${sha('bad')}`,{token,method:'PUT',bytes:png});assert.equal(bad.status,400);
    assert.equal((await request(`/projects/${p.id}/files/${sha(png)}`,{token,method:'PUT',bytes:png})).status,200);
    assert.deepEqual((await request(`/projects/${p.id}/missing`,{token,method:'POST',body:{manifest:m}})).value.missing,[]);
    assert.equal((await request(`/projects/${p.id}/commit`,{token,method:'POST',body:{manifest:m,expected:'wrong'}})).status,409);
    const committed=await request(`/projects/${p.id}/commit`,{token,method:'POST',body:{manifest:m,expected:m.revision}});assert.equal(committed.status,200);assert.equal((await store.read(p.id)).assets.length,1);
    const downloaded=await request(`/projects/${p.id}/files/${sha(png)}`,{token});assert.deepEqual(downloaded.value,png);
    await server.revoke(paired.value.deviceId);assert.equal((await request('/projects',{token})).status,401);
  }finally{await server?.stop();await fs.rm(root,{recursive:true,force:true});}
});
