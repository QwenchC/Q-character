import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const comfy=path.resolve(process.argv[2]||'F:/ComfyUI-aki/ComfyUI');
await fs.access(path.join(comfy,'main.py'));
const target=path.join(comfy,'custom_nodes','QCharacterVision');await fs.mkdir(target,{recursive:true});
for(const name of ['__init__.py','vision.py']){
  const dest=path.join(target,name),bytes=await fs.readFile(path.join(root,'comfyui','QCharacterVision',name));
  try{const old=await fs.readFile(dest);if(!old.equals(bytes))await fs.copyFile(dest,dest+'.backup-'+Date.now());}catch(e){if(e.code!=='ENOENT')throw e;}
  await fs.writeFile(dest,bytes);
}
console.log(`已安装本地视觉节点：${target}。空闲时重启 ComfyUI 后生效；不下载模型。`);
