import { chromium } from 'playwright';
const OUT='/tmp/claude-1000/-home-devsupreme-work-hg-mono/7ee2a43c-6879-4ed0-93b0-1db24f5e568f/scratchpad';
const b = await chromium.launch();
const m = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await m.goto('http://localhost:4321', { waitUntil: 'networkidle' });
await m.waitForTimeout(1000);
// scroll to the verification section
await m.evaluate(()=>{ const el=document.querySelector('.verify'); el && el.scrollIntoView(); });
await m.waitForTimeout(900);
await m.screenshot({ path: `${OUT}/mobile-verify.png` });
// also the food gallery + coverage
await m.evaluate(()=>{ const el=document.querySelector('.proof'); el && el.scrollIntoView(); });
await m.waitForTimeout(700);
await m.screenshot({ path: `${OUT}/mobile-proof.png` });
await b.close(); console.log('shots done');
