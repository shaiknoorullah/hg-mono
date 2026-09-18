import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
const bad=[]; p.on('response',r=>{if(r.status()>=400)bad.push(r.status()+' '+r.url())});
await p.goto('https://landing-shaiknoorullahs-projects.vercel.app/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
await p.screenshot({ path: '/tmp/claude-1000/-home-devsupreme-work-hg-mono/7ee2a43c-6879-4ed0-93b0-1db24f5e568f/scratchpad/live2-top.png' });
console.log(bad.length?('4xx: '+bad.slice(0,5).join(' | ')):'no 4xx');
await b.close();
