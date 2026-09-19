// Measures the byte cost of the baked tooth across tile size and bit depth.
// Noise is incompressible, so this is the number that decides bake-vs-runtime.
import { deflateSync, gzipSync } from 'node:zlib'; import { writeFileSync } from 'node:fs';
const T=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;T[n]=c>>>0;}
const crc32=b=>{let c=0xffffffff;for(const x of b)c=T[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t,'ascii'),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(td));return Buffer.concat([l,td,c]);};
function png(w,h,vals,depth){ // depth 8 | 4 | 2 greyscale
  const ppb=8/depth, bpr=Math.ceil(w/ppb), raw=Buffer.alloc((bpr+1)*h);
  for(let y=0;y<h;y++){const off=y*(bpr+1)+1;
    for(let x=0;x<w;x++){const v=vals[y*w+x]&((1<<depth)-1);const i=off+((x/ppb)|0);const sh=8-depth-(x%ppb)*depth;raw[i]|=v<<sh;}}
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=depth;ih[9]=0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);}
const hash=(x,y,s)=>{const n=Math.sin(x*127.1+y*311.7+s*74.7)*43758.5453;return n-Math.floor(n);};
const sm=t=>t*t*(3-2*t);
function noise(x,y,per,s){const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi,w=(a,b)=>((a%b)+b)%b;
 const a=hash(w(xi,per),w(yi,per),s),b=hash(w(xi+1,per),w(yi,per),s),c=hash(w(xi,per),w(yi+1,per),s),d=hash(w(xi+1,per),w(yi+1,per),s);
 const u=sm(xf),v=sm(yf);return a*(1-u)*(1-v)+b*u*(1-v)+c*(1-u)*v+d*u*v;}
function fbm(x,y,per,s){let v=0,a=.5,f=1;for(let o=0;o<3;o++){v+=a*noise(x*f,y*f,per*f,s+o*17);a*=.5;f*=2;}return v;}
for(const N of [128,256]) for(const depth of [8,4,2]){
  const levels=(1<<depth)-1, px=new Uint8Array(N*N), PER=8;
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    const u=(x/N)*PER,v=(y/N)*PER;
    const t=.55*fbm(u*12,v*12,PER*12,11)+.45*fbm(u*4,v*.6,PER*4,3);
    px[y*N+x]=Math.max(0,Math.min(levels,Math.round(levels/2+(t-.5)*levels*.82)));}
  const buf=png(N,N,px,depth); writeFileSync(`tooth-${N}-${depth}bit.png`,buf);
  console.log(`${N}px ${depth}-bit  raw ${buf.length} B  gz ${gzipSync(buf,{level:9}).length} B`);
}
