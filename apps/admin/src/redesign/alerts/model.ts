/**
 * Live alerts as data: what an `admin:ops` event becomes, which ones raise the banner, where each
 * row points, and which of those links a role may follow.
 *
 * Rules (boards `ASS/Alerts*`, `ASS/AlertBanner*`; `contracts/websocket.md` section 4.7):
 * - An event this console does not know is kept, with its raw type, and never dropped.
 * - `severity` is an open string on the wire. The contract names no values; `services/hg` sends
 *   `high` and `critical` (payments) and `WARNING` and `INFO` (handover codes, halal issuers); the
 *   boards draw `high` and `normal`. Only `high` and `critical` raise the banner, and anything
 *   else, including a value never seen before, does not (the boards' owner question on the
 *   severity list says to treat unknown values as not high).
 * - Alert rows link only where the console can follow: an order, a restaurant's orders, a rider's
 *   active orders. A customer, a payment object or a type this console does not know is shown as
 *   text with its full id. Support agents get no link to an onboarding record.
 */
import type { RealtimeEnvelope } from '@hg/api-client';

import type { StaffRole } from '../data/session';

export type AlertGroup = 'alert' | 'dispatch' | 'recon' | 'unknown';

export interface AlertRow {
  /** The channel's sequence number: unique, and the order (newest has the highest). */
  readonly seq: number;
  readonly id: string;
  /** When it happened, ISO. */
  readonly at: string;
  readonly group: AlertGroup;
  /** The event type on the wire, kept raw for the unknown group. */
  readonly type: string;
  /** `admin.alert`'s `kind`, or a reconciliation exception's `kind`. */
  readonly code: string | null;
  readonly severity: string | null;
  readonly subjectType: string | null;
  readonly subjectId: string | null;
  readonly message: string | null;
  readonly dispatch: { readonly waves: number | null; readonly ridersOffered: number | null; readonly radiusM: number | null } | null;
  readonly money: { readonly expectedCents: number; readonly actualCents: number } | null;
  /** Arrived after the replay finished (so it may raise the banner and counts as "new"). */
  readonly live: boolean;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const cents = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

/** Queue depth and control frames are not alerts. */
const NOT_ALERTS = new Set(['admin.queue_depth']);

/** The row an `admin:ops` event makes, or `null` for events that are not alerts. */
export function rowFromEvent(event: RealtimeEnvelope, live: boolean): AlertRow | null {
  if (event.channel !== 'admin:ops' || NOT_ALERTS.has(event.type) || !Number.isInteger(event.seq) || event.seq <= 0) return null;
  const data = (event.data && typeof event.data === 'object' ? event.data : {}) as Record<string, unknown>;
  const base = {
    seq: event.seq,
    id: event.id,
    type: event.type,
    live,
    code: null,
    severity: null,
    subjectType: null,
    subjectId: null,
    message: null,
    dispatch: null,
    money: null,
  } as const;
  const at = str(data['at']) ?? event.ts;

  if (event.type === 'admin.alert') {
    const subjectType = str(data['subject_type']);
    return {
      ...base,
      at,
      group: subjectType?.toLowerCase() === 'reconciliation_exception' ? 'recon' : 'alert',
      code: str(data['kind']),
      severity: str(data['severity']),
      subjectType,
      subjectId: str(data['subject_id']),
      message: str(data['message']),
    };
  }
  if (event.type === 'admin.dispatch_failure') {
    return {
      ...base,
      at: event.ts,
      group: 'dispatch',
      subjectType: 'ORDER',
      subjectId: str(data['order_id']),
      dispatch: { waves: int(data['waves']), ridersOffered: int(data['riders_offered']), radiusM: int(data['radius_m']) },
    };
  }
  if (event.type === 'admin.reconciliation_exception') {
    const expected = cents(data['expected_cents']);
    const actual = cents(data['actual_cents']);
    return {
      ...base,
      at: event.ts,
      group: 'recon',
      code: str(data['kind']),
      subjectType: 'ORDER',
      subjectId: str(data['order_id']),
      money: expected !== null && actual !== null ? { expectedCents: expected, actualCents: actual } : null,
    };
  }
  return { ...base, at: event.ts, group: 'unknown' };
}

/** Newest first, no duplicates (a replay can repeat what the live feed already delivered). */
export function mergeRows(existing: readonly AlertRow[], incoming: readonly AlertRow[]): AlertRow[] {
  const bySeq = new Map<number, AlertRow>();
  for (const r of existing) bySeq.set(r.seq, r);
  for (const r of incoming) if (!bySeq.has(r.seq)) bySeq.set(r.seq, r);
  return [...bySeq.values()].sort((a, b) => b.seq - a.seq);
}

/** Only `high` and `critical` raise the banner; see the module comment. */
export function isHighSeverity(severity: string | null): boolean {
  const s = severity?.trim().toLowerCase();
  return s === 'high' || s === 'critical';
}

export function severityLabel(severity: string | null): string | null {
  if (!severity) return null;
  const s = severity.trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type KindFilter = 'all' | 'alert' | 'dispatch' | 'recon';

export const KIND_OPTIONS: readonly { readonly value: KindFilter; readonly label: string }[] = [
  { value: 'all', label: 'All kinds' },
  { value: 'alert', label: 'Platform alerts' },
  { value: 'dispatch', label: 'Dispatch failures' },
  { value: 'recon', label: 'Reconciliation exceptions' },
];

export function parseKindFilter(raw: string | null): KindFilter {
  return raw === 'alert' || raw === 'dispatch' || raw === 'recon' ? raw : 'all';
}

export function matchesKind(row: AlertRow, filter: KindFilter): boolean {
  return filter === 'all' || row.group === filter;
}

export const GROUP_LABEL: Record<Exclude<AlertGroup, 'unknown'>, string> = {
  alert: 'Platform alert',
  dispatch: 'Dispatch failure',
  recon: 'Reconciliation exception',
};

/** Reconciliation kinds this console has words for. Others show only their code. */
const RECON_KIND_LABEL: Record<string, string> = {
  capture_mismatch: "Captured amount doesn't match the order",
};

export function reconLabel(code: string | null): string | null {
  return code ? (RECON_KIND_LABEL[code] ?? null) : null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The sentence for a dispatch failure, from its three numbers; never a number it was not given. */
export function dispatchSentence(d: NonNullable<AlertRow['dispatch']>): string {
  const parts: string[] = [];
  parts.push(d.waves !== null ? `No rider accepted after ${plural(d.waves, 'wave', 'waves')}.` : 'No rider accepted.');
  const tail: string[] = [];
  if (d.ridersOffered !== null) tail.push(`${plural(d.ridersOffered, 'rider', 'riders')} offered`);
  if (d.radiusM !== null) tail.push(`search radius ${(d.radiusM / 1000).toFixed(1)} km`);
  if (tail.length > 0) parts.push(`${tail.join(', ')}.`.replace(/^./, (c) => c.toUpperCase()));
  return parts.join(' ');
}

/** What a row says happened, as plain words. */
export function whatHappened(row: AlertRow): string | null {
  if (row.group === 'dispatch' && row.dispatch) return dispatchSentence(row.dispatch);
  if (row.group === 'recon' && row.money) return reconLabel(row.code);
  return row.message;
}

const RIDER_ACTIVE_STATES = 'PREPARING,READY_FOR_PICKUP,PICKED_UP,ARRIVED';

export type Subject =
  | { readonly kind: 'platform' }
  | { readonly kind: 'order'; readonly id: string; readonly to: string }
  | { readonly kind: 'customer'; readonly id: string }
  | { readonly kind: 'restaurant'; readonly id: string; readonly to: string; readonly record: string | null }
  | { readonly kind: 'rider'; readonly id: string; readonly to: string; readonly record: string | null }
  | { readonly kind: 'raw'; readonly type: string; readonly id: string };

/**
 * What a row is about and where it may point for this role. "Platform" only when the subject is
 * PLATFORM or has no id. The onboarding record links are for admins and super admins: a support
 * agent reaches a rider's record only from a case (round-2 decision on the boards).
 */
export function subjectOf(row: AlertRow, role: StaffRole | null): Subject {
  const type = row.subjectType?.trim().toUpperCase() ?? null;
  const id = row.subjectId;
  if (type === 'PLATFORM' || !id) return { kind: 'platform' };
  const admin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  switch (type) {
    case 'ORDER':
      return { kind: 'order', id, to: `/orders/${id}` };
    case 'CUSTOMER':
      return { kind: 'customer', id };
    case 'RESTAURANT':
      return { kind: 'restaurant', id, to: `/orders?restaurant_id=${id}`, record: admin ? `/restaurants/${id}` : null };
    case 'RIDER':
      return {
        kind: 'rider',
        id,
        to: `/orders?account_id=${id}&state=${RIDER_ACTIVE_STATES}`,
        record: admin ? `/riders/${id}` : null,
      };
    default:
      return { kind: 'raw', type: row.subjectType ?? 'unknown', id };
  }
}

/**
 * One sentence of what an alert means for the customers a support agent is helping, per alert
 * kind. The boards say each needs content from the runbook; only the payment-webhook one is
 * written, so every other kind shows just the raw message.
 */
const CUSTOMER_IMPACT: Record<string, { readonly headline: string; readonly sentence: string }> = {
  webhook_delivery_failed: {
    headline: 'Payment problem',
    sentence: "Customers' payments may not confirm right away; don't promise a refund until the order updates.",
  },
};

export function customerImpact(code: string | null): { headline: string; sentence: string } | null {
  return code ? (CUSTOMER_IMPACT[code] ?? null) : null;
}

/** Newest alerts that are `live` and high severity, for the banner (not dismissed). */
export function bannerAlerts(rows: readonly AlertRow[], dismissed: ReadonlySet<number>): AlertRow[] {
  return rows.filter((r) => r.live && r.group !== 'unknown' && isHighSeverity(r.severity) && !dismissed.has(r.seq));
}
