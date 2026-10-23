// The ratchet on the captures job: it fails on a failing capture spec that is not on the list of
// known failures (#1093). Run: pnpm --filter @hg/design-diff test:unit

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

// The ratchet on those failures (#1093): the captures job fails on a spec that is not on the list of
// known failures, and the list names the Playwright project, so a tablet-only failure is not hidden
// by a desktop entry.
test('capture ratchet: an unlisted failure fails, the project is part of the identity, a fixed spec is printed', async () => {
  const { failedSpecs, projectsIn, ratchet } = await import('../../e2e/web/capture-failures.mjs');
  const xml = `<testsuites>
    <testsuite name="a.spec.ts" hostname="admin-redesign-desktop"><testcase name="x › one" classname="a.spec.ts"><failure>e</failure></testcase><testcase name="two" classname="a.spec.ts"/></testsuite>
    <testsuite name="a.spec.ts" hostname="admin-redesign-tablet"><testcase name="x › one" classname="a.spec.ts"><failure>e</failure></testcase><testcase name="say &quot;hi&quot;" classname="a.spec.ts"><failure>e</failure></testcase></testsuite>
  </testsuites>`;
  const failed = failedSpecs(xml);
  assert.deepEqual(failed, [
    { project: 'admin-redesign-desktop', spec: 'a.spec.ts › x › one' },
    { project: 'admin-redesign-tablet', spec: 'a.spec.ts › x › one' },
    { project: 'admin-redesign-tablet', spec: 'a.spec.ts › say "hi"' },
  ]);

  // Desktop is listed, tablet is not: the tablet failure is new. Listing alone does not hide it.
  const known = [
    { project: 'admin-redesign-desktop', spec: 'a.spec.ts › x › one', issue: 1 },
    { project: 'admin-redesign-tablet', spec: 'a.spec.ts › fixed', issue: 2 },
    { project: 'admin-redesign-tablet', spec: 'a.spec.ts › say "hi"' },
  ];
  const r = ratchet(failed, known);
  assert.deepEqual(r.unlisted, [{ project: 'admin-redesign-tablet', spec: 'a.spec.ts › x › one' }]);
  assert.deepEqual(r.nowPassing, [{ project: 'admin-redesign-tablet', spec: 'a.spec.ts › fixed', issue: 2 }]);
  assert.deepEqual(r.noIssue.map((k) => k.spec), ['a.spec.ts › say "hi"']);
  assert.deepEqual(ratchet([], []), { unlisted: [], nowPassing: [], noIssue: [] });
  // A job that ran only the admin projects cannot say a restaurant spec now passes.
  assert.deepEqual(ratchet([], known, new Set(['admin-redesign-tablet'])).nowPassing.map((k) => k.spec), ['a.spec.ts › fixed', 'a.spec.ts › say "hi"']);
  assert.deepEqual(projectsIn(xml), ['admin-redesign-desktop', 'admin-redesign-tablet']);
});

test('capture ratchet: the command exits 1 on an unlisted failure, 0 on listed ones, 1 with no report', async () => {
  const script = path.join(import.meta.dirname, '../../e2e/web/capture-failures.mjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'ratchet-'));
  mkdirSync(path.join(dir, 'pw'));
  const knownFile = path.join(dir, 'known.json');
  writeFileSync(knownFile, JSON.stringify({ specs: [{ project: 'p', spec: 'a.spec.ts › old', issue: 7 }] }));
  const run = () => spawnSync(process.execPath, [script, path.join(dir, 'pw'), '--known', knownFile], { encoding: 'utf8' });
  const report = (...names) => writeFileSync(path.join(dir, 'pw', 'junit.xml'), `<testsuites><testsuite hostname="p">${names.map((n) => `<testcase name="${n}" classname="a.spec.ts"><failure>e</failure></testcase>`).join('')}</testsuite></testsuites>`);

  assert.equal(spawnSync(process.execPath, [script, path.join(dir, 'empty'), '--known', knownFile]).status, 1, 'no report is a crash');
  report('old');
  assert.equal(run().status, 0);
  report('old', 'brand new');
  const bad = run();
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /::error title=capture spec failed::a\.spec\.ts › brand new \(p\)/);
  report();
  const fixed = run();
  assert.equal(fixed.status, 0);
  assert.match(fixed.stdout, /1 known failures now pass/);
});
