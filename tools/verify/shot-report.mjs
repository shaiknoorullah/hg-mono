import { chromium } from 'playwright';
const SP='/tmp/claude-1000/-home-devsupreme-work-hg-mono/7ee2a43c-6879-4ed0-93b0-1db24f5e568f/scratchpad';
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:794,height:1123},deviceScaleFactor:1.5});
await p.goto('file://'+SP+'/readiness-report.html',{waitUntil:'networkidle'});
await p.waitForTimeout(900);
await p.screenshot({path:SP+'/readiness-preview.png', fullPage:true});
await b.close(); console.log('done full-page');
