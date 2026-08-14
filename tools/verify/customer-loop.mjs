// End-to-end customer loop against the REAL backend on :8080, driven through the
// Expo-web build on :8081. Discovery -> restaurant -> add to cart -> OTP sign-in ->
// cart (halal seal + line) -> checkout quote -> place order.
//
// The OTP code is read from the backend task log (the dev SMS sink) — grep the LAST
// line matching our phone for a "code":"NNNNNN" field.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const APP = 'http://localhost:8081';
const PHONE = '+14165551234';
const OTP_LOG =
  '/tmp/claude-1000/-home-devsupreme-work-hg-mono/7ee2a43c-6879-4ed0-93b0-1db24f5e568f/tasks/bj6jh5a0j.output';

const calls = [];
const errors = [];

function readOtpForPhone(phone) {
  const txt = readFileSync(OTP_LOG, 'utf8');
  const lines = txt.split('\n').filter((l) => l.includes(phone) && /"code":"\d{6}"/.test(l));
  if (!lines.length) return null;
  const m = lines[lines.length - 1].match(/"code":"(\d{6})"/);
  return m ? m[1] : null;
}

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', (r) => {
  if (r.url().includes(':8080/'))
    calls.push(`${r.status()} ${r.request().method()} ${r.url().replace('http://localhost:8080', '')}`);
});

const log = (...a) => console.log('[verify]', ...a);

await page.goto(APP, { waitUntil: 'load' });
// Expo-web boots the JS bundle after the shell HTML; give Metro time to bundle+run.
await page.waitForTimeout(8000);

// ---- OTP sign-in (LoginGate renders first) ---------------------------------
log('phase: login gate');
// Phone input is the only textbox on the login screen.
const phoneInput = page.locator('input').first();
await phoneInput.waitFor({ timeout: 30000 });
await phoneInput.fill(PHONE);
const otpReqP = page.waitForResponse((r) => r.url().includes('/v1/auth/otp/request'), { timeout: 20000 });
await page.getByText('Send code', { exact: false }).click();

// Wait for the OTP request to land, then read the freshly-logged code.
const otpResp = await otpReqP.catch(() => null);
if (otpResp) log('otp/request status:', otpResp.status(), await otpResp.text().catch(() => ''));
await page.waitForTimeout(2000);
await page.screenshot({ path: 'tools/verify/customer-otp-phase.png', fullPage: true });
log('after send-code body:', JSON.stringify((await page.evaluate(() => document.body.innerText)).slice(0, 200)));
const code = readOtpForPhone(PHONE);
log('otp code read from log:', code);
if (!code) throw new Error('no OTP code found in backend log for ' + PHONE);

const codeInput = page.locator('input').first();
await codeInput.fill(code);
await page.getByText('Verify', { exact: false }).click();
await page.waitForResponse((r) => r.url().includes('/v1/auth/otp/verify'), { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2500);

// ---- Discovery -------------------------------------------------------------
log('phase: discovery');
await page.waitForResponse((r) => /\/v1\/restaurants(\?|$)/.test(r.url()), { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);
let bodyText = await page.evaluate(() => document.body.innerText);
log('discovery text sample:', JSON.stringify(bodyText.slice(0, 200)));

// Open the restaurant (tap its name / card).
const resto = page.getByText('Karachi Kitchen', { exact: false }).first();
await resto.waitFor({ timeout: 20000 });
await resto.click();
await page.waitForResponse((r) => /\/v1\/restaurants\/[^/?]+\/menu/.test(r.url()), { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2000);

// ---- Restaurant menu: add an item -----------------------------------------
log('phase: restaurant menu');
bodyText = await page.evaluate(() => document.body.innerText);
log('menu text sample:', JSON.stringify(bodyText.slice(0, 300)));

// Add-to-cart control is an IconButton whose accessible name is `Add {item}`.
const addBtn = page.getByLabel(/^Add /).first();
await addBtn.waitFor({ timeout: 20000 });
await addBtn.click();
await page.waitForResponse((r) => r.url().includes('/v1/cart/lines') && r.request().method() === 'POST', { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);

// The "Added …" Toast overlays the sticky bar and intercepts pointer events. It sits at the
// bottom, over the bar; dismiss it (its ✕) and wait for the node to go away before clicking.
const toast = page.locator('[data-testid="Toast"]').first();
for (let i = 0; i < 5 && (await toast.count()); i++) {
  const x = toast.getByText('✕').first();
  if (await x.count()) await x.click({ force: true }).catch(() => {});
  await page.waitForTimeout(700);
}
await page.waitForTimeout(500);
// Go to cart via the sticky "View cart" bar. Tap high on the label to dodge any lingering overlay.
const viewCart = page.getByText(/View cart/i).first();
await viewCart.waitFor({ timeout: 20000 });
await viewCart.click({ position: { x: 20, y: 5 } }).catch(() => viewCart.click({ force: true }));
await page.waitForResponse((r) => /\/v1\/cart(\?|$)/.test(r.url()), { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2000);

// ---- Cart: halal seal + line item ------------------------------------------
log('phase: cart');
bodyText = await page.evaluate(() => document.body.innerText);
log('cart text sample:', JSON.stringify(bodyText.slice(0, 400)));
await page.screenshot({ path: 'tools/verify/customer-cart.png', fullPage: true });

// Continue to checkout.
const checkout = page.getByText(/Continue to checkout|Checkout/i).first();
await checkout.waitFor({ timeout: 20000 });
await checkout.click();
await page.waitForResponse((r) => r.url().includes('/v1/quotes') && r.request().method() === 'POST', { timeout: 25000 }).catch(() => {});
await page.waitForTimeout(2500);

// ---- Checkout: quote then place order --------------------------------------
log('phase: checkout');
bodyText = await page.evaluate(() => document.body.innerText);
log('checkout text sample:', JSON.stringify(bodyText.slice(0, 400)));
await page.screenshot({ path: 'tools/verify/customer-checkout.png', fullPage: true });

const place = page.getByText(/Place order/i).first();
await place.waitFor({ timeout: 20000 });
await place.click();
await page.waitForResponse((r) => r.url().includes('/v1/orders') && r.request().method() === 'POST', { timeout: 25000 }).catch(() => {});
await page.waitForTimeout(3000);

// ---- Tracking --------------------------------------------------------------
log('phase: tracking');
bodyText = await page.evaluate(() => document.body.innerText);
log('tracking text sample:', JSON.stringify(bodyText.slice(0, 500)));
await page.screenshot({ path: 'tools/verify/customer-tracking.png', fullPage: true });

await browser.close();

console.log('\n=== backend calls (:8080) ===');
console.log(calls.join('\n'));
console.log('\n=== console errors ===');
console.log(errors.length ? errors.join('\n') : '  (none)');
console.log('\n=== final body text ===');
console.log(bodyText.slice(0, 800));
