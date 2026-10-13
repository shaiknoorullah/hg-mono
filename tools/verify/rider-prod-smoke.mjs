import { chromium } from 'playwright';
import { VERIFY_OUT } from './env.mjs';

const OUT = VERIFY_OUT;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await page.goto('http://localhost:34687', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
  const body = await page.locator('body').innerText();
  console.log('PROD BUILD BODY:', body.slice(0, 300));
  console.log('DEBUG BANNER PRESENT:', body.includes('GET /v1/riders/me'));
  await page.screenshot({ path: `${OUT}/rider-prod-01-login.png` });
  await browser.close();
})();
