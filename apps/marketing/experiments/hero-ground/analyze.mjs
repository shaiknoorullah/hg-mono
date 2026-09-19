import { chromium } from 'playwright'; import { readFileSync } from 'fs';
const b = await chromium.launch({ args:['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
const lum = c => { const f = v => { v/=255; return v<=.03928 ? v/12.92 : ((v+.055)/1.055)**2.4 };
  return .2126*f(c[0]) + .7152*f(c[1]) + .0722*f(c[2]) };
const ratio = (a,c) => { const [x,y]=[lum(a),lum(c)].sort((m,n)=>n-m); return (x+.05)/(y+.05) };
const res = {};
for (const f of ['a-static.png','b-webgl.png']) {
  const d = 'data:image/png;base64,' + readFileSync(f).toString('base64');
  const s = await p.evaluate(async src => {
    const img = new Image(); img.src = src; await img.decode();
    const cv = document.createElement('canvas'); cv.width=img.width; cv.height=img.height;
    const cx = cv.getContext('2d'); cx.drawImage(img,0,0);
    // sample a 400x200 block of empty ground to the right of the headline
    const d = cx.getImageData(700,120,400,200).data;
    let min=[255,255,255], max=[0,0,0], sum=[0,0,0], n=0;
    for (let i=0;i<d.length;i+=4){ const px=[d[i],d[i+1],d[i+2]];
      const L=px[0]+px[1]+px[2];
      if (L < min[0]+min[1]+min[2]) min=px; if (L > max[0]+max[1]+max[2]) max=px;
      sum=[sum[0]+px[0],sum[1]+px[1],sum[2]+px[2]]; n++; }
    return { min, max, mean: sum.map(v=>Math.round(v/n)), distinct: new Set(Array.from({length:4000},(_,k)=>d[k*4]+','+d[k*4+1]+','+d[k*4+2])).size };
  }, d);
  res[f] = { ...s, inkOnDarkest: +ratio([0x23,0x23,0x23], s.min).toFixed(2),
             inkOnMean: +ratio([0x23,0x23,0x23], s.mean).toFixed(2),
             forestOnDarkest: +ratio([0x1B,0x3B,0x31], s.min).toFixed(2) };
}
console.log(JSON.stringify(res,null,1)); await b.close();
