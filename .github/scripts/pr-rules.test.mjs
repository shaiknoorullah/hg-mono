// node --test .github/scripts/   — issue #40
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { appLabelsFromPaths, bareCodes, check, countChangedLines, labelPlan, typeFromTitle } from './pr-rules.mjs';

const body = (sections) => Object.entries(sections).map(([h, c]) => `## ${h}\n${c}`).join('\n\n');
const good = {
  bug: body({
    What: 'The queue showed one order twice.',
    Issue: 'Closes #31',
    Before: '![before](https://github.com/user-attachments/assets/x.png)',
    After: '![after](https://github.com/user-attachments/assets/y.png)',
    Cause: 'The fixture repeated IDs.',
    Links: '[restaurant realtime spec](https://github.com/o/r/blob/main/docs/x.md)',
  }),
};

test('the title prefix decides the one type label', () => {
  assert.equal(typeFromTitle('fix(restaurant): queue showed orders twice'), 'bug');
  assert.equal(typeFromTitle('feat: live queue'), 'feature');
  assert.equal(typeFromTitle('ci: run tests'), 'chore');
  assert.equal(typeFromTitle('perf!: faster feed'), 'refactor');
  assert.equal(typeFromTitle('Fix the queue'), null);
  assert.equal(typeFromTitle('wip: stuff'), null);
});

test('labels converge on exactly the derived type + touched apps', () => {
  const plan = labelPlan(['feature', 'app:admin', 'help wanted'], 'fix: x', ['apps/restaurant/src/a.ts', 'packages/ui-web/b.ts']);
  assert.deepEqual(plan.add.sort(), ['app:restaurant', 'bug']);
  assert.deepEqual(plan.remove.sort(), ['app:admin', 'feature']); // unmanaged labels untouched
  assert.deepEqual(appLabelsFromPaths(['apps/marketing/x', 'apps/rider/y']), ['app:rider']);
});

test('a complete bug PR passes', () => {
  const r = check({ title: 'fix(restaurant): queue showed orders twice', body: good.bug, changedLines: 12 });
  assert.deepEqual(r.errors, []);
});

test('a bug PR without evidence, or with an empty section, fails', () => {
  const noEvidence = good.bug.replace(/## Before\n.*\n/, '## Before\nit was broken\n');
  assert.match(check({ title: 'fix: x', body: noEvidence, changedLines: 1 }).errors.join(), /needs evidence/);
  const empty = good.bug.replace('The fixture repeated IDs.', '<!-- one line -->');
  assert.match(check({ title: 'fix: x', body: empty, changedLines: 1 }).errors.join(), /"## Cause" is empty/);
});

test('an issue must be linked', () => {
  const r = check({ title: 'fix: x', body: good.bug.replace('Closes #31', 'the mock one'), changedLines: 1 });
  assert.match(r.errors.join(), /must link an issue/);
});

test('bare codes fail; linked codes and codes in fenced logs pass', () => {
  assert.deepEqual(bareCodes('Enforces invariant 10 via L-4 and §4.1'), ['invariant 10', 'L-4', '§4.1']);
  assert.deepEqual(bareCodes('[halal-only green (invariant 10)](https://x/AGENTS.md#3) and [no green solids (L-4)](https://x/f.md#9)'), []);
  assert.deepEqual(bareCodes('```\nerror L-4 at line 3\n```'), []);
  assert.deepEqual(bareCodes('see `L-4`'), ['L-4']); // backticks don't make it readable
  assert.deepEqual(bareCodes('UTF-8, #16, #D8410F, e2e'), []);
});

test('size warns above 400 changed lines, never fails; generated files do not count', () => {
  const numstat = ['300\t50\tapps/restaurant/src/a.tsx', '900\t0\tpackages/api-client/src/generated/x.ts', '5000\t10\tpnpm-lock.yaml', '-\t-\tlogo.png'].join('\n');
  assert.equal(countChangedLines(numstat), 350);
  const r = check({ title: 'fix: x', body: good.bug, changedLines: 401 });
  assert.equal(r.errors.length, 0);
  assert.equal(r.warnings.length, 1);
});
