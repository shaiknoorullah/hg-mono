import { chromium } from 'playwright';
const base = 'http://localhost:4330';
const b = await chromium.launch();

// 1. JavaScript completely disabled.
const nojs = await b.newContext({ javaScriptEnabled: false });
const p1 = await nojs.newPage();
await p1.goto(base + '/', { waitUntil: 'load' });
const r1 = await p1.evaluate(() => {
  const hidden = [...document.querySelectorAll('[data-reveal],[data-print]')]
    .filter((e) => { const s = getComputedStyle(e); return parseFloat(s.opacity) < 0.5 || s.visibility === 'hidden'; });
  return {
    visibleText: document.body.innerText.trim().length,
    hiddenReveals: hidden.length,
    formAction: document.querySelector('.waitlist-form')?.getAttribute('action'),
    formMethod: document.querySelector('.waitlist-form')?.getAttribute('method'),
    detailsOpenable: document.querySelectorAll('details').length,
  };
});
console.log('NO-JS  ', JSON.stringify(r1));
await p1.screenshot({ path: '/tmp/claude-1000/-home-devsupreme-work-hg-mono/7ee2a43c-6879-4ed0-93b0-1db24f5e568f/scratchpad/gate-nojs.png' });

// 2. prefers-reduced-motion.
const rm = await b.newContext({ reducedMotion: 'reduce' });
const p2 = await rm.newPage();
await p2.goto(base + '/', { waitUntil: 'networkidle' });
await p2.waitForTimeout(800);
const r2 = await p2.evaluate(() => ({
  hiddenReveals: [...document.querySelectorAll('[data-reveal],[data-print]')]
    .filter((e) => parseFloat(getComputedStyle(e).opacity) < 0.5).length,
  clipped: [...document.querySelectorAll('[data-print]')]
    .filter((e) => getComputedStyle(e).clipPath.includes('100%')).length,
}));
console.log('REDUCED', JSON.stringify(r2));

// 3. Keyboard focus visibility + touch targets on mobile.
const m = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
const p3 = await m.newPage();
await p3.goto(base + '/', { waitUntil: 'networkidle' });
const r3 = await p3.evaluate(() => {
  const small = [...document.querySelectorAll('a,button,input,summary')]
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 44; })
    .map((e) => e.tagName + ':' + Math.round(e.getBoundingClientRect().height));
  return { under44: small.length, examples: small.slice(0, 8) };
});
console.log('TOUCH  ', JSON.stringify(r3));
await b.close();
