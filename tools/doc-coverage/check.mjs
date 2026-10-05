#!/usr/bin/env node
// Documentation coverage: every public thing has a doc.
//
// Areas
//   go       exported Go identifiers in services/hg without a doc comment
//            (same rule as revive's `exported`; see godoc/main.go)
//   ts       top-level exports of packages/*/src without a /** TSDoc */ comment
//   openapi  operations in contracts/openapi.yaml without a description or summary
//   make     Makefile targets without a `## ` help comment
//   scripts  package.json scripts not named on a pnpm/npm/yarn line of any Markdown doc
//
// Undocumented items listed in baseline.json are tolerated; any other undocumented
// item fails. The baseline only shrinks: document something, then run
// --update-baseline to drop it.
//
// Usage
//   node tools/doc-coverage/check.mjs                      full scan, every new item fails
//   node tools/doc-coverage/check.mjs --base origin/main   only items in files changed since the merge base fail
//   node tools/doc-coverage/check.mjs --changed a.go b.ts  only items in the listed files fail (git hook)
//   node tools/doc-coverage/check.mjs --update-baseline    rewrite baseline.json from today's tree
//   node tools/doc-coverage/check.mjs --json out.json      also write the new findings as JSON
//
// Needs `go`, plus `typescript` and `yaml` resolvable (CI installs them next to this file;
// locally a `pnpm install` is enough).

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const BASELINE = path.join(HERE, 'baseline.json');
const AREAS = ['go', 'ts', 'openapi', 'make', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.expo', 'dist', 'build', 'bin', 'vendor', '.turbo', 'coverage']);

// ---------------------------------------------------------------------------
// args

const args = process.argv.slice(2);
const opt = { base: null, changed: null, update: false, json: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--base') opt.base = args[++i];
  else if (a === '--json') opt.json = args[++i];
  else if (a === '--update-baseline') opt.update = true;
  else if (a === '--changed') opt.changed = args.slice(i + 1).map(norm), (i = args.length);
  else {
    console.error(`unknown argument: ${a}`);
    process.exit(2);
  }
}

function norm(p) {
  return path.relative(ROOT, path.resolve(p)).split(path.sep).join('/');
}

// ---------------------------------------------------------------------------
// helpers

function load(name) {
  const from = [HERE + '/', path.join(ROOT, 'packages/api-client/package.json'), path.join(ROOT, 'tools/contract-tools/package.json')];
  for (const f of from) {
    try {
      return createRequire(f)(name);
    } catch {}
  }
  console.error(`doc-coverage: cannot resolve "${name}". Run: npm install --no-save --prefix tools/doc-coverage typescript@5.9.3 yaml@2.9.0`);
  process.exit(2);
}

function walk(dir, keep, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), keep, out);
    } else if (keep(e.name, dir)) out.push(path.join(dir, e.name));
  }
  return out;
}

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');
const read = (abs) => readFileSync(abs, 'utf8');

// ---------------------------------------------------------------------------
// go

function scanGo() {
  const root = path.join(ROOT, 'services/hg');
  const out = execFileSync('go', ['run', '.', root], { cwd: path.join(HERE, 'godoc'), encoding: 'utf8', maxBuffer: 64 << 20 });
  return JSON.parse(out).map((it) => {
    const file = rel(it.file);
    return { area: 'go', id: `${file}:${it.name}`, file, documented: it.documented };
  });
}

// ---------------------------------------------------------------------------
// ts

function scanTs() {
  const ts = load('typescript');
  const items = [];
  const pkgs = readdirSync(path.join(ROOT, 'packages'), { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const pkg of pkgs) {
    const src = path.join(ROOT, 'packages', pkg.name, 'src');
    const files = walk(
      src,
      (name, dir) =>
        /\.(ts|tsx|mts|js|mjs)$/.test(name) &&
        !/\.d\.ts$/.test(name) &&
        !/\.(test|spec|stories)\.[^.]+$/.test(name) &&
        !/^test-setup\./.test(name) &&
        !rel(dir).split('/').some((seg) => seg === 'generated' || seg === '__tests__'),
    );
    for (const abs of files) items.push(...tsExports(ts, abs));
  }
  return items;
}

function tsExports(ts, abs) {
  const file = rel(abs);
  const text = read(abs);
  const kind = /\.tsx$/.test(abs) ? ts.ScriptKind.TSX : /\.m?js$/.test(abs) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, kind);

  const hasDoc = (node) =>
    (ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []).some((r) => {
      const c = text.slice(r.pos, r.end);
      return c.startsWith('/**') && c.replace(/^\/\*\*|\*\/$/g, '').replace(/^\s*\*/gm, '').trim() !== '';
    });
  const isExported = (node) => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const isDefault = (node) => (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
  const bindingNames = (n) =>
    ts.isIdentifier(n) ? [n.text] : n.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : bindingNames(e.name)));

  // name -> documented, for every top-level declaration (exported or not)
  const local = new Map();
  const exported = new Map();
  const note = (map, name, doc) => map.set(name, (map.get(name) ?? false) || doc);

  for (const st of sf.statements) {
    let names = [];
    if (ts.isVariableStatement(st)) names = st.declarationList.declarations.flatMap((d) => bindingNames(d.name));
    else if (
      (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) ||
        ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st)) &&
      st.name
    )
      names = [st.name.text];
    else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && !st.name) names = ['default'];

    const doc = hasDoc(st);
    for (const n of names) {
      note(local, n, doc);
      if (isExported(st)) note(exported, isDefault(st) ? 'default' : n, doc);
    }
    if (ts.isExportAssignment(st)) note(exported, 'default', hasDoc(st));
  }
  // `export { a, b as c }` of local declarations — the doc lives on the declaration.
  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st) || st.moduleSpecifier || !st.exportClause || !ts.isNamedExports(st.exportClause)) continue;
    for (const spec of st.exportClause.elements) {
      const localName = (spec.propertyName ?? spec.name).text;
      if (local.has(localName)) note(exported, spec.name.text, local.get(localName) || hasDoc(spec));
    }
  }
  return [...exported].map(([name, documented]) => ({ area: 'ts', id: `${file}:${name}`, file, documented }));
}

// ---------------------------------------------------------------------------
// openapi

function scanOpenapi() {
  const YAML = load('yaml');
  const file = 'contracts/openapi.yaml';
  const doc = YAML.parse(read(path.join(ROOT, file)));
  const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
  const items = [];
  for (const [p, item] of Object.entries(doc.paths ?? {})) {
    for (const m of methods) {
      const op = item?.[m];
      if (!op) continue;
      const text = `${op.description ?? ''}${op.summary ?? ''}`.trim();
      items.push({ area: 'openapi', id: op.operationId ?? `${m.toUpperCase()} ${p}`, file, documented: text !== '' });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// make

function scanMake() {
  const items = [];
  for (const abs of walk(ROOT, (name) => name === 'Makefile' || name.endsWith('.mk'))) {
    const file = rel(abs);
    for (const line of read(abs).split('\n')) {
      const m = /^([A-Za-z0-9][A-Za-z0-9_./ -]*?)\s*:(?![:=])/.exec(line);
      if (!m) continue;
      for (const target of m[1].split(/\s+/).filter(Boolean)) {
        if (target.includes('%')) continue;
        items.push({ area: 'make', id: `${file}:${target}`, file, documented: /(^|\s)## \S/.test(line) });
      }
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// scripts

function scanScripts() {
  const docLines = walk(ROOT, (name) => name.endsWith('.md'))
    .flatMap((f) => read(f).split('\n'))
    .filter((l) => /\b(pnpm|npm|yarn)\b/.test(l));
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const items = [];
  for (const abs of walk(ROOT, (name) => name === 'package.json')) {
    const file = rel(abs);
    const scripts = JSON.parse(read(abs)).scripts ?? {};
    for (const name of Object.keys(scripts)) {
      const re = new RegExp(`(^|[^\\w:-])${esc(name)}(?![\\w:-])`);
      items.push({ area: 'scripts', id: `${file}:${name}`, file, documented: docLines.some((l) => re.test(l)) });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// main

const items = [...scanGo(), ...scanTs(), ...scanOpenapi(), ...scanMake(), ...scanScripts()];
const undocumented = Object.fromEntries(AREAS.map((a) => [a, items.filter((i) => i.area === a && !i.documented).map((i) => i.id).sort()]));

if (opt.update) {
  writeFileSync(BASELINE, JSON.stringify(undocumented, null, 2) + '\n');
  console.log(`doc-coverage: baseline rewritten (${AREAS.map((a) => `${a} ${undocumented[a].length}`).join(', ')})`);
  process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(read(BASELINE)) : {};
const known = Object.fromEntries(AREAS.map((a) => [a, new Set(baseline[a] ?? [])]));

let changed = opt.changed;
if (opt.base) {
  changed = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', `${opt.base}...HEAD`], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}
const inScope = changed ? new Set(changed) : null;

const fresh = items.filter((i) => !i.documented && !known[i.area].has(i.id));
const failing = fresh.filter((i) => !inScope || inScope.has(i.file));
const outside = fresh.filter((i) => !failing.includes(i));
const present = new Set(items.filter((i) => !i.documented).map((i) => `${i.area}\t${i.id}`));
const stale = AREAS.flatMap((a) => [...known[a]].filter((id) => !present.has(`${a}\t${id}`)).map((id) => `${a}: ${id}`));

// report
const rows = AREAS.map((a) => {
  const all = items.filter((i) => i.area === a);
  const doc = all.filter((i) => i.documented).length;
  const pct = all.length ? ((100 * doc) / all.length).toFixed(1) : '100.0';
  const n = fresh.filter((i) => i.area === a).length;
  return `| ${a} | ${all.length} | ${doc} | ${pct}% | ${known[a].size} | ${n} |`;
});
const lines = [
  '## Documentation coverage',
  '',
  '| area | items | documented | coverage | baseline | new |',
  '|---|---:|---:|---:|---:|---:|',
  ...rows,
  '',
];
if (failing.length) lines.push('### New undocumented items (fail)', '', ...failing.map((i) => `- \`${i.area}\` \`${i.id}\``), '');
if (outside.length) lines.push('### Undocumented items outside the changed files (not failing)', '', ...outside.map((i) => `- \`${i.area}\` \`${i.id}\``), '');
if (stale.length)
  lines.push(`### ${stale.length} baseline entries are now documented or gone`, '', 'Run `node tools/doc-coverage/check.mjs --update-baseline` to drop them.', '');
const report = lines.join('\n');
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n');
if (opt.json) writeFileSync(opt.json, JSON.stringify(fresh, null, 2) + '\n');

if (failing.length) {
  console.error(`doc-coverage: ${failing.length} new undocumented item(s). Add a doc comment/description — do not add them to the baseline.`);
  process.exit(1);
}
console.log('doc-coverage: ok');
