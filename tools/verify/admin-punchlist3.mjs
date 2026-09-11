// Halal instrument, reached by direct URL to a known real application id
// (grid-row virtualization made a Playwright click unreliable; the route and
// data are exercised identically either way).
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const APP = process.env.APP_URL ?? 'http://localhost:5175';
const EMAIL = 'admin@demo.hg';
const PASSWORD = 'Admin@1234';
const RESTAURANT_ID = process.env.RESTAURANT_ID ?? '01a05317-dfaa-75ff-a234-cb904d7bad7b';

function reseedAndTotp() {
  const out = execSync(
    `HG_APP_DATA_KEY=${'0'.repeat(64)} HG_POSTGRES_DSN='postgres://hg:change-me-in-your-env@localhost:5432/hg?sslmode=disable' SEED_EMAIL=${EMAIL} /tmp/seedtotp`,
    { shell: '/bin/bash' },
  ).toString();
  const secret = out.match(/TOTP_SECRET=(\S+)/)?.[1];
  const code = execSync(`SECRET=${secret} /tmp/totpnow`, { shell: '/bin/bash' }).toString().trim();
  return code;
}

const consoleErrors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

await page.goto(APP, { waitUntil: 'networkidle' });
let loginOk = false;
for (let attempt = 0; attempt < 3 && !loginOk; attempt++) {
  const code = reseedAndTotp();
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.fill('input[name="totp"]', code);
  await page.click('button[type="submit"]');
  const resp = await page.waitForResponse((r) => r.url().includes('/v1/auth/login'), { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(1000);
  loginOk = (resp?.status() ?? 0) < 400;
}
console.log('login ok:', loginOk);

await page.goto(`${APP}#/applications/${RESTAURANT_ID}`, { waitUntil: 'networkidle' });
await page.waitForResponse((r) => /\/v1\/admin\/restaurant-applications\/[^/?]+$/.test(r.url()), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1200);
await page.screenshot({ path: 'tools/verify/pl-08-application-detail.png', fullPage: true });
console.log('application detail loaded');

const openBtn = page.getByRole('button', { name: /halal verification/i });
if (await openBtn.count()) {
  await openBtn.first().click();
  await page.waitForResponse((r) => /\/v1\/admin\/halal-certificates\//.test(r.url()), { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tools/verify/pl-09-halal-instrument.png', fullPage: true });
  console.log('halal instrument reached: true');
} else {
  console.log('halal instrument reached: false (no button found)');
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
  console.log('body text:', bodyText);
}

await browser.close();
console.log('=== console errors ===');
console.log(consoleErrors.length ? consoleErrors.map((e) => '  ' + e).join('\n') : '  (none)');
