import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const APP = 'http://localhost:5183';
const EMAIL = 'resto-qa@demo.hg';
const PASSWORD = 'RestoQA@1234';
const TOTP_SECRET = 'TVUUMK6M6YL4FPQPHCTX67QZS6QLE66B';
const OUT = '/home/devsupreme/work/hg-mono/tools/verify';

function totpNow() {
  return execSync(
    `cd /home/devsupreme/work/hg-mono/services/hg && SECRET=${TOTP_SECRET} go run ./cmd/totpnow`,
    { encoding: 'utf8' },
  ).trim();
}

const calls = [];
const errors = [];
const results = {};

// NOTE: --disable-web-security bypasses the CORS block on :5183 (confirmed real bug:
// backend HG_CORS_ALLOWED_ORIGINS does not include 5183) purely so the REST of the app
// can be exercised against the real API. This does not represent what an unmodified
// browser session would see — that session is fully blocked, reported separately.
const browser = await chromium.launch({ args: ['--disable-web-security', '--disable-site-isolation-trials'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('response', (r) => {
  if (r.url().includes(':8080/')) calls.push(`${r.status()} ${r.request().method()} ${r.url().replace('http://localhost:8080', '')}`);
});

const log = (...a) => console.log('[resto]', ...a);

// ---- LOGIN: email+password ----
log('phase: login form');
await page.goto(APP, { waitUntil: 'networkidle' });
await page.fill('#email', EMAIL);
await page.fill('#password', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForResponse((r) => r.url().includes('/v1/auth/login'), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(800);

const totpVisible = await page.locator('#totp').count();
log('totp field present:', totpVisible > 0);
if (totpVisible > 0) {
  const code = totpNow();
  log('totp code:', code);
  await page.fill('#totp', code);
  await page.click('button[type="submit"]');
  await page.waitForResponse((r) => r.url().includes('/v1/auth/login'), { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
}
await page.screenshot({ path: `${OUT}/resto2-login.png`, fullPage: true });
results.loginUrl = page.url();
results.loginBody = (await page.evaluate(() => document.body.innerText)).slice(0, 300);

// ---- ONBOARDING ----
log('phase: onboarding landing');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/resto2-onboarding.png`, fullPage: true });
results.onboardingUrl = page.url();
results.onboardingBody = (await page.evaluate(() => document.body.innerText)).slice(0, 500);

// ---- ORDERS QUEUE ----
log('phase: orders queue');
await page.goto(`${APP}/orders`, { waitUntil: 'networkidle' });
await page.waitForResponse((r) => r.url().includes('/v1/restaurant/orders'), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/resto2-orders.png`, fullPage: true });
results.ordersBody = (await page.evaluate(() => document.body.innerText)).slice(0, 800);

// try to open first order for detail/accept
const firstRow = page.locator('table tbody tr, [data-testid*="order-row"], li').first();
const rowCount = await page.locator('table tbody tr').count().catch(() => 0);
results.orderRowCount = rowCount;
if (rowCount > 0) {
  await firstRow.click().catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/resto2-order-detail.png`, fullPage: true });
  results.orderDetailBody = (await page.evaluate(() => document.body.innerText)).slice(0, 800);
  // Look for an accept button
  const acceptBtn = page.getByRole('button', { name: /accept/i }).first();
  results.acceptBtnVisible = await acceptBtn.count();
  if (await acceptBtn.count()) {
    await acceptBtn.click().catch(() => {});
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/resto2-order-accepted.png`, fullPage: true });
    results.afterAcceptBody = (await page.evaluate(() => document.body.innerText)).slice(0, 500);
  }
}

// ---- MENU ----
log('phase: menu');
await page.goto(`${APP}/menu`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/resto2-menu.png`, fullPage: true });
results.menuBody = (await page.evaluate(() => document.body.innerText)).slice(0, 500);

// ---- HOURS ----
log('phase: hours');
await page.goto(`${APP}/hours`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/resto2-hours.png`, fullPage: true });
results.hoursBody = (await page.evaluate(() => document.body.innerText)).slice(0, 500);

// ---- SETTINGS ----
log('phase: settings');
await page.goto(`${APP}/settings`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/resto2-settings.png`, fullPage: true });
results.settingsBody = (await page.evaluate(() => document.body.innerText)).slice(0, 500);

// ---- STAFF ----
log('phase: staff');
await page.goto(`${APP}/staff`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/resto2-staff.png`, fullPage: true });
results.staffBody = (await page.evaluate(() => document.body.innerText)).slice(0, 500);

// ---- PAYOUTS ----
log('phase: payouts');
await page.goto(`${APP}/payouts`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/resto2-payouts.png`, fullPage: true });
results.payoutsBody = (await page.evaluate(() => document.body.innerText)).slice(0, 500);

await browser.close();

console.log('\n=== RESULTS ===');
console.log(JSON.stringify(results, null, 2));
console.log('\n=== backend calls (:8080) ===');
console.log(calls.join('\n'));
console.log('\n=== console errors ===');
console.log(errors.length ? errors.join('\n') : '  (none)');
