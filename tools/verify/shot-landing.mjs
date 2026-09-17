import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:4330';
const out = process.argv[3] || '/tmp/lp';
const b = await chromium.launch();

for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'mobile']]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto(base + '/', { waitUntil: 'networkidle' });
  // Reveal everything so a screenshot isn't just the hero.
  await p.evaluate(() => document.querySelectorAll('[data-reveal],[data-print]').forEach((e) => e.classList.add('is-in')));
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}-${tag}-full.png`, fullPage: true });
  await p.screenshot({ path: `${out}-${tag}-fold.png` });

  const audit = await p.evaluate(() => {
    const px = (v) => Math.round(parseFloat(v));
    const orange = [];
    document.querySelectorAll('*').forEach((el) => {
      const s = getComputedStyle(el);
      const hit = [s.backgroundColor, s.color, s.borderTopColor].some((c) => /241,\s*82,\s*30/.test(c));
      if (hit && el.offsetParent !== null) orange.push(el.tagName + '.' + (el.className || '').toString().slice(0, 30));
    });
    return {
      hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      h1Count: document.querySelectorAll('h1').length,
      h1: document.querySelector('h1')?.textContent?.trim(),
      orangeCount: orange.length,
      orange: orange.slice(0, 12),
      // Invariant #9: nothing on this site may be red.
      danger: [...document.querySelectorAll('*')].filter((el) => {
        const s = getComputedStyle(el);
        return [s.backgroundColor, s.color].some((c) => /196,\s*43,\s*28/.test(c));
      }).length,
      pillButtons: [...document.querySelectorAll('.btn')].filter((el) => px(getComputedStyle(el).borderRadius) > 20).length,
      sections: document.querySelectorAll('section').length,
      imgs: [...document.querySelectorAll('img')].map((i) => ({ src: i.getAttribute('src'), w: i.naturalWidth })),
    };
  });
  console.log(`\n── ${tag} ${w}x${h}`);
  console.log(JSON.stringify(audit, null, 1));
  await p.close();
}
await b.close();
