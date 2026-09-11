import { chromium } from 'playwright';
const APP = process.env.APP_URL ?? 'http://localhost:5180';
const OUT = 'tools/verify';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(APP, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/reskin-05-gallery-halal.png`, fullPage: false });
async function pick(label, file) {
  const el = page.getByText(new RegExp(`^${label}$`, 'i')).first();
  if (await el.count()) { await el.click().catch(()=>{}); await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: false }); console.log('captured', file); }
  else console.log('no control for', label);
}
await pick('Primitives', 'reskin-06-gallery-primitives');
await pick('Navigation', 'reskin-07-gallery-navigation');
await browser.close();
console.log('done');
