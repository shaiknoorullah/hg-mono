// Design-system sweep verification for apps/admin.
// Login -> Orders grid -> click a real order row -> order detail (proves the LyteNyte
// row-activation fix, mouse + keyboard) -> System dashboard (proves the CORS/guard fix) ->
// a nav screenshot (proves SideNav + Icon + Plus Jakarta Sans are live app-wide).
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const APP = process.env.APP_URL ?? 'http://localhost:5175';
const EMAIL = process.env.SEED_EMAIL ?? 'dev-admin@halalgoes.test';
const PASSWORD = process.env.SEED_PASSWORD ?? 'DevAdmin!2026';
const OUT = 'tools/verify';

function totp() {
  return execSync(
    'SECRET=$(cat /tmp/hg-admin-totp-secret.txt) go run ./cmd/totpnow',
    { cwd: '/home/devsupreme/work/hg-mono/.claude/worktrees/wf_35632bc9-df9-3/services/hg', shell: '/bin/bash' },
  ).toString().trim();
}

const consoleErrors = [];
const pageErrors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (err) => pageErrors.push(err.message));

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

console.log('--- login ---');
await page.goto(APP, { waitUntil: 'networkidle' });
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await page.fill('input[name="totp"]', totp());
await page.click('button[type="submit"]');
await page.waitForResponse((r) => r.url().includes('/v1/auth/login'), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1000);

console.log('--- restaurants queue (default route) — SideNav + Icon + Plus Jakarta Sans ---');
await shot('sweep-admin-01-nav');

console.log('--- orders grid ---');
await page.goto(`${APP}#/orders`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await shot('sweep-admin-02-orders-grid');

console.log('--- row activation: mouse click on a real order row ---');
const cell = page.locator('[role="gridcell"][data-ln-rowindex="0"]').first();
await cell.click({ timeout: 5000 });
await page.waitForTimeout(1000);
const urlAfterClick = page.url();
console.log('  url after click:', urlAfterClick);
await shot('sweep-admin-03-order-detail-via-click');

console.log('--- row activation: keyboard Tab + Enter on a different row ---');
await page.goto(`${APP}#/orders`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const cell2 = page.locator('[role="gridcell"][data-ln-rowindex="1"]').first();
await cell2.focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(1000);
const urlAfterEnter = page.url();
console.log('  url after Enter:', urlAfterEnter);
await shot('sweep-admin-04-order-detail-via-keyboard');

console.log('--- system dependency dashboard (CORS-guarded) ---');
await page.goto(`${APP}#/system`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await shot('sweep-admin-05-system-dashboard');

console.log('--- riders / refunds / staff — SideNav + Icon consistent app-wide ---');
await page.goto(`${APP}#/riders`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await shot('sweep-admin-06-riders');
await page.goto(`${APP}#/refunds`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await shot('sweep-admin-07-refunds');
await page.goto(`${APP}#/staff`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await shot('sweep-admin-08-staff');

console.log('--- a11y: first Tab stop is the AppShell skip link ---');
await page.goto(`${APP}#/orders`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.keyboard.press('Tab');
const firstFocused = await page.evaluate(() => document.activeElement?.textContent?.trim());
console.log('  first Tab stop text:', firstFocused);

await browser.close();

console.log('\n=== result ===');
console.log('click nav worked:', urlAfterClick.includes('/orders/') && !urlAfterClick.endsWith('/orders'));
console.log('keyboard nav worked:', urlAfterEnter.includes('/orders/') && !urlAfterEnter.endsWith('/orders'));
console.log('\n=== console errors ===');
console.log(consoleErrors.length ? consoleErrors.map((e) => '  ' + e).join('\n') : '  (none)');
console.log('\n=== page errors (unhandled exceptions) ===');
console.log(pageErrors.length ? pageErrors.map((e) => '  ' + e).join('\n') : '  (none)');
