#!/usr/bin/env node
/**
 * The guard that keeps the redesign out of release builds.
 *
 * Release 1.0 ships the current screens. The redesign merges behind a build-time flag,
 * `VITE_HG_REDESIGN` (restaurant, admin) and `EXPO_PUBLIC_HG_REDESIGN` (customer, rider): "1" is
 * on, anything else is off (tools/e2e/README.md, Redesign). release-builds.yml pins both to "0"
 * and runs this twice:
 *
 *   node scripts/release/redesign-off.cjs env <app>          before the build
 *       both flags are exactly "0" in this environment, and no .env file in the repository root
 *       or apps/<app>/ turns either on
 *   node scripts/release/redesign-off.cjs bundle <path>...   after the build (a file or a folder)
 *       both flags are still "0", and the built JavaScript shows no sign of the flag compiled on:
 *       the marker REDESIGN_MARKER, or an inlined env object holding HG_REDESIGN "1"
 *
 * A flag compiled to a constant leaves nothing in a minified bundle: `"0" === "1"` folds to
 * `false`. So the env check is the guard, scripts/release/app-env.cjs refuses a prod build with
 * the flag on (app.config.js runs it for every native build), and the bundle check catches what
 * gets past both. The marker makes it positive: an app's flag module that logs it inside
 * `if (REDESIGN)` puts it in a flag-on bundle only, and e2e.yml checks it is absent from the
 * flag-off APK and reports whether the flag-on APK carries it.
 *
 * The native design captures have a dev-only entry behind a third build flag,
 * `EXPO_PUBLIC_HG_CAPTURE` (apps/<app>/src/redesign/capture/, https://github.com/shaiknoorullah/hg-mono/issues/1141).
 * A release build must not carry it: `env` refuses the flag when it is "1" (or anything but unset,
 * "" or "0"), including in a .env file, and `bundle` refuses a bundle that holds the entry's link
 * host, the string `__capture`. Unlike the redesign flags it is not pinned to "0": release-builds.yml
 * leaves it unset, and the guard is that it stays so.
 *
 * CommonJS, no dependencies: it runs before `pnpm install`.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FLAGS = ['EXPO_PUBLIC_HG_REDESIGN', 'VITE_HG_REDESIGN'];
const REDESIGN_MARKER = 'hg-redesign:on';
// The capture entry (customer and rider `redesign/capture/entry.ts`) matches links to this host. A
// bundle made without the flag has no such string; a capture build always does.
const CAPTURE_FLAG = 'EXPO_PUBLIC_HG_CAPTURE';
const CAPTURE_MARKER = '__capture';
const CAPTURE_LINE_SET = /^\s*(?:export\s+)?EXPO_PUBLIC_HG_CAPTURE\s*=\s*["']?(?!0?["']?\s*(?:#.*)?$)\S/m;
// An inlined env object (Vite's `import.meta.env`, a serialised `process.env`) with a flag on:
// VITE_HG_REDESIGN:"1", "EXPO_PUBLIC_HG_REDESIGN":"1", HG_REDESIGN='1' and so on.
const INLINED_ON = /HG_REDESIGN["']?\s*[:=]\s*["']1["']/;
const ENV_LINE_ON = /^\s*(?:export\s+)?(EXPO_PUBLIC_HG_REDESIGN|VITE_HG_REDESIGN)\s*=\s*["']?1["']?\s*(?:#.*)?$/m;

/**
 * Problems with the flags in this environment: each redesign flag must be exactly "0", and the
 * capture flag must be off (unset, "" or "0").
 */
function envProblems(env = process.env) {
  const problems = FLAGS.filter((k) => env[k] !== '0').map(
    (k) => `${k} is ${env[k] === undefined ? 'unset' : `"${env[k]}"`}: a release build pins it to "0"`,
  );
  if (env[CAPTURE_FLAG] !== undefined && env[CAPTURE_FLAG] !== '' && env[CAPTURE_FLAG] !== '0') {
    problems.push(`${CAPTURE_FLAG} is "${env[CAPTURE_FLAG]}": the design-capture entry is for dev builds only, a release build leaves it unset`);
  }
  return problems;
}

/** .env files (not .env.example) in these folders that turn a flag on. */
function dotenvProblems(dirs) {
  const problems = [];
  for (const dir of dirs) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/^\.env(\..+)?$/.test(name) || name === '.env.example') continue;
      const file = path.join(dir, name);
      const text = fs.readFileSync(file, 'utf8');
      const m = ENV_LINE_ON.exec(text);
      if (m) problems.push(`${file} sets ${m[1]}=1`);
      if (CAPTURE_LINE_SET.test(text)) problems.push(`${file} turns on ${CAPTURE_FLAG}`);
    }
  }
  return problems;
}

function filesUnder(p) {
  const stat = fs.statSync(p);
  if (!stat.isDirectory()) return [p];
  return fs.readdirSync(p).flatMap((name) => filesUnder(path.join(p, name)));
}

/** Signs of the flag compiled on, in built JavaScript (text or Hermes bytecode). */
function bundleProblems(paths) {
  const problems = [];
  for (const file of paths.flatMap(filesUnder)) {
    if (!/\.(m?js|bundle|hbc|html)$/.test(file)) continue;
    const text = fs.readFileSync(file).toString('latin1');
    if (text.includes(REDESIGN_MARKER)) problems.push(`${file} contains the redesign marker "${REDESIGN_MARKER}"`);
    const m = INLINED_ON.exec(text);
    if (m) problems.push(`${file} contains ${m[0]}`);
    if (text.includes(CAPTURE_MARKER)) problems.push(`${file} contains the design-capture entry ("${CAPTURE_MARKER}")`);
  }
  return problems;
}

function main(argv, env = process.env) {
  const [what, ...rest] = argv;
  let problems;
  if (what === 'env' && rest.length === 1) {
    const root = path.join(__dirname, '..', '..');
    problems = [...envProblems(env), ...dotenvProblems([root, path.join(root, 'apps', rest[0])])];
  } else if (what === 'bundle' && rest.length > 0) {
    problems = [...envProblems(env), ...bundleProblems(rest)];
  } else {
    console.error('usage: redesign-off.cjs env <app> | redesign-off.cjs bundle <file-or-folder>...');
    return 2;
  }
  for (const p of problems) {
    console.log(`::error title=Redesign flag on in a release build::${p}`);
  }
  if (problems.length === 0) console.log(`The redesign is off (${what}).`);
  return problems.length === 0 ? 0 : 1;
}

module.exports = { FLAGS, REDESIGN_MARKER, CAPTURE_FLAG, CAPTURE_MARKER, envProblems, dotenvProblems, bundleProblems, main };

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
