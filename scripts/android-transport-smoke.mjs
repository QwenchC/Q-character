// Run against a disposable debug emulator, with its WebView forwarded to ANDROID_CDP_PORT.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import WebSocket from 'ws';
const port=Number(process.env.ANDROID_CDP_PORT||9228);
const pages=await(await fetch(`http://127.0.0.1:${port}/json`)).json();
const socket=new WebSocket(pages[0].webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
let sequence=0;const waiting=new Map();
socket.on('message',data=>{const message=JSON.parse(data),pending=waiting.get(message.id);if(pending){waiting.delete(message.id);message.error?pending.reject(Error(JSON.stringify(message.error))):pending.resolve(message.result);}});
const send=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;waiting.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
const js=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
const seen=[];let releaseDownload,downloadStarted;
const downloadReady=new Promise(resolve=>downloadStarted=resolve);
const server=http.createServer(async(req,res)=>{
  seen.push({url:req.url,authorization:req.headers.authorization});
  if(req.url.startsWith('/proxy/html/')){res.end('<html>login page</html>');return;}
  if(req.url.startsWith('/proxy/redirect/')){res.writeHead(307,{Location:`http://10.0.2.2:${server.address().port}/leak`});res.end();return;}
  if(req.url.startsWith('/proxy/slow/view?')){const bytes=await fs.readFile('examples/design.png');res.writeHead(200,{'Content-Type':'image/png'});res.write(bytes.subarray(0,128));downloadStarted();await new Promise(resolve=>releaseDownload=resolve);res.end(bytes.subarray(128));return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({system:{comfyui_version:'0.39.1'},devices:[]}));
});
await new Promise(resolve=>server.listen(0,'0.0.0.0',resolve));
const base=`http://10.0.2.2:${server.address().port}/proxy`;
const report={checks:[],errors:[]};let original;
try{
  await js(`(()=>{const native=window.QNative,previous=native.onmessage,pending=new Map();let n=0;native.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error)):p.resolve(m.result);}else previous(e);};window.androidTestCall=(method,args={})=>new Promise((resolve,reject)=>{const id='verification-'+(++n),timer=setTimeout(()=>{pending.delete(id);reject(Error('Native timeout'));},30000);pending.set(id,{resolve,reject,timer});native.postMessage(JSON.stringify({id,method,args}));});})()`);
  const raw=(method,args={})=>js(`window.androidTestCall(${JSON.stringify(method)},${JSON.stringify(args)})`);
  const boot=await raw('bootstrap');original=boot.settings;
  assert.equal(original.hasCredentials,false,'Use an emulator without saved credentials');
  for(const value of ['ftp://example.test','https://u:p@example.test','http://host/a/../b','http://host:0','http://host/path?token=secret'])await assert.rejects(raw('settings',{value:{...original,server:value}}));
  report.checks.push('Reject embedded credentials, invalid schemes, traversal, invalid ports and query credentials');
  const bearer='android-test-token-'+Date.now();
  const saved=await raw('settings',{value:{...original,server:base+'/ok/',authType:'bearer',authToken:bearer}});
  assert.equal(saved.server,base+'/ok');assert.equal(saved.hasCredentials,true);assert.equal(JSON.stringify(saved).includes(bearer),false);
  let session=await raw('beginRemote');await raw('remoteJson',{session,route:'/system_stats'});
  assert.equal(seen.at(-1).url,'/proxy/ok/system_stats');assert.equal(seen.at(-1).authorization,'Bearer '+bearer);
  report.checks.push('Proxy prefix and nonstandard port preserved; Bearer sent only by native transport; secret absent from public settings');
  await assert.rejects(raw('settings',{value:{...saved,server:base+'/other',authToken:''}}),/重新填写/);
  await raw('settings',{value:{...original,server:base+'/html'}});await assert.rejects(raw('remoteJson',{session,route:'/system_stats'}),/授权已变化/);
  session=await raw('beginRemote');await assert.rejects(raw('remoteJson',{session,route:'/system_stats'}),/不是 ComfyUI JSON/);
  report.checks.push('Address changes revoke old sessions; HTML with HTTP 200 rejected');
  await raw('settings',{value:{...original,server:base+'/redirect',authType:'basic',authUsername:'artist',authPassword:'test-only-password'}});
  session=await raw('beginRemote');await assert.rejects(raw('remoteJson',{session,route:'/system_stats'}),/重定向/);
  assert.equal(seen.at(-1).authorization,'Basic '+Buffer.from('artist:test-only-password').toString('base64'));assert.equal(seen.some(r=>r.url==='/leak'),false);
  report.checks.push('Basic authentication works; redirects refused without forwarding credentials');
  await raw('settings',{value:{...original,server:base+'/slow'}});session=await raw('beginRemote');
  const before=(await raw('bootstrap')).projects[0];
  await js(`(()=>{window.downloadVerification=window.androidTestCall('remoteDownload',${JSON.stringify({session,projectId:before.id,output:{filename:'test.png',type:'output'},kind:'design',label:'Should not be saved',metadata:{}})}).then(()=>({accepted:true})).catch(e=>({error:e.message}));return true;})()`);
  await downloadReady;await raw('settings',{value:{...original,server:base+'/ok'}});releaseDownload();
  const outcome=await js('window.downloadVerification');assert.ok(outcome.error);
  const after=(await raw('bootstrap')).projects.find(p=>p.id===before.id);assert.equal(after.assets.length,before.assets.length);
  report.checks.push('Revoked in-flight download cannot commit an asset');
  await raw('settings',{value:original});
  report.completedAt=new Date().toISOString();
}catch(error){report.errors.push(error.message);process.exitCode=1;}
finally{
  if(releaseDownload)releaseDownload();
  if(original&&!original.hasCredentials)await js(`window.androidTestCall('settings',{value:${JSON.stringify(original)}})`).catch(()=>{});
  socket.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.mkdir('.runtime',{recursive:true});await fs.writeFile('.runtime/android-transport-validation.json',JSON.stringify(report,null,2));
}
console.log(JSON.stringify(report,null,2));
