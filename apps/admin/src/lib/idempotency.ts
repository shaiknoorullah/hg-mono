/** A fresh client-generated `Idempotency-Key` (16–128 chars) for one state-changing request. */
export function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
