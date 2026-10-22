#!/usr/bin/env node
// The regression gate: a board that passes stays passing.
//
//   node src/gate.mjs --results <diff out> --passing passing.json
//
// `passing.json` lists the boards that have passed on `main`. The diff itself runs with --no-strict,
// because almost no board passes yet and a gate on every FAIL would block every merge. This gate
// is narrower: it fails the run only when a listed board is not PASS in this one, whether it now
// fails, was not compared, or has no capture at all (a capture spec that broke is a regression
// too). Boards that pass and are not listed yet are printed, so the pull request that makes them
// pass can add them, and the list only ever grows by a deliberate change.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function args(argv) {
  const o = { results: null, passing: null };
  for (let i = 0; i < argv.length; i++) {
    const v = () => argv[++i];
    if (argv[i] === '--results') o.results = path.resolve(v());
    else if (argv[i] === '--passing') o.passing = path.resolve(v());
  }
  return o;
}

/**
 * What this run says about the protected boards: those that stopped passing (with this run's
 * verdict, or "no capture"), and those that pass here but are not protected yet.
 */
export function gate(results, protectedBoards) {
  const verdicts = new Map();
  for (const p of results.pairs ?? []) {
    if (!p.id) continue;
    // A board captured twice passes only if every capture of it passes.
    const was = verdicts.get(p.id);
    verdicts.set(p.id, was && was !== 'PASS' ? was : p.verdict);
  }
  const listed = new Set(protectedBoards);
  const regressed = [...listed].sort().filter((id) => verdicts.get(id) !== 'PASS').map((id) => ({ id, verdict: verdicts.get(id) ?? 'no capture' }));
  const newlyPassing = [...verdicts].filter(([id, v]) => v === 'PASS' && !listed.has(id)).map(([id]) => id).sort();
  return { regressed, newlyPassing };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = args(process.argv.slice(2));
  try {
    if (!o.results || !o.passing) throw new Error('--results <diff out> and --passing <passing.json> are required');
    const results = JSON.parse(readFileSync(path.join(o.results, 'results.json'), 'utf8'));
    const { boards } = JSON.parse(readFileSync(o.passing, 'utf8'));
    const { regressed, newlyPassing } = gate(results, boards ?? []);
    console.log(`${(boards ?? []).length} boards are protected; ${regressed.length} of them no longer pass.`);
    for (const r of regressed) console.log(`::error title=board no longer passes::${r.id} passed on main and is ${r.verdict} here`);
    if (newlyPassing.length) {
      console.log(`${newlyPassing.length} boards pass here and are not protected yet; add them to tools/design-diff/passing.json:`);
      for (const id of newlyPassing) console.log(`  ${JSON.stringify(id)},`);
    }
    process.exitCode = regressed.length ? 1 : 0;
  } catch (e) {
    console.error(`gate: ${e.message}`);
    process.exitCode = 2;
  }
}
