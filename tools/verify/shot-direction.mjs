import { chromium } from 'playwright';
const out = process.argv[3] || '/tmp/dir';
const b = await chromium.launch();
for (const [w, h, tag] of [[1280, 900, 'desktop'], [390, 844, 'mobile']]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.goto('file://' + process.argv[2], { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}-${tag}-top.png` });
  await p.evaluate(() => document.querySelector('#s6')?.scrollIntoView());
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}-${tag}-mid.png` });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(tag, 'h-overflow:', overflow);
  await p.close();
}
await b.close();
