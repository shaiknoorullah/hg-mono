import { chromium } from 'playwright';
const OUT='/tmp/claude-1000/-home-devsupreme-work-hg-mono/7ee2a43c-6879-4ed0-93b0-1db24f5e568f/scratchpad';
const b = await chromium.launch();
// desktop top-of-page (viewport, not fullPage) — what a user sees on load
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
await p.goto('http://localhost:4321', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/v2-top-eat.png` });          // above the fold, eat
await p.click('.seg [data-aud="own"]'); await p.waitForTimeout(700);
await p.screenshot({ path: `${OUT}/v2-top-own.png` });          // above the fold, own
await p.close();
// mobile
const m = await b.newPage({ viewport: { width: 390, height: 844 } });
await m.goto('http://localhost:4321', { waitUntil: 'networkidle' });
await m.waitForTimeout(1400);
await m.screenshot({ path: `${OUT}/v2-mobile.png` });
await b.close();
console.log('done');
