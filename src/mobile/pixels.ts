export interface Pixels { width: number; height: number; data: Uint8ClampedArray }
export function summary(image: Pixels) { let foreground=0, transparent=0; for(let i=3;i<image.data.length;i+=4){if(image.data[i]>8)foreground++;if(image.data[i]<247)transparent++;} const count=image.width*image.height;return {hasTransparency:transparent>count*0.005&&foreground>0,foregroundRatio:foreground/count}; }
export function applyMask(source: Pixels, mask: Pixels, manual=false): Pixels {
  if(source.width!==mask.width||source.height!==mask.height)throw new Error('蒙版与原图尺寸不一致。');
  const output={width:source.width,height:source.height,data:source.data.slice()};
  for(let i=0;i<output.data.length;i+=4){if(manual&&(mask.data[i]!==mask.data[i+1]||mask.data[i]!==mask.data[i+2]||mask.data[i+3]!==255))throw new Error('请保存不透明的黑白蒙版。');const alpha=manual?Math.min(source.data[i+3],mask.data[i]):Math.round(source.data[i+3]*mask.data[i]/255);output.data[i+3]=alpha<=8?0:alpha;}
  const valid=summary(output);if(!valid.hasTransparency||valid.foregroundRatio<0.005)throw new Error('没有获得有效人物前景，请检查蒙版。');return output;
}
export function alphaMask(source: Pixels): Pixels {const data=new Uint8ClampedArray(source.data.length);for(let i=0;i<data.length;i+=4){const a=source.data[i+3];data.set([a,a,a,255],i);}return{width:source.width,height:source.height,data};}
export function shapeImage(source: Pixels): Pixels {
  if(!summary(source).hasTransparency)throw new Error('请先自动抠图并修正透明轮廓，再生成 3D。');
  let left=source.width,top=source.height,right=-1,bottom=-1;
  for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++)if(source.data[(y*source.width+x)*4+3]>8){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  const width=right-left+1,height=bottom-top+1,side=Math.ceil(Math.max(width,height)*1.16),data=new Uint8ClampedArray(side*side*4);data.fill(255);const ox=Math.floor((side-width)/2),oy=Math.floor((side-height)/2);
  for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){const a=(y*source.width+x)*4,b=((y-top+oy)*side+x-left+ox)*4,alpha=source.data[a+3]<=8?0:source.data[a+3]/255;for(let c=0;c<3;c++)data[b+c]=Math.round(source.data[a+c]*alpha+255*(1-alpha));}return{width:side,height:side,data};
}
