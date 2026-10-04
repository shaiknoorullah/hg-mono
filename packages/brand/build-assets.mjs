/**
 * Build every static brand asset from ONE geometry module.
 *
 *   node packages/brand/build-assets.mjs
 *
 * The alternative is a folder of hand-exported PNGs, one per theme per size,
 * which is how a favicon ends up showing last quarter's logo. Everything below
 * is derived from `src/wordmark-art.ts`, so there is exactly one place a
 * change to the mark has to happen. It writes into every app that shows the
 * logo: the marketing site, the restaurant and admin web apps, and the
 * customer and rider Expo apps.
 *
 * The light/dark pair is a COLOUR SWAP, not two drawings. The supplied artwork
 * is the dark version (#D0D0D1 letterforms, drawn for a dark background); the
 * light version is the same paths in #232323. Neither is a raster edit, so they
 * cannot drift apart or disagree on a curve.
 *
 * PNGs come out of Chromium rather than a raster library so the curve rendering
 * is the same engine the site uses.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const APP = join(ROOT, 'apps/marketing');

// The art module is TypeScript; this script is the only consumer that cannot
// import it, so it reads the two path strings out rather than pulling in a
// transpiler for three regexes.
const SRC = readFileSync(join(HERE, 'src/wordmark-art.ts'), 'utf8');
const pick = (key) => {
  const m = SRC.match(new RegExp(`\\n  ${key}:\\n    '([^']+)'`));
  if (!m) throw new Error(`wordmark-art.ts: no ${key} — did the generator change shape?`);
  return m[1];
};
const ART = {
  silhouette: pick('silhouette'),
  swash: pick('swash'),
  monogram: pick('monogram'),
  view: { w: 556, h: 186 },
  ramp: { top: 119.5, bottom: 154.9 },
  bounds: {
    monogram: { x: -1.13, y: 9.78, w: 127.83, h: 158.09 },
    swash: { x: 141, y: 119.1, w: 224.48, h: 66.47 },
  },
};

const THEME = {
  light: { fg: '#232323', bg: '#FFFAEA' },   // text.primary on surface.base   15.05:1
  dark: { fg: '#D0D0D1', bg: '#171717' },    // the supplied grey on dark base 11.63:1
};
const ACCENT = '#F1521E'; // --hg-mk-accent

/** The full wordmark, standalone, transparent background. */
function wordmarkSvg(fg) {
  const { view: v, ramp } = ART;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${v.w} ${v.h}" width="${v.w}" height="${v.h}">
  <title>HalalGoes</title>
  <defs>
    <linearGradient id="swash" x1="0" y1="${ramp.top}" x2="0" y2="${ramp.bottom}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${fg}"/>
      <stop offset="1" stop-color="${ACCENT}"/>
    </linearGradient>
  </defs>
  <path fill="${fg}" fill-rule="evenodd" d="${ART.silhouette}"/>
  <path fill="url(#swash)" fill-rule="evenodd" d="${ART.swash}"/>
</svg>`;
}

/**
 * Only the sweeping half of the swash goes in the icons. The full swash ends in
 * a tall hook which, under a single letter instead of five, reads as a second
 * stroke rather than an underline. x=290 in source coordinates is where that
 * hook starts to climb.
 */
const SWASH_CROP = 290;

/**
 * Lay the H and the swash out in a `box`-sized square.
 *
 * `inset` is the share of the box left empty around the lockup — an Android
 * maskable icon crops to a circle inside the square, so it needs a far bigger
 * one than a browser tab does. That is the only difference between the icons.
 *
 * Returns the clip geometry alongside the markup because the crop is expressed
 * in the OUTER box's coordinates while the swash is drawn in its own scaled
 * space; computing the two apart is how the hook silently came back.
 */
function lockup({ box = 240, inset = 0.14, swashWidth = 1.61 } = {}) {
  const b = ART.bounds;
  const hH = box * (1 - inset * 2) * 0.78;   // the H takes most of it, swash under
  const gap = box * 0.012;
  const sH = hH / b.monogram.h;
  const hW = b.monogram.w * sH;
  const swW = hW * swashWidth;
  const sS = swW / b.swash.w;
  const swH = b.swash.h * sS;
  const top = (box - (hH + gap + swH)) / 2;
  const cx = box / 2;
  const hx = cx - hW / 2 - b.monogram.x * sH;
  const hy = top - b.monogram.y * sH;
  const sx = cx - swW / 2 - b.swash.x * sS;
  const sy = top + hH + gap - b.swash.y * sS;
  const f = (n) => Number(n.toFixed(2));
  return {
    cropRight: sx + SWASH_CROP * sS,
    markup: `<g clip-path="url(#swashCrop)"><path transform="translate(${f(sx)} ${f(sy)}) scale(${sS.toFixed(4)})" d="${ART.swash}" fill="${ACCENT}"/></g>
  <path transform="translate(${f(hx)} ${f(hy)}) scale(${sH.toFixed(4)})" fill-rule="evenodd" d="${ART.monogram}" fill="var(--fg)"/>`,
  };
}

function iconSvg({ box = 240, inset = 0.14, radius = 0.2, themed = true, theme = 'light', plate = true } = {}) {
  const { cropRight, markup } = lockup({ box, inset });
  const style = themed
    ? `<style>:root{--fg:${THEME.light.fg};--bg:${THEME.light.bg}}@media (prefers-color-scheme:dark){:root{--fg:${THEME.dark.fg};--bg:${THEME.dark.bg}}}</style>`
    : `<style>:root{--fg:${THEME[theme].fg};--bg:${THEME[theme].bg}}</style>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}" width="${box}" height="${box}">
  <title>HalalGoes</title>
  ${style}
  <defs><clipPath id="swashCrop"><rect x="${(cropRight - 9999).toFixed(2)}" y="-9999" width="9999" height="19998"/></clipPath></defs>
  ${plate ? `<rect width="${box}" height="${box}" rx="${(box * radius).toFixed(1)}" fill="var(--bg)"/>` : ''}
  ${markup}
</svg>`;
}

const browser = await chromium.launch({
  // Playwright's own bundled Chromium unless CHROME_PATH names another.
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});
async function png(svg, w, h, { transparent = false } = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:transparent}svg{display:block;width:${w}px;height:${h}px}</style>${svg}`,
  );
  const buf = await page.screenshot({ omitBackground: transparent });
  await page.close();
  return buf;
}

const wrote = [];
const put = (p, data) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
  wrote.push(`${p.replace(ROOT + '/', '')}  ${(data.length / 1024).toFixed(1)}KB`);
};

// 1. the wordmark, both themes, vector and raster
for (const [name, t] of Object.entries(THEME)) {
  const svg = wordmarkSvg(t.fg);
  put(join(HERE, `halalgoes-wordmark-${name}.svg`), svg);
  // 2x the source, transparent: the size anyone dropping this into a deck or an
  // email signature needs, and the size the supplied PNG was not.
  put(join(HERE, `halalgoes-wordmark-${name}.png`),
      await png(svg, ART.view.w * 2, ART.view.h * 2, { transparent: true }));
}

// 2. the browser favicon — one file, both themes, via a media query inside it
put(join(APP, 'src/app/icon.svg'), iconSvg({ box: 240 }));

// 3. iOS. No transparency and no rounding: the OS does its own mask, and a
//    transparent apple-touch-icon renders on black.
put(join(APP, 'src/app/apple-icon.png'),
    await png(iconSvg({ box: 240, radius: 0, themed: false, theme: 'light' }), 180, 180));

// 4. Android / PWA install icons
for (const size of [192, 512]) {
  put(join(APP, `public/icons/icon-${size}.png`),
      await png(iconSvg({ box: 240, radius: 0.2, themed: false, theme: 'light' }), size, size));
}
// maskable: Android crops to a circle of 80% diameter, so the lockup shrinks
// and the background runs to the edges.
put(join(APP, 'public/icons/maskable-512.png'),
    await png(iconSvg({ box: 240, inset: 0.26, radius: 0, themed: false, theme: 'light' }), 512, 512));

// 5. The restaurant and admin web apps (Vite): the same themed favicon the
//    marketing site uses, and the same opaque iOS icon.
for (const app of ['restaurant', 'admin']) {
  const dir = join(ROOT, 'apps', app, 'public');
  put(join(dir, 'favicon.svg'), iconSvg({ box: 240 }));
  put(join(dir, 'apple-touch-icon.png'),
      await png(iconSvg({ box: 240, radius: 0, themed: false, theme: 'light' }), 180, 180));
}

// 6. The customer and rider apps (Expo). The apps run the light scheme only, so
//    every native icon is the light lockup.
//    - icon: 1024 square, opaque and unrounded — iOS and the stores apply the mask.
//    - adaptive-icon: Android's foreground layer, transparent; the launcher draws
//      the background colour (app config) and crops to its own shape, keeping
//      only the middle ~61%, so the lockup takes the maskable inset.
//    - splash: the full wordmark centred on a transparent square, so `contain`
//      on any screen leaves it at about half the width rather than edge to edge.
//    - favicon: the web target's tab icon.
const splashSvg = (() => {
  const { view: v } = ART;
  const box = 1200;
  const w = box * 0.56;
  const s = w / v.w;
  const x = (box - w) / 2;
  const y = (box - v.h * s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}" width="${box}" height="${box}">
  <g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${s.toFixed(4)})">${wordmarkSvg(THEME.light.fg)
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '')}</g>
</svg>`;
})();
for (const app of ['customer', 'rider']) {
  const dir = join(ROOT, 'apps', app, 'assets');
  put(join(dir, 'icon.png'),
      await png(iconSvg({ box: 240, radius: 0, themed: false, theme: 'light' }), 1024, 1024));
  put(join(dir, 'adaptive-icon.png'),
      await png(iconSvg({ box: 240, inset: 0.26, themed: false, theme: 'light', plate: false }), 1024, 1024,
        { transparent: true }));
  put(join(dir, 'splash.png'), await png(splashSvg, 1200, 1200, { transparent: true }));
  put(join(dir, 'favicon.png'),
      await png(iconSvg({ box: 240, radius: 0.2, themed: false, theme: 'light' }), 48, 48, { transparent: true }));
}

await browser.close();
console.log('wrote:');
for (const w of wrote) console.log('  ' + w);
