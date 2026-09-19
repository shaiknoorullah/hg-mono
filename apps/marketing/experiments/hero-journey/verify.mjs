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

// Seek by driving real wheel input, never `scrollTo`.
//
// These pages run Lenis, which keeps its OWN scroll value and drives every
// transform from it. A native `scrollTo` moves `window.scrollY` without moving
// Lenis's value, so the page renders one position while the browser reports
// another — and any measurement taken afterwards is of a page that no reader
// will ever see. That desync produced a false "all clear" on a beat that really
// did render empty. Wheel input goes through Lenis, so the two stay in step.
async function seek(page, y) {
  for (let i = 0; i < 60; i++) {
    const cur = await page.evaluate(() => scrollY);
    const delta = y - cur;
    if (Math.abs(delta) < 10) break;
    await page.mouse.wheel(0, Math.max(-2500, Math.min(2500, delta)));
    await page.waitForTimeout(55);
  }
  await page.waitForTimeout(800);   // let the damped values converge
}
const browser = await chromium.launch({ executablePath: CHROME });
const report = { file: path, widths: {}, reducedMotion: null, beats: null };

// The three directions mark their beats differently — [data-beat] in some,
// class="beat" + data-name in others. Key off both, or the harness silently
// reports zero beats and reads as a pass.
const readBeats = () => [...document.querySelectorAll('[data-beat], .beat')].map((el, i) => {
  const pinned = [...el.querySelectorAll('*')]
    .some((c) => getComputedStyle(c).position === 'sticky');
  return {
    id: el.dataset.beat || el.id || `beat${i}`,
    name: el.dataset.beatName || el.dataset.name || el.dataset.beat || `beat ${i}`,
    deviceBeat: el.dataset.deviceBeat || null,
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
  const maxY = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  for (let i = 0; i <= 16; i++) {
    await seek(page, (maxY * i) / 16);
    worstH = Math.max(worstH, await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
  }

  const pinned = geom.beats.filter((b) => b.pinned);
  report.widths[`${w}x${h}`] = {
    totalVh: geom.totalVh,
    NO_BEATS_FOUND: geom.beats.length === 0 || undefined,
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
// Text a reader can actually SEE: on screen, not transparent, and not clipped
// out by an overflow:hidden ancestor. Clipping is the case that defeats naive
// checks — content pushed out by a transform stays at opacity 1 and reads as
// present to anything that only inspects styles.
const paintedText = () => {
  let shown = 0, clipped = 0;
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let t;
  while ((t = w.nextNode())) {
    const str = t.textContent.trim(); if (!str) continue;
    const el = t.parentElement;
    if (!el || el.closest('.hud,#hud,[data-hud]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.bottom < 0 || r.top > innerHeight) continue;
    let op = 1, e = el, cut = false;
    while (e && e !== document.body) {
      const cs = getComputedStyle(e);
      op *= parseFloat(cs.opacity);
      if (cs.overflow === 'hidden' || cs.overflowY === 'hidden') {
        const pr = e.getBoundingClientRect();
        if (r.top >= pr.bottom - 1 || r.bottom <= pr.top + 1) cut = true;
      }
      e = e.parentElement;
    }
    if (op > 0.15 && !cut) shown += str.length; else clipped += str.length;
  }
  return { shown, clipped };
};

if (shotsAt) {
  fs.mkdirSync(shotsAt, { recursive: true });
  const painted = {};
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE + path, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const tag = path.replace(/\.html$/, '');
  const bgs = {};
  for (const b of report.beats.filter((x) => x.pinned)) {
    // Park at the beat's mid-point first, so the pinned composition is on screen
    // when we measure where it actually sits.
    await seek(page, b.top + (b.height - 900) * 0.5);
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
    // Approach the entry frame from ABOVE, the way a reader arrives, so what is
    // captured is what they actually see when the beat pins.
    for (const lp of [0.02, 0.5]) {
      if (lp === 0.02) await seek(page, Math.max(0, b.top - 900));
      await seek(page, b.top + (b.height - 900) * lp);
      await page.screenshot({ path: `${shotsAt}/${tag}__${b.id}__${String(lp).replace('.', '_')}.png` });
      if (lp === 0.02) painted[b.id] = await page.evaluate(paintedText);
    }
  }
  fs.writeFileSync(`${shotsAt}/backgrounds.json`, JSON.stringify(bgs, null, 1));
  // A beat painting almost no text the moment it pins is blank at entry.
  report.entryPainted = painted;
  report.blankAtEntry = Object.entries(painted)
    .filter(([, v]) => v.shown < 40).map(([k]) => k);
  await page.close();
}

console.log(JSON.stringify(report, null, 1));
await browser.close();
