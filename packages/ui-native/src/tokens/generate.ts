/**
 * `pnpm --filter @hg/ui-native generate:tokens`
 *
 * Reads `docs/design/tokens.json` and writes `src/tokens/generated/`. All of the work is in
 * `build.ts`; this file is only paths and I/O, so that the drift test can exercise the
 * generator without touching the filesystem or the module system.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildFiles } from './build.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const TOKENS_PATH = path.join(REPO_ROOT, 'docs', 'design', 'tokens.json');
const OUT_DIR = path.join(HERE, 'generated');

const doc = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
const files = buildFiles(doc);

fs.mkdirSync(OUT_DIR, { recursive: true });

const lines: string[] = [];
for (const [name, content] of Object.entries(files)) {
  const target = path.join(OUT_DIR, name);
  const previous = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  if (previous !== content) fs.writeFileSync(target, content, 'utf8');
  lines.push(`  ${previous === content ? 'unchanged' : 'written  '}  ${name}`);
}

// Anything left over from an earlier shape of the generator would silently keep compiling.
for (const existing of fs.readdirSync(OUT_DIR)) {
  if (!(existing in files)) {
    fs.rmSync(path.join(OUT_DIR, existing), { recursive: true });
    lines.push(`  removed    ${existing}`);
  }
}

process.stdout.write(
  `${path.relative(REPO_ROOT, TOKENS_PATH)} -> ${path.relative(REPO_ROOT, OUT_DIR)}\n${lines.join(
    '\n',
  )}\n`,
);
