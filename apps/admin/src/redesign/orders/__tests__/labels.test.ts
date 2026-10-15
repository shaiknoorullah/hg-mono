import { describe, expect, it } from 'vitest';

import { contractSpec } from '../../testing/contract';
import {
  ACTOR,
  CANCEL_REASON,
  CHARGEBACK_STATUS,
  DISPATCH_STATE,
  LEDGER_ACCOUNT,
  LEDGER_BATCH_KIND,
  LEDGER_COMPONENT,
  MONEY_EVENT,
  ORDER_STATE,
  PAYMENT_STATE,
  REFUND_STATE,
  STAFF_CANCEL_REASONS,
} from '../labels';

const schemas = () => contractSpec().components.schemas;
const enumOf = (name: string) => schemas()[name]!.enum!;

// A new enum value in the contract must fail here, not render as a blank cell.
describe('the state-label map covers every contract enum, exactly', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['OrderState', ORDER_STATE],
    ['PaymentState', PAYMENT_STATE],
    ['RefundState', REFUND_STATE],
    ['DispatchState', DISPATCH_STATE],
    ['LedgerAccount', LEDGER_ACCOUNT],
    ['LedgerComponent', LEDGER_COMPONENT],
    ['MoneyEventKind', MONEY_EVENT],
    ['OrderActorKind', ACTOR],
    ['OrderCancellationReasonCode', CANCEL_REASON],
    ['ChargebackStatus', CHARGEBACK_STATUS],
  ];
  it.each(cases)('%s', (name, map) => {
    expect(Object.keys(map).sort()).toEqual([...enumOf(name)].sort());
  });

  it('LedgerEntry.batch_kind', () => {
    const kinds = schemas()['LedgerEntry']!.properties!['batch_kind']!.enum!;
    expect(Object.keys(LEDGER_BATCH_KIND).sort()).toEqual([...kinds].sort());
  });
});

describe('what staff may choose', () => {
  it('never offers a reason the system sets itself', () => {
    const systemOnly = ['RESTAURANT_TIMEOUT', 'CAPTURE_FAILED', 'PAYMENT_EXPIRED', 'PREP_OVERDUE'];
    for (const r of systemOnly) expect(STAFF_CANCEL_REASONS).not.toContain(r);
    for (const r of STAFF_CANCEL_REASONS) expect(CANCEL_REASON).toHaveProperty(r);
  });

  it('keeps danger for failures: only Failed (order), Payment failed and a failed refund', () => {
    const danger = (m: Record<string, { tone: string }>) => Object.entries(m).filter(([, v]) => v.tone === 'danger').map(([k]) => k);
    expect(danger(ORDER_STATE)).toEqual(['FAILED']);
    expect(danger(PAYMENT_STATE)).toEqual(['FAILED']);
    expect(danger(REFUND_STATE)).toEqual(['FAILED']);
  });
});
