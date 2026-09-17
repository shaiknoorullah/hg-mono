// Visual verification of the design-system foundation: Solar icons (linear vs
// bold), Plus Jakarta type, and the glass SideNav. Screenshots the gallery-web
// Primitives + Navigation sections.
import { chromium } from 'playwright';

const APP = process.env.APP_URL ?? 'http://localhost:4188';
const OUT = 'tools/verify';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

await page.goto(APP, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

async function openSection(label, file) {
  // left-nav items are buttons/links with the section label
  const link = page.getByText(label, { exact: false }).first();
  try { await link.click({ timeout: 4000 }); } catch { console.log(`  (couldn't click ${label}, screenshotting current)`); }
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: true });
  console.log(`shot ${file}`);
}

console.log('--- Primitives (Icon + Typography) ---');
await openSection('Primitives', 'foundation-01-primitives');
console.log('--- Navigation (glass SideNav) ---');
await openSection('Navigation', 'foundation-02-navigation');

await browser.close();
console.log('done');
