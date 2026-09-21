// Chrome behaviour check against the BUILT app, not the source.
//
//   pnpm --filter @hg/marketing build && pnpm --filter @hg/marketing start
//   node apps/marketing/scripts/check-chrome.mjs        (from the repo root)
//
// Walks every route at desktop and phone width and asserts the sticky signup
// behaves: hidden over the hero, shown mid-page, hidden again over the footer.
// Also reports the bar's measured height per breakpoint, because that height is
// taken from every page it sits on — it measured 202px of a 900px viewport once,
// which is a fifth of the screen spent on a form nobody asked for yet.
//
// Two things this exists to catch, both of which shipped:
//   - `!isIntersecting` is true both above AND below the viewport, so a naive
//     sentinel shows the bar over the very hero it is meant to follow.
//   - Rebuilding under a running `next start` serves old HTML referencing chunk
//     hashes that no longer exist. It looks like broken CSS; it is a stale
//     server. Restart it before believing a failure here.

import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const path of ['/','/restaurants','/riders','/verification','/privacy','/terms','/blog']) {
 for (const [w,h] of [[1440,900],[390,844]]) {
  const p = await b.newPage({ viewport:{width:w,height:h} });
  const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,70)));
  p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,70))});
  const r = await p.goto('http://127.0.0.1:5190'+path,{waitUntil:'networkidle'});
  await p.waitForTimeout(700);
  const read = () => p.evaluate(()=>{
    const bar=document.querySelector('[aria-label="Join the waitlist"]');
    return { show: bar?bar.getAttribute('data-show'):'NO BAR',
             vis: bar?getComputedStyle(bar).visibility:null,
             ctaH: getComputedStyle(document.documentElement).getPropertyValue('--sticky-cta-h').trim(),
             hScroll: document.documentElement.scrollWidth-document.documentElement.clientWidth };
  });
  const top = await read();
  const max = await p.evaluate(()=>document.documentElement.scrollHeight-innerHeight);
  await p.evaluate(y=>scrollTo(0,y), max*0.5); await p.waitForTimeout(600);
  const mid = await read();
  await p.evaluate(y=>scrollTo(0,y), max); await p.waitForTimeout(700);
  const foot = await read();
  console.log(`${path.padEnd(14)}${String(w).padStart(5)} http ${r.status()} | top ${top.show} mid ${mid.show} foot ${foot.show} | ctaH ${mid.ctaH||'-'} | hScroll ${Math.max(top.hScroll,mid.hScroll,foot.hScroll)} | err ${errs.length}${errs.length?' '+errs[0]:''}`);
  await p.close();
 }
}
await b.close();
