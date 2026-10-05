#!/usr/bin/env node
// Test coverage: measure it, never let it drop, hold floors where money and safety live.
// Issue: https://github.com/shaiknoorullah/hg-mono/issues/118
//
//   node .github/scripts/coverage.mjs collect [--go] [--js] [--only <name,…>] [--merge] [--fail-on-red]
//       Runs the Go and JS suites with coverage and writes coverage/.out/summary.json:
//       { files: { "<repo path>": { covered, total, pct, unit } }, runs: [...] }.
//       Go counts statements (what `go test -cover` measures); JS counts lines.
//       A red test does NOT stop collection: coverage is measured from whatever ran.
//       --fail-on-red: after writing the summary, exit 1 if any suite's tests were red. CI's
//       go and js jobs run their suites only this way, so one run both tests and measures
//       (issue #374); red tests fail those jobs (issue #42), never the coverage check.
//   node .github/scripts/coverage.mjs merge <summary.json …>
//       Adds summaries written by other jobs to coverage/.out/summary.json (created if
//       missing). CI's coverage job uses it to join what the go and js jobs measured.
//   node .github/scripts/coverage.mjs check [--base <git ref>] [--files <a,b,…>] [--all]
//       Ratchet: every changed file that has a baseline must not drop below it
//       (--all: every file in the baseline, for the weekly scan).
//       Floors: every area in coverage/floors.json must stay at or above its floor. An area
//       whose suite did not run is reported as not measured, not as a failure: in CI a suite
//       is skipped only when nothing it measures changed.
//       Writes coverage/.out/report.md (the PR comment) and exits 1 on any failure.
//   node .github/scripts/coverage.mjs update-baseline
//       Raises coverage/baseline.json to today's numbers. Never lowers an entry.
//       Adds new files, drops files that no longer exist.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'coverage', '.out');
const SUMMARY = join(OUT, 'summary.json');
const BASELINE = join(ROOT, 'coverage', 'baseline.json');
const FLOORS = join(ROOT, 'coverage', 'floors.json');
const REPORT = join(OUT, 'report.md');

// Percentage points a file may lose to rounding before the ratchet trips.
const EPSILON = 0.1;

const GO_DIR = 'services/hg';
const GO_MODULE = 'github.com/shaiknoorullah/hg-mono/services/hg';

// Every JS package with a test runner. `src` is what is measured; tests are excluded.
const JS = [
  { name: 'admin', dir: 'apps/admin', runner: 'vitest' },
  { name: 'restaurant', dir: 'apps/restaurant', runner: 'vitest' },
  { name: 'ui-web', dir: 'packages/ui-web', runner: 'vitest' },
  { name: 'emails', dir: 'packages/emails', runner: 'vitest' },
  { name: 'customer', dir: 'apps/customer', runner: 'jest' },
  { name: 'rider', dir: 'apps/rider', runner: 'jest' },
  { name: 'ui-native', dir: 'packages/ui-native', runner: 'jest' },
];

const round2 = (n) => Math.round(n * 100) / 100;
const pct = (covered, total) => (total === 0 ? 100 : round2((covered / total) * 100));
const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJSON = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true;
      else out[a.slice(2)] = argv[++i];
    } else out._.push(a);
  }
  return out;
}

function run(cmd, argv, cwd, env = {}) {
  console.log(`$ (${relative(ROOT, cwd) || '.'}) ${cmd} ${argv.join(' ')}`);
  const r = spawnSync(cmd, argv, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
  return r.status ?? 1;
}

// ---------------------------------------------------------------------------
// collect
// ---------------------------------------------------------------------------

function parseGoProfile(text) {
  // Lines: <import path>/<file>.go:<l>.<c>,<l>.<c> <statements> <count>
  // The same block can appear more than once; it is covered if any count > 0.
  const blocks = new Map();
  for (const line of text.split('\n')) {
    const m = /^(.+\.go):(\d+\.\d+,\d+\.\d+) (\d+) (\d+)$/.exec(line);
    if (!m) continue;
    const key = `${m[1]}:${m[2]}`;
    const prev = blocks.get(key);
    const hit = Number(m[4]) > 0;
    blocks.set(key, { file: m[1], stmts: Number(m[3]), hit: hit || (prev?.hit ?? false) });
  }
  const files = {};
  for (const b of blocks.values()) {
    if (!b.file.startsWith(GO_MODULE + '/')) continue;
    const path = `${GO_DIR}/${b.file.slice(GO_MODULE.length + 1)}`;
    const f = (files[path] ??= { covered: 0, total: 0, unit: 'statements' });
    f.total += b.stmts;
    if (b.hit) f.covered += b.stmts;
  }
  for (const f of Object.values(files)) f.pct = pct(f.covered, f.total);
  return files;
}

function collectGo() {
  const profile = join(OUT, 'go.out');
  // The same run as `make test` (go test -race ./...), with coverage on, so the go job tests
  // and measures in one pass. -race requires -covermode=atomic; a block still counts as
  // covered when its count is above zero, so the numbers equal `set` mode's. No -coverpkg:
  // each package is measured by its own tests only, as the baseline was.
  // No Postgres here: integration tests skip themselves (HG_TEST_POSTGRES_DSN unset),
  // so the numbers are the same on every machine and every run.
  const argv = ['test', '-race', '-covermode=atomic', `-coverprofile=${profile}`, './...'];
  const exit = run('go', argv, join(ROOT, GO_DIR), {
    HG_TEST_POSTGRES_DSN: '',
  });
  const files = existsSync(profile) ? parseGoProfile(readFileSync(profile, 'utf8')) : {};
  return { name: 'go', exit, files };
}

function parseIstanbulSummary(path, pkgDir) {
  const summary = readJSON(path);
  const files = {};
  for (const [abs, s] of Object.entries(summary)) {
    if (abs === 'total') continue;
    const rel = relative(ROOT, abs).split('\\').join('/');
    if (rel.startsWith('..') || !rel.startsWith(pkgDir + '/')) continue;
    files[rel] = { covered: s.lines.covered, total: s.lines.total, pct: pct(s.lines.covered, s.lines.total), unit: 'lines' };
  }
  return files;
}

function collectJs(pkg) {
  const dir = join(ROOT, pkg.dir);
  const reports = join(OUT, 'js', pkg.name);
  rmSync(reports, { recursive: true, force: true });
  mkdirSync(reports, { recursive: true });
  const bin = join(dir, 'node_modules', '.bin', pkg.runner);
  let exit;
  if (pkg.runner === 'vitest') {
    exit = run(bin, [
      'run',
      '--coverage.enabled',
      '--coverage.provider=v8',
      '--coverage.reporter=json-summary',
      `--coverage.reportsDirectory=${reports}`,
      '--coverage.reportOnFailure',
      '--coverage.include=src/**',
      '--coverage.exclude=**/*.test.{ts,tsx}',
      '--coverage.exclude=**/test-setup.ts',
    ], dir);
  } else {
    exit = run(bin, [
      '--coverage',
      '--coverageReporters=json-summary',
      `--coverageDirectory=${reports}`,
      '--collectCoverageFrom=src/**/*.{ts,tsx}',
      '--collectCoverageFrom=!src/**/__tests__/**',
      '--collectCoverageFrom=!src/**/*.d.ts',
      '--ci',
    ], dir);
  }
  const summary = join(reports, 'coverage-summary.json');
  const files = existsSync(summary) ? parseIstanbulSummary(summary, pkg.dir) : {};
  return { name: pkg.name, exit, files };
}

// CI's js job runs the JS tests only through this script, so every workspace package with a
// `test` script must be in JS, and its `test` script must be the runner this script starts.
// Otherwise a new package's tests would silently never run in CI. Returns the problems found.
function jsSuiteProblems() {
  const entries = [...readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8').matchAll(/^\s*-\s*['"]?([^'"\s#]+)['"]?\s*$/gm)];
  const dirs = [];
  for (const [, entry] of entries) {
    if (entry.startsWith('!')) continue;
    if (!entry.endsWith('/*')) {
      dirs.push(entry);
      continue;
    }
    const parent = entry.slice(0, -2);
    if (!existsSync(join(ROOT, parent))) continue;
    for (const d of readdirSync(join(ROOT, parent), { withFileTypes: true })) if (d.isDirectory()) dirs.push(`${parent}/${d.name}`);
  }
  const problems = [];
  for (const dir of dirs.sort()) {
    const manifest = join(ROOT, dir, 'package.json');
    const script = existsSync(manifest) ? readJSON(manifest).scripts?.test : undefined;
    if (!script) continue;
    const pkg = JS.find((p) => p.dir === dir);
    if (!pkg) {
      problems.push(`${dir} has a test script but is not in JS in .github/scripts/coverage.mjs, so CI would never run its tests. Add it.`);
      continue;
    }
    const expected = pkg.runner === 'vitest' ? 'vitest run' : 'jest';
    if (script !== expected) {
      problems.push(`${dir}: its test script is "${script}", but CI runs "${expected}" with coverage on (.github/scripts/coverage.mjs). Make them match.`);
    }
  }
  return problems;
}

function writeSummary(summary) {
  summary.files = Object.fromEntries(Object.entries(summary.files).sort(([a], [b]) => a.localeCompare(b)));
  writeJSON(SUMMARY, summary);
  console.log(`\ncoverage: ${Object.keys(summary.files).length} files → ${relative(ROOT, SUMMARY)}`);
  for (const r of summary.runs) {
    const note = r.testsExit === 0 ? 'tests green' : `tests exited ${r.testsExit} — coverage kept anyway`;
    console.log(`  ${r.name.padEnd(12)} ${String(r.files).padStart(4)} files  (${note})`);
  }
}

// Adds runs to a summary. A suite that ran again replaces its earlier run.
function addRuns(summary, runs, files) {
  summary.runs = summary.runs.filter((r) => !runs.some((x) => x.name === r.name)).concat(runs);
  Object.assign(summary.files, files);
  return summary;
}

function collect(opts) {
  mkdirSync(OUT, { recursive: true });
  const only = typeof opts.only === 'string' ? new Set(opts.only.split(',')) : null;
  const wantGo = opts.go || (!opts.go && !opts.js);
  const wantJs = opts.js || (!opts.go && !opts.js);
  if (wantJs) {
    const problems = jsSuiteProblems();
    if (problems.length) {
      for (const p of problems) console.error(`coverage: ${p}`);
      process.exit(1);
    }
  }
  const results = [];
  if (wantGo && (!only || only.has('go'))) results.push(collectGo());
  if (wantJs) for (const p of JS) if (!only || only.has(p.name)) results.push(collectJs(p));

  // Merge into an existing summary so suites can be collected in separate steps.
  const prev = existsSync(SUMMARY) && opts.merge ? readJSON(SUMMARY) : { files: {}, runs: [] };
  const runs = results.map((r) => ({ name: r.name, testsExit: r.exit, files: Object.keys(r.files).length }));
  writeSummary(addRuns(prev, runs, Object.assign({}, ...results.map((r) => r.files))));

  const red = runs.filter((r) => r.testsExit !== 0).map((r) => r.name);
  if (opts['fail-on-red'] && red.length) {
    console.error(`\ntests failed in: ${red.join(', ')} (see the output above). Coverage was still written to ${relative(ROOT, SUMMARY)}.`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------

function merge(paths) {
  const missing = paths.filter((p) => !existsSync(p));
  if (missing.length) {
    for (const p of missing) console.error(`coverage: ${p} is missing: the job that runs that suite ran but did not write its coverage. See that job's log.`);
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });
  let summary = existsSync(SUMMARY) ? readJSON(SUMMARY) : { files: {}, runs: [] };
  for (const p of paths) {
    const part = readJSON(p);
    summary = addRuns(summary, part.runs, part.files);
  }
  writeSummary(summary);
}

// ---------------------------------------------------------------------------
// floors
// ---------------------------------------------------------------------------

function matches(path, pattern) {
  // Patterns are repo paths. A trailing "/" means "files directly in this directory"
  // (one Go package); a trailing "*" is a prefix match.
  if (pattern.endsWith('/')) return path.startsWith(pattern) && !path.slice(pattern.length).includes('/');
  if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1));
  return path === pattern;
}

function isTestFile(path) {
  return /_test\.go$|\.test\.tsx?$|__tests__\//.test(path);
}

function areaCoverage(area, files) {
  let covered = 0;
  let total = 0;
  const hit = [];
  for (const [path, f] of Object.entries(files)) {
    if (isTestFile(path)) continue;
    if (!area.paths.some((p) => matches(path, p))) continue;
    if ((area.exclude ?? []).some((p) => matches(path, p))) continue;
    covered += f.covered;
    total += f.total;
    hit.push(path);
  }
  return { covered, total, pct: pct(covered, total), files: hit };
}

// The suite that measures a path: Go for services/hg, else the JS package it is in.
function suiteOf(path) {
  if (path.startsWith(GO_DIR + '/')) return 'go';
  return JS.find((p) => path.startsWith(p.dir + '/'))?.name;
}

function loadFloors() {
  // floors.json allows a "//" key per area as its comment line.
  return readJSON(FLOORS).floors;
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

function changedFiles(opts, baseline) {
  if (opts.all) return Object.keys(baseline).filter((p) => existsSync(join(ROOT, p))); // weekly full scan
  if (typeof opts.files === 'string') return opts.files.split(',').filter(Boolean);
  const base = typeof opts.base === 'string' ? opts.base : 'origin/main';
  const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  // Committed changes since the base, plus anything uncommitted (local runs and hooks).
  return [
    ...new Set([
      ...git('diff', '--name-only', '--diff-filter=AMR', `${base}...HEAD`),
      ...git('diff', '--name-only', '--diff-filter=AMR', 'HEAD'),
    ]),
  ];
}

const fmt = (n) => `${n.toFixed(1)}%`;

function check(opts) {
  const summary = readJSON(SUMMARY);
  const baseline = existsSync(BASELINE) ? readJSON(BASELINE).files : {};
  const floors = loadFloors();
  const changed = changedFiles(opts, baseline);

  const touched = [];
  const drops = [];
  for (const path of changed) {
    const now = summary.files[path];
    const was = baseline[path] === undefined ? undefined : { pct: baseline[path] };
    if (!now && !was) continue; // not source we measure
    if (was && !now) {
      // Measured before, not now: its suite crashed before writing coverage.
      drops.push({ path, was: was.pct, now: null });
      touched.push({ path, was: was.pct, now: null, ok: false });
      continue;
    }
    const ok = was === undefined || now.pct + EPSILON >= was.pct;
    if (!ok) drops.push({ path, was: was.pct, now: now.pct });
    touched.push({ path, was: was?.pct, now: now.pct, ok });
  }

  // A floor is checked when a suite that measures it ran. In CI a suite is skipped only when
  // nothing it measures changed (issue #374), so its floors still hold at main's numbers.
  // An area no suite owns is always checked, and fails with nothing measured.
  const ran = new Set(summary.runs.map((r) => r.name));
  const floorRows = [];
  for (const [name, area] of Object.entries(floors)) {
    const suites = new Set(area.paths.map(suiteOf).filter(Boolean));
    if (suites.size > 0 && ![...suites].some((s) => ran.has(s))) {
      floorRows.push({ name, floor: area.floor, notRun: [...suites].join(', '), ok: true });
      continue;
    }
    const c = areaCoverage(area, summary.files);
    floorRows.push({ name, floor: area.floor, ...c, ok: c.total > 0 && c.pct + EPSILON >= area.floor });
  }

  const failed = drops.length > 0 || floorRows.some((r) => !r.ok);
  const lines = ['<!-- coverage-report -->', `## Coverage ${failed ? '— failing' : '— ok'}`, ''];
  lines.push('**Money and safety floors** (fixed minimums, [issue #118](https://github.com/shaiknoorullah/hg-mono/issues/118))', '');
  lines.push('| Area | Coverage | Floor | |', '|---|---:|---:|---|');
  for (const r of floorRows) {
    if (r.notRun) lines.push(`| ${r.name} | not measured | ${r.floor}% | ${r.notRun} did not run: nothing it measures changed |`);
    else lines.push(`| ${r.name} | ${fmt(r.pct)} | ${r.floor}% | ${r.ok ? 'ok' : '**below floor**'} |`);
  }
  lines.push('');
  if (touched.length === 0) {
    lines.push('No measured source files changed.');
  } else {
    const heading = opts.all ? 'Every file in the baseline' : 'Files this PR changes';
    lines.push(`**${heading}** (must not drop below the committed baseline)`, '');
    lines.push('| File | Baseline | Now | |', '|---|---:|---:|---|');
    const shown = [...touched].sort((a, b) => Number(a.ok) - Number(b.ok)).slice(0, 40);
    for (const t of shown) {
      const was = t.was === undefined ? 'new' : fmt(t.was);
      const now = t.now === null ? 'not measured' : fmt(t.now);
      const delta = t.was !== undefined && t.now !== null ? t.now - t.was : 0;
      const mark = !t.ok ? '**dropped**' : delta > EPSILON ? 'up' : '';
      lines.push(`| \`${t.path}\` | ${was} | ${now} | ${mark} |`);
    }
    if (touched.length > shown.length) lines.push('', `…and ${touched.length - shown.length} more files, all ok.`);
  }
  const red = summary.runs.filter((r) => r.testsExit !== 0).map((r) => r.name);
  if (red.length) {
    lines.push('', `Tests were red in: ${red.join(', ')}. Coverage was still measured; the \`go\` and \`js\` checks are the ones that fail on red tests.`);
  }
  lines.push('', 'Go counts statements, JS counts lines. Baseline: `coverage/baseline.json` (only moves up, from main). Floors: `coverage/floors.json`.');
  mkdirSync(OUT, { recursive: true });
  writeFileSync(REPORT, lines.join('\n') + '\n');

  // One finding per failure, for the weekly scan to file as issues (deduped by title).
  const findings = [
    ...drops.map((d) => ({
      title: `coverage: ${d.path} fell below its baseline`,
      body: `\`${d.path}\` is ${d.now === null ? 'no longer measured' : fmt(d.now)} against a baseline of ${fmt(d.was)} (\`coverage/baseline.json\`). Add a test or restore the covered code. Found by the weekly coverage scan, issue #118.`,
    })),
    ...floorRows
      .filter((r) => !r.ok)
      .map((r) => ({
        title: `coverage: ${r.name} is below its ${r.floor}% floor`,
        body: `${r.name} coverage is ${fmt(r.pct)}; its fixed floor is ${r.floor}% (\`coverage/floors.json\`). Money and safety code keeps its floor. Found by the weekly coverage scan, issue #118.`,
      })),
  ];
  writeJSON(join(OUT, 'findings.json'), findings);

  console.log(lines.slice(1).join('\n'));
  if (failed) {
    console.error('\ncoverage: FAILED');
    for (const d of drops) console.error(`  ${d.path}: ${d.now === null ? 'no longer measured' : `${fmt(d.now)} < baseline ${fmt(d.was)}`}`);
    for (const r of floorRows.filter((x) => !x.ok)) console.error(`  floor ${r.name}: ${fmt(r.pct)} < ${r.floor}%`);
    process.exit(1);
  }
  console.log('\ncoverage: ok');
}

// ---------------------------------------------------------------------------
// update-baseline
// ---------------------------------------------------------------------------

function updateBaseline() {
  const summary = readJSON(SUMMARY);
  const old = existsSync(BASELINE) ? readJSON(BASELINE).files : {};
  const next = {};
  let raised = 0;
  let added = 0;
  let removed = 0;
  const paths = new Set([...Object.keys(old), ...Object.keys(summary.files)]);
  for (const path of [...paths].sort()) {
    if (!existsSync(join(ROOT, path))) {
      if (old[path]) removed++;
      continue;
    }
    const was = old[path];
    const now = summary.files[path];
    if (!now) {
      next[path] = was; // not measured this run: keep, never lower
      continue;
    }
    if (was === undefined) {
      next[path] = now.pct;
      added++;
    } else if (now.pct > was) {
      next[path] = now.pct;
      raised++;
    } else {
      next[path] = was;
    }
  }
  // One file per line keeps the diff of a baseline update readable.
  const body = Object.entries(next).map(([k, v]) => `    ${JSON.stringify(k)}: ${v}`).join(',\n');
  const note = 'Per-file coverage percent the ratchet holds (Go: statements, JS: lines). Only moves up: run `pnpm coverage` then `pnpm coverage:update-baseline`. Issue #118.';
  writeFileSync(BASELINE, `{\n  "//": ${JSON.stringify(note)},\n  "files": {\n${body}\n  }\n}\n`);
  console.log(`baseline: ${Object.keys(next).length} files — ${raised} raised, ${added} added, ${removed} removed, none lowered`);
}

// ---------------------------------------------------------------------------

const [cmd, ...rest] = process.argv.slice(2);
const opts = args(rest);
if (cmd === 'collect') collect(opts);
else if (cmd === 'merge') merge(rest);
else if (cmd === 'check') check(opts);
else if (cmd === 'update-baseline') updateBaseline();
else if (cmd === 'floors') {
  const summary = readJSON(SUMMARY);
  for (const [name, area] of Object.entries(loadFloors())) {
    const c = areaCoverage(area, summary.files);
    console.log(`${name.padEnd(22)} ${fmt(c.pct).padStart(7)}  floor ${area.floor}%  (${c.files.length} files, ${c.covered}/${c.total})`);
  }
} else {
  console.error('usage: coverage.mjs collect|merge|check|update-baseline|floors');
  process.exit(2);
}
