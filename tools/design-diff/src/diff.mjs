#!/usr/bin/env node
// diff: pairs each capture with its board by name and compares them. README.md, "Compare".
//
//   node src/diff.mjs --refs <render-refs out> --captures <dir> --out <dir>
//                     [--app customer] [--insets insets.json | --profile phone-390]
//                     [--map pairs.json] [--threshold 0.1] [--max-mismatch 0.1]
//                     [--max-region 4] [--no-strict]
//
// A capture is any design--<area>--<Board>.png under --captures; its app is the nearest folder
// named for an app, or --app. --map adds screenshots named otherwise: { "<path under --captures>":
// "<app>/<area>/<Board>" }. Phone screenshots lose Android's bars first (--insets, measured, or
// --profile, the stock heights). Writes <out>/results.json and, per pair, the diff image and the
// side-by-side (design | app | diff) under <out>/pairs/. A web capture taken by another Chromium than
// drew its board, or by an unrecorded one, is BROWSER MISMATCH and not compared (src/browser.mjs). A
// native capture must record its device and app build (NO PROVENANCE) and is then not compared by pixels.
// A board whose assets did not all load is DEFECTIVE REFERENCE and not compared: the missing picture
// is the renderer's, not the app's. Checked after NO BOARD, before the capture is looked at.
// Exits 1 when any pair is FAIL, NO BOARD, DEFECTIVE REFERENCE, NOT COMPARED, BROWSER MISMATCH or NO PROVENANCE (the default; --strict is an accepted alias); --no-strict reports and exits 0. A crash or
// usage error exits 2.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_APPS, browserMismatch, provenanceProblem } from './browser.mjs';
import { DEFAULTS, compare } from './compare.mjs';
import { PROFILES, profileInsets } from './insets.mjs';
import { compareLayouts } from './layout-diff.mjs';
import { APPS, parseBoardId, parseCaptureFile } from './names.mjs';
import { crop, readPng, shrink, sideBySide, writePng } from './png.mjs';

function args(argv) {
  const o = { refs: null, captures: null, out: null, app: null, insets: null, profile: null, map: null, strict: true, thresholds: {} };
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
      case '--no-strict': o.strict = false; break;
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

/** Why a board cannot be compared against, or null when its reference is sound. */
export function unusableReference(ref, refsDir) {
  if (!ref) return 'no board of that name in the references (a typo, or its app and area were not rendered)';
  if (ref.errors?.length) return `the reference recorded errors, so it is not a sound reference: ${ref.errors.join('; ')}`;
  if (!existsSync(path.join(refsDir, ref.file))) return 'the board did not render (its reference image is missing)';
  return null;
}

/**
 * Why a board that rendered is still a defective reference, or null: assets it asked for did not
 * load (an uploaded image, say), so part of the picture is missing. That absence is the renderer's,
 * not the app's, and charging it to the app would read as a UI difference. `failedAssets` is
 * `[{ url, status }]` per board; manifests rendered before it existed carry `missingBlobs`, the
 * uploaded-image ids, which is checked the same way.
 * @param {{ failedAssets?: { url: string, status?: number }[], missingBlobs?: string[] }} ref
 */
export function referenceIncomplete(ref) {
  const failed = ref.failedAssets?.length ? ref.failedAssets.map((a) => (a.status ? `${a.url} (${a.status})` : a.url)) : (ref.missingBlobs ?? []).map((id) => `/_blob/${id}`);
  if (!failed.length) return null;
  return `the reference is defective: ${failed.length} asset${failed.length === 1 ? '' : 's'} the board asks for did not load (${failed.join(', ')}), so the board did not fully render; a mismatch here would charge the missing asset to the app. Fix the reference (src/render-refs.mjs), do not read this pair as a judgement on the app.`;
}

/** 1 when the run must fail: any pair that is not PASS (FAIL, NO BOARD, DEFECTIVE REFERENCE, NOT COMPARED, BROWSER MISMATCH, NO PROVENANCE), unless strict is off. */
export function exitCodeFor(pairs, strict = true) {
  return strict && pairs.some((p) => p.verdict !== 'PASS') ? 1 : 0;
}

/** Why a web capture and its board came from different browsers, or null. Device captures have no browser. */
export function captureBrowserProblem(ref, app, captureFile) {
  if (!BROWSER_APPS.includes(app)) return null;
  return browserMismatch(ref, readSidecar(captureFile));
}

function readSidecar(captureFile) {
  const sidecar = captureFile.replace(/\.png$/, '.capture.json');
  try {
    return existsSync(sidecar) ? JSON.parse(readFileSync(sidecar, 'utf8')) : null;
  } catch {
    return null;
  }
}

/** Why a native capture is untrusted (no device or app build recorded), or null. Web captures: null. */
export function captureProvenanceProblem(app, captureFile) {
  return BROWSER_APPS.includes(app) ? null : provenanceProblem(readSidecar(captureFile));
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
    const unusable = unusableReference(ref, o.refs);
    if (unusable) {
      pairs.push({ ...base, verdict: 'NO BOARD', reason: unusable });
      console.log(`${'NO BOARD'.padEnd(12)} ${''.padStart(8)}    ${c.id}  (${c.rel})  ${unusable}`);
      continue;
    }
    const defective = referenceIncomplete(ref);
    if (defective) {
      pairs.push({ ...base, verdict: 'DEFECTIVE REFERENCE', reason: defective, failedAssets: ref.failedAssets ?? (ref.missingBlobs ?? []).map((id) => ({ url: `/_blob/${id}` })) });
      console.log(`${'DEFECTIVE REFERENCE'.padEnd(12)} ${''.padStart(8)}    ${c.id}  (${c.rel})  ${defective}`);
      continue;
    }
    const wrongBrowser = captureBrowserProblem(ref, app, c.file);
    if (wrongBrowser) {
      pairs.push({ ...base, verdict: 'BROWSER MISMATCH', reason: wrongBrowser });
      console.log(`${'BROWSER MISMATCH'.padEnd(12)} ${''.padStart(8)}    ${c.id}  (${c.rel})  ${wrongBrowser}`);
      continue;
    }
    const noProvenance = captureProvenanceProblem(app, c.file);
    if (noProvenance) {
      pairs.push({ ...base, verdict: 'NO PROVENANCE', reason: noProvenance });
      console.log(`${'NO PROVENANCE'.padEnd(12)} ${''.padStart(8)}    ${c.id}  (${c.rel})  ${noProvenance}`);
      continue;
    }
    let shot = readPng(c.file);
    if (cut) shot = crop(shot, 0, cut.top, shot.width, shot.height - cut.top - cut.bottom);
    const r = compare(readPng(path.join(o.refs, ref.file)), shot, { scale: ref.scale, ...thresholds });
    if (!BROWSER_APPS.includes(app)) {
      // A native screen and an HTML board never agree pixel for pixel (different text rasterisers), so
      // a pixel verdict would be the wrong measurement. The geometry criterion is not built yet
      // (README, "Native boards"): the figure is shown for information and the pair is not compared.
      const info = r.mismatchPct ?? null;
      pairs.push({ ...base, verdict: 'NOT COMPARED', reason: 'native board: measured by layout geometry, which is not implemented yet (README, "Native boards"); pixels are not a criterion for it', informationalMismatchPct: info });
      console.log(`${'NOT COMPARED'.padEnd(12)} ${String(info ?? '').padStart(8)} %  ${c.id}  (${c.rel})  native: geometry criterion not implemented`);
      continue;
    }
    const pair = { ...base, size: `${ref.w}×${ref.h}`, scale: ref.scale, theme: ref.theme, notes: ref.notes, caveats: ref.caveats, missingBlobs: ref.missingBlobs, boardErrors: ref.errors, ...r, images: undefined };
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
  const captured = new Set(captures.map((c) => c.id));
  const uncaptured = Object.keys(manifest.boards).filter((id) => apps.has(id.split('/')[0]) && !captured.has(id)).sort();
  const results = {
    refs: o.refs,
    source: manifest.source,
    thresholds,
    crop: cut,
    pairs,
    uncaptured,
    areas: Object.fromEntries(Object.entries(manifest.areas).filter(([id]) => apps.has(id.split('/')[0]))),
    caveatBoards: Object.fromEntries(Object.entries(manifest.boards).filter(([id, b]) => apps.has(id.split('/')[0]) && b.caveats?.length).map(([id, b]) => [id, { title: b.title, caveats: b.caveats }])),
  };
  mkdirSync(o.out, { recursive: true });
  writeFileSync(path.join(o.out, 'results.json'), JSON.stringify(results, null, 1) + '\n');
  const count = (v) => pairs.filter((p) => p.verdict === v).length;
  console.log(`\n${pairs.length} captures: ${count('PASS')} pass, ${count('FAIL')} fail, ${count('NOT COMPARED')} not compared, ${count('NO BOARD')} without a board, ${count('DEFECTIVE REFERENCE')} with a defective reference, ${count('BROWSER MISMATCH')} from another browser than their board, ${count('NO PROVENANCE')} native without provenance. ${path.join(o.out, 'results.json')}`);
  console.log(`uncaptured boards: ${uncaptured.length}${uncaptured.length ? ` (${uncaptured.slice(0, 10).join(', ')}${uncaptured.length > 10 ? ', ...' : ''})` : ''}`);
  process.exitCode = exitCodeFor(pairs, o.strict);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(`diff: ${e.message}`);
    process.exit(2);
  }
}
