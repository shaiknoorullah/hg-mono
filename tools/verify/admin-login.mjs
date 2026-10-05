// Drives apps/admin against the REAL conformant backend on :8080.
// Signs in with email + password + a fresh TOTP (admin MFA is mandatory),
// then navigates the halal-verification surface: the onboarding queue, an
// application detail, and the seven-check halal certificate instrument.
// Proves CORS + X-HG-Client=admin-web + baseURL + bearer + totp_code + the
// real response shapes all line up. A clean authed render with real 200s is
// the bar; empty-state is acceptable if nothing is seeded.
//
// Run from repo root: node tools/verify/admin-login.mjs
import { chromium } from 'playwright';
import { requireEnv, totpNow as totp } from './env.mjs';

const APP = process.env.APP_URL ?? 'http://localhost:5174';
const EMAIL = requireEnv('SEED_EMAIL');
const PASSWORD = requireEnv('SEED_PASSWORD');

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
  if (url.includes(':8080/')) {
    calls.push({
      method: res.request().method(),
      url: url.replace('http://localhost:8080', ''),
      status: res.status(),
    });
  }
});

await page.goto(APP, { waitUntil: 'networkidle' });

// --- Sign in (email + password + fresh TOTP) ---
const code = totp();
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await page.fill('input[name="totp"]', code);
await page.click('button[type="submit"]');

// Wait for the login POST + the first authed queue fetch to resolve.
await page
  .waitForResponse((r) => r.url().includes('/v1/auth/login'), { timeout: 15000 })
  .catch(() => {});
await page
  .waitForResponse((r) => r.url().includes('/v1/admin/restaurant-applications'), { timeout: 15000 })
  .catch(() => {});
await page.waitForTimeout(1500);

const loginStillPresent = await page.locator('input[name="totp"]').count();
const queueHeading = await page.locator('#queue-heading').count();
const queueText = await page.evaluate(() => document.body.innerText.slice(0, 900));
const rowCount = await page.locator('table tbody tr').count().catch(() => 0);

await page.screenshot({ path: 'tools/verify/admin-queue.png', fullPage: true });

// --- Halal verification instrument (A-15). ---
// If a row is seeded, open its application then the certificate; otherwise
// exercise the route directly to prove the screen renders (404 -> not-found
// empty state is a clean authed render, not a crash).
let halalText = '';
let halalReached = false;
if (rowCount > 0) {
  const firstCell = page.locator('table tbody tr').first().locator('td').first();
  await firstCell.click();
  await page.keyboard.press('Enter');
  await page
    .waitForResponse((r) => /\/v1\/admin\/restaurant-applications\/[^/?]+$/.test(r.url()), {
      timeout: 15000,
    })
    .catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'tools/verify/admin-application.png', fullPage: true });

  // Open halal verification if the application exposes a certificate.
  const openBtn = page.getByRole('button', { name: /halal verification/i });
  if (await openBtn.count()) {
    await openBtn.first().click();
    await page
      .waitForResponse((r) => /\/v1\/admin\/halal-certificates\//.test(r.url()), { timeout: 15000 })
      .catch(() => {});
    await page.waitForTimeout(1200);
    halalReached = true;
  }
}

if (!halalReached) {
  // Drive the route directly against a real certificate id lookup.
  await page.goto(`${APP}#/certificates/00000000-0000-0000-0000-000000000000`, {
    waitUntil: 'networkidle',
  });
  await page
    .waitForResponse((r) => /\/v1\/admin\/halal-certificates\//.test(r.url()), { timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(1200);
}

halalText = await page.evaluate(() => document.body.innerText.slice(0, 900));
await page.screenshot({ path: 'tools/verify/admin-halal.png', fullPage: true });

await browser.close();

console.log('=== backend calls (:8080) ===');
for (const c of calls) console.log(`  ${c.status}  ${c.method}  ${c.url}`);
console.log('=== console errors ===');
console.log(consoleErrors.length ? consoleErrors.map((e) => '  ' + e).join('\n') : '  (none)');
console.log('=== post-login ===');
console.log('  login form still present:', loginStillPresent > 0);
console.log('  queue heading present:', queueHeading > 0);
console.log('  queue rows:', rowCount);
console.log('=== queue visible text (truncated) ===');
console.log(queueText);
console.log('=== halal screen visible text (truncated) ===');
console.log(halalText);
