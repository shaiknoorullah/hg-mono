// Verification harness for the scroll-journey prototypes.
//
//   node verify.mjs <url-path> [--shots <dir>]
//
// Reports, per viewport width: total page height in viewports, every pinned
// beat's scroll length, horizontal overflow both at rest AND stepped through the
// whole page, and console errors. Then reduced motion. Then, with --shots, one
// frame per beat at local p=0.02 and p=0.50 plus each beat's own background
// colour, for ink.py to compare.
//
// Run it against `serve.mjs`, from the repo root so `playwright` resolves.
import { chromium } from 'playwright';
import fs from 'node:fs';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:5400/';
const path = process.argv[2];
const shotsAt = process.argv.includes('--shots')
  ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (!path) { console.error('usage: node verify.mjs <file.html> [--shots <dir>]'); process.exit(1); }

const WIDTHS = [[1440, 900], [1024, 768], [768, 1024], [390, 844]];
const browser = await chromium.launch({ executablePath: CHROME });
const report = { file: path, widths: {}, reducedMotion: null, beats: null };

const readBeats = () => [...document.querySelectorAll('[data-beat]')].map((el) => {
  const pinned = [...el.querySelectorAll('*')]
    .some((c) => getComputedStyle(c).position === 'sticky');
  return {
    id: el.dataset.beat,
    name: el.dataset.beatName || el.dataset.beat,
    top: el.offsetTop,
    height: el.offsetHeight,
    vh: +(el.offsetHeight / innerHeight).toFixed(2),
    pinned,
  };
});

for (const [w, h] of WIDTHS) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 140)));
  await page.goto(BASE + path, { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  const geom = await page.evaluate((fn) => {
    const doc = document.documentElement;
    return {
      totalVh: +(doc.scrollHeight / innerHeight).toFixed(2),
      totalPx: doc.scrollHeight,
      hScrollAtRest: doc.scrollWidth - doc.clientWidth,
      beats: new Function('return (' + fn + ')()')(),
    };
  }, readBeats.toString());

  // Horizontal overflow can appear only mid-transform, so step the whole page.
  let worstH = geom.hScrollAtRest;
  for (let i = 0; i <= 16; i++) {
    await page.evaluate((f) => scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * f), i / 16);
    await page.waitForTimeout(200);
    worstH = Math.max(worstH, await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
  }

  const pinned = geom.beats.filter((b) => b.pinned);
  report.widths[`${w}x${h}`] = {
    totalVh: geom.totalVh,
    pinnedBeats: pinned.length,
    shortestPinnedVh: pinned.length ? Math.min(...pinned.map((b) => b.vh)) : null,
    under250vh: pinned.filter((b) => b.vh < 2.5).map((b) => `${b.name} ${b.vh}vh`),
    hScrollAtRest: geom.hScrollAtRest,
    hScrollWorstWhileScrolling: worstH,
    consoleErrors: errors,
  };
  if (w === 1440) report.beats = geom.beats;
  await page.close();
}

// Reduced motion must be a real document, not a frozen animation.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.goto(BASE + path, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  report.reducedMotion = await page.evaluate(() => ({
    totalVh: +(document.documentElement.scrollHeight / innerHeight).toFixed(2),
    stickyElements: [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).position === 'sticky').length,
  }));
  await page.close();
}

// Per-beat entry frames. p=0.02 is the moment the beat pins and its opening
// dwell begins: the composition must ALREADY be whole there.
if (shotsAt) {
  fs.mkdirSync(shotsAt, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE + path, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const tag = path.replace(/\.html$/, '');
  const bgs = {};
  for (const b of report.beats.filter((x) => x.pinned)) {
    // Park at the beat's mid-point first, so the pinned composition is on screen
    // when we measure where it actually sits.
    await page.evaluate((y) => scrollTo(0, y), b.top + (b.height - 900) * 0.5);
    await page.waitForTimeout(700);
    bgs[b.id] = await page.evaluate((id) => {
      // Find the beat's largest opaque surface and return BOTH its colour and its
      // on-screen rect. Measuring the whole viewport is what makes this useless:
      // a dark band on a cream page reads as ~50% "ink" from the page around it,
      // which stays true whether the band is full or completely empty.
      const el = document.querySelector(`[data-beat="${id}"]`);
      let best = null;
      for (const e of [el, ...el.querySelectorAll('*')]) {
        const r = e.getBoundingClientRect();
        if (r.width < 120 || r.height < 120) continue;
        if (r.bottom < 0 || r.top > innerHeight) continue;
        const m = getComputedStyle(e).backgroundColor
          .match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/);
        if (!m || (m[4] !== undefined && +m[4] < 0.9)) continue;
        const area = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
        const areaY = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
        const size = area * areaY;
        if (!best || size > best.size) {
          best = { size, bg: [+m[1], +m[2], +m[3]],
                   rect: [Math.max(r.left, 0) | 0, Math.max(r.top, 0) | 0,
                          Math.min(r.right, innerWidth) | 0, Math.min(r.bottom, innerHeight) | 0] };
        }
      }
      // Inset so the surface's own border/rounding is not counted as content.
      if (best) {
        const [x0, y0, x1, y1] = best.rect;
        const i = 14;
        best.rect = [x0 + i, y0 + i, Math.max(x0 + i + 1, x1 - i), Math.max(y0 + i + 1, y1 - i)];
      }
      return best ? { bg: best.bg, rect: best.rect } : null;
    }, b.id);
    for (const lp of [0.02, 0.5]) {
      await page.evaluate((y) => scrollTo(0, y), b.top + (b.height - 900) * lp);
      await page.waitForTimeout(950);
      await page.screenshot({ path: `${shotsAt}/${tag}__${b.id}__${String(lp).replace('.', '_')}.png` });
    }
  }
  fs.writeFileSync(`${shotsAt}/backgrounds.json`, JSON.stringify(bgs, null, 1));
  await page.close();
}

console.log(JSON.stringify(report, null, 1));
await browser.close();
