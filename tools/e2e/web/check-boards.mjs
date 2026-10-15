// Checks that every design board a web spec declares exists on the canvases branch, so a typo or a
// renamed board fails here instead of silently going uncovered.
//
//   node tools/e2e/web/check-boards.mjs [--ref origin/claude/redesign-canvases]
//
// A board id is `<app>/<area>/<Board>`; it must be the file
// canvases/<app>/<area>/project/<Board>.dc.html on the ref (tools/e2e/README.md, "Design captures").
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const refArg = process.argv.indexOf('--ref');
const ref = refArg > 0 ? process.argv[refArg + 1] : 'origin/claude/redesign-canvases';

const listed = execFileSync('git', ['ls-tree', '-r', '--full-tree', '--name-only', ref], { cwd: here, encoding: 'utf8', maxBuffer: 1 << 26 });
const boards = new Set(
  listed
    .split('\n')
    .map((f) => /^canvases\/([^/]+)\/([^/]+)\/project\/([^/]+)\.dc\.html$/.exec(f))
    .filter(Boolean)
    .map((m) => `${m[1]}/${m[2]}/${m[3]}`),
);
if (boards.size === 0) {
  console.error(`No boards found on ${ref}. Fetch it first: git fetch origin claude/redesign-canvases`);
  process.exit(2);
}

const ID = /['"`]((?:restaurant|admin)\/[a-z0-9-]+\/[A-Za-z0-9._-]+)['"`]/g;
const missing = [];
let declared = 0;
for (const file of readdirSync(here).filter((f) => /^redesign-.*\.ts$/.test(f))) {
  const text = readFileSync(join(here, file), 'utf8');
  for (const m of text.matchAll(ID)) {
    declared += 1;
    if (!boards.has(m[1])) missing.push(`${file}: ${m[1]}`);
  }
}
// The restaurant sign-in spec builds its ids from a table of board names.
const signIn = readFileSync(join(here, 'redesign-restaurant.sign-in.spec.ts'), 'utf8');
for (const m of signIn.matchAll(/:\s*'([A-Za-z0-9._-]+)'/g)) {
  const id = `restaurant/sign-in/${m[1]}`;
  if (/^(Main|SignIn-|Register-|CheckEmail-|Verify-|Forgot-|Reset-|Tab-|Phone-)/.test(m[1])) {
    declared += 1;
    if (!boards.has(id)) missing.push(`redesign-restaurant.sign-in.spec.ts: ${id}`);
  }
}
console.log(`${declared} board declarations checked against ${boards.size} boards on ${ref}`);
if (missing.length) {
  console.error(`Not boards on ${ref}:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
