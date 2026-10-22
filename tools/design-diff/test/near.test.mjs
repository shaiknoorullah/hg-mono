// Which pairs go into the small near-passing artifact. Run: pnpm --filter @hg/design-diff test:unit

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nearPairs } from '../src/near.mjs';

const pair = (id, pct, verdict = 'FAIL', images = true) => ({
  id,
  verdict,
  sharedHeightMismatchPct: pct,
  images: images ? { sideBySide: `pairs/${id.replaceAll('/', '--')}@x/side-by-side.png`, diff: `pairs/${id.replaceAll('/', '--')}@x/diff.png` } : undefined,
});

test('near pairs: under the bar, passing ones included, best first, only those with images', () => {
  const results = {
    comparison: { mismatchField: 'sharedHeightMismatchPct' },
    pairs: [
      pair('restaurant/sign-in/Main', 1.355),
      pair('restaurant/sign-in/Reset-Done', 0.005),
      pair('admin/orders/OrdersEmpty', 8.668),
      pair('restaurant/sign-in/Verify-Used', 0.02, 'PASS'),
      pair('restaurant/settings/Wide', 0.5, 'FAIL', false),
      { id: 'restaurant/settings/Tablet', verdict: 'NOT COMPARED' },
    ],
  };
  const near = nearPairs(results, 3);
  assert.deepEqual(near.map((p) => p.id), ['restaurant/sign-in/Reset-Done', 'restaurant/sign-in/Verify-Used', 'restaurant/sign-in/Main']);
  assert.equal(near[0].folder, 'pairs/restaurant--sign-in--Reset-Done@x');
  assert.deepEqual(nearPairs(results, 0.01).map((p) => p.id), ['restaurant/sign-in/Reset-Done']);
});
