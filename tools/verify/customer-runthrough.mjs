// Drives the customer web app end-to-end against the live backend, screenshotting each step.
// Run: node tools/verify/customer-runthrough.mjs
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:19006';
const OUT = 'tools/verify';

function otpCodeFor(phone) {
  for (const c of ['hg-api-1', 'hg-api-2']) {
    try {
      const log = execSync(`docker logs ${c} --since 3m 2>&1`, { encoding: 'utf8' });
      const lines = log.split('\n').filter((l) => l.includes(phone) && l.includes('"code"'));
      if (lines.length) {
        const last = lines[lines.length - 1];
        const m = last.match(/"code":"(\d+)"/);
        if (m) return m[1];
      }
    } catch {}
  }
  throw new Error('OTP code not found in logs for ' + phone);
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log('shot:', name);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));

  const phone = '+1416555' + String(Math.floor(1000 + Math.random() * 8999));
  console.log('phone', phone);

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await shot(page, 'rt-01-login-empty');

  // Phone entry
  const phoneInput = page.locator('input').first();
  await phoneInput.fill(phone);
  await page.getByRole('button', { name: /send code/i }).click();
  await page.waitForTimeout(1500);
  await shot(page, 'rt-02-otp-sent');

  const code = otpCodeFor(phone);
  console.log('code', code);
  const codeInput = page.locator('input').first();
  await codeInput.fill(code);
  await page.getByRole('button', { name: /verify/i }).click();
  await page.waitForTimeout(2000);
  await shot(page, 'rt-03-post-login-discover');

  // Discover home
  await page.waitForTimeout(1500);
  await shot(page, 'rt-04-discovery-home');

  // Click "Set your address" if present (fix under test)
  const setAddr = page.getByText('Set your address', { exact: true }).first();
  if (await setAddr.count()) {
    await setAddr.click();
    await page.waitForTimeout(1500);
    await shot(page, 'rt-05-address-form-from-discover');
    const url = page.url();
    console.log('after set-your-address click, url/body check');
    const hasAddressForm = await page.getByText(/Add address|Edit address/i).count();
    console.log('addressFormVisible:', hasAddressForm > 0);
  } else {
    console.log('No "Set your address" prompt visible (address may already be set) — skipping.');
  }

  // Fill minimal address form if we're on it
  if (await page.getByText(/Add address/i).count()) {
    // Field order on screen: Label, Street address, Unit/apt, Buzzer code, City,
    // Province(select — not a text input), Postal code, Delivery notes.
    const inputs = page.locator('input[type="text"], input:not([type])');
    const n = await inputs.count();
    console.log('address form input count', n);
    if (n > 0) await inputs.nth(0).fill('Home');
    if (n > 1) await inputs.nth(1).fill('123 Queen St W');
    if (n > 4) await inputs.nth(4).fill('Toronto');
    if (n > 5) await inputs.nth(5).fill('M5H 2N2');
    // Must be the default address, or the discovery/cart availability computation
    // stays NO_ADDRESS even with a saved row.
    const anySwitch = page.locator('[role="switch"]');
    console.log('switch count', await anySwitch.count());
    if (await anySwitch.count()) {
      await anySwitch.first().click();
    }
    await shot(page, 'rt-06-address-form-filled');
    const saveBtn = page.getByRole('button', { name: /save|add address|done/i }).first();
    if (await saveBtn.count()) {
      await saveBtn.click();
      await page.waitForTimeout(1500);
      await shot(page, 'rt-07-after-address-save');
    }
  }

  // Go to Profile tab — the P0 bug under test
  const profileTab = page.getByText('Profile', { exact: true }).first();
  if (await profileTab.count()) {
    await profileTab.click();
    await page.waitForTimeout(1500);
    await shot(page, 'rt-08-profile-tab');
    const notFound = await page.getByText(/we could not find that/i).count();
    console.log('profile-shows-not-found-error:', notFound > 0);
  }

  // Back to Discover, open a restaurant, add to cart, view cart
  const discoverTab = page.getByText('Discover', { exact: true }).first();
  if (await discoverTab.count()) {
    await discoverTab.click();
    await page.waitForTimeout(1500);
  }
  const card = page.locator('text=Karachi Kitchen').first();
  if (await card.count()) {
    await card.click();
    await page.waitForTimeout(1500);
    await shot(page, 'rt-09-restaurant-detail');
    const addBtn = page.getByRole('button', { name: /add/i }).first();
    if (await addBtn.count()) {
      await addBtn.click();
      await page.waitForTimeout(1000);
      await shot(page, 'rt-10-added-to-cart');
    }
    const toastClose = page.getByTestId('Toast').getByRole('button').first();
    if (await toastClose.count()) {
      await toastClose.click().catch(() => {});
      await page.waitForTimeout(500);
    }
    const viewCart = page.getByText(/view cart/i).first();
    if (await viewCart.count()) {
      await viewCart.click();
      await page.waitForTimeout(1500);
      await shot(page, 'rt-11-cart');
      const blocked = await page.getByText(/not ready to check out/i).count();
      console.log('cart-blocked-on-address:', blocked > 0);
      const continueBtn = page.getByRole('button', { name: /continue/i }).first();
      if (await continueBtn.count() && !(blocked > 0)) {
        await continueBtn.click();
        await page.waitForTimeout(1500);
        await shot(page, 'rt-12-checkout');
        const placeBtn = page.getByRole('button', { name: /place order/i }).first();
        if (await placeBtn.count()) {
          await placeBtn.click();
          await page.waitForTimeout(2500);
          await shot(page, 'rt-13-post-place-order');
        }
      }
    }
  }

  console.log('CONSOLE_ERRORS_JSON=' + JSON.stringify(errors.slice(0, 20)));
  await browser.close();
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
