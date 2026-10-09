#!/usr/bin/env tsx
/**
 * `pnpm --filter @hg/ui-web lint:composition`: the composition lint in WARN mode.
 *
 * Prints every finding and exits 0, always (it becomes an error at W8). With
 * `--write-baseline` it records today's apps/{restaurant,admin}/src/components files as
 * the legacy baseline instead; run that only when the baseline is meant to move.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { componentFiles, lintComposition } from './composition.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..');
const BASELINE = join(HERE, 'composition-baseline.json');

interface Baseline {
  $description: string;
  files: string[];
}

function main(): void {
  if (process.argv.includes('--write-baseline')) {
    const files = componentFiles(REPO);
    const body: Baseline = {
      $description:
        'Legacy files under apps/{restaurant,admin}/src/components when the composition lint landed. ' +
        'Rule C-1 reports any file not listed here. Regenerate with lint:composition --write-baseline.',
      files,
    };
    writeFileSync(BASELINE, JSON.stringify(body, null, 2) + '\n');
    console.log(`composition baseline: ${files.length} file(s) recorded`);
    return;
  }

  let baseline: string[] = [];
  try {
    baseline = (JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline).files;
  } catch {
    console.warn('composition lint: no baseline file; every component file counts as new');
  }

  const findings = lintComposition(REPO, baseline);
  if (findings.length === 0) {
    console.log('composition lint (warn): clean');
    return;
  }
  for (const f of findings) console.warn(`${f.file}:${f.line}  ${f.rule}  ${f.message}`);
  console.warn(
    `\ncomposition lint (warn): ${findings.length} finding(s). Warnings only until W8; ` +
      'see packages/ui-web/src/lint/composition.ts.',
  );
}

try {
  main();
} catch (error) {
  // Warn mode: even a crash in the lint itself must not fail a build.
  console.warn(`composition lint (warn): could not run: ${String(error)}`);
}
