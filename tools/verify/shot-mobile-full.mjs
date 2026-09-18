import { chromium } from 'playwright';
const OUT='/tmp/claude-1000/-home-devsupreme-work-hg-mono/7ee2a43c-6879-4ed0-93b0-1db24f5e568f/scratchpad';
const b = await chromium.launch();
const m = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
await m.goto('http://localhost:4321', { waitUntil: 'networkidle' });
await m.waitForTimeout(1200);
for (let y=0;y<7000;y+=600){ await m.mouse.wheel(0,600); await m.waitForTimeout(90);} 
await m.evaluate(()=>window.scrollTo(0,0)); await m.waitForTimeout(400);
// detect horizontal overflow (the classic "messed up" cause)
const overflow = await m.evaluate(()=>({docW:document.documentElement.scrollWidth, winW:window.innerWidth, over: document.documentElement.scrollWidth > window.innerWidth+1}));
console.log('overflow:', JSON.stringify(overflow));
// find elements wider than viewport
const wide = await m.evaluate(()=>{const out=[];document.querySelectorAll('*').forEach(el=>{const r=el.getBoundingClientRect(); if(r.width>window.innerWidth+2 && r.width<3000){out.push((el.className||el.tagName)+' w='+Math.round(r.width))}});return out.slice(0,12);});
console.log('wide elements:', JSON.stringify(wide,null,0));
await m.screenshot({ path: `${OUT}/mobile-full.png`, fullPage: true });
await b.close(); console.log('shot done');
