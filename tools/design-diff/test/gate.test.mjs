// The regression gate: which protected boards stopped passing. Run: pnpm --filter @hg/design-diff test:unit

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gate } from '../src/gate.mjs';

test('gate: a protected board that fails, is not compared or has no capture is a regression', () => {
  const results = {
    pairs: [
      { id: 'restaurant/sign-in/Reset-Done', verdict: 'PASS' },
      { id: 'restaurant/sign-in/Verify-Used', verdict: 'FAIL' },
      { id: 'restaurant/sign-in/Main', verdict: 'NOT COMPARED' },
      { id: 'admin/staff/AcceptInvalid', verdict: 'PASS' },
    ],
  };
  const { regressed, newlyPassing } = gate(results, ['restaurant/sign-in/Reset-Done', 'restaurant/sign-in/Verify-Used', 'restaurant/sign-in/Main', 'restaurant/sign-in/Gone']);
  assert.deepEqual(regressed, [
    { id: 'restaurant/sign-in/Gone', verdict: 'no capture' },
    { id: 'restaurant/sign-in/Main', verdict: 'NOT COMPARED' },
    { id: 'restaurant/sign-in/Verify-Used', verdict: 'FAIL' },
  ]);
  assert.deepEqual(newlyPassing, ['admin/staff/AcceptInvalid']);
});

test('gate: a board captured twice passes only if every capture passes', () => {
  const results = { pairs: [{ id: 'a/b/C', verdict: 'PASS' }, { id: 'a/b/C', verdict: 'FAIL' }, { id: 'a/b/D', verdict: 'FAIL' }, { id: 'a/b/D', verdict: 'PASS' }] };
  assert.deepEqual(gate(results, ['a/b/C', 'a/b/D']).regressed.map((r) => r.id), ['a/b/C', 'a/b/D']);
  assert.deepEqual(gate({ pairs: [] }, []).regressed, []);
});
