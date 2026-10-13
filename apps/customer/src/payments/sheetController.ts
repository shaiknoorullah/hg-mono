/**
 * The web card sheet's controller: the bridge between the function API `payWithSheet` (pay.web.ts)
 * and the React host that renders Stripe's Payment Element (PaymentSheetHost.web.tsx).
 *
 * `payWithSheet(secret)` calls `requestPayment(secret)`, which publishes a request and returns a
 * promise; the mounted host renders the sheet for it and calls `settle(result)` once, when the
 * customer pays, is declined, or closes the sheet. A second request while one is open settles the
 * first as `canceled`. With no host mounted the request fails at once instead of hanging.
 *
 * Platform-neutral and free of Stripe imports, so it is cheap to test.
 */
import type { PayResult } from './types';

export interface PaymentRequest {
  /** Distinct per request, so the host remounts Stripe Elements for each one. */
  id: number;
  clientSecret: string;
}

type Pending = PaymentRequest & { resolve: (r: PayResult) => void };

let pending: Pending | null = null;
let nextId = 1;
let hosts = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export const NO_HOST_MESSAGE =
  'The card form is not available on this screen. Please reload the app and try again.';

export function requestPayment(clientSecret: string): Promise<PayResult> {
  if (hosts === 0) return Promise.resolve({ status: 'failed', message: NO_HOST_MESSAGE });
  if (pending) settle({ status: 'canceled' });
  return new Promise<PayResult>((resolve) => {
    pending = { id: nextId++, clientSecret, resolve };
    emit();
  });
}

/** Resolves the open request (if any) and closes the sheet. Safe to call more than once. */
export function settle(result: PayResult): void {
  const p = pending;
  if (!p) return;
  pending = null;
  p.resolve(result);
  emit();
}

export function currentRequest(): PaymentRequest | null {
  return pending ? { id: pending.id, clientSecret: pending.clientSecret } : null;
}

let snapshot: PaymentRequest | null = null;
/** A stable snapshot for `useSyncExternalStore` (a new object only when the request changes). */
export function getSnapshot(): PaymentRequest | null {
  if (snapshot?.id !== pending?.id) snapshot = currentRequest();
  return snapshot;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The host registers while mounted; unmounting the last host cancels an open request. */
export function registerHost(): () => void {
  hosts += 1;
  return () => {
    hosts -= 1;
    if (hosts === 0) settle({ status: 'canceled' });
  };
}
