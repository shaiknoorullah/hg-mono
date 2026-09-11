import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
const APP = 'http://localhost:5183';
function totpNow() {
  return execSync(`cd /home/devsupreme/work/hg-mono/services/hg && SECRET=MSRMDH22NRZ7KJKFSWTXTHCDPULSEBPH go run ./cmd/totpnow`, { encoding: 'utf8' }).trim();
}
const browser = await chromium.launch({ args: ['--disable-web-security'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(APP, { waitUntil: 'networkidle' });
await page.fill('#email', 'resto-qa@demo.hg');
await page.fill('#password', 'RestoQA@1234');
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
