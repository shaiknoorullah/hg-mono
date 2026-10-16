#!/usr/bin/env node
// Checks that the customer app's native design captures name boards that exist, and that every
// customer board is either captured or declared unpairable with a reason.
//
//   node tools/e2e/native/check-boards.mjs [--ref origin/claude/redesign-canvases] [--require-ref]
//
// A flow captures a board with the design-capture subflow, `SHOT: design--<area>--<Board>`; the
// design-diff harness reads that name as the board customer/<area>/<Board> (tools/design-diff/src/names.mjs,
// which this imports, so the two cannot disagree), and the board is the file
// canvases/customer/<area>/project/<Board>.dc.html on the canvases branch.
//
// Without the branch (a CI checkout does not fetch it) only the flows and customer-boards.mjs are
// checked against each other; with it, every board is accounted for. --require-ref fails when the
// branch is missing. Exit 0 when sound, 1 with one line per problem, 2 on a usage error.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCaptureFile } from '../../design-diff/src/names.mjs';
import { UNPAIRABLE } from './customer-boards.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FLOWS = join(here, 'customer', 'redesign');
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
 * @param {string[] | null} boards  "<area>/<Board>" for every customer board, or null when the branch is not at hand
 */
export function check(shots, rules, boards) {
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
    if (!(re instanceof RegExp)) problems.push(`customer-boards.mjs entry ${i}: the pattern is not a RegExp`);
    if (typeof reason !== 'string' || reason.trim().length < 30) problems.push(`customer-boards.mjs entry ${i} (${re}): the reason is missing or too short to be one`);
  });
  const ruleOf = (id) => rules.findIndex(([re]) => re.test(id));
  for (const [id, where] of paired) {
    const r = ruleOf(id);
    if (r >= 0) problems.push(`${where}: ${id} is captured, yet customer-boards.mjs entry ${r} declares it unpairable (${rules[r][0]})`);
  }
  if (!boards) return { problems, paired, unpairable: null };

  const known = new Set(boards);
  for (const [id, where] of paired) if (!known.has(id)) problems.push(`${where}: ${id} is not a board on the canvases branch (canvases/customer/${id.replace('/', '/project/')}.dc.html)`);
  const used = new Set();
  const unpairable = new Map();
  for (const id of boards) {
    if (paired.has(id)) continue;
    const r = ruleOf(id);
    if (r < 0) problems.push(`${id}: no flow captures it and customer-boards.mjs gives no reason; capture it, or add an entry saying why it cannot be`);
    else {
      used.add(r);
      unpairable.set(id, r);
    }
  }
  rules.forEach(([re], i) => {
    if (!used.has(i)) problems.push(`customer-boards.mjs entry ${i} (${re}) matches no board that is not captured; it is stale or shadowed`);
  });
  return { problems, paired, unpairable };
}

/** "<area>/<Board>" of every customer board on `ref`, or null when the ref cannot be read. */
function boardsOn(ref) {
  let listed;
  try {
    listed = execFileSync('git', ['ls-tree', '-r', '--full-tree', '--name-only', ref, 'canvases/customer'], { cwd: here, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
  const boards = listed.split('\n').map((f) => /^canvases\/customer\/([^/]+)\/project\/([^/]+)\.dc\.html$/.exec(f)).filter(Boolean).map((m) => `${m[1]}/${m[2]}`);
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
  const boards = boardsOn(ref);
  if (!boards && argv.includes('--require-ref')) {
    console.error(`No customer boards on ${ref}. Fetch it first: git fetch origin claude/redesign-canvases`);
    process.exit(2);
  }
  const shots = shotsIn(FLOWS);
  const { problems, paired, unpairable } = check(shots, UNPAIRABLE, boards);
  if (problems.length) {
    console.error(`${problems.length} problem${problems.length === 1 ? '' : 's'}:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  if (!boards) {
    console.log(`${paired.size} captures name well-formed boards and none is declared unpairable. ${ref} is not available, so whether the boards exist, and whether every board is accounted for, was not checked.`);
    return;
  }
  const byArea = {};
  for (const id of boards) {
    const area = id.split('/')[0];
    byArea[area] ??= { boards: 0, paired: 0, unpairable: 0 };
    byArea[area].boards += 1;
    byArea[area][paired.has(id) ? 'paired' : 'unpairable'] += 1;
  }
  console.log(`${boards.length} customer boards on ${ref}: ${paired.size} captured, ${unpairable.size} unpairable with a reason`);
  for (const [area, n] of Object.entries(byArea)) console.log(`  ${area.padEnd(15)} ${String(n.boards).padStart(3)} boards  ${String(n.paired).padStart(2)} captured  ${String(n.unpairable).padStart(3)} unpairable`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
