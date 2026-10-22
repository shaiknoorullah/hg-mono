/**
 * Small builders the tracking tests share: a mock API answer carrying `{ data }`, a paged list, and
 * a fixture order or payment with a few fields changed.
 */
import type { Schema } from '@hg/api-client';

import { payloadOf, type MockAnswer } from './mockApi';

type Order = Schema['OrderCustomerView'];
type Payment = Schema['OrderPayment'];

/** A 200 answer whose body is `{ data }`. */
export const ok = (data: unknown): MockAnswer => ({ status: 200, body: { data } });
/** A 200 answer for a collection, with no further page. */
export const list = (data: unknown[]): MockAnswer => ({ status: 200, body: { data, meta: { next_cursor: null, has_more: false } } });
/** The fixture order `scenario`, with `patch` applied. */
export const order = (scenario: string, patch: Partial<Order> = {}): Order => ({ ...payloadOf<Order>(scenario), ...patch });
/** The fixture payment `scenario`, with `patch` applied. */
export const payment = (scenario: string, patch: Partial<Payment> = {}): Payment => ({ ...payloadOf<Payment>(scenario), ...patch });
