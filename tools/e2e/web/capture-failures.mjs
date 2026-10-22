#!/usr/bin/env node
// The capture specs that failed, by name, from the JUnit reports Playwright already writes.
//
//   node capture-failures.mjs [playwright dir] [--fail]
//
// The captures job does not fail on a failing spec, on purpose: one broken spec must not cost every
// other board its verdict. But that leniency made a failure **silent** — a spec that fails takes no
// capture, and a board with no capture is reported by the diff as "uncaptured", which is also what a
// board nobody has written a capture for looks like. One is a regression and the other is work not
// started yet, and they were indistinguishable (#1049's job, raised in review).
//
// So the failures are named. `--fail` exits 1, for a caller that wants the leniency gone.
import { appendFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `<testcase name="…" classname="…">` entries holding a `<failure>`, from one JUnit file. */
export function failuresIn(xml) {
  const out = [];
  // Playwright writes one <testcase> per test, with the failure as a child element. A self-closing
  // testcase passed, so only the paired form can hold one — and the pattern has to say so: with
  // `<testcase …/>` allowed to open a pair, its lazy body runs on to the NEXT `</testcase>` and
  // takes the following test's <failure> with it, naming a test that passed. Requiring the
  // character before `>` not to be `/` is what keeps a self-closing tag out.
  for (const m of xml.matchAll(/<testcase\b([^>]*[^/>])>([\s\S]*?)<\/testcase>/g)) {
    if (!/<(failure|error)\b/.test(m[2])) continue;
    const attr = (n) => (new RegExp(`${n}="([^"]*)"`).exec(m[1]) ?? [])[1] ?? '';
    const name = attr('name');
    const file = attr('classname');
    out.push(file ? `${file} › ${name}` : name);
  }
  return out;
}

/** Every JUnit report under a directory. */
function reports(dir) {
  const found = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'junit.xml' && statSync(p).size) found.push(p);
    }
  };
  walk(dir);
  return found;
}

// Only when run as a command. Imported for `failuresIn`, the module must do nothing: it used to
// run this on import and call process.exit(0), which ended the test process part-way through and
// quietly dropped the tests after it — 25 ran of 28, with nothing reported as failing.
function main() {
  const root = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(process.env.E2E_OUT ?? 'e2e-out', 'playwright');
  const hard = process.argv.includes('--fail');

  const failed = reports(root).flatMap((f) => failuresIn(readFileSync(f, 'utf8')));

  if (!failed.length) {
    console.log('capture-failures: every capture spec passed');
    process.exit(0);
  }

  // Into the job summary when there is one, and always into the log.
  const lines = ['## Capture specs that failed', '', `**${failed.length}** capture ${failed.length === 1 ? 'spec' : 'specs'} failed. Each one took no capture, so its boards are reported as uncaptured rather than as a difference.`, '', ...failed.map((f) => `- \`${f}\``), ''];
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  }
  console.log(`::warning title=capture specs failed::${failed.length} capture specs failed and their boards will read as uncaptured: ${failed.slice(0, 5).join('; ')}${failed.length > 5 ? ' …' : ''}`);
  process.exit(hard ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
