// Screenshot one of the A/B pages. Usage: node shot.mjs a-static.html [out.png]
// Bare `playwright` import — run where that resolves (the repo root), as probe.mjs notes.
import { chromium } from 'playwright';
const [file = 'a-static.html', out = file.replace(/\.html$/, '.png')] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
await p.goto('file://' + process.cwd() + '/' + file, { waitUntil: 'load' });
await p.screenshot({ path: out });
await b.close();
console.log(out);
