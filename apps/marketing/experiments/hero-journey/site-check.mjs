// Whole-site check: every page, every width, in one run.
//
//   node site-check.mjs [port]        (run from the repo root)
//
// verify.mjs looks at one scroll journey in depth — beat lengths, dwell, entry.
// This is the other axis: all seven pages of the site at four widths, checking
// the things that only break once pages exist together.
//
// Horizontal overflow is sampled at eleven scroll positions rather than at rest,
// because it usually appears mid-transform — a pinned stage part-way through a
// beat, not a page sitting still. 768 is included deliberately: apps/marketing
// AGENTS.md records that tablet portrait scrolled sideways by 227px once, from a
// breakpoint that looked fine at 1024 and at 390.
//
// Seeks by real wheel input — a native scrollTo desyncs Lenis from
// window.scrollY and every measurement afterwards describes a state no reader
// sees. See the README.

import { chromium } from 'playwright';
const PAGES = ['index.html','restaurants.html','riders.html','verification.html','writing.html','privacy.html','terms.html'];
const PORT = process.argv[2] || 5402;
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const out=[];
for (const page of PAGES) {
  for (const [w,h] of [[1440,900],[1024,768],[768,1024],[390,844]]) {
    const p = await b.newPage({ viewport:{width:w,height:h} });
    const errs=[];
    p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,80))});
    p.on('pageerror',e=>errs.push('PAGEERROR '+e.message.slice(0,80)));
    const resp = await p.goto(`http://127.0.0.1:${PORT}/`+page,{waitUntil:'load'});
    await p.waitForTimeout(1600);
    // step the page, watching for horizontal overflow mid-transform
    const max = await p.evaluate(()=>document.documentElement.scrollHeight-innerHeight);
    let worst = await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    for (let i=1;i<=10;i++){
      const t=max*i/10;
      for(let k=0;k<60;k++){const c=await p.evaluate(()=>scrollY);const d=t-c;if(Math.abs(d)<16)break;await p.mouse.wheel(0,Math.max(-2600,Math.min(2600,d)));await p.waitForTimeout(40);}
      await p.waitForTimeout(220);
      worst=Math.max(worst, await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth));
    }
    out.push({page,w,http:resp.status(),hScroll:worst,errors:errs.length,first:errs[0]||''});
    await p.close();
  }
}
for(const o of out) console.log(`${o.page.padEnd(19)}${String(o.w).padStart(5)}  http ${o.http}  hScroll ${String(o.hScroll).padStart(3)}  err ${o.errors} ${o.first}`);
const bad = out.filter(o=>o.http!==200||o.hScroll!==0||o.errors>0);
console.log('\nFAILURES:', bad.length? JSON.stringify(bad): 'none');
await b.close();
