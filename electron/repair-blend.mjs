const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
const median=a=>{a.sort((a,b)=>a-b);return a[Math.floor(a.length/2)];};
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);

// Plan on a bounded grid; keep original pixels for the final RGBA composite.
function boundaryContext(source,generated,mask){
  const {width,height}=source,step=Math.max(1,Math.ceil(Math.max(width,height)/384)),w=Math.ceil(width/step),h=Math.ceil(height/step),n=w*h;
  const selected=new Uint8Array(n),labels=new Int32Array(n),depth=new Float32Array(n),queue=new Int32Array(n),regions=[null];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(mask.data[(y*width+x)*4])selected[Math.floor(y/step)*w+Math.floor(x/step)]=1;
  for(let start=0;start<n;start++)if(selected[start]&&!labels[start]){
    const id=regions.length,anchors=new Set();let tail=1;queue[0]=start;labels[start]=id;
    for(let head=0;head<tail;head++){
      const k=queue[head],x=k%w,y=Math.floor(k/w);
      for(const next of [x? k-1:-1,x+1<w?k+1:-1,y?k-w:-1,y+1<h?k+w:-1]){
        if(next<0)continue;
        if(!selected[next])anchors.add(next);
        else if(!labels[next]){labels[next]=id;queue[tail++]=next;}
      }
    }
    const src=[[],[],[]],delta=[[],[],[]];
    for(const k of anchors){
      const x=Math.min(width-1,(k%w)*step+Math.floor(step/2)),y=Math.min(height-1,Math.floor(k/w)*step+Math.floor(step/2)),p=(y*width+x)*4;
      if(mask.data[p]||source.data[p+3]<240||generated.data[p+3]<240)continue;
      const a=source.data.subarray(p,p+3),b=generated.data.subarray(p,p+3);
      // Large changes are not evidence of a harmless color drift.
      if(distance(a,b)>45)continue;
      for(let c=0;c<3;c++){src[c].push(a[c]);delta[c].push(a[c]-b[c]);}
    }
    let region=null;
    if(tail>=4&&src[0].length>=8){
      const color=src.map(a=>median(a)),offset=delta.map(a=>clamp(median(a),-18,18));
      const spread=src.map((a,c)=>median(a.map(v=>Math.abs(v-color[c]))));
      // Texture, garment boundaries and foreground edges are not flat cloth.
      if(Math.max(...spread)<=8)region={color,offset,maxDepth:0};
    }
    regions.push(region);
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const k=y*w+x;depth[k]=selected[k]?Math.min(x?depth[k-1]+1:1,y?depth[k-w]+1:1):0;
  }
  for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){
    const k=y*w+x;if(!selected[k])continue;
    depth[k]=Math.min(depth[k],x+1<w?depth[k+1]+1:1,y+1<h?depth[k+w]+1:1);
    const region=regions[labels[k]];if(region)region.maxDepth=Math.max(region.maxDepth,depth[k]*step);
  }
  return{step,w,labels,depth,regions};
}

export function blendRepair(source,generated,mask){
  const plan=boundaryContext(source,generated,mask),data=new Uint8ClampedArray(source.data);
  for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
    const i=(y*source.width+x)*4,w=mask.data[i]/255;if(!w)continue;
    const a=source.data[i+3]/255,b=generated.data[i+3]/255,out=a*(1-w)+b*w;
    const k=Math.floor(y/plan.step)*plan.w+Math.floor(x/plan.step),region=plan.regions[plan.labels[k]],rgb=[generated.data[i],generated.data[i+1],generated.data[i+2]];
    if(region&&a>.94&&b>.94){
      const proximity=1-smooth((distance(rgb,region.color)-25)/35);
      for(let c=0;c<3;c++)rgb[c]=clamp(rgb[c]+region.offset[c]*proximity,0,255);
      const band=Math.min(24,region.maxDepth*.65),edge=band?1-smooth(Math.max(0,plan.depth[k]*plan.step-plan.step/2)/band):0;
      // Only low-contrast changes on previously flat material may be seams.
      // Never copy back a removed contrasting feature or fade a new one.
      const l=(y*source.width+Math.max(0,x-1))*4,r=(y*source.width+Math.min(source.width-1,x+1))*4,t=(Math.max(0,y-1)*source.width+x)*4,bottom=(Math.min(source.height-1,y+1)*source.width+x)*4;
      const gx=(generated.data[r]+generated.data[r+1]+generated.data[r+2]-generated.data[l]-generated.data[l+1]-generated.data[l+2])/6,gy=(generated.data[bottom]+generated.data[bottom+1]+generated.data[bottom+2]-generated.data[t]-generated.data[t+1]-generated.data[t+2])/6;
      const column=k%plan.w,dx=plan.depth[column+1<plan.w?k+1:k]-plan.depth[column?k-1:k],dy=plan.depth[k+plan.w<plan.depth.length?k+plan.w:k]-plan.depth[k>=plan.w?k-plan.w:k];
      const gradient=Math.hypot(gx,gy),normal=Math.hypot(dx,dy),aligned=gradient>0.15&&gradient<18&&normal>0&&Math.abs(gx*dx+gy*dy)/(gradient*normal)>.65;
      if(edge&&aligned&&distance(source.data.subarray(i,i+3),region.color)<12&&distance(rgb,region.color)<38){
        for(let c=0;c<3;c++)rgb[c]+=clamp(source.data[i+c]-rgb[c],-10,10)*edge*.9;
      }
    }
    for(let c=0;c<3;c++)data[i+c]=out?Math.round((source.data[i+c]*a*(1-w)+rgb[c]*b*w)/out):0;
    data[i+3]=Math.round(out*255);
  }
  return{width:source.width,height:source.height,data};
}
