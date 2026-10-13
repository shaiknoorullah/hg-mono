// Visual proof of the forest/cream/orange re-skin: drives the live admin app
// (against the backend on :8080) and captures the login screen, the onboarding
// dashboard (forest chrome + cream canvas), and the halal verification
// instrument (emerald seal + brass ring on the new skin).
import { chromium } from 'playwright';
import { requireEnv, totpNow as totp } from './env.mjs';

const APP = process.env.APP_URL ?? 'http://localhost:5175';
const EMAIL = requireEnv('SEED_EMAIL');
const PASSWORD = requireEnv('SEED_PASSWORD');
const OUT = 'tools/verify';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });

console.log('--- login screen (empty) ---');
await page.goto(APP, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await shot('reskin-01-login');

console.log('--- authenticate ---');
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await page.fill('input[name="totp"]', totp());
await page.click('button[type="submit"]');
await page.waitForResponse((r) => r.url().includes('/v1/auth/login'), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);
await shot('reskin-02-dashboard');

console.log('--- halal verification instrument ---');
let halalBtn = page.getByRole('button', { name: /open halal verification/i });
if (!(await halalBtn.count())) {
  const rows = await page.locator('table tbody tr').count().catch(() => 0);
  if (rows > 0) {
    await page.locator('table tbody tr').first().click();
    await page.waitForTimeout(1000);
    halalBtn = page.getByRole('button', { name: /open halal verification/i });
  }
}
if (await halalBtn.count()) {
  await halalBtn.first().click();
  await page.waitForTimeout(1200);
}
await shot('reskin-03-halal-instrument');

await browser.close();
console.log('done: reskin-01-login, reskin-02-dashboard, reskin-03-halal-instrument');
