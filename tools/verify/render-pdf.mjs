// Render an HTML file to PDF via headless Chromium (print styles honored).
// Usage: node tools/verify/render-pdf.mjs <input.html> <output.pdf>
import { chromium } from 'playwright';

const [input, output] = process.argv.slice(2);
if (!input || !output) { console.error('usage: render-pdf <in.html> <out.pdf>'); process.exit(1); }

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('file://' + input, { waitUntil: 'networkidle' });
await page.emulateMedia({ media: 'print' });
await page.pdf({
  path: output,
  format: 'A4',
  printBackground: true,
  margin: { top: '0', bottom: '0', left: '0', right: '0' },
});
await browser.close();
console.log('wrote', output);
