#!/usr/bin/env node
// The capture specs that failed, by name, from the JUnit reports Playwright already writes.
//
//   node capture-failures.mjs [playwright dir] [--known known-capture-failures.json]
//
// The captures job used to ignore a failing spec, on purpose: one broken spec must not cost every
// other board its verdict (design-diff now runs after a failed captures job, #1082). That leniency
// made a failure **silent** — a spec that fails takes no
// capture, and a board with no capture is reported by the diff as "uncaptured", which is also what a
// board nobody has written a capture for looks like. One is a regression and the other is work not
// started yet, and they were indistinguishable (#1049's job, raised in review).
//
// So the failures are named. And since #1093 the job fails on a NEW one: `known-capture-failures.json`
// lists the specs that fail on `main` today, each with the issue that tracks it, and a spec that
// fails and is not listed exits 1. A listed spec that now passes is printed, to be removed from the
// list. The same ratchet as the design-diff regression gate (tools/design-diff/src/gate.mjs).
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

const unescape = (t) => t.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * The failed specs of one JUnit file with the Playwright project each ran in. The project is the
 * `hostname` of the enclosing `<testsuite>` (one per project and file); the same spec runs in the
 * desktop and the tablet project and can fail in only one of them.
 */
export function failedSpecs(xml) {
  const out = [];
  for (const suite of xml.split(/<testsuite\b/).slice(1)) {
    const head = suite.slice(0, suite.indexOf('>'));
    const project = unescape((/\bhostname="([^"]*)"/.exec(head) ?? [])[1] ?? '');
    for (const spec of failuresIn(suite.slice(suite.indexOf('>')))) out.push({ project, spec: unescape(spec) });
  }
  return out;
}

/** The Playwright projects a JUnit file ran: a job runs only its own app's, and says nothing of the others. */
export function projectsIn(xml) {
  return [...xml.matchAll(/<testsuite\b[^>]*\bhostname="([^"]*)"/g)].map((m) => unescape(m[1]));
}

/** The identity a known failure is listed by. */
export const specId = (f) => `${f.project} › ${f.spec}`;

/**
 * What a run says about the known failures: specs that failed and are not listed (the run fails),
 * listed specs that did not fail (to be removed), and listed entries without an issue.
 */
export function ratchet(failed, known, ran = null) {
  const listed = new Map(known.map((k) => [specId(k), k]));
  const failedIds = new Set(failed.map(specId));
  return {
    unlisted: failed.filter((f) => !listed.has(specId(f))),
    // Only a project this run ran can say a spec now passes: the admin job knows nothing of the restaurant specs.
    nowPassing: known.filter((k) => !failedIds.has(specId(k)) && (!ran || ran.has(k.project))),
    noIssue: known.filter((k) => !Number.isInteger(k.issue)),
  };
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
  const arg = (flag) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : undefined; };
  const dir = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(process.env.E2E_OUT ?? 'e2e-out', 'playwright');
  const knownFile = arg('--known') ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'known-capture-failures.json');
  const known = JSON.parse(readFileSync(knownFile, 'utf8')).specs ?? [];

  const files = reports(dir);
  // No report is not "every spec passed": the run crashed before writing one.
  if (!files.length) {
    console.log(`::error title=no capture report::no junit.xml under ${dir}; the capture run did not finish`);
    process.exit(1);
  }
  const failed = files.flatMap((f) => failedSpecs(readFileSync(f, 'utf8')));
  const ran = new Set(files.flatMap((f) => projectsIn(readFileSync(f, 'utf8'))));
  const { unlisted, nowPassing, noIssue } = ratchet(failed, known, ran);

  const lines = [];
  if (failed.length) {
    lines.push('## Capture specs that failed', '', `**${failed.length}** capture ${failed.length === 1 ? 'spec' : 'specs'} failed, **${unlisted.length}** not on the known list. Each one took no capture, so its boards are reported as uncaptured rather than as a difference.`, '');
    const issueOf = new Map(known.map((k) => [specId(k), k.issue]));
    for (const f of failed) lines.push(`- \`${f.spec}\` (${f.project})${issueOf.has(specId(f)) ? ` known, #${issueOf.get(specId(f))}` : ' **NEW**'}`);
    lines.push('');
  }
  if (nowPassing.length) {
    lines.push(`## ${nowPassing.length} known failures now pass`, '', 'Remove them from `tools/e2e/web/known-capture-failures.json` (and close the issue when its last entry goes):', '', ...nowPassing.map((k) => `- \`${k.spec}\` (${k.project}), #${k.issue}`), '');
  }
  console.log(lines.join('\n') || 'capture-failures: every capture spec passed');
  if (lines.length && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');

  console.log(`${failed.length} capture specs failed; ${known.length} are known; ${unlisted.length} are new.`);
  for (const f of unlisted) console.log(`::error title=capture spec failed::${f.spec} (${f.project}) passes on main and fails here`);
  for (const k of noIssue) console.log(`::error title=known failure without an issue::${specId(k)}`);
  process.exit(unlisted.length || noIssue.length ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
