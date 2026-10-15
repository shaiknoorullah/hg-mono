// The HalalGoes wordmark the boards draw as `<img src="/_blob/<id>">`.
//
// The boards load it from Claude Design's blob store, whose bytes are not in the mirror, so the
// renderer used to get a 404 and drew an empty box where the app draws its logo. Like the fonts
// (vendor-fonts.mjs), the reference now draws the asset the app ships: the artwork in
// packages/brand, which `Wordmark` in @hg/ui-web and @hg/ui-native paint. README.md, "The wordmark".
//
// Nothing is copied into third-party/: the one source of the artwork stays packages/brand, so the
// reference cannot drift from the app.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRAND = path.resolve(HERE, '../../../packages/brand');
/** The design-system stylesheet the boards read their colour tokens from, relative to the canvases tree. */
export const TOKENS = 'design-system/claude-design-system/project/tokens.css';

/**
 * Each wordmark upload the boards ask for, and the surface it sits on. `surface` is what the board
 * source itself shows (a theme pair in the board script, or the background of the element holding
 * the image); render-refs checks it against the drawn board and records an error when they differ.
 *   dark   a dark page: the letterforms take the dark theme's primary text colour
 *   light  a light page: the letterforms take the light theme's primary text colour
 *   chrome the restaurant console's side rail (surface.chrome, dark forest in both themes): the
 *          letterforms take the colour of text on an accent surface
 * An upload that is not listed here is not drawn and is recorded as failed (a defective reference).
 */
export const WORDMARK_UPLOADS = {
  '843ebf06b5228cfa7692cb421908d434': { surface: 'dark', source: 'customer sign-in, account: `dark ? … : …` pair' },
  d30db9859e3d16adcb42d3b151c41784: { surface: 'light', source: 'customer sign-in, account: `dark ? … : …` pair' },
  e76696913a32e36d5818fbab82399c57: { surface: 'dark', source: 'rider sign-in screens, which set data-theme="dark"' },
  '0301c9d70c5bfa601b32fcf1f17f950a': { surface: 'light', source: 'rider sign-in screens named Light' },
  d996313b7f78edd23554a2fe9790a17b: { surface: 'chrome', source: 'restaurant live-orders side rail' },
  '6936218f408b0d4febf186032175e53d': { surface: 'chrome', source: 'restaurant menu-hours side rail' },
  '1778fdca6a07baa6db5b63db339f155f': { surface: 'chrome', source: 'restaurant payouts side rail' },
  '7b80a257423d82e01fbbb637ffe83ff1': { surface: 'chrome', source: 'restaurant settings side rail' },
  e14b0f4f6297329ccda5f602e4aecfc1: { surface: 'light', source: 'restaurant sign-in and onboarding top bar (surface.base)' },
};

/** The value of `--name` in a theme's tokens, following var() references. `dark` falls back to the base block. */
export function tokenValue(css, theme, name) {
  const blocks = { base: '', dark: '' };
  for (const m of css.matchAll(/(^|\n)([^{}\n]+)\{([^}]*)\}/g)) {
    if (/\[data-theme="dark"\]/.test(m[2])) blocks.dark += m[3];
    else if (/:root|\[data-theme="light"\]/.test(m[2])) blocks.base += m[3];
  }
  const find = (n, scope) => {
    for (const text of scope === 'dark' ? [blocks.dark, blocks.base] : [blocks.base]) {
      const hit = new RegExp(`--${n}\\s*:\\s*([^;]+);`).exec(text);
      if (hit) return hit[1].trim();
    }
    return null;
  };
  let v = find(name, theme);
  for (let i = 0; v && i < 5; i++) {
    const ref = /^var\(--([\w-]+)\)$/.exec(v);
    if (!ref) break;
    v = find(ref[1], theme);
  }
  return v;
}

/**
 * The wordmark as an SVG for a surface, with the letterforms in the colour the app paints them:
 * a theme role, not the hex in the supplied artwork (#D0D0D1 is a dark-surface grey; in the app's
 * dark theme the letterforms are the theme's primary text colour). The swash is the brand orange
 * in both, as in the app.
 * @param {'dark' | 'light' | 'chrome'} surface
 * @param {string} tokensCss the board's tokens.css
 */
export function wordmarkSvg(surface, tokensCss) {
  const file = surface === 'light' ? 'halalgoes-wordmark-light.svg' : 'halalgoes-wordmark-dark.svg';
  const svg = readFileSync(path.join(BRAND, file), 'utf8');
  const supplied = surface === 'light' ? '#232323' : '#D0D0D1';
  const ink = surface === 'chrome' ? tokenValue(tokensCss, 'light', 'text-on-accent') : tokenValue(tokensCss, surface, 'text-primary');
  if (!ink || !/^#[0-9a-f]{3,8}$/i.test(ink)) throw new Error(`wordmark: cannot resolve the letterform colour for a ${surface} surface from ${TOKENS}`);
  if (!svg.includes(supplied)) throw new Error(`wordmark: ${file} no longer uses ${supplied}; update src/wordmark.mjs`);
  return svg.replaceAll(supplied, ink);
}
