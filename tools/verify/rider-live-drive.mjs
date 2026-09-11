import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const OUT = '/home/devsupreme/work/hg-mono/.claude/worktrees/wf_3a3764ca-14a-5/tools/verify';
const PHONE = '+14165550188';
const PHONE_DIGITS = '4165550188';
const BASE = 'http://localhost:5173';

function clearOpenChallenge(phoneE164) {
  // A still-open challenge makes RequestOTP take the "resend" path, which cannot re-derive the
  // original code and so never re-logs it (service_flows.go). Clear it so the next request always
  // mints (and echoes, HG_ENV=local) a fresh one.
  execSync(
    `docker exec hg-postgres-1 psql -U hg -d hg -c "delete from otp_challenge where phone_e164='${phoneE164}';"`,
  );
}

function latestOtp(phoneE164) {
  const logs = execSync('docker logs hg-api-1 --tail 200', { encoding: 'utf8' });
  const lines = logs.split('\n').filter((l) => l.includes('otp sms enqueued'));
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes(phoneE164)) {
      const m = lines[i].match(/"code":"(\d{4,6})"/);
      if (m) return m[1];
    }
  }
  return null;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    geolocation: { latitude: 43.6532, longitude: -79.3832 },
    permissions: ['geolocation'],
    viewport: { width: 420, height: 900 },
  });
  const page = await ctx.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[console.error]', msg.text());
  });
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));
  const failed = [];
  page.on('response', async (res) => {
    if (res.url().includes('/positions') || res.url().includes('/availability')) {
      let body = '';
      try { body = await res.text(); } catch {}
      console.log('[net]', res.status(), res.request().method(), res.url(), body.slice(0, 300));
    }
    if (res.status() >= 400) failed.push(`${res.status()} ${res.request().method()} ${res.url()}`);
  });

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/rider-live2-01-login.png` });

  clearOpenChallenge(PHONE);

  // Login: phone entry
  const phoneInput = page.locator('input').first();
  await phoneInput.fill(PHONE);
  await page.screenshot({ path: `${OUT}/rider-live2-02-phone-entered.png` });
  const sendBtn = page.getByRole('button', { name: /send|continue|request/i }).first();
  await sendBtn.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/rider-live2-03-otp-sent.png` });

  const code = latestOtp(PHONE);
  console.log('OTP CODE:', code);
  if (code) {
    const codeInput = page.locator('input').first();
    await codeInput.fill(code);
    await page.screenshot({ path: `${OUT}/rider-live2-04-code-entered.png` });
    const verifyBtn = page.getByRole('button', { name: /verify|confirm|continue|sign in/i }).first();
    await verifyBtn.click();
    await page.waitForTimeout(2500);
  }
  await page.screenshot({ path: `${OUT}/rider-live2-05-home.png`, fullPage: true });

  console.log('URL after login:', page.url());
  console.log('BODY SNIPPET:', (await page.locator('body').innerText()).slice(0, 800));

  // Navigate to Availability
  await page.getByText('Availability — go online / offline', { exact: false }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/rider-live2-06-availability-offline.png` });

  // Toggle the switch to go online — this now reports a GPS fix first (Playwright geolocation
  // context above supplies it), unblocking what was previously a permanent 422.
  const toggle = page.getByRole('switch').first().or(page.locator('[role="switch"]').first());
  await toggle.click({ force: true }).catch(async () => {
    // Fallback: some RN-web switches render as a pressable View without role=switch.
    await page.getByText('Available for deliveries').click();
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/rider-live2-07-availability-online-attempt.png` });
  console.log('AVAILABILITY BODY:', (await page.locator('body').innerText()).slice(0, 1000));

  // Current offer (empty state, unless dispatch happened to land one on this account). The app
  // hand-rolls its own nav stack (no URL routing) — use its in-app back affordance, not the
  // browser's.
  try {
    await page.getByText('View current offer', { exact: false }).click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/rider-live2-08-offer.png` });
    console.log('OFFER BODY:', (await page.locator('body').innerText()).slice(0, 400));
  } catch (e) {
    console.log('offer nav step skipped:', e.message);
  }

  await browser.close();
  console.log('FAILED_NETWORK:', JSON.stringify(failed, null, 2));
})();
