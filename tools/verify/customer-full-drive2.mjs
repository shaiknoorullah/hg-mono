// Phase 2: address setup -> checkout -> place order -> tracking -> orders/profile/addresses/alerts.
// Reuses the same session cookie/localStorage by staying in one browser context from login.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { VERIFY_OUT } from './env.mjs';

const APP = 'http://localhost:19006';
const PHONE = '+14165552244';
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

const log = (...a) => console.log('[qa2]', ...a);
const shot = async (name) => { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); log('screenshot', name); };

try {
  await page.goto(APP, { waitUntil: 'load' });
  await page.waitForTimeout(7000);

  const phoneInput = page.locator('input').first();
  await phoneInput.waitFor({ timeout: 30000 });
  await phoneInput.fill(PHONE);
  const otpReqP = page.waitForResponse((r) => r.url().includes('/v1/auth/otp/request'), { timeout: 20000 });
  await page.getByText('Send code', { exact: false }).click();
  await otpReqP.catch(() => null);
  await page.waitForTimeout(2000);
  const code = readOtpForPhone(PHONE);
  log('otp code:', code);
  if (!code) throw new Error('no OTP for ' + PHONE);
  const codeInput = page.locator('input').first();
  await codeInput.fill(code);
  await page.getByText('Verify', { exact: false }).click();
  await page.waitForResponse((r) => r.url().includes('/v1/auth/otp/verify'), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);

  log('=== PHASE: set address from discovery ===');
  const setAddr = page.getByText(/set your address/i).first();
  if (await setAddr.count()) {
    await setAddr.click().catch(() => {});
    await page.waitForTimeout(1500);
    await shot('fd2-01-address-form');
    const bodyText = await page.evaluate(() => document.body.innerText);
    log('address form sample:', JSON.stringify(bodyText.slice(0, 400)));

    // fill any visible text inputs (line1, city, postal, etc.)
    const inputs = page.locator('input');
    const n = await inputs.count();
    log('address form input count:', n);
    const sample = { line1: '123 Queen St W', city: 'Toronto', province: 'ON', postal: 'M5H 2M9', label: 'Home' };
    const values = Object.values(sample);
    for (let i = 0; i < n; i++) {
      const el = inputs.nth(i);
      const ph = (await el.getAttribute('placeholder')) || '';
      let val = values[i % values.length];
      if (/postal|zip/i.test(ph)) val = sample.postal;
      else if (/city/i.test(ph)) val = sample.city;
      else if (/prov|state/i.test(ph)) val = sample.province;
      else if (/label|name/i.test(ph)) val = sample.label;
      else if (/address|street|line/i.test(ph)) val = sample.line1;
      await el.fill(val).catch(() => {});
    }
    await shot('fd2-02-address-filled');

    const saveBtn = page.getByText(/save|add address|continue|confirm/i).first();
    if (await saveBtn.count()) {
      await saveBtn.click().catch(() => {});
      await page.waitForTimeout(2500);
      await shot('fd2-03-address-saved');
    } else {
      log('WARNING: no save/confirm button found on address form');
    }
  } else {
    log('WARNING: "Set your address" link not found on discovery');
  }

  log('=== PHASE: re-open restaurant, add item, checkout ===');
  const resto = page.getByText('Karachi Kitchen', { exact: false }).first();
  if (await resto.count()) {
    await resto.click().catch(() => {});
    await page.waitForTimeout(2000);
    const addBtn = page.getByLabel(/^Add /).first();
    if (await addBtn.count()) {
      await addBtn.click();
      await page.waitForResponse((r) => r.url().includes('/v1/cart/lines'), { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }
    const toast = page.locator('[data-testid="Toast"]').first();
    for (let i = 0; i < 5 && (await toast.count()); i++) {
      const x = toast.getByText('✕').first();
      if (await x.count()) await x.click({ force: true }).catch(() => {});
      await page.waitForTimeout(600);
    }
    const viewCart = page.getByText(/View cart/i).first();
    if (await viewCart.count()) {
      await viewCart.click({ position: { x: 20, y: 5 } }).catch(() => viewCart.click({ force: true }));
      await page.waitForTimeout(2000);
      await shot('fd2-04-cart-with-address');
      const bodyText = await page.evaluate(() => document.body.innerText);
      log('cart w/ address sample:', JSON.stringify(bodyText.slice(0, 500)));

      const checkout = page.getByText(/Continue to checkout|Checkout/i).first();
      if (await checkout.count()) {
        await checkout.click();
        await page.waitForResponse((r) => r.url().includes('/v1/quotes') && r.request().method() === 'POST', { timeout: 25000 }).catch((e) => log('quote wait failed:', e.message));
        await page.waitForTimeout(2500);
        await shot('fd2-05-checkout');
        const ct = await page.evaluate(() => document.body.innerText);
        log('checkout sample:', JSON.stringify(ct.slice(0, 600)));

        const place = page.getByText(/Place order/i).first();
        if (await place.count()) {
          await place.click();
          await page.waitForResponse((r) => r.url().includes('/v1/orders') && r.request().method() === 'POST', { timeout: 25000 }).catch((e) => log('order wait failed:', e.message));
          await page.waitForTimeout(3000);
          await shot('fd2-06-tracking');
          const tt = await page.evaluate(() => document.body.innerText);
          log('tracking sample:', JSON.stringify(tt.slice(0, 600)));
        } else {
          log('WARNING: still no Place order button');
        }
      } else {
        log('WARNING: still no Checkout button');
      }
    }
  } else {
    log('WARNING: restaurant not found for re-open');
  }

  // ---- Orders / Profile / Addresses / Alerts ----
  for (const [tabText, shotName] of [['Orders', 'fd2-07-orders'], ['Profile', 'fd2-08-profile'], ['Alerts', 'fd2-09-alerts']]) {
    const tab = page.getByText(tabText, { exact: true }).first();
    if (await tab.count()) {
      log(`=== PHASE: ${tabText} tab ===`);
      await tab.click().catch(() => {});
      await page.waitForTimeout(2000);
      const t = await page.evaluate(() => document.body.innerText);
      log(`${tabText} sample:`, JSON.stringify(t.slice(0, 400)));
      await shot(shotName);
    } else {
      log(`WARNING: ${tabText} tab not found`);
    }
  }

  log('=== PHASE: addresses from profile ===');
  const addrLink = page.getByText(/addresses/i).first();
  if (await addrLink.count()) {
    await addrLink.click().catch(() => {});
    await page.waitForTimeout(2000);
    await shot('fd2-10-addresses-list');
    const t = await page.evaluate(() => document.body.innerText);
    log('addresses list sample:', JSON.stringify(t.slice(0, 400)));
  } else {
    log('WARNING: no Addresses link found from Profile');
  }

  log('=== PHASE: reorder from orders history ===');
  const ordersTab = page.getByText('Orders', { exact: true }).first();
  if (await ordersTab.count()) {
    await ordersTab.click().catch(() => {});
    await page.waitForTimeout(2000);
    const reorder = page.getByText(/reorder/i).first();
    if (await reorder.count()) {
      await reorder.click().catch(() => {});
      await page.waitForTimeout(2000);
      await shot('fd2-11-reorder');
    } else {
      log('WARNING: no reorder control (may be no delivered orders yet)');
    }
  }

} catch (e) {
  log('FATAL:', e.message);
  await shot('fd2-99-fatal-state');
} finally {
  await browser.close();
}

console.log('\n=== backend calls (:8080) ===');
console.log(calls.join('\n'));
console.log('\n=== failed/4xx/5xx network ===');
console.log(failedNet.length ? failedNet.join('\n') : '  (none)');
console.log('\n=== console errors ===');
console.log(errors.length ? errors.join('\n') : '  (none)');
