import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
const APP = 'http://localhost:5175';
function totp() {
  return execSync('SECRET=$(cat /tmp/hg-admin-totp-secret.txt) go run ./cmd/totpnow',
    { cwd: '/home/devsupreme/work/hg-mono/services/hg', shell: '/bin/bash' }).toString().trim();
}
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
await page.goto(APP, { waitUntil: 'networkidle' });
await page.fill('input[name="email"]', 'admin@demo.hg');
await page.fill('input[name="password"]', 'Admin@1234');
await page.fill('input[name="totp"]', totp());
await page.click('button[type="submit"]');
await page.waitForResponse((r) => r.url().includes('/v1/auth/login'), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1000);
const id = '01a05317-dfd3-7bf4-b0c0-503da0472726';
await page.goto(`${APP}#/applications/${id}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'tools/verify/halal-detail-retry.png', fullPage: true });
const btn = page.getByRole('button', { name: /open halal verification/i });
console.log('btn count:', await btn.count());
const bodyText = await page.locator('body').innerText();
console.log('has "No halal certificate":', bodyText.includes('No halal certificate'));
console.log('has "Open halal verification":', bodyText.includes('Open halal verification'));
if (await btn.count()) {
  await btn.first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tools/verify/halal-instrument-final.png', fullPage: true });
  console.log('url now:', page.url());
}
console.log('console errors:', consoleErrors.length ? consoleErrors.join('\n') : '(none)');
await browser.close();
