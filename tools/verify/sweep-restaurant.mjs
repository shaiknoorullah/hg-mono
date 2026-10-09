import { chromium } from 'playwright';
import { requireEnv, VERIFY_OUT } from './env.mjs';

const APP = 'http://localhost:5183';
const OUT = VERIFY_OUT;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

console.log('[sweep] phase: login page');
await page.goto(APP, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/sweep-restaurant-login.png`, fullPage: true });
console.log('[sweep] login screenshot saved. url=', page.url());

console.log('[sweep] phase: submit sign-in (mock server)');
await page.fill('#email', requireEnv('SEED_EMAIL'));
await page.fill('#password', requireEnv('SEED_PASSWORD'));
await page.click('button[type="submit"]');
await page.waitForResponse((r) => r.url().includes('/v1/auth/login'), { timeout: 10000 }).catch((e) => console.log('[sweep] login response wait failed:', e.message));
await page.waitForTimeout(1500);
console.log('[sweep] post-login url:', page.url());
await page.screenshot({ path: `${OUT}/sweep-restaurant-post-login.png`, fullPage: true });

// Force-navigate straight to /orders to capture the target screen regardless of which
// onboarding step the mock server's fixture selection landed on.
console.log('[sweep] phase: orders (direct navigation)');
await page.goto(`${APP}/orders`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/sweep-restaurant-orders.png`, fullPage: true });
console.log('[sweep] orders url:', page.url());

console.log('[sweep] console/page errors:', JSON.stringify(errors.slice(0, 20), null, 2));

await browser.close();
