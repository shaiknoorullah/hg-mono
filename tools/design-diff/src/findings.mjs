#!/usr/bin/env node
// A diff run's failing boards, in words, small enough to read from a CI job log.
//
//   node src/findings.mjs --results <diff out> [--limit 6] [--only <regex on the board id>]
//
// The HTML report is for looking at one board; results.json is 681 pairs of everything. Neither is
// reachable from an agent on a slow link: downloading the artifact to read four lines has taken
// minutes here and sometimes returned nothing. This prints the same answer to stdout, so
// `gh run view --log | grep <board>` gets it in seconds.
//
// One block per failing board, worst first: the verdict and figure, what would have to change for a
// PASS, and the findings the layout comparison worded. A board passes on two counts — at most
// `maxMismatchPct` of pixels differing AND no connected group over `maxRegionPx` — so a board that
// is under the percentage and still failing is failing on the blob, and its bounding box is the
// thing to go and look at. That case is invisible in the percentage alone, and it is where the
// first passes will come from.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FAILING = new Set(['FAIL', 'NO LAYOUT', 'NO PROVENANCE', 'NOT COMPARED', 'DEFECTIVE REFERENCE', 'BROWSER MISMATCH', 'NO BOARD', 'UNCOVERED']);

function args(argv) {
  const o = { results: null, limit: 6, only: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const v = () => argv[++i];
    if (argv[i] === '--results') o.results = path.resolve(v());
    else if (argv[i] === '--limit') o.limit = Math.max(0, Number(v()));
    else if (argv[i] === '--only') o.only = new RegExp(v());
    else if (argv[i] === '--out') o.out = path.resolve(v());
  }
  return o;
}

/** What a board would have to change to pass, from the two counts that decide it. */
export function whyNotPassing(pair, thresholds = {}) {
  const why = [];
  const pct = pair.sharedHeightMismatchPct ?? pair.mismatchPct;
  const maxPct = thresholds.maxMismatchPct ?? 0.1;
  if (typeof pct === 'number' && pct > maxPct) why.push(`${pct} % of pixels differ, over the ${maxPct} % allowed`);
  if (pair.regionsOverLimit > 0) {
    const r = pair.largestRegion;
    const where = r ? `${r.w} x ${r.h} dp at ${r.x}, ${r.y}${r.px ? ` (${r.px} px)` : ''}` : 'size unknown';
    why.push(`${pair.regionsOverLimit} patch${pair.regionsOverLimit === 1 ? '' : 'es'} of difference larger than the ${thresholds.maxRegionPx ?? 4} px allowed; the largest is ${where}`);
  }
  if (pair.shortfall > 0) why.push(`the capture is ${pair.shortfall} dp shorter than its board, so part of the board was never compared`);
  if (!why.length && pair.reason) why.push(pair.reason);
  return why;
}

/** The whole listing as text. Exported so its shape is testable without a diff run. */
export function listing(results, { limit = 6, only = null } = {}) {
  const pairs = (results.pairs ?? []).filter((p) => FAILING.has(p.verdict)).filter((p) => !only || only.test(p.id ?? ''));
  const field = results.comparison?.mismatchField ?? 'mismatchPct';
  pairs.sort((a, b) => (Number(b[field]) || 0) - (Number(a[field]) || 0));
  const out = [`${pairs.length} boards are not passing${only ? ' (filtered)' : ''}. Worst first; percentages are ${field}.`, ''];
  for (const p of pairs) {
    const pct = p[field];
    out.push(`${p.verdict}  ${pct === undefined ? '' : `${pct} %  `}${p.id}`);
    for (const w of whyNotPassing(p, results.thresholds)) out.push(`    · ${w}`);
    for (const f of (p.layout?.findings ?? []).slice(0, limit)) out.push(`    - ${f.text ?? f}`);
    const more = (p.layout?.findings?.length ?? 0) - limit;
    if (more > 0) out.push(`    … ${more} more finding${more === 1 ? '' : 's'} in the HTML report`);
    out.push('');
  }
  return out.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = args(process.argv.slice(2));
  try {
    if (!o.results) throw new Error('--results <diff out> is required');
    const results = JSON.parse(readFileSync(path.join(o.results, 'results.json'), 'utf8'));
    const text = listing(results, o);
    process.stdout.write(text + '\n');
    if (o.out) writeFileSync(o.out, text + '\n');
  } catch (e) {
    process.stdout.write(`the findings could not be listed: ${e.message}\n`);
  }
}
