// Dead-scroll detector: how much of a pinned beat's length is FROZEN.
//
//   node dead-scroll.mjs <file.html> [port]   (run from the repo root)
//
// A beat pins so that something can happen while it is held. If its whole
// choreography runs on the approach clock, the pin has nothing left to do and
// the reader scrolls a viewport or more with the screen completely static —
// which reads as broken, and is the mirror image of a beat that is too short.
//
// This snapshots the SEMANTIC state of everything the renderers animate
// (transforms, opacities, tick counts, blank scales) at eight points across
// each beat, rather than hashing pixels: pixel hashes proved unstable, picking
// up sub-pixel noise from Lenis settling and reporting flicker as motion.
//
// `distinct` is how many different states the beat passes through; a beat with
// distinct === 1 never changes at all. `deadVh` is the longest still stretch,
// in viewports.
//
// Seeks by real wheel input — see verify.mjs: a native scrollTo desyncs Lenis.

import { chromium } from 'playwright';
const file = process.argv[2];
// Port is an argument, not a constant: this harness serves different
// directories on different ports, and a hard-coded one silently measures
// whatever else is listening rather than failing.
const PORT = process.argv[3] || 5400;
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport:{width:1440,height:900} });
await p.goto(`http://127.0.0.1:${PORT}/${file}`, { waitUntil:'load' });
await p.waitForTimeout(2500);
async function wheelTo(y){
  for (let i=0;i<70;i++){
    const cur = await p.evaluate(()=>scrollY);
    const d = y - cur;
    if (Math.abs(d) < 12) break;
    await p.mouse.wheel(0, Math.max(-2500, Math.min(2500, d)));
    await p.waitForTimeout(50);
  }
  await p.waitForTimeout(700);
}
// Semantic state of everything the beat renderers animate.
const snap = () => {
  const r = [];
  document.querySelectorAll('.refusal h2 .ln i').forEach(e=>r.push('rl'+getComputedStyle(e).transform));
  ['.refusal p.body','.refusal p.fine'].forEach(s=>{const e=document.querySelector(s); if(e) r.push('rf'+(+getComputedStyle(e).opacity).toFixed(2));});
  const c = document.querySelector('#count'); if (c) r.push('cnt'+c.textContent.trim());
  document.querySelectorAll('.state-list li').forEach(e=>r.push('st'+(+getComputedStyle(e).opacity).toFixed(2)));
  document.querySelectorAll('[data-blank]').forEach(e=>r.push('bk'+getComputedStyle(e).transform));
  document.querySelectorAll('.checks li').forEach(e=>r.push('ck'+e.getAttribute('data-on')));
  document.querySelectorAll('[data-dev]').forEach(e=>r.push('dv'+getComputedStyle(e).transform));
  document.querySelectorAll('.strip, [data-strip]').forEach(e=>r.push('sp'+getComputedStyle(e).transform));
  return r.join('|');
};
const beats = await p.evaluate(()=>[...document.querySelectorAll('[data-beat], .beat')].map((el,i)=>({
  name: el.dataset.beatName||el.dataset.name||el.dataset.beat||('b'+i), top: el.offsetTop, h: el.offsetHeight })));
const PTS=[0.02,0.15,0.30,0.45,0.60,0.75,0.90,0.99];
const rows=[];
for (const bt of beats){
  await wheelTo(Math.max(0, bt.top - 900));
  const states=[];
  for (const lp of PTS){ await wheelTo(bt.top + (bt.h-900)*lp); states.push(await p.evaluate(snap)); }
  const uniq=new Set(states).size;
  let best=1, run=1;
  for(let i=1;i<states.length;i++){ if(states[i]===states[i-1]){run++;best=Math.max(best,run);} else run=1; }
  const vh=+(bt.h/900).toFixed(2);
  rows.push({ beat:bt.name, vh, distinct:uniq, longestStill:best, deadVh:+((best-1)/(PTS.length-1)*vh).toFixed(2) });
}
console.table(rows);
await b.close();
