// Prints the run's Markdown summary for the workflow page: one row per flow from
// $E2E_OUT/results.tsv (written by tools/e2e/run.sh), and how many screenshots each app left.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { OUT as out } from './paths.mjs';

const icon = { pass: 'passed', fail: 'FAILED', skip: 'skipped', blocked: 'blocked' };

function countPngs(dir) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) n += countPngs(p);
    else if (name.endsWith('.png')) n += 1;
  }
  return n;
}

const lines = ['## End-to-end flows', ''];
const results = path.join(out, 'results.tsv');
if (existsSync(results)) {
  lines.push('| Flow | Result | Note |', '|---|---|---|');
  for (const row of readFileSync(results, 'utf8').trim().split('\n').filter(Boolean)) {
    const [flow, status, note = ''] = row.split('\t');
    lines.push(`| ${flow} | ${icon[status] ?? status} | ${note.replace(/\|/g, '\\|')} |`);
  }
} else {
  lines.push('No flow ran: the run stopped before the emulator started. See the step logs.');
}
lines.push('', '| Screenshots | Count |', '|---|---|');
for (const app of ['customer', 'rider', 'restaurant', 'admin']) {
  lines.push(`| ${app} | ${countPngs(path.join(out, 'screenshots', app))} |`);
}
lines.push('', 'Screenshots, Playwright traces and the stack logs: the `e2e-screenshots-and-traces` artifact.');
console.log(lines.join('\n'));
