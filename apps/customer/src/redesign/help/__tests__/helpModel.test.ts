/** What a report may send: the part of the order and quantities, never an amount. */
import { EMPTY_FORM, helpKindOf, reasonFromParam, reasonsFor, refundInputOf, refusalOf, validateForm } from '../helpModel';
import { MONEY_KEY, keysOf } from '../../test/requests';

describe('which help an order gets', () => {
  it('follows the state: from acceptance to arrival, after delivery, and nothing to report otherwise', () => {
    for (const s of ['PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'ARRIVED']) expect(helpKindOf(s)).toBe('before');
    for (const s of ['DELIVERED', 'COMPLETED']) expect(helpKindOf(s)).toBe('after');
    for (const s of ['CREATED', 'AUTHORIZED', 'RESTAURANT_PENDING', 'CANCELLED', 'REJECTED', 'FAILED', 'DISPUTED', 'RESOLVED']) {
      expect(helpKindOf(s)).toBe('contactOnly');
    }
  });

  it('the reasons are the contract\'s own codes; a row can only choose one the form offers', () => {
    expect(reasonFromParam('NEVER_DELIVERED', 'after')).toBe('NEVER_DELIVERED');
    expect(reasonFromParam('NEVER_DELIVERED', 'before')).toBeNull();
    expect(reasonFromParam('SOMETHING_MADE_UP', 'after')).toBeNull();
    expect(reasonsFor('contactOnly')).toEqual([]);
  });
});

describe('the form', () => {
  it('opens empty and asks for the reason, then the part of the order, then the items', () => {
    expect(Object.keys(validateForm(EMPTY_FORM, 'after'))).toEqual(['reason', 'kind']);
    expect(Object.keys(validateForm({ ...EMPTY_FORM, reason: 'MISSING_ITEMS', kind: 'PARTIAL_ITEMS' }, 'after'))).toEqual(['items']);
    expect(validateForm({ ...EMPTY_FORM, reason: 'LATE_DELIVERY' }, 'before')).toEqual({});
  });

  it('a wrong address needs a note', () => {
    expect(Object.keys(validateForm({ ...EMPTY_FORM, reason: 'WRONG_ADDRESS', note: 'abc' }, 'before'))).toEqual(['note']);
    expect(validateForm({ ...EMPTY_FORM, reason: 'WRONG_ADDRESS', note: '22 Wellesley St E' }, 'before')).toEqual({});
  });

  it('the request carries quantities above zero and no money field at all', () => {
    const input = refundInputOf('order-1', { reason: 'MISSING_ITEMS', kind: 'PARTIAL_ITEMS', items: { 1: 0, 2: 2 }, note: '  one missing  ' }, 'after');
    expect(input).toEqual({
      order_id: 'order-1',
      kind: 'PARTIAL_ITEMS',
      reason_code: 'MISSING_ITEMS',
      lines: [{ order_line_no: 2, quantity: 2 }],
      note: 'one missing',
    });
    expect(keysOf(input).filter((k) => MONEY_KEY.test(k))).toEqual([]);
  });

  it('before delivery the report is always about the whole order', () => {
    expect(refundInputOf('o', { reason: 'LATE_DELIVERY', kind: 'PARTIAL_ITEMS', items: { 1: 1 }, note: '' }, 'before')).toEqual({
      order_id: 'o',
      kind: 'FULL',
      reason_code: 'LATE_DELIVERY',
    });
  });
});

describe('the server\'s refusals', () => {
  it('map to their own pages; anything else is a failure that keeps the answers', () => {
    expect(refusalOf(409, 'REFUND_ALREADY_REQUESTED').kind).toBe('alreadyRequested');
    expect(refusalOf(409, 'REFUND_WINDOW_CLOSED').kind).toBe('windowClosed');
    expect(refusalOf(409, 'PAYMENT_NOT_REFUNDABLE').kind).toBe('notRefundable');
    expect(refusalOf(409, 'REFUND_EXCEEDS_CAPTURED').kind).toBe('notRefundable');
    expect(refusalOf(422, 'VALIDATION_FAILED').kind).toBe('invalid');
    expect(refusalOf(500, null).kind).toBe('failed');
    expect(refusalOf(null, null).kind).toBe('failed');
  });
});
