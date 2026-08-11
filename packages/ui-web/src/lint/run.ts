#!/usr/bin/env tsx
/**
 * `pnpm lint` for @hg/ui-web.
 *
 * Runs lint rule L-4 (no green solids — RULE H-1 in executable form) over the
 * package source and the generated stylesheets. It is deliberately a plain
 * script rather than an ESLint plugin: L-4 has to resolve a Tailwind utility or
 * a CSS custom property back to a hex through the generated token map, which is
 * a whole-program question, not an AST question.
 *
 * Other packages can run the same rule over their own trees:
 *   tsx node_modules/@hg/ui-web/src/lint/run.ts apps/restaurant/src
 * or import { lintPaths } from '@hg/ui-web/lint'.
 */

import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintFile, type L4Violation } from './l4-no-green-solids.js';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const EXTENSIONS = /\.(tsx?|css)$/;
const SKIP = new Set(['node_modules', 'dist', 'build', '.git', '__snapshots__']);

export function collectFiles(root: string, into: string[] = []): string[] {
  const stats = statSync(root);
  if (stats.isFile()) {
    if (EXTENSIONS.test(root)) into.push(root);
    return into;
  }
  for (const entry of readdirSync(root)) {
    if (SKIP.has(entry)) continue;
    collectFiles(join(root, entry), into);
  }
  return into;
}

export function lintPaths(paths: string[]): L4Violation[] {
  const violations: L4Violation[] = [];
  for (const path of paths) {
    for (const file of collectFiles(resolve(path))) {
      violations.push(...lintFile(file));
    }
  }
  return violations;
}

function main(): void {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const targets = args.length > 0 ? args : [join(PKG, 'src')];
  const violations = lintPaths(targets);

  if (violations.length === 0) {
    console.log(`L-4 no-green-solids: clean (${targets.length} target(s))`);
    return;
  }

  for (const v of violations) {
    console.error(`${relative(process.cwd(), v.file)}:${v.line}:${v.column}  ${v.message}`);
    console.error(`  ${v.snippet}`);
  }
  console.error(
    `\nL-4 no-green-solids: ${violations.length} violation(s).\n` +
      'Solid green is reserved to color.halal.* (RULE H-1, 01-foundations.md §2.5).\n' +
      'Semantic success is tint-only: a light background with dark green text, an icon, or a 2px border.',
  );
  process.exit(1);
}

// Only run when invoked as the entry point, not when imported.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
