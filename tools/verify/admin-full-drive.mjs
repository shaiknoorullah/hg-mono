// Full admin app drive: login -> onboarding queue -> application detail ->
// halal instrument -> orders grid -> order detail (map) -> refunds -> riders
// queue -> staff -> system dashboard. Captures screenshots + real console
// errors + failed/erroring network calls against the live backend on :8080.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const APP = process.env.APP_URL ?? 'http://localhost:5173';
const EMAIL = process.env.SEED_EMAIL ?? 'admin@demo.hg';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Admin@1234';
const OUT = 'tools/verify';

function totp() {
  return execSync(
    'SECRET=$(cat /tmp/hg-admin-totp-secret.txt) go run ./cmd/totpnow',
    { cwd: '/home/devsupreme/work/hg-mono/services/hg', shell: '/bin/bash' },
  ).toString().trim();
}

const calls = [];
const consoleErrors = [];
const pageErrors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (err) => pageErrors.push(err.message));
page.on('response', (res) => {
  const url = res.url();
  if (url.includes(':8080/')) {
    calls.push({ method: res.request().method(), url: url.replace('http://localhost:8080', ''), status: res.status() });
  }
});

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

console.log('--- login ---');
await page.goto(APP, { waitUntil: 'networkidle' });
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await page.fill('input[name="totp"]', totp());
await page.click('button[type="submit"]');
await page.waitForResponse((r) => r.url().includes('/v1/auth/login'), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1200);
await shot('full-01-onboarding-queue');

console.log('--- application detail (first row if any, else direct nav) ---');
const rowCount = await page.locator('table tbody tr').count().catch(() => 0);
console.log('onboarding queue rows:', rowCount);
if (rowCount > 0) {
  await page.locator('table tbody tr').first().click();
  await page.waitForTimeout(1200);
} else {
  await page.goto(`${APP}#/applications/01a05317-dfaa-75ff-a234-cb904d7bad7b`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
}
await shot('full-02-application-detail');

console.log('--- halal verification instrument (A-15) ---');
let halalBtn = page.getByRole('button', { name: /open halal verification/i });
if (!(await halalBtn.count())) {
  // Approved restaurant's cert, known from DB: try a direct nav using restaurant with decision=APPROVE
  await page.goto(`${APP}#/applications/01a05317-dfd3-7bf4-b0c0-503da0472726`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  halalBtn = page.getByRole('button', { name: /open halal verification/i });
}
if (await halalBtn.count()) {
  await halalBtn.first().click();
  await page.waitForTimeout(1200);
} else {
  console.log('  no halal verification button found on either application');
}
await shot('full-03-halal-instrument');

console.log('--- riders queue ---');
await page.goto(`${APP}#/riders`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot('full-04-riders-queue');
const riderRows = await page.locator('table tbody tr').count().catch(() => 0);
console.log('rider queue rows:', riderRows);
if (riderRows > 0) {
  await page.locator('table tbody tr').first().click();
  await page.waitForTimeout(1200);
  await shot('full-05-rider-application-detail');
}

console.log('--- orders grid (LyteNyte) ---');
await page.goto(`${APP}#/orders`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
await shot('full-06-orders-grid');
const gridRowCount = await page.locator('[role="row"]').count().catch(() => 0);
console.log('orders grid [role=row] count:', gridRowCount);

console.log('--- order detail (live map) ---');
// Grab an order id from the last admin/orders response we saw, else DB-known id.
const ordersResp = calls.filter((c) => c.url.startsWith('/v1/admin/orders') && c.status === 200);
console.log('orders calls seen:', ordersResp.map((c) => c.url));
let orderId = '01a05319-7efd-7e1e-acc0-90cfa1a1b1bb'; // known PREPARING order from DB probe
try {
  const firstDataRow = page.locator('[data-ln-rowtype="normal-row"]').first();
  await firstDataRow.scrollIntoViewIfNeeded({ timeout: 5000 });
  await firstDataRow.click({ timeout: 5000, force: true });
  await page.waitForTimeout(1200);
} catch (e) {
  console.log('  grid row click failed:', e.message.split('\n')[0]);
}
// If click-through routing didn't work, navigate directly.
if (!page.url().includes('/orders/')) {
  await page.goto(`${APP}#/orders/${orderId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
}
await shot('full-07-order-detail');

console.log('--- refunds & disputes ---');
await page.goto(`${APP}#/refunds`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot('full-08-refunds');

console.log('--- staff ---');
await page.goto(`${APP}#/staff`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot('full-09-staff');

console.log('--- system dashboard ---');
await page.goto(`${APP}#/system`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await shot('full-10-system-dashboard');

await browser.close();

console.log('\n=== backend calls (:8080) ===');
for (const c of calls) console.log(`  ${c.status}  ${c.method}  ${c.url}`);
console.log('\n=== console errors ===');
console.log(consoleErrors.length ? consoleErrors.map((e) => '  ' + e).join('\n') : '  (none)');
console.log('\n=== page errors ===');
console.log(pageErrors.length ? pageErrors.map((e) => '  ' + e).join('\n') : '  (none)');
console.log('\n=== failed / error responses ===');
const bad = calls.filter((c) => c.status >= 400);
console.log(bad.length ? bad.map((c) => `  ${c.status} ${c.method} ${c.url}`).join('\n') : '  (none)');
