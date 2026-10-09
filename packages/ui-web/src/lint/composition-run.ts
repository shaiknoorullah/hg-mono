#!/usr/bin/env tsx
/**
 * `pnpm --filter @hg/ui-web lint:composition`: the composition lint in WARN mode.
 *
 * Prints every finding and exits 0, always (it becomes an error at W8). With
 * `--write-baseline` it records today's legacy files instead (apps/{restaurant,admin}/
 * src/components for C-1, and the app files that already hold a raw interactive element
 * for C-2); run that only when the baseline is meant to move.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  componentFiles,
  lintComposition,
  rawElementFiles,
  type CompositionBaseline,
} from './composition.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..');
const BASELINE = join(HERE, 'composition-baseline.json');

interface Baseline extends CompositionBaseline {
  $description: string;
}

function main(): void {
  if (process.argv.includes('--write-baseline')) {
    const files = componentFiles(REPO);
    const raw = rawElementFiles(REPO);
    const body: Baseline = {
      $description:
        'Legacy files when the composition lint landed. files: apps/{restaurant,admin}/src/components, ' +
        'rule C-1 reports any file not listed. rawElementFiles: app files that already held a raw ' +
        'button/input/select/textarea or <a onClick>, rule C-2 reports any other. ' +
        'Regenerate with lint:composition --write-baseline.',
      files,
      rawElementFiles: raw,
    };
    writeFileSync(BASELINE, JSON.stringify(body, null, 2) + '\n');
    console.log(`composition baseline: ${files.length} component file(s), ${raw.length} raw-element file(s)`);
    return;
  }

  let baseline: CompositionBaseline = { files: [] };
  try {
    baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline;
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
