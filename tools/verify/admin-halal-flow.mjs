// Drives apps/admin against the FIXED backend on :8095 (the isolated instance
// carrying the onboarding/halal-verification fixes), signing in with email +
// password + a fresh TOTP, then navigating the halal-verification surface for
// the Al-Noor Halal Kitchen application created end-to-end via the real API:
// the onboarding queue, the application detail (now showing the halal cert
// panel), and the seven-check instrument (all seven PASS, cert APPROVED).
//
// Run from repo root: node tools/verify/admin-halal-flow.mjs
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const APP = process.env.APP_URL ?? 'http://localhost:5181';
const BASE = process.env.API_BASE ?? 'http://localhost:8095';
const EMAIL = process.env.SEED_EMAIL ?? 'admin@demo.hg';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Admin@1234';
const RESTAURANT_ID = process.env.RESTAURANT_ID ?? '';
const CERT_ID = process.env.CERT_ID ?? '';

function totp() {
  return execSync(
    'SECRET=$(cat /tmp/hg-admin-totp-secret.txt) go run ./cmd/totpnow',
    { cwd: '/home/devsupreme/work/hg-mono/services/hg', shell: '/bin/bash' },
  )
    .toString()
    .trim();
}

const calls = [];
const consoleErrors = [];

const browser = await chromium.launch();
const page = await browser.newPage();

page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
page.on('response', (res) => {
  const url = res.url();
  if (url.includes(new URL(BASE).host)) {
    calls.push({ method: res.request().method(), url: url.replace(BASE, ''), status: res.status() });
  }
});

await page.goto(APP, { waitUntil: 'networkidle' });

// --- Sign in (email + password + fresh TOTP) ---
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await page.fill('input[name="totp"]', totp());
await page.click('button[type="submit"]');
await page.waitForResponse((r) => r.url().includes('/v1/auth/login'), { timeout: 15000 }).catch(() => {});
await page
  .waitForResponse((r) => r.url().includes('/v1/admin/restaurant-applications'), { timeout: 15000 })
  .catch(() => {});
await page.waitForTimeout(1500);

const rowCount = await page.locator('table tbody tr').count().catch(() => 0);
await page.screenshot({ path: 'tools/verify/admin-halal-queue.png', fullPage: true });

// --- Application detail for our restaurant ---
if (RESTAURANT_ID) {
  await page.goto(`${APP}#/applications/${RESTAURANT_ID}`, { waitUntil: 'networkidle' });
  await page
    .waitForResponse((r) => /\/v1\/admin\/restaurant-applications\/[^/?]+$/.test(r.url()), { timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
}
const appText = await page.evaluate(() => document.body.innerText.slice(0, 1200));
await page.screenshot({ path: 'tools/verify/admin-halal-application.png', fullPage: true });

// --- Halal verification instrument (A-15) ---
if (CERT_ID) {
  await page.goto(`${APP}#/certificates/${CERT_ID}`, { waitUntil: 'networkidle' });
  await page
    .waitForResponse((r) => /\/v1\/admin\/halal-certificates\//.test(r.url()), { timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
}
const halalText = await page.evaluate(() => document.body.innerText.slice(0, 1400));
await page.screenshot({ path: 'tools/verify/admin-halal-instrument.png', fullPage: true });

await browser.close();

console.log(`=== backend calls (${BASE}) ===`);
for (const c of calls) console.log(`  ${c.status}  ${c.method}  ${c.url}`);
console.log('=== console errors ===');
console.log(consoleErrors.length ? consoleErrors.map((e) => '  ' + e).join('\n') : '  (none)');
console.log('=== queue rows ===', rowCount);
console.log('=== application detail text (truncated) ===');
console.log(appText);
console.log('=== halal instrument text (truncated) ===');
console.log(halalText);
