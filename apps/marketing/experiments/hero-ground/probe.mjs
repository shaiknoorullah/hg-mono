import { chromium } from 'playwright';
const b = await chromium.launch({ args:['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const out = {};
for (const f of ['a-static.html','b-webgl.html']) {
  const p = await b.newPage({ viewport:{width:1200,height:800} });
  const t0 = Date.now();
  await p.goto('file://' + process.cwd() + '/' + f, { waitUntil:'load' });
  const r = await p.evaluate(() => {
    const c = document.getElementById('g');
    let px = null, gl = false;
    if (c) { const g = c.getContext('webgl2'); gl = !!g;
      if (g) { const a = new Uint8Array(4); g.readPixels(600,400,1,1,g.RGBA,g.UNSIGNED_BYTE,a); px = [...a]; } }
    const cs = getComputedStyle(document.body);
    return { gl, px, bg: cs.backgroundColor, h1: document.querySelector('h1')?.textContent.slice(0,20) };
  });
  out[f] = { ...r, loadMs: Date.now() - t0 };
  await p.screenshot({ path: f.replace('.html','.png') });
  await p.close();
}
console.log(JSON.stringify(out, null, 1));
await b.close();
