#!/usr/bin/env node
// Checks that the customer and rider apps' native design captures name boards that exist, and that every
// board of those apps is either captured or declared unpairable with a reason.
//
//   node tools/e2e/native/check-boards.mjs [--ref origin/claude/redesign-canvases] [--require-ref]
//
// A flow captures a board with the design-capture subflow, `SHOT: design--<area>--<Board>`; the
// design-diff harness reads that name as the board <app>/<area>/<Board> (tools/design-diff/src/names.mjs,
// which this imports, so the two cannot disagree), and the board is the file
// canvases/<app>/<area>/project/<Board>.dc.html on the canvases branch. The flows of an app are
// native/<app>/redesign/**; the boards it cannot capture are in customer-boards.mjs and rider-boards.mjs.
//
// Without the branch (a CI checkout does not fetch it) only the flows and the boards files are
// checked against each other; with it, every board is accounted for. --require-ref fails when the
// branch is missing. Exit 0 when sound, 1 with one line per problem, 2 on a usage error.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCaptureFile } from '../../design-diff/src/names.mjs';
import { UNPAIRABLE as CUSTOMER_UNPAIRABLE } from './customer-boards.mjs';
import { UNPAIRABLE as RIDER_UNPAIRABLE } from './rider-boards.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** The native apps whose boards are accounted for: where their flows are and the rules for the boards no flow captures. */
export const APPS = {
  customer: { flows: join(here, 'customer', 'redesign'), rules: CUSTOMER_UNPAIRABLE, file: 'customer-boards.mjs' },
  rider: { flows: join(here, 'rider', 'redesign'), rules: RIDER_UNPAIRABLE, file: 'rider-boards.mjs' },
};
const SHOT = /^\s*(?:-\s*takeScreenshot:|SHOT:)\s*(design--\S+?)\s*$/;

/** Every `design--…` screenshot name a flow takes, with the file it is in. */
export function shotsIn(dir) {
  const found = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.yaml')) {
        readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
          const m = SHOT.exec(line);
          if (m) found.push({ shot: m[1], file: relative(here, p), line: i + 1 });
        });
      }
    }
  };
  walk(dir);
  return found;
}

/** `design--sign-in--Main` → `sign-in/Main`, or null when it is not a capture name. */
export const boardOf = (shot) => {
  const p = parseCaptureFile(`${shot}.png`);
  return p ? `${p.area}/${p.board}` : null;
};

/**
 * The problems between the flows' shots, the unpairable rules and (when given) the boards on the branch.
 * @param {{ shot: string, file: string, line: number }[]} shots
 * @param {[RegExp, string][]} rules
 * @param {string[] | null} boards  "<area>/<Board>" for every board of the app, or null when the branch is not at hand
 * @param {{ file?: string, app?: string }} [names]  the rules file and the app, for the messages
 */
export function check(shots, rules, boards, names = {}) {
  const { file = 'customer-boards.mjs', app = 'customer' } = names;
  const problems = [];
  const paired = new Map();
  for (const s of shots) {
    const id = boardOf(s.shot);
    if (!id) {
      problems.push(`${s.file}:${s.line}: "${s.shot}" is not a capture name (design--<area>--<Board>)`);
      continue;
    }
    if (paired.has(id)) problems.push(`${s.file}:${s.line}: ${id} is captured twice (also ${paired.get(id)}); the second would overwrite the first in the flow folder`);
    else paired.set(id, `${s.file}:${s.line}`);
  }
  rules.forEach(([re, reason], i) => {
    if (!(re instanceof RegExp)) problems.push(`${file} entry ${i}: the pattern is not a RegExp`);
    if (typeof reason !== 'string' || reason.trim().length < 30) problems.push(`${file} entry ${i} (${re}): the reason is missing or too short to be one`);
  });
  const ruleOf = (id) => rules.findIndex(([re]) => re.test(id));
  for (const [id, where] of paired) {
    const r = ruleOf(id);
    if (r >= 0) problems.push(`${where}: ${id} is captured, yet ${file} entry ${r} declares it unpairable (${rules[r][0]})`);
  }
  if (!boards) return { problems, paired, unpairable: null };

  const known = new Set(boards);
  for (const [id, where] of paired) if (!known.has(id)) problems.push(`${where}: ${id} is not a board on the canvases branch (canvases/${app}/${id.replace('/', '/project/')}.dc.html)`);
  const used = new Set();
  const unpairable = new Map();
  for (const id of boards) {
    if (paired.has(id)) continue;
    const r = ruleOf(id);
    if (r < 0) problems.push(`${id}: no flow captures it and ${file} gives no reason; capture it, or add an entry saying why it cannot be`);
    else {
      used.add(r);
      unpairable.set(id, r);
    }
  }
  rules.forEach(([re], i) => {
    if (!used.has(i)) problems.push(`${file} entry ${i} (${re}) matches no board that is not captured; it is stale or shadowed`);
  });
  return { problems, paired, unpairable };
}

/** "<area>/<Board>" of every board of `app` on `ref`, or null when the ref cannot be read. */
function boardsOn(ref, app) {
  let listed;
  try {
    listed = execFileSync('git', ['ls-tree', '-r', '--full-tree', '--name-only', ref, `canvases/${app}`], { cwd: here, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
  const boards = listed.split('\n').map((f) => new RegExp(`^canvases/${app}/([^/]+)/project/([^/]+)\\.dc\\.html$`).exec(f)).filter(Boolean).map((m) => `${m[1]}/${m[2]}`);
  return boards.length ? boards : null;
}

function main() {
  const argv = process.argv.slice(2);
  const refAt = argv.indexOf('--ref');
  const ref = refAt >= 0 ? argv[refAt + 1] : 'origin/claude/redesign-canvases';
  if (!ref) {
    console.error('--ref needs a git ref');
    process.exit(2);
  }
  const appAt = argv.indexOf('--app');
  const only = appAt >= 0 ? argv[appAt + 1] : null;
  if (only && !APPS[only]) {
    console.error(`--app is one of ${Object.keys(APPS).join(', ')}`);
    process.exit(2);
  }
  let failed = false;
  for (const [app, { flows, rules, file }] of Object.entries(APPS)) {
    if (only && only !== app) continue;
    const boards = boardsOn(ref, app);
    if (!boards && argv.includes('--require-ref')) {
      console.error(`No ${app} boards on ${ref}. Fetch it first: git fetch origin claude/redesign-canvases`);
      process.exit(2);
    }
    const { problems, paired, unpairable } = check(shotsIn(flows), rules, boards, { file, app });
    if (problems.length) {
      failed = true;
      console.error(`${app}: ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n  ${problems.join('\n  ')}`);
      continue;
    }
    if (!boards) {
      console.log(`${app}: ${paired.size} captures name well-formed boards and none is declared unpairable. ${ref} is not available, so whether the boards exist, and whether every board is accounted for, was not checked.`);
      continue;
    }
    const byArea = {};
    for (const id of boards) {
      const area = id.split('/')[0];
      byArea[area] ??= { boards: 0, paired: 0, unpairable: 0 };
      byArea[area].boards += 1;
      byArea[area][paired.has(id) ? 'paired' : 'unpairable'] += 1;
    }
    console.log(`${boards.length} ${app} boards on ${ref}: ${paired.size} captured, ${unpairable.size} unpairable with a reason`);
    for (const [area, n] of Object.entries(byArea)) console.log(`  ${area.padEnd(20)} ${String(n.boards).padStart(3)} boards  ${String(n.paired).padStart(2)} captured  ${String(n.unpairable).padStart(3)} unpairable`);
  }
  if (failed) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
