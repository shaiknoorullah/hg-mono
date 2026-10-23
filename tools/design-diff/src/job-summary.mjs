#!/usr/bin/env node
// A diff run's verdicts as one Markdown table, for a CI job summary.
//
//   node src/job-summary.mjs --results <diff out> [--title "Design fidelity"]
//
// Reads <results>/results.json and writes Markdown to stdout. The point is that a run says how far
// every area is from its boards without anyone downloading an artifact: the HTML report is the
// place to look at a single board, this is the place to see which area to look at.
//
// Areas are ordered worst first — most FAIL, then most not-compared — because that is the order the
// work gets done in, and an alphabetical table buries the thing to fix next.
//
// It never fails: a summary that breaks a run would be worse than no summary.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Verdicts that mean "the app matches its board". Everything else is a gap of some kind. */
const PASS = 'PASS';
/** Verdicts that mean a comparison happened and the app did not match. */
const FAIL = 'FAIL';

function args(argv) {
  const o = { results: null, title: 'Design fidelity' };
  for (let i = 0; i < argv.length; i++) {
    const v = () => argv[++i];
    if (argv[i] === '--results') o.results = path.resolve(v());
    else if (argv[i] === '--title') o.title = v();
  }
  return o;
}

/** `<app>/<area>/<Board>` → `{ app, area }`; a malformed id is counted under "(unknown)". */
export function splitId(id) {
  const parts = String(id ?? '').split('/');
  return parts.length >= 3 ? { app: parts[0], area: parts[1] } : { app: '(unknown)', area: '(unknown)' };
}

/** Rows of { app, area, pass, fail, other, worst }, worst first. */
export function rows(pairs, mismatchField) {
  const by = new Map();
  for (const p of pairs) {
    const { app, area } = splitId(p.id);
    const key = `${app}/${area}`;
    const r = by.get(key) ?? { app, area, pass: 0, fail: 0, other: 0, worst: null };
    if (p.verdict === PASS) r.pass++;
    else if (p.verdict === FAIL) r.fail++;
    else r.other++;
    const pct = Number(p[mismatchField]);
    if (Number.isFinite(pct) && (r.worst === null || pct > r.worst)) r.worst = pct;
    by.set(key, r);
  }
  return [...by.values()].sort((a, b) => b.fail - a.fail || b.other - a.other || a.app.localeCompare(b.app) || a.area.localeCompare(b.area));
}

/** The whole summary as Markdown. Exported so the shape is testable without a diff run. */
export function summarise(results, title) {
  const pairs = Array.isArray(results.pairs) ? results.pairs : [];
  const mismatchField = results.comparison?.mismatchField ?? 'mismatchPct';
  const counts = new Map();
  for (const p of pairs) counts.set(p.verdict, (counts.get(p.verdict) ?? 0) + 1);
  const pass = counts.get(PASS) ?? 0;
  const uncaptured = Array.isArray(results.uncaptured) ? results.uncaptured.length : 0;

  const out = [`## ${title}`, ''];
  if (!pairs.length) {
    out.push('No captures were compared. Either no spec declared a board, or the captures did not reach this job.', '');
    return out.join('\n');
  }

  const verdicts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${n} ${v}`).join(' · ');
  out.push(`**${pairs.length} captures compared:** ${verdicts}`, '');
  out.push(`**${pass} of ${pairs.length} match their board.** ${uncaptured} board${uncaptured === 1 ? '' : 's'} of the rendered apps had no capture at all.`, '');

  const dup = Array.isArray(results.duplicates) ? results.duplicates : [];
  if (dup.length) out.push(`**${dup.length} duplicate capture${dup.length === 1 ? '' : 's'} of a board already counted** (not compared, not in the figures above; the run fails): ${dup.slice(0, 5).map((d) => `\`${d.capture}\` repeats \`${d.keptCapture}\``).join('; ')}${dup.length > 5 ? '; ...' : ''}. The captures directory is probably one level too high.`, '');
  out.push('| App | Area | Pass | Fail | Not compared | Worst |', '|---|---|---:|---:|---:|---:|');
  for (const r of rows(pairs, mismatchField)) {
    const worst = r.worst === null ? '—' : `${r.worst} %`;
    out.push(`| ${r.app} | ${r.area} | ${r.pass} | ${r.fail} | ${r.other} | ${worst} |`);
  }
  out.push('');
  // Say which scale the percentages are on. The same number means different things under different
  // conventions, and a summary read without that is worse than one that gives no number.
  if (results.comparison?.convention) out.push(`Percentages are \`${mismatchField}\` under the \`${results.comparison.convention}\` convention. "Not compared" counts every verdict that is neither pass nor fail — no board declared, unpairable, a defective reference, a missing hierarchy.`, '');
  return out.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = args(process.argv.slice(2));
  try {
    if (!o.results) throw new Error('--results <diff out> is required');
    const results = JSON.parse(readFileSync(path.join(o.results, 'results.json'), 'utf8'));
    process.stdout.write(summarise(results, o.title) + '\n');
  } catch (e) {
    process.stdout.write(`## ${o.title}\n\nThe summary could not be written: ${e.message}\n`);
  }
}
