#!/usr/bin/env node
// Docs must not point at things that are gone.
//
// Checks every doc (tracked *.md and docs/**/*.html, minus third-party skill content)
// for references that no longer resolve:
//
//   path   a backticked repo path (apps/…, packages/…, services/…, docs/…, contracts/…,
//          tools/…, deploy/…) or a link to this repo on github.com that does not exist.
//          Globs (*, **, {a,b}), placeholders (<name>, {id}) and ellipses (…) are allowed.
//   make   `make <target>` naming a target services/hg/Makefile does not define.
//   pnpm   `pnpm <script>`, `pnpm -r <script>`, `pnpm --filter X <script>` naming a script
//          (or a filtered package) that no package.json defines.
//   env    an HG_* variable that neither services/hg/internal/config/config.go nor
//          deploy/.env.example knows.
//   issue  #123 on a line that calls it pending / open / blocked, when the issue is closed.
//          Needs the GitHub API, so it runs only in CI with a token (skipped locally).
//   link   broken relative links and #anchors, found by lychee and merged in with --lychee.
//
// Existing findings live in tools/doc-refs/baseline.json; only findings missing from it fail.
//
// Usage:
//   node tools/doc-refs/check.mjs                      all docs
//   node tools/doc-refs/check.mjs a.md b.md            only these docs
//   node tools/doc-refs/check.mjs --files-from list    docs listed in a file, one per line
//     --lychee out.json      merge lychee's JSON output as `link` findings
//     --issue-files-from f   check issue refs only in the docs listed in f (a PR's own changes:
//                            closing an issue must not fail somebody else's PR)
//     --update-baseline      rewrite the baseline to exactly today's findings
//     --report new.json      write the new (not baselined) findings as JSON
//     --file-issues          open one GitHub issue per new finding (weekly scan; needs gh)
//     --root DIR             repository root (default: this file's ../..)
//
// Plain Node, no dependencies. Exit 1 when there are new findings.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// arguments

const argv = process.argv.slice(2);
const opts = { files: [], issueFiles: null, lychee: [], update: false, report: null, fileIssues: false, root: null, baseline: null };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--lychee') opts.lychee.push(argv[++i]);
  else if (a === '--files-from') opts.files.push(...readList(argv[++i]));
  else if (a === '--issue-files-from') opts.issueFiles = new Set(readList(argv[++i]).map((f) => f.replace(/^\.\//, '')));
  else if (a === '--update-baseline') opts.update = true;
  else if (a === '--report') opts.report = argv[++i];
  else if (a === '--file-issues') opts.fileIssues = true;
  else if (a === '--root') opts.root = argv[++i];
  else if (a === '--baseline') opts.baseline = argv[++i];
  else if (a.startsWith('--')) die(`unknown option ${a}`);
  else opts.files.push(a);
}

const ROOT = path.resolve(opts.root ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
const BASELINE = path.resolve(ROOT, opts.baseline ?? 'tools/doc-refs/baseline.json');
const REPO = process.env.GITHUB_REPOSITORY || 'shaiknoorullah/hg-mono';

function die(msg) {
  console.error(`doc-refs: ${msg}`);
  process.exit(2);
}
function readList(file) {
  return fs.readFileSync(file, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
}
function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

// ---------------------------------------------------------------------------
// which docs

// Never scanned: vendored third-party skill content (its references point into other projects).
const EXCLUDE = [/^\.claude\/skills\//, /(^|\/)node_modules\//];
const isDoc = (f) => (/\.md$/i.test(f) || /^docs\/.*\.html?$/i.test(f)) && !EXCLUDE.some((re) => re.test(f));

// Scanned by lychee (their links must still resolve) but not for stale references, because
// the paths, targets and variables they name belong to a different codebase on purpose.
const NOT_THIS_REPO = [
  // forensic reports on the three old repos this one replaced (hg-api, halal-goes, hg-docker)
  /^docs\/analysis\/legacy-system\//,
  // the evaluation of ts-monorepo-template, a different repo's layout
  /^docs\/analysis\/base-evaluation\//,
  // the six competing operating models; the losing ones describe layouts never built
  /^docs\/planning\/plan-[A-F]-[^/]*\.md$/,
];

function git(args, input) {
  try {
    return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', input, maxBuffer: 64 << 20, stdio: ['pipe', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

// Every tracked file; outside a git checkout (the tests), every file on disk.
function listFiles() {
  const out = git(['ls-files', '-z']);
  if (out !== null) return out.split('\0').filter(Boolean).filter((f) => fs.existsSync(path.join(ROOT, f)));
  const acc = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p);
      else acc.push(p);
    }
  })('');
  return acc;
}

const ALL_FILES = listFiles();
const FILE_SET = new Set(ALL_FILES);
const DIR_SET = new Set();
for (const f of ALL_FILES) for (let d = path.posix.dirname(f); d !== '.'; d = path.posix.dirname(d)) DIR_SET.add(d);

const docs = (opts.files.length ? opts.files.map((f) => f.replace(/^\.\//, '')) : ALL_FILES)
  .filter(isDoc)
  .filter((f) => !NOT_THIS_REPO.some((re) => re.test(f)))
  .filter((f) => fs.existsSync(path.join(ROOT, f)))
  // a symlinked doc (CLAUDE.md -> AGENTS.md) is checked once, as its target
  .filter((f) => !fs.lstatSync(path.join(ROOT, f)).isSymbolicLink());

// ---------------------------------------------------------------------------
// what exists

const MAKEFILE = 'services/hg/Makefile';
const makeTargets = new Set();
if (fs.existsSync(path.join(ROOT, MAKEFILE))) {
  for (const line of fs.readFileSync(path.join(ROOT, MAKEFILE), 'utf8').split('\n')) {
    const m = /^([A-Za-z0-9_.%/-]+(?:\s+[A-Za-z0-9_.%/-]+)*)\s*::?(?!=)/.exec(line);
    if (m && !line.startsWith('\t')) for (const t of m[1].split(/\s+/)) if (!t.startsWith('.')) makeTargets.add(t);
  }
}

// Every package.json in the workspace: name, dir, scripts, dependency names.
const packages = ALL_FILES.filter((f) => /(^|\/)package\.json$/.test(f) && !f.includes('node_modules/'))
  .map((f) => {
    let j;
    try {
      j = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    } catch {
      return null;
    }
    const dir = path.posix.dirname(f);
    return {
      name: j.name ?? dir,
      dir: dir === '.' ? '' : dir,
      scripts: new Set(Object.keys(j.scripts ?? {})),
      deps: new Set([...Object.keys(j.dependencies ?? {}), ...Object.keys(j.devDependencies ?? {})]),
    };
  })
  .filter(Boolean);
const rootPkg = packages.find((p) => p.dir === '');
const allDeps = new Set(packages.flatMap((p) => [...p.deps]));

// pnpm's own commands: never scripts.
const PNPM_BUILTINS = new Set(
  ('add install i update up upgrade remove rm uninstall un link ln unlink import rebuild rb prune fetch patch patch-commit ' +
    'patch-remove audit list ls outdated why licenses exec dlx create init publish pack store root bin server env setup ' +
    'config c doctor deploy approve-builds self-update help dedupe ignored-builds cat-file cat-index find-hash sbom ' +
    'catalog recursive run-p version')
    .split(' '),
);
// `pnpm <bin>` falls through to `pnpm exec <bin>` when no script has that name.
const KNOWN_BINS = new Set('tsc tsx vitest jest eslint prettier playwright expo next vite astro turbo storybook node npx wrangler vercel biome oxlint knip'.split(' '));

// HG_* variables: the config loader and the example env, plus any the Go code reads directly
// (os.Getenv / os.LookupEnv — e.g. HG_TEST_POSTGRES_DSN in the integration tests).
const envKnown = new Set();
for (const f of ['services/hg/internal/config/config.go', 'deploy/.env.example']) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) for (const m of fs.readFileSync(p, 'utf8').matchAll(/\bHG_[A-Z0-9_]*[A-Z0-9]\b/g)) envKnown.add(m[0]);
}
for (const f of ALL_FILES.filter((f) => f.startsWith('services/hg/') && f.endsWith('.go'))) {
  for (const m of fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/os\.(?:Getenv|LookupEnv)\("(HG_[A-Z0-9_]+)"\)/g)) envKnown.add(m[1]);
}

// ---------------------------------------------------------------------------
// extracting references

const PATH_PREFIX = /^(apps|packages|services|docs|contracts|tools|deploy)\//;

// Inline code, fenced blocks and <code>/<pre> — where paths and commands are written.
function codeSpans(text, isHtml) {
  const spans = [];
  const lineOf = (idx) => text.slice(0, idx).split('\n').length;
  if (isHtml) {
    for (const m of text.matchAll(/<(code|pre)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      spans.push({ text: decodeEntities(m[2].replace(/<[^>]+>/g, '')), line: lineOf(m.index), block: m[1].toLowerCase() === 'pre' });
    }
    return spans;
  }
  // Fenced blocks first, then blank them out so their backticks are not re-read as inline code.
  let rest = text.replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^\1\2[ \t]*$/gm, (all, _i, _f, body, off) => {
    spans.push({ text: body, line: lineOf(off) + 1, block: true });
    return all.replace(/[^\n]/g, ' ');
  });
  for (const m of rest.matchAll(/(`+)([^`\n]|[^`\n][\s\S]*?[^`])\1(?!`)/g)) {
    if (m[2].includes('\n\n')) continue;
    spans.push({ text: m[2].trim(), line: lineOf(m.index), block: false });
  }
  return spans;
}

function decodeEntities(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

// A path-looking token as written: strip quotes, trailing punctuation, :line and #anchor.
function cleanPath(tok) {
  let t = tok.replace(/^[("'[<]+/, '').replace(/^\.\//, '');
  t = t.replace(/[)"'\]>,;.:!?]+$/, '');
  t = t.replace(/#.*$/, '').replace(/:\d+(?:[-:]\d+)*$/, '').replace(/\?.*$/, '');
  t = t.replace(/(\.[A-Za-z0-9]+):[A-Za-z_][\w.*]*$/, '$1'); // file.go:FuncName -> file.go
  // An unbalanced trailing ")" belongs to the prose, a balanced one to the path (expo's "(tabs)").
  while (t.endsWith(')') && (t.match(/\(/g) || []).length < (t.match(/\)/g) || []).length) t = t.slice(0, -1);
  return t;
}

function pathExists(p) {
  const clean = p.replace(/\/+$/, '');
  if (FILE_SET.has(clean) || DIR_SET.has(clean) || fs.existsSync(path.join(ROOT, clean))) return true;
  if (!/[*?{}<>…]|\.\.\.|\[[^\]]*\]/.test(clean)) return false;
  // Treat it as a pattern: globs, <placeholders>, {id}, […] and ellipses match anything.
  let re = '';
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (clean.startsWith('**/', i)) (re += '(?:.*/)?'), (i += 2);
    else if (clean.startsWith('**', i)) (re += '.*'), i++;
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '…') re += '.*';
    else if (clean.startsWith('...', i)) (re += '.*'), (i += 2);
    else if (c === '<' || c === '[') {
      const close = clean.indexOf(c === '<' ? '>' : ']', i);
      if (close < 0) re += '\\' + c;
      else (re += '[^/]+'), (i = close);
    } else if (c === '{') {
      const close = clean.indexOf('}', i);
      if (close < 0) re += '\\{';
      else {
        const inner = clean.slice(i + 1, close);
        re += inner.includes(',') ? `(?:${inner.split(',').map(escapeRe).join('|')})` : '[^/]+';
        i = close;
      }
    } else re += escapeRe(c);
  }
  const rx = new RegExp(`^${re}/?$`);
  for (const f of FILE_SET) if (rx.test(f)) return true;
  for (const d of DIR_SET) if (rx.test(d)) return true;
  return false;
}
// A path .gitignore covers is a local-only or build output file (deploy/.env, bin/hg):
// docs may name it even though a fresh checkout does not have it.
const ignoredCache = new Map();
function isIgnored(p) {
  if (!ignoredCache.has(p)) ignoredCache.set(p, git(['check-ignore', '-q', '--no-index', p]) !== null);
  return ignoredCache.get(p);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

// Split shell-ish text into simple commands, tracking `cd` so `cd apps/x && pnpm dev` resolves.
function commands(text, docDir) {
  const out = [];
  for (const rawLine of text.split('\n')) {
    let cwd = null;
    const line = rawLine.replace(/\s#\s.*$/, '').replace(/^\s*[$>]\s+/, '');
    for (let seg of line.split(/&&|\|\||;|\|/)) {
      const words = seg.trim().replace(/^\(+/, '').split(/\s+/).filter(Boolean);
      while (words.length && /^[A-Z_][A-Z0-9_]*=/.test(words[0])) words.shift();
      if (!words.length) continue;
      if (words[0] === 'cd' && words[1]) {
        const target = words[1].replace(/^\.\//, '');
        cwd = path.posix.normalize(path.posix.join(cwd ?? '', target));
        if (cwd.startsWith('..')) cwd = path.posix.normalize(path.posix.join(docDir, target));
        continue;
      }
      out.push({ words, cwd });
    }
  }
  return out;
}

const isPlaceholder = (w) => /[<>{}…*]|\.\.\.|^\$/.test(w);

function checkMake(words, add) {
  const targets = [];
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (w === '-C' || w === '-f' || w === '--directory' || w === '--file') {
      i++;
      continue;
    }
    if (w.startsWith('-') || w.includes('=')) continue;
    if (!/^[a-z][a-z0-9_.-]*$/.test(w)) break;
    targets.push(w);
  }
  for (const t of targets) if (!makeTargets.has(t)) add('make', `make ${t}`, `${MAKEFILE} has no target "${t}"`);
}

function matchPackages(filter) {
  let f = filter.replace(/^\.\.\./, '').replace(/\.\.\.$/, '').replace(/^\^/, '').replace(/^\{(.*)\}$/, '$1').replace(/^\.\//, '').replace(/\/$/, '');
  const rx = new RegExp(`^${f.split('*').map(escapeRe).join('.*')}$`);
  return packages.filter((p) => rx.test(p.name) || rx.test(p.dir) || rx.test(p.name.replace(/^@[^/]+\//, '')));
}

function checkPnpm(words, cwd, docDir, add) {
  const filters = [];
  let recursive = false;
  let dir = null;
  let i = 1;
  for (; i < words.length; i++) {
    const w = words[i];
    if (w === '--filter' || w === '-F') filters.push(words[++i] ?? '');
    else if (w.startsWith('--filter=')) filters.push(w.slice(9));
    else if (w === '-r' || w === '--recursive') recursive = true;
    else if (w === '-C' || w === '--dir') dir = words[++i];
    else if (w === '-w' || w === '--workspace-root') dir = '.';
    else if (w === '--if-present') return;
    else if (w.startsWith('-')) continue;
    else break;
  }
  let cmd = words[i];
  if (!cmd || isPlaceholder(cmd)) return;
  if (cmd === 'run' || cmd === 'run-script') {
    const rest = words.slice(i + 1).filter((w) => !w.startsWith('-'));
    if (words.slice(i + 1).includes('--if-present')) return;
    cmd = rest[0];
    if (!cmd || isPlaceholder(cmd)) return;
  } else if (PNPM_BUILTINS.has(cmd)) return;
  const asBin = KNOWN_BINS.has(cmd) || allDeps.has(cmd);

  let candidates;
  if (filters.length) {
    candidates = [];
    for (const f of filters) {
      if (isPlaceholder(f) || !f) return;
      const hit = matchPackages(f);
      if (!hit.length) {
        add('pnpm', `pnpm --filter ${f}`, `no workspace package matches "${f}"`);
        return;
      }
      candidates.push(...hit);
    }
  } else if (recursive) candidates = packages;
  else {
    // Where the command would run: an explicit dir, a preceding `cd`, else the doc's own package.
    const at = path.posix.normalize(dir ?? cwd ?? docDir);
    candidates = [];
    for (let d = at === '.' ? '' : at; ; d = d.includes('/') ? path.posix.dirname(d) : '') {
      const p = packages.find((x) => x.dir === d);
      if (p) {
        candidates.push(p);
        break;
      }
      if (d === '') break;
    }
    if (rootPkg && !candidates.includes(rootPkg)) candidates.push(rootPkg);
  }
  if (candidates.some((p) => p.scripts.has(cmd)) || asBin) return;
  const where = filters.length ? filters.join(', ') : recursive ? 'any workspace package' : candidates.map((p) => p.name).join(' or ');
  add('pnpm', filters.length ? `pnpm --filter ${filters.join(' --filter ')} ${cmd}` : `pnpm ${cmd}`, `no "${cmd}" script in ${where}`);
}

const STATUS_WORDS = /\b(pending|blocked|blocker|blocking|blocks|awaiting|waiting on|waits on|open|todo|not started|in progress|tracked in|tracked by|follow-?up)\b/i;

function scan(doc) {
  const findings = [];
  const text = fs.readFileSync(path.join(ROOT, doc), 'utf8');
  const isHtml = /\.html?$/i.test(doc);
  const docDir = path.posix.dirname(doc) === '.' ? '' : path.posix.dirname(doc);
  const seen = new Set();
  const addAt = (line) => (kind, ref, detail) => {
    const k = `${kind}\0${ref}`;
    if (seen.has(k)) return;
    seen.add(k);
    findings.push({ kind, file: doc, ref, detail, line });
  };

  for (const span of codeSpans(text, isHtml)) {
    const add = addAt(span.line);
    // paths: every whitespace-separated token that starts with a top-level repo dir
    for (const tok of span.text.split(/\s+/)) {
      const p = cleanPath(tok);
      if (!PATH_PREFIX.test(p)) continue;
      if (!pathExists(p) && !isIgnored(p)) add('path', p, 'no such file or directory');
    }
    // commands: a code span is a command only if it starts with one; blocks are read line by line
    if (!span.block && !/^\s*(\$\s*)?([A-Z_]+=\S+\s+)*(cd|make|pnpm)\b/.test(span.text)) continue;
    for (const { words, cwd } of commands(span.text, docDir)) {
      if (words[0] === 'make') checkMake(words, add);
      else if (words[0] === 'pnpm') checkPnpm(words, cwd, docDir, add);
    }
  }

  // links to this repo on github.com: the path after blob/<ref>/ must exist
  const ghLink = new RegExp(`github\\.com/${escapeRe(REPO)}/(?:blob|tree)/[^/\\s)]+/([^\\s)"'<>#?]+)`, 'g');
  for (const m of text.matchAll(ghLink)) {
    const p = decodeURIComponent(m[1]).replace(/[.,;:]+$/, '');
    if (!pathExists(p)) addAt(text.slice(0, m.index).split('\n').length)('path', p, 'linked on github.com but no such file or directory');
  }

  const lines = text.split('\n');
  lines.forEach((l, idx) => {
    const add = addAt(idx + 1);
    for (const m of l.matchAll(/\bHG_[A-Z0-9_]*[A-Z0-9_]\b(\*?)/g)) {
      const name = m[0].replace(/\*$/, '');
      const known = m[1] || name.endsWith('_') ? [...envKnown].some((k) => k.startsWith(name)) : envKnown.has(name);
      if (!known) add('env', name, 'not in services/hg/internal/config/config.go or deploy/.env.example');
    }
  });

  const issueRefs = [];
  lines.forEach((l, idx) => {
    const plain = isHtml ? decodeEntities(l.replace(/<[^>]+>/g, ' ')) : l;
    if (!STATUS_WORDS.test(plain)) return;
    const nums = new Set();
    // Docs also number their own lists (invariant #7, contradiction #8), so a bare #N is not
    // an issue. It is one only after an issue word, or as a link to this repo's issues.
    const listed = /\b(?:issues?|PRs?|pull requests?|tracked (?:in|by)|blocked (?:on|by)|waiting on|waits on|depends on)\s+((?:#\d{1,5}\b(?:\s*(?:,|and|&|\/|or)\s*)?)+)/gi;
    for (const m of plain.matchAll(listed)) for (const n of m[1].matchAll(/#(\d+)/g)) nums.add(Number(n[1]));
    const own = new RegExp(`github\\.com/${escapeRe(REPO)}/(?:issues|pull)/(\\d+)`, 'g');
    for (const m of plain.matchAll(own)) nums.add(Number(m[1]));
    for (const n of nums) issueRefs.push({ n, line: idx + 1 });
  });
  return { findings, issueRefs };
}

// ---------------------------------------------------------------------------
// run

let findings = [];
const issueRefs = [];
for (const doc of docs) {
  const r = scan(doc);
  findings.push(...r.findings);
  if (!opts.issueFiles || opts.issueFiles.has(doc)) for (const ref of r.issueRefs) issueRefs.push({ ...ref, file: doc });
}

// Issues a doc calls open: only with a token, so a local run never needs the network.
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
let issuesChecked = false;
if (issueRefs.length && token && process.env.CI) {
  issuesChecked = true;
  const state = new Map();
  for (const n of new Set(issueRefs.map((r) => r.n))) {
    try {
      const out = execFileSync('gh', ['api', `repos/${REPO}/issues/${n}`, '--jq', '.state'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      state.set(n, out.trim());
    } catch {
      state.set(n, 'unknown');
    }
  }
  const seen = new Set();
  for (const r of issueRefs) {
    const k = `${r.file}#${r.n}`;
    if (state.get(r.n) !== 'closed' || seen.has(k)) continue;
    seen.add(k);
    findings.push({ kind: 'issue', file: r.file, ref: `#${r.n}`, detail: `the doc treats #${r.n} as open/pending, but it is closed`, line: r.line });
  }
}

// lychee: relative links and #anchors (and external links in the weekly scan)
for (const f of opts.lychee) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const [input, errs] of Object.entries(j.error_map ?? {})) {
    const file = path.isAbsolute(input) ? rel(input) : input.replace(/^\.\//, '');
    for (const e of errs) {
      let ref = e.url.startsWith('file://') ? rel(fileURLToPath(e.url.split('#')[0])) + (e.url.includes('#') ? '#' + e.url.split('#').slice(1).join('#') : '') : e.url;
      if (ref === 'error:') ref = `unparseable: ${e.status?.details ?? e.status?.text ?? ''}`.slice(0, 200);
      findings.push({ kind: 'link', file, ref, detail: e.status?.text ?? 'broken', line: e.span?.line });
    }
  }
}

const key = (f) => `${f.kind}\t${f.file}\t${f.ref}`;
const sortF = (a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
// One finding per (kind, file, ref): the same broken link three times in a doc is one fix.
findings = [...new Map(findings.map((f) => [key(f), f])).values()].sort(sortF);

if (opts.update) {
  const out = findings.map(({ kind, file, ref, detail }) => ({ kind, file, ref, detail }));
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify(out, null, 2) + '\n');
  console.log(`doc-refs: baseline written — ${out.length} existing finding(s) in ${rel(BASELINE)}`);
  process.exit(0);
}

const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : [];
const known = new Set(baseline.map(key));
const fresh = findings.filter((f) => !known.has(key(f)));
const scanned = new Set(docs);
const fixed = baseline.filter((b) => scanned.has(b.file) && b.kind !== 'link' && b.kind !== 'issue' && !findings.some((f) => key(f) === key(b)));

const counts = {};
for (const f of findings) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
console.log(
  `doc-refs: ${docs.length} doc(s), ${findings.length} finding(s) ${JSON.stringify(counts)}, ${findings.length - fresh.length} baselined, ${fresh.length} new` +
    (issueRefs.length && !issuesChecked ? ` (issue refs not checked: no token / not CI)` : ''),
);
if (fixed.length) console.log(`doc-refs: ${fixed.length} baseline entr${fixed.length === 1 ? 'y is' : 'ies are'} fixed — remove with --update-baseline`);

for (const f of fresh) {
  console.log(`  ${f.file}${f.line ? ':' + f.line : ''}  [${f.kind}] ${f.ref} — ${f.detail}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::error file=${f.file},line=${f.line ?? 1}::[${f.kind}] ${f.ref} — ${f.detail}`.replace(/\r?\n/g, ' '));
}
if (opts.report) fs.writeFileSync(opts.report, JSON.stringify(fresh, null, 2) + '\n');

if (opts.fileIssues) {
  const open = JSON.parse(execFileSync('gh', ['issue', 'list', '--repo', REPO, '--state', 'open', '--limit', '1000', '--json', 'title'], { encoding: 'utf8' }));
  const titles = new Set(open.map((i) => i.title));
  let made = 0;
  for (const f of fresh) {
    const title = `docs: broken ${f.kind} reference in ${f.file}: ${f.ref}`.slice(0, 250);
    if (titles.has(title)) continue;
    const body = [
      `The weekly docs scan found a reference that does not resolve.`,
      ``,
      `- **File:** https://github.com/${REPO}/blob/main/${f.file}${f.line ? `#L${f.line}` : ''}`,
      `- **Kind:** ${f.kind}`,
      `- **Reference:** \`${f.ref}\``,
      `- **Problem:** ${f.detail}`,
      ``,
      `Fix the doc (or the thing it points at). If it is intentional, add it to [the baseline](https://github.com/${REPO}/blob/main/tools/doc-refs/baseline.json) with \`node tools/doc-refs/check.mjs --update-baseline\`.`,
    ].join('\n');
    execFileSync('gh', ['issue', 'create', '--repo', REPO, '--title', title, '--label', 'docs', '--body', body], { stdio: 'inherit' });
    titles.add(title);
    made++;
  }
  console.log(`doc-refs: opened ${made} issue(s)`);
  process.exit(0);
}

process.exit(fresh.length ? 1 : 0);
