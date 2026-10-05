#!/usr/bin/env node
// Stale-docs check. A doc declares the code it describes in YAML front matter:
//
//   ---
//   covers: [services/hg/internal/orders/**, apps/rider/**]
//   reviewed: 2026-09-28
//   ---
//
//   node tools/stale-docs/check.mjs pr   [--base <ref>] [--head <ref>]
//     Fails when a PR changes files a doc covers without changing the doc — unless the PR
//     has the `no-doc-change` label AND a description line `No doc change: <reason>`.
//     Also fails when a doc under docs/ that is not in the baseline has no `covers:`.
//     In Actions the base/head/labels/body come from the event JSON ($GITHUB_EVENT_PATH).
//
//   node tools/stale-docs/check.mjs scan [--file-issues]
//     Full scan: a doc whose `reviewed:` is older than the last commit touching its covered
//     files is stale. With --file-issues, opens one GitHub issue per finding (deduped by title).
//
//   node tools/stale-docs/check.mjs baseline
//     Rewrites baseline.json with the docs under docs/ that do not declare `covers:` yet.
//
// No dependencies. Every git/gh call is execFileSync with an argument array: no shell.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(HERE, 'baseline.json');
const LABEL = 'no-doc-change';
const REASON_RE = /^[ \t>*-]*No doc change:[ \t]*(\S.*)$/im;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------- helpers

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 << 20, ...opts }).trim();
}

function lines(s) {
  return s ? s.split('\n').filter(Boolean) : [];
}

function trackedMarkdown() {
  return lines(git(['ls-files', '-z', '--', '*.md']).replaceAll('\0', '\n'));
}

function trackedFiles() {
  return lines(git(['ls-files', '-z']).replaceAll('\0', '\n'));
}

function unquote(v) {
  v = v.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function stripComment(v) {
  // YAML comment: ` #` outside quotes. Good enough for this front matter.
  const m = v.match(/^((?:[^"'#]|"[^"]*"|'[^']*')*?)\s+#.*$/);
  return m ? m[1] : v;
}

/**
 * Tiny front-matter parser: `key: scalar`, `key: [a, b]`, and `key:` followed by `- item` lines.
 * Returns null when the file has no front matter, or { data, error }.
 */
export function parseFrontMatter(text) {
  const src = text.replace(/^﻿/, '').split(/\r?\n/);
  if (src[0] !== '---') return null;
  const end = src.indexOf('---', 1);
  if (end === -1) return { data: {}, error: 'front matter has no closing ---' };
  const data = {};
  let listKey = null;
  let error = null;
  for (let i = 1; i < end; i++) {
    const raw = src[i];
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const item = raw.match(/^\s+-\s*(.*)$/) || raw.match(/^-\s+(.*)$/);
    if (item && listKey) {
      data[listKey].push(unquote(stripComment(item[1])));
      continue;
    }
    const kv = raw.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) {
      // Other tools' richer YAML (nested maps, block scalars) is skipped, not rejected: only
      // `covers:` and `reviewed:` are ours. An unparseable top-level line is still reported.
      if (!/^\s/.test(raw)) error ??= `cannot parse front matter line ${i + 1}: ${raw}`;
      continue;
    }
    const [, key, rest] = kv;
    const value = stripComment(rest).trim();
    listKey = null;
    if (value === '') {
      data[key] = [];
      listKey = key;
    } else if (value.startsWith('[')) {
      if (!value.endsWith(']')) {
        error ??= `unterminated list for ${key}`;
        continue;
      }
      const inner = value.slice(1, -1).trim();
      data[key] = inner ? inner.split(',').map(unquote).filter(Boolean) : [];
    } else {
      data[key] = unquote(value);
    }
  }
  return { data, error };
}

/** Glob → RegExp. `**` crosses directories, `*` and `?` do not. A pattern with no glob
 *  characters matches that file, or everything under it if it is a directory. */
export function globToRegExp(glob) {
  glob = glob.replace(/^\.\//, '');
  if (!/[*?[]/.test(glob)) {
    const p = glob.replace(/\/$/, '').replace(/[.+^${}()|\\]/g, '\\$&');
    return new RegExp(`^${p}(?:/.*)?$`);
  }
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const close = glob.indexOf(']', i);
      if (close === -1) re += '\\[';
      else {
        re += glob.slice(i, close + 1).replace('[!', '[^');
        i = close;
      }
    } else re += c.replace(/[.+^${}()|\\/]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function validDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function readDoc(path, content) {
  const text = content ?? (existsSync(path) ? readFileSync(path, 'utf8') : null);
  if (text == null) return null;
  const fm = parseFrontMatter(text);
  const errors = [];
  if (!fm) return { path, hasCovers: false, covers: [], reviewed: null, errors };
  const { covers, reviewed } = fm.data;
  const hasCovers = covers !== undefined;
  // A parse problem only matters in front matter that is ours.
  if (fm.error && (hasCovers || reviewed !== undefined)) errors.push(fm.error);
  if (hasCovers && !Array.isArray(covers)) errors.push('`covers:` must be a list of repo globs');
  if (hasCovers && reviewed === undefined) errors.push('`reviewed:` (YYYY-MM-DD) is missing');
  if (reviewed !== undefined && !validDate(String(reviewed))) {
    errors.push(`\`reviewed: ${reviewed}\` is not a YYYY-MM-DD date`);
  }
  return {
    path,
    hasCovers,
    covers: Array.isArray(covers) ? covers : [],
    reviewed: reviewed === undefined ? null : String(reviewed),
    errors,
  };
}

function allDocs() {
  return trackedMarkdown()
    .map((p) => readDoc(p))
    .filter(Boolean);
}

function mustDeclare(path) {
  return path.startsWith('docs/') && path.endsWith('.md');
}

function loadBaseline() {
  if (!existsSync(BASELINE)) return new Set();
  return new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).missingCovers ?? []);
}

function matches(doc, files) {
  const res = doc.covers.map(globToRegExp);
  return files.filter((f) => f !== doc.path && res.some((r) => r.test(f)));
}

function deadGlobs(doc, tracked) {
  return doc.covers.filter((g) => {
    const r = globToRegExp(g);
    return !tracked.some((f) => r.test(f));
  });
}

const summary = [];
function out(s = '') {
  console.log(s);
  summary.push(s);
}
function flushSummary() {
  if (process.env.GITHUB_STEP_SUMMARY && summary.length) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join('\n')}\n`);
  }
}
function annotate(level, file, msg) {
  if (process.env.GITHUB_ACTIONS) console.log(`::${level} file=${file}::${msg.replace(/\n/g, '%0A')}`);
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// ---------------------------------------------------------------- pr mode

function readEvent() {
  const p = process.env.GITHUB_EVENT_PATH;
  if (!p || !existsSync(p)) return null;
  const ev = JSON.parse(readFileSync(p, 'utf8'));
  return ev.pull_request ?? null;
}

function prMode() {
  const pr = readEvent();
  const base = arg('--base', pr?.base?.sha ?? 'origin/main');
  const head = arg('--head', pr?.head?.sha ?? 'HEAD');
  const labels = (pr?.labels ?? []).map((l) => l.name);
  const body = pr?.body ?? '';

  const changed = lines(git(['diff', '--name-only', '--no-renames', `${base}...${head}`]));
  const changedSet = new Set(changed);
  const tracked = trackedFiles();
  const baseline = loadBaseline();
  const docs = allDocs();

  const failures = [];
  const warnings = [];

  // 1. Front matter of docs this PR touches must be well-formed, and a doc under docs/
  //    outside the baseline must declare `covers:`.
  for (const doc of docs.filter((d) => changedSet.has(d.path))) {
    for (const e of doc.errors) failures.push({ doc: doc.path, msg: e });
    if (mustDeclare(doc.path) && !doc.hasCovers && !baseline.has(doc.path)) {
      failures.push({
        doc: doc.path,
        msg: 'declares no `covers:` front matter. Add `covers: [<globs>]` (or `covers: []` if it describes no code) and `reviewed: YYYY-MM-DD`.',
      });
    }
    const dead = deadGlobs(doc, tracked);
    if (dead.length) failures.push({ doc: doc.path, msg: `covers globs that match no file: ${dead.join(', ')}` });
  }

  // 2. Covered code changed, doc did not.
  const stale = [];
  for (const doc of docs) {
    if (!doc.covers.length) continue;
    const hit = matches(doc, changed);
    if (!hit.length) continue;
    if (changedSet.has(doc.path)) {
      let before = null;
      try {
        before = readDoc(doc.path, git(['show', `${base}:${doc.path}`]));
      } catch {
        /* new doc */
      }
      if (before && before.reviewed === doc.reviewed) {
        warnings.push({ doc: doc.path, msg: 'changed, but `reviewed:` was not bumped — the weekly scan will flag it.' });
      }
      continue;
    }
    stale.push({ doc: doc.path, files: hit });
  }

  const hasLabel = labels.includes(LABEL);
  const reason = body.match(REASON_RE)?.[1]?.trim();
  const excused = hasLabel && !!reason;

  out('## Stale docs');
  out();
  out(`Compared \`${base.slice(0, 12)}...${head.slice(0, 12)}\` — ${changed.length} changed file(s).`);
  out();

  if (stale.length) {
    out(excused ? '### Docs not updated (excused)' : '### Docs that must change with this code');
    out();
    for (const s of stale) {
      out(`- \`${s.doc}\` covers:`);
      for (const f of s.files.slice(0, 20)) out(`  - \`${f}\``);
      if (s.files.length > 20) out(`  - … and ${s.files.length - 20} more`);
      if (!excused) {
        annotate('error', s.doc, `covered code changed without this doc: ${s.files.slice(0, 5).join(', ')}`);
      }
    }
    out();
    if (excused) {
      out(`Excused by the \`${LABEL}\` label. Reason: ${reason}`);
    } else {
      out('Update each doc (and bump its `reviewed:` date), or — if the change really does not');
      out(`affect what the doc says — add the \`${LABEL}\` label **and** a line in the PR description:`);
      out();
      out('    No doc change: <one-line reason>');
      if (hasLabel && !reason) out('\nThe label is set but the description has no `No doc change: <reason>` line.');
      if (!hasLabel && reason) out(`\nThe description has a reason but the PR is missing the \`${LABEL}\` label.`);
      if (!pr) out(`\n(Local run: the label escape only exists on a PR.)`);
    }
    out();
  }

  if (warnings.length) {
    out('### Warnings');
    for (const w of warnings) {
      out(`- \`${w.doc}\` ${w.msg}`);
      annotate('warning', w.doc, w.msg);
    }
    out();
  }

  if (failures.length) {
    out('### Front matter problems');
    for (const f of failures) {
      out(`- \`${f.doc}\` ${f.msg}`);
      annotate('error', f.doc, f.msg);
    }
    out();
  }

  const failed = failures.length > 0 || (stale.length > 0 && !excused);
  out(failed ? '**stale-docs: FAIL**' : '**stale-docs: ok**');
  flushSummary();
  process.exit(failed ? 1 : 0);
}

// ---------------------------------------------------------------- scan mode

function lastChange(doc) {
  const specs = doc.covers.map((g) => `:(glob)${g.replace(/^\.\//, '')}`);
  specs.push(`:(exclude)${doc.path}`);
  return git(['log', '-1', '--format=%cs', '--', ...specs]) || null;
}

function commitsSince(doc, since) {
  const specs = doc.covers.map((g) => `:(glob)${g.replace(/^\.\//, '')}`);
  specs.push(`:(exclude)${doc.path}`);
  return lines(git(['log', '-15', '--format=%h %cs %s', `--since=${since}T23:59:59Z`, '--', ...specs]));
}

function scanFindings() {
  const tracked = trackedFiles();
  const baseline = loadBaseline();
  const findings = [];
  for (const doc of allDocs()) {
    if (doc.errors.length) {
      findings.push({ title: `Doc front matter is invalid: ${doc.path}`, body: doc.errors.map((e) => `- ${e}`).join('\n') });
      continue;
    }
    if (!doc.hasCovers) {
      if (mustDeclare(doc.path) && !baseline.has(doc.path)) {
        findings.push({
          title: `Doc declares no covers: ${doc.path}`,
          body: '`' + doc.path + '` has no `covers:` front matter and is not in `tools/stale-docs/baseline.json`.',
        });
      }
      continue;
    }
    const dead = deadGlobs(doc, tracked);
    if (dead.length) {
      findings.push({
        title: `Doc covers globs that match nothing: ${doc.path}`,
        body: dead.map((g) => `- \`${g}\``).join('\n'),
      });
    }
    if (!doc.covers.length) continue;
    const last = lastChange(doc);
    if (last && last > doc.reviewed) {
      const commits = commitsSince(doc, doc.reviewed);
      findings.push({
        title: `Stale doc: ${doc.path}`,
        body: [
          `\`${doc.path}\` was last reviewed **${doc.reviewed}**; the code it covers last changed **${last}**.`,
          '',
          'Covers:',
          ...doc.covers.map((g) => `- \`${g}\``),
          '',
          'Commits since the review:',
          '```',
          ...commits,
          '```',
          '',
          'Re-read the doc against the code, fix what drifted, and bump `reviewed:`.',
        ].join('\n'),
      });
    }
  }
  return findings;
}

function scanMode() {
  const findings = scanFindings();
  const fileIssues = process.argv.includes('--file-issues');
  out('## Stale docs — full scan');
  out();
  if (!findings.length) out('No findings.');
  for (const f of findings) out(`- ${f.title}`);
  out();

  if (fileIssues && findings.length) {
    const open = new Set(
      JSON.parse(
        execFileSync('gh', ['issue', 'list', '--state', 'open', '--limit', '1000', '--json', 'title'], {
          encoding: 'utf8',
        }),
      ).map((i) => i.title),
    );
    for (const f of findings) {
      if (open.has(f.title)) {
        out(`- already open: ${f.title}`);
        continue;
      }
      const body = `${f.body}\n\n_Filed by the weekly stale-docs scan (\`tools/stale-docs/check.mjs scan\`)._`;
      const url = execFileSync('gh', ['issue', 'create', '--title', f.title, '--body', body, '--label', 'docs'], {
        encoding: 'utf8',
      }).trim();
      out(`- filed: ${url}`);
    }
  }
  flushSummary();
  process.exit(findings.length && !fileIssues ? 1 : 0);
}

// ---------------------------------------------------------------- baseline

function baselineMode() {
  const missing = allDocs()
    .filter((d) => mustDeclare(d.path) && !d.hasCovers)
    .map((d) => d.path)
    .sort();
  writeFileSync(BASELINE, `${JSON.stringify({ missingCovers: missing }, null, 2)}\n`);
  console.log(`baseline: ${missing.length} doc(s) under docs/ without covers:`);
}

// ---------------------------------------------------------------- main

const cmd = process.argv[2];
if (cmd === 'pr') prMode();
else if (cmd === 'scan') scanMode();
else if (cmd === 'baseline') baselineMode();
else {
  console.error('usage: check.mjs pr [--base <ref>] [--head <ref>] | scan [--file-issues] | baseline');
  process.exit(2);
}
