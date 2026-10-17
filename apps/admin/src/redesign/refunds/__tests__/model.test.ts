import { describe, expect, it } from 'vitest';
import { cents, HgApiError } from '@hg/api-client';
import type { Schema } from '@hg/api-client';

import { fixture } from '../../testing';
import {
  buildRefundInput,
  checkDraft,
  classifyRefusal,
  EMPTY_DRAFT,
  nothingKey,
  OFFERED_REASONS,
  reasonsFor,
  REASON_STATUS,
  refundability,
  type RefundDraft,
} from '../model';

type Order = Schema['OrderAdminView'];
const ORDER_ID = '86e927df-0e4c-41b4-a4da-74b86551a63a';
const draft = (over: Partial<RefundDraft>): RefundDraft => ({ ...EMPTY_DRAFT, reason: 'FOOD_QUALITY', text: 'The platter was cold and undercooked.', ...over });
const order = (name: string, payment: Partial<Order['payment']> = {}): Order => {
  const o = fixture<Order>(name);
  return { ...o, payment: { ...o.payment, ...payment } };
};

describe('what the panel sends', () => {
  it('sends no amount for a whole-order or selected-items refund', () => {
    const whole = buildRefundInput(ORDER_ID, draft({ scope: 'FULL' }));
    expect(whole).toEqual({ order_id: ORDER_ID, scope: 'FULL', reason_code: 'FOOD_QUALITY', reason_text: 'The platter was cold and undercooked.' });
    expect('amount_cents' in whole).toBe(false);

    const items = buildRefundInput(ORDER_ID, draft({ scope: 'PARTIAL_ITEMS', lines: { 2: 1, 1: 0, 3: 2 } }));
    expect(items.line_items).toEqual([
      { order_line_no: 2, quantity: 1 },
      { order_line_no: 3, quantity: 2 },
    ]);
    expect('amount_cents' in items).toBe(false);
  });

  it('sends a goodwill amount as whole cents, with the Goodwill reason, and only then', () => {
    const g = buildRefundInput(ORDER_ID, draft({ scope: 'GOODWILL', reason: 'GOODWILL', goodwillCents: 1235 }));
    expect(g).toMatchObject({ scope: 'PARTIAL_AMOUNT', reason_code: 'GOODWILL', amount_cents: 1235 });
    expect(Number.isInteger(g.amount_cents)).toBe(true);
    expect(() => buildRefundInput(ORDER_ID, draft({ scope: 'GOODWILL', goodwillCents: null }))).toThrow();
    expect(() => buildRefundInput(ORDER_ID, draft({ scope: 'GOODWILL', goodwillCents: 12.5 }))).toThrow(/integer/);
  });

  it('checks the draft before sending, and compares a typed amount only with the captured total', () => {
    const o = order('order_admin_view_delivered');
    const captured = o.payment.amount_captured_cents;
    expect(checkDraft(draft({ text: 'short' }), o).text).toBeTruthy();
    expect(checkDraft(draft({ scope: 'PARTIAL_ITEMS' }), o).items).toBeTruthy();
    expect(checkDraft(draft({ reason: '' }), o).reason).toBeTruthy();
    expect(checkDraft(draft({ scope: 'GOODWILL', goodwillCents: captured + 1 }), o).amount).toMatch(/more than was captured/);
    expect(checkDraft(draft({ scope: 'GOODWILL', goodwillCents: 0 }), o).amount).toBeTruthy();
    expect(checkDraft(draft({ scope: 'GOODWILL', goodwillCents: null }), o, { amountUnreadable: true }).amount).toMatch(/whole cents/);
    expect(checkDraft(draft({ scope: 'GOODWILL', goodwillCents: 500 }), o)).toEqual({});
    expect(checkDraft(draft({ caseId: 'not-an-id' }), o).caseId).toBeTruthy();
  });
});

describe('which reasons are offered', () => {
  it('offers Before a chargeback only to an admin on a disputed order', () => {
    expect(reasonsFor('FULL', { role: 'ADMIN', orderState: 'DISPUTED' })).toContain('CHARGEBACK_PREEMPTIVE');
    expect(reasonsFor('FULL', { role: 'SUPER_ADMIN', orderState: 'DISPUTED' })).toContain('CHARGEBACK_PREEMPTIVE');
    expect(reasonsFor('FULL', { role: 'SUPPORT_AGENT', orderState: 'DISPUTED' })).not.toContain('CHARGEBACK_PREEMPTIVE');
    expect(reasonsFor('FULL', { role: 'ADMIN', orderState: 'DELIVERED' })).not.toContain('CHARGEBACK_PREEMPTIVE');
  });

  it('never offers the reasons that belong to other steps, and fixes goodwill to Goodwill', () => {
    for (const scope of ['FULL', 'PARTIAL_ITEMS'] as const) {
      const all = reasonsFor(scope, { role: 'ADMIN', orderState: 'DISPUTED' });
      expect(all).not.toContain('HALAL_INTEGRITY');
      expect(all).not.toContain('DISPUTE_RESOLUTION');
      expect(all).not.toContain('GOODWILL');
    }
    expect(reasonsFor('GOODWILL', { role: 'SUPPORT_AGENT', orderState: 'DELIVERED' })).toEqual(['GOODWILL']);
  });

  it('decides every reason the contract has: offered, or a stated reason it is not', () => {
    for (const [code, status] of Object.entries(REASON_STATUS)) {
      if (status === 'offered') expect(OFFERED_REASONS, code).toHaveProperty(code);
      else expect(status.length, code).toBeGreaterThan(10);
    }
    for (const code of Object.keys(OFFERED_REASONS)) expect(REASON_STATUS[code as keyof typeof REASON_STATUS]).toBe('offered');
  });
});

describe('an order that cannot be refunded', () => {
  it.each([
    ['order_admin_view_rejected', { state: 'CANCELED' as const }, 'rejected'],
    ['order_admin_view_cancelled', { state: 'CANCELED' as const }, 'cancelled'],
    ['order_admin_view_failed', {}, 'payment-failed'],
    ['order_admin_view_preparing', { state: 'REQUIRES_CAPTURE' as const, amount_captured_cents: cents(0) }, 'nothing-captured'],
  ])('%s has nothing to refund', (name, payment, key) => {
    const can = refundability(order(name, payment));
    expect(can.kind).not.toBe('ok');
    if (can.kind !== 'ok') expect(nothingKey(can)).toBe(key);
  });

  it('reads an order as fully refunded from the payment’s own two totals', () => {
    const o = order('order_admin_view_delivered');
    const captured = o.payment.amount_captured_cents;
    expect(refundability(order('order_admin_view_delivered', { amount_refunded_cents: captured })).kind).toBe('fully-refunded');
    expect(refundability(o).kind).toBe('ok');
  });
});

describe('reading a refusal by its code', () => {
  const refuse = (name: string) => {
    const f = fixture<{ error: { code: string; message: string; details?: unknown } }>(name);
    return classifyRefusal(new HgApiError(409, f as never));
  };
  it('names the next step for each refund error the contract lists', () => {
    expect(refuse('error_refund_mfa_required').kind).toBe('mfa-required');
    expect(refuse('error_refund_conflict').kind).toBe('exceeds-captured');
    expect(refuse('error_refund_not_refundable').kind).toBe('not-refundable');
    expect(refuse('error_refund_daily_cap').kind).toBe('daily-cap');
    expect(refuse('error_refund_self_approval_forbidden').kind).toBe('self-approval');
    expect(refuse('error_refund_already_requested_items')).toEqual({ kind: 'already-requested', lineNos: [1], fees: false });
    expect(refuse('error_refund_already_requested_fees')).toMatchObject({ kind: 'already-requested', fees: true });
  });
});
