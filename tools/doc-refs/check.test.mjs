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
