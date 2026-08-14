// Drives apps/restaurant-web against the FIXED backend on :8095, signing in as
// the restaurant owner (email + password) and opening the new Onboarding screen,
// which reads getRestaurantOnboardingStatus + listRestaurantDocuments and shows
// verification state, the step checklist, and the compliance document pack.
//
// Run from repo root: SEED_EMAIL=... SEED_PASSWORD=... node tools/verify/resto-onboarding.mjs
import { chromium } from 'playwright';

const APP = process.env.APP_URL ?? 'http://localhost:5180';
const BASE = process.env.API_BASE ?? 'http://localhost:8095';
const EMAIL = process.env.SEED_EMAIL ?? '';
const PASSWORD = process.env.SEED_PASSWORD ?? '';

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

// --- Sign in (email + password) ---
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForResponse((r) => r.url().includes('/v1/auth/login'), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);

// --- Onboarding screen ---
await page.click('a[href="/onboarding"]').catch(() => {});
await page.waitForResponse((r) => r.url().includes('/v1/restaurant/onboarding/status'), { timeout: 15000 }).catch(() => {});
await page.waitForResponse((r) => r.url().includes('/v1/restaurant/documents'), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);

const onboardingText = await page.evaluate(() => document.body.innerText.slice(0, 1200));
const stateShown = await page.getByTestId('onboarding-state').innerText().catch(() => '(not found)');
await page.screenshot({ path: 'tools/verify/resto-onboarding.png', fullPage: true });

await browser.close();

console.log(`=== backend calls (${BASE}) ===`);
for (const c of calls) console.log(`  ${c.status}  ${c.method}  ${c.url}`);
console.log('=== console errors ===');
console.log(consoleErrors.length ? consoleErrors.map((e) => '  ' + e).join('\n') : '  (none)');
console.log('=== onboarding-state testid ===');
console.log('  ' + stateShown.replace(/\n/g, ' '));
console.log('=== onboarding screen visible text (truncated) ===');
console.log(onboardingText);
