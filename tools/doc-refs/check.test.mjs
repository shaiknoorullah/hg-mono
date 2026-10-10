// node --test tools/doc-refs/check.test.mjs
// Builds a tiny repo, plants one stale reference of each kind, and checks that each one fails
// and that the baseline lets an existing one through.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { issueRefs } from './issue-refs.mjs';

const CHECK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check.mjs');

function repo(doc) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-refs-'));
  const put = (f, s) => (fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }), fs.writeFileSync(path.join(root, f), s));
  put('services/hg/Makefile', '.PHONY: up\nup: ## start\n\tdocker compose up\nmigrate: up\n\tgoose up\n');
  put('services/hg/internal/config/config.go', 'package config\nvar _ = "HG_DB_URL"\n');
  put('deploy/.env.example', 'HG_REDIS_URL=redis://redis:6379\n');
  put('.github/workflows/ci.yml', 'jobs:\n  a:\n    runs-on: ${{ fromJSON(vars.HG_RUNS_ON || \'"ubuntu-latest"\') }}\n');
  put('package.json', JSON.stringify({ name: 'root', scripts: { check: 'x', mock: 'x' } }));
  put('apps/web/package.json', JSON.stringify({ name: '@hg/web', scripts: { dev: 'x' } }));
  put('apps/web/src/main.ts', '');
  put('docs/guide.md', doc);
  return root;
}

function run(root, ...args) {
  const r = spawnSync(process.execPath, [CHECK, '--root', root, ...args], { encoding: 'utf8', env: { ...process.env, CI: '', GH_TOKEN: '', GITHUB_TOKEN: '' } });
  return { code: r.status, out: r.stdout + r.stderr };
}

const CLEAN = [
  'Run `make up` then `cd services/hg && make migrate`.',
  '```bash\npnpm check\npnpm --filter @hg/web dev\npnpm --filter web dev\n```',
  'Code is in `apps/web/src/main.ts`, `apps/*/src/**`, `apps/<app>/src/` and `apps/…`.',
  'Config: `HG_DB_URL`, `HG_REDIS_URL`, all of `HG_REDIS_*`.',
  'Runners: the repository variable `HG_RUNS_ON`.',
].join('\n\n');

test('a clean doc passes', () => {
  const r = run(repo(CLEAN));
  assert.equal(r.code, 0, r.out);
});

for (const [kind, line] of [
  ['path', 'The seal is in `apps/web/src/Seal.tsx`.'],
  ['make', 'Wipe it with `make nuke`.'],
  ['pnpm', 'Start it with `pnpm --filter @hg/web storybook-serve`.'],
  ['pnpm', 'Start it with `pnpm --filter @hg/gone dev`.'],
  ['pnpm', 'Run `pnpm deploy-all`.'],
  ['env', 'Set `HG_LEGACY_MODE=1`.'],
]) {
  test(`a stale ${kind} reference fails: ${line}`, () => {
    const r = run(repo(`${CLEAN}\n\n${line}\n`));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, new RegExp(`\\[${kind}\\]`));
  });
}

test('a baselined finding passes, a new one still fails', () => {
  const root = repo(`${CLEAN}\n\nWipe it with \`make nuke\`.\n`);
  assert.equal(run(root, '--update-baseline').code, 0);
  assert.equal(run(root).code, 0);
  fs.appendFileSync(path.join(root, 'docs/guide.md'), '\nAlso `make reset`.\n');
  const r = run(root);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /make reset/);
  assert.doesNotMatch(r.out, /\[make\] make nuke/);
});

// lychee: GitHub draws issue and PR comment anchors with JavaScript, so a missing fragment there
// is not a broken link (5 Oct: issues #560–#577). The URL itself is still checked.
test('a missing fragment on a github.com issue or PR is not a finding; the URL still is', () => {
  const root = repo(CLEAN);
  const gh = 'https://github.com/shaiknoorullah/hg-mono';
  const lychee = (errs, elsewhere = []) => {
    const f = path.join(root, 'lychee.json');
    fs.writeFileSync(f, JSON.stringify({ error_map: { 'docs/guide.md': errs, 'README.md': elsewhere } }));
    return run(root, '--lychee', f);
  };
  const missing = { text: 'Cannot find fragment' };
  const cached = { text: 'Error (cached)' };

  // only JavaScript-drawn anchors: issues and PRs, first report and its cached repeats
  let r = lychee([
    { url: `${gh}/issues/85#issuecomment-5976668489`, status: missing },
    { url: `${gh}/pull/541#discussion_r123`, status: missing },
    { url: `${gh}/pull/541/files#diff-abc`, status: missing },
  ], [{ url: `${gh}/issues/85#issuecomment-5976668489`, status: cached }]);
  assert.equal(r.code, 0, r.out);

  // the page itself is gone: still a finding, and so is its cached repeat
  r = lychee([
    { url: `${gh}/issues/99999#issuecomment-1`, status: { text: 'Rejected status code: 404 Not Found', code: 404 } },
  ], [{ url: `${gh}/issues/99999#issuecomment-1`, status: cached }]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /docs\/guide\.md {2}\[link\] .*issues\/99999#issuecomment-1 — Rejected status code: 404/);
  assert.match(r.out, /README\.md {2}\[link\] .*issues\/99999#issuecomment-1 — Error \(cached\)/);

  // other sites' fragments, and github.com pages that are not issues or PRs, are still checked
  r = lychee([
    { url: 'https://docs.stripe.com/webhooks#retries', status: missing },
    { url: `${gh}/blob/main/AGENTS.md#nope`, status: missing },
  ]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /docs\.stripe\.com\/webhooks#retries/);
  assert.match(r.out, /AGENTS\.md#nope/);
});

// Issue refs: a status word counts for an issue only in its own sentence, near the reference.
const ISSUE = (n) => `[#${n}](https://github.com/shaiknoorullah/hg-mono/issues/${n})`;

for (const [line, want] of [
  [`Blocked on ${ISSUE(123)}.`, [123]],
  [`Payouts are pending ${ISSUE(123)}.`, [123]],
  ['This is tracked in #123.', [123]],
  [`The webhook retry ${ISSUE(123)} (open).`, [123]],
  ['Blocked on #12, #13 and #14.', [12, 13, 14]],
  [`Blocked on https://github.com/shaiknoorullah/hg-mono/issues/123 until the owner decides.`, [123]],
  [`Tip makeup is the owner's open question (${ISSUE(164)}); until then it is off. Built in ${ISSUE(306)}.`, [164]],
  [`The ${ISSUE(12)} work is done, but ${ISSUE(13)} is still pending.`, [13]],
  // 5 Oct: the #249 line passed because "open row" is two sentences later.
  [
    `It applies every stored event through the same step the webhook worker takes, including one the worker set aside after repeated failures, so running it is also how such an event is retried (${ISSUE(249)}). It prints the transitions it applied. Each disagreement it will not settle by itself is written to \`reconciliation_exception\` in the same transaction that marks its event applied, at most one open row per kind and payment.`,
    [],
  ],
  // 5 Oct: the #306 line called #164 "the owner's open question", not #306.
  [
    `No other path pays a rider. Whether the platform makes up a tip lowered after the rider accepts is the owner's open question (${ISSUE(164)}); until it is decided it does not (\`HG_RIDER_TIP_MAKEUP\`, off). Issue: ${ISSUE(306)}.`,
    [164],
  ],
  [`The order history ${ISSUE(77)} landed with a long description of every column the table has, and the screen is open to admins.`, []],
  [`**Open:** is the customer offered a pickup option before the order is cancelled? (${ISSUE(336)})`, [336]],
  [`Still open: whether the platform makes up a tip the customer later lowers (${ISSUE(164)}).`, [164]],
  ['Invariant #7 is pending review.', []],
  ['Nothing here is open.', []],
]) {
  test(`issue refs: ${line.slice(0, 70)}`, () => {
    assert.deepEqual([...issueRefs(line, 'shaiknoorullah/hg-mono')].sort((a, b) => a - b), want);
  });
}
