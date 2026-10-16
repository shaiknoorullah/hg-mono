/**
 * The one write Get help makes: `createRefund`, a request for a person to look at a problem.
 *
 * The body is `RefundInput`, which has no amount field at all. The Idempotency-Key is mandatory on
 * the contract; the caller owns it, so the same report sent again after a dropped connection reuses
 * its key and can never become two reports.
 */
import { unwrap, type Schema } from '@hg/api-client';

import { api } from '../api/client';

export type Refund = Schema['Refund'];
export type RefundInput = Schema['RefundInput'];

export async function sendReport(input: RefundInput, key: string): Promise<Refund> {
  const body = await unwrap(api.POST('/v1/refunds', { params: { header: { 'Idempotency-Key': key } }, body: input }));
  return body.data as unknown as Refund;
}
