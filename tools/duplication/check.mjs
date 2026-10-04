#!/usr/bin/env node
// Duplication check for docs and code (issue #122).
//
// Copied text drifts apart and goes stale. This runs jscpd over the repo and fails on
// a copied block that a change introduced, printing both places so the author can keep
// one and link to it from the other.
//
//   node tools/duplication/check.mjs --base origin/main   # PR: clones touching files changed since base
//   node tools/duplication/check.mjs --staged             # git hook: clones touching staged files
//   node tools/duplication/check.mjs --all                # every clone not in the baseline
//   node tools/duplication/check.mjs --update-baseline    # rewrite tools/duplication/baseline.json
//   node tools/duplication/check.mjs --all --file-issues  # weekly: one issue per new clone group (--dry-run: print only)
//
// Shared settings (ignores, extensions) live in .jscpd.json. Size thresholds are per pass,
// below, because one number cannot fit prose, HTML and code (see PASSES).
//
// Needs only node and npx. jscpd is pinned and fetched by npx; nothing is added to the lockfile.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const JSCPD = 'jscpd@4.3.0';
const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const BASELINE = join(ROOT, 'tools/duplication/baseline.json');

// Thresholds were tuned on the repo as of Sep 2026 (see the PR for #122):
//
// - docs (markdown and HTML) are scanned as plain text: .jscpd.json maps them to jscpd's
//   `txt` format. jscpd's markdown grammar tokenises by context (a paragraph after a table
//   is swallowed into the table token, so a copy of it is never found), and its HTML
//   grammar makes every tag several tokens, so a copied 60-word <p> scored below the
//   page-head boilerplate. Plain text has neither problem.
//   A paragraph is one line, so min-lines is 1. 25 tokens is about 35 words, two ordinary
//   sentences. It finds the invariant list copied into README.md, the websocket event
//   table copied into the platform spec and the stylesheet copied between the HTML
//   reports; it does not match the shared <head> of the apps' index.html. At 20 the
//   repeated six-column table headers of the feature analyses start to match, which is
//   structure, not copied text.
// - code: at 50 tokens / 5 lines (jscpd's default) most matches are Go handler ladders
//   (auth check, error to status) that are the house style, not copies. At 100 tokens /
//   8 lines copied helpers and functions dominate (e.g. the policy helpers repeated
//   across routes.go files). Tests use the same bar: a copied test is still a copy.
const PASSES = [
  { name: 'docs', kind: 'docs', formats: 'txt', minTokens: 25, minLines: 1 },
  { name: 'code', kind: 'code', formats: 'typescript,tsx,javascript,jsx,go', minTokens: 100, minLines: 8 },
];

// ---------------------------------------------------------------- args
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const base = opt('--base');
const staged = flag('--staged');
const all = flag('--all');
const updateBaseline = flag('--update-baseline');
const fileIssues = flag('--file-issues');
if (!base && !staged && !all && !updateBaseline) {
  console.error('usage: check.mjs (--base <ref> | --staged | --all [--file-issues [--dry-run]] | --update-baseline)');
  process.exit(2);
}

// ---------------------------------------------------------------- scan
const h = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);

// jscpd scans a copy of the tracked files, not the checkout, for two reasons:
// - the same files everywhere: tracked files only, so a local build output or scratch file
//   never shows up locally and not in CI;
// - jscpd 4.3.0 misses a clone that runs to the very end of a file (a paragraph or function
//   appended at the bottom, the most common copy). Each copy gets one extra line, unique to
//   that file, so nothing real is ever last. Line numbers are unchanged.
// `**/` any directories (or none), `**` anything, `*` anything within one path segment.
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (glob.startsWith('**/', i)) (re += '(?:.*/)?'), (i += 2);
    else if (glob.startsWith('**', i)) (re += '.*'), (i += 1);
    else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function stageSources(dir) {
  const config = JSON.parse(readFileSync(join(ROOT, '.jscpd.json'), 'utf8'));
  const exts = new Set(Object.values(config.formatsExts).flat().map((e) => `.${e}`));
  // jscpd matches `ignore` against the absolute path of the copy, so repo-relative globs
  // would miss; apply them here, against the repo path, instead.
  const ignored = config.ignore.map(globToRegExp);
  const files = execFileSync('git', ['ls-files', '-z', '--cached'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((f) => f && exts.has(f.slice(f.lastIndexOf('.'))) && !ignored.some((re) => re.test(f)));
  for (const f of files) {
    const src = join(ROOT, f);
    if (!existsSync(src) || lstatSync(src).isSymbolicLink()) continue;
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    const text = readFileSync(src, 'utf8');
    writeFileSync(join(dir, f), `${text}${text.endsWith('\n') ? '' : '\n'}jscpd end of file ${h(f)}\n`);
  }
}

function runPass(pass, srcDir, outDir) {
  execFileSync(
    'npx',
    [
      '-y', JSCPD,
      '--config', join(ROOT, '.jscpd.json'),
      '--format', pass.formats,
      '--min-tokens', String(pass.minTokens),
      '--min-lines', String(pass.minLines),
      '--reporters', 'json',
      '--output', outDir,
      '--silent',
      '--noTips',
      '.',
    ],
    { cwd: srcDir, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, npm_config_loglevel: 'error' } },
  );
  return JSON.parse(readFileSync(join(outDir, 'jscpd-report.json'), 'utf8'));
}

const fileCache = new Map();
function fileLines(path) {
  if (!fileCache.has(path)) fileCache.set(path, readFileSync(join(ROOT, path), 'utf8').split('\n'));
  return fileCache.get(path);
}

// A clone is fingerprinted by its files and the hashes of the whole source lines it spans
// (trimmed, blanks dropped). Whole lines, not jscpd's fragment, so a clone whose edge moves
// by a token keeps its fingerprint; content, not line numbers, so edits elsewhere in the
// file do not matter.
function lineHashes(path, start, end) {
  return fileLines(path)
    .slice(start - 1, end)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(h);
}

function scan() {
  const tmp = mkdtempSync(join(tmpdir(), 'jscpd-'));
  const clones = [];
  const stats = { docs: { lines: 0, dup: 0 }, code: { lines: 0, dup: 0 } };
  try {
    const src = join(tmp, 'src');
    stageSources(src);
    for (const pass of PASSES) {
      const report = runPass(pass, src, join(tmp, `out-${pass.name}`));
      stats[pass.kind].lines += report.statistics.total.lines;
      stats[pass.kind].dup += report.statistics.total.duplicatedLines;
      for (const d of report.duplicates) {
        const sides = [d.firstFile, d.secondFile].map((f) => ({
          path: f.name.replace(/^\.\//, ''),
          start: f.start,
          end: f.end,
        }));
        sides.sort((a, b) => (a.path + a.start).localeCompare(b.path + b.start));
        const hashes = [...new Set(lineHashes(sides[0].path, sides[0].start, sides[0].end))];
        if (hashes.length === 0) continue;
        clones.push({
          pass: pass.name,
          // `txt` is how docs are scanned; name them by what they are.
          format: d.format === 'txt' ? sides[0].path.replace(/^.*\.(\w+)$/, '$1').replace(/^htm$/, 'html').replace(/^md$/, 'markdown') : d.format,
          sides,
          files: sides.map((s) => s.path),
          hashes,
          group: h(hashes.join(',')),
        });
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return { clones, stats };
}

// ---------------------------------------------------------------- baseline
function loadBaseline() {
  if (!existsSync(BASELINE)) return [];
  return JSON.parse(readFileSync(BASELINE, 'utf8')).clones;
}

// Covered = the baseline already has a clone between the same two files whose lines include
// all of this clone's lines. That lets a baselined clone shrink or split (someone edits one
// copy) without failing, while any new copied line between those files still fails.
function isCovered(clone, baseline) {
  return baseline.some(
    (b) =>
      b.files[0] === clone.files[0] &&
      b.files[1] === clone.files[1] &&
      clone.hashes.every((x) => b.hashSet.has(x)),
  );
}

function writeBaseline(clones) {
  const byKey = new Map();
  for (const c of clones) {
    const key = c.files.join('\0');
    const e = byKey.get(key) ?? { files: c.files, format: c.format, lines: new Set() };
    c.hashes.forEach((x) => e.lines.add(x));
    byKey.set(key, e);
  }
  const entries = [...byKey.values()]
    .map((e) => ({ files: e.files, format: e.format, lines: [...e.lines].sort() }))
    .sort((a, b) => a.files.join().localeCompare(b.files.join()));
  const doc = {
    comment:
      'Existing duplication, accepted so only new copies fail. Regenerate: node tools/duplication/check.mjs --update-baseline. Work this list to zero.',
    tool: JSCPD,
    clones: entries,
  };
  // One clone per line: the diff of a baseline change reads as "these pairs came or went".
  const head = JSON.stringify({ comment: doc.comment, tool: doc.tool }, null, 2).replace(/\n}$/, '');
  const rows = entries.map((e) => `    ${JSON.stringify(e)}`).join(',\n');
  writeFileSync(BASELINE, `${head},\n  "clones": [\n${rows}\n  ]\n}\n`);
  return entries.length;
}

// ---------------------------------------------------------------- changed files
function changedFiles() {
  const a = staged
    ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR']
    : ['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`];
  return new Set(execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean));
}

// ---------------------------------------------------------------- report
const pct = (s) => (s.lines ? ((100 * s.dup) / s.lines).toFixed(2) : '0.00');
const loc = (s) => `${s.path}:${s.start}-${s.end}`;

function printStats(stats) {
  console.log(`duplication: docs ${pct(stats.docs)}% (${stats.docs.dup}/${stats.docs.lines} lines), code ${pct(stats.code)}% (${stats.code.dup}/${stats.code.lines} lines)`);
}

function groupClones(clones) {
  const groups = new Map();
  for (const c of clones) {
    const g = groups.get(c.group) ?? { id: c.group, format: c.format, places: new Map() };
    for (const s of c.sides) g.places.set(`${s.path}:${s.start}`, s);
    groups.set(c.group, g);
  }
  return [...groups.values()];
}

// One issue per clone group (same copied lines, wherever they appear), deduped by the
// `[dup:<id>]` tag in the title against open AND closed issues, so a closed-as-accepted
// finding is not refiled.
function fileIssuesFor(groups, dryRun) {
  const existing = execFileSync('gh', ['issue', 'list', '--state', 'all', '--limit', '5000', '--json', 'title'], {
    encoding: 'utf8',
  });
  const titles = JSON.parse(existing).map((i) => i.title);
  const MAX = 20; // a bad week should not open hundreds of issues
  let opened = 0;
  for (const g of groups) {
    const tag = `[dup:${g.id}]`;
    if (titles.some((t) => t.includes(tag))) continue;
    if (opened >= MAX) {
      console.log(`issue cap (${MAX}) reached; the rest are filed next week`);
      break;
    }
    const places = [...g.places.values()];
    const title = `Duplicated ${g.format} block in ${places[0].path} and ${places.length - 1} other place(s) ${tag}`;
    const body = [
      'The weekly duplication scan found a copied block that is not in the baseline.',
      '',
      'Places:',
      ...places.map((p) => `- \`${loc(p)}\``),
      '',
      'Fix: keep one copy as the source and link to it (docs) or call it (code) from the others.',
      'Accepting it instead? Regenerate `tools/duplication/baseline.json` with `node tools/duplication/check.mjs --update-baseline` and say why in the PR.',
      '',
      'Filed by the duplication step of `.github/workflows/docs.yml` (issue #122).',
    ].join('\n');
    if (dryRun) console.log(`would open: ${title}\n${body}\n`);
    else execFileSync('gh', ['issue', 'create', '--title', title, '--body', body, '--label', 'chore'], { stdio: 'inherit' });
    opened++;
  }
  console.log(`issues ${dryRun ? 'that would be opened' : 'opened'}: ${opened}`);
}

// ---------------------------------------------------------------- main
const { clones, stats } = scan();
printStats(stats);

if (updateBaseline) {
  const n = writeBaseline(clones);
  console.log(`baseline: ${clones.length} clones across ${n} file pairs -> ${BASELINE.slice(ROOT.length + 1)}`);
  process.exit(0);
}

const baseline = loadBaseline().map((b) => ({ ...b, hashSet: new Set(b.lines) }));
let candidates = clones.filter((c) => !isCovered(c, baseline));
if (!all) {
  const changed = changedFiles();
  candidates = candidates.filter((c) => c.files.some((f) => changed.has(f)));
}

if (candidates.length === 0) {
  console.log('duplication: no new copied blocks');
  process.exit(0);
}

const gh = !!process.env.GITHUB_ACTIONS;
// Workflow-command escaping, so a file path cannot inject its own annotation or command.
const escData = (v) => String(v).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = (v) => escData(v).replace(/:/g, '%3A').replace(/,/g, '%2C');
console.log(`\nduplication: ${candidates.length} new copied block(s). Keep one copy and link to it (docs) or call it (code) from the other.\n`);
for (const c of candidates) {
  const [a, b] = c.sides;
  console.log(`  ${c.format}: ${loc(a)}  <->  ${loc(b)}`);
  if (gh) {
    for (const [x, y] of [[a, b], [b, a]]) {
      console.log(`::error file=${escProp(x.path)},line=${x.start},endLine=${x.end},title=Copied block::${escData(`Same text as ${loc(y)}. Keep one and link to it.`)}`);
    }
  }
}
console.log('\nIf the copy is intended, regenerate the baseline (node tools/duplication/check.mjs --update-baseline) and say why in the PR.');

if (fileIssues) fileIssuesFor(groupClones(candidates), flag('--dry-run'));
process.exit(fileIssues ? 0 : 1);
