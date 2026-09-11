import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
const APP = process.env.APP_URL ?? 'http://localhost:5175';
const OUT = 'tools/verify';
const totp = () => execSync('SECRET=$(cat /tmp/hg-admin-totp-secret.txt) go run ./cmd/totpnow',
  { cwd: '/home/devsupreme/work/hg-mono/services/hg', shell: '/bin/bash' }).toString().trim();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(APP, { waitUntil: 'networkidle' });
await page.fill('input[name="email"]', 'admin@demo.hg');
await page.fill('input[name="password"]', 'Admin@1234');
// Segmented OTP: focus first box, type digits so each auto-advances.
const code = totp();
console.log('code len', code.length);
const boxes = page.locator('input[name="totp"], [data-testid*="otp"] input, input[autocomplete="one-time-code"]');
const n = await boxes.count();
console.log('otp inputs:', n);
if (n >= 6) {
  for (let i = 0; i < 6; i++) { await boxes.nth(i).fill(code[i]); }
} else {
  await boxes.first().click();
  await page.keyboard.type(code, { delay: 40 });
}
await page.waitForTimeout(300);
await page.click('button[type="submit"]');
const resp = await page.waitForResponse((r) => r.url().includes('/v1/auth/login'), { timeout: 15000 }).catch(() => null);
console.log('login status:', resp ? resp.status() : 'no response');
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/reskin-02-dashboard.png`, fullPage: false });
// navigate to a data view for chrome + tables
await page.goto(`${APP}#/riders`, { waitUntil: 'networkidle' }).catch(()=>{});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/reskin-04-riders.png`, fullPage: false });
await browser.close();
console.log('done');
