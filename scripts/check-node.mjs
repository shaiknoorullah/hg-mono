#!/usr/bin/env node
// Fails fast, with the reason, when the running Node is not the one `.nvmrc` pins.
//
// Why: under Node 24 the admin app's readiness-probe tests fail (jsdom's AbortSignal is
// rejected by Node's own fetch, issue #919), and seven failures about an unrelated banner
// look like a real regression. A git hook runs with the PATH of whoever ran `git push`,
// not of an interactive shell, so it can pick up the wrong Node without anyone noticing.
// Nothing here switches versions; this repository has no version manager to do that.
//
//   node scripts/check-node.mjs     exit 0 if the major matches, otherwise 1 with the fix
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const want = readFileSync(fileURLToPath(new URL('../.nvmrc', import.meta.url)), 'utf8').trim();
const have = process.versions.node;

if (have.split('.')[0] !== want.split('.')[0]) {
  console.error(`Node ${have} is running here (${process.execPath}); this repository needs Node ${want}.`);
  console.error('Tests fail under any other major, and the failures look like a real regression:');
  console.error('https://github.com/shaiknoorullah/hg-mono/issues/919');
  console.error('Put Node ' + want + ' first on PATH for the shell that runs this (`fnm use`, `nvm use`, or `asdf`/`mise` reading .nvmrc), then retry.');
  process.exit(1);
}
