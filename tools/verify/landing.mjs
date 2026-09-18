// Landing-page visual verification: desktop (both audiences) + mobile, plus a
// waitlist form validation smoke check.
import { chromium } from 'playwright';

const APP = process.env.APP_URL ?? 'http://localhost:4330';
const OUT = 'tools/verify';
const browser = await chromium.launch();
const errors = [];

async function shoot(name, width, height, audience) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`); });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  if (audience === 'own') {
    await page.click('.seg [data-aud="own"]');
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(`shot ${name} (${width}x${height}, ${audience})`);
  await page.close();
}

await shoot('landing-01-desktop-eat', 1280, 900, 'eat');
await shoot('landing-02-desktop-own', 1280, 900, 'own');
await shoot('landing-03-mobile-eat', 390, 844, 'eat');

// form validation smoke: invalid phone should be rejected client-side
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(APP, { waitUntil: 'networkidle' });
await page.fill('#waitlist input[name="phone"]', '123');
await page.click('#waitlist .waitlist-form button[type="submit"]');
await page.waitForTimeout(300);
const msg = await page.locator('#waitlist .formmsg').first().textContent();
console.log('invalid-phone message:', JSON.stringify(msg));
await page.close();

await browser.close();
console.log(errors.length ? `CONSOLE/PAGE ERRORS:\n${errors.join('\n')}` : 'no console/page errors');
