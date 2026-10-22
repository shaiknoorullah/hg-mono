#!/usr/bin/env node
// The pairs closest to passing, with their images, in a directory small enough to be its own artifact.
//
//   node src/near.mjs --results <diff out> --out <dir> [--under 3]
//
// The design-diff artifact holds every pair's images. Once about 1,100 pairs were compared it passed
// 900 MB (run 39818518993), and from here it downloads at well under 1 MB/s: over an hour a run,
// which rules out fixing one board and looking at it again. The boards that need looking at pixel by
// pixel are the ones nearly passing, so this copies only those: each one's side-by-side and diff
// image, under a folder named for the pair, with results.json, findings.txt and an index, best first.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function args(argv) {
  const o = { results: null, out: null, under: 3 };
  for (let i = 0; i < argv.length; i++) {
    const v = () => argv[++i];
    if (argv[i] === '--results') o.results = path.resolve(v());
    else if (argv[i] === '--out') o.out = path.resolve(v());
    else if (argv[i] === '--under') o.under = Number(v());
  }
  return o;
}

/**
 * The compared pairs whose mismatch is under `under` %, passing ones included, best first. Only
 * pairs with images: a pair with no difference image has nothing to look at.
 */
export function nearPairs(results, under = 3) {
  const field = results.comparison?.mismatchField ?? 'mismatchPct';
  return (results.pairs ?? [])
    .filter((p) => typeof p[field] === 'number' && p[field] < under && p.images?.sideBySide)
    .sort((a, b) => a[field] - b[field])
    .map((p) => ({ id: p.id, pct: p[field], verdict: p.verdict, images: p.images, folder: path.posix.dirname(p.images.sideBySide) }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = args(process.argv.slice(2));
  try {
    if (!o.results || !o.out) throw new Error('--results <diff out> and --out <dir> are required');
    const results = JSON.parse(readFileSync(path.join(o.results, 'results.json'), 'utf8'));
    const near = nearPairs(results, o.under);
    mkdirSync(o.out, { recursive: true });
    for (const p of near) {
      mkdirSync(path.join(o.out, p.folder), { recursive: true });
      for (const rel of [p.images.sideBySide, p.images.diff]) {
        if (rel && existsSync(path.join(o.results, rel))) copyFileSync(path.join(o.results, rel), path.join(o.out, rel));
      }
    }
    for (const f of ['results.json', 'findings.txt']) {
      if (existsSync(path.join(o.results, f))) copyFileSync(path.join(o.results, f), path.join(o.out, f));
    }
    const index = near.map((p) => `${p.verdict.padEnd(5)} ${String(p.pct).padStart(7)} %  ${p.id}  ${p.folder}`);
    writeFileSync(path.join(o.out, 'index.txt'), `${near.length} pairs under ${o.under} %, best first.\n${index.join('\n')}\n`);
    console.log(`${near.length} pairs under ${o.under} % copied to ${o.out}`);
  } catch (e) {
    console.log(`the nearest pairs could not be copied: ${e.message}`);
  }
}
