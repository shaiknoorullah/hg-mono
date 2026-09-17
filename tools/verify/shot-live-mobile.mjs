import { chromium } from 'playwright';
const OUT='/tmp/claude-1000/-home-devsupreme-work-hg-mono/7ee2a43c-6879-4ed0-93b0-1db24f5e568f/scratchpad';
const b = await chromium.launch();
const m = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await m.goto('https://landing-shaiknoorullahs-projects.vercel.app/', { waitUntil: 'networkidle' });
await m.waitForTimeout(1200);
// check the seven-point grid is 1 column on the LIVE site
const cols = await m.evaluate(()=>{ const g=document.querySelector('.points-grid'); return g?getComputedStyle(g).gridTemplateColumns:'no-grid'; });
console.log('live .points-grid columns:', cols, '=>', (cols.split(' ').length===1?'ONE COLUMN ✓':'still multi-col'));
await m.evaluate(()=>{ const el=document.querySelector('.verify'); el&&el.scrollIntoView(); });
await m.waitForTimeout(700);
await m.screenshot({ path: `${OUT}/live-mobile-verify.png` });
await b.close();
