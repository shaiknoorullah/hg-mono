import { chromium } from 'playwright';
import { requireEnv, totpNow } from './env.mjs';
const APP = 'http://localhost:5183';
const browser = await chromium.launch({ args: ['--disable-web-security'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(APP, { waitUntil: 'networkidle' });
await page.fill('#email', requireEnv('SEED_EMAIL'));
await page.fill('#password', requireEnv('SEED_PASSWORD'));
await page.click('button[type="submit"]');
await page.waitForTimeout(800);
if (await page.locator('#totp').count()) {
  await page.fill('#totp', totpNow());
  await page.click('button[type="submit"]');
}
await page.waitForTimeout(1200);
await page.goto(`${APP}/menu`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.click('button:has-text("Add item")');
await page.waitForTimeout(800);
await page.screenshot({ path: 'tools/verify/resto2-add-item-dialog.png', fullPage: true });
await browser.close();
