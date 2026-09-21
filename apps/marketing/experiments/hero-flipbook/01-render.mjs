import { chromium } from '/home/user/hg-mono/node_modules/.pnpm/playwright@1.50.1/node_modules/playwright/index.mjs';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';

const FRAMES = Number(process.argv[2] || 60);
const OUT = '/tmp/claude-0/poc/frames';
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 760, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

const t0 = Date.now();
await p.goto('http://127.0.0.1:5290/scene.html');
try { await p.waitForFunction(() => window.__ready === true, null, { timeout: 30000 }); } catch (e) { console.error('NOT READY. page errors:'); errs.forEach(x=>console.error(' -', x)); await b.close(); process.exit(1); }
const tReady = Date.now() - t0;

const times = [];
for (let i = 0; i < FRAMES; i++) {
  const s = Date.now();
  const url = await p.evaluate((pr) => window.__renderFrame(pr), FRAMES === 1 ? 0 : i / (FRAMES - 1));
  times.push(Date.now() - s);
  writeFileSync(`${OUT}/${String(i).padStart(3, '0')}.png`, Buffer.from(url.split(',')[1], 'base64'));
}
await b.close();

const sum = times.reduce((a, c) => a + c, 0);
console.log(JSON.stringify({
  frames: FRAMES,
  sceneReadyMs: tReady,
  perFrameMs: { mean: Math.round(sum / FRAMES), min: Math.min(...times), max: Math.max(...times) },
  totalRenderMs: sum,
  pageErrors: errs.slice(0, 5),
}, null, 1));
