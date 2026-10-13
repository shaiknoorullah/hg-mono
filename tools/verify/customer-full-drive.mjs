// Full customer-app QA drive against the REAL backend (:8080) via Expo-web (:8090).
// Covers: OTP login -> discovery -> restaurant detail + halal panel -> cart -> checkout ->
// tracking -> order history/reorder -> profile -> addresses -> notifications.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { VERIFY_OUT } from './env.mjs';

const APP = 'http://localhost:19006';
const PHONE = '+14165552233';
const OUT = VERIFY_OUT;

const calls = [];
const errors = [];
const failedNet = [];

function readOtpForPhone(phone) {
  const txt = execSync('docker logs hg-api-1 --tail 1000', { encoding: 'utf8' }) +
              execSync('docker logs hg-api-2 --tail 1000', { encoding: 'utf8' });
  const lines = txt.split('\n').filter((l) => l.includes(phone) && /"code":"\d{4,8}"/.test(l));
  if (!lines.length) return null;
  const m = lines[lines.length - 1].match(/"code":"(\d{4,8})"/);
  return m ? m[1] : null;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('requestfailed', (r) => failedNet.push(`FAILED ${r.method()} ${r.url()} - ${r.failure()?.errorText}`));
page.on('response', (r) => {
  if (r.url().includes(':8080/')) {
    calls.push(`${r.status()} ${r.request().method()} ${r.url().replace('http://localhost:8080', '')}`);
    if (r.status() >= 400) failedNet.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  }
});

const log = (...a) => console.log('[qa]', ...a);
const shot = async (name) => { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); log('screenshot', name); };

try {
  await page.goto(APP, { waitUntil: 'load' });
  await page.waitForTimeout(8000);

  log('=== PHASE: login gate ===');
  const phoneInput = page.locator('input').first();
  await phoneInput.waitFor({ timeout: 30000 });
  await shot('fd-01-login-empty');
  await phoneInput.fill(PHONE);
  const otpReqP = page.waitForResponse((r) => r.url().includes('/v1/auth/otp/request'), { timeout: 20000 });
  await page.getByText('Send code', { exact: false }).click();
  const otpResp = await otpReqP.catch(() => null);
  if (otpResp) log('otp/request status:', otpResp.status());
  await page.waitForTimeout(2000);
  await shot('fd-02-otp-sent');
  const code = readOtpForPhone(PHONE);
  log('otp code from docker logs:', code);
  if (!code) throw new Error('no OTP code found for ' + PHONE);

  const codeInput = page.locator('input').first();
  await codeInput.fill(code);
  await page.getByText('Verify', { exact: false }).click();
  await page.waitForResponse((r) => r.url().includes('/v1/auth/otp/verify'), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await shot('fd-03-post-login');

  log('=== PHASE: discovery/home ===');
  await page.waitForResponse((r) => /\/v1\/restaurants(\?|$)/.test(r.url()), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);
  let bodyText = await page.evaluate(() => document.body.innerText);
  log('discovery sample:', JSON.stringify(bodyText.slice(0, 400)));
  await shot('fd-04-discovery-home');

  log('=== PHASE: restaurant detail + halal panel ===');
  let opened = false;
  for (const name of ['Karachi Kitchen', 'Kitchen', 'Restaurant', 'Halal', 'Biryani', 'Grill']) {
    const el = page.getByText(name, { exact: false }).first();
    if (await el.count()) { await el.click().catch(() => {}); opened = true; break; }
  }
  await page.waitForTimeout(2500);
  bodyText = await page.evaluate(() => document.body.innerText);
  log('after resto click sample:', JSON.stringify(bodyText.slice(0, 600)));
  await shot('fd-05-restaurant-detail');
  log('restaurant detail opened:', opened);

  // Try to reveal the halal certification panel explicitly (often a tappable badge/seal).
  const halalTrigger = page.getByText(/halal certif|verified|certification/i).first();
  if (await halalTrigger.count()) {
    await halalTrigger.click().catch(() => {});
    await page.waitForTimeout(1200);
    await shot('fd-05b-halal-panel');
  } else {
    log('WARNING: no halal certification trigger text found on restaurant detail');
  }

  log('=== PHASE: add to cart ===');
  const addBtn = page.getByLabel(/^Add /).first();
  let addedToCart = false;
  if (await addBtn.count()) {
    await addBtn.click();
    await page.waitForResponse((r) => r.url().includes('/v1/cart/lines') && r.request().method() === 'POST', { timeout: 20000 }).catch(() => {});
    addedToCart = true;
  } else {
    log('WARNING: no "Add {item}" control found on restaurant detail');
  }
  await page.waitForTimeout(1500);
  await shot('fd-06-added-to-cart');

  if (addedToCart) {
    const toast = page.locator('[data-testid="Toast"]').first();
    for (let i = 0; i < 5 && (await toast.count()); i++) {
      const x = toast.getByText('✕').first();
      if (await x.count()) await x.click({ force: true }).catch(() => {});
      await page.waitForTimeout(600);
    }
    log('=== PHASE: cart ===');
    const viewCart = page.getByText(/View cart/i).first();
    if (await viewCart.count()) {
      await viewCart.click({ position: { x: 20, y: 5 } }).catch(() => viewCart.click({ force: true }));
      await page.waitForResponse((r) => /\/v1\/cart(\?|$)/.test(r.url()), { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(2000);
      bodyText = await page.evaluate(() => document.body.innerText);
      log('cart sample:', JSON.stringify(bodyText.slice(0, 400)));
      await shot('fd-07-cart');

      log('=== PHASE: checkout ===');
      const checkout = page.getByText(/Continue to checkout|Checkout/i).first();
      if (await checkout.count()) {
        await checkout.click();
        await page.waitForResponse((r) => r.url().includes('/v1/quotes') && r.request().method() === 'POST', { timeout: 25000 }).catch(() => {});
        await page.waitForTimeout(2500);
        bodyText = await page.evaluate(() => document.body.innerText);
        log('checkout sample:', JSON.stringify(bodyText.slice(0, 500)));
        await shot('fd-08-checkout');

        const place = page.getByText(/Place order/i).first();
        if (await place.count()) {
          await place.click();
          await page.waitForResponse((r) => r.url().includes('/v1/orders') && r.request().method() === 'POST', { timeout: 25000 }).catch(() => {});
          await page.waitForTimeout(3000);
          log('=== PHASE: tracking ===');
          bodyText = await page.evaluate(() => document.body.innerText);
          log('tracking sample:', JSON.stringify(bodyText.slice(0, 600)));
          await shot('fd-09-tracking');
        } else {
          log('WARNING: no Place order button found');
        }
      } else {
        log('WARNING: no Checkout button found in cart');
      }
    } else {
      log('WARNING: no View cart bar found');
    }
  }

  // ---- Orders tab / history / reorder ----
  log('=== PHASE: Orders tab ===');
  const ordersTab = page.getByText('Orders', { exact: false }).first();
  if (await ordersTab.count()) {
    await ordersTab.click().catch(() => {});
    await page.waitForTimeout(2000);
    bodyText = await page.evaluate(() => document.body.innerText);
    log('orders sample:', JSON.stringify(bodyText.slice(0, 500)));
    await shot('fd-10-orders');

    const reorder = page.getByText(/reorder/i).first();
    if (await reorder.count()) {
      await reorder.click().catch(() => {});
      await page.waitForTimeout(2000);
      await shot('fd-10b-reorder');
      log('reorder control found and clicked');
    } else {
      log('WARNING: no Reorder control found in Orders tab');
    }
  } else {
    log('WARNING: no Orders tab found');
  }

  // ---- Profile ----
  log('=== PHASE: Profile tab ===');
  const profileTab = page.getByText('Profile', { exact: false }).first();
  if (await profileTab.count()) {
    await profileTab.click().catch(() => {});
    await page.waitForTimeout(2000);
    bodyText = await page.evaluate(() => document.body.innerText);
    log('profile sample:', JSON.stringify(bodyText.slice(0, 500)));
    await shot('fd-11-profile');
  } else {
    log('WARNING: no Profile tab found');
  }

  // ---- Addresses (likely nested under Profile) ----
  log('=== PHASE: Addresses ===');
  const addressesLink = page.getByText(/addresses/i).first();
  if (await addressesLink.count()) {
    await addressesLink.click().catch(() => {});
    await page.waitForTimeout(2000);
    bodyText = await page.evaluate(() => document.body.innerText);
    log('addresses sample:', JSON.stringify(bodyText.slice(0, 400)));
    await shot('fd-12-addresses');
  } else {
    log('WARNING: no Addresses entry point found from Profile');
  }

  // ---- Notifications / Alerts ----
  log('=== PHASE: Notifications/Alerts tab ===');
  const alertsTab = page.getByText('Alerts', { exact: false }).first();
  if (await alertsTab.count()) {
    await alertsTab.click().catch(() => {});
    await page.waitForTimeout(2000);
    bodyText = await page.evaluate(() => document.body.innerText);
    log('alerts sample:', JSON.stringify(bodyText.slice(0, 400)));
    await shot('fd-13-notifications');
  } else {
    log('WARNING: no Alerts/Notifications tab found');
  }

} catch (e) {
  log('FATAL:', e.message);
  await shot('fd-99-fatal-state');
} finally {
  await browser.close();
}

console.log('\n=== backend calls (:8080) ===');
console.log(calls.join('\n'));
console.log('\n=== failed/4xx/5xx network ===');
console.log(failedNet.length ? failedNet.join('\n') : '  (none)');
console.log('\n=== console errors ===');
console.log(errors.length ? errors.join('\n') : '  (none)');
