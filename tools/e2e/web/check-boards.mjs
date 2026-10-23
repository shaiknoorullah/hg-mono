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
// How a spec names a board:
//   literal   'admin/orders/OrdersEmpty'
//   template  `${OR}OrdersEmpty`, where `const OR = 'admin/orders/'` is a prefix constant in the same file
//   table     `${OR}${board}`, the board coming from a table of names in the same file
// A literal and a template are read exactly. A table is not evaluated: its names cannot be known
// without running the spec, so every quoted name in the file that is a real board under the
// constant's area is counted, and a spec that uses a table but names no board of its area fails
// (it would otherwise count nothing, silently).
const LITERAL = /['"`]((?:restaurant|admin)\/[a-z0-9-]+\/[A-Za-z0-9._-]+)['"`]/g;
const PREFIX_CONSTANT = /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*['"`]((?:restaurant|admin)\/[a-z0-9-]+\/)['"`]/gm;
const NAME = /['"`]([A-Z][A-Za-z0-9._-]*)['"`]/g;

/**
 * The boards one spec's source declares. `boards` is the set of real ids; only the table case
 * consults it. Returns `{ literals, constants, tables, problems }`: ids per shape (a literal may
 * repeat, as before) and the sites that could not be read.
 */
export function declarations(text, boards) {
  const literals = [...text.matchAll(LITERAL)].map((m) => m[1]);
  const prefixes = new Map([...text.matchAll(PREFIX_CONSTANT)].map((m) => [m[1], m[2]]));
  const constants = [];
  const tables = new Set();
  const problems = [];
  for (const [name, prefix] of prefixes) {
    const use = new RegExp(`\\$\\{${name.replace(/\$/g, '\\$')}\\}(\\$\\{[^}]*\\}|[A-Za-z0-9._-]*)`, 'g');
    let dynamic = false;
    for (const m of text.matchAll(use)) {
      if (m[1] === '') continue;
      if (m[1].startsWith('${')) dynamic = true;
      else constants.push(prefix + m[1]);
    }
    if (!dynamic) continue;
    const before = tables.size;
    for (const m of text.matchAll(NAME)) if (boards.has(prefix + m[1])) tables.add(prefix + m[1]);
    if (tables.size === before) problems.push(`\`\${${name}}\${...}\` builds a board id from a variable, and no quoted name in the file is a board under ${prefix}`);
  }
  return { literals, constants, tables: [...tables], problems };
}

export function listBoards(ref, cwd = here) {
  const listed = execFileSync('git', ['ls-tree', '-r', '--full-tree', '--name-only', ref], { cwd, encoding: 'utf8', maxBuffer: 1 << 26 });
  return new Set(
    listed
      .split('\n')
      .map((f) => /^canvases\/([^/]+)\/([^/]+)\/project\/([^/]+)\.dc\.html$/.exec(f))
      .filter(Boolean)
      .map((m) => `${m[1]}/${m[2]}/${m[3]}`),
  );
}

function main() {
  const refArg = process.argv.indexOf('--ref');
  const ref = refArg > 0 ? process.argv[refArg + 1] : 'origin/claude/redesign-canvases';
  const boards = listBoards(ref);
  if (boards.size === 0) {
    console.error(`No boards found on ${ref}. Fetch it first: git fetch origin claude/redesign-canvases`);
    process.exit(2);
  }
  const missing = [];
  let declared = 0;
  let viaConstant = 0;
  let viaTable = 0;
  for (const file of readdirSync(here).filter((f) => /^redesign-.*\.ts$/.test(f))) {
    const found = declarations(readFileSync(join(here, file), 'utf8'), boards);
    for (const id of [...found.literals, ...found.constants]) if (!boards.has(id)) missing.push(`${file}: ${id}`);
    declared += found.literals.length;
    viaConstant += found.constants.length;
    viaTable += found.tables.length;
    for (const p of found.problems) missing.push(`${file}: ${p}`);
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
  console.log(
    `${declared + viaConstant + viaTable} board declarations checked against ${boards.size} boards on ${ref}` +
      ` (${declared} literal, ${viaConstant} from a prefix constant, ${viaTable} from name tables)`,
  );
  if (missing.length) {
    console.error(`Not boards on ${ref}, or not readable:\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
