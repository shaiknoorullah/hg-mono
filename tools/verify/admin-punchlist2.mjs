// Fast second pass: refunds, staff, system dashboard, halal instrument, and
// the token/font sample — skips the slow order-detail click loop (covered
// separately by admin-punchlist.mjs + a direct curl check).
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { requireEnv } from './env.mjs';

const APP = process.env.APP_URL ?? 'http://localhost:5175';
const EMAIL = requireEnv('SEED_EMAIL');
const PASSWORD = requireEnv('SEED_PASSWORD');

function reseedAndTotp() {
  const out = execSync(
    `HG_APP_DATA_KEY=${'0'.repeat(64)} HG_POSTGRES_DSN='postgres://hg:change-me-in-your-env@localhost:5432/hg?sslmode=disable' SEED_EMAIL=${EMAIL} /tmp/seedtotp`,
    { shell: '/bin/bash' },
  ).toString();
  const secret = out.match(/TOTP_SECRET=(\S+)/)?.[1];
  const code = execSync(`SECRET=${secret} /tmp/totpnow`, { shell: '/bin/bash' }).toString().trim();
  return code;
}

const consoleErrors = [];
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

await page.goto(APP, { waitUntil: 'networkidle' });
let loginOk = false;
for (let attempt = 0; attempt < 3 && !loginOk; attempt++) {
  const code = reseedAndTotp();
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.fill('input[name="totp"]', code);
  await page.click('button[type="submit"]');
  const resp = await page.waitForResponse((r) => r.url().includes('/v1/auth/login'), { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(1000);
  loginOk = (resp?.status() ?? 0) < 400;
}
console.log('login ok:', loginOk);

// login page component sample (Input/Button/Card adoption)
await page.screenshot({ path: 'tools/verify/pl-00-login.png' }).catch(() => {});

// Refunds
await page.goto(`${APP}#/refunds`, { waitUntil: 'networkidle' });
await page.waitForResponse((r) => r.url().includes('/v1/refunds'), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1000);
const refundRows = await page.locator('table tbody tr').count().catch(() => 0);
await page.screenshot({ path: 'tools/verify/pl-05-refunds.png', fullPage: true });
console.log('refund rows:', refundRows);

// Staff
await page.goto(`${APP}#/staff`, { waitUntil: 'networkidle' });
await page.waitForResponse((r) => r.url().includes('/v1/admin/staff'), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1000);
const staffRows = await page.locator('table tbody tr').count().catch(() => 0);
await page.screenshot({ path: 'tools/verify/pl-06-staff.png', fullPage: true });
console.log('staff rows:', staffRows);

// System dashboard
await page.goto(`${APP}#/system`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const systemText = await page.evaluate(() => document.body.innerText.slice(0, 600));
await page.screenshot({ path: 'tools/verify/pl-07-system-dashboard.png', fullPage: true });
console.log('system dashboard text:', JSON.stringify(systemText));

// Onboarding queue -> application detail -> halal instrument
await page.goto(`${APP}#/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const row = page.locator('[role="row"]').nth(1);
if (await row.count()) {
  await row.click();
  await page.waitForResponse((r) => /\/v1\/admin\/restaurant-applications\/[^/?]+$/.test(r.url()), { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'tools/verify/pl-08-application-detail.png', fullPage: true });
  const openBtn = page.getByRole('button', { name: /halal verification/i });
  if (await openBtn.count()) {
    await openBtn.first().click();
    await page.waitForResponse((r) => /\/v1\/admin\/halal-certificates\//.test(r.url()), { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1400);
    await page.screenshot({ path: 'tools/verify/pl-09-halal-instrument.png', fullPage: true });
    console.log('halal instrument reached: true');
  } else {
    console.log('halal instrument reached: false (no button)');
  }
} else {
  console.log('no application row to open');
}

await browser.close();
console.log('=== console errors ===');
console.log(consoleErrors.length ? consoleErrors.map((e) => '  ' + e).join('\n') : '  (none)');
