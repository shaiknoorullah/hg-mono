#!/usr/bin/env node
// Checks device-lab missions against mission.schema.json and the repo.
//
//   node tools/e2e/native/check-missions.mjs            every mission in the repo (pnpm e2e:missions:check)
//   node tools/e2e/native/check-missions.mjs <file>...  only these files (folder layout not enforced)
//
// Also checks that every GPX route under tools/e2e/native/routes/ parses, even when no mission
// uses it yet. Exits 1 with one line per problem; 0 when everything is valid.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { REPO_ROOT, NATIVE_DIR, checkMissions, findMissionFiles, parseGpx } from './mission-lib.mjs';

const args = process.argv.slice(2);
const explicit = args.length > 0;
const files = explicit ? args.map((a) => resolve(a)) : findMissionFiles();

const show = (f) => {
  const rel = relative(REPO_ROOT, f);
  return rel.startsWith('..') ? f : rel;
};

let failed = 0;
for (const f of files) {
  if (!existsSync(f)) {
    console.error(`✗ ${show(f)}: no such file`);
    failed++;
  }
}

const results = checkMissions(files.filter((f) => existsSync(f)), { inRepoLayout: !explicit });
for (const r of results) {
  if (r.problems.length) {
    failed++;
    console.error(`✗ ${show(r.file)}`);
    for (const p of r.problems) console.error(`    ${p}`);
  } else {
    console.log(`✓ ${show(r.file)}`);
  }
}

let routes = 0;
if (!explicit) {
  const dir = join(NATIVE_DIR, 'routes');
  for (const name of existsSync(dir) ? readdirSync(dir).sort() : []) {
    if (!name.endsWith('.gpx')) continue;
    routes++;
    try {
      parseGpx(readFileSync(join(dir, name), 'utf8'));
    } catch (err) {
      failed++;
      console.error(`✗ tools/e2e/native/routes/${name}: ${err.message}`);
    }
  }
}

if (!explicit && files.length === 0) console.log('no mission files found');
if (failed) {
  console.error(`\n${failed} problem file(s). The mission format and every allowed setup command and reality step: tools/e2e/native/README.md#missions`);
  process.exit(1);
}
console.log(`\n${results.length} mission(s)${explicit ? '' : ` and ${routes} route(s)`} valid.`);
