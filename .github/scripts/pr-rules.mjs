#!/usr/bin/env node
// PR rules — CONTRIBUTING.md "Pull requests". Issue #40.
//
// The PR title decides the type label (conventional prefix → one of five labels);
// changed paths decide the app labels. Both are applied automatically in CI.
//
// The check fails a PR that: has no valid title prefix, misses a required section
// for its type, links no issue, or leaves an internal code (invariant 10, L-4,
// §4.1, R-05…) as bare text instead of a link. It warns, never fails, above 400
// changed lines (generated files excluded).
//
// CI:     node .github/scripts/pr-rules.mjs check|labels   (reads GITHUB_EVENT_PATH)
// Local:  node .github/scripts/pr-rules.mjs check --title "fix(ui): …" --body-file body.md [--base origin/main]

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const TYPES = ['bug', 'feature', 'docs', 'refactor', 'chore'];

/** Conventional prefix → type label. The only way a type is decided. */
export const PREFIX_TO_TYPE = {
  fix: 'bug',
  feat: 'feature',
  docs: 'docs',
  refactor: 'refactor',
  perf: 'refactor',
  chore: 'chore',
  ci: 'chore',
  build: 'chore',
  test: 'chore',
};

/** Path → app label. */
export const APP_LABELS = { restaurant: 'app:restaurant', customer: 'app:customer', rider: 'app:rider', admin: 'app:admin' };

// Sections every PR needs, then per type. Headings are `## <name>`.
const COMMON = ['What', 'Issue'];
export const SECTIONS = {
  bug: ['Before', 'After', 'Cause', 'Links'],
  feature: ['Links', 'Try it'],
  docs: ['Links'],
  refactor: ['Proof', 'Links'],
  chore: ['Why now', 'Links'],
};
// May be absent; if present must not be empty.
const OPTIONAL = { feature: ['Screenshots'] };

export const SIZE_WARN = 400;
export const GENERATED = [
  /(^|\/)generated\//,
  /\.gen\.go$/,
  /^packages\/ui-web\/src\/tokens\/(tokens\.css|tokens\.ts|themes\.ts|theme\.css)$/,
  /^contracts\/fixtures\//,
  /(^|\/)pnpm-lock\.yaml$/,
];

// Internal codes that must never be bare text. Fenced code blocks (logs) and HTML
// comments (template hints) are skipped; inline `code` is NOT exempt — a code in
// backticks is still unreadable. Allowed only inside a markdown link.
const CODES = [
  /\binvariants?\s*#?\s*\d+/gi, // invariant 10, invariant #4
  /(?<![\w-])[A-Z]{1,2}-\d{1,3}(?:\s+R\d+)?\b/g, // L-4, R-05, S-08, C-13 R4
  /§\s?\d+(?:\.\d+)*/g, // §4.1
];

export function typeFromTitle(title) {
  const m = /^([a-z]+)(\([^)]*\))?!?:\s+\S/.exec(title ?? '');
  return m ? (PREFIX_TO_TYPE[m[1]] ?? null) : null;
}

export function appLabelsFromPaths(paths) {
  const out = new Set();
  for (const p of paths) {
    const m = /^apps\/([^/]+)\//.exec(p);
    if (m && APP_LABELS[m[1]]) out.add(APP_LABELS[m[1]]);
  }
  return [...out].sort();
}

/** Labels to add/remove so the PR carries exactly the derived type + app labels. */
export function labelPlan(current, title, paths) {
  const type = typeFromTitle(title);
  const want = new Set([...(type ? [type] : []), ...appLabelsFromPaths(paths)]);
  const managed = (l) => TYPES.includes(l) || Object.values(APP_LABELS).includes(l);
  return {
    add: [...want].filter((l) => !current.includes(l)),
    remove: current.filter((l) => managed(l) && !want.has(l)),
  };
}

export function sections(body) {
  const out = new Map();
  const parts = body.replace(/<!--[\s\S]*?-->/g, '').split(/^##\s+(.+?)\s*$/m);
  for (let i = 1; i < parts.length; i += 2) out.set(parts[i].trim().toLowerCase(), parts[i + 1].trim());
  return out;
}

export function bareCodes(body) {
  const text = body.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length)).replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length));
  const links = [...text.matchAll(/\[[^\]]*\]\([^)\s]+\)/g)].map((m) => [m.index, m.index + m[0].length]);
  const inLink = (i) => links.some(([s, e]) => i >= s && i < e);
  const found = new Set();
  for (const re of CODES) for (const m of text.matchAll(re)) if (!inLink(m.index)) found.add(m[0].trim());
  return [...found];
}

export function countChangedLines(numstat) {
  let total = 0;
  for (const line of numstat.trim().split('\n').filter(Boolean)) {
    const [add, del, path] = line.split('\t');
    if (add === '-' || GENERATED.some((re) => re.test(path))) continue;
    total += Number(add) + Number(del);
  }
  return total;
}

/** Pure check. Returns { type, errors, warnings }. */
export function check({ title, body, changedLines }) {
  const errors = [];
  const warnings = [];
  const type = typeFromTitle(title);
  if (!type) {
    errors.push(
      `Title must start with a type prefix — ${Object.keys(PREFIX_TO_TYPE).join(' · ')} — e.g. "fix(restaurant): the queue showed orders twice". The prefix sets the label.`,
    );
  }

  const secs = sections(body ?? '');
  for (const name of [...COMMON, ...(type ? SECTIONS[type] : [])]) {
    const content = secs.get(name.toLowerCase());
    if (content === undefined) errors.push(`Missing section "## ${name}".`);
    else if (!content) errors.push(`Section "## ${name}" is empty.`);
  }
  for (const name of type ? (OPTIONAL[type] ?? []) : []) {
    if (secs.get(name.toLowerCase()) === '') errors.push(`Section "## ${name}" is empty — fill it or delete it.`);
  }

  const issue = secs.get('issue');
  if (issue && !/(#\d+|github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+)/.test(issue)) {
    errors.push('"## Issue" must link an issue (e.g. "Closes #40").');
  }

  if (type === 'bug') {
    const before = secs.get('before');
    if (before && !/(!\[|<img\s|```|https?:\/\/\S+)/.test(before)) {
      errors.push('"## Before" needs evidence: a screenshot, a log or repro in a code block, or a link to a failing run.');
    }
  }

  const bare = bareCodes(`${title ?? ''}\n${body ?? ''}`);
  if (bare.length) {
    errors.push(
      `Bare codes — write what each means and link to where it is defined: ${bare.map((c) => `"${c}"`).join(', ')}. ` +
        'Example: [solid green is reserved for halal status (invariant 10)](https://github.com/shaiknoorullah/hg-mono/blob/main/AGENTS.md#3-non-negotiable-invariants).',
    );
  }

  if (changedLines !== null && changedLines > SIZE_WARN) {
    warnings.push(`${changedLines} changed lines (generated files excluded), over ${SIZE_WARN}. Can this be split into smaller PRs that each do one thing?`);
  }
  return { type, errors, warnings };
}

// ---------------------------------------------------------------- CLI

function cliArgs(argv) {
  const get = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return { cmd: argv[0], title: get('--title'), bodyFile: get('--body-file'), base: get('--base') };
}

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' });
  } catch {
    return null; // no git / base not fetched
  }
}

function main() {
  const a = cliArgs(process.argv.slice(2));
  const ev = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : null;
  const pr = ev?.pull_request;
  const title = a.title ?? pr?.title ?? '';
  const body = a.bodyFile ? readFileSync(a.bodyFile, 'utf8') : (pr?.body ?? '');
  const base = a.base ?? (pr ? `origin/${pr.base.ref}` : 'origin/main');
  const ci = Boolean(process.env.GITHUB_ACTIONS);

  if (a.cmd === 'labels') {
    const paths = (git(['diff', '--name-only', `${base}...HEAD`]) ?? '').trim().split('\n').filter(Boolean);
    const plan = labelPlan(pr ? pr.labels.map((l) => l.name) : [], title, paths);
    console.log(JSON.stringify(plan));
    return;
  }

  if (a.cmd !== 'check') {
    console.error('usage: pr-rules.mjs check|labels [--title T] [--body-file F] [--base REF]');
    process.exit(2);
  }
  const numstat = git(['diff', '--numstat', `${base}...HEAD`]);
  const { type, errors, warnings } = check({ title, body, changedLines: numstat === null ? null : countChangedLines(numstat) });
  for (const w of warnings) console.log(ci ? `::warning title=PR size::${w}` : `warning: ${w}`);
  for (const e of errors) console.log(ci ? `::error title=PR rules::${e}` : `error: ${e}`);
  if (errors.length) {
    console.log(`\n${errors.length} problem(s). Rules: CONTRIBUTING.md "Pull requests". Templates: .github/PULL_REQUEST_TEMPLATE/`);
    process.exit(1);
  }
  console.log(`PR rules: ok (${type})${warnings.length ? ', with warnings' : ''}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
