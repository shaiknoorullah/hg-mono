import { chromium } from 'playwright';
import { requireEnv, totpNow, VERIFY_OUT } from './env.mjs';

const APP = 'http://localhost:5183';
const EMAIL = requireEnv('SEED_EMAIL');
const PASSWORD = requireEnv('SEED_PASSWORD');
const OUT = VERIFY_OUT;

const calls = [];
const errors = [];
const browser = await chromium.launch({ args: ['--disable-web-security'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', (r) => {
  if (r.url().includes(':8080/')) calls.push(`${r.status()} ${r.request().method()} ${r.url().replace('http://localhost:8080', '')}`);
});

await page.goto(APP, { waitUntil: 'networkidle' });
await page.fill('#email', EMAIL);
await page.fill('#password', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForTimeout(800);
if (await page.locator('#totp').count()) {
  await page.fill('#totp', totpNow());
  await page.click('button[type="submit"]');
}
await page.waitForResponse((r) => r.url().includes('/v1/restaurant/orders?'), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1200);

// Try clicking the order card itself (not the action button) to see if a detail view opens.
const card = page.getByText('#HG-TEST02').first();
await card.click().catch(() => {});
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/resto2-order-card-click.png`, fullPage: true });
const afterCardClickUrl = page.url();
const afterCardClickBody = (await page.evaluate(() => document.body.innerText)).slice(0, 400);

// Now actually click "Mark ready for pickup" for TEST02's card.
const btn = page.locator('button', { hasText: 'Mark ready for pickup' }).first();
await btn.click().catch(() => {});
const resp = await page.waitForResponse((r) => /\/v1\/restaurant\/orders\/[^/]+\/(ready|transition|mark-ready)/.test(r.url()), { timeout: 10000 }).catch(() => null);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/resto2-after-mark-ready.png`, fullPage: true });
const afterBody = (await page.evaluate(() => document.body.innerText)).slice(0, 500);

await browser.close();
console.log('afterCardClickUrl:', afterCardClickUrl);
console.log('afterCardClickBody:', afterCardClickBody);
console.log('mark-ready response:', resp ? `${resp.status()} ${resp.url()}` : '(no matching response captured)');
console.log('afterBody:', afterBody);
console.log('\n=== calls ===');
console.log(calls.join('\n'));
console.log('\n=== errors ===');
console.log(errors.length ? errors.join('\n') : '(none)');
