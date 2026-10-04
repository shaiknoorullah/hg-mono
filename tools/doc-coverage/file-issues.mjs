#!/usr/bin/env node
// Opens one GitHub issue per new undocumented item from `check.mjs --json <file>`.
// Dedupes by title against open issues. Needs `gh` and GH_TOKEN.
//
// Usage: node tools/doc-coverage/file-issues.mjs findings.json

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const MAX_PER_RUN = 25;
const WHAT = {
  go: 'an exported Go identifier without a doc comment',
  ts: 'a package export without a TSDoc comment',
  openapi: 'an API operation without a description',
  make: 'a make target without a `## ` help comment',
  scripts: 'a package script not named in any doc',
};

const findings = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });
const open = new Set(JSON.parse(gh('issue', 'list', '--state', 'open', '--limit', '1000', '--json', 'title')).map((i) => i.title));

let filed = 0;
for (const f of findings) {
  const title = `docs: ${f.area} ${f.id} has no documentation`;
  if (open.has(title)) continue;
  if (filed >= MAX_PER_RUN) {
    console.log(`stopping at ${MAX_PER_RUN} issues this run; the rest are filed next week`);
    break;
  }
  const body = [
    `The weekly documentation-coverage scan found ${WHAT[f.area] ?? 'an undocumented item'}:`,
    '',
    `- \`${f.id}\` in \`${f.file}\``,
    '',
    'It is not in the baseline (`tools/doc-coverage/baseline.json`), so it arrived without going through the per-PR check. Document it, then run `node tools/doc-coverage/check.mjs` to confirm.',
  ].join('\n');
  gh('issue', 'create', '--title', title, '--body', body, '--label', 'chore');
  open.add(title);
  filed++;
  console.log(`filed: ${title}`);
}
console.log(`doc-coverage: ${filed} issue(s) filed`);
