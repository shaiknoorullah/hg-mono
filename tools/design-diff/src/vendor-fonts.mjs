#!/usr/bin/env node
// Copies the web fonts the design canvases load into third-party/fonts/, so render-refs never fetches
// them at run time. The boards ask Google Fonts for Plus Jakarta Sans, IBM Plex Mono and Bricolage
// Grotesque (all under the SIL Open Font License, third-party/fonts/OFL-*.txt). Each stylesheet URL the
// canvases use is kept exactly as Google answered it (css.json), so a board gets the same faces,
// weights and unicode ranges it got on claude.ai; the font files keep their fonts.gstatic.com
// paths under third-party/fonts/files/.
//
// Run again when a canvas starts asking for a new family or weight (render-refs fails and names
// the URL):  node src/vendor-fonts.mjs --src <canvases checkout>
// Needs the network. README.md, "Fonts and React".

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../third-party/fonts');
// A current desktop Chrome: Google answers it with woff2 files and per-subset unicode ranges.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const LICENSES = {
  'Plus Jakarta Sans': 'https://raw.githubusercontent.com/google/fonts/main/ofl/plusjakartasans/OFL.txt',
  'IBM Plex Mono': 'https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/OFL.txt',
  'Bricolage Grotesque': 'https://raw.githubusercontent.com/google/fonts/main/ofl/bricolagegrotesque/OFL.txt',
};

const srcFlag = process.argv.indexOf('--src');
if (srcFlag < 0 || !process.argv[srcFlag + 1]) {
  console.error('usage: node src/vendor-fonts.mjs --src <dir holding the canvases/ tree>');
  process.exit(2);
}
const src = path.resolve(process.argv[srcFlag + 1]);

/** Every Google Fonts stylesheet URL in the boards and their stylesheets. */
function fontUrls(root) {
  const urls = new Set();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(html|css)$/.test(name)) {
        for (const m of readFileSync(p, 'utf8').matchAll(/https:\/\/fonts\.googleapis\.com\/css2\?[^"')\s]+/g)) {
          urls.add(m[0].replaceAll('&amp;', '&'));
        }
      }
    }
  };
  walk(root);
  return [...urls].sort();
}

async function get(url, as) {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return as === 'text' ? res.text() : Buffer.from(await res.arrayBuffer());
}

const css = {};
const files = new Set();
for (const url of fontUrls(src)) {
  css[url] = await get(url, 'text');
  for (const m of css[url].matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)) files.add(m[1]);
}
for (const url of files) {
  const dest = path.join(OUT, 'files', new URL(url).pathname);
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, await get(url, 'buffer'));
}
for (const [family, url] of Object.entries(LICENSES)) {
  writeFileSync(path.join(OUT, `OFL-${family.replaceAll(' ', '')}.txt`), await get(url, 'text'));
}
writeFileSync(path.join(OUT, 'css.json'), JSON.stringify(css, null, 1) + '\n');
console.log(`vendored ${Object.keys(css).length} stylesheets and ${files.size} font files into ${path.relative(process.cwd(), OUT)}`);
