import { chromium } from 'playwright';
const OUT='/tmp/claude-1000/-home-devsupreme-work-hg-mono/7ee2a43c-6879-4ed0-93b0-1db24f5e568f/scratchpad';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await p.goto('http://localhost:4321', { waitUntil: 'networkidle' });
await p.waitForTimeout(1400);
// scroll through to trigger reveals, then top
for (let y=0;y<4000;y+=700){ await p.mouse.wheel(0,700); await p.waitForTimeout(120);} 
await p.evaluate(()=>window.scrollTo(0,0)); await p.waitForTimeout(500);
await p.screenshot({ path: `${OUT}/v2-desktop-eat.png`, fullPage: true });
console.log(errs.length?('ERRORS: '+errs.slice(0,6).join(' | ')):'no console errors');
await b.close();
