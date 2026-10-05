import { chromium } from 'playwright';
import { requireEnv } from './env.mjs';
const APP = 'http://localhost:5186';
const OUT = 'tools/verify';
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 1000 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(APP, { waitUntil: 'networkidle' });
await page.fill('#email', requireEnv('SEED_EMAIL'));
await page.fill('#password', requireEnv('SEED_PASSWORD'));
await page.click('button[type="submit"]');
await page.waitForResponse((r) => r.url().includes('/v1/auth/login'), { timeout: 10000 }).catch(() => {});
await page.goto(`${APP}/orders`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const sealInputs = page.locator('input[placeholder="Scan or key the seal code"]');
const count = await sealInputs.count();
console.log('seal-bind rows visible:', count);
await page.screenshot({ path: `${OUT}/seal-01-rows.png`, fullPage: true });

if (count > 0) {
  await sealInputs.first().fill('HG-SEAL-7Q2K');
  const sealBtn = page.getByRole('button', { name: 'Seal' }).first();
  await sealBtn.click();
  await page.waitForResponse((r) => r.url().includes('/handoff/seal'), { timeout: 8000 }).catch((e) => console.log('bind resp wait:', e.message));
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/seal-02-bound.png`, fullPage: true });
  const sealedText = await page.locator('text=/Sealed ·/').first().textContent().catch(() => null);
  console.log('sealed confirmation:', JSON.stringify(sealedText));
}
await b.close();
console.log(errs.length ? 'ERRORS:\n' + errs.slice(0, 8).join('\n') : 'no console/page errors');
