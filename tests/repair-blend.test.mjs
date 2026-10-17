import test from 'node:test';import assert from 'node:assert/strict';
import {compositeRepair} from '../electron/consistency.mjs';
const image=(w=128,h=128,rgb=[60,130,60])=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4).fill(0).map((_,i)=>i%4===3?255:rgb[i%4])});
const pixel=(im,x,y)=>[...im.data.subarray((y*im.width+x)*4,(y*im.width+x)*4+4)];
const paint=(im,x,y,rgb)=>im.data.set([...rgb,255],(y*im.width+x)*4);
const selection=(w=128,h=128)=>{const m=image(w,h,[0,0,0]);for(let y=24;y<h-24;y++)for(let x=24;x<w-24;x++)paint(m,x,y,[255,255,255]);return m;};
test('边缘校色只从不透明未选区取样；删除旧部件后不把原色复制回来',()=>{
 const s=image(),g=image(128,128,[72,142,72]),m=selection();
 for(let y=55;y<73;y++)for(let x=55;x<73;x++)paint(s,x,y,[240,190,50]);
 const o=compositeRepair(s,g,m);assert.deepEqual(pixel(o,64,64),[60,130,60,255]);
 for(let i=0;i<m.data.length;i+=4)if(!m.data[i])assert.deepEqual(o.data.subarray(i,i+4),s.data.subarray(i,i+4));
 assert.deepEqual(pixel(s,64,64),[240,190,50,255]);
});
test('真实新增的高对比纽扣和低对比部件内部保留，不按圆形或选区位置抹除',()=>{
 const s=image(),g=image(),m=selection();
 for(let y=26;y<42;y++)for(let x=26;x<42;x++)paint(g,x,y,[240,190,50]);
 for(let y=50;y<64;y++)for(let x=26;x<40;x++)paint(g,x,y,[68,138,68]);
 const o=compositeRepair(s,g,m);assert.deepEqual(pixel(o,32,32),[240,190,50,255]);assert.deepEqual(pixel(o,32,56),[68,138,68,255]);
});
test('不同颜色的分离选区各自校色；半透明边缘与选区外透明 RGB 不受校色污染',()=>{
 const s=image(160,128),g=image(160,128,[72,142,72]),m=image(160,128,[0,0,0]);
 for(let y=0;y<128;y++)for(let x=80;x<160;x++){paint(s,x,y,[130,60,60]);paint(g,x,y,[118,48,48]);}
 for(let y=30;y<98;y++)for(const [l,r]of [[20,60],[100,140]])for(let x=l;x<r;x++)paint(m,x,y,[255,255,255]);
 s.data.set([81,19,53,0],0);const o=compositeRepair(s,g,m);assert.deepEqual(pixel(o,40,64),[60,130,60,255]);assert.deepEqual(pixel(o,120,64),[130,60,60,255]);assert.deepEqual(pixel(o,0,0),[81,19,53,0]);
 const a=image(8,8),b=image(8,8,[200,100,50]),mask=image(8,8,[0,0,0]);paint(mask,4,4,[128,128,128]);paint(mask,4,5,[128,128,128]);a.data[(4*8+4)*4+3]=128;
 const oldAlpha=128/255,out=oldAlpha*(1-128/255)+128/255;const r=compositeRepair(a,b,mask);assert.equal(r.data[(4*8+4)*4+3],Math.round(out*255));
});
test('整图选区无外部参照时保留候选；纹理边界不做平面颜色替换',()=>{
 const s=image(),g=image(128,128,[70,140,70]),m=image(128,128,[255,255,255]);assert.deepEqual(compositeRepair(s,g,m).data,g.data);
 const mask=selection();for(let y=0;y<128;y++)for(let x=0;x<128;x++){const rgb=(x+y)%2?[20,30,40]:[200,210,220];paint(s,x,y,rgb);paint(g,x,y,rgb.map(v=>v+8));}
 const o=compositeRepair(s,g,mask);assert.deepEqual(pixel(o,64,64),pixel(g,64,64));
});
test('平坦布料的低对比圆形接缝减弱，选区外与删除后的中心不变',()=>{
 const s=image(),g=image(),m=image(128,128,[0,0,0]);let before=0,after=0;
 for(let y=0;y<128;y++)for(let x=0;x<128;x++){const r=Math.hypot(x-64,y-64);if(r<40)paint(m,x,y,[255,255,255]);const d=Math.round(10*Math.exp(-(((r-35)/3)**2)));paint(g,x,y,[60+d,130+d,60+d]);}
 const o=compositeRepair(s,g,m);for(let y=0;y<128;y++)for(let x=0;x<128;x++){const r=Math.hypot(x-64,y-64),i=(y*128+x)*4;if(r>=30&&r<40){before+=Math.abs(g.data[i]-60);after+=Math.abs(o.data[i]-60);}if(!m.data[i])assert.deepEqual(o.data.subarray(i,i+4),s.data.subarray(i,i+4));}
 assert.ok(after<before*.85);assert.deepEqual(pixel(o,64,64),[60,130,60,255]);
});
