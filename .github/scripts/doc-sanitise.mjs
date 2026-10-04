#!/usr/bin/env node
// Doc sanitise — issue #121. Three checks over docs (docs/**, root *.md,
// apps/*/README*), each with a committed baseline so only NEW problems fail:
//
//   wording  Vale, HalalGoes style (.vale/): the name is one word, no halal claim
//            that reads as a guarantee or a religious ruling, no emoji, spelling
//            against a project vocabulary.
//   codes    Internal codes (invariant 10, L-4, §4.1) written bare instead of
//            linked. Same detector as the PR-rules check (pr-rules.mjs).
//   secrets  gitleaks (.gitleaks.toml) over the whole repo, not just docs. On a
//            PR only the PR's own commits are scanned.
//
// CI (PR):   node .github/scripts/doc-sanitise.mjs check --base origin/main
// Hook:      node .github/scripts/doc-sanitise.mjs check --base origin/main   (pre-push)
// Weekly:    node .github/scripts/doc-sanitise.mjs check --all --json out.json
//            node .github/scripts/doc-sanitise.mjs issues --json out.json
// Baseline:  node .github/scripts/doc-sanitise.mjs baseline   (rewrites .github/doc-sanitise/*.json)
//
// Vale and gitleaks are taken from VALE_BIN / GITLEAKS_BIN, else PATH (at the
// pinned version), else downloaded once into ~/.cache/hg-doc-sanitise and
// checked against the release's SHA-256.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { bareCodes } from './pr-rules.mjs';

export const CHECKS = ['wording', 'codes', 'secrets'];
const BASELINE_DIR = '.github/doc-sanitise';
const ISSUE_CAP = 20; // per weekly run, so a rule change cannot open hundreds at once

export const TOOLS = {
  vale: {
    version: '3.23.0',
    url: (v, a) => `https://github.com/errata-ai/vale/releases/download/v${v}/vale_${v}_${a}.tar.gz`,
    assets: {
      'linux-x64': ['Linux_64-bit', 'cc35445a45186b8f0b01e11c01359694cf941e72cf6ab0fc44774f0e54c9d5fc'],
      'linux-arm64': ['Linux_arm64', '45720aadcb01401ac394641287a2c74e094045a89a450f5edcf98c8969df0884'],
      'darwin-x64': ['macOS_64-bit', '416fdd3ba32e32dc71c87b479cb86757bb6437bcebc7a3e4a095e863b7ce583d'],
      'darwin-arm64': ['macOS_arm64', 'b913574b2c83b541d8bc2d8938e53a58a2fb06bab15135efcc755afb074f4430'],
    },
    versionArgs: ['-v'],
  },
  gitleaks: {
    version: '8.30.1',
    url: (v, a) => `https://github.com/gitleaks/gitleaks/releases/download/v${v}/gitleaks_${v}_${a}.tar.gz`,
    assets: {
      'linux-x64': ['linux_x64', '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb'],
      'linux-arm64': ['linux_arm64', 'e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080'],
      'darwin-x64': ['darwin_x64', 'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709'],
      'darwin-arm64': ['darwin_arm64', 'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5'],
    },
    versionArgs: ['version'],
  },
};

// ---------------------------------------------------------------- scope

const EXCLUDE = [/^\.claude\//, /(^|\/)(node_modules|vendor|third[-_]party)\//];

/** Is this path a doc the wording and codes checks look at? */
export function inScope(path) {
  if (EXCLUDE.some((re) => re.test(path))) return false;
  return /^docs\/.+\.(md|html)$/.test(path) || /^[^/]+\.md$/.test(path) || /^apps\/[^/]+\/README[^/]*\.md$/.test(path);
}

// ---------------------------------------------------------------- codes

/** Blank out what is not prose in an HTML brief (keeping offsets, so line numbers hold),
 *  and turn <a> elements into something bareCodes treats as a link. */
export function htmlProse(html) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return html
    .replace(/<(script|style|code|pre)\b[\s\S]*?<\/\1>/gi, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/<a\b[^>]*\bhref=[^>]*>[\s\S]*?<\/a>/gi, blank)
    .replace(/<[^>]+>/g, blank);
}

export function codeFindings(file, text) {
  const prose = file.endsWith('.html') ? htmlProse(text) : text;
  return bareCodes(prose).map((code) => {
    const at = prose.indexOf(code);
    return { check: 'codes', file, line: at < 0 ? 1 : prose.slice(0, at).split('\n').length, rule: 'bare-code', match: code, key: code };
  });
}

// ---------------------------------------------------------------- baseline

/** { file: { key: count } } */
export function tally(findings) {
  const out = {};
  for (const f of findings) {
    out[f.file] ??= {};
    out[f.file][f.key] = (out[f.file][f.key] ?? 0) + 1;
  }
  return out;
}

/** Findings whose (file, key) count is above the baseline's. All occurrences of that key are returned. */
export function newFindings(findings, baseline) {
  const now = tally(findings);
  return findings.filter((f) => now[f.file][f.key] > (baseline[f.file]?.[f.key] ?? 0));
}

function sortedJson(obj) {
  const out = {};
  for (const f of Object.keys(obj).sort()) {
    out[f] = {};
    for (const k of Object.keys(obj[f]).sort()) out[f][k] = obj[f][k];
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

const baselinePath = (check) => join(BASELINE_DIR, `baseline-${check}.json`);
const readBaseline = (check) => (existsSync(baselinePath(check)) ? JSON.parse(readFileSync(baselinePath(check), 'utf8')) : {});
export const baselineSize = (b) => Object.values(b).reduce((s, m) => s + Object.values(m).reduce((a, n) => a + n, 0), 0);

// ---------------------------------------------------------------- tools

function platform() {
  const os = { linux: 'linux', darwin: 'darwin' }[process.platform];
  const arch = { x64: 'x64', arm64: 'arm64' }[process.arch];
  return os && arch ? `${os}-${arch}` : null;
}

function runs(bin, args) {
  const r = spawnSync(bin, args, { encoding: 'utf8' });
  return r.status === 0 ? `${r.stdout}${r.stderr}` : null;
}

export function tool(name) {
  const t = TOOLS[name];
  const env = process.env[`${name.toUpperCase()}_BIN`];
  if (env) return env;
  const onPath = runs(name, t.versionArgs);
  if (onPath?.includes(t.version)) return name;
  const plat = platform();
  if (!plat || !t.assets[plat]) throw new Error(`${name} ${t.version} is not on PATH and there is no pinned download for ${process.platform}-${process.arch}. Install it or set ${name.toUpperCase()}_BIN.`);
  const dir = join(process.env.HG_TOOLS_DIR ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'hg-doc-sanitise'), `${name}-${t.version}`);
  const bin = join(dir, name);
  if (existsSync(bin)) return bin;
  const [asset, sha] = t.assets[plat];
  mkdirSync(dir, { recursive: true });
  const tgz = join(dir, 'download.tar.gz');
  console.error(`downloading ${name} ${t.version} (${asset})…`);
  execFileSync('curl', ['-fsSL', '-o', tgz, t.url(t.version, asset)], { stdio: 'inherit' });
  const got = createHash('sha256').update(readFileSync(tgz)).digest('hex');
  if (got !== sha) {
    rmSync(tgz);
    throw new Error(`${name} download checksum mismatch: expected ${sha}, got ${got}`);
  }
  execFileSync('tar', ['-xzf', tgz, '-C', dir, name]);
  rmSync(tgz);
  return bin;
}

// ---------------------------------------------------------------- runners

function wordingFindings(files) {
  const vale = files.filter((f) => /\.(md|html)$/.test(f));
  if (!vale.length) return [];
  const out = [];
  for (let i = 0; i < vale.length; i += 200) {
    const r = spawnSync(tool('vale'), ['--output=JSON', '--no-exit', ...vale.slice(i, i + 200)], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`vale failed: ${r.stderr || r.stdout}`);
    const json = JSON.parse(r.stdout || '{}');
    if (json.Code) throw new Error(`vale: ${json.Text}`);
    for (const [file, alerts] of Object.entries(json)) {
      for (const a of alerts) out.push({ check: 'wording', file, line: a.Line, rule: a.Check, match: a.Match, message: a.Message, key: `${a.Check}: ${a.Match}` });
    }
  }
  return out;
}

/** mode: { all: true } | { staged: true } | { base: 'origin/main' } */
function secretFindings(mode) {
  const dir = mkdtempSync(join(tmpdir(), 'hg-gitleaks-'));
  const report = join(dir, 'report.json');
  const common = ['--no-banner', '--log-level', 'error', '--exit-code', '0', '-c', '.gitleaks.toml', '-f', 'json', '-r', report];
  const args = mode.all ? ['dir', '.', ...common] : mode.staged ? ['git', '--staged', ...common, '.'] : ['git', `--log-opts=${mode.base}..HEAD`, ...common, '.'];
  try {
    const r = spawnSync(tool('gitleaks'), args, { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`gitleaks failed: ${r.stderr || r.stdout}`);
    const found = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8') || '[]') : [];
    // The secret itself never leaves this function: the key is a short hash, the
    // printed match is redacted.
    return found.map((f) => {
      const hash = createHash('sha256').update(f.Secret).digest('hex').slice(0, 16);
      return { check: 'secrets', file: f.File, line: f.StartLine, rule: f.RuleID, match: `${f.RuleID} (sha256 ${hash})`, message: f.Description, key: `${f.RuleID} ${hash}`, commit: f.Commit || undefined };
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function isSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return true; // deleted: nothing to read
  }
}

function docFiles(mode) {
  const list = mode.all
    ? git(['ls-files'])
    : mode.staged
      ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
      : git(['diff', '--name-only', '--diff-filter=ACMR', `${mode.base}...HEAD`]);
  return list.split('\n').filter(Boolean).filter(inScope).filter((f) => !isSymlink(f)).sort();
}

export function scan(mode, only = CHECKS) {
  const files = docFiles(mode);
  const res = {};
  if (only.includes('wording')) res.wording = wordingFindings(files);
  if (only.includes('codes')) res.codes = files.flatMap((f) => codeFindings(f, readFileSync(f, 'utf8')));
  if (only.includes('secrets')) res.secrets = secretFindings(mode);
  return { files, res };
}

// ---------------------------------------------------------------- CLI

const HELP = {
  wording: 'Rules: .vale/styles/HalalGoes/. A real term flagged as spelling goes in .vale/styles/config/vocabularies/HalalGoes/accept.txt; a forbidden phrase quoted as an example goes in backticks.',
  codes: 'Write what the code means and link to where it is defined, e.g. [solid green is reserved for halal status (invariant 10)](https://github.com/shaiknoorullah/hg-mono/blob/main/AGENTS.md#3-non-negotiable-invariants).',
  secrets: 'Remove the secret and rotate it (it is in git history now). A value that is not a credential goes in .gitleaks.toml with a comment saying why.',
};

function cliArgs(argv) {
  const get = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return { cmd: argv[0], base: get('--base'), json: get('--json'), all: argv.includes('--all'), staged: argv.includes('--staged'), only: get('--only')?.split(',') };
}

function annotate(f, ci) {
  const text = `${f.check}: ${f.match}${f.message && f.check !== 'secrets' ? ` — ${f.message}` : ''}`;
  if (!ci) return `${f.file}:${f.line}  ${text}`;
  const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  return `::error file=${esc(f.file).replace(/[:,]/g, (c) => (c === ':' ? '%3A' : '%2C'))},line=${f.line},title=doc-sanitise ${f.check}::${esc(text)}`;
}

function issueTitle(f) {
  return f.check === 'secrets' ? `doc-sanitise: possible secret (${f.rule}) in ${f.file}` : `doc-sanitise: ${f.check} "${f.match}" in ${f.file}`;
}

function fileIssues(findings) {
  const seen = new Set();
  let opened = 0;
  for (const f of findings) {
    const title = issueTitle(f);
    if (seen.has(title)) continue;
    seen.add(title);
    const existing = JSON.parse(execFileSync('gh', ['issue', 'list', '--state', 'all', '--limit', '20', '--search', `"${title.replace(/"/g, '')}" in:title`, '--json', 'title'], { encoding: 'utf8' }));
    if (existing.some((i) => i.title === title)) continue;
    if (opened >= ISSUE_CAP) {
      console.log(`issue cap (${ISSUE_CAP}) reached; the rest wait for next week's run.`);
      break;
    }
    const where = f.commit ? `\`${f.file}\` line ${f.line}, commit ${f.commit}` : `\`${f.file}\` line ${f.line}`;
    const body = [
      `The weekly doc-sanitise scan found a ${f.check} problem that is not in the baseline.`,
      '',
      `- Where: ${where}`,
      `- What: ${f.check === 'secrets' ? f.match : `\`${f.match}\` (${f.rule})`}`,
      f.message && f.check !== 'secrets' ? `- Rule says: ${f.message}` : null,
      '',
      HELP[f.check],
      '',
      'Check: `.github/workflows/doc-sanitise.yml` (issue #121).',
    ].filter((l) => l !== null).join('\n');
    execFileSync('gh', ['issue', 'create', '--title', title, '--body', body, '--label', 'chore'], { stdio: 'inherit' });
    opened++;
  }
  console.log(`${opened} issue(s) opened.`);
}

function main() {
  const a = cliArgs(process.argv.slice(2));
  const ci = Boolean(process.env.GITHUB_ACTIONS);
  process.chdir(git(['rev-parse', '--show-toplevel']).trim());
  const only = a.only ?? CHECKS;

  if (a.cmd === 'baseline') {
    const { res } = scan({ all: true }, only);
    mkdirSync(BASELINE_DIR, { recursive: true });
    for (const [check, found] of Object.entries(res)) {
      writeFileSync(baselinePath(check), sortedJson(tally(found)));
      console.log(`${check}: ${found.length} baselined → ${baselinePath(check)}`);
    }
    return;
  }

  if (a.cmd === 'issues') {
    fileIssues(JSON.parse(readFileSync(a.json, 'utf8')));
    return;
  }

  if (a.cmd !== 'check') {
    console.error('usage: doc-sanitise.mjs check [--base REF | --staged | --all] [--only wording,codes,secrets] [--json OUT]\n       doc-sanitise.mjs baseline [--only …]\n       doc-sanitise.mjs issues --json OUT');
    process.exit(2);
  }

  const mode = a.all ? { all: true } : a.staged ? { staged: true } : { base: a.base ?? 'origin/main' };
  const { files, res } = scan(mode, only);
  const fresh = [];
  for (const [check, found] of Object.entries(res)) {
    const base = readBaseline(check);
    const n = newFindings(found, base);
    fresh.push(...n);
    console.log(`${check}: ${n.length} new${a.all ? ` (baseline ${baselineSize(base)}, found ${found.length})` : ''}`);
  }
  if (a.json) writeFileSync(a.json, JSON.stringify(fresh, null, 2));
  for (const f of fresh) console.log(annotate(f, ci));
  if (fresh.length) {
    for (const c of CHECKS) if (fresh.some((f) => f.check === c)) console.log(`\n${c}: ${HELP[c]}`);
    process.exit(1);
  }
  console.log(`doc-sanitise: ok (${mode.all ? 'all' : files.length} doc file(s)${mode.all ? '' : ' changed'})`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
