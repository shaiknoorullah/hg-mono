/**
 * The customer redesign's halal display rule, in one place (manifest global rules 2 and 3,
 * AGENTS.md invariants 8 and 9).
 *
 * - The state comes only from `halal.display_state`.
 * - A badge needs the whole record: a known state plus `certifying_body_name` and `expires_on`.
 *   Anything missing or partial renders no badge and no "View certification", only the neutral
 *   line "Certificate details unavailable". Silence is never consent.
 * - `EXPIRING_SOON` carries its date: "Halal certified · expires 20 Oct".
 * - `EXPIRED` is cool slate, never red. Customers should never see one in a list (the API returns
 *   404 for it); where it does appear, on a cart or an order already accepted, it is slate.
 * - `UNVERIFIED` renders no badge.
 * - From `DELIVERED` on, and on every terminal or disputed order surface, no badge at all.
 * - Offline, a cached state shows only while it is at most 15 minutes old.
 */
import type { Schema } from '@hg/api-client';

import { formatShortDate } from './time';

export type HalalRecord = Schema['HalalBadge'];
export type HalalDisplayState = Schema['HalalDisplayState'];

/** How long a cached halal state may be shown while offline (decision log; manifest rule 3). */
export const HALAL_CACHE_MAX_AGE_MS = 15 * 60 * 1000;

export const CERTIFICATE_UNAVAILABLE = 'Certificate details unavailable';
export const OFFLINE_HALAL_LINE = "We can't check the certification while you're offline.";

export type HalalPresentation =
  /** Render `HalalBadge` with this state; `expiresOn` is set for EXPIRING_SOON. */
  | { kind: 'badge'; state: 'CERTIFIED' | 'EXPIRING_SOON'; certifyingBody: string; expiresOn: string; label: string }
  /** The certificate lapsed (slate), only on a cart or an accepted order. */
  | { kind: 'expired'; certifyingBody: string | null }
  /** Missing or partial record: no badge, no View certification, the neutral line. */
  | { kind: 'unavailable'; line: typeof CERTIFICATE_UNAVAILABLE }
  /** Cached record too old to show offline: no badge, the offline line. */
  | { kind: 'stale'; line: typeof OFFLINE_HALAL_LINE }
  /** Show nothing at all (UNVERIFIED, or a surface where badges never appear). */
  | { kind: 'none' };

export interface HalalContext {
  /** Whether the app can currently reach the API. */
  online?: boolean;
  /** When this record was fetched (epoch ms); needed to judge it offline. */
  asOf?: number | null;
  /** The current app time (`getNow()`). */
  now?: number;
}

/** Whether a cached record may still be shown. Online, always; offline, for 15 minutes. */
export function halalCacheFresh(ctx: HalalContext): boolean {
  if (ctx.online !== false) return true;
  if (ctx.asOf == null || ctx.now == null) return false;
  return ctx.now - ctx.asOf <= HALAL_CACHE_MAX_AGE_MS;
}

export function presentHalal(halal: HalalRecord | null | undefined, ctx: HalalContext = {}): HalalPresentation {
  if (!halal || !halal.display_state) return { kind: 'unavailable', line: CERTIFICATE_UNAVAILABLE };
  if (!halalCacheFresh(ctx)) return { kind: 'stale', line: OFFLINE_HALAL_LINE };
  const body = halal.certifying_body_name?.trim() || null;
  switch (halal.display_state) {
    case 'CERTIFIED':
    case 'EXPIRING_SOON': {
      if (!body || !halal.expires_on) return { kind: 'unavailable', line: CERTIFICATE_UNAVAILABLE };
      const label =
        halal.display_state === 'EXPIRING_SOON'
          ? `Halal certified · expires ${formatShortDate(halal.expires_on)}`
          : 'Halal certified';
      return { kind: 'badge', state: halal.display_state, certifyingBody: body, expiresOn: halal.expires_on, label };
    }
    case 'EXPIRED':
      return { kind: 'expired', certifyingBody: body };
    case 'UNVERIFIED':
      return { kind: 'none' };
    default:
      // An unknown future state is not consent.
      return { kind: 'unavailable', line: CERTIFICATE_UNAVAILABLE };
  }
}

/** Order states from which no halal badge is ever shown (manifest rule 2). */
const NO_BADGE_ORDER_STATES = new Set([
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
  'FAILED',
  'DISPUTED',
  'RESOLVED',
]);

export function orderShowsHalal(state: string): boolean {
  return !NO_BADGE_ORDER_STATES.has(state);
}
