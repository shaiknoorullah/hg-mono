/** Web has no Stripe sheet (the SDK is native-only); the order is left awaiting payment. */
import type { PayResult } from './types';

export async function payWithSheet(_clientSecret: string): Promise<PayResult> {
  return { status: 'unsupported' };
}
