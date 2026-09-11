// Verifies (1) the CORS fix — app reaches the real backend with a stock
// Chromium security model, no --disable-web-security — and (2) the manager-role
// payouts UX fix (neutral explanation, not a scary red error card).
// Run: node tools/verify/resto-payouts-verify.mjs
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const APP = 'http://localhost:5190';
const EMAIL = 'resto-qa@demo.hg';
const PASSWORD = 'Resto@1234';
const SECRET = '3E2AMKTIAML53ETZPY4LKJGAGYO5QBTM';

function totp() {
  return execSync(
    `cd services/hg && SECRET=${SECRET} go run ./cmd/totpnow`,
    { cwd: process.cwd() },
  ).toString().trim();
}

const calls = [];
const corsErrors = [];
// NOTE: no launch args disabling web security — the stock sandboxed browser.
const browser = await chromium.launch();
const page = await browser.newPage();

page.on('console', (m) => {
  if (m.type() === 'error' && /CORS|Cross-Origin|blocked/i.test(m.text())) corsErrors.push(m.text());
});
page.on('response', (res) => {
  const url = res.url();
  if (url.includes(':8080/')) calls.push({ method: res.request().method(), url: url.replace('http://localhost:8080', ''), status: res.status() });
});

await page.goto(APP, { waitUntil: 'networkidle' });
await page.fill('#email', EMAIL);
await page.fill('#password', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForTimeout(1200);

// MFA stage.
const totpInput = page.locator('#totp');
await totpInput.waitFor({ timeout: 8000 });
await totpInput.fill(totp());
await page.click('button[type="submit"]');
await page.waitForResponse((r) => r.url().includes('/v1/restaurant/orders'), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(800);
await page.screenshot({ path: 'tools/verify/resto-verify-01-post-login.png', fullPage: true });

// Go to payouts.
await page.goto(`${APP}/payouts`, { waitUntil: 'networkidle' });
await page.waitForResponse((r) => r.url().includes('/v1/restaurant/payouts'), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(800);
await page.screenshot({ path: 'tools/verify/resto-verify-02-payouts.png', fullPage: true });
const payoutsBody = await page.evaluate(() => document.body.innerText.slice(0, 1500));
const hasScaryError = await page.locator('text=Something went wrong').count();
const hasOwnerNotice = await page.locator('text=/owner/i').count();

await browser.close();

console.log('=== backend calls (:8080) ===');
for (const c of calls) console.log(`  ${c.status}  ${c.method}  ${c.url}`);
console.log('=== CORS console errors ===');
console.log(corsErrors.length ? corsErrors.join('\n') : '  (none)');
console.log('=== payouts page ===');
console.log('  "Something went wrong" card present:', hasScaryError > 0);
console.log('  owner-permission notice present:', hasOwnerNotice > 0);
console.log('=== visible text ===');
console.log(payoutsBody);
