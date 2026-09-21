import { chromium } from '/home/user/hg-mono/node_modules/.pnpm/playwright@1.50.1/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const [label, cpu, net] of [['desktop', 1, null], ['mid-range android (4x CPU, Fast 3G)', 4, { download: 1.6e6/8, upload: 750e3/8, latency: 150 }]]) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  if (net) { await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: net.latency, downloadThroughput: net.download, uploadThroughput: net.upload }); }
  let bytes = 0;
  p.on('response', async (r) => { try { const bd = await r.body(); bytes += bd.length; } catch {} });
  await p.goto('http://127.0.0.1:5290/flipbook.html', { waitUntil: 'load' });
  const lcp = await p.evaluate(() => new Promise((res) => {
    new PerformanceObserver((l) => { const e = l.getEntries(); res({ ms: Math.round(e[e.length-1].startTime), el: e[e.length-1].element?.tagName }); }).observe({ type: 'largest-contentful-paint', buffered: true });
    setTimeout(() => res(null), 4000);
  }));
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  // scrub the whole track
  const travel = await p.evaluate(() => {
    const t = document.querySelector('.track');
    return { start: t.offsetTop, len: t.offsetHeight - innerHeight };
  });
  const frames = [];
  const STEPS = 120;
  for (let k = 0; k <= STEPS; k++) {
    await p.evaluate((yy) => window.scrollTo(0, yy), travel.start + (travel.len * k) / STEPS);
    await p.waitForTimeout(16);
    frames.push(await p.evaluate(() => window.__frame));
  }
  const m = await p.evaluate(() => window.__metrics());
  const uniq = new Set(frames).size;
  const monotonic = frames.every((v, i) => i === 0 || v >= frames[i-1]);
  console.log(`${label}\n  LCP ${lcp?.ms}ms on <${lcp?.el}>  |  transferred ${Math.round(bytes/1024)} KB\n  decoded ${m.decoded}/60 in ${m.decodeMs}ms\n  drawImage over ${m.draws} draws: mean ${m.meanDrawMs}ms  p95 ${m.p95DrawMs}ms  max ${m.maxDrawMs}ms\n  scrub: ${uniq}/60 distinct frames across the real track travel, monotonic=${monotonic}\n`);
  await ctx.close();
}
await b.close();
