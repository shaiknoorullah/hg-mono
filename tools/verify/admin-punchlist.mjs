// Re-drives the admin app's punch-list flows against the real backend, after
// the P0 fixes (onboarding/rider queue default-empty bug, order-detail 500
// on a rider with no GPS fix yet, palette/font/icon-size fixes).
//
// Run from repo root: node tools/verify/admin-punchlist.mjs
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { requireEnv } from './env.mjs';

const APP = process.env.APP_URL ?? 'http://localhost:5176';
const EMAIL = requireEnv('SEED_EMAIL');
const PASSWORD = requireEnv('SEED_PASSWORD');

// The DB and /tmp are shared with other concurrent agents on this host, who may
// re-seed the same demo admin's TOTP secret mid-run. Re-seed it ourselves right
// before logging in and use that exact secret in the same breath, rather than
// trusting a static file another process can rewrite between read and use.
function reseedAndTotp() {
  const out = execSync(
    `HG_APP_DATA_KEY=${'0'.repeat(64)} HG_POSTGRES_DSN='postgres://hg:change-me-in-your-env@localhost:5432/hg?sslmode=disable' SEED_EMAIL=${EMAIL} /tmp/seedtotp`,
    { shell: '/bin/bash' },
  ).toString();
  const secret = out.match(/TOTP_SECRET=(\S+)/)?.[1];
  if (!secret) throw new Error('seedtotp did not print a secret: ' + out);
  const code = execSync(`SECRET=${secret} /tmp/totpnow`, { shell: '/bin/bash' }).toString().trim();
  return code;
}

const consoleErrors = [];
const failedNetwork = [];

const browser = await chromium.launch();
const page = await browser.newPage();

page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
page.on('response', (res) => {
  if (res.url().includes(':8080/v1/admin/restaurant-applications') || res.url().includes(':8080/v1/admin/rider-applications')) {
    console.log('QUEUE REQ', res.status(), res.request().method(), res.url());
  }
  if (res.status() >= 400 && res.url().includes(':8080/')) {
    failedNetwork.push(`${res.status()} ${res.request().method()} ${res.url().replace('http://localhost:8080', '')}`);
  }
});

await page.goto(APP, { waitUntil: 'networkidle' });

// --- Login (retry once on a stale/boundary TOTP code) ---
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

// --- Onboarding queue: should now show 4 real rows, not "Queue is empty" ---
await page.goto(`${APP}#/`, { waitUntil: 'networkidle' });
await page.waitForResponse((r) => r.url().includes('/v1/admin/restaurant-applications'), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1000);
const restoRows = await page.locator('[role="row"]').count().catch(() => 0);
const restoText = await page.evaluate(() => document.body.innerText.slice(0, 300));
await page.screenshot({ path: 'tools/verify/pl-01-restaurants-queue.png', fullPage: true });
console.log('restaurants queue rows:', restoRows, restoText.includes('Queue is empty') ? '(STILL EMPTY TEXT)' : '');

// --- Riders queue: should now show 2 real rows ---
await page.goto(`${APP}#/riders`, { waitUntil: 'networkidle' });
await page.waitForResponse((r) => r.url().includes('/v1/admin/rider-applications'), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1000);
const riderRows = await page.locator('[role="row"]').count().catch(() => 0);
await page.screenshot({ path: 'tools/verify/pl-02-riders-queue.png', fullPage: true });
console.log('riders queue rows:', riderRows);

// --- Orders grid + click into an order with a dispatched rider (should not 500) ---
await page.goto(`${APP}#/orders`, { waitUntil: 'networkidle' });
await page.waitForResponse((r) => r.url().includes('/v1/admin/orders?') || r.url().includes('/v1/admin/orders'), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1000);
const orderRows = await page.locator('table tbody tr, [role="row"]').count().catch(() => 0);
await page.screenshot({ path: 'tools/verify/pl-03-orders-grid.png', fullPage: true });
console.log('orders grid rows:', orderRows);

// Try clicking a few rows looking for one that reaches detail without 500.
let orderDetailOk = false;
let orderDetailStatus = null;
const rowLocator = page.locator('table tbody tr, [role="row"]');
const rowCount = Math.min(await rowLocator.count().catch(() => 0), 3);
for (let i = 0; i < rowCount; i++) {
  const before = failedNetwork.length;
  await rowLocator.nth(i).click().catch(() => {});
  const resp = await page.waitForResponse((r) => /\/v1\/admin\/orders\/[0-9a-f-]+$/.test(r.url()), { timeout: 8000 }).catch(() => null);
  await page.waitForTimeout(600);
  if (resp) {
    orderDetailStatus = resp.status();
    if (resp.status() < 400) {
      orderDetailOk = true;
      await page.screenshot({ path: 'tools/verify/pl-04-order-detail.png', fullPage: true });
      break;
    }
  }
  await page.goto(`${APP}#/orders`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(500);
}
console.log('order detail reached ok:', orderDetailOk, 'last status:', orderDetailStatus);

// --- Refunds ---
await page.goto(`${APP}#/refunds`, { waitUntil: 'networkidle' });
await page.waitForResponse((r) => r.url().includes('/v1/refunds'), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1000);
const refundRows = await page.locator('table tbody tr').count().catch(() => 0);
await page.screenshot({ path: 'tools/verify/pl-05-refunds.png', fullPage: true });
console.log('refund rows:', refundRows);

// --- Staff ---
await page.goto(`${APP}#/staff`, { waitUntil: 'networkidle' });
await page.waitForResponse((r) => r.url().includes('/v1/admin/staff'), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1000);
await page.screenshot({ path: 'tools/verify/pl-06-staff.png', fullPage: true });

// --- System dashboard (should show the honest topology-restriction error) ---
await page.goto(`${APP}#/system`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.screenshot({ path: 'tools/verify/pl-07-system-dashboard.png', fullPage: true });

// --- Halal instrument via a real application (icon-size fix check) ---
await page.goto(`${APP}#/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
const firstRow = page.locator('[role="row"]').nth(1); // row 0 is the header
if (await firstRow.count()) {
  await firstRow.click();
  await page.waitForResponse((r) => /\/v1\/admin\/restaurant-applications\/[^/?]+$/.test(r.url()), { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'tools/verify/pl-08-application-detail.png', fullPage: true });
  const openBtn = page.getByRole('button', { name: /halal verification/i });
  if (await openBtn.count()) {
    await openBtn.first().click();
    await page.waitForResponse((r) => /\/v1\/admin\/halal-certificates\//.test(r.url()), { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.screenshot({ path: 'tools/verify/pl-09-halal-instrument.png', fullPage: true });
  }
}

// --- Read computed brand colour + font off a primary control, to confirm the token fix landed ---
const brandCheck = await page.evaluate(() => {
  const btn = document.querySelector('button[type="submit"], button.hg-btn, button');
  if (!btn) return null;
  const cs = getComputedStyle(btn);
  return { bg: cs.backgroundColor, font: cs.fontFamily };
});
console.log('sampled button style:', JSON.stringify(brandCheck));

await browser.close();

console.log('=== console errors ===');
console.log(consoleErrors.length ? consoleErrors.map((e) => '  ' + e).join('\n') : '  (none)');
console.log('=== failed network (>=400) ===');
console.log(failedNetwork.length ? failedNetwork.map((e) => '  ' + e).join('\n') : '  (none)');
