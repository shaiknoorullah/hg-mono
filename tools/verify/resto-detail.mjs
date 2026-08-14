// Deeper check: log in, open one order's detail, confirm getRestaurantOrder's
// nested money/customer/lines render without crashing against the real backend.
import { chromium } from 'playwright';
const APP = 'http://localhost:5173';
const calls = [], errors = [];
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', (r) => { if (r.url().includes(':8080/')) calls.push(`${r.status()} ${r.request().method()} ${r.url().replace('http://localhost:8080','')}`); });

await page.goto(APP, { waitUntil: 'networkidle' });
await page.fill('input[name="email"]', 'resto@demo.hg');
await page.fill('input[name="password"]', 'Resto@1234');
await page.click('button[type="submit"]');
await page.waitForResponse((r) => r.url().includes('/v1/restaurant/orders'), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1200);

// Activate the first order row (DataTable grid: click a cell, then Enter).
const firstCell = page.locator('table tbody tr').first().locator('td').first();
await firstCell.click();
await page.keyboard.press('Enter');
await page.waitForResponse((r) => /\/v1\/restaurant\/orders\/[^/?]+$/.test(r.url()), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);

const text = await page.evaluate(() => document.body.innerText.slice(0, 1400));
await page.screenshot({ path: 'tools/verify/resto-detail.png', fullPage: true });
await browser.close();
console.log('=== backend calls ==='); console.log(calls.join('\n'));
console.log('=== console errors ==='); console.log(errors.length ? errors.join('\n') : '  (none)');
console.log('=== order detail visible text ==='); console.log(text);
