// Rider app live-driven QA: OTP login -> home -> availability -> offer -> assignment -> POD.
// Driven through the Expo-web build on :8083 against the REAL backend on :8080.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const APP = 'http://localhost:8083';
const PHONE = '+14165550188';

const calls = [];
const errors = [];

function readOtpFromDockerLogs(phone) {
  const out = execSync(
    `docker logs hg-api-1 --since 5m 2>&1; docker logs hg-api-2 --since 5m 2>&1`,
    { maxBuffer: 20 * 1024 * 1024 },
  ).toString();
  const lines = out
    .split('\n')
    .filter((l) => l.includes(phone) && /"code":"\d{4,6}"/.test(l));
  if (!lines.length) return null;
  const m = lines[lines.length - 1].match(/"code":"(\d{4,6})"/);
  return m ? m[1] : null;
}

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('requestfailed', (r) => errors.push(`REQUEST FAILED: ${r.method()} ${r.url()} - ${r.failure()?.errorText}`));
page.on('response', (r) => {
  if (r.url().includes(':8080/'))
    calls.push(`${r.status()} ${r.request().method()} ${r.url().replace('http://localhost:8080', '')}`);
});

const log = (...a) => console.log('[verify]', ...a);
const shot = (name) => page.screenshot({ path: `tools/verify/${name}.png`, fullPage: true });

// Go back to home via the AppBar back affordance (icon chevron, no visible text label).
// Token is held in memory only (no reload allowed) so this is the only way back.
async function backToHome() {
  const byLabel = page.getByLabel(/back/i).first();
  if (await byLabel.count()) { await byLabel.click().catch(() => {}); await page.waitForTimeout(1000); return; }
  await page.mouse.click(32, 28);
  await page.waitForTimeout(1000);
}

await page.goto(APP, { waitUntil: 'load' });
await page.waitForTimeout(8000);
await shot('rider-live-01-login');
log('body:', JSON.stringify((await page.evaluate(() => document.body.innerText)).slice(0, 200)));

// ---- Login ----
const phoneInput = page.locator('input').first();
await phoneInput.waitFor({ timeout: 30000 });
await phoneInput.fill(PHONE);
const otpReqP = page.waitForResponse((r) => r.url().includes('/v1/auth/otp/request'), { timeout: 20000 });
await page.getByText('Send code', { exact: false }).click();
const otpResp = await otpReqP.catch((e) => { errors.push('otp/request: ' + e.message); return null; });
if (otpResp) log('otp/request status:', otpResp.status(), await otpResp.text().catch(() => ''));
await page.waitForTimeout(2000);
await shot('rider-live-02-code');

const code = readOtpFromDockerLogs(PHONE);
log('otp code from backend log:', code);
if (!code) throw new Error('No OTP code found in backend logs for ' + PHONE);

const codeInput = page.locator('input').first();
await codeInput.fill(code);
const verifyP = page.waitForResponse((r) => r.url().includes('/v1/auth/otp/verify'), { timeout: 20000 });
await page.getByText('Verify', { exact: false }).click();
const verifyResp = await verifyP.catch((e) => { errors.push('otp/verify: ' + e.message); return null; });
if (verifyResp) log('otp/verify status:', verifyResp.status(), (await verifyResp.text().catch(() => '')).slice(0, 300));
await page.waitForTimeout(2500);

// ---- Home ----
log('phase: home');
await shot('rider-live-03-home');
let bodyText = await page.evaluate(() => document.body.innerText);
log('home text:', JSON.stringify(bodyText.slice(0, 400)));

// ---- Availability: go online ----
log('phase: availability');
await page.getByText(/Availability.*go online/i).first().click();
await page.waitForResponse((r) => r.url().includes('/v1/riders/me/dashboard'), { timeout: 15000 }).catch((e) => errors.push('dashboard: ' + e.message));
await page.waitForTimeout(1500);
await shot('rider-live-04-availability');
bodyText = await page.evaluate(() => document.body.innerText);
log('availability text:', JSON.stringify(bodyText.slice(0, 400)));

const sw = page.locator('[role="switch"], [data-testid="Switch"]').first();
if (await sw.count()) {
  const toggleP = page.waitForResponse((r) => r.url().includes('/availability') && r.request().method() === 'PUT', { timeout: 15000 }).catch((e) => { errors.push('availability PUT: ' + e.message); return null; });
  await sw.click();
  const toggleResp = await toggleP;
  if (toggleResp) log('availability PUT status:', toggleResp.status(), (await toggleResp.text().catch(() => '')).slice(0, 300));
  await page.waitForTimeout(1500);
} else {
  log('WARNING: no switch control found on availability screen');
}
await shot('rider-live-05-availability-toggled');
bodyText = await page.evaluate(() => document.body.innerText);
log('availability after toggle:', JSON.stringify(bodyText.slice(0, 400)));

// back to home (in-app back affordance; token is memory-only, no reload)
await backToHome();
await shot('rider-live-05b-after-back');
log('after-back body:', JSON.stringify((await page.evaluate(() => document.body.innerText)).slice(0, 300)));

// ---- Current offer ----
log('phase: offer');
const offerLink = page.getByText(/Current offer/i).first();
if (await offerLink.count()) {
  await offerLink.click();
  await page.waitForResponse((r) => r.url().includes('/offers/current'), { timeout: 15000 }).catch((e) => errors.push('offers/current: ' + e.message));
  await page.waitForTimeout(1500);
  await shot('rider-live-06-offer');
  bodyText = await page.evaluate(() => document.body.innerText);
  log('offer text:', JSON.stringify(bodyText.slice(0, 400)));
} else {
  log('WARNING: no "Current offer" link found on home');
}
await backToHome();

// ---- Earnings ----
log('phase: earnings');
const earnLink = page.getByText(/Earnings & payouts/i).first();
if (await earnLink.count()) {
  await earnLink.click();
  await page.waitForTimeout(2500);
  await shot('rider-live-07-earnings');
  bodyText = await page.evaluate(() => document.body.innerText);
  log('earnings text:', JSON.stringify(bodyText.slice(0, 500)));
  await backToHome();
}

// ---- Delivery history ----
log('phase: history');
const histLink = page.getByText(/Delivery history/i).first();
if (await histLink.count()) {
  await histLink.click();
  await page.waitForTimeout(2500);
  await shot('rider-live-08-history');
  bodyText = await page.evaluate(() => document.body.innerText);
  log('history text:', JSON.stringify(bodyText.slice(0, 500)));
  await backToHome();
}

// ---- Profile / documents (KYC) ----
log('phase: profile/kyc');
const profLink = page.getByText(/Profile & documents/i).first();
if (await profLink.count()) {
  await profLink.click();
  await page.waitForTimeout(2500);
  await shot('rider-live-09-profile');
  bodyText = await page.evaluate(() => document.body.innerText);
  log('profile text:', JSON.stringify(bodyText.slice(0, 500)));
  await backToHome();
}

await browser.close();

console.log('\n=== backend calls (:8080) ===');
console.log(calls.join('\n'));
console.log('\n=== console errors ===');
console.log(errors.length ? errors.join('\n') : '  (none)');
