// Two running apps in disposable test profiles, already paired. Never runs on a physical phone.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import WebSocket from 'ws';
import { ProjectStore, safeAsset } from '../electron/store.mjs';
import { validateTexturedGlb } from '../electron/texture.mjs';
import { DEFAULT_BASES } from '../src/color.ts';

const root=process.cwd(),output=path.join(root,'.runtime','sync-validation');await fs.mkdir(output,{recursive:true});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function connect(port){const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();const socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{socket.once('open',r);socket.once('error',j);});let sequence=0;const pending=new Map();socket.on('message',b=>{const m=JSON.parse(b),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});const js=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};return{js,send,close:()=>socket.close()};}
const desktop=await connect(Number(process.env.SYNC_DESKTOP_CDP||9229)),phone=await connect(Number(process.env.ANDROID_CDP_PORT||9228));
const report={checks:[],errors:[],startedAt:new Date().toISOString()};
const assert=(value,message)=>{if(!value)throw Error(message);};
const wait=async(api,expression)=>{for(let i=0;i<300;i++){if(await api.js(expression))return;await pause(100);}throw Error('Timed out: '+expression);};
const click=async(api,text)=>{await api.js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Button unavailable');b.click();})()`);await pause(150);};
const capture=async(api,name)=>{const r=await api.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(output,name),Buffer.from(r.data,'base64'));};
try{
  const adb=process.env.ADB||path.join(process.env.LOCALAPPDATA,'Android','Sdk','platform-tools','adb.exe');
  assert(execFileSync(adb,['-s',process.env.ANDROID_SERIAL||'emulator-5554','shell','getprop','ro.kernel.qemu'],{encoding:'utf8'}).trim()==='1','Only a disposable emulator is supported');
  const boot=await desktop.js('studio.bootstrap()');assert(path.resolve(boot.dataPath).startsWith(path.join(root,'.runtime')+path.sep),'Use a desktop test profile inside .runtime');
  assert((await phone.js('studio.syncStatus()')).paired,'Pair this test emulator first');
  const store=new ProjectStore(boot.dataPath),p=await desktop.js(`studio.createProject('同步验收 · 围裙女孩')`);let project=p;
  const add=async(name,kind,meta={})=>{project=await store.addAsset(p.id,await fs.readFile(path.join(root,'examples',name)),path.extname(name),kind,name,undefined,meta);return project.assets.at(-1);};
  const source=await add('design.png','design'),mask=await add('mask.png','mask',{sourceAssetId:source.id}),cutout=await add('cutout.png','cutout',{sourceAssetId:source.id,maskAssetId:mask.id}),model=await add('model.glb','model',{sourceAssetId:cutout.id});
  await store.saveFields(p.id,{clayGuide:{referenceId:cutout.id,swatches:[{id:'outfit',name:'服装',original:'#a3a161',target:'#a3a161',share:1}],bases:DEFAULT_BASES},workspace:{sourceId:cutout.id,modelId:model.id,page:'workbench',inputMode:'image'}});
  const originalHashes=new Map();for(const a of project.assets)originalHashes.set(a.id,createHash('sha256').update(await fs.readFile(safeAsset(store.root,p.id,a.filename))).digest('hex'));
  report.projectId=p.id;
  const sync=()=>phone.js(`studio.syncRun([${JSON.stringify(p.id)}])`);
  const first=await sync();assert(!first.errors.length&&first.changed===1&&first.downloadedFiles<=4,'Initial download failed: '+JSON.stringify(first));
  await phone.send('Page.reload');await wait(phone,`document.querySelector('.generation-footer strong')?.textContent.includes('三角面')&&!document.querySelector('.viewer-overlay')`);
  console.log("stage",report.checks.length+1);report.checks.push('Desktop design, source image, mask, cutout, geometry, palette and editing location received on Android');
  // A real touch stroke creates a new mask/cutout version from the original image.
  await phone.js(`[...document.querySelectorAll('nav button')].find(b=>b.textContent.startsWith('角色设计')).click()`);await click(phone,'手动修正');await wait(phone,`!document.querySelector('.mask-loading')`);
  await click(phone,'擦除背景');const point=await phone.js(`(()=>{const r=document.querySelector('.mask-canvas-stage canvas').getBoundingClientRect();return{x:r.x+r.width*.5,y:r.y+r.height*.6}})()`);
  await phone.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,...point,radiusX:3,radiusY:3,force:1}]});await phone.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:point.x+9,y:point.y+8,radiusX:3,radiusY:3,force:1}]});await phone.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await click(phone,'保存修正');await wait(phone,`!document.querySelector('dialog[open]')`);
  const phoneProject=await phone.js(`studio.bootstrap().then(b=>b.projects.find(p=>p.id===${JSON.stringify(p.id)}))`);const revised=phoneProject.assets.at(-1);assert(revised.revisionType==='manual'&&revised.sourceAssetId===source.id,'Mask ancestry lost');
  await phone.js(`[...document.querySelectorAll('nav button')].find(b=>b.textContent.startsWith('3D 工作台')).click()`);await wait(phone,`document.querySelectorAll('.clay-swatches article').length>0&&!document.querySelector('.viewer-overlay')`);
  const setColor=async(api,value)=>api.js(`(()=>{const e=document.querySelector('.clay-swatches input[type=color]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const setGrams=async(api,value)=>api.js(`(()=>{const e=document.querySelector('input[aria-label="每色试配克数"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,String(${value}));e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await setGrams(phone,7.5);
  await setColor(phone,'#3044cc');await click(phone,'按设计图上色');await wait(phone,`!!document.querySelector('.texture-ready')&&![...document.querySelectorAll('button')].find(b=>b.textContent==='按设计图上色').disabled`);await pause(600);
  const sent=await sync();assert(!sent.errors.length,'Phone upload failed: '+JSON.stringify(sent));project=await store.read(p.id);assert(project.assets.length>=7&&project.clayGuide.swatches[0].target==='#3044cc','Phone palette or versions missing');assert(project.clayGuide.grams===7.5,'Phone trial grams not synchronized');
  assert(project.assets.some(a=>a.id===revised.maskAssetId)&&project.assets.some(a=>a.id===revised.id),'Manual mask files missing on desktop');
  const colored=project.assets.findLast(a=>a.kind==='model'),coloredBytes=await fs.readFile(safeAsset(store.root,p.id,colored.filename));validateTexturedGlb(coloredBytes);assert(colored.textureSourceId,'Texture reference lost');
  console.log("stage",report.checks.length+1);report.checks.push('Android touch mask revision and blue textured GLB synchronized to desktop; UUID references and embedded texture verified');
  // Desktop continues editing the same synchronized project and returns a new palette/model.
  await desktop.send('Page.reload');await wait(desktop,`document.querySelectorAll('.clay-swatches article').length>0&&!document.querySelector('.viewer-overlay')`);
  assert(await desktop.js(`document.querySelector('input[aria-label="每色试配克数"]').value`)==='7.5','Desktop trial grams not restored');await setGrams(desktop,10);
  await setColor(desktop,'#c24433');await click(desktop,'按设计图上色');await wait(desktop,`!!document.querySelector('.texture-ready')&&![...document.querySelectorAll('button')].find(b=>b.textContent==='按设计图上色').disabled`);await pause(600);
  console.log("sync desktop edits");const returned=await sync();assert(!returned.errors.length&&returned.downloadedFiles<=1,'Desktop edits not received: '+JSON.stringify(returned));
  const returnedProject=await phone.js(`studio.bootstrap().then(b=>b.projects.find(p=>p.id===${JSON.stringify(p.id)}))`);assert(returnedProject.clayGuide.swatches[0].target==='#c24433','Returned palette color missing');assert(returnedProject.assets.filter(a=>a.kind==='model').length===3,'Model versions missing after round-trip');
  assert(returnedProject.clayGuide.grams===10,'Desktop trial grams did not return to Android');
  project=await store.read(p.id);const last=project.assets.findLast(a=>a.kind==='model');await fs.copyFile(safeAsset(store.root,p.id,last.filename),path.join(output,'roundtrip-80mm.glb'));
  console.log("stage",report.checks.length+1);report.checks.push('Desktop recoloring continued from Android model and returned to Android with three preserved model versions');
  // Both users edit the same field while offline: retain a named copy on both devices.
  const phoneGuide=structuredClone(returnedProject.clayGuide);phoneGuide.swatches[0].target='#112233';await phone.js(`studio.saveProject(${JSON.stringify(p.id)},{clayGuide:${JSON.stringify(phoneGuide)}})`);
  const desktopGuide=structuredClone(project.clayGuide);desktopGuide.swatches[0].target='#aabbcc';await desktop.js(`studio.saveProject(${JSON.stringify(p.id)},{clayGuide:${JSON.stringify(desktopGuide)}})`);
  const conflict=await sync();assert(!conflict.errors.length&&conflict.conflicts===1,'Expected conflict copy: '+JSON.stringify(conflict));
  const copies=(await store.list()).filter(x=>x.syncConflictOf===p.id);assert(copies.length===1&&copies[0].clayGuide.swatches[0].target==='#112233','Local color not preserved in conflict copy');assert((await store.read(p.id)).clayGuide.swatches[0].target==='#aabbcc','Remote color replaced');
  const stable=await sync();assert(!stable.errors.length&&stable.changed===0&&stable.uploadedFiles===0&&stable.downloadedFiles===0,'Unchanged synchronization retransferred data');
  assert((await store.list()).filter(x=>x.syncConflictOf===p.id).length===1,'Duplicate conflict copies created');
  for(const a of (await store.read(p.id)).assets)if(originalHashes.has(a.id))assert(createHash('sha256').update(await fs.readFile(safeAsset(store.root,p.id,a.filename))).digest('hex')===originalHashes.get(a.id),'Original asset overwritten');
  console.log("stage",report.checks.length+1);report.checks.push('Concurrent palette edits retained on both devices via one deterministic conflict copy; retry transferred zero files; original bytes unchanged');
  await phone.send('Page.reload');await pause(400);await phone.js(`[...document.querySelectorAll('button')].find(b=>b.textContent==='作品同步').click()`);await pause(400);await capture(phone,'android-sync.png');
  await desktop.js(`[...document.querySelectorAll('button')].find(b=>b.textContent==='作品同步').click()`);await pause(300);await capture(desktop,'windows-sync.png');
  report.trialGrams={phoneToDesktop:7.5,desktopToPhone:10};report.transfers={first,sent,returned,conflict,stable};report.completedAt=new Date().toISOString();
}catch(e){report.errors.push(e.message);process.exitCode=1;}
finally{desktop.close();phone.close();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
