import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import WebSocket from 'ws';
import { createHash } from 'node:crypto';
import { validateTexturedGlb } from '../electron/texture.mjs';

const root = process.cwd();
const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
const executable = process.argv.includes('--portable') ? `release/Q-Character-Studio-${version}-Windows.exe` : 'release/win-unpacked/Q Character Studio.exe';
const fresh = process.argv.includes('--fresh');
const validationRoot = path.join(root, 'docs', process.env.QCHARACTER_PACKAGE_REPORT || 'color-validation'); await fs.mkdir(validationRoot, { recursive: true });
const userData = path.join(root, '.runtime', fresh ? `packaged-${version}` : 'packaged-smoke');
const hashes = async () => {
  const result = {};
  async function walk(folder) { for (const entry of await fs.readdir(folder, { withFileTypes: true }).catch(() => [])) { const file = path.join(folder, entry.name); if (entry.isDirectory()) await walk(file); else result[path.relative(userData, file)] = createHash('sha256').update(await fs.readFile(file)).digest('hex'); } }
  await walk(path.join(userData, 'projects')); return result;
};
const before = await hashes();
const child = spawn(path.join(root, executable), ['--remote-debugging-port=9237', `--user-data-dir=${userData}`], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { startedAt: new Date().toISOString(), executable };
let socket;
try {
  let page;
  for (let i = 0; i < 150; i++) {
    try { page = (await (await fetch('http://127.0.0.1:9237/json/list')).json()).find(x => x.type === 'page'); } catch {}
    if (page) break; await pause(100);
  }
  if (!page) throw new Error('Packaged app did not open its window.');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let sequence = 0; const waiting = new Map();
  socket.on('message', data => { const message = JSON.parse(data); const pending = waiting.get(message.id); if (pending) { waiting.delete(message.id); if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result); } });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; waiting.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  for (let i = 0; i < 100; i++) { if (await evaluate('Boolean(window.studio && document.querySelector("textarea"))')) break; await pause(100); }
  const bootstrap = await evaluate('window.studio.bootstrap()');
  if (bootstrap.version !== version) throw new Error('Unexpected application version');
  if (!bootstrap.projects.length || bootstrap.projects[0].assets.length < 2) throw new Error('Bundled example was not initialized.');
  report.version = bootstrap.version; report.projectCount = bootstrap.projects.length; report.dataPath = bootstrap.dataPath;
  if (bootstrap.settings.imageEngine !== 'qwen21' || !bootstrap.settings.qwenEncoder || !bootstrap.settings.backgroundModel) throw new Error('New settings were not initialized or migrated');
  report.imageEngine = bootstrap.settings.imageEngine;
  report.hasCutout = bootstrap.projects[0].assets.some(asset => asset.kind === 'cutout');
  if (fresh && !report.hasCutout) throw new Error('New installation did not initialize the semantic cutout example');
  if (fresh) {
    await evaluate(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()==='手动修正').click()`);
    for (let i = 0; i < 100; i++) { if (await evaluate(`document.querySelector('.mask-editor canvas')?.width === 768 && !Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='恢复前景')?.disabled`)) break; await pause(100); }
    const point = await evaluate(`(()=>{const c=document.querySelector('.mask-editor canvas'),r=c.getBoundingClientRect();return{x:r.x+100*r.width/c.width,y:r.y+200*r.height/c.height};})()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 }); await pause(100);
    await evaluate(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()==='保存修正').click()`);
    for (let i = 0; i < 100; i++) { if (await evaluate(`document.querySelector('.mask-editor') === null`)) break; await pause(100); }
    const edited = await evaluate('window.studio.bootstrap()');
    report.manualRevision = edited.projects[0].assets.at(-1).revisionType === 'manual';
    if (!report.manualRevision) throw new Error('Packaged editor did not save manual mask revision');
  }
  await evaluate(`Array.from(document.querySelectorAll('nav button')).find(x => x.textContent.startsWith('3D 工作台')).click()`);
  let count;
  for (let i = 0; i < 100; i++) { count = await evaluate(`parseInt(document.querySelector('.generation-footer strong')?.textContent.replace(/,/g,''))`); if (count > 0) break; await pause(100); }
  if (!(count > 0)) throw new Error('Bundled example failed to render.');
  report.triangles = count;
  if (fresh) {
    for (let i = 0; i < 100; i++) { if (await evaluate(`document.querySelectorAll('.clay-swatches article').length >= 4`)) break; await pause(100); }
    const originalCutoutId = bootstrap.projects[0].assets.find(a => a.kind === 'cutout').id;
    await evaluate(`(()=>{const select=document.querySelector('select[aria-label="上色参考图"]');select.value=${JSON.stringify(originalCutoutId)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await pause(200);
    await evaluate(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()==='按设计图上色').click()`);
    let colored;
    for (let i = 0; i < 150; i++) { const data = await evaluate('window.studio.bootstrap()'); colored = data.projects[0].assets.findLast(a => a.textureMethod); if (colored && await evaluate(`!document.querySelector('.viewer-overlay') && !Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()==='按设计图上色').disabled`)) break; await pause(100); }
    if (!colored) throw new Error('Packaged texture workflow failed');
    report.texture = validateTexturedGlb(await fs.readFile(path.join(bootstrap.dataPath, bootstrap.projects[0].id, 'assets', colored.filename)));
    report.clayGuide = Boolean((await evaluate('window.studio.bootstrap()')).projects[0].clayGuide?.swatches.length);
    if (!report.clayGuide) throw new Error('Packaged recipe was not persisted');
  }
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(validationRoot, `packaged-${fresh ? 'fresh' : 'upgrade'}.png`), Buffer.from(screenshot.data, 'base64'));
  report.completedAt = new Date().toISOString();
  if (!fresh) { const after = await hashes(); report.preservedFiles = Object.keys(before).length; report.preservation = Object.entries(before).every(([file, value]) => after[file] === value); if (!report.preservation) throw new Error('Existing project bytes changed during upgrade'); }
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally { if (socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify({ id: 9999, method: 'Browser.close' })); await pause(300); } socket?.close(); child.kill(); await fs.writeFile(path.join(validationRoot, `package-${fresh ? 'fresh' : 'upgrade'}-validation.json`), JSON.stringify(report, null, 2)); }
console.log(JSON.stringify(report, null, 2));
