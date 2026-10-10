/**
 * WP4 — the In progress list's rules (wp4 spec §1.2, §1.3, §2): the #601 guard, the sort,
 * a distinct labelled treatment for every state the restaurant can see, and the defensive
 * read of the field the contract does not carry yet (#290 pickup code).
 */
import { describe, expect, it, vi } from 'vitest';
import { fixture } from '../test/fakeApi';
import {
  LIVE_STATES,
  countRows,
  endedBeforeAccept,
  guardLiveRows,
  isAccepted,
  lineExtra,
  pickupCodeOf,
  readyByText,
  riderText,
  rowStatus,
  sortRows,
  type Order,
} from './model';

const NOW = Date.parse('2026-08-10T18:42:11.412Z'); // the fixtures' frozen clock
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

function order(patch: Partial<Order> & { code: string }): Order {
  const base = fixture('restaurant_order_preparing') as Order;
  return { ...base, id: `id-${patch.code}`, is_late: false, ...patch };
}

describe('#601 client guard', () => {
  it('drops COMPLETED, DELIVERED and every other non-live row the server ignores the filter for', () => {
    const busy = fixture('restaurant_order_queue_busy') as Order[];
    const completed = order({ code: 'DONE1', state: 'COMPLETED' });
    const delivered = order({ code: 'DONE2', state: 'DELIVERED' });
    const cancelled = order({ code: 'GONE', state: 'CANCELLED' });
    const rows = guardLiveRows([...busy, completed, delivered, cancelled], () => {});
    expect(rows.map((o) => o.state).every((s) => (LIVE_STATES as readonly string[]).includes(s))).toBe(true);
    expect(rows.map((o) => o.code)).not.toContain('DONE1');
    expect(rows.map((o) => o.code)).not.toContain('DONE2');
    expect(rows.map((o) => o.code)).not.toContain('GONE');
    // The strip owns RESTAURANT_PENDING: none here.
    expect(rows.some((o) => o.state === 'RESTAURANT_PENDING')).toBe(false);
    // The busy fixture's preparing and ready rows survive.
    expect(rows).toHaveLength(busy.filter((o) => o.state !== 'RESTAURANT_PENDING').length);
  });

  it('reports a state that must never reach a restaurant', () => {
    const report = vi.fn();
    expect(guardLiveRows([order({ code: 'X', state: 'AUTHORIZED' })], report)).toEqual([]);
    expect(report).toHaveBeenCalledTimes(1);
  });
});

describe('row status: every visible state is distinct and labelled', () => {
  const rider = { display_name: 'Daniel P.', vehicle_type: 'CAR' as const, eta_at: at(9) };
  const cases: [string, Order, Parameters<typeof rowStatus>[1], Parameters<typeof rowStatus>[2], string, string][] = [
    ['preparing', order({ code: 'A', promised_ready_at: at(10) }), {}, null, 'Preparing', 'mark-ready'],
    ['late', order({ code: 'A', promised_ready_at: at(-4), is_late: true }), {}, null, 'Late', 'mark-ready'],
    ['just accepted', order({ code: 'A', promised_ready_at: at(10) }), { justAccepted: true }, null, 'Just accepted', 'mark-ready'],
    ['accepted elsewhere', order({ code: 'A', promised_ready_at: at(10) }), { acceptedElsewhere: true }, null, 'Accepted on another screen', 'mark-ready'],
    ['rider here, not ready', order({ code: 'A', rider }), { riderPhase: 'here', riderHereSince: at(-1) }, null, 'Rider here · not ready', 'mark-ready'],
    ['rider unassigned', order({ code: 'A' }), { unassigned: true }, null, 'Rider unassigned', 'mark-ready'],
    ['marking', order({ code: 'A' }), {}, 'sending', 'Marking ready…', 'mark-ready'],
    ['mark failed', order({ code: 'A' }), {}, 'failed', 'Not marked ready', 'try-again'],
    ['mark refused', order({ code: 'A' }), {}, 'refused', 'Can’t mark ready now', 'refreshing'],
    // A never-cut action's failure must not hide behind "Just accepted".
    ['just accepted, mark failed', order({ code: 'A' }), { justAccepted: true }, 'failed', 'Not marked ready', 'try-again'],
    ['just accepted, marking', order({ code: 'A' }), { justAccepted: true }, 'sending', 'Marking ready…', 'mark-ready'],
    ['just accepted, mark refused', order({ code: 'A' }), { justAccepted: true }, 'refused', 'Can’t mark ready now', 'refreshing'],
    ['just accepted, cleared', order({ code: 'A', promised_ready_at: at(10) }), { justAccepted: false }, null, 'Preparing', 'mark-ready'],
    ['items adjusted', order({ code: 'A' }), { removedLines: [{ line_no: 2, name: 'Beef Nihari', qty: 1 }] }, null, 'Order changed', 'mark-ready'],
    ['note added', order({ code: 'A' }), { notes: [{ author_kind: 'SUPPORT', text: 'Napkins', at: at(0) }] }, null, 'New note', 'mark-ready'],
    ['ready', order({ code: 'A', state: 'READY_FOR_PICKUP', rider }), {}, null, 'Ready', 'waiting'],
    ['ready, rider here', order({ code: 'A', state: 'READY_FOR_PICKUP', rider }), { riderPhase: 'here' }, null, 'Ready · rider here', 'read-the-code'],
    ['ready, no rider', order({ code: 'A', state: 'READY_FOR_PICKUP', rider: null }), { noRider: true }, null, 'Ready · no rider yet', 'waiting'],
    ['ready elsewhere', order({ code: 'A', state: 'READY_FOR_PICKUP' }), { markedElsewhere: true }, null, 'Ready · marked on another screen', 'waiting'],
    ['picked up', order({ code: 'A', state: 'PICKED_UP' }), {}, null, 'Out for delivery', 'read-only'],
    ['arrived', order({ code: 'A', state: 'ARRIVED' }), {}, null, 'Out for delivery', 'read-only'],
    ['disputed', order({ code: 'A', state: 'DISPUTED' }), {}, null, 'Delivery problem · with support', 'read-only'],
    ['cancelled while preparing', order({ code: 'A' }), { cancelled: { reasonCode: 'CUSTOMER_CANCELLED', afterReady: false, fromEvent: true } }, null, 'Cancelled · stop', 'remove'],
    ['cancelled after ready', order({ code: 'A', state: 'READY_FOR_PICKUP' }), { cancelled: { reasonCode: null, afterReady: true, fromEvent: true } }, null, 'Cancelled · keep the bag aside', 'remove'],
  ];
  it.each(cases)('%s', (_name, o, facts, mark, label, action) => {
    const s = rowStatus(o, facts, mark, NOW);
    expect(s.badge.label).toBe(label);
    expect(s.action).toBe(action);
  });

  it('never uses danger for anything but order trouble', () => {
    for (const [, o, facts, mark] of cases) {
      const s = rowStatus(o, facts, mark, NOW);
      if (s.badge.variant === 'danger') expect(s.badge.label).toMatch(/Cancelled|Not marked ready/);
    }
  });
});

describe('sort: ready first, then soonest ready time', () => {
  it('ranks rider-here ready, ready, flagged preparing, preparing, out, disputed', () => {
    const rows = [
      order({ code: 'OUT', state: 'PICKED_UP', ready_at: at(-30) }),
      order({ code: 'PREP-LATER', promised_ready_at: at(20), special_instructions: null }),
      order({ code: 'DISP', state: 'DISPUTED', ready_at: at(-40) }),
      order({ code: 'PREP-SOON', promised_ready_at: at(5), special_instructions: null }),
      order({ code: 'READY', state: 'READY_FOR_PICKUP', ready_at: at(-2) }),
      order({ code: 'LATE', promised_ready_at: at(-4), is_late: true }),
      order({ code: 'HERE', state: 'READY_FOR_PICKUP', ready_at: at(-1) }),
    ];
    const facts: Record<string, Parameters<typeof rowStatus>[1]> = { 'id-HERE': { riderPhase: 'here' } };
    const sorted = sortRows(rows, (o) => rowStatus(o, facts[o.id], null, NOW));
    expect(sorted.map((o) => o.code)).toEqual(['HERE', 'READY', 'LATE', 'PREP-SOON', 'PREP-LATER', 'OUT', 'DISP']);
  });

  it('counts exclude cancelled and disputed rows', () => {
    const rows = [
      order({ code: 'P' }),
      order({ code: 'C' }),
      order({ code: 'R', state: 'READY_FOR_PICKUP' }),
      order({ code: 'O', state: 'ARRIVED' }),
      order({ code: 'D', state: 'DISPUTED' }),
    ];
    const counts = countRows(rows, (o) => (o.code === 'C' ? { cancelled: { reasonCode: null, afterReady: false, fromEvent: true } } : {}));
    expect(counts).toEqual({ preparing: 1, ready: 1, out: 1 });
  });
});

describe('row text', () => {
  it('Ready by: promise, minutes late from the server clock, or the ready time', () => {
    expect(readyByText(order({ code: 'A', promised_ready_at: '2026-08-10T22:58:00Z' }), Date.parse('2026-08-10T22:40:00Z'))).toBe('6:58 pm');
    expect(readyByText(order({ code: 'A', promised_ready_at: '2026-08-10T22:44:00Z' }), Date.parse('2026-08-10T22:48:00Z'))).toBe('6:44 pm · 4 min late');
    expect(readyByText(order({ code: 'A', state: 'READY_FOR_PICKUP', ready_at: '2026-08-10T22:45:00Z' }), NOW)).toBe('Ready 6:45 pm');
  });

  it('Rider: live phase only from events; after a refresh, name and vehicle', () => {
    const o = order({ code: 'A', state: 'READY_FOR_PICKUP', rider: { display_name: 'Yusuf A.', vehicle_type: 'BICYCLE', eta_at: '2026-08-10T22:57:00Z' } });
    expect(riderText(o, {})).toBe('Yusuf A. · Bike · about 6:57 pm');
    expect(riderText(o, { riderPhase: 'here', riderHereSince: '2026-08-10T22:51:00Z' })).toBe('Yusuf A. · Bike · here since 6:51 pm');
    expect(riderText({ ...o, state: 'PICKED_UP' }, {})).toBe('Yusuf A. · Bike');
    expect(riderText({ ...o, rider: null }, {})).toBe('Finding a rider');
    expect(riderText({ ...o, rider: null }, { unassigned: true })).toBe('Finding another rider');
  });
});

describe('line extras and the pickup code', () => {
  it('reads the pickup code defensively until #290 lands', () => {
    expect(pickupCodeOf(order({ code: 'A' }))).toBeNull();
    expect(pickupCodeOf({ ...order({ code: 'A' }), pickup_code: '4827' } as Order)).toBe('4827');
    expect(pickupCodeOf({ ...order({ code: 'A' }), pickup_code: '' } as Order)).toBeNull();
  });

  it('renders variants[] when present, else variant_name', () => {
    const line = order({ code: 'A' }).lines[1]!;
    expect(lineExtra({ ...line, variants: [], variant_name: 'Full' })).toBe('Full');
    const choice = (group_name: string, variant_name: string) => ({
      variant_group_id: `g-${group_name}`,
      group_name,
      variant_id: `v-${variant_name}`,
      variant_name,
      pricing_mode: 'DELTA' as const,
      price_cents: null,
      delta_cents: 0 as never,
    });
    expect(lineExtra({ ...line, variant_name: 'Large, Spicy', variants: [choice('Size', 'Large'), choice('Heat', 'Spicy')] })).toBe('Large · Spicy');
    expect(lineExtra({ ...line, variant_name: null, variants: [], addons: [{ addon_id: 'a', addon_name: 'Extra garlic sauce', addon_quantity: 1, addon_price_cents: 50 as never }] })).toBe(
      '+ Extra garlic sauce',
    );
  });
});

describe('acceptance: phone and full address only once accepted', () => {
  const pending = fixture('restaurant_order_restaurant_pending') as Order;
  it('an offer that ended before acceptance (CANCELLED, accepted_at null) is not accepted and was not charged', () => {
    for (const state of ['RESTAURANT_PENDING', 'CANCELLED', 'REJECTED'] as const) {
      const o = { ...pending, state, accepted_at: null };
      expect(isAccepted(o)).toBe(false);
    }
    expect(endedBeforeAccept({ ...pending, state: 'CANCELLED', accepted_at: null })).toBe(true);
    expect(endedBeforeAccept({ ...pending, state: 'RESTAURANT_PENDING', accepted_at: null })).toBe(false);
  });
  it('accepted orders, including one cancelled after acceptance', () => {
    const preparing = fixture('restaurant_order_preparing') as Order;
    expect(isAccepted(preparing)).toBe(true);
    const cancelledLater = { ...preparing, state: 'CANCELLED' as const };
    expect(isAccepted(cancelledLater)).toBe(true);
    expect(endedBeforeAccept(cancelledLater)).toBe(false);
    for (const state of ['READY_FOR_PICKUP', 'PICKED_UP', 'ARRIVED', 'DELIVERED', 'COMPLETED', 'DISPUTED', 'RESOLVED'] as const) {
      expect(isAccepted({ ...preparing, state, accepted_at: null })).toBe(true);
    }
  });
});
