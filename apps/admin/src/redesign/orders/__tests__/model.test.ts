import { describe, expect, it } from 'vitest';

import { fixture } from '../../testing';
import {
  checkOrderCode,
  isRunningPreset,
  ordersQuery,
  RUNNING_STATES,
  NO_FILTERS,
  sortByDeadline,
  torontoDayEnd,
  torontoDayStart,
  itemsText,
  type OrderSummary,
} from '../model';

describe('checking a typed order code before it is sent', () => {
  it('accepts the shape the contract accepts, in any case', () => {
    expect(checkOrderCode(' hg-8f3k2q ')).toEqual({ kind: 'valid', code: 'HG-8F3K2Q' });
    expect(checkOrderCode('')).toEqual({ kind: 'empty' });
  });

  it('refuses a code with I, L, O or U, or the wrong length, and says why', () => {
    const bad = checkOrderCode('HG-7Q2L');
    expect(bad.kind).toBe('invalid');
    if (bad.kind === 'invalid') expect(bad.message).toMatch(/too short and has an L, so it wasn’t searched/);
    expect(checkOrderCode('HG-7Q2M4KX').kind).toBe('invalid');
    expect(checkOrderCode('8F3K2Q').kind).toBe('invalid');
  });

  it('never puts a bad code, or a bad id, on the wire', () => {
    const q = ordersQuery({ ...NO_FILTERS, code: 'HG-7Q2L', restaurantId: 'not-an-id', accountId: '0192a4c1-5e7b-7a10-b3c2-9d4e8f117d20' }, null, 25);
    expect(q).toEqual({ limit: 25, account_id: '0192a4c1-5e7b-7a10-b3c2-9d4e8f117d20' });
  });
});

describe('Still running', () => {
  it('is exactly the states that carry a deadline: the fixtures say which', () => {
    const rows = fixture<OrderSummary[]>('order_admin_list_every_state');
    expect(new Set(rows.map((r) => r.state)).size).toBe(14);
    const withDeadline = rows.filter((r) => r.deadline_at).map((r) => r.state).sort();
    expect(withDeadline).toEqual([...RUNNING_STATES].sort());
    expect(RUNNING_STATES).toHaveLength(9);
    expect(isRunningPreset([...RUNNING_STATES].reverse())).toBe(true);
    expect(isRunningPreset(['PREPARING'])).toBe(false);
  });
});

describe('dates in the platform zone', () => {
  it('a placed-to date includes the whole Toronto day, across the change to winter time', () => {
    expect(torontoDayStart('2026-09-01')).toBe('2026-09-01T04:00:00.000Z');
    expect(torontoDayEnd('2026-09-01')).toBe('2026-09-02T03:59:59.999Z');
    expect(torontoDayStart('2026-11-02')).toBe('2026-11-02T05:00:00.000Z');
    expect(torontoDayEnd('2026-11-01')).toBe('2026-11-02T04:59:59.999Z');
  });
});

describe('disputes in deadline order', () => {
  it('sorts the soonest first and puts a missing deadline last', () => {
    const rows = [
      { deadline_at: '2026-08-12T00:00:00Z', n: 'late' },
      { deadline_at: null, n: 'none' },
      { deadline_at: '2026-08-10T20:00:00Z', n: 'soon' },
    ];
    expect(sortByDeadline(rows).map((r) => r.n)).toEqual(['soon', 'late', 'none']);
  });
});

describe('item text', () => {
  it('names two and says "and more" for the rest', () => {
    expect(itemsText({ item_count: 3, first_item_names: ['A', 'B'] })).toBe('3 items: A, B, and more');
    expect(itemsText({ item_count: 1, first_item_names: ['A'] })).toBe('1 item: A');
  });
});
