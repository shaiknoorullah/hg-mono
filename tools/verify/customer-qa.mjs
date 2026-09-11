// Fresh customer-app QA loop against the REAL backend (:8080) via Expo-web (:8082).
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const APP = 'http://localhost:19006';
const PHONE = '+14165559876';
const OUT = '/home/devsupreme/work/hg-mono/tools/verify';

const calls = [];
const errors = [];
const failedNet = [];

function readOtpForPhone(phone) {
  const txt = execSync('docker logs hg-api-1 --tail 500', { encoding: 'utf8' }) +
              execSync('docker logs hg-api-2 --tail 500', { encoding: 'utf8' });
  const lines = txt.split('\n').filter((l) => l.includes(phone) && /"code":"\d{4,8}"/.test(l));
  if (!lines.length) return null;
  const m = lines[lines.length - 1].match(/"code":"(\d{4,8})"/);
  return m ? m[1] : null;
}

const browser = await chromium.launch();
const page = await browser.newPage();
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
  await shot('qa-01-login-empty');
  await phoneInput.fill(PHONE);
  const otpReqP = page.waitForResponse((r) => r.url().includes('/v1/auth/otp/request'), { timeout: 20000 });
  await page.getByText('Send code', { exact: false }).click();
  const otpResp = await otpReqP.catch(() => null);
  if (otpResp) log('otp/request status:', otpResp.status());
  await page.waitForTimeout(2000);
  await shot('qa-02-otp-sent');
  const code = readOtpForPhone(PHONE);
  log('otp code from docker logs:', code);
  if (!code) throw new Error('no OTP code found for ' + PHONE);

  const codeInput = page.locator('input').first();
  await codeInput.fill(code);
  await page.getByText('Verify', { exact: false }).click();
  await page.waitForResponse((r) => r.url().includes('/v1/auth/otp/verify'), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await shot('qa-03-post-login');

  log('=== PHASE: discovery/home ===');
  await page.waitForResponse((r) => /\/v1\/restaurants(\?|$)/.test(r.url()), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);
  let bodyText = await page.evaluate(() => document.body.innerText);
  log('discovery sample:', JSON.stringify(bodyText.slice(0, 300)));
  await shot('qa-04-discovery-home');

  log('=== PHASE: restaurant detail ===');
  const cards = page.locator('[role="button"], a, div').filter({ hasText: /./ });
  // Click the first restaurant-looking element via generic text search across known names,
  // fallback to first tappable card.
  let opened = false;
  for (const name of ['Karachi Kitchen', 'Kitchen', 'Restaurant', 'Halal']) {
    const el = page.getByText(name, { exact: false }).first();
    if (await el.count()) { await el.click().catch(() => {}); opened = true; break; }
  }
  await page.waitForTimeout(2500);
  bodyText = await page.evaluate(() => document.body.innerText);
  log('after resto click sample:', JSON.stringify(bodyText.slice(0, 400)));
  await shot('qa-05-restaurant-detail');

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
  await shot('qa-06-added-to-cart');

  if (addedToCart) {
    // dismiss any toast
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
      await shot('qa-07-cart');

      log('=== PHASE: checkout ===');
      const checkout = page.getByText(/Continue to checkout|Checkout/i).first();
      if (await checkout.count()) {
        await checkout.click();
        await page.waitForResponse((r) => r.url().includes('/v1/quotes') && r.request().method() === 'POST', { timeout: 25000 }).catch(() => {});
        await page.waitForTimeout(2500);
        bodyText = await page.evaluate(() => document.body.innerText);
        log('checkout sample:', JSON.stringify(bodyText.slice(0, 400)));
        await shot('qa-08-checkout');

        const place = page.getByText(/Place order/i).first();
        if (await place.count()) {
          await place.click();
          await page.waitForResponse((r) => r.url().includes('/v1/orders') && r.request().method() === 'POST', { timeout: 25000 }).catch(() => {});
          await page.waitForTimeout(3000);
          log('=== PHASE: tracking ===');
          bodyText = await page.evaluate(() => document.body.innerText);
          log('tracking sample:', JSON.stringify(bodyText.slice(0, 500)));
          await shot('qa-09-tracking');
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

  // ---- Extra surfaces: order history, profile, addresses, notifications ----
  for (const [tabName, shotName] of [
    ['Orders', 'qa-10-orders'], ['History', 'qa-10-orders'],
    ['Profile', 'qa-11-profile'], ['Account', 'qa-11-profile'],
    ['Addresses', 'qa-12-addresses'],
    ['Notifications', 'qa-13-notifications'],
  ]) {
    const tab = page.getByText(tabName, { exact: false }).first();
    if (await tab.count()) {
      log(`=== PHASE: ${tabName} ===`);
      await tab.click().catch(() => {});
      await page.waitForTimeout(2000);
      const t = await page.evaluate(() => document.body.innerText);
      log(`${tabName} sample:`, JSON.stringify(t.slice(0, 300)));
      await shot(shotName);
    }
  }

} catch (e) {
  log('FATAL:', e.message);
  await shot('qa-99-fatal-state');
} finally {
  await browser.close();
}

console.log('\n=== backend calls (:8080) ===');
console.log(calls.join('\n'));
console.log('\n=== failed/4xx/5xx network ===');
console.log(failedNet.length ? failedNet.join('\n') : '  (none)');
console.log('\n=== console errors ===');
console.log(errors.length ? errors.join('\n') : '  (none)');
