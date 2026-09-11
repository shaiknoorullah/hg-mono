#!/usr/bin/env node
/**
 * Icon-data generator for @hg/ui-web's Solar `Icon` primitive.
 *
 * Problem this exists to solve: `@iconify-json/solar` ships the ENTIRE Solar set — ~7,700
 * icons — as one JSON file. A naive `import solarIcons from '@iconify-json/solar/icons.json'`
 * inside `src/primitives/Icon.tsx` is a static import, so Rollup/Vite inline the whole file
 * into the client bundle regardless of the fact that only ~28 of those icons (14 semantic
 * names × 2 weights, `solar-icon-map.json`) are ever requested. Measured: that one import
 * alone took the gallery's production JS bundle from ~715 KB to ~11 MB.
 *
 * Fix: resolve the curated subset at BUILD TIME (this script, run at `pnpm install`/CI, not
 * shipped) and commit the tiny result. `Icon.tsx` imports ONLY `generated/solar-icons.json` —
 * a ~30-icon `IconifyJSON`, not the ~7,700-icon one — and hands it straight to
 * `@iconify/react/offline`'s `addCollection()`. `@iconify-json/solar` and `@iconify/utils`
 * never enter the browser bundle at all; they are devDependencies used only here.
 *
 * Source of truth for WHICH icons: `src/primitives/solar-icon-map.json` (semantic name ->
 * `{linear, bold}` Solar ids) — hand-authored, a design decision, not derived data. This script
 * only resolves each id's actual path data out of the full Solar set.
 *
 * Usage:
 *   node scripts/generate-icons.mjs          write
 *   node scripts/generate-icons.mjs --check  fail (exit 1) if the committed file is stale
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getIconData } from '@iconify/utils';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const MAP_PATH = join(PKG, 'src', 'primitives', 'solar-icon-map.json');
const SOLAR_PATH = join(PKG, 'node_modules', '@iconify-json', 'solar', 'icons.json');
const OUT_DIR = join(PKG, 'src', 'primitives', 'generated');
const OUT_PATH = join(OUT_DIR, 'solar-icons.json');

const CHECK = process.argv.includes('--check');

const iconMap = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
const solarSet = JSON.parse(readFileSync(SOLAR_PATH, 'utf8'));

/** @type {Record<string, unknown>} */
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
    icons[id] = data;
  }
}

const output = { prefix: 'solar', icons };
const serialized = `${JSON.stringify(output, null, 2)}\n`;

if (CHECK) {
  const current = existsSync(OUT_PATH) ? readFileSync(OUT_PATH, 'utf8') : null;
  if (current !== serialized) {
    console.error(
      `generate-icons --check: ${OUT_PATH} is stale relative to solar-icon-map.json / ` +
        `@iconify-json/solar. Run "pnpm --filter @hg/ui-web generate:icons".`,
    );
    process.exit(1);
  }
  console.log(`generate-icons --check: up to date (${Object.keys(icons).length} icons).`);
  process.exit(0);
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_PATH, serialized);
console.log(`generate-icons: wrote ${Object.keys(icons).length} icons -> ${OUT_PATH}`);
