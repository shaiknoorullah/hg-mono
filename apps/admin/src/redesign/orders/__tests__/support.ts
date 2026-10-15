/**
 * Test data for the orders pages: contract fixtures, cloned and adjusted. The clock is the
 * fixtures' own frozen one, so a deadline in a fixture is in the future exactly as drawn.
 */
import { vi } from 'vitest';
import type { Schema } from '@hg/api-client';

import { fixture } from '../../testing';

export type Summary = Schema['OrderSummary'];
export type Order = Schema['OrderAdminView'];

export const FROZEN_NOW = '2026-08-10T18:42:11.412Z';

/** Only `Date` is faked, so timers, `waitFor` and promises behave normally. */
export function freezeClock(at: string = FROZEN_NOW) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(at));
}

export const page = (rows: unknown[], over: { next_cursor?: string | null; has_more?: boolean; total?: number } = {}) => ({
  data: rows,
  meta: { next_cursor: null, has_more: false, ...over },
});

export function summaries(): Summary[] {
  return fixture<Summary[]>('order_admin_list_every_state');
}

export function order(name: string, over: Partial<Order> = {}): Order {
  return { ...fixture<Order>(name), ...over };
}

export function disputed(code: string, minutes: number | null): Summary {
  const base = summaries().find((s) => s.state === 'DISPUTED')!;
  return {
    ...base,
    id: `d${code.replace(/\W/g, '').toLowerCase().padEnd(7, '0').slice(0, 7)}-0000-4000-8000-000000000000`,
    code,
    deadline_at: minutes === null ? null : new Date(Date.parse(FROZEN_NOW) + minutes * 60_000).toISOString(),
  };
}
