import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const APP = 'http://localhost:19006';
const PHONE = '+14165552255';
const OUT = '/home/devsupreme/work/hg-mono/tools/verify';

function readOtpForPhone(phone) {
  const txt = execSync('docker logs hg-api-1 --tail 1000', { encoding: 'utf8' }) +
              execSync('docker logs hg-api-2 --tail 1000', { encoding: 'utf8' });
  const lines = txt.split('\n').filter((l) => l.includes(phone) && /"code":"\d{4,8}"/.test(l));
  if (!lines.length) return null;
  const m = lines[lines.length - 1].match(/"code":"(\d{4,8})"/);
  return m ? m[1] : null;
}

const calls = [], errors = [], failedNet = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('requestfailed', (r) => failedNet.push(`FAILED ${r.method()} ${r.url()}`));
page.on('response', (r) => { if (r.url().includes(':8080/')) { calls.push(`${r.status()} ${r.request().method()} ${r.url().replace('http://localhost:8080','')}`); if (r.status()>=400) failedNet.push(`${r.status()} ${r.request().method()} ${r.url()}`); } });
const log = (...a) => console.log('[pa]', ...a);
const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); log('shot', n); };

try {
  await page.goto(APP, { waitUntil: 'load' });
  await page.waitForTimeout(7000);
  await page.locator('input').first().fill(PHONE);
  const p1 = page.waitForResponse(r => r.url().includes('/otp/request'));
  await page.getByText('Send code', { exact: false }).click();
  await p1.catch(()=>{});
  await page.waitForTimeout(2000);
  const code = readOtpForPhone(PHONE);
  log('code', code);
  await page.locator('input').first().fill(code);
  await page.getByText('Verify', { exact: false }).click();
  await page.waitForResponse(r => r.url().includes('/otp/verify')).catch(()=>{});
  await page.waitForTimeout(2500);
  await shot('pa-01-home');

  // click Profile tab bar item (bottom nav)
  const profileTab = page.getByText('Profile', { exact: true }).last();
  await profileTab.waitFor({ timeout: 10000 });
  await profileTab.click();
  await page.waitForTimeout(2000);
  await shot('pa-02-profile');
  let t = await page.evaluate(() => document.body.innerText);
  log('profile text:', JSON.stringify(t.slice(0, 500)));

  const addrEntry = page.getByText(/address/i).first();
  if (await addrEntry.count()) {
    await addrEntry.click().catch(()=>{});
    await page.waitForTimeout(2000);
    await shot('pa-03-addresses');
    t = await page.evaluate(() => document.body.innerText);
    log('addresses text:', JSON.stringify(t.slice(0, 500)));

    const addNew = page.getByText(/add address|add new|\+ add/i).first();
    if (await addNew.count()) {
      await addNew.click().catch(()=>{});
      await page.waitForTimeout(1500);
      await shot('pa-04-address-form');
      t = await page.evaluate(() => document.body.innerText);
      log('address form text:', JSON.stringify(t.slice(0, 500)));
      const inputs = page.locator('input');
      const n = await inputs.count();
      log('input count', n);
      for (let i=0;i<n;i++){ await inputs.nth(i).fill('Test value ' + i).catch(()=>{}); }
      await shot('pa-05-address-form-filled');
    } else {
      log('WARNING: no add-address control found');
    }
  } else {
    log('WARNING: no address entry point on profile');
  }

  // Alerts / notifications
  const alerts = page.getByText('Alerts', { exact: true }).first();
  if (await alerts.count()) {
    await alerts.click().catch(()=>{});
    await page.waitForTimeout(2000);
    await shot('pa-06-alerts');
    t = await page.evaluate(() => document.body.innerText);
    log('alerts text:', JSON.stringify(t.slice(0, 400)));
  }
} catch(e) {
  log('FATAL', e.message);
  await shot('pa-99-fatal');
} finally {
  await browser.close();
}
console.log('\n=== calls ===\n' + calls.join('\n'));
console.log('\n=== failed ===\n' + (failedNet.join('\n') || '(none)'));
console.log('\n=== errors ===\n' + (errors.join('\n') || '(none)'));
