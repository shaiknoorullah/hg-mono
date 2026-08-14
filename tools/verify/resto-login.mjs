// Drives restaurant-web against the REAL backend: sign in, load the live order
// queue, capture every backend call. Proves CORS + X-HG-Client + baseURL + bearer
// + response-shape all line up. Run from repo root: node tools/verify/resto-login.mjs
import { chromium } from 'playwright';

const APP = process.env.APP_URL ?? 'http://localhost:5173';
const EMAIL = process.env.SEED_EMAIL ?? 'resto@demo.hg';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Resto@1234';

const calls = [];
const consoleErrors = [];

const browser = await chromium.launch();
const page = await browser.newPage();

page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('response', async (res) => {
  const url = res.url();
  if (url.includes(':8080/')) {
    calls.push({ method: res.request().method(), url: url.replace('http://localhost:8080', ''), status: res.status() });
  }
});

await page.goto(APP, { waitUntil: 'networkidle' });

// Sign in.
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await page.click('button[type="submit"]');

// Wait for the queue fetch to resolve and the table (or empty/error) to render.
await page.waitForResponse((r) => r.url().includes('/v1/restaurant/orders'), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);

const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 1200));
const rowCount = await page.locator('table tbody tr').count().catch(() => 0);
const hasLoginForm = await page.locator('input[name="password"]').count();

await page.screenshot({ path: 'tools/verify/resto-queue.png', fullPage: true });
await browser.close();

console.log('=== backend calls (:8080) ===');
for (const c of calls) console.log(`  ${c.status}  ${c.method}  ${c.url}`);
console.log('=== console errors ===');
console.log(consoleErrors.length ? consoleErrors.join('\n') : '  (none)');
console.log('=== post-login ===');
console.log('  login form still present:', hasLoginForm > 0);
console.log('  queue table rows:', rowCount);
console.log('=== visible text (truncated) ===');
console.log(bodyText);
