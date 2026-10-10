/**
 * The halal family's fixed, reviewed copy: one table that `HalalBadge`, `HalalCertificationPanel`
 * and the admin instruments (`SevenChecks`, `DecisionBar`) read, and that the fixed-strings test
 * compares against (plan/design-system.md §5.1).
 *
 * Callers cannot template any of it. The badge labels are the legacy tables, re-exported, so the
 * released apps and the redesign say the same words; what is added here is the amber expiring
 * label and the dates, written with a fixed English month table so no locale turns "Sep" into
 * "Sept." and every date is read in UTC (a date-only certificate expiry is a calendar day, not an
 * instant).
 */

import type { HalalDisplayState } from '@hg/api-client';

import {
  HALAL_ACCESSIBLE_LABEL,
  HALAL_VISIBLE_LABEL,
  type HalalCheckKey,
  type HalalCheckResult,
  type HalalRejectionReasonCode,
} from '../certification/index.js';
import { DEFAULT_TIME_ZONE } from './time.js';

export { HALAL_ACCESSIBLE_LABEL, HALAL_VISIBLE_LABEL };

/** The four contract states (`HalalDisplayState`), in order. */
export const HALAL_DISPLAY_STATES = ['CERTIFIED', 'EXPIRING_SOON', 'EXPIRED', 'UNVERIFIED'] as const satisfies readonly HalalDisplayState[];

/** True only for a contract state: `null`, `undefined` and unknown strings are not one. */
export function isHalalDisplayState(value: unknown): value is HalalDisplayState {
  return typeof value === 'string' && (HALAL_DISPLAY_STATES as readonly string[]).includes(value);
}

const SHORT_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const LONG_MONTH = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The calendar day a wire value names, or null when it is missing or unparseable.
 *
 * A date (`2026-10-20`, `issued_on`, `expires_on`) is a calendar day and is read as written. A
 * date-time (`verified_at`) is an instant and is read in the platform's zone (Ontario), not UTC:
 * `2026-10-10T02:30:00Z` was 9 October in Toronto. An impossible calendar day (`2026-02-30`) is
 * unparseable: `Date` would roll it over into 2 March, an expiry the server never sent.
 */
function halalCalendarDay(value: string | null | undefined): { day: number; month: number; year: number } | null {
  if (!value) return null;
  const head = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (head) {
    const [y, m, d] = [Number(head[1]), Number(head[2]) - 1, Number(head[3])];
    const calendar = new Date(Date.UTC(y, m, d));
    if (calendar.getUTCFullYear() !== y || calendar.getUTCMonth() !== m || calendar.getUTCDate() !== d) return null;
  }
  const dateOnly = DATE_ONLY.test(value);
  const date = dateOnly ? new Date(`${value}T00:00:00Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: dateOnly ? 'UTC' : DEFAULT_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  const [day, month, year] = [part('day'), part('month') - 1, part('year')];
  return Number.isInteger(day) && Number.isInteger(month) && Number.isInteger(year) ? { day, month, year } : null;
}

/** `2026-10-20` → `20 Oct`. The badge's one-line exception to written-out dates. */
export function formatHalalShortDate(value: string | null | undefined): string | null {
  const d = halalCalendarDay(value);
  return d ? `${d.day} ${SHORT_MONTH[d.month]}` : null;
}

/**
 * `2026-10-20` → `20 October 2026`. Certification dates are always absolute; a date-time is the
 * Toronto day (see `halalCalendarDay`).
 */
export function formatHalalLongDate(value: string | null | undefined): string | null {
  const d = halalCalendarDay(value);
  return d ? `${d.day} ${LONG_MONTH[d.month]} ${d.year}` : null;
}

/** Where a badge sits: a card, the detail header, or an admin/restaurant operational surface. */
export type HalalSurface = 'card' | 'detail' | 'operational';

/** The visible label and the accessible name of one badge. */
export interface HalalBadgeLabels {
  visible: string;
  accessible: string;
}

/**
 * The badge's two strings for a state, per the live HalalBadge README:
 * - EXPIRING_SOON shows "Halal certified · expires 20 Oct" when `expiresOn` parses, and its
 *   name says the date in full ("Halal certified. Expires 20 October 2026."); without a date it
 *   is "Halal certified" and nothing is invented.
 * - On the detail surface a certified name carries the body and the date.
 */
export function halalBadgeLabels(input: {
  state: HalalDisplayState;
  surface?: HalalSurface;
  certifyingBodyName?: string | null;
  expiresOn?: string | null;
  pressable?: boolean;
}): HalalBadgeLabels {
  const { state, surface = 'card', certifyingBodyName, expiresOn, pressable = false } = input;
  let visible: string = HALAL_VISIBLE_LABEL[state];
  let accessible: string = HALAL_ACCESSIBLE_LABEL[state];
  const long = formatHalalLongDate(expiresOn);
  const body = surface === 'detail' && certifyingBodyName ? certifyingBodyName : null;
  if (state === 'CERTIFIED' && body) {
    accessible = `Halal certified by ${body}.${long ? ` Valid until ${long}.` : ''}`;
  }
  if (state === 'EXPIRING_SOON') {
    const short = formatHalalShortDate(expiresOn);
    if (short) visible = `${visible} · expires ${short}`;
    if (body) accessible = `Halal certified by ${body}.`;
    else if (long) accessible = 'Halal certified.';
    if (long) accessible = `${accessible} Expires ${long}.`;
  }
  if (pressable) accessible = `${accessible} Double tap for certificate details.`;
  return { visible, accessible };
}

/** The short names of the seven checks, verbatim from the admin boards (`RV/Checks`). */
export const HALAL_CHECK_NAME: Readonly<Record<HalalCheckKey, string>> = {
  H1_LEGIBLE_COMPLETE: 'Legible and complete',
  H2_ISSUER_ACCEPTED: 'Issuer accepted',
  H3_NAME_MATCH: 'Name match',
  H4_ADDRESS_MATCH: 'Address match',
  H5_DATES_VALID: 'Dates valid',
  H6_SCOPE_SUFFICIENT: 'Scope sufficient',
  H7_UNIQUE_NOT_REUSED: 'Unique, not reused',
};

/** A check result in words. Results are words and icons, never colour alone. */
export const HALAL_CHECK_RESULT_LABEL: Readonly<Record<HalalCheckResult, string>> = {
  PASS: 'Pass',
  FAIL: 'Fail',
  NOT_ASSESSED: 'Not assessed',
};

/** "H4" from "H4_ADDRESS_MATCH". */
export function halalCheckCode(key: HalalCheckKey): string {
  return key.slice(0, 2);
}

/** The contract's `HalalRejectionReasonCode`, in order (live `index.d.ts`). */
export const HALAL_REJECTION_REASONS = [
  'ILLEGIBLE',
  'EXPIRED_OR_EXPIRING',
  'ISSUER_NOT_ACCEPTED',
  'NAME_MISMATCH',
  'ADDRESS_MISMATCH',
  'SCOPE_INSUFFICIENT',
  'DUPLICATE_CERTIFICATE',
  'SUSPECTED_FORGERY',
  'OTHER',
] as const satisfies readonly HalalRejectionReasonCode[];

/** Reason labels, verbatim from `RV/Verify-Reject`. */
export const HALAL_REJECTION_REASON_LABEL: Readonly<Record<HalalRejectionReasonCode, string>> = {
  ILLEGIBLE: 'Illegible or incomplete',
  EXPIRED_OR_EXPIRING: 'Expired or expiring',
  ISSUER_NOT_ACCEPTED: 'Issuer not accepted',
  NAME_MISMATCH: 'Name doesn’t match',
  ADDRESS_MISMATCH: 'Address doesn’t match',
  SCOPE_INSUFFICIENT: 'Scope doesn’t cover this restaurant',
  DUPLICATE_CERTIFICATE: 'Already used by another restaurant',
  SUSPECTED_FORGERY: 'Suspected forgery',
  OTHER: 'Other',
};

/** The reason a single failed check preselects in the reject form (`RV/Verify-Reject*`). */
export const HALAL_REJECTION_REASON_FOR_CHECK: Readonly<Record<HalalCheckKey, HalalRejectionReasonCode>> = {
  H1_LEGIBLE_COMPLETE: 'ILLEGIBLE',
  H2_ISSUER_ACCEPTED: 'ISSUER_NOT_ACCEPTED',
  H3_NAME_MATCH: 'NAME_MISMATCH',
  H4_ADDRESS_MATCH: 'ADDRESS_MISMATCH',
  H5_DATES_VALID: 'EXPIRED_OR_EXPIRING',
  H6_SCOPE_SUFFICIENT: 'SCOPE_INSUFFICIENT',
  H7_UNIQUE_NOT_REUSED: 'DUPLICATE_CERTIFICATE',
};
