// Halal instrument via direct certificate URL — verifies the icon-size CSS
// fix (H5/H7 lock glyphs) and the crimson/font token fix render correctly.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const APP = process.env.APP_URL ?? 'http://localhost:5175';
const EMAIL = 'admin@demo.hg';
const PASSWORD = 'Admin@1234';
const CERT_ID = process.env.CERT_ID;

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
const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
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

await page.goto(`${APP}#/certificates/${CERT_ID}`, { waitUntil: 'networkidle' });
const resp = await page.waitForResponse((r) => /\/v1\/admin\/halal-certificates\//.test(r.url()), { timeout: 15000 }).catch(() => null);
console.log('certificate fetch status:', resp?.status());
await page.waitForTimeout(1500);
await page.screenshot({ path: 'tools/verify/pl-09-halal-instrument.png', fullPage: true });

// Measure the lock glyph size to confirm the var()-as-attribute fix landed.
const lockSize = await page.evaluate(() => {
  const svgs = Array.from(document.querySelectorAll('svg'));
  const lock = svgs.find((s) => s.getAttribute('viewBox') === '0 0 24 24' && s.querySelector('rect'));
  if (!lock) return null;
  const r = lock.getBoundingClientRect();
  return { width: r.width, height: r.height };
});
console.log('lock glyph rendered size:', JSON.stringify(lockSize));

await browser.close();
console.log('=== console errors ===');
console.log(consoleErrors.length ? consoleErrors.map((e) => '  ' + e).join('\n') : '  (none)');
