/**
 * Server-clock offset (manifest §3 WP1): every countdown is `deadline_at` minus *server* now,
 * never a local constant and never the kitchen tablet's own clock. Each API response's `Date`
 * header updates the offset; `serverNow()` is the device clock corrected by it.
 */
let offsetMs = 0;
const listeners = new Set<() => void>();

/** Records the server time from a response `Date` header (second precision). */
export function observeServerDate(dateHeader: string | null, receivedAt: number = Date.now()): void {
  if (!dateHeader) return;
  const server = Date.parse(dateHeader);
  if (Number.isNaN(server)) return;
  // The header has 1 s resolution: only move the offset when it is off by more than that,
  // so a steady clock does not jitter every countdown by up to a second per response.
  const next = server - receivedAt;
  if (Math.abs(next - offsetMs) < 1000) return;
  offsetMs = next;
  listeners.forEach((l) => l());
}

export function serverOffsetMs(): number {
  return offsetMs;
}

export function serverNow(): number {
  return Date.now() + offsetMs;
}

export function onServerOffsetChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Test seam. */
export function resetServerClock(): void {
  offsetMs = 0;
}
