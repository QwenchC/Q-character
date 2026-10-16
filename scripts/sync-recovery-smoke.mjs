// Isolated emulator + disposable desktop profile only. Exercises native TLS and cancelled transfers.
import assert from 'node:assert/strict';
import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes,createHash,X509Certificate} from 'node:crypto';
import {generate} from 'selfsigned';
import {PNG} from 'pngjs';
import WebSocket from 'ws';
import {ProjectStore} from '../electron/store.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function connect(port){const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();const socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{socket.once('open',r);socket.once('error',j);});let sequence=0;const waiting=new Map();socket.on('message',b=>{const m=JSON.parse(b),p=waiting.get(m.id);if(p){waiting.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{waiting.delete(id);reject(Error(`Timed out ${method}`));},60000);waiting.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});const js=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};return{js,send,close:()=>socket.close()};}
const root=process.cwd(),out=path.join(root,'.runtime','sync-validation'),adb=process.env.ADB||path.join(process.env.LOCALAPPDATA,'Android','Sdk','platform-tools','adb.exe'),serial=process.env.ANDROID_SERIAL||'emulator-5554';
assert.equal(execFileSync(adb,['-s',serial,'shell','getprop','ro.kernel.qemu'],{encoding:'utf8'}).trim(),'1');
const desktop=await connect(+(process.env.SYNC_DESKTOP_CDP||9229)),phone=await connect(+(process.env.ANDROID_CDP_PORT||9228));
const boot=await desktop.js('studio.bootstrap()');assert.ok(path.resolve(boot.dataPath).startsWith(path.join(root,'.runtime')+path.sep));
const status=await desktop.js('studio.syncStatus()');assert.ok(status.enabled);const original=await phone.js('studio.syncStatus()');assert.ok(original.paired);
const serverCertificate=JSON.parse(await fs.readFile(path.join(path.dirname(boot.dataPath),'sync-service','certificate.json'),'utf8')).cert;
const pems=await generate([{name:'commonName',value:'Disposable sync proxy test'}],{keySize:2048,algorithm:'sha256',notAfterDate:new Date(Date.now()+86400000),extensions:[{name:'basicConstraints',cA:false},{name:'subjectAltName',altNames:[{type:7,ip:'10.0.2.2'}]}]});
let held=[],slow=true,startedResolve,deviceId,project,loseCommit=false;
let started=new Promise(r=>startedResolve=r);const seen=[];
const proxy=https.createServer({key:pems.private,cert:pems.cert},(req,res)=>{
  seen.push(req.url);const upstream=https.request({hostname:'127.0.0.1',port:status.port,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${status.port}`},ca:serverCertificate},response=>{
    if(loseCommit&&req.url.endsWith(`/projects/${project.id}/commit`)&&response.statusCode===200){loseCommit=false;response.resume();response.on('end',()=>{res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Simulated lost commit acknowledgement'}));});return;}
    res.writeHead(response.statusCode,response.headers);
    if(slow&&req.url.includes('/files/')&&req.method==='GET'){
      const chunks=[];response.on('data',b=>chunks.push(b));response.on('end',()=>{const data=Buffer.concat(chunks);res.write(data.subarray(0,128));held.push(()=>res.end(data.subarray(128)));startedResolve();});
    }else response.pipe(res);
  });upstream.on('error',()=>res.destroy());req.on('error',()=>upstream.destroy());req.pipe(upstream);
});await new Promise((r,j)=>{proxy.once('error',j);proxy.listen(18791,'0.0.0.0',r);});
const server='https://10.0.2.2:18791/mobile';const report={startedAt:new Date().toISOString(),checks:[],errors:[]};
const release=()=>{for(const fn of held.splice(0))fn();};
const pair=async address=>{const s=await desktop.js('studio.syncPairCode()');await phone.js(`studio.syncPair(${JSON.stringify(address)},${JSON.stringify(s.pairing.code)})`);};
try{
  await phone.send('Page.reload');await pause(500);
  const cert=await phone.js(`studio.syncInspectCertificate(${JSON.stringify(server)})`);assert.equal(cert.fingerprint,new X509Certificate(pems.cert).fingerprint256);
  await phone.js(`(()=>{window.recoveryTrust=studio.syncTrustCertificate(${JSON.stringify(cert)});return true})()`);
  let xml='';for(let i=0;i<8;i++){await pause(300);execFileSync(adb,['-s',serial,'shell','uiautomator','dump','/sdcard/qcharacter-sync-window.xml'],{stdio:'ignore'});xml=execFileSync(adb,['-s',serial,'shell','cat','/sdcard/qcharacter-sync-window.xml'],{encoding:'utf8'});if(xml.includes('android:id/button1'))break;}
  const button=xml.match(/resource-id="android:id\/button1"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);assert.ok(button,'Expected native certificate consent dialog');const [,x1,y1,x2,y2]=button.map(Number);execFileSync(adb,['-s',serial,'shell','input','tap',String(Math.floor((x1+x2)/2)),String(Math.floor((y1+y2)/2))]);assert.equal(await phone.js('window.recoveryTrust'),true);
  const previous=new Set(status.devices.map(d=>d.id));await pair(server);deviceId=(await desktop.js('studio.syncStatus()')).devices.find(d=>!previous.has(d.id)).id;
  report.checks.push('Native certificate inspection, exact fingerprint consent and pairing through HTTPS proxy with /mobile prefix');
  project=await desktop.js(`studio.createProject('同步中断恢复验收')`);const store=new ProjectStore(boot.dataPath),png=new PNG({width:1024,height:1024});png.data=randomBytes(1024*1024*4);for(let i=3;i<png.data.length;i+=4)png.data[i]=255;const bytes=PNG.sync.write(png),sha=createHash('sha256').update(bytes).digest('hex');project=await store.addAsset(project.id,bytes,'.png','design','Unique transfer fixture');
  await desktop.js(`studio.syncEditing(${JSON.stringify(project.id)},true)`);let result=await phone.js(`studio.syncRun([${JSON.stringify(project.id)}])`);assert.equal(result.errors.length,1);assert.match(result.errors[0].message,/409/);await desktop.js(`studio.syncEditing(${JSON.stringify(project.id)},false)`);report.checks.push('Desktop edit lock rejects synchronization with HTTP 409 and preserves both copies');
  await phone.js(`(()=>{window.recoveryOutcome=studio.syncRun([${JSON.stringify(project.id)}]).then(value=>({value}),e=>({error:e.message}));return true;})()`);
  await Promise.race([started,pause(20000).then(()=>{throw Error('No file transfer started');})]);
  const cancellation=phone.js('studio.syncCancel()');await pause(300);release();await cancellation;const cancelled=await phone.js('window.recoveryOutcome');assert.match(cancelled.error,/取消/);const partial=await phone.js(`studio.bootstrap().then(b=>b.projects.find(p=>p.id===${JSON.stringify(project.id)}))`);assert.equal(partial,undefined);report.checks.push('Cancelled partial download cannot create a project or acknowledge a baseline');
  slow=false;result=await phone.js(`studio.syncRun([${JSON.stringify(project.id)}])`);assert.equal(result.errors.length,0);assert.equal(result.downloadedFiles,1);
  await phone.js(`(()=>{const n=window.QNative,previous=n.onmessage;window.recoveryNative=(method,args)=>new Promise((resolve,reject)=>{const id='recovery-'+Date.now();n.onmessage=e=>{const m=JSON.parse(e.data);if(m.id===id){n.onmessage=previous;m.error?reject(Error(m.error)):resolve(m.result);}else previous(e);};n.postMessage(JSON.stringify({id,method,args}));});})()`);
  const snapshot=await phone.js(`recoveryNative('syncSnapshot',{id:${JSON.stringify(project.id)}})`);assert.equal(snapshot.files[0].sha256,sha);report.checks.push('Retry after cancellation receives the full file and commits only after matching SHA256');
  await phone.js(`studio.saveProject(${JSON.stringify(project.id)},{description:'Phone retained edit',heightMm:99})`);await desktop.js(`studio.saveProject(${JSON.stringify(project.id)},{description:'Desktop concurrent edit'})`);
  loseCommit=true;result=await phone.js(`studio.syncRun([${JSON.stringify(project.id)}])`);assert.equal(result.errors.length,1);assert.match(result.errors[0].message,/503/);assert.equal((await store.read(project.id)).heightMm,99,'Server commit must have succeeded before acknowledgement failure');
  result=await phone.js(`studio.syncRun([${JSON.stringify(project.id)}])`);assert.equal(result.errors.length,0);const copies=(await store.list()).filter(p=>p.syncConflictOf===project.id);assert.equal(copies.length,1,'Retry must not duplicate conflict copies');const phoneCopies=await phone.js(`studio.bootstrap().then(b=>b.projects.filter(p=>p.syncConflictOf===${JSON.stringify(project.id)}))`);assert.equal(phoneCopies.length,1);assert.equal(phoneCopies[0].description,'Phone retained edit');report.checks.push('Lost commit acknowledgement retries without duplicate conflict copies or losing either description');
  await desktop.js(`studio.syncRevoke(${JSON.stringify(deviceId)})`);await assert.rejects(phone.js(`studio.syncRun([${JSON.stringify(project.id)}])`),/401/);const retained=await phone.js(`studio.bootstrap().then(b=>b.projects.find(p=>p.id===${JSON.stringify(project.id)}))`);assert.equal(retained.assets.length,1);report.checks.push('Revoked device rejected with HTTP 401; downloaded local project retained');
  assert.ok(seen.every(route=>route.startsWith('/mobile/qsync/v1/')));report.completedAt=new Date().toISOString();
}catch(e){report.errors.push(e.message);process.exitCode=1;}
finally{release();if(project)await desktop.js(`studio.syncEditing(${JSON.stringify(project.id)},false)`).catch(()=>{});await pair(original.server).catch(e=>report.errors.push('Restore pairing: '+e.message));desktop.close();phone.close();proxy.closeAllConnections();await new Promise(r=>proxy.close(r));await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'recovery.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
