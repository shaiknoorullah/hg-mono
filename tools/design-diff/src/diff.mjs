#!/usr/bin/env node
// diff: pairs each capture with its board by name and compares them. README.md, "Compare".
//
//   node src/diff.mjs --refs <render-refs out> --captures <dir> --out <dir>
//                     [--app customer] [--insets insets.json | --profile phone-390]
//                     [--map pairs.json] [--threshold 0.1] [--max-mismatch 0.1]
//                     [--max-region 4] [--strict]
//
// A capture is any design--<area>--<Board>.png under --captures; its app is the nearest folder
// named for an app, or --app. --map adds screenshots named otherwise: { "<path under --captures>":
// "<app>/<area>/<Board>" }. Phone screenshots lose Android's bars first (--insets, measured, or
// --profile, the stock heights). Writes <out>/results.json and, per pair, the diff image and the
// side-by-side (design | app | diff) under <out>/pairs/. --strict exits 1 when a pair fails or names no board.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, compare } from './compare.mjs';
import { PROFILES, profileInsets } from './insets.mjs';
import { compareLayouts } from './layout-diff.mjs';
import { APPS, parseBoardId, parseCaptureFile } from './names.mjs';
import { crop, readPng, shrink, sideBySide, writePng } from './png.mjs';

function args(argv) {
  const o = { refs: null, captures: null, out: null, app: null, insets: null, profile: null, map: null, strict: false, thresholds: {} };
  const num = (name, v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${name} needs a number, not "${v}"`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const v = () => argv[++i];
    switch (argv[i]) {
      case '--refs': o.refs = path.resolve(v()); break;
      case '--captures': o.captures = path.resolve(v()); break;
      case '--out': o.out = path.resolve(v()); break;
      case '--app': o.app = v(); break;
      case '--insets': o.insets = path.resolve(v()); break;
      case '--profile': o.profile = v(); break;
      case '--map': o.map = path.resolve(v()); break;
      case '--threshold': o.thresholds.threshold = num('--threshold', v()); break;
      case '--max-mismatch': o.thresholds.maxMismatchPct = num('--max-mismatch', v()); break;
      case '--max-region': o.thresholds.maxRegionPx = num('--max-region', v()); break;
      case '--strict': o.strict = true; break;
      default: throw new Error(`unknown option ${argv[i]} (see the header of src/diff.mjs)`);
    }
  }
  for (const k of ['refs', 'captures', 'out']) if (!o[k]) throw new Error(`--${k} <dir> is required`);
  if (o.app && !APPS.includes(o.app)) throw new Error(`--app must be one of ${APPS.join(', ')}`);
  if (o.profile && !PROFILES[o.profile]) throw new Error(`--profile must be one of ${Object.keys(PROFILES).join(', ')}`);
  return o;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Every capture under `root` with the board it must match. */
export function findCaptures(root, { app = null, map = {} } = {}) {
  const found = [];
  for (const file of walk(root)) {
    const rel = path.relative(root, file);
    if (map[rel]) {
      found.push({ file, rel, id: map[rel] });
      continue;
    }
    const name = parseCaptureFile(path.basename(file));
    if (!name) continue;
    const owner = app ?? rel.split(path.sep).reverse().find((d) => APPS.includes(d));
    if (!owner) throw new Error(`${rel}: no app folder above it; pass --app`);
    found.push({ file, rel, id: `${owner}/${name.area}/${name.board}` });
  }
  return found;
}

function main() {
  const o = args(process.argv.slice(2));
  const manifest = JSON.parse(readFileSync(path.join(o.refs, 'manifest.json'), 'utf8'));
  const map = o.map ? JSON.parse(readFileSync(o.map, 'utf8')) : {};
  const cut = o.insets ? JSON.parse(readFileSync(o.insets, 'utf8')) : o.profile ? profileInsets(PROFILES[o.profile]) : null;
  const thresholds = { ...DEFAULTS, ...o.thresholds };
  const captures = findCaptures(o.captures, { app: o.app, map });
  if (!captures.length) throw new Error(`no captures under ${o.captures} (design--<area>--<Board>.png, or --map)`);

  const pairs = [];
  for (const c of captures) {
    const { app, area, board } = parseBoardId(c.id);
    const ref = manifest.boards[c.id];
    const base = { id: c.id, app, area, board, capture: c.rel, title: ref?.title ?? null };
    if (!ref || !existsSync(path.join(o.refs, ref.file))) {
      pairs.push({ ...base, verdict: 'NO BOARD', reason: ref ? `the board did not render: ${ref.errors.join('; ')}` : 'no board of that name in the references (a typo, or its app and area were not rendered)' });
      console.log(`${'NO BOARD'.padEnd(12)} ${''.padStart(8)}    ${c.id}  (${c.rel})`);
      continue;
    }
    let shot = readPng(c.file);
    if (cut) shot = crop(shot, 0, cut.top, shot.width, shot.height - cut.top - cut.bottom);
    const r = compare(readPng(path.join(o.refs, ref.file)), shot, { scale: ref.scale, ...thresholds });
    const pair = { ...base, size: `${ref.w}×${ref.h}`, scale: ref.scale, theme: ref.theme, notes: ref.notes, caveats: ref.caveats, missingBlobs: ref.missingBlobs, ...r, images: undefined };
    const layoutFile = c.file.replace(/\.png$/, '.layout.json');
    if (existsSync(layoutFile) && ref.layout && existsSync(path.join(o.refs, ref.layout))) {
      const l = compareLayouts(JSON.parse(readFileSync(path.join(o.refs, ref.layout), 'utf8')), JSON.parse(readFileSync(layoutFile, 'utf8')));
      pair.layout = { matchedTexts: l.matched, findings: l.findings };
    }
    if (r.images) {
      const slug = `${c.id.replaceAll('/', '--')}@${c.rel.split(path.sep).slice(0, -1).join('-') || 'root'}`;
      const dir = path.join(o.out, 'pairs', slug);
      mkdirSync(dir, { recursive: true });
      const sbs = sideBySide([readPng(path.join(o.refs, ref.file)), r.images.app, r.images.diff]);
      writePng(path.join(dir, 'diff.png'), r.images.diff);
      writePng(path.join(dir, 'side-by-side.png'), sbs);
      writePng(path.join(dir, 'preview.png'), shrink(sbs, Math.max(1, Math.ceil(sbs.width / 2400))));
      pair.images = { diff: `pairs/${slug}/diff.png`, sideBySide: `pairs/${slug}/side-by-side.png`, preview: `pairs/${slug}/preview.png` };
    }
    pairs.push(pair);
    console.log(`${pair.verdict.padEnd(12)} ${String(pair.mismatchPct ?? '').padStart(8)} %  ${c.id}  (${c.rel})`);
  }

  const apps = new Set(pairs.map((p) => p.app));
  const results = {
    refs: o.refs,
    source: manifest.source,
    thresholds,
    crop: cut,
    pairs,
    areas: Object.fromEntries(Object.entries(manifest.areas).filter(([id]) => apps.has(id.split('/')[0]))),
    caveatBoards: Object.fromEntries(Object.entries(manifest.boards).filter(([id, b]) => apps.has(id.split('/')[0]) && b.caveats?.length).map(([id, b]) => [id, { title: b.title, caveats: b.caveats }])),
  };
  mkdirSync(o.out, { recursive: true });
  writeFileSync(path.join(o.out, 'results.json'), JSON.stringify(results, null, 1) + '\n');
  const count = (v) => pairs.filter((p) => p.verdict === v).length;
  console.log(`\n${pairs.length} captures: ${count('PASS')} pass, ${count('FAIL')} fail, ${count('NOT COMPARED')} not compared, ${count('NO BOARD')} without a board. ${path.join(o.out, 'results.json')}`);
  if (o.strict && pairs.some((p) => p.verdict === 'FAIL' || p.verdict === 'NO BOARD')) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(`diff: ${e.message}`);
    process.exit(2);
  }
}
