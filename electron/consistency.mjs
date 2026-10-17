import { VIEW_ROLES, VIEW_LABELS, readyMultiView } from './multiview.mjs';
import { blendRepair } from './repair-blend.mjs';

export const REVIEW_PARTS = ['hair', 'clothes', 'accessories'];
export const PART_LABELS = { hair: '发型与发色', clothes: '服装与层次', accessories: '配饰与数量' };
const sameViews = (a, b) => VIEW_ROLES.every(role => (a?.[role] || '') === (b?.[role] || ''));

// The bands are geometric sampling regions, not semantic segmentation.
function palette(image, start, end) {
  let top=image.height,bottom=-1;
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)if(image.data[(y*image.width+x)*4+3]>128){top=Math.min(top,y);bottom=Math.max(bottom,y);}
  if(bottom<top)throw new Error('检查图片没有有效前景。');
  const bins=new Map();let total=0;
  for(let y=Math.floor(top+(bottom-top)*start);y<=top+(bottom-top)*end;y++)for(let x=0;x<image.width;x++){
    const i=(y*image.width+x)*4;if(image.data[i+3]<128)continue;
    const rgb=[0,1,2].map(c=>Math.min(255,Math.round(image.data[i+c]/32)*32)),key=rgb.join(',');bins.set(key,(bins.get(key)||0)+1);total++;
  }
  return [...bins].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([key,count])=>({rgb:key.split(',').map(Number),share:count/Math.max(1,total)}));
}
export function analyzeConsistency(project, images, now=new Date().toISOString()) {
  const config=readyMultiView(project), rows=[];
  for(const role of VIEW_ROLES.filter(r=>r!=='front'&&config.views[r]))for(const part of REVIEW_PARTS){
    let distance=null, colors=[];
    if(part!=='accessories'){
      const band=part==='hair'?[0,.34]:[.36,.82],a=palette(images.front,...band),b=palette(images[role],...band);
      if(!a.length||!b.length)throw new Error('取样区域没有足够前景，请检查蒙版。');
      const directed=(x,y)=>x.reduce((n,c)=>n+c.share*Math.min(...y.map(d=>Math.hypot(...c.rgb.map((v,i)=>v-d.rgb[i]))/441.673)),0)/x.reduce((n,c)=>n+c.share,0);
      distance=Math.min(1,Math.max(directed(a,b),directed(b,a)));colors=b.slice(0,3).map(c=>'#'+c.rgb.map(v=>v.toString(16).padStart(2,'0')).join(''));
    }
    rows.push({role,part,status:'pending',note:'',distance,colors});
  }
  return {version:1,createdAt:now,views:{...config.views},rows};
}
export function normalizeConsistency(value, assets) {
  if(!value||value.version!==1||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||value.createdAt.length>80||!Array.isArray(value.rows))throw new Error('一致性检查记录无效。');
  const config=readyMultiView({assets,multiView:{enabled:true,fov:20,views:value.views}}), expected=VIEW_ROLES.filter(r=>r!=='front'&&config.views[r]).flatMap(role=>REVIEW_PARTS.map(part=>role+':'+part));
  if(value.rows.length!==expected.length)throw new Error('一致性检查项目不完整。');
  const used=new Set(), rows=value.rows.map(row=>{
    const key=row.role+':'+row.part;
    if(!expected.includes(key)||used.has(key)||!['pending','consistent','occluded','repair'].includes(row.status)||typeof row.note!=='string'||row.note.length>1000||!(row.distance===null||Number.isFinite(row.distance)&&row.distance>=0&&row.distance<=1)||!Array.isArray(row.colors)||row.colors.length>3||row.colors.some(c=>!/^#[a-f0-9]{6}$/i.test(c)))throw new Error('一致性检查条目无效。');
    used.add(key);return {role:row.role,part:row.part,status:row.status,note:row.note,distance:row.distance,colors:row.colors};
  });
  return {version:1,createdAt:value.createdAt,views:config.views,rows};
}
export function consistencyState(project) {
  if(!project.consistency)return 'unchecked';
  if(!sameViews(project.multiView?.views,project.consistency.views))return 'stale';
  return project.consistency.rows.every(r=>r.status==='consistent'||r.status==='occluded'&&r.note.trim())?'confirmed':'pending';
}
export function assertConsistencyReady(project) {
  const state=consistencyState(project);
  if(state==='stale')throw new Error('视图已变更，请重新检查一致性并确认修正结果，再生成 3D。');
  if(state==='pending')throw new Error('请处理一致性检查中的待核对／需修正项目，再生成 3D。');
}

export function validateRepairMask(source, mask) {
  if(source.width!==mask.width||source.height!==mask.height||mask.data.length!==source.width*source.height*4)throw new Error('重绘选区与目标图片尺寸不一致。');
  let selected=0;
  for(let i=0;i<mask.data.length;i+=4){if(mask.data[i]!==mask.data[i+1]||mask.data[i]!==mask.data[i+2]||mask.data[i+3]!==255)throw new Error('重绘选区必须是不透明灰阶图，白色为重绘区域。');selected+=mask.data[i]/255;}
  if(selected<1)throw new Error('请先涂选需要重绘的区域。');
  return selected/(source.width*source.height);
}
export function compositeRepair(source, generated, mask) {
  validateRepairMask(source,mask);
  if(source.width!==generated.width||source.height!==generated.height||generated.data.length!==source.data.length)throw new Error('重绘结果与目标图片尺寸不一致。');
  return blendRepair(source,generated,mask);
}
export function repairPrompt(role, instruction) {
  if(!VIEW_ROLES.includes(role)||typeof instruction!=='string'||!instruction.trim()||instruction.length>2000)throw new Error('请填写不超过 2000 字的局部修正要求。');
  return `第一张是待修正的${VIEW_LABELS[role]}目标图，其余图为同一角色其它方向的参考。保持第一张图的相机方向、姿势、比例、身份、取景、背景和未要求修改的部分。只修正指定区域，使服装、发型或配饰与参考设计合理衔接，不要把侧面改成正面、背面不要出现正面五官，不要改变角色或添加无关装饰。修正要求：${instruction.trim()}`;
}
