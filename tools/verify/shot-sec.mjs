import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://localhost:4330/', { waitUntil: 'networkidle' });
await p.evaluate(() => document.querySelectorAll('[data-reveal],[data-print]').forEach(e => e.classList.add('is-in')));
await p.waitForTimeout(400);
const secs = await p.$$('main > section');
const out = process.argv[2];
for (let i = 0; i < secs.length; i++) {
  await secs[i].scrollIntoViewIfNeeded();
  await p.waitForTimeout(200);
  await secs[i].screenshot({ path: `${out}-sec${i}.png` }).catch(() => p.screenshot({ path: `${out}-sec${i}.png` }));
}
console.log('sections:', secs.length);
await b.close();
