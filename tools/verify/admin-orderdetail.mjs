// Direct-nav order-detail render: login -> #/orders/<real id> -> wait for the
// Mapbox canvas -> screenshot. Bypasses the flaky grid row-click.
import { chromium } from 'playwright';
import { requireEnv, totpNow as totp } from './env.mjs';

const APP = process.env.APP_URL ?? 'http://localhost:5175';
const EMAIL = requireEnv('SEED_EMAIL');
const PASSWORD = requireEnv('SEED_PASSWORD');
const ORDER = '88888888-8888-4888-8888-888888888888';
const OUT = 'tools/verify';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const tileReqs = [];
page.on('request', (r) => { if (r.url().includes('mapbox') || r.url().includes('tiles')) tileReqs.push(r.url()); });
const tileResp = [];
page.on('response', (r) => { const u=r.url(); if (u.includes('mapbox')||u.includes('tiles')) tileResp.push(`${r.status()} ${u.slice(0,70)}`); });

console.log('--- login ---');
await page.goto(APP, { waitUntil: 'networkidle' });
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await page.fill('input[name="totp"]', totp());
await page.click('button[type="submit"]');
await page.waitForResponse((r) => r.url().includes('/v1/auth/login') && r.status() === 200, { timeout: 15000 });
console.log('login OK');

console.log('--- direct nav to order detail ---');
await page.goto(`${APP}/#/orders/${ORDER}`, { waitUntil: 'networkidle' });
await page.waitForResponse((r) => r.url().includes(`/v1/admin/orders/${ORDER}`) && r.status() === 200, { timeout: 15000 }).catch(()=>console.log('  (detail response not observed)'));
await page.waitForTimeout(3500); // let mapbox-gl init + fetch tiles
// try to detect the map canvas
const hasCanvas = await page.locator('canvas.mapboxgl-canvas, canvas').count();
console.log('canvas elements:', hasCanvas);
await page.screenshot({ path: `${OUT}/admin-orderdetail-map.png`, fullPage: true });
console.log('screenshot saved');

console.log('=== mapbox tile requests:', tileReqs.length);
console.log(tileResp.slice(0, 6).join('\n'));
await browser.close();
