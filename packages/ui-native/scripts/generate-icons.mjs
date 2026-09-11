#!/usr/bin/env node
/**
 * Icon-data generator for @hg/ui-native's Solar `Icon` primitive.
 *
 * Same problem, and same fix, as `@hg/ui-web`'s `scripts/generate-icons.mjs` (read that one
 * first — this is its RN twin): `@iconify-json/solar` ships the ENTIRE Solar set — ~7,700
 * icons — as one JSON file. A naive static import of it into `src/primitives/Icon.tsx` would
 * make Metro inline the whole file into the app bundle regardless of the ~28 icons (14
 * semantic names x 2 weights, `solar-icon-map.json`) this component actually uses.
 *
 * Unlike the web version, this script resolves all the way to the final `<svg>...</svg>`
 * STRING per icon (`@iconify/utils`'s `iconToSVG` + `iconToHTML`), not just the raw icon data —
 * `Icon.tsx` hands that string straight to `react-native-svg`'s `SvgXml`, so there is no reason
 * to ship `@iconify/utils` itself (or the resolution logic it does) into the RN bundle at all.
 * `@iconify-json/solar` and `@iconify/utils` are devDependencies, used only here.
 *
 * Source of truth for WHICH icons: `src/primitives/solar-icon-map.json` (semantic name ->
 * `{linear, bold}` Solar ids) — hand-authored, a design decision, not derived data.
 *
 * Usage:
 *   node scripts/generate-icons.mjs          write
 *   node scripts/generate-icons.mjs --check  fail (exit 1) if the committed file is stale
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getIconData, iconToHTML, iconToSVG, replaceIDs } from '@iconify/utils';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const MAP_PATH = join(PKG, 'src', 'primitives', 'solar-icon-map.json');
const SOLAR_PATH = join(PKG, 'node_modules', '@iconify-json', 'solar', 'icons.json');
const OUT_DIR = join(PKG, 'src', 'primitives', 'generated');
const OUT_PATH = join(OUT_DIR, 'solar-icons.json');

const CHECK = process.argv.includes('--check');

const iconMap = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
const solarSet = JSON.parse(readFileSync(SOLAR_PATH, 'utf8'));

/** @type {Record<string, string>} id -> standalone `<svg>...</svg>` markup */
const icons = {};
for (const pair of Object.values(iconMap)) {
  for (const id of Object.values(pair)) {
    if (icons[id]) continue;
    const data = getIconData(solarSet, id);
    if (!data) {
      throw new Error(
        `generate-icons: "${id}" (from solar-icon-map.json) does not exist in @iconify-json/solar.`,
      );
    }
    const rendered = iconToSVG(data, { width: data.width ?? 24, height: data.height ?? 24 });
    icons[id] = iconToHTML(replaceIDs(rendered.body), rendered.attributes);
  }
}

const serialized = `${JSON.stringify(icons, null, 2)}\n`;

if (CHECK) {
  const current = existsSync(OUT_PATH) ? readFileSync(OUT_PATH, 'utf8') : null;
  if (current !== serialized) {
    console.error(
      `generate-icons --check: ${OUT_PATH} is stale relative to solar-icon-map.json / ` +
        `@iconify-json/solar. Run "pnpm --filter @hg/ui-native generate:icons".`,
    );
    process.exit(1);
  }
  console.log(`generate-icons --check: up to date (${Object.keys(icons).length} icons).`);
  process.exit(0);
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_PATH, serialized);
console.log(`generate-icons: wrote ${Object.keys(icons).length} icons -> ${OUT_PATH}`);
